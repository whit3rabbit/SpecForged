import * as vscode from 'vscode';
import * as path from 'path';
import { McpDiscoveryService, McpDiscoveryResult } from '../services/McpDiscoveryService';
import { McpConfigSyncService, ConfigSyncProfile } from '../services/McpConfigSyncService';

export interface ProfileTemplate {
    id: string;
    name: string;
    description: string;
    category: 'development' | 'team' | 'enterprise' | 'minimal';
    icon: string;
    profile: Partial<ConfigSyncProfile>;
    requirements?: string[];
    benefits?: string[];
}

export class ProfileManagerProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'specforged.profileManager';
    
    private _view?: vscode.WebviewView;
    private _refreshInterval?: NodeJS.Timer;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly discoveryService: McpDiscoveryService,
        private readonly configSyncService: McpConfigSyncService,
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

        // Initial data load
        this._refreshData();
    }

    public show() {
        if (this._view) {
            this._view.show?.(true);
            this._refreshData();
        }
    }

    private async _refreshData() {
        if (!this._view) {
            return;
        }

        try {
            const profiles = await this.configSyncService.getAllProfiles();
            const discoveryResult = await this.discoveryService.discoverMcpEcosystem();
            const templates = this._getProfileTemplates();
            
            this._view.webview.postMessage({
                command: 'updateData',
                data: {
                    profiles: profiles,
                    templates: templates,
                    discoveryData: this._transformDiscoveryData(discoveryResult),
                    statistics: await this._getProfileStatistics(profiles)
                }
            });
        } catch (error) {
            console.error('Failed to refresh profile data:', error);
            this._showNotification('error', `Failed to load profiles: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private _transformDiscoveryData(result: McpDiscoveryResult) {
        return {
            availableClients: result.clients.map(client => ({
                id: client.id,
                name: client.displayName,
                isInstalled: client.isInstalled,
                configExists: client.configExists,
                category: this._getClientCategory(client.id)
            })),
            availableServers: Array.from(result.servers.entries()).map(([name, config]) => ({
                id: name,
                name: name,
                description: config.description || `${name} MCP server`,
                category: this._getServerCategory(name),
                isConfigured: config.isConfigured
            }))
        };
    }

    private _getClientCategory(clientId: string): string {
        const categoryMap: Record<string, string> = {
            claude: 'ai-assistant',
            cursor: 'ide',
            windsurf: 'ide',
            zed: 'editor',
            neovim: 'editor',
            'vs-code': 'ide'
        };
        return categoryMap[clientId] || 'other';
    }

    private _getServerCategory(serverId: string): string {
        const categoryMap: Record<string, string> = {
            specforged: 'development',
            context7: 'documentation',
            tavily: 'research',
            puppeteer: 'automation',
            playwright: 'automation',
            filesystem: 'utility',
            memory: 'utility'
        };
        return categoryMap[serverId] || 'other';
    }

    private async _getProfileStatistics(profiles: ConfigSyncProfile[]) {
        return {
            totalProfiles: profiles.length,
            activeProfile: profiles.find(p => p.isActive)?.name || 'None',
            totalClients: new Set(profiles.flatMap(p => p.targetClients)).size,
            totalServers: new Set(profiles.flatMap(p => Object.keys(p.servers))).size,
            lastSync: profiles.reduce((latest, p) => 
                p.lastSync && (!latest || new Date(p.lastSync) > new Date(latest)) 
                    ? p.lastSync 
                    : latest, 
                null as string | null
            )
        };
    }

    private _getProfileTemplates(): ProfileTemplate[] {
        return [
            {
                id: 'developer_full',
                name: 'Full Developer Setup',
                description: 'Complete development environment with all MCP capabilities',
                category: 'development',
                icon: '🚀',
                profile: {
                    name: 'Full Developer',
                    description: 'Comprehensive setup for active development',
                    servers: {
                        specforged: { 
                            enabled: true, 
                            priority: 1,
                            config: { 
                                command: 'specforged',
                                args: ['--local-mode', '--verbose']
                            }
                        },
                        context7: { 
                            enabled: true, 
                            priority: 2,
                            config: {
                                command: 'context7-server',
                                args: ['--enhanced-search']
                            }
                        },
                        tavily: { 
                            enabled: true, 
                            priority: 3,
                            config: {
                                command: 'tavily-server',
                                env: { TAVILY_API_KEY: '${env:TAVILY_API_KEY}' }
                            }
                        },
                        puppeteer: { 
                            enabled: true, 
                            priority: 4,
                            config: {
                                command: 'puppeteer-server',
                                args: ['--headless']
                            }
                        }
                    },
                    targetClients: ['claude', 'cursor', 'windsurf', 'zed'],
                    syncOptions: {
                        autoSync: true,
                        backupBeforeSync: true,
                        validateAfterSync: true,
                        notifyOnChanges: true
                    }
                },
                requirements: [
                    'Multiple MCP clients installed',
                    'Development environment setup',
                    'API keys configured'
                ],
                benefits: [
                    'Full MCP ecosystem integration',
                    'Advanced development tools',
                    'Comprehensive documentation access',
                    'Web automation capabilities'
                ]
            },
            {
                id: 'team_collaboration',
                name: 'Team Collaboration',
                description: 'Optimized for team environments with shared configurations',
                category: 'team',
                icon: '👥',
                profile: {
                    name: 'Team Collaboration',
                    description: 'Standardized setup for team collaboration',
                    servers: {
                        specforged: { 
                            enabled: true, 
                            priority: 1,
                            config: {
                                command: 'specforged',
                                args: ['--team-mode', '--shared-specs']
                            }
                        },
                        context7: { 
                            enabled: true, 
                            priority: 2,
                            config: {
                                command: 'context7-server',
                                args: ['--team-docs']
                            }
                        }
                    },
                    targetClients: ['claude', 'cursor', 'windsurf'],
                    syncOptions: {
                        autoSync: true,
                        backupBeforeSync: true,
                        validateAfterSync: true,
                        notifyOnChanges: false
                    }
                },
                requirements: [
                    'Team MCP clients installed',
                    'Shared workspace access',
                    'Team documentation repository'
                ],
                benefits: [
                    'Consistent team environment',
                    'Shared specification management',
                    'Collaborative documentation',
                    'Standardized workflows'
                ]
            },
            {
                id: 'minimal_setup',
                name: 'Minimal Setup',
                description: 'Lightweight configuration for basic MCP functionality',
                category: 'minimal',
                icon: '⚡',
                profile: {
                    name: 'Minimal Setup',
                    description: 'Basic MCP functionality with minimal overhead',
                    servers: {
                        specforged: { 
                            enabled: true, 
                            priority: 1,
                            config: {
                                command: 'specforged',
                                args: ['--minimal-mode']
                            }
                        }
                    },
                    targetClients: ['claude'],
                    syncOptions: {
                        autoSync: false,
                        backupBeforeSync: false,
                        validateAfterSync: true,
                        notifyOnChanges: false
                    }
                },
                requirements: [
                    'Claude Desktop installed',
                    'SpecForged server available'
                ],
                benefits: [
                    'Fast startup time',
                    'Low resource usage',
                    'Core specification features',
                    'Simple configuration'
                ]
            },
            {
                id: 'research_focused',
                name: 'Research & Documentation',
                description: 'Optimized for research, documentation, and analysis work',
                category: 'enterprise',
                icon: '📚',
                profile: {
                    name: 'Research & Documentation',
                    description: 'Enhanced setup for research and documentation tasks',
                    servers: {
                        specforged: { 
                            enabled: true, 
                            priority: 1,
                            config: {
                                command: 'specforged',
                                args: ['--research-mode']
                            }
                        },
                        context7: { 
                            enabled: true, 
                            priority: 2,
                            config: {
                                command: 'context7-server',
                                args: ['--enhanced-search', '--academic-mode']
                            }
                        },
                        tavily: { 
                            enabled: true, 
                            priority: 3,
                            config: {
                                command: 'tavily-server',
                                args: ['--research-mode'],
                                env: { TAVILY_API_KEY: '${env:TAVILY_API_KEY}' }
                            }
                        }
                    },
                    targetClients: ['claude', 'cursor'],
                    syncOptions: {
                        autoSync: true,
                        backupBeforeSync: true,
                        validateAfterSync: true,
                        notifyOnChanges: true
                    }
                },
                requirements: [
                    'Research-focused MCP clients',
                    'API access for research services',
                    'Documentation workspace'
                ],
                benefits: [
                    'Advanced search capabilities',
                    'Academic research integration',
                    'Documentation generation',
                    'Knowledge management'
                ]
            }
        ];
    }

    private async _handleWebviewMessage(message: any) {
        switch (message.command) {
            case 'loadData':
                await this._refreshData();
                break;

            case 'createProfile':
                await this._createProfile(message.profileData);
                break;

            case 'createFromTemplate':
                await this._createFromTemplate(message.templateId, message.customizations);
                break;

            case 'editProfile':
                await this._editProfile(message.profileId, message.updates);
                break;

            case 'deleteProfile':
                await this._deleteProfile(message.profileId);
                break;

            case 'activateProfile':
                await this._activateProfile(message.profileId);
                break;

            case 'duplicateProfile':
                await this._duplicateProfile(message.profileId, message.newName);
                break;

            case 'exportProfile':
                await this._exportProfile(message.profileId);
                break;

            case 'importProfile':
                await this._importProfile();
                break;

            case 'syncProfile':
                await this._syncProfile(message.profileId);
                break;

            case 'validateProfile':
                await this._validateProfile(message.profileId);
                break;

            case 'previewProfile':
                await this._previewProfile(message.profileData);
                break;

            default:
                console.warn('Unknown profile manager message:', message.command);
        }
    }

    private async _createProfile(profileData: any) {
        try {
            const profile: ConfigSyncProfile = {
                id: `profile_${Date.now()}`,
                name: profileData.name,
                description: profileData.description || '',
                servers: profileData.servers || {},
                targetClients: profileData.targetClients || [],
                syncOptions: profileData.syncOptions || {},
                isActive: false,
                createdAt: new Date().toISOString(),
                lastSync: null
            };

            await this.configSyncService.createProfile(profile);
            this._showNotification('success', `Profile "${profile.name}" created successfully`);
            await this._refreshData();
        } catch (error) {
            this._showNotification('error', `Failed to create profile: ${error}`);
        }
    }

    private async _createFromTemplate(templateId: string, customizations: any) {
        try {
            const templates = this._getProfileTemplates();
            const template = templates.find(t => t.id === templateId);
            
            if (!template) {
                throw new Error(`Template ${templateId} not found`);
            }

            const profile: ConfigSyncProfile = {
                id: `profile_${Date.now()}`,
                name: customizations.name || template.name,
                description: customizations.description || template.description,
                servers: { ...template.profile.servers, ...customizations.servers },
                targetClients: customizations.targetClients || template.profile.targetClients || [],
                syncOptions: { ...template.profile.syncOptions, ...customizations.syncOptions },
                isActive: false,
                createdAt: new Date().toISOString(),
                lastSync: null
            };

            await this.configSyncService.createProfile(profile);
            this._showNotification('success', `Profile "${profile.name}" created from template`);
            await this._refreshData();
        } catch (error) {
            this._showNotification('error', `Failed to create from template: ${error}`);
        }
    }

    private async _editProfile(profileId: string, updates: any) {
        try {
            const profiles = await this.configSyncService.getAllProfiles();
            const profile = profiles.find(p => p.id === profileId);
            
            if (!profile) {
                throw new Error('Profile not found');
            }

            const updatedProfile = { ...profile, ...updates };
            await this.configSyncService.updateProfile(updatedProfile);
            
            this._showNotification('success', `Profile "${profile.name}" updated`);
            await this._refreshData();
        } catch (error) {
            this._showNotification('error', `Failed to update profile: ${error}`);
        }
    }

    private async _deleteProfile(profileId: string) {
        try {
            const profiles = await this.configSyncService.getAllProfiles();
            const profile = profiles.find(p => p.id === profileId);
            
            if (!profile) {
                throw new Error('Profile not found');
            }

            if (profile.isActive) {
                const action = await vscode.window.showWarningMessage(
                    `"${profile.name}" is currently active. Delete anyway?`,
                    { modal: true },
                    'Delete', 'Cancel'
                );
                
                if (action !== 'Delete') return;
            }

            await this.configSyncService.deleteProfile(profileId);
            this._showNotification('success', `Profile "${profile.name}" deleted`);
            await this._refreshData();
        } catch (error) {
            this._showNotification('error', `Failed to delete profile: ${error}`);
        }
    }

    private async _activateProfile(profileId: string) {
        try {
            await this.configSyncService.activateProfile(profileId);
            const profiles = await this.configSyncService.getAllProfiles();
            const profile = profiles.find(p => p.id === profileId);
            
            this._showNotification('success', `Activated profile: ${profile?.name}`);
            await this._refreshData();
        } catch (error) {
            this._showNotification('error', `Failed to activate profile: ${error}`);
        }
    }

    private async _duplicateProfile(profileId: string, newName: string) {
        try {
            const profiles = await this.configSyncService.getAllProfiles();
            const profile = profiles.find(p => p.id === profileId);
            
            if (!profile) {
                throw new Error('Profile not found');
            }

            const duplicatedProfile: ConfigSyncProfile = {
                ...profile,
                id: `profile_${Date.now()}`,
                name: newName,
                isActive: false,
                createdAt: new Date().toISOString(),
                lastSync: null
            };

            await this.configSyncService.createProfile(duplicatedProfile);
            this._showNotification('success', `Profile duplicated as "${newName}"`);
            await this._refreshData();
        } catch (error) {
            this._showNotification('error', `Failed to duplicate profile: ${error}`);
        }
    }

    private async _exportProfile(profileId: string) {
        try {
            const profiles = await this.configSyncService.getAllProfiles();
            const profile = profiles.find(p => p.id === profileId);
            
            if (!profile) {
                throw new Error('Profile not found');
            }

            const exportData = {
                version: '1.0.0',
                timestamp: new Date().toISOString(),
                profile: profile,
                metadata: {
                    exportedBy: 'SpecForged VS Code Extension',
                    originalId: profile.id
                }
            };

            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(`${profile.name.replace(/\s+/g, '_').toLowerCase()}_profile.json`),
                filters: {
                    'JSON Files': ['json'],
                    'All Files': ['*']
                }
            });

            if (uri) {
                await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(exportData, null, 2), 'utf8'));
                this._showNotification('success', `Profile "${profile.name}" exported successfully`);
            }
        } catch (error) {
            this._showNotification('error', `Failed to export profile: ${error}`);
        }
    }

    private async _importProfile() {
        try {
            const uri = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectMany: false,
                filters: {
                    'JSON Files': ['json'],
                    'All Files': ['*']
                }
            });

            if (uri && uri[0]) {
                const data = await vscode.workspace.fs.readFile(uri[0]);
                const importData = JSON.parse(data.toString('utf8'));

                if (!importData.profile) {
                    throw new Error('Invalid profile file format');
                }

                const profile: ConfigSyncProfile = {
                    ...importData.profile,
                    id: `profile_${Date.now()}`,
                    isActive: false,
                    createdAt: new Date().toISOString(),
                    lastSync: null
                };

                await this.configSyncService.createProfile(profile);
                this._showNotification('success', `Profile "${profile.name}" imported successfully`);
                await this._refreshData();
            }
        } catch (error) {
            this._showNotification('error', `Failed to import profile: ${error}`);
        }
    }

    private async _syncProfile(profileId: string) {
        try {
            this._showNotification('info', 'Starting profile sync...');
            await this.configSyncService.syncProfile(profileId);
            
            const profiles = await this.configSyncService.getAllProfiles();
            const profile = profiles.find(p => p.id === profileId);
            
            this._showNotification('success', `Profile "${profile?.name}" synced successfully`);
            await this._refreshData();
        } catch (error) {
            this._showNotification('error', `Failed to sync profile: ${error}`);
        }
    }

    private async _validateProfile(profileId: string) {
        try {
            const profiles = await this.configSyncService.getAllProfiles();
            const profile = profiles.find(p => p.id === profileId);
            
            if (!profile) {
                throw new Error('Profile not found');
            }

            const validationResult = await this.configSyncService.validateProfile(profile);
            
            this._view?.webview.postMessage({
                command: 'validationResult',
                profileId: profileId,
                result: validationResult
            });

            if (validationResult.isValid) {
                this._showNotification('success', `Profile "${profile.name}" is valid`);
            } else {
                this._showNotification('warning', `Profile validation found ${validationResult.errors.length} issues`);
            }
        } catch (error) {
            this._showNotification('error', `Failed to validate profile: ${error}`);
        }
    }

    private async _previewProfile(profileData: any) {
        try {
            const discoveryResult = await this.discoveryService.discoverMcpEcosystem();
            const preview = await this.configSyncService.previewChanges(profileData);
            
            this._view?.webview.postMessage({
                command: 'previewResult',
                preview: preview,
                affectedClients: profileData.targetClients,
                discoveryData: this._transformDiscoveryData(discoveryResult)
            });
        } catch (error) {
            this._showNotification('error', `Failed to preview profile: ${error}`);
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

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Configuration Profile Manager</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-background);
            padding: 20px;
            margin: 0;
        }

        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .title {
            font-size: 18px;
            font-weight: 600;
            margin: 0;
        }

        .stats {
            display: flex;
            gap: 20px;
            margin-bottom: 25px;
        }

        .stat {
            text-align: center;
            padding: 15px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            background: var(--vscode-panel-background);
            flex: 1;
        }

        .stat-value {
            font-size: 24px;
            font-weight: 600;
            color: var(--vscode-button-background);
        }

        .stat-label {
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
            margin-top: 5px;
        }

        .section {
            margin-bottom: 30px;
        }

        .section-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .section-title {
            font-size: 16px;
            font-weight: 600;
            margin: 0;
        }

        .profiles-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
        }

        .profile-card {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            background: var(--vscode-panel-background);
            position: relative;
            transition: all 0.2s;
        }

        .profile-card:hover {
            border-color: var(--vscode-focusBorder);
        }

        .profile-card.active {
            border-color: var(--vscode-button-background);
            background: var(--vscode-list-activeSelectionBackground);
        }

        .profile-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            margin-bottom: 15px;
        }

        .profile-info {
            flex-grow: 1;
        }

        .profile-name {
            font-size: 16px;
            font-weight: 600;
            margin: 0 0 5px 0;
        }

        .profile-description {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
            line-height: 1.4;
        }

        .profile-actions {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }

        .profile-details {
            margin-bottom: 15px;
        }

        .detail-item {
            display: flex;
            justify-content: space-between;
            margin-bottom: 5px;
            font-size: 0.9em;
        }

        .detail-label {
            color: var(--vscode-descriptionForeground);
        }

        .detail-value {
            font-weight: 500;
        }

        .profile-controls {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }

        .templates-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 20px;
        }

        .template-card {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            background: var(--vscode-panel-background);
            cursor: pointer;
            transition: all 0.2s;
        }

        .template-card:hover {
            border-color: var(--vscode-focusBorder);
            background: var(--vscode-list-hoverBackground);
        }

        .template-header {
            display: flex;
            align-items: center;
            margin-bottom: 10px;
        }

        .template-icon {
            font-size: 24px;
            margin-right: 15px;
        }

        .template-info {
            flex-grow: 1;
        }

        .template-name {
            font-weight: 600;
            margin: 0 0 5px 0;
        }

        .template-description {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
            line-height: 1.4;
        }

        .template-details {
            margin-top: 15px;
        }

        .template-requirements, .template-benefits {
            margin-bottom: 10px;
        }

        .template-list {
            font-size: 0.8em;
            color: var(--vscode-descriptionForeground);
            padding-left: 15px;
        }

        .btn {
            padding: 6px 12px;
            border: 1px solid var(--vscode-button-border);
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.8em;
            transition: all 0.2s;
            white-space: nowrap;
        }

        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-danger {
            background: var(--vscode-errorForeground);
            color: white;
        }

        .btn-small {
            padding: 4px 8px;
            font-size: 0.75em;
        }

        .notification {
            padding: 12px;
            border-radius: 4px;
            margin-bottom: 15px;
            display: none;
        }

        .notification.info {
            background: var(--vscode-editorInfo-background);
            color: var(--vscode-editorInfo-foreground);
            border: 1px solid var(--vscode-editorInfo-border);
        }

        .notification.warning {
            background: var(--vscode-editorWarning-background);
            color: var(--vscode-editorWarning-foreground);
            border: 1px solid var(--vscode-editorWarning-border);
        }

        .notification.error {
            background: var(--vscode-editorError-background);
            color: var(--vscode-editorError-foreground);
            border: 1px solid var(--vscode-editorError-border);
        }

        .notification.success {
            background: var(--vscode-terminal-ansiGreen);
            color: var(--vscode-foreground);
            border: 1px solid var(--vscode-terminal-ansiGreen);
        }

        .active-badge {
            position: absolute;
            top: 10px;
            right: 10px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 0.7em;
            font-weight: 600;
        }

        .category-badge {
            display: inline-block;
            padding: 2px 6px;
            border-radius: 10px;
            font-size: 0.7em;
            font-weight: 500;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }

        .empty-state {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
        }

        .empty-icon {
            font-size: 48px;
            margin-bottom: 15px;
        }

        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1000;
        }

        .modal-content {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: var(--vscode-panel-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 30px;
            min-width: 400px;
            max-width: 600px;
            max-height: 80vh;
            overflow-y: auto;
        }

        .modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .modal-title {
            font-size: 18px;
            font-weight: 600;
            margin: 0;
        }

        .close {
            background: none;
            border: none;
            color: var(--vscode-foreground);
            font-size: 24px;
            cursor: pointer;
        }

        .form-group {
            margin-bottom: 20px;
        }

        .form-label {
            display: block;
            margin-bottom: 5px;
            font-weight: 500;
        }

        .form-control {
            width: 100%;
            padding: 8px 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 0.9em;
        }

        .form-control:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }

        textarea.form-control {
            min-height: 80px;
            resize: vertical;
        }

        .modal-actions {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
            margin-top: 20px;
            padding-top: 15px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .hidden {
            display: none;
        }
    </style>
</head>
<body>
    <div class="notification" id="notification"></div>
    
    <div class="header">
        <h1 class="title">Configuration Profile Manager</h1>
        <div class="header-actions">
            <button class="btn btn-primary" onclick="showCreateModal()">Create Profile</button>
            <button class="btn btn-secondary" onclick="importProfile()">Import</button>
        </div>
    </div>

    <div class="stats" id="statistics">
        <!-- Statistics will be populated by JavaScript -->
    </div>

    <div class="section">
        <div class="section-header">
            <h2 class="section-title">Your Profiles</h2>
            <button class="btn btn-secondary" onclick="refreshData()">Refresh</button>
        </div>
        <div class="profiles-grid" id="profilesGrid">
            <!-- Profiles will be populated by JavaScript -->
        </div>
        <div class="empty-state hidden" id="emptyProfiles">
            <div class="empty-icon">📋</div>
            <p>No configuration profiles yet</p>
            <button class="btn btn-primary" onclick="showCreateModal()">Create Your First Profile</button>
        </div>
    </div>

    <div class="section">
        <div class="section-header">
            <h2 class="section-title">Profile Templates</h2>
        </div>
        <div class="templates-grid" id="templatesGrid">
            <!-- Templates will be populated by JavaScript -->
        </div>
    </div>

    <!-- Create/Edit Profile Modal -->
    <div class="modal" id="profileModal">
        <div class="modal-content">
            <div class="modal-header">
                <h3 class="modal-title" id="modalTitle">Create Profile</h3>
                <button class="close" onclick="hideModal('profileModal')">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label class="form-label">Profile Name</label>
                    <input type="text" class="form-control" id="profileName" placeholder="Enter profile name">
                </div>
                <div class="form-group">
                    <label class="form-label">Description</label>
                    <textarea class="form-control" id="profileDescription" placeholder="Describe this profile..."></textarea>
                </div>
                <div class="form-group">
                    <label class="form-label">Target Clients</label>
                    <div id="clientCheckboxes">
                        <!-- Client checkboxes will be populated by JavaScript -->
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Servers</label>
                    <div id="serverCheckboxes">
                        <!-- Server checkboxes will be populated by JavaScript -->
                    </div>
                </div>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="hideModal('profileModal')">Cancel</button>
                <button class="btn btn-primary" id="saveProfileBtn" onclick="saveProfile()">Save Profile</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentData = null;
        let editingProfile = null;

        // Request initial data
        vscode.postMessage({ command: 'loadData' });

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'updateData':
                    currentData = message.data;
                    updateUI();
                    break;
                case 'showNotification':
                    showNotification(message.type, message.message);
                    break;
                case 'validationResult':
                    showValidationResult(message.profileId, message.result);
                    break;
                case 'previewResult':
                    showPreviewResult(message.preview);
                    break;
            }
        });

        function updateUI() {
            if (!currentData) return;
            
            updateStatistics();
            updateProfilesGrid();
            updateTemplatesGrid();
        }

        function updateStatistics() {
            const statsContainer = document.getElementById('statistics');
            const stats = currentData.statistics;
            
            statsContainer.innerHTML = \`
                <div class="stat">
                    <div class="stat-value">\${stats.totalProfiles}</div>
                    <div class="stat-label">Total Profiles</div>
                </div>
                <div class="stat">
                    <div class="stat-value">\${stats.activeProfile}</div>
                    <div class="stat-label">Active Profile</div>
                </div>
                <div class="stat">
                    <div class="stat-value">\${stats.totalClients}</div>
                    <div class="stat-label">Configured Clients</div>
                </div>
                <div class="stat">
                    <div class="stat-value">\${stats.totalServers}</div>
                    <div class="stat-label">Available Servers</div>
                </div>
            \`;
        }

        function updateProfilesGrid() {
            const grid = document.getElementById('profilesGrid');
            const emptyState = document.getElementById('emptyProfiles');
            
            if (currentData.profiles.length === 0) {
                grid.classList.add('hidden');
                emptyState.classList.remove('hidden');
                return;
            }
            
            grid.classList.remove('hidden');
            emptyState.classList.add('hidden');
            
            grid.innerHTML = '';
            
            currentData.profiles.forEach(profile => {
                const card = document.createElement('div');
                card.className = \`profile-card \${profile.isActive ? 'active' : ''}\`;
                
                card.innerHTML = \`
                    \${profile.isActive ? '<div class="active-badge">ACTIVE</div>' : ''}
                    <div class="profile-header">
                        <div class="profile-info">
                            <h3 class="profile-name">\${profile.name}</h3>
                            <p class="profile-description">\${profile.description}</p>
                        </div>
                    </div>
                    <div class="profile-details">
                        <div class="detail-item">
                            <span class="detail-label">Clients:</span>
                            <span class="detail-value">\${profile.targetClients.length}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Servers:</span>
                            <span class="detail-value">\${Object.keys(profile.servers).length}</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-label">Last Sync:</span>
                            <span class="detail-value">\${profile.lastSync ? new Date(profile.lastSync).toLocaleDateString() : 'Never'}</span>
                        </div>
                    </div>
                    <div class="profile-controls">
                        \${!profile.isActive ? \`<button class="btn btn-primary btn-small" onclick="activateProfile('\${profile.id}')">Activate</button>\` : ''}
                        <button class="btn btn-secondary btn-small" onclick="editProfile('\${profile.id}')">Edit</button>
                        <button class="btn btn-secondary btn-small" onclick="duplicateProfile('\${profile.id}')">Duplicate</button>
                        <button class="btn btn-secondary btn-small" onclick="syncProfile('\${profile.id}')">Sync</button>
                        <button class="btn btn-secondary btn-small" onclick="validateProfile('\${profile.id}')">Validate</button>
                        <button class="btn btn-secondary btn-small" onclick="exportProfile('\${profile.id}')">Export</button>
                        <button class="btn btn-danger btn-small" onclick="deleteProfile('\${profile.id}')">Delete</button>
                    </div>
                \`;
                
                grid.appendChild(card);
            });
        }

        function updateTemplatesGrid() {
            const grid = document.getElementById('templatesGrid');
            grid.innerHTML = '';
            
            currentData.templates.forEach(template => {
                const card = document.createElement('div');
                card.className = 'template-card';
                card.onclick = () => createFromTemplate(template.id);
                
                card.innerHTML = \`
                    <div class="template-header">
                        <div class="template-icon">\${template.icon}</div>
                        <div class="template-info">
                            <h3 class="template-name">\${template.name}</h3>
                            <span class="category-badge">\${template.category}</span>
                            <p class="template-description">\${template.description}</p>
                        </div>
                    </div>
                    <div class="template-details">
                        <div class="template-requirements">
                            <strong>Requirements:</strong>
                            <ul class="template-list">
                                \${template.requirements.map(req => \`<li>\${req}</li>\`).join('')}
                            </ul>
                        </div>
                        <div class="template-benefits">
                            <strong>Benefits:</strong>
                            <ul class="template-list">
                                \${template.benefits.map(benefit => \`<li>\${benefit}</li>\`).join('')}
                            </ul>
                        </div>
                    </div>
                \`;
                
                grid.appendChild(card);
            });
        }

        // Profile Management Functions
        function showCreateModal() {
            editingProfile = null;
            document.getElementById('modalTitle').textContent = 'Create Profile';
            document.getElementById('saveProfileBtn').textContent = 'Create Profile';
            document.getElementById('profileName').value = '';
            document.getElementById('profileDescription').value = '';
            populateClientCheckboxes();
            populateServerCheckboxes();
            document.getElementById('profileModal').style.display = 'block';
        }

        function editProfile(profileId) {
            editingProfile = currentData.profiles.find(p => p.id === profileId);
            if (!editingProfile) return;
            
            document.getElementById('modalTitle').textContent = 'Edit Profile';
            document.getElementById('saveProfileBtn').textContent = 'Save Changes';
            document.getElementById('profileName').value = editingProfile.name;
            document.getElementById('profileDescription').value = editingProfile.description;
            populateClientCheckboxes(editingProfile.targetClients);
            populateServerCheckboxes(editingProfile.servers);
            document.getElementById('profileModal').style.display = 'block';
        }

        function populateClientCheckboxes(selectedClients = []) {
            const container = document.getElementById('clientCheckboxes');
            container.innerHTML = '';
            
            currentData.discoveryData.availableClients.forEach(client => {
                const checkbox = document.createElement('div');
                checkbox.innerHTML = \`
                    <label style="display: flex; align-items: center; margin-bottom: 8px;">
                        <input type="checkbox" value="\${client.id}" 
                               \${selectedClients.includes(client.id) ? 'checked' : ''}
                               \${!client.isInstalled ? 'disabled' : ''}>
                        <span style="margin-left: 8px;">\${client.name} 
                            \${!client.isInstalled ? '(Not Installed)' : ''}
                        </span>
                    </label>
                \`;
                container.appendChild(checkbox);
            });
        }

        function populateServerCheckboxes(selectedServers = {}) {
            const container = document.getElementById('serverCheckboxes');
            container.innerHTML = '';
            
            currentData.discoveryData.availableServers.forEach(server => {
                const checkbox = document.createElement('div');
                const isSelected = selectedServers[server.id]?.enabled || false;
                const priority = selectedServers[server.id]?.priority || 1;
                
                checkbox.innerHTML = \`
                    <div style="display: flex; align-items: center; margin-bottom: 12px; padding: 8px; border: 1px solid var(--vscode-panel-border); border-radius: 4px;">
                        <label style="display: flex; align-items: center; flex-grow: 1;">
                            <input type="checkbox" value="\${server.id}" \${isSelected ? 'checked' : ''}>
                            <span style="margin-left: 8px;">\${server.name}</span>
                        </label>
                        <label style="margin-left: 15px; display: flex; align-items: center;">
                            Priority:
                            <input type="number" min="1" max="10" value="\${priority}" 
                                   style="width: 60px; margin-left: 5px; padding: 4px;">
                        </label>
                    </div>
                \`;
                container.appendChild(checkbox);
            });
        }

        function saveProfile() {
            const name = document.getElementById('profileName').value.trim();
            if (!name) {
                showNotification('error', 'Profile name is required');
                return;
            }
            
            const description = document.getElementById('profileDescription').value.trim();
            
            // Get selected clients
            const clientCheckboxes = document.querySelectorAll('#clientCheckboxes input[type="checkbox"]:checked');
            const targetClients = Array.from(clientCheckboxes).map(cb => cb.value);
            
            // Get selected servers with priorities
            const servers = {};
            const serverRows = document.querySelectorAll('#serverCheckboxes > div');
            serverRows.forEach(row => {
                const checkbox = row.querySelector('input[type="checkbox"]');
                const priorityInput = row.querySelector('input[type="number"]');
                
                if (checkbox.checked) {
                    servers[checkbox.value] = {
                        enabled: true,
                        priority: parseInt(priorityInput.value) || 1
                    };
                }
            });
            
            const profileData = {
                name,
                description,
                targetClients,
                servers,
                syncOptions: {
                    autoSync: true,
                    backupBeforeSync: true,
                    validateAfterSync: true,
                    notifyOnChanges: true
                }
            };
            
            if (editingProfile) {
                vscode.postMessage({ 
                    command: 'editProfile', 
                    profileId: editingProfile.id, 
                    updates: profileData 
                });
            } else {
                vscode.postMessage({ command: 'createProfile', profileData });
            }
            
            hideModal('profileModal');
        }

        function createFromTemplate(templateId) {
            const template = currentData.templates.find(t => t.id === templateId);
            if (!template) return;
            
            const name = prompt(\`Enter name for profile based on "\${template.name}":\`, template.name);
            if (!name || !name.trim()) return;
            
            const customizations = {
                name: name.trim(),
                description: template.description
            };
            
            vscode.postMessage({ 
                command: 'createFromTemplate', 
                templateId, 
                customizations 
            });
        }

        function activateProfile(profileId) {
            vscode.postMessage({ command: 'activateProfile', profileId });
        }

        function duplicateProfile(profileId) {
            const profile = currentData.profiles.find(p => p.id === profileId);
            if (!profile) return;
            
            const newName = prompt(\`Enter name for duplicated profile:\`, \`\${profile.name} Copy\`);
            if (!newName || !newName.trim()) return;
            
            vscode.postMessage({ 
                command: 'duplicateProfile', 
                profileId, 
                newName: newName.trim() 
            });
        }

        function syncProfile(profileId) {
            vscode.postMessage({ command: 'syncProfile', profileId });
        }

        function validateProfile(profileId) {
            vscode.postMessage({ command: 'validateProfile', profileId });
        }

        function exportProfile(profileId) {
            vscode.postMessage({ command: 'exportProfile', profileId });
        }

        function deleteProfile(profileId) {
            const profile = currentData.profiles.find(p => p.id === profileId);
            if (!profile) return;
            
            if (confirm(\`Are you sure you want to delete the profile "\${profile.name}"?\`)) {
                vscode.postMessage({ command: 'deleteProfile', profileId });
            }
        }

        function importProfile() {
            vscode.postMessage({ command: 'importProfile' });
        }

        function refreshData() {
            vscode.postMessage({ command: 'loadData' });
        }

        // UI Helper Functions
        function hideModal(modalId) {
            document.getElementById(modalId).style.display = 'none';
        }

        function showNotification(type, message) {
            const notification = document.getElementById('notification');
            notification.textContent = message;
            notification.className = \`notification \${type}\`;
            notification.style.display = 'block';
            
            setTimeout(() => {
                notification.style.display = 'none';
            }, 5000);
        }

        function showValidationResult(profileId, result) {
            const profile = currentData.profiles.find(p => p.id === profileId);
            if (!profile) return;
            
            if (result.isValid) {
                showNotification('success', \`Profile "\${profile.name}" validation passed\`);
            } else {
                let message = \`Profile "\${profile.name}" validation failed:\\n\`;
                result.errors.forEach(error => {
                    message += \`• \${error}\\n\`;
                });
                alert(message);
            }
        }

        function showPreviewResult(preview) {
            // Show preview in modal or alert
            alert('Preview functionality would show configuration changes here');
        }
    </script>
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