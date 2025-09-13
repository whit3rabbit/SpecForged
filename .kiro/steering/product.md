# SpecForged Product Overview

SpecForged is a Model Context Protocol (MCP) server that implements specification-driven development with EARS notation, intelligent mode classification, and structured workflow management.

## Core Purpose
Transform ad-hoc AI conversations into structured software development workflows by:
- **Classifying intent** - Routes requests to appropriate handlers (spec mode vs. action mode)
- **Enforcing workflow** - Guides through requirements → design → tasks → execution phases
- **Using EARS notation** - Creates unambiguous, testable requirements
- **Managing artifacts** - Maintains requirements.md, design.md, and tasks.md files

## Key Features
- **EARS Requirements**: All 5 patterns supported (Ubiquitous, Event-Driven, State-Driven, Optional, Error-Handling)
- **Smart Task Management**: Auto-complete parent tasks, requirement traceability, progress tracking
- **Conversational Workflow**: Interactive prompts guide each phase transition
- **Multi-Specification Context**: Manage multiple specs with current context switching
- **VSCode Extension**: Full IDE integration with tree views, commands, and MCP discovery

## Target Users
- Software developers using AI assistants (Claude, Cursor, etc.)
- Teams implementing specification-driven development
- Projects requiring structured requirement management
- Organizations adopting EARS notation standards

## Dual-Component Architecture
SpecForged consists of **two separate but complementary applications**:

### 1. Python MCP Server (`src/specforged/`)
- **Core MCP Server**: Implements the Model Context Protocol for AI assistant integration
- **CLI Tools**: Command-line interface for local development and testing
- **HTTP Server**: Web-accessible variant for cloud deployment
- **Distribution**: PyPI package (`pipx install specforged`)

### 2. VSCode Extension (`vscode-specforged/`)
- **IDE Integration**: Native VSCode tree views, commands, and UI
- **MCP Client**: Connects to and manages MCP servers
- **Enhanced Features**: Auto-discovery, configuration sync, dashboard
- **Distribution**: VSCode Marketplace as VSIX package

## Integration Points
- The VSCode extension can discover and configure the Python MCP server
- Both components work independently or together
- Extension provides enhanced UI for MCP server functionality
- Shared specification format and workflow concepts
