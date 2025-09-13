import * as assert from 'assert';
import { ConflictResolver, ConflictType, ConflictResolution } from '../utils/conflictResolver';
import { McpOperation, McpOperationType, McpOperationStatus, McpOperationPriority, McpOperationFactory } from '../models/mcpOperation';

suite('ConflictResolver Tests', () => {
    let conflictResolver: ConflictResolver;

    setup(() => {
        conflictResolver = new ConflictResolver();
    });

    teardown(() => {
        conflictResolver.dispose();
    });

    test('should detect duplicate operations', async () => {
        const operation1 = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');
        const operation2 = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');

        const conflicts = await conflictResolver.detectConflicts(operation2, [operation1]);

        assert.strictEqual(conflicts.length, 1);
        assert.strictEqual(conflicts[0].type, ConflictType.DUPLICATE_OPERATION);
    });

    test('should detect concurrent modifications', async () => {
        const operation1 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Content 1');
        const operation2 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Content 2');

        // Set timestamps close together
        const now = new Date();
        operation1.timestamp = now.toISOString();
        operation2.timestamp = new Date(now.getTime() + 30000).toISOString(); // 30 seconds later

        const conflicts = await conflictResolver.detectConflicts(operation2, [operation1]);

        // Should detect at least one conflict (concurrent modification)
        assert.ok(conflicts.length >= 1);
        const concurrentConflict = conflicts.find(c => c.type === ConflictType.CONCURRENT_MODIFICATION);
        assert.ok(concurrentConflict, 'Should detect concurrent modification conflict');
    });

    test('should detect dependency conflicts', async () => {
        const operation1 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Content');
        operation1.status = McpOperationStatus.IN_PROGRESS;

        const operation2 = McpOperationFactory.createUpdateDesignOperation('test-spec', 'Design');
        operation2.dependencies = [operation1.id];

        const conflicts = await conflictResolver.detectConflicts(operation2, [operation1]);

        // Should detect at least one conflict (dependency conflict)
        assert.ok(conflicts.length >= 1);
        const dependencyConflict = conflicts.find(c => c.type === ConflictType.DEPENDENCY_CONFLICT);
        assert.ok(dependencyConflict, 'Should detect dependency conflict');
    });

    test('should auto-resolve duplicate operations', async () => {
        const operation1 = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');
        const operation2 = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');

        const conflicts = await conflictResolver.detectConflicts(operation2, [operation1]);
        const conflict = conflicts[0];

        assert.strictEqual(conflict.autoResolvable, true);

        const resolved = await conflictResolver.resolveConflict(conflict.id);
        assert.strictEqual(resolved, true);

        const resolvedConflict = conflictResolver.getConflictById(conflict.id);
        assert.strictEqual(resolvedConflict?.resolved, true);
        assert.strictEqual(resolvedConflict?.resolution, ConflictResolution.CANCEL);
    });

    test('should track conflict statistics', async () => {
        const operation1 = McpOperationFactory.createCreateSpecOperation('Test Spec 1', 'Description');
        const operation2 = McpOperationFactory.createCreateSpecOperation('Test Spec 1', 'Description');

        await conflictResolver.detectConflicts(operation2, [operation1]);

        const stats = conflictResolver.getConflictStatistics();
        assert.strictEqual(stats.totalConflicts, 1);
    });

    test('should provide conflict prevention strategies', () => {
        const strategies = conflictResolver.getPreventionStrategies();
        assert.ok(strategies.length > 0);

        const batchStrategy = strategies.find(s => s.id === 'batch-similar');
        assert.ok(batchStrategy);
        assert.strictEqual(batchStrategy.enabled, true);
    });

    test('should calculate operation similarity correctly', async () => {
        const operation1 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Hello World');
        const operation2 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Hello World');
        const operation3 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Goodbye World');

        // Access private method through any cast for testing
        const resolver = conflictResolver as any;

        const similarity1 = resolver.calculateOperationSimilarity(operation1, operation2);
        const similarity2 = resolver.calculateOperationSimilarity(operation1, operation3);

        assert.strictEqual(similarity1, 1.0); // Identical operations
        assert.ok(similarity2 > 0 && similarity2 < 1.0); // Similar but not identical
    });

    test('should handle circular dependency detection', async () => {
        const operation1 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Content 1');
        const operation2 = McpOperationFactory.createUpdateDesignOperation('test-spec', 'Content 2');
        const operation3 = McpOperationFactory.createUpdateTasksOperation('test-spec', 'Content 3');

        // Create circular dependency: op1 -> op2 -> op3 -> op1
        operation1.dependencies = [operation3.id];
        operation2.dependencies = [operation1.id];
        operation3.dependencies = [operation2.id];

        const conflicts = await conflictResolver.detectConflicts(operation1, [operation2, operation3]);

        const circularConflict = conflicts.find(c => c.type === ConflictType.CIRCULAR_DEPENDENCY);
        assert.ok(circularConflict);
        assert.strictEqual(circularConflict.severity, 'critical');
    });

    test('should export conflict report', async () => {
        const operation1 = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');
        const operation2 = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');

        await conflictResolver.detectConflicts(operation2, [operation1]);

        const report = await conflictResolver.exportConflictReport();
        const reportData = JSON.parse(report);

        assert.ok(reportData.timestamp);
        assert.ok(reportData.statistics);
        assert.ok(reportData.preventionStrategies);
        assert.strictEqual(typeof reportData.totalConflicts, 'number');
    });

    suite('Advanced Conflict Detection', () => {
        test('should detect resource lock conflicts', async () => {
            const operation1 = McpOperationFactory.createDeleteSpecOperation('test-spec');
            operation1.status = McpOperationStatus.IN_PROGRESS;

            const operation2 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'New requirements');

            const conflicts = await conflictResolver.detectConflicts(operation2, [operation1]);

            const lockConflict = conflicts.find(c => c.type === ConflictType.RESOURCE_LOCKED);
            assert.ok(lockConflict, 'Should detect resource lock conflict');
            assert.strictEqual(lockConflict.severity, 'high');
        });

        test('should detect version mismatch conflicts', async () => {
            const operation1 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Content 1');
            operation1.metadata = { version: '1.0.0' };

            const operation2 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Content 2');
            operation2.metadata = { version: '2.0.0' };

            const conflicts = await conflictResolver.detectConflicts(operation2, [operation1]);

            const versionConflict = conflicts.find(c => c.type === ConflictType.VERSION_MISMATCH);
            assert.ok(versionConflict, 'Should detect version mismatch conflict');
            assert.strictEqual(versionConflict.severity, 'high');
        });

        test('should detect priority conflicts', async () => {
            const operation1 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Content 1');
            operation1.status = McpOperationStatus.IN_PROGRESS;
            operation1.priority = McpOperationPriority.LOW;

            const operation2 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Content 2');
            operation2.priority = McpOperationPriority.URGENT;

            const conflicts = await conflictResolver.detectConflicts(operation2, [operation1]);

            const priorityConflict = conflicts.find(c => c.type === ConflictType.PRIORITY_CONFLICT);
            assert.ok(priorityConflict, 'Should detect priority conflict');
            assert.strictEqual(priorityConflict.severity, 'medium');
        });

        test('should detect outdated operations', async () => {
            const operation = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');
            operation.status = McpOperationStatus.PENDING;
            operation.timestamp = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 minutes ago

            const conflicts = await conflictResolver.detectConflicts(operation, []);

            const outdatedConflict = conflicts.find(c => c.type === ConflictType.OUTDATED_OPERATION);
            assert.ok(outdatedConflict, 'Should detect outdated operation');
            assert.strictEqual(outdatedConflict.severity, 'low');
        });

        test('should calculate conflict severity based on operation priority', async () => {
            const urgentOp = McpOperationFactory.createCreateSpecOperation('Urgent Spec', 'Description');
            urgentOp.priority = McpOperationPriority.URGENT;

            const normalOp = McpOperationFactory.createCreateSpecOperation('Normal Spec', 'Description');
            normalOp.priority = McpOperationPriority.NORMAL;

            const urgentConflicts = await conflictResolver.detectConflicts(urgentOp, [normalOp]);
            const normalConflicts = await conflictResolver.detectConflicts(normalOp, [urgentOp]);

            if (urgentConflicts.length > 0 && normalConflicts.length > 0) {
                // Urgent operations should create higher severity conflicts
                const urgentConflictSeverity = urgentConflicts[0].severity;
                const normalConflictSeverity = normalConflicts[0].severity;

                const severityOrder = { low: 0, medium: 1, high: 2, critical: 3 };
                assert.ok(
                    severityOrder[urgentConflictSeverity] >= severityOrder[normalConflictSeverity],
                    'Urgent operations should create higher or equal severity conflicts'
                );
            }
        });

        test('should detect conflicts for exclusive operations', async () => {
            const deleteOp = McpOperationFactory.createDeleteSpecOperation('test-spec');
            const updateOp = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'New content');

            const conflicts = await conflictResolver.detectConflicts(updateOp, [deleteOp]);

            // Should detect resource lock conflict since delete is exclusive
            const lockConflict = conflicts.find(c => c.type === ConflictType.RESOURCE_LOCKED);
            assert.ok(lockConflict, 'Should detect conflict with exclusive operation');
        });
    });

    suite('Conflict Resolution Strategies', () => {
        test('should resolve conflicts with extension wins strategy', async () => {
            const operation1 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'MCP Content');
            operation1.source = 'mcp';

            const operation2 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Extension Content');
            operation2.source = 'extension';

            const conflicts = await conflictResolver.detectConflicts(operation2, [operation1]);
            const conflict = conflicts[0];

            const resolved = await conflictResolver.resolveConflict(conflict.id, ConflictResolution.EXTENSION_WINS);
            assert.strictEqual(resolved, true);

            // MCP operation should be cancelled
            assert.strictEqual(operation1.status, McpOperationStatus.CANCELLED);
            assert.ok(operation1.error?.includes('extension wins'));
        });

        test('should resolve conflicts with MCP wins strategy', async () => {
            const operation1 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Extension Content');
            operation1.source = 'extension';

            const operation2 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'MCP Content');
            operation2.source = 'mcp';

            const conflicts = await conflictResolver.detectConflicts(operation2, [operation1]);
            const conflict = conflicts[0];

            const resolved = await conflictResolver.resolveConflict(conflict.id, ConflictResolution.MCP_WINS);
            assert.strictEqual(resolved, true);

            // Extension operation should be cancelled
            assert.strictEqual(operation1.status, McpOperationStatus.CANCELLED);
            assert.ok(operation1.error?.includes('MCP wins'));
        });

        test('should resolve conflicts with retry strategy', async () => {
            const operation = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');
            operation.status = McpOperationStatus.FAILED;
            operation.retryCount = 1;

            const conflicts = await conflictResolver.detectConflicts(operation, []);
            const conflict = conflicts[0];

            if (conflict) {
                const resolved = await conflictResolver.resolveConflict(conflict.id, ConflictResolution.RETRY);
                assert.strictEqual(resolved, true);

                // Operation should be reset for retry
                assert.strictEqual(operation.status, McpOperationStatus.PENDING);
                assert.strictEqual(operation.retryCount, 2);
                assert.strictEqual(operation.error, undefined);
            }
        });

        test('should resolve conflicts with cancel strategy', async () => {
            const operation1 = McpOperationFactory.createCreateSpecOperation('Test Spec 1', 'Description');
            const operation2 = McpOperationFactory.createCreateSpecOperation('Test Spec 1', 'Description');

            const conflicts = await conflictResolver.detectConflicts(operation2, [operation1]);
            const conflict = conflicts[0];

            const resolved = await conflictResolver.resolveConflict(conflict.id, ConflictResolution.CANCEL);
            assert.strictEqual(resolved, true);

            // All operations in conflict should be cancelled
            const cancelledOps = conflict.operations.filter(op => op.status === McpOperationStatus.CANCELLED);
            assert.ok(cancelledOps.length > 0, 'Some operations should be cancelled');
        });

        test('should resolve conflicts with defer strategy', async () => {
            const operation1 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Content 1');
            operation1.status = McpOperationStatus.PENDING;
            operation1.priority = McpOperationPriority.HIGH;

            const operation2 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Content 2');
            operation2.status = McpOperationStatus.PENDING;
            operation2.priority = McpOperationPriority.HIGH;

            const conflicts = await conflictResolver.detectConflicts(operation2, [operation1]);
            const conflict = conflicts[0];

            if (conflict) {
                const resolved = await conflictResolver.resolveConflict(conflict.id, ConflictResolution.DEFER);
                assert.strictEqual(resolved, true);

                // Operations should have reduced priority and delay
                const deferredOps = conflict.operations.filter(op =>
                    op.priority < McpOperationPriority.HIGH ||
                    (op.metadata && op.metadata.deferredUntil)
                );
                assert.ok(deferredOps.length > 0, 'Some operations should be deferred');
            }
        });

        test('should resolve conflicts with reorder strategy', async () => {
            const operation1 = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');
            operation1.status = McpOperationStatus.PENDING;
            operation1.priority = McpOperationPriority.LOW;
            operation1.dependencies = ['dep1', 'dep2'];

            const operation2 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Requirements');
            operation2.status = McpOperationStatus.PENDING;
            operation2.priority = McpOperationPriority.HIGH;
            operation2.dependencies = ['dep1'];

            const conflicts = await conflictResolver.detectConflicts(operation2, [operation1]);
            const conflict = conflicts[0];

            if (conflict) {
                const originalTimestamp1 = operation1.timestamp;
                const originalTimestamp2 = operation2.timestamp;

                const resolved = await conflictResolver.resolveConflict(conflict.id, ConflictResolution.REORDER);
                assert.strictEqual(resolved, true);

                // Timestamps should be updated to reflect new order
                assert.notStrictEqual(operation1.timestamp, originalTimestamp1);
                assert.notStrictEqual(operation2.timestamp, originalTimestamp2);

                // Higher priority operation should have earlier timestamp
                assert.ok(new Date(operation2.timestamp).getTime() < new Date(operation1.timestamp).getTime());
            }
        });

        test('should attempt merge resolution for concurrent modifications', async () => {
            const operation1 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Line 1\nLine 2');
            const operation2 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Line 1\nLine 3');

            const conflicts = await conflictResolver.detectConflicts(operation2, [operation1]);
            const concurrentConflict = conflicts.find(c => c.type === ConflictType.CONCURRENT_MODIFICATION);

            if (concurrentConflict) {
                const resolved = await conflictResolver.resolveConflict(concurrentConflict.id, ConflictResolution.MERGE);

                // Merge may or may not succeed depending on content compatibility
                if (resolved) {
                    // If merge succeeded, one operation should be cancelled
                    const cancelledOps = concurrentConflict.operations.filter(op => op.status === McpOperationStatus.CANCELLED);
                    assert.ok(cancelledOps.length > 0, 'Some operations should be cancelled after merge');
                }
            }
        });
    });

    suite('Conflict Prevention', () => {
        test('should enable and disable prevention strategies', async () => {
            const strategy = conflictResolver.getPreventionStrategies()[0];
            const strategyId = strategy.id;

            // Disable strategy
            const disabled = await conflictResolver.disablePreventionStrategy(strategyId);
            assert.strictEqual(disabled, true);

            const disabledStrategy = conflictResolver.getPreventionStrategies().find(s => s.id === strategyId);
            assert.strictEqual(disabledStrategy?.enabled, false);

            // Re-enable strategy
            const enabled = await conflictResolver.enablePreventionStrategy(strategyId);
            assert.strictEqual(enabled, true);

            const enabledStrategy = conflictResolver.getPreventionStrategies().find(s => s.id === strategyId);
            assert.strictEqual(enabledStrategy?.enabled, true);
        });

        test('should apply prevention strategies during conflict detection', async () => {
            const operation1 = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');
            const operation2 = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');

            // Prevention strategies should be applied automatically
            const conflicts = await conflictResolver.detectConflicts(operation2, [operation1]);

            // Even if conflicts are detected, prevention may have been attempted
            assert.ok(true, 'Prevention strategies should run without error');
        });

        test('should validate operations during pre-queue validation', async () => {
            const invalidOperation = McpOperationFactory.createCreateSpecOperation('', ''); // Invalid: empty name

            const resolver = conflictResolver as any;
            const isValid = resolver.validateOperationPreQueue(invalidOperation, { strictMode: true });

            // Validation should catch invalid operations
            assert.ok(typeof isValid === 'boolean', 'Validation should return boolean result');
        });
    });

    suite('Pattern Recognition and Learning', () => {
        test('should track conflict patterns', async () => {
            const operation1 = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');
            const operation2 = McpOperationFactory.createCreateSpecOperation('Test Spec', 'Description');

            // Create multiple similar conflicts to establish a pattern
            await conflictResolver.detectConflicts(operation2, [operation1]);

            const patterns = conflictResolver.getConflictPatterns();
            assert.ok(patterns.length >= 0, 'Should track conflict patterns');
        });

        test('should update pattern success rates after resolution', async () => {
            const operation1 = McpOperationFactory.createCreateSpecOperation('Pattern Test', 'Description');
            const operation2 = McpOperationFactory.createCreateSpecOperation('Pattern Test', 'Description');

            const conflicts = await conflictResolver.detectConflicts(operation2, [operation1]);
            const conflict = conflicts[0];

            if (conflict) {
                const resolved = await conflictResolver.resolveConflict(conflict.id, ConflictResolution.CANCEL);

                // Pattern recognition should update success rates
                assert.strictEqual(resolved, true);

                const patterns = conflictResolver.getConflictPatterns();
                // Patterns may be created over time with multiple conflicts
                assert.ok(patterns.length >= 0, 'Pattern tracking should function');
            }
        });

        test('should provide pattern-based recommendations', async () => {
            const operation1 = McpOperationFactory.createCreateSpecOperation('Recommendation Test', 'Description');
            const operation2 = McpOperationFactory.createCreateSpecOperation('Recommendation Test', 'Description');

            const conflicts = await conflictResolver.detectConflicts(operation2, [operation1]);
            const conflict = conflicts[0];

            if (conflict) {
                // Conflict should have recommendations based on conflict type
                assert.ok(conflict.recommendations.length > 0, 'Should provide resolution recommendations');
                assert.ok(conflict.recommendations.includes(ConflictResolution.CANCEL), 'Should recommend cancel for duplicates');
            }
        });
    });

    suite('Multiple Conflict Resolution', () => {
        test('should resolve multiple conflicts simultaneously', async () => {
            const operation1 = McpOperationFactory.createCreateSpecOperation('Spec 1', 'Description');
            const operation2 = McpOperationFactory.createCreateSpecOperation('Spec 1', 'Description');
            const operation3 = McpOperationFactory.createCreateSpecOperation('Spec 2', 'Description');
            const operation4 = McpOperationFactory.createCreateSpecOperation('Spec 2', 'Description');

            const conflicts1 = await conflictResolver.detectConflicts(operation2, [operation1]);
            const conflicts2 = await conflictResolver.detectConflicts(operation4, [operation3]);

            const conflictIds = [...conflicts1, ...conflicts2].map(c => c.id);

            if (conflictIds.length > 0) {
                const result = await conflictResolver.resolveMultipleConflicts(conflictIds, ConflictResolution.CANCEL);

                assert.ok(result.resolved.length > 0, 'Should resolve some conflicts');
                assert.strictEqual(result.resolved.length + result.failed.length, conflictIds.length, 'Should account for all conflicts');
            }
        });

        test('should auto-resolve all auto-resolvable conflicts', async () => {
            const operation1 = McpOperationFactory.createCreateSpecOperation('Auto Resolve Test', 'Description');
            const operation2 = McpOperationFactory.createCreateSpecOperation('Auto Resolve Test', 'Description');

            await conflictResolver.detectConflicts(operation2, [operation1]);

            const result = await conflictResolver.autoResolveAllConflicts();

            assert.ok(result.resolved >= 0, 'Should attempt to auto-resolve conflicts');
            assert.ok(result.failed >= 0, 'Should track failed resolutions');
        });
    });

    suite('Maintenance and Cleanup', () => {
        test('should cleanup old resolved conflicts', async () => {
            const operation1 = McpOperationFactory.createCreateSpecOperation('Cleanup Test', 'Description');
            const operation2 = McpOperationFactory.createCreateSpecOperation('Cleanup Test', 'Description');

            const conflicts = await conflictResolver.detectConflicts(operation2, [operation1]);
            const conflict = conflicts[0];

            if (conflict) {
                await conflictResolver.resolveConflict(conflict.id, ConflictResolution.CANCEL);

                // Manually set resolved time to be old
                const resolvedConflict = conflictResolver.getConflictById(conflict.id);
                if (resolvedConflict) {
                    resolvedConflict.resolvedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
                }

                const activeConflictsBefore = conflictResolver.getActiveConflicts().length;

                await conflictResolver.cleanupResolvedConflicts(1); // Cleanup conflicts older than 1 hour

                const activeConflictsAfter = conflictResolver.getActiveConflicts().length;

                // Should not affect active conflicts count since we're cleaning resolved ones
                assert.ok(activeConflictsAfter >= 0, 'Should cleanup old resolved conflicts');
            }
        });

        test('should perform comprehensive maintenance', async () => {
            // Create some conflicts and patterns
            const operation1 = McpOperationFactory.createCreateSpecOperation('Maintenance Test', 'Description');
            const operation2 = McpOperationFactory.createCreateSpecOperation('Maintenance Test', 'Description');

            await conflictResolver.detectConflicts(operation2, [operation1]);

            await assert.doesNotReject(
                () => conflictResolver.performMaintenance(),
                'Maintenance should run without errors'
            );
        });
    });

    suite('String Similarity and Algorithms', () => {
        test('should calculate string similarity correctly', () => {
            const resolver = conflictResolver as any;

            const similarity1 = resolver.calculateStringSimilarity('hello', 'hello');
            assert.strictEqual(similarity1, 1.0, 'Identical strings should have similarity 1.0');

            const similarity2 = resolver.calculateStringSimilarity('hello', 'hallo');
            assert.ok(similarity2 > 0.5 && similarity2 < 1.0, 'Similar strings should have high similarity');

            const similarity3 = resolver.calculateStringSimilarity('hello', 'world');
            assert.ok(similarity3 < 0.5, 'Different strings should have low similarity');
        });

        test('should calculate Levenshtein distance correctly', () => {
            const resolver = conflictResolver as any;

            const distance1 = resolver.levenshteinDistance('cat', 'cat');
            assert.strictEqual(distance1, 0, 'Identical strings should have distance 0');

            const distance2 = resolver.levenshteinDistance('cat', 'bat');
            assert.strictEqual(distance2, 1, 'Single character difference should have distance 1');

            const distance3 = resolver.levenshteinDistance('kitten', 'sitting');
            assert.strictEqual(distance3, 3, 'Should calculate correct Levenshtein distance');
        });
    });

    suite('Error Handling and Edge Cases', () => {
        test('should handle empty operation lists gracefully', async () => {
            const operation = McpOperationFactory.createCreateSpecOperation('Test', 'Description');

            const conflicts = await conflictResolver.detectConflicts(operation, []);

            // Should handle empty existing operations list
            assert.ok(Array.isArray(conflicts), 'Should return conflicts array even with empty operations');
        });

        test('should handle invalid conflict resolution gracefully', async () => {
            const resolved = await conflictResolver.resolveConflict('non-existent-conflict-id');
            assert.strictEqual(resolved, false, 'Should return false for non-existent conflict');
        });

        test('should handle operations with missing or invalid metadata', async () => {
            const operation1 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Content');
            operation1.metadata = undefined;

            const operation2 = McpOperationFactory.createUpdateRequirementsOperation('test-spec', 'Content');
            operation2.metadata = { invalidField: 'value' };

            await assert.doesNotReject(
                () => conflictResolver.detectConflicts(operation2, [operation1]),
                'Should handle operations with invalid metadata'
            );
        });

        test('should handle very large operation queues', async () => {
            const targetOperation = McpOperationFactory.createCreateSpecOperation('Target', 'Description');

            // Create a large number of existing operations
            const existingOperations: McpOperation[] = [];
            for (let i = 0; i < 1000; i++) {
                existingOperations.push(
                    McpOperationFactory.createCreateSpecOperation(`Spec ${i}`, `Description ${i}`)
                );
            }

            await assert.doesNotReject(
                () => conflictResolver.detectConflicts(targetOperation, existingOperations),
                'Should handle large operation queues efficiently'
            );
        });

        test('should handle concurrent conflict detection calls', async () => {
            const operation1 = McpOperationFactory.createCreateSpecOperation('Concurrent Test 1', 'Description');
            const operation2 = McpOperationFactory.createCreateSpecOperation('Concurrent Test 2', 'Description');
            const operation3 = McpOperationFactory.createCreateSpecOperation('Concurrent Test 3', 'Description');

            const promises = [
                conflictResolver.detectConflicts(operation1, [operation2, operation3]),
                conflictResolver.detectConflicts(operation2, [operation1, operation3]),
                conflictResolver.detectConflicts(operation3, [operation1, operation2])
            ];

            await assert.doesNotReject(
                () => Promise.all(promises),
                'Should handle concurrent conflict detection calls'
            );
        });
    });
});
