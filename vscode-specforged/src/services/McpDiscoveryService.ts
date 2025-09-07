import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';

const execAsync = promisify(exec);

export interface McpClient {
    id: string;
    name: string;
    displayName: string;
    configPath: string;
    configExists: boolean;
    isInstalled: boolean;
    isRunning: boolean;
    version?: string;
    executable?: string;
    priority: number; // Higher = better detection priority
    lastDetected?: Date;
}

export interface McpServer {
    name: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
    description?: string;
    isConfigured: boolean;
    clientsConfigured: string[]; // Which clients have this server
}

export interface McpDiscoveryResult {
    clients: McpClient[];
    servers: Map<string, McpServer>;
    recommendations: McpRecommendation[];
    totalClients: number;
    configuredClients: number;
    healthIssues: string[];
}

export interface McpRecommendation {
    type: 'install_client' | 'configure_server' | 'fix_config' | 'upgrade';
    title: string;
    description: string;
    action: string;
    priority: 'high' | 'medium' | 'low';
    clientId?: string;
    serverName?: string;
}

export class McpDiscoveryService {
    private discoveryCache: McpDiscoveryResult | null = null;
    private cacheExpiry: number = 0;
    private readonly CACHE_DURATION = 30000; // 30 seconds

    private readonly CLIENT_DEFINITIONS: Record<string, Omit<McpClient, 'configExists' | 'isInstalled' | 'isRunning' | 'lastDetected'>> = {
        claude: {
            id: 'claude',
            name: 'claude',
            displayName: 'Claude Desktop',
            configPath: this.getClaudeConfigPath(),
            priority: 90,
            executable: 'Claude'
        },
        cursor: {
            id: 'cursor',
            name: 'cursor',
            displayName: 'Cursor',
            configPath: path.join(process.env.HOME || '', '.cursor/mcp.json'),
            priority: 85,
            executable: 'cursor'
        },
        windsurf: {
            id: 'windsurf',
            name: 'windsurf',
            displayName: 'Windsurf',
            configPath: path.join(process.env.HOME || '', '.codeium/windsurf/mcp_config.json'),
            priority: 80,
            executable: 'windsurf'
        },
        vscode_continue: {
            id: 'vscode_continue',
            name: 'vscode-continue',
            displayName: 'VS Code (Continue)',
            configPath: path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.continue/config.json'),
            priority: 70,
            executable: 'code'
        },
        vscode_codeium: {
            id: 'vscode_codeium',
            name: 'vscode-codeium',
            displayName: 'VS Code (Codeium)',
            configPath: path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', '.vscode/codeium_mcp.json'),
            priority: 65
        },
        zed: {
            id: 'zed',
            name: 'zed',
            displayName: 'Zed Editor',
            configPath: this.getZedConfigPath(),
            priority: 60,
            executable: 'zed'
        },
        neovim: {
            id: 'neovim',
            name: 'neovim',
            displayName: 'Neovim (MCP.nvim)',
            configPath: path.join(process.env.HOME || '', '.config/nvim/lua/mcp.lua'),
            priority: 50,
            executable: 'nvim'
        }
    };

    constructor() {}

    async discoverMcpEcosystem(forceRefresh = false): Promise<McpDiscoveryResult> {
        const now = Date.now();
        
        if (!forceRefresh && this.discoveryCache && now < this.cacheExpiry) {
            return this.discoveryCache;
        }

        console.log('🔍 Starting MCP ecosystem discovery...');
        
        const clients: McpClient[] = [];
        const servers = new Map<string, McpServer>();
        const healthIssues: string[] = [];

        // Discover all MCP clients
        for (const [id, definition] of Object.entries(this.CLIENT_DEFINITIONS)) {
            try {
                const client = await this.detectClient(definition);
                clients.push(client);
                
                // If client has config, parse servers
                if (client.configExists) {
                    try {
                        const clientServers = await this.parseClientConfig(client);
                        for (const [name, server] of clientServers) {
                            if (servers.has(name)) {
                                const existing = servers.get(name)!;
                                existing.clientsConfigured.push(client.id);
                            } else {
                                server.clientsConfigured = [client.id];
                                servers.set(name, server);
                            }
                        }
                    } catch (error) {
                        healthIssues.push(`Failed to parse config for ${client.displayName}: ${error}`);
                    }
                }
            } catch (error) {
                console.warn(`Failed to detect client ${id}:`, error);
                healthIssues.push(`Client detection failed for ${definition.displayName}: ${error}`);
            }
        }

        // Sort clients by priority
        clients.sort((a, b) => b.priority - a.priority);

        // Generate recommendations
        const recommendations = this.generateRecommendations(clients, servers, healthIssues);

        const result: McpDiscoveryResult = {
            clients,
            servers,
            recommendations,
            totalClients: clients.length,
            configuredClients: clients.filter(c => c.configExists).length,
            healthIssues
        };

        this.discoveryCache = result;
        this.cacheExpiry = now + this.CACHE_DURATION;

        console.log(`✅ Discovery complete: ${result.configuredClients}/${result.totalClients} clients configured`);
        
        return result;
    }

    private async detectClient(definition: Omit<McpClient, 'configExists' | 'isInstalled' | 'isRunning' | 'lastDetected'>): Promise<McpClient> {
        const configExists = fs.existsSync(this.expandPath(definition.configPath));
        let isInstalled = false;
        let isRunning = false;
        let version: string | undefined;

        // Check if executable is installed
        if (definition.executable) {
            try {
                const { stdout } = await execAsync(`${definition.executable} --version`);
                isInstalled = true;
                version = stdout.trim().split('\n')[0];
            } catch {
                // Try alternative detection methods
                isInstalled = await this.alternativeInstallCheck(definition.id);
            }
        } else {
            // For clients without executables, assume installed if config exists
            isInstalled = configExists;
        }

        // Check if running (simplified - could be enhanced)
        if (isInstalled) {
            isRunning = await this.checkIfClientRunning(definition.id);
        }

        return {
            ...definition,
            configExists,
            isInstalled,
            isRunning,
            version,
            lastDetected: new Date()
        };
    }

    private async alternativeInstallCheck(clientId: string): Promise<boolean> {
        switch (clientId) {
            case 'claude':
                return fs.existsSync('/Applications/Claude.app') || 
                       fs.existsSync(path.join(process.env.HOME || '', 'Applications/Claude.app'));
            
            case 'cursor':
                return fs.existsSync('/Applications/Cursor.app') ||
                       fs.existsSync(path.join(process.env.HOME || '', 'Applications/Cursor.app')) ||
                       process.platform === 'win32' && fs.existsSync(path.join(process.env.LOCALAPPDATA || '', 'Programs/cursor'));
            
            case 'windsurf':
                return fs.existsSync(path.join(process.env.HOME || '', '.codeium/windsurf'));
            
            case 'zed':
                return fs.existsSync('/Applications/Zed.app') ||
                       fs.existsSync(path.join(process.env.HOME || '', 'Applications/Zed.app'));
            
            default:
                return false;
        }
    }

    private async checkIfClientRunning(clientId: string): Promise<boolean> {
        try {
            let processName = '';
            switch (clientId) {
                case 'claude':
                    processName = 'Claude';
                    break;
                case 'cursor':
                    processName = 'Cursor';
                    break;
                case 'windsurf':
                    processName = 'Windsurf';
                    break;
                case 'zed':
                    processName = 'zed';
                    break;
                default:
                    return false;
            }

            if (process.platform === 'darwin') {
                const { stdout } = await execAsync(`pgrep -f "${processName}"`);
                return stdout.trim().length > 0;
            } else if (process.platform === 'win32') {
                const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${processName}.exe"`);
                return stdout.includes(processName);
            }
        } catch {
            // Process not running or command failed
        }
        return false;
    }

    private async parseClientConfig(client: McpClient): Promise<Map<string, McpServer>> {
        const servers = new Map<string, McpServer>();
        const configPath = this.expandPath(client.configPath);
        
        if (!fs.existsSync(configPath)) {
            return servers;
        }

        try {
            const content = fs.readFileSync(configPath, 'utf8');
            let config: any;

            if (configPath.endsWith('.lua')) {
                // Simplified Lua parsing for Neovim (would need proper parser)
                return servers;
            } else {
                config = JSON.parse(content);
            }

            const mcpServers = config.mcpServers || {};
            
            for (const [name, serverConfig] of Object.entries(mcpServers)) {
                const server = serverConfig as any;
                servers.set(name, {
                    name,
                    command: server.command || '',
                    args: server.args || [],
                    env: server.env || {},
                    description: this.getServerDescription(name),
                    isConfigured: true,
                    clientsConfigured: []
                });
            }
        } catch (error) {
            console.warn(`Failed to parse config for ${client.displayName}:`, error);
            throw new Error(`Invalid JSON in ${client.displayName} config`);
        }

        return servers;
    }

    private getServerDescription(serverName: string): string {
        const descriptions: Record<string, string> = {
            'specforged': 'SpecForged - Specification-driven development with EARS notation',
            'context7': 'Context7 - Documentation and code context provider',
            'tavily': 'Tavily - Web search and research capabilities',
            'puppeteer': 'Puppeteer - Browser automation and web scraping',
            'supabase': 'Supabase - Database and backend services',
            'playwright': 'Playwright - Cross-browser testing and automation',
            'sequential-thinking': 'Sequential Thinking - Structured problem solving',
            'repomix': 'Repomix - Repository analysis and mixing',
        };
        
        return descriptions[serverName] || `${serverName} - MCP Server`;
    }

    private generateRecommendations(
        clients: McpClient[], 
        servers: Map<string, McpServer>, 
        healthIssues: string[]
    ): McpRecommendation[] {
        const recommendations: McpRecommendation[] = [];

        // Recommend installing popular clients
        const uninstalledClients = clients.filter(c => !c.isInstalled && c.priority >= 70);
        for (const client of uninstalledClients) {
            recommendations.push({
                type: 'install_client',
                title: `Install ${client.displayName}`,
                description: `${client.displayName} is a popular MCP-enabled IDE that would benefit your development workflow.`,
                action: `install_${client.id}`,
                priority: client.priority >= 85 ? 'high' : 'medium',
                clientId: client.id
            });
        }

        // Recommend configuring SpecForged for installed clients
        const installedButUnconfigured = clients.filter(c => 
            c.isInstalled && !servers.has('specforged')
        );
        for (const client of installedButUnconfigured) {
            recommendations.push({
                type: 'configure_server',
                title: `Configure SpecForged in ${client.displayName}`,
                description: `Add SpecForged to ${client.displayName} for specification-driven development.`,
                action: `configure_specforged_${client.id}`,
                priority: 'high',
                clientId: client.id,
                serverName: 'specforged'
            });
        }

        // Recommend fixing configuration issues
        for (const issue of healthIssues) {
            recommendations.push({
                type: 'fix_config',
                title: 'Fix Configuration Issue',
                description: issue,
                action: 'fix_config',
                priority: 'medium'
            });
        }

        // Sort by priority
        recommendations.sort((a, b) => {
            const priorityMap = { high: 3, medium: 2, low: 1 };
            return priorityMap[b.priority] - priorityMap[a.priority];
        });

        return recommendations;
    }

    async getClientById(clientId: string): Promise<McpClient | null> {
        const discovery = await this.discoverMcpEcosystem();
        return discovery.clients.find(c => c.id === clientId) || null;
    }

    async getInstalledClients(): Promise<McpClient[]> {
        const discovery = await this.discoverMcpEcosystem();
        return discovery.clients.filter(c => c.isInstalled);
    }

    async getConfiguredClients(): Promise<McpClient[]> {
        const discovery = await this.discoverMcpEcosystem();
        return discovery.clients.filter(c => c.configExists);
    }

    async getServersByClient(clientId: string): Promise<McpServer[]> {
        const client = await this.getClientById(clientId);
        if (!client || !client.configExists) {
            return [];
        }

        const servers = await this.parseClientConfig(client);
        return Array.from(servers.values());
    }

    private getClaudeConfigPath(): string {
        const platform = process.platform;
        switch (platform) {
            case 'darwin':
                return path.join(process.env.HOME || '', 'Library/Application Support/Claude/claude_desktop_config.json');
            case 'win32':
                return path.join(process.env.APPDATA || '', 'Claude/claude_desktop_config.json');
            default:
                return path.join(process.env.HOME || '', '.config/Claude/claude_desktop_config.json');
        }
    }

    private getZedConfigPath(): string {
        const platform = process.platform;
        switch (platform) {
            case 'darwin':
                return path.join(process.env.HOME || '', 'Library/Application Support/Zed/mcp_config.json');
            case 'win32':
                return path.join(process.env.APPDATA || '', 'Zed/mcp_config.json');
            default:
                return path.join(process.env.HOME || '', '.config/zed/mcp_config.json');
        }
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

        if (filePath.includes('%LOCALAPPDATA%')) {
            const localAppData = process.env.LOCALAPPDATA || '';
            return filePath.replace('%LOCALAPPDATA%', localAppData);
        }

        return filePath;
    }

    clearCache(): void {
        this.discoveryCache = null;
        this.cacheExpiry = 0;
    }

    dispose(): void {
        this.clearCache();
    }
}