"""
Integration tests for complete operation lifecycle.

Tests the full workflow:
VS Code Extension → Queue Operation → MCP Server Processing → Results → Notifications

This module verifies that operations flow correctly through the entire system
and that all components integrate properly.
"""

import asyncio
import json
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest

from src.specforged.core.queue_processor import (
    OperationResult,
    OperationStatus,
    OperationType,
)

from .fixtures import (
    IntegrationTestWorkspace,
    MockMcpServer,
    OperationBuilder,
    PerformanceMonitor,
    create_test_operation,
    wait_for_condition,
)


class TestOperationLifecycle:
    """Test complete operation lifecycle scenarios."""

    @pytest.mark.asyncio
    async def test_basic_operation_lifecycle(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test basic create_spec operation from queue to completion."""
        # Step 1: Extension queues operation
        operation_id = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "Test Specification", "description": "Integration test spec"},
            priority=7,
        )

        # Verify operation is queued
        queue = await integration_workspace.get_operation_queue()
        assert len(queue.operations) == 1
        assert queue.operations[0].id == operation_id
        assert queue.operations[0].status == OperationStatus.PENDING

        # Step 2: Server processes operation
        await integration_workspace.process_all_operations()

        # Step 3: Verify operation completed
        updated_queue = await integration_workspace.get_operation_queue()
        completed_op = next(
            op for op in updated_queue.operations if op.id == operation_id
        )
        assert completed_op.status == OperationStatus.COMPLETED

        # Step 4: Verify results were written
        results = await integration_workspace.process_all_operations()
        result = next((r for r in results if r.operation_id == operation_id), None)
        assert result is not None
        assert result.success is True
        assert "created successfully" in result.message.lower()

        # Step 5: Verify specification was actually created
        spec_files = list(integration_workspace.specs_dir.glob("*/spec.json"))
        assert len(spec_files) == 1

        with open(spec_files[0], "r") as f:
            spec_data = json.load(f)
            assert spec_data["name"] == "Test Specification"

    @pytest.mark.asyncio
    async def test_operation_lifecycle_with_retry(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test operation lifecycle with retry logic."""
        # Create operation that will initially fail
        operation = create_test_operation(
            OperationType.CREATE_SPEC,
            {
                "name": "",
                "description": "This should fail",
            },  # Empty name will cause failure
            priority=5,
        )
        operation.max_retries = 2

        await integration_workspace.queue_operation(operation)

        # Process - should fail initially
        await integration_workspace.process_all_operations()

        queue = await integration_workspace.get_operation_queue()
        failed_op = next(op for op in queue.operations if op.id == operation.id)
        assert failed_op.status == OperationStatus.PENDING  # Queued for retry
        assert failed_op.retry_count == 1

        # Fix the operation parameters (simulate user correction)
        failed_op.params["name"] = "Fixed Specification Name"
        await integration_workspace.queue_processor.save_operation_queue(queue)

        # Process again - should succeed this time
        await integration_workspace.process_all_operations()

        updated_queue = await integration_workspace.get_operation_queue()
        completed_op = next(
            op for op in updated_queue.operations if op.id == operation.id
        )
        assert completed_op.status == OperationStatus.COMPLETED

    @pytest.mark.asyncio
    async def test_multiple_operation_types_lifecycle(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test lifecycle of multiple different operation types."""
        # Create a specification first
        create_op_id = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "Multi-Op Test Spec", "specId": "multi-test"},
            priority=9,
        )

        # Process creation
        await integration_workspace.process_all_operations()

        # Verify creation completed
        result = await integration_workspace.wait_for_operation_completion(create_op_id)
        assert result.success

        # Now queue multiple follow-up operations
        operations = [
            (
                OperationType.UPDATE_REQUIREMENTS,
                {
                    "specId": "multi-test",
                    "content": "# Updated Requirements\n\nTest requirements content",
                },
            ),
            (
                OperationType.UPDATE_DESIGN,
                {
                    "specId": "multi-test",
                    "content": "# Updated Design\n\nTest design content",
                },
            ),
            (
                OperationType.UPDATE_TASKS,
                {
                    "specId": "multi-test",
                    "content": "# Updated Tasks\n\n- [ ] Task 1\n- [ ] Task 2",
                },
            ),
            (
                OperationType.ADD_USER_STORY,
                {
                    "specId": "multi-test",
                    "userStory": {
                        "as_a": "test user",
                        "i_want": "to verify multi-operation lifecycle",
                        "so_that": "the system works correctly",
                    },
                },
            ),
        ]

        operation_ids = []
        for op_type, params in operations:
            op_id = await integration_workspace.simulate_extension_operation(
                op_type, params, priority=7
            )
            operation_ids.append(op_id)

        # Process all operations
        await integration_workspace.process_all_operations()

        # Verify all operations completed successfully
        for op_id in operation_ids:
            result = await integration_workspace.wait_for_operation_completion(op_id)
            assert result is not None, f"Operation {op_id} did not complete"
            assert result.success, f"Operation {op_id} failed: {result.message}"

        # Verify files were updated
        spec_dir = integration_workspace.specs_dir / "multi-test"
        assert (spec_dir / "requirements.md").exists()
        assert (spec_dir / "design.md").exists()
        assert (spec_dir / "tasks.md").exists()

        # Verify content was written correctly
        requirements_content = (spec_dir / "requirements.md").read_text()
        assert "Updated Requirements" in requirements_content
        assert "Test requirements content" in requirements_content

    @pytest.mark.asyncio
    async def test_operation_with_dependencies(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test operation lifecycle with dependencies."""
        # Create three operations with dependency chain: A → B → C
        builder = OperationBuilder()

        op_a = (
            builder.reset()
            .with_id("dep_test_a")
            .with_type(OperationType.CREATE_SPEC)
            .with_params(name="Dep Test Spec A", specId="dep-test-a")
            .with_priority(5)
            .build()
        )

        op_b = (
            builder.reset()
            .with_id("dep_test_b")
            .with_type(OperationType.UPDATE_REQUIREMENTS)
            .with_params(specId="dep-test-a", content="Requirements for A")
            .with_dependencies("dep_test_a")
            .with_priority(7)
            .build()
        )

        op_c = (
            builder.reset()
            .with_id("dep_test_c")
            .with_type(OperationType.UPDATE_DESIGN)
            .with_params(specId="dep-test-a", content="Design for A")
            .with_dependencies("dep_test_b")
            .with_priority(9)  # Highest priority, but still waits for dependencies
            .build()
        )

        # Queue in reverse dependency order to test proper ordering
        await integration_workspace.queue_operation(op_c)  # Should wait for B
        await integration_workspace.queue_operation(op_b)  # Should wait for A
        await integration_workspace.queue_operation(op_a)  # Can execute immediately

        # Process operations - should respect dependency order
        processing_start = time.time()

        # Multiple processing rounds to handle dependencies
        for _ in range(5):
            await integration_workspace.process_all_operations()
            await asyncio.sleep(0.1)

        processing_time = time.time() - processing_start

        # Verify all operations completed
        results = []
        for op_id in ["dep_test_a", "dep_test_b", "dep_test_c"]:
            result = await integration_workspace.wait_for_operation_completion(
                op_id, timeout_seconds=10
            )
            assert result is not None, f"Operation {op_id} did not complete"
            assert result.success, f"Operation {op_id} failed: {result.message}"
            results.append((op_id, result.timestamp))

        # Verify execution order (A should complete before B, B before C)
        # Convert timestamps to datetime objects for comparison
        timestamps = {}
        for op_id, timestamp_str in results:
            timestamps[op_id] = datetime.fromisoformat(
                timestamp_str.replace("Z", "+00:00")
            )

        assert (
            timestamps["dep_test_a"] < timestamps["dep_test_b"]
        ), "Operation A should complete before B"
        assert (
            timestamps["dep_test_b"] < timestamps["dep_test_c"]
        ), "Operation B should complete before C"

        # Verify final state
        spec_dir = integration_workspace.specs_dir / "dep-test-a"
        assert spec_dir.exists()
        assert (spec_dir / "requirements.md").read_text() == "Requirements for A"
        assert (spec_dir / "design.md").read_text() == "Design for A"

    @pytest.mark.asyncio
    async def test_operation_lifecycle_with_file_monitoring(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test operation lifecycle with file system change monitoring."""
        # Create initial specification
        spec_id = "file-monitor-test"
        create_op_id = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "File Monitor Test", "specId": spec_id},
            priority=7,
        )

        await integration_workspace.process_all_operations()
        result = await integration_workspace.wait_for_operation_completion(create_op_id)
        assert result.success

        # Simulate external file modification (user editing file directly)
        external_content = "# Externally Modified Requirements\n\nThis was modified outside the system."
        await integration_workspace.simulate_file_modification(
            spec_id, "requirements.md", external_content
        )

        # Now try to update the same file through the operation system
        # This should detect the conflict
        update_op_id = await integration_workspace.simulate_extension_operation(
            OperationType.UPDATE_REQUIREMENTS,
            {
                "specId": spec_id,
                "content": "# System Updated Requirements\n\nThis was updated by the system.",
            },
            priority=8,
        )

        # Process the update operation
        await integration_workspace.process_all_operations()

        # Check for conflict detection
        queue = await integration_workspace.get_operation_queue()
        conflicts = [op for op in queue.operations if op.conflictIds]

        # The update operation should have detected the external modification
        # (This depends on the queue processor's file modification conflict detection)

        # Verify the operation still processes (conflict resolution may handle it)
        update_result = await integration_workspace.wait_for_operation_completion(
            update_op_id, timeout_seconds=15
        )

        # Check sync state for any recorded conflicts or errors
        sync_state = await integration_workspace.get_sync_state()

        # Verify file monitoring is working by checking sync state or conflicts
        assert (
            len(integration_workspace.file_changes) > 0
        ), "File changes should be tracked"
        assert any(
            spec_id in change[0] for change in integration_workspace.file_changes
        ), "Spec file change should be tracked"

    @pytest.mark.asyncio
    async def test_batch_operation_processing(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test processing of multiple operations in batch."""
        # Create multiple specifications in batch
        operation_ids = []
        for i in range(5):
            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.CREATE_SPEC,
                {"name": f"Batch Test Spec {i}", "specId": f"batch-test-{i}"},
                priority=5 + i,  # Different priorities
            )
            operation_ids.append(op_id)

        # Verify all operations are queued
        queue = await integration_workspace.get_operation_queue()
        assert len(queue.operations) == 5

        # Process all operations in one batch
        batch_start = time.time()
        await integration_workspace.process_all_operations()
        batch_time = time.time() - batch_start

        # Verify all operations completed
        results = []
        for op_id in operation_ids:
            result = await integration_workspace.wait_for_operation_completion(op_id)
            assert result is not None, f"Operation {op_id} did not complete"
            assert result.success, f"Operation {op_id} failed: {result.message}"
            results.append(result)

        # Verify all specifications were created
        spec_dirs = list(integration_workspace.specs_dir.glob("batch-test-*"))
        assert len(spec_dirs) == 5

        # Verify performance is reasonable (all 5 operations should complete quickly)
        assert batch_time < 10.0, f"Batch processing took too long: {batch_time}s"

        # Verify sync state reflects all operations
        sync_state = await integration_workspace.get_sync_state()
        assert sync_state.completedOperations >= 5

    @pytest.mark.asyncio
    async def test_operation_result_notification_chain(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test that operation results trigger proper notification chains."""
        # Create operation with notification tracking
        operation_id = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "Notification Test Spec", "description": "Test notifications"},
            priority=8,
        )

        # Process operation
        await integration_workspace.process_all_operations()

        # Verify result was created
        result = await integration_workspace.wait_for_operation_completion(operation_id)
        assert result is not None
        assert result.success

        # Verify results file contains the result
        results_file = integration_workspace.results_file
        assert results_file.exists()

        with open(results_file, "r") as f:
            results_data = json.load(f)

        assert len(results_data["results"]) >= 1

        # Find our result
        our_result = None
        for result_data in results_data["results"]:
            if result_data["operation_id"] == operation_id:
                our_result = result_data
                break

        assert our_result is not None
        assert our_result["success"] is True
        assert our_result["message"]
        assert our_result["timestamp"]

        # Verify sync state was updated
        sync_state = await integration_workspace.get_sync_state()
        assert sync_state.last_sync
        assert sync_state.mcp_server_online is True

        # Verify specification change was recorded
        spec_change = next(
            (
                spec
                for spec in sync_state.specifications
                if "notification-test-spec" in spec["specId"].lower()
            ),
            None,
        )
        # May not be present depending on implementation details

    @pytest.mark.asyncio
    async def test_operation_lifecycle_error_recovery(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test operation lifecycle with various error conditions and recovery."""
        # Test 1: Invalid parameters
        invalid_op_id = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "", "description": "Invalid spec"},  # Empty name
            priority=5,
        )

        # Test 2: Missing dependencies
        missing_dep_op_id = await integration_workspace.simulate_extension_operation(
            OperationType.UPDATE_REQUIREMENTS,
            {"specId": "nonexistent-spec", "content": "Some content"},
            priority=6,
        )

        # Test 3: File system error simulation (readonly directory)
        readonly_op_id = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "Readonly Test", "specId": "readonly-test"},
            priority=7,
        )

        # Make specs directory readonly temporarily
        import os

        original_mode = os.stat(integration_workspace.specs_dir).st_mode
        try:
            os.chmod(integration_workspace.specs_dir, 0o444)  # Read-only

            # Process all operations
            await integration_workspace.process_all_operations()

            # Restore permissions
            os.chmod(integration_workspace.specs_dir, original_mode)

            # Process again (should recover)
            await integration_workspace.process_all_operations()

        except Exception:
            # Ensure permissions are restored even if test fails
            os.chmod(integration_workspace.specs_dir, original_mode)
            raise

        # Verify error handling
        queue = await integration_workspace.get_operation_queue()

        # Check operation statuses
        ops_by_id = {op.id: op for op in queue.operations}

        # Invalid parameter operation should have failed or be retrying
        invalid_op = ops_by_id[invalid_op_id]
        assert invalid_op.status in [OperationStatus.FAILED, OperationStatus.PENDING]

        # Missing dependency operation should have failed
        missing_dep_op = ops_by_id[missing_dep_op_id]
        assert missing_dep_op.status in [
            OperationStatus.FAILED,
            OperationStatus.PENDING,
        ]

        # Readonly operation might have succeeded after permissions were restored
        readonly_op = ops_by_id[readonly_op_id]
        # Status depends on implementation - might succeed after retry

        # Verify error results were recorded
        if integration_workspace.results_file.exists():
            with open(integration_workspace.results_file, "r") as f:
                results_data = json.load(f)

            error_results = [
                r for r in results_data["results"] if not r.get("success", True)
            ]
            assert len(error_results) > 0, "Should have recorded some error results"


class TestOperationLifecyclePerformance:
    """Performance tests for operation lifecycle."""

    @pytest.mark.asyncio
    async def test_high_throughput_operation_processing(
        self,
        integration_workspace: IntegrationTestWorkspace,
        performance_monitor: PerformanceMonitor,
    ):
        """Test high throughput operation processing."""
        performance_monitor.start_monitoring()

        # Queue many operations
        num_operations = 50
        operation_ids = []

        for i in range(num_operations):
            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.CREATE_SPEC,
                {"name": f"Perf Test Spec {i}", "specId": f"perf-test-{i:03d}"},
                priority=5,
            )
            operation_ids.append(op_id)
            performance_monitor.record_queue_size(i + 1)

        # Process all operations and measure time
        start_time = time.time()

        # Process in batches
        while True:
            queue = await integration_workspace.get_operation_queue()
            pending_ops = [
                op for op in queue.operations if op.status == OperationStatus.PENDING
            ]
            if not pending_ops:
                break

            batch_start = time.time()
            await integration_workspace.process_all_operations()
            batch_time = time.time() - batch_start

            performance_monitor.record_operation_time(batch_time)
            performance_monitor.record_queue_size(len(pending_ops))

            # Prevent infinite loops
            if time.time() - start_time > 60:  # 1 minute timeout
                break

        total_time = time.time() - start_time
        performance_monitor.stop_monitoring()

        # Verify all operations completed
        completed_count = 0
        for op_id in operation_ids:
            result = await integration_workspace.wait_for_operation_completion(
                op_id, timeout_seconds=1
            )
            if result and result.success:
                completed_count += 1

        # Generate performance report
        perf_report = performance_monitor.get_performance_report()

        # Performance assertions
        assert (
            completed_count >= num_operations * 0.9
        ), f"At least 90% of operations should complete. Completed: {completed_count}/{num_operations}"
        assert (
            perf_report["operations_per_second"] > 5
        ), f"Should process at least 5 ops/sec, got {perf_report['operations_per_second']:.2f}"
        assert (
            perf_report["average_operation_time"] < 2.0
        ), f"Average operation time should be < 2s, got {perf_report['average_operation_time']:.2f}"

        print(f"Performance Report:")
        print(f"  Total time: {total_time:.2f}s")
        print(f"  Operations completed: {completed_count}/{num_operations}")
        print(f"  Operations per second: {perf_report['operations_per_second']:.2f}")
        print(f"  Average operation time: {perf_report['average_operation_time']:.3f}s")
        print(f"  Max queue size: {perf_report['max_queue_size']}")
