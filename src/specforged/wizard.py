#!/usr/bin/env python3
"""
SpecForge Project Creation Wizard

Interactive wizard for creating new project specifications with guided requirements,
design, and task generation.
"""

from pathlib import Path
from typing import Any, Dict, Optional

try:
    import questionary
    from rich import print as rich_print
    from rich.console import Console
    from rich.panel import Panel
    from rich.prompt import Confirm, Prompt
    from rich.table import Table
    from rich.text import Text

    INTERACTIVE_AVAILABLE = True
except ImportError:
    INTERACTIVE_AVAILABLE = False
    # Use type: ignore to suppress mypy errors for fallback imports
    Console = None  # type: ignore
    Panel = None  # type: ignore
    Prompt = None  # type: ignore
    Confirm = None  # type: ignore
    Table = None  # type: ignore
    Text = None  # type: ignore
    rich_print = print  # type: ignore
    questionary = None  # type: ignore

from specforged.core.spec_manager import SpecificationManager
from specforged.models import EARSRequirement


class ProjectWizard:
    """Interactive wizard for creating SpecForge projects"""

    def __init__(self, base_dir: Optional[Path] = None):
        if not INTERACTIVE_AVAILABLE:
            raise ImportError(
                "Interactive dependencies not available. Install with: "
                "pip install rich questionary"
            )

        self.console = Console()
        self.spec_manager = SpecificationManager(base_dir or Path("specifications"))

        # Project templates
        self.project_types = {
            "web-app": "Web Application",
            "rest-api": "REST API Service",
            "cli-tool": "Command Line Tool",
            "python-lib": "Python Library",
            "microservice": "Microservice",
            "desktop-app": "Desktop Application",
            "custom": "Custom Project",
        }

        # Common architecture patterns
        self.architectures = {
            "mvc": "Model-View-Controller",
            "layered": "Layered Architecture",
            "microservices": "Microservices",
            "event-driven": "Event-Driven Architecture",
            "component": "Component-Based",
            "custom": "Custom Architecture",
        }

    def run(self) -> Optional[str]:
        """Run the interactive project wizard"""
        if not INTERACTIVE_AVAILABLE:
            self.console.print("❌ Interactive mode requires additional dependencies.")
            self.console.print("Install with: pip install rich questionary")
            return None

        try:
            # Welcome message
            self._show_welcome()

            # Step 1: Project Setup
            project_info = self._get_project_info()
            if not project_info:
                return None

            # Step 2: Create specification
            spec_id = self._create_specification(project_info)
            if not spec_id:
                return None

            # Phase 1: Requirements gathering
            self._show_phase_header(1, "Requirements Gathering", "requirements.md")
            self._gather_requirements(spec_id)
            self._show_phase_complete(1, "requirements.md")

            # Phase 2: Design phase
            self._show_phase_header(2, "System Design", "design.md")
            self._design_phase(spec_id)
            self._show_phase_complete(2, "design.md")

            # Phase 3: Generate tasks
            self._show_phase_header(3, "Task Generation", "tasks.md")
            self._generate_tasks(spec_id)
            self._show_phase_complete(3, "tasks.md")

            # Final summary
            self._show_completion(spec_id)

            return spec_id

        except KeyboardInterrupt:
            self.console.print("\n❌ Wizard cancelled by user.")
            return None
        except (OSError, ValueError, AttributeError, TypeError) as e:
            self.console.print(f"❌ Error during wizard: {e}")
            return None

    def _show_welcome(self) -> None:
        """Show welcome message"""
        welcome_text = """
🚀 SpecForge Project Wizard

This wizard will guide you through creating a complete project specification
in three structured phases:

📝 Phase 1: Requirements Gathering (requirements.md)
🎨 Phase 2: System Design (design.md)
✅ Phase 3: Task Generation (tasks.md)

You can exit at any time with Ctrl+C.
        """

        panel = Panel(
            welcome_text.strip(),
            title="Welcome to SpecForge",
            border_style="bright_blue",
        )
        self.console.print(panel)

    def _show_phase_header(
        self, phase_num: int, phase_name: str, output_file: str
    ) -> None:
        """Show phase header with progress indicator"""
        phase_emojis = ["📝", "🎨", "✅"]
        emoji = phase_emojis[phase_num - 1] if phase_num <= 3 else "🔄"

        header_text = f"{emoji} Phase {phase_num}/3: {phase_name}"
        subtext = f"Creating {output_file} with structured {phase_name.lower()}"

        panel = Panel(
            f"{header_text}\n{subtext}",
            title=f"Phase {phase_num}",
            border_style="bright_cyan",
        )
        self.console.print(panel)

    def _show_phase_complete(self, phase_num: int, output_file: str) -> None:
        """Show phase completion message"""
        self.console.print(
            f"✅ Phase {phase_num}/3 completed: {output_file} created successfully!"
        )

        # Add brief pause for better UX
        if INTERACTIVE_AVAILABLE and questionary is not None:
            questionary.press_any_key_to_continue(
                "Press any key to continue to the next phase..."
            ).ask()
        else:
            input("Press Enter to continue to the next phase...")

    def _get_project_info(self) -> Optional[Dict[str, Any]]:
        """Gather basic project information"""
        self.console.print("\n📝 Project Setup")

        # Project name
        name = questionary.text(
            "What's your project name?",
            validate=lambda x: len(x.strip()) > 0 or "Project name cannot be empty",
        ).ask()

        if not name:
            return None
        name = str(name)

        # Project description
        description = questionary.text("Brief project description:", default="").ask()
        description = str(description or "")

        # Project type
        type_choices = [f"{key}: {value}" for key, value in self.project_types.items()]
        selected_type = questionary.select(
            "What type of project is this?", choices=type_choices
        ).ask()

        if not selected_type:
            return None

        project_type = str(selected_type).split(":")[0]

        # Technology stack (optional)
        tech_stack = questionary.text(
            "Technology stack (e.g., Python, React, PostgreSQL):", default=""
        ).ask()
        tech_stack = str(tech_stack or "")

        return {
            "name": name,
            "description": description,
            "type": project_type,
            "tech_stack": tech_stack,
        }

    def _create_specification(self, project_info: Dict[str, Any]) -> Optional[str]:
        """Create the specification"""
        self.console.print(
            f"\n🏗️  Creating specification for '{project_info['name']}'..."
        )

        # Create spec with metadata
        spec = self.spec_manager.create_specification(
            name=project_info["name"], description=project_info["description"]
        )

        # Add project metadata
        spec.metadata.update(
            {
                "project_type": project_info["type"],
                "tech_stack": project_info["tech_stack"],
                "created_via": "wizard",
            }
        )

        self.spec_manager.save_specification(spec.id)

        self.console.print(f"✅ Created specification: {spec.id}")
        return spec.id

    def _gather_requirements(self, spec_id: str) -> None:
        """Interactive requirements gathering"""

        # Show EARS format help
        ears_help = Panel(
            """EARS Format Examples:
• WHEN user clicks login button THE SYSTEM SHALL validate credentials
• IF password is incorrect THE SYSTEM SHALL display error message
• WHILE user is logged in THE SYSTEM SHALL maintain session
• WHERE admin role is enabled THE SYSTEM SHALL show admin panel""",
            title="EARS Requirements Format",
            border_style="yellow",
        )
        self.console.print(ears_help)

        user_stories = []

        # Get user stories
        add_more = True
        while add_more:
            story = self._get_user_story()
            if story:
                user_stories.append(story)

                # Add user story to spec
                self.spec_manager.add_user_story(
                    spec_id, story["as_a"], story["i_want"], story["so_that"]
                )

                # Add EARS requirements
                for ears in story["ears_requirements"]:
                    story_obj = self.spec_manager.specs[spec_id].user_stories[-1]
                    ears_req = EARSRequirement(
                        id=(
                            f"{story_obj.id}-R" f"{len(story_obj.requirements) + 1:02d}"
                        ),
                        condition=ears["condition"],
                        system_response=ears["system_response"],
                    )
                    story_obj.requirements.append(ears_req)

                self.spec_manager.save_specification(spec_id)
                self.console.print(f"✅ Added user story: {story['i_want'][:50]}...")

            add_more = questionary.confirm(
                "Add another user story?", default=True
            ).ask()
            if add_more is None:
                break

    def _get_user_story(self) -> Optional[Dict[str, Any]]:
        """Get a single user story with EARS requirements"""
        self.console.print("\n📝 New User Story")

        # User story components
        as_a = questionary.text("As a (user role):").ask()
        if not as_a:
            return None

        i_want = questionary.text("I want to (functionality):").ask()
        if not i_want:
            return None

        so_that = questionary.text("So that (benefit):").ask()
        if not so_that:
            return None

        # EARS requirements
        ears_requirements = []
        add_ears = questionary.confirm("Add EARS requirements?", default=True).ask()

        while add_ears:
            condition = questionary.text(
                "EARS condition (WHEN/IF/WHILE/WHERE...):"
            ).ask()
            if not condition:
                break

            response = questionary.text("THE SYSTEM SHALL...").ask()
            if not response:
                break

            ears_requirements.append(
                {"condition": condition, "system_response": response}
            )

            add_ears = questionary.confirm(
                "Add another EARS requirement?", default=False
            ).ask()
            if add_ears is None:
                break

        return {
            "as_a": as_a,
            "i_want": i_want,
            "so_that": so_that,
            "ears_requirements": ears_requirements,
        }

    def _design_phase(self, spec_id: str) -> None:
        """Interactive design phase"""

        # Architecture selection
        arch_choices = [f"{key}: {value}" for key, value in self.architectures.items()]
        selected_arch = questionary.select(
            "Choose system architecture:", choices=arch_choices
        ).ask()

        if not selected_arch:
            return

        architecture = selected_arch.split(":")[1].strip()

        # Components
        components = []
        self.console.print("\n🧩 System Components")

        add_component = True
        while add_component:
            name = questionary.text("Component name:").ask()
            if not name:
                break

            description = questionary.text("Component description:").ask()
            if description:
                components.append({"name": name, "description": description})

            add_component = questionary.confirm(
                "Add another component?", default=False
            ).ask()
            if add_component is None:
                break

        # Data models (optional)
        data_models = ""
        if questionary.confirm("Define data models?", default=False).ask():
            data_models = (
                questionary.text(
                    "Data models (TypeScript interfaces or schema):", multiline=True
                ).ask()
                or ""
            )

        # Update design
        spec = self.spec_manager.specs[spec_id]
        spec.design.update(
            {
                "architecture": architecture,
                "components": components,
                "data_models": data_models,
            }
        )

        # Transition to design phase in SpecForge workflow
        from specforged.models import WorkflowPhase

        self.spec_manager.transition_phase(spec_id, WorkflowPhase.DESIGN)

    def _generate_tasks(self, spec_id: str) -> None:
        """Generate implementation tasks"""

        # Transition to planning phase
        from specforged.models import WorkflowPhase

        self.spec_manager.transition_phase(
            spec_id, WorkflowPhase.IMPLEMENTATION_PLANNING
        )

        # Generate tasks from requirements and design
        self.spec_manager.generate_implementation_plan(spec_id)

    def _show_completion(self, spec_id: str) -> None:
        """Show completion summary"""
        spec = self.spec_manager.specs[spec_id]
        spec_dir = self.spec_manager.base_dir / spec_id

        summary_text = f"""
🎉 Project specification created successfully!

📁 Location: {spec_dir}
📝 Specification ID: {spec_id}
📊 User Stories: {len(spec.user_stories)}
🏗️  Phase: {spec.current_phase.value}

Files created:
• spec.json - Specification metadata
• requirements.md - User stories & EARS requirements
• design.md - System architecture & design
• tasks.md - Implementation checklist

Next steps:
1. Review the generated files
2. Start implementing tasks from tasks.md
3. Use 'specforged mcp' to access the specification via MCP
        """

        panel = Panel(
            summary_text.strip(),
            title="🚀 Project Created",
            border_style="bright_green",
        )
        self.console.print(panel)


def run_wizard(base_dir: Optional[str] = None) -> Optional[str]:
    """Run the project wizard"""
    wizard_base_dir = Path(base_dir) if base_dir else None
    wizard = ProjectWizard(wizard_base_dir)
    return wizard.run()


if __name__ == "__main__":
    run_wizard()
