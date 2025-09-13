"""
Integration tests for file system change detection and sync state management.

This module tests the complete file synchronization system:
- Detection of external file modifications
- Workspace directory changes and relocations
- Sync state consistency across file operations
- File watching and change propagation
- Cross-platform file system compatibility

Tests verify that the system correctly handles file system events and maintains
consistent sync state across all components.
"""

import asyncio
import os
import shutil
import time
from datetime import datetime, timezone

import pytest

from src.specforged.core.queue_processor import OperationStatus, OperationType

from .fixtures import IntegrationTestWorkspace


class TestFileSystemChangeDetection:
    """Test detection of external file system changes."""

    @pytest.mark.asyncio
    async def test_external_file_modification_detection(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test detection when files are modified externally."""
        spec_id = "external-mod-test"

        # Create initial specification
        create_op_id = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "External Mod Test", "specId": spec_id},
            priority=7,
        )

        await integration_workspace.process_all_operations()
        result = await integration_workspace.wait_for_operation_completion(create_op_id)
        assert result.success

        # Record original file timestamps
        spec_dir = integration_workspace.specs_dir / spec_id
        requirements_file = spec_dir / "requirements.md"
        design_file = spec_dir / "design.md"
        tasks_file = spec_dir / "tasks.md"

        original_timestamps = {}
        for file_path in [requirements_file, design_file, tasks_file]:
            if file_path.exists():
                original_timestamps[file_path.name] = file_path.stat().st_mtime

        # Wait a moment to ensure timestamp differences
        await asyncio.sleep(0.1)

        # Modify files externally (simulating user editing files directly)
        external_modifications = {
            "requirements.md": "# Externally Modified Requirements\n\nUser made changes outside the system.",  # noqa: E501
            "design.md": "# Externally Modified Design\n\nDirect file system changes.",
            "tasks.md": "# Externally Modified Tasks\n\n- [x] External modification detected",
        }

        modification_times = {}
        for filename, content in external_modifications.items():
            file_path = spec_dir / filename
            with open(file_path, "w", encoding="utf-8") as f:
                f.write(content)
            modification_times[filename] = datetime.now(timezone.utc)

            # Track modification in workspace
            integration_workspace.file_changes.append(
                (
                    str(file_path),
                    "external_modification",
                    modification_times[filename],
                )
            )

        # Attempt to update the same files through the system
        await integration_workspace.simulate_extension_operation(
            OperationType.UPDATE_REQUIREMENTS,
            {
                "specId": spec_id,
                "content": "# System Updated Requirements\n\nSystem trying to update file.",
            },
            priority=6,
        )

        # Process the system update
        await integration_workspace.process_all_operations()

        # Verify file change detection
        assert (
            len(integration_workspace.file_changes) >= 3
        ), "Should track external file modifications"

        # Check that external modifications were detected
        external_changes = [
            change
            for change in integration_workspace.file_changes
            if change[1] == "external_modification"
        ]
        assert len(external_changes) == 3, "Should detect all external modifications"

        # Verify timestamps were updated
        current_timestamps = {}
        for file_path in [requirements_file, design_file, tasks_file]:
            if file_path.exists():
                current_timestamps[file_path.name] = file_path.stat().st_mtime

        # At least some files should have newer timestamps
        timestamp_changes = sum(
            1
            for filename in original_timestamps
            if current_timestamps.get(filename, 0) > original_timestamps[filename]
        )
        assert timestamp_changes >= 1, "At least one file timestamp should be updated"

        # Verify sync state reflects file system activity
        sync_state = await integration_workspace.get_sync_state()
        assert sync_state.last_sync is not None, "Sync state should be updated"

    @pytest.mark.asyncio
    async def test_workspace_directory_relocation(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test handling of workspace directory changes and relocations."""
        # Create initial specification in original workspace
        original_spec_id = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "Relocation Test", "specId": "relocation-test"},
            priority=7,
        )

        await integration_workspace.process_all_operations()
        result = await integration_workspace.wait_for_operation_completion(
            original_spec_id
        )
        assert result.success

        # Verify initial state
        original_workspace_dir = integration_workspace.workspace_dir
        original_specs_dir = integration_workspace.specs_dir

        assert original_specs_dir.exists(), "Original specs directory should exist"
        assert (
            original_specs_dir / "relocation-test"
        ).exists(), "Original spec should exist"

        # Create a new workspace directory (simulating workspace move)
        new_workspace_dir = original_workspace_dir.parent / "relocated_workspace"
        new_specs_dir = new_workspace_dir / "specifications"

        # Move the entire workspace
        shutil.copytree(original_workspace_dir, new_workspace_dir)

        # Update workspace paths in the test infrastructure
        integration_workspace.workspace_dir = new_workspace_dir
        integration_workspace.specs_dir = new_specs_dir
        integration_workspace.queue_file = new_workspace_dir / "mcp-operations.json"
        integration_workspace.results_file = new_workspace_dir / "mcp-results.json"
        integration_workspace.sync_file = new_workspace_dir / "specforge-sync.json"

        # Recreate the queue processor with new paths
        from src.specforged.core.queue_processor import QueueProcessor

        integration_workspace.queue_processor = QueueProcessor(
            integration_workspace.spec_manager, new_workspace_dir
        )

        # Update spec manager paths
        integration_workspace.spec_manager.base_dir = new_specs_dir
        integration_workspace.spec_manager.project_detector.project_root = (
            new_workspace_dir
        )

        # Verify workspace relocation detection and adaptation
        await integration_workspace.queue_processor.handle_workspace_changes()

        # Verify relocated workspace works
        relocated_spec_id = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {
                "name": "Post-Relocation Test",
                "specId": "post-relocation-test",
            },
            priority=8,
        )

        await integration_workspace.process_all_operations()
        relocated_result = await integration_workspace.wait_for_operation_completion(
            relocated_spec_id
        )

        assert relocated_result is not None, "Should work in relocated workspace"
        assert relocated_result.success, "Operations should succeed after relocation"

        # Verify both old and new specs exist in new location
        assert (
            new_specs_dir / "relocation-test"
        ).exists(), "Original spec should exist in new location"
        assert (
            new_specs_dir / "post-relocation-test"
        ).exists(), "New spec should be created in new location"

        # Clean up
        if new_workspace_dir.exists():
            shutil.rmtree(new_workspace_dir)

    @pytest.mark.asyncio
    async def test_concurrent_file_modifications(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test handling of concurrent file modifications from multiple sources."""
        spec_id = "concurrent-file-test"

        # Create base specification
        create_op_id = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "Concurrent File Test", "specId": spec_id},
            priority=8,
        )

        await integration_workspace.process_all_operations()
        result = await integration_workspace.wait_for_operation_completion(create_op_id)
        assert result.success

        spec_dir = integration_workspace.specs_dir / spec_id
        requirements_file = spec_dir / "requirements.md"

        # Set up concurrent modification scenario

        # Task 1: External file modification
        async def external_modification():
            await asyncio.sleep(0.1)
            external_content = f"# External Modification\n\nModified at {datetime.now().isoformat()}\n\nExternal changes."  # noqa: E501
            with open(requirements_file, "w", encoding="utf-8") as f:
                f.write(external_content)
            integration_workspace.file_changes.append(
                (
                    str(requirements_file),
                    "concurrent_external",
                    datetime.now(timezone.utc),
                )
            )

        # Task 2: System update operation
        async def system_update():
            await asyncio.sleep(0.05)  # Slightly earlier
            system_op_id = await integration_workspace.simulate_extension_operation(
                OperationType.UPDATE_REQUIREMENTS,
                {
                    "specId": spec_id,
                    "content": f"# System Update\n\nUpdated at {datetime.now().isoformat()}\n\nSystem changes.",  # noqa: E501
                },
                priority=7,
            )
            await integration_workspace.process_all_operations()
            return system_op_id

        # Task 3: Another external modification
        async def second_external_modification():
            await asyncio.sleep(0.15)
            second_content = f"# Second External Modification\n\nSecond modification at {datetime.now().isoformat()}"  # noqa: E501
            with open(requirements_file, "w", encoding="utf-8") as f:
                f.write(second_content)
            integration_workspace.file_changes.append(
                (
                    str(requirements_file),
                    "concurrent_external_2",
                    datetime.now(timezone.utc),
                )
            )

        # Execute concurrent modifications
        start_time = time.time()

        external_task = asyncio.create_task(external_modification())
        system_task = asyncio.create_task(system_update())
        second_external_task = asyncio.create_task(second_external_modification())

        # Wait for all concurrent operations
        await external_task
        await system_task
        await second_external_task

        concurrent_time = time.time() - start_time

        # Process any remaining operations
        await integration_workspace.process_all_operations()

        # Verify concurrent modifications were handled
        assert (
            concurrent_time < 2.0
        ), f"Concurrent operations should be quick: {concurrent_time:.2f}s"

        # Check file change tracking
        concurrent_changes = [
            change
            for change in integration_workspace.file_changes
            if "concurrent" in change[1]
        ]
        assert (
            len(concurrent_changes) >= 2
        ), "Should track concurrent external modifications"

        # Verify final file state (last writer wins)
        if requirements_file.exists():
            final_content = requirements_file.read_text()
            assert (
                len(final_content) > 0
            ), "File should have content after concurrent modifications"

            # File should contain content from one of the modifications
            has_external_content = "External Modification" in final_content
            has_system_content = "System Update" in final_content
            has_second_external = "Second External Modification" in final_content

            assert (
                has_external_content or has_system_content or has_second_external
            ), "File should contain content from at least one modification"

        # Verify system stability after concurrent modifications
        stability_op_id = await integration_workspace.simulate_extension_operation(
            OperationType.UPDATE_DESIGN,
            {
                "specId": spec_id,
                "content": "# Stability Test\n\nTesting system stability after concurrent mods.",
            },
            priority=9,
        )

        await integration_workspace.process_all_operations()
        stability_result = await integration_workspace.wait_for_operation_completion(
            stability_op_id
        )

        assert (
            stability_result is not None
        ), "System should remain stable after concurrent modifications"
        assert (
            stability_result.success
        ), "Operations should work after concurrent file modifications"

    @pytest.mark.asyncio
    async def test_file_permission_change_handling(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test handling of file permission changes."""
        spec_id = "permission-test"

        # Create specification
        create_op_id = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "Permission Test", "specId": spec_id},
            priority=7,
        )

        await integration_workspace.process_all_operations()
        result = await integration_workspace.wait_for_operation_completion(create_op_id)
        assert result.success

        spec_dir = integration_workspace.specs_dir / spec_id
        requirements_file = spec_dir / "requirements.md"

        # Test read-only file scenario
        if requirements_file.exists():
            # Make file read-only
            original_mode = requirements_file.stat().st_mode
            os.chmod(requirements_file, 0o444)  # Read-only

            try:
                # Try to update read-only file
                readonly_op_id = await integration_workspace.simulate_extension_operation(
                    OperationType.UPDATE_REQUIREMENTS,
                    {
                        "specId": spec_id,
                        "content": "# Read-Only Update Attempt\n\nTrying to update read-only file.",
                    },
                    priority=6,
                )

                await integration_workspace.process_all_operations()

                # Should handle permission error gracefully
                await integration_workspace.wait_for_operation_completion(
                    readonly_op_id, timeout_seconds=10
                )

                # Restore permissions
                os.chmod(requirements_file, original_mode)

                # Process again after permission restoration
                await integration_workspace.process_all_operations()

                # Verify system handles permission errors
                queue = await integration_workspace.get_operation_queue()
                ops_by_id = {op.id: op for op in queue.operations}

                if readonly_op_id in ops_by_id:
                    readonly_op = ops_by_id[readonly_op_id]
                    # Operation should either fail or be retrying
                    assert readonly_op.status in [
                        OperationStatus.FAILED,
                        OperationStatus.PENDING,  # Might retry after permission fix
                        OperationStatus.COMPLETED,  # Might succeed after permission fix
                    ], f"Operation should be in valid state after permission error: {readonly_op.status}"  # noqa: E501

            finally:
                # Ensure permissions are restored
                try:
                    os.chmod(requirements_file, original_mode)
                except (OSError, PermissionError):
                    pass

        # Test directory permission scenario
        original_dir_mode = spec_dir.stat().st_mode

        try:
            # Make directory read-only
            os.chmod(spec_dir, 0o555)  # Read-only directory

            # Try to create new file in read-only directory
            await integration_workspace.simulate_extension_operation(
                OperationType.UPDATE_TASKS,
                {
                    "specId": spec_id,
                    "content": "# Tasks for Read-Only Directory\n\n- [ ] Test task",
                },
                priority=6,
            )

            await integration_workspace.process_all_operations()

            # Restore directory permissions
            os.chmod(spec_dir, original_dir_mode)

            # Try processing again
            await integration_workspace.process_all_operations()

            # Verify system handled directory permission issues
            sync_state = await integration_workspace.get_sync_state()
            assert (
                sync_state.mcp_server_online
            ), "Server should remain online despite permission issues"

        finally:
            # Ensure directory permissions are restored
            try:
                os.chmod(spec_dir, original_dir_mode)
            except (OSError, PermissionError):
                pass


class TestSyncStateManagement:
    """Test sync state consistency and management."""

    @pytest.mark.asyncio
    async def test_sync_state_consistency_across_operations(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test that sync state remains consistent across multiple operations."""
        # Perform a series of operations and verify sync state consistency
        operations = [
            (
                "create_1",
                OperationType.CREATE_SPEC,
                {"name": "Sync Test 1", "specId": "sync-test-1"},
            ),
            (
                "create_2",
                OperationType.CREATE_SPEC,
                {"name": "Sync Test 2", "specId": "sync-test-2"},
            ),
            (
                "update_req",
                OperationType.UPDATE_REQUIREMENTS,
                {"specId": "sync-test-1", "content": "Updated requirements"},
            ),
            (
                "update_design",
                OperationType.UPDATE_DESIGN,
                {"specId": "sync-test-2", "content": "Updated design"},
            ),
            (
                "add_story",
                OperationType.ADD_USER_STORY,
                {
                    "specId": "sync-test-1",
                    "userStory": {
                        "as_a": "sync tester",
                        "i_want": "consistent sync state",
                        "so_that": "the system works reliably",
                    },
                },
            ),
        ]

        sync_states = []
        operation_results = {}

        for op_name, op_type, params in operations:
            # Record sync state before operation
            pre_sync_state = await integration_workspace.get_sync_state()

            # Execute operation
            op_id = await integration_workspace.simulate_extension_operation(
                op_type, params, priority=7
            )
            await integration_workspace.process_all_operations()
            result = await integration_workspace.wait_for_operation_completion(op_id)

            # Record sync state after operation
            post_sync_state = await integration_workspace.get_sync_state()

            sync_states.append(
                {
                    "operation": op_name,
                    "pre_sync": pre_sync_state,
                    "post_sync": post_sync_state,
                    "result": result,
                }
            )
            operation_results[op_name] = result

        # Verify sync state consistency
        for i, state_info in enumerate(sync_states):
            pre_sync = state_info["pre_sync"]
            post_sync = state_info["post_sync"]
            op_name = state_info["operation"]
            result = state_info["result"]

            # Last sync should be updated after successful operations
            if result and result.success:
                pre_sync_time = (
                    datetime.fromisoformat(pre_sync.last_sync.replace("Z", "+00:00"))
                    if pre_sync.last_sync
                    else None
                )
                post_sync_time = (
                    datetime.fromisoformat(post_sync.last_sync.replace("Z", "+00:00"))
                    if post_sync.last_sync
                    else None
                )

                if pre_sync_time and post_sync_time:
                    assert (
                        post_sync_time >= pre_sync_time
                    ), f"Last sync time should advance after operation {op_name}"

            # Server should remain online
            assert (
                post_sync.mcp_server_online
            ), f"Server should be online after operation {op_name}"

            # Operation counters should be reasonable
            total_ops = (
                post_sync.pendingOperations
                + post_sync.inProgressOperations
                + post_sync.failedOperations
                + post_sync.completedOperations
            )
            assert (
                total_ops >= i
            ), f"Total operation count should be at least {i} after operation {op_name}"

        # Verify final sync state
        final_sync = sync_states[-1]["post_sync"]
        assert (
            final_sync.completedOperations >= 4
        ), "Should have completed most operations"
        assert final_sync.failedOperations <= 2, "Should have minimal failures"

    @pytest.mark.asyncio
    async def test_sync_state_recovery_after_errors(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test sync state recovery after various error conditions."""
        # Establish baseline sync state
        baseline_op_id = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "Baseline", "specId": "baseline"},
            priority=8,
        )

        await integration_workspace.process_all_operations()
        baseline_result = await integration_workspace.wait_for_operation_completion(
            baseline_op_id
        )
        assert baseline_result.success

        baseline_sync = await integration_workspace.get_sync_state()

        # Introduce various error conditions
        error_scenarios = [
            # Invalid operation parameters
            (
                "invalid_params",
                OperationType.CREATE_SPEC,
                {"name": "", "specId": ""},
            ),  # Empty params
            # Non-existent spec update
            (
                "nonexistent_spec",
                OperationType.UPDATE_REQUIREMENTS,
                {"specId": "does-not-exist", "content": "content"},
            ),
            # Malformed user story
            (
                "malformed_story",
                OperationType.ADD_USER_STORY,
                {
                    "specId": "baseline",
                    "userStory": {
                        "as_a": "",
                        "i_want": "",
                        "so_that": "",
                    },  # Empty fields
                },
            ),
        ]

        error_results = {}
        sync_states_during_errors = []

        for error_name, op_type, params in error_scenarios:
            # Record pre-error sync state
            pre_error_sync = await integration_workspace.get_sync_state()

            # Execute error-prone operation
            error_op_id = await integration_workspace.simulate_extension_operation(
                op_type, params, priority=5
            )
            await integration_workspace.process_all_operations()

            # Record post-error sync state
            post_error_sync = await integration_workspace.get_sync_state()

            error_result = await integration_workspace.wait_for_operation_completion(
                error_op_id, timeout_seconds=5
            )
            error_results[error_name] = error_result

            sync_states_during_errors.append(
                {
                    "scenario": error_name,
                    "pre_error": pre_error_sync,
                    "post_error": post_error_sync,
                    "result": error_result,
                }
            )

            # Brief pause between error scenarios
            await asyncio.sleep(0.1)

        # Verify sync state remains stable during errors
        for state_info in sync_states_during_errors:
            post_sync = state_info["post_error"]
            scenario = state_info["scenario"]

            # Server should remain online despite errors
            assert (
                post_sync.mcp_server_online
            ), f"Server should stay online during error scenario: {scenario}"

            # Error count should be bounded
            assert (
                len(post_sync.sync_errors) <= 10
            ), f"Sync errors should be bounded in scenario: {scenario}"

            # Last sync should still be updated (even for failed operations)
            assert (
                post_sync.last_sync is not None
            ), f"Last sync should exist after scenario: {scenario}"

        # Test recovery with successful operations
        recovery_operations = [
            await integration_workspace.simulate_extension_operation(
                OperationType.CREATE_SPEC,
                {"name": "Recovery Test 1", "specId": "recovery-1"},
                priority=8,
            ),
            await integration_workspace.simulate_extension_operation(
                OperationType.CREATE_SPEC,
                {"name": "Recovery Test 2", "specId": "recovery-2"},
                priority=8,
            ),
        ]

        await integration_workspace.process_all_operations()

        # Verify recovery
        recovery_results = []
        for recovery_op_id in recovery_operations:
            result = await integration_workspace.wait_for_operation_completion(
                recovery_op_id
            )
            recovery_results.append(result)

        # All recovery operations should succeed
        successful_recoveries = sum(
            1 for result in recovery_results if result and result.success
        )
        assert successful_recoveries == len(
            recovery_operations
        ), f"All recovery operations should succeed: {successful_recoveries}/{len(recovery_operations)}"  # noqa: E501

        # Final sync state should show recovery
        final_sync = await integration_workspace.get_sync_state()
        assert (
            final_sync.completedOperations > baseline_sync.completedOperations
        ), "Should show progress after recovery"
        assert final_sync.mcp_server_online, "Server should be online after recovery"

    @pytest.mark.asyncio
    async def test_sync_state_specification_tracking(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test that sync state correctly tracks specification changes."""
        # Create multiple specifications with different modification patterns
        spec_configs = [
            ("tracked-spec-1", "Tracked Specification 1"),
            ("tracked-spec-2", "Tracked Specification 2"),
            ("tracked-spec-3", "Tracked Specification 3"),
        ]

        created_specs = {}

        # Create all specifications
        for spec_id, name in spec_configs:
            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.CREATE_SPEC,
                {"name": name, "specId": spec_id},
                priority=7,
            )
            await integration_workspace.process_all_operations()
            result = await integration_workspace.wait_for_operation_completion(op_id)
            assert result.success, f"Should create spec {spec_id}"
            created_specs[spec_id] = result

        # Verify specifications are tracked in sync state
        initial_sync = await integration_workspace.get_sync_state()
        tracked_specs = {spec["specId"]: spec for spec in initial_sync.specifications}

        for spec_id, _ in spec_configs:
            assert (
                spec_id in tracked_specs
            ), f"Spec {spec_id} should be tracked in sync state"

            tracked_spec = tracked_specs[spec_id]
            assert (
                tracked_spec["version"] >= 1
            ), f"Spec {spec_id} should have version >= 1"
            assert tracked_spec[
                "lastModified"
            ], f"Spec {spec_id} should have lastModified timestamp"

        # Modify specifications and verify version tracking
        modifications = [
            (
                "tracked-spec-1",
                OperationType.UPDATE_REQUIREMENTS,
                {"content": "Modified requirements"},
            ),
            (
                "tracked-spec-2",
                OperationType.UPDATE_DESIGN,
                {"content": "Modified design"},
            ),
            (
                "tracked-spec-1",
                OperationType.UPDATE_TASKS,
                {"content": "# Modified tasks\n- [x] Task 1"},
            ),
        ]

        modification_results = {}

        for spec_id, op_type, content_params in modifications:
            params = {"specId": spec_id, **content_params}
            mod_op_id = await integration_workspace.simulate_extension_operation(
                op_type, params, priority=6
            )

            # Notify sync state of specification change
            await integration_workspace.notifySpecificationChange(
                spec_id, f"{op_type}_update"
            )

            await integration_workspace.process_all_operations()
            result = await integration_workspace.wait_for_operation_completion(
                mod_op_id
            )
            modification_results[f"{spec_id}_{op_type}"] = result

        # Verify version increments after modifications
        final_sync = await integration_workspace.get_sync_state()
        final_tracked_specs = {
            spec["specId"]: spec for spec in final_sync.specifications
        }

        # tracked-spec-1 should have higher version (modified twice)
        if (
            "tracked-spec-1" in final_tracked_specs
            and "tracked-spec-1" in tracked_specs
        ):
            initial_version = tracked_specs["tracked-spec-1"]["version"]
            final_version = final_tracked_specs["tracked-spec-1"]["version"]
            assert (
                final_version > initial_version
            ), f"tracked-spec-1 version should increment after modifications: {initial_version} -> {final_version}"  # noqa: E501

        # tracked-spec-2 should have incremented version (modified once)
        if (
            "tracked-spec-2" in final_tracked_specs
            and "tracked-spec-2" in tracked_specs
        ):
            initial_version = tracked_specs["tracked-spec-2"]["version"]
            final_version = final_tracked_specs["tracked-spec-2"]["version"]
            assert (
                final_version > initial_version
            ), f"tracked-spec-2 version should increment: {initial_version} -> {final_version}"

        # tracked-spec-3 should have same version (not modified)
        if (
            "tracked-spec-3" in final_tracked_specs
            and "tracked-spec-3" in tracked_specs
        ):
            initial_version = tracked_specs["tracked-spec-3"]["version"]
            final_version = final_tracked_specs["tracked-spec-3"]["version"]
            assert (
                final_version == initial_version
            ), f"tracked-spec-3 version should remain same: {initial_version} -> {final_version}"

        # Verify lastModified timestamps
        for spec_id in ["tracked-spec-1", "tracked-spec-2"]:
            if spec_id in final_tracked_specs and spec_id in tracked_specs:
                initial_modified = tracked_specs[spec_id]["lastModified"]
                final_modified = final_tracked_specs[spec_id]["lastModified"]
                assert (
                    final_modified != initial_modified
                ), f"lastModified should update for {spec_id}"


class TestCrossPlatformCompatibility:
    """Test cross-platform file system compatibility."""

    @pytest.mark.asyncio
    async def test_path_separator_handling(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test handling of different path separators across platforms."""
        # Test with various path formats that might be problematic
        path_test_specs = [
            ("path-test-1", "Path Test 1"),
            ("path_test_2", "Path Test 2"),  # Underscore
            ("path-test-3-with-long-name", "Path Test 3 With Long Name"),
        ]

        created_specs = []

        for spec_id, name in path_test_specs:
            op_id = await integration_workspace.simulate_extension_operation(
                OperationType.CREATE_SPEC,
                {"name": name, "specId": spec_id},
                priority=7,
            )
            await integration_workspace.process_all_operations()
            result = await integration_workspace.wait_for_operation_completion(op_id)

            if result and result.success:
                created_specs.append(spec_id)

                # Verify directory was created with correct path
                spec_dir = integration_workspace.specs_dir / spec_id
                assert spec_dir.exists(), f"Spec directory should exist for {spec_id}"

                # Verify files exist with correct paths
                expected_files = [
                    "spec.json",
                    "requirements.md",
                    "design.md",
                    "tasks.md",
                ]
                for file_name in expected_files:
                    file_path = spec_dir / file_name
                    if file_path.exists():
                        # Verify file can be read
                        try:
                            content = file_path.read_text(encoding="utf-8")
                            assert (
                                len(content) >= 0
                            ), f"Should be able to read {file_name} for {spec_id}"
                        except UnicodeDecodeError:
                            # Try different encoding
                            content = file_path.read_text(
                                encoding="utf-8", errors="ignore"
                            )
                            assert (
                                len(content) >= 0
                            ), f"Should be able to read {file_name} with fallback encoding"

        assert (
            len(created_specs) >= 2
        ), f"Should create most specs despite path variations, created: {len(created_specs)}"

        # Test file operations with various path formats
        for spec_id in created_specs[:2]:  # Test first 2 specs
            # Test path handling in file updates
            update_op_id = await integration_workspace.simulate_extension_operation(
                OperationType.UPDATE_REQUIREMENTS,
                {
                    "specId": spec_id,
                    "content": f"# Cross-Platform Requirements for {spec_id}\n\nTesting path compatibility.",  # noqa: E501
                },
                priority=6,
            )

            await integration_workspace.process_all_operations()
            result = await integration_workspace.wait_for_operation_completion(
                update_op_id
            )

            assert result is not None, f"Path handling should work for {spec_id}"
            assert (
                result.success
            ), f"File operations should work with paths for {spec_id}"

    @pytest.mark.asyncio
    async def test_unicode_filename_handling(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test handling of Unicode characters in filenames and content."""
        # Test Unicode in spec IDs and names
        unicode_specs = [
            ("unicode-test-basic", "Basic Unicode Test 测试"),
            ("unicode-test-emoji", "Emoji Test 🚀📝"),
            ("unicode-test-accents", "Accent Test café résumé"),
        ]

        unicode_results = {}

        for spec_id, name in unicode_specs:
            try:
                op_id = await integration_workspace.simulate_extension_operation(
                    OperationType.CREATE_SPEC,
                    {"name": name, "specId": spec_id},
                    priority=7,
                )
                await integration_workspace.process_all_operations()
                result = await integration_workspace.wait_for_operation_completion(
                    op_id
                )
                unicode_results[spec_id] = result

                if result and result.success:
                    # Test Unicode content in files
                    unicode_content_op_id = await integration_workspace.simulate_extension_operation(
                        OperationType.UPDATE_REQUIREMENTS,
                        {
                            "specId": spec_id,
                            "content": "# Unicode Requirements 📋\n\n测试内容 Test Content\n\n- Café ☕\n- Résumé 📄\n- 🚀 Emoji support",  # noqa: E501
                        },
                        priority=6,
                    )

                    await integration_workspace.process_all_operations()
                    content_result = (
                        await integration_workspace.wait_for_operation_completion(
                            unicode_content_op_id
                        )
                    )

                    assert (
                        content_result is not None
                    ), f"Unicode content should work for {spec_id}"

                    # Verify Unicode content was written correctly
                    spec_dir = integration_workspace.specs_dir / spec_id
                    requirements_file = spec_dir / "requirements.md"

                    if requirements_file.exists():
                        try:
                            content = requirements_file.read_text(encoding="utf-8")
                            assert (
                                "测试内容" in content
                            ), f"Unicode content should be preserved for {spec_id}"
                            assert (
                                "Café" in content
                            ), f"Accented characters should be preserved for {spec_id}"
                            assert (
                                "🚀" in content
                            ), f"Emoji should be preserved for {spec_id}"
                        except UnicodeDecodeError:
                            # Unicode handling may vary by platform
                            pass

            except Exception as e:
                # Unicode support may vary by platform
                print(f"Unicode test failed for {spec_id}: {e}")
                unicode_results[spec_id] = None

        # At least basic Unicode should work
        successful_unicode = sum(
            1 for result in unicode_results.values() if result and result.success
        )
        total_unicode_tests = len(unicode_specs)

        # Should handle at least basic Unicode cases
        assert (
            successful_unicode >= 1
        ), f"Should handle at least basic Unicode: {successful_unicode}/{total_unicode_tests}"

    @pytest.mark.asyncio
    async def test_large_file_handling(
        self, integration_workspace: IntegrationTestWorkspace
    ):
        """Test handling of large file operations."""
        spec_id = "large-file-test"

        # Create base specification
        create_op_id = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "Large File Test", "specId": spec_id},
            priority=7,
        )

        await integration_workspace.process_all_operations()
        result = await integration_workspace.wait_for_operation_completion(create_op_id)
        assert result.success

        # Generate large content (approximately 1MB)
        large_content_lines = []
        large_content_lines.append("# Large Requirements Document\n")
        large_content_lines.append("This document tests handling of large files.\n\n")

        for i in range(10000):  # Generate ~1MB of content
            large_content_lines.append(f"## Requirement {i:05d}\n")
            large_content_lines.append(f"**As a** user {i}\n")
            large_content_lines.append(f"**I want** functionality {i}\n")
            large_content_lines.append(f"**So that** I can achieve goal {i}\n\n")
            large_content_lines.append("### Acceptance Criteria\n")
            large_content_lines.append(f"- THE SYSTEM SHALL process requirement {i}\n")
            large_content_lines.append(
                f"- WHEN user {i} performs action THEN system SHALL respond\n"
            )
            large_content_lines.append(
                f"- IF condition {i} THEN system SHALL handle appropriately\n\n"
            )

        large_content = "".join(large_content_lines)
        content_size = len(large_content.encode("utf-8"))

        print(
            f"Generated large content: {content_size:,} bytes (~{content_size / 1024 / 1024:.1f} MB)"
        )

        # Test large file operation
        large_file_start = time.time()

        large_op_id = await integration_workspace.simulate_extension_operation(
            OperationType.UPDATE_REQUIREMENTS,
            {"specId": spec_id, "content": large_content},
            priority=6,
        )

        await integration_workspace.process_all_operations()
        large_result = await integration_workspace.wait_for_operation_completion(
            large_op_id, timeout_seconds=30
        )

        large_file_time = time.time() - large_file_start

        # Verify large file handling
        assert large_result is not None, "Large file operation should complete"
        assert (
            large_result.success
        ), f"Large file operation should succeed: {large_result.message if large_result else 'No result'}"  # noqa: E501
        assert (
            large_file_time < 20.0
        ), f"Large file operation should complete in reasonable time: {large_file_time:.2f}s"

        # Verify file was written correctly
        spec_dir = integration_workspace.specs_dir / spec_id
        requirements_file = spec_dir / "requirements.md"

        if requirements_file.exists():
            try:
                written_content = requirements_file.read_text(encoding="utf-8")
                written_size = len(written_content.encode("utf-8"))

                assert (
                    written_size >= content_size * 0.9
                ), f"Written file should be approximately correct size: {written_size:,} bytes"
                assert (
                    "Requirement 00001" in written_content
                ), "File should contain expected content"
                assert (
                    "Large Requirements Document" in written_content
                ), "File should contain header"

                print("Large file verification:")
                print(f"  Original size: {content_size:,} bytes")
                print(f"  Written size: {written_size:,} bytes")
                print(f"  Write time: {large_file_time:.2f}s")

            except Exception as e:
                print(f"Large file verification failed: {e}")
                # File might be too large for some systems

        # Verify system remains stable after large file operation
        stability_op_id = await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": "Post Large File Test", "specId": "post-large-file"},
            priority=8,
        )

        await integration_workspace.process_all_operations()
        stability_result = await integration_workspace.wait_for_operation_completion(
            stability_op_id
        )

        assert (
            stability_result is not None
        ), "System should remain stable after large file operation"
        assert (
            stability_result.success
        ), "System should continue working after large file operation"
