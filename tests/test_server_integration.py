"""
Integration tests for the MCP Server with Queue Processing.

Tests the complete server setup including queue processing,
conflict detection, error recovery, and basic server functionality.
"""

import tempfile
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from src.specforged.core.queue_processor import (
    Operation,
    OperationQueue,
    OperationStatus,
    OperationType,
    QueueProcessor,
)
from src.specforged.core.spec_manager import SpecificationManager
from src.specforged.server import create_server, setup_server_tools


class TestServerIntegration:
    """Integration tests for MCP server with queue processing."""

    @pytest.fixture
    def temp_dir(self):
        """Create a temporary directory for testing."""
        with tempfile.TemporaryDirectory() as temp_dir:
            yield Path(temp_dir)

    @pytest.fixture
    def mock_spec_manager(self, temp_dir):
        """Create a mock SpecificationManager."""
        mock_manager = MagicMock(spec=SpecificationManager)
        mock_manager.base_dir = temp_dir / "specs"
        mock_manager.base_dir.mkdir(parents=True, exist_ok=True)

        # Mock the project_detector
        mock_project_detector = MagicMock()
        mock_project_detector.project_root = temp_dir
        mock_manager.project_detector = mock_project_detector

        mock_manager.specs = {}
        mock_manager._validate_file_path.return_value = True
        return mock_manager

    @pytest.fixture
    def queue_processor(self, mock_spec_manager, temp_dir):
        """Create a QueueProcessor instance for testing."""
        return QueueProcessor(mock_spec_manager, temp_dir)

    @pytest.fixture
    def mcp_server(self, temp_dir):
        """Create an MCP server instance for testing."""
        with patch("src.specforged.server.ProjectDetector") as mock_detector_class:
            mock_detector = mock_detector_class.return_value
            mock_detector.project_root = temp_dir
            mock_detector.get_specifications_dir.return_value = temp_dir / "specs"
            mock_detector.get_project_info.return_value = {
                "project_root": temp_dir,
                "markers_found": [".git"],
            }

            server = create_server(base_dir=temp_dir / "specs")
            return server

    def test_server_creation_with_queue_processor(self, mcp_server):
        """Test that server is created with queue processor."""
        # Verify queue processor is attached to server
        assert hasattr(mcp_server, "queue_processor")
        assert mcp_server.queue_processor is not None
        assert isinstance(mcp_server.queue_processor, QueueProcessor)

    @pytest.mark.asyncio
    async def test_queue_processor_integration_with_server(self, mcp_server, temp_dir):
        """Test queue processor integration with server components."""
        # Create a test operation
        operation = Operation(
            id="test-op-123",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc),
            params={"name": "Test Spec"},
        )
        queue = OperationQueue(operations=[operation])

        # Save queue using the queue processor's atomic write
        await mcp_server.queue_processor.save_operation_queue(queue)

        # Verify we can load the queue back
        loaded_queue = await mcp_server.queue_processor.load_operation_queue()
        assert len(loaded_queue.operations) == 1
        assert loaded_queue.operations[0].id == "test-op-123"

    @pytest.mark.asyncio
    async def test_queue_processing_functionality(self, mcp_server, temp_dir):
        """Test that queue processing works with server integration."""
        # Create a heartbeat operation (simple operation that should succeed)
        operation = Operation(
            id="heartbeat-op-123",
            type=OperationType.HEARTBEAT,
            timestamp=datetime.now(timezone.utc),
            params={},
            status=OperationStatus.PENDING,
        )
        queue = OperationQueue(operations=[operation])
        await mcp_server.queue_processor.save_operation_queue(queue)

        # Process the queue
        await mcp_server.queue_processor.process_operation_queue()

        # Verify operation was processed
        updated_queue = await mcp_server.queue_processor.load_operation_queue()
        processed_operation = updated_queue.operations[0]
        assert processed_operation.status == OperationStatus.COMPLETED

    @pytest.mark.asyncio
    async def test_sync_state_management(self, mcp_server, temp_dir):
        """Test sync state file management."""
        # Update sync state
        await mcp_server.queue_processor.update_sync_state()

        # Verify sync file was created
        sync_file = temp_dir / "specforge-sync.json"
        assert sync_file.exists()

        # Load and verify sync data structure
        import json

        with open(sync_file, "r") as f:
            sync_data = json.load(f)

        assert "mcp_server_online" in sync_data
        assert sync_data["mcp_server_online"] is True
        assert "last_sync" in sync_data
        assert "pending_operations" in sync_data
        assert "specifications" in sync_data

    @pytest.mark.asyncio
    async def test_error_recovery_integration(self, mcp_server, temp_dir):
        """Test error recovery functionality with server integration."""
        # Create a corrupted queue file
        queue_file = temp_dir / "mcp-operations.json"
        with open(queue_file, "w") as f:
            f.write("corrupted json content")

        # Recovery should work
        await mcp_server.queue_processor.recover_from_corrupted_queue()

        # Should be able to load queue after recovery
        queue = await mcp_server.queue_processor.load_operation_queue()
        assert isinstance(queue, OperationQueue)

    @pytest.mark.asyncio
    async def test_workspace_change_handling(self, mcp_server):
        """Test workspace change handling functionality."""
        # This test ensures the method runs without error
        await mcp_server.queue_processor.handle_workspace_changes()

        # Should complete without raising exceptions
        assert mcp_server.queue_processor.project_root.exists()

    @pytest.mark.asyncio
    async def test_diagnostic_report_generation(self, mcp_server):
        """Test diagnostic report generation."""
        # Generate diagnostic report
        report = await mcp_server.queue_processor.generate_diagnostic_report()

        # Verify report structure
        assert "timestamp" in report
        assert "queue_processor" in report
        assert "files" in report
        assert "queue_status" in report
        assert "specifications" in report
        assert "system_info" in report

    @pytest.mark.asyncio
    async def test_operation_validation_integration(self, mcp_server):
        """Test operation validation in server context."""
        # Test with valid operation
        valid_operation = Operation(
            id="test-op-123",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc),
            params={"name": "Test Spec", "description": "Test description"},
        )

        # Should not raise exception
        await mcp_server.queue_processor._validate_operation(valid_operation)

        # Test with invalid operation
        invalid_operation = Operation(
            id="test-op-456",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc),
            params={"description": "Test description"},  # Missing 'name'
        )

        with pytest.raises(
            ValueError, match="create_spec operation requires 'name' parameter"
        ):
            await mcp_server.queue_processor._validate_operation(invalid_operation)

    @pytest.mark.asyncio
    async def test_conflict_detection_integration(self, mcp_server):
        """Test conflict detection in server context."""
        # Create two identical operations that should conflict
        operation1 = Operation(
            id="test-op-1",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc),
            params={"name": "Test Spec", "specId": "test-spec"},
        )

        operation2 = Operation(
            id="test-op-2",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc),
            params={"name": "Test Spec", "specId": "test-spec"},
        )

        queue = OperationQueue(operations=[operation1, operation2])

        # Detect conflicts
        conflicts = await mcp_server.queue_processor.detect_operation_conflicts(
            operation2, queue
        )

        # Should detect duplicate operation conflict
        assert len(conflicts) > 0
        assert any(conflict.type == "duplicate_operation" for conflict in conflicts)

    @pytest.mark.asyncio
    async def test_server_graceful_shutdown_cleanup(self, mcp_server, temp_dir):
        """Test server graceful shutdown with operation cleanup."""
        # Create an operation
        operation = Operation(
            id="shutdown-op-123",
            type=OperationType.SYNC_STATUS,
            timestamp=datetime.now(timezone.utc),
            params={},
            status=OperationStatus.PENDING,
        )
        queue = OperationQueue(operations=[operation])

        await mcp_server.queue_processor.save_operation_queue(queue)

        # Simulate graceful shutdown cleanup
        await mcp_server.queue_processor.update_sync_state()

        # Verify sync state was updated (simulating final heartbeat)
        sync_file = temp_dir / "specforge-sync.json"
        assert sync_file.exists()

        import json

        with open(sync_file, "r") as f:
            sync_data = json.load(f)

        assert sync_data["mcp_server_online"] is True
        assert "last_sync" in sync_data

    def test_setup_server_tools_integration(self):
        """Test setup_server_tools function integration."""
        # Create mock objects
        mock_mcp = MagicMock()
        mock_queue_processor = MagicMock()
        mock_spec_manager = MagicMock()

        # Call setup_server_tools
        setup_server_tools(mock_mcp, mock_queue_processor, mock_spec_manager)

        # Verify tools were registered
        assert mock_mcp.tool.call_count >= 3  # Should register at least 3 tools

        # Verify all tool decorators were called
        tool_calls = mock_mcp.tool.call_args_list
        assert len(tool_calls) >= 3
