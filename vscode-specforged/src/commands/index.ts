import * as vscode from 'vscode';
import { SpecProvider } from '../providers/specProvider';
import { SpecTreeView } from '../views/specTreeView';
import { McpManager } from '../mcp/mcpManager';
import { McpSetupWizard } from '../mcp/mcpSetup';
import { SpecificationManager } from '../utils/specificationManager';
import { StatusBarManager } from '../utils/statusBarManager';
import { TaskHelper } from '../models/task';

export interface ExtensionComponents {
    specProvider: SpecProvider;
    specTreeView: SpecTreeView;
    mcpManager: McpManager;
    specificationManager: SpecificationManager;
    statusBarManager: StatusBarManager;
    treeDataProvider: vscode.TreeView<any>;
}

export function setupCommands(
    context: vscode.ExtensionContext,
    components: ExtensionComponents
) {
    const {
        specProvider,
        specTreeView,
        mcpManager,
        specificationManager,
        statusBarManager,
        treeDataProvider
    } = components;

    // Initialize Project Command
    const initializeCommand = vscode.commands.registerCommand('specforged.initialize', async () => {
        const choice = await vscode.window.showQuickPick([
            {
                label: '$(rocket) Quick Start',
                description: 'Set up SpecForged with default settings',
                detail: 'Install server and create first specification'
            },
            {
                label: '$(gear) Setup MCP Only',
                description: 'Configure MCP server without creating specifications',
                detail: 'For existing projects'
            }
        ], {
            placeHolder: 'How would you like to initialize SpecForged?'
        });

        if (!choice) {
            return;
        }

        if (choice.label.includes('Quick Start')) {
            await quickStartInitialization(specificationManager, mcpManager);
        } else {
            await vscode.commands.executeCommand('specforged.setupMcp');
        }

        // Refresh after initialization
        specProvider.refresh();
    });

    // Create Specification Command
    const createSpecCommand = vscode.commands.registerCommand('specforged.createSpec', async () => {
        const name = await vscode.window.showInputBox({
            prompt: 'Enter specification name',
            placeHolder: 'e.g., user-authentication, payment-processing',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Specification name is required';
                }
                if (!/^[a-z0-9-]+$/.test(value.trim())) {
                    return 'Name must contain only lowercase letters, numbers, and hyphens';
                }
                return null;
            }
        });

        if (!name) {
            return;
        }

        const description = await vscode.window.showInputBox({
            prompt: 'Enter specification description (optional)',
            placeHolder: 'Brief description of what this specification covers'
        });

        try {
            await createNewSpecification(name.trim(), description?.trim() || '', specificationManager);
            vscode.window.showInformationMessage(`Specification '${name}' created successfully!`);
            specProvider.refresh();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to create specification: ${error.message}`);
        }
    });

    // Setup MCP Command
    const setupMcpCommand = vscode.commands.registerCommand('specforged.setupMcp', async () => {
        const wizard = new McpSetupWizard(mcpManager);
        await wizard.startSetup();
    });

    // Sync Specifications Command
    const syncSpecsCommand = vscode.commands.registerCommand('specforged.syncSpecs', async () => {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Syncing specifications...',
            cancellable: false
        }, async () => {
            await specificationManager.refresh();
            specProvider.refresh();
        });

        vscode.window.showInformationMessage('Specifications synced successfully!');
    });

    // Toggle Task Command
    const toggleTaskCommand = vscode.commands.registerCommand('specforged.toggleTask', async (specId: string, taskNumber: string) => {
        try {
            await toggleTaskStatus(specId, taskNumber, specificationManager);
            specProvider.refresh();

            // Show brief feedback
            const spec = specificationManager.getSpecification(specId);
            if (spec) {
                const task = spec.spec.tasks.find(t => t.task_number === taskNumber);
                if (task) {
                    const status = task.status === 'completed' ? 'completed' : 'pending';
                    const icon = status === 'completed' ? '✅' : '⬜';
                    vscode.window.showInformationMessage(`${icon} Task ${taskNumber} marked as ${status}`);
                }
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to toggle task: ${error.message}`);
        }
    });

    // Show Current Spec Command
    const showCurrentSpecCommand = vscode.commands.registerCommand('specforged.showCurrentSpec', async () => {
        const current = specificationManager.getCurrentSpecification();

        if (current) {
            const progress = TaskHelper.calculateProgress(current.spec.tasks);
            const message = `Current: ${current.spec.name} (${progress.completed}/${progress.total} tasks)`;

            vscode.window.showInformationMessage(message, 'Open Requirements', 'Open Tasks')
                .then(selection => {
                    if (selection === 'Open Requirements') {
                        vscode.commands.executeCommand('specforged.openRequirements', current.spec.id);
                    } else if (selection === 'Open Tasks') {
                        vscode.commands.executeCommand('specforged.openTasks', current.spec.id);
                    }
                });
        } else {
            const specs = specificationManager.getSpecifications();
            if (specs.length > 0) {
                vscode.window.showInformationMessage('No current specification set. Select one from the tree view.');
            } else {
                vscode.window.showInformationMessage('No specifications found. Create your first specification!', 'Create Spec')
                    .then(action => {
                        if (action === 'Create Spec') {
                            vscode.commands.executeCommand('specforged.createSpec');
                        }
                    });
            }
        }
    });

    // File Opening Commands
    const openRequirementsCommand = vscode.commands.registerCommand('specforged.openRequirements', async (specId: string) => {
        await specificationManager.openSpecificationFile(specId, 'requirements.md');
    });

    const openDesignCommand = vscode.commands.registerCommand('specforged.openDesign', async (specId: string) => {
        await specificationManager.openSpecificationFile(specId, 'design.md');
    });

    const openTasksCommand = vscode.commands.registerCommand('specforged.openTasks', async (specId: string) => {
        await specificationManager.openSpecificationFile(specId, 'tasks.md');
    });

    // Refresh Command
    const refreshCommand = vscode.commands.registerCommand('specforged.refreshSpecs', async () => {
        specProvider.refresh();
    });

    // Server Management Commands
    const switchToSmitheryCommand = vscode.commands.registerCommand('specforged.switchToSmithery', async () => {
        const config = vscode.workspace.getConfiguration('specforged');
        await config.update('mcpServerType', 'smithery', vscode.ConfigurationTarget.Workspace);

        const result = await mcpManager.initializeConnection();
        if (result.success) {
            vscode.window.showInformationMessage('Switched to Smithery server successfully!');
            statusBarManager.update();
        } else {
            vscode.window.showErrorMessage(`Failed to connect to Smithery: ${result.message}`);
        }
    });

    const switchToLocalCommand = vscode.commands.registerCommand('specforged.switchToLocal', async () => {
        const config = vscode.workspace.getConfiguration('specforged');
        await config.update('mcpServerType', 'local', vscode.ConfigurationTarget.Workspace);

        const result = await mcpManager.initializeConnection();
        if (result.success) {
            vscode.window.showInformationMessage('Switched to local server successfully!');
            statusBarManager.update();
        } else {
            vscode.window.showErrorMessage(`Failed to connect to local server: ${result.message}`);
        }
    });

    const configureServerCommand = vscode.commands.registerCommand('specforged.configureServer', async () => {
        const config = vscode.workspace.getConfiguration('specforged');
        const currentType = config.get<string>('mcpServerType', 'local');

        const serverTypes = [
            {
                label: '$(home) Local Server',
                description: 'Use locally installed SpecForged',
                detail: currentType === 'local' ? '(currently selected)' : '',
                value: 'local'
            },
            {
                label: '$(cloud) Smithery Server',
                description: 'Use cloud-hosted SpecForged on Smithery',
                detail: currentType === 'smithery' ? '(currently selected)' : '',
                value: 'smithery'
            },
            {
                label: '$(globe) Custom Server',
                description: 'Use a custom HTTP MCP server',
                detail: currentType === 'custom' ? '(currently selected)' : '',
                value: 'custom'
            }
        ];

        const selection = await vscode.window.showQuickPick(serverTypes, {
            placeHolder: 'Select MCP server type'
        });

        if (!selection) return;

        if (selection.value === 'custom') {
            const url = await vscode.window.showInputBox({
                prompt: 'Enter custom MCP server URL',
                placeholder: 'https://your-server.example.com/mcp',
                value: config.get<string>('mcpServerUrl', '')
            });

            if (!url) return;

            await config.update('mcpServerUrl', url, vscode.ConfigurationTarget.Workspace);
        } else if (selection.value === 'smithery') {
            const serverName = await vscode.window.showInputBox({
                prompt: 'Enter Smithery server name',
                placeholder: 'specforged',
                value: config.get<string>('smitheryServerName', 'specforged')
            });

            if (!serverName) return;

            await config.update('smitheryServerName', serverName, vscode.ConfigurationTarget.Workspace);
        }

        await config.update('mcpServerType', selection.value, vscode.ConfigurationTarget.Workspace);

        const result = await mcpManager.initializeConnection();
        if (result.success) {
            vscode.window.showInformationMessage(`Configured ${selection.value} server successfully!`);
            statusBarManager.update();
        } else {
            vscode.window.showErrorMessage(`Failed to connect to ${selection.value} server: ${result.message}`);
        }
    });

    const testConnectionCommand = vscode.commands.registerCommand('specforged.testConnection', async () => {
        const result = await mcpManager.initializeConnection();
        const serverStatus = await mcpManager.getServerStatus();

        if (result.success) {
            vscode.window.showInformationMessage(
                `✅ MCP ${serverStatus.type} server connection successful!\n${result.message}`,
                { modal: false }
            );
        } else {
            vscode.window.showErrorMessage(
                `❌ MCP ${serverStatus.type} server connection failed:\n${result.message}`,
                { modal: false }
            );
        }
    });

    // Register all commands
    context.subscriptions.push(
        initializeCommand,
        createSpecCommand,
        setupMcpCommand,
        switchToSmitheryCommand,
        switchToLocalCommand,
        configureServerCommand,
        testConnectionCommand,
        syncSpecsCommand,
        toggleTaskCommand,
        showCurrentSpecCommand,
        openRequirementsCommand,
        openDesignCommand,
        openTasksCommand,
        refreshCommand
    );
}

async function quickStartInitialization(
    specificationManager: SpecificationManager,
    mcpManager: McpManager
): Promise<void> {
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Quick Start Setup',
        cancellable: false
    }, async (progress) => {
        progress.report({ increment: 0, message: 'Checking SpecForged installation...' });

        const isInstalled = await mcpManager.isSpecForgedInstalled();
        if (!isInstalled) {
            progress.report({ increment: 25, message: 'Installing SpecForged...' });
            const result = await mcpManager.installSpecForged();
            if (!result.success) {
                throw new Error(result.message);
            }
        }

        progress.report({ increment: 50, message: 'Setting up MCP configuration...' });

        // Configure for VS Code by default
        await mcpManager.setupMcpForIde('vscode');

        progress.report({ increment: 75, message: 'Creating specifications directory...' });

        // Create specifications directory
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            await specificationManager.createSpecificationDirectory(workspaceFolder);
        }

        progress.report({ increment: 100, message: 'Setup complete!' });
    });

    vscode.window.showInformationMessage(
        'SpecForged Quick Start complete! You can now create your first specification.',
        'Create Specification'
    ).then(action => {
        if (action === 'Create Specification') {
            vscode.commands.executeCommand('specforged.createSpec');
        }
    });
}

async function createNewSpecification(
    name: string,
    description: string,
    specificationManager: SpecificationManager
): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        throw new Error('No workspace folder found');
    }

    const specsDir = await specificationManager.createSpecificationDirectory(workspaceFolder);
    const specDir = vscode.Uri.joinPath(specsDir, name);

    // Create specification directory
    await vscode.workspace.fs.createDirectory(specDir);

    // Create basic files
    const specJson = {
        id: name,
        name: name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
        description: description,
        status: 'draft',
        phase: 'requirements',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        user_stories: [],
        tasks: [],
        is_current: false
    };

    const requirementsMd = `# Requirements Document

## Introduction

${description}

## Requirements

Start adding user stories and EARS requirements here.

### Example User Story

**As a** user,
**I want** to [action],
**So that** [benefit]

#### Acceptance Criteria (EARS Format)

- [REQ-001] WHEN [condition] THE SYSTEM SHALL [response]
- [REQ-002] IF [error condition] THEN THE SYSTEM SHALL [error response]
`;

    const designMd = `# Technical Design

## Introduction

${description}

## System Architecture

Describe the overall architecture and design patterns.

## Components

### Component Name
Description of component functionality and responsibilities.

## Data Models

\`\`\`typescript
interface ExampleModel {
  id: string;
  name: string;
  createdAt: Date;
}
\`\`\`

## API Design

Document REST endpoints, GraphQL schemas, or other interfaces.
`;

    const tasksMd = `# Implementation Plan

## Progress Summary

- **Total Tasks:** 0
- **Completed:** 0
- **In Progress:** 0
- **Pending:** 0
- **Progress:** 0%

## Tasks

Tasks will be generated automatically once requirements and design are complete.
Use the SpecForged MCP server to generate implementation plans from your requirements.
`;

    // Write files
    await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(specDir, 'spec.json'),
        Buffer.from(JSON.stringify(specJson, null, 2))
    );

    await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(specDir, 'requirements.md'),
        Buffer.from(requirementsMd)
    );

    await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(specDir, 'design.md'),
        Buffer.from(designMd)
    );

    await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(specDir, 'tasks.md'),
        Buffer.from(tasksMd)
    );
}

async function toggleTaskStatus(
    specId: string,
    taskNumber: string,
    specificationManager: SpecificationManager
): Promise<void> {
    // This is a simplified version - in a real implementation,
    // you would integrate with the MCP server to update task status
    const spec = specificationManager.getSpecification(specId);
    if (!spec) {
        throw new Error(`Specification ${specId} not found`);
    }

    const task = spec.spec.tasks.find(t => t.task_number === taskNumber);
    if (!task) {
        throw new Error(`Task ${taskNumber} not found`);
    }

    // Toggle status
    task.status = task.status === 'completed' ? 'pending' : 'completed';
    task.actual_hours = task.status === 'completed' ? task.estimated_hours : 0;

    // For now, just refresh - in production, this would save to file
    await specificationManager.refresh();
}
