import * as vscode from 'vscode';
import { McpSyncService } from './mcpSyncService';
import { ConflictResolver } from '../utils/conflictResolver';
import { NotificationManager } from './notificationManager';
import { McpOperation, McpOperationStatus, McpSyncState, McpOperationType } from '../models/mcpOperation';

export interface LiveUpdateEvent {
    type: 'operation_started' | 'operation_completed' | 'operation_failed' | 'operation_progress' |
          'conflict_detected' | 'conflict_resolved' | 'sync_status_changed' | 'spec_updated';
    timestamp: string;
    data: any;
    operationId?: string;
    specId?: string;
}

export interface UpdateSubscriber {
    id: string;
    callback: (event: LiveUpdateEvent) => void | Promise<void>;
    filter?: (event: LiveUpdateEvent) => boolean;
}

export class LiveUpdateService {
    private subscribers = new Map<string, UpdateSubscriber>();
    private eventHistory: LiveUpdateEvent[] = [];
    private readonly maxHistorySize = 50;
    private updateInterval: NodeJS.Timeout | undefined;

    // Event emitters
    private readonly onUpdateEmitter = new vscode.EventEmitter<LiveUpdateEvent>();
    public readonly onUpdate = this.onUpdateEmitter.event;

    constructor(
        private mcpSyncService: McpSyncService,
        private conflictResolver: ConflictResolver,
        private notificationManager: NotificationManager,
        private context: vscode.ExtensionContext
    ) {
        this.setupEventListeners();
        this.startUpdateMonitoring();
    }

    private setupEventListeners(): void {
        // Listen for notification manager events
        this.notificationManager.onNotificationShown(notification => {
            if (notification.operationId) {
                let eventType: LiveUpdateEvent['type'];

                switch (notification.type) {
                    case 'success':
                        eventType = 'operation_completed';
                        break;
                    case 'failure':
                        eventType = 'operation_failed';
                        break;
                    case 'progress':
                        eventType = 'operation_progress';
                        break;
                    case 'conflict':
                        eventType = 'conflict_detected';
                        break;
                    default:
                        return;
                }

                this.emitEvent({
                    type: eventType,
                    timestamp: new Date().toISOString(),
                    data: {
                        notification,
                        operationType: notification.operationType
                    },
                    operationId: notification.operationId
                });
            }
        });

        // Monitor workspace file changes that might affect specs
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            workspaceFolders.forEach(folder => {
                const specWatcher = vscode.workspace.createFileSystemWatcher(
                    new vscode.RelativePattern(folder, '**/{.specifications,specifications}/**/*')
                );

                specWatcher.onDidChange(uri => {
                    const specId = this.extractSpecIdFromPath(uri.fsPath);
                    if (specId) {
                        this.emitEvent({
                            type: 'spec_updated',
                            timestamp: new Date().toISOString(),
                            data: {
                                path: uri.fsPath,
                                changeType: 'modified'
                            },
                            specId
                        });
                    }
                });

                this.context.subscriptions.push(specWatcher);
            });
        }
    }

    private startUpdateMonitoring(): void {
        // Poll for changes every 3 seconds
        this.updateInterval = setInterval(() => {
            this.checkForUpdates();
        }, 3000);
    }

    private async checkForUpdates(): Promise<void> {
        try {
            // Check for sync status changes
            const currentSyncState = this.mcpSyncService.getSyncState();
            const lastSyncState = this.context.globalState.get<McpSyncState>('lastSyncState');

            if (!lastSyncState || this.hasSignificantSyncStateChange(lastSyncState, currentSyncState)) {
                await this.context.globalState.update('lastSyncState', currentSyncState);

                this.emitEvent({
                    type: 'sync_status_changed',
                    timestamp: new Date().toISOString(),
                    data: {
                        previousState: lastSyncState,
                        currentState: currentSyncState
                    }
                });
            }

            // Check for new operations
            const operations = this.mcpSyncService.getOperationQueue().operations;
            const lastOperationIds = this.context.globalState.get<string[]>('lastOperationIds', []);
            const currentOperationIds = operations.map(op => op.id);

            // Find new operations
            const newOperationIds = currentOperationIds.filter(id => !lastOperationIds.includes(id));
            if (newOperationIds.length > 0) {
                newOperationIds.forEach(operationId => {
                    const operation = operations.find(op => op.id === operationId);
                    if (operation) {
                        this.emitEvent({
                            type: 'operation_started',
                            timestamp: new Date().toISOString(),
                            data: {
                                operation: this.sanitizeOperationForEvent(operation)
                            },
                            operationId
                        });
                    }
                });
            }

            await this.context.globalState.update('lastOperationIds', currentOperationIds);

        } catch (error) {
            console.error('Error checking for updates:', error);
        }
    }

    private hasSignificantSyncStateChange(previous: McpSyncState, current: McpSyncState): boolean {
        return previous.mcpServerOnline !== current.mcpServerOnline ||
               previous.pendingOperations !== current.pendingOperations ||
               previous.failedOperations !== current.failedOperations ||
               previous.specifications.length !== current.specifications.length;
    }

    private sanitizeOperationForEvent(operation: McpOperation): any {
        // Return only safe, serializable data
        return {
            id: operation.id,
            type: operation.type,
            status: operation.status,
            priority: operation.priority,
            timestamp: operation.timestamp,
            progress: this.calculateOperationProgress(operation),
            specId: (operation.params as any)?.specId,
            description: this.getOperationDescription(operation)
        };
    }

    private calculateOperationProgress(operation: McpOperation): number {
        if (operation.status === McpOperationStatus.COMPLETED) {return 100;}
        if (operation.status === McpOperationStatus.FAILED || operation.status === McpOperationStatus.CANCELLED) {return 0;}
        if (operation.status === McpOperationStatus.PENDING) {return 0;}

        // For in-progress operations
        if (operation.status === McpOperationStatus.IN_PROGRESS && operation.startedAt && operation.estimatedDurationMs) {
            const elapsed = Date.now() - new Date(operation.startedAt).getTime();
            return Math.min(95, (elapsed / operation.estimatedDurationMs) * 100);
        }

        return 50; // Default for in-progress without timing info
    }

    private getOperationDescription(operation: McpOperation): string {
        const typeNames: Record<McpOperationType, string> = {
            [McpOperationType.CREATE_SPEC]: 'Creating specification',
            [McpOperationType.UPDATE_REQUIREMENTS]: 'Updating requirements',
            [McpOperationType.UPDATE_DESIGN]: 'Updating design',
            [McpOperationType.UPDATE_TASKS]: 'Updating tasks',
            [McpOperationType.UPDATE_TASK_STATUS]: 'Updating task status',
            [McpOperationType.ADD_USER_STORY]: 'Adding user story',
            [McpOperationType.DELETE_SPEC]: 'Deleting specification',
            [McpOperationType.SET_CURRENT_SPEC]: 'Setting current specification',
            [McpOperationType.SYNC_STATUS]: 'Synchronizing status',
            [McpOperationType.HEARTBEAT]: 'Heartbeat'
        };

        return typeNames[operation.type] || String(operation.type).replace(/[_-]/g, ' ').toLowerCase();
    }

    private extractSpecIdFromPath(filePath: string): string | null {
        // Extract spec ID from file path - this is a simplified version
        const match = filePath.match(/\/(?:\.specifications|specifications)\/([^\/]+)\//);
        return match ? match[1] : null;
    }

    // Public API methods

    public subscribe(id: string, callback: (event: LiveUpdateEvent) => void | Promise<void>, filter?: (event: LiveUpdateEvent) => boolean): vscode.Disposable {
        const subscriber: UpdateSubscriber = { id, callback, filter };
        this.subscribers.set(id, subscriber);

        console.log(`LiveUpdateService: Subscriber ${id} added`);

        return new vscode.Disposable(() => {
            this.subscribers.delete(id);
            console.log(`LiveUpdateService: Subscriber ${id} removed`);
        });
    }

    public emitEvent(event: LiveUpdateEvent): void {
        // Add to history
        this.eventHistory.unshift(event);
        if (this.eventHistory.length > this.maxHistorySize) {
            this.eventHistory = this.eventHistory.slice(0, this.maxHistorySize);
        }

        // Emit to VS Code event system
        this.onUpdateEmitter.fire(event);

        // Notify subscribers
        this.subscribers.forEach(subscriber => {
            try {
                if (!subscriber.filter || subscriber.filter(event)) {
                    const result = subscriber.callback(event);
                    if (result instanceof Promise) {
                        result.catch(error => {
                            console.error(`Error in subscriber ${subscriber.id}:`, error);
                        });
                    }
                }
            } catch (error) {
                console.error(`Error in subscriber ${subscriber.id}:`, error);
            }
        });

        console.log(`LiveUpdateService: Event emitted`, event.type, event.operationId || event.specId);
    }

    public getEventHistory(): LiveUpdateEvent[] {
        return [...this.eventHistory];
    }

    public getRecentEvents(count: number = 10): LiveUpdateEvent[] {
        return this.eventHistory.slice(0, count);
    }

    public getEventsForOperation(operationId: string): LiveUpdateEvent[] {
        return this.eventHistory.filter(event => event.operationId === operationId);
    }

    public getEventsForSpec(specId: string): LiveUpdateEvent[] {
        return this.eventHistory.filter(event => event.specId === specId);
    }

    // Manual event triggers for external components

    public notifyOperationProgress(operationId: string, progress: number, message?: string): void {
        this.emitEvent({
            type: 'operation_progress',
            timestamp: new Date().toISOString(),
            data: { progress, message },
            operationId
        });
    }

    public notifySpecUpdated(specId: string, changeType: 'modified' | 'created' | 'deleted', details?: any): void {
        this.emitEvent({
            type: 'spec_updated',
            timestamp: new Date().toISOString(),
            data: { changeType, details },
            specId
        });
    }

    public notifyConflictResolved(conflictId: string, resolution: any): void {
        this.emitEvent({
            type: 'conflict_resolved',
            timestamp: new Date().toISOString(),
            data: { conflictId, resolution }
        });
    }

    // Connection status for UI components

    public isConnected(): boolean {
        return this.subscribers.size > 0;
    }

    public getSubscriberCount(): number {
        return this.subscribers.size;
    }

    public getSubscriberIds(): string[] {
        return Array.from(this.subscribers.keys());
    }

    // Cleanup

    public dispose(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = undefined;
        }

        this.subscribers.clear();
        this.eventHistory = [];
        this.onUpdateEmitter.dispose();
    }
}
