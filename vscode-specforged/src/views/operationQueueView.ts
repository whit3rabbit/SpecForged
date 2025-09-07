import * as vscode from 'vscode';
import { McpSyncService } from '../services/mcpSyncService';
import { ConflictResolver, Conflict } from '../utils/conflictResolver';
import { McpOperation, McpOperationStatus } from '../models/mcpOperation';

export class OperationQueueProvider implements vscode.TreeDataProvider<OperationTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<OperationTreeItem | undefined | null | void> = new vscode.EventEmitter<OperationTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<OperationTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(
        private mcpSyncService: McpSyncService,
        private conflictResolver: ConflictResolver
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: OperationTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: OperationTreeItem): Promise<OperationTreeItem[]> {
        if (!element) {
            // Root level - show categories
            const items: OperationTreeItem[] = [];

            // Sync Status
            items.push(new OperationTreeItem(
                'Sync Status',
                vscode.TreeItemCollapsibleState.Expanded,
                'sync-status',
                undefined,
                this.getSyncStatusDescription()
            ));

            // Operation Queue
            const queue = this.mcpSyncService.getOperationQueue();
            if (queue.operations.length > 0) {
                items.push(new OperationTreeItem(
                    `Operation Queue (${queue.operations.length})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    'operation-queue'
                ));
            }

            // Conflicts
            const conflicts = this.conflictResolver.getActiveConflicts();
            if (conflicts.length > 0) {
                items.push(new OperationTreeItem(
                    `Conflicts (${conflicts.length})`,
                    vscode.TreeItemCollapsibleState.Expanded,
                    'conflicts',
                    undefined,
                    'Active conflicts requiring resolution'
                ));
            }

            return items;
        }

        if (element.contextValue === 'sync-status') {
            return this.getSyncStatusItems();
        }

        if (element.contextValue === 'operation-queue') {
            return this.getOperationQueueItems();
        }

        if (element.contextValue === 'conflicts') {
            return this.getConflictItems();
        }

        return [];
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

        // Group operations by status
        const pending = queue.operations.filter(op => op.status === McpOperationStatus.PENDING);
        const inProgress = queue.operations.filter(op => op.status === McpOperationStatus.IN_PROGRESS);
        const completed = queue.operations.filter(op => op.status === McpOperationStatus.COMPLETED);
        const failed = queue.operations.filter(op => op.status === McpOperationStatus.FAILED);

        if (pending.length > 0) {
            items.push(new OperationTreeItem(
                `⏳ Pending (${pending.length})`,
                vscode.TreeItemCollapsibleState.Expanded,
                'operation-status',
                { operations: pending, status: 'pending' }
            ));
        }

        if (inProgress.length > 0) {
            items.push(new OperationTreeItem(
                `🔄 In Progress (${inProgress.length})`,
                vscode.TreeItemCollapsibleState.Expanded,
                'operation-status',
                { operations: inProgress, status: 'in_progress' }
            ));
        }

        if (completed.length > 0) {
            items.push(new OperationTreeItem(
                `✅ Completed (${completed.length})`,
                vscode.TreeItemCollapsibleState.Collapsed,
                'operation-status',
                { operations: completed, status: 'completed' }
            ));
        }

        if (failed.length > 0) {
            items.push(new OperationTreeItem(
                `❌ Failed (${failed.length})`,
                vscode.TreeItemCollapsibleState.Expanded,
                'operation-status',
                { operations: failed, status: 'failed' }
            ));
        }

        return items;
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
            default: return '❗';
        }
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

        if (contextValue === 'operation') {
            this.iconPath = this.getOperationIcon(data as McpOperation);
        } else if (contextValue === 'conflict') {
            this.iconPath = new vscode.ThemeIcon('warning');
            this.command = {
                command: 'specforged.resolveConflict',
                title: 'Resolve Conflict',
                arguments: [data.id]
            };
        }
    }

    private getTooltip(): string {
        switch (this.contextValue) {
            case 'operation':
                const op = this.data as McpOperation;
                return `Operation: ${op.type}\nStatus: ${op.status}\nCreated: ${new Date(op.timestamp).toLocaleString()}\nRetries: ${op.retryCount}/${op.maxRetries}`;

            case 'conflict':
                const conflict = this.data as Conflict;
                return `Conflict: ${conflict.type}\nDescription: ${conflict.description}\nOperations: ${conflict.operations.length}\nCreated: ${new Date(conflict.timestamp).toLocaleString()}`;

            default:
                return this.label;
        }
    }

    private getOperationIcon(operation: McpOperation): vscode.ThemeIcon {
        switch (operation.status) {
            case McpOperationStatus.PENDING:
                return new vscode.ThemeIcon('clock');
            case McpOperationStatus.IN_PROGRESS:
                return new vscode.ThemeIcon('loading~spin');
            case McpOperationStatus.COMPLETED:
                return new vscode.ThemeIcon('check');
            case McpOperationStatus.FAILED:
                return new vscode.ThemeIcon('error');
            case McpOperationStatus.CANCELLED:
                return new vscode.ThemeIcon('x');
            default:
                return new vscode.ThemeIcon('circle-outline');
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
        this.setupAutoRefresh();
    }

    private setupCommands(context: vscode.ExtensionContext) {
        const commands = [
            vscode.commands.registerCommand('specforged.refreshQueue', () => {
                this.provider.refresh();
            }),

            vscode.commands.registerCommand('specforged.clearCompletedOperations', async () => {
                await this.mcpSyncService.cleanupOldOperations(0.1); // Clean operations older than 6 minutes
                this.provider.refresh();
                vscode.window.showInformationMessage('Completed operations cleared');
            }),

            vscode.commands.registerCommand('specforged.resolveConflict', async (conflictId: string) => {
                const conflict = this.conflictResolver.getConflictById(conflictId);
                if (!conflict) {
                    vscode.window.showErrorMessage('Conflict not found');
                    return;
                }

                const resolved = await this.conflictResolver.resolveConflict(conflictId);
                if (resolved) {
                    vscode.window.showInformationMessage(`Conflict resolved: ${conflict.description}`);
                    this.provider.refresh();
                } else {
                    vscode.window.showErrorMessage('Failed to resolve conflict');
                }
            }),

            vscode.commands.registerCommand('specforged.retryFailedOperations', async () => {
                const queue = this.mcpSyncService.getOperationQueue();
                const failedOps = queue.operations.filter(op => op.status === McpOperationStatus.FAILED);

                for (const op of failedOps) {
                    op.status = McpOperationStatus.PENDING;
                    op.retryCount = Math.min(op.retryCount + 1, op.maxRetries);
                    op.error = undefined;
                }

                if (failedOps.length > 0) {
                    // Trigger processing
                    await this.mcpSyncService.processOperations();
                    this.provider.refresh();
                    vscode.window.showInformationMessage(`Retrying ${failedOps.length} failed operations`);
                } else {
                    vscode.window.showInformationMessage('No failed operations to retry');
                }
            }),

            vscode.commands.registerCommand('specforged.showOperationDetails', (operation: McpOperation) => {
                this.showOperationDetails(operation);
            }),

            vscode.commands.registerCommand('specforged.forceSync', async () => {
                await this.mcpSyncService.processOperations();
                this.provider.refresh();
                vscode.window.showInformationMessage('Sync operation completed');
            })
        ];

        context.subscriptions.push(...commands);
    }

    private setupAutoRefresh() {
        // Refresh every 10 seconds
        setInterval(() => {
            this.provider.refresh();
        }, 10000);
    }

    private async showOperationDetails(operation: McpOperation) {
        const details = `# Operation Details

**ID:** ${operation.id}
**Type:** ${operation.type}
**Status:** ${operation.status}
**Priority:** ${operation.priority}
**Source:** ${operation.source}
**Created:** ${new Date(operation.timestamp).toLocaleString()}
${operation.completedAt ? `**Completed:** ${new Date(operation.completedAt).toLocaleString()}` : ''}

**Retry Count:** ${operation.retryCount} / ${operation.maxRetries}

## Parameters
\`\`\`json
${JSON.stringify(operation.params, null, 2)}
\`\`\`

${operation.result ? `## Result
\`\`\`json
${JSON.stringify(operation.result, null, 2)}
\`\`\`
` : ''}

${operation.error ? `## Error
${operation.error}
` : ''}
`;

        const doc = await vscode.workspace.openTextDocument({
            content: details,
            language: 'markdown'
        });

        await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Beside,
            preview: true
        });
    }

    refresh(): void {
        this.provider.refresh();
    }

    dispose(): void {
        this.treeView.dispose();
    }
}
