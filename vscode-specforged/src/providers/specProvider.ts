import * as vscode from 'vscode';
import { SpecificationManager } from '../utils/specificationManager';
import { ParsedSpecification, Specification, Task } from '../models/specification';
import { TaskHelper, TaskProgress } from '../models/task';

export class SpecTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly itemType: 'spec' | 'phase' | 'task' | 'empty' | 'setup',
        public readonly specId?: string,
        public readonly taskNumber?: string,
        public readonly data?: any
    ) {
        super(label, collapsibleState);

        this.contextValue = itemType;

        switch (itemType) {
            case 'spec':
                this.iconPath = new vscode.ThemeIcon('book');
                this.description = this.getSpecDescription(data as ParsedSpecification);
                break;
            case 'phase':
                this.iconPath = this.getPhaseIcon(label);
                if (data && data.progress) {
                    const progress = data.progress as TaskProgress;
                    this.description = `${progress.completed}/${progress.total} (${progress.percentage}%)`;
                }
                break;
            case 'task':
                const task = data as Task;
                this.iconPath = new vscode.ThemeIcon(TaskHelper.getStatusIcon(task.status).replace('$(', '').replace(')', ''));
                this.description = this.getTaskDescription(task);
                this.command = {
                    command: 'specforged.toggleTask',
                    title: 'Toggle Task',
                    arguments: [specId, taskNumber]
                };
                break;
            case 'empty':
                this.iconPath = new vscode.ThemeIcon('info');
                this.description = 'Click to initialize';
                this.command = {
                    command: 'specforged.initialize',
                    title: 'Initialize Project'
                };
                break;
            case 'setup':
                this.iconPath = new vscode.ThemeIcon('settings-gear');
                this.command = {
                    command: 'specforged.setupMcp',
                    title: 'Setup MCP Server'
                };
                break;
        }
    }

    private getSpecDescription(spec: ParsedSpecification): string {
        const taskProgress = TaskHelper.calculateProgress(spec.spec.tasks);
        const phaseIcon = this.getPhaseStatusIcon(spec.spec.phase);
        return `${phaseIcon} ${taskProgress.completed}/${taskProgress.total} tasks`;
    }

    private getTaskDescription(task: Task): string {
        let desc = '';
        if (task.linked_requirements.length > 0) {
            desc += `[${task.linked_requirements.join(', ')}]`;
        }
        if (task.estimated_hours > 0) {
            desc += desc ? ` • ${task.estimated_hours}h` : `${task.estimated_hours}h`;
        }
        return desc;
    }

    private getPhaseIcon(phase: string): vscode.ThemeIcon {
        switch (phase.toLowerCase()) {
            case 'requirements':
                return new vscode.ThemeIcon('list-unordered');
            case 'design':
                return new vscode.ThemeIcon('preview');
            case 'tasks':
                return new vscode.ThemeIcon('checklist');
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }

    private getPhaseStatusIcon(phase: string): string {
        switch (phase) {
            case 'requirements':
                return '📋';
            case 'design':
                return '🎨';
            case 'implementation_planning':
                return '📝';
            case 'execution':
                return '⚙️';
            case 'review':
                return '🔍';
            case 'completed':
                return '✅';
            default:
                return '⭕';
        }
    }
}

export class SpecProvider implements vscode.TreeDataProvider<SpecTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<SpecTreeItem | undefined | null | void> = new vscode.EventEmitter<SpecTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<SpecTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private specManager: SpecificationManager) {}

    refresh(): void {
        this.specManager.refresh().then(() => {
            this._onDidChangeTreeData.fire();
        });
    }

    getTreeItem(element: SpecTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: SpecTreeItem): Promise<SpecTreeItem[]> {
        if (!element) {
            // Root level - show specifications or empty state
            const specs = this.specManager.getSpecifications();

            if (specs.length === 0) {
                return [
                    new SpecTreeItem(
                        'No specifications found',
                        vscode.TreeItemCollapsibleState.None,
                        'empty'
                    ),
                    new SpecTreeItem(
                        'Setup MCP Server',
                        vscode.TreeItemCollapsibleState.None,
                        'setup'
                    )
                ];
            }

            return specs.map(spec => new SpecTreeItem(
                spec.spec.name,
                vscode.TreeItemCollapsibleState.Expanded,
                'spec',
                spec.spec.id,
                undefined,
                spec
            ));
        }

        if (element.itemType === 'spec') {
            // Show spec phases
            const spec = this.specManager.getSpecification(element.specId!);
            if (!spec) {
                return [];
            }

            const items: SpecTreeItem[] = [];

            // Requirements phase
            if (spec.files.requirements) {
                const userStories = spec.spec.user_stories.length;
                const label = `Requirements${userStories > 0 ? ` (${userStories} stories)` : ''}`;
                items.push(new SpecTreeItem(
                    label,
                    vscode.TreeItemCollapsibleState.None,
                    'phase',
                    spec.spec.id,
                    undefined,
                    { file: 'requirements.md' }
                ));
            }

            // Design phase
            if (spec.files.design) {
                items.push(new SpecTreeItem(
                    'Design',
                    vscode.TreeItemCollapsibleState.None,
                    'phase',
                    spec.spec.id,
                    undefined,
                    { file: 'design.md' }
                ));
            }

            // Tasks phase
            if (spec.files.tasks && spec.spec.tasks.length > 0) {
                const progress = TaskHelper.calculateProgress(spec.spec.tasks);
                items.push(new SpecTreeItem(
                    'Tasks',
                    vscode.TreeItemCollapsibleState.Expanded,
                    'phase',
                    spec.spec.id,
                    undefined,
                    { file: 'tasks.md', progress }
                ));
            }

            return items;
        }

        if (element.itemType === 'phase' && element.data?.file === 'tasks.md') {
            // Show tasks
            const spec = this.specManager.getSpecification(element.specId!);
            if (!spec) {
                return [];
            }

            return this.buildTaskTree(spec.spec.tasks, element.specId!);
        }

        return [];
    }

    private buildTaskTree(tasks: Task[], specId: string, parentNumber?: string): SpecTreeItem[] {
        const items: SpecTreeItem[] = [];

        // Filter tasks for current level
        const currentLevelTasks = tasks.filter(task => {
            if (!parentNumber) {
                // Root level tasks (no dots or only one number)
                return !task.task_number.includes('.') || task.task_number.split('.').length === 1;
            } else {
                // Direct children of parent
                const parentTaskNumber = TaskHelper.getParentTaskNumber(task.task_number);
                return parentTaskNumber === parentNumber;
            }
        });

        for (const task of TaskHelper.sortTasksByNumber(currentLevelTasks)) {
            // Check if this task has subtasks
            const hasSubtasks = tasks.some(t =>
                TaskHelper.isSubtaskOf(t.task_number, task.task_number)
            );

            const collapsibleState = hasSubtasks ?
                vscode.TreeItemCollapsibleState.Expanded :
                vscode.TreeItemCollapsibleState.None;

            const taskItem = new SpecTreeItem(
                `${task.task_number}. ${task.title}`,
                collapsibleState,
                'task',
                specId,
                task.task_number,
                task
            );

            items.push(taskItem);

            // Add subtasks recursively if expanded
            if (hasSubtasks) {
                const subtasks = this.buildTaskTree(tasks, specId, task.task_number);
                // We'll handle subtasks in the getChildren method for proper lazy loading
            }
        }

        return items;
    }
}
