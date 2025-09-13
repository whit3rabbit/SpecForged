# SpecForged User Guide

A comprehensive guide to using the SpecForged MCP ecosystem for specification-driven development with operation queue management and conflict resolution.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Operation Queue Management](#operation-queue-management)
3. [Conflict Resolution](#conflict-resolution)
4. [VS Code Extension Features](#vs-code-extension-features)
5. [Configuration Management](#configuration-management)
6. [Performance Optimization](#performance-optimization)
7. [Security & Validation](#security--validation)
8. [Best Practices](#best-practices)

---

## Getting Started

### Quick Setup

#### Option 1: Complete Ecosystem (Recommended)
```bash
# 1. Install MCP server
pipx install specforged

# 2. Install VS Code extension
# - Open VS Code → Extensions (Ctrl+Shift+X)
# - Search "SpecForged MCP Ecosystem"
# - Click Install

# 3. Initialize your first project
# - Open Command Palette (Ctrl+Shift+P)
# - Run "SpecForged: Initialize Project"
```

#### Option 2: Traditional MCP Setup
```bash
# Install MCP server only
pipx install specforged

# Configure your MCP client (Claude Desktop, Cursor, etc.)
# See README.md for specific client configurations
```

### First Project Setup

1. **Open VS Code** in your project directory
2. **Initialize SpecForged**: Command Palette → "SpecForged: Initialize Project"
3. **Choose project template**: Select from available templates (web-app, rest-api, etc.)
4. **Start specification wizard**: Follow guided prompts for requirements and design

---

## Operation Queue Management

The SpecForged ecosystem uses an advanced operation queue system to handle all MCP operations asynchronously with conflict detection and resolution.

### Understanding the Operation Queue

```
┌─────────────────────────────────────────────────────────────────┐
│                    Operation Queue Flow                        │
├─────────────────────────────────────────────────────────────────┤
│  User Action → Queue Entry → Conflict Check → Processing       │
│                                    ↓                           │
│               Success ← Completion ← Execution                  │
│                   ↓                     ↓                      │
│            File Updates         Error/Conflict                 │
│                                        ↓                      │
│                               Resolution Strategy               │
│                         (Auto/Manual/Retry/Cancel)            │
└─────────────────────────────────────────────────────────────────┘
```

### Operation Types

The queue handles these operation types:

- **`CREATE_SPEC`** - Create new specification
- **`UPDATE_REQUIREMENTS`** - Modify requirements.md
- **`UPDATE_DESIGN`** - Modify design.md  
- **`UPDATE_TASKS`** - Modify tasks.md
- **`UPDATE_TASK_STATUS`** - Check/uncheck tasks
- **`ADD_USER_STORY`** - Add new user stories
- **`SYNC_STATUS`** - Synchronization operations
- **`FORCE_SYNC`** - Manual sync triggers

### Queue Status Monitoring

#### Via VS Code Extension
1. **Open SpecForged Sidebar** (Activity Bar → SpecForged icon)
2. **Navigate to "Operations" tab**
3. **View queue status**:
   - Pending operations
   - Processing operations
   - Completed operations
   - Failed/conflicted operations

#### Via Command Palette
- **"SpecForged: Show Operation Queue"** - Display current queue status
- **"SpecForged: Queue Statistics"** - Show processing metrics
- **"SpecForged: Clear Completed Operations"** - Clean up queue history

### Queue File Structure

The operation queue uses file-based IPC in `.vscode/specforged/`:

```
.vscode/specforged/
├── operation_queue.json     # Pending operations
├── operation_results.json   # Completed operations  
├── sync_state.json         # Synchronization state
├── conflicts.json          # Active conflicts
└── queue_config.json       # Queue configuration
```

#### Sample Operation Entry
```json
{
  "id": "op_1704830400123",
  "type": "UPDATE_REQUIREMENTS",
  "status": "PENDING",
  "priority": "NORMAL",
  "created_at": "2025-01-09T10:30:00Z",
  "parameters": {
    "spec_name": "user-auth",
    "content": "Updated requirements content...",
    "operation_source": "extension"
  },
  "retry_count": 0,
  "max_retries": 3,
  "timeout": 30000,
  "dependencies": [],
  "metadata": {
    "user_initiated": true,
    "batch_id": null
  }
}
```

### Managing Queue Operations

#### Viewing Operations
```bash
# Command Palette commands:
"SpecForged: Show Operation Details" - View specific operation details
"SpecForged: Operation History" - Show completed operations
"SpecForged: Export Operation Log" - Export queue history
```

#### Controlling Operations
```bash
# Operation control commands:
"SpecForged: Cancel Operation" - Cancel pending operation
"SpecForged: Retry Failed Operation" - Retry specific failed operation
"SpecForged: Pause Queue Processing" - Temporarily halt queue
"SpecForged: Resume Queue Processing" - Resume processing
```

#### Queue Configuration
```json
// .vscode/settings.json
{
  "specforged.queue.maxConcurrentOperations": 3,
  "specforged.queue.defaultTimeout": 30000,
  "specforged.queue.retryAttempts": 3,
  "specforged.queue.batchSize": 10,
  "specforged.queue.cleanupInterval": 300000,
  "specforged.queue.enableMetrics": true
}
```

---

## Conflict Resolution

The SpecForged ecosystem includes sophisticated conflict detection and resolution capabilities.

### Types of Conflicts

#### 1. Concurrent Modification Conflicts
**Description**: Multiple operations attempting to modify the same file simultaneously.

**Detection**:
- File modification timestamp changes
- Content hash mismatches
- Overlapping operation time windows

**Resolution Strategies**:
- **MERGE**: Automatically merge compatible changes
- **USER_DECIDE**: Present conflict resolution dialog
- **EXTENSION_WINS**: Use extension operation (local wins)
- **MCP_WINS**: Use MCP server operation (remote wins)

#### 2. Duplicate Operation Conflicts
**Description**: Identical operations in the queue (same type, parameters, target).

**Detection**:
- Content hash comparison
- Parameter matching
- Target resource identification

**Resolution Strategy**:
- **CANCEL**: Automatically cancel newer duplicate

#### 3. Resource Lock Conflicts
**Description**: File system locks preventing write access.

**Detection**:
- File system permission errors
- Exclusive file access by other processes
- Network file system locks

**Resolution Strategy**:
- **RETRY**: Exponential backoff retry with maximum attempts

#### 4. Dependency Conflicts
**Description**: Operations requiring completion of other pending operations.

**Detection**:
- Missing prerequisite files
- Incomplete related operations
- Circular dependencies

**Resolution Strategies**:
- **REORDER**: Change operation execution order
- **DEFER**: Postpone operation until dependencies are met
- **SPLIT**: Break complex operation into smaller parts

### Conflict Resolution UI

#### Automatic Resolution
```json
// Conflict resolution rules (automatic)
{
  "DUPLICATE_OPERATION": "CANCEL",      // Cancel newer duplicate
  "RESOURCE_LOCKED": "RETRY",           // Retry with backoff
  "PRIORITY_CONFLICT": "REORDER",       // Reorder by priority
  "SIMPLE_MERGE": "MERGE"               // Auto-merge compatible changes
}
```

#### Manual Resolution Dialog

When conflicts require user intervention, VS Code displays:

1. **Conflict Details Panel**:
   - Description of conflicting operations
   - Affected files and changes
   - Timestamp and operation sources

2. **Resolution Options**:
   - Available strategies for the conflict type
   - Preview of each resolution outcome
   - Risk assessment and recommendations

3. **Interactive Resolution**:
   - Side-by-side content comparison
   - Manual merge assistance
   - Undo/rollback capabilities

#### Resolution Commands
```bash
# Manual conflict resolution:
"SpecForged: Resolve Conflicts" - Open conflict resolution interface
"SpecForged: Show Conflict Details" - View specific conflict information
"SpecForged: Accept Extension Changes" - Use local changes
"SpecForged: Accept Server Changes" - Use remote changes
"SpecForged: Merge Changes" - Attempt automatic merge
"SpecForged: Manual Merge" - Open merge editor
```

### Conflict Prevention

#### Best Practices
1. **Single Source of Truth**: Use VS Code extension for all file operations
2. **Atomic Operations**: Group related changes into single operations
3. **Regular Sync**: Frequently sync with MCP server
4. **Operation Batching**: Bundle similar operations to reduce conflicts
5. **Queue Monitoring**: Watch for pending operations before making changes

#### Configuration for Prevention
```json
// .vscode/settings.json - Conflict prevention
{
  "specforged.conflictPrevention.enableLocking": true,
  "specforged.conflictPrevention.debounceDelay": 1000,
  "specforged.conflictPrevention.batchOperations": true,
  "specforged.conflictPrevention.preConflictCheck": true
}
```

---

## VS Code Extension Features

### Sidebar Views

#### 1. Specifications View
- **Specification Tree**: Hierarchical view of all specifications
- **Status Indicators**: Visual status (draft, in-progress, completed)
- **Quick Actions**: Create, edit, delete specifications
- **Progress Tracking**: Completion percentage and task counts

#### 2. Operations View
- **Queue Monitor**: Real-time operation queue status
- **Operation History**: Completed and failed operations
- **Conflict Alerts**: Active conflicts requiring attention
- **Performance Metrics**: Queue processing statistics

#### 3. Settings View
- **Server Configuration**: MCP server type and connection settings
- **Queue Settings**: Operation queue behavior configuration
- **Conflict Resolution**: Default resolution strategies
- **Profile Management**: Save/load configuration profiles

### Status Bar Integration

The extension adds status bar items showing:
- **Active Operations**: Number of pending/processing operations
- **Conflict Count**: Number of unresolved conflicts
- **Sync Status**: Connection status with MCP server
- **Progress Indicator**: Current specification development progress

### Command Palette Commands

#### Project Management
```bash
"SpecForged: Initialize Project" - Set up .specifications folder
"SpecForged: Create Specification" - New specification wizard
"SpecForged: Import Specification" - Import existing specification
"SpecForged: Export Specification" - Export specification files
```

#### Server Management
```bash
"SpecForged: Switch to Local Server" - Use local MCP server
"SpecForged: Switch to Smithery Server" - Use cloud deployment
"SpecForged: Switch to Custom Server" - Use custom HTTP server
"SpecForged: Test MCP Connection" - Verify server connectivity
"SpecForged: Restart MCP Server" - Restart local server
```

#### Operation Management
```bash
"SpecForged: Show Operation Queue" - Display queue interface
"SpecForged: Cancel All Operations" - Cancel all pending operations
"SpecForged: Retry Failed Operations" - Retry all failed operations
"SpecForged: Clear Operation History" - Clean up completed operations
```

#### Synchronization
```bash
"SpecForged: Manual Sync" - Force sync with MCP server
"SpecForged: Sync Status" - Show sync state information
"SpecForged: Resolve Sync Conflicts" - Handle sync conflicts
"SpecForged: Reset Sync State" - Reset synchronization state
```

### WebView Interfaces

#### 1. MCP Dashboard
- **Connection Overview**: Status of all configured MCP servers
- **Server Statistics**: Performance metrics and health status
- **Quick Setup**: One-click server configuration
- **Troubleshooting**: Connection diagnostics and fixes

#### 2. Operation Queue Manager
- **Visual Queue**: Drag-and-drop operation reordering
- **Batch Operations**: Group and execute multiple operations
- **Progress Visualization**: Real-time progress bars and indicators
- **Error Analysis**: Detailed error information and solutions

#### 3. Conflict Resolution Interface
- **Side-by-side Comparison**: Visual diff of conflicting changes
- **Merge Assistance**: Guided merge with conflict markers
- **Resolution History**: Track of resolved conflicts
- **Resolution Templates**: Saved resolution patterns

---

## Configuration Management

### Server Configuration

#### Local Server
```json
// .vscode/settings.json
{
  "specforged.mcpServerType": "local",
  "specforged.localServerPath": "specforged",
  "specforged.localServerArgs": [],
  "specforged.localServerTimeout": 10000,
  "specforged.autoStartLocalServer": true
}
```

#### Smithery Cloud Server
```json
{
  "specforged.mcpServerType": "smithery",
  "specforged.smitheryServerName": "specforged",
  "specforged.smitheryApiKey": "your-api-key",
  "specforged.smitheryServerTimeout": 15000,
  "specforged.enableCloudFeatures": true
}
```

#### Custom HTTP Server
```json
{
  "specforged.mcpServerType": "custom",
  "specforged.customServerUrl": "https://your-server.com/mcp",
  "specforged.customServerAuth": "bearer",
  "specforged.customServerToken": "your-token",
  "specforged.customServerTimeout": 20000
}
```

### Profile Management

#### Creating Configuration Profiles
1. **Configure Settings**: Set up MCP server, queue, and conflict resolution settings
2. **Export Profile**: Command Palette → "SpecForged: Export Configuration Profile"
3. **Name Profile**: Give profile descriptive name (e.g., "Local Development", "Team Collaboration")
4. **Save Location**: Save as JSON file for sharing/backup

#### Profile Templates
```json
// Local Development Profile
{
  "name": "Local Development",
  "description": "Full-featured local development setup",
  "settings": {
    "specforged.mcpServerType": "local",
    "specforged.queue.maxConcurrentOperations": 5,
    "specforged.conflictResolution.defaultStrategy": "user_decide",
    "specforged.autoSync": true,
    "specforged.enableAdvancedFeatures": true
  }
}

// Team Collaboration Profile  
{
  "name": "Team Collaboration",
  "description": "Shared development with cloud server",
  "settings": {
    "specforged.mcpServerType": "smithery",
    "specforged.queue.maxConcurrentOperations": 3,
    "specforged.conflictResolution.defaultStrategy": "merge",
    "specforged.autoSync": false,
    "specforged.enableTeamFeatures": true
  }
}
```

#### Applying Profiles
1. **Import Profile**: Command Palette → "SpecForged: Import Configuration Profile"
2. **Select Profile**: Choose from saved profiles or browse for JSON file
3. **Review Changes**: Preview configuration changes before applying
4. **Apply Settings**: Confirm and apply profile settings

### Workspace Settings

#### Project-Specific Configuration
```json
// .vscode/settings.json (project-specific)
{
  "specforged.projectSettings": {
    "defaultSpecTemplate": "web-app",
    "requirementsValidation": true,
    "autoGenerateTasks": true,
    "taskNumberingScheme": "hierarchical",
    "earsNotationEnforcement": "strict"
  }
}
```

#### Team Settings Synchronization
```json
// .vscode/settings.json (team shared)
{
  "specforged.teamSettings": {
    "sharedProfileUrl": "https://your-team.com/specforged-profile.json",
    "autoUpdateProfile": true,
    "enforceTeamStandards": true,
    "allowLocalOverrides": false
  }
}
```

---

## Performance Optimization

### Queue Performance

#### Optimization Settings
```json
// .vscode/settings.json - Performance tuning
{
  "specforged.performance": {
    "enableBatching": true,
    "batchSize": 10,
    "batchTimeout": 5000,
    "enableCaching": true,
    "cacheSize": 100,
    "cacheTTL": 300000,
    "enableCompression": true,
    "compressionLevel": 6,
    "maxQueueSize": 1000,
    "cleanupInterval": 300000
  }
}
```

#### Performance Monitoring
1. **Queue Metrics**: Track operation processing rates
2. **Memory Usage**: Monitor extension and server memory consumption  
3. **File I/O**: Measure file system operation latency
4. **Network Latency**: Monitor MCP server communication times

#### Performance Dashboard
Access via Command Palette → "SpecForged: Performance Dashboard":
- **Operation Throughput**: Operations per minute
- **Average Completion Time**: Mean operation processing time
- **Error Rates**: Failed operations percentage
- **Resource Usage**: Memory and CPU utilization
- **Queue Health**: Queue size trends and bottlenecks

### File System Optimization

#### Atomic File Operations
The extension uses atomic file operations to ensure data integrity:

```typescript
// Example: Atomic specification update
async updateSpecificationAtomic(specPath: string, content: string) {
  const tempFile = `${specPath}.tmp`;
  const backupFile = `${specPath}.backup`;
  
  try {
    // 1. Write to temporary file
    await fs.writeFile(tempFile, content);
    
    // 2. Create backup of original
    await fs.copyFile(specPath, backupFile);
    
    // 3. Atomic move temp to target
    await fs.rename(tempFile, specPath);
    
    // 4. Clean up backup
    await fs.unlink(backupFile);
    
  } catch (error) {
    // Rollback on error
    if (await fs.exists(backupFile)) {
      await fs.rename(backupFile, specPath);
    }
    throw error;
  }
}
```

#### File Watching Optimization
```json
// .vscode/settings.json - File watching optimization
{
  "specforged.fileWatcher": {
    "enabled": true,
    "debounceDelay": 500,
    "excludePatterns": ["node_modules/**", ".git/**"],
    "includePatterns": [".specifications/**/*.md", ".specifications/**/*.json"],
    "usePolling": false,
    "pollingInterval": 1000
  }
}
```

---

## Security & Validation

### Data Validation

#### Input Validation
All user inputs are validated before processing:

```typescript
// Example: Specification name validation
function validateSpecificationName(name: string): ValidationResult {
  const rules = [
    { test: name.length >= 3, message: "Name must be at least 3 characters" },
    { test: name.length <= 100, message: "Name must not exceed 100 characters" },
    { test: /^[a-zA-Z0-9\s\-_]+$/.test(name), message: "Name contains invalid characters" },
    { test: !/^[\s\-_]/.test(name), message: "Name cannot start with space, dash, or underscore" }
  ];
  
  const errors = rules.filter(rule => !rule.test).map(rule => rule.message);
  return { isValid: errors.length === 0, errors };
}
```

#### Content Sanitization
- **HTML Sanitization**: Strip harmful HTML/JavaScript from user content
- **Path Validation**: Ensure file paths stay within project boundaries
- **JSON Validation**: Validate all JSON configurations before processing
- **Schema Validation**: Enforce specification file schemas

### Access Control

#### File System Security
```json
// .vscode/settings.json - Security settings
{
  "specforged.security": {
    "restrictFileAccess": true,
    "allowedPaths": [".specifications/**", ".vscode/specforged/**"],
    "blockedPaths": ["node_modules/**", ".git/**", "*.env"],
    "maxFileSize": "10MB",
    "enablePathTraversal": false,
    "sandboxOperations": true
  }
}
```

#### Operation Permissions
```typescript
// Example: Permission check for file operations
interface OperationPermissions {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canExecute: boolean;
  requiresElevation: boolean;
}

function checkOperationPermissions(
  operation: McpOperation,
  user: UserContext
): OperationPermissions {
  const basePermissions = getUserPermissions(user);
  const resourcePermissions = getResourcePermissions(operation.targetPath);
  
  return {
    canRead: basePermissions.read && resourcePermissions.read,
    canWrite: basePermissions.write && resourcePermissions.write,
    canDelete: basePermissions.delete && resourcePermissions.delete,
    canExecute: basePermissions.execute && resourcePermissions.execute,
    requiresElevation: operation.type === 'DELETE_SPEC' || 
                      operation.targetPath.includes('system/')
  };
}
```

### Audit Trail

#### Operation Logging
All operations are logged for security auditing:

```json
// Example: Operation log entry
{
  "timestamp": "2025-01-09T10:30:00Z",
  "operationId": "op_1234567890",
  "type": "UPDATE_REQUIREMENTS",
  "user": "developer@company.com",
  "source": "extension",
  "targetPath": ".specifications/user-auth/requirements.md",
  "success": true,
  "duration": 1250,
  "changes": {
    "linesAdded": 5,
    "linesModified": 2,
    "linesDeleted": 0
  },
  "metadata": {
    "clientVersion": "0.3.1",
    "serverVersion": "0.3.1",
    "environment": "development"
  }
}
```

#### Security Events
Special logging for security-relevant events:

```json
{
  "timestamp": "2025-01-09T10:35:00Z",
  "event": "PERMISSION_DENIED",
  "severity": "warning",
  "details": {
    "operation": "DELETE_SPEC",
    "targetPath": ".specifications/production-config/",
    "reason": "User lacks delete permissions for production specifications",
    "user": "junior-dev@company.com",
    "clientIP": "192.168.1.100"
  }
}
```

---

## Best Practices

### Development Workflow

#### 1. Project Initialization
```bash
# Best practice setup sequence:
1. Create project directory
2. Initialize git repository  
3. Open in VS Code
4. Install SpecForged extension
5. Run "SpecForged: Initialize Project"
6. Select appropriate project template
7. Configure MCP server type
8. Start specification wizard
```

#### 2. Specification Development
```bash
# Recommended workflow:
1. Requirements Phase:
   - Use wizard for guided user story creation
   - Apply EARS notation for acceptance criteria
   - Validate completeness before proceeding

2. Design Phase:
   - Document architecture decisions
   - Define component interfaces
   - Create data models and schemas
   - Add sequence diagrams for complex flows

3. Implementation Planning:
   - Generate hierarchical task breakdown
   - Review and adjust task dependencies
   - Estimate effort for each task
   - Link tasks to specific requirements

4. Execution Phase:
   - Use VS Code extension for task tracking
   - Monitor operation queue for conflicts
   - Maintain atomic commits per task
   - Update progress regularly
```

#### 3. Team Collaboration
```bash
# Team workflow recommendations:
1. Shared Configuration:
   - Use Smithery cloud server for team intelligence
   - Share VS Code configuration profiles
   - Establish team coding standards
   - Document conflict resolution procedures

2. Version Control:
   - Commit specification files to git
   - Use conventional commit messages
   - Create feature branches for major specs
   - Review specifications in pull requests

3. Conflict Resolution:
   - Monitor operation queue regularly
   - Resolve conflicts promptly
   - Communicate with team about major changes
   - Use merge strategies consistently
```

### Performance Best Practices

#### 1. Queue Management
- **Batch Related Operations**: Group similar changes into single operations
- **Monitor Queue Size**: Keep queue size reasonable (< 100 operations)
- **Clean Up Completed Operations**: Regularly clear operation history
- **Use Priority Settings**: Set appropriate operation priorities

#### 2. File Operations
- **Minimize File Watches**: Exclude unnecessary directories from file watching
- **Use Atomic Operations**: Ensure data integrity with atomic file updates
- **Optimize File Sizes**: Keep specification files reasonably sized
- **Regular Cleanup**: Remove temporary and backup files

#### 3. Network Optimization
- **Connection Pooling**: Reuse MCP server connections
- **Request Batching**: Combine multiple API calls when possible
- **Timeout Configuration**: Set appropriate timeouts for different operations
- **Error Recovery**: Implement exponential backoff for retry logic

### Security Best Practices

#### 1. Access Control
- **Principle of Least Privilege**: Grant minimum necessary permissions
- **Path Validation**: Always validate file paths before operations
- **Input Sanitization**: Sanitize all user inputs
- **Audit Logging**: Maintain comprehensive operation logs

#### 2. Configuration Security
- **Secure API Keys**: Store API keys securely (not in version control)
- **Environment Variables**: Use environment variables for sensitive configuration
- **Access Restrictions**: Limit file system access to project directories
- **Regular Updates**: Keep extension and server updated

#### 3. Data Protection
- **Backup Strategy**: Regular backups of specification files
- **Encryption**: Use HTTPS for all network communication
- **Data Validation**: Validate all data before processing
- **Error Handling**: Handle errors gracefully without exposing sensitive information

### Troubleshooting Best Practices

#### 1. Monitoring
- **Enable Debug Logging**: Turn on detailed logging for troubleshooting
- **Monitor Performance Metrics**: Track queue performance and resource usage
- **Watch for Patterns**: Identify recurring issues or bottlenecks
- **Health Checks**: Regular connection and functionality tests

#### 2. Issue Resolution
- **Systematic Approach**: Follow consistent troubleshooting procedures
- **Documentation**: Document solutions for future reference
- **Team Communication**: Share solutions with team members
- **Escalation Path**: Know when and how to escalate complex issues

#### 3. Preventive Measures
- **Regular Maintenance**: Perform routine system maintenance
- **Configuration Reviews**: Periodically review and optimize configurations
- **Training**: Ensure team members understand the system
- **Best Practice Adherence**: Follow established procedures consistently

---

This user guide provides comprehensive coverage of the SpecForged MCP ecosystem, focusing on operation queue management, conflict resolution, and best practices for effective use of the system. For additional help, see the [Troubleshooting Guide](TROUBLESHOOTING.md) and [API Documentation](API.md).