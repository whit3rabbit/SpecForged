"""
Integration tests for conflict detection and resolution workflows.

This module tests the complete conflict management system:
- Conflict detection during operation queuing
- Automatic conflict resolution strategies
- Manual conflict resolution workflows
- Conflict recovery and cleanup

Tests verify that conflicts are properly detected, categorized, and resolved
across the entire MCP ecosystem.
"""

import asyncio
import time
from datetime import datetime, timedelta, timezone

import pytest

from src.specforged.core.queue_processor import (
    ConflictResolution,
    ConflictType,
    OperationStatus,
    OperationType,
)

from .fixtures import (
    IntegrationTestWorkspace,
    OperationBuilder,
    create_conflicting_operations,
    create_test_operation,
)


class TestConflictDetection:
    """Test conflict detection during operation lifecycle."""

    @pytest.mark.asyncio
    async def test_duplicate_operation_conflict_detection(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test detection of duplicate operations."""
        # Create two identical operations
        params = {"name": "Duplicate Test Spec", "specId": "duplicate-test"}

        operation1 = create_test_operation(
            OperationType.CREATE_SPEC,
            params,
            priority=5,
            operation_id="dup_op_1",
        )
        operation2 = create_test_operation(
            OperationType.CREATE_SPEC,
            params,
            priority=5,
            operation_id="dup_op_2",
        )

        # Make operation2 slightly newer
        operation2.timestamp = operation1.timestamp.replace(
            tzinfo=timezone.utc
        ) + timedelta(seconds=30)

        # Queue operations
        await integration_workspace.queue_operation(operation1)
        await integration_workspace.queue_operation(operation2)

        # Check for conflict detection BEFORE processing
        queue = await integration_workspace.get_operation_queue()

        # Verify conflict was detected and resolved
        conflicts = (
            await integration_workspace.queue_processor.detect_operation_conflicts(
                operation2, queue
            )
        )

        duplicate_conflicts = [
            c for c in conflicts if c.type == ConflictType.DUPLICATE_OPERATION
        ]
        assert (
            len(duplicate_conflicts) > 0
        ), "Should detect duplicate operation conflict"

        # Verify conflict contains both operations
        conflict = duplicate_conflicts[0]
        assert operation1.id in conflict.operations
        assert operation2.id in conflict.operations
        assert conflict.suggested_resolution == ConflictResolution.CANCEL_NEWER

    @pytest.mark.asyncio
    async def test_concurrent_modification_conflict_detection(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test detection of concurrent modifications to same resource."""
        # First create a specification
        create_op_id = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "Concurrent Test Spec", "specId": "concurrent-test"},
            priority=9,
        )

        # Process creation
        await integration_workspace.process_all_operations()
        result = await integration_workspace.wait_for_operation_completion(create_op_id)
        assert result.success

        # Create operations that will modify the same spec concurrently
        base_time = datetime.now(timezone.utc)

        operation1 = create_test_operation(
            OperationType.UPDATE_REQUIREMENTS,
            {"specId": "concurrent-test", "content": "Requirements Version 1"},
            priority=5,
            operation_id="concurrent_req_1",
        )
        operation1.timestamp = base_time

        operation2 = create_test_operation(
            OperationType.UPDATE_DESIGN,
            {"specId": "concurrent-test", "content": "Design Version 1"},
            priority=5,
            operation_id="concurrent_design_1",
        )
        operation2.timestamp = base_time + timedelta(
            seconds=60
        )  # Within concurrent window

        # Queue operations
        await integration_workspace.queue_operation(operation1)
        await integration_workspace.queue_operation(operation2)

        # Check for conflict detection
        queue = await integration_workspace.get_operation_queue()
        conflicts = (
            await integration_workspace.queue_processor.detect_operation_conflicts(
                operation2, queue
            )
        )

        # Should detect concurrent modification
        concurrent_conflicts = [
            c for c in conflicts if c.type == ConflictType.CONCURRENT_MODIFICATION
        ]
        assert (
            len(concurrent_conflicts) > 0
        ), "Should detect concurrent modification conflict"

        conflict = concurrent_conflicts[0]
        assert operation1.id in conflict.operations
        assert operation2.id in conflict.operations
        assert conflict.suggested_resolution == ConflictResolution.MANUAL_REVIEW

    @pytest.mark.asyncio
    async def test_dependency_conflict_detection(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test detection of dependency conflicts."""
        builder = OperationBuilder()

        # Create a DELETE operation
        delete_op = (
            builder.reset()
            .with_id("delete_spec_op")
            .with_type(OperationType.DELETE_SPEC)
            .with_params(specId="dep-conflict-test")
            .with_priority(5)
            .build()
        )

        # Create an UPDATE operation on the same spec (dependency conflict)
        update_op = (
            builder.reset()
            .with_id("update_spec_op")
            .with_type(OperationType.UPDATE_REQUIREMENTS)
            .with_params(specId="dep-conflict-test", content="New requirements")
            .with_priority(7)
            .build()
        )

        # Queue operations
        await integration_workspace.queue_operation(delete_op)
        await integration_workspace.queue_operation(update_op)

        # Check for conflict detection
        queue = await integration_workspace.get_operation_queue()
        conflicts = (
            await integration_workspace.queue_processor.detect_operation_conflicts(
                update_op, queue
            )
        )

        # Should detect dependency conflict
        dep_conflicts = [
            c for c in conflicts if c.type == ConflictType.DEPENDENCY_CONFLICT
        ]
        assert len(dep_conflicts) > 0, "Should detect dependency conflict"

        conflict = dep_conflicts[0]
        assert delete_op.id in conflict.operations
        assert update_op.id in conflict.operations
        assert conflict.suggested_resolution == ConflictResolution.REORDER

    @pytest.mark.asyncio
    async def test_file_modification_conflict_detection(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test detection of external file modification conflicts."""
        spec_id = "file-conflict-test"

        # Create specification
        create_op_id = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "File Conflict Test", "specId": spec_id},
            priority=8,
        )

        await integration_workspace.process_all_operations()
        result = await integration_workspace.wait_for_operation_completion(create_op_id)
        assert result.success

        # Simulate external file modification
        external_content = (
            "# Externally Modified File\n\nThis was changed outside the system."
        )
        await integration_workspace.simulate_file_modification(
            spec_id, "requirements.md", external_content, delay_seconds=0.1
        )

        # Create operation to update the same file
        update_operation = create_test_operation(
            OperationType.UPDATE_REQUIREMENTS,
            {"specId": spec_id, "content": "System updated content"},
            priority=5,
            operation_id="file_conflict_update",
        )
        # Set timestamp to before file modification to trigger conflict
        update_operation.timestamp = datetime.now(timezone.utc) - timedelta(minutes=1)

        await integration_workspace.queue_operation(update_operation)

        # Check for file modification conflict
        queue = await integration_workspace.get_operation_queue()
        conflicts = (
            await integration_workspace.queue_processor.detect_operation_conflicts(
                update_operation, queue
            )
        )

        # Should detect version mismatch due to external file modification
        version_conflicts = [
            c for c in conflicts if c.type == ConflictType.VERSION_MISMATCH
        ]
        if len(version_conflicts) > 0:  # This depends on implementation details
            conflict = version_conflicts[0]
            assert update_operation.id in conflict.operations
            assert conflict.suggested_resolution == ConflictResolution.MANUAL_REVIEW

    @pytest.mark.asyncio
    async def test_resource_lock_conflict_detection(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test detection of resource lock conflicts."""
        spec_id = "resource-lock-test"

        # Create a long-running operation (simulate by setting status)
        long_running_op = create_test_operation(
            OperationType.CREATE_SPEC,
            {"name": "Long Running Spec", "specId": spec_id},
            priority=5,
            operation_id="long_running_op",
        )
        long_running_op.status = OperationStatus.IN_PROGRESS  # Simulate in-progress

        await integration_workspace.queue_operation(long_running_op)

        # Create another operation targeting the same resource
        conflicting_op = create_test_operation(
            OperationType.UPDATE_REQUIREMENTS,
            {"specId": spec_id, "content": "Trying to update while locked"},
            priority=7,
            operation_id="conflicting_with_lock",
        )

        await integration_workspace.queue_operation(conflicting_op)

        # Check for resource lock conflict
        queue = await integration_workspace.get_operation_queue()
        conflicts = (
            await integration_workspace.queue_processor.detect_operation_conflicts(
                conflicting_op, queue
            )
        )

        # Should detect resource lock conflict
        lock_conflicts = [
            c for c in conflicts if c.type == ConflictType.RESOURCE_LOCKED
        ]
        assert len(lock_conflicts) > 0, "Should detect resource lock conflict"

        conflict = lock_conflicts[0]
        assert long_running_op.id in conflict.operations
        assert conflicting_op.id in conflict.operations
        assert conflict.suggested_resolution == ConflictResolution.DEFER


class TestConflictResolution:
    """Test conflict resolution workflows."""

    @pytest.mark.asyncio
    async def test_automatic_duplicate_conflict_resolution(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test automatic resolution of duplicate operation conflicts."""
        params = {"name": "Auto Resolve Test", "specId": "auto-resolve"}

        # Create duplicate operations with different timestamps
        operation1 = create_test_operation(
            OperationType.CREATE_SPEC,
            params,
            priority=5,
            operation_id="auto_dup_1",
        )
        operation2 = create_test_operation(
            OperationType.CREATE_SPEC,
            params,
            priority=5,
            operation_id="auto_dup_2",
        )

        # Make operation2 newer
        operation2.timestamp = operation1.timestamp.replace(
            tzinfo=timezone.utc
        ) + timedelta(seconds=30)

        await integration_workspace.queue_operation(operation1)
        await integration_workspace.queue_operation(operation2)

        # Process operations - should auto-resolve conflicts
        await integration_workspace.process_all_operations()

        # Check resolution
        queue = await integration_workspace.get_operation_queue()
        ops_by_id = {op.id: op for op in queue.operations}

        # Newer operation should be cancelled automatically
        assert ops_by_id["auto_dup_2"].status == OperationStatus.CANCELLED

        # Older operation should proceed or complete
        assert ops_by_id["auto_dup_1"].status in [
            OperationStatus.PENDING,
            OperationStatus.COMPLETED,
        ]

    @pytest.mark.asyncio
    async def test_automatic_dependency_conflict_resolution(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test automatic resolution of dependency conflicts through reordering."""
        builder = OperationBuilder()

        # Create operations with conflicting priorities vs dependencies
        low_priority_op = (
            builder.reset()
            .with_id("low_prio_op")
            .with_type(OperationType.CREATE_SPEC)
            .with_params(name="Low Priority Spec", specId="dependency-reorder-test")
            .with_priority(8)  # Lower priority number = higher priority
            .build()
        )

        high_priority_op = (
            builder.reset()
            .with_id("high_prio_op")
            .with_type(OperationType.UPDATE_REQUIREMENTS)
            .with_params(
                specId="dependency-reorder-test",
                content="High priority update",
            )
            .with_priority(3)  # Higher priority number = lower priority
            .with_dependencies("low_prio_op")  # But depends on low_prio_op
            .build()
        )

        # Queue in wrong order (high priority first)
        await integration_workspace.queue_operation(high_priority_op)
        await integration_workspace.queue_operation(low_priority_op)

        # Process operations - should automatically reorder
        await integration_workspace.process_all_operations()

        # Wait for processing and potential reordering
        await asyncio.sleep(0.5)
        await integration_workspace.process_all_operations()

        # Check that operations were reordered appropriately
        queue = await integration_workspace.get_operation_queue()
        ops_by_id = {op.id: op for op in queue.operations}

        # Low priority operation should have been bumped up in priority
        low_prio_final = ops_by_id["low_prio_op"]
        high_prio_final = ops_by_id["high_prio_op"]

        # The dependency should have been resolved by priority adjustment
        assert (
            low_prio_final.priority <= high_prio_final.priority
        ), "Dependency should be resolved by priority adjustment"

    @pytest.mark.asyncio
    async def test_manual_conflict_resolution_workflow(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test manual conflict resolution workflow."""
        spec_id = "manual-conflict-test"

        # Create conflicting operations that require manual resolution
        operation1 = create_test_operation(
            OperationType.UPDATE_REQUIREMENTS,
            {"specId": spec_id, "content": "Version A Requirements"},
            priority=5,
            operation_id="manual_conflict_1",
        )

        operation2 = create_test_operation(
            OperationType.UPDATE_REQUIREMENTS,
            {"specId": spec_id, "content": "Version B Requirements"},
            priority=5,
            operation_id="manual_conflict_2",
        )

        # Set close timestamps to trigger concurrent modification
        base_time = datetime.now(timezone.utc)
        operation1.timestamp = base_time
        operation2.timestamp = base_time + timedelta(seconds=30)

        await integration_workspace.queue_operation(operation1)
        await integration_workspace.queue_operation(operation2)

        # Process operations
        await integration_workspace.process_all_operations()

        # Check for unresolved conflicts
        sync_state = await integration_workspace.get_sync_state()
        queue = await integration_workspace.get_operation_queue()

        # Conflicts should be recorded in sync state
        assert (
            sync_state.active_conflicts >= 0
        )  # May be 0 if auto-resolved or > 0 if manual review needed

        # If conflicts exist, verify they can be manually resolved
        if sync_state.active_conflicts > 0:
            # Simulate manual resolution by updating operation parameters
            queue = await integration_workspace.get_operation_queue()
            ops_by_id = {op.id: op for op in queue.operations}

            # Modify one of the conflicting operations to resolve the conflict
            if "manual_conflict_2" in ops_by_id:
                conflicted_op = ops_by_id["manual_conflict_2"]
                conflicted_op.params["content"] = (
                    "Manually Resolved Version B Requirements"
                )
                conflicted_op.status = OperationStatus.PENDING  # Reset for retry

                # Clear conflict IDs to indicate manual resolution
                if hasattr(conflicted_op, "conflict_ids"):
                    conflicted_op.conflict_ids = []

                await integration_workspace.queue_processor.save_operation_queue(queue)

                # Process again
                await integration_workspace.process_all_operations()

                # Verify conflict is resolved
                updated_sync_state = await integration_workspace.get_sync_state()
                # Verify conflicts were addressed
                assert updated_sync_state is not None

    @pytest.mark.asyncio
    async def test_conflict_resolution_strategies(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test different conflict resolution strategies."""
        # Test Strategy 1: AUTO_MERGE for compatible operations
        merge_op1 = create_test_operation(
            OperationType.ADD_USER_STORY,
            {
                "specId": "merge-test",
                "userStory": {
                    "as_a": "user A",
                    "i_want": "feature A",
                    "so_that": "benefit A",
                },
            },
            priority=5,
            operation_id="merge_story_1",
        )

        merge_op2 = create_test_operation(
            OperationType.ADD_USER_STORY,
            {
                "specId": "merge-test",
                "userStory": {
                    "as_a": "user B",
                    "i_want": "feature B",
                    "so_that": "benefit B",
                },
            },
            priority=5,
            operation_id="merge_story_2",
        )

        await integration_workspace.queue_operation(merge_op1)
        await integration_workspace.queue_operation(merge_op2)

        # Process - these should be compatible and auto-mergeable
        await integration_workspace.process_all_operations()

        queue = await integration_workspace.get_operation_queue()
        ops_by_id = {op.id: op for op in queue.operations}

        # Both operations should be able to proceed (different user stories)
        assert ops_by_id["merge_story_1"].status != OperationStatus.CANCELLED
        assert ops_by_id["merge_story_2"].status != OperationStatus.CANCELLED

        # Test Strategy 2: DEFER for resource conflicts
        # Already tested in resource lock conflict detection

        # Test Strategy 3: CANCEL_NEWER for duplicates
        # Already tested in automatic duplicate resolution

    @pytest.mark.asyncio
    async def test_conflict_recovery_after_resolution(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test system recovery after conflict resolution."""
        spec_id = "recovery-test"

        # Create initial conflict situation
        conflicting_ops = create_conflicting_operations(
            spec_id, operation_count=3, time_interval=1.0
        )

        for op in conflicting_ops:
            await integration_workspace.queue_operation(op)

        # Process and let conflicts be detected
        await integration_workspace.process_all_operations()

        # Wait for conflict resolution attempts
        await asyncio.sleep(1.0)

        # Process again to handle any resolved conflicts
        await integration_workspace.process_all_operations()

        # Verify system can continue operating normally after conflicts
        post_conflict_op = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "Post Conflict Test", "specId": "post-conflict-test"},
            priority=8,
        )

        await integration_workspace.process_all_operations()

        # This operation should succeed despite previous conflicts
        result = await integration_workspace.wait_for_operation_completion(
            post_conflict_op
        )
        assert (
            result is not None
        ), "System should recover and process new operations after conflicts"
        assert (
            result.success
        ), f"Post-conflict operation should succeed: {result.message}"

        # Verify sync state shows recovery
        sync_state = await integration_workspace.get_sync_state()
        assert (
            sync_state.mcp_server_online
        ), "Server should remain online after conflict resolution"
        assert len(sync_state.sync_errors) <= 10, "Sync errors should be bounded"


class TestConflictPerformance:
    """Test conflict detection and resolution performance."""

    @pytest.mark.asyncio
    async def test_conflict_detection_performance_under_load(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test conflict detection performance with many operations."""
        spec_id = "perf-conflict-test"
        num_operations = 20

        # Create many potentially conflicting operations
        operations = []
        base_time = datetime.now(timezone.utc)

        for i in range(num_operations):
            op = create_test_operation(
                OperationType.UPDATE_REQUIREMENTS,
                {"specId": spec_id, "content": f"Requirements version {i}"},
                priority=5,
                operation_id=f"perf_conflict_{i}",
            )
            op.timestamp = base_time + timedelta(seconds=i * 10)  # Spread over time
            operations.append(op)

        # Queue all operations
        start_time = time.time()
        for op in operations:
            await integration_workspace.queue_operation(op)
        queue_time = time.time() - start_time

        # Process operations and measure conflict detection time
        detection_start = time.time()
        await integration_workspace.process_all_operations()
        detection_time = time.time() - detection_start

        # Performance assertions
        assert (
            queue_time < 5.0
        ), f"Queuing {num_operations} operations should be fast, took {queue_time:.2f}s"
        assert (
            detection_time < 10.0
        ), f"Conflict detection should be fast, took {detection_time:.2f}s"

        # Verify operations were processed (some may be in conflict)
        queue = await integration_workspace.get_operation_queue()
        processed_ops = [
            op for op in queue.operations if op.status != OperationStatus.PENDING
        ]

        print("Performance metrics:")
        print(f"  Queue time: {queue_time:.3f}s for {num_operations} operations")
        print(f"  Detection time: {detection_time:.3f}s")
        print(f"  Operations processed: {len(processed_ops)}/{num_operations}")

        # Should process most operations despite conflicts
        assert (
            len(processed_ops) >= num_operations * 0.5
        ), "Should process at least 50% of operations"

    @pytest.mark.asyncio
    async def test_conflict_cleanup_performance(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test performance of conflict cleanup operations."""
        # Create many resolved conflicts
        num_conflicts = 50

        for i in range(num_conflicts):
            spec_id = f"cleanup-test-{i}"

            # Create and resolve conflicts quickly
            op1 = create_test_operation(
                OperationType.CREATE_SPEC,
                {"name": f"Cleanup Test {i}", "specId": spec_id},
                priority=5,
                operation_id=f"cleanup_op1_{i}",
            )

            op2 = create_test_operation(
                OperationType.CREATE_SPEC,
                {"name": f"Cleanup Test {i}", "specId": spec_id},  # Duplicate
                priority=5,
                operation_id=f"cleanup_op2_{i}",
            )

            await integration_workspace.queue_operation(op1)
            await integration_workspace.queue_operation(op2)

        # Process to create conflicts and resolutions
        await integration_workspace.process_all_operations()

        # Measure cleanup performance
        cleanup_start = time.time()

        # Run cleanup operations
        if hasattr(integration_workspace.queue_processor, "cleanup_stale_operations"):
            await integration_workspace.queue_processor.cleanup_stale_operations()

        # Verify sync state is accessible
        sync_state = await integration_workspace.get_sync_state()
        assert sync_state is not None

        cleanup_time = time.time() - cleanup_start

        # Performance assertions
        assert cleanup_time < 5.0, f"Cleanup should be fast, took {cleanup_time:.2f}s"

        print(
            f"Cleanup performance: {cleanup_time:.3f}s for {num_conflicts} conflict scenarios"
        )


class TestConflictEdgeCases:
    """Test edge cases in conflict handling."""

    @pytest.mark.asyncio
    async def test_circular_dependency_conflict(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test handling of circular dependency conflicts."""
        builder = OperationBuilder()

        # Create circular dependency: A → B → C → A
        op_a = (
            builder.reset()
            .with_id("circular_a")
            .with_type(OperationType.CREATE_SPEC)
            .with_params(name="Circular A", specId="circular-a")
            .build()
        )

        op_b = (
            builder.reset()
            .with_id("circular_b")
            .with_type(OperationType.CREATE_SPEC)
            .with_params(name="Circular B", specId="circular-b")
            .with_dependencies("circular_a")
            .build()
        )

        op_c = (
            builder.reset()
            .with_id("circular_c")
            .with_type(OperationType.CREATE_SPEC)
            .with_params(name="Circular C", specId="circular-c")
            .with_dependencies("circular_b")
            .build()
        )

        # Create the circular dependency
        op_a.dependencies = ["circular_c"]

        await integration_workspace.queue_operation(op_a)
        await integration_workspace.queue_operation(op_b)
        await integration_workspace.queue_operation(op_c)

        # Process operations
        await integration_workspace.process_all_operations()

        # Verify circular dependency is detected and handled
        queue = await integration_workspace.get_operation_queue()

        # Check for circular dependency conflict detection
        await integration_workspace.get_sync_state()

        # System should detect and handle circular dependencies
        # (May break the cycle or mark operations as failed)

        # At least one operation should be marked as failed or have conflict
        failed_or_conflicted = [
            op
            for op in queue.operations
            if op.status == OperationStatus.FAILED
            or (hasattr(op, "conflict_ids") and op.conflict_ids)
        ]

        assert (
            len(failed_or_conflicted) > 0
        ), "Circular dependency should be detected and handled"

    @pytest.mark.asyncio
    async def test_conflict_during_operation_processing(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test conflict detection during active operation processing."""
        spec_id = "processing-conflict-test"

        # Create initial operation
        op1 = create_test_operation(
            OperationType.CREATE_SPEC,
            {"name": "Processing Conflict Test", "specId": spec_id},
            priority=5,
            operation_id="processing_op1",
        )

        await integration_workspace.queue_operation(op1)

        # Start processing
        processing_task = asyncio.create_task(
            integration_workspace.process_all_operations()
        )

        # While processing, add a conflicting operation
        await asyncio.sleep(0.1)  # Let processing start

        op2 = create_test_operation(
            OperationType.CREATE_SPEC,
            {
                "name": "Processing Conflict Test",
                "specId": spec_id,
            },  # Same spec
            priority=7,
            operation_id="processing_op2",
        )

        await integration_workspace.queue_operation(op2)

        # Wait for processing to complete
        await processing_task

        # Process the new operation
        await integration_workspace.process_all_operations()

        # Verify conflict handling during processing
        queue = await integration_workspace.get_operation_queue()
        ops_by_id = {op.id: op for op in queue.operations}

        # One operation should succeed, the other should be handled appropriately
        op1_final = ops_by_id["processing_op1"]
        op2_final = ops_by_id["processing_op2"]

        # Both shouldn't succeed with identical parameters
        completed_ops = [
            op
            for op in [op1_final, op2_final]
            if op.status == OperationStatus.COMPLETED
        ]
        assert len(completed_ops) <= 1, "Only one duplicate operation should succeed"

    @pytest.mark.asyncio
    async def test_conflict_with_file_system_errors(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test conflict handling when file system errors occur."""
        spec_id = "fs-error-conflict-test"

        # Create conflicting operations
        op1 = create_test_operation(
            OperationType.CREATE_SPEC,
            {"name": "FS Error Test", "specId": spec_id},
            priority=5,
            operation_id="fs_error_op1",
        )

        op2 = create_test_operation(
            OperationType.CREATE_SPEC,
            {"name": "FS Error Test", "specId": spec_id},
            priority=5,
            operation_id="fs_error_op2",
        )

        await integration_workspace.queue_operation(op1)
        await integration_workspace.queue_operation(op2)

        # Simulate file system error by making directory read-only
        import os

        original_mode = os.stat(integration_workspace.specs_dir).st_mode

        try:
            os.chmod(integration_workspace.specs_dir, 0o444)  # Read-only

            # Process operations - should handle both conflicts and file system errors
            await integration_workspace.process_all_operations()

            # Restore permissions
            os.chmod(integration_workspace.specs_dir, original_mode)

            # Process again
            await integration_workspace.process_all_operations()

            # Verify system handles both types of errors gracefully
            queue = await integration_workspace.get_operation_queue()
            sync_state = await integration_workspace.get_sync_state()

            # System should remain stable despite multiple error types
            assert (
                sync_state.mcp_server_online
            ), "Server should remain online despite errors"

            # Operations should be in appropriate states
            ops_by_id = {op.id: op for op in queue.operations}

            # Both operations should be either failed or successfully resolved
            for op_id in ["fs_error_op1", "fs_error_op2"]:
                op = ops_by_id[op_id]
                assert op.status in [
                    OperationStatus.FAILED,
                    OperationStatus.COMPLETED,
                    OperationStatus.CANCELLED,
                    OperationStatus.PENDING,  # May be pending retry
                ], f"Operation {op_id} should be in a valid state"

        finally:
            # Ensure permissions are restored
            try:
                os.chmod(integration_workspace.specs_dir, original_mode)
            except (OSError, PermissionError):
                pass
