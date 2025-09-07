# MCP Extension Testing Scenarios

This guide provides specific testing scenarios for the enhanced SpecForged VS Code extension with comprehensive MCP ecosystem integration.

## Quick Start Testing

### 1. Automated Setup
```bash
# Navigate to extension directory
cd vscode-specforged

# Run automated setup script
./scripts/dev-setup.sh

# Open VS Code and launch extension
code .
# Press F5 to open Extension Development Host
```

### 2. Manual Testing Checklist

#### ✅ Extension Activation
- [ ] Extension loads without errors
- [ ] SpecForged sidebar appears
- [ ] Status bar items display
- [ ] Commands available in Command Palette

## Core MCP Discovery Testing

### Scenario 1: Auto-Discovery with Multiple Clients

**Setup:**
```bash
# Simulate different MCP clients installed
mkdir -p ~/Library/Application\ Support/Claude/
echo '{"mcpServers": {}}' > ~/Library/Application\ Support/Claude/claude_desktop_config.json

mkdir -p ~/.cursor/
echo '{"mcpServers": {}}' > ~/.cursor/mcp_config.json

mkdir -p ~/.windsurf/
echo '{"mcpServers": {}}' > ~/.windsurf/mcp_config.json
```

**Test Steps:**
1. Open Extension Development Host
2. Run: "SpecForged: Discover MCP Ecosystem"
3. Verify all clients detected in dashboard
4. Check status indicators show correct counts

**Expected Results:**
- Claude Desktop: ✅ Installed, ⚠️ Not Configured
- Cursor: ✅ Installed, ⚠️ Not Configured  
- Windsurf: ✅ Installed, ⚠️ Not Configured

### Scenario 2: Partial Installation Detection

**Setup:**
```bash
# Only Claude Desktop installed
rm -f ~/.cursor/mcp_config.json
rm -f ~/.windsurf/mcp_config.json
```

**Test Steps:**
1. Run discovery again
2. Check dashboard shows mixed status
3. Verify recommendations appear

**Expected Results:**
- Claude Desktop: ✅ Installed
- Cursor: ❌ Not Installed
- Windsurf: ❌ Not Installed
- Recommendations: "Install Cursor", "Install Windsurf"

## Configuration Management Testing

### Scenario 3: Profile Creation and Application

**Test Steps:**
1. Open Settings panel in extension
2. Select "Full Developer Setup" template
3. Customize name: "My Dev Environment"
4. Select available clients
5. Apply profile
6. Verify configurations created

**Validation:**
```bash
# Check Claude config was created
cat ~/Library/Application\ Support/Claude/claude_desktop_config.json

# Should contain SpecForged server configuration
jq '.mcpServers.specforged' ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

### Scenario 4: Profile Export/Import

**Test Steps:**
1. Create a test profile with custom settings
2. Export profile to file
3. Delete profile from extension
4. Import profile from file
5. Verify profile restored correctly

**Validation:**
- Exported JSON file contains all profile data
- Imported profile has identical configuration
- Applied profile creates correct MCP configs

## Dashboard Integration Testing

### Scenario 5: Real-time Status Updates

**Setup:**
```bash
# Terminal 1: Start SpecForged MCP server
cd /Users/whit3rabbit/Documents/GitHub/SpecForge
python main.py

# Terminal 2: VS Code Extension Development Host
```

**Test Steps:**
1. Open MCP Dashboard in extension
2. Note server status: 🔴 Disconnected
3. Start MCP server in terminal
4. Watch dashboard update to: 🟢 Connected
5. Stop server, verify returns to disconnected

**Expected Behavior:**
- Status updates automatically every 30 seconds
- Manual refresh button works immediately
- Connection indicators reflect actual state

### Scenario 6: Interactive Setup Wizard

**Test Steps:**
1. Run "SpecForged: Setup Walkthrough"
2. Complete all 7 steps:
   - Welcome
   - Discovery
   - Installation guidance
   - Configuration
   - Profile creation
   - Testing
   - Completion
3. Verify each step validates properly
4. Check final configuration is applied

## Cross-Platform Testing

### Scenario 7: macOS Path Resolution

**Test Configuration Paths:**
```bash
# Claude Desktop
~/Library/Application Support/Claude/claude_desktop_config.json

# Cursor (if installed via Homebrew)
~/.cursor/mcp_config.json

# VS Code
~/Library/Application Support/Code/User/settings.json
```

**Test Steps:**
1. Verify extension finds configs at correct paths
2. Test config creation in correct directories
3. Validate permissions handling

### Scenario 8: Windows Compatibility

**Windows Test Paths:**
```powershell
# Claude Desktop
%APPDATA%\Claude\claude_desktop_config.json

# Cursor
%APPDATA%\Cursor\User\mcp_config.json

# VS Code
%APPDATA%\Code\User\settings.json
```

**Test Steps:**
1. Run extension on Windows machine
2. Verify path resolution works
3. Test configuration file creation
4. Check file permissions

## Error Handling Testing

### Scenario 9: Permission Denied Scenarios

**Setup:**
```bash
# Create read-only config directory
mkdir -p ~/.cursor/
chmod 444 ~/.cursor/
```

**Test Steps:**
1. Try to create configuration
2. Verify graceful error handling
3. Check error message is informative
4. Ensure extension doesn't crash

**Expected Behavior:**
- Clear error message about permissions
- Suggested resolution steps
- Extension continues functioning
- Other operations still work

### Scenario 10: Malformed Configuration Files

**Setup:**
```bash
# Create invalid JSON config
echo '{"mcpServers": {invalid json}' > ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

**Test Steps:**
1. Run discovery
2. Verify invalid config detected
3. Check error reporting
4. Test recovery suggestions

**Expected Behavior:**
- Config marked as "⚠️ Invalid"
- Specific JSON error reported
- Option to reset/repair config
- Backup created before repair

## Performance Testing

### Scenario 11: Large Configuration Discovery

**Setup:**
```bash
# Create many mock client directories
for i in {1..50}; do
    mkdir -p ~/.mock-client-$i/
    echo '{"mcpServers": {}}' > ~/.mock-client-$i/config.json
done
```

**Test Steps:**
1. Run discovery with many configs
2. Measure discovery time
3. Check UI responsiveness
4. Monitor memory usage

**Performance Targets:**
- Discovery < 5 seconds for 50+ clients
- UI remains responsive during discovery
- Memory usage < 100MB additional
- No UI blocking operations

### Scenario 12: Frequent Status Updates

**Test Steps:**
1. Enable 10-second status refresh interval
2. Start/stop MCP servers repeatedly
3. Monitor dashboard updates
4. Check for memory leaks

**Expected Behavior:**
- Consistent update performance
- No memory growth over time
- CPU usage remains reasonable
- No UI flickering or stuttering

## Integration Testing

### Scenario 13: End-to-End Workflow

**Complete User Journey:**
1. Install extension for first time
2. Welcome walkthrough appears automatically
3. Complete discovery and setup
4. Create first specification
5. Configure MCP integration
6. Test specification tools work
7. Export configuration for team

**Validation Points:**
- Each step completes successfully
- No errors in Developer Console
- Final configuration is functional
- Team member can import config

### Scenario 14: Multi-Client Synchronization

**Setup:**
```bash
# Install multiple MCP clients
# Configure SpecForged in each
```

**Test Steps:**
1. Create profile targeting all clients
2. Apply profile synchronization
3. Verify all clients configured identically
4. Test each client can connect to SpecForged
5. Run MCP commands in each client

**Expected Results:**
- All clients have identical server configs
- All clients connect successfully
- MCP commands work in each client
- Specifications sync across clients

## Regression Testing

### Scenario 15: Extension Updates

**Test Steps:**
1. Install previous version of extension
2. Create configurations and profiles
3. Update to new version
4. Verify all data migrated correctly
5. Test new features work
6. Check old features still functional

### Scenario 16: VS Code Version Compatibility

**Test Matrix:**
- VS Code 1.74.0 (minimum supported)
- VS Code 1.80.0 (stable)
- VS Code Insiders (latest)

**For Each Version:**
1. Install extension
2. Run core functionality tests
3. Check all webviews render
4. Verify commands work
5. Test MCP discovery

## Debugging Failed Tests

### Common Issues and Solutions

| Issue | Likely Cause | Solution |
|-------|-------------|----------|
| Extension won't load | Compilation errors | `npm run compile`, check errors |
| Discovery finds nothing | Wrong paths | Check platform-specific paths |
| Configs not created | Permission issues | Check directory permissions |
| Dashboard blank | CSP errors | Check webview console for errors |
| Commands missing | Registration issues | Check `package.json` commands |
| Status not updating | Event listener issues | Check disposal and re-registration |

### Debug Commands

```bash
# Clean and rebuild
npm run clean
npm install
npm run compile

# Enable debug logging
# In VS Code settings:
"specforged.debug": true

# Check extension logs
# Output panel > SpecForged

# Monitor file operations
# macOS: sudo fs_usage -w | grep cursor
# Linux: inotifywatch

# Network debugging
# Developer Tools > Network tab
```

### Test Data Cleanup

```bash
# Remove test configurations
rm -f ~/Library/Application\ Support/Claude/claude_desktop_config.json
rm -f ~/.cursor/mcp_config.json
rm -f ~/.windsurf/mcp_config.json

# Remove mock clients
rm -rf ~/.mock-client-*

# Reset extension state
# VS Code: Reload Window (Cmd+R)
```

This comprehensive testing guide ensures the enhanced SpecForged VS Code extension works reliably across all supported MCP clients and platforms.