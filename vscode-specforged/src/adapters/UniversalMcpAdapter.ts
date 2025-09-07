import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

export type McpProtocol = 'stdio' | 'http' | 'websocket';

export interface McpConnectionConfig {
    protocol: McpProtocol;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    apiKey?: string;
    timeout?: number;
    retryAttempts?: number;
    retryDelay?: number;
}

export interface McpMessage {
    jsonrpc: '2.0';
    id?: string | number;
    method?: string;
    params?: any;
    result?: any;
    error?: McpError;
}

export interface McpError {
    code: number;
    message: string;
    data?: any;
}

export interface McpCapabilities {
    tools?: { listChanged?: boolean };
    resources?: { subscribe?: boolean; listChanged?: boolean };
    prompts?: { listChanged?: boolean };
    logging?: {};
    experimental?: Record<string, any>;
}

export interface ConnectionStatus {
    connected: boolean;
    protocol: McpProtocol;
    lastPing?: Date;
    latency?: number;
    error?: string;
    capabilities?: McpCapabilities;
    serverInfo?: {
        name: string;
        version: string;
        protocolVersion?: string;
    };
}

export interface McpTool {
    name: string;
    description?: string;
    inputSchema: any;
}

export interface McpResource {
    uri: string;
    name: string;
    description?: string;
    mimeType?: string;
}

export interface McpPrompt {
    name: string;
    description?: string;
    arguments?: any[];
}

export class UniversalMcpAdapter extends EventEmitter {
    private connection: any = null;
    private process: ChildProcess | null = null;
    private messageHandlers = new Map<string | number, (response: McpMessage) => void>();
    private messageCounter = 0;
    private heartbeatInterval: NodeJS.Timer | null = null;
    private reconnectAttempts = 0;
    private status: ConnectionStatus = {
        connected: false,
        protocol: 'stdio'
    };

    constructor(private config: McpConnectionConfig) {
        super();
        this.status.protocol = config.protocol;
    }

    async connect(): Promise<ConnectionStatus> {
        try {
            this.emit('connecting');
            
            switch (this.config.protocol) {
                case 'stdio':
                    await this.connectStdio();
                    break;
                case 'http':
                    await this.connectHttp();
                    break;
                case 'websocket':
                    await this.connectWebSocket();
                    break;
                default:
                    throw new Error(`Unsupported protocol: ${this.config.protocol}`);
            }

            // Initialize connection
            await this.initialize();
            
            // Start heartbeat
            this.startHeartbeat();
            
            this.status.connected = true;
            this.status.error = undefined;
            this.reconnectAttempts = 0;
            
            this.emit('connected', this.status);
            
            return this.status;
        } catch (error) {
            this.status.connected = false;
            this.status.error = error instanceof Error ? error.message : 'Connection failed';
            
            this.emit('error', error);
            
            // Attempt reconnect if configured
            if (this.config.retryAttempts && this.reconnectAttempts < this.config.retryAttempts) {
                this.scheduleReconnect();
            }
            
            throw error;
        }
    }

    private async connectStdio(): Promise<void> {
        if (!this.config.command) {
            throw new Error('Command is required for stdio protocol');
        }

        this.process = spawn(this.config.command, this.config.args || [], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, ...this.config.env }
        });

        this.process.on('error', (error) => {
            this.handleConnectionError(error);
        });

        this.process.on('exit', (code, signal) => {
            this.handleConnectionClosed(code, signal);
        });

        // Set up message handling
        let buffer = '';
        this.process.stdout?.on('data', (data) => {
            buffer += data.toString();
            
            // Process complete JSON messages
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer
            
            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const message = JSON.parse(line);
                        this.handleMessage(message);
                    } catch (error) {
                        console.warn('Failed to parse MCP message:', line, error);
                    }
                }
            }
        });

        this.process.stderr?.on('data', (data) => {
            console.warn('MCP stderr:', data.toString());
        });

        this.connection = this.process;
    }

    private async connectHttp(): Promise<void> {
        if (!this.config.url) {
            throw new Error('URL is required for HTTP protocol');
        }

        // Test connection
        await this.testHttpConnection();
        
        this.connection = {
            url: this.config.url,
            apiKey: this.config.apiKey,
            timeout: this.config.timeout || 30000
        };
    }

    private async connectWebSocket(): Promise<void> {
        if (!this.config.url) {
            throw new Error('URL is required for WebSocket protocol');
        }

        // Note: WebSocket implementation would require a WebSocket library
        // For now, we'll use a placeholder that can be implemented later
        throw new Error('WebSocket protocol not yet implemented');
    }

    private async testHttpConnection(): Promise<void> {
        if (!this.config.url) {
            throw new Error('URL is required');
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.config.timeout || 10000);

        try {
            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            };

            if (this.config.apiKey) {
                headers['Authorization'] = `Bearer ${this.config.apiKey}`;
            }

            const response = await fetch(`${this.config.url}/health`, {
                method: 'GET',
                headers,
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } finally {
            clearTimeout(timeout);
        }
    }

    private async initialize(): Promise<void> {
        const initMessage: McpMessage = {
            jsonrpc: '2.0',
            id: this.generateMessageId(),
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {
                    tools: { listChanged: true },
                    resources: { subscribe: true, listChanged: true },
                    prompts: { listChanged: true },
                    logging: {}
                },
                clientInfo: {
                    name: 'vscode-specforged',
                    version: '0.1.0'
                }
            }
        };

        const response = await this.sendMessage(initMessage);
        
        if (response.error) {
            throw new Error(`Initialization failed: ${response.error.message}`);
        }

        // Store server capabilities and info
        this.status.capabilities = response.result?.capabilities;
        this.status.serverInfo = response.result?.serverInfo;

        // Send initialized notification
        await this.sendNotification('notifications/initialized');
    }

    async callTool(name: string, arguments_: any = {}): Promise<any> {
        const message: McpMessage = {
            jsonrpc: '2.0',
            id: this.generateMessageId(),
            method: 'tools/call',
            params: {
                name,
                arguments: arguments_
            }
        };

        const response = await this.sendMessage(message);
        
        if (response.error) {
            throw new Error(`Tool call failed: ${response.error.message}`);
        }

        return response.result;
    }

    async listTools(): Promise<McpTool[]> {
        const message: McpMessage = {
            jsonrpc: '2.0',
            id: this.generateMessageId(),
            method: 'tools/list'
        };

        const response = await this.sendMessage(message);
        
        if (response.error) {
            throw new Error(`List tools failed: ${response.error.message}`);
        }

        return response.result?.tools || [];
    }

    async readResource(uri: string): Promise<any> {
        const message: McpMessage = {
            jsonrpc: '2.0',
            id: this.generateMessageId(),
            method: 'resources/read',
            params: { uri }
        };

        const response = await this.sendMessage(message);
        
        if (response.error) {
            throw new Error(`Read resource failed: ${response.error.message}`);
        }

        return response.result;
    }

    async listResources(): Promise<McpResource[]> {
        const message: McpMessage = {
            jsonrpc: '2.0',
            id: this.generateMessageId(),
            method: 'resources/list'
        };

        const response = await this.sendMessage(message);
        
        if (response.error) {
            throw new Error(`List resources failed: ${response.error.message}`);
        }

        return response.result?.resources || [];
    }

    async getPrompt(name: string, arguments_: any = {}): Promise<any> {
        const message: McpMessage = {
            jsonrpc: '2.0',
            id: this.generateMessageId(),
            method: 'prompts/get',
            params: {
                name,
                arguments: arguments_
            }
        };

        const response = await this.sendMessage(message);
        
        if (response.error) {
            throw new Error(`Get prompt failed: ${response.error.message}`);
        }

        return response.result;
    }

    async listPrompts(): Promise<McpPrompt[]> {
        const message: McpMessage = {
            jsonrpc: '2.0',
            id: this.generateMessageId(),
            method: 'prompts/list'
        };

        const response = await this.sendMessage(message);
        
        if (response.error) {
            throw new Error(`List prompts failed: ${response.error.message}`);
        }

        return response.result?.prompts || [];
    }

    private async sendMessage(message: McpMessage): Promise<McpMessage> {
        return new Promise((resolve, reject) => {
            if (!this.status.connected) {
                reject(new Error('Not connected'));
                return;
            }

            const timeout = setTimeout(() => {
                this.messageHandlers.delete(message.id!);
                reject(new Error('Message timeout'));
            }, this.config.timeout || 30000);

            if (message.id !== undefined) {
                this.messageHandlers.set(message.id, (response) => {
                    clearTimeout(timeout);
                    resolve(response);
                });
            }

            this.sendRawMessage(message).catch(reject);
        });
    }

    private async sendNotification(method: string, params?: any): Promise<void> {
        const message: McpMessage = {
            jsonrpc: '2.0',
            method,
            params
        };

        await this.sendRawMessage(message);
    }

    private async sendRawMessage(message: McpMessage): Promise<void> {
        const messageString = JSON.stringify(message);

        switch (this.config.protocol) {
            case 'stdio':
                if (this.process?.stdin) {
                    this.process.stdin.write(messageString + '\n');
                } else {
                    throw new Error('Process stdin not available');
                }
                break;

            case 'http':
                if (!this.connection?.url) {
                    throw new Error('HTTP connection not available');
                }

                const headers: Record<string, string> = {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                };

                if (this.connection.apiKey) {
                    headers['Authorization'] = `Bearer ${this.connection.apiKey}`;
                }

                const response = await fetch(this.connection.url, {
                    method: 'POST',
                    headers,
                    body: messageString
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                // For HTTP, handle the response immediately
                const responseData = await response.json();
                this.handleMessage(responseData);
                break;

            case 'websocket':
                // WebSocket implementation would go here
                throw new Error('WebSocket not implemented');

            default:
                throw new Error(`Unsupported protocol: ${this.config.protocol}`);
        }
    }

    private handleMessage(message: McpMessage): void {
        // Handle responses to requests
        if (message.id !== undefined && this.messageHandlers.has(message.id)) {
            const handler = this.messageHandlers.get(message.id)!;
            this.messageHandlers.delete(message.id);
            handler(message);
            return;
        }

        // Handle notifications
        if (message.method) {
            this.emit('notification', message);
            
            // Handle specific notifications
            switch (message.method) {
                case 'notifications/tools/list_changed':
                    this.emit('toolsChanged');
                    break;
                case 'notifications/resources/list_changed':
                    this.emit('resourcesChanged');
                    break;
                case 'notifications/prompts/list_changed':
                    this.emit('promptsChanged');
                    break;
            }
        }
    }

    private startHeartbeat(): void {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }

        this.heartbeatInterval = setInterval(async () => {
            try {
                const start = Date.now();
                await this.ping();
                const latency = Date.now() - start;
                
                this.status.lastPing = new Date();
                this.status.latency = latency;
                
                this.emit('heartbeat', this.status);
            } catch (error) {
                console.warn('Heartbeat failed:', error);
                this.handleConnectionError(error);
            }
        }, 30000); // 30 seconds
    }

    private async ping(): Promise<void> {
        const message: McpMessage = {
            jsonrpc: '2.0',
            id: this.generateMessageId(),
            method: 'ping'
        };

        await this.sendMessage(message);
    }

    private handleConnectionError(error: any): void {
        this.status.connected = false;
        this.status.error = error instanceof Error ? error.message : 'Connection error';
        
        this.emit('error', error);
        
        if (this.config.retryAttempts && this.reconnectAttempts < this.config.retryAttempts) {
            this.scheduleReconnect();
        }
    }

    private handleConnectionClosed(code: number | null, signal: string | null): void {
        this.status.connected = false;
        this.status.error = `Connection closed (code: ${code}, signal: ${signal})`;
        
        this.emit('disconnected', { code, signal });
        
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    private scheduleReconnect(): void {
        this.reconnectAttempts++;
        const delay = (this.config.retryDelay || 5000) * Math.pow(2, this.reconnectAttempts - 1);
        
        console.log(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);
        
        setTimeout(() => {
            console.log(`Reconnect attempt ${this.reconnectAttempts}`);
            this.connect().catch((error) => {
                console.error('Reconnect failed:', error);
            });
        }, delay);
    }

    private generateMessageId(): string {
        return `msg_${++this.messageCounter}_${Date.now()}`;
    }

    getStatus(): ConnectionStatus {
        return { ...this.status };
    }

    isConnected(): boolean {
        return this.status.connected;
    }

    async disconnect(): Promise<void> {
        this.status.connected = false;
        
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }

        // Clear pending message handlers
        this.messageHandlers.clear();

        switch (this.config.protocol) {
            case 'stdio':
                if (this.process) {
                    this.process.kill();
                    this.process = null;
                }
                break;

            case 'http':
                // HTTP connections are stateless, nothing to disconnect
                break;

            case 'websocket':
                // WebSocket disconnection would go here
                break;
        }

        this.connection = null;
        this.emit('disconnected');
    }

    dispose(): void {
        this.disconnect().catch((error) => {
            console.error('Error during disconnect:', error);
        });
        
        this.removeAllListeners();
    }
}