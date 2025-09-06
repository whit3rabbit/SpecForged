"""
Specification management MCP tools.
"""

from typing import Any, Dict, List, Optional, cast

from mcp.server.fastmcp import Context, FastMCP

from ..core.spec_manager import SpecificationManager


def _get_completion_suggestions_for_specs(
    incomplete_specs: List[Dict[str, Any]],
) -> List[str]:
    """Generate completion suggestions for incomplete specifications."""
    suggestions = []
    for spec in incomplete_specs:
        spec_id = spec["spec_id"]
        issues = spec["issues"]
        if "no_requirements" in issues:
            suggestions.append(f"add_requirement({spec_id}, ...)")
        if "no_design" in issues:
            suggestions.append(f"update_design({spec_id}, ...)")
        if "no_tasks" in issues:
            suggestions.append(f"generate_implementation_plan({spec_id})")
    return suggestions


def setup_spec_tools(mcp: FastMCP, spec_manager: SpecificationManager) -> None:
    """Setup specification-related MCP tools"""

    @mcp.tool()
    async def create_spec(
        name: str,
        description: str = "",
        spec_id: Optional[str] = None,
        ctx: Optional[Context] = None,
    ) -> Dict[str, Any]:
        """
        Create a new specification with requirements, design, and tasks files.
        Automatically sets it as the current specification.

        Args:
            name: A descriptive name for the specification.
            description: A brief description of the specification's purpose.
            spec_id: A short, unique identifier (e.g., 'frontend', 'refactor-api').
                     If not provided, it will be generated from the name.
        """
        try:
            spec = spec_manager.create_specification(name, description, spec_id)
        except ValueError as e:
            return {"status": "error", "message": str(e)}

        if ctx:
            await ctx.info(f"Created specification: {spec.id}")
            await ctx.info(f"Set '{spec.id}' as the current specification.")
            await ctx.info(f"Phase: {spec.current_phase.value}")

        return {
            "spec_id": spec.id,
            "name": spec.name,
            "status": spec.status.value,
            "phase": spec.current_phase.value,
            "files": {
                "requirements": str(
                    spec_manager.base_dir / spec.id / "requirements.md"
                ),
                "design": str(spec_manager.base_dir / spec.id / "design.md"),
                "tasks": str(spec_manager.base_dir / spec.id / "tasks.md"),
            },
            "message": (f"Specification '{name}' created with ID '{spec.id}'"),
        }

    @mcp.tool()
    async def set_current_spec(
        spec_id: str, ctx: Optional[Context] = None
    ) -> Dict[str, Any]:
        """
        Set the active specification for subsequent commands.

        Args:
            spec_id: The identifier of the specification to make active.
        """
        success = spec_manager.set_current_specification(spec_id)
        if success:
            if ctx:
                await ctx.info(f"Current specification set to: {spec_id}")
            return {
                "status": "success",
                "current_spec_id": spec_id,
                "message": f"'{spec_id}' is now the active specification.",
            }
        else:
            return {
                "status": "error",
                "message": f"Specification '{spec_id}' not found.",
                "available_specs": list(spec_manager.specs.keys()),
            }

    @mcp.tool()
    async def add_requirement(
        as_a: str,
        i_want: str,
        so_that: str,
        spec_id: Optional[str] = None,
        ears_requirements: Optional[List[Dict[str, str]]] = None,
        ctx: Optional[Context] = None,
    ) -> Dict[str, Any]:
        """
        Add a user story with EARS-formatted acceptance criteria to the
        specification. Uses the current spec if spec_id is omitted.

        Args:
            as_a: The user role (for user story)
            i_want: The desired functionality (for user story)
            so_that: The benefit/reason (for user story)
            spec_id: The specification identifier. If omitted, uses the current spec.
            ears_requirements: List of EARS requirements with 'condition'
                and 'system_response'
        """
        effective_spec_id = spec_id or spec_manager.current_spec_id
        if not effective_spec_id:
            return {
                "status": "error",
                "message": (
                    "No specification selected. Provide spec_id or set_current_spec()."
                ),
            }

        try:
            # Add user story
            story = spec_manager.add_user_story(
                effective_spec_id, as_a, i_want, so_that
            )

            # Add EARS requirements if provided
            added_requirements = []
            if ears_requirements:
                for req_data in ears_requirements:
                    req = spec_manager.add_ears_requirement(
                        effective_spec_id,
                        story.id,
                        req_data.get("condition", "WHEN a condition occurs"),
                        req_data.get("system_response", "perform an action"),
                    )
                    added_requirements.append(req.to_ears_string())

            if ctx:
                await ctx.info(
                    f"Added user story {story.id} to spec {effective_spec_id}"
                )

            # Check if this is a wizard-created spec and provide guidance
            spec = spec_manager.specs[effective_spec_id]
            wizard_info = {}
            if (
                spec.wizard_state.is_active
                and spec.wizard_state.current_wizard_phase == "requirements"
            ):
                user_story_count = len(spec.user_stories)
                spec.wizard_state.last_wizard_action = f"added_user_story_{story.id}"
                spec_manager.save_specification(effective_spec_id)

                if user_story_count < 3:
                    wizard_info = {
                        "wizard_guidance": (
                            f"Great! You now have {user_story_count} "
                            f"user stories. Consider adding 2-3 more to "
                            f"cover different user types and scenarios."
                        ),
                        "next_step": (
                            "Add more user stories or use "
                            "wizard_next_step() for guidance"
                        ),
                        "progress": f"{user_story_count}/3-5 user stories recommended",
                    }
                else:
                    wizard_info = {
                        "wizard_guidance": (
                            f"Excellent! You have {user_story_count} "
                            f"user stories. You're ready to move to "
                            f"the design phase!"
                        ),
                        "next_step": (
                            "Use transition_workflow_phase(spec_id, "
                            "'design') or wizard_complete_phase(spec_id, "
                            "'requirements')"
                        ),
                        "progress": (
                            f"{user_story_count}/3-5 user stories - "
                            f"Ready for design phase!"
                        ),
                    }

            return {
                "status": "success",
                "spec_id": effective_spec_id,
                "story_id": story.id,
                "user_story": (f"As a {as_a}, I want {i_want}, so that {so_that}"),
                "ears_requirements": added_requirements,
                "message": (
                    f"Added user story with {len(added_requirements)} "
                    "EARS requirements"
                ),
                **wizard_info,
            }

        except Exception as e:
            return {"status": "error", "message": str(e)}

    @mcp.tool()
    async def update_design(
        spec_id: Optional[str] = None,
        architecture: Optional[str] = None,
        components: Optional[List[Dict[str, str]]] = None,
        data_models: Optional[str] = None,
        sequence_diagrams: Optional[List[Dict[str, str]]] = None,
        ctx: Optional[Context] = None,
    ) -> Dict[str, Any]:
        """
        Update the technical design documentation for a specification.
        Uses the current spec if spec_id is omitted.

        Args:
            spec_id: The specification identifier. If omitted, uses the current spec.
            architecture: System architecture description
            components: List of components with name and description
            data_models: TypeScript/interface definitions
            sequence_diagrams: List of diagrams with title and mermaid
                content
        """
        effective_spec_id = spec_id or spec_manager.current_spec_id
        if not effective_spec_id:
            return {
                "status": "error",
                "message": (
                    "No specification selected. Provide spec_id or set_current_spec()."
                ),
            }

        if effective_spec_id not in spec_manager.specs:
            return {
                "status": "error",
                "message": f"Specification {effective_spec_id} not found",
            }

        spec = spec_manager.specs[effective_spec_id]

        # Update design sections
        if architecture:
            spec.design["architecture"] = architecture

        if components:
            spec.design["components"] = components

        if data_models:
            spec.design["data_models"] = data_models

        if sequence_diagrams:
            spec.design["sequence_diagrams"] = sequence_diagrams

        from datetime import datetime

        spec.updated_at = datetime.now()
        spec_manager.save_specification(effective_spec_id)

        if ctx:
            await ctx.info(f"Updated design for spec {effective_spec_id}")

        return {
            "status": "success",
            "spec_id": effective_spec_id,
            "updated_sections": [
                k
                for k in [
                    "architecture",
                    "components",
                    "data_models",
                    "sequence_diagrams",
                ]
                if locals().get(k) is not None
            ],
            "message": "Design documentation updated",
        }

    @mcp.tool()
    async def list_specifications(ctx: Optional[Context] = None) -> Dict[str, Any]:
        """
        List all available specifications with their current status and phase,
        highlighting the current one.
        """
        specs = []
        current_spec_id = spec_manager.current_spec_id

        for spec_id, spec in spec_manager.specs.items():
            specs.append(
                {
                    "id": spec_id,
                    "name": spec.name,
                    "is_current": spec_id == current_spec_id,
                    "status": spec.status.value,
                    "phase": spec.current_phase.value,
                    "created_at": spec.created_at.isoformat(),
                    "updated_at": spec.updated_at.isoformat(),
                    "user_stories_count": len(spec.user_stories),
                    "tasks_count": len(spec.tasks),
                    "tasks_completed": sum(
                        1 for t in spec.tasks if t.status == "completed"
                    ),
                }
            )

        # Check if no specifications exist and suggest wizard
        result = {
            "specifications": specs,
            "total": len(specs),
            "current_spec_id": current_spec_id,
        }

        if len(specs) == 0:
            # Check if .specifications folder exists at all
            specs_dir = spec_manager.base_dir
            folder_exists = specs_dir.exists()

            result.update(
                {
                    "no_specifications": True,
                    "folder_exists": folder_exists,
                    "suggestion": {
                        "message": (
                            "No specifications found. Would you like to "
                            "start with the SpecForge wizard?"
                        ),
                        "action": (
                            "Use wizard_start(project_name='your-project', "
                            "description='brief description') to begin"
                        ),
                        "wizard_benefits": [
                            "Guided requirements gathering with EARS notation",
                            "Structured design phase with architecture planning",
                            (
                                "Automatic task generation from requirements and "
                                "design"
                            ),
                            "Checkbox-style progress tracking",
                        ],
                    },
                }
            )

        return result

    @mcp.tool()
    async def check_initialization_status(
        ctx: Optional[Context] = None,
    ) -> Dict[str, Any]:
        """
        Check if SpecForge is initialized and provide guidance for next steps.
        Detects missing .specifications folder, empty specifications, or incomplete
        phases.
        """
        specs_dir = spec_manager.base_dir
        folder_exists = specs_dir.exists()
        has_specs = len(spec_manager.specs) > 0

        result: Dict[str, Any] = {
            "initialized": folder_exists and has_specs,
            "folder_exists": folder_exists,
            "has_specifications": has_specs,
            "total_specs": len(spec_manager.specs),
        }

        # No folder at all - first-time setup
        if not folder_exists:
            result.update(
                {
                    "status": "not_initialized",
                    "message": (
                        "SpecForge not initialized. No .specifications " "folder found."
                    ),
                    "suggestion": {
                        "action": (
                            "wizard_start(project_name='your-project', "
                            "description='brief description')"
                        ),
                        "description": (
                            "Start the wizard to create your first "
                            "specification with guided setup"
                        ),
                    },
                }
            )

        # Folder exists but no specs
        elif not has_specs:
            result.update(
                {
                    "status": "empty",
                    "message": ("SpecForge folder exists but no specifications found."),
                    "suggestion": {
                        "action": (
                            "wizard_start(project_name='your-project', "
                            "description='brief description')"
                        ),
                        "description": (
                            "Create your first specification using the "
                            "interactive wizard"
                        ),
                    },
                }
            )

        # Has specs - check if any are incomplete
        else:
            incomplete_specs = []
            for spec_id, spec in spec_manager.specs.items():
                issues = []

                # Check for missing requirements
                if not spec.user_stories:
                    issues.append("no_requirements")

                # Check for missing design
                spec_dir = specs_dir / spec_id
                design_file = spec_dir / "design.md"
                if (
                    not design_file.exists()
                    or len(design_file.read_text().strip()) < 100
                ):
                    issues.append("no_design")

                # Check for missing tasks
                if not spec.tasks:
                    issues.append("no_tasks")

                if issues:
                    incomplete_specs.append(
                        {
                            "spec_id": spec_id,
                            "name": spec.name,
                            "phase": spec.current_phase.value,
                            "issues": issues,
                        }
                    )

            if incomplete_specs:
                result.update(
                    {
                        "status": "incomplete",
                        "message": (
                            f"Found {len(incomplete_specs)} incomplete "
                            "specifications"
                        ),
                        "incomplete_specs": incomplete_specs,
                        "suggestions": _get_completion_suggestions_for_specs(
                            incomplete_specs
                        ),
                    }
                )
            else:
                result.update(
                    {
                        "status": "complete",
                        "message": "All specifications appear complete",
                    }
                )

        return result

    @mcp.tool()
    async def get_specification_details(
        spec_id: str, include_content: bool = False, ctx: Optional[Context] = None
    ) -> Dict[str, Any]:
        """
        Get detailed information about a specific specification.

        Args:
            spec_id: The specification identifier
            include_content: Whether to include full content of requirements,
                design, and tasks
        """
        if spec_id not in spec_manager.specs:
            return {
                "status": "error",
                "message": f"Specification {spec_id} not found",
            }

        spec = spec_manager.specs[spec_id]

        result = {
            "id": spec.id,
            "name": spec.name,
            "status": spec.status.value,
            "phase": spec.current_phase.value,
            "created_at": spec.created_at.isoformat(),
            "updated_at": spec.updated_at.isoformat(),
            "metadata": spec.metadata,
        }

        # Add summary information
        result["summary"] = {
            "user_stories": len(spec.user_stories),
            "requirements": sum(len(s.requirements) for s in spec.user_stories),
            "tasks_total": len(spec.tasks),
            "tasks_completed": sum(1 for t in spec.tasks if t.status == "completed"),
            "tasks_in_progress": sum(
                1 for t in spec.tasks if t.status == "in_progress"
            ),
            "tasks_pending": sum(1 for t in spec.tasks if t.status == "pending"),
        }

        if include_content:
            # Include full content
            result["user_stories"] = cast(
                Any,
                [
                    {
                        "id": s.id,
                        "as_a": s.as_a,
                        "i_want": s.i_want,
                        "so_that": s.so_that,
                        "requirements": [r.to_ears_string() for r in s.requirements],
                    }
                    for s in spec.user_stories
                ],
            )

            result["design"] = spec.design

            result["tasks"] = cast(
                Any,
                [
                    {
                        "id": t.id,
                        "title": t.title,
                        "description": t.description,
                        "status": t.status,
                        "dependencies": t.dependencies,
                        "subtasks": t.subtasks,
                    }
                    for t in spec.tasks
                ],
            )

        # Add wizard information if spec was created via wizard
        if spec.wizard_state.created_via_wizard:
            result["wizard_info"] = {
                "is_wizard_active": spec.wizard_state.is_active,
                "current_phase": spec.wizard_state.current_wizard_phase,
                "phase_completion": spec.wizard_state.phase_completion,
                "last_action": spec.wizard_state.last_wizard_action,
                "guidance": spec.wizard_state.wizard_guidance,
            }

        return result

    @mcp.tool()
    async def start_wizard_mode(
        project_name: str = "",
        description: str = "",
        auto_detect_folder: bool = True,
        ctx: Optional[Context] = None,
    ) -> Dict[str, Any]:
        """
        Start the SpecForge project wizard for comprehensive specification creation.

        This wizard guides you through Requirements → Design → Planning phases
        via conversation, using MCP tools to build your specification.

        Args:
            project_name: Name of the project/feature to create
            description: Brief description of what you're building
            auto_detect_folder: Whether to check for existing specifications folder
        """

        # Check if specifications folder already exists
        specs_dir = spec_manager.base_dir
        has_existing_specs = specs_dir.exists() and any(specs_dir.iterdir())

        if auto_detect_folder and has_existing_specs:
            existing_specs = list(spec_manager.specs.keys())
            return {
                "status": "info",
                "wizard_needed": False,
                "message": (
                    f"Existing specifications found: {', '.join(existing_specs)}"
                ),
                "suggestions": [
                    "Use 'create_spec' for individual specifications",
                    "Use 'list_specifications' to see all existing specs",
                    (
                        "Use wizard mode with auto_detect_folder=False to "
                        "create new project anyway"
                    ),
                ],
            }

        # Generate project name if not provided
        if not project_name:
            project_name = "new-project"

        # Create the specification to start the wizard
        spec = spec_manager.create_specification(project_name, description)

        # Initialize wizard state
        spec.wizard_state.is_active = True
        spec.wizard_state.created_via_wizard = True
        spec.wizard_state.current_wizard_phase = "requirements"
        spec.wizard_state.wizard_guidance = {
            "phase_name": "Requirements Gathering",
            "description": (
                "Define user stories with EARS-formatted " "acceptance criteria"
            ),
            "instructions": [
                "Think about WHO will use this system (user types)",
                "Define WHAT each user wants to accomplish (user stories)",
                "Specify HOW the system should behave (EARS requirements)",
                "Consider all scenarios: normal, error, edge cases",
            ],
            "next_step": (
                "Start by describing your main user types and "
                "what they need to accomplish"
            ),
        }
        spec.wizard_state.last_wizard_action = "wizard_started"

        # Save the spec with wizard state
        spec_manager.save_specification(spec.id)

        if ctx:
            await ctx.info("🚀 SpecForge Project Wizard Started")
            await ctx.info(f"📋 Created specification: {spec.id}")
            await ctx.info("🎯 Current Phase: Requirements Gathering")

        return {
            "status": "wizard_active",
            "spec_id": spec.id,
            "current_phase": "requirements",
            "phase_progress": {
                "requirements": "active",
                "design": "pending",
                "planning": "pending",
                "execution": "pending",
            },
            "guidance": {
                "phase_name": "Requirements Gathering",
                "description": (
                    "Define user stories with EARS-formatted " "acceptance criteria"
                ),
                "instructions": [
                    "Think about WHO will use this system (user types)",
                    "Define WHAT each user wants to accomplish (user stories)",
                    "Specify HOW the system should behave (EARS requirements)",
                    "Consider all scenarios: normal, error, edge cases",
                ],
                "next_step": (
                    "Start by describing your main user types and "
                    "what they need to accomplish"
                ),
            },
            "available_actions": [
                "add_requirement() - Add a user story with EARS criteria",
                "get_specification_details() - Review current progress",
                "transition_workflow_phase() - Move to next phase when ready",
            ],
            "wizard_help": {
                "ears_guidance": (
                    "Use EARS notation for requirements: "
                    "WHEN/WHILE/WHERE/IF...THEN/THE SYSTEM SHALL"
                ),
                "user_story_format": "As a [user], I want [goal], so that [benefit]",
                "phase_completion": (
                    "Add at least 3-5 user stories before moving " "to design phase"
                ),
            },
            "project_setup": {
                "base_dir": str(specs_dir),
                "project_name": project_name,
                "description": description,
                "created_files": [
                    f"{spec.id}/requirements.md",
                    f"{spec.id}/design.md",
                    f"{spec.id}/tasks.md",
                    f"{spec.id}/spec.json",
                ],
            },
            "message": (
                f"🎉 Project '{project_name}' created! I'm ready to guide you through "
                f"the requirements phase. Let's start by understanding your users and "
                "their needs. What kind of system are you building and "
                "who will use it?"
            ),
        }

    @mcp.tool()
    async def wizard_next_step(
        spec_id: str, ctx: Optional[Context] = None
    ) -> Dict[str, Any]:
        """
        Get guidance for the next step in the wizard for a specification.

        Args:
            spec_id: The specification identifier
        """
        if spec_id not in spec_manager.specs:
            return {"status": "error", "message": f"Specification {spec_id} not found"}

        spec = spec_manager.specs[spec_id]

        if not spec.wizard_state.is_active:
            return {
                "status": "info",
                "message": f"Wizard is not active for specification {spec_id}",
                "suggestion": (
                    "Use get_specification_details() to see " "current status"
                ),
            }

        current_phase = spec.wizard_state.current_wizard_phase
        user_story_count = len(spec.user_stories)

        # Determine next steps based on current phase and progress
        if current_phase == "requirements":
            if user_story_count == 0:
                next_step = (
                    "Start by adding your first user story with add_requirement()"
                )
                guidance = "Think about your main user and what they want to accomplish"
            elif user_story_count < 3:
                next_step = (
                    f"Add more user stories (you have {user_story_count}, aim for 3-5)"
                )
                guidance = "Consider different user types and scenarios"
            else:
                next_step = (
                    "Ready to move to design phase! Use "
                    "transition_workflow_phase() to 'design'"
                )
                guidance = (
                    "You have a good foundation of user stories. "
                    "The design phase is MANDATORY - do not skip to planning!"
                )

        elif current_phase == "design":
            if not spec.design.get("architecture"):
                next_step = "Define your system architecture with update_design()"
                guidance = "Describe the high-level components and how they interact"
            elif not spec.design.get("components"):
                next_step = "Add component details with update_design()"
                guidance = "Break down your architecture into specific components"
            else:
                next_step = "Ready for planning! Use " "generate_implementation_plan()"
                guidance = (
                    "Your design is complete. Now you can generate "
                    "the implementation tasks - this is the final "
                    "wizard phase!"
                )

        elif current_phase == "planning":
            if not spec.tasks:
                next_step = (
                    "Generate your implementation plan with "
                    "generate_implementation_plan()"
                )
                guidance = (
                    "This will create tasks.md based on your "
                    "requirements and design - final wizard step!"
                )
            else:
                next_step = (
                    "Wizard complete! Use execute_task() to start implementation"
                )
                guidance = (
                    "Planning phase done! Wizard ends here. Use "
                    "execute_task() for actual implementation."
                )

        else:
            next_step = "Wizard completed"
            guidance = "All wizard phases complete"

        return {
            "status": "success",
            "spec_id": spec_id,
            "current_phase": current_phase,
            "progress": {
                "user_stories": user_story_count,
                "has_architecture": bool(spec.design.get("architecture")),
                "has_components": bool(spec.design.get("components")),
                "has_tasks": len(spec.tasks) > 0,
            },
            "next_step": next_step,
            "guidance": guidance,
            "wizard_guidance": spec.wizard_state.wizard_guidance,
        }

    @mcp.tool()
    async def wizard_complete_phase(
        spec_id: str, phase: str, ctx: Optional[Context] = None
    ) -> Dict[str, Any]:
        """
        Mark a wizard phase as complete and get guidance for the next phase.

        Args:
            spec_id: The specification identifier
            phase: Phase to mark complete ('requirements', 'design', 'planning')
        """
        if spec_id not in spec_manager.specs:
            return {"status": "error", "message": f"Specification {spec_id} not found"}

        spec = spec_manager.specs[spec_id]

        if not spec.wizard_state.is_active:
            return {
                "status": "error",
                "message": f"Wizard is not active for specification {spec_id}",
            }

        if phase not in ["requirements", "design", "planning"]:
            return {
                "status": "error",
                "message": (
                    f"Invalid phase: {phase}. Must be 'requirements', "
                    "'design', or 'planning'"
                ),
            }

        # Mark phase as complete
        spec.wizard_state.phase_completion[phase] = True

        # Update wizard guidance for next phase
        if phase == "requirements":
            spec.wizard_state.current_wizard_phase = "design"
            spec.wizard_state.wizard_guidance = {
                "phase_name": "System Design",
                "description": "Define technical architecture and components",
                "instructions": [
                    "Describe the high-level system architecture",
                    "Break down into major components",
                    "Define data models and interfaces",
                    "Consider technology choices and constraints",
                ],
                "next_step": "Use update_design() to document your system architecture",
            }
        elif phase == "design":
            spec.wizard_state.current_wizard_phase = "planning"
            spec.wizard_state.wizard_guidance = {
                "phase_name": "Implementation Planning",
                "description": "Generate discrete tasks from requirements and design",
                "instructions": [
                    "Review your requirements and design",
                    "Generate implementation tasks",
                    "Organize tasks by dependencies",
                    "Validate task completeness",
                ],
                "next_step": (
                    "Use generate_implementation_plan() to create your task list"
                ),
            }
        elif phase == "planning":
            spec.wizard_state.is_active = False
            spec.wizard_state.wizard_guidance = {
                "phase_name": "Wizard Complete!",
                "description": "Your specification is ready for implementation",
                "instructions": [
                    "Your specification has requirements, design, and tasks",
                    "Use execute_task() to start working on tasks",
                    "Track progress with task completion",
                    "Follow the implementation guidance",
                ],
                "next_step": "Start implementing tasks with execute_task()",
            }

        spec.wizard_state.last_wizard_action = f"completed_{phase}_phase"
        spec_manager.save_specification(spec_id)

        if ctx:
            await ctx.info(f"✅ {phase.title()} phase completed!")
            if spec.wizard_state.is_active:
                await ctx.info(
                    f"🎯 Moving to {spec.wizard_state.current_wizard_phase} phase"
                )
            else:
                await ctx.info(
                    "🎉 Wizard completed! Specification ready for implementation"
                )

        return {
            "status": "success",
            "spec_id": spec_id,
            "completed_phase": phase,
            "wizard_active": spec.wizard_state.is_active,
            "current_phase": spec.wizard_state.current_wizard_phase,
            "guidance": spec.wizard_state.wizard_guidance,
            "message": f"Phase '{phase}' marked complete",
        }
