#!/usr/bin/env python3
"""
SpecForge Integration Test Runner

A convenient script for running integration tests with various configurations
and reporting options.
"""

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import List


def run_command(
    command: List[str], capture_output: bool = False, check: bool = True
) -> subprocess.CompletedProcess:
    """Run a command with optional output capture."""
    print(f"Running: {' '.join(command)}")

    if capture_output:
        result = subprocess.run(command, capture_output=True, text=True, check=False)
    else:
        result = subprocess.run(command, check=False)

    if check and result.returncode != 0:
        print(f"Command failed with return code {result.returncode}")
        if capture_output and result.stderr:
            print(f"Error output: {result.stderr}")
        sys.exit(result.returncode)

    return result


def check_dependencies() -> bool:
    """Check if required dependencies are available."""
    print("Checking dependencies...")

    # Check Python version
    if sys.version_info < (3, 8):
        print("ERROR: Python 3.8 or higher is required")
        return False

    # Check pytest
    try:
        import pytest

        print(f"✓ pytest {pytest.__version__}")
    except ImportError:
        print(
            "ERROR: pytest not found. Install with: "
            "pip install pytest pytest-asyncio"
        )
        return False

    # Check pytest-asyncio
    try:
        import pytest_asyncio

        print(f"✓ pytest-asyncio {pytest_asyncio.__version__}")
    except ImportError:
        print(
            "ERROR: pytest-asyncio not found. Install with: "
            "pip install pytest-asyncio"
        )
        return False

    # Check specforged package
    try:
        import specforged  # noqa: F401

        print("✓ specforged package available")
    except ImportError:
        print(
            "WARNING: specforged package not found. Install with: " "pip install -e ."
        )

    return True


def main():
    """Main entry point for the test runner."""
    parser = argparse.ArgumentParser(
        description="Run SpecForge integration tests",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/run_integration_tests.py  # Run all tests
  python scripts/run_integration_tests.py --fast  # Run fast tests
  python scripts/run_integration_tests.py --performance  # Perf tests
  python scripts/run_integration_tests.py --platform windows  # Platform
  python scripts/run_integration_tests.py --module lifecycle  # Module
  python scripts/run_integration_tests.py --end-to-end  # E2E tests
  python scripts/run_integration_tests.py --verbose --debug  # Max output
        """,
    )

    # Test selection options
    parser.add_argument(
        "--module",
        "-m",
        choices=[
            "lifecycle",
            "conflict",
            "connectivity",
            "filesystem",
            "performance",
            "end-to-end",
        ],
        help="Run specific test module",
    )

    parser.add_argument(
        "--platform",
        "-p",
        choices=["windows", "unix", "macos", "linux"],
        help="Run platform-specific tests only",
    )

    parser.add_argument(
        "--fast",
        "-f",
        action="store_true",
        help="Run only fast tests (exclude slow/performance tests)",
    )

    parser.add_argument(
        "--performance",
        action="store_true",
        help="Run performance and load tests",
    )

    parser.add_argument(
        "--end-to-end",
        action="store_true",
        help="Run end-to-end tests with actual MCP server",
    )

    # Output options
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Enable verbose test output",
    )

    parser.add_argument(
        "--debug",
        "-d",
        action="store_true",
        help="Enable debug logging and preserve test artifacts",
    )

    parser.add_argument("--quiet", "-q", action="store_true", help="Reduce test output")

    # Execution options
    parser.add_argument(
        "--parallel",
        "-j",
        type=int,
        metavar="N",
        help="Run tests in parallel with N workers",
    )

    parser.add_argument(
        "--timeout",
        type=int,
        default=300,
        help="Test timeout in seconds (default: 300)",
    )

    parser.add_argument(
        "--check-deps", action="store_true", help="Check dependencies and exit"
    )

    parser.add_argument("--no-check", action="store_true", help="Skip dependency check")

    parser.add_argument(
        "--report",
        choices=["html", "junit", "json"],
        help="Generate test report in specified format",
    )

    args = parser.parse_args()

    # Check dependencies unless skipped
    if args.check_deps:
        success = check_dependencies()
        sys.exit(0 if success else 1)

    if not args.no_check and not check_dependencies():
        sys.exit(1)

    # Build pytest command
    pytest_cmd = ["pytest"]

    # Test path selection
    if args.module:
        module_map = {
            "lifecycle": "tests/integration/test_operation_lifecycle.py",
            "conflict": "tests/integration/test_conflict_resolution.py",
            "connectivity": "tests/integration/test_server_connectivity.py",
            "filesystem": "tests/integration/test_filesystem_sync.py",
            "performance": "tests/integration/test_performance_load.py",
            "end-to-end": "tests/integration/test_end_to_end.py",
        }
        pytest_cmd.append(module_map[args.module])
    else:
        pytest_cmd.append("tests/integration/")

    # Marker selection
    markers = []

    if args.platform:
        platform_markers = {
            "windows": "windows_only",
            "unix": "unix_only",
            "macos": "macos_only",
            "linux": "linux_only",
        }
        markers.append(platform_markers[args.platform])

    if args.fast:
        markers.append("not slow")
        markers.append("not performance")

    if args.performance:
        markers.append("performance")

    if args.end_to_end:
        markers.append("end_to_end")

    if markers:
        pytest_cmd.extend(["-m", " and ".join(markers)])

    # Output options
    if args.verbose:
        pytest_cmd.append("-v")
        if args.debug:
            pytest_cmd.append("-s")
            pytest_cmd.append("--tb=long")
            pytest_cmd.append("--log-cli-level=DEBUG")
        else:
            pytest_cmd.append("--tb=short")
    elif args.quiet:
        pytest_cmd.append("-q")
    else:
        pytest_cmd.append("--tb=short")

    # Execution options
    if args.parallel:
        pytest_cmd.extend(["-n", str(args.parallel)])
        # Need pytest-xdist for parallel execution
        try:
            __import__("xdist")
        except ImportError:
            print(
                "WARNING: pytest-xdist not found. Install with: "
                "pip install pytest-xdist"
            )
            print("Running tests sequentially instead.")

    if args.timeout:
        pytest_cmd.extend(["--timeout", str(args.timeout)])
        # Need pytest-timeout for timeouts
        try:
            __import__("pytest_timeout")
        except ImportError:
            print(
                "WARNING: pytest-timeout not found. Install with: "
                "pip install pytest-timeout"
            )

    # Report generation
    if args.report:
        report_dir = Path("test_reports")
        report_dir.mkdir(exist_ok=True)

        if args.report == "html":
            pytest_cmd.extend(["--html", str(report_dir / "integration_report.html")])
            pytest_cmd.append("--self-contained-html")
        elif args.report == "junit":
            pytest_cmd.extend(
                ["--junit-xml", str(report_dir / "integration_results.xml")]
            )
        elif args.report == "json":
            pytest_cmd.extend(
                [
                    "--json-report",
                    "--json-report-file",
                    str(report_dir / "integration_report.json"),
                ]
            )

    # Environment setup
    test_env = os.environ.copy()
    test_env["SPECFORGED_TEST_MODE"] = "1"

    if args.debug:
        test_env["SPECFORGED_LOG_LEVEL"] = "DEBUG"
        test_env["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "0"

    # Platform-specific environment
    if sys.platform == "win32":
        test_env["PYTHONIOENCODING"] = "utf-8"
        test_env["PYTHONUTF8"] = "1"
    else:
        test_env["LC_ALL"] = "C.UTF-8"
        test_env["LANG"] = "C.UTF-8"

    # Run tests
    print(f"\n{'=' * 60}")
    print("SpecForge Integration Test Runner")
    print(f"{'=' * 60}")
    print(f"Command: {' '.join(pytest_cmd)}")
    print(f"Working directory: {os.getcwd()}")
    print(f"Python version: {sys.version}")

    if args.debug:
        print("Environment variables:")
        for key, value in test_env.items():
            if key.startswith("SPECFORGED") or key.startswith("PYTEST"):
                print(f"  {key}={value}")

    print(f"{'=' * 60}\n")

    # Record start time
    start_time = time.time()

    # Execute tests
    try:
        result = subprocess.run(pytest_cmd, env=test_env, check=False)
        exit_code = result.returncode
    except KeyboardInterrupt:
        print("\nTest execution interrupted by user")
        exit_code = 130
    except Exception as e:
        print(f"Error running tests: {e}")
        exit_code = 1

    # Report results
    end_time = time.time()
    duration = end_time - start_time

    print(f"\n{'=' * 60}")
    print(f"Test execution completed in {duration:.1f} seconds")

    if exit_code == 0:
        print("✅ All tests passed!")
    elif exit_code == 130:
        print("⚠️  Test execution interrupted")
    else:
        print(f"❌ Tests failed (exit code: {exit_code})")

    if args.report:
        print("📊 Test report generated in: test_reports/")

    print(f"{'=' * 60}")

    sys.exit(exit_code)


if __name__ == "__main__":
    main()
