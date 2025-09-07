import * as vscode from 'vscode';
import { SpecificationManager } from './specificationManager';
import { McpManager } from '../mcp/mcpManager';
import { McpDiscoveryService } from '../services/McpDiscoveryService';

interface StatusBarState {
    specifications: {
        total: number;
        current?: string;
        progress?: number;
    };
    mcp: {
        connected: boolean;
        clientsCount: number;
        configuredClients: number;
        serversCount: number;
        lastSync?: Date;
        hasIssues: boolean;
        recommendationsCount: number;
    };
}

export class EnhancedStatusBarManager implements vscode.Disposable {
    private statusBarItem: vscode.StatusBarItem;
    private mcpStatusBarItem: vscode.StatusBarItem;
    private discoveryUpdateInterval: NodeJS.Timer | null = null;
    private lastState: StatusBarState | null = null;

    constructor(
        private specificationManager: SpecificationManager,
        private mcpManager: McpManager,
        private discoveryService: McpDiscoveryService
    ) {
        // Create specification status bar item
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100 // Priority
        );
        this.statusBarItem.name = 'SpecForged';
        
        // Create MCP status bar item
        this.mcpStatusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            99 // Priority (slightly lower than specs)
        );
        this.mcpStatusBarItem.name = 'SpecForged MCP';

        // Set up periodic updates for MCP status
        this.discoveryUpdateInterval = setInterval(() => {
            this.updateMcpStatus();
        }, 60000); // Update every minute

        // Initial update
        this.update();
    }

    public async update(): Promise<void> {
        await Promise.all([
            this.updateSpecificationStatus(),
            this.updateMcpStatus()
        ]);
    }

    private async updateSpecificationStatus(): Promise<void> {
        try {
            const hasSpecs = this.specificationManager.hasSpecifications();
            const specs = this.specificationManager.getSpecifications();
            const currentSpec = this.getCurrentSpecification();

            if (!hasSpecs) {
                this.statusBarItem.text = '$(book) SpecForged';
                this.statusBarItem.tooltip = new vscode.MarkdownString(`
**SpecForged** - Specification-driven development

No specifications found. [Initialize project](command:specforged.initialize) to get started.
                `);
                this.statusBarItem.command = 'specforged.initialize';
                this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
            } else {
                const totalTasks = this.getTotalTasks(specs);
                const completedTasks = this.getCompletedTasks(specs);
                const progressPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

                if (currentSpec) {
                    this.statusBarItem.text = `$(book) ${currentSpec} (${progressPercent}%)`;
                    this.statusBarItem.tooltip = this.createSpecificationTooltip(currentSpec, specs, progressPercent, completedTasks, totalTasks);
                } else {
                    this.statusBarItem.text = `$(book) ${specs.length} specs (${progressPercent}%)`;
                    this.statusBarItem.tooltip = this.createSpecificationTooltip(null, specs, progressPercent, completedTasks, totalTasks);
                }

                this.statusBarItem.command = 'specforged.showCurrentSpec';
                this.statusBarItem.color = progressPercent === 100 ? 
                    new vscode.ThemeColor('statusBarItem.prominentForeground') : 
                    undefined;
            }

            this.statusBarItem.show();
        } catch (error) {
            console.error('Failed to update specification status:', error);
            this.statusBarItem.text = '$(error) SpecForged Error';
            this.statusBarItem.tooltip = `Error updating status: ${error}`;
            this.statusBarItem.show();
        }
    }

    private async updateMcpStatus(): Promise<void> {
        try {
            const discovery = await this.discoveryService.discoverMcpEcosystem();
            const serverStatus = await this.mcpManager.getServerStatus();
            
            const installedClients = discovery.clients.filter(c => c.isInstalled).length;
            const configuredClients = discovery.configuredClients;
            const totalServers = discovery.servers.size;
            const hasHighPriorityIssues = discovery.recommendations.some(r => r.priority === 'high');
            const recommendationsCount = discovery.recommendations.length;

            // Update state for comparison
            const newState: StatusBarState = {
                specifications: {
                    total: this.specificationManager.getSpecifications().length,
                    current: this.getCurrentSpecification() || undefined,
                    progress: this.getOverallProgress()
                },
                mcp: {
                    connected: serverStatus.online,
                    clientsCount: installedClients,
                    configuredClients,
                    serversCount: totalServers,
                    lastSync: new Date(),
                    hasIssues: hasHighPriorityIssues || discovery.healthIssues.length > 0,
                    recommendationsCount
                }
            };

            // Determine status icon and color
            let statusIcon = '$(plug)';
            let statusColor: vscode.ThemeColor | undefined;
            let statusText = '';

            if (configuredClients === 0) {
                statusIcon = '$(warning)';
                statusColor = new vscode.ThemeColor('statusBarItem.warningForeground');
                statusText = 'MCP Not Configured';
            } else if (hasHighPriorityIssues) {
                statusIcon = '$(issues)';
                statusColor = new vscode.ThemeColor('statusBarItem.errorForeground');
                statusText = `MCP Issues (${recommendationsCount})`;
            } else if (configuredClients < installedClients) {
                statusIcon = '$(warning)';
                statusColor = new vscode.ThemeColor('statusBarItem.warningForeground');
                statusText = `MCP Partial (${configuredClients}/${installedClients})`;
            } else {
                statusIcon = '$(check)';
                statusColor = new vscode.ThemeColor('statusBarItem.prominentForeground');
                statusText = `MCP Ready (${configuredClients})`;
            }

            this.mcpStatusBarItem.text = `${statusIcon} ${statusText}`;
            this.mcpStatusBarItem.color = statusColor;
            this.mcpStatusBarItem.tooltip = this.createMcpTooltip(discovery, serverStatus);
            this.mcpStatusBarItem.command = this.getMcpCommand(newState.mcp);

            // Show notification on significant state changes
            if (this.shouldShowNotification(this.lastState, newState)) {
                this.showStateChangeNotification(this.lastState, newState);
            }

            this.lastState = newState;
            this.mcpStatusBarItem.show();
        } catch (error) {
            console.error('Failed to update MCP status:', error);
            this.mcpStatusBarItem.text = '$(error) MCP Error';
            this.mcpStatusBarItem.tooltip = `MCP Status Error: ${error}`;
            this.mcpStatusBarItem.color = new vscode.ThemeColor('statusBarItem.errorForeground');
            this.mcpStatusBarItem.command = 'specforged.troubleshootSetup';
            this.mcpStatusBarItem.show();
        }
    }

    private createSpecificationTooltip(
        currentSpec: string | null, 
        specs: any[], 
        progressPercent: number,
        completedTasks: number,
        totalTasks: number
    ): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();
        
        tooltip.appendMarkdown(`**SpecForged** - Specification-driven development\n\n`);
        
        if (currentSpec) {
            tooltip.appendMarkdown(`**Current Spec:** ${currentSpec}\n`);
        }
        
        tooltip.appendMarkdown(`**Specifications:** ${specs.length}\n`);
        tooltip.appendMarkdown(`**Overall Progress:** ${progressPercent}% (${completedTasks}/${totalTasks} tasks)\n\n`);
        
        tooltip.appendMarkdown(`**Quick Actions:**\n`);
        tooltip.appendMarkdown(`• [View Current Spec](command:specforged.showCurrentSpec)\n`);
        tooltip.appendMarkdown(`• [Create New Spec](command:specforged.createSpec)\n`);
        tooltip.appendMarkdown(`• [Open Requirements](command:specforged.openRequirements)\n`);
        tooltip.appendMarkdown(`• [Open Tasks](command:specforged.openTasks)\n`);
        
        return tooltip;
    }

    private createMcpTooltip(discovery: any, serverStatus: any): vscode.MarkdownString {
        const tooltip = new vscode.MarkdownString();
        
        tooltip.appendMarkdown(`**MCP Ecosystem Status**\n\n`);
        
        tooltip.appendMarkdown(`**Clients:** ${discovery.configuredClients}/${discovery.totalClients} configured\n`);
        tooltip.appendMarkdown(`**Servers:** ${discovery.servers.size} configured\n`);
        tooltip.appendMarkdown(`**Connection:** ${serverStatus.connected ? '🟢 Connected' : '🔴 Disconnected'}\n`);
        
        if (discovery.recommendations.length > 0) {
            const highPriority = discovery.recommendations.filter((r: any) => r.priority === 'high').length;
            const mediumPriority = discovery.recommendations.filter((r: any) => r.priority === 'medium').length;
            
            tooltip.appendMarkdown(`\n**Recommendations:** ${discovery.recommendations.length} total\n`);
            if (highPriority > 0) tooltip.appendMarkdown(`• 🔴 ${highPriority} high priority\n`);
            if (mediumPriority > 0) tooltip.appendMarkdown(`• 🟡 ${mediumPriority} medium priority\n`);
        }
        
        // Show installed clients
        if (discovery.clients.length > 0) {
            tooltip.appendMarkdown(`\n**Detected Clients:**\n`);
            discovery.clients.forEach((client: any) => {
                const status = client.isInstalled ? 
                    (client.configExists ? '✅' : '⚠️') : '❌';
                tooltip.appendMarkdown(`• ${status} ${client.displayName}\n`);
            });
        }
        
        tooltip.appendMarkdown(`\n**Quick Actions:**\n`);
        tooltip.appendMarkdown(`• [Open Dashboard](command:specforged.openMcpDashboard)\n`);
        tooltip.appendMarkdown(`• [Quick Setup](command:specforged.quickMcpSetup)\n`);
        tooltip.appendMarkdown(`• [Troubleshoot](command:specforged.troubleshootSetup)\n`);
        tooltip.appendMarkdown(`• [Refresh Status](command:specforged.refreshMcpDetection)\n`);
        
        return tooltip;
    }

    private getMcpCommand(mcpState: any): string {
        if (mcpState.configuredClients === 0) {
            return 'specforged.quickMcpSetup';
        } else if (mcpState.hasIssues) {
            return 'specforged.troubleshootSetup';
        } else if (mcpState.configuredClients < mcpState.clientsCount) {
            return 'specforged.configureAllMcp';
        } else {
            return 'specforged.openMcpDashboard';
        }
    }

    private shouldShowNotification(oldState: StatusBarState | null, newState: StatusBarState): boolean {
        if (!oldState) return false;

        // Show notification when MCP setup improves significantly
        if (oldState.mcp.configuredClients === 0 && newState.mcp.configuredClients > 0) {
            return true;
        }

        // Show notification when high-priority issues are resolved
        if (oldState.mcp.hasIssues && !newState.mcp.hasIssues) {
            return true;
        }

        // Show notification when new clients are detected
        if (newState.mcp.clientsCount > oldState.mcp.clientsCount) {
            return true;
        }

        return false;
    }

    private showStateChangeNotification(oldState: StatusBarState | null, newState: StatusBarState): void {
        if (!oldState) return;

        if (oldState.mcp.configuredClients === 0 && newState.mcp.configuredClients > 0) {
            vscode.window.showInformationMessage(
                `🎉 MCP configured for ${newState.mcp.configuredClients} client${newState.mcp.configuredClients === 1 ? '' : 's'}!`,
                'View Dashboard', 'Dismiss'
            ).then(action => {
                if (action === 'View Dashboard') {
                    vscode.commands.executeCommand('specforged.openMcpDashboard');
                }
            });
        }

        if (oldState.mcp.hasIssues && !newState.mcp.hasIssues) {
            vscode.window.showInformationMessage(
                '✅ All MCP setup issues resolved!',
                'View Dashboard'
            ).then(action => {
                if (action === 'View Dashboard') {
                    vscode.commands.executeCommand('specforged.openMcpDashboard');
                }
            });
        }

        if (newState.mcp.clientsCount > oldState.mcp.clientsCount) {
            const newClients = newState.mcp.clientsCount - oldState.mcp.clientsCount;
            vscode.window.showInformationMessage(
                `🔍 Detected ${newClients} new MCP client${newClients === 1 ? '' : 's'}!`,
                'Configure Now', 'View Dashboard'
            ).then(action => {
                if (action === 'Configure Now') {
                    vscode.commands.executeCommand('specforged.configureAllMcp');
                } else if (action === 'View Dashboard') {
                    vscode.commands.executeCommand('specforged.openMcpDashboard');
                }
            });
        }
    }

    private getCurrentSpecification(): string | null {
        // This would be implemented to get the currently active specification
        // For now, return null as a placeholder
        return null;
    }

    private getTotalTasks(specs: any[]): number {
        // This would calculate total tasks across all specifications
        return specs.reduce((total, spec) => total + (spec.tasks?.length || 0), 0);
    }

    private getCompletedTasks(specs: any[]): number {
        // This would calculate completed tasks across all specifications
        return specs.reduce((completed, spec) => {
            return completed + (spec.tasks?.filter((task: any) => task.completed).length || 0);
        }, 0);
    }

    private getOverallProgress(): number {
        const specs = this.specificationManager.getSpecifications();
        const totalTasks = this.getTotalTasks(specs);
        const completedTasks = this.getCompletedTasks(specs);
        
        return totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    }

    public showQuickActions(): void {
        const items = [
            {
                label: '$(dashboard) Open MCP Dashboard',
                description: 'View comprehensive MCP ecosystem status',
                command: 'specforged.openMcpDashboard'
            },
            {
                label: '$(rocket) Quick MCP Setup',
                description: 'Automatically configure MCP for detected clients',
                command: 'specforged.quickMcpSetup'
            },
            {
                label: '$(gear) Configure All Clients',
                description: 'Set up SpecForged for all installed MCP clients',
                command: 'specforged.configureAllMcp'
            },
            {
                label: '$(question) Troubleshoot Setup',
                description: 'Diagnose and fix MCP configuration issues',
                command: 'specforged.troubleshootSetup'
            },
            {
                label: '$(refresh) Refresh Detection',
                description: 'Re-scan for MCP clients and servers',
                command: 'specforged.refreshMcpDetection'
            },
            {
                label: '$(library) Browse Servers',
                description: 'Explore available MCP servers',
                command: 'specforged.browseServers'
            }
        ];

        vscode.window.showQuickPick(items, {
            title: 'SpecForged MCP Actions',
            placeHolder: 'Choose an action...'
        }).then(selected => {
            if (selected) {
                vscode.commands.executeCommand(selected.command);
            }
        });
    }

    public hide(): void {
        this.statusBarItem.hide();
        this.mcpStatusBarItem.hide();
    }

    public show(): void {
        this.statusBarItem.show();
        this.mcpStatusBarItem.show();
    }

    public dispose(): void {
        if (this.discoveryUpdateInterval) {
            clearInterval(this.discoveryUpdateInterval);
            this.discoveryUpdateInterval = null;
        }
        
        this.statusBarItem.dispose();
        this.mcpStatusBarItem.dispose();
    }
}