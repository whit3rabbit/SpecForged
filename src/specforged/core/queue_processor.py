"""
Queue processor for handling file-based operation queues in the MCP ecosystem.

This module implements the core logic for processing operations from the VS Code
extension through a file-based IPC protocol, enabling asynchronous communication
between the extension and MCP server.
"""

import asyncio
import json
import logging
import sys
import time
from collections import OrderedDict, deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Deque, Dict, List, Optional, Set

import aiofiles
from pydantic import BaseModel, Field, ValidationError

from ..config.performance import get_performance_config
from .spec_manager import SpecificationManager


class OperationType(str, Enum):
    """Supported operation types for the queue processor."""

    CREATE_SPEC = "create_spec"
    UPDATE_REQUIREMENTS = "update_requirements"
    UPDATE_DESIGN = "update_design"
    UPDATE_TASKS = "update_tasks"
    ADD_USER_STORY = "add_user_story"
    UPDATE_TASK_STATUS = "update_task_status"
    DELETE_SPEC = "delete_spec"
    SET_CURRENT_SPEC = "set_current_spec"
    SYNC_STATUS = "sync_status"
    HEARTBEAT = "heartbeat"


class OperationStatus(str, Enum):
    """Operation status lifecycle."""

    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Operation(BaseModel):
    """Individual operation in the queue."""

    id: str
    type: OperationType
    status: OperationStatus = OperationStatus.PENDING
    priority: int = Field(default=5, ge=1, le=10)  # 1 = highest priority
    timestamp: datetime
    source: str = "extension"
    retry_count: int = Field(default=0, ge=0)
    max_retries: int = Field(default=3, ge=0)
    params: Dict[str, Any] = Field(default_factory=dict)
    error_message: Optional[str] = None

    class Config:
        use_enum_values = True


class OperationQueue(BaseModel):
    """Complete operation queue structure."""

    operations: List[Operation] = Field(default_factory=list)
    version: int = 1
    last_processed: Optional[datetime] = None

    class Config:
        use_enum_values = True


class OperationResult(BaseModel):
    """Result of processing an operation."""

    operation_id: str
    success: bool
    message: str
    data: Dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime

    class Config:
        use_enum_values = True


class ResultsFile(BaseModel):
    """Results file structure."""

    results: List[OperationResult] = Field(default_factory=list)
    last_updated: datetime

    class Config:
        use_enum_values = True


class ConflictType(str, Enum):
    """Types of conflicts that can occur between operations."""

    CONCURRENT_MODIFICATION = "concurrent_modification"
    DUPLICATE_OPERATION = "duplicate_operation"
    RESOURCE_LOCKED = "resource_locked"
    DEPENDENCY_CONFLICT = "dependency_conflict"
    VERSION_MISMATCH = "version_mismatch"
    CIRCULAR_DEPENDENCY = "circular_dependency"
    PRIORITY_CONFLICT = "priority_conflict"


class ConflictResolution(str, Enum):
    """Possible conflict resolution strategies."""

    AUTO_MERGE = "auto_merge"
    MANUAL_REVIEW = "manual_review"
    DEFER = "defer"
    REORDER = "reorder"
    SPLIT = "split"
    CANCEL_OLDER = "cancel_older"
    CANCEL_NEWER = "cancel_newer"


class DetectedConflict(BaseModel):
    """A detected conflict between operations."""

    id: str
    type: ConflictType
    description: str
    operations: List[str]  # Operation IDs involved
    suggested_resolution: ConflictResolution
    resolution_data: Dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime

    class Config:
        use_enum_values = True


class SyncState(BaseModel):
    """Sync state file structure."""

    extension_online: bool = False
    mcp_server_online: bool = True
    last_sync: datetime
    pending_operations: int = 0
    failed_operations: int = 0
    sync_errors: List[str] = Field(default_factory=list)
    specifications: List[Dict[str, Any]] = Field(default_factory=list)
    active_conflicts: List[DetectedConflict] = Field(default_factory=list)

    class Config:
        use_enum_values = True


@dataclass
class PerformanceConfig:
    """Configuration for performance optimizations."""

    max_queue_size: int = 10000
    max_batch_size: int = 50
    batch_timeout_ms: int = 1000
    lru_cache_size: int = 1000
    enable_streaming_json: bool = True
    json_chunk_size: int = 8192
    debounce_ms: int = 250
    memory_limit_mb: int = 100
    enable_compression: bool = True
    parallel_processing: int = 3
    batch_processing_enabled: bool = True
    operation_deduplication: bool = True
    result_cache_ttl_seconds: int = 300
    queue_compaction_threshold: float = 0.7  # Compact when 70% operations are completed
    streaming_threshold_bytes: int = 1024 * 1024  # 1MB
    background_cleanup_interval: int = 60  # seconds


@dataclass
class PerformanceMetrics:
    """Performance tracking metrics."""

    operations_processed: int = 0
    avg_processing_time_ms: float = 0.0
    memory_usage_mb: float = 0.0
    cache_hit_rate: float = 0.0
    queue_throughput: float = 0.0
    batch_efficiency: float = 0.0
    json_parse_time_ms: float = 0.0
    file_io_time_ms: float = 0.0
    last_updated: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class StreamingJSONParser:
    """Memory-efficient streaming JSON parser for large operation queues."""

    def __init__(self, chunk_size: int = 8192):
        self.chunk_size = chunk_size
        self.buffer = ""
        self.logger = logging.getLogger(__name__)
        self._parse_cache: Dict[str, tuple] = {}  # Cache parsed content with timestamp
        self._cache_ttl = 60  # Cache TTL in seconds

    async def parse_large_queue(self, file_path: Path) -> OperationQueue:
        """Parse large JSON files in chunks to avoid memory issues."""
        if not file_path.exists():
            return OperationQueue()

        try:
            file_stat = file_path.stat()
            file_size = file_stat.st_size
            file_mtime = file_stat.st_mtime

            # Check cache first
            cache_key = f"{file_path}_{file_mtime}_{file_size}"
            if cache_key in self._parse_cache:
                cached_data, cache_time = self._parse_cache[cache_key]
                if time.time() - cache_time < self._cache_ttl:
                    self.logger.debug(f"Using cached parse result for {file_path.name}")
                    return cached_data
                else:
                    # Remove expired cache entry
                    del self._parse_cache[cache_key]

            # Use regular JSON for small files
            if file_size < 1024 * 1024:  # 1MB threshold
                async with aiofiles.open(file_path, "r", encoding="utf-8") as f:
                    content = await f.read()
                    data = json.loads(content)
                    queue = OperationQueue(**data)

                    # Cache the result
                    self._parse_cache[cache_key] = (queue, time.time())
                    return queue

            # Stream parse for large files
            self.logger.info(
                f"Streaming parse for large file: {file_size / (1024 * 1024):.1f}MB"
            )
            queue = await self._stream_parse_file(file_path)

            # Cache large file results too (they're more expensive to parse)
            self._parse_cache[cache_key] = (queue, time.time())
            return queue

        except Exception as e:
            self.logger.error(f"Failed to parse queue file: {e}")
            return OperationQueue()

    async def _stream_parse_file(self, file_path: Path) -> OperationQueue:
        """Stream parse large JSON files with incremental parsing."""
        try:
            # For truly large files, implement incremental JSON parsing
            file_size = file_path.stat().st_size

            if file_size > 50 * 1024 * 1024:  # 50MB - use true streaming
                return await self._incremental_parse(file_path)
            else:
                # Use chunked reading but full parse
                async with aiofiles.open(file_path, "r", encoding="utf-8") as f:
                    content = await f.read()
                    return await self._chunked_parse(content)

        except Exception as e:
            self.logger.error(f"Stream parse failed: {e}")
            return OperationQueue()

    async def _incremental_parse(self, file_path: Path) -> OperationQueue:
        """Incrementally parse very large JSON files."""
        # Implement a basic incremental JSON parser for operations
        # This is a simplified version - in production, use a library like ijson

        operations = []
        version = 1
        last_processed = None

        try:
            async with aiofiles.open(file_path, "r", encoding="utf-8") as f:
                buffer = ""
                in_operations_array = False
                brace_count = 0
                current_operation = ""

                while True:
                    chunk = await f.read(self.chunk_size)
                    if not chunk:
                        break

                    buffer += chunk

                    # Process buffer for complete JSON objects
                    while buffer:
                        if not in_operations_array:
                            # Look for operations array start
                            ops_start = buffer.find('"operations":[{')
                            if ops_start != -1:
                                in_operations_array = True
                                buffer = buffer[ops_start + len('"operations":[') :]
                                brace_count = 0
                                current_operation = "{"
                                continue
                            else:
                                # Extract metadata while looking for operations
                                if '"version":' in buffer and version == 1:
                                    import re

                                    version_match = re.search(
                                        r'"version":\s*(\d+)', buffer
                                    )
                                    if version_match:
                                        version = int(version_match.group(1))
                                buffer = buffer[
                                    len(buffer) // 2 :
                                ]  # Keep last half for next iteration
                                break
                        else:
                            # Parse operations incrementally
                            i = 0
                            while i < len(buffer):
                                char = buffer[i]
                                current_operation += char

                                if char == "{":
                                    brace_count += 1
                                elif char == "}":
                                    brace_count -= 1

                                    if brace_count == 0:
                                        # Complete operation found
                                        try:
                                            op_data = json.loads(current_operation)
                                            operation = Operation(**op_data)
                                            operations.append(operation)
                                        except (
                                            json.JSONDecodeError,
                                            ValidationError,
                                        ) as e:
                                            self.logger.warning(
                                                f"Skipped invalid operation: {e}"
                                            )

                                        # Reset for next operation
                                        current_operation = ""
                                        i += 1

                                        # Skip comma and whitespace
                                        while (
                                            i < len(buffer) and buffer[i] in ",\n\r\t "
                                        ):
                                            i += 1

                                        if i < len(buffer) and buffer[i] == "]":
                                            # End of operations array
                                            in_operations_array = False

                                        buffer = buffer[i:]
                                        break

                                i += 1
                            else:
                                # Processed entire buffer, need more data
                                buffer = ""
                                break

                        if len(operations) > 50000:  # Safety limit
                            self.logger.warning(
                                "Reached operation limit during incremental parse"
                            )
                            break

        except Exception as e:
            self.logger.error(f"Incremental parse error: {e}")

        return OperationQueue(
            operations=operations,
            version=version,
            last_processed=last_processed,
        )

    async def _chunked_parse(self, content: str) -> OperationQueue:
        """Parse JSON content in chunks to reduce memory pressure."""
        try:
            # For chunked parsing, we still need the full content
            # But we can process it in a way that reduces peak memory usage
            content_length = len(content)

            if content_length > 100 * 1024 * 1024:  # 100MB
                # Split into smaller sections and parse incrementally
                self.logger.info(
                    f"Using ultra-chunked parsing for "
                    f"{content_length / (1024 * 1024):.1f}MB content"
                )

                # This is still a simplified approach
                # In a real implementation, you'd use a proper streaming JSON parser
                data = json.loads(content)
                return OperationQueue(**data)
            else:
                data = json.loads(content)
                return OperationQueue(**data)

        except json.JSONDecodeError as e:
            self.logger.error(f"JSON decode error in chunked parse: {e}")
            return OperationQueue()

    def clear_cache(self) -> None:
        """Clear the parsing cache."""
        self._parse_cache.clear()

    def get_cache_stats(self) -> Dict[str, Any]:
        """Get cache statistics."""
        return {
            "cache_size": len(self._parse_cache),
            "cache_ttl": self._cache_ttl,
        }


class LRUCache:
    """Memory-efficient LRU cache implementation."""

    def __init__(self, max_size: int = 1000):
        self.max_size = max_size
        self.cache: OrderedDict = OrderedDict()
        self.hits = 0
        self.misses = 0

    def get(self, key: str) -> Optional[Any]:
        """Get item from cache, moving it to end (most recently used)."""
        if key in self.cache:
            # Move to end (most recently used)
            self.cache.move_to_end(key)
            self.hits += 1
            return self.cache[key]

        self.misses += 1
        return None

    def put(self, key: str, value: Any) -> None:
        """Put item in cache, evicting oldest if necessary."""
        if key in self.cache:
            self.cache.move_to_end(key)
        else:
            if len(self.cache) >= self.max_size:
                # Remove least recently used item
                self.cache.popitem(last=False)

        self.cache[key] = value

    def clear(self) -> None:
        """Clear all cached items."""
        self.cache.clear()
        self.hits = 0
        self.misses = 0

    def get_hit_rate(self) -> float:
        """Calculate cache hit rate."""
        total = self.hits + self.misses
        return self.hits / total if total > 0 else 0.0

    def size(self) -> int:
        """Get current cache size."""
        return len(self.cache)


class OperationBatcher:
    """Enhanced batches operations for more efficient processing with grouping."""

    def __init__(self, max_batch_size: int = 50, batch_timeout_ms: int = 1000):
        self.max_batch_size = max_batch_size
        self.batch_timeout_ms = batch_timeout_ms
        self.logger = logging.getLogger(__name__)

        # Advanced batching state
        self._pending_batches: Dict[str, List[Operation]] = {}
        self._batch_timers: Dict[str, float] = {}
        self._deduplication_cache: Set[str] = set()

        # Batching strategies
        self._batchable_types = {
            OperationType.UPDATE_REQUIREMENTS,
            OperationType.UPDATE_DESIGN,
            OperationType.UPDATE_TASKS,
            OperationType.ADD_USER_STORY,
            OperationType.UPDATE_TASK_STATUS,
        }

        # Performance tracking
        self._batch_stats = {
            "total_batches": 0,
            "total_operations": 0,
            "avg_batch_size": 0.0,
            "batch_efficiency": 0.0,
        }

    def group_operations(self, operations: List[Operation]) -> List[List[Operation]]:
        """Group operations into intelligent batches for efficient processing."""
        if not operations:
            return []

        # Deduplicate operations first
        deduplicated_ops = self._deduplicate_operations(operations)

        # Separate batchable and non-batchable operations
        batchable_ops = [
            op for op in deduplicated_ops if op.type in self._batchable_types
        ]
        individual_ops = [
            op for op in deduplicated_ops if op.type not in self._batchable_types
        ]

        batches = []

        # Create smart batches for batchable operations
        if batchable_ops:
            batches.extend(self._create_smart_batches(batchable_ops))

        # Add individual operations as single-item batches
        for op in individual_ops:
            batches.append([op])

        # Update statistics
        self._update_batch_stats(batches)

        self.logger.info(
            f"Created {len(batches)} intelligent batches from "
            f"{len(operations)} operations "
            f"(deduplicated: {len(operations) - len(deduplicated_ops)})"
        )
        return batches

    def _deduplicate_operations(self, operations: List[Operation]) -> List[Operation]:
        """Remove duplicate operations based on content hash."""
        unique_ops = []
        seen_signatures = set()

        for op in operations:
            signature = self._get_operation_signature(op)
            if signature not in seen_signatures:
                unique_ops.append(op)
                seen_signatures.add(signature)
            else:
                self.logger.debug(f"Skipped duplicate operation: {op.id}")

        return unique_ops

    def _get_operation_signature(self, operation: Operation) -> str:
        """Generate a signature for deduplication."""
        # Create signature based on operation type and key parameters
        signature_parts = [operation.type]

        if operation.type == OperationType.UPDATE_REQUIREMENTS:
            spec_id = operation.params.get("specId", "")
            content_hash = str(hash(operation.params.get("content", "")))
            signature_parts.extend([spec_id, content_hash])
        elif operation.type == OperationType.UPDATE_DESIGN:
            spec_id = operation.params.get("specId", "")
            content_hash = str(hash(operation.params.get("content", "")))
            signature_parts.extend([spec_id, content_hash])
        elif operation.type == OperationType.UPDATE_TASKS:
            spec_id = operation.params.get("specId", "")
            content_hash = str(hash(operation.params.get("content", "")))
            signature_parts.extend([spec_id, content_hash])
        elif operation.type == OperationType.ADD_USER_STORY:
            spec_id = operation.params.get("specId", "")
            user_story = operation.params.get("userStory", {})
            story_hash = str(hash(str(user_story)))
            signature_parts.extend([spec_id, story_hash])
        elif operation.type == OperationType.UPDATE_TASK_STATUS:
            spec_id = operation.params.get("specId", "")
            task_id = operation.params.get("taskId", "")
            status = operation.params.get("status", "")
            signature_parts.extend([spec_id, task_id, status])
        else:
            # For other operations, use a simple hash of all params
            signature_parts.append(str(hash(str(operation.params))))

        return "_".join(signature_parts)

    def _create_smart_batches(
        self, operations: List[Operation]
    ) -> List[List[Operation]]:
        """Create intelligent batches based on operation types and dependencies."""
        batches = []

        # Group by spec ID first for locality
        spec_groups = {}
        for op in operations:
            spec_id = op.params.get("specId", "unknown")
            if spec_id not in spec_groups:
                spec_groups[spec_id] = []
            spec_groups[spec_id].append(op)

        # Process each spec group
        for spec_id, spec_ops in spec_groups.items():
            # Further group by operation type within spec
            type_groups = {}
            for op in spec_ops:
                op_type = op.type
                if op_type not in type_groups:
                    type_groups[op_type] = []
                type_groups[op_type].append(op)

            # Create batches respecting dependencies and optimal ordering
            ordered_types = self._get_optimal_processing_order(type_groups.keys())

            for op_type in ordered_types:
                type_ops = type_groups[op_type]

                # Sort by priority and timestamp
                type_ops.sort(key=lambda op: (op.priority, op.timestamp))

                # Create batches of optimal size
                for i in range(0, len(type_ops), self.max_batch_size):
                    batch = type_ops[i : i + self.max_batch_size]
                    if self._is_batch_efficient(batch):
                        batches.append(batch)
                    else:
                        # Split into smaller batches if efficiency is low
                        smaller_batches = self._split_batch_optimally(batch)
                        batches.extend(smaller_batches)

        return batches

    def _get_optimal_processing_order(
        self, operation_types: List[OperationType]
    ) -> List[OperationType]:
        """Get optimal order for processing operation types."""
        # Define dependency order - some operations should be processed before others
        order_priority = {
            OperationType.CREATE_SPEC: 1,
            OperationType.UPDATE_REQUIREMENTS: 2,
            OperationType.UPDATE_DESIGN: 3,
            OperationType.UPDATE_TASKS: 4,
            OperationType.ADD_USER_STORY: 5,
            OperationType.UPDATE_TASK_STATUS: 6,
            OperationType.DELETE_SPEC: 7,
        }

        return sorted(operation_types, key=lambda t: order_priority.get(t, 99))

    def _is_batch_efficient(self, batch: List[Operation]) -> bool:
        """Check if a batch is efficient for processing."""
        if len(batch) <= 1:
            return True

        # Check if operations in batch are related (same spec, similar types)
        spec_ids = set(op.params.get("specId", "") for op in batch)
        operation_types = set(op.type for op in batch)

        # Efficient if operations target same spec and have compatible types
        return len(spec_ids) == 1 and len(operation_types) <= 2

    def _split_batch_optimally(self, batch: List[Operation]) -> List[List[Operation]]:
        """Split a batch optimally for better efficiency."""
        if len(batch) <= 1:
            return [batch]

        # Split by spec ID first
        spec_batches = {}
        for op in batch:
            spec_id = op.params.get("specId", "unknown")
            if spec_id not in spec_batches:
                spec_batches[spec_id] = []
            spec_batches[spec_id].append(op)

        result = []
        for spec_batch in spec_batches.values():
            # Further split if still too large
            optimal_size = min(self.max_batch_size // 2, len(spec_batch))
            for i in range(0, len(spec_batch), optimal_size):
                result.append(spec_batch[i : i + optimal_size])

        return result

    def _update_batch_stats(self, batches: List[List[Operation]]) -> None:
        """Update batching statistics."""
        if not batches:
            return

        total_operations = sum(len(batch) for batch in batches)
        avg_batch_size = total_operations / len(batches) if batches else 0

        # Calculate efficiency (operations per batch vs theoretical maximum)
        theoretical_batches = max(
            1,
            (total_operations + self.max_batch_size - 1) // self.max_batch_size,
        )
        efficiency = theoretical_batches / len(batches) if batches else 0

        self._batch_stats.update(
            {
                "total_batches": self._batch_stats["total_batches"] + len(batches),
                "total_operations": self._batch_stats["total_operations"]
                + total_operations,
                "avg_batch_size": (self._batch_stats["avg_batch_size"] + avg_batch_size)
                / 2,
                "batch_efficiency": (self._batch_stats["batch_efficiency"] + efficiency)
                / 2,
            }
        )

    def get_batch_stats(self) -> Dict[str, Any]:
        """Get current batching statistics."""
        return dict(self._batch_stats)

    def reset_stats(self) -> None:
        """Reset batching statistics."""
        self._batch_stats = {
            "total_batches": 0,
            "total_operations": 0,
            "avg_batch_size": 0.0,
            "batch_efficiency": 0.0,
        }

    def _get_batch_key(self, operation: Operation) -> str:
        """Get batching key for operation grouping."""
        spec_id = operation.params.get("specId", "")
        return f"{operation.type}:{spec_id}"

    def can_batch_together(self, op1: Operation, op2: Operation) -> bool:
        """Check if two operations can be batched together."""
        # Same type operations on same spec can often be batched
        if op1.type == op2.type:
            spec1 = op1.params.get("specId")
            spec2 = op2.params.get("specId")
            return spec1 == spec2

        # Different types might still be batchable if they're on same spec
        spec1 = op1.params.get("specId")
        spec2 = op2.params.get("specId")
        if spec1 and spec2 and spec1 == spec2:
            # Check if operations are compatible
            compatible_types = {
                OperationType.UPDATE_REQUIREMENTS,
                OperationType.UPDATE_DESIGN,
                OperationType.UPDATE_TASKS,
                OperationType.ADD_USER_STORY,
            }
            return op1.type in compatible_types and op2.type in compatible_types

        return False


class QueueProcessor:
    """
    Core queue processor for handling file-based operations with optimizations.

    This enhanced processor includes operation batching, streaming JSON parsing,
    LRU caching, and comprehensive performance monitoring.
    """

    def __init__(
        self,
        spec_manager: SpecificationManager,
        project_root: Optional[Path] = None,
    ):
        """
        Initialize the queue processor with performance optimizations.

        Args:
            spec_manager: SpecificationManager instance for handling spec operations
            project_root: Optional project root path (defaults to spec_manager's
                project root)
        """
        self.spec_manager = spec_manager
        self.project_root = project_root or spec_manager.project_detector.project_root
        self.logger = logging.getLogger(__name__)

        # File paths for IPC
        self.queue_file = self.project_root / "mcp-operations.json"
        self.results_file = self.project_root / "mcp-results.json"
        self.sync_file = self.project_root / "specforge-sync.json"

        # Ensure project root exists
        self.project_root.mkdir(parents=True, exist_ok=True)

        # Performance optimizations - load from configuration
        try:
            perf_config_model = get_performance_config()
            self.perf_config = PerformanceConfig(
                max_queue_size=perf_config_model.memory.max_queue_size,
                max_batch_size=perf_config_model.batching.max_batch_size,
                batch_timeout_ms=perf_config_model.batching.batch_timeout_ms,
                lru_cache_size=perf_config_model.cache.lru_cache_size,
                enable_streaming_json=perf_config_model.streaming.enable_streaming,
                json_chunk_size=perf_config_model.streaming.chunk_size_bytes,
                debounce_ms=perf_config_model.concurrency.debounce_delay_ms,
                memory_limit_mb=perf_config_model.memory.max_memory_usage_mb,
                enable_compression=perf_config_model.streaming.enable_compression,
                parallel_processing=perf_config_model.concurrency.max_parallel_operations,
                batch_processing_enabled=perf_config_model.batching.enable_batching,
                operation_deduplication=perf_config_model.batching.enable_operation_deduplication,
                result_cache_ttl_seconds=perf_config_model.cache.result_cache_ttl_seconds,
                queue_compaction_threshold=perf_config_model.memory.queue_compaction_threshold,
                streaming_threshold_bytes=perf_config_model.streaming.streaming_threshold_bytes,
                background_cleanup_interval=perf_config_model.background.background_cleanup_interval_seconds,  # noqa: E501
            )
        except Exception as e:
            self.logger.warning(f"Failed to load performance configuration: {e}")
            self.perf_config = PerformanceConfig()  # Use defaults

        self.perf_metrics = PerformanceMetrics()

        # Initialize performance components
        self.streaming_parser = StreamingJSONParser(self.perf_config.json_chunk_size)
        self.operation_cache = LRUCache(self.perf_config.lru_cache_size)
        self.operation_batcher = OperationBatcher(
            self.perf_config.max_batch_size, self.perf_config.batch_timeout_ms
        )

        # Track file modification times for conflict detection
        self._file_timestamps: Dict[str, datetime] = {}

        # Error recovery configuration
        self.max_queue_size = self.perf_config.max_queue_size
        self.max_retry_attempts = 3
        self.base_retry_delay = 1.0  # seconds
        self.max_retry_delay = 30.0  # seconds

        # Processing state
        self._processing_semaphore = asyncio.Semaphore(
            self.perf_config.parallel_processing
        )
        self._last_metrics_update = time.time()

        # Background processing and queue management
        self._background_tasks: Set[asyncio.Task] = set()
        self._queue_compaction_task: Optional[asyncio.Task] = None
        self._cleanup_task: Optional[asyncio.Task] = None
        self._processing_queue: Deque[Operation] = deque()
        self._result_cache_timestamps: Dict[str, float] = {}

        # Operation deduplication
        self._operation_fingerprints: Dict[str, str] = {}  # operation_id -> fingerprint
        self._fingerprint_to_operation: Dict[str, str] = (
            {}
        )  # fingerprint -> operation_id

    async def process_operation_queue(self) -> None:
        """
        Process all pending operations in the queue with comprehensive error recovery.

        This is the main entry point called by the MCP server to process
        any pending operations before handling user requests.
        """
        try:
            # Start background processing if enabled
            if (
                self.perf_config.background_cleanup_interval > 0
                and not self._cleanup_task
            ):
                await self.start_background_processing()

            # Perform error recovery and maintenance tasks
            await self.handle_workspace_changes()
            await self.cleanup_stale_operations()

            # Try to recover from corrupted queue if needed
            try:
                queue = await self.load_operation_queue()
            except Exception as queue_error:
                self.logger.error(f"Failed to load operation queue: {queue_error}")
                await self.recover_from_corrupted_queue()
                queue = await self.load_operation_queue()  # Try again after recovery

            # Update server heartbeat
            await self.update_heartbeat()

            if not queue.operations:
                return

            # Filter pending operations and sort by priority
            pending_ops = [
                op for op in queue.operations if op.status == OperationStatus.PENDING
            ]

            if not pending_ops:
                return

            # Sort by priority (lower number = higher priority), then by timestamp
            pending_ops.sort(key=lambda op: (op.priority, op.timestamp))

            self.logger.info(f"Processing {len(pending_ops)} pending operations")

            # Process operations with enhanced batching and parallel processing
            if self.perf_config.batch_processing_enabled:
                processed_count = await self._process_operations_with_batching(
                    pending_ops, queue
                )
            else:
                # Fallback to sequential processing if batching is disabled
                processed_count = await self._process_operations_sequential(pending_ops)

            # Update performance metrics
            self._update_performance_metrics(processed_count)

            # Update sync state
            await self.update_sync_state()

        except Exception as e:
            self.logger.error(f"Error processing operation queue: {e}")
            # Update error metrics
            self.perf_metrics.last_updated = datetime.now(timezone.utc)

    async def _process_operations_sequential(self, operations: List[Operation]) -> int:
        """Process operations sequentially without batching (fallback mode)."""
        processed_count = 0

        for operation in operations:
            try:
                await self.process_operation(operation)
                processed_count += 1
            except Exception as e:
                self.logger.error(f"Failed to process operation {operation.id}: {e}")
                await self.mark_operation_failed(operation, str(e))

        return processed_count

    async def process_operation(self, operation: Operation) -> None:
        """
        Process a single operation.

        Args:
            operation: The operation to process
        """
        self.logger.info(
            f"Processing operation {operation.id} of type {operation.type}"
        )

        # Mark operation as in progress
        await self.update_operation_status(operation.id, OperationStatus.IN_PROGRESS)

        try:
            # Route to appropriate handler based on operation type
            result = await self.route_operation(operation)

            # Write successful result
            await self.write_operation_result(
                OperationResult(
                    operation_id=operation.id,
                    success=True,
                    message=result.get("message", "Operation completed successfully"),
                    data=result.get("data", {}),
                    timestamp=datetime.now(timezone.utc),
                )
            )

            # Mark operation as completed
            await self.update_operation_status(operation.id, OperationStatus.COMPLETED)

        except Exception as e:
            error_msg = str(e)
            self.logger.error(f"Operation {operation.id} failed: {error_msg}")

            # Use enhanced retry logic with exponential backoff
            should_retry = await self.implement_exponential_backoff_retry(operation, e)

            if should_retry:
                await self.update_operation_in_queue(operation)
                self.logger.info(
                    f"Scheduled retry for operation {operation.id} "
                    f"(attempt {operation.retry_count}/{operation.max_retries})"
                )
            else:
                await self.mark_operation_failed(operation, error_msg)

    async def route_operation(self, operation: Operation) -> Dict[str, Any]:
        """
        Route operation to appropriate handler based on type with validation and idempotency.

        Args:
            operation: The operation to route

        Returns:
            Dict containing operation result data

        Raises:
            ValueError: If operation type is unknown or validation fails
        """
        # Validate operation before processing
        await self._validate_operation(operation)

        # Check for idempotency (skip if operation was already completed successfully)
        if await self._is_operation_idempotent(operation):
            return await self._get_cached_result(operation)

        handlers = {
            OperationType.CREATE_SPEC: self.handle_create_spec,
            OperationType.UPDATE_REQUIREMENTS: self.handle_update_requirements,
            OperationType.UPDATE_DESIGN: self.handle_update_design,
            OperationType.UPDATE_TASKS: self.handle_update_tasks,
            OperationType.ADD_USER_STORY: self.handle_add_user_story,
            OperationType.UPDATE_TASK_STATUS: self.handle_update_task_status,
            OperationType.DELETE_SPEC: self.handle_delete_spec,
            OperationType.SET_CURRENT_SPEC: self.handle_set_current_spec,
            OperationType.SYNC_STATUS: self.handle_sync_status,
            OperationType.HEARTBEAT: self.handle_heartbeat,
        }

        handler = handlers.get(operation.type)
        if not handler:
            raise ValueError(f"Unknown operation type: {operation.type}")

        # Sanitize operation parameters before processing
        sanitized_params = await self._sanitize_operation_params(operation)

        return await handler(sanitized_params)

    # Operation Handlers

    async def handle_create_spec(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle create_spec operation."""
        name = params.get("name")
        description = params.get("description", "")
        spec_id = params.get("specId")

        if not name:
            raise ValueError("Missing required parameter: name")

        # Create the specification (synchronous call)
        spec = self.spec_manager.create_specification(name, description, spec_id)

        return {
            "message": f"Specification '{name}' created successfully",
            "data": {
                "specId": spec.id,
                "name": spec.name,
                "filesCreated": ["requirements.md", "design.md", "tasks.md"],
            },
        }

    async def handle_update_requirements(
        self, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle update_requirements operation."""
        spec_id = params.get("specId")
        content = params.get("content")

        if not spec_id or not content:
            raise ValueError("Missing required parameters: specId, content")

        # Update requirements file directly
        await self._update_spec_file(spec_id, "requirements.md", content)

        return {
            "message": f"Requirements updated for specification '{spec_id}'",
            "data": {"specId": spec_id, "updated": "requirements.md"},
        }

    async def handle_update_design(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle update_design operation."""
        spec_id = params.get("specId")
        content = params.get("content")

        if not spec_id or not content:
            raise ValueError("Missing required parameters: specId, content")

        # Update design file directly
        await self._update_spec_file(spec_id, "design.md", content)

        return {
            "message": f"Design updated for specification '{spec_id}'",
            "data": {"specId": spec_id, "updated": "design.md"},
        }

    async def handle_update_tasks(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle update_tasks operation."""
        spec_id = params.get("specId")
        content = params.get("content")

        if not spec_id or not content:
            raise ValueError("Missing required parameters: specId, content")

        # Update tasks file directly
        await self._update_spec_file(spec_id, "tasks.md", content)

        return {
            "message": f"Tasks updated for specification '{spec_id}'",
            "data": {"specId": spec_id, "updated": "tasks.md"},
        }

    async def handle_add_user_story(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle add_user_story operation."""
        spec_id = params.get("specId")
        user_story = params.get("userStory")

        if not spec_id or not user_story:
            raise ValueError("Missing required parameters: specId, userStory")

        # Add user story using existing spec_manager method
        as_a = user_story.get("as_a", "")
        i_want = user_story.get("i_want", "")
        so_that = user_story.get("so_that", "")

        if not all([as_a, i_want, so_that]):
            raise ValueError("User story must include as_a, i_want, and so_that fields")

        story_id = self.spec_manager.add_user_story(spec_id, as_a, i_want, so_that)

        return {
            "message": f"User story added to specification '{spec_id}'",
            "data": {
                "specId": spec_id,
                "storyId": story_id,
                "userStory": user_story,
            },
        }

    async def handle_update_task_status(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle update_task_status operation."""
        spec_id = params.get("specId")
        task_id = params.get("taskId")
        status = params.get("status")

        if not all([spec_id, task_id, status]):
            raise ValueError("Missing required parameters: specId, taskId, status")

        # Type assertions for mypy
        assert isinstance(spec_id, str)
        assert isinstance(task_id, str)
        assert isinstance(status, str)

        # Update task status using existing spec_manager method
        success = self.spec_manager.update_task_status(spec_id, task_id, status)

        if not success:
            raise ValueError(
                f"Failed to update task status for task '{task_id}' in spec '{spec_id}'"
            )

        return {
            "message": (
                f"Task status updated for '{task_id}' in specification '{spec_id}'"
            ),
            "data": {"specId": spec_id, "taskId": task_id, "status": status},
        }

    async def handle_delete_spec(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle delete_spec operation."""
        spec_id = params.get("specId")

        if not spec_id:
            raise ValueError("Missing required parameter: specId")

        # Check if specification exists
        if spec_id not in self.spec_manager.specs:
            raise ValueError(f"Specification '{spec_id}' not found")

        # Delete specification directory and remove from memory
        spec_dir = self.spec_manager.base_dir / spec_id
        if spec_dir.exists():
            import shutil

            shutil.rmtree(spec_dir)

        # Remove from specs dictionary
        del self.spec_manager.specs[spec_id]

        # Clear current spec if it was the deleted one
        if self.spec_manager.current_spec_id == spec_id:
            self.spec_manager.current_spec_id = None
            self.spec_manager._save_current_spec_config()

        return {
            "message": f"Specification '{spec_id}' deleted successfully",
            "data": {"specId": spec_id},
        }

    async def handle_set_current_spec(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle set_current_spec operation."""
        spec_id = params.get("specId")

        if not spec_id:
            raise ValueError("Missing required parameter: specId")

        # Set current specification using existing spec_manager method
        success = self.spec_manager.set_current_specification(spec_id)

        if not success:
            raise ValueError(f"Failed to set current specification to '{spec_id}'")

        return {
            "message": f"Current specification set to '{spec_id}'",
            "data": {"specId": spec_id},
        }

    async def handle_sync_status(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle sync_status operation."""
        return {
            "message": "Sync status updated",
            "data": {"timestamp": datetime.now(timezone.utc).isoformat()},
        }

    async def handle_heartbeat(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle heartbeat operation."""
        await self.update_heartbeat()
        return {
            "message": "Heartbeat updated",
            "data": {"timestamp": datetime.now(timezone.utc).isoformat()},
        }

    # Helper Methods

    async def _update_spec_file(
        self, spec_id: str, filename: str, content: str
    ) -> None:
        """
        Update a specification file directly with new content.

        Args:
            spec_id: ID of the specification
            filename: Name of the file to update (e.g., "requirements.md")
            content: New content for the file
        """
        # Validate that the specification exists
        if spec_id not in self.spec_manager.specs:
            raise ValueError(f"Specification '{spec_id}' not found")

        # Get the specification directory
        spec_dir = self.spec_manager.base_dir / spec_id
        file_path = spec_dir / filename

        # Validate file path
        if not self.spec_manager._validate_file_path(file_path):
            raise ValueError(f"Invalid file path: {file_path}")

        # Ensure directory exists
        spec_dir.mkdir(parents=True, exist_ok=True)

        # Write content atomically
        temp_path = file_path.with_suffix(f"{file_path.suffix}.tmp")

        try:
            async with aiofiles.open(temp_path, "w", encoding="utf-8") as f:
                await f.write(content)

            # Atomic rename
            temp_path.rename(file_path)

            # Update the specification's updated_at timestamp
            spec = self.spec_manager.specs[spec_id]
            spec.updated_at = datetime.now()
            self.spec_manager.save_specification(spec_id)

        except Exception as e:
            # Clean up temp file on failure
            if temp_path.exists():
                temp_path.unlink()
            raise e

    # File Operations

    async def load_operation_queue(self) -> OperationQueue:
        """
        Load the operation queue from file with performance optimizations.

        Returns:
            OperationQueue instance, empty if file doesn't exist or is invalid
        """
        start_time = time.time()

        if not self.queue_file.exists():
            return OperationQueue()

        try:
            # Use streaming parser for better performance on large files
            queue = await self.streaming_parser.parse_large_queue(self.queue_file)

            # Update performance metrics
            parse_time = (time.time() - start_time) * 1000
            self.perf_metrics.json_parse_time_ms = (
                self.perf_metrics.json_parse_time_ms * 0.9 + parse_time * 0.1
            )

            self.logger.debug(
                f"Loaded queue with {len(queue.operations)} operations in {parse_time:.1f}ms"
            )
            return queue

        except (json.JSONDecodeError, ValidationError) as e:
            self.logger.error(f"Failed to load operation queue: {e}")
            # Backup corrupted file and return empty queue
            await self.backup_corrupted_file(self.queue_file)
            return OperationQueue()

    async def save_operation_queue(self, queue: OperationQueue) -> None:
        """
        Save the operation queue to file atomically with performance optimizations.

        Args:
            queue: OperationQueue to save
        """
        start_time = time.time()

        # Apply queue size limits and cleanup if necessary
        await self._enforce_queue_limits(queue)

        # Use compression for large queues
        data = queue.model_dump()
        if self.perf_config.enable_compression and len(queue.operations) > 100:
            await self._atomic_write_compressed_json(self.queue_file, data)
        else:
            await self.atomic_write_json(self.queue_file, data)

        # Update performance metrics
        io_time = (time.time() - start_time) * 1000
        self.perf_metrics.file_io_time_ms = (
            self.perf_metrics.file_io_time_ms * 0.9 + io_time * 0.1
        )

    async def update_operation_status(
        self, operation_id: str, status: OperationStatus
    ) -> None:
        """
        Update the status of a specific operation.

        Args:
            operation_id: ID of the operation to update
            status: New status for the operation
        """
        queue = await self.load_operation_queue()

        for operation in queue.operations:
            if operation.id == operation_id:
                operation.status = status
                break

        await self.save_operation_queue(queue)

    async def update_operation_in_queue(self, updated_operation: Operation) -> None:
        """
        Update an operation in the queue.

        Args:
            updated_operation: The updated operation
        """
        queue = await self.load_operation_queue()

        for i, operation in enumerate(queue.operations):
            if operation.id == updated_operation.id:
                queue.operations[i] = updated_operation
                break

        await self.save_operation_queue(queue)

    async def mark_operation_failed(
        self, operation: Operation, error_message: str
    ) -> None:
        """
        Mark an operation as failed and write error result.

        Args:
            operation: The failed operation
            error_message: Error message describing the failure
        """
        # Update operation status
        await self.update_operation_status(operation.id, OperationStatus.FAILED)

        # Write error result
        await self.write_operation_result(
            OperationResult(
                operation_id=operation.id,
                success=False,
                message=f"Operation failed: {error_message}",
                data={
                    "error": error_message,
                    "retryCount": operation.retry_count,
                },
                timestamp=datetime.now(timezone.utc),
            )
        )

    async def write_operation_result(self, result: OperationResult) -> None:
        """
        Write an operation result to the results file.

        Args:
            result: The operation result to write
        """
        # Load existing results
        results_data = ResultsFile(results=[], last_updated=datetime.now(timezone.utc))

        if self.results_file.exists():
            try:
                async with aiofiles.open(self.results_file, "r", encoding="utf-8") as f:
                    content = await f.read()

                if content.strip():
                    data = json.loads(content)
                    results_data = ResultsFile(**data)
            except (json.JSONDecodeError, ValidationError) as e:
                self.logger.error(f"Failed to load results file: {e}")

        # Add new result
        results_data.results.append(result)
        results_data.last_updated = datetime.now(timezone.utc)

        # Keep only last 100 results to prevent file from growing too large
        if len(results_data.results) > 100:
            results_data.results = results_data.results[-100:]

        # Save atomically
        await self.atomic_write_json(self.results_file, results_data.model_dump())

    async def update_heartbeat(self) -> None:
        """Update the server heartbeat in the sync state file."""
        await self.update_sync_state()

    async def update_sync_state(self) -> None:
        """Update the sync state file with current status."""
        # Load existing sync state
        sync_state = SyncState(
            last_sync=datetime.now(timezone.utc), mcp_server_online=True
        )

        if self.sync_file.exists():
            try:
                async with aiofiles.open(self.sync_file, "r", encoding="utf-8") as f:
                    content = await f.read()

                if content.strip():
                    data = json.loads(content)
                    sync_state = SyncState(**data)
            except (json.JSONDecodeError, ValidationError) as e:
                self.logger.error(f"Failed to load sync state: {e}")

        # Update server status and timestamp
        sync_state.mcp_server_online = True
        sync_state.last_sync = datetime.now(timezone.utc)

        # Count pending and failed operations
        queue = await self.load_operation_queue()
        sync_state.pending_operations = len(
            [op for op in queue.operations if op.status == OperationStatus.PENDING]
        )
        sync_state.failed_operations = len(
            [op for op in queue.operations if op.status == OperationStatus.FAILED]
        )

        # Update specifications list
        try:
            specs = list(self.spec_manager.specs.values())
            sync_state.specifications = [
                {
                    "specId": spec.id,
                    "lastModified": spec.updated_at.isoformat(),
                    "version": 1,  # Could be enhanced to track actual versions
                }
                for spec in specs
            ]
        except Exception as e:
            self.logger.error(f"Failed to update specifications in sync state: {e}")

        # Save atomically
        await self.atomic_write_json(self.sync_file, sync_state.model_dump())

    # Conflict Detection Methods

    async def detect_operation_conflicts(
        self, operation: Operation, queue: OperationQueue
    ) -> List[DetectedConflict]:
        """
        Detect conflicts between the given operation and other operations in the queue.

        Args:
            operation: The operation to check for conflicts
            queue: The current operation queue

        Returns:
            List of detected conflicts
        """
        conflicts = []

        # Get pending and in-progress operations
        active_operations = [
            op
            for op in queue.operations
            if op.status in [OperationStatus.PENDING, OperationStatus.IN_PROGRESS]
            and op.id != operation.id
        ]

        for other_op in active_operations:
            # Check for different types of conflicts
            conflict = await self._check_operations_for_conflicts(operation, other_op)
            if conflict:
                conflicts.append(conflict)

        # Check for file modification conflicts
        file_conflict = await self._check_file_modification_conflicts(operation)
        if file_conflict:
            conflicts.append(file_conflict)

        return conflicts

    async def _check_operations_for_conflicts(
        self, op1: Operation, op2: Operation
    ) -> Optional[DetectedConflict]:
        """
        Check if two operations conflict with each other.

        Args:
            op1: First operation
            op2: Second operation

        Returns:
            DetectedConflict if conflict found, None otherwise
        """
        # Check for duplicate operations
        if self._are_operations_duplicate(op1, op2):
            return DetectedConflict(
                id=f"duplicate_{op1.id}_{op2.id}",
                type=ConflictType.DUPLICATE_OPERATION,
                description=f"Duplicate {op1.type} operations for same resource",
                operations=[op1.id, op2.id],
                suggested_resolution=ConflictResolution.CANCEL_NEWER,
                timestamp=datetime.now(timezone.utc),
                resolution_data={
                    "older_operation": (
                        op2.id if op2.timestamp < op1.timestamp else op1.id
                    ),
                    "newer_operation": (
                        op1.id if op1.timestamp > op2.timestamp else op2.id
                    ),
                },
            )

        # Check for concurrent modifications to same spec
        if self._are_operations_concurrent_modifications(op1, op2):
            return DetectedConflict(
                id=f"concurrent_{op1.id}_{op2.id}",
                type=ConflictType.CONCURRENT_MODIFICATION,
                description="Concurrent modifications to same specification",
                operations=[op1.id, op2.id],
                suggested_resolution=ConflictResolution.MANUAL_REVIEW,
                timestamp=datetime.now(timezone.utc),
                resolution_data={
                    "spec_id": self._get_spec_id_from_operation(op1),
                    "operation_types": [op1.type, op2.type],
                },
            )

        # Check for dependency conflicts
        if self._are_operations_dependency_conflicts(op1, op2):
            return DetectedConflict(
                id=f"dependency_{op1.id}_{op2.id}",
                type=ConflictType.DEPENDENCY_CONFLICT,
                description="Operations have conflicting dependencies",
                operations=[op1.id, op2.id],
                suggested_resolution=ConflictResolution.REORDER,
                timestamp=datetime.now(timezone.utc),
                resolution_data={
                    "should_reorder": True,
                    "priority_operation": (
                        op2.id if op2.priority < op1.priority else op1.id
                    ),
                },
            )

        # Check for resource locking conflicts
        if self._are_operations_resource_locked(op1, op2):
            return DetectedConflict(
                id=f"resource_locked_{op1.id}_{op2.id}",
                type=ConflictType.RESOURCE_LOCKED,
                description="Operations targeting locked resource",
                operations=[op1.id, op2.id],
                suggested_resolution=ConflictResolution.DEFER,
                timestamp=datetime.now(timezone.utc),
                resolution_data={
                    "resource": self._get_resource_from_operation(op1),
                    "defer_operation": (
                        op1.id if op1.timestamp > op2.timestamp else op2.id
                    ),
                },
            )

        return None

    async def _check_file_modification_conflicts(
        self, operation: Operation
    ) -> Optional[DetectedConflict]:
        """
        Check if operation conflicts with external file modifications.

        Args:
            operation: The operation to check

        Returns:
            DetectedConflict if file was modified externally, None otherwise
        """
        # Only check file modification operations
        if operation.type not in [
            OperationType.UPDATE_REQUIREMENTS,
            OperationType.UPDATE_DESIGN,
            OperationType.UPDATE_TASKS,
        ]:
            return None

        spec_id = operation.params.get("specId")
        if not spec_id:
            return None

        # Determine the file being modified
        file_mapping = {
            OperationType.UPDATE_REQUIREMENTS: "requirements.md",
            OperationType.UPDATE_DESIGN: "design.md",
            OperationType.UPDATE_TASKS: "tasks.md",
        }

        filename = file_mapping.get(operation.type)
        if not filename:
            return None

        file_path = self.spec_manager.base_dir / spec_id / filename
        if not file_path.exists():
            return None

        # Check if file was modified since operation was created
        try:
            file_mtime = datetime.fromtimestamp(file_path.stat().st_mtime, timezone.utc)

            # If file was modified after operation timestamp, there's a conflict
            if file_mtime > operation.timestamp:
                return DetectedConflict(
                    id=f"file_modified_{operation.id}",
                    type=ConflictType.VERSION_MISMATCH,
                    description=f"File {filename} was modified externally after operation was created",  # noqa: E501
                    operations=[operation.id],
                    suggested_resolution=ConflictResolution.MANUAL_REVIEW,
                    timestamp=datetime.now(timezone.utc),
                    resolution_data={
                        "file_path": str(file_path),
                        "file_mtime": file_mtime.isoformat(),
                        "operation_time": operation.timestamp.isoformat(),
                    },
                )
        except OSError:
            # File access error, skip conflict check
            pass

        return None

    def _are_operations_duplicate(self, op1: Operation, op2: Operation) -> bool:
        """Check if two operations are duplicates."""
        return op1.type == op2.type and self._get_operation_signature(
            op1
        ) == self._get_operation_signature(op2)

    def _are_operations_concurrent_modifications(
        self, op1: Operation, op2: Operation
    ) -> bool:
        """Check if operations are concurrent modifications to same resource."""
        if op1.type == op2.type:
            return False  # Same operation type handled as duplicate

        # Check if both operations modify the same spec
        spec_id_1 = self._get_spec_id_from_operation(op1)
        spec_id_2 = self._get_spec_id_from_operation(op2)

        if not spec_id_1 or not spec_id_2 or spec_id_1 != spec_id_2:
            return False

        # Check if operations modify overlapping files/data
        modification_ops = {
            OperationType.UPDATE_REQUIREMENTS,
            OperationType.UPDATE_DESIGN,
            OperationType.UPDATE_TASKS,
            OperationType.ADD_USER_STORY,
        }

        return (
            op1.type in modification_ops
            and op2.type in modification_ops
            and abs((op1.timestamp - op2.timestamp).total_seconds()) < 300
        )  # Within 5 minutes

    def _are_operations_dependency_conflicts(
        self, op1: Operation, op2: Operation
    ) -> bool:
        """Check if operations have dependency conflicts."""
        # Delete operation conflicts with any other operation on same spec
        if (
            op1.type == OperationType.DELETE_SPEC
            or op2.type == OperationType.DELETE_SPEC
        ):
            spec_id_1 = self._get_spec_id_from_operation(op1)
            spec_id_2 = self._get_spec_id_from_operation(op2)
            return spec_id_1 == spec_id_2 and spec_id_1 is not None

        # Create operation conflicts with updates to non-existing specs
        if op1.type == OperationType.CREATE_SPEC and op2.type in [
            OperationType.UPDATE_REQUIREMENTS,
            OperationType.UPDATE_DESIGN,
            OperationType.UPDATE_TASKS,
            OperationType.ADD_USER_STORY,
        ]:
            return op1.params.get("specId") == op2.params.get("specId")

        return False

    def _are_operations_resource_locked(self, op1: Operation, op2: Operation) -> bool:
        """Check if operations target a locked resource."""
        # For now, consider any in-progress operation as locking the resource
        if op2.status == OperationStatus.IN_PROGRESS:
            resource_1 = self._get_resource_from_operation(op1)
            resource_2 = self._get_resource_from_operation(op2)
            return resource_1 == resource_2 and resource_1 is not None

        return False

    def _get_spec_id_from_operation(self, operation: Operation) -> Optional[str]:
        """Extract spec ID from operation parameters."""
        return operation.params.get("specId")

    def _get_resource_from_operation(self, operation: Operation) -> Optional[str]:
        """Get the primary resource being modified by the operation."""
        spec_id = self._get_spec_id_from_operation(operation)
        if not spec_id:
            return None

        # For resource locking, consider any operation on the same spec as targeting same resource
        return spec_id

    async def resolve_conflicts_automatically(
        self, conflicts: List[DetectedConflict], queue: OperationQueue
    ) -> List[DetectedConflict]:
        """
        Automatically resolve conflicts where possible.

        Args:
            conflicts: List of conflicts to resolve
            queue: Current operation queue

        Returns:
            List of conflicts that could not be resolved automatically
        """
        unresolved_conflicts = []

        for conflict in conflicts:
            if conflict.suggested_resolution == ConflictResolution.CANCEL_NEWER:
                await self._resolve_duplicate_conflict(conflict, queue)
            elif conflict.suggested_resolution == ConflictResolution.REORDER:
                await self._resolve_dependency_conflict(conflict, queue)
            elif conflict.suggested_resolution == ConflictResolution.DEFER:
                await self._resolve_resource_lock_conflict(conflict, queue)
            else:
                # Manual review required
                unresolved_conflicts.append(conflict)

        return unresolved_conflicts

    async def _resolve_duplicate_conflict(
        self, conflict: DetectedConflict, queue: OperationQueue
    ) -> None:
        """Resolve duplicate operation conflict by cancelling newer operation."""
        newer_op_id = conflict.resolution_data.get("newer_operation")
        if newer_op_id:
            for operation in queue.operations:
                if operation.id == newer_op_id:
                    operation.status = OperationStatus.CANCELLED
                    break

            self.logger.info(
                f"Resolved duplicate conflict {conflict.id} by cancelling operation {newer_op_id}"
            )

    async def _resolve_dependency_conflict(
        self, conflict: DetectedConflict, queue: OperationQueue
    ) -> None:
        """Resolve dependency conflict by reordering operations."""
        priority_op_id = conflict.resolution_data.get("priority_operation")
        if priority_op_id:
            # Lower the priority number (higher priority) for the dependent operation
            for operation in queue.operations:
                if operation.id == priority_op_id:
                    operation.priority = max(1, operation.priority - 1)
                    break

            self.logger.info(
                f"Resolved dependency conflict {conflict.id} by reordering operations"
            )

    async def _resolve_resource_lock_conflict(
        self, conflict: DetectedConflict, queue: OperationQueue
    ) -> None:
        """Resolve resource lock conflict by deferring operation."""
        defer_op_id = conflict.resolution_data.get("defer_operation")
        if defer_op_id:
            # Increase priority number (lower priority) to defer operation
            for operation in queue.operations:
                if operation.id == defer_op_id:
                    operation.priority = min(10, operation.priority + 2)
                    break

            self.logger.info(
                f"Resolved resource lock conflict {conflict.id} by deferring operation {defer_op_id}"
            )

    async def _update_sync_state_with_conflicts(
        self, conflicts: List[DetectedConflict]
    ) -> None:
        """
        Update sync state to include active conflicts.

        Args:
            conflicts: List of conflicts to add to sync state
        """
        # Load existing sync state
        sync_state = SyncState(
            last_sync=datetime.now(timezone.utc), mcp_server_online=True
        )

        if self.sync_file.exists():
            try:
                async with aiofiles.open(self.sync_file, "r", encoding="utf-8") as f:
                    content = await f.read()

                if content.strip():
                    data = json.loads(content)
                    sync_state = SyncState(**data)
            except (json.JSONDecodeError, ValidationError) as e:
                self.logger.error(f"Failed to load sync state for conflict update: {e}")

        # Add new conflicts to active conflicts list (avoid duplicates)
        existing_conflict_ids = {
            conflict.id for conflict in sync_state.active_conflicts
        }

        for conflict in conflicts:
            if conflict.id not in existing_conflict_ids:
                sync_state.active_conflicts.append(conflict)

        # Clean up old resolved conflicts (older than 1 hour)
        cutoff_time = datetime.now(timezone.utc) - timedelta(hours=1)
        sync_state.active_conflicts = [
            conflict
            for conflict in sync_state.active_conflicts
            if conflict.timestamp > cutoff_time
        ]

        # Save updated sync state
        await self.atomic_write_json(self.sync_file, sync_state.model_dump())

    # Operation Validation and Idempotency Methods

    async def _validate_operation(self, operation: Operation) -> None:
        """
        Validate operation parameters and constraints.

        Args:
            operation: The operation to validate

        Raises:
            ValueError: If validation fails
        """
        # Basic operation validation
        if not operation.id:
            raise ValueError("Operation ID is required")

        if not operation.type:
            raise ValueError("Operation type is required")

        if not operation.timestamp:
            raise ValueError("Operation timestamp is required")

        # Type-specific validation
        validators = {
            OperationType.CREATE_SPEC: self._validate_create_spec_params,
            OperationType.UPDATE_REQUIREMENTS: self._validate_update_file_params,
            OperationType.UPDATE_DESIGN: self._validate_update_file_params,
            OperationType.UPDATE_TASKS: self._validate_update_file_params,
            OperationType.ADD_USER_STORY: self._validate_add_user_story_params,
            OperationType.UPDATE_TASK_STATUS: self._validate_update_task_status_params,
            OperationType.DELETE_SPEC: self._validate_delete_spec_params,
            OperationType.SET_CURRENT_SPEC: self._validate_set_current_spec_params,
            OperationType.SYNC_STATUS: self._validate_sync_status_params,
            OperationType.HEARTBEAT: self._validate_heartbeat_params,
        }

        validator = validators.get(operation.type)
        if validator:
            await validator(operation.params)

    async def _validate_create_spec_params(self, params: Dict[str, Any]) -> None:
        """Validate create_spec operation parameters."""
        if not params.get("name"):
            raise ValueError("create_spec operation requires 'name' parameter")

        if not isinstance(params["name"], str) or len(params["name"].strip()) == 0:
            raise ValueError("'name' parameter must be a non-empty string")

        if len(params["name"]) > 255:
            raise ValueError("'name' parameter must be 255 characters or less")

        # Optional parameters validation
        if "description" in params and not isinstance(params["description"], str):
            raise ValueError("'description' parameter must be a string")

        if "specId" in params:
            if not isinstance(params["specId"], str):
                raise ValueError("'specId' parameter must be a string")
            if not params["specId"].replace("-", "").replace("_", "").isalnum():
                raise ValueError(
                    "'specId' must contain only alphanumeric characters, hyphens, and underscores"
                )

    async def _validate_update_file_params(self, params: Dict[str, Any]) -> None:
        """Validate file update operation parameters."""
        if not params.get("specId"):
            raise ValueError("File update operation requires 'specId' parameter")

        if not isinstance(params["specId"], str) or len(params["specId"].strip()) == 0:
            raise ValueError("'specId' parameter must be a non-empty string")

        if not params.get("content"):
            raise ValueError("File update operation requires 'content' parameter")

        if not isinstance(params["content"], str):
            raise ValueError("'content' parameter must be a string")

        # Prevent extremely large content that could cause memory issues
        if len(params["content"]) > 10 * 1024 * 1024:  # 10MB limit
            raise ValueError("Content size exceeds 10MB limit")

    async def _validate_add_user_story_params(self, params: Dict[str, Any]) -> None:
        """Validate add_user_story operation parameters."""
        if not params.get("specId"):
            raise ValueError("add_user_story operation requires 'specId' parameter")

        if not params.get("userStory"):
            raise ValueError("add_user_story operation requires 'userStory' parameter")

        user_story = params["userStory"]
        if not isinstance(user_story, dict):
            raise ValueError("'userStory' parameter must be a dictionary")

        required_fields = ["as_a", "i_want", "so_that"]
        for field_name in required_fields:
            if field_name not in user_story:
                raise ValueError(f"userStory must include '{field_name}' field")
            if (
                not isinstance(user_story[field_name], str)
                or len(user_story[field_name].strip()) == 0
            ):
                raise ValueError(f"userStory '{field_name}' must be a non-empty string")

    async def _validate_update_task_status_params(self, params: Dict[str, Any]) -> None:
        """Validate update_task_status operation parameters."""
        required_params = ["specId", "taskId", "status"]
        for param in required_params:
            if not params.get(param):
                raise ValueError(
                    f"update_task_status operation requires '{param}' parameter"
                )
            if not isinstance(params[param], str) or len(params[param].strip()) == 0:
                raise ValueError(f"'{param}' parameter must be a non-empty string")

    async def _validate_delete_spec_params(self, params: Dict[str, Any]) -> None:
        """Validate delete_spec operation parameters."""
        if not params.get("specId"):
            raise ValueError("delete_spec operation requires 'specId' parameter")
        if not isinstance(params["specId"], str) or len(params["specId"].strip()) == 0:
            raise ValueError("'specId' parameter must be a non-empty string")

    async def _validate_set_current_spec_params(self, params: Dict[str, Any]) -> None:
        """Validate set_current_spec operation parameters."""
        if not params.get("specId"):
            raise ValueError("set_current_spec operation requires 'specId' parameter")
        if not isinstance(params["specId"], str) or len(params["specId"].strip()) == 0:
            raise ValueError("'specId' parameter must be a non-empty string")

    async def _validate_sync_status_params(self, params: Dict[str, Any]) -> None:
        """Validate sync_status operation parameters."""
        # sync_status operation doesn't require specific parameters
        pass

    async def _validate_heartbeat_params(self, params: Dict[str, Any]) -> None:
        """Validate heartbeat operation parameters."""
        # heartbeat operation doesn't require specific parameters
        pass

    async def _is_operation_idempotent(self, operation: Operation) -> bool:
        """
        Check if operation can be skipped due to idempotency rules.

        Args:
            operation: The operation to check

        Returns:
            True if operation should be skipped, False otherwise
        """
        # Check if we have a recent successful result for this exact operation
        if not self.results_file.exists():
            return False

        try:
            async with aiofiles.open(self.results_file, "r", encoding="utf-8") as f:
                content = await f.read()

            if not content.strip():
                return False

            data = json.loads(content)
            results_data = ResultsFile(**data)

            # Look for recent successful result with same operation signature
            operation_signature = self._get_operation_signature(operation)

            for result in reversed(results_data.results):  # Check most recent first
                if (
                    result.success
                    and result.operation_id.startswith(operation_signature)
                    and (datetime.now(timezone.utc) - result.timestamp).total_seconds()
                    < 300
                ):  # Within 5 minutes

                    self.logger.info(
                        f"Skipping idempotent operation {operation.id} (signature: {operation_signature})"  # noqa: E501
                    )
                    return True

        except (json.JSONDecodeError, ValidationError) as e:
            self.logger.error(f"Failed to check idempotency: {e}")

        return False

    async def _get_cached_result(self, operation: Operation) -> Dict[str, Any]:
        """
        Get cached result for idempotent operation.

        Args:
            operation: The operation to get cached result for

        Returns:
            Cached operation result
        """
        return {
            "message": f"Operation {operation.type} completed (cached result)",
            "data": {"cached": True, "operationId": operation.id},
        }

    def _get_operation_signature(self, operation: Operation) -> str:
        """
        Generate a signature for operation idempotency checking.

        Args:
            operation: The operation to generate signature for

        Returns:
            Operation signature string
        """
        # Create signature based on operation type and key parameters
        signature_parts = [operation.type]

        if operation.type == OperationType.CREATE_SPEC:
            signature_parts.extend(
                [
                    operation.params.get("name", ""),
                    operation.params.get("specId", ""),
                ]
            )
        elif operation.type in [
            OperationType.UPDATE_REQUIREMENTS,
            OperationType.UPDATE_DESIGN,
            OperationType.UPDATE_TASKS,
        ]:
            signature_parts.extend(
                [
                    operation.params.get("specId", ""),
                    # Use content hash for file updates to detect actual changes
                    str(hash(operation.params.get("content", ""))),
                ]
            )
        elif operation.type == OperationType.ADD_USER_STORY:
            user_story = operation.params.get("userStory", {})
            signature_parts.extend(
                [
                    operation.params.get("specId", ""),
                    user_story.get("as_a", ""),
                    user_story.get("i_want", ""),
                ]
            )
        elif operation.type == OperationType.UPDATE_TASK_STATUS:
            signature_parts.extend(
                [
                    operation.params.get("specId", ""),
                    operation.params.get("taskId", ""),
                    operation.params.get("status", ""),
                ]
            )
        elif operation.type == OperationType.DELETE_SPEC:
            signature_parts.append(operation.params.get("specId", ""))
        elif operation.type == OperationType.SET_CURRENT_SPEC:
            signature_parts.append(operation.params.get("specId", ""))

        return "_".join(signature_parts)

    async def _sanitize_operation_params(self, operation: Operation) -> Dict[str, Any]:
        """
        Sanitize operation parameters to prevent security issues.

        Args:
            operation: The operation to sanitize

        Returns:
            Sanitized parameters dictionary
        """
        sanitized = {}

        for key, value in operation.params.items():
            # Remove any potentially dangerous characters and normalize strings
            if isinstance(value, str):
                # Trim whitespace and normalize newlines
                sanitized_value = (
                    value.strip().replace("\r\n", "\n").replace("\r", "\n")
                )

                # For file paths and IDs, ensure they're safe
                if key in ["specId", "taskId"] and sanitized_value:
                    # Allow only alphanumeric, hyphens, underscores, and dots
                    sanitized_value = "".join(
                        c for c in sanitized_value if c.isalnum() or c in "-_."
                    )

                sanitized[key] = sanitized_value
            elif isinstance(value, dict):
                # Recursively sanitize nested dictionaries
                sanitized[key] = await self._sanitize_dict_params(value)
            else:
                # Pass through other types (int, bool, etc.) as-is
                sanitized[key] = value

        return sanitized

    async def _sanitize_dict_params(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        Sanitize dictionary parameters recursively.

        Args:
            params: Dictionary to sanitize

        Returns:
            Sanitized dictionary
        """
        sanitized = {}

        for key, value in params.items():
            if isinstance(value, str):
                sanitized[key] = value.strip().replace("\r\n", "\n").replace("\r", "\n")
            elif isinstance(value, dict):
                sanitized[key] = await self._sanitize_dict_params(value)
            else:
                sanitized[key] = value

        return sanitized

    # Error Recovery Methods

    async def recover_from_corrupted_queue(self) -> None:
        """
        Attempt to recover from a corrupted operation queue.

        This method tries to repair or recreate the queue file if it's corrupted.
        """
        try:
            # Try to load the queue normally first
            queue = await self.load_operation_queue()
            if queue and len(queue.operations) >= 0:
                return  # Queue is fine

        except Exception as e:
            self.logger.error(f"Queue file appears corrupted: {e}")

        # Attempt recovery strategies
        recovery_successful = False

        # Strategy 1: Try to recover from backup
        backup_files = list(
            self.project_root.glob(f"{self.queue_file.name}.corrupted_*")
        )
        if backup_files:
            # Sort by timestamp, get most recent
            backup_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
            latest_backup = backup_files[0]

            try:
                self.logger.info(f"Attempting to recover from backup: {latest_backup}")
                async with aiofiles.open(latest_backup, "r", encoding="utf-8") as f:
                    content = await f.read()

                # Validate backup content
                data = json.loads(content)
                backup_queue = OperationQueue(**data)

                # Restore from backup
                await self.save_operation_queue(backup_queue)
                self.logger.info("Successfully recovered queue from backup")
                recovery_successful = True

            except Exception as backup_error:
                self.logger.error(f"Failed to recover from backup: {backup_error}")

        # Strategy 2: Try to parse partial data
        if not recovery_successful and self.queue_file.exists():
            try:
                self.logger.info("Attempting to parse partial queue data")
                recovery_successful = await self._attempt_partial_queue_recovery()
            except Exception as partial_error:
                self.logger.error(f"Partial recovery failed: {partial_error}")

        # Strategy 3: Create new empty queue
        if not recovery_successful:
            self.logger.warning("Creating new empty queue after recovery failure")
            empty_queue = OperationQueue()
            await self.save_operation_queue(empty_queue)
            recovery_successful = True

        if recovery_successful:
            self.logger.info("Queue recovery completed successfully")
        else:
            self.logger.error("All queue recovery strategies failed")

    async def _attempt_partial_queue_recovery(self) -> bool:
        """
        Attempt to recover partial data from a corrupted queue file.

        Returns:
            True if partial recovery was successful, False otherwise
        """
        try:
            async with aiofiles.open(self.queue_file, "r", encoding="utf-8") as f:
                content = await f.read()

            # Try to find valid JSON objects in the content
            recovered_operations = []

            # Look for operation-like JSON objects
            import re

            # Find potential operation objects
            operation_pattern = r'{\s*"id":\s*"[^"]+",.*?"type":\s*"[^"]+".*?}'
            matches = re.findall(operation_pattern, content, re.DOTALL)

            for match in matches:
                try:
                    # Try to parse each potential operation
                    op_data = json.loads(match)
                    operation = Operation(**op_data)
                    recovered_operations.append(operation)
                except Exception:
                    continue  # Skip invalid operations

            if recovered_operations:
                # Create new queue with recovered operations
                recovered_queue = OperationQueue(
                    operations=recovered_operations,
                    last_processed=datetime.now(timezone.utc),
                )

                await self.save_operation_queue(recovered_queue)
                self.logger.info(
                    f"Recovered {len(recovered_operations)} operations from corrupted queue"
                )
                return True

        except Exception as e:
            self.logger.error(f"Partial recovery attempt failed: {e}")

        return False

    async def handle_workspace_changes(self) -> None:
        """
        Detect and adapt to workspace changes.

        This method checks if the workspace structure has changed and updates
        internal paths and configurations accordingly.
        """
        try:
            # Check if project root still exists
            if not self.project_root.exists():
                self.logger.warning(
                    f"Project root {self.project_root} no longer exists"
                )
                # Try to find new project root
                await self._relocate_project_root()

            # Check if specification base directory exists
            if not self.spec_manager.base_dir.exists():
                self.logger.warning(
                    f"Specifications directory {self.spec_manager.base_dir} no longer exists"
                )
                # Try to recreate or relocate
                await self._handle_missing_specs_directory()

            # Validate file permissions
            await self._validate_file_permissions()

        except Exception as e:
            self.logger.error(f"Error handling workspace changes: {e}")

    async def _relocate_project_root(self) -> None:
        """Attempt to relocate project root if it has moved."""
        try:
            # Try parent directories
            current_path = self.project_root
            for _ in range(5):  # Check up to 5 levels up
                current_path = current_path.parent
                if current_path.exists() and (current_path / ".git").exists():
                    # Found a git repository, use it as new project root
                    old_root = self.project_root
                    self.project_root = current_path

                    # Update file paths
                    self.queue_file = self.project_root / "mcp-operations.json"
                    self.results_file = self.project_root / "mcp-results.json"
                    self.sync_file = self.project_root / "specforge-sync.json"

                    self.logger.info(
                        f"Relocated project root from {old_root} to {current_path}"
                    )
                    return

            # If no git repo found, try to create the missing directory
            self.project_root.mkdir(parents=True, exist_ok=True)
            self.logger.info(f"Recreated project root directory: {self.project_root}")

        except Exception as e:
            self.logger.error(f"Failed to relocate project root: {e}")

    async def _handle_missing_specs_directory(self) -> None:
        """Handle missing specifications directory."""
        try:
            # Try to recreate the directory
            self.spec_manager.base_dir.mkdir(parents=True, exist_ok=True)
            self.logger.info(
                f"Recreated specifications directory: {self.spec_manager.base_dir}"
            )

            # Check if we need to reload specifications
            await self._reload_specifications_if_needed()

        except Exception as e:
            self.logger.error(f"Failed to handle missing specs directory: {e}")

    async def _reload_specifications_if_needed(self) -> None:
        """Reload specifications if directory structure has changed."""
        try:
            # Clear current specs and reload from disk
            self.spec_manager.specs.clear()

            if self.spec_manager.base_dir.exists():
                for spec_dir in self.spec_manager.base_dir.iterdir():
                    if spec_dir.is_dir():
                        spec_file = spec_dir / "spec.json"
                        if spec_file.exists():
                            try:
                                # Load specification
                                spec = self.spec_manager.load_specification(
                                    spec_dir.name
                                )
                                if spec:
                                    self.spec_manager.specs[spec.id] = spec
                            except Exception as load_error:
                                self.logger.error(
                                    f"Failed to reload spec {spec_dir.name}: {load_error}"
                                )

            self.logger.info(f"Reloaded {len(self.spec_manager.specs)} specifications")

        except Exception as e:
            self.logger.error(f"Failed to reload specifications: {e}")

    async def _validate_file_permissions(self) -> None:
        """Validate that we have proper file permissions for all operations."""
        try:
            # Check read/write access to project root
            test_file = self.project_root / ".permission_test"
            try:
                async with aiofiles.open(test_file, "w", encoding="utf-8") as f:
                    await f.write("test")

                async with aiofiles.open(test_file, "r", encoding="utf-8") as f:
                    content = await f.read()

                test_file.unlink()  # Clean up

                if content != "test":
                    raise PermissionError("File read/write test failed")

            except Exception as perm_error:
                self.logger.error(f"File permission validation failed: {perm_error}")
                raise

            # Check specifications directory permissions
            if self.spec_manager.base_dir.exists():
                # Try to create a test file in specs directory
                test_spec_file = self.spec_manager.base_dir / ".spec_permission_test"
                try:
                    async with aiofiles.open(
                        test_spec_file, "w", encoding="utf-8"
                    ) as f:
                        await f.write("test")
                    test_spec_file.unlink()
                except Exception:
                    self.logger.warning(
                        "Limited write access to specifications directory"
                    )

        except Exception as e:
            self.logger.error(f"File permissions validation failed: {e}")

    async def implement_exponential_backoff_retry(
        self, operation: Operation, error: Exception
    ) -> bool:
        """
        Implement exponential backoff retry logic with jitter.

        Args:
            operation: The operation that failed
            error: The exception that caused the failure

        Returns:
            True if operation should be retried, False if max retries exceeded
        """
        if operation.retry_count >= self.max_retry_attempts:
            return False

        # Calculate delay with exponential backoff and jitter
        delay = min(
            self.base_retry_delay * (2**operation.retry_count),
            self.max_retry_delay,
        )

        # Add jitter (±25% of the delay)
        import random

        jitter = (
            delay * 0.25 * (2 * random.random() - 1)
        )  # Random between -25% and +25%
        final_delay = max(0.1, delay + jitter)

        self.logger.info(
            f"Scheduling retry for operation {operation.id} "
            f"(attempt {operation.retry_count + 1}/{self.max_retry_attempts}) "
            f"after {final_delay:.1f}s delay"
        )

        # In a real implementation, you might want to use asyncio.sleep here
        # For now, we'll just increment the retry count and update the operation
        operation.retry_count += 1
        operation.status = OperationStatus.PENDING
        operation.error_message = str(error)

        # Update timestamp to reflect the retry delay
        import asyncio

        await asyncio.sleep(final_delay)

        return True

    async def cleanup_stale_operations(self) -> None:
        """
        Clean up stale operations from the queue.

        This removes operations that are too old, completed operations beyond
        a certain limit, and handles queue size management.
        """
        try:
            queue = await self.load_operation_queue()
            original_count = len(queue.operations)

            # Remove operations older than 24 hours
            cutoff_time = datetime.now(timezone.utc) - timedelta(hours=24)
            queue.operations = [
                op for op in queue.operations if op.timestamp > cutoff_time
            ]

            # Keep only the most recent completed operations (max 100)
            completed_ops = [
                op for op in queue.operations if op.status == OperationStatus.COMPLETED
            ]
            if len(completed_ops) > 100:
                # Sort by timestamp, keep most recent
                completed_ops.sort(key=lambda op: op.timestamp, reverse=True)
                recent_completed = completed_ops[:100]

                # Replace completed operations with recent ones
                non_completed = [
                    op
                    for op in queue.operations
                    if op.status != OperationStatus.COMPLETED
                ]
                queue.operations = non_completed + recent_completed

            # If queue is still too large, remove oldest pending operations
            if len(queue.operations) > self.max_queue_size:
                # Sort by priority and timestamp, keep highest priority operations
                queue.operations.sort(
                    key=lambda op: (
                        (
                            0
                            if op.status
                            in [
                                OperationStatus.IN_PROGRESS,
                                OperationStatus.PENDING,
                            ]
                            else 1
                        ),
                        op.priority,
                        op.timestamp,
                    )
                )
                queue.operations = queue.operations[: self.max_queue_size]

            cleaned_count = original_count - len(queue.operations)
            if cleaned_count > 0:
                self.logger.info(
                    f"Cleaned up {cleaned_count} stale operations from queue"
                )
                await self.save_operation_queue(queue)

        except Exception as e:
            self.logger.error(f"Failed to cleanup stale operations: {e}")

    async def generate_diagnostic_report(self) -> Dict[str, Any]:
        """
        Generate a comprehensive diagnostic report including performance metrics.

        Returns:
            Dictionary containing diagnostic information
        """
        report = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "queue_processor": {
                "project_root": str(self.project_root),
                "project_root_exists": self.project_root.exists(),
                "specs_base": str(self.spec_manager.base_dir),
                "specs_base_exists": self.spec_manager.base_dir.exists(),
            },
            "files": {},
            "queue_status": {},
            "specifications": {},
            "recent_errors": [],
            "system_info": {},
            "performance_metrics": {
                "operations_processed": self.perf_metrics.operations_processed,
                "avg_processing_time_ms": self.perf_metrics.avg_processing_time_ms,
                "memory_usage_mb": self.perf_metrics.memory_usage_mb,
                "cache_hit_rate": self.perf_metrics.cache_hit_rate,
                "queue_throughput": self.perf_metrics.queue_throughput,
                "batch_efficiency": self.perf_metrics.batch_efficiency,
                "json_parse_time_ms": self.perf_metrics.json_parse_time_ms,
                "file_io_time_ms": self.perf_metrics.file_io_time_ms,
                "cache_size": self.operation_cache.size(),
                "last_updated": self.perf_metrics.last_updated.isoformat(),
            },
            "performance_config": {
                "max_queue_size": self.perf_config.max_queue_size,
                "max_batch_size": self.perf_config.max_batch_size,
                "lru_cache_size": self.perf_config.lru_cache_size,
                "parallel_processing": self.perf_config.parallel_processing,
                "streaming_json_enabled": self.perf_config.enable_streaming_json,
                "compression_enabled": self.perf_config.enable_compression,
            },
        }

        try:
            # File diagnostics
            for file_name, file_path in [
                ("queue_file", self.queue_file),
                ("results_file", self.results_file),
                ("sync_file", self.sync_file),
            ]:
                report["files"][file_name] = {
                    "path": str(file_path),
                    "exists": file_path.exists(),
                    "size": (file_path.stat().st_size if file_path.exists() else 0),
                    "modified": (
                        datetime.fromtimestamp(
                            file_path.stat().st_mtime, timezone.utc
                        ).isoformat()
                        if file_path.exists()
                        else None
                    ),
                }

            # Queue diagnostics
            try:
                queue = await self.load_operation_queue()
                report["queue_status"] = {
                    "total_operations": len(queue.operations),
                    "pending": len(
                        [
                            op
                            for op in queue.operations
                            if op.status == OperationStatus.PENDING
                        ]
                    ),
                    "in_progress": len(
                        [
                            op
                            for op in queue.operations
                            if op.status == OperationStatus.IN_PROGRESS
                        ]
                    ),
                    "failed": len(
                        [
                            op
                            for op in queue.operations
                            if op.status == OperationStatus.FAILED
                        ]
                    ),
                    "completed": len(
                        [
                            op
                            for op in queue.operations
                            if op.status == OperationStatus.COMPLETED
                        ]
                    ),
                    "last_processed": (
                        queue.last_processed.isoformat()
                        if queue.last_processed
                        else None
                    ),
                }
            except Exception as queue_error:
                report["queue_status"]["error"] = str(queue_error)

            # Specifications diagnostics
            report["specifications"] = {
                "total_count": len(self.spec_manager.specs),
                "current_spec": self.spec_manager.current_spec_id,
                "specs_list": list(self.spec_manager.specs.keys()),
            }

            # System diagnostics
            import platform
            import sys

            report["system_info"] = {
                "platform": platform.system(),
                "python_version": sys.version,
                "working_directory": str(Path.cwd()),
            }

        except Exception as e:
            report["diagnostic_error"] = str(e)

        return report

    async def _process_operations_with_batching(
        self, operations: List[Operation], queue: OperationQueue
    ) -> int:
        """Process operations using batching for improved performance."""
        if not operations:
            return 0

        processed_count = 0

        # Create batches for efficient processing
        batches = self.operation_batcher.group_operations(operations)

        # Process batches with controlled concurrency
        semaphore_tasks = []

        for batch in batches:
            task = self._process_batch_with_semaphore(batch, queue)
            semaphore_tasks.append(task)

        # Wait for all batches to complete
        batch_results = await asyncio.gather(*semaphore_tasks, return_exceptions=True)

        # Count successful operations
        for result in batch_results:
            if isinstance(result, int):
                processed_count += result
            elif isinstance(result, Exception):
                self.logger.error(f"Batch processing failed: {result}")

        return processed_count

    async def _process_batch_with_semaphore(
        self, batch: List[Operation], queue: OperationQueue
    ) -> int:
        """Process a batch of operations with concurrency control."""
        async with self._processing_semaphore:
            return await self._process_operation_batch(batch, queue)

    async def _process_operation_batch(
        self, batch: List[Operation], queue: OperationQueue
    ) -> int:
        """Process a batch of operations efficiently."""
        processed_count = 0
        batch_start_time = time.time()

        self.logger.info(f"Processing batch of {len(batch)} operations")

        for operation in batch:
            try:
                # Check cache first
                cache_key = self._get_operation_cache_key(operation)
                cached_result = self.operation_cache.get(cache_key)

                if cached_result and self._is_cache_valid(cached_result, operation):
                    # Use cached result
                    self.logger.debug(
                        f"Using cached result for operation {operation.id}"
                    )
                    await self._apply_cached_result(operation, cached_result)
                    processed_count += 1
                    continue

                # Detect conflicts before processing
                conflicts = await self.detect_operation_conflicts(operation, queue)

                if conflicts:
                    self.logger.info(
                        f"Detected {len(conflicts)} conflicts for operation {operation.id}"
                    )

                    # Try to resolve conflicts automatically
                    unresolved_conflicts = await self.resolve_conflicts_automatically(
                        conflicts, queue
                    )

                    if unresolved_conflicts:
                        # Log unresolved conflicts and defer operation
                        self.logger.warning(
                            f"Operation {operation.id} has {len(unresolved_conflicts)} unresolved conflicts"  # noqa: E501
                        )

                        # Update sync state with conflicts for extension to handle
                        await self._update_sync_state_with_conflicts(
                            unresolved_conflicts
                        )

                        # Defer operation by increasing priority
                        operation.priority = min(10, operation.priority + 3)
                        await self.update_operation_in_queue(operation)
                        continue

                # Process the operation
                result = await self.process_operation(operation)

                # Cache successful results for future use
                if result and operation.status == OperationStatus.COMPLETED:
                    self.operation_cache.put(
                        cache_key,
                        {
                            "result": result,
                            "timestamp": datetime.now(timezone.utc),
                            "operation_signature": self._get_operation_signature(
                                operation
                            ),
                        },
                    )

                processed_count += 1

            except Exception as e:
                self.logger.error(f"Failed to process operation {operation.id}: {e}")
                await self.mark_operation_failed(operation, str(e))

        batch_time = (time.time() - batch_start_time) * 1000
        batch_efficiency = processed_count / len(batch) if batch else 0

        # Update batch efficiency metrics
        self.perf_metrics.batch_efficiency = (
            self.perf_metrics.batch_efficiency * 0.9 + batch_efficiency * 0.1
        )

        self.logger.debug(
            f"Batch processed {processed_count}/{len(batch)} operations in {batch_time:.1f}ms"
        )
        return processed_count

    def _get_operation_cache_key(self, operation: Operation) -> str:
        """Generate cache key for operation."""
        signature = self._get_operation_signature(operation)
        return f"{operation.type}:{signature}"

    def _is_cache_valid(
        self, cached_result: Dict[str, Any], operation: Operation
    ) -> bool:
        """Check if cached result is still valid."""
        if not cached_result:
            return False

        # Check timestamp (cache expires after 5 minutes)
        cached_time = cached_result.get("timestamp")
        if cached_time:
            if isinstance(cached_time, str):
                cached_time = datetime.fromisoformat(cached_time.replace("Z", "+00:00"))

            if datetime.now(timezone.utc) - cached_time > timedelta(minutes=5):
                return False

        # Check if operation signature matches
        cached_sig = cached_result.get("operation_signature")
        current_sig = self._get_operation_signature(operation)

        return cached_sig == current_sig

    async def _apply_cached_result(
        self, operation: Operation, cached_result: Dict[str, Any]
    ) -> None:
        """Apply cached result to operation."""
        operation.status = OperationStatus.COMPLETED

        # Write cached result
        result_data = cached_result.get("result", {})
        await self.write_operation_result(
            OperationResult(
                operation_id=operation.id,
                success=True,
                message=result_data.get("message", "Operation completed (cached)"),
                data=result_data.get("data", {"cached": True}),
                timestamp=datetime.now(timezone.utc),
            )
        )

    async def _enforce_queue_limits(self, queue: OperationQueue) -> None:
        """Enforce queue size limits and perform cleanup."""
        if len(queue.operations) <= self.max_queue_size:
            return

        initial_count = len(queue.operations)

        # Remove old completed operations first
        cutoff_time = datetime.now(timezone.utc) - timedelta(hours=1)
        queue.operations = [
            op
            for op in queue.operations
            if not (
                op.status == OperationStatus.COMPLETED and op.timestamp < cutoff_time
            )
        ]

        # If still too many, remove oldest operations (keeping pending/in-progress)
        if len(queue.operations) > self.max_queue_size:
            # Sort by status priority and timestamp
            queue.operations.sort(
                key=lambda op: (
                    (
                        0
                        if op.status
                        in [
                            OperationStatus.PENDING,
                            OperationStatus.IN_PROGRESS,
                        ]
                        else 1
                    ),
                    op.timestamp,
                )
            )
            queue.operations = queue.operations[: self.max_queue_size]

        removed_count = initial_count - len(queue.operations)
        if removed_count > 0:
            self.logger.info(
                f"Enforced queue limits: removed {removed_count} operations"
            )

    async def _atomic_write_compressed_json(
        self, file_path: Path, data: Dict[str, Any]
    ) -> None:
        """Write JSON data with compression for large files."""
        import gzip

        temp_path = file_path.with_suffix(f"{file_path.suffix}.tmp")

        try:
            json_content = json.dumps(data, indent=2, default=str)

            # Compress if it would save significant space
            if len(json_content) > 10000:
                compressed_content = gzip.compress(json_content.encode("utf-8"))

                # Only use compression if it saves at least 20%
                if len(compressed_content) < len(json_content) * 0.8:
                    async with aiofiles.open(temp_path.with_suffix(".gz"), "wb") as f:
                        await f.write(compressed_content)
                    temp_path.with_suffix(".gz").rename(file_path.with_suffix(".gz"))

                    # Remove uncompressed version if it exists
                    if file_path.exists():
                        file_path.unlink()
                    return

            # Fall back to regular JSON
            async with aiofiles.open(temp_path, "w", encoding="utf-8") as f:
                await f.write(json_content)

            temp_path.rename(file_path)

        except Exception as e:
            if temp_path.exists():
                temp_path.unlink()
            if temp_path.with_suffix(".gz").exists():
                temp_path.with_suffix(".gz").unlink()
            raise e

    def _update_performance_metrics(self, processed_count: int) -> None:
        """Update performance tracking metrics."""
        current_time = time.time()
        time_delta = current_time - self._last_metrics_update

        if time_delta > 0:
            # Update throughput (operations per second)
            current_throughput = processed_count / time_delta
            self.perf_metrics.queue_throughput = (
                self.perf_metrics.queue_throughput * 0.8 + current_throughput * 0.2
            )

        # Update operation count
        self.perf_metrics.operations_processed += processed_count

        # Update cache hit rate
        self.perf_metrics.cache_hit_rate = self.operation_cache.get_hit_rate()

        # Update memory usage
        self.perf_metrics.memory_usage_mb = self._get_memory_usage_mb()

        # Update timestamp
        self.perf_metrics.last_updated = datetime.now(timezone.utc)
        self._last_metrics_update = current_time

    def _get_memory_usage_mb(self) -> float:
        """Get current memory usage in MB."""
        try:
            import os

            import psutil

            process = psutil.Process(os.getpid())
            return process.memory_info().rss / 1024 / 1024
        except ImportError:
            # Fallback to sys.getsizeof for approximate measurement
            total_size = 0
            total_size += sys.getsizeof(self.operation_cache.cache)
            total_size += sys.getsizeof(self._file_timestamps)
            return total_size / 1024 / 1024

    def get_performance_metrics(self) -> PerformanceMetrics:
        """Get current performance metrics."""
        # Update real-time metrics
        self.perf_metrics.memory_usage_mb = self._get_memory_usage_mb()
        self.perf_metrics.cache_hit_rate = self.operation_cache.get_hit_rate()
        return self.perf_metrics

    def get_detailed_performance_report(self) -> Dict[str, Any]:
        """Get detailed performance report with all metrics."""
        return {
            "core_metrics": {
                "operations_processed": self.perf_metrics.operations_processed,
                "avg_processing_time_ms": self.perf_metrics.avg_processing_time_ms,
                "memory_usage_mb": self.perf_metrics.memory_usage_mb,
                "queue_throughput": self.perf_metrics.queue_throughput,
                "last_updated": self.perf_metrics.last_updated.isoformat(),
            },
            "cache_metrics": {
                "cache_size": self.operation_cache.size(),
                "cache_hit_rate": self.operation_cache.get_hit_rate(),
                "cache_hits": self.operation_cache.hits,
                "cache_misses": self.operation_cache.misses,
            },
            "batching_metrics": self.operation_batcher.get_batch_stats(),
            "parsing_metrics": self.streaming_parser.get_cache_stats(),
            "background_tasks": {
                "active_tasks": len(self._background_tasks),
                "cleanup_running": self._cleanup_task is not None
                and not self._cleanup_task.done(),
                "compaction_running": self._queue_compaction_task is not None
                and not self._queue_compaction_task.done(),
            },
            "deduplication_metrics": {
                "tracked_fingerprints": len(self._operation_fingerprints),
                "unique_fingerprints": len(self._fingerprint_to_operation),
            },
            "configuration": {
                "max_queue_size": self.perf_config.max_queue_size,
                "max_batch_size": self.perf_config.max_batch_size,
                "lru_cache_size": self.perf_config.lru_cache_size,
                "streaming_enabled": self.perf_config.enable_streaming_json,
                "compression_enabled": self.perf_config.enable_compression,
                "parallel_processing": self.perf_config.parallel_processing,
                "batch_processing_enabled": self.perf_config.batch_processing_enabled,
                "deduplication_enabled": self.perf_config.operation_deduplication,
            },
        }

    def reset_performance_metrics(self) -> None:
        """Reset performance metrics."""
        self.perf_metrics = PerformanceMetrics()
        self.operation_cache.clear()

    async def optimize_performance(self) -> Dict[str, Any]:
        """Run comprehensive performance optimization tasks."""
        optimization_results = {}
        start_time = time.time()

        # Cache cleanup with TTL-based expiration
        initial_cache_size = self.operation_cache.size()
        expired_count = await self._cleanup_expired_cache_entries()
        optimization_results["cache_cleanup"] = {
            "initial_size": initial_cache_size,
            "final_size": self.operation_cache.size(),
            "expired_entries_removed": expired_count,
            "hit_rate": self.operation_cache.get_hit_rate(),
        }

        # Memory optimization with detailed tracking
        initial_memory = self._get_memory_usage_mb()
        memory_optimized = False

        if initial_memory > self.perf_config.memory_limit_mb:
            import gc

            # Clear parsing cache first
            self.streaming_parser.clear_cache()

            # Force garbage collection
            collected = gc.collect()
            memory_optimized = True

            optimization_results["memory_cleanup"] = {
                "initial_mb": initial_memory,
                "objects_collected": collected,
                "final_mb": self._get_memory_usage_mb(),
                "memory_freed_mb": initial_memory - self._get_memory_usage_mb(),
            }

        # Advanced queue optimization with compaction
        queue = await self.load_operation_queue()
        initial_queue_size = len(queue.operations)

        # Compact queue if needed
        compaction_stats = await self._compact_queue_if_needed(queue)

        # Apply enhanced limits
        await self._enforce_queue_limits(queue)

        # Remove duplicate operations
        dedup_stats = await self._deduplicate_queue_operations(queue)

        await self.save_operation_queue(queue)

        optimization_results["queue_optimization"] = {
            "initial_size": initial_queue_size,
            "final_size": len(queue.operations),
            "operations_removed": initial_queue_size - len(queue.operations),
            "compaction": compaction_stats,
            "deduplication": dedup_stats,
        }

        # Background task cleanup
        optimization_results["background_tasks"] = (
            await self._cleanup_background_tasks()
        )

        # File system optimization
        optimization_results["filesystem"] = await self._optimize_file_operations()

        # Performance metrics update
        optimization_time = (time.time() - start_time) * 1000
        optimization_results["optimization_time_ms"] = optimization_time
        optimization_results["memory_optimized"] = memory_optimized

        self.logger.info(
            f"Performance optimization completed in {optimization_time:.1f}ms"
        )
        return optimization_results

    async def _cleanup_expired_cache_entries(self) -> int:
        """Remove expired entries from result cache."""
        current_time = time.time()
        expired_keys = []

        for key, timestamp in self._result_cache_timestamps.items():
            if current_time - timestamp > self.perf_config.result_cache_ttl_seconds:
                expired_keys.append(key)

        for key in expired_keys:
            self.operation_cache.cache.pop(key, None)
            self._result_cache_timestamps.pop(key, None)

        return len(expired_keys)

    async def _compact_queue_if_needed(self, queue: OperationQueue) -> Dict[str, Any]:
        """Compact queue by removing completed operations if threshold is met."""
        if not queue.operations:
            return {"compaction_performed": False, "reason": "empty_queue"}

        completed_count = sum(
            1 for op in queue.operations if op.status == OperationStatus.COMPLETED
        )
        completion_ratio = completed_count / len(queue.operations)

        stats = {
            "compaction_performed": False,
            "completion_ratio": completion_ratio,
            "threshold": self.perf_config.queue_compaction_threshold,
            "operations_before": len(queue.operations),
            "operations_after": len(queue.operations),
            "operations_removed": 0,
        }

        if completion_ratio > self.perf_config.queue_compaction_threshold:
            # Keep only recent completed operations and all non-completed operations
            cutoff_time = datetime.now(timezone.utc) - timedelta(hours=2)

            compacted_operations = []
            for op in queue.operations:
                if op.status != OperationStatus.COMPLETED:
                    # Keep all non-completed operations
                    compacted_operations.append(op)
                elif op.timestamp > cutoff_time:
                    # Keep recent completed operations
                    compacted_operations.append(op)

            stats["operations_after"] = len(compacted_operations)
            stats["operations_removed"] = len(queue.operations) - len(
                compacted_operations
            )
            stats["compaction_performed"] = True

            queue.operations = compacted_operations
            queue.last_processed = datetime.now(timezone.utc)

            self.logger.info(
                f"Queue compacted: removed {stats['operations_removed']} completed operations"
            )

        return stats

    async def _deduplicate_queue_operations(
        self, queue: OperationQueue
    ) -> Dict[str, Any]:
        """Remove duplicate operations from queue."""
        if not self.perf_config.operation_deduplication:
            return {"deduplication_enabled": False}

        initial_count = len(queue.operations)
        seen_fingerprints = set()
        unique_operations = []

        for operation in queue.operations:
            # Generate fingerprint for the operation
            fingerprint = self._generate_operation_fingerprint(operation)

            if fingerprint not in seen_fingerprints:
                unique_operations.append(operation)
                seen_fingerprints.add(fingerprint)
                # Update tracking
                self._operation_fingerprints[operation.id] = fingerprint
                self._fingerprint_to_operation[fingerprint] = operation.id

        duplicates_removed = initial_count - len(unique_operations)
        queue.operations = unique_operations

        return {
            "deduplication_enabled": True,
            "initial_count": initial_count,
            "final_count": len(unique_operations),
            "duplicates_removed": duplicates_removed,
        }

    def _generate_operation_fingerprint(self, operation: Operation) -> str:
        """Generate a fingerprint for operation deduplication."""
        # Create a stable hash based on operation content
        import hashlib

        content_parts = [
            operation.type,
            str(operation.priority),
            str(sorted(operation.params.items())),
        ]

        # For file operations, include content hash to detect actual changes
        if operation.type in [
            OperationType.UPDATE_REQUIREMENTS,
            OperationType.UPDATE_DESIGN,
            OperationType.UPDATE_TASKS,
        ]:
            content = operation.params.get("content", "")
            content_hash = hashlib.md5(content.encode()).hexdigest()[:8]
            content_parts.append(content_hash)

        fingerprint_content = "|".join(content_parts)
        return hashlib.sha256(fingerprint_content.encode()).hexdigest()[:16]

    async def _cleanup_background_tasks(self) -> Dict[str, Any]:
        """Clean up completed background tasks."""
        initial_count = len(self._background_tasks)

        # Remove completed tasks
        completed_tasks = {task for task in self._background_tasks if task.done()}
        for task in completed_tasks:
            self._background_tasks.discard(task)
            if task.exception():
                self.logger.warning(f"Background task failed: {task.exception()}")

        return {
            "initial_tasks": initial_count,
            "completed_tasks": len(completed_tasks),
            "active_tasks": len(self._background_tasks),
        }

    async def _optimize_file_operations(self) -> Dict[str, Any]:
        """Optimize file system operations."""
        stats = {
            "temp_files_cleaned": 0,
            "backup_files_cleaned": 0,
            "disk_space_freed_mb": 0.0,
        }

        try:
            # Clean up old temporary files
            temp_pattern = "*.tmp"
            temp_files = list(self.project_root.glob(temp_pattern))

            for temp_file in temp_files:
                try:
                    # Remove temp files older than 1 hour
                    if time.time() - temp_file.stat().st_mtime > 3600:
                        file_size = temp_file.stat().st_size / (1024 * 1024)  # MB
                        temp_file.unlink()
                        stats["temp_files_cleaned"] += 1
                        stats["disk_space_freed_mb"] += file_size
                except OSError:
                    continue

            # Clean up old backup files
            backup_pattern = "*.corrupted_*"
            backup_files = list(self.project_root.glob(backup_pattern))

            # Keep only the 5 most recent backup files
            if len(backup_files) > 5:
                backup_files.sort(key=lambda p: p.stat().st_mtime)
                for backup_file in backup_files[:-5]:
                    try:
                        file_size = backup_file.stat().st_size / (1024 * 1024)  # MB
                        backup_file.unlink()
                        stats["backup_files_cleaned"] += 1
                        stats["disk_space_freed_mb"] += file_size
                    except OSError:
                        continue

        except Exception as e:
            self.logger.warning(f"File system optimization failed: {e}")

        return stats

    async def start_background_processing(self) -> None:
        """Start background processing tasks."""
        if self.perf_config.background_cleanup_interval > 0:
            self._cleanup_task = asyncio.create_task(self._background_cleanup_loop())
            self._background_tasks.add(self._cleanup_task)

        # Start queue compaction task
        self._queue_compaction_task = asyncio.create_task(self._queue_compaction_loop())
        self._background_tasks.add(self._queue_compaction_task)

        self.logger.info("Background processing tasks started")

    async def _background_cleanup_loop(self) -> None:
        """Background cleanup loop."""
        while True:
            try:
                await asyncio.sleep(self.perf_config.background_cleanup_interval)
                await self.optimize_performance()
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error(f"Background cleanup error: {e}")
                await asyncio.sleep(60)  # Wait before retrying

    async def _queue_compaction_loop(self) -> None:
        """Background queue compaction loop."""
        while True:
            try:
                # Run compaction every 10 minutes
                await asyncio.sleep(600)

                queue = await self.load_operation_queue()
                if len(queue.operations) > 100:  # Only compact if queue is substantial
                    compaction_stats = await self._compact_queue_if_needed(queue)
                    if compaction_stats["compaction_performed"]:
                        await self.save_operation_queue(queue)
                        self.logger.info(
                            f"Background compaction completed: {compaction_stats}"
                        )
            except asyncio.CancelledError:
                break
            except Exception as e:
                self.logger.error(f"Background compaction error: {e}")
                await asyncio.sleep(300)  # Wait 5 minutes before retrying

    async def stop_background_processing(self) -> None:
        """Stop all background processing tasks."""
        # Cancel all background tasks
        for task in self._background_tasks:
            if not task.done():
                task.cancel()

        # Wait for tasks to complete
        if self._background_tasks:
            await asyncio.gather(*self._background_tasks, return_exceptions=True)

        self._background_tasks.clear()
        self._cleanup_task = None
        self._queue_compaction_task = None

        self.logger.info("Background processing tasks stopped")

    # Utility Methods

    async def atomic_write_json(self, file_path: Path, data: Dict[str, Any]) -> None:
        """
        Write JSON data to file atomically using temporary file and rename.

        Args:
            file_path: Path to write to
            data: Data to write as JSON
        """
        temp_path = file_path.with_suffix(f"{file_path.suffix}.tmp")

        try:
            # Write to temporary file
            async with aiofiles.open(temp_path, "w", encoding="utf-8") as f:
                json_content = json.dumps(data, indent=2, default=str)
                await f.write(json_content)

            # Atomic rename
            temp_path.rename(file_path)

        except Exception as e:
            # Clean up temp file on failure
            if temp_path.exists():
                temp_path.unlink()
            raise e

    async def backup_corrupted_file(self, file_path: Path) -> None:
        """
        Backup a corrupted file for debugging.

        Args:
            file_path: Path to the corrupted file
        """
        if not file_path.exists():
            return

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = file_path.with_suffix(f".corrupted_{timestamp}{file_path.suffix}")

        try:
            file_path.rename(backup_path)
            self.logger.info(f"Backed up corrupted file to {backup_path}")
        except Exception as e:
            self.logger.error(f"Failed to backup corrupted file: {e}")
