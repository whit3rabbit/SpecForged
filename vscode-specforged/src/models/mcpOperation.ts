export enum McpOperationType {
    CREATE_SPEC = 'create_spec',
    UPDATE_REQUIREMENTS = 'update_requirements',
    UPDATE_DESIGN = 'update_design',
    UPDATE_TASKS = 'update_tasks',
    ADD_USER_STORY = 'add_user_story',
    UPDATE_TASK_STATUS = 'update_task_status',
    DELETE_SPEC = 'delete_spec',
    SET_CURRENT_SPEC = 'set_current_spec',
    SYNC_STATUS = 'sync_status',
    HEARTBEAT = 'heartbeat'
}

export enum ConflictType {
    CONCURRENT_MODIFICATION = 'concurrent_modification',
    DUPLICATE_OPERATION = 'duplicate_operation',
    RESOURCE_LOCKED = 'resource_locked',
    DEPENDENCY_CONFLICT = 'dependency_conflict',
    VERSION_MISMATCH = 'version_mismatch'
}

export enum ConflictResolutionStrategy {
    MANUAL = 'manual',
    AUTO_MERGE = 'auto_merge',
    PREFER_NEWER = 'prefer_newer',
    PREFER_OLDER = 'prefer_older',
    CANCEL_CONFLICTING = 'cancel_conflicting'
}

export enum McpOperationStatus {
    PENDING = 'pending',
    IN_PROGRESS = 'in_progress',
    COMPLETED = 'completed',
    FAILED = 'failed',
    CANCELLED = 'cancelled'
}

export enum McpOperationPriority {
    LOW = 0,
    NORMAL = 1,
    HIGH = 2,
    URGENT = 3
}

// Retry logic constants
export const retryConfig = {
    defaultMaxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitterFactor: 0.1
} as const;

export interface Conflict {
    id: string;
    type: ConflictType;
    operationIds: string[];
    resourcePath: string;
    description: string;
    detectedAt: string;
    resolutionStrategy?: ConflictResolutionStrategy;
    resolvedAt?: string;
    resolvedBy?: string;
    metadata?: {
        [key: string]: any;
    };
}

export interface ConflictResolution {
    conflictId: string;
    strategy: ConflictResolutionStrategy;
    selectedOperationId?: string;
    mergedContent?: string;
    userDecision?: any;
    timestamp: string;
}

export interface McpOperationBase {
    id: string;
    type: McpOperationType;
    status: McpOperationStatus;
    priority: McpOperationPriority;
    timestamp: string;
    startedAt?: string;
    completedAt?: string;
    source: 'mcp' | 'extension';
    retryCount: number;
    maxRetries: number;
    nextRetryAt?: string;
    error?: string;
    result?: any;
    metadata?: {
        [key: string]: any;
    };
    dependencies?: string[]; // IDs of operations this depends on
    conflictIds?: string[]; // IDs of conflicts involving this operation
    estimatedDurationMs?: number;
    actualDurationMs?: number;
}

export interface CreateSpecOperation extends McpOperationBase {
    type: McpOperationType.CREATE_SPEC;
    params: {
        name: string;
        description?: string;
        specId?: string;
    };
}

export interface UpdateRequirementsOperation extends McpOperationBase {
    type: McpOperationType.UPDATE_REQUIREMENTS;
    params: {
        specId: string;
        content: string;
    };
}

export interface UpdateDesignOperation extends McpOperationBase {
    type: McpOperationType.UPDATE_DESIGN;
    params: {
        specId: string;
        content: string;
    };
}

export interface UpdateTasksOperation extends McpOperationBase {
    type: McpOperationType.UPDATE_TASKS;
    params: {
        specId: string;
        content: string;
    };
}

export interface AddUserStoryOperation extends McpOperationBase {
    type: McpOperationType.ADD_USER_STORY;
    params: {
        specId: string;
        asA: string;
        iWant: string;
        soThat: string;
        requirements?: Array<{
            condition: string;
            systemResponse: string;
        }>;
    };
}

export interface UpdateTaskStatusOperation extends McpOperationBase {
    type: McpOperationType.UPDATE_TASK_STATUS;
    params: {
        specId: string;
        taskNumber: string;
        status: 'pending' | 'in_progress' | 'completed';
    };
}

export interface DeleteSpecOperation extends McpOperationBase {
    type: McpOperationType.DELETE_SPEC;
    params: {
        specId: string;
    };
}

export interface SetCurrentSpecOperation extends McpOperationBase {
    type: McpOperationType.SET_CURRENT_SPEC;
    params: {
        specId: string;
    };
}

export interface SyncStatusOperation extends McpOperationBase {
    type: McpOperationType.SYNC_STATUS;
    params: {};
}

export interface HeartbeatOperation extends McpOperationBase {
    type: McpOperationType.HEARTBEAT;
    params: {
        extensionVersion?: string;
        mcpServerVersion?: string;
        workspaceInfo?: {
            rootPath: string;
            specCount: number;
        };
    };
}

export type McpOperation =
    | CreateSpecOperation
    | UpdateRequirementsOperation
    | UpdateDesignOperation
    | UpdateTasksOperation
    | AddUserStoryOperation
    | UpdateTaskStatusOperation
    | DeleteSpecOperation
    | SetCurrentSpecOperation
    | SyncStatusOperation
    | HeartbeatOperation;

export interface McpOperationQueue {
    operations: McpOperation[];
    conflicts: Conflict[];
    lastProcessed?: string;
    version: number;
    createdAt: string;
    lastModified: string;
    processingStats: {
        totalProcessed: number;
        successCount: number;
        failureCount: number;
        averageProcessingTimeMs: number;
    };
}

export interface McpSyncState {
    extensionOnline: boolean;
    mcpServerOnline: boolean;
    lastSync?: string;
    lastHeartbeat?: string;
    pendingOperations: number;
    inProgressOperations: number;
    failedOperations: number;
    completedOperations: number;
    activeConflicts: number;
    syncErrors: Array<{
        timestamp: string;
        error: string;
        operationId?: string;
    }>;
    specifications: Array<{
        specId: string;
        lastModified: string;
        version: number;
        status: 'active' | 'archived' | 'draft';
    }>;
    performance: {
        averageOperationTimeMs: number;
        queueProcessingRate: number; // operations per minute
        lastProcessingDuration: number;
    };
}

export interface McpOperationResult {
    operationId: string;
    success: boolean;
    message: string;
    data?: any;
    error?: {
        code: string;
        message: string;
        details?: any;
        stack?: string;
    };
    timestamp: string;
    processingTimeMs: number;
    retryable: boolean;
    conflictsDetected?: Conflict[];
}

export class McpOperationFactory {
    static createOperation<T extends McpOperation>(
        type: McpOperationType,
        params: any,
        options: {
            priority?: McpOperationPriority;
            source?: 'mcp' | 'extension';
            maxRetries?: number;
            dependencies?: string[];
            estimatedDurationMs?: number;
            metadata?: { [key: string]: any };
        } = {}
    ): T {
        const {
            priority = McpOperationPriority.NORMAL,
            source = 'extension',
            maxRetries = retryConfig.defaultMaxRetries,
            dependencies = [],
            estimatedDurationMs,
            metadata = {}
        } = options;

        const baseOperation: McpOperationBase = {
            id: this.generateOperationId(),
            type,
            status: McpOperationStatus.PENDING,
            priority,
            timestamp: new Date().toISOString(),
            source,
            retryCount: 0,
            maxRetries,
            dependencies,
            estimatedDurationMs,
            metadata
        };

        return {
            ...baseOperation,
            params
        } as T;
    }

    static createCreateSpecOperation(
        name: string,
        description?: string,
        specId?: string,
        options?: {
            priority?: McpOperationPriority;
            metadata?: { [key: string]: any };
        }
    ): CreateSpecOperation {
        return this.createOperation<CreateSpecOperation>(
            McpOperationType.CREATE_SPEC,
            { name, description, specId },
            {
                ...options,
                estimatedDurationMs: 5000 // Estimated 5 seconds for spec creation
            }
        );
    }

    static createUpdateRequirementsOperation(
        specId: string,
        content: string,
        options?: {
            priority?: McpOperationPriority;
            metadata?: { [key: string]: any };
        }
    ): UpdateRequirementsOperation {
        return this.createOperation<UpdateRequirementsOperation>(
            McpOperationType.UPDATE_REQUIREMENTS,
            { specId, content },
            {
                ...options,
                estimatedDurationMs: 2000 // Estimated 2 seconds for requirements update
            }
        );
    }

    static createUpdateDesignOperation(
        specId: string,
        content: string,
        options?: {
            priority?: McpOperationPriority;
            metadata?: { [key: string]: any };
        }
    ): UpdateDesignOperation {
        return this.createOperation<UpdateDesignOperation>(
            McpOperationType.UPDATE_DESIGN,
            { specId, content },
            {
                ...options,
                estimatedDurationMs: 2000 // Estimated 2 seconds for design update
            }
        );
    }

    static createUpdateTasksOperation(
        specId: string,
        content: string,
        options?: {
            priority?: McpOperationPriority;
            metadata?: { [key: string]: any };
        }
    ): UpdateTasksOperation {
        return this.createOperation<UpdateTasksOperation>(
            McpOperationType.UPDATE_TASKS,
            { specId, content },
            {
                ...options,
                estimatedDurationMs: 2000 // Estimated 2 seconds for tasks update
            }
        );
    }

    static createAddUserStoryOperation(
        specId: string,
        asA: string,
        iWant: string,
        soThat: string,
        requirements?: Array<{condition: string; systemResponse: string}>,
        options?: {
            priority?: McpOperationPriority;
            metadata?: { [key: string]: any };
        }
    ): AddUserStoryOperation {
        return this.createOperation<AddUserStoryOperation>(
            McpOperationType.ADD_USER_STORY,
            { specId, asA, iWant, soThat, requirements },
            {
                ...options,
                estimatedDurationMs: 3000 // Estimated 3 seconds for user story addition
            }
        );
    }

    static createUpdateTaskStatusOperation(
        specId: string,
        taskNumber: string,
        status: 'pending' | 'in_progress' | 'completed',
        options?: {
            priority?: McpOperationPriority;
            metadata?: { [key: string]: any };
        }
    ): UpdateTaskStatusOperation {
        return this.createOperation<UpdateTaskStatusOperation>(
            McpOperationType.UPDATE_TASK_STATUS,
            { specId, taskNumber, status },
            {
                ...options,
                estimatedDurationMs: 1000 // Estimated 1 second for task status update
            }
        );
    }

    static createDeleteSpecOperation(
        specId: string,
        options?: {
            priority?: McpOperationPriority;
            metadata?: { [key: string]: any };
        }
    ): DeleteSpecOperation {
        return this.createOperation<DeleteSpecOperation>(
            McpOperationType.DELETE_SPEC,
            { specId },
            {
                ...options,
                estimatedDurationMs: 2000 // Estimated 2 seconds for spec deletion
            }
        );
    }

    static createSetCurrentSpecOperation(
        specId: string,
        options?: {
            priority?: McpOperationPriority;
            metadata?: { [key: string]: any };
        }
    ): SetCurrentSpecOperation {
        return this.createOperation<SetCurrentSpecOperation>(
            McpOperationType.SET_CURRENT_SPEC,
            { specId },
            {
                ...options,
                priority: McpOperationPriority.HIGH, // High priority for context switching
                estimatedDurationMs: 500 // Estimated 0.5 seconds for context switch
            }
        );
    }

    static createSyncStatusOperation(
        options?: {
            priority?: McpOperationPriority;
            metadata?: { [key: string]: any };
        }
    ): SyncStatusOperation {
        return this.createOperation<SyncStatusOperation>(
            McpOperationType.SYNC_STATUS,
            {},
            {
                ...options,
                priority: McpOperationPriority.LOW, // Low priority for status sync
                estimatedDurationMs: 1000 // Estimated 1 second for status sync
            }
        );
    }

    static createHeartbeatOperation(
        extensionVersion?: string,
        mcpServerVersion?: string,
        workspaceInfo?: {
            rootPath: string;
            specCount: number;
        }
    ): HeartbeatOperation {
        return this.createOperation<HeartbeatOperation>(
            McpOperationType.HEARTBEAT,
            { extensionVersion, mcpServerVersion, workspaceInfo },
            {
                priority: McpOperationPriority.LOW,
                maxRetries: 1, // Don't retry heartbeats aggressively
                estimatedDurationMs: 200 // Estimated 0.2 seconds for heartbeat
            }
        );
    }

    static cloneOperation(operation: McpOperation): McpOperation {
        return {
            ...operation,
            id: this.generateOperationId(),
            timestamp: new Date().toISOString(),
            status: McpOperationStatus.PENDING,
            retryCount: 0,
            startedAt: undefined,
            completedAt: undefined,
            error: undefined,
            result: undefined,
            nextRetryAt: undefined,
            conflictIds: undefined
        };
    }

    static createRetryOperation(operation: McpOperation): McpOperation {
        const retryOperation = this.cloneOperation(operation);
        retryOperation.retryCount = operation.retryCount + 1;
        retryOperation.nextRetryAt = this.calculateNextRetryTime(operation.retryCount + 1);
        retryOperation.metadata = {
            ...operation.metadata,
            originalOperationId: operation.id,
            retryReason: operation.error || 'Unknown error'
        };
        return retryOperation;
    }

    static calculateNextRetryTime(retryCount: number): string {
        const delay = this.calculateRetryDelay(retryCount);
        return new Date(Date.now() + delay).toISOString();
    }

    static calculateRetryDelay(retryCount: number): number {
        const baseDelay = retryConfig.baseDelayMs;
        const exponentialDelay = baseDelay * Math.pow(retryConfig.backoffMultiplier, retryCount - 1);
        const cappedDelay = Math.min(exponentialDelay, retryConfig.maxDelayMs);

        // Add jitter to prevent thundering herd
        const jitter = cappedDelay * retryConfig.jitterFactor * Math.random();
        return Math.floor(cappedDelay + jitter);
    }

    private static generateOperationId(): string {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        return `op-${timestamp}-${random}`;
    }
}

export class McpOperationValidator {
    private static readonly SPEC_ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;
    private static readonly TASK_NUMBER_PATTERN = /^\d+(\.\d+)*$/;
    private static readonly MAX_NAME_LENGTH = 100;
    private static readonly MAX_DESCRIPTION_LENGTH = 1000;
    private static readonly MAX_CONTENT_LENGTH = 100000; // 100KB

    static validateOperation(operation: McpOperation): { valid: boolean; errors: string[]; warnings: string[] } {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Basic structure validation
        this.validateBasicStructure(operation, errors);

        // Type-specific validation
        this.validateOperationParams(operation, errors, warnings);

        // Business logic validation
        this.validateBusinessRules(operation, errors, warnings);

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    private static validateBasicStructure(operation: McpOperation, errors: string[]): void {
        if (!operation.id || typeof operation.id !== 'string') {
            errors.push('Operation ID is required and must be a string');
        } else if (operation.id.length < 10) {
            errors.push('Operation ID must be at least 10 characters long');
        }

        if (!Object.values(McpOperationType).includes(operation.type)) {
            errors.push(`Invalid operation type: ${operation.type}`);
        }

        if (!Object.values(McpOperationStatus).includes(operation.status)) {
            errors.push(`Invalid operation status: ${operation.status}`);
        }

        if (!Object.values(McpOperationPriority).includes(operation.priority)) {
            errors.push(`Invalid operation priority: ${operation.priority}`);
        }

        if (!operation.timestamp || !this.isValidISODate(operation.timestamp)) {
            errors.push('Valid timestamp is required');
        }

        if (!['mcp', 'extension'].includes(operation.source)) {
            errors.push('Source must be either "mcp" or "extension"');
        }

        if (typeof operation.retryCount !== 'number' || operation.retryCount < 0) {
            errors.push('Retry count must be a non-negative number');
        }

        if (typeof operation.maxRetries !== 'number' || operation.maxRetries < 0) {
            errors.push('Max retries must be a non-negative number');
        }

        if (operation.retryCount > operation.maxRetries) {
            errors.push('Retry count cannot exceed max retries');
        }
    }

    private static validateOperationParams(operation: McpOperation, errors: string[], warnings: string[]): void {
        switch (operation.type) {
            case McpOperationType.CREATE_SPEC:
                this.validateCreateSpecParams(operation as CreateSpecOperation, errors, warnings);
                break;

            case McpOperationType.UPDATE_REQUIREMENTS:
                this.validateUpdateRequirementsParams(operation as UpdateRequirementsOperation, errors, warnings);
                break;

            case McpOperationType.UPDATE_DESIGN:
                this.validateUpdateDesignParams(operation as UpdateDesignOperation, errors, warnings);
                break;

            case McpOperationType.UPDATE_TASKS:
                this.validateUpdateTasksParams(operation as UpdateTasksOperation, errors, warnings);
                break;

            case McpOperationType.ADD_USER_STORY:
                this.validateAddUserStoryParams(operation as AddUserStoryOperation, errors, warnings);
                break;

            case McpOperationType.UPDATE_TASK_STATUS:
                this.validateUpdateTaskStatusParams(operation as UpdateTaskStatusOperation, errors, warnings);
                break;

            case McpOperationType.DELETE_SPEC:
                this.validateDeleteSpecParams(operation as DeleteSpecOperation, errors, warnings);
                break;

            case McpOperationType.SET_CURRENT_SPEC:
                this.validateSetCurrentSpecParams(operation as SetCurrentSpecOperation, errors, warnings);
                break;

            case McpOperationType.SYNC_STATUS:
                this.validateSyncStatusParams(operation as SyncStatusOperation, errors, warnings);
                break;

            case McpOperationType.HEARTBEAT:
                this.validateHeartbeatParams(operation as HeartbeatOperation, errors, warnings);
                break;
        }
    }

    private static validateCreateSpecParams(operation: CreateSpecOperation, errors: string[], warnings: string[]): void {
        const { name, description, specId } = operation.params;

        if (!name || typeof name !== 'string' || name.trim().length === 0) {
            errors.push('Specification name is required and must be a non-empty string');
        } else if (name.length > this.MAX_NAME_LENGTH) {
            errors.push(`Specification name must not exceed ${this.MAX_NAME_LENGTH} characters`);
        }

        if (description !== undefined) {
            if (typeof description !== 'string') {
                errors.push('Description must be a string');
            } else if (description.length > this.MAX_DESCRIPTION_LENGTH) {
                errors.push(`Description must not exceed ${this.MAX_DESCRIPTION_LENGTH} characters`);
            }
        }

        if (specId !== undefined) {
            if (typeof specId !== 'string') {
                errors.push('Spec ID must be a string');
            } else if (!this.SPEC_ID_PATTERN.test(specId)) {
                errors.push('Spec ID must contain only lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen');
            } else if (specId.length > 50) {
                errors.push('Spec ID must not exceed 50 characters');
            }
        }
    }

    private static validateUpdateRequirementsParams(operation: UpdateRequirementsOperation, errors: string[], warnings: string[]): void {
        this.validateSpecIdParam(operation.params.specId, errors);
        this.validateContentParam(operation.params.content, errors, warnings);
    }

    private static validateUpdateDesignParams(operation: UpdateDesignOperation, errors: string[], warnings: string[]): void {
        this.validateSpecIdParam(operation.params.specId, errors);
        this.validateContentParam(operation.params.content, errors, warnings);
    }

    private static validateUpdateTasksParams(operation: UpdateTasksOperation, errors: string[], warnings: string[]): void {
        this.validateSpecIdParam(operation.params.specId, errors);
        this.validateContentParam(operation.params.content, errors, warnings);
    }

    private static validateAddUserStoryParams(operation: AddUserStoryOperation, errors: string[], warnings: string[]): void {
        const { specId, asA, iWant, soThat, requirements } = operation.params;

        this.validateSpecIdParam(specId, errors);

        if (!asA || typeof asA !== 'string' || asA.trim().length === 0) {
            errors.push('User role ("As a") is required and must be a non-empty string');
        }

        if (!iWant || typeof iWant !== 'string' || iWant.trim().length === 0) {
            errors.push('Goal ("I want") is required and must be a non-empty string');
        }

        if (!soThat || typeof soThat !== 'string' || soThat.trim().length === 0) {
            errors.push('Benefit ("So that") is required and must be a non-empty string');
        }

        if (requirements !== undefined) {
            if (!Array.isArray(requirements)) {
                errors.push('Requirements must be an array');
            } else {
                requirements.forEach((req, index) => {
                    if (!req.condition || typeof req.condition !== 'string') {
                        errors.push(`Requirement ${index + 1}: condition is required and must be a string`);
                    }
                    if (!req.systemResponse || typeof req.systemResponse !== 'string') {
                        errors.push(`Requirement ${index + 1}: system response is required and must be a string`);
                    }
                });
            }
        }
    }

    private static validateUpdateTaskStatusParams(operation: UpdateTaskStatusOperation, errors: string[], warnings: string[]): void {
        const { specId, taskNumber, status } = operation.params;

        this.validateSpecIdParam(specId, errors);

        if (!taskNumber || typeof taskNumber !== 'string') {
            errors.push('Task number is required and must be a string');
        } else if (!this.TASK_NUMBER_PATTERN.test(taskNumber)) {
            errors.push('Task number must be in format "1", "1.1", "1.2.3", etc.');
        }

        if (!['pending', 'in_progress', 'completed'].includes(status)) {
            errors.push('Task status must be "pending", "in_progress", or "completed"');
        }
    }

    private static validateDeleteSpecParams(operation: DeleteSpecOperation, errors: string[], warnings: string[]): void {
        this.validateSpecIdParam(operation.params.specId, errors);
        warnings.push('Deleting a specification is irreversible');
    }

    private static validateSetCurrentSpecParams(operation: SetCurrentSpecOperation, errors: string[], warnings: string[]): void {
        this.validateSpecIdParam(operation.params.specId, errors);
    }

    private static validateSyncStatusParams(operation: SyncStatusOperation, errors: string[], warnings: string[]): void {
        // No specific parameters to validate for sync status
    }

    private static validateHeartbeatParams(operation: HeartbeatOperation, errors: string[], warnings: string[]): void {
        const { extensionVersion, mcpServerVersion, workspaceInfo } = operation.params;

        if (extensionVersion !== undefined && typeof extensionVersion !== 'string') {
            errors.push('Extension version must be a string');
        }

        if (mcpServerVersion !== undefined && typeof mcpServerVersion !== 'string') {
            errors.push('MCP server version must be a string');
        }

        if (workspaceInfo !== undefined) {
            if (typeof workspaceInfo !== 'object' || workspaceInfo === null) {
                errors.push('Workspace info must be an object');
            } else {
                if (typeof workspaceInfo.rootPath !== 'string') {
                    errors.push('Workspace root path must be a string');
                }
                if (typeof workspaceInfo.specCount !== 'number' || workspaceInfo.specCount < 0) {
                    errors.push('Spec count must be a non-negative number');
                }
            }
        }
    }

    private static validateSpecIdParam(specId: string, errors: string[]): void {
        if (!specId || typeof specId !== 'string') {
            errors.push('Spec ID is required and must be a string');
        } else if (!this.SPEC_ID_PATTERN.test(specId)) {
            errors.push('Spec ID must contain only lowercase letters, numbers, and hyphens, and cannot start or end with a hyphen');
        } else if (specId.length > 50) {
            errors.push('Spec ID must not exceed 50 characters');
        }
    }

    private static validateContentParam(content: string, errors: string[], warnings: string[]): void {
        if (!content || typeof content !== 'string') {
            errors.push('Content is required and must be a string');
        } else if (content.length > this.MAX_CONTENT_LENGTH) {
            errors.push(`Content must not exceed ${this.MAX_CONTENT_LENGTH} characters`);
        } else if (content.length > 50000) {
            warnings.push('Large content size may impact performance');
        }
    }

    private static validateBusinessRules(operation: McpOperation, errors: string[], warnings: string[]): void {
        // Check for expired operations
        if (this.shouldExpire(operation)) {
            warnings.push('Operation is older than 24 hours and may be expired');
        }

        // Check retry logic
        if (operation.status === McpOperationStatus.FAILED && !this.canRetry(operation)) {
            warnings.push('Operation has exceeded maximum retry attempts');
        }

        // Check for future timestamps
        const now = Date.now();
        const operationTime = new Date(operation.timestamp).getTime();
        if (operationTime > now + 60000) { // Allow 1 minute clock skew
            warnings.push('Operation timestamp is in the future');
        }

        // Check dependencies
        if (operation.dependencies && operation.dependencies.length > 10) {
            warnings.push('Operation has many dependencies, which may cause delays');
        }

        // Check estimated duration
        if (operation.estimatedDurationMs && operation.estimatedDurationMs > 300000) { // 5 minutes
            warnings.push('Operation has a long estimated duration');
        }
    }

    static canRetry(operation: McpOperation): boolean {
        return operation.status === McpOperationStatus.FAILED &&
               operation.retryCount < operation.maxRetries &&
               !this.shouldExpire(operation, 1); // Don't retry operations older than 1 hour
    }

    static shouldRetry(operation: McpOperation): boolean {
        if (!this.canRetry(operation)) {
            return false;
        }

        // Check if enough time has passed since last retry
        if (operation.nextRetryAt) {
            const nextRetryTime = new Date(operation.nextRetryAt).getTime();
            return Date.now() >= nextRetryTime;
        }

        return true;
    }

    static shouldExpire(operation: McpOperation, maxAgeHours: number = 24): boolean {
        const operationTime = new Date(operation.timestamp).getTime();
        const now = Date.now();
        const maxAge = maxAgeHours * 60 * 60 * 1000; // Convert to milliseconds

        return (now - operationTime) > maxAge;
    }

    static validateQueue(queue: McpOperationQueue): { valid: boolean; errors: string[]; warnings: string[] } {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!Array.isArray(queue.operations)) {
            errors.push('Operations must be an array');
        } else {
            // Validate each operation
            queue.operations.forEach((operation, index) => {
                const validation = this.validateOperation(operation);
                if (!validation.valid) {
                    errors.push(`Operation ${index}: ${validation.errors.join(', ')}`);
                }
                if (validation.warnings.length > 0) {
                    warnings.push(`Operation ${index}: ${validation.warnings.join(', ')}`);
                }
            });

            // Check for duplicate operation IDs
            const operationIds = queue.operations.map(op => op.id);
            const duplicateIds = operationIds.filter((id, index) => operationIds.indexOf(id) !== index);
            if (duplicateIds.length > 0) {
                errors.push(`Duplicate operation IDs found: ${duplicateIds.join(', ')}`);
            }
        }

        if (!Array.isArray(queue.conflicts)) {
            errors.push('Conflicts must be an array');
        }

        if (typeof queue.version !== 'number' || queue.version < 1) {
            errors.push('Queue version must be a positive number');
        }

        if (!queue.createdAt || !this.isValidISODate(queue.createdAt)) {
            errors.push('Valid createdAt timestamp is required');
        }

        if (!queue.lastModified || !this.isValidISODate(queue.lastModified)) {
            errors.push('Valid lastModified timestamp is required');
        }

        return {
            valid: errors.length === 0,
            errors,
            warnings
        };
    }

    static validateConflict(conflict: Conflict): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        if (!conflict.id || typeof conflict.id !== 'string') {
            errors.push('Conflict ID is required and must be a string');
        }

        if (!Object.values(ConflictType).includes(conflict.type)) {
            errors.push(`Invalid conflict type: ${conflict.type}`);
        }

        if (!Array.isArray(conflict.operationIds) || conflict.operationIds.length < 2) {
            errors.push('Conflict must involve at least 2 operations');
        }

        if (!conflict.resourcePath || typeof conflict.resourcePath !== 'string') {
            errors.push('Resource path is required and must be a string');
        }

        if (!conflict.description || typeof conflict.description !== 'string') {
            errors.push('Conflict description is required and must be a string');
        }

        if (!conflict.detectedAt || !this.isValidISODate(conflict.detectedAt)) {
            errors.push('Valid detectedAt timestamp is required');
        }

        if (conflict.resolutionStrategy && !Object.values(ConflictResolutionStrategy).includes(conflict.resolutionStrategy)) {
            errors.push(`Invalid resolution strategy: ${conflict.resolutionStrategy}`);
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    private static isValidISODate(dateString: string): boolean {
        const date = new Date(dateString);
        return date instanceof Date && !isNaN(date.getTime()) && date.toISOString() === dateString;
    }
}

// Utility classes for operation management
export class McpOperationUtils {
    static getOperationsByStatus(operations: McpOperation[], status: McpOperationStatus): McpOperation[] {
        return operations.filter(op => op.status === status);
    }

    static getOperationsByType(operations: McpOperation[], type: McpOperationType): McpOperation[] {
        return operations.filter(op => op.type === type);
    }

    static getOperationsBySpecId(operations: McpOperation[], specId: string): McpOperation[] {
        return operations.filter(op => {
            const params = op.params as any;
            return params.specId === specId;
        });
    }

    static sortOperationsByPriority(operations: McpOperation[]): McpOperation[] {
        return [...operations].sort((a, b) => {
            // Higher priority first, then by timestamp (older first)
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }
            return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        });
    }

    static getOperationDuration(operation: McpOperation): number | null {
        if (!operation.startedAt || !operation.completedAt) {
            return null;
        }
        return new Date(operation.completedAt).getTime() - new Date(operation.startedAt).getTime();
    }

    static isOperationExpired(operation: McpOperation, maxAgeHours: number = 24): boolean {
        return McpOperationValidator.shouldExpire(operation, maxAgeHours);
    }

    static canOperationBeRetried(operation: McpOperation): boolean {
        return McpOperationValidator.canRetry(operation);
    }

    static shouldOperationRetryNow(operation: McpOperation): boolean {
        return McpOperationValidator.shouldRetry(operation);
    }

    static getNextRetryDelay(retryCount: number): number {
        return McpOperationFactory.calculateRetryDelay(retryCount);
    }

    static formatOperationSummary(operation: McpOperation): string {
        const typeLabel = operation.type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        const params = operation.params as any;

        switch (operation.type) {
            case McpOperationType.CREATE_SPEC:
                return `Create Spec: ${params.name}`;
            case McpOperationType.UPDATE_REQUIREMENTS:
            case McpOperationType.UPDATE_DESIGN:
            case McpOperationType.UPDATE_TASKS:
                return `${typeLabel}: ${params.specId}`;
            case McpOperationType.ADD_USER_STORY:
                return `Add User Story: ${params.asA} wants ${params.iWant}`;
            case McpOperationType.UPDATE_TASK_STATUS:
                return `Update Task ${params.taskNumber}: ${params.status}`;
            case McpOperationType.DELETE_SPEC:
                return `Delete Spec: ${params.specId}`;
            case McpOperationType.SET_CURRENT_SPEC:
                return `Set Current Spec: ${params.specId}`;
            default:
                return typeLabel;
        }
    }

    static createEmptyQueue(): McpOperationQueue {
        const now = new Date().toISOString();
        return {
            operations: [],
            conflicts: [],
            version: 1,
            createdAt: now,
            lastModified: now,
            processingStats: {
                totalProcessed: 0,
                successCount: 0,
                failureCount: 0,
                averageProcessingTimeMs: 0
            }
        };
    }

    static createEmptySyncState(): McpSyncState {
        return {
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
    }
}

// Type guards for operation types
export function isCreateSpecOperation(operation: McpOperation): operation is CreateSpecOperation {
    return operation.type === McpOperationType.CREATE_SPEC;
}

export function isUpdateRequirementsOperation(operation: McpOperation): operation is UpdateRequirementsOperation {
    return operation.type === McpOperationType.UPDATE_REQUIREMENTS;
}

export function isUpdateDesignOperation(operation: McpOperation): operation is UpdateDesignOperation {
    return operation.type === McpOperationType.UPDATE_DESIGN;
}

export function isUpdateTasksOperation(operation: McpOperation): operation is UpdateTasksOperation {
    return operation.type === McpOperationType.UPDATE_TASKS;
}

export function isAddUserStoryOperation(operation: McpOperation): operation is AddUserStoryOperation {
    return operation.type === McpOperationType.ADD_USER_STORY;
}

export function isUpdateTaskStatusOperation(operation: McpOperation): operation is UpdateTaskStatusOperation {
    return operation.type === McpOperationType.UPDATE_TASK_STATUS;
}

export function isDeleteSpecOperation(operation: McpOperation): operation is DeleteSpecOperation {
    return operation.type === McpOperationType.DELETE_SPEC;
}

export function isSetCurrentSpecOperation(operation: McpOperation): operation is SetCurrentSpecOperation {
    return operation.type === McpOperationType.SET_CURRENT_SPEC;
}

export function isSyncStatusOperation(operation: McpOperation): operation is SyncStatusOperation {
    return operation.type === McpOperationType.SYNC_STATUS;
}

export function isHeartbeatOperation(operation: McpOperation): operation is HeartbeatOperation {
    return operation.type === McpOperationType.HEARTBEAT;
}
