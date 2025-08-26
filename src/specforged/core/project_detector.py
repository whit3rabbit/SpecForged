"""
Project context detection utilities for determining the appropriate base directory
for SpecForge specifications.
"""

from pathlib import Path
from typing import Optional


class ProjectDetector:
    """Detects project context and determines appropriate specification directory."""

    # Common project markers (in order of preference)
    PROJECT_MARKERS = [
        ".git",  # Git repository
        "pyproject.toml",  # Python project
        "package.json",  # Node.js project
        "Cargo.toml",  # Rust project
        "go.mod",  # Go project
        "pom.xml",  # Maven project
        "build.gradle",  # Gradle project
        "Gemfile",  # Ruby project
        "composer.json",  # PHP project
        "requirements.txt",  # Python requirements
        ".specforge",  # SpecForge project marker
    ]

    def __init__(self, working_dir: Optional[Path] = None):
        """Initialize with optional working directory (defaults to cwd)."""
        self.working_dir = working_dir or Path.cwd()

    def find_project_root(self) -> Path:
        """
        Find the project root directory by looking for project markers.

        Returns:
            Path to the project root, or working directory if no markers found.
            If working directory is root (/), falls back to user's home directory.
        """
        current = self.working_dir.resolve()

        # Walk up the directory tree
        for parent in [current] + list(current.parents):
            for marker in self.PROJECT_MARKERS:
                if (parent / marker).exists():
                    return parent

        # If no project markers found and we're at a problematic location (like root),
        # raise an exception instead of falling back to Documents
        if current == Path("/") or len(current.parts) <= 2:
            raise ValueError(
                f"No valid project context found. Working directory is {current}, "
                f"which is not suitable for project-specific specifications. "
                f"\n\nTo fix this:"
                f"\n1. Set SPECFORGE_BASE_DIR to your project's absolute path"
                f"\n2. Use --base-dir argument with project path"
                f"\n3. Ensure MCP server starts from within a project directory"
                f"\n\nExample: SPECFORGE_BASE_DIR='/path/to/your/project/.specifications'"
            )

        # Otherwise use working directory as project root
        return current

    def get_specifications_dir(self, subdir: str = "specifications") -> Path:
        """
        Get the specifications directory for the current project.

        Args:
            subdir: Subdirectory name for specifications (default: "specifications")

        Returns:
            Path to the specifications directory
        """
        project_root = self.find_project_root()
        return project_root / subdir

    def validate_project_path(self, target_path: Path) -> bool:
        """
        Validate that a target path is within the current project bounds.

        Args:
            target_path: Path to validate

        Returns:
            True if path is within project bounds, False otherwise
        """
        try:
            project_root = self.find_project_root()
            resolved_target = target_path.resolve()
            resolved_project = project_root.resolve()

            # Check if target path is within project directory
            resolved_target.relative_to(resolved_project)
            return True
        except ValueError:
            return False

    def get_project_info(self) -> dict:
        """
        Get information about the detected project.

        Returns:
            Dictionary with project information
        """
        project_root = self.find_project_root()
        detected_markers = []

        for marker in self.PROJECT_MARKERS:
            if (project_root / marker).exists():
                detected_markers.append(marker)

        return {
            "project_root": str(project_root),
            "working_directory": str(self.working_dir),
            "detected_markers": detected_markers,
            "specifications_dir": str(self.get_specifications_dir()),
        }

    @staticmethod
    def create_project_marker(project_dir: Path) -> None:
        """
        Create a .specforge marker file in the project directory.

        Args:
            project_dir: Directory to create the marker in
        """
        marker_file = project_dir / ".specforge"
        if not marker_file.exists():
            marker_file.touch()
