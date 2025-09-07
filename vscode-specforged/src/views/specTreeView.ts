import * as vscode from 'vscode';
import { SpecProvider, SpecTreeItem } from '../providers/specProvider';

export class SpecTreeView {
    private treeView: vscode.TreeView<SpecTreeItem>;

    constructor(
        private specProvider: SpecProvider,
        private context: vscode.ExtensionContext
    ) {
        this.treeView = vscode.window.createTreeView('specforged.specifications', {
            treeDataProvider: this.specProvider,
            canSelectMany: false,
            showCollapseAll: true
        });

        this.context.subscriptions.push(this.treeView);
        this.setupEventHandlers();
    }

    private setupEventHandlers() {
        // Handle tree selection
        this.treeView.onDidChangeSelection(async (e) => {
            if (e.selection.length > 0) {
                const selected = e.selection[0];
                await this.handleItemSelection(selected);
            }
        });

        // Handle tree expansion
        this.treeView.onDidExpandElement((e) => {
            console.log(`Expanded: ${e.element.label}`);
        });

        // Handle tree collapse
        this.treeView.onDidCollapseElement((e) => {
            console.log(`Collapsed: ${e.element.label}`);
        });

        // Handle visibility changes
        this.treeView.onDidChangeVisibility((e) => {
            if (e.visible) {
                this.specProvider.refresh();
            }
        });
    }

    private async handleItemSelection(item: SpecTreeItem) {
        switch (item.itemType) {
            case 'phase':
                await this.handlePhaseSelection(item);
                break;
            case 'spec':
                await this.handleSpecSelection(item);
                break;
            case 'task':
                await this.handleTaskSelection(item);
                break;
            case 'empty':
                await vscode.commands.executeCommand('specforged.initialize');
                break;
            case 'setup':
                await vscode.commands.executeCommand('specforged.setupMcp');
                break;
        }
    }

    private async handlePhaseSelection(item: SpecTreeItem) {
        if (!item.specId || !item.data?.file) {
            return;
        }

        try {
            // Open the corresponding file
            const fileName = item.data.file;
            const command = this.getOpenCommand(fileName);

            if (command) {
                await vscode.commands.executeCommand(command, item.specId, fileName);
            }
        } catch (error) {
            console.error('Error handling phase selection:', error);
            vscode.window.showErrorMessage(`Failed to open ${item.data.file}`);
        }
    }

    private async handleSpecSelection(item: SpecTreeItem) {
        if (!item.specId) {
            return;
        }

        // Show spec overview or expand/collapse
        const message = `Selected specification: ${item.label}`;
        vscode.window.showInformationMessage(message, 'Open Requirements', 'Open Design', 'Open Tasks')
            .then(selection => {
                if (selection && item.specId) {
                    switch (selection) {
                        case 'Open Requirements':
                            vscode.commands.executeCommand('specforged.openRequirements', item.specId);
                            break;
                        case 'Open Design':
                            vscode.commands.executeCommand('specforged.openDesign', item.specId);
                            break;
                        case 'Open Tasks':
                            vscode.commands.executeCommand('specforged.openTasks', item.specId);
                            break;
                    }
                }
            });
    }

    private async handleTaskSelection(item: SpecTreeItem) {
        if (!item.specId || !item.taskNumber) {
            return;
        }

        // Show task details
        const task = item.data;
        const message = `Task ${item.taskNumber}: ${task.title}`;
        const status = task.status;
        const toggleAction = status === 'completed' ? 'Mark Pending' : 'Mark Completed';

        vscode.window.showInformationMessage(
            message,
            toggleAction,
            'View Details'
        ).then(selection => {
            if (selection === toggleAction && item.specId && item.taskNumber) {
                vscode.commands.executeCommand('specforged.toggleTask', item.specId, item.taskNumber);
            } else if (selection === 'View Details') {
                this.showTaskDetails(task);
            }
        });
    }

    private showTaskDetails(task: any) {
        const panel = vscode.window.createWebviewPanel(
            'taskDetails',
            `Task ${task.task_number}: ${task.title}`,
            vscode.ViewColumn.Two,
            {
                enableScripts: false,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = this.getTaskDetailsHtml(task);
    }

    private getTaskDetailsHtml(task: any): string {
        const statusIcon = task.status === 'completed' ? '✅' :
                          task.status === 'in_progress' ? '⚙️' : '⭕';

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Task Details</title>
                <style>
                    body {
                        font-family: var(--vscode-font-family);
                        color: var(--vscode-foreground);
                        background-color: var(--vscode-editor-background);
                        padding: 20px;
                        line-height: 1.6;
                    }
                    .header {
                        border-bottom: 1px solid var(--vscode-panel-border);
                        padding-bottom: 15px;
                        margin-bottom: 20px;
                    }
                    .task-number {
                        font-size: 0.9em;
                        color: var(--vscode-descriptionForeground);
                    }
                    .task-title {
                        font-size: 1.4em;
                        font-weight: bold;
                        margin: 5px 0;
                    }
                    .status {
                        display: inline-block;
                        padding: 4px 8px;
                        border-radius: 4px;
                        font-size: 0.8em;
                        font-weight: bold;
                        text-transform: uppercase;
                    }
                    .status.completed { background-color: #28a745; color: white; }
                    .status.in_progress { background-color: #ffc107; color: black; }
                    .status.pending { background-color: #6c757d; color: white; }
                    .section {
                        margin: 20px 0;
                    }
                    .section h3 {
                        margin-bottom: 10px;
                        color: var(--vscode-textLink-foreground);
                    }
                    .requirements {
                        display: flex;
                        gap: 5px;
                        flex-wrap: wrap;
                    }
                    .requirement-tag {
                        background-color: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground);
                        padding: 2px 6px;
                        border-radius: 3px;
                        font-size: 0.8em;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="task-number">Task ${task.task_number}</div>
                    <div class="task-title">${statusIcon} ${task.title}</div>
                    <span class="status ${task.status}">${task.status.replace('_', ' ')}</span>
                </div>

                ${task.description ? `
                <div class="section">
                    <h3>Description</h3>
                    <p>${task.description}</p>
                </div>
                ` : ''}

                ${task.linked_requirements.length > 0 ? `
                <div class="section">
                    <h3>Linked Requirements</h3>
                    <div class="requirements">
                        ${task.linked_requirements.map((req: string) =>
                            `<span class="requirement-tag">${req}</span>`
                        ).join('')}
                    </div>
                </div>
                ` : ''}

                ${task.dependencies.length > 0 ? `
                <div class="section">
                    <h3>Dependencies</h3>
                    <ul>
                        ${task.dependencies.map((dep: string) =>
                            `<li>${dep}</li>`
                        ).join('')}
                    </ul>
                </div>
                ` : ''}

                ${task.estimated_hours > 0 || task.actual_hours > 0 ? `
                <div class="section">
                    <h3>Time Tracking</h3>
                    <p>Estimated: ${task.estimated_hours} hours</p>
                    <p>Actual: ${task.actual_hours} hours</p>
                </div>
                ` : ''}
            </body>
            </html>
        `;
    }

    private getOpenCommand(fileName: string): string | undefined {
        switch (fileName) {
            case 'requirements.md':
                return 'specforged.openRequirements';
            case 'design.md':
                return 'specforged.openDesign';
            case 'tasks.md':
                return 'specforged.openTasks';
            default:
                return undefined;
        }
    }

    reveal(item: SpecTreeItem): void {
        this.treeView.reveal(item, { focus: true, select: true });
    }

    getSelection(): readonly SpecTreeItem[] {
        return this.treeView.selection;
    }

    dispose(): void {
        this.treeView.dispose();
    }
}
