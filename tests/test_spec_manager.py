"""
Tests for the SpecificationManager.
"""

import shutil
import tempfile
from pathlib import Path

import pytest

from src.specforged.core.spec_manager import SpecificationManager
from src.specforged.models import SpecStatus, WorkflowPhase


@pytest.fixture
def temp_spec_dir():
    """Create a temporary directory for testing"""
    temp_dir = Path(tempfile.mkdtemp())
    yield temp_dir
    shutil.rmtree(temp_dir)


def test_spec_manager_initialization(temp_spec_dir):
    """Test SpecificationManager initialization"""
    manager = SpecificationManager(temp_spec_dir)
    assert manager.base_dir == temp_spec_dir
    assert temp_spec_dir.exists()
    assert isinstance(manager.specs, dict)


def test_create_specification(temp_spec_dir):
    """Test creating a new specification"""
    manager = SpecificationManager(temp_spec_dir)

    spec = manager.create_specification("Test Feature", "A test feature")

    assert spec.id == "test-feature"
    assert spec.name == "Test Feature"
    assert spec.status == SpecStatus.DRAFT
    assert spec.current_phase == WorkflowPhase.REQUIREMENTS
    assert spec.metadata["description"] == "A test feature"

    # Check that spec was saved to manager
    assert "test-feature" in manager.specs

    # Check that directory was created
    spec_dir = temp_spec_dir / "test-feature"
    assert spec_dir.exists()
    assert (spec_dir / "spec.json").exists()


def test_add_user_story(temp_spec_dir):
    """Test adding a user story to a specification"""
    manager = SpecificationManager(temp_spec_dir)
    spec = manager.create_specification("Test Feature", "A test feature")

    story = manager.add_user_story(
        spec.id, "developer", "to write clean code", "the codebase remains maintainable"
    )

    assert story.id == "US-001"
    assert story.as_a == "developer"
    assert story.i_want == "to write clean code"
    assert story.so_that == "the codebase remains maintainable"

    # Check that story was added to spec
    assert len(spec.user_stories) == 1
    assert spec.user_stories[0] == story


def test_add_ears_requirement(temp_spec_dir):
    """Test adding EARS requirements to a user story"""
    manager = SpecificationManager(temp_spec_dir)
    spec = manager.create_specification("Test Feature", "A test feature")
    story = manager.add_user_story(
        spec.id, "user", "to login", "I can access my account"
    )

    requirement = manager.add_ears_requirement(
        spec.id,
        story.id,
        "WHEN a user enters valid credentials",
        "authenticate and create a session",
    )

    assert requirement.id == "US-001-R01"
    assert requirement.condition == "WHEN a user enters valid credentials"
    assert requirement.system_response == "authenticate and create a session"

    # Check EARS string format
    ears_string = requirement.to_ears_string()
    expected_ears = (
        "WHEN a user enters valid credentials THE SYSTEM SHALL "
        "authenticate and create a session"
    )
    assert expected_ears == ears_string

    # Check that requirement was added to story
    assert len(story.requirements) == 1
    assert story.requirements[0] == requirement


def test_add_task(temp_spec_dir):
    """Test adding implementation tasks"""
    manager = SpecificationManager(temp_spec_dir)
    spec = manager.create_specification("Test Feature", "A test feature")

    task = manager.add_task(
        spec.id,
        "Implement login endpoint",
        "Create REST API endpoint for user authentication",
        ["T000"],  # Dependency example
    )

    assert task.id == "T001"
    assert task.title == "Implement login endpoint"
    expected_desc = "Create REST API endpoint for user authentication"
    assert task.description == expected_desc
    assert task.status == "pending"
    assert task.dependencies == ["T000"]

    # Check that task was added to spec
    assert len(spec.tasks) == 1
    assert spec.tasks[0] == task


def test_update_task_status(temp_spec_dir):
    """Test updating task status"""
    manager = SpecificationManager(temp_spec_dir)
    spec = manager.create_specification("Test Feature", "A test feature")
    task = manager.add_task(spec.id, "Test Task", "A test task")

    # Update status
    success = manager.update_task_status(spec.id, task.id, "in_progress")
    assert success is True
    assert task.status == "in_progress"

    # Test with invalid spec or task
    success = manager.update_task_status("invalid-spec", task.id, "completed")
    assert success is False

    success = manager.update_task_status(spec.id, "invalid-task", "completed")
    assert success is False


def test_transition_phase(temp_spec_dir):
    """Test workflow phase transitions"""
    manager = SpecificationManager(temp_spec_dir)
    spec = manager.create_specification("Test Feature", "A test feature")

    # Add a user story first (required for requirements -> design transition)
    manager.add_user_story(spec.id, "user", "test functionality", "testing works")

    # Valid transition: requirements -> design
    success = manager.transition_phase(spec.id, WorkflowPhase.DESIGN)
    assert success is True
    assert spec.current_phase == WorkflowPhase.DESIGN

    # Valid transition: design -> requirements (allowed for revisions)
    success = manager.transition_phase(spec.id, WorkflowPhase.REQUIREMENTS)
    assert success is True
    assert spec.current_phase == WorkflowPhase.REQUIREMENTS

    # Test with invalid spec
    success = manager.transition_phase("invalid-spec", WorkflowPhase.EXECUTION)
    assert success is False


def test_markdown_generation(temp_spec_dir):
    """Test that markdown files are generated correctly"""
    manager = SpecificationManager(temp_spec_dir)
    spec = manager.create_specification("Test Feature", "A test feature")
    story = manager.add_user_story(
        spec.id, "user", "to login", "I can access my account"
    )
    manager.add_ears_requirement(
        spec.id, story.id, "WHEN login submitted", "validate credentials"
    )

    spec_dir = temp_spec_dir / spec.id

    # Check requirements.md
    req_file = spec_dir / "requirements.md"
    assert req_file.exists()
    content = req_file.read_text()
    assert "Test Feature" in content
    assert "**As a** user" in content
    expected_ears = "WHEN login submitted THE SYSTEM SHALL validate credentials"
    assert expected_ears in content

    # Check design.md
    design_file = spec_dir / "design.md"
    assert design_file.exists()

    # Check tasks.md
    tasks_file = spec_dir / "tasks.md"
    assert tasks_file.exists()
