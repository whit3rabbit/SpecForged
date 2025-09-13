# Change Log

All notable changes to the "vscode-specforged" extension will be documented in this file.

## [0.2.2] - 2024-09-11

### Fixed
- **Command Registration Conflicts**: Resolved duplicate command registration issues that prevented extension activation
- **JSON Parsing Errors**: Enhanced error handling for empty or malformed JSON files in mock MCP server
- **MCP Sync Service Initialization**: Improved workspace validation and graceful degradation when no workspace is open
- **File System Cleanup**: Enhanced lock release mechanism to prevent file system errors during cleanup
- **Extension Activation**: Extension now activates successfully even when some services fail to initialize

### Enhanced
- **Error Messages**: More user-friendly error messages with actionable recovery suggestions
- **Service Initialization**: Each service now initializes independently with better error isolation
- **Workspace Detection**: Better handling of scenarios where VS Code has no workspace open

## [0.2.1] - 2025-01-XX

### Added
- **Operation Queue System**: Asynchronous operation processing with priority handling
- **Conflict Resolution**: Automatic detection and resolution of concurrent modifications
- **Atomic File Operations**: Safe file operations with backup and restore functionality
- **Enhanced MCP Sync Service**: Robust operation queue management with retry logic
- **Real-time Operation Monitoring**: Live updates for operation status and progress
- **Conflict Resolution UI**: Interactive interface for manual conflict resolution

### Enhanced
- **McpSyncService**: Refactored with atomic file operations and conflict detection
- **Operation Models**: Added comprehensive TypeScript interfaces for all operation types
- **Error Handling**: Improved error recovery with exponential backoff retry logic
- **File System Safety**: Atomic write operations with temporary files and rename
- **Status Tracking**: Enhanced operation status management with detailed progress

### Technical Improvements
- Added `AtomicFileOperations` utility for safe file system operations
- Implemented `ConflictResolver` service for conflict detection and resolution
- Enhanced `McpOperationFactory` with type-safe operation creation
- Added comprehensive operation validation with `McpOperationValidator`
- Improved error handling with `AtomicFileOperationError` types

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
