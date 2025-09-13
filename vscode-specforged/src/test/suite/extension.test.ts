import * as assert from 'assert';
import * as vscode from 'vscode';
import * as sinon from 'sinon';

suite('Extension Test Suite', () => {
    let consoleErrorSpy: sinon.SinonSpy;
    let consoleWarnSpy: sinon.SinonSpy;

    setup(() => {
        // Spy on console methods before each test
        consoleErrorSpy = sinon.spy(console, 'error');
        consoleWarnSpy = sinon.spy(console, 'warn');
    });

    teardown(() => {
        // Restore console methods after each test
        consoleErrorSpy.restore();
        consoleWarnSpy.restore();
    });

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('specforged.vscode-specforged'));
    });

    test('Extension should activate without critical errors', async () => {
        const ext = vscode.extensions.getExtension('specforged.vscode-specforged');
        assert.ok(ext, 'Extension not found');

        if (ext && !ext.isActive) {
            await ext.activate();
        }

        assert.ok(ext.isActive, 'Extension failed to activate');

        // Check for critical errors in console output
        const errorCalls = consoleErrorSpy.getCalls();
        const criticalErrors = errorCalls.filter(call => {
            const message = call.args.join(' ').toLowerCase();
            return message.includes('failed to initialize') ||
                   message.includes('critical error') ||
                   message.includes('extension activation failed');
        });

        if (criticalErrors.length > 0) {
            const errorMessages = criticalErrors.map(call => call.args.join(' '));
            assert.fail(`Extension activated with critical errors: ${errorMessages.join('; ')}`);
        }

        // Check for MCP sync service initialization failures
        const allLogs = [...consoleErrorSpy.getCalls(), ...consoleWarnSpy.getCalls()];
        const mcpSyncErrors = allLogs.filter(call => {
            const message = call.args.join(' ');
            return message.includes('Failed to initialize MCP Sync Service') &&
                   message.includes('AtomicFileOperationError: No workspace folder is open');
        });

        if (mcpSyncErrors.length > 0) {
            assert.fail('MCP Sync Service failed to initialize due to missing workspace folder. Tests should provide a mock workspace.');
        }
    });

    test('Extension should handle missing workspace gracefully', async () => {
        const ext = vscode.extensions.getExtension('specforged.vscode-specforged');
        assert.ok(ext, 'Extension not found');

        if (ext && !ext.isActive) {
            await ext.activate();
        }

        assert.ok(ext.isActive, 'Extension failed to activate');

        // Should warn about missing workspace but not throw critical errors
        const errorCalls = consoleErrorSpy.getCalls();
        const fatalErrors = errorCalls.filter(call => {
            const message = call.args.join(' ').toLowerCase();
            return message.includes('failed to activate') ||
                   message.includes('critical error') ||
                   message.includes('extension activation failed');
        });

        assert.strictEqual(fatalErrors.length, 0, 'Extension should handle missing workspace gracefully without fatal errors');
    });

    test('Should register SpecForged commands', async () => {
        const commands = await vscode.commands.getCommands(true);

        const specforgedCommands = [
            'specforged.initialize',
            'specforged.createSpec',
            'specforged.setupMcp',
            'specforged.syncSpecs',
            'specforged.showCurrentSpec'
        ];

        for (const command of specforgedCommands) {
            assert.ok(commands.includes(command), `Command ${command} should be registered`);
        }
    });
});
