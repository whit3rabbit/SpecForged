"""
Main SpecForge MCP Server implementation.
"""

import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from mcp.server.fastmcp import FastMCP

from .config import ServerConfig, load_configuration
from .core import ModeClassifier, ProjectDetector, QueueProcessor, SpecificationManager
from .security import (
    SecurityAuditLogger,
    SecurePathHandler,
    ClientRateLimiter,
    InputValidator,
    RateLimitConfig,
)
from .prompts import setup_prompts
from .resources import setup_resources
from .tools import (
    setup_classification_tools,
    setup_filesystem_tools,
    setup_planning_tools,
    setup_spec_tools,
    setup_workflow_tools,
)


def create_server(name: Optional[str] = None, base_dir: Optional[Path] = None, config: Optional[ServerConfig] = None) -> FastMCP:
    """Create and configure the SpecForge MCP server"""

    # Load configuration if not provided
    if config is None:
        config = load_configuration()
        
    # Use config name if not explicitly provided
    if name is None:
        name = config.name

    # Initialize server
    mcp = FastMCP(name, dependencies=["pydantic>=2.0", "aiofiles"])

    # Initialize core managers
    classifier = ModeClassifier()

    # Resolve working/project root and specifications base using configuration
    if base_dir:
        # Treat explicit base_dir as the *base* for specs; infer project as its parent
        resolved_base = Path(base_dir).expanduser().resolve()
        working_dir = resolved_base.parent
        project_detector = ProjectDetector(working_dir=working_dir)
        specs_base = resolved_base
    else:
        # Use configuration to determine paths
        wd_candidate = None
        if config.project_root:
            p = Path(config.project_root).expanduser()
            if p.is_absolute() and p.exists():
                wd_candidate = p
        project_detector = ProjectDetector(working_dir=wd_candidate)

        # Base dir from configuration
        if Path(config.base_dir).is_absolute():
            specs_base = Path(config.base_dir).expanduser().resolve()
        else:
            specs_base = project_detector.get_specifications_dir(config.base_dir)

    # Log project detection info for debugging
    project_info = project_detector.get_project_info()
    print(f"SpecForge: Detected project root: {project_info['project_root']}")
    print(f"SpecForge: Project markers found: {project_info['markers_found']}")
    print(f"SpecForge: Using specifications directory: {specs_base}")

    spec_manager = SpecificationManager(specs_base)

    # Initialize security components using configuration
    if config.security_audit_enabled:
        audit_log_path = specs_base / "security" / "audit.log"
        audit_log_path.parent.mkdir(exist_ok=True)
        security_audit_logger = SecurityAuditLogger(audit_log_path)
    else:
        security_audit_logger = None
        
    secure_path_handler = SecurePathHandler(project_detector.project_root, specs_base)
    
    if config.rate_limiting_enabled:
        rate_config = RateLimitConfig()
        rate_config.max_requests_per_minute = config.max_requests_per_minute
        rate_limiter = ClientRateLimiter(rate_config)
    else:
        rate_limiter = None
        
    input_validator = InputValidator()

    # Initialize queue processor for operation handling
    queue_processor = QueueProcessor(spec_manager, project_detector.project_root)

    # Setup all tools
    setup_classification_tools(mcp, classifier)
    setup_spec_tools(mcp, spec_manager)
    setup_workflow_tools(mcp, spec_manager)
    setup_planning_tools(mcp, spec_manager)
    setup_filesystem_tools(mcp, spec_manager)

    # Setup resources and prompts
    setup_resources(mcp)
    setup_prompts(mcp)

    # Store components for use in request handling
    mcp.queue_processor = queue_processor  # type: ignore
    mcp.security_audit_logger = security_audit_logger  # type: ignore
    mcp.secure_path_handler = secure_path_handler  # type: ignore
    mcp.rate_limiter = rate_limiter  # type: ignore
    mcp.input_validator = input_validator  # type: ignore

    # Add server status and health check tools
    setup_server_tools(mcp, queue_processor, spec_manager)

    return mcp


def setup_server_tools(
    mcp: FastMCP, queue_processor: QueueProcessor, spec_manager: SpecificationManager
) -> None:
    """Setup server status and health check tools"""

    @mcp.tool()
    async def get_server_status() -> dict:
        """
        Get comprehensive server status including queue processor health.

        Returns detailed information about server status, queue processing,
        and specification management health.
        """
        try:
            # Process queue and update status
            await queue_processor.process_operation_queue()

            # Load current sync state
            sync_state = None
            if queue_processor.sync_file.exists():
                import json

                import aiofiles

                async with aiofiles.open(
                    queue_processor.sync_file, "r", encoding="utf-8"
                ) as f:
                    content = await f.read()
                if content.strip():
                    sync_data = json.loads(content)
                    sync_state = sync_data

            # Load operation queue status
            queue = await queue_processor.load_operation_queue()
            pending_ops = len([op for op in queue.operations if op.status == "pending"])
            in_progress_ops = len(
                [op for op in queue.operations if op.status == "in_progress"]
            )
            failed_ops = len([op for op in queue.operations if op.status == "failed"])
            completed_ops = len(
                [op for op in queue.operations if op.status == "completed"]
            )

            # Get specification stats
            spec_count = len(spec_manager.specs)
            current_spec = spec_manager.current_spec_id

            # Get security statistics if available
            security_stats = {}
            try:
                if hasattr(mcp, "security_audit_logger") and mcp.security_audit_logger:
                    audit_stats = mcp.security_audit_logger.get_security_stats()
                    security_stats["audit_events"] = audit_stats.get("total_events", 0)
                    security_stats["security_alerts"] = audit_stats.get("alerts_sent", 0)
                else:
                    security_stats["audit_events"] = "disabled"
                    
                if hasattr(mcp, "rate_limiter") and mcp.rate_limiter:
                    rate_stats = mcp.rate_limiter.get_system_status()
                    security_stats["rate_limiting"] = {
                        "active_clients": rate_stats.get("active_clients", 0),
                        "global_stats": rate_stats.get("global_stats", {}),
                    }
                else:
                    security_stats["rate_limiting"] = "disabled"
                    
            except Exception as e:
                security_stats = {"error": f"Failed to get security stats: {e}"}

            return {
                "server_status": "online",
                "timestamp": datetime.now().isoformat(),
                "mcp_server_online": True,
                "project_root": str(queue_processor.project_root),
                "specifications": {
                    "total_count": spec_count,
                    "current_spec": current_spec,
                    "base_directory": str(spec_manager.base_dir),
                },
                "operation_queue": {
                    "total_operations": len(queue.operations),
                    "pending": pending_ops,
                    "in_progress": in_progress_ops,
                    "failed": failed_ops,
                    "completed": completed_ops,
                    "last_processed": (
                        queue.last_processed.isoformat()
                        if queue.last_processed
                        else None
                    ),
                },
                "sync_state": sync_state,
                "security": security_stats,
                "health": (
                    "healthy" if pending_ops == 0 and failed_ops == 0 else "degraded"
                ),
            }

        except Exception as e:
            return {
                "server_status": "error",
                "timestamp": datetime.now().isoformat(),
                "error": str(e),
                "health": "unhealthy",
            }

    @mcp.tool()
    async def get_server_health() -> dict:
        """
        Perform health check on server components.

        Checks queue processor, specification manager, and file system health.
        Returns simple health status suitable for monitoring.
        """
        health_status = "healthy"
        checks = {}

        try:
            # Check queue processor
            queue = await queue_processor.load_operation_queue()
            failed_ops = len([op for op in queue.operations if op.status == "failed"])
            checks["queue_processor"] = {
                "status": "healthy" if failed_ops == 0 else "degraded",
                "failed_operations": failed_ops,
            }

            if failed_ops > 0:
                health_status = "degraded"

        except Exception as e:
            checks["queue_processor"] = {"status": "unhealthy", "error": str(e)}
            health_status = "unhealthy"

        try:
            # Check specification manager
            spec_count = len(spec_manager.specs)
            base_dir_exists = spec_manager.base_dir.exists()
            checks["specification_manager"] = {
                "status": "healthy" if base_dir_exists else "degraded",
                "spec_count": spec_count,
                "base_directory_exists": base_dir_exists,
            }

            if not base_dir_exists:
                health_status = "degraded"

        except Exception as e:
            checks["specification_manager"] = {"status": "unhealthy", "error": str(e)}
            health_status = "unhealthy"

        try:
            # Check file system access
            project_root_writable = (
                queue_processor.project_root.exists()
                and queue_processor.project_root.is_dir()
            )
            checks["filesystem"] = {
                "status": "healthy" if project_root_writable else "unhealthy",
                "project_root_accessible": project_root_writable,
            }

            if not project_root_writable:
                health_status = "unhealthy"

        except Exception as e:
            checks["filesystem"] = {"status": "unhealthy", "error": str(e)}
            health_status = "unhealthy"

        return {
            "health": health_status,
            "timestamp": datetime.now().isoformat(),
            "checks": checks,
        }

    @mcp.tool()
    async def update_server_heartbeat() -> dict:
        """
        Update server heartbeat and sync state.

        Manually trigger heartbeat update and process any pending operations.
        Useful for ensuring server availability is correctly reported.
        """
        try:
            await queue_processor.update_heartbeat()
            await queue_processor.process_operation_queue()

            return {
                "status": "success",
                "message": "Heartbeat updated and operations processed",
                "timestamp": datetime.now().isoformat(),
            }

        except Exception as e:
            return {
                "status": "error",
                "message": f"Failed to update heartbeat: {e}",
                "timestamp": datetime.now().isoformat(),
            }


async def run_server() -> None:
    """Run the SpecForge MCP server"""
    print("Starting SpecForge MCP Server...")
    print("Mode Classification: Enabled")
    print("Spec Management: Ready")
    print("Queue Processing: Enabled")
    print("Workflow Phases: Requirements → Design → Planning → Execution")

    server = create_server()
    queue_processor = getattr(server, "queue_processor", None)

    if queue_processor:
        print(f"Queue Processor: Ready (Project: {queue_processor.project_root})")

        # Process initial operation queue and update heartbeat
        try:
            print("Processing initial operation queue...")
            await queue_processor.process_operation_queue()
            print("✓ Initial queue processing complete")
        except Exception as e:
            print(f"⚠ Warning: Initial queue processing failed: {e}")

    try:
        server.run()
    except KeyboardInterrupt:
        # Graceful shutdown on Ctrl-C
        print("\nReceived Ctrl-C. Shutting down gracefully...")

        # Cleanup operations during shutdown
        if queue_processor:
            try:
                print("Cleaning up operation queue...")
                await queue_processor.update_sync_state()  # Final heartbeat update
                print("✓ Operation queue cleanup complete")
            except Exception as e:
                print(f"⚠ Warning: Cleanup failed: {e}")
    finally:
        print("Server stopped.")
