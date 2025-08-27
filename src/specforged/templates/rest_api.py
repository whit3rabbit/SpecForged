"""
REST API Project Template for SpecForge
"""

from typing import Any, Dict, List


def get_rest_api_template() -> Dict[str, Any]:
    """Get REST API service project template"""
    return {
        "name": "REST API Service Template",
        "description": "RESTful API service with CRUD operations and authentication",
        "user_stories": [
            {
                "as_a": "API client",
                "i_want": "authenticate using API keys or tokens",
                "so_that": "I can securely access protected endpoints",
                "ears_requirements": [
                    {
                        "condition": "WHEN a request includes a valid API key",
                        "system_response": (
                            "process the request and return appropriate response"
                        ),
                    },
                    {
                        "condition": "IF API key is missing or invalid",
                        "system_response": "return 401 Unauthorized with error details",
                    },
                    {
                        "condition": "WHEN API key rate limit is exceeded",
                        "system_response": (
                            "return 429 Too Many Requests with retry information"
                        ),
                    },
                ],
            },
            {
                "as_a": "developer",
                "i_want": "perform CRUD operations on resources",
                "so_that": "I can manage data through the API",
                "ears_requirements": [
                    {
                        "condition": "WHEN creating a resource with valid data",
                        "system_response": (
                            "create the resource and return 201 Created with "
                            "resource data"
                        ),
                    },
                    {
                        "condition": "WHEN updating a resource that exists",
                        "system_response": (
                            "update the resource and return 200 OK with updated data"
                        ),
                    },
                    {
                        "condition": "IF requested resource does not exist",
                        "system_response": "return 404 Not Found with error message",
                    },
                ],
            },
            {
                "as_a": "client application",
                "i_want": "receive consistent error responses",
                "so_that": "I can handle errors appropriately",
                "ears_requirements": [
                    {
                        "condition": "WHEN validation errors occur",
                        "system_response": (
                            "return 400 Bad Request with detailed field errors"
                        ),
                    },
                    {
                        "condition": "IF server error occurs",
                        "system_response": (
                            "return 500 Internal Server Error with error ID for "
                            "tracking"
                        ),
                    },
                ],
            },
        ],
        "architecture": (
            "Layered REST API architecture with controllers, services, and "
            "data access layers"
        ),
        "components": [
            {
                "name": "API Gateway",
                "description": "Request routing, rate limiting, and API versioning",
            },
            {
                "name": "Authentication Middleware",
                "description": "JWT/API key validation and user context management",
            },
            {
                "name": "Controllers",
                "description": "HTTP request handlers and response formatting",
            },
            {
                "name": "Business Services",
                "description": "Core business logic and validation rules",
            },
            {
                "name": "Data Access Layer",
                "description": "Database operations and query optimization",
            },
            {
                "name": "Validation Layer",
                "description": "Input validation and sanitization",
            },
        ],
        "data_models": """
interface APIKey {
  id: string;
  keyHash: string;
  userId: string;
  name: string;
  permissions: string[];
  rateLimit: number;
  isActive: boolean;
  createdAt: Date;
  expiresAt?: Date;
}
interface APIResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, any>;
  };
  meta?: {
    pagination?: {
      page: number;
      limit: number;
      total: number;
    };
  };
}
interface Resource {
  id: string;
  name: string;
  description: string;
  status: 'active' | 'inactive' | 'deleted';
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  metadata: Record<string, any>;
}
        """.strip(),
        "sequence_diagrams": [
            {
                "title": "API Authentication Flow",
                "mermaid": """
sequenceDiagram
    participant C as Client
    participant G as API Gateway
    participant A as Auth Service
    participant S as Service
    participant D as Database
    C->>G: Request with API Key
    G->>A: Validate API Key
    A->>D: Check key and permissions
    D-->>A: Key valid with permissions
    A-->>G: Authentication success
    G->>S: Forward request with context
    S->>D: Process business logic
    D-->>S: Return data
    S-->>G: Service response
    G-->>C: API response
                """.strip(),
            },
            {
                "title": "CRUD Operations Flow",
                "mermaid": """
sequenceDiagram
    participant C as Client
    participant API as API Controller
    participant S as Service Layer
    participant V as Validator
    participant D as Database
    C->>API: POST /resources
    API->>V: Validate input
    V-->>API: Validation passed
    API->>S: Create resource
    S->>D: Insert record
    D-->>S: Record created
    S-->>API: Resource created
    API-->>C: 201 Created + resource data
                """.strip(),
            },
        ],
    }


def get_rest_api_tasks() -> List[str]:
    """Get common REST API implementation tasks"""
    return [
        "Set up API project structure",
        "Configure web framework and middleware",
        "Implement authentication and authorization",
        "Create API route definitions",
        "Implement CRUD operations",
        "Add input validation and sanitization",
        "Set up database connections and models",
        "Implement error handling and logging",
        "Add API rate limiting",
        "Create API documentation (OpenAPI/Swagger)",
        "Write unit and integration tests",
        "Set up monitoring and health checks",
        "Configure production deployment",
    ]
