import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { McpDiscoveryService, McpClient, McpServer } from './McpDiscoveryService';

export interface ConfigSyncProfile {
    id: string;
    name: string;
    description: string;
    servers: Record<string, ServerConfig>;
    targetClients: string[];
    created: Date;
    lastModified: Date;
}

export interface ServerConfig {
    name: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    enabled: boolean;
    clientSpecificOverrides?: Record<string, Partial<ServerConfig>>;
}

export interface SyncOperation {
    id: string;
    type: 'add_server' | 'remove_server' | 'update_server' | 'sync_profile';
    targetClients: string[];
    serverName?: string;
    config?: ServerConfig;
    profile?: ConfigSyncProfile;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    results: Record<string, SyncResult>;
    startTime?: Date;
    endTime?: Date;
    error?: string;
}

export interface SyncResult {
    clientId: string;
    success: boolean;
    message: string;
    backupPath?: string;
    configPath?: string;
}

export interface ConfigBackup {
    id: string;
    clientId: string;
    timestamp: Date;
    originalPath: string;
    backupPath: string;
    size: number;
    hash: string;
}

export class McpConfigSyncService {
    private profiles: Map<string, ConfigSyncProfile> = new Map();
    private operations: Map<string, SyncOperation> = new Map();
    private backups: ConfigBackup[] = [];
    private syncHistory: SyncOperation[] = [];

    constructor(
        private discoveryService: McpDiscoveryService,
        private context: vscode.ExtensionContext
    ) {
        this.loadProfiles();
        this.loadBackups();
    }

    async createProfile(name: string, description: string, servers: Record<string, ServerConfig>, targetClients: string[]): Promise<ConfigSyncProfile> {
        const profile: ConfigSyncProfile = {
            id: this.generateId(),
            name,
            description,
            servers,
            targetClients,
            created: new Date(),
            lastModified: new Date()
        };

        this.profiles.set(profile.id, profile);
        await this.saveProfiles();
        
        return profile;
    }

    async updateProfile(profileId: string, updates: Partial<ConfigSyncProfile>): Promise<ConfigSyncProfile> {
        const profile = this.profiles.get(profileId);
        if (!profile) {
            throw new Error(`Profile ${profileId} not found`);
        }

        Object.assign(profile, updates, { lastModified: new Date() });
        await this.saveProfiles();
        
        return profile;
    }

    async deleteProfile(profileId: string): Promise<void> {
        const profile = this.profiles.get(profileId);
        if (!profile) {
            throw new Error(`Profile ${profileId} not found`);
        }

        this.profiles.delete(profileId);
        await this.saveProfiles();
    }

    getProfiles(): ConfigSyncProfile[] {
        return Array.from(this.profiles.values()).sort((a, b) => 
            b.lastModified.getTime() - a.lastModified.getTime()
        );
    }

    getProfile(profileId: string): ConfigSyncProfile | undefined {
        return this.profiles.get(profileId);
    }

    async syncServerToClients(serverName: string, config: ServerConfig, targetClients: string[]): Promise<SyncOperation> {
        const operation: SyncOperation = {
            id: this.generateId(),
            type: 'add_server',
            targetClients,
            serverName,
            config,
            status: 'pending',
            results: {}
        };

        this.operations.set(operation.id, operation);
        
        // Start sync in background
        this.executeSyncOperation(operation);
        
        return operation;
    }

    async syncProfile(profileId: string, targetClients?: string[]): Promise<SyncOperation> {
        const profile = this.profiles.get(profileId);
        if (!profile) {
            throw new Error(`Profile ${profileId} not found`);
        }

        const clients = targetClients || profile.targetClients;
        
        const operation: SyncOperation = {
            id: this.generateId(),
            type: 'sync_profile',
            targetClients: clients,
            profile,
            status: 'pending',
            results: {}
        };

        this.operations.set(operation.id, operation);
        
        // Start sync in background
        this.executeSyncOperation(operation);
        
        return operation;
    }

    private async executeSyncOperation(operation: SyncOperation): Promise<void> {
        operation.status = 'running';
        operation.startTime = new Date();

        try {
            const discovery = await this.discoveryService.discoverMcpEcosystem();
            
            for (const clientId of operation.targetClients) {
                const client = discovery.clients.find(c => c.id === clientId);
                if (!client) {
                    operation.results[clientId] = {
                        clientId,
                        success: false,
                        message: `Client ${clientId} not found`
                    };
                    continue;
                }

                try {
                    const result = await this.syncToClient(client, operation);
                    operation.results[clientId] = result;
                } catch (error) {
                    operation.results[clientId] = {
                        clientId,
                        success: false,
                        message: `Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`
                    };
                }
            }

            const allSuccessful = Object.values(operation.results).every(r => r.success);
            operation.status = allSuccessful ? 'completed' : 'failed';
            
        } catch (error) {
            operation.status = 'failed';
            operation.error = error instanceof Error ? error.message : 'Unknown error';
        } finally {
            operation.endTime = new Date();
            this.syncHistory.push(operation);
            this.operations.delete(operation.id);
        }
    }

    private async syncToClient(client: McpClient, operation: SyncOperation): Promise<SyncResult> {
        const configPath = this.expandPath(client.configPath);
        
        // Create backup first
        const backup = await this.createBackup(client, configPath);
        
        try {
            // Load existing config
            let existingConfig: any = {};
            if (fs.existsSync(configPath)) {
                const content = fs.readFileSync(configPath, 'utf8');
                existingConfig = JSON.parse(content);
            }

            // Merge with new configuration
            const updatedConfig = await this.mergeConfigurations(
                client.id,
                existingConfig,
                operation
            );

            // Ensure directory exists
            const configDir = path.dirname(configPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }

            // Write updated config
            fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2));

            return {
                clientId: client.id,
                success: true,
                message: `Configuration updated successfully`,
                backupPath: backup.backupPath,
                configPath
            };

        } catch (error) {
            // Restore from backup on error
            if (backup && fs.existsSync(backup.backupPath)) {
                try {
                    fs.copyFileSync(backup.backupPath, configPath);
                } catch (restoreError) {
                    console.error('Failed to restore backup:', restoreError);
                }
            }
            
            throw error;
        }
    }

    private async mergeConfigurations(clientId: string, existingConfig: any, operation: SyncOperation): Promise<any> {
        const newConfig = { ...existingConfig };
        
        // Ensure mcpServers object exists
        if (!newConfig.mcpServers) {
            newConfig.mcpServers = {};
        }

        if (operation.type === 'add_server' && operation.config && operation.serverName) {
            const config = this.applyClientSpecificOverrides(clientId, operation.config);
            newConfig.mcpServers[operation.serverName] = {
                command: config.command,
                args: config.args,
                env: config.env
            };
        } else if (operation.type === 'sync_profile' && operation.profile) {
            // Sync all servers from profile
            for (const [serverName, serverConfig] of Object.entries(operation.profile.servers)) {
                if (serverConfig.enabled) {
                    const config = this.applyClientSpecificOverrides(clientId, serverConfig);
                    newConfig.mcpServers[serverName] = {
                        command: config.command,
                        args: config.args,
                        env: config.env
                    };
                }
            }
        }

        // Add metadata for tracking
        if (!newConfig.specforgedSync) {
            newConfig.specforgedSync = {};
        }
        newConfig.specforgedSync.lastSync = new Date().toISOString();
        newConfig.specforgedSync.syncedBy = 'vscode-specforged';
        newConfig.specforgedSync.operationId = operation.id;

        return newConfig;
    }

    private applyClientSpecificOverrides(clientId: string, config: ServerConfig): ServerConfig {
        const overrides = config.clientSpecificOverrides?.[clientId];
        if (!overrides) {
            return config;
        }

        return {
            ...config,
            ...overrides,
            env: { ...config.env, ...overrides.env }
        };
    }

    private async createBackup(client: McpClient, configPath: string): Promise<ConfigBackup> {
        const backupDir = path.join(this.context.globalStorageUri.fsPath, 'config-backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFileName = `${client.id}-${timestamp}.json`;
        const backupPath = path.join(backupDir, backupFileName);

        const backup: ConfigBackup = {
            id: this.generateId(),
            clientId: client.id,
            timestamp: new Date(),
            originalPath: configPath,
            backupPath,
            size: 0,
            hash: ''
        };

        if (fs.existsSync(configPath)) {
            fs.copyFileSync(configPath, backupPath);
            const stats = fs.statSync(backupPath);
            backup.size = stats.size;
            backup.hash = require('crypto').createHash('md5')
                .update(fs.readFileSync(backupPath))
                .digest('hex');
        } else {
            // Create empty backup for non-existent configs
            fs.writeFileSync(backupPath, '{}');
        }

        this.backups.push(backup);
        await this.saveBackups();
        
        return backup;
    }

    async restoreFromBackup(backupId: string): Promise<void> {
        const backup = this.backups.find(b => b.id === backupId);
        if (!backup) {
            throw new Error(`Backup ${backupId} not found`);
        }

        if (!fs.existsSync(backup.backupPath)) {
            throw new Error(`Backup file not found: ${backup.backupPath}`);
        }

        // Ensure target directory exists
        const targetDir = path.dirname(backup.originalPath);
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        fs.copyFileSync(backup.backupPath, backup.originalPath);
    }

    async cleanupBackups(olderThanDays: number = 30): Promise<number> {
        const cutoffDate = new Date(Date.now() - (olderThanDays * 24 * 60 * 60 * 1000));
        const toDelete = this.backups.filter(b => b.timestamp < cutoffDate);
        
        let deletedCount = 0;
        for (const backup of toDelete) {
            try {
                if (fs.existsSync(backup.backupPath)) {
                    fs.unlinkSync(backup.backupPath);
                }
                const index = this.backups.indexOf(backup);
                if (index > -1) {
                    this.backups.splice(index, 1);
                }
                deletedCount++;
            } catch (error) {
                console.warn(`Failed to delete backup ${backup.id}:`, error);
            }
        }

        if (deletedCount > 0) {
            await this.saveBackups();
        }

        return deletedCount;
    }

    getBackups(clientId?: string): ConfigBackup[] {
        return this.backups
            .filter(b => !clientId || b.clientId === clientId)
            .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    }

    getSyncHistory(limit: number = 50): SyncOperation[] {
        return this.syncHistory
            .sort((a, b) => (b.endTime?.getTime() || 0) - (a.endTime?.getTime() || 0))
            .slice(0, limit);
    }

    getActiveOperations(): SyncOperation[] {
        return Array.from(this.operations.values());
    }

    async generateConfigTemplate(serverName: string, templateType: 'basic' | 'development' | 'production'): Promise<ServerConfig> {
        const baseTemplates: Record<string, ServerConfig> = {
            specforged: {
                name: 'specforged',
                command: 'specforged',
                args: [],
                env: {},
                enabled: true
            },
            'specforged-dev': {
                name: 'specforged',
                command: 'python',
                args: ['-m', 'specforged'],
                env: {
                    'SPECFORGE_DEBUG': 'true',
                    'SPECFORGE_LOG_LEVEL': 'debug'
                },
                enabled: true
            },
            'specforged-prod': {
                name: 'specforged',
                command: 'specforged',
                args: [],
                env: {
                    'SPECFORGE_LOG_LEVEL': 'info',
                    'SPECFORGE_CACHE_ENABLED': 'true'
                },
                enabled: true
            }
        };

        const templateKey = templateType === 'basic' ? serverName : `${serverName}-${templateType}`;
        return baseTemplates[templateKey] || baseTemplates.specforged;
    }

    private async loadProfiles(): Promise<void> {
        try {
            const profilesPath = path.join(this.context.globalStorageUri.fsPath, 'sync-profiles.json');
            if (fs.existsSync(profilesPath)) {
                const content = fs.readFileSync(profilesPath, 'utf8');
                const profiles = JSON.parse(content);
                
                for (const profile of profiles) {
                    profile.created = new Date(profile.created);
                    profile.lastModified = new Date(profile.lastModified);
                    this.profiles.set(profile.id, profile);
                }
            }
        } catch (error) {
            console.warn('Failed to load sync profiles:', error);
        }
    }

    private async saveProfiles(): Promise<void> {
        try {
            const profilesPath = path.join(this.context.globalStorageUri.fsPath, 'sync-profiles.json');
            const profilesDir = path.dirname(profilesPath);
            
            if (!fs.existsSync(profilesDir)) {
                fs.mkdirSync(profilesDir, { recursive: true });
            }
            
            const profiles = Array.from(this.profiles.values());
            fs.writeFileSync(profilesPath, JSON.stringify(profiles, null, 2));
        } catch (error) {
            console.error('Failed to save sync profiles:', error);
        }
    }

    private async loadBackups(): Promise<void> {
        try {
            const backupsPath = path.join(this.context.globalStorageUri.fsPath, 'backups.json');
            if (fs.existsSync(backupsPath)) {
                const content = fs.readFileSync(backupsPath, 'utf8');
                const backups = JSON.parse(content);
                
                this.backups = backups.map((b: any) => ({
                    ...b,
                    timestamp: new Date(b.timestamp)
                }));
            }
        } catch (error) {
            console.warn('Failed to load backups:', error);
        }
    }

    private async saveBackups(): Promise<void> {
        try {
            const backupsPath = path.join(this.context.globalStorageUri.fsPath, 'backups.json');
            const backupsDir = path.dirname(backupsPath);
            
            if (!fs.existsSync(backupsDir)) {
                fs.mkdirSync(backupsDir, { recursive: true });
            }
            
            fs.writeFileSync(backupsPath, JSON.stringify(this.backups, null, 2));
        } catch (error) {
            console.error('Failed to save backups:', error);
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

    private generateId(): string {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    dispose(): void {
        // Cancel any pending operations
        for (const operation of this.operations.values()) {
            if (operation.status === 'pending' || operation.status === 'running') {
                operation.status = 'cancelled';
            }
        }
        
        this.operations.clear();
    }
}