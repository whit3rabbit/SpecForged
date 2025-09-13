import * as vscode from 'vscode';
import { ParsedSpecification } from '../models/specification';
import { SpecParser } from '../utils/specParser';
import { TaskHelper } from '../models/task';
import { LiveUpdateService, LiveUpdateEvent } from '../services/LiveUpdateService';
import { McpSyncService } from '../services/mcpSyncService';
import { McpOperation, McpOperationStatus } from '../models/mcpOperation';

export class SpecWebview {
    private panel: vscode.WebviewPanel | undefined;
    private context: vscode.ExtensionContext;
    private liveUpdateService: LiveUpdateService | undefined;
    private mcpSyncService: McpSyncService | undefined;
    private updateSubscription: vscode.Disposable | undefined;
    private currentSpec: ParsedSpecification | undefined;

    constructor(
        context: vscode.ExtensionContext,
        liveUpdateService?: LiveUpdateService,
        mcpSyncService?: McpSyncService
    ) {
        this.context = context;
        this.liveUpdateService = liveUpdateService;
        this.mcpSyncService = mcpSyncService;
    }

    async showSpecification(spec: ParsedSpecification, activeTab: string = 'requirements') {
        if (this.panel) {
            this.panel.dispose();
        }

        this.currentSpec = spec;

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

        // Set up panel disposal handling
        this.panel.onDidDispose(() => {
            this.dispose();
        });

        this.panel.webview.html = this.generateHtml(spec, activeTab);
        this.setupWebviewMessageHandling(spec);
        this.setupLiveUpdates(spec);
    }

    private setupWebviewMessageHandling(spec: ParsedSpecification) {
        if (!this.panel) {return;}

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
                    case 'syncSpec':
                        await this.handleSyncSpec(spec.spec.id);
                        break;
                    case 'refreshOperations':
                        await this.sendOperationUpdate();
                        break;
                    case 'cancelOperation':
                        if (message.operationId) {
                            await vscode.commands.executeCommand('specforged.cancelOperation', message.operationId);
                        }
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );
    }

    private setupLiveUpdates(spec: ParsedSpecification): void {
        if (!this.liveUpdateService || !this.panel) {
            return;
        }

        // Subscribe to live updates for this spec
        this.updateSubscription = this.liveUpdateService.subscribe(
            `specwebview-${spec.spec.id}`,
            async (event: LiveUpdateEvent) => {
                await this.handleLiveUpdate(event);
            },
            (event: LiveUpdateEvent) => {
                // Filter events relevant to this spec or general events
                return !event.specId || event.specId === spec.spec.id;
            }
        );

        // Send initial operation status
        this.sendOperationUpdate();
    }

    private async handleLiveUpdate(event: LiveUpdateEvent): Promise<void> {
        if (!this.panel) {
            return;
        }

        try {
            // Send the update to the webview
            await this.panel.webview.postMessage({
                command: 'liveUpdate',
                event: event
            });

            // If it's a spec update event, refresh the content
            if (event.type === 'spec_updated' && event.specId === this.currentSpec?.spec.id) {
                // Reload the spec data and refresh the webview
                // Note: This would need to be connected to the spec provider to get fresh data
                console.log('Spec updated, should refresh content');
            }

            // Update operation status for operation events
            if (event.operationId && (event.type.includes('operation_') || event.type === 'conflict_detected')) {
                await this.sendOperationUpdate();
            }

        } catch (error) {
            console.error('Error handling live update in spec webview:', error);
        }
    }

    private async sendOperationUpdate(): Promise<void> {
        if (!this.panel || !this.mcpSyncService || !this.currentSpec) {
            return;
        }

        try {
            const queue = this.mcpSyncService.getOperationQueue();
            const syncState = this.mcpSyncService.getSyncState();

            // Filter operations relevant to this spec
            const specOperations = queue.operations.filter(op => {
                const params = op.params as any;
                return params && (params.specId === this.currentSpec!.spec.id);
            });

            const operationStatus = {
                serverOnline: syncState.mcpServerOnline,
                operations: specOperations.map(op => ({
                    id: op.id,
                    type: op.type,
                    status: op.status,
                    priority: op.priority,
                    timestamp: op.timestamp,
                    progress: this.calculateOperationProgress(op),
                    description: this.getOperationDescription(op),
                    error: op.error
                })),
                lastSync: syncState.lastSync,
                hasActiveOperations: specOperations.some(op =>
                    op.status === McpOperationStatus.PENDING ||
                    op.status === McpOperationStatus.IN_PROGRESS
                )
            };

            await this.panel.webview.postMessage({
                command: 'operationUpdate',
                data: operationStatus
            });

        } catch (error) {
            console.error('Error sending operation update:', error);
        }
    }

    private async handleSyncSpec(specId: string): Promise<void> {
        try {
            // This would trigger a sync operation for the spec
            await vscode.commands.executeCommand('specforged.syncSpecs');

            // Show a notification in the webview
            if (this.panel) {
                await this.panel.webview.postMessage({
                    command: 'showNotification',
                    data: {
                        type: 'info',
                        message: 'Synchronization started...'
                    }
                });
            }
        } catch (error) {
            console.error('Error syncing spec:', error);
            if (this.panel) {
                await this.panel.webview.postMessage({
                    command: 'showNotification',
                    data: {
                        type: 'error',
                        message: 'Failed to start synchronization'
                    }
                });
            }
        }
    }

    private calculateOperationProgress(operation: McpOperation): number {
        if (operation.status === McpOperationStatus.COMPLETED) {return 100;}
        if (operation.status === McpOperationStatus.FAILED || operation.status === McpOperationStatus.CANCELLED) {return 0;}
        if (operation.status === McpOperationStatus.PENDING) {return 0;}

        if (operation.status === McpOperationStatus.IN_PROGRESS && operation.startedAt && operation.estimatedDurationMs) {
            const elapsed = Date.now() - new Date(operation.startedAt).getTime();
            return Math.min(95, (elapsed / operation.estimatedDurationMs) * 100);
        }

        return 50;
    }

    private getOperationDescription(operation: McpOperation): string {
        const typeNames: { [key: string]: string } = {
            'CREATE_SPEC': 'Creating specification',
            'UPDATE_REQUIREMENTS': 'Updating requirements',
            'UPDATE_DESIGN': 'Updating design',
            'UPDATE_TASKS': 'Updating tasks',
            'UPDATE_TASK_STATUS': 'Updating task status',
            'ADD_USER_STORY': 'Adding user story',
            'DELETE_SPEC': 'Deleting specification',
            'SET_CURRENT_SPEC': 'Setting current specification',
            'SYNC_STATUS': 'Synchronizing status',
            'HEARTBEAT': 'Heartbeat'
        };

        return typeNames[operation.type] || operation.type.replace(/_/g, ' ').toLowerCase();
    }

    private generateHtml(spec: ParsedSpecification, activeTab: string): string {
        const cssUri = this.panel?.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'styles', 'webview.css')
        );

        // Generate a random nonce for CSP
        const nonce = this.generateNonce();

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel?.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${this.panel?.webview.cspSource} data:; font-src ${this.panel?.webview.cspSource};">
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
                        <div id="mcp-status-panel" class="mcp-status-panel">
                            <div id="server-status" class="server-status">
                                <span id="server-indicator" class="status-indicator">🔄</span>
                                <span id="server-text">Checking MCP status...</span>
                            </div>
                            <div id="operations-status" class="operations-status" style="display: none;">
                                <div id="operations-list" class="operations-list"></div>
                            </div>
                            <div class="mcp-actions">
                                <button onclick="syncSpec()" class="btn btn-primary btn-sm">
                                    <span id="sync-icon">🔄</span> Sync
                                </button>
                                <button onclick="refreshOperations()" class="btn btn-secondary btn-sm">
                                    📊 Status
                                </button>
                            </div>
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

                <script nonce="${nonce}">
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

            /* MCP Status Panel Styles */
            .mcp-status-panel {
                background-color: var(--vscode-textBlockQuote-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 8px;
                padding: 12px;
                margin-top: 15px;
                display: flex;
                align-items: center;
                justify-content: space-between;
                flex-wrap: wrap;
                gap: 10px;
            }

            .server-status {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 0.9em;
            }

            .status-indicator {
                font-size: 1.2em;
                transition: all 0.3s ease;
            }

            .status-indicator.online { color: #4caf50; }
            .status-indicator.offline { color: #f44336; }
            .status-indicator.syncing {
                animation: spin 1s linear infinite;
                color: #ff9800;
            }

            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }

            .operations-status {
                flex: 1;
                margin: 0 15px;
            }

            .operations-list {
                display: flex;
                flex-direction: column;
                gap: 4px;
                max-height: 120px;
                overflow-y: auto;
            }

            .operation-item {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 4px 8px;
                background-color: var(--vscode-editor-background);
                border-radius: 4px;
                font-size: 0.8em;
                border-left: 3px solid transparent;
            }

            .operation-item.pending { border-left-color: #ffc107; }
            .operation-item.in-progress { border-left-color: #2196f3; }
            .operation-item.completed { border-left-color: #4caf50; }
            .operation-item.failed { border-left-color: #f44336; }

            .operation-icon {
                font-size: 1em;
                min-width: 16px;
            }

            .operation-description {
                flex: 1;
                truncate: ellipsis;
                overflow: hidden;
                white-space: nowrap;
            }

            .operation-progress {
                font-size: 0.7em;
                color: var(--vscode-descriptionForeground);
            }

            .operation-actions {
                display: flex;
                gap: 4px;
            }

            .mcp-actions {
                display: flex;
                gap: 8px;
            }

            .btn {
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                padding: 6px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 0.8em;
                transition: background-color 0.2s ease;
            }

            .btn:hover {
                background-color: var(--vscode-button-hoverBackground);
            }

            .btn-primary {
                background-color: var(--vscode-textLink-foreground);
                color: white;
            }

            .btn-primary:hover {
                opacity: 0.9;
            }

            .btn-secondary {
                background-color: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
            }

            .btn-secondary:hover {
                background-color: var(--vscode-button-secondaryHoverBackground);
            }

            .btn-sm {
                padding: 4px 8px;
                font-size: 0.75em;
            }

            .btn-xs {
                padding: 2px 6px;
                font-size: 0.7em;
            }

            /* Notification styles */
            .notification {
                position: fixed;
                top: 20px;
                right: 20px;
                padding: 12px 16px;
                border-radius: 4px;
                color: white;
                font-size: 0.9em;
                z-index: 1000;
                animation: slideIn 0.3s ease;
                max-width: 300px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            }

            .notification.info { background-color: #2196f3; }
            .notification.success { background-color: #4caf50; }
            .notification.warning { background-color: #ff9800; }
            .notification.error { background-color: #f44336; }

            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }

            /* Responsive adjustments */
            @media (max-width: 768px) {
                .mcp-status-panel {
                    flex-direction: column;
                    align-items: stretch;
                }

                .operations-status {
                    margin: 10px 0;
                }

                .mcp-actions {
                    justify-content: center;
                }
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
                                    <strong>[${req.id}]</strong> ${this.highlightEARS(`${req.condition} THE SYSTEM SHALL ${req.system_response}`)}
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
                                    ${task.linked_requirements.map((req: string) =>
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

    private generateNonce(): string {
        // Generate a cryptographically secure random nonce
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 32; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    private getWebviewScript(): string {
        return `
            const vscode = acquireVsCodeApi();
            let currentOperations = [];
            let serverStatus = null;

            // Message handling from extension
            window.addEventListener('message', event => {
                const message = event.data;

                switch (message.command) {
                    case 'liveUpdate':
                        handleLiveUpdate(message.event);
                        break;
                    case 'operationUpdate':
                        handleOperationUpdate(message.data);
                        break;
                    case 'showNotification':
                        showNotification(message.data.type, message.data.message);
                        break;
                }
            });

            function handleLiveUpdate(event) {
                console.log('Live update received:', event);

                // Handle different event types
                switch (event.type) {
                    case 'operation_started':
                        showNotification('info', 'Operation started: ' + (event.data.operation.description || event.data.operation.type));
                        break;
                    case 'operation_completed':
                        showNotification('success', 'Operation completed successfully');
                        break;
                    case 'operation_failed':
                        showNotification('error', 'Operation failed: ' + (event.data.notification?.message || 'Unknown error'));
                        break;
                    case 'operation_progress':
                        // Update progress indicators
                        updateOperationProgress(event.operationId, event.data);
                        break;
                    case 'sync_status_changed':
                        updateServerStatus(event.data.currentState);
                        break;
                    case 'conflict_detected':
                        showNotification('warning', 'Conflict detected: ' + event.data.notification?.message);
                        break;
                }

                // Request fresh operation data after any operation event
                if (event.type.includes('operation_') || event.type === 'sync_status_changed') {
                    refreshOperations();
                }
            }

            function handleOperationUpdate(data) {
                serverStatus = data;
                currentOperations = data.operations;

                // Update server status indicator
                updateServerStatusUI(data.serverOnline, data.lastSync);

                // Update operations list
                updateOperationsList(data.operations);

                // Show/hide operations status based on activity
                const operationsStatus = document.getElementById('operations-status');
                if (data.operations.length > 0) {
                    operationsStatus.style.display = 'block';
                } else {
                    operationsStatus.style.display = 'none';
                }
            }

            function updateServerStatusUI(online, lastSync) {
                const indicator = document.getElementById('server-indicator');
                const text = document.getElementById('server-text');

                if (online) {
                    indicator.textContent = '✅';
                    indicator.className = 'status-indicator online';
                    text.textContent = 'MCP Server Online';
                    if (lastSync) {
                        const time = new Date(lastSync);
                        const ago = getTimeAgo(time);
                        text.textContent += ' • Last sync: ' + ago;
                    }
                } else {
                    indicator.textContent = '❌';
                    indicator.className = 'status-indicator offline';
                    text.textContent = 'MCP Server Offline';
                }
            }

            function updateOperationsList(operations) {
                const list = document.getElementById('operations-list');
                list.innerHTML = '';

                if (operations.length === 0) {
                    list.innerHTML = '<div class="no-operations">No active operations</div>';
                    return;
                }

                operations.forEach(op => {
                    const item = document.createElement('div');
                    item.className = 'operation-item ' + op.status.replace('_', '-');

                    const icon = getOperationIcon(op.status);
                    const description = op.description || op.type;
                    const progress = op.progress || 0;

                    let progressHtml = '';
                    if (op.status === 'in_progress' && progress > 0) {
                        progressHtml = \`<div class="operation-progress">\${progress}%</div>\`;
                    }

                    let actionsHtml = '';
                    if (op.status === 'failed' || op.status === 'in_progress') {
                        actionsHtml = \`
                            <div class="operation-actions">
                                \${op.status === 'failed' ? '<button onclick="retryOperation(\\\"' + op.id + '\\\")" class="btn btn-xs">Retry</button>' : ''}
                                \${op.status === 'in_progress' ? '<button onclick="cancelOperation(\\\"' + op.id + '\\\")" class="btn btn-xs">Cancel</button>' : ''}
                            </div>
                        \`;
                    }

                    item.innerHTML = \`
                        <span class="operation-icon">\${icon}</span>
                        <span class="operation-description" title="\${description}">\${description}</span>
                        \${progressHtml}
                        \${actionsHtml}
                    \`;

                    list.appendChild(item);
                });
            }

            function getOperationIcon(status) {
                switch (status) {
                    case 'pending': return '⏳';
                    case 'in_progress': return '🔄';
                    case 'completed': return '✅';
                    case 'failed': return '❌';
                    case 'cancelled': return '🚫';
                    default: return '⚪';
                }
            }

            function updateOperationProgress(operationId, progressData) {
                const operations = document.querySelectorAll('.operation-item');
                operations.forEach(item => {
                    if (item.dataset.operationId === operationId) {
                        const progressEl = item.querySelector('.operation-progress');
                        if (progressEl && progressData.progress !== undefined) {
                            progressEl.textContent = progressData.progress + '%';
                        }
                    }
                });
            }

            function getTimeAgo(date) {
                const now = new Date();
                const diff = now.getTime() - date.getTime();
                const minutes = Math.floor(diff / 60000);

                if (minutes < 1) return 'just now';
                if (minutes < 60) return minutes + 'm ago';

                const hours = Math.floor(minutes / 60);
                if (hours < 24) return hours + 'h ago';

                const days = Math.floor(hours / 24);
                return days + 'd ago';
            }

            function showNotification(type, message) {
                const notification = document.createElement('div');
                notification.className = 'notification ' + type;
                notification.textContent = message;

                document.body.appendChild(notification);

                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, 4000);
            }

            // Existing functions
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

            // New MCP functions
            function syncSpec() {
                const syncIcon = document.getElementById('sync-icon');
                const serverIndicator = document.getElementById('server-indicator');

                // Show syncing state
                syncIcon.className = 'syncing';
                serverIndicator.className = 'status-indicator syncing';
                serverIndicator.textContent = '🔄';

                vscode.postMessage({
                    command: 'syncSpec'
                });
            }

            function refreshOperations() {
                vscode.postMessage({
                    command: 'refreshOperations'
                });
            }

            function cancelOperation(operationId) {
                vscode.postMessage({
                    command: 'cancelOperation',
                    operationId: operationId
                });
            }

            function retryOperation(operationId) {
                // This would need to be implemented in the extension
                vscode.postMessage({
                    command: 'retryOperation',
                    operationId: operationId
                });
            }

            // Initialize - request current status
            document.addEventListener('DOMContentLoaded', () => {
                refreshOperations();
            });
        `;
    }

    dispose(): void {
        if (this.updateSubscription) {
            this.updateSubscription.dispose();
            this.updateSubscription = undefined;
        }

        if (this.panel) {
            this.panel.dispose();
            this.panel = undefined;
        }

        this.currentSpec = undefined;
    }
}
