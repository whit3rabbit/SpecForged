"""
MCP prompts for specforged server.
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
the specforged workflow.

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

## The 5 EARS Requirement Types

### 1. **Ubiquitous** - Always Active
**Format:** THE SYSTEM SHALL [action/behavior]
**Example:** THE SYSTEM SHALL log all user actions for audit purposes

### 2. **Event-Driven** - Triggered by Events
**Format:** WHEN [event] THE SYSTEM SHALL [response]
**Example:** WHEN a user submits invalid data THE SYSTEM SHALL display validation errors

### 3. **State-Driven** - Active During States
**Format:** WHILE [state] THE SYSTEM SHALL [behavior]
**Example:** WHILE processing a payment THE SYSTEM SHALL show a progress indicator

### 4. **Optional Features** - Conditional Capabilities
**Format:** WHERE [feature] THE SYSTEM SHALL [capability]
**Example:** WHERE authentication is required THE SYSTEM SHALL redirect to login

### 5. **Unwanted Behavior** - Error Responses
**Format:** IF [undesired condition] THEN THE SYSTEM SHALL [response]
**Example:** IF the user is logged in THEN THE SYSTEM SHALL display personalized content

## Complete Scenario Coverage

Have you considered **all scenarios** for each user story?
- **Normal events** (WHEN...) - Expected user actions and system events
- **Continuous states** (WHILE...) - System behavior during ongoing states
- **Optional cases** (WHERE...) - Features that may be enabled/disabled
- **Error conditions** (IF...THEN...) - Handling invalid inputs and failures
- **Universal rules** (THE SYSTEM SHALL...) - Always-active constraints

## Quality Checklist

Each requirement should be:
✓ **Testable** - Can write an automated test case
✓ **Unambiguous** - Only one possible interpretation
✓ **Complete** - All conditions and responses specified
✓ **Consistent** - No contradictions with other requirements
✓ **Feasible** - Technically and practically achievable
✓ **Traceable** - Links to specific user needs/stories

## Interactive Coaching Available

If you provide a vague requirement, I can help refine it into proper EARS format.

**Example refinement:**
- Vague: "Handle login errors"
- Refined: "IF a user enters incorrect credentials THEN THE SYSTEM
  SHALL display a clear error message and offer password reset option"

What requirements would you like to define in EARS format? I can
help refine them for clarity and completeness.""",
                ),
            )
        ]

    @mcp.prompt()
    def design_phase_prompt() -> list[base.Message]:
        """Prompt for guided design phase workflow"""
        return [
            base.Message(
                role="assistant",
                content=base.TextContent(
                    type="text",
                    text="""Now that we have clear requirements, let's design the
solution.

## Design Phase Guidance

### 1. **Architecture & System Style**
What overall architecture style suits this project?
- **Layered Architecture** (MVC, MVP, MVVM) - Clear separation of concerns
- **Microservices** - Independent, scalable services
- **Client-Server** - Traditional web app structure
- **Event-Driven** - Reactive, message-based systems
- **Serverless** - Function-as-a-service architecture

What are the main components or modules, and what are their responsibilities?

### 2. **Technology Choices**
- **Frontend**: Framework preferences (React, Vue, Angular, vanilla JS)?
- **Backend**: Language and framework (Node.js, Python/Django, Java/Spring)?
- **Database**: SQL (PostgreSQL, MySQL) or NoSQL (MongoDB, Redis)?
- **APIs**: REST, GraphQL, or WebSocket requirements?
- **External integrations**: Third-party services, payment processors, etc.?

### 3. **Data Models & Schemas**
What key data entities will you need?
- User models, business objects, configuration data
- Relationships between entities
- Data validation rules and constraints
- Storage requirements and access patterns

### 4. **System Interactions**
How do components communicate?
- API endpoints and request/response patterns
- Data flow between components
- User interaction flows
- Error handling and recovery strategies

### 5. **Sequence Diagrams** (Optional)
Would a diagram help illustrate key interactions?
We can use Mermaid syntax for sequence diagrams:

```mermaid
sequenceDiagram
    User->>+Frontend: Submit form
    Frontend->>+Backend: POST /api/data
    Backend->>+Database: INSERT query
    Database-->>-Backend: Success response
    Backend-->>-Frontend: 201 Created
    Frontend-->>-User: Show success message
```

### 6. **Non-Functional Requirements**
Consider performance, security, and scalability:
- Expected user load and response times
- Security requirements and authentication
- Data privacy and compliance needs
- Scalability and deployment considerations

## Design Review Checkpoint

You can:
- **Answer these areas one by one** - Work through each section
  systematically
- **Ask for examples** - I can suggest patterns for your specific needs
- **Request best practices** - Get recommendations for technology choices
- **Iterate on decisions** - Refine architecture based on requirements

Once you're satisfied with the design, I'll compile it into a
comprehensive `design.md` document and we can proceed to
implementation planning.

What aspect of the design would you like to start with?""",
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
                    text="""Great! Now let's break down your specification into
actionable implementation tasks.

## Step 1: Generate Your Implementation Plan

Shall I generate an initial implementation plan based on your requirements
and design?

I'll analyze your:
- **User stories** and EARS requirements for functional tasks
- **Design components** and architecture for technical tasks
- **Dependencies** between tasks to create proper order
- **Requirements traceability** so each task links back to
  specific needs

The result will be a **hierarchical task breakdown** with numbered
tasks (1, 1.1, 1.2, 2, etc.) in GitHub-style checkbox format.

## Step 2: Review and Refine (After Generation)

Once generated, you can:
- **Review the task list** - Check if it makes sense and covers
  everything
- **Ask for modifications** - "Add a task for user testing" or
  "Break down task 2 further"
- **Discuss approaches** - "How should I approach task 3.1?" for implementation advice

## Step 3: Manage Tasks Naturally

You can manage your tasks conversationally:
- **"Mark task 2.1 as done"** → ✅ I'll check it off
- **"Complete tasks 1.1 and 1.2"** → ✅ I'll handle multiple at once
- **"Show me what's next"** → I'll list available tasks
- **"How's my progress?"** → I'll show completion stats

Or use direct commands if you prefer:
- `check_task(spec_id, "2.1")` - Mark specific task complete
- `get_next_available_tasks(spec_id)` - Find ready tasks
- `get_task_status_summary(spec_id)` - Progress overview

## Task Format Preview

Your plan will look like this:

```markdown
# Implementation Plan

## Progress Summary
- **Total Tasks:** 12
- **Completed:** 3 ✅
- **Pending:** 9 ⬜
- **Progress:** 25%

- [x] 1. Set up project structure
  - Create directories and config files
  - _Requirements: US-001-R01_

- [ ] 2. User authentication system
  - [ ] 2.1. Login form UI
    - _Requirements: US-002-R01_
  - [ ] 2.2. Authentication API
    - _Requirements: US-002-R02_
```

## Smart Features

✓ **Auto-completion** - Parent tasks ✅ when all subtasks complete
✓ **Real-time progress** - Statistics update as you work
✓ **Requirement links** - Every task traces to specific requirements
✓ **Flexible updates** - Plans adapt when requirements change
✓ **Natural interaction** - Talk to me like a project partner

Ready to generate your implementation plan?""",
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
                    text="""🚀 Great work! You're in the execution phase. I'm here to be
your implementation partner, tracking your progress and keeping you
motivated.

## Natural Task Management

Just talk to me naturally - I'll understand and help:

### **Completing Tasks**
- **"Mark task 2.1 as done"** → ✅ "Task 2.1 completed! 3 of 8
  tasks now done (37.5%). Next available: tasks 2.2 and 3.1"
- **"Complete task 1"** → ✅ "Excellent! Task 1 complete. That also
  completed the entire setup phase!"
- **"Check off tasks 1.1, 1.2, and 2.3"** → ✅ "All three tasks
  checked! You're making great progress - 67% complete!"

### **Getting Guidance**
- **"What should I work on next?"** → I'll show ready tasks with context
- **"How's my progress?"** → Real-time stats with encouragement
- **"Tell me about task 3.2"** → Full details and implementation tips
- **"I'm stuck on task 2.1"** → Let's discuss approaches together

### **Quick Status Checks**
- **"Show progress"** → Complete statistics and milestone updates
- **"What's left?"** → Remaining tasks prioritized by dependencies
- **"Any blockers?"** → Tasks waiting on dependencies

## Automatic Progress Updates

When you complete tasks, I'll automatically respond with:
- ✅ **Confirmation** - "Task 2.1 completed successfully!"
- 📊 **Progress update** - "Now 5 of 12 tasks complete
  (41.7%)"
- 🎯 **Next suggestions** - "Ready to work on: Task 2.2 (Login API)
  or Task 3.1 (Dashboard UI)"
- 🏆 **Milestones** - "🎉 Authentication module complete! All subtasks done."

## Smart Features Working For You

✓ **Parent auto-completion** - When you finish all subtasks,
  parent tasks automatically complete
✓ **Dependency tracking** - Can't check dependent tasks until
  prerequisites are done
✓ **Progress motivation** - Celebrate milestones and show momentum
✓ **Requirement links** - Each task shows which user needs it
  fulfills
✓ **Flexible interaction** - Command syntax OR natural conversation
  - your choice

## Task Numbering Quick Reference
- **Main tasks**: 1, 2, 3, 4...
- **Subtasks**: 1.1, 1.2, 2.1, 2.2...
- **Sub-subtasks**: 1.1.1, 1.1.2...

## Your Execution Options

**Power user commands** (if you prefer direct control):
- `check_task(spec_id, "2.1")` - Complete specific task
- `bulk_check_tasks(spec_id, ["1.1", "1.2"])` - Complete multiple
- `get_next_available_tasks(spec_id)` - Show ready tasks
- `get_task_status_summary(spec_id)` - Full progress report

**Or just talk naturally** - I'm designed to understand your
intent and help you stay focused and motivated throughout
implementation.

Ready to tackle some tasks? What would you like to work on, or
would you like me to suggest what's next?""",
                ),
            )
        ]

    @mcp.prompt()
    def execution_phase_guidance_prompt() -> list[base.Message]:
        """Prompt explaining how to properly execute tasks with context loading
        and testing"""
        return [
            base.Message(
                role="assistant",
                content=base.TextContent(
                    type="text",
                    text="""🚀 **Execution Phase Guidelines**

**CRITICAL**: Before implementing any task, you MUST:

## 1. Load Context First
**Read the specification files to understand the overall system:**
- 📖 **Read `requirements.md`** - Understand user needs and EARS acceptance criteria
- 🎨 **Read `design.md`** - Review architecture, components, and technical decisions
- ✅ **Review `tasks.md`** - See how this task fits into the overall plan

## 2. Task Implementation Process
**For each task you execute:**

### Before Implementation:
- ✅ **Context Loading** - Load and read design.md and requirements.md
- ✅ **Requirement Tracing** - Identify which user stories this task fulfills
- ✅ **Design Alignment** - Ensure implementation matches the planned architecture
- ✅ **Dependency Check** - Verify all prerequisite tasks are completed

### During Implementation:
- ✅ **Follow Design** - Implement according to the architectural decisions in design.md
- ✅ **Meet Requirements** - Ensure all relevant EARS criteria are satisfied
- ✅ **Code Quality** - Follow established patterns and conventions
- ✅ **Documentation** - Add inline comments and update relevant docs

### After Implementation:
- ✅ **Test Generation** - Create automated tests for the implemented functionality
- ✅ **Requirement Validation** - Verify EARS acceptance criteria are met
- ✅ **Integration Testing** - Ensure new code works with existing components
- ✅ **Task Completion** - Mark task as completed in tasks.md

## 3. Test Generation Requirements
**Every completed task MUST include tests:**
- **Unit Tests** - Test individual functions and components
- **Integration Tests** - Test interactions between components
- **Acceptance Tests** - Verify EARS requirements are satisfied
- **Error Handling Tests** - Test edge cases and error conditions

## 4. Example Execution Flow
```
1. execute_task("user-auth", "2.1")
   ↓
2. Load context: Read requirements.md + design.md
   ↓
3. Identify: Task 2.1 = "Create login API endpoint"
   ↓
4. Find requirements: US-001-R01, US-001-R02 (login scenarios)
   ↓
5. Follow design: Use JWT auth from AuthService component
   ↓
6. Implement: Create login endpoint following design patterns
   ↓
7. Generate tests: Unit tests + integration tests + EARS validation
   ↓
8. Mark complete: Update task 2.1 status
```

## 🚫 What NOT to Do
- ❌ **Don't implement without reading design/requirements**
- ❌ **Don't skip test generation**
- ❌ **Don't implement tasks out of dependency order**
- ❌ **Don't ignore EARS acceptance criteria**
- ❌ **Don't bypass the planned architecture**

**Remember**: The execution phase is about building what was planned,
not making new design decisions.""",
                ),
            )
        ]

    @mcp.prompt()
    def requirements_to_design_prompt() -> list[base.Message]:
        """Prompt for transitioning from requirements to design phase"""
        return [
            base.Message(
                role="assistant",
                content=base.TextContent(
                    type="text",
                    text="""✅ **Requirements Phase Complete!**

Great work defining your user stories and EARS requirements. You
now have a solid foundation that clearly describes WHAT your system
needs to do.

## Requirements Summary Review

Before moving to design, let's confirm your requirements are complete:

✓ **User stories** - Cover all major user personas and their needs
✓ **EARS requirements** - Include normal, error, optional, and
  state-driven scenarios
✓ **Acceptance criteria** - Each story has testable, unambiguous
  requirements
✓ **Traceability** - All requirements link back to user needs

## Next: Design Phase

Ready to transition to the **Design Phase**?

In this phase, we'll focus on HOW to build your system:
- **Architecture decisions** - Choose patterns and structures
- **Technology stack** - Select frameworks and tools
- **Component breakdown** - Define modules and responsibilities
- **Data models** - Design schemas and relationships
- **System interactions** - Map out communication flows

## Your Options

- **"Yes, proceed to design"** → I'll guide you through design decisions
- **"Wait, I need to refine requirements"** → We'll revisit and improve them
- **"Let me review the requirements first"** → I'll show the
  current requirements summary
- **"I want to add more user stories"** → We'll expand the requirements

The design phase is flexible - we can iterate and come back to
adjust requirements if needed during design.

Ready to start designing your solution?""",
                ),
            )
        ]

    @mcp.prompt()
    def design_to_planning_prompt() -> list[base.Message]:
        """Prompt for transitioning from design to implementation planning"""
        return [
            base.Message(
                role="assistant",
                content=base.TextContent(
                    type="text",
                    text="""🎨 **Design Phase Complete!**

Excellent! You now have a comprehensive technical design that
defines HOW your system will be built. Your architecture,
components, and technology decisions provide a clear roadmap for
implementation.

## Design Review Checkpoint

Your design includes:

✓ **System architecture** - Overall structure and patterns
✓ **Technology choices** - Frameworks, databases, APIs
✓ **Component definitions** - Modules and their responsibilities
✓ **Data models** - Schemas and relationships
✓ **Integration points** - How components communicate

## Next: Implementation Planning Phase

Ready to break this down into actionable tasks?

In **Implementation Planning**, I'll automatically generate:
- **Task hierarchy** - Main tasks with numbered subtasks (1, 1.1, 1.2, etc.)
- **Requirement traceability** - Each task linked to specific requirements
- **Dependency ordering** - Logical sequence based on prerequisites
- **Progress tracking** - Checkbox format for visual completion status

## Your Options

- **"Generate the implementation plan"** → I'll create tasks from requirements + design
- **"Let me review the design first"** → I'll show the current design summary
- **"I want to adjust the design"** → We'll refine architecture or components
- **"Skip to manual task creation"** → Add tasks individually instead

The generated plan will be comprehensive but flexible - you can
always modify, add, or reorganize tasks after generation.

Ready to generate your implementation plan and move into execution mode?""",
                ),
            )
        ]

    @mcp.prompt()
    def planning_to_execution_prompt() -> list[base.Message]:
        """Prompt for transitioning from planning to execution phase"""
        return [
            base.Message(
                role="assistant",
                content=base.TextContent(
                    type="text",
                    text="""📋 **Implementation Planning Complete!**

Perfect! Your specification now has a complete task breakdown with
clear priorities and dependencies. You're ready to start building!

## Implementation Plan Summary

Your plan includes:

✓ **Task hierarchy** - Organized main tasks and subtasks
✓ **Progress tracking** - Checkbox format for visual completion
✓ **Dependency chain** - Logical order prevents blocking issues
✓ **Requirement links** - Each task traces back to user needs
✓ **Completion stats** - Real-time progress monitoring

## Next: Execution Phase

Time to start coding! 🚀

In the **Execution Phase**, I become your implementation partner:
- **Progress tracking** - Celebrate completions and show momentum
- **Next task suggestions** - Always know what to work on
- **Natural conversation** - "Mark task 2.1 done" or "What's next?"
- **Implementation guidance** - Get unstuck with architectural advice
- **Milestone recognition** - Celebrate when modules are complete

## Your Execution Options

- **"Start with the first task"** → I'll show the highest priority task
- **"Show me what's ready to work on"** → List all available tasks
- **"I want to modify the plan first"** → Adjust tasks before starting
- **"Help me understand the task structure"** → Explain the numbering system

Remember: This is a collaborative process. Ask questions, request
guidance, and let me know when you complete tasks - I'll keep you
motivated and focused!

Ready to start implementing? What task would you like to tackle first?""",
                ),
            )
        ]

    @mcp.prompt()
    def wizard_mode_prompt() -> list[base.Message]:
        """Prompt for wizard mode activation and guidance"""
        return [
            base.Message(
                role="assistant",
                content=base.TextContent(
                    type="text",
                    text="""🧙‍♂️ **SpecForge Wizard Mode Activated!**

Welcome to the interactive project specification wizard! I'll guide you
through creating a complete specification using structured, proven
workflows.

## What the Wizard Does

### 🚀 **New Project Setup**
Creates comprehensive specifications from scratch with:
- **Guided requirements** gathering using EARS notation
- **Interactive architecture** design with best practice templates
- **Automatic task generation** from requirements and design
- **Professional output** in markdown format for team collaboration

### 🔄 **Existing Project Enhancement**
Updates and expands current specifications:
- **Requirements refinement** - Add user stories and EARS criteria
- **Design evolution** - Update architecture and components
- **Task management** - Re-generate plans when requirements change
- **Progress tracking** - Checkbox-style implementation monitoring

## Three-Phase Planning Workflow

### 📝 **Phase 1: Requirements Gathering**
**Interactive prompts help you create:**
- User stories in "As a [user], I want [goal], so that [benefit]" format
- EARS requirements covering all 5 patterns (WHEN/IF/WHILE/WHERE/SHALL)
- Complete scenario coverage (normal, error, optional, state-driven cases)
- Quality validation ensuring testable, unambiguous requirements

**Output:** `requirements.md` with structured stories and acceptance criteria

### 🎨 **Phase 2: System Design**
**Guided architecture planning includes:**
- Architecture pattern selection (MVC, microservices, layered, etc.)
- Technology stack recommendations
- Component breakdown with responsibilities
- Data model design and relationships
- Integration and communication patterns

**Output:** `design.md` with comprehensive technical specifications

### ✅ **Phase 3: Implementation Planning**
**Automatic task generation creates:**
- Hierarchical task breakdown (1, 1.1, 1.2, etc.)
- GitHub-style checkbox format for progress tracking
- Requirement traceability (every task links to user needs)
- Dependency ordering to prevent blocking issues
- Smart auto-completion of parent tasks

**Output:** `tasks.md` with implementable task checklist

## 🚫 What the Wizard Does NOT Do

**The wizard is for PLANNING only, not execution:**
- ✅ Creates specifications and task lists
- ✅ Guides through requirements and design
- ❌ Does NOT implement tasks or write code
- ❌ Does NOT execute the implementation plan
- ❌ Does NOT scaffold applications or components

**Implementation happens AFTER wizard completion** in a separate execution
phase with proper context loading and test generation.

## How to Activate Wizard Mode

### **Via CLI (Full Interactive Experience)**
```bash
# Install and run the wizard
pipx install specforged
specforged-cli new

# With templates for common project types
specforged-cli new --template web-app
specforged-cli new --template rest-api
```

### **Via MCP (Conversational Interface)**
Just use natural language with "specforged" keywords:
- **"Use specforged to create a new project specification"**
- **"Start the specforged wizard for user authentication"**
- **"Create a spec with specforged for payment processing"**
- **"Launch specforged wizard mode for my API"**

The wizard auto-activates when no `.specifications/` folder exists.

## Smart Features

✓ **Progressive disclosure** - Each phase builds on the previous
✓ **Quality coaching** - Built-in best practice guidance
✓ **Template system** - Pre-built patterns for common project types
✓ **Flexible interaction** - CLI wizard OR conversational MCP interface
✓ **Team collaboration** - Generated files work with any development workflow
✓ **Requirement traceability** - Every task traces back to user needs

## Your Options Right Now

- **"Start a new project wizard"** → Begin fresh specification creation
- **"Update an existing specification"** → Enhance current project
- **"Show me project templates"** → Browse available starting patterns
- **"Help me understand EARS notation"** → Deep dive into requirement patterns
- **"I need design guidance"** → Focus on architecture and technical decisions

Ready to create a specification that will guide your entire
development process? What project would you like to work on?""",
                ),
            )
        ]

    @mcp.prompt()
    def execution_complete_prompt() -> list[base.Message]:
        """Prompt for celebrating execution completion and next steps"""
        return [
            base.Message(
                role="assistant",
                content=base.TextContent(
                    type="text",
                    text="""🎉 **CONGRATULATIONS! Implementation Complete!** 🎉

You've successfully completed all tasks in your implementation
plan! This is a major milestone - you've gone from initial concept
to fully implemented solution.

## What You've Accomplished

✅ **Requirements** - Defined clear user stories with EARS criteria
✅ **Design** - Created comprehensive technical architecture
✅ **Implementation** - Built all planned features and functionality
✅ **Progress** - Maintained momentum with structured task management

## Next Steps: Review & Polish

Your specification workflow can continue with:

### **Quality Review Phase**
- **Code review** - Check implementation quality and standards
- **Testing** - Verify all EARS requirements are met
- **Security review** - Ensure secure implementation practices
- **Performance testing** - Validate system meets performance needs

### **Documentation & Deployment**
- **User documentation** - Create guides and help materials
- **Deployment planning** - Prepare production release strategy
- **Monitoring setup** - Implement logging and error tracking

### **Continuous Improvement**
- **User feedback** - Gather real-world usage insights
- **Requirement evolution** - Update specs based on user needs
- **Feature expansion** - Add new capabilities using the same workflow

## Your Achievement

You've demonstrated the power of **specification-driven development**:
- Structured approach from concept to completion
- Requirement traceability throughout implementation
- Consistent progress tracking and motivation
- Quality assurance built into the process

## Celebration & Reflection

Take a moment to appreciate this accomplishment! You've successfully:
- 📝 Captured clear requirements with EARS notation
- 🎨 Designed a comprehensive technical solution
- 📋 Planned implementation with detailed task breakdown
- 🚀 Executed systematically to completion

**What would you like to do next?**
- Review and deploy your implementation
- Start a new specification for additional features
- Reflect on lessons learned from this workflow
- Celebrate this milestone! 🥳""",
                ),
            )
        ]
