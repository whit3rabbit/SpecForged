import * as vscode from 'vscode';
import { NotificationManager, NotificationHistoryItem as NotificationHistoryData, NotificationAction } from '../services/notificationManager';

export class NotificationHistoryTreeItem extends vscode.TreeItem {
    constructor(
        public readonly notification: NotificationHistoryData,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(notification.title, collapsibleState);

        this.tooltip = this.createTooltip();
        this.description = this.createDescription();
        this.contextValue = this.createContextValue();
        this.iconPath = this.getIcon();
        this.command = this.getCommand();
    }

    private createTooltip(): string {
        const notification = this.notification;
        const timestamp = new Date(notification.timestamp).toLocaleString();

        let tooltip = `${notification.title}\n${notification.message}\n\nTime: ${timestamp}`;

        if (notification.operationType) {
            tooltip += `\nOperation: ${notification.operationType}`;
        }

        if (notification.operationId) {
            tooltip += `\nOperation ID: ${notification.operationId}`;
        }

        if (notification.dismissed) {
            const dismissedTime = notification.dismissedAt ?
                new Date(notification.dismissedAt).toLocaleString() : 'Unknown';
            tooltip += `\nDismissed: ${dismissedTime}`;
        }

        return tooltip;
    }

    private createDescription(): string {
        const notification = this.notification;
        const timestamp = new Date(notification.timestamp);
        const now = new Date();
        const diffMs = now.getTime() - timestamp.getTime();

        // Format relative time
        let timeAgo: string;
        if (diffMs < 60000) { // Less than 1 minute
            timeAgo = 'Just now';
        } else if (diffMs < 3600000) { // Less than 1 hour
            const minutes = Math.floor(diffMs / 60000);
            timeAgo = `${minutes}m ago`;
        } else if (diffMs < 86400000) { // Less than 1 day
            const hours = Math.floor(diffMs / 3600000);
            timeAgo = `${hours}h ago`;
        } else {
            const days = Math.floor(diffMs / 86400000);
            timeAgo = `${days}d ago`;
        }

        let description = timeAgo;

        if (notification.dismissed) {
            description += ' (dismissed)';
        }

        return description;
    }

    private createContextValue(): string {
        const notification = this.notification;
        let contextValue = `notification-${notification.type}`;

        if (notification.dismissed) {
            contextValue += '-dismissed';
        } else {
            contextValue += '-active';
        }

        if (notification.operationId) {
            contextValue += '-with-operation';
        }

        return contextValue;
    }

    private getIcon(): vscode.ThemeIcon {
        const notification = this.notification;

        switch (notification.type) {
            case 'success':
                return new vscode.ThemeIcon('check', new vscode.ThemeColor('notificationsInfoIcon.foreground'));
            case 'failure':
                return new vscode.ThemeIcon('error', new vscode.ThemeColor('notificationsErrorIcon.foreground'));
            case 'warning':
            case 'conflict':
                return new vscode.ThemeIcon('warning', new vscode.ThemeColor('notificationsWarningIcon.foreground'));
            case 'progress':
                return new vscode.ThemeIcon('sync~spin', new vscode.ThemeColor('notificationsInfoIcon.foreground'));
            case 'info':
            default:
                return new vscode.ThemeIcon('info', new vscode.ThemeColor('notificationsInfoIcon.foreground'));
        }
    }

    private getCommand(): vscode.Command | undefined {
        if (this.notification.actions && this.notification.actions.length > 0) {
            const primaryAction = this.notification.actions.find(a => a.primary) || this.notification.actions[0];
            return {
                command: 'specforged.executeNotificationAction',
                title: 'Execute Action',
                arguments: [this.notification.id, primaryAction.id]
            };
        }

        return {
            command: 'specforged.showNotificationDetails',
            title: 'Show Details',
            arguments: [this.notification.id]
        };
    }
}

export class NotificationActionItem extends vscode.TreeItem {
    constructor(
        public readonly action: NotificationAction,
        public readonly notificationId: string
    ) {
        super(action.label, vscode.TreeItemCollapsibleState.None);

        this.tooltip = action.tooltip || `Execute ${action.label}`;
        this.contextValue = 'notification-action';
        this.iconPath = action.primary ?
            new vscode.ThemeIcon('play', new vscode.ThemeColor('button.foreground')) :
            new vscode.ThemeIcon('chevron-right');

        this.command = {
            command: 'specforged.executeNotificationAction',
            title: 'Execute Action',
            arguments: [notificationId, action.id]
        };
    }
}

export class NotificationHistoryProvider implements vscode.TreeDataProvider<NotificationHistoryTreeItem | NotificationActionItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<NotificationHistoryTreeItem | NotificationActionItem | undefined | null | void> = new vscode.EventEmitter<NotificationHistoryTreeItem | NotificationActionItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<NotificationHistoryTreeItem | NotificationActionItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private groupByDate = true;
    private showDismissed = false;
    private filterType: string | undefined;

    constructor(private notificationManager: NotificationManager) {
        // Listen for notification changes
        this.notificationManager.onNotificationShown(() => {
            this.refresh();
        });

        this.notificationManager.onNotificationDismissed(() => {
            this.refresh();
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: NotificationHistoryTreeItem | NotificationActionItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: NotificationHistoryTreeItem | NotificationActionItem): Thenable<(NotificationHistoryTreeItem | NotificationActionItem)[]> {
        if (!element) {
            // Root level - show notifications or date groups
            return Promise.resolve(this.getRootItems());
        } else if (element instanceof NotificationHistoryTreeItem) {
            // Show actions for this notification
            return Promise.resolve(this.getNotificationActions(element));
        } else {
            // Action items have no children
            return Promise.resolve([]);
        }
    }

    private getRootItems(): (NotificationHistoryTreeItem | NotificationActionItem)[] {
        let notifications = this.notificationManager.getNotificationHistory();

        // Apply filters
        if (!this.showDismissed) {
            notifications = notifications.filter(n => !n.dismissed);
        }

        if (this.filterType) {
            notifications = notifications.filter(n => n.type === this.filterType);
        }

        if (this.groupByDate) {
            return this.groupNotificationsByDate(notifications);
        } else {
            return notifications.map(n => new NotificationHistoryTreeItem(n,
                n.actions && n.actions.length > 0 ?
                vscode.TreeItemCollapsibleState.Collapsed :
                vscode.TreeItemCollapsibleState.None
            ));
        }
    }

    private groupNotificationsByDate(notifications: NotificationHistoryData[]): NotificationHistoryTreeItem[] {
        const groups = new Map<string, NotificationHistoryData[]>();

        notifications.forEach(notification => {
            const date = new Date(notification.timestamp).toDateString();
            if (!groups.has(date)) {
                groups.set(date, []);
            }
            groups.get(date)!.push(notification);
        });

        const result: NotificationHistoryTreeItem[] = [];

        // Sort dates (newest first)
        const sortedDates = Array.from(groups.keys()).sort((a, b) =>
            new Date(b).getTime() - new Date(a).getTime()
        );

        sortedDates.forEach(date => {
            const dateNotifications = groups.get(date)!;

            // Create date group header
            const dateHeader = new NotificationHistoryTreeItem({
                id: `date-${date}`,
                timestamp: date,
                type: 'info',
                title: this.formatDateHeader(date),
                message: `${dateNotifications.length} notifications`,
                dismissed: false,
                autoHide: false
            }, vscode.TreeItemCollapsibleState.Expanded);

            dateHeader.contextValue = 'notification-date-group';
            dateHeader.iconPath = new vscode.ThemeIcon('calendar');

            result.push(dateHeader);

            // Add notifications for this date
            dateNotifications
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                .forEach(notification => {
                    result.push(new NotificationHistoryTreeItem(notification,
                        notification.actions && notification.actions.length > 0 ?
                        vscode.TreeItemCollapsibleState.Collapsed :
                        vscode.TreeItemCollapsibleState.None
                    ));
                });
        });

        return result;
    }

    private formatDateHeader(dateString: string): string {
        const date = new Date(dateString);
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (date.toDateString() === today.toDateString()) {
            return 'Today';
        } else if (date.toDateString() === yesterday.toDateString()) {
            return 'Yesterday';
        } else {
            return date.toLocaleDateString();
        }
    }

    private getNotificationActions(notificationItem: NotificationHistoryTreeItem): NotificationActionItem[] {
        const notification = notificationItem.notification;

        if (!notification.actions || notification.actions.length === 0) {
            return [];
        }

        return notification.actions.map(action =>
            new NotificationActionItem(action, notification.id)
        );
    }

    // View configuration methods

    setGroupByDate(groupByDate: boolean): void {
        this.groupByDate = groupByDate;
        this.refresh();
    }

    setShowDismissed(showDismissed: boolean): void {
        this.showDismissed = showDismissed;
        this.refresh();
    }

    setFilterType(filterType: string | undefined): void {
        this.filterType = filterType;
        this.refresh();
    }

    getViewConfiguration(): { groupByDate: boolean; showDismissed: boolean; filterType: string | undefined } {
        return {
            groupByDate: this.groupByDate,
            showDismissed: this.showDismissed,
            filterType: this.filterType
        };
    }
}

export class NotificationHistoryView {
    private treeView: vscode.TreeView<NotificationHistoryTreeItem | NotificationActionItem>;
    private provider: NotificationHistoryProvider;

    constructor(
        private notificationManager: NotificationManager,
        private context: vscode.ExtensionContext
    ) {
        this.provider = new NotificationHistoryProvider(notificationManager);

        this.treeView = vscode.window.createTreeView('specforged.notificationHistory', {
            treeDataProvider: this.provider,
            canSelectMany: false,
            showCollapseAll: true
        });

        this.setupCommands();
        this.setupContextMenus();

        context.subscriptions.push(this.treeView);
    }

    private setupCommands(): void {
        // Refresh command
        const refreshCommand = vscode.commands.registerCommand('specforged.refreshNotificationHistory', () => {
            this.provider.refresh();
        });
        this.context.subscriptions.push(refreshCommand);

        // Clear history command
        const clearHistoryCommand = vscode.commands.registerCommand('specforged.clearNotificationHistory', async () => {
            const result = await vscode.window.showWarningMessage(
                'Are you sure you want to clear all notification history?',
                { modal: true },
                'Clear All', 'Cancel'
            );

            if (result === 'Clear All') {
                this.notificationManager.clearHistory();
                this.provider.refresh();
                vscode.window.showInformationMessage('Notification history cleared');
            }
        });
        this.context.subscriptions.push(clearHistoryCommand);

        // Clear dismissed notifications command
        const clearDismissedCommand = vscode.commands.registerCommand('specforged.clearDismissedNotifications', () => {
            this.notificationManager.clearDismissedNotifications();
            this.provider.refresh();
            vscode.window.showInformationMessage('Dismissed notifications cleared');
        });
        this.context.subscriptions.push(clearDismissedCommand);

        // Toggle group by date command
        const toggleGroupByDateCommand = vscode.commands.registerCommand('specforged.toggleNotificationGroupByDate', () => {
            const config = this.provider.getViewConfiguration();
            this.provider.setGroupByDate(!config.groupByDate);
        });
        this.context.subscriptions.push(toggleGroupByDateCommand);

        // Toggle show dismissed command
        const toggleShowDismissedCommand = vscode.commands.registerCommand('specforged.toggleShowDismissedNotifications', () => {
            const config = this.provider.getViewConfiguration();
            this.provider.setShowDismissed(!config.showDismissed);
        });
        this.context.subscriptions.push(toggleShowDismissedCommand);

        // Filter by type commands
        const filterCommands = ['success', 'failure', 'warning', 'conflict', 'progress', 'info'].map(type => {
            return vscode.commands.registerCommand(`specforged.filterNotifications${type.charAt(0).toUpperCase() + type.slice(1)}`, () => {
                const config = this.provider.getViewConfiguration();
                const newFilter = config.filterType === type ? undefined : type;
                this.provider.setFilterType(newFilter);
            });
        });
        filterCommands.forEach(cmd => this.context.subscriptions.push(cmd));

        // Show notification details command
        const showDetailsCommand = vscode.commands.registerCommand('specforged.showNotificationDetails', (notificationId: string) => {
            const history = this.notificationManager.getNotificationHistory();
            const notification = history.find(n => n.id === notificationId);

            if (notification) {
                this.showNotificationDetailsWebview(notification);
            }
        });
        this.context.subscriptions.push(showDetailsCommand);

        // Execute notification action command
        const executeActionCommand = vscode.commands.registerCommand('specforged.executeNotificationAction', async (notificationId: string, actionId: string) => {
            const history = this.notificationManager.getNotificationHistory();
            const notification = history.find(n => n.id === notificationId);

            if (notification && notification.actions) {
                const action = notification.actions.find(a => a.id === actionId);
                if (action) {
                    try {
                        if (action.args && action.args.length > 0) {
                            await vscode.commands.executeCommand(action.command, ...action.args);
                        } else {
                            await vscode.commands.executeCommand(action.command);
                        }
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to execute action: ${action.label}`);
                        console.error('Failed to execute notification action:', error);
                    }
                }
            }
        });
        this.context.subscriptions.push(executeActionCommand);

        // Dismiss notification command
        const dismissCommand = vscode.commands.registerCommand('specforged.dismissNotification', (notificationId: string) => {
            this.notificationManager.dismissNotification(notificationId);
        });
        this.context.subscriptions.push(dismissCommand);
    }

    private setupContextMenus(): void {
        // Context menu commands are defined in package.json and handled by the commands above
    }

    private showNotificationDetailsWebview(notification: NotificationHistoryData): void {
        const panel = vscode.window.createWebviewPanel(
            'notificationDetails',
            `Notification Details - ${notification.title}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = this.getNotificationDetailsHtml(notification);
    }

    private getNotificationDetailsHtml(notification: NotificationHistoryData): string {
        const timestamp = new Date(notification.timestamp).toLocaleString();
        const dismissedTime = notification.dismissedAt ?
            new Date(notification.dismissedAt).toLocaleString() : null;

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Notification Details</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
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
                .title {
                    font-size: 1.5em;
                    font-weight: bold;
                    margin-bottom: 10px;
                }
                .type-badge {
                    display: inline-block;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 0.8em;
                    font-weight: bold;
                    text-transform: uppercase;
                }
                .type-success { background-color: var(--vscode-testing-iconPassed); color: white; }
                .type-failure { background-color: var(--vscode-testing-iconFailed); color: white; }
                .type-warning { background-color: var(--vscode-testing-iconQueued); color: white; }
                .type-conflict { background-color: var(--vscode-testing-iconQueued); color: white; }
                .type-info { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); }
                .type-progress { background-color: var(--vscode-progressBar-background); color: white; }
                .section {
                    margin-bottom: 20px;
                }
                .section-title {
                    font-weight: bold;
                    margin-bottom: 8px;
                    color: var(--vscode-textLink-foreground);
                }
                .metadata {
                    display: grid;
                    grid-template-columns: auto 1fr;
                    gap: 10px;
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                    padding: 15px;
                    border-radius: 4px;
                }
                .metadata-label {
                    font-weight: bold;
                }
                .actions {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                .action-button {
                    padding: 8px 12px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    text-align: left;
                }
                .action-button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .action-button.primary {
                    background-color: var(--vscode-button-background);
                    font-weight: bold;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="title">${notification.title}</div>
                <span class="type-badge type-${notification.type}">${notification.type}</span>
            </div>

            <div class="section">
                <div class="section-title">Message</div>
                <p>${notification.message}</p>
            </div>

            <div class="section">
                <div class="section-title">Details</div>
                <div class="metadata">
                    <span class="metadata-label">Timestamp:</span>
                    <span>${timestamp}</span>

                    <span class="metadata-label">Status:</span>
                    <span>${notification.dismissed ? 'Dismissed' : 'Active'}</span>

                    ${dismissedTime ? `
                    <span class="metadata-label">Dismissed At:</span>
                    <span>${dismissedTime}</span>
                    ` : ''}

                    ${notification.operationType ? `
                    <span class="metadata-label">Operation Type:</span>
                    <span>${notification.operationType}</span>
                    ` : ''}

                    ${notification.operationId ? `
                    <span class="metadata-label">Operation ID:</span>
                    <span>${notification.operationId}</span>
                    ` : ''}

                    <span class="metadata-label">Auto Hide:</span>
                    <span>${notification.autoHide ? 'Yes' : 'No'}</span>

                    ${notification.duration ? `
                    <span class="metadata-label">Duration:</span>
                    <span>${notification.duration}ms</span>
                    ` : ''}
                </div>
            </div>

            ${notification.actions && notification.actions.length > 0 ? `
            <div class="section">
                <div class="section-title">Available Actions</div>
                <div class="actions">
                    ${notification.actions.map(action => `
                        <button class="action-button ${action.primary ? 'primary' : ''}"
                                onclick="executeAction('${action.command}', ${JSON.stringify(action.args || [])})">
                            ${action.label}
                            ${action.tooltip ? `<br><small>${action.tooltip}</small>` : ''}
                        </button>
                    `).join('')}
                </div>
            </div>
            ` : ''}

            <script>
                function executeAction(command, args) {
                    // This would need to be implemented to communicate back to the extension
                    console.log('Execute action:', command, args);
                }
            </script>
        </body>
        </html>
        `;
    }

    refresh(): void {
        this.provider.refresh();
    }

    dispose(): void {
        this.treeView.dispose();
    }
}
