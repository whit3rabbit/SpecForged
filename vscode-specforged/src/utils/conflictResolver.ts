import * as vscode from 'vscode';
import { McpOperation, McpOperationType, McpOperationStatus } from '../models/mcpOperation';

export enum ConflictType {
    CONCURRENT_MODIFICATION = 'concurrent_modification',
    DUPLICATE_OPERATION = 'duplicate_operation',
    OUTDATED_OPERATION = 'outdated_operation',
    PERMISSION_DENIED = 'permission_denied',
    RESOURCE_NOT_FOUND = 'resource_not_found',
    INVALID_STATE = 'invalid_state'
}

export enum ConflictResolution {
    EXTENSION_WINS = 'extension_wins',
    MCP_WINS = 'mcp_wins',
    MERGE = 'merge',
    USER_DECIDE = 'user_decide',
    RETRY = 'retry',
    CANCEL = 'cancel'
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

    constructor() {
        this.initializeDefaultStrategies();
    }

    private initializeDefaultStrategies(): void {
        // Concurrent modifications usually require user input
        this.resolutionStrategies.set(ConflictType.CONCURRENT_MODIFICATION, {
            type: ConflictType.CONCURRENT_MODIFICATION,
            autoResolve: false,
            defaultResolution: ConflictResolution.USER_DECIDE,
            requiresUserInput: true
        });

        // Duplicate operations can be auto-resolved by canceling the duplicate
        this.resolutionStrategies.set(ConflictType.DUPLICATE_OPERATION, {
            type: ConflictType.DUPLICATE_OPERATION,
            autoResolve: true,
            defaultResolution: ConflictResolution.CANCEL,
            requiresUserInput: false
        });

        // Outdated operations can be auto-canceled
        this.resolutionStrategies.set(ConflictType.OUTDATED_OPERATION, {
            type: ConflictType.OUTDATED_OPERATION,
            autoResolve: true,
            defaultResolution: ConflictResolution.CANCEL,
            requiresUserInput: false
        });

        // Permission denied can be retried or the extension can take over
        this.resolutionStrategies.set(ConflictType.PERMISSION_DENIED, {
            type: ConflictType.PERMISSION_DENIED,
            autoResolve: true,
            defaultResolution: ConflictResolution.EXTENSION_WINS,
            requiresUserInput: false
        });

        // Resource not found requires user decision or retry
        this.resolutionStrategies.set(ConflictType.RESOURCE_NOT_FOUND, {
            type: ConflictType.RESOURCE_NOT_FOUND,
            autoResolve: false,
            defaultResolution: ConflictResolution.USER_DECIDE,
            requiresUserInput: true
        });

        // Invalid state usually means we need to retry or cancel
        this.resolutionStrategies.set(ConflictType.INVALID_STATE, {
            type: ConflictType.INVALID_STATE,
            autoResolve: true,
            defaultResolution: ConflictResolution.RETRY,
            requiresUserInput: false
        });
    }

    async detectConflict(operation: McpOperation, existingOperations: McpOperation[]): Promise<Conflict | null> {
        // Check for duplicate operations
        const duplicate = existingOperations.find(existing =>
            existing.id !== operation.id &&
            existing.type === operation.type &&
            JSON.stringify(existing.params) === JSON.stringify(operation.params) &&
            existing.status !== McpOperationStatus.COMPLETED &&
            existing.status !== McpOperationStatus.FAILED
        );

        if (duplicate) {
            return this.createConflict(
                ConflictType.DUPLICATE_OPERATION,
                [operation, duplicate],
                `Duplicate operation detected: ${operation.type}`
            );
        }

        // Check for concurrent modifications on the same resource
        const concurrent = this.findConcurrentOperations(operation, existingOperations);
        if (concurrent.length > 0) {
            return this.createConflict(
                ConflictType.CONCURRENT_MODIFICATION,
                [operation, ...concurrent],
                `Concurrent modifications detected for ${this.getResourceIdentifier(operation)}`
            );
        }

        // Check if operation is outdated (timestamp is too old)
        const operationAge = Date.now() - new Date(operation.timestamp).getTime();
        const maxAge = 5 * 60 * 1000; // 5 minutes

        if (operationAge > maxAge && operation.status === McpOperationStatus.PENDING) {
            return this.createConflict(
                ConflictType.OUTDATED_OPERATION,
                [operation],
                `Operation is outdated (${Math.round(operationAge / 60000)} minutes old)`
            );
        }

        return null;
    }

    async resolveConflict(conflictId: string, resolution?: ConflictResolution): Promise<boolean> {
        const conflict = this.conflicts.get(conflictId);
        if (!conflict || conflict.resolved) {
            return false;
        }

        const strategy = this.resolutionStrategies.get(conflict.type);
        const finalResolution = resolution || strategy?.defaultResolution || ConflictResolution.USER_DECIDE;

        // If user input is required and no resolution provided, show dialog
        if (!resolution && strategy?.requiresUserInput) {
            const userResolution = await this.showConflictDialog(conflict);
            if (!userResolution) {
                return false; // User cancelled
            }
            return this.resolveConflict(conflictId, userResolution);
        }

        try {
            const success = await this.applyResolution(conflict, finalResolution);

            if (success) {
                conflict.resolved = true;
                conflict.resolution = finalResolution;
                conflict.resolvedBy = resolution ? 'user' : 'system';
                conflict.resolvedAt = new Date().toISOString();

                console.log(`Resolved conflict ${conflictId} with resolution: ${finalResolution}`);
            }

            return success;
        } catch (error) {
            console.error(`Failed to resolve conflict ${conflictId}:`, error);
            return false;
        }
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

            default:
                return false;
        }
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

    private async showConflictDialog(conflict: Conflict): Promise<ConflictResolution | undefined> {
        const options: vscode.QuickPickItem[] = conflict.recommendations.map(resolution => ({
            label: this.getResolutionLabel(resolution),
            description: this.getResolutionDescription(resolution, conflict),
            detail: this.getResolutionDetail(resolution),
            resolution
        }));

        const selected = await vscode.window.showQuickPick(options, {
            placeHolder: `Resolve conflict: ${conflict.description}`,
            canPickMany: false,
            matchOnDescription: true,
            matchOnDetail: true
        });

        return (selected as any)?.resolution;
    }

    private getResolutionLabel(resolution: ConflictResolution): string {
        switch (resolution) {
            case ConflictResolution.EXTENSION_WINS: return '$(check) Extension Wins';
            case ConflictResolution.MCP_WINS: return '$(server-process) MCP Server Wins';
            case ConflictResolution.MERGE: return '$(git-merge) Merge Changes';
            case ConflictResolution.RETRY: return '$(sync) Retry Operation';
            case ConflictResolution.CANCEL: return '$(x) Cancel Operation';
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
            default: return '';
        }
    }

    private findConcurrentOperations(operation: McpOperation, existingOperations: McpOperation[]): McpOperation[] {
        const resourceId = this.getResourceIdentifier(operation);
        const operationTime = new Date(operation.timestamp).getTime();
        const concurrencyWindow = 60 * 1000; // 1 minute

        return existingOperations.filter(existing => {
            if (existing.id === operation.id) return false;

            const existingResourceId = this.getResourceIdentifier(existing);
            if (resourceId !== existingResourceId) return false;

            const existingTime = new Date(existing.timestamp).getTime();
            const timeDiff = Math.abs(operationTime - existingTime);

            return timeDiff <= concurrencyWindow &&
                   existing.status !== McpOperationStatus.COMPLETED &&
                   existing.status !== McpOperationStatus.CANCELLED;
        });
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
        description: string
    ): Conflict {
        const conflictId = `conflict-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        const strategy = this.resolutionStrategies.get(type);

        const conflict: Conflict = {
            id: conflictId,
            type,
            operations,
            description,
            recommendations: this.getRecommendationsForType(type),
            timestamp: new Date().toISOString(),
            resolved: false
        };

        this.conflicts.set(conflictId, conflict);

        // Auto-resolve if possible
        if (strategy?.autoResolve) {
            setTimeout(() => this.resolveConflict(conflictId), 100);
        }

        return conflict;
    }

    private getRecommendationsForType(type: ConflictType): ConflictResolution[] {
        switch (type) {
            case ConflictType.CONCURRENT_MODIFICATION:
                return [
                    ConflictResolution.MERGE,
                    ConflictResolution.EXTENSION_WINS,
                    ConflictResolution.MCP_WINS,
                    ConflictResolution.CANCEL
                ];
            case ConflictType.DUPLICATE_OPERATION:
                return [ConflictResolution.CANCEL];
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

    async cleanupResolvedConflicts(maxAgeHours: number = 24): Promise<void> {
        const cutoff = Date.now() - (maxAgeHours * 60 * 60 * 1000);

        for (const [id, conflict] of this.conflicts.entries()) {
            if (conflict.resolved &&
                conflict.resolvedAt &&
                new Date(conflict.resolvedAt).getTime() < cutoff) {
                this.conflicts.delete(id);
            }
        }
    }
}
