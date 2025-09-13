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
    McpOperationUtils,
    McpOperationFactory,
    McpOperationPriority,
    Conflict as McpConflict
} from '../models/mcpOperation';
import { FileOperationService } from './fileOperationService';
import { McpManager } from '../mcp/mcpManager';
import { AtomicFileOperations, AtomicFileOperationError, AtomicFileError, defaultAtomicConfig, AtomicFileConfig } from '../utils/atomicFileOperations';
import { ConflictResolver, Conflict as ResolverConflict } from '../utils/conflictResolver';
import { NotificationManager } from './notificationManager';

export class McpSyncService {
    private fileOperationService: FileOperationService;
    private mcpManager: McpManager | undefined;
    private atomicFileOps: AtomicFileOperations;
    private conflictResolver: ConflictResolver;
    private notificationManager: NotificationManager | undefined;

    // Service state flags
    private isActive = false;
    private isDisposed = false;

    // Disposables for VS Code resources
    private disposables: vscode.Disposable[] = [];

    // File watchers for real-time monitoring
    private operationQueueWatcher: vscode.FileSystemWatcher | undefined;
    private syncStateWatcher: vscode.FileSystemWatcher | undefined;
    private resultsWatcher: vscode.FileSystemWatcher | undefined;

    // Timers for periodic operations
    private processingTimer: NodeJS.Timeout | undefined;
    private heartbeatTimer: NodeJS.Timeout | undefined;
    private cleanupTimer: NodeJS.Timeout | undefined;
    private performanceOptimizationTimer: NodeJS.Timeout | undefined;

    // Performance optimization components
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private operationCache: Map<string, {data: any, timestamp: number, hits: number}> = new Map();
    private operationBatches: Map<string, McpOperation[]> = new Map();
    private processingQueue: McpOperation[] = [];

    // Duplicate operation prevention
    private pendingSignatures: Set<string> = new Set();
    private recentSignatures: Map<string, {timestamp: number, operationId: string}> = new Map();

    // Memory management
    private readonly MAX_CACHE_SIZE = 500;
    private readonly CACHE_TTL_MS = 300000; // 5 minutes
    private readonly DEBOUNCE_DELAY_MS = 250;
    private readonly MAX_BATCH_SIZE = 50;
    private readonly BATCH_TIMEOUT_MS = 1000;
    private readonly SIGNATURE_TTL_MS = 10000; // 10 seconds for recent signatures

    // File paths (workspace-relative, under .vscode)
    private readonly OPERATION_QUEUE_FILE = '.vscode/mcp-operations.json';
    private readonly SYNC_STATE_FILE = '.vscode/specforge-sync.json';
    private readonly OPERATION_RESULTS_FILE = '.vscode/mcp-results.json';

    // Current state
    private currentQueue: McpOperationQueue = McpOperationUtils.createEmptyQueue();
    private syncState: McpSyncState = McpOperationUtils.createEmptySyncState();

    // Processing control
    private isProcessing = false;
    private isInitialized = false;

    // Enhanced configuration with performance options
    private readonly config = {
        processingIntervalMs: 5000,      // Process operations every 5 seconds
        heartbeatIntervalMs: 30000,      // Send heartbeat every 30 seconds
        cleanupIntervalMs: 3600000,      // Cleanup every hour
        maxOperationAge: 24,             // Max age in hours before cleanup
        maxQueueSize: 1000,              // Maximum operations in queue
        priorityProcessingEnabled: true,  // Enable priority-based processing
        conflictDetectionEnabled: true,   // Enable conflict detection
        retryFailedOperations: true,     // Enable automatic retry of failed operations

        // Performance optimization settings
        enableBatchProcessing: true,     // Enable operation batching
        enableFileWatcherDebouncing: true, // Enable file watcher debouncing
        enableOperationCaching: true,    // Enable operation result caching
        enableMemoryOptimization: true,  // Enable memory optimization
        maxMemoryUsageMB: 100,          // Maximum memory usage in MB
        performanceOptimizationIntervalMs: 300000, // Run optimization every 5 minutes
        enableCompressionThreshold: 100, // Enable compression for queues over 100 operations
        streamingThresholdKB: 1024,     // Use streaming for files over 1MB
    };

    constructor(fileOperationService: FileOperationService) {
        this.fileOperationService = fileOperationService;
        // Read backup settings from VS Code configuration
        const cfg = vscode.workspace.getConfiguration('specforged');
        const backupEnabled = cfg.get<boolean>('fileOps.backupEnabled', defaultAtomicConfig.backupEnabled);
        const maxBackups = cfg.get<number>('fileOps.maxBackups', defaultAtomicConfig.maxBackups);
        const atomicConfig: AtomicFileConfig = {
            ...defaultAtomicConfig,
            backupEnabled,
            maxBackups
        };
        this.atomicFileOps = new AtomicFileOperations(atomicConfig);
        this.conflictResolver = new ConflictResolver();
    }

    setMcpManager(mcpManager: McpManager): void {
        this.mcpManager = mcpManager;
    }

    setNotificationManager(notificationManager: NotificationManager): void {
        this.notificationManager = notificationManager;
    }

    isServiceInitialized(): boolean {
        return this.isInitialized;
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) {
            console.warn('MCP Sync Service already initialized');
            return;
        }

        try {
            // Validate workspace - gracefully handle missing workspace
            try {
                const workspacePath = this.getWorkspacePath();
                await this.atomicFileOps.validateWorkspace(workspacePath);
                this.isActive = true;
            } catch (error) {
                if (error instanceof AtomicFileOperationError && error.errorType === AtomicFileError.WORKSPACE_INVALID) {
                    console.warn(`SpecForged Sync Service disabled: ${error.message}`);
                    this.isInitialized = true; // Mark as initialized but inactive
                    this.isActive = false;
                    return;
                }
                throw error; // Re-throw unexpected errors
            }

            // Load existing state using atomic operations
            await this.loadOperationQueue();
            await this.loadSyncState();

            // Setup file watchers for real-time monitoring
            this.setupFileWatchers();

            // Start periodic operations
            this.startProcessingTimer();
            this.startHeartbeat();
            this.startCleanupTimer();

            // Start performance optimization if enabled
            if (this.config.enableMemoryOptimization) {
                this.startPerformanceOptimization();
            }

            // Update sync state to indicate extension is online
            this.syncState.extensionOnline = true;
            this.syncState.lastSync = new Date().toISOString();
            await this.saveSyncState();

            this.isInitialized = true;
            console.log('MCP Sync Service initialized successfully');
        } catch (error) {
            console.error('Failed to initialize MCP Sync Service:', error);

            // Show user-friendly error message
            if (error instanceof AtomicFileOperationError) {
                vscode.window.showErrorMessage(
                    `MCP Sync Service initialization failed: ${error.getUserMessage()}`,
                    ...error.getRecoverySuggestions()
                );
            } else {
                vscode.window.showErrorMessage(
                    'MCP Sync Service initialization failed. Please check the workspace and try again.'
                );
            }
            throw error;
        }
    }

    async queueOperation(operation: McpOperation): Promise<void> {
        if (!this.isInitialized || !this.isActive || this.isDisposed) {
            throw new Error('MCP Sync Service not available');
        }

        const signature = this.getOperationSignature(operation);

        try {
            // Check for duplicate operations
            if (this.pendingSignatures.has(signature)) {
                console.warn(`Duplicate operation detected and throttled: ${operation.type} for ${this.getResourcePath(operation)}`);
                return;
            }

            // Check recent signatures to avoid rapid duplicates
            const recent = this.recentSignatures.get(signature);
            if (recent && (Date.now() - recent.timestamp) < this.SIGNATURE_TTL_MS) {
                console.warn(`Recent duplicate operation blocked: ${operation.type} (was ${recent.operationId})`);
                return;
            }

            // Mark signature as pending
            this.pendingSignatures.add(signature);
            this.recentSignatures.set(signature, {
                timestamp: Date.now(),
                operationId: operation.id
            });

            // Validate operation
            const validation = McpOperationValidator.validateOperation(operation);
            if (!validation.valid) {
                throw new Error(`Invalid operation: ${validation.errors.join(', ')}`);
            }

            // Log warnings if any
            if (validation.warnings.length > 0) {
                console.warn(`Operation warnings: ${validation.warnings.join(', ')}`);
            }

            // Check queue size limit
            if (this.currentQueue.operations.length >= this.config.maxQueueSize) {
                // Remove old completed operations to make space
                await this.cleanupOldOperations(1); // Cleanup operations older than 1 hour

                if (this.currentQueue.operations.length >= this.config.maxQueueSize) {
                    throw new Error('Operation queue is full. Please wait for operations to complete.');
                }
            }

            // Detect conflicts if enabled
            if (this.config.conflictDetectionEnabled) {
                const resolverConflict = await this.conflictResolver.detectConflict(operation, this.currentQueue.operations);
                if (resolverConflict) {
                    // Convert resolver conflict to MCP conflict format
                    const mcpConflict: McpConflict = {
                        id: resolverConflict.id,
                        type: resolverConflict.type as any, // Type conversion needed
                        operationIds: resolverConflict.operations.map(op => op.id),
                        resourcePath: this.getResourcePath(operation),
                        description: resolverConflict.description,
                        detectedAt: resolverConflict.timestamp,
                        resolutionStrategy: undefined,
                        resolvedAt: resolverConflict.resolvedAt,
                        resolvedBy: resolverConflict.resolvedBy,
                        metadata: {}
                    };

                    this.currentQueue.conflicts.push(mcpConflict);
                    operation.conflictIds = [resolverConflict.id];

                    console.warn(`Conflict detected for operation ${operation.id}: ${resolverConflict.description}`);

                    // Try to auto-resolve the conflict
                    const resolved = await this.conflictResolver.resolveConflict(resolverConflict.id);
                    if (!resolved) {
                        // Use notification manager if available, otherwise fallback to VS Code API
                        if (this.notificationManager) {
                            await this.notificationManager.showConflictNotification(
                                resolverConflict.id,
                                resolverConflict.description,
                                resolverConflict.operations.map(op => op.id)
                            );
                        } else {
                            // Fallback to direct VS Code notification
                            vscode.window.showWarningMessage(
                                `Operation conflict detected: ${resolverConflict.description}`,
                                'View Conflicts'
                            ).then(selection => {
                                if (selection === 'View Conflicts') {
                                    vscode.commands.executeCommand('specforged.showOperationQueue');
                                }
                            });
                        }
                    }
                }
            }

            // Add to queue with priority handling
            if (this.config.priorityProcessingEnabled) {
                this.insertOperationByPriority(operation);
            } else {
                this.currentQueue.operations.push(operation);
            }

            // Update queue metadata
            this.currentQueue.version++;
            this.currentQueue.lastModified = new Date().toISOString();

            // Update sync state counters
            this.updateSyncCounters();

            // Save queue and sync state atomically
            await this.saveOperationQueue();
            await this.saveSyncState();

            console.log(`Queued operation: ${operation.type} (${operation.id}) with priority ${operation.priority}`);

            // Trigger immediate processing for high priority operations
            if (operation.priority >= McpOperationPriority.HIGH) {
                setTimeout(() => this.processOperations(), 100);
            }

        } catch (error) {
            console.error(`Failed to queue operation ${operation.id}:`, error);

            if (error instanceof AtomicFileOperationError) {
                vscode.window.showErrorMessage(
                    `Failed to queue operation: ${error.getUserMessage()}`
                );
            }

            throw error;
        } finally {
            // Always remove from pending signatures when done (success or failure)
            this.pendingSignatures.delete(signature);

            // Cleanup old signatures periodically
            this.cleanupOldSignatures();
        }
    }

    /**
     * Generate a signature for an operation to detect duplicates.
     */
    private getOperationSignature(operation: McpOperation): string {
        // Create signature based on operation type, resource path, and key parameters
        const resourcePath = this.getResourcePath(operation);
        const keyParams = this.getKeyParameters(operation);

        return `${operation.type}:${resourcePath}:${JSON.stringify(keyParams)}`;
    }

    /**
     * Get the resource path for an operation.
     */
    private getResourcePath(operation: McpOperation): string {
        // Extract resource path from operation parameters
        const params = operation.params as any;
        if (params?.specId) {
            return `spec:${params.specId}`;
        }
        if (params?.filePath) {
            return `file:${params.filePath}`;
        }
        if (params?.resourceId) {
            return `resource:${params.resourceId}`;
        }
        return `operation:${operation.type}`;
    }

    /**
     * Get key parameters for signature generation, excluding timestamps and IDs.
     */
    private getKeyParameters(operation: McpOperation): any {
        const params = { ...operation.params } as any;

        // Remove non-content parameters that shouldn't affect uniqueness
        delete params.timestamp;
        delete params.operationId;
        delete params.requestId;
        delete params.clientId;

        // For content-based operations, hash large content to avoid huge signatures
        if (params.content && typeof params.content === 'string' && params.content.length > 1000) {
            // Simple hash of content for signature
            let hash = 0;
            for (let i = 0; i < params.content.length; i++) {
                const char = params.content.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash; // Convert to 32-bit integer
            }
            params.contentHash = hash.toString(36);
            delete params.content;
        }

        return params;
    }

    /**
     * Clean up old signatures to prevent memory leaks.
     */
    private cleanupOldSignatures(): void {
        const now = Date.now();
        const cutoffTime = now - this.SIGNATURE_TTL_MS;

        // Clean up recent signatures that are too old
        for (const [signature, data] of this.recentSignatures.entries()) {
            if (data.timestamp < cutoffTime) {
                this.recentSignatures.delete(signature);
            }
        }

        // Periodically clean pending signatures (safety net - should be cleaned by finally blocks)
        if (this.pendingSignatures.size > 100) {
            console.warn(`High number of pending signatures detected: ${this.pendingSignatures.size}. This may indicate cleanup issues.`);
        }
    }

    async processOperations(): Promise<void> {
        if (this.isProcessing || !this.isInitialized || !this.isActive || this.isDisposed) {
            return;
        }

        this.isProcessing = true;
        const processingStartTime = Date.now();

        try {
            // Get operations ready for processing
            const readyOperations = this.getOperationsReadyForProcessing();

            if (readyOperations.length === 0) {
                return;
            }

            console.log(`Processing ${readyOperations.length} operations`);

            // Process operations with dependency resolution
            const processedCount = await this.processOperationsWithDependencies(readyOperations);

            // Handle failed operations with retry logic
            if (this.config.retryFailedOperations) {
                await this.handleFailedOperations();
            }

            // Update processing statistics
            const processingDuration = Date.now() - processingStartTime;
            this.updateProcessingStats(processedCount, processingDuration);

            // Update sync state
            this.updateSyncCounters();
            await this.saveSyncState();

            if (processedCount > 0) {
                console.log(`Processed ${processedCount} operations in ${processingDuration}ms`);
            }

        } catch (error) {
            console.error('Error during operation processing:', error);

            // Record sync error
            this.syncState.syncErrors.push({
                timestamp: new Date().toISOString(),
                error: error instanceof Error ? error.message : 'Unknown processing error'
            });

            // Keep only last 10 errors
            if (this.syncState.syncErrors.length > 10) {
                this.syncState.syncErrors = this.syncState.syncErrors.slice(-10);
            }

            await this.saveSyncState();
        } finally {
            this.isProcessing = false;
        }
    }

    private async processOperation(operation: McpOperation): Promise<void> {
        console.log(`Processing operation: ${operation.type} (${operation.id})`);

        // Check cache first if caching is enabled
        const cacheKey = this.getOperationCacheKey(operation);
        const cachedResult = this.getCachedOperation(cacheKey);

        if (cachedResult) {
            console.log(`Using cached result for operation: ${operation.id}`);
            operation.status = McpOperationStatus.COMPLETED;
            operation.result = cachedResult;
            operation.completedAt = new Date().toISOString();
            operation.actualDurationMs = 0; // Cached operations are instant
            await this.saveOperationQueue();
            return;
        }

        operation.status = McpOperationStatus.IN_PROGRESS;
        operation.startedAt = new Date().toISOString();
        await this.saveOperationQueue();

        // Show progress notification for long-running operations
        if (this.notificationManager && operation.estimatedDurationMs && operation.estimatedDurationMs > 2000) {
            await this.notificationManager.showOperationProgressNotification(operation, 0, 'Starting operation...');
        }

        let result: any;
        let success = false;
        const startTime = Date.now();

        try {
            // Update progress for estimated operations
            if (this.notificationManager && operation.estimatedDurationMs && operation.estimatedDurationMs > 2000) {
                await this.notificationManager.showOperationProgressNotification(operation, 25, 'Processing...');
            }

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
            operation.actualDurationMs = Date.now() - startTime;

            // Cache successful results
            if (success && this.config.enableOperationCaching) {
                this.cacheOperationResult(cacheKey, result);
            }

            // Update progress to completion
            if (this.notificationManager && operation.estimatedDurationMs && operation.estimatedDurationMs > 2000) {
                await this.notificationManager.showOperationProgressNotification(operation, 100, 'Completed');
            }

            // Show success notification
            if (success && this.notificationManager) {
                await this.notificationManager.showOperationSuccessNotification(operation, {
                    operationId: operation.id,
                    success: true,
                    message: result?.message || 'Operation completed successfully',
                    data: result?.data,
                    timestamp: new Date().toISOString(),
                    processingTimeMs: operation.actualDurationMs,
                    retryable: false
                });
            }

        } catch (error) {
            operation.status = McpOperationStatus.FAILED;
            operation.error = error instanceof Error ? error.message : 'Unknown error';
            operation.actualDurationMs = Date.now() - startTime;

            // Show failure notification
            if (this.notificationManager) {
                await this.notificationManager.showOperationFailureNotification(
                    operation,
                    operation.error
                );
            }

            throw error;
        }

        // Save result for MCP server to read
        await this.saveOperationResult({
            operationId: operation.id,
            success,
            message: result?.message || (success ? 'Operation completed' : 'Operation failed'),
            data: result?.data,
            error: operation.error ? {
                code: 'OPERATION_ERROR',
                message: operation.error,
                details: null
            } : undefined,
            timestamp: new Date().toISOString(),
            processingTimeMs: operation.actualDurationMs || 0,
            retryable: McpOperationValidator.canRetry(operation)
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
            console.warn('No workspace folder found for file watchers');
            return;
        }

        try {
            // Watch for operation queue changes (MCP server adding operations)
            const queuePattern = new vscode.RelativePattern(workspaceFolder, this.OPERATION_QUEUE_FILE);
            this.operationQueueWatcher = vscode.workspace.createFileSystemWatcher(queuePattern);
            this.disposables.push(this.operationQueueWatcher);

            // Enhanced file watcher with debouncing
            this.disposables.push(this.operationQueueWatcher.onDidChange(() => {
                this.debouncedHandler('queue-change', async () => {
                    try {
                        console.log('Operation queue file changed, reloading...');
                        await this.loadOperationQueue();
                        // Process new operations with optimized batching
                        this.scheduleOperationProcessing();
                    } catch (error) {
                        console.error('Error processing queue changes:', error);
                        this.recordSyncError('Failed to process queue changes', error);
                    }
                });
            }));

            this.disposables.push(this.operationQueueWatcher.onDidCreate(() => {
                this.debouncedHandler('queue-create', async () => {
                    console.log('Operation queue file created');
                    await this.loadOperationQueue();
                });
            }));

            this.disposables.push(this.operationQueueWatcher.onDidDelete(() => {
                // No debouncing needed for delete - immediate response required
                console.log('Operation queue file deleted, reinitializing...');
                this.currentQueue = McpOperationUtils.createEmptyQueue();
            }));

            // Watch for sync state changes with debouncing
            const syncPattern = new vscode.RelativePattern(workspaceFolder, this.SYNC_STATE_FILE);
            this.syncStateWatcher = vscode.workspace.createFileSystemWatcher(syncPattern);
            this.disposables.push(this.syncStateWatcher);

            this.disposables.push(this.syncStateWatcher.onDidChange(() => {
                this.debouncedHandler('sync-state-change', async () => {
                    try {
                        await this.loadSyncState();
                    } catch (error) {
                        console.error('Error loading sync state:', error);
                        this.recordSyncError('Failed to load sync state', error);
                    }
                });
            }));

            // Watch for operation results changes with debouncing
            const resultsPattern = new vscode.RelativePattern(workspaceFolder, this.OPERATION_RESULTS_FILE);
            this.resultsWatcher = vscode.workspace.createFileSystemWatcher(resultsPattern);
            this.disposables.push(this.resultsWatcher);

            this.disposables.push(this.resultsWatcher.onDidChange(() => {
                this.debouncedHandler('results-change', async () => {
                    try {
                        console.log('Operation results file changed, processing results...');
                        await this.processOperationResults();
                    } catch (error) {
                        console.error('Error processing operation results:', error);
                        this.recordSyncError('Failed to process operation results', error);
                    }
                });
            }));

            console.log('File watchers set up successfully');
        } catch (error) {
            console.error('Failed to setup file watchers:', error);
            throw error;
        }
    }

    private startProcessingTimer(): void {
        if (this.processingTimer) {
            clearInterval(this.processingTimer);
        }

        this.processingTimer = setInterval(() => {
            this.processOperations().catch(error => {
                console.error('Error in processing timer:', error);
            });
        }, this.config.processingIntervalMs);

        console.log(`Processing timer started (interval: ${this.config.processingIntervalMs}ms)`);
    }

    private startHeartbeat(): void {
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }

        this.heartbeatTimer = setInterval(async () => {
            try {
                await this.sendHeartbeat();
            } catch (error) {
                console.error('Error in heartbeat timer:', error);
                this.recordSyncError('Heartbeat failed', error);
            }
        }, this.config.heartbeatIntervalMs);

        console.log(`Heartbeat timer started (interval: ${this.config.heartbeatIntervalMs}ms)`);
    }

    private startCleanupTimer(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
        }

        this.cleanupTimer = setInterval(async () => {
            try {
                await this.performMaintenance();
            } catch (error) {
                console.error('Error in cleanup timer:', error);
            }
        }, this.config.cleanupIntervalMs);

        console.log(`Cleanup timer started (interval: ${this.config.cleanupIntervalMs}ms)`);
    }

    private startPerformanceOptimization(): void {
        if (this.performanceOptimizationTimer) {
            clearInterval(this.performanceOptimizationTimer);
        }

        this.performanceOptimizationTimer = setInterval(async () => {
            try {
                await this.performMemoryOptimization();
            } catch (error) {
                console.error('Error in performance optimization:', error);
            }
        }, this.config.performanceOptimizationIntervalMs);

        console.log(`Performance optimization timer started (interval: ${this.config.performanceOptimizationIntervalMs}ms)`);
    }

    /**
     * Debounced handler to prevent excessive file watcher events
     */
    private debouncedHandler(key: string, handler: () => Promise<void>): void {
        if (!this.config.enableFileWatcherDebouncing) {
            // Execute immediately if debouncing is disabled
            handler().catch(error => console.error(`Handler error for ${key}:`, error));
            return;
        }

        // Clear existing timer for this key
        const existingTimer = this.debounceTimers.get(key);
        if (existingTimer) {
            clearTimeout(existingTimer);
        }

        // Set new timer
        const timer = setTimeout(() => {
            this.debounceTimers.delete(key);
            handler().catch(error => console.error(`Debounced handler error for ${key}:`, error));
        }, this.DEBOUNCE_DELAY_MS);

        this.debounceTimers.set(key, timer);
    }

    /**
     * Schedule operation processing with intelligent batching
     */
    private scheduleOperationProcessing(): void {
        if (!this.config.enableBatchProcessing) {
            // Process immediately if batching is disabled
            setTimeout(() => this.processOperations(), 100);
            return;
        }

        // Use debounced processing for better batching
        this.debouncedHandler('operation-processing', async () => {
            await this.processOperations();
        });
    }

    /**
     * Enhanced memory optimization with caching and cleanup
     */
    private async performMemoryOptimization(): Promise<void> {
        const memoryBefore = process.memoryUsage();
        let optimizationsPerformed = 0;

        try {
            // Clean up expired cache entries
            const expiredCacheCount = this.cleanupOperationCache();
            if (expiredCacheCount > 0) {
                optimizationsPerformed++;
                console.log(`Cleaned up ${expiredCacheCount} expired cache entries`);
            }

            // Clean up completed debounce timers
            const activeTimers = this.debounceTimers.size;

            // Compress operation queue if it's large
            if (this.currentQueue.operations.length > this.config.enableCompressionThreshold) {
                await this.compressOperationQueue();
                optimizationsPerformed++;
            }

            // Force garbage collection if memory usage is high
            const heapUsedMB = memoryBefore.heapUsed / 1024 / 1024;
            if (heapUsedMB > this.config.maxMemoryUsageMB) {
                if (global.gc) {
                    global.gc();
                    optimizationsPerformed++;
                    console.log(`Forced garbage collection due to high memory usage: ${heapUsedMB.toFixed(1)}MB`);
                }
            }

            if (optimizationsPerformed > 0) {
                const memoryAfter = process.memoryUsage();
                const memoryFreedMB = (memoryBefore.heapUsed - memoryAfter.heapUsed) / 1024 / 1024;
                console.log(`Memory optimization completed: ${optimizationsPerformed} operations, ${memoryFreedMB.toFixed(1)}MB freed`);
            }

        } catch (error) {
            console.error('Memory optimization failed:', error);
        }
    }

    /**
     * Clean up expired operation cache entries
     */
    private cleanupOperationCache(): number {
        const now = Date.now();
        let expiredCount = 0;

        for (const [key, entry] of this.operationCache.entries()) {
            if (now - entry.timestamp > this.CACHE_TTL_MS) {
                this.operationCache.delete(key);
                expiredCount++;
            }
        }

        // Also enforce max cache size by removing least recently used entries
        if (this.operationCache.size > this.MAX_CACHE_SIZE) {
            const sortedEntries = Array.from(this.operationCache.entries())
                .sort(([, a], [, b]) => a.hits - b.hits); // Sort by hits (LRU approximation)

            const entriesToRemove = this.operationCache.size - this.MAX_CACHE_SIZE;
            for (let i = 0; i < entriesToRemove; i++) {
                this.operationCache.delete(sortedEntries[i][0]);
                expiredCount++;
            }
        }

        return expiredCount;
    }

    /**
     * Compress operation queue by removing completed operations
     */
    private async compressOperationQueue(): Promise<void> {
        const initialSize = this.currentQueue.operations.length;

        // Keep only recent completed operations and all non-completed operations
        const cutoffTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago

        this.currentQueue.operations = this.currentQueue.operations.filter(op => {
            if (op.status === McpOperationStatus.COMPLETED) {
                return op.completedAt && op.completedAt > cutoffTime;
            }
            return true; // Keep all non-completed operations
        });

        const compressionRatio = (initialSize - this.currentQueue.operations.length) / initialSize;
        if (compressionRatio > 0.1) { // Only save if we compressed by more than 10%
            await this.saveOperationQueue();
            console.log(`Compressed operation queue: ${initialSize} → ${this.currentQueue.operations.length} operations (${(compressionRatio * 100).toFixed(1)}% reduction)`);
        }
    }

    /**
     * Get cached operation result
     */
    private getCachedOperation(operationKey: string): any | null {
        if (!this.config.enableOperationCaching) {
            return null;
        }

        const cached = this.operationCache.get(operationKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
            cached.hits++;
            return cached.data;
        }

        return null;
    }

    /**
     * Cache operation result
     */
    private cacheOperationResult(operationKey: string, data: any): void {
        if (!this.config.enableOperationCaching) {
            return;
        }

        // Ensure we don't exceed cache size
        if (this.operationCache.size >= this.MAX_CACHE_SIZE) {
            // Remove oldest entry
            const oldestKey = this.operationCache.keys().next().value;
            if (oldestKey) {
                this.operationCache.delete(oldestKey);
            }
        }

        this.operationCache.set(operationKey, {
            data,
            timestamp: Date.now(),
            hits: 0
        });
    }

    /**
     * Generate cache key for operation
     */
    private getOperationCacheKey(operation: McpOperation): string {
        const params = JSON.stringify(operation.params || {}, Object.keys(operation.params || {}).sort());
        return `${operation.type}:${params}`;
    }



    private async loadOperationQueue(): Promise<void> {
        if (!this.isActive) {return;}

        try {
            const workspacePath = this.getWorkspacePath();
            this.currentQueue = await this.atomicFileOps.readOperationQueue(workspacePath);

            console.log(`Loaded operation queue with ${this.currentQueue.operations.length} operations, ${this.currentQueue.conflicts.length} conflicts`);
        } catch (error) {
            if (error instanceof AtomicFileOperationError && error.errorType === AtomicFileError.FILE_NOT_FOUND) {
                // File doesn't exist, start with empty queue
                this.currentQueue = McpOperationUtils.createEmptyQueue();
                console.log('Operation queue file not found, starting with empty queue');
            } else {
                console.error('Failed to load operation queue:', error);
                // Try to recover by creating empty queue
                this.currentQueue = McpOperationUtils.createEmptyQueue();
                this.recordSyncError('Failed to load operation queue', error);
            }
        }
    }

    private async saveOperationQueue(): Promise<void> {
        if (!this.isActive || this.isDisposed) {return;}

        try {
            const workspacePath = this.getWorkspacePath();
            await this.atomicFileOps.writeOperationQueue(workspacePath, this.currentQueue);
        } catch (error) {
            console.error('Failed to save operation queue:', error);
            this.recordSyncError('Failed to save operation queue', error);

            if (error instanceof AtomicFileOperationError) {
                vscode.window.showErrorMessage(
                    `Failed to save operation queue: ${error.getUserMessage()}`
                );
            }
            throw error;
        }
    }

    private async loadSyncState(): Promise<void> {
        if (!this.isActive) {return;}

        try {
            const workspacePath = this.getWorkspacePath();
            const loadedState = await this.atomicFileOps.readSyncState(workspacePath);

            // Merge with current state, preserving extension online status
            this.syncState = {
                ...loadedState,
                extensionOnline: true // Always true when extension is running
            };

            console.log('Loaded sync state successfully');
        } catch (error) {
            if (error instanceof AtomicFileOperationError && error.errorType === AtomicFileError.FILE_NOT_FOUND) {
                // File doesn't exist, use default state
                this.syncState = McpOperationUtils.createEmptySyncState();
                this.syncState.extensionOnline = true;
                console.log('Sync state file not found, using default state');
            } else {
                console.error('Failed to load sync state:', error);
                this.recordSyncError('Failed to load sync state', error);
            }
        }
    }

    private async saveSyncState(): Promise<void> {
        if (!this.isInitialized || this.isDisposed) {return;}

        try {
            const workspacePath = this.getWorkspacePath();
            await this.atomicFileOps.writeSyncState(workspacePath, this.syncState);
        } catch (error) {
            // Avoid logging if workspace is invalid or service is disposed, as it's expected
            if (!(error instanceof AtomicFileOperationError && error.errorType === AtomicFileError.WORKSPACE_INVALID) && !this.isDisposed) {
                console.error('Failed to save sync state:', error);
                if (error instanceof AtomicFileOperationError) {
                    vscode.window.showErrorMessage(
                        `Failed to save sync state: ${error.getUserMessage()}`
                    );
                }
            }
        }
    }

    private async saveOperationResult(result: McpOperationResult): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {return;}

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
            op => op.status === McpOperationStatus.PENDING
        ).length;

        this.syncState.inProgressOperations = this.currentQueue.operations.filter(
            op => op.status === McpOperationStatus.IN_PROGRESS
        ).length;

        this.syncState.failedOperations = this.currentQueue.operations.filter(
            op => op.status === McpOperationStatus.FAILED && !McpOperationValidator.canRetry(op)
        ).length;

        this.syncState.completedOperations = this.currentQueue.operations.filter(
            op => op.status === McpOperationStatus.COMPLETED
        ).length;

        this.syncState.activeConflicts = this.currentQueue.conflicts.filter(
            conflict => !conflict.resolvedAt
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

        // Also cleanup old conflicts
        const initialConflictCount = this.currentQueue.conflicts.length;
        await this.conflictResolver.cleanupResolvedConflicts(maxAgeHours);

        // Convert resolver conflicts back to MCP conflicts
        const activeResolverConflicts = this.conflictResolver.getActiveConflicts();
        this.currentQueue.conflicts = activeResolverConflicts.map(resolverConflict => ({
            id: resolverConflict.id,
            type: resolverConflict.type as any,
            operationIds: resolverConflict.operations.map(op => op.id),
            resourcePath: '',
            description: resolverConflict.description,
            detectedAt: resolverConflict.timestamp,
            resolutionStrategy: undefined,
            resolvedAt: resolverConflict.resolvedAt,
            resolvedBy: resolverConflict.resolvedBy,
            metadata: {}
        }));

        const operationsRemoved = initialCount - this.currentQueue.operations.length;
        const conflictsRemoved = initialConflictCount - this.currentQueue.conflicts.length;

        if (operationsRemoved > 0 || conflictsRemoved > 0) {
            console.log(`Cleaned up ${operationsRemoved} old operations and ${conflictsRemoved} old conflicts`);
            await this.saveOperationQueue();
        }
    }

    // New helper methods for enhanced functionality

    private getWorkspacePath(): string {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new AtomicFileOperationError(
                AtomicFileError.WORKSPACE_INVALID,
                'No workspace folder is open. Please open a folder or workspace to use SpecForged sync features.',
                '',
                undefined,
                false
            );
        }
        return workspaceFolder.uri.fsPath;
    }

    private insertOperationByPriority(operation: McpOperation): void {
        // Insert operation in priority order (higher priority first)
        let insertIndex = this.currentQueue.operations.length;

        for (let i = 0; i < this.currentQueue.operations.length; i++) {
            if (this.currentQueue.operations[i].priority < operation.priority) {
                insertIndex = i;
                break;
            }
        }

        this.currentQueue.operations.splice(insertIndex, 0, operation);
    }

    private getOperationsReadyForProcessing(): McpOperation[] {
        const now = Date.now();

        return this.currentQueue.operations
            .filter(op => {
                // Must be pending
                if (op.status !== McpOperationStatus.PENDING) {
                    return false;
                }

                // Check if retry time has passed
                if (op.nextRetryAt && new Date(op.nextRetryAt).getTime() > now) {
                    return false;
                }

                // Check if dependencies are satisfied
                if (op.dependencies && op.dependencies.length > 0) {
                    const dependenciesSatisfied = op.dependencies.every(depId => {
                        const depOp = this.currentQueue.operations.find(o => o.id === depId);
                        return !depOp || depOp.status === McpOperationStatus.COMPLETED;
                    });
                    if (!dependenciesSatisfied) {
                        return false;
                    }
                }

                // Check if operation has unresolved conflicts
                if (op.conflictIds && op.conflictIds.length > 0) {
                    const hasUnresolvedConflicts = op.conflictIds.some(conflictId => {
                        const conflict = this.conflictResolver.getConflictById(conflictId);
                        return conflict && !conflict.resolved;
                    });
                    if (hasUnresolvedConflicts) {
                        return false;
                    }
                }

                return true;
            })
            .sort((a, b) => {
                // Sort by priority (higher first), then by timestamp (older first)
                if (a.priority !== b.priority) {
                    return b.priority - a.priority;
                }
                return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
            });
    }

    private async processOperationsWithDependencies(operations: McpOperation[]): Promise<number> {
        let processedCount = 0;

        for (const operation of operations) {
            try {
                await this.processOperation(operation);
                processedCount++;

                // Save progress after each operation
                await this.saveOperationQueue();

            } catch (error) {
                console.error(`Failed to process operation ${operation.id}:`, error);

                operation.status = McpOperationStatus.FAILED;
                operation.error = error instanceof Error ? error.message : 'Unknown error';
                operation.retryCount++;

                // Calculate next retry time if retries are available
                if (McpOperationValidator.canRetry(operation)) {
                    operation.nextRetryAt = McpOperationFactory.calculateNextRetryTime(operation.retryCount);
                    console.log(`Operation ${operation.id} will retry at ${operation.nextRetryAt}`);
                } else {
                    console.log(`Operation ${operation.id} has exceeded max retries`);
                }

                // Record error in sync state
                this.recordSyncError(`Operation ${operation.id} failed`, error);
            }
        }

        return processedCount;
    }

    private async handleFailedOperations(): Promise<void> {
        const failedOperations = this.currentQueue.operations.filter(op =>
            op.status === McpOperationStatus.FAILED && McpOperationValidator.shouldRetry(op)
        );

        for (const operation of failedOperations) {
            operation.status = McpOperationStatus.PENDING;
            operation.error = undefined;
            console.log(`Retrying failed operation ${operation.id} (attempt ${operation.retryCount + 1})`);
        }

        if (failedOperations.length > 0) {
            await this.saveOperationQueue();
        }
    }

    private updateProcessingStats(processedCount: number, processingDuration: number): void {
        const stats = this.currentQueue.processingStats;

        stats.totalProcessed += processedCount;

        if (processedCount > 0) {
            // Update average processing time
            const totalTime = (stats.averageProcessingTimeMs * (stats.totalProcessed - processedCount)) + processingDuration;
            stats.averageProcessingTimeMs = totalTime / stats.totalProcessed;
        }

        // Update performance metrics in sync state
        this.syncState.performance.lastProcessingDuration = processingDuration;
        this.syncState.performance.averageOperationTimeMs = stats.averageProcessingTimeMs;

        // Calculate processing rate (operations per minute)
        if (processingDuration > 0) {
            this.syncState.performance.queueProcessingRate = (processedCount / processingDuration) * 60000;
        }
    }

    private async sendHeartbeat(): Promise<void> {
        const extensionInfo = vscode.extensions.getExtension('specforged.vscode-specforged');
        const workspacePath = this.getWorkspacePath();

        const heartbeat = McpOperationFactory.createHeartbeatOperation(
            extensionInfo?.packageJSON?.version,
            undefined, // MCP server version will be filled by server
            {
                rootPath: workspacePath,
                specCount: this.syncState.specifications.length
            }
        );

        // Update sync state with heartbeat info
        this.syncState.lastHeartbeat = new Date().toISOString();
        this.syncState.lastSync = new Date().toISOString();

        // Queue heartbeat operation for MCP server to process
        await this.queueOperation(heartbeat);
    }

    private async performMaintenance(): Promise<void> {
        console.log('Performing maintenance tasks...');

        try {
            // Cleanup old operations and conflicts
            await this.cleanupOldOperations(this.config.maxOperationAge);

            // Cleanup temporary files
            const workspacePath = this.getWorkspacePath();
            await this.atomicFileOps.cleanup(workspacePath);

            // Update sync state
            this.updateSyncCounters();
            await this.saveSyncState();

            console.log('Maintenance completed successfully');
        } catch (error) {
            console.error('Error during maintenance:', error);
            this.recordSyncError('Maintenance failed', error);
        }
    }

    private async processOperationResults(): Promise<void> {
        try {
            const workspacePath = this.getWorkspacePath();
            const resultsData = await this.atomicFileOps.readOperationResults(workspacePath);

            // Process each result
            for (const result of resultsData.results) {
                const operation = this.currentQueue.operations.find(op => op.id === result.operationId);
                if (operation) {
                    // Update operation with result
                    operation.status = result.success ? McpOperationStatus.COMPLETED : McpOperationStatus.FAILED;
                    operation.result = result.data;
                    operation.completedAt = result.timestamp;
                    operation.actualDurationMs = result.processingTimeMs;

                    if (!result.success && result.error) {
                        operation.error = result.error.message;
                    }

                    // Handle conflicts if detected
                    if (result.conflictsDetected && result.conflictsDetected.length > 0) {
                        this.currentQueue.conflicts.push(...result.conflictsDetected);
                        operation.conflictIds = result.conflictsDetected.map(c => c.id);
                    }

                    console.log(`Updated operation ${operation.id} with result: ${result.success ? 'success' : 'failed'}`);
                }
            }

            // Save updated queue
            await this.saveOperationQueue();

            // Clear processed results (keep only unprocessed ones)
            const processedIds = resultsData.results.map(r => r.operationId);
            const remainingResults = resultsData.results.filter(r =>
                !this.currentQueue.operations.some(op => op.id === r.operationId)
            );

            if (remainingResults.length !== resultsData.results.length) {
                await this.atomicFileOps.writeOperationResults(workspacePath, {
                    results: remainingResults,
                    lastUpdated: new Date().toISOString()
                });
            }

        } catch (error) {
            console.error('Error processing operation results:', error);
            this.recordSyncError('Failed to process operation results', error);
        }
    }

    private recordSyncError(message: string, error: any): void {
        const errorMessage = error instanceof Error ? error.message : String(error);

        this.syncState.syncErrors.push({
            timestamp: new Date().toISOString(),
            error: `${message}: ${errorMessage}`
        });

        // Keep only last 10 errors
        if (this.syncState.syncErrors.length > 10) {
            this.syncState.syncErrors = this.syncState.syncErrors.slice(-10);
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
                version: 1,
                status: 'active'
            });
        }

        this.syncState.lastSync = now;
        await this.saveSyncState();

        console.log(`Notified specification change: ${specId} (${changeType})`);
    }

    dispose(): void {
        if (this.isDisposed) {
            return;
        }

        console.log('Disposing MCP Sync Service...');
        this.isDisposed = true;

        // Clear all timers first to prevent new operations
        if (this.processingTimer) {
            clearInterval(this.processingTimer);
            this.processingTimer = undefined;
        }

        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }

        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = undefined;
        }

        if (this.performanceOptimizationTimer) {
            clearInterval(this.performanceOptimizationTimer);
            this.performanceOptimizationTimer = undefined;
        }

        // Clear all debounce timers
        for (const timer of this.debounceTimers.values()) {
            clearTimeout(timer);
        }
        this.debounceTimers.clear();

        // Dispose all VS Code resources
        this.disposables.forEach(d => {
            try {
                d.dispose();
            } catch (error) {
                console.error('Error disposing resource:', error);
            }
        });
        this.disposables = [];

        // Clear watcher references
        this.operationQueueWatcher = undefined;
        this.syncStateWatcher = undefined;
        this.resultsWatcher = undefined;

        // Clear caches
        this.operationCache.clear();
        this.operationBatches.clear();
        this.processingQueue.length = 0;

        // Mark extension as offline and save final state if active
        if (this.isActive) {
            this.syncState.extensionOnline = false;
            this.syncState.lastSync = new Date().toISOString();
            // Use fire-and-forget save here as we are disposing
            this.saveSyncState().catch(err => console.error("Error saving final sync state on dispose:", err));
        }

        // Reset flags
        this.isInitialized = false;
        this.isActive = false;

        console.log('MCP Sync Service disposed');
    }
}
