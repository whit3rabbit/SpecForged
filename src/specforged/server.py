"""
Main SpecForge MCP Server implementation.
"""

import os
from pathlib import Path
from typing import Optional
from mcp.server.fastmcp import FastMCP

from .core import ModeClassifier, SpecificationManager, ProjectDetector
from .tools import (
    setup_classification_tools,
    setup_spec_tools,
    setup_workflow_tools,
    setup_planning_tools,
)
from .resources import setup_resources
from .prompts import setup_prompts


def create_server(name: str = "SpecForge", base_dir: Optional[Path] = None) -> FastMCP:
    """Create and configure the SpecForge MCP server"""

    # Initialize server
    mcp = FastMCP(name, dependencies=["pydantic>=2.0", "aiofiles"])

    # Initialize core managers
    classifier = ModeClassifier()

    # Determine base directory for specifications:
    # 1) Explicit argument (for programmatic use)
    # 2) Environment variable with absolute path (legacy support)
    # 3) Project-relative directory detection (new default behavior)
    if base_dir is None:
        env_base = os.environ.get("SPECFORGE_BASE_DIR") or os.environ.get(
            "SPECFORGED_BASE_DIR"
        )
        if env_base and Path(env_base).is_absolute():
            # If absolute path in env var, use it as-is (legacy behavior)
            resolved_base = Path(env_base).expanduser()
        else:
            # New behavior: detect project root and create specs there
            project_detector = ProjectDetector()
            resolved_base = project_detector.get_specifications_dir()

            # Log project detection info for debugging
            project_info = project_detector.get_project_info()
            print(f"SpecForge: Detected project root: {project_info['project_root']}")
            print(f"SpecForge: Using specifications directory: {resolved_base}")

            if env_base and not Path(env_base).is_absolute():
                # If relative path in env var, use it as subdirectory name
                resolved_base = project_detector.get_specifications_dir(env_base)
    else:
        resolved_base = base_dir

    spec_manager = SpecificationManager(resolved_base)

    # Setup all tools
    setup_classification_tools(mcp, classifier)
    setup_spec_tools(mcp, spec_manager)
    setup_workflow_tools(mcp, spec_manager)
    setup_planning_tools(mcp, spec_manager)

    # Setup resources and prompts
    setup_resources(mcp)
    setup_prompts(mcp)

    return mcp


def run_server() -> None:
    """Run the SpecForge MCP server"""
    print("Starting SpecForge MCP Server...")
    print("Mode Classification: Enabled")
    print("Spec Management: Ready")
    print("Workflow Phases: Requirements → Design → Planning → Execution")

    server = create_server()
    try:
        server.run()
    except KeyboardInterrupt:
        # Graceful shutdown on Ctrl-C
        print("\nReceived Ctrl-C. Shutting down gracefully...")
    finally:
        print("Server stopped.")
