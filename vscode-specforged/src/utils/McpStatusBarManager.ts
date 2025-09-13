import * as vscode from 'vscode';
import { McpSyncService } from '../services/mcpSyncService';
import { ConflictResolver } from '../utils/conflictResolver';
import {
    McpOperation,
    McpOperationStatus,
    McpOperationPriority,
    McpSyncState
} from '../models/mcpOperation';

export interface StatusBarConfiguration {
    showOperationCount: boolean;
    showServerStatus: boolean;
    showProgressIndicator: boolean;
    showConflictCount: boolean;
    autoHide: boolean;
    refreshInterval: number;
}

export class McpStatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private refreshTimer: NodeJS.Timeout | undefined;
    private lastUpdateTime: number = 0;
    private isDisposed: boolean = false;
    private config: StatusBarConfiguration;

    constructor(
        private mcpSyncService: McpSyncService,
        private conflictResolver: ConflictResolver,
        context: vscode.ExtensionContext
    ) {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100 // High priority
        );

        this.config = this.loadConfiguration();

        // Setup configuration watcher
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('specforged.statusBar')) {
                    this.config = this.loadConfiguration();
                    this.refresh();
                }
            })
        );

        context.subscriptions.push(this.statusBarItem);
        this.setupEventListeners(context);
        this.startAutoRefresh();
        this.refresh();
    }

    private loadConfiguration(): StatusBarConfiguration {
        const config = vscode.workspace.getConfiguration('specforged.statusBar');
        return {
            showOperationCount: config.get<boolean>('showOperationCount', true),
            showServerStatus: config.get<boolean>('showServerStatus', true),
            showProgressIndicator: config.get<boolean>('showProgressIndicator', true),
            showConflictCount: config.get<boolean>('showConflictCount', true),
            autoHide: config.get<boolean>('autoHide', false),
            refreshInterval: config.get<number>('refreshInterval', 2000)
        };
    }

    private setupEventListeners(context: vscode.ExtensionContext): void {
        // Listen for operation queue changes
        // Note: In a real implementation, you'd want to add event emitters to McpSyncService
        // For now, we'll rely on periodic refresh

        // Listen for VS Code window focus changes to update immediately
        context.subscriptions.push(
            vscode.window.onDidChangeWindowState(state => {
                if (state.focused) {
                    this.refresh();
                }
            })
        );
    }

    private startAutoRefresh(): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
        }

        this.refreshTimer = setInterval(() => {
            if (!this.isDisposed) {
                this.refresh();
            }
        }, this.config.refreshInterval);
    }

    public refresh(): void {
        if (this.isDisposed) {
            return;
        }

        try {
            const statusInfo = this.generateStatusInfo();
            this.updateStatusBar(statusInfo);
            this.lastUpdateTime = Date.now();
        } catch (error) {
            console.error('Error refreshing MCP status bar:', error);
            this.showErrorState();
        }
    }

    private generateStatusInfo(): StatusBarInfo {
        const queue = this.mcpSyncService.getOperationQueue();
        const syncState = this.mcpSyncService.getSyncState();
        const conflicts = this.conflictResolver.getActiveConflicts();

        // Group operations by status
        const operationCounts = {
            pending: queue.operations.filter(op => op.status === McpOperationStatus.PENDING).length,
            inProgress: queue.operations.filter(op => op.status === McpOperationStatus.IN_PROGRESS).length,
            failed: queue.operations.filter(op => op.status === McpOperationStatus.FAILED).length,
            completed: queue.operations.filter(op => op.status === McpOperationStatus.COMPLETED).length
        };

        // Calculate priority counts
        const urgentCount = queue.operations.filter(op =>
            op.priority === McpOperationPriority.URGENT &&
            (op.status === McpOperationStatus.PENDING || op.status === McpOperationStatus.FAILED)
        ).length;

        const criticalConflicts = conflicts.filter(c => c.severity === 'critical').length;

        return {
            serverOnline: syncState.mcpServerOnline,
            operationCounts,
            urgentCount,
            conflictCount: conflicts.length,
            criticalConflicts,
            lastSync: syncState.lastSync,
            hasActiveOperations: operationCounts.pending > 0 || operationCounts.inProgress > 0
        };
    }

    private updateStatusBar(info: StatusBarInfo): void {
        const { text, tooltip, color, command } = this.createStatusBarContent(info);

        this.statusBarItem.text = text;
        this.statusBarItem.tooltip = tooltip;
        this.statusBarItem.color = color;
        this.statusBarItem.command = command;

        // Show or hide based on configuration and activity
        if (this.config.autoHide && !info.hasActiveOperations && info.conflictCount === 0) {
            this.statusBarItem.hide();
        } else {
            this.statusBarItem.show();
        }
    }

    private createStatusBarContent(info: StatusBarInfo): StatusBarContent {
        const parts: string[] = [];
        const tooltipParts: string[] = [];

        // Server status indicator
        if (this.config.showServerStatus) {
            const serverIcon = info.serverOnline ? '$(check)' : '$(error)';
            const serverStatus = info.serverOnline ? 'Online' : 'Offline';
            parts.push(`${serverIcon}`);
            tooltipParts.push(`MCP Server: ${serverStatus}`);
        }

        // Operation count and progress
        if (this.config.showOperationCount || this.config.showProgressIndicator) {
            const totalActive = info.operationCounts.pending + info.operationCounts.inProgress;

            if (totalActive > 0) {
                let operationIcon = '$(sync)';
                if (info.operationCounts.inProgress > 0) {
                    operationIcon = '$(sync~spin)';
                }

                parts.push(`${operationIcon} ${totalActive}`);

                const operationDetails = [
                    info.operationCounts.pending > 0 ? `${info.operationCounts.pending} pending` : '',
                    info.operationCounts.inProgress > 0 ? `${info.operationCounts.inProgress} in progress` : '',
                    info.operationCounts.failed > 0 ? `${info.operationCounts.failed} failed` : ''
                ].filter(Boolean).join(', ');

                tooltipParts.push(`Operations: ${operationDetails}`);
            }
        }

        // Urgent operations
        if (info.urgentCount > 0) {
            parts.push(`$(warning) ${info.urgentCount}`);
            tooltipParts.push(`${info.urgentCount} urgent operations`);
        }

        // Conflicts
        if (this.config.showConflictCount && info.conflictCount > 0) {
            const conflictIcon = info.criticalConflicts > 0 ? '$(error)' : '$(alert)';
            parts.push(`${conflictIcon} ${info.conflictCount}`);
            tooltipParts.push(`${info.conflictCount} conflicts${info.criticalConflicts > 0 ? ` (${info.criticalConflicts} critical)` : ''}`);
        }

        // Determine overall color
        let color: vscode.ThemeColor | undefined;
        if (!info.serverOnline || info.criticalConflicts > 0) {
            color = new vscode.ThemeColor('statusBarItem.errorForeground');
        } else if (info.operationCounts.failed > 0 || info.conflictCount > 0) {
            color = new vscode.ThemeColor('statusBarItem.warningForeground');
        } else if (info.hasActiveOperations) {
            color = new vscode.ThemeColor('statusBarItem.prominentForeground');
        }

        // Last sync info
        if (info.lastSync) {
            const lastSyncTime = new Date(info.lastSync);
            const timeDiff = Date.now() - lastSyncTime.getTime();
            const minutes = Math.floor(timeDiff / 60000);
            const syncTimeText = minutes < 1 ? 'just now' : `${minutes}m ago`;
            tooltipParts.push(`Last sync: ${syncTimeText}`);
        }

        const text = parts.length > 0 ? `$(book) ${parts.join(' ')}` : '$(book) SpecForged';
        const tooltip = new vscode.MarkdownString([
            '## SpecForged MCP Status',
            '',
            ...tooltipParts.map(part => `• ${part}`),
            '',
            '**Click to view operation queue**'
        ].join('\n'));

        return {
            text,
            tooltip,
            color,
            command: {
                command: 'specforged.showOperationQueue',
                title: 'Show Operation Queue'
            }
        };
    }

    private showErrorState(): void {
        this.statusBarItem.text = '$(book) $(error) SpecForged';
        this.statusBarItem.tooltip = 'SpecForged: Error loading status';
        this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorForeground');
        this.statusBarItem.command = {
            command: 'specforged.showOperationQueue',
            title: 'Show Operation Queue'
        };
        this.statusBarItem.show();
    }

    // Public methods for external control

    public show(): void {
        this.statusBarItem.show();
    }

    public hide(): void {
        this.statusBarItem.hide();
    }

    public updateConfiguration(config: Partial<StatusBarConfiguration>): void {
        this.config = { ...this.config, ...config };
        this.refresh();

        // Restart auto-refresh if interval changed
        if (config.refreshInterval !== undefined) {
            this.startAutoRefresh();
        }
    }

    public forceUpdate(): void {
        this.refresh();
    }

    // Animation methods for visual feedback

    public showOperationStarted(): void {
        // Briefly highlight the status bar to indicate new operation
        const originalColor = this.statusBarItem.color;
        this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.prominentForeground');

        setTimeout(() => {
            this.statusBarItem.color = originalColor;
        }, 1000);
    }

    public showOperationCompleted(success: boolean): void {
        // Flash green for success, red for failure
        const originalColor = this.statusBarItem.color;
        const flashColor = success
            ? new vscode.ThemeColor('statusBarItem.prominentForeground')
            : new vscode.ThemeColor('statusBarItem.errorForeground');

        this.statusBarItem.color = flashColor;

        setTimeout(() => {
            this.statusBarItem.color = originalColor;
            this.refresh(); // Update with latest status
        }, 1500);
    }

    public dispose(): void {
        this.isDisposed = true;

        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
        }

        this.statusBarItem.dispose();
    }
}

// Helper interfaces
interface StatusBarInfo {
    serverOnline: boolean;
    operationCounts: {
        pending: number;
        inProgress: number;
        failed: number;
        completed: number;
    };
    urgentCount: number;
    conflictCount: number;
    criticalConflicts: number;
    lastSync?: string;
    hasActiveOperations: boolean;
}

interface StatusBarContent {
    text: string;
    tooltip: vscode.MarkdownString;
    color?: vscode.ThemeColor;
    command?: vscode.Command;
}
