import * as vscode from 'vscode';
import { SpecificationManager } from './specificationManager';
import { McpManager } from '../mcp/mcpManager';
import { TaskHelper } from '../models/task';

export class StatusBarManager {
    private statusBarItem: vscode.StatusBarItem;
    private mcpStatusItem: vscode.StatusBarItem;
    private progressStatusItem: vscode.StatusBarItem;
    private updateInterval: NodeJS.Timeout | undefined;

    constructor(
        private specManager: SpecificationManager,
        private mcpManager: McpManager
    ) {
        // Main status bar item - shows current spec
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.statusBarItem.command = 'specforged.showCurrentSpec';

        // MCP server status item
        this.mcpStatusItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            99
        );
        this.mcpStatusItem.command = 'specforged.setupMcp';

        // Progress status item
        this.progressStatusItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            98
        );

        this.startPeriodicUpdates();
        this.update();
    }

    private startPeriodicUpdates(): void {
        // Update every 30 seconds
        this.updateInterval = setInterval(() => {
            this.update();
        }, 30000);
    }

    async update(): Promise<void> {
        await this.updateMainStatus();
        await this.updateMcpStatus();
        this.updateProgressStatus();
    }

    private async updateMainStatus(): Promise<void> {
        const hasSpecs = this.specManager.hasSpecifications();
        const specCount = this.specManager.getSpecificationCount();
        const current = this.specManager.getCurrentSpecification();

        if (current) {
            this.statusBarItem.text = `$(book) ${current.spec.name}`;
            this.statusBarItem.tooltip = `Current specification: ${current.spec.name}`;
        } else if (hasSpecs) {
            this.statusBarItem.text = `$(book) ${specCount} spec${specCount === 1 ? '' : 's'}`;
            this.statusBarItem.tooltip = `SpecForged: ${specCount} specification${specCount === 1 ? '' : 's'} found`;
        } else {
            this.statusBarItem.text = '$(book) SpecForged';
            this.statusBarItem.tooltip = 'SpecForged: No specifications found - Click to create one';
        }

        this.statusBarItem.show();
    }

    private async updateMcpStatus(): Promise<void> {
        const serverStatus = await this.mcpManager.getServerStatus();
        const configuredIdes = this.mcpManager.getConfiguredIdes();
        const currentConnection = this.mcpManager.getCurrentConnection();

        const serverTypeIcon = this.getServerTypeIcon(serverStatus.type);
        const connectionIcon = serverStatus.connected ? '$(check)' : '$(warning)';

        if (!serverStatus.connected) {
            this.mcpStatusItem.text = `${connectionIcon} ${serverTypeIcon}`;
            this.mcpStatusItem.tooltip = `MCP ${serverStatus.type}: ${serverStatus.message}`;
            this.mcpStatusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else if (configuredIdes.length === 0) {
            this.mcpStatusItem.text = `${connectionIcon} ${serverTypeIcon}`;
            this.mcpStatusItem.tooltip = `MCP ${serverStatus.type} connected but not configured for IDEs - Click to configure`;
            this.mcpStatusItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
            this.mcpStatusItem.text = `${connectionIcon} ${serverTypeIcon}`;
            this.mcpStatusItem.tooltip = `MCP ${serverStatus.type} connected and configured for ${configuredIdes.length} IDE${configuredIdes.length === 1 ? '' : 's'}${serverStatus.url ? ` (${serverStatus.url})` : ''}`;
            this.mcpStatusItem.backgroundColor = undefined;
        }

        this.mcpStatusItem.show();
    }

    private getServerTypeIcon(serverType: string): string {
        switch (serverType) {
            case 'local':
                return '$(home)';
            case 'smithery':
                return '$(cloud)';
            case 'custom':
                return '$(globe)';
            default:
                return '$(gear)';
        }
    }

    private updateProgressStatus(): void {
        const current = this.specManager.getCurrentSpecification();

        if (current && current.spec.tasks.length > 0) {
            const progress = TaskHelper.calculateProgress(current.spec.tasks);

            if (progress.total > 0) {
                const icon = this.getProgressIcon(progress.percentage);
                this.progressStatusItem.text = `${icon} ${progress.percentage}%`;
                this.progressStatusItem.tooltip = `Progress: ${progress.completed}/${progress.total} tasks completed`;
                this.progressStatusItem.show();
            } else {
                this.progressStatusItem.hide();
            }
        } else {
            this.progressStatusItem.hide();
        }
    }

    private getProgressIcon(percentage: number): string {
        if (percentage === 0) return '$(circle-outline)';
        if (percentage < 25) return '$(circle-quarter)';
        if (percentage < 50) return '$(circle-half)';
        if (percentage < 75) return '$(circle-three-quarter)';
        if (percentage < 100) return '$(circle-filled)';
        return '$(check-all)';
    }

    showNotification(message: string, type: 'info' | 'warning' | 'error' = 'info'): void {
        switch (type) {
            case 'warning':
                vscode.window.showWarningMessage(message);
                break;
            case 'error':
                vscode.window.showErrorMessage(message);
                break;
            default:
                vscode.window.showInformationMessage(message);
                break;
        }
    }

    async showProgress<T>(
        title: string,
        task: (progress: vscode.Progress<{ message?: string; increment?: number }>) => Thenable<T>
    ): Promise<T> {
        return vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title,
            cancellable: false
        }, task);
    }

    dispose(): void {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
        }

        this.statusBarItem.dispose();
        this.mcpStatusItem.dispose();
        this.progressStatusItem.dispose();
    }
}
