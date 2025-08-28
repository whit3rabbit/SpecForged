"""
Tests for checkbox formatting and task management functionality.
"""

import shutil
import tempfile
from pathlib import Path

import pytest

from src.specforged.core.spec_manager import SpecificationManager
from src.specforged.models import Task


@pytest.fixture
def temp_spec_dir():
    """Create a temporary directory for testing"""
    temp_dir = Path(tempfile.mkdtemp())
    yield temp_dir
    shutil.rmtree(temp_dir)


@pytest.fixture
def spec_manager(temp_spec_dir):
    """Create SpecificationManager with temp directory"""
    return SpecificationManager(temp_spec_dir)


@pytest.fixture
def sample_spec_with_tasks(spec_manager):
    """Create a spec with sample tasks for testing"""
    spec = spec_manager.create_specification("Test Project", "A test project")

    # Add user story
    story = spec_manager.add_user_story(
        spec.id, "developer", "to have a structured project", "development is efficient"
    )

    # Add EARS requirement
    spec_manager.add_ears_requirement(
        spec.id,
        story.id,
        "WHEN project is initialized",
        "create the required directory structure",
    )

    # Add design content to make implementation plan generation work
    spec.design = {
        "architecture": "Layered architecture with clear separation of concerns",
        "components": [
            {"name": "Core Module", "description": "Main business logic"},
            {"name": "API Layer", "description": "REST API endpoints"},
            {"name": "Data Layer", "description": "Data persistence and storage"},
        ],
        "data_models": "interface User { id: string; name: string; }",
        "sequence_diagrams": [],
    }

    # Save the spec with updated design
    spec_manager.save_specification(spec.id)

    # Generate implementation plan
    spec_manager.generate_implementation_plan(spec.id)

    return spec.id


def test_generate_implementation_plan(spec_manager, sample_spec_with_tasks):
    """Test generating implementation plan creates proper task structure"""
    spec = spec_manager.specs[sample_spec_with_tasks]

    assert len(spec.tasks) > 0

    # Check that tasks have proper numbering
    for i, task in enumerate(spec.tasks):
        assert task.task_number == str(i + 1)

    # Check that some tasks have subtasks
    tasks_with_subtasks = [task for task in spec.tasks if task.subtasks]
    assert len(tasks_with_subtasks) > 0


def test_checkbox_markdown_generation(
    spec_manager, sample_spec_with_tasks, temp_spec_dir
):
    """Test that tasks.md file is generated with checkbox format"""
    spec_dir = temp_spec_dir / sample_spec_with_tasks
    tasks_file = spec_dir / "tasks.md"

    assert tasks_file.exists()

    content = tasks_file.read_text()

    # Check for checkbox format
    assert "- [ ]" in content  # Unchecked boxes
    assert "# Implementation Plan" in content
    assert "## Progress Summary" in content
    assert "Total Tasks:" in content
    assert "Progress:" in content


def test_check_task_functionality(spec_manager, sample_spec_with_tasks):
    """Test checking off tasks"""
    spec = spec_manager.specs[sample_spec_with_tasks]

    # Find first main task
    first_task = spec.tasks[0]
    task_number = first_task.task_number

    # Initially should be pending
    assert first_task.status == "pending"

    # Check the task
    success = spec_manager.check_task(sample_spec_with_tasks, task_number)
    assert success is True
    assert first_task.status == "completed"

    # Verify file was updated
    spec_dir = spec_manager.base_dir / sample_spec_with_tasks
    tasks_file = spec_dir / "tasks.md"
    content = tasks_file.read_text()

    # Should now have checked boxes
    assert "- [x]" in content


def test_uncheck_task_functionality(spec_manager, sample_spec_with_tasks):
    """Test unchecking tasks"""
    spec = spec_manager.specs[sample_spec_with_tasks]
    first_task = spec.tasks[0]
    task_number = first_task.task_number

    # First check the task
    spec_manager.check_task(sample_spec_with_tasks, task_number)
    assert first_task.status == "completed"

    # Then uncheck it
    success = spec_manager.uncheck_task(sample_spec_with_tasks, task_number)
    assert success is True
    assert first_task.status == "pending"


def test_get_task_by_number(spec_manager, sample_spec_with_tasks):
    """Test finding tasks by their hierarchical number"""
    spec = spec_manager.specs[sample_spec_with_tasks]

    # Test getting main task
    task_1 = spec_manager.get_task_by_number(sample_spec_with_tasks, "1")
    assert task_1 is not None
    assert task_1.task_number == "1"

    # Test getting subtask if exists
    main_task_with_subtasks = next((task for task in spec.tasks if task.subtasks), None)
    if main_task_with_subtasks and main_task_with_subtasks.subtasks:
        subtask = main_task_with_subtasks.subtasks[0]
        found_subtask = spec_manager.get_task_by_number(
            sample_spec_with_tasks, subtask.task_number
        )
        assert found_subtask is not None
        assert found_subtask.id == subtask.id

    # Test non-existent task
    non_existent = spec_manager.get_task_by_number(sample_spec_with_tasks, "999")
    assert non_existent is None


def test_completion_stats(spec_manager, sample_spec_with_tasks):
    """Test completion statistics calculation"""
    stats = spec_manager.get_completion_stats(sample_spec_with_tasks)

    assert "total" in stats
    assert "completed" in stats
    assert "in_progress" in stats
    assert "pending" in stats
    assert "completion_percentage" in stats

    # Initially all should be pending
    assert stats["completed"] == 0
    assert stats["completion_percentage"] == 0.0
    assert stats["total"] > 0

    # Check a task and verify stats update
    spec = spec_manager.specs[sample_spec_with_tasks]
    if spec.tasks:
        first_task = spec.tasks[0]
        spec_manager.check_task(sample_spec_with_tasks, first_task.task_number)

        updated_stats = spec_manager.get_completion_stats(sample_spec_with_tasks)
        assert updated_stats["completed"] > 0
        assert updated_stats["completion_percentage"] > 0.0


def test_parent_task_auto_completion(spec_manager, sample_spec_with_tasks):
    """Test that parent tasks auto-complete when all subtasks are done"""
    spec = spec_manager.specs[sample_spec_with_tasks]

    # Find a task with subtasks
    parent_task = next((task for task in spec.tasks if task.subtasks), None)

    if parent_task and parent_task.subtasks:
        # Initially parent should be pending
        assert parent_task.status == "pending"

        # Complete all subtasks
        for subtask in parent_task.subtasks:
            spec_manager.check_task(sample_spec_with_tasks, subtask.task_number)

        # Parent should now be completed
        assert parent_task.status == "completed"


def test_update_implementation_plan_preserves_status(
    spec_manager, sample_spec_with_tasks
):
    """Test that updating plan preserves completion status"""
    spec = spec_manager.specs[sample_spec_with_tasks]

    # Complete some tasks
    completed_tasks = []
    for i, task in enumerate(spec.tasks[:2]):  # Complete first 2 tasks
        spec_manager.check_task(sample_spec_with_tasks, task.task_number)
        completed_tasks.append(task.title)

    # Update the plan
    success = spec_manager.update_implementation_plan(sample_spec_with_tasks)
    assert success is True

    # Check that completed tasks are still marked as completed
    updated_spec = spec_manager.specs[sample_spec_with_tasks]
    all_tasks = spec_manager._flatten_tasks(updated_spec.tasks)

    for task in all_tasks:
        if task.title in completed_tasks:
            assert task.status == "completed"


def test_tasks_file_progress_summary(
    spec_manager, sample_spec_with_tasks, temp_spec_dir
):
    """Test that tasks.md includes proper progress summary"""
    spec_dir = temp_spec_dir / sample_spec_with_tasks
    tasks_file = spec_dir / "tasks.md"

    # Check a task to change progress
    spec = spec_manager.specs[sample_spec_with_tasks]
    if spec.tasks:
        spec_manager.check_task(sample_spec_with_tasks, spec.tasks[0].task_number)

    # Re-read the file
    content = tasks_file.read_text()

    # Should have progress summary
    assert "Progress Summary" in content
    assert "Total Tasks:" in content
    assert "Completed:" in content
    assert "In Progress:" in content
    assert "Pending:" in content
    assert "Progress:" in content and "%" in content


def test_invalid_spec_operations(spec_manager):
    """Test operations on non-existent specifications"""
    fake_spec_id = "non-existent-spec"

    # Should return False/None for invalid spec
    assert spec_manager.generate_implementation_plan(fake_spec_id) is False
    assert spec_manager.update_implementation_plan(fake_spec_id) is False
    assert spec_manager.check_task(fake_spec_id, "1") is False
    assert spec_manager.uncheck_task(fake_spec_id, "1") is False
    assert spec_manager.get_task_by_number(fake_spec_id, "1") is None
    assert spec_manager.get_completion_stats(fake_spec_id) is None


def test_invalid_task_operations(spec_manager, sample_spec_with_tasks):
    """Test operations on non-existent tasks"""
    fake_task_number = "999.999"

    # Should return False for invalid task
    assert spec_manager.check_task(sample_spec_with_tasks, fake_task_number) is False
    assert spec_manager.uncheck_task(sample_spec_with_tasks, fake_task_number) is False
    assert (
        spec_manager.get_task_by_number(sample_spec_with_tasks, fake_task_number)
        is None
    )


def test_nested_subtask_hierarchy_in_markdown(
    spec_manager, sample_spec_with_tasks, temp_spec_dir
):
    """Test that nested subtasks appear with proper indentation in markdown"""
    spec = spec_manager.specs[sample_spec_with_tasks]

    # Find a task and manually add nested subtasks for testing
    if spec.tasks:
        main_task = spec.tasks[0]
        if main_task.subtasks:
            subtask = main_task.subtasks[0]

            # Add a sub-subtask
            sub_subtask = Task(
                id="T999",
                title="Sub-subtask",
                description="A third level task",
                task_number="1.1.1",
            )
            subtask.subtasks = [sub_subtask]

            # Regenerate the file
            spec_manager.save_specification(sample_spec_with_tasks)

            # Check indentation in file
            spec_dir = temp_spec_dir / sample_spec_with_tasks
            tasks_file = spec_dir / "tasks.md"
            content = tasks_file.read_text()

            lines = content.split("\n")

            # Find the lines with different indentation levels
            main_line = next(
                (
                    line
                    for line in lines
                    if main_task.task_number in line and main_task.title in line
                ),
                None,
            )
            sub_line = next(
                (
                    line
                    for line in lines
                    if subtask.task_number in line and subtask.title in line
                ),
                None,
            )
            subsub_line = next((line for line in lines if "Sub-subtask" in line), None)

            if main_line and sub_line and subsub_line:
                # Count leading spaces for indentation
                main_indent = len(main_line) - len(main_line.lstrip())
                sub_indent = len(sub_line) - len(sub_line.lstrip())
                subsub_indent = len(subsub_line) - len(subsub_line.lstrip())

                # Each level should be indented more than the previous
                assert sub_indent > main_indent
                assert subsub_indent > sub_indent
