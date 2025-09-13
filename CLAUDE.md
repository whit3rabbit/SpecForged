- Always activate venv and use uv for python and pytest

## Development Commands

### Linting and Type Checking
- **Flake8 (critical issues only)**: `source .venv/bin/activate && uv run flake8 src/ tests/ --select=F401,F841,E722,F811,F821 --count`
- **Flake8 (all issues)**: `source .venv/bin/activate && uv run flake8 src/ tests/ --count`
- **MyPy type checking**: `source .venv/bin/activate && uv run mypy src/ --explicit-package-bases`
- **Pre-commit all hooks**: `source .venv/bin/activate && uv run pre-commit run --all-files`

### Testing
- **Core functionality tests**: `source .venv/bin/activate && uv run pytest tests/test_models.py tests/test_spec_manager.py tests/test_wizard.py -v`
- **All tests**: `source .venv/bin/activate && uv run pytest tests/ -v`
- **Stop on first failure**: `source .venv/bin/activate && uv run pytest tests/ -x --tb=short`
