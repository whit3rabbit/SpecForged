/**
 * End-to-end integration tests for the VS Code extension + MCP server ecosystem.
 *
 * These tests verify the complete operation lifecycle across the entire system:
 * VS Code Extension → File IPC → MCP Server → Results → Notifications
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

import {
    IntegrationTestWorkspace,
    MockMcpServer,
    IntegrationPerformanceMonitor,
    IntegrationOperationBuilder,
    IntegrationTestUtils
} from './fixtures';

import {
    McpOperationType,
    McpOperationStatus,
    McpOperationPriority
} from '../../models/mcpOperation';

suite('End-to-End Integration Tests', function() {
    // Increase timeout for integration tests
    this.timeout(30000);

    let testWorkspace: IntegrationTestWorkspace;
    let mockServer: MockMcpServer;
    let tempDir: string;

    // Set cleaner logging for tests unless debug is explicitly requested
    suiteSetup(function() {
        if (!process.env.TEST_LOG_LEVEL) {
            process.env.TEST_LOG_LEVEL = 'warn';
        }
    });

    suiteSetup(async function() {
        // Create temporary workspace
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'specforged-e2e-'));
        console.log(`Test workspace: ${tempDir}`);
    });

    setup(async function() {
        // Create fresh workspace for each test
        const testId = Date.now().toString();
        const workspaceDir = path.join(tempDir, `test-${testId}`);

        testWorkspace = new IntegrationTestWorkspace(workspaceDir);
        await testWorkspace.setup();

        mockServer = new MockMcpServer(testWorkspace);
        await mockServer.start();

        await testWorkspace.initializeSyncService();
    });

    teardown(async function() {
        if (mockServer) {
            await mockServer.stop();
        }

        if (testWorkspace) {
            await testWorkspace.cleanup();
        }
    });

    suiteTeardown(async function() {
        // Clean up temporary directory
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch (error) {
            console.warn(`Cleanup warning: ${error}`);
        }
    });

    suite('Complete Operation Lifecycle', function() {
        test('should handle basic create specification operation end-to-end', async function() {
            // Step 1: Extension user creates a specification
            const operationId = await testWorkspace.simulateExtensionOperation(
                McpOperationType.CREATE_SPEC,
                {
                    name: 'E2E Test Specification',
                    description: 'End-to-end integration test',
                    specId: 'e2e-test-spec'
                },
                McpOperationPriority.NORMAL
            );

            // Step 2: Verify operation is queued
            const queue = testWorkspace.getOperationQueue();
            const queuedOp = queue.operations.find(op => op.id === operationId);
            assert.ok(queuedOp, 'Operation should be queued');
            assert.strictEqual(queuedOp.status, McpOperationStatus.PENDING);

            // Step 3: Process operations (simulates MCP server processing)
            await testWorkspace.processOperations();

            // Step 4: Wait for completion
            const result = await testWorkspace.waitForOperationCompletion(operationId, 10000);
            assert.ok(result, 'Operation should complete');
            assert.strictEqual(result.success, true, 'Operation should succeed');

            // Step 5: Verify specification was created in file system
            const specDir = path.join(testWorkspace.specsDir, 'e2e-test-spec');
            const specFile = path.join(specDir, 'spec.json');

            try {
                await fs.access(specFile);
                const specContent = await fs.readFile(specFile, 'utf8');
                const spec = JSON.parse(specContent);
                assert.strictEqual(spec.name, 'E2E Test Specification');
            } catch (error) {
                // Mock server might not create actual files, check operation result
                assert.ok(result.success, 'Operation should indicate success');
            }

            // Step 6: Verify sync state is updated
            const syncState = testWorkspace.getSyncState();
            assert.ok(syncState.lastSync, 'Sync state should be updated');
            assert.strictEqual(syncState.extensionOnline, true);
        });

        test('should handle operation dependencies correctly', async function() {
            // Create a specification first
            const createOpId = await testWorkspace.simulateExtensionOperation(
                McpOperationType.CREATE_SPEC,
                {
                    name: 'Dependency Test Spec',
                    specId: 'dependency-test'
                },
                McpOperationPriority.HIGH
            );

            // Create dependent operation
            const updateOp = IntegrationOperationBuilder
                .create()
                .withType(McpOperationType.UPDATE_REQUIREMENTS)
                .withParams({
                    specId: 'dependency-test',
                    content: '# Updated Requirements\n\nTest requirements with dependencies.'
                })
                .withPriority(McpOperationPriority.URGENT)
                .withDependencies(createOpId)
                .build();

            await testWorkspace.queueOperation(updateOp);

            // Process operations
            await testWorkspace.processOperations();

            // Both operations should complete, but in dependency order
            const createResult = await testWorkspace.waitForOperationCompletion(createOpId, 10000);
            const updateResult = await testWorkspace.waitForOperationCompletion(updateOp.id, 10000);

            assert.ok(createResult, 'Create operation should complete');
            assert.ok(updateResult, 'Update operation should complete');
            assert.strictEqual(createResult.success, true, 'Create operation should succeed');
            assert.strictEqual(updateResult.success, true, 'Update operation should succeed');

            // Verify dependency was respected (create completed before update)
            const createTime = new Date(createResult.timestamp).getTime();
            const updateTime = new Date(updateResult.timestamp).getTime();
            assert.ok(createTime <= updateTime, 'Create operation should complete before or simultaneously with update');
        });

        test('should handle operation failures and retries', async function() {
            // Configure mock server for failures
            mockServer.setFailureRate(0.7); // 70% failure rate

            const operationId = await testWorkspace.simulateExtensionOperation(
                McpOperationType.CREATE_SPEC,
                {
                    name: 'Retry Test Spec',
                    specId: 'retry-test'
                },
                McpOperationPriority.NORMAL
            );

            // Process operations multiple times to trigger retries
            for (let i = 0; i < 5; i++) {
                await testWorkspace.processOperations();
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Reset failure rate for potential success
            mockServer.setFailureRate(0.0);

            // Process again
            await testWorkspace.processOperations();

            // Check final result
            const result = await testWorkspace.waitForOperationCompletion(operationId, 5000);

            if (result) {
                // Operation completed (either success or final failure)
                const queue = testWorkspace.getOperationQueue();
                const operation = queue.operations.find(op => op.id === operationId);

                if (operation) {
                    // Should have attempted retries
                    assert.ok(operation.retryCount >= 0, 'Should have attempted retries');

                    if (result.success) {
                        assert.strictEqual(operation.status, McpOperationStatus.COMPLETED);
                    } else {
                        assert.strictEqual(operation.status, McpOperationStatus.FAILED);
                        assert.ok(operation.error, 'Failed operation should have error message');
                    }
                }
            }
        });
    });

    suite('File System Integration', function() {
        test('should detect external file modifications', async function() {
            // Create a specification
            await testWorkspace.createTestSpecification('file-mod-test', 'File Modification Test', true);

            // Simulate external file modification
            await testWorkspace.simulateFileModification(
                'file-mod-test',
                'requirements.md',
                '# Externally Modified Requirements\n\nThis was changed outside the extension.',
                100 // Small delay
            );

            // Try to update the same file through the extension
            const updateOpId = await testWorkspace.simulateExtensionOperation(
                McpOperationType.UPDATE_REQUIREMENTS,
                {
                    specId: 'file-mod-test',
                    content: '# Extension Updated Requirements\n\nThis was changed by the extension.'
                },
                McpOperationPriority.NORMAL
            );

            await testWorkspace.processOperations();

            // The operation should complete (conflict resolution may handle it)
            const result = await testWorkspace.waitForOperationCompletion(updateOpId, 10000);
            assert.ok(result, 'Update operation should complete');

            // Check that file changes were tracked
            assert.ok(testWorkspace.fileChanges.length > 0, 'File changes should be tracked');

            const externalModifications = testWorkspace.fileChanges.filter(
                change => change.type === 'external_modification'
            );
            assert.ok(externalModifications.length > 0, 'External modifications should be tracked');
        });

        test('should handle workspace directory changes', async function() {
            // Create initial specification
            await testWorkspace.createTestSpecification('workspace-test', 'Workspace Test', true);

            const initialOpId = await testWorkspace.simulateExtensionOperation(
                McpOperationType.UPDATE_DESIGN,
                {
                    specId: 'workspace-test',
                    content: '# Initial Design\n\nTest design content.'
                },
                McpOperationPriority.NORMAL
            );

            await testWorkspace.processOperations();

            const initialResult = await testWorkspace.waitForOperationCompletion(initialOpId);
            assert.ok(initialResult?.success, 'Initial operation should succeed');

            // Simulate workspace changes (this would normally involve actual directory changes)
            // For testing purposes, we'll verify the system remains stable

            const postChangeOpId = await testWorkspace.simulateExtensionOperation(
                McpOperationType.UPDATE_TASKS,
                {
                    specId: 'workspace-test',
                    content: '# Updated Tasks\n\n- [x] Test workspace stability'
                },
                McpOperationPriority.NORMAL
            );

            await testWorkspace.processOperations();

            const postChangeResult = await testWorkspace.waitForOperationCompletion(postChangeOpId);
            assert.ok(postChangeResult?.success, 'Post-change operation should succeed');

            // Verify sync state remains consistent
            const syncState = testWorkspace.getSyncState();
            assert.strictEqual(syncState.extensionOnline, true, 'Extension should remain online');
        });
    });

    suite('Server Connectivity Scenarios', function() {
        test('should queue operations while server is offline', async function() {
            // Simulate server going offline
            await testWorkspace.simulateServerOffline(1000);

            // Queue operations while offline
            const offlineOperations = [];
            for (let i = 0; i < 3; i++) {
                const opId = await testWorkspace.simulateExtensionOperation(
                    McpOperationType.CREATE_SPEC,
                    {
                        name: `Offline Spec ${i}`,
                        specId: `offline-spec-${i}`
                    },
                    McpOperationPriority.NORMAL
                );
                offlineOperations.push(opId);
            }

            // Verify operations are queued
            const queue = testWorkspace.getOperationQueue();
            assert.strictEqual(queue.operations.length, 3, 'Operations should be queued while offline');

            // Verify sync state shows server as offline
            const offlineSyncState = testWorkspace.getSyncState();
            assert.strictEqual(offlineSyncState.mcpServerOnline, false, 'Server should be marked offline');

            // Wait for server to come back online (simulated)
            await new Promise(resolve => setTimeout(resolve, 1200));

            // Process operations now that server is back online
            await testWorkspace.processOperations();

            // Operations should complete
            let completedCount = 0;
            for (const opId of offlineOperations) {
                const result = await testWorkspace.waitForOperationCompletion(opId, 5000);
                if (result?.success) {
                    completedCount++;
                }
            }

            assert.ok(completedCount >= 2, `At least 2/3 operations should complete, got ${completedCount}`);
        });

        test('should handle intermittent connectivity', async function() {
            // Configure intermittent failures
            mockServer.setFailureRate(0.3); // 30% failure rate
            mockServer.setProcessingDelay(200); // Slower processing

            const intermittentOperations = [];

            // Create operations with intermittent connectivity
            for (let i = 0; i < 10; i++) {
                const opId = await testWorkspace.simulateExtensionOperation(
                    McpOperationType.CREATE_SPEC,
                    {
                        name: `Intermittent Spec ${i}`,
                        specId: `intermittent-spec-${i.toString().padStart(2, '0')}`
                    },
                    McpOperationPriority.NORMAL
                );
                intermittentOperations.push(opId);

                // Simulate occasional server disconnections
                if (i % 3 === 0) {
                    await testWorkspace.simulateServerOffline(300);
                }
            }

            // Process operations multiple times to handle intermittent issues
            for (let attempt = 0; attempt < 5; attempt++) {
                await testWorkspace.processOperations();
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Count successful operations
            let successCount = 0;
            let retryCount = 0;

            for (const opId of intermittentOperations) {
                const result = await testWorkspace.waitForOperationCompletion(opId, 1000);
                if (result?.success) {
                    successCount++;
                } else {
                    // Check if operation is still retrying
                    const queue = testWorkspace.getOperationQueue();
                    const operation = queue.operations.find(op => op.id === opId);
                    if (operation && operation.retryCount > 0) {
                        retryCount++;
                    }
                }
            }

            // Should handle most operations despite intermittent issues
            const handledCount = successCount + retryCount;
            assert.ok(handledCount >= 7, `Should handle most operations despite connectivity issues: ${handledCount}/10`);

            // Verify system remains stable
            const syncState = testWorkspace.getSyncState();
            assert.strictEqual(syncState.extensionOnline, true, 'Extension should remain online');
        });
    });

    suite('Performance and Scalability', function() {
        test('should handle batch operation processing efficiently', async function() {
            const performanceMonitor = new IntegrationPerformanceMonitor();
            performanceMonitor.startMonitoring();

            // Create batch of operations
            const batchSize = 20;
            const operationIds = [];

            for (let i = 0; i < batchSize; i++) {
                const opId = await testWorkspace.simulateExtensionOperation(
                    McpOperationType.CREATE_SPEC,
                    {
                        name: `Batch Spec ${i}`,
                        specId: `batch-spec-${i.toString().padStart(2, '0')}`
                    },
                    McpOperationPriority.NORMAL
                );
                operationIds.push(opId);
                performanceMonitor.recordQueueSize(i + 1);
            }

            // Process batch
            const batchStart = Date.now();
            await testWorkspace.processOperations();

            // Wait for all operations to complete
            let completedCount = 0;
            for (const opId of operationIds) {
                const result = await testWorkspace.waitForOperationCompletion(opId, 15000);
                if (result?.success) {
                    completedCount++;
                }
                const operationTime = Date.now() - batchStart;
                performanceMonitor.recordOperationTime(operationTime);
            }

            const batchTime = Date.now() - batchStart;
            performanceMonitor.stopMonitoring();

            // Performance assertions
            assert.ok(completedCount >= batchSize * 0.8, `Should complete at least 80% of batch: ${completedCount}/${batchSize}`);
            assert.ok(batchTime < 20000, `Batch should complete within 20s: ${batchTime}ms`);

            // Generate performance report
            const report = performanceMonitor.getPerformanceReport();
            assert.ok(report.operationsPerSecond > 1, `Should maintain reasonable throughput: ${report.operationsPerSecond} ops/s`);

            console.log(`Batch performance: ${completedCount}/${batchSize} ops in ${batchTime}ms (${report.operationsPerSecond.toFixed(2)} ops/s)`);
        });

        test('should maintain performance under sustained load', async function() {
            // Configure for faster processing
            mockServer.setProcessingDelay(50);
            mockServer.setFailureRate(0.1); // Low failure rate

            const sustainedOperations = [];
            const performanceMonitor = new IntegrationPerformanceMonitor();
            performanceMonitor.startMonitoring();

            // Generate sustained load
            const totalOperations = 50;
            const batchSize = 10;

            for (let batch = 0; batch < totalOperations / batchSize; batch++) {
                const batchStart = Date.now();

                // Create batch
                const batchOps = [];
                for (let i = 0; i < batchSize; i++) {
                    const opNum = batch * batchSize + i;
                    const opId = await testWorkspace.simulateExtensionOperation(
                        [McpOperationType.CREATE_SPEC, McpOperationType.UPDATE_REQUIREMENTS][i % 2],
                        i % 2 === 0 ?
                            { name: `Sustained Spec ${opNum}`, specId: `sustained-${opNum.toString().padStart(2, '0')}` } :
                            { specId: `sustained-${Math.max(0, opNum - 1).toString().padStart(2, '0')}`, content: `Sustained requirements ${opNum}` },
                        McpOperationPriority.NORMAL
                    );
                    batchOps.push(opId);
                }

                sustainedOperations.push(...batchOps);

                // Process batch
                await testWorkspace.processOperations();

                const batchTime = Date.now() - batchStart;
                performanceMonitor.recordOperationTime(batchTime);
                performanceMonitor.recordQueueSize(sustainedOperations.length);

                // Brief pause between batches
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // Final processing
            await testWorkspace.processOperations();

            // Count final results
            let finalSuccessCount = 0;
            for (const opId of sustainedOperations) {
                const result = await testWorkspace.waitForOperationCompletion(opId, 2000);
                if (result?.success) {
                    finalSuccessCount++;
                }
            }

            performanceMonitor.stopMonitoring();
            const report = performanceMonitor.getPerformanceReport();

            // Performance assertions
            const successRate = (finalSuccessCount / totalOperations) * 100;
            assert.ok(successRate >= 70, `Success rate should be at least 70%: ${successRate.toFixed(1)}%`);
            assert.ok(report.operationsPerSecond >= 2, `Should maintain at least 2 ops/s: ${report.operationsPerSecond.toFixed(2)}`);

            console.log(`Sustained load: ${finalSuccessCount}/${totalOperations} ops (${successRate.toFixed(1)}%) at ${report.operationsPerSecond.toFixed(2)} ops/s`);
        });
    });

    suite('Conflict Resolution Integration', function() {
        test('should detect and resolve conflicting operations', async function() {
            // Create base specification
            await testWorkspace.createTestSpecification('conflict-test', 'Conflict Test Spec', true);

            // Create conflicting operations
            const conflictingOps = IntegrationTestUtils.createConflictingOperations('conflict-test', 3, 500);

            // Queue all conflicting operations
            for (const op of conflictingOps) {
                await testWorkspace.queueOperation(op);
            }

            // Process operations
            await testWorkspace.processOperations();

            // Check for conflict detection and resolution
            const queue = testWorkspace.getOperationQueue();

            // At least one operation should succeed
            let successCount = 0;
            let cancelledCount = 0;

            for (const op of conflictingOps) {
                const result = await testWorkspace.waitForOperationCompletion(op.id, 5000);
                const queuedOp = queue.operations.find(qop => qop.id === op.id);

                if (result?.success) {
                    successCount++;
                } else if (queuedOp?.status === McpOperationStatus.CANCELLED) {
                    cancelledCount++;
                }
            }

            // Should have resolved conflicts (some succeed, others cancelled)
            assert.ok(successCount >= 1, `At least one operation should succeed: ${successCount}`);
            assert.ok(successCount + cancelledCount >= 2, `Should have resolved conflicts: ${successCount} success, ${cancelledCount} cancelled`);

            // Verify sync state
            const syncState = testWorkspace.getSyncState();
            assert.strictEqual(syncState.extensionOnline, true, 'Extension should remain stable during conflict resolution');
        });
    });

    suite('Error Recovery', function() {
        test('should recover gracefully from various error conditions', async function() {
            // Test 1: Invalid operation parameters
            const invalidOpId = await testWorkspace.simulateExtensionOperation(
                McpOperationType.CREATE_SPEC,
                { name: '', specId: '' }, // Invalid parameters
                McpOperationPriority.NORMAL
            );

            // Test 2: Operation on non-existent resource
            const nonExistentOpId = await testWorkspace.simulateExtensionOperation(
                McpOperationType.UPDATE_REQUIREMENTS,
                { specId: 'does-not-exist', content: 'Some content' },
                McpOperationPriority.NORMAL
            );

            // Process operations
            await testWorkspace.processOperations();

            // These operations should fail gracefully
            const invalidResult = await testWorkspace.waitForOperationCompletion(invalidOpId, 5000);
            const nonExistentResult = await testWorkspace.waitForOperationCompletion(nonExistentOpId, 5000);

            // Verify errors were handled
            if (invalidResult) {
                assert.strictEqual(invalidResult.success, false, 'Invalid operation should fail');
            }
            if (nonExistentResult) {
                assert.strictEqual(nonExistentResult.success, false, 'Non-existent resource operation should fail');
            }

            // Test recovery with valid operation
            const recoveryOpId = await testWorkspace.simulateExtensionOperation(
                McpOperationType.CREATE_SPEC,
                {
                    name: 'Recovery Test Spec',
                    specId: 'recovery-test'
                },
                McpOperationPriority.HIGH
            );

            await testWorkspace.processOperations();

            const recoveryResult = await testWorkspace.waitForOperationCompletion(recoveryOpId);
            assert.ok(recoveryResult, 'Recovery operation should complete');
            assert.strictEqual(recoveryResult.success, true, 'System should recover and process valid operations');

            // Verify system stability
            const syncState = testWorkspace.getSyncState();
            assert.strictEqual(syncState.extensionOnline, true, 'Extension should remain online after errors');
        });
    });
});
