import * as vscode from 'vscode';
import {
    McpOperation,
    McpOperationStatus,
    McpOperationType,
    McpOperationResult,
    McpOperationPriority
} from '../models/mcpOperation';

export interface NotificationPreferences {
    enableNotifications: boolean;
    showSuccessNotifications: boolean;
    showFailureNotifications: boolean;
    showProgressNotifications: boolean;
    showConflictNotifications: boolean;
    notificationDuration: number; // in milliseconds
    enableSounds: boolean;
    enableBadges: boolean;
    quietHours: {
        enabled: boolean;
        startTime: string; // HH:MM format
        endTime: string;   // HH:MM format
    };
    priorityFilter: McpOperationPriority; // minimum priority to show notifications
    operationTypeFilters: McpOperationType[]; // operation types to show notifications for
}

export interface NotificationHistoryItem {
    id: string;
    timestamp: string;
    type: 'success' | 'failure' | 'progress' | 'conflict' | 'info' | 'warning';
    title: string;
    message: string;
    operationId?: string;
    operationType?: McpOperationType;
    actions?: NotificationAction[];
    dismissed: boolean;
    dismissedAt?: string;
    autoHide: boolean;
    duration?: number;
}

export interface NotificationAction {
    id: string;
    label: string;
    command: string;
    args?: any[];
    tooltip?: string;
    primary?: boolean;
}

export interface ProgressNotification {
    id: string;
    operationId: string;
    title: string;
    message: string;
    progress: number; // 0-100
    cancellable: boolean;
    startTime: number;
    estimatedDuration?: number;
    token?: vscode.CancellationToken;
}

export class NotificationManager {
    private preferences: NotificationPreferences;
    private history: NotificationHistoryItem[] = [];
    private activeProgressNotifications = new Map<string, ProgressNotification>();
    private notificationCounter = 0;
    private readonly maxHistorySize = 100;

    // Event emitters for notification events
    private readonly onNotificationShownEmitter = new vscode.EventEmitter<NotificationHistoryItem>();
    private readonly onNotificationDismissedEmitter = new vscode.EventEmitter<string>();
    private readonly onPreferencesChangedEmitter = new vscode.EventEmitter<NotificationPreferences>();

    public readonly onNotificationShown = this.onNotificationShownEmitter.event;
    public readonly onNotificationDismissed = this.onNotificationDismissedEmitter.event;
    public readonly onPreferencesChanged = this.onPreferencesChangedEmitter.event;

    constructor() {
        this.preferences = this.loadPreferences();
        this.setupConfigurationWatcher();
    }

    private loadPreferences(): NotificationPreferences {
        const config = vscode.workspace.getConfiguration('specforged.notifications');

        return {
            enableNotifications: config.get<boolean>('enabled', true),
            showSuccessNotifications: config.get<boolean>('showSuccess', true),
            showFailureNotifications: config.get<boolean>('showFailure', true),
            showProgressNotifications: config.get<boolean>('showProgress', true),
            showConflictNotifications: config.get<boolean>('showConflicts', true),
            notificationDuration: config.get<number>('duration', 5000),
            enableSounds: config.get<boolean>('enableSounds', true),
            enableBadges: config.get<boolean>('enableBadges', true),
            quietHours: {
                enabled: config.get<boolean>('quietHours.enabled', false),
                startTime: config.get<string>('quietHours.startTime', '22:00'),
                endTime: config.get<string>('quietHours.endTime', '08:00')
            },
            priorityFilter: config.get<McpOperationPriority>('priorityFilter', McpOperationPriority.LOW),
            operationTypeFilters: config.get<McpOperationType[]>('operationTypeFilters', Object.values(McpOperationType))
        };
    }

    private setupConfigurationWatcher(): void {
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('specforged.notifications')) {
                const oldPreferences = this.preferences;
                this.preferences = this.loadPreferences();

                console.log('Notification preferences updated');
                this.onPreferencesChangedEmitter.fire(this.preferences);

                // Show notification about preference changes if notifications are enabled
                if (this.preferences.enableNotifications && !oldPreferences.enableNotifications) {
                    this.showInfoNotification(
                        'Notifications Enabled',
                        'SpecForged notifications are now enabled',
                        []
                    );
                }
            }
        });
    }

    // Main notification methods

    async showOperationSuccessNotification(
        operation: McpOperation,
        result?: McpOperationResult
    ): Promise<void> {
        if (!this.shouldShowNotification('success', operation)) {
            return;
        }

        const actions: NotificationAction[] = [
            {
                id: 'view-result',
                label: 'View Result',
                command: 'specforged.showOperationResult',
                args: [operation.id],
                primary: true
            }
        ];

        // Add operation-specific actions
        if (operation.type === McpOperationType.CREATE_SPEC) {
            actions.push({
                id: 'open-spec',
                label: 'Open Specification',
                command: 'specforged.openSpecification',
                args: [result?.data?.specId || operation.params.specId]
            });
        }

        const title = this.getOperationDisplayName(operation.type);
        const message = result?.message || `${title} completed successfully`;

        await this.showNotification({
            type: 'success',
            title: `✅ ${title} Completed`,
            message,
            operationId: operation.id,
            operationType: operation.type,
            actions,
            autoHide: true,
            duration: this.preferences.notificationDuration
        });
    }

    async showOperationFailureNotification(
        operation: McpOperation,
        error?: string
    ): Promise<void> {
        if (!this.shouldShowNotification('failure', operation)) {
            return;
        }

        const actions: NotificationAction[] = [
            {
                id: 'retry',
                label: 'Retry',
                command: 'specforged.retryOperation',
                args: [operation.id],
                primary: true
            },
            {
                id: 'view-error',
                label: 'View Error',
                command: 'specforged.showOperationError',
                args: [operation.id]
            }
        ];

        const title = this.getOperationDisplayName(operation.type);
        const message = error || operation.error || `${title} failed`;

        await this.showNotification({
            type: 'failure',
            title: `❌ ${title} Failed`,
            message,
            operationId: operation.id,
            operationType: operation.type,
            actions,
            autoHide: false // Keep failure notifications visible
        });
    }

    async showOperationProgressNotification(
        operation: McpOperation,
        progress: number,
        message?: string
    ): Promise<void> {
        if (!this.shouldShowNotification('progress', operation)) {
            return;
        }

        const progressId = `progress-${operation.id}`;
        const title = this.getOperationDisplayName(operation.type);
        const progressMessage = message || `Processing ${title.toLowerCase()}...`;

        // Check if we already have a progress notification for this operation
        const existingProgress = this.activeProgressNotifications.get(progressId);

        if (existingProgress) {
            // Update existing progress
            existingProgress.progress = progress;
            existingProgress.message = progressMessage;

            // If progress is complete, remove from active notifications
            if (progress >= 100) {
                this.activeProgressNotifications.delete(progressId);
            }
        } else {
            // Create new progress notification
            const progressNotification: ProgressNotification = {
                id: progressId,
                operationId: operation.id,
                title: `⚙️ ${title} in Progress`,
                message: progressMessage,
                progress,
                cancellable: operation.status === McpOperationStatus.PENDING,
                startTime: Date.now(),
                estimatedDuration: operation.estimatedDurationMs
            };

            this.activeProgressNotifications.set(progressId, progressNotification);

            // Show progress notification using VS Code's progress API
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: progressNotification.title,
                cancellable: progressNotification.cancellable
            }, async (progressReporter, token) => {
                progressNotification.token = token;

                // Handle cancellation
                if (progressNotification.cancellable) {
                    token.onCancellationRequested(() => {
                        vscode.commands.executeCommand('specforged.cancelOperation', operation.id);
                        this.activeProgressNotifications.delete(progressId);
                    });
                }

                // Update progress
                progressReporter.report({
                    increment: progress,
                    message: progressMessage
                });

                // Wait for completion or cancellation
                return new Promise<void>((resolve) => {
                    const checkCompletion = () => {
                        const current = this.activeProgressNotifications.get(progressId);
                        if (!current || current.progress >= 100 || token.isCancellationRequested) {
                            resolve();
                        } else {
                            setTimeout(checkCompletion, 500);
                        }
                    };
                    checkCompletion();
                });
            });
        }
    }

    async showConflictNotification(
        conflictId: string,
        description: string,
        operationIds: string[]
    ): Promise<void> {
        if (!this.preferences.showConflictNotifications || !this.preferences.enableNotifications) {
            return;
        }

        const actions: NotificationAction[] = [
            {
                id: 'resolve-conflict',
                label: 'Resolve Conflict',
                command: 'specforged.resolveConflict',
                args: [conflictId],
                primary: true
            },
            {
                id: 'view-conflicts',
                label: 'View All Conflicts',
                command: 'specforged.showOperationQueue'
            }
        ];

        await this.showNotification({
            type: 'conflict',
            title: '⚠️ Operation Conflict Detected',
            message: description,
            actions,
            autoHide: false // Keep conflict notifications visible
        });
    }

    async showInfoNotification(
        title: string,
        message: string,
        actions: NotificationAction[] = []
    ): Promise<void> {
        if (!this.preferences.enableNotifications) {
            return;
        }

        await this.showNotification({
            type: 'info',
            title,
            message,
            actions,
            autoHide: true,
            duration: this.preferences.notificationDuration
        });
    }

    async showWarningNotification(
        title: string,
        message: string,
        actions: NotificationAction[] = []
    ): Promise<void> {
        if (!this.preferences.enableNotifications) {
            return;
        }

        await this.showNotification({
            type: 'warning',
            title,
            message,
            actions,
            autoHide: false
        });
    }

    // Core notification display method
    private async showNotification(notification: Omit<NotificationHistoryItem, 'id' | 'timestamp' | 'dismissed'>): Promise<void> {
        // Check quiet hours
        if (this.isQuietHours()) {
            console.log('Notification suppressed due to quiet hours');
            return;
        }

        const historyItem: NotificationHistoryItem = {
            id: `notification-${++this.notificationCounter}`,
            timestamp: new Date().toISOString(),
            dismissed: false,
            ...notification
        };

        // Add to history
        this.addToHistory(historyItem);

        // Show the notification using VS Code API
        const actionLabels = notification.actions?.map(action => action.label) || [];

        let result: string | undefined;

        switch (notification.type) {
            case 'success':
                result = await vscode.window.showInformationMessage(
                    `${notification.title}: ${notification.message}`,
                    ...actionLabels
                );
                break;

            case 'failure':
                result = await vscode.window.showErrorMessage(
                    `${notification.title}: ${notification.message}`,
                    ...actionLabels
                );
                break;

            case 'warning':
            case 'conflict':
                result = await vscode.window.showWarningMessage(
                    `${notification.title}: ${notification.message}`,
                    ...actionLabels
                );
                break;

            case 'info':
            default:
                result = await vscode.window.showInformationMessage(
                    `${notification.title}: ${notification.message}`,
                    ...actionLabels
                );
                break;
        }

        // Handle action selection
        if (result && notification.actions) {
            const selectedAction = notification.actions.find(action => action.label === result);
            if (selectedAction) {
                await this.executeNotificationAction(selectedAction);
            }
        }

        // Mark as dismissed if auto-hide and duration passed
        if (notification.autoHide && notification.duration) {
            setTimeout(() => {
                this.dismissNotification(historyItem.id);
            }, notification.duration);
        }

        // Fire event
        this.onNotificationShownEmitter.fire(historyItem);
    }

    private async executeNotificationAction(action: NotificationAction): Promise<void> {
        try {
            if (action.args && action.args.length > 0) {
                await vscode.commands.executeCommand(action.command, ...action.args);
            } else {
                await vscode.commands.executeCommand(action.command);
            }
        } catch (error) {
            console.error(`Failed to execute notification action ${action.id}:`, error);
            vscode.window.showErrorMessage(`Failed to execute action: ${action.label}`);
        }
    }

    // Utility methods

    private shouldShowNotification(type: string, operation?: McpOperation): boolean {
        if (!this.preferences.enableNotifications) {
            return false;
        }

        // Check type-specific preferences
        switch (type) {
            case 'success':
                if (!this.preferences.showSuccessNotifications) {
                    return false;
                }
                break;
            case 'failure':
                if (!this.preferences.showFailureNotifications) {
                    return false;
                }
                break;
            case 'progress':
                if (!this.preferences.showProgressNotifications) {
                    return false;
                }
                break;
            case 'conflict':
                if (!this.preferences.showConflictNotifications) {
                    return false;
                }
                break;
        }

        // Check operation-specific filters
        if (operation) {
            // Check priority filter
            if (operation.priority < this.preferences.priorityFilter) {
                return false;
            }

            // Check operation type filter
            if (!this.preferences.operationTypeFilters.includes(operation.type)) {
                return false;
            }
        }

        return true;
    }

    private isQuietHours(): boolean {
        if (!this.preferences.quietHours.enabled) {
            return false;
        }

        const now = new Date();
        const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        const startTime = this.preferences.quietHours.startTime;
        const endTime = this.preferences.quietHours.endTime;

        // Handle overnight quiet hours (e.g., 22:00 to 08:00)
        if (startTime > endTime) {
            return currentTime >= startTime || currentTime <= endTime;
        } else {
            return currentTime >= startTime && currentTime <= endTime;
        }
    }

    private getOperationDisplayName(type: McpOperationType): string {
        switch (type) {
            case McpOperationType.CREATE_SPEC:
                return 'Create Specification';
            case McpOperationType.UPDATE_REQUIREMENTS:
                return 'Update Requirements';
            case McpOperationType.UPDATE_DESIGN:
                return 'Update Design';
            case McpOperationType.UPDATE_TASKS:
                return 'Update Tasks';
            case McpOperationType.ADD_USER_STORY:
                return 'Add User Story';
            case McpOperationType.UPDATE_TASK_STATUS:
                return 'Update Task Status';
            case McpOperationType.DELETE_SPEC:
                return 'Delete Specification';
            case McpOperationType.SET_CURRENT_SPEC:
                return 'Set Current Specification';
            case McpOperationType.SYNC_STATUS:
                return 'Sync Status';
            case McpOperationType.HEARTBEAT:
                return 'Heartbeat';
            default:
                return 'Operation';
        }
    }

    private addToHistory(item: NotificationHistoryItem): void {
        this.history.unshift(item);

        // Limit history size
        if (this.history.length > this.maxHistorySize) {
            this.history = this.history.slice(0, this.maxHistorySize);
        }
    }

    // Public API methods

    getNotificationHistory(): NotificationHistoryItem[] {
        return [...this.history];
    }

    getActiveProgressNotifications(): ProgressNotification[] {
        return Array.from(this.activeProgressNotifications.values());
    }

    dismissNotification(notificationId: string): void {
        const notification = this.history.find(n => n.id === notificationId);
        if (notification && !notification.dismissed) {
            notification.dismissed = true;
            notification.dismissedAt = new Date().toISOString();
            this.onNotificationDismissedEmitter.fire(notificationId);
        }
    }

    clearHistory(): void {
        this.history = [];
    }

    clearDismissedNotifications(): void {
        this.history = this.history.filter(n => !n.dismissed);
    }

    updatePreferences(preferences: Partial<NotificationPreferences>): void {
        this.preferences = { ...this.preferences, ...preferences };
        this.onPreferencesChangedEmitter.fire(this.preferences);
    }

    getPreferences(): NotificationPreferences {
        return { ...this.preferences };
    }

    // Cleanup method
    dispose(): void {
        this.onNotificationShownEmitter.dispose();
        this.onNotificationDismissedEmitter.dispose();
        this.onPreferencesChangedEmitter.dispose();
        this.activeProgressNotifications.clear();
    }
}
