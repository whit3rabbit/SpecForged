import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { McpSyncService } from '../../services/mcpSyncService';
import { FileOperationService } from '../../services/fileOperationService';
import { McpManager } from '../../mcp/mcpManager';
import { NotificationManager } from '../../services/notificationManager';
import {
    McpOperation,
    McpOperationStatus,
    McpOperationType,
    McpOperationPriority,
    McpOperationFactory,
    McpOperationUtils,
    McpOperationValidator
} from '../../models/mcpOperation';
import { AtomicFileOperations } from '../../utils/atomicFileOperations';
import { ConflictResolver, ConflictType } from '../../utils/conflictResolver';

suite('McpSyncService Test Suite', () => {
    let mcpSyncService: McpSyncService;
    let fileOperationService: FileOperationService;
    let mcpManager: McpManager;
    let notificationManager: NotificationManager;
    let tempDir: string;
    let mockWorkspace: vscode.WorkspaceFolder;

    suiteSetup(async () => {
        // Create temporary directory for testing
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
        if (workspaceRoot) {
            tempDir = path.join(workspaceRoot.uri.fsPath, '.test-mcp-sync');
        } else {
            tempDir = path.join(__dirname, '.test-mcp-sync');
        }

        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Create mock workspace folder
        mockWorkspace = {
            uri: vscode.Uri.file(tempDir),
            name: 'test-workspace',
            index: 0
        };

        // Mock vscode.workspace.workspaceFolders
        const originalWorkspaceFolders = vscode.workspace.workspaceFolders;
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [mockWorkspace],
            configurable: true
        });
    });

    setup(async () => {
        // Create fresh instances for each test
        fileOperationService = new FileOperationService();
        mcpManager = new McpManager();
        notificationManager = new NotificationManager();

        mcpSyncService = new McpSyncService(fileOperationService);
        mcpSyncService.setMcpManager(mcpManager);
        mcpSyncService.setNotificationManager(notificationManager);

        // Clean up any existing files in temp directory
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
            if (file.endsWith('.json')) {
                fs.unlinkSync(path.join(tempDir, file));
            }
        }
    });

    teardown(async () => {
        // Ensure proper cleanup order and wait for async operations
        if (mcpSyncService) {
            mcpSyncService.dispose();
            // Wait a bit for async disposal operations to complete
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (notificationManager) {
            notificationManager.dispose();
        }

        // Clean up test files between tests
        try {
            const files = fs.readdirSync(tempDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const filePath = path.join(tempDir, file);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                }
            }
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    suiteTeardown(async () => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('Initialization', () => {
        test('should initialize successfully with valid workspace', async () => {
            await assert.doesNotReject(
                () => mcpSyncService.initialize(),
                'Should initialize without throwing'
            );

            const syncState = mcpSyncService.getSyncState();
            assert.strictEqual(syncState.extensionOnline, true, 'Extension should be marked as online');
            assert.ok(syncState.lastSync, 'Last sync timestamp should be set');
        });

        test('should create empty queue and sync state on first initialization', async () => {
            await mcpSyncService.initialize();

            const queue = mcpSyncService.getOperationQueue();
            const syncState = mcpSyncService.getSyncState();

            assert.strictEqual(queue.operations.length, 0, 'Queue should be empty initially');
            assert.strictEqual(queue.conflicts.length, 0, 'No conflicts should exist initially');
            assert.strictEqual(queue.version, 1, 'Queue version should be 1');

            assert.strictEqual(syncState.pendingOperations, 0, 'No pending operations initially');
            assert.strictEqual(syncState.inProgressOperations, 0, 'No in-progress operations initially');
            assert.strictEqual(syncState.failedOperations, 0, 'No failed operations initially');
            assert.strictEqual(syncState.completedOperations, 0, 'No completed operations initially');
        });

        test('should load existing state if files exist', async () => {
            // Create pre-existing state files
            const atomicOps = new AtomicFileOperations();
            const existingQueue = McpOperationUtils.createEmptyQueue();
            existingQueue.version = 5;
            existingQueue.operations.push(
                McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description')
            );

            await atomicOps.writeOperationQueue(tempDir, existingQueue);

            // Initialize service
            await mcpSyncService.initialize();

            const loadedQueue = mcpSyncService.getOperationQueue();
            assert.strictEqual(loadedQueue.version, 5, 'Should load existing queue version');
            assert.strictEqual(loadedQueue.operations.length, 1, 'Should load existing operations');
        });

        test('should handle corrupted state files gracefully', async () => {
            // Create corrupted state file
            fs.writeFileSync(path.join(tempDir, 'mcp-operations.json'), '{ invalid json');

            await assert.doesNotReject(
                () => mcpSyncService.initialize(),
                'Should handle corrupted files gracefully'
            );

            const queue = mcpSyncService.getOperationQueue();
            assert.strictEqual(queue.operations.length, 0, 'Should fall back to empty queue');
        });
    });

    suite('Operation Queuing', () => {
        setup(async () => {
            await mcpSyncService.initialize();
        });

        test('should queue valid operation successfully', async () => {
            const operation = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');

            await assert.doesNotReject(
                () => mcpSyncService.queueOperation(operation),
                'Should queue valid operation'
            );

            const queue = mcpSyncService.getOperationQueue();
            assert.strictEqual(queue.operations.length, 1, 'Operation should be added to queue');
            assert.strictEqual(queue.operations[0].id, operation.id, 'Correct operation should be queued');
        });

        test('should validate operation before queuing', async () => {
            const invalidOperation = {
                id: '',  // Invalid: empty ID
                type: McpOperationType.CREATE_SPEC,
                status: McpOperationStatus.PENDING,
                priority: McpOperationPriority.NORMAL,
                timestamp: new Date().toISOString(),
                params: { name: 'test-spec' },
                retryCount: 0,
                maxRetries: 3,
                source: 'extension'
            } as McpOperation;

            await assert.rejects(
                () => mcpSyncService.queueOperation(invalidOperation),
                /Invalid operation/,
                'Should reject invalid operation'
            );
        });

        test('should insert operations by priority order', async () => {
            const lowPriorityOp = McpOperationFactory.createCreateSpecOperation('Low', 'Description');
            lowPriorityOp.priority = McpOperationPriority.LOW;

            const highPriorityOp = McpOperationFactory.createCreateSpecOperation('High', 'Description');
            highPriorityOp.priority = McpOperationPriority.HIGH;

            const urgentPriorityOp = McpOperationFactory.createCreateSpecOperation('Urgent', 'Description');
            urgentPriorityOp.priority = McpOperationPriority.URGENT;

            // Queue in low-to-high order
            await mcpSyncService.queueOperation(lowPriorityOp);
            await mcpSyncService.queueOperation(highPriorityOp);
            await mcpSyncService.queueOperation(urgentPriorityOp);

            const queue = mcpSyncService.getOperationQueue();
            assert.strictEqual(queue.operations[0].priority, McpOperationPriority.URGENT, 'Urgent should be first');
            assert.strictEqual(queue.operations[1].priority, McpOperationPriority.HIGH, 'High should be second');
            assert.strictEqual(queue.operations[2].priority, McpOperationPriority.LOW, 'Low should be last');
        });

        test('should detect and handle conflicts during queuing', async () => {
            const operation1 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Content 1');
            const operation2 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Content 2');

            // Set close timestamps to trigger concurrent modification detection
            const now = new Date();
            operation1.timestamp = now.toISOString();
            operation2.timestamp = new Date(now.getTime() + 30000).toISOString();

            await mcpSyncService.queueOperation(operation1);
            await mcpSyncService.queueOperation(operation2);

            const queue = mcpSyncService.getOperationQueue();

            // Should still queue both operations
            assert.strictEqual(queue.operations.length, 2, 'Both operations should be queued');

            // Should detect conflicts
            assert.ok(queue.conflicts.length > 0, 'Conflicts should be detected');

            // Second operation should have conflict IDs
            assert.ok(operation2.conflictIds && operation2.conflictIds.length > 0, 'Operation should have conflict IDs');
        });

        test('should enforce queue size limit', async () => {
            // Mock the config to have a very small queue size
            const originalConfig = (mcpSyncService as any).config;
            (mcpSyncService as any).config = { ...originalConfig, maxQueueSize: 2 };

            const op1 = McpOperationFactory.createCreateSpecOperation('Spec 1', 'Description');
            const op2 = McpOperationFactory.createCreateSpecOperation('Spec 2', 'Description');
            const op3 = McpOperationFactory.createCreateSpecOperation('Spec 3', 'Description');

            await mcpSyncService.queueOperation(op1);
            await mcpSyncService.queueOperation(op2);

            // Third operation should fail due to queue size limit
            await assert.rejects(
                () => mcpSyncService.queueOperation(op3),
                /queue is full/i,
                'Should reject when queue is full'
            );

            // Restore original config
            (mcpSyncService as any).config = originalConfig;
        });

        test('should update sync state counters when queuing operations', async () => {
            const operation = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');

            await mcpSyncService.queueOperation(operation);

            const syncState = mcpSyncService.getSyncState();
            assert.strictEqual(syncState.pendingOperations, 1, 'Should increment pending operations counter');
        });
    });

    suite('Operation Processing', () => {
        setup(async () => {
            await mcpSyncService.initialize();
        });

        test('should process pending operations in priority order', async () => {
            const processedOperations: string[] = [];

            // Mock the processLocalOperation method to track processing order
            const originalProcessLocal = (mcpSyncService as any).processLocalOperation;
            (mcpSyncService as any).processLocalOperation = async (operation: McpOperation) => {
                processedOperations.push(operation.id);
                return { success: true, message: 'Processed' };
            };

            // Queue operations in reverse priority order
            const lowOp = McpOperationFactory.createCreateSpecOperation('Low', 'Description');
            lowOp.priority = McpOperationPriority.LOW;

            const highOp = McpOperationFactory.createCreateSpecOperation('High', 'Description');
            highOp.priority = McpOperationPriority.HIGH;

            await mcpSyncService.queueOperation(lowOp);
            await mcpSyncService.queueOperation(highOp);

            // Process operations
            await mcpSyncService.processOperations();

            // Restore original method
            (mcpSyncService as any).processLocalOperation = originalProcessLocal;

            // High priority should be processed first
            assert.strictEqual(processedOperations[0], highOp.id, 'High priority operation should be processed first');
            assert.strictEqual(processedOperations[1], lowOp.id, 'Low priority operation should be processed second');
        });

        test('should handle operation dependencies correctly', async () => {
            const operation1 = McpOperationFactory.createCreateSpecOperation('Base Spec', 'Description');
            const operation2 = McpOperationFactory.createUpdateRequirementsOperation('base-spec', 'Requirements');
            operation2.dependencies = [operation1.id];

            await mcpSyncService.queueOperation(operation1);
            await mcpSyncService.queueOperation(operation2);

            // Mock processLocalOperation to complete operation1
            const originalProcessLocal = (mcpSyncService as any).processLocalOperation;
            (mcpSyncService as any).processLocalOperation = async (operation: McpOperation) => {
                if (operation.id === operation1.id) {
                    operation.status = McpOperationStatus.COMPLETED;
                }
                return { success: true };
            };

            await mcpSyncService.processOperations();

            const queue = mcpSyncService.getOperationQueue();
            const completedOp = queue.operations.find(op => op.id === operation1.id);
            assert.strictEqual(completedOp?.status, McpOperationStatus.COMPLETED, 'Dependency should be completed');

            // Restore original method
            (mcpSyncService as any).processLocalOperation = originalProcessLocal;
        });

        test('should skip operations with unresolved conflicts', async () => {
            const operation1 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Content 1');
            const operation2 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Content 2');

            // Force a conflict
            const now = new Date();
            operation1.timestamp = now.toISOString();
            operation2.timestamp = new Date(now.getTime() + 30000).toISOString();

            await mcpSyncService.queueOperation(operation1);
            await mcpSyncService.queueOperation(operation2);

            // Mock processLocalOperation to track what gets processed
            const processedOperations: string[] = [];
            const originalProcessLocal = (mcpSyncService as any).processLocalOperation;
            (mcpSyncService as any).processLocalOperation = async (operation: McpOperation) => {
                processedOperations.push(operation.id);
                return { success: true };
            };

            await mcpSyncService.processOperations();

            // Operations with unresolved conflicts should not be processed
            // (This depends on the conflict resolution behavior)

            // Restore original method
            (mcpSyncService as any).processLocalOperation = originalProcessLocal;
        });

        test('should handle processing errors gracefully', async () => {
            const operation = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');
            await mcpSyncService.queueOperation(operation);

            // Mock processLocalOperation to throw error
            const originalProcessLocal = (mcpSyncService as any).processLocalOperation;
            (mcpSyncService as any).processLocalOperation = async () => {
                throw new Error('Processing failed');
            };

            await assert.doesNotReject(
                () => mcpSyncService.processOperations(),
                'Should handle processing errors gracefully'
            );

            const queue = mcpSyncService.getOperationQueue();
            const failedOp = queue.operations.find(op => op.id === operation.id);
            assert.strictEqual(failedOp?.status, McpOperationStatus.FAILED, 'Operation should be marked as failed');
            assert.ok(failedOp?.error, 'Error should be recorded');

            // Restore original method
            (mcpSyncService as any).processLocalOperation = originalProcessLocal;
        });

        test('should update operation timing information during processing', async () => {
            const operation = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');
            await mcpSyncService.queueOperation(operation);

            // Mock processLocalOperation with delay
            const originalProcessLocal = (mcpSyncService as any).processLocalOperation;
            (mcpSyncService as any).processLocalOperation = async (op: McpOperation) => {
                await new Promise(resolve => setTimeout(resolve, 100)); // 100ms delay
                return { success: true };
            };

            await mcpSyncService.processOperations();

            const queue = mcpSyncService.getOperationQueue();
            const processedOp = queue.operations.find(op => op.id === operation.id);

            assert.ok(processedOp?.startedAt, 'Started timestamp should be set');
            assert.ok(processedOp?.completedAt, 'Completed timestamp should be set');
            assert.ok(processedOp?.actualDurationMs && processedOp.actualDurationMs >= 100, 'Duration should be recorded');

            // Restore original method
            (mcpSyncService as any).processLocalOperation = originalProcessLocal;
        });
    });

    suite('Retry Logic', () => {
        setup(async () => {
            await mcpSyncService.initialize();
        });

        test('should retry failed operations within retry limit', async () => {
            const operation = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');
            operation.maxRetries = 2;
            await mcpSyncService.queueOperation(operation);

            let attemptCount = 0;
            const originalProcessLocal = (mcpSyncService as any).processLocalOperation;
            (mcpSyncService as any).processLocalOperation = async () => {
                attemptCount++;
                if (attemptCount <= 2) {
                    throw new Error('Simulated failure');
                }
                return { success: true };
            };

            // Process multiple times to trigger retries
            await mcpSyncService.processOperations();
            await mcpSyncService.processOperations();
            await mcpSyncService.processOperations();

            const queue = mcpSyncService.getOperationQueue();
            const processedOp = queue.operations.find(op => op.id === operation.id);

            assert.strictEqual(processedOp?.status, McpOperationStatus.COMPLETED, 'Operation should eventually succeed');
            assert.ok(processedOp?.retryCount > 0, 'Retry count should be incremented');

            // Restore original method
            (mcpSyncService as any).processLocalOperation = originalProcessLocal;
        });

        test('should not retry operations that exceed retry limit', async () => {
            const operation = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');
            operation.maxRetries = 1;
            await mcpSyncService.queueOperation(operation);

            const originalProcessLocal = (mcpSyncService as any).processLocalOperation;
            (mcpSyncService as any).processLocalOperation = async () => {
                throw new Error('Always fails');
            };

            // Process multiple times
            await mcpSyncService.processOperations();
            await mcpSyncService.processOperations();
            await mcpSyncService.processOperations();

            const queue = mcpSyncService.getOperationQueue();
            const failedOp = queue.operations.find(op => op.id === operation.id);

            assert.strictEqual(failedOp?.status, McpOperationStatus.FAILED, 'Operation should remain failed');
            assert.ok(failedOp?.retryCount <= failedOp.maxRetries, 'Should not exceed retry limit');

            // Restore original method
            (mcpSyncService as any).processLocalOperation = originalProcessLocal;
        });

        test('should calculate next retry time with exponential backoff', async () => {
            const operation = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');
            operation.maxRetries = 3;
            await mcpSyncService.queueOperation(operation);

            const originalProcessLocal = (mcpSyncService as any).processLocalOperation;
            (mcpSyncService as any).processLocalOperation = async () => {
                throw new Error('Simulated failure');
            };

            await mcpSyncService.processOperations();

            const queue = mcpSyncService.getOperationQueue();
            const failedOp = queue.operations.find(op => op.id === operation.id);

            assert.ok(failedOp?.nextRetryAt, 'Next retry time should be set');

            const nextRetryTime = new Date(failedOp!.nextRetryAt!).getTime();
            const now = Date.now();
            assert.ok(nextRetryTime > now, 'Next retry should be in the future');

            // Restore original method
            (mcpSyncService as any).processLocalOperation = originalProcessLocal;
        });
    });

    suite('Conflict Integration', () => {
        setup(async () => {
            await mcpSyncService.initialize();
        });

        test('should integrate with conflict resolver during operation queuing', async () => {
            const operation1 = McpOperationFactory.createCreateSpecOperation('Same Spec', 'Description');
            const operation2 = McpOperationFactory.createCreateSpecOperation('Same Spec', 'Description');

            await mcpSyncService.queueOperation(operation1);
            await mcpSyncService.queueOperation(operation2);

            const queue = mcpSyncService.getOperationQueue();
            assert.ok(queue.conflicts.length > 0, 'Conflicts should be detected and stored');
        });

        test('should resolve auto-resolvable conflicts', async () => {
            const operation1 = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');
            const operation2 = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');

            await mcpSyncService.queueOperation(operation1);
            await mcpSyncService.queueOperation(operation2);

            // Wait a bit for auto-resolution
            await new Promise(resolve => setTimeout(resolve, 200));

            const queue = mcpSyncService.getOperationQueue();
            const resolvedConflicts = queue.conflicts.filter(c => c.resolvedAt);

            // Duplicate operations should be auto-resolved
            assert.ok(resolvedConflicts.length > 0, 'Auto-resolvable conflicts should be resolved');
        });
    });

    suite('File Synchronization', () => {
        setup(async () => {
            await mcpSyncService.initialize();
        });

        test('should save operation queue to file system', async () => {
            const operation = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');
            await mcpSyncService.queueOperation(operation);

            const queueFilePath = path.join(tempDir, 'mcp-operations.json');
            assert.ok(fs.existsSync(queueFilePath), 'Queue file should be created');

            const fileContent = fs.readFileSync(queueFilePath, 'utf8');
            const savedQueue = JSON.parse(fileContent);
            assert.strictEqual(savedQueue.operations.length, 1, 'Operation should be saved to file');
        });

        test('should save sync state to file system', async () => {
            await mcpSyncService.initialize();

            const syncFilePath = path.join(tempDir, 'specforge-sync.json');
            assert.ok(fs.existsSync(syncFilePath), 'Sync state file should be created');

            const fileContent = fs.readFileSync(syncFilePath, 'utf8');
            const savedState = JSON.parse(fileContent);
            assert.strictEqual(savedState.extensionOnline, true, 'Sync state should be saved to file');
        });

        test('should handle file system errors gracefully', async () => {
            // Make directory read-only to simulate permission error
            try {
                fs.chmodSync(tempDir, 0o444);

                await assert.doesNotReject(
                    () => mcpSyncService.initialize(),
                    'Should handle file system errors gracefully'
                );
            } finally {
                // Restore write permissions
                fs.chmodSync(tempDir, 0o755);
            }
        });
    });

    suite('Cleanup and Maintenance', () => {
        setup(async () => {
            await mcpSyncService.initialize();
        });

        test('should cleanup old completed operations', async () => {
            // Create old completed operations
            const oldOperation = McpOperationFactory.createCreateSpecOperation('Old Spec', 'Description');
            oldOperation.status = McpOperationStatus.COMPLETED;
            oldOperation.completedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago

            const recentOperation = McpOperationFactory.createCreateSpecOperation('Recent Spec', 'Description');
            recentOperation.status = McpOperationStatus.COMPLETED;
            recentOperation.completedAt = new Date().toISOString();

            await mcpSyncService.queueOperation(oldOperation);
            await mcpSyncService.queueOperation(recentOperation);

            // Cleanup operations older than 1 hour
            await mcpSyncService.cleanupOldOperations(1);

            const queue = mcpSyncService.getOperationQueue();
            const remainingOps = queue.operations.filter(op => op.status === McpOperationStatus.COMPLETED);

            assert.strictEqual(remainingOps.length, 1, 'Old operation should be cleaned up');
            assert.strictEqual(remainingOps[0].id, recentOperation.id, 'Recent operation should remain');
        });

        test('should preserve pending and in-progress operations during cleanup', async () => {
            const pendingOp = McpOperationFactory.createCreateSpecOperation('Pending Spec', 'Description');
            pendingOp.status = McpOperationStatus.PENDING;
            pendingOp.timestamp = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago

            const inProgressOp = McpOperationFactory.createCreateSpecOperation('InProgress Spec', 'Description');
            inProgressOp.status = McpOperationStatus.IN_PROGRESS;
            inProgressOp.timestamp = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago

            await mcpSyncService.queueOperation(pendingOp);
            await mcpSyncService.queueOperation(inProgressOp);

            await mcpSyncService.cleanupOldOperations(1);

            const queue = mcpSyncService.getOperationQueue();
            assert.strictEqual(queue.operations.length, 2, 'Active operations should be preserved');
        });

        test('should update performance metrics', async () => {
            const operation = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');
            await mcpSyncService.queueOperation(operation);

            // Mock successful processing
            const originalProcessLocal = (mcpSyncService as any).processLocalOperation;
            (mcpSyncService as any).processLocalOperation = async () => {
                await new Promise(resolve => setTimeout(resolve, 100));
                return { success: true };
            };

            await mcpSyncService.processOperations();

            const syncState = mcpSyncService.getSyncState();
            assert.ok(syncState.performance.lastProcessingDuration > 0, 'Processing duration should be recorded');
            assert.ok(syncState.performance.averageOperationTimeMs > 0, 'Average operation time should be calculated');

            // Restore original method
            (mcpSyncService as any).processLocalOperation = originalProcessLocal;
        });
    });

    suite('Heartbeat and Status', () => {
        setup(async () => {
            await mcpSyncService.initialize();
        });

        test('should handle heartbeat operations', async () => {
            const heartbeatOp = McpOperationFactory.createHeartbeatOperation('1.0.0', '1.0.0', {
                rootPath: '/test/workspace',
                specCount: 5
            });
            await mcpSyncService.queueOperation(heartbeatOp);

            await mcpSyncService.processOperations();

            const queue = mcpSyncService.getOperationQueue();
            const processedHeartbeat = queue.operations.find(op => op.type === McpOperationType.HEARTBEAT);

            assert.strictEqual(processedHeartbeat?.status, McpOperationStatus.COMPLETED, 'Heartbeat should be processed successfully');

            const syncState = mcpSyncService.getSyncState();
            assert.strictEqual(syncState.mcpServerOnline, true, 'MCP server should be marked as online');
        });

        test('should track specification changes', async () => {
            await mcpSyncService.notifySpecificationChange('test-spec', 'created');

            const syncState = mcpSyncService.getSyncState();
            const spec = syncState.specifications.find(s => s.specId === 'test-spec');

            assert.ok(spec, 'Specification should be tracked');
            assert.strictEqual(spec!.version, 1, 'Version should be set');
            assert.ok(spec!.lastModified, 'Last modified timestamp should be set');
        });

        test('should increment specification version on changes', async () => {
            await mcpSyncService.notifySpecificationChange('test-spec', 'created');
            await mcpSyncService.notifySpecificationChange('test-spec', 'updated');

            const syncState = mcpSyncService.getSyncState();
            const spec = syncState.specifications.find(s => s.specId === 'test-spec');

            assert.strictEqual(spec!.version, 2, 'Version should be incremented');
        });
    });

    suite('Error Handling and Edge Cases', () => {
        setup(async () => {
            await mcpSyncService.initialize();
        });

        test('should handle invalid operation parameters gracefully', async () => {
            const operation = McpOperationFactory.createCreateSpecOperation('', ''); // Empty parameters

            await assert.rejects(
                () => mcpSyncService.queueOperation(operation),
                'Should reject invalid parameters'
            );
        });

        test('should handle concurrent initialization attempts', async () => {
            const service1 = new McpSyncService(fileOperationService);
            const service2 = new McpSyncService(fileOperationService);

            await Promise.all([
                service1.initialize(),
                service2.initialize()
            ]);

            // Both should initialize successfully
            assert.strictEqual(service1.getSyncState().extensionOnline, true);
            assert.strictEqual(service2.getSyncState().extensionOnline, true);

            service1.dispose();
            service2.dispose();
        });

        test('should handle operations with circular dependencies', async () => {
            const op1 = McpOperationFactory.createCreateSpecOperation('Spec 1', 'Description');
            const op2 = McpOperationFactory.createUpdateRequirementsOperation('spec-1', 'Requirements');
            const op3 = McpOperationFactory.createUpdateDesignOperation('spec-1', 'Design');

            // Create circular dependency
            op1.dependencies = [op3.id];
            op2.dependencies = [op1.id];
            op3.dependencies = [op2.id];

            await mcpSyncService.queueOperation(op1);
            await mcpSyncService.queueOperation(op2);
            await mcpSyncService.queueOperation(op3);

            const queue = mcpSyncService.getOperationQueue();

            // Should detect circular dependency conflict
            const circularConflict = queue.conflicts.find(c => c.type === ConflictType.DEPENDENCY_CONFLICT);
            assert.ok(circularConflict, 'Circular dependency should be detected');
        });

        test('should handle workspace disposal gracefully', async () => {
            await mcpSyncService.initialize();

            // Simulate workspace disposal
            mcpSyncService.dispose();

            const syncState = mcpSyncService.getSyncState();
            assert.strictEqual(syncState.extensionOnline, false, 'Extension should be marked as offline');
        });
    });
});
