"""
Tests for data models.
"""

from datetime import datetime

from src.specforged.models import (
    UserMode,
    WorkflowPhase,
    SpecStatus,
    ModeClassification,
    EARSRequirement,
    UserStory,
    Task,
    Specification,
)


def test_user_mode_enum():
    """Test UserMode enum values"""
    assert UserMode.DO.value == "do"
    assert UserMode.SPEC.value == "spec"
    assert UserMode.CHAT.value == "chat"


def test_workflow_phase_enum():
    """Test WorkflowPhase enum values"""
    assert WorkflowPhase.REQUIREMENTS.value == "requirements"
    assert WorkflowPhase.DESIGN.value == "design"
    assert WorkflowPhase.EXECUTION.value == "execution"
    assert WorkflowPhase.COMPLETED.value == "completed"


def test_mode_classification():
    """Test ModeClassification dataclass"""
    classification = ModeClassification(
        chat_confidence=0.2,
        do_confidence=0.7,
        spec_confidence=0.1,
        primary_mode=UserMode.DO,
        reasoning=["Matched do pattern"],
    )

    assert classification.primary_mode == UserMode.DO
    assert classification.do_confidence == 0.7

    # Test to_dict method
    result_dict = classification.to_dict()
    assert result_dict["mode"] == "do"
    assert result_dict["do"] == 0.7
    assert result_dict["reasoning"] == ["Matched do pattern"]


def test_ears_requirement():
    """Test EARSRequirement dataclass"""
    requirement = EARSRequirement(
        id="REQ-001",
        condition="WHEN user clicks login",
        system_response="validate credentials",
        priority="HIGH",
    )

    assert requirement.id == "REQ-001"
    assert requirement.priority == "HIGH"

    # Test EARS string generation
    ears_string = requirement.to_ears_string()
    expected = "WHEN user clicks login THE SYSTEM SHALL validate credentials"
    assert ears_string == expected


def test_user_story():
    """Test UserStory dataclass"""
    requirement = EARSRequirement(
        id="US-001-R01",
        condition="WHEN login attempted",
        system_response="authenticate user",
    )

    story = UserStory(
        id="US-001",
        as_a="user",
        i_want="to login securely",
        so_that="my data is protected",
        requirements=[requirement],
    )

    assert story.id == "US-001"
    assert len(story.requirements) == 1

    # Test markdown generation
    markdown = story.to_markdown()
    assert "User Story US-001" in markdown
    assert "**As a** user" in markdown
    assert "**I want** to login securely" in markdown
    assert "**So that** my data is protected" in markdown
    assert "US-001-R01" in markdown
    assert "WHEN login attempted THE SYSTEM SHALL authenticate user" in markdown


def test_task():
    """Test Task dataclass"""
    task = Task(
        id="T001",
        title="Implement login",
        description="Create login functionality",
        status="in_progress",
        dependencies=["T000"],
        subtasks=["Create form", "Add validation"],
        linked_requirements=["US-001-R01"],
        estimated_hours=8.0,
    )

    assert task.id == "T001"
    assert task.title == "Implement login"
    assert task.status == "in_progress"
    assert task.dependencies == ["T000"]
    assert task.subtasks == ["Create form", "Add validation"]
    assert task.linked_requirements == ["US-001-R01"]
    assert task.estimated_hours == 8.0
    assert task.actual_hours == 0.0  # Default value


def test_specification():
    """Test Specification dataclass"""
    now = datetime.now()

    story = UserStory(
        id="US-001",
        as_a="user",
        i_want="to login",
        so_that="I can access my account",
    )

    task = Task(
        id="T001",
        title="Create login form",
        description="Build the HTML form for login",
    )

    spec = Specification(
        id="login-system",
        name="Login System",
        created_at=now,
        updated_at=now,
        status=SpecStatus.DRAFT,
        current_phase=WorkflowPhase.REQUIREMENTS,
        user_stories=[story],
        design={"architecture": "MVC pattern"},
        tasks=[task],
        metadata={"priority": "high"},
    )

    assert spec.id == "login-system"
    assert spec.name == "Login System"
    assert spec.status == SpecStatus.DRAFT
    assert spec.current_phase == WorkflowPhase.REQUIREMENTS
    assert len(spec.user_stories) == 1
    assert len(spec.tasks) == 1
    assert spec.design["architecture"] == "MVC pattern"
    assert spec.metadata["priority"] == "high"


def test_default_values():
    """Test that default values are set correctly"""
    # EARSRequirement defaults
    req = EARSRequirement(id="R1", condition="WHEN", system_response="SHALL")
    assert req.priority == "MEDIUM"
    assert req.acceptance_criteria == []

    # UserStory defaults
    story = UserStory(id="US1", as_a="user", i_want="something", so_that="benefit")
    assert story.requirements == []

    # Task defaults
    task = Task(id="T1", title="Task", description="Description")
    assert task.status == "pending"
    assert task.dependencies == []
    assert task.subtasks == []
    assert task.linked_requirements == []
    assert task.estimated_hours == 0.0
    assert task.actual_hours == 0.0

    # Specification defaults
    now = datetime.now()
    spec = Specification(
        id="spec1",
        name="Spec",
        created_at=now,
        updated_at=now,
        status=SpecStatus.DRAFT,
        current_phase=WorkflowPhase.REQUIREMENTS,
    )
    assert spec.user_stories == []
    assert spec.design == {}
    assert spec.tasks == []
    assert spec.metadata == {}
