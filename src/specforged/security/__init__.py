"""
Security module for SpecForge MCP ecosystem.

This module provides comprehensive security utilities including:
- Input validation and sanitization
- Path security and traversal prevention
- Rate limiting and DoS protection
- Data privacy and audit logging
- Secure file operations
"""

from .input_validator import (
    ValidationError,
    SecurityError,
    InputValidator,
    SchemaValidator,
    SanitizationError,
    DataSanitizer,
)
from .path_security import (
    PathSecurityError,
    PathValidator,
    SecurePathHandler,
)
from .rate_limiter import (
    RateLimitExceeded,
    RateLimiter,
    RateLimitConfig,
    ClientRateLimiter,
)
from .secure_file_ops import (
    SecureFileError,
    SecureFileOperations,
    AtomicFileWriter,
)
from .audit_logger import (
    SecurityAuditLogger,
    SecurityEvent,
    SecurityEventType,
)
from .data_sanitizer import (
    DataPrivacyError,
    PrivacyProtector,
    SensitiveDataDetector,
)

__all__ = [
    # Input validation
    "ValidationError",
    "SecurityError",
    "InputValidator",
    "SchemaValidator",
    "SanitizationError",
    "DataSanitizer",
    # Path security
    "PathSecurityError",
    "PathValidator",
    "SecurePathHandler",
    # Rate limiting
    "RateLimitExceeded",
    "RateLimiter",
    "RateLimitConfig",
    "ClientRateLimiter",
    # Secure file operations
    "SecureFileError",
    "SecureFileOperations",
    "AtomicFileWriter",
    # Audit logging
    "SecurityAuditLogger",
    "SecurityEvent",
    "SecurityEventType",
    # Data privacy
    "DataPrivacyError",
    "PrivacyProtector",
    "SensitiveDataDetector",
]
