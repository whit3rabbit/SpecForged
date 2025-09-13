#!/usr/bin/env python3
"""
Mock MCP server for integration testing.

This script simulates a SpecForge MCP server for testing the VS Code extension
integration without requiring a full server setup.
"""

import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict


class MockMcpServer:
    """Mock MCP server that processes operations from the queue file."""

    def __init__(self, workspace_dir: str):
        self.workspace_dir = Path(workspace_dir)
        self.queue_file = self.workspace_dir / "mcp-operations.json"
        self.results_file = self.workspace_dir / "mcp-results.json"
        self.sync_file = self.workspace_dir / "specforge-sync.json"
        self.specs_dir = self.workspace_dir / "specifications"

        # Configuration
        self.processing_delay = 0.1  # seconds
        self.failure_rate = 0.0  # 0.0 - 1.0
        self.is_running = False

        # Ensure directories exist
        self.specs_dir.mkdir(exist_ok=True)

    async def start(self) -> None:
        """Start the mock server."""
        self.is_running = True
        print(f"Mock MCP server started in {self.workspace_dir}")

        # Create initial sync state
        await self.update_sync_state(server_online=True)

        # Start processing loop
        while self.is_running:
            try:
                await self.process_operations()
                await asyncio.sleep(self.processing_delay)
            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"Error in processing loop: {e}")
                await asyncio.sleep(1)

        print("Mock MCP server stopped")

    async def process_operations(self) -> None:
        """Process operations from the queue file."""
        if not self.queue_file.exists():
            return

        try:
            # Read operation queue
            with open(self.queue_file, "r") as f:
                queue_data = json.load(f)

            operations = queue_data.get("operations", [])
            pending_ops = [op for op in operations if op.get("status") == "pending"]

            if not pending_ops:
                return

            # Process one operation at a time
            operation = pending_ops[0]
            await self.process_single_operation(operation, queue_data)

        except (json.JSONDecodeError, FileNotFoundError):
            # Queue file doesn't exist or is invalid
            pass
        except Exception as e:
            print(f"Error processing operations: {e}")

    async def process_single_operation(
        self, operation: Dict[str, Any], queue_data: Dict[str, Any]
    ) -> None:
        """Process a single operation."""
        op_id = operation["id"]
        op_type = operation["type"]
        params = operation.get("params", {})

        print(f"Processing operation: {op_type} ({op_id})")

        # Update operation status to in_progress
        operation["status"] = "in_progress"
        operation["startedAt"] = datetime.now(timezone.utc).isoformat()

        # Save updated queue
        await self.save_queue(queue_data)

        # Simulate processing time
        await asyncio.sleep(self.processing_delay)

        # Determine if operation should fail
        import random

        should_fail = random.random() < self.failure_rate

        # Process operation based on type
        result = await self.handle_operation(op_type, params, should_fail)

        # Update operation with result
        operation["status"] = "completed" if result["success"] else "failed"
        operation["completedAt"] = datetime.now(timezone.utc).isoformat()
        operation["actualDurationMs"] = int(self.processing_delay * 1000)

        if not result["success"]:
            operation["error"] = result.get("message", "Operation failed")
            operation["retryCount"] = operation.get("retryCount", 0) + 1

        # Save final queue state
        await self.save_queue(queue_data)

        # Save operation result
        await self.save_operation_result(
            {
                "operationId": op_id,
                "success": result["success"],
                "message": result["message"],
                "data": result.get("data"),
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "processingTimeMs": int(self.processing_delay * 1000),
                "retryable": not result["success"],
            }
        )

        # Update sync state
        await self.update_sync_state(server_online=True)

    async def handle_operation(
        self, op_type: str, params: Dict[str, Any], should_fail: bool
    ) -> Dict[str, Any]:
        """Handle specific operation types."""
        if should_fail:
            return {"success": False, "message": f"Mock failure for {op_type}"}

        try:
            if op_type == "create_spec":
                return await self.handle_create_spec(params)
            elif op_type == "update_requirements":
                return await self.handle_update_requirements(params)
            elif op_type == "update_design":
                return await self.handle_update_design(params)
            elif op_type == "update_tasks":
                return await self.handle_update_tasks(params)
            elif op_type == "add_user_story":
                return await self.handle_add_user_story(params)
            elif op_type == "heartbeat":
                return await self.handle_heartbeat(params)
            else:
                return {
                    "success": False,
                    "message": f"Unknown operation type: {op_type}",
                }
        except Exception as e:
            return {
                "success": False,
                "message": f"Error handling {op_type}: {str(e)}",
            }

    async def handle_create_spec(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle create_spec operation."""
        name = params.get("name", "")
        spec_id = params.get("specId", "")
        description = params.get("description", "")

        if not name or not spec_id:
            return {
                "success": False,
                "message": "Missing required parameters: name and specId",
            }

        # Create specification directory
        spec_dir = self.specs_dir / spec_id
        spec_dir.mkdir(exist_ok=True)

        # Create spec.json
        spec_data = {
            "id": spec_id,
            "name": name,
            "description": description,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "workflow_phase": "requirements",
        }

        with open(spec_dir / "spec.json", "w") as f:
            json.dump(spec_data, f, indent=2)

        # Create default files
        await self.create_default_spec_files(spec_dir, name)

        return {
            "success": True,
            "message": f"Specification '{name}' created successfully",
            "data": {
                "specId": spec_id,
                "name": name,
                "filesCreated": [
                    "spec.json",
                    "requirements.md",
                    "design.md",
                    "tasks.md",
                ],
            },
        }

    async def handle_update_requirements(
        self, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Handle update_requirements operation."""
        spec_id = params.get("specId", "")
        content = params.get("content", "")

        if not spec_id:
            return {
                "success": False,
                "message": "Missing required parameter: specId",
            }

        spec_dir = self.specs_dir / spec_id
        if not spec_dir.exists():
            return {
                "success": False,
                "message": f"Specification {spec_id} not found",
            }

        # Update requirements.md
        requirements_file = spec_dir / "requirements.md"
        with open(requirements_file, "w") as f:
            f.write(content)

        return {
            "success": True,
            "message": f"Requirements updated for specification {spec_id}",
            "data": {"specId": spec_id, "fileUpdated": "requirements.md"},
        }

    async def handle_update_design(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle update_design operation."""
        spec_id = params.get("specId", "")
        content = params.get("content", "")

        if not spec_id:
            return {
                "success": False,
                "message": "Missing required parameter: specId",
            }

        spec_dir = self.specs_dir / spec_id
        if not spec_dir.exists():
            return {
                "success": False,
                "message": f"Specification {spec_id} not found",
            }

        # Update design.md
        design_file = spec_dir / "design.md"
        with open(design_file, "w") as f:
            f.write(content)

        return {
            "success": True,
            "message": f"Design updated for specification {spec_id}",
            "data": {"specId": spec_id, "fileUpdated": "design.md"},
        }

    async def handle_update_tasks(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle update_tasks operation."""
        spec_id = params.get("specId", "")
        content = params.get("content", "")

        if not spec_id:
            return {
                "success": False,
                "message": "Missing required parameter: specId",
            }

        spec_dir = self.specs_dir / spec_id
        if not spec_dir.exists():
            return {
                "success": False,
                "message": f"Specification {spec_id} not found",
            }

        # Update tasks.md
        tasks_file = spec_dir / "tasks.md"
        with open(tasks_file, "w") as f:
            f.write(content)

        return {
            "success": True,
            "message": f"Tasks updated for specification {spec_id}",
            "data": {"specId": spec_id, "fileUpdated": "tasks.md"},
        }

    async def handle_add_user_story(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle add_user_story operation."""
        spec_id = params.get("specId", "")
        user_story = params.get("userStory", {})

        if not spec_id or not user_story:
            return {
                "success": False,
                "message": "Missing required parameters: specId and userStory",
            }

        spec_dir = self.specs_dir / spec_id
        if not spec_dir.exists():
            return {
                "success": False,
                "message": f"Specification {spec_id} not found",
            }

        # Append user story to requirements.md
        requirements_file = spec_dir / "requirements.md"
        user_story_text = f"""
## User Story
**As a** {user_story.get('as_a', '')}
**I want** {user_story.get('i_want', '')}
**So that** {user_story.get('so_that', '')}

"""

        if requirements_file.exists():
            with open(requirements_file, "a") as f:
                f.write(user_story_text)
        else:
            with open(requirements_file, "w") as f:
                f.write(f"# Requirements\n{user_story_text}")

        return {
            "success": True,
            "message": f"User story added to specification {spec_id}",
            "data": {"specId": spec_id, "userStory": user_story},
        }

    async def handle_heartbeat(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle heartbeat operation."""
        return {
            "success": True,
            "message": "Heartbeat received",
            "data": {
                "serverOnline": True,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            },
        }

    async def create_default_spec_files(self, spec_dir: Path, name: str) -> None:
        """Create default specification files."""
        # requirements.md
        requirements_content = f"""# Requirements for {name}

## Overview
This specification defines the requirements for {name}.

## User Stories
<!-- Add user stories here -->

## Acceptance Criteria
<!-- Add acceptance criteria here -->
"""

        # design.md
        design_content = f"""# Design for {name}

## Architecture Overview
This document describes the technical design for {name}.

## Components
<!-- Add component descriptions here -->

## Data Models
<!-- Add data model definitions here -->
"""

        # tasks.md
        tasks_content = f"""# Implementation Plan for {name}

## Progress Summary
- **Total Tasks:** 0
- **Completed:** 0
- **Pending:** 0
- **Progress:** 0%

<!-- Add tasks here -->
"""

        with open(spec_dir / "requirements.md", "w") as f:
            f.write(requirements_content)

        with open(spec_dir / "design.md", "w") as f:
            f.write(design_content)

        with open(spec_dir / "tasks.md", "w") as f:
            f.write(tasks_content)

    async def save_queue(self, queue_data: Dict[str, Any]) -> None:
        """Save operation queue to file."""
        with open(self.queue_file, "w") as f:
            json.dump(queue_data, f, indent=2)

    async def save_operation_result(self, result: Dict[str, Any]) -> None:
        """Save operation result to results file."""
        results = []

        if self.results_file.exists():
            try:
                with open(self.results_file, "r") as f:
                    results_data = json.load(f)
                    results = results_data.get("results", [])
            except (json.JSONDecodeError, FileNotFoundError):
                pass

        results.append(result)

        # Keep only last 100 results
        if len(results) > 100:
            results = results[-100:]

        results_data = {
            "results": results,
            "lastUpdated": datetime.now(timezone.utc).isoformat(),
        }

        with open(self.results_file, "w") as f:
            json.dump(results_data, f, indent=2)

    async def update_sync_state(self, server_online: bool = True) -> None:
        """Update sync state file."""
        sync_state = {
            "extensionOnline": True,
            "mcpServerOnline": server_online,
            "lastSync": datetime.now(timezone.utc).isoformat(),
            "lastHeartbeat": datetime.now(timezone.utc).isoformat(),
            "pendingOperations": 0,
            "inProgressOperations": 0,
            "failedOperations": 0,
            "completedOperations": 0,
            "activeConflicts": 0,
            "specifications": [],
            "syncErrors": [],
            "performance": {
                "averageOperationTimeMs": int(self.processing_delay * 1000),
                "lastProcessingDuration": int(self.processing_delay * 1000),
                "queueProcessingRate": (
                    1.0 / self.processing_delay if self.processing_delay > 0 else 0
                ),
            },
        }

        # Count specifications
        if self.specs_dir.exists():
            spec_dirs = [d for d in self.specs_dir.iterdir() if d.is_dir()]
            sync_state["specifications"] = [
                {
                    "specId": spec_dir.name,
                    "lastModified": datetime.now(timezone.utc).isoformat(),
                    "version": 1,
                    "status": "active",
                }
                for spec_dir in spec_dirs
            ]

        with open(self.sync_file, "w") as f:
            json.dump(sync_state, f, indent=2)

    def stop(self) -> None:
        """Stop the mock server."""
        self.is_running = False


async def main() -> None:
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage: python mock-mcp-server.py <workspace_dir>")
        sys.exit(1)

    workspace_dir = sys.argv[1]
    server = MockMcpServer(workspace_dir)

    try:
        await server.start()
    except KeyboardInterrupt:
        print("\nReceived interrupt signal")
    finally:
        server.stop()


if __name__ == "__main__":
    asyncio.run(main())
