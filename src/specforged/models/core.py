"""
Core data models for SpecForge.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List


class UserMode(Enum):
    """User interaction modes"""

    DO = "do"
    SPEC = "spec"
    CHAT = "chat"


class WorkflowPhase(Enum):
    """Spec workflow phases"""

    IDLE = "idle"
    REQUIREMENTS = "requirements"
    DESIGN = "design"
    IMPLEMENTATION_PLANNING = "implementation_planning"
    EXECUTION = "execution"
    REVIEW = "review"
    COMPLETED = "completed"


class SpecStatus(Enum):
    """Specification status"""

    DRAFT = "draft"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


@dataclass
class ModeClassification:
    """Mode classification result with confidence scores"""

    chat_confidence: float
    do_confidence: float
    spec_confidence: float
    primary_mode: UserMode
    reasoning: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to JSON-serializable dict"""
        return {
            "chat": self.chat_confidence,
            "do": self.do_confidence,
            "spec": self.spec_confidence,
            "mode": self.primary_mode.value,
            "reasoning": self.reasoning,
        }


@dataclass
class EARSRequirement:
    """EARS-formatted requirement"""

    id: str
    condition: str  # WHEN/WHILE/WHERE/IF
    system_response: str  # THE SYSTEM SHALL
    priority: str = "MEDIUM"  # HIGH/MEDIUM/LOW
    acceptance_criteria: List[str] = field(default_factory=list)

    def to_ears_string(self) -> str:
        """Convert to EARS notation string"""
        return f"{self.condition} THE SYSTEM SHALL {self.system_response}"


@dataclass
class UserStory:
    """User story with EARS requirements"""

    id: str
    as_a: str
    i_want: str
    so_that: str
    requirements: List[EARSRequirement] = field(default_factory=list)

    def to_markdown(self) -> str:
        """Convert to markdown format"""
        md = f"## User Story {self.id}\n\n"
        md += f"**As a** {self.as_a},\n"
        md += f"**I want** {self.i_want},\n"
        md += f"**So that** {self.so_that}\n\n"
        md += "### Acceptance Criteria (EARS Format)\n\n"
        for req in self.requirements:
            md += f"- [{req.id}] {req.to_ears_string()}\n"
            if req.acceptance_criteria:
                for criteria in req.acceptance_criteria:
                    md += f"  - {criteria}\n"
        return md


@dataclass
class Task:
    """Implementation task with hierarchical numbering and checkbox support"""

    id: str
    title: str
    description: str
    status: str = "pending"  # pending/in_progress/completed
    task_number: str = ""  # Hierarchical number like "1", "1.1", "2.3.1"
    dependencies: List[str] = field(default_factory=list)
    subtasks: List["Task"] = field(
        default_factory=list
    )  # Now Task objects instead of strings
    linked_requirements: List[str] = field(default_factory=list)
    estimated_hours: float = 0.0
    actual_hours: float = 0.0
    parent_id: str = ""  # ID of parent task for hierarchy

    @property
    def is_completed(self) -> bool:
        """Check if task is completed"""
        return self.status == "completed"

    @property
    def checkbox_symbol(self) -> str:
        """Get checkbox symbol based on status"""
        return "[x]" if self.is_completed else "[ ]"

    @property
    def all_subtasks_completed(self) -> bool:
        """Check if all subtasks are completed"""
        if not self.subtasks:
            return True
        return all(subtask.is_completed for subtask in self.subtasks)

    def to_checkbox_markdown(self, indent_level: int = 0) -> str:
        """Convert task to checkbox markdown format"""
        indent = "  " * indent_level
        checkbox = self.checkbox_symbol

        # Build main task line
        task_line = f"{indent}- {checkbox} {self.task_number}. {self.title}"

        # Add description if not just the title
        if self.description and self.description != self.title:
            task_line += f"\n{indent}  {self.description}"

        # Add linked requirements
        if self.linked_requirements:
            req_list = ", ".join(self.linked_requirements)
            task_line += f"\n{indent}  _Requirements: {req_list}_"

        # Add subtasks recursively
        subtask_lines = []
        for subtask in self.subtasks:
            subtask_lines.append(subtask.to_checkbox_markdown(indent_level + 1))

        if subtask_lines:
            task_line += "\n" + "\n".join(subtask_lines)

        return task_line

    def get_flat_task_list(self) -> List["Task"]:
        """Get a flat list of this task and all its subtasks"""
        tasks = [self]
        for subtask in self.subtasks:
            tasks.extend(subtask.get_flat_task_list())
        return tasks

    def update_status_from_subtasks(self) -> None:
        """Update status based on subtask completion"""
        if self.subtasks:
            if self.all_subtasks_completed:
                self.status = "completed"
            elif any(
                subtask.status == "in_progress" or subtask.is_completed
                for subtask in self.subtasks
            ):
                self.status = "in_progress"
            else:
                self.status = "pending"


@dataclass
class WizardState:
    """Wizard state tracking for guided specification creation"""

    is_active: bool = False
    created_via_wizard: bool = False
    current_wizard_phase: str = "requirements"  # requirements, design, planning
    phase_completion: Dict[str, bool] = field(
        default_factory=lambda: {
            "requirements": False,
            "design": False,
            "planning": False,
        }
    )
    wizard_guidance: Dict[str, Any] = field(default_factory=dict)
    last_wizard_action: str = ""


@dataclass
class Specification:
    """Complete specification with all three files"""

    id: str
    name: str
    created_at: datetime
    updated_at: datetime
    status: SpecStatus
    current_phase: WorkflowPhase
    user_stories: List[UserStory] = field(default_factory=list)
    design: Dict[str, Any] = field(default_factory=dict)
    tasks: List[Task] = field(default_factory=list)
    metadata: Dict[str, Any] = field(default_factory=dict)
    wizard_state: WizardState = field(default_factory=WizardState)
