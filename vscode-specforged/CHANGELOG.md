# Change Log

All notable changes to the "vscode-specforged" extension will be documented in this file.

## [0.1.0] - 2024-01-XX

### Added
- Initial release of SpecForged VS Code extension
- Automatic detection of `.specifications` folders in workspace
- TreeView navigation for specifications, requirements, design, and tasks
- Interactive task management with checkbox-style completion
- MCP server integration with one-click setup wizard
- Support for multiple IDEs (Cursor, Windsurf, Claude Code, VS Code)
- Rich webview display with EARS syntax highlighting
- Status bar integration showing current specification and progress
- Project initialization wizard
- Configuration management for MCP servers

### Features
- **Specification Management**: Browse and manage SpecForged specifications
- **EARS Support**: Syntax highlighting for Easy Approach to Requirements Syntax
- **Task Tracking**: Visual progress tracking with interactive checkboxes
- **MCP Integration**: Seamless setup for Model Context Protocol servers
- **Multi-IDE Support**: Generate configurations for various AI-powered IDEs
- **Real-time Updates**: File system watching for specification changes
- **Rich UI**: Professional interface with VS Code theming support

### Commands
- `SpecForged: Initialize Project` - Set up SpecForged in current project
- `SpecForged: Create Specification` - Create new specification with templates
- `SpecForged: Setup MCP Server` - Configure MCP for preferred IDE
- `SpecForged: Sync Specifications` - Refresh specifications from filesystem

### Configuration Options
- `specforged.autoDetect`: Automatically detect specifications (default: true)
- `specforged.specFolder`: Specification folder name (default: ".specifications")
- `specforged.showProgressBadges`: Show progress badges in tree view (default: true)
- `specforged.enableSyntaxHighlighting`: Enable EARS syntax highlighting (default: true)
- `specforged.mcpServerPath`: Path to SpecForged executable (default: "specforged")
- `specforged.defaultIde`: Default IDE for configuration (default: "auto")

### Requirements
- VS Code 1.74.0 or higher
- SpecForged MCP server (install with `pipx install specforged`)

### Known Issues
- Task status toggling requires file system write permissions
- Some syntax highlighting features may not work in all themes
- MCP server detection relies on PATH configuration

### Planned Features
- Real-time collaboration on specifications
- Git integration for specification versioning
- Export specifications to various formats (PDF, Word, etc.)
- Integration with project management tools
- Advanced EARS requirement validation
- Custom specification templates
