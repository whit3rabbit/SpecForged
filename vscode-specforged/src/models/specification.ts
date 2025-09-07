export enum WorkflowPhase {
    IDLE = 'idle',
    REQUIREMENTS = 'requirements',
    DESIGN = 'design',
    IMPLEMENTATION_PLANNING = 'implementation_planning',
    EXECUTION = 'execution',
    REVIEW = 'review',
    COMPLETED = 'completed'
}

export enum SpecStatus {
    DRAFT = 'draft',
    IN_REVIEW = 'in_review',
    APPROVED = 'approved',
    IN_PROGRESS = 'in_progress',
    COMPLETED = 'completed'
}

export interface EARSRequirement {
    id: string;
    condition: string;
    system_response: string;
    priority: 'HIGH' | 'MEDIUM' | 'LOW';
    acceptance_criteria: string[];
}

export interface UserStory {
    id: string;
    as_a: string;
    i_want: string;
    so_that: string;
    requirements: EARSRequirement[];
}

export interface Task {
    id: string;
    title: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed';
    task_number: string;
    dependencies: string[];
    subtasks: Task[];
    linked_requirements: string[];
    estimated_hours: number;
    actual_hours: number;
    parent_id: string;
}

export interface Specification {
    id: string;
    name: string;
    description: string;
    status: SpecStatus;
    phase: WorkflowPhase;
    created_at: string;
    updated_at: string;
    user_stories: UserStory[];
    tasks: Task[];
    current_task_id?: string;
    project_type?: string;
    is_current: boolean;
}

export interface SpecificationFile {
    path: string;
    content: string;
    lastModified: number;
}

export interface ParsedSpecification {
    spec: Specification;
    files: {
        requirements?: SpecificationFile;
        design?: SpecificationFile;
        tasks?: SpecificationFile;
        spec?: SpecificationFile;
    };
}
