# SpecForged Developer Guide

A comprehensive guide for developers working with the SpecForged MCP ecosystem, covering server customization, extension development, API integration, and contributing to the project.

## Table of Contents

1. [Development Environment Setup](#development-environment-setup)
2. [Architecture Deep Dive](#architecture-deep-dive)
3. [MCP Server Development](#mcp-server-development)
4. [VS Code Extension Development](#vs-code-extension-development)
5. [File-based IPC Protocol](#file-based-ipc-protocol)
6. [Queue Processing Engine](#queue-processing-engine)
7. [Conflict Resolution System](#conflict-resolution-system)
8. [Testing Frameworks](#testing-frameworks)
9. [API Integration](#api-integration)
10. [Contributing Guidelines](#contributing-guidelines)

---

## Development Environment Setup

### Prerequisites

#### Required Software
- **Python 3.10+** - Core server development
- **Node.js 18+** - Extension development  
- **VS Code** - Extension testing and debugging
- **Git** - Version control
- **Docker** (optional) - Containerized development

#### Development Tools
- **TypeScript 4.8+** - Extension language
- **pytest** - Python testing framework
- **esbuild** - Fast JavaScript bundling
- **black** - Python code formatting
- **eslint** - TypeScript/JavaScript linting

### Repository Setup

```bash
# Clone the repository
git clone https://github.com/whit3rabbit/SpecForge.git
cd SpecForge

# Set up Python development environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
pip install -e .  # Install in editable mode

# Set up VS Code extension development
cd vscode-specforged/
npm install
npm run compile

# Return to project root
cd ../
```

### Development Server Setup

```bash
# Run development server with hot reloading
python scripts/dev.py serve --reload

# Or run directly
python main.py --debug --log-level=debug

# Test server functionality
python scripts/dev.py test
```

### Extension Development Setup

```bash
# Navigate to extension directory
cd vscode-specforged/

# Install dependencies
npm install

# Start development build with watching
npm run watch

# Or bundle for development
npm run bundle-dev

# Launch extension in debugging mode
# Press F5 in VS Code to start Extension Development Host
```

---

## Architecture Deep Dive

### System Components Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SpecForged MCP Ecosystem                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────┐    File-based IPC    ┌──────────────────┐  │
│  │   VS Code           │◄─────────────────────►│  Operation       │  │
│  │   Extension         │                       │  Queue           │  │
│  │                     │                       │  Processor       │  │
│  │ • UI Management     │                       │                  │  │
│  │ • File Operations   │                       │ • Conflict       │  │
│  │ • User Interaction  │                       │   Detection      │  │
│  └─────────────────────┘                       │ • Error Recovery │  │
│                                                 │ • Retry Logic    │  │
│  ┌─────────────────────┐    MCP Protocol      └──────────────────┘  │
│  │   MCP Server        │◄─────────────────────────────────────────┐ │
│  │                     │                                           │ │
│  │ • Classification    │    ┌─────────────────────┐                │ │
│  │ • Specification     │◄───│ Queue Files (.json) │                │ │
│  │   Management        │    │                     │                │ │
│  │ • Workflow Engine   │    │ • operation_queue   │                │ │
│  │ • EARS Validation   │    │ • operation_results │                │ │
│  └─────────────────────┘    │ • conflicts         │                │ │
│                              │ • sync_state        │                │ │
│  ┌─────────────────────┐    └─────────────────────┘                │ │
│  │   File System      │◄─────────────────────────────────────────┘ │
│  │                     │                                             │
│  │ • .specifications/  │                                             │
│  │ • .vscode/          │                                             │
│  │   specforged/       │                                             │
│  └─────────────────────┘                                             │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Architectural Principles

#### 1. Separation of Concerns
- **VS Code Extension**: UI, file operations, user interaction
- **MCP Server**: Business logic, specification intelligence, workflow
- **Queue Processor**: Async operations, conflict resolution, error recovery
- **File System**: Persistent storage, IPC communication

#### 2. Asynchronous Processing
- All operations are queued for async processing
- Non-blocking UI interactions
- Comprehensive error recovery and retry mechanisms
- Real-time status updates and progress tracking

#### 3. Conflict-Aware Design
- Every operation is checked for conflicts
- Multiple resolution strategies available
- User guidance for complex conflicts
- Atomic operations to prevent data corruption

#### 4. Multi-Server Architecture
- Support for local, cloud, and custom MCP servers
- Seamless server switching without data loss
- Hybrid architectures (extension + cloud server)
- Graceful failover and recovery

---

## MCP Server Development

### Server Architecture

The MCP server is built using FastMCP and provides the core intelligence for specification-driven development.

#### Core Components

```python
# src/specforged/server.py - Main server factory
from fastmcp import FastMCP
from .core.classifier import ModeClassifier
from .core.spec_manager import SpecificationManager
from .core.queue_processor import QueueProcessor
from .tools import classification, specifications, workflow

def create_server() -> FastMCP:
    """Create and configure the MCP server."""
    server = FastMCP("SpecForged")
    
    # Initialize core components
    classifier = ModeClassifier()
    spec_manager = SpecificationManager()
    queue_processor = QueueProcessor()
    
    # Register tools
    classification.register_tools(server, classifier)
    specifications.register_tools(server, spec_manager)
    workflow.register_tools(server, spec_manager)
    
    # Register resources and prompts
    register_resources(server)
    register_prompts(server)
    
    return server
```

#### Adding New MCP Tools

```python
# Example: Adding a new MCP tool
from fastmcp import FastMCP
from typing import Dict, Any

@server.tool()
async def my_custom_tool(
    parameter1: str,
    parameter2: int = 42,
    optional_param: Optional[str] = None
) -> Dict[str, Any]:
    """
    Custom tool description for MCP clients.
    
    Args:
        parameter1: Required string parameter
        parameter2: Optional integer parameter (default: 42)
        optional_param: Optional string parameter
    
    Returns:
        Dictionary with operation results
    """
    try:
        # Validate input parameters
        if not parameter1 or len(parameter1) < 3:
            return {
                "status": "error",
                "message": "parameter1 must be at least 3 characters long"
            }
        
        # Perform the operation
        result = perform_custom_operation(parameter1, parameter2)
        
        # Queue the operation if it involves file changes
        if involves_file_changes(result):
            operation = {
                "type": "CUSTOM_OPERATION",
                "parameters": {
                    "parameter1": parameter1,
                    "parameter2": parameter2
                },
                "result": result
            }
            await queue_processor.add_operation(operation)
        
        return {
            "status": "success",
            "result": result,
            "message": f"Custom operation completed for {parameter1}"
        }
        
    except Exception as e:
        return {
            "status": "error",
            "message": str(e),
            "error_code": "CUSTOM_OPERATION_FAILED"
        }
```

#### Custom Server Deployment

```python
# custom_server.py - Example custom server
from specforged.server import create_server
from fastmcp.server import stdio_server
import asyncio
import logging

# Configure custom logging
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('custom-specforged.log'),
        logging.StreamHandler()
    ]
)

# Add custom configuration
class CustomSpecForgedServer:
    def __init__(self):
        self.server = create_server()
        self.add_custom_tools()
        
    def add_custom_tools(self):
        """Add custom tools specific to your use case."""
        
        @self.server.tool()
        async def company_specific_tool(data: str) -> dict:
            # Custom business logic
            return {"processed": True, "data": data}
    
    async def run(self):
        async with stdio_server() as (read_stream, write_stream):
            await self.server.run(read_stream, write_stream)

if __name__ == "__main__":
    custom_server = CustomSpecForgedServer()
    asyncio.run(custom_server.run())
```

### Adding Custom Specification Templates

```python
# src/specforged/templates/custom_template.py
from typing import Dict, Any, List
from ..models.core import Specification

class CustomProjectTemplate:
    """Custom project template for specific domain."""
    
    @staticmethod
    def get_template_info() -> Dict[str, Any]:
        return {
            "id": "custom-domain",
            "name": "Custom Domain Project",
            "description": "Template for custom domain projects",
            "category": "domain-specific",
            "requirements": [
                "Custom requirement 1",
                "Custom requirement 2"
            ]
        }
    
    @staticmethod
    def create_specification(
        name: str,
        description: str,
        **kwargs
    ) -> Specification:
        """Create a specification from this template."""
        
        # Define template-specific user stories
        user_stories = [
            {
                "as_a": "domain expert",
                "i_want": "to customize the workflow",
                "so_that": "it fits my domain requirements",
                "ears_requirements": [
                    {
                        "condition": "WHEN domain data is processed",
                        "system_response": "apply domain-specific validation rules"
                    }
                ]
            }
        ]
        
        # Create specification with template data
        spec = Specification(
            spec_id=name.lower().replace(" ", "-"),
            name=name,
            description=description,
            template="custom-domain",
            user_stories=user_stories
        )
        
        return spec

# Register template
CUSTOM_TEMPLATES = {
    "custom-domain": CustomProjectTemplate
}
```

---

## VS Code Extension Development

### Extension Architecture

The VS Code extension provides the user interface and file operations for the SpecForged ecosystem.

#### Key Components

```typescript
// src/extension.ts - Main extension entry point
import * as vscode from 'vscode';
import { McpManager } from './mcp/mcpManager';
import { OperationQueueManager } from './services/operationQueueManager';
import { ConflictResolver } from './utils/conflictResolver';
import { StatusBarManager } from './utils/statusBarManager';

export async function activate(context: vscode.ExtensionContext) {
    console.log('SpecForged extension activating...');
    
    // Initialize core services
    const mcpManager = new McpManager(context);
    const queueManager = new OperationQueueManager(context);
    const conflictResolver = new ConflictResolver(queueManager);
    const statusBar = new StatusBarManager();
    
    // Register commands
    registerCommands(context, mcpManager, queueManager);
    
    // Register views and providers
    registerViews(context, mcpManager, queueManager);
    
    // Set up file watchers
    setupFileWatchers(context, queueManager);
    
    // Initialize status bar
    statusBar.initialize();
    
    console.log('SpecForged extension activated');
}

export function deactivate() {
    console.log('SpecForged extension deactivated');
}
```

#### Adding Custom Commands

```typescript
// src/commands/customCommands.ts
import * as vscode from 'vscode';
import { McpManager } from '../mcp/mcpManager';

export function registerCustomCommands(
    context: vscode.ExtensionContext,
    mcpManager: McpManager
) {
    
    // Example: Custom specification analysis command
    const analyzeSpecCommand = vscode.commands.registerCommand(
        'specforged.analyzeSpecification',
        async () => {
            try {
                // Get current specification
                const currentSpec = await mcpManager.getCurrentSpecification();
                if (!currentSpec) {
                    vscode.window.showWarningMessage('No specification selected');
                    return;
                }
                
                // Perform analysis
                const analysis = await performSpecificationAnalysis(currentSpec);
                
                // Show results in webview
                const panel = vscode.window.createWebviewPanel(
                    'specAnalysis',
                    'Specification Analysis',
                    vscode.ViewColumn.Two,
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true
                    }
                );
                
                panel.webview.html = generateAnalysisHtml(analysis);
                
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Analysis failed: ${error.message}`
                );
            }
        }
    );
    
    context.subscriptions.push(analyzeSpecCommand);
}

async function performSpecificationAnalysis(spec: any): Promise<any> {
    // Custom analysis logic
    return {
        completeness: calculateCompleteness(spec),
        quality: assessQuality(spec),
        recommendations: generateRecommendations(spec)
    };
}
```

#### Custom Webview Providers

```typescript
// src/views/customWebviewProvider.ts
import * as vscode from 'vscode';

export class CustomWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'specforged.customView';
    
    private _view?: vscode.WebviewView;
    
    constructor(
        private readonly _extensionUri: vscode.Uri
    ) {}
    
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        
        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
        
        // Handle messages from webview
        webviewView.webview.onDidReceiveMessage((data) => {
            switch (data.type) {
                case 'customAction':
                    this.handleCustomAction(data.payload);
                    break;
            }
        });
    }
    
    private _getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'out', 'webview', 'custom.js')
        );
        
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Custom View</title>
        </head>
        <body>
            <div id="custom-content">
                <!-- Custom webview content -->
            </div>
            <script src="${scriptUri}"></script>
        </body>
        </html>`;
    }
    
    private async handleCustomAction(payload: any) {
        // Handle custom webview actions
    }
}
```

### Extension Configuration

```json
// package.json - Extension manifest configuration
{
  "name": "specforged-mcp",
  "displayName": "SpecForged MCP Ecosystem",
  "description": "Complete MCP ecosystem for specification-driven development",
  "version": "0.3.2",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": ["Other"],
  "activationEvents": [
    "onStartupFinished",
    "workspaceContains:.specifications"
  ],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "specforged.initializeProject",
        "title": "Initialize Project",
        "category": "SpecForged"
      },
      {
        "command": "specforged.analyzeSpecification",
        "title": "Analyze Specification",
        "category": "SpecForged"
      }
    ],
    "views": {
      "specforged": [
        {
          "id": "specforged.specifications",
          "name": "Specifications",
          "when": "specforged.enabled"
        },
        {
          "id": "specforged.operationQueue",
          "name": "Operations",
          "when": "specforged.enabled"
        },
        {
          "id": "specforged.customView",
          "name": "Custom View",
          "type": "webview"
        }
      ]
    },
    "configuration": {
      "title": "SpecForged",
      "properties": {
        "specforged.mcpServerType": {
          "type": "string",
          "enum": ["local", "smithery", "custom"],
          "default": "local",
          "description": "Type of MCP server to use"
        },
        "specforged.customSettings": {
          "type": "object",
          "description": "Custom extension settings"
        }
      }
    }
  }
}
```

---

## File-based IPC Protocol

### IPC Architecture

The file-based IPC system enables reliable communication between the VS Code extension and MCP server using JSON files.

#### IPC File Structure

```
.vscode/specforged/
├── operation_queue.json     # Pending operations queue
├── operation_results.json   # Completed operations results
├── sync_state.json         # Synchronization state
├── conflicts.json          # Active conflicts
├── config.json            # Runtime configuration
└── locks/                  # Operation locks directory
    ├── queue.lock
    └── sync.lock
```

#### Operation Queue Format

```typescript
// Operation queue data structure
interface OperationQueue {
    operations: McpOperation[];
    version: string;
    last_updated: string;
    metadata: {
        total_operations: number;
        pending_count: number;
        processing_count: number;
    };
}

interface McpOperation {
    id: string;                    // Unique operation identifier
    type: McpOperationType;        // Operation type enum
    status: McpOperationStatus;    // Current status
    priority: McpOperationPriority;// Operation priority
    created_at: string;            // ISO timestamp
    parameters: Record<string, any>; // Operation parameters
    retry_count: number;           // Current retry count
    max_retries: number;           // Maximum retry attempts
    timeout: number;               // Timeout in milliseconds
    dependencies: string[];        // Dependent operation IDs
    metadata: {
        source: 'extension' | 'mcp_server' | 'user';
        batch_id?: string;
        user_context?: Record<string, any>;
    };
}
```

#### IPC Communication Implementation

```typescript
// src/services/ipcManager.ts
import * as fs from 'fs/promises';
import * as path from 'path';
import { EventEmitter } from 'events';

export class IPCManager extends EventEmitter {
    private queuePath: string;
    private resultsPath: string;
    private syncStatePath: string;
    private watchers: fs.FSWatcher[] = [];
    
    constructor(private workspaceRoot: string) {
        super();
        this.queuePath = path.join(workspaceRoot, '.vscode', 'specforged', 'operation_queue.json');
        this.resultsPath = path.join(workspaceRoot, '.vscode', 'specforged', 'operation_results.json');
        this.syncStatePath = path.join(workspaceRoot, '.vscode', 'specforged', 'sync_state.json');
        
        this.setupFileWatchers();
    }
    
    async writeOperation(operation: McpOperation): Promise<void> {
        try {
            await this.acquireLock('queue');
            
            const queue = await this.readQueue();
            queue.operations.push(operation);
            queue.last_updated = new Date().toISOString();
            queue.metadata.total_operations++;
            queue.metadata.pending_count++;
            
            await this.writeQueueAtomic(queue);
            
            this.emit('operationAdded', operation);
        } finally {
            await this.releaseLock('queue');
        }
    }
    
    private async writeQueueAtomic(queue: OperationQueue): Promise<void> {
        const tempPath = `${this.queuePath}.tmp`;
        const backupPath = `${this.queuePath}.backup`;
        
        try {
            // Write to temporary file
            await fs.writeFile(tempPath, JSON.stringify(queue, null, 2));
            
            // Create backup of existing file
            if (await this.fileExists(this.queuePath)) {
                await fs.copyFile(this.queuePath, backupPath);
            }
            
            // Atomic move
            await fs.rename(tempPath, this.queuePath);
            
            // Clean up backup
            if (await this.fileExists(backupPath)) {
                await fs.unlink(backupPath);
            }
        } catch (error) {
            // Rollback on error
            if (await this.fileExists(backupPath)) {
                await fs.rename(backupPath, this.queuePath);
            }
            throw error;
        }
    }
    
    private async acquireLock(lockName: string): Promise<void> {
        const lockPath = path.join(
            path.dirname(this.queuePath),
            'locks',
            `${lockName}.lock`
        );
        
        // Ensure locks directory exists
        await fs.mkdir(path.dirname(lockPath), { recursive: true });
        
        // Simple file-based locking
        let attempts = 0;
        const maxAttempts = 50;
        
        while (attempts < maxAttempts) {
            try {
                await fs.writeFile(lockPath, process.pid.toString(), { flag: 'wx' });
                return; // Lock acquired
            } catch (error) {
                if (error.code === 'EEXIST') {
                    // Check if lock is stale
                    const isStale = await this.isLockStale(lockPath);
                    if (isStale) {
                        await fs.unlink(lockPath);
                        continue;
                    }
                    
                    // Wait and retry
                    await new Promise(resolve => setTimeout(resolve, 100));
                    attempts++;
                } else {
                    throw error;
                }
            }
        }
        
        throw new Error(`Failed to acquire lock: ${lockName}`);
    }
    
    private async releaseLock(lockName: string): Promise<void> {
        const lockPath = path.join(
            path.dirname(this.queuePath),
            'locks',
            `${lockName}.lock`
        );
        
        try {
            await fs.unlink(lockPath);
        } catch (error) {
            // Lock might have been released by cleanup
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }
}
```

---

## Queue Processing Engine

### Queue Processor Architecture

The queue processor handles async operation execution with conflict detection and error recovery.

```python
# src/specforged/core/queue_processor.py
import asyncio
import json
import time
from typing import Dict, List, Optional, Any
from enum import Enum
from dataclasses import dataclass
from pathlib import Path

class OperationStatus(Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress" 
    COMPLETED = "completed"
    FAILED = "failed"
    CONFLICT = "conflict"
    CANCELLED = "cancelled"

@dataclass
class QueueOperation:
    id: str
    type: str
    status: OperationStatus
    parameters: Dict[str, Any]
    created_at: float
    retry_count: int = 0
    max_retries: int = 3
    timeout: float = 30.0
    dependencies: List[str] = None
    
    def __post_init__(self):
        if self.dependencies is None:
            self.dependencies = []

class QueueProcessor:
    """Asynchronous operation queue processor with conflict detection."""
    
    def __init__(self, base_path: Path):
        self.base_path = base_path
        self.queue_file = base_path / "operation_queue.json"
        self.results_file = base_path / "operation_results.json"
        self.conflicts_file = base_path / "conflicts.json"
        
        self.running = False
        self.processing_tasks: Dict[str, asyncio.Task] = {}
        self.conflict_detector = ConflictDetector()
        
    async def start(self):
        """Start the queue processor."""
        self.running = True
        asyncio.create_task(self.process_loop())
        
    async def stop(self):
        """Stop the queue processor."""
        self.running = False
        
        # Cancel all running tasks
        for task in self.processing_tasks.values():
            task.cancel()
        
        # Wait for tasks to complete
        if self.processing_tasks:
            await asyncio.gather(*self.processing_tasks.values(), return_exceptions=True)
    
    async def add_operation(self, operation: QueueOperation) -> None:
        """Add operation to the queue."""
        async with self._file_lock(self.queue_file):
            queue_data = await self._read_queue()
            
            # Check for conflicts before adding
            conflicts = await self.conflict_detector.detect_conflicts(
                operation, queue_data.get("operations", [])
            )
            
            if conflicts:
                await self._handle_conflicts(operation, conflicts)
                return
                
            # Add to queue
            queue_data.setdefault("operations", []).append(operation.__dict__)
            queue_data["last_updated"] = time.time()
            
            await self._write_queue(queue_data)
    
    async def process_loop(self):
        """Main processing loop."""
        while self.running:
            try:
                await self._process_pending_operations()
                await asyncio.sleep(1)  # Processing interval
                
            except Exception as e:
                print(f"Queue processing error: {e}")
                await asyncio.sleep(5)  # Error recovery delay
    
    async def _process_pending_operations(self):
        """Process all pending operations."""
        async with self._file_lock(self.queue_file):
            queue_data = await self._read_queue()
            operations = queue_data.get("operations", [])
            
            # Find operations ready to process
            ready_operations = [
                op for op in operations 
                if (op["status"] == OperationStatus.PENDING.value and
                    self._dependencies_met(op, operations) and
                    op["id"] not in self.processing_tasks)
            ]
            
            # Start processing ready operations
            for op_data in ready_operations[:3]:  # Limit concurrent operations
                operation = QueueOperation(**op_data)
                task = asyncio.create_task(self._execute_operation(operation))
                self.processing_tasks[operation.id] = task
    
    async def _execute_operation(self, operation: QueueOperation):
        """Execute a single operation."""
        try:
            # Update status to in_progress
            await self._update_operation_status(operation.id, OperationStatus.IN_PROGRESS)
            
            # Execute operation with timeout
            result = await asyncio.wait_for(
                self._perform_operation(operation),
                timeout=operation.timeout
            )
            
            # Record successful result
            await self._record_result(operation.id, result, OperationStatus.COMPLETED)
            
        except asyncio.TimeoutError:
            await self._handle_timeout(operation)
            
        except ConflictDetected as e:
            await self._handle_operation_conflict(operation, e.conflicts)
            
        except Exception as e:
            await self._handle_error(operation, e)
            
        finally:
            # Clean up processing task
            self.processing_tasks.pop(operation.id, None)
    
    async def _perform_operation(self, operation: QueueOperation) -> Dict[str, Any]:
        """Perform the actual operation."""
        handler = self._get_operation_handler(operation.type)
        if not handler:
            raise ValueError(f"Unknown operation type: {operation.type}")
        
        return await handler(operation.parameters)
    
    def _get_operation_handler(self, operation_type: str):
        """Get handler function for operation type."""
        handlers = {
            "UPDATE_REQUIREMENTS": self._handle_update_requirements,
            "UPDATE_DESIGN": self._handle_update_design,
            "UPDATE_TASKS": self._handle_update_tasks,
            "UPDATE_TASK_STATUS": self._handle_update_task_status,
            "CREATE_SPEC": self._handle_create_spec,
        }
        return handlers.get(operation_type)
    
    async def _handle_update_requirements(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Handle requirements update operation."""
        spec_id = params.get("spec_id")
        content = params.get("content")
        
        if not spec_id or not content:
            raise ValueError("Missing required parameters: spec_id, content")
        
        # Perform file update
        requirements_path = self.base_path.parent / ".specifications" / spec_id / "requirements.md"
        
        # Check for concurrent modifications
        await self._check_file_conflicts(requirements_path, params.get("expected_hash"))
        
        # Write file atomically
        await self._write_file_atomic(requirements_path, content)
        
        return {
            "spec_id": spec_id,
            "file_updated": str(requirements_path),
            "bytes_written": len(content.encode())
        }
    
    # Additional operation handlers...
```

---

## Conflict Resolution System

### Conflict Detection

```python
# src/specforged/core/conflict_detector.py
from typing import List, Dict, Any, Optional
from enum import Enum
import hashlib
import time

class ConflictType(Enum):
    CONCURRENT_MODIFICATION = "concurrent_modification"
    DUPLICATE_OPERATION = "duplicate_operation"
    RESOURCE_LOCKED = "resource_locked"
    DEPENDENCY_CONFLICT = "dependency_conflict"
    VERSION_MISMATCH = "version_mismatch"

@dataclass
class Conflict:
    id: str
    type: ConflictType
    operations: List[str]  # Operation IDs involved
    resource_path: Optional[str]
    description: str
    severity: str  # low, medium, high, critical
    auto_resolvable: bool
    created_at: float
    metadata: Dict[str, Any]

class ConflictDetector:
    """Detect and classify conflicts between operations."""
    
    def __init__(self):
        self.detection_rules = [
            self._detect_concurrent_modifications,
            self._detect_duplicate_operations,
            self._detect_resource_conflicts,
            self._detect_dependency_conflicts,
        ]
    
    async def detect_conflicts(
        self, 
        new_operation: QueueOperation,
        existing_operations: List[Dict[str, Any]]
    ) -> List[Conflict]:
        """Detect conflicts for a new operation against existing operations."""
        conflicts = []
        
        for rule in self.detection_rules:
            rule_conflicts = await rule(new_operation, existing_operations)
            conflicts.extend(rule_conflicts)
        
        return conflicts
    
    async def _detect_concurrent_modifications(
        self, 
        operation: QueueOperation,
        existing_ops: List[Dict[str, Any]]
    ) -> List[Conflict]:
        """Detect operations trying to modify the same resource."""
        conflicts = []
        
        # Get target resource for this operation
        target_resource = self._get_target_resource(operation)
        if not target_resource:
            return conflicts
        
        # Find operations targeting the same resource
        concurrent_ops = [
            op for op in existing_ops
            if (op["status"] in ["pending", "in_progress"] and
                self._get_target_resource_from_dict(op) == target_resource)
        ]
        
        if concurrent_ops:
            conflict = Conflict(
                id=f"conflict_{int(time.time() * 1000)}",
                type=ConflictType.CONCURRENT_MODIFICATION,
                operations=[operation.id] + [op["id"] for op in concurrent_ops],
                resource_path=target_resource,
                description=f"Multiple operations targeting {target_resource}",
                severity="medium",
                auto_resolvable=False,  # Usually requires user decision
                created_at=time.time(),
                metadata={
                    "operation_types": [operation.type] + [op["type"] for op in concurrent_ops],
                    "detection_rule": "concurrent_modifications"
                }
            )
            conflicts.append(conflict)
        
        return conflicts
    
    async def _detect_duplicate_operations(
        self,
        operation: QueueOperation,
        existing_ops: List[Dict[str, Any]]
    ) -> List[Conflict]:
        """Detect duplicate or nearly identical operations."""
        conflicts = []
        
        # Calculate content hash for the operation
        operation_hash = self._calculate_operation_hash(operation)
        
        # Find operations with same hash
        duplicate_ops = [
            op for op in existing_ops
            if (op["status"] in ["pending", "in_progress"] and
                self._calculate_operation_hash_from_dict(op) == operation_hash)
        ]
        
        if duplicate_ops:
            conflict = Conflict(
                id=f"conflict_{int(time.time() * 1000)}",
                type=ConflictType.DUPLICATE_OPERATION,
                operations=[operation.id] + [op["id"] for op in duplicate_ops],
                resource_path=self._get_target_resource(operation),
                description="Duplicate operation detected",
                severity="low",
                auto_resolvable=True,  # Can automatically cancel duplicates
                created_at=time.time(),
                metadata={
                    "operation_hash": operation_hash,
                    "detection_rule": "duplicate_operations"
                }
            )
            conflicts.append(conflict)
        
        return conflicts
    
    def _calculate_operation_hash(self, operation: QueueOperation) -> str:
        """Calculate hash for operation to detect duplicates."""
        # Create hash based on operation type and key parameters
        hash_data = {
            "type": operation.type,
            "parameters": operation.parameters
        }
        
        # Remove timestamp and ID from hash calculation
        hash_string = json.dumps(hash_data, sort_keys=True)
        return hashlib.sha256(hash_string.encode()).hexdigest()[:16]
```

### Conflict Resolution

```python
# src/specforged/core/conflict_resolver.py
from typing import Dict, Any, List, Optional
from enum import Enum

class ResolutionStrategy(Enum):
    MERGE = "merge"
    EXTENSION_WINS = "extension_wins"
    MCP_WINS = "mcp_wins"
    USER_DECIDE = "user_decide"
    CANCEL = "cancel"
    RETRY = "retry"
    DEFER = "defer"

class ConflictResolver:
    """Resolve conflicts using various strategies."""
    
    def __init__(self, queue_processor: QueueProcessor):
        self.queue_processor = queue_processor
        self.resolution_strategies = {
            ResolutionStrategy.MERGE: self._resolve_merge,
            ResolutionStrategy.EXTENSION_WINS: self._resolve_extension_wins,
            ResolutionStrategy.MCP_WINS: self._resolve_mcp_wins,
            ResolutionStrategy.CANCEL: self._resolve_cancel,
            ResolutionStrategy.RETRY: self._resolve_retry,
        }
    
    async def resolve_conflict(
        self,
        conflict: Conflict,
        strategy: ResolutionStrategy,
        user_input: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Resolve a conflict using the specified strategy."""
        
        if strategy not in self.resolution_strategies:
            raise ValueError(f"Unknown resolution strategy: {strategy}")
        
        resolver = self.resolution_strategies[strategy]
        result = await resolver(conflict, user_input)
        
        # Record resolution
        await self._record_resolution(conflict, strategy, result)
        
        return result
    
    async def _resolve_merge(
        self,
        conflict: Conflict,
        user_input: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Attempt to automatically merge conflicting operations."""
        
        if conflict.type != ConflictType.CONCURRENT_MODIFICATION:
            raise ValueError("Merge resolution only applies to concurrent modifications")
        
        # Get the conflicting operations
        operations = await self._get_operations_by_ids(conflict.operations)
        
        if len(operations) != 2:
            raise ValueError("Merge resolution requires exactly 2 operations")
        
        # Perform merge
        merged_content = await self._perform_merge(operations[0], operations[1])
        
        if merged_content is None:
            raise ValueError("Automatic merge failed - manual resolution required")
        
        # Create new merged operation
        merged_operation = await self._create_merged_operation(
            operations, merged_content
        )
        
        # Cancel original operations and queue merged operation
        for op in operations:
            await self.queue_processor.cancel_operation(op["id"])
        
        await self.queue_processor.add_operation(merged_operation)
        
        return {
            "status": "success",
            "strategy": "merge",
            "merged_operation_id": merged_operation.id,
            "cancelled_operations": [op["id"] for op in operations]
        }
    
    async def _perform_merge(
        self, 
        operation1: Dict[str, Any],
        operation2: Dict[str, Any]
    ) -> Optional[str]:
        """Perform automatic merge of two operations."""
        
        # Simple merge logic for text content
        content1 = operation1["parameters"].get("content", "")
        content2 = operation2["parameters"].get("content", "")
        
        # Use a simple line-based merge algorithm
        lines1 = content1.splitlines()
        lines2 = content2.splitlines()
        
        # Find common base (simplified)
        common_lines = self._find_common_lines(lines1, lines2)
        
        if not common_lines:
            return None  # Cannot merge without common base
        
        # Perform 3-way merge (simplified)
        merged_lines = self._three_way_merge(common_lines, lines1, lines2)
        
        if merged_lines is None:
            return None  # Merge conflicts detected
        
        return "\n".join(merged_lines)
    
    def _find_common_lines(self, lines1: List[str], lines2: List[str]) -> List[str]:
        """Find common lines between two text versions."""
        # Simple implementation - find longest common subsequence
        common = []
        
        for line in lines1:
            if line in lines2:
                common.append(line)
        
        return common
    
    def _three_way_merge(
        self, 
        base: List[str], 
        lines1: List[str], 
        lines2: List[str]
    ) -> Optional[List[str]]:
        """Perform three-way merge of text lines."""
        # Simplified merge algorithm
        # In production, use more sophisticated algorithms like git's merge
        
        # For this example, we'll do a basic merge
        merged = []
        
        # Add lines from both versions, avoiding duplicates
        for line in lines1:
            if line not in merged:
                merged.append(line)
        
        for line in lines2:
            if line not in merged:
                merged.append(line)
        
        return merged
```

---

## Testing Frameworks

### Server Testing

```python
# tests/test_queue_processor.py
import pytest
import asyncio
import tempfile
from pathlib import Path
from specforged.core.queue_processor import QueueProcessor, QueueOperation, OperationStatus

@pytest.fixture
async def queue_processor():
    """Create a queue processor for testing."""
    with tempfile.TemporaryDirectory() as temp_dir:
        base_path = Path(temp_dir) / ".vscode" / "specforged"
        base_path.mkdir(parents=True)
        
        processor = QueueProcessor(base_path)
        await processor.start()
        
        yield processor
        
        await processor.stop()

@pytest.mark.asyncio
async def test_operation_processing(queue_processor):
    """Test basic operation processing."""
    # Create test operation
    operation = QueueOperation(
        id="test_op_001",
        type="UPDATE_REQUIREMENTS",
        status=OperationStatus.PENDING,
        parameters={
            "spec_id": "test-spec",
            "content": "# Test Requirements\n\nTest content"
        },
        created_at=time.time()
    )
    
    # Add to queue
    await queue_processor.add_operation(operation)
    
    # Wait for processing
    await asyncio.sleep(2)
    
    # Verify operation completed
    results = await queue_processor.get_results()
    assert len(results) == 1
    assert results[0]["operation_id"] == "test_op_001"
    assert results[0]["status"] == "completed"

@pytest.mark.asyncio
async def test_conflict_detection(queue_processor):
    """Test conflict detection between operations."""
    # Create two conflicting operations
    operation1 = QueueOperation(
        id="test_op_002",
        type="UPDATE_REQUIREMENTS",
        status=OperationStatus.PENDING,
        parameters={
            "spec_id": "test-spec",
            "content": "Version 1 content"
        },
        created_at=time.time()
    )
    
    operation2 = QueueOperation(
        id="test_op_003",
        type="UPDATE_REQUIREMENTS",
        status=OperationStatus.PENDING,
        parameters={
            "spec_id": "test-spec",
            "content": "Version 2 content"
        },
        created_at=time.time() + 1
    )
    
    # Add first operation
    await queue_processor.add_operation(operation1)
    
    # Add second operation (should detect conflict)
    await queue_processor.add_operation(operation2)
    
    # Check for conflicts
    conflicts = await queue_processor.get_conflicts()
    assert len(conflicts) == 1
    assert conflicts[0]["type"] == "concurrent_modification"

# Integration tests
@pytest.mark.asyncio
async def test_end_to_end_specification_workflow():
    """Test complete specification workflow."""
    async with create_test_server() as server:
        # Create specification
        result = await server.call_tool("create_spec", {
            "name": "Test Specification",
            "description": "End-to-end test spec"
        })
        
        assert result["status"] == "success"
        spec_id = result["spec_id"]
        
        # Add requirements
        result = await server.call_tool("add_requirement", {
            "spec_id": spec_id,
            "as_a": "user",
            "i_want": "to test the system",
            "so_that": "I can verify it works"
        })
        
        assert result["status"] == "success"
        
        # Generate tasks
        result = await server.call_tool("generate_implementation_plan", {
            "spec_id": spec_id
        })
        
        assert result["status"] == "success"
        assert result["tasks_created"] > 0
```

### Extension Testing

```typescript
// src/test/suite/operationQueue.test.ts
import * as assert from 'assert';
import * as vscode from 'vscode';
import { OperationQueueManager } from '../../services/operationQueueManager';

suite('Operation Queue Tests', () => {
    let queueManager: OperationQueueManager;
    
    setup(async () => {
        // Initialize test environment
        const context = {
            extensionPath: '/test/path',
            subscriptions: []
        } as vscode.ExtensionContext;
        
        queueManager = new OperationQueueManager(context);
        await queueManager.initialize();
    });
    
    teardown(async () => {
        await queueManager.dispose();
    });
    
    test('should add operation to queue', async () => {
        const operation = {
            id: 'test_001',
            type: 'UPDATE_REQUIREMENTS',
            parameters: { content: 'test content' }
        };
        
        await queueManager.addOperation(operation);
        
        const status = await queueManager.getQueueStatus();
        assert.strictEqual(status.pending, 1);
    });
    
    test('should detect conflicts', async () => {
        const operation1 = {
            id: 'test_002',
            type: 'UPDATE_REQUIREMENTS',
            parameters: { spec_id: 'test', content: 'version 1' }
        };
        
        const operation2 = {
            id: 'test_003', 
            type: 'UPDATE_REQUIREMENTS',
            parameters: { spec_id: 'test', content: 'version 2' }
        };
        
        await queueManager.addOperation(operation1);
        await queueManager.addOperation(operation2);
        
        const conflicts = await queueManager.getConflicts();
        assert.strictEqual(conflicts.length, 1);
        assert.strictEqual(conflicts[0].type, 'concurrent_modification');
    });
    
    test('should resolve conflicts', async () => {
        // Create conflicting operations
        await createConflictingOperations();
        
        const conflicts = await queueManager.getConflicts();
        const conflict = conflicts[0];
        
        // Resolve with merge strategy
        const result = await queueManager.resolveConflict(
            conflict.id,
            'merge'
        );
        
        assert.strictEqual(result.status, 'success');
        
        // Verify conflict resolved
        const remainingConflicts = await queueManager.getConflicts();
        assert.strictEqual(remainingConflicts.length, 0);
    });
    
    async function createConflictingOperations() {
        // Helper to create test conflicts
        // Implementation details...
    }
});

// Integration tests with actual VS Code
suite('Integration Tests', () => {
    test('should work with VS Code file system', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(workspaceFolder, 'Workspace folder required for test');
        
        // Test file operations in real VS Code environment
        const specPath = vscode.Uri.joinPath(
            workspaceFolder.uri,
            '.specifications',
            'test-spec'
        );
        
        await vscode.workspace.fs.createDirectory(specPath);
        
        const requirementsFile = vscode.Uri.joinPath(specPath, 'requirements.md');
        const content = '# Test Requirements\n\nTest content';
        
        await vscode.workspace.fs.writeFile(
            requirementsFile,
            Buffer.from(content, 'utf8')
        );
        
        // Verify file was created
        const stat = await vscode.workspace.fs.stat(requirementsFile);
        assert.ok(stat.size > 0);
        
        // Clean up
        await vscode.workspace.fs.delete(specPath, { recursive: true });
    });
});
```

---

## API Integration

### REST API Client

```python
# examples/api_client.py
import httpx
import asyncio
from typing import Dict, Any, Optional

class SpecForgedAPIClient:
    """HTTP API client for SpecForged MCP server."""
    
    def __init__(self, base_url: str, api_key: Optional[str] = None):
        self.base_url = base_url.rstrip('/')
        self.client = httpx.AsyncClient()
        
        if api_key:
            self.client.headers['Authorization'] = f'Bearer {api_key}'
    
    async def call_tool(
        self, 
        tool_name: str, 
        arguments: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Call MCP tool via HTTP API."""
        
        response = await self.client.post(
            f'{self.base_url}/mcp/tools/call',
            json={
                'tool': tool_name,
                'arguments': arguments
            }
        )
        
        response.raise_for_status()
        return response.json()
    
    async def create_specification(
        self,
        name: str,
        description: str = "",
        spec_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """Create a new specification."""
        return await self.call_tool('create_spec', {
            'name': name,
            'description': description,
            'spec_id': spec_id
        })
    
    async def add_user_story(
        self,
        spec_id: str,
        as_a: str,
        i_want: str,
        so_that: str,
        ears_requirements: Optional[list] = None
    ) -> Dict[str, Any]:
        """Add user story to specification."""
        return await self.call_tool('add_requirement', {
            'spec_id': spec_id,
            'as_a': as_a,
            'i_want': i_want,
            'so_that': so_that,
            'ears_requirements': ears_requirements or []
        })
    
    async def get_queue_status(self) -> Dict[str, Any]:
        """Get operation queue status."""
        return await self.call_tool('get_queue_status', {})
    
    async def resolve_conflict(
        self,
        conflict_id: str,
        resolution: str,
        user_choice: Optional[str] = None
    ) -> Dict[str, Any]:
        """Resolve a conflict."""
        return await self.call_tool('resolve_conflict', {
            'conflict_id': conflict_id,
            'resolution': resolution,
            'user_choice': user_choice
        })
    
    async def close(self):
        """Close the HTTP client."""
        await self.client.aclose()

# Usage example
async def main():
    client = SpecForgedAPIClient('http://localhost:8080')
    
    try:
        # Create specification
        spec = await client.create_specification(
            name="API Example Project",
            description="Demonstration of API usage"
        )
        
        print(f"Created specification: {spec['spec_id']}")
        
        # Add user story
        story = await client.add_user_story(
            spec_id=spec['spec_id'],
            as_a="developer",
            i_want="to use the API effectively",
            so_that="I can integrate SpecForged into my workflow"
        )
        
        print(f"Added user story: {story['story_id']}")
        
        # Monitor queue
        status = await client.get_queue_status()
        print(f"Queue status: {status['queue_stats']}")
        
    finally:
        await client.close()

if __name__ == '__main__':
    asyncio.run(main())
```

### WebSocket Integration

```javascript
// examples/websocket_client.js
class SpecForgedWebSocketClient {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.messageId = 0;
        this.pendingRequests = new Map();
    }
    
    async connect() {
        return new Promise((resolve, reject) => {
            this.ws = new WebSocket(this.url);
            
            this.ws.onopen = () => {
                console.log('Connected to SpecForged WebSocket');
                resolve();
            };
            
            this.ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                reject(error);
            };
            
            this.ws.onmessage = (event) => {
                this.handleMessage(JSON.parse(event.data));
            };
        });
    }
    
    handleMessage(message) {
        if (message.id && this.pendingRequests.has(message.id)) {
            const { resolve, reject } = this.pendingRequests.get(message.id);
            this.pendingRequests.delete(message.id);
            
            if (message.error) {
                reject(new Error(message.error.message));
            } else {
                resolve(message.result);
            }
        }
    }
    
    async callTool(toolName, arguments = {}) {
        const id = ++this.messageId;
        const message = {
            jsonrpc: '2.0',
            id,
            method: 'tools/call',
            params: {
                name: toolName,
                arguments
            }
        };
        
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });
            this.ws.send(JSON.stringify(message));
            
            // Set timeout
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error('Request timeout'));
                }
            }, 30000);
        });
    }
    
    async createSpecification(name, description = '', specId = null) {
        return this.callTool('create_spec', {
            name,
            description,
            spec_id: specId
        });
    }
    
    async monitorQueue() {
        // Set up real-time queue monitoring
        setInterval(async () => {
            try {
                const status = await this.callTool('get_queue_status');
                this.onQueueStatus(status);
            } catch (error) {
                console.error('Queue status error:', error);
            }
        }, 5000);
    }
    
    onQueueStatus(status) {
        console.log('Queue status:', status);
        // Handle queue status updates
    }
    
    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}

// Usage
(async () => {
    const client = new SpecForgedWebSocketClient('ws://localhost:8080/ws');
    
    try {
        await client.connect();
        
        const spec = await client.createSpecification(
            'WebSocket Example',
            'Testing WebSocket integration'
        );
        
        console.log('Created spec:', spec);
        
        // Start monitoring
        client.monitorQueue();
        
    } catch (error) {
        console.error('Error:', error);
    }
})();
```

---

## Contributing Guidelines

### Development Workflow

1. **Fork and Clone**
```bash
git clone https://github.com/yourusername/SpecForge.git
cd SpecForge
git remote add upstream https://github.com/whit3rabbit/SpecForge.git
```

2. **Create Feature Branch**
```bash
git checkout -b feature/your-feature-name
```

3. **Development Setup**
```bash
# Python environment
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install -e .

# Extension development
cd vscode-specforged/
npm install
```

4. **Make Changes**
- Follow existing code style and patterns
- Add tests for new functionality
- Update documentation as needed

5. **Run Tests**
```bash
# Python tests
python -m pytest tests/ -v

# Extension tests  
cd vscode-specforged/
npm test
```

6. **Submit Pull Request**
- Push to your fork
- Create pull request with clear description
- Link related issues
- Wait for review

### Code Style Guidelines

#### Python Code Style
```python
# Use black for formatting
black src/ tests/

# Follow PEP 8 with these exceptions:
# - Line length: 88 characters (black default)
# - Use double quotes for strings
# - Use type hints for all public functions

# Example function signature:
async def create_specification(
    name: str,
    description: str = "",
    spec_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    Create a new specification.
    
    Args:
        name: Specification name
        description: Optional description
        spec_id: Optional custom ID
        
    Returns:
        Dictionary with creation results
        
    Raises:
        ValueError: If name is invalid
    """
    pass
```

#### TypeScript Code Style
```typescript
// Use ESLint configuration in vscode-specforged/.eslintrc.json
// Key rules:
// - Use strict TypeScript
// - Prefer async/await over Promises
// - Use descriptive variable names
// - Add JSDoc comments for public methods

/**
 * Manages MCP operation queue processing.
 */
export class OperationQueueManager {
    private readonly queuePath: string;
    
    constructor(private readonly context: vscode.ExtensionContext) {
        this.queuePath = path.join(
            context.extensionPath,
            '.vscode',
            'specforged',
            'operation_queue.json'
        );
    }
    
    /**
     * Add operation to the processing queue.
     * @param operation - Operation to add
     * @returns Promise resolving when operation is queued
     */
    public async addOperation(operation: McpOperation): Promise<void> {
        // Implementation
    }
}
```

### Testing Requirements

#### New Features Must Include:
- Unit tests with >90% coverage
- Integration tests for MCP tools
- Extension tests for UI components
- Documentation updates
- Example usage code

#### Test Structure:
```
tests/
├── unit/              # Unit tests
│   ├── test_core/     # Core functionality tests
│   ├── test_tools/    # MCP tool tests
│   └── test_models/   # Data model tests
├── integration/       # Integration tests
│   ├── test_server/   # Server integration
│   └── test_queue/    # Queue processing tests
└── fixtures/          # Test data and fixtures

vscode-specforged/src/test/
├── suite/             # VS Code extension tests
├── mocks/             # Mock objects for testing
└── fixtures/          # Test data
```

### Documentation Standards

- All public APIs must have docstrings/JSDoc
- README updates for new features
- API documentation updates
- Example code for new functionality
- Migration guides for breaking changes

### Release Process

1. **Version Bumping**
```bash
# Update version in relevant files:
# - pyproject.toml
# - src/specforged/__init__.py
# - vscode-specforged/package.json
```

2. **Changelog Update**
```bash
# Update CHANGELOG.md with:
# - New features
# - Bug fixes
# - Breaking changes
# - Migration notes
```

3. **Testing**
```bash
# Run full test suite
python scripts/dev.py all
cd vscode-specforged && npm test
```

4. **Release**
```bash
# Create release tag
git tag v0.3.2
git push origin v0.3.2

# Python package (maintainers only)
python -m build
twine upload dist/*

# VS Code extension (maintainers only)
cd vscode-specforged/
vsce package
vsce publish
```

This developer guide provides comprehensive coverage of the SpecForged MCP ecosystem architecture, development practices, and contribution guidelines. For specific questions, please refer to the GitHub discussions or create an issue.