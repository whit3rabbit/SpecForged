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

export interface McpOperationBase {
    id: string;
    type: McpOperationType;
    status: McpOperationStatus;
    priority: McpOperationPriority;
    timestamp: string;
    completedAt?: string;
    source: 'mcp' | 'extension';
    retryCount: number;
    maxRetries: number;
    error?: string;
    result?: any;
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
    lastProcessed?: string;
    version: number;
}

export interface McpSyncState {
    extensionOnline: boolean;
    mcpServerOnline: boolean;
    lastSync?: string;
    pendingOperations: number;
    failedOperations: number;
    syncErrors: string[];
    specifications: Array<{
        specId: string;
        lastModified: string;
        version: number;
    }>;
}

export interface McpOperationResult {
    operationId: string;
    success: boolean;
    message: string;
    data?: any;
    error?: string;
    timestamp: string;
}

export class McpOperationFactory {
    static createOperation(
        type: McpOperationType,
        params: any,
        priority: McpOperationPriority = McpOperationPriority.NORMAL,
        source: 'mcp' | 'extension' = 'extension'
    ): McpOperation {
        const baseOperation: McpOperationBase = {
            id: this.generateOperationId(),
            type,
            status: McpOperationStatus.PENDING,
            priority,
            timestamp: new Date().toISOString(),
            source,
            retryCount: 0,
            maxRetries: 3
        };

        return {
            ...baseOperation,
            params
        } as McpOperation;
    }

    static createCreateSpecOperation(
        name: string,
        description?: string,
        specId?: string,
        priority?: McpOperationPriority
    ): CreateSpecOperation {
        return this.createOperation(
            McpOperationType.CREATE_SPEC,
            { name, description, specId },
            priority
        ) as CreateSpecOperation;
    }

    static createUpdateTaskStatusOperation(
        specId: string,
        taskNumber: string,
        status: 'pending' | 'in_progress' | 'completed',
        priority?: McpOperationPriority
    ): UpdateTaskStatusOperation {
        return this.createOperation(
            McpOperationType.UPDATE_TASK_STATUS,
            { specId, taskNumber, status },
            priority
        ) as UpdateTaskStatusOperation;
    }

    static createAddUserStoryOperation(
        specId: string,
        asA: string,
        iWant: string,
        soThat: string,
        requirements?: Array<{condition: string; systemResponse: string}>,
        priority?: McpOperationPriority
    ): AddUserStoryOperation {
        return this.createOperation(
            McpOperationType.ADD_USER_STORY,
            { specId, asA, iWant, soThat, requirements },
            priority
        ) as AddUserStoryOperation;
    }

    static createHeartbeatOperation(
        extensionVersion?: string,
        mcpServerVersion?: string
    ): HeartbeatOperation {
        return this.createOperation(
            McpOperationType.HEARTBEAT,
            { extensionVersion, mcpServerVersion },
            McpOperationPriority.LOW
        ) as HeartbeatOperation;
    }

    private static generateOperationId(): string {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        return `op-${timestamp}-${random}`;
    }
}

export class McpOperationValidator {
    static validateOperation(operation: McpOperation): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        // Basic validation
        if (!operation.id) {
            errors.push('Operation ID is required');
        }

        if (!Object.values(McpOperationType).includes(operation.type)) {
            errors.push(`Invalid operation type: ${operation.type}`);
        }

        if (!Object.values(McpOperationStatus).includes(operation.status)) {
            errors.push(`Invalid operation status: ${operation.status}`);
        }

        // Type-specific validation
        switch (operation.type) {
            case McpOperationType.CREATE_SPEC:
                const createOp = operation as CreateSpecOperation;
                if (!createOp.params.name || createOp.params.name.trim().length === 0) {
                    errors.push('Specification name is required');
                }
                if (createOp.params.specId && !/^[a-z0-9-]+$/.test(createOp.params.specId)) {
                    errors.push('Spec ID must contain only lowercase letters, numbers, and hyphens');
                }
                break;

            case McpOperationType.UPDATE_TASK_STATUS:
                const taskOp = operation as UpdateTaskStatusOperation;
                if (!taskOp.params.specId) {
                    errors.push('Spec ID is required');
                }
                if (!taskOp.params.taskNumber) {
                    errors.push('Task number is required');
                }
                if (!['pending', 'in_progress', 'completed'].includes(taskOp.params.status)) {
                    errors.push('Invalid task status');
                }
                break;

            case McpOperationType.ADD_USER_STORY:
                const storyOp = operation as AddUserStoryOperation;
                if (!storyOp.params.specId) {
                    errors.push('Spec ID is required');
                }
                if (!storyOp.params.asA) {
                    errors.push('As a (user role) is required');
                }
                if (!storyOp.params.iWant) {
                    errors.push('I want (goal) is required');
                }
                if (!storyOp.params.soThat) {
                    errors.push('So that (benefit) is required');
                }
                break;
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    static canRetry(operation: McpOperation): boolean {
        return operation.status === McpOperationStatus.FAILED &&
               operation.retryCount < operation.maxRetries;
    }

    static shouldExpire(operation: McpOperation, maxAgeHours: number = 24): boolean {
        const operationTime = new Date(operation.timestamp).getTime();
        const now = Date.now();
        const maxAge = maxAgeHours * 60 * 60 * 1000; // Convert to milliseconds

        return (now - operationTime) > maxAge;
    }
}
