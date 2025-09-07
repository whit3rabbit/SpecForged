import * as vscode from 'vscode';
import * as path from 'path';
import { Specification, ParsedSpecification, SpecificationFile, Task, UserStory, WorkflowPhase, SpecStatus } from '../models/specification';
import { TaskHelper } from '../models/task';

export class SpecParser {
    static async parseSpecificationDirectory(specDir: vscode.Uri): Promise<ParsedSpecification | null> {
        try {
            const files = await vscode.workspace.fs.readDirectory(specDir);
            const parsedSpec: ParsedSpecification = {
                spec: this.createDefaultSpecification(path.basename(specDir.fsPath)),
                files: {}
            };

            // Read and parse each file
            for (const [fileName, fileType] of files) {
                if (fileType === vscode.FileType.File) {
                    const filePath = vscode.Uri.joinPath(specDir, fileName);
                    const file = await this.readSpecificationFile(filePath);

                    if (file) {
                        switch (fileName) {
                            case 'spec.json':
                                parsedSpec.files.spec = file;
                                parsedSpec.spec = await this.parseSpecJson(file);
                                break;
                            case 'requirements.md':
                                parsedSpec.files.requirements = file;
                                break;
                            case 'design.md':
                                parsedSpec.files.design = file;
                                break;
                            case 'tasks.md':
                                parsedSpec.files.tasks = file;
                                parsedSpec.spec.tasks = await this.parseTasksMarkdown(file);
                                break;
                        }
                    }
                }
            }

            // Update spec metadata from files
            parsedSpec.spec.id = path.basename(specDir.fsPath);
            parsedSpec.spec.updated_at = new Date().toISOString();

            return parsedSpec;
        } catch (error) {
            console.error('Error parsing specification directory:', error);
            return null;
        }
    }

    private static async readSpecificationFile(filePath: vscode.Uri): Promise<SpecificationFile | null> {
        try {
            const content = await vscode.workspace.fs.readFile(filePath);
            const stat = await vscode.workspace.fs.stat(filePath);

            return {
                path: filePath.fsPath,
                content: Buffer.from(content).toString('utf8'),
                lastModified: stat.mtime
            };
        } catch (error) {
            console.error(`Error reading file ${filePath.fsPath}:`, error);
            return null;
        }
    }

    private static createDefaultSpecification(id: string): Specification {
        return {
            id,
            name: id.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            description: '',
            status: SpecStatus.DRAFT,
            phase: WorkflowPhase.IDLE,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            user_stories: [],
            tasks: [],
            is_current: false
        };
    }

    private static async parseSpecJson(file: SpecificationFile): Promise<Specification> {
        try {
            const json = JSON.parse(file.content);
            return {
                ...this.createDefaultSpecification(json.id || 'unknown'),
                ...json
            };
        } catch (error) {
            console.error('Error parsing spec.json:', error);
            return this.createDefaultSpecification('unknown');
        }
    }

    private static async parseTasksMarkdown(file: SpecificationFile): Promise<Task[]> {
        const tasks: Task[] = [];
        const lines = file.content.split('\n');
        let currentTask: Task | null = null;

        for (const line of lines) {
            const trimmedLine = line.trim();

            // Match checkbox pattern: - [x] 1.2.3. Task title
            const taskMatch = trimmedLine.match(/^-\s*(\[[ x]\])\s*([0-9.]+)\.\s*(.+)$/);

            if (taskMatch) {
                const [, checkbox, taskNumber, title] = taskMatch;
                const status = checkbox === '[x]' ? 'completed' : 'pending';

                const task: Task = {
                    id: `task-${taskNumber}`,
                    title: title.trim(),
                    description: '',
                    status,
                    task_number: taskNumber,
                    dependencies: [],
                    subtasks: [],
                    linked_requirements: [],
                    estimated_hours: 0,
                    actual_hours: 0,
                    parent_id: ''
                };

                // Extract requirements from the line
                const reqMatch = title.match(/_Requirements?:\s*([^_]+)_/);
                if (reqMatch) {
                    task.linked_requirements = reqMatch[1].split(',').map(r => r.trim());
                    task.title = title.replace(reqMatch[0], '').trim();
                }

                tasks.push(task);
                currentTask = task;
            } else if (currentTask && trimmedLine.startsWith('-') && trimmedLine.includes('_Requirements')) {
                // Handle description with requirements on separate line
                const reqMatch = trimmedLine.match(/_Requirements?:\s*([^_]+)_/);
                if (reqMatch) {
                    currentTask.linked_requirements = reqMatch[1].split(',').map(r => r.trim());
                }
            } else if (currentTask && trimmedLine && !trimmedLine.startsWith('#') && !trimmedLine.startsWith('*')) {
                // Add to description if it's additional content
                if (currentTask.description) {
                    currentTask.description += '\n' + trimmedLine;
                } else {
                    currentTask.description = trimmedLine;
                }
            }
        }

        return TaskHelper.sortTasksByNumber(tasks);
    }

    static parseRequirementsMarkdown(content: string): UserStory[] {
        const stories: UserStory[] = [];
        const sections = content.split(/## User Story/);

        for (let i = 1; i < sections.length; i++) {
            const section = sections[i];
            const lines = section.split('\n');

            // Extract story ID from first line
            const idMatch = lines[0].match(/^(\S+)/);
            const id = idMatch ? idMatch[1] : `US-${i.toString().padStart(3, '0')}`;

            // Find story components
            let as_a = '';
            let i_want = '';
            let so_that = '';

            for (const line of lines) {
                const asMatch = line.match(/\*\*As a\*\*\s+(.+),?/);
                const wantMatch = line.match(/\*\*I want\*\*\s+(.+),?/);
                const soMatch = line.match(/\*\*So that\*\*\s+(.+)/);

                if (asMatch) as_a = asMatch[1];
                if (wantMatch) i_want = wantMatch[1];
                if (soMatch) so_that = soMatch[1];
            }

            if (as_a && i_want && so_that) {
                stories.push({
                    id,
                    as_a,
                    i_want,
                    so_that,
                    requirements: []
                });
            }
        }

        return stories;
    }

    static extractEARSRequirements(content: string): { pattern: string; requirement: string }[] {
        const requirements: { pattern: string; requirement: string }[] = [];
        const lines = content.split('\n');

        for (const line of lines) {
            const trimmed = line.trim();

            // Match EARS patterns
            const earsPatterns = [
                /^WHEN\s+(.+)\s+THE SYSTEM SHALL\s+(.+)$/i,
                /^WHILE\s+(.+)\s+THE SYSTEM SHALL\s+(.+)$/i,
                /^WHERE\s+(.+)\s+THE SYSTEM SHALL\s+(.+)$/i,
                /^IF\s+(.+)\s+THEN THE SYSTEM SHALL\s+(.+)$/i,
                /^THE SYSTEM SHALL\s+(.+)$/i
            ];

            for (const pattern of earsPatterns) {
                const match = trimmed.match(pattern);
                if (match) {
                    requirements.push({
                        pattern: pattern.source,
                        requirement: trimmed
                    });
                    break;
                }
            }
        }

        return requirements;
    }
}
