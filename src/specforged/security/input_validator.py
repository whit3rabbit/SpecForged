"""
Comprehensive input validation and sanitization for SpecForge MCP operations.

Provides schema-based validation, type checking, and sanitization utilities
to prevent injection attacks and ensure data integrity.
"""

import html
import json
import logging
import re
from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, List, Optional, Pattern, Type, TypeVar, Union

from pydantic import BaseModel
from pydantic import ValidationError as PydanticValidationError

T = TypeVar("T", bound=BaseModel)


class SecurityError(Exception):
    """Base class for security-related errors."""

    pass


class ValidationError(SecurityError):
    """Raised when input validation fails."""

    def __init__(self, message: str, field: Optional[str] = None, value: Any = None):
        self.field = field
        self.value = value
        super().__init__(message)


class SanitizationError(SecurityError):
    """Raised when data sanitization fails."""

    pass


class ValidationType(Enum):
    """Types of validation checks."""

    REQUIRED = "required"
    TYPE = "type"
    LENGTH = "length"
    PATTERN = "pattern"
    RANGE = "range"
    ENUM = "enum"
    FILE_PATH = "file_path"
    SPEC_ID = "spec_id"
    TASK_NUMBER = "task_number"
    CONTENT_SIZE = "content_size"
    INJECTION = "injection"


@dataclass
class ValidationRule:
    """Individual validation rule configuration."""

    type: ValidationType
    message: str
    required: bool = True
    min_length: Optional[int] = None
    max_length: Optional[int] = None
    min_value: Optional[Union[int, float]] = None
    max_value: Optional[Union[int, float]] = None
    pattern: Optional[Pattern[str]] = None
    allowed_values: Optional[List[Any]] = None
    custom_validator: Optional[callable] = None


class SchemaValidator:
    """Schema-based validation for operation parameters."""

    # Security patterns for injection detection
    INJECTION_PATTERNS = {
        "sql_injection": re.compile(
            r"(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|OR|AND)\b)|"
            r'(--|/\*|\*/|\'|"|\||;)',
            re.IGNORECASE,
        ),
        "xss_injection": re.compile(
            r"(<script[^>]*>|</script>|javascript:|on\w+\s*=|"
            r"<iframe|<object|<embed|<form)",
            re.IGNORECASE,
        ),
        "path_traversal": re.compile(
            r"(\.\.[\\/]|[\\/]\.\.[\\/]|[\\/]\.\.|^\.\.[\\/])",
        ),
        "command_injection": re.compile(
            r"[;&|`$\(\){}]|(\b(eval|exec|system|shell_exec|passthru)\b)",
            re.IGNORECASE,
        ),
    }

    # Common validation patterns
    SPEC_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$")
    TASK_NUMBER_PATTERN = re.compile(r"^\d+(\.\d+)*$")
    SEMVER_PATTERN = re.compile(
        r"^(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)"
        r"(?:-(?P<prerelease>(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)"
        r"(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?"
    )

    # Size limits (in bytes)
    MAX_CONTENT_SIZE = 1024 * 1024  # 1MB
    MAX_DESCRIPTION_SIZE = 10 * 1024  # 10KB
    MAX_NAME_SIZE = 1024  # 1KB

    def __init__(self):
        self.logger = logging.getLogger(__name__)

    def validate_spec_operation_params(
        self, operation_type: str, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Validate parameters for specification operations."""

        if operation_type == "create_spec":
            return self._validate_create_spec_params(params)
        elif operation_type == "update_requirements":
            return self._validate_update_content_params(params, "requirements")
        elif operation_type == "update_design":
            return self._validate_update_content_params(params, "design")
        elif operation_type == "update_tasks":
            return self._validate_update_content_params(params, "tasks")
        elif operation_type == "add_user_story":
            return self._validate_add_user_story_params(params)
        elif operation_type == "update_task_status":
            return self._validate_update_task_status_params(params)
        elif operation_type == "delete_spec":
            return self._validate_delete_spec_params(params)
        elif operation_type == "set_current_spec":
            return self._validate_set_current_spec_params(params)
        else:
            raise ValidationError(f"Unknown operation type: {operation_type}")

    def _validate_create_spec_params(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Validate create specification parameters."""
        validated = {}

        # Validate name (required)
        name = params.get("name")
        if not name or not isinstance(name, str):
            raise ValidationError(
                "Specification name is required and must be a string",
                "name",
                name,
            )

        name = name.strip()
        if not name:
            raise ValidationError("Specification name cannot be empty", "name", name)

        if len(name.encode("utf-8")) > self.MAX_NAME_SIZE:
            raise ValidationError(
                f"Name exceeds maximum size of {self.MAX_NAME_SIZE} bytes",
                "name",
                len(name),
            )

        self._check_injection_patterns(name, "name")
        validated["name"] = html.escape(name)

        # Validate description (optional)
        description = params.get("description")
        if description is not None:
            if not isinstance(description, str):
                raise ValidationError(
                    "Description must be a string",
                    "description",
                    type(description),
                )

            if len(description.encode("utf-8")) > self.MAX_DESCRIPTION_SIZE:
                raise ValidationError(
                    f"Description exceeds maximum size of {self.MAX_DESCRIPTION_SIZE} bytes",
                    "description",
                    len(description),
                )

            self._check_injection_patterns(description, "description")
            validated["description"] = html.escape(description.strip())

        # Validate spec_id (optional, auto-generated if not provided)
        spec_id = params.get("spec_id")
        if spec_id is not None:
            if not isinstance(spec_id, str):
                raise ValidationError(
                    "Spec ID must be a string", "spec_id", type(spec_id)
                )

            if not self.SPEC_ID_PATTERN.match(spec_id):
                raise ValidationError(
                    "Spec ID must contain only lowercase letters, numbers, and hyphens, "
                    "and cannot start or end with a hyphen",
                    "spec_id",
                    spec_id,
                )

            if len(spec_id) > 50:
                raise ValidationError(
                    "Spec ID cannot exceed 50 characters",
                    "spec_id",
                    len(spec_id),
                )

            validated["spec_id"] = spec_id

        return validated

    def _validate_update_content_params(
        self, params: Dict[str, Any], content_type: str
    ) -> Dict[str, Any]:
        """Validate content update parameters."""
        validated = {}

        # Validate spec_id (required)
        spec_id = params.get("spec_id")
        self._validate_spec_id(spec_id, required=True)
        validated["spec_id"] = spec_id

        # Validate content (required)
        content = params.get("content")
        if not content or not isinstance(content, str):
            raise ValidationError(
                "Content is required and must be a string", "content", content
            )

        if len(content.encode("utf-8")) > self.MAX_CONTENT_SIZE:
            raise ValidationError(
                f"Content exceeds maximum size of {self.MAX_CONTENT_SIZE} bytes",
                "content",
                len(content),
            )

        # Check for injection patterns in content
        self._check_injection_patterns(content, "content")

        # Additional content-specific validation
        if content_type == "requirements":
            self._validate_requirements_content(content)
        elif content_type == "design":
            self._validate_design_content(content)
        elif content_type == "tasks":
            self._validate_tasks_content(content)

        validated["content"] = content.strip()
        return validated

    def _validate_add_user_story_params(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Validate add user story parameters."""
        validated = {}

        # Validate spec_id
        spec_id = params.get("spec_id")
        self._validate_spec_id(spec_id, required=True)
        validated["spec_id"] = spec_id

        # Validate user story components
        for field in ["as_a", "i_want", "so_that"]:
            value = params.get(field)
            if not value or not isinstance(value, str):
                raise ValidationError(
                    f"{field} is required and must be a string", field, value
                )

            value = value.strip()
            if not value:
                raise ValidationError(f"{field} cannot be empty", field, value)

            if len(value.encode("utf-8")) > self.MAX_DESCRIPTION_SIZE:
                raise ValidationError(
                    f"{field} exceeds maximum size", field, len(value)
                )

            self._check_injection_patterns(value, field)
            validated[field] = html.escape(value)

        # Validate EARS requirements (optional)
        ears_requirements = params.get("ears_requirements")
        if ears_requirements is not None:
            if not isinstance(ears_requirements, list):
                raise ValidationError(
                    "EARS requirements must be a list",
                    "ears_requirements",
                    type(ears_requirements),
                )

            validated_requirements = []
            for i, req in enumerate(ears_requirements):
                if not isinstance(req, dict):
                    raise ValidationError(
                        f"Requirement {i + 1} must be a dictionary",
                        f"ears_requirements[{i}]",
                        type(req),
                    )

                condition = req.get("condition")
                system_response = req.get("system_response")

                for field_name, field_value in [
                    ("condition", condition),
                    ("system_response", system_response),
                ]:
                    if not field_value or not isinstance(field_value, str):
                        raise ValidationError(
                            f"Requirement {i + 1} {field_name} is required and must be a string",
                            f"ears_requirements[{i}].{field_name}",
                            field_value,
                        )

                    field_value = field_value.strip()
                    if not field_value:
                        raise ValidationError(
                            f"Requirement {i + 1} {field_name} cannot be empty",
                            f"ears_requirements[{i}].{field_name}",
                            field_value,
                        )

                    self._check_injection_patterns(
                        field_value, f"ears_requirements[{i}].{field_name}"
                    )

                validated_requirements.append(
                    {
                        "condition": html.escape(condition.strip()),
                        "system_response": html.escape(system_response.strip()),
                    }
                )

            validated["ears_requirements"] = validated_requirements

        return validated

    def _validate_update_task_status_params(
        self, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Validate update task status parameters."""
        validated = {}

        # Validate spec_id
        spec_id = params.get("spec_id")
        self._validate_spec_id(spec_id, required=True)
        validated["spec_id"] = spec_id

        # Validate task_number
        task_number = params.get("task_number")
        if not task_number or not isinstance(task_number, str):
            raise ValidationError(
                "Task number is required and must be a string",
                "task_number",
                task_number,
            )

        if not self.TASK_NUMBER_PATTERN.match(task_number):
            raise ValidationError(
                "Task number must be in format '1', '1.1', '1.2.3', etc.",
                "task_number",
                task_number,
            )

        validated["task_number"] = task_number

        # Validate status
        status = params.get("status")
        allowed_statuses = ["pending", "in_progress", "completed"]
        if status not in allowed_statuses:
            raise ValidationError(
                f"Status must be one of: {', '.join(allowed_statuses)}",
                "status",
                status,
            )

        validated["status"] = status
        return validated

    def _validate_delete_spec_params(self, params: Dict[str, Any]) -> Dict[str, Any]:
        """Validate delete specification parameters."""
        validated = {}

        spec_id = params.get("spec_id")
        self._validate_spec_id(spec_id, required=True)
        validated["spec_id"] = spec_id

        return validated

    def _validate_set_current_spec_params(
        self, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Validate set current specification parameters."""
        validated = {}

        spec_id = params.get("spec_id")
        self._validate_spec_id(spec_id, required=True)
        validated["spec_id"] = spec_id

        return validated

    def _validate_spec_id(self, spec_id: Any, required: bool = True) -> None:
        """Validate specification ID format."""
        if spec_id is None:
            if required:
                raise ValidationError("Spec ID is required", "spec_id", spec_id)
            return

        if not isinstance(spec_id, str):
            raise ValidationError("Spec ID must be a string", "spec_id", type(spec_id))

        if not self.SPEC_ID_PATTERN.match(spec_id):
            raise ValidationError(
                "Spec ID must contain only lowercase letters, numbers, and hyphens, "
                "and cannot start or end with a hyphen",
                "spec_id",
                spec_id,
            )

        if len(spec_id) > 50:
            raise ValidationError(
                "Spec ID cannot exceed 50 characters", "spec_id", len(spec_id)
            )

    def _check_injection_patterns(self, value: str, field_name: str) -> None:
        """Check for common injection patterns in input."""
        for pattern_name, pattern in self.INJECTION_PATTERNS.items():
            if pattern.search(value):
                self.logger.warning(
                    f"Potential {pattern_name} detected in field '{field_name}': {value[:100]}..."
                )
                raise ValidationError(
                    "Input contains potentially dangerous content",
                    field_name,
                    value,
                )

    def _validate_requirements_content(self, content: str) -> None:
        """Validate requirements markdown content."""
        # Check for EARS notation patterns
        ears_patterns = [
            r"THE SYSTEM SHALL",
            r"WHEN .+ THE SYSTEM SHALL",
            r"WHILE .+ THE SYSTEM SHALL",
            r"WHERE .+ THE SYSTEM SHALL",
            r"IF .+ THEN THE SYSTEM SHALL",
        ]

        # At least one EARS pattern should be present in requirements
        has_ears = any(
            re.search(pattern, content, re.IGNORECASE) for pattern in ears_patterns
        )
        if not has_ears and len(content) > 100:  # Only warn for substantial content
            self.logger.info(
                "Requirements content doesn't contain EARS notation patterns"
            )

    def _validate_design_content(self, content: str) -> None:
        """Validate design markdown content."""
        # Check for basic design section headers
        design_indicators = [
            r"#+ Architecture",
            r"#+ Components?",
            r"#+ Data Model",
            r"#+ API",
            r"#+ Technical",
        ]

        has_design_content = any(
            re.search(pattern, content, re.IGNORECASE) for pattern in design_indicators
        )
        if not has_design_content and len(content) > 100:
            self.logger.info(
                "Design content doesn't contain typical design section headers"
            )

    def _validate_tasks_content(self, content: str) -> None:
        """Validate tasks markdown content."""
        # Check for checkbox format
        checkbox_patterns = [
            r"- \[[ x]\]",
            r"\* \[[ x]\]",
        ]

        has_checkboxes = any(
            re.search(pattern, content) for pattern in checkbox_patterns
        )
        if not has_checkboxes and len(content) > 50:
            self.logger.info("Tasks content doesn't contain checkbox format")


class InputValidator:
    """High-level input validation orchestrator."""

    def __init__(self):
        self.schema_validator = SchemaValidator()
        self.logger = logging.getLogger(__name__)

    def validate_operation_params(
        self, operation_type: str, params: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Validate and sanitize operation parameters."""
        try:
            # First, validate basic structure
            if not isinstance(params, dict):
                raise ValidationError(
                    "Parameters must be a dictionary", "params", type(params)
                )

            # Validate against schema
            validated_params = self.schema_validator.validate_spec_operation_params(
                operation_type, params
            )

            # Log validation success
            self.logger.debug(
                f"Successfully validated {operation_type} operation parameters"
            )

            return validated_params

        except ValidationError as e:
            self.logger.error(f"Validation failed for {operation_type}: {e}")
            raise
        except Exception as e:
            self.logger.error(
                f"Unexpected error during validation of {operation_type}: {e}"
            )
            raise ValidationError(f"Validation failed: {str(e)}")

    def validate_pydantic_model(self, model_class: Type[T], data: Dict[str, Any]) -> T:
        """Validate data against a Pydantic model."""
        try:
            return model_class(**data)
        except PydanticValidationError as e:
            errors = []
            for error in e.errors():
                field = ".".join(str(x) for x in error["loc"])
                errors.append(f"{field}: {error['msg']}")
            raise ValidationError(f"Model validation failed: {'; '.join(errors)}")

    def sanitize_string(self, value: str, max_length: Optional[int] = None) -> str:
        """Sanitize string input."""
        if not isinstance(value, str):
            raise SanitizationError(f"Expected string, got {type(value)}")

        # Strip whitespace
        sanitized = value.strip()

        # HTML escape
        sanitized = html.escape(sanitized)

        # Length check
        if max_length and len(sanitized) > max_length:
            raise SanitizationError(f"String exceeds maximum length of {max_length}")

        return sanitized

    def validate_json_content(
        self, content: str, max_size: int = 100 * 1024
    ) -> Dict[str, Any]:
        """Validate and parse JSON content safely."""
        if len(content.encode("utf-8")) > max_size:
            raise ValidationError(
                f"JSON content exceeds maximum size of {max_size} bytes"
            )

        try:
            return json.loads(content)
        except json.JSONDecodeError as e:
            raise ValidationError(f"Invalid JSON content: {e}")


class DataSanitizer:
    """Utilities for sanitizing data to prevent leaks and ensure privacy."""

    # Patterns for sensitive data detection
    SENSITIVE_PATTERNS = {
        "api_key": re.compile(
            r'api[_-]?key[\'"\s]*[=:][\'"\s]*[a-zA-Z0-9]{20,}', re.IGNORECASE
        ),
        "password": re.compile(
            r'pass(word)?[\'"\s]*[=:][\'"\s]*[^\s\'"]{6,}', re.IGNORECASE
        ),
        "token": re.compile(
            r'token[\'"\s]*[=:][\'"\s]*[a-zA-Z0-9._-]{20,}', re.IGNORECASE
        ),
        "secret": re.compile(
            r'secret[\'"\s]*[=:][\'"\s]*[a-zA-Z0-9]{16,}', re.IGNORECASE
        ),
        "private_key": re.compile(r"-----BEGIN .* PRIVATE KEY-----", re.IGNORECASE),
        "email": re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"),
        "phone": re.compile(r"\b\d{3}[-.]?\d{3}[-.]?\d{4}\b"),
        "ssn": re.compile(r"\b\d{3}-?\d{2}-?\d{4}\b"),
    }

    @classmethod
    def sanitize_for_logging(cls, data: Any, max_depth: int = 3) -> Any:
        """Sanitize data for safe logging by removing sensitive information."""
        return cls._sanitize_recursive(data, max_depth, 0)

    @classmethod
    def _sanitize_recursive(cls, data: Any, max_depth: int, current_depth: int) -> Any:
        """Recursively sanitize data structure."""
        if current_depth >= max_depth:
            return "[REDACTED - MAX DEPTH]"

        if isinstance(data, dict):
            sanitized = {}
            for key, value in data.items():
                if cls._is_sensitive_key(key):
                    sanitized[key] = "[REDACTED]"
                elif isinstance(value, (dict, list)):
                    sanitized[key] = cls._sanitize_recursive(
                        value, max_depth, current_depth + 1
                    )
                elif isinstance(value, str):
                    sanitized[key] = cls._sanitize_string_value(value)
                else:
                    sanitized[key] = value
            return sanitized

        elif isinstance(data, list):
            return [
                cls._sanitize_recursive(item, max_depth, current_depth + 1)
                for item in data
            ]

        elif isinstance(data, str):
            return cls._sanitize_string_value(data)

        else:
            return data

    @classmethod
    def _is_sensitive_key(cls, key: str) -> bool:
        """Check if a key name indicates sensitive data."""
        sensitive_keys = {
            "password",
            "token",
            "key",
            "secret",
            "auth",
            "credential",
            "private",
        }
        key_lower = key.lower()
        return any(sensitive_word in key_lower for sensitive_word in sensitive_keys)

    @classmethod
    def _sanitize_string_value(cls, value: str) -> str:
        """Sanitize string value by masking sensitive patterns."""
        for pattern_name, pattern in cls.SENSITIVE_PATTERNS.items():
            if pattern.search(value):
                # Replace sensitive content with redacted placeholder
                value = pattern.sub(f"[REDACTED-{pattern_name.upper()}]", value)

        # Truncate very long strings
        if len(value) > 500:
            value = value[:500] + "... [TRUNCATED]"

        return value

    @classmethod
    def mask_sensitive_data(cls, text: str) -> str:
        """Mask sensitive data in text while preserving structure."""
        masked = text

        for pattern_name, pattern in cls.SENSITIVE_PATTERNS.items():

            def replacer(match):
                matched_text = match.group()
                # Keep structure but mask the actual sensitive content
                if "=" in matched_text or ":" in matched_text:
                    prefix = matched_text.split(("=" if "=" in matched_text else ":"))[
                        0
                    ]
                    return f"{prefix}=[MASKED-{pattern_name.upper()}]"
                else:
                    return f"[MASKED-{pattern_name.upper()}]"

            masked = pattern.sub(replacer, masked)

        return masked
