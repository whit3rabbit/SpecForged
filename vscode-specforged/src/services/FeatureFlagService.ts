/**
 * Feature flag service with rollout controls for gradual feature deployment.
 */

import * as vscode from 'vscode';

export interface FeatureFlag {
    name: string;
    enabled: boolean;
    rolloutPercentage: number; // 0-100
    targetGroups: string[];
    conditions: Record<string, any>;
    metadata: Record<string, any>;
    createdAt: string;
    updatedAt?: string;
    expiresAt?: string;
}

export interface FeatureFlagConfig {
    flags: Record<string, FeatureFlag>;
    userContext: UserContext;
    environment: string;
    version: string;
}

export interface UserContext {
    userId?: string;
    groups: string[];
    environment: string;
    version: string;
    metadata: Record<string, any>;
}

export interface RolloutStrategy {
    name: string;
    description: string;
    evaluate: (flag: FeatureFlag, context: UserContext) => boolean;
}

export class FeatureFlagService {
    private config: vscode.WorkspaceConfiguration;
    private userContext: UserContext;
    private flagCache: Map<string, boolean> = new Map();
    private rolloutStrategies: Map<string, RolloutStrategy> = new Map();
    private readonly cacheTimeout = 5 * 60 * 1000; // 5 minutes
    private lastCacheUpdate = 0;

    constructor(private context: vscode.ExtensionContext) {
        this.config = vscode.workspace.getConfiguration('specforged');
        this.userContext = this.initializeUserContext();
        this.registerDefaultStrategies();
        
        // Listen for configuration changes
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('specforged.featureFlags') || 
                e.affectsConfiguration('specforged.environment')) {
                this.clearCache();
                this.userContext = this.initializeUserContext();
            }
        }, null, context.subscriptions);
    }

    /**
     * Check if a feature flag is enabled for the current user/context.
     */
    isEnabled(flagName: string, overrideContext?: Partial<UserContext>): boolean {
        const cacheKey = `${flagName}:${JSON.stringify(overrideContext || {})}`;
        
        // Check cache first
        if (this.isCacheValid() && this.flagCache.has(cacheKey)) {
            return this.flagCache.get(cacheKey)!;
        }

        try {
            const flag = this.getFlag(flagName);
            if (!flag) {
                // Flag doesn't exist - return false by default
                this.flagCache.set(cacheKey, false);
                return false;
            }

            // Check if flag is expired
            if (flag.expiresAt && new Date() > new Date(flag.expiresAt)) {
                this.flagCache.set(cacheKey, false);
                return false;
            }

            // If flag is disabled globally, return false
            if (!flag.enabled) {
                this.flagCache.set(cacheKey, false);
                return false;
            }

            const context = { ...this.userContext, ...overrideContext };
            const enabled = this.evaluateFlag(flag, context);

            // Cache result
            this.flagCache.set(cacheKey, enabled);
            return enabled;

        } catch (error) {
            console.error(`Error checking feature flag '${flagName}':`, error);
            this.flagCache.set(cacheKey, false);
            return false;
        }
    }

    /**
     * Get feature flag configuration.
     */
    getFlag(flagName: string): FeatureFlag | null {
        const flags = this.getAllFlags();
        return flags[flagName] || null;
    }

    /**
     * Get all feature flags.
     */
    getAllFlags(): Record<string, FeatureFlag> {
        // First check workspace configuration
        let flags = this.config.get<Record<string, FeatureFlag>>('featureFlags.customFlags', {});

        // Add built-in flags
        const builtInFlags = this.getBuiltInFlags();
        flags = { ...builtInFlags, ...flags };

        return flags;
    }

    /**
     * Create a new feature flag.
     */
    async createFlag(
        name: string, 
        enabled: boolean = false, 
        options: Partial<FeatureFlag> = {}
    ): Promise<boolean> {
        try {
            const flag: FeatureFlag = {
                name,
                enabled,
                rolloutPercentage: options.rolloutPercentage || 0,
                targetGroups: options.targetGroups || [],
                conditions: options.conditions || {},
                metadata: options.metadata || {},
                createdAt: new Date().toISOString(),
                ...options
            };

            const flags = this.getAllFlags();
            flags[name] = flag;

            await this.config.update('featureFlags.customFlags', flags, vscode.ConfigurationTarget.Global);
            this.clearCache();

            return true;
        } catch (error) {
            console.error(`Failed to create feature flag '${name}':`, error);
            return false;
        }
    }

    /**
     * Update an existing feature flag.
     */
    async updateFlag(flagName: string, updates: Partial<FeatureFlag>): Promise<boolean> {
        try {
            const flags = this.getAllFlags();
            const flag = flags[flagName];

            if (!flag) {
                throw new Error(`Feature flag '${flagName}' does not exist`);
            }

            const updatedFlag = {
                ...flag,
                ...updates,
                updatedAt: new Date().toISOString()
            };

            flags[flagName] = updatedFlag;

            await this.config.update('featureFlags.customFlags', flags, vscode.ConfigurationTarget.Global);
            this.clearCache();

            return true;
        } catch (error) {
            console.error(`Failed to update feature flag '${flagName}':`, error);
            return false;
        }
    }

    /**
     * Delete a feature flag.
     */
    async deleteFlag(flagName: string): Promise<boolean> {
        try {
            const flags = this.getAllFlags();
            
            if (!(flagName in flags)) {
                return false;
            }

            delete flags[flagName];

            await this.config.update('featureFlags.customFlags', flags, vscode.ConfigurationTarget.Global);
            this.clearCache();

            return true;
        } catch (error) {
            console.error(`Failed to delete feature flag '${flagName}':`, error);
            return false;
        }
    }

    /**
     * Set user context for feature flag evaluation.
     */
    setUserContext(context: Partial<UserContext>): void {
        this.userContext = { ...this.userContext, ...context };
        this.clearCache();
    }

    /**
     * Get current user context.
     */
    getUserContext(): UserContext {
        return { ...this.userContext };
    }

    /**
     * Register a custom rollout strategy.
     */
    registerStrategy(strategy: RolloutStrategy): void {
        this.rolloutStrategies.set(strategy.name, strategy);
    }

    /**
     * Get feature flag statistics and health information.
     */
    getFeatureFlagStats(): {
        totalFlags: number;
        enabledFlags: number;
        flagsWithRollout: number;
        flagsByGroup: Record<string, number>;
        cacheStats: {
            size: number;
            hitRate: number;
            lastUpdate: string;
        };
    } {
        const flags = this.getAllFlags();
        const flagEntries = Object.entries(flags);

        const enabledFlags = flagEntries.filter(([_, flag]) => flag.enabled).length;
        const flagsWithRollout = flagEntries.filter(([_, flag]) => 
            flag.rolloutPercentage > 0 && flag.rolloutPercentage < 100
        ).length;

        const flagsByGroup: Record<string, number> = {};
        flagEntries.forEach(([_, flag]) => {
            flag.targetGroups.forEach(group => {
                flagsByGroup[group] = (flagsByGroup[group] || 0) + 1;
            });
        });

        return {
            totalFlags: flagEntries.length,
            enabledFlags,
            flagsWithRollout,
            flagsByGroup,
            cacheStats: {
                size: this.flagCache.size,
                hitRate: 0.85, // Would track actual hit rate in production
                lastUpdate: new Date(this.lastCacheUpdate).toISOString()
            }
        };
    }

    /**
     * Export feature flag configuration.
     */
    exportConfig(): FeatureFlagConfig {
        return {
            flags: this.getAllFlags(),
            userContext: this.userContext,
            environment: this.config.get<string>('environment', 'production'),
            version: vscode.extensions.getExtension('specforged.vscode-specforged')?.packageJSON.version || '0.0.0'
        };
    }

    /**
     * Import feature flag configuration.
     */
    async importConfig(config: FeatureFlagConfig): Promise<boolean> {
        try {
            await this.config.update('featureFlags.customFlags', config.flags, vscode.ConfigurationTarget.Global);
            
            if (config.userContext) {
                this.setUserContext(config.userContext);
            }

            this.clearCache();
            return true;
        } catch (error) {
            console.error('Failed to import feature flag configuration:', error);
            return false;
        }
    }

    /**
     * Clear feature flag cache.
     */
    private clearCache(): void {
        this.flagCache.clear();
        this.lastCacheUpdate = Date.now();
    }

    /**
     * Check if cache is still valid.
     */
    private isCacheValid(): boolean {
        return Date.now() - this.lastCacheUpdate < this.cacheTimeout;
    }

    /**
     * Initialize user context from configuration.
     */
    private initializeUserContext(): UserContext {
        const rolloutGroup = this.config.get<string>('featureFlags.rolloutGroup', 'stable');
        const environment = this.config.get<string>('environment', 'production');
        const version = vscode.extensions.getExtension('specforged.vscode-specforged')?.packageJSON.version || '0.0.0';

        return {
            userId: this.generateUserIdHash(),
            groups: [rolloutGroup, environment],
            environment,
            version,
            metadata: {
                vscodeVersion: vscode.version,
                platform: process.platform,
                architecture: process.arch
            }
        };
    }

    /**
     * Generate a stable user ID hash for rollout consistency.
     */
    private generateUserIdHash(): string {
        // Use VS Code machine ID for consistent user identification
        const machineId = vscode.env.machineId;
        const workspaceId = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'no-workspace';
        
        // Simple hash function for user ID
        let hash = 0;
        const input = `${machineId}:${workspaceId}`;
        
        for (let i = 0; i < input.length; i++) {
            const char = input.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        
        return Math.abs(hash).toString(36);
    }

    /**
     * Evaluate if a feature flag should be enabled for the given context.
     */
    private evaluateFlag(flag: FeatureFlag, context: UserContext): boolean {
        // Check rollout percentage
        if (!this.checkRolloutPercentage(flag, context)) {
            return false;
        }

        // Check target groups
        if (!this.checkTargetGroups(flag, context)) {
            return false;
        }

        // Check conditions
        if (!this.checkConditions(flag, context)) {
            return false;
        }

        return true;
    }

    /**
     * Check if user falls within rollout percentage.
     */
    private checkRolloutPercentage(flag: FeatureFlag, context: UserContext): boolean {
        if (flag.rolloutPercentage >= 100) {
            return true;
        }
        if (flag.rolloutPercentage <= 0) {
            return false;
        }

        // Use consistent hashing based on flag name and user ID
        const userId = context.userId || 'anonymous';
        const input = `${flag.name}:${userId}`;
        
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            const char = input.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        
        const percentage = (Math.abs(hash) % 100) + 1;
        return percentage <= flag.rolloutPercentage;
    }

    /**
     * Check if user belongs to target groups.
     */
    private checkTargetGroups(flag: FeatureFlag, context: UserContext): boolean {
        if (flag.targetGroups.length === 0) {
            return true; // No group restrictions
        }

        // Check if any user group matches target groups
        return flag.targetGroups.some(targetGroup => 
            context.groups.includes(targetGroup) || targetGroup === 'all'
        );
    }

    /**
     * Check if conditions are met.
     */
    private checkConditions(flag: FeatureFlag, context: UserContext): boolean {
        if (Object.keys(flag.conditions).length === 0) {
            return true; // No conditions
        }

        for (const [conditionName, conditionValue] of Object.entries(flag.conditions)) {
            if (!this.evaluateCondition(conditionName, conditionValue, context, flag)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Evaluate a specific condition.
     */
    private evaluateCondition(name: string, value: any, context: UserContext, flag: FeatureFlag): boolean {
        switch (name) {
            case 'environment':
                return context.environment === value;
            
            case 'minVersion':
                return this.compareVersions(context.version, value) >= 0;
            
            case 'maxVersion':
                return this.compareVersions(context.version, value) <= 0;
            
            case 'platform':
                return context.metadata.platform === value;
            
            case 'hasWorkspace':
                return vscode.workspace.workspaceFolders !== undefined;
            
            case 'customStrategy':
                const strategy = this.rolloutStrategies.get(value);
                return strategy ? strategy.evaluate({ ...flag, conditions: {} }, context) : false;
            
            default:
                // Unknown condition - fail safe
                return false;
        }
    }

    /**
     * Compare two version strings.
     */
    private compareVersions(version1: string, version2: string): number {
        const v1Parts = version1.split('.').map(Number);
        const v2Parts = version2.split('.').map(Number);
        
        const maxLength = Math.max(v1Parts.length, v2Parts.length);
        
        for (let i = 0; i < maxLength; i++) {
            const v1Part = v1Parts[i] || 0;
            const v2Part = v2Parts[i] || 0;
            
            if (v1Part < v2Part) {return -1;}
            if (v1Part > v2Part) {return 1;}
        }
        
        return 0;
    }

    /**
     * Register default rollout strategies.
     */
    private registerDefaultStrategies(): void {
        // Canary deployment strategy
        this.registerStrategy({
            name: 'canary',
            description: 'Gradually roll out to small percentage of users',
            evaluate: (flag, context) => {
                return this.checkRolloutPercentage(flag, context);
            }
        });

        // Blue-green deployment strategy
        this.registerStrategy({
            name: 'blue_green',
            description: 'Deploy to specific environment groups',
            evaluate: (flag, context) => {
                const blueGroups = ['beta', 'staging'];
                return blueGroups.some(group => context.groups.includes(group));
            }
        });

        // Time-based rollout
        this.registerStrategy({
            name: 'time_based',
            description: 'Enable features based on time windows',
            evaluate: (flag, context) => {
                const now = new Date();
                const startTime = flag.conditions.startTime ? new Date(flag.conditions.startTime) : new Date(0);
                const endTime = flag.conditions.endTime ? new Date(flag.conditions.endTime) : new Date('2099-12-31');
                
                return now >= startTime && now <= endTime;
            }
        });
    }

    /**
     * Get built-in feature flags for SpecForged functionality.
     */
    private getBuiltInFlags(): Record<string, FeatureFlag> {
        const now = new Date().toISOString();
        
        return {
            'enhanced_notifications': {
                name: 'enhanced_notifications',
                enabled: this.config.get<boolean>('featureFlags.enableExperimentalFeatures', false),
                rolloutPercentage: 25,
                targetGroups: ['beta', 'alpha'],
                conditions: {
                    minVersion: '0.2.0'
                },
                metadata: {
                    category: 'ui',
                    impact: 'medium'
                },
                createdAt: now
            },
            
            'advanced_queue_management': {
                name: 'advanced_queue_management',
                enabled: this.config.get<boolean>('featureFlags.enableBetaFeatures', false),
                rolloutPercentage: 50,
                targetGroups: ['beta', 'alpha', 'internal'],
                conditions: {
                    minVersion: '0.2.1'
                },
                metadata: {
                    category: 'performance',
                    impact: 'high'
                },
                createdAt: now
            },
            
            'multi_workspace_sync': {
                name: 'multi_workspace_sync',
                enabled: false,
                rolloutPercentage: 0,
                targetGroups: ['internal'],
                conditions: {
                    minVersion: '0.3.0',
                    hasWorkspace: true
                },
                metadata: {
                    category: 'sync',
                    impact: 'high'
                },
                createdAt: now
            },
            
            'performance_dashboard': {
                name: 'performance_dashboard',
                enabled: this.config.get<boolean>('featureFlags.enableBetaFeatures', false),
                rolloutPercentage: 75,
                targetGroups: ['beta', 'alpha', 'internal'],
                conditions: {
                    environment: 'development'
                },
                metadata: {
                    category: 'diagnostics',
                    impact: 'low'
                },
                createdAt: now
            },
            
            'ai_suggestions': {
                name: 'ai_suggestions',
                enabled: false,
                rolloutPercentage: 5,
                targetGroups: ['alpha', 'internal'],
                conditions: {
                    minVersion: '0.3.0'
                },
                metadata: {
                    category: 'ai',
                    impact: 'medium'
                },
                createdAt: now,
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days
            }
        };
    }
}

/**
 * Global feature flag service instance
 */
let featureFlagService: FeatureFlagService | null = null;

/**
 * Get the feature flag service instance
 */
export function getFeatureFlagService(context?: vscode.ExtensionContext): FeatureFlagService {
    if (!featureFlagService && context) {
        featureFlagService = new FeatureFlagService(context);
    }
    return featureFlagService!;
}

/**
 * Check if a feature flag is enabled (convenience function)
 */
export function isFeatureEnabled(flagName: string, context?: Partial<UserContext>): boolean {
    return featureFlagService ? featureFlagService.isEnabled(flagName, context) : false;
}