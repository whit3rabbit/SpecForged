"""
Configuration schema validation for SpecForge MCP ecosystem.

This module provides comprehensive schema validation for all configuration
types including VS Code extension settings, MCP server configuration,
user preferences, and developer/debug settings.
"""

import re
from enum import Enum
from typing import Annotated, Any, Dict, List, Optional, Type

from pydantic import BaseModel, Field, field_validator, model_validator


class ConfigVersion(str, Enum):
    """Configuration schema versions."""

    V1_0_0 = "1.0.0"
    V1_1_0 = "1.1.0"  # Added feature flags
    V1_2_0 = "1.2.0"  # Added performance tuning
    V2_0_0 = "2.0.0"  # Unified configuration system


class LogLevel(str, Enum):
    """Logging levels."""

    ERROR = "error"
    WARN = "warn"
    INFO = "info"
    DEBUG = "debug"
    TRACE = "trace"


class ServerType(str, Enum):
    """MCP server deployment types."""

    LOCAL = "local"
    SMITHERY = "smithery"
    CUSTOM = "custom"


class NotificationLevel(str, Enum):
    """Notification verbosity levels."""

    NONE = "none"
    ERRORS = "errors"
    WARNINGS = "warnings"
    ALL = "all"


class ConflictResolutionStrategy(str, Enum):
    """Conflict resolution strategies."""

    ASK_USER = "ask_user"
    SERVER_WINS = "server_wins"
    CLIENT_WINS = "client_wins"
    MERGE = "merge"
    SKIP = "skip"


class FeatureFlag(BaseModel):
    """Feature flag configuration."""

    name: str = Field(..., description="Feature flag name")
    enabled: bool = Field(default=False, description="Whether feature is enabled")
    rollout_percentage: Annotated[float, Field(ge=0.0, le=100.0)] = Field(
        default=0.0, description="Rollout percentage (0-100)"
    )
    target_groups: List[str] = Field(
        default_factory=list, description="Target user groups"
    )
    conditions: Dict[str, Any] = Field(
        default_factory=dict, description="Conditional activation rules"
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict, description="Additional metadata"
    )
    created_at: str = Field(..., description="Creation timestamp")
    updated_at: Optional[str] = Field(None, description="Last update timestamp")
    expires_at: Optional[str] = Field(None, description="Expiration timestamp")

    @field_validator("name")
    @classmethod
    def validate_feature_name(cls, v: str) -> str:
        """Validate feature flag name format."""
        if not re.match(r"^[a-z][a-z0-9_]*[a-z0-9]$", v):
            raise ValueError(
                "Feature name must start with letter, contain only lowercase "
                "letters, numbers, and underscores, and end with letter or number"
            )
        if len(v) > 50:
            raise ValueError("Feature name must be 50 characters or less")
        return v

    @field_validator("target_groups")
    @classmethod
    def validate_target_groups(cls, v: List[str]) -> List[str]:
        """Validate target group names."""
        valid_groups = {
            "all",
            "developers",
            "testers",
            "beta_users",
            "internal",
            "enterprise",
            "free_tier",
            "premium_tier",
        }
        invalid_groups = [g for g in v if g not in valid_groups]
        if invalid_groups:
            raise ValueError(f"Invalid target groups: {invalid_groups}")
        return v


class NotificationConfig(BaseModel):
    """Notification behavior configuration."""

    enabled: bool = Field(default=True, description="Enable notifications")
    level: NotificationLevel = Field(
        default=NotificationLevel.ERRORS, description="Notification level"
    )

    # Notification types
    show_success: bool = Field(default=True, description="Show success notifications")
    show_failure: bool = Field(default=True, description="Show failure notifications")
    show_progress: bool = Field(default=True, description="Show progress notifications")
    show_conflicts: bool = Field(
        default=True, description="Show conflict notifications"
    )

    # Timing and behavior
    duration_ms: Annotated[int, Field(ge=1000, le=30000)] = Field(
        default=5000, description="Auto-hide duration in milliseconds"
    )
    enable_sounds: bool = Field(default=True, description="Enable notification sounds")
    enable_badges: bool = Field(default=True, description="Enable notification badges")

    # Quiet hours
    quiet_hours_enabled: bool = Field(default=False, description="Enable quiet hours")
    quiet_start_time: str = Field(
        default="22:00", description="Quiet hours start time (HH:MM)"
    )
    quiet_end_time: str = Field(
        default="08:00", description="Quiet hours end time (HH:MM)"
    )

    # Filtering
    priority_filter: Annotated[int, Field(ge=0, le=3)] = Field(
        default=0, description="Minimum priority level (0=Low, 3=Urgent)"
    )
    operation_filters: List[str] = Field(
        default=[
            "create_spec",
            "update_requirements",
            "update_design",
            "update_tasks",
            "add_user_story",
            "update_task_status",
        ],
        description="Operation types to show notifications for",
    )

    @field_validator("quiet_start_time", "quiet_end_time")
    @classmethod
    def validate_time_format(cls, v: str) -> str:
        """Validate time format (HH:MM)."""
        if not re.match(r"^([01]?[0-9]|2[0-3]):[0-5][0-9]$", v):
            raise ValueError("Time must be in HH:MM format (24-hour)")
        return v


class QueueConfig(BaseModel):
    """Operation queue configuration."""

    # Basic queue settings
    max_size: Annotated[int, Field(ge=100, le=100000)] = Field(
        default=10000, description="Maximum queue size"
    )
    processing_interval_ms: Annotated[int, Field(ge=100, le=60000)] = Field(
        default=2000, description="Processing interval in milliseconds"
    )
    heartbeat_interval_ms: Annotated[int, Field(ge=5000, le=300000)] = Field(
        default=30000, description="Heartbeat interval in milliseconds"
    )

    # Batching configuration
    enable_batching: bool = Field(default=True, description="Enable operation batching")
    max_batch_size: Annotated[int, Field(ge=1, le=1000)] = Field(
        default=50, description="Maximum batch size"
    )
    batch_timeout_ms: Annotated[int, Field(ge=100, le=10000)] = Field(
        default=1000, description="Batch timeout in milliseconds"
    )

    # Performance tuning
    enable_compression: bool = Field(
        default=True, description="Enable data compression"
    )
    compression_threshold: Annotated[int, Field(ge=10, le=10000)] = Field(
        default=100, description="Minimum operations for compression"
    )
    enable_streaming: bool = Field(
        default=True, description="Enable streaming processing"
    )

    # Cleanup and maintenance
    cleanup_interval_ms: Annotated[int, Field(ge=60000, le=86400000)] = Field(
        default=1800000,
        description="Cleanup interval in milliseconds (30 min)",
    )
    max_operation_age_hours: Annotated[int, Field(ge=1, le=168)] = Field(
        default=12, description="Maximum operation age in hours"
    )

    # Concurrency
    parallel_processing_limit: Annotated[int, Field(ge=1, le=20)] = Field(
        default=3, description="Maximum parallel operations"
    )
    enable_concurrent_processing: bool = Field(
        default=True, description="Enable concurrent processing"
    )


class PerformanceConfig(BaseModel):
    """Performance optimization configuration."""

    # Memory management
    memory_limit_mb: Annotated[int, Field(ge=50, le=2048)] = Field(
        default=100, description="Memory limit in MB"
    )
    enable_memory_monitoring: bool = Field(
        default=True, description="Enable memory monitoring"
    )
    memory_warning_threshold_mb: Annotated[int, Field(ge=10, le=2048)] = Field(
        default=80, description="Memory warning threshold in MB"
    )

    # Caching
    enable_caching: bool = Field(default=True, description="Enable result caching")
    cache_size: Annotated[int, Field(ge=100, le=10000)] = Field(
        default=1000, description="Cache size"
    )
    cache_ttl_seconds: Annotated[int, Field(ge=30, le=3600)] = Field(
        default=300, description="Cache TTL in seconds"
    )

    # File operations
    enable_file_watcher_debouncing: bool = Field(
        default=True, description="Enable file watcher debouncing"
    )
    debounce_delay_ms: Annotated[int, Field(ge=50, le=2000)] = Field(
        default=250, description="Debounce delay in milliseconds"
    )

    # Performance monitoring
    enable_performance_monitoring: bool = Field(
        default=True, description="Enable performance monitoring"
    )
    metrics_collection_interval_seconds: Annotated[int, Field(ge=10, le=300)] = Field(
        default=30, description="Metrics collection interval in seconds"
    )

    @field_validator("memory_warning_threshold_mb")
    @classmethod
    def validate_memory_threshold(cls, v: int, info: Any) -> int:
        """Ensure warning threshold is less than memory limit."""
        if (
            hasattr(info, "data")
            and info.data
            and "memory_limit_mb" in info.data
            and v >= info.data["memory_limit_mb"]
        ):
            raise ValueError("Memory warning threshold must be less than memory limit")
        return v


class SecurityConfig(BaseModel):
    """Security and validation configuration."""

    # Input validation
    enable_strict_validation: bool = Field(
        default=True, description="Enable strict input validation"
    )
    max_input_size_bytes: Annotated[int, Field(ge=1024, le=10485760)] = Field(
        default=1048576, description="Maximum input size in bytes (1MB)"
    )

    # Rate limiting
    enable_rate_limiting: bool = Field(default=True, description="Enable rate limiting")
    max_requests_per_minute: Annotated[int, Field(ge=10, le=1000)] = Field(
        default=100, description="Maximum requests per minute"
    )
    rate_limit_window_seconds: Annotated[int, Field(ge=30, le=3600)] = Field(
        default=60, description="Rate limit window in seconds"
    )

    # Data sanitization
    enable_data_sanitization: bool = Field(
        default=True, description="Enable data sanitization"
    )
    sanitize_file_paths: bool = Field(default=True, description="Sanitize file paths")
    sanitize_user_input: bool = Field(default=True, description="Sanitize user input")

    # Audit logging
    enable_audit_logging: bool = Field(default=True, description="Enable audit logging")
    audit_log_retention_days: Annotated[int, Field(ge=7, le=365)] = Field(
        default=30, description="Audit log retention in days"
    )


class VSCodeExtensionConfig(BaseModel):
    """VS Code extension specific configuration."""

    # General settings
    auto_detect: bool = Field(default=True, description="Auto-detect specifications")
    spec_folder: str = Field(default=".specifications", description="Spec folder name")
    show_progress_badges: bool = Field(default=True, description="Show progress badges")
    enable_syntax_highlighting: bool = Field(
        default=True, description="Enable EARS syntax highlighting"
    )
    enable_webview: bool = Field(default=True, description="Enable rich webview")

    # MCP server configuration
    server_type: ServerType = Field(default=ServerType.LOCAL, description="Server type")
    server_path: str = Field(default="specforged", description="Server executable path")
    server_url: Optional[str] = Field(None, description="Custom server URL")
    smithery_server_name: str = Field(
        default="specforged", description="Smithery server name"
    )
    smithery_api_key: Optional[str] = Field(None, description="Smithery API key")

    # Connection settings
    auto_fallback_to_local: bool = Field(
        default=True, description="Auto fallback to local server"
    )
    connection_timeout_ms: Annotated[int, Field(ge=1000, le=60000)] = Field(
        default=10000, description="Connection timeout in milliseconds"
    )
    retry_attempts: Annotated[int, Field(ge=1, le=10)] = Field(
        default=3, description="Connection retry attempts"
    )
    retry_delay_ms: Annotated[int, Field(ge=1000, le=30000)] = Field(
        default=5000, description="Retry delay in milliseconds"
    )

    # Discovery and automation
    auto_discovery: bool = Field(default=True, description="Auto-discover MCP clients")
    discovery_interval_ms: Annotated[int, Field(ge=60000, le=3600000)] = Field(
        default=300000, description="Discovery interval in milliseconds"
    )
    enable_dashboard: bool = Field(default=True, description="Enable MCP dashboard")
    show_recommendations: bool = Field(
        default=True, description="Show setup recommendations"
    )

    # Backup and sync
    enable_backups: bool = Field(default=True, description="Enable auto backups")
    backup_retention_days: Annotated[int, Field(ge=1, le=365)] = Field(
        default=30, description="Backup retention in days"
    )
    sync_on_change: bool = Field(default=False, description="Sync on file changes")
    backup_before_sync: bool = Field(
        default=True, description="Backup before sync operations"
    )

    # Debug and development
    debug_mode: bool = Field(default=False, description="Enable debug mode")
    log_level: LogLevel = Field(default=LogLevel.INFO, description="Logging level")
    enable_telemetry: bool = Field(default=False, description="Enable telemetry")

    # Custom client paths
    custom_client_paths: Dict[str, str] = Field(
        default_factory=dict, description="Custom MCP client paths"
    )

    @field_validator("server_url")
    @classmethod
    def validate_server_url(cls, v: Optional[str], info: Any) -> Optional[str]:
        """Validate server URL format."""
        if (
            v is not None
            and hasattr(info, "data")
            and info.data
            and info.data.get("server_type") == ServerType.CUSTOM
        ):
            if not re.match(r"^https?://.+", v):
                raise ValueError("Custom server URL must be a valid HTTP/HTTPS URL")
        return v


class MCPServerConfig(BaseModel):
    """MCP server configuration."""

    # Server identification
    name: str = Field(..., min_length=1, description="Server name")
    version: str = Field(..., min_length=1, description="Server version")
    description: Optional[str] = Field(None, description="Server description")

    # Runtime configuration
    max_connections: Annotated[int, Field(ge=1, le=1000)] = Field(
        default=100, description="Maximum concurrent connections"
    )
    request_timeout_seconds: Annotated[int, Field(ge=5, le=300)] = Field(
        default=30, description="Request timeout in seconds"
    )

    # File operations
    enable_file_operations: bool = Field(
        default=True, description="Enable file operations"
    )
    allowed_file_extensions: List[str] = Field(
        default=[".md", ".json", ".txt", ".yaml", ".yml"],
        description="Allowed file extensions",
    )
    max_file_size_mb: Annotated[int, Field(ge=1, le=100)] = Field(
        default=10, description="Maximum file size in MB"
    )

    # Workspace settings
    workspace_root: Optional[str] = Field(None, description="Workspace root path")
    spec_directories: List[str] = Field(
        default=[".specifications", "specifications"],
        description="Specification directory names",
    )

    # Integration settings
    enable_git_integration: bool = Field(
        default=True, description="Enable Git integration"
    )
    auto_commit_changes: bool = Field(
        default=False, description="Auto-commit specification changes"
    )
    commit_message_template: str = Field(
        default="docs: update specification - {operation}",
        description="Git commit message template",
    )


class UnifiedConfig(BaseModel):
    """Unified configuration for SpecForge MCP ecosystem."""

    # Metadata
    version: ConfigVersion = Field(
        default=ConfigVersion.V2_0_0, description="Config version"
    )
    created_at: str = Field(..., description="Configuration creation timestamp")
    updated_at: Optional[str] = Field(None, description="Last update timestamp")
    environment: str = Field(default="production", description="Environment name")

    # Core configurations
    notifications: NotificationConfig = Field(
        default_factory=NotificationConfig, description="Notification settings"
    )
    queue: QueueConfig = Field(
        default_factory=QueueConfig, description="Operation queue settings"
    )
    performance: PerformanceConfig = Field(
        default_factory=PerformanceConfig, description="Performance settings"
    )
    security: SecurityConfig = Field(
        default_factory=SecurityConfig, description="Security settings"
    )

    # Component-specific configurations
    vscode_extension: VSCodeExtensionConfig = Field(
        default_factory=VSCodeExtensionConfig,
        description="VS Code extension settings",
    )
    mcp_server: MCPServerConfig = Field(..., description="MCP server settings")

    # Feature flags
    feature_flags: Dict[str, FeatureFlag] = Field(
        default_factory=dict, description="Feature flag configurations"
    )

    # Conflict resolution
    conflict_resolution: ConflictResolutionStrategy = Field(
        default=ConflictResolutionStrategy.ASK_USER,
        description="Default conflict resolution strategy",
    )

    # Custom settings
    custom_settings: Dict[str, Any] = Field(
        default_factory=dict, description="Custom user-defined settings"
    )

    @model_validator(mode="before")
    @classmethod
    def validate_configuration_consistency(
        cls, values: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Validate cross-configuration consistency."""
        notifications = values.get("notifications")
        performance = values.get("performance")
        queue = values.get("queue")

        if notifications and performance:
            # Ensure notification duration doesn't exceed performance limits
            duration_ms = (
                notifications.get("duration_ms", 5000)
                if isinstance(notifications, dict)
                else notifications.duration_ms
            )
            memory_limit = (
                performance.get("memory_limit_mb", 100)
                if isinstance(performance, dict)
                else performance.memory_limit_mb
            )
            if duration_ms > 10000 and memory_limit < 100:
                raise ValueError(
                    "Long notification duration with low memory limit may cause issues"
                )

        if queue and performance:
            # Ensure queue size is reasonable for memory limit
            max_size = (
                queue.get("max_size", 10000)
                if isinstance(queue, dict)
                else queue.max_size
            )
            memory_limit = (
                performance.get("memory_limit_mb", 100)
                if isinstance(performance, dict)
                else performance.memory_limit_mb
            )
            estimated_memory = max_size * 0.001  # Rough estimate: 1KB per operation
            if estimated_memory > memory_limit * 0.5:
                raise ValueError(
                    "Queue size too large for memory limit - consider reducing max_size"
                )

        return values

    @field_validator("feature_flags")
    @classmethod
    def validate_feature_flags(
        cls, v: Dict[str, FeatureFlag]
    ) -> Dict[str, FeatureFlag]:
        """Validate feature flag configurations."""
        for name, flag in v.items():
            if name != flag.name:
                raise ValueError(
                    f"Feature flag key '{name}' doesn't match name '{flag.name}'"
                )
        return v

    @field_validator("environment")
    @classmethod
    def validate_environment(cls, v: str) -> str:
        """Validate environment name."""
        valid_environments = {
            "development",
            "testing",
            "staging",
            "production",
        }
        if v not in valid_environments:
            raise ValueError(
                f"Invalid environment: {v}. Must be one of {valid_environments}"
            )
        return v


class ConfigurationValidator:
    """Advanced configuration validation and error reporting."""

    def __init__(self):
        self.validation_errors: List[Dict[str, Any]] = []
        self.validation_warnings: List[Dict[str, Any]] = []

    def validate_config(
        self, config_data: Dict[str, Any], config_type: Type[BaseModel]
    ) -> tuple[bool, List[str]]:
        """
        Validate configuration against schema.

        Returns:
            Tuple of (is_valid, error_messages)
        """
        try:
            config_type(**config_data)
            return True, []
        except Exception as e:
            error_msg = self._format_validation_error(e)
            return False, [error_msg]

    def validate_migration_compatibility(
        self, old_version: str, new_version: str, config_data: Dict[str, Any]
    ) -> tuple[bool, List[str]]:
        """
        Validate that configuration can be migrated from old to new version.

        Returns:
            Tuple of (can_migrate, migration_warnings)
        """
        warnings = []

        # Check for removed settings
        version_migrations = {
            "1.0.0": {"removed": [], "renamed": {}, "type_changes": {}},
            "1.1.0": {
                "removed": [],
                "renamed": {"enable_notifications": "notifications.enabled"},
                "type_changes": {},
            },
            "2.0.0": {
                "removed": ["legacy_mode", "old_cache_settings"],
                "renamed": {
                    "notification_level": "notifications.level",
                    "queue_size": "queue.max_size",
                },
                "type_changes": {"retry_attempts": "int->conint(ge=1, le=10)"},
            },
        }

        if new_version in version_migrations:
            migration_info = version_migrations[new_version]

            # Check for removed settings
            for removed_setting in migration_info["removed"]:
                if self._has_nested_key(config_data, removed_setting):
                    warnings.append(
                        f"Setting '{removed_setting}' has been removed in "
                        f"version {new_version}"
                    )

            # Check for renamed settings
            for old_name, new_name in migration_info["renamed"].items():
                if self._has_nested_key(config_data, old_name):
                    warnings.append(
                        f"Setting '{old_name}' has been renamed to "
                        f"'{new_name}' in version {new_version}"
                    )

        return True, warnings

    def validate_environment_consistency(self, config: UnifiedConfig) -> List[str]:
        """Validate configuration consistency for specific environment."""
        issues = []

        if config.environment == "production":
            if config.vscode_extension.debug_mode:
                issues.append("Debug mode should be disabled in production")

            if config.vscode_extension.log_level in [
                LogLevel.DEBUG,
                LogLevel.TRACE,
            ]:
                issues.append("Debug/trace logging should be avoided in production")

            if not config.security.enable_rate_limiting:
                issues.append("Rate limiting should be enabled in production")

        elif config.environment == "development":
            if not config.performance.enable_performance_monitoring:
                issues.append("Performance monitoring recommended for development")

        return issues

    def _format_validation_error(self, error: Exception) -> str:
        """Format validation error for user display."""
        if hasattr(error, "errors"):
            # Pydantic validation error
            errors = []
            for err in error.errors():
                field_name = ".".join(str(x) for x in err["loc"])
                message = err["msg"]
                errors.append(f"{field_name}: {message}")
            return "; ".join(errors)
        else:
            return str(error)

    def _has_nested_key(self, data: Dict[str, Any], key: str) -> bool:
        """Check if nested key exists in configuration data."""
        keys = key.split(".")
        current = data

        for k in keys:
            if isinstance(current, dict) and k in current:
                current = current[k]
            else:
                return False

        return True


# Predefined configuration profiles
CONFIGURATION_PROFILES = {
    "minimal": {
        "description": "Minimal resource usage configuration",
        "performance": {
            "memory_limit_mb": 50,
            "memory_warning_threshold_mb": 40,
            "cache_size": 100,
            "enable_performance_monitoring": False,
        },
        "queue": {
            "max_size": 1000,
            "max_batch_size": 10,
            "enable_compression": False,
        },
        "notifications": {"level": "errors", "enable_sounds": False},
    },
    "balanced": {
        "description": "Balanced performance and resource usage",
        "performance": {
            "memory_limit_mb": 100,
            "cache_size": 1000,
            "enable_performance_monitoring": True,
        },
        "queue": {
            "max_size": 10000,
            "max_batch_size": 50,
            "enable_compression": True,
        },
        "notifications": {"level": "warnings", "enable_sounds": True},
    },
    "performance": {
        "description": "Maximum performance configuration",
        "performance": {
            "memory_limit_mb": 500,
            "cache_size": 5000,
            "enable_performance_monitoring": True,
        },
        "queue": {
            "max_size": 50000,
            "max_batch_size": 100,
            "enable_compression": True,
            "parallel_processing_limit": 10,
        },
        "notifications": {"level": "all", "enable_sounds": True},
    },
    "development": {
        "description": "Development-friendly configuration",
        "vscode_extension": {
            "debug_mode": True,
            "log_level": "debug",
            "auto_discovery": True,
        },
        "performance": {
            "memory_limit_mb": 200,
            "enable_performance_monitoring": True,
        },
        "notifications": {"level": "all", "duration_ms": 3000},
    },
    "production": {
        "description": "Production-optimized configuration",
        "vscode_extension": {
            "debug_mode": False,
            "log_level": "info",
            "enable_telemetry": False,
        },
        "security": {
            "enable_strict_validation": True,
            "enable_rate_limiting": True,
            "enable_audit_logging": True,
        },
        "performance": {
            "memory_limit_mb": 150,
            "enable_performance_monitoring": True,
        },
        "notifications": {"level": "errors", "quiet_hours_enabled": True},
    },
}
