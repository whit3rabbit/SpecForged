import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Activation Tests', () => {
    test('Extension should activate without errors', async () => {
        // Get the extension
        const extension = vscode.extensions.getExtension('specforged.vscode-specforged');

        if (extension) {
            // Activate the extension
            await extension.activate();

            // Verify extension is active
            assert.strictEqual(extension.isActive, true);
        } else {
            assert.fail('Extension not found');
        }
    });

    test('Configuration should load with default values', () => {
        const config = vscode.workspace.getConfiguration('specforged');

        // Test some key configuration values
        assert.strictEqual(config.get('autoDetect'), true);
        assert.strictEqual(config.get('specFolder'), '.specifications');
        assert.strictEqual(config.get('enableDashboard'), true);
        assert.strictEqual(config.get('autoDiscovery'), true);
    });

    test('Commands should be registered', async () => {
        const commands = await vscode.commands.getCommands();

        // Check for key commands
        const expectedCommands = [
            'specforged.initialize',
            'specforged.createSpec',
            'specforged.openMcpDashboard',
            'specforged.discoverMcpEcosystem',
            'specforged.refreshQueue'
        ];

        for (const command of expectedCommands) {
            assert.ok(commands.includes(command), `Command ${command} should be registered`);
        }
    });
});
