"""
Main SpecForge MCP Server implementation.
"""

from pathlib import Path
from typing import Optional
from mcp.server.fastmcp import FastMCP

from .core import ModeClassifier, SpecificationManager
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
    spec_manager = SpecificationManager(base_dir or Path("specifications"))

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
