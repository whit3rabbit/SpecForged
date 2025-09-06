import * as vscode from 'vscode';
import { SpecProvider } from './providers/specProvider';
import { SpecTreeView } from './views/specTreeView';
import { McpManager } from './mcp/mcpManager';
import { SpecificationManager } from './utils/specificationManager';
import { StatusBarManager } from './utils/statusBarManager';
import { FileOperationService } from './services/fileOperationService';
import { McpSyncService } from './services/mcpSyncService';
import { ConflictResolver } from './utils/conflictResolver';
import { McpCommandHandler } from './commands/mcpCommands';
import { setupCommands } from './commands';
import { OperationQueueView } from './views/operationQueueView';

let specProvider: SpecProvider;
let specTreeView: SpecTreeView;
let mcpManager: McpManager;
let specificationManager: SpecificationManager;
let statusBarManager: StatusBarManager;
let fileOperationService: FileOperationService;
let mcpSyncService: McpSyncService;
let conflictResolver: ConflictResolver;
let mcpCommandHandler: McpCommandHandler;
let operationQueueView: OperationQueueView;

export function activate(context: vscode.ExtensionContext) {
    console.log('SpecForged extension is now active with MCP sync capabilities!');

    try {
        // Initialize core services first
        fileOperationService = new FileOperationService();
        conflictResolver = new ConflictResolver();
        mcpSyncService = new McpSyncService(fileOperationService);
        
        // Initialize existing components
        specificationManager = new SpecificationManager();
        specProvider = new SpecProvider(specificationManager);
        mcpManager = new McpManager();
        
        // Connect MCP manager with sync service
        mcpManager.setSyncService(mcpSyncService);
        mcpSyncService.setMcpManager(mcpManager);
        
        // Initialize MCP command handler
        mcpCommandHandler = new McpCommandHandler(
            fileOperationService,
            mcpSyncService,
            conflictResolver
        );
        
        // Create tree view
        specTreeView = new SpecTreeView(specProvider, context);
        
        // Create operation queue view
        operationQueueView = new OperationQueueView(
            mcpSyncService,
            conflictResolver,
            context
        );
        
        // Create enhanced status bar manager
        statusBarManager = new StatusBarManager(specificationManager, mcpManager);
        context.subscriptions.push(statusBarManager);

    // Register tree data provider
    const treeDataProvider = vscode.window.createTreeView('specforged.specifications', {
        treeDataProvider: specProvider,
        canSelectMany: false,
        dragAndDropController: undefined
    });
    
    context.subscriptions.push(treeDataProvider);

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

        // Initialize MCP sync service
        await mcpSyncService.initialize();

        // Initialize MCP connection
        const connectionResult = await mcpManager.initializeConnection();
        console.log('MCP Connection:', connectionResult.message);

        // Initial scan for specifications
        specProvider.refresh();
        statusBarManager.update();
        updateContexts();

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
        updateContexts();
        
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
        updateContexts();
        
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
        updateContexts();
        
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
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
        specProvider.refresh();
        updateContexts();
    });
}

export function deactivate() {
    console.log('SpecForged extension deactivating...');
    
    if (mcpSyncService) {
        mcpSyncService.dispose();
    }
    
    if (mcpManager) {
        mcpManager.dispose();
    }
    
    if (statusBarManager) {
        statusBarManager.dispose();
    }
    
    if (operationQueueView) {
        operationQueueView.dispose();
    }
    
    console.log('SpecForged extension deactivated');
}

function updateContexts() {
    const hasSpecs = specificationManager.hasSpecifications();
    
    vscode.commands.executeCommand('setContext', 'specforged.hasSpecs', hasSpecs);
    vscode.commands.executeCommand('setContext', 'specforged.setupMode', !hasSpecs);
    vscode.commands.executeCommand('setContext', 'specforged.mcpSyncEnabled', !!mcpSyncService);
    
    if (statusBarManager) {
        statusBarManager.update();
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