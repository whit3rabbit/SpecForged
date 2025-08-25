"""
Tests for the PlanGenerator module.
"""

import pytest
from datetime import datetime
from src.specforged.core.plan_generator import PlanGenerator
from src.specforged.models import (
    Specification,
    UserStory,
    EARSRequirement,
    SpecStatus,
    WorkflowPhase,
)


@pytest.fixture
def plan_generator():
    """Create a PlanGenerator instance"""
    return PlanGenerator()


@pytest.fixture
def sample_spec():
    """Create a sample specification for testing"""
    # Create EARS requirements
    ears_req1 = EARSRequirement(
        id="US-001-R01",
        condition="WHEN a user enters valid credentials",
        system_response="authenticate and create a session",
    )

    ears_req2 = EARSRequirement(
        id="US-001-R02",
        condition="IF authentication fails",
        system_response="display an error message",
    )

    # Create user story
    user_story = UserStory(
        id="US-001",
        as_a="user",
        i_want="to login securely",
        so_that="I can access my account",
        requirements=[ears_req1, ears_req2],
    )

    # Create specification
    spec = Specification(
        id="login-system",
        name="Login System",
        created_at=datetime.now(),
        updated_at=datetime.now(),
        status=SpecStatus.DRAFT,
        current_phase=WorkflowPhase.REQUIREMENTS,
        user_stories=[user_story],
        design={
            "architecture": "MVC pattern with JWT authentication",
            "components": [
                {
                    "name": "AuthController",
                    "description": "Handles authentication requests",
                },
                {"name": "UserModel", "description": "User data model"},
            ],
            "data_models": "interface User { id: string; username: string; }",
        },
    )

    return spec


def test_plan_generator_initialization(plan_generator):
    """Test PlanGenerator initializes correctly"""
    assert plan_generator.task_counter == 0
    assert isinstance(plan_generator.subtask_counters, dict)


def test_generate_implementation_plan(plan_generator, sample_spec):
    """Test generating a complete implementation plan"""
    tasks = plan_generator.generate_implementation_plan(sample_spec)

    # Should have tasks from requirements, design, and common tasks
    assert len(tasks) > 0

    # Check that tasks have proper numbering
    main_task_numbers = [
        task.task_number for task in tasks if "." not in task.task_number
    ]
    assert len(set(main_task_numbers)) == len(main_task_numbers)  # All unique

    # Check that tasks have linked requirements
    requirement_tasks = [task for task in tasks if task.linked_requirements]
    assert len(requirement_tasks) > 0

    # Check that some tasks have subtasks
    tasks_with_subtasks = [task for task in tasks if task.subtasks]
    assert len(tasks_with_subtasks) > 0


def test_task_numbering_hierarchy(plan_generator, sample_spec):
    """Test hierarchical task numbering"""
    tasks = plan_generator.generate_implementation_plan(sample_spec)

    # Check main task numbers (should be 1, 2, 3, etc.)
    main_tasks = [task for task in tasks if "." not in task.task_number]
    main_numbers = [int(task.task_number) for task in main_tasks]
    assert main_numbers == list(range(1, len(main_tasks) + 1))

    # Check subtask numbering
    for main_task in main_tasks:
        if main_task.subtasks:
            subtask_numbers = [subtask.task_number for subtask in main_task.subtasks]
            expected_prefix = f"{main_task.task_number}."

            for subtask_number in subtask_numbers:
                assert subtask_number.startswith(expected_prefix)
                # Check that subtask number format is correct (e.g., "1.1", "1.2")
                parts = subtask_number.split(".")
                assert len(parts) == 2
                assert parts[0] == main_task.task_number
                assert parts[1].isdigit()


def test_generate_from_requirements(plan_generator, sample_spec):
    """Test generating tasks from user stories and requirements"""
    tasks = plan_generator._generate_from_requirements(sample_spec.user_stories)

    assert len(tasks) > 0

    # Should have a main task for the user story
    main_task = tasks[0]
    assert "user" in main_task.title.lower()
    assert main_task.linked_requirements == ["US-001"]

    # Should have subtasks for EARS requirements
    assert len(main_task.subtasks) == 2

    subtask_reqs = []
    for subtask in main_task.subtasks:
        subtask_reqs.extend(subtask.linked_requirements)

    assert "US-001-R01" in subtask_reqs
    assert "US-001-R02" in subtask_reqs


def test_generate_from_design(plan_generator, sample_spec):
    """Test generating tasks from design components"""
    tasks = plan_generator._generate_from_design(
        sample_spec.design, sample_spec.user_stories
    )

    assert len(tasks) > 0

    # Should have tasks for architecture, components, and data models
    task_titles = [task.title.lower() for task in tasks]

    # Check for architecture task
    arch_tasks = [title for title in task_titles if "architecture" in title]
    assert len(arch_tasks) > 0

    # Check for component tasks
    component_tasks = [
        title
        for title in task_titles
        if "authcontroller" in title or "usermodel" in title
    ]
    assert len(component_tasks) > 0

    # Check for data model task
    data_tasks = [
        title for title in task_titles if "data" in title and "model" in title
    ]
    assert len(data_tasks) > 0


def test_generate_common_tasks(plan_generator):
    """Test generating common development tasks"""
    tasks = plan_generator._generate_common_tasks()

    assert len(tasks) > 0

    task_titles = [task.title.lower() for task in tasks]

    # Should include common development tasks
    assert any("structure" in title for title in task_titles)
    assert any("test" in title for title in task_titles)
    assert any("documentation" in title for title in task_titles)


def test_task_title_generation_from_ears(plan_generator):
    """Test generating task titles from EARS requirements"""
    req1 = EARSRequirement(
        id="R01",
        condition="WHEN user submits form",
        system_response="validate the input data",
    )

    req2 = EARSRequirement(
        id="R02",
        condition="IF authentication fails",
        system_response="display error message",
    )

    title1 = plan_generator._generate_task_title_from_ears(req1)
    title2 = plan_generator._generate_task_title_from_ears(req2)

    assert "validation" in title1.lower() or "validate" in title1.lower()
    assert "display" in title2.lower()


def test_get_task_by_number(plan_generator, sample_spec):
    """Test finding tasks by their hierarchical number"""
    tasks = plan_generator.generate_implementation_plan(sample_spec)

    # Test finding main task
    task_1 = plan_generator.get_task_by_number(tasks, "1")
    assert task_1 is not None
    assert task_1.task_number == "1"

    # Test finding subtask
    if any(task.subtasks for task in tasks):
        main_task_with_subtasks = next(task for task in tasks if task.subtasks)
        first_subtask = main_task_with_subtasks.subtasks[0]

        found_subtask = plan_generator.get_task_by_number(
            tasks, first_subtask.task_number
        )
        assert found_subtask is not None
        assert found_subtask.task_number == first_subtask.task_number
        assert found_subtask.id == first_subtask.id

    # Test non-existent task
    non_existent = plan_generator.get_task_by_number(tasks, "999")
    assert non_existent is None


def test_completion_stats(plan_generator, sample_spec):
    """Test completion statistics calculation"""
    tasks = plan_generator.generate_implementation_plan(sample_spec)

    # Initially all tasks should be pending
    stats = plan_generator.get_completion_stats(tasks)

    assert stats["total"] > 0
    assert stats["completed"] == 0
    assert stats["pending"] > 0
    assert stats["completion_percentage"] == 0.0

    # Complete some tasks
    flat_tasks = plan_generator._flatten_tasks(tasks)
    if len(flat_tasks) >= 2:
        flat_tasks[0].status = "completed"
        flat_tasks[1].status = "in_progress"

        updated_stats = plan_generator.get_completion_stats(tasks)

        assert updated_stats["completed"] == 1
        assert updated_stats["in_progress"] == 1
        assert updated_stats["pending"] == updated_stats["total"] - 2
        assert updated_stats["completion_percentage"] > 0.0


def test_update_plan_from_spec_changes(plan_generator, sample_spec):
    """Test updating existing plan when specification changes"""
    # Generate initial plan
    initial_tasks = plan_generator.generate_implementation_plan(sample_spec)

    # Mark some tasks as completed
    flat_tasks = plan_generator._flatten_tasks(initial_tasks)
    if len(flat_tasks) >= 2:
        flat_tasks[0].status = "completed"
        flat_tasks[0].actual_hours = 5.0
        flat_tasks[1].status = "in_progress"
        flat_tasks[1].actual_hours = 2.5

    # Add new requirement to spec
    new_requirement = EARSRequirement(
        id="US-001-R03",
        condition="WHEN user logs out",
        system_response="clear the session data",
    )
    sample_spec.user_stories[0].requirements.append(new_requirement)

    # Update plan
    updated_tasks = plan_generator.update_plan_from_spec_changes(
        sample_spec, initial_tasks
    )

    # Should preserve completion status
    updated_flat = plan_generator._flatten_tasks(updated_tasks)

    # Find tasks with same titles as the originally completed ones
    for original_task in flat_tasks[:2]:
        matching_task = next(
            (task for task in updated_flat if task.title == original_task.title), None
        )
        if matching_task:
            if original_task.status == "completed":
                assert matching_task.status == "completed"
                assert matching_task.actual_hours == original_task.actual_hours
            elif original_task.status == "in_progress":
                assert matching_task.status == "in_progress"
                assert matching_task.actual_hours == original_task.actual_hours


def test_set_task_dependencies(plan_generator, sample_spec):
    """Test automatic dependency setting"""
    tasks = plan_generator.generate_implementation_plan(sample_spec)

    flat_tasks = plan_generator._flatten_tasks(tasks)

    # Check that some dependencies were set
    tasks_with_deps = [task for task in flat_tasks if task.dependencies]
    assert len(tasks_with_deps) > 0

    # Implementation tasks should depend on setup tasks
    setup_tasks = [
        task
        for task in flat_tasks
        if "setup" in task.title.lower() or "structure" in task.title.lower()
    ]
    impl_tasks = [task for task in flat_tasks if "implement" in task.title.lower()]

    if setup_tasks and impl_tasks:
        # At least some implementation tasks should have setup dependencies
        impl_with_setup_deps = [
            task
            for task in impl_tasks
            if any(setup_task.id in task.dependencies for setup_task in setup_tasks)
        ]
        assert len(impl_with_setup_deps) > 0
