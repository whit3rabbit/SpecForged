# SpecForge Integration Tests

This directory contains comprehensive end-to-end integration tests for the SpecForge MCP ecosystem.

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt
pip install pytest pytest-asyncio

# Run all integration tests
pytest tests/integration/ -v

# Run specific test category
pytest tests/integration/test_operation_lifecycle.py -v
```

## Test Modules

### 📋 `test_operation_lifecycle.py`
Tests complete operation flow: Extension → Queue → MCP Server → Results → Notifications

**Key Scenarios:**
- Basic operation lifecycle
- Operation retry logic
- Dependency handling
- Batch processing
- Performance under load

### ⚔️ `test_conflict_resolution.py`
Tests conflict detection and resolution workflows

**Key Scenarios:**
- Duplicate operation detection
- Concurrent modification conflicts
- Automatic conflict resolution
- Manual resolution workflows

### 🌐 `test_server_connectivity.py`
Tests server offline/online scenarios and operation batching

**Key Scenarios:**
- Operations queued while server offline
- Batch processing when server returns
- Server restart recovery
- Intermittent connectivity

### 📁 `test_filesystem_sync.py`
Tests file system change detection and sync state management

**Key Scenarios:**
- External file modification detection
- Workspace directory changes
- File permission handling
- Cross-platform compatibility

### ⚡ `test_performance_load.py`
Tests performance characteristics under load

**Key Scenarios:**
- High throughput processing
- Memory usage monitoring
- Resource utilization
- Scalability limits

### 🔗 `test_end_to_end.py`
Tests with actual MCP server process for maximum realism

**Key Scenarios:**
- Real server startup/shutdown
- Actual operation processing
- Server crash recovery
- Complex workflows

## Test Infrastructure

### `fixtures.py`
Core test utilities and fixtures:

- **`IntegrationTestWorkspace`** - Main test workspace with MCP server simulation
- **`MockMcpServer`** - Configurable mock server for testing
- **`PerformanceMonitor`** - Performance metrics tracking
- **`OperationBuilder`** - Fluent operation creation

### `cross_platform_utils.py`
Cross-platform compatibility utilities:

- **`PlatformInfo`** - Platform detection and utilities
- **`ProcessManager`** - Cross-platform process handling
- **`FileSystemUtils`** - Platform-aware file operations
- **`IntegrationTestHelper`** - Test lifecycle management

## Running Tests

### Basic Execution
```bash
# All integration tests
pytest tests/integration/

# Specific test file
pytest tests/integration/test_operation_lifecycle.py

# Specific test method
pytest tests/integration/test_conflict_resolution.py::TestConflictDetection::test_duplicate_operation_conflict_detection

# With verbose output
pytest tests/integration/ -v -s
```

### Platform-Specific Tests
```bash
# Windows-only tests
pytest tests/integration/ -m "windows_only"

# Unix-only tests (Linux/macOS)
pytest tests/integration/ -m "unix_only"

# Skip slow tests
pytest tests/integration/ -m "not slow"
```

### Performance Testing
```bash
# Run performance tests with output
pytest tests/integration/test_performance_load.py -v -s

# Run with specific performance thresholds
pytest tests/integration/test_performance_load.py -v --tb=short
```

## Test Patterns

### Basic Integration Test
```python
@pytest.mark.asyncio
async def test_basic_scenario(integration_workspace: IntegrationTestWorkspace):
    # Create operation
    operation_id = await integration_workspace.simulate_extension_operation(
        OperationType.CREATE_SPEC,
        {"name": "Test Spec", "specId": "test-spec"},
        priority=7
    )

    # Process operation
    await integration_workspace.process_all_operations()

    # Verify result
    result = await integration_workspace.wait_for_operation_completion(operation_id)
    assert result.success
```

### Performance Testing
```python
@pytest.mark.asyncio
async def test_performance_scenario(integration_workspace: IntegrationTestWorkspace, performance_monitor: PerformanceMonitor):
    performance_monitor.start_monitoring()

    # Generate load
    for i in range(100):
        await integration_workspace.simulate_extension_operation(
            OperationType.CREATE_SPEC,
            {"name": f"Perf Test {i}", "specId": f"perf-{i:03d}"}
        )

    # Process and measure
    await integration_workspace.process_all_operations()
    performance_monitor.stop_monitoring()

    # Assert performance
    report = performance_monitor.get_performance_report()
    assert report["operations_per_second"] > 5.0
```

### Cross-Platform Testing
```python
@create_cross_platform_test_suite()
def test_cross_platform_scenario(platform_helper, platform_info):
    workspace = platform_helper.create_temp_workspace()

    # Platform-specific logic
    if platform_info['is_windows']:
        # Windows-specific test
        pass
    else:
        # Unix-like systems
        pass

    # Common verification
    assert workspace.exists()
```

## Test Data

### Operation Types Tested
- `CREATE_SPEC` - Create new specification
- `UPDATE_REQUIREMENTS` - Update requirements.md
- `UPDATE_DESIGN` - Update design.md
- `UPDATE_TASKS` - Update tasks.md
- `ADD_USER_STORY` - Add user story to requirements
- `UPDATE_TASK_STATUS` - Update task completion status
- `DELETE_SPEC` - Delete specification
- `HEARTBEAT` - Server health check

### File System Test Scenarios
- Specification creation and modification
- External file changes (user editing files directly)
- Workspace directory relocation
- File permission changes
- Large file handling
- Unicode content support

### Error Conditions Tested
- Invalid operation parameters
- Non-existent specifications
- Server connectivity issues
- File system errors
- Memory/resource constraints
- Circular dependencies

## Debugging Tests

### Enable Debug Output
```bash
# Run with debug logging
pytest tests/integration/ -v -s --log-cli-level=DEBUG

# Capture test output
pytest tests/integration/ -v -s --capture=no
```

### Inspect Test State
```python
# In test code
print(f"Queue state: {integration_workspace.get_operation_queue()}")
print(f"Sync state: {integration_workspace.get_sync_state()}")
print(f"File changes: {integration_workspace.file_changes}")
```

### Preserve Test Artifacts
```python
# Don't cleanup for debugging
@pytest.fixture
async def debug_workspace():
    with tempfile.TemporaryDirectory(delete=False) as temp_dir:
        workspace = IntegrationTestWorkspace(Path(temp_dir))
        print(f"Debug workspace: {temp_dir}")
        await workspace.setup()
        yield workspace
        # No cleanup - files preserved for inspection
```

## Performance Benchmarks

Target performance characteristics:

| Metric | Target | Test |
|--------|--------|------|
| **Throughput** | > 5 ops/sec | Sustained load |
| **Latency** | < 2s per operation | Individual operations |
| **Memory Growth** | < 200MB increase | 1000 operations |
| **Conflict Resolution** | < 1s | Simple conflicts |
| **Batch Processing** | > 80% success rate | 100 operations |
| **Recovery Time** | < 10s | Server restart |

## Contributing

### Adding New Tests

1. **Choose appropriate test module** based on scenario type
2. **Follow existing patterns** and naming conventions
3. **Include performance monitoring** for resource-intensive tests
4. **Add cross-platform considerations** using utilities
5. **Update documentation** with new test scenarios

### Test Naming Convention
```python
# Format: test_{scenario}_{condition}_{expected_result}
def test_operation_lifecycle_with_dependencies_completes_in_order():
    pass

def test_conflict_resolution_duplicate_operations_cancels_newer():
    pass

def test_server_connectivity_offline_period_queues_operations():
    pass
```

### Required Test Elements
- **Setup** - Create necessary test conditions
- **Execution** - Perform the operation being tested
- **Verification** - Assert expected outcomes
- **Cleanup** - Handled automatically by fixtures

## Continuous Integration

Integration tests run automatically on:
- **Push to main/develop branches**
- **Pull requests**
- **Scheduled nightly runs**

Platforms tested:
- **Ubuntu Latest** (Linux)
- **Windows Latest**
- **macOS Latest**

Python versions:
- **3.8, 3.9, 3.10, 3.11**

## Troubleshooting

### Common Issues

**Test Timeouts**
```python
# Increase timeout for slow operations
result = await workspace.wait_for_operation_completion(op_id, timeout_seconds=60)
```

**File Permission Errors**
```bash
# Ensure proper test environment setup
export SPECFORGED_TEST_MODE=1
pytest tests/integration/ --tb=short
```

**Memory Issues**
```python
# Monitor memory usage
import psutil
process = psutil.Process()
print(f"Memory: {process.memory_info().rss / 1024 / 1024:.1f}MB")
```

**Platform-Specific Failures**
```bash
# Run only cross-platform tests
pytest tests/integration/ -m "not platform_specific"

# Run platform-specific tests
pytest tests/integration/ -m "windows_only"  # or unix_only, macos_only, linux_only
```

### Getting Help

- Check the [Integration Testing Guide](../../docs/INTEGRATION_TESTING.md)
- Review test logs and output
- Run with verbose debugging: `pytest -v -s --tb=long`
- Examine preserved test artifacts in temp directories

For more detailed information, see the complete [Integration Testing Documentation](../../docs/INTEGRATION_TESTING.md).
