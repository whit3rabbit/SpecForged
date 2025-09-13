import * as vscode from 'vscode';
import { McpOperation, McpOperationType, McpOperationStatus, McpOperationPriority } from '../models/mcpOperation';

export enum ConflictType {
    CONCURRENT_MODIFICATION = 'concurrent_modification',
    DUPLICATE_OPERATION = 'duplicate_operation',
    RESOURCE_LOCKED = 'resource_locked',
    DEPENDENCY_CONFLICT = 'dependency_conflict',
    VERSION_MISMATCH = 'version_mismatch',
    OUTDATED_OPERATION = 'outdated_operation',
    PERMISSION_DENIED = 'permission_denied',
    RESOURCE_NOT_FOUND = 'resource_not_found',
    INVALID_STATE = 'invalid_state',
    CIRCULAR_DEPENDENCY = 'circular_dependency',
    PRIORITY_CONFLICT = 'priority_conflict'
}

export enum ConflictResolution {
    EXTENSION_WINS = 'extension_wins',
    MCP_WINS = 'mcp_wins',
    MERGE = 'merge',
    USER_DECIDE = 'user_decide',
    RETRY = 'retry',
    CANCEL = 'cancel',
    DEFER = 'defer',
    REORDER = 'reorder',
    SPLIT = 'split'
}

export interface Conflict {
    id: string;
    type: ConflictType;
    operations: McpOperation[];
    description: string;
    recommendations: ConflictResolution[];
    timestamp: string;
    resolved?: boolean;
    resolution?: ConflictResolution;
    resolvedBy?: 'system' | 'user';
    resolvedAt?: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    resourcePath: string;
    affectedFiles: string[];
    metadata: {
        [key: string]: any;
    };
    resolutionAttempts: number;
    lastAttemptAt?: string;
    autoResolvable: boolean;
    userNotified: boolean;
    similarConflicts: string[]; // IDs of similar past conflicts
}

export interface ConflictPattern {
    id: string;
    type: ConflictType;
    frequency: number;
    lastOccurrence: string;
    commonResolution: ConflictResolution;
    successRate: number;
    averageResolutionTime: number;
    preventionStrategy?: ConflictPreventionStrategy;
}

export interface ConflictPreventionStrategy {
    id: string;
    name: string;
    description: string;
    applicableTypes: ConflictType[];
    preventionActions: PreventionAction[];
    effectiveness: number; // 0-1 scale
    enabled: boolean;
}

export interface PreventionAction {
    type: 'reorder' | 'delay' | 'batch' | 'validate' | 'warn';
    description: string;
    parameters: { [key: string]: any };
}

export interface ConflictHistory {
    conflicts: Conflict[];
    patterns: ConflictPattern[];
    statistics: {
        totalConflicts: number;
        resolvedConflicts: number;
        autoResolvedConflicts: number;
        averageResolutionTime: number;
        mostCommonType: ConflictType;
        preventionSuccessRate: number;
    };
}

export interface ConflictResolutionStrategy {
    type: ConflictType;
    autoResolve: boolean;
    defaultResolution: ConflictResolution;
    requiresUserInput: boolean;
}

export class ConflictResolver {
    private conflicts: Map<string, Conflict> = new Map();
    private resolutionStrategies: Map<ConflictType, ConflictResolutionStrategy> = new Map();
    private conflictHistory: ConflictHistory;
    private preventionStrategies: Map<string, ConflictPreventionStrategy> = new Map();
    private patternRecognition: Map<string, ConflictPattern> = new Map();

    // Advanced detection algorithms
    private readonly SIMILARITY_THRESHOLD = 0.8;
    private readonly CONCURRENCY_WINDOW_MS = 60000; // 1 minute
    private readonly PATTERN_MIN_FREQUENCY = 3;

    // UI integration
    private statusBarItem: vscode.StatusBarItem | undefined;
    private outputChannel: vscode.OutputChannel;

    constructor() {
        this.initializeDefaultStrategies();
        this.initializePreventionStrategies();
        this.conflictHistory = this.loadConflictHistory();
        this.outputChannel = vscode.window.createOutputChannel('SpecForged Conflicts');
        this.setupStatusBar();
    }

    private initializeDefaultStrategies(): void {
        // Concurrent modifications - enhanced with pattern recognition
        this.resolutionStrategies.set(ConflictType.CONCURRENT_MODIFICATION, {
            type: ConflictType.CONCURRENT_MODIFICATION,
            autoResolve: false,
            defaultResolution: ConflictResolution.USER_DECIDE,
            requiresUserInput: true
        });

        // Duplicate operations - enhanced detection and auto-resolution
        this.resolutionStrategies.set(ConflictType.DUPLICATE_OPERATION, {
            type: ConflictType.DUPLICATE_OPERATION,
            autoResolve: true,
            defaultResolution: ConflictResolution.CANCEL,
            requiresUserInput: false
        });

        // Resource locked - new conflict type for file system locks
        this.resolutionStrategies.set(ConflictType.RESOURCE_LOCKED, {
            type: ConflictType.RESOURCE_LOCKED,
            autoResolve: true,
            defaultResolution: ConflictResolution.DEFER,
            requiresUserInput: false
        });

        // Dependency conflicts - new conflict type for operation dependencies
        this.resolutionStrategies.set(ConflictType.DEPENDENCY_CONFLICT, {
            type: ConflictType.DEPENDENCY_CONFLICT,
            autoResolve: true,
            defaultResolution: ConflictResolution.REORDER,
            requiresUserInput: false
        });

        // Version mismatch - new conflict type for specification versions
        this.resolutionStrategies.set(ConflictType.VERSION_MISMATCH, {
            type: ConflictType.VERSION_MISMATCH,
            autoResolve: false,
            defaultResolution: ConflictResolution.USER_DECIDE,
            requiresUserInput: true
        });

        // Circular dependency - new conflict type for dependency loops
        this.resolutionStrategies.set(ConflictType.CIRCULAR_DEPENDENCY, {
            type: ConflictType.CIRCULAR_DEPENDENCY,
            autoResolve: true,
            defaultResolution: ConflictResolution.REORDER,
            requiresUserInput: false
        });

        // Priority conflicts - new conflict type for operation priorities
        this.resolutionStrategies.set(ConflictType.PRIORITY_CONFLICT, {
            type: ConflictType.PRIORITY_CONFLICT,
            autoResolve: true,
            defaultResolution: ConflictResolution.REORDER,
            requiresUserInput: false
        });

        // Existing strategies with enhancements
        this.resolutionStrategies.set(ConflictType.OUTDATED_OPERATION, {
            type: ConflictType.OUTDATED_OPERATION,
            autoResolve: true,
            defaultResolution: ConflictResolution.CANCEL,
            requiresUserInput: false
        });

        this.resolutionStrategies.set(ConflictType.PERMISSION_DENIED, {
            type: ConflictType.PERMISSION_DENIED,
            autoResolve: true,
            defaultResolution: ConflictResolution.EXTENSION_WINS,
            requiresUserInput: false
        });

        this.resolutionStrategies.set(ConflictType.RESOURCE_NOT_FOUND, {
            type: ConflictType.RESOURCE_NOT_FOUND,
            autoResolve: false,
            defaultResolution: ConflictResolution.USER_DECIDE,
            requiresUserInput: true
        });

        this.resolutionStrategies.set(ConflictType.INVALID_STATE, {
            type: ConflictType.INVALID_STATE,
            autoResolve: true,
            defaultResolution: ConflictResolution.RETRY,
            requiresUserInput: false
        });
    }

    private initializePreventionStrategies(): void {
        // Batch similar operations to prevent conflicts
        this.preventionStrategies.set('batch-similar', {
            id: 'batch-similar',
            name: 'Batch Similar Operations',
            description: 'Group similar operations together to prevent conflicts',
            applicableTypes: [ConflictType.CONCURRENT_MODIFICATION, ConflictType.DUPLICATE_OPERATION],
            preventionActions: [
                {
                    type: 'batch',
                    description: 'Combine similar operations into a single batch',
                    parameters: { maxBatchSize: 10, batchTimeoutMs: 5000 }
                }
            ],
            effectiveness: 0.85,
            enabled: true
        });

        // Reorder operations based on dependencies
        this.preventionStrategies.set('dependency-ordering', {
            id: 'dependency-ordering',
            name: 'Dependency-Based Ordering',
            description: 'Reorder operations to respect dependencies',
            applicableTypes: [ConflictType.DEPENDENCY_CONFLICT, ConflictType.CIRCULAR_DEPENDENCY],
            preventionActions: [
                {
                    type: 'reorder',
                    description: 'Sort operations by dependency graph',
                    parameters: { algorithm: 'topological' }
                }
            ],
            effectiveness: 0.95,
            enabled: true
        });

        // Validate operations before queuing
        this.preventionStrategies.set('pre-validation', {
            id: 'pre-validation',
            name: 'Pre-Queue Validation',
            description: 'Validate operations before adding to queue',
            applicableTypes: [ConflictType.INVALID_STATE, ConflictType.RESOURCE_NOT_FOUND],
            preventionActions: [
                {
                    type: 'validate',
                    description: 'Check operation validity before queuing',
                    parameters: { strictMode: true }
                }
            ],
            effectiveness: 0.75,
            enabled: true
        });

        // Warn users about potential conflicts
        this.preventionStrategies.set('user-warnings', {
            id: 'user-warnings',
            name: 'User Conflict Warnings',
            description: 'Warn users about operations that might cause conflicts',
            applicableTypes: [ConflictType.CONCURRENT_MODIFICATION, ConflictType.VERSION_MISMATCH],
            preventionActions: [
                {
                    type: 'warn',
                    description: 'Show warning dialog for risky operations',
                    parameters: { severity: 'medium' }
                }
            ],
            effectiveness: 0.60,
            enabled: true
        });
    }

    private setupStatusBar(): void {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'specforged.showConflictDashboard';
        this.updateStatusBar();
        this.statusBarItem.show();
    }

    private updateStatusBar(): void {
        if (!this.statusBarItem) {return;}

        const activeConflicts = this.getActiveConflicts();
        const conflictCount = activeConflicts.length;

        if (conflictCount === 0) {
            this.statusBarItem.text = '$(check) No Conflicts';
            this.statusBarItem.backgroundColor = undefined;
            this.statusBarItem.tooltip = 'No active conflicts detected';
        } else {
            const criticalCount = activeConflicts.filter(c => c.severity === 'critical').length;
            const highCount = activeConflicts.filter(c => c.severity === 'high').length;

            if (criticalCount > 0) {
                this.statusBarItem.text = `$(error) ${conflictCount} Conflicts`;
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                this.statusBarItem.tooltip = `${criticalCount} critical, ${highCount} high priority conflicts`;
            } else if (highCount > 0) {
                this.statusBarItem.text = `$(warning) ${conflictCount} Conflicts`;
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                this.statusBarItem.tooltip = `${highCount} high priority conflicts`;
            } else {
                this.statusBarItem.text = `$(info) ${conflictCount} Conflicts`;
                this.statusBarItem.backgroundColor = undefined;
                this.statusBarItem.tooltip = `${conflictCount} low/medium priority conflicts`;
            }
        }
    }

    private loadConflictHistory(): ConflictHistory {
        // In a real implementation, this would load from persistent storage
        return {
            conflicts: [],
            patterns: [],
            statistics: {
                totalConflicts: 0,
                resolvedConflicts: 0,
                autoResolvedConflicts: 0,
                averageResolutionTime: 0,
                mostCommonType: ConflictType.DUPLICATE_OPERATION,
                preventionSuccessRate: 0
            }
        };
    }

    async detectConflicts(operation: McpOperation, existingOperations: McpOperation[]): Promise<Conflict[]> {
        const conflicts: Conflict[] = [];

        // Apply prevention strategies first
        const preventedConflicts = await this.applyPreventionStrategies(operation, existingOperations);
        if (preventedConflicts.length > 0) {
            this.outputChannel.appendLine(`Prevented ${preventedConflicts.length} potential conflicts for operation ${operation.id}`);
        }

        // Enhanced duplicate detection with similarity analysis
        const duplicateConflict = await this.detectDuplicateOperations(operation, existingOperations);
        if (duplicateConflict) {conflicts.push(duplicateConflict);}

        // Enhanced concurrent modification detection
        const concurrentConflict = await this.detectConcurrentModifications(operation, existingOperations);
        if (concurrentConflict) {conflicts.push(concurrentConflict);}

        // Dependency conflict detection
        const dependencyConflict = await this.detectDependencyConflicts(operation, existingOperations);
        if (dependencyConflict) {conflicts.push(dependencyConflict);}

        // Resource lock detection
        const resourceLockConflict = await this.detectResourceLocks(operation, existingOperations);
        if (resourceLockConflict) {conflicts.push(resourceLockConflict);}

        // Version mismatch detection
        const versionConflict = await this.detectVersionMismatches(operation, existingOperations);
        if (versionConflict) {conflicts.push(versionConflict);}

        // Priority conflict detection
        const priorityConflict = await this.detectPriorityConflicts(operation, existingOperations);
        if (priorityConflict) {conflicts.push(priorityConflict);}

        // Circular dependency detection
        const circularConflict = await this.detectCircularDependencies(operation, existingOperations);
        if (circularConflict) {conflicts.push(circularConflict);}

        // Outdated operation detection
        const outdatedConflict = await this.detectOutdatedOperations(operation);
        if (outdatedConflict) {conflicts.push(outdatedConflict);}

        // Pattern-based conflict prediction
        const predictedConflicts = await this.predictConflictsFromPatterns(operation, existingOperations);
        conflicts.push(...predictedConflicts);

        // Update conflict history and patterns
        for (const conflict of conflicts) {
            this.updateConflictHistory(conflict);
            this.updatePatternRecognition(conflict);
        }

        return conflicts;
    }

    // Legacy method for backward compatibility
    async detectConflict(operation: McpOperation, existingOperations: McpOperation[]): Promise<Conflict | null> {
        const conflicts = await this.detectConflicts(operation, existingOperations);
        return conflicts.length > 0 ? conflicts[0] : null;
    }

    private async detectDuplicateOperations(operation: McpOperation, existingOperations: McpOperation[]): Promise<Conflict | null> {
        const duplicates = existingOperations.filter(existing => {
            if (existing.id === operation.id ||
                existing.status === McpOperationStatus.COMPLETED ||
                existing.status === McpOperationStatus.CANCELLED) {
                return false;
            }

            // Exact match
            if (existing.type === operation.type &&
                this.calculateOperationSimilarity(operation, existing) >= this.SIMILARITY_THRESHOLD) {
                return true;
            }

            return false;
        });

        if (duplicates.length > 0) {
            return this.createConflict(
                ConflictType.DUPLICATE_OPERATION,
                [operation, ...duplicates],
                `Duplicate operation detected: ${operation.type} (${duplicates.length} similar operations found)`,
                'low'
            );
        }

        return null;
    }

    private async detectConcurrentModifications(operation: McpOperation, existingOperations: McpOperation[]): Promise<Conflict | null> {
        const resourceId = this.getResourceIdentifier(operation);
        const operationTime = new Date(operation.timestamp).getTime();

        const concurrent = existingOperations.filter(existing => {
            if (existing.id === operation.id) {return false;}

            const existingResourceId = this.getResourceIdentifier(existing);
            if (resourceId !== existingResourceId) {return false;}

            const existingTime = new Date(existing.timestamp).getTime();
            const timeDiff = Math.abs(operationTime - existingTime);

            return timeDiff <= this.CONCURRENCY_WINDOW_MS &&
                   existing.status !== McpOperationStatus.COMPLETED &&
                   existing.status !== McpOperationStatus.CANCELLED &&
                   this.isModificationOperation(existing);
        });

        if (concurrent.length > 0) {
            const severity = this.calculateConflictSeverity(operation, concurrent);
            return this.createConflict(
                ConflictType.CONCURRENT_MODIFICATION,
                [operation, ...concurrent],
                `Concurrent modifications detected for ${resourceId}`,
                severity
            );
        }

        return null;
    }

    private async detectDependencyConflicts(operation: McpOperation, existingOperations: McpOperation[]): Promise<Conflict | null> {
        if (!operation.dependencies || operation.dependencies.length === 0) {
            return null;
        }

        const conflictingOps = existingOperations.filter(existing => {
            // Check if this operation depends on something that conflicts with existing operations
            return operation.dependencies!.some(depId => {
                const dependentOp = existingOperations.find(op => op.id === depId);
                if (!dependentOp) {return false;}

                // Check if the dependent operation conflicts with the existing operation
                return this.getResourceIdentifier(dependentOp) === this.getResourceIdentifier(existing) &&
                       existing.status === McpOperationStatus.IN_PROGRESS;
            });
        });

        if (conflictingOps.length > 0) {
            return this.createConflict(
                ConflictType.DEPENDENCY_CONFLICT,
                [operation, ...conflictingOps],
                `Dependency conflict: operation depends on resources being modified`,
                'medium'
            );
        }

        return null;
    }

    private async detectResourceLocks(operation: McpOperation, existingOperations: McpOperation[]): Promise<Conflict | null> {
        const resourceId = this.getResourceIdentifier(operation);

        const lockingOps = existingOperations.filter(existing => {
            return existing.status === McpOperationStatus.IN_PROGRESS &&
                   this.getResourceIdentifier(existing) === resourceId &&
                   this.isExclusiveOperation(existing);
        });

        if (lockingOps.length > 0) {
            return this.createConflict(
                ConflictType.RESOURCE_LOCKED,
                [operation, ...lockingOps],
                `Resource ${resourceId} is locked by another operation`,
                'high'
            );
        }

        return null;
    }

    private async detectVersionMismatches(operation: McpOperation, existingOperations: McpOperation[]): Promise<Conflict | null> {
        // Check if operation specifies a version that conflicts with pending operations
        const operationVersion = this.extractVersionFromOperation(operation);
        if (!operationVersion) {return null;}

        const versionConflicts = existingOperations.filter(existing => {
            const existingVersion = this.extractVersionFromOperation(existing);
            return existingVersion &&
                   existingVersion !== operationVersion &&
                   this.getResourceIdentifier(existing) === this.getResourceIdentifier(operation);
        });

        if (versionConflicts.length > 0) {
            return this.createConflict(
                ConflictType.VERSION_MISMATCH,
                [operation, ...versionConflicts],
                `Version mismatch: operation targets version ${operationVersion}`,
                'high'
            );
        }

        return null;
    }

    private async detectPriorityConflicts(operation: McpOperation, existingOperations: McpOperation[]): Promise<Conflict | null> {
        if (operation.priority !== McpOperationPriority.URGENT) {
            return null;
        }

        const blockingOps = existingOperations.filter(existing => {
            return existing.status === McpOperationStatus.IN_PROGRESS &&
                   existing.priority < operation.priority &&
                   this.getResourceIdentifier(existing) === this.getResourceIdentifier(operation);
        });

        if (blockingOps.length > 0) {
            return this.createConflict(
                ConflictType.PRIORITY_CONFLICT,
                [operation, ...blockingOps],
                `High priority operation blocked by lower priority operations`,
                'medium'
            );
        }

        return null;
    }

    private async detectCircularDependencies(operation: McpOperation, existingOperations: McpOperation[]): Promise<Conflict | null> {
        if (!operation.dependencies || operation.dependencies.length === 0) {
            return null;
        }

        const visited = new Set<string>();
        const recursionStack = new Set<string>();

        const hasCircularDependency = (opId: string): boolean => {
            if (recursionStack.has(opId)) {
                return true; // Circular dependency found
            }

            if (visited.has(opId)) {
                return false; // Already processed
            }

            visited.add(opId);
            recursionStack.add(opId);

            const op = existingOperations.find(o => o.id === opId) || (opId === operation.id ? operation : null);
            if (op && op.dependencies) {
                for (const depId of op.dependencies) {
                    if (hasCircularDependency(depId)) {
                        return true;
                    }
                }
            }

            recursionStack.delete(opId);
            return false;
        };

        if (hasCircularDependency(operation.id)) {
            const involvedOps = Array.from(recursionStack)
                .map(id => existingOperations.find(op => op.id === id) || operation)
                .filter(op => op !== null) as McpOperation[];

            return this.createConflict(
                ConflictType.CIRCULAR_DEPENDENCY,
                involvedOps,
                `Circular dependency detected in operation chain`,
                'critical'
            );
        }

        return null;
    }

    private async detectOutdatedOperations(operation: McpOperation): Promise<Conflict | null> {
        const operationAge = Date.now() - new Date(operation.timestamp).getTime();
        const maxAge = 5 * 60 * 1000; // 5 minutes

        if (operationAge > maxAge && operation.status === McpOperationStatus.PENDING) {
            return this.createConflict(
                ConflictType.OUTDATED_OPERATION,
                [operation],
                `Operation is outdated (${Math.round(operationAge / 60000)} minutes old)`,
                'low'
            );
        }

        return null;
    }

    private async predictConflictsFromPatterns(operation: McpOperation, existingOperations: McpOperation[]): Promise<Conflict[]> {
        const predictions: Conflict[] = [];

        // Use historical patterns to predict potential conflicts
        for (const [patternId, pattern] of this.patternRecognition) {
            if (pattern.frequency >= this.PATTERN_MIN_FREQUENCY &&
                this.operationMatchesPattern(operation, pattern)) {

                // Create a predicted conflict based on the pattern
                const predictedConflict = this.createPredictedConflict(operation, pattern, existingOperations);
                if (predictedConflict) {
                    predictions.push(predictedConflict);
                }
            }
        }

        return predictions;
    }

    async resolveConflict(conflictId: string, resolution?: ConflictResolution): Promise<boolean> {
        const conflict = this.conflicts.get(conflictId);
        if (!conflict || conflict.resolved) {
            return false;
        }

        // Increment resolution attempts
        conflict.resolutionAttempts++;
        conflict.lastAttemptAt = new Date().toISOString();

        const strategy = this.resolutionStrategies.get(conflict.type);
        const finalResolution = resolution || strategy?.defaultResolution || ConflictResolution.USER_DECIDE;

        // If user input is required and no resolution provided, show enhanced dialog
        if (!resolution && strategy?.requiresUserInput) {
            const userResolution = await this.showEnhancedConflictDialog(conflict);
            if (!userResolution) {
                return false; // User cancelled
            }
            return this.resolveConflict(conflictId, userResolution);
        }

        try {
            const startTime = Date.now();
            const success = await this.applyResolution(conflict, finalResolution);
            const resolutionTime = Date.now() - startTime;

            if (success) {
                conflict.resolved = true;
                conflict.resolution = finalResolution;
                conflict.resolvedBy = resolution ? 'user' : 'system';
                conflict.resolvedAt = new Date().toISOString();

                // Update statistics
                this.conflictHistory.statistics.resolvedConflicts++;
                if (!resolution) {
                    this.conflictHistory.statistics.autoResolvedConflicts++;
                }

                // Update pattern success rate
                this.updatePatternSuccessRate(conflict, true, resolutionTime);

                // Log resolution
                this.outputChannel.appendLine(
                    `✅ Resolved conflict ${conflictId} (${conflict.type}) with ${finalResolution} in ${resolutionTime}ms`
                );

                // Update status bar
                this.updateStatusBar();

                // Notify user if conflict was critical
                if (conflict.severity === 'critical' || conflict.severity === 'high') {
                    vscode.window.showInformationMessage(
                        `Critical conflict resolved: ${conflict.description}`,
                        'View Details'
                    ).then(selection => {
                        if (selection === 'View Details') {
                            this.showConflictDetails(conflict);
                        }
                    });
                }
            } else {
                this.updatePatternSuccessRate(conflict, false, resolutionTime);
                this.outputChannel.appendLine(
                    `❌ Failed to resolve conflict ${conflictId} (${conflict.type}) with ${finalResolution}`
                );
            }

            return success;
        } catch (error) {
            this.outputChannel.appendLine(`❌ Error resolving conflict ${conflictId}: ${error}`);
            console.error(`Failed to resolve conflict ${conflictId}:`, error);
            return false;
        }
    }

    async resolveMultipleConflicts(conflictIds: string[], resolution?: ConflictResolution): Promise<{ resolved: string[], failed: string[] }> {
        const resolved: string[] = [];
        const failed: string[] = [];

        for (const conflictId of conflictIds) {
            const success = await this.resolveConflict(conflictId, resolution);
            if (success) {
                resolved.push(conflictId);
            } else {
                failed.push(conflictId);
            }
        }

        return { resolved, failed };
    }

    async autoResolveAllConflicts(): Promise<{ resolved: number, failed: number }> {
        const activeConflicts = this.getActiveConflicts();
        const autoResolvableConflicts = activeConflicts.filter(c => c.autoResolvable);

        let resolved = 0;
        let failed = 0;

        for (const conflict of autoResolvableConflicts) {
            const success = await this.resolveConflict(conflict.id);
            if (success) {
                resolved++;
            } else {
                failed++;
            }
        }

        if (resolved > 0) {
            vscode.window.showInformationMessage(
                `Auto-resolved ${resolved} conflicts${failed > 0 ? `, ${failed} failed` : ''}`
            );
        }

        return { resolved, failed };
    }

    private async applyResolution(conflict: Conflict, resolution: ConflictResolution): Promise<boolean> {
        switch (resolution) {
            case ConflictResolution.EXTENSION_WINS:
                return this.applyExtensionWins(conflict);

            case ConflictResolution.MCP_WINS:
                return this.applyMcpWins(conflict);

            case ConflictResolution.MERGE:
                return this.applyMerge(conflict);

            case ConflictResolution.RETRY:
                return this.applyRetry(conflict);

            case ConflictResolution.CANCEL:
                return this.applyCancel(conflict);

            case ConflictResolution.DEFER:
                return this.applyDefer(conflict);

            case ConflictResolution.REORDER:
                return this.applyReorder(conflict);

            case ConflictResolution.SPLIT:
                return this.applySplit(conflict);

            case ConflictResolution.USER_DECIDE:
                return this.applyUserDecision(conflict);

            default:
                return false;
        }
    }

    private async applyDefer(conflict: Conflict): Promise<boolean> {
        // Defer operations by adding delays or changing priorities
        for (const operation of conflict.operations) {
            if (operation.status === McpOperationStatus.PENDING) {
                // Lower priority and add delay
                operation.priority = Math.max(0, operation.priority - 1) as McpOperationPriority;
                operation.metadata = operation.metadata || {};
                operation.metadata.deferredUntil = new Date(Date.now() + 30000).toISOString(); // 30 second delay
            }
        }
        return true;
    }

    private async applyReorder(conflict: Conflict): Promise<boolean> {
        // Reorder operations based on dependencies and priorities
        const operations = conflict.operations.filter(op =>
            op.status === McpOperationStatus.PENDING
        );

        // Sort by priority and dependencies
        operations.sort((a, b) => {
            // Higher priority first
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }

            // Operations with fewer dependencies first
            const aDeps = a.dependencies?.length || 0;
            const bDeps = b.dependencies?.length || 0;
            return aDeps - bDeps;
        });

        // Update timestamps to reflect new order
        const baseTime = Date.now();
        operations.forEach((op, index) => {
            op.timestamp = new Date(baseTime + (index * 1000)).toISOString();
        });

        return true;
    }

    private async applySplit(conflict: Conflict): Promise<boolean> {
        // Split complex operations into smaller, non-conflicting parts
        for (const operation of conflict.operations) {
            if (this.canSplitOperation(operation)) {
                const splitOps = await this.splitOperation(operation);
                if (splitOps.length > 1) {
                    // Mark original as cancelled and add split operations
                    operation.status = McpOperationStatus.CANCELLED;
                    operation.error = 'Split into smaller operations to resolve conflict';

                    // The split operations would need to be added to the queue
                    // This would require integration with the queue management system
                }
            }
        }
        return true;
    }

    private async applyUserDecision(conflict: Conflict): Promise<boolean> {
        // This should have been handled earlier in the resolution process
        // If we reach here, it means no user decision was provided
        return false;
    }

    private canSplitOperation(operation: McpOperation): boolean {
        // Determine if an operation can be split into smaller parts
        switch (operation.type) {
            case McpOperationType.UPDATE_REQUIREMENTS:
            case McpOperationType.UPDATE_DESIGN:
            case McpOperationType.UPDATE_TASKS:
                // These can potentially be split by content sections
                return true;
            default:
                return false;
        }
    }

    private async splitOperation(operation: McpOperation): Promise<McpOperation[]> {
        // Split an operation into smaller, non-conflicting operations
        const splitOps: McpOperation[] = [];

        if (operation.type === McpOperationType.UPDATE_REQUIREMENTS ||
            operation.type === McpOperationType.UPDATE_DESIGN ||
            operation.type === McpOperationType.UPDATE_TASKS) {

            const content = (operation.params as any).content || '';
            const sections = this.splitContentIntoSections(content);

            sections.forEach((section, index) => {
                const splitOp = {
                    ...operation,
                    id: `${operation.id}-split-${index}`,
                    params: {
                        ...(operation.params as any),
                        content: section,
                        sectionIndex: index
                    },
                    metadata: {
                        ...operation.metadata,
                        originalOperationId: operation.id,
                        splitIndex: index,
                        totalSplits: sections.length
                    }
                };
                splitOps.push(splitOp);
            });
        }

        return splitOps.length > 1 ? splitOps : [operation];
    }

    private splitContentIntoSections(content: string): string[] {
        // Split content by markdown headers or other logical boundaries
        const sections = content.split(/\n(?=#{1,6}\s)/);
        return sections.filter(section => section.trim().length > 0);
    }

    private async applyExtensionWins(conflict: Conflict): Promise<boolean> {
        // Extension takes precedence, cancel conflicting operations
        for (const operation of conflict.operations) {
            if (operation.source === 'mcp') {
                operation.status = McpOperationStatus.CANCELLED;
                operation.error = 'Cancelled due to conflict resolution (extension wins)';
            }
        }
        return true;
    }

    private async applyMcpWins(conflict: Conflict): Promise<boolean> {
        // MCP takes precedence, cancel extension operations
        for (const operation of conflict.operations) {
            if (operation.source === 'extension') {
                operation.status = McpOperationStatus.CANCELLED;
                operation.error = 'Cancelled due to conflict resolution (MCP wins)';
            }
        }
        return true;
    }

    private async applyMerge(conflict: Conflict): Promise<boolean> {
        // Attempt to merge operations - this is complex and depends on operation type
        switch (conflict.type) {
            case ConflictType.CONCURRENT_MODIFICATION:
                return this.attemptMerge(conflict);
            default:
                // Fallback to extension wins for unsupported merge types
                return this.applyExtensionWins(conflict);
        }
    }

    private async applyRetry(conflict: Conflict): Promise<boolean> {
        // Reset operations to pending status for retry
        for (const operation of conflict.operations) {
            if (operation.status === McpOperationStatus.FAILED) {
                operation.status = McpOperationStatus.PENDING;
                operation.retryCount++;
                operation.error = undefined;
            }
        }
        return true;
    }

    private async applyCancel(conflict: Conflict): Promise<boolean> {
        // Cancel all operations in conflict
        for (const operation of conflict.operations) {
            if (operation.status === McpOperationStatus.PENDING ||
                operation.status === McpOperationStatus.IN_PROGRESS) {
                operation.status = McpOperationStatus.CANCELLED;
                operation.error = 'Cancelled due to conflict resolution';
            }
        }
        return true;
    }

    private async attemptMerge(conflict: Conflict): Promise<boolean> {
        // This is a simplified merge implementation
        // In practice, this would need to be much more sophisticated

        const operations = conflict.operations;
        if (operations.length !== 2) {
            return false; // Can only merge two operations currently
        }

        const [op1, op2] = operations;

        // Only merge if they're the same type and resource
        if (op1.type !== op2.type ||
            this.getResourceIdentifier(op1) !== this.getResourceIdentifier(op2)) {
            return false;
        }

        // For text content operations, attempt a simple merge
        if (op1.type === McpOperationType.UPDATE_REQUIREMENTS ||
            op1.type === McpOperationType.UPDATE_DESIGN ||
            op1.type === McpOperationType.UPDATE_TASKS) {

            return this.mergeTextContent(op1 as any, op2 as any);
        }

        return false;
    }

    private async mergeTextContent(op1: any, op2: any): Promise<boolean> {
        // This is a very basic merge - in practice you'd want something more sophisticated
        const content1 = op1.params.content || '';
        const content2 = op2.params.content || '';

        // If contents are the same, no conflict
        if (content1 === content2) {
            op2.status = McpOperationStatus.CANCELLED;
            op2.error = 'Duplicate content, merged with first operation';
            return true;
        }

        // Simple line-based merge
        const lines1 = content1.split('\n');
        const lines2 = content2.split('\n');
        const mergedLines = [...new Set([...lines1, ...lines2])]; // Remove duplicates

        // Update the first operation with merged content
        op1.params.content = mergedLines.join('\n');
        op2.status = McpOperationStatus.CANCELLED;
        op2.error = 'Merged with first operation';

        return true;
    }

    private async showEnhancedConflictDialog(conflict: Conflict): Promise<ConflictResolution | undefined> {
        // Show detailed conflict information first
        const showDetails = await vscode.window.showWarningMessage(
            `Conflict Detected: ${conflict.description}`,
            {
                modal: true,
                detail: this.getConflictDetails(conflict)
            },
            'Resolve Now',
            'View Details',
            'Auto-Resolve',
            'Ignore'
        );

        if (showDetails === 'View Details') {
            await this.showConflictDetails(conflict);
            return this.showEnhancedConflictDialog(conflict); // Show dialog again after details
        }

        if (showDetails === 'Auto-Resolve') {
            const strategy = this.resolutionStrategies.get(conflict.type);
            return strategy?.defaultResolution || ConflictResolution.CANCEL;
        }

        if (showDetails === 'Ignore') {
            return undefined;
        }

        if (showDetails !== 'Resolve Now') {
            return undefined;
        }

        // Show resolution options with enhanced information
        const options: (vscode.QuickPickItem & { resolution: ConflictResolution })[] =
            conflict.recommendations.map(resolution => ({
                label: this.getResolutionLabel(resolution),
                description: this.getResolutionDescription(resolution, conflict),
                detail: this.getEnhancedResolutionDetail(resolution, conflict),
                resolution
            }));

        // Add pattern-based recommendations
        const patternRecommendations = this.getPatternBasedRecommendations(conflict);
        if (patternRecommendations.length > 0) {
            options.unshift({
                label: '$(star) Recommended',
                description: `Based on ${patternRecommendations.length} similar conflicts`,
                detail: `Success rate: ${Math.round(patternRecommendations[0].successRate * 100)}%`,
                resolution: patternRecommendations[0].resolution
            });
        }

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: `Resolve ${conflict.severity} priority conflict: ${conflict.description}`,
            canPickMany: false,
            matchOnDescription: true,
            matchOnDetail: true,
            ignoreFocusOut: true
        });

        return selected?.resolution;
    }

    private async showConflictDetails(conflict: Conflict): Promise<void> {
        const panel = vscode.window.createWebviewPanel(
            'conflictDetails',
            `Conflict Details: ${conflict.id}`,
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        panel.webview.html = this.generateConflictDetailsHtml(conflict);

        // Handle messages from the webview
        panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'resolve':
                    await this.resolveConflict(conflict.id, message.resolution);
                    panel.dispose();
                    break;
                case 'viewOperation':
                    await this.showOperationDetails(message.operationId);
                    break;
            }
        });
    }

    private generateConflictDetailsHtml(conflict: Conflict): string {
        const operations = conflict.operations.map(op => `
            <div class="operation">
                <h4>${op.type} (${op.id})</h4>
                <p><strong>Status:</strong> ${op.status}</p>
                <p><strong>Priority:</strong> ${op.priority}</p>
                <p><strong>Timestamp:</strong> ${new Date(op.timestamp).toLocaleString()}</p>
                <p><strong>Source:</strong> ${op.source}</p>
                <details>
                    <summary>Parameters</summary>
                    <pre>${JSON.stringify(op.params, null, 2)}</pre>
                </details>
            </div>
        `).join('');

        const resolutionButtons = conflict.recommendations.map(resolution => `
            <button onclick="resolveConflict('${resolution}')" class="resolution-btn ${resolution}">
                ${this.getResolutionLabel(resolution)}
            </button>
        `).join('');

        return `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Conflict Details</title>
                <style>
                    body { font-family: var(--vscode-font-family); padding: 20px; }
                    .conflict-header { border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 10px; }
                    .severity-${conflict.severity} { color: var(--vscode-errorForeground); }
                    .operation { border: 1px solid var(--vscode-panel-border); margin: 10px 0; padding: 10px; }
                    .resolution-btn { margin: 5px; padding: 8px 16px; cursor: pointer; }
                    pre { background: var(--vscode-textCodeBlock-background); padding: 10px; }
                </style>
            </head>
            <body>
                <div class="conflict-header">
                    <h2 class="severity-${conflict.severity}">
                        ${conflict.type.toUpperCase()} Conflict
                    </h2>
                    <p><strong>Description:</strong> ${conflict.description}</p>
                    <p><strong>Severity:</strong> ${conflict.severity}</p>
                    <p><strong>Resource:</strong> ${conflict.resourcePath}</p>
                    <p><strong>Detected:</strong> ${new Date(conflict.timestamp).toLocaleString()}</p>
                </div>

                <h3>Affected Operations (${conflict.operations.length})</h3>
                ${operations}

                <h3>Resolution Options</h3>
                <div class="resolution-buttons">
                    ${resolutionButtons}
                </div>

                <script>
                    const vscode = acquireVsCodeApi();

                    function resolveConflict(resolution) {
                        vscode.postMessage({
                            command: 'resolve',
                            resolution: resolution
                        });
                    }

                    function viewOperation(operationId) {
                        vscode.postMessage({
                            command: 'viewOperation',
                            operationId: operationId
                        });
                    }
                </script>
            </body>
            </html>
        `;
    }

    private async showOperationDetails(operationId: string): Promise<void> {
        // Find and display operation details
        const operation = this.findOperationById(operationId);
        if (operation) {
            const message = `
Operation: ${operation.type}
ID: ${operation.id}
Status: ${operation.status}
Priority: ${operation.priority}
Timestamp: ${new Date(operation.timestamp).toLocaleString()}
Parameters: ${JSON.stringify(operation.params, null, 2)}
            `;
            vscode.window.showInformationMessage(message, { modal: true });
        }
    }

    private findOperationById(operationId: string): McpOperation | undefined {
        // This would need to integrate with the operation queue to find operations
        // For now, return undefined as a placeholder
        return undefined;
    }

    private getConflictDetails(conflict: Conflict): string {
        return `
Severity: ${conflict.severity.toUpperCase()}
Type: ${conflict.type}
Resource: ${conflict.resourcePath}
Operations: ${conflict.operations.length}
Detected: ${new Date(conflict.timestamp).toLocaleString()}

${conflict.operations.map(op => `• ${op.type} (${op.status})`).join('\n')}
        `;
    }

    private getEnhancedResolutionDetail(resolution: ConflictResolution, conflict: Conflict): string {
        const baseDetail = this.getResolutionDetail(resolution);

        // Add pattern-based success rate if available
        const pattern = this.findPatternForConflict(conflict);
        if (pattern && pattern.commonResolution === resolution) {
            return `${baseDetail} • Success rate: ${Math.round(pattern.successRate * 100)}%`;
        }

        return baseDetail;
    }

    private getPatternBasedRecommendations(conflict: Conflict): Array<{ resolution: ConflictResolution, successRate: number }> {
        const pattern = this.findPatternForConflict(conflict);
        if (pattern && pattern.frequency >= this.PATTERN_MIN_FREQUENCY) {
            return [{
                resolution: pattern.commonResolution,
                successRate: pattern.successRate
            }];
        }
        return [];
    }

    private findPatternForConflict(conflict: Conflict): ConflictPattern | undefined {
        const patternKey = `${conflict.type}-${conflict.resourcePath}`;
        return this.patternRecognition.get(patternKey);
    }

    private updatePatternSuccessRate(conflict: Conflict, success: boolean, resolutionTime: number): void {
        const pattern = this.findPatternForConflict(conflict);
        if (pattern && conflict.resolution) {
            // Update success rate using exponential moving average
            const alpha = 0.1; // Learning rate
            pattern.successRate = success
                ? pattern.successRate + alpha * (1 - pattern.successRate)
                : pattern.successRate * (1 - alpha);

            // Update average resolution time
            pattern.averageResolutionTime = pattern.averageResolutionTime * 0.9 + resolutionTime * 0.1;

            // Update common resolution if this was successful
            if (success) {
                pattern.commonResolution = conflict.resolution;
            }
        }
    }

    private getResolutionLabel(resolution: ConflictResolution): string {
        switch (resolution) {
            case ConflictResolution.EXTENSION_WINS: return '$(check) Extension Wins';
            case ConflictResolution.MCP_WINS: return '$(server-process) MCP Server Wins';
            case ConflictResolution.MERGE: return '$(git-merge) Merge Changes';
            case ConflictResolution.RETRY: return '$(sync) Retry Operation';
            case ConflictResolution.CANCEL: return '$(x) Cancel Operation';
            case ConflictResolution.DEFER: return '$(clock) Defer Operation';
            case ConflictResolution.REORDER: return '$(list-ordered) Reorder Operations';
            case ConflictResolution.SPLIT: return '$(split-horizontal) Split Operation';
            case ConflictResolution.USER_DECIDE: return '$(person) Manual Resolution';
            default: return resolution;
        }
    }

    private getResolutionDescription(resolution: ConflictResolution, conflict: Conflict): string {
        switch (resolution) {
            case ConflictResolution.EXTENSION_WINS: return 'VS Code extension takes precedence';
            case ConflictResolution.MCP_WINS: return 'MCP server operation takes precedence';
            case ConflictResolution.MERGE: return 'Attempt to combine changes automatically';
            case ConflictResolution.RETRY: return 'Try the operation again later';
            case ConflictResolution.CANCEL: return 'Cancel conflicting operations';
            case ConflictResolution.DEFER: return 'Delay operations to avoid conflict';
            case ConflictResolution.REORDER: return 'Change operation order based on dependencies';
            case ConflictResolution.SPLIT: return 'Break operation into smaller parts';
            default: return '';
        }
    }

    private getResolutionDetail(resolution: ConflictResolution): string {
        switch (resolution) {
            case ConflictResolution.EXTENSION_WINS: return 'Recommended when VS Code has the latest changes';
            case ConflictResolution.MCP_WINS: return 'Recommended when MCP server has the latest changes';
            case ConflictResolution.MERGE: return 'Works best for compatible changes';
            case ConflictResolution.RETRY: return 'Good for temporary conflicts';
            case ConflictResolution.CANCEL: return 'Use when operations are no longer needed';
            case ConflictResolution.DEFER: return 'Delays operations by 30 seconds';
            case ConflictResolution.REORDER: return 'Sorts by priority and dependencies';
            case ConflictResolution.SPLIT: return 'Breaks large operations into smaller ones';
            default: return '';
        }
    }

    private calculateOperationSimilarity(op1: McpOperation, op2: McpOperation): number {
        if (op1.type !== op2.type) {return 0;}

        // Calculate parameter similarity
        const params1 = JSON.stringify(op1.params);
        const params2 = JSON.stringify(op2.params);

        if (params1 === params2) {return 1.0;}

        // Use Levenshtein distance for string similarity
        const similarity = this.calculateStringSimilarity(params1, params2);
        return similarity;
    }

    private calculateStringSimilarity(str1: string, str2: string): number {
        const longer = str1.length > str2.length ? str1 : str2;
        const shorter = str1.length > str2.length ? str2 : str1;

        if (longer.length === 0) {return 1.0;}

        const distance = this.levenshteinDistance(longer, shorter);
        return (longer.length - distance) / longer.length;
    }

    private levenshteinDistance(str1: string, str2: string): number {
        const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

        for (let i = 0; i <= str1.length; i++) {matrix[0][i] = i;}
        for (let j = 0; j <= str2.length; j++) {matrix[j][0] = j;}

        for (let j = 1; j <= str2.length; j++) {
            for (let i = 1; i <= str1.length; i++) {
                const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j][i - 1] + 1,     // deletion
                    matrix[j - 1][i] + 1,     // insertion
                    matrix[j - 1][i - 1] + indicator // substitution
                );
            }
        }

        return matrix[str2.length][str1.length];
    }

    private isModificationOperation(operation: McpOperation): boolean {
        return [
            McpOperationType.UPDATE_REQUIREMENTS,
            McpOperationType.UPDATE_DESIGN,
            McpOperationType.UPDATE_TASKS,
            McpOperationType.ADD_USER_STORY,
            McpOperationType.UPDATE_TASK_STATUS,
            McpOperationType.DELETE_SPEC
        ].includes(operation.type);
    }

    private isExclusiveOperation(operation: McpOperation): boolean {
        // Operations that require exclusive access to a resource
        return [
            McpOperationType.DELETE_SPEC,
            McpOperationType.CREATE_SPEC
        ].includes(operation.type);
    }

    private calculateConflictSeverity(operation: McpOperation, conflictingOps: McpOperation[]): 'low' | 'medium' | 'high' | 'critical' {
        // Base severity on operation type and priority
        let severity: 'low' | 'medium' | 'high' | 'critical' = 'low';

        if (operation.priority === McpOperationPriority.URGENT) {
            severity = 'high';
        } else if (operation.priority === McpOperationPriority.HIGH) {
            severity = 'medium';
        }

        // Increase severity based on conflicting operations
        const hasHighPriorityConflicts = conflictingOps.some(op =>
            op.priority >= McpOperationPriority.HIGH
        );

        if (hasHighPriorityConflicts) {
            severity = severity === 'high' ? 'critical' : 'high';
        }

        // Critical operations always create high severity conflicts
        if (this.isExclusiveOperation(operation) ||
            conflictingOps.some(op => this.isExclusiveOperation(op))) {
            severity = 'critical';
        }

        return severity;
    }

    private extractVersionFromOperation(operation: McpOperation): string | null {
        // Extract version information from operation metadata or parameters
        if (operation.metadata?.version) {
            return operation.metadata.version;
        }

        // Check for version in parameters (spec-specific)
        const params = operation.params as any;
        if (params.version) {
            return params.version;
        }

        return null;
    }

    private operationMatchesPattern(operation: McpOperation, pattern: ConflictPattern): boolean {
        // Check if the operation type is likely to cause the pattern's conflict type
        const operationConflictTypes = this.getOperationConflictTypes(operation);

        if (!operationConflictTypes.includes(pattern.type)) {
            return false;
        }

        // Additional pattern matching logic could be added here
        // For now, just match on potential conflict types
        return true;
    }

    private getOperationConflictTypes(operation: McpOperation): ConflictType[] {
        // Map operation types to potential conflict types they might cause
        const conflictTypes: ConflictType[] = [];

        switch (operation.type) {
            case McpOperationType.UPDATE_REQUIREMENTS:
            case McpOperationType.UPDATE_DESIGN:
            case McpOperationType.UPDATE_TASKS:
                conflictTypes.push(
                    ConflictType.CONCURRENT_MODIFICATION,
                    ConflictType.VERSION_MISMATCH,
                    ConflictType.RESOURCE_LOCKED
                );
                break;

            case McpOperationType.CREATE_SPEC:
                conflictTypes.push(
                    ConflictType.DUPLICATE_OPERATION,
                    ConflictType.RESOURCE_LOCKED
                );
                break;

            case McpOperationType.DELETE_SPEC:
                conflictTypes.push(
                    ConflictType.DEPENDENCY_CONFLICT,
                    ConflictType.RESOURCE_LOCKED
                );
                break;

            default:
                conflictTypes.push(ConflictType.DUPLICATE_OPERATION);
        }

        return conflictTypes;
    }

    private createPredictedConflict(operation: McpOperation, pattern: ConflictPattern, existingOperations: McpOperation[]): Conflict | null {
        // Create a predicted conflict based on historical patterns
        const potentialConflicts = existingOperations.filter(existing =>
            this.getResourceIdentifier(existing) === this.getResourceIdentifier(operation)
        );

        if (potentialConflicts.length === 0) {return null;}

        return this.createConflict(
            pattern.type,
            [operation, ...potentialConflicts],
            `Predicted conflict based on historical pattern (${pattern.frequency} occurrences)`,
            'low',
            true // Mark as predicted
        );
    }

    private async applyPreventionStrategies(operation: McpOperation, existingOperations: McpOperation[]): Promise<string[]> {
        const preventedConflicts: string[] = [];

        for (const [strategyId, strategy] of this.preventionStrategies) {
            if (!strategy.enabled) {continue;}

            for (const action of strategy.preventionActions) {
                const prevented = await this.executePreventionAction(action, operation, existingOperations);
                if (prevented) {
                    preventedConflicts.push(`${strategyId}:${action.type}`);
                }
            }
        }

        return preventedConflicts;
    }

    private async executePreventionAction(action: PreventionAction, operation: McpOperation, existingOperations: McpOperation[]): Promise<boolean> {
        switch (action.type) {
            case 'batch':
                return this.tryBatchOperation(operation, existingOperations, action.parameters);

            case 'reorder':
                return this.tryReorderOperation(operation, existingOperations, action.parameters);

            case 'validate':
                return this.validateOperationPreQueue(operation, action.parameters);

            case 'warn':
                return this.warnUserAboutPotentialConflict(operation, action.parameters);

            case 'delay':
                return this.delayOperation(operation, action.parameters);

            default:
                return false;
        }
    }

    private tryBatchOperation(operation: McpOperation, existingOperations: McpOperation[], parameters: any): boolean {
        // Implementation for batching similar operations
        // This would modify the operation queue to batch similar operations
        return false; // Placeholder
    }

    private tryReorderOperation(operation: McpOperation, existingOperations: McpOperation[], parameters: any): boolean {
        // Implementation for reordering operations based on dependencies
        // This would modify the operation priority or dependencies
        return false; // Placeholder
    }

    private validateOperationPreQueue(operation: McpOperation, parameters: any): boolean {
        // Enhanced validation before queuing
        const resourceExists = this.checkResourceExists(operation);
        const hasValidDependencies = this.validateDependencies(operation);

        return resourceExists && hasValidDependencies;
    }

    private async warnUserAboutPotentialConflict(operation: McpOperation, parameters: any): Promise<boolean> {
        if (parameters.severity === 'high' || parameters.severity === 'critical') {
            const result = await vscode.window.showWarningMessage(
                `Operation "${operation.type}" may cause conflicts. Continue?`,
                'Continue',
                'Cancel'
            );
            return result !== 'Continue';
        }
        return false;
    }

    private delayOperation(operation: McpOperation, parameters: any): boolean {
        // Add delay to operation processing
        const delayMs = parameters.delayMs || 1000;
        operation.metadata = operation.metadata || {};
        operation.metadata.delayUntil = new Date(Date.now() + delayMs).toISOString();
        return true;
    }

    private checkResourceExists(operation: McpOperation): boolean {
        // Check if the target resource exists
        // This would integrate with the file system or specification manager
        return true; // Placeholder
    }

    private validateDependencies(operation: McpOperation): boolean {
        // Validate that all dependencies are valid
        if (!operation.dependencies) {return true;}

        // Check that dependencies exist and are not circular
        return operation.dependencies.length < 10; // Simple validation
    }

    private updateConflictHistory(conflict: Conflict): void {
        this.conflictHistory.conflicts.push(conflict);
        this.conflictHistory.statistics.totalConflicts++;

        // Update most common type
        const typeCounts = new Map<ConflictType, number>();
        for (const c of this.conflictHistory.conflicts) {
            typeCounts.set(c.type, (typeCounts.get(c.type) || 0) + 1);
        }

        let maxCount = 0;
        let mostCommon = ConflictType.DUPLICATE_OPERATION;
        for (const [type, count] of typeCounts) {
            if (count > maxCount) {
                maxCount = count;
                mostCommon = type;
            }
        }
        this.conflictHistory.statistics.mostCommonType = mostCommon;
    }

    private updatePatternRecognition(conflict: Conflict): void {
        const patternKey = `${conflict.type}-${conflict.resourcePath}`;
        const existing = this.patternRecognition.get(patternKey);

        if (existing) {
            existing.frequency++;
            existing.lastOccurrence = conflict.timestamp;
        } else {
            this.patternRecognition.set(patternKey, {
                id: patternKey,
                type: conflict.type,
                frequency: 1,
                lastOccurrence: conflict.timestamp,
                commonResolution: ConflictResolution.USER_DECIDE,
                successRate: 0,
                averageResolutionTime: 0
            });
        }
    }

    private getResourceIdentifier(operation: McpOperation): string {
        // Extract resource identifier based on operation type
        switch (operation.type) {
            case McpOperationType.CREATE_SPEC:
                return `spec:${(operation as any).params.specId || (operation as any).params.name}`;
            case McpOperationType.UPDATE_REQUIREMENTS:
            case McpOperationType.UPDATE_DESIGN:
            case McpOperationType.UPDATE_TASKS:
            case McpOperationType.ADD_USER_STORY:
            case McpOperationType.UPDATE_TASK_STATUS:
            case McpOperationType.DELETE_SPEC:
                return `spec:${(operation as any).params.specId}`;
            default:
                return `${operation.type}:${operation.id}`;
        }
    }

    private createConflict(
        type: ConflictType,
        operations: McpOperation[],
        description: string,
        severity: 'low' | 'medium' | 'high' | 'critical' = 'medium',
        predicted: boolean = false
    ): Conflict {
        const conflictId = `conflict-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        const strategy = this.resolutionStrategies.get(type);
        const resourcePath = this.getResourceIdentifier(operations[0]);

        const conflict: Conflict = {
            id: conflictId,
            type,
            operations,
            description,
            recommendations: this.getRecommendationsForType(type),
            timestamp: new Date().toISOString(),
            resolved: false,
            severity,
            resourcePath,
            affectedFiles: this.getAffectedFiles(operations),
            metadata: {
                predicted,
                detectionMethod: predicted ? 'pattern-based' : 'rule-based'
            },
            resolutionAttempts: 0,
            autoResolvable: strategy?.autoResolve || false,
            userNotified: false,
            similarConflicts: this.findSimilarConflicts(type, resourcePath)
        };

        this.conflicts.set(conflictId, conflict);

        // Log conflict detection
        this.outputChannel.appendLine(
            `🔍 Detected ${severity} ${type} conflict: ${description} (${operations.length} operations)`
        );

        // Auto-resolve if possible and not predicted
        if (strategy?.autoResolve && !predicted) {
            setTimeout(() => this.resolveConflict(conflictId), 100);
        }

        // Update status bar
        this.updateStatusBar();

        return conflict;
    }

    private getAffectedFiles(operations: McpOperation[]): string[] {
        const files = new Set<string>();

        for (const operation of operations) {
            const resourceId = this.getResourceIdentifier(operation);

            // Convert resource identifier to file paths
            if (resourceId.startsWith('spec:')) {
                const specId = resourceId.substring(5);
                files.add(`${specId}/requirements.md`);
                files.add(`${specId}/design.md`);
                files.add(`${specId}/tasks.md`);
            }
        }

        return Array.from(files);
    }

    private findSimilarConflicts(type: ConflictType, resourcePath: string): string[] {
        return Array.from(this.conflicts.values())
            .filter(c => c.type === type && c.resourcePath === resourcePath && c.resolved)
            .map(c => c.id)
            .slice(-5); // Last 5 similar conflicts
    }

    private getRecommendationsForType(type: ConflictType): ConflictResolution[] {
        switch (type) {
            case ConflictType.CONCURRENT_MODIFICATION:
                return [
                    ConflictResolution.MERGE,
                    ConflictResolution.EXTENSION_WINS,
                    ConflictResolution.MCP_WINS,
                    ConflictResolution.DEFER,
                    ConflictResolution.CANCEL
                ];
            case ConflictType.DUPLICATE_OPERATION:
                return [ConflictResolution.CANCEL];
            case ConflictType.RESOURCE_LOCKED:
                return [ConflictResolution.DEFER, ConflictResolution.RETRY, ConflictResolution.CANCEL];
            case ConflictType.DEPENDENCY_CONFLICT:
                return [ConflictResolution.REORDER, ConflictResolution.DEFER, ConflictResolution.CANCEL];
            case ConflictType.VERSION_MISMATCH:
                return [ConflictResolution.USER_DECIDE, ConflictResolution.EXTENSION_WINS, ConflictResolution.MCP_WINS];
            case ConflictType.CIRCULAR_DEPENDENCY:
                return [ConflictResolution.REORDER, ConflictResolution.CANCEL];
            case ConflictType.PRIORITY_CONFLICT:
                return [ConflictResolution.REORDER, ConflictResolution.DEFER];
            case ConflictType.OUTDATED_OPERATION:
                return [ConflictResolution.CANCEL, ConflictResolution.RETRY];
            case ConflictType.PERMISSION_DENIED:
                return [ConflictResolution.EXTENSION_WINS, ConflictResolution.RETRY];
            case ConflictType.RESOURCE_NOT_FOUND:
                return [ConflictResolution.CANCEL, ConflictResolution.RETRY];
            case ConflictType.INVALID_STATE:
                return [ConflictResolution.RETRY, ConflictResolution.CANCEL];
            default:
                return [ConflictResolution.USER_DECIDE];
        }
    }

    getActiveConflicts(): Conflict[] {
        return Array.from(this.conflicts.values()).filter(c => !c.resolved);
    }

    getConflictById(id: string): Conflict | undefined {
        return this.conflicts.get(id);
    }

    getConflictHistory(): ConflictHistory {
        return this.conflictHistory;
    }

    getConflictStatistics(): ConflictHistory['statistics'] {
        return this.conflictHistory.statistics;
    }

    getConflictPatterns(): ConflictPattern[] {
        return Array.from(this.patternRecognition.values());
    }

    getPreventionStrategies(): ConflictPreventionStrategy[] {
        return Array.from(this.preventionStrategies.values());
    }

    async enablePreventionStrategy(strategyId: string): Promise<boolean> {
        const strategy = this.preventionStrategies.get(strategyId);
        if (strategy) {
            strategy.enabled = true;
            this.outputChannel.appendLine(`✅ Enabled prevention strategy: ${strategy.name}`);
            return true;
        }
        return false;
    }

    async disablePreventionStrategy(strategyId: string): Promise<boolean> {
        const strategy = this.preventionStrategies.get(strategyId);
        if (strategy) {
            strategy.enabled = false;
            this.outputChannel.appendLine(`❌ Disabled prevention strategy: ${strategy.name}`);
            return true;
        }
        return false;
    }

    async exportConflictReport(): Promise<string> {
        const report = {
            timestamp: new Date().toISOString(),
            activeConflicts: this.getActiveConflicts().length,
            totalConflicts: this.conflictHistory.statistics.totalConflicts,
            statistics: this.conflictHistory.statistics,
            patterns: this.getConflictPatterns(),
            preventionStrategies: this.getPreventionStrategies().map(s => ({
                id: s.id,
                name: s.name,
                enabled: s.enabled,
                effectiveness: s.effectiveness
            }))
        };

        return JSON.stringify(report, null, 2);
    }

    async cleanupResolvedConflicts(maxAgeHours: number = 24): Promise<void> {
        const cutoff = Date.now() - (maxAgeHours * 60 * 60 * 1000);
        let cleanedCount = 0;

        for (const [id, conflict] of this.conflicts.entries()) {
            if (conflict.resolved &&
                conflict.resolvedAt &&
                new Date(conflict.resolvedAt).getTime() < cutoff) {
                this.conflicts.delete(id);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            this.outputChannel.appendLine(`🧹 Cleaned up ${cleanedCount} old resolved conflicts`);
            this.updateStatusBar();
        }
    }

    async performMaintenance(): Promise<void> {
        // Clean up old conflicts
        await this.cleanupResolvedConflicts();

        // Update pattern recognition effectiveness
        this.updatePatternEffectiveness();

        // Clean up old patterns with low frequency
        this.cleanupOldPatterns();

        // Update prevention strategy effectiveness
        this.updatePreventionEffectiveness();

        this.outputChannel.appendLine('🔧 Performed conflict resolver maintenance');
    }

    private updatePatternEffectiveness(): void {
        for (const [patternId, pattern] of this.patternRecognition) {
            // Decay frequency over time to prioritize recent patterns
            const daysSinceLastOccurrence = (Date.now() - new Date(pattern.lastOccurrence).getTime()) / (1000 * 60 * 60 * 24);
            if (daysSinceLastOccurrence > 30) {
                pattern.frequency = Math.max(1, pattern.frequency * 0.9);
            }
        }
    }

    private cleanupOldPatterns(): void {
        const cutoff = Date.now() - (90 * 24 * 60 * 60 * 1000); // 90 days

        for (const [patternId, pattern] of this.patternRecognition) {
            if (pattern.frequency < 2 && new Date(pattern.lastOccurrence).getTime() < cutoff) {
                this.patternRecognition.delete(patternId);
            }
        }
    }

    private updatePreventionEffectiveness(): void {
        // Update prevention strategy effectiveness based on recent conflict rates
        const recentConflicts = this.conflictHistory.conflicts.filter(c => {
            const daysSince = (Date.now() - new Date(c.timestamp).getTime()) / (1000 * 60 * 60 * 24);
            return daysSince <= 7; // Last 7 days
        });

        for (const [strategyId, strategy] of this.preventionStrategies) {
            const applicableConflicts = recentConflicts.filter(c =>
                strategy.applicableTypes.includes(c.type)
            );

            if (applicableConflicts.length > 0) {
                const preventedCount = applicableConflicts.filter(c =>
                    c.metadata.preventionAttempted === strategyId
                ).length;

                strategy.effectiveness = preventedCount / applicableConflicts.length;
            }
        }
    }

    dispose(): void {
        // Clean up resources
        if (this.statusBarItem) {
            this.statusBarItem.dispose();
        }

        this.outputChannel.dispose();

        // Clear all conflicts and patterns
        this.conflicts.clear();
        this.patternRecognition.clear();
        this.preventionStrategies.clear();
    }
}
