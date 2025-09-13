# SpecForged Troubleshooting Guide

A comprehensive troubleshooting guide for the SpecForged MCP ecosystem, focusing on file-based IPC issues, operation queue problems, and system integration challenges.

## Table of Contents

1. [Quick Diagnostics](#quick-diagnostics)
2. [File-based IPC Issues](#file-based-ipc-issues)
3. [Operation Queue Problems](#operation-queue-problems)
4. [MCP Connection Issues](#mcp-connection-issues)
5. [VS Code Extension Problems](#vs-code-extension-problems)
6. [Conflict Resolution Issues](#conflict-resolution-issues)
7. [Performance Problems](#performance-problems)
8. [Security and Permission Issues](#security-and-permission-issues)
9. [Platform-Specific Issues](#platform-specific-issues)
10. [Advanced Debugging](#advanced-debugging)

---

## Quick Diagnostics

### Health Check Commands

Run these commands in VS Code Command Palette to quickly diagnose issues:

```bash
"SpecForged: System Health Check"     # Complete system diagnostic
"SpecForged: Test MCP Connection"     # MCP server connectivity test  
"SpecForged: Validate Configuration"  # Check configuration validity
"SpecForged: Queue Status"           # Operation queue health check
"SpecForged: File System Check"      # File permissions and access test
```

### Common Issue Indicators

| Symptom | Likely Cause | Quick Fix |
|---------|--------------|-----------|
| Operations stuck in queue | File-based IPC failure | Restart VS Code extension |
| "Server not responding" | MCP connection issue | Check server status and restart |
| "Permission denied" errors | File system permissions | Check directory permissions |
| Conflicts not resolving | Queue processor stuck | Clear queue and restart |
| Extension not loading | Configuration error | Validate and reset configuration |
| Files not syncing | File watcher failure | Restart file watcher service |

### Emergency Reset Procedures

#### Reset Extension State
```bash
# Via Command Palette:
"SpecForged: Reset Extension State"
"SpecForged: Clear All Queues" 
"SpecForged: Restart MCP Connection"
```

#### Manual Reset (if extension unresponsive)
```bash
# 1. Close VS Code
# 2. Delete extension data
rm -rf .vscode/specforged/
# 3. Restart VS Code
# 4. Reinitialize project
```

---

## File-based IPC Issues

The SpecForged ecosystem relies on file-based Inter-Process Communication between the VS Code extension and MCP servers. This section covers common IPC-related problems.

### IPC Architecture Overview

```
┌─────────────────────┐    File Operations    ┌─────────────────────┐
│   VS Code           │◄────────────────────► │   File System      │
│   Extension         │                       │   (.vscode/specforged/) │
└─────────────┬───────┘                       └─────────────────────┘
              │                                            ▲
              │ Queue Files                               │
              │ • operation_queue.json                    │
              │ • operation_results.json                  │
              │ • sync_state.json                         │
              │ • conflicts.json                          │ File Watching
              ▼                                            │
┌─────────────────────┐    Async Processing    ┌─────────────────────┐
│   MCP Server        │◄────────────────────► │   Queue             │
│   (Local/Remote)    │                       │   Processor         │
└─────────────────────┘                       └─────────────────────┘
```

### Issue 1: Queue Files Not Created

**Symptoms:**
- Operations appear to start but never complete
- No `.vscode/specforged/` directory created
- Error: "Queue file not found"

**Root Causes:**
- Insufficient directory permissions
- VS Code workspace not properly initialized
- File system access blocked by security software

**Solutions:**

#### Solution A: Fix Directory Permissions
```bash
# Check current permissions
ls -la .vscode/

# Create directory with proper permissions
mkdir -p .vscode/specforged/
chmod 755 .vscode/specforged/

# Verify VS Code can write to directory
echo "test" > .vscode/specforged/test.txt
rm .vscode/specforged/test.txt
```

#### Solution B: Reinitialize VS Code Workspace
```bash
# Via Command Palette:
"SpecForged: Initialize Project"

# Or manually:
mkdir -p .vscode/specforged/
echo '{}' > .vscode/specforged/operation_queue.json
echo '{}' > .vscode/specforged/sync_state.json
```

#### Solution C: Security Software Configuration
```bash
# Add VS Code and project directory to security software whitelist
# Common security software to configure:
# - Windows Defender
# - McAfee
# - Norton
# - Corporate endpoint protection

# Test with security software temporarily disabled
```

### Issue 2: Queue Files Corrupted

**Symptoms:**
- JSON parsing errors in extension logs
- Operations fail with "Invalid queue format"
- Queue interface shows empty or incorrect data

**Root Causes:**
- Concurrent write operations to queue files
- System crash during file write
- Disk space exhaustion
- File encoding issues

**Solutions:**

#### Solution A: Validate and Repair Queue Files
```bash
# Check JSON validity
cat .vscode/specforged/operation_queue.json | jq .
cat .vscode/specforged/sync_state.json | jq .

# If invalid, backup and recreate
mv .vscode/specforged/operation_queue.json .vscode/specforged/operation_queue.json.backup
echo '{"operations": [], "version": "1.0", "last_updated": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' > .vscode/specforged/operation_queue.json
```

#### Solution B: Enable Atomic File Operations
```json
// .vscode/settings.json
{
  "specforged.fileOperations.atomicWrites": true,
  "specforged.fileOperations.enableBackups": true,
  "specforged.fileOperations.validateWrites": true
}
```

#### Solution C: Queue Recovery Tool
```bash
# Via Command Palette:
"SpecForged: Recover Queue from Backup"
"SpecForged: Validate Queue Integrity"
"SpecForged: Export Queue for Analysis"
```

### Issue 3: File Watcher Not Working

**Symptoms:**
- Changes to specification files not detected
- Manual sync required after every change
- Extension shows stale data

**Root Causes:**
- File system events not supported
- File watcher service disabled
- Too many files being watched (system limit)
- Network file system limitations

**Solutions:**

#### Solution A: Enable File Watching
```json
// .vscode/settings.json
{
  "specforged.fileWatcher.enabled": true,
  "specforged.fileWatcher.usePolling": false,
  "specforged.fileWatcher.pollingInterval": 1000,
  "specforged.fileWatcher.debounceDelay": 500
}
```

#### Solution B: Use Polling Mode (for network filesystems)
```json
{
  "specforged.fileWatcher.usePolling": true,
  "specforged.fileWatcher.pollingInterval": 2000
}
```

#### Solution C: Reduce File Watch Scope
```json
{
  "specforged.fileWatcher.includePatterns": [
    ".specifications/**/*.md",
    ".specifications/**/*.json"
  ],
  "specforged.fileWatcher.excludePatterns": [
    "node_modules/**",
    ".git/**",
    "*.tmp",
    "*.backup"
  ]
}
```

### Issue 4: Cross-Platform Path Issues

**Symptoms:**
- Operations fail on Windows but work on macOS/Linux
- "Path not found" errors
- Incorrect file separators in logs

**Root Causes:**
- Hardcoded path separators
- Windows path length limitations
- Case sensitivity differences
- Permission model differences

**Solutions:**

#### Solution A: Normalize Path Configuration
```json
// .vscode/settings.json
{
  "specforged.fileOperations.normalizePaths": true,
  "specforged.fileOperations.useUnixSeparators": false,
  "specforged.fileOperations.caseSensitive": "auto"
}
```

#### Solution B: Windows-Specific Configuration
```json
// .vscode/settings.json (Windows)
{
  "specforged.fileOperations.enableLongPaths": true,
  "specforged.fileOperations.windowsCompatibility": true,
  "specforged.fileOperations.pathLength.maxPath": 260,
  "specforged.fileOperations.pathLength.useExtendedPaths": true
}
```

#### Solution C: Debug Path Resolution
```bash
# Via Command Palette:
"SpecForged: Debug Path Resolution"
# Shows resolved paths for all operations
```

---

## Operation Queue Problems

### Issue 5: Operations Stuck in Queue

**Symptoms:**
- Operations remain in "PENDING" status indefinitely
- Queue shows operations but no processing occurs
- New operations accumulate without completion

**Root Causes:**
- Queue processor not running
- Deadlock in queue processing logic
- Resource locks preventing processing
- Invalid operation parameters

**Solutions:**

#### Solution A: Restart Queue Processor
```bash
# Via Command Palette:
"SpecForged: Restart Queue Processor"
"SpecForged: Force Queue Processing"
"SpecForged: Clear Stale Operations"
```

#### Solution B: Debug Queue State
```bash
# Via Command Palette:
"SpecForged: Queue Debug Information"
# Returns:
{
  "processorStatus": "running|stopped|error",
  "queueSize": 5,
  "oldestOperation": "2025-01-09T10:30:00Z",
  "processingRate": "2.3 ops/min",
  "errorCount": 2,
  "lastProcessedOperation": "op_1234567890"
}
```

#### Solution C: Manual Queue Processing
```bash
# Process specific operations manually:
"SpecForged: Process Next Operation"
"SpecForged: Process Operation by ID"
"SpecForged: Process All Pending"
```

### Issue 6: Queue Processing Errors

**Symptoms:**
- Operations fail with cryptic error messages
- High failure rate in queue metrics
- Repeated retry attempts without success

**Common Error Messages and Solutions:**

#### "Operation timeout exceeded"
```json
// Increase timeouts in settings
{
  "specforged.queue.defaultTimeout": 60000,
  "specforged.queue.longOperationTimeout": 300000,
  "specforged.queue.retryTimeoutMultiplier": 1.5
}
```

#### "Resource temporarily unavailable"
```bash
# Check file locks and permissions
lsof .vscode/specforged/
# Kill processes holding locks if safe to do so
```

#### "Invalid operation parameters"
```bash
# Validate operation data:
"SpecForged: Validate Queue Operations"
# Remove invalid operations:
"SpecForged: Clean Invalid Operations"
```

#### "MCP server not responding"
```bash
# Test MCP connection:
"SpecForged: Test MCP Connection"
# Restart MCP server:
"SpecForged: Restart MCP Server"
```

### Issue 7: Memory Leaks in Queue Processing

**Symptoms:**
- VS Code becomes slow over time
- Memory usage continuously increases
- System becomes unresponsive

**Root Causes:**
- Queue operations not properly disposed
- Event listeners not removed
- Large queue history not cleaned up
- File handles not closed

**Solutions:**

#### Solution A: Enable Automatic Cleanup
```json
{
  "specforged.queue.autoCleanup": true,
  "specforged.queue.cleanupInterval": 300000,
  "specforged.queue.maxHistorySize": 1000,
  "specforged.queue.maxQueueSize": 500
}
```

#### Solution B: Manual Memory Management
```bash
# Regular cleanup commands:
"SpecForged: Clear Completed Operations"
"SpecForged: Garbage Collect Queue"
"SpecForged: Reset Queue State"
```

#### Solution C: Monitor Memory Usage
```bash
# Enable memory monitoring:
"SpecForged: Enable Memory Monitoring"
# View memory statistics:
"SpecForged: Memory Usage Report"
```

---

## MCP Connection Issues

### Issue 8: MCP Server Not Starting

**Symptoms:**
- "Server not found" error on extension activation
- Connection timeout during startup
- Server process exits immediately

**Root Causes:**
- SpecForged not installed or not in PATH
- Python environment issues
- Port conflicts (for HTTP servers)
- Configuration errors

**Solutions:**

#### Solution A: Verify Installation
```bash
# Check if specforged is installed and accessible
which specforged
specforged --version

# If not found, reinstall:
pipx install specforged --force

# Verify PATH includes pipx binaries
echo $PATH | grep pipx
```

#### Solution B: Python Environment Issues
```bash
# Check Python version
python --version  # Should be 3.10+

# Verify specforged imports
python -c "import specforged; print('OK')"

# If issues, reinstall with verbose output:
pipx install specforged --verbose --force
```

#### Solution C: Local Server Configuration
```json
// .vscode/settings.json
{
  "specforged.localServer.autoStart": true,
  "specforged.localServer.startupTimeout": 15000,
  "specforged.localServer.path": "specforged",
  "specforged.localServer.args": [],
  "specforged.localServer.env": {
    "SPECFORGE_DEBUG": "1"
  }
}
```

### Issue 9: Smithery Cloud Connection Problems

**Symptoms:**
- "Failed to connect to Smithery server"
- Authentication failures
- Intermittent connection drops

**Root Causes:**
- Invalid API credentials
- Network connectivity issues
- Server-side rate limiting
- Firewall blocking connections

**Solutions:**

#### Solution A: Verify Credentials
```json
// .vscode/settings.json
{
  "specforged.smithery.serverName": "your-server-name",
  "specforged.smithery.apiKey": "your-api-key",
  "specforged.smithery.serverUrl": "https://server.smithery.ai/your-server/mcp"
}
```

#### Solution B: Test Connectivity
```bash
# Test connection manually
curl -X POST https://server.smithery.ai/your-server/mcp \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "tools/list", "id": 1}'
```

#### Solution C: Network Configuration
```json
{
  "specforged.network.proxy": "http://proxy:8080",
  "specforged.network.timeout": 30000,
  "specforged.network.retryAttempts": 3,
  "specforged.network.retryDelay": 1000
}
```

### Issue 10: Custom Server Connection Issues

**Symptoms:**
- Connection refused to custom HTTP server
- SSL/TLS certificate errors
- Authentication token rejected

**Root Causes:**
- Server not running
- Incorrect server URL
- SSL certificate issues
- Authentication configuration mismatch

**Solutions:**

#### Solution A: Verify Server Status
```bash
# Test server health endpoint
curl https://your-server.com/health

# Test MCP endpoint
curl -X POST https://your-server.com/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc": "2.0", "method": "tools/list", "id": 1}'
```

#### Solution B: SSL Configuration
```json
{
  "specforged.customServer.url": "https://your-server.com/mcp",
  "specforged.customServer.verifySsl": true,
  "specforged.customServer.sslCertPath": "/path/to/cert.pem",
  "specforged.customServer.allowSelfSigned": false
}
```

#### Solution C: Authentication Configuration
```json
{
  "specforged.customServer.authType": "bearer|basic|apikey",
  "specforged.customServer.token": "your-token",
  "specforged.customServer.username": "username",
  "specforged.customServer.password": "password",
  "specforged.customServer.apiKeyHeader": "X-API-Key"
}
```

---

## VS Code Extension Problems

### Issue 11: Extension Not Activating

**Symptoms:**
- SpecForged commands not available in Command Palette
- Sidebar views not appearing
- Status bar items missing

**Root Causes:**
- Extension not installed properly
- VS Code version compatibility issues
- Extension activation conditions not met
- JavaScript runtime errors

**Solutions:**

#### Solution A: Verify Extension Installation
```bash
# Check installed extensions
code --list-extensions | grep specforged

# Reinstall if necessary
code --uninstall-extension specforged.specforged-mcp
code --install-extension specforged.specforged-mcp
```

#### Solution B: Check VS Code Version
```bash
# Check VS Code version (requires 1.85.0+)
code --version

# Update if necessary
# Help > Check for Updates
```

#### Solution C: Manual Activation
```bash
# Force extension activation
"Developer: Reload Window"
"Developer: Show Extension Development Host Log"
```

### Issue 12: WebView Not Loading

**Symptoms:**
- Blank webviews in extension panels
- "Failed to load resource" errors
- JavaScript console errors in webview

**Root Causes:**
- Content Security Policy violations
- Resource loading failures
- JavaScript execution errors
- WebView API changes

**Solutions:**

#### Solution A: Debug WebView
```bash
# Enable webview debugging
"Developer: Open WebView Developer Tools"
# Check console for errors
# Inspect network requests
```

#### Solution B: Content Security Policy
```json
// Check and adjust CSP if needed in extension
{
  "webview": {
    "csp": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';"
  }
}
```

#### Solution C: Resource Loading Issues
```bash
# Check extension resources
ls ~/.vscode/extensions/specforged.specforged-mcp-*/out/webview/
# Verify files are present and readable
```

### Issue 13: Settings Not Persisting

**Symptoms:**
- Configuration changes revert after restart
- Settings UI shows incorrect values
- Settings file not updating

**Root Causes:**
- Settings file permissions
- VS Code workspace vs user settings confusion
- Settings validation failures
- Concurrent settings modifications

**Solutions:**

#### Solution A: Check Settings Location
```bash
# User settings (global)
~/.config/Code/User/settings.json

# Workspace settings (project-specific)
.vscode/settings.json

# Verify file permissions
ls -la .vscode/settings.json
chmod 644 .vscode/settings.json
```

#### Solution B: Validate Settings Format
```bash
# Validate JSON syntax
cat .vscode/settings.json | jq .

# Fix syntax errors if found
```

#### Solution C: Settings Synchronization
```json
// Disable settings sync for troubleshooting
{
  "settingsSync.ignoredSettings": [
    "specforged.*"
  ]
}
```

---

## Conflict Resolution Issues

### Issue 14: Conflicts Not Detected

**Symptoms:**
- Concurrent modifications overwrite each other
- No conflict warnings displayed
- Data loss due to undetected conflicts

**Root Causes:**
- Conflict detection disabled
- File timestamp precision issues
- Hash calculation errors
- Race conditions in detection logic

**Solutions:**

#### Solution A: Enable Comprehensive Conflict Detection
```json
{
  "specforged.conflictDetection.enabled": true,
  "specforged.conflictDetection.method": "hash|timestamp|both",
  "specforged.conflictDetection.sensitivity": "high",
  "specforged.conflictDetection.checkInterval": 1000
}
```

#### Solution B: Force Conflict Check
```bash
# Manual conflict detection:
"SpecForged: Check for Conflicts"
"SpecForged: Force Conflict Scan"
"SpecForged: Validate File Integrity"
```

#### Solution C: Debug Conflict Detection
```bash
# Enable detailed logging:
"SpecForged: Enable Conflict Debug Logging"
# Review detection logic:
"SpecForged: Show Conflict Detection Report"
```

### Issue 15: Automatic Resolution Failing

**Symptoms:**
- Auto-merge produces invalid results
- Resolution strategy not applied
- Conflicts remain unresolved despite auto-resolution

**Root Causes:**
- Complex merge scenarios
- Invalid resolution strategy configuration
- Missing conflict resolution dependencies
- Merge algorithm limitations

**Solutions:**

#### Solution A: Adjust Resolution Strategy
```json
{
  "specforged.conflictResolution.defaultStrategy": "user_decide",
  "specforged.conflictResolution.autoMergeThreshold": 0.8,
  "specforged.conflictResolution.fallbackStrategy": "user_decide",
  "specforged.conflictResolution.enableSmartMerge": true
}
```

#### Solution B: Manual Resolution Interface
```bash
# Open resolution interface:
"SpecForged: Resolve Conflicts Manually"
"SpecForged: Show Conflict Details"
"SpecForged: Open Merge Editor"
```

#### Solution C: Resolution Recovery
```bash
# If resolution fails:
"SpecForged: Rollback Failed Resolution"
"SpecForged: Reset Conflict State"
"SpecForged: Export Conflict Data"
```

---

## Performance Problems

### Issue 16: Slow Operation Processing

**Symptoms:**
- Operations take excessive time to complete
- Extension becomes unresponsive
- High CPU or memory usage

**Root Causes:**
- Large queue backlog
- Inefficient operation processing
- Resource contention
- File system performance issues

**Solutions:**

#### Solution A: Optimize Queue Processing
```json
{
  "specforged.performance.maxConcurrentOperations": 3,
  "specforged.performance.enableBatching": true,
  "specforged.performance.batchSize": 10,
  "specforged.performance.processingTimeout": 30000
}
```

#### Solution B: Monitor Performance
```bash
# Performance analysis:
"SpecForged: Performance Dashboard"
"SpecForged: Operation Timing Report"
"SpecForged: Resource Usage Analysis"
```

#### Solution C: Resource Optimization
```json
{
  "specforged.resources.enableCaching": true,
  "specforged.resources.cacheSize": 100,
  "specforged.resources.cacheTTL": 300000,
  "specforged.resources.enableCompression": true
}
```

### Issue 17: Memory Usage Issues

**Symptoms:**
- VS Code crashes with out-of-memory errors
- System becomes slow when extension is active
- Memory usage grows over time

**Root Causes:**
- Memory leaks in extension code
- Large operation history retained
- Inefficient data structures
- File handles not released

**Solutions:**

#### Solution A: Memory Limits and Cleanup
```json
{
  "specforged.memory.maxQueueSize": 1000,
  "specforged.memory.maxHistorySize": 500,
  "specforged.memory.enableAutoCleanup": true,
  "specforged.memory.cleanupInterval": 300000
}
```

#### Solution B: Monitor Memory Usage
```bash
# Memory monitoring:
"SpecForged: Memory Usage Report"
"SpecForged: Enable Memory Profiling"
"SpecForged: Force Garbage Collection"
```

---

## Security and Permission Issues

### Issue 18: File Permission Errors

**Symptoms:**
- "Permission denied" when writing files
- Operations fail with access errors
- Some files can be read but not modified

**Root Causes:**
- Insufficient file system permissions
- File ownership issues
- Read-only file system
- Security software interference

**Solutions:**

#### Solution A: Fix File Permissions
```bash
# Check current permissions
ls -la .vscode/specforged/
ls -la .specifications/

# Fix permissions (be careful!)
chmod -R 755 .vscode/specforged/
chmod -R 755 .specifications/

# Fix ownership if necessary
sudo chown -R $USER:$USER .vscode/ .specifications/
```

#### Solution B: VS Code Workspace Trust
```bash
# Ensure workspace is trusted
"File: Trust Workspace"
# Check workspace trust status in status bar
```

#### Solution C: Security Software Configuration
```bash
# Add project directory to security software whitelist
# Configure real-time protection exclusions
# Test with security software temporarily disabled
```

---

## Platform-Specific Issues

### macOS Issues

#### Issue 19: Gatekeeper Blocking Execution
**Symptoms:** "specforged cannot be opened because the developer cannot be verified"

**Solutions:**
```bash
# Allow execution through System Preferences
# System Preferences > Security & Privacy > General > Allow anyway

# Or via command line
spctl --add --label "SpecForged" $(which specforged)
```

#### Issue 20: File System Access Restrictions
**Symptoms:** Operations fail despite correct permissions

**Solutions:**
```bash
# Grant Full Disk Access to VS Code
# System Preferences > Security & Privacy > Privacy > Full Disk Access > Add VS Code
```

### Windows Issues

#### Issue 21: Path Length Limitations
**Symptoms:** "Path too long" errors on Windows

**Solutions:**
```powershell
# Enable long path support (Windows 10/11)
# Group Policy: Computer Configuration > Administrative Templates > System > Filesystem
# Enable "Enable Win32 long paths"

# Or via registry
Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1
```

#### Issue 22: PowerShell Execution Policy
**Symptoms:** Scripts cannot be executed on Windows

**Solutions:**
```powershell
# Check current policy
Get-ExecutionPolicy

# Set policy to allow script execution
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Linux Issues

#### Issue 23: File System Permissions
**Symptoms:** Permission errors despite correct file ownership

**Solutions:**
```bash
# Check if directory is on a mounted filesystem with restrictions
mount | grep $(pwd)

# Check ACLs
getfacl .vscode/
# Fix ACLs if necessary
setfacl -R -m u:$USER:rwx .vscode/ .specifications/
```

#### Issue 24: Missing Dependencies
**Symptoms:** Extension or server fails to start on Linux

**Solutions:**
```bash
# Install missing system dependencies
sudo apt-get update
sudo apt-get install python3-dev python3-pip nodejs npm

# Or for RPM-based systems
sudo dnf install python3-devel python3-pip nodejs npm
```

---

## Advanced Debugging

### Enable Debug Mode

#### Extension Debug Mode
```json
// .vscode/settings.json
{
  "specforged.debug": true,
  "specforged.logLevel": "debug",
  "specforged.enableVerboseLogging": true,
  "specforged.logToFile": true,
  "specforged.logFilePath": ".vscode/specforged/debug.log"
}
```

#### Server Debug Mode
```bash
# Environment variables
export SPECFORGE_DEBUG=1
export SPECFORGE_LOG_LEVEL=debug

# Run server manually for debugging
specforged --debug --verbose
```

### Log Analysis

#### Extension Logs
```bash
# View in VS Code
# Help > Toggle Developer Tools > Console

# Or access log files directly
cat .vscode/specforged/debug.log
```

#### Server Logs
```bash
# Local server logs (if logging enabled)
cat /tmp/specforged-server.log

# Or check system logs
journalctl -f | grep specforged
```

### Performance Profiling

#### Enable Profiling
```bash
# Via Command Palette:
"SpecForged: Enable Performance Profiling"
"SpecForged: Start CPU Profiling"
"SpecForged: Start Memory Profiling"
```

#### Analyze Profiles
```bash
# Generate performance report:
"SpecForged: Generate Performance Report"
# Export profiling data:
"SpecForged: Export Profiling Data"
```

### Network Debugging

#### MCP Communication
```bash
# Enable MCP protocol logging
export SPECFORGE_MCP_DEBUG=1

# Monitor network traffic (for HTTP servers)
tcpdump -i any -A 'port 8080'
# Or use browser dev tools for HTTP servers
```

### File System Debugging

#### File Operation Tracing
```json
{
  "specforged.debug.traceFileOperations": true,
  "specforged.debug.logFileAccess": true,
  "specforged.debug.validateFileOperations": true
}
```

#### System Call Monitoring
```bash
# Linux/macOS - Monitor file system calls
strace -e trace=file -f -p $(pgrep -f specforged)
# macOS alternative
dtruss -f -p $(pgrep -f specforged)
```

---

## Getting Additional Help

### Community Resources
- **GitHub Issues**: https://github.com/whit3rabbit/SpecForge/issues
- **Discussions**: https://github.com/whit3rabbit/SpecForge/discussions
- **Documentation**: https://github.com/whit3rabbit/SpecForge#readme

### Bug Reporting

When reporting bugs, please include:

1. **System Information**:
   - OS version and architecture
   - VS Code version
   - Extension version
   - Node.js version
   - Python version

2. **Configuration**:
   - VS Code settings (relevant sections)
   - MCP server type and configuration
   - Environment variables

3. **Logs**:
   - Extension debug logs
   - Server logs (if available)
   - VS Code developer tools console output
   - System logs (if relevant)

4. **Reproduction Steps**:
   - Detailed steps to reproduce the issue
   - Expected vs actual behavior
   - Screenshots or recordings if applicable

### Debug Information Export

```bash
# Generate comprehensive debug report:
"SpecForged: Export Debug Information"
# This creates a zip file with:
# - Configuration files
# - Log files  
# - System information
# - Extension state
# - Queue status
# - Error reports
```

This troubleshooting guide covers the most common issues encountered with the SpecForged MCP ecosystem. For issues not covered here, please consult the documentation or create a new issue on GitHub with detailed information about your problem.