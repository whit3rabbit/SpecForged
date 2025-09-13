"""
End-to-end integration tests with actual MCP server process.

This module tests the complete SpecForge ecosystem by spawning an actual
MCP server process and testing real VS Code extension interactions.
"""

import asyncio
import json
import os
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

import pytest

from src.specforged.core.queue_processor import (
    OperationResult,
    OperationStatus,
    OperationType,
)

from .fixtures import (
    IntegrationTestWorkspace,
    PerformanceMonitor,
    create_test_operation,
    wait_for_condition,
)


class ActualMcpServerWorkspace(IntegrationTestWorkspace):
    """Extended workspace that manages an actual MCP server process."""

    def __init__(self, workspace_dir: Path):
        super().__init__(workspace_dir)
        self.server_process: Optional[subprocess.Popen] = None
        self.server_startup_timeout = 10  # seconds

    async def start_actual_mcp_server(self) -> None:
        """Start the actual SpecForge MCP server process."""
        if self.server_process:
            await self.stop_mcp_server()

        # Set up environment for MCP server
        env = os.environ.copy()
        env["SPECFORGED_PROJECT_ROOT"] = str(self.workspace_dir)

        # Start the server process
        self.server_process = subprocess.Popen(
            ["python", "-m", "specforged.main"],
            cwd=str(self.workspace_dir),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

        # Wait for server to start up
        startup_success = await self._wait_for_server_startup()
        if not startup_success:
            await self.stop_mcp_server()
            raise RuntimeError("MCP server failed to start within timeout")

        print(f"Actual MCP server started (PID: {self.server_process.pid})")

    async def stop_mcp_server(self) -> None:
        """Stop the MCP server process."""
        if self.server_process:
            self.server_process.terminate()

            # Wait for graceful shutdown
            try:
                self.server_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                # Force kill if needed
                self.server_process.kill()
                self.server_process.wait()

            print(f"MCP server stopped")
            self.server_process = None

    async def get_server_logs(self) -> tuple[str, str]:
        """Get server stdout and stderr logs."""
        if not self.server_process:
            return "", ""

        # Read available output without blocking
        stdout_data = ""
        stderr_data = ""

        if self.server_process.stdout:
            try:
                stdout_data = self.server_process.stdout.read()
            except:
                pass

        if self.server_process.stderr:
            try:
                stderr_data = self.server_process.stderr.read()
            except:
                pass

        return stdout_data, stderr_data

    async def _wait_for_server_startup(self) -> bool:
        """Wait for the MCP server to start up and be ready."""
        startup_time = time.time()

        while time.time() - startup_time < self.server_startup_timeout:
            # Check if process is still running
            if self.server_process and self.server_process.poll() is not None:
                return False  # Process died

            # Check for server readiness indicators
            # This could be improved by checking for specific log messages
            # or trying to send a test operation

            # Simple check: see if sync file gets created/updated
            if self.sync_file.exists():
                try:
                    with open(self.sync_file, "r") as f:
                        sync_data = json.load(f)
                    if sync_data.get("mcp_server_online"):
                        return True
                except:
                    pass

            await asyncio.sleep(0.5)

        return False

    async def cleanup(self) -> None:
        """Clean up workspace and server process."""
        await self.stop_mcp_server()
        await super().cleanup()


class TestEndToEndWithActualServer:
    """Test end-to-end scenarios with actual MCP server process."""

    @pytest.mark.asyncio
    async def test_actual_server_startup_and_shutdown(self):
        """Test that the actual MCP server can start up and shut down properly."""
        with tempfile.TemporaryDirectory(prefix="specforged_e2e_") as temp_dir:
            workspace = ActualMcpServerWorkspace(Path(temp_dir))
            await workspace.setup()

            try:
                # Start actual server
                await workspace.start_actual_mcp_server()

                # Verify server is running
                assert workspace.server_process is not None
                assert (
                    workspace.server_process.poll() is None
                ), "Server process should be running"

                # Check sync state indicates server is online
                await asyncio.sleep(1)  # Give server time to initialize

                if workspace.sync_file.exists():
                    with open(workspace.sync_file, "r") as f:
                        sync_data = json.load(f)
                    assert sync_data.get(
                        "mcp_server_online", False
                    ), "Server should be marked as online"

                # Get server logs
                stdout, stderr = await workspace.get_server_logs()
                print(f"Server stdout: {stdout}")
                if stderr:
                    print(f"Server stderr: {stderr}")

            finally:
                await workspace.cleanup()

    @pytest.mark.asyncio
    async def test_real_operation_processing_with_actual_server(self):
        """Test real operation processing with the actual MCP server."""
        with tempfile.TemporaryDirectory(prefix="specforged_e2e_") as temp_dir:
            workspace = ActualMcpServerWorkspace(Path(temp_dir))
            await workspace.setup()

            try:
                # Start actual server
                await workspace.start_actual_mcp_server()

                # Wait for server to be fully ready
                await asyncio.sleep(2)

                # Create a real operation
                operation = create_test_operation(
                    OperationType.CREATE_SPEC,
                    {
                        "name": "Actual Server Test Spec",
                        "description": "Testing with real MCP server",
                        "specId": "actual-server-test",
                    },
                    priority=7,
                )

                # Queue the operation
                await workspace.queue_operation(operation)

                # Wait for processing
                result = await workspace.wait_for_operation_completion(
                    operation.id, timeout_seconds=30
                )

                # Verify result
                assert (
                    result is not None
                ), "Operation should complete with actual server"
                assert (
                    result.success
                ), f"Operation should succeed: {result.message if result else 'No result'}"

                # Verify specification was actually created
                spec_dir = workspace.specs_dir / "actual-server-test"
                spec_file = spec_dir / "spec.json"

                # Give file system time to sync
                await asyncio.sleep(1)

                if spec_file.exists():
                    with open(spec_file, "r") as f:
                        spec_data = json.load(f)
                    assert spec_data["name"] == "Actual Server Test Spec"
                    assert spec_data["id"] == "actual-server-test"

                # Get server logs for debugging
                stdout, stderr = await workspace.get_server_logs()
                if stdout:
                    print(f"Server output during operation: {stdout}")

            finally:
                await workspace.cleanup()

    @pytest.mark.asyncio
    async def test_multiple_operations_with_actual_server(self):
        """Test multiple operations with the actual MCP server."""
        with tempfile.TemporaryDirectory(prefix="specforged_e2e_") as temp_dir:
            workspace = ActualMcpServerWorkspace(Path(temp_dir))
            await workspace.setup()

            try:
                # Start actual server
                await workspace.start_actual_mcp_server()
                await asyncio.sleep(2)  # Server startup time

                # Create multiple operations
                operations = [
                    create_test_operation(
                        OperationType.CREATE_SPEC,
                        {
                            "name": f"Multi Test Spec {i}",
                            "description": f"Multiple operations test {i}",
                            "specId": f"multi-test-{i}",
                        },
                        priority=5,
                    )
                    for i in range(5)
                ]

                # Queue all operations
                operation_ids = []
                for operation in operations:
                    await workspace.queue_operation(operation)
                    operation_ids.append(operation.id)

                # Wait for all operations to complete
                results = []
                for op_id in operation_ids:
                    result = await workspace.wait_for_operation_completion(
                        op_id, timeout_seconds=45
                    )
                    results.append(result)

                # Verify results
                successful_operations = sum(
                    1 for result in results if result and result.success
                )
                assert (
                    successful_operations >= 4
                ), f"At least 4/5 operations should succeed with actual server: {successful_operations}"

                # Verify sync state
                if workspace.sync_file.exists():
                    with open(workspace.sync_file, "r") as f:
                        sync_data = json.load(f)

                    # Should show completed operations
                    completed_ops = sync_data.get("completedOperations", 0)
                    assert (
                        completed_ops >= 4
                    ), f"Sync state should show completed operations: {completed_ops}"

            finally:
                await workspace.cleanup()

    @pytest.mark.asyncio
    async def test_server_crash_recovery(self):
        """Test recovery after server crash."""
        with tempfile.TemporaryDirectory(prefix="specforged_e2e_") as temp_dir:
            workspace = ActualMcpServerWorkspace(Path(temp_dir))
            await workspace.setup()

            try:
                # Start server and create initial operation
                await workspace.start_actual_mcp_server()
                await asyncio.sleep(2)

                initial_op = create_test_operation(
                    OperationType.CREATE_SPEC,
                    {
                        "name": "Pre-Crash Spec",
                        "description": "Created before crash",
                        "specId": "pre-crash-spec",
                    },
                    priority=8,
                )

                await workspace.queue_operation(initial_op)

                # Wait for initial operation to complete
                initial_result = await workspace.wait_for_operation_completion(
                    initial_op.id, 20
                )
                assert (
                    initial_result and initial_result.success
                ), "Initial operation should succeed"

                # Queue operations that will be in progress during crash
                crash_ops = []
                for i in range(3):
                    op = create_test_operation(
                        OperationType.CREATE_SPEC,
                        {
                            "name": f"Crash Test Spec {i}",
                            "description": f"Operation during crash {i}",
                            "specId": f"crash-test-{i}",
                        },
                        priority=6,
                    )
                    await workspace.queue_operation(op)
                    crash_ops.append(op)

                # Simulate server crash
                print("Simulating server crash...")
                await workspace.stop_mcp_server()

                # Wait a moment
                await asyncio.sleep(1)

                # Restart server
                print("Restarting server...")
                await workspace.start_actual_mcp_server()
                await asyncio.sleep(3)  # Give server time to recover

                # Check that operations are handled after restart
                recovered_count = 0
                for op in crash_ops:
                    result = await workspace.wait_for_operation_completion(op.id, 30)
                    if result and result.success:
                        recovered_count += 1

                # Should recover most operations
                assert (
                    recovered_count >= 2
                ), f"Should recover most operations after crash: {recovered_count}/3"

                # Verify server stability after restart
                stability_op = create_test_operation(
                    OperationType.CREATE_SPEC,
                    {
                        "name": "Post-Crash Stability Test",
                        "description": "Testing stability after restart",
                        "specId": "post-crash-stability",
                    },
                    priority=9,
                )

                await workspace.queue_operation(stability_op)
                stability_result = await workspace.wait_for_operation_completion(
                    stability_op.id, 20
                )

                assert (
                    stability_result is not None
                ), "Server should be stable after restart"
                assert (
                    stability_result.success
                ), "Operations should work after server restart"

            finally:
                await workspace.cleanup()

    @pytest.mark.asyncio
    async def test_performance_with_actual_server(self):
        """Test performance characteristics with actual MCP server."""
        with tempfile.TemporaryDirectory(prefix="specforged_e2e_") as temp_dir:
            workspace = ActualMcpServerWorkspace(Path(temp_dir))
            await workspace.setup()

            performance_monitor = PerformanceMonitor()

            try:
                # Start server
                await workspace.start_actual_mcp_server()
                await asyncio.sleep(2)

                performance_monitor.start_monitoring()

                # Create batch of operations
                batch_size = 15
                operation_ids = []

                batch_start = time.time()

                for i in range(batch_size):
                    op = create_test_operation(
                        OperationType.CREATE_SPEC,
                        {
                            "name": f"Performance Test Spec {i}",
                            "description": f"Performance testing operation {i}",
                            "specId": f"perf-test-{i:02d}",
                        },
                        priority=5,
                    )
                    await workspace.queue_operation(op)
                    operation_ids.append(op.id)

                queuing_time = time.time() - batch_start

                # Wait for all operations to complete
                processing_start = time.time()
                completed_count = 0

                for op_id in operation_ids:
                    result = await workspace.wait_for_operation_completion(op_id, 60)
                    if result and result.success:
                        completed_count += 1

                    operation_time = time.time() - processing_start
                    performance_monitor.record_operation_time(operation_time)

                total_time = time.time() - batch_start
                performance_monitor.stop_monitoring()

                # Performance assertions
                success_rate = (completed_count / batch_size) * 100
                throughput = completed_count / total_time if total_time > 0 else 0

                assert (
                    success_rate >= 80.0
                ), f"Success rate should be at least 80% with actual server: {success_rate:.1f}%"
                assert (
                    throughput >= 0.5
                ), f"Throughput should be at least 0.5 ops/sec: {throughput:.2f}"
                assert (
                    total_time <= 60.0
                ), f"Batch should complete within 60 seconds: {total_time:.2f}s"

                # Generate performance report
                perf_report = performance_monitor.get_performance_report()

                print(f"Actual server performance:")
                print(
                    f"  Operations: {completed_count}/{batch_size} ({success_rate:.1f}%)"
                )
                print(f"  Total time: {total_time:.2f}s")
                print(f"  Queuing time: {queuing_time:.2f}s")
                print(f"  Throughput: {throughput:.2f} ops/sec")
                print(
                    f"  Average operation time: {perf_report['average_operation_time']:.2f}s"
                )

            finally:
                await workspace.cleanup()

    @pytest.mark.asyncio
    async def test_complex_workflow_with_actual_server(self):
        """Test a complex workflow scenario with actual MCP server."""
        with tempfile.TemporaryDirectory(prefix="specforged_e2e_") as temp_dir:
            workspace = ActualMcpServerWorkspace(Path(temp_dir))
            await workspace.setup()

            try:
                # Start server
                await workspace.start_actual_mcp_server()
                await asyncio.sleep(2)

                # Step 1: Create a specification
                create_op = create_test_operation(
                    OperationType.CREATE_SPEC,
                    {
                        "name": "Complex Workflow Test",
                        "description": "Testing complex workflow with actual server",
                        "specId": "complex-workflow",
                    },
                    priority=8,
                )

                await workspace.queue_operation(create_op)
                create_result = await workspace.wait_for_operation_completion(
                    create_op.id, 20
                )
                assert (
                    create_result and create_result.success
                ), "Create operation should succeed"

                # Step 2: Update requirements
                req_op = create_test_operation(
                    OperationType.UPDATE_REQUIREMENTS,
                    {
                        "specId": "complex-workflow",
                        "content": """# Complex Workflow Requirements

## User Story 1
**As a** developer
**I want** to test complex workflows
**So that** the system works end-to-end

### Acceptance Criteria
- THE SYSTEM SHALL handle multi-step workflows
- WHEN operations are processed THE SYSTEM SHALL maintain state consistency
- IF errors occur THEN THE SYSTEM SHALL recover gracefully
""",
                    },
                    priority=7,
                )

                # Set dependency on create operation
                req_op.dependencies = [create_op.id]

                await workspace.queue_operation(req_op)
                req_result = await workspace.wait_for_operation_completion(
                    req_op.id, 20
                )
                assert (
                    req_result and req_result.success
                ), "Requirements update should succeed"

                # Step 3: Update design
                design_op = create_test_operation(
                    OperationType.UPDATE_DESIGN,
                    {
                        "specId": "complex-workflow",
                        "content": """# Complex Workflow Design

## Architecture
The system follows a file-based IPC architecture:
- VS Code Extension handles UI and file operations
- MCP Server processes business logic
- File system provides persistence layer

## Components
- Operation Queue Manager
- Conflict Resolution Engine
- Sync State Tracker
""",
                    },
                    priority=6,
                )

                # Set dependency on requirements operation
                design_op.dependencies = [req_op.id]

                await workspace.queue_operation(design_op)
                design_result = await workspace.wait_for_operation_completion(
                    design_op.id, 20
                )
                assert (
                    design_result and design_result.success
                ), "Design update should succeed"

                # Step 4: Add user story
                story_op = create_test_operation(
                    OperationType.ADD_USER_STORY,
                    {
                        "specId": "complex-workflow",
                        "userStory": {
                            "as_a": "QA engineer",
                            "i_want": "comprehensive end-to-end testing",
                            "so_that": "the system quality is assured",
                        },
                    },
                    priority=5,
                )

                await workspace.queue_operation(story_op)
                story_result = await workspace.wait_for_operation_completion(
                    story_op.id, 20
                )
                assert (
                    story_result and story_result.success
                ), "User story addition should succeed"

                # Verify final state
                final_sync_state = None
                if workspace.sync_file.exists():
                    with open(workspace.sync_file, "r") as f:
                        final_sync_state = json.load(f)

                if final_sync_state:
                    # Should show all operations completed
                    completed_ops = final_sync_state.get("completedOperations", 0)
                    assert (
                        completed_ops >= 4
                    ), f"Should show completed operations: {completed_ops}"

                    # Should have specification tracked
                    specs = final_sync_state.get("specifications", [])
                    workflow_spec = next(
                        (s for s in specs if s.get("specId") == "complex-workflow"),
                        None,
                    )
                    assert (
                        workflow_spec is not None
                    ), "Workflow specification should be tracked"

                # Verify dependency execution order
                # (Requirements should complete after create, design after requirements)
                create_time = datetime.fromisoformat(
                    create_result.timestamp.replace("Z", "+00:00")
                )
                req_time = datetime.fromisoformat(
                    req_result.timestamp.replace("Z", "+00:00")
                )
                design_time = datetime.fromisoformat(
                    design_result.timestamp.replace("Z", "+00:00")
                )

                assert (
                    create_time <= req_time
                ), "Requirements should complete after create"
                assert (
                    req_time <= design_time
                ), "Design should complete after requirements"

                print(
                    "Complex workflow completed successfully with proper dependency ordering"
                )

            finally:
                await workspace.cleanup()


class TestActualServerErrorConditions:
    """Test error conditions with actual MCP server."""

    @pytest.mark.asyncio
    async def test_server_startup_failure_handling(self):
        """Test handling when MCP server fails to start."""
        with tempfile.TemporaryDirectory(prefix="specforged_e2e_") as temp_dir:
            workspace = ActualMcpServerWorkspace(Path(temp_dir))
            await workspace.setup()

            try:
                # Attempt to start server with invalid configuration
                # (This simulates various startup failure conditions)

                # Override server startup to force failure
                original_timeout = workspace.server_startup_timeout
                workspace.server_startup_timeout = 1  # Very short timeout

                # Should handle startup failure gracefully
                with pytest.raises(RuntimeError, match="MCP server failed to start"):
                    await workspace.start_actual_mcp_server()

                # Restore timeout
                workspace.server_startup_timeout = original_timeout

                # Verify workspace can still function (queue operations locally)
                operation = create_test_operation(
                    OperationType.CREATE_SPEC,
                    {
                        "name": "Offline Test Spec",
                        "description": "Testing offline functionality",
                        "specId": "offline-test",
                    },
                    priority=7,
                )

                # Should be able to queue operation even if server failed to start
                await workspace.queue_operation(operation)

                queue = await workspace.get_operation_queue()
                assert (
                    len(queue.operations) == 1
                ), "Should be able to queue operations when server is offline"

            finally:
                await workspace.cleanup()

    @pytest.mark.asyncio
    async def test_invalid_operations_with_actual_server(self):
        """Test invalid operations with actual MCP server."""
        with tempfile.TemporaryDirectory(prefix="specforged_e2e_") as temp_dir:
            workspace = ActualMcpServerWorkspace(Path(temp_dir))
            await workspace.setup()

            try:
                # Start server
                await workspace.start_actual_mcp_server()
                await asyncio.sleep(2)

                # Test invalid operation parameters
                invalid_ops = [
                    # Missing required parameters
                    create_test_operation(
                        OperationType.CREATE_SPEC,
                        {"name": ""},  # Empty name
                        priority=5,
                    ),
                    # Non-existent specification
                    create_test_operation(
                        OperationType.UPDATE_REQUIREMENTS,
                        {"specId": "does-not-exist", "content": "Some content"},
                        priority=6,
                    ),
                    # Invalid user story
                    create_test_operation(
                        OperationType.ADD_USER_STORY,
                        {
                            "specId": "also-does-not-exist",
                            "userStory": {"as_a": "", "i_want": "", "so_that": ""},
                        },
                        priority=7,
                    ),
                ]

                # Queue all invalid operations
                for invalid_op in invalid_ops:
                    await workspace.queue_operation(invalid_op)

                # Wait for processing
                await asyncio.sleep(5)

                # Check results
                for invalid_op in invalid_ops:
                    result = await workspace.wait_for_operation_completion(
                        invalid_op.id, 10
                    )

                    # Invalid operations should either fail or timeout
                    if result:
                        assert (
                            not result.success
                        ), f"Invalid operation {invalid_op.id} should fail"
                        assert (
                            result.message
                        ), "Failed operation should have error message"

                # Verify server remains stable after invalid operations
                valid_op = create_test_operation(
                    OperationType.CREATE_SPEC,
                    {
                        "name": "Recovery Test Spec",
                        "description": "Testing recovery after invalid operations",
                        "specId": "recovery-test",
                    },
                    priority=8,
                )

                await workspace.queue_operation(valid_op)
                recovery_result = await workspace.wait_for_operation_completion(
                    valid_op.id, 20
                )

                assert (
                    recovery_result is not None
                ), "Server should recover after invalid operations"
                assert (
                    recovery_result.success
                ), "Valid operations should work after handling invalid ones"

            finally:
                await workspace.cleanup()
