import * as vscode from 'vscode';
import { McpDiscoveryService, McpClient, McpRecommendation } from '../services/McpDiscoveryService';
import { McpConfigSyncService, ConfigSyncProfile, ServerConfig } from '../services/McpConfigSyncService';
import { UniversalMcpAdapter, McpConnectionConfig } from '../adapters/UniversalMcpAdapter';

export class EnhancedMcpCommandsHandler {
    private adapters = new Map<string, UniversalMcpAdapter>();

    constructor(
        private discoveryService: McpDiscoveryService,
        private syncService: McpConfigSyncService,
        private context: vscode.ExtensionContext
    ) {}

    registerCommands(context: vscode.ExtensionContext): void {
        const commands = [
            // Discovery and Detection
            vscode.commands.registerCommand('specforged.discoverMcpEcosystem', this.discoverMcpEcosystem.bind(this)),
            vscode.commands.registerCommand('specforged.refreshMcpDetection', this.refreshMcpDetection.bind(this)),
            vscode.commands.registerCommand('specforged.showMcpStatus', this.showMcpStatus.bind(this)),

            // Quick Setup and Configuration
            vscode.commands.registerCommand('specforged.quickMcpSetup', this.quickMcpSetup.bind(this)),
            vscode.commands.registerCommand('specforged.configureAllMcp', this.configureAllMcp.bind(this)),
            vscode.commands.registerCommand('specforged.selectMcpClient', this.selectMcpClient.bind(this)),
            vscode.commands.registerCommand('specforged.setupMcpForClient', this.setupMcpForClient.bind(this)),

            // Configuration Sync and Profiles
            vscode.commands.registerCommand('specforged.createSyncProfile', this.createSyncProfile.bind(this)),
            vscode.commands.registerCommand('specforged.applySyncProfile', this.applySyncProfile.bind(this)),
            vscode.commands.registerCommand('specforged.manageSyncProfiles', this.manageSyncProfiles.bind(this)),
            vscode.commands.registerCommand('specforged.syncConfigToClients', this.syncConfigToClients.bind(this)),

            // Server Management
            vscode.commands.registerCommand('specforged.browseServers', this.browseServers.bind(this)),
            vscode.commands.registerCommand('specforged.installServer', this.installServer.bind(this)),
            vscode.commands.registerCommand('specforged.testServerConnection', this.testServerConnection.bind(this)),
            vscode.commands.registerCommand('specforged.manageServers', this.manageServers.bind(this)),

            // Backup and Restore
            vscode.commands.registerCommand('specforged.backupConfigurations', this.backupConfigurations.bind(this)),
            vscode.commands.registerCommand('specforged.restoreConfiguration', this.restoreConfiguration.bind(this)),
            vscode.commands.registerCommand('specforged.manageBakups', this.manageBackups.bind(this)),

            // Project Templates
            vscode.commands.registerCommand('specforged.createProjectFromTemplate', this.createProjectFromTemplate.bind(this)),
            vscode.commands.registerCommand('specforged.shareProjectConfig', this.shareProjectConfig.bind(this)),

            // Diagnostics and Troubleshooting
            vscode.commands.registerCommand('specforged.diagnoseConnections', this.diagnoseConnections.bind(this)),
            vscode.commands.registerCommand('specforged.generateDiagnosticReport', this.generateDiagnosticReport.bind(this)),
            vscode.commands.registerCommand('specforged.troubleshootSetup', this.troubleshootSetup.bind(this))
        ];

        commands.forEach(disposable => context.subscriptions.push(disposable));
    }

    private async discoverMcpEcosystem(): Promise<void> {
        const discovery = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Discovering MCP Ecosystem',
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0, message: 'Scanning for MCP clients...' });
            return await this.discoveryService.discoverMcpEcosystem(true);
        });

        // Show results in a quickpick
        const items = discovery.clients.map(client => ({
            label: `${client.isInstalled ? '✅' : '❌'} ${client.displayName}`,
            detail: client.isInstalled ? 
                (client.configExists ? '⚙️ Configured' : '⚠️ Not configured') : 
                'Not installed',
            description: client.version || 'Unknown version',
            client
        }));

        const selected = await vscode.window.showQuickPick(items, {
            title: `MCP Ecosystem Discovery (${discovery.configuredClients}/${discovery.totalClients} configured)`,
            placeHolder: 'Select a client to configure or view details',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            await this.setupMcpForClient(selected.client.id);
        }
    }

    private async refreshMcpDetection(): Promise<void> {
        this.discoveryService.clearCache();
        await this.discoverMcpEcosystem();
    }

    private async showMcpStatus(): Promise<void> {
        const discovery = await this.discoveryService.discoverMcpEcosystem();
        
        const statusText = [
            `# MCP Ecosystem Status`,
            ``,
            `**Total Clients:** ${discovery.totalClients}`,
            `**Configured:** ${discovery.configuredClients}`,
            `**Servers Found:** ${discovery.servers.size}`,
            ``,
            `## Clients`,
            ...discovery.clients.map(client => 
                `- ${client.isInstalled ? '✅' : '❌'} **${client.displayName}** ${client.configExists ? '⚙️' : '⚪'}`
            ),
            ``,
            `## Servers`,
            ...Array.from(discovery.servers.values()).map(server =>
                `- **${server.name}**: ${server.clientsConfigured.length} clients`
            ),
            ``,
            `## Recommendations`,
            ...discovery.recommendations.map(rec =>
                `- ${rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢'} ${rec.title}`
            )
        ].join('\n');

        const doc = await vscode.workspace.openTextDocument({
            content: statusText,
            language: 'markdown'
        });

        await vscode.window.showTextDocument(doc, { preview: true });
    }

    private async quickMcpSetup(): Promise<void> {
        const discovery = await this.discoveryService.discoverMcpEcosystem();
        
        // Find the most suitable client for quick setup
        const installedClients = discovery.clients.filter(c => c.isInstalled);
        
        if (installedClients.length === 0) {
            const installChoice = await vscode.window.showInformationMessage(
                'No MCP clients detected. Would you like to see installation instructions?',
                'View Instructions', 'Cancel'
            );
            
            if (installChoice === 'View Instructions') {
                await this.showInstallationInstructions();
            }
            return;
        }

        // Use the highest priority installed client
        const bestClient = installedClients.sort((a, b) => b.priority - a.priority)[0];
        
        const shouldSetup = await vscode.window.showInformationMessage(
            `Quick setup will configure SpecForged for ${bestClient.displayName}. Continue?`,
            'Yes', 'Choose Different Client', 'Cancel'
        );

        if (shouldSetup === 'Yes') {
            await this.setupMcpForClient(bestClient.id);
        } else if (shouldSetup === 'Choose Different Client') {
            await this.selectMcpClient();
        }
    }

    private async configureAllMcp(): Promise<void> {
        const discovery = await this.discoveryService.discoverMcpEcosystem();
        const installedClients = discovery.clients.filter(c => c.isInstalled);

        if (installedClients.length === 0) {
            vscode.window.showWarningMessage('No MCP clients installed.');
            return;
        }

        const confirmed = await vscode.window.showWarningMessage(
            `This will configure SpecForged for all ${installedClients.length} installed MCP clients. Continue?`,
            'Configure All', 'Cancel'
        );

        if (confirmed !== 'Configure All') {
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Configuring All MCP Clients',
            cancellable: false
        }, async (progress) => {
            const total = installedClients.length;
            let completed = 0;

            for (const client of installedClients) {
                progress.report({
                    increment: (completed / total) * 100,
                    message: `Configuring ${client.displayName}...`
                });

                try {
                    await this.setupSpecForgedForClient(client);
                    completed++;
                } catch (error) {
                    console.error(`Failed to configure ${client.displayName}:`, error);
                }
            }

            progress.report({ increment: 100, message: 'Configuration complete!' });
        });

        vscode.window.showInformationMessage(`Configured SpecForged for ${installedClients.length} clients!`);
    }

    private async selectMcpClient(): Promise<void> {
        const discovery = await this.discoveryService.discoverMcpEcosystem();
        
        const items = discovery.clients.map(client => ({
            label: client.displayName,
            detail: client.isInstalled ? 
                (client.configExists ? 'Already configured' : 'Ready to configure') : 
                'Not installed',
            description: `Priority: ${client.priority}${client.version ? ` • Version: ${client.version}` : ''}`,
            iconPath: client.isInstalled ? 
                new vscode.ThemeIcon('check') : 
                new vscode.ThemeIcon('x'),
            client
        }));

        const selected = await vscode.window.showQuickPick(items, {
            title: 'Select MCP Client',
            placeHolder: 'Choose a client to configure',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selected) {
            if (!selected.client.isInstalled) {
                const install = await vscode.window.showInformationMessage(
                    `${selected.client.displayName} is not installed. Would you like to see installation instructions?`,
                    'View Instructions', 'Cancel'
                );
                
                if (install === 'View Instructions') {
                    await this.showClientInstallationInstructions(selected.client);
                }
            } else {
                await this.setupMcpForClient(selected.client.id);
            }
        }
    }

    private async setupMcpForClient(clientId: string): Promise<void> {
        const client = await this.discoveryService.getClientById(clientId);
        if (!client) {
            vscode.window.showErrorMessage(`Client ${clientId} not found`);
            return;
        }

        if (!client.isInstalled) {
            vscode.window.showWarningMessage(`${client.displayName} is not installed`);
            return;
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Configuring ${client.displayName}`,
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 0, message: 'Creating configuration...' });
            
            try {
                await this.setupSpecForgedForClient(client);
                progress.report({ increment: 100, message: 'Configuration complete!' });
                
                vscode.window.showInformationMessage(
                    `SpecForged configured for ${client.displayName}!`,
                    'Test Connection', 'View Config'
                ).then(action => {
                    if (action === 'Test Connection') {
                        this.testServerConnection(client.id);
                    } else if (action === 'View Config') {
                        vscode.workspace.openTextDocument(vscode.Uri.file(client.configPath))
                            .then(doc => vscode.window.showTextDocument(doc));
                    }
                });
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to configure ${client.displayName}: ${error}`);
            }
        });
    }

    private async setupSpecForgedForClient(client: McpClient): Promise<void> {
        const config: ServerConfig = {
            name: 'specforged',
            command: 'specforged',
            args: [],
            env: {},
            enabled: true
        };

        // Add workspace-specific environment variables for some clients
        if (['cursor', 'windsurf'].includes(client.id)) {
            const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
            if (workspacePath) {
                config.env = {
                    'SPECFORGE_PROJECT_ROOT': workspacePath,
                    'SPECFORGE_BASE_DIR': '.specifications'
                };
            }
        }

        await this.syncService.syncServerToClients('specforged', config, [client.id]);
    }

    private async createSyncProfile(): Promise<void> {
        const name = await vscode.window.showInputBox({
            title: 'Create Sync Profile',
            placeHolder: 'Enter profile name',
            validateInput: (value) => {
                if (!value.trim()) {
                    return 'Profile name is required';
                }
                return null;
            }
        });

        if (!name) return;

        const description = await vscode.window.showInputBox({
            title: 'Profile Description',
            placeHolder: 'Enter description (optional)'
        });

        const discovery = await this.discoveryService.discoverMcpEcosystem();
        const clients = await vscode.window.showQuickPick(
            discovery.clients.filter(c => c.isInstalled).map(c => ({
                label: c.displayName,
                description: c.configExists ? 'Configured' : 'Not configured',
                picked: c.configExists,
                client: c
            })),
            {
                title: 'Select Target Clients',
                canPickMany: true,
                placeHolder: 'Choose clients for this profile'
            }
        );

        if (!clients || clients.length === 0) return;

        // For now, create a profile with SpecForged server
        const servers = {
            specforged: {
                name: 'specforged',
                command: 'specforged',
                args: [],
                env: {},
                enabled: true
            }
        };

        const profile = await this.syncService.createProfile(
            name,
            description || '',
            servers,
            clients.map(c => c.client.id)
        );

        vscode.window.showInformationMessage(
            `Created sync profile '${profile.name}'`,
            'Apply Now', 'Manage Profiles'
        ).then(action => {
            if (action === 'Apply Now') {
                this.applySyncProfile(profile.id);
            } else if (action === 'Manage Profiles') {
                this.manageSyncProfiles();
            }
        });
    }

    private async applySyncProfile(profileId?: string): Promise<void> {
        let profile;
        
        if (profileId) {
            profile = this.syncService.getProfile(profileId);
        } else {
            const profiles = this.syncService.getProfiles();
            if (profiles.length === 0) {
                vscode.window.showInformationMessage('No sync profiles found. Create one first.');
                return;
            }

            const selected = await vscode.window.showQuickPick(
                profiles.map(p => ({
                    label: p.name,
                    detail: p.description,
                    description: `${Object.keys(p.servers).length} servers → ${p.targetClients.length} clients`,
                    profile: p
                })),
                {
                    title: 'Apply Sync Profile',
                    placeHolder: 'Select profile to apply'
                }
            );

            if (!selected) return;
            profile = selected.profile;
        }

        if (!profile) return;

        const operation = await this.syncService.syncProfile(profile.id);
        
        vscode.window.showInformationMessage(
            `Applying sync profile '${profile.name}'...`,
            'View Progress'
        );

        // Show progress notification would be implemented here
    }

    private async manageSyncProfiles(): Promise<void> {
        const profiles = this.syncService.getProfiles();
        
        if (profiles.length === 0) {
            const create = await vscode.window.showInformationMessage(
                'No sync profiles found.',
                'Create Profile', 'Cancel'
            );
            if (create === 'Create Profile') {
                await this.createSyncProfile();
            }
            return;
        }

        const items = profiles.map(profile => ({
            label: profile.name,
            detail: profile.description,
            description: `${Object.keys(profile.servers).length} servers • ${profile.targetClients.length} clients`,
            profile
        }));

        const selected = await vscode.window.showQuickPick(items, {
            title: 'Manage Sync Profiles',
            placeHolder: 'Select profile to manage'
        });

        if (!selected) return;

        const action = await vscode.window.showQuickPick([
            { label: '▶️ Apply Profile', action: 'apply' },
            { label: '✏️ Edit Profile', action: 'edit' },
            { label: '🗑️ Delete Profile', action: 'delete' }
        ], {
            title: `Manage: ${selected.profile.name}`,
            placeHolder: 'Choose action'
        });

        if (!action) return;

        switch (action.action) {
            case 'apply':
                await this.applySyncProfile(selected.profile.id);
                break;
            case 'edit':
                // Edit functionality would be implemented here
                vscode.window.showInformationMessage('Edit functionality coming soon!');
                break;
            case 'delete':
                const confirm = await vscode.window.showWarningMessage(
                    `Delete sync profile '${selected.profile.name}'?`,
                    'Delete', 'Cancel'
                );
                if (confirm === 'Delete') {
                    await this.syncService.deleteProfile(selected.profile.id);
                    vscode.window.showInformationMessage('Profile deleted');
                }
                break;
        }
    }

    private async syncConfigToClients(): Promise<void> {
        // Implementation for manual config sync
        vscode.window.showInformationMessage('Config sync functionality coming soon!');
    }

    private async browseServers(): Promise<void> {
        // This would integrate with a server registry/marketplace
        const servers = [
            { name: 'specforged', description: 'Specification-driven development' },
            { name: 'context7', description: 'Documentation and context provider' },
            { name: 'tavily', description: 'Web search and research' },
            { name: 'puppeteer', description: 'Browser automation' },
            { name: 'playwright', description: 'Cross-browser testing' }
        ];

        const selected = await vscode.window.showQuickPick(
            servers.map(s => ({
                label: s.name,
                detail: s.description,
                server: s
            })),
            {
                title: 'Browse MCP Servers',
                placeHolder: 'Select server to install'
            }
        );

        if (selected) {
            await this.installServer(selected.server.name);
        }
    }

    private async installServer(serverName?: string): Promise<void> {
        if (!serverName) {
            serverName = await vscode.window.showInputBox({
                title: 'Install MCP Server',
                placeHolder: 'Enter server name (e.g., specforged, context7)',
                validateInput: (value) => {
                    if (!value.trim()) {
                        return 'Server name is required';
                    }
                    return null;
                }
            });
        }

        if (!serverName) return;

        // Implementation for server installation
        vscode.window.showInformationMessage(`Installing ${serverName}...`);
    }

    private async testServerConnection(clientId?: string): Promise<void> {
        // Implementation for testing server connections
        vscode.window.showInformationMessage('Connection testing functionality coming soon!');
    }

    private async manageServers(): Promise<void> {
        const discovery = await this.discoveryService.discoverMcpEcosystem();
        const servers = Array.from(discovery.servers.values());

        if (servers.length === 0) {
            vscode.window.showInformationMessage('No MCP servers configured.');
            return;
        }

        const selected = await vscode.window.showQuickPick(
            servers.map(s => ({
                label: s.name,
                detail: s.description || 'MCP Server',
                description: `${s.clientsConfigured.length} clients`,
                server: s
            })),
            {
                title: 'Manage MCP Servers',
                placeHolder: 'Select server to manage'
            }
        );

        if (selected) {
            // Show server management options
            const action = await vscode.window.showQuickPick([
                { label: '🔧 Configure', action: 'configure' },
                { label: '🔄 Sync to Clients', action: 'sync' },
                { label: '🗑️ Remove', action: 'remove' }
            ], {
                title: `Manage: ${selected.server.name}`,
                placeHolder: 'Choose action'
            });

            if (action) {
                switch (action.action) {
                    case 'configure':
                        vscode.window.showInformationMessage('Server configuration coming soon!');
                        break;
                    case 'sync':
                        await this.syncConfigToClients();
                        break;
                    case 'remove':
                        vscode.window.showInformationMessage('Server removal coming soon!');
                        break;
                }
            }
        }
    }

    private async backupConfigurations(): Promise<void> {
        const discovery = await this.discoveryService.discoverMcpEcosystem();
        const configuredClients = discovery.clients.filter(c => c.configExists);

        if (configuredClients.length === 0) {
            vscode.window.showInformationMessage('No configurations to backup.');
            return;
        }

        const clients = await vscode.window.showQuickPick(
            configuredClients.map(c => ({
                label: c.displayName,
                description: 'Configured',
                picked: true,
                client: c
            })),
            {
                title: 'Backup Configurations',
                canPickMany: true,
                placeHolder: 'Select configurations to backup'
            }
        );

        if (!clients || clients.length === 0) return;

        vscode.window.showInformationMessage('Configuration backup functionality coming soon!');
    }

    private async restoreConfiguration(): Promise<void> {
        const backups = this.syncService.getBackups();
        
        if (backups.length === 0) {
            vscode.window.showInformationMessage('No backups found.');
            return;
        }

        const selected = await vscode.window.showQuickPick(
            backups.map(b => ({
                label: `${b.clientId} - ${b.timestamp.toLocaleString()}`,
                detail: `Size: ${b.size} bytes`,
                backup: b
            })),
            {
                title: 'Restore Configuration',
                placeHolder: 'Select backup to restore'
            }
        );

        if (selected) {
            try {
                await this.syncService.restoreFromBackup(selected.backup.id);
                vscode.window.showInformationMessage('Configuration restored successfully!');
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to restore: ${error}`);
            }
        }
    }

    private async manageBackups(): Promise<void> {
        const backups = this.syncService.getBackups();
        
        if (backups.length === 0) {
            vscode.window.showInformationMessage('No backups found.');
            return;
        }

        const action = await vscode.window.showQuickPick([
            { label: '📋 View Backups', action: 'view' },
            { label: '🔄 Restore Backup', action: 'restore' },
            { label: '🧹 Cleanup Old Backups', action: 'cleanup' }
        ], {
            title: 'Manage Backups',
            placeHolder: 'Choose action'
        });

        if (!action) return;

        switch (action.action) {
            case 'view':
                // Show backup list - implementation would go here
                break;
            case 'restore':
                await this.restoreConfiguration();
                break;
            case 'cleanup':
                const days = await vscode.window.showInputBox({
                    title: 'Cleanup Backups',
                    placeHolder: 'Enter days (backups older than this will be deleted)',
                    value: '30',
                    validateInput: (value) => {
                        const num = parseInt(value);
                        if (isNaN(num) || num < 1) {
                            return 'Please enter a valid number of days';
                        }
                        return null;
                    }
                });

                if (days) {
                    const deleted = await this.syncService.cleanupBackups(parseInt(days));
                    vscode.window.showInformationMessage(`Deleted ${deleted} old backups`);
                }
                break;
        }
    }

    private async createProjectFromTemplate(): Promise<void> {
        vscode.window.showInformationMessage('Project templates coming soon!');
    }

    private async shareProjectConfig(): Promise<void> {
        vscode.window.showInformationMessage('Config sharing coming soon!');
    }

    private async diagnoseConnections(): Promise<void> {
        vscode.window.showInformationMessage('Connection diagnostics coming soon!');
    }

    private async generateDiagnosticReport(): Promise<void> {
        const discovery = await this.discoveryService.discoverMcpEcosystem();
        
        const report = [
            '# SpecForged MCP Diagnostic Report',
            `Generated: ${new Date().toISOString()}`,
            '',
            '## System Information',
            `- OS: ${process.platform} ${process.arch}`,
            `- Node: ${process.version}`,
            `- VS Code: ${vscode.version}`,
            '',
            '## MCP Ecosystem Status',
            `- Total Clients: ${discovery.totalClients}`,
            `- Configured Clients: ${discovery.configuredClients}`,
            `- Total Servers: ${discovery.servers.size}`,
            '',
            '## Client Details',
            ...discovery.clients.map(client => [
                `### ${client.displayName}`,
                `- ID: ${client.id}`,
                `- Installed: ${client.isInstalled ? 'Yes' : 'No'}`,
                `- Configured: ${client.configExists ? 'Yes' : 'No'}`,
                `- Running: ${client.isRunning ? 'Yes' : 'No'}`,
                `- Version: ${client.version || 'Unknown'}`,
                `- Config Path: ${client.configPath}`,
                ''
            ]).flat(),
            '## Server Details',
            ...Array.from(discovery.servers.values()).map(server => [
                `### ${server.name}`,
                `- Command: ${server.command}`,
                `- Args: ${server.args.join(' ')}`,
                `- Clients: ${server.clientsConfigured.join(', ')}`,
                ''
            ]).flat(),
            '## Recommendations',
            ...discovery.recommendations.map(rec => 
                `- [${rec.priority.toUpperCase()}] ${rec.title}: ${rec.description}`
            ),
            '',
            '## Health Issues',
            ...discovery.healthIssues.map(issue => `- ⚠️ ${issue}`)
        ].join('\n');

        const doc = await vscode.workspace.openTextDocument({
            content: report,
            language: 'markdown'
        });

        await vscode.window.showTextDocument(doc, { preview: true });
    }

    private async troubleshootSetup(): Promise<void> {
        const discovery = await this.discoveryService.discoverMcpEcosystem();
        
        if (discovery.recommendations.length === 0) {
            vscode.window.showInformationMessage('No issues detected!');
            return;
        }

        const items = discovery.recommendations.map(rec => ({
            label: `${rec.priority === 'high' ? '🔴' : rec.priority === 'medium' ? '🟡' : '🟢'} ${rec.title}`,
            detail: rec.description,
            recommendation: rec
        }));

        const selected = await vscode.window.showQuickPick(items, {
            title: 'Troubleshoot Setup Issues',
            placeHolder: 'Select issue to resolve'
        });

        if (selected) {
            // Handle specific recommendations
            const rec = selected.recommendation;
            
            if (rec.type === 'install_client' && rec.clientId) {
                await this.showClientInstallationInstructions(
                    await this.discoveryService.getClientById(rec.clientId)
                );
            } else if (rec.type === 'configure_server' && rec.clientId) {
                await this.setupMcpForClient(rec.clientId);
            } else {
                vscode.window.showInformationMessage(`Action for ${rec.title} not yet implemented`);
            }
        }
    }

    private async showInstallationInstructions(): Promise<void> {
        const instructions = `
# MCP Client Installation Instructions

## Claude Desktop
1. Download from: https://claude.ai/download
2. Install the application
3. Configuration will be automatic

## Cursor
1. Download from: https://cursor.so
2. Install the application
3. MCP configuration is in ~/.cursor/mcp.json

## Windsurf
1. Download from: https://codeium.com/windsurf
2. Install the application
3. MCP configuration is in ~/.codeium/windsurf/mcp_config.json

## Next Steps
After installing a client:
1. Run "SpecForged: Quick MCP Setup"
2. Or use "SpecForged: Configure All MCP" for multiple clients
        `;

        const doc = await vscode.workspace.openTextDocument({
            content: instructions.trim(),
            language: 'markdown'
        });

        await vscode.window.showTextDocument(doc, { preview: true });
    }

    private async showClientInstallationInstructions(client: McpClient | null): Promise<void> {
        if (!client) return;

        const instructions: Record<string, string> = {
            claude: 'Download Claude Desktop from: https://claude.ai/download',
            cursor: 'Download Cursor from: https://cursor.so',
            windsurf: 'Download Windsurf from: https://codeium.com/windsurf',
            zed: 'Download Zed from: https://zed.dev',
            neovim: 'Install Neovim and MCP.nvim plugin'
        };

        const instruction = instructions[client.id] || 'Check the official website for installation instructions.';
        
        vscode.window.showInformationMessage(
            `Install ${client.displayName}: ${instruction}`,
            'Open Website'
        ).then(action => {
            if (action === 'Open Website') {
                const urls: Record<string, string> = {
                    claude: 'https://claude.ai/download',
                    cursor: 'https://cursor.so',
                    windsurf: 'https://codeium.com/windsurf',
                    zed: 'https://zed.dev',
                    neovim: 'https://neovim.io'
                };
                
                const url = urls[client.id];
                if (url) {
                    vscode.env.openExternal(vscode.Uri.parse(url));
                }
            }
        });
    }

    dispose(): void {
        // Dispose of any resources
        for (const adapter of this.adapters.values()) {
            adapter.dispose();
        }
        this.adapters.clear();
    }
}