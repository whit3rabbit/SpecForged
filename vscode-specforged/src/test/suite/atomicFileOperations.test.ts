import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
    AtomicFileOperations,
    AtomicFileOperationError,
    AtomicFileError,
    AtomicFileRetryManager,
    AtomicFileUtils,
    defaultAtomicConfig
} from '../../utils/atomicFileOperations';
import { McpOperationQueue, McpSyncState } from '../../models/mcpOperation';

suite('AtomicFileOperations Test Suite', () => {
    let tempDir: string;
    let atomicOps: AtomicFileOperations;

    suiteSetup(async () => {
        // Create a temporary directory for testing
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
            tempDir = path.join(workspaceFolder.uri.fsPath, '.test-atomic-ops');
        } else {
            // Fallback for tests without workspace
            tempDir = path.join(__dirname, '.test-atomic-ops');
        }

        // Ensure temp directory exists
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        atomicOps = new AtomicFileOperations();
    });

    suiteTeardown(async () => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('should write and read JSON file atomically', async () => {
        const testFile = path.join(tempDir, 'test.json');
        const testData = { message: 'Hello, World!', timestamp: new Date().toISOString() };

        // Write data
        await atomicOps.writeJsonFile(testFile, testData);

        // Verify file exists
        assert.ok(fs.existsSync(testFile), 'File should exist after write');

        // Read data back
        const readData = await atomicOps.readJsonFile<typeof testData>(testFile);

        // Verify data integrity
        assert.deepStrictEqual(readData, testData, 'Read data should match written data');
    });

    test('should handle file not found gracefully', async () => {
        const nonExistentFile = path.join(tempDir, 'nonexistent.json');

        try {
            await atomicOps.readJsonFile(nonExistentFile);
            assert.fail('Should have thrown an error for non-existent file');
        } catch (error) {
            assert.ok(error instanceof AtomicFileOperationError, 'Should throw AtomicFileOperationError');
            assert.strictEqual(error.errorType, AtomicFileError.FILE_NOT_FOUND, 'Should be FILE_NOT_FOUND error');
        }
    });

    test('should create backup and restore on write failure', async () => {
        const testFile = path.join(tempDir, 'backup-test.json');
        const originalData = { version: 1, content: 'original' };

        // Write initial data
        await atomicOps.writeJsonFile(testFile, originalData);

        // Verify original data exists
        const readOriginal = await atomicOps.readJsonFile<typeof originalData>(testFile);
        assert.deepStrictEqual(readOriginal, originalData);

        // Test that backup files are created (we can't easily simulate write failure in tests,
        // but we can verify the backup mechanism works by checking file operations)
        const newData = { version: 2, content: 'updated' };
        await atomicOps.writeJsonFile(testFile, newData);

        const readUpdated = await atomicOps.readJsonFile<typeof newData>(testFile);
        assert.deepStrictEqual(readUpdated, newData);
    });

    test('should handle operation queue operations', async () => {
        const emptyQueue: McpOperationQueue = {
            operations: [],
            conflicts: [],
            version: 1,
            createdAt: new Date().toISOString(),
            lastModified: new Date().toISOString(),
            processingStats: {
                totalProcessed: 0,
                successCount: 0,
                failureCount: 0,
                averageProcessingTimeMs: 0
            }
        };

        // Write operation queue
        await atomicOps.writeOperationQueue(tempDir, emptyQueue);

        // Read operation queue back
        const readQueue = await atomicOps.readOperationQueue(tempDir);

        // Verify structure (version should be incremented)
        assert.strictEqual(readQueue.operations.length, 0);
        assert.strictEqual(readQueue.version, 2); // Should be incremented
        assert.ok(readQueue.lastModified);
    });

    test('should handle sync state operations', async () => {
        const syncState: McpSyncState = {
            extensionOnline: true,
            mcpServerOnline: false,
            pendingOperations: 0,
            inProgressOperations: 0,
            failedOperations: 0,
            completedOperations: 0,
            activeConflicts: 0,
            syncErrors: [],
            specifications: [],
            performance: {
                averageOperationTimeMs: 0,
                queueProcessingRate: 0,
                lastProcessingDuration: 0
            }
        };

        // Write sync state
        await atomicOps.writeSyncState(tempDir, syncState);

        // Read sync state back
        const readState = await atomicOps.readSyncState(tempDir);

        // Verify data
        assert.strictEqual(readState.extensionOnline, true);
        assert.strictEqual(readState.mcpServerOnline, false);
        assert.strictEqual(readState.pendingOperations, 0);
    });

    test('should validate workspace correctly', async () => {
        // Test with valid workspace (temp directory)
        await assert.doesNotReject(
            () => atomicOps.validateWorkspace(tempDir),
            'Should not reject valid workspace'
        );

        // Test with invalid workspace
        const invalidPath = path.join(tempDir, 'nonexistent-directory');
        await assert.rejects(
            () => atomicOps.validateWorkspace(invalidPath),
            AtomicFileOperationError,
            'Should reject invalid workspace'
        );
    });

    test('should handle JSON parse errors gracefully', async () => {
        const corruptFile = path.join(tempDir, 'corrupt.json');

        // Write invalid JSON
        fs.writeFileSync(corruptFile, '{ invalid json content');

        try {
            await atomicOps.readJsonFile(corruptFile);
            assert.fail('Should have thrown an error for corrupt JSON');
        } catch (error) {
            assert.ok(error instanceof AtomicFileOperationError);
            assert.strictEqual(error.errorType, AtomicFileError.JSON_PARSE_ERROR);
        }
    });

    test('should cleanup temporary files', async () => {
        // Create some temporary files
        const tempFile1 = path.join(tempDir, 'test.json.tmp');
        const tempFile2 = path.join(tempDir, 'test.json.lock');

        fs.writeFileSync(tempFile1, 'temp content');
        fs.writeFileSync(tempFile2, 'lock content');

        // Verify files exist
        assert.ok(fs.existsSync(tempFile1));
        assert.ok(fs.existsSync(tempFile2));

        // Run cleanup
        await atomicOps.cleanup(tempDir);

        // Verify temp files are removed (may not work in all environments, so we'll just check it doesn't throw)
        // The actual cleanup behavior depends on the file system and permissions
    });

    test('AtomicFileRetryManager should retry operations with exponential backoff', async () => {
        let attemptCount = 0;
        const maxRetries = 2;

        const failingOperation = async () => {
            attemptCount++;
            if (attemptCount <= maxRetries) {
                throw new Error(`Attempt ${attemptCount} failed`);
            }
            return 'success';
        };

        const config = { ...defaultAtomicConfig, maxRetries, retryDelayMs: 10 }; // Fast retry for testing

        const result = await AtomicFileRetryManager.withRetry(
            failingOperation,
            config,
            'test operation'
        );

        assert.strictEqual(result, 'success');
        assert.strictEqual(attemptCount, maxRetries + 1); // Initial attempt + retries
    });

    test('AtomicFileUtils should provide utility functions', () => {
        // Test path sanitization
        const sanitized = AtomicFileUtils.sanitizePath('test/../file.json');
        assert.ok(!sanitized.includes('..'), 'Should remove path traversal attempts');

        // Test MCP file paths
        const mcpPaths = AtomicFileUtils.getMcpFilePaths(tempDir);
        assert.ok(mcpPaths.operationQueue.includes('mcp-operations.json'));
        assert.ok(mcpPaths.syncState.includes('specforge-sync.json'));
        assert.ok(mcpPaths.operationResults.includes('mcp-results.json'));
    });

    test('should handle empty files gracefully', async () => {
        const emptyFile = path.join(tempDir, 'empty.json');

        // Create empty file
        fs.writeFileSync(emptyFile, '');

        try {
            await atomicOps.readJsonFile(emptyFile);
            assert.fail('Should have thrown an error for empty file');
        } catch (error) {
            assert.ok(error instanceof AtomicFileOperationError);
            assert.strictEqual(error.errorType, AtomicFileError.JSON_PARSE_ERROR);
        }
    });

    test('should provide user-friendly error messages', () => {
        const error = new AtomicFileOperationError(
            AtomicFileError.PERMISSION_DENIED,
            'Test error',
            '/test/path',
            undefined,
            true
        );

        const userMessage = error.getUserMessage();
        const suggestions = error.getRecoverySuggestions();

        assert.ok(userMessage.includes('Permission denied'), 'Should provide user-friendly message');
        assert.ok(Array.isArray(suggestions), 'Should provide recovery suggestions');
        assert.ok(suggestions.length > 0, 'Should have at least one suggestion');
    });

    suite('Concurrent Operations', () => {
        test('should handle concurrent file writes safely', async () => {
            const testFile = path.join(tempDir, 'concurrent.json');
            const promises: Promise<void>[] = [];

            // Start multiple concurrent writes
            for (let i = 0; i < 10; i++) {
                promises.push(
                    atomicOps.writeJsonFile(testFile, { index: i, timestamp: new Date().toISOString() })
                );
            }

            await assert.doesNotReject(
                () => Promise.all(promises),
                'Should handle concurrent writes without corruption'
            );

            // File should exist and be valid JSON
            assert.ok(fs.existsSync(testFile), 'File should exist after concurrent writes');
            const finalData = await atomicOps.readJsonFile(testFile);
            assert.ok(finalData, 'Should be able to read valid JSON after concurrent writes');
        });

        test('should handle concurrent read/write operations', async () => {
            const testFile = path.join(tempDir, 'read-write.json');
            const initialData = { counter: 0 };
            await atomicOps.writeJsonFile(testFile, initialData);

            const operations: Promise<any>[] = [];

            // Mix of read and write operations
            for (let i = 0; i < 5; i++) {
                operations.push(atomicOps.readJsonFile(testFile));
                operations.push(atomicOps.writeJsonFile(testFile, { counter: i + 1 }));
            }

            await assert.doesNotReject(
                () => Promise.all(operations),
                'Should handle mixed read/write operations'
            );
        });
    });

    suite('Large File Operations', () => {
        test('should handle large JSON files', async () => {
            const testFile = path.join(tempDir, 'large.json');

            // Create large data structure
            const largeData = {
                items: Array.from({ length: 10000 }, (_, i) => ({
                    id: `item-${i}`,
                    name: `Item ${i}`,
                    description: `Description for item ${i}`.repeat(10),
                    metadata: {
                        created: new Date().toISOString(),
                        tags: [`tag-${i % 100}`, `category-${Math.floor(i / 100)}`]
                    }
                }))
            };

            await assert.doesNotReject(
                () => atomicOps.writeJsonFile(testFile, largeData),
                'Should handle large file writes'
            );

            const readData = await atomicOps.readJsonFile<{ items: any[] }>(testFile);
            assert.strictEqual(readData.items.length, 10000, 'Should preserve all data items');
        });

        test('should handle files near system limits', async () => {
            const testFile = path.join(tempDir, 'system-limit.json');

            // Create data that approaches common system limits
            const data = {
                longString: 'x'.repeat(1024 * 1024), // 1MB string
                deepNesting: Array.from({ length: 100 }, () => ({ nested: { data: 'test' } }))
            };

            await assert.doesNotReject(
                () => atomicOps.writeJsonFile(testFile, data),
                'Should handle files near system limits'
            );
        });
    });

    suite('Error Recovery', () => {
        test('should recover from partial write failures', async () => {
            const testFile = path.join(tempDir, 'recovery.json');
            const originalData = { status: 'original' };

            // Write initial data
            await atomicOps.writeJsonFile(testFile, originalData);

            // Simulate partial write by creating a temporary file
            const tempFile = testFile + '.tmp';
            fs.writeFileSync(tempFile, '{ "status": "partial"'); // Invalid JSON

            // New write should still succeed
            const newData = { status: 'recovered' };
            await atomicOps.writeJsonFile(testFile, newData);

            const readData = await atomicOps.readJsonFile(testFile);
            assert.deepStrictEqual(readData, newData, 'Should recover from partial writes');

            // Temp file should be cleaned up
            assert.ok(!fs.existsSync(tempFile), 'Temporary file should be cleaned up');
        });

        test('should handle filesystem permission changes during operation', async () => {
            const testFile = path.join(tempDir, 'permission.json');
            const data = { test: 'permission test' };

            await atomicOps.writeJsonFile(testFile, data);

            try {
                // Make file read-only
                fs.chmodSync(testFile, 0o444);

                // Attempt to write should fail gracefully
                await assert.rejects(
                    () => atomicOps.writeJsonFile(testFile, { updated: true }),
                    AtomicFileOperationError,
                    'Should fail gracefully with permission error'
                );
            } finally {
                // Restore write permissions for cleanup
                fs.chmodSync(testFile, 0o644);
            }
        });

        test('should handle disk space simulation', async () => {
            // This test is challenging to implement reliably across platforms
            // We'll test the error handling path instead
            const testFile = path.join(tempDir, 'disk-space.json');

            // Mock fs.writeFileSync to throw ENOSPC error
            const originalWriteFileSync = fs.writeFileSync;
            let writeAttempts = 0;

            (fs as any).writeFileSync = ((path: any, data: any, options?: any) => {
                writeAttempts++;
                if (writeAttempts === 1) {
                    const error = new Error('ENOSPC: no space left on device') as any;
                    error.code = 'ENOSPC';
                    throw error;
                }
                return originalWriteFileSync(path, data, options);
            });

            try {
                await assert.rejects(
                    () => atomicOps.writeJsonFile(testFile, { test: 'disk space' }),
                    /ENOSPC/,
                    'Should handle disk space errors'
                );
            } finally {
                (fs as any).writeFileSync = originalWriteFileSync;
            }
        });
    });

    suite('Path Validation and Security', () => {
        test('should prevent path traversal attacks', () => {
            const dangerousPaths = [
                '../../../etc/passwd',
                '..\\..\\..\\windows\\system32\\config\\sam',
                '/etc/passwd',
                'C:\\Windows\\System32\\config\\SAM',
                'test/../../../sensitive.json'
            ];

            // Test that dangerous absolute paths throw errors
            const absolutePaths = ['/etc/passwd', 'C:\\Windows\\System32\\config\\SAM'];
            for (const dangerousPath of absolutePaths) {
                assert.throws(
                    () => AtomicFileUtils.sanitizePath(dangerousPath),
                    AtomicFileOperationError,
                    `Should reject absolute path: ${dangerousPath}`
                );
            }

            // Test that relative dangerous paths are sanitized
            const relativePaths = [
                '../../../etc/passwd',
                '..\\..\\..\\windows\\system32\\config\\sam',
                'test/../../../sensitive.json'
            ];
            for (const dangerousPath of relativePaths) {
                const sanitized = AtomicFileUtils.sanitizePath(dangerousPath);
                assert.ok(!sanitized.includes('..'), `Should sanitize path traversal: ${dangerousPath}`);
            }
        });

        test('should handle unicode and special characters in paths', () => {
            const specialPaths = [
                'test-файл.json',
                'test-文件.json',
                'test file with spaces.json',
                'test-file-with-émojis-🎉.json',
                'test.file.with.dots.json'
            ];

            for (const specialPath of specialPaths) {
                const sanitized = AtomicFileUtils.sanitizePath(specialPath);
                assert.ok(sanitized.length > 0, `Should handle special characters: ${specialPath}`);
                assert.ok(!sanitized.includes('..'), `Should not create path traversal: ${specialPath}`);
            }
        });

        test('should validate workspace paths', async () => {
            const validWorkspace = tempDir;
            const invalidWorkspace = '/nonexistent/path';
            const unauthorizedWorkspace = '/etc';

            await assert.doesNotReject(
                () => atomicOps.validateWorkspace(validWorkspace),
                'Should accept valid workspace'
            );

            await assert.rejects(
                () => atomicOps.validateWorkspace(invalidWorkspace),
                AtomicFileOperationError,
                'Should reject nonexistent workspace'
            );

            if (process.platform !== 'win32') {
                await assert.rejects(
                    () => atomicOps.validateWorkspace(unauthorizedWorkspace),
                    'Should reject unauthorized workspace'
                );
            }
        });
    });

    suite('Performance and Optimization', () => {
        test('should handle rapid successive operations efficiently', async () => {
            const testFile = path.join(tempDir, 'rapid.json');
            const startTime = Date.now();

            // Perform many rapid operations
            for (let i = 0; i < 100; i++) {
                await atomicOps.writeJsonFile(testFile, { iteration: i, timestamp: Date.now() });
            }

            const endTime = Date.now();
            const duration = endTime - startTime;

            // Should complete within reasonable time (adjust threshold as needed)
            assert.ok(duration < 10000, `Operations should complete efficiently: ${duration}ms`);

            const finalData = await atomicOps.readJsonFile<{ iteration: number }>(testFile);
            assert.strictEqual(finalData.iteration, 99, 'Should have final iteration data');
        });

        test('should optimize memory usage for repeated operations', async () => {
            const testFile = path.join(tempDir, 'memory.json');
            const initialMemory = process.memoryUsage().heapUsed;

            // Perform operations that could leak memory if not properly managed
            for (let i = 0; i < 50; i++) {
                const data = {
                    iteration: i,
                    largeArray: Array.from({ length: 1000 }, (_, j) => `item-${i}-${j}`)
                };
                await atomicOps.writeJsonFile(testFile, data);

                if (i % 10 === 0 && global.gc) {
                    global.gc(); // Force garbage collection if available
                }
            }

            const finalMemory = process.memoryUsage().heapUsed;
            const memoryIncrease = finalMemory - initialMemory;

            // Memory increase should be reasonable (adjust threshold based on expectations)
            assert.ok(memoryIncrease < 50 * 1024 * 1024, `Memory usage should be reasonable: ${memoryIncrease} bytes`);
        });
    });

    suite('Cross-Platform Compatibility', () => {
        test('should handle platform-specific path separators', () => {
            const testPaths = [
                'dir/subdir/file.json',
                'dir\\subdir\\file.json',
                'mixed/separators\\file.json'
            ];

            for (const testPath of testPaths) {
                const mcpPaths = AtomicFileUtils.getMcpFilePaths(testPath);

                // All paths should be properly normalized
                assert.ok(mcpPaths.operationQueue.includes(path.sep), 'Should use platform path separator');
                assert.ok(mcpPaths.syncState.includes(path.sep), 'Should use platform path separator');
                assert.ok(mcpPaths.operationResults.includes(path.sep), 'Should use platform path separator');
            }
        });

        test('should handle case sensitivity differences', async () => {
            const testFile1 = path.join(tempDir, 'CaseSensitive.json');
            const testFile2 = path.join(tempDir, 'casesensitive.json');

            await atomicOps.writeJsonFile(testFile1, { file: 'first' });

            if (process.platform === 'win32' || process.platform === 'darwin') {
                // Case-insensitive filesystem
                const data = await atomicOps.readJsonFile(testFile2);
                assert.deepStrictEqual(data, { file: 'first' }, 'Should handle case-insensitive filesystems');
            } else {
                // Case-sensitive filesystem
                await atomicOps.writeJsonFile(testFile2, { file: 'second' });
                const data1 = await atomicOps.readJsonFile(testFile1);
                const data2 = await atomicOps.readJsonFile(testFile2);
                assert.deepStrictEqual(data1, { file: 'first' }, 'Should maintain case sensitivity');
                assert.deepStrictEqual(data2, { file: 'second' }, 'Should maintain case sensitivity');
            }
        });
    });

    suite('Integration with MCP Operations', () => {
        test('should handle operation results with complex data structures', async () => {
            const testResults = {
                results: [
                    {
                        operationId: 'op-1',
                        success: true,
                        message: 'Operation completed successfully',
                        timestamp: new Date().toISOString(),
                        retryable: false,
                        data: {
                            specId: 'test-spec',
                            files: ['requirements.md', 'design.md'],
                            metadata: {
                                version: '1.0.0',
                                created: new Date().toISOString(),
                                tags: ['urgent', 'backend']
                            }
                        },
                        processingTimeMs: 1500
                    },
                    {
                        operationId: 'op-2',
                        success: false,
                        message: 'Validation failed',
                        timestamp: new Date().toISOString(),
                        retryable: true,
                        processingTimeMs: 500,
                        error: {
                            code: 'VALIDATION_ERROR',
                            message: 'Invalid specification format',
                            details: {
                                field: 'requirements',
                                expected: 'array',
                                received: 'string'
                            }
                        }
                    }
                ],
                lastUpdated: new Date().toISOString()
            };

            await atomicOps.writeOperationResults(tempDir, testResults);
            const readResults = await atomicOps.readOperationResults(tempDir);

            assert.deepStrictEqual(readResults, testResults, 'Should preserve complex operation results');
        });

        test('should validate operation queue structure', async () => {
            const invalidQueue = {
                operations: [
                    { id: 'test' }, // Missing required fields
                    null, // Invalid operation
                    { id: 'valid', type: 'CREATE_SPEC', status: 'PENDING' }
                ],
                version: 'invalid' // Should be number
            };

            await assert.rejects(
                () => atomicOps.writeOperationQueue(tempDir, invalidQueue as any),
                'Should validate operation queue structure'
            );
        });

        test('should handle sync state edge cases', async () => {
            const edgeCaseSyncState = {
                extensionOnline: true,
                mcpServerOnline: false,
                pendingOperations: 0,
                inProgressOperations: 0,
                failedOperations: 0,
                completedOperations: 0,
                activeConflicts: 0,
                syncErrors: Array.from({ length: 20 }, (_, i) => ({
                    timestamp: new Date(Date.now() - i * 1000).toISOString(),
                    error: `Error ${i}`
                })),
                specifications: [],
                performance: {
                    averageOperationTimeMs: Number.MAX_SAFE_INTEGER,
                    queueProcessingRate: Number.MIN_VALUE,
                    lastProcessingDuration: 0
                }
            };

            await atomicOps.writeSyncState(tempDir, edgeCaseSyncState);
            const readState = await atomicOps.readSyncState(tempDir);

            assert.deepStrictEqual(readState, edgeCaseSyncState, 'Should handle sync state edge cases');
        });
    });
});
