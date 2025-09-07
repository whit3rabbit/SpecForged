# SpecForged API Reference

**Version:** 0.3.1  
**Protocol:** Model Context Protocol (MCP)  
**Language:** Python 3.10+

## Overview

SpecForged is a Model Context Protocol (MCP) server that implements specification-driven development with EARS notation, intelligent mode classification, and structured workflow management. This document provides a comprehensive API reference for integrating with SpecForged.

### Supported Integration Methods

1. **MCP Protocol (stdio)** - Local development, VS Code extension
2. **HTTP/WebSocket API** - Cloud deployment, web applications
3. **VS Code Extension** - Rich IDE integration with UI components
4. **Smithery Cloud** - Managed cloud deployment

### Connection Examples

#### MCP stdio (Local)
```bash
# Install SpecForged
pipx install specforged

# Run as MCP server
specforged
```

#### HTTP Server (Cloud)
```bash
# Run HTTP server
specforged-http
# Default: http://localhost:8080
```

#### Smithery Cloud
```javascript
// Connect to Smithery-hosted server
const mcpClient = new McpClient({
  url: "https://server.smithery.ai/specforged/mcp"
});
```

---

## MCP Tools API

### 🎯 Classification Tools

#### `classify_mode`
Classify user input to determine intent (chat/do/spec modes).

**Signature:**
```python
async def classify_mode(user_input: str) -> Dict[str, Any]
```

**Parameters:**
- `user_input` (string, required): User input text to classify

**Returns:**
```json
{
  "mode": "SPEC|DO|CHAT",
  "confidence": 0.95,
  "reasoning": "Contains specification keywords: 'create spec', 'requirements'",
  "suggestions": ["create_spec", "add_requirement"]
}
```

**Example:**
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "classify_mode",
    "arguments": {
      "user_input": "I need to create a spec for user authentication with login requirements"
    }
  }
}
```

---

### 📋 Specification Management Tools

#### `create_spec`
Create a new specification with requirements, design, and tasks files.

**Signature:**
```python
async def create_spec(
    name: str, 
    description: str = "", 
    spec_id: Optional[str] = None
) -> Dict[str, Any]
```

**Parameters:**
- `name` (string, required): Descriptive name for the specification
- `description` (string, optional): Brief description of the specification's purpose
- `spec_id` (string, optional): Unique identifier. Auto-generated from name if omitted

**Returns:**
```json
{
  "spec_id": "user-auth",
  "name": "User Authentication System",
  "status": "DRAFT",
  "phase": "REQUIREMENTS",
  "files": {
    "requirements": "/path/to/.specifications/user-auth/requirements.md",
    "design": "/path/to/.specifications/user-auth/design.md",
    "tasks": "/path/to/.specifications/user-auth/tasks.md"
  },
  "message": "Specification 'User Authentication System' created with ID 'user-auth'"
}
```

**Example:**
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "create_spec",
    "arguments": {
      "name": "User Authentication System",
      "description": "Handle user login, registration, and session management",
      "spec_id": "user-auth"
    }
  }
}
```

#### `set_current_spec`
Set the active specification for subsequent commands.

**Signature:**
```python
async def set_current_spec(spec_id: str) -> Dict[str, Any]
```

**Parameters:**
- `spec_id` (string, required): The identifier of the specification to make active

**Returns:**
```json
{
  "status": "success",
  "current_spec_id": "user-auth",
  "message": "'user-auth' is now the active specification."
}
```

#### `add_requirement`
Add user story with EARS-formatted acceptance criteria.

**Signature:**
```python
async def add_requirement(
    as_a: str,
    i_want: str, 
    so_that: str,
    spec_id: Optional[str] = None,
    ears_requirements: Optional[List[Dict[str, str]]] = None
) -> Dict[str, Any]
```

**Parameters:**
- `as_a` (string, required): User role or persona
- `i_want` (string, required): Desired functionality
- `so_that` (string, required): Business value or benefit
- `spec_id` (string, optional): Specification ID. Uses current if omitted
- `ears_requirements` (array, optional): EARS-formatted acceptance criteria

**EARS Requirements Format:**
```json
[
  {
    "condition": "WHEN user enters valid credentials",
    "system_response": "redirect to dashboard"
  },
  {
    "condition": "IF login fails 3 times", 
    "system_response": "lock account for 15 minutes"
  }
]
```

**Returns:**
```json
{
  "status": "success",
  "spec_id": "user-auth",
  "story_id": "US-001",
  "message": "User story added with 2 EARS requirements",
  "phase": "REQUIREMENTS"
}
```

#### `update_design`
Update technical design documentation.

**Signature:**
```python
async def update_design(
    spec_id: Optional[str] = None,
    architecture: Optional[str] = None,
    components: Optional[List[Dict[str, str]]] = None,
    data_models: Optional[str] = None,
    sequence_diagrams: Optional[str] = None
) -> Dict[str, Any]
```

**Parameters:**
- `spec_id` (string, optional): Specification ID. Uses current if omitted
- `architecture` (string, optional): High-level architecture description
- `components` (array, optional): System components with descriptions
- `data_models` (string, optional): Data model definitions
- `sequence_diagrams` (string, optional): Sequence diagram descriptions

**Components Format:**
```json
[
  {
    "name": "AuthController",
    "description": "Handles login/logout HTTP endpoints"
  },
  {
    "name": "TokenService", 
    "description": "JWT token generation and validation"
  }
]
```

#### `list_specifications`
List all specifications with status information.

**Signature:**
```python
async def list_specifications() -> Dict[str, Any]
```

**Returns:**
```json
{
  "specifications": [
    {
      "spec_id": "user-auth",
      "name": "User Authentication System", 
      "status": "IN_PROGRESS",
      "phase": "DESIGN",
      "is_current": true,
      "user_stories": 3,
      "tasks": 12,
      "completion_percentage": 25.0
    }
  ],
  "total": 1,
  "current_spec_id": "user-auth"
}
```

#### `check_initialization_status`
Check project initialization status and provide guidance.

**Signature:**
```python
async def check_initialization_status() -> Dict[str, Any]
```

**Returns:**
```json
{
  "status": "partially_initialized",
  "specifications_folder_exists": true,
  "total_specifications": 2,
  "incomplete_specifications": [
    {
      "spec_id": "user-auth",
      "issues": ["no_design", "no_tasks"],
      "next_steps": ["update_design", "generate_implementation_plan"]
    }
  ],
  "suggestions": [
    "update_design(user-auth, ...)",
    "generate_implementation_plan(user-auth)"
  ],
  "message": "Project partially set up. Complete design phase for user-auth spec."
}
```

#### `get_specification_details`
Get detailed information about a specification.

**Signature:**
```python
async def get_specification_details(
    spec_id: str,
    include_content: bool = False
) -> Dict[str, Any]
```

**Parameters:**
- `spec_id` (string, required): Specification identifier
- `include_content` (boolean, optional): Include file contents in response

**Returns:**
```json
{
  "spec_id": "user-auth",
  "name": "User Authentication System",
  "description": "Handle user login, registration, and session management", 
  "status": "IN_PROGRESS",
  "phase": "IMPLEMENTATION",
  "user_stories": [
    {
      "id": "US-001",
      "as_a": "registered user",
      "i_want": "to log in securely",
      "so_that": "I can access my account"
    }
  ],
  "tasks_summary": {
    "total": 12,
    "completed": 3,
    "pending": 9,
    "completion_percentage": 25.0
  },
  "files": {
    "requirements": "/path/to/requirements.md",
    "design": "/path/to/design.md", 
    "tasks": "/path/to/tasks.md"
  },
  "content": {
    "requirements": "# Requirements\n...",
    "design": "# Design\n...",
    "tasks": "# Tasks\n..."
  }
}
```

---

### 📋 Planning & Task Management Tools

#### `generate_implementation_plan`
Generate comprehensive task hierarchy from requirements and design.

**Signature:**
```python
async def generate_implementation_plan(
    spec_id: Optional[str] = None
) -> Dict[str, Any]
```

**Parameters:**
- `spec_id` (string, optional): Specification ID. Uses current if omitted

**Prerequisites:**
- User stories must exist (requirements phase completed)
- design.md must exist with substantial content (>100 characters)

**Returns:**
```json
{
  "status": "success",
  "spec_id": "user-auth", 
  "tasks_created": 15,
  "message": "Implementation plan generated with 15 hierarchical tasks",
  "stats": {
    "total": 15,
    "completed": 0,
    "pending": 15,
    "completion_percentage": 0.0
  }
}
```

#### `check_task`
Mark a task as completed (check the checkbox).

**Signature:**
```python
async def check_task(
    task_number: str,
    spec_id: Optional[str] = None
) -> Dict[str, Any]
```

**Parameters:**
- `task_number` (string, required): Hierarchical task number (e.g., "1", "2.1", "3.2.1")
- `spec_id` (string, optional): Specification ID. Uses current if omitted

**Returns:**
```json
{
  "status": "success",
  "spec_id": "user-auth",
  "task_number": "1.1", 
  "task_title": "Create login form component",
  "message": "Task 1.1 marked as completed",
  "progress": 33.3,
  "auto_completed_parents": ["1"]
}
```

#### `uncheck_task`
Mark a task as pending (uncheck the checkbox).

**Signature:**
```python
async def uncheck_task(
    task_number: str,
    spec_id: Optional[str] = None  
) -> Dict[str, Any]
```

#### `bulk_check_tasks`
Check multiple tasks at once for efficiency.

**Signature:**
```python
async def bulk_check_tasks(
    task_numbers: List[str],
    spec_id: Optional[str] = None
) -> Dict[str, Any]
```

**Parameters:**
- `task_numbers` (array, required): List of task numbers to check
- `spec_id` (string, optional): Specification ID. Uses current if omitted

**Returns:**
```json
{
  "status": "success",
  "spec_id": "user-auth",
  "checked_tasks": ["1.1", "1.2", "2.1"],
  "skipped_tasks": [],
  "message": "3 tasks marked as completed", 
  "progress": 45.8
}
```

#### `get_task_details`
Get detailed information about a specific task.

**Signature:**
```python
async def get_task_details(
    task_number: str,
    spec_id: Optional[str] = None
) -> Dict[str, Any]
```

**Returns:**
```json
{
  "status": "success",
  "task_number": "1.1",
  "title": "Create login form component",
  "description": "Build responsive login UI with email/password fields",
  "is_completed": false,
  "subtasks": [
    {
      "task_number": "1.1.1", 
      "title": "Design form layout",
      "is_completed": true
    }
  ],
  "linked_requirements": ["US-001-R01", "US-001-R02"],
  "dependencies": [],
  "estimated_effort": "2 hours"
}
```

#### `get_task_status_summary`
Get comprehensive progress overview.

**Signature:**
```python
async def get_task_status_summary(
    spec_id: Optional[str] = None
) -> Dict[str, Any]
```

**Returns:**
```json
{
  "status": "success",
  "spec_id": "user-auth",
  "stats": {
    "total": 15,
    "completed": 7,
    "pending": 8,
    "completion_percentage": 46.7
  },
  "phase_progress": {
    "requirements": "completed",
    "design": "completed", 
    "implementation": "in_progress",
    "review": "pending"
  },
  "next_available_tasks": [
    {"task_number": "2.3", "title": "Add password validation"},
    {"task_number": "3.1", "title": "Implement JWT service"}
  ],
  "recent_completions": [
    {"task_number": "1.1", "title": "Create login form", "completed_at": "2024-01-15T10:30:00Z"}
  ]
}
```

#### `get_next_available_tasks`
Find tasks ready to work on (dependencies met).

**Signature:**
```python
async def get_next_available_tasks(
    spec_id: Optional[str] = None
) -> Dict[str, Any]
```

**Returns:**
```json
{
  "status": "success",
  "available_tasks": [
    {
      "task_number": "2.3",
      "title": "Add password validation",
      "description": "Client-side validation for password strength",
      "dependencies_met": true,
      "estimated_effort": "1 hour"
    }
  ],
  "blocked_tasks": [
    {
      "task_number": "3.1", 
      "title": "Deploy authentication service",
      "blocked_by": ["2.1", "2.2"],
      "blocking_reason": "Requires API endpoints to be completed"
    }
  ]
}
```

---

### ⚙️ Workflow Tools

#### `add_implementation_task`
Add individual task to implementation plan.

**Signature:**
```python
async def add_implementation_task(
    title: str,
    description: str = "",
    spec_id: Optional[str] = None,
    dependencies: List[str] = [],
    subtasks: List[Dict[str, str]] = []
) -> Dict[str, Any]
```

#### `execute_task`
Execute and mark task complete with validation.

**Signature:**
```python
async def execute_task(
    task_id: str,
    spec_id: Optional[str] = None
) -> Dict[str, Any]
```

#### `transition_workflow_phase`
Move specification to next workflow phase.

**Signature:**
```python
async def transition_workflow_phase(
    target_phase: str,
    spec_id: Optional[str] = None
) -> Dict[str, Any]
```

**Parameters:**
- `target_phase` (string, required): Target phase: "REQUIREMENTS", "DESIGN", "IMPLEMENTATION", "REVIEW", "COMPLETED"
- `spec_id` (string, optional): Specification ID. Uses current if omitted

**Phase Validation Rules:**
- REQUIREMENTS → DESIGN: Must have user stories
- DESIGN → IMPLEMENTATION: Must have design documentation 
- IMPLEMENTATION → REVIEW: Must have tasks generated
- REVIEW → COMPLETED: Must have all tasks completed

---

### 📁 Filesystem Tools

#### `read_file`
Read a UTF-8 text file within project root.

**Signature:**
```python
async def read_file(path: str) -> Dict[str, Any]
```

**Parameters:**
- `path` (string, required): Relative path from project root

**Returns:**
```json
{
  "status": "success",
  "path": "src/auth/login.py",
  "content": "def login(username, password):\n    # Implementation\n    pass",
  "size": 156,
  "encoding": "utf-8"
}
```

#### `write_file`
Write/append UTF-8 text file within project root.

**Signature:**
```python
async def write_file(
    path: str,
    content: str,
    mode: str = "write"
) -> Dict[str, Any]
```

**Parameters:**
- `path` (string, required): Relative path from project root
- `content` (string, required): File content to write
- `mode` (string, optional): "write" (default) or "append"

#### `create_directory`
Create directory within project root.

**Signature:**
```python
async def create_directory(
    path: str,
    exist_ok: bool = True
) -> Dict[str, Any]
```

#### `edit_block`
Safely replace exact text in a file.

**Signature:**
```python
async def edit_block(
    file_path: str,
    old_string: str,
    new_string: str,
    expected_replacements: int = 1
) -> Dict[str, Any]
```

---

## MCP Resources API

Resources provide access to specification file contents via URI scheme.

### Resource URIs

#### `spec://{spec_id}/requirements`
Access requirements.md content for a specification.

**Example Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "resources/read", 
  "params": {
    "uri": "spec://user-auth/requirements"
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "contents": [
      {
        "uri": "spec://user-auth/requirements",
        "mimeType": "text/markdown",
        "text": "# Requirements\n\n## User Stories\n\n### US-001: User Login\n**As a** registered user\n**I want** to log in securely\n**So that** I can access my account\n\n#### Acceptance Criteria\n- WHEN user enters valid credentials THE SYSTEM SHALL redirect to dashboard\n- IF login fails 3 times THEN THE SYSTEM SHALL lock account for 15 minutes"
      }
    ]
  }
}
```

#### `spec://{spec_id}/design`
Access design.md content for a specification.

#### `spec://{spec_id}/tasks`  
Access tasks.md content for a specification (checkbox format).

---

## MCP Prompts API

Interactive prompts guide users through specification workflows.

### Available Prompts

1. **`spec_creation_prompt`** - Guide for creating new specifications
2. **`ears_requirement_prompt`** - EARS notation explanation and examples
3. **`design_phase_prompt`** - Technical design workflow guidance
4. **`implementation_planning_prompt`** - Task generation process
5. **`task_management_prompt`** - Natural language task management
6. **`requirements_to_design_prompt`** - Phase transition guidance
7. **`design_to_planning_prompt`** - Design completion confirmation
8. **`planning_to_execution_prompt`** - Execution phase launch
9. **`execution_complete_prompt`** - Completion celebration
10. **`project_initialization_prompt`** - Project setup guidance
11. **`wizard_requirements_prompt`** - Requirements gathering wizard
12. **`wizard_design_prompt`** - Design phase wizard
13. **`wizard_planning_prompt`** - Planning phase wizard
14. **`missing_design_prompt`** - Design phase guidance
15. **`incomplete_phase_prompt`** - Phase completion guidance

**Example Request:**
```json
{
  "jsonrpc": "2.0", 
  "method": "prompts/get",
  "params": {
    "name": "ears_requirement_prompt"
  }
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "result": {
    "messages": [
      {
        "role": "assistant",
        "content": {
          "type": "text",
          "text": "EARS (Easy Approach to Requirements Syntax) notation helps create clear, testable requirements.\n\n## The 5 EARS Requirement Types:\n\n1. **Ubiquitous (Always Active)**: THE SYSTEM SHALL [action]\n2. **Event-Driven**: WHEN [event] THE SYSTEM SHALL [response]\n3. **State-Driven**: WHILE [state] THE SYSTEM SHALL [behavior]\n4. **Optional Features**: WHERE [feature] THE SYSTEM SHALL [capability]\n5. **Unwanted Behavior**: IF [condition] THEN THE SYSTEM SHALL [response]"
        }
      }
    ]
  }
}
```

---

## VS Code Extension API

### Commands

#### Specification Management
- **`specforged.initialize`** - Initialize project with .specifications folder
- **`specforged.createSpec`** - Create new specification with wizard
- **`specforged.showCurrentSpec`** - Display current active specification
- **`specforged.syncSpecs`** - Manual sync with MCP server

#### File Operations  
- **`specforged.openRequirements`** - Open requirements.md file
- **`specforged.openDesign`** - Open design.md file
- **`specforged.openTasks`** - Open tasks.md file

#### Task Management
- **`specforged.toggleTask`** - Toggle task completion status
- **`specforged.showProgress`** - Display progress overview
- **`specforged.nextTasks`** - Show available tasks

#### Server Management
- **`specforged.setupMcp`** - MCP server configuration wizard
- **`specforged.switchToLocal`** - Use local MCP server
- **`specforged.switchToSmithy`** - Use Smithery cloud server  
- **`specforged.switchToCustom`** - Use custom HTTP server
- **`specforged.testConnection`** - Test MCP connection

### Configuration Settings

```json
{
  "specforged.mcpServerType": "local|smithery|custom",
  "specforged.localServerPath": "specforged",
  "specforged.smitheryServerName": "specforged",
  "specforged.smitheryApiKey": "",
  "specforged.customServerUrl": "",
  "specforged.connectionTimeout": 10000,
  "specforged.autoSync": true,
  "specforged.syncInterval": 30000
}
```

### Events & Hooks

#### File System Events
```typescript
// Listen for specification file changes
vscode.workspace.onDidChangeTextDocument((event) => {
  if (event.document.uri.path.includes('.specifications')) {
    mcpSyncService.syncFileChange(event.document.uri);
  }
});
```

#### MCP Operation Events
```typescript
// Listen for MCP operation completion
mcpSyncService.onOperationComplete((operation) => {
  statusBar.updateProgress(operation.progress);
  if (operation.type === 'TASK_CHECK') {
    refreshTaskView();
  }
});
```

---

## HTTP/WebSocket API

### Base URL
- **Development:** `http://localhost:8080`
- **Smithery Cloud:** `https://server.smithery.ai/specforged`

### Authentication

#### API Key (Smithery)
```http
POST /mcp/tools/call
Authorization: Bearer your-api-key
Content-Type: application/json
```

### Endpoints

#### Health Check
```http
GET /health

Response:
{
  "status": "healthy",
  "version": "0.3.1",
  "uptime": 3600,
  "mcp_protocol_version": "2024-11-05"
}
```

#### Call MCP Tool
```http
POST /mcp/tools/call
Content-Type: application/json

{
  "tool": "create_spec",
  "arguments": {
    "name": "User Authentication System",
    "description": "Handle user login and registration",
    "spec_id": "user-auth"
  }
}

Response:
{
  "result": {
    "spec_id": "user-auth", 
    "name": "User Authentication System",
    "status": "DRAFT",
    "phase": "REQUIREMENTS"
  }
}
```

#### Get Resource
```http
GET /mcp/resources/spec/user-auth/requirements

Response:
{
  "uri": "spec://user-auth/requirements",
  "mimeType": "text/markdown",
  "content": "# Requirements\n\n## User Stories..."
}
```

#### WebSocket Connection
```javascript
const ws = new WebSocket('ws://localhost:8080/ws');

// Send MCP message
ws.send(JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "list_specifications",
    arguments: {}
  }
}));

// Receive response
ws.onmessage = (event) => {
  const response = JSON.parse(event.data);
  console.log('Specifications:', response.result);
};
```

### Error Handling

#### HTTP Status Codes
- **200** - Success
- **400** - Bad Request (invalid parameters)
- **401** - Unauthorized (missing/invalid API key) 
- **404** - Not Found (specification/task not found)
- **422** - Unprocessable Entity (validation failed)
- **500** - Internal Server Error

#### Error Response Format
```json
{
  "error": {
    "code": -32602,
    "message": "Invalid params",
    "data": {
      "details": "spec_id 'invalid-spec' not found",
      "available_specs": ["user-auth", "payment-system"]
    }
  }
}
```

---

## Integration Examples

### Python Client

```python
import json
import subprocess
from typing import Dict, Any

class SpecForgedClient:
    def __init__(self, server_path: str = "specforged"):
        self.server_path = server_path
        
    def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """Call MCP tool via stdio."""
        message = {
            "jsonrpc": "2.0", 
            "id": 1,
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments}
        }
        
        process = subprocess.Popen(
            [self.server_path],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            text=True
        )
        
        stdout, _ = process.communicate(json.dumps(message))
        return json.loads(stdout)
    
    def create_specification(self, name: str, description: str = "") -> Dict[str, Any]:
        """Create a new specification."""
        return self.call_tool("create_spec", {
            "name": name,
            "description": description
        })
    
    def add_user_story(self, as_a: str, i_want: str, so_that: str) -> Dict[str, Any]:
        """Add user story to current specification."""
        return self.call_tool("add_requirement", {
            "as_a": as_a,
            "i_want": i_want, 
            "so_that": so_that
        })

# Usage
client = SpecForgedClient()

# Create specification
result = client.create_specification(
    name="E-commerce Cart",
    description="Shopping cart functionality for online store"
)
print(f"Created spec: {result['spec_id']}")

# Add user story  
story = client.add_user_story(
    as_a="shopper",
    i_want="to add items to my cart",
    so_that="I can purchase multiple products at once"
)
print(f"Added story: {story['story_id']}")
```

### JavaScript/TypeScript Client

```typescript
import { spawn } from 'child_process';

interface McpMessage {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: any;
}

interface McpResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: any;
}

class SpecForgedClient {
  private idCounter = 0;

  async callTool(name: string, arguments: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const message: McpMessage = {
        jsonrpc: '2.0',
        id: ++this.idCounter,
        method: 'tools/call',
        params: { name, arguments }
      };

      const process = spawn('specforged');
      let responseData = '';

      process.stdout.on('data', (data) => {
        responseData += data.toString();
      });

      process.on('close', () => {
        try {
          const response: McpResponse = JSON.parse(responseData);
          if (response.error) {
            reject(new Error(response.error.message));
          } else {
            resolve(response.result);
          }
        } catch (e) {
          reject(e);
        }
      });

      process.stdin.write(JSON.stringify(message));
      process.stdin.end();
    });
  }

  async createSpec(name: string, description?: string, specId?: string) {
    return this.callTool('create_spec', { name, description, spec_id: specId });
  }

  async listSpecs() {
    return this.callTool('list_specifications', {});
  }

  async checkTask(taskNumber: string, specId?: string) {
    return this.callTool('check_task', { task_number: taskNumber, spec_id: specId });
  }
}

// Usage
const client = new SpecForgedClient();

async function example() {
  // Create specification
  const spec = await client.createSpec('Mobile App', 'iOS and Android app');
  console.log('Created:', spec.spec_id);

  // List all specifications
  const specs = await client.listSpecs();
  console.log('All specs:', specs.specifications);

  // Complete a task
  const taskResult = await client.checkTask('1.1');
  console.log('Task completed:', taskResult.task_title);
}

example().catch(console.error);
```

### HTTP/REST Client

```bash
# Create specification
curl -X POST http://localhost:8080/mcp/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "create_spec",
    "arguments": {
      "name": "Payment System",
      "description": "Handle payments and billing"
    }
  }'

# Add requirement  
curl -X POST http://localhost:8080/mcp/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "add_requirement", 
    "arguments": {
      "as_a": "customer",
      "i_want": "to pay with credit card",
      "so_that": "I can complete my purchase",
      "ears_requirements": [
        {
          "condition": "WHEN payment is successful",
          "system_response": "send confirmation email"
        }
      ]
    }
  }'

# Check task completion
curl -X POST http://localhost:8080/mcp/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "check_task",
    "arguments": {
      "task_number": "1.1"
    }
  }'

# Get specification details
curl -X POST http://localhost:8080/mcp/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "tool": "get_specification_details",
    "arguments": {
      "spec_id": "payment-system",
      "include_content": true
    }
  }'
```

---

## Best Practices

### 1. Specification Organization
- Use meaningful spec IDs (`user-auth`, `payment-system`, `mobile-app`)
- Group related functionality in single specifications
- Avoid overly granular specs (one spec per feature, not per function)

### 2. EARS Requirements
- Use all 5 EARS patterns for comprehensive coverage:
  - **Ubiquitous**: Always-active system behavior
  - **Event-driven**: Response to specific events  
  - **State-driven**: Behavior in specific states
  - **Optional**: Feature-conditional behavior
  - **Unwanted**: Error handling and edge cases

### 3. Task Management
- Use bulk operations for related tasks: `bulk_check_tasks(["1.1", "1.2", "1.3"])`
- Follow hierarchical numbering: `1` → `1.1, 1.2` → `1.1.1, 1.1.2`
- Check task dependencies with `get_next_available_tasks()`

### 4. Phase Workflow
- Complete each phase fully before proceeding:
  1. **Requirements**: Add comprehensive user stories with EARS criteria
  2. **Design**: Document architecture, components, data models
  3. **Planning**: Generate implementation plan from requirements/design
  4. **Execution**: Complete tasks systematically
  5. **Review**: Validate all requirements are met

### 5. Context Management
- Set current specification: `set_current_spec("user-auth")`
- Most tools accept optional `spec_id` parameter
- Use `list_specifications()` to see current context

### 6. Error Handling
- Check return status: `"status": "success|error|info"`
- Handle validation errors gracefully
- Use suggestions in error responses for next steps

### 7. Integration Patterns
- **Local Development**: Use stdio MCP protocol
- **CI/CD**: Use HTTP API for automation
- **Team Collaboration**: Use Smithery cloud deployment
- **IDE Integration**: Use VS Code extension for rich UI

---

## Rate Limits & Quotas

### Local Server (stdio)
- No rate limits
- Limited by system resources

### HTTP Server
- **Requests per minute**: 1000 (configurable)
- **Concurrent connections**: 100 (configurable)
- **Request timeout**: 30 seconds
- **Payload size**: 10MB max

### Smithery Cloud
- **Free Tier**: 1000 requests/month
- **Pro Tier**: 10,000 requests/month  
- **Enterprise**: Custom limits
- **Rate limit**: 100 requests/minute

---

## Troubleshooting

### Common Issues

#### "No specification selected"
**Problem**: Tools require active specification context.
**Solution**: Use `set_current_spec(spec_id)` or provide `spec_id` parameter.

#### "Cannot generate implementation plan"
**Problem**: Missing requirements or design documentation.
**Solution**: Complete requirements phase and add substantial design content.

#### "Task not found" 
**Problem**: Invalid task number format.
**Solution**: Use hierarchical format: `"1"`, `"1.1"`, `"2.3.1"`.

#### MCP Connection Failed
**Problem**: Server not running or wrong configuration.
**Solution**: Check server status, verify paths, test connection.

### Debug Mode

```bash
# Enable debug logging
export SPECFORGE_DEBUG=1
specforged

# HTTP server with debug
export SPECFORGE_DEBUG=1  
specforged-http --log-level debug
```

### Logging

```python
import logging
logging.getLogger('specforged').setLevel(logging.DEBUG)
```

---

## Changelog

### Version 0.3.1
- Added Smithery cloud deployment support
- Enhanced VS Code extension with multi-server support
- Improved task management with bulk operations
- Added comprehensive API documentation

### Version 0.3.0
- Multi-specification context management
- Current specification state
- Enhanced error messages with suggestions
- Improved phase validation

### Version 0.2.0
- Implementation planning with hierarchical tasks
- Checkbox-format task tracking
- EARS requirements validation
- Interactive prompts and wizards

---

## Support

- **GitHub Issues**: https://github.com/whit3rabbit/SpecForge/issues
- **Documentation**: https://github.com/whit3rabbit/SpecForge#readme  
- **PyPI**: https://pypi.org/project/specforged/
- **Smithery**: https://smithery.ai

---

*Last updated: January 2025*