import * as vscode from 'vscode';
import { SpecProvider } from './providers/specProvider';
import { SpecTreeView } from './views/specTreeView';
import { McpManager } from './mcp/mcpManager';
import { SpecificationManager } from './utils/specificationManager';
import { StatusBarManager } from './utils/statusBarManager';
import { EnhancedStatusBarManager } from './utils/EnhancedStatusBarManager';
import { FileOperationService } from './services/fileOperationService';
import { McpSyncService } from './services/mcpSyncService';
import { McpDiscoveryService } from './services/McpDiscoveryService';
import { McpConfigSyncService } from './services/McpConfigSyncService';
import { ConflictResolver } from './utils/conflictResolver';
import { McpCommandHandler } from './commands/mcpCommands';
import { EnhancedMcpCommandsHandler } from './commands/enhancedMcpCommands';
import { setupCommands } from './commands';
import { OperationQueueView } from './views/operationQueueView';
import { McpDashboardProvider } from './views/McpDashboardProvider';
import { SettingsProvider } from './views/SettingsProvider';

let specProvider: SpecProvider;
let specTreeView: SpecTreeView;
let mcpManager: McpManager;
let specificationManager: SpecificationManager;
let statusBarManager: StatusBarManager;
let enhancedStatusBarManager: EnhancedStatusBarManager;
let fileOperationService: FileOperationService;
let mcpSyncService: McpSyncService;
let mcpDiscoveryService: McpDiscoveryService;
let mcpConfigSyncService: McpConfigSyncService;
let conflictResolver: ConflictResolver;
let mcpCommandHandler: McpCommandHandler;
let enhancedMcpCommandsHandler: EnhancedMcpCommandsHandler;
let operationQueueView: OperationQueueView;
let mcpDashboardProvider: McpDashboardProvider;
let settingsProvider: SettingsProvider;

export function activate(context: vscode.ExtensionContext) {
    console.log('SpecForged extension is now active with MCP sync capabilities!');

    try {
        // Initialize core services first
        fileOperationService = new FileOperationService();
        conflictResolver = new ConflictResolver();
        mcpSyncService = new McpSyncService(fileOperationService);
        
        // Initialize enhanced MCP services
        mcpDiscoveryService = new McpDiscoveryService();
        mcpConfigSyncService = new McpConfigSyncService(mcpDiscoveryService, context);

        // Initialize existing components
        specificationManager = new SpecificationManager();
        specProvider = new SpecProvider(specificationManager);
        mcpManager = new McpManager();

        // Connect MCP manager with sync service
        mcpManager.setSyncService(mcpSyncService);
        mcpSyncService.setMcpManager(mcpManager);

        // Initialize MCP command handlers
        mcpCommandHandler = new McpCommandHandler(
            fileOperationService,
            mcpSyncService,
            conflictResolver
        );
        
        // Initialize enhanced MCP command handler
        enhancedMcpCommandsHandler = new EnhancedMcpCommandsHandler(
            mcpDiscoveryService,
            mcpConfigSyncService,
            context
        );

        // Initialize MCP Dashboard Provider
        mcpDashboardProvider = new McpDashboardProvider(
            context.extensionUri,
            mcpDiscoveryService,
            mcpConfigSyncService,
            enhancedMcpCommandsHandler,
            context
        );

        // Initialize Settings Provider
        settingsProvider = new SettingsProvider(
            context.extensionUri,
            mcpDiscoveryService,
            mcpConfigSyncService,
            context
        );

        // Create tree view
        specTreeView = new SpecTreeView(specProvider, context);

        // Create operation queue view
        operationQueueView = new OperationQueueView(
            mcpSyncService,
            conflictResolver,
            context
        );

        // Create status bar managers
        statusBarManager = new StatusBarManager(specificationManager, mcpManager);
        enhancedStatusBarManager = new EnhancedStatusBarManager(
            specificationManager, 
            mcpManager, 
            mcpDiscoveryService
        );
        
        context.subscriptions.push(statusBarManager);
        context.subscriptions.push(enhancedStatusBarManager);

    // Register tree data provider
    const treeDataProvider = vscode.window.createTreeView('specforged.specifications', {
        treeDataProvider: specProvider,
        canSelectMany: false,
        dragAndDropController: undefined
    });

    context.subscriptions.push(treeDataProvider);

        // Register MCP Dashboard Provider
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                McpDashboardProvider.viewType, 
                mcpDashboardProvider
            )
        );

        // Register Settings Provider
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(
                SettingsProvider.viewType, 
                settingsProvider
            )
        );

        // Setup regular commands
        setupCommands(context, {
            specProvider,
            specTreeView,
            mcpManager,
            specificationManager,
            statusBarManager,
            treeDataProvider
        });

        // Setup MCP commands
        mcpCommandHandler.setupMcpCommands(context);
        
        // Setup enhanced MCP commands
        enhancedMcpCommandsHandler.registerCommands(context);

        // Register dashboard command
        const openDashboardCommand = vscode.commands.registerCommand(
            'specforged.openMcpDashboard',
            () => {
                mcpDashboardProvider.show();
            }
        );
        context.subscriptions.push(openDashboardCommand);

        // Register settings command
        const openSettingsCommand = vscode.commands.registerCommand(
            'specforged.openSettings',
            () => {
                settingsProvider.show();
            }
        );
        context.subscriptions.push(openSettingsCommand);

        // Initialize MCP sync service
        await mcpSyncService.initialize();

        // Initialize MCP connection
        const connectionResult = await mcpManager.initializeConnection();
        console.log('MCP Connection:', connectionResult.message);

        // Initialize auto-discovery if enabled
        const config = vscode.workspace.getConfiguration('specforged');
        if (config.get<boolean>('autoDiscovery', true)) {
            console.log('🔍 Starting auto-discovery...');
            const discoveryResult = await mcpDiscoveryService.discoverMcpEcosystem();
            console.log(`✅ Discovery complete: ${discoveryResult.configuredClients}/${discoveryResult.totalClients} clients configured`);
            
            // Show recommendations if enabled
            if (config.get<boolean>('showRecommendations', true) && discoveryResult.recommendations.length > 0) {
                const highPriorityRecs = discoveryResult.recommendations.filter(r => r.priority === 'high');
                if (highPriorityRecs.length > 0) {
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
        }

        // Initial scan for specifications
        specProvider.refresh();
        statusBarManager.update();
        await enhancedStatusBarManager.update();
        await updateContexts();

        // Show MCP sync status in output
        const syncState = mcpSyncService.getSyncState();
        console.log('MCP Sync initialized:', {
            extensionOnline: syncState.extensionOnline,
            mcpServerOnline: syncState.mcpServerOnline,
            specifications: syncState.specifications.length
        });

        vscode.window.showInformationMessage(
            'SpecForged extension activated with MCP sync support!',
            'View Integration Guide'
        ).then(action => {
            if (action === 'View Integration Guide') {
                showMcpIntegrationGuide();
            }
        });

    } catch (error) {
        console.error('Failed to activate SpecForged extension:', error);
        vscode.window.showErrorMessage(
            `SpecForged extension failed to activate: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }

    // Watch for file system changes
    const watcher = vscode.workspace.createFileSystemWatcher(
        '**/{.specifications,specifications}/**/*',
        false,
        false,
        false
    );

    watcher.onDidCreate(async (uri) => {
        specProvider.refresh();
        await updateContexts();

        // Notify MCP sync of specification changes
        if (mcpSyncService) {
            const specId = extractSpecIdFromPath(uri.fsPath);
            if (specId) {
                await mcpSyncService.notifySpecificationChange(specId, 'file_created');
            }
        }
    });

    watcher.onDidChange(async (uri) => {
        specProvider.refresh();
        await updateContexts();

        // Notify MCP sync of specification changes
        if (mcpSyncService) {
            const specId = extractSpecIdFromPath(uri.fsPath);
            if (specId) {
                await mcpSyncService.notifySpecificationChange(specId, 'file_modified');
            }
        }
    });

    watcher.onDidDelete(async (uri) => {
        specProvider.refresh();
        await updateContexts();

        // Notify MCP sync of specification changes
        if (mcpSyncService) {
            const specId = extractSpecIdFromPath(uri.fsPath);
            if (specId) {
                await mcpSyncService.notifySpecificationChange(specId, 'file_deleted');
            }
        }
    });

    context.subscriptions.push(watcher);

    // Watch for workspace changes
    vscode.workspace.onDidChangeWorkspaceFolders(async () => {
        specProvider.refresh();
        await updateContexts();
    });
}

export function deactivate() {
    console.log('SpecForged extension deactivating...');

    // Dispose enhanced services
    if (enhancedMcpCommandsHandler) {
        enhancedMcpCommandsHandler.dispose();
    }

    if (mcpConfigSyncService) {
        mcpConfigSyncService.dispose();
    }

    if (mcpDiscoveryService) {
        mcpDiscoveryService.dispose();
    }

    // Dispose existing services
    if (mcpSyncService) {
        mcpSyncService.dispose();
    }

    if (mcpManager) {
        mcpManager.dispose();
    }

    if (statusBarManager) {
        statusBarManager.dispose();
    }

    if (enhancedStatusBarManager) {
        enhancedStatusBarManager.dispose();
    }

    if (operationQueueView) {
        operationQueueView.dispose();
    }

    if (mcpDashboardProvider) {
        mcpDashboardProvider.dispose();
    }

    if (settingsProvider) {
        settingsProvider.dispose();
    }

    console.log('SpecForged extension deactivated');
}

async function updateContexts() {
    const hasSpecs = specificationManager.hasSpecifications();
    
    // Update existing contexts
    vscode.commands.executeCommand('setContext', 'specforged.hasSpecs', hasSpecs);
    vscode.commands.executeCommand('setContext', 'specforged.setupMode', !hasSpecs);
    vscode.commands.executeCommand('setContext', 'specforged.mcpSyncEnabled', !!mcpSyncService);
    
    // Update enhanced MCP contexts
    try {
        const discovery = await mcpDiscoveryService.discoverMcpEcosystem();
        const hasClients = discovery.clients.some(c => c.isInstalled);
        const hasServers = discovery.servers.size > 0;
        const config = vscode.workspace.getConfiguration('specforged');
        
        vscode.commands.executeCommand('setContext', 'specforged.hasClients', hasClients);
        vscode.commands.executeCommand('setContext', 'specforged.hasServers', hasServers);
        vscode.commands.executeCommand('setContext', 'specforged.enableDashboard', config.get<boolean>('enableDashboard', true));
        vscode.commands.executeCommand('setContext', 'specforged.autoDiscoveryEnabled', config.get<boolean>('autoDiscovery', true));
        vscode.commands.executeCommand('setContext', 'specforged.hasRecommendations', discovery.recommendations.length > 0);
    } catch (error) {
        console.warn('Failed to update enhanced contexts:', error);
    }

    if (statusBarManager) {
        statusBarManager.update();
    }
    
    if (enhancedStatusBarManager) {
        await enhancedStatusBarManager.update();
    }
}

function extractSpecIdFromPath(filePath: string): string | null {
    // Extract specification ID from file path
    // Expected path format: .../.specifications/spec-id/file.ext
    const match = filePath.match(/[\/\\]\.?specifications[\/\\]([^\/\\]+)[\/\\]/);
    return match ? match[1] : null;
}

async function showMcpIntegrationGuide(): Promise<void> {
    try {
        const guide = await mcpManager.generateMcpIntegrationGuide();

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
