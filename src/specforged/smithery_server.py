"""
Smithery-specific server wrapper for SpecForged MCP deployment.

This module provides a Smithery-decorated server factory that configures
SpecForged for cloud deployment while maintaining full compatibility with
local development workflows.
"""

from mcp.server.fastmcp import Context, FastMCP
from pydantic import BaseModel, Field
from smithery.decorators import smithery

from .server import create_server


class ConfigSchema(BaseModel):
    """Configuration schema for Smithery-deployed SpecForged server"""

    project_path: str = Field(
        default=".", description="Project root path relative to deployment environment"
    )
    spec_folder: str = Field(
        default=".specifications",
        description="Specifications folder name within project",
    )
    enable_filesystem_tools: bool = Field(
        default=False,
        description=(
            "Enable filesystem modification tools (disabled for cloud deployment)"
        ),
    )
    mode_classification_enabled: bool = Field(
        default=True,
        description="Enable intelligent mode classification for user requests",
    )


@smithery.server(config_schema=ConfigSchema)
def create_smithery_server() -> FastMCP:
    """
    Create and configure SpecForged MCP server for Smithery deployment.

    This function creates a SpecForged server instance optimized for cloud
    deployment through Smithery. The server provides specification-driven
    development tools and intelligent mode classification while being
    configured to work safely in a containerized environment.

    Returns:
        FastMCP: Configured SpecForge server instance ready for deployment

    Note:
        The server is configured for read-only operations when deployed
        via Smithery, as file modifications should be handled by the
        local VS Code extension to avoid permission issues.
    """

    # Create base server with Smithery-specific naming
    server = create_server(
        name="SpecForge-Smithery",
        base_dir=None,  # Use environment detection for specifications
    )

    # Add session configuration access for tools that need it
    @server.tool()
    def get_server_config(ctx: Context) -> dict:
        """Get current server configuration for debugging"""
        config = getattr(ctx, "session_config", None)
        if config:
            return {
                "project_path": config.project_path,
                "spec_folder": config.spec_folder,
                "filesystem_tools_enabled": config.enable_filesystem_tools,
                "mode_classification_enabled": config.mode_classification_enabled,
                "deployment_type": "smithery",
                "server_name": "SpecForge-Smithery",
            }
        else:
            return {
                "project_path": ".",
                "spec_folder": ".specifications",
                "filesystem_tools_enabled": False,
                "mode_classification_enabled": True,
                "deployment_type": "smithery",
                "server_name": "SpecForge-Smithery",
            }

    @server.tool()
    def get_deployment_info() -> dict:
        """Get deployment-specific information"""
        return {
            "deployment_platform": "smithery",
            "capabilities": [
                "mode_classification",
                "specification_analysis",
                "requirements_guidance",
                "workflow_planning",
                "task_management",
            ],
            "limitations": ["no_local_file_writes", "read_only_filesystem_access"],
            "recommended_usage": (
                "Use with VS Code extension for full file operation support"
            ),
        }

    return server


def run_smithery_server() -> None:
    """
    Development runner for Smithery server (local testing only).

    This function is primarily for local development and testing.
    In production, Smithery handles server lifecycle management.
    """
    print("Starting SpecForged Smithery Server (Development Mode)...")
    print("Platform: Smithery-compatible deployment")
    print("Mode Classification: Enabled")
    print("Spec Management: Read-only analysis")
    print("File Operations: Delegated to VS Code extension")
    print("Workflow Phases: Requirements → Design → Planning → Execution")

    server = create_smithery_server()
    try:
        server.run()
    except KeyboardInterrupt:
        print("\nSmithery server stopped.")
