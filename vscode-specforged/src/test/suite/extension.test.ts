import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('specforged.vscode-specforged'));
    });

    test('Extension should activate', async () => {
        const ext = vscode.extensions.getExtension('specforged.vscode-specforged');
        if (ext) {
            await ext.activate();
            assert.ok(ext.isActive);
        }
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
