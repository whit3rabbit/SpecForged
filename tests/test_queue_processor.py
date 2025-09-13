"""
Tests for the QueueProcessor class.
"""

import json
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from src.specforged.core.queue_processor import (
    ConflictType,
    Operation,
    OperationQueue,
    OperationResult,
    OperationStatus,
    OperationType,
    QueueProcessor,
)
from src.specforged.core.spec_manager import SpecificationManager


class TestQueueProcessor:
    """Test cases for QueueProcessor functionality."""

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

    def test_queue_processor_initialization(self, queue_processor, temp_dir):
        """Test QueueProcessor initialization."""
        assert queue_processor.project_root == temp_dir
        assert queue_processor.queue_file == temp_dir / "mcp-operations.json"
        assert queue_processor.results_file == temp_dir / "mcp-results.json"
        assert queue_processor.sync_file == temp_dir / "specforge-sync.json"

    @pytest.mark.asyncio
    async def test_load_empty_operation_queue(self, queue_processor):
        """Test loading an empty operation queue."""
        queue = await queue_processor.load_operation_queue()
        assert isinstance(queue, OperationQueue)
        assert len(queue.operations) == 0
        assert queue.version == 1

    @pytest.mark.asyncio
    async def test_load_operation_queue_with_data(self, queue_processor):
        """Test loading an operation queue with existing data."""
        # Create test data
        test_operation = Operation(
            id="test-op-123",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc),
            params={"name": "Test Spec"},
        )
        test_queue = OperationQueue(operations=[test_operation])

        # Write test data to file
        await queue_processor.atomic_write_json(
            queue_processor.queue_file, test_queue.model_dump()
        )

        # Load and verify
        loaded_queue = await queue_processor.load_operation_queue()
        assert len(loaded_queue.operations) == 1
        assert loaded_queue.operations[0].id == "test-op-123"
        assert loaded_queue.operations[0].type == OperationType.CREATE_SPEC

    @pytest.mark.asyncio
    async def test_atomic_write_json(self, queue_processor, temp_dir):
        """Test atomic JSON writing."""
        test_file = temp_dir / "test.json"
        test_data = {"test": "data", "number": 42}

        await queue_processor.atomic_write_json(test_file, test_data)

        # Verify file exists and contains correct data
        assert test_file.exists()
        with open(test_file, "r") as f:
            loaded_data = json.load(f)
        assert loaded_data == test_data

    @pytest.mark.asyncio
    async def test_handle_create_spec(self, queue_processor, mock_spec_manager):
        """Test handling create_spec operation."""
        # Setup mock
        mock_spec = MagicMock()
        mock_spec.id = "test-spec"
        mock_spec.name = "Test Specification"
        mock_spec_manager.create_specification.return_value = mock_spec

        # Test operation
        params = {
            "name": "Test Specification",
            "description": "A test spec",
            "specId": "test-spec",
        }

        result = await queue_processor.handle_create_spec(params)

        # Verify result
        assert (
            result["message"]
            == "Specification 'Test Specification' created successfully"
        )
        assert result["data"]["specId"] == "test-spec"
        assert result["data"]["name"] == "Test Specification"
        assert "requirements.md" in result["data"]["filesCreated"]

        # Verify spec_manager was called correctly
        mock_spec_manager.create_specification.assert_called_once_with(
            "Test Specification", "A test spec", "test-spec"
        )

    @pytest.mark.asyncio
    async def test_handle_create_spec_missing_name(self, queue_processor):
        """Test create_spec operation with missing name parameter."""
        params = {"description": "A test spec"}

        with pytest.raises(ValueError, match="Missing required parameter: name"):
            await queue_processor.handle_create_spec(params)

    @pytest.mark.asyncio
    async def test_handle_set_current_spec(self, queue_processor, mock_spec_manager):
        """Test handling set_current_spec operation."""
        # Setup mock
        mock_spec_manager.set_current_specification.return_value = True

        # Test operation
        params = {"specId": "test-spec"}
        result = await queue_processor.handle_set_current_spec(params)

        # Verify result
        assert result["message"] == "Current specification set to 'test-spec'"
        assert result["data"]["specId"] == "test-spec"

        # Verify spec_manager was called correctly
        mock_spec_manager.set_current_specification.assert_called_once_with("test-spec")

    @pytest.mark.asyncio
    async def test_handle_set_current_spec_failure(
        self, queue_processor, mock_spec_manager
    ):
        """Test set_current_spec operation failure."""
        # Setup mock to return False (failure)
        mock_spec_manager.set_current_specification.return_value = False

        params = {"specId": "nonexistent-spec"}

        with pytest.raises(ValueError, match="Failed to set current specification"):
            await queue_processor.handle_set_current_spec(params)

    @pytest.mark.asyncio
    async def test_update_operation_status(self, queue_processor):
        """Test updating operation status."""
        # Create test operation
        test_operation = Operation(
            id="test-op-123",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc),
            status=OperationStatus.PENDING,
        )
        test_queue = OperationQueue(operations=[test_operation])

        # Save initial queue
        await queue_processor.save_operation_queue(test_queue)

        # Update status
        await queue_processor.update_operation_status(
            "test-op-123", OperationStatus.COMPLETED
        )

        # Verify status was updated
        updated_queue = await queue_processor.load_operation_queue()
        assert updated_queue.operations[0].status == OperationStatus.COMPLETED

    @pytest.mark.asyncio
    async def test_write_operation_result(self, queue_processor):
        """Test writing operation results."""
        result = OperationResult(
            operation_id="test-op-123",
            success=True,
            message="Test completed successfully",
            timestamp=datetime.now(timezone.utc),
        )

        await queue_processor.write_operation_result(result)

        # Verify result was written
        assert queue_processor.results_file.exists()

        # Load and verify content
        with open(queue_processor.results_file, "r") as f:
            data = json.load(f)

        assert len(data["results"]) == 1
        assert data["results"][0]["operation_id"] == "test-op-123"
        assert data["results"][0]["success"] is True

    @pytest.mark.asyncio
    async def test_update_sync_state(self, queue_processor, mock_spec_manager):
        """Test updating sync state."""
        # Setup mock specifications
        mock_spec = MagicMock()
        mock_spec.id = "test-spec"
        mock_spec.updated_at = datetime.now(timezone.utc)
        mock_spec_manager.specs = {"test-spec": mock_spec}

        await queue_processor.update_sync_state()

        # Verify sync file was created
        assert queue_processor.sync_file.exists()

        # Load and verify content
        with open(queue_processor.sync_file, "r") as f:
            data = json.load(f)

        assert data["mcp_server_online"] is True
        assert len(data["specifications"]) == 1
        assert data["specifications"][0]["specId"] == "test-spec"

    @pytest.mark.asyncio
    async def test_route_operation_unknown_type(self, queue_processor):
        """Test routing operation with unknown type."""
        # Create operation with valid type first, then modify it
        operation = Operation(
            id="test-op-123",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc),
        )
        # Bypass Pydantic validation by directly setting the type
        operation.type = "unknown_operation"

        with pytest.raises(ValueError, match="Unknown operation type"):
            await queue_processor.route_operation(operation)

    @pytest.mark.asyncio
    async def test_backup_corrupted_file(self, queue_processor, temp_dir):
        """Test backing up corrupted files."""
        # Create a test file
        test_file = temp_dir / "test.json"
        test_file.write_text("corrupted json content")

        await queue_processor.backup_corrupted_file(test_file)

        # Verify original file is gone and backup exists
        assert not test_file.exists()
        backup_files = list(temp_dir.glob("test.corrupted_*.json"))
        assert len(backup_files) == 1

    @pytest.mark.asyncio
    async def test_process_operation_success(self, queue_processor, mock_spec_manager):
        """Test successful operation processing."""
        # Setup mock
        mock_spec = MagicMock()
        mock_spec.id = "test-spec"
        mock_spec.name = "Test Spec"
        mock_spec_manager.create_specification.return_value = mock_spec

        # Create test operation
        operation = Operation(
            id="test-op-123",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc),
            params={"name": "Test Spec"},
        )

        # Process operation
        await queue_processor.process_operation(operation)

        # Verify result was written
        assert queue_processor.results_file.exists()

        with open(queue_processor.results_file, "r") as f:
            data = json.load(f)

        assert len(data["results"]) == 1
        assert data["results"][0]["success"] is True
        assert data["results"][0]["operation_id"] == "test-op-123"

    @pytest.mark.asyncio
    async def test_process_operation_failure_with_retry(
        self, queue_processor, mock_spec_manager
    ):
        """Test operation processing failure with retry logic."""
        # Setup mock to raise exception
        mock_spec_manager.create_specification.side_effect = Exception("Test error")

        # Create test operation with retry capability
        operation = Operation(
            id="test-op-123",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc),
            params={"name": "Test Spec"},
            retry_count=0,
            max_retries=2,
        )

        # Save operation to queue first
        queue = OperationQueue(operations=[operation])
        await queue_processor.save_operation_queue(queue)

        # Process operation (should fail and retry)
        await queue_processor.process_operation(operation)

        # Verify operation was updated with retry count
        updated_queue = await queue_processor.load_operation_queue()
        assert updated_queue.operations[0].retry_count == 1
        assert updated_queue.operations[0].status == OperationStatus.PENDING

    @pytest.mark.asyncio
    async def test_operation_validation(self, queue_processor):
        """Test operation validation functionality."""
        # Test valid operation
        valid_operation = Operation(
            id="test-op-123",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc),
            params={"name": "Test Spec", "description": "Test description"},
        )

        # Should not raise exception
        await queue_processor._validate_operation(valid_operation)

        # Test invalid operation - missing name
        invalid_operation = Operation(
            id="test-op-456",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc),
            params={"description": "Test description"},  # Missing 'name'
        )

        with pytest.raises(
            ValueError, match="create_spec operation requires 'name' parameter"
        ):
            await queue_processor._validate_operation(invalid_operation)

    @pytest.mark.asyncio
    async def test_operation_sanitization(self, queue_processor):
        """Test operation parameter sanitization."""
        operation = Operation(
            id="test-op-123",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc),
            params={
                "name": "  Test Spec  ",  # Should be trimmed
                "specId": "test-spec!@#",  # Should be sanitized
                "description": "Line 1\r\nLine 2\rLine 3",  # Newlines should be normalized
            },
        )

        sanitized_params = await queue_processor._sanitize_operation_params(operation)

        assert sanitized_params["name"] == "Test Spec"
        assert sanitized_params["specId"] == "test-spec"
        assert sanitized_params["description"] == "Line 1\nLine 2\nLine 3"

    @pytest.mark.asyncio
    async def test_idempotency_check(self, queue_processor):
        """Test idempotency checking functionality."""
        # Create a test operation
        operation = Operation(
            id="test-op-123",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc),
            params={"name": "Test Spec", "specId": "test-spec"},
        )

        # Should not be idempotent initially
        is_idempotent = await queue_processor._is_operation_idempotent(operation)
        assert not is_idempotent

        # Create a successful result for the same operation signature
        result = OperationResult(
            operation_id=f"{queue_processor._get_operation_signature(operation)}_123",
            success=True,
            message="Test completed",
            timestamp=datetime.now(timezone.utc),
        )
        await queue_processor.write_operation_result(result)

        # Now should be idempotent
        is_idempotent = await queue_processor._is_operation_idempotent(operation)
        assert is_idempotent

    @pytest.mark.asyncio
    async def test_conflict_detection_duplicate_operations(self, queue_processor):
        """Test conflict detection for duplicate operations."""
        # Create two identical operations
        operation1 = Operation(
            id="test-op-1",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc),
            params={"name": "Test Spec", "specId": "test-spec"},
        )

        operation2 = Operation(
            id="test-op-2",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc) + timedelta(seconds=30),
            params={"name": "Test Spec", "specId": "test-spec"},
        )

        queue = OperationQueue(operations=[operation1, operation2])

        # Detect conflicts for operation2
        conflicts = await queue_processor.detect_operation_conflicts(operation2, queue)

        assert len(conflicts) == 1
        assert conflicts[0].type == ConflictType.DUPLICATE_OPERATION
        assert operation1.id in conflicts[0].operations
        assert operation2.id in conflicts[0].operations

    @pytest.mark.asyncio
    async def test_conflict_detection_concurrent_modifications(self, queue_processor):
        """Test conflict detection for concurrent modifications."""
        # Create operations that modify the same spec
        operation1 = Operation(
            id="test-op-1",
            type=OperationType.UPDATE_REQUIREMENTS,
            timestamp=datetime.now(timezone.utc),
            params={"specId": "test-spec", "content": "Requirements content"},
        )

        operation2 = Operation(
            id="test-op-2",
            type=OperationType.UPDATE_DESIGN,
            timestamp=datetime.now(timezone.utc) + timedelta(minutes=2),
            params={"specId": "test-spec", "content": "Design content"},
        )

        queue = OperationQueue(operations=[operation1, operation2])

        # Detect conflicts for operation2
        conflicts = await queue_processor.detect_operation_conflicts(operation2, queue)

        assert len(conflicts) == 1
        assert conflicts[0].type == ConflictType.CONCURRENT_MODIFICATION

    @pytest.mark.asyncio
    async def test_conflict_automatic_resolution(self, queue_processor):
        """Test automatic conflict resolution."""
        # Create duplicate operations
        operation1 = Operation(
            id="test-op-1",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc),
            params={"name": "Test Spec", "specId": "test-spec"},
            status=OperationStatus.PENDING,
        )

        operation2 = Operation(
            id="test-op-2",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc) + timedelta(seconds=30),
            params={"name": "Test Spec", "specId": "test-spec"},
            status=OperationStatus.PENDING,
        )

        queue = OperationQueue(operations=[operation1, operation2])

        # Detect conflicts
        conflicts = await queue_processor.detect_operation_conflicts(operation2, queue)
        assert len(conflicts) == 1

        # Resolve conflicts automatically
        unresolved = await queue_processor.resolve_conflicts_automatically(
            conflicts, queue
        )

        # Should resolve the duplicate conflict
        assert len(unresolved) == 0
        # Newer operation should be cancelled
        assert operation2.status == OperationStatus.CANCELLED

    @pytest.mark.asyncio
    async def test_error_recovery_corrupted_queue(self, queue_processor):
        """Test recovery from corrupted queue file."""
        # Create a corrupted queue file
        corrupted_content = '{"operations": [{"id": "test", incomplete'
        queue_processor.queue_file.write_text(corrupted_content)

        # Should recover gracefully
        await queue_processor.recover_from_corrupted_queue()

        # Should be able to load queue after recovery
        queue = await queue_processor.load_operation_queue()
        assert isinstance(queue, OperationQueue)

    @pytest.mark.asyncio
    async def test_exponential_backoff_retry(self, queue_processor):
        """Test exponential backoff retry logic."""
        operation = Operation(
            id="test-op-123",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc),
            params={"name": "Test Spec"},
            retry_count=0,
            max_retries=3,
        )

        error = Exception("Test error")

        # Should retry for first few attempts
        should_retry = await queue_processor.implement_exponential_backoff_retry(
            operation, error
        )
        assert should_retry
        assert operation.retry_count == 1

        # Continue retrying
        should_retry = await queue_processor.implement_exponential_backoff_retry(
            operation, error
        )
        assert should_retry
        assert operation.retry_count == 2

        # One more retry
        should_retry = await queue_processor.implement_exponential_backoff_retry(
            operation, error
        )
        assert should_retry
        assert operation.retry_count == 3

        # Should not retry after max attempts
        should_retry = await queue_processor.implement_exponential_backoff_retry(
            operation, error
        )
        assert not should_retry

    @pytest.mark.asyncio
    async def test_cleanup_stale_operations(self, queue_processor):
        """Test cleanup of stale operations."""
        # Create operations with different timestamps
        old_operation = Operation(
            id="old-op",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc)
            - timedelta(hours=25),  # Older than 24h
            status=OperationStatus.COMPLETED,
        )

        recent_operation = Operation(
            id="recent-op",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc) - timedelta(hours=1),
            status=OperationStatus.COMPLETED,
        )

        queue = OperationQueue(operations=[old_operation, recent_operation])
        await queue_processor.save_operation_queue(queue)

        # Run cleanup
        await queue_processor.cleanup_stale_operations()

        # Load queue and verify old operation was removed
        cleaned_queue = await queue_processor.load_operation_queue()
        operation_ids = [op.id for op in cleaned_queue.operations]

        assert "old-op" not in operation_ids
        assert "recent-op" in operation_ids

    @pytest.mark.asyncio
    async def test_diagnostic_report_generation(self, queue_processor):
        """Test diagnostic report generation."""
        # Create some test data
        operation = Operation(
            id="test-op-123",
            type=OperationType.CREATE_SPEC,
            timestamp=datetime.now(timezone.utc),
            params={"name": "Test Spec"},
        )
        queue = OperationQueue(operations=[operation])
        await queue_processor.save_operation_queue(queue)

        # Generate diagnostic report
        report = await queue_processor.generate_diagnostic_report()

        # Verify report structure
        assert "timestamp" in report
        assert "queue_processor" in report
        assert "files" in report
        assert "queue_status" in report
        assert "specifications" in report
        assert "system_info" in report

        # Verify queue status
        assert report["queue_status"]["total_operations"] == 1
        assert report["queue_status"]["pending"] == 1

    @pytest.mark.asyncio
    async def test_workspace_change_handling(self, queue_processor, temp_dir):
        """Test handling of workspace changes."""
        # This test just ensures the method runs without error
        # In a real scenario, it would test directory relocation
        await queue_processor.handle_workspace_changes()

        # Should complete without raising exceptions
        assert queue_processor.project_root.exists()

    @pytest.mark.asyncio
    async def test_file_modification_conflict_detection(
        self, queue_processor, mock_spec_manager, temp_dir
    ):
        """Test detection of file modification conflicts."""
        # Setup a spec directory and file
        spec_id = "test-spec"
        spec_dir = mock_spec_manager.base_dir / spec_id
        spec_dir.mkdir(parents=True, exist_ok=True)

        requirements_file = spec_dir / "requirements.md"
        requirements_file.write_text("Initial requirements")

        # Create operation that was created before file modification
        operation = Operation(
            id="test-op-123",
            type=OperationType.UPDATE_REQUIREMENTS,
            timestamp=datetime.now(timezone.utc)
            - timedelta(minutes=5),  # Before file modification
            params={"specId": spec_id, "content": "Updated requirements"},
        )

        # Modify the file after operation timestamp
        requirements_file.write_text("Externally modified requirements")

        # Check for file modification conflicts
        conflict = await queue_processor._check_file_modification_conflicts(operation)

        assert conflict is not None
        assert conflict.type == ConflictType.VERSION_MISMATCH
        assert "externally" in conflict.description.lower()
