## Example - TODO List App

````bash
Use specforged to create a spec for a TODO list app that supports creating, editing, completing, and filtering tasks.
```

Here is output form Claude Code:

```bash
╭──────────────────────────────────────────────────────────╮
│ ✻ Welcome to Claude Code!                                │
│                                                          │
│   /help for help, /status for your current setup         │
│                                                          │
│   cwd: /Users/whit3rabbit/Documents/GitHub/example-todo  │
╰──────────────────────────────────────────────────────────╯

 Tips for getting started:

  Ask Claude to create a new app or clone a repository
  Use Claude to help with file analysis, editing, bash commands and git
  Be as specific as you would with another engineer for the best results
  ✔ Run /terminal-setup to set up terminal integration

> /mcp
  ⎿  (no content)

> Use specforged to create a spec for a TODO list app that supports creating, editing, completing, and
  filtering tasks.

⏺ I'll use SpecForge to create a comprehensive specification for a TODO list app. Let me start by creating
   the spec and then build out the requirements, design, and implementation plan.

⏺ whit-3-rabbit-specforged - create_spec (MCP)(name: "todo-list-app", description: "A comprehensive TODO
                                             list application with task management and filtering
                                             capabilities")
  ⎿  {
       "spec_id": "todo-list-app",
       "name": "todo-list-app",
     … +9 lines (ctrl+r to expand)

⏺ Now let me add the core requirements as user stories with EARS-formatted acceptance criteria:

⏺ whit-3-rabbit-specforged - add_requirement (MCP)(spec_id: "todo-list-app", as_a: "user", i_want: "to
                                                 create new tasks", so_that: "I can track things I need to
                                                  do", ears_requirements: [{"condition":"WHEN the user
                                                 clicks the 'Add Task' button","system_response":"the
                                                 system SHALL display a task creation
                                                 form"},{"condition":"WHEN the user enters a task title
                                                 and clicks 'Save'","system_response":"the system SHALL
                                                 create a new task with the given title and add it to the
                                                 task list"},{"condition":"WHEN the user attempts to
                                                 create a task with an empty title","system_response":"the
                                                  system SHALL display an error message and prevent task
                                                 creation"}])
  ⎿  {
       "status": "success",
       "story_id": "US-001",
     … +11 lines (ctrl+r to expand)

⏺ whit-3-rabbit-specforged - add_requirement (MCP)(spec_id: "todo-list-app", as_a: "user", i_want: "to edit
                                                  existing tasks", so_that: "I can update task details or
                                                 correct mistakes", ears_requirements: [{"condition":"WHEN
                                                  the user clicks the 'Edit' button on a
                                                 task","system_response":"the system SHALL display an
                                                 editable form with the current task
                                                 details"},{"condition":"WHEN the user modifies task
                                                 details and clicks 'Save'","system_response":"the system
                                                 SHALL update the task with the new
                                                 information"},{"condition":"WHEN the user clicks 'Cancel'
                                                  during editing","system_response":"the system SHALL
                                                 discard changes and return to the normal task view"}])
  ⎿  {
       "status": "success",
       "story_id": "US-002",
     … +12 lines (ctrl+r to expand)

⏺ whit-3-rabbit-specforged - add_requirement (MCP)(spec_id: "todo-list-app", as_a: "user", i_want: "to mark
                                                  tasks as completed", so_that: "I can track my progress
                                                 and see what I've accomplished", ears_requirements:
                                                 [{"condition":"WHEN the user clicks the checkbox next to
                                                 an incomplete task","system_response":"the system SHALL
                                                 mark the task as completed and visually indicate
                                                 completion"},{"condition":"WHEN the user clicks the
                                                 checkbox next to a completed task","system_response":"the
                                                  system SHALL mark the task as
                                                 incomplete"},{"condition":"WHEN a task is marked as
                                                 completed","system_response":"the system SHALL update the
                                                  task's completion timestamp"}])
  ⎿  {
       "status": "success",
       "story_id": "US-003",
     … +12 lines (ctrl+r to expand)

⏺ whit-3-rabbit-specforged - add_requirement (MCP)(spec_id: "todo-list-app", as_a: "user", i_want: "to
                                                 filter tasks by their completion status", so_that: "I can
                                                  focus on specific types of tasks", ears_requirements:
                                                 [{"condition":"WHEN the user selects the 'All'
                                                 filter","system_response":"the system SHALL display all
                                                 tasks regardless of completion
                                                 status"},{"condition":"WHEN the user selects the 'Active'
                                                  filter","system_response":"the system SHALL display only
                                                  incomplete tasks"},{"condition":"WHEN the user selects
                                                 the 'Completed' filter","system_response":"the system
                                                 SHALL display only completed tasks"}])
  ⎿  {
       "status": "success",
       "story_id": "US-004",
     … +12 lines (ctrl+r to expand)

⏺ whit-3-rabbit-specforged - add_requirement (MCP)(spec_id: "todo-list-app", as_a: "user", i_want: "to
                                                 delete tasks I no longer need", so_that: "I can keep my
                                                 task list clean and organized", ears_requirements:
                                                 [{"condition":"WHEN the user clicks the 'Delete' button
                                                 on a task","system_response":"the system SHALL show a
                                                 confirmation dialog"},{"condition":"WHEN the user
                                                 confirms deletion","system_response":"the system SHALL
                                                 permanently remove the task from the
                                                 list"},{"condition":"WHEN the user cancels
                                                 deletion","system_response":"the system SHALL close the
                                                 confirmation dialog without deleting the task"}])
  ⎿  {
       "status": "success",
       "story_id": "US-005",
     … +12 lines (ctrl+r to expand)

⏺ Now let me transition to the design phase and create the technical design:

⏺ whit-3-rabbit-specforged - transition_workflow_phase (MCP)(spec_id: "todo-list-app", target_phase:
                                                           "design")
  ⎿  {
       "status": "success",
       "spec_id": "todo-list-app",
     … +4 lines (ctrl+r to expand)

⏺ whit-3-rabbit-specforged - update_design (MCP)(spec_id: "todo-list-app", architecture: "A client-side
                                               React application with local storage persistence. The app
                                               follows a component-based architecture with centralized
                                               state management using React Context API. Components are
                                               organized into containers (smart components) and
                                               presentational components (dumb components) following React
                                                best practices.", components:
                                               [{"name":"App","description":"Root component that provides
                                               global context and
                                               routing"},{"name":"TaskProvider","description":"Context
                                               provider for task state management and
                                               actions"},{"name":"TaskList","description":"Container
                                               component that manages task display and
                                               filtering"},{"name":"TaskItem","description":"Individual
                                               task component with edit, complete, and delete
                                               functionality"},{"name":"TaskForm","description":"Form
                                               component for creating and editing
                                               tasks"},{"name":"FilterBar","description":"Component for
                                               task filtering controls (All, Active,
                                               Completed)"},{"name":"TaskCounter","description":"Displays
                                               count of active/completed tasks"}], data_models:
                                               "```typescript\ninterface Task {\n  id: string;\n  title:
                                               string;\n  description?: string;\n  completed: boolean;\n
                                               createdAt: Date;\n  updatedAt: Date;\n  completedAt?:
                                               Date;\n}\n\ninterface TaskState {\n  tasks: Task[];\n
                                               filter: FilterType;\n  editingTaskId: string |
                                               null;\n}\n\ntype FilterType = 'all' | 'active' |
                                               'completed';\n\ninterface TaskContextType {\n  state:
                                               TaskState;\n  actions: {\n    addTask: (task: Omit<Task,
                                               'id' | 'createdAt' | 'updatedAt'>) => void;\n
                                               updateTask: (id: string, updates: Partial<Task>) => void;\n
                                                   deleteTask: (id: string) => void;\n    toggleComplete:
                                               (id: string) => void;\n    setFilter: (filter: FilterType)
                                               => void;\n    setEditingTask: (id: string | null) =>
                                               void;\n  };\n}\n```", sequence_diagrams: [{"title":"Create
                                               New Task","mermaid":"sequenceDiagram\n    participant U as
                                               User\n    participant F as TaskForm\n    participant C as
                                               TaskContext\n    participant S as LocalStorage\n\n
                                               U->>F: Enter task title and click Save\n    F->>F: Validate
                                                input\n    F->>C: Call addTask()\n    C->>C: Generate
                                               unique ID and timestamps\n    C->>C: Update state with new
                                               task\n    C->>S: Persist updated tasks\n    C->>F: Trigger
                                               re-render\n    F->>U: Show updated task
                                               list"},{"title":"Filter Tasks","mermaid":"sequenceDiagram\n
                                                   participant U as User\n    participant FB as
                                               FilterBar\n    participant C as TaskContext\n
                                               participant TL as TaskList\n\n    U->>FB: Click filter
                                               button (All/Active/Completed)\n    FB->>C: Call
                                               setFilter(filterType)\n    C->>C: Update filter state\n
                                               C->>TL: Trigger re-render\n    TL->>TL: Apply filter to
                                               task list\n    TL->>U: Display filtered tasks"}])
  ⎿  Error: Error executing tool update_design: 'content'

⏺ whit-3-rabbit-specforged - update_design (MCP)(spec_id: "todo-list-app", architecture: "A client-side
                                               React application with local storage persistence. The app
                                               follows a component-based architecture with centralized
                                               state management using React Context API. Components are
                                               organized into containers (smart components) and
                                               presentational components (dumb components) following React
                                                best practices.", components:
                                               [{"name":"App","description":"Root component that provides
                                               global context and
                                               routing"},{"name":"TaskProvider","description":"Context
                                               provider for task state management and
                                               actions"},{"name":"TaskList","description":"Container
                                               component that manages task display and
                                               filtering"},{"name":"TaskItem","description":"Individual
                                               task component with edit, complete, and delete
                                               functionality"},{"name":"TaskForm","description":"Form
                                               component for creating and editing
                                               tasks"},{"name":"FilterBar","description":"Component for
                                               task filtering controls (All, Active,
                                               Completed)"},{"name":"TaskCounter","description":"Displays
                                               count of active/completed tasks"}], data_models: "interface
                                                Task {\\n  id: string;\\n  title: string;\\n
                                               description?: string;\\n  completed: boolean;\\n
                                               createdAt: Date;\\n  updatedAt: Date;\\n  completedAt?:
                                               Date;\\n}\\n\\ninterface TaskState {\\n  tasks: Task[];\\n
                                                filter: FilterType;\\n  editingTaskId: string |
                                               null;\\n}\\n\\ntype FilterType = 'all' | 'active' |
                                               'completed';\\n\\ninterface TaskContextType {\\n  state:
                                               TaskState;\\n  actions: {\\n    addTask: (task: Omit<Task,
                                               'id' | 'createdAt' | 'updatedAt'>) => void;\\n
                                               updateTask: (id: string, updates: Partial<Task>) =>
                                               void;\\n    deleteTask: (id: string) => void;\\n
                                               toggleComplete: (id: string) => void;\\n    setFilter:
                                               (filter: FilterType) => void;\\n    setEditingTask: (id:
                                               string | null) => void;\\n  };\\n}", sequence_diagrams:
                                               [{"title":"Create New Task","content":"sequenceDiagram\n
                                                participant U as User\n    participant F as TaskForm\n
                                               participant C as TaskContext\n    participant S as
                                               LocalStorage\n\n    U->>F: Enter task title and click
                                               Save\n    F->>F: Validate input\n    F->>C: Call
                                               addTask()\n    C->>C: Generate unique ID and timestamps\n
                                                 C->>C: Update state with new task\n    C->>S: Persist
                                               updated tasks\n    C->>F: Trigger re-render\n    F->>U:
                                               Show updated task list"},{"title":"Filter
                                               Tasks","content":"sequenceDiagram\n    participant U as
                                               User\n    participant FB as FilterBar\n    participant C as
                                                TaskContext\n    participant TL as TaskList\n\n    U->>FB:
                                                Click filter button (All/Active/Completed)\n    FB->>C:
                                               Call setFilter(filterType)\n    C->>C: Update filter
                                               state\n    C->>TL: Trigger re-render\n    TL->>TL: Apply
                                               filter to task list\n    TL->>U: Display filtered tasks"}])
  ⎿  {
       "status": "success",
       "spec_id": "todo-list-app",
     … +8 lines (ctrl+r to expand)

⏺ Now let me transition to the implementation planning phase and generate a comprehensive implementation
  plan:

⏺ whit-3-rabbit-specforged - transition_workflow_phase (MCP)(spec_id: "todo-list-app", target_phase:
                                                           "implementation_planning")
  ⎿  {
       "status": "success",
       "spec_id": "todo-list-app",
     … +4 lines (ctrl+r to expand)

⏺ whit-3-rabbit-specforged - generate_implementation_plan (MCP)(spec_id: "todo-list-app")
  ⎿  {
       "status": "success",
       "spec_id": "todo-list-app",
     … +10 lines (ctrl+r to expand)

⏺ Let me get the full specification details to show you what's been created:

⏺ whit-3-rabbit-specforged - get_specification_details (MCP)(spec_id: "todo-list-app", include_content:
                                                           true)
  ⎿  {
       "id": "todo-list-app",
       "name": "todo-list-app",
     … +661 lines (ctrl+r to expand)

⏺ Perfect! I've successfully created a comprehensive specification for your TODO list app using SpecForge.
   Here's what's been created:

  📋 TODO List App Specification

  Spec ID: todo-list-appCurrent Phase: Implementation PlanningStatus: Draft

  🎯 User Stories (5 total)

  1. Create new tasks - Track things to do
  2. Edit existing tasks - Update task details or correct mistakes
  3. Mark tasks as completed - Track progress and accomplishments
  4. Filter tasks by completion status - Focus on specific types of tasks
  5. Delete tasks - Keep task list clean and organized

  🏗️ Technical Design

  - Architecture: Client-side React app with local storage persistence
  - State Management: React Context API
  - Components: 7 main components (App, TaskProvider, TaskList, TaskItem, TaskForm, FilterBar,
  TaskCounter)
  - Data Models: TypeScript interfaces for Task, TaskState, and TaskContextType

  📝 Implementation Plan (18 main tasks, 33 total)

  The implementation plan includes:
  - Project setup and structure
  - Component implementation for all 7 components
  - Feature implementation for all user stories with EARS requirements
  - Testing (unit and integration)
  - Documentation and deployment

  🔄 Next Steps

  The spec is ready for implementation! You can:

  1. View task details: Use get_task_details to see specific tasks
  2. Start execution: Transition to execution phase and begin implementing
  3. Track progress: Mark tasks as completed as you work through them

  The specification includes detailed EARS (Event, Action, Response, System) formatted requirements that
  clearly define the expected behavior for each feature, making implementation straightforward and
  testable.

╭─────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ >                                                                                                           │
╰─────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
  ? for shortcuts
  ````
