"""
Implementation planning MCP tools for task generation and management.
"""

from typing import Dict, Any, List
from mcp.server.fastmcp import FastMCP, Context

from ..core.spec_manager import SpecificationManager


def setup_planning_tools(mcp: FastMCP, spec_manager: SpecificationManager):
    """Setup planning-related MCP tools"""

    @mcp.tool()
    async def generate_implementation_plan(
        spec_id: str, ctx: Context = None
    ) -> Dict[str, Any]:
        """
        Generate a comprehensive implementation plan from requirements and design.
        Creates a hierarchical task structure with checkbox format.

        Args:
            spec_id: The specification identifier
        """
        if spec_id not in spec_manager.specs:
            return {
                "status": "error",
                "message": f"Specification {spec_id} not found",
            }

        try:
            success = spec_manager.generate_implementation_plan(spec_id)

            if not success:
                return {
                    "status": "error",
                    "message": "Failed to generate implementation plan",
                }

            # Get statistics
            stats = spec_manager.get_completion_stats(spec_id)

            if ctx:
                await ctx.info(f"Generated implementation plan for {spec_id}")
                await ctx.info(f"Created {stats['total']} tasks")

            return {
                "status": "success",
                "spec_id": spec_id,
                "tasks_created": stats["total"],
                "message": (
                    f"Implementation plan generated with {stats['total']} tasks"
                ),
                "stats": stats,
            }

        except Exception as e:
            return {"status": "error", "message": f"Error generating plan: {str(e)}"}

    @mcp.tool()
    async def update_implementation_plan(
        spec_id: str, ctx: Context = None
    ) -> Dict[str, Any]:
        """
        Update existing implementation plan based on changes to requirements or design.
        Preserves completion status of existing tasks.

        Args:
            spec_id: The specification identifier
        """
        if spec_id not in spec_manager.specs:
            return {
                "status": "error",
                "message": f"Specification {spec_id} not found",
            }

        try:
            success = spec_manager.update_implementation_plan(spec_id)

            if not success:
                return {
                    "status": "error",
                    "message": "Failed to update implementation plan",
                }

            # Get updated statistics
            stats = spec_manager.get_completion_stats(spec_id)

            if ctx:
                await ctx.info(f"Updated implementation plan for {spec_id}")

            return {
                "status": "success",
                "spec_id": spec_id,
                "total_tasks": stats["total"],
                "message": (
                    f"Implementation plan updated with {stats['total']} tasks"
                ),
                "stats": stats,
            }

        except Exception as e:
            return {"status": "error", "message": f"Error updating plan: {str(e)}"}

    @mcp.tool()
    async def check_task(
        spec_id: str, task_number: str, ctx: Context = None
    ) -> Dict[str, Any]:
        """
        Mark a task as completed (check the checkbox).
        Automatically updates parent task status if all subtasks are complete.

        Args:
            spec_id: The specification identifier
            task_number: The hierarchical task number (e.g., "1", "2.1", "3.2.1")
        """
        if spec_id not in spec_manager.specs:
            return {
                "status": "error",
                "message": f"Specification {spec_id} not found",
            }

        # Find the task
        task = spec_manager.get_task_by_number(spec_id, task_number)
        if not task:
            return {"status": "error", "message": f"Task {task_number} not found"}

        # Check if task is already completed
        if task.is_completed:
            return {
                "status": "info",
                "message": f"Task {task_number} is already completed",
            }

        try:
            success = spec_manager.check_task(spec_id, task_number)

            if not success:
                return {
                    "status": "error",
                    "message": f"Failed to check task {task_number}",
                }

            if ctx:
                await ctx.info(f"Checked task {task_number}: {task.title}")

            # Get updated stats
            stats = spec_manager.get_completion_stats(spec_id)

            return {
                "status": "success",
                "spec_id": spec_id,
                "task_number": task_number,
                "task_title": task.title,
                "message": f"Task {task_number} marked as completed",
                "progress": f"{stats['completion_percentage']}%",
                "stats": stats,
            }

        except Exception as e:
            return {"status": "error", "message": f"Error checking task: {str(e)}"}

    @mcp.tool()
    async def uncheck_task(
        spec_id: str, task_number: str, ctx: Context = None
    ) -> Dict[str, Any]:
        """
        Mark a task as pending (uncheck the checkbox).
        Updates parent task status accordingly.

        Args:
            spec_id: The specification identifier
            task_number: The hierarchical task number (e.g., "1", "2.1", "3.2.1")
        """
        if spec_id not in spec_manager.specs:
            return {
                "status": "error",
                "message": f"Specification {spec_id} not found",
            }

        # Find the task
        task = spec_manager.get_task_by_number(spec_id, task_number)
        if not task:
            return {"status": "error", "message": f"Task {task_number} not found"}

        # Check if task is already pending
        if task.status == "pending":
            return {
                "status": "info",
                "message": f"Task {task_number} is already pending",
            }

        try:
            success = spec_manager.uncheck_task(spec_id, task_number)

            if not success:
                return {
                    "status": "error",
                    "message": f"Failed to uncheck task {task_number}",
                }

            if ctx:
                await ctx.info(f"Unchecked task {task_number}: {task.title}")

            # Get updated stats
            stats = spec_manager.get_completion_stats(spec_id)

            return {
                "status": "success",
                "spec_id": spec_id,
                "task_number": task_number,
                "task_title": task.title,
                "message": f"Task {task_number} marked as pending",
                "progress": f"{stats['completion_percentage']}%",
                "stats": stats,
            }

        except Exception as e:
            return {"status": "error", "message": f"Error unchecking task: {str(e)}"}

    @mcp.tool()
    async def get_task_details(
        spec_id: str, task_number: str, ctx: Context = None
    ) -> Dict[str, Any]:
        """
        Get detailed information about a specific task.

        Args:
            spec_id: The specification identifier
            task_number: The hierarchical task number (e.g., "1", "2.1", "3.2.1")
        """
        if spec_id not in spec_manager.specs:
            return {
                "status": "error",
                "message": f"Specification {spec_id} not found",
            }

        # Find the task
        task = spec_manager.get_task_by_number(spec_id, task_number)
        if not task:
            return {"status": "error", "message": f"Task {task_number} not found"}

        # Build subtasks info
        subtasks_info = []
        for subtask in task.subtasks:
            subtasks_info.append(
                {
                    "number": subtask.task_number,
                    "title": subtask.title,
                    "status": subtask.status,
                    "completed": subtask.is_completed,
                }
            )

        return {
            "status": "success",
            "task": {
                "id": task.id,
                "number": task.task_number,
                "title": task.title,
                "description": task.description,
                "status": task.status,
                "completed": task.is_completed,
                "dependencies": task.dependencies,
                "linked_requirements": task.linked_requirements,
                "estimated_hours": task.estimated_hours,
                "actual_hours": task.actual_hours,
                "subtasks": subtasks_info,
            },
        }

    @mcp.tool()
    async def get_task_status_summary(
        spec_id: str, ctx: Context = None
    ) -> Dict[str, Any]:
        """
        Summarize task statuses for a spec, grouped by completed,
        in_progress, and pending.
        """
        if spec_id not in spec_manager.specs:
            return {
                "status": "error",
                "message": f"Specification {spec_id} not found",
            }

        try:
            stats = spec_manager.get_completion_stats(spec_id)
            spec = spec_manager.specs[spec_id]

            completed_tasks: List[Dict[str, Any]] = []
            in_progress_tasks: List[Dict[str, Any]] = []
            pending_tasks: List[Dict[str, Any]] = []

            for task in spec_manager._flatten_tasks(spec.tasks):
                subtasks_info = [
                    {
                        "number": st.task_number,
                        "title": st.title,
                        "status": st.status,
                        "completed": st.is_completed,
                    }
                    for st in task.subtasks
                ]

                task_info = {
                    "id": task.id,
                    "number": task.task_number,
                    "title": task.title,
                    "description": task.description,
                    "status": task.status,
                    "completed": task.is_completed,
                    "dependencies": task.dependencies,
                    "linked_requirements": task.linked_requirements,
                    "estimated_hours": task.estimated_hours,
                    "actual_hours": task.actual_hours,
                    "subtasks": subtasks_info,
                }

                if task.is_completed:
                    completed_tasks.append(task_info)
                elif task.status == "in_progress":
                    in_progress_tasks.append(task_info)
                else:
                    pending_tasks.append(task_info)

            return {
                "status": "success",
                "spec_id": spec_id,
                "summary": stats,
                "tasks": {
                    "completed": completed_tasks,
                    "in_progress": in_progress_tasks,
                    "pending": pending_tasks,
                },
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Error getting status summary: {str(e)}",
            }

    @mcp.tool()
    async def bulk_check_tasks(
        spec_id: str,
        task_numbers: List[str] | None = None,
        all_tasks: bool = False,
        ctx: Context = None,
    ) -> Dict[str, Any]:
        """
        Mark multiple tasks as completed.
        Requires either an explicit list of task_numbers or all_tasks=True.

        Args:
            spec_id: The specification identifier
            task_numbers: List like ["1", "2.1", "3.2.1"]
            all_tasks: If True, completes all tasks in the spec
        """
        if spec_id not in spec_manager.specs:
            return {
                "status": "error",
                "message": f"Specification {spec_id} not found",
            }

        if not all_tasks and not task_numbers:
            return {
                "status": "error",
                "message": (
                    "You must specify which tasks to complete (task_numbers) "
                    "or set all_tasks=true."
                ),
            }

        completed: List[str] = []
        errors: List[str] = []

        try:
            if all_tasks:
                # Complete all tasks in hierarchical plan
                spec = spec_manager.specs[spec_id]
                for task in spec_manager._flatten_tasks(spec.tasks):
                    # Use task.task_number to ensure hierarchical mapping
                    if not task.is_completed:
                        ok = spec_manager.check_task(
                            spec_id, task.task_number
                        )
                        if ok:
                            completed.append(task.task_number)
                        else:
                            errors.append(task.task_number)
            else:
                # Complete only specified tasks
                for number in task_numbers:
                    t = spec_manager.get_task_by_number(spec_id, number)
                    if not t:
                        errors.append(number)
                        continue
                    if t.is_completed:
                        completed.append(number)  # already done, treat as success
                        continue
                    ok = spec_manager.check_task(spec_id, number)
                    if ok:
                        completed.append(number)
                    else:
                        errors.append(number)

            stats = spec_manager.get_completion_stats(spec_id)

            if ctx:
                await ctx.info(f"Completed {len(completed)} tasks")

            status = "success" if not errors else ("partial" if completed else "error")
            msg = f"Completed {len(completed)} tasks" + (
                f", {len(errors)} failed" if errors else ""
            )
            return {
                "status": status,
                "spec_id": spec_id,
                "completed": completed,
                "failed": errors,
                "progress": f"{stats['completion_percentage']}%",
                "stats": stats,
                "message": msg,
            }
        except Exception as e:
            return {
                "status": "error",
                "message": f"Error bulk checking tasks: {str(e)}",
            }
