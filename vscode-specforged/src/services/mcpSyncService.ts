import * as vscode from 'vscode';
import * as path from 'path';
import {
    McpOperation,
    McpOperationQueue,
    McpSyncState,
    McpOperationResult,
    McpOperationType,
    McpOperationStatus,
    McpOperationValidator,
    McpOperationFactory
} from '../models/mcpOperation';
import { FileOperationService } from './fileOperationService';
import { McpManager } from '../mcp/mcpManager';

export class McpSyncService {
    private fileOperationService: FileOperationService;
    private mcpManager: McpManager | undefined;
    private operationQueueWatcher: vscode.FileSystemWatcher | undefined;
    private syncStateWatcher: vscode.FileSystemWatcher | undefined;
    private processingTimer: NodeJS.Timeout | undefined;
    private heartbeatTimer: NodeJS.Timeout | undefined;

    private readonly OPERATION_QUEUE_FILE = '.vscode/mcp-operations.json';
    private readonly SYNC_STATE_FILE = '.vscode/specforge-sync.json';
    private readonly OPERATION_RESULTS_FILE = '.vscode/mcp-results.json';

    private currentQueue: McpOperationQueue = {
        operations: [],
        version: 1
    };

    private syncState: McpSyncState = {
        extensionOnline: true,
        mcpServerOnline: false,
        pendingOperations: 0,
        failedOperations: 0,
        syncErrors: [],
        specifications: []
    };

    private isProcessing = false;

    constructor(fileOperationService: FileOperationService) {
        this.fileOperationService = fileOperationService;
    }

    setMcpManager(mcpManager: McpManager): void {
        this.mcpManager = mcpManager;
    }

    async initialize(): Promise<void> {
        try {
            // Ensure .vscode directory exists
            await this.ensureVscodeDirectory();

            // Load existing state
            await this.loadOperationQueue();
            await this.loadSyncState();

            // Setup file watchers
            this.setupFileWatchers();

            // Start processing timer
            this.startProcessingTimer();

            // Start heartbeat
            this.startHeartbeat();

            // Update sync state
            this.syncState.extensionOnline = true;
            await this.saveSyncState();

            console.log('MCP Sync Service initialized');
        } catch (error) {
            console.error('Failed to initialize MCP Sync Service:', error);
        }
    }

    async queueOperation(operation: McpOperation): Promise<void> {
        // Validate operation
        const validation = McpOperationValidator.validateOperation(operation);
        if (!validation.valid) {
            throw new Error(`Invalid operation: ${validation.errors.join(', ')}`);
        }

        // Add to queue
        this.currentQueue.operations.push(operation);
        this.currentQueue.version++;
        this.syncState.pendingOperations = this.currentQueue.operations.filter(
            op => op.status === McpOperationStatus.PENDING || op.status === McpOperationStatus.IN_PROGRESS
        ).length;

        // Save queue and sync state
        await this.saveOperationQueue();
        await this.saveSyncState();

        console.log(`Queued operation: ${operation.type} (${operation.id})`);
    }

    async processOperations(): Promise<void> {
        if (this.isProcessing) {
            return;
        }

        this.isProcessing = true;

        try {
            const pendingOperations = this.currentQueue.operations
                .filter(op => op.status === McpOperationStatus.PENDING)
                .sort((a, b) => b.priority - a.priority);

            for (const operation of pendingOperations) {
                try {
                    await this.processOperation(operation);
                } catch (error) {
                    console.error(`Failed to process operation ${operation.id}:`, error);
                    operation.status = McpOperationStatus.FAILED;
                    operation.error = error instanceof Error ? error.message : 'Unknown error';
                    operation.retryCount++;

                    // Schedule retry if possible
                    if (McpOperationValidator.canRetry(operation)) {
                        setTimeout(() => {
                            operation.status = McpOperationStatus.PENDING;
                            this.saveOperationQueue();
                        }, Math.pow(2, operation.retryCount) * 1000); // Exponential backoff
                    }
                }
            }

            // Update counters
            this.updateSyncCounters();
            await this.saveSyncState();

        } finally {
            this.isProcessing = false;
        }
    }

    private async processOperation(operation: McpOperation): Promise<void> {
        console.log(`Processing operation: ${operation.type} (${operation.id})`);

        operation.status = McpOperationStatus.IN_PROGRESS;
        await this.saveOperationQueue();

        let result: any;
        let success = false;

        try {
            // Check if we should route to HTTP MCP server
            if (this.mcpManager?.isHttpMode() && this.shouldRouteToHttpServer(operation)) {
                result = await this.processHttpOperation(operation);
            } else {
                // Process locally
                result = await this.processLocalOperation(operation);
            }

            success = result?.success !== false;

            operation.status = success ? McpOperationStatus.COMPLETED : McpOperationStatus.FAILED;
            operation.result = result;
            operation.completedAt = new Date().toISOString();

        } catch (error) {
            operation.status = McpOperationStatus.FAILED;
            operation.error = error instanceof Error ? error.message : 'Unknown error';
            throw error;
        }

        // Save result for MCP server to read
        await this.saveOperationResult({
            operationId: operation.id,
            success,
            message: result?.message || (success ? 'Operation completed' : 'Operation failed'),
            data: result?.data,
            error: operation.error,
            timestamp: new Date().toISOString()
        });

        await this.saveOperationQueue();
    }

    private shouldRouteToHttpServer(operation: McpOperation): boolean {
        // Route non-file operations to HTTP server for processing
        // File operations should always be handled locally by extension
        switch (operation.type) {
            case McpOperationType.CREATE_SPEC:
            case McpOperationType.UPDATE_REQUIREMENTS:
            case McpOperationType.UPDATE_DESIGN:
            case McpOperationType.UPDATE_TASKS:
            case McpOperationType.ADD_USER_STORY:
            case McpOperationType.UPDATE_TASK_STATUS:
            case McpOperationType.DELETE_SPEC:
                return false; // Handle file operations locally

            case McpOperationType.HEARTBEAT:
                return true; // Route status checks to server

            default:
                return true; // Route unknown operations to server
        }
    }

    private async processHttpOperation(operation: McpOperation): Promise<any> {
        if (!this.mcpManager) {
            throw new Error('MCP Manager not available for HTTP operations');
        }

        // Map operation to MCP method call
        const methodName = this.getHttpMethodName(operation.type);
        const response = await this.mcpManager.callHttpMcp(methodName, operation.params);

        if (!response.success) {
            throw new Error(response.error || 'HTTP MCP call failed');
        }

        return response.result;
    }

    private getHttpMethodName(operationType: McpOperationType): string {
        switch (operationType) {
            case McpOperationType.HEARTBEAT:
                return 'get_server_status';
            default:
                return 'classify_mode'; // Default to classification for unknown types
        }
    }

    private async processLocalOperation(operation: McpOperation): Promise<any> {
        switch (operation.type) {
            case McpOperationType.CREATE_SPEC:
                return await this.handleCreateSpec(operation as any);
            case McpOperationType.UPDATE_REQUIREMENTS:
                return await this.handleUpdateRequirements(operation as any);
            case McpOperationType.UPDATE_DESIGN:
                return await this.handleUpdateDesign(operation as any);
            case McpOperationType.UPDATE_TASKS:
                return await this.handleUpdateTasks(operation as any);
            case McpOperationType.ADD_USER_STORY:
                return await this.handleAddUserStory(operation as any);
            case McpOperationType.UPDATE_TASK_STATUS:
                return await this.handleUpdateTaskStatus(operation as any);
            case McpOperationType.DELETE_SPEC:
                return await this.handleDeleteSpec(operation as any);
            case McpOperationType.HEARTBEAT:
                return await this.handleHeartbeat(operation as any);
            default:
                throw new Error(`Unsupported operation type: ${operation.type}`);
        }
    }

    private async handleCreateSpec(operation: any): Promise<any> {
        const { name, description, specId } = operation.params;
        return await this.fileOperationService.createSpecification(name, description, specId);
    }

    private async handleUpdateRequirements(operation: any): Promise<any> {
        const { specId, content } = operation.params;
        return await this.fileOperationService.updateSpecificationFile(specId, 'requirements.md', content);
    }

    private async handleUpdateDesign(operation: any): Promise<any> {
        const { specId, content } = operation.params;
        return await this.fileOperationService.updateSpecificationFile(specId, 'design.md', content);
    }

    private async handleUpdateTasks(operation: any): Promise<any> {
        const { specId, content } = operation.params;
        return await this.fileOperationService.updateSpecificationFile(specId, 'tasks.md', content);
    }

    private async handleAddUserStory(operation: any): Promise<any> {
        const { specId, asA, iWant, soThat, requirements } = operation.params;
        return await this.fileOperationService.addUserStory(specId, asA, iWant, soThat, requirements);
    }

    private async handleUpdateTaskStatus(operation: any): Promise<any> {
        const { specId, taskNumber, status } = operation.params;
        return await this.fileOperationService.updateTaskStatus(specId, taskNumber, status);
    }

    private async handleDeleteSpec(operation: any): Promise<any> {
        const { specId } = operation.params;
        return await this.fileOperationService.deleteSpecification(specId);
    }

    private async handleHeartbeat(operation: any): Promise<any> {
        this.syncState.mcpServerOnline = true;
        this.syncState.lastSync = new Date().toISOString();
        await this.saveSyncState();

        return {
            success: true,
            message: 'Heartbeat received',
            data: {
                extensionOnline: this.syncState.extensionOnline,
                timestamp: new Date().toISOString()
            }
        };
    }

    private setupFileWatchers(): void {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        // Watch for operation queue changes (MCP server adding operations)
        const queuePattern = new vscode.RelativePattern(workspaceFolder, this.OPERATION_QUEUE_FILE);
        this.operationQueueWatcher = vscode.workspace.createFileSystemWatcher(queuePattern);

        this.operationQueueWatcher.onDidChange(async () => {
            try {
                await this.loadOperationQueue();
                // Process new operations
                setTimeout(() => this.processOperations(), 100);
            } catch (error) {
                console.error('Error processing queue changes:', error);
            }
        });

        // Watch for sync state changes
        const syncPattern = new vscode.RelativePattern(workspaceFolder, this.SYNC_STATE_FILE);
        this.syncStateWatcher = vscode.workspace.createFileSystemWatcher(syncPattern);

        this.syncStateWatcher.onDidChange(async () => {
            try {
                await this.loadSyncState();
            } catch (error) {
                console.error('Error loading sync state:', error);
            }
        });
    }

    private startProcessingTimer(): void {
        // Process operations every 5 seconds
        this.processingTimer = setInterval(() => {
            this.processOperations();
        }, 5000);
    }

    private startHeartbeat(): void {
        // Send heartbeat every 30 seconds
        this.heartbeatTimer = setInterval(async () => {
            const heartbeat = McpOperationFactory.createHeartbeatOperation(
                vscode.extensions.getExtension('specforged.vscode-specforged')?.packageJSON?.version
            );

            // Don't queue heartbeat, just update sync state
            this.syncState.lastSync = new Date().toISOString();
            await this.saveSyncState();
        }, 30000);
    }

    private async ensureVscodeDirectory(): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error('No workspace folder found');
        }

        const vscodeDir = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode');
        try {
            await vscode.workspace.fs.createDirectory(vscodeDir);
        } catch (error) {
            // Directory might already exist, that's fine
        }
    }

    private async loadOperationQueue(): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) return;

            const queueFile = vscode.Uri.joinPath(workspaceFolder.uri, this.OPERATION_QUEUE_FILE);
            const content = await vscode.workspace.fs.readFile(queueFile);
            const data = JSON.parse(new TextDecoder().decode(content));

            this.currentQueue = {
                operations: data.operations || [],
                lastProcessed: data.lastProcessed,
                version: data.version || 1
            };

            console.log(`Loaded operation queue with ${this.currentQueue.operations.length} operations`);
        } catch (error) {
            // File doesn't exist or is invalid, start with empty queue
            this.currentQueue = { operations: [], version: 1 };
        }
    }

    private async saveOperationQueue(): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) return;

            const queueFile = vscode.Uri.joinPath(workspaceFolder.uri, this.OPERATION_QUEUE_FILE);
            const content = JSON.stringify(this.currentQueue, null, 2);
            await vscode.workspace.fs.writeFile(queueFile, new TextEncoder().encode(content));
        } catch (error) {
            console.error('Failed to save operation queue:', error);
        }
    }

    private async loadSyncState(): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) return;

            const stateFile = vscode.Uri.joinPath(workspaceFolder.uri, this.SYNC_STATE_FILE);
            const content = await vscode.workspace.fs.readFile(stateFile);
            const data = JSON.parse(new TextDecoder().decode(content));

            this.syncState = {
                extensionOnline: true, // Always true when extension is running
                mcpServerOnline: data.mcpServerOnline || false,
                lastSync: data.lastSync,
                pendingOperations: data.pendingOperations || 0,
                failedOperations: data.failedOperations || 0,
                syncErrors: data.syncErrors || [],
                specifications: data.specifications || []
            };
        } catch (error) {
            // File doesn't exist or is invalid, use default state
        }
    }

    private async saveSyncState(): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) return;

            const stateFile = vscode.Uri.joinPath(workspaceFolder.uri, this.SYNC_STATE_FILE);
            const content = JSON.stringify(this.syncState, null, 2);
            await vscode.workspace.fs.writeFile(stateFile, new TextEncoder().encode(content));
        } catch (error) {
            console.error('Failed to save sync state:', error);
        }
    }

    private async saveOperationResult(result: McpOperationResult): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) return;

            const resultsFile = vscode.Uri.joinPath(workspaceFolder.uri, this.OPERATION_RESULTS_FILE);

            // Load existing results
            let results: McpOperationResult[] = [];
            try {
                const content = await vscode.workspace.fs.readFile(resultsFile);
                const data = JSON.parse(new TextDecoder().decode(content));
                results = data.results || [];
            } catch {
                // File doesn't exist, start with empty array
            }

            // Add new result
            results.push(result);

            // Keep only last 100 results
            if (results.length > 100) {
                results = results.slice(-100);
            }

            // Save
            const content = JSON.stringify({ results, lastUpdated: new Date().toISOString() }, null, 2);
            await vscode.workspace.fs.writeFile(resultsFile, new TextEncoder().encode(content));
        } catch (error) {
            console.error('Failed to save operation result:', error);
        }
    }

    private updateSyncCounters(): void {
        this.syncState.pendingOperations = this.currentQueue.operations.filter(
            op => op.status === McpOperationStatus.PENDING || op.status === McpOperationStatus.IN_PROGRESS
        ).length;

        this.syncState.failedOperations = this.currentQueue.operations.filter(
            op => op.status === McpOperationStatus.FAILED && !McpOperationValidator.canRetry(op)
        ).length;
    }

    async cleanupOldOperations(maxAgeHours: number = 24): Promise<void> {
        const initialCount = this.currentQueue.operations.length;

        this.currentQueue.operations = this.currentQueue.operations.filter(op => {
            // Keep pending and in-progress operations
            if (op.status === McpOperationStatus.PENDING || op.status === McpOperationStatus.IN_PROGRESS) {
                return true;
            }

            // Keep failed operations that can be retried
            if (op.status === McpOperationStatus.FAILED && McpOperationValidator.canRetry(op)) {
                return true;
            }

            // Remove old operations
            return !McpOperationValidator.shouldExpire(op, maxAgeHours);
        });

        if (this.currentQueue.operations.length < initialCount) {
            console.log(`Cleaned up ${initialCount - this.currentQueue.operations.length} old operations`);
            await this.saveOperationQueue();
        }
    }

    getSyncState(): McpSyncState {
        return { ...this.syncState };
    }

    getOperationQueue(): McpOperationQueue {
        return { ...this.currentQueue };
    }

    async notifySpecificationChange(specId: string, changeType: string): Promise<void> {
        // Update sync state with specification changes
        const specIndex = this.syncState.specifications.findIndex(s => s.specId === specId);
        const now = new Date().toISOString();

        if (specIndex >= 0) {
            this.syncState.specifications[specIndex].lastModified = now;
            this.syncState.specifications[specIndex].version++;
        } else {
            this.syncState.specifications.push({
                specId,
                lastModified: now,
                version: 1
            });
        }

        this.syncState.lastSync = now;
        await this.saveSyncState();

        console.log(`Notified specification change: ${specId} (${changeType})`);
    }

    dispose(): void {
        if (this.operationQueueWatcher) {
            this.operationQueueWatcher.dispose();
        }

        if (this.syncStateWatcher) {
            this.syncStateWatcher.dispose();
        }

        if (this.processingTimer) {
            clearInterval(this.processingTimer);
        }

        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }

        // Mark extension as offline
        this.syncState.extensionOnline = false;
        this.saveSyncState().catch(console.error);
    }
}
