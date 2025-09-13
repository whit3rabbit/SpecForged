import * as vscode from 'vscode';
import { NotificationManager } from '../services/notificationManager';
import { McpSyncService } from '../services/mcpSyncService';
import { ConflictResolver } from '../utils/conflictResolver';
import { McpOperationValidator } from '../models/mcpOperation';

export class NotificationCommandHandler {
    constructor(
        private notificationManager: NotificationManager,
        private mcpSyncService: McpSyncService,
        private conflictResolver: ConflictResolver
    ) {}

    registerCommands(context: vscode.ExtensionContext): void {
        // Show operation result command
        const showOperationResultCommand = vscode.commands.registerCommand(
            'specforged.showOperationResult',
            async (operationId: string) => {
                await this.showOperationResult(operationId);
            }
        );
        context.subscriptions.push(showOperationResultCommand);

        // Show operation error command
        const showOperationErrorCommand = vscode.commands.registerCommand(
            'specforged.showOperationError',
            async (operationId: string) => {
                await this.showOperationError(operationId);
            }
        );
        context.subscriptions.push(showOperationErrorCommand);

        // Retry operation command
        const retryOperationCommand = vscode.commands.registerCommand(
            'specforged.retryOperation',
            async (operationId: string) => {
                await this.retryOperation(operationId);
            }
        );
        context.subscriptions.push(retryOperationCommand);

        // Cancel operation command
        const cancelOperationCommand = vscode.commands.registerCommand(
            'specforged.cancelOperation',
            async (operationId: string) => {
                await this.cancelOperation(operationId);
            }
        );
        context.subscriptions.push(cancelOperationCommand);

        // Resolve conflict command
        const resolveConflictCommand = vscode.commands.registerCommand(
            'specforged.resolveConflict',
            async (conflictId: string) => {
                await this.resolveConflict(conflictId);
            }
        );
        context.subscriptions.push(resolveConflictCommand);

        // Open specification command
        const openSpecificationCommand = vscode.commands.registerCommand(
            'specforged.openSpecification',
            async (specId: string) => {
                await this.openSpecification(specId);
            }
        );
        context.subscriptions.push(openSpecificationCommand);

        // Show notification preferences command
        const showNotificationPreferencesCommand = vscode.commands.registerCommand(
            'specforged.showNotificationPreferences',
            async () => {
                await this.showNotificationPreferences();
            }
        );
        context.subscriptions.push(showNotificationPreferencesCommand);

        // Test notification command (for development/debugging)
        const testNotificationCommand = vscode.commands.registerCommand(
            'specforged.testNotification',
            async () => {
                await this.testNotification();
            }
        );
        context.subscriptions.push(testNotificationCommand);
    }

    private async showOperationResult(operationId: string): Promise<void> {
        try {
            const queue = this.mcpSyncService.getOperationQueue();
            const operation = queue.operations.find(op => op.id === operationId);

            if (!operation) {
                vscode.window.showErrorMessage(`Operation ${operationId} not found`);
                return;
            }

            const panel = vscode.window.createWebviewPanel(
                'operationResult',
                `Operation Result - ${operation.type}`,
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            panel.webview.html = this.getOperationResultHtml(operation);
        } catch (error) {
            console.error('Failed to show operation result:', error);
            vscode.window.showErrorMessage('Failed to show operation result');
        }
    }

    private async showOperationError(operationId: string): Promise<void> {
        try {
            const queue = this.mcpSyncService.getOperationQueue();
            const operation = queue.operations.find(op => op.id === operationId);

            if (!operation) {
                vscode.window.showErrorMessage(`Operation ${operationId} not found`);
                return;
            }

            if (!operation.error) {
                vscode.window.showInformationMessage('No error information available for this operation');
                return;
            }

            const panel = vscode.window.createWebviewPanel(
                'operationError',
                `Operation Error - ${operation.type}`,
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            panel.webview.html = this.getOperationErrorHtml(operation);
        } catch (error) {
            console.error('Failed to show operation error:', error);
            vscode.window.showErrorMessage('Failed to show operation error');
        }
    }

    private async retryOperation(operationId: string): Promise<void> {
        try {
            const queue = this.mcpSyncService.getOperationQueue();
            const operation = queue.operations.find(op => op.id === operationId);

            if (!operation) {
                vscode.window.showErrorMessage(`Operation ${operationId} not found`);
                return;
            }

            if (!McpOperationValidator.canRetry(operation)) {
                vscode.window.showWarningMessage('This operation cannot be retried');
                return;
            }

            // Reset operation status for retry
            operation.status = 'pending' as any;
            operation.error = undefined;
            operation.retryCount++;
            operation.startedAt = undefined;
            operation.completedAt = undefined;

            await this.notificationManager.showInfoNotification(
                'Operation Retry',
                `Retrying ${this.getOperationDisplayName(operation.type)}...`,
                []
            );

            // The operation will be picked up by the next processing cycle
            console.log(`Operation ${operationId} queued for retry`);

        } catch (error) {
            console.error('Failed to retry operation:', error);
            vscode.window.showErrorMessage('Failed to retry operation');
        }
    }

    private async cancelOperation(operationId: string): Promise<void> {
        try {
            const queue = this.mcpSyncService.getOperationQueue();
            const operation = queue.operations.find(op => op.id === operationId);

            if (!operation) {
                vscode.window.showErrorMessage(`Operation ${operationId} not found`);
                return;
            }

            if (operation.status === 'completed' as any || operation.status === 'cancelled' as any) {
                vscode.window.showInformationMessage('Operation is already completed or cancelled');
                return;
            }

            operation.status = 'cancelled' as any;
            operation.completedAt = new Date().toISOString();

            await this.notificationManager.showInfoNotification(
                'Operation Cancelled',
                `${this.getOperationDisplayName(operation.type)} has been cancelled`,
                []
            );

            console.log(`Operation ${operationId} cancelled`);

        } catch (error) {
            console.error('Failed to cancel operation:', error);
            vscode.window.showErrorMessage('Failed to cancel operation');
        }
    }

    private async resolveConflict(conflictId: string): Promise<void> {
        try {
            const conflicts = this.conflictResolver.getActiveConflicts();
            const conflict = conflicts.find(c => c.id === conflictId);

            if (!conflict) {
                vscode.window.showErrorMessage(`Conflict ${conflictId} not found`);
                return;
            }

            // Show conflict resolution options
            const options = [
                'Auto Resolve',
                'Manual Resolution',
                'Cancel Conflicting Operations',
                'View Details'
            ];

            const selection = await vscode.window.showQuickPick(options, {
                placeHolder: 'Choose how to resolve the conflict',
                title: `Resolve Conflict: ${conflict.description}`
            });

            switch (selection) {
                case 'Auto Resolve':
                    const resolved = await this.conflictResolver.resolveConflict(conflictId);
                    if (resolved) {
                        await this.notificationManager.showInfoNotification(
                            'Conflict Resolved',
                            'Conflict has been automatically resolved',
                            []
                        );
                    } else {
                        vscode.window.showWarningMessage('Could not automatically resolve conflict');
                    }
                    break;

                case 'Manual Resolution':
                    // Open conflict resolution UI
                    vscode.commands.executeCommand('specforged.showOperationQueue');
                    break;

                case 'Cancel Conflicting Operations':
                    // Cancel all operations involved in the conflict
                    for (const operation of conflict.operations) {
                        await this.cancelOperation(operation.id);
                    }
                    break;

                case 'View Details':
                    // Show detailed conflict information
                    this.showConflictDetails(conflict);
                    break;
            }

        } catch (error) {
            console.error('Failed to resolve conflict:', error);
            vscode.window.showErrorMessage('Failed to resolve conflict');
        }
    }

    private async openSpecification(specId: string): Promise<void> {
        try {
            // Try to open the specification files
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder found');
                return;
            }

            const specPath = vscode.Uri.joinPath(workspaceFolder.uri, '.specifications', specId);

            // Try to open requirements.md first
            const requirementsPath = vscode.Uri.joinPath(specPath, 'requirements.md');

            try {
                const document = await vscode.workspace.openTextDocument(requirementsPath);
                await vscode.window.showTextDocument(document);
            } catch {
                // If requirements.md doesn't exist, try to open the spec folder
                try {
                    await vscode.commands.executeCommand('revealInExplorer', specPath);
                } catch {
                    vscode.window.showErrorMessage(`Could not open specification: ${specId}`);
                }
            }

        } catch (error) {
            console.error('Failed to open specification:', error);
            vscode.window.showErrorMessage('Failed to open specification');
        }
    }

    private async showNotificationPreferences(): Promise<void> {
        try {
            const preferences = this.notificationManager.getPreferences();

            const panel = vscode.window.createWebviewPanel(
                'notificationPreferences',
                'Notification Preferences',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            panel.webview.html = this.getNotificationPreferencesHtml(preferences);

            // Handle messages from the webview
            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.command) {
                    case 'updatePreferences':
                        this.notificationManager.updatePreferences(message.preferences);
                        vscode.window.showInformationMessage('Notification preferences updated');
                        break;
                }
            });

        } catch (error) {
            console.error('Failed to show notification preferences:', error);
            vscode.window.showErrorMessage('Failed to show notification preferences');
        }
    }

    private async testNotification(): Promise<void> {
        try {
            const options = [
                'Success Notification',
                'Failure Notification',
                'Progress Notification',
                'Conflict Notification',
                'Info Notification',
                'Warning Notification'
            ];

            const selection = await vscode.window.showQuickPick(options, {
                placeHolder: 'Choose notification type to test'
            });

            switch (selection) {
                case 'Success Notification':
                    await this.notificationManager.showInfoNotification(
                        '✅ Test Success',
                        'This is a test success notification',
                        [{
                            id: 'test-action',
                            label: 'Test Action',
                            command: 'specforged.showNotificationPreferences'
                        }]
                    );
                    break;

                case 'Failure Notification':
                    await this.notificationManager.showWarningNotification(
                        '❌ Test Failure',
                        'This is a test failure notification',
                        [{
                            id: 'retry-test',
                            label: 'Retry',
                            command: 'specforged.testNotification'
                        }]
                    );
                    break;

                case 'Info Notification':
                    await this.notificationManager.showInfoNotification(
                        'ℹ️ Test Info',
                        'This is a test info notification',
                        []
                    );
                    break;

                case 'Warning Notification':
                    await this.notificationManager.showWarningNotification(
                        '⚠️ Test Warning',
                        'This is a test warning notification',
                        []
                    );
                    break;

                default:
                    vscode.window.showInformationMessage('Test notification cancelled');
            }

        } catch (error) {
            console.error('Failed to test notification:', error);
            vscode.window.showErrorMessage('Failed to test notification');
        }
    }

    // Helper methods

    private getOperationDisplayName(type: string): string {
        switch (type) {
            case 'create_spec': return 'Create Specification';
            case 'update_requirements': return 'Update Requirements';
            case 'update_design': return 'Update Design';
            case 'update_tasks': return 'Update Tasks';
            case 'add_user_story': return 'Add User Story';
            case 'update_task_status': return 'Update Task Status';
            case 'delete_spec': return 'Delete Specification';
            case 'set_current_spec': return 'Set Current Specification';
            case 'sync_status': return 'Sync Status';
            case 'heartbeat': return 'Heartbeat';
            default: return 'Operation';
        }
    }

    private getOperationResultHtml(operation: any): string {
        const timestamp = new Date(operation.timestamp).toLocaleString();
        const completedAt = operation.completedAt ? new Date(operation.completedAt).toLocaleString() : 'N/A';
        const duration = operation.actualDurationMs ? `${operation.actualDurationMs}ms` : 'N/A';

        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Operation Result</title>
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
                .status {
                    display: inline-block;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 0.8em;
                    font-weight: bold;
                    text-transform: uppercase;
                }
                .status-completed { background-color: var(--vscode-testing-iconPassed); color: white; }
                .status-failed { background-color: var(--vscode-testing-iconFailed); color: white; }
                .status-pending { background-color: var(--vscode-testing-iconQueued); color: white; }
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
                .result-data {
                    background-color: var(--vscode-textCodeBlock-background);
                    padding: 15px;
                    border-radius: 4px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: var(--vscode-editor-font-size);
                    white-space: pre-wrap;
                    overflow-x: auto;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="title">${this.getOperationDisplayName(operation.type)} Result</div>
                <span class="status status-${operation.status}">${operation.status}</span>
            </div>

            <div class="section">
                <div class="section-title">Operation Details</div>
                <div class="metadata">
                    <span class="metadata-label">ID:</span>
                    <span>${operation.id}</span>

                    <span class="metadata-label">Type:</span>
                    <span>${operation.type}</span>

                    <span class="metadata-label">Started:</span>
                    <span>${timestamp}</span>

                    <span class="metadata-label">Completed:</span>
                    <span>${completedAt}</span>

                    <span class="metadata-label">Duration:</span>
                    <span>${duration}</span>

                    <span class="metadata-label">Priority:</span>
                    <span>${operation.priority}</span>

                    <span class="metadata-label">Retry Count:</span>
                    <span>${operation.retryCount}/${operation.maxRetries}</span>
                </div>
            </div>

            ${operation.result ? `
            <div class="section">
                <div class="section-title">Result Data</div>
                <div class="result-data">${JSON.stringify(operation.result, null, 2)}</div>
            </div>
            ` : ''}

            ${operation.error ? `
            <div class="section">
                <div class="section-title">Error Information</div>
                <div class="result-data" style="color: var(--vscode-errorForeground);">${operation.error}</div>
            </div>
            ` : ''}
        </body>
        </html>
        `;
    }

    private getOperationErrorHtml(operation: any): string {
        return this.getOperationResultHtml(operation); // Reuse the same template
    }

    private showConflictDetails(conflict: any): void {
        const panel = vscode.window.createWebviewPanel(
            'conflictDetails',
            `Conflict Details - ${conflict.id}`,
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Conflict Details</title>
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
                .section {
                    margin-bottom: 20px;
                }
                .section-title {
                    font-weight: bold;
                    margin-bottom: 8px;
                    color: var(--vscode-textLink-foreground);
                }
                .operation-list {
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                    padding: 15px;
                    border-radius: 4px;
                }
                .operation-item {
                    margin-bottom: 10px;
                    padding: 8px;
                    background-color: var(--vscode-textCodeBlock-background);
                    border-radius: 4px;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="title">⚠️ Conflict Details</div>
            </div>

            <div class="section">
                <div class="section-title">Conflict Information</div>
                <p><strong>ID:</strong> ${conflict.id}</p>
                <p><strong>Type:</strong> ${conflict.type}</p>
                <p><strong>Description:</strong> ${conflict.description}</p>
                <p><strong>Detected:</strong> ${new Date(conflict.timestamp).toLocaleString()}</p>
            </div>

            <div class="section">
                <div class="section-title">Conflicting Operations</div>
                <div class="operation-list">
                    ${conflict.operations.map((op: any) => `
                        <div class="operation-item">
                            <strong>${this.getOperationDisplayName(op.type)}</strong><br>
                            ID: ${op.id}<br>
                            Status: ${op.status}<br>
                            Priority: ${op.priority}
                        </div>
                    `).join('')}
                </div>
            </div>
        </body>
        </html>
        `;
    }

    private getNotificationPreferencesHtml(preferences: any): string {
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Notification Preferences</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 20px;
                    line-height: 1.6;
                }
                .form-group {
                    margin-bottom: 20px;
                }
                .form-group label {
                    display: block;
                    margin-bottom: 5px;
                    font-weight: bold;
                }
                .form-group input[type="checkbox"] {
                    margin-right: 8px;
                }
                .form-group input[type="number"],
                .form-group input[type="time"],
                .form-group select {
                    width: 200px;
                    padding: 4px 8px;
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                }
                .button {
                    padding: 8px 16px;
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    margin-right: 10px;
                }
                .button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                .section {
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                    padding: 15px;
                    margin-bottom: 20px;
                }
                .section-title {
                    font-weight: bold;
                    margin-bottom: 15px;
                    color: var(--vscode-textLink-foreground);
                }
            </style>
        </head>
        <body>
            <h1>Notification Preferences</h1>

            <form id="preferencesForm">
                <div class="section">
                    <div class="section-title">General Settings</div>

                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="enableNotifications" ${preferences.enableNotifications ? 'checked' : ''}>
                            Enable Notifications
                        </label>
                    </div>

                    <div class="form-group">
                        <label for="notificationDuration">Notification Duration (ms):</label>
                        <input type="number" id="notificationDuration" value="${preferences.notificationDuration}" min="1000" max="30000" step="1000">
                    </div>

                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="enableSounds" ${preferences.enableSounds ? 'checked' : ''}>
                            Enable Sounds
                        </label>
                    </div>

                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="enableBadges" ${preferences.enableBadges ? 'checked' : ''}>
                            Enable Badges
                        </label>
                    </div>
                </div>

                <div class="section">
                    <div class="section-title">Notification Types</div>

                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="showSuccessNotifications" ${preferences.showSuccessNotifications ? 'checked' : ''}>
                            Show Success Notifications
                        </label>
                    </div>

                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="showFailureNotifications" ${preferences.showFailureNotifications ? 'checked' : ''}>
                            Show Failure Notifications
                        </label>
                    </div>

                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="showProgressNotifications" ${preferences.showProgressNotifications ? 'checked' : ''}>
                            Show Progress Notifications
                        </label>
                    </div>

                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="showConflictNotifications" ${preferences.showConflictNotifications ? 'checked' : ''}>
                            Show Conflict Notifications
                        </label>
                    </div>
                </div>

                <div class="section">
                    <div class="section-title">Quiet Hours</div>

                    <div class="form-group">
                        <label>
                            <input type="checkbox" id="quietHoursEnabled" ${preferences.quietHours.enabled ? 'checked' : ''}>
                            Enable Quiet Hours
                        </label>
                    </div>

                    <div class="form-group">
                        <label for="quietHoursStart">Start Time:</label>
                        <input type="time" id="quietHoursStart" value="${preferences.quietHours.startTime}">
                    </div>

                    <div class="form-group">
                        <label for="quietHoursEnd">End Time:</label>
                        <input type="time" id="quietHoursEnd" value="${preferences.quietHours.endTime}">
                    </div>
                </div>

                <div class="form-group">
                    <button type="button" class="button" onclick="savePreferences()">Save Preferences</button>
                    <button type="button" class="button" onclick="resetToDefaults()">Reset to Defaults</button>
                </div>
            </form>

            <script>
                const vscode = acquireVsCodeApi();

                function savePreferences() {
                    const preferences = {
                        enableNotifications: document.getElementById('enableNotifications').checked,
                        showSuccessNotifications: document.getElementById('showSuccessNotifications').checked,
                        showFailureNotifications: document.getElementById('showFailureNotifications').checked,
                        showProgressNotifications: document.getElementById('showProgressNotifications').checked,
                        showConflictNotifications: document.getElementById('showConflictNotifications').checked,
                        notificationDuration: parseInt(document.getElementById('notificationDuration').value),
                        enableSounds: document.getElementById('enableSounds').checked,
                        enableBadges: document.getElementById('enableBadges').checked,
                        quietHours: {
                            enabled: document.getElementById('quietHoursEnabled').checked,
                            startTime: document.getElementById('quietHoursStart').value,
                            endTime: document.getElementById('quietHoursEnd').value
                        }
                    };

                    vscode.postMessage({
                        command: 'updatePreferences',
                        preferences: preferences
                    });
                }

                function resetToDefaults() {
                    if (confirm('Are you sure you want to reset all preferences to defaults?')) {
                        // Reset form to default values
                        document.getElementById('enableNotifications').checked = true;
                        document.getElementById('showSuccessNotifications').checked = true;
                        document.getElementById('showFailureNotifications').checked = true;
                        document.getElementById('showProgressNotifications').checked = true;
                        document.getElementById('showConflictNotifications').checked = true;
                        document.getElementById('notificationDuration').value = '5000';
                        document.getElementById('enableSounds').checked = true;
                        document.getElementById('enableBadges').checked = true;
                        document.getElementById('quietHoursEnabled').checked = false;
                        document.getElementById('quietHoursStart').value = '22:00';
                        document.getElementById('quietHoursEnd').value = '08:00';

                        savePreferences();
                    }
                }
            </script>
        </body>
        </html>
        `;
    }
}
