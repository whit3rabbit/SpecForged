import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main() {
    try {
        const skip = [process.env.SKIP_VSCODE_TESTS, process.env.SKIP_TESTS]
            .some(v => v === '1' || (v || '').toLowerCase() === 'true');
        if (skip) {
            console.log('Skipping VS Code tests (SKIP_VSCODE_TESTS/SKIP_TESTS set)');
            process.exit(0);
        }

        const extensionDevelopmentPath = path.resolve(__dirname, '../../');
        const extensionTestsPath = path.resolve(__dirname, './suite/index');

        await runTests({ extensionDevelopmentPath, extensionTestsPath });
    } catch (err) {
        console.error('Failed to run tests');
        process.exit(1);
    }
}

main();
