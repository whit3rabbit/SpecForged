"""
Configuration management and migration framework for SpecForge MCP ecosystem.

This module provides centralized configuration management with automatic
migration, validation, and environment-specific configuration handling.
"""

import os
import json
import yaml
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Callable
from dataclasses import dataclass, field
from contextlib import contextmanager
import logging
import hashlib
from threading import Lock

from pydantic import ValidationError

from .schema import (
    UnifiedConfig,
    ConfigVersion,
    ConfigurationValidator,
    CONFIGURATION_PROFILES,
    FeatureFlag,
)
from .performance import PerformanceConfigManager


logger = logging.getLogger(__name__)


@dataclass
class MigrationResult:
    """Result of a configuration migration operation."""

    success: bool
    old_version: str
    new_version: str
    warnings: List[str] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    backup_path: Optional[Path] = None
    applied_migrations: List[str] = field(default_factory=list)


@dataclass
class ConfigurationSource:
    """Represents a source of configuration data."""

    name: str
    priority: int  # Lower numbers = higher priority
    loader: Callable[[], Dict[str, Any]]
    is_writable: bool = False
    description: str = ""


class ConfigurationMigrator:
    """Handles configuration migrations between versions."""

    def __init__(self):
        self._migrations: Dict[str, Callable] = {}
        self._register_migrations()

    def register_migration(
        self,
        from_version: str,
        to_version: str,
        migration_func: Callable[[Dict[str, Any]], Dict[str, Any]],
    ):
        """Register a migration function."""
        key = f"{from_version}->{to_version}"
        self._migrations[key] = migration_func

    def migrate(
        self, config_data: Dict[str, Any], target_version: str
    ) -> MigrationResult:
        """Migrate configuration data to target version."""
        current_version = config_data.get("version", "1.0.0")

        if current_version == target_version:
            return MigrationResult(
                success=True, old_version=current_version, new_version=target_version
            )

        result = MigrationResult(
            success=False, old_version=current_version, new_version=target_version
        )

        try:
            # Find migration path
            migration_path = self._find_migration_path(current_version, target_version)
            if not migration_path:
                result.errors.append(
                    f"No migration path found from {current_version} to "
                    f"{target_version}"
                )
                return result

            # Apply migrations in sequence
            migrated_config = config_data.copy()

            for i in range(len(migration_path) - 1):
                from_ver = migration_path[i]
                to_ver = migration_path[i + 1]
                migration_key = f"{from_ver}->{to_ver}"

                if migration_key not in self._migrations:
                    result.errors.append(f"Missing migration: {migration_key}")
                    return result

                try:
                    migrated_config = self._migrations[migration_key](migrated_config)
                    migrated_config["version"] = to_ver
                    result.applied_migrations.append(migration_key)

                    logger.info(f"Applied migration: {migration_key}")

                except Exception as e:
                    result.errors.append(f"Migration {migration_key} failed: {str(e)}")
                    return result

            result.success = True

            # Update the original data with migrated version
            config_data.clear()
            config_data.update(migrated_config)

        except Exception as e:
            result.errors.append(f"Migration failed: {str(e)}")

        return result

    def _find_migration_path(
        self, from_version: str, to_version: str
    ) -> Optional[List[str]]:
        """Find migration path between versions."""
        # For simplicity, we'll use a linear migration path
        # In a more complex system, you might use graph algorithms

        version_order = ["1.0.0", "1.1.0", "1.2.0", "2.0.0"]

        try:
            start_idx = version_order.index(from_version)
            end_idx = version_order.index(to_version)

            if start_idx <= end_idx:
                return version_order[start_idx : end_idx + 1]
            else:
                # Downgrade not supported
                return None

        except ValueError:
            return None

    def _register_migrations(self):
        """Register all available migrations."""

        def migrate_1_0_to_1_1(config: Dict[str, Any]) -> Dict[str, Any]:
            """Migrate from v1.0.0 to v1.1.0 - Add feature flags."""
            migrated = config.copy()

            # Initialize feature flags section
            if "feature_flags" not in migrated:
                migrated["feature_flags"] = {}

            # Move old enable_notifications to new structure
            if "enable_notifications" in migrated:
                notifications = migrated.setdefault("notifications", {})
                notifications["enabled"] = migrated.pop("enable_notifications")

            return migrated

        def migrate_1_1_to_1_2(config: Dict[str, Any]) -> Dict[str, Any]:
            """Migrate from v1.1.0 to v1.2.0 - Add performance tuning."""
            migrated = config.copy()

            # Initialize performance section with defaults
            if "performance" not in migrated:
                migrated["performance"] = {
                    "memory_limit_mb": 100,
                    "enable_caching": True,
                    "cache_size": 1000,
                }

            # Migrate old cache settings
            if "cache_settings" in migrated:
                old_cache = migrated.pop("cache_settings")
                performance = migrated["performance"]
                performance.update(
                    {
                        "enable_caching": old_cache.get("enabled", True),
                        "cache_size": old_cache.get("size", 1000),
                        "cache_ttl_seconds": old_cache.get("ttl", 300),
                    }
                )

            return migrated

        def migrate_1_2_to_2_0(config: Dict[str, Any]) -> Dict[str, Any]:
            """Migrate from v1.2.0 to v2.0.0 - Unified configuration."""
            # migrated = config.copy()  # Keep for potential future use

            # Restructure to unified format
            unified = {
                "version": "2.0.0",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "environment": config.get("environment", "production"),
                "notifications": {},
                "queue": {},
                "performance": {},
                "security": {},
                "vscode_extension": {},
                "mcp_server": {
                    "name": "specforged",
                    "version": "2.0.0",
                    "description": "SpecForged MCP Server",
                },
                "feature_flags": config.get("feature_flags", {}),
                "conflict_resolution": "ask_user",
                "custom_settings": {},
            }

            # Migrate notification settings
            if "notifications" in config:
                unified["notifications"] = config["notifications"]

            # Migrate performance settings
            if "performance" in config:
                unified["performance"] = config["performance"]

            # Migrate VS Code extension settings
            vscode_keys = [
                "auto_detect",
                "spec_folder",
                "server_type",
                "server_path",
                "debug_mode",
                "log_level",
                "enable_telemetry",
            ]

            for key in vscode_keys:
                if key in config:
                    unified["vscode_extension"][key] = config[key]

            # Move any remaining settings to custom_settings
            reserved_keys = {
                "version",
                "created_at",
                "environment",
                "notifications",
                "queue",
                "performance",
                "security",
                "vscode_extension",
                "mcp_server",
                "feature_flags",
                "conflict_resolution",
            }

            for key, value in config.items():
                if key not in reserved_keys and key not in vscode_keys:
                    unified["custom_settings"][key] = value

            return unified

        # Register migrations
        self.register_migration("1.0.0", "1.1.0", migrate_1_0_to_1_1)
        self.register_migration("1.1.0", "1.2.0", migrate_1_1_to_1_2)
        self.register_migration("1.2.0", "2.0.0", migrate_1_2_to_2_0)


class FeatureFlagManager:
    """Manages feature flags with rollout controls."""

    def __init__(self, config_manager: "ConfigurationManager"):
        self.config_manager = config_manager
        self._flag_cache: Dict[str, bool] = {}
        self._cache_lock = Lock()
        self._user_context: Dict[str, Any] = {}

    def is_enabled(
        self,
        flag_name: str,
        user_id: Optional[str] = None,
        context: Optional[Dict[str, Any]] = None,
    ) -> bool:
        """Check if a feature flag is enabled for the current user/context."""

        # Check cache first
        cache_key = f"{flag_name}:{user_id or 'anonymous'}"
        with self._cache_lock:
            if cache_key in self._flag_cache:
                return self._flag_cache[cache_key]

        try:
            config = self.config_manager.get_config()
            if flag_name not in config.feature_flags:
                # Feature flag doesn't exist - return False by default
                return False

            flag = config.feature_flags[flag_name]

            # Check if flag is expired
            if flag.expires_at:
                expire_time = datetime.fromisoformat(
                    flag.expires_at.replace("Z", "+00:00")
                )
                if datetime.now(timezone.utc) > expire_time:
                    return False

            # If flag is disabled, return False
            if not flag.enabled:
                return False

            # Check rollout percentage
            enabled = self._check_rollout_percentage(flag, user_id)

            if enabled:
                # Check target groups
                enabled = self._check_target_groups(flag, context or self._user_context)

            if enabled:
                # Check conditions
                enabled = self._check_conditions(flag, context or self._user_context)

            # Cache result
            with self._cache_lock:
                self._flag_cache[cache_key] = enabled

            return enabled

        except Exception as e:
            logger.error(f"Error checking feature flag '{flag_name}': {e}")
            return False

    def set_user_context(self, context: Dict[str, Any]):
        """Set user context for feature flag evaluation."""
        self._user_context = context
        # Clear cache when context changes
        with self._cache_lock:
            self._flag_cache.clear()

    def create_flag(
        self,
        name: str,
        enabled: bool = False,
        rollout_percentage: float = 0.0,
        target_groups: Optional[List[str]] = None,
        conditions: Optional[Dict[str, Any]] = None,
        expires_at: Optional[str] = None,
    ) -> bool:
        """Create a new feature flag."""
        try:
            config = self.config_manager.get_config()

            flag = FeatureFlag(
                name=name,
                enabled=enabled,
                rollout_percentage=rollout_percentage,
                target_groups=target_groups or [],
                conditions=conditions or {},
                created_at=datetime.now(timezone.utc).isoformat(),
                expires_at=expires_at,
            )

            config.feature_flags[name] = flag
            self.config_manager.save_config(config)

            # Clear cache
            with self._cache_lock:
                self._flag_cache.clear()

            logger.info(f"Created feature flag: {name}")
            return True

        except Exception as e:
            logger.error(f"Failed to create feature flag '{name}': {e}")
            return False

    def update_flag(self, name: str, **kwargs) -> bool:
        """Update an existing feature flag."""
        try:
            config = self.config_manager.get_config()

            if name not in config.feature_flags:
                raise ValueError(f"Feature flag '{name}' does not exist")

            flag = config.feature_flags[name]

            # Update fields
            for key, value in kwargs.items():
                if hasattr(flag, key):
                    setattr(flag, key, value)

            flag.updated_at = datetime.now(timezone.utc).isoformat()

            self.config_manager.save_config(config)

            # Clear cache
            with self._cache_lock:
                self._flag_cache.clear()

            logger.info(f"Updated feature flag: {name}")
            return True

        except Exception as e:
            logger.error(f"Failed to update feature flag '{name}': {e}")
            return False

    def delete_flag(self, name: str) -> bool:
        """Delete a feature flag."""
        try:
            config = self.config_manager.get_config()

            if name not in config.feature_flags:
                return False

            del config.feature_flags[name]
            self.config_manager.save_config(config)

            # Clear cache
            with self._cache_lock:
                self._flag_cache.clear()

            logger.info(f"Deleted feature flag: {name}")
            return True

        except Exception as e:
            logger.error(f"Failed to delete feature flag '{name}': {e}")
            return False

    def list_flags(self) -> Dict[str, FeatureFlag]:
        """List all feature flags."""
        config = self.config_manager.get_config()
        return config.feature_flags

    def _check_rollout_percentage(
        self, flag: FeatureFlag, user_id: Optional[str]
    ) -> bool:
        """Check if user falls within rollout percentage."""
        if flag.rollout_percentage >= 100.0:
            return True
        if flag.rollout_percentage <= 0.0:
            return False

        # Use consistent hashing based on flag name and user ID
        hash_input = f"{flag.name}:{user_id or 'anonymous'}"
        hash_value = int(hashlib.md5(hash_input.encode()).hexdigest(), 16)
        percentage = (hash_value % 100) + 1

        return percentage <= flag.rollout_percentage

    def _check_target_groups(self, flag: FeatureFlag, context: Dict[str, Any]) -> bool:
        """Check if user belongs to target groups."""
        if not flag.target_groups:
            return True  # No group restrictions

        user_groups = context.get("groups", [])
        if not user_groups:
            return "all" in flag.target_groups

        return any(group in flag.target_groups for group in user_groups)

    def _check_conditions(self, flag: FeatureFlag, context: Dict[str, Any]) -> bool:
        """Check if conditions are met."""
        if not flag.conditions:
            return True  # No conditions

        for condition_name, condition_value in flag.conditions.items():
            if condition_name == "environment":
                if context.get("environment") != condition_value:
                    return False
            elif condition_name == "min_version":
                user_version = context.get("version", "0.0.0")
                if self._version_compare(user_version, condition_value) < 0:
                    return False
            elif condition_name == "max_version":
                user_version = context.get("version", "999.999.999")
                if self._version_compare(user_version, condition_value) > 0:
                    return False
            # Add more condition types as needed

        return True

    def _version_compare(self, version1: str, version2: str) -> int:
        """Compare two version strings. Returns -1, 0, or 1."""
        v1_parts = [int(x) for x in version1.split(".")]
        v2_parts = [int(x) for x in version2.split(".")]

        # Pad shorter version with zeros
        max_len = max(len(v1_parts), len(v2_parts))
        v1_parts.extend([0] * (max_len - len(v1_parts)))
        v2_parts.extend([0] * (max_len - len(v2_parts)))

        for i in range(max_len):
            if v1_parts[i] < v2_parts[i]:
                return -1
            elif v1_parts[i] > v2_parts[i]:
                return 1

        return 0


class ConfigurationManager:
    """Central configuration management with validation and migration."""

    def __init__(self, config_dir: Optional[Path] = None):
        self.config_dir = config_dir or Path.cwd() / ".specforged"
        self.config_file = self.config_dir / "config.json"
        self.backup_dir = self.config_dir / "backups"

        self._config: Optional[UnifiedConfig] = None
        self._config_lock = Lock()
        self._sources: List[ConfigurationSource] = []

        # Initialize components
        self.validator = ConfigurationValidator()
        self.migrator = ConfigurationMigrator()
        self.feature_flags = FeatureFlagManager(self)
        self.performance_manager = PerformanceConfigManager()

        # Ensure directories exist
        self.config_dir.mkdir(parents=True, exist_ok=True)
        self.backup_dir.mkdir(parents=True, exist_ok=True)

        # Register default configuration sources
        self._register_default_sources()

    def get_config(self, reload: bool = False) -> UnifiedConfig:
        """Get current configuration."""
        with self._config_lock:
            if self._config is None or reload:
                self._config = self._load_config()
            return self._config

    def save_config(self, config: UnifiedConfig, backup: bool = True) -> bool:
        """Save configuration to file."""
        try:
            if backup:
                self._create_backup()

            config.updated_at = datetime.now(timezone.utc).isoformat()

            with open(self.config_file, "w") as f:
                json.dump(config.dict(), f, indent=2, default=str)

            with self._config_lock:
                self._config = config

            logger.info(f"Configuration saved to {self.config_file}")
            return True

        except Exception as e:
            logger.error(f"Failed to save configuration: {e}")
            return False

    def load_profile(self, profile_name: str) -> bool:
        """Load a predefined configuration profile."""
        if profile_name not in CONFIGURATION_PROFILES:
            logger.error(f"Unknown configuration profile: {profile_name}")
            return False

        try:
            current_config = self.get_config()
            profile_data = CONFIGURATION_PROFILES[profile_name]

            # Merge profile settings with current config
            config_dict = current_config.dict()
            self._deep_merge(config_dict, profile_data)

            # Validate merged configuration
            new_config = UnifiedConfig(**config_dict)

            # Save updated configuration
            return self.save_config(new_config)

        except Exception as e:
            logger.error(f"Failed to load profile '{profile_name}': {e}")
            return False

    def migrate_to_version(self, target_version: str) -> MigrationResult:
        """Migrate configuration to target version."""
        current_config = self._load_raw_config()

        # Create backup before migration
        backup_path = self._create_backup()

        # Perform migration
        result = self.migrator.migrate(current_config, target_version)
        result.backup_path = backup_path

        if result.success:
            try:
                # Validate migrated configuration
                migrated_config = UnifiedConfig(**current_config)
                self.save_config(migrated_config, backup=False)  # Already backed up

                logger.info(
                    f"Successfully migrated from {result.old_version} to "
                    f"{result.new_version}"
                )

            except ValidationError as e:
                result.success = False
                result.errors.append(f"Migrated configuration failed validation: {e}")

                # Restore from backup
                if backup_path and backup_path.exists():
                    shutil.copy2(backup_path, self.config_file)
                    logger.info(
                        "Restored configuration from backup due to validation failure"
                    )

        return result

    def validate_current_config(self) -> tuple[bool, List[str]]:
        """Validate current configuration."""
        try:
            config = self.get_config()

            # Basic schema validation (already done by Pydantic)
            errors = []

            # Environment-specific validation
            env_issues = self.validator.validate_environment_consistency(config)
            errors.extend(env_issues)

            return len(errors) == 0, errors

        except Exception as e:
            return False, [str(e)]

    def register_configuration_source(self, source: ConfigurationSource):
        """Register a configuration source."""
        self._sources.append(source)
        # Sort by priority (lower numbers = higher priority)
        self._sources.sort(key=lambda s: s.priority)

    def export_config(self, export_path: Path, include_sensitive: bool = False) -> bool:
        """Export configuration to file."""
        try:
            config = self.get_config()
            export_data = config.dict()

            if not include_sensitive:
                # Remove sensitive data
                if "smithery_api_key" in export_data.get("vscode_extension", {}):
                    export_data["vscode_extension"][
                        "smithery_api_key"
                    ] = "***REDACTED***"

                # Remove custom settings that might contain sensitive data
                export_data["custom_settings"] = {}

            with open(export_path, "w") as f:
                if export_path.suffix.lower() == ".yaml":
                    yaml.dump(export_data, f, indent=2, default_flow_style=False)
                else:
                    json.dump(export_data, f, indent=2, default=str)

            logger.info(f"Configuration exported to {export_path}")
            return True

        except Exception as e:
            logger.error(f"Failed to export configuration: {e}")
            return False

    def import_config(self, import_path: Path, merge: bool = False) -> bool:
        """Import configuration from file."""
        try:
            if not import_path.exists():
                raise FileNotFoundError(f"Import file not found: {import_path}")

            with open(import_path, "r") as f:
                if import_path.suffix.lower() in [".yaml", ".yml"]:
                    import_data = yaml.safe_load(f)
                else:
                    import_data = json.load(f)

            if merge:
                # Merge with existing configuration
                current_config = self.get_config()
                config_dict = current_config.dict()
                self._deep_merge(config_dict, import_data)
                import_data = config_dict

            # Validate imported configuration
            new_config = UnifiedConfig(**import_data)

            # Save configuration
            return self.save_config(new_config)

        except Exception as e:
            logger.error(f"Failed to import configuration: {e}")
            return False

    def reset_to_defaults(self) -> bool:
        """Reset configuration to defaults."""
        try:
            # Create backup first
            self._create_backup()

            # Create default configuration
            default_config = UnifiedConfig(
                created_at=datetime.now(timezone.utc).isoformat(),
                mcp_server={
                    "name": "specforged",
                    "version": "2.0.0",
                    "description": "SpecForged MCP Server",
                },
            )

            return self.save_config(default_config, backup=False)

        except Exception as e:
            logger.error(f"Failed to reset configuration: {e}")
            return False

    def list_backups(self) -> List[Dict[str, Any]]:
        """List available configuration backups."""
        backups = []

        for backup_file in self.backup_dir.glob("config_backup_*.json"):
            try:
                stat = backup_file.stat()
                timestamp_str = backup_file.stem.replace("config_backup_", "")

                backups.append(
                    {
                        "filename": backup_file.name,
                        "path": backup_file,
                        "size": stat.st_size,
                        "created_at": datetime.fromtimestamp(stat.st_ctime).isoformat(),
                        "timestamp": timestamp_str,
                    }
                )

            except Exception as e:
                logger.warning(f"Error reading backup file {backup_file}: {e}")

        # Sort by creation time (newest first)
        backups.sort(key=lambda b: b["created_at"], reverse=True)
        return backups

    def restore_backup(self, backup_filename: str) -> bool:
        """Restore configuration from backup."""
        try:
            backup_path = self.backup_dir / backup_filename

            if not backup_path.exists():
                raise FileNotFoundError(f"Backup file not found: {backup_filename}")

            # Validate backup before restoring
            with open(backup_path, "r") as f:
                backup_data = json.load(f)

            # Try to create config object to validate
            UnifiedConfig(**backup_data)  # Validate only

            # Create backup of current config before restoring
            self._create_backup()

            # Restore the backup
            shutil.copy2(backup_path, self.config_file)

            # Reload configuration
            with self._config_lock:
                self._config = None

            logger.info(f"Configuration restored from backup: {backup_filename}")
            return True

        except Exception as e:
            logger.error(f"Failed to restore backup '{backup_filename}': {e}")
            return False

    @contextmanager
    def config_transaction(self):
        """Context manager for transactional configuration changes."""
        backup_path = None
        original_config = None

        try:
            # Create backup and save original config
            backup_path = self._create_backup()
            original_config = self.get_config().copy(deep=True)

            yield self

            # Transaction succeeded - backup is kept

        except Exception as e:
            # Transaction failed - restore from backup
            if backup_path and backup_path.exists():
                try:
                    shutil.copy2(backup_path, self.config_file)
                    with self._config_lock:
                        self._config = original_config
                    logger.info("Configuration restored due to transaction failure")
                except Exception as restore_error:
                    logger.error(f"Failed to restore configuration: {restore_error}")

            raise e

    def _load_config(self) -> UnifiedConfig:
        """Load configuration from all sources."""
        # Start with default configuration
        config_data = self._get_default_config_data()

        # Load and merge from all sources in priority order
        for source in self._sources:
            try:
                source_data = source.loader()
                if source_data:
                    self._deep_merge(config_data, source_data)
                    logger.debug(f"Loaded configuration from source: {source.name}")
            except Exception as e:
                logger.warning(f"Failed to load from source '{source.name}': {e}")

        # Validate and return configuration
        return UnifiedConfig(**config_data)

    def _load_raw_config(self) -> Dict[str, Any]:
        """Load raw configuration data without validation."""
        if self.config_file.exists():
            with open(self.config_file, "r") as f:
                return json.load(f)
        else:
            return self._get_default_config_data()

    def _get_default_config_data(self) -> Dict[str, Any]:
        """Get default configuration data."""
        return {
            "version": ConfigVersion.V2_0_0,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "environment": os.getenv("SPECFORGE_ENV", "production"),
            "mcp_server": {
                "name": "specforged",
                "version": "2.0.0",
                "description": "SpecForged MCP Server",
            },
        }

    def _register_default_sources(self):
        """Register default configuration sources."""

        def load_config_file():
            if self.config_file.exists():
                with open(self.config_file, "r") as f:
                    return json.load(f)
            return {}

        def load_environment_variables():
            env_config = {}

            # Map environment variables to configuration
            env_mappings = {
                "SPECFORGE_DEBUG": "vscode_extension.debug_mode",
                "SPECFORGE_LOG_LEVEL": "vscode_extension.log_level",
                "SPECFORGE_SERVER_TYPE": "vscode_extension.server_type",
                "SPECFORGE_SERVER_URL": "vscode_extension.server_url",
                "SPECFORGE_MEMORY_LIMIT": "performance.memory_limit_mb",
                "SPECFORGE_ENABLE_TELEMETRY": "vscode_extension.enable_telemetry",
            }

            for env_var, config_path in env_mappings.items():
                value = os.getenv(env_var)
                if value is not None:
                    # Parse value based on type
                    if value.lower() in ("true", "false"):
                        value = value.lower() == "true"
                    elif value.isdigit():
                        value = int(value)

                    self._set_nested_value(env_config, config_path, value)

            return env_config

        # Register sources (lower priority number = higher precedence)
        self.register_configuration_source(
            ConfigurationSource(
                name="environment_variables",
                priority=1,  # Highest priority
                loader=load_environment_variables,
                description="Environment variable overrides",
            )
        )

        self.register_configuration_source(
            ConfigurationSource(
                name="config_file",
                priority=2,
                loader=load_config_file,
                is_writable=True,
                description="Main configuration file",
            )
        )

    def _deep_merge(self, target: Dict[str, Any], source: Dict[str, Any]):
        """Deep merge source into target dictionary."""
        for key, value in source.items():
            if (
                key in target
                and isinstance(target[key], dict)
                and isinstance(value, dict)
            ):
                self._deep_merge(target[key], value)
            else:
                target[key] = value

    def _set_nested_value(self, target: Dict[str, Any], path: str, value: Any):
        """Set nested dictionary value using dot notation."""
        keys = path.split(".")
        current = target

        for key in keys[:-1]:
            if key not in current:
                current[key] = {}
            current = current[key]

        current[keys[-1]] = value

    def _create_backup(self) -> Path:
        """Create a backup of current configuration."""
        if not self.config_file.exists():
            # No configuration to backup
            return None

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_filename = f"config_backup_{timestamp}.json"
        backup_path = self.backup_dir / backup_filename

        shutil.copy2(self.config_file, backup_path)

        # Clean up old backups (keep last 10)
        backups = self.list_backups()
        if len(backups) > 10:
            for backup in backups[10:]:
                try:
                    backup["path"].unlink()
                except Exception as e:
                    logger.warning(
                        f"Failed to delete old backup {backup['filename']}: {e}"
                    )

        logger.debug(f"Created configuration backup: {backup_filename}")
        return backup_path


# Global configuration manager instance
_config_manager: Optional[ConfigurationManager] = None


def get_config_manager(config_dir: Optional[Path] = None) -> ConfigurationManager:
    """Get global configuration manager instance."""
    global _config_manager

    if _config_manager is None:
        _config_manager = ConfigurationManager(config_dir)

    return _config_manager


def get_config(reload: bool = False) -> UnifiedConfig:
    """Get current configuration."""
    return get_config_manager().get_config(reload)


def is_feature_enabled(
    flag_name: str,
    user_id: Optional[str] = None,
    context: Optional[Dict[str, Any]] = None,
) -> bool:
    """Check if a feature flag is enabled."""
    return get_config_manager().feature_flags.is_enabled(flag_name, user_id, context)
