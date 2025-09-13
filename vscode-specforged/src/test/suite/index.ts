import * as path from 'path';
import { glob } from 'glob';

export function run(): Promise<void> {
    // Use dynamic import for Mocha to avoid constructor issues
    return import('mocha').then(({ default: Mocha }) => {
        const mocha = new Mocha({
            ui: 'tdd',
            color: true
        });

        const testsRoot = path.resolve(__dirname, '..');

        return new Promise<void>((c, e) => {
            glob('**/**.test.js', { cwd: testsRoot }, (err: Error | null, files: string[]) => {
                if (err) {
                    return e(err);
                }

                files.forEach((f: string) => mocha.addFile(path.resolve(testsRoot, f)));

                try {
                    mocha.run((failures: number) => {
                        if (failures > 0) {
                            e(new Error(`${failures} tests failed.`));
                        } else {
                            c();
                        }
                    });
                } catch (err) {
                    console.error(err);
                    e(err);
                }
            });
        });
    });
}
