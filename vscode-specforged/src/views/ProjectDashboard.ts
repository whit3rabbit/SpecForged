import * as vscode from 'vscode';
import { ParsedSpecification } from '../models/specification';
import { SpecificationManager } from '../utils/specificationManager';
import { LiveUpdateService, LiveUpdateEvent } from '../services/LiveUpdateService';
import { McpSyncService } from '../services/mcpSyncService';
import { ConflictResolver } from '../utils/conflictResolver';
import { NotificationManager } from '../services/notificationManager';
import { McpOperation, McpOperationStatus, McpOperationPriority, McpOperationType } from '../models/mcpOperation';
import { TaskHelper } from '../models/task';

export interface DashboardViewState {
    selectedSpecId?: string;
    activeSection: 'overview' | 'operations' | 'conflicts' | 'timeline' | 'settings';
    showCompletedOperations: boolean;
    operationFilter: 'all' | 'pending' | 'in_progress' | 'failed';
    timelineRange: '1h' | '6h' | '24h' | '7d';
}

export class ProjectDashboard {
    private panel: vscode.WebviewPanel | undefined;
    private viewState: DashboardViewState = {
        activeSection: 'overview',
        showCompletedOperations: false,
        operationFilter: 'all',
        timelineRange: '24h'
    };
    private updateSubscription: vscode.Disposable | undefined;
    private refreshTimer: NodeJS.Timeout | undefined;

    constructor(
        private context: vscode.ExtensionContext,
        private specificationManager: SpecificationManager,
        private liveUpdateService: LiveUpdateService,
        private mcpSyncService: McpSyncService,
        private conflictResolver: ConflictResolver,
        private notificationManager: NotificationManager
    ) {}

    public async show(specId?: string): Promise<void> {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
            if (specId && specId !== this.viewState.selectedSpecId) {
                this.viewState.selectedSpecId = specId;
                await this.updateContent();
            }
            return;
        }

        this.viewState.selectedSpecId = specId;

        this.panel = vscode.window.createWebviewPanel(
            'specforged.projectDashboard',
            'SpecForged Project Dashboard',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context.extensionUri, 'resources')
                ]
            }
        );

        this.panel.iconPath = {
            light: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'dashboard-light.svg'),
            dark: vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'dashboard-dark.svg')
        };

        this.panel.onDidDispose(() => {
            this.dispose();
        });

        this.setupMessageHandling();
        this.setupLiveUpdates();
        await this.updateContent();
        this.startAutoRefresh();
    }

    private setupMessageHandling(): void {
        if (!this.panel) {return;}

        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                try {
                    await this.handleMessage(message);
                } catch (error) {
                    console.error('Error handling dashboard message:', error);
                    await this.sendMessage({
                        command: 'showNotification',
                        data: {
                            type: 'error',
                            message: 'An error occurred while processing your request.'
                        }
                    });
                }
            },
            undefined,
            this.context.subscriptions
        );
    }

    private async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'changeSection':
                this.viewState.activeSection = message.section;
                await this.updateContent();
                break;

            case 'selectSpec':
                this.viewState.selectedSpecId = message.specId;
                await this.updateContent();
                break;

            case 'filterOperations':
                this.viewState.operationFilter = message.filter;
                await this.sendOperationsUpdate();
                break;

            case 'toggleCompletedOperations':
                this.viewState.showCompletedOperations = message.show;
                await this.sendOperationsUpdate();
                break;

            case 'setTimelineRange':
                this.viewState.timelineRange = message.range;
                await this.sendTimelineUpdate();
                break;

            case 'syncSpec':
                if (this.viewState.selectedSpecId) {
                    await vscode.commands.executeCommand('specforged.syncSpecs');
                }
                break;

            case 'syncAllSpecs':
                await vscode.commands.executeCommand('specforged.syncSpecs');
                break;

            case 'cancelOperation':
                await vscode.commands.executeCommand('specforged.cancelOperation', message.operationId);
                break;

            case 'retryOperation':
                await vscode.commands.executeCommand('specforged.retryFailedOperations');
                break;

            case 'resolveConflict':
                await vscode.commands.executeCommand('specforged.resolveConflict', message.conflictId);
                break;

            case 'autoResolveConflicts':
                await vscode.commands.executeCommand('specforged.autoResolveConflicts');
                break;

            case 'openSpecFile':
                if (message.specId && message.fileType) {
                    await vscode.commands.executeCommand(`specforged.open${message.fileType}`, message.specId);
                }
                break;

            case 'createSpec':
                await vscode.commands.executeCommand('specforged.createSpec');
                break;

            case 'toggleTask':
                if (message.specId && message.taskNumber !== undefined) {
                    await vscode.commands.executeCommand('specforged.toggleTask', message.specId, message.taskNumber);
                }
                break;

            case 'refreshData':
                await this.updateContent();
                break;

            case 'exportData':
                await this.handleExportData(message.type);
                break;
        }
    }

    private setupLiveUpdates(): void {
        if (!this.liveUpdateService) {return;}

        this.updateSubscription = this.liveUpdateService.subscribe(
            'project-dashboard',
            async (event: LiveUpdateEvent) => {
                await this.handleLiveUpdate(event);
            }
        );
    }

    private async handleLiveUpdate(event: LiveUpdateEvent): Promise<void> {
        if (!this.panel) {return;}

        // Send the event to the webview for real-time UI updates
        await this.sendMessage({
            command: 'liveUpdate',
            event: event
        });

        // Update relevant sections based on event type
        switch (event.type) {
            case 'operation_started':
            case 'operation_completed':
            case 'operation_failed':
            case 'operation_progress':
                await this.sendOperationsUpdate();
                if (this.viewState.activeSection === 'timeline') {
                    await this.sendTimelineUpdate();
                }
                break;

            case 'conflict_detected':
            case 'conflict_resolved':
                await this.sendConflictsUpdate();
                if (this.viewState.activeSection === 'timeline') {
                    await this.sendTimelineUpdate();
                }
                break;

            case 'sync_status_changed':
                await this.sendSyncStatusUpdate();
                break;

            case 'spec_updated':
                if (!event.specId || event.specId === this.viewState.selectedSpecId) {
                    await this.sendSpecOverviewUpdate();
                }
                break;
        }
    }

    private startAutoRefresh(): void {
        // Refresh every 10 seconds when visible
        this.refreshTimer = setInterval(async () => {
            if (this.panel?.visible) {
                await this.sendOperationsUpdate();
                await this.sendSyncStatusUpdate();
            }
        }, 10000);
    }

    private async updateContent(): Promise<void> {
        if (!this.panel) {return;}

        const html = await this.generateHtml();
        this.panel.webview.html = html;

        // Send initial data
        await this.sendAllData();
    }

    private async sendAllData(): Promise<void> {
        await Promise.all([
            this.sendSpecsData(),
            this.sendSpecOverviewUpdate(),
            this.sendOperationsUpdate(),
            this.sendConflictsUpdate(),
            this.sendTimelineUpdate(),
            this.sendSyncStatusUpdate(),
            this.sendViewState()
        ]);
    }

    private async sendMessage(message: any): Promise<void> {
        if (this.panel) {
            await this.panel.webview.postMessage(message);
        }
    }

    private async sendSpecsData(): Promise<void> {
        const specs = this.specificationManager.getSpecifications();
        const currentSpec = this.specificationManager.getCurrentSpecification();

        await this.sendMessage({
            command: 'updateSpecs',
            data: {
                specs: specs.map(spec => ({
                    id: spec.spec.id,
                    name: spec.spec.name,
                    status: spec.spec.status,
                    phase: spec.spec.phase,
                    progress: TaskHelper.calculateProgress(spec.spec.tasks)
                })),
                currentSpecId: currentSpec?.spec.id,
                selectedSpecId: this.viewState.selectedSpecId || currentSpec?.spec.id
            }
        });
    }

    private async sendSpecOverviewUpdate(): Promise<void> {
        const specId = this.viewState.selectedSpecId;
        if (!specId) {return;}

        const spec = this.specificationManager.getSpecifications()
            .find(s => s.spec.id === specId);

        if (!spec) {return;}

        const progress = TaskHelper.calculateProgress(spec.spec.tasks);
        const recentTasks = spec.spec.tasks
            .filter(task => task.status === 'completed')
            .slice(0, 5);

        await this.sendMessage({
            command: 'updateSpecOverview',
            data: {
                spec: {
                    id: spec.spec.id,
                    name: spec.spec.name,
                    status: spec.spec.status,
                    phase: spec.spec.phase,
                    description: spec.spec.description,
                    created_at: spec.spec.created_at,
                    updated_at: spec.spec.updated_at,
                    progress: progress,
                    user_stories: spec.spec.user_stories.length,
                    total_requirements: spec.spec.user_stories.reduce((sum, story) =>
                        sum + story.requirements.length, 0),
                    files: {
                        requirements: spec.files.requirements ? {
                            exists: true,
                            size: spec.files.requirements.content.length,
                            lastModified: spec.files.requirements.lastModified
                        } : { exists: false },
                        design: spec.files.design ? {
                            exists: true,
                            size: spec.files.design.content.length,
                            lastModified: spec.files.design.lastModified
                        } : { exists: false },
                        tasks: spec.files.tasks ? {
                            exists: true,
                            size: spec.files.tasks.content.length,
                            lastModified: spec.files.tasks.lastModified
                        } : { exists: false }
                    }
                },
                recentTasks: recentTasks.map(task => ({
                    task_number: task.task_number,
                    title: task.title,
                    status: task.status
                }))
            }
        });
    }

    private async sendOperationsUpdate(): Promise<void> {
        const queue = this.mcpSyncService.getOperationQueue();
        const syncState = this.mcpSyncService.getSyncState();

        // Filter operations based on current settings
        let operations = queue.operations;

        if (this.viewState.operationFilter !== 'all') {
            const statusMap = {
                'pending': McpOperationStatus.PENDING,
                'in_progress': McpOperationStatus.IN_PROGRESS,
                'failed': McpOperationStatus.FAILED
            };
            operations = operations.filter(op => op.status === statusMap[this.viewState.operationFilter as keyof typeof statusMap]);
        }

        if (!this.viewState.showCompletedOperations) {
            operations = operations.filter(op => op.status !== McpOperationStatus.COMPLETED);
        }

        // Filter by spec if one is selected
        if (this.viewState.selectedSpecId) {
            operations = operations.filter(op => {
                const params = op.params as any;
                return params && params.specId === this.viewState.selectedSpecId;
            });
        }

        // Group operations by status and priority
        const groupedOps = this.groupOperations(operations);
        const operationCounts = this.calculateOperationCounts(queue.operations);

        await this.sendMessage({
            command: 'updateOperations',
            data: {
                operations: operations.map(op => ({
                    id: op.id,
                    type: op.type,
                    status: op.status,
                    priority: op.priority,
                    timestamp: op.timestamp,
                    startedAt: op.startedAt,
                    completedAt: op.completedAt,
                    estimatedDurationMs: op.estimatedDurationMs,
                    actualDurationMs: op.actualDurationMs,
                    progress: this.calculateOperationProgress(op),
                    description: this.getOperationDescription(op),
                    error: op.error,
                    retryCount: op.retryCount,
                    maxRetries: op.maxRetries,
                    specId: (op.params as any)?.specId
                })),
                groupedOperations: groupedOps,
                operationCounts,
                serverOnline: syncState.mcpServerOnline,
                lastSync: syncState.lastSync,
                filter: this.viewState.operationFilter,
                showCompleted: this.viewState.showCompletedOperations
            }
        });
    }

    private async sendConflictsUpdate(): Promise<void> {
        const conflicts = this.conflictResolver.getActiveConflicts();

        await this.sendMessage({
            command: 'updateConflicts',
            data: {
                conflicts: conflicts.map(conflict => ({
                    id: conflict.id,
                    type: conflict.type,
                    severity: conflict.severity,
                    description: conflict.description,
                    timestamp: conflict.timestamp,
                    operations: conflict.operations?.map(op => ({
                        id: op.id,
                        type: op.type,
                        description: this.getOperationDescription(op)
                    })) || [],
                    autoResolvable: conflict.autoResolvable,
                    resolutionAttempts: conflict.resolutionAttempts
                })),
                summary: {
                    total: conflicts.length,
                    critical: conflicts.filter(c => c.severity === 'critical').length,
                    high: conflicts.filter(c => c.severity === 'high').length,
                    autoResolvable: conflicts.filter(c => c.autoResolvable).length
                }
            }
        });
    }

    private async sendTimelineUpdate(): Promise<void> {
        const events = this.liveUpdateService.getEventHistory();
        const timeRange = this.getTimeRangeMs(this.viewState.timelineRange);
        const cutoff = Date.now() - timeRange;

        const filteredEvents = events.filter(event => {
            const eventTime = new Date(event.timestamp).getTime();
            return eventTime >= cutoff;
        });

        // Group events by hour for timeline visualization
        const timelineData = this.groupEventsByTime(filteredEvents);

        await this.sendMessage({
            command: 'updateTimeline',
            data: {
                events: filteredEvents.map(event => ({
                    type: event.type,
                    timestamp: event.timestamp,
                    description: this.getEventDescription(event),
                    operationId: event.operationId,
                    specId: event.specId,
                    severity: this.getEventSeverity(event)
                })),
                timelineData,
                range: this.viewState.timelineRange,
                stats: {
                    totalEvents: filteredEvents.length,
                    operations: filteredEvents.filter(e => e.type.includes('operation')).length,
                    conflicts: filteredEvents.filter(e => e.type.includes('conflict')).length,
                    specs: filteredEvents.filter(e => e.type.includes('spec')).length
                }
            }
        });
    }

    private async sendSyncStatusUpdate(): Promise<void> {
        const syncState = this.mcpSyncService.getSyncState();
        const performanceMetrics = syncState.performance;

        await this.sendMessage({
            command: 'updateSyncStatus',
            data: {
                serverOnline: syncState.mcpServerOnline,
                extensionOnline: syncState.extensionOnline,
                lastSync: syncState.lastSync,
                pendingOperations: syncState.pendingOperations,
                failedOperations: syncState.failedOperations,
                activeConflicts: syncState.activeConflicts,
                specifications: syncState.specifications,
                performance: performanceMetrics ? {
                    averageOperationTime: performanceMetrics.averageOperationTimeMs,
                    processingRate: performanceMetrics.queueProcessingRate,
                    lastProcessingDuration: performanceMetrics.lastProcessingDuration
                } : null
            }
        });
    }

    private async sendViewState(): Promise<void> {
        await this.sendMessage({
            command: 'updateViewState',
            data: this.viewState
        });
    }

    // Helper methods for data processing

    private groupOperations(operations: McpOperation[]): any {
        const groups = {
            urgent: operations.filter(op => op.priority === McpOperationPriority.URGENT),
            high: operations.filter(op => op.priority === McpOperationPriority.HIGH),
            normal: operations.filter(op => op.priority === McpOperationPriority.NORMAL),
            low: operations.filter(op => op.priority === McpOperationPriority.LOW)
        };

        return {
            byPriority: groups,
            byStatus: {
                pending: operations.filter(op => op.status === McpOperationStatus.PENDING),
                inProgress: operations.filter(op => op.status === McpOperationStatus.IN_PROGRESS),
                completed: operations.filter(op => op.status === McpOperationStatus.COMPLETED),
                failed: operations.filter(op => op.status === McpOperationStatus.FAILED),
                cancelled: operations.filter(op => op.status === McpOperationStatus.CANCELLED)
            }
        };
    }

    private calculateOperationCounts(operations: McpOperation[]): any {
        return {
            total: operations.length,
            pending: operations.filter(op => op.status === McpOperationStatus.PENDING).length,
            inProgress: operations.filter(op => op.status === McpOperationStatus.IN_PROGRESS).length,
            completed: operations.filter(op => op.status === McpOperationStatus.COMPLETED).length,
            failed: operations.filter(op => op.status === McpOperationStatus.FAILED).length,
            urgent: operations.filter(op => op.priority === McpOperationPriority.URGENT).length,
            high: operations.filter(op => op.priority === McpOperationPriority.HIGH).length
        };
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
        const typeNames: Record<McpOperationType, string> = {
            [McpOperationType.CREATE_SPEC]: 'Creating specification',
            [McpOperationType.UPDATE_REQUIREMENTS]: 'Updating requirements',
            [McpOperationType.UPDATE_DESIGN]: 'Updating design',
            [McpOperationType.UPDATE_TASKS]: 'Updating tasks',
            [McpOperationType.UPDATE_TASK_STATUS]: 'Updating task status',
            [McpOperationType.ADD_USER_STORY]: 'Adding user story',
            [McpOperationType.DELETE_SPEC]: 'Deleting specification',
            [McpOperationType.SET_CURRENT_SPEC]: 'Setting current specification',
            [McpOperationType.SYNC_STATUS]: 'Synchronizing status',
            [McpOperationType.HEARTBEAT]: 'Heartbeat check'
        };

        return typeNames[operation.type] || String(operation.type).replace(/[_-]/g, ' ').toLowerCase();
    }

    private getEventDescription(event: LiveUpdateEvent): string {
        const typeDescriptions: { [key: string]: string } = {
            'operation_started': 'Operation started',
            'operation_completed': 'Operation completed',
            'operation_failed': 'Operation failed',
            'operation_progress': 'Operation progress updated',
            'conflict_detected': 'Conflict detected',
            'conflict_resolved': 'Conflict resolved',
            'sync_status_changed': 'Sync status changed',
            'spec_updated': 'Specification updated'
        };

        let description = typeDescriptions[event.type] || event.type;

        if (event.operationId) {
            description += ` (${event.operationId.substring(0, 8)}...)`;
        }

        if (event.specId) {
            description += ` for ${event.specId}`;
        }

        return description;
    }

    private getEventSeverity(event: LiveUpdateEvent): 'info' | 'warning' | 'error' | 'success' {
        switch (event.type) {
            case 'operation_completed':
            case 'conflict_resolved':
                return 'success';
            case 'operation_failed':
            case 'conflict_detected':
                return 'error';
            case 'operation_progress':
                return 'info';
            case 'sync_status_changed':
                return 'warning';
            default:
                return 'info';
        }
    }

    private getTimeRangeMs(range: string): number {
        switch (range) {
            case '1h': return 60 * 60 * 1000;
            case '6h': return 6 * 60 * 60 * 1000;
            case '24h': return 24 * 60 * 60 * 1000;
            case '7d': return 7 * 24 * 60 * 60 * 1000;
            default: return 24 * 60 * 60 * 1000;
        }
    }

    private groupEventsByTime(events: LiveUpdateEvent[]): any {
        const groups: { [key: string]: number } = {};
        const hourMs = 60 * 60 * 1000;

        events.forEach(event => {
            const eventTime = new Date(event.timestamp).getTime();
            const hourKey = Math.floor(eventTime / hourMs) * hourMs;
            const hourLabel = new Date(hourKey).toISOString().substring(0, 13) + ':00';

            groups[hourLabel] = (groups[hourLabel] || 0) + 1;
        });

        return groups;
    }

    private async handleExportData(type: 'operations' | 'timeline' | 'conflicts'): Promise<void> {
        try {
            let data: any;
            let filename: string;

            switch (type) {
                case 'operations':
                    data = this.mcpSyncService.getOperationQueue().operations;
                    filename = 'mcp-operations.json';
                    break;
                case 'timeline':
                    data = this.liveUpdateService.getEventHistory();
                    filename = 'event-timeline.json';
                    break;
                case 'conflicts':
                    data = this.conflictResolver.getActiveConflicts();
                    filename = 'conflicts.json';
                    break;
            }

            const jsonData = JSON.stringify(data, null, 2);
            const uri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.file(filename),
                filters: {
                    'JSON Files': ['json'],
                    'All Files': ['*']
                }
            });

            if (uri) {
                await vscode.workspace.fs.writeFile(uri, Buffer.from(jsonData));
                vscode.window.showInformationMessage(`Data exported to ${uri.fsPath}`);
            }
        } catch (error) {
            console.error('Export error:', error);
            vscode.window.showErrorMessage(`Failed to export data: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async generateHtml(): Promise<string> {
        const cssUri = this.panel?.webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'styles', 'dashboard.css')
        );

        const nonce = this.generateNonce();

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.panel?.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${this.panel?.webview.cspSource} data:; font-src ${this.panel?.webview.cspSource};">
                <title>SpecForged Project Dashboard</title>
                <link href="${cssUri}" rel="stylesheet">
                <style>
                    ${this.getInlineStyles()}
                </style>
            </head>
            <body>
                <div id="app" class="dashboard-container">
                    <header class="dashboard-header">
                        <div class="header-left">
                            <h1 class="dashboard-title">
                                <span class="icon">📊</span>
                                SpecForged Project Dashboard
                            </h1>
                            <div id="sync-indicator" class="sync-indicator">
                                <span class="status-dot"></span>
                                <span class="status-text">Loading...</span>
                            </div>
                        </div>
                        <div class="header-right">
                            <div class="spec-selector">
                                <select id="spec-selector" onchange="selectSpec(this.value)">
                                    <option value="">Select Specification...</option>
                                </select>
                            </div>
                            <div class="header-actions">
                                <button onclick="syncAllSpecs()" class="btn btn-primary" id="sync-all-btn">
                                    🔄 Sync All
                                </button>
                                <button onclick="refreshData()" class="btn btn-secondary">
                                    ↻ Refresh
                                </button>
                            </div>
                        </div>
                    </header>

                    <nav class="dashboard-nav">
                        <button class="nav-item active" data-section="overview" onclick="changeSection('overview')">
                            📋 Overview
                        </button>
                        <button class="nav-item" data-section="operations" onclick="changeSection('operations')">
                            ⚙️ Operations
                            <span id="operations-badge" class="badge">0</span>
                        </button>
                        <button class="nav-item" data-section="conflicts" onclick="changeSection('conflicts')">
                            ⚠️ Conflicts
                            <span id="conflicts-badge" class="badge">0</span>
                        </button>
                        <button class="nav-item" data-section="timeline" onclick="changeSection('timeline')">
                            📈 Timeline
                        </button>
                        <button class="nav-item" data-section="settings" onclick="changeSection('settings')">
                            ⚙️ Settings
                        </button>
                    </nav>

                    <main class="dashboard-content">
                        <!-- Overview Section -->
                        <section id="overview-section" class="content-section active">
                            <div class="overview-grid">
                                <div class="overview-card spec-info">
                                    <h2>Specification Details</h2>
                                    <div id="spec-details" class="spec-details-content">
                                        <div class="no-spec-selected">
                                            <p>No specification selected</p>
                                            <button onclick="createSpec()" class="btn btn-primary">Create New Spec</button>
                                        </div>
                                    </div>
                                </div>
                                <div class="overview-card quick-stats">
                                    <h2>Quick Stats</h2>
                                    <div id="quick-stats" class="stats-grid">
                                        <div class="stat-item">
                                            <div class="stat-value" id="stat-operations">0</div>
                                            <div class="stat-label">Active Operations</div>
                                        </div>
                                        <div class="stat-item">
                                            <div class="stat-value" id="stat-conflicts">0</div>
                                            <div class="stat-label">Active Conflicts</div>
                                        </div>
                                        <div class="stat-item">
                                            <div class="stat-value" id="stat-specs">0</div>
                                            <div class="stat-label">Specifications</div>
                                        </div>
                                        <div class="stat-item">
                                            <div class="stat-value" id="stat-progress">0%</div>
                                            <div class="stat-label">Progress</div>
                                        </div>
                                    </div>
                                </div>
                                <div class="overview-card recent-activity">
                                    <h2>Recent Activity</h2>
                                    <div id="recent-activity" class="activity-list">
                                        <div class="activity-placeholder">No recent activity</div>
                                    </div>
                                </div>
                            </div>
                        </section>

                        <!-- Operations Section -->
                        <section id="operations-section" class="content-section">
                            <div class="section-header">
                                <h2>MCP Operations</h2>
                                <div class="section-controls">
                                    <div class="filter-group">
                                        <label>Filter:</label>
                                        <select id="operations-filter" onchange="filterOperations(this.value)">
                                            <option value="all">All Operations</option>
                                            <option value="pending">Pending</option>
                                            <option value="in_progress">In Progress</option>
                                            <option value="failed">Failed</option>
                                        </select>
                                    </div>
                                    <label class="checkbox-label">
                                        <input type="checkbox" id="show-completed" onchange="toggleCompletedOperations(this.checked)">
                                        Show Completed
                                    </label>
                                </div>
                            </div>
                            <div id="operations-content" class="operations-content">
                                <div class="loading-placeholder">Loading operations...</div>
                            </div>
                        </section>

                        <!-- Conflicts Section -->
                        <section id="conflicts-section" class="content-section">
                            <div class="section-header">
                                <h2>Conflicts</h2>
                                <div class="section-controls">
                                    <button onclick="autoResolveConflicts()" class="btn btn-secondary" id="auto-resolve-btn">
                                        ✨ Auto Resolve
                                    </button>
                                </div>
                            </div>
                            <div id="conflicts-content" class="conflicts-content">
                                <div class="loading-placeholder">Loading conflicts...</div>
                            </div>
                        </section>

                        <!-- Timeline Section -->
                        <section id="timeline-section" class="content-section">
                            <div class="section-header">
                                <h2>Event Timeline</h2>
                                <div class="section-controls">
                                    <div class="time-range-selector">
                                        <label>Range:</label>
                                        <button class="time-btn active" data-range="1h" onclick="setTimelineRange('1h')">1H</button>
                                        <button class="time-btn" data-range="6h" onclick="setTimelineRange('6h')">6H</button>
                                        <button class="time-btn" data-range="24h" onclick="setTimelineRange('24h')">24H</button>
                                        <button class="time-btn" data-range="7d" onclick="setTimelineRange('7d')">7D</button>
                                    </div>
                                    <button onclick="exportData('timeline')" class="btn btn-secondary">
                                        📤 Export
                                    </button>
                                </div>
                            </div>
                            <div id="timeline-content" class="timeline-content">
                                <div class="loading-placeholder">Loading timeline...</div>
                            </div>
                        </section>

                        <!-- Settings Section -->
                        <section id="settings-section" class="content-section">
                            <div class="section-header">
                                <h2>Dashboard Settings</h2>
                            </div>
                            <div class="settings-content">
                                <div class="settings-grid">
                                    <div class="settings-group">
                                        <h3>Display Options</h3>
                                        <label class="checkbox-label">
                                            <input type="checkbox" id="auto-refresh" checked>
                                            Auto-refresh data
                                        </label>
                                        <label class="checkbox-label">
                                            <input type="checkbox" id="show-timestamps" checked>
                                            Show timestamps
                                        </label>
                                        <label class="checkbox-label">
                                            <input type="checkbox" id="enable-animations" checked>
                                            Enable animations
                                        </label>
                                    </div>
                                    <div class="settings-group">
                                        <h3>Notifications</h3>
                                        <label class="checkbox-label">
                                            <input type="checkbox" id="notify-operations" checked>
                                            Operation notifications
                                        </label>
                                        <label class="checkbox-label">
                                            <input type="checkbox" id="notify-conflicts" checked>
                                            Conflict notifications
                                        </label>
                                    </div>
                                    <div class="settings-group">
                                        <h3>Data Management</h3>
                                        <button onclick="exportData('operations')" class="btn btn-secondary">
                                            📤 Export Operations
                                        </button>
                                        <button onclick="exportData('conflicts')" class="btn btn-secondary">
                                            📤 Export Conflicts
                                        </button>
                                        <button onclick="clearHistory()" class="btn btn-danger">
                                            🗑️ Clear History
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </section>
                    </main>
                </div>

                <script nonce="${nonce}">
                    ${this.getDashboardScript()}
                </script>
            </body>
            </html>
        `;
    }

    private generateNonce(): string {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < 32; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    private getInlineStyles(): string {
        return `
            /* Dashboard base styles will be included here */
            /* This would be a comprehensive CSS for the dashboard */
            /* For brevity, showing key styles only */

            .dashboard-container {
                height: 100vh;
                display: flex;
                flex-direction: column;
                font-family: var(--vscode-font-family);
                background-color: var(--vscode-editor-background);
                color: var(--vscode-foreground);
            }

            .dashboard-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 20px;
                background-color: var(--vscode-titleBar-activeBackground);
                border-bottom: 1px solid var(--vscode-panel-border);
            }

            .dashboard-nav {
                display: flex;
                background-color: var(--vscode-tab-inactiveBackground);
                border-bottom: 1px solid var(--vscode-panel-border);
                padding: 0 20px;
            }

            .nav-item {
                background: none;
                border: none;
                color: var(--vscode-tab-inactiveForeground);
                padding: 12px 16px;
                cursor: pointer;
                border-bottom: 2px solid transparent;
                transition: all 0.2s ease;
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .nav-item:hover {
                background-color: var(--vscode-tab-hoverBackground);
                color: var(--vscode-tab-activeForeground);
            }

            .nav-item.active {
                background-color: var(--vscode-tab-activeBackground);
                color: var(--vscode-tab-activeForeground);
                border-bottom-color: var(--vscode-textLink-foreground);
            }

            .badge {
                background-color: var(--vscode-badge-background);
                color: var(--vscode-badge-foreground);
                border-radius: 10px;
                padding: 2px 6px;
                font-size: 0.75em;
                min-width: 18px;
                text-align: center;
            }

            .dashboard-content {
                flex: 1;
                overflow-y: auto;
                padding: 20px;
            }

            .content-section {
                display: none;
            }

            .content-section.active {
                display: block;
            }

            .overview-grid {
                display: grid;
                grid-template-columns: 2fr 1fr;
                grid-template-rows: auto auto;
                gap: 20px;
                height: 100%;
            }

            .overview-card {
                background-color: var(--vscode-sideBar-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 8px;
                padding: 16px;
                overflow: hidden;
            }

            .spec-info {
                grid-column: 1;
                grid-row: 1 / 3;
            }

            .quick-stats {
                grid-column: 2;
                grid-row: 1;
            }

            .recent-activity {
                grid-column: 2;
                grid-row: 2;
            }

            .stats-grid {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 16px;
                margin-top: 12px;
            }

            .stat-item {
                text-align: center;
            }

            .stat-value {
                font-size: 2em;
                font-weight: bold;
                color: var(--vscode-textLink-foreground);
                margin-bottom: 4px;
            }

            .stat-label {
                font-size: 0.85em;
                color: var(--vscode-descriptionForeground);
            }

            .btn {
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                padding: 8px 16px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 0.9em;
                transition: background-color 0.2s ease;
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }

            .btn:hover {
                background-color: var(--vscode-button-hoverBackground);
            }

            .btn-primary {
                background-color: var(--vscode-textLink-foreground);
                color: white;
            }

            .btn-secondary {
                background-color: var(--vscode-button-secondaryBackground);
                color: var(--vscode-button-secondaryForeground);
            }

            .btn-danger {
                background-color: #d73a49;
                color: white;
            }

            @media (max-width: 768px) {
                .overview-grid {
                    grid-template-columns: 1fr;
                    grid-template-rows: auto auto auto;
                }

                .spec-info {
                    grid-column: 1;
                    grid-row: 1;
                }

                .quick-stats {
                    grid-column: 1;
                    grid-row: 2;
                }

                .recent-activity {
                    grid-column: 1;
                    grid-row: 3;
                }

                .dashboard-header {
                    flex-direction: column;
                    align-items: stretch;
                    gap: 12px;
                }
            }
        `;
    }

    private getDashboardScript(): string {
        return `
            const vscode = acquireVsCodeApi();
            let dashboardState = {
                specs: [],
                selectedSpecId: null,
                activeSection: 'overview'
            };

            // Message handling from extension
            window.addEventListener('message', event => {
                const message = event.data;
                console.log('Dashboard received message:', message.command);

                switch (message.command) {
                    case 'liveUpdate':
                        handleLiveUpdate(message.event);
                        break;
                    case 'updateSpecs':
                        updateSpecsData(message.data);
                        break;
                    case 'updateSpecOverview':
                        updateSpecOverview(message.data);
                        break;
                    case 'updateOperations':
                        updateOperations(message.data);
                        break;
                    case 'updateConflicts':
                        updateConflicts(message.data);
                        break;
                    case 'updateTimeline':
                        updateTimeline(message.data);
                        break;
                    case 'updateSyncStatus':
                        updateSyncStatus(message.data);
                        break;
                    case 'updateViewState':
                        updateViewState(message.data);
                        break;
                    case 'showNotification':
                        showNotification(message.data.type, message.data.message);
                        break;
                }
            });

            function handleLiveUpdate(event) {
                // Show a brief notification for real-time events
                switch (event.type) {
                    case 'operation_started':
                        showNotification('info', 'Operation started', 2000);
                        break;
                    case 'operation_completed':
                        showNotification('success', 'Operation completed', 2000);
                        break;
                    case 'operation_failed':
                        showNotification('error', 'Operation failed', 3000);
                        break;
                    case 'conflict_detected':
                        showNotification('warning', 'Conflict detected', 3000);
                        break;
                }
            }

            function updateSpecsData(data) {
                dashboardState.specs = data.specs;
                dashboardState.selectedSpecId = data.selectedSpecId;

                const selector = document.getElementById('spec-selector');
                selector.innerHTML = '<option value="">Select Specification...</option>';

                data.specs.forEach(spec => {
                    const option = document.createElement('option');
                    option.value = spec.id;
                    option.textContent = \`\${spec.name} (\${spec.progress.percentage}%)\`;
                    option.selected = spec.id === data.selectedSpecId;
                    selector.appendChild(option);
                });

                // Update stats
                document.getElementById('stat-specs').textContent = data.specs.length;
            }

            function updateSpecOverview(data) {
                const container = document.getElementById('spec-details');

                if (!data.spec) {
                    container.innerHTML = \`
                        <div class="no-spec-selected">
                            <p>No specification selected</p>
                            <button onclick="createSpec()" class="btn btn-primary">Create New Spec</button>
                        </div>
                    \`;
                    return;
                }

                const spec = data.spec;
                container.innerHTML = \`
                    <div class="spec-overview">
                        <div class="spec-header">
                            <h3>\${spec.name}</h3>
                            <span class="spec-status status-\${spec.status}">\${spec.status}</span>
                        </div>
                        <div class="spec-meta">
                            <div class="meta-item">
                                <label>Phase:</label>
                                <span>\${spec.phase.replace('_', ' ')}</span>
                            </div>
                            <div class="meta-item">
                                <label>Progress:</label>
                                <span>\${spec.progress.completed}/\${spec.progress.total} tasks (\${spec.progress.percentage}%)</span>
                            </div>
                            <div class="meta-item">
                                <label>User Stories:</label>
                                <span>\${spec.user_stories}</span>
                            </div>
                            <div class="meta-item">
                                <label>Requirements:</label>
                                <span>\${spec.total_requirements}</span>
                            </div>
                        </div>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: \${spec.progress.percentage}%"></div>
                        </div>
                        <div class="spec-files">
                            <h4>Files</h4>
                            <div class="file-list">
                                <div class="file-item \${spec.files.requirements.exists ? 'exists' : 'missing'}">
                                    <span class="file-icon">📋</span>
                                    <span class="file-name">requirements.md</span>
                                    \${spec.files.requirements.exists ?
                                        \`<button onclick="openSpecFile('\${spec.id}', 'Requirements')" class="btn-sm">Open</button>\` :
                                        \`<button onclick="openSpecFile('\${spec.id}', 'Requirements')" class="btn-sm btn-create">Create</button>\`
                                    }
                                </div>
                                <div class="file-item \${spec.files.design.exists ? 'exists' : 'missing'}">
                                    <span class="file-icon">🎨</span>
                                    <span class="file-name">design.md</span>
                                    \${spec.files.design.exists ?
                                        \`<button onclick="openSpecFile('\${spec.id}', 'Design')" class="btn-sm">Open</button>\` :
                                        \`<button onclick="openSpecFile('\${spec.id}', 'Design')" class="btn-sm btn-create">Create</button>\`
                                    }
                                </div>
                                <div class="file-item \${spec.files.tasks.exists ? 'exists' : 'missing'}">
                                    <span class="file-icon">✅</span>
                                    <span class="file-name">tasks.md</span>
                                    \${spec.files.tasks.exists ?
                                        \`<button onclick="openSpecFile('\${spec.id}', 'Tasks')" class="btn-sm">Open</button>\` :
                                        \`<button onclick="openSpecFile('\${spec.id}', 'Tasks')" class="btn-sm btn-create">Create</button>\`
                                    }
                                </div>
                            </div>
                        </div>
                        <div class="spec-actions">
                            <button onclick="syncSpec()" class="btn btn-primary">🔄 Sync Spec</button>
                        </div>
                    </div>
                \`;

                // Update progress stat
                document.getElementById('stat-progress').textContent = spec.progress.percentage + '%';
            }

            function updateOperations(data) {
                // Update operation count badges
                document.getElementById('operations-badge').textContent = data.operationCounts.pending + data.operationCounts.inProgress;
                document.getElementById('stat-operations').textContent = data.operationCounts.pending + data.operationCounts.inProgress;

                const container = document.getElementById('operations-content');

                if (data.operations.length === 0) {
                    container.innerHTML = \`
                        <div class="empty-state">
                            <h3>No Operations</h3>
                            <p>No operations match the current filter criteria.</p>
                        </div>
                    \`;
                    return;
                }

                let html = \`
                    <div class="operations-summary">
                        <div class="summary-stats">
                            <div class="summary-stat">
                                <span class="stat-value">\${data.operationCounts.pending}</span>
                                <span class="stat-label">Pending</span>
                            </div>
                            <div class="summary-stat">
                                <span class="stat-value">\${data.operationCounts.inProgress}</span>
                                <span class="stat-label">In Progress</span>
                            </div>
                            <div class="summary-stat">
                                <span class="stat-value">\${data.operationCounts.failed}</span>
                                <span class="stat-label">Failed</span>
                            </div>
                            <div class="summary-stat">
                                <span class="stat-value">\${data.operationCounts.urgent}</span>
                                <span class="stat-label">Urgent</span>
                            </div>
                        </div>
                        <div class="server-status \${data.serverOnline ? 'online' : 'offline'}">
                            <span class="status-indicator">\${data.serverOnline ? '🟢' : '🔴'}</span>
                            <span>MCP Server \${data.serverOnline ? 'Online' : 'Offline'}</span>
                        </div>
                    </div>
                    <div class="operations-list">
                \`;

                data.operations.forEach(op => {
                    const statusClass = op.status.replace('_', '-');
                    const priorityIcon = getPriorityIcon(op.priority);
                    const statusIcon = getStatusIcon(op.status);

                    let actionsHtml = '';
                    if (op.status === 'failed') {
                        actionsHtml = \`<button onclick="retryOperation('\${op.id}')" class="btn-sm btn-secondary">Retry</button>\`;
                    } else if (op.status === 'in_progress') {
                        actionsHtml = \`<button onclick="cancelOperation('\${op.id}')" class="btn-sm btn-danger">Cancel</button>\`;
                    }

                    let progressHtml = '';
                    if (op.status === 'in_progress' && op.progress > 0) {
                        progressHtml = \`
                            <div class="operation-progress">
                                <div class="progress-bar-small">
                                    <div class="progress-fill" style="width: \${op.progress}%"></div>
                                </div>
                                <span class="progress-text">\${op.progress}%</span>
                            </div>
                        \`;
                    }

                    html += \`
                        <div class="operation-item \${statusClass}">
                            <div class="operation-header">
                                <div class="operation-info">
                                    <span class="operation-icons">
                                        <span class="priority-icon">\${priorityIcon}</span>
                                        <span class="status-icon">\${statusIcon}</span>
                                    </span>
                                    <span class="operation-description">\${op.description}</span>
                                    <span class="operation-id">\${op.id.substring(0, 8)}...</span>
                                </div>
                                <div class="operation-actions">
                                    \${actionsHtml}
                                </div>
                            </div>
                            \${progressHtml}
                            <div class="operation-meta">
                                <span class="operation-time">Started: \${formatTime(op.timestamp)}</span>
                                \${op.error ? \`<span class="operation-error">Error: \${op.error.substring(0, 100)}...</span>\` : ''}
                                \${op.specId ? \`<span class="operation-spec">Spec: \${op.specId}</span>\` : ''}
                            </div>
                        </div>
                    \`;
                });

                html += '</div>';
                container.innerHTML = html;
            }

            function updateConflicts(data) {
                // Update conflicts badge
                document.getElementById('conflicts-badge').textContent = data.conflicts.length;
                document.getElementById('stat-conflicts').textContent = data.conflicts.length;

                const container = document.getElementById('conflicts-content');

                if (data.conflicts.length === 0) {
                    container.innerHTML = \`
                        <div class="empty-state success">
                            <h3>✅ No Conflicts</h3>
                            <p>All operations are running smoothly!</p>
                        </div>
                    \`;
                    return;
                }

                let html = \`
                    <div class="conflicts-summary">
                        <div class="summary-stats">
                            <div class="summary-stat critical">
                                <span class="stat-value">\${data.summary.critical}</span>
                                <span class="stat-label">Critical</span>
                            </div>
                            <div class="summary-stat high">
                                <span class="stat-value">\${data.summary.high}</span>
                                <span class="stat-label">High</span>
                            </div>
                            <div class="summary-stat">
                                <span class="stat-value">\${data.summary.autoResolvable}</span>
                                <span class="stat-label">Auto-resolvable</span>
                            </div>
                        </div>
                    </div>
                    <div class="conflicts-list">
                \`;

                data.conflicts.forEach(conflict => {
                    const severityClass = conflict.severity;
                    const severityIcon = getSeverityIcon(conflict.severity);

                    html += \`
                        <div class="conflict-item \${severityClass}">
                            <div class="conflict-header">
                                <div class="conflict-info">
                                    <span class="severity-icon">\${severityIcon}</span>
                                    <span class="conflict-type">\${conflict.type.replace('_', ' ')}</span>
                                    <span class="conflict-description">\${conflict.description}</span>
                                </div>
                                <div class="conflict-actions">
                                    <button onclick="resolveConflict('\${conflict.id}')" class="btn-sm btn-primary">
                                        Resolve
                                    </button>
                                </div>
                            </div>
                            <div class="conflict-meta">
                                <span class="conflict-time">Detected: \${formatTime(conflict.timestamp)}</span>
                                <span class="conflict-operations">Operations: \${conflict.operations.length}</span>
                                \${conflict.autoResolvable ? '<span class="auto-resolvable">Auto-resolvable</span>' : ''}
                            </div>
                            \${conflict.operations.length > 0 ? \`
                                <div class="conflict-operations-list">
                                    \${conflict.operations.map(op => \`
                                        <div class="conflict-operation">
                                            <span class="op-type">\${op.type}</span>
                                            <span class="op-desc">\${op.description}</span>
                                        </div>
                                    \`).join('')}
                                </div>
                            \` : ''}
                        </div>
                    \`;
                });

                html += '</div>';
                container.innerHTML = html;
            }

            function updateTimeline(data) {
                const container = document.getElementById('timeline-content');

                if (data.events.length === 0) {
                    container.innerHTML = \`
                        <div class="empty-state">
                            <h3>No Events</h3>
                            <p>No events in the selected time range.</p>
                        </div>
                    \`;
                    return;
                }

                let html = \`
                    <div class="timeline-summary">
                        <div class="summary-stats">
                            <div class="summary-stat">
                                <span class="stat-value">\${data.stats.totalEvents}</span>
                                <span class="stat-label">Total Events</span>
                            </div>
                            <div class="summary-stat">
                                <span class="stat-value">\${data.stats.operations}</span>
                                <span class="stat-label">Operations</span>
                            </div>
                            <div class="summary-stat">
                                <span class="stat-value">\${data.stats.conflicts}</span>
                                <span class="stat-label">Conflicts</span>
                            </div>
                            <div class="summary-stat">
                                <span class="stat-value">\${data.stats.specs}</span>
                                <span class="stat-label">Spec Updates</span>
                            </div>
                        </div>
                    </div>
                    <div class="timeline-events">
                \`;

                data.events.reverse().forEach(event => {
                    const severityClass = event.severity;
                    const severityIcon = getSeverityIcon(event.severity);

                    html += \`
                        <div class="timeline-event \${severityClass}">
                            <div class="event-time">\${formatTime(event.timestamp)}</div>
                            <div class="event-content">
                                <div class="event-header">
                                    <span class="event-icon">\${severityIcon}</span>
                                    <span class="event-description">\${event.description}</span>
                                </div>
                                <div class="event-meta">
                                    \${event.operationId ? \`<span class="event-op-id">Op: \${event.operationId.substring(0, 8)}...</span>\` : ''}
                                    \${event.specId ? \`<span class="event-spec-id">Spec: \${event.specId}</span>\` : ''}
                                </div>
                            </div>
                        </div>
                    \`;
                });

                html += '</div>';
                container.innerHTML = html;
            }

            function updateSyncStatus(data) {
                const indicator = document.getElementById('sync-indicator');
                const statusDot = indicator.querySelector('.status-dot');
                const statusText = indicator.querySelector('.status-text');

                if (data.serverOnline) {
                    statusDot.className = 'status-dot online';
                    statusText.textContent = 'MCP Server Online';
                } else {
                    statusDot.className = 'status-dot offline';
                    statusText.textContent = 'MCP Server Offline';
                }

                if (data.lastSync) {
                    const syncTime = formatTime(data.lastSync);
                    statusText.textContent += \` • Last sync: \${syncTime}\`;
                }
            }

            function updateViewState(state) {
                dashboardState = { ...dashboardState, ...state };

                // Update active section
                document.querySelectorAll('.nav-item').forEach(item => {
                    item.classList.toggle('active', item.dataset.section === state.activeSection);
                });

                document.querySelectorAll('.content-section').forEach(section => {
                    section.classList.toggle('active', section.id === state.activeSection + '-section');
                });

                // Update filter controls
                if (state.operationFilter) {
                    const filterSelect = document.getElementById('operations-filter');
                    if (filterSelect) filterSelect.value = state.operationFilter;
                }

                if (state.showCompletedOperations !== undefined) {
                    const checkbox = document.getElementById('show-completed');
                    if (checkbox) checkbox.checked = state.showCompletedOperations;
                }

                if (state.timelineRange) {
                    document.querySelectorAll('.time-btn').forEach(btn => {
                        btn.classList.toggle('active', btn.dataset.range === state.timelineRange);
                    });
                }
            }

            // UI event handlers
            function changeSection(section) {
                vscode.postMessage({ command: 'changeSection', section: section });
            }

            function selectSpec(specId) {
                vscode.postMessage({ command: 'selectSpec', specId: specId });
            }

            function filterOperations(filter) {
                vscode.postMessage({ command: 'filterOperations', filter: filter });
            }

            function toggleCompletedOperations(show) {
                vscode.postMessage({ command: 'toggleCompletedOperations', show: show });
            }

            function setTimelineRange(range) {
                vscode.postMessage({ command: 'setTimelineRange', range: range });
            }

            function syncSpec() {
                vscode.postMessage({ command: 'syncSpec' });
            }

            function syncAllSpecs() {
                vscode.postMessage({ command: 'syncAllSpecs' });
            }

            function cancelOperation(operationId) {
                vscode.postMessage({ command: 'cancelOperation', operationId: operationId });
            }

            function retryOperation(operationId) {
                vscode.postMessage({ command: 'retryOperation', operationId: operationId });
            }

            function resolveConflict(conflictId) {
                vscode.postMessage({ command: 'resolveConflict', conflictId: conflictId });
            }

            function autoResolveConflicts() {
                vscode.postMessage({ command: 'autoResolveConflicts' });
            }

            function openSpecFile(specId, fileType) {
                vscode.postMessage({ command: 'openSpecFile', specId: specId, fileType: fileType });
            }

            function createSpec() {
                vscode.postMessage({ command: 'createSpec' });
            }

            function refreshData() {
                vscode.postMessage({ command: 'refreshData' });
            }

            function exportData(type) {
                vscode.postMessage({ command: 'exportData', type: type });
            }

            // Utility functions
            function getPriorityIcon(priority) {
                switch (priority) {
                    case 3: return '🔴'; // URGENT
                    case 2: return '🟠'; // HIGH
                    case 1: return '🟡'; // NORMAL
                    case 0: return '🟢'; // LOW
                    default: return '⚪';
                }
            }

            function getStatusIcon(status) {
                switch (status) {
                    case 'pending': return '⏳';
                    case 'in_progress': return '🔄';
                    case 'completed': return '✅';
                    case 'failed': return '❌';
                    case 'cancelled': return '🚫';
                    default: return '❓';
                }
            }

            function getSeverityIcon(severity) {
                switch (severity) {
                    case 'critical': return '🚨';
                    case 'high': return '⚠️';
                    case 'medium': return '🔶';
                    case 'low': return 'ℹ️';
                    case 'error': return '❌';
                    case 'warning': return '⚠️';
                    case 'success': return '✅';
                    case 'info': return 'ℹ️';
                    default: return '❓';
                }
            }

            function formatTime(timestamp) {
                const date = new Date(timestamp);
                const now = new Date();
                const diff = now.getTime() - date.getTime();

                if (diff < 60000) return 'just now';
                if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
                if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
                return Math.floor(diff / 86400000) + 'd ago';
            }

            function showNotification(type, message, duration = 4000) {
                const notification = document.createElement('div');
                notification.className = \`notification \${type}\`;
                notification.textContent = message;

                notification.style.cssText = \`
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
                \`;

                const colors = {
                    info: '#2196f3',
                    success: '#4caf50',
                    warning: '#ff9800',
                    error: '#f44336'
                };

                notification.style.backgroundColor = colors[type] || colors.info;

                document.body.appendChild(notification);

                setTimeout(() => {
                    if (notification.parentNode) {
                        notification.parentNode.removeChild(notification);
                    }
                }, duration);
            }

            // Initialize
            document.addEventListener('DOMContentLoaded', () => {
                console.log('Dashboard loaded');
            });
        `;
    }

    public dispose(): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
        }

        if (this.updateSubscription) {
            this.updateSubscription.dispose();
            this.updateSubscription = undefined;
        }

        if (this.panel) {
            this.panel.dispose();
            this.panel = undefined;
        }
    }
}
