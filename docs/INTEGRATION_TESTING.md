# SpecForge Integration Testing Guide

This document provides comprehensive guidance on running and understanding the integration tests for the SpecForge MCP ecosystem.

## Overview

SpecForge integration tests verify that the complete system works correctly together, including:

- **Python MCP Server** (`src/specforged/`)
- **VS Code Extension** (`vscode-specforged/src/`)
- **File-based IPC Protocol** (`mcp-operations.json`, `mcp-results.json`, `specforge-sync.json`)
- **Cross-platform Compatibility** (Windows, macOS, Linux)

The integration tests simulate real-world usage scenarios and verify that all components integrate properly.

## Test Structure

### Python Integration Tests (`tests/integration/`)

```
tests/integration/
├── __init__.py                    # Package initialization
├── fixtures.py                    # Test fixtures and utilities
├── test_operation_lifecycle.py    # Complete operation lifecycle tests
├── test_conflict_resolution.py    # Conflict detection and resolution
├── test_server_connectivity.py    # Server offline/online scenarios
├── test_filesystem_sync.py        # File system change detection
├── test_performance_load.py       # Performance and load tests
├── test_end_to_end.py             # End-to-end with actual server
└── cross_platform_utils.py       # Cross-platform utilities
```

### TypeScript Integration Tests (`vscode-specforged/src/test/integration/`)

```
vscode-specforged/src/test/integration/
├── fixtures.ts                    # TypeScript test fixtures
├── endToEnd.test.ts               # Extension end-to-end tests
└── mock-mcp-server.py             # Mock server for TypeScript tests
```

## Running Integration Tests

### Prerequisites

1. **Python Environment**:
   ```bash
   # Install dependencies
   pip install -r requirements.txt
   pip install pytest pytest-asyncio

   # Install SpecForge in development mode
   pip install -e .
   ```

2. **VS Code Extension Environment**:
   ```bash
   cd vscode-specforged
   npm install
   npm run compile
   ```

3. **System Requirements**:
   - At least 2GB available disk space
   - Python 3.8+
   - Node.js 16+
   - Git

### Running Python Integration Tests

```bash
# Run all integration tests
pytest tests/integration/ -v

# Run specific test modules
pytest tests/integration/test_operation_lifecycle.py -v
pytest tests/integration/test_conflict_resolution.py -v
pytest tests/integration/test_performance_load.py -v

# Run tests with performance monitoring
pytest tests/integration/test_performance_load.py -v -s

# Run end-to-end tests with actual server
pytest tests/integration/test_end_to_end.py -v

# Run cross-platform tests
pytest tests/integration/ -v -m "not slow"
```

### Running TypeScript Integration Tests

```bash
cd vscode-specforged

# Run all extension tests (including integration)
npm test

# Run only integration tests
npm run test:integration

# Run with debugging
npm run test:integration -- --verbose
```

### Running Tests on Specific Platforms

```bash
# Windows-specific tests
pytest tests/integration/ -v -m "windows_only"

# Unix-only tests (Linux/macOS)
pytest tests/integration/ -v -m "unix_only"

# macOS-specific tests
pytest tests/integration/ -v -m "macos_only"

# Skip platform-specific tests
pytest tests/integration/ -v -m "not platform_specific"
```

## Test Categories

### 1. Operation Lifecycle Tests (`test_operation_lifecycle.py`)

**Purpose**: Verify complete operation flow from VS Code extension to MCP server and back.

**Key Test Scenarios**:
- Basic operation lifecycle (queue → process → result → notification)
- Operation retry logic and error handling
- Multiple operation types processing
- Operation dependencies and ordering
- File monitoring during operations
- Batch operation processing
- Performance under load

**Example**:
```python
async def test_basic_operation_lifecycle(self, integration_workspace):
    # Queue operation through extension
    operation_id = await integration_workspace.simulate_extension_operation(
        OperationType.CREATE_SPEC,
        {"name": "Test Spec", "description": "Integration test"},
        priority=7
    )

    # Process through MCP server
    await integration_workspace.process_all_operations()

    # Verify completion
    result = await integration_workspace.wait_for_operation_completion(operation_id)
    assert result.success
```

### 2. Conflict Resolution Tests (`test_conflict_resolution.py`)

**Purpose**: Test conflict detection and resolution workflows.

**Key Test Scenarios**:
- Duplicate operation detection
- Concurrent modification conflicts
- Dependency conflicts
- File modification conflicts
- Automatic conflict resolution
- Manual conflict resolution workflows
- Performance under conflicting operations

**Example**:
```python
async def test_concurrent_modification_conflict(self, integration_workspace):
    # Create conflicting operations
    operation1 = create_conflicting_operation("spec-1", "Version A")
    operation2 = create_conflicting_operation("spec-1", "Version B")

    # Queue both operations
    await integration_workspace.queue_operation(operation1)
    await integration_workspace.queue_operation(operation2)

    # Verify conflict detection and resolution
    conflicts = await integration_workspace.get_detected_conflicts()
    assert len(conflicts) > 0
```

### 3. Server Connectivity Tests (`test_server_connectivity.py`)

**Purpose**: Test system behavior during server offline/online scenarios.

**Key Test Scenarios**:
- Operations queued while server offline
- Batch processing when server comes online
- Heartbeat and connectivity monitoring
- Server restart and recovery
- Intermittent connectivity handling
- Long disconnect recovery

**Example**:
```python
async def test_operations_queue_while_server_offline(self, integration_workspace):
    # Mark server offline
    await integration_workspace.simulate_server_offline_period(2.0)

    # Queue operations while offline
    for i in range(5):
        await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": f"Offline Spec {i}"}
        )

    # Verify operations queued but not processed
    queue = await integration_workspace.get_operation_queue()
    assert all(op.status == OperationStatus.PENDING for op in queue.operations)
```

### 4. File System Sync Tests (`test_filesystem_sync.py`)

**Purpose**: Test file system change detection and sync state management.

**Key Test Scenarios**:
- External file modification detection
- Workspace directory relocation
- Concurrent file modifications
- File permission change handling
- Sync state consistency
- Cross-platform file system compatibility

**Example**:
```python
async def test_external_file_modification_detection(self, integration_workspace):
    # Create specification
    spec_id = "external-mod-test"
    await integration_workspace.create_test_specification(spec_id)

    # Simulate external modification
    await integration_workspace.simulate_file_modification(
        spec_id, "requirements.md", "Externally modified content"
    )

    # Verify change detection
    assert len(integration_workspace.file_changes) > 0
```

### 5. Performance and Load Tests (`test_performance_load.py`)

**Purpose**: Test performance characteristics under load.

**Key Test Scenarios**:
- Sustained high throughput processing
- Concurrent operation processing
- Memory usage under load
- CPU utilization efficiency
- File system I/O efficiency
- Resource cleanup efficiency
- Queue scalability

**Example**:
```python
async def test_sustained_operation_throughput(self, integration_workspace, performance_monitor):
    # Generate sustained load
    operations_per_batch = 25
    num_batches = 10

    for batch_num in range(num_batches):
        # Create batch operations
        batch_ops = create_operation_batch(operations_per_batch)

        # Process and measure performance
        start_time = time.time()
        await integration_workspace.process_operations_batch(batch_ops)
        batch_time = time.time() - start_time

        performance_monitor.record_batch_time(batch_time)

    # Verify performance thresholds
    report = performance_monitor.get_performance_report()
    assert report["operations_per_second"] > 5.0
```

### 6. End-to-End Tests (`test_end_to_end.py`)

**Purpose**: Test with actual MCP server process for maximum realism.

**Key Test Scenarios**:
- Actual server startup and shutdown
- Real operation processing
- Server crash recovery
- Complex workflow scenarios
- Error condition handling

**Example**:
```python
async def test_actual_server_startup_and_shutdown(self):
    workspace = ActualMcpServerWorkspace(temp_dir)
    await workspace.setup()

    try:
        # Start actual MCP server process
        await workspace.start_actual_mcp_server()

        # Verify server running
        assert workspace.server_process.poll() is None

        # Test basic operation
        operation_id = await workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC, {"name": "Real Server Test"}
        )

        result = await workspace.wait_for_operation_completion(operation_id)
        assert result.success

    finally:
        await workspace.cleanup()
```

## Test Utilities and Fixtures

### IntegrationTestWorkspace

Main test fixture that provides:
- Temporary workspace setup
- MCP server simulation
- Operation queuing and processing
- File system monitoring
- Sync state management

```python
@pytest.fixture
async def integration_workspace():
    with tempfile.TemporaryDirectory() as temp_dir:
        workspace = IntegrationTestWorkspace(Path(temp_dir))
        await workspace.setup()
        try:
            yield workspace
        finally:
            await workspace.cleanup()
```

### MockMcpServer

Simulates MCP server behavior:
- Configurable processing delays
- Failure rate simulation
- Operation type handling
- Result generation

```python
mock_server = MockMcpServer(workspace)
mock_server.set_processing_delay(0.1)  # 100ms delay
mock_server.set_failure_rate(0.1)      # 10% failure rate
await mock_server.start()
```

### PerformanceMonitor

Tracks performance metrics:
- Operation processing times
- Queue sizes
- Memory usage
- Throughput rates

```python
monitor = PerformanceMonitor()
monitor.start_monitoring()

# ... run operations ...

monitor.stop_monitoring()
report = monitor.get_performance_report()
```

### Cross-Platform Utilities

Handle platform-specific behaviors:
- Path handling
- Process management
- File system operations
- Environment setup

```python
from cross_platform_utils import PlatformInfo, ProcessManager

if PlatformInfo.is_windows():
    # Windows-specific test logic
    command = ProcessManager.create_process_command(script, args)
    process = ProcessManager.start_process(command)
```

## Test Configuration

### Environment Variables

```bash
# Enable test mode
export SPECFORGED_TEST_MODE=1

# Configure test timeouts
export SPECFORGED_TEST_TIMEOUT=30

# Set log level for debugging
export SPECFORGED_LOG_LEVEL=DEBUG

# Platform-specific encoding
export PYTHONIOENCODING=utf-8  # Windows
export LC_ALL=C.UTF-8          # Linux/macOS
```

### Pytest Configuration (`pytest.ini`)

```ini
[tool:pytest]
testpaths = tests
python_files = test_*.py
python_functions = test_*
python_classes = Test*
addopts =
    -v
    --tb=short
    --strict-markers
    --disable-warnings
markers =
    slow: marks tests as slow (deselect with '-m "not slow"')
    windows_only: marks tests that only run on Windows
    unix_only: marks tests that only run on Unix systems
    macos_only: marks tests that only run on macOS
    linux_only: marks tests that only run on Linux
    integration: marks tests as integration tests
    performance: marks tests that measure performance
```

## Debugging Integration Tests

### Enable Debug Logging

```python
import logging
logging.basicConfig(level=logging.DEBUG)

# In tests
print(f"Operation queue: {workspace.get_operation_queue()}")
print(f"Sync state: {workspace.get_sync_state()}")
```

### Inspect Test Artifacts

```python
# Check operation queue file
with open(workspace.queue_file, 'r') as f:
    queue_data = json.load(f)
    print(json.dumps(queue_data, indent=2))

# Check sync state
with open(workspace.sync_file, 'r') as f:
    sync_data = json.load(f)
    print(json.dumps(sync_data, indent=2))
```

### Monitor File Changes

```python
# Track file system changes
print("File changes detected:")
for change in workspace.file_changes:
    print(f"  {change['path']}: {change['type']} at {change['timestamp']}")
```

### Server Process Debugging

```python
# Get server logs
stdout, stderr = await workspace.get_server_logs()
print(f"Server stdout: {stdout}")
print(f"Server stderr: {stderr}")

# Check server status
if workspace.server_process:
    print(f"Server PID: {workspace.server_process.pid}")
    print(f"Server return code: {workspace.server_process.poll()}")
```

## Continuous Integration

### GitHub Actions Configuration (`.github/workflows/integration.yml`)

```yaml
name: Integration Tests

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  integration:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
        python-version: [3.8, 3.9, '3.10', 3.11]

    steps:
    - uses: actions/checkout@v3

    - name: Set up Python
      uses: actions/setup-python@v4
      with:
        python-version: ${{ matrix.python-version }}

    - name: Install dependencies
      run: |
        pip install -r requirements.txt
        pip install -e .

    - name: Run integration tests
      run: |
        pytest tests/integration/ -v --tb=short

    - name: Run performance tests
      run: |
        pytest tests/integration/test_performance_load.py -v -s

    - name: Upload test artifacts
      if: failure()
      uses: actions/upload-artifact@v3
      with:
        name: test-artifacts-${{ matrix.os }}-py${{ matrix.python-version }}
        path: |
          test_artifacts/
          *.log
```

## Best Practices

### 1. Test Isolation
- Each test uses a fresh temporary workspace
- Clean up all resources after tests
- Use unique identifiers for test data

### 2. Realistic Scenarios
- Test actual user workflows
- Include error conditions and edge cases
- Test across different platforms

### 3. Performance Awareness
- Monitor resource usage
- Set realistic performance thresholds
- Test under load conditions

### 4. Cross-Platform Compatibility
- Use platform-appropriate utilities
- Handle path separators correctly
- Account for case sensitivity differences

### 5. Debugging Support
- Provide detailed error messages
- Log intermediate states
- Include performance metrics

## Troubleshooting Common Issues

### Test Timeouts

```python
# Increase timeout for slow operations
result = await workspace.wait_for_operation_completion(
    operation_id, timeout_seconds=60
)
```

### File Permission Errors

```python
# Handle platform-specific permissions
if PlatformInfo.is_windows():
    # Windows-specific handling
    os.chmod(file_path, stat.S_IWRITE)
else:
    # Unix-like systems
    os.chmod(file_path, 0o644)
```

### Server Startup Issues

```python
# Check server logs for startup problems
stdout, stderr = await workspace.get_server_logs()
if "ERROR" in stderr:
    print(f"Server startup error: {stderr}")
```

### Memory Issues

```python
# Monitor memory usage during tests
import psutil
process = psutil.Process()
memory_mb = process.memory_info().rss / 1024 / 1024
print(f"Memory usage: {memory_mb:.1f}MB")
```

## Contributing to Integration Tests

### Adding New Test Scenarios

1. **Identify the test category** (lifecycle, conflict, connectivity, etc.)
2. **Create test case** following existing patterns
3. **Use appropriate fixtures** and utilities
4. **Include cross-platform considerations**
5. **Add performance monitoring** if applicable
6. **Update documentation** with new scenarios

### Example New Test

```python
@pytest.mark.asyncio
async def test_new_integration_scenario(self, integration_workspace: IntegrationTestWorkspace):
    """Test description of new scenario."""
    # Setup
    await integration_workspace.setup_test_condition()

    # Execute
    result = await integration_workspace.execute_test_operation()

    # Verify
    assert result.success
    assert result.meets_expectations()

    # Cleanup (handled by fixture)
```

This comprehensive integration test suite ensures that SpecForge works correctly as a complete system across all supported platforms and usage scenarios.
