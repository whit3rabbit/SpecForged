"""
Integration test configuration and shared fixtures.

This module provides pytest fixtures for integration tests including
workspace setup, mock servers, and test data.
"""

import tempfile
from pathlib import Path

import pytest

from .fixtures import IntegrationTestWorkspace, MockMcpServer


@pytest.fixture
async def integration_workspace():
    """
    Provide an integration test workspace with temporary directory.

    This fixture creates a temporary workspace directory and initializes
    all necessary components for integration testing.
    """
    with tempfile.TemporaryDirectory() as temp_dir:
        workspace_dir = Path(temp_dir)
        workspace = IntegrationTestWorkspace(workspace_dir)
        await workspace.setup()
        yield workspace
        await workspace.cleanup()


@pytest.fixture
async def mock_mcp_server(integration_workspace):
    """
    Provide a mock MCP server for testing.

    This fixture creates a mock MCP server that simulates real server
    behavior for testing integration scenarios.
    """
    server = MockMcpServer(integration_workspace)
    await server.start()
    yield server
    await server.stop()
