import * as vscode from 'vscode';
import { McpManager, IdeConfig } from './mcpManager';

export class McpSetupWizard {
    constructor(private mcpManager: McpManager) {}

    async startSetup(): Promise<void> {
        const setupChoice = await vscode.window.showQuickPick([
            {
                label: '$(rocket) Quick Setup',
                description: 'Install SpecForged and configure for detected IDEs',
                detail: 'Recommended for first-time users'
            },
            {
                label: '$(gear) Custom Setup',
                description: 'Choose specific IDEs and configuration options',
                detail: 'Advanced configuration'
            },
            {
                label: '$(info) Check Status',
                description: 'View current installation and configuration status',
                detail: 'Diagnostic information'
            }
        ], {
            placeHolder: 'Choose setup type',
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (!setupChoice) {
            return;
        }

        switch (setupChoice.label) {
            case '$(rocket) Quick Setup':
                await this.runQuickSetup();
                break;
            case '$(gear) Custom Setup':
                await this.runCustomSetup();
                break;
            case '$(info) Check Status':
                await this.showStatus();
                break;
        }
    }

    private async runQuickSetup(): Promise<void> {
        const progress = await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Setting up SpecForged MCP',
            cancellable: false
        }, async (progress, token) => {
            progress.report({ increment: 0, message: 'Checking installation...' });

            // Check if SpecForged is installed
            const isInstalled = await this.mcpManager.isSpecForgedInstalled();

            if (!isInstalled) {
                progress.report({ increment: 20, message: 'Installing SpecForged...' });

                const installResult = await this.mcpManager.installSpecForged();
                if (!installResult.success) {
                    vscode.window.showErrorMessage(installResult.message);
                    return false;
                }

                vscode.window.showInformationMessage(installResult.message);
            }

            progress.report({ increment: 50, message: 'Detecting IDEs...' });

            // Detect and configure installed IDEs
            await this.mcpManager.detectExistingConfigs();
            const installedIdes = this.mcpManager.getInstalledIdes();

            let configuredCount = 0;
            const ideCount = installedIdes.length;

            for (const ide of installedIdes) {
                progress.report({
                    increment: 50 / ideCount,
                    message: `Configuring ${ide.name}...`
                });

                const ideKey = Object.keys(this.mcpManager['supportedIdes'])
                    .find(key => this.mcpManager['supportedIdes'][key].name === ide.name);

                if (ideKey) {
                    const result = await this.mcpManager.setupMcpForIde(ideKey);
                    if (result.success) {
                        configuredCount++;
                    }
                }
            }

            progress.report({ increment: 100, message: 'Setup complete!' });

            // Show summary
            const message = `SpecForged setup complete! Configured ${configuredCount}/${ideCount} detected IDEs.`;
            vscode.window.showInformationMessage(message, 'View Details').then(action => {
                if (action === 'View Details') {
                    this.showStatus();
                }
            });

            return true;
        });
    }

    private async runCustomSetup(): Promise<void> {
        const setupOptions = await vscode.window.showQuickPick([
            {
                label: '$(package) Install/Update SpecForged',
                description: 'Install or update the SpecForged MCP server'
            },
            {
                label: '$(settings-gear) Configure IDE',
                description: 'Set up MCP for a specific IDE'
            },
            {
                label: '$(file) Create Project Config',
                description: 'Create .mcp.json in current project'
            }
        ], {
            placeHolder: 'Choose custom setup option'
        });

        if (!setupOptions) {
            return;
        }

        switch (setupOptions.label) {
            case '$(package) Install/Update SpecForged':
                await this.handleInstallation();
                break;
            case '$(settings-gear) Configure IDE':
                await this.handleIdeConfiguration();
                break;
            case '$(file) Create Project Config':
                await this.handleProjectConfiguration();
                break;
        }
    }

    private async handleInstallation(): Promise<void> {
        const isInstalled = await this.mcpManager.isSpecForgedInstalled();

        const action = await vscode.window.showInformationMessage(
            isInstalled
                ? 'SpecForged is already installed. Would you like to update it?'
                : 'SpecForged is not installed. Would you like to install it?',
            isInstalled ? 'Update' : 'Install',
            'Cancel'
        );

        if (action === 'Install' || action === 'Update') {
            const result = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `${action}ing SpecForged...`,
                cancellable: false
            }, async () => {
                return await this.mcpManager.installSpecForged();
            });

            if (result.success) {
                vscode.window.showInformationMessage(result.message);
            } else {
                vscode.window.showErrorMessage(result.message);
            }
        }
    }

    private async handleIdeConfiguration(): Promise<void> {
        const availableIdes = this.mcpManager.getAvailableIdes();

        const ideItems = availableIdes.map(ide => ({
            label: `${ide.installed ? '$(check)' : '$(x)'} ${ide.name}`,
            description: ide.detected ? 'Already configured' : 'Not configured',
            detail: ide.installed ? 'Installed' : 'Not installed',
            ide: ide
        }));

        const selectedIde = await vscode.window.showQuickPick(ideItems, {
            placeHolder: 'Select IDE to configure'
        });

        if (!selectedIde) {
            return;
        }

        if (!selectedIde.ide.installed) {
            vscode.window.showWarningMessage(
                `${selectedIde.ide.name} is not installed. Please install it first.`
            );
            return;
        }

        const ideKey = Object.keys(this.mcpManager['supportedIdes'])
            .find(key => this.mcpManager['supportedIdes'][key].name === selectedIde.ide.name);

        if (ideKey) {
            const result = await this.mcpManager.setupMcpForIde(ideKey);

            if (result.success) {
                vscode.window.showInformationMessage(result.message);
            } else {
                vscode.window.showErrorMessage(result.message);
            }
        }
    }

    private async handleProjectConfiguration(): Promise<void> {
        const result = await this.mcpManager.createProjectMcpConfig();

        if (result.success) {
            const message = `${result.message} at ${result.path}`;
            vscode.window.showInformationMessage(message, 'Open Config').then(action => {
                if (action === 'Open Config' && result.path) {
                    vscode.workspace.openTextDocument(result.path).then(doc => {
                        vscode.window.showTextDocument(doc);
                    });
                }
            });
        } else {
            vscode.window.showErrorMessage(result.message);
        }
    }

    private async showStatus(): Promise<void> {
        const isSpecForgedInstalled = await this.mcpManager.isSpecForgedInstalled();
        const availableIdes = this.mcpManager.getAvailableIdes();
        const installedIdes = availableIdes.filter(ide => ide.installed);
        const configuredIdes = availableIdes.filter(ide => ide.detected);

        const statusItems = [
            `## SpecForged Status`,
            ``,
            `**Installation:** ${isSpecForgedInstalled ? '✅ Installed' : '❌ Not Installed'}`,
            `**Installed IDEs:** ${installedIdes.length}/${availableIdes.length}`,
            `**Configured IDEs:** ${configuredIdes.length}/${installedIdes.length}`,
            ``,
            `### IDE Status`,
            ``
        ];

        for (const ide of availableIdes) {
            const installIcon = ide.installed ? '✅' : '❌';
            const configIcon = ide.detected ? '⚙️' : '⭕';
            statusItems.push(`- ${installIcon} ${configIcon} ${ide.name}`);
        }

        statusItems.push(
            ``,
            `### Legend`,
            `✅ Installed/Configured  ❌ Not Installed  ⚙️ Configured  ⭕ Not Configured`,
            ``,
            `### Next Steps`,
            ``
        );

        if (!isSpecForgedInstalled) {
            statusItems.push(`- Install SpecForged: \`pipx install specforged\``);
        }

        if (installedIdes.length > configuredIdes.length) {
            statusItems.push(`- Configure MCP for installed IDEs`);
        }

        const statusContent = statusItems.join('\n');

        // Create a new document to show the status
        const doc = await vscode.workspace.openTextDocument({
            content: statusContent,
            language: 'markdown'
        });

        await vscode.window.showTextDocument(doc, {
            viewColumn: vscode.ViewColumn.Beside,
            preview: true
        });
    }
}
