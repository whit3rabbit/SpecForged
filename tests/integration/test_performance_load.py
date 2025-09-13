"""
Integration tests for operation processing performance under load.

This module tests the performance characteristics of the MCP ecosystem under
various load conditions:
- High-volume operation processing
- Memory usage under sustained load
- Concurrent operation handling
- Resource utilization optimization
- Scalability limits and bottleneck identification

Tests verify that the system maintains acceptable performance under realistic
and stress test conditions.
"""

import asyncio
import gc
import statistics
import time
from typing import Dict

import psutil
import pytest

from src.specforged.core.queue_processor import OperationType

from .fixtures import IntegrationTestWorkspace, PerformanceMonitor


class TestHighVolumeProcessing:
    """Test high-volume operation processing performance."""

    @pytest.mark.asyncio
    async def test_sustained_operation_throughput(
        self,
        integration_workspace: IntegrationTestWorkspace,
        performance_monitor: PerformanceMonitor,
    ):
        """Test sustained high throughput operation processing."""
        performance_monitor.start_monitoring()

        # Configuration for sustained load test
        operations_per_batch = 25
        num_batches = 10
        total_operations = operations_per_batch * num_batches

        print(
            f"Starting sustained throughput test: {total_operations} operations in {num_batches} batches"  # noqa: E501
        )

        # Track performance metrics
        batch_times = []
        throughput_rates = []
        memory_usage = []
        queue_sizes = []

        overall_start = time.time()

        for batch_num in range(num_batches):
            batch_start = time.time()

            # Record memory usage before batch
            process = psutil.Process()
            memory_before = process.memory_info().rss / 1024 / 1024  # MB
            memory_usage.append(memory_before)

            # Generate batch of operations
            batch_operation_ids = []
            for i in range(operations_per_batch):
                op_num = batch_num * operations_per_batch + i

                # Vary operation types for realistic load
                if i % 4 == 0:
                    op_id = await integration_workspace.simulate_extension_operation(
                        OperationType.CREATE_SPEC,
                        {
                            "name": f"Load Test Spec {op_num}",
                            "specId": f"load-test-{op_num:04d}",
                        },
                        priority=5,
                    )
                elif i % 4 == 1:
                    # Update existing spec (create dependency)
                    base_spec_id = f"load-test-{max(0, op_num - 10):04d}"
                    op_id = await integration_workspace.simulate_extension_operation(
                        OperationType.UPDATE_REQUIREMENTS,
                        {
                            "specId": base_spec_id,
                            "content": f"Updated requirements for batch {batch_num}",
                        },
                        priority=6,
                    )
                elif i % 4 == 2:
                    base_spec_id = f"load-test-{max(0, op_num - 5):04d}"
                    op_id = await integration_workspace.simulate_extension_operation(
                        OperationType.UPDATE_DESIGN,
                        {
                            "specId": base_spec_id,
                            "content": f"Updated design for batch {batch_num}",
                        },
                        priority=6,
                    )
                else:
                    base_spec_id = f"load-test-{max(0, op_num - 2):04d}"
                    op_id = await integration_workspace.simulate_extension_operation(
                        OperationType.ADD_USER_STORY,
                        {
                            "specId": base_spec_id,
                            "userStory": {
                                "as_a": f"load test user {op_num}",
                                "i_want": f"to test operation {op_num}",
                                "so_that": f"performance is verified for batch {batch_num}",
                            },
                        },
                        priority=7,
                    )

                batch_operation_ids.append(op_id)

            time.time() - batch_start

            # Record queue size
            queue = await integration_workspace.get_operation_queue()
            queue_sizes.append(len(queue.operations))
            performance_monitor.record_queue_size(len(queue.operations))

            # Process batch
            processing_start = time.time()
            await integration_workspace.process_all_operations()
            time.time() - processing_start

            batch_total_time = time.time() - batch_start
            batch_times.append(batch_total_time)

            # Calculate throughput for this batch
            batch_throughput = operations_per_batch / batch_total_time
            throughput_rates.append(batch_throughput)
            performance_monitor.record_operation_time(batch_total_time)

            # Count successful operations in this batch
            batch_successes = 0
            for op_id in batch_operation_ids:
                result = await integration_workspace.wait_for_operation_completion(
                    op_id, timeout_seconds=2
                )
                if result and result.success:
                    batch_successes += 1

            success_rate = batch_successes / operations_per_batch * 100

            print(
                f"  Batch {batch_num + 1}/{num_batches}: "
                f"{batch_successes}/{operations_per_batch} ops "
                f"({success_rate:.1f}%) in {batch_total_time:.2f}s "
                f"({batch_throughput:.1f} ops/s) "
                f"Memory: {memory_before:.1f}MB"
            )

            # Brief pause between batches
            await asyncio.sleep(0.1)

            # Force garbage collection to prevent memory buildup
            if batch_num % 3 == 0:
                gc.collect()

        total_time = time.time() - overall_start
        performance_monitor.stop_monitoring()

        # Generate comprehensive performance report
        performance_monitor.get_performance_report()

        # Calculate performance statistics
        avg_batch_time = statistics.mean(batch_times)
        min_batch_time = min(batch_times)
        max_batch_time = max(batch_times)
        avg_throughput = statistics.mean(throughput_rates)
        min_throughput = min(throughput_rates)
        max_throughput = max(throughput_rates)

        # Memory statistics
        avg_memory = statistics.mean(memory_usage)
        max_memory = max(memory_usage)
        min_memory = min(memory_usage)
        memory_growth = max_memory - min_memory

        # Performance assertions
        assert (
            avg_throughput >= 5.0
        ), f"Average throughput should be at least 5 ops/sec, got {avg_throughput:.2f}"
        assert (
            min_throughput >= 2.0
        ), f"Minimum throughput should be at least 2 ops/sec, got {min_throughput:.2f}"
        assert (
            avg_batch_time <= 10.0
        ), f"Average batch time should be <= 10s, got {avg_batch_time:.2f}s"
        assert (
            memory_growth <= 200.0
        ), f"Memory growth should be bounded, grew {memory_growth:.1f}MB"

        # Print detailed performance report
        print("\n=== Sustained Throughput Performance Report ===")
        print(f"Total operations: {total_operations}")
        print(f"Total time: {total_time:.2f}s")
        print(f"Overall throughput: {total_operations / total_time:.2f} ops/sec")
        print("")
        print("Batch Performance:")
        print(f"  Average batch time: {avg_batch_time:.2f}s")
        print(f"  Min/Max batch time: {min_batch_time:.2f}s / {max_batch_time:.2f}s")
        print(f"  Average throughput: {avg_throughput:.2f} ops/sec")
        print(
            f"  Min/Max throughput: {min_throughput:.2f} / {max_throughput:.2f} ops/sec"
        )
        print("")
        print("Resource Usage:")
        print(f"  Average memory: {avg_memory:.1f}MB")
        print(f"  Min/Max memory: {min_memory:.1f}MB / {max_memory:.1f}MB")
        print(f"  Memory growth: {memory_growth:.1f}MB")
        print(f"  Average queue size: {statistics.mean(queue_sizes):.1f}")
        print(f"  Max queue size: {max(queue_sizes)}")

    @pytest.mark.asyncio
    async def test_concurrent_operation_processing(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test concurrent operation processing performance."""
        # Create multiple concurrent operation streams
        num_streams = 5
        operations_per_stream = 15

        print(
            f"Starting concurrent processing test: {num_streams} streams x {operations_per_stream} ops"  # noqa: E501
        )

        async def operation_stream(stream_id: int) -> Dict:
            """Generate and process a stream of operations."""
            stream_results = {
                "stream_id": stream_id,
                "operations": [],
                "start_time": time.time(),
                "end_time": None,
                "successes": 0,
                "failures": 0,
            }

            for i in range(operations_per_stream):
                op_start = time.time()

                # Different operation types per stream for variety
                if stream_id % 3 == 0:
                    op_id = await integration_workspace.simulate_extension_operation(
                        OperationType.CREATE_SPEC,
                        {
                            "name": f"Concurrent Spec S{stream_id}O{i}",
                            "specId": f"concurrent-s{stream_id}-o{i:02d}",
                        },
                        priority=5 + (stream_id % 3),  # Vary priorities
                    )
                elif stream_id % 3 == 1:
                    base_spec = f"concurrent-s{stream_id}-o{max(0, i - 1):02d}"
                    op_id = await integration_workspace.simulate_extension_operation(
                        OperationType.UPDATE_REQUIREMENTS,
                        {
                            "specId": base_spec,
                            "content": f"Concurrent requirements S{stream_id}O{i}",
                        },
                        priority=6,
                    )
                else:
                    base_spec = f"concurrent-s{stream_id}-o{max(0, i - 1):02d}"
                    op_id = await integration_workspace.simulate_extension_operation(
                        OperationType.UPDATE_DESIGN,
                        {
                            "specId": base_spec,
                            "content": f"Concurrent design S{stream_id}O{i}",
                        },
                        priority=7,
                    )

                op_time = time.time() - op_start
                stream_results["operations"].append(
                    {"op_id": op_id, "queue_time": op_time}
                )

                # Small delay between operations in stream
                await asyncio.sleep(0.05)

            stream_results["end_time"] = time.time()
            return stream_results

        # Start all streams concurrently
        concurrent_start = time.time()

        # Create tasks for concurrent streams
        stream_tasks = [
            asyncio.create_task(operation_stream(stream_id))
            for stream_id in range(num_streams)
        ]

        # Process operations concurrently with streams
        processing_task = asyncio.create_task(
            self._continuous_processing(integration_workspace, duration=20)
        )

        # Wait for all streams to complete
        stream_results = await asyncio.gather(*stream_tasks)

        # Stop continuous processing
        processing_task.cancel()
        try:
            await processing_task
        except asyncio.CancelledError:
            pass

        concurrent_time = time.time() - concurrent_start

        # Final processing pass
        await integration_workspace.process_all_operations()

        # Analyze results from all streams
        total_operations = 0
        total_successes = 0
        stream_times = []

        for stream_result in stream_results:
            stream_time = stream_result["end_time"] - stream_result["start_time"]
            stream_times.append(stream_time)

            # Check results for this stream
            stream_successes = 0
            for op_info in stream_result["operations"]:
                total_operations += 1
                result = await integration_workspace.wait_for_operation_completion(
                    op_info["op_id"], timeout_seconds=1
                )
                if result and result.success:
                    stream_successes += 1
                    total_successes += 1

            stream_result["successes"] = stream_successes
            stream_result["failures"] = (
                len(stream_result["operations"]) - stream_successes
            )

            print(
                f"  Stream {stream_result['stream_id']}: "
                f"{stream_successes}/{len(stream_result['operations'])} ops "
                f"in {stream_time:.2f}s"
            )

        # Performance assertions
        success_rate = total_successes / total_operations * 100
        assert (
            success_rate >= 70.0
        ), f"Concurrent processing should achieve 70% success rate, got {success_rate:.1f}%"
        assert (
            concurrent_time <= 25.0
        ), f"Concurrent processing should complete within 25s, took {concurrent_time:.2f}s"

        # Stream performance should be reasonably consistent
        avg_stream_time = statistics.mean(stream_times)
        max_stream_time = max(stream_times)
        time_variance = max_stream_time - avg_stream_time
        assert (
            time_variance <= 5.0
        ), f"Stream completion times should be consistent, variance {time_variance:.2f}s"

        print("\n=== Concurrent Processing Performance Report ===")
        print(f"Total operations: {total_operations}")
        print(f"Successful operations: {total_successes} ({success_rate:.1f}%)")
        print(f"Concurrent processing time: {concurrent_time:.2f}s")
        print(f"Average stream time: {avg_stream_time:.2f}s")
        print(f"Stream time variance: {time_variance:.2f}s")

    async def _continuous_processing(
        self, integration_workspace: IntegrationTestWorkspace, duration: float
    ):
        """Continuously process operations for a given duration."""
        end_time = time.time() + duration
        while time.time() < end_time:
            await integration_workspace.process_all_operations()
            await asyncio.sleep(0.2)

    @pytest.mark.asyncio
    async def test_memory_usage_under_load(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test memory usage patterns under sustained load."""
        # Get baseline memory usage
        process = psutil.Process()
        baseline_memory = process.memory_info().rss / 1024 / 1024  # MB

        print(f"Baseline memory usage: {baseline_memory:.1f}MB")

        # Memory tracking
        memory_samples = []
        operation_counts = []

        # Phase 1: Gradual load increase
        print("Phase 1: Gradual load increase")
        for load_level in [10, 25, 50, 75, 100]:
            phase_start = time.time()

            # Generate operations for this load level
            operation_ids = []
            for i in range(load_level):
                op_id = await integration_workspace.simulate_extension_operation(
                    OperationType.CREATE_SPEC,
                    {
                        "name": f"Memory Test L{load_level}O{i}",
                        "specId": f"memory-test-l{load_level:03d}-o{i:03d}",
                    },
                    priority=5,
                )
                operation_ids.append(op_id)

            # Process operations
            await integration_workspace.process_all_operations()

            # Measure memory
            current_memory = process.memory_info().rss / 1024 / 1024
            memory_samples.append(current_memory)
            operation_counts.append(load_level)

            phase_time = time.time() - phase_start
            memory_increase = current_memory - baseline_memory

            print(
                f"  Load level {load_level}: {current_memory:.1f}MB "
                f"(+{memory_increase:.1f}MB) in {phase_time:.2f}s"
            )

            # Brief pause between load levels
            await asyncio.sleep(0.5)

        # Phase 2: Sustained high load
        print("Phase 2: Sustained high load")
        sustained_load_samples = []

        for cycle in range(5):
            cycle_start = time.time()

            # Generate large batch of operations
            batch_size = 80
            batch_ops = []
            for i in range(batch_size):
                op_id = await integration_workspace.simulate_extension_operation(
                    OperationType.CREATE_SPEC,
                    {
                        "name": f"Sustained Load C{cycle}O{i}",
                        "specId": f"sustained-c{cycle:02d}-o{i:03d}",
                    },
                    priority=5,
                )
                batch_ops.append(op_id)

            # Process batch
            await integration_workspace.process_all_operations()

            # Measure memory
            cycle_memory = process.memory_info().rss / 1024 / 1024
            sustained_load_samples.append(cycle_memory)

            cycle_time = time.time() - cycle_start
            print(
                f"  Sustained cycle {cycle + 1}: {cycle_memory:.1f}MB in {cycle_time:.2f}s"
            )

            # Force garbage collection every other cycle
            if cycle % 2 == 1:
                gc.collect()
                gc_memory = process.memory_info().rss / 1024 / 1024
                print(f"    After GC: {gc_memory:.1f}MB")

        # Phase 3: Memory recovery test
        print("Phase 3: Memory recovery test")

        # Clear operations and force cleanup
        await integration_workspace.queue_processor.cleanup_stale_operations()
        gc.collect()

        # Wait for memory to stabilize
        await asyncio.sleep(2.0)

        recovery_memory = process.memory_info().rss / 1024 / 1024
        print(f"  Recovery memory: {recovery_memory:.1f}MB")

        # Analyze memory usage patterns
        max_memory = max(memory_samples + sustained_load_samples)
        peak_increase = max_memory - baseline_memory
        recovery_efficiency = (
            (max_memory - recovery_memory) / peak_increase * 100
            if peak_increase > 0
            else 0
        )

        # Memory usage assertions
        assert (
            peak_increase <= 500.0
        ), f"Peak memory increase should be reasonable, was {peak_increase:.1f}MB"
        assert (
            recovery_efficiency >= 30.0
        ), f"Should recover at least 30% of peak memory, recovered {recovery_efficiency:.1f}%"

        # Memory growth should be sublinear with operation count
        if len(memory_samples) >= 3:
            # Check that memory doesn't grow linearly with operations
            memory_per_op_start = (
                memory_samples[1] - baseline_memory
            ) / operation_counts[1]
            memory_per_op_end = (
                memory_samples[-1] - baseline_memory
            ) / operation_counts[-1]

            # Later operations should use relatively less memory per operation
            if memory_per_op_start > 0:
                memory_efficiency_ratio = memory_per_op_end / memory_per_op_start
                assert (
                    memory_efficiency_ratio <= 2.0
                ), f"Memory per operation should not grow excessively: {memory_efficiency_ratio:.2f}x"  # noqa: E501

        print("\n=== Memory Usage Performance Report ===")
        print(f"Baseline memory: {baseline_memory:.1f}MB")
        print(f"Peak memory: {max_memory:.1f}MB")
        print(f"Peak increase: {peak_increase:.1f}MB")
        print(f"Recovery memory: {recovery_memory:.1f}MB")
        print(f"Recovery efficiency: {recovery_efficiency:.1f}%")

        if len(memory_samples) >= 2:
            memory_growth_rate = (memory_samples[-1] - memory_samples[0]) / (
                operation_counts[-1] - operation_counts[0]
            )
            print(f"Average memory per operation: {memory_growth_rate:.3f}MB/op")

    @pytest.mark.asyncio
    async def test_operation_queue_scalability(
        self,
        integration_workspace: IntegrationTestWorkspace,
        performance_monitor: PerformanceMonitor,
    ):
        """Test operation queue scalability with large queue sizes."""
        performance_monitor.start_monitoring()

        # Test with increasingly large queue sizes
        queue_sizes = [100, 250, 500, 750, 1000]
        scalability_results = {}

        print("Testing operation queue scalability...")

        for queue_size in queue_sizes:
            print(f"\nTesting queue size: {queue_size}")
            phase_start = time.time()

            # Clear existing operations
            await integration_workspace.queue_processor.cleanup_stale_operations()

            # Generate large queue of operations
            queuing_start = time.time()
            operation_ids = []

            for i in range(queue_size):
                # Mix of operation types for realistic testing
                if i % 5 == 0:
                    op_id = await integration_workspace.simulate_extension_operation(
                        OperationType.CREATE_SPEC,
                        {
                            "name": f"Scale Test {i}",
                            "specId": f"scale-test-{i:05d}",
                        },
                        priority=5 + (i % 3),  # Vary priorities
                    )
                elif i % 5 == 1:
                    base_spec = f"scale-test-{max(0, i - 10):05d}"
                    op_id = await integration_workspace.simulate_extension_operation(
                        OperationType.UPDATE_REQUIREMENTS,
                        {
                            "specId": base_spec,
                            "content": f"Scalability test requirements {i}",
                        },
                        priority=6,
                    )
                elif i % 5 == 2:
                    base_spec = f"scale-test-{max(0, i - 5):05d}"
                    op_id = await integration_workspace.simulate_extension_operation(
                        OperationType.UPDATE_DESIGN,
                        {
                            "specId": base_spec,
                            "content": f"Scalability test design {i}",
                        },
                        priority=7,
                    )
                else:
                    base_spec = f"scale-test-{max(0, i - 2):05d}"
                    op_id = await integration_workspace.simulate_extension_operation(
                        OperationType.ADD_USER_STORY,
                        {
                            "specId": base_spec,
                            "userStory": {
                                "as_a": f"scalability tester {i}",
                                "i_want": f"operation {i} to process efficiently",
                                "so_that": "queue scalability is verified",
                            },
                        },
                        priority=8,
                    )

                operation_ids.append(op_id)

                # Progress indicator
                if i % 100 == 0 and i > 0:
                    queuing_time = time.time() - queuing_start
                    print(f"  Queued {i}/{queue_size} operations ({queuing_time:.2f}s)")

            queuing_time = time.time() - queuing_start

            # Verify queue state
            queue = await integration_workspace.get_operation_queue()
            actual_queue_size = len(queue.operations)
            performance_monitor.record_queue_size(actual_queue_size)

            # Process operations in batches for scalability testing
            processing_start = time.time()
            processed_count = 0
            batch_size = 50

            while processed_count < queue_size:
                batch_process_start = time.time()
                await integration_workspace.process_all_operations()

                # Count processed operations
                batch_processed = 0
                for op_id in operation_ids[
                    processed_count : processed_count + batch_size
                ]:
                    result = await integration_workspace.wait_for_operation_completion(
                        op_id, timeout_seconds=0.5
                    )
                    if result:
                        batch_processed += 1

                processed_count += batch_processed
                batch_time = time.time() - batch_process_start

                if batch_processed > 0:
                    print(
                        f"  Processed batch: {processed_count}/{queue_size} "
                        f"({batch_processed} ops in {batch_time:.2f}s)"
                    )

                # Prevent infinite loops
                if batch_processed == 0:
                    await asyncio.sleep(0.1)

                if time.time() - processing_start > 120:  # 2 minute timeout
                    break

            processing_time = time.time() - processing_start
            total_time = time.time() - phase_start

            # Calculate performance metrics
            throughput = processed_count / total_time if total_time > 0 else 0
            queuing_rate = queue_size / queuing_time if queuing_time > 0 else 0
            processing_rate = (
                processed_count / processing_time if processing_time > 0 else 0
            )

            scalability_results[queue_size] = {
                "queuing_time": queuing_time,
                "processing_time": processing_time,
                "total_time": total_time,
                "processed_count": processed_count,
                "throughput": throughput,
                "queuing_rate": queuing_rate,
                "processing_rate": processing_rate,
            }

            print(
                f"  Results: {processed_count}/{queue_size} ops processed "
                f"({throughput:.1f} ops/s overall)"
            )

            # Performance assertions for this queue size
            completion_rate = processed_count / queue_size * 100
            assert (
                completion_rate >= 70.0
            ), f"Should complete at least 70% of operations for queue size {queue_size}, got {completion_rate:.1f}%"  # noqa: E501

            # Queuing should be efficient
            assert (
                queuing_rate >= 50.0
            ), f"Queuing rate should be at least 50 ops/s for queue size {queue_size}, got {queuing_rate:.1f}"  # noqa: E501

        performance_monitor.stop_monitoring()

        # Analyze scalability trends
        print("\n=== Queue Scalability Performance Report ===")
        print(
            f"{'Queue Size':<12} {'Queuing':<10} {'Processing':<12} {'Total':<8} {'Throughput':<12} {'Success Rate'}"  # noqa: E501
        )
        print(f"{'':=<12} {'(s)':<10} {'(s)':<12} {'(s)':<8} {'(ops/s)':<12} {'(%)'}")

        for queue_size in queue_sizes:
            if queue_size in scalability_results:
                result = scalability_results[queue_size]
                success_rate = result["processed_count"] / queue_size * 100

                print(
                    f"{queue_size:<12} "
                    f"{result['queuing_time']:<10.2f} "
                    f"{result['processing_time']:<12.2f} "
                    f"{result['total_time']:<8.2f} "
                    f"{result['throughput']:<12.1f} "
                    f"{success_rate:<.1f}%"
                )

        # Scalability assertions
        # Throughput should not degrade severely with larger queues
        if len(scalability_results) >= 3:
            small_queue_throughput = scalability_results[queue_sizes[0]]["throughput"]
            large_queue_throughput = scalability_results[queue_sizes[-1]]["throughput"]

            if small_queue_throughput > 0:
                throughput_retention = large_queue_throughput / small_queue_throughput
                assert (
                    throughput_retention >= 0.3
                ), f"Throughput should not degrade severely with large queues: {throughput_retention:.2f}x retention"  # noqa: E501

        print("\nScalability analysis complete.")


class TestResourceUtilization:
    """Test resource utilization optimization under load."""

    @pytest.mark.asyncio
    async def test_cpu_utilization_efficiency(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test CPU utilization efficiency during operation processing."""
        # Monitor CPU usage during different operation patterns
        process = psutil.Process()

        # Baseline CPU usage
        baseline_cpu_samples = []
        for _ in range(5):
            baseline_cpu_samples.append(process.cpu_percent())
            await asyncio.sleep(0.2)

        baseline_cpu = statistics.mean(baseline_cpu_samples)
        print(f"Baseline CPU usage: {baseline_cpu:.1f}%")

        # Test 1: CPU-intensive operations (large content processing)
        print("Testing CPU-intensive operations...")

        cpu_intensive_start = time.time()
        cpu_samples_intensive = []

        # Generate operations with large content
        large_content = "# Large Content\n" + "This is a large content block.\n" * 1000

        intensive_ops = []
        for i in range(20):
            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.UPDATE_REQUIREMENTS,
                {
                    "specId": f"cpu-test-{i}",
                    "content": f"{large_content}\n## Section {i}",
                },
                priority=5,
            )
            intensive_ops.append(op_id)

            # Sample CPU usage
            cpu_samples_intensive.append(process.cpu_percent())
            await asyncio.sleep(0.1)

        # Process CPU-intensive operations
        await integration_workspace.process_all_operations()

        cpu_intensive_time = time.time() - cpu_intensive_start
        avg_cpu_intensive = statistics.mean([c for c in cpu_samples_intensive if c > 0])

        print(
            f"  CPU-intensive phase: {avg_cpu_intensive:.1f}% CPU, {cpu_intensive_time:.2f}s"
        )

        # Test 2: I/O intensive operations (many small operations)
        print("Testing I/O-intensive operations...")

        io_intensive_start = time.time()
        cpu_samples_io = []

        io_ops = []
        for i in range(50):
            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.CREATE_SPEC,
                {"name": f"I/O Test {i}", "specId": f"io-test-{i:03d}"},
                priority=6,
            )
            io_ops.append(op_id)

            # Sample CPU usage
            cpu_samples_io.append(process.cpu_percent())

            if i % 10 == 0:
                await integration_workspace.process_all_operations()

        # Final processing
        await integration_workspace.process_all_operations()

        io_intensive_time = time.time() - io_intensive_start
        avg_cpu_io = statistics.mean([c for c in cpu_samples_io if c > 0])

        print(f"  I/O-intensive phase: {avg_cpu_io:.1f}% CPU, {io_intensive_time:.2f}s")

        # CPU efficiency assertions
        # CPU usage should be reasonable (not maxed out constantly)
        assert (
            avg_cpu_intensive <= 80.0
        ), f"CPU usage should be reasonable during intensive operations: {avg_cpu_intensive:.1f}%"

        # I/O operations should be more CPU-efficient than CPU-intensive ones
        if avg_cpu_intensive > 0:
            cpu_efficiency_ratio = avg_cpu_io / avg_cpu_intensive
            assert (
                cpu_efficiency_ratio <= 1.5
            ), f"I/O operations should be more CPU-efficient: {cpu_efficiency_ratio:.2f}x"

        print("\n=== CPU Utilization Report ===")
        print(f"Baseline CPU: {baseline_cpu:.1f}%")
        print(f"CPU-intensive operations: {avg_cpu_intensive:.1f}%")
        print(f"I/O-intensive operations: {avg_cpu_io:.1f}%")

    @pytest.mark.asyncio
    async def test_file_system_io_efficiency(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test file system I/O efficiency under load."""
        # Test different file operation patterns

        # Pattern 1: Many small files
        print("Testing many small files pattern...")

        small_files_start = time.time()
        small_file_ops = []

        for i in range(100):
            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.CREATE_SPEC,
                {
                    "name": f"Small File Test {i}",
                    "specId": f"small-file-{i:03d}",
                },
                priority=5,
            )
            small_file_ops.append(op_id)

        await integration_workspace.process_all_operations()

        small_files_time = time.time() - small_files_start
        small_files_rate = len(small_file_ops) / small_files_time

        print(
            f"  Small files: {len(small_file_ops)} operations in {small_files_time:.2f}s ({small_files_rate:.1f} ops/s)"  # noqa: E501
        )

        # Pattern 2: Few large files
        print("Testing few large files pattern...")

        large_content = "# Large File Content\n" + ("Large content block.\n" * 2000)

        large_files_start = time.time()
        large_file_ops = []

        for i in range(10):
            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.UPDATE_REQUIREMENTS,
                {
                    "specId": f"small-file-{i:03d}",
                    "content": f"{large_content}\n## Version {i}",
                },
                priority=6,
            )
            large_file_ops.append(op_id)

        await integration_workspace.process_all_operations()

        large_files_time = time.time() - large_files_start
        large_files_rate = len(large_file_ops) / large_files_time

        print(
            f"  Large files: {len(large_file_ops)} operations in {large_files_time:.2f}s ({large_files_rate:.1f} ops/s)"  # noqa: E501
        )

        # Pattern 3: Mixed file sizes
        print("Testing mixed file sizes pattern...")

        mixed_files_start = time.time()
        mixed_file_ops = []

        for i in range(30):
            if i % 3 == 0:
                # Large file
                content = large_content + f"\n## Mixed {i}"
            else:
                # Small file
                content = (
                    f"# Small Mixed Content {i}\n\nSmall content for operation {i}."
                )

            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.UPDATE_DESIGN,
                {"specId": f"small-file-{i % 100:03d}", "content": content},
                priority=7,
            )
            mixed_file_ops.append(op_id)

        await integration_workspace.process_all_operations()

        mixed_files_time = time.time() - mixed_files_start
        mixed_files_rate = len(mixed_file_ops) / mixed_files_time

        print(
            f"  Mixed files: {len(mixed_file_ops)} operations in {mixed_files_time:.2f}s ({mixed_files_rate:.1f} ops/s)"  # noqa: E501
        )

        # I/O efficiency assertions
        assert (
            small_files_rate >= 10.0
        ), f"Small file operations should be efficient: {small_files_rate:.1f} ops/s"
        assert (
            large_files_rate >= 1.0
        ), f"Large file operations should complete: {large_files_rate:.1f} ops/s"
        assert (
            mixed_files_rate >= 5.0
        ), f"Mixed file operations should be balanced: {mixed_files_rate:.1f} ops/s"

        # Verify files exist and have correct sizes
        specs_created = len(
            list(integration_workspace.specs_dir.glob("small-file-*/spec.json"))
        )
        assert (
            specs_created >= 80
        ), f"Should create most specification files: {specs_created}/100"

        print("\n=== File System I/O Efficiency Report ===")
        print(f"Small files: {small_files_rate:.1f} ops/s")
        print(f"Large files: {large_files_rate:.1f} ops/s")
        print(f"Mixed files: {mixed_files_rate:.1f} ops/s")
        print(f"Specifications created: {specs_created}")

    @pytest.mark.asyncio
    async def test_resource_cleanup_efficiency(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test efficiency of resource cleanup operations."""
        # Generate a large number of operations and then test cleanup
        print("Generating operations for cleanup testing...")

        # Create operations in different states
        operations_created = 0

        # Completed operations (should be cleaned up)
        for i in range(50):
            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.CREATE_SPEC,
                {
                    "name": f"Cleanup Test Completed {i}",
                    "specId": f"cleanup-completed-{i:03d}",
                },
                priority=5,
            )
            operations_created += 1

        # Process these operations to completion
        await integration_workspace.process_all_operations()

        # Failed operations (should be cleaned up after max retries)
        for i in range(20):
            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.UPDATE_REQUIREMENTS,
                {
                    "specId": "nonexistent-spec",
                    "content": f"This will fail {i}",
                },  # Will fail
                priority=6,
            )
            operations_created += 1

        # Process failed operations
        await integration_workspace.process_all_operations()

        # Current operations (should not be cleaned up)
        current_ops = []
        for i in range(15):
            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.CREATE_SPEC,
                {
                    "name": f"Cleanup Test Current {i}",
                    "specId": f"cleanup-current-{i:02d}",
                },
                priority=7,
            )
            current_ops.append(op_id)
            operations_created += 1

        print(f"Created {operations_created} operations for cleanup testing")

        # Check initial queue size
        initial_queue = await integration_workspace.get_operation_queue()
        initial_queue_size = len(initial_queue.operations)

        print(f"Initial queue size: {initial_queue_size}")

        # Perform cleanup
        cleanup_start = time.time()

        # Clean up old operations (1 hour age limit for testing)
        await integration_workspace.queue_processor.cleanup_stale_operations()

        cleanup_time = time.time() - cleanup_start

        # Check queue size after cleanup
        final_queue = await integration_workspace.get_operation_queue()
        final_queue_size = len(final_queue.operations)

        operations_removed = initial_queue_size - final_queue_size
        cleanup_rate = operations_removed / cleanup_time if cleanup_time > 0 else 0

        print(
            f"Cleanup results: {operations_removed} operations removed in {cleanup_time:.3f}s ({cleanup_rate:.1f} ops/s)"  # noqa: E501
        )

        # Cleanup efficiency assertions
        assert cleanup_time <= 2.0, f"Cleanup should be fast: {cleanup_time:.3f}s"
        assert (
            operations_removed >= 10
        ), f"Should clean up at least some operations: {operations_removed}"
        assert (
            cleanup_rate >= 50.0
        ), f"Cleanup rate should be efficient: {cleanup_rate:.1f} ops/s"

        # Current operations should still exist
        remaining_current_ops = 0
        for op_id in current_ops:
            remaining_ops = [op for op in final_queue.operations if op.id == op_id]
            if remaining_ops:
                remaining_current_ops += 1

        assert (
            remaining_current_ops >= 10
        ), f"Current operations should not be cleaned up: {remaining_current_ops}/15"

        # Test sync state cleanup
        sync_cleanup_start = time.time()

        # Update sync state (should clean up old errors and conflicts)
        await integration_workspace.queue_processor.update_sync_state()

        sync_cleanup_time = time.time() - sync_cleanup_start

        sync_state = await integration_workspace.get_sync_state()

        # Sync state should be clean and efficient
        assert (
            len(sync_state.sync_errors) <= 10
        ), f"Sync errors should be bounded: {len(sync_state.sync_errors)}"
        assert (
            sync_cleanup_time <= 0.5
        ), f"Sync state update should be fast: {sync_cleanup_time:.3f}s"

        print("\n=== Resource Cleanup Efficiency Report ===")
        print(f"Operations removed: {operations_removed}")
        print(f"Cleanup time: {cleanup_time:.3f}s")
        print(f"Cleanup rate: {cleanup_rate:.1f} ops/s")
        print(f"Current operations preserved: {remaining_current_ops}/15")
        print(f"Sync state errors: {len(sync_state.sync_errors)}")
        print(f"Sync cleanup time: {sync_cleanup_time:.3f}s")
