"""
Cross-platform integration test helpers and utilities.

This module provides utilities for running integration tests across different
platforms (Windows, macOS, Linux) and handling platform-specific behaviors.
"""

import os
import platform
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union

import pytest


class PlatformInfo:
    """Information about the current platform."""

    @staticmethod
    def is_windows() -> bool:
        """Check if running on Windows."""
        return platform.system().lower() == "windows"

    @staticmethod
    def is_macos() -> bool:
        """Check if running on macOS."""
        return platform.system().lower() == "darwin"

    @staticmethod
    def is_linux() -> bool:
        """Check if running on Linux."""
        return platform.system().lower() == "linux"

    @staticmethod
    def get_platform_name() -> str:
        """Get the platform name."""
        return platform.system().lower()

    @staticmethod
    def get_python_executable() -> str:
        """Get the Python executable path for the current platform."""
        if PlatformInfo.is_windows():
            # On Windows, prefer 'python' over 'python3'
            return "python"
        else:
            # On Unix-like systems, prefer 'python3'
            return sys.executable or "python3"

    @staticmethod
    def get_path_separator() -> str:
        """Get the path separator for the current platform."""
        return os.path.sep

    @staticmethod
    def normalize_path(path: Union[str, Path]) -> str:
        """Normalize a path for the current platform."""
        return str(Path(path).resolve())

    @staticmethod
    def get_temp_dir() -> str:
        """Get the temporary directory for the current platform."""
        if PlatformInfo.is_windows():
            return os.environ.get("TEMP", tempfile.gettempdir())
        else:
            return tempfile.gettempdir()


class ProcessManager:
    """Cross-platform process management utilities."""

    @staticmethod
    def create_process_command(
        script_path: str, args: List[str] = None, python_executable: str = None
    ) -> List[str]:
        """Create a process command for the current platform."""
        if python_executable is None:
            python_executable = PlatformInfo.get_python_executable()

        command = [python_executable, script_path]
        if args:
            command.extend(args)

        return command

    @staticmethod
    def start_process(
        command: List[str],
        cwd: str = None,
        env: Dict[str, str] = None,
        capture_output: bool = True,
    ) -> subprocess.Popen:
        """Start a process with platform-appropriate settings."""
        process_env = os.environ.copy()
        if env:
            process_env.update(env)

        # Platform-specific process creation
        if PlatformInfo.is_windows():
            # On Windows, use creationflags to avoid popup windows
            creationflags = subprocess.CREATE_NO_WINDOW

            return subprocess.Popen(
                command,
                cwd=cwd,
                env=process_env,
                stdout=subprocess.PIPE if capture_output else None,
                stderr=subprocess.PIPE if capture_output else None,
                text=True,
                creationflags=creationflags,
            )
        else:
            # On Unix-like systems
            return subprocess.Popen(
                command,
                cwd=cwd,
                env=process_env,
                stdout=subprocess.PIPE if capture_output else None,
                stderr=subprocess.PIPE if capture_output else None,
                text=True,
            )

    @staticmethod
    def terminate_process(process: subprocess.Popen, timeout: float = 5.0) -> bool:
        """Terminate a process gracefully with platform-appropriate methods."""
        try:
            if PlatformInfo.is_windows():
                # On Windows, try terminate first
                process.terminate()
                try:
                    process.wait(timeout=timeout)
                    return True
                except subprocess.TimeoutExpired:
                    # Force kill if terminate doesn't work
                    process.kill()
                    process.wait(timeout=2.0)
                    return True
            else:
                # On Unix-like systems, try SIGTERM first
                process.terminate()
                try:
                    process.wait(timeout=timeout)
                    return True
                except subprocess.TimeoutExpired:
                    # Force kill with SIGKILL
                    process.kill()
                    process.wait(timeout=2.0)
                    return True
        except Exception:
            return False


class FileSystemUtils:
    """Cross-platform file system utilities."""

    @staticmethod
    def create_safe_temp_directory(prefix: str = "specforged_test_") -> str:
        """Create a temporary directory with safe permissions."""
        temp_dir = tempfile.mkdtemp(prefix=prefix)

        # Set appropriate permissions
        if not PlatformInfo.is_windows():
            os.chmod(temp_dir, 0o755)

        return temp_dir

    @staticmethod
    def safe_remove_directory(directory: Union[str, Path]) -> bool:
        """Safely remove a directory across platforms."""
        import shutil

        try:
            dir_path = Path(directory)
            if not dir_path.exists():
                return True

            if PlatformInfo.is_windows():
                # On Windows, files might be locked, so try multiple times
                for attempt in range(3):
                    try:
                        shutil.rmtree(dir_path)
                        return True
                    except (OSError, PermissionError):
                        if attempt < 2:
                            import time

                            time.sleep(0.5)
                        else:
                            # Final attempt: try to change permissions first
                            try:
                                FileSystemUtils._make_writable_recursive(dir_path)
                                shutil.rmtree(dir_path)
                                return True
                            except:
                                return False
            else:
                # On Unix-like systems
                shutil.rmtree(dir_path)
                return True

        except Exception:
            return False

    @staticmethod
    def _make_writable_recursive(path: Path) -> None:
        """Make a directory and all its contents writable."""
        try:
            if path.is_file():
                path.chmod(0o666)
            elif path.is_dir():
                path.chmod(0o777)
                for child in path.iterdir():
                    FileSystemUtils._make_writable_recursive(child)
        except:
            pass

    @staticmethod
    def get_available_disk_space(path: Union[str, Path]) -> int:
        """Get available disk space in bytes."""
        if PlatformInfo.is_windows():
            import ctypes

            free_bytes = ctypes.c_ulonglong(0)
            ctypes.windll.kernel32.GetDiskFreeSpaceExW(
                ctypes.c_wchar_p(str(path)), ctypes.pointer(free_bytes), None, None
            )
            return free_bytes.value
        else:
            import statvfs

            stat = os.statvfs(str(path))
            return stat.f_bavail * stat.f_frsize

    @staticmethod
    def is_case_sensitive_filesystem(path: Union[str, Path]) -> bool:
        """Check if the filesystem is case-sensitive."""
        test_dir = Path(path)
        if not test_dir.exists():
            test_dir = test_dir.parent

        # Create test files to check case sensitivity
        try:
            test_file_lower = test_dir / "test_case_sensitivity.tmp"
            test_file_upper = test_dir / "TEST_CASE_SENSITIVITY.tmp"

            test_file_lower.touch()

            # If filesystem is case-insensitive, the uppercase version will exist
            case_insensitive = test_file_upper.exists()

            # Cleanup
            if test_file_lower.exists():
                test_file_lower.unlink()
            if test_file_upper.exists() and case_insensitive:
                test_file_upper.unlink()

            return not case_insensitive

        except:
            # Default assumption based on platform
            return not PlatformInfo.is_windows()


class EnvironmentUtils:
    """Cross-platform environment utilities."""

    @staticmethod
    def get_environment_variables() -> Dict[str, str]:
        """Get platform-specific environment variables for testing."""
        env_vars = {}

        # Common variables
        env_vars["PYTHONPATH"] = os.pathsep.join(sys.path)
        env_vars["SPECFORGED_TEST_MODE"] = "1"

        # Platform-specific variables
        if PlatformInfo.is_windows():
            env_vars["PYTHONIOENCODING"] = "utf-8"
            # Ensure Windows handles Unicode properly
            env_vars["PYTHONUTF8"] = "1"
        else:
            # Unix-like systems
            env_vars["LC_ALL"] = "C.UTF-8"
            env_vars["LANG"] = "C.UTF-8"

        return env_vars

    @staticmethod
    def setup_test_environment() -> Dict[str, str]:
        """Set up the test environment with appropriate variables."""
        env = os.environ.copy()
        test_vars = EnvironmentUtils.get_environment_variables()
        env.update(test_vars)
        return env


class NetworkUtils:
    """Cross-platform network utilities for testing."""

    @staticmethod
    def find_free_port(start_port: int = 8000, max_attempts: int = 100) -> int:
        """Find a free port for testing servers."""
        import socket

        for port in range(start_port, start_port + max_attempts):
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                    sock.bind(("localhost", port))
                    return port
            except OSError:
                continue

        raise RuntimeError(
            f"Could not find a free port in range {start_port}-{start_port + max_attempts}"
        )

    @staticmethod
    def wait_for_port(host: str, port: int, timeout: float = 10.0) -> bool:
        """Wait for a port to become available."""
        import socket
        import time

        start_time = time.time()

        while time.time() - start_time < timeout:
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                    sock.settimeout(1.0)
                    result = sock.connect_ex((host, port))
                    if result == 0:
                        return True
            except:
                pass

            time.sleep(0.1)

        return False


class PlatformSpecificMarkers:
    """Pytest markers for platform-specific tests."""

    @staticmethod
    def windows_only():
        """Mark test as Windows-only."""
        return pytest.mark.skipif(
            not PlatformInfo.is_windows(), reason="Windows-only test"
        )

    @staticmethod
    def unix_only():
        """Mark test as Unix-only (Linux/macOS)."""
        return pytest.mark.skipif(PlatformInfo.is_windows(), reason="Unix-only test")

    @staticmethod
    def macos_only():
        """Mark test as macOS-only."""
        return pytest.mark.skipif(not PlatformInfo.is_macos(), reason="macOS-only test")

    @staticmethod
    def linux_only():
        """Mark test as Linux-only."""
        return pytest.mark.skipif(not PlatformInfo.is_linux(), reason="Linux-only test")

    @staticmethod
    def skip_if_no_disk_space(min_space_mb: int = 100):
        """Skip test if not enough disk space available."""

        def decorator(func):
            def wrapper(*args, **kwargs):
                temp_dir = tempfile.gettempdir()
                available_space = FileSystemUtils.get_available_disk_space(temp_dir)
                available_mb = available_space / (1024 * 1024)

                if available_mb < min_space_mb:
                    pytest.skip(
                        f"Not enough disk space: {available_mb:.1f}MB < {min_space_mb}MB"
                    )

                return func(*args, **kwargs)

            return wrapper

        return decorator


class IntegrationTestHelper:
    """Helper class for cross-platform integration tests."""

    def __init__(self, test_name: str):
        self.test_name = test_name
        self.platform = PlatformInfo.get_platform_name()
        self.temp_dirs: List[str] = []
        self.processes: List[subprocess.Popen] = []

    def create_temp_workspace(self, prefix: str = None) -> str:
        """Create a temporary workspace for testing."""
        if prefix is None:
            prefix = f"specforged_{self.test_name}_{self.platform}_"

        temp_dir = FileSystemUtils.create_safe_temp_directory(prefix)
        self.temp_dirs.append(temp_dir)
        return temp_dir

    def start_process(
        self, command: List[str], cwd: str = None, env: Dict[str, str] = None
    ) -> subprocess.Popen:
        """Start a process and track it for cleanup."""
        if env is None:
            env = EnvironmentUtils.setup_test_environment()

        process = ProcessManager.start_process(command, cwd, env)
        self.processes.append(process)
        return process

    def cleanup(self) -> None:
        """Clean up all resources created during testing."""
        # Terminate processes
        for process in self.processes:
            try:
                ProcessManager.terminate_process(process)
            except:
                pass
        self.processes.clear()

        # Remove temporary directories
        for temp_dir in self.temp_dirs:
            try:
                FileSystemUtils.safe_remove_directory(temp_dir)
            except:
                pass
        self.temp_dirs.clear()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.cleanup()


def create_cross_platform_test_suite():
    """Create a test suite that runs across all supported platforms."""

    def platform_test_decorator(test_func):
        """Decorator to run test on all platforms with platform-specific setup."""

        def wrapper(*args, **kwargs):
            test_name = test_func.__name__

            with IntegrationTestHelper(test_name) as helper:
                # Add platform info to test context
                kwargs["platform_helper"] = helper
                kwargs["platform_info"] = {
                    "name": PlatformInfo.get_platform_name(),
                    "is_windows": PlatformInfo.is_windows(),
                    "is_macos": PlatformInfo.is_macos(),
                    "is_linux": PlatformInfo.is_linux(),
                    "python_executable": PlatformInfo.get_python_executable(),
                    "path_separator": PlatformInfo.get_path_separator(),
                }

                return test_func(*args, **kwargs)

        return wrapper

    return platform_test_decorator


# Example usage patterns for cross-platform testing
class CrossPlatformTestExamples:
    """Examples of cross-platform test patterns."""

    @staticmethod
    @create_cross_platform_test_suite()
    def test_file_operations_cross_platform(platform_helper, platform_info):
        """Example: Test file operations across platforms."""
        workspace = platform_helper.create_temp_workspace()

        # Test path handling
        test_path = Path(workspace) / "test_spec" / "requirements.md"
        test_path.parent.mkdir(parents=True, exist_ok=True)

        # Write content with platform-appropriate line endings
        content = "# Test Requirements\n\nThis is a test file.\n"
        test_path.write_text(content, encoding="utf-8")

        # Verify file was created
        assert test_path.exists()

        # Read and verify content
        read_content = test_path.read_text(encoding="utf-8")
        assert "Test Requirements" in read_content

        print(f"File operations test passed on {platform_info['name']}")

    @staticmethod
    @PlatformSpecificMarkers.windows_only()
    def test_windows_specific_behavior():
        """Example: Windows-specific test."""
        # Test Windows-specific file system behavior
        assert PlatformInfo.is_windows()

        # Test case-insensitive file system
        with tempfile.TemporaryDirectory() as temp_dir:
            test_file = Path(temp_dir) / "TestFile.txt"
            test_file.write_text("test content")

            # On Windows, these should refer to the same file
            upper_file = Path(temp_dir) / "TESTFILE.TXT"
            assert upper_file.exists()  # Should exist due to case insensitivity

    @staticmethod
    @PlatformSpecificMarkers.unix_only()
    def test_unix_specific_behavior():
        """Example: Unix-specific test."""
        # Test Unix-specific behavior
        assert not PlatformInfo.is_windows()

        # Test case-sensitive file system (usually)
        with tempfile.TemporaryDirectory() as temp_dir:
            if FileSystemUtils.is_case_sensitive_filesystem(temp_dir):
                test_file = Path(temp_dir) / "testfile.txt"
                test_file.write_text("test content")

                # On case-sensitive systems, these are different files
                upper_file = Path(temp_dir) / "TESTFILE.TXT"
                assert not upper_file.exists()  # Should not exist
