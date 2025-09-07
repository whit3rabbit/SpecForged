import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { McpDiscoveryService, McpDiscoveryResult } from '../services/McpDiscoveryService';
import { McpConfigSyncService } from '../services/McpConfigSyncService';
import { EnhancedMcpCommandsHandler } from '../commands/enhancedMcpCommands';

export class McpDashboardProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'specforged.mcpDashboard';
    
    private _view?: vscode.WebviewView;
    private _refreshInterval?: NodeJS.Timer;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly discoveryService: McpDiscoveryService,
        private readonly configSyncService: McpConfigSyncService,
        private readonly commandsHandler: EnhancedMcpCommandsHandler,
        private readonly context: vscode.ExtensionContext
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(
            message => this._handleWebviewMessage(message),
            undefined,
            this.context.subscriptions
        );

        // Set up auto-refresh
        this._refreshInterval = setInterval(() => {
            this._refreshData();
        }, 30000); // Refresh every 30 seconds

        // Initial data load
        this._refreshData();

        // Handle view disposal
        webviewView.onDidDispose(() => {
            if (this._refreshInterval) {
                clearInterval(this._refreshInterval);
                this._refreshInterval = undefined;
            }
        });
    }

    public show() {
        if (this._view) {
            this._view.show?.(true);
            this._refreshData();
        }
    }

    public async refresh() {
        await this._refreshData();
    }

    private async _refreshData() {
        if (!this._view) {
            return;
        }

        try {
            const discoveryResult = await this.discoveryService.discoverMcpEcosystem(true);
            
            this._view.webview.postMessage({
                command: 'updateData',
                data: this._transformDiscoveryData(discoveryResult)
            });
        } catch (error) {
            console.error('Failed to refresh dashboard data:', error);
            this._view.webview.postMessage({
                command: 'showNotification',
                type: 'error',
                message: `Failed to refresh data: ${error instanceof Error ? error.message : 'Unknown error'}`
            });
        }
    }

    private _transformDiscoveryData(result: McpDiscoveryResult) {
        return {
            clients: result.clients.map(client => ({
                ...client,
                // Add UI-specific properties
                displayStatus: this._getClientDisplayStatus(client),
                actions: this._getClientActions(client)
            })),
            servers: result.servers,
            recommendations: result.recommendations.map(rec => ({
                ...rec,
                // Add UI-specific properties
                displayIcon: this._getRecommendationIcon(rec.type),
                actionLabel: this._getRecommendationActionLabel(rec.type)
            })),
            stats: {
                totalClients: result.totalClients,
                configuredClients: result.configuredClients,
                totalServers: result.servers.size,
                activeServers: Array.from(result.servers.values()).filter(s => s.isConfigured).length,
                recommendations: result.recommendations.length,
                highPriorityRecommendations: result.recommendations.filter(r => r.priority === 'high').length
            }
        };
    }

    private _getClientDisplayStatus(client: any) {
        if (!client.isInstalled) {
            return { status: 'offline', text: 'Not installed', color: '#f44336' };
        }
        if (!client.configExists) {
            return { status: 'warning', text: 'Not configured', color: '#FF9800' };
        }
        if (client.isRunning) {
            return { status: 'online', text: 'Running', color: '#4CAF50' };
        }
        return { status: 'configured', text: 'Configured', color: '#2196F3' };
    }

    private _getClientActions(client: any) {
        const actions = [];
        
        if (client.isInstalled) {
            actions.push({
                id: 'configure',
                label: client.configExists ? 'Reconfigure' : 'Configure',
                primary: !client.configExists
            });
            actions.push({
                id: 'test',
                label: 'Test Connection',
                primary: false
            });
            if (client.configExists) {
                actions.push({
                    id: 'backup',
                    label: 'Backup Config',
                    primary: false
                });
            }
        } else {
            actions.push({
                id: 'install',
                label: 'View Install Instructions',
                primary: true
            });
        }

        return actions;
    }

    private _getRecommendationIcon(type: string): string {
        const iconMap: Record<string, string> = {
            install_client: '📱',
            configure_server: '⚙️',
            fix_config: '🔧',
            upgrade: '⬆️',
            sync_config: '🔄',
            backup_config: '💾'
        };
        return iconMap[type] || '💡';
    }

    private _getRecommendationActionLabel(type: string): string {
        const labelMap: Record<string, string> = {
            install_client: 'Install',
            configure_server: 'Configure',
            fix_config: 'Fix',
            upgrade: 'Upgrade',
            sync_config: 'Sync',
            backup_config: 'Backup'
        };
        return labelMap[type] || 'Apply';
    }

    private async _handleWebviewMessage(message: any) {
        switch (message.command) {
            case 'loadData':
                await this._refreshData();
                break;

            case 'refreshData':
                this.discoveryService.clearCache();
                await this._refreshData();
                this._showNotification('info', 'MCP ecosystem data refreshed');
                break;

            case 'quickSetup':
                await this._executeQuickSetup();
                break;

            case 'configureClient':
                await this._configureClient(message.clientId);
                break;

            case 'testClient':
                await this._testClient(message.clientId);
                break;

            case 'installClient':
                await this._showInstallInstructions(message.clientId);
                break;

            case 'configureServer':
                await this._configureServer(message.serverName);
                break;

            case 'testServer':
                await this._testServer(message.serverName);
                break;

            case 'browseServers':
                await this._browseServers();
                break;

            case 'addClient':
                await this._addClient();
                break;

            case 'executeRecommendation':
                await this._executeRecommendation(message.actionId, message.params);
                break;

            default:
                console.warn('Unknown webview message:', message.command);
        }
    }

    private async _executeQuickSetup() {
        try {
            this._showNotification('info', 'Starting quick MCP setup...');
            await vscode.commands.executeCommand('specforged.quickMcpSetup');
            
            // Refresh data after setup
            setTimeout(() => this._refreshData(), 2000);
        } catch (error) {
            this._showNotification('error', `Quick setup failed: ${error}`);
        }
    }

    private async _configureClient(clientId: string) {
        try {
            this._showNotification('info', `Configuring ${clientId}...`);
            await vscode.commands.executeCommand('specforged.setupMcpForClient', clientId);
            
            // Refresh data after configuration
            setTimeout(() => this._refreshData(), 1000);
        } catch (error) {
            this._showNotification('error', `Failed to configure client: ${error}`);
        }
    }

    private async _testClient(clientId: string) {
        try {
            this._showNotification('info', `Testing ${clientId} connection...`);
            await vscode.commands.executeCommand('specforged.testServerConnection', clientId);
        } catch (error) {
            this._showNotification('error', `Connection test failed: ${error}`);
        }
    }

    private async _showInstallInstructions(clientId: string) {
        try {
            const client = await this.discoveryService.getClientById(clientId);
            if (client) {
                const instructions = this._getInstallationInstructions(client);
                
                const action = await vscode.window.showInformationMessage(
                    `Install ${client.displayName}`,
                    {
                        modal: true,
                        detail: instructions
                    },
                    'Open Website', 'Show All Instructions'
                );

                if (action === 'Open Website') {
                    const urls: Record<string, string> = {
                        claude: 'https://claude.ai/download',
                        cursor: 'https://cursor.so',
                        windsurf: 'https://codeium.com/windsurf',
                        zed: 'https://zed.dev'
                    };
                    
                    const url = urls[client.id];
                    if (url) {
                        vscode.env.openExternal(vscode.Uri.parse(url));
                    }
                } else if (action === 'Show All Instructions') {
                    await vscode.commands.executeCommand('specforged.showInstallationInstructions');
                }
            }
        } catch (error) {
            this._showNotification('error', `Failed to show instructions: ${error}`);
        }
    }

    private _getInstallationInstructions(client: any): string {
        const instructions: Record<string, string> = {
            claude: 'Download Claude Desktop from claude.ai/download and install the application.',
            cursor: 'Download Cursor from cursor.so - it\'s a VS Code fork with AI features built-in.',
            windsurf: 'Download Windsurf from codeium.com/windsurf - an AI-powered IDE by Codeium.',
            zed: 'Download Zed from zed.dev - a high-performance, multiplayer code editor.',
            neovim: 'Install Neovim and the MCP.nvim plugin for MCP support.'
        };
        return instructions[client.id] || 'Check the official website for installation instructions.';
    }

    private async _configureServer(serverName: string) {
        try {
            this._showNotification('info', `Configuring ${serverName}...`);
            await vscode.commands.executeCommand('specforged.manageServers');
        } catch (error) {
            this._showNotification('error', `Failed to configure server: ${error}`);
        }
    }

    private async _testServer(serverName: string) {
        try {
            this._showNotification('info', `Testing ${serverName}...`);
            await vscode.commands.executeCommand('specforged.testServerConnection', serverName);
        } catch (error) {
            this._showNotification('error', `Server test failed: ${error}`);
        }
    }

    private async _browseServers() {
        try {
            await vscode.commands.executeCommand('specforged.browseServers');
        } catch (error) {
            this._showNotification('error', `Failed to browse servers: ${error}`);
        }
    }

    private async _addClient() {
        try {
            await vscode.commands.executeCommand('specforged.selectMcpClient');
        } catch (error) {
            this._showNotification('error', `Failed to add client: ${error}`);
        }
    }

    private async _executeRecommendation(actionId: string, params: any) {
        try {
            this._showNotification('info', 'Executing recommendation...');
            
            // Map action IDs to actual commands
            const commandMap: Record<string, string> = {
                'install_client': 'specforged.selectMcpClient',
                'configure_server': 'specforged.setupMcpForClient',
                'fix_config': 'specforged.troubleshootSetup',
                'upgrade': 'specforged.manageServers',
                'sync_config': 'specforged.syncConfigToClients',
                'backup_config': 'specforged.backupConfigurations'
            };

            const command = commandMap[actionId];
            if (command) {
                await vscode.commands.executeCommand(command, params);
                
                // Refresh data after action
                setTimeout(() => this._refreshData(), 2000);
            } else {
                this._showNotification('warning', 'Action not yet implemented');
            }
        } catch (error) {
            this._showNotification('error', `Failed to execute recommendation: ${error}`);
        }
    }

    private _showNotification(type: 'info' | 'warning' | 'error' | 'success', message: string) {
        if (this._view) {
            this._view.webview.postMessage({
                command: 'showNotification',
                type,
                message
            });
        }

        // Also show VS Code notification for important messages
        if (type === 'error') {
            vscode.window.showErrorMessage(message);
        } else if (type === 'warning') {
            vscode.window.showWarningMessage(message);
        } else if (type === 'success') {
            vscode.window.showInformationMessage(message);
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // Get the local path to the dashboard HTML file
        const dashboardPath = vscode.Uri.joinPath(this._extensionUri, 'src', 'webview', 'dashboard.html');
        
        try {
            let htmlContent = fs.readFileSync(dashboardPath.fsPath, 'utf8');
            
            // Replace any resource URIs if needed
            // For now, we're using inline CSS and JS, so no replacements needed
            
            return htmlContent;
        } catch (error) {
            console.error('Failed to load dashboard HTML:', error);
            return this._getFallbackHtml();
        }
    }

    private _getFallbackHtml(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MCP Dashboard</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-background);
            padding: 20px;
            text-align: center;
        }
        .error {
            color: var(--vscode-errorForeground);
            margin: 20px 0;
        }
        .retry-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
        }
    </style>
</head>
<body>
    <h1>MCP Dashboard</h1>
    <div class="error">
        Failed to load dashboard. Please try refreshing.
    </div>
    <button class="retry-btn" onclick="location.reload()">Retry</button>
</body>
</html>`;
    }

    public dispose() {
        if (this._refreshInterval) {
            clearInterval(this._refreshInterval);
            this._refreshInterval = undefined;
        }
    }
}