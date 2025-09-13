# SpecForged Technology Stack

## Dual Technology Stack

### Python MCP Server Stack
- **Python 3.10+**: Main backend language with type hints and modern features
- **FastMCP**: MCP server framework for tool registration and protocol handling
- **Pydantic**: Data validation and serialization with v2+ features
- **Async I/O**: `aiofiles` for file operations, `uvicorn` for HTTP serving

### VSCode Extension Stack
- **TypeScript**: Extension development with strict type checking
- **Node.js**: Build system and dependency management
- **VSCode API**: Native IDE integration and UI components
- **esbuild**: Fast bundling for production deployment

## Key Dependencies
- **MCP Framework**: `mcp[cli]>=1.0.0`, `fastmcp>=0.3.0`
- **Async I/O**: `aiofiles>=23.0.0` for file operations
- **Web Server**: `uvicorn[standard]>=0.24.0`, `starlette>=0.32.0`
- **CLI/UI**: `rich>=13.0.0`, `questionary>=2.0.0`
- **Testing**: `pytest>=8.4.1`, `pytest-asyncio>=1.1.0`

## Build System
- **Python**: `hatchling` build backend with `pyproject.toml`
- **Package Management**: `uv` for dependency resolution and virtual environments
- **TypeScript**: `esbuild` for bundling, `tsc` for compilation
- **Distribution**: PyPI for Python package, VSIX for VSCode extension

## Common Commands

### Development Setup
```bash
# Python development
uv sync                    # Install dependencies
uv run pytest            # Run tests
uv run black .            # Format code
uv run mypy src/          # Type checking

# VSCode extension
cd vscode-specforged
npm install               # Install dependencies
npm run compile          # Compile TypeScript
npm run bundle           # Bundle for production
npm run package          # Create VSIX package
```

### Testing
```bash
# Python tests
uv run pytest tests/                    # All tests
uv run pytest tests/test_cli.py        # Specific test file
uv run pytest -v --tb=short           # Verbose with short traceback

# TypeScript tests
cd vscode-specforged
npm test                               # Run extension tests
```

### Local Development
```bash
# Run MCP server locally
python main.py                         # Standard MCP server
python main_http.py                    # HTTP variant
uv run specforged                      # Installed CLI

# Development server with auto-reload
uv run uvicorn main_http:app --reload --port 8000
```

### Code Quality
```bash
# Pre-commit hooks (runs automatically)
pre-commit run --all-files

# Manual quality checks
uv run black --check .                 # Check formatting
uv run flake8 src/                     # Linting
uv run mypy src/                       # Type checking
```

## Architecture Patterns
- **MCP Protocol**: Tool-based architecture with FastMCP framework
- **Async/Await**: All I/O operations use async patterns
- **Dependency Injection**: Services passed to command handlers
- **Event-Driven**: File watchers and change notifications
- **Plugin Architecture**: Modular tool registration system
