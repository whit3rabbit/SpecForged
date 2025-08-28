"""
Main SpecForge MCP Server implementation.
"""

import os
from pathlib import Path
from typing import Optional

from mcp.server.fastmcp import FastMCP

from .core import ModeClassifier, ProjectDetector, SpecificationManager
from .prompts import setup_prompts
from .resources import setup_resources
from .tools import (
    setup_classification_tools,
    setup_filesystem_tools,
    setup_planning_tools,
    setup_spec_tools,
    setup_workflow_tools,
)


def create_server(name: str = "SpecForge", base_dir: Optional[Path] = None) -> FastMCP:
    """Create and configure the SpecForge MCP server"""

    # Initialize server
    mcp = FastMCP(name, dependencies=["pydantic>=2.0", "aiofiles"])

    # Initialize core managers
    classifier = ModeClassifier()

    env_base = os.environ.get("SPECFORGE_BASE_DIR")
    env_project_root = os.environ.get("SPECFORGE_PROJECT_ROOT")

    # Resolve working/project root and specifications base
    if base_dir:
        # Treat explicit base_dir as the *base* for specs; infer project as its parent
        resolved_base = Path(base_dir).expanduser().resolve()
        working_dir = resolved_base.parent
        project_detector = ProjectDetector(working_dir=working_dir)
        specs_base = resolved_base
    else:
        # If env project root is absolute & exists, prefer it; otherwise
        # ProjectDetector will
        # pull from WORKSPACE_FOLDER_PATHS/PWD/cwd and ascend to a marker.
        wd_candidate = None
        if env_project_root:
            p = Path(env_project_root).expanduser()
            if p.is_absolute() and p.exists():
                wd_candidate = p
        project_detector = ProjectDetector(working_dir=wd_candidate)

        # Base dir name (default ".specifications") goes *under* the detected
        # project root
        if env_base:
            if Path(env_base).is_absolute():
                specs_base = Path(env_base).expanduser().resolve()
            else:
                specs_base = project_detector.get_specifications_dir(env_base)
        else:
            specs_base = project_detector.get_specifications_dir()

    # Log project detection info for debugging
    project_info = project_detector.get_project_info()
    print(f"SpecForge: Detected project root: {project_info['project_root']}")
    print(f"SpecForge: Project markers found: {project_info['markers_found']}")
    print(f"SpecForge: Using specifications directory: {specs_base}")

    spec_manager = SpecificationManager(specs_base)

    # Setup all tools
    setup_classification_tools(mcp, classifier)
    setup_spec_tools(mcp, spec_manager)
    setup_workflow_tools(mcp, spec_manager)
    setup_planning_tools(mcp, spec_manager)
    setup_filesystem_tools(mcp, spec_manager)

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
