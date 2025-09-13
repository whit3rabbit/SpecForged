"""
Path security utilities for preventing directory traversal and ensuring safe file operations.

This module provides comprehensive path validation, normalization, and security
checks to prevent directory traversal attacks and ensure file operations
stay within allowed boundaries.
"""

import logging
import os
from pathlib import Path
from typing import List, Optional, Set, Union
from urllib.parse import unquote


class PathSecurityError(Exception):
    """Raised when path security validation fails."""

    pass


class PathValidator:
    """Validates file paths for security vulnerabilities."""

    # Dangerous path components that could indicate traversal attempts
    DANGEROUS_COMPONENTS = {
        "..",
        ".",
        "~",
        "$",
    }

    # Dangerous characters in filenames
    DANGEROUS_CHARS = {
        "\x00",  # Null byte
        "\r",
        "\n",  # Newlines
        "\x1a",  # Windows EOF
    }

    # File extensions that should never be written
    FORBIDDEN_EXTENSIONS = {
        ".exe",
        ".bat",
        ".cmd",
        ".com",
        ".pif",
        ".scr",
        ".vbs",
        ".js",
        ".jar",
        ".app",
        ".deb",
        ".rpm",
        ".dmg",
        ".pkg",
        ".msi",
        ".dll",
        ".so",
        ".dylib",
    }

    def __init__(self, allowed_base_paths: Optional[List[Union[str, Path]]] = None):
        """Initialize path validator with allowed base paths."""
        self.logger = logging.getLogger(__name__)

        # Convert and normalize allowed base paths
        self.allowed_base_paths: Set[Path] = set()
        if allowed_base_paths:
            for base_path in allowed_base_paths:
                normalized = self._normalize_path(Path(base_path))
                self.allowed_base_paths.add(normalized)

        # Add current working directory as default allowed path
        if not self.allowed_base_paths:
            self.allowed_base_paths.add(self._normalize_path(Path.cwd()))

    def validate_path(self, path: Union[str, Path], check_exists: bool = False) -> Path:
        """
        Validate a path for security issues.

        Args:
            path: Path to validate
            check_exists: Whether to check if path exists

        Returns:
            Normalized, validated Path object

        Raises:
            PathSecurityError: If path fails security validation
        """
        # Convert to Path object
        if isinstance(path, str):
            # Decode URL-encoded paths to prevent bypass attempts
            path = unquote(path)
            path_obj = Path(path)
        else:
            path_obj = path

        # Normalize the path
        normalized_path = self._normalize_path(path_obj)

        # Check for dangerous components
        self._check_dangerous_components(normalized_path)

        # Check for dangerous characters
        self._check_dangerous_characters(str(normalized_path))

        # Check file extension
        self._check_file_extension(normalized_path)

        # Ensure path is within allowed base paths
        self._check_within_allowed_paths(normalized_path)

        # Check if path exists (if required)
        if check_exists and not normalized_path.exists():
            raise PathSecurityError(f"Path does not exist: {normalized_path}")

        self.logger.debug(f"Path validation successful: {normalized_path}")
        return normalized_path

    def validate_directory_path(
        self, path: Union[str, Path], create_if_missing: bool = False
    ) -> Path:
        """
        Validate a directory path with additional directory-specific checks.

        Args:
            path: Directory path to validate
            create_if_missing: Whether to create directory if it doesn't exist

        Returns:
            Validated directory Path object
        """
        validated_path = self.validate_path(path, check_exists=False)

        # Ensure it's intended to be a directory (doesn't have file extension)
        if validated_path.suffix and validated_path.suffix not in {
            ".git",
            ".svn",
            ".hg",
        }:
            raise PathSecurityError(
                f"Directory path should not have file extension: {validated_path}"
            )

        if validated_path.exists():
            if not validated_path.is_dir():
                raise PathSecurityError(
                    f"Path exists but is not a directory: {validated_path}"
                )
        elif create_if_missing:
            try:
                validated_path.mkdir(parents=True, exist_ok=True, mode=0o755)
                self.logger.info(f"Created directory: {validated_path}")
            except OSError as e:
                raise PathSecurityError(
                    f"Failed to create directory {validated_path}: {e}"
                )

        return validated_path

    def validate_file_path(
        self, path: Union[str, Path], must_exist: bool = False
    ) -> Path:
        """
        Validate a file path with additional file-specific checks.

        Args:
            path: File path to validate
            must_exist: Whether file must already exist

        Returns:
            Validated file Path object
        """
        validated_path = self.validate_path(path, check_exists=must_exist)

        # Ensure parent directory exists
        if not validated_path.parent.exists():
            raise PathSecurityError(
                f"Parent directory does not exist: {validated_path.parent}"
            )

        # If file exists, ensure it's actually a file
        if validated_path.exists() and not validated_path.is_file():
            raise PathSecurityError(f"Path exists but is not a file: {validated_path}")

        return validated_path

    def _normalize_path(self, path: Path) -> Path:
        """Normalize a path by resolving symlinks and relative components."""
        try:
            # Convert to absolute path and resolve symlinks
            return path.expanduser().resolve()
        except (OSError, RuntimeError) as e:
            raise PathSecurityError(f"Failed to normalize path {path}: {e}")

    def _check_dangerous_components(self, path: Path) -> None:
        """Check for dangerous path components."""
        for component in path.parts:
            if component in self.DANGEROUS_COMPONENTS:
                raise PathSecurityError(
                    f"Dangerous path component detected: {component}"
                )

            # Check for encoded traversal attempts
            if ".." in component or "%2e%2e" in component.lower():
                raise PathSecurityError(
                    f"Path traversal attempt detected in component: {component}"
                )

    def _check_dangerous_characters(self, path_str: str) -> None:
        """Check for dangerous characters in path string."""
        for char in self.DANGEROUS_CHARS:
            if char in path_str:
                raise PathSecurityError(
                    f"Dangerous character detected in path: {repr(char)}"
                )

        # Check for control characters
        if any(ord(c) < 32 for c in path_str if c not in {"\t"}):
            raise PathSecurityError("Control characters detected in path")

    def _check_file_extension(self, path: Path) -> None:
        """Check if file extension is forbidden."""
        if path.suffix.lower() in self.FORBIDDEN_EXTENSIONS:
            raise PathSecurityError(f"Forbidden file extension: {path.suffix}")

    def _check_within_allowed_paths(self, path: Path) -> None:
        """Ensure path is within one of the allowed base paths."""
        if not self.allowed_base_paths:
            return  # No restrictions if no base paths specified

        for base_path in self.allowed_base_paths:
            try:
                # Check if path is relative to base_path
                path.relative_to(base_path)
                return  # Path is within an allowed base path
            except ValueError:
                continue  # Try next base path

        # Path is not within any allowed base path
        allowed_paths_str = ", ".join(str(p) for p in self.allowed_base_paths)
        raise PathSecurityError(
            f"Path is outside allowed directories. Path: {path}, Allowed: {allowed_paths_str}"
        )

    def is_safe_filename(self, filename: str) -> bool:
        """Check if a filename is safe (no path components, dangerous chars, etc.)."""
        try:
            # Should not contain path separators
            if os.sep in filename or "/" in filename or "\\" in filename:
                return False

            # Should not be a dangerous component
            if filename in self.DANGEROUS_COMPONENTS:
                return False

            # Should not contain dangerous characters
            if any(char in filename for char in self.DANGEROUS_CHARS):
                return False

            # Should not have forbidden extension
            if Path(filename).suffix.lower() in self.FORBIDDEN_EXTENSIONS:
                return False

            # Should not be too long (filesystem limitation)
            if len(filename.encode("utf-8")) > 255:
                return False

            return True

        except Exception:
            return False


class SecurePathHandler:
    """High-level secure path handling with built-in security policies."""

    def __init__(
        self,
        project_root: Union[str, Path],
        specifications_dir: Union[str, Path],
    ):
        """
        Initialize secure path handler for SpecForge project.

        Args:
            project_root: Root directory of the project
            specifications_dir: Directory containing specifications
        """
        self.project_root = Path(project_root).resolve()
        self.specifications_dir = Path(specifications_dir).resolve()

        # Allowed base paths for SpecForge operations
        allowed_paths = [
            self.project_root,
            self.specifications_dir,
        ]

        # Add common temporary directories
        import tempfile

        temp_dir = Path(tempfile.gettempdir()).resolve()
        allowed_paths.append(temp_dir)

        self.path_validator = PathValidator(allowed_paths)
        self.logger = logging.getLogger(__name__)

        # Log initialization
        self.logger.info("SecurePathHandler initialized:")
        self.logger.info(f"  Project root: {self.project_root}")
        self.logger.info(f"  Specifications dir: {self.specifications_dir}")

    def validate_specification_path(
        self, spec_id: str, filename: Optional[str] = None
    ) -> Path:
        """
        Validate and construct a path within the specifications directory.

        Args:
            spec_id: Specification identifier
            filename: Optional filename within the spec directory

        Returns:
            Validated specification path
        """
        # Validate spec_id as filename component
        if not self.path_validator.is_safe_filename(spec_id):
            raise PathSecurityError(f"Invalid spec_id for filesystem use: {spec_id}")

        # Construct base spec directory
        spec_dir = self.specifications_dir / spec_id
        validated_spec_dir = self.path_validator.validate_directory_path(spec_dir)

        if filename:
            if not self.path_validator.is_safe_filename(filename):
                raise PathSecurityError(f"Invalid filename: {filename}")

            file_path = validated_spec_dir / filename
            return self.path_validator.validate_file_path(file_path)

        return validated_spec_dir

    def validate_project_path(self, relative_path: Union[str, Path]) -> Path:
        """
        Validate a path relative to the project root.

        Args:
            relative_path: Path relative to project root

        Returns:
            Validated absolute path within project
        """
        if isinstance(relative_path, str):
            relative_path = Path(relative_path)

        # Construct absolute path
        absolute_path = self.project_root / relative_path
        return self.path_validator.validate_path(absolute_path)

    def create_secure_temp_path(
        self, prefix: str = "specforged_", suffix: str = ""
    ) -> Path:
        """
        Create a secure temporary file path.

        Args:
            prefix: Prefix for temporary filename
            suffix: Suffix for temporary filename

        Returns:
            Secure temporary file path
        """
        import secrets
        import tempfile

        # Validate prefix and suffix
        if not self.path_validator.is_safe_filename(prefix):
            raise PathSecurityError(f"Invalid temp file prefix: {prefix}")

        if suffix and not self.path_validator.is_safe_filename(f"temp{suffix}"):
            raise PathSecurityError(f"Invalid temp file suffix: {suffix}")

        # Generate secure random component
        random_component = secrets.token_hex(8)
        temp_filename = f"{prefix}{random_component}{suffix}"

        temp_path = Path(tempfile.gettempdir()) / temp_filename
        return self.path_validator.validate_path(temp_path)

    def ensure_directory_exists(
        self, path: Union[str, Path], mode: int = 0o755
    ) -> Path:
        """
        Safely create a directory if it doesn't exist.

        Args:
            path: Directory path to create
            mode: Permissions for new directory

        Returns:
            Validated directory path
        """
        validated_path = self.path_validator.validate_directory_path(path)

        if not validated_path.exists():
            try:
                validated_path.mkdir(parents=True, exist_ok=True, mode=mode)
                self.logger.info(f"Created directory: {validated_path}")
            except OSError as e:
                raise PathSecurityError(
                    f"Failed to create directory {validated_path}: {e}"
                )

        return validated_path

    def get_safe_relative_path(
        self, full_path: Union[str, Path], base_path: Union[str, Path]
    ) -> Path:
        """
        Get a safe relative path from full_path to base_path.

        Args:
            full_path: Full path to make relative
            base_path: Base path to make relative to

        Returns:
            Safe relative path
        """
        full_path = self.path_validator.validate_path(full_path)
        base_path = self.path_validator.validate_path(base_path)

        try:
            relative_path = full_path.relative_to(base_path)
            # Ensure the relative path doesn't contain traversal components
            for part in relative_path.parts:
                if part in PathValidator.DANGEROUS_COMPONENTS:
                    raise PathSecurityError(
                        f"Dangerous component in relative path: {part}"
                    )
            return relative_path
        except ValueError as e:
            raise PathSecurityError(f"Cannot create safe relative path: {e}")

    def check_file_permissions(
        self, path: Union[str, Path], required_permissions: str = "r"
    ) -> bool:
        """
        Check if file has required permissions.

        Args:
            path: File path to check
            required_permissions: Required permissions ("r", "w", "x" or combination)

        Returns:
            True if file has required permissions
        """
        validated_path = self.path_validator.validate_path(path, check_exists=True)

        try:
            # Check if path exists before accessing
            validated_path.stat()

            checks = {
                "r": os.access(validated_path, os.R_OK),
                "w": os.access(validated_path, os.W_OK),
                "x": os.access(validated_path, os.X_OK),
            }

            return all(checks[perm] for perm in required_permissions if perm in checks)

        except OSError as e:
            self.logger.warning(
                f"Failed to check permissions for {validated_path}: {e}"
            )
            return False

    def set_secure_file_permissions(
        self, path: Union[str, Path], permissions: int = 0o644
    ) -> None:
        """
        Set secure permissions on a file.

        Args:
            path: File path
            permissions: Octal permissions (default: 0o644 - rw-r--r--)
        """
        validated_path = self.path_validator.validate_path(path, check_exists=True)

        try:
            validated_path.chmod(permissions)
            self.logger.debug(f"Set permissions {oct(permissions)} on {validated_path}")
        except OSError as e:
            raise PathSecurityError(
                f"Failed to set permissions on {validated_path}: {e}"
            )
