#!/usr/bin/env python3
"""
SpecForge HTTP Server - Entry point for HTTP deployment.

Runs SpecForge as an HTTP server using Starlette and Uvicorn for
cloud deployment scenarios (though local development is recommended).
"""

import os

import uvicorn
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse
from starlette.routing import Route

from src.specforged.server import create_server


def health_check(request):
    """Health check endpoint for deployment monitoring"""
    return JSONResponse(
        {
            "status": "healthy",
            "service": "SpecForge HTTP MCP Server",
            "version": "0.3.2",
            "transport": "http",
            "endpoints": {"mcp": "/mcp", "health": "/health"},
        }
    )


def main():
    """Run SpecForge as HTTP server for cloud deployment"""

    # Create the MCP server
    mcp_server = create_server("SpecForge-HTTP")

    # Get the Starlette HTTP app
    app = mcp_server.streamable_http_app()

    # Add health check route
    app.router.routes.append(Route("/health", health_check, methods=["GET"]))

    # Add CORS middleware for web access
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["mcp-session-id", "mcp-protocol-version"],
        max_age=86400,
    )

    # Get port from environment
    port = int(os.environ.get("PORT", 8080))

    print(f"Starting SpecForge HTTP Server on port {port}")
    print("Mode Classification: Enabled")
    print("Spec Management: Ready")
    print("HTTP Transport: Active")
    print("CORS: Enabled")

    # Run the server
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
