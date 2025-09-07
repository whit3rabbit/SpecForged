import * as vscode from 'vscode';
import * as path from 'path';
import { Specification, ParsedSpecification } from '../models/specification';
import { SpecParser } from './specParser';

export class SpecificationManager {
    private specifications: Map<string, ParsedSpecification> = new Map();
    private specificationFolders: string[] = ['.specifications', 'specifications'];

    constructor() {
        this.refresh();
    }

    async refresh(): Promise<void> {
        this.specifications.clear();

        if (!vscode.workspace.workspaceFolders) {
            return;
        }

        for (const workspaceFolder of vscode.workspace.workspaceFolders) {
            await this.scanWorkspaceForSpecs(workspaceFolder);
        }
    }

    private async scanWorkspaceForSpecs(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
        for (const folderName of this.specificationFolders) {
            const specsDir = vscode.Uri.joinPath(workspaceFolder.uri, folderName);

            try {
                const stat = await vscode.workspace.fs.stat(specsDir);
                if (stat.type === vscode.FileType.Directory) {
                    await this.scanSpecificationDirectory(specsDir);
                }
            } catch (error) {
                // Directory doesn't exist, continue
            }
        }
    }

    private async scanSpecificationDirectory(specsDir: vscode.Uri): Promise<void> {
        try {
            const entries = await vscode.workspace.fs.readDirectory(specsDir);

            for (const [name, type] of entries) {
                if (type === vscode.FileType.Directory) {
                    const specDir = vscode.Uri.joinPath(specsDir, name);
                    const parsedSpec = await SpecParser.parseSpecificationDirectory(specDir);

                    if (parsedSpec) {
                        this.specifications.set(parsedSpec.spec.id, parsedSpec);
                    }
                }
            }
        } catch (error) {
            console.error('Error scanning specification directory:', error);
        }
    }

    getSpecifications(): ParsedSpecification[] {
        return Array.from(this.specifications.values());
    }

    getSpecification(id: string): ParsedSpecification | undefined {
        return this.specifications.get(id);
    }

    hasSpecifications(): boolean {
        return this.specifications.size > 0;
    }

    getSpecificationCount(): number {
        return this.specifications.size;
    }

    getCurrentSpecification(): ParsedSpecification | undefined {
        for (const spec of this.specifications.values()) {
            if (spec.spec.is_current) {
                return spec;
            }
        }
        return undefined;
    }

    async findSpecificationDirectories(): Promise<vscode.Uri[]> {
        const dirs: vscode.Uri[] = [];

        if (!vscode.workspace.workspaceFolders) {
            return dirs;
        }

        for (const workspaceFolder of vscode.workspace.workspaceFolders) {
            for (const folderName of this.specificationFolders) {
                const specsDir = vscode.Uri.joinPath(workspaceFolder.uri, folderName);

                try {
                    const stat = await vscode.workspace.fs.stat(specsDir);
                    if (stat.type === vscode.FileType.Directory) {
                        dirs.push(specsDir);
                    }
                } catch (error) {
                    // Directory doesn't exist
                }
            }
        }

        return dirs;
    }

    async createSpecificationDirectory(workspaceFolder: vscode.WorkspaceFolder): Promise<vscode.Uri> {
        const specsDir = vscode.Uri.joinPath(workspaceFolder.uri, this.specificationFolders[0]);

        try {
            await vscode.workspace.fs.createDirectory(specsDir);
        } catch (error) {
            // Directory might already exist
        }

        return specsDir;
    }

    async getSpecificationFile(specId: string, fileName: string): Promise<string | undefined> {
        const spec = this.specifications.get(specId);
        if (!spec) {
            return undefined;
        }

        switch (fileName) {
            case 'requirements.md':
                return spec.files.requirements?.content;
            case 'design.md':
                return spec.files.design?.content;
            case 'tasks.md':
                return spec.files.tasks?.content;
            case 'spec.json':
                return spec.files.spec?.content;
            default:
                return undefined;
        }
    }

    async openSpecificationFile(specId: string, fileName: string): Promise<void> {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('No workspace folder found');
            return;
        }

        for (const workspaceFolder of vscode.workspace.workspaceFolders) {
            for (const folderName of this.specificationFolders) {
                const filePath = vscode.Uri.joinPath(
                    workspaceFolder.uri,
                    folderName,
                    specId,
                    fileName
                );

                try {
                    await vscode.workspace.fs.stat(filePath);
                    const document = await vscode.workspace.openTextDocument(filePath);
                    await vscode.window.showTextDocument(document);
                    return;
                } catch (error) {
                    // File doesn't exist in this location, try next
                }
            }
        }

        vscode.window.showErrorMessage(`File ${fileName} not found for specification ${specId}`);
    }

    getWorkspacePath(): string | undefined {
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            return vscode.workspace.workspaceFolders[0].uri.fsPath;
        }
        return undefined;
    }
}
