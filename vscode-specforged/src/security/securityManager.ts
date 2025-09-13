/**
 * Security manager for the SpecForge VS Code extension.
 * 
 * Provides centralized security controls, rate limiting, and audit logging
 * for all MCP operations initiated from the extension.
 */

import * as vscode from 'vscode';
import { InputValidator, ValidationResult } from './inputValidator';
import { McpOperation, McpOperationType } from '../models/mcpOperation';

export interface SecurityConfig {
    enableInputValidation: boolean;
    enableRateLimiting: boolean;
    enableAuditLogging: boolean;
    maxOperationsPerMinute: number;
    maxConcurrentOperations: number;
    blockSuspiciousActivity: boolean;
    alertOnSecurityEvents: boolean;
}

export interface SecurityEvent {
    id: string;
    type: SecurityEventType;
    severity: SecuritySeverity;
    timestamp: Date;
    message: string;
    details: any;
    operation?: McpOperation;
}

export enum SecurityEventType {
    VALIDATION_FAILURE = 'validation_failure',
    RATE_LIMIT_EXCEEDED = 'rate_limit_exceeded',
    SUSPICIOUS_ACTIVITY = 'suspicious_activity',
    INJECTION_ATTEMPT = 'injection_attempt',
    PATH_TRAVERSAL_ATTEMPT = 'path_traversal_attempt',
    OPERATION_BLOCKED = 'operation_blocked',
    SECURITY_ALERT = 'security_alert'
}

export enum SecuritySeverity {
    DEBUG = 'debug',
    INFO = 'info',
    WARNING = 'warning',
    ERROR = 'error',
    CRITICAL = 'critical'
}

interface RateLimitState {
    operations: Date[];
    blockedUntil?: Date;
    violationCount: number;
}

export class SecurityManager {
    private config: SecurityConfig;
    private rateLimitState: RateLimitState;
    private securityEvents: SecurityEvent[];
    private concurrentOperations: number;
    private outputChannel: vscode.OutputChannel;

    constructor(context: vscode.ExtensionContext) {
        this.config = this.loadSecurityConfig();
        this.rateLimitState = {
            operations: [],
            violationCount: 0
        };
        this.securityEvents = [];
        this.concurrentOperations = 0;
        this.outputChannel = vscode.window.createOutputChannel('SpecForge Security', 'log');
        
        // Register security commands
        this.registerSecurityCommands(context);

        // Clean up old rate limit entries periodically
        setInterval(() => this.cleanupRateLimitState(), 60000); // Every minute
    }

    /**
     * Validate and secure an operation before execution.
     */
    async validateOperation(operation: McpOperation): Promise<ValidationResult> {
        const validationResult: ValidationResult = {
            valid: true,
            errors: [],
            warnings: []
        };

        try {
            // Check if security is enabled
            if (!this.config.enableInputValidation) {
                return validationResult;
            }

            // Input validation
            const inputValidation = InputValidator.validateOperationParams(
                operation.type,
                operation.params
            );

            validationResult.errors.push(...inputValidation.errors);
            validationResult.warnings.push(...inputValidation.warnings);

            if (inputValidation.sanitizedData) {
                validationResult.sanitizedData = inputValidation.sanitizedData;
            }

            // Check for injection attempts
            if (inputValidation.errors.some(error => error.code.includes('INJECTION_ATTEMPT'))) {
                await this.logSecurityEvent({
                    type: SecurityEventType.INJECTION_ATTEMPT,
                    severity: SecuritySeverity.ERROR,
                    message: `Injection attempt detected in operation ${operation.type}`,
                    details: {
                        operation: operation,
                        validationErrors: inputValidation.errors
                    },
                    operation
                });

                if (this.config.blockSuspiciousActivity) {
                    validationResult.valid = false;
                }
            }

            // Rate limiting check
            if (this.config.enableRateLimiting) {
                const rateLimitCheck = await this.checkRateLimit(operation);
                if (!rateLimitCheck.allowed) {
                    validationResult.valid = false;
                    validationResult.errors.push({
                        field: 'rate_limit',
                        message: `Rate limit exceeded. Try again in ${rateLimitCheck.retryAfter} seconds.`,
                        code: 'RATE_LIMIT_EXCEEDED',
                        severity: 'error'
                    });

                    await this.logSecurityEvent({
                        type: SecurityEventType.RATE_LIMIT_EXCEEDED,
                        severity: SecuritySeverity.WARNING,
                        message: 'Operation rate limit exceeded',
                        details: {
                            operation: operation,
                            retryAfter: rateLimitCheck.retryAfter
                        },
                        operation
                    });
                }
            }

            // Concurrent operations check
            if (this.concurrentOperations >= this.config.maxConcurrentOperations) {
                validationResult.valid = false;
                validationResult.errors.push({
                    field: 'concurrency',
                    message: `Too many concurrent operations. Maximum allowed: ${this.config.maxConcurrentOperations}`,
                    code: 'CONCURRENCY_LIMIT_EXCEEDED',
                    severity: 'error'
                });
            }

            validationResult.valid = validationResult.errors.length === 0;

            // Log validation results
            if (validationResult.errors.length > 0) {
                await this.logSecurityEvent({
                    type: SecurityEventType.VALIDATION_FAILURE,
                    severity: SecuritySeverity.WARNING,
                    message: `Operation validation failed: ${validationResult.errors.map(e => e.message).join(', ')}`,
                    details: {
                        operation: operation,
                        errors: validationResult.errors,
                        warnings: validationResult.warnings
                    },
                    operation
                });
            }

            return validationResult;

        } catch (error) {
            validationResult.valid = false;
            validationResult.errors.push({
                field: 'security',
                message: `Security validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                code: 'SECURITY_ERROR',
                severity: 'error'
            });

            await this.logSecurityEvent({
                type: SecurityEventType.SECURITY_ALERT,
                severity: SecuritySeverity.ERROR,
                message: 'Security validation encountered an error',
                details: { error: error instanceof Error ? error.message : 'Unknown error' }
            });

            return validationResult;
        }
    }

    /**
     * Track operation execution for security monitoring.
     */
    async trackOperationStart(operation: McpOperation): Promise<void> {
        this.concurrentOperations++;
        
        if (this.config.enableAuditLogging) {
            await this.logSecurityEvent({
                type: SecurityEventType.SECURITY_ALERT,
                severity: SecuritySeverity.DEBUG,
                message: `Operation started: ${operation.type}`,
                details: { operation },
                operation
            });
        }
    }

    /**
     * Track operation completion.
     */
    async trackOperationComplete(operation: McpOperation, success: boolean, error?: any): Promise<void> {
        this.concurrentOperations = Math.max(0, this.concurrentOperations - 1);
        
        if (this.config.enableAuditLogging) {
            await this.logSecurityEvent({
                type: SecurityEventType.SECURITY_ALERT,
                severity: success ? SecuritySeverity.DEBUG : SecuritySeverity.WARNING,
                message: `Operation ${success ? 'completed' : 'failed'}: ${operation.type}`,
                details: { 
                    operation, 
                    success, 
                    error: error ? (error instanceof Error ? error.message : error) : undefined 
                },
                operation
            });
        }

        // Detect suspicious patterns
        if (!success && error) {
            await this.detectSuspiciousActivity(operation, error);
        }
    }

    private async checkRateLimit(operation: McpOperation): Promise<{ allowed: boolean; retryAfter: number }> {
        const now = new Date();
        
        // Check if currently blocked
        if (this.rateLimitState.blockedUntil && now < this.rateLimitState.blockedUntil) {
            const retryAfter = Math.ceil((this.rateLimitState.blockedUntil.getTime() - now.getTime()) / 1000);
            return { allowed: false, retryAfter };
        }

        // Clean up old operations (older than 1 minute)
        const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
        this.rateLimitState.operations = this.rateLimitState.operations.filter(
            opTime => opTime > oneMinuteAgo
        );

        // Check rate limit
        if (this.rateLimitState.operations.length >= this.config.maxOperationsPerMinute) {
            // Rate limit exceeded
            this.rateLimitState.violationCount++;
            
            // Increase blocking time based on violation count
            const blockDuration = Math.min(
                300, // Max 5 minutes
                Math.pow(2, this.rateLimitState.violationCount - 1) * 10 // Exponential backoff
            );
            
            this.rateLimitState.blockedUntil = new Date(now.getTime() + blockDuration * 1000);
            
            return { allowed: false, retryAfter: blockDuration };
        }

        // Allow operation and record it
        this.rateLimitState.operations.push(now);
        return { allowed: true, retryAfter: 0 };
    }

    private cleanupRateLimitState(): void {
        const now = new Date();
        const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
        
        // Clean up old operations
        this.rateLimitState.operations = this.rateLimitState.operations.filter(
            opTime => opTime > oneMinuteAgo
        );

        // Reset violation count if no violations in last 5 minutes
        if (this.rateLimitState.blockedUntil && now > this.rateLimitState.blockedUntil) {
            const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
            if (!this.rateLimitState.blockedUntil || this.rateLimitState.blockedUntil < fiveMinutesAgo) {
                this.rateLimitState.violationCount = 0;
            }
        }
    }

    private async detectSuspiciousActivity(operation: McpOperation, error: any): Promise<void> {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const suspiciousPatterns = [
            /path.*traversal/i,
            /unauthorized/i,
            /access.*denied/i,
            /permission/i,
            /injection/i,
            /malicious/i
        ];

        const isSuspicious = suspiciousPatterns.some(pattern => pattern.test(errorMessage));
        
        if (isSuspicious) {
            await this.logSecurityEvent({
                type: SecurityEventType.SUSPICIOUS_ACTIVITY,
                severity: SecuritySeverity.WARNING,
                message: `Suspicious activity detected in operation ${operation.type}`,
                details: {
                    operation,
                    error: errorMessage
                },
                operation
            });

            if (this.config.alertOnSecurityEvents) {
                await this.showSecurityAlert(
                    'Suspicious Activity Detected',
                    `A potentially malicious operation was blocked: ${operation.type}`
                );
            }
        }
    }

    private async logSecurityEvent(eventData: Omit<SecurityEvent, 'id' | 'timestamp'>): Promise<void> {
        const event: SecurityEvent = {
            id: this.generateEventId(),
            timestamp: new Date(),
            ...eventData
        };

        this.securityEvents.push(event);

        // Keep only last 1000 events to prevent memory issues
        if (this.securityEvents.length > 1000) {
            this.securityEvents = this.securityEvents.slice(-1000);
        }

        // Log to output channel
        const logLevel = event.severity.toUpperCase();
        const message = `[${logLevel}] ${event.message}`;
        this.outputChannel.appendLine(`${event.timestamp.toISOString()} - ${message}`);

        // Show critical events as notifications
        if (event.severity === SecuritySeverity.CRITICAL && this.config.alertOnSecurityEvents) {
            await this.showSecurityAlert('Critical Security Event', event.message);
        }
    }

    private generateEventId(): string {
        return `sec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    private async showSecurityAlert(title: string, message: string): Promise<void> {
        const action = await vscode.window.showWarningMessage(
            message,
            { modal: false },
            'View Security Log',
            'Security Settings'
        );

        if (action === 'View Security Log') {
            this.outputChannel.show();
        } else if (action === 'Security Settings') {
            vscode.commands.executeCommand('specforge.openSecuritySettings');
        }
    }

    private loadSecurityConfig(): SecurityConfig {
        const config = vscode.workspace.getConfiguration('specforge.security');
        
        return {
            enableInputValidation: config.get('enableInputValidation', true),
            enableRateLimiting: config.get('enableRateLimiting', true),
            enableAuditLogging: config.get('enableAuditLogging', true),
            maxOperationsPerMinute: config.get('maxOperationsPerMinute', 60),
            maxConcurrentOperations: config.get('maxConcurrentOperations', 5),
            blockSuspiciousActivity: config.get('blockSuspiciousActivity', true),
            alertOnSecurityEvents: config.get('alertOnSecurityEvents', true)
        };
    }

    private registerSecurityCommands(context: vscode.ExtensionContext): void {
        // View security events
        const viewEventsCommand = vscode.commands.registerCommand(
            'specforge.viewSecurityEvents',
            async () => {
                const panel = vscode.window.createWebviewPanel(
                    'specforgeSecurityEvents',
                    'SpecForge Security Events',
                    vscode.ViewColumn.One,
                    { enableScripts: true }
                );

                panel.webview.html = this.getSecurityEventsHtml();
            }
        );

        // Open security settings
        const settingsCommand = vscode.commands.registerCommand(
            'specforge.openSecuritySettings',
            () => {
                vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'specforge.security'
                );
            }
        );

        // Reset security state
        const resetCommand = vscode.commands.registerCommand(
            'specforge.resetSecurityState',
            async () => {
                const confirm = await vscode.window.showWarningMessage(
                    'Are you sure you want to reset all security state? This will clear rate limits and security events.',
                    { modal: true },
                    'Reset'
                );

                if (confirm === 'Reset') {
                    this.rateLimitState = {
                        operations: [],
                        violationCount: 0
                    };
                    this.securityEvents = [];
                    vscode.window.showInformationMessage('Security state has been reset.');
                }
            }
        );

        context.subscriptions.push(viewEventsCommand, settingsCommand, resetCommand);
    }

    private getSecurityEventsHtml(): string {
        const events = this.securityEvents
            .slice(-100) // Show last 100 events
            .reverse() // Most recent first
            .map(event => `
                <tr class="event-row severity-${event.severity}">
                    <td>${event.timestamp.toLocaleString()}</td>
                    <td><span class="severity-badge severity-${event.severity}">${event.severity.toUpperCase()}</span></td>
                    <td>${event.type}</td>
                    <td>${event.message}</td>
                    <td><button onclick="showDetails('${event.id}')">Details</button></td>
                </tr>
            `).join('');

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>SpecForge Security Events</title>
                <style>
                    body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        margin: 0;
                        padding: 20px;
                        background-color: var(--vscode-editor-background);
                        color: var(--vscode-editor-foreground);
                    }
                    
                    .header {
                        border-bottom: 1px solid var(--vscode-panel-border);
                        padding-bottom: 10px;
                        margin-bottom: 20px;
                    }
                    
                    .stats {
                        display: flex;
                        gap: 20px;
                        margin-bottom: 20px;
                    }
                    
                    .stat-card {
                        background-color: var(--vscode-panel-background);
                        border: 1px solid var(--vscode-panel-border);
                        border-radius: 4px;
                        padding: 15px;
                        min-width: 120px;
                    }
                    
                    .stat-value {
                        font-size: 24px;
                        font-weight: bold;
                        color: var(--vscode-charts-blue);
                    }
                    
                    .stat-label {
                        font-size: 12px;
                        opacity: 0.8;
                        margin-top: 5px;
                    }
                    
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        background-color: var(--vscode-editor-background);
                    }
                    
                    th, td {
                        padding: 12px;
                        text-align: left;
                        border-bottom: 1px solid var(--vscode-panel-border);
                    }
                    
                    th {
                        background-color: var(--vscode-panel-background);
                        font-weight: 600;
                        position: sticky;
                        top: 0;
                    }
                    
                    .severity-badge {
                        padding: 2px 8px;
                        border-radius: 12px;
                        font-size: 11px;
                        font-weight: bold;
                        text-transform: uppercase;
                    }
                    
                    .severity-debug { background-color: #666; color: white; }
                    .severity-info { background-color: #0066cc; color: white; }
                    .severity-warning { background-color: #ff8c00; color: white; }
                    .severity-error { background-color: #dc3545; color: white; }
                    .severity-critical { background-color: #ff0000; color: white; animation: pulse 1s infinite; }
                    
                    @keyframes pulse {
                        0%, 100% { opacity: 1; }
                        50% { opacity: 0.7; }
                    }
                    
                    .event-row:hover {
                        background-color: var(--vscode-list-hoverBackground);
                    }
                    
                    button {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 4px 8px;
                        border-radius: 2px;
                        cursor: pointer;
                        font-size: 11px;
                    }
                    
                    button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    
                    .no-events {
                        text-align: center;
                        padding: 40px;
                        opacity: 0.6;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>SpecForge Security Events</h1>
                    <p>Real-time security monitoring and audit log</p>
                </div>
                
                <div class="stats">
                    <div class="stat-card">
                        <div class="stat-value">${this.securityEvents.length}</div>
                        <div class="stat-label">Total Events</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${this.securityEvents.filter(e => e.severity === SecuritySeverity.ERROR || e.severity === SecuritySeverity.CRITICAL).length}</div>
                        <div class="stat-label">High Severity</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${this.rateLimitState.violationCount}</div>
                        <div class="stat-label">Rate Violations</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-value">${this.concurrentOperations}</div>
                        <div class="stat-label">Active Operations</div>
                    </div>
                </div>
                
                ${events ? `
                    <table>
                        <thead>
                            <tr>
                                <th>Timestamp</th>
                                <th>Severity</th>
                                <th>Type</th>
                                <th>Message</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${events}
                        </tbody>
                    </table>
                ` : `
                    <div class="no-events">
                        <h3>No security events recorded</h3>
                        <p>Security monitoring is active and events will appear here as they occur.</p>
                    </div>
                `}
                
                <script>
                    function showDetails(eventId) {
                        // In a real implementation, this would show detailed event information
                        console.log('Show details for event:', eventId);
                    }
                    
                    // Auto-refresh every 30 seconds
                    setTimeout(() => {
                        window.location.reload();
                    }, 30000);
                </script>
            </body>
            </html>
        `;
    }

    /**
     * Get current security statistics.
     */
    getSecurityStats(): any {
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        
        const recentEvents = this.securityEvents.filter(event => event.timestamp > oneHourAgo);
        const eventsByType = recentEvents.reduce((acc, event) => {
            acc[event.type] = (acc[event.type] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const eventsBySeverity = recentEvents.reduce((acc, event) => {
            acc[event.severity] = (acc[event.severity] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        return {
            config: this.config,
            rateLimiting: {
                operationsThisMinute: this.rateLimitState.operations.length,
                maxOperationsPerMinute: this.config.maxOperationsPerMinute,
                violationCount: this.rateLimitState.violationCount,
                blockedUntil: this.rateLimitState.blockedUntil?.toISOString() || null
            },
            operations: {
                concurrent: this.concurrentOperations,
                maxConcurrent: this.config.maxConcurrentOperations
            },
            events: {
                total: this.securityEvents.length,
                lastHour: recentEvents.length,
                byType: eventsByType,
                bySeverity: eventsBySeverity
            }
        };
    }

    /**
     * Dispose of resources.
     */
    dispose(): void {
        this.outputChannel.dispose();
    }
}