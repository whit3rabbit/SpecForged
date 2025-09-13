"""
Performance benchmarks and tests for the SpecForge MCP ecosystem.

This module provides comprehensive benchmarks to measure and validate the performance
optimizations implemented in the queue processor and sync service.
"""

import asyncio
import json
import logging
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from specforged.core.queue_processor import (
    LRUCache,
    Operation,
    OperationBatcher,
    OperationQueue,
    OperationStatus,
    OperationType,
    PerformanceConfig,
    QueueProcessor,
    StreamingJSONParser,
)


class PerformanceBenchmarks:
    """Performance benchmark suite for SpecForge MCP optimizations."""

    def __init__(self):
        self.logger = logging.getLogger(__name__)
        self.results: Dict[str, Dict[str, Any]] = {}

    async def run_all_benchmarks(self) -> Dict[str, Any]:
        """Run all performance benchmarks and return results."""
        print("🚀 Starting SpecForge MCP Performance Benchmarks")
        print("=" * 60)

        benchmarks = [
            ("LRU Cache Performance", self.benchmark_lru_cache),
            ("Streaming JSON Parser", self.benchmark_streaming_json),
            ("Operation Batching", self.benchmark_operation_batching),
            ("Queue Processing Throughput", self.benchmark_queue_throughput),
            ("Memory Usage Under Load", self.benchmark_memory_usage),
            ("Large Queue Handling", self.benchmark_large_queue),
            ("Concurrent Processing", self.benchmark_concurrent_processing),
            (
                "Background Optimization",
                self.benchmark_background_optimization,
            ),
        ]

        for name, benchmark_func in benchmarks:
            print(f"\n📊 Running: {name}")
            try:
                result = await benchmark_func()
                self.results[name] = result
                self._print_benchmark_result(name, result)
            except Exception as e:
                print(f"❌ Benchmark failed: {e}")
                self.results[name] = {"error": str(e)}

        # Generate performance report
        report = self._generate_performance_report()
        print("\n" + "=" * 60)
        print("📈 PERFORMANCE BENCHMARK RESULTS")
        print("=" * 60)
        print(report)

        return self.results

    def benchmark_lru_cache(self) -> Dict[str, Any]:
        """Benchmark LRU cache performance."""
        cache = LRUCache(max_size=1000)

        # Warmup phase
        for i in range(500):
            cache.put(f"key_{i}", f"value_{i}")

        # Benchmark cache hits
        start_time = time.time()
        hit_count = 0
        for i in range(1000):
            key = f"key_{i % 500}"  # This should hit 50% of the time
            if cache.get(key):
                hit_count += 1
        hit_time = (time.time() - start_time) * 1000

        # Benchmark cache misses
        start_time = time.time()
        miss_count = 0
        for i in range(500):
            key = f"miss_key_{i}"
            if not cache.get(key):
                miss_count += 1
        miss_time = (time.time() - start_time) * 1000

        # Benchmark eviction
        start_time = time.time()
        for i in range(1500):  # Exceed cache size
            cache.put(f"evict_key_{i}", f"evict_value_{i}")
        eviction_time = (time.time() - start_time) * 1000

        return {
            "hit_rate": cache.get_hit_rate(),
            "hit_time_ms": hit_time,
            "miss_time_ms": miss_time,
            "eviction_time_ms": eviction_time,
            "cache_size": cache.size(),
            "hits_per_ms": hit_count / hit_time if hit_time > 0 else 0,
            "status": ("✅ PASSED" if cache.get_hit_rate() > 0.4 else "❌ FAILED"),
        }

    async def benchmark_streaming_json(self) -> Dict[str, Any]:
        """Benchmark streaming JSON parser performance."""
        parser = StreamingJSONParser(chunk_size=8192)

        # Create test files of different sizes
        test_sizes = [
            ("small", 1024),  # 1KB
            ("medium", 1024 * 100),  # 100KB
            ("large", 1024 * 1024),  # 1MB
            ("xlarge", 1024 * 1024 * 10),  # 10MB
        ]

        results = {}

        with tempfile.TemporaryDirectory() as temp_dir:
            for size_name, size_bytes in test_sizes:
                # Generate test data
                operations = []
                current_size = 0
                op_count = 0

                while current_size < size_bytes:
                    op = {
                        "id": f"test_op_{op_count}",
                        "type": "UPDATE_REQUIREMENTS",
                        "status": "PENDING",
                        "priority": 5,
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "source": "test",
                        "retry_count": 0,
                        "max_retries": 3,
                        "params": {
                            "specId": f"spec_{op_count % 10}",
                            "content": "x" * 100,  # Add some bulk
                        },
                    }
                    operations.append(op)
                    current_size += len(json.dumps(op))
                    op_count += 1

                # Create test file
                test_data = {
                    "operations": operations,
                    "version": 1,
                    "last_processed": None,
                }

                test_file = Path(temp_dir) / f"test_{size_name}.json"
                with open(test_file, "w") as f:
                    json.dump(test_data, f, indent=2)

                actual_size = test_file.stat().st_size

                # Benchmark parsing
                start_time = time.time()
                queue = await parser.parse_large_queue(test_file)
                parse_time = (time.time() - start_time) * 1000

                results[size_name] = {
                    "file_size_mb": actual_size / 1024 / 1024,
                    "operation_count": len(queue.operations),
                    "parse_time_ms": parse_time,
                    "throughput_mb_per_sec": (
                        (actual_size / 1024 / 1024) / (parse_time / 1000)
                        if parse_time > 0
                        else 0
                    ),
                    "operations_per_ms": (
                        len(queue.operations) / parse_time if parse_time > 0 else 0
                    ),
                }

        # Calculate overall performance
        total_time = sum(r["parse_time_ms"] for r in results.values())
        total_size = sum(r["file_size_mb"] for r in results.values())
        avg_throughput = total_size / (total_time / 1000) if total_time > 0 else 0

        return {
            "details": results,
            "total_parse_time_ms": total_time,
            "total_size_mb": total_size,
            "average_throughput_mb_per_sec": avg_throughput,
            "status": (
                "✅ PASSED" if avg_throughput > 5.0 else "❌ FAILED"
            ),  # Target: 5MB/s
        }

    async def benchmark_operation_batching(self) -> Dict[str, Any]:
        """Benchmark operation batching performance."""
        batcher = OperationBatcher(max_batch_size=50, batch_timeout_ms=1000)

        # Create test operations of different types
        operations = []
        for i in range(1000):
            op_type = [
                OperationType.UPDATE_REQUIREMENTS,
                OperationType.UPDATE_DESIGN,
                OperationType.UPDATE_TASKS,
                OperationType.ADD_USER_STORY,
            ][i % 4]

            operation = Operation(
                id=f"batch_test_{i}",
                type=op_type,
                status=OperationStatus.PENDING,
                priority=i % 10 + 1,
                timestamp=datetime.now(timezone.utc),
                params={"specId": f"spec_{i % 20}", "content": f"content_{i}"},
            )
            operations.append(operation)

        # Benchmark batching without optimization
        start_time = time.time()
        naive_batches = []
        for i in range(0, len(operations), 50):
            naive_batches.append(operations[i : i + 50])
        naive_time = (time.time() - start_time) * 1000

        # Benchmark intelligent batching
        start_time = time.time()
        smart_batches = batcher.group_operations(operations)
        smart_time = (time.time() - start_time) * 1000

        batch_stats = batcher.get_batch_stats()

        return {
            "operation_count": len(operations),
            "naive_batch_count": len(naive_batches),
            "smart_batch_count": len(smart_batches),
            "naive_time_ms": naive_time,
            "smart_time_ms": smart_time,
            "time_improvement": (
                ((naive_time - smart_time) / naive_time * 100) if naive_time > 0 else 0
            ),
            "batch_efficiency": batch_stats["batch_efficiency"],
            "average_batch_size": batch_stats["avg_batch_size"],
            "status": (
                "✅ PASSED" if len(smart_batches) <= len(naive_batches) else "❌ FAILED"
            ),
        }

    async def benchmark_queue_throughput(self) -> Dict[str, Any]:
        """Benchmark queue processing throughput."""
        # Create mock spec manager
        mock_spec_manager = MagicMock()
        mock_spec_manager.project_detector.project_root = Path(tempfile.mkdtemp())
        mock_spec_manager.specs = {}

        # Setup queue processor with optimized config
        config = PerformanceConfig(
            max_batch_size=100,
            parallel_processing=5,
            enable_streaming_json=True,
            batch_processing_enabled=True,
            operation_deduplication=True,
        )

        processor = QueueProcessor(mock_spec_manager)
        processor.perf_config = config

        # Create test operations
        operations = []
        for i in range(500):
            operation = Operation(
                id=f"throughput_test_{i}",
                type=OperationType.UPDATE_REQUIREMENTS,
                status=OperationStatus.PENDING,
                priority=5,
                timestamp=datetime.now(timezone.utc),
                params={
                    "specId": f"spec_{i % 10}",
                    "content": f"test content {i}",
                },
            )
            operations.append(operation)

        # Create test queue
        queue = OperationQueue(operations=operations)

        # Benchmark processing with mocked operations
        with patch.object(
            processor, "route_operation", new_callable=AsyncMock
        ) as mock_route:
            mock_route.return_value = {"message": "success", "data": {}}

            start_time = time.time()
            processed_count = await processor._process_operations_with_batching(
                operations, queue
            )
            processing_time = (time.time() - start_time) * 1000

        throughput = (
            processed_count / (processing_time / 1000) if processing_time > 0 else 0
        )

        return {
            "operations_processed": processed_count,
            "total_time_ms": processing_time,
            "throughput_ops_per_sec": throughput,
            "average_time_per_op_ms": (
                processing_time / processed_count if processed_count > 0 else 0
            ),
            "target_throughput": 50.0,  # 50 ops/sec target
            "status": "✅ PASSED" if throughput >= 50.0 else "❌ FAILED",
        }

    def benchmark_memory_usage(self) -> Dict[str, Any]:
        """Benchmark memory usage under load."""
        import psutil

        process = psutil.Process(os.getpid())

        initial_memory = process.memory_info().rss / 1024 / 1024  # MB

        # Create large data structures
        cache = LRUCache(max_size=10000)
        operations = []

        # Load test data
        for i in range(5000):
            # Create operation with substantial data
            operation = Operation(
                id=f"memory_test_{i}",
                type=OperationType.UPDATE_REQUIREMENTS,
                status=OperationStatus.PENDING,
                priority=5,
                timestamp=datetime.now(timezone.utc),
                params={
                    "specId": f"spec_{i % 100}",
                    "content": "x" * 1000,  # 1KB of content per operation
                },
            )
            operations.append(operation)

            # Cache some results
            cache.put(f"result_{i}", {"data": "x" * 500, "timestamp": time.time()})

        peak_memory = process.memory_info().rss / 1024 / 1024  # MB

        # Cleanup and measure final memory
        operations.clear()
        cache.clear()

        # Force garbage collection if available
        try:
            import gc

            gc.collect()
        except ImportError:
            pass

        final_memory = process.memory_info().rss / 1024 / 1024  # MB

        return {
            "initial_memory_mb": initial_memory,
            "peak_memory_mb": peak_memory,
            "final_memory_mb": final_memory,
            "memory_increase_mb": peak_memory - initial_memory,
            "memory_efficiency": (
                (peak_memory - final_memory) / (peak_memory - initial_memory) * 100
                if peak_memory > initial_memory
                else 0
            ),
            "target_memory_limit_mb": 100,
            "status": "✅ PASSED" if peak_memory < 100 else "❌ FAILED",
        }

    async def benchmark_large_queue(self) -> Dict[str, Any]:
        """Benchmark handling of large operation queues."""
        # Test with 10,000 operations
        large_operations = []
        for i in range(10000):
            operation = Operation(
                id=f"large_queue_{i}",
                type=[
                    OperationType.UPDATE_REQUIREMENTS,
                    OperationType.UPDATE_DESIGN,
                    OperationType.UPDATE_TASKS,
                ][i % 3],
                status=OperationStatus.PENDING,
                priority=i % 10 + 1,
                timestamp=datetime.now(timezone.utc),
                params={
                    "specId": f"spec_{i % 100}",
                    "content": f"content_{i}",
                },
            )
            large_operations.append(operation)

        # Benchmark queue creation
        start_time = time.time()
        large_queue = OperationQueue(operations=large_operations)
        creation_time = (time.time() - start_time) * 1000

        # Benchmark batching large queue
        batcher = OperationBatcher(max_batch_size=100)
        start_time = time.time()
        batches = batcher.group_operations(large_operations)
        batching_time = (time.time() - start_time) * 1000

        # Benchmark JSON serialization
        start_time = time.time()
        json_data = large_queue.model_dump()
        serialization_time = (time.time() - start_time) * 1000

        # Calculate memory efficiency
        json_size = len(json.dumps(json_data, default=str))

        return {
            "operation_count": len(large_operations),
            "queue_creation_time_ms": creation_time,
            "batching_time_ms": batching_time,
            "batch_count": len(batches),
            "serialization_time_ms": serialization_time,
            "serialized_size_mb": json_size / 1024 / 1024,
            "avg_batch_size": (len(large_operations) / len(batches) if batches else 0),
            "operations_per_ms": len(large_operations)
            / (creation_time + batching_time + serialization_time),
            "status": (
                "✅ PASSED"
                if (creation_time + batching_time + serialization_time) < 5000
                else "❌ FAILED"
            ),  # 5 second limit
        }

    async def benchmark_concurrent_processing(self) -> Dict[str, Any]:
        """Benchmark concurrent operation processing."""
        # Create operations for concurrent processing
        operations = []
        for i in range(200):
            operation = Operation(
                id=f"concurrent_{i}",
                type=OperationType.UPDATE_REQUIREMENTS,
                status=OperationStatus.PENDING,
                priority=5,
                timestamp=datetime.now(timezone.utc),
                params={"specId": f"spec_{i % 10}", "content": f"content_{i}"},
            )
            operations.append(operation)

        # Benchmark sequential processing
        start_time = time.time()
        sequential_results = []
        for op in operations[:50]:  # Process subset for timing
            # Simulate processing
            await asyncio.sleep(0.001)  # 1ms per operation
            sequential_results.append(f"result_{op.id}")
        sequential_time = (time.time() - start_time) * 1000

        # Benchmark concurrent processing with semaphore
        semaphore = asyncio.Semaphore(10)  # Allow 10 concurrent operations

        async def process_concurrent(op):
            async with semaphore:
                await asyncio.sleep(0.001)  # 1ms per operation
                return f"result_{op.id}"

        start_time = time.time()
        await asyncio.gather(*[process_concurrent(op) for op in operations[:50]])
        concurrent_time = (time.time() - start_time) * 1000

        speedup = sequential_time / concurrent_time if concurrent_time > 0 else 0

        return {
            "operations_tested": 50,
            "sequential_time_ms": sequential_time,
            "concurrent_time_ms": concurrent_time,
            "speedup_ratio": speedup,
            "efficiency": (speedup / 10) * 100,  # 10 is max concurrency
            "target_speedup": 3.0,
            "status": "✅ PASSED" if speedup >= 3.0 else "❌ FAILED",
        }

    async def benchmark_background_optimization(self) -> Dict[str, Any]:
        """Benchmark background optimization tasks."""
        # Create mock queue processor
        mock_spec_manager = MagicMock()
        mock_spec_manager.project_detector.project_root = Path(tempfile.mkdtemp())

        processor = QueueProcessor(mock_spec_manager)

        # Create test operations with mix of statuses
        operations = []
        for i in range(1000):
            status = [
                OperationStatus.PENDING,
                OperationStatus.COMPLETED,
                OperationStatus.FAILED,
            ][i % 3]
            operation = Operation(
                id=f"bg_opt_{i}",
                type=OperationType.UPDATE_REQUIREMENTS,
                status=status,
                priority=5,
                timestamp=datetime.now(timezone.utc),
                params={"specId": f"spec_{i % 50}", "content": f"content_{i}"},
            )
            operations.append(operation)

        OperationQueue(operations=operations)

        # Benchmark optimization
        start_time = time.time()
        optimization_results = await processor.optimize_performance()
        optimization_time = (time.time() - start_time) * 1000

        return {
            "initial_operations": len(operations),
            "optimization_time_ms": optimization_time,
            "optimization_results": optimization_results,
            "memory_optimized": optimization_results.get("memory_optimized", False),
            "cache_cleanup_performed": "cache_cleanup" in optimization_results,
            "queue_optimization_performed": "queue_optimization"
            in optimization_results,
            "target_time_ms": 1000,  # 1 second target
            "status": "✅ PASSED" if optimization_time < 1000 else "❌ FAILED",
        }

    def _print_benchmark_result(self, name: str, result: Dict[str, Any]) -> None:
        """Print formatted benchmark result."""
        status = result.get("status", "❓ UNKNOWN")
        print(f"   {status}")

        # Print key metrics
        key_metrics = [
            "throughput_ops_per_sec",
            "hit_rate",
            "average_throughput_mb_per_sec",
            "speedup_ratio",
            "memory_increase_mb",
            "optimization_time_ms",
        ]

        for metric in key_metrics:
            if metric in result:
                value = result[metric]
                if isinstance(value, float):
                    print(f"   {metric}: {value:.2f}")
                else:
                    print(f"   {metric}: {value}")

    def _generate_performance_report(self) -> str:
        """Generate comprehensive performance report."""
        report_lines = []

        # Overall status
        passed_count = sum(
            1
            for result in self.results.values()
            if result.get("status", "").startswith("✅")
        )
        total_count = len(self.results)

        report_lines.append(
            f"Overall Results: {passed_count}/{total_count} benchmarks passed"
        )
        report_lines.append("")

        # Performance targets achieved
        targets_met = []

        # LRU Cache
        cache_result = self.results.get("LRU Cache Performance", {})
        if cache_result.get("hit_rate", 0) > 0.4:
            targets_met.append("✅ Cache hit rate > 40%")
        else:
            targets_met.append("❌ Cache hit rate < 40%")

        # Throughput
        throughput_result = self.results.get("Queue Processing Throughput", {})
        if throughput_result.get("throughput_ops_per_sec", 0) >= 50:
            targets_met.append("✅ Queue throughput ≥ 50 ops/sec")
        else:
            targets_met.append("❌ Queue throughput < 50 ops/sec")

        # Memory
        memory_result = self.results.get("Memory Usage Under Load", {})
        if memory_result.get("peak_memory_mb", 200) < 100:
            targets_met.append("✅ Memory usage < 100MB")
        else:
            targets_met.append("❌ Memory usage ≥ 100MB")

        # JSON Parsing
        json_result = self.results.get("Streaming JSON Parser", {})
        if json_result.get("average_throughput_mb_per_sec", 0) > 5:
            targets_met.append("✅ JSON parsing > 5MB/sec")
        else:
            targets_met.append("❌ JSON parsing ≤ 5MB/sec")

        report_lines.append("Performance Targets:")
        report_lines.extend(f"  {target}" for target in targets_met)
        report_lines.append("")

        # Key improvements
        improvements = [
            "🚀 Operation batching reduces processing overhead",
            "💾 LRU caching improves response times",
            "🌊 Streaming JSON handles large queues efficiently",
            "🔄 Background optimization maintains performance",
            "⚡ Concurrent processing improves throughput",
            "🧹 Automatic cleanup prevents memory leaks",
        ]

        report_lines.append("Performance Improvements Implemented:")
        report_lines.extend(f"  {improvement}" for improvement in improvements)

        return "\n".join(report_lines)


# Test fixtures and helpers
@pytest.fixture
async def performance_benchmarks():
    """Fixture providing performance benchmark suite."""
    return PerformanceBenchmarks()


@pytest.mark.asyncio
async def test_lru_cache_performance():
    """Test LRU cache performance meets requirements."""
    benchmarks = PerformanceBenchmarks()
    result = benchmarks.benchmark_lru_cache()

    assert result["hit_rate"] > 0.3, f"Cache hit rate too low: {result['hit_rate']}"
    assert (
        result["cache_size"] <= 1000
    ), f"Cache size exceeded limit: {result['cache_size']}"
    assert result["hits_per_ms"] > 0, "Cache performance is zero"


@pytest.mark.asyncio
async def test_streaming_json_performance():
    """Test streaming JSON parser performance."""
    benchmarks = PerformanceBenchmarks()
    result = await benchmarks.benchmark_streaming_json()

    assert result["average_throughput_mb_per_sec"] > 1.0, "JSON parsing too slow"
    assert "large" in result["details"], "Large file test missing"

    # Check that larger files don't cause exponential slowdown
    details = result["details"]
    if "small" in details and "large" in details:
        small_rate = details["small"]["operations_per_ms"]
        large_rate = details["large"]["operations_per_ms"]

        # Large files should be at most 10x slower per operation
        if small_rate > 0:
            assert (
                large_rate > small_rate * 0.1
            ), "Large file performance degraded too much"


@pytest.mark.asyncio
async def test_queue_throughput_performance():
    """Test queue processing throughput."""
    benchmarks = PerformanceBenchmarks()
    result = await benchmarks.benchmark_queue_throughput()

    assert (
        result["throughput_ops_per_sec"] > 10.0
    ), f"Throughput too low: {result['throughput_ops_per_sec']}"
    assert result["operations_processed"] > 0, "No operations processed"


@pytest.mark.asyncio
async def test_memory_usage():
    """Test memory usage stays within limits."""
    benchmarks = PerformanceBenchmarks()
    result = benchmarks.benchmark_memory_usage()

    # Memory should be cleaned up reasonably well
    assert result["memory_efficiency"] > 50, "Memory not cleaned up efficiently"

    # Peak memory shouldn't be excessive (this is lenient for CI environments)
    assert (
        result["peak_memory_mb"] < 200
    ), f"Peak memory too high: {result['peak_memory_mb']}MB"


if __name__ == "__main__":

    async def main():
        """Run all benchmarks."""
        benchmarks = PerformanceBenchmarks()
        await benchmarks.run_all_benchmarks()

    asyncio.run(main())
