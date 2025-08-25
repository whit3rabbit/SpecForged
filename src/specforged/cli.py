#!/usr/bin/env python3
"""
SpecForge CLI Entry Points

Provides command-line interfaces for running SpecForge MCP server variants.
"""

import argparse
import sys

from . import __version__
from .server import create_server, run_server


def specforge_mcp():
    """Main entry point for SpecForge MCP server (for pipx)"""
    parser = argparse.ArgumentParser(description="SpecForge MCP Server")
    parser.add_argument(
        "--version", action="version", version=f"SpecForge {__version__}"
    )
    _args = parser.parse_args()

    print("Starting SpecForge MCP Server...")
    print("Mode Classification: Enabled")
    print("Spec Management: Ready")
    print("Workflow Phases: Requirements → Design → Planning → Execution")

    try:
        run_server()
    except KeyboardInterrupt:
        print("\nSpecForge MCP Server stopped.")
        sys.exit(0)


def specforge_http():
    """Entry point for SpecForge HTTP server (for pipx)"""
    import uvicorn
    from starlette.applications import Starlette
    from starlette.middleware.cors import CORSMiddleware
    from starlette.responses import JSONResponse
    from starlette.routing import Route, Mount

    print("Starting SpecForge HTTP Server...")
    print("Mode Classification: Enabled")
    print("Spec Management: Ready")
    print("HTTP API: Available")

    # Create MCP server
    mcp_server = create_server("SpecForge-HTTP")

    # Create HTTP routes
    async def health_check(request):
        return JSONResponse({"status": "healthy", "service": "SpecForge"})

    # Create Starlette app
    app = Starlette(
        routes=[
            Route("/health", health_check),
            Mount("/mcp", mcp_server.get_starlette_app()),
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


def main():
    """Main CLI with subcommands"""
    parser = argparse.ArgumentParser(
        description="SpecForge - Specification-driven development with MCP"
    )
    parser.add_argument(
        "--version", action="version", version=f"SpecForge {__version__}"
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # MCP server command
    _mcp_parser = subparsers.add_parser("mcp", help="Run MCP server")

    # HTTP server command
    _http_parser = subparsers.add_parser("http", help="Run HTTP server")
    _http_parser.add_argument("--port", type=int, default=8000, help="Port to run on")

    args = parser.parse_args()

    if args.command == "mcp":
        specforge_mcp()
    elif args.command == "http":
        if hasattr(args, "port"):
            import os

            os.environ["PORT"] = str(args.port)
        specforge_http()
    else:
        # Default to MCP server
        specforge_mcp()


if __name__ == "__main__":
    main()
