import * as vscode from 'vscode';
import { McpSyncService } from '../services/mcpSyncService';
import { ConflictResolver, Conflict } from '../utils/conflictResolver';
import {
    McpOperation,
    McpOperationStatus,
    McpOperationType,
    McpOperationPriority,
    McpOperationQueue,
    McpSyncState
} from '../models/mcpOperation';

export class OperationQueueProvider implements vscode.TreeDataProvider<OperationTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<OperationTreeItem | undefined | null | void> = new vscode.EventEmitter<OperationTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<OperationTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    // Enhanced state tracking
    private lastRefresh: number = 0;
    private refreshThrottleMs: number = 500;
    public refreshTimer: NodeJS.Timeout | undefined;
    private isRefreshing: boolean = false;

    constructor(
        private mcpSyncService: McpSyncService,
        private conflictResolver: ConflictResolver
    ) {}

    refresh(): void {
        // Throttle refresh to prevent excessive updates
        const now = Date.now();
        if (now - this.lastRefresh < this.refreshThrottleMs) {
            if (this.refreshTimer) {
                clearTimeout(this.refreshTimer);
            }
            this.refreshTimer = setTimeout(() => {
                this.performRefresh();
            }, this.refreshThrottleMs);
            return;
        }

        this.performRefresh();
    }

    private performRefresh(): void {
        if (this.isRefreshing) {
            return;
        }

        this.isRefreshing = true;
        this.lastRefresh = Date.now();

        try {
            this._onDidChangeTreeData.fire();
        } finally {
            this.isRefreshing = false;
        }
    }

    getTreeItem(element: OperationTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: OperationTreeItem): Promise<OperationTreeItem[]> {
        if (!element) {
            // Root level - show enhanced categories with real-time data
            const items: OperationTreeItem[] = [];
            const queue = this.mcpSyncService.getOperationQueue();
            const syncState = this.mcpSyncService.getSyncState();
            const conflicts = this.conflictResolver.getActiveConflicts();

            // Enhanced Sync Status with visual indicators
            const syncStatusIcon = syncState.mcpServerOnline ? '🟢' : '🔴';
            const syncStatusLabel = `${syncStatusIcon} Sync Status`;
            items.push(new OperationTreeItem(
                syncStatusLabel,
                vscode.TreeItemCollapsibleState.Expanded,
                'sync-status',
                syncState,
                this.getSyncStatusDescription()
            ));

            // Enhanced Operation Queue with detailed breakdown
            if (queue.operations.length > 0) {
                const queueSummary = this.getQueueSummary(queue);
                items.push(new OperationTreeItem(
                    `📋 Operations (${queue.operations.length})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    'operation-queue',
                    queue,
                    queueSummary
                ));
            } else {
                items.push(new OperationTreeItem(
                    '📋 Operations (0)',
                    vscode.TreeItemCollapsibleState.None,
                    'empty-queue',
                    undefined,
                    'No operations in queue'
                ));
            }

            // Enhanced Conflicts with severity indicators
            if (conflicts.length > 0) {
                const criticalCount = conflicts.filter(c => c.severity === 'critical').length;
                const conflictIcon = criticalCount > 0 ? '🚨' : '⚠️';
                items.push(new OperationTreeItem(
                    `${conflictIcon} Conflicts (${conflicts.length})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    'conflicts',
                    conflicts,
                    this.getConflictsSummary(conflicts)
                ));
            }

            // Performance Metrics (new section)
            const performanceMetrics = this.getPerformanceMetrics(syncState, queue);
            if (performanceMetrics) {
                items.push(new OperationTreeItem(
                    '📊 Performance',
                    vscode.TreeItemCollapsibleState.Collapsed,
                    'performance',
                    performanceMetrics,
                    'Operation processing metrics'
                ));
            }

            return items;
        }

        // Handle nested items
        switch (element.contextValue) {
            case 'sync-status':
                return this.getSyncStatusItems();
            case 'operation-queue':
                return this.getOperationQueueItems();
            case 'operation-status':
                return this.getOperationsByStatus(element.data);
            case 'conflicts':
                return this.getConflictItems();
            case 'performance':
                return this.getPerformanceItems(element.data);
            default:
                return [];
        }
    }

    private getSyncStatusDescription(): string {
        const syncState = this.mcpSyncService.getSyncState();
        const status = syncState.mcpServerOnline ? 'Online' : 'Offline';
        return `MCP Server: ${status}`;
    }

    private getSyncStatusItems(): OperationTreeItem[] {
        const syncState = this.mcpSyncService.getSyncState();
        const items: OperationTreeItem[] = [];

        items.push(new OperationTreeItem(
            `Extension: ${syncState.extensionOnline ? '🟢 Online' : '🔴 Offline'}`,
            vscode.TreeItemCollapsibleState.None,
            'sync-detail'
        ));

        items.push(new OperationTreeItem(
            `MCP Server: ${syncState.mcpServerOnline ? '🟢 Online' : '🔴 Offline'}`,
            vscode.TreeItemCollapsibleState.None,
            'sync-detail'
        ));

        if (syncState.lastSync) {
            const lastSync = new Date(syncState.lastSync);
            const timeDiff = Date.now() - lastSync.getTime();
            const minutes = Math.floor(timeDiff / 60000);
            const syncTime = minutes < 1 ? 'Just now' : `${minutes}m ago`;

            items.push(new OperationTreeItem(
                `Last Sync: ${syncTime}`,
                vscode.TreeItemCollapsibleState.None,
                'sync-detail'
            ));
        }

        items.push(new OperationTreeItem(
            `Pending Operations: ${syncState.pendingOperations}`,
            vscode.TreeItemCollapsibleState.None,
            'sync-detail'
        ));

        items.push(new OperationTreeItem(
            `Failed Operations: ${syncState.failedOperations}`,
            vscode.TreeItemCollapsibleState.None,
            'sync-detail'
        ));

        items.push(new OperationTreeItem(
            `Specifications: ${syncState.specifications.length}`,
            vscode.TreeItemCollapsibleState.None,
            'sync-detail'
        ));

        return items;
    }

    private getOperationQueueItems(): OperationTreeItem[] {
        const queue = this.mcpSyncService.getOperationQueue();
        const items: OperationTreeItem[] = [];

        // Group operations by status with enhanced information
        const statusGroups = this.groupOperationsByStatus(queue.operations);

        // Pending operations with priority breakdown
        if (statusGroups.pending.length > 0) {
            const urgentCount = statusGroups.pending.filter(op => op.priority === McpOperationPriority.URGENT).length;
            const highCount = statusGroups.pending.filter(op => op.priority === McpOperationPriority.HIGH).length;

            let pendingLabel = `⏳ Pending (${statusGroups.pending.length})`;
            if (urgentCount > 0) {
                pendingLabel += ` • ${urgentCount} urgent`;
            }
            if (highCount > 0) {
                pendingLabel += ` • ${highCount} high`;
            }

            items.push(new OperationTreeItem(
                pendingLabel,
                vscode.TreeItemCollapsibleState.Expanded,
                'operation-status',
                { operations: statusGroups.pending, status: 'pending' },
                this.getStatusGroupDescription(statusGroups.pending, 'pending')
            ));
        }

        // In Progress operations with progress indicators
        if (statusGroups.inProgress.length > 0) {
            const avgProgress = this.calculateAverageProgress(statusGroups.inProgress);
            items.push(new OperationTreeItem(
                `🔄 In Progress (${statusGroups.inProgress.length}) • ${avgProgress}%`,
                vscode.TreeItemCollapsibleState.Expanded,
                'operation-status',
                { operations: statusGroups.inProgress, status: 'in_progress' },
                this.getStatusGroupDescription(statusGroups.inProgress, 'in_progress')
            ));
        }

        // Failed operations with retry information
        if (statusGroups.failed.length > 0) {
            const retryableCount = statusGroups.failed.filter(op => this.canRetryOperation(op)).length;
            let failedLabel = `❌ Failed (${statusGroups.failed.length})`;
            if (retryableCount > 0) {
                failedLabel += ` • ${retryableCount} retryable`;
            }

            items.push(new OperationTreeItem(
                failedLabel,
                vscode.TreeItemCollapsibleState.Expanded,
                'operation-status',
                { operations: statusGroups.failed, status: 'failed' },
                this.getStatusGroupDescription(statusGroups.failed, 'failed')
            ));
        }

        // Completed operations (show last 10)
        if (statusGroups.completed.length > 0) {
            const recentCompleted = statusGroups.completed
                .sort((a, b) => new Date(b.completedAt || b.timestamp).getTime() - new Date(a.completedAt || a.timestamp).getTime())
                .slice(0, 10);

            items.push(new OperationTreeItem(
                `✅ Completed (${statusGroups.completed.length})`,
                vscode.TreeItemCollapsibleState.Collapsed,
                'operation-status',
                { operations: recentCompleted, status: 'completed' },
                `Showing ${recentCompleted.length} most recent completed operations`
            ));
        }

        // Cancelled operations
        if (statusGroups.cancelled.length > 0) {
            items.push(new OperationTreeItem(
                `🚫 Cancelled (${statusGroups.cancelled.length})`,
                vscode.TreeItemCollapsibleState.Collapsed,
                'operation-status',
                { operations: statusGroups.cancelled, status: 'cancelled' },
                this.getStatusGroupDescription(statusGroups.cancelled, 'cancelled')
            ));
        }

        return items;
    }

    private getOperationsByStatus(data: { operations: McpOperation[], status: string }): OperationTreeItem[] {
        const { operations, status } = data;

        // Sort operations by priority and timestamp
        const sortedOperations = operations.sort((a, b) => {
            // First by priority (higher priority first)
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }
            // Then by timestamp (newer first for pending/failed, older first for completed)
            const aTime = new Date(a.timestamp).getTime();
            const bTime = new Date(b.timestamp).getTime();
            return status === 'completed' ? aTime - bTime : bTime - aTime;
        });

        return sortedOperations.map(operation => {
            let description = this.getOperationDescription(operation);

            // Add progress indicator for in-progress operations
            if (operation.status === McpOperationStatus.IN_PROGRESS) {
                const progress = this.calculateOperationProgress(operation);
                description = `${progress}% • ${description}`;
            }

            return new OperationTreeItem(
                this.getOperationDisplayName(operation),
                vscode.TreeItemCollapsibleState.None,
                'operation',
                operation,
                description
            );
        });
    }

    private getConflictItems(): OperationTreeItem[] {
        const conflicts = this.conflictResolver.getActiveConflicts();
        return conflicts.map(conflict => new OperationTreeItem(
            `${this.getConflictIcon(conflict)} ${conflict.description}`,
            vscode.TreeItemCollapsibleState.None,
            'conflict',
            conflict,
            `Type: ${conflict.type} | ${new Date(conflict.timestamp).toLocaleTimeString()}`
        ));
    }

    private getConflictIcon(conflict: Conflict): string {
        switch (conflict.type) {
            case 'concurrent_modification': return '🔄';
            case 'duplicate_operation': return '🔄';
            case 'outdated_operation': return '⏰';
            case 'permission_denied': return '🔒';
            case 'resource_not_found': return '❓';
            case 'invalid_state': return '⚠️';
            case 'resource_locked': return '🔐';
            case 'dependency_conflict': return '🔗';
            case 'version_mismatch': return '📋';
            case 'circular_dependency': return '🔄';
            case 'priority_conflict': return '⚡';
            default: return '❗';
        }
    }

    // Enhanced helper methods for the new functionality

    private getQueueSummary(queue: McpOperationQueue): string {
        const statusGroups = this.groupOperationsByStatus(queue.operations);
        const parts: string[] = [];

        if (statusGroups.pending.length > 0) {
            parts.push(`${statusGroups.pending.length} pending`);
        }
        if (statusGroups.inProgress.length > 0) {
            parts.push(`${statusGroups.inProgress.length} in progress`);
        }
        if (statusGroups.failed.length > 0) {
            parts.push(`${statusGroups.failed.length} failed`);
        }

        return parts.join(' • ') || 'No active operations';
    }

    private getConflictsSummary(conflicts: Conflict[]): string {
        const criticalCount = conflicts.filter(c => c.severity === 'critical').length;
        const highCount = conflicts.filter(c => c.severity === 'high').length;
        const mediumCount = conflicts.filter(c => c.severity === 'medium').length;

        const parts: string[] = [];
        if (criticalCount > 0) {parts.push(`${criticalCount} critical`);}
        if (highCount > 0) {parts.push(`${highCount} high`);}
        if (mediumCount > 0) {parts.push(`${mediumCount} medium`);}

        return parts.join(' • ') || 'Low priority conflicts';
    }

    private getPerformanceMetrics(syncState: McpSyncState, queue: McpOperationQueue): any {
        if (!syncState.performance) {
            return null;
        }

        return {
            averageOperationTime: syncState.performance.averageOperationTimeMs,
            processingRate: syncState.performance.queueProcessingRate,
            lastProcessingDuration: syncState.performance.lastProcessingDuration,
            queueSize: queue.operations.length,
            totalProcessed: queue.processingStats?.totalProcessed || 0,
            successRate: this.calculateSuccessRate(queue)
        };
    }

    private getPerformanceItems(metrics: any): OperationTreeItem[] {
        const items: OperationTreeItem[] = [];

        items.push(new OperationTreeItem(
            `⏱️ Avg Operation Time: ${Math.round(metrics.averageOperationTime)}ms`,
            vscode.TreeItemCollapsibleState.None,
            'performance-metric'
        ));

        items.push(new OperationTreeItem(
            `🚀 Processing Rate: ${metrics.processingRate.toFixed(1)} ops/min`,
            vscode.TreeItemCollapsibleState.None,
            'performance-metric'
        ));

        items.push(new OperationTreeItem(
            `📊 Success Rate: ${(metrics.successRate * 100).toFixed(1)}%`,
            vscode.TreeItemCollapsibleState.None,
            'performance-metric'
        ));

        items.push(new OperationTreeItem(
            `📈 Total Processed: ${metrics.totalProcessed}`,
            vscode.TreeItemCollapsibleState.None,
            'performance-metric'
        ));

        return items;
    }

    private groupOperationsByStatus(operations: McpOperation[]): {
        pending: McpOperation[],
        inProgress: McpOperation[],
        completed: McpOperation[],
        failed: McpOperation[],
        cancelled: McpOperation[]
    } {
        return {
            pending: operations.filter(op => op.status === McpOperationStatus.PENDING),
            inProgress: operations.filter(op => op.status === McpOperationStatus.IN_PROGRESS),
            completed: operations.filter(op => op.status === McpOperationStatus.COMPLETED),
            failed: operations.filter(op => op.status === McpOperationStatus.FAILED),
            cancelled: operations.filter(op => op.status === McpOperationStatus.CANCELLED)
        };
    }

    private getStatusGroupDescription(operations: McpOperation[], status: string): string {
        if (operations.length === 0) {
            return `No ${status} operations`;
        }

        const typeCount = new Map<string, number>();
        operations.forEach(op => {
            const count = typeCount.get(op.type) || 0;
            typeCount.set(op.type, count + 1);
        });

        const typeSummary = Array.from(typeCount.entries())
            .map(([type, count]) => `${count} ${this.getOperationTypeDisplayName(type)}`)
            .join(', ');

        return typeSummary;
    }

    private getOperationTypeDisplayName(type: string): string {
        switch (type) {
            case McpOperationType.CREATE_SPEC: return 'create spec';
            case McpOperationType.UPDATE_REQUIREMENTS: return 'update requirements';
            case McpOperationType.UPDATE_DESIGN: return 'update design';
            case McpOperationType.UPDATE_TASKS: return 'update tasks';
            case McpOperationType.ADD_USER_STORY: return 'add user story';
            case McpOperationType.UPDATE_TASK_STATUS: return 'update task status';
            case McpOperationType.DELETE_SPEC: return 'delete spec';
            case McpOperationType.SET_CURRENT_SPEC: return 'set current spec';
            case McpOperationType.SYNC_STATUS: return 'sync status';
            case McpOperationType.HEARTBEAT: return 'heartbeat';
            default: return type.replace(/_/g, ' ').toLowerCase();
        }
    }

    private getOperationDisplayName(operation: McpOperation): string {
        const typeDisplay = this.getOperationTypeDisplayName(operation.type);
        const priorityIcon = this.getPriorityIcon(operation.priority);

        let name = `${priorityIcon} ${typeDisplay}`;

        // Add specific details based on operation type
        if (operation.params) {
            const params = operation.params as any;
            switch (operation.type) {
                case McpOperationType.CREATE_SPEC:
                    name += `: ${params.name || 'New Spec'}`;
                    break;
                case McpOperationType.UPDATE_REQUIREMENTS:
                case McpOperationType.UPDATE_DESIGN:
                case McpOperationType.UPDATE_TASKS:
                case McpOperationType.UPDATE_TASK_STATUS:
                case McpOperationType.DELETE_SPEC:
                case McpOperationType.SET_CURRENT_SPEC:
                    name += `: ${params.specId || 'Unknown Spec'}`;
                    break;
                case McpOperationType.ADD_USER_STORY:
                    name += `: ${params.specId || 'Unknown Spec'}`;
                    break;
            }
        }

        return name;
    }

    private getPriorityIcon(priority: McpOperationPriority): string {
        switch (priority) {
            case McpOperationPriority.URGENT: return '🔴';
            case McpOperationPriority.HIGH: return '🟠';
            case McpOperationPriority.NORMAL: return '🟡';
            case McpOperationPriority.LOW: return '🟢';
            default: return '⚪';
        }
    }

    private getOperationDescription(operation: McpOperation): string {
        const parts: string[] = [];

        // Add timing information
        const age = Date.now() - new Date(operation.timestamp).getTime();
        const ageMinutes = Math.floor(age / 60000);
        if (ageMinutes < 1) {
            parts.push('just now');
        } else if (ageMinutes < 60) {
            parts.push(`${ageMinutes}m ago`);
        } else {
            const ageHours = Math.floor(ageMinutes / 60);
            parts.push(`${ageHours}h ago`);
        }

        // Add retry information for failed operations
        if (operation.status === McpOperationStatus.FAILED) {
            parts.push(`retry ${operation.retryCount}/${operation.maxRetries}`);
        }

        // Add duration for completed operations
        if (operation.status === McpOperationStatus.COMPLETED && operation.actualDurationMs) {
            parts.push(`${Math.round(operation.actualDurationMs)}ms`);
        }

        // Add error information for failed operations
        if (operation.error) {
            const errorPreview = operation.error.length > 50
                ? operation.error.substring(0, 50) + '...'
                : operation.error;
            parts.push(`error: ${errorPreview}`);
        }

        return parts.join(' • ');
    }

    private calculateAverageProgress(operations: McpOperation[]): number {
        if (operations.length === 0) {return 0;}

        const totalProgress = operations.reduce((sum, op) => {
            return sum + this.calculateOperationProgress(op);
        }, 0);

        return Math.round(totalProgress / operations.length);
    }

    private calculateOperationProgress(operation: McpOperation): number {
        if (operation.status === McpOperationStatus.COMPLETED) {return 100;}
        if (operation.status === McpOperationStatus.FAILED || operation.status === McpOperationStatus.CANCELLED) {return 0;}
        if (operation.status === McpOperationStatus.PENDING) {return 0;}

        // For in-progress operations, estimate based on elapsed time and estimated duration
        if (operation.status === McpOperationStatus.IN_PROGRESS) {
            if (!operation.startedAt || !operation.estimatedDurationMs) {return 50;} // Default 50% if no timing info

            const elapsed = Date.now() - new Date(operation.startedAt).getTime();
            const progress = Math.min(95, (elapsed / operation.estimatedDurationMs) * 100); // Cap at 95%
            return Math.round(progress);
        }

        return 0;
    }

    private canRetryOperation(operation: McpOperation): boolean {
        return operation.status === McpOperationStatus.FAILED &&
               operation.retryCount < operation.maxRetries;
    }

    private calculateSuccessRate(queue: McpOperationQueue): number {
        const stats = queue.processingStats;
        if (!stats || stats.totalProcessed === 0) {return 1;}

        return stats.successCount / stats.totalProcessed;
    }
}

export class OperationTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly data?: any,
        public readonly description?: string
    ) {
        super(label, collapsibleState);

        this.tooltip = this.getTooltip();
        this.description = description;

        // Enhanced icon and command handling
        this.setupIconAndCommand();
    }

    private setupIconAndCommand(): void {
        switch (this.contextValue) {
            case 'operation':
                this.iconPath = this.getOperationIcon(this.data as McpOperation);
                this.command = {
                    command: 'specforged.showOperationDetails',
                    title: 'Show Operation Details',
                    arguments: [this.data]
                };
                break;

            case 'conflict':
                this.iconPath = this.getConflictIcon(this.data as Conflict);
                this.command = {
                    command: 'specforged.resolveConflict',
                    title: 'Resolve Conflict',
                    arguments: [this.data.id]
                };
                break;

            case 'sync-status':
                const syncState = this.data as McpSyncState;
                this.iconPath = syncState?.mcpServerOnline
                    ? new vscode.ThemeIcon('check-all', new vscode.ThemeColor('testing.iconPassed'))
                    : new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
                break;

            case 'operation-queue':
                this.iconPath = new vscode.ThemeIcon('list-ordered');
                break;

            case 'conflicts':
                const conflicts = this.data as Conflict[];
                const hasCritical = conflicts?.some(c => c.severity === 'critical');
                this.iconPath = hasCritical
                    ? new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'))
                    : new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconQueued'));
                break;

            case 'performance':
                this.iconPath = new vscode.ThemeIcon('graph');
                break;

            case 'operation-status':
                this.iconPath = this.getStatusGroupIcon(this.data?.status);
                break;

            case 'performance-metric':
                this.iconPath = new vscode.ThemeIcon('pulse');
                break;

            case 'empty-queue':
                this.iconPath = new vscode.ThemeIcon('inbox', new vscode.ThemeColor('descriptionForeground'));
                break;

            default:
                this.iconPath = new vscode.ThemeIcon('circle-outline');
                break;
        }
    }

    private getTooltip(): string {
        switch (this.contextValue) {
            case 'operation':
                const op = this.data as McpOperation;
                const tooltip = [
                    `Operation: ${op.type}`,
                    `Status: ${op.status}`,
                    `Priority: ${this.getPriorityName(op.priority)}`,
                    `Created: ${new Date(op.timestamp).toLocaleString()}`,
                    `Retries: ${op.retryCount}/${op.maxRetries}`
                ];

                if (op.startedAt) {
                    tooltip.push(`Started: ${new Date(op.startedAt).toLocaleString()}`);
                }

                if (op.completedAt) {
                    tooltip.push(`Completed: ${new Date(op.completedAt).toLocaleString()}`);
                }

                if (op.estimatedDurationMs) {
                    tooltip.push(`Estimated Duration: ${op.estimatedDurationMs}ms`);
                }

                if (op.actualDurationMs) {
                    tooltip.push(`Actual Duration: ${op.actualDurationMs}ms`);
                }

                if (op.error) {
                    tooltip.push(`Error: ${op.error}`);
                }

                if (op.dependencies && op.dependencies.length > 0) {
                    tooltip.push(`Dependencies: ${op.dependencies.length}`);
                }

                return tooltip.join('\n');

            case 'conflict':
                const conflict = this.data as Conflict;
                const conflictTooltip = [
                    `Conflict: ${conflict.type}`,
                    `Severity: ${conflict.severity}`,
                    `Description: ${conflict.description}`,
                    `Operations: ${conflict.operations?.length || 0}`,
                    `Created: ${new Date(conflict.timestamp).toLocaleString()}`
                ];

                if (conflict.resolutionAttempts > 0) {
                    conflictTooltip.push(`Resolution Attempts: ${conflict.resolutionAttempts}`);
                }

                if (conflict.autoResolvable) {
                    conflictTooltip.push('Auto-resolvable: Yes');
                }

                return conflictTooltip.join('\n');

            case 'sync-status':
                const syncState = this.data as McpSyncState;
                if (!syncState) {return this.label;}

                const syncTooltip = [
                    `Extension: ${syncState.extensionOnline ? 'Online' : 'Offline'}`,
                    `MCP Server: ${syncState.mcpServerOnline ? 'Online' : 'Offline'}`,
                    `Pending Operations: ${syncState.pendingOperations}`,
                    `Failed Operations: ${syncState.failedOperations}`,
                    `Active Conflicts: ${syncState.activeConflicts}`
                ];

                if (syncState.lastSync) {
                    syncTooltip.push(`Last Sync: ${new Date(syncState.lastSync).toLocaleString()}`);
                }

                return syncTooltip.join('\n');

            case 'operation-status':
                const statusData = this.data;
                if (!statusData) {return this.label;}

                return `${statusData.operations.length} ${statusData.status} operations\nClick to expand and view details`;

            case 'performance':
                const metrics = this.data;
                if (!metrics) {return this.label;}

                return [
                    `Average Operation Time: ${Math.round(metrics.averageOperationTime)}ms`,
                    `Processing Rate: ${metrics.processingRate.toFixed(1)} operations/minute`,
                    `Success Rate: ${(metrics.successRate * 100).toFixed(1)}%`,
                    `Total Processed: ${metrics.totalProcessed}`
                ].join('\n');

            default:
                return this.description || this.label;
        }
    }

    private getOperationIcon(operation: McpOperation): vscode.ThemeIcon {
        // Enhanced icons with colors based on status and priority
        switch (operation.status) {
            case McpOperationStatus.PENDING:
                return operation.priority >= McpOperationPriority.HIGH
                    ? new vscode.ThemeIcon('clock', new vscode.ThemeColor('testing.iconQueued'))
                    : new vscode.ThemeIcon('clock');
            case McpOperationStatus.IN_PROGRESS:
                return new vscode.ThemeIcon('loading~spin', new vscode.ThemeColor('progressBar.background'));
            case McpOperationStatus.COMPLETED:
                return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
            case McpOperationStatus.FAILED:
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
            case McpOperationStatus.CANCELLED:
                return new vscode.ThemeIcon('x', new vscode.ThemeColor('testing.iconSkipped'));
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }

    private getConflictIcon(conflict: Conflict): vscode.ThemeIcon {
        // Enhanced conflict icons based on severity
        switch (conflict.severity) {
            case 'critical':
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
            case 'high':
                return new vscode.ThemeIcon('warning', new vscode.ThemeColor('testing.iconQueued'));
            case 'medium':
                return new vscode.ThemeIcon('info', new vscode.ThemeColor('testing.iconUnset'));
            case 'low':
                return new vscode.ThemeIcon('info');
            default:
                return new vscode.ThemeIcon('warning');
        }
    }

    private getStatusGroupIcon(status: string): vscode.ThemeIcon {
        switch (status) {
            case 'pending':
                return new vscode.ThemeIcon('clock');
            case 'in_progress':
                return new vscode.ThemeIcon('loading~spin');
            case 'completed':
                return new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'));
            case 'failed':
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('testing.iconFailed'));
            case 'cancelled':
                return new vscode.ThemeIcon('x', new vscode.ThemeColor('testing.iconSkipped'));
            default:
                return new vscode.ThemeIcon('list-unordered');
        }
    }

    private getPriorityName(priority: McpOperationPriority): string {
        switch (priority) {
            case McpOperationPriority.URGENT: return 'Urgent';
            case McpOperationPriority.HIGH: return 'High';
            case McpOperationPriority.NORMAL: return 'Normal';
            case McpOperationPriority.LOW: return 'Low';
            default: return 'Unknown';
        }
    }
}

export class OperationQueueView {
    private provider: OperationQueueProvider;
    private treeView: vscode.TreeView<OperationTreeItem>;

    constructor(
        private mcpSyncService: McpSyncService,
        private conflictResolver: ConflictResolver,
        context: vscode.ExtensionContext
    ) {
        this.provider = new OperationQueueProvider(mcpSyncService, conflictResolver);
        this.treeView = vscode.window.createTreeView('specforged.operationQueue', {
            treeDataProvider: this.provider,
            canSelectMany: false,
            showCollapseAll: true
        });

        context.subscriptions.push(this.treeView);
        this.setupCommands(context);
        this.setupFileWatchers(context);
        this.setupAutoRefresh();
    }

    private setupCommands(context: vscode.ExtensionContext) {
        const commands = [
            // Note: refreshQueue command is registered in extension.ts to avoid duplicates

            // Enhanced cleanup with user options
            vscode.commands.registerCommand('specforged.clearCompletedOperations', async () => {
                const options = ['Last hour', 'Last 6 hours', 'Last 24 hours', 'All completed'];
                const selected = await vscode.window.showQuickPick(options, {
                    placeHolder: 'Select operations to clear'
                });

                if (!selected) {return;}

                let maxAgeHours: number;
                switch (selected) {
                    case 'Last hour': maxAgeHours = 1; break;
                    case 'Last 6 hours': maxAgeHours = 6; break;
                    case 'Last 24 hours': maxAgeHours = 24; break;
                    case 'All completed': maxAgeHours = 0; break;
                    default: return;
                }

                await this.mcpSyncService.cleanupOldOperations(maxAgeHours);
                this.provider.refresh();
                vscode.window.showInformationMessage(`Cleared completed operations older than ${selected.toLowerCase()}`);
            }),

            // Enhanced conflict resolution with options
            vscode.commands.registerCommand('specforged.resolveConflict', async (conflictId: string) => {
                const conflict = this.conflictResolver.getConflictById(conflictId);
                if (!conflict) {
                    vscode.window.showErrorMessage('Conflict not found');
                    return;
                }

                // Show resolution options if conflict requires user input
                if (!conflict.autoResolvable) {
                    const resolutionOptions = conflict.recommendations.map(rec => ({
                        label: this.getResolutionLabel(rec),
                        description: this.getResolutionDescription(rec),
                        resolution: rec
                    }));

                    const selected = await vscode.window.showQuickPick(resolutionOptions, {
                        placeHolder: `Resolve conflict: ${conflict.description}`,
                        matchOnDescription: true
                    });

                    if (!selected) {return;}

                    const resolved = await this.conflictResolver.resolveConflict(conflictId, selected.resolution);
                    if (resolved) {
                        vscode.window.showInformationMessage(`Conflict resolved: ${conflict.description}`);
                        this.provider.refresh();
                    } else {
                        vscode.window.showErrorMessage('Failed to resolve conflict');
                    }
                } else {
                    // Auto-resolve
                    const resolved = await this.conflictResolver.resolveConflict(conflictId);
                    if (resolved) {
                        vscode.window.showInformationMessage(`Conflict auto-resolved: ${conflict.description}`);
                        this.provider.refresh();
                    } else {
                        vscode.window.showErrorMessage('Failed to resolve conflict');
                    }
                }
            }),

            // Enhanced retry with selective retry options
            vscode.commands.registerCommand('specforged.retryFailedOperations', async () => {
                const queue = this.mcpSyncService.getOperationQueue();
                const failedOps = queue.operations.filter(op => op.status === McpOperationStatus.FAILED);

                if (failedOps.length === 0) {
                    vscode.window.showInformationMessage('No failed operations to retry');
                    return;
                }

                const retryOptions = [
                    { label: 'Retry all failed operations', value: 'all' },
                    { label: 'Retry only retryable operations', value: 'retryable' },
                    { label: 'Select operations to retry', value: 'select' }
                ];

                const selected = await vscode.window.showQuickPick(retryOptions, {
                    placeHolder: `${failedOps.length} failed operations found`
                });

                if (!selected) {return;}

                let operationsToRetry: McpOperation[] = [];

                switch (selected.value) {
                    case 'all':
                        operationsToRetry = failedOps;
                        break;
                    case 'retryable':
                        operationsToRetry = failedOps.filter(op => op.retryCount < op.maxRetries);
                        break;
                    case 'select':
                        const operationItems = failedOps.map(op => {
                            const params = op.params as any;
                            const identifier = params?.specId || params?.name || 'Unknown';
                            return {
                                label: `${op.type}: ${identifier}`,
                                description: `Retry ${op.retryCount}/${op.maxRetries} • ${op.error?.substring(0, 50) || 'No error details'}`,
                                operation: op
                            };
                        });

                        const selectedOps = await vscode.window.showQuickPick(operationItems, {
                            placeHolder: 'Select operations to retry',
                            canPickMany: true
                        });

                        if (!selectedOps || selectedOps.length === 0) {return;}
                        operationsToRetry = selectedOps.map(item => item.operation);
                        break;
                }

                if (operationsToRetry.length === 0) {
                    vscode.window.showInformationMessage('No operations selected for retry');
                    return;
                }

                // Reset operations for retry
                for (const op of operationsToRetry) {
                    op.status = McpOperationStatus.PENDING;
                    op.retryCount = Math.min(op.retryCount + 1, op.maxRetries);
                    op.error = undefined;
                    op.startedAt = undefined;
                    op.completedAt = undefined;
                }

                // Trigger processing
                await this.mcpSyncService.processOperations();
                this.provider.refresh();
                vscode.window.showInformationMessage(`Retrying ${operationsToRetry.length} operations`);
            }),

            // Enhanced operation details with better formatting
            vscode.commands.registerCommand('specforged.showOperationDetails', (operation: McpOperation) => {
                this.showEnhancedOperationDetails(operation);
            }),

            // Enhanced force sync with progress
            vscode.commands.registerCommand('specforged.forceSync', async () => {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: 'Synchronizing operations...',
                    cancellable: false
                }, async (progress) => {
                    progress.report({ increment: 0, message: 'Processing operations...' });
                    await this.mcpSyncService.processOperations();

                    progress.report({ increment: 50, message: 'Updating queue...' });
                    this.provider.refresh();

                    progress.report({ increment: 100, message: 'Sync completed' });
                });

                vscode.window.showInformationMessage('Operation sync completed');
            }),

            // New commands for enhanced functionality
            vscode.commands.registerCommand('specforged.cancelOperation', async (operation: McpOperation) => {
                if (operation.status === McpOperationStatus.IN_PROGRESS || operation.status === McpOperationStatus.PENDING) {
                    operation.status = McpOperationStatus.CANCELLED;
                    this.provider.refresh();
                    vscode.window.showInformationMessage(`Operation cancelled: ${operation.type}`);
                } else {
                    vscode.window.showWarningMessage('Operation cannot be cancelled in its current state');
                }
            }),


            vscode.commands.registerCommand('specforged.showConflictDashboard', async () => {
                const conflicts = this.conflictResolver.getActiveConflicts();
                if (conflicts.length === 0) {
                    vscode.window.showInformationMessage('No active conflicts');
                    return;
                }

                // Show conflict dashboard (could be enhanced with webview)
                const conflictItems = conflicts.map(conflict => ({
                    label: `${this.getSeverityIcon(conflict.severity)} ${conflict.description}`,
                    description: `${conflict.type} • ${conflict.operations?.length || 0} operations`,
                    conflict: conflict
                }));

                const selected = await vscode.window.showQuickPick(conflictItems, {
                    placeHolder: `${conflicts.length} active conflicts`,
                    matchOnDescription: true
                });

                if (selected) {
                    vscode.commands.executeCommand('specforged.resolveConflict', selected.conflict.id);
                }
            })

            // Note: autoResolveConflicts command is registered in extension.ts to avoid duplicates
        ];

        context.subscriptions.push(...commands);
    }

    private setupAutoRefresh() {
        // Enhanced auto-refresh with adaptive intervals
        let refreshInterval = 5000; // Start with 5 seconds

        const refreshTimer = () => {
            const syncState = this.mcpSyncService.getSyncState();
            const queue = this.mcpSyncService.getOperationQueue();

            // Adaptive refresh rate based on activity
            const hasActiveOperations = queue.operations.some(op =>
                op.status === McpOperationStatus.PENDING ||
                op.status === McpOperationStatus.IN_PROGRESS
            );

            const hasActiveConflicts = this.conflictResolver.getActiveConflicts().length > 0;

            if (hasActiveOperations || hasActiveConflicts) {
                refreshInterval = 2000; // Fast refresh when active
            } else if (syncState.mcpServerOnline) {
                refreshInterval = 10000; // Normal refresh when online but idle
            } else {
                refreshInterval = 30000; // Slow refresh when offline
            }

            this.provider.refresh();
            setTimeout(refreshTimer, refreshInterval);
        };

        // Start the adaptive refresh timer
        setTimeout(refreshTimer, refreshInterval);
    }

    private async showEnhancedOperationDetails(operation: McpOperation) {
        const details = this.generateOperationDetailsMarkdown(operation);

        const doc = await vscode.workspace.openTextDocument({
            content: details,
            language: 'markdown'
        });

        await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Beside,
            preview: true
        });
    }

    private generateOperationDetailsMarkdown(operation: McpOperation): string {
        const priorityName = this.getPriorityName(operation.priority);
        const statusIcon = this.getStatusIcon(operation.status);
        const priorityIcon = this.getPriorityIcon(operation.priority);

        let details = `# ${statusIcon} Operation Details

## Basic Information
| Field | Value |
|-------|-------|
| **ID** | \`${operation.id}\` |
| **Type** | ${operation.type.replace(/_/g, ' ').toUpperCase()} |
| **Status** | ${statusIcon} ${operation.status.toUpperCase()} |
| **Priority** | ${priorityIcon} ${priorityName} |
| **Source** | ${operation.source} |
| **Created** | ${new Date(operation.timestamp).toLocaleString()} |`;

        if (operation.startedAt) {
            details += `\n| **Started** | ${new Date(operation.startedAt).toLocaleString()} |`;
        }

        if (operation.completedAt) {
            details += `\n| **Completed** | ${new Date(operation.completedAt).toLocaleString()} |`;
        }

        details += `\n| **Retry Count** | ${operation.retryCount} / ${operation.maxRetries} |`;

        if (operation.estimatedDurationMs) {
            details += `\n| **Estimated Duration** | ${operation.estimatedDurationMs}ms |`;
        }

        if (operation.actualDurationMs) {
            details += `\n| **Actual Duration** | ${operation.actualDurationMs}ms |`;
        }

        // Dependencies
        if (operation.dependencies && operation.dependencies.length > 0) {
            details += `\n\n## Dependencies\n`;
            operation.dependencies.forEach(depId => {
                details += `- \`${depId}\`\n`;
            });
        }

        // Conflicts
        if (operation.conflictIds && operation.conflictIds.length > 0) {
            details += `\n\n## Conflicts\n`;
            operation.conflictIds.forEach(conflictId => {
                const conflict = this.conflictResolver.getConflictById(conflictId);
                if (conflict) {
                    details += `- **${conflict.type}**: ${conflict.description}\n`;
                } else {
                    details += `- \`${conflictId}\` (not found)\n`;
                }
            });
        }

        // Parameters
        details += `\n\n## Parameters\n\`\`\`json\n${JSON.stringify(operation.params, null, 2)}\n\`\`\``;

        // Result
        if (operation.result) {
            details += `\n\n## Result\n\`\`\`json\n${JSON.stringify(operation.result, null, 2)}\n\`\`\``;
        }

        // Error
        if (operation.error) {
            details += `\n\n## Error\n\`\`\`\n${operation.error}\n\`\`\``;
        }

        // Metadata
        if (operation.metadata && Object.keys(operation.metadata).length > 0) {
            details += `\n\n## Metadata\n\`\`\`json\n${JSON.stringify(operation.metadata, null, 2)}\n\`\`\``;
        }

        // Progress information for in-progress operations
        if (operation.status === McpOperationStatus.IN_PROGRESS) {
            const progress = this.calculateOperationProgress(operation);
            details += `\n\n## Progress\n**Current Progress:** ${progress}%\n`;

            if (operation.startedAt && operation.estimatedDurationMs) {
                const elapsed = Date.now() - new Date(operation.startedAt).getTime();
                const remaining = Math.max(0, operation.estimatedDurationMs - elapsed);
                details += `**Estimated Time Remaining:** ${Math.round(remaining / 1000)}s\n`;
            }
        }

        return details;
    }

    // Helper methods for enhanced functionality
    private getResolutionLabel(resolution: any): string {
        switch (resolution) {
            case 'extension_wins': return 'Extension Wins';
            case 'mcp_wins': return 'MCP Wins';
            case 'merge': return 'Merge Changes';
            case 'user_decide': return 'Manual Resolution';
            case 'retry': return 'Retry Operation';
            case 'cancel': return 'Cancel Operation';
            case 'defer': return 'Defer Operation';
            case 'reorder': return 'Reorder Operations';
            case 'split': return 'Split Operation';
            default: return resolution.toString();
        }
    }

    private getResolutionDescription(resolution: any): string {
        switch (resolution) {
            case 'extension_wins': return 'Use the extension version and discard MCP changes';
            case 'mcp_wins': return 'Use the MCP version and discard extension changes';
            case 'merge': return 'Attempt to merge both versions automatically';
            case 'user_decide': return 'Show detailed diff and let user choose';
            case 'retry': return 'Retry the failed operation';
            case 'cancel': return 'Cancel the conflicting operation';
            case 'defer': return 'Postpone the operation until later';
            case 'reorder': return 'Change the order of operations';
            case 'split': return 'Split the operation into smaller parts';
            default: return 'Apply this resolution strategy';
        }
    }

    private getSeverityIcon(severity: string): string {
        switch (severity) {
            case 'critical': return '🚨';
            case 'high': return '⚠️';
            case 'medium': return '🔶';
            case 'low': return 'ℹ️';
            default: return '❓';
        }
    }

    private getStatusIcon(status: McpOperationStatus): string {
        switch (status) {
            case McpOperationStatus.PENDING: return '⏳';
            case McpOperationStatus.IN_PROGRESS: return '🔄';
            case McpOperationStatus.COMPLETED: return '✅';
            case McpOperationStatus.FAILED: return '❌';
            case McpOperationStatus.CANCELLED: return '🚫';
            default: return '❓';
        }
    }

    private getPriorityName(priority: McpOperationPriority): string {
        switch (priority) {
            case McpOperationPriority.URGENT: return 'Urgent';
            case McpOperationPriority.HIGH: return 'High';
            case McpOperationPriority.NORMAL: return 'Normal';
            case McpOperationPriority.LOW: return 'Low';
            default: return 'Unknown';
        }
    }

    private getPriorityIcon(priority: McpOperationPriority): string {
        switch (priority) {
            case McpOperationPriority.URGENT: return '🔴';
            case McpOperationPriority.HIGH: return '🟠';
            case McpOperationPriority.NORMAL: return '🟡';
            case McpOperationPriority.LOW: return '🟢';
            default: return '⚪';
        }
    }

    private calculateOperationProgress(operation: McpOperation): number {
        if (operation.status === McpOperationStatus.COMPLETED) {return 100;}
        if (operation.status === McpOperationStatus.FAILED || operation.status === McpOperationStatus.CANCELLED) {return 0;}
        if (operation.status === McpOperationStatus.PENDING) {return 0;}

        // For in-progress operations, estimate based on elapsed time and estimated duration
        if (operation.status === McpOperationStatus.IN_PROGRESS) {
            if (!operation.startedAt || !operation.estimatedDurationMs) {return 50;} // Default 50% if no timing info

            const elapsed = Date.now() - new Date(operation.startedAt).getTime();
            const progress = Math.min(95, (elapsed / operation.estimatedDurationMs) * 100); // Cap at 95%
            return Math.round(progress);
        }

        return 0;
    }

    refresh(): void {
        this.provider.refresh();
    }

    // Enhanced file watcher integration
    setupFileWatchers(context: vscode.ExtensionContext): void {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        // Watch for operation queue changes
        const queuePattern = new vscode.RelativePattern(workspaceFolder, 'mcp-operations.json');
        const queueWatcher = vscode.workspace.createFileSystemWatcher(queuePattern);

        queueWatcher.onDidChange(() => {
            console.log('Operation queue file changed, refreshing view...');
            this.provider.refresh();
        });

        queueWatcher.onDidCreate(() => {
            console.log('Operation queue file created, refreshing view...');
            this.provider.refresh();
        });

        queueWatcher.onDidDelete(() => {
            console.log('Operation queue file deleted, refreshing view...');
            this.provider.refresh();
        });

        // Watch for sync state changes
        const syncPattern = new vscode.RelativePattern(workspaceFolder, 'specforge-sync.json');
        const syncWatcher = vscode.workspace.createFileSystemWatcher(syncPattern);

        syncWatcher.onDidChange(() => {
            console.log('Sync state file changed, refreshing view...');
            this.provider.refresh();
        });

        // Watch for operation results changes
        const resultsPattern = new vscode.RelativePattern(workspaceFolder, 'mcp-results.json');
        const resultsWatcher = vscode.workspace.createFileSystemWatcher(resultsPattern);

        resultsWatcher.onDidChange(() => {
            console.log('Operation results file changed, refreshing view...');
            this.provider.refresh();
        });

        context.subscriptions.push(queueWatcher, syncWatcher, resultsWatcher);
    }

    dispose(): void {
        if (this.provider.refreshTimer) {
            clearTimeout(this.provider.refreshTimer);
        }
        this.treeView.dispose();
    }
}
