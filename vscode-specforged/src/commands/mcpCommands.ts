import * as vscode from 'vscode';
import { FileOperationService, FileOperationResult } from '../services/fileOperationService';
import { McpSyncService } from '../services/mcpSyncService';
import { McpOperationFactory, McpOperationType, McpOperationPriority } from '../models/mcpOperation';
import { ConflictResolver } from '../utils/conflictResolver';

export class McpApiHandler {
    constructor(
        private fileOperationService: FileOperationService,
        private mcpSyncService: McpSyncService,
        private conflictResolver: ConflictResolver
    ) {}

    setupMcpCommands(context: vscode.ExtensionContext): void {
        // Direct file operation commands that MCP can call
        const commands = [
            // Specification operations
            vscode.commands.registerCommand('specforged.mcp.createSpec', this.handleCreateSpec.bind(this)),
            vscode.commands.registerCommand('specforged.mcp.updateRequirements', this.handleUpdateRequirements.bind(this)),
            vscode.commands.registerCommand('specforged.mcp.updateDesign', this.handleUpdateDesign.bind(this)),
            vscode.commands.registerCommand('specforged.mcp.updateTasks', this.handleUpdateTasks.bind(this)),
            vscode.commands.registerCommand('specforged.mcp.deleteSpec', this.handleDeleteSpec.bind(this)),

            // Task operations
            vscode.commands.registerCommand('specforged.mcp.updateTaskStatus', this.handleUpdateTaskStatus.bind(this)),
            vscode.commands.registerCommand('specforged.mcp.addUserStory', this.handleAddUserStory.bind(this)),

            // File operations
            vscode.commands.registerCommand('specforged.mcp.createFile', this.handleCreateFile.bind(this)),
            vscode.commands.registerCommand('specforged.mcp.readFile', this.handleReadFile.bind(this)),
            vscode.commands.registerCommand('specforged.mcp.writeFile', this.handleWriteFile.bind(this)),
            vscode.commands.registerCommand('specforged.mcp.deleteFile', this.handleDeleteFile.bind(this)),
            vscode.commands.registerCommand('specforged.mcp.createDirectory', this.handleCreateDirectory.bind(this)),

            // Sync operations
            vscode.commands.registerCommand('specforged.mcp.getSyncStatus', this.handleGetSyncStatus.bind(this)),
            vscode.commands.registerCommand('specforged.mcp.forceSync', this.handleForceSync.bind(this)),
            vscode.commands.registerCommand('specforged.mcp.listSpecifications', this.handleListSpecifications.bind(this)),

            // Conflict operations
            vscode.commands.registerCommand('specforged.mcp.getConflicts', this.handleGetConflicts.bind(this)),
            vscode.commands.registerCommand('specforged.mcp.resolveConflict', this.handleResolveConflict.bind(this)),

            // Queue operations
            vscode.commands.registerCommand('specforged.mcp.queueOperation', this.handleQueueOperation.bind(this)),
            vscode.commands.registerCommand('specforged.mcp.getOperationQueue', this.handleGetOperationQueue.bind(this))
        ];

        context.subscriptions.push(...commands);

        console.log('MCP commands registered successfully');
    }

    private async handleCreateSpec(params: {
        name: string,
        description?: string,
        specId?: string
    }): Promise<FileOperationResult> {
        try {
            console.log('MCP Command: createSpec', params);

            // Validate parameters before queuing
            const validation = this.validateCreateSpecParams(params);
            if (!validation.valid) {
                return {
                    success: false,
                    message: `Invalid parameters: ${validation.errors.join(', ')}`,
                    error: 'VALIDATION_ERROR'
                };
            }

            // Create and queue operation
            const operation = McpOperationFactory.createCreateSpecOperation(
                params.name,
                params.description,
                params.specId,
                {
                    priority: McpOperationPriority.HIGH, // High priority for spec creation
                    metadata: { source: 'mcp_command' }
                }
            );

            await this.mcpSyncService.queueOperation(operation);

            // Provide immediate user feedback
            vscode.window.showInformationMessage(
                `Specification "${params.name}" creation queued. Check the MCP Operations view for progress.`,
                'View Operations'
            ).then(selection => {
                if (selection === 'View Operations') {
                    vscode.commands.executeCommand('specforged.showOperationQueue');
                }
            });

            return {
                success: true,
                message: `Specification creation queued successfully`,
                data: {
                    operationId: operation.id,
                    specId: params.specId || this.generateSpecId(params.name),
                    status: 'queued'
                }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to queue specification creation: ${error.message}`,
                error: 'MCP_COMMAND_ERROR'
            };
        }
    }

    private async handleUpdateRequirements(params: {
        specId: string,
        content: string
    }): Promise<FileOperationResult> {
        try {
            console.log('MCP Command: updateRequirements', { specId: params.specId });

            // Validate parameters before queuing
            const validation = this.validateUpdateRequirementsParams(params);
            if (!validation.valid) {
                return {
                    success: false,
                    message: `Invalid parameters: ${validation.errors.join(', ')}`,
                    error: 'VALIDATION_ERROR'
                };
            }

            // Create and queue operation
            const operation = McpOperationFactory.createUpdateRequirementsOperation(
                params.specId,
                params.content,
                {
                    priority: McpOperationPriority.NORMAL,
                    metadata: {
                        source: 'mcp_command',
                        contentLength: params.content.length
                    }
                }
            );

            await this.mcpSyncService.queueOperation(operation);

            // Provide immediate user feedback
            vscode.window.showInformationMessage(
                `Requirements update for "${params.specId}" queued successfully.`,
                'View Operations'
            ).then(selection => {
                if (selection === 'View Operations') {
                    vscode.commands.executeCommand('specforged.showOperationQueue');
                }
            });

            return {
                success: true,
                message: `Requirements update queued successfully`,
                data: {
                    operationId: operation.id,
                    specId: params.specId,
                    status: 'queued'
                }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to queue requirements update: ${error.message}`,
                error: 'MCP_COMMAND_ERROR'
            };
        }
    }

    private async handleUpdateDesign(params: {
        specId: string,
        content: string
    }): Promise<FileOperationResult> {
        try {
            console.log('MCP Command: updateDesign', { specId: params.specId });

            // Validate parameters before queuing
            const validation = this.validateUpdateDesignParams(params);
            if (!validation.valid) {
                return {
                    success: false,
                    message: `Invalid parameters: ${validation.errors.join(', ')}`,
                    error: 'VALIDATION_ERROR'
                };
            }

            // Create and queue operation
            const operation = McpOperationFactory.createUpdateDesignOperation(
                params.specId,
                params.content,
                {
                    priority: McpOperationPriority.NORMAL,
                    metadata: {
                        source: 'mcp_command',
                        contentLength: params.content.length
                    }
                }
            );

            await this.mcpSyncService.queueOperation(operation);

            // Provide immediate user feedback
            vscode.window.showInformationMessage(
                `Design update for "${params.specId}" queued successfully.`,
                'View Operations'
            ).then(selection => {
                if (selection === 'View Operations') {
                    vscode.commands.executeCommand('specforged.showOperationQueue');
                }
            });

            return {
                success: true,
                message: `Design update queued successfully`,
                data: {
                    operationId: operation.id,
                    specId: params.specId,
                    status: 'queued'
                }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to queue design update: ${error.message}`,
                error: 'MCP_COMMAND_ERROR'
            };
        }
    }

    private async handleUpdateTasks(params: {
        specId: string,
        content: string
    }): Promise<FileOperationResult> {
        try {
            console.log('MCP Command: updateTasks', { specId: params.specId });

            // Validate parameters before queuing
            const validation = this.validateUpdateTasksParams(params);
            if (!validation.valid) {
                return {
                    success: false,
                    message: `Invalid parameters: ${validation.errors.join(', ')}`,
                    error: 'VALIDATION_ERROR'
                };
            }

            // Create and queue operation
            const operation = McpOperationFactory.createUpdateTasksOperation(
                params.specId,
                params.content,
                {
                    priority: McpOperationPriority.NORMAL,
                    metadata: {
                        source: 'mcp_command',
                        contentLength: params.content.length
                    }
                }
            );

            await this.mcpSyncService.queueOperation(operation);

            // Provide immediate user feedback
            vscode.window.showInformationMessage(
                `Tasks update for "${params.specId}" queued successfully.`,
                'View Operations'
            ).then(selection => {
                if (selection === 'View Operations') {
                    vscode.commands.executeCommand('specforged.showOperationQueue');
                }
            });

            return {
                success: true,
                message: `Tasks update queued successfully`,
                data: {
                    operationId: operation.id,
                    specId: params.specId,
                    status: 'queued'
                }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to queue tasks update: ${error.message}`,
                error: 'MCP_COMMAND_ERROR'
            };
        }
    }

    private async handleDeleteSpec(params: {
        specId: string
    }): Promise<FileOperationResult> {
        try {
            console.log('MCP Command: deleteSpec', { specId: params.specId });

            // Validate parameters before queuing
            const validation = this.validateDeleteSpecParams(params);
            if (!validation.valid) {
                return {
                    success: false,
                    message: `Invalid parameters: ${validation.errors.join(', ')}`,
                    error: 'VALIDATION_ERROR'
                };
            }

            // Create and queue operation
            const operation = McpOperationFactory.createDeleteSpecOperation(
                params.specId,
                {
                    priority: McpOperationPriority.HIGH, // High priority for deletion operations
                    metadata: {
                        source: 'mcp_command',
                        confirmationRequired: true
                    }
                }
            );

            await this.mcpSyncService.queueOperation(operation);

            // Provide immediate user feedback with warning
            vscode.window.showWarningMessage(
                `Specification "${params.specId}" deletion queued. This action cannot be undone.`,
                'View Operations', 'Cancel'
            ).then(selection => {
                if (selection === 'View Operations') {
                    vscode.commands.executeCommand('specforged.showOperationQueue');
                } else if (selection === 'Cancel') {
                    // TODO: Implement operation cancellation
                    vscode.window.showInformationMessage('Operation cancellation not yet implemented');
                }
            });

            return {
                success: true,
                message: `Specification deletion queued successfully`,
                data: {
                    operationId: operation.id,
                    specId: params.specId,
                    status: 'queued'
                }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to queue specification deletion: ${error.message}`,
                error: 'MCP_COMMAND_ERROR'
            };
        }
    }

    private async handleUpdateTaskStatus(params: {
        specId: string,
        taskNumber: string,
        status: 'pending' | 'in_progress' | 'completed'
    }): Promise<FileOperationResult> {
        try {
            console.log('MCP Command: updateTaskStatus', params);

            // Validate parameters before queuing
            const validation = this.validateUpdateTaskStatusParams(params);
            if (!validation.valid) {
                return {
                    success: false,
                    message: `Invalid parameters: ${validation.errors.join(', ')}`,
                    error: 'VALIDATION_ERROR'
                };
            }

            // Create and queue operation
            const operation = McpOperationFactory.createUpdateTaskStatusOperation(
                params.specId,
                params.taskNumber,
                params.status,
                {
                    priority: McpOperationPriority.HIGH, // High priority for task status updates
                    metadata: {
                        source: 'mcp_command',
                        previousStatus: 'unknown' // Could be enhanced to track previous status
                    }
                }
            );

            await this.mcpSyncService.queueOperation(operation);

            // Provide immediate user feedback
            vscode.window.showInformationMessage(
                `Task status update for "${params.specId}" (task ${params.taskNumber}) queued successfully.`,
                'View Operations'
            ).then(selection => {
                if (selection === 'View Operations') {
                    vscode.commands.executeCommand('specforged.showOperationQueue');
                }
            });

            return {
                success: true,
                message: `Task status update queued successfully`,
                data: {
                    operationId: operation.id,
                    specId: params.specId,
                    taskNumber: params.taskNumber,
                    newStatus: params.status,
                    status: 'queued'
                }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to queue task status update: ${error.message}`,
                error: 'MCP_COMMAND_ERROR'
            };
        }
    }

    private async handleAddUserStory(params: {
        specId: string,
        asA: string,
        iWant: string,
        soThat: string,
        requirements?: Array<{condition: string, systemResponse: string}>
    }): Promise<FileOperationResult> {
        try {
            console.log('MCP Command: addUserStory', { specId: params.specId });

            // Validate parameters before queuing
            const validation = this.validateAddUserStoryParams(params);
            if (!validation.valid) {
                return {
                    success: false,
                    message: `Invalid parameters: ${validation.errors.join(', ')}`,
                    error: 'VALIDATION_ERROR'
                };
            }

            // Create and queue operation
            const operation = McpOperationFactory.createAddUserStoryOperation(
                params.specId,
                params.asA,
                params.iWant,
                params.soThat,
                params.requirements,
                {
                    priority: McpOperationPriority.NORMAL,
                    metadata: {
                        source: 'mcp_command',
                        requirementCount: params.requirements?.length || 0
                    }
                }
            );

            await this.mcpSyncService.queueOperation(operation);

            // Provide immediate user feedback
            vscode.window.showInformationMessage(
                `User story addition for "${params.specId}" queued successfully.`,
                'View Operations'
            ).then(selection => {
                if (selection === 'View Operations') {
                    vscode.commands.executeCommand('specforged.showOperationQueue');
                }
            });

            return {
                success: true,
                message: `User story addition queued successfully`,
                data: {
                    operationId: operation.id,
                    specId: params.specId,
                    status: 'queued'
                }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to queue user story addition: ${error.message}`,
                error: 'MCP_COMMAND_ERROR'
            };
        }
    }

    private async handleCreateFile(params: {
        path: string,
        content: string
    }): Promise<FileOperationResult> {
        try {
            console.log('MCP Command: createFile', { path: params.path });

            // Validate parameters before queuing
            const validation = this.validateCreateFileParams(params);
            if (!validation.valid) {
                return {
                    success: false,
                    message: `Invalid parameters: ${validation.errors.join(', ')}`,
                    error: 'VALIDATION_ERROR'
                };
            }

            // Create and queue operation
            const operation = McpOperationFactory.createOperation(
                'file_create' as McpOperationType,
                {
                    path: params.path,
                    content: params.content
                },
                {
                    priority: McpOperationPriority.NORMAL,
                    metadata: { source: 'mcp_command' }
                }
            );

            await this.mcpSyncService.queueOperation(operation);

            return {
                success: true,
                message: `File creation queued successfully`,
                data: {
                    operationId: operation.id,
                    path: params.path,
                    status: 'queued'
                }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to queue file creation: ${error.message}`,
                error: 'MCP_COMMAND_ERROR'
            };
        }
    }

    private async handleReadFile(params: {
        path: string
    }): Promise<FileOperationResult> {
        try {
            console.log('MCP Command: readFile', { path: params.path });

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return {
                    success: false,
                    message: 'No workspace folder found',
                    error: 'NO_WORKSPACE'
                };
            }

            const filePath = vscode.Uri.joinPath(workspaceFolder.uri, params.path);
            const decoder = new TextDecoder();
            const content = await vscode.workspace.fs.readFile(filePath);

            return {
                success: true,
                message: `File read: ${params.path}`,
                data: {
                    content: decoder.decode(content),
                    path: filePath.fsPath
                }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to read file: ${error.message}`,
                error: 'FILE_READ_ERROR'
            };
        }
    }

    private async handleWriteFile(params: {
        path: string,
        content: string
    }): Promise<FileOperationResult> {
        try {
            console.log('MCP Command: writeFile', { path: params.path });

            // Validate parameters before queuing
            const validation = this.validateWriteFileParams(params);
            if (!validation.valid) {
                return {
                    success: false,
                    message: `Invalid parameters: ${validation.errors.join(', ')}`,
                    error: 'VALIDATION_ERROR'
                };
            }

            // Create and queue operation
            const operation = McpOperationFactory.createOperation(
                'file_write' as McpOperationType,
                {
                    path: params.path,
                    content: params.content
                },
                {
                    priority: McpOperationPriority.NORMAL,
                    metadata: { source: 'mcp_command' }
                }
            );

            await this.mcpSyncService.queueOperation(operation);

            return {
                success: true,
                message: `File write queued successfully`,
                data: {
                    operationId: operation.id,
                    path: params.path,
                    status: 'queued'
                }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to queue file write: ${error.message}`,
                error: 'MCP_COMMAND_ERROR'
            };
        }
    }

    private async handleDeleteFile(params: {
        path: string
    }): Promise<FileOperationResult> {
        try {
            console.log('MCP Command: deleteFile', { path: params.path });

            // Validate parameters before queuing
            const validation = this.validateDeleteFileParams(params);
            if (!validation.valid) {
                return {
                    success: false,
                    message: `Invalid parameters: ${validation.errors.join(', ')}`,
                    error: 'VALIDATION_ERROR'
                };
            }

            // Create and queue operation
            const operation = McpOperationFactory.createOperation(
                'file_delete' as McpOperationType,
                {
                    path: params.path
                },
                {
                    priority: McpOperationPriority.HIGH, // High priority for deletion
                    metadata: { source: 'mcp_command' }
                }
            );

            await this.mcpSyncService.queueOperation(operation);

            return {
                success: true,
                message: `File deletion queued successfully`,
                data: {
                    operationId: operation.id,
                    path: params.path,
                    status: 'queued'
                }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to queue file deletion: ${error.message}`,
                error: 'MCP_COMMAND_ERROR'
            };
        }
    }

    private async handleCreateDirectory(params: {
        path: string
    }): Promise<FileOperationResult> {
        try {
            console.log('MCP Command: createDirectory', { path: params.path });

            // Validate parameters before queuing
            const validation = this.validateCreateDirectoryParams(params);
            if (!validation.valid) {
                return {
                    success: false,
                    message: `Invalid parameters: ${validation.errors.join(', ')}`,
                    error: 'VALIDATION_ERROR'
                };
            }

            // Create and queue operation
            const operation = McpOperationFactory.createOperation(
                'directory_create' as McpOperationType,
                {
                    path: params.path
                },
                {
                    priority: McpOperationPriority.NORMAL,
                    metadata: { source: 'mcp_command' }
                }
            );

            await this.mcpSyncService.queueOperation(operation);

            return {
                success: true,
                message: `Directory creation queued successfully`,
                data: {
                    operationId: operation.id,
                    path: params.path,
                    status: 'queued'
                }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to queue directory creation: ${error.message}`,
                error: 'MCP_COMMAND_ERROR'
            };
        }
    }

    private async handleGetSyncStatus(): Promise<any> {
        try {
            console.log('MCP Command: getSyncStatus');

            const syncState = this.mcpSyncService.getSyncState();
            const conflicts = this.conflictResolver.getActiveConflicts();

            return {
                success: true,
                message: 'Sync status retrieved',
                data: {
                    ...syncState,
                    activeConflicts: conflicts.length,
                    conflicts: conflicts.map(c => ({
                        id: c.id,
                        type: c.type,
                        description: c.description,
                        timestamp: c.timestamp
                    }))
                }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to get sync status: ${error.message}`,
                error: 'SYNC_STATUS_ERROR'
            };
        }
    }

    private async handleForceSync(): Promise<any> {
        try {
            console.log('MCP Command: forceSync');

            // Process pending operations
            await this.mcpSyncService.processOperations();

            // Clean up old operations
            await this.mcpSyncService.cleanupOldOperations();

            return {
                success: true,
                message: 'Force sync completed',
                data: {
                    syncState: this.mcpSyncService.getSyncState()
                }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Force sync failed: ${error.message}`,
                error: 'FORCE_SYNC_ERROR'
            };
        }
    }

    private async handleListSpecifications(): Promise<FileOperationResult> {
        try {
            console.log('MCP Command: listSpecifications');
            return await this.fileOperationService.listSpecifications();
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to list specifications: ${error.message}`,
                error: 'LIST_SPECS_ERROR'
            };
        }
    }

    private async handleGetConflicts(): Promise<any> {
        try {
            console.log('MCP Command: getConflicts');

            const conflicts = this.conflictResolver.getActiveConflicts();

            return {
                success: true,
                message: `Found ${conflicts.length} active conflicts`,
                data: { conflicts }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to get conflicts: ${error.message}`,
                error: 'GET_CONFLICTS_ERROR'
            };
        }
    }

    private async handleResolveConflict(params: {
        conflictId: string,
        resolution?: string
    }): Promise<any> {
        try {
            console.log('MCP Command: resolveConflict', params);

            const resolved = await this.conflictResolver.resolveConflict(
                params.conflictId,
                params.resolution as any
            );

            return {
                success: resolved,
                message: resolved ? 'Conflict resolved' : 'Failed to resolve conflict',
                data: { conflictId: params.conflictId, resolved }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to resolve conflict: ${error.message}`,
                error: 'RESOLVE_CONFLICT_ERROR'
            };
        }
    }

    private async handleQueueOperation(params: {
        type: string,
        params: any,
        priority?: number
    }): Promise<any> {
        try {
            console.log('MCP Command: queueOperation', { type: params.type });

            const operation = McpOperationFactory.createOperation(
                params.type as McpOperationType,
                params.params,
                {
                    priority: params.priority || 1,
                    source: 'mcp'
                }
            );

            await this.mcpSyncService.queueOperation(operation);

            return {
                success: true,
                message: 'Operation queued successfully',
                data: { operationId: operation.id }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to queue operation: ${error.message}`,
                error: 'QUEUE_OPERATION_ERROR'
            };
        }
    }

    private async handleGetOperationQueue(): Promise<any> {
        try {
            console.log('MCP Command: getOperationQueue');

            const queue = this.mcpSyncService.getOperationQueue();

            return {
                success: true,
                message: `Found ${queue.operations.length} operations in queue`,
                data: { queue }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to get operation queue: ${error.message}`,
                error: 'GET_QUEUE_ERROR'
            };
        }
    }

    // Validation methods for file operations
    private validateCreateFileParams(params: {
        path: string,
        content: string
    }): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!params.path || typeof params.path !== 'string' || params.path.trim().length === 0) {
            errors.push('Path is required and must be a non-empty string');
        }

        if (params.content === undefined || typeof params.content !== 'string') {
            errors.push('Content is required and must be a string');
        }

        if (params.path && params.path.includes('..')) {
            errors.push('Path traversal is not allowed');
        }

        return { valid: errors.length === 0, errors };
    }

    private validateWriteFileParams(params: {
        path: string,
        content: string
    }): { valid: boolean; errors: string[] } {
        return this.validateCreateFileParams(params);
    }

    private validateDeleteFileParams(params: {
        path: string
    }): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!params.path || typeof params.path !== 'string' || params.path.trim().length === 0) {
            errors.push('Path is required and must be a non-empty string');
        }

        if (params.path && params.path.includes('..')) {
            errors.push('Path traversal is not allowed');
        }

        return { valid: errors.length === 0, errors };
    }

    private validateCreateDirectoryParams(params: {
        path: string
    }): { valid: boolean; errors: string[] } {
        return this.validateDeleteFileParams(params);
    }

    // Validation methods for command parameters
    private validateCreateSpecParams(params: {
        name: string,
        description?: string,
        specId?: string
    }): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!params.name || typeof params.name !== 'string' || params.name.trim().length === 0) {
            errors.push('Name is required and must be a non-empty string');
        }

        if (params.name && params.name.length > 100) {
            errors.push('Name must be 100 characters or less');
        }

        if (params.description && typeof params.description !== 'string') {
            errors.push('Description must be a string');
        }

        if (params.description && params.description.length > 500) {
            errors.push('Description must be 500 characters or less');
        }

        if (params.specId && typeof params.specId !== 'string') {
            errors.push('SpecId must be a string');
        }

        if (params.specId && !/^[a-z0-9-]+$/.test(params.specId)) {
            errors.push('SpecId must contain only lowercase letters, numbers, and hyphens');
        }

        return { valid: errors.length === 0, errors };
    }

    private validateUpdateRequirementsParams(params: {
        specId: string,
        content: string
    }): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!params.specId || typeof params.specId !== 'string' || params.specId.trim().length === 0) {
            errors.push('SpecId is required and must be a non-empty string');
        }

        if (!params.content || typeof params.content !== 'string') {
            errors.push('Content is required and must be a string');
        }

        if (params.content && params.content.length > 100000) {
            errors.push('Content must be 100,000 characters or less');
        }

        return { valid: errors.length === 0, errors };
    }

    private validateUpdateDesignParams(params: {
        specId: string,
        content: string
    }): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!params.specId || typeof params.specId !== 'string' || params.specId.trim().length === 0) {
            errors.push('SpecId is required and must be a non-empty string');
        }

        if (!params.content || typeof params.content !== 'string') {
            errors.push('Content is required and must be a string');
        }

        if (params.content && params.content.length > 100000) {
            errors.push('Content must be 100,000 characters or less');
        }

        return { valid: errors.length === 0, errors };
    }

    private validateUpdateTasksParams(params: {
        specId: string,
        content: string
    }): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!params.specId || typeof params.specId !== 'string' || params.specId.trim().length === 0) {
            errors.push('SpecId is required and must be a non-empty string');
        }

        if (!params.content || typeof params.content !== 'string') {
            errors.push('Content is required and must be a string');
        }

        if (params.content && params.content.length > 100000) {
            errors.push('Content must be 100,000 characters or less');
        }

        return { valid: errors.length === 0, errors };
    }

    private validateAddUserStoryParams(params: {
        specId: string,
        asA: string,
        iWant: string,
        soThat: string,
        requirements?: Array<{condition: string; systemResponse: string}>
    }): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!params.specId || typeof params.specId !== 'string' || params.specId.trim().length === 0) {
            errors.push('SpecId is required and must be a non-empty string');
        }

        if (!params.asA || typeof params.asA !== 'string' || params.asA.trim().length === 0) {
            errors.push('AsA is required and must be a non-empty string');
        }

        if (!params.iWant || typeof params.iWant !== 'string' || params.iWant.trim().length === 0) {
            errors.push('IWant is required and must be a non-empty string');
        }

        if (!params.soThat || typeof params.soThat !== 'string' || params.soThat.trim().length === 0) {
            errors.push('SoThat is required and must be a non-empty string');
        }

        if (params.requirements && !Array.isArray(params.requirements)) {
            errors.push('Requirements must be an array');
        }

        if (params.requirements) {
            params.requirements.forEach((req, index) => {
                if (!req.condition || typeof req.condition !== 'string') {
                    errors.push(`Requirement ${index + 1}: condition is required and must be a string`);
                }
                if (!req.systemResponse || typeof req.systemResponse !== 'string') {
                    errors.push(`Requirement ${index + 1}: systemResponse is required and must be a string`);
                }
            });
        }

        return { valid: errors.length === 0, errors };
    }

    private validateUpdateTaskStatusParams(params: {
        specId: string,
        taskNumber: string,
        status: 'pending' | 'in_progress' | 'completed'
    }): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!params.specId || typeof params.specId !== 'string' || params.specId.trim().length === 0) {
            errors.push('SpecId is required and must be a non-empty string');
        }

        if (!params.taskNumber || typeof params.taskNumber !== 'string' || params.taskNumber.trim().length === 0) {
            errors.push('TaskNumber is required and must be a non-empty string');
        }

        if (!params.status || !['pending', 'in_progress', 'completed'].includes(params.status)) {
            errors.push('Status must be one of: pending, in_progress, completed');
        }

        return { valid: errors.length === 0, errors };
    }

    private validateDeleteSpecParams(params: {
        specId: string
    }): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!params.specId || typeof params.specId !== 'string' || params.specId.trim().length === 0) {
            errors.push('SpecId is required and must be a non-empty string');
        }

        return { valid: errors.length === 0, errors };
    }

    private generateSpecId(name: string): string {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '');
    }
}
