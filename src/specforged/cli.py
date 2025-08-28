#!/usr/bin/env python3
"""
SpecForge CLI Entry Points

Provides command-line interfaces for running SpecForge MCP server variants.
"""

import argparse
import sys
from typing import Any

from . import __version__
from .server import create_server, run_server


def specforge_mcp() -> None:
    """Main entry point for SpecForge MCP server (for pipx)"""
    parser = argparse.ArgumentParser(description="SpecForge MCP Server")
    parser.add_argument(
        "--version", action="version", version=f"SpecForge {__version__}"
    )
    parser.add_argument(
        "--base-dir",
        type=str,
        default=None,
        help="Directory to store specifications (e.g., . or ./specifications)",
    )
    args = parser.parse_args()

    print("Starting SpecForge MCP Server...")
    print("Mode Classification: Enabled")
    print("Spec Management: Ready")
    print("Workflow Phases: Requirements → Design → Planning → Execution")

    try:
        # If a base directory is explicitly provided, use it;
        # otherwise, rely on server defaults/env
        if args.base_dir:
            from pathlib import Path

            server = create_server(base_dir=Path(args.base_dir).expanduser().resolve())
            server.run()
        else:
            run_server()
    except KeyboardInterrupt:
        print("\nSpecForge MCP Server stopped.")
        sys.exit(0)


def specforge_http() -> None:
    """Entry point for SpecForge HTTP server (for pipx)"""
    import uvicorn
    from starlette.applications import Starlette
    from starlette.middleware.cors import CORSMiddleware
    from starlette.responses import JSONResponse
    from starlette.routing import Mount, Route

    print("Starting SpecForge HTTP Server...")
    print("Mode Classification: Enabled")
    print("Spec Management: Ready")
    print("HTTP API: Available")

    # Create MCP server
    mcp_server = create_server("SpecForge-HTTP")

    # Create HTTP routes
    async def health_check(request) -> JSONResponse:  # type: ignore[no-untyped-def]
        return JSONResponse({"status": "healthy", "service": "SpecForge"})

    # Create Starlette app
    app = Starlette(
        routes=[
            Route("/health", health_check),
            Mount("/mcp", mcp_server.streamable_http_app()),
        ]
    )

    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Get port from environment or default
    import os

    port = int(os.getenv("PORT", 8000))

    print(f"Server starting on port {port}")
    print("Health check available at /health")
    print("MCP endpoints available at /mcp/*")

    try:
        uvicorn.run(app, host="0.0.0.0", port=port)
    except KeyboardInterrupt:
        print("\nSpecForge HTTP Server stopped.")
        sys.exit(0)


def specforge_new(args: Any) -> None:
    """Entry point for SpecForge project wizard (for pipx)"""
    from pathlib import Path

    from .templates import TemplateManager
    from .wizard import run_wizard

    print("🚀 SpecForge Project Wizard")
    print("Creating new specification with guided setup...")

    base_dir = args.base_dir if hasattr(args, "base_dir") else "specifications"
    template = args.template if hasattr(args, "template") else None

    if template:
        # Check if template exists
        template_manager = TemplateManager()
        available = template_manager.get_available_templates()
        if template not in available:
            print(f"❌ Template '{template}' not found.")
            print(f"Available templates: {', '.join(available.keys())}")
            sys.exit(1)
        print(f"📋 Using template: {available[template]['name']}")

    try:
        spec_id = run_wizard(base_dir)
        if spec_id:
            print(f"\n🎉 Project specification '{spec_id}' created successfully!")
            print(f"📁 Location: {Path(base_dir).resolve() / spec_id}")
            print("\nNext steps:")
            print("  1. Review generated files")
            print("  2. Start implementing tasks")
            print(f"  3. Use 'specforged mcp --base-dir {base_dir}' to access via MCP")
        else:
            print("❌ Project creation cancelled or failed.")
            sys.exit(1)
    except KeyboardInterrupt:
        print("\n❌ Wizard cancelled by user.")
        sys.exit(0)
    except (ImportError, ModuleNotFoundError, OSError, ValueError) as e:
        print(f"❌ Error creating project: {e}")
        sys.exit(1)


def main() -> None:
    """Main CLI with subcommands"""
    parser = argparse.ArgumentParser(
        description="SpecForge - Specification-driven development with MCP"
    )
    parser.add_argument(
        "--version", action="version", version=f"SpecForge {__version__}"
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # MCP server command
    subparsers.add_parser("mcp", help="Run MCP server")

    # HTTP server command
    http_parser = subparsers.add_parser("http", help="Run HTTP server")
    http_parser.add_argument("--port", type=int, default=8000, help="Port to run on")

    # New project wizard command
    new_parser = subparsers.add_parser(
        "new", help="Create new project specification via interactive wizard"
    )
    new_parser.add_argument(
        "--base-dir",
        type=str,
        default="specifications",
        help="Directory to store specifications",
    )
    new_parser.add_argument(
        "--template",
        type=str,
        choices=["web-app", "rest-api", "cli-tool", "python-lib", "microservice"],
        help="Use a predefined project template",
    )

    args = parser.parse_args()

    if args.command == "mcp":
        specforge_mcp()
    elif args.command == "http":
        if hasattr(args, "port"):
            import os

            os.environ["PORT"] = str(args.port)
        specforge_http()
    elif args.command == "new":
        specforge_new(args)
    else:
        # Default to MCP server
        specforge_mcp()


if __name__ == "__main__":
    main()
