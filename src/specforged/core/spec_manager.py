"""
Specification management logic for handling spec workflows and file operations.
"""

import json
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..models import (
    EARSRequirement,
    Specification,
    SpecStatus,
    Task,
    UserStory,
    WorkflowPhase,
)
from .plan_generator import PlanGenerator
from .project_detector import ProjectDetector


class SpecificationManager:
    """Manages specification files and workflow"""

    def __init__(self, base_dir: Optional[Path] = None):
        # If a base_dir (specifications directory) is provided, use it directly
        # and infer the project root as its parent. Otherwise, auto-detect.
        if base_dir is not None:
            self.base_dir = base_dir
            self.project_detector = ProjectDetector(working_dir=base_dir.parent)
        else:
            self.project_detector = ProjectDetector()
            self.base_dir = self.project_detector.get_specifications_dir()

        # Security: Validate that base_dir is within reasonable bounds
        self._validate_base_directory()

        # Ensure the base directory exists, including any missing parents
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.specs: Dict[str, Specification] = {}
        self.current_spec_id: Optional[str] = None
        self.plan_generator = PlanGenerator()
        self.load_specifications()

    def _validate_base_directory(self) -> None:
        """Validate that the base directory is safe to write to."""
        resolved_base = self.base_dir.resolve()

        # Refuse root-level or system-like bases
        if str(resolved_base) in ("/", "/.specifications"):
            raise PermissionError(
                f"Spec base resolves to '{resolved_base}', which is unsafe. "
                f"Set SPECFORGE_PROJECT_ROOT or launch from a real project directory."
            )

        system_dirs = {
            Path("/System"),
            Path("/usr"),
            Path("/bin"),
            Path("/sbin"),
            Path("/etc"),
        }
        for sd in system_dirs:
            try:
                resolved_base.relative_to(sd)
                # if relative_to() doesn't raise, we're under a system dir
                raise PermissionError(
                    f"Refusing to write under system directory: {resolved_base}"
                )
            except ValueError:
                pass  # not under sd

        # Additional check: ensure we're not trying to write to the root filesystem
        if len(resolved_base.parts) <= 2:  # e.g., '/' or '/usr'
            raise PermissionError(
                f"Base directory too high in filesystem hierarchy: {resolved_base}"
            )

    def _validate_file_path(self, file_path: Path) -> bool:
        """
        Validate that a file path is safe for operations by ensuring it is within
        the base directory and adheres to size limits.

        Args:
            file_path: Path to validate

        Returns:
            True if path is safe, False otherwise
        """
        try:
            # Validate path against base directory (allow files under base_dir)
            resolved_path = file_path.resolve()
            resolved_base = self.base_dir.resolve()
            resolved_path.relative_to(resolved_base)

            # Check file size limits (for existing files)
            if resolved_path.exists() and resolved_path.is_file():
                size_mb = resolved_path.stat().st_size / (1024 * 1024)
                if size_mb > 10:  # 10MB limit
                    print(
                        f"Warning: File {resolved_path} is {size_mb:.1f}MB "
                        "(exceeds 10MB limit)"
                    )
                    return False

            return True
        except (ValueError, OSError):
            return False

    def load_specifications(self) -> None:
        """Load existing specifications from disk"""
        for spec_dir in self.base_dir.iterdir():
            if spec_dir.is_dir():
                spec_file = spec_dir / "spec.json"
                if spec_file.exists():
                    try:
                        with open(spec_file, "r") as f:
                            spec_data = json.load(f)
                        # Reconstruct specification object
                        self.specs[spec_data["id"]] = self._deserialize_spec(spec_data)
                        # Ensure standard files exist without overwriting
                        self._ensure_standard_files(
                            spec_dir, self.specs[spec_data["id"]]
                        )
                    except (json.JSONDecodeError, KeyError, OSError, ValueError) as e:
                        print(f"Error loading spec {spec_dir.name}: {e}")

        # Load current spec configuration
        self._load_current_spec_config()

    def create_specification(
        self, name: str, description: str = "", spec_id: Optional[str] = None
    ) -> Specification:
        """Create a new specification"""
        # Use provided spec_id or generate one from the name
        spec_id = spec_id or name.lower().replace(" ", "-").replace("_", "-")

        if spec_id in self.specs:
            raise ValueError(f"Specification with id '{spec_id}' already exists.")

        spec = Specification(
            id=spec_id,
            name=name,
            created_at=datetime.now(),
            updated_at=datetime.now(),
            status=SpecStatus.DRAFT,
            current_phase=WorkflowPhase.REQUIREMENTS,
            metadata={"description": description},
        )

        self.specs[spec_id] = spec
        self.set_current_specification(spec_id)

        # Create directory structure
        spec_dir = self.base_dir / spec_id
        spec_dir.mkdir(exist_ok=True)

        # Save initial state
        self.save_specification(spec_id)
        # Ensure standard files are present
        self._ensure_standard_files(spec_dir, spec)

        return spec

    def set_current_specification(self, spec_id: str) -> bool:
        """Set the active specification context."""
        if spec_id in self.specs:
            self.current_spec_id = spec_id
            self._save_current_spec_config()
            return True
        return False

    def _save_current_spec_config(self) -> None:
        """Save current specification configuration to a config file."""
        config_file = self.base_dir / ".current"
        try:
            with open(config_file, "w", encoding="utf-8") as f:
                f.write(self.current_spec_id or "")
        except OSError as e:
            print(f"Warning: Could not save current spec config: {e}")

    def _load_current_spec_config(self) -> None:
        """Load current specification from config file."""
        config_file = self.base_dir / ".current"
        if config_file.exists():
            try:
                with open(config_file, "r", encoding="utf-8") as f:
                    spec_id = f.read().strip()
                    if spec_id and spec_id in self.specs:
                        self.current_spec_id = spec_id
            except OSError:
                pass  # Ignore if can't read config

    def _ensure_standard_files(self, spec_dir: Path, spec: Specification) -> None:
        """Create requirements.md, design.md, and tasks.md if missing."""
        req_file = spec_dir / "requirements.md"
        design_file = spec_dir / "design.md"
        tasks_file = spec_dir / "tasks.md"

        if not req_file.exists():
            self._save_requirements_file(spec_dir, spec)
        if not design_file.exists():
            self._save_design_file(spec_dir, spec)
        if not tasks_file.exists():
            self._save_tasks_file(spec_dir, spec)

    def save_specification(self, spec_id: str) -> None:
        """Save specification to disk"""
        if spec_id not in self.specs:
            return

        spec = self.specs[spec_id]
        spec_dir = self.base_dir / spec_id
        spec_dir.mkdir(exist_ok=True)

        # Save main spec file
        spec_file = spec_dir / "spec.json"

        # Validate file path before writing
        if not self._validate_file_path(spec_file):
            print(f"Error: Invalid file path for spec: {spec_file}")
            return

        try:
            with open(spec_file, "w", encoding="utf-8") as f:
                json.dump(self._serialize_spec(spec), f, indent=2, default=str)
        except OSError as e:
            print(f"Error writing spec file {spec_file}: {e}")
            return

        # Save requirements.md
        self._save_requirements_file(spec_dir, spec)

        # Save design.md
        self._save_design_file(spec_dir, spec)

        # Save tasks.md
        self._save_tasks_file(spec_dir, spec)

    def _save_requirements_file(self, spec_dir: Path, spec: Specification) -> None:
        """Generate and save requirements.md"""
        req_file = spec_dir / "requirements.md"

        # Validate file path before writing
        if not self._validate_file_path(req_file):
            print(f"Error: Invalid file path for requirements: {req_file}")
            return

        content = f"# Requirements for {spec.name}\n\n"
        content += f"**Status:** {spec.status.value}\n"
        content += f"**Created:** {spec.created_at.strftime('%Y-%m-%d')}\n"
        content += f"**Updated:** {spec.updated_at.strftime('%Y-%m-%d')}\n\n"

        if spec.user_stories:
            content += "## User Stories\n\n"
            for story in spec.user_stories:
                content += story.to_markdown()
                content += "\n---\n\n"

        try:
            with open(req_file, "w", encoding="utf-8") as f:
                f.write(content)
        except OSError as e:
            print(f"Error writing requirements file {req_file}: {e}")

    def _save_design_file(self, spec_dir: Path, spec: Specification) -> None:
        """Generate and save design.md"""
        design_file = spec_dir / "design.md"

        # Validate file path before writing
        if not self._validate_file_path(design_file):
            print(f"Error: Invalid file path for design: {design_file}")
            return

        content = f"# Technical Design for {spec.name}\n\n"

        if spec.design:
            # Architecture section
            if "architecture" in spec.design:
                content += "## System Architecture\n\n"
                content += spec.design["architecture"] + "\n\n"

            # Components section
            if "components" in spec.design:
                content += "## Components\n\n"
                for component in spec.design["components"]:
                    content += f"### {component['name']}\n"
                    content += f"{component.get('description', '')}\n\n"

            # Data models section
            if "data_models" in spec.design:
                content += "## Data Models\n\n"
                content += "```typescript\n"
                content += spec.design["data_models"]
                content += "\n```\n\n"

            # Sequence diagrams
            if "sequence_diagrams" in spec.design:
                content += "## Sequence Diagrams\n\n"
                for diagram in spec.design["sequence_diagrams"]:
                    content += f"### {diagram['title']}\n\n"
                    content += "```mermaid\n"
                    content += diagram["content"]
                    content += "\n```\n\n"

        try:
            with open(design_file, "w", encoding="utf-8") as f:
                f.write(content)
        except OSError as e:
            print(f"Error writing design file {design_file}: {e}")

    def _save_tasks_file(self, spec_dir: Path, spec: Specification) -> None:
        """Generate and save tasks.md with checkbox format"""
        tasks_file = spec_dir / "tasks.md"

        # Validate file path before writing
        if not self._validate_file_path(tasks_file):
            print(f"Error: Invalid file path for tasks: {tasks_file}")
            return

        content = "# Implementation Plan\n\n"

        # Get completion statistics
        stats = self.plan_generator.get_completion_stats(spec.tasks)

        content += "## Progress Summary\n\n"
        content += f"- **Total Tasks:** {stats['total']}\n"
        content += f"- **Completed:** {stats['completed']}\n"
        content += f"- **In Progress:** {stats['in_progress']}\n"
        content += f"- **Pending:** {stats['pending']}\n"
        content += f"- **Progress:** {stats['completion_percentage']}%\n\n"

        # Generate checkbox task list
        if spec.tasks:
            for task in spec.tasks:
                content += task.to_checkbox_markdown()
                content += "\n\n"
        else:
            content += (
                "No tasks defined yet. Use `generate_implementation_plan` "
                "to create tasks.\n"
            )

        try:
            with open(tasks_file, "w", encoding="utf-8") as f:
                f.write(content)
        except OSError as e:
            print(f"Error writing tasks file {tasks_file}: {e}")

    def _serialize_spec(self, spec: Specification) -> Dict[str, Any]:
        """Serialize specification to JSON-compatible dict"""
        return {
            "id": spec.id,
            "name": spec.name,
            "created_at": spec.created_at.isoformat(),
            "updated_at": spec.updated_at.isoformat(),
            "status": spec.status.value,
            "current_phase": spec.current_phase.value,
            "user_stories": [self._serialize_user_story(s) for s in spec.user_stories],
            "design": spec.design,
            "tasks": [asdict(t) for t in spec.tasks],
            "metadata": spec.metadata,
        }

    def _serialize_user_story(self, story: UserStory) -> Dict[str, Any]:
        """Serialize user story to dict"""
        return {
            "id": story.id,
            "as_a": story.as_a,
            "i_want": story.i_want,
            "so_that": story.so_that,
            "requirements": [asdict(r) for r in story.requirements],
        }

    def _deserialize_spec(self, data: Dict[str, Any]) -> Specification:
        """Deserialize specification from dict"""
        spec = Specification(
            id=data["id"],
            name=data["name"],
            created_at=datetime.fromisoformat(data["created_at"]),
            updated_at=datetime.fromisoformat(data["updated_at"]),
            status=SpecStatus(data["status"]),
            current_phase=WorkflowPhase(data["current_phase"]),
            design=data.get("design", {}),
            metadata=data.get("metadata", {}),
        )
        # Manually deserialize nested objects
        spec.user_stories = [
            self._deserialize_user_story(s) for s in data.get("user_stories", [])
        ]
        spec.tasks = [self._deserialize_task(t) for t in data.get("tasks", [])]
        return spec

    def _deserialize_user_story(self, data: Dict[str, Any]) -> UserStory:
        """Deserialize user story from dict"""
        story = UserStory(
            id=data["id"],
            as_a=data["as_a"],
            i_want=data["i_want"],
            so_that=data["so_that"],
        )
        story.requirements = [
            EARSRequirement(**r) for r in data.get("requirements", [])
        ]
        return story

    def _deserialize_task(self, data: Dict[str, Any]) -> Task:
        """Deserialize task from dict, handling nested subtasks"""
        subtasks_data = data.pop("subtasks", [])
        task = Task(**data)
        task.subtasks = [self._deserialize_task(st) for st in subtasks_data]
        return task

    def add_user_story(
        self, spec_id: str, as_a: str, i_want: str, so_that: str
    ) -> UserStory:
        """Add a user story to a specification"""
        if spec_id not in self.specs:
            raise ValueError(f"Specification {spec_id} not found")

        spec = self.specs[spec_id]
        story_id = f"US-{len(spec.user_stories) + 1:03d}"

        story = UserStory(id=story_id, as_a=as_a, i_want=i_want, so_that=so_that)

        spec.user_stories.append(story)
        spec.updated_at = datetime.now()
        self.save_specification(spec_id)

        return story

    def add_ears_requirement(
        self, spec_id: str, story_id: str, condition: str, system_response: str
    ) -> EARSRequirement:
        """Add an EARS requirement to a user story"""
        if spec_id not in self.specs:
            raise ValueError(f"Specification {spec_id} not found")

        spec = self.specs[spec_id]
        story = next((s for s in spec.user_stories if s.id == story_id), None)

        if not story:
            raise ValueError(f"User story {story_id} not found")

        req_id = f"{story_id}-R{len(story.requirements) + 1:02d}"

        requirement = EARSRequirement(
            id=req_id, condition=condition, system_response=system_response
        )

        story.requirements.append(requirement)
        spec.updated_at = datetime.now()
        self.save_specification(spec_id)

        return requirement

    def add_task(
        self,
        spec_id: str,
        title: str,
        description: str,
        dependencies: Optional[List[str]] = None,
    ) -> Task:
        """Add a task to the implementation plan"""
        if spec_id not in self.specs:
            raise ValueError(f"Specification {spec_id} not found")

        spec = self.specs[spec_id]
        task_id = f"T{len(spec.tasks) + 1:03d}"

        task = Task(
            id=task_id,
            title=title,
            description=description,
            dependencies=dependencies or [],
        )

        spec.tasks.append(task)
        spec.updated_at = datetime.now()
        self.save_specification(spec_id)

        return task

    def update_task_status(self, spec_id: str, task_id: str, status: str) -> bool:
        """Update the status of a task"""
        if spec_id not in self.specs:
            return False

        spec = self.specs[spec_id]
        task = next((t for t in spec.tasks if t.id == task_id), None)

        if not task:
            return False

        task.status = status
        spec.updated_at = datetime.now()
        self.save_specification(spec_id)

        return True

    def transition_phase(self, spec_id: str, new_phase: WorkflowPhase) -> bool:
        """
        Transition specification to a new workflow phase with strict validation.
        Prevents skipping critical phases like design and validates content readiness.
        """
        if spec_id not in self.specs:
            return False

        spec = self.specs[spec_id]
        current_phase = spec.current_phase

        # Define strict workflow phase transitions
        # Prevents skipping design phase and enforces proper sequence
        valid_transitions = {
            WorkflowPhase.IDLE: [WorkflowPhase.REQUIREMENTS],
            WorkflowPhase.REQUIREMENTS: [
                WorkflowPhase.DESIGN,
                # Allow going back to requirements for revisions
                WorkflowPhase.REQUIREMENTS,
            ],
            WorkflowPhase.DESIGN: [
                WorkflowPhase.IMPLEMENTATION_PLANNING,
                # Allow going back for revisions
                WorkflowPhase.REQUIREMENTS,
                WorkflowPhase.DESIGN,
            ],
            WorkflowPhase.IMPLEMENTATION_PLANNING: [
                WorkflowPhase.EXECUTION,
                # Allow going back for revisions
                WorkflowPhase.REQUIREMENTS,
                WorkflowPhase.DESIGN,
                WorkflowPhase.IMPLEMENTATION_PLANNING,
            ],
            WorkflowPhase.EXECUTION: [
                WorkflowPhase.REVIEW,
                WorkflowPhase.COMPLETED,
                # Allow going back for revisions
                WorkflowPhase.REQUIREMENTS,
                WorkflowPhase.DESIGN,
                WorkflowPhase.IMPLEMENTATION_PLANNING,
            ],
            WorkflowPhase.REVIEW: [
                WorkflowPhase.COMPLETED,
                # Allow going back to any previous phase for revisions
                WorkflowPhase.REQUIREMENTS,
                WorkflowPhase.DESIGN,
                WorkflowPhase.IMPLEMENTATION_PLANNING,
                WorkflowPhase.EXECUTION,
            ],
            WorkflowPhase.COMPLETED: [
                # Allow reopening for revisions
                WorkflowPhase.REQUIREMENTS,
                WorkflowPhase.DESIGN,
                WorkflowPhase.IMPLEMENTATION_PLANNING,
                WorkflowPhase.EXECUTION,
                WorkflowPhase.REVIEW,
            ],
        }

        # Check if transition is valid
        if current_phase not in valid_transitions:
            return False

        if new_phase not in valid_transitions[current_phase]:
            return False

        # Additional content validation for forward transitions
        if self._is_forward_transition(current_phase, new_phase):
            if not self._validate_phase_readiness(spec_id, current_phase, new_phase):
                return False

        # Execute the transition
        spec.current_phase = new_phase
        spec.updated_at = datetime.now()
        self.save_specification(spec_id)
        return True

    def _is_forward_transition(
        self, current: WorkflowPhase, target: WorkflowPhase
    ) -> bool:
        """Check if this is a forward transition (not a revision)"""
        phase_order = [
            WorkflowPhase.IDLE,
            WorkflowPhase.REQUIREMENTS,
            WorkflowPhase.DESIGN,
            WorkflowPhase.IMPLEMENTATION_PLANNING,
            WorkflowPhase.EXECUTION,
            WorkflowPhase.REVIEW,
            WorkflowPhase.COMPLETED,
        ]

        try:
            current_idx = phase_order.index(current)
            target_idx = phase_order.index(target)
            return target_idx > current_idx
        except ValueError:
            return False

    def _validate_phase_readiness(
        self, spec_id: str, current_phase: WorkflowPhase, target_phase: WorkflowPhase
    ) -> bool:
        """Validate that the specification is ready to transition to the target phase"""
        spec = self.specs[spec_id]

        # Validate requirements -> design transition
        if (
            current_phase == WorkflowPhase.REQUIREMENTS
            and target_phase == WorkflowPhase.DESIGN
        ):
            if not spec.user_stories:
                return False  # Must have user stories before design

        # Validate design -> implementation_planning transition
        elif (
            current_phase == WorkflowPhase.DESIGN
            and target_phase == WorkflowPhase.IMPLEMENTATION_PLANNING
        ):
            # Check if design.md exists and has content
            spec_dir = self.base_dir / spec_id
            design_file = spec_dir / "design.md"
            if not design_file.exists():
                return False  # Must have design document
            try:
                content = design_file.read_text(encoding="utf-8").strip()
                if len(content) < 100:  # Must have substantial design content
                    return False
            except (OSError, UnicodeDecodeError, FileNotFoundError) as e:
                print(f"Error reading design file: {e}")
                return False

        # Validate implementation_planning -> execution transition
        elif (
            current_phase == WorkflowPhase.IMPLEMENTATION_PLANNING
            and target_phase == WorkflowPhase.EXECUTION
        ):
            if not spec.tasks:
                return False  # Must have implementation tasks

        return True

    def generate_implementation_plan(self, spec_id: str) -> bool:
        """Generate a new implementation plan from requirements and design"""
        if spec_id not in self.specs:
            return False

        spec = self.specs[spec_id]

        # CRITICAL: Validate that design phase is completed before generating plan
        # Check if we have requirements (user stories)
        if not spec.user_stories:
            return False  # No requirements found

        # Check if design.md exists and has substantial content
        spec_dir = self.base_dir / spec_id
        design_file = spec_dir / "design.md"
        if not design_file.exists():
            return False  # Design document missing

        try:
            design_content = design_file.read_text(encoding="utf-8").strip()
            if len(design_content) < 100:  # Must have substantial design content
                return False  # Design document is too brief
        except (OSError, UnicodeDecodeError, FileNotFoundError) as e:
            print(f"Unable to read design document: {e}")
            return False

        new_tasks = self.plan_generator.generate_implementation_plan(spec)

        spec.tasks = new_tasks
        spec.updated_at = datetime.now()
        self.save_specification(spec_id)

        return True

    def update_implementation_plan(self, spec_id: str) -> bool:
        """Update existing plan based on specification changes"""
        if spec_id not in self.specs:
            return False

        spec = self.specs[spec_id]
        updated_tasks = self.plan_generator.update_plan_from_spec_changes(
            spec, spec.tasks
        )

        spec.tasks = updated_tasks
        spec.updated_at = datetime.now()
        self.save_specification(spec_id)

        return True

    def check_task(self, spec_id: str, task_number: str) -> bool:
        """Mark a task as completed (check the checkbox)"""
        if spec_id not in self.specs:
            return False

        spec = self.specs[spec_id]
        task = self.plan_generator.get_task_by_number(spec.tasks, task_number)

        if not task:
            return False

        task.status = "completed"

        # Update parent task status if all subtasks are complete
        if task.parent_id:
            parent_task = next(
                (t for t in self._flatten_tasks(spec.tasks) if t.id == task.parent_id),
                None,
            )
            if parent_task:
                parent_task.update_status_from_subtasks()

        spec.updated_at = datetime.now()
        self.save_specification(spec_id)

        return True

    def uncheck_task(self, spec_id: str, task_number: str) -> bool:
        """Mark a task as pending (uncheck the checkbox)"""
        if spec_id not in self.specs:
            return False

        spec = self.specs[spec_id]
        task = self.plan_generator.get_task_by_number(spec.tasks, task_number)

        if not task:
            return False

        task.status = "pending"

        # Update parent task status
        if task.parent_id:
            parent_task = next(
                (t for t in self._flatten_tasks(spec.tasks) if t.id == task.parent_id),
                None,
            )
            if parent_task:
                parent_task.update_status_from_subtasks()

        spec.updated_at = datetime.now()
        self.save_specification(spec_id)

        return True

    def get_task_by_number(self, spec_id: str, task_number: str) -> Optional[Task]:
        """Get a task by its hierarchical number"""
        if spec_id not in self.specs:
            return None

        spec = self.specs[spec_id]
        return self.plan_generator.get_task_by_number(spec.tasks, task_number)

    def get_completion_stats(self, spec_id: str) -> Optional[Dict[str, int]]:
        """Get completion statistics for a specification"""
        if spec_id not in self.specs:
            return None

        spec = self.specs[spec_id]
        return self.plan_generator.get_completion_stats(spec.tasks)

    def _flatten_tasks(self, tasks: List[Task]) -> List[Task]:
        """Get flat list of all tasks including subtasks"""
        flat_tasks = []
        for task in tasks:
            flat_tasks.extend(task.get_flat_task_list())
        return flat_tasks

    def check_phase_completeness(self, spec_id: str, phase: str) -> bool:
        """Check if a specific phase has been completed with adequate content"""
        if spec_id not in self.specs:
            return False

        spec = self.specs[spec_id]
        spec_dir = self.base_dir / spec_id

        if phase == "requirements":
            return len(spec.user_stories) > 0

        elif phase == "design":
            design_file = spec_dir / "design.md"
            if not design_file.exists():
                return False
            try:
                content = design_file.read_text(encoding="utf-8").strip()
                return len(content) >= 100
            except (OSError, UnicodeDecodeError, FileNotFoundError):
                return False

        elif phase == "planning":
            return len(spec.tasks) > 0

        return False

    def get_missing_prerequisites(self, spec_id: str) -> List[str]:
        """Get list of missing phases/prerequisites for a specification"""
        if spec_id not in self.specs:
            return ["specification_not_found"]

        missing = []

        if not self.check_phase_completeness(spec_id, "requirements"):
            missing.append("requirements")

        if not self.check_phase_completeness(spec_id, "design"):
            missing.append("design")

        if not self.check_phase_completeness(spec_id, "planning"):
            missing.append("planning")

        return missing

    def suggest_next_action(self, spec_id: str) -> Dict[str, str]:
        """Get contextual suggestion for what to do next with a specification"""
        if spec_id not in self.specs:
            return {
                "action": "create_spec",
                "message": "Specification not found. Create it first.",
            }

        missing = self.get_missing_prerequisites(spec_id)

        if "requirements" in missing:
            return {
                "action": "add_requirement",
                "message": "Add user stories and EARS requirements first",
                "tool": (
                    "add_requirement(spec_id, as_a='user', i_want='goal', "
                    "so_that='benefit', ears_requirements=[...])"
                ),
            }

        elif "design" in missing:
            return {
                "action": "update_design",
                "message": "Create system architecture and design",
                "tool": (
                    "update_design(spec_id, architecture='...', "
                    "components='...', data_models='...')"
                ),
            }

        elif "planning" in missing:
            return {
                "action": "generate_implementation_plan",
                "message": "Generate implementation tasks from requirements and design",
                "tool": "generate_implementation_plan(spec_id)",
            }

        else:
            # All phases complete - suggest execution
            spec = self.specs[spec_id]
            if spec.tasks:
                incomplete_tasks = [
                    t for t in self._flatten_tasks(spec.tasks) if not t.is_completed
                ]
                if incomplete_tasks:
                    return {
                        "action": "execute_task",
                        "message": (
                            f"Start implementing tasks "
                            f"({len(incomplete_tasks)} remaining)"
                        ),
                        "tool": (
                            f"execute_task(spec_id, "
                            f"task_id='{incomplete_tasks[0].id}')"
                        ),
                    }

            return {
                "action": "complete",
                "message": (
                    "Specification appears complete! " "Consider review and deployment."
                ),
            }
