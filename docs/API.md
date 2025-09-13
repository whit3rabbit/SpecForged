# SpecForged MCP Server API Reference

**Version:** See `specforged.__version__` (dynamically resolved)
**Protocol:** Model Context Protocol (MCP)

## Overview

SpecForged is a Model Context Protocol (MCP) server for specification-driven development. It guides users through a structured workflow—from requirements and design to planning and execution—using a conversational or tool-based interface.

## Accessing the API

You can interact with the SpecForged server in two primary ways:

1.  **Local Server (`specforged` package):**
    Install the CLI tool, initialize your project, and run the server locally.
    ```bash
    # Install the CLI tool
    pipx install specforged

    # Initialize in your project directory
    specforged init

    # Start the server
    specforged serve
    ```

2.  **Cloud Server (Smithery):**
    Connect your MCP client to the hosted Smithery endpoint for a managed, read-only experience.

---

## MCP Tools API

### 1. Project Initialization & Status

Tools to set up, check, and manage the state of your SpecForge project.

#### `check_initialization_status()`
Checks if SpecForge is initialized in the project and provides guidance for next steps. Detects missing folders, empty projects, or incomplete specifications. **This is the recommended first command for any project.**
-   **Returns:** A dictionary with `initialized` status and a `suggestion` block with the recommended next action (e.g., run the wizard).

#### `list_specifications()`
Lists all available specifications with their current status, phase, and progress.
-   **Returns:** A dictionary containing a `specifications` list. If no specs exist, it provides a `suggestion` to start the wizard.

#### `get_specification_details(spec_id: str, include_content: bool = False)`
Gets detailed information, summary statistics, and optionally the full content for a single specification.
-   **Args:**
    -   `spec_id` (str): The ID of the specification.
    -   `include_content` (bool, optional): If `True`, includes the full content of `requirements.md`, `design.md`, and `tasks.md`. Defaults to `False`.
-   **Returns:** A detailed dictionary representing the specification.

#### `get_server_status()`
Returns a comprehensive status of the server, project, operation queue, and security settings.
-   **Returns:** A dictionary with keys like `server_status`, `project_root`, `specifications`, `operation_queue`, and `health`.

#### `get_server_health()`
Performs a simple health check on server components (queue, spec manager, filesystem).
-   **Returns:** A dictionary with an overall `health` status (`healthy`, `degraded`, `unhealthy`) and detailed `checks`.

#### `update_server_heartbeat()`
Manually triggers a server heartbeat and processes any pending operations in the queue.
-   **Returns:** A dictionary with `status` and `timestamp`.

### 2. Interactive Project Wizard

A guided, conversational experience for creating a complete specification from scratch.

#### `start_wizard_mode(project_name: str = "", description: str = "", auto_detect_folder: bool = True)`
Starts the interactive wizard to create a new project specification. This is the primary entry point for new projects.
-   **Args:**
    -   `project_name` (str, optional): The name for the new project/specification.
    -   `description` (str, optional): A brief description of the project.
    -   `auto_detect_folder` (bool, optional): If `True`, checks for existing specs and provides guidance instead of creating a new one.
-   **Returns:** A rich dictionary with `status: "wizard_active"`, the new `spec_id`, and detailed `guidance` for the first phase (requirements).

#### `wizard_next_step(spec_id: str)`
Gets contextual guidance for the next action to take within the wizard for a given specification.
-   **Args:**
    -   `spec_id` (str): The ID of the specification being created with the wizard.
-   **Returns:** A dictionary with the `current_phase`, `progress`, `next_step` to take, and `guidance`.

#### `wizard_complete_phase(spec_id: str, phase: str)`
Marks a wizard phase as complete and provides guidance for the next one.
-   **Args:**
    -   `spec_id` (str): The ID of the specification.
    -   `phase` (str): The phase to complete. Must be one of `"requirements"`, `"design"`, or `"planning"`.
-   **Returns:** A dictionary confirming the `completed_phase` and providing `guidance` for the new `current_phase`.

### 3. Specification Management

Core tools for creating and modifying a specification's content.

#### `create_spec(name: str, description: str = "", spec_id: Optional[str] = None)`
Creates a new specification with its required files and sets it as the current spec.
-   **Returns:** A dictionary with the new `spec_id`, `name`, `status`, `phase`, and paths to the created `files`.

#### `set_current_spec(spec_id: str)`
Sets the active specification context for other commands that accept an optional `spec_id`.
-   **Returns:** On success, a dictionary with `status: "success"` and the `current_spec_id`. On failure, returns an error and a list of `available_specs`.

#### `add_requirement(as_a: str, i_want: str, so_that: str, spec_id: Optional[str] = None, ears_requirements: Optional[List[Dict[str, str]]] = None)`
Adds a user story with EARS-formatted acceptance criteria.
-   **Args:**
    -   `as_a`, `i_want`, `so_that` (str): The components of the user story.
    -   `spec_id` (str, optional): Defaults to the current specification.
    -   `ears_requirements` (list, optional): A list of dictionaries, where each dict has a `condition` and `system_response` key.
-   **Returns:** A dictionary confirming the addition, including the new `story_id` and any wizard guidance.

#### `update_design(spec_id: Optional[str] = None, architecture: Optional[str] = None, components: Optional[List[Dict[str, str]]] = None, data_models: Optional[str] = None, sequence_diagrams: Optional[List[Dict[str, str]]] = None)`
Updates the technical design documentation (`design.md`).
-   **Returns:** A dictionary with `status: "success"` and a list of `updated_sections`.

### 4. Workflow & Planning

Tools for managing the specification lifecycle and task generation.

#### `transition_workflow_phase(target_phase: str, spec_id: Optional[str] = None)`
Moves a specification to a new workflow phase.
-   **Args:**
    -   `target_phase` (str): The target phase. Must be one of `requirements`, `design`, `implementation_planning`, `execution`, `review`, or `completed`.
-   **Returns:** A dictionary confirming the transition and showing the `current_phase`.

#### `generate_implementation_plan(spec_id: Optional[str] = None)`
Generates a hierarchical task list in `tasks.md` from completed requirements and design.
-   **Important:** This tool will fail if the `requirements` and `design` phases are not substantially complete.
-   **Returns:** A dictionary with `status: "success"`, the number of `tasks_created`, and completion `stats`.

#### `update_implementation_plan(spec_id: Optional[str] = None)`
Updates an existing task list based on changes to requirements or design, preserving the status of existing tasks.
-   **Returns:** A dictionary with `status: "success"`, the `total_tasks`, and completion `stats`.

#### `check_task(task_number: str, spec_id: Optional[str] = None)`
Marks a task as completed. The `task_number` is hierarchical (e.g., `"1"`, `"2.1"`).
-   **Returns:** A dictionary with `status: "success"`, the updated `progress` percentage, and completion `stats`.

#### `uncheck_task(task_number: str, spec_id: Optional[str] = None)`
Marks a task as pending.
-   **Returns:** A dictionary with `status: "success"` and updated `progress` and `stats`.

#### `bulk_check_tasks(spec_id: str, task_numbers: Optional[List[str]] = None, all_tasks: bool = False)`
Marks multiple tasks as completed. You must provide either `task_numbers` or set `all_tasks=True`.
-   **Returns:** A dictionary with `status`, lists of `completed` and `failed` task numbers, and updated `progress` and `stats`.

#### `get_next_available_tasks(spec_id: Optional[str] = None)`
Lists tasks that are ready to be worked on (i.e., their dependencies have been met).
-   **Returns:** A dictionary containing a list of `available_tasks`.

#### `get_task_details(spec_id: str, task_number: str)`
Returns detailed information for a specific task, including its description, status, and subtasks.
-   **Returns:** A dictionary with `status: "success"` and a detailed `task` object.

#### `get_task_status_summary(spec_id: str)`
Returns a summary of all tasks for a specification, grouped by status (completed, in_progress, pending).
-   **Returns:** A dictionary with a `summary` of stats and a `tasks` object containing the grouped lists.

### 5. Filesystem Tools

**Note:** All paths are validated to be within the detected project root for security.

-   `read_file(path: str)`: Reads the content of a file.
-   `write_file(path: str, content: str, mode: str = "rewrite")`: Writes or appends to a file (`mode` can be `"rewrite"` or `"append"`).
-   `create_directory(path: str, exist_ok: bool = True)`: Creates a directory recursively.
-   `edit_block(file_path: str, old_string: str, new_string: str, expected_replacements: int = 1)`: Safely replaces a specific block of text in a file. The `expected_replacements` parameter prevents accidental changes.

### 6. Classification

-   `classify_mode(user_input: str)`: Classifies user input to determine intent (`spec`, `do`, or `chat`). Returns a dictionary with confidence scores and the `primary_mode`.

---

## MCP Resources & Prompts

-   **Resources:** Access file contents directly using the `spec://` URI scheme (e.g., `spec://my-api/requirements`).
-   **Prompts:** Get detailed guidance and explanations using the `prompts/get` MCP method (e.g., `ears_requirement_prompt`, `wizard_mode_prompt`).

---

## Core Workflow Example

A typical sequence of tool calls to create a specification using the wizard:

```json
// 1. Start the wizard for a new project
{ "method": "tools/call", "params": { "name": "start_wizard_mode", "arguments": { "project_name": "E-Commerce API" } } }
// --> Returns guidance for the 'requirements' phase.

// 2. Add a user story with EARS criteria
{
  "method": "tools/call",
  "params": {
    "name": "add_requirement",
    "arguments": {
      "spec_id": "e-commerce-api",
      "as_a": "customer",
      "i_want": "to view my order history",
      "so_that": "I can track my purchases",
      "ears_requirements": [{ "condition": "WHEN I am logged in", "system_response": "show a list of my past orders" }]
    }
  }
}

// 3. Complete the requirements phase
{ "method": "tools/call", "params": { "name": "wizard_complete_phase", "arguments": { "spec_id": "e-commerce-api", "phase": "requirements" } } }
// --> Returns guidance for the 'design' phase.

// 4. Add technical design details
{
  "method": "tools/call",
  "params": {
    "name": "update_design",
    "arguments": {
      "spec_id": "e-commerce-api",
      "architecture": "A RESTful API using a layered architecture with a PostgreSQL database."
    }
  }
}

// 5. Generate the implementation plan from the completed spec
{ "method": "tools/call", "params": { "name": "generate_implementation_plan", "arguments": { "spec_id": "e-commerce-api" } } }
// --> Returns a summary of tasks created in tasks.md.

// 6. Mark the first task as complete
{ "method": "tools/call", "params": { "name": "check_task", "arguments": { "spec_id": "e-commerce-api", "task_number": "1" } } }
// --> Returns confirmation and updated progress stats.
