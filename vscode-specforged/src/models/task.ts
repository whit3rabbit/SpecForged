export interface TaskProgress {
    total: number;
    completed: number;
    in_progress: number;
    pending: number;
    percentage: number;
}

export interface TaskStatistics {
    totalTasks: number;
    completedTasks: number;
    pendingTasks: number;
    inProgressTasks: number;
    completionPercentage: number;
    estimatedHours: number;
    actualHours: number;
}

export class TaskHelper {
    static parseTaskNumber(taskNumber: string): { level: number; numbers: number[] } {
        const parts = taskNumber.split('.').map(n => parseInt(n, 10));
        return {
            level: parts.length,
            numbers: parts
        };
    }

    static isSubtaskOf(childNumber: string, parentNumber: string): boolean {
        if (childNumber === parentNumber) {
            return false;
        }

        return childNumber.startsWith(parentNumber + '.');
    }

    static getParentTaskNumber(taskNumber: string): string | null {
        const parts = taskNumber.split('.');
        if (parts.length <= 1) {
            return null;
        }
        return parts.slice(0, -1).join('.');
    }

    static sortTasksByNumber(tasks: any[]): any[] {
        return tasks.sort((a, b) => {
            const aParts = a.task_number.split('.').map((n: string) => parseInt(n, 10));
            const bParts = b.task_number.split('.').map((n: string) => parseInt(n, 10));

            const maxLength = Math.max(aParts.length, bParts.length);

            for (let i = 0; i < maxLength; i++) {
                const aVal = aParts[i] || 0;
                const bVal = bParts[i] || 0;

                if (aVal !== bVal) {
                    return aVal - bVal;
                }
            }

            return 0;
        });
    }

    static calculateProgress(tasks: any[]): TaskProgress {
        const total = tasks.length;
        const completed = tasks.filter(t => t.status === 'completed').length;
        const in_progress = tasks.filter(t => t.status === 'in_progress').length;
        const pending = tasks.filter(t => t.status === 'pending').length;

        return {
            total,
            completed,
            in_progress,
            pending,
            percentage: total > 0 ? Math.round((completed / total) * 100) : 0
        };
    }

    static getCheckboxSymbol(status: string): string {
        return status === 'completed' ? '[x]' : '[ ]';
    }

    static getStatusIcon(status: string): string {
        switch (status) {
            case 'completed':
                return '$(check)';
            case 'in_progress':
                return '$(loading~spin)';
            case 'pending':
                return '$(circle-outline)';
            default:
                return '$(circle-outline)';
        }
    }
}
