"""
Workflow and task management MCP tools.
"""

import asyncio
from typing import Dict, Any, List, Optional
from mcp.server.fastmcp import FastMCP, Context

from ..core.spec_manager import SpecificationManager
from ..models import WorkflowPhase


def setup_workflow_tools(mcp: FastMCP, spec_manager: SpecificationManager) -> None:
    """Setup workflow-related MCP tools"""

    @mcp.tool()
    async def add_implementation_task(
        spec_id: str,
        title: str,
        description: str,
        dependencies: Optional[List[str]] = None,
        subtasks: Optional[List[str]] = None,
        linked_requirements: Optional[List[str]] = None,
        estimated_hours: float = 0.0,
        ctx: Optional[Context] = None,
    ) -> Dict[str, Any]:
        """
        Add an implementation task to the specification's task list.

        Args:
            spec_id: The specification identifier
            title: Task title
            description: Detailed task description
            dependencies: List of task IDs this task depends on
            subtasks: List of subtask descriptions
            linked_requirements: List of requirement IDs this task
                implements
            estimated_hours: Estimated hours for completion
        """
        try:
            task = spec_manager.add_task(
                spec_id, title, description, dependencies or []
            )

            # Add additional properties
            if linked_requirements:
                task.linked_requirements = linked_requirements
            if estimated_hours:
                task.estimated_hours = estimated_hours

            # Handle subtasks - convert strings to Task objects if needed
            if subtasks:
                for i, subtask_desc in enumerate(subtasks):
                    subtask = spec_manager.plan_generator._create_subtask(
                        task, f"Subtask: {subtask_desc}", subtask_desc
                    )
                    task.subtasks.append(subtask)

            # Renumber tasks to maintain hierarchy
            spec = spec_manager.specs[spec_id]
            spec_manager.plan_generator._number_tasks_hierarchically(spec.tasks)

            spec_manager.save_specification(spec_id)

            if ctx:
                await ctx.info(f"Added task {task.task_number}: {task.title}")

            return {
                "status": "success",
                "task_id": task.id,
                "task_number": task.task_number,
                "title": task.title,
                "message": (f"Task {task.task_number} added to implementation plan"),
            }

        except Exception as e:
            return {"status": "error", "message": str(e)}

    @mcp.tool()
    async def execute_task(
        spec_id: str, task_id: str, ctx: Optional[Context] = None
    ) -> Dict[str, Any]:
        """
        Execute a specific task from the specification.
        Updates task status and provides execution details.

        Args:
            spec_id: The specification identifier
            task_id: The task identifier to execute
        """
        if spec_id not in spec_manager.specs:
            return {"status": "error", "message": f"Specification {spec_id} not found"}

        spec = spec_manager.specs[spec_id]
        task = next((t for t in spec.tasks if t.id == task_id), None)

        if not task:
            return {"status": "error", "message": f"Task {task_id} not found"}

        # Check dependencies
        unmet_deps = []
        for dep_id in task.dependencies:
            dep_task = next((t for t in spec.tasks if t.id == dep_id), None)
            if dep_task and dep_task.status != "completed":
                unmet_deps.append(dep_id)

        if unmet_deps:
            return {
                "status": "error",
                "message": (
                    f"Cannot execute task. Unmet dependencies: "
                    f"{', '.join(unmet_deps)}"
                ),
            }

        # Update task status
        spec_manager.update_task_status(spec_id, task_id, "in_progress")

        if ctx:
            await ctx.info(f"Executing task {task_id}: {task.title}")
            await ctx.report_progress(1, 3)

        # Simulate task execution
        await asyncio.sleep(1)

        # Mark as completed
        spec_manager.update_task_status(spec_id, task_id, "completed")

        if ctx:
            await ctx.report_progress(3, 3)
            await ctx.info(f"Task {task_id} completed")

        return {
            "status": "success",
            "task_id": task_id,
            "title": task.title,
            "new_status": "completed",
            "message": f"Task {task_id} executed successfully",
        }

    @mcp.tool()
    async def transition_workflow_phase(
        spec_id: str, target_phase: str, ctx: Optional[Context] = None
    ) -> Dict[str, Any]:
        """
        Transition the specification to a new workflow phase.
        Valid phases: requirements, design, implementation_planning,
        execution, review, completed

        Args:
            spec_id: The specification identifier
            target_phase: The target workflow phase
        """
        try:
            new_phase = WorkflowPhase(target_phase)

            if spec_manager.transition_phase(spec_id, new_phase):
                spec = spec_manager.specs[spec_id]

                if ctx:
                    await ctx.info(
                        f"Transitioned spec {spec_id} to {target_phase} phase"
                    )

                return {
                    "status": "success",
                    "spec_id": spec_id,
                    "previous_phase": spec.current_phase.value,
                    "current_phase": target_phase,
                    "message": (f"Workflow transitioned to {target_phase} phase"),
                }
            else:
                return {
                    "status": "error",
                    "message": f"Invalid phase transition to {target_phase}",
                }

        except ValueError:
            return {"status": "error", "message": f"Invalid phase: {target_phase}"}

    @mcp.tool()
    async def bulk_check_tasks(
        spec_id: str, task_numbers: List[str], ctx: Optional[Context] = None
    ) -> Dict[str, Any]:
        """
        Mark multiple tasks as completed (check multiple checkboxes).

        Args:
            spec_id: The specification identifier
            task_numbers: List of hierarchical task numbers to check
        """
        if spec_id not in spec_manager.specs:
            return {"status": "error", "message": f"Specification {spec_id} not found"}

        results = []
        success_count = 0

        for task_number in task_numbers:
            try:
                success = spec_manager.check_task(spec_id, task_number)
                if success:
                    success_count += 1
                    results.append({"task_number": task_number, "status": "success"})
                    if ctx:
                        await ctx.info(f"Checked task {task_number}")
                else:
                    results.append(
                        {
                            "task_number": task_number,
                            "status": "failed",
                            "message": "Task not found",
                        }
                    )
            except Exception as e:
                results.append(
                    {"task_number": task_number, "status": "error", "message": str(e)}
                )

        # Get updated stats
        stats = spec_manager.get_completion_stats(spec_id)

        # Safely access stats with None check
        progress_text = "0%"
        if stats and "completion_percentage" in stats:
            progress_text = f"{stats['completion_percentage']}%"

        return {
            "status": "success",
            "spec_id": spec_id,
            "tasks_checked": success_count,
            "total_requested": len(task_numbers),
            "results": results,
            "progress": progress_text,
            "stats": stats,
        }

    @mcp.tool()
    async def get_next_available_tasks(
        spec_id: str, ctx: Optional[Context] = None
    ) -> Dict[str, Any]:
        """
        Get tasks that are ready to be worked on (all dependencies completed).

        Args:
            spec_id: The specification identifier
        """
        if spec_id not in spec_manager.specs:
            return {"status": "error", "message": f"Specification {spec_id} not found"}

        spec = spec_manager.specs[spec_id]
        available_tasks = []

        all_tasks = spec_manager._flatten_tasks(spec.tasks)

        for task in all_tasks:
            if task.status == "pending":
                # Check if all dependencies are completed
                deps_completed = True
                for dep_id in task.dependencies:
                    dep_task = next((t for t in all_tasks if t.id == dep_id), None)
                    if dep_task and not dep_task.is_completed:
                        deps_completed = False
                        break

                if deps_completed:
                    available_tasks.append(
                        {
                            "number": task.task_number,
                            "title": task.title,
                            "description": task.description,
                            "linked_requirements": task.linked_requirements,
                            "estimated_hours": task.estimated_hours,
                        }
                    )

        return {
            "status": "success",
            "spec_id": spec_id,
            "available_tasks": available_tasks,
            "count": len(available_tasks),
            "message": (f"Found {len(available_tasks)} tasks ready to work on"),
        }
