"""
Web Application Project Template for SpecForge
"""

from typing import Any, Dict, List


def get_web_app_template() -> Dict[str, Any]:
    """Get web application project template"""
    return {
        "name": "Web Application Template",
        "description": "Full-stack web application with frontend and backend",
        "user_stories": [
            {
                "as_a": "user",
                "i_want": "create an account and log into the application",
                "so_that": "I can access personalized features and data",
                "ears_requirements": [
                    {
                        "condition": "WHEN a new user registers with valid information",
                        "system_response": (
                            "create an account and send confirmation email"
                        ),
                    },
                    {
                        "condition": "WHEN a user enters correct login credentials",
                        "system_response": ("authenticate and redirect to dashboard"),
                    },
                    {
                        "condition": "IF login credentials are invalid",
                        "system_response": (
                            "display error message and remain on login page"
                        ),
                    },
                ],
            },
            {
                "as_a": "user",
                "i_want": "have a responsive user interface that works on all devices",
                "so_that": "I can use the application on desktop, tablet, and mobile",
                "ears_requirements": [
                    {
                        "condition": "WHEN accessed on mobile devices",
                        "system_response": "display mobile-optimized interface",
                    },
                    {
                        "condition": "WHILE the viewport is resized",
                        "system_response": "adapt layout responsively",
                    },
                ],
            },
            {
                "as_a": "user",
                "i_want": "manage my profile and account settings",
                "so_that": "I can keep my information up to date",
                "ears_requirements": [
                    {
                        "condition": "WHEN user updates profile information",
                        "system_response": (
                            "validate and save changes with confirmation"
                        ),
                    },
                    {
                        "condition": "IF user changes password",
                        "system_response": (
                            "require current password and validate new password "
                            "strength"
                        ),
                    },
                ],
            },
        ],
        "architecture": (
            "Three-tier architecture with presentation, business logic, and data layers"
        ),
        "components": [
            {
                "name": "Frontend Application",
                "description": (
                    "React/Vue.js SPA with responsive design and state management"
                ),
            },
            {
                "name": "Backend API",
                "description": (
                    "REST API server handling business logic and data operations"
                ),
            },
            {
                "name": "Authentication Service",
                "description": "JWT-based authentication with user management",
            },
            {
                "name": "Database Layer",
                "description": "Relational database for persistent data storage",
            },
            {
                "name": "File Storage",
                "description": ("Cloud storage for user-uploaded files and assets"),
            },
        ],
        "data_models": """
interface User {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  avatar?: string;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
}
interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}
interface UserProfile {
  userId: string;
  bio?: string;
  location?: string;
  website?: string;
  preferences: Record<string, any>;
}
        """.strip(),
        "sequence_diagrams": [
            {
                "title": "User Registration Flow",
                "mermaid": """
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant A as Auth Service
    participant D as Database
    participant E as Email Service
    U->>F: Submit registration form
    F->>A: POST /auth/register
    A->>D: Check if email exists
    D-->>A: Email available
    A->>D: Create user record
    D-->>A: User created
    A->>E: Send confirmation email
    E-->>A: Email sent
    A-->>F: Registration successful
    F-->>U: Show confirmation message
                """.strip(),
            },
            {
                "title": "User Login Flow",
                "mermaid": """
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant A as Auth Service
    participant D as Database
    U->>F: Enter credentials
    F->>A: POST /auth/login
    A->>D: Validate credentials
    D-->>A: Credentials valid
    A->>A: Generate JWT token
    A-->>F: Return token + user data
    F->>F: Store token
    F-->>U: Redirect to dashboard
                """.strip(),
            },
        ],
    }


def get_web_app_tasks() -> List[str]:
    """Get common web app implementation tasks"""
    return [
        "Set up project structure and development environment",
        "Configure build tools and development server",
        "Implement user authentication system",
        "Create responsive UI components",
        "Set up state management",
        "Implement API endpoints",
        "Configure database and migrations",
        "Add form validation and error handling",
        "Implement file upload functionality",
        "Add unit and integration tests",
        "Set up CI/CD pipeline",
        "Configure production deployment",
    ]
