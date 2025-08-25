"""
Tests for enhanced Task model with checkbox support and hierarchical numbering.
"""

from src.specforged.models import Task


def test_task_checkbox_properties():
    """Test checkbox-related properties"""
    # Pending task
    pending_task = Task(
        id="T001", title="Test Task", description="A test task", status="pending"
    )

    assert not pending_task.is_completed
    assert pending_task.checkbox_symbol == "[ ]"

    # Completed task
    completed_task = Task(
        id="T002",
        title="Completed Task",
        description="A completed task",
        status="completed",
    )

    assert completed_task.is_completed
    assert completed_task.checkbox_symbol == "[x]"


def test_task_number_assignment():
    """Test task numbering"""
    task = Task(
        id="T001",
        title="Main Task",
        description="Main task description",
        task_number="1",
    )

    subtask1 = Task(
        id="T002",
        title="Subtask 1",
        description="First subtask",
        task_number="1.1",
        parent_id=task.id,
    )

    subtask2 = Task(
        id="T003",
        title="Subtask 2",
        description="Second subtask",
        task_number="1.2",
        parent_id=task.id,
    )

    task.subtasks = [subtask1, subtask2]

    assert task.task_number == "1"
    assert subtask1.task_number == "1.1"
    assert subtask2.task_number == "1.2"
    assert subtask1.parent_id == task.id
    assert subtask2.parent_id == task.id


def test_subtask_completion_logic():
    """Test that parent task status updates based on subtasks"""
    parent_task = Task(
        id="T001", title="Parent Task", description="Parent task", status="pending"
    )

    subtask1 = Task(
        id="T002", title="Subtask 1", description="First subtask", status="pending"
    )

    subtask2 = Task(
        id="T003", title="Subtask 2", description="Second subtask", status="pending"
    )

    parent_task.subtasks = [subtask1, subtask2]

    # No subtasks completed - should remain pending
    assert not parent_task.all_subtasks_completed
    parent_task.update_status_from_subtasks()
    assert parent_task.status == "pending"

    # One subtask completed - should be in progress
    subtask1.status = "completed"
    parent_task.update_status_from_subtasks()
    assert parent_task.status == "in_progress"

    # All subtasks completed - should be completed
    subtask2.status = "completed"
    assert parent_task.all_subtasks_completed
    parent_task.update_status_from_subtasks()
    assert parent_task.status == "completed"


def test_checkbox_markdown_format():
    """Test checkbox markdown generation"""
    task = Task(
        id="T001",
        title="Main Task",
        description="Main task description",
        task_number="1",
        status="completed",
        linked_requirements=["US-001-R01", "US-001-R02"],
    )

    subtask = Task(
        id="T002",
        title="Subtask",
        description="Subtask description",
        task_number="1.1",
        status="pending",
        linked_requirements=["US-001-R03"],
    )

    task.subtasks = [subtask]

    markdown = task.to_checkbox_markdown()

    # Check main task format
    assert "- [x] 1. Main Task" in markdown
    assert "_Requirements: US-001-R01, US-001-R02_" in markdown

    # Check subtask format (indented)
    assert "  - [ ] 1.1. Subtask" in markdown
    assert "    _Requirements: US-001-R03_" in markdown


def test_nested_task_hierarchy():
    """Test deeply nested task structure"""
    main_task = Task(
        id="T001",
        title="Main Task",
        description="Main task",
        task_number="1",
        status="pending",
    )

    subtask = Task(
        id="T002",
        title="Subtask",
        description="Level 2 task",
        task_number="1.1",
        status="pending",
    )

    sub_subtask = Task(
        id="T003",
        title="Sub-subtask",
        description="Level 3 task",
        task_number="1.1.1",
        status="completed",
    )

    subtask.subtasks = [sub_subtask]
    main_task.subtasks = [subtask]

    # Test flat task list
    flat_tasks = main_task.get_flat_task_list()
    assert len(flat_tasks) == 3
    assert main_task in flat_tasks
    assert subtask in flat_tasks
    assert sub_subtask in flat_tasks

    # Test markdown with 3 levels
    markdown = main_task.to_checkbox_markdown()
    lines = markdown.split("\n")

    # Check indentation levels
    main_line = next(line for line in lines if "Main Task" in line)
    sub_line = next(
        line for line in lines if "Subtask" in line and "Sub-subtask" not in line
    )
    subsub_line = next(line for line in lines if "Sub-subtask" in line)

    assert main_line.startswith("- [ ] 1. Main Task")
    assert sub_line.startswith("  - [ ] 1.1. Subtask")
    assert subsub_line.startswith("    - [x] 1.1.1. Sub-subtask")


def test_task_without_description_repetition():
    """Test that description isn't repeated if it matches title"""
    task = Task(
        id="T001",
        title="Setup Database",
        description="Setup Database",  # Same as title
        task_number="1",
    )

    markdown = task.to_checkbox_markdown()

    # Description should not be repeated
    lines = [line for line in markdown.split("\n") if line.strip()]
    assert len(lines) == 1
    assert "- [ ] 1. Setup Database" in lines[0]


def test_task_with_different_description():
    """Test task with different title and description"""
    task = Task(
        id="T001",
        title="Setup Database",
        description="Install and configure PostgreSQL database server",
        task_number="1",
    )

    markdown = task.to_checkbox_markdown()
    lines = [line for line in markdown.split("\n") if line.strip()]

    assert len(lines) == 2
    assert "- [ ] 1. Setup Database" in lines[0]
    assert "Install and configure PostgreSQL database server" in lines[1]


def test_empty_subtasks_list():
    """Test task with empty subtasks list"""
    task = Task(
        id="T001",
        title="Simple Task",
        description="A simple task without subtasks",
        task_number="1",
        subtasks=[],  # Explicitly empty
    )

    assert task.all_subtasks_completed  # Should be True for empty list
    flat_tasks = task.get_flat_task_list()
    assert len(flat_tasks) == 1
    assert flat_tasks[0] == task
