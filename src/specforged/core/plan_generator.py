"""
Implementation plan generator for creating task hierarchies from
requirements and design.
"""

import re
from typing import List, Dict, Optional

from ..models import Specification, Task, UserStory, EARSRequirement


class PlanGenerator:
    """Generates implementation plans from specifications"""

    def __init__(self) -> None:
        self.task_counter = 0
        self.subtask_counters: Dict[str, int] = {}  # Track subtask counters

    def generate_implementation_plan(self, spec: Specification) -> List[Task]:
        """Generate a complete implementation plan from requirements and design"""
        self.task_counter = 0
        self.subtask_counters = {}

        tasks = []

        # Generate tasks from requirements
        requirement_tasks = self._generate_from_requirements(spec.user_stories)
        tasks.extend(requirement_tasks)

        # Generate tasks from design
        if spec.design:
            design_tasks = self._generate_from_design(spec.design, spec.user_stories)
            tasks.extend(design_tasks)

        # Add common development tasks
        common_tasks = self._generate_common_tasks()
        tasks.extend(common_tasks)

        # Number all tasks hierarchically
        self._number_tasks_hierarchically(tasks)

        # Analyze and set dependencies
        self._set_task_dependencies(tasks)

        return tasks

    def _generate_from_requirements(self, user_stories: List[UserStory]) -> List[Task]:
        """Generate tasks from user stories and EARS requirements"""
        tasks = []

        for story in user_stories:
            # Create main task for the user story
            story_task = self._create_task(
                title=f"Implement {story.as_a} functionality",
                description=(
                    f"As a {story.as_a}, I want {story.i_want}, "
                    f"so that {story.so_that}"
                ),
                linked_requirements=[story.id],
            )

            # Create subtasks for each EARS requirement
            for req in story.requirements:
                subtask = self._create_subtask(
                    parent_task=story_task,
                    title=self._generate_task_title_from_ears(req),
                    description=self._generate_task_description_from_ears(req),
                    linked_requirements=[req.id],
                )
                story_task.subtasks.append(subtask)

            tasks.append(story_task)

        return tasks

    def _generate_from_design(
        self, design: Dict, user_stories: List[UserStory]
    ) -> List[Task]:
        """Generate tasks from technical design"""
        tasks = []

        # Architecture tasks
        if "architecture" in design:
            arch_task = self._create_task(
                title="Set up system architecture",
                description=(
                    design["architecture"][:200] + "..."
                    if len(design["architecture"]) > 200
                    else design["architecture"]
                ),
            )
            tasks.append(arch_task)

        # Component tasks
        if "components" in design:
            for component in design["components"]:
                comp_task = self._create_task(
                    title=f"Implement {component['name']}",
                    description=component.get(
                        "description",
                        f"Implementation of {component['name']} component",
                    ),
                )
                tasks.append(comp_task)

        # Data model tasks
        if "data_models" in design:
            data_task = self._create_task(
                title="Implement data models",
                description="Create data models and database schema",
            )
            tasks.append(data_task)

        return tasks

    def _generate_common_tasks(self) -> List[Task]:
        """Generate common development tasks"""
        common_tasks = [
            self._create_task(
                title="Set up project structure",
                description=(
                    "Initialize project structure, dependencies, and "
                    "development environment"
                ),
            ),
            self._create_task(
                title="Write unit tests",
                description="Create comprehensive unit tests for all components",
            ),
            self._create_task(
                title="Integration testing",
                description="Test component integration and system workflows",
            ),
            self._create_task(
                title="Documentation and deployment",
                description="Create user documentation and deployment procedures",
            ),
        ]

        return common_tasks

    def _create_task(
        self,
        title: str,
        description: str,
        linked_requirements: Optional[List[str]] = None,
    ) -> Task:
        """Create a new task with unique ID"""
        self.task_counter += 1
        return Task(
            id=f"T{self.task_counter:03d}",
            title=title,
            description=description,
            linked_requirements=linked_requirements or [],
        )

    def _create_subtask(
        self,
        parent_task: Task,
        title: str,
        description: str,
        linked_requirements: Optional[List[str]] = None,
    ) -> Task:
        """Create a subtask with proper parent relationship"""
        subtask = self._create_task(title, description, linked_requirements)
        subtask.parent_id = parent_task.id
        return subtask

    def _generate_task_title_from_ears(self, requirement: EARSRequirement) -> str:
        """Generate a task title from an EARS requirement"""
        # Extract the action from the system response
        response = requirement.system_response.lower()

        # Common patterns and their task titles
        patterns = {
            r"validate|check": "Add validation",
            r"display|show": "Implement display logic",
            r"create|generate": "Build creation functionality",
            r"authenticate|login": "Implement authentication",
            r"redirect": "Add navigation logic",
            r"save|store": "Implement data persistence",
            r"send|notify": "Add notification system",
            r"process": "Implement processing logic",
        }

        for pattern, title in patterns.items():
            if re.search(pattern, response):
                return title

        # Fallback: capitalize first word of system response
        return f"Implement {response}"

    def _generate_task_description_from_ears(self, requirement: EARSRequirement) -> str:
        """Generate a detailed task description from an EARS requirement"""
        return (
            f"Implement functionality where {requirement.condition.lower()} "
            f"the system shall {requirement.system_response.lower()}"
        )

    def _number_tasks_hierarchically(self, tasks: List[Task]) -> None:
        """Assign hierarchical numbers to tasks (1, 1.1, 1.2, 2, etc.)"""
        main_task_number = 0

        for task in tasks:
            main_task_number += 1
            task.task_number = str(main_task_number)

            # Number subtasks
            subtask_number = 0
            for subtask in task.subtasks:
                subtask_number += 1
                subtask.task_number = f"{main_task_number}.{subtask_number}"

                # Number sub-subtasks if any exist
                self._number_subtasks_recursively(
                    subtask, f"{main_task_number}.{subtask_number}"
                )

    def _number_subtasks_recursively(self, task: Task, base_number: str) -> None:
        """Recursively number subtasks"""
        subtask_number = 0
        for subtask in task.subtasks:
            subtask_number += 1
            subtask.task_number = f"{base_number}.{subtask_number}"

            if subtask.subtasks:
                self._number_subtasks_recursively(subtask, subtask.task_number)

    def _set_task_dependencies(self, tasks: List[Task]) -> None:
        """Analyze and set logical dependencies between tasks"""
        # Get flat list of all tasks
        all_tasks = []
        for task in tasks:
            all_tasks.extend(task.get_flat_task_list())

        # Set basic dependency rules
        setup_tasks = [
            t
            for t in all_tasks
            if "setup" in t.title.lower() or "structure" in t.title.lower()
        ]
        implementation_tasks = [t for t in all_tasks if "implement" in t.title.lower()]
        test_tasks = [t for t in all_tasks if "test" in t.title.lower()]

        # Implementation tasks depend on setup tasks
        for impl_task in implementation_tasks:
            for setup_task in setup_tasks:
                if setup_task.id not in impl_task.dependencies:
                    impl_task.dependencies.append(setup_task.id)

        # Test tasks depend on implementation tasks
        for test_task in test_tasks:
            for impl_task in implementation_tasks:
                if impl_task.id not in test_task.dependencies:
                    test_task.dependencies.append(impl_task.id)

    def update_plan_from_spec_changes(
        self, spec: Specification, existing_tasks: List[Task]
    ) -> List[Task]:
        """Update existing plan based on specification changes"""
        # Generate new plan
        new_tasks = self.generate_implementation_plan(spec)

        # Preserve completion status from existing tasks
        existing_task_map = {
            task.title: task for task in self._flatten_tasks(existing_tasks)
        }

        for new_task in self._flatten_tasks(new_tasks):
            if new_task.title in existing_task_map:
                existing_task = existing_task_map[new_task.title]
                new_task.status = existing_task.status
                new_task.actual_hours = existing_task.actual_hours

        return new_tasks

    def _flatten_tasks(self, tasks: List[Task]) -> List[Task]:
        """Get flat list of all tasks including subtasks"""
        flat_tasks = []
        for task in tasks:
            flat_tasks.extend(task.get_flat_task_list())
        return flat_tasks

    def get_task_by_number(self, tasks: List[Task], task_number: str) -> Optional[Task]:
        """Find a task by its hierarchical number"""
        for task in self._flatten_tasks(tasks):
            if task.task_number == task_number:
                return task
        return None

    def get_completion_stats(self, tasks: List[Task]) -> Dict[str, int]:
        """Get completion statistics for tasks"""
        flat_tasks = self._flatten_tasks(tasks)

        total = len(flat_tasks)
        completed = len([t for t in flat_tasks if t.is_completed])
        in_progress = len([t for t in flat_tasks if t.status == "in_progress"])
        pending = total - completed - in_progress

        return {
            "total": total,
            "completed": completed,
            "in_progress": in_progress,
            "pending": pending,
            "completion_percentage": round(
                (completed / total * 100) if total > 0 else 0
            ),
        }
