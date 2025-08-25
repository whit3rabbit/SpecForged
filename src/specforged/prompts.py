"""
MCP prompts for SpecForge server.
"""

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.prompts import base


def setup_prompts(mcp: FastMCP) -> None:
    """Setup MCP prompts for guidance and help"""

    @mcp.prompt()
    def spec_creation_prompt() -> list[base.Message]:
        """Prompt for creating a new specification"""
        return [
            base.Message(
                role="assistant",
                content=base.TextContent(
                    type="text",
                    text="""I'll help you create a specification following
the SpecForge workflow.

First, I need to understand what you're building. Please provide:
1. A high-level description of the feature or system
2. The primary users who will interact with it
3. The main problem it solves

I'll then guide you through:
- **Requirements Phase**: Define user stories and EARS-formatted acceptance criteria
- **Design Phase**: Document technical architecture and implementation considerations
- **Implementation Planning**: Break down work into discrete, trackable tasks
- **Execution Phase**: Track progress as tasks are completed

Each phase will require your approval before proceeding to the next.

What would you like to create a specification for?""",
                ),
            )
        ]

    @mcp.prompt()
    def ears_requirement_prompt() -> list[base.Message]:
        """Prompt explaining EARS notation for requirements"""
        return [
            base.Message(
                role="assistant",
                content=base.TextContent(
                    type="text",
                    text="""EARS (Easy Approach to Requirements Syntax)
notation helps create clear, testable requirements.

Format: **[Condition] THE SYSTEM SHALL [Response]**

Common patterns:
- **WHEN** [event occurs] THE SYSTEM SHALL [respond with action]
- **WHILE** [system is in state] THE SYSTEM SHALL [maintain behavior]
- **WHERE** [feature is included] THE SYSTEM SHALL [provide capability]
- **IF** [condition is true] THEN THE SYSTEM SHALL [perform action]

Examples:
- WHEN a user submits invalid data THE SYSTEM SHALL display validation errors
- WHILE processing a payment THE SYSTEM SHALL show a progress indicator
- WHERE authentication is required THE SYSTEM SHALL redirect to login
- IF the user is logged in THEN THE SYSTEM SHALL display personalized content

Each requirement should be:
✓ Testable - Can write a test case for it
✓ Unambiguous - Only one interpretation
✓ Complete - All conditions specified
✓ Consistent - No contradictions

What requirements would you like to define in EARS format?""",
                ),
            )
        ]

    @mcp.prompt()
    def implementation_planning_prompt() -> list[base.Message]:
        """Prompt for creating implementation plans"""
        return [
            base.Message(
                role="assistant",
                content=base.TextContent(
                    type="text",
                    text="""I'll help you create a comprehensive
implementation plan for your specification.

## Implementation Planning Process

### 1. **Automatic Plan Generation**
Use `generate_implementation_plan(spec_id)` to create a complete task
hierarchy from your requirements and design:
- Analyzes user stories and EARS requirements
- Extracts tasks from technical design components
- Creates hierarchical task structure with dependencies
- Assigns task numbers (1, 1.1, 1.2, 2, etc.)

### 2. **Task Management**
**Check tasks as complete:**
- `check_task(spec_id, "1")` - Mark main task as done
- `check_task(spec_id, "2.1")` - Mark subtask as done
- `bulk_check_tasks(spec_id, ["1.1", "1.2", "2.1"])` - Check multiple tasks

**Task information:**
- `get_task_details(spec_id, "1.1")` - Get detailed task info
- `get_next_available_tasks(spec_id)` - Find tasks ready to work on
- `get_task_status_summary(spec_id)` - Complete progress overview

### 3. **Plan Updates**
- `update_implementation_plan(spec_id)` - Refresh plan when requirements change
- Preserves completion status of existing tasks
- Adds new tasks for updated requirements

### 4. **Task Format**
Your tasks will be generated in checkbox format:

```markdown
# Implementation Plan

- [x] 1. Set up project structure
  - Create initial directories and configuration
  - _Requirements: US-001-R01_

- [ ] 2. Implement user authentication
  - [ ] 2.1. Create login form
    - Build responsive login UI
    - Add client-side validation
    - _Requirements: US-002-R01, US-002-R02_
  - [x] 2.2. Implement authentication API
    - JWT token generation and validation
    - Password hashing and security
    - _Requirements: US-002-R03_

- [ ] 3. Add user management features
  - User profile management
  - Role-based access control
  - _Requirements: US-003-R01_
```

### 5. **Benefits**
✓ **Automatic Generation**: Tasks created from your requirements and design
✓ **Progress Tracking**: Visual checkboxes show completion status
✓ **Requirement Traceability**: Each task links to specific requirements
✓ **Dependency Management**: Tasks ordered by logical dependencies
✓ **Hierarchical Structure**: Parent/subtask relationships
✓ **Smart Updates**: Plan refreshes when requirements change

Would you like me to generate an implementation plan for your specification?""",
                ),
            )
        ]

    @mcp.prompt()
    def task_management_prompt() -> list[base.Message]:
        """Prompt for task management and completion tracking"""
        return [
            base.Message(
                role="assistant",
                content=base.TextContent(
                    type="text",
                    text="""I'll help you manage and track your
implementation tasks effectively.

## Task Management Commands

### **Checking Off Tasks**
Mark tasks as complete using their hierarchical numbers:

```
check_task(spec_id, "1")        # Complete main task 1
check_task(spec_id, "2.1")      # Complete subtask 2.1
check_task(spec_id, "3.2.1")    # Complete sub-subtask 3.2.1
```

### **Bulk Operations**
Handle multiple tasks at once:

```
bulk_check_tasks(spec_id, ["1.1", "1.2", "2.1"])  # Check multiple tasks
```

### **Task Information**
Get detailed information about tasks:

```
get_task_details(spec_id, "2.1")           # Full task details
get_next_available_tasks(spec_id)          # Tasks ready to work on
get_task_status_summary(spec_id)           # Complete progress overview
```

### **Task Numbering System**
- **Main tasks**: 1, 2, 3, 4, ...
- **Subtasks**: 1.1, 1.2, 2.1, 2.2, ...
- **Sub-subtasks**: 1.1.1, 1.1.2, 2.1.1, ...

### **Smart Status Updates**
- Parent tasks auto-complete when all subtasks are done
- Dependencies prevent checking tasks out of order
- Progress statistics update in real-time

### **Progress Tracking**
Monitor your implementation progress:
- **Total Tasks**: Count of all tasks and subtasks
- **Completion %**: Real-time progress percentage
- **Available Tasks**: Tasks ready to work on next
- **Blocked Tasks**: Tasks waiting on dependencies

### **Common Workflows**

**1. Start New Implementation:**
```
generate_implementation_plan(spec_id)
get_next_available_tasks(spec_id)
```

**2. Work on Next Task:**
```
get_next_available_tasks(spec_id)
check_task(spec_id, "task_number")
```

**3. Check Progress:**
```
get_task_status_summary(spec_id)
```

**4. Update Plan After Changes:**
```
update_implementation_plan(spec_id)
```

Which task would you like to work on next?""",
                ),
            )
        ]
