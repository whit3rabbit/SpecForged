import * as vscode from 'vscode';
import * as path from 'path';
import { McpOperationQueue, McpSyncState, McpOperationResult } from '../models/mcpOperation';

/**
 * Error types for atomic file operations
 */
export enum AtomicFileError {
    FILE_NOT_FOUND = 'FILE_NOT_FOUND',
    PERMISSION_DENIED = 'PERMISSION_DENIED',
    CONCURRENT_ACCESS = 'CONCURRENT_ACCESS',
    CORRUPTED_DATA = 'CORRUPTED_DATA',
    JSON_PARSE_ERROR = 'JSON_PARSE_ERROR',
    WORKSPACE_INVALID = 'WORKSPACE_INVALID',
    BACKUP_FAILED = 'BACKUP_FAILED',
    RESTORE_FAILED = 'RESTORE_FAILED',
    LOCK_TIMEOUT = 'LOCK_TIMEOUT',
    DISK_FULL = 'DISK_FULL',
    NETWORK_ERROR = 'NETWORK_ERROR'
}

/**
 * Custom error class for atomic file operations
 */
export class AtomicFileOperationError extends Error {
    constructor(
        public readonly errorType: AtomicFileError,
        message: string,
        public readonly filePath?: string,
        public readonly originalError?: Error,
        public readonly recoverable: boolean = true
    ) {
        super(message);
        this.name = 'AtomicFileOperationError';
    }

    /**
     * Get user-friendly error message with recovery suggestions
     */
    getUserMessage(): string {
        switch (this.errorType) {
            case AtomicFileError.FILE_NOT_FOUND:
                return `File not found: ${this.filePath}. The file may have been deleted or moved.`;

            case AtomicFileError.PERMISSION_DENIED:
                return `Permission denied accessing ${this.filePath}. Check file permissions and try again.`;

            case AtomicFileError.CONCURRENT_ACCESS:
                return `Another process is accessing ${this.filePath}. Please wait and try again.`;

            case AtomicFileError.CORRUPTED_DATA:
                return `Data corruption detected in ${this.filePath}. A backup will be restored if available.`;

            case AtomicFileError.JSON_PARSE_ERROR:
                return `Invalid JSON format in ${this.filePath}. The file may be corrupted or incomplete.`;

            case AtomicFileError.WORKSPACE_INVALID:
                return `Workspace is in an invalid state. Please check your project structure and try again.`;

            case AtomicFileError.BACKUP_FAILED:
                return `Failed to create backup of ${this.filePath}. Operation cancelled for safety.`;

            case AtomicFileError.RESTORE_FAILED:
                return `Failed to restore backup of ${this.filePath}. Manual intervention may be required.`;

            case AtomicFileError.LOCK_TIMEOUT:
                return `Timeout waiting for file lock on ${this.filePath}. Another operation may be stuck.`;

            case AtomicFileError.DISK_FULL:
                return `Insufficient disk space to complete operation on ${this.filePath}.`;

            case AtomicFileError.NETWORK_ERROR:
                return `Network error accessing ${this.filePath}. Check your connection and try again.`;

            default:
                return this.message;
        }
    }

    /**
     * Get recovery suggestions for the error
     */
    getRecoverySuggestions(): string[] {
        switch (this.errorType) {
            case AtomicFileError.FILE_NOT_FOUND:
                return [
                    'Check if the file path is correct',
                    'Verify the file hasn\'t been moved or deleted',
                    'Try refreshing the workspace'
                ];

            case AtomicFileError.PERMISSION_DENIED:
                return [
                    'Check file and directory permissions',
                    'Close any applications that might be using the file',
                    'Run VS Code with appropriate permissions'
                ];

            case AtomicFileError.CONCURRENT_ACCESS:
                return [
                    'Wait a few seconds and try again',
                    'Close other applications accessing the file',
                    'Check for stuck processes'
                ];

            case AtomicFileError.CORRUPTED_DATA:
                return [
                    'A backup will be automatically restored if available',
                    'Check the file manually for corruption',
                    'Restart the operation from a clean state'
                ];

            case AtomicFileError.JSON_PARSE_ERROR:
                return [
                    'Check the file for syntax errors',
                    'Restore from backup if available',
                    'Reinitialize the file with default content'
                ];

            case AtomicFileError.WORKSPACE_INVALID:
                return [
                    'Check that you\'re in a valid workspace',
                    'Verify the project structure is correct',
                    'Try reopening the workspace'
                ];

            default:
                return ['Try the operation again', 'Check system resources', 'Contact support if the problem persists'];
        }
    }
}

/**
 * File lock interface for managing concurrent access
 */
interface FileLock {
    filePath: string;
    lockId: string;
    acquiredAt: Date;
    expiresAt: Date;
    processId: string;
}

/**
 * Backup metadata interface
 */
interface BackupMetadata {
    originalPath: string;
    backupPath: string;
    createdAt: Date;
    fileSize: number;
    checksum: string;
}

/**
 * Configuration for atomic file operations
 */
export interface AtomicFileConfig {
    lockTimeoutMs: number;
    maxRetries: number;
    retryDelayMs: number;
    backupEnabled: boolean;
    maxBackups: number;
    checksumValidation: boolean;
    tempFilePrefix: string;
    lockFilePrefix: string;
    backupFilePrefix: string;
}

/**
 * Default configuration for atomic file operations
 */
export const defaultAtomicConfig: AtomicFileConfig = {
    lockTimeoutMs: 30000, // 30 seconds
    maxRetries: 3,
    retryDelayMs: 1000, // 1 second
    backupEnabled: true,
    maxBackups: 5,
    checksumValidation: true,
    tempFilePrefix: '.tmp',
    lockFilePrefix: '.lock',
    backupFilePrefix: '.backup'
};

/**
 * Atomic file operations utility class
 * Provides safe, concurrent file operations with backup and recovery
 */
export class AtomicFileOperations {
    private static readonly locks = new Map<string, FileLock>();
    private static readonly processId = `vscode-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    constructor(private readonly config: AtomicFileConfig = defaultAtomicConfig) {}

    /**
     * Safely read a JSON file with error handling and validation
     */
    async readJsonFile<T>(filePath: string): Promise<T> {
        const absolutePath = this.getAbsolutePath(filePath);

        try {
            // Check if file exists
            await this.ensureFileExists(absolutePath);

            // Acquire read lock
            const lockId = await this.acquireLock(absolutePath, 'read');

            try {
                // Read file content
                const content = await this.readFileContent(absolutePath);

                // Parse JSON with validation
                const data = this.parseJsonSafely<T>(content, absolutePath);

                // Validate checksum if enabled
                if (this.config.checksumValidation) {
                    await this.validateChecksum(absolutePath, content);
                }

                return data;
            } finally {
                await this.releaseLock(absolutePath, lockId);
            }
        } catch (error) {
            throw this.handleError(error, absolutePath, 'read');
        }
    }

    /**
     * Safely write a JSON file using atomic operations
     */
    async writeJsonFile<T>(filePath: string, data: T): Promise<void> {
        const absolutePath = this.getAbsolutePath(filePath);

        try {
            // Acquire write lock
            const lockId = await this.acquireLock(absolutePath, 'write');

            try {
                // Create backup if file exists and backup is enabled
                let backupMetadata: BackupMetadata | undefined;
                if (this.config.backupEnabled && await this.fileExists(absolutePath)) {
                    backupMetadata = await this.createBackup(absolutePath);
                }

                try {
                    // Perform atomic write
                    await this.atomicWrite(absolutePath, data);

                    // Clean up old backups
                    if (backupMetadata) {
                        await this.cleanupOldBackups(absolutePath);
                    }
                } catch (writeError) {
                    // Restore from backup if write failed and backup exists
                    if (backupMetadata) {
                        try {
                            await this.restoreFromBackup(backupMetadata);
                        } catch (restoreError) {
                            const errorMsg = restoreError instanceof Error ? restoreError.message : String(restoreError);
                            throw new AtomicFileOperationError(
                                AtomicFileError.RESTORE_FAILED,
                                `Write failed and backup restore failed: ${errorMsg}`,
                                absolutePath,
                                restoreError instanceof Error ? restoreError : new Error(String(restoreError)),
                                false
                            );
                        }
                    }
                    throw writeError;
                }
            } finally {
                await this.releaseLock(absolutePath, lockId);
            }
        } catch (error) {
            throw this.handleError(error, absolutePath, 'write');
        }
    }

    /**
     * Read operation queue file safely
     */
    async readOperationQueue(workspacePath: string): Promise<McpOperationQueue> {
        const queuePath = path.join(workspacePath, 'mcp-operations.json');

        try {
            return await this.readJsonFile<McpOperationQueue>(queuePath);
        } catch (error) {
            if (error instanceof AtomicFileOperationError && error.errorType === AtomicFileError.FILE_NOT_FOUND) {
                // Return empty queue if file doesn't exist
                return this.createEmptyOperationQueue();
            }
            throw error;
        }
    }

    /**
     * Write operation queue file safely
     */
    async writeOperationQueue(workspacePath: string, queue: McpOperationQueue): Promise<void> {
        const queuePath = path.join(workspacePath, 'mcp-operations.json');

        // Update metadata
        queue.lastModified = new Date().toISOString();
        queue.version = (queue.version || 0) + 1;

        await this.writeJsonFile(queuePath, queue);
    }

    /**
     * Read sync state file safely
     */
    async readSyncState(workspacePath: string): Promise<McpSyncState> {
        const syncPath = path.join(workspacePath, 'specforge-sync.json');

        try {
            return await this.readJsonFile<McpSyncState>(syncPath);
        } catch (error) {
            if (error instanceof AtomicFileOperationError && error.errorType === AtomicFileError.FILE_NOT_FOUND) {
                // Return default sync state if file doesn't exist
                return this.createDefaultSyncState();
            }
            throw error;
        }
    }

    /**
     * Write sync state file safely
     */
    async writeSyncState(workspacePath: string, syncState: McpSyncState): Promise<void> {
        const syncPath = path.join(workspacePath, 'specforge-sync.json');
        await this.writeJsonFile(syncPath, syncState);
    }

    /**
     * Read operation results file safely
     */
    async readOperationResults(workspacePath: string): Promise<{ results: McpOperationResult[]; lastUpdated: string }> {
        const resultsPath = path.join(workspacePath, 'mcp-results.json');

        try {
            return await this.readJsonFile<{ results: McpOperationResult[]; lastUpdated: string }>(resultsPath);
        } catch (error) {
            if (error instanceof AtomicFileOperationError && error.errorType === AtomicFileError.FILE_NOT_FOUND) {
                // Return empty results if file doesn't exist
                return {
                    results: [],
                    lastUpdated: new Date().toISOString()
                };
            }
            throw error;
        }
    }

    /**
     * Write operation results file safely
     */
    async writeOperationResults(
        workspacePath: string,
        results: { results: McpOperationResult[]; lastUpdated: string }
    ): Promise<void> {
        const resultsPath = path.join(workspacePath, 'mcp-results.json');

        // Update timestamp
        results.lastUpdated = new Date().toISOString();

        await this.writeJsonFile(resultsPath, results);
    }

    /**
     * Check if workspace is valid for MCP operations
     */
    async validateWorkspace(workspacePath: string): Promise<void> {
        try {
            // Check if workspace path exists and is accessible
            const workspaceUri = vscode.Uri.file(workspacePath);
            const stat = await vscode.workspace.fs.stat(workspaceUri);

            if (stat.type !== vscode.FileType.Directory) {
                throw new AtomicFileOperationError(
                    AtomicFileError.WORKSPACE_INVALID,
                    `Workspace path is not a directory: ${workspacePath}`,
                    workspacePath,
                    undefined,
                    false
                );
            }

            // Check write permissions by creating a test file
            const testPath = path.join(workspacePath, '.specforge-test');
            try {
                await vscode.workspace.fs.writeFile(
                    vscode.Uri.file(testPath),
                    new TextEncoder().encode('test')
                );
                await vscode.workspace.fs.delete(vscode.Uri.file(testPath));
            } catch (error) {
                throw new AtomicFileOperationError(
                    AtomicFileError.PERMISSION_DENIED,
                    `No write permission in workspace: ${workspacePath}`,
                    workspacePath,
                    error as Error,
                    true
                );
            }
        } catch (error) {
            if (error instanceof AtomicFileOperationError) {
                throw error;
            }

            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new AtomicFileOperationError(
                AtomicFileError.WORKSPACE_INVALID,
                `Invalid workspace: ${errorMsg}`,
                workspacePath,
                error instanceof Error ? error : new Error(String(error)),
                false
            );
        }
    }

    /**
     * Clean up temporary and lock files
     */
    async cleanup(workspacePath: string): Promise<void> {
        try {
            const workspaceUri = vscode.Uri.file(workspacePath);
            const entries = await vscode.workspace.fs.readDirectory(workspaceUri);

            for (const [name, type] of entries) {
                if (type === vscode.FileType.File && (
                    name.endsWith(this.config.tempFilePrefix) ||
                    name.endsWith(this.config.lockFilePrefix)
                )) {
                    const filePath = path.join(workspacePath, name);
                    try {
                        await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
                    } catch (error) {
                        // Ignore cleanup errors for individual files
                        console.warn(`Failed to cleanup file ${filePath}:`, error);
                    }
                }
            }
        } catch (error) {
            // Ignore cleanup errors
            console.warn(`Failed to cleanup workspace ${workspacePath}:`, error);
        }
    }

    // Private helper methods

    private getAbsolutePath(filePath: string): string {
        if (path.isAbsolute(filePath)) {
            return filePath;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new AtomicFileOperationError(
                AtomicFileError.WORKSPACE_INVALID,
                'No workspace folder found',
                filePath,
                undefined,
                false
            );
        }

        return path.join(workspaceFolder.uri.fsPath, filePath);
    }

    private async ensureFileExists(filePath: string): Promise<void> {
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
        } catch (error) {
            throw new AtomicFileOperationError(
                AtomicFileError.FILE_NOT_FOUND,
                `File not found: ${filePath}`,
                filePath,
                error as Error,
                true
            );
        }
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
            return true;
        } catch {
            return false;
        }
    }

    private async readFileContent(filePath: string): Promise<string> {
        try {
            const content = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
            return new TextDecoder().decode(content);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new AtomicFileOperationError(
                AtomicFileError.PERMISSION_DENIED,
                `Failed to read file: ${errorMsg}`,
                filePath,
                error instanceof Error ? error : new Error(String(error)),
                true
            );
        }
    }

    private parseJsonSafely<T>(content: string, filePath: string): T {
        try {
            if (!content.trim()) {
                throw new Error('Empty file content');
            }

            return JSON.parse(content) as T;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new AtomicFileOperationError(
                AtomicFileError.JSON_PARSE_ERROR,
                `Invalid JSON in file: ${errorMsg}`,
                filePath,
                error instanceof Error ? error : new Error(String(error)),
                true
            );
        }
    }

    private async atomicWrite<T>(filePath: string, data: T): Promise<void> {
        const tempPath = `${filePath}${this.config.tempFilePrefix}`;
        const content = JSON.stringify(data, null, 2);

        try {
            // Write to temporary file
            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(tempPath),
                new TextEncoder().encode(content)
            );

            // For VS Code file system, we need to delete the target first if it exists
            // then rename the temp file
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
                // File exists, delete it first
                await vscode.workspace.fs.delete(vscode.Uri.file(filePath));
            } catch {
                // File doesn't exist, which is fine
            }

            // Atomic rename
            await vscode.workspace.fs.rename(
                vscode.Uri.file(tempPath),
                vscode.Uri.file(filePath)
            );
        } catch (error) {
            // Cleanup temp file on failure
            try {
                await vscode.workspace.fs.delete(vscode.Uri.file(tempPath));
            } catch {
                // Ignore cleanup errors
            }

            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new AtomicFileOperationError(
                AtomicFileError.PERMISSION_DENIED,
                `Failed to write file atomically: ${errorMsg}`,
                filePath,
                error instanceof Error ? error : new Error(String(error)),
                true
            );
        }
    }
   private async acquireLock(filePath: string, lockType: 'read' | 'write'): Promise<string> {
        const lockId = `${AtomicFileOperations.processId}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        const lockPath = `${filePath}${this.config.lockFilePrefix}`;
        const startTime = Date.now();

        while (Date.now() - startTime < this.config.lockTimeoutMs) {
            try {
                // Check if lock file exists
                const lockExists = await this.fileExists(lockPath);

                if (!lockExists) {
                    // Create lock file
                    const lockData: FileLock = {
                        filePath,
                        lockId,
                        acquiredAt: new Date(),
                        expiresAt: new Date(Date.now() + this.config.lockTimeoutMs),
                        processId: AtomicFileOperations.processId
                    };

                    try {
                        await vscode.workspace.fs.writeFile(
                            vscode.Uri.file(lockPath),
                            new TextEncoder().encode(JSON.stringify(lockData, null, 2))
                        );

                        // Store lock in memory
                        AtomicFileOperations.locks.set(filePath, lockData);

                        return lockId;
                    } catch (error) {
                        // Lock creation failed, another process might have created it
                        continue;
                    }
                } else {
                    // Check if existing lock is expired
                    try {
                        const lockContent = await this.readFileContent(lockPath);
                        const existingLock = JSON.parse(lockContent) as FileLock;

                        if (new Date(existingLock.expiresAt) < new Date()) {
                            // Lock is expired, remove it
                            await vscode.workspace.fs.delete(vscode.Uri.file(lockPath));
                            AtomicFileOperations.locks.delete(filePath);
                            continue;
                        }

                        // Check if it's our own lock
                        if (existingLock.processId === AtomicFileOperations.processId) {
                            // Extend our own lock
                            existingLock.expiresAt = new Date(Date.now() + this.config.lockTimeoutMs);
                            await vscode.workspace.fs.writeFile(
                                vscode.Uri.file(lockPath),
                                new TextEncoder().encode(JSON.stringify(existingLock, null, 2))
                            );
                            AtomicFileOperations.locks.set(filePath, existingLock);
                            return existingLock.lockId;
                        }
                    } catch (error) {
                        // Lock file is corrupted, remove it
                        try {
                            await vscode.workspace.fs.delete(vscode.Uri.file(lockPath));
                            AtomicFileOperations.locks.delete(filePath);
                        } catch {
                            // Ignore cleanup errors
                        }
                        continue;
                    }
                }

                // Wait before retrying
                await this.sleep(this.config.retryDelayMs);
            } catch (error) {
                // Continue trying on errors
                await this.sleep(this.config.retryDelayMs);
            }
        }

        throw new AtomicFileOperationError(
            AtomicFileError.LOCK_TIMEOUT,
            `Timeout acquiring ${lockType} lock for ${filePath}`,
            filePath,
            undefined,
            true
        );
    }

    private async releaseLock(filePath: string, lockId: string): Promise<void> {
        const lockPath = `${filePath}${this.config.lockFilePrefix}`;

        try {
            // Verify we own the lock
            const lock = AtomicFileOperations.locks.get(filePath);
            if (lock && lock.lockId === lockId) {
                // Remove lock file
                await vscode.workspace.fs.delete(vscode.Uri.file(lockPath));

                // Remove from memory
                AtomicFileOperations.locks.delete(filePath);
            }
        } catch (error) {
            // Ignore lock release errors
            console.warn(`Failed to release lock for ${filePath}:`, error);
        }
    }

    private async createBackup(filePath: string): Promise<BackupMetadata> {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${filePath}${this.config.backupFilePrefix}-${timestamp}`;

        try {
            // Read original file
            const content = await this.readFileContent(filePath);
            const checksum = this.calculateChecksum(content);

            // Create backup
            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(backupPath),
                new TextEncoder().encode(content)
            );

            const metadata: BackupMetadata = {
                originalPath: filePath,
                backupPath,
                createdAt: new Date(),
                fileSize: content.length,
                checksum
            };

            return metadata;
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new AtomicFileOperationError(
                AtomicFileError.BACKUP_FAILED,
                `Failed to create backup: ${errorMsg}`,
                filePath,
                error instanceof Error ? error : new Error(String(error)),
                false
            );
        }
    }

    private async restoreFromBackup(backupMetadata: BackupMetadata): Promise<void> {
        try {
            // Read backup content
            const backupContent = await this.readFileContent(backupMetadata.backupPath);

            // Verify backup integrity
            const checksum = this.calculateChecksum(backupContent);
            if (checksum !== backupMetadata.checksum) {
                throw new Error('Backup checksum mismatch');
            }

            // Restore original file
            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(backupMetadata.originalPath),
                new TextEncoder().encode(backupContent)
            );
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new AtomicFileOperationError(
                AtomicFileError.RESTORE_FAILED,
                `Failed to restore from backup: ${errorMsg}`,
                backupMetadata.originalPath,
                error instanceof Error ? error : new Error(String(error)),
                false
            );
        }
    }

    private async cleanupOldBackups(filePath: string): Promise<void> {
        try {
            const directory = path.dirname(filePath);
            const filename = path.basename(filePath);
            const backupPattern = `${filename}${this.config.backupFilePrefix}-`;

            const directoryUri = vscode.Uri.file(directory);
            const entries = await vscode.workspace.fs.readDirectory(directoryUri);

            // Find backup files
            const backupFiles = entries
                .filter(([name, type]) => type === vscode.FileType.File && name.startsWith(backupPattern))
                .map(([name]) => ({
                    name,
                    path: path.join(directory, name),
                    timestamp: this.extractTimestampFromBackup(name, backupPattern)
                }))
                .filter(backup => backup.timestamp !== null)
                .sort((a, b) => b.timestamp!.getTime() - a.timestamp!.getTime());

            // Remove old backups (keep only maxBackups)
            if (backupFiles.length > this.config.maxBackups) {
                const filesToDelete = backupFiles.slice(this.config.maxBackups);

                for (const backup of filesToDelete) {
                    try {
                        await vscode.workspace.fs.delete(vscode.Uri.file(backup.path));
                    } catch (error) {
                        console.warn(`Failed to delete old backup ${backup.path}:`, error);
                    }
                }
            }
        } catch (error) {
            // Ignore cleanup errors
            console.warn(`Failed to cleanup old backups for ${filePath}:`, error);
        }
    }

    private extractTimestampFromBackup(filename: string, pattern: string): Date | null {
        try {
            const timestampStr = filename.substring(pattern.length);
            // Convert back from ISO format with replaced characters
            const isoStr = timestampStr.replace(/-/g, (match, offset) => {
                // Replace hyphens back to colons and dots in time portion
                if (offset > 10) { // After date portion
                    return offset === 13 || offset === 16 ? ':' :
                           offset === 19 ? '.' : '-';
                }
                return '-';
            });
            return new Date(isoStr);
        } catch {
            return null;
        }
    }

    private calculateChecksum(content: string): string {
        // Simple checksum calculation (in production, consider using crypto)
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString(16);
    }

    private async validateChecksum(filePath: string, content: string): Promise<void> {
        // In a full implementation, you might store checksums separately
        // For now, we'll just validate the JSON structure
        try {
            JSON.parse(content);
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            throw new AtomicFileOperationError(
                AtomicFileError.CORRUPTED_DATA,
                `Data corruption detected: ${errorMsg}`,
                filePath,
                error instanceof Error ? error : new Error(String(error)),
                true
            );
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private handleError(error: any, filePath: string, operation: string): AtomicFileOperationError {
        if (error instanceof AtomicFileOperationError) {
            return error;
        }

        // Map VS Code file system errors to our error types
        if (error.code === 'FileNotFound') {
            return new AtomicFileOperationError(
                AtomicFileError.FILE_NOT_FOUND,
                `File not found during ${operation}: ${filePath}`,
                filePath,
                error,
                true
            );
        }

        if (error.code === 'NoPermissions') {
            return new AtomicFileOperationError(
                AtomicFileError.PERMISSION_DENIED,
                `Permission denied during ${operation}: ${filePath}`,
                filePath,
                error,
                true
            );
        }

        if (error.message?.includes('ENOSPC') || error.message?.includes('disk full')) {
            return new AtomicFileOperationError(
                AtomicFileError.DISK_FULL,
                `Insufficient disk space during ${operation}: ${filePath}`,
                filePath,
                error,
                true
            );
        }

        if (error.message?.includes('EBUSY') || error.message?.includes('resource busy')) {
            return new AtomicFileOperationError(
                AtomicFileError.CONCURRENT_ACCESS,
                `Resource busy during ${operation}: ${filePath}`,
                filePath,
                error,
                true
            );
        }

        // Default to generic error
        return new AtomicFileOperationError(
            AtomicFileError.PERMISSION_DENIED,
            `Unexpected error during ${operation}: ${error.message}`,
            filePath,
            error,
            true
        );
    }

    private createEmptyOperationQueue(): McpOperationQueue {
        return {
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
    }

    private createDefaultSyncState(): McpSyncState {
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

/**
 * Retry utility with exponential backoff for atomic file operations
 */
export class AtomicFileRetryManager {
    static async withRetry<T>(
        operation: () => Promise<T>,
        config: AtomicFileConfig = defaultAtomicConfig,
        context?: string
    ): Promise<T> {
        let lastError: Error | undefined;

        for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error as Error;

                // Don't retry non-recoverable errors
                if (error instanceof AtomicFileOperationError && !error.recoverable) {
                    throw error;
                }

                // Don't retry on last attempt
                if (attempt === config.maxRetries) {
                    break;
                }

                // Calculate delay with exponential backoff
                const delay = config.retryDelayMs * Math.pow(2, attempt);
                const jitter = Math.random() * 0.1 * delay; // Add 10% jitter
                const totalDelay = Math.min(delay + jitter, 30000); // Cap at 30 seconds

                console.warn(`Retry attempt ${attempt + 1}/${config.maxRetries} for ${context || 'operation'} after ${totalDelay}ms:`, error);

                await new Promise(resolve => setTimeout(resolve, totalDelay));
            }
        }

        throw lastError;
    }
}

/**
 * Utility functions for atomic file operations
 */
export class AtomicFileUtils {
    /**
     * Get the workspace path for MCP operations
     */
    static getWorkspacePath(): string {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new AtomicFileOperationError(
                AtomicFileError.WORKSPACE_INVALID,
                'No workspace folder found',
                undefined,
                undefined,
                false
            );
        }
        return workspaceFolder.uri.fsPath;
    }

    /**
     * Check if a path is within the workspace
     */
    static isPathInWorkspace(filePath: string): boolean {
        try {
            const workspacePath = this.getWorkspacePath();
            const absolutePath = path.resolve(filePath);
            const workspaceAbsolutePath = path.resolve(workspacePath);

            return absolutePath.startsWith(workspaceAbsolutePath);
        } catch {
            return false;
        }
    }

    /**
     * Sanitize file path to prevent directory traversal
     */
    static sanitizePath(filePath: string): string {
        // Remove any path traversal attempts
        const sanitized = filePath.replace(/\.\./g, '').replace(/\/+/g, '/');

        // Ensure it's a relative path within workspace
        if (path.isAbsolute(sanitized)) {
            throw new AtomicFileOperationError(
                AtomicFileError.WORKSPACE_INVALID,
                `Absolute paths not allowed: ${filePath}`,
                filePath,
                undefined,
                false
            );
        }

        return sanitized;
    }

    /**
     * Get file extension for MCP operation files
     */
    static getMcpFilePaths(workspacePath: string) {
        return {
            operationQueue: path.join(workspacePath, 'mcp-operations.json'),
            syncState: path.join(workspacePath, 'specforge-sync.json'),
            operationResults: path.join(workspacePath, 'mcp-results.json')
        };
    }
}
