# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SpecForge is a Model Context Protocol (MCP) server that implements specification-driven development with EARS (Easy Approach to Requirements Syntax) notation, intelligent mode classification, and structured workflow management. The system automatically routes user requests to appropriate handlers and enforces a structured development workflow.

## Architecture

### Core Components

- **src/models/**: Data models and enums
  - `core.py`: Core data classes (Specification, UserStory, Task, etc.)
  - Enums: UserMode, WorkflowPhase, SpecStatus
  
- **src/core/**: Core business logic
  - `classifier.py`: ModeClassifier for intent classification
  - `spec_manager.py`: SpecificationManager for workflow and file operations

- **src/tools/**: MCP tool implementations
  - `classification.py`: Mode classification tools
  - `specifications.py`: Spec creation and management tools
  - `workflow.py`: Task and workflow management tools

- **src/**: Supporting modules
  - `resources.py`: MCP resource handlers for file access
  - `prompts.py`: MCP prompt definitions
  - `server.py`: Main server factory and configuration

### Entry Points

- **`main.py`**: Local CLI execution (standard MCP server)
- **`main_http.py`**: HTTP server for cloud deployment scenarios

### Workflow Phases

SpecForge enforces a structured development workflow:
1. **Requirements**: Define user stories with EARS acceptance criteria
2. **Design**: Technical architecture and component design
3. **Implementation Planning**: Break down into discrete tasks
4. **Execution**: Track task completion
5. **Review**: Quality assurance
6. **Completed**: Final state

## Development Commands

### Local Development
```bash
# Install dependencies
pip install -r requirements.txt

# Run local MCP server
python main.py

# Run HTTP server (for testing cloud deployment)
python main_http.py

# Using development helper script
python scripts/dev.py install    # Install dependencies
python scripts/dev.py serve      # Run MCP server  
python scripts/dev.py serve-http # Run HTTP server
python scripts/dev.py test       # Run tests
python scripts/dev.py lint       # Run linting
python scripts/dev.py format     # Format code
python scripts/dev.py type-check # Run MyPy
python scripts/dev.py all        # Run all checks
```

### Testing
```bash
# Run all tests
pytest

# Run specific test file
pytest tests/test_classifier.py

# Run with coverage
pytest --cov=src

# Run with verbose output
pytest -v
```

### Code Quality
```bash
# Format code
black src/ tests/ main.py main_http.py

# Lint code  
flake8 src/ tests/

# Type checking
mypy src/

# Check formatting without changes
black --check src/ tests/
```

## HTTP Deployment

### Configuration Files
- **`Dockerfile`**: Multi-stage build with Python + uv for containerized deployment
- **`pyproject.toml`**: Python project configuration with dependencies

### Notes
HTTP deployment is available but not recommended for development work since it cannot write to local project files. For specification-driven development, use local installation methods (pipx, manual, or Docker with bind mounts).

## MCP Tools Reference

### Mode Classification
- `classify_mode(user_input)`: Determine user intent (chat/do/spec modes)

### Specification Management  
- `create_spec(name, description)`: Create new specification
- `list_specifications()`: List all specs with status
- `get_specification_details(spec_id, include_content)`: Get detailed spec info

### Requirements & Design
- `add_requirement(spec_id, as_a, i_want, so_that, ears_requirements)`: Add user story with EARS criteria
- `update_design(spec_id, architecture, components, data_models, sequence_diagrams)`: Update technical design

### Implementation Planning (NEW)
- `generate_implementation_plan(spec_id)`: Create comprehensive task hierarchy from requirements/design
- `update_implementation_plan(spec_id)`: Refresh plan when requirements change (preserves completion status)
- `get_task_status_summary(spec_id)`: Complete progress overview with statistics

### Task Management (NEW - Checkbox Style)
- `check_task(spec_id, task_number)`: Mark task as completed ✅ (e.g., "1", "2.1", "3.2.1")
- `uncheck_task(spec_id, task_number)`: Mark task as pending ⬜
- `bulk_check_tasks(spec_id, task_numbers)`: Check multiple tasks at once
- `get_task_details(spec_id, task_number)`: Get detailed task information
- `get_next_available_tasks(spec_id)`: Find tasks ready to work on (dependencies met)

### Legacy Workflow Tools
- `add_implementation_task(spec_id, title, description, dependencies, subtasks, linked_requirements)`: Add individual task
- `execute_task(spec_id, task_id)`: Execute and mark task complete
- `transition_workflow_phase(spec_id, target_phase)`: Move spec to next phase

### Resources
- `spec://{spec_id}/requirements`: Access requirements.md content
- `spec://{spec_id}/design`: Access design.md content  
- `spec://{spec_id}/tasks`: Access tasks.md content (now in checkbox format)

## File Structure

Generated specifications are stored in:
```
specifications/
└── {spec-id}/
    ├── spec.json          # Specification metadata
    ├── requirements.md    # User stories & EARS criteria  
    ├── design.md         # Technical architecture
    └── tasks.md          # Implementation plan (checkbox format)
```

## Checkbox Task Format (NEW)

SpecForge now generates implementation plans in GitHub-style checkbox markdown:

```markdown
# Implementation Plan

## Progress Summary
- **Total Tasks:** 12
- **Completed:** 3
- **In Progress:** 2
- **Pending:** 7
- **Progress:** 41.7%

- [x] 1. Set up project structure
  - Create initial directories and configuration files
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
  - [ ] 2.3. Add session management
    - Session timeout handling
    - Remember me functionality
    - _Requirements: US-002-R04_

- [ ] 3. Build user management features
  - User profile management and role-based access
  - _Requirements: US-003-R01_
```

### Task Numbering System
- **Main tasks**: 1, 2, 3, 4, ...
- **Subtasks**: 1.1, 1.2, 2.1, 2.2, ...  
- **Sub-subtasks**: 1.1.1, 1.1.2, 2.1.1, ...

### Smart Features
- **Auto-completion**: Parent tasks auto-check when all subtasks complete
- **Dependency tracking**: Tasks ordered by logical dependencies  
- **Requirement traceability**: Each task links to specific EARS requirements
- **Progress stats**: Real-time completion percentages
- **Status preservation**: Plan updates preserve completion status

## EARS Notation

The system uses EARS (Easy Approach to Requirements Syntax) for requirements:

**Format**: `[Condition] THE SYSTEM SHALL [Response]`

**Patterns**:
- `WHEN [event] THE SYSTEM SHALL [action]`
- `WHILE [state] THE SYSTEM SHALL [behavior]`  
- `WHERE [feature enabled] THE SYSTEM SHALL [capability]`
- `IF [condition] THEN THE SYSTEM SHALL [response]`

**Example**: `WHEN a user submits invalid credentials THE SYSTEM SHALL display an error message`

## Mode Classification

The ModeClassifier routes requests based on pattern matching:

- **SPEC Mode**: Creating specifications, requirements, design docs
  - Patterns: "create spec", "EARS requirements", "user story"
  
- **DO Mode**: Code changes, commands, implementation  
  - Patterns: "fix bug", "implement", "run tests", "deploy"
  
- **CHAT Mode**: Questions, explanations, help
  - Patterns: "what is", "how to", "explain", greetings

## Implementation Planning Workflow (NEW)

### 1. Generate Initial Plan
```bash
# Create comprehensive task hierarchy from requirements and design
generate_implementation_plan(spec_id)
```
- Analyzes user stories and EARS requirements
- Extracts tasks from technical design components  
- Creates hierarchical structure with dependencies
- Assigns sequential numbering (1, 1.1, 1.2, etc.)

### 2. Track Progress
```bash
# Check off completed tasks
check_task(spec_id, "1")         # Complete main task
check_task(spec_id, "2.1")       # Complete subtask
check_task(spec_id, "3.2.1")     # Complete sub-subtask

# Bulk operations
bulk_check_tasks(spec_id, ["1.1", "1.2", "2.3"])

# Get available work
get_next_available_tasks(spec_id)  # Tasks ready to work on
get_task_status_summary(spec_id)   # Complete progress overview
```

### 3. Update Plans
```bash
# Refresh plan when requirements change
update_implementation_plan(spec_id)  # Preserves completion status
```

### 4. Task Information
```bash
# Get detailed task information
get_task_details(spec_id, "2.1")
```

## Testing Architecture

- **Unit Tests**: `tests/test_*.py` for individual components
- **Test Coverage**: Focus on core logic (classifier, spec manager, models, plan generator)
- **Fixtures**: Use temporary directories for file system tests
- **Async Testing**: pytest-asyncio for MCP tool testing
- **New Test Files**: 
  - `test_enhanced_task.py`: Task model with checkbox support
  - `test_plan_generator.py`: Implementation plan generation
  - `test_checkbox_format.py`: Checkbox markdown formatting and task management

## Key Implementation Notes

- All file operations use pathlib.Path for cross-platform compatibility
- Specifications are persisted as JSON + generated Markdown files  
- Mode classification uses weighted regex patterns with confidence scoring
- Workflow phase transitions have validation rules to prevent invalid states
- HTTP server includes CORS middleware for web client compatibility
- Development script provides unified interface for common tasks