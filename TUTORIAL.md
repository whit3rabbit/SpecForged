# SpecForged Tutorial: Complete Guide to Multi-Specification Development

Welcome to the comprehensive SpecForged tutorial! This guide will walk you through everything from basic concepts to advanced multi-specification workflows.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Core Concepts](#core-concepts)
3. [Single Specification Workflow](#single-specification-workflow)
4. [Multi-Specification Management](#multi-specification-management)
5. [EARS Requirements Deep Dive](#ears-requirements-deep-dive)
6. [Task Management & Progress Tracking](#task-management--progress-tracking)
7. [Advanced Workflows](#advanced-workflows)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)

## Getting Started

### Prerequisites

```bash
# Install SpecForged
pipx install specforged

# Verify installation
specforged --version
```

### Setup with Claude Code (Recommended)

```bash
# Add to Claude Code with project scope
claude mcp add --scope=project specforged specforged
```

### Your First Specification

Let's create your first specification. Simply start a conversation:

```
You: "Use specforged to create a spec for a simple blog system"

Claude: I'll start the specforged wizard to create a comprehensive specification for your blog system.

📝 Phase 1/3: Requirements Gathering
Let's define who will use this blog system and what they need to accomplish...
```

## Core Concepts

### 1. Specifications as Project Components

Think of specifications as **workstreams** within your project:
- **Frontend Spec**: UI components, user experience
- **Backend API Spec**: Server logic, data handling
- **Database Spec**: Schema design, migrations
- **Auth Spec**: User authentication and authorization

### 2. Current Specification Context

SpecForged introduces a "current working specification" concept, similar to a current working directory:

```python
# Create multiple specs
create_spec(name="Frontend Development", spec_id="frontend")
create_spec(name="Backend API", spec_id="api")
create_spec(name="Database Design", spec_id="database")

# Switch context (like 'cd' command)
set_current_spec(spec_id="frontend")

# Work without repeating spec_id
add_requirement(as_a="user", i_want="responsive design", so_that="I can use the app on mobile")
update_design(architecture="React + TypeScript")
generate_implementation_plan()
```

### 3. The Three-Phase Workflow

Each specification follows a structured workflow:

1. **Requirements Phase**: Define user stories with EARS acceptance criteria
2. **Design Phase**: Document technical architecture and components
3. **Planning Phase**: Generate hierarchical implementation tasks

### 4. File Structure Per Specification

```
.specifications/
├── frontend/
│   ├── spec.json          # Metadata and status
│   ├── requirements.md    # User stories + EARS criteria
│   ├── design.md         # Architecture decisions
│   └── tasks.md          # Checkbox implementation plan
├── api/
│   ├── spec.json
│   ├── requirements.md
│   ├── design.md
│   └── tasks.md
└── database/
    ├── spec.json
    ├── requirements.md
    ├── design.md
    └── tasks.md
```

## Single Specification Workflow

Let's walk through creating a complete specification for a task management system.

### Step 1: Create the Specification

```python
# Method 1: Use the wizard (recommended for beginners)
"Use specforged to create a task management system"

# Method 2: Create directly with custom ID
create_spec(
    name="Task Management System",
    description="A collaborative task management application",
    spec_id="taskman"
)
```

### Step 2: Define Requirements (User Stories + EARS)

```python
# Add user stories with EARS acceptance criteria
add_requirement(
    as_a="project manager",
    i_want="to create and assign tasks to team members",
    so_that="I can track project progress effectively",
    ears_requirements=[
        {
            "condition": "WHEN a task is created with valid details",
            "system_response": "save the task and notify assignee"
        },
        {
            "condition": "WHEN a task is assigned to a user",
            "system_response": "send notification and update user's task list"
        },
        {
            "condition": "IF task creation fails due to missing required fields",
            "system_response": "display validation errors and retain entered data"
        }
    ]
)

add_requirement(
    as_a="team member",
    i_want="to mark tasks as complete and add comments",
    so_that="I can communicate progress and blockers",
    ears_requirements=[
        {
            "condition": "WHEN a task is marked complete",
            "system_response": "update status and log completion time"
        },
        {
            "condition": "WHILE a task is in progress",
            "system_response": "allow adding comments and time tracking"
        }
    ]
)
```

### Step 3: Design the Architecture

```python
update_design(
    architecture="""
    # System Architecture

    **Pattern**: Model-View-Controller (MVC) with Repository pattern
    **Frontend**: React with TypeScript
    **Backend**: Node.js with Express
    **Database**: PostgreSQL with Prisma ORM
    **Authentication**: JWT with refresh tokens
    """,
    components=[
        {
            "name": "TaskController",
            "description": "Handles task CRUD operations, assignment, and status updates"
        },
        {
            "name": "UserService",
            "description": "Manages user authentication, profiles, and permissions"
        },
        {
            "name": "NotificationService",
            "description": "Sends real-time notifications for task assignments and updates"
        },
        {
            "name": "TaskRepository",
            "description": "Database abstraction layer for task persistence"
        }
    ],
    data_models="""
    interface Task {
      id: string;
      title: string;
      description: string;
      status: 'pending' | 'in-progress' | 'completed';
      assigneeId: string;
      createdBy: string;
      createdAt: Date;
      updatedAt: Date;
      dueDate?: Date;
      comments: Comment[];
    }

    interface User {
      id: string;
      email: string;
      name: string;
      role: 'admin' | 'manager' | 'member';
      assignedTasks: Task[];
    }

    interface Comment {
      id: string;
      taskId: string;
      userId: string;
      content: string;
      createdAt: Date;
    }
    """,
    sequence_diagrams=[
        {
            "title": "Task Creation Flow",
            "content": """
            sequenceDiagram
                User->>Frontend: Create task form
                Frontend->>TaskController: POST /tasks
                TaskController->>TaskRepository: save(task)
                TaskRepository->>Database: INSERT task
                TaskController->>NotificationService: notifyAssignee(task)
                NotificationService->>Assignee: Email/Push notification
                TaskController-->>Frontend: Success response
                Frontend-->>User: Task created confirmation
            """
        }
    ]
)
```

### Step 4: Generate Implementation Plan

```python
# Generate hierarchical task breakdown
generate_implementation_plan()

# Check what was generated
get_task_status_summary()
```

### Step 5: Execute Tasks

```python
# See what tasks are ready to work on
get_next_available_tasks()

# Start working on tasks
check_task(task_number="1")      # Complete task 1
check_task(task_number="2.1")    # Complete subtask 2.1

# Check progress
get_task_status_summary()

# Complete multiple tasks at once
bulk_check_tasks(task_numbers=["2.2", "2.3", "3.1"])
```

## Multi-Specification Management

For complex projects, you'll want to manage multiple specifications. Here's a real-world example of building an e-commerce platform.

### Project Setup: E-commerce Platform

```python
# Create multiple specifications for different aspects
create_spec(name="User Interface", spec_id="ui")
create_spec(name="Product Catalog API", spec_id="catalog")
create_spec(name="Payment Processing", spec_id="payments")
create_spec(name="Order Management", spec_id="orders")
create_spec(name="User Authentication", spec_id="auth")

# List all specs to see current context
list_specifications()
# Output shows: ui, catalog, payments, orders, auth (auth is current)
```

### Working on Authentication Spec

```python
# auth is already current, so no need to switch
add_requirement(
    as_a="new user",
    i_want="to register with email and password",
    so_that="I can create an account and make purchases"
)

add_requirement(
    as_a="registered user",
    i_want="to login securely",
    so_that="I can access my account and order history"
)

update_design(
    architecture="JWT-based authentication with refresh tokens",
    components=[
        {"name": "AuthController", "description": "Handles login/register endpoints"},
        {"name": "TokenService", "description": "Manages JWT creation and validation"},
        {"name": "UserRepository", "description": "User data persistence"}
    ]
)

generate_implementation_plan()
```

### Switching to UI Spec

```python
# Switch to UI specification
set_current_spec(spec_id="ui")

# Now work on UI requirements
add_requirement(
    as_a="customer",
    i_want="a responsive product browsing interface",
    so_that="I can shop on desktop and mobile devices"
)

update_design(
    architecture="React with Material-UI components",
    components=[
        {"name": "ProductGrid", "description": "Responsive product listing component"},
        {"name": "SearchBar", "description": "Product search with filters"},
        {"name": "ProductCard", "description": "Individual product display component"}
    ]
)

generate_implementation_plan()
```

### Cross-Specification Coordination

```python
# Work on different specs as needed
set_current_spec(spec_id="payments")
check_task(task_number="1.1")  # Complete payment integration setup

set_current_spec(spec_id="ui")
check_task(task_number="2.3")  # Complete search bar component

set_current_spec(spec_id="orders")
add_requirement(
    as_a="customer",
    i_want="to track my order status",
    so_that="I know when my purchase will arrive"
)

# Get overview of all specifications
list_specifications()
```

### Progress Tracking Across Specs

```python
# Check progress for specific specs
set_current_spec(spec_id="auth")
get_task_status_summary()

set_current_spec(spec_id="ui")
get_task_status_summary()

set_current_spec(spec_id="payments")
get_task_status_summary()
```

## EARS Requirements Deep Dive

EARS (Easy Approach to Requirements Syntax) provides five requirement patterns for different scenarios.

### 1. Ubiquitous Requirements (Always Active)

Use for system-wide behaviors that should always occur:

```python
add_requirement(
    as_a="system administrator",
    i_want="all user actions to be logged",
    so_that="I can audit system activity and debug issues",
    ears_requirements=[
        {
            "condition": "THE SYSTEM SHALL log every user action with timestamp and user ID",
            "system_response": "to the audit database"
        },
        {
            "condition": "THE SYSTEM SHALL validate all input data",
            "system_response": "before processing any request"
        }
    ]
)
```

### 2. Event-Driven Requirements

Use for specific triggers and responses:

```python
add_requirement(
    as_a="user",
    i_want="immediate feedback on form submission",
    so_that="I know if my data was saved successfully",
    ears_requirements=[
        {
            "condition": "WHEN a form is submitted with valid data",
            "system_response": "save the data and display success message"
        },
        {
            "condition": "WHEN a form is submitted with invalid data",
            "system_response": "highlight errors and retain user input"
        },
        {
            "condition": "WHEN a network error occurs during submission",
            "system_response": "display retry option and cache form data"
        }
    ]
)
```

### 3. State-Driven Requirements

Use for behaviors that depend on system state:

```python
add_requirement(
    as_a="user",
    i_want="appropriate interface behavior based on my login status",
    so_that="I see relevant options and data",
    ears_requirements=[
        {
            "condition": "WHILE user is logged in",
            "system_response": "display personalized dashboard and logout option"
        },
        {
            "condition": "WHILE user session is active",
            "system_response": "automatically save draft changes every 30 seconds"
        },
        {
            "condition": "WHILE processing payment",
            "system_response": "disable form submission and show progress indicator"
        }
    ]
)
```

### 4. Optional Feature Requirements

Use for conditional functionality:

```python
add_requirement(
    as_a="premium user",
    i_want="access to advanced features",
    so_that="I get value from my subscription",
    ears_requirements=[
        {
            "condition": "WHERE premium subscription is active",
            "system_response": "unlock advanced reporting and export features"
        },
        {
            "condition": "WHERE user has admin role",
            "system_response": "display user management and system configuration options"
        },
        {
            "condition": "WHERE two-factor authentication is enabled",
            "system_response": "require verification code after password entry"
        }
    ]
)
```

### 5. Unwanted Behavior Requirements

Use for error handling and edge cases:

```python
add_requirement(
    as_a="system user",
    i_want="proper handling of error conditions",
    so_that="I can recover gracefully from problems",
    ears_requirements=[
        {
            "condition": "IF user session expires during operation",
            "system_response": "save work in progress and redirect to login"
        },
        {
            "condition": "IF server becomes unavailable",
            "system_response": "queue requests and retry automatically when connection restored"
        },
        {
            "condition": "IF user attempts unauthorized action",
            "system_response": "log security event and display appropriate error message"
        }
    ]
)
```

## Task Management & Progress Tracking

SpecForged generates hierarchical task structures with automatic progress tracking.

### Understanding Task Numbers

Tasks are organized hierarchically:
- **Main tasks**: 1, 2, 3, 4, ...
- **Subtasks**: 1.1, 1.2, 2.1, 2.2, ...
- **Sub-subtasks**: 1.1.1, 1.1.2, 2.1.1, ...

### Task Completion Strategies

```python
# Complete individual tasks
check_task(task_number="1")      # Complete main task
check_task(task_number="2.1")    # Complete subtask
check_task(task_number="3.2.1")  # Complete sub-subtask

# Bulk complete related tasks
bulk_check_tasks(task_numbers=["1.1", "1.2", "1.3"])  # All subtasks of task 1

# Uncheck if you need to revert
uncheck_task(task_number="2.1")

# Check what's ready to work on (dependencies satisfied)
get_next_available_tasks()

# Get detailed task information
get_task_details(task_number="2.1")
```

### Progress Monitoring

```python
# Get comprehensive progress overview
get_task_status_summary()
# Output:
# {
#   "total_tasks": 15,
#   "completed": 8,
#   "in_progress": 2,
#   "pending": 5,
#   "completion_percentage": 53.3
# }

# List available tasks (no blocked dependencies)
get_next_available_tasks()
# Output shows tasks ready to work on with their descriptions
```

### Auto-Completion Features

SpecForged automatically:
- **Completes parent tasks** when all subtasks are done
- **Updates progress percentages** in real-time
- **Tracks requirement traceability** (which tasks fulfill which user stories)
- **Suggests next tasks** based on dependencies

## Advanced Workflows

### 1. Complex Multi-Team Project

For large projects with multiple teams:

```python
# Frontend team specs
create_spec(name="Web Application", spec_id="web")
create_spec(name="Mobile App", spec_id="mobile")
create_spec(name="Component Library", spec_id="components")

# Backend team specs
create_spec(name="User Service", spec_id="user-api")
create_spec(name="Product Service", spec_id="product-api")
create_spec(name="Order Service", spec_id="order-api")

# DevOps team specs
create_spec(name="Infrastructure", spec_id="infra")
create_spec(name="CI/CD Pipeline", spec_id="cicd")

# Data team specs
create_spec(name="Analytics Platform", spec_id="analytics")
create_spec(name="Data Pipeline", spec_id="data-pipeline")
```

### 2. Feature Flag Development

```python
# Create spec for feature flag system
create_spec(name="Feature Flags", spec_id="feature-flags")

add_requirement(
    as_a="developer",
    i_want="to toggle features without deploying code",
    so_that="I can test features safely in production",
    ears_requirements=[
        {
            "condition": "WHEN a feature flag is enabled",
            "system_response": "activate the associated feature for designated user segments"
        },
        {
            "condition": "WHERE user is in beta group",
            "system_response": "show experimental features when flags are enabled"
        }
    ]
)
```

### 3. API Versioning Strategy

```python
# Create specs for different API versions
create_spec(name="API v1 (Legacy)", spec_id="api-v1")
create_spec(name="API v2 (Current)", spec_id="api-v2")
create_spec(name="API v3 (Next)", spec_id="api-v3")

# Work on migration requirements
set_current_spec(spec_id="api-v2")
add_requirement(
    as_a="API consumer",
    i_want="backward compatibility during migration",
    so_that="I can upgrade at my own pace"
)
```

### 4. Microservices Architecture

```python
# Individual service specifications
services = ["auth", "user-profile", "product-catalog", "inventory",
           "order-management", "payment", "notification", "search"]

for service in services:
    create_spec(name=f"{service.title()} Service", spec_id=service)
    set_current_spec(spec_id=service)

    # Add common microservice requirements
    add_requirement(
        as_a="system operator",
        i_want="health monitoring and logging",
        so_that="I can maintain system reliability"
    )

    update_design(
        architecture=f"Independent microservice with REST API and event publishing",
        components=[
            {"name": f"{service}Controller", "description": "HTTP API endpoints"},
            {"name": f"{service}Service", "description": "Business logic layer"},
            {"name": f"{service}Repository", "description": "Data persistence layer"},
            {"name": f"EventPublisher", "description": "Publishes domain events"}
        ]
    )
```

## Best Practices

### 1. Specification Naming

```python
# ✅ Good: Clear, concise, memorable
create_spec(name="User Authentication", spec_id="auth")
create_spec(name="Product Catalog", spec_id="catalog")
create_spec(name="Payment Processing", spec_id="payments")

# ❌ Avoid: Long, generic, or unclear names
create_spec(name="Miscellaneous Backend Stuff", spec_id="backend-misc-v2-final")
```

### 2. Requirements Writing

```python
# ✅ Good: Specific, testable, complete
add_requirement(
    as_a="customer",
    i_want="to filter products by price range and category",
    so_that="I can quickly find items within my budget and interests",
    ears_requirements=[
        {
            "condition": "WHEN price filter is applied with valid range",
            "system_response": "display only products within specified price bounds"
        },
        {
            "condition": "WHEN multiple filters are selected",
            "system_response": "apply AND logic to show products matching all criteria"
        },
        {
            "condition": "IF no products match selected filters",
            "system_response": "display 'no results' message with suggestion to broaden search"
        }
    ]
)

# ❌ Avoid: Vague or untestable requirements
add_requirement(
    as_a="user",
    i_want="the system to work well",
    so_that="it's good"
)
```

### 3. Context Switching Strategy

```python
# ✅ Good: Logical groupings, clear context switches
set_current_spec(spec_id="frontend")
# Complete related frontend tasks
check_task(task_number="1.1")  # UI component
check_task(task_number="1.2")  # Styling
check_task(task_number="1.3")  # Responsive design

set_current_spec(spec_id="backend")
# Complete related backend tasks
check_task(task_number="2.1")  # API endpoint
check_task(task_number="2.2")  # Database schema

# ❌ Avoid: Frequent context switching without logical grouping
set_current_spec(spec_id="frontend")
check_task(task_number="1.1")
set_current_spec(spec_id="backend")
check_task(task_number="1.1")
set_current_spec(spec_id="frontend")
check_task(task_number="1.2")  # Inefficient switching
```

### 4. Progress Tracking

```python
# ✅ Good: Regular progress reviews
# Daily standup - check progress across critical specs
critical_specs = ["auth", "payments", "catalog"]
for spec_id in critical_specs:
    set_current_spec(spec_id=spec_id)
    progress = get_task_status_summary()
    print(f"{spec_id}: {progress['completion_percentage']}% complete")

# ✅ Good: Use bulk operations for related tasks
bulk_check_tasks(task_numbers=["1.1", "1.2", "1.3"])  # Complete component set

# ❌ Avoid: Checking individual tasks one by one when they're related
check_task(task_number="1.1")
check_task(task_number="1.2")
check_task(task_number="1.3")  # Could be done in bulk
```

### 5. Design Documentation

```python
# ✅ Good: Comprehensive, structured design
update_design(
    architecture="""
    # Microservices Architecture

    ## Overview
    Event-driven microservices with CQRS pattern

    ## Technology Stack
    - Runtime: Node.js 18+
    - Framework: Express.js
    - Database: PostgreSQL with Prisma
    - Message Broker: Redis
    - API Gateway: Kong
    """,
    components=[
        {
            "name": "ApiGateway",
            "description": "Handles routing, authentication, rate limiting, and load balancing"
        },
        {
            "name": "AuthService",
            "description": "JWT token management, user authentication, role-based access control"
        }
    ],
    data_models="// Complete TypeScript interfaces with validation schemas",
    sequence_diagrams=[{
        "title": "Complete User Registration Flow",
        "content": "// Detailed mermaid diagram"
    }]
)

# ❌ Avoid: Incomplete or vague design
update_design(architecture="Some web app with database")
```

## Troubleshooting

### Common Issues and Solutions

#### 1. "No specification selected" Error

**Problem**: You're trying to use tools without setting a current spec.

```python
# ❌ This fails if no current spec
add_requirement(as_a="user", i_want="something", so_that="reason")
# Error: No specification selected. Provide a spec_id or use set_current_spec().
```

**Solution**: Either set a current spec or provide spec_id explicitly.

```python
# ✅ Option 1: Set current spec
set_current_spec(spec_id="your-spec-id")
add_requirement(as_a="user", i_want="something", so_that="reason")

# ✅ Option 2: Provide spec_id explicitly
add_requirement(
    spec_id="your-spec-id",
    as_a="user",
    i_want="something",
    so_that="reason"
)
```

#### 2. Cannot Generate Implementation Plan

**Problem**: Plan generation fails with validation errors.

**Solution**: Ensure you have completed requirements and design phases.

```python
# Check what's missing
get_specification_details(spec_id="your-spec-id", include_content=True)

# Add requirements if missing
add_requirement(as_a="user", i_want="feature", so_that="benefit")

# Add design if missing or too brief
update_design(
    architecture="Clear architecture description with at least 100+ characters",
    components=[{"name": "ComponentName", "description": "What it does"}]
)

# Then try generating plan again
generate_implementation_plan()
```

#### 3. Tasks Not Showing as Complete

**Problem**: Parent tasks remain pending despite subtasks being complete.

**Solution**: SpecForged auto-completes parents when ALL subtasks are done.

```python
# Check task details to see structure
get_task_details(task_number="2")

# Ensure all subtasks are complete
get_next_available_tasks()  # Shows what's still pending

# Complete remaining subtasks
check_task(task_number="2.3")  # This might auto-complete parent task 2
```

#### 4. Context Gets Lost

**Problem**: You forget which spec is current.

**Solution**: Use list_specifications to see current context.

```python
# See which spec is active
list_specifications()
# Look for "is_current": true

# Set the one you want
set_current_spec(spec_id="the-one-you-want")
```

### Performance Tips

#### 1. Bulk Operations

```python
# ✅ Efficient: Complete related tasks together
bulk_check_tasks(task_numbers=["1.1", "1.2", "2.1", "2.2", "3.1"])

# ❌ Inefficient: Individual task completion
check_task(task_number="1.1")
check_task(task_number="1.2")
check_task(task_number="2.1")
# ... etc
```

#### 2. Logical Spec Organization

```python
# ✅ Good: Organize by domain/team boundaries
create_spec(name="Frontend UI", spec_id="ui")
create_spec(name="Backend API", spec_id="api")
create_spec(name="Database Schema", spec_id="db")

# ❌ Avoid: Too granular or overlapping specs
create_spec(name="Login Button", spec_id="login-btn")
create_spec(name="Signup Button", spec_id="signup-btn")
create_spec(name="User Buttons", spec_id="user-btns")  # Overlapping
```

### Getting Help

1. **Check Tool Status**: Use `list_specifications()` to see current state
2. **Review Requirements**: Use `get_specification_details()` for validation errors
3. **Progress Overview**: Use `get_task_status_summary()` for completion status
4. **Available Tasks**: Use `get_next_available_tasks()` to see what's ready

---

## Conclusion

SpecForged's multi-specification support enables you to manage complex projects with multiple concurrent workstreams efficiently. The current specification context feature eliminates repetitive parameters while maintaining clarity about which component you're working on.

Key takeaways:
- **Use meaningful spec IDs** for easy context switching
- **Group related work** within specifications to minimize context switching
- **Leverage bulk operations** for efficient task management
- **Follow the three-phase workflow** for each specification
- **Use EARS notation** for clear, testable requirements

Happy specifying! 🚀
