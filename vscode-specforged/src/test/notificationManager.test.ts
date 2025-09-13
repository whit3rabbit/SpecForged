import * as assert from 'assert';
import * as vscode from 'vscode';
import { NotificationManager, NotificationPreferences } from '../services/notificationManager';
import { McpOperationType, McpOperationPriority, McpOperationStatus, CreateSpecOperation, UpdateRequirementsOperation } from '../models/mcpOperation';

suite('NotificationManager Test Suite', () => {
    let notificationManager: NotificationManager;

    setup(() => {
        notificationManager = new NotificationManager();
    });

    teardown(() => {
        notificationManager.dispose();
    });

    test('Should initialize with default preferences', () => {
        const preferences = notificationManager.getPreferences();

        assert.strictEqual(preferences.enableNotifications, true);
        assert.strictEqual(preferences.showSuccessNotifications, true);
        assert.strictEqual(preferences.showFailureNotifications, true);
        assert.strictEqual(preferences.showProgressNotifications, true);
        assert.strictEqual(preferences.showConflictNotifications, true);
        assert.strictEqual(preferences.notificationDuration, 5000);
        assert.strictEqual(preferences.enableSounds, true);
        assert.strictEqual(preferences.enableBadges, true);
    });

    test('Should update preferences correctly', () => {
        const newPreferences: Partial<NotificationPreferences> = {
            enableNotifications: false,
            notificationDuration: 10000,
            showSuccessNotifications: false
        };

        notificationManager.updatePreferences(newPreferences);
        const updatedPreferences = notificationManager.getPreferences();

        assert.strictEqual(updatedPreferences.enableNotifications, false);
        assert.strictEqual(updatedPreferences.notificationDuration, 10000);
        assert.strictEqual(updatedPreferences.showSuccessNotifications, false);
        // Other preferences should remain unchanged
        assert.strictEqual(updatedPreferences.showFailureNotifications, true);
    });

    test('Should add notifications to history', async () => {
        const initialHistoryLength = notificationManager.getNotificationHistory().length;

        await notificationManager.showInfoNotification(
            'Test Notification',
            'This is a test message',
            []
        );

        const history = notificationManager.getNotificationHistory();
        assert.strictEqual(history.length, initialHistoryLength + 1);

        const latestNotification = history[0]; // History is ordered newest first
        assert.strictEqual(latestNotification.title, 'Test Notification');
        assert.strictEqual(latestNotification.message, 'This is a test message');
        assert.strictEqual(latestNotification.type, 'info');
        assert.strictEqual(latestNotification.dismissed, false);
    });

    test('Should handle operation success notifications', async () => {
        const mockOperation: CreateSpecOperation = {
            id: 'test-op-123',
            type: McpOperationType.CREATE_SPEC,
            status: McpOperationStatus.COMPLETED,
            priority: McpOperationPriority.NORMAL,
            timestamp: new Date().toISOString(),
            source: 'extension' as const,
            retryCount: 0,
            maxRetries: 3,
            params: {
                name: 'Test Spec',
                description: 'Test Description'
            }
        };

        const mockResult = {
            operationId: 'test-op-123',
            success: true,
            message: 'Specification created successfully',
            data: { specId: 'test-spec' },
            timestamp: new Date().toISOString(),
            processingTimeMs: 1000,
            retryable: false
        };

        await notificationManager.showOperationSuccessNotification(mockOperation, mockResult);

        const history = notificationManager.getNotificationHistory();
        const notification = history[0];

        assert.strictEqual(notification.type, 'success');
        assert.strictEqual(notification.operationId, 'test-op-123');
        assert.strictEqual(notification.operationType, McpOperationType.CREATE_SPEC);
        assert.ok(notification.title.includes('Create Specification'));
        assert.ok(notification.actions && notification.actions.length > 0);
    });

    test('Should handle operation failure notifications', async () => {
        const mockOperation: UpdateRequirementsOperation = {
            id: 'test-op-456',
            type: McpOperationType.UPDATE_REQUIREMENTS,
            status: McpOperationStatus.FAILED,
            priority: McpOperationPriority.HIGH,
            timestamp: new Date().toISOString(),
            source: 'extension' as const,
            retryCount: 1,
            maxRetries: 3,
            error: 'File not found',
            params: {
                specId: 'test-spec',
                content: 'Updated requirements'
            }
        };

        await notificationManager.showOperationFailureNotification(mockOperation, 'File not found');

        const history = notificationManager.getNotificationHistory();
        const notification = history[0];

        assert.strictEqual(notification.type, 'failure');
        assert.strictEqual(notification.operationId, 'test-op-456');
        assert.strictEqual(notification.operationType, McpOperationType.UPDATE_REQUIREMENTS);
        assert.ok(notification.title.includes('Update Requirements'));
        assert.ok(notification.message.includes('File not found'));
        assert.ok(notification.actions && notification.actions.length > 0);

        // Should have retry action
        const retryAction = notification.actions.find(action => action.id === 'retry');
        assert.ok(retryAction);
        assert.strictEqual(retryAction.label, 'Retry');
    });

    test('Should handle conflict notifications', async () => {
        const conflictId = 'conflict-123';
        const description = 'Multiple operations targeting the same file';
        const operationIds = ['op-1', 'op-2'];

        await notificationManager.showConflictNotification(conflictId, description, operationIds);

        const history = notificationManager.getNotificationHistory();
        const notification = history[0];

        assert.strictEqual(notification.type, 'conflict');
        assert.ok(notification.title.includes('Conflict Detected'));
        assert.strictEqual(notification.message, description);
        assert.ok(notification.actions && notification.actions.length > 0);

        // Should have resolve conflict action
        const resolveAction = notification.actions.find(action => action.id === 'resolve-conflict');
        assert.ok(resolveAction);
        assert.strictEqual(resolveAction.label, 'Resolve Conflict');
    });

    test('Should respect notification preferences', async () => {
        // Disable success notifications
        notificationManager.updatePreferences({
            showSuccessNotifications: false
        });

        const mockOperation: CreateSpecOperation = {
            id: 'test-op-789',
            type: McpOperationType.CREATE_SPEC,
            status: McpOperationStatus.COMPLETED,
            priority: McpOperationPriority.NORMAL,
            timestamp: new Date().toISOString(),
            source: 'extension' as const,
            retryCount: 0,
            maxRetries: 3,
            params: {
                name: 'Test Spec'
            }
        };

        const initialHistoryLength = notificationManager.getNotificationHistory().length;

        await notificationManager.showOperationSuccessNotification(mockOperation);

        // Should not add notification to history when disabled
        const history = notificationManager.getNotificationHistory();
        assert.strictEqual(history.length, initialHistoryLength);
    });

    test('Should dismiss notifications correctly', () => {
        // Add a test notification first
        notificationManager.showInfoNotification('Test', 'Message', []);

        const history = notificationManager.getNotificationHistory();
        const notificationId = history[0].id;

        assert.strictEqual(history[0].dismissed, false);

        notificationManager.dismissNotification(notificationId);

        const updatedHistory = notificationManager.getNotificationHistory();
        const dismissedNotification = updatedHistory.find(n => n.id === notificationId);

        assert.ok(dismissedNotification);
        assert.strictEqual(dismissedNotification.dismissed, true);
        assert.ok(dismissedNotification.dismissedAt);
    });

    test('Should clear history correctly', async () => {
        // Add some test notifications
        await notificationManager.showInfoNotification('Test 1', 'Message 1', []);
        await notificationManager.showInfoNotification('Test 2', 'Message 2', []);

        let history = notificationManager.getNotificationHistory();
        assert.ok(history.length >= 2);

        notificationManager.clearHistory();

        history = notificationManager.getNotificationHistory();
        assert.strictEqual(history.length, 0);
    });

    test('Should clear dismissed notifications only', async () => {
        // Add test notifications
        await notificationManager.showInfoNotification('Test 1', 'Message 1', []);
        await notificationManager.showInfoNotification('Test 2', 'Message 2', []);

        const history = notificationManager.getNotificationHistory();
        const firstNotificationId = history[0].id;

        // Dismiss one notification
        notificationManager.dismissNotification(firstNotificationId);

        // Clear dismissed notifications
        notificationManager.clearDismissedNotifications();

        const updatedHistory = notificationManager.getNotificationHistory();
        assert.strictEqual(updatedHistory.length, 1);
        assert.strictEqual(updatedHistory[0].dismissed, false);
    });

    test('Should handle quiet hours correctly', () => {
        // This is a simplified test - in a real scenario, you'd mock the current time
        const preferences = notificationManager.getPreferences();

        // Enable quiet hours
        notificationManager.updatePreferences({
            quietHours: {
                enabled: true,
                startTime: '22:00',
                endTime: '08:00'
            }
        });

        const updatedPreferences = notificationManager.getPreferences();
        assert.strictEqual(updatedPreferences.quietHours.enabled, true);
        assert.strictEqual(updatedPreferences.quietHours.startTime, '22:00');
        assert.strictEqual(updatedPreferences.quietHours.endTime, '08:00');
    });

    test('Should emit events correctly', (done) => {
        let eventFired = false;

        const disposable = notificationManager.onNotificationShown((notification) => {
            eventFired = true;
            assert.strictEqual(notification.title, 'Event Test');
            assert.strictEqual(notification.type, 'info');
            disposable.dispose();
            done();
        });

        notificationManager.showInfoNotification('Event Test', 'Testing events', []);

        // Ensure event was fired
        setTimeout(() => {
            if (!eventFired) {
                disposable.dispose();
                done(new Error('Event was not fired'));
            }
        }, 100);
    });
});
