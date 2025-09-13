"""
Secure file operations with atomic writes, proper permissions, and safety checks.

This module provides secure file operations that prevent race conditions,
ensure data integrity, and maintain proper file permissions.
"""

import fcntl
import hashlib
import json
import logging
import os
import shutil
import tempfile
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, BinaryIO, Dict, Optional, TextIO, Union

from .path_security import SecurePathHandler


class SecureFileError(Exception):
    """Raised when secure file operations fail."""

    pass


class AtomicFileWriter:
    """
    Atomic file writer that ensures data integrity through temporary files.

    Writes to a temporary file first, then atomically moves to target location.
    This prevents partial writes and race conditions.
    """

    def __init__(
        self,
        target_path: Union[str, Path],
        mode: str = "w",
        encoding: str = "utf-8",
        backup: bool = True,
    ):
        """
        Initialize atomic file writer.

        Args:
            target_path: Final path for the file
            mode: File open mode ('w', 'wb', etc.)
            encoding: Text encoding (for text mode)
            backup: Whether to create backup of existing file
        """
        self.target_path = Path(target_path)
        self.mode = mode
        self.encoding = encoding if "b" not in mode else None
        self.backup = backup

        self.temp_path: Optional[Path] = None
        self.backup_path: Optional[Path] = None
        self.file_handle: Optional[Union[TextIO, BinaryIO]] = None

        self.logger = logging.getLogger(__name__)

    def __enter__(self):
        """Enter context manager."""
        # Create temporary file in same directory as target
        temp_dir = self.target_path.parent
        temp_prefix = f".{self.target_path.name}.tmp."

        # Create temporary file
        fd, temp_path = tempfile.mkstemp(
            prefix=temp_prefix, dir=temp_dir, text="b" not in self.mode
        )

        self.temp_path = Path(temp_path)

        # Open the temporary file with desired mode
        if "b" in self.mode:
            self.file_handle = os.fdopen(fd, self.mode)
        else:
            self.file_handle = os.fdopen(fd, self.mode, encoding=self.encoding)

        # Acquire exclusive lock
        try:
            fcntl.flock(self.file_handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise SecureFileError(f"Unable to acquire lock on {self.target_path}")

        return self.file_handle

    def __exit__(self, exc_type, exc_val, exc_tb):
        """Exit context manager."""
        try:
            if self.file_handle:
                # Ensure data is written to disk
                self.file_handle.flush()
                os.fsync(self.file_handle.fileno())
                self.file_handle.close()

            if exc_type is None:  # No exception occurred
                self._commit()
            else:
                self._rollback()

        except Exception as e:
            self.logger.error(f"Error during atomic file operation cleanup: {e}")
            self._rollback()
            raise SecureFileError(f"Atomic file operation failed: {e}")

    def _commit(self):
        """Commit the temporary file to target location."""
        if not self.temp_path or not self.temp_path.exists():
            raise SecureFileError("Temporary file missing during commit")

        # Create backup if requested and target exists
        if self.backup and self.target_path.exists():
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_name = f"{self.target_path.name}.backup.{timestamp}"
            self.backup_path = self.target_path.parent / backup_name

            try:
                shutil.copy2(self.target_path, self.backup_path)
                self.logger.debug(f"Created backup: {self.backup_path}")
            except Exception as e:
                self.logger.warning(f"Failed to create backup: {e}")

        # Set appropriate permissions before moving
        self.temp_path.chmod(0o644)

        # Atomic move
        try:
            self.temp_path.replace(self.target_path)
            self.logger.debug(f"Atomically wrote file: {self.target_path}")
        except Exception as e:
            self._rollback()
            raise SecureFileError(f"Failed to commit file {self.target_path}: {e}")

    def _rollback(self):
        """Clean up temporary file on failure."""
        if self.temp_path and self.temp_path.exists():
            try:
                self.temp_path.unlink()
                self.logger.debug(f"Cleaned up temporary file: {self.temp_path}")
            except Exception as e:
                self.logger.error(
                    f"Failed to clean up temporary file {self.temp_path}: {e}"
                )


class SecureFileOperations:
    """High-level secure file operations for SpecForge."""

    def __init__(self, path_handler: SecurePathHandler):
        """Initialize with a secure path handler."""
        self.path_handler = path_handler
        self.logger = logging.getLogger(__name__)

    def read_file_safely(
        self, file_path: Union[str, Path], max_size: int = 10 * 1024 * 1024
    ) -> str:
        """
        Safely read a text file with size limits.

        Args:
            file_path: Path to file to read
            max_size: Maximum file size in bytes

        Returns:
            File contents as string

        Raises:
            SecureFileError: If file operation fails or is unsafe
        """
        validated_path = self.path_handler.path_validator.validate_file_path(
            file_path, must_exist=True
        )

        # Check file size
        try:
            file_size = validated_path.stat().st_size
            if file_size > max_size:
                raise SecureFileError(
                    f"File {validated_path} exceeds maximum size limit ({max_size} bytes)"
                )
        except OSError as e:
            raise SecureFileError(f"Cannot access file {validated_path}: {e}")

        # Check permissions
        if not self.path_handler.check_file_permissions(validated_path, "r"):
            raise SecureFileError(f"Insufficient permissions to read {validated_path}")

        try:
            with open(validated_path, "r", encoding="utf-8") as f:
                # Acquire shared lock for reading
                fcntl.flock(f.fileno(), fcntl.LOCK_SH)
                content = f.read()

            self.logger.debug(f"Successfully read file: {validated_path}")
            return content

        except Exception as e:
            raise SecureFileError(f"Failed to read file {validated_path}: {e}")

    def write_file_safely(
        self,
        file_path: Union[str, Path],
        content: str,
        create_backup: bool = True,
    ) -> None:
        """
        Safely write content to a file with atomic operations.

        Args:
            file_path: Path to file to write
            content: Content to write
            create_backup: Whether to create backup of existing file
        """
        validated_path = self.path_handler.path_validator.validate_file_path(file_path)

        # Ensure parent directory exists
        self.path_handler.ensure_directory_exists(validated_path.parent)

        # Check if we have write permissions to directory
        if not os.access(validated_path.parent, os.W_OK):
            raise SecureFileError(
                f"No write permission to directory {validated_path.parent}"
            )

        try:
            with AtomicFileWriter(validated_path, mode="w", backup=create_backup) as f:
                f.write(content)

            # Set secure permissions
            self.path_handler.set_secure_file_permissions(validated_path, 0o644)

            self.logger.info(f"Successfully wrote file: {validated_path}")

        except Exception as e:
            raise SecureFileError(f"Failed to write file {validated_path}: {e}")

    def read_json_safely(self, file_path: Union[str, Path]) -> Dict[str, Any]:
        """
        Safely read and parse JSON file.

        Args:
            file_path: Path to JSON file

        Returns:
            Parsed JSON data
        """
        content = self.read_file_safely(file_path)

        try:
            return json.loads(content)
        except json.JSONDecodeError as e:
            raise SecureFileError(f"Invalid JSON in file {file_path}: {e}")

    def write_json_safely(
        self,
        file_path: Union[str, Path],
        data: Any,
        create_backup: bool = True,
        indent: int = 2,
    ) -> None:
        """
        Safely write data as JSON file.

        Args:
            file_path: Path to JSON file
            data: Data to write as JSON
            create_backup: Whether to create backup
            indent: JSON indentation
        """
        try:
            content = json.dumps(
                data, indent=indent, ensure_ascii=False, sort_keys=True
            )
        except (TypeError, ValueError) as e:
            raise SecureFileError(f"Cannot serialize data to JSON: {e}")

        self.write_file_safely(file_path, content, create_backup)

    def copy_file_safely(
        self, source_path: Union[str, Path], dest_path: Union[str, Path]
    ) -> None:
        """
        Safely copy a file with validation.

        Args:
            source_path: Source file path
            dest_path: Destination file path
        """
        validated_source = self.path_handler.path_validator.validate_file_path(
            source_path, must_exist=True
        )
        validated_dest = self.path_handler.path_validator.validate_file_path(dest_path)

        # Ensure destination directory exists
        self.path_handler.ensure_directory_exists(validated_dest.parent)

        try:
            # Use atomic copy operation
            temp_dest = validated_dest.with_suffix(validated_dest.suffix + ".tmp")

            # Copy with metadata preservation
            shutil.copy2(validated_source, temp_dest)

            # Set secure permissions
            temp_dest.chmod(0o644)

            # Atomic move to final location
            temp_dest.replace(validated_dest)

            self.logger.info(
                f"Successfully copied {validated_source} to {validated_dest}"
            )

        except Exception as e:
            # Clean up temporary file if it exists
            temp_dest = validated_dest.with_suffix(validated_dest.suffix + ".tmp")
            if temp_dest.exists():
                try:
                    temp_dest.unlink()
                except (OSError, PermissionError):
                    pass

            raise SecureFileError(
                f"Failed to copy {validated_source} to {validated_dest}: {e}"
            )

    def delete_file_safely(
        self, file_path: Union[str, Path], require_confirmation: bool = True
    ) -> None:
        """
        Safely delete a file with optional confirmation.

        Args:
            file_path: Path to file to delete
            require_confirmation: Whether to require the file to exist
        """
        validated_path = self.path_handler.path_validator.validate_file_path(file_path)

        if not validated_path.exists():
            if require_confirmation:
                raise SecureFileError(f"File does not exist: {validated_path}")
            else:
                return  # Nothing to delete

        # Check if it's actually a file
        if not validated_path.is_file():
            raise SecureFileError(f"Path is not a file: {validated_path}")

        try:
            # Secure deletion (overwrite before unlinking on sensitive systems)
            if self._should_secure_delete(validated_path):
                self._secure_overwrite(validated_path)

            validated_path.unlink()
            self.logger.info(f"Successfully deleted file: {validated_path}")

        except Exception as e:
            raise SecureFileError(f"Failed to delete file {validated_path}: {e}")

    def calculate_file_hash(
        self, file_path: Union[str, Path], algorithm: str = "sha256"
    ) -> str:
        """
        Calculate cryptographic hash of a file.

        Args:
            file_path: Path to file
            algorithm: Hash algorithm ('sha256', 'sha1', 'md5')

        Returns:
            Hexadecimal hash digest
        """
        validated_path = self.path_handler.path_validator.validate_file_path(
            file_path, must_exist=True
        )

        try:
            hash_obj = hashlib.new(algorithm)

            with open(validated_path, "rb") as f:
                # Read in chunks to handle large files
                for chunk in iter(lambda: f.read(8192), b""):
                    hash_obj.update(chunk)

            return hash_obj.hexdigest()

        except Exception as e:
            raise SecureFileError(f"Failed to calculate hash for {validated_path}: {e}")

    def verify_file_integrity(
        self,
        file_path: Union[str, Path],
        expected_hash: str,
        algorithm: str = "sha256",
    ) -> bool:
        """
        Verify file integrity using cryptographic hash.

        Args:
            file_path: Path to file
            expected_hash: Expected hash value
            algorithm: Hash algorithm used

        Returns:
            True if file integrity is verified
        """
        actual_hash = self.calculate_file_hash(file_path, algorithm)
        return actual_hash.lower() == expected_hash.lower()

    @contextmanager
    def secure_temp_file(self, suffix: str = "", prefix: str = "specforge_"):
        """
        Create a secure temporary file context manager.

        Args:
            suffix: File suffix
            prefix: File prefix

        Yields:
            Path to secure temporary file
        """
        temp_path = None
        try:
            # Create secure temporary file
            temp_path = self.path_handler.create_secure_temp_path(prefix, suffix)

            # Ensure secure permissions
            temp_path.touch(mode=0o600)  # Owner read/write only

            yield temp_path

        finally:
            # Clean up temporary file
            if temp_path and temp_path.exists():
                try:
                    if self._should_secure_delete(temp_path):
                        self._secure_overwrite(temp_path)
                    temp_path.unlink()
                except Exception as e:
                    self.logger.error(
                        f"Failed to clean up temporary file {temp_path}: {e}"
                    )

    def get_file_info(self, file_path: Union[str, Path]) -> Dict[str, Any]:
        """
        Get comprehensive file information.

        Args:
            file_path: Path to file

        Returns:
            Dictionary with file information
        """
        validated_path = self.path_handler.path_validator.validate_file_path(
            file_path, must_exist=True
        )

        try:
            file_stat = validated_path.stat()

            return {
                "path": str(validated_path),
                "size": file_stat.st_size,
                "mode": oct(file_stat.st_mode),
                "uid": file_stat.st_uid,
                "gid": file_stat.st_gid,
                "modified": datetime.fromtimestamp(file_stat.st_mtime).isoformat(),
                "accessed": datetime.fromtimestamp(file_stat.st_atime).isoformat(),
                "created": datetime.fromtimestamp(file_stat.st_ctime).isoformat(),
                "is_readable": os.access(validated_path, os.R_OK),
                "is_writable": os.access(validated_path, os.W_OK),
                "is_executable": os.access(validated_path, os.X_OK),
                "hash_sha256": self.calculate_file_hash(validated_path, "sha256"),
            }

        except Exception as e:
            raise SecureFileError(f"Failed to get file info for {validated_path}: {e}")

    def _should_secure_delete(self, file_path: Path) -> bool:
        """Check if a file should be securely deleted (overwritten)."""
        # Secure delete for sensitive file types or if explicitly requested
        sensitive_extensions = {
            ".key",
            ".pem",
            ".p12",
            ".json",
            ".yml",
            ".yaml",
        }

        return (
            file_path.suffix.lower() in sensitive_extensions
            or "secret" in file_path.name.lower()
            or "key" in file_path.name.lower()
        )

    def _secure_overwrite(self, file_path: Path, passes: int = 3) -> None:
        """Securely overwrite a file before deletion."""
        try:
            file_size = file_path.stat().st_size

            with open(file_path, "r+b") as f:
                for _ in range(passes):
                    f.seek(0)
                    # Overwrite with random data
                    f.write(os.urandom(file_size))
                    f.flush()
                    os.fsync(f.fileno())

            self.logger.debug(f"Securely overwritten file: {file_path}")

        except Exception as e:
            self.logger.warning(f"Failed to securely overwrite {file_path}: {e}")


@contextmanager
def secure_file_lock(
    file_path: Union[str, Path],
    mode: str = "r",
    lock_type: int = fcntl.LOCK_SH,
    timeout: float = 10.0,
):
    """
    Context manager for secure file locking.

    Args:
        file_path: Path to file
        mode: File open mode
        lock_type: fcntl lock type (LOCK_SH, LOCK_EX)
        timeout: Timeout in seconds

    Yields:
        File handle with acquired lock
    """
    file_handle = None
    try:
        file_handle = open(file_path, mode)

        # Try to acquire lock with timeout
        import signal

        def timeout_handler(signum, frame):
            raise TimeoutError("Lock acquisition timeout")

        old_handler = signal.signal(signal.SIGALRM, timeout_handler)
        signal.alarm(int(timeout))

        try:
            fcntl.flock(file_handle.fileno(), lock_type)
            signal.alarm(0)  # Cancel alarm
        except Exception:
            signal.alarm(0)  # Cancel alarm
            raise SecureFileError(f"Failed to acquire lock on {file_path}")
        finally:
            signal.signal(signal.SIGALRM, old_handler)

        yield file_handle

    finally:
        if file_handle:
            try:
                fcntl.flock(file_handle.fileno(), fcntl.LOCK_UN)
                file_handle.close()
            except Exception as e:
                logging.getLogger(__name__).error(f"Error releasing file lock: {e}")
