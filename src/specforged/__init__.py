"""
SpecForge - Specification-driven development with EARS notation and MCP

A Model Context Protocol (MCP) server that implements intelligent mode
classification, structured workflow management, and EARS (Easy Approach to
Requirements Syntax) notation.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

__author__ = "SpecForge Team"


def _read_version_from_pyproject() -> Optional[str]:
    """Attempt to read version from pyproject.toml in the repository root.

    Tries tomllib (Py>=3.11) first. If unavailable or parsing fails, falls
    back to a simple regex search. Returns None if not found.
    """
    pyproject_path = Path(__file__).resolve().parents[2] / "pyproject.toml"
    if not pyproject_path.exists():
        return None

    # Try tomllib when available (Python 3.11+)
    try:
        import tomllib

        data = tomllib.loads(pyproject_path.read_text(encoding="utf-8"))
        project = data.get("project") if isinstance(data, dict) else None
        if isinstance(project, dict):
            version = project.get("version")
            if isinstance(version, str):
                return version
    except (ImportError, OSError, TypeError, KeyError):
        pass

    # Regex fallback for Python 3.10 or parsing issues
    try:
        import re

        content = pyproject_path.read_text(encoding="utf-8")
        m = re.search(r"^version\s*=\s*\"([^\"]+)\"", content, flags=re.MULTILINE)
        if m:
            return m.group(1)
    except (ImportError, OSError, TypeError, KeyError):
        pass

    return None


def _resolve_version() -> str:
    # Prefer installed package version metadata
    try:
        from importlib.metadata import version

        return version("specforged")
    except (ImportError, ModuleNotFoundError):
        # Not installed or metadata missing; try reading from source tree
        v = _read_version_from_pyproject()
        if v:
            return v
        # Last-resort fallback
        return "0.0.0"


__version__ = _resolve_version()

# Conditional imports to avoid dependency issues during testing
__all__ = [
    "__version__",
    "__author__",
]

try:
    from .cli import specforge_http, specforge_mcp  # noqa: F401
    from .server import create_server, run_server  # noqa: F401

    __all__.extend(
        [
            "create_server",
            "run_server",
            "specforge_mcp",
            "specforge_http",
        ]
    )
except ImportError:
    # Dependencies not available - likely during testing or build
    pass
