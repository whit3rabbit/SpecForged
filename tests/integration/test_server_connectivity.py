"""
Integration tests for server offline/online scenarios and operation batching.

This module tests the robustness of the MCP ecosystem when:
- The MCP server goes offline unexpectedly
- Operations are queued while server is offline
- Server comes back online and processes batched operations
- Network connectivity is intermittent
- Server restarts and recoveries

Tests verify graceful degradation and recovery of the entire system.
"""

import asyncio
import json
import time
from datetime import datetime, timezone

import pytest

from src.specforged.core.queue_processor import OperationStatus, OperationType

from .fixtures import IntegrationTestWorkspace, MockMcpServer, PerformanceMonitor


class TestServerOfflineScenarios:
    """Test scenarios when MCP server is offline."""

    @pytest.mark.asyncio
    async def test_operations_queue_while_server_offline(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test that operations queue properly when server is offline."""
        # Mark server as offline
        await integration_workspace.simulate_server_offline_period(0.1)

        # Queue operations while server is offline
        offline_operations = []
        for i in range(5):
            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.CREATE_SPEC,
                {"name": f"Offline Spec {i}", "specId": f"offline-spec-{i}"},
                priority=5 + i,
            )
            offline_operations.append(op_id)

        # Verify operations are queued but not processed
        queue = await integration_workspace.get_operation_queue()
        assert len(queue.operations) == 5, "All operations should be queued"

        # All operations should still be pending
        pending_ops = [
            op for op in queue.operations if op.status == OperationStatus.PENDING
        ]
        assert (
            len(pending_ops) == 5
        ), "All operations should be pending while server offline"

        # Verify sync state reflects server being offline
        sync_state = await integration_workspace.get_sync_state()
        assert not sync_state.mcp_server_online, "Sync state should show server offline"

    @pytest.mark.asyncio
    async def test_batch_processing_when_server_comes_online(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test batch processing of queued operations when server comes back online."""
        # Start with server offline
        sync_state = await integration_workspace.get_sync_state()
        sync_state.mcp_server_online = False
        await integration_workspace.queue_processor.atomic_write_json(
            integration_workspace.sync_file, sync_state.model_dump()
        )

        # Queue multiple operations while offline
        batch_size = 10
        operation_ids = []

        for i in range(batch_size):
            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.CREATE_SPEC,
                {"name": f"Batch Spec {i}", "specId": f"batch-spec-{i:02d}"},
                priority=5,
            )
            operation_ids.append(op_id)

        # Verify operations are queued
        queue = await integration_workspace.get_operation_queue()
        assert len(queue.operations) == batch_size

        # Bring server back online
        sync_state.mcp_server_online = True
        sync_state.last_sync = datetime.now(timezone.utc)
        await integration_workspace.queue_processor.atomic_write_json(
            integration_workspace.sync_file, sync_state.model_dump()
        )

        # Process the batch
        batch_start = time.time()
        await integration_workspace.process_all_operations()
        batch_time = time.time() - batch_start

        # Verify all operations were processed
        completed_count = 0
        for op_id in operation_ids:
            result = await integration_workspace.wait_for_operation_completion(
                op_id, timeout_seconds=20
            )
            if result and result.success:
                completed_count += 1

        # Performance and correctness assertions
        assert (
            completed_count >= batch_size * 0.8
        ), f"At least 80% of batch should complete, got {completed_count}/{batch_size}"
        assert (
            batch_time < 30.0
        ), f"Batch processing should be reasonable, took {batch_time:.2f}s"

        # Verify specifications were created
        spec_dirs = list(integration_workspace.specs_dir.glob("batch-spec-*"))
        assert (
            len(spec_dirs) >= batch_size * 0.8
        ), f"Should create most specifications, found {len(spec_dirs)}"

        print("Batch processing metrics:")
        print(f"  Operations processed: {completed_count}/{batch_size}")
        print(f"  Processing time: {batch_time:.2f}s")
        print(f"  Operations per second: {completed_count / batch_time:.2f}")

    @pytest.mark.asyncio
    async def test_operation_persistence_across_server_restart(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test that operations persist across server restarts."""
        # Queue operations
        pre_restart_ops = []
        for i in range(3):
            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.CREATE_SPEC,
                {
                    "name": f"Persistent Spec {i}",
                    "specId": f"persistent-spec-{i}",
                },
                priority=6,
            )
            pre_restart_ops.append(op_id)

        # Verify operations are in queue file
        assert integration_workspace.queue_file.exists(), "Queue file should exist"

        with open(integration_workspace.queue_file, "r") as f:
            queue_data = json.load(f)

        assert (
            len(queue_data["operations"]) == 3
        ), "Operations should be persisted to file"

        # Simulate server restart by recreating queue processor
        integration_workspace.queue_processor = None

        # Create new queue processor (simulates server restart)
        from src.specforged.core.queue_processor import QueueProcessor

        integration_workspace.queue_processor = QueueProcessor(
            integration_workspace.spec_manager,
            integration_workspace.workspace_dir,
        )

        # Load operations from persisted state
        reloaded_queue = (
            await integration_workspace.queue_processor.load_operation_queue()
        )

        # Verify operations were restored
        assert (
            len(reloaded_queue.operations) == 3
        ), "Operations should be restored after restart"

        reloaded_ids = [op.id for op in reloaded_queue.operations]
        for op_id in pre_restart_ops:
            assert op_id in reloaded_ids, f"Operation {op_id} should be restored"

        # Process restored operations
        await integration_workspace.process_all_operations()

        # Verify operations complete successfully after restart
        for op_id in pre_restart_ops:
            result = await integration_workspace.wait_for_operation_completion(
                op_id, timeout_seconds=15
            )
            assert result is not None, f"Restored operation {op_id} should complete"
            assert result.success, f"Restored operation {op_id} should succeed"

    @pytest.mark.asyncio
    async def test_heartbeat_and_connectivity_monitoring(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test heartbeat system for monitoring server connectivity."""
        # Start with server online
        initial_sync_state = await integration_workspace.get_sync_state()
        assert initial_sync_state.mcp_server_online

        # Send heartbeat operation
        heartbeat_op_id = await integration_workspace.simulate_extension_operation(
            OperationType.HEARTBEAT,
            {"extension_version": "test-1.0.0"},
            priority=1,  # High priority
        )

        # Process heartbeat
        await integration_workspace.process_all_operations()

        # Verify heartbeat was processed
        result = await integration_workspace.wait_for_operation_completion(
            heartbeat_op_id, timeout_seconds=10
        )
        assert result is not None, "Heartbeat should be processed"
        assert result.success, "Heartbeat should succeed"

        # Verify sync state was updated
        updated_sync_state = await integration_workspace.get_sync_state()
        assert updated_sync_state.mcp_server_online, "Server should still be online"
        assert (
            updated_sync_state.last_sync != initial_sync_state.last_sync
        ), "Last sync time should be updated"

        # Simulate server going offline (no heartbeat response)

        # Mark server offline
        offline_sync_state = await integration_workspace.get_sync_state()
        offline_sync_state.mcp_server_online = False
        await integration_workspace.queue_processor.atomic_write_json(
            integration_workspace.sync_file, offline_sync_state.model_dump()
        )

        # Try to send heartbeat while offline
        offline_heartbeat_id = await integration_workspace.simulate_extension_operation(
            OperationType.HEARTBEAT,
            {"extension_version": "test-1.0.0"},
            priority=1,
        )

        # Queue should accept heartbeat even while offline
        queue = await integration_workspace.get_operation_queue()
        heartbeat_ops = [
            op for op in queue.operations if op.type == OperationType.HEARTBEAT
        ]
        assert (
            len(heartbeat_ops) >= 2
        ), "Heartbeat operations should be queued even when offline"

        # Bring server back online
        online_sync_state = await integration_workspace.get_sync_state()
        online_sync_state.mcp_server_online = True
        online_sync_state.last_sync = datetime.now(timezone.utc)
        await integration_workspace.queue_processor.atomic_write_json(
            integration_workspace.sync_file, online_sync_state.model_dump()
        )

        # Process queued heartbeat
        await integration_workspace.process_all_operations()

        # Verify offline heartbeat was processed when server came back
        offline_result = await integration_workspace.wait_for_operation_completion(
            offline_heartbeat_id, timeout_seconds=10
        )
        assert (
            offline_result is not None
        ), "Queued heartbeat should be processed when server comes back online"

    @pytest.mark.asyncio
    async def test_gradual_server_degradation_and_recovery(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test gradual server degradation and recovery scenarios."""
        # Phase 1: Normal operation
        normal_op_id = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "Normal Operation", "specId": "normal-op"},
            priority=5,
        )

        await integration_workspace.process_all_operations()
        result = await integration_workspace.wait_for_operation_completion(normal_op_id)
        assert result.success, "Normal operation should succeed"

        # Phase 2: Simulate slow server (high processing delay)
        mock_server = MockMcpServer(integration_workspace)
        mock_server.set_processing_delay(2.0)  # 2 second delay
        await mock_server.start()

        slow_op_id = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "Slow Operation", "specId": "slow-op"},
            priority=6,
        )

        slow_start = time.time()
        result = await integration_workspace.wait_for_operation_completion(
            slow_op_id, timeout_seconds=30
        )
        slow_time = time.time() - slow_start

        assert result is not None, "Slow operation should eventually complete"
        assert slow_time > 1.0, "Operation should take time due to server delay"

        # Phase 3: Simulate intermittent failures
        mock_server.set_failure_rate(0.7)  # 70% failure rate

        failing_ops = []
        for i in range(5):
            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.CREATE_SPEC,
                {"name": f"Failing Op {i}", "specId": f"failing-op-{i}"},
                priority=5,
            )
            failing_ops.append(op_id)

        # Process with high failure rate
        await integration_workspace.process_all_operations()
        await asyncio.sleep(3.0)  # Allow time for retries

        # Some operations should fail
        failed_count = 0
        success_count = 0

        for op_id in failing_ops:
            result = await integration_workspace.wait_for_operation_completion(
                op_id, timeout_seconds=1
            )
            if result:
                if result.success:
                    success_count += 1
                else:
                    failed_count += 1

        # Should have some failures due to high failure rate
        total_results = failed_count + success_count
        assert total_results > 0, "Should have processed some operations"

        # Phase 4: Recovery - restore normal operation
        mock_server.set_failure_rate(0.0)  # No failures
        mock_server.set_processing_delay(0.1)  # Fast processing

        recovery_op_id = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "Recovery Operation", "specId": "recovery-op"},
            priority=8,
        )

        await integration_workspace.process_all_operations()
        recovery_result = await integration_workspace.wait_for_operation_completion(
            recovery_op_id
        )

        assert (
            recovery_result is not None
        ), "System should recover and process operations normally"
        assert recovery_result.success, "Recovery operation should succeed"

        await mock_server.stop()


class TestOperationBatching:
    """Test operation batching strategies."""

    @pytest.mark.asyncio
    async def test_priority_based_batching(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test that operations are batched and processed by priority."""
        # Create operations with different priorities
        operations = [
            (
                "urgent_op",
                OperationType.CREATE_SPEC,
                {"name": "Urgent Spec", "specId": "urgent"},
                1,
            ),
            (
                "high_op",
                OperationType.CREATE_SPEC,
                {"name": "High Spec", "specId": "high"},
                3,
            ),
            (
                "normal_op_1",
                OperationType.CREATE_SPEC,
                {"name": "Normal Spec 1", "specId": "normal-1"},
                5,
            ),
            (
                "normal_op_2",
                OperationType.CREATE_SPEC,
                {"name": "Normal Spec 2", "specId": "normal-2"},
                5,
            ),
            (
                "low_op",
                OperationType.CREATE_SPEC,
                {"name": "Low Spec", "specId": "low"},
                8,
            ),
        ]

        # Queue operations in random order
        import random

        shuffled_ops = operations.copy()
        random.shuffle(shuffled_ops)

        operation_ids = {}
        for op_name, op_type, params, priority in shuffled_ops:
            op_id = await integration_workspace.simulate_extension_operation(
                op_type, params, priority
            )
            operation_ids[op_name] = op_id

        # Process batch
        batch_start = time.time()
        await integration_workspace.process_all_operations()
        batch_time = time.time() - batch_start

        # Get completion times
        completion_times = {}
        for op_name, op_id in operation_ids.items():
            result = await integration_workspace.wait_for_operation_completion(
                op_id, timeout_seconds=15
            )
            if result:
                completion_times[op_name] = datetime.fromisoformat(
                    result.timestamp.replace("Z", "+00:00")
                )

        # Verify priority-based processing order
        # Urgent should complete before high, high before normal, etc.
        if "urgent_op" in completion_times and "high_op" in completion_times:
            assert (
                completion_times["urgent_op"] <= completion_times["high_op"]
            ), "Urgent should complete before high priority"

        if "high_op" in completion_times and "normal_op_1" in completion_times:
            assert (
                completion_times["high_op"] <= completion_times["normal_op_1"]
            ), "High should complete before normal priority"

        if "normal_op_1" in completion_times and "low_op" in completion_times:
            assert (
                completion_times["normal_op_1"] <= completion_times["low_op"]
            ), "Normal should complete before low priority"

        print("Priority batch processing:")
        print(f"  Total time: {batch_time:.2f}s")
        print("  Completion order:")
        sorted_completions = sorted(completion_times.items(), key=lambda x: x[1])
        for op_name, timestamp in sorted_completions:
            print(f"    {op_name}: {timestamp.strftime('%H:%M:%S.%f')[:-3]}")

    @pytest.mark.asyncio
    async def test_large_batch_processing(
        self,
        integration_workspace: IntegrationTestWorkspace,
        performance_monitor: PerformanceMonitor,
    ):
        """Test processing of large operation batches."""
        performance_monitor.start_monitoring()

        # Create large batch of operations
        batch_size = 100
        operation_ids = []

        batch_start = time.time()
        for i in range(batch_size):
            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.CREATE_SPEC,
                {
                    "name": f"Large Batch Spec {i}",
                    "specId": f"large-batch-{i:03d}",
                },
                priority=5,
            )
            operation_ids.append(op_id)

            if i % 10 == 0:
                performance_monitor.record_queue_size(i + 1)

        queuing_time = time.time() - batch_start

        # Process the large batch
        processing_start = time.time()

        # Process in chunks to simulate realistic batching
        chunk_size = 20
        processed_count = 0

        for chunk_start in range(0, len(operation_ids), chunk_size):
            chunk_end = min(chunk_start + chunk_size, len(operation_ids))
            chunk_ids = operation_ids[chunk_start:chunk_end]

            chunk_process_start = time.time()
            await integration_workspace.process_all_operations()
            chunk_time = time.time() - chunk_process_start

            performance_monitor.record_operation_time(chunk_time)

            # Count completed operations in this chunk
            chunk_completed = 0
            for op_id in chunk_ids:
                result = await integration_workspace.wait_for_operation_completion(
                    op_id, timeout_seconds=1
                )
                if result and result.success:
                    chunk_completed += 1

            processed_count += chunk_completed
            performance_monitor.record_queue_size(len(operation_ids) - processed_count)

            print(
                f"Processed chunk {chunk_start // chunk_size + 1}: {chunk_completed}/{len(chunk_ids)} operations in {chunk_time:.2f}s"  # noqa: E501
            )

            # Small delay between chunks
            await asyncio.sleep(0.1)

        total_processing_time = time.time() - processing_start
        performance_monitor.stop_monitoring()

        # Generate performance report
        perf_report = performance_monitor.get_performance_report()

        # Performance assertions
        assert (
            processed_count >= batch_size * 0.8
        ), f"Should process at least 80% of large batch, got {processed_count}/{batch_size}"
        assert queuing_time < 10.0, f"Queuing should be fast, took {queuing_time:.2f}s"
        assert (
            total_processing_time < 120.0
        ), f"Large batch should process within 2 minutes, took {total_processing_time:.2f}s"
        assert (
            perf_report["operations_per_second"] > 1.0
        ), f"Should maintain reasonable throughput: {perf_report['operations_per_second']:.2f} ops/sec"  # noqa: E501

        print("Large batch performance:")
        print(f"  Batch size: {batch_size}")
        print(f"  Queuing time: {queuing_time:.2f}s")
        print(f"  Processing time: {total_processing_time:.2f}s")
        print(
            f"  Successfully processed: {processed_count}/{batch_size} ({100 * processed_count / batch_size:.1f}%)"  # noqa: E501
        )
        print(
            f"  Throughput: {perf_report['operations_per_second']:.2f} operations/second"
        )

    @pytest.mark.asyncio
    async def test_mixed_operation_type_batching(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test batching of different operation types together."""
        # Create a specification first
        base_spec_id = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "Mixed Batch Base", "specId": "mixed-batch-base"},
            priority=9,
        )

        await integration_workspace.process_all_operations()
        result = await integration_workspace.wait_for_operation_completion(base_spec_id)
        assert result.success, "Base specification should be created"

        # Create mixed batch of operation types
        mixed_operations = [
            (
                OperationType.CREATE_SPEC,
                {"name": "New Spec 1", "specId": "mixed-new-1"},
                5,
            ),
            (
                OperationType.UPDATE_REQUIREMENTS,
                {
                    "specId": "mixed-batch-base",
                    "content": "Mixed requirements",
                },
                6,
            ),
            (
                OperationType.CREATE_SPEC,
                {"name": "New Spec 2", "specId": "mixed-new-2"},
                4,
            ),
            (
                OperationType.UPDATE_DESIGN,
                {"specId": "mixed-batch-base", "content": "Mixed design"},
                7,
            ),
            (
                OperationType.CREATE_SPEC,
                {"name": "New Spec 3", "specId": "mixed-new-3"},
                5,
            ),
            (
                OperationType.UPDATE_TASKS,
                {"specId": "mixed-batch-base", "content": "- [ ] Mixed task"},
                6,
            ),
            (
                OperationType.ADD_USER_STORY,
                {
                    "specId": "mixed-batch-base",
                    "userStory": {
                        "as_a": "mixed batch user",
                        "i_want": "to test mixed operations",
                        "so_that": "batching works correctly",
                    },
                },
                8,
            ),
        ]

        # Queue all operations
        mixed_op_ids = []
        for op_type, params, priority in mixed_operations:
            op_id = await integration_workspace.simulate_extension_operation(
                op_type, params, priority
            )
            mixed_op_ids.append((op_id, op_type, priority))

        # Process mixed batch
        batch_start = time.time()
        await integration_workspace.process_all_operations()
        batch_time = time.time() - batch_start

        # Verify all operations completed successfully
        results_by_type = {}
        for op_id, op_type, priority in mixed_op_ids:
            result = await integration_workspace.wait_for_operation_completion(
                op_id, timeout_seconds=20
            )
            assert result is not None, f"Operation {op_id} ({op_type}) should complete"

            if result.success:
                if op_type not in results_by_type:
                    results_by_type[op_type] = []
                results_by_type[op_type].append((op_id, priority, result))

        # Verify different operation types were processed
        assert (
            len(results_by_type) >= 4
        ), f"Should process multiple operation types, got {len(results_by_type)}"

        # Verify file operations worked
        base_spec_dir = integration_workspace.specs_dir / "mixed-batch-base"
        if base_spec_dir.exists():
            requirements_file = base_spec_dir / "requirements.md"
            design_file = base_spec_dir / "design.md"

            if requirements_file.exists():
                req_content = requirements_file.read_text()
                assert (
                    "Mixed requirements" in req_content
                ), "Requirements should be updated"

            if design_file.exists():
                design_content = design_file.read_text()
                assert "Mixed design" in design_content, "Design should be updated"

        print("Mixed batch processing:")
        print(f"  Total operations: {len(mixed_op_ids)}")
        print(f"  Processing time: {batch_time:.2f}s")
        print(f"  Operation types processed: {list(results_by_type.keys())}")
        for op_type, results in results_by_type.items():
            print(f"    {op_type}: {len(results)} operations")


class TestConnectivityResilience:
    """Test system resilience under various connectivity issues."""

    @pytest.mark.asyncio
    async def test_intermittent_connectivity(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test handling of intermittent connectivity issues."""
        # Create mock server with intermittent issues
        mock_server = MockMcpServer(integration_workspace)
        mock_server.set_failure_rate(0.3)  # 30% failure rate
        await mock_server.start()

        # Queue operations during intermittent connectivity
        intermittent_ops = []
        for i in range(10):
            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.CREATE_SPEC,
                {
                    "name": f"Intermittent Spec {i}",
                    "specId": f"intermittent-{i}",
                },
                priority=5,
            )
            intermittent_ops.append(op_id)

            # Simulate occasional connectivity drops
            if i % 3 == 0:
                await integration_workspace.simulate_server_offline_period(0.2)

        # Process with intermittent issues
        resilience_start = time.time()

        # Multiple processing attempts to handle intermittent failures
        for attempt in range(5):
            await integration_workspace.process_all_operations()
            await asyncio.sleep(0.5)  # Allow time for retries

        resilience_time = time.time() - resilience_start

        # Count successful operations
        success_count = 0
        retry_count = 0
        failed_count = 0

        for op_id in intermittent_ops:
            result = await integration_workspace.wait_for_operation_completion(
                op_id, timeout_seconds=2
            )
            if result:
                if result.success:
                    success_count += 1
                else:
                    failed_count += 1
            else:
                # Check if operation is still retrying
                queue = await integration_workspace.get_operation_queue()
                ops_by_id = {op.id: op for op in queue.operations}
                if op_id in ops_by_id:
                    op = ops_by_id[op_id]
                    if op.retry_count > 0:
                        retry_count += 1

        # Verify system handled intermittent connectivity
        assert (
            success_count + retry_count >= len(intermittent_ops) * 0.7
        ), f"Should handle most operations despite intermittent issues: success={success_count}, retrying={retry_count}, failed={failed_count}"  # noqa: E501
        assert (
            resilience_time < 30.0
        ), f"Should handle intermittent issues within reasonable time: {resilience_time:.2f}s"

        # Verify sync state shows some errors but system remains functional
        sync_state = await integration_workspace.get_sync_state()
        assert (
            sync_state.mcp_server_online
        ), "Server should be considered online despite intermittent issues"

        await mock_server.stop()

    @pytest.mark.asyncio
    async def test_long_disconnect_recovery(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test recovery after extended disconnection periods."""
        # Queue initial operations
        pre_disconnect_ops = []
        for i in range(3):
            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.CREATE_SPEC,
                {
                    "name": f"Pre-Disconnect Spec {i}",
                    "specId": f"pre-disconnect-{i}",
                },
                priority=5,
            )
            pre_disconnect_ops.append(op_id)

        # Process initial operations
        await integration_workspace.process_all_operations()

        # Simulate extended server disconnection (5 seconds)
        disconnect_start = time.time()
        await integration_workspace.simulate_server_offline_period(5.0)

        # Queue operations during disconnection
        during_disconnect_ops = []
        for i in range(5):
            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.CREATE_SPEC,
                {
                    "name": f"During Disconnect Spec {i}",
                    "specId": f"during-disconnect-{i}",
                },
                priority=6,
            )
            during_disconnect_ops.append(op_id)
            await asyncio.sleep(0.5)  # Spread operations over disconnect period

        disconnect_time = time.time() - disconnect_start

        # Verify operations queued during disconnect
        queue = await integration_workspace.get_operation_queue()
        queued_during_disconnect = [
            op
            for op in queue.operations
            if "during-disconnect" in op.params.get("specId", "")
        ]
        assert (
            len(queued_during_disconnect) == 5
        ), "Operations should queue during disconnect"

        # Verify server is marked as offline
        sync_state = await integration_workspace.get_sync_state()
        assert (
            sync_state.mcp_server_online
        ), "Server should be back online after disconnect period"

        # Process recovery batch
        recovery_start = time.time()
        await integration_workspace.process_all_operations()
        recovery_time = time.time() - recovery_start

        # Verify recovery
        recovered_count = 0
        for op_id in during_disconnect_ops:
            result = await integration_workspace.wait_for_operation_completion(
                op_id, timeout_seconds=30
            )
            if result and result.success:
                recovered_count += 1

        # Recovery assertions
        assert (
            recovered_count >= len(during_disconnect_ops) * 0.8
        ), f"Should recover most operations after disconnect: {recovered_count}/{len(during_disconnect_ops)}"  # noqa: E501
        assert (
            recovery_time < 20.0
        ), f"Recovery should be reasonably fast: {recovery_time:.2f}s"

        # Verify system continues to work normally post-recovery
        post_recovery_op = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "Post Recovery Test", "specId": "post-recovery-test"},
            priority=7,
        )

        await integration_workspace.process_all_operations()
        post_result = await integration_workspace.wait_for_operation_completion(
            post_recovery_op
        )

        assert post_result is not None, "System should work normally after recovery"
        assert post_result.success, "Post-recovery operations should succeed"

        print("Long disconnect recovery:")
        print(f"  Disconnect duration: {disconnect_time:.2f}s")
        print(f"  Operations queued during disconnect: {len(during_disconnect_ops)}")
        print(f"  Recovery time: {recovery_time:.2f}s")
        print(f"  Operations recovered: {recovered_count}/{len(during_disconnect_ops)}")

    @pytest.mark.asyncio
    async def test_server_crash_and_restart(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test handling of server crashes and restarts."""
        # Queue and process initial operations
        initial_op_id = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "Pre-Crash Spec", "specId": "pre-crash"},
            priority=6,
        )

        await integration_workspace.process_all_operations()
        initial_result = await integration_workspace.wait_for_operation_completion(
            initial_op_id
        )
        assert initial_result.success, "Initial operation should succeed"

        # Queue operations that will be in progress during crash
        crash_ops = []
        for i in range(4):
            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.CREATE_SPEC,
                {"name": f"Crash Test Spec {i}", "specId": f"crash-test-{i}"},
                priority=5,
            )
            crash_ops.append(op_id)

        # Simulate server crash (abrupt termination)
        # Mark some operations as in-progress to simulate crash during processing
        queue = await integration_workspace.get_operation_queue()
        if len(queue.operations) > 0:
            queue.operations[0].status = OperationStatus.IN_PROGRESS
            await integration_workspace.queue_processor.save_operation_queue(queue)

        # Simulate server restart by recreating processor

        # Recreate queue processor (simulates server restart)
        from src.specforged.core.queue_processor import QueueProcessor

        integration_workspace.queue_processor = QueueProcessor(
            integration_workspace.spec_manager,
            integration_workspace.workspace_dir,
        )

        # Verify crash recovery
        await integration_workspace.process_all_operations()

        # Check that operations are handled after restart
        recovered_count = 0
        for op_id in crash_ops:
            result = await integration_workspace.wait_for_operation_completion(
                op_id, timeout_seconds=20
            )
            if result and result.success:
                recovered_count += 1

        # Crash recovery assertions
        assert (
            recovered_count >= len(crash_ops) * 0.75
        ), f"Should recover most operations after crash: {recovered_count}/{len(crash_ops)}"

        # Verify system stability after restart
        post_crash_ops = []
        for i in range(3):
            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.CREATE_SPEC,
                {"name": f"Post-Crash Spec {i}", "specId": f"post-crash-{i}"},
                priority=7,
            )
            post_crash_ops.append(op_id)

        await integration_workspace.process_all_operations()

        # Verify post-crash operations work normally
        stable_count = 0
        for op_id in post_crash_ops:
            result = await integration_workspace.wait_for_operation_completion(
                op_id, timeout_seconds=15
            )
            if result and result.success:
                stable_count += 1

        assert stable_count == len(
            post_crash_ops
        ), f"All post-crash operations should succeed: {stable_count}/{len(post_crash_ops)}"

        # Verify sync state reflects stable operation
        final_sync_state = await integration_workspace.get_sync_state()
        assert (
            final_sync_state.mcp_server_online
        ), "Server should be online after restart"

        print("Server crash recovery:")
        print(f"  Operations before crash: {len(crash_ops)}")
        print(f"  Operations recovered: {recovered_count}/{len(crash_ops)}")
        print(f"  Post-crash stability: {stable_count}/{len(post_crash_ops)}")
