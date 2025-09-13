# SpecForged Standalone Usage Guide

This guide covers how to use SpecForged as a standalone MCP server without any IDE or VS Code extension dependencies.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [CLI Commands](#cli-commands)
- [Deployment Options](#deployment-options)
- [Integration Examples](#integration-examples)
- [Troubleshooting](#troubleshooting)

## Installation

### Automated Installation (Recommended)

**Linux/macOS:**
```bash
curl -sSL https://raw.githubusercontent.com/whit3rabbit/SpecForge/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
irm https://raw.githubusercontent.com/whit3rabbit/SpecForge/main/install.ps1 | iex
```

### Manual Installation

**Using pipx (recommended for isolated installation):**
```bash
pipx install specforged
```

**Using pip:**
```bash
pip install --user specforged
```

**Using uv:**
```bash
uv tool install specforged
```

### Docker Installation

```bash
docker pull specforged/specforged:latest
# or build locally
docker build -t specforged .
```

## Quick Start

### 1. Initialize a Project

```bash
# Navigate to your project directory
cd /path/to/your/project

# Initialize SpecForged
specforged init

# This will:
# - Create .specforged.yaml configuration file
# - Create .specifications/ directory
# - Optionally create user configuration at ~/.specforged/config.yaml
```

### 2. Check Project Status

```bash
specforged status

# Output shows:
# ✓ Project configuration, specifications directory, project root detection
# ✓ Configuration sources and active settings
# ✓ Number of existing specifications
```

### 3. Start the MCP Server

```bash
# Start server (most common usage)
specforged serve

# Alternative: Use legacy command
specforged

# HTTP server mode (for web clients)
specforged http --port 8080
```

### 4. Connect from MCP Clients

Once the server is running, configure your MCP client:

**Claude Desktop (`~/.claude_desktop_config.json`):**
```json
{
  "mcpServers": {
    "specforged": {
      "command": "specforged",
      "args": [],
      "env": {
        "SPECFORGE_PROJECT_ROOT": "/path/to/your/project",
        "SPECFORGE_BASE_DIR": ".specifications"
      }
    }
  }
}
```

**Cursor/VS Code (`.cursor/mcp_settings.json`):**
```json
{
  "mcpServers": {
    "specforged": {
      "command": "specforged",
      "args": []
    }
  }
}
```

## Configuration

SpecForged supports multiple configuration sources with proper precedence:

1. **Environment variables** (highest priority)
2. **Project configuration** (`.specforged.yaml`)
3. **User configuration** (`~/.specforged/config.yaml`)
4. **Default values** (lowest priority)

### Configuration Management

```bash
# View current configuration
specforged config show

# Edit project configuration
specforged config edit

# Edit user configuration  
specforged config edit --user
```

### Configuration Examples

**Project Configuration (`.specforged.yaml`):**
```yaml
name: MyProject
base_dir: .specifications
debug_mode: false
queue_processing_enabled: true
security_audit_enabled: true
rate_limiting_enabled: true
max_requests_per_minute: 100
```

**User Configuration (`~/.specforged/config.yaml`):**
```yaml
log_level: INFO
debug_mode: false
security_audit_enabled: true
rate_limiting_enabled: true
max_requests_per_minute: 100
cors_enabled: true
cors_origins: ["*"]
```

**Environment Variables:**
```bash
export SPECFORGED_NAME="MyProject"
export SPECFORGED_DEBUG="true"
export SPECFORGE_PROJECT_ROOT="/path/to/project"
export SPECFORGE_BASE_DIR=".specifications"
export SPECFORGED_LOG_LEVEL="DEBUG"
```

## CLI Commands

### Project Management

```bash
# Initialize project
specforged init [--force]

# Check project status
specforged status [--server]

# Create new specification via wizard
specforged new [--template TYPE] [--base-dir DIR]
```

### Server Operations

```bash
# Start MCP server (recommended)
specforged serve

# Start HTTP server
specforged http [--port PORT]

# Legacy MCP server command
specforged mcp [--base-dir DIR]
```

### Configuration Commands

```bash
# Show active configuration
specforged config show

# Edit configuration files
specforged config edit [--user]
```

### General Options

```bash
# Show version
specforged --version

# Show help
specforged --help
specforged COMMAND --help
```

## Deployment Options

### 1. Local Development

```bash
# Install and run locally
pipx install specforged
cd your-project
specforged init
specforged serve
```

### 2. Docker Deployment

**Simple container:**
```bash
docker run -d \
  --name specforged \
  -p 8080:8080 \
  -v $(pwd):/workspace \
  specforged/specforged:latest
```

**Docker Compose (recommended for production):**
```bash
# Copy docker-compose.yml and .env.example
cp .env.example .env
# Edit .env with your settings
docker-compose up -d
```

**Production with reverse proxy:**
```bash
# Enable production profile
docker-compose --profile production up -d
```

### 3. Cloud Deployment

**Smithery.ai (Managed):**
```bash
# Deploy to Smithery cloud platform
# Configure via https://smithery.ai
```

**Manual Cloud Deployment:**
```bash
# Build and push to registry
docker build -t your-registry/specforged .
docker push your-registry/specforged

# Deploy with your cloud provider's container service
```

### 4. Systemd Service

Create `/etc/systemd/system/specforged.service`:
```ini
[Unit]
Description=SpecForged MCP Server
After=network.target

[Service]
Type=simple
User=specforged
WorkingDirectory=/opt/specforged
Environment=SPECFORGE_PROJECT_ROOT=/opt/specforged
Environment=SPECFORGE_BASE_DIR=.specifications
ExecStart=/usr/local/bin/specforged serve
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable specforged
sudo systemctl start specforged
sudo systemctl status specforged
```

## Integration Examples

### 1. CI/CD Pipeline

```yaml
# GitHub Actions example
name: SpecForged Validation
on: [push, pull_request]

jobs:
  validate-specs:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Install SpecForged
        run: pipx install specforged
      - name: Initialize project
        run: specforged init --force
      - name: Check project status
        run: specforged status
      - name: Start server and test
        run: |
          specforged serve &
          SERVER_PID=$!
          sleep 5
          curl -f http://localhost:8080/health
          kill $SERVER_PID
```

### 2. Development Scripts

**`scripts/dev-setup.sh`:**
```bash
#!/bin/bash
# Development environment setup

# Install SpecForged if not present
if ! command -v specforged &> /dev/null; then
    echo "Installing SpecForged..."
    pipx install specforged
fi

# Initialize project
if [ ! -f .specforged.yaml ]; then
    echo "Initializing SpecForged project..."
    specforged init --force
fi

# Start development server
echo "Starting SpecForged server..."
specforged serve
```

### 3. Integration with Build Tools

**`Makefile`:**
```makefile
.PHONY: spec-init spec-serve spec-status

spec-init:
	specforged init --force

spec-serve:
	specforged serve

spec-status:
	specforged status

spec-health:
	curl -f http://localhost:8080/health || echo "Server not running"
```

### 4. Remote MCP Server

**Client configuration for remote server:**
```json
{
  "mcpServers": {
    "specforged-remote": {
      "transport": {
        "type": "http",
        "url": "https://your-server.com:8080/mcp"
      }
    }
  }
}
```

## Troubleshooting

### Common Issues

**1. Command not found after installation:**
```bash
# Ensure PATH includes the installation directory
export PATH="$HOME/.local/bin:$PATH"  # pip --user
export PATH="$HOME/.local/share/pipx/venvs/specforged/bin:$PATH"  # pipx

# Or restart your shell
```

**2. Permission denied errors:**
```bash
# Fix file permissions
chmod +x ~/.local/bin/specforged

# Or reinstall with proper permissions
pip install --user --force-reinstall specforged
```

**3. Configuration not loading:**
```bash
# Check configuration precedence
specforged config show

# Verify configuration files exist and are valid YAML
cat .specforged.yaml
cat ~/.specforged/config.yaml
```

**4. Server startup issues:**
```bash
# Run with debug logging
export SPECFORGED_DEBUG=true
export SPECFORGED_LOG_LEVEL=DEBUG
specforged serve

# Check for port conflicts
lsof -i :8080
```

**5. Docker deployment issues:**
```bash
# Check container logs
docker logs specforged

# Verify volume mounts
docker inspect specforged

# Test health check
docker exec specforged wget -qO- http://localhost:8080/health
```

### Debug Mode

Enable detailed logging:
```bash
# Via environment
export SPECFORGED_DEBUG=true
export SPECFORGED_LOG_LEVEL=DEBUG

# Via configuration
specforged config edit
# Set debug_mode: true and log_level: DEBUG
```

### Getting Help

1. **Check the status:** `specforged status`
2. **View logs:** Enable debug mode and check output
3. **Test connectivity:** `curl http://localhost:8080/health`
4. **Configuration issues:** `specforged config show`
5. **File issues:** Check permissions and paths
6. **Docker issues:** `docker logs specforged`

### Support Resources

- **Documentation:** [GitHub Repository](https://github.com/whit3rabbit/SpecForge)
- **Issues:** [GitHub Issues](https://github.com/whit3rabbit/SpecForge/issues)
- **PyPI Package:** [PyPI Page](https://pypi.org/project/specforged/)
- **Docker Hub:** [Docker Repository](https://hub.docker.com/r/specforged/specforged)

## Advanced Usage

### Custom Server Implementation

You can extend SpecForged by creating custom servers:

```python
from specforged.server import create_server
from specforged.config import load_configuration

# Load custom configuration
config = load_configuration()
config.name = "My Custom SpecForged"

# Create server with custom configuration
server = create_server(config=config)

# Add custom tools or modify behavior
@server.tool()
async def my_custom_tool():
    """My custom MCP tool"""
    return {"message": "Hello from custom tool!"}

# Run the server
server.run()
```

### Environment-Specific Configurations

Use different configurations for different environments:

```bash
# Development
export SPECFORGED_ENV=development
export SPECFORGED_DEBUG=true

# Staging
export SPECFORGED_ENV=staging
export SPECFORGED_SECURITY_AUDIT=true

# Production
export SPECFORGED_ENV=production
export SPECFORGED_RATE_LIMITING=true
export SPECFORGED_MAX_REQUESTS=500
```

This completes the standalone usage guide. SpecForged is designed to work independently and can be deployed in various environments without requiring any specific IDE or extension.