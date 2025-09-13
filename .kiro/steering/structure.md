# SpecForged Project Structure

## Root Directory Layout (Dual-Component Project)
```
├── src/specforged/           # Python MCP Server package
├── vscode-specforged/        # VSCode Extension (separate app)
├── tests/                    # Python test suite
├── docs/                     # Documentation
├── scripts/                  # Development scripts
├── specifications/           # Example specifications
├── .specifications/          # Local project specs
├── main.py                   # MCP server entry point
├── main_http.py             # HTTP server entry point
├── pyproject.toml           # Python project configuration
├── requirements.txt         # Python dependencies
├── uv.lock                  # Python dependency lock file
└── smithery.yaml            # Cloud deployment config
```

**Note**: This is a **monorepo containing two separate applications**:
1. **Python MCP Server** (root + `src/specforged/`)
2. **VSCode Extension** (`vscode-specforged/` subdirectory)

## Python Package Structure (`src/specforged/`)
```
src/specforged/
├── __init__.py              # Package initialization and version
├── __main__.py              # Module execution entry point
├── cli.py                   # Command-line interfaces
├── server.py                # MCP server creation and setup
├── smithery_server.py       # Smithery cloud integration
├── wizard.py                # Interactive project wizard
├── prompts.py               # MCP prompts and resources
├── resources.py             # Static resources
├── core/                    # Core business logic
│   ├── __init__.py
│   ├── classifier.py        # Mode classification logic
│   ├── spec_manager.py      # Specification management
│   ├── plan_generator.py    # Task planning algorithms
│   └── project_detector.py  # Project root detection
├── models/                  # Data models and types
│   ├── __init__.py
│   └── core.py             # Pydantic models
├── tools/                   # MCP tool implementations
│   ├── __init__.py
│   ├── classification.py    # Mode classification tools
│   ├── specifications.py    # Spec management tools
│   ├── workflow.py          # Workflow phase tools
│   ├── planning.py          # Task planning tools
│   └── filesystem.py        # File operation tools
└── templates/               # Project templates
    └── __init__.py
```

## VSCode Extension Structure (`vscode-specforged/`)
```
vscode-specforged/
├── src/
│   ├── extension.ts         # Main extension entry point
│   ├── commands/            # Command implementations
│   ├── providers/           # Tree data providers
│   ├── views/               # UI components and webviews
│   ├── services/            # Business logic services
│   ├── mcp/                 # MCP client integration
│   ├── utils/               # Utility functions
│   └── models/              # TypeScript interfaces
├── resources/               # Static resources
│   ├── icons/               # UI icons
│   ├── styles/              # CSS styles
│   └── templates/           # HTML templates
├── out/                     # Compiled JavaScript
├── package.json             # Extension manifest
├── tsconfig.json            # TypeScript configuration
└── *.vsix                   # Packaged extension files
```

## Test Structure (`tests/`)
```
tests/
├── __init__.py
├── test_cli.py              # CLI functionality tests
├── test_classifier.py       # Mode classification tests
├── test_spec_manager.py     # Specification management tests
├── test_plan_generator.py   # Task planning tests
├── test_models.py           # Data model tests
├── test_wizard.py           # Interactive wizard tests
└── test_enhanced_task.py    # Task enhancement tests
```

## Configuration Files
- **`pyproject.toml`**: Python project metadata, dependencies, build config, tool settings
- **`requirements.txt`**: Runtime dependencies for simple installation
- **`uv.lock`**: Locked dependency versions for reproducible builds
- **`.pre-commit-config.yaml`**: Code quality hooks (black, flake8, mypy, isort)
- **`smithery.yaml`**: Cloud deployment configuration
- **`Dockerfile`**: Container build instructions

## Key Conventions

### Python Code Organization
- **Core Logic**: Business logic in `src/specforged/core/`
- **MCP Tools**: Tool implementations in `src/specforged/tools/`
- **Data Models**: Pydantic models in `src/specforged/models/`
- **Entry Points**: CLI commands in `src/specforged/cli.py`
- **Server Setup**: MCP server configuration in `src/specforged/server.py`

### File Naming
- **Python**: Snake_case for modules and functions
- **TypeScript**: camelCase for variables, PascalCase for classes
- **Test Files**: Prefix with `test_` matching module names
- **Config Files**: Standard names (pyproject.toml, package.json, etc.)

### Import Organization
- **Absolute Imports**: Use `from .module import Class` within package
- **Type Imports**: Use `from typing import` for type hints
- **External Dependencies**: Group by category (stdlib, third-party, local)

### Documentation Structure
- **API Docs**: `docs/API.md` for MCP tool documentation
- **Development**: `docs/EXTENSION_DEVELOPMENT.md` for contributor guide
- **Testing**: `docs/TESTING_SCENARIOS.md` for test scenarios
- **Examples**: `docs/examples/` for usage examples

### Specification Storage
- **Local Development**: `.specifications/` in project root
- **Examples**: `specifications/` for documentation examples
- **User Projects**: Configurable via `SPECFORGE_BASE_DIR` environment variable
