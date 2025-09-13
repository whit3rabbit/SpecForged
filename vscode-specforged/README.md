# SpecForged Enhanced VS Code Extension

Advanced MCP ecosystem management with unified configuration, auto-discovery, and seamless integration across Cursor, Windsurf, Claude, and more.

## 🎯 **Important: SpecForged MCP Server Independence**

**The SpecForged MCP server runs completely independently of this VS Code extension.** This extension provides enhanced management and visualization, but the core server functionality works standalone:

- ✅ **Standalone Installation**: `pipx install specforged`
- ✅ **Independent Operation**: `specforged serve` (no VS Code required)
- ✅ **Multiple Clients**: Works with Claude Desktop, Cursor, Windsurf, etc.
- ✅ **Docker Deployment**: `docker run -p 8080:8080 specforged/specforged`
- ✅ **HTTP Mode**: Web-accessible MCP server

**See the [main SpecForged repository](https://github.com/whit3rabbit/SpecForge) for standalone installation and usage.**

---

## 🚀 Quick Start for Developers

### Using the Build System (Recommended)

```bash
# Show all available commands
make help

# One-command setup and build
make install
make dev

# Or use the automated setup script
./scripts/dev-setup.sh
```

The project includes a comprehensive build system:
- ✅ **Makefile**: `make build`, `make test`, `make package`
- ✅ **Build Script**: `./scripts/build.sh production`
- ✅ **npm Scripts**: `npm run bundle`, `npm test`

### Manual Development Setup

```bash
# Install dependencies
npm install

# Build for development
npm run bundle-dev

# Launch extension in VS Code
code .
# Press F5 to open Extension Development Host
```

📖 **See [BUILD.md](./BUILD.md) for detailed build instructions and troubleshooting.**

## 🔗 Extension vs Standalone Server

### What This Extension Provides
This VS Code extension **enhances** the standalone SpecForged MCP server with:
- 🎛️ **Visual Management**: Dashboard, settings UI, and status monitoring
- 🔍 **Auto-Discovery**: Automatic detection of MCP clients (Claude, Cursor, etc.)
- ⚙️ **Configuration Sync**: Unified management across multiple clients
- 📊 **Real-time Monitoring**: Operation queues, health checks, and diagnostics
- 🎨 **Interactive Setup**: Wizards, profiles, and guided configuration

### What You Get Without This Extension
The standalone SpecForged server provides full functionality:
- 📋 **Complete MCP Tools**: All specification management capabilities
- 🌐 **Multiple Protocols**: stdio, HTTP, WebSocket support
- ⚙️ **Configuration Management**: YAML config files and CLI commands
- 🔧 **CLI Interface**: `specforged init`, `serve`, `status`, `config` commands
- 🐳 **Production Deployment**: Docker containers with health checks

**Choose Your Approach:**
- **🎨 Enhanced Experience**: Use this extension for visual management
- **🖥️ Standalone Usage**: Use `specforged` CLI for lightweight operation
- **🌐 Server Deployment**: Deploy via Docker for team/cloud usage

---

## 🎯 Features

### Core Capabilities
- **🔍 Auto-Discovery**: Automatically detects Claude Desktop, Cursor, Windsurf, Zed, and other MCP clients
- **⚙️ Unified Configuration**: Manage all MCP configurations from one interface
- **📊 Real-time Dashboard**: Monitor connection status and health across all clients
- **🎨 Visual Setup**: Interactive wizards and profile templates
- **🔄 Configuration Sync**: Keep configurations synchronized across team members
- **📋 Profile Management**: Save, share, and apply configuration profiles
- **⚡ Operation Queue**: Asynchronous operation processing with conflict resolution
- **🔧 Conflict Resolution**: Automatic and manual conflict detection and resolution

### Enhanced UI Components
- **MCP Dashboard**: Real-time status monitoring with interactive panels
- **Settings Interface**: Visual configuration with profiles and presets
- **Profile Manager**: Advanced template-based configuration management
- **Welcome Walkthrough**: 7-step guided setup process
- **Smart Status Bar**: Intelligent connection indicators with quick actions
- **Operation Queue View**: Monitor pending, in-progress, and completed operations
- **Conflict Resolution UI**: Interactive conflict detection and resolution interface

## 🏗️ Architecture

### Core Services
```typescript
src/
├── services/
│   ├── McpDiscoveryService.ts     # Auto-discovery of MCP clients
│   ├── McpConfigSyncService.ts    # Configuration management
│   ├── McpSyncService.ts          # Operation queue and sync management
│   └── fileOperationService.ts   # File system operations
├── adapters/
│   └── UniversalMcpAdapter.ts     # Protocol abstraction
├── views/
│   ├── McpDashboardProvider.ts    # Dashboard webview
│   ├── SettingsProvider.ts       # Settings interface
│   ├── ProfileManagerProvider.ts # Profile management
│   └── OperationQueueView.ts     # Operation queue monitoring
├── commands/
│   └── enhancedMcpCommands.ts     # 30+ MCP commands
├── utils/
│   ├── EnhancedStatusBarManager.ts # Smart status indicators
│   ├── atomicFileOperations.ts    # Safe file operations
│   └── conflictResolver.ts        # Conflict detection and resolution
└── models/
    └── mcpOperation.ts            # Operation and conflict type definitions
```

### Supported MCP Clients

| Client | Auto-Discovery | Configuration | Status |
|--------|---------------|---------------|---------|
| **Claude Desktop** | ✅ | ✅ | ✅ Active |
| **Cursor** | ✅ | ✅ | ✅ Active |
| **Windsurf** | ✅ | ✅ | ✅ Active |
| **Zed** | ✅ | ✅ | ✅ Active |
| **Neovim** | ✅ | ✅ | 🚧 Planned |
| **VS Code** | ✅ | ✅ | 🚧 Planned |

## 🔄 Operation Queue & Conflict Resolution

### Operation Queue Management
The extension now includes a sophisticated operation queue system that handles all MCP operations asynchronously:

- **Atomic Operations**: All file operations are atomic to prevent corruption
- **Priority Handling**: Operations can be prioritized (LOW, NORMAL, HIGH, URGENT)
- **Retry Logic**: Failed operations are automatically retried with exponential backoff
- **Real-time Monitoring**: Track operation status in the Operation Queue view

### Conflict Detection & Resolution
Advanced conflict detection prevents data loss and ensures consistency:

#### Conflict Types
- **Concurrent Modification**: Multiple operations modifying the same file
- **Duplicate Operation**: Identical operations queued multiple times
- **Resource Locked**: File system locks preventing access
- **Dependency Conflict**: Operations with circular or missing dependencies
- **Version Mismatch**: File version conflicts between operations

#### Resolution Strategies
- **Manual**: User chooses resolution through UI
- **Auto Merge**: Automatic content merging when possible
- **Prefer Newer**: Always use the most recent operation
- **Prefer Older**: Keep the original operation
- **Cancel Conflicting**: Cancel newer conflicting operations

### Operation Queue View
Monitor all operations through the dedicated tree view:
- Group operations by status (Pending, In Progress, Failed, Completed, Conflicts)
- View operation details, parameters, and results
- Retry failed operations or resolve conflicts manually
- Track progress and performance metrics

## 🧪 Testing

### Quick Test Suite
```bash
# Run all tests
npm test

# Compile and test
npm run compile && npm test

# Full validation
./scripts/test-all.sh
```

### Manual Testing
1. **Launch Extension Host**: Press `F5` in VS Code
2. **Open Command Palette**: `Ctrl+Shift+P` (or `Cmd+Shift+P`)
3. **Test Commands**:
   - `SpecForged: Discover MCP Ecosystem`
   - `SpecForged: Open MCP Dashboard`
   - `SpecForged: Quick MCP Setup`
   - `SpecForged: Open Settings`

### Test Scenarios
See [TESTING_SCENARIOS.md](../docs/TESTING_SCENARIOS.md) for comprehensive testing scenarios including:
- Auto-discovery with multiple clients
- Configuration profile management
- Cross-platform compatibility
- Error handling and edge cases

## 🚀 Quick Standalone Usage Reference

If you want to use SpecForged without this extension:

```bash
# Install standalone server
pipx install specforged

# Initialize project
cd your-project && specforged init

# Start server for MCP clients
specforged serve

# Check status
specforged status

# View configuration
specforged config show

# HTTP server mode (for web clients)
specforged http --port 8080

# Docker deployment
docker run -d -p 8080:8080 -v $(pwd):/workspace specforged/specforged
```

**MCP Client Configuration (without extension):**
```json
// ~/.claude/claude_desktop_config.json
{
  "mcpServers": {
    "specforged": {
      "command": "specforged",
      "args": []
    }
  }
}
```

## 📚 Documentation

- **[Standalone Usage Guide](../docs/STANDALONE_USAGE.md)**: Complete standalone setup and deployment
- **[Extension Development Guide](../docs/EXTENSION_DEVELOPMENT.md)**: Comprehensive development workflow
- **[Testing Scenarios](../docs/TESTING_SCENARIOS.md)**: Detailed testing instructions
- **[API Documentation](../docs/API.md)**: SpecForged MCP server API reference

## 🛠️ Development Commands

```bash
# Development
npm run compile              # Compile TypeScript
npm run watch               # Watch and compile on changes
npm run lint                # Run ESLint
npm run format              # Format with Prettier

# Testing
npm test                    # Run unit tests
npm run test:watch          # Watch tests
npm run test:e2e           # End-to-end tests

# Building
npm run clean              # Clean build artifacts
npm run build              # Production build
npm run package            # Package .vsix file

# Helper Scripts
./scripts/dev-setup.sh     # Initial development setup
./scripts/test-all.sh      # Run all checks
./scripts/package.sh       # Package for distribution
```

## 🔧 Configuration

### VS Code Settings
```json
{
  "specforged.autoDiscovery": true,
  "specforged.showRecommendations": true,
  "specforged.enableDashboard": true,
  "specforged.syncOnChange": false,
  "specforged.backupBeforeSync": true,
  "specforged.notificationLevel": "errors",
  "specforged.defaultServerType": "local",
  "specforged.refreshInterval": 60,
  "specforged.maxBackups": 5,
  "specforged.debug": false
}
```

### Profile Templates

#### Developer Setup
```json
{
  "name": "Full Developer",
  "servers": {
    "specforged": { "enabled": true, "priority": 1 },
    "context7": { "enabled": true, "priority": 2 },
    "tavily": { "enabled": true, "priority": 3 }
  },
  "targetClients": ["claude", "cursor", "windsurf", "zed"]
}
```

#### Minimal Setup
```json
{
  "name": "Minimal",
  "servers": {
    "specforged": { "enabled": true, "priority": 1 }
  },
  "targetClients": ["claude"]
}
```

## 🐛 Debugging

### Common Issues

| Issue | Solution |
|-------|----------|
| Extension won't load | `npm run clean && npm install && npm run compile` |
| Discovery finds nothing | Check platform-specific config paths |
| Webview blank | Check CSP errors in Developer Tools |
| Configs not created | Verify directory permissions |

### Debug Logging
```json
// settings.json
{
  "specforged.debug": true,
  "specforged.logLevel": "debug"
}
```

Check logs in: **Output Panel > SpecForged**

### Extension Development Host
- **Console**: `Help > Toggle Developer Tools`
- **Reload**: `Ctrl+R` / `Cmd+R`
- **Logs**: Check Extension Host logs

## 📦 Packaging and Distribution

### Local Installation
```bash
# Package extension
npm run package

# Install locally
code --install-extension vscode-specforged-0.2.0.vsix
```

### Marketplace Publishing
```bash
# Install vsce
npm install -g vsce

# Login and publish
vsce login specforged
vsce publish
```

## 🤝 Contributing

1. **Fork the repository**
2. **Run setup script**: `./scripts/dev-setup.sh`
3. **Create feature branch**: `git checkout -b feature/amazing-feature`
4. **Make changes and test**: `./scripts/test-all.sh`
5. **Submit pull request**

### Development Guidelines
- Use TypeScript strict mode
- Follow existing code patterns
- Add tests for new features
- Update documentation
- Test on multiple platforms

## 📝 Version History

### v0.2.1 (Current)
- ✨ Operation queue system with asynchronous processing
- ✨ Advanced conflict detection and resolution
- ✨ Atomic file operations for data integrity
- ✨ Operation retry logic with exponential backoff
- ✨ Real-time operation monitoring and status tracking
- ✨ Enhanced MCP operation data models and validation

### v0.2.0 (Previous)
- ✨ Complete MCP ecosystem integration
- ✨ Auto-discovery for multiple clients
- ✨ Visual dashboard and settings interface
- ✨ Configuration profile management
- ✨ Enhanced status indicators
- ✨ Welcome walkthrough experience
- ✨ 30+ new MCP commands

### v0.1.0 (Previous)
- Basic SpecForged integration
- Simple specification management
- Core MCP server connection

## 🎯 Roadmap

### Next Release (v0.3.0)
- [ ] **Advanced Diagnostics**: Health monitoring and troubleshooting tools
- [ ] **Team Collaboration**: Shared configuration repositories
- [ ] **Custom Server Support**: Generic MCP server integration
- [ ] **Performance Monitoring**: Connection latency and usage metrics
- [ ] **Backup/Restore**: Full configuration backup system

### Future Features
- [ ] **Plugin Marketplace**: Community MCP server directory
- [ ] **Visual Config Editor**: Drag-and-drop configuration builder
- [ ] **Analytics Dashboard**: Usage statistics and insights
- [ ] **Enterprise SSO**: Authentication integration
- [ ] **CI/CD Integration**: Automated configuration deployment

## 📄 License

MIT License - see [LICENSE](../LICENSE) file for details.

## 🆘 Support

- **📖 Documentation**: Check the docs folder
- **🐛 Issues**: [GitHub Issues](https://github.com/whit3rabbit/SpecForge/issues)
- **💬 Discussions**: [GitHub Discussions](https://github.com/whit3rabbit/SpecForge/discussions)
- **📧 Email**: Support via GitHub issues preferred

---

**Happy coding with SpecForged! 🚀**
