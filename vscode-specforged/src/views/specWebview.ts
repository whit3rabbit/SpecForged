import * as vscode from 'vscode';
import { ParsedSpecification } from '../models/specification';
import { SpecParser } from '../utils/specParser';
import { TaskHelper } from '../models/task';

export class SpecWebview {
    private panel: vscode.WebviewPanel | undefined;
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    async showSpecification(spec: ParsedSpecification, activeTab: string = 'requirements') {
        if (this.panel) {
            this.panel.dispose();
        }

        this.panel = vscode.window.createWebviewPanel(
            'specforged.webview',
            `SpecForged: ${spec.spec.name}`,
            vscode.ViewColumn.Two,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context.extensionUri, 'resources')
                ]
            }
        );

        this.panel.webview.html = this.generateHtml(spec, activeTab);
        this.setupWebviewMessageHandling(spec);
    }

    private setupWebviewMessageHandling(spec: ParsedSpecification) {
        if (!this.panel) return;

        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'toggleTask':
                        await vscode.commands.executeCommand('specforged.toggleTask', spec.spec.id, message.taskNumber);
                        // Refresh webview
                        if (this.panel) {
                            this.panel.webview.html = this.generateHtml(spec, message.activeTab || 'tasks');
                        }
                        break;
                    case 'openFile':
                        await vscode.commands.executeCommand(`specforged.open${message.fileType}`, spec.spec.id);
                        break;
                    case 'switchTab':
                        if (this.panel) {
                            this.panel.webview.html = this.generateHtml(spec, message.tab);
                        }
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );
    }

    private generateHtml(spec: ParsedSpecification, activeTab: string): string {
        const cssUri = this.panel?.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'styles', 'webview.css')
        );

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>SpecForged: ${spec.spec.name}</title>
                <link href="${cssUri}" rel="stylesheet">
                <style>
                    ${this.getInlineStyles()}
                </style>
            </head>
            <body>
                <div class="container">
                    <header class="spec-header">
                        <h1>${spec.spec.name}</h1>
                        <div class="spec-meta">
                            <span class="status status-${spec.spec.status}">${spec.spec.status.toUpperCase()}</span>
                            <span class="phase">Phase: ${this.formatPhase(spec.spec.phase)}</span>
                            <span class="progress">${this.getProgressBadge(spec)}</span>
                        </div>
                    </header>

                    <nav class="tab-nav">
                        <button class="tab-button ${activeTab === 'requirements' ? 'active' : ''}"
                                onclick="switchTab('requirements')">
                            📋 Requirements
                        </button>
                        <button class="tab-button ${activeTab === 'design' ? 'active' : ''}"
                                onclick="switchTab('design')">
                            🎨 Design
                        </button>
                        <button class="tab-button ${activeTab === 'tasks' ? 'active' : ''}"
                                onclick="switchTab('tasks')">
                            ✅ Tasks ${this.getTasksBadge(spec)}
                        </button>
                    </nav>

                    <main class="content">
                        ${this.renderTabContent(spec, activeTab)}
                    </main>
                </div>

                <script>
                    ${this.getWebviewScript()}
                </script>
            </body>
            </html>
        `;
    }

    private getInlineStyles(): string {
        return `
            body {
                font-family: var(--vscode-font-family);
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
                margin: 0;
                padding: 0;
                line-height: 1.6;
            }

            .container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 20px;
            }

            .spec-header {
                border-bottom: 2px solid var(--vscode-panel-border);
                padding-bottom: 20px;
                margin-bottom: 20px;
            }

            .spec-header h1 {
                margin: 0 0 10px 0;
                font-size: 2em;
                color: var(--vscode-textLink-foreground);
            }

            .spec-meta {
                display: flex;
                gap: 15px;
                align-items: center;
                flex-wrap: wrap;
            }

            .status {
                padding: 4px 12px;
                border-radius: 20px;
                font-size: 0.8em;
                font-weight: bold;
                text-transform: uppercase;
            }

            .status-draft { background-color: #6c757d; color: white; }
            .status-in_review { background-color: #ffc107; color: black; }
            .status-approved { background-color: #17a2b8; color: white; }
            .status-in_progress { background-color: #fd7e14; color: white; }
            .status-completed { background-color: #28a745; color: white; }

            .phase {
                color: var(--vscode-descriptionForeground);
                font-size: 0.9em;
            }

            .progress {
                background-color: var(--vscode-badge-background);
                color: var(--vscode-badge-foreground);
                padding: 4px 8px;
                border-radius: 12px;
                font-size: 0.8em;
            }

            .tab-nav {
                display: flex;
                gap: 2px;
                margin-bottom: 20px;
                border-bottom: 1px solid var(--vscode-panel-border);
            }

            .tab-button {
                background: transparent;
                border: none;
                color: var(--vscode-foreground);
                padding: 10px 16px;
                cursor: pointer;
                border-bottom: 2px solid transparent;
                font-size: 0.9em;
                transition: all 0.2s ease;
            }

            .tab-button:hover {
                background-color: var(--vscode-list-hoverBackground);
            }

            .tab-button.active {
                border-bottom-color: var(--vscode-textLink-foreground);
                color: var(--vscode-textLink-foreground);
            }

            .content {
                min-height: 400px;
            }

            .ears-requirement {
                background-color: var(--vscode-textBlockQuote-background);
                border-left: 4px solid var(--vscode-textLink-foreground);
                padding: 12px 16px;
                margin: 8px 0;
                border-radius: 0 4px 4px 0;
            }

            .ears-keyword {
                font-weight: bold;
                color: var(--vscode-debugTokenExpression-name);
            }

            .task-item {
                display: flex;
                align-items: flex-start;
                gap: 8px;
                padding: 8px 0;
                border-bottom: 1px solid var(--vscode-list-dropBackground);
            }

            .task-checkbox {
                margin-top: 2px;
                cursor: pointer;
                font-size: 1.2em;
            }

            .task-content {
                flex: 1;
            }

            .task-title {
                font-weight: 500;
                margin-bottom: 4px;
            }

            .task-description {
                color: var(--vscode-descriptionForeground);
                font-size: 0.9em;
            }

            .task-meta {
                display: flex;
                gap: 10px;
                margin-top: 4px;
                font-size: 0.8em;
                color: var(--vscode-descriptionForeground);
            }

            .requirement-tag {
                background-color: var(--vscode-badge-background);
                color: var(--vscode-badge-foreground);
                padding: 2px 6px;
                border-radius: 3px;
                font-size: 0.7em;
            }

            .task-completed {
                opacity: 0.7;
                text-decoration: line-through;
            }

            .progress-bar {
                width: 100%;
                height: 8px;
                background-color: var(--vscode-progressBar-background);
                border-radius: 4px;
                overflow: hidden;
                margin: 10px 0;
            }

            .progress-fill {
                height: 100%;
                background-color: var(--vscode-progressBar-foreground);
                transition: width 0.3s ease;
            }

            pre {
                background-color: var(--vscode-textBlockQuote-background);
                padding: 16px;
                border-radius: 4px;
                overflow-x: auto;
                border-left: 4px solid var(--vscode-textLink-foreground);
            }

            code {
                background-color: var(--vscode-textPreformat-background);
                padding: 2px 4px;
                border-radius: 3px;
                font-family: var(--vscode-editor-font-family);
            }
        `;
    }

    private renderTabContent(spec: ParsedSpecification, activeTab: string): string {
        switch (activeTab) {
            case 'requirements':
                return this.renderRequirementsTab(spec);
            case 'design':
                return this.renderDesignTab(spec);
            case 'tasks':
                return this.renderTasksTab(spec);
            default:
                return '<p>Tab not found</p>';
        }
    }

    private renderRequirementsTab(spec: ParsedSpecification): string {
        const requirements = spec.files.requirements?.content || '';

        if (!requirements.trim()) {
            return `
                <div class="empty-state">
                    <h3>No Requirements Found</h3>
                    <p>Start by adding user stories and EARS requirements to define what your system should do.</p>
                    <button onclick="openFile('Requirements')" class="btn btn-primary">Open Requirements File</button>
                </div>
            `;
        }

        // Parse EARS requirements from content
        const earsRequirements = SpecParser.extractEARSRequirements(requirements);

        let html = `
            <div class="requirements-content">
                <div class="toolbar">
                    <button onclick="openFile('Requirements')" class="btn">📝 Edit Requirements</button>
                </div>
        `;

        // Render user stories
        if (spec.spec.user_stories.length > 0) {
            html += '<h2>User Stories</h2>';
            for (const story of spec.spec.user_stories) {
                html += `
                    <div class="user-story">
                        <h3>${story.id}</h3>
                        <p><strong>As a</strong> ${story.as_a}, <strong>I want</strong> ${story.i_want}, <strong>so that</strong> ${story.so_that}</p>
                        ${story.requirements.length > 0 ? `
                            <h4>Acceptance Criteria</h4>
                            ${story.requirements.map(req => `
                                <div class="ears-requirement">
                                    <strong>[${req.id}]</strong> ${this.highlightEARS(req.to_ears_string())}
                                </div>
                            `).join('')}
                        ` : ''}
                    </div>
                `;
            }
        }

        // Render EARS requirements found in markdown
        if (earsRequirements.length > 0) {
            html += '<h2>EARS Requirements</h2>';
            for (const req of earsRequirements) {
                html += `<div class="ears-requirement">${this.highlightEARS(req.requirement)}</div>`;
            }
        }

        html += '</div>';
        return html;
    }

    private renderDesignTab(spec: ParsedSpecification): string {
        const design = spec.files.design?.content || '';

        if (!design.trim()) {
            return `
                <div class="empty-state">
                    <h3>No Design Documentation</h3>
                    <p>Document your system architecture, components, and technical decisions.</p>
                    <button onclick="openFile('Design')" class="btn btn-primary">Open Design File</button>
                </div>
            `;
        }

        return `
            <div class="design-content">
                <div class="toolbar">
                    <button onclick="openFile('Design')" class="btn">🎨 Edit Design</button>
                </div>
                <div class="markdown-content">
                    ${this.convertMarkdownToHtml(design)}
                </div>
            </div>
        `;
    }

    private renderTasksTab(spec: ParsedSpecification): string {
        if (spec.spec.tasks.length === 0) {
            return `
                <div class="empty-state">
                    <h3>No Tasks Defined</h3>
                    <p>Implementation tasks will appear here once you complete the requirements and design phases.</p>
                    <button onclick="openFile('Tasks')" class="btn btn-primary">Open Tasks File</button>
                </div>
            `;
        }

        const progress = TaskHelper.calculateProgress(spec.spec.tasks);
        const sortedTasks = TaskHelper.sortTasksByNumber(spec.spec.tasks);

        let html = `
            <div class="tasks-content">
                <div class="tasks-header">
                    <div class="progress-summary">
                        <h3>Progress Summary</h3>
                        <div class="progress-stats">
                            <span>Total: ${progress.total}</span>
                            <span>Completed: ${progress.completed}</span>
                            <span>In Progress: ${progress.in_progress}</span>
                            <span>Pending: ${progress.pending}</span>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${progress.percentage}%"></div>
                        </div>
                        <div class="progress-text">${progress.percentage}% Complete</div>
                    </div>
                    <div class="toolbar">
                        <button onclick="openFile('Tasks')" class="btn">📝 Edit Tasks</button>
                    </div>
                </div>

                <div class="tasks-list">
        `;

        for (const task of sortedTasks) {
            const isCompleted = task.status === 'completed';
            const checkbox = isCompleted ? '☑️' : '⬜';

            html += `
                <div class="task-item ${isCompleted ? 'task-completed' : ''}">
                    <span class="task-checkbox" onclick="toggleTask('${task.task_number}')">${checkbox}</span>
                    <div class="task-content">
                        <div class="task-title">${task.task_number}. ${task.title}</div>
                        ${task.description ? `<div class="task-description">${task.description}</div>` : ''}
                        <div class="task-meta">
                            ${task.linked_requirements.length > 0 ? `
                                <div class="task-requirements">
                                    ${task.linked_requirements.map(req =>
                                        `<span class="requirement-tag">${req}</span>`
                                    ).join('')}
                                </div>
                            ` : ''}
                            ${task.estimated_hours > 0 ? `<span>Est: ${task.estimated_hours}h</span>` : ''}
                            ${task.actual_hours > 0 ? `<span>Actual: ${task.actual_hours}h</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        }

        html += `
                </div>
            </div>
        `;

        return html;
    }

    private highlightEARS(text: string): string {
        const keywords = ['WHEN', 'WHILE', 'WHERE', 'IF', 'THE SYSTEM SHALL', 'THEN THE SYSTEM SHALL'];
        let highlighted = text;

        for (const keyword of keywords) {
            const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
            highlighted = highlighted.replace(regex, `<span class="ears-keyword">${keyword}</span>`);
        }

        return highlighted;
    }

    private convertMarkdownToHtml(markdown: string): string {
        // Basic markdown conversion - in production, use a proper markdown parser
        let html = markdown;

        // Headers
        html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
        html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
        html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

        // Code blocks
        html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

        // Inline code
        html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

        // Bold
        html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

        // Lists
        html = html.replace(/^\* (.+)$/gm, '<li>$1</li>');
        html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

        // Paragraphs
        html = html.replace(/\n\n/g, '</p><p>');
        html = '<p>' + html + '</p>';

        return html;
    }

    private formatPhase(phase: string): string {
        return phase.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    private getProgressBadge(spec: ParsedSpecification): string {
        const progress = TaskHelper.calculateProgress(spec.spec.tasks);
        return `${progress.completed}/${progress.total} tasks (${progress.percentage}%)`;
    }

    private getTasksBadge(spec: ParsedSpecification): string {
        const progress = TaskHelper.calculateProgress(spec.spec.tasks);
        return `(${progress.completed}/${progress.total})`;
    }

    private getWebviewScript(): string {
        return `
            const vscode = acquireVsCodeApi();

            function switchTab(tab) {
                vscode.postMessage({
                    command: 'switchTab',
                    tab: tab
                });
            }

            function toggleTask(taskNumber) {
                vscode.postMessage({
                    command: 'toggleTask',
                    taskNumber: taskNumber,
                    activeTab: 'tasks'
                });
            }

            function openFile(fileType) {
                vscode.postMessage({
                    command: 'openFile',
                    fileType: fileType
                });
            }
        `;
    }

    dispose(): void {
        if (this.panel) {
            this.panel.dispose();
        }
    }
}
