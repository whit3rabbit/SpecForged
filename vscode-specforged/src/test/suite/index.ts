import * as path from 'path';
import { glob } from 'glob';

export function run(): Promise<void> {
    // Use dynamic import for Mocha to avoid constructor issues
    return import('mocha').then(({ default: Mocha }) => {
        const mocha = new Mocha({
            ui: 'tdd',
            color: true,
            timeout: 30000, // Increase timeout for cleanup
            bail: false // Don't bail on first failure to ensure cleanup runs
        });

        const testsRoot = path.resolve(__dirname, '..');

        return new Promise<void>((c, e) => {
            glob('**/**.test.js', { cwd: testsRoot }, (err: Error | null, files: string[]) => {
                if (err) {
                    return e(err);
                }

                files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

                // Add global cleanup hooks
                addGlobalCleanupHooks();

                try {
                    mocha.run((failures: number) => {
                        // Force cleanup after all tests
                        performGlobalCleanup().finally(() => {
                            if (failures > 0) {
                                e(new Error(`${failures} tests failed.`));
                            } else {
                                c();
                            }
                        });
                    });
                } catch (err) {
                    console.error(err);
                    performGlobalCleanup().finally(() => e(err));
                }
            });
        });
    });
}

/**
 * Add global cleanup hooks for the test suite.
 */
function addGlobalCleanupHooks(): void {
    // Handle uncaught exceptions during tests
    process.on('uncaughtException', (error) => {
        console.error('Uncaught exception during test:', error);
        performGlobalCleanup().then(() => {
            process.exit(1);
        });
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled rejection during test:', reason);
        console.error('Promise:', promise);
    });

    // Handle process exit
    process.on('exit', () => {
        console.log('Test process exiting, performing final cleanup...');
    });

    // Handle various signals
    ['SIGINT', 'SIGTERM', 'SIGQUIT'].forEach(signal => {
        process.on(signal, () => {
            console.log(`Received ${signal}, cleaning up...`);
            performGlobalCleanup().then(() => {
                process.exit(0);
            });
        });
    });
}

/**
 * Perform global cleanup after all tests.
 */
async function performGlobalCleanup(): Promise<void> {
    try {
        console.log('Performing global test cleanup...');

        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }

        // Clear any remaining timers
        const maxHandle = setTimeout(() => {}, 0);
        for (let i = 0; i <= (maxHandle as unknown as number); i++) {
            clearTimeout(i);
            clearInterval(i);
        }

        // Give time for cleanup
        await new Promise(resolve => setTimeout(resolve, 100));

        console.log('Global cleanup completed');
    } catch (error) {
        console.warn('Error during global cleanup:', error);
    }
}
