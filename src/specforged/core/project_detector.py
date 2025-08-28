"""
Project context detection utilities that prioritize the current working directory
as the project root and provide secure path validation.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Iterable, Optional

PROJECT_MARKERS = (
    ".git",
    "pyproject.toml",
    "package.json",
    "Cargo.toml",
    "go.mod",
)


def _first_existing_path_from_env_list(val: str | None) -> Optional[Path]:
    """Parse environment variable that may contain workspace paths in
    various formats."""
    if not val:
        return None
    s = val.strip()
    candidates: list[str] = []
    # JSON array case (some IDEs export ["path1","path2"])
    if s.startswith("["):
        try:
            arr = json.loads(s)
            if isinstance(arr, list):
                candidates = [str(x) for x in arr]
        except Exception:
            pass
    # Delimited case (',' ';' ':' os.pathsep). Cursor often uses comma/colon.
    if not candidates:
        for sep in (",", ";", ":", os.pathsep):
            if sep in s:
                candidates = [p.strip() for p in s.split(sep) if p.strip()]
                break
    if not candidates:
        candidates = [s]
    for p in candidates:
        pp = Path(p.strip().strip('"').strip("'")).expanduser().resolve()
        if pp.exists() and pp.is_dir():
            return pp
    return None


def _ascend_to_project_root(
    start: Path, markers: Iterable[str] = PROJECT_MARKERS
) -> Path:
    """Walk upward from start until a marker is found; else return start."""
    cur = start
    try:
        cur = cur.resolve()
    except Exception:
        pass
    for _ in range(64):  # safety bound
        for m in markers:
            if (cur / m).exists():
                return cur
        if cur.parent == cur:
            break
        cur = cur.parent
    return start


class ProjectDetector:
    """
    Detects the project's root directory based on IDE/workspace env and cwd.
    Ensures all file operations are relative to where the user is working.
    """

    def __init__(self, working_dir: Optional[Path] = None):
        """Initialize with intelligent workspace detection."""
        # 1) explicit working_dir wins
        if working_dir:
            self.project_root = _ascend_to_project_root(Path(working_dir))
            return

        # 2) IDE hints (Cursor/Windsurf): WORKSPACE_FOLDER_PATHS
        ws = _first_existing_path_from_env_list(
            os.environ.get("WORKSPACE_FOLDER_PATHS")
        )
        if ws:
            self.project_root = _ascend_to_project_root(ws)
            return

        # 3) $SPECFORGE_PROJECT_ROOT if absolute and exists
        pr = os.environ.get("SPECFORGE_PROJECT_ROOT")
        if pr:
            p = Path(pr).expanduser()
            if p.is_absolute() and p.exists():
                self.project_root = _ascend_to_project_root(p)
                return

        # 4) $PWD (some launchers set it correctly even if os.getcwd() is temp)
        pwd = os.environ.get("PWD")
        if pwd and Path(pwd).exists():
            self.project_root = _ascend_to_project_root(Path(pwd))
            return

        # 5) fallback: os.getcwd()
        self.project_root = _ascend_to_project_root(Path.cwd())

    def get_project_root(self) -> Path:
        """Return the resolved absolute path of the project root."""
        return self.project_root

    def get_specifications_dir(self, subdir: str = ".specifications") -> Path:
        """
        Get the specifications directory for the current project.

        Args:
            subdir: Subdirectory name for specifications (default: ".specifications")

        Returns:
            Path to the specifications directory.
        """
        return (self.project_root / subdir).resolve()

    def validate_path(self, target_path_str: str) -> Path:
        """
        Validate that a given path is within the project root directory.

        Args:
            target_path_str: The path string to validate (relative or absolute).

        Returns:
            The resolved, absolute Path object if it's safe.

        Raises:
            PermissionError: If the path is outside the allowed project directory.
        """
        target_path = Path(target_path_str)
        resolved_target = (
            target_path
            if target_path.is_absolute()
            else (self.project_root / target_path)
        ).resolve()
        # Enforce containment
        if (
            self.project_root not in resolved_target.parents
            and resolved_target != self.project_root
        ):
            raise PermissionError(f"Refusing path outside project: {resolved_target}")
        return resolved_target

    def get_project_info(self) -> dict:
        """Get information about the detected project."""
        return {
            "project_root": str(self.project_root),
            "markers_found": [
                m for m in PROJECT_MARKERS if (self.project_root / m).exists()
            ],
        }
