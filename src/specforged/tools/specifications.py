"""
Specification management MCP tools.
"""

from typing import Dict, Any, List
from mcp.server.fastmcp import FastMCP, Context

from ..core.spec_manager import SpecificationManager


def setup_spec_tools(mcp: FastMCP, spec_manager: SpecificationManager):
    """Setup specification-related MCP tools"""

    @mcp.tool()
    async def create_spec(
        name: str, description: str = "", ctx: Context = None
    ) -> Dict[str, Any]:
        """
        Create a new specification with requirements, design, and tasks files.
        Initializes the spec workflow in the requirements phase.
        """
        spec = spec_manager.create_specification(name, description)

        if ctx:
            await ctx.info(f"Created specification: {spec.id}")
            await ctx.info(f"Phase: {spec.current_phase.value}")

        return {
            "spec_id": spec.id,
            "name": spec.name,
            "status": spec.status.value,
            "phase": spec.current_phase.value,
            "files": {
                "requirements": f"specifications/{spec.id}/requirements.md",
                "design": f"specifications/{spec.id}/design.md",
                "tasks": f"specifications/{spec.id}/tasks.md",
            },
            "message": (
                f"Specification '{name}' created. Now in requirements phase."
            ),
        }

    @mcp.tool()
    async def add_requirement(
        spec_id: str,
        as_a: str,
        i_want: str,
        so_that: str,
        ears_requirements: List[Dict[str, str]] = None,
        ctx: Context = None,
    ) -> Dict[str, Any]:
        """
        Add a user story with EARS-formatted acceptance criteria to the
        specification.

        Args:
            spec_id: The specification identifier
            as_a: The user role (for user story)
            i_want: The desired functionality (for user story)
            so_that: The benefit/reason (for user story)
            ears_requirements: List of EARS requirements with 'condition'
                and 'system_response'
        """
        try:
            # Add user story
            story = spec_manager.add_user_story(spec_id, as_a, i_want, so_that)

            # Add EARS requirements if provided
            added_requirements = []
            if ears_requirements:
                for req_data in ears_requirements:
                    req = spec_manager.add_ears_requirement(
                        spec_id,
                        story.id,
                        req_data.get("condition", "WHEN a condition occurs"),
                        req_data.get("system_response", "perform an action"),
                    )
                    added_requirements.append(req.to_ears_string())

            if ctx:
                await ctx.info(f"Added user story {story.id} to spec {spec_id}")

            return {
                "status": "success",
                "story_id": story.id,
                "user_story": (
                    f"As a {as_a}, I want {i_want}, so that {so_that}"
                ),
                "ears_requirements": added_requirements,
                "message": (
                    f"Added user story with {len(added_requirements)} "
                    "EARS requirements"
                ),
            }

        except Exception as e:
            return {"status": "error", "message": str(e)}

    @mcp.tool()
    async def update_design(
        spec_id: str,
        architecture: str = None,
        components: List[Dict[str, str]] = None,
        data_models: str = None,
        sequence_diagrams: List[Dict[str, str]] = None,
        ctx: Context = None,
    ) -> Dict[str, Any]:
        """
        Update the technical design documentation for a specification.

        Args:
            spec_id: The specification identifier
            architecture: System architecture description
            components: List of components with name and description
            data_models: TypeScript/interface definitions
            sequence_diagrams: List of diagrams with title and mermaid
                content
        """
        if spec_id not in spec_manager.specs:
            return {
                "status": "error",
                "message": f"Specification {spec_id} not found",
            }

        spec = spec_manager.specs[spec_id]

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
        spec_manager.save_specification(spec_id)

        if ctx:
            await ctx.info(f"Updated design for spec {spec_id}")

        return {
            "status": "success",
            "spec_id": spec_id,
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
    async def list_specifications(ctx: Context = None) -> Dict[str, Any]:
        """
        List all available specifications with their current status and phase.
        """
        specs = []

        for spec_id, spec in spec_manager.specs.items():
            specs.append(
                {
                    "id": spec_id,
                    "name": spec.name,
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

        return {"specifications": specs, "total": len(specs)}

    @mcp.tool()
    async def get_specification_details(
        spec_id: str, include_content: bool = False, ctx: Context = None
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
            "requirements": sum(
                len(s.requirements) for s in spec.user_stories
            ),
            "tasks_total": len(spec.tasks),
            "tasks_completed": sum(
                1 for t in spec.tasks if t.status == "completed"
            ),
            "tasks_in_progress": sum(
                1 for t in spec.tasks if t.status == "in_progress"
            ),
            "tasks_pending": sum(
                1 for t in spec.tasks if t.status == "pending"
            ),
        }

        if include_content:
            # Include full content
            result["user_stories"] = [
                {
                    "id": s.id,
                    "as_a": s.as_a,
                    "i_want": s.i_want,
                    "so_that": s.so_that,
                    "requirements": [
                        r.to_ears_string() for r in s.requirements
                    ],
                }
                for s in spec.user_stories
            ]

            result["design"] = spec.design

            result["tasks"] = [
                {
                    "id": t.id,
                    "title": t.title,
                    "description": t.description,
                    "status": t.status,
                    "dependencies": t.dependencies,
                    "subtasks": t.subtasks,
                }
                for t in spec.tasks
            ]

        return result
