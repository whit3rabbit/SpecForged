import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import {
    NotificationManager,
    NotificationPreferences,
    NotificationHistoryItem,
    NotificationAction,
    ProgressNotification
} from '../../services/notificationManager';
import {
    McpOperation,
    McpOperationStatus,
    McpOperationType,
    McpOperationPriority,
    McpOperationFactory,
    McpOperationResult
} from '../../models/mcpOperation';

suite('NotificationManager Test Suite', () => {
    let notificationManager: NotificationManager;
    let mockShowInformationMessage: sinon.SinonStub;
    let mockShowErrorMessage: sinon.SinonStub;
    let mockShowWarningMessage: sinon.SinonStub;
    let mockWithProgress: sinon.SinonStub;
    let mockConfiguration: any;
    let mockConfigurationWatcher: vscode.Disposable;

    suiteSetup(async () => {
        // Setup sinon for mocking VS Code APIs

        // Mock VS Code window methods
        mockShowInformationMessage = sinon.stub(vscode.window, 'showInformationMessage');
        mockShowErrorMessage = sinon.stub(vscode.window, 'showErrorMessage');
        mockShowWarningMessage = sinon.stub(vscode.window, 'showWarningMessage');
        mockWithProgress = sinon.stub(vscode.window, 'withProgress');

        // Mock configuration
        mockConfiguration = {
            get: sinon.stub(),
            update: sinon.stub(),
            inspect: sinon.stub(),
            has: sinon.stub()
        };

        // Setup default configuration values with proper fallback behavior
        mockConfiguration.get.callsFake((key: string, defaultValue: any) => {
            switch (key) {
                case 'enabled': return defaultValue ?? true;
                case 'showSuccess': return defaultValue ?? true;
                case 'showFailure': return defaultValue ?? true;
                case 'showProgress': return defaultValue ?? true;
                case 'showConflicts': return defaultValue ?? true;
                case 'duration': return defaultValue ?? 5000;
                case 'enableSounds': return defaultValue ?? true;
                case 'enableBadges': return defaultValue ?? true;
                case 'quietHours.enabled': return defaultValue ?? false;
                case 'quietHours.startTime': return defaultValue ?? '22:00';
                case 'quietHours.endTime': return defaultValue ?? '08:00';
                case 'priorityFilter': return defaultValue ?? McpOperationPriority.LOW;
                case 'operationTypeFilters': return defaultValue ?? Object.values(McpOperationType);
                default: return defaultValue;
            }
        });

        // Mock workspace configuration
        const originalGetConfiguration = vscode.workspace.getConfiguration;
        vscode.workspace.getConfiguration = sinon.stub().returns(mockConfiguration);

        // Mock configuration change events
        const eventEmitter = new vscode.EventEmitter<vscode.ConfigurationChangeEvent>();
        mockConfigurationWatcher = eventEmitter;
        const originalOnDidChangeConfiguration = vscode.workspace.onDidChangeConfiguration;
        (vscode.workspace as any).onDidChangeConfiguration = sinon.stub().returns(eventEmitter.event);
    });

    setup(() => {
        // Reset mocks before each test
        mockShowInformationMessage.reset();
        mockShowErrorMessage.reset();
        mockShowWarningMessage.reset();
        mockWithProgress.reset();
        mockConfiguration.get.resetBehavior();
        mockConfiguration.update.reset();

        // Setup default mock behaviors
        mockShowInformationMessage.resolves(undefined);
        mockShowErrorMessage.resolves(undefined);
        mockShowWarningMessage.resolves(undefined);
        mockWithProgress.resolves();

        // Create fresh notification manager instance
        notificationManager = new NotificationManager();
    });

    teardown(() => {
        if (notificationManager) {
            notificationManager.dispose();
        }
    });

    suiteTeardown(() => {
        // Restore original VS Code APIs
        if (mockShowInformationMessage) {mockShowInformationMessage.restore();}
        if (mockShowErrorMessage) {mockShowErrorMessage.restore();}
        if (mockShowWarningMessage) {mockShowWarningMessage.restore();}
        if (mockWithProgress) {mockWithProgress.restore();}
    });

    suite('Initialization and Configuration', () => {
        test('should load default preferences on initialization', () => {
            const preferences = notificationManager.getPreferences();

            assert.strictEqual(preferences.enableNotifications, true);
            assert.strictEqual(preferences.showSuccessNotifications, true);
            assert.strictEqual(preferences.showFailureNotifications, true);
            assert.strictEqual(preferences.showProgressNotifications, true);
            assert.strictEqual(preferences.showConflictNotifications, true);
            assert.strictEqual(preferences.notificationDuration, 5000);
        });

        test('should load custom configuration values', () => {
            // Mock custom configuration
            mockConfiguration.get.withArgs('enabled', true).returns(false);
            mockConfiguration.get.withArgs('duration', 5000).returns(3000);
            mockConfiguration.get.withArgs('quietHours.enabled', false).returns(true);

            const customNotificationManager = new NotificationManager();
            const preferences = customNotificationManager.getPreferences();

            assert.strictEqual(preferences.enableNotifications, false);
            assert.strictEqual(preferences.notificationDuration, 3000);
            assert.strictEqual(preferences.quietHours.enabled, true);

            customNotificationManager.dispose();
        });

        test('should setup configuration watcher', () => {
            // Configuration watcher should be set up during initialization
            assert.ok((vscode.workspace.onDidChangeConfiguration as any).called, 'Should setup configuration watcher');
        });

        test('should update preferences when configuration changes', () => {
            let preferencesChanged = false;
            const disposable = notificationManager.onPreferencesChanged(() => {
                preferencesChanged = true;
            });

            // Simulate configuration change
            mockConfiguration.get.withArgs('enabled', true).returns(false);

            // Trigger configuration change event
            if (mockConfigurationWatcher && 'fire' in mockConfigurationWatcher) {
                (mockConfigurationWatcher as any).fire({
                    affectsConfiguration: (section: string) => section === 'specforged.notifications'
                });
            }

            assert.ok(preferencesChanged, 'Should fire preferences changed event');
            disposable.dispose();
        });
    });

    suite('Operation Success Notifications', () => {
        test('should show success notification for completed operation', async () => {
            const operation = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');
            const result: McpOperationResult = {
                operationId: operation.id,
                success: true,
                message: 'Specification created successfully',
                timestamp: new Date().toISOString(),
                processingTimeMs: 1500,
                retryable: false,
                data: { specId: 'test-spec' }
            };

            await notificationManager.showOperationSuccessNotification(operation, result);

            assert.ok(mockShowInformationMessage.called, 'Should show information message');
            const call = mockShowInformationMessage.getCall(0);
            assert.ok(call.args[0].includes('✅'), 'Should include success icon');
            assert.ok(call.args[0].includes('Create Specification'), 'Should include operation type');
        });

        test('should include operation-specific actions in success notifications', async () => {
            const operation = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');
            operation.type = McpOperationType.CREATE_SPEC;
            const result: McpOperationResult = {
                operationId: operation.id,
                success: true,
                message: 'Operation completed',
                timestamp: new Date().toISOString(),
                processingTimeMs: 1000,
                retryable: false,
                data: { specId: 'test-spec' }
            };

            await notificationManager.showOperationSuccessNotification(operation, result);

            const call = mockShowInformationMessage.getCall(0);
            const actionLabels = call.args.slice(1);

            assert.ok(actionLabels.includes('View Result'), 'Should include View Result action');
            assert.ok(actionLabels.includes('Open Specification'), 'Should include Open Specification action for CREATE_SPEC');
        });

        test('should not show success notification when disabled', async () => {
            // Disable success notifications
            mockConfiguration.get.withArgs('showSuccess', true).returns(false);
            const disabledNotificationManager = new NotificationManager();

            const operation = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');

            await disabledNotificationManager.showOperationSuccessNotification(operation);

            assert.ok(!mockShowInformationMessage.called, 'Should not show notification when disabled');
            disabledNotificationManager.dispose();
        });

        test('should filter notifications by operation priority', async () => {
            // Set priority filter to HIGH
            mockConfiguration.get.withArgs('priorityFilter', 'LOW').returns('HIGH');
            const filteredNotificationManager = new NotificationManager();

            const lowPriorityOp = McpOperationFactory.createCreateSpecOperation('Low Priority', 'Description');
            lowPriorityOp.priority = McpOperationPriority.LOW;

            await filteredNotificationManager.showOperationSuccessNotification(lowPriorityOp);

            assert.ok(!mockShowInformationMessage.called, 'Should not show notification for low priority operation');
            filteredNotificationManager.dispose();
        });
    });

    suite('Operation Failure Notifications', () => {
        test('should show error notification for failed operation', async () => {
            const operation = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');
            operation.status = McpOperationStatus.FAILED;
            const error = 'Validation failed: Invalid specification format';

            await notificationManager.showOperationFailureNotification(operation, error);

            assert.ok(mockShowErrorMessage.called, 'Should show error message');
            const call = mockShowErrorMessage.getCall(0);
            assert.ok(call.args[0].includes('❌'), 'Should include error icon');
            assert.ok(call.args[0].includes('Failed'), 'Should include failure indication');
        });

        test('should include retry and view error actions', async () => {
            const operation = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');

            await notificationManager.showOperationFailureNotification(operation, 'Test error');

            const call = mockShowErrorMessage.getCall(0);
            const actionLabels = call.args.slice(1);

            assert.ok(actionLabels.includes('Retry'), 'Should include Retry action');
            assert.ok(actionLabels.includes('View Error'), 'Should include View Error action');
        });

        test('should not auto-hide failure notifications', async () => {
            const operation = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');

            await notificationManager.showOperationFailureNotification(operation, 'Test error');

            // Failure notifications should stay visible (not auto-hide)
            const history = notificationManager.getNotificationHistory();
            const failureNotification = history.find(n => n.type === 'failure');

            assert.strictEqual(failureNotification?.autoHide, false, 'Failure notifications should not auto-hide');
        });
    });

    suite('Progress Notifications', () => {
        test('should show progress notification for in-progress operation', async () => {
            const operation = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Requirements');
            operation.status = McpOperationStatus.IN_PROGRESS;

            // Mock withProgress to capture the progress function
            let progressReporter: any;
            let progressToken: any;
            mockWithProgress.callsFake((options, callback) => {
                progressReporter = {
                    report: (value: any) => {}
                };
                progressToken = {
                    isCancellationRequested: false,
                    onCancellationRequested: () => ({ dispose: () => {} })
                };
                return callback(progressReporter, progressToken);
            });

            await notificationManager.showOperationProgressNotification(operation, 50, 'Processing requirements...');

            assert.ok(mockWithProgress.called, 'Should show progress notification');
            const call = mockWithProgress.getCall(0);
            const options = call.args[0];

            assert.strictEqual(options.location, vscode.ProgressLocation.Notification);
            assert.ok(options.title.includes('⚙️'), 'Should include progress icon');
            assert.ok(options.title.includes('Update Requirements'), 'Should include operation type');
        });

        test('should update existing progress notification', async () => {
            const operation = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Requirements');
            operation.status = McpOperationStatus.IN_PROGRESS;

            // Show initial progress
            await notificationManager.showOperationProgressNotification(operation, 25, 'Starting...');

            // Update progress
            await notificationManager.showOperationProgressNotification(operation, 75, 'Almost done...');

            // Should update existing notification rather than create new one
            const activeProgress = notificationManager.getActiveProgressNotifications();
            const operationProgress = activeProgress.find(p => p.operationId === operation.id);

            assert.strictEqual(operationProgress?.progress, 75, 'Should update progress value');
            assert.strictEqual(operationProgress?.message, 'Almost done...', 'Should update message');
        });

        test('should remove progress notification when complete', async () => {
            const operation = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Requirements');
            operation.status = McpOperationStatus.IN_PROGRESS;

            // Show progress
            await notificationManager.showOperationProgressNotification(operation, 50, 'In progress...');

            // Complete progress
            await notificationManager.showOperationProgressNotification(operation, 100, 'Completed');

            // Should remove from active notifications when complete
            const activeProgress = notificationManager.getActiveProgressNotifications();
            const operationProgress = activeProgress.find(p => p.operationId === operation.id);

            assert.strictEqual(operationProgress, undefined, 'Should remove completed progress notification');
        });

        test('should handle cancellation in progress notifications', async () => {
            const operation = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Requirements');
            operation.status = McpOperationStatus.PENDING; // Cancellable when pending

            let cancellationCallback: (() => void) | undefined;

            mockWithProgress.callsFake((options, callback) => {
                const progressReporter = { report: () => {} };
                const progressToken = {
                    isCancellationRequested: false,
                    onCancellationRequested: (callback: () => void) => {
                        cancellationCallback = callback;
                        return { dispose: () => {} };
                    }
                };
                return callback(progressReporter, progressToken);
            });

            await notificationManager.showOperationProgressNotification(operation, 30, 'Processing...');

            assert.strictEqual(typeof cancellationCallback, 'function', 'Should setup cancellation handler');
        });
    });

    suite('Conflict Notifications', () => {
        test('should show conflict notification', async () => {
            await notificationManager.showConflictNotification(
                'conflict-1',
                'Concurrent modification detected',
                ['op-1', 'op-2']
            );

            assert.ok(mockShowWarningMessage.called, 'Should show warning message for conflicts');
            const call = mockShowWarningMessage.getCall(0);
            assert.ok(call.args[0].includes('⚠️'), 'Should include warning icon');
            assert.ok(call.args[0].includes('Conflict'), 'Should include conflict indication');
        });

        test('should include conflict resolution actions', async () => {
            await notificationManager.showConflictNotification(
                'conflict-1',
                'Concurrent modification detected',
                ['op-1', 'op-2']
            );

            const call = mockShowWarningMessage.getCall(0);
            const actionLabels = call.args.slice(1);

            assert.ok(actionLabels.includes('Resolve Conflict'), 'Should include Resolve Conflict action');
            assert.ok(actionLabels.includes('View All Conflicts'), 'Should include View All Conflicts action');
        });

        test('should not auto-hide conflict notifications', async () => {
            await notificationManager.showConflictNotification(
                'conflict-1',
                'Test conflict',
                ['op-1']
            );

            const history = notificationManager.getNotificationHistory();
            const conflictNotification = history.find(n => n.type === 'conflict');

            assert.strictEqual(conflictNotification?.autoHide, false, 'Conflict notifications should not auto-hide');
        });
    });

    suite('Info and Warning Notifications', () => {
        test('should show info notification', async () => {
            const actions: NotificationAction[] = [
                {
                    id: 'test-action',
                    label: 'Test Action',
                    command: 'test.command'
                }
            ];

            await notificationManager.showInfoNotification('Test Info', 'This is a test message', actions);

            assert.ok(mockShowInformationMessage.called, 'Should show information message');
            const call = mockShowInformationMessage.getCall(0);
            assert.ok(call.args[0].includes('Test Info'), 'Should include title');
            assert.ok(call.args[0].includes('This is a test message'), 'Should include message');
            assert.ok(call.args.includes('Test Action'), 'Should include action label');
        });

        test('should show warning notification', async () => {
            await notificationManager.showWarningNotification('Test Warning', 'This is a warning');

            assert.ok(mockShowWarningMessage.called, 'Should show warning message');
            const call = mockShowWarningMessage.getCall(0);
            assert.ok(call.args[0].includes('Test Warning'), 'Should include title');
        });

        test('should auto-hide info notifications', async () => {
            await notificationManager.showInfoNotification('Auto Hide Test', 'This should auto-hide');

            const history = notificationManager.getNotificationHistory();
            const infoNotification = history.find(n => n.type === 'info');

            assert.strictEqual(infoNotification?.autoHide, true, 'Info notifications should auto-hide');
            assert.strictEqual(infoNotification?.duration, 5000, 'Should use configured duration');
        });

        test('should not auto-hide warning notifications', async () => {
            await notificationManager.showWarningNotification('Warning Test', 'This should not auto-hide');

            const history = notificationManager.getNotificationHistory();
            const warningNotification = history.find(n => n.type === 'warning');

            assert.strictEqual(warningNotification?.autoHide, false, 'Warning notifications should not auto-hide');
        });
    });

    suite('Quiet Hours', () => {
        test('should suppress notifications during quiet hours', async () => {
            // Enable quiet hours from 22:00 to 08:00
            mockConfiguration.get.withArgs('quietHours.enabled', false).returns(true);
            mockConfiguration.get.withArgs('quietHours.startTime', '22:00').returns('22:00');
            mockConfiguration.get.withArgs('quietHours.endTime', '08:00').returns('08:00');

            const quietNotificationManager = new NotificationManager();

            // Mock current time to be during quiet hours (e.g., 23:30)
            const originalDate = Date;
            global.Date = class extends originalDate {
                getHours() { return 23; }
                getMinutes() { return 30; }
            } as any;

            try {
                await quietNotificationManager.showInfoNotification('Quiet Test', 'Should be suppressed');

                assert.ok(!mockShowInformationMessage.called, 'Should suppress notifications during quiet hours');
            } finally {
                global.Date = originalDate;
                quietNotificationManager.dispose();
            }
        });

        test('should handle overnight quiet hours correctly', async () => {
            mockConfiguration.get.withArgs('quietHours.enabled', false).returns(true);
            mockConfiguration.get.withArgs('quietHours.startTime', '22:00').returns('22:00');
            mockConfiguration.get.withArgs('quietHours.endTime', '08:00').returns('08:00');

            const quietNotificationManager = new NotificationManager();

            // Test early morning during quiet hours (e.g., 07:00)
            const originalDate = Date;
            global.Date = class extends originalDate {
                getHours() { return 7; }
                getMinutes() { return 0; }
            } as any;

            try {
                await quietNotificationManager.showInfoNotification('Early Morning Test', 'Should be suppressed');

                assert.ok(!mockShowInformationMessage.called, 'Should suppress notifications during overnight quiet hours');
            } finally {
                global.Date = originalDate;
                quietNotificationManager.dispose();
            }
        });
    });

    suite('Notification History', () => {
        test('should track notification history', async () => {
            await notificationManager.showInfoNotification('History Test 1', 'First message');
            await notificationManager.showWarningNotification('History Test 2', 'Second message');

            const history = notificationManager.getNotificationHistory();

            assert.strictEqual(history.length, 2, 'Should track all notifications');
            assert.strictEqual(history[0].title, 'History Test 2', 'Should order by most recent first');
            assert.strictEqual(history[1].title, 'History Test 1', 'Should include older notifications');
        });

        test('should limit history size', async () => {
            // Add many notifications to test size limit
            for (let i = 0; i < 150; i++) {
                await notificationManager.showInfoNotification(`Test ${i}`, `Message ${i}`);
            }

            const history = notificationManager.getNotificationHistory();

            assert.ok(history.length <= 100, 'Should limit history size to maximum');
        });

        test('should dismiss notifications', () => {
            notificationManager.showInfoNotification('Dismiss Test', 'Test message');

            const history = notificationManager.getNotificationHistory();
            const notification = history[0];

            assert.strictEqual(notification.dismissed, false, 'Should start as not dismissed');

            notificationManager.dismissNotification(notification.id);

            const updatedHistory = notificationManager.getNotificationHistory();
            const updatedNotification = updatedHistory.find(n => n.id === notification.id);

            assert.strictEqual(updatedNotification?.dismissed, true, 'Should mark as dismissed');
            assert.ok(updatedNotification?.dismissedAt, 'Should set dismissed timestamp');
        });

        test('should clear history', async () => {
            await notificationManager.showInfoNotification('Clear Test 1', 'Message 1');
            await notificationManager.showInfoNotification('Clear Test 2', 'Message 2');

            let history = notificationManager.getNotificationHistory();
            assert.ok(history.length > 0, 'Should have notifications before clearing');

            notificationManager.clearHistory();

            history = notificationManager.getNotificationHistory();
            assert.strictEqual(history.length, 0, 'Should clear all history');
        });

        test('should clear only dismissed notifications', async () => {
            await notificationManager.showInfoNotification('Persistent Test', 'This should remain');
            await notificationManager.showInfoNotification('Dismissible Test', 'This should be removed');

            const history = notificationManager.getNotificationHistory();
            notificationManager.dismissNotification(history[0].id); // Dismiss the first one

            notificationManager.clearDismissedNotifications();

            const remainingHistory = notificationManager.getNotificationHistory();
            assert.strictEqual(remainingHistory.length, 1, 'Should keep non-dismissed notifications');
            assert.strictEqual(remainingHistory[0].title, 'Persistent Test', 'Should keep correct notification');
        });
    });

    suite('Preference Management', () => {
        test('should update preferences', () => {
            const newPreferences: Partial<NotificationPreferences> = {
                enableNotifications: false,
                notificationDuration: 3000,
                showSuccessNotifications: false
            };

            let preferencesChanged = false;
            const disposable = notificationManager.onPreferencesChanged(() => {
                preferencesChanged = true;
            });

            notificationManager.updatePreferences(newPreferences);

            const preferences = notificationManager.getPreferences();
            assert.strictEqual(preferences.enableNotifications, false, 'Should update enableNotifications');
            assert.strictEqual(preferences.notificationDuration, 3000, 'Should update notificationDuration');
            assert.strictEqual(preferences.showSuccessNotifications, false, 'Should update showSuccessNotifications');
            assert.ok(preferencesChanged, 'Should fire preferences changed event');

            disposable.dispose();
        });

        test('should preserve unchanged preferences', () => {
            const originalPreferences = notificationManager.getPreferences();

            notificationManager.updatePreferences({
                notificationDuration: 7000
            });

            const updatedPreferences = notificationManager.getPreferences();
            assert.strictEqual(updatedPreferences.enableNotifications, originalPreferences.enableNotifications, 'Should preserve unchanged values');
            assert.strictEqual(updatedPreferences.notificationDuration, 7000, 'Should update specified values');
        });
    });

    suite('Action Execution', () => {
        test('should execute notification actions when selected', async () => {
            // Mock command execution
            const mockExecuteCommand = require('sinon').stub(vscode.commands, 'executeCommand');
            mockExecuteCommand.resolves();

            // Mock user selecting an action
            mockShowInformationMessage.resolves('Test Action');

            const actions: NotificationAction[] = [
                {
                    id: 'test-action',
                    label: 'Test Action',
                    command: 'specforged.testCommand',
                    args: ['arg1', 'arg2']
                }
            ];

            await notificationManager.showInfoNotification('Action Test', 'Test message', actions);

            assert.ok(mockExecuteCommand.called, 'Should execute command for selected action');
            const call = mockExecuteCommand.getCall(0);
            assert.strictEqual(call.args[0], 'specforged.testCommand', 'Should execute correct command');
            assert.deepStrictEqual(call.args.slice(1), ['arg1', 'arg2'], 'Should pass correct arguments');

            mockExecuteCommand.restore();
        });

        test('should handle action execution errors gracefully', async () => {
            const mockExecuteCommand = require('sinon').stub(vscode.commands, 'executeCommand');
            mockExecuteCommand.rejects(new Error('Command execution failed'));

            mockShowInformationMessage.resolves('Failing Action');

            const actions: NotificationAction[] = [
                {
                    id: 'failing-action',
                    label: 'Failing Action',
                    command: 'specforged.failingCommand'
                }
            ];

            await assert.doesNotReject(
                () => notificationManager.showInfoNotification('Error Test', 'Test message', actions),
                'Should handle action execution errors gracefully'
            );

            // Should show error message about failed action
            assert.ok(mockShowErrorMessage.called, 'Should show error message for failed action');

            mockExecuteCommand.restore();
        });
    });

    suite('Event Emitters', () => {
        test('should emit notification shown event', async () => {
            let notificationShown = false;
            let shownNotification: NotificationHistoryItem | undefined;

            const disposable = notificationManager.onNotificationShown((notification) => {
                notificationShown = true;
                shownNotification = notification;
            });

            await notificationManager.showInfoNotification('Event Test', 'Test message');

            assert.ok(notificationShown, 'Should emit notification shown event');
            assert.ok(shownNotification, 'Should provide notification data');
            assert.strictEqual(shownNotification?.title, 'Event Test', 'Should provide correct notification data');

            disposable.dispose();
        });

        test('should emit notification dismissed event', () => {
            let notificationDismissed = false;
            let dismissedId: string | undefined;

            const disposable = notificationManager.onNotificationDismissed((id) => {
                notificationDismissed = true;
                dismissedId = id;
            });

            // Add a notification and dismiss it
            notificationManager.showInfoNotification('Dismiss Event Test', 'Test message');
            const history = notificationManager.getNotificationHistory();
            const notification = history[0];

            notificationManager.dismissNotification(notification.id);

            assert.ok(notificationDismissed, 'Should emit notification dismissed event');
            assert.strictEqual(dismissedId, notification.id, 'Should provide correct notification ID');

            disposable.dispose();
        });
    });

    suite('Error Handling and Edge Cases', () => {
        test('should handle VS Code API failures gracefully', async () => {
            // Mock VS Code API to throw error
            mockShowInformationMessage.rejects(new Error('VS Code API error'));

            await assert.doesNotReject(
                () => notificationManager.showInfoNotification('Error Test', 'This should fail gracefully'),
                'Should handle VS Code API failures gracefully'
            );
        });

        test('should handle invalid operation data', async () => {
            const invalidOperation = {} as McpOperation;

            await assert.doesNotReject(
                () => notificationManager.showOperationSuccessNotification(invalidOperation),
                'Should handle invalid operation data gracefully'
            );
        });

        test('should handle notification with no actions', async () => {
            await assert.doesNotReject(
                () => notificationManager.showInfoNotification('No Actions Test', 'No actions provided'),
                'Should handle notifications with no actions'
            );

            assert.ok(mockShowInformationMessage.called, 'Should still show notification');
        });

        test('should handle extremely long notification messages', async () => {
            const longMessage = 'Very long message '.repeat(100);

            await assert.doesNotReject(
                () => notificationManager.showInfoNotification('Long Message Test', longMessage),
                'Should handle long messages gracefully'
            );
        });

        test('should handle rapid successive notifications', async () => {
            const promises: Promise<void>[] = [];

            // Queue many notifications rapidly
            for (let i = 0; i < 20; i++) {
                promises.push(notificationManager.showInfoNotification(`Rapid ${i}`, `Message ${i}`));
            }

            await assert.doesNotReject(
                () => Promise.all(promises),
                'Should handle rapid successive notifications'
            );

            const history = notificationManager.getNotificationHistory();
            assert.strictEqual(history.length, 20, 'Should track all rapid notifications');
        });
    });

    suite('Performance', () => {
        test('should handle notifications efficiently', async () => {
            const startTime = Date.now();

            // Show many notifications
            for (let i = 0; i < 50; i++) {
                await notificationManager.showInfoNotification(`Performance Test ${i}`, `Message ${i}`);
            }

            const duration = Date.now() - startTime;
            assert.ok(duration < 5000, `Should handle notifications efficiently: ${duration}ms`);
        });

        test('should not leak memory with many notifications', async () => {
            const initialMemory = process.memoryUsage().heapUsed;

            // Create many notifications
            for (let i = 0; i < 100; i++) {
                await notificationManager.showInfoNotification(`Memory Test ${i}`, `Message ${i}`);

                if (i % 20 === 0 && global.gc) {
                    global.gc(); // Force garbage collection if available
                }
            }

            const finalMemory = process.memoryUsage().heapUsed;
            const memoryIncrease = finalMemory - initialMemory;

            // Memory increase should be reasonable
            assert.ok(memoryIncrease < 10 * 1024 * 1024, `Memory usage should be reasonable: ${memoryIncrease} bytes`);
        });
    });
});
