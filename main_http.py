#!/usr/bin/env python3
"""
SpecForge HTTP Server - Entry point for HTTP deployment.

Runs SpecForge as an HTTP server using Starlette and Uvicorn for
cloud deployment scenarios (though local development is recommended).
"""

import asyncio
import os

import uvicorn
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from src.specforged.server import create_server


async def health_check(request: Request):
    """Health check endpoint for deployment monitoring"""
    try:
        # Try to get server health if available
        server = getattr(request.app, "_mcp_server", None)
        queue_processor = getattr(server, "queue_processor", None) if server else None

        # Basic health status
        health_data = {
            "status": "healthy",
            "service": "SpecForge HTTP MCP Server",
            "version": "0.3.2",
            "transport": "http",
            "endpoints": {"mcp": "/mcp", "health": "/health"},
        }

        # Add queue processor health if available
        if queue_processor:
            try:
                # Process any pending operations
                await queue_processor.process_operation_queue()

                # Get queue status
                queue = await queue_processor.load_operation_queue()
                failed_ops = len(
                    [op for op in queue.operations if op.status == "failed"]
                )
                pending_ops = len(
                    [op for op in queue.operations if op.status == "pending"]
                )

                health_data["queue_processor"] = {
                    "status": "healthy" if failed_ops == 0 else "degraded",
                    "pending_operations": pending_ops,
                    "failed_operations": failed_ops,
                }

                if failed_ops > 0:
                    health_data["status"] = "degraded"

            except Exception as e:
                health_data["queue_processor"] = {
                    "status": "unhealthy",
                    "error": str(e),
                }
                health_data["status"] = "degraded"

        return JSONResponse(health_data)

    except Exception as e:
        return JSONResponse(
            {
                "status": "unhealthy",
                "service": "SpecForge HTTP MCP Server",
                "error": str(e),
            },
            status_code=500,
        )


def main():
    """Run SpecForge as HTTP server for cloud deployment"""

    # Create the MCP server
    mcp_server = create_server("SpecForge-HTTP")

    # Process initial operations if queue processor is available
    queue_processor = getattr(mcp_server, "queue_processor", None)
    if queue_processor:
        try:
            print("Processing initial operation queue...")
            asyncio.run(queue_processor.process_operation_queue())
            print("✓ Initial queue processing complete")
        except Exception as e:
            print(f"⚠ Warning: Initial queue processing failed: {e}")

    # Get the Starlette HTTP app
    app = mcp_server.streamable_http_app()

    # Store server reference for health checks
    app._mcp_server = mcp_server

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
    print("Queue Processing: Enabled")
    print("HTTP Transport: Active")
    print("CORS: Enabled")

    # Run the server
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
