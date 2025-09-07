import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { promisify } from 'util';
import { exec } from 'child_process';
import { McpSyncService } from '../services/mcpSyncService';
import { McpOperationFactory, McpOperationType, McpSyncState } from '../models/mcpOperation';

const execAsync = promisify(exec);

export interface McpServerConfig {
    command: string;
    args: string[];
    env: Record<string, string>;
}

export interface HttpMcpServerConfig {
    url: string;
    apiKey?: string;
    timeout: number;
}

export type McpServerType = 'local' | 'smithery' | 'custom';

export interface McpConnectionConfig {
    type: McpServerType;
    local?: McpServerConfig;
    http?: HttpMcpServerConfig;
}

export interface IdeConfig {
    name: string;
    configPath: string;
    configFormat: 'json' | 'yaml';
    detected: boolean;
    installed: boolean;
}

export class McpManager {
    private mcpSyncService: McpSyncService | undefined;
    private syncStatusWatcher: vscode.FileSystemWatcher | undefined;
    private serverHealthCheck: NodeJS.Timeout | undefined;
    private currentConnection: McpConnectionConfig | undefined;
    private httpClient: any; // Will store HTTP client for API calls

    private readonly supportedIdes: Record<string, IdeConfig> = {
        cursor: {
            name: 'Cursor',
            configPath: '.cursor/mcp.json',
            configFormat: 'json',
            detected: false,
            installed: false
        },
        windsurf: {
            name: 'Windsurf',
            configPath: '~/.codeium/windsurf/mcp_config.json',
            configFormat: 'json',
            detected: false,
            installed: false
        },
        claude: {
            name: 'Claude Desktop',
            configPath: this.getClaudeConfigPath(),
            configFormat: 'json',
            detected: false,
            installed: false
        },
        vscode: {
            name: 'VS Code (Continue/Codeium)',
            configPath: '.vscode/mcp.json',
            configFormat: 'json',
            detected: false,
            installed: false
        }
    };

    constructor() {
        this.detectInstalledIdes();
    }

    setSyncService(syncService: McpSyncService): void {
        this.mcpSyncService = syncService;
        this.setupSyncIntegration();
    }

    private getServerConfig(): McpConnectionConfig {
        const config = vscode.workspace.getConfiguration('specforged');
        const serverType = config.get<McpServerType>('mcpServerType', 'local');

        switch (serverType) {
            case 'smithery':
                const smitheryServerName = config.get<string>('smitheryServerName', 'specforged');
                const smitheryApiKey = config.get<string>('smitheryApiKey', '');
                const timeout = config.get<number>('connectionTimeout', 10000);

                return {
                    type: 'smithery',
                    http: {
                        url: `https://server.smithery.ai/${smitheryServerName}/mcp`,
                        apiKey: smitheryApiKey || undefined,
                        timeout
                    }
                };

            case 'custom':
                const customUrl = config.get<string>('mcpServerUrl', '');
                const customApiKey = config.get<string>('smitheryApiKey', '');
                const customTimeout = config.get<number>('connectionTimeout', 10000);

                return {
                    type: 'custom',
                    http: {
                        url: customUrl,
                        apiKey: customApiKey || undefined,
                        timeout: customTimeout
                    }
                };

            case 'local':
            default:
                const serverPath = config.get<string>('mcpServerPath', 'specforged');
                return {
                    type: 'local',
                    local: {
                        command: serverPath,
                        args: [],
                        env: {}
                    }
                };
        }
    }

    async testHttpConnection(config: HttpMcpServerConfig): Promise<{ success: boolean; message: string }> {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.timeout);

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            };

            if (config.apiKey) {
                headers['Authorization'] = `Bearer ${config.apiKey}`;
            }

            const response = await fetch(`${config.url}/health`, {
                method: 'GET',
                headers,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (response.ok) {
                return {
                    success: true,
                    message: 'Successfully connected to HTTP MCP server'
                };
            } else {
                return {
                    success: false,
                    message: `HTTP server responded with status: ${response.status}`
                };
            }
        } catch (error: any) {
            if (error.name === 'AbortError') {
                return {
                    success: false,
                    message: `Connection timeout after ${config.timeout}ms`
                };
            }

            return {
                success: false,
                message: `Connection failed: ${error.message}`
            };
        }
    }

    async initializeConnection(): Promise<{ success: boolean; message: string; config: McpConnectionConfig }> {
        const config = this.getServerConfig();
        this.currentConnection = config;

        if (config.type === 'local') {
            // Test local installation
            const isInstalled = await this.isSpecForgedInstalled();
            if (!isInstalled) {
                const autoFallback = vscode.workspace.getConfiguration('specforged').get<boolean>('autoFallbackToLocal', true);
                if (!autoFallback) {
                    return {
                        success: false,
                        message: 'SpecForged not installed locally. Use "pipx install specforged" or enable auto-fallback.',
                        config
                    };
                }

                // Try to fallback to Smithery
                const smitheryConfig = {
                    type: 'smithery' as McpServerType,
                    http: {
                        url: 'https://server.smithery.ai/specforged/mcp',
                        timeout: 10000
                    }
                };

                const smitheryTest = await this.testHttpConnection(smitheryConfig.http);
                if (smitheryTest.success) {
                    this.currentConnection = smitheryConfig;
                    return {
                        success: true,
                        message: 'Local server not available, using Smithery fallback',
                        config: smitheryConfig
                    };
                }
            }

            return {
                success: isInstalled,
                message: isInstalled ? 'Local SpecForged server ready' : 'SpecForged not installed',
                config
            };
        }

        // HTTP server (Smithery or custom)
        if (!config.http) {
            return {
                success: false,
                message: 'HTTP server configuration missing',
                config
            };
        }

        const testResult = await this.testHttpConnection(config.http);
        return {
            success: testResult.success,
            message: testResult.message,
            config
        };
    }

    getCurrentConnection(): McpConnectionConfig | undefined {
        return this.currentConnection;
    }

    isHttpMode(): boolean {
        return this.currentConnection?.type !== 'local';
    }

    private getClaudeConfigPath(): string {
        const platform = process.platform;
        switch (platform) {
            case 'darwin':
                return '~/Library/Application Support/Claude/claude_desktop_config.json';
            case 'win32':
                return '%APPDATA%\\Claude\\claude_desktop_config.json';
            default:
                return '~/.config/Claude/claude_desktop_config.json';
        }
    }

    async detectInstalledIdes(): Promise<void> {
        // Check for Cursor
        try {
            await execAsync('cursor --version');
            this.supportedIdes.cursor.installed = true;
        } catch {
            this.supportedIdes.cursor.installed = false;
        }

        // Check for Windsurf
        try {
            await execAsync('windsurf --version');
            this.supportedIdes.windsurf.installed = true;
        } catch {
            this.supportedIdes.windsurf.installed = false;
        }

        // Check for Claude Desktop (check config path exists)
        const claudeConfigPath = this.expandPath(this.supportedIdes.claude.configPath);
        this.supportedIdes.claude.installed = fs.existsSync(path.dirname(claudeConfigPath));

        // VS Code is always available since we're running in it
        this.supportedIdes.vscode.installed = true;
    }

    async isSpecForgedInstalled(): Promise<boolean> {
        try {
            const { stdout } = await execAsync('specforged --version');
            return stdout.trim().length > 0;
        } catch {
            return false;
        }
    }

    async installSpecForged(): Promise<{ success: boolean; message: string }> {
        try {
            const { stdout, stderr } = await execAsync('pipx install specforged', { timeout: 60000 });

            if (stderr && stderr.includes('error')) {
                return {
                    success: false,
                    message: `Installation failed: ${stderr}`
                };
            }

            return {
                success: true,
                message: 'SpecForged installed successfully!'
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Installation failed: ${error.message}`
            };
        }
    }

    async detectExistingConfigs(): Promise<void> {
        const workspaceFolder = this.getWorkspaceFolder();
        if (!workspaceFolder) {
            return;
        }

        for (const [ideKey, ideConfig] of Object.entries(this.supportedIdes)) {
            const configPath = this.resolveConfigPath(ideConfig.configPath, workspaceFolder);
            ideConfig.detected = fs.existsSync(configPath);
        }
    }

    async setupMcpForIde(ideKey: string, projectPath?: string): Promise<{ success: boolean; message: string }> {
        const ide = this.supportedIdes[ideKey];
        if (!ide) {
            return { success: false, message: `Unsupported IDE: ${ideKey}` };
        }

        if (!ide.installed) {
            return { success: false, message: `${ide.name} is not installed` };
        }

        try {
            const config = this.generateMcpConfig(ideKey, projectPath);
            const configPath = this.resolveConfigPath(ide.configPath, this.getWorkspaceFolder());

            await this.writeMcpConfig(configPath, config);
            ide.detected = true;

            return {
                success: true,
                message: `MCP server configured for ${ide.name}! Configuration written to ${configPath}`
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to configure ${ide.name}: ${error.message}`
            };
        }
    }

    private generateMcpConfig(ideKey: string, projectPath?: string): any {
        const workspacePath = projectPath || this.getWorkspaceFolder()?.uri.fsPath;

        const baseConfig: McpServerConfig = {
            command: 'specforged',
            args: [],
            env: {}
        };

        // Add project-specific environment variables for IDEs that need them
        if (['cursor', 'windsurf'].includes(ideKey) && workspacePath) {
            baseConfig.env['SPECFORGE_PROJECT_ROOT'] = workspacePath;
            baseConfig.env['SPECFORGE_BASE_DIR'] = '.specifications';
        }

        switch (ideKey) {
            case 'cursor':
                return {
                    mcpServers: {
                        specforged: baseConfig
                    }
                };
            case 'windsurf':
                return {
                    mcpServers: {
                        specforged: baseConfig
                    }
                };
            case 'claude':
                return {
                    mcpServers: {
                        specforged: baseConfig
                    }
                };
            case 'vscode':
                return {
                    mcpServers: {
                        specforged: baseConfig
                    }
                };
            default:
                return { mcpServers: { specforged: baseConfig } };
        }
    }

    private async writeMcpConfig(configPath: string, config: any): Promise<void> {
        const dir = path.dirname(configPath);

        // Create directory if it doesn't exist
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        // Handle existing configuration
        let existingConfig = {};
        if (fs.existsSync(configPath)) {
            try {
                const existingContent = fs.readFileSync(configPath, 'utf8');
                existingConfig = JSON.parse(existingContent);
            } catch {
                // File exists but is invalid JSON, we'll overwrite
            }
        }

        // Merge configurations
        const mergedConfig = {
            ...existingConfig,
            mcpServers: {
                ...(existingConfig as any).mcpServers,
                ...config.mcpServers
            }
        };

        fs.writeFileSync(configPath, JSON.stringify(mergedConfig, null, 2));
    }

    private resolveConfigPath(configPath: string, workspaceFolder?: vscode.WorkspaceFolder): string {
        const expandedPath = this.expandPath(configPath);

        if (path.isAbsolute(expandedPath)) {
            return expandedPath;
        }

        if (workspaceFolder) {
            return path.join(workspaceFolder.uri.fsPath, expandedPath);
        }

        return expandedPath;
    }

    private expandPath(filePath: string): string {
        if (filePath.startsWith('~')) {
            const homeDir = process.env.HOME || process.env.USERPROFILE || '';
            return path.join(homeDir, filePath.slice(1));
        }

        if (filePath.includes('%APPDATA%')) {
            const appData = process.env.APPDATA || '';
            return filePath.replace('%APPDATA%', appData);
        }

        return filePath;
    }

    getAvailableIdes(): IdeConfig[] {
        return Object.values(this.supportedIdes);
    }

    getInstalledIdes(): IdeConfig[] {
        return Object.values(this.supportedIdes).filter(ide => ide.installed);
    }

    getConfiguredIdes(): IdeConfig[] {
        return Object.values(this.supportedIdes).filter(ide => ide.detected);
    }

    private getWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
        return vscode.workspace.workspaceFolders?.[0];
    }

    async createProjectMcpConfig(): Promise<{ success: boolean; message: string; path?: string }> {
        const workspaceFolder = this.getWorkspaceFolder();
        if (!workspaceFolder) {
            return { success: false, message: 'No workspace folder found' };
        }

        const configPath = path.join(workspaceFolder.uri.fsPath, '.mcp.json');
        const config = {
            mcpServers: {
                specforged: {
                    command: 'specforged',
                    args: [],
                    env: {}
                }
            }
        };

        try {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            return {
                success: true,
                message: 'Project MCP configuration created',
                path: configPath
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to create project config: ${error.message}`
            };
        }
    }

    private setupSyncIntegration(): void {
        if (!this.mcpSyncService) {
            return;
        }

        // Watch for sync state changes
        this.setupSyncWatcher();

        // Start server health monitoring
        this.startServerHealthCheck();

        console.log('MCP sync integration setup complete');
    }

    private setupSyncWatcher(): void {
        const workspaceFolder = this.getWorkspaceFolder();
        if (!workspaceFolder) {
            return;
        }

        const syncStatePattern = new vscode.RelativePattern(workspaceFolder, '.vscode/specforge-sync.json');
        this.syncStatusWatcher = vscode.workspace.createFileSystemWatcher(syncStatePattern);

        this.syncStatusWatcher.onDidChange(async () => {
            console.log('Sync state changed, updating MCP server detection');
            await this.detectMcpServerStatus();
        });
    }

    private startServerHealthCheck(): void {
        // Check MCP server health every 60 seconds
        this.serverHealthCheck = setInterval(async () => {
            await this.detectMcpServerStatus();
        }, 60000);

        // Initial check
        this.detectMcpServerStatus();
    }

    private async detectMcpServerStatus(): Promise<void> {
        try {
            const isInstalled = await this.isSpecForgedInstalled();
            const syncState = this.mcpSyncService?.getSyncState();

            if (syncState) {
                // Update sync state based on server availability
                const lastSyncAge = syncState.lastSync ?
                    Date.now() - new Date(syncState.lastSync).getTime() :
                    Number.MAX_SAFE_INTEGER;

                // Consider server online if last sync was within 2 minutes
                const serverOnline = isInstalled && (lastSyncAge < 120000);

                // Notify sync service if server status changed
                if (syncState.mcpServerOnline !== serverOnline) {
                    console.log(`MCP server status changed: ${serverOnline ? 'online' : 'offline'}`);
                }
            }
        } catch (error) {
            console.error('Failed to detect MCP server status:', error);
        }
    }

    async notifySpecificationChange(specId: string, changeType: string): Promise<void> {
        if (this.mcpSyncService) {
            await this.mcpSyncService.notifySpecificationChange(specId, changeType);
        }
    }

    async requestMcpOperation(type: McpOperationType, params: any): Promise<void> {
        if (!this.mcpSyncService) {
            throw new Error('MCP sync service not initialized');
        }

        const operation = McpOperationFactory.createOperation(type, params, 1, 'extension');
        await this.mcpSyncService.queueOperation(operation);
    }

    getMcpServerStatus(): {
        installed: boolean;
        online: boolean;
        syncState?: McpSyncState;
        configuredIdes: IdeConfig[];
    } {
        return {
            installed: false, // This would be updated by the health check
            online: this.mcpSyncService?.getSyncState().mcpServerOnline || false,
            syncState: this.mcpSyncService?.getSyncState(),
            configuredIdes: this.getConfiguredIdes()
        };
    }

    async generateMcpIntegrationGuide(): Promise<string> {
        const installedIdes = this.getInstalledIdes();
        const configuredIdes = this.getConfiguredIdes();
        const workspaceFolder = this.getWorkspaceFolder();
        const isSpecForgedInstalled = await this.isSpecForgedInstalled();

        let guide = `# SpecForged MCP Integration Guide\n\n`;

        guide += `## Current Status\n`;
        guide += `- **SpecForged Server**: ${isSpecForgedInstalled ? '✅ Installed' : '❌ Not Installed'}\n`;
        guide += `- **Workspace**: ${workspaceFolder ? '✅ Found' : '❌ No workspace'}\n`;
        guide += `- **Installed IDEs**: ${installedIdes.length}/${Object.keys(this.supportedIdes).length}\n`;
        guide += `- **Configured IDEs**: ${configuredIdes.length}/${installedIdes.length}\n\n`;

        if (!isSpecForgedInstalled) {
            guide += `## 🚨 Installation Required\n`;
            guide += `SpecForged MCP server is not installed. Run:\n`;
            guide += `\`\`\`bash\npipx install specforged\n\`\`\`\n\n`;
        }

        guide += `## IDE Configuration Status\n\n`;
        for (const ide of Object.values(this.supportedIdes)) {
            const installed = ide.installed ? '✅' : '❌';
            const configured = ide.detected ? '⚙️' : '⭕';
            guide += `- ${installed} ${configured} **${ide.name}**\n`;

            if (ide.installed && !ide.detected) {
                guide += `  - *Needs configuration*\n`;
            }
        }

        guide += `\n## Next Steps\n\n`;
        if (!isSpecForgedInstalled) {
            guide += `1. Install SpecForged: \`pipx install specforged\`\n`;
        }

        const unconfiguredIdes = installedIdes.filter(ide => !ide.detected);
        if (unconfiguredIdes.length > 0) {
            guide += `2. Configure MCP for ${unconfiguredIdes.length} IDE${unconfiguredIdes.length === 1 ? '' : 's'}:\n`;
            for (const ide of unconfiguredIdes) {
                guide += `   - Run "SpecForged: Setup MCP Server" and select ${ide.name}\n`;
            }
        }

        if (workspaceFolder) {
            guide += `3. Create your first specification:\n`;
            guide += `   - Run "SpecForged: Create Specification"\n`;
            guide += `   - Or use MCP server: "Use specforged to create a new spec"\n`;
        }

        guide += `\n## Sync Configuration Files\n\n`;
        if (workspaceFolder) {
            guide += `The extension creates these files in your workspace for MCP integration:\n\n`;
            guide += `- \`.vscode/mcp-operations.json\` - Operation queue for MCP server\n`;
            guide += `- \`.vscode/specforge-sync.json\` - Sync state between extension and MCP\n`;
            guide += `- \`.vscode/mcp-results.json\` - Operation results history\n\n`;
            guide += `These files enable bidirectional communication between the VS Code extension\n`;
            guide += `and MCP server, solving permission issues by letting the extension handle\n`;
            guide += `all file operations while keeping both systems synchronized.\n`;
        }

        return guide;
    }

    async writeProjectMcpConfig(): Promise<{ success: boolean; message: string; configPath?: string }> {
        const workspaceFolder = this.getWorkspaceFolder();
        if (!workspaceFolder) {
            return { success: false, message: 'No workspace folder found' };
        }

        // Create enhanced MCP config with sync integration
        const config = {
            mcpServers: {
                specforged: {
                    command: 'specforged',
                    args: [],
                    env: {
                        SPECFORGE_PROJECT_ROOT: workspaceFolder.uri.fsPath,
                        SPECFORGE_BASE_DIR: '.specifications',
                        SPECFORGE_SYNC_MODE: 'vscode-extension'
                    }
                }
            },
            specforgedExtension: {
                syncEnabled: true,
                operationQueuePath: '.vscode/mcp-operations.json',
                syncStatePath: '.vscode/specforge-sync.json',
                resultsPath: '.vscode/mcp-results.json',
                fileOperationsMode: 'extension-handles-all'
            }
        };

        const configPath = path.join(workspaceFolder.uri.fsPath, '.mcp.json');

        try {
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
            return {
                success: true,
                message: 'Enhanced MCP configuration created with sync integration',
                configPath
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to create config: ${error.message}`
            };
        }
    }

    async callHttpMcp(method: string, params: any = {}): Promise<{ success: boolean; result?: any; error?: string }> {
        if (!this.isHttpMode() || !this.currentConnection?.http) {
            return {
                success: false,
                error: 'Not in HTTP mode or no HTTP configuration available'
            };
        }

        try {
            const config = this.currentConnection.http;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), config.timeout);

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            };

            if (config.apiKey) {
                headers['Authorization'] = `Bearer ${config.apiKey}`;
            }

            const requestBody = {
                jsonrpc: '2.0',
                id: Date.now(),
                method: `tools/call`,
                params: {
                    name: method,
                    arguments: params
                }
            };

            const response = await fetch(config.url, {
                method: 'POST',
                headers,
                body: JSON.stringify(requestBody),
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                return {
                    success: false,
                    error: `HTTP ${response.status}: ${response.statusText}`
                };
            }

            const result = await response.json();

            if (result.error) {
                return {
                    success: false,
                    error: result.error.message || 'Unknown MCP error'
                };
            }

            return {
                success: true,
                result: result.result
            };

        } catch (error: any) {
            if (error.name === 'AbortError') {
                return {
                    success: false,
                    error: `Request timeout after ${this.currentConnection.http.timeout}ms`
                };
            }

            return {
                success: false,
                error: `HTTP request failed: ${error.message}`
            };
        }
    }

    async getServerStatus(): Promise<{ type: McpServerType; connected: boolean; message: string; url?: string }> {
        if (!this.currentConnection) {
            return {
                type: 'local',
                connected: false,
                message: 'No connection initialized'
            };
        }

        const { type } = this.currentConnection;

        if (type === 'local') {
            const isInstalled = await this.isSpecForgedInstalled();
            return {
                type,
                connected: isInstalled,
                message: isInstalled ? 'Local server available' : 'SpecForged not installed'
            };
        }

        if (this.currentConnection.http) {
            const testResult = await this.testHttpConnection(this.currentConnection.http);
            return {
                type,
                connected: testResult.success,
                message: testResult.message,
                url: this.currentConnection.http.url
            };
        }

        return {
            type,
            connected: false,
            message: 'Invalid connection configuration'
        };
    }

    dispose(): void {
        if (this.syncStatusWatcher) {
            this.syncStatusWatcher.dispose();
        }

        if (this.serverHealthCheck) {
            clearInterval(this.serverHealthCheck);
        }

        console.log('MCP Manager disposed');
    }
}
