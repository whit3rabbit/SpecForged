"""
Performance optimization tests for the SpecForge MCP ecosystem.

This test suite benchmarks and validates the performance improvements including:
- Operation batching
- Streaming JSON parsing
- LRU caching
- Memory management
- Queue size limits and cleanup
"""

import json
import os
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import Mock, patch

import pytest

# Add the src directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from specforged.core.queue_processor import (  # noqa: E402
    LRUCache,
    Operation,
    OperationBatcher,
    OperationQueue,
    OperationStatus,
    OperationType,
    QueueProcessor,
    StreamingJSONParser,
)
from specforged.core.spec_manager import SpecificationManager  # noqa: E402


class PerformanceBenchmark:
    """Performance benchmarking utilities."""

    @staticmethod
    def measure_time(func):
        """Decorator to measure function execution time."""

        def wrapper(*args, **kwargs):
            start_time = time.time()
            result = func(*args, **kwargs)
            end_time = time.time()
            execution_time = (end_time - start_time) * 1000  # Convert to milliseconds
            return result, execution_time

        return wrapper

    @staticmethod
    async def measure_async_time(coro):
        """Measure async coroutine execution time."""
        start_time = time.time()
        result = await coro
        end_time = time.time()
        execution_time = (end_time - start_time) * 1000  # Convert to milliseconds
        return result, execution_time

    @staticmethod
    def generate_large_operation_queue(num_operations: int) -> OperationQueue:
        """Generate a large operation queue for testing."""
        operations = []
        for i in range(num_operations):
            operation = Operation(
                id=f"test_op_{i}",
                type=OperationType.UPDATE_REQUIREMENTS,
                status=OperationStatus.PENDING,
                priority=5,
                timestamp=time.time(),
                params={
                    "specId": f"spec_{i % 10}",  # 10 different specs
                    "content": f"Large content block {i} " * 100,  # ~2KB per operation
                },
            )
            operations.append(operation)

        return OperationQueue(operations=operations)

    @staticmethod
    def create_mock_spec_manager():
        """Create a mock specification manager for testing."""
        mock_spec_manager = Mock(spec=SpecificationManager)
        mock_spec_manager.specs = {}
        mock_spec_manager.project_detector = Mock()
        mock_spec_manager.project_detector.project_root = Path("/tmp/test_project")
        mock_spec_manager.base_dir = Path("/tmp/test_project/specifications")
        return mock_spec_manager


class TestStreamingJSONParser:
    """Test suite for streaming JSON parser performance."""

    @pytest.mark.asyncio
    async def test_small_file_parsing(self):
        """Test parsing small JSON files (should use regular JSON)."""
        parser = StreamingJSONParser()

        # Create small test file
        small_queue = PerformanceBenchmark.generate_large_operation_queue(10)

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(small_queue.model_dump(), f, indent=2)
            temp_path = Path(f.name)

        try:
            # Measure parsing time
            result, parse_time = await PerformanceBenchmark.measure_async_time(
                parser.parse_large_queue(temp_path)
            )

            assert len(result.operations) == 10
            assert parse_time < 100  # Should be very fast for small files
            print(f"Small file (10 ops) parsed in {parse_time:.2f}ms")

        finally:
            temp_path.unlink()

    @pytest.mark.asyncio
    async def test_large_file_parsing(self):
        """Test parsing large JSON files (should use streaming)."""
        parser = StreamingJSONParser()

        # Create large test file (1000 operations ~2MB)
        large_queue = PerformanceBenchmark.generate_large_operation_queue(1000)

        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(large_queue.model_dump(), f, indent=2)
            temp_path = Path(f.name)

        try:
            file_size_mb = temp_path.stat().st_size / (1024 * 1024)
            print(f"Large file size: {file_size_mb:.2f}MB")

            # Measure parsing time
            result, parse_time = await PerformanceBenchmark.measure_async_time(
                parser.parse_large_queue(temp_path)
            )

            assert len(result.operations) == 1000
            print(
                f"Large file (1000 ops, {file_size_mb:.2f}MB) parsed in {parse_time:.2f}ms"
            )

            # Performance target: should parse at least 1MB per second
            expected_max_time = file_size_mb * 1000  # 1 second per MB
            assert (
                parse_time < expected_max_time
            ), f"Parsing too slow: {parse_time}ms > {expected_max_time}ms"

        finally:
            temp_path.unlink()

    @pytest.mark.asyncio
    async def test_corrupted_file_handling(self):
        """Test handling of corrupted JSON files."""
        parser = StreamingJSONParser()

        # Create corrupted JSON file
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            f.write('{"operations": [{"invalid": json}]}')
            temp_path = Path(f.name)

        try:
            result = await parser.parse_large_queue(temp_path)
            assert len(result.operations) == 0  # Should return empty queue on error
        finally:
            temp_path.unlink()


class TestLRUCache:
    """Test suite for LRU cache performance."""

    def test_cache_basic_operations(self):
        """Test basic cache operations."""
        cache = LRUCache(max_size=100)

        # Test put and get
        cache.put("key1", "value1")
        assert cache.get("key1") == "value1"
        assert cache.size() == 1

        # Test cache miss
        assert cache.get("nonexistent") is None

        # Test hit rate calculation
        assert cache.get_hit_rate() == 0.5  # 1 hit, 1 miss

    def test_cache_lru_eviction(self):
        """Test LRU eviction policy."""
        cache = LRUCache(max_size=3)

        # Fill cache
        cache.put("key1", "value1")
        cache.put("key2", "value2")
        cache.put("key3", "value3")
        assert cache.size() == 3

        # Access key1 to make it recently used
        cache.get("key1")

        # Add another item, should evict key2 (least recently used)
        cache.put("key4", "value4")
        assert cache.size() == 3
        assert cache.get("key1") == "value1"  # Still exists
        assert cache.get("key2") is None  # Evicted
        assert cache.get("key3") == "value3"  # Still exists
        assert cache.get("key4") == "value4"  # New item

    def test_cache_performance(self):
        """Test cache performance with large datasets."""
        cache = LRUCache(max_size=1000)

        # Measure put performance
        start_time = time.time()
        for i in range(1000):
            cache.put(f"key_{i}", f"value_{i}")
        put_time = (time.time() - start_time) * 1000

        # Measure get performance
        start_time = time.time()
        for i in range(1000):
            cache.get(f"key_{i}")
        get_time = (time.time() - start_time) * 1000

        print(
            f"Cache PUT performance: {put_time:.2f}ms for 1000 items ({put_time / 1000:.3f}ms per item)"  # noqa: E501
        )
        print(
            f"Cache GET performance: {get_time:.2f}ms for 1000 items ({get_time / 1000:.3f}ms per item)"  # noqa: E501
        )

        # Performance targets
        assert put_time < 100, f"PUT operations too slow: {put_time}ms"
        assert get_time < 50, f"GET operations too slow: {get_time}ms"
        assert cache.get_hit_rate() == 1.0  # All items should be hits


class TestOperationBatcher:
    """Test suite for operation batching performance."""

    def test_batch_creation(self):
        """Test creation of operation batches."""
        batcher = OperationBatcher(max_batch_size=10)

        # Create operations for different specs and types
        operations = []
        for i in range(25):
            op = Operation(
                id=f"op_{i}",
                type=(
                    OperationType.UPDATE_REQUIREMENTS
                    if i % 2 == 0
                    else OperationType.UPDATE_DESIGN
                ),
                status=OperationStatus.PENDING,
                priority=5,
                timestamp=time.time(),
                params={"specId": f"spec_{i % 3}"},  # 3 different specs
            )
            operations.append(op)

        batches = batcher.group_operations(operations)

        # Should create multiple batches
        assert len(batches) > 1

        # Each batch should not exceed max size
        for batch in batches:
            assert len(batch) <= 10

        # All operations should be included
        total_ops = sum(len(batch) for batch in batches)
        assert total_ops == 25

    def test_batch_compatibility(self):
        """Test operation compatibility for batching."""
        batcher = OperationBatcher()

        # Same type, same spec - should be compatible
        op1 = Operation(
            id="op1",
            type=OperationType.UPDATE_REQUIREMENTS,
            status=OperationStatus.PENDING,
            priority=5,
            timestamp=time.time(),
            params={"specId": "spec1"},
        )
        op2 = Operation(
            id="op2",
            type=OperationType.UPDATE_REQUIREMENTS,
            status=OperationStatus.PENDING,
            priority=5,
            timestamp=time.time(),
            params={"specId": "spec1"},
        )

        assert batcher.can_batch_together(op1, op2)

        # Different specs - should not be compatible for same type
        op3 = Operation(
            id="op3",
            type=OperationType.UPDATE_REQUIREMENTS,
            status=OperationStatus.PENDING,
            priority=5,
            timestamp=time.time(),
            params={"specId": "spec2"},
        )

        assert not batcher.can_batch_together(op1, op3)

        # Different types, same spec - might be compatible
        op4 = Operation(
            id="op4",
            type=OperationType.UPDATE_DESIGN,
            status=OperationStatus.PENDING,
            priority=5,
            timestamp=time.time(),
            params={"specId": "spec1"},
        )

        assert batcher.can_batch_together(op1, op4)


class TestQueueProcessorPerformance:
    """Test suite for queue processor performance optimizations."""

    @pytest.fixture
    def mock_queue_processor(self):
        """Create a mock queue processor for testing."""
        mock_spec_manager = PerformanceBenchmark.create_mock_spec_manager()

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            processor = QueueProcessor(mock_spec_manager, temp_path)
            yield processor

    @pytest.mark.asyncio
    async def test_queue_loading_performance(self, mock_queue_processor):
        """Test queue loading performance with large queues."""
        # Create large queue file
        large_queue = PerformanceBenchmark.generate_large_operation_queue(1000)

        # Write to queue file
        queue_data = large_queue.model_dump()
        with open(mock_queue_processor.queue_file, "w") as f:
            json.dump(queue_data, f, indent=2)

        file_size_mb = mock_queue_processor.queue_file.stat().st_size / (1024 * 1024)

        # Measure loading performance
        result, load_time = await PerformanceBenchmark.measure_async_time(
            mock_queue_processor.load_operation_queue()
        )

        assert len(result.operations) == 1000
        print(f"Queue loading: {file_size_mb:.2f}MB loaded in {load_time:.2f}ms")

        # Performance target: should load at least 1MB per second
        expected_max_time = file_size_mb * 1000
        assert (
            load_time < expected_max_time
        ), f"Loading too slow: {load_time}ms > {expected_max_time}ms"

    @pytest.mark.asyncio
    async def test_queue_saving_performance(self, mock_queue_processor):
        """Test queue saving performance with large queues."""
        large_queue = PerformanceBenchmark.generate_large_operation_queue(1000)

        # Measure saving performance
        result, save_time = await PerformanceBenchmark.measure_async_time(
            mock_queue_processor.save_operation_queue(large_queue)
        )

        file_size_mb = mock_queue_processor.queue_file.stat().st_size / (1024 * 1024)
        print(f"Queue saving: {file_size_mb:.2f}MB saved in {save_time:.2f}ms")

        # Performance target: should save at least 0.5MB per second
        expected_max_time = file_size_mb * 2000
        assert (
            save_time < expected_max_time
        ), f"Saving too slow: {save_time}ms > {expected_max_time}ms"

    @pytest.mark.asyncio
    async def test_operation_caching_performance(self, mock_queue_processor):
        """Test operation caching performance."""
        # Create test operations
        operations = []
        for i in range(100):
            op = Operation(
                id=f"cache_test_op_{i}",
                type=OperationType.UPDATE_REQUIREMENTS,
                status=OperationStatus.PENDING,
                priority=5,
                timestamp=time.time(),
                params={
                    "specId": f"spec_{i % 10}",
                    "content": f"Test content {i}",
                },
            )
            operations.append(op)

        # Test cache key generation performance
        start_time = time.time()
        cache_keys = []
        for op in operations:
            key = mock_queue_processor._get_operation_cache_key(op)
            cache_keys.append(key)
        key_gen_time = (time.time() - start_time) * 1000

        print(f"Cache key generation: {key_gen_time:.2f}ms for 100 operations")
        assert key_gen_time < 50, f"Key generation too slow: {key_gen_time}ms"

        # Test cache performance
        cache = mock_queue_processor.operation_cache

        # Put items in cache
        start_time = time.time()
        for i, key in enumerate(cache_keys):
            cache.put(
                key,
                {
                    "result": {"success": True, "data": f"result_{i}"},
                    "timestamp": time.time() * 1000,
                    "operation_signature": f"sig_{i}",
                },
            )
        put_time = (time.time() - start_time) * 1000

        # Get items from cache
        start_time = time.time()
        hit_count = 0
        for key in cache_keys:
            if cache.get(key):
                hit_count += 1
        get_time = (time.time() - start_time) * 1000

        print(f"Cache PUT: {put_time:.2f}ms for 100 items")
        print(
            f"Cache GET: {get_time:.2f}ms for 100 items (hit rate: {hit_count / 100 * 100:.1f}%)"
        )

        assert put_time < 50, f"Cache PUT too slow: {put_time}ms"
        assert get_time < 25, f"Cache GET too slow: {get_time}ms"
        assert hit_count >= 90, f"Cache hit rate too low: {hit_count}/100"

    @pytest.mark.asyncio
    async def test_memory_optimization(self, mock_queue_processor):
        """Test memory optimization features."""
        # Get initial memory usage
        initial_memory = mock_queue_processor._get_memory_usage_mb()

        # Create and process a large number of operations to increase memory usage
        large_queue = PerformanceBenchmark.generate_large_operation_queue(500)
        await mock_queue_processor.save_operation_queue(large_queue)

        # Fill cache with data
        cache = mock_queue_processor.operation_cache
        for i in range(1000):
            cache.put(
                f"mem_test_key_{i}",
                {
                    "result": {"data": f"large_data_block_{i}" * 100},
                    "timestamp": time.time() * 1000,
                    "operation_signature": f"sig_{i}",
                },
            )

        memory_with_data = mock_queue_processor._get_memory_usage_mb()
        memory_increase = memory_with_data - initial_memory

        print(
            f"Memory usage: {initial_memory:.2f}MB -> {memory_with_data:.2f}MB (+{memory_increase:.2f}MB)"  # noqa: E501
        )

        # Run optimization
        optimization_results = await mock_queue_processor.optimize_performance()

        final_memory = mock_queue_processor._get_memory_usage_mb()
        memory_saved = memory_with_data - final_memory

        print(
            f"Memory after optimization: {final_memory:.2f}MB (-{memory_saved:.2f}MB saved)"
        )
        print(f"Optimization results: {optimization_results}")

        # Should save some memory if cache was cleared due to high usage
        if memory_with_data > mock_queue_processor.perf_config.memory_limit_mb:
            assert memory_saved > 0, "Memory optimization should reduce memory usage"

    def test_performance_metrics_tracking(self, mock_queue_processor):
        """Test performance metrics tracking."""
        metrics = mock_queue_processor.get_performance_metrics()

        # Check metrics structure
        assert hasattr(metrics, "operations_processed")
        assert hasattr(metrics, "avg_processing_time_ms")
        assert hasattr(metrics, "memory_usage_mb")
        assert hasattr(metrics, "cache_hit_rate")
        assert hasattr(metrics, "queue_throughput")
        assert hasattr(metrics, "batch_efficiency")

        # Initial values should be reasonable
        assert metrics.operations_processed >= 0
        assert metrics.memory_usage_mb >= 0
        assert 0 <= metrics.cache_hit_rate <= 1

        print(f"Performance metrics: {metrics}")


class TestPerformanceRegression:
    """Test suite for performance regression detection."""

    @pytest.mark.asyncio
    async def test_queue_processing_throughput(self):
        """Test overall queue processing throughput."""
        mock_spec_manager = PerformanceBenchmark.create_mock_spec_manager()

        with tempfile.TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            processor = QueueProcessor(mock_spec_manager, temp_path)

            # Create test queue with various operation types
            operations = []
            for i in range(100):
                op_type = [
                    OperationType.UPDATE_REQUIREMENTS,
                    OperationType.UPDATE_DESIGN,
                    OperationType.UPDATE_TASKS,
                    OperationType.ADD_USER_STORY,
                ][i % 4]

                operation = Operation(
                    id=f"throughput_test_{i}",
                    type=op_type,
                    status=OperationStatus.PENDING,
                    priority=5,
                    timestamp=time.time(),
                    params={
                        "specId": f"spec_{i % 10}",
                        "content": f"Test content {i}",
                    },
                )
                operations.append(operation)

            test_queue = OperationQueue(operations=operations)
            await processor.save_operation_queue(test_queue)

            # Measure processing time
            start_time = time.time()

            # Mock the actual operation processing to avoid file system dependencies
            with patch.object(
                processor, "route_operation", return_value={"success": True}
            ):
                loaded_queue = await processor.load_operation_queue()
                pending_ops = [
                    op
                    for op in loaded_queue.operations
                    if op.status == OperationStatus.PENDING
                ]

                # Process with batching
                processed_count = await processor._process_operations_with_batching(
                    pending_ops, loaded_queue
                )

            processing_time = (time.time() - start_time) * 1000
            throughput = processed_count / (processing_time / 1000)  # ops per second

            print(
                f"Throughput test: {processed_count} operations in {processing_time:.2f}ms"
            )
            print(f"Throughput: {throughput:.2f} operations/second")

            # Performance targets
            assert (
                processed_count == 100
            ), f"Not all operations processed: {processed_count}/100"
            assert (
                throughput >= 50
            ), f"Throughput too low: {throughput} ops/sec (target: 50+ ops/sec)"
            assert (
                processing_time < 5000
            ), f"Processing too slow: {processing_time}ms (target: <5000ms)"


if __name__ == "__main__":
    # Run performance tests
    import pytest

    pytest.main([__file__, "-v", "-s"])
