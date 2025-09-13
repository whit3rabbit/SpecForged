"""
Test fixtures and utilities for integration tests.

This module provides shared fixtures, utilities, and helpers for setting up
complex integration test scenarios.
"""

import asyncio
import json
import os
import shutil
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from unittest.mock import MagicMock

import pytest
from pydantic import BaseModel

from src.specforged.core.queue_processor import (
    Operation,
    OperationQueue,
    OperationResult,
    OperationStatus,
    OperationType,
    QueueProcessor,
    SyncState,
)
from src.specforged.core.spec_manager import SpecificationManager
from src.specforged.models.core import Specification, UserStory, WorkflowPhase


class IntegrationTestWorkspace:
    """
    A complete test workspace that simulates the VS Code extension + MCP server environment.
    """

    def __init__(self, workspace_dir: Path):
        self.workspace_dir = workspace_dir
        self.specs_dir = workspace_dir / "specifications"

        # IPC file paths
        self.queue_file = workspace_dir / "mcp-operations.json"
        self.results_file = workspace_dir / "mcp-results.json"
        self.sync_file = workspace_dir / "specforge-sync.json"

        # Test components
        self.spec_manager: Optional[SpecificationManager] = None
        self.queue_processor: Optional[QueueProcessor] = None

        # Test state tracking
        self.operation_results: List[OperationResult] = []
        self.processed_operations: List[Operation] = []
        self.file_changes: List[Tuple[str, str, datetime]] = (
            []
        )  # (path, change_type, timestamp)

    async def setup(self) -> None:
        """Set up the test workspace with all necessary components."""
        # Create directory structure
        self.workspace_dir.mkdir(parents=True, exist_ok=True)
        self.specs_dir.mkdir(exist_ok=True)

        # Initialize specification manager
        self.spec_manager = SpecificationManager(base_dir=self.specs_dir)
        self.spec_manager.project_detector.project_root = self.workspace_dir

        # Initialize queue processor
        self.queue_processor = QueueProcessor(self.spec_manager, self.workspace_dir)

        # Create initial sync state
        await self._create_initial_sync_state()

    async def cleanup(self) -> None:
        """Clean up the test workspace."""
        if self.workspace_dir.exists():
            shutil.rmtree(self.workspace_dir)

    async def _create_initial_sync_state(self) -> None:
        """Create initial sync state file."""
        sync_state = SyncState(
            extension_online=True,
            mcp_server_online=True,
            last_sync=datetime.now(timezone.utc),
        )

        await self.queue_processor.atomic_write_json(
            self.sync_file, sync_state.model_dump()
        )

    async def queue_operation(self, operation: Operation) -> None:
        """Queue an operation for processing."""
        queue = await self.queue_processor.load_operation_queue()
        queue.operations.append(operation)
        queue.version += 1
        await self.queue_processor.save_operation_queue(queue)

    async def process_all_operations(self) -> List[OperationResult]:
        """Process all queued operations and return results."""
        await self.queue_processor.process_operation_queue()

        # Load results
        if self.results_file.exists():
            with open(self.results_file, "r") as f:
                data = json.load(f)
                return [OperationResult(**result) for result in data.get("results", [])]
        return []

    async def simulate_extension_operation(
        self, operation_type: OperationType, params: Dict[str, Any], priority: int = 5
    ) -> str:
        """Simulate an operation coming from the VS Code extension."""
        operation_id = f"ext_{int(time.time() * 1000)}_{len(self.processed_operations)}"

        operation = Operation(
            id=operation_id,
            type=operation_type,
            timestamp=datetime.now(timezone.utc),
            params=params,
            priority=priority,
            source="extension",
        )

        await self.queue_operation(operation)
        return operation_id

    async def simulate_file_modification(
        self, spec_id: str, file_name: str, new_content: str, delay_seconds: float = 0
    ) -> None:
        """Simulate external file modification (e.g., user editing files directly)."""
        if delay_seconds > 0:
            await asyncio.sleep(delay_seconds)

        file_path = self.specs_dir / spec_id / file_name
        file_path.parent.mkdir(parents=True, exist_ok=True)

        with open(file_path, "w") as f:
            f.write(new_content)

        self.file_changes.append(
            (str(file_path), "modified", datetime.now(timezone.utc))
        )

    async def get_sync_state(self) -> SyncState:
        """Get current sync state."""
        if self.sync_file.exists():
            with open(self.sync_file, "r") as f:
                data = json.load(f)
                return SyncState(**data)
        return SyncState(
            extension_online=False,
            mcp_server_online=False,
            last_sync=datetime.now(timezone.utc),
        )

    async def get_operation_queue(self) -> OperationQueue:
        """Get current operation queue."""
        return await self.queue_processor.load_operation_queue()

    async def wait_for_operation_completion(
        self, operation_id: str, timeout_seconds: int = 30
    ) -> Optional[OperationResult]:
        """Wait for a specific operation to complete."""
        start_time = time.time()

        while time.time() - start_time < timeout_seconds:
            results = await self.process_all_operations()
            for result in results:
                if result.operation_id == operation_id:
                    return result
            await asyncio.sleep(0.1)

        return None

    async def simulate_server_offline_period(self, duration_seconds: float) -> None:
        """Simulate the MCP server being offline for a period."""
        # Mark server as offline in sync state
        sync_state = await self.get_sync_state()
        sync_state.mcp_server_online = False
        await self.queue_processor.atomic_write_json(
            self.sync_file, sync_state.model_dump()
        )

        # Wait for the offline period
        await asyncio.sleep(duration_seconds)

        # Mark server as back online
        sync_state.mcp_server_online = True
        sync_state.last_sync = datetime.now(timezone.utc)
        await self.queue_processor.atomic_write_json(
            self.sync_file, sync_state.model_dump()
        )

    async def create_test_specification(
        self, spec_id: str, name: str, include_files: bool = True
    ) -> Specification:
        """Create a test specification with optional files."""
        spec = self.spec_manager.create_specification(
            name, f"Test spec: {name}", spec_id
        )

        if include_files:
            # Create some test content
            requirements_content = f"""# Requirements for {name}

## User Story 1
**As a** user
**I want** to test the system
**So that** I can verify functionality

### Acceptance Criteria
- THE SYSTEM SHALL process the test request
- WHEN the test runs THE SYSTEM SHALL return results
- IF the test fails THEN THE SYSTEM SHALL report errors
"""

            design_content = f"""# Design for {name}

## Architecture Overview
This is a test specification for integration testing.

## Components
- Test Component A
- Test Component B

## Data Models
- TestModel: Contains test data
"""

            tasks_content = f"""# Implementation Plan for {name}

## Progress Summary
- **Total Tasks:** 3
- **Completed:** 0
- **Pending:** 3
- **Progress:** 0%

- [ ] 1. Set up test infrastructure
- [ ] 2. Implement test logic
- [ ] 3. Add test validation
"""

            # Write files
            spec_dir = self.specs_dir / spec_id
            (spec_dir / "requirements.md").write_text(requirements_content)
            (spec_dir / "design.md").write_text(design_content)
            (spec_dir / "tasks.md").write_text(tasks_content)

        return spec


class MockMcpServer:
    """
    Mock MCP server that simulates server behavior for integration tests.
    """

    def __init__(self, workspace: IntegrationTestWorkspace):
        self.workspace = workspace
        self.is_running = False
        self.processing_delay = 0.1  # Seconds
        self.failure_rate = 0.0  # 0.0 = never fail, 1.0 = always fail
        self.server_errors: List[str] = []

    async def start(self) -> None:
        """Start the mock server."""
        self.is_running = True
        self.server_errors.clear()

        # Start processing loop
        asyncio.create_task(self._processing_loop())

    async def stop(self) -> None:
        """Stop the mock server."""
        self.is_running = False

    async def _processing_loop(self) -> None:
        """Main processing loop that simulates server operation."""
        while self.is_running:
            try:
                if self.workspace.queue_processor:
                    await self.workspace.queue_processor.process_operation_queue()
            except Exception as e:
                self.server_errors.append(str(e))

            await asyncio.sleep(self.processing_delay)

    def set_processing_delay(self, delay_seconds: float) -> None:
        """Set artificial processing delay."""
        self.processing_delay = delay_seconds

    def set_failure_rate(self, rate: float) -> None:
        """Set failure rate for operations (0.0 - 1.0)."""
        self.failure_rate = max(0.0, min(1.0, rate))


class PerformanceMonitor:
    """
    Monitor performance metrics during integration tests.
    """

    def __init__(self):
        self.operation_times: List[float] = []
        self.queue_sizes: List[int] = []
        self.memory_usage: List[int] = []
        self.start_time: Optional[float] = None
        self.end_time: Optional[float] = None

    def start_monitoring(self) -> None:
        """Start performance monitoring."""
        self.start_time = time.time()
        self.operation_times.clear()
        self.queue_sizes.clear()
        self.memory_usage.clear()

    def stop_monitoring(self) -> None:
        """Stop performance monitoring."""
        self.end_time = time.time()

    def record_operation_time(self, operation_time: float) -> None:
        """Record time taken for an operation."""
        self.operation_times.append(operation_time)

    def record_queue_size(self, size: int) -> None:
        """Record queue size."""
        self.queue_sizes.append(size)

    def get_performance_report(self) -> Dict[str, Any]:
        """Generate performance report."""
        total_time = (self.end_time or time.time()) - (self.start_time or 0)

        return {
            "total_test_time": total_time,
            "operations_processed": len(self.operation_times),
            "average_operation_time": (
                sum(self.operation_times) / len(self.operation_times)
                if self.operation_times
                else 0
            ),
            "min_operation_time": (
                min(self.operation_times) if self.operation_times else 0
            ),
            "max_operation_time": (
                max(self.operation_times) if self.operation_times else 0
            ),
            "average_queue_size": (
                sum(self.queue_sizes) / len(self.queue_sizes) if self.queue_sizes else 0
            ),
            "max_queue_size": max(self.queue_sizes) if self.queue_sizes else 0,
            "operations_per_second": (
                len(self.operation_times) / total_time if total_time > 0 else 0
            ),
        }


@pytest.fixture
async def integration_workspace():
    """Create a temporary integration test workspace."""
    with tempfile.TemporaryDirectory(prefix="specforged_integration_") as temp_dir:
        workspace = IntegrationTestWorkspace(Path(temp_dir))
        await workspace.setup()

        try:
            yield workspace
        finally:
            await workspace.cleanup()


@pytest.fixture
async def mock_mcp_server(integration_workspace):
    """Create a mock MCP server for testing."""
    server = MockMcpServer(integration_workspace)
    await server.start()

    try:
        yield server
    finally:
        await server.stop()


@pytest.fixture
def performance_monitor():
    """Create a performance monitor for tests."""
    monitor = PerformanceMonitor()
    return monitor


def create_test_operation(
    operation_type: OperationType,
    params: Dict[str, Any],
    priority: int = 5,
    operation_id: Optional[str] = None,
) -> Operation:
    """Create a test operation with common defaults."""
    if operation_id is None:
        operation_id = f"test_{operation_type}_{int(time.time() * 1000)}"

    return Operation(
        id=operation_id,
        type=operation_type,
        timestamp=datetime.now(timezone.utc),
        params=params,
        priority=priority,
        source="integration_test",
    )


def create_conflicting_operations(
    spec_id: str, operation_count: int = 3, time_interval: float = 1.0
) -> List[Operation]:
    """Create a set of operations that will conflict with each other."""
    operations = []
    base_time = datetime.now(timezone.utc)

    for i in range(operation_count):
        operation = Operation(
            id=f"conflict_op_{i}_{spec_id}",
            type=OperationType.UPDATE_REQUIREMENTS,
            timestamp=base_time + timedelta(seconds=i * time_interval),
            params={
                "specId": spec_id,
                "content": f"Conflicting requirements content version {i}",
            },
            priority=5,
            source="conflict_test",
        )
        operations.append(operation)

    return operations


async def wait_for_condition(
    condition_func, timeout_seconds: int = 10, check_interval: float = 0.1
) -> bool:
    """Wait for a condition to become true."""
    start_time = time.time()

    while time.time() - start_time < timeout_seconds:
        if await condition_func():
            return True
        await asyncio.sleep(check_interval)

    return False


class OperationBuilder:
    """Builder pattern for creating complex test operations."""

    def __init__(self):
        self.reset()

    def reset(self):
        self._id = None
        self._type = None
        self._params = {}
        self._priority = 5
        self._dependencies = []
        self._retry_count = 0
        self._max_retries = 3
        self._timestamp = None
        return self

    def with_id(self, operation_id: str):
        self._id = operation_id
        return self

    def with_type(self, operation_type: OperationType):
        self._type = operation_type
        return self

    def with_params(self, **params):
        self._params.update(params)
        return self

    def with_priority(self, priority: int):
        self._priority = priority
        return self

    def with_dependencies(self, *dep_ids):
        self._dependencies.extend(dep_ids)
        return self

    def with_retry_config(self, retry_count: int = 0, max_retries: int = 3):
        self._retry_count = retry_count
        self._max_retries = max_retries
        return self

    def with_timestamp(self, timestamp: datetime):
        self._timestamp = timestamp
        return self

    def build(self) -> Operation:
        if self._id is None:
            self._id = f"built_op_{int(time.time() * 1000000)}"
        if self._type is None:
            raise ValueError("Operation type must be specified")
        if self._timestamp is None:
            self._timestamp = datetime.now(timezone.utc)

        return Operation(
            id=self._id,
            type=self._type,
            timestamp=self._timestamp,
            params=self._params,
            priority=self._priority,
            retry_count=self._retry_count,
            max_retries=self._max_retries,
            source="builder",
        )
