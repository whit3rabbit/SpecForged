import * as vscode from 'vscode';
import { FileOperationService, FileOperationResult } from '../services/fileOperationService';
import { McpSyncService } from '../services/mcpSyncService';
import { McpOperationFactory, McpOperationType } from '../models/mcpOperation';
import { ConflictResolver } from '../utils/conflictResolver';

export class McpCommandHandler {
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
            vscode.commands.registerCommand('specforged.mcp.forcSync', this.handleForceSync.bind(this)),
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

            const result = await this.fileOperationService.createSpecification(
                params.name,
                params.description || '',
                params.specId
            );

            if (result.success && result.data) {
                // Notify sync service
                await this.mcpSyncService.notifySpecificationChange(
                    result.data.specId,
                    'created'
                );
            }

            return result;
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to create specification: ${error.message}`,
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

            const result = await this.fileOperationService.updateSpecificationFile(
                params.specId,
                'requirements.md',
                params.content
            );

            if (result.success) {
                await this.mcpSyncService.notifySpecificationChange(
                    params.specId,
                    'requirements_updated'
                );
            }

            return result;
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to update requirements: ${error.message}`,
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

            const result = await this.fileOperationService.updateSpecificationFile(
                params.specId,
                'design.md',
                params.content
            );

            if (result.success) {
                await this.mcpSyncService.notifySpecificationChange(
                    params.specId,
                    'design_updated'
                );
            }

            return result;
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to update design: ${error.message}`,
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

            const result = await this.fileOperationService.updateSpecificationFile(
                params.specId,
                'tasks.md',
                params.content
            );

            if (result.success) {
                await this.mcpSyncService.notifySpecificationChange(
                    params.specId,
                    'tasks_updated'
                );
            }

            return result;
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to update tasks: ${error.message}`,
                error: 'MCP_COMMAND_ERROR'
            };
        }
    }

    private async handleDeleteSpec(params: {
        specId: string
    }): Promise<FileOperationResult> {
        try {
            console.log('MCP Command: deleteSpec', { specId: params.specId });

            const result = await this.fileOperationService.deleteSpecification(params.specId);

            if (result.success) {
                await this.mcpSyncService.notifySpecificationChange(
                    params.specId,
                    'deleted'
                );
            }

            return result;
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to delete specification: ${error.message}`,
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

            const result = await this.fileOperationService.updateTaskStatus(
                params.specId,
                params.taskNumber,
                params.status
            );

            if (result.success) {
                await this.mcpSyncService.notifySpecificationChange(
                    params.specId,
                    'task_updated'
                );
            }

            return result;
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to update task status: ${error.message}`,
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

            const result = await this.fileOperationService.addUserStory(
                params.specId,
                params.asA,
                params.iWant,
                params.soThat,
                params.requirements
            );

            if (result.success) {
                await this.mcpSyncService.notifySpecificationChange(
                    params.specId,
                    'user_story_added'
                );
            }

            return result;
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to add user story: ${error.message}`,
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

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return {
                    success: false,
                    message: 'No workspace folder found',
                    error: 'NO_WORKSPACE'
                };
            }

            const filePath = vscode.Uri.joinPath(workspaceFolder.uri, params.path);
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(filePath, encoder.encode(params.content));

            return {
                success: true,
                message: `File created: ${params.path}`,
                data: { path: filePath.fsPath }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to create file: ${error.message}`,
                error: 'FILE_CREATION_ERROR'
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

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return {
                    success: false,
                    message: 'No workspace folder found',
                    error: 'NO_WORKSPACE'
                };
            }

            const filePath = vscode.Uri.joinPath(workspaceFolder.uri, params.path);
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(filePath, encoder.encode(params.content));

            return {
                success: true,
                message: `File written: ${params.path}`,
                data: { path: filePath.fsPath }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to write file: ${error.message}`,
                error: 'FILE_WRITE_ERROR'
            };
        }
    }

    private async handleDeleteFile(params: {
        path: string
    }): Promise<FileOperationResult> {
        try {
            console.log('MCP Command: deleteFile', { path: params.path });

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return {
                    success: false,
                    message: 'No workspace folder found',
                    error: 'NO_WORKSPACE'
                };
            }

            const filePath = vscode.Uri.joinPath(workspaceFolder.uri, params.path);
            await vscode.workspace.fs.delete(filePath);

            return {
                success: true,
                message: `File deleted: ${params.path}`
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to delete file: ${error.message}`,
                error: 'FILE_DELETION_ERROR'
            };
        }
    }

    private async handleCreateDirectory(params: {
        path: string
    }): Promise<FileOperationResult> {
        try {
            console.log('MCP Command: createDirectory', { path: params.path });

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return {
                    success: false,
                    message: 'No workspace folder found',
                    error: 'NO_WORKSPACE'
                };
            }

            const dirPath = vscode.Uri.joinPath(workspaceFolder.uri, params.path);
            await vscode.workspace.fs.createDirectory(dirPath);

            return {
                success: true,
                message: `Directory created: ${params.path}`,
                data: { path: dirPath.fsPath }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to create directory: ${error.message}`,
                error: 'DIRECTORY_CREATION_ERROR'
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
                params.priority || 1,
                'mcp'
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
}
