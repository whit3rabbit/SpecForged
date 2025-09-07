# SpecForged Enhanced VS Code Extension

Advanced MCP ecosystem management with unified configuration, auto-discovery, and seamless integration across Cursor, Windsurf, Claude, and more.

## 🚀 Quick Start for Developers

### One-Command Setup
```bash
# From the vscode-specforged directory
./scripts/dev-setup.sh
```

This script will:
- ✅ Check all prerequisites
- ✅ Install dependencies  
- ✅ Compile TypeScript
- ✅ Set up VS Code configuration
- ✅ Create test configurations
- ✅ Verify MCP server availability

### Manual Development Setup

```bash
# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Launch extension in VS Code
code .
# Press F5 to open Extension Development Host
```

## 🎯 Features

### Core Capabilities
- **🔍 Auto-Discovery**: Automatically detects Claude Desktop, Cursor, Windsurf, Zed, and other MCP clients
- **⚙️ Unified Configuration**: Manage all MCP configurations from one interface  
- **📊 Real-time Dashboard**: Monitor connection status and health across all clients
- **🎨 Visual Setup**: Interactive wizards and profile templates
- **🔄 Configuration Sync**: Keep configurations synchronized across team members
- **📋 Profile Management**: Save, share, and apply configuration profiles

### Enhanced UI Components
- **MCP Dashboard**: Real-time status monitoring with interactive panels
- **Settings Interface**: Visual configuration with profiles and presets
- **Profile Manager**: Advanced template-based configuration management
- **Welcome Walkthrough**: 7-step guided setup process
- **Smart Status Bar**: Intelligent connection indicators with quick actions

## 🏗️ Architecture

### Core Services
```typescript
src/
├── services/
│   ├── McpDiscoveryService.ts     # Auto-discovery of MCP clients
│   ├── McpConfigSyncService.ts    # Configuration management
│   └── fileOperationService.ts   # File system operations
├── adapters/
│   └── UniversalMcpAdapter.ts     # Protocol abstraction
├── views/
│   ├── McpDashboardProvider.ts    # Dashboard webview
│   ├── SettingsProvider.ts       # Settings interface
│   └── ProfileManagerProvider.ts # Profile management
├── commands/
│   └── enhancedMcpCommands.ts     # 30+ MCP commands
└── utils/
    └── EnhancedStatusBarManager.ts # Smart status indicators
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

## 📚 Documentation

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

### v0.2.0 (Current)
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
