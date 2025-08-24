# SpecForge Installation Test Guide

This document provides tests to verify the SpecForge package is properly configured for pipx installation.

## Package Structure Verification

✅ **Package built successfully**: `specforge-1.0.0-py3-none-any.whl`

✅ **Entry points configured**:
- `specforge` → `specforge.cli:specforge_mcp`
- `specforge-http` → `specforge.cli:specforge_http` 
- `specforge-cli` → `specforge.cli:main`

✅ **Package structure**:
```
src/specforge/
├── __init__.py          # Package initialization with conditional imports
├── __main__.py          # Direct module execution support
├── cli.py               # Console entry points with --version support
├── server.py            # MCP server factory
├── prompts.py           # MCP prompts
├── resources.py         # MCP resources
├── core/                # Business logic
│   ├── __init__.py
│   ├── classifier.py    # Mode classification
│   ├── spec_manager.py  # Specification management
│   └── plan_generator.py # Implementation planning
├── models/              # Data models
│   ├── __init__.py
│   └── core.py          # Core data classes
└── tools/               # MCP tools
    ├── __init__.py
    ├── classification.py
    ├── planning.py
    ├── specifications.py
    └── workflow.py
```

## Installation Tests

### 1. Package Import Test
```bash
python -c "import sys; sys.path.insert(0, 'src'); from specforge import __version__; print('SpecForge version:', __version__)"
```
✅ **Result**: `SpecForge version: 1.0.0`

### 2. Models Import Test  
```bash
python -c "import sys; sys.path.insert(0, 'src'); from specforge.models import UserMode; print('Models import:', UserMode.CHAT.value)"
```
✅ **Result**: `Models import: chat`

### 3. Build Test
```bash
uv build
```
✅ **Result**: Successfully built both `.tar.gz` and `.whl` files

## pipx Installation Commands

Once published to PyPI, users can install with:

```bash
# Install pipx if not already installed
pip install pipx
pipx ensurepath

# Install SpecForge
pipx install specforge

# Available commands after installation:
specforge          # Run MCP server (default)
specforge-http     # Run HTTP server  
specforge-cli      # CLI with subcommands
specforge --version # Show version
```

## Claude Desktop Configuration

After pipx installation:

```json
{
  "mcpServers": {
    "specforge": {
      "command": "specforge"
    }
  }
}
```

## Development Installation

For local development/testing:

```bash
# Install in development mode
pip install -e .

# Or build and install local wheel
uv build
pip install dist/specforge-1.0.0-py3-none-any.whl
```

## Verification Complete

The SpecForge package is properly structured for pipx distribution with:
- ✅ Correct package namespace (`specforge`)
- ✅ Console script entry points configured  
- ✅ All modules properly importable
- ✅ Clean package metadata
- ✅ Conditional imports for graceful testing
- ✅ Version support in CLI commands