/**
 * Enhanced Settings Provider with comprehensive configuration management.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { FeatureFlagService, getFeatureFlagService } from '../services/FeatureFlagService';
import { ConfigurationValidationService, getConfigurationValidationService } from '../services/ConfigurationValidationService';

export interface SettingDefinition {
    key: string;
    label: string;
    description: string;
    type: 'boolean' | 'string' | 'number' | 'select' | 'multiselect' | 'url' | 'time' | 'color';
    category: string;
    options?: Array<{ value: any; label: string; description?: string }>;
    min?: number;
    max?: number;
    pattern?: string;
    required?: boolean;
    advanced?: boolean;
    experimental?: boolean;
    dependsOn?: string;
    validation?: (value: any) => string | null;
}

export interface SettingCategory {
    id: string;
    name: string;
    description: string;
    icon: string;
    order: number;
    collapsible?: boolean;
    defaultCollapsed?: boolean;
}

export class EnhancedSettingsProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'specforged.enhancedSettings';

    private _view?: vscode.WebviewView;
    private featureFlagService: FeatureFlagService;
    private validationService: ConfigurationValidationService;
    private currentFilter = '';
    private currentCategory = '';
    private showAdvanced = false;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly context: vscode.ExtensionContext
    ) {
        this.featureFlagService = getFeatureFlagService(context);
        this.validationService = getConfigurationValidationService(context, this.featureFlagService);

        // Load UI preferences
        this.showAdvanced = context.globalState.get('settings.showAdvanced', false);
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage(
            async message => await this._handleWebviewMessage(message),
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
            const config = vscode.workspace.getConfiguration('specforged');
            const categories = this._getSettingCategories();
            const settings = this._getSettingDefinitions();
            const validationResult = await this.validationService.validateConfiguration();
            const featureStats = this.featureFlagService.getFeatureFlagStats();

            this._view.webview.postMessage({
                command: 'updateData',
                data: {
                    settings,
                    categories,
                    currentValues: this._getCurrentValues(config, settings),
                    validation: validationResult,
                    featureFlags: featureStats,
                    userContext: this.featureFlagService.getUserContext(),
                    showAdvanced: this.showAdvanced
                }
            });
        } catch (error) {
            console.error('Failed to refresh enhanced settings data:', error);
        }
    }

    private async _handleWebviewMessage(message: any) {
        switch (message.command) {
            case 'loadData':
                await this._refreshData();
                break;

            case 'updateSetting':
                await this._updateSetting(message.key, message.value);
                break;

            case 'resetSetting':
                await this._resetSetting(message.key);
                break;

            case 'resetCategory':
                await this._resetCategory(message.category);
                break;

            case 'resetAll':
                await this._resetAllSettings();
                break;

            case 'exportSettings':
                await this._exportSettings();
                break;

            case 'importSettings':
                await this._importSettings();
                break;

            case 'validateConfiguration':
                const result = await this.validationService.validateConfiguration(true);
                this._view?.webview.postMessage({
                    command: 'validationResult',
                    result
                });
                break;

            case 'autoFixIssues':
                const fixResult = await this.validationService.autoFixIssues();
                this._view?.webview.postMessage({
                    command: 'fixResult',
                    result: fixResult
                });
                await this._refreshData();
                break;

            case 'toggleAdvanced':
                this.showAdvanced = message.show;
                await this.context.globalState.update('settings.showAdvanced', this.showAdvanced);
                await this._refreshData();
                break;

            case 'setFilter':
                this.currentFilter = message.filter;
                await this._refreshData();
                break;

            case 'setCategory':
                this.currentCategory = message.category;
                await this._refreshData();
                break;

            case 'createFeatureFlag':
                await this.featureFlagService.createFlag(
                    message.name,
                    message.enabled,
                    message.options
                );
                await this._refreshData();
                break;

            case 'updateFeatureFlag':
                await this.featureFlagService.updateFlag(message.name, message.updates);
                await this._refreshData();
                break;

            case 'deleteFeatureFlag':
                await this.featureFlagService.deleteFlag(message.name);
                await this._refreshData();
                break;

            case 'openConfigDashboard':
                await vscode.commands.executeCommand('specforged.showConfigurationDashboard');
                break;

            default:
                console.warn('Unknown enhanced settings message:', message.command);
        }
    }

    private async _updateSetting(key: string, value: any) {
        try {
            const config = vscode.workspace.getConfiguration('specforged');
            const settingDef = this._getSettingDefinitions().find(s => s.key === key);

            // Validate setting value
            if (settingDef?.validation) {
                const validationError = settingDef.validation(value);
                if (validationError) {
                    this._showNotification('error', `Validation failed: ${validationError}`);
                    return;
                }
            }

            await config.update(key, value, vscode.ConfigurationTarget.Global);
            this._showNotification('success', `Updated ${settingDef?.label || key}`);
            await this._refreshData();
        } catch (error) {
            this._showNotification('error', `Failed to update setting: ${error}`);
        }
    }

    private async _resetSetting(key: string) {
        try {
            const config = vscode.workspace.getConfiguration('specforged');
            await config.update(key, undefined, vscode.ConfigurationTarget.Global);

            const settingDef = this._getSettingDefinitions().find(s => s.key === key);
            this._showNotification('success', `Reset ${settingDef?.label || key} to default`);
            await this._refreshData();
        } catch (error) {
            this._showNotification('error', `Failed to reset setting: ${error}`);
        }
    }

    private async _resetCategory(categoryId: string) {
        try {
            const settings = this._getSettingDefinitions().filter(s => s.category === categoryId);
            const config = vscode.workspace.getConfiguration('specforged');

            for (const setting of settings) {
                await config.update(setting.key, undefined, vscode.ConfigurationTarget.Global);
            }

            const category = this._getSettingCategories().find(c => c.id === categoryId);
            this._showNotification('success', `Reset ${category?.name || categoryId} settings to defaults`);
            await this._refreshData();
        } catch (error) {
            this._showNotification('error', `Failed to reset category: ${error}`);
        }
    }

    private async _resetAllSettings() {
        const action = await vscode.window.showWarningMessage(
            'This will reset ALL SpecForged settings to their default values. This action cannot be undone.',
            { modal: true },
            'Reset All', 'Cancel'
        );

        if (action !== 'Reset All') {
            return;
        }

        try {
            const settings = this._getSettingDefinitions();
            const config = vscode.workspace.getConfiguration('specforged');

            for (const setting of settings) {
                await config.update(setting.key, undefined, vscode.ConfigurationTarget.Global);
            }

            this._showNotification('success', 'All settings have been reset to defaults');
            await this._refreshData();
        } catch (error) {
            this._showNotification('error', `Failed to reset all settings: ${error}`);
        }
    }

    private async _exportSettings() {
        try {
            const config = vscode.workspace.getConfiguration('specforged');
            const settings = this._getSettingDefinitions();

            const exportData = {
                timestamp: new Date().toISOString(),
                version: vscode.extensions.getExtension('specforged.vscode-specforged')?.packageJSON.version,
                settings: {} as Record<string, any>
            };

            // Export all settings with their current values
            for (const setting of settings) {
                const value = config.get(setting.key);
                if (value !== undefined) {
                    exportData.settings[setting.key] = value;
                }
            }

            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file('specforged-settings.json'),
                filters: {
                    'JSON Files': ['json'],
                    'All Files': ['*']
                }
            });

            if (uri) {
                await vscode.workspace.fs.writeFile(
                    uri,
                    Buffer.from(JSON.stringify(exportData, null, 2), 'utf8')
                );
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

            if (!uri || !uri[0]) {
                return;
            }

            const data = await vscode.workspace.fs.readFile(uri[0]);
            const importData = JSON.parse(Buffer.from(data).toString('utf8'));

            if (!importData.settings) {
                throw new Error('Invalid settings file format');
            }

            const action = await vscode.window.showInformationMessage(
                'Import settings from file?',
                { modal: true },
                'Import', 'Preview', 'Cancel'
            );

            if (action === 'Cancel') {
                return;
            }

            if (action === 'Preview') {
                // Show preview of settings that will be imported
                const settingNames = Object.keys(importData.settings);
                const preview = settingNames.slice(0, 10).join(', ') +
                    (settingNames.length > 10 ? ` and ${settingNames.length - 10} more` : '');

                const confirmAction = await vscode.window.showInformationMessage(
                    `Preview: Will import ${settingNames.length} settings including: ${preview}`,
                    { modal: true },
                    'Import', 'Cancel'
                );

                if (confirmAction !== 'Import') {
                    return;
                }
            }

            const config = vscode.workspace.getConfiguration('specforged');
            let imported = 0;
            let failed = 0;

            for (const [key, value] of Object.entries(importData.settings)) {
                try {
                    await config.update(key, value, vscode.ConfigurationTarget.Global);
                    imported++;
                } catch (error) {
                    console.error(`Failed to import setting ${key}:`, error);
                    failed++;
                }
            }

            this._showNotification('success',
                `Imported ${imported} settings` + (failed > 0 ? `, ${failed} failed` : '')
            );
            await this._refreshData();
        } catch (error) {
            this._showNotification('error', `Failed to import settings: ${error}`);
        }
    }

    private _getCurrentValues(config: vscode.WorkspaceConfiguration, settings: SettingDefinition[]): Record<string, any> {
        const values: Record<string, any> = {};

        for (const setting of settings) {
            values[setting.key] = config.get(setting.key);
        }

        return values;
    }

    private _getSettingCategories(): SettingCategory[] {
        return [
            {
                id: 'general',
                name: 'General',
                description: 'Basic extension settings',
                icon: 'gear',
                order: 1
            },
            {
                id: 'connection',
                name: 'Server Connection',
                description: 'MCP server connection settings',
                icon: 'plug',
                order: 2
            },
            {
                id: 'notifications',
                name: 'Notifications',
                description: 'Notification behavior and preferences',
                icon: 'bell',
                order: 3
            },
            {
                id: 'performance',
                name: 'Performance',
                description: 'Performance optimization settings',
                icon: 'zap',
                order: 4
            },
            {
                id: 'queue',
                name: 'Queue Management',
                description: 'Operation queue configuration',
                icon: 'list-ordered',
                order: 5
            },
            {
                id: 'security',
                name: 'Security',
                description: 'Security and validation settings',
                icon: 'shield',
                order: 6
            },
            {
                id: 'features',
                name: 'Feature Flags',
                description: 'Experimental and beta features',
                icon: 'beaker',
                order: 7
            },
            {
                id: 'diagnostics',
                name: 'Diagnostics',
                description: 'Debugging and troubleshooting',
                icon: 'bug',
                order: 8
            },
            {
                id: 'ui',
                name: 'User Interface',
                description: 'UI appearance and behavior',
                icon: 'paintbrush',
                order: 9
            },
            {
                id: 'accessibility',
                name: 'Accessibility',
                description: 'Accessibility and inclusive design',
                icon: 'accessibility',
                order: 10
            },
            {
                id: 'advanced',
                name: 'Advanced',
                description: 'Advanced configuration options',
                icon: 'tools',
                order: 11,
                collapsible: true,
                defaultCollapsed: true
            }
        ];
    }

    private _getSettingDefinitions(): SettingDefinition[] {
        return [
            // General Settings
            {
                key: 'autoDetect',
                label: 'Auto Detect Specifications',
                description: 'Automatically detect specifications in workspace',
                type: 'boolean',
                category: 'general'
            },
            {
                key: 'specFolder',
                label: 'Specification Folder',
                description: 'Default specification folder name',
                type: 'string',
                category: 'general',
                validation: (value: string) => {
                    if (!value || value.trim().length === 0) {
                        return 'Specification folder name cannot be empty';
                    }
                    if (value.includes('/') || value.includes('\\')) {
                        return 'Folder name cannot contain path separators';
                    }
                    return null;
                }
            },
            {
                key: 'showProgressBadges',
                label: 'Show Progress Badges',
                description: 'Show progress badges in specification tree',
                type: 'boolean',
                category: 'general'
            },
            {
                key: 'enableWebview',
                label: 'Enable Rich Webview',
                description: 'Enable rich webview for specification display',
                type: 'boolean',
                category: 'general'
            },

            // Server Connection Settings
            {
                key: 'mcpServerType',
                label: 'Server Type',
                description: 'Type of MCP server to connect to',
                type: 'select',
                category: 'connection',
                options: [
                    { value: 'local', label: 'Local', description: 'Local SpecForged installation' },
                    { value: 'smithery', label: 'Smithery Cloud', description: 'Cloud-hosted server' },
                    { value: 'custom', label: 'Custom', description: 'Custom HTTP server URL' }
                ]
            },
            {
                key: 'mcpServerUrl',
                label: 'Server URL',
                description: 'URL for Smithery or custom HTTP MCP server',
                type: 'url',
                category: 'connection',
                dependsOn: 'mcpServerType',
                validation: (value: string) => {
                    if (value && !value.match(/^https?:\/\/.+/)) {
                        return 'Must be a valid HTTP or HTTPS URL';
                    }
                    return null;
                }
            },
            {
                key: 'connectionTimeout',
                label: 'Connection Timeout (ms)',
                description: 'Connection timeout in milliseconds for HTTP servers',
                type: 'number',
                category: 'connection',
                min: 1000,
                max: 60000
            },
            {
                key: 'retryAttempts',
                label: 'Retry Attempts',
                description: 'Number of connection retry attempts for MCP servers',
                type: 'number',
                category: 'connection',
                min: 1,
                max: 10
            },
            {
                key: 'retryDelay',
                label: 'Retry Delay (ms)',
                description: 'Delay in milliseconds between connection retries',
                type: 'number',
                category: 'connection',
                min: 1000,
                max: 30000
            },

            // Notification Settings
            {
                key: 'notifications.enabled',
                label: 'Enable Notifications',
                description: 'Show notifications for MCP operations and status changes',
                type: 'boolean',
                category: 'notifications'
            },
            {
                key: 'notifications.showSuccess',
                label: 'Show Success Notifications',
                description: 'Show notifications for successful operations',
                type: 'boolean',
                category: 'notifications'
            },
            {
                key: 'notifications.showFailure',
                label: 'Show Failure Notifications',
                description: 'Show notifications for failed operations',
                type: 'boolean',
                category: 'notifications'
            },
            {
                key: 'notifications.showProgress',
                label: 'Show Progress Notifications',
                description: 'Show progress notifications for long-running operations',
                type: 'boolean',
                category: 'notifications'
            },
            {
                key: 'notifications.duration',
                label: 'Notification Duration (ms)',
                description: 'Duration in milliseconds for auto-hiding notifications',
                type: 'number',
                category: 'notifications',
                min: 1000,
                max: 30000
            },
            {
                key: 'notifications.enableSounds',
                label: 'Enable Notification Sounds',
                description: 'Enable notification sounds',
                type: 'boolean',
                category: 'notifications'
            },
            {
                key: 'notifications.quietHours.enabled',
                label: 'Enable Quiet Hours',
                description: 'Enable quiet hours to suppress notifications',
                type: 'boolean',
                category: 'notifications'
            },
            {
                key: 'notifications.quietHours.startTime',
                label: 'Quiet Hours Start Time',
                description: 'Start time for quiet hours (HH:MM format)',
                type: 'time',
                category: 'notifications',
                pattern: '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
            },
            {
                key: 'notifications.quietHours.endTime',
                label: 'Quiet Hours End Time',
                description: 'End time for quiet hours (HH:MM format)',
                type: 'time',
                category: 'notifications',
                pattern: '^([01]?[0-9]|2[0-3]):[0-5][0-9]$'
            },

            // Performance Settings
            {
                key: 'performance.memoryLimitMb',
                label: 'Memory Limit (MB)',
                description: 'Memory limit in MB for extension operations',
                type: 'number',
                category: 'performance',
                min: 50,
                max: 2048
            },
            {
                key: 'performance.enableMemoryMonitoring',
                label: 'Enable Memory Monitoring',
                description: 'Monitor memory usage and show warnings',
                type: 'boolean',
                category: 'performance'
            },
            {
                key: 'performance.enableCaching',
                label: 'Enable Result Caching',
                description: 'Enable result caching for better performance',
                type: 'boolean',
                category: 'performance'
            },
            {
                key: 'performance.cacheSize',
                label: 'Cache Size',
                description: 'Maximum cache entries',
                type: 'number',
                category: 'performance',
                min: 100,
                max: 10000
            },
            {
                key: 'performance.cacheTtlSeconds',
                label: 'Cache TTL (seconds)',
                description: 'Cache time-to-live in seconds',
                type: 'number',
                category: 'performance',
                min: 30,
                max: 3600
            },

            // Queue Management Settings
            {
                key: 'queue.maxSize',
                label: 'Maximum Queue Size',
                description: 'Maximum operation queue size',
                type: 'number',
                category: 'queue',
                min: 100,
                max: 100000
            },
            {
                key: 'queue.processingIntervalMs',
                label: 'Processing Interval (ms)',
                description: 'Queue processing interval in milliseconds',
                type: 'number',
                category: 'queue',
                min: 100,
                max: 60000
            },
            {
                key: 'queue.enableBatching',
                label: 'Enable Operation Batching',
                description: 'Enable operation batching for better performance',
                type: 'boolean',
                category: 'queue'
            },
            {
                key: 'queue.maxBatchSize',
                label: 'Maximum Batch Size',
                description: 'Maximum operations per batch',
                type: 'number',
                category: 'queue',
                min: 1,
                max: 1000
            },

            // Security Settings
            {
                key: 'security.enableStrictValidation',
                label: 'Enable Strict Validation',
                description: 'Enable strict input validation and sanitization',
                type: 'boolean',
                category: 'security'
            },
            {
                key: 'security.enableRateLimiting',
                label: 'Enable Rate Limiting',
                description: 'Enable rate limiting for operations',
                type: 'boolean',
                category: 'security'
            },
            {
                key: 'security.maxRequestsPerMinute',
                label: 'Max Requests Per Minute',
                description: 'Maximum requests per minute',
                type: 'number',
                category: 'security',
                min: 10,
                max: 1000
            },

            // Feature Flags
            {
                key: 'featureFlags.enableExperimentalFeatures',
                label: 'Enable Experimental Features',
                description: 'Enable experimental features (may be unstable)',
                type: 'boolean',
                category: 'features',
                experimental: true
            },
            {
                key: 'featureFlags.enableBetaFeatures',
                label: 'Enable Beta Features',
                description: 'Enable beta features for testing',
                type: 'boolean',
                category: 'features'
            },
            {
                key: 'featureFlags.rolloutGroup',
                label: 'Feature Rollout Group',
                description: 'Feature rollout group membership',
                type: 'select',
                category: 'features',
                options: [
                    { value: 'stable', label: 'Stable', description: 'Stable release features only' },
                    { value: 'beta', label: 'Beta', description: 'Beta features enabled' },
                    { value: 'alpha', label: 'Alpha', description: 'Alpha features enabled (early adopter)' },
                    { value: 'internal', label: 'Internal', description: 'Internal/development features enabled' }
                ]
            },

            // Diagnostic Settings
            {
                key: 'diagnostics.enableDetailedLogging',
                label: 'Enable Detailed Logging',
                description: 'Enable detailed diagnostic logging',
                type: 'boolean',
                category: 'diagnostics'
            },
            {
                key: 'diagnostics.logToFile',
                label: 'Log to File',
                description: 'Write diagnostic logs to file',
                type: 'boolean',
                category: 'diagnostics'
            },
            {
                key: 'diagnostics.enableHealthChecks',
                label: 'Enable Health Checks',
                description: 'Run periodic health checks on connections and services',
                type: 'boolean',
                category: 'diagnostics'
            },

            // UI Settings
            {
                key: 'ui.theme',
                label: 'UI Theme',
                description: 'UI theme preference for SpecForged panels',
                type: 'select',
                category: 'ui',
                options: [
                    { value: 'auto', label: 'Auto (Follow VS Code)' },
                    { value: 'light', label: 'Light Theme' },
                    { value: 'dark', label: 'Dark Theme' },
                    { value: 'high_contrast', label: 'High Contrast Theme' }
                ]
            },
            {
                key: 'ui.compactMode',
                label: 'Compact Mode',
                description: 'Use compact UI layout to save space',
                type: 'boolean',
                category: 'ui'
            },
            {
                key: 'ui.enableAnimations',
                label: 'Enable Animations',
                description: 'Enable UI animations and transitions',
                type: 'boolean',
                category: 'ui'
            },

            // Accessibility Settings
            {
                key: 'accessibility.enableScreenReaderSupport',
                label: 'Enable Screen Reader Support',
                description: 'Enable screen reader accessibility support',
                type: 'boolean',
                category: 'accessibility'
            },
            {
                key: 'accessibility.enableKeyboardNavigation',
                label: 'Enable Keyboard Navigation',
                description: 'Enable full keyboard navigation',
                type: 'boolean',
                category: 'accessibility'
            },
            {
                key: 'accessibility.highContrastMode',
                label: 'High Contrast Mode',
                description: 'Enable high contrast mode for better visibility',
                type: 'boolean',
                category: 'accessibility'
            },

            // Advanced Settings
            {
                key: 'environment',
                label: 'Environment',
                description: 'Runtime environment configuration',
                type: 'select',
                category: 'advanced',
                advanced: true,
                options: [
                    { value: 'development', label: 'Development', description: 'Development environment with debug features' },
                    { value: 'testing', label: 'Testing', description: 'Testing environment with validation enabled' },
                    { value: 'staging', label: 'Staging', description: 'Staging environment for pre-production testing' },
                    { value: 'production', label: 'Production', description: 'Production environment with optimized settings' }
                ]
            },
            {
                key: 'debugMode',
                label: 'Debug Mode',
                description: 'Enable debug mode for troubleshooting',
                type: 'boolean',
                category: 'advanced',
                advanced: true
            },
            {
                key: 'logLevel',
                label: 'Log Level',
                description: 'Logging level for extension output',
                type: 'select',
                category: 'advanced',
                advanced: true,
                options: [
                    { value: 'error', label: 'Error' },
                    { value: 'warn', label: 'Warning' },
                    { value: 'info', label: 'Info' },
                    { value: 'debug', label: 'Debug' },
                    { value: 'trace', label: 'Trace' }
                ]
            }
        ];
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
        // Return comprehensive HTML for enhanced settings UI
        // This would be a large HTML template - truncated for brevity
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Enhanced SpecForged Settings</title>
    <style>
        /* Enhanced CSS styles would go here */
        body { font-family: var(--vscode-font-family); padding: 0; margin: 0; }
        .settings-container { display: flex; flex-direction: column; height: 100vh; }
        .settings-header { padding: 16px; border-bottom: 1px solid var(--vscode-panel-border); }
        .settings-toolbar { display: flex; gap: 8px; align-items: center; }
        .search-box { flex: 1; padding: 8px; border: 1px solid var(--vscode-input-border); border-radius: 4px; }
        .category-tabs { display: flex; overflow-x: auto; border-bottom: 1px solid var(--vscode-panel-border); }
        .category-tab { padding: 12px 16px; cursor: pointer; border-bottom: 2px solid transparent; }
        .category-tab.active { border-bottom-color: var(--vscode-focusBorder); }
        .settings-content { flex: 1; overflow-y: auto; padding: 16px; }
        .setting-section { margin-bottom: 24px; }
        .setting-item { margin-bottom: 16px; padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; }
        .setting-header { display: flex; justify-content: between; align-items: center; margin-bottom: 8px; }
        .setting-label { font-weight: 600; }
        .setting-description { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-bottom: 8px; }
        .setting-control { /* Styles for various input types */ }
        .validation-error { color: var(--vscode-errorForeground); font-size: 0.85em; margin-top: 4px; }
        .experimental-badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 0.7em; padding: 2px 6px; border-radius: 3px; }
    </style>
</head>
<body>
    <div class="settings-container">
        <div class="settings-header">
            <h1>SpecForged Configuration</h1>
            <div class="settings-toolbar">
                <input type="text" id="searchBox" class="search-box" placeholder="Search settings..." />
                <button onclick="toggleAdvanced()">Advanced</button>
                <button onclick="validateConfig()">Validate</button>
                <button onclick="exportSettings()">Export</button>
                <button onclick="importSettings()">Import</button>
            </div>
        </div>
        <div class="category-tabs" id="categoryTabs"></div>
        <div class="settings-content" id="settingsContent"></div>
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
                // ... other message handlers
            }
        });

        function updateUI() {
            if (!currentData) return;
            renderCategoryTabs();
            renderSettings();
        }

        function renderCategoryTabs() {
            const container = document.getElementById('categoryTabs');
            container.innerHTML = '';

            currentData.categories
                .sort((a, b) => a.order - b.order)
                .forEach(category => {
                    const tab = document.createElement('div');
                    tab.className = 'category-tab';
                    tab.textContent = category.name;
                    tab.onclick = () => setCategory(category.id);
                    container.appendChild(tab);
                });
        }

        function renderSettings() {
            const container = document.getElementById('settingsContent');
            container.innerHTML = '';

            // Group settings by category and render
            // Implementation would handle filtering, search, validation display, etc.
        }

        function toggleAdvanced() {
            vscode.postMessage({ command: 'toggleAdvanced', show: !currentData.showAdvanced });
        }

        function validateConfig() {
            vscode.postMessage({ command: 'validateConfiguration' });
        }

        function exportSettings() {
            vscode.postMessage({ command: 'exportSettings' });
        }

        function importSettings() {
            vscode.postMessage({ command: 'importSettings' });
        }

        function setCategory(categoryId) {
            vscode.postMessage({ command: 'setCategory', category: categoryId });
        }

        function showNotification(type, message) {
            // Show notification in UI
        }
    </script>
</body>
</html>`;
    }

    public dispose() {
        // Cleanup
    }
}
