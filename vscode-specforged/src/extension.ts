import * as vscode from 'vscode';
import { SpecProvider } from './providers/specProvider';
import { SpecTreeView } from './views/specTreeView';
import { McpManager } from './mcp/mcpManager';
import { SpecificationManager } from './utils/specificationManager';
import { StatusBarManager } from './utils/statusBarManager';
import { EnhancedStatusBarManager } from './utils/EnhancedStatusBarManager';
import { McpStatusBarManager } from './utils/McpStatusBarManager';
import { FileOperationService } from './services/fileOperationService';
import { McpSyncService } from './services/mcpSyncService';
import { McpDiscoveryService } from './services/McpDiscoveryService';
import { McpConfigSyncService } from './services/McpConfigSyncService';
import { ConflictResolver } from './utils/conflictResolver';
import { McpApiHandler } from './commands/mcpCommands';
import { EnhancedMcpCommandsHandler } from './commands/enhancedMcpCommands';
import { NotificationCommandHandler } from './commands/notificationCommands';
import { setupCommands } from './commands';
import { OperationQueueView, OperationQueueProvider } from './views/operationQueueView';
import { NotificationHistoryView } from './views/notificationHistoryView';
import { McpDashboardProvider } from './views/McpDashboardProvider';
import { SettingsProvider } from './views/SettingsProvider';
import { NotificationManager } from './services/notificationManager';
import { LiveUpdateService } from './services/LiveUpdateService';
import { SecurityManager } from './security/securityManager';
import { AtomicFileOperationError } from './utils/atomicFileOperations';

// Enhanced service management with proper lifecycle
interface ServiceContainer {
    // Core services
    specProvider: SpecProvider;
    specTreeView: SpecTreeView;
    mcpManager: McpManager;
    specificationManager: SpecificationManager;

    // Status management
    statusBarManager: StatusBarManager;
    enhancedStatusBarManager: EnhancedStatusBarManager;
    mcpStatusBarManager: McpStatusBarManager;

    // File and sync services
    fileOperationService: FileOperationService;
    mcpSyncService: McpSyncService;
    mcpDiscoveryService: McpDiscoveryService;
    mcpConfigSyncService: McpConfigSyncService;
    conflictResolver: ConflictResolver;

    // Command handlers
    mcpApiHandler: McpApiHandler;
    enhancedMcpCommandsHandler: EnhancedMcpCommandsHandler;
    notificationCommandHandler: NotificationCommandHandler;

    // UI components
    operationQueueView: OperationQueueView;
    operationQueueProvider: OperationQueueProvider;
    notificationHistoryView: NotificationHistoryView;
    mcpDashboardProvider: McpDashboardProvider;
    settingsProvider: SettingsProvider;

    // Notification system
    notificationManager: NotificationManager;
    liveUpdateService: LiveUpdateService;

    // Security system
    securityManager: SecurityManager;

    // Tree views
    specTreeDataProvider: vscode.TreeView<any>;
    operationQueueTreeView: vscode.TreeView<any>;

    // File watchers
    specWatcher: vscode.FileSystemWatcher;
    configWatcher: vscode.FileSystemWatcher;

    // Configuration
    config: ExtensionConfiguration;

    // Disposables for cleanup
    disposables: vscode.Disposable[];
}

interface ExtensionConfiguration {
    autoDetect: boolean;
    specFolder: string;
    showProgressBadges: boolean;
    enableSyntaxHighlighting: boolean;
    mcpServerPath: string;
    defaultIde: string;
    enableWebview: boolean;
    mcpServerType: string;
    mcpServerUrl: string;
    smitheryServerName: string;
    smitheryApiKey: string;
    autoFallbackToLocal: boolean;
    connectionTimeout: number;
    autoDiscovery: boolean;
    discoveryInterval: number;
    enableDashboard: boolean;
    showRecommendations: boolean;
    enableBackups: boolean;
    backupRetentionDays: number;
    syncProfiles: any[];
    preferredProtocol: string;
    retryAttempts: number;
    retryDelay: number;
    enableTelemetry: boolean;
    debugMode: boolean;
    logLevel: string;
    serverRegistry: string;
    customClientPaths: { [key: string]: string };
    enableNotifications: boolean;
    quickSetupPreferences: {
        skipClientSelection: boolean;
        autoConfigureSpecForged: boolean;
        createDefaultProfile: boolean;
    };
}

// Global service container
let services: ServiceContainer | undefined;

export async function activate(context: vscode.ExtensionContext) {
    console.log('SpecForged extension is now active with enhanced MCP sync capabilities!');

    try {
        // Load and validate configuration
        const config = await loadAndValidateConfiguration();

        // Initialize service container
        services = await initializeServices(context, config);

        // Set up service dependencies and cross-service communication
        await setupServiceDependencies(services);

        // Register enhanced tree views and command handlers
        await registerTreeViewsAndCommands(context, services);

        // Initialize file watchers for configuration and specifications
        await setupFileWatchers(context, services);

        // Initialize MCP services and connections
        await initializeMcpServices(services, config);

        // Perform initial discovery and setup if enabled
        await performInitialSetup(services, config);

        // Update UI and contexts
        await updateUIAndContexts(services);

        // Show activation success message
        await showActivationMessage(services);

        console.log('✅ SpecForged extension activation completed successfully');

    } catch (error) {
        console.error('❌ Failed to activate SpecForged extension:', error);

        // Attempt graceful degradation
        await handleActivationError(error, context);
    }
}

export function deactivate() {
    console.log('🔄 SpecForged extension deactivating...');

    if (services) {
        // Dispose all services in reverse order of initialization
        disposeServices(services);
        services = undefined;
    }

    console.log('✅ SpecForged extension deactivated successfully');
}

async function disposeServices(services: ServiceContainer): Promise<void> {
    const disposalTasks: Promise<void>[] = [];

    try {
        // Dispose file watchers first
        if (services.specWatcher) {
            services.specWatcher.dispose();
        }
        if (services.configWatcher) {
            services.configWatcher.dispose();
        }

        // Dispose UI components
        if (services.mcpDashboardProvider && typeof services.mcpDashboardProvider.dispose === 'function') {
            disposalTasks.push(Promise.resolve(services.mcpDashboardProvider.dispose()));
        }
        if (services.settingsProvider && typeof services.settingsProvider.dispose === 'function') {
            disposalTasks.push(Promise.resolve(services.settingsProvider.dispose()));
        }
        if (services.operationQueueView && typeof services.operationQueueView.dispose === 'function') {
            disposalTasks.push(Promise.resolve(services.operationQueueView.dispose()));
        }

        // Dispose live update service
        if (services.liveUpdateService && typeof services.liveUpdateService.dispose === 'function') {
            disposalTasks.push(Promise.resolve(services.liveUpdateService.dispose()));
        }

        // Dispose command handlers
        if (services.enhancedMcpCommandsHandler && typeof services.enhancedMcpCommandsHandler.dispose === 'function') {
            disposalTasks.push(Promise.resolve(services.enhancedMcpCommandsHandler.dispose()));
        }

        // Dispose MCP services
        if (services.mcpConfigSyncService && typeof services.mcpConfigSyncService.dispose === 'function') {
            disposalTasks.push(Promise.resolve(services.mcpConfigSyncService.dispose()));
        }
        if (services.mcpDiscoveryService && typeof services.mcpDiscoveryService.dispose === 'function') {
            disposalTasks.push(Promise.resolve(services.mcpDiscoveryService.dispose()));
        }
        if (services.mcpSyncService && typeof services.mcpSyncService.dispose === 'function') {
            disposalTasks.push(Promise.resolve(services.mcpSyncService.dispose()));
        }
        if (services.mcpManager && typeof services.mcpManager.dispose === 'function') {
            disposalTasks.push(Promise.resolve(services.mcpManager.dispose()));
        }

        // Dispose status managers
        if (services.statusBarManager && typeof services.statusBarManager.dispose === 'function') {
            disposalTasks.push(Promise.resolve(services.statusBarManager.dispose()));
        }
        if (services.enhancedStatusBarManager && typeof services.enhancedStatusBarManager.dispose === 'function') {
            disposalTasks.push(Promise.resolve(services.enhancedStatusBarManager.dispose()));
        }
        if (services.mcpStatusBarManager && typeof services.mcpStatusBarManager.dispose === 'function') {
            disposalTasks.push(Promise.resolve(services.mcpStatusBarManager.dispose()));
        }

        // Dispose conflict resolver
        if (services.conflictResolver && typeof services.conflictResolver.dispose === 'function') {
            disposalTasks.push(Promise.resolve(services.conflictResolver.dispose()));
        }

        // Dispose all registered disposables
        if (services.disposables) {
            services.disposables.forEach(disposable => {
                try {
                    disposable.dispose();
                } catch (error) {
                    console.warn('Error disposing service:', error);
                }
            });
        }

        // Wait for all disposal tasks to complete
        await Promise.allSettled(disposalTasks);

    } catch (error) {
        console.error('Error during service disposal:', error);
    }
}

// Enhanced activation helper functions

async function loadAndValidateConfiguration(): Promise<ExtensionConfiguration> {
    const config = vscode.workspace.getConfiguration('specforged');

    // Load configuration with validation
    const extensionConfig: ExtensionConfiguration = {
        autoDetect: config.get<boolean>('autoDetect', true),
        specFolder: config.get<string>('specFolder', '.specifications'),
        showProgressBadges: config.get<boolean>('showProgressBadges', true),
        enableSyntaxHighlighting: config.get<boolean>('enableSyntaxHighlighting', true),
        mcpServerPath: config.get<string>('mcpServerPath', 'specforged'),
        defaultIde: config.get<string>('defaultIde', 'auto'),
        enableWebview: config.get<boolean>('enableWebview', true),
        mcpServerType: config.get<string>('mcpServerType', 'local'),
        mcpServerUrl: config.get<string>('mcpServerUrl', ''),
        smitheryServerName: config.get<string>('smitheryServerName', 'specforged'),
        smitheryApiKey: config.get<string>('smitheryApiKey', ''),
        autoFallbackToLocal: config.get<boolean>('autoFallbackToLocal', true),
        connectionTimeout: config.get<number>('connectionTimeout', 10000),
        autoDiscovery: config.get<boolean>('autoDiscovery', true),
        discoveryInterval: config.get<number>('discoveryInterval', 300000),
        enableDashboard: config.get<boolean>('enableDashboard', true),
        showRecommendations: config.get<boolean>('showRecommendations', true),
        enableBackups: config.get<boolean>('enableBackups', true),
        backupRetentionDays: config.get<number>('backupRetentionDays', 30),
        syncProfiles: config.get<any[]>('syncProfiles', []),
        preferredProtocol: config.get<string>('preferredProtocol', 'stdio'),
        retryAttempts: config.get<number>('retryAttempts', 3),
        retryDelay: config.get<number>('retryDelay', 5000),
        enableTelemetry: config.get<boolean>('enableTelemetry', false),
        debugMode: config.get<boolean>('debugMode', false),
        logLevel: config.get<string>('logLevel', 'info'),
        serverRegistry: config.get<string>('serverRegistry', 'https://registry.mcp.dev'),
        customClientPaths: config.get<{ [key: string]: string }>('customClientPaths', {}),
        enableNotifications: config.get<boolean>('enableNotifications', true),
        quickSetupPreferences: config.get('quickSetupPreferences', {
            skipClientSelection: false,
            autoConfigureSpecForged: true,
            createDefaultProfile: true
        })
    };

    // Validate configuration
    await validateConfiguration(extensionConfig);

    return extensionConfig;
}

async function validateConfiguration(config: ExtensionConfiguration): Promise<void> {
    const errors: string[] = [];

    // Validate timeout values
    if (config.connectionTimeout < 1000 || config.connectionTimeout > 60000) {
        errors.push('Connection timeout must be between 1000ms and 60000ms');
    }

    // Validate discovery interval
    if (config.discoveryInterval < 60000 || config.discoveryInterval > 3600000) {
        errors.push('Discovery interval must be between 1 minute and 1 hour');
    }

    // Validate retry settings
    if (config.retryAttempts < 1 || config.retryAttempts > 10) {
        errors.push('Retry attempts must be between 1 and 10');
    }

    if (config.retryDelay < 1000 || config.retryDelay > 30000) {
        errors.push('Retry delay must be between 1000ms and 30000ms');
    }

    // Validate backup retention
    if (config.backupRetentionDays < 1 || config.backupRetentionDays > 365) {
        errors.push('Backup retention days must be between 1 and 365');
    }

    if (errors.length > 0) {
        const errorMessage = `Configuration validation failed:\n${errors.join('\n')}`;
        console.error(errorMessage);
        vscode.window.showErrorMessage('SpecForged configuration validation failed. Please check your settings.');
        throw new Error(errorMessage);
    }
}

async function initializeServices(context: vscode.ExtensionContext, config: ExtensionConfiguration): Promise<ServiceContainer> {
    console.log('🔧 Initializing services...');

    // Initialize core services first
    const fileOperationService = new FileOperationService();
    const conflictResolver = new ConflictResolver();
    const mcpSyncService = new McpSyncService(fileOperationService);

    // Initialize notification system
    const notificationManager = new NotificationManager();
    const liveUpdateService = new LiveUpdateService(
        mcpSyncService,
        conflictResolver,
        notificationManager,
        context
    );

    // Initialize security system
    const securityManager = new SecurityManager(context);

    // Initialize enhanced MCP services
    const mcpDiscoveryService = new McpDiscoveryService();
    const mcpConfigSyncService = new McpConfigSyncService(mcpDiscoveryService, context);

    // Initialize existing components
    const specificationManager = new SpecificationManager();
    const specProvider = new SpecProvider(specificationManager);
    const mcpManager = new McpManager();

    // Initialize MCP command handlers
    const mcpApiHandler = new McpApiHandler(
        fileOperationService,
        mcpSyncService,
        conflictResolver
    );

    // Initialize enhanced MCP command handler
    const enhancedMcpCommandsHandler = new EnhancedMcpCommandsHandler(
        mcpDiscoveryService,
        mcpConfigSyncService,
        context
    );

    // Initialize notification command handler
    const notificationCommandHandler = new NotificationCommandHandler(
        notificationManager,
        mcpSyncService,
        conflictResolver
    );

    // Initialize UI providers
    const mcpDashboardProvider = new McpDashboardProvider(
        context.extensionUri,
        mcpDiscoveryService,
        mcpConfigSyncService,
        enhancedMcpCommandsHandler,
        context
    );

    const settingsProvider = new SettingsProvider(
        context.extensionUri,
        mcpDiscoveryService,
        mcpConfigSyncService,
        context
    );

    // Create tree view components
    const specTreeView = new SpecTreeView(specProvider, context);
    const operationQueueProvider = new OperationQueueProvider(mcpSyncService, conflictResolver);
    const operationQueueView = new OperationQueueView(
        mcpSyncService,
        conflictResolver,
        context
    );
    const notificationHistoryView = new NotificationHistoryView(notificationManager, context);

    // Create status bar managers
    const statusBarManager = new StatusBarManager(specificationManager, mcpManager);
    const enhancedStatusBarManager = new EnhancedStatusBarManager(
        specificationManager,
        mcpManager,
        mcpDiscoveryService
    );
    const mcpStatusBarManager = new McpStatusBarManager(
        mcpSyncService,
        conflictResolver,
        context
    );

    // Create tree views
    const specTreeDataProvider = vscode.window.createTreeView('specforged.specifications', {
        treeDataProvider: specProvider,
        canSelectMany: false,
        dragAndDropController: undefined
    });

    const operationQueueTreeView = vscode.window.createTreeView('specforged.operationQueue', {
        treeDataProvider: operationQueueProvider,
        canSelectMany: false
    });

    return {
        // Core services
        specProvider,
        specTreeView,
        mcpManager,
        specificationManager,

        // Status management
        statusBarManager,
        enhancedStatusBarManager,
        mcpStatusBarManager,

        // File and sync services
        fileOperationService,
        mcpSyncService,
        mcpDiscoveryService,
        mcpConfigSyncService,
        conflictResolver,

        // Command handlers
        mcpApiHandler,
        enhancedMcpCommandsHandler,
        notificationCommandHandler,

        // UI components
        operationQueueView,
        operationQueueProvider,
        notificationHistoryView,
        mcpDashboardProvider,
        settingsProvider,

        // Notification system
        notificationManager,
        liveUpdateService,

        // Security system
        securityManager,

        // Tree views
        specTreeDataProvider,
        operationQueueTreeView,

        // File watchers (will be initialized later)
        specWatcher: null as any,
        configWatcher: null as any,

        // Configuration
        config,

        // Disposables for cleanup
        disposables: []
    };
}

async function setupServiceDependencies(services: ServiceContainer): Promise<void> {
    console.log('🔗 Setting up service dependencies...');

    // Connect MCP manager with sync service
    services.mcpManager.setSyncService(services.mcpSyncService);
    services.mcpSyncService.setMcpManager(services.mcpManager);

    // Connect notification manager with sync service
    services.mcpSyncService.setNotificationManager(services.notificationManager);

    // Set up conflict resolver with sync service (if method exists)
    if (typeof (services.mcpSyncService as any).setConflictResolver === 'function') {
        (services.mcpSyncService as any).setConflictResolver(services.conflictResolver);
    }

    // Connect operation queue provider with real-time updates (if methods exist)
    if (typeof (services.mcpSyncService as any).onOperationQueueChanged === 'function') {
        (services.mcpSyncService as any).onOperationQueueChanged(() => {
            services.operationQueueProvider.refresh();
        });
    }

    if (typeof (services.conflictResolver as any).onConflictsChanged === 'function') {
        (services.conflictResolver as any).onConflictsChanged(() => {
            services.operationQueueProvider.refresh();
        });
    }

    console.log('✅ Service dependencies configured');
}

async function registerTreeViewsAndCommands(context: vscode.ExtensionContext, services: ServiceContainer): Promise<void> {
    console.log('📋 Registering tree views and commands...');

    // Register tree data providers
    context.subscriptions.push(services.specTreeDataProvider);
    context.subscriptions.push(services.operationQueueTreeView);

    // Register status bar managers
    context.subscriptions.push(services.statusBarManager);
    context.subscriptions.push(services.enhancedStatusBarManager);
    context.subscriptions.push(services.mcpStatusBarManager);

    // Register webview providers
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            McpDashboardProvider.viewType,
            services.mcpDashboardProvider
        )
    );

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            SettingsProvider.viewType,
            services.settingsProvider
        )
    );

    // Setup regular commands
    setupCommands(context, {
        specProvider: services.specProvider,
        specTreeView: services.specTreeView,
        mcpManager: services.mcpManager,
        specificationManager: services.specificationManager,
        statusBarManager: services.statusBarManager,
        treeDataProvider: services.specTreeDataProvider,
        liveUpdateService: services.liveUpdateService,
        mcpSyncService: services.mcpSyncService
    });

    // Setup MCP commands
    services.mcpApiHandler.setupMcpCommands(context);

    // Setup enhanced MCP commands
    services.enhancedMcpCommandsHandler.registerCommands(context);

    // Setup notification commands
    services.notificationCommandHandler.registerCommands(context);

    // Register enhanced dashboard and settings commands
    const openDashboardCommand = vscode.commands.registerCommand(
        'specforged.openMcpDashboard',
        () => services.mcpDashboardProvider.show()
    );
    context.subscriptions.push(openDashboardCommand);
    services.disposables.push(openDashboardCommand);

    const openSettingsCommand = vscode.commands.registerCommand(
        'specforged.openSettings',
        () => services.settingsProvider.show()
    );
    context.subscriptions.push(openSettingsCommand);
    services.disposables.push(openSettingsCommand);

    // Register enhanced operation queue commands
    const refreshQueueCommand = vscode.commands.registerCommand(
        'specforged.refreshQueue',
        async () => {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Window,
                title: 'Refreshing operation queue...',
                cancellable: false
            }, async () => {
                services.operationQueueProvider.refresh();
                // Small delay to show progress
                await new Promise(resolve => setTimeout(resolve, 200));
            });
        }
    );
    context.subscriptions.push(refreshQueueCommand);
    services.disposables.push(refreshQueueCommand);

    const autoResolveConflictsCommand = vscode.commands.registerCommand(
        'specforged.autoResolveConflicts',
        async () => {
            const result = await services.conflictResolver.autoResolveAllConflicts();
            services.operationQueueProvider.refresh();

            if (result.resolved > 0) {
                vscode.window.showInformationMessage(
                    `Auto-resolved ${result.resolved} conflicts${result.failed > 0 ? `, ${result.failed} failed` : ''}`
                );
            } else {
                vscode.window.showInformationMessage('No conflicts could be auto-resolved');
            }
        }
    );
    context.subscriptions.push(autoResolveConflictsCommand);
    services.disposables.push(autoResolveConflictsCommand);

    console.log('✅ Tree views and commands registered');
}

async function setupFileWatchers(context: vscode.ExtensionContext, services: ServiceContainer): Promise<void> {
    console.log('👀 Setting up file watchers...');

    // Watch for specification changes
    services.specWatcher = vscode.workspace.createFileSystemWatcher(
        `**/{${services.config.specFolder},specifications}/**/*`,
        false, false, false
    );

    services.specWatcher.onDidCreate(async (uri) => {
        services.specProvider.refresh();
        await updateContexts(services);

        // Notify MCP sync of specification changes
        const specId = extractSpecIdFromPath(uri.fsPath);
        if (specId) {
            await services.mcpSyncService.notifySpecificationChange(specId, 'file_created');
        }
    });

    services.specWatcher.onDidChange(async (uri) => {
        services.specProvider.refresh();
        await updateContexts(services);

        // Notify MCP sync of specification changes
        const specId = extractSpecIdFromPath(uri.fsPath);
        if (specId) {
            await services.mcpSyncService.notifySpecificationChange(specId, 'file_modified');
        }
    });

    services.specWatcher.onDidDelete(async (uri) => {
        services.specProvider.refresh();
        await updateContexts(services);

        // Notify MCP sync of specification changes
        const specId = extractSpecIdFromPath(uri.fsPath);
        if (specId) {
            await services.mcpSyncService.notifySpecificationChange(specId, 'file_deleted');
        }
    });

    context.subscriptions.push(services.specWatcher);
    services.disposables.push(services.specWatcher);

    // Watch for configuration changes
    services.configWatcher = vscode.workspace.createFileSystemWatcher(
        '**/mcp*.json',
        false, false, false
    );

    services.configWatcher.onDidChange(async () => {
        if (services.config.autoDiscovery) {
            console.log('🔄 Configuration changed, refreshing discovery...');
            await services.mcpDiscoveryService.discoverMcpEcosystem();
            await updateContexts(services);
        }
    });

    context.subscriptions.push(services.configWatcher);
    services.disposables.push(services.configWatcher);

    // Watch for workspace changes
    const workspaceChangeDisposable = vscode.workspace.onDidChangeWorkspaceFolders(async () => {
        services.specProvider.refresh();
        await updateContexts(services);
    });

    context.subscriptions.push(workspaceChangeDisposable);
    services.disposables.push(workspaceChangeDisposable);

    console.log('✅ File watchers configured');
}

async function initializeMcpServices(services: ServiceContainer, config: ExtensionConfiguration): Promise<void> {
    console.log('🚀 Initializing MCP services...');

    try {
        // Initialize MCP sync service
        await services.mcpSyncService.initialize();
        console.log('✅ MCP Sync Service initialized');

    } catch (error) {
        console.warn('⚠️ MCP sync service initialization failed:', error);
        // Don't throw - let the extension continue without sync service

        if (error instanceof AtomicFileOperationError) {
            if (config.enableNotifications) {
                vscode.window.showWarningMessage(
                    error.getUserMessage(),
                    ...error.getRecoverySuggestions()
                );
            }
        } else if (config.enableNotifications) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            vscode.window.showWarningMessage(
                `MCP sync service failed to initialize: ${errorMessage}. Some features may be limited.`
            );
        }
    }

    try {
        // Initialize MCP connection
        const connectionResult = await services.mcpManager.initializeConnection();
        console.log('MCP Connection:', connectionResult.message);

    } catch (error) {
        console.error('⚠️ MCP manager initialization failed:', error);
    }

    try {
        // Initialize config sync service (if method exists)
        if (typeof (services.mcpConfigSyncService as any).initialize === 'function') {
            await (services.mcpConfigSyncService as any).initialize();
            console.log('✅ MCP Config Sync Service initialized');
        }

    } catch (error) {
        console.error('⚠️ MCP config sync service initialization failed:', error);
    }
}

async function performInitialSetup(services: ServiceContainer, config: ExtensionConfiguration): Promise<void> {
    console.log('🔍 Performing initial setup...');

    // Initialize auto-discovery if enabled
    if (config.autoDiscovery) {
        try {
            console.log('🔍 Starting auto-discovery...');
            const discoveryResult = await services.mcpDiscoveryService.discoverMcpEcosystem();
            console.log(`✅ Discovery complete: ${discoveryResult.configuredClients}/${discoveryResult.totalClients} clients configured`);

            // Show recommendations if enabled
            if (config.showRecommendations && discoveryResult.recommendations.length > 0) {
                const highPriorityRecs = discoveryResult.recommendations.filter(r => r.priority === 'high');
                if (highPriorityRecs.length > 0 && config.enableNotifications) {
                    vscode.window.showInformationMessage(
                        `${highPriorityRecs.length} MCP setup recommendations available`,
                        'View Recommendations', 'Dismiss'
                    ).then(action => {
                        if (action === 'View Recommendations') {
                            vscode.commands.executeCommand('specforged.troubleshootSetup');
                        }
                    });
                }
            }
        } catch (error) {
            console.warn('Auto-discovery failed:', error);
        }
    }

    // Set up periodic discovery refresh if enabled
    if (config.autoDiscovery && config.discoveryInterval > 0) {
        const discoveryTimer = setInterval(async () => {
            try {
                await services.mcpDiscoveryService.discoverMcpEcosystem();
                await updateContexts(services);
            } catch (error) {
                console.warn('Periodic discovery failed:', error);
            }
        }, config.discoveryInterval);

        services.disposables.push({
            dispose: () => clearInterval(discoveryTimer)
        });
    }
}

async function updateUIAndContexts(services: ServiceContainer): Promise<void> {
    console.log('🎨 Updating UI and contexts...');

    // Initial scan for specifications
    services.specProvider.refresh();
    services.statusBarManager.update();
    await services.enhancedStatusBarManager.update();
    services.mcpStatusBarManager.refresh();
    await updateContexts(services);

    // Refresh operation queue
    services.operationQueueProvider.refresh();
}

async function showActivationMessage(services: ServiceContainer): Promise<void> {
    // Show MCP sync status in output
    const syncState = services.mcpSyncService.getSyncState();
    console.log('MCP Sync initialized:', {
        extensionOnline: syncState.extensionOnline,
        mcpServerOnline: syncState.mcpServerOnline,
        specifications: syncState.specifications.length
    });

    if (services.config.enableNotifications) {
        vscode.window.showInformationMessage(
            'SpecForged extension activated with enhanced MCP sync support!',
            'View Integration Guide', 'Open Dashboard'
        ).then(action => {
            if (action === 'View Integration Guide') {
                showMcpIntegrationGuide(services);
            } else if (action === 'Open Dashboard') {
                services.mcpDashboardProvider.show();
            }
        });
    }
}

async function handleActivationError(error: any, context: vscode.ExtensionContext): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    console.error('Extension activation failed:', error);

    // Try to provide a minimal working state
    try {
        const basicConfig = await loadAndValidateConfiguration();
        const minimalServices = await initializeMinimalServices(context, basicConfig);

        vscode.window.showErrorMessage(
            `SpecForged extension failed to activate fully: ${errorMessage}. Running in limited mode.`,
            'View Details', 'Retry'
        ).then(action => {
            if (action === 'View Details') {
                vscode.commands.executeCommand('specforged.troubleshootSetup');
            } else if (action === 'Retry') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        });

    } catch (fallbackError) {
        console.error('Failed to initialize minimal services:', fallbackError);
        vscode.window.showErrorMessage(
            `SpecForged extension failed to activate: ${errorMessage}`,
            'Troubleshoot'
        ).then(action => {
            if (action === 'Troubleshoot') {
                vscode.env.openExternal(vscode.Uri.parse('https://github.com/whit3rabbit/SpecForge/issues'));
            }
        });
    }
}

async function initializeMinimalServices(context: vscode.ExtensionContext, config: ExtensionConfiguration): Promise<void> {
    // Initialize only essential services for basic functionality
    const specificationManager = new SpecificationManager();
    const specProvider = new SpecProvider(specificationManager);

    const treeDataProvider = vscode.window.createTreeView('specforged.specifications', {
        treeDataProvider: specProvider,
        canSelectMany: false
    });

    context.subscriptions.push(treeDataProvider);

    // Set up basic commands
    const refreshCommand = vscode.commands.registerCommand('specforged.refreshSpecs', () => {
        specProvider.refresh();
    });
    context.subscriptions.push(refreshCommand);
}

async function updateContexts(services: ServiceContainer): Promise<void> {
    const hasSpecs = services.specificationManager.hasSpecifications();

    // Update existing contexts
    vscode.commands.executeCommand('setContext', 'specforged.hasSpecs', hasSpecs);
    vscode.commands.executeCommand('setContext', 'specforged.setupMode', !hasSpecs);
    vscode.commands.executeCommand('setContext', 'specforged.mcpSyncEnabled', !!services.mcpSyncService);

    // Update enhanced MCP contexts
    try {
        const discovery = await services.mcpDiscoveryService.discoverMcpEcosystem();
        const hasClients = discovery.clients.some(c => c.isInstalled);
        const hasServers = discovery.servers.size > 0;

        vscode.commands.executeCommand('setContext', 'specforged.hasClients', hasClients);
        vscode.commands.executeCommand('setContext', 'specforged.hasServers', hasServers);
        vscode.commands.executeCommand('setContext', 'specforged.enableDashboard', services.config.enableDashboard);
        vscode.commands.executeCommand('setContext', 'specforged.autoDiscoveryEnabled', services.config.autoDiscovery);
        vscode.commands.executeCommand('setContext', 'specforged.hasRecommendations', discovery.recommendations.length > 0);
    } catch (error) {
        console.warn('Failed to update enhanced contexts:', error);
    }

    if (services.statusBarManager) {
        services.statusBarManager.update();
    }

    if (services.enhancedStatusBarManager) {
        await services.enhancedStatusBarManager.update();
    }
}

function extractSpecIdFromPath(filePath: string): string | null {
    // Extract specification ID from file path
    // Expected path format: .../.specifications/spec-id/file.ext
    const match = filePath.match(/[\/\\]\.?specifications[\/\\]([^\/\\]+)[\/\\]/);
    return match ? match[1] : null;
}

async function showMcpIntegrationGuide(services: ServiceContainer): Promise<void> {
    try {
        const guide = await services.mcpManager.generateMcpIntegrationGuide();

        // Create a new document to show the guide
        const doc = await vscode.workspace.openTextDocument({
            content: guide,
            language: 'markdown'
        });

        await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Beside,
            preview: true
        });
    } catch (error) {
        console.error('Failed to show MCP integration guide:', error);
        vscode.window.showErrorMessage('Failed to generate MCP integration guide');
    }
}
