"""
Security module for SpecForge MCP ecosystem.

This module provides comprehensive security utilities including:
- Input validation and sanitization
- Path security and traversal prevention
- Rate limiting and DoS protection
- Data privacy and audit logging
- Secure file operations
"""

from .audit_logger import SecurityAuditLogger, SecurityEvent, SecurityEventType
from .data_sanitizer import DataPrivacyError, PrivacyProtector, SensitiveDataDetector
from .input_validator import (
    DataSanitizer,
    InputValidator,
    SanitizationError,
    SchemaValidator,
    SecurityError,
    ValidationError,
)
from .path_security import PathSecurityError, PathValidator, SecurePathHandler
from .rate_limiter import (
    ClientRateLimiter,
    RateLimitConfig,
    RateLimiter,
    RateLimitExceeded,
)
from .secure_file_ops import AtomicFileWriter, SecureFileError, SecureFileOperations

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
