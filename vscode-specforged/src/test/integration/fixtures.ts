/**
 * Test fixtures and utilities for TypeScript integration tests.
 *
 * This module provides shared fixtures, utilities, and helpers for setting up
 * complex integration test scenarios for the VS Code extension.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { spawn, ChildProcess } from 'child_process';

import { McpSyncService } from '../../services/mcpSyncService';
import { FileOperationService } from '../../services/fileOperationService';
import { McpManager } from '../../mcp/mcpManager';
import { NotificationManager } from '../../services/notificationManager';
import {
    McpOperation,
    McpOperationStatus,
    McpOperationType,
    McpOperationPriority,
    McpOperationFactory,
    McpOperationUtils,
    McpSyncState,
    McpOperationQueue,
    McpOperationResult
} from '../../models/mcpOperation';
import { AtomicFileOperations } from '../../utils/atomicFileOperations';
import { ConflictResolver } from '../../utils/conflictResolver';

/**
 * Integration test workspace that simulates a complete VS Code + MCP server environment.
 */
export class IntegrationTestWorkspace {
    public readonly workspaceDir: string;
    public readonly specsDir: string;
    public readonly tempDir: string;

    // IPC file paths
    public readonly queueFile: string;
    public readonly resultsFile: string;
    public readonly syncFile: string;

    // VS Code extension components
    public mcpSyncService?: McpSyncService;
    public fileOperationService?: FileOperationService;
    public mcpManager?: McpManager;
    public notificationManager?: NotificationManager;

    // Mock MCP server process
    public mcpServerProcess?: ChildProcess;
    public isServerOnline: boolean = false;

    // Test state tracking
    public operationResults: McpOperationResult[] = [];
    public queuedOperations: McpOperation[] = [];
    public fileChanges: Array<{path: string, type: string, timestamp: Date}> = [];
    public notifications: Array<{type: string, message: string, timestamp: Date}> = [];

    constructor(workspaceDir: string) {
        this.workspaceDir = workspaceDir;
        this.specsDir = path.join(workspaceDir, 'specifications');
        this.tempDir = path.join(workspaceDir, '.test-temp');

        this.queueFile = path.join(workspaceDir, 'mcp-operations.json');
        this.resultsFile = path.join(workspaceDir, 'mcp-results.json');
        this.syncFile = path.join(workspaceDir, 'specforge-sync.json');
    }

    /**
     * Set up the integration test workspace with all components.
     */
    async setup(): Promise<void> {
        // Create directory structure
        await fs.mkdir(this.workspaceDir, { recursive: true });
        await fs.mkdir(this.specsDir, { recursive: true });
        await fs.mkdir(this.tempDir, { recursive: true });

        // Initialize VS Code extension components
        this.fileOperationService = new FileOperationService();
        this.mcpManager = new McpManager();
        this.notificationManager = new NotificationManager();

        // Initialize MCP sync service
        this.mcpSyncService = new McpSyncService(this.fileOperationService);
        this.mcpSyncService.setMcpManager(this.mcpManager);
        this.mcpSyncService.setNotificationManager(this.notificationManager);

        // Create initial sync state
        await this.createInitialSyncState();

        // Set up file monitoring
        this.setupFileMonitoring();
    }

    /**
     * Clean up the test workspace.
     */
    async cleanup(): Promise<void> {
        // Stop MCP server if running
        if (this.mcpServerProcess) {
            await this.stopMcpServer();
        }

        // Dispose extension components
        if (this.mcpSyncService) {
            this.mcpSyncService.dispose();
        }

        if (this.notificationManager) {
            this.notificationManager.dispose();
        }

        // Clean up workspace directory
        try {
            await fs.rm(this.workspaceDir, { recursive: true, force: true });
        } catch (error) {
            // Ignore cleanup errors
            console.warn(`Cleanup warning: ${error}`);
        }
    }

    /**
     * Start a mock MCP server process for testing.
     */
    async startMcpServer(serverType: 'local' | 'mock' = 'mock'): Promise<void> {
        if (this.mcpServerProcess) {
            await this.stopMcpServer();
        }

        if (serverType === 'mock') {
            // Start mock Python server for testing
            const mockServerScript = path.join(__dirname, 'mock-mcp-server.py');
            this.mcpServerProcess = spawn('python', [mockServerScript, this.workspaceDir], {
                stdio: 'pipe',
                cwd: this.workspaceDir
            });

            this.mcpServerProcess.stdout?.on('data', (data) => {
                console.log(`Mock MCP Server: ${data}`);
            });

            this.mcpServerProcess.stderr?.on('data', (data) => {
                console.error(`Mock MCP Server Error: ${data}`);
            });

            // Wait for server to start
            await this.waitForCondition(() => this.isServerOnline, 5000);
        } else {
            // Start actual SpecForge MCP server
            this.mcpServerProcess = spawn('python', ['-m', 'specforged.main'], {
                stdio: 'pipe',
                cwd: this.workspaceDir,
                env: { ...process.env, SPECFORGED_PROJECT_ROOT: this.workspaceDir }
            });

            // Wait for server startup
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        this.isServerOnline = true;
    }

    /**
     * Stop the MCP server process.
     */
    async stopMcpServer(): Promise<void> {
        if (this.mcpServerProcess) {
            this.mcpServerProcess.kill();
            this.mcpServerProcess = undefined;
        }
        this.isServerOnline = false;
    }

    /**
     * Initialize the MCP sync service.
     */
    async initializeSyncService(): Promise<void> {
        if (!this.mcpSyncService) {
            throw new Error('MCP sync service not initialized');
        }

        // Mock workspace folders for testing
        const mockWorkspaceFolder: vscode.WorkspaceFolder = {
            uri: vscode.Uri.file(this.workspaceDir),
            name: 'integration-test-workspace',
            index: 0
        };

        // Override workspace folders
        Object.defineProperty(vscode.workspace, 'workspaceFolders', {
            value: [mockWorkspaceFolder],
            configurable: true
        });

        await this.mcpSyncService.initialize();
    }

    /**
     * Queue an operation through the extension.
     */
    async queueOperation(operation: McpOperation): Promise<void> {
        if (!this.mcpSyncService) {
            throw new Error('MCP sync service not initialized');
        }

        this.queuedOperations.push(operation);
        await this.mcpSyncService.queueOperation(operation);
    }

    /**
     * Process all queued operations.
     */
    async processOperations(): Promise<void> {
        if (!this.mcpSyncService) {
            throw new Error('MCP sync service not initialized');
        }

        await this.mcpSyncService.processOperations();
    }

    /**
     * Simulate an operation from the VS Code extension UI.
     */
    async simulateExtensionOperation(
        operationType: McpOperationType,
        params: any,
        priority: McpOperationPriority = McpOperationPriority.NORMAL
    ): Promise<string> {
        const operation = McpOperationFactory.createOperation(operationType, params, { priority });
        await this.queueOperation(operation);
        return operation.id;
    }

    /**
     * Simulate external file modification (user editing files directly).
     */
    async simulateFileModification(
        specId: string,
        fileName: string,
        newContent: string,
        delayMs: number = 0
    ): Promise<void> {
        if (delayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }

        const filePath = path.join(this.specsDir, specId, fileName);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, newContent, 'utf8');

        this.fileChanges.push({
            path: filePath,
            type: 'external_modification',
            timestamp: new Date()
        });
    }

    /**
     * Get current sync state.
     */
    getSyncState(): McpSyncState {
        if (!this.mcpSyncService) {
            throw new Error('MCP sync service not initialized');
        }

        return this.mcpSyncService.getSyncState();
    }

    /**
     * Get current operation queue.
     */
    getOperationQueue(): McpOperationQueue {
        if (!this.mcpSyncService) {
            throw new Error('MCP sync service not initialized');
        }

        return this.mcpSyncService.getOperationQueue();
    }

    /**
     * Wait for an operation to complete.
     */
    async waitForOperationCompletion(
        operationId: string,
        timeoutMs: number = 10000
    ): Promise<McpOperationResult | null> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            const queue = this.getOperationQueue();
            const operation = queue.operations.find(op => op.id === operationId);

            if (operation && operation.status === McpOperationStatus.COMPLETED) {
                // Look for result
                if (fsSync.existsSync(this.resultsFile)) {
                    const resultsData = JSON.parse(await fs.readFile(this.resultsFile, 'utf8'));
                    const result = resultsData.results?.find((r: any) => r.operationId === operationId);
                    if (result) {
                        return result as McpOperationResult;
                    }
                }

                // Return synthetic result if no explicit result found
                return {
                    operationId,
                    success: true,
                    message: 'Operation completed',
                    timestamp: new Date().toISOString(),
                    processingTimeMs: 0,
                    retryable: false
                };
            }

            if (operation && operation.status === McpOperationStatus.FAILED) {
                return {
                    operationId,
                    success: false,
                    message: operation.error || 'Operation failed',
                    timestamp: new Date().toISOString(),
                    processingTimeMs: 0,
                    retryable: false
                };
            }

            await new Promise(resolve => setTimeout(resolve, 100));
        }

        return null;
    }

    /**
     * Simulate server going offline for a period.
     */
    async simulateServerOffline(durationMs: number): Promise<void> {
        // Mark server as offline in sync state
        const syncState = this.getSyncState();
        syncState.mcpServerOnline = false;

        // Update sync file
        await fs.writeFile(this.syncFile, JSON.stringify(syncState, null, 2));

        // Wait for offline period
        await new Promise(resolve => setTimeout(resolve, durationMs));

        // Mark server back online
        syncState.mcpServerOnline = true;
        syncState.lastSync = new Date().toISOString();
        await fs.writeFile(this.syncFile, JSON.stringify(syncState, null, 2));
    }

    /**
     * Create a test specification with files.
     */
    async createTestSpecification(
        specId: string,
        name: string,
        includeFiles: boolean = true
    ): Promise<void> {
        const specDir = path.join(this.specsDir, specId);
        await fs.mkdir(specDir, { recursive: true });

        // Create spec.json
        const spec = {
            id: specId,
            name,
            description: `Test specification: ${name}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            workflow_phase: 'requirements'
        };

        await fs.writeFile(path.join(specDir, 'spec.json'), JSON.stringify(spec, null, 2));

        if (includeFiles) {
            // Create requirements.md
            const requirements = `# Requirements for ${name}

## User Story 1
**As a** test user
**I want** to verify the integration
**So that** the system works correctly

### Acceptance Criteria
- THE SYSTEM SHALL process test operations
- WHEN tests run THE SYSTEM SHALL return results
- IF errors occur THEN THE SYSTEM SHALL handle gracefully
`;

            // Create design.md
            const design = `# Design for ${name}

## Architecture
This is a test specification for integration testing.

## Components
- Test Component A
- Test Component B

## Data Models
- TestModel: Test data structure
`;

            // Create tasks.md
            const tasks = `# Implementation Plan for ${name}

## Progress Summary
- **Total Tasks:** 3
- **Completed:** 0
- **Pending:** 3
- **Progress:** 0%

- [ ] 1. Set up test infrastructure
- [ ] 2. Implement test functionality
- [ ] 3. Validate test results
`;

            await fs.writeFile(path.join(specDir, 'requirements.md'), requirements);
            await fs.writeFile(path.join(specDir, 'design.md'), design);
            await fs.writeFile(path.join(specDir, 'tasks.md'), tasks);
        }
    }

    /**
     * Wait for a condition to become true.
     */
    async waitForCondition(
        condition: () => boolean,
        timeoutMs: number = 5000,
        intervalMs: number = 100
    ): Promise<boolean> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            if (condition()) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }

        return false;
    }

    /**
     * Create initial sync state file.
     */
    private async createInitialSyncState(): Promise<void> {
        const syncState: McpSyncState = {
            extensionOnline: true,
            mcpServerOnline: false,
            lastSync: new Date().toISOString(),
            lastHeartbeat: new Date().toISOString(),
            pendingOperations: 0,
            inProgressOperations: 0,
            failedOperations: 0,
            completedOperations: 0,
            activeConflicts: 0,
            specifications: [],
            syncErrors: [],
            performance: {
                averageOperationTimeMs: 0,
                lastProcessingDuration: 0,
                queueProcessingRate: 0
            }
        };

        await fs.writeFile(this.syncFile, JSON.stringify(syncState, null, 2));
    }

    /**
     * Set up file monitoring for tests.
     */
    private setupFileMonitoring(): void {
        // This would set up file watchers in a real implementation
        // For testing, we'll track changes manually
    }
}

/**
 * Mock MCP server for integration testing.
 */
export class MockMcpServer {
    private workspace: IntegrationTestWorkspace;
    private processingDelay: number = 100; // ms
    private failureRate: number = 0.0; // 0.0 - 1.0
    private isRunning: boolean = false;
    private processingInterval?: NodeJS.Timeout;

    constructor(workspace: IntegrationTestWorkspace) {
        this.workspace = workspace;
    }

    /**
     * Start the mock server.
     */
    async start(): Promise<void> {
        this.isRunning = true;

        // Start processing loop
        this.processingInterval = setInterval(async () => {
            await this.processOperations();
        }, this.processingDelay);

        console.log('Mock MCP server started');
    }

    /**
     * Stop the mock server.
     */
    async stop(): Promise<void> {
        this.isRunning = false;

        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = undefined;
        }

        console.log('Mock MCP server stopped');
    }

    /**
     * Set processing delay.
     */
    setProcessingDelay(delayMs: number): void {
        this.processingDelay = delayMs;
    }

    /**
     * Set operation failure rate.
     */
    setFailureRate(rate: number): void {
        this.failureRate = Math.max(0, Math.min(1, rate));
    }

    /**
     * Process queued operations.
     */
    private async processOperations(): Promise<void> {
        if (!this.isRunning) {
            return;
        }

        try {
            // Read operation queue
            if (!fsSync.existsSync(this.workspace.queueFile)) {
                return;
            }

            const queueData = JSON.parse(await fs.readFile(this.workspace.queueFile, 'utf8'));
            const pendingOps = queueData.operations?.filter((op: any) =>
                op.status === McpOperationStatus.PENDING
            ) || [];

            if (pendingOps.length === 0) {
                return;
            }

            // Process one operation at a time
            const operation = pendingOps[0];
            const shouldFail = Math.random() < this.failureRate;

            // Update operation status
            operation.status = McpOperationStatus.IN_PROGRESS;
            operation.startedAt = new Date().toISOString();

            // Save updated queue
            await fs.writeFile(this.workspace.queueFile, JSON.stringify(queueData, null, 2));

            // Simulate processing time
            await new Promise(resolve => setTimeout(resolve, this.processingDelay));

            // Generate result
            const result: McpOperationResult = {
                operationId: operation.id,
                success: !shouldFail,
                message: shouldFail ? 'Mock operation failed' : 'Mock operation completed successfully',
                timestamp: new Date().toISOString(),
                processingTimeMs: this.processingDelay,
                retryable: shouldFail
            };

            if (shouldFail) {
                result.error = {
                    code: 'MOCK_ERROR',
                    message: 'Simulated failure',
                    details: null
                };
            }

            // Update operation status
            operation.status = shouldFail ? McpOperationStatus.FAILED : McpOperationStatus.COMPLETED;
            operation.completedAt = new Date().toISOString();
            operation.actualDurationMs = this.processingDelay;

            if (shouldFail) {
                operation.error = 'Simulated failure';
                operation.retryCount = (operation.retryCount || 0) + 1;
            }

            // Save final queue state
            await fs.writeFile(this.workspace.queueFile, JSON.stringify(queueData, null, 2));

            // Save result
            await this.saveOperationResult(result);

        } catch (error) {
            console.error('Mock server processing error:', error);
        }
    }

    /**
     * Save operation result.
     */
    private async saveOperationResult(result: McpOperationResult): Promise<void> {
        let results: McpOperationResult[] = [];

        try {
            if (fsSync.existsSync(this.workspace.resultsFile)) {
                const resultsData = JSON.parse(await fs.readFile(this.workspace.resultsFile, 'utf8'));
                results = resultsData.results || [];
            }
        } catch {
            // File doesn't exist or is invalid, start fresh
        }

        results.push(result);

        // Keep only last 100 results
        if (results.length > 100) {
            results = results.slice(-100);
        }

        const resultsData = {
            results,
            lastUpdated: new Date().toISOString()
        };

        await fs.writeFile(this.workspace.resultsFile, JSON.stringify(resultsData, null, 2));
    }
}

/**
 * Performance monitor for integration tests.
 */
export class IntegrationPerformanceMonitor {
    private operationTimes: number[] = [];
    private queueSizes: number[] = [];
    private startTime?: number;
    private endTime?: number;

    /**
     * Start monitoring.
     */
    startMonitoring(): void {
        this.startTime = Date.now();
        this.operationTimes = [];
        this.queueSizes = [];
    }

    /**
     * Stop monitoring.
     */
    stopMonitoring(): void {
        this.endTime = Date.now();
    }

    /**
     * Record operation time.
     */
    recordOperationTime(timeMs: number): void {
        this.operationTimes.push(timeMs);
    }

    /**
     * Record queue size.
     */
    recordQueueSize(size: number): void {
        this.queueSizes.push(size);
    }

    /**
     * Get performance report.
     */
    getPerformanceReport(): any {
        const totalTime = (this.endTime || Date.now()) - (this.startTime || 0);

        return {
            totalTestTime: totalTime,
            operationsProcessed: this.operationTimes.length,
            averageOperationTime: this.operationTimes.length > 0 ?
                this.operationTimes.reduce((a, b) => a + b, 0) / this.operationTimes.length : 0,
            minOperationTime: this.operationTimes.length > 0 ? Math.min(...this.operationTimes) : 0,
            maxOperationTime: this.operationTimes.length > 0 ? Math.max(...this.operationTimes) : 0,
            averageQueueSize: this.queueSizes.length > 0 ?
                this.queueSizes.reduce((a, b) => a + b, 0) / this.queueSizes.length : 0,
            maxQueueSize: this.queueSizes.length > 0 ? Math.max(...this.queueSizes) : 0,
            operationsPerSecond: totalTime > 0 ? (this.operationTimes.length / totalTime) * 1000 : 0
        };
    }
}

/**
 * Operation builder for creating complex test operations.
 */
export class IntegrationOperationBuilder {
    private operation: Partial<McpOperation> = {};

    static create(): IntegrationOperationBuilder {
        return new IntegrationOperationBuilder();
    }

    withType(type: McpOperationType): IntegrationOperationBuilder {
        this.operation.type = type;
        return this;
    }

    withParams(params: any): IntegrationOperationBuilder {
        this.operation.params = { ...this.operation.params, ...params };
        return this;
    }

    withPriority(priority: McpOperationPriority): IntegrationOperationBuilder {
        this.operation.priority = priority;
        return this;
    }

    withDependencies(...operationIds: string[]): IntegrationOperationBuilder {
        this.operation.dependencies = operationIds;
        return this;
    }

    withRetryConfig(maxRetries: number): IntegrationOperationBuilder {
        this.operation.maxRetries = maxRetries;
        return this;
    }

    build(): McpOperation {
        const fullOperation = {
            id: `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: this.operation.type || McpOperationType.HEARTBEAT,
            status: McpOperationStatus.PENDING,
            priority: this.operation.priority || McpOperationPriority.NORMAL,
            timestamp: new Date().toISOString(),
            params: this.operation.params || {},
            retryCount: 0,
            maxRetries: this.operation.maxRetries || 3,
            dependencies: this.operation.dependencies || [],
            source: 'extension'
        };

        return fullOperation as McpOperation;
    }
}

/**
 * Utility functions for integration tests.
 */
export class IntegrationTestUtils {
    /**
     * Create multiple conflicting operations.
     */
    static createConflictingOperations(
        specId: string,
        operationCount: number = 3,
        timeIntervalMs: number = 1000
    ): McpOperation[] {
        const operations: McpOperation[] = [];
        const baseTime = Date.now();

        for (let i = 0; i < operationCount; i++) {
            const operation = IntegrationOperationBuilder
                .create()
                .withType(McpOperationType.UPDATE_REQUIREMENTS)
                .withParams({
                    specId,
                    content: `Conflicting requirements content version ${i}`
                })
                .withPriority(McpOperationPriority.NORMAL)
                .build();

            // Set different timestamps
            operation.timestamp = new Date(baseTime + (i * timeIntervalMs)).toISOString();
            operation.id = `conflict_op_${i}_${specId}`;

            operations.push(operation);
        }

        return operations;
    }

    /**
     * Wait for a condition with timeout.
     */
    static async waitForCondition(
        condition: () => Promise<boolean> | boolean,
        timeoutMs: number = 5000,
        intervalMs: number = 100
    ): Promise<boolean> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeoutMs) {
            if (await condition()) {
                return true;
            }
            await new Promise(resolve => setTimeout(resolve, intervalMs));
        }

        return false;
    }

    /**
     * Generate test data for stress testing.
     */
    static generateTestOperations(count: number): McpOperation[] {
        const operations: McpOperation[] = [];

        for (let i = 0; i < count; i++) {
            const operationType = [
                McpOperationType.CREATE_SPEC,
                McpOperationType.UPDATE_REQUIREMENTS,
                McpOperationType.UPDATE_DESIGN,
                McpOperationType.ADD_USER_STORY
            ][i % 4];

            let params: any;
            switch (operationType) {
                case McpOperationType.CREATE_SPEC:
                    params = {
                        name: `Test Spec ${i}`,
                        specId: `test-spec-${i.toString().padStart(3, '0')}`
                    };
                    break;
                case McpOperationType.UPDATE_REQUIREMENTS:
                    params = {
                        specId: `test-spec-${Math.max(0, i - 1).toString().padStart(3, '0')}`,
                        content: `Test requirements for operation ${i}`
                    };
                    break;
                case McpOperationType.UPDATE_DESIGN:
                    params = {
                        specId: `test-spec-${Math.max(0, i - 1).toString().padStart(3, '0')}`,
                        content: `Test design for operation ${i}`
                    };
                    break;
                case McpOperationType.ADD_USER_STORY:
                    params = {
                        specId: `test-spec-${Math.max(0, i - 1).toString().padStart(3, '0')}`,
                        userStory: {
                            as_a: `test user ${i}`,
                            i_want: `functionality ${i}`,
                            so_that: `requirement ${i} is satisfied`
                        }
                    };
                    break;
            }

            const operation = IntegrationOperationBuilder
                .create()
                .withType(operationType)
                .withParams(params)
                .withPriority([
                    McpOperationPriority.LOW,
                    McpOperationPriority.NORMAL,
                    McpOperationPriority.HIGH,
                    McpOperationPriority.URGENT
                ][i % 4])
                .build();

            operations.push(operation);
        }

        return operations;
    }
}
