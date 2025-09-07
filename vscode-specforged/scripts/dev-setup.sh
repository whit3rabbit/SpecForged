#!/bin/bash

# SpecForged VS Code Extension Development Setup Script
# This script automates the setup of the development environment

set -e  # Exit on any error

echo "🚀 SpecForged VS Code Extension Development Setup"
echo "=================================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if we're in the right directory
if [[ ! -f "package.json" ]]; then
    print_error "Please run this script from the vscode-specforged directory"
    exit 1
fi

# Check Node.js installation
print_status "Checking Node.js installation..."
if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node --version)
    print_success "Node.js found: $NODE_VERSION"
    
    # Check if version is 18 or higher
    MAJOR_VERSION=$(echo $NODE_VERSION | sed 's/v//' | cut -d. -f1)
    if [[ $MAJOR_VERSION -lt 18 ]]; then
        print_warning "Node.js version $NODE_VERSION detected. Version 18+ recommended."
        echo "Consider upgrading: https://nodejs.org/"
    fi
else
    print_error "Node.js not found. Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi

# Check npm installation
print_status "Checking npm installation..."
if command -v npm >/dev/null 2>&1; then
    NPM_VERSION=$(npm --version)
    print_success "npm found: $NPM_VERSION"
else
    print_error "npm not found. Please install npm."
    exit 1
fi

# Check TypeScript installation
print_status "Checking TypeScript installation..."
if command -v tsc >/dev/null 2>&1; then
    TS_VERSION=$(tsc --version)
    print_success "TypeScript found: $TS_VERSION"
else
    print_warning "TypeScript not found globally. Installing..."
    npm install -g typescript
    print_success "TypeScript installed globally"
fi

# Check VS Code installation
print_status "Checking VS Code installation..."
if command -v code >/dev/null 2>&1; then
    print_success "VS Code CLI found"
else
    print_warning "VS Code CLI not found. Make sure VS Code is installed and 'code' command is available."
    echo "Install VS Code from: https://code.visualstudio.com/"
    echo "Enable 'code' command: VS Code > Command Palette > 'Shell Command: Install code command in PATH'"
fi

# Install dependencies
print_status "Installing npm dependencies..."
npm install
print_success "Dependencies installed"

# Compile TypeScript
print_status "Compiling TypeScript..."
npm run compile
print_success "TypeScript compilation completed"

# Run tests to verify setup
print_status "Running tests to verify setup..."
if npm test; then
    print_success "Tests passed"
else
    print_warning "Some tests failed. This might be normal for initial setup."
fi

# Check for MCP servers
print_status "Checking for MCP server installations..."

# Check for SpecForged MCP server
if command -v specforged >/dev/null 2>&1; then
    SPECFORGED_VERSION=$(specforged --version 2>/dev/null || echo "unknown")
    print_success "SpecForged MCP server found: $SPECFORGED_VERSION"
else
    print_warning "SpecForged MCP server not found. Install with:"
    echo "  cd .. && pip install -e ."
    echo "  or: pipx install specforged"
fi

# Check for Claude Desktop
CLAUDE_CONFIG_PATH="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
if [[ -f "$CLAUDE_CONFIG_PATH" ]]; then
    print_success "Claude Desktop configuration found"
else
    print_warning "Claude Desktop not configured. Install from: https://claude.ai/download"
fi

# Check for Cursor
CURSOR_PATH="/Applications/Cursor.app"
if [[ -d "$CURSOR_PATH" ]]; then
    print_success "Cursor found"
else
    print_warning "Cursor not found. Install from: https://cursor.so/"
fi

# Check for Windsurf
WINDSURF_PATH="/Applications/Windsurf.app"
if [[ -d "$WINDSURF_PATH" ]]; then
    print_success "Windsurf found"
else
    print_warning "Windsurf not found. Install from: https://codeium.com/windsurf"
fi

# Setup development files
print_status "Setting up development configuration..."

# Create .vscode/launch.json if it doesn't exist
if [[ ! -f ".vscode/launch.json" ]]; then
    mkdir -p .vscode
    cat > .vscode/launch.json << 'EOF'
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Run Extension",
            "type": "extensionHost",
            "request": "launch",
            "args": [
                "--extensionDevelopmentPath=${workspaceFolder}"
            ],
            "outFiles": [
                "${workspaceFolder}/out/**/*.js"
            ],
            "preLaunchTask": "${workspaceFolder}/npm: compile"
        },
        {
            "name": "Run Extension Tests",
            "type": "extensionHost",
            "request": "launch",
            "args": [
                "--extensionDevelopmentPath=${workspaceFolder}",
                "--extensionTestsPath=${workspaceFolder}/out/test/suite/index"
            ],
            "outFiles": [
                "${workspaceFolder}/out/test/**/*.js"
            ],
            "preLaunchTask": "${workspaceFolder}/npm: compile"
        }
    ]
}
EOF
    print_success "Created .vscode/launch.json"
fi

# Create .vscode/tasks.json if it doesn't exist
if [[ ! -f ".vscode/tasks.json" ]]; then
    cat > .vscode/tasks.json << 'EOF'
{
    "version": "2.0.0",
    "tasks": [
        {
            "type": "npm",
            "script": "compile",
            "group": {
                "kind": "build",
                "isDefault": true
            },
            "presentation": {
                "panel": "dedicated",
                "reveal": "never"
            },
            "problemMatcher": [
                "$tsc"
            ]
        },
        {
            "type": "npm",
            "script": "watch",
            "group": "build",
            "presentation": {
                "panel": "dedicated",
                "reveal": "never"
            },
            "isBackground": true,
            "problemMatcher": [
                "$tsc-watch"
            ]
        },
        {
            "type": "npm",
            "script": "test",
            "group": "test"
        }
    ]
}
EOF
    print_success "Created .vscode/tasks.json"
fi

# Create .vscode/settings.json if it doesn't exist
if [[ ! -f ".vscode/settings.json" ]]; then
    cat > .vscode/settings.json << 'EOF'
{
    "typescript.preferences.importModuleSpecifier": "relative",
    "typescript.suggest.autoImports": true,
    "editor.formatOnSave": true,
    "editor.codeActionsOnSave": {
        "source.organizeImports": true
    },
    "search.exclude": {
        "**/node_modules": true,
        "**/out": true,
        "**/.vscode-test": true
    },
    "files.exclude": {
        "**/.git": true,
        "**/.DS_Store": true,
        "**/node_modules": true,
        "**/out": true
    }
}
EOF
    print_success "Created .vscode/settings.json"
fi

# Create test MCP configurations
print_status "Setting up test MCP configurations..."

# Create test directory structure
mkdir -p test-configs/claude
mkdir -p test-configs/cursor  
mkdir -p test-configs/windsurf

# Test Claude config
cat > test-configs/claude/claude_desktop_config.json << 'EOF'
{
  "mcpServers": {
    "specforged": {
      "command": "specforged",
      "args": ["--local-mode"],
      "env": {
        "SPECFORGED_DEBUG": "true"
      }
    },
    "context7": {
      "command": "context7-server",
      "args": ["--enhanced-search"]
    }
  }
}
EOF

# Test Cursor config
cat > test-configs/cursor/mcp_config.json << 'EOF'
{
  "mcpServers": {
    "specforged": {
      "command": "specforged",
      "args": ["--cursor-mode"]
    }
  }
}
EOF

# Test Windsurf config
cat > test-configs/windsurf/mcp_config.json << 'EOF'
{
  "mcpServers": {
    "specforged": {
      "command": "specforged",
      "args": ["--windsurf-mode"]
    }
  }
}
EOF

print_success "Created test MCP configurations in test-configs/"

# Create development scripts
print_status "Creating development helper scripts..."

# Package script
cat > scripts/package.sh << 'EOF'
#!/bin/bash
# Package the extension for distribution

set -e

echo "🚀 Packaging SpecForged VS Code Extension..."

# Clean previous builds
npm run clean

# Install dependencies
npm install

# Compile TypeScript
npm run compile

# Run tests
npm test

# Package extension
npx vsce package

echo "✅ Extension packaged successfully!"
ls -la *.vsix
EOF
chmod +x scripts/package.sh

# Test script
cat > scripts/test-all.sh << 'EOF'
#!/bin/bash
# Run all tests and checks

set -e

echo "🧪 Running all tests and checks..."

# TypeScript compilation
echo "📝 Compiling TypeScript..."
npm run compile

# Linting
echo "🔍 Running linter..."
npm run lint || echo "⚠️ Linting issues found"

# Unit tests
echo "🧪 Running unit tests..."
npm test

# Type checking
echo "🔬 Type checking..."
npx tsc --noEmit

echo "✅ All checks completed!"
EOF
chmod +x scripts/test-all.sh

print_success "Created helper scripts in scripts/"

echo ""
echo "🎉 Development Environment Setup Complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "1. Open VS Code: code ."
echo "2. Press F5 to launch Extension Development Host"
echo "3. Test extension commands in the new window"
echo "4. Check the documentation: ../docs/EXTENSION_DEVELOPMENT.md"
echo ""
echo "Development commands:"
echo "  npm run compile    - Compile TypeScript"
echo "  npm run watch      - Watch and compile on changes"
echo "  npm test           - Run tests"
echo "  npm run package    - Package extension"
echo "  ./scripts/test-all.sh - Run all checks"
echo ""
echo "Happy coding! 🚀"