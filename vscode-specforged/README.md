# SpecForged VS Code Extension

A VS Code extension that integrates with the SpecForged MCP server to provide specification-driven development with EARS notation, intelligent mode classification, and structured workflow management.

## Features

- **Specification Detection**: Automatically detects `.specifications` folders in your workspace
- **TreeView Navigation**: Browse specifications, requirements, design documents, and tasks
- **MCP Integration**: One-click setup for SpecForged MCP server across different IDEs
- **Task Management**: Interactive checkbox-style task tracking
- **EARS Syntax Highlighting**: Syntax support for EARS (Easy Approach to Requirements Syntax) notation
- **Multi-IDE Support**: Generate configurations for Cursor, Windsurf, Claude Code, and more

## Installation

1. Install from VS Code marketplace (coming soon)
2. Or install from VSIX: `code --install-extension vscode-specforged-0.1.0.vsix`

## Quick Start

1. Open a project in VS Code
2. Click the SpecForged icon in the activity bar
3. Use "Initialize Project" to set up SpecForged MCP server
4. Create your first specification

## Requirements

- VS Code 1.74.0 or higher
- SpecForged MCP server (`pipx install specforged`)

## Configuration

Configure the extension through VS Code settings:

```json
{
  "specforged.autoDetect": true,
  "specforged.specFolder": ".specifications",
  "specforged.showProgressBadges": true,
  "specforged.enableSyntaxHighlighting": true,
  "specforged.mcpServerPath": "specforged",
  "specforged.defaultIde": "auto"
}
```

## Commands

- `SpecForged: Initialize Project` - Set up MCP in current project
- `SpecForged: Create Specification` - Create new specification
- `SpecForged: Setup MCP Server` - Configure MCP for your preferred IDE
- `SpecForged: Sync Specifications` - Refresh specifications from filesystem

## License

MIT - See LICENSE file for details