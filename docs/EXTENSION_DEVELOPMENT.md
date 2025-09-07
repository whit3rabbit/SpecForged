# VS Code Extension Development Guide

This guide covers local development, testing, and debugging of the enhanced SpecForged VS Code extension with MCP ecosystem integration.

## Prerequisites

### Required Software
- **Node.js** (v18 or later) - [Download](https://nodejs.org/)
- **npm** or **yarn** - Package manager
- **VS Code** - [Download](https://code.visualstudio.com/)
- **Git** - Version control
- **TypeScript** - `npm install -g typescript`

### Optional but Recommended
- **Claude Desktop** - For MCP testing
- **Cursor** - Alternative IDE with MCP support
- **Windsurf** - AI-powered IDE
- **Zed** - High-performance editor

## Initial Setup

### 1. Clone and Install Dependencies

```bash
# Navigate to the extension directory
cd /Users/whit3rabbit/Documents/GitHub/SpecForge/vscode-specforged

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Or watch for changes during development
npm run watch
```

### 2. Open in VS Code

```bash
# Open the extension project in VS Code
code .
```

### 3. Install VS Code Extension Development Extensions

Install these extensions in VS Code for better development experience:
- **TypeScript Importer** - Auto-imports TypeScript modules
- **ESLint** - Code linting
- **Prettier** - Code formatting
- **GitLens** - Git integration

## Development Workflow

### 1. Launch Extension Host

In VS Code, press `F5` or:
1. Open **Run and Debug** panel (`Ctrl+Shift+D`)
2. Select **"Run Extension"** configuration
3. Click the green play button

This opens a new **Extension Development Host** window with your extension loaded.

### 2. Test Extension Features

In the Extension Development Host:

```bash
# Open Command Palette
Ctrl+Shift+P (Cmd+Shift+P on Mac)

# Try extension commands:
"SpecForged: Initialize Project"
"SpecForged: Open MCP Dashboard" 
"SpecForged: Quick MCP Setup"
"SpecForged: Discover MCP Ecosystem"
```

### 3. Debug Extension Code

- Set breakpoints in TypeScript files
- Use VS Code's debugging tools
- Check **Debug Console** for output
- Monitor **Developer Tools** (`Help > Toggle Developer Tools`)

## Testing Different MCP Scenarios

### 1. Local MCP Server Testing

```bash
# Terminal 1: Start SpecForged MCP server locally
cd /Users/whit3rabbit/Documents/GitHub/SpecForge
python main.py

# Terminal 2: Test extension in VS Code
# The extension will detect the local server automatically
```

### 2. Test Auto-Discovery

Create test configuration files to simulate different MCP clients:

```bash
# Create test Claude config
mkdir -p ~/Library/Application\ Support/Claude/
echo '{"mcpServers": {"specforged": {"command": "specforged"}}}' > ~/Library/Application\ Support/Claude/claude_desktop_config.json

# Create test Cursor config  
mkdir -p ~/.cursor/
echo '{"mcpServers": {"specforged": {"command": "specforged"}}}' > ~/.cursor/mcp_config.json

# Test discovery in extension
```

### 3. Test Profile Management

In the Extension Development Host:
1. Open SpecForged sidebar
2. Navigate to **Settings** tab
3. Try different profile templates
4. Test export/import functionality
5. Validate profile configurations

## Building and Packaging

### 1. Development Build

```bash
# Compile TypeScript
npm run compile

# Run tests  
npm test

# Lint code
npm run lint

# Format code
npm run format
```

### 2. Production Build

```bash
# Clean previous builds
npm run clean

# Build for production
npm run build

# Package extension (.vsix file)
npm run package
```

### 3. Install Local Package

```bash
# Install the packaged extension
code --install-extension vscode-specforged-0.2.0.vsix

# Or via VS Code UI:
# Extensions > ... > Install from VSIX
```

## Testing Matrix

### Test Scenarios Checklist

#### ✅ Basic Functionality
- [ ] Extension activates properly
- [ ] Commands appear in Command Palette
- [ ] Sidebar views render correctly
- [ ] Status bar items display properly

#### ✅ MCP Discovery
- [ ] Detects Claude Desktop installation
- [ ] Detects Cursor installation  
- [ ] Detects Windsurf installation
- [ ] Detects Zed installation
- [ ] Handles missing installations gracefully

#### ✅ Configuration Management
- [ ] Creates configuration profiles
- [ ] Applies profile templates
- [ ] Exports/imports profiles successfully
- [ ] Validates profile configurations
- [ ] Syncs configurations to clients

#### ✅ Dashboard Functionality
- [ ] Real-time status updates
- [ ] Client/server management panels
- [ ] Interactive setup wizards
- [ ] Error handling and notifications

#### ✅ Cross-Platform Testing
- [ ] macOS compatibility
- [ ] Windows compatibility  
- [ ] Linux compatibility
- [ ] Path resolution across platforms

## Debugging Common Issues

### Extension Not Loading

```bash
# Check extension host logs
# Developer Tools > Console

# Common fixes:
npm run clean
npm install
npm run compile
```

### MCP Discovery Failures

```bash
# Enable debug logging
# Add to VS Code settings.json:
{
  "specforged.debug": true,
  "specforged.logLevel": "debug"
}

# Check Output panel > SpecForged
```

### Configuration Sync Issues

```bash
# Test with minimal profile first
# Check file permissions on config directories
# Verify MCP client installations

# Manual config validation:
cat ~/.cursor/mcp_config.json | jq .
cat ~/Library/Application\ Support/Claude/claude_desktop_config.json | jq .
```

### WebView Not Loading

```bash
# Check Content Security Policy
# Enable webview debugging:
# Developer Tools > Sources > Enable CSP debugging

# Test with fallback HTML
# Check for JavaScript errors in webview
```

## Performance Testing

### Memory Usage

```bash
# Monitor extension memory usage
# VS Code > Help > Process Explorer

# Look for:
# - Extension Host memory consumption
# - WebView memory usage
# - File system watchers
```

### Startup Performance

```bash
# Measure activation time
# Add timing logs in activate() function

console.time('Extension Activation');
// ... extension code ...
console.timeEnd('Extension Activation');
```

### MCP Connection Performance

```bash
# Test connection latency
# Monitor discovery operation timing
# Profile configuration sync performance
```

## Advanced Testing

### 1. Mock MCP Clients

Create mock configurations for testing:

```typescript
// test/mocks/mockMcpClients.ts
export const mockClients = {
  claude: {
    id: 'claude',
    name: 'Claude Desktop',
    configPath: '~/Library/Application Support/Claude/claude_desktop_config.json',
    isInstalled: true,
    configExists: true
  },
  cursor: {
    id: 'cursor', 
    name: 'Cursor',
    configPath: '~/.cursor/mcp_config.json',
    isInstalled: false,
    configExists: false
  }
};
```

### 2. Integration Tests

```typescript
// test/integration/mcpDiscovery.test.ts
import { McpDiscoveryService } from '../../src/services/McpDiscoveryService';

describe('MCP Discovery Integration', () => {
  test('discovers installed clients', async () => {
    const discovery = new McpDiscoveryService();
    const result = await discovery.discoverMcpEcosystem();
    expect(result.clients.length).toBeGreaterThan(0);
  });
});
```

### 3. End-to-End Testing

```bash
# Install test runners
npm install --save-dev @vscode/test-electron

# Run E2E tests
npm run test:e2e
```

## Publishing and Distribution

### 1. Pre-Publication Checklist

- [ ] All tests passing
- [ ] Documentation updated
- [ ] Version number incremented
- [ ] Changelog updated
- [ ] No debug logging in production
- [ ] Security review completed

### 2. Publishing to VS Code Marketplace

```bash
# Install vsce (VS Code Extension Manager)
npm install -g vsce

# Login to marketplace
vsce login specforged

# Package and publish
vsce package
vsce publish
```

### 3. GitHub Releases

```bash
# Create release tag
git tag v0.2.0
git push origin v0.2.0

# Upload .vsix file to GitHub release
# Include release notes and changelog
```

## Troubleshooting Guide

### Common Development Issues

| Issue | Solution |
|-------|----------|
| TypeScript compilation errors | Run `npm run clean && npm install` |
| Extension not loading | Check `activate()` function for errors |
| Webview blank/not rendering | Verify CSP headers and HTML syntax |
| MCP discovery failing | Check file permissions and paths |
| Configuration sync errors | Validate JSON syntax and client configs |
| Status bar not updating | Check event listeners and disposal |

### Getting Help

1. **Check logs**: VS Code Output panel > SpecForged
2. **Debug mode**: Enable debug logging in settings
3. **Extension Host**: Check Extension Development Host logs
4. **GitHub Issues**: Report bugs with full error details
5. **MCP Documentation**: Refer to MCP protocol specs

## Development Tips

### Best Practices

1. **Use TypeScript strictly** - Enable strict mode
2. **Dispose resources** - Implement proper cleanup
3. **Handle errors gracefully** - Never crash the extension
4. **Test cross-platform** - Different OS path handling
5. **Performance conscious** - Minimize file system operations
6. **Security first** - Validate all user inputs

### Code Organization

```
src/
├── commands/          # Command implementations
├── services/          # Core business logic
├── views/            # Webview providers
├── utils/            # Helper functions
├── models/           # Data structures
├── adapters/         # Protocol abstractions
└── extension.ts      # Main entry point
```

### Useful VS Code APIs

```typescript
// Configuration
vscode.workspace.getConfiguration('specforged')

// File operations
vscode.workspace.fs.readFile(uri)
vscode.workspace.fs.writeFile(uri, data)

// UI interactions
vscode.window.showInformationMessage()
vscode.window.showQuickPick(items)

// Status bar
vscode.window.createStatusBarItem()

// Commands
vscode.commands.registerCommand()
vscode.commands.executeCommand()
```

This guide provides comprehensive coverage of local development workflows, testing strategies, and troubleshooting for the enhanced SpecForged VS Code extension.