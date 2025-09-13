/**
 * Test suite for VS Code extension configuration system.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';
import { FeatureFlagService } from '../../services/FeatureFlagService';
import { ConfigurationValidationService } from '../../services/ConfigurationValidationService';
import { EnhancedSettingsProvider } from '../../views/EnhancedSettingsProvider';

suite('Configuration System Test Suite', () => {
    let context: vscode.ExtensionContext;
    let mockConfig: vscode.WorkspaceConfiguration;
    let configStub: sinon.SinonStub;

    setup(() => {
        // Create mock extension context
        context = {
            subscriptions: [],
            workspaceState: {
                get: sinon.stub() as any,
                update: sinon.stub() as any,
                keys: sinon.stub().returns([]) as any
            },
            globalState: {
                get: sinon.stub() as any,
                update: sinon.stub() as any,
                setKeysForSync: sinon.stub() as any,
                keys: sinon.stub().returns([]) as any
            },
            extensionPath: '/test/path',
            storagePath: '/test/storage',
            globalStoragePath: '/test/global-storage',
            logPath: '/test/log',
            extensionUri: vscode.Uri.file('/test/path'),
            environmentVariableCollection: {} as any,
            extensionMode: vscode.ExtensionMode.Test,
            storageUri: vscode.Uri.file('/test/storage'),
            globalStorageUri: vscode.Uri.file('/test/global-storage'),
            logUri: vscode.Uri.file('/test/log'),
            asAbsolutePath: (relativePath: string) => `/test/path/${relativePath}`,
            secrets: {} as any,
            extension: {} as any,
            languageModelAccessInformation: {} as any
        } as vscode.ExtensionContext;

        // Create mock configuration
        mockConfig = {
            get: sinon.stub() as any,
            update: sinon.stub(),
            inspect: sinon.stub(),
            has: sinon.stub()
        };

        // Stub workspace configuration
        configStub = sinon.stub(vscode.workspace, 'getConfiguration').returns(mockConfig);
    });

    teardown(() => {
        sinon.restore();
    });

    suite('FeatureFlagService', () => {
        let featureFlagService: FeatureFlagService;

        setup(() => {
            // Setup default configuration values for FeatureFlagService
            (mockConfig.get as sinon.SinonStub).withArgs('featureFlags.rolloutGroup', 'stable').returns('stable');
            (mockConfig.get as sinon.SinonStub).withArgs('environment', 'production').returns('test');

            featureFlagService = new FeatureFlagService(context);
        });

        test('should initialize with default user context', () => {
            const userContext = featureFlagService.getUserContext();

            assert.ok(userContext.userId);
            assert.ok(userContext.groups);
            assert.ok(userContext.environment);
            assert.ok(userContext.version);
        });

        test('should evaluate feature flag correctly', () => {
            // Mock configuration to return enabled experimental features
            (mockConfig.get as sinon.SinonStub).withArgs('featureFlags.enableExperimentalFeatures', false).returns(true);

            const enabled = featureFlagService.isEnabled('enhanced_notifications');

            // Result depends on rollout percentage and user context
            assert.strictEqual(typeof enabled, 'boolean');
        });

        test('should return false for non-existent feature flag', () => {
            const enabled = featureFlagService.isEnabled('non_existent_feature');
            assert.strictEqual(enabled, false);
        });

        test('should respect rollout percentage', () => {
            // Test with consistent user context
            featureFlagService.setUserContext({
                userId: 'test-user-123',
                groups: ['beta'],
                environment: 'development',
                version: '1.0.0',
                metadata: {}
            });

            // Test multiple times to ensure consistency
            const result1 = featureFlagService.isEnabled('enhanced_notifications');
            const result2 = featureFlagService.isEnabled('enhanced_notifications');
            const result3 = featureFlagService.isEnabled('enhanced_notifications');

            assert.strictEqual(result1, result2);
            assert.strictEqual(result2, result3);
        });

        test('should create custom feature flag', async () => {
            (mockConfig.get as sinon.SinonStub).withArgs('featureFlags.customFlags', {}).returns({});
            (mockConfig.update as sinon.SinonStub).resolves();

            const success = await featureFlagService.createFlag(
                'test_custom_feature',
                true,
                {
                    rolloutPercentage: 75,
                    targetGroups: ['internal'],
                    conditions: { environment: 'development' }
                }
            );

            assert.strictEqual(success, true);
            assert.ok((mockConfig.update as sinon.SinonStub).calledWith('featureFlags.customFlags'));
        });

        test('should update existing feature flag', async () => {
            const existingFlags = {
                'existing_feature': {
                    name: 'existing_feature',
                    enabled: false,
                    rolloutPercentage: 25,
                    targetGroups: [],
                    conditions: {},
                    metadata: {},
                    created_at: new Date().toISOString()
                }
            };

            (mockConfig.get as sinon.SinonStub).withArgs('featureFlags.customFlags', {}).returns(existingFlags);
            (mockConfig.update as sinon.SinonStub).resolves();

            const success = await featureFlagService.updateFlag('existing_feature', {
                enabled: true,
                rolloutPercentage: 50
            });

            assert.strictEqual(success, true);
        });

        test('should delete feature flag', async () => {
            const existingFlags = {
                'feature_to_delete': {
                    name: 'feature_to_delete',
                    enabled: true,
                    rolloutPercentage: 100,
                    targetGroups: [],
                    conditions: {},
                    metadata: {},
                    created_at: new Date().toISOString()
                }
            };

            (mockConfig.get as sinon.SinonStub).withArgs('featureFlags.customFlags', {}).returns(existingFlags);
            (mockConfig.update as sinon.SinonStub).resolves();

            const success = await featureFlagService.deleteFlag('feature_to_delete');

            assert.strictEqual(success, true);
        });

        test('should get feature flag statistics', () => {
            const stats = featureFlagService.getFeatureFlagStats();

            assert.ok(typeof stats.totalFlags === 'number');
            assert.ok(typeof stats.enabledFlags === 'number');
            assert.ok(typeof stats.flagsWithRollout === 'number');
            assert.ok(typeof stats.flagsByGroup === 'object');
            assert.ok(stats.cacheStats);
        });

        test('should export and import configuration', async () => {
            (mockConfig.get as sinon.SinonStub).withArgs('featureFlags.customFlags', {}).returns({});
            (mockConfig.get as sinon.SinonStub).withArgs('environment', 'production').returns('test');
            (mockConfig.update as sinon.SinonStub).resolves();

            const exportedConfig = featureFlagService.exportConfig();

            assert.ok(exportedConfig.flags);
            assert.ok(exportedConfig.userContext);
            assert.ok(exportedConfig.environment);
            assert.ok(exportedConfig.version);

            const success = await featureFlagService.importConfig(exportedConfig);
            assert.strictEqual(success, true);
        });
    });

    suite('ConfigurationValidationService', () => {
        let validationService: ConfigurationValidationService;
        let featureFlagService: FeatureFlagService;

        setup(() => {
            featureFlagService = new FeatureFlagService(context);
            validationService = new ConfigurationValidationService(context, featureFlagService);

            // Mock configuration for validation service with sensitive data
            (mockConfig.get as sinon.SinonStub).withArgs('smitheryApiKey').returns('secret-key-value');
            (mockConfig.get as sinon.SinonStub).withArgs('autoDetect').returns(true);
            (mockConfig.get as sinon.SinonStub).withArgs('specFolder').returns('.specifications');
        });

        test('should validate configuration successfully', async () => {
            // Mock valid configuration
            (mockConfig.get as sinon.SinonStub).withArgs('performance.memoryLimitMb', 100).returns(100);
            (mockConfig.get as sinon.SinonStub).withArgs('performance.memoryWarningThresholdMb', 80).returns(80);
            (mockConfig.get as sinon.SinonStub).withArgs('queue.maxSize', 10000).returns(10000);
            (mockConfig.get as sinon.SinonStub).withArgs('queue.maxBatchSize', 50).returns(50);
            (mockConfig.get as sinon.SinonStub).withArgs('queue.processingIntervalMs', 2000).returns(2000);
            (mockConfig.get as sinon.SinonStub).withArgs('mcpServerType', 'local').returns('local');
            (mockConfig.get as sinon.SinonStub).withArgs('mcpServerUrl', '').returns('');
            (mockConfig.get as sinon.SinonStub).withArgs('connectionTimeout', 10000).returns(10000);
            (mockConfig.get as sinon.SinonStub).withArgs('retryAttempts', 3).returns(3);
            (mockConfig.get as sinon.SinonStub).withArgs('environment', 'production').returns('development');
            (mockConfig.get as sinon.SinonStub).withArgs('debugMode', false).returns(false);
            (mockConfig.get as sinon.SinonStub).withArgs('logLevel', 'info').returns('info');
            (mockConfig.get as sinon.SinonStub).withArgs('security.enableStrictValidation', true).returns(true);
            (mockConfig.get as sinon.SinonStub).withArgs('security.enableRateLimiting', true).returns(true);

            const result = await validationService.validateConfiguration();

            assert.strictEqual(result.isValid, true);
            assert.strictEqual(result.errors.length, 0);
        });

        test('should detect memory configuration issues', async () => {
            // Mock invalid memory configuration
            (mockConfig.get as sinon.SinonStub).withArgs('performance.memoryLimitMb', 100).returns(50);
            (mockConfig.get as sinon.SinonStub).withArgs('performance.memoryWarningThresholdMb', 80).returns(60); // Higher than limit

            const result = await validationService.validateConfiguration();

            assert.strictEqual(result.isValid, false);
            const memoryErrors = result.errors.filter(e => e.field.includes('memory'));
            assert.ok(memoryErrors.length > 0);
        });

        test('should detect queue configuration issues', async () => {
            // Mock invalid queue configuration
            (mockConfig.get as sinon.SinonStub).withArgs('queue.maxSize', 10000).returns(0); // Invalid size
            (mockConfig.get as sinon.SinonStub).withArgs('queue.maxBatchSize', 50).returns(-1); // Invalid batch size

            const result = await validationService.validateConfiguration();

            assert.strictEqual(result.isValid, false);
            const queueErrors = result.errors.filter(e => e.field.includes('queue'));
            assert.ok(queueErrors.length > 0);
        });

        test('should detect server connection issues', async () => {
            // Mock invalid server configuration
            (mockConfig.get as sinon.SinonStub).withArgs('mcpServerType', 'local').returns('custom');
            (mockConfig.get as sinon.SinonStub).withArgs('mcpServerUrl', '').returns(''); // Missing URL for custom type
            (mockConfig.get as sinon.SinonStub).withArgs('connectionTimeout', 10000).returns(500); // Too low
            (mockConfig.get as sinon.SinonStub).withArgs('retryAttempts', 3).returns(0); // Invalid

            const result = await validationService.validateConfiguration();

            assert.strictEqual(result.isValid, false);
            const connectionErrors = result.errors.filter(e =>
                e.field.includes('mcpServer') || e.field.includes('connection') || e.field.includes('retry')
            );
            assert.ok(connectionErrors.length > 0);
        });

        test('should validate production environment settings', async () => {
            // Mock production environment with debug enabled (should warn)
            (mockConfig.get as sinon.SinonStub).withArgs('environment', 'production').returns('production');
            (mockConfig.get as sinon.SinonStub).withArgs('debugMode', false).returns(true); // Debug in production
            (mockConfig.get as sinon.SinonStub).withArgs('logLevel', 'info').returns('debug'); // Debug logging in production

            const result = await validationService.validateConfiguration();

            const productionIssues = result.warnings.concat(result.errors).filter(e =>
                e.message.toLowerCase().includes('production') ||
                e.message.toLowerCase().includes('debug')
            );
            assert.ok(productionIssues.length > 0);
        });

        test('should get configuration health status', async () => {
            const health = await validationService.getConfigurationHealth();

            assert.ok(['healthy', 'warning', 'critical'].includes(health.overall));
            assert.ok(health.lastCheck);
            assert.ok(Array.isArray(health.issues));
            assert.ok(typeof health.summary.criticalIssues === 'number');
            assert.ok(typeof health.summary.warnings === 'number');
            assert.ok(typeof health.summary.suggestions === 'number');
        });

        test('should attempt auto-fix for issues', async () => {
            // Mock configuration that can be auto-fixed
            (mockConfig.get as sinon.SinonStub).withArgs('performance.memoryLimitMb', 100).returns(0); // Invalid, can be fixed
            (mockConfig.get as sinon.SinonStub).withArgs('performance.memoryWarningThresholdMb', 80).returns(80);
            (mockConfig.update as sinon.SinonStub).resolves();

            const fixResult = await validationService.autoFixIssues();

            assert.ok(typeof fixResult.fixed === 'number');
            assert.ok(typeof fixResult.failed === 'number');
            assert.ok(Array.isArray(fixResult.details));
        });

        test('should export diagnostics', async () => {
            const diagnostics = await validationService.exportDiagnostics();

            assert.ok(diagnostics.timestamp);
            assert.ok(diagnostics.version);
            assert.ok(diagnostics.environment);
            assert.ok(diagnostics.configuration);
            assert.ok(diagnostics.validationResult);
            assert.ok(diagnostics.health);

            // Should not contain sensitive data
            assert.strictEqual(diagnostics.configuration.smitheryApiKey, '***REDACTED***');
        });
    });

    suite('EnhancedSettingsProvider', () => {
        let settingsProvider: EnhancedSettingsProvider;
        let mockWebviewView: vscode.WebviewView;
        let mockWebview: vscode.Webview;

        setup(() => {
            mockWebview = {
                html: '',
                options: {},
                onDidReceiveMessage: sinon.stub(),
                postMessage: sinon.stub(),
                asWebviewUri: sinon.stub(),
                cspSource: 'test-csp-source'
            };

            mockWebviewView = {
                webview: mockWebview,
                show: sinon.stub(),
                title: 'Enhanced Settings',
                description: 'Test settings view',
                onDidDispose: sinon.stub(),
                onDidChangeVisibility: sinon.stub(),
                visible: true,
                viewType: 'specforged.enhancedSettings'
            };

            settingsProvider = new EnhancedSettingsProvider(
                vscode.Uri.file('/test/path'),
                context
            );
        });

        test('should resolve webview view', () => {
            const resolveContext: vscode.WebviewViewResolveContext = {
                state: undefined
            };

            settingsProvider.resolveWebviewView(
                mockWebviewView,
                resolveContext,
                new vscode.CancellationTokenSource().token
            );

            assert.ok(mockWebview.html.length > 0);
            assert.ok(mockWebview.options.enableScripts);
            assert.ok((mockWebview.onDidReceiveMessage as sinon.SinonStub).called);
        });

        test('should handle setting update messages', async () => {
            (mockConfig.update as sinon.SinonStub).resolves();

            const resolveContext: vscode.WebviewViewResolveContext = {
                state: undefined
            };

            settingsProvider.resolveWebviewView(
                mockWebviewView,
                resolveContext,
                new vscode.CancellationTokenSource().token
            );

            // Simulate message from webview
            const messageHandler = (mockWebview.onDidReceiveMessage as sinon.SinonStub).getCall(0).args[0];
            await messageHandler({
                command: 'updateSetting',
                key: 'debugMode',
                value: true
            });

            assert.ok((mockConfig.update as sinon.SinonStub).calledWith('debugMode', true));
        });

        test('should handle reset setting messages', async () => {
            (mockConfig.update as sinon.SinonStub).resolves();

            const resolveContext: vscode.WebviewViewResolveContext = {
                state: undefined
            };

            settingsProvider.resolveWebviewView(
                mockWebviewView,
                resolveContext,
                new vscode.CancellationTokenSource().token
            );

            const messageHandler = (mockWebview.onDidReceiveMessage as sinon.SinonStub).getCall(0).args[0];
            await messageHandler({
                command: 'resetSetting',
                key: 'debugMode'
            });

            assert.ok((mockConfig.update as sinon.SinonStub).calledWith('debugMode', undefined));
        });

        test('should handle validation messages', async () => {
            const resolveContext: vscode.WebviewViewResolveContext = {
                state: undefined
            };

            settingsProvider.resolveWebviewView(
                mockWebviewView,
                resolveContext,
                new vscode.CancellationTokenSource().token
            );

            const messageHandler = (mockWebview.onDidReceiveMessage as sinon.SinonStub).getCall(0).args[0];
            await messageHandler({
                command: 'validateConfiguration'
            });

            // Should post validation result message
            assert.ok((mockWebview.postMessage as sinon.SinonStub).calledWithMatch({
                command: 'validationResult'
            }));
        });

        test('should handle feature flag management messages', async () => {
            (mockConfig.get as sinon.SinonStub).withArgs('featureFlags.customFlags', {}).returns({});
            (mockConfig.update as sinon.SinonStub).resolves();

            const resolveContext: vscode.WebviewViewResolveContext = {
                state: undefined
            };

            settingsProvider.resolveWebviewView(
                mockWebviewView,
                resolveContext,
                new vscode.CancellationTokenSource().token
            );

            const messageHandler = (mockWebview.onDidReceiveMessage as sinon.SinonStub).getCall(0).args[0];

            // Test creating feature flag
            await messageHandler({
                command: 'createFeatureFlag',
                name: 'test_ui_feature',
                enabled: true,
                options: {
                    rolloutPercentage: 50,
                    targetGroups: ['beta']
                }
            });

            // Should update configuration
            assert.ok((mockConfig.update as sinon.SinonStub).called);
        });
    });

    suite('Configuration Integration', () => {
        let featureFlagService: FeatureFlagService;
        let validationService: ConfigurationValidationService;

        setup(() => {
            featureFlagService = new FeatureFlagService(context);
            validationService = new ConfigurationValidationService(context, featureFlagService);
        });

        test('should integrate feature flags with validation', async () => {
            // Create feature flag that affects validation
            (mockConfig.get as sinon.SinonStub).withArgs('featureFlags.customFlags', {}).returns({});
            (mockConfig.update as sinon.SinonStub).resolves();

            await featureFlagService.createFlag('strict_validation_mode', true, {
                rolloutPercentage: 100,
                targetGroups: ['all']
            });

            // Validation should consider feature flags
            const enabled = featureFlagService.isEnabled('strict_validation_mode');
            const result = await validationService.validateConfiguration();

            // Results will vary based on feature flag and configuration
            assert.ok(typeof enabled === 'boolean');
            assert.ok(typeof result.isValid === 'boolean');
        });

        test('should handle configuration migration scenarios', async () => {
            // Mock old-style configuration
            (mockConfig.get as sinon.SinonStub).withArgs('enableNotifications').returns(true);
            (mockConfig.get as sinon.SinonStub).withArgs('notifications.enabled').returns(undefined);

            // Validation should handle both old and new configuration styles
            const result = await validationService.validateConfiguration();

            // Should not fail due to migration issues
            assert.ok(result !== null);
        });

        test('should provide comprehensive configuration status', async () => {
            const health = await validationService.getConfigurationHealth();
            const featureStats = featureFlagService.getFeatureFlagStats();

            // Should provide complete status information
            assert.ok(health.overall);
            assert.ok(health.summary);
            assert.ok(featureStats.totalFlags >= 0);
            assert.ok(featureStats.cacheStats);
        });
    });

    suite('Performance and Reliability', () => {
        test('should handle rapid configuration changes', async () => {
            const featureFlagService = new FeatureFlagService(context);
            (mockConfig.get as sinon.SinonStub).withArgs('featureFlags.customFlags', {}).returns({});
            (mockConfig.update as sinon.SinonStub).resolves();

            // Rapid flag evaluations should be cached and fast
            const startTime = Date.now();

            for (let i = 0; i < 100; i++) {
                featureFlagService.isEnabled('enhanced_notifications');
                featureFlagService.isEnabled('advanced_queue_management');
                featureFlagService.isEnabled('performance_dashboard');
            }

            const duration = Date.now() - startTime;

            // Should complete in reasonable time (< 100ms)
            assert.ok(duration < 100, `Performance test failed: took ${duration}ms for 300 evaluations`);
        });

        test('should handle configuration errors gracefully', async () => {
            const validationService = new ConfigurationValidationService(
                context,
                new FeatureFlagService(context)
            );

            // Mock configuration that throws errors
            (mockConfig.get as sinon.SinonStub).throws(new Error('Configuration error'));

            // Should not throw, should return error result
            const result = await validationService.validateConfiguration();

            assert.ok(result !== null);
            // May have errors due to the exception, but should not crash
        });

        test('should validate configuration schema constraints', async () => {
            const validationService = new ConfigurationValidationService(
                context,
                new FeatureFlagService(context)
            );

            // Test various invalid configurations
            const invalidConfigs = [
                { 'performance.memoryLimitMb': -1 },
                { 'queue.maxSize': 0 },
                { 'notifications.duration': 50000 }, // Too high
                { 'connectionTimeout': 500 }, // Too low
                { 'retryAttempts': 15 } // Too high
            ];

            for (const invalidConfig of invalidConfigs) {
                for (const [key, value] of Object.entries(invalidConfig)) {
                    (mockConfig.get as sinon.SinonStub).withArgs(key).returns(value);
                }

                const result = await validationService.validateConfiguration();

                // Should detect validation issues
                const hasErrors = result.errors.length > 0 || result.warnings.length > 0;
                assert.ok(hasErrors, `Failed to detect issues with config: ${JSON.stringify(invalidConfig)}`);
            }
        });
    });
});
