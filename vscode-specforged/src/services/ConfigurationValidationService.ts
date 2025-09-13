/**
 * Configuration validation and error handling service for SpecForged VS Code extension.
 */

import * as vscode from 'vscode';
import { FeatureFlagService } from './FeatureFlagService';

export interface ValidationError {
    field: string;
    message: string;
    severity: 'error' | 'warning' | 'info';
    suggestedFix?: string;
    code?: string;
}

export interface ValidationResult {
    isValid: boolean;
    errors: ValidationError[];
    warnings: ValidationError[];
    suggestions: ValidationError[];
}

export interface ConfigurationHealth {
    overall: 'healthy' | 'warning' | 'critical';
    lastCheck: string;
    issues: ValidationError[];
    summary: {
        criticalIssues: number;
        warnings: number;
        suggestions: number;
    };
}

export interface ValidationRule {
    name: string;
    description: string;
    category: string;
    validate: (config: vscode.WorkspaceConfiguration) => ValidationError[];
    autoFix?: (config: vscode.WorkspaceConfiguration) => Promise<boolean>;
}

export class ConfigurationValidationService {
    private validationRules: ValidationRule[] = [];
    private validationCache = new Map<string, ValidationResult>();
    private readonly cacheTimeout = 2 * 60 * 1000; // 2 minutes
    private lastValidation = 0;

    constructor(
        private context: vscode.ExtensionContext,
        private featureFlagService: FeatureFlagService
    ) {
        this.registerDefaultRules();
        this.startPeriodicValidation();

        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('specforged')) {
                this.clearCache();
                // Validate after a short delay to batch multiple changes
                setTimeout(() => this.validateConfiguration(), 500);
            }
        }, null, context.subscriptions);
    }

    /**
     * Validate current configuration and return results.
     */
    async validateConfiguration(showNotifications = false): Promise<ValidationResult> {
        const cacheKey = 'current_config';

        // Check cache first
        if (this.isCacheValid() && this.validationCache.has(cacheKey)) {
            return this.validationCache.get(cacheKey)!;
        }

        const config = vscode.workspace.getConfiguration('specforged');
        const result = await this.runValidation(config);

        // Cache result
        this.validationCache.set(cacheKey, result);
        this.lastValidation = Date.now();

        // Show notifications if requested
        if (showNotifications) {
            this.showValidationNotifications(result);
        }

        return result;
    }

    /**
     * Get current configuration health status.
     */
    async getConfigurationHealth(): Promise<ConfigurationHealth> {
        const result = await this.validateConfiguration();

        const criticalIssues = result.errors.filter(e => e.severity === 'error').length;
        const warnings = result.warnings.length + result.errors.filter(e => e.severity === 'warning').length;
        const suggestions = result.suggestions.length + result.errors.filter(e => e.severity === 'info').length;

        let overall: 'healthy' | 'warning' | 'critical';
        if (criticalIssues > 0) {
            overall = 'critical';
        } else if (warnings > 0) {
            overall = 'warning';
        } else {
            overall = 'healthy';
        }

        return {
            overall,
            lastCheck: new Date().toISOString(),
            issues: [...result.errors, ...result.warnings, ...result.suggestions],
            summary: {
                criticalIssues,
                warnings,
                suggestions
            }
        };
    }

    /**
     * Attempt to automatically fix configuration issues.
     */
    async autoFixIssues(issueTypes?: string[]): Promise<{
        fixed: number;
        failed: number;
        details: Array<{ issue: string; success: boolean; error?: string }>;
    }> {
        const result = await this.validateConfiguration();
        const allIssues = [...result.errors, ...result.warnings];

        let fixed = 0;
        let failed = 0;
        const details: Array<{ issue: string; success: boolean; error?: string }> = [];

        for (const issue of allIssues) {
            // Skip if specific issue types are requested and this isn't one of them
            if (issueTypes && !issueTypes.includes(issue.code || issue.field)) {
                continue;
            }

            // Find rule that can auto-fix this issue
            const rule = this.validationRules.find(r =>
                r.name === issue.code && r.autoFix
            );

            if (rule && rule.autoFix) {
                try {
                    const config = vscode.workspace.getConfiguration('specforged');
                    const success = await rule.autoFix(config);

                    if (success) {
                        fixed++;
                        details.push({ issue: issue.message, success: true });
                    } else {
                        failed++;
                        details.push({ issue: issue.message, success: false, error: 'Fix returned false' });
                    }
                } catch (error) {
                    failed++;
                    details.push({
                        issue: issue.message,
                        success: false,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
        }

        // Clear cache after fixes
        this.clearCache();

        return { fixed, failed, details };
    }

    /**
     * Register a custom validation rule.
     */
    registerRule(rule: ValidationRule): void {
        this.validationRules.push(rule);
        this.clearCache(); // Clear cache when rules change
    }

    /**
     * Get all validation rules.
     */
    getValidationRules(): ValidationRule[] {
        return [...this.validationRules];
    }

    /**
     * Export configuration diagnostics for troubleshooting.
     */
    async exportDiagnostics(): Promise<{
        timestamp: string;
        version: string;
        environment: Record<string, any>;
        configuration: Record<string, any>;
        validationResult: ValidationResult;
        health: ConfigurationHealth;
    }> {
        const config = vscode.workspace.getConfiguration('specforged');
        const validationResult = await this.validateConfiguration();
        const health = await this.getConfigurationHealth();

        // Sanitize configuration (remove sensitive data)
        const sanitizedConfig: Record<string, any> = {};
        const configKeys = ['smitheryApiKey', 'githubToken', 'apiKey', 'password', 'secret', 'autoDetect', 'specFolder', 'enableDashboard'];

        for (const key of configKeys) {
            const value = config.get(key);
            if (value !== undefined) {
                if (key.toLowerCase().includes('password') ||
                    key.toLowerCase().includes('token') ||
                    key.toLowerCase().includes('key') ||
                    key.toLowerCase().includes('secret')) {
                    sanitizedConfig[key] = '***REDACTED***';
                } else {
                    sanitizedConfig[key] = value;
                }
            }
        }

        return {
            timestamp: new Date().toISOString(),
            version: vscode.extensions.getExtension('specforged.vscode-specforged')?.packageJSON.version || 'unknown',
            environment: {
                vscodeVersion: vscode.version,
                platform: process.platform,
                nodeVersion: process.version,
                workspaceCount: vscode.workspace.workspaceFolders?.length || 0
            },
            configuration: sanitizedConfig,
            validationResult,
            health
        };
    }

    /**
     * Run validation using all registered rules.
     */
    private async runValidation(config: vscode.WorkspaceConfiguration): Promise<ValidationResult> {
        const errors: ValidationError[] = [];
        const warnings: ValidationError[] = [];
        const suggestions: ValidationError[] = [];

        // Run all validation rules
        for (const rule of this.validationRules) {
            try {
                const ruleErrors = rule.validate(config);

                for (const error of ruleErrors) {
                    switch (error.severity) {
                        case 'error':
                            errors.push(error);
                            break;
                        case 'warning':
                            warnings.push(error);
                            break;
                        case 'info':
                            suggestions.push(error);
                            break;
                    }
                }
            } catch (error) {
                errors.push({
                    field: 'validation',
                    message: `Validation rule '${rule.name}' failed: ${error}`,
                    severity: 'error',
                    code: 'validation_rule_error'
                });
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            suggestions
        };
    }

    /**
     * Show validation notifications to user.
     */
    private showValidationNotifications(result: ValidationResult): void {
        const criticalErrors = result.errors.filter(e => e.severity === 'error');

        if (criticalErrors.length > 0) {
            const message = `Configuration has ${criticalErrors.length} critical issue${criticalErrors.length > 1 ? 's' : ''}`;
            vscode.window.showErrorMessage(message, 'View Issues', 'Auto Fix').then(action => {
                if (action === 'View Issues') {
                    this.showConfigurationDashboard();
                } else if (action === 'Auto Fix') {
                    this.autoFixIssues().then(fixResult => {
                        vscode.window.showInformationMessage(
                            `Fixed ${fixResult.fixed} issue${fixResult.fixed !== 1 ? 's' : ''}, ${fixResult.failed} failed`
                        );
                    });
                }
            });
        } else if (result.warnings.length > 0) {
            const message = `Configuration has ${result.warnings.length} warning${result.warnings.length > 1 ? 's' : ''}`;
            vscode.window.showWarningMessage(message, 'View Issues').then(action => {
                if (action === 'View Issues') {
                    this.showConfigurationDashboard();
                }
            });
        }
    }

    /**
     * Show configuration issues in a dashboard.
     */
    private async showConfigurationDashboard(): Promise<void> {
        const result = await this.validateConfiguration();
        const health = await this.getConfigurationHealth();

        const panel = vscode.window.createWebviewPanel(
            'specforged.configDashboard',
            'SpecForged Configuration Issues',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = this.generateDashboardHTML(result, health);

        // Handle messages from webview
        panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'autoFix':
                    const fixResult = await this.autoFixIssues(message.issues);
                    panel.webview.postMessage({
                        command: 'fixResult',
                        result: fixResult
                    });
                    break;

                case 'openSettings':
                    vscode.commands.executeCommand('workbench.action.openSettings', '@ext:specforged.vscode-specforged');
                    break;

                case 'exportDiagnostics':
                    const diagnostics = await this.exportDiagnostics();
                    const uri = await vscode.window.showSaveDialog({
                        defaultUri: vscode.Uri.file('specforged-diagnostics.json'),
                        filters: { 'JSON Files': ['json'] }
                    });

                    if (uri) {
                        await vscode.workspace.fs.writeFile(
                            uri,
                            Buffer.from(JSON.stringify(diagnostics, null, 2), 'utf8')
                        );
                        vscode.window.showInformationMessage('Diagnostics exported successfully');
                    }
                    break;
            }
        });
    }

    /**
     * Generate HTML for configuration dashboard.
     */
    private generateDashboardHTML(result: ValidationResult, health: ConfigurationHealth): string {
        const criticalIssues = result.errors.filter(e => e.severity === 'error');
        const warnings = result.warnings.concat(result.errors.filter(e => e.severity === 'warning'));
        const suggestions = result.suggestions.concat(result.errors.filter(e => e.severity === 'info'));

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Configuration Issues</title>
    <style>
        body { font-family: var(--vscode-font-family); padding: 20px; }
        .health-status { padding: 15px; border-radius: 5px; margin-bottom: 20px; }
        .health-healthy { background: var(--vscode-terminal-ansiGreen); color: white; }
        .health-warning { background: var(--vscode-editorWarning-background); color: var(--vscode-editorWarning-foreground); }
        .health-critical { background: var(--vscode-editorError-background); color: var(--vscode-editorError-foreground); }
        .issue-section { margin-bottom: 30px; }
        .issue-item {
            padding: 10px;
            margin: 10px 0;
            border-left: 4px solid;
            background: var(--vscode-editor-background);
        }
        .issue-error { border-left-color: var(--vscode-editorError-foreground); }
        .issue-warning { border-left-color: var(--vscode-editorWarning-foreground); }
        .issue-info { border-left-color: var(--vscode-editorInfo-foreground); }
        .issue-field { font-weight: bold; color: var(--vscode-textLink-foreground); }
        .issue-message { margin: 5px 0; }
        .issue-fix {
            margin-top: 10px;
            padding: 8px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
        }
        .actions { margin-top: 20px; }
        .btn {
            margin-right: 10px;
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
        }
        .summary { display: flex; gap: 20px; margin-bottom: 20px; }
        .summary-item {
            padding: 10px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 5px;
            text-align: center;
        }
    </style>
</head>
<body>
    <h1>SpecForged Configuration Health</h1>

    <div class="health-status health-${health.overall}">
        <h2>Overall Status: ${health.overall.toUpperCase()}</h2>
        <p>Last checked: ${new Date(health.lastCheck).toLocaleString()}</p>
    </div>

    <div class="summary">
        <div class="summary-item">
            <h3>${health.summary.criticalIssues}</h3>
            <p>Critical Issues</p>
        </div>
        <div class="summary-item">
            <h3>${health.summary.warnings}</h3>
            <p>Warnings</p>
        </div>
        <div class="summary-item">
            <h3>${health.summary.suggestions}</h3>
            <p>Suggestions</p>
        </div>
    </div>

    ${criticalIssues.length > 0 ? `
    <div class="issue-section">
        <h2>Critical Issues (${criticalIssues.length})</h2>
        ${criticalIssues.map(issue => `
            <div class="issue-item issue-error">
                <div class="issue-field">${issue.field}</div>
                <div class="issue-message">${issue.message}</div>
                ${issue.suggestedFix ? `<div><small>Suggestion: ${issue.suggestedFix}</small></div>` : ''}
                ${issue.code ? `<button class="issue-fix" onclick="fixIssue('${issue.code}')">Auto Fix</button>` : ''}
            </div>
        `).join('')}
    </div>
    ` : ''}

    ${warnings.length > 0 ? `
    <div class="issue-section">
        <h2>Warnings (${warnings.length})</h2>
        ${warnings.map(issue => `
            <div class="issue-item issue-warning">
                <div class="issue-field">${issue.field}</div>
                <div class="issue-message">${issue.message}</div>
                ${issue.suggestedFix ? `<div><small>Suggestion: ${issue.suggestedFix}</small></div>` : ''}
                ${issue.code ? `<button class="issue-fix" onclick="fixIssue('${issue.code}')">Auto Fix</button>` : ''}
            </div>
        `).join('')}
    </div>
    ` : ''}

    ${suggestions.length > 0 ? `
    <div class="issue-section">
        <h2>Suggestions (${suggestions.length})</h2>
        ${suggestions.map(issue => `
            <div class="issue-item issue-info">
                <div class="issue-field">${issue.field}</div>
                <div class="issue-message">${issue.message}</div>
                ${issue.suggestedFix ? `<div><small>Suggestion: ${issue.suggestedFix}</small></div>` : ''}
            </div>
        `).join('')}
    </div>
    ` : ''}

    <div class="actions">
        <button class="btn" onclick="autoFixAll()">Auto Fix All</button>
        <button class="btn" onclick="openSettings()">Open Settings</button>
        <button class="btn" onclick="exportDiagnostics()">Export Diagnostics</button>
        <button class="btn" onclick="refresh()">Refresh</button>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function fixIssue(issueCode) {
            vscode.postMessage({ command: 'autoFix', issues: [issueCode] });
        }

        function autoFixAll() {
            vscode.postMessage({ command: 'autoFix' });
        }

        function openSettings() {
            vscode.postMessage({ command: 'openSettings' });
        }

        function exportDiagnostics() {
            vscode.postMessage({ command: 'exportDiagnostics' });
        }

        function refresh() {
            location.reload();
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'fixResult':
                    alert(\`Fixed \${message.result.fixed} issues, \${message.result.failed} failed\`);
                    refresh();
                    break;
            }
        });
    </script>
</body>
</html>`;
    }

    /**
     * Start periodic validation checks.
     */
    private startPeriodicValidation(): void {
        const interval = 10 * 60 * 1000; // 10 minutes

        setInterval(async () => {
            try {
                const result = await this.validateConfiguration();

                // Only show notifications for critical issues during periodic checks
                if (result.errors.some(e => e.severity === 'error')) {
                    this.showValidationNotifications(result);
                }
            } catch (error) {
                console.error('Periodic validation failed:', error);
            }
        }, interval);
    }

    /**
     * Register default validation rules.
     */
    private registerDefaultRules(): void {
        // Memory limit validation
        this.registerRule({
            name: 'memory_limit_validation',
            description: 'Validate memory configuration settings',
            category: 'performance',
            validate: (config) => {
                const errors: ValidationError[] = [];

                const memoryLimit = config.get<number>('performance.memoryLimitMb', 100);
                const warningThreshold = config.get<number>('performance.memoryWarningThresholdMb', 80);

                if (memoryLimit <= 0) {
                    errors.push({
                        field: 'performance.memoryLimitMb',
                        message: 'Memory limit must be greater than 0',
                        severity: 'error',
                        suggestedFix: 'Set to at least 50MB',
                        code: 'memory_limit_validation'
                    });
                }

                if (warningThreshold >= memoryLimit) {
                    errors.push({
                        field: 'performance.memoryWarningThresholdMb',
                        message: 'Warning threshold must be less than memory limit',
                        severity: 'error',
                        suggestedFix: `Set to less than ${memoryLimit}MB`,
                        code: 'memory_threshold_validation'
                    });
                }

                if (memoryLimit < 50) {
                    errors.push({
                        field: 'performance.memoryLimitMb',
                        message: 'Memory limit is very low and may cause performance issues',
                        severity: 'warning',
                        suggestedFix: 'Consider setting to at least 100MB'
                    });
                }

                return errors;
            },
            autoFix: async (config) => {
                const memoryLimit = config.get<number>('performance.memoryLimitMb', 100);
                const warningThreshold = config.get<number>('performance.memoryWarningThresholdMb', 80);

                if (memoryLimit <= 0) {
                    await config.update('performance.memoryLimitMb', 100, vscode.ConfigurationTarget.Global);
                }

                if (warningThreshold >= memoryLimit) {
                    await config.update('performance.memoryWarningThresholdMb', Math.floor(memoryLimit * 0.8), vscode.ConfigurationTarget.Global);
                }

                return true;
            }
        });

        // Queue configuration validation
        this.registerRule({
            name: 'queue_validation',
            description: 'Validate operation queue settings',
            category: 'performance',
            validate: (config) => {
                const errors: ValidationError[] = [];

                const maxSize = config.get<number>('queue.maxSize', 10000);
                const batchSize = config.get<number>('queue.maxBatchSize', 50);
                const processingInterval = config.get<number>('queue.processingIntervalMs', 2000);

                if (maxSize <= 0) {
                    errors.push({
                        field: 'queue.maxSize',
                        message: 'Queue max size must be greater than 0',
                        severity: 'error',
                        code: 'queue_size_validation'
                    });
                }

                if (batchSize <= 0 || batchSize > maxSize) {
                    errors.push({
                        field: 'queue.maxBatchSize',
                        message: 'Batch size must be between 1 and queue max size',
                        severity: 'error',
                        code: 'batch_size_validation'
                    });
                }

                if (processingInterval < 100) {
                    errors.push({
                        field: 'queue.processingIntervalMs',
                        message: 'Processing interval too low, may cause high CPU usage',
                        severity: 'warning',
                        suggestedFix: 'Set to at least 1000ms'
                    });
                }

                return errors;
            }
        });

        // Server connection validation
        this.registerRule({
            name: 'server_connection_validation',
            description: 'Validate MCP server connection settings',
            category: 'connection',
            validate: (config) => {
                const errors: ValidationError[] = [];

                const serverType = config.get<string>('mcpServerType', 'local');
                const serverUrl = config.get<string>('mcpServerUrl', '');
                const connectionTimeout = config.get<number>('connectionTimeout', 10000);
                const retryAttempts = config.get<number>('retryAttempts', 3);

                if (serverType === 'custom' && !serverUrl) {
                    errors.push({
                        field: 'mcpServerUrl',
                        message: 'Custom server URL is required when server type is "custom"',
                        severity: 'error',
                        suggestedFix: 'Provide a valid HTTP/HTTPS URL'
                    });
                }

                if (serverUrl && !serverUrl.match(/^https?:\/\/.+/)) {
                    errors.push({
                        field: 'mcpServerUrl',
                        message: 'Server URL must be a valid HTTP/HTTPS URL',
                        severity: 'error'
                    });
                }

                if (connectionTimeout < 1000) {
                    errors.push({
                        field: 'connectionTimeout',
                        message: 'Connection timeout is too low',
                        severity: 'warning',
                        suggestedFix: 'Set to at least 5000ms'
                    });
                }

                if (retryAttempts < 1 || retryAttempts > 10) {
                    errors.push({
                        field: 'retryAttempts',
                        message: 'Retry attempts should be between 1 and 10',
                        severity: 'warning'
                    });
                }

                return errors;
            }
        });

        // Security settings validation
        this.registerRule({
            name: 'security_validation',
            description: 'Validate security configuration',
            category: 'security',
            validate: (config) => {
                const errors: ValidationError[] = [];
                const environment = config.get<string>('environment', 'production');

                if (environment === 'production') {
                    const debugMode = config.get<boolean>('debugMode', false);
                    const enableTelemetry = config.get<boolean>('enableTelemetry', false);
                    const logLevel = config.get<string>('logLevel', 'info');

                    if (debugMode) {
                        errors.push({
                            field: 'debugMode',
                            message: 'Debug mode should be disabled in production',
                            severity: 'warning',
                            code: 'production_debug_mode'
                        });
                    }

                    if (logLevel === 'debug' || logLevel === 'trace') {
                        errors.push({
                            field: 'logLevel',
                            message: 'Debug/trace logging should be avoided in production',
                            severity: 'warning'
                        });
                    }
                }

                const enableStrictValidation = config.get<boolean>('security.enableStrictValidation', true);
                const enableRateLimiting = config.get<boolean>('security.enableRateLimiting', true);

                if (!enableStrictValidation) {
                    errors.push({
                        field: 'security.enableStrictValidation',
                        message: 'Strict validation should be enabled for security',
                        severity: 'info',
                        suggestedFix: 'Enable strict input validation'
                    });
                }

                if (!enableRateLimiting) {
                    errors.push({
                        field: 'security.enableRateLimiting',
                        message: 'Rate limiting should be enabled to prevent abuse',
                        severity: 'info',
                        suggestedFix: 'Enable rate limiting'
                    });
                }

                return errors;
            },
            autoFix: async (config) => {
                const environment = config.get<string>('environment', 'production');

                if (environment === 'production') {
                    await config.update('debugMode', false, vscode.ConfigurationTarget.Global);

                    const logLevel = config.get<string>('logLevel', 'info');
                    if (logLevel === 'debug' || logLevel === 'trace') {
                        await config.update('logLevel', 'info', vscode.ConfigurationTarget.Global);
                    }
                }

                return true;
            }
        });
    }

    /**
     * Check if validation cache is still valid.
     */
    private isCacheValid(): boolean {
        return Date.now() - this.lastValidation < this.cacheTimeout;
    }

    /**
     * Clear validation cache.
     */
    private clearCache(): void {
        this.validationCache.clear();
        this.lastValidation = 0;
    }
}

/**
 * Global configuration validation service instance
 */
let validationService: ConfigurationValidationService | null = null;

/**
 * Get the configuration validation service instance
 */
export function getConfigurationValidationService(
    context: vscode.ExtensionContext,
    featureFlagService: FeatureFlagService
): ConfigurationValidationService {
    if (!validationService) {
        validationService = new ConfigurationValidationService(context, featureFlagService);
    }
    return validationService;
}
