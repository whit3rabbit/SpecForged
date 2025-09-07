import * as vscode from 'vscode';
import * as path from 'path';
import { Specification, Task, UserStory, WorkflowPhase, SpecStatus } from '../models/specification';
import { TaskHelper } from '../models/task';

export interface FileOperationResult {
    success: boolean;
    message: string;
    data?: any;
    error?: string;
}

export interface SpecificationFileStructure {
    specJson: string;
    requirements: string;
    design: string;
    tasks: string;
}

export class FileOperationService {
    private workspaceFolders: readonly vscode.WorkspaceFolder[];
    private specFolderNames = ['.specifications', 'specifications'];

    constructor() {
        this.workspaceFolders = vscode.workspace.workspaceFolders || [];
    }

    async findSpecificationDirectory(): Promise<vscode.Uri | null> {
        for (const workspaceFolder of this.workspaceFolders) {
            for (const folderName of this.specFolderNames) {
                const specDir = vscode.Uri.joinPath(workspaceFolder.uri, folderName);
                try {
                    const stat = await vscode.workspace.fs.stat(specDir);
                    if (stat.type === vscode.FileType.Directory) {
                        return specDir;
                    }
                } catch {
                    // Directory doesn't exist, continue
                }
            }
        }
        return null;
    }

    async createSpecificationDirectory(): Promise<FileOperationResult> {
        if (this.workspaceFolders.length === 0) {
            return {
                success: false,
                message: 'No workspace folder found',
                error: 'WORKSPACE_NOT_FOUND'
            };
        }

        const workspaceFolder = this.workspaceFolders[0];
        const specDir = vscode.Uri.joinPath(workspaceFolder.uri, this.specFolderNames[0]);

        try {
            await vscode.workspace.fs.createDirectory(specDir);
            return {
                success: true,
                message: `Created specifications directory at ${specDir.fsPath}`,
                data: { path: specDir.fsPath }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to create specifications directory: ${error.message}`,
                error: 'DIRECTORY_CREATION_FAILED'
            };
        }
    }

    async createSpecification(
        name: string,
        description: string = '',
        specId?: string
    ): Promise<FileOperationResult> {
        const cleanSpecId = specId || this.generateSpecId(name);

        // Find or create specifications directory
        let specDir = await this.findSpecificationDirectory();
        if (!specDir) {
            const createResult = await this.createSpecificationDirectory();
            if (!createResult.success) {
                return createResult;
            }
            specDir = await this.findSpecificationDirectory();
            if (!specDir) {
                return {
                    success: false,
                    message: 'Failed to locate specifications directory after creation',
                    error: 'DIRECTORY_NOT_FOUND'
                };
            }
        }

        // Create individual spec directory
        const individualSpecDir = vscode.Uri.joinPath(specDir, cleanSpecId);

        try {
            // Check if spec already exists
            try {
                await vscode.workspace.fs.stat(individualSpecDir);
                return {
                    success: false,
                    message: `Specification '${cleanSpecId}' already exists`,
                    error: 'SPECIFICATION_EXISTS'
                };
            } catch {
                // Good, spec doesn't exist yet
            }

            await vscode.workspace.fs.createDirectory(individualSpecDir);

            // Generate initial file content
            const fileStructure = this.generateSpecificationFiles(cleanSpecId, name, description);

            // Create all files
            await Promise.all([
                this.writeFile(vscode.Uri.joinPath(individualSpecDir, 'spec.json'), fileStructure.specJson),
                this.writeFile(vscode.Uri.joinPath(individualSpecDir, 'requirements.md'), fileStructure.requirements),
                this.writeFile(vscode.Uri.joinPath(individualSpecDir, 'design.md'), fileStructure.design),
                this.writeFile(vscode.Uri.joinPath(individualSpecDir, 'tasks.md'), fileStructure.tasks)
            ]);

            return {
                success: true,
                message: `Specification '${name}' created successfully`,
                data: {
                    specId: cleanSpecId,
                    name,
                    path: individualSpecDir.fsPath,
                    files: {
                        spec: vscode.Uri.joinPath(individualSpecDir, 'spec.json').fsPath,
                        requirements: vscode.Uri.joinPath(individualSpecDir, 'requirements.md').fsPath,
                        design: vscode.Uri.joinPath(individualSpecDir, 'design.md').fsPath,
                        tasks: vscode.Uri.joinPath(individualSpecDir, 'tasks.md').fsPath
                    }
                }
            };

        } catch (error: any) {
            return {
                success: false,
                message: `Failed to create specification: ${error.message}`,
                error: 'SPECIFICATION_CREATION_FAILED'
            };
        }
    }

    async updateSpecificationFile(
        specId: string,
        fileName: 'requirements.md' | 'design.md' | 'tasks.md' | 'spec.json',
        content: string
    ): Promise<FileOperationResult> {
        const specDir = await this.findSpecificationDirectory();
        if (!specDir) {
            return {
                success: false,
                message: 'Specifications directory not found',
                error: 'DIRECTORY_NOT_FOUND'
            };
        }

        const filePath = vscode.Uri.joinPath(specDir, specId, fileName);

        try {
            await this.writeFile(filePath, content);
            return {
                success: true,
                message: `Updated ${fileName} for specification '${specId}'`,
                data: { path: filePath.fsPath }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to update ${fileName}: ${error.message}`,
                error: 'FILE_UPDATE_FAILED'
            };
        }
    }

    async deleteSpecification(specId: string): Promise<FileOperationResult> {
        const specDir = await this.findSpecificationDirectory();
        if (!specDir) {
            return {
                success: false,
                message: 'Specifications directory not found',
                error: 'DIRECTORY_NOT_FOUND'
            };
        }

        const individualSpecDir = vscode.Uri.joinPath(specDir, specId);

        try {
            await vscode.workspace.fs.delete(individualSpecDir, { recursive: true });
            return {
                success: true,
                message: `Specification '${specId}' deleted successfully`
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to delete specification: ${error.message}`,
                error: 'SPECIFICATION_DELETION_FAILED'
            };
        }
    }

    async readSpecificationFile(
        specId: string,
        fileName: 'requirements.md' | 'design.md' | 'tasks.md' | 'spec.json'
    ): Promise<FileOperationResult> {
        const specDir = await this.findSpecificationDirectory();
        if (!specDir) {
            return {
                success: false,
                message: 'Specifications directory not found',
                error: 'DIRECTORY_NOT_FOUND'
            };
        }

        const filePath = vscode.Uri.joinPath(specDir, specId, fileName);

        try {
            const content = await this.readFile(filePath);
            return {
                success: true,
                message: `Read ${fileName} for specification '${specId}'`,
                data: {
                    content,
                    path: filePath.fsPath
                }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to read ${fileName}: ${error.message}`,
                error: 'FILE_READ_FAILED'
            };
        }
    }

    async updateTaskStatus(
        specId: string,
        taskNumber: string,
        newStatus: 'pending' | 'in_progress' | 'completed'
    ): Promise<FileOperationResult> {
        const tasksResult = await this.readSpecificationFile(specId, 'tasks.md');
        if (!tasksResult.success) {
            return tasksResult;
        }

        const content = tasksResult.data!.content as string;
        const lines = content.split('\n');
        let updated = false;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            const taskMatch = line.match(/^-\s*(\[[ x]\])\s*([0-9.]+)\.\s*(.+)$/);

            if (taskMatch && taskMatch[2] === taskNumber) {
                const checkbox = newStatus === 'completed' ? '[x]' : '[ ]';
                const title = taskMatch[3];
                lines[i] = lines[i].replace(/^(\s*-\s*)\[[ x]\](\s*[0-9.]+\.\s*.+)$/, `$1${checkbox}$2`);
                updated = true;
                break;
            }
        }

        if (!updated) {
            return {
                success: false,
                message: `Task ${taskNumber} not found in specification '${specId}'`,
                error: 'TASK_NOT_FOUND'
            };
        }

        const updatedContent = lines.join('\n');
        return await this.updateSpecificationFile(specId, 'tasks.md', updatedContent);
    }

    async addUserStory(
        specId: string,
        asA: string,
        iWant: string,
        soThat: string,
        requirements: Array<{condition: string, systemResponse: string}> = []
    ): Promise<FileOperationResult> {
        const requirementsResult = await this.readSpecificationFile(specId, 'requirements.md');
        if (!requirementsResult.success) {
            return requirementsResult;
        }

        const content = requirementsResult.data!.content as string;

        // Generate story ID
        const storyCount = (content.match(/## User Story/g) || []).length;
        const storyId = `US-${(storyCount + 1).toString().padStart(3, '0')}`;

        // Generate user story markdown
        let storyMarkdown = `\n## User Story ${storyId}\n\n`;
        storyMarkdown += `**As a** ${asA},\n`;
        storyMarkdown += `**I want** ${iWant},\n`;
        storyMarkdown += `**So that** ${soThat}\n\n`;

        if (requirements.length > 0) {
            storyMarkdown += `### Acceptance Criteria (EARS Format)\n\n`;
            requirements.forEach((req, index) => {
                const reqId = `${storyId}-R${(index + 1).toString().padStart(2, '0')}`;
                storyMarkdown += `- [${reqId}] ${req.condition} THE SYSTEM SHALL ${req.systemResponse}\n`;
            });
        }

        const updatedContent = content + storyMarkdown;
        const updateResult = await this.updateSpecificationFile(specId, 'requirements.md', updatedContent);

        if (updateResult.success) {
            return {
                success: true,
                message: `Added user story ${storyId} to specification '${specId}'`,
                data: {
                    storyId,
                    requirements: requirements.map((req, index) => ({
                        id: `${storyId}-R${(index + 1).toString().padStart(2, '0')}`,
                        ...req
                    }))
                }
            };
        }

        return updateResult;
    }

    private async writeFile(uri: vscode.Uri, content: string): Promise<void> {
        const encoder = new TextEncoder();
        await vscode.workspace.fs.writeFile(uri, encoder.encode(content));
    }

    private async readFile(uri: vscode.Uri): Promise<string> {
        const decoder = new TextDecoder();
        const content = await vscode.workspace.fs.readFile(uri);
        return decoder.decode(content);
    }

    private generateSpecId(name: string): string {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, '')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .trim();
    }

    private generateSpecificationFiles(specId: string, name: string, description: string): SpecificationFileStructure {
        const now = new Date().toISOString();

        const specJson = JSON.stringify({
            id: specId,
            name: name,
            description: description,
            status: 'draft',
            phase: 'requirements',
            created_at: now,
            updated_at: now,
            user_stories: [],
            tasks: [],
            is_current: false
        }, null, 2);

        const requirements = `# Requirements Document

## Introduction

${description || 'This specification defines the requirements for ' + name + '.'}

## Requirements

Start adding user stories and EARS requirements here.

### Example User Story Format

**As a** [user role],
**I want** [functionality],
**So that** [benefit]

#### Acceptance Criteria (EARS Format)

- [REQ-001] WHEN [condition] THE SYSTEM SHALL [response]
- [REQ-002] IF [error condition] THEN THE SYSTEM SHALL [error response]
- [REQ-003] WHILE [state] THE SYSTEM SHALL [behavior]
- [REQ-004] WHERE [feature enabled] THE SYSTEM SHALL [capability]
- [REQ-005] THE SYSTEM SHALL [always do something]

## EARS Notation Reference

- **WHEN**: Event-driven requirements
- **IF...THEN**: Error handling and conditional responses
- **WHILE**: State-driven continuous behavior
- **WHERE**: Feature-specific requirements
- **THE SYSTEM SHALL**: Ubiquitous requirements (always active)
`;

        const design = `# Technical Design

## Introduction

${description || 'Technical design and architecture for ' + name + '.'}

## System Architecture

Describe the overall system architecture and design patterns.

## Components

### Component 1
Description of component functionality and responsibilities.

### Component 2
Description of component functionality and responsibilities.

## Data Models

\`\`\`typescript
interface ExampleModel {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}
\`\`\`

## API Design

Document REST endpoints, GraphQL schemas, or other interfaces.

### Endpoints

- \`GET /api/example\` - Retrieve example data
- \`POST /api/example\` - Create new example
- \`PUT /api/example/:id\` - Update existing example
- \`DELETE /api/example/:id\` - Delete example

## Security Considerations

Document authentication, authorization, and security measures.

## Performance Requirements

Define performance benchmarks and scalability requirements.
`;

        const tasks = `# Implementation Plan

## Progress Summary

- **Total Tasks:** 0
- **Completed:** 0
- **In Progress:** 0
- **Pending:** 0
- **Progress:** 0%

## Tasks

Implementation tasks will be generated automatically once requirements and design are complete.

Use the SpecForged MCP server or VS Code extension to:
1. Complete the requirements phase by adding user stories
2. Complete the design phase with technical specifications
3. Generate implementation tasks automatically from requirements and design

### Task Format

Tasks will appear in checkbox format like this:

- [ ] 1. Setup project structure
  - Initialize project with required dependencies
  - _Requirements: US-001-R01_

- [ ] 2. Implement core functionality
  - [ ] 2.1. Create main components
    - Build primary application components
    - _Requirements: US-001-R02, US-002-R01_
  - [ ] 2.2. Add data persistence
    - Implement database integration
    - _Requirements: US-001-R03_

Use the extension or MCP tools to:
- Toggle task completion status
- Track progress automatically
- Link tasks to specific requirements
- Estimate and track time
`;

        return {
            specJson,
            requirements,
            design,
            tasks
        };
    }

    async listSpecifications(): Promise<FileOperationResult> {
        const specDir = await this.findSpecificationDirectory();
        if (!specDir) {
            return {
                success: true,
                message: 'No specifications directory found',
                data: { specifications: [] }
            };
        }

        try {
            const entries = await vscode.workspace.fs.readDirectory(specDir);
            const specifications = [];

            for (const [name, type] of entries) {
                if (type === vscode.FileType.Directory) {
                    const specJsonPath = vscode.Uri.joinPath(specDir, name, 'spec.json');
                    try {
                        const content = await this.readFile(specJsonPath);
                        const specData = JSON.parse(content);
                        specifications.push({
                            ...specData,
                            path: vscode.Uri.joinPath(specDir, name).fsPath
                        });
                    } catch {
                        // Invalid spec directory, skip
                    }
                }
            }

            return {
                success: true,
                message: `Found ${specifications.length} specifications`,
                data: { specifications }
            };
        } catch (error: any) {
            return {
                success: false,
                message: `Failed to list specifications: ${error.message}`,
                error: 'LISTING_FAILED'
            };
        }
    }
}
