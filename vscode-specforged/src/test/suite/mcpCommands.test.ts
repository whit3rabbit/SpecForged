import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { McpApiHandler } from '../../commands/mcpCommands';
import { FileOperationService, FileOperationResult } from '../../services/fileOperationService';
import { McpSyncService } from '../../services/mcpSyncService';
import { ConflictResolver, ConflictResolution } from '../../utils/conflictResolver';
import {
    McpOperation,
    McpOperationStatus,
    McpOperationType,
    McpOperationPriority,
    McpOperationFactory
} from '../../models/mcpOperation';

suite('McpCommands Test Suite', () => {
    let commandHandler: McpApiHandler;
    let fileOperationService: FileOperationService;
    let mcpSyncService: McpSyncService;
    let conflictResolver: ConflictResolver;
    let tempDir: string;
    let mockContext: vscode.ExtensionContext;
    let registeredCommands: Map<string, (...args: any[]) => any>;

    suiteSetup(async () => {
        // Create temporary directory for testing
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
        if (workspaceRoot) {
            tempDir = path.join(workspaceRoot.uri.fsPath, '.test-mcp-commands');
        } else {
            tempDir = path.join(__dirname, '.test-mcp-commands');
        }

        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        // Mock vscode.workspace.workspaceFolders
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [{ uri: vscode.Uri.file(tempDir), name: 'test-workspace', index: 0 }],
            configurable: true
        });

        // Mock extension context
        registeredCommands = new Map();
        mockContext = {
            subscriptions: [],
            workspaceState: {
                get: () => undefined,
                update: () => Promise.resolve(),
                keys: () => []
            },
            globalState: {
                get: () => undefined,
                update: () => Promise.resolve(),
                setKeysForSync: () => {},
                keys: () => []
            },
            extensionPath: tempDir,
            storagePath: path.join(tempDir, 'storage'),
            globalStoragePath: path.join(tempDir, 'global-storage'),
            logPath: path.join(tempDir, 'log'),
            extensionUri: vscode.Uri.file(tempDir),
            extensionMode: vscode.ExtensionMode.Test,
            environmentVariableCollection: {} as any,
            asAbsolutePath: (relativePath: string) => path.join(tempDir, relativePath),
            storageUri: vscode.Uri.file(path.join(tempDir, 'storage')),
            globalStorageUri: vscode.Uri.file(path.join(tempDir, 'globalStorage')),
            logUri: vscode.Uri.file(path.join(tempDir, 'logs')),
            secrets: {} as any,
            extension: {} as any,
            languageModelAccessInformation: {} as any
        } as vscode.ExtensionContext;

        // Mock vscode.commands.registerCommand
        const originalRegisterCommand = vscode.commands.registerCommand;
        vscode.commands.registerCommand = ((command: string, callback: (...args: any[]) => any) => {
            registeredCommands.set(command, callback);
            const disposable = { dispose: () => registeredCommands.delete(command) };
            return disposable;
        }) as any;
    });

    setup(async () => {
        // Set test environment flag
        process.env.NODE_ENV = 'test';

        // Create fresh instances for each test
        fileOperationService = new FileOperationService();
        mcpSyncService = new McpSyncService(fileOperationService);
        conflictResolver = new ConflictResolver();

        commandHandler = new McpApiHandler(fileOperationService, mcpSyncService, conflictResolver);

        // Initialize services
        await mcpSyncService.initialize();

        // Register commands
        commandHandler.setupMcpCommands(mockContext);

        // Clean up any existing files in temp directory
        const files = fs.readdirSync(tempDir);
        for (const file of files) {
            if (file.endsWith('.json') || file.endsWith('.md')) {
                fs.unlinkSync(path.join(tempDir, file));
            }
        }
    });

    teardown(async () => {
        if (mcpSyncService) {
            mcpSyncService.dispose();
        }
        if (conflictResolver) {
            conflictResolver.dispose();
        }
        registeredCommands.clear();
    });

    suiteTeardown(async () => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('Command Registration', () => {
        test('should register all MCP commands', () => {
            const expectedCommands = [
                'specforged.mcp.createSpec',
                'specforged.mcp.updateRequirements',
                'specforged.mcp.updateDesign',
                'specforged.mcp.updateTasks',
                'specforged.mcp.deleteSpec',
                'specforged.mcp.updateTaskStatus',
                'specforged.mcp.addUserStory',
                'specforged.mcp.createFile',
                'specforged.mcp.readFile',
                'specforged.mcp.writeFile',
                'specforged.mcp.deleteFile',
                'specforged.mcp.createDirectory',
                'specforged.mcp.getSyncStatus',
                'specforged.mcp.forceSync',
                'specforged.mcp.listSpecifications',
                'specforged.mcp.getConflicts',
                'specforged.mcp.resolveConflict',
                'specforged.mcp.queueOperation',
                'specforged.mcp.getOperationQueue'
            ];

            for (const command of expectedCommands) {
                assert.ok(registeredCommands.has(command), `Command ${command} should be registered`);
            }
        });

        test('should handle command registration errors gracefully', () => {
            // Mock registerCommand to throw error
            const originalRegisterCommand = vscode.commands.registerCommand;
            vscode.commands.registerCommand = (() => {
                throw new Error('Registration failed');
            }) as any;

            try {
                assert.doesNotThrow(() => {
                    const newHandler = new McpApiHandler(fileOperationService, mcpSyncService, conflictResolver);
                    newHandler.setupMcpCommands(mockContext);
                }, 'Should handle registration errors gracefully');
            } finally {
                vscode.commands.registerCommand = originalRegisterCommand;
            }
        });
    });

    suite('Specification Operations', () => {
        test('should handle createSpec command', async () => {
            const createSpecCommand = registeredCommands.get('specforged.mcp.createSpec')!;

            const result = await createSpecCommand({
                specId: 'test-spec',
                name: 'Test Specification',
                description: 'A test specification'
            });

            assert.ok(result.success, 'Create spec should succeed');
            assert.strictEqual(result.data.specId, 'test-spec', 'Should return correct spec ID');

            // Verify operation was queued
            const queue = mcpSyncService.getOperationQueue();
            const createOp = queue.operations.find(op => op.type === McpOperationType.CREATE_SPEC);
            assert.ok(createOp, 'Create spec operation should be queued');
        });

        test('should validate createSpec parameters', async () => {
            const createSpecCommand = registeredCommands.get('specforged.mcp.createSpec')!;

            // Test missing parameters
            const result1 = await createSpecCommand({});
            assert.strictEqual(result1.success, false, 'Should reject missing parameters');
            assert.ok(result1.message.toLowerCase().includes('required'), 'Should indicate missing parameters');

            // Test invalid parameters
            const result2 = await createSpecCommand({ specId: '', name: 'Test' });
            assert.strictEqual(result2.success, false, 'Should reject invalid parameters');
            assert.ok(result2.message.toLowerCase().includes('invalid') || result2.message.toLowerCase().includes('required'), 'Should indicate validation error');
        });

        test('should handle updateRequirements command', async () => {
            const updateRequirementsCommand = registeredCommands.get('specforged.mcp.updateRequirements')!;

            const result = await updateRequirementsCommand({
                specId: 'test-spec',
                content: '# Requirements\n\n- REQ-001: User should be able to login'
            });

            assert.ok(result.success, 'Update requirements should succeed');

            // Verify operation was queued
            const queue = mcpSyncService.getOperationQueue();
            const updateOp = queue.operations.find(op => op.type === McpOperationType.UPDATE_REQUIREMENTS);
            assert.ok(updateOp, 'Update requirements operation should be queued');
        });

        test('should handle updateDesign command', async () => {
            const updateDesignCommand = registeredCommands.get('specforged.mcp.updateDesign')!;

            const result = await updateDesignCommand({
                specId: 'test-spec',
                content: '# Design\n\n## Architecture\n\nMicroservices architecture'
            });

            assert.ok(result.success, 'Update design should succeed');

            const queue = mcpSyncService.getOperationQueue();
            const updateOp = queue.operations.find(op => op.type === McpOperationType.UPDATE_DESIGN);
            assert.ok(updateOp, 'Update design operation should be queued');
        });

        test('should handle updateTasks command', async () => {
            const updateTasksCommand = registeredCommands.get('specforged.mcp.updateTasks')!;

            const result = await updateTasksCommand({
                specId: 'test-spec',
                content: '# Tasks\n\n- [ ] Task 1\n- [x] Task 2'
            });

            assert.ok(result.success, 'Update tasks should succeed');

            const queue = mcpSyncService.getOperationQueue();
            const updateOp = queue.operations.find(op => op.type === McpOperationType.UPDATE_TASKS);
            assert.ok(updateOp, 'Update tasks operation should be queued');
        });

        test('should handle deleteSpec command', async () => {
            const deleteSpecCommand = registeredCommands.get('specforged.mcp.deleteSpec')!;

            const result = await deleteSpecCommand({
                specId: 'test-spec'
            });

            assert.ok(result.success, 'Delete spec should succeed');

            const queue = mcpSyncService.getOperationQueue();
            const deleteOp = queue.operations.find(op => op.type === McpOperationType.DELETE_SPEC);
            assert.ok(deleteOp, 'Delete spec operation should be queued');
        });

        test('should handle operation priority settings', async () => {
            const createSpecCommand = registeredCommands.get('specforged.mcp.createSpec')!;

            const result = await createSpecCommand({
                specId: 'urgent-spec',
                name: 'Urgent Specification',
                description: 'An urgent specification',
                priority: 'urgent'
            });

            assert.ok(result.success, 'High priority create spec should succeed');

            const queue = mcpSyncService.getOperationQueue();
            const createOp = queue.operations.find(op => op.type === McpOperationType.CREATE_SPEC && 'specId' in op.params && op.params.specId === 'urgent-spec');
            assert.strictEqual(createOp?.priority, McpOperationPriority.URGENT, 'Should set urgent priority');
        });
    });

    suite('Task Operations', () => {
        test('should handle updateTaskStatus command', async () => {
            const updateTaskStatusCommand = registeredCommands.get('specforged.mcp.updateTaskStatus')!;

            const result = await updateTaskStatusCommand({
                specId: 'test-spec',
                taskId: 'task-1',
                status: 'completed'
            });

            assert.ok(result.success, 'Update task status should succeed');

            const queue = mcpSyncService.getOperationQueue();
            const updateOp = queue.operations.find(op => op.type === McpOperationType.UPDATE_TASK_STATUS);
            assert.ok(updateOp, 'Update task status operation should be queued');
        });

        test('should validate task status values', async () => {
            const updateTaskStatusCommand = registeredCommands.get('specforged.mcp.updateTaskStatus')!;

            // Valid status values
            const validStatuses = ['pending', 'in_progress', 'completed', 'failed', 'cancelled'];

            for (const status of validStatuses) {
                const result = await updateTaskStatusCommand({
                    specId: 'test-spec',
                    taskId: 'task-1',
                    status
                });
                assert.ok(result.success, `Should accept valid status: ${status}`);
            }

            // Invalid status
            await assert.rejects(
                () => updateTaskStatusCommand({
                    specId: 'test-spec',
                    taskId: 'task-1',
                    status: 'invalid-status'
                }),
                /invalid.*status/i,
                'Should reject invalid status'
            );
        });

        test('should handle addUserStory command', async () => {
            const addUserStoryCommand = registeredCommands.get('specforged.mcp.addUserStory')!;

            const result = await addUserStoryCommand({
                specId: 'test-spec',
                userStory: {
                    title: 'User Login',
                    asA: 'registered user',
                    iWant: 'to login to the system',
                    soThat: 'I can access my account'
                }
            });

            assert.ok(result.success, 'Add user story should succeed');

            const queue = mcpSyncService.getOperationQueue();
            const addOp = queue.operations.find(op => op.type === McpOperationType.ADD_USER_STORY);
            assert.ok(addOp, 'Add user story operation should be queued');
        });

        test('should validate user story format', async () => {
            const addUserStoryCommand = registeredCommands.get('specforged.mcp.addUserStory')!;

            // Missing required fields
            const result = await addUserStoryCommand({
                specId: 'test-spec',
                userStory: {
                    title: 'Incomplete Story'
                    // Missing asA, iWant, soThat
                }
            });
            assert.strictEqual(result.success, false, 'Should reject incomplete user story');
            assert.ok(result.message.toLowerCase().includes('required') || result.message.toLowerCase().includes('invalid'), 'Should indicate missing fields');
        });
    });

    suite('File Operations', () => {
        test('should handle createFile command', async () => {
            const createFileCommand = registeredCommands.get('specforged.mcp.createFile')!;

            const result = await createFileCommand({
                filePath: 'test-file.md',
                content: '# Test File\n\nThis is a test file.'
            });

            assert.ok(result.success, 'Create file should succeed');
            assert.ok(fs.existsSync(path.join(tempDir, 'test-file.md')), 'File should be created');
        });

        test('should handle readFile command', async () => {
            // First create a file
            const testFilePath = path.join(tempDir, 'read-test.md');
            const testContent = '# Read Test\n\nContent for reading.';
            fs.writeFileSync(testFilePath, testContent);

            const readFileCommand = registeredCommands.get('specforged.mcp.readFile')!;

            const result = await readFileCommand({
                filePath: 'read-test.md'
            });

            assert.ok(result.success, 'Read file should succeed');
            assert.strictEqual(result.data.content, testContent, 'Should return file content');
        });

        test('should handle writeFile command', async () => {
            const writeFileCommand = registeredCommands.get('specforged.mcp.writeFile')!;

            const result = await writeFileCommand({
                filePath: 'write-test.md',
                content: '# Write Test\n\nUpdated content.'
            });

            assert.ok(result.success, 'Write file should succeed');

            const writtenContent = fs.readFileSync(path.join(tempDir, 'write-test.md'), 'utf8');
            assert.strictEqual(writtenContent, '# Write Test\n\nUpdated content.', 'File should have updated content');
        });

        test('should handle deleteFile command', async () => {
            // First create a file
            const testFilePath = path.join(tempDir, 'delete-test.md');
            fs.writeFileSync(testFilePath, 'Content to delete');

            const deleteFileCommand = registeredCommands.get('specforged.mcp.deleteFile')!;

            const result = await deleteFileCommand({
                filePath: 'delete-test.md'
            });

            assert.ok(result.success, 'Delete file should succeed');
            assert.ok(!fs.existsSync(testFilePath), 'File should be deleted');
        });

        test('should handle createDirectory command', async () => {
            const createDirectoryCommand = registeredCommands.get('specforged.mcp.createDirectory')!;

            const result = await createDirectoryCommand({
                dirPath: 'test-directory'
            });

            assert.ok(result.success, 'Create directory should succeed');
            assert.ok(fs.existsSync(path.join(tempDir, 'test-directory')), 'Directory should be created');
        });

        test('should handle file operation errors gracefully', async () => {
            const readFileCommand = registeredCommands.get('specforged.mcp.readFile')!;

            const result = await readFileCommand({
                filePath: 'nonexistent-file.md'
            });

            assert.strictEqual(result.success, false, 'Should fail for nonexistent file');
            assert.ok(result.error, 'Should provide error message');
        });

        test('should validate file paths for security', async () => {
            const createFileCommand = registeredCommands.get('specforged.mcp.createFile')!;

            // Test path traversal attempt
            const result = await createFileCommand({
                filePath: '../../../sensitive-file.txt',
                content: 'Malicious content'
            });

            assert.strictEqual(result.success, false, 'Should reject path traversal attempts');
            assert.ok(result.error?.includes('invalid') || result.error?.includes('path'), 'Should indicate path validation error');
        });
    });

    suite('Sync Operations', () => {
        test('should handle getSyncStatus command', async () => {
            const getSyncStatusCommand = registeredCommands.get('specforged.mcp.getSyncStatus')!;

            const result = await getSyncStatusCommand();

            assert.ok(result.success, 'Get sync status should succeed');
            assert.ok(result.data.syncState, 'Should return sync state');
            assert.ok(typeof result.data.syncState.extensionOnline === 'boolean', 'Should include extension online status');
        });

        test('should handle forceSync command', async () => {
            const forceSyncCommand = registeredCommands.get('specforged.mcp.forceSync')!;

            const result = await forceSyncCommand();

            assert.ok(result.success, 'Force sync should succeed');
            assert.ok(result.data.operationsProcessed >= 0, 'Should report operations processed');
        });

        test('should handle listSpecifications command', async () => {
            const listSpecificationsCommand = registeredCommands.get('specforged.mcp.listSpecifications')!;

            const result = await listSpecificationsCommand();

            assert.ok(result.success, 'List specifications should succeed');
            assert.ok(Array.isArray(result.data.specifications), 'Should return specifications array');
        });

        test('should include sync performance metrics', async () => {
            // First perform some operations to generate metrics
            const createSpecCommand = registeredCommands.get('specforged.mcp.createSpec')!;
            await createSpecCommand({
                specId: 'perf-test-spec',
                name: 'Performance Test',
                description: 'For testing performance metrics'
            });

            const getSyncStatusCommand = registeredCommands.get('specforged.mcp.getSyncStatus')!;
            const result = await getSyncStatusCommand();

            assert.ok(result.data.syncState.performance, 'Should include performance metrics');
        });
    });

    suite('Conflict Operations', () => {
        test('should handle getConflicts command', async () => {
            // Create operations that will generate conflicts
            const createSpec1 = McpOperationFactory.createCreateSpecOperation('Conflict Test', 'Description');
            const createSpec2 = McpOperationFactory.createCreateSpecOperation('Conflict Test', 'Description');

            await mcpSyncService.queueOperation(createSpec1);
            await mcpSyncService.queueOperation(createSpec2);

            const getConflictsCommand = registeredCommands.get('specforged.mcp.getConflicts')!;
            const result = await getConflictsCommand();

            assert.ok(result.success, 'Get conflicts should succeed');
            assert.ok(Array.isArray(result.data.conflicts), 'Should return conflicts array');
        });

        test('should handle resolveConflict command', async () => {
            // Create operations that will generate conflicts
            const createSpec1 = McpOperationFactory.createCreateSpecOperation('Resolve Test', 'Description');
            const createSpec2 = McpOperationFactory.createCreateSpecOperation('Resolve Test', 'Description');

            await mcpSyncService.queueOperation(createSpec1);
            await mcpSyncService.queueOperation(createSpec2);

            // Get conflicts
            const conflicts = conflictResolver.getActiveConflicts();
            if (conflicts.length > 0) {
                const resolveConflictCommand = registeredCommands.get('specforged.mcp.resolveConflict')!;

                const result = await resolveConflictCommand({
                    conflictId: conflicts[0].id,
                    resolution: ConflictResolution.CANCEL
                });

                assert.ok(result.success, 'Resolve conflict should succeed');
                assert.ok(result.data.resolved, 'Should indicate conflict was resolved');
            }
        });

        test('should validate conflict resolution parameters', async () => {
            const resolveConflictCommand = registeredCommands.get('specforged.mcp.resolveConflict')!;

            // Invalid conflict ID
            const result = await resolveConflictCommand({
                conflictId: 'nonexistent-conflict',
                resolution: ConflictResolution.CANCEL
            });

            assert.strictEqual(result.success, false, 'Should fail for nonexistent conflict');
        });
    });

    suite('Queue Operations', () => {
        test('should handle queueOperation command', async () => {
            const queueOperationCommand = registeredCommands.get('specforged.mcp.queueOperation')!;

            const result = await queueOperationCommand({
                type: 'CREATE_SPEC',
                params: {
                    specId: 'queued-spec',
                    name: 'Queued Specification',
                    description: 'A queued specification'
                },
                priority: 'high'
            });

            assert.ok(result.success, 'Queue operation should succeed');
            assert.ok(result.data.operationId, 'Should return operation ID');

            const queue = mcpSyncService.getOperationQueue();
            const queuedOp = queue.operations.find(op => 'specId' in op.params && op.params.specId === 'queued-spec');
            assert.ok(queuedOp, 'Operation should be in queue');
        });

        test('should handle getOperationQueue command', async () => {
            // Add some operations to the queue
            await mcpSyncService.queueOperation(
                McpOperationFactory.createCreateSpecOperation('Queue Test', 'Description')
            );

            const getOperationQueueCommand = registeredCommands.get('specforged.mcp.getOperationQueue')!;
            const result = await getOperationQueueCommand();

            assert.ok(result.success, 'Get operation queue should succeed');
            assert.ok(result.data.queue, 'Should return queue data');
            assert.ok(Array.isArray(result.data.queue.operations), 'Should include operations array');
            assert.ok(result.data.queue.operations.length > 0, 'Should include queued operations');
        });

        test('should filter operation queue by status', async () => {
            // Add operations with different statuses
            const pendingOp = McpOperationFactory.createCreateSpecOperation('Pending', 'Description');
            const inProgressOp = McpOperationFactory.createCreateSpecOperation('InProgress', 'Description');
            inProgressOp.status = McpOperationStatus.IN_PROGRESS;

            await mcpSyncService.queueOperation(pendingOp);
            await mcpSyncService.queueOperation(inProgressOp);

            const getOperationQueueCommand = registeredCommands.get('specforged.mcp.getOperationQueue')!;

            // Filter by pending status
            const pendingResult = await getOperationQueueCommand({ status: 'pending' });
            assert.ok(pendingResult.success, 'Should succeed with status filter');

            const pendingOps = pendingResult.data.queue.operations.filter((op: any) => op.status === 'PENDING');
            assert.ok(pendingOps.length > 0, 'Should return pending operations');
        });

        test('should validate operation type in queueOperation', async () => {
            const queueOperationCommand = registeredCommands.get('specforged.mcp.queueOperation')!;

            const result = await queueOperationCommand({
                type: 'INVALID_TYPE',
                params: {},
                priority: 'normal'
            });

            assert.strictEqual(result.success, false, 'Should reject invalid operation type');
            assert.ok(result.error?.includes('invalid') || result.error?.includes('type'), 'Should indicate type validation error');
        });
    });

    suite('Error Handling and Edge Cases', () => {
        test('should handle command execution errors gracefully', async () => {
            // Mock file operation service to throw error
            const originalCreateSpec = fileOperationService.createSpecification;
            fileOperationService.createSpecification = async () => {
                throw new Error('Simulated file operation error');
            };

            try {
                const createFileCommand = registeredCommands.get('specforged.mcp.createFile')!;
                const result = await createFileCommand({
                    filePath: 'error-test.md',
                    content: 'Test content'
                });

                assert.strictEqual(result.success, false, 'Should fail gracefully');
                assert.ok(result.error, 'Should provide error message');
            } finally {
                fileOperationService.createSpecification = originalCreateSpec;
            }
        });

        test('should validate required parameters', async () => {
            const createSpecCommand = registeredCommands.get('specforged.mcp.createSpec')!;

            // Test with undefined parameters
            const result1 = await createSpecCommand(undefined);
            assert.strictEqual(result1.success, false, 'Should reject undefined parameters');

            // Test with null parameters
            const result2 = await createSpecCommand(null);
            assert.strictEqual(result2.success, false, 'Should reject null parameters');

            // Test with empty object
            const result3 = await createSpecCommand({});
            assert.strictEqual(result3.success, false, 'Should reject empty parameters');
        });

        test('should handle concurrent command execution', async () => {
            const createSpecCommand = registeredCommands.get('specforged.mcp.createSpec')!;

            // Execute multiple commands concurrently
            const promises = Array.from({ length: 5 }, (_, i) =>
                createSpecCommand({
                    specId: `concurrent-spec-${i}`,
                    name: `Concurrent Spec ${i}`,
                    description: `Description ${i}`
                })
            );

            const results = await Promise.all(promises);

            // All commands should succeed
            for (const result of results) {
                assert.ok(result.success, 'Concurrent commands should succeed');
            }
        });

        test('should handle workspace unavailable scenario', async () => {
            // Temporarily mock workspace as unavailable
            const originalWorkspaceFolders = vscode.workspace.workspaceFolders;
            Object.defineProperty(vscode.workspace, 'workspaceFolders', {
                value: undefined,
                configurable: true
            });

            try {
                const createFileCommand = registeredCommands.get('specforged.mcp.createFile')!;
                const result = await createFileCommand({
                    filePath: 'no-workspace.md',
                    content: 'Test content'
                });

                assert.strictEqual(result.success, false, 'Should fail when no workspace available');
                assert.ok(result.error?.includes('workspace'), 'Should indicate workspace issue');
            } finally {
                Object.defineProperty(vscode.workspace, 'workspaceFolders', {
                    value: originalWorkspaceFolders,
                    configurable: true
                });
            }
        });

        test('should handle malformed JSON parameters', async () => {
            const createSpecCommand = registeredCommands.get('specforged.mcp.createSpec')!;

            // Create object with circular reference
            const circularObj: any = { specId: 'circular-test' };
            circularObj.self = circularObj;

            const result = await createSpecCommand(circularObj);

            // Should handle gracefully (either succeed with sanitized data or fail gracefully)
            assert.ok(typeof result.success === 'boolean', 'Should return valid result structure');
        });

        test('should handle extremely large parameter values', async () => {
            const createFileCommand = registeredCommands.get('specforged.mcp.createFile')!;

            const largeContent = 'x'.repeat(10 * 1024 * 1024); // 10MB content

            const result = await createFileCommand({
                filePath: 'large-file.md',
                content: largeContent
            });

            // Should either succeed or fail gracefully with appropriate error
            assert.ok(typeof result.success === 'boolean', 'Should handle large content gracefully');
            if (!result.success) {
                assert.ok(result.error, 'Should provide error message for large content');
            }
        });
    });

    suite('Performance and Optimization', () => {
        test('should complete simple commands quickly', async () => {
            const getSyncStatusCommand = registeredCommands.get('specforged.mcp.getSyncStatus')!;

            const startTime = Date.now();
            await getSyncStatusCommand();
            const duration = Date.now() - startTime;

            assert.ok(duration < 1000, `Get sync status should complete quickly: ${duration}ms`);
        });

        test('should handle rapid successive commands efficiently', async () => {
            const createFileCommand = registeredCommands.get('specforged.mcp.createFile')!;

            const startTime = Date.now();

            // Execute many file creation commands rapidly
            const promises = Array.from({ length: 20 }, (_, i) =>
                createFileCommand({
                    filePath: `rapid-${i}.md`,
                    content: `Content ${i}`
                })
            );

            await Promise.all(promises);
            const duration = Date.now() - startTime;

            assert.ok(duration < 5000, `Rapid commands should complete efficiently: ${duration}ms`);
        });

        test('should not leak memory during repeated command execution', async () => {
            const getSyncStatusCommand = registeredCommands.get('specforged.mcp.getSyncStatus')!;

            const initialMemory = process.memoryUsage().heapUsed;

            // Execute command many times
            for (let i = 0; i < 100; i++) {
                await getSyncStatusCommand();

                if (i % 20 === 0 && global.gc) {
                    global.gc(); // Force garbage collection if available
                }
            }

            const finalMemory = process.memoryUsage().heapUsed;
            const memoryIncrease = finalMemory - initialMemory;

            // Memory increase should be reasonable
            assert.ok(memoryIncrease < 10 * 1024 * 1024, `Memory usage should be reasonable: ${memoryIncrease} bytes`);
        });
    });
});
