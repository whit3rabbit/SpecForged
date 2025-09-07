import * as vscode from 'vscode';
import * as path from 'path';
import { McpDiscoveryService, McpDiscoveryResult } from '../services/McpDiscoveryService';
import { McpConfigSyncService } from '../services/McpConfigSyncService';

export interface SettingsProfile {
    id: string;
    name: string;
    description: string;
    settings: {
        autoDiscovery: boolean;
        showRecommendations: boolean;
        enableDashboard: boolean;
        syncOnChange: boolean;
        backupBeforeSync: boolean;
        notificationLevel: 'none' | 'errors' | 'all';
        defaultServerType: 'local' | 'smithery' | 'custom';
        customServerUrl?: string;
        refreshInterval: number;
        maxBackups: number;
    };
    serverConfigs: Record<string, {
        enabled: boolean;
        priority: number;
        customArgs?: string[];
    }>;
    clientTargets: string[];
}

export class SettingsProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'specforged.settings';
    
    private _view?: vscode.WebviewView;
    private _refreshInterval?: NodeJS.Timer;
    private _currentProfile: SettingsProfile | null = null;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly discoveryService: McpDiscoveryService,
        private readonly configSyncService: McpConfigSyncService,
        private readonly context: vscode.ExtensionContext
    ) {
        this._loadCurrentProfile();
    }

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

    private async _loadCurrentProfile() {
        const config = vscode.workspace.getConfiguration('specforged');
        
        this._currentProfile = {
            id: 'default',
            name: 'Default Configuration',
            description: 'Current VS Code settings for SpecForged',
            settings: {
                autoDiscovery: config.get<boolean>('autoDiscovery', true),
                showRecommendations: config.get<boolean>('showRecommendations', true),
                enableDashboard: config.get<boolean>('enableDashboard', true),
                syncOnChange: config.get<boolean>('syncOnChange', false),
                backupBeforeSync: config.get<boolean>('backupBeforeSync', true),
                notificationLevel: config.get<'none' | 'errors' | 'all'>('notificationLevel', 'errors'),
                defaultServerType: config.get<'local' | 'smithery' | 'custom'>('defaultServerType', 'local'),
                customServerUrl: config.get<string>('customServerUrl'),
                refreshInterval: config.get<number>('refreshInterval', 60),
                maxBackups: config.get<number>('maxBackups', 5)
            },
            serverConfigs: config.get<Record<string, any>>('serverConfigs', {}),
            clientTargets: config.get<string[]>('clientTargets', ['claude', 'cursor', 'windsurf'])
        };
    }

    private async _refreshData() {
        if (!this._view) {
            return;
        }

        try {
            await this._loadCurrentProfile();
            const discoveryResult = await this.discoveryService.discoverMcpEcosystem(true);
            const profiles = await this._getAllProfiles();
            
            this._view.webview.postMessage({
                command: 'updateData',
                data: {
                    currentProfile: this._currentProfile,
                    availableProfiles: profiles,
                    discoveryData: this._transformDiscoveryData(discoveryResult),
                    availableServers: this._getAvailableServers(),
                    presets: this._getConfigurationPresets()
                }
            });
        } catch (error) {
            console.error('Failed to refresh settings data:', error);
            this._showNotification('error', `Failed to load settings: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async _getAllProfiles(): Promise<SettingsProfile[]> {
        // Get saved profiles from extension context
        const savedProfiles = this.context.globalState.get<SettingsProfile[]>('settingsProfiles', []);
        
        return [
            this._currentProfile!,
            ...savedProfiles.filter(p => p.id !== 'default')
        ];
    }

    private _transformDiscoveryData(result: McpDiscoveryResult) {
        return {
            clients: result.clients.map(client => ({
                ...client,
                canConfigure: client.isInstalled,
                configurationStatus: this._getClientConfigStatus(client)
            })),
            servers: Array.from(result.servers.entries()).map(([name, config]) => ({
                name,
                ...config,
                canEnable: true,
                currentlyEnabled: this._currentProfile?.serverConfigs[name]?.enabled ?? false
            }))
        };
    }

    private _getClientConfigStatus(client: any) {
        if (!client.isInstalled) {
            return { status: 'not_installed', color: '#f44336', text: 'Not Installed' };
        }
        if (!client.configExists) {
            return { status: 'not_configured', color: '#FF9800', text: 'Not Configured' };
        }
        if (this._currentProfile?.clientTargets.includes(client.id)) {
            return { status: 'enabled', color: '#4CAF50', text: 'Enabled' };
        }
        return { status: 'disabled', color: '#757575', text: 'Disabled' };
    }

    private _getAvailableServers() {
        return [
            {
                id: 'specforged',
                name: 'SpecForged',
                description: 'Core specification-driven development server',
                category: 'core',
                defaultEnabled: true,
                configurable: true,
                documentation: 'https://github.com/whit3rabbit/SpecForge'
            },
            {
                id: 'context7',
                name: 'Context7',
                description: 'Advanced context and documentation server',
                category: 'documentation',
                defaultEnabled: false,
                configurable: true,
                documentation: 'https://context7.ai'
            },
            {
                id: 'tavily',
                name: 'Tavily',
                description: 'Web search and research capabilities',
                category: 'research',
                defaultEnabled: false,
                configurable: true,
                documentation: 'https://tavily.com'
            },
            {
                id: 'puppeteer',
                name: 'Puppeteer',
                description: 'Web automation and testing',
                category: 'automation',
                defaultEnabled: false,
                configurable: true,
                documentation: 'https://pptr.dev'
            }
        ];
    }

    private _getConfigurationPresets(): SettingsProfile[] {
        return [
            {
                id: 'minimal',
                name: 'Minimal Setup',
                description: 'Lightweight configuration with core features only',
                settings: {
                    autoDiscovery: false,
                    showRecommendations: false,
                    enableDashboard: true,
                    syncOnChange: false,
                    backupBeforeSync: false,
                    notificationLevel: 'errors',
                    defaultServerType: 'local',
                    refreshInterval: 300,
                    maxBackups: 3
                },
                serverConfigs: {
                    specforged: { enabled: true, priority: 1 }
                },
                clientTargets: ['claude']
            },
            {
                id: 'developer',
                name: 'Developer Mode',
                description: 'Full-featured setup for active development',
                settings: {
                    autoDiscovery: true,
                    showRecommendations: true,
                    enableDashboard: true,
                    syncOnChange: true,
                    backupBeforeSync: true,
                    notificationLevel: 'all',
                    defaultServerType: 'local',
                    refreshInterval: 30,
                    maxBackups: 10
                },
                serverConfigs: {
                    specforged: { enabled: true, priority: 1 },
                    context7: { enabled: true, priority: 2 },
                    tavily: { enabled: true, priority: 3 }
                },
                clientTargets: ['claude', 'cursor', 'windsurf', 'zed']
            },
            {
                id: 'team',
                name: 'Team Collaboration',
                description: 'Optimized for team environments with cloud sync',
                settings: {
                    autoDiscovery: true,
                    showRecommendations: true,
                    enableDashboard: true,
                    syncOnChange: true,
                    backupBeforeSync: true,
                    notificationLevel: 'errors',
                    defaultServerType: 'smithery',
                    refreshInterval: 60,
                    maxBackups: 5
                },
                serverConfigs: {
                    specforged: { enabled: true, priority: 1 },
                    context7: { enabled: true, priority: 2 }
                },
                clientTargets: ['claude', 'cursor', 'windsurf']
            }
        ];
    }

    private async _handleWebviewMessage(message: any) {
        switch (message.command) {
            case 'loadData':
                await this._refreshData();
                break;

            case 'updateSetting':
                await this._updateSetting(message.key, message.value);
                break;

            case 'updateServerConfig':
                await this._updateServerConfig(message.serverId, message.config);
                break;

            case 'updateClientTargets':
                await this._updateClientTargets(message.targets);
                break;

            case 'applyPreset':
                await this._applyPreset(message.presetId);
                break;

            case 'saveProfile':
                await this._saveProfile(message.profile);
                break;

            case 'loadProfile':
                await this._loadProfile(message.profileId);
                break;

            case 'deleteProfile':
                await this._deleteProfile(message.profileId);
                break;

            case 'exportSettings':
                await this._exportSettings();
                break;

            case 'importSettings':
                await this._importSettings();
                break;

            case 'resetToDefaults':
                await this._resetToDefaults();
                break;

            case 'testConfiguration':
                await this._testConfiguration();
                break;

            default:
                console.warn('Unknown settings message:', message.command);
        }
    }

    private async _updateSetting(key: string, value: any) {
        try {
            const config = vscode.workspace.getConfiguration('specforged');
            await config.update(key, value, vscode.ConfigurationTarget.Global);
            
            await this._loadCurrentProfile();
            this._showNotification('success', `Updated ${key} setting`);
            await this._refreshData();
        } catch (error) {
            this._showNotification('error', `Failed to update setting: ${error}`);
        }
    }

    private async _updateServerConfig(serverId: string, serverConfig: any) {
        try {
            const config = vscode.workspace.getConfiguration('specforged');
            const currentConfigs = config.get<Record<string, any>>('serverConfigs', {});
            
            currentConfigs[serverId] = serverConfig;
            await config.update('serverConfigs', currentConfigs, vscode.ConfigurationTarget.Global);
            
            await this._loadCurrentProfile();
            this._showNotification('success', `Updated ${serverId} server configuration`);
            await this._refreshData();
        } catch (error) {
            this._showNotification('error', `Failed to update server config: ${error}`);
        }
    }

    private async _updateClientTargets(targets: string[]) {
        try {
            const config = vscode.workspace.getConfiguration('specforged');
            await config.update('clientTargets', targets, vscode.ConfigurationTarget.Global);
            
            await this._loadCurrentProfile();
            this._showNotification('success', 'Updated client targets');
            await this._refreshData();
        } catch (error) {
            this._showNotification('error', `Failed to update client targets: ${error}`);
        }
    }

    private async _applyPreset(presetId: string) {
        try {
            const presets = this._getConfigurationPresets();
            const preset = presets.find(p => p.id === presetId);
            
            if (!preset) {
                throw new Error(`Preset ${presetId} not found`);
            }

            const config = vscode.workspace.getConfiguration('specforged');
            
            // Apply all settings from preset
            for (const [key, value] of Object.entries(preset.settings)) {
                await config.update(key, value, vscode.ConfigurationTarget.Global);
            }
            
            await config.update('serverConfigs', preset.serverConfigs, vscode.ConfigurationTarget.Global);
            await config.update('clientTargets', preset.clientTargets, vscode.ConfigurationTarget.Global);
            
            await this._loadCurrentProfile();
            this._showNotification('success', `Applied ${preset.name} preset`);
            await this._refreshData();
        } catch (error) {
            this._showNotification('error', `Failed to apply preset: ${error}`);
        }
    }

    private async _saveProfile(profile: Partial<SettingsProfile>) {
        try {
            if (!profile.name || profile.name.trim() === '') {
                throw new Error('Profile name is required');
            }

            const profiles = await this._getAllProfiles();
            const newProfile: SettingsProfile = {
                id: profile.id || `profile_${Date.now()}`,
                name: profile.name,
                description: profile.description || '',
                settings: { ...this._currentProfile!.settings, ...profile.settings },
                serverConfigs: { ...this._currentProfile!.serverConfigs, ...profile.serverConfigs },
                clientTargets: profile.clientTargets || this._currentProfile!.clientTargets
            };

            const existingIndex = profiles.findIndex(p => p.id === newProfile.id);
            if (existingIndex >= 0) {
                profiles[existingIndex] = newProfile;
            } else {
                profiles.push(newProfile);
            }

            const savedProfiles = profiles.filter(p => p.id !== 'default');
            await this.context.globalState.update('settingsProfiles', savedProfiles);
            
            this._showNotification('success', `Saved profile: ${newProfile.name}`);
            await this._refreshData();
        } catch (error) {
            this._showNotification('error', `Failed to save profile: ${error}`);
        }
    }

    private async _loadProfile(profileId: string) {
        try {
            const profiles = await this._getAllProfiles();
            const profile = profiles.find(p => p.id === profileId);
            
            if (!profile) {
                throw new Error(`Profile ${profileId} not found`);
            }

            if (profile.id === 'default') {
                await this._loadCurrentProfile();
            } else {
                const config = vscode.workspace.getConfiguration('specforged');
                
                // Apply profile settings
                for (const [key, value] of Object.entries(profile.settings)) {
                    await config.update(key, value, vscode.ConfigurationTarget.Global);
                }
                
                await config.update('serverConfigs', profile.serverConfigs, vscode.ConfigurationTarget.Global);
                await config.update('clientTargets', profile.clientTargets, vscode.ConfigurationTarget.Global);
                
                await this._loadCurrentProfile();
            }
            
            this._showNotification('success', `Loaded profile: ${profile.name}`);
            await this._refreshData();
        } catch (error) {
            this._showNotification('error', `Failed to load profile: ${error}`);
        }
    }

    private async _deleteProfile(profileId: string) {
        try {
            if (profileId === 'default') {
                throw new Error('Cannot delete the default profile');
            }

            const profiles = await this._getAllProfiles();
            const updatedProfiles = profiles.filter(p => p.id !== profileId && p.id !== 'default');
            
            await this.context.globalState.update('settingsProfiles', updatedProfiles);
            
            this._showNotification('success', 'Profile deleted');
            await this._refreshData();
        } catch (error) {
            this._showNotification('error', `Failed to delete profile: ${error}`);
        }
    }

    private async _exportSettings() {
        try {
            const profiles = await this._getAllProfiles();
            const exportData = {
                version: '1.0.0',
                timestamp: new Date().toISOString(),
                profiles: profiles,
                currentProfile: this._currentProfile
            };

            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file('specforged-settings.json'),
                filters: {
                    'JSON Files': ['json'],
                    'All Files': ['*']
                }
            });

            if (uri) {
                await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(exportData, null, 2), 'utf8'));
                this._showNotification('success', 'Settings exported successfully');
            }
        } catch (error) {
            this._showNotification('error', `Failed to export settings: ${error}`);
        }
    }

    private async _importSettings() {
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

                if (!importData.profiles || !Array.isArray(importData.profiles)) {
                    throw new Error('Invalid settings file format');
                }

                const action = await vscode.window.showWarningMessage(
                    'This will replace all current settings profiles. Continue?',
                    { modal: true },
                    'Replace All', 'Merge', 'Cancel'
                );

                if (action === 'Cancel') return;

                if (action === 'Replace All') {
                    const profilesToSave = importData.profiles.filter((p: any) => p.id !== 'default');
                    await this.context.globalState.update('settingsProfiles', profilesToSave);
                } else if (action === 'Merge') {
                    const currentProfiles = await this._getAllProfiles();
                    const importedProfiles = importData.profiles.filter((p: any) => p.id !== 'default');
                    const mergedProfiles = [...currentProfiles.filter(p => p.id !== 'default')];
                    
                    for (const imported of importedProfiles) {
                        const existingIndex = mergedProfiles.findIndex(p => p.id === imported.id);
                        if (existingIndex >= 0) {
                            mergedProfiles[existingIndex] = imported;
                        } else {
                            mergedProfiles.push(imported);
                        }
                    }
                    
                    await this.context.globalState.update('settingsProfiles', mergedProfiles);
                }

                this._showNotification('success', 'Settings imported successfully');
                await this._refreshData();
            }
        } catch (error) {
            this._showNotification('error', `Failed to import settings: ${error}`);
        }
    }

    private async _resetToDefaults() {
        try {
            const action = await vscode.window.showWarningMessage(
                'This will reset all SpecForged settings to their default values. Continue?',
                { modal: true },
                'Reset', 'Cancel'
            );

            if (action !== 'Reset') return;

            const config = vscode.workspace.getConfiguration('specforged');
            const defaultSettings = this._getConfigurationPresets()[0].settings; // Use minimal preset as default
            
            for (const [key, value] of Object.entries(defaultSettings)) {
                await config.update(key, value, vscode.ConfigurationTarget.Global);
            }
            
            await config.update('serverConfigs', {}, vscode.ConfigurationTarget.Global);
            await config.update('clientTargets', ['claude'], vscode.ConfigurationTarget.Global);
            
            await this._loadCurrentProfile();
            this._showNotification('success', 'Settings reset to defaults');
            await this._refreshData();
        } catch (error) {
            this._showNotification('error', `Failed to reset settings: ${error}`);
        }
    }

    private async _testConfiguration() {
        try {
            this._showNotification('info', 'Testing configuration...');
            
            // Test MCP discovery
            const discoveryResult = await this.discoveryService.discoverMcpEcosystem(true);
            
            // Test configuration sync
            await this.configSyncService.validateAllConfigurations();
            
            const results = {
                discovery: {
                    clientsDetected: discoveryResult.clients.length,
                    serversDetected: discoveryResult.servers.size,
                    configured: discoveryResult.configuredClients,
                    errors: discoveryResult.healthIssues
                },
                sync: {
                    profilesValid: true, // Would implement actual validation
                    backupsAvailable: 0, // Would check backup count
                    lastSync: new Date().toISOString()
                }
            };

            this._view?.webview.postMessage({
                command: 'testResults',
                results: results
            });

            if (results.discovery.errors.length > 0) {
                this._showNotification('warning', `Configuration test completed with ${results.discovery.errors.length} issues`);
            } else {
                this._showNotification('success', 'Configuration test passed');
            }
        } catch (error) {
            this._showNotification('error', `Configuration test failed: ${error}`);
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
    <title>SpecForged Settings</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-background);
            padding: 20px;
            margin: 0;
        }

        .settings-container {
            max-width: 800px;
            margin: 0 auto;
        }

        .settings-section {
            margin-bottom: 30px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            background: var(--vscode-panel-background);
        }

        .section-header {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .section-title {
            font-size: 16px;
            font-weight: 600;
            margin: 0;
            flex-grow: 1;
        }

        .section-actions {
            display: flex;
            gap: 10px;
        }

        .setting-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 15px;
            padding: 10px;
            border-radius: 4px;
            background: var(--vscode-background);
        }

        .setting-info {
            flex-grow: 1;
        }

        .setting-label {
            font-weight: 500;
            margin-bottom: 4px;
        }

        .setting-description {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
        }

        .setting-control {
            min-width: 120px;
            text-align: right;
        }

        .toggle-switch {
            position: relative;
            display: inline-block;
            width: 50px;
            height: 24px;
        }

        .toggle-switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }

        .slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            transition: 0.3s;
            border-radius: 24px;
        }

        .slider:before {
            position: absolute;
            content: "";
            height: 18px;
            width: 18px;
            left: 2px;
            bottom: 2px;
            background-color: var(--vscode-foreground);
            transition: 0.3s;
            border-radius: 50%;
        }

        input:checked + .slider {
            background-color: var(--vscode-button-background);
        }

        input:checked + .slider:before {
            transform: translateX(26px);
        }

        .btn {
            padding: 8px 16px;
            border: 1px solid var(--vscode-button-border);
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
            transition: all 0.2s;
        }

        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .preset-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 15px;
        }

        .preset-card {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 15px;
            cursor: pointer;
            transition: all 0.2s;
        }

        .preset-card:hover {
            border-color: var(--vscode-focusBorder);
            background: var(--vscode-list-hoverBackground);
        }

        .preset-card.active {
            border-color: var(--vscode-button-background);
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .preset-name {
            font-weight: 600;
            margin-bottom: 5px;
        }

        .preset-description {
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
        }

        .client-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }

        .client-card {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 15px;
            position: relative;
        }

        .client-name {
            font-weight: 600;
            margin-bottom: 5px;
        }

        .client-status {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 0.8em;
            font-weight: 500;
        }

        .server-list {
            space-y: 10px;
        }

        .server-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 15px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            background: var(--vscode-background);
        }

        .server-info {
            flex-grow: 1;
        }

        .server-name {
            font-weight: 600;
            margin-bottom: 4px;
        }

        .server-description {
            color: var(--vscode-descriptionForeground);
            font-size: 0.9em;
        }

        .server-controls {
            display: flex;
            align-items: center;
            gap: 15px;
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

        .profile-manager {
            display: flex;
            gap: 15px;
            margin-bottom: 20px;
        }

        .profile-selector {
            flex-grow: 1;
        }

        .profile-actions {
            display: flex;
            gap: 10px;
        }

        select, input[type="text"], input[type="number"], input[type="url"] {
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 6px 10px;
            font-size: 0.9em;
        }

        select:focus, input:focus {
            outline: 1px solid var(--vscode-focusBorder);
            outline-offset: -1px;
        }

        .hidden {
            display: none;
        }
    </style>
</head>
<body>
    <div class="settings-container">
        <div class="notification" id="notification"></div>
        
        <div class="settings-section">
            <div class="section-header">
                <h2 class="section-title">Profile Management</h2>
                <div class="section-actions">
                    <button class="btn" onclick="exportSettings()">Export</button>
                    <button class="btn" onclick="importSettings()">Import</button>
                </div>
            </div>
            
            <div class="profile-manager">
                <div class="profile-selector">
                    <select id="profileSelect" onchange="loadProfile(this.value)">
                        <option value="default">Default Configuration</option>
                    </select>
                </div>
                <div class="profile-actions">
                    <button class="btn btn-secondary" onclick="saveCurrentProfile()">Save As...</button>
                    <button class="btn btn-secondary" onclick="deleteCurrentProfile()">Delete</button>
                </div>
            </div>
        </div>

        <div class="settings-section">
            <div class="section-header">
                <h2 class="section-title">Configuration Presets</h2>
            </div>
            
            <div class="preset-grid" id="presetGrid">
                <!-- Presets will be populated by JavaScript -->
            </div>
        </div>

        <div class="settings-section">
            <div class="section-header">
                <h2 class="section-title">General Settings</h2>
                <button class="btn" onclick="testConfiguration()">Test Configuration</button>
            </div>
            
            <div id="generalSettings">
                <!-- Settings will be populated by JavaScript -->
            </div>
        </div>

        <div class="settings-section">
            <div class="section-header">
                <h2 class="section-title">MCP Clients</h2>
            </div>
            
            <div class="client-grid" id="clientGrid">
                <!-- Clients will be populated by JavaScript -->
            </div>
        </div>

        <div class="settings-section">
            <div class="section-header">
                <h2 class="section-title">MCP Servers</h2>
            </div>
            
            <div class="server-list" id="serverList">
                <!-- Servers will be populated by JavaScript -->
            </div>
        </div>

        <div class="settings-section">
            <div class="section-header">
                <h2 class="section-title">Advanced</h2>
            </div>
            
            <div class="setting-item">
                <div class="setting-info">
                    <div class="setting-label">Reset to Defaults</div>
                    <div class="setting-description">Reset all settings to their default values</div>
                </div>
                <div class="setting-control">
                    <button class="btn btn-secondary" onclick="resetToDefaults()">Reset</button>
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentData = null;

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
                case 'testResults':
                    showTestResults(message.results);
                    break;
            }
        });

        function updateUI() {
            if (!currentData) return;
            
            updateProfileSelector();
            updatePresets();
            updateGeneralSettings();
            updateClientGrid();
            updateServerList();
        }

        function updateProfileSelector() {
            const select = document.getElementById('profileSelect');
            select.innerHTML = '';
            
            currentData.availableProfiles.forEach(profile => {
                const option = document.createElement('option');
                option.value = profile.id;
                option.textContent = profile.name;
                if (profile.id === currentData.currentProfile.id) {
                    option.selected = true;
                }
                select.appendChild(option);
            });
        }

        function updatePresets() {
            const grid = document.getElementById('presetGrid');
            grid.innerHTML = '';
            
            currentData.presets.forEach(preset => {
                const card = document.createElement('div');
                card.className = 'preset-card';
                card.onclick = () => applyPreset(preset.id);
                
                card.innerHTML = \`
                    <div class="preset-name">\${preset.name}</div>
                    <div class="preset-description">\${preset.description}</div>
                \`;
                
                grid.appendChild(card);
            });
        }

        function updateGeneralSettings() {
            const container = document.getElementById('generalSettings');
            container.innerHTML = '';
            
            const settings = [
                { key: 'autoDiscovery', label: 'Auto Discovery', description: 'Automatically discover MCP clients and servers', type: 'boolean' },
                { key: 'showRecommendations', label: 'Show Recommendations', description: 'Display setup recommendations', type: 'boolean' },
                { key: 'enableDashboard', label: 'Enable Dashboard', description: 'Show the MCP dashboard panel', type: 'boolean' },
                { key: 'syncOnChange', label: 'Sync on Change', description: 'Automatically sync configuration changes', type: 'boolean' },
                { key: 'backupBeforeSync', label: 'Backup Before Sync', description: 'Create backups before syncing configurations', type: 'boolean' },
                { key: 'notificationLevel', label: 'Notification Level', description: 'Control notification verbosity', type: 'select', options: [
                    { value: 'none', label: 'None' },
                    { value: 'errors', label: 'Errors Only' },
                    { value: 'all', label: 'All Notifications' }
                ]},
                { key: 'defaultServerType', label: 'Default Server Type', description: 'Default MCP server deployment type', type: 'select', options: [
                    { value: 'local', label: 'Local' },
                    { value: 'smithery', label: 'Smithery Cloud' },
                    { value: 'custom', label: 'Custom' }
                ]},
                { key: 'customServerUrl', label: 'Custom Server URL', description: 'URL for custom MCP server', type: 'url' },
                { key: 'refreshInterval', label: 'Refresh Interval (seconds)', description: 'How often to refresh MCP status', type: 'number' },
                { key: 'maxBackups', label: 'Max Backups', description: 'Maximum number of configuration backups to keep', type: 'number' }
            ];
            
            settings.forEach(setting => {
                const item = document.createElement('div');
                item.className = 'setting-item';
                
                let controlHtml = '';
                const currentValue = currentData.currentProfile.settings[setting.key];
                
                if (setting.type === 'boolean') {
                    controlHtml = \`
                        <label class="toggle-switch">
                            <input type="checkbox" \${currentValue ? 'checked' : ''} 
                                   onchange="updateSetting('\${setting.key}', this.checked)">
                            <span class="slider"></span>
                        </label>
                    \`;
                } else if (setting.type === 'select') {
                    const options = setting.options.map(opt => 
                        \`<option value="\${opt.value}" \${currentValue === opt.value ? 'selected' : ''}>\${opt.label}</option>\`
                    ).join('');
                    controlHtml = \`
                        <select onchange="updateSetting('\${setting.key}', this.value)">
                            \${options}
                        </select>
                    \`;
                } else if (setting.type === 'number') {
                    controlHtml = \`
                        <input type="number" value="\${currentValue || ''}" 
                               onchange="updateSetting('\${setting.key}', parseInt(this.value))">
                    \`;
                } else if (setting.type === 'url') {
                    controlHtml = \`
                        <input type="url" value="\${currentValue || ''}" 
                               onchange="updateSetting('\${setting.key}', this.value)">
                    \`;
                }
                
                item.innerHTML = \`
                    <div class="setting-info">
                        <div class="setting-label">\${setting.label}</div>
                        <div class="setting-description">\${setting.description}</div>
                    </div>
                    <div class="setting-control">
                        \${controlHtml}
                    </div>
                \`;
                
                container.appendChild(item);
            });
        }

        function updateClientGrid() {
            const grid = document.getElementById('clientGrid');
            grid.innerHTML = '';
            
            currentData.discoveryData.clients.forEach(client => {
                const card = document.createElement('div');
                card.className = 'client-card';
                
                const isEnabled = currentData.currentProfile.clientTargets.includes(client.id);
                const statusStyle = \`background-color: \${client.configurationStatus.color}; color: white;\`;
                
                card.innerHTML = \`
                    <div class="client-name">\${client.displayName}</div>
                    <div class="client-status" style="\${statusStyle}">
                        \${client.configurationStatus.text}
                    </div>
                    <div style="margin-top: 10px;">
                        <label>
                            <input type="checkbox" \${isEnabled ? 'checked' : ''} 
                                   onchange="toggleClient('\${client.id}', this.checked)">
                            Enable for SpecForged
                        </label>
                    </div>
                \`;
                
                grid.appendChild(card);
            });
        }

        function updateServerList() {
            const list = document.getElementById('serverList');
            list.innerHTML = '';
            
            currentData.availableServers.forEach(server => {
                const item = document.createElement('div');
                item.className = 'server-item';
                
                const config = currentData.currentProfile.serverConfigs[server.id] || { enabled: false, priority: 1 };
                
                item.innerHTML = \`
                    <div class="server-info">
                        <div class="server-name">\${server.name}</div>
                        <div class="server-description">\${server.description}</div>
                    </div>
                    <div class="server-controls">
                        <label>Priority:</label>
                        <input type="number" value="\${config.priority}" min="1" max="10"
                               onchange="updateServerConfig('\${server.id}', 'priority', parseInt(this.value))">
                        <label class="toggle-switch">
                            <input type="checkbox" \${config.enabled ? 'checked' : ''} 
                                   onchange="updateServerConfig('\${server.id}', 'enabled', this.checked)">
                            <span class="slider"></span>
                        </label>
                    </div>
                \`;
                
                list.appendChild(item);
            });
        }

        // Event handlers
        function updateSetting(key, value) {
            vscode.postMessage({ command: 'updateSetting', key, value });
        }

        function toggleClient(clientId, enabled) {
            let targets = [...currentData.currentProfile.clientTargets];
            if (enabled && !targets.includes(clientId)) {
                targets.push(clientId);
            } else if (!enabled && targets.includes(clientId)) {
                targets = targets.filter(id => id !== clientId);
            }
            vscode.postMessage({ command: 'updateClientTargets', targets });
        }

        function updateServerConfig(serverId, key, value) {
            const currentConfig = currentData.currentProfile.serverConfigs[serverId] || {};
            const newConfig = { ...currentConfig, [key]: value };
            vscode.postMessage({ command: 'updateServerConfig', serverId, config: newConfig });
        }

        function applyPreset(presetId) {
            vscode.postMessage({ command: 'applyPreset', presetId });
        }

        function loadProfile(profileId) {
            vscode.postMessage({ command: 'loadProfile', profileId });
        }

        function saveCurrentProfile() {
            const name = prompt('Enter profile name:');
            if (name && name.trim()) {
                const profile = {
                    name: name.trim(),
                    description: prompt('Enter profile description (optional):') || ''
                };
                vscode.postMessage({ command: 'saveProfile', profile });
            }
        }

        function deleteCurrentProfile() {
            const profileId = document.getElementById('profileSelect').value;
            if (profileId !== 'default' && confirm('Delete this profile?')) {
                vscode.postMessage({ command: 'deleteProfile', profileId });
            }
        }

        function exportSettings() {
            vscode.postMessage({ command: 'exportSettings' });
        }

        function importSettings() {
            vscode.postMessage({ command: 'importSettings' });
        }

        function resetToDefaults() {
            if (confirm('Reset all settings to defaults? This cannot be undone.')) {
                vscode.postMessage({ command: 'resetToDefaults' });
            }
        }

        function testConfiguration() {
            vscode.postMessage({ command: 'testConfiguration' });
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

        function showTestResults(results) {
            const message = \`Configuration Test Results:
• Clients detected: \${results.discovery.clientsDetected}
• Servers detected: \${results.discovery.serversDetected}  
• Configured clients: \${results.discovery.configured}
• Issues found: \${results.discovery.errors.length}\`;
            
            showNotification(results.discovery.errors.length > 0 ? 'warning' : 'success', message);
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