"""
MCP resources for SpecForge server.
"""

from pathlib import Path
from mcp.server.fastmcp import FastMCP


def setup_resources(mcp: FastMCP) -> None:
    """Setup MCP resources for accessing specification files"""

    @mcp.resource("spec://{spec_id}/requirements")
    def get_requirements_resource(spec_id: str) -> str:
        """Get the requirements.md content for a specification"""
        spec_dir = Path("specifications") / spec_id
        req_file = spec_dir / "requirements.md"

        if req_file.exists():
            with open(req_file, "r") as f:
                return f.read()

        return f"Requirements file not found for spec: {spec_id}"

    @mcp.resource("spec://{spec_id}/design")
    def get_design_resource(spec_id: str) -> str:
        """Get the design.md content for a specification"""
        spec_dir = Path("specifications") / spec_id
        design_file = spec_dir / "design.md"

        if design_file.exists():
            with open(design_file, "r") as f:
                return f.read()

        return f"Design file not found for spec: {spec_id}"

    @mcp.resource("spec://{spec_id}/tasks")
    def get_tasks_resource(spec_id: str) -> str:
        """Get the tasks.md content for a specification"""
        spec_dir = Path("specifications") / spec_id
        tasks_file = spec_dir / "tasks.md"

        if tasks_file.exists():
            with open(tasks_file, "r") as f:
                return f.read()

        return f"Tasks file not found for spec: {spec_id}"
