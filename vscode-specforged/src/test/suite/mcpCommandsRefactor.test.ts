import * as assert from 'assert';
import * as vscode from 'vscode';
import { McpApiHandler } from '../../commands/mcpCommands';
import { FileOperationService } from '../../services/fileOperationService';
import { McpSyncService } from '../../services/mcpSyncService';
import { ConflictResolver } from '../../utils/conflictResolver';
import { McpOperationType, McpOperationStatus } from '../../models/mcpOperation';

suite('MCP Command Handler Refactoring Tests', () => {
    let commandHandler: McpApiHandler;
    let mockFileOperationService: FileOperationService;
    let mockMcpSyncService: McpSyncService;
    let mockConflictResolver: ConflictResolver;

    setup(() => {
        // Create mock services
        mockFileOperationService = {} as FileOperationService;
        mockMcpSyncService = {
            queueOperation: async (operation: any) => {
                // Mock implementation - just verify the operation is properly formed
                assert.ok(operation.id);
                assert.ok(operation.type);
                assert.strictEqual(operation.status, McpOperationStatus.PENDING);
                assert.ok(operation.timestamp);
                assert.ok(operation.params);
            },
            getOperationQueue: () => ({ operations: [], conflicts: [], version: 1, createdAt: '', lastModified: '', processingStats: { totalProcessed: 0, successCount: 0, failureCount: 0, averageProcessingTimeMs: 0 } })
        } as any;
        mockConflictResolver = {} as ConflictResolver;

        commandHandler = new McpApiHandler(
            mockFileOperationService,
            mockMcpSyncService,
            mockConflictResolver
        );
    });

    test('handleCreateSpec should queue operation with validation', async () => {
        const params = {
            name: 'Test Specification',
            description: 'A test specification',
            specId: 'test-spec'
        };

        const result = await (commandHandler as any).handleCreateSpec(params);

        assert.strictEqual(result.success, true);
        assert.ok(result.message.includes('queued'));
        assert.ok(result.data.operationId);
        assert.strictEqual(result.data.specId, 'test-spec');
        assert.strictEqual(result.data.status, 'queued');
    });

    test('handleCreateSpec should reject invalid parameters', async () => {
        const params = {
            name: '', // Invalid: empty name
            description: 'A test specification'
        };

        const result = await (commandHandler as any).handleCreateSpec(params);

        assert.strictEqual(result.success, false);
        assert.ok(result.message.includes('Invalid parameters'));
        assert.strictEqual(result.error, 'VALIDATION_ERROR');
    });

    test('handleUpdateRequirements should queue operation with validation', async () => {
        const params = {
            specId: 'test-spec',
            content: '# Requirements\n\nThis is test content.'
        };

        const result = await (commandHandler as any).handleUpdateRequirements(params);

        assert.strictEqual(result.success, true);
        assert.ok(result.message.includes('queued'));
        assert.ok(result.data.operationId);
        assert.strictEqual(result.data.specId, 'test-spec');
        assert.strictEqual(result.data.status, 'queued');
    });

    test('handleUpdateRequirements should reject invalid parameters', async () => {
        const params = {
            specId: '', // Invalid: empty specId
            content: 'Some content'
        };

        const result = await (commandHandler as any).handleUpdateRequirements(params);

        assert.strictEqual(result.success, false);
        assert.ok(result.message.includes('Invalid parameters'));
        assert.strictEqual(result.error, 'VALIDATION_ERROR');
    });

    test('handleUpdateDesign should queue operation with validation', async () => {
        const params = {
            specId: 'test-spec',
            content: '# Design\n\nThis is test design content.'
        };

        const result = await (commandHandler as any).handleUpdateDesign(params);

        assert.strictEqual(result.success, true);
        assert.ok(result.message.includes('queued'));
        assert.ok(result.data.operationId);
        assert.strictEqual(result.data.specId, 'test-spec');
        assert.strictEqual(result.data.status, 'queued');
    });

    test('handleUpdateTasks should queue operation with validation', async () => {
        const params = {
            specId: 'test-spec',
            content: '# Tasks\n\n- [ ] Task 1\n- [ ] Task 2'
        };

        const result = await (commandHandler as any).handleUpdateTasks(params);

        assert.strictEqual(result.success, true);
        assert.ok(result.message.includes('queued'));
        assert.ok(result.data.operationId);
        assert.strictEqual(result.data.specId, 'test-spec');
        assert.strictEqual(result.data.status, 'queued');
    });

    test('handleAddUserStory should queue operation with validation', async () => {
        const params = {
            specId: 'test-spec',
            asA: 'user',
            iWant: 'to test functionality',
            soThat: 'I can verify it works',
            requirements: [
                { condition: 'WHEN I test', systemResponse: 'THEN it should work' }
            ]
        };

        const result = await (commandHandler as any).handleAddUserStory(params);

        assert.strictEqual(result.success, true);
        assert.ok(result.message.includes('queued'));
        assert.ok(result.data.operationId);
        assert.strictEqual(result.data.specId, 'test-spec');
        assert.strictEqual(result.data.status, 'queued');
    });

    test('handleUpdateTaskStatus should queue operation with validation', async () => {
        const params = {
            specId: 'test-spec',
            taskNumber: '1.1',
            status: 'completed' as const
        };

        const result = await (commandHandler as any).handleUpdateTaskStatus(params);

        assert.strictEqual(result.success, true);
        assert.ok(result.message.includes('queued'));
        assert.ok(result.data.operationId);
        assert.strictEqual(result.data.specId, 'test-spec');
        assert.strictEqual(result.data.taskNumber, '1.1');
        assert.strictEqual(result.data.newStatus, 'completed');
        assert.strictEqual(result.data.status, 'queued');
    });

    test('handleDeleteSpec should queue operation with validation', async () => {
        const params = {
            specId: 'test-spec'
        };

        const result = await (commandHandler as any).handleDeleteSpec(params);

        assert.strictEqual(result.success, true);
        assert.ok(result.message.includes('queued'));
        assert.ok(result.data.operationId);
        assert.strictEqual(result.data.specId, 'test-spec');
        assert.strictEqual(result.data.status, 'queued');
    });

    test('validation methods should work correctly', () => {
        // Test generateSpecId
        const specId = (commandHandler as any).generateSpecId('Test Specification Name!');
        assert.strictEqual(specId, 'test-specification-name');

        // Test validation methods
        const validCreateParams = {
            name: 'Valid Name',
            description: 'Valid description',
            specId: 'valid-spec-id'
        };
        const createValidation = (commandHandler as any).validateCreateSpecParams(validCreateParams);
        assert.strictEqual(createValidation.valid, true);
        assert.strictEqual(createValidation.errors.length, 0);

        const invalidCreateParams = {
            name: '', // Invalid
            description: 'Valid description'
        };
        const invalidCreateValidation = (commandHandler as any).validateCreateSpecParams(invalidCreateParams);
        assert.strictEqual(invalidCreateValidation.valid, false);
        assert.ok(invalidCreateValidation.errors.length > 0);
    });
});
