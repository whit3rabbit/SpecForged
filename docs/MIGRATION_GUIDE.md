# SpecForged Migration Guide

A comprehensive guide for upgrading SpecForged installations and configurations from previous versions to the enhanced MCP ecosystem (v0.3.2+).

## Table of Contents

1. [Migration Overview](#migration-overview)
2. [Pre-Migration Checklist](#pre-migration-checklist)
3. [Version-Specific Migrations](#version-specific-migrations)
4. [Data Migration Procedures](#data-migration-procedures)
5. [Configuration Migration](#configuration-migration)
6. [VS Code Extension Setup](#vs-code-extension-setup)
7. [Troubleshooting Migration Issues](#troubleshooting-migration-issues)
8. [Rollback Procedures](#rollback-procedures)
9. [Post-Migration Validation](#post-migration-validation)

---

## Migration Overview

### What's New in v0.3.2

The SpecForged MCP ecosystem has been significantly enhanced with:

- **Complete MCP Ecosystem**: VS Code extension + enhanced MCP server + queue processing
- **File-based IPC**: Advanced inter-process communication between extension and server
- **Operation Queue Management**: Visual UI for monitoring and controlling all operations
- **Advanced Conflict Resolution**: Smart detection with multiple automated and manual resolution strategies
- **Multi-Server Support**: Seamless switching between local, cloud, and custom MCP servers
- **Enhanced Performance**: Batching, caching, and resource optimization
- **Comprehensive Security**: Input validation, access control, and audit logging

### Migration Paths

| From Version | To Version | Migration Type | Complexity | Downtime |
|--------------|------------|----------------|------------|----------|
| v0.1.x | v0.3.2 | Major upgrade | High | ~30 minutes |
| v0.2.x | v0.3.2 | Feature upgrade | Medium | ~15 minutes |
| v0.3.0-0.3.1 | v0.3.2 | Patch upgrade | Low | ~5 minutes |

---

## Pre-Migration Checklist

### 1. Backup Current Installation

```bash
# Create migration backup directory
mkdir -p ~/specforged-migration-backup-$(date +%Y%m%d)
cd ~/specforged-migration-backup-$(date +%Y%m%d)

# Backup specifications
cp -r ~/.specifications/ ./specifications-backup/ 2>/dev/null || echo "No global specifications found"
find . -name ".specifications" -type d -exec cp -r {} ./project-specifications-{} \; 2>/dev/null

# Backup VS Code settings
cp ~/.config/Code/User/settings.json ./vscode-settings-backup.json 2>/dev/null || echo "No VS Code user settings found"

# Backup MCP client configurations
cp ~/Library/Application\ Support/Claude/claude_desktop_config.json ./claude-config-backup.json 2>/dev/null || echo "No Claude config found"
cp ~/.cursor/mcp_config.json ./cursor-config-backup.json 2>/dev/null || echo "No Cursor config found"
cp ~/.codeium/windsurf/mcp_config.json ./windsurf-config-backup.json 2>/dev/null || echo "No Windsurf config found"

# Backup current SpecForged installation info
which specforged > ./current-installation-path.txt 2>/dev/null || echo "not found" > ./current-installation-path.txt
specforged --version > ./current-version.txt 2>/dev/null || echo "not installed" > ./current-version.txt
pip list | grep specforged > ./pip-info.txt 2>/dev/null || echo "not found via pip" > ./pip-info.txt

echo "Backup completed in: $(pwd)"
```

### 2. Check System Requirements

```bash
# Check Python version (3.10+ required)
python --version
python3 --version

# Check VS Code version (1.85.0+ required)
code --version

# Check Node.js version (18+ recommended for extension development)
node --version

# Check available disk space (minimum 500MB recommended)
df -h ~/.vscode/ || df -h ~

# Check network connectivity for cloud features
curl -s https://server.smithery.ai/health || echo "Smithery connectivity test failed"
```

### 3. Document Current Configuration

```bash
# Export current MCP client configurations
echo "=== Claude Desktop Config ===" > ./current-config-summary.txt
cat ~/Library/Application\ Support/Claude/claude_desktop_config.json >> ./current-config-summary.txt 2>/dev/null || echo "Not found" >> ./current-config-summary.txt

echo -e "\n=== VS Code Settings ===" >> ./current-config-summary.txt
cat ~/.config/Code/User/settings.json | jq '.specforged // "No SpecForged settings"' >> ./current-config-summary.txt 2>/dev/null || echo "No VS Code settings" >> ./current-config-summary.txt

# Document project specifications
echo -e "\n=== Project Specifications ===" >> ./current-config-summary.txt
find . -name ".specifications" -type d | while read dir; do
  echo "Project: $(dirname $dir)" >> ./current-config-summary.txt
  ls -la "$dir" >> ./current-config-summary.txt
done
```

---

## Version-Specific Migrations

### From v0.1.x to v0.3.2

This is a major upgrade requiring complete reinstallation and configuration migration.

#### Step 1: Uninstall Old Version
```bash
# Remove old installation
pipx uninstall specforged
pip uninstall specforged  # If installed via pip

# Clean up old configuration files
rm -rf ~/.specforged-config 2>/dev/null  # Old config location
```

#### Step 2: Install New Version
```bash
# Install latest version
pipx install specforged

# Verify installation
specforged --version  # Should show v0.3.2+
```

#### Step 3: Install VS Code Extension
```bash
# Option 1: Via VS Code Marketplace
# Open VS Code → Extensions → Search "SpecForged MCP Ecosystem" → Install

# Option 2: Via Command Line
code --install-extension specforged.specforged-mcp
```

#### Step 4: Migrate Specifications

v0.1.x stored specifications in a different format. Migration is required:

```bash
# Run migration tool
specforged migrate --from-version=0.1 --backup-dir=~/specforged-migration-backup-$(date +%Y%m%d)

# Or manual migration:
python -c "
import json
import os
from pathlib import Path

# Migrate old specification format to new format
def migrate_v01_specs():
    old_specs = Path.home() / '.specifications'
    if not old_specs.exists():
        print('No v0.1 specifications found')
        return
    
    for spec_file in old_specs.glob('*.json'):
        with open(spec_file) as f:
            old_spec = json.load(f)
        
        # Convert to new format
        new_spec = {
            'spec_id': old_spec.get('id', spec_file.stem),
            'name': old_spec.get('name', spec_file.stem),
            'description': old_spec.get('description', ''),
            'status': 'IN_PROGRESS',  # Default status
            'phase': 'REQUIREMENTS',  # Default phase
            'user_stories': old_spec.get('requirements', []),
            'created_at': old_spec.get('created_at', ''),
            'updated_at': old_spec.get('updated_at', '')
        }
        
        # Create new specification directory
        new_spec_dir = Path('.specifications') / new_spec['spec_id']
        new_spec_dir.mkdir(parents=True, exist_ok=True)
        
        # Save new format
        with open(new_spec_dir / 'spec.json', 'w') as f:
            json.dump(new_spec, f, indent=2)
        
        print(f'Migrated: {spec_file.name} → {new_spec_dir}')

migrate_v01_specs()
"
```

### From v0.2.x to v0.3.2

This is a feature upgrade with some breaking changes in configuration format.

#### Step 1: Update Installation
```bash
# Update via pipx
pipx upgrade specforged

# Verify new version
specforged --version  # Should show v0.3.2+
```

#### Step 2: Install VS Code Extension
```bash
# Install new extension (major new feature)
code --install-extension specforged.specforged-mcp
```

#### Step 3: Update Configuration Format

Configuration keys have changed in v0.3.2:

```python
# Configuration migration script
import json
import os

def migrate_v02_config():
    config_files = [
        os.path.expanduser('~/.config/Code/User/settings.json'),
        '.vscode/settings.json'
    ]
    
    for config_file in config_files:
        if not os.path.exists(config_file):
            continue
            
        with open(config_file) as f:
            config = json.load(f)
        
        # Migrate old settings to new format
        migrations = {
            'specforged.server.path': 'specforged.localServer.path',
            'specforged.server.args': 'specforged.localServer.args',
            'specforged.server.timeout': 'specforged.localServer.timeout',
            'specforged.mode.enableAutoClassification': 'specforged.classification.autoMode',
            'specforged.workflow.enforcePhases': 'specforged.workflow.enforceSequence'
        }
        
        updated = False
        for old_key, new_key in migrations.items():
            if old_key in config:
                config[new_key] = config.pop(old_key)
                updated = True
        
        # Add new required settings
        if 'specforged.mcpServerType' not in config:
            config['specforged.mcpServerType'] = 'local'
            updated = True
        
        if updated:
            with open(config_file, 'w') as f:
                json.dump(config, f, indent=2)
            print(f'Updated: {config_file}')

migrate_v02_config()
```

### From v0.3.0-0.3.1 to v0.3.2

This is a patch upgrade with minimal breaking changes.

#### Step 1: Simple Update
```bash
# Update installation
pipx upgrade specforged

# Install VS Code extension if not already installed
code --install-extension specforged.specforged-mcp
```

#### Step 2: Update Extension Settings
```json
// Add to .vscode/settings.json or user settings
{
  "specforged.enableOperationQueue": true,
  "specforged.conflictResolution.defaultStrategy": "user_decide"
}
```

---

## Data Migration Procedures

### Specification File Migration

#### Automated Migration
```bash
# Use built-in migration tool
specforged migrate-specs --version=auto --validate

# Specific version migration
specforged migrate-specs --from=0.2 --to=0.3.2 --backup
```

#### Manual Migration Process

1. **Backup Existing Specifications**
```bash
cp -r .specifications/ .specifications-backup-$(date +%Y%m%d)/
```

2. **Validate Current Format**
```bash
# Check specification format
find .specifications/ -name "*.json" -exec python -m json.tool {} \; > /dev/null
echo "JSON validation complete"
```

3. **Convert File Structure**
```bash
# New v0.3.2 structure requires operation queue files
for spec_dir in .specifications/*/; do
  mkdir -p "$spec_dir/.queue"
  echo '{"operations": [], "version": "1.0"}' > "$spec_dir/.queue/operations.json"
  echo '{"last_sync": null, "state": "clean"}' > "$spec_dir/.queue/sync_state.json"
done
```

### Task Format Migration

v0.3.2 introduces enhanced checkbox task format:

```python
# Task format migration script
import re
import os
from pathlib import Path

def migrate_task_format():
    for tasks_file in Path('.specifications').glob('*/tasks.md'):
        with open(tasks_file) as f:
            content = f.read()
        
        # Convert old task format to checkbox format
        # Old: "1. Task title - Task description"
        # New: "- [ ] 1. Task title\n  - Task description\n  - _Requirements: ..._"
        
        lines = content.split('\n')
        new_lines = []
        
        for line in lines:
            # Match old task format
            match = re.match(r'^(\d+(?:\.\d+)*)\.\s+(.+?)\s*-\s*(.+)$', line)
            if match:
                task_num, title, description = match.groups()
                new_lines.append(f'- [ ] {task_num}. {title}')
                new_lines.append(f'  - {description}')
                new_lines.append(f'  - _Requirements: TBD_')  # Placeholder
            else:
                new_lines.append(line)
        
        # Write updated content
        with open(tasks_file, 'w') as f:
            f.write('\n'.join(new_lines))
        
        print(f'Migrated task format: {tasks_file}')

migrate_task_format()
```

---

## Configuration Migration

### VS Code Settings Migration

#### Automatic Migration
```bash
# Via Command Palette in VS Code:
"SpecForged: Migrate Configuration"
"SpecForged: Import Legacy Settings"
```

#### Manual Settings Update
```json
// .vscode/settings.json - Updated configuration format
{
  // Server configuration (new structure)
  "specforged.mcpServerType": "local",  // New: local|smithery|custom
  "specforged.localServer": {
    "path": "specforged",
    "args": [],
    "timeout": 10000,
    "autoStart": true
  },
  
  // Operation queue (new feature)
  "specforged.queue": {
    "enabled": true,
    "maxConcurrentOperations": 3,
    "defaultTimeout": 30000,
    "autoCleanup": true
  },
  
  // Conflict resolution (new feature)
  "specforged.conflictResolution": {
    "defaultStrategy": "user_decide",
    "enableAutoMerge": true,
    "showResolutionDialog": true
  },
  
  // Performance optimization (enhanced)
  "specforged.performance": {
    "enableCaching": true,
    "batchOperations": true,
    "compressionLevel": 6
  }
}
```

### MCP Client Configuration Migration

#### Claude Desktop
```json
// Old configuration (~/.claude/claude_desktop_config.json)
{
  "mcpServers": {
    "specforged": {
      "command": "specforged"
    }
  }
}

// New configuration (enhanced with queue support)
{
  "mcpServers": {
    "specforged": {
      "command": "specforged",
      "args": [],
      "env": {
        "SPECFORGE_ENABLE_QUEUE": "true",
        "SPECFORGE_QUEUE_TIMEOUT": "30000",
        "SPECFORGE_PROJECT_ROOT": "/absolute/path/to/project"
      }
    }
  }
}
```

#### Cursor IDE
```json
// .cursor/mcp.json - Enhanced configuration
{
  "mcpServers": {
    "specforged": {
      "command": "specforged",
      "args": [],
      "env": {
        "SPECFORGE_PROJECT_ROOT": "/absolute/path/to/project",
        "SPECFORGE_BASE_DIR": ".specifications",
        "SPECFORGE_ENABLE_QUEUE": "true",
        "SPECFORGE_CONFLICT_RESOLUTION": "auto"
      }
    }
  }
}
```

---

## VS Code Extension Setup

### First-Time Extension Configuration

After installing the SpecForged VS Code extension:

1. **Initialize Project**
```bash
# Via Command Palette:
"SpecForged: Initialize Project"
```

2. **Configure Server Type**
```bash
# Choose server type:
"SpecForged: Configure MCP Server Type"
# Options: Local, Smithery, Custom HTTP
```

3. **Test Connection**
```bash
# Verify everything works:
"SpecForged: Test MCP Connection"
"SpecForged: System Health Check"
```

### Extension Feature Migration

#### Sidebar Views
- **Specifications View**: Browse and manage all specifications
- **Operations Queue View**: Monitor MCP operations in real-time  
- **Settings View**: Configure servers and resolution strategies

#### Status Bar Integration
- **Operation Count**: Shows pending/active operations
- **Conflict Indicator**: Alerts for unresolved conflicts
- **Sync Status**: MCP server connection status

#### WebView Panels
- **MCP Dashboard**: Comprehensive server management interface
- **Conflict Resolution**: Visual conflict resolution interface
- **Performance Monitor**: Queue and system performance metrics

---

## Troubleshooting Migration Issues

### Common Migration Problems

#### Issue 1: VS Code Extension Not Loading
**Symptoms**: Extension commands not available, sidebar views missing

**Solutions**:
```bash
# Check extension installation
code --list-extensions | grep specforged

# Reinstall if necessary
code --uninstall-extension specforged.specforged-mcp
code --install-extension specforged.specforged-mcp

# Reload VS Code
# Command Palette: "Developer: Reload Window"
```

#### Issue 2: Specification Files Not Migrating
**Symptoms**: Old specifications not visible in new version

**Solutions**:
```bash
# Manual specification discovery
find . -name "*.json" -path "*/.specifications/*" | head -10

# Force migration
specforged migrate-specs --force --from=auto

# Check migration logs
tail -f ~/.local/share/specforged/migration.log
```

#### Issue 3: Configuration Conflicts
**Symptoms**: Settings not applying, server connection fails

**Solutions**:
```bash
# Validate configuration syntax
python -c "import json; json.load(open('.vscode/settings.json'))" && echo "Valid JSON" || echo "Invalid JSON"

# Reset to defaults
# Command Palette: "SpecForged: Reset Configuration"

# Manual config repair
cp .vscode/settings.json .vscode/settings.json.backup
echo '{"specforged.mcpServerType": "local"}' > .vscode/settings.json
```

#### Issue 4: Performance Issues After Migration
**Symptoms**: VS Code becomes slow, high memory usage

**Solutions**:
```bash
# Enable performance optimizations
# Add to settings.json:
{
  "specforged.performance.enableCaching": true,
  "specforged.queue.maxConcurrentOperations": 2,
  "specforged.queue.autoCleanup": true
}

# Clean up old data
"SpecForged: Clear Operation History"
"SpecForged: Cleanup System Files"
```

### Migration Validation

#### Validation Checklist
```bash
# Run comprehensive validation
specforged validate --all

# Specific validation checks
specforged validate --specifications
specforged validate --configuration  
specforged validate --mcp-connection
```

#### Manual Validation Steps
```bash
# 1. Check specification integrity
find .specifications/ -name "spec.json" -exec python -m json.tool {} \; > /dev/null && echo "✅ All specs valid"

# 2. Test MCP connection
echo '{"jsonrpc": "2.0", "method": "tools/list", "id": 1}' | specforged && echo "✅ MCP server responding"

# 3. Verify VS Code integration
code --list-extensions | grep specforged && echo "✅ Extension installed"

# 4. Test basic operations
# Via VS Code Command Palette:
# "SpecForged: Test MCP Connection"
# "SpecForged: List Specifications"
```

---

## Rollback Procedures

### Complete Rollback to Previous Version

If migration fails and you need to rollback:

#### Step 1: Stop All SpecForged Processes
```bash
# Stop VS Code
pkill -f "Code"

# Stop any running MCP servers
pkill -f "specforged"
```

#### Step 2: Uninstall New Version
```bash
# Uninstall new version
pipx uninstall specforged

# Remove VS Code extension
code --uninstall-extension specforged.specforged-mcp
```

#### Step 3: Restore from Backup
```bash
# Navigate to backup directory
cd ~/specforged-migration-backup-*

# Restore configurations
cp ./vscode-settings-backup.json ~/.config/Code/User/settings.json
cp ./claude-config-backup.json ~/Library/Application\ Support/Claude/claude_desktop_config.json
cp ./cursor-config-backup.json ~/.cursor/mcp_config.json

# Restore specifications
rm -rf .specifications/ 2>/dev/null
cp -r ./specifications-backup/ .specifications/
```

#### Step 4: Reinstall Previous Version
```bash
# Install specific previous version
pipx install specforged==0.2.1  # Or your previous version

# Verify rollback
specforged --version
```

### Partial Rollback (Configuration Only)

If you just need to rollback configuration changes:

```bash
# Restore specific configurations
cp ~/specforged-migration-backup-*/vscode-settings-backup.json .vscode/settings.json

# Reset extension state
# Command Palette: "SpecForged: Reset Extension State"

# Restart VS Code
# Command Palette: "Developer: Reload Window"
```

---

## Post-Migration Validation

### Comprehensive Testing

#### Functional Testing
```bash
# 1. Create test specification
"SpecForged: Create Specification"
# Name: "migration-test"
# Description: "Testing migration functionality"

# 2. Add requirements
"SpecForged: Add User Story"
# Test EARS notation functionality

# 3. Update design
"SpecForged: Update Design"
# Test design documentation

# 4. Generate tasks
"SpecForged: Generate Implementation Plan"
# Test task generation

# 5. Mark tasks complete
"SpecForged: Check Task"
# Test task management
```

#### Performance Testing
```bash
# Monitor performance metrics
"SpecForged: Performance Dashboard"

# Check memory usage
# Help → Process Explorer → Look for Extension Host

# Test large operations
# Create specification with 50+ tasks
# Monitor operation queue performance
```

#### Integration Testing
```bash
# Test MCP server communication
"SpecForged: Test MCP Connection"

# Test file operations
"SpecForged: Validate System Integrity"

# Test conflict resolution
# Create artificial conflict by modifying files simultaneously

# Test multi-server support
"SpecForged: Switch to Smithery Server"
"SpecForged: Test MCP Connection"
"SpecForged: Switch to Local Server"
```

### Success Criteria

Migration is successful when:

✅ **Installation**: New version installed and accessible  
✅ **Extension**: VS Code extension loaded and functional  
✅ **Specifications**: All specifications migrated and accessible  
✅ **Configuration**: Settings applied and working correctly  
✅ **MCP Connection**: Server communication established  
✅ **Operations**: Queue processing working normally  
✅ **Conflict Resolution**: Conflict detection and resolution functional  
✅ **Performance**: System responsive and stable  

### Post-Migration Optimization

#### Recommended Settings for Optimal Performance
```json
{
  "specforged.performance.enableCaching": true,
  "specforged.performance.batchOperations": true,
  "specforged.queue.maxConcurrentOperations": 3,
  "specforged.queue.autoCleanup": true,
  "specforged.conflictResolution.enableAutoMerge": true,
  "specforged.fileWatcher.debounceDelay": 1000
}
```

#### Regular Maintenance Tasks
```bash
# Weekly maintenance
"SpecForged: Clear Completed Operations"
"SpecForged: Cleanup System Files"

# Monthly maintenance  
"SpecForged: Validate System Integrity"
"SpecForged: Performance Report"

# Update checks
pipx upgrade specforged
# Check for VS Code extension updates
```

---

## Support and Additional Resources

### Migration Support
- **GitHub Issues**: https://github.com/whit3rabbit/SpecForge/issues
- **Migration Tag**: Label issues with `migration` for priority support
- **Documentation**: Complete documentation at https://github.com/whit3rabbit/SpecForge

### Migration Tools
```bash
# Built-in migration tools
specforged migrate --help
specforged validate --help
specforged repair --help

# Community migration scripts
# Check GitHub discussions for community-contributed migration scripts
```

### Getting Help

When requesting migration support, please include:

1. **Source and target versions**
2. **Operating system and architecture**
3. **VS Code version**
4. **Backup of configuration files**
5. **Migration logs and error messages**
6. **Steps already attempted**

This migration guide provides comprehensive coverage for upgrading to the enhanced SpecForged MCP ecosystem. For specific issues not covered here, please consult the [Troubleshooting Guide](TROUBLESHOOTING.md) or create a GitHub issue.