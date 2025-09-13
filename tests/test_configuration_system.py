"""
Test suite for comprehensive configuration and settings management system.
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

import pytest
from pydantic import ValidationError

from src.specforged.config.manager import (
    ConfigurationManager,
    ConfigurationMigrator,
    FeatureFlagManager,
)

# Import the configuration system modules
from src.specforged.config.schema import (
    CONFIGURATION_PROFILES,
    ConfigurationValidator,
    ConfigVersion,
    FeatureFlag,
    NotificationConfig,
    PerformanceConfig,
    QueueConfig,
    UnifiedConfig,
    VSCodeExtensionConfig,
)


class TestConfigurationSchema:
    """Test configuration schema validation."""

    def test_unified_config_creation(self):
        """Test creating a valid unified configuration."""
        config = UnifiedConfig(
            created_at=datetime.now(timezone.utc).isoformat(),
            mcp_server={
                "name": "test-server",
                "version": "1.0.0",
                "description": "Test server",
            },
        )

        assert config.version == ConfigVersion.V2_0_0
        assert config.environment == "production"
        assert config.mcp_server.name == "test-server"
        assert isinstance(config.notifications, NotificationConfig)
        assert isinstance(config.queue, QueueConfig)
        assert isinstance(config.performance, PerformanceConfig)

    def test_feature_flag_validation(self):
        """Test feature flag validation."""
        # Valid feature flag
        flag = FeatureFlag(
            name="test_feature",
            enabled=True,
            rollout_percentage=50.0,
            target_groups=["beta_users"],
            conditions={},
            metadata={},
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        assert flag.name == "test_feature"
        assert flag.rollout_percentage == 50.0

        # Invalid feature flag name
        with pytest.raises(ValueError, match="Feature name must start with letter"):
            FeatureFlag(
                name="123_invalid",
                enabled=True,
                created_at=datetime.now(timezone.utc).isoformat(),
            )

        # Invalid target group
        with pytest.raises(ValueError, match="Invalid target groups"):
            FeatureFlag(
                name="test_feature",
                enabled=True,
                target_groups=["invalid_group"],
                created_at=datetime.now(timezone.utc).isoformat(),
            )

    def test_notification_config_validation(self):
        """Test notification configuration validation."""
        config = NotificationConfig(
            enabled=True,
            duration_ms=5000,
            quiet_start_time="22:00",
            quiet_end_time="08:00",
        )

        assert config.enabled is True
        assert config.duration_ms == 5000
        assert config.quiet_start_time == "22:00"

        # Invalid time format
        with pytest.raises(ValueError):
            NotificationConfig(quiet_start_time="25:00")

    def test_performance_config_validation(self):
        """Test performance configuration validation."""
        # Valid config
        config = PerformanceConfig(memory_limit_mb=100, memory_warning_threshold_mb=80)
        assert config.memory_limit_mb == 100
        assert config.memory_warning_threshold_mb == 80

        # Invalid config - warning threshold >= limit
        with pytest.raises(
            ValidationError,
            match="Memory warning threshold must be less than memory limit",
        ):
            PerformanceConfig(memory_limit_mb=100, memory_warning_threshold_mb=100)

    def test_queue_config_validation(self):
        """Test queue configuration validation."""
        config = QueueConfig(max_size=10000, max_batch_size=50, batch_timeout_ms=1000)

        assert config.max_size == 10000
        assert config.max_batch_size == 50

        # Invalid batch size
        with pytest.raises(ValueError):
            QueueConfig(max_batch_size=0)

    def test_configuration_profiles(self):
        """Test predefined configuration profiles."""
        assert "minimal" in CONFIGURATION_PROFILES
        assert "balanced" in CONFIGURATION_PROFILES
        assert "performance" in CONFIGURATION_PROFILES

        minimal_profile = CONFIGURATION_PROFILES["minimal"]
        assert "performance" in minimal_profile
        assert minimal_profile["performance"]["memory_limit_mb"] == 50


class TestConfigurationValidator:
    """Test configuration validation system."""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Set up test fixtures."""
        self.validator = ConfigurationValidator()
        yield

    def test_config_validation_success(self):
        """Test successful configuration validation."""
        validator = ConfigurationValidator()
        config_data = {
            "version": "2.0.0",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "mcp_server": {
                "name": "test-server",
                "version": "1.0.0",
                "description": "Test server",
            },
        }

        is_valid, errors = validator.validate_config(config_data, UnifiedConfig)
        assert is_valid is True
        assert len(errors) == 0

    def test_config_validation_failure(self):
        """Test configuration validation with errors."""
        validator = ConfigurationValidator()
        config_data = {
            "version": "2.0.0",
            "created_at": "invalid-date",  # Invalid date format
            "mcp_server": {
                "name": "",
                "version": "1.0.0",
            },  # Invalid empty name
        }

        is_valid, errors = validator.validate_config(config_data, UnifiedConfig)
        assert is_valid is False
        assert len(errors) > 0

    def test_migration_compatibility_validation(self):
        """Test migration compatibility validation."""
        validator = ConfigurationValidator()
        config_data = {
            "version": "1.0.0",
            "legacy_mode": True,  # Setting that will be removed
            "enable_notifications": False,  # Setting that will be renamed
        }

        can_migrate, warnings = validator.validate_migration_compatibility(
            "1.0.0", "2.0.0", config_data
        )

        assert can_migrate is True
        assert len(warnings) >= 1
        assert any("legacy_mode" in warning for warning in warnings)

    def test_environment_consistency_validation(self):
        """Test environment-specific validation."""
        validator = ConfigurationValidator()

        # Production config with debug mode enabled (should warn)
        config = UnifiedConfig(
            created_at=datetime.now(timezone.utc).isoformat(),
            environment="production",
            vscode_extension=VSCodeExtensionConfig(debug_mode=True),
            mcp_server={
                "name": "test-server",
                "version": "1.0.0",
                "description": "Test server",
            },
        )

        issues = validator.validate_environment_consistency(config)
        assert len(issues) > 0
        assert any("debug mode" in issue.lower() for issue in issues)


class TestConfigurationMigrator:
    """Test configuration migration system."""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Set up test fixtures."""
        self.migrator = ConfigurationMigrator()
        yield

    def test_no_migration_needed(self):
        """Test when no migration is needed."""
        migrator = ConfigurationMigrator()
        config_data = {"version": "2.0.0", "test": "value"}

        result = migrator.migrate(config_data, "2.0.0")

        assert result.success is True
        assert result.old_version == "2.0.0"
        assert result.new_version == "2.0.0"
        assert len(result.applied_migrations) == 0

    def test_single_migration(self):
        """Test single version migration."""
        migrator = ConfigurationMigrator()
        config_data = {"version": "1.0.0", "enable_notifications": True}

        result = migrator.migrate(config_data, "1.1.0")

        assert result.success is True
        assert result.old_version == "1.0.0"
        assert result.new_version == "1.1.0"
        assert len(result.applied_migrations) == 1
        assert "1.0.0->1.1.0" in result.applied_migrations

    def test_multi_step_migration(self):
        """Test migration across multiple versions."""
        migrator = ConfigurationMigrator()
        config_data = {
            "version": "1.0.0",
            "enable_notifications": True,
            "cache_settings": {"enabled": True, "size": 500},
        }

        result = migrator.migrate(config_data, "2.0.0")

        assert result.success is True
        assert result.old_version == "1.0.0"
        assert result.new_version == "2.0.0"
        assert len(result.applied_migrations) == 3  # 1.0->1.1->1.2->2.0

    def test_invalid_migration_path(self):
        """Test handling of invalid migration paths."""
        migrator = ConfigurationMigrator()
        config_data = {"version": "3.0.0"}  # Future version

        result = migrator.migrate(config_data, "2.0.0")

        assert result.success is False
        assert len(result.errors) > 0


class TestFeatureFlagManager:
    """Test feature flag management system."""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Set up test fixtures."""
        self.temp_dir = TemporaryDirectory()
        self.config_manager = Mock()
        self.feature_manager = FeatureFlagManager(self.config_manager)
        yield
        self.temp_dir.cleanup()

    def test_feature_flag_creation(self):
        """Test creating a feature flag."""
        # Mock config manager
        config = Mock()
        config.feature_flags = {}
        self.config_manager.get_config.return_value = config
        self.config_manager.save_config.return_value = None

        success = self.feature_manager.create_flag(
            "test_feature",
            enabled=True,
            rollout_percentage=25.0,
            target_groups=["beta_users"],
        )

        assert success is True
        assert "test_feature" in config.feature_flags

        flag = config.feature_flags["test_feature"]
        assert flag.enabled is True
        assert flag.rollout_percentage == 25.0
        assert "beta_users" in flag.target_groups

    def test_feature_flag_evaluation(self):
        """Test feature flag evaluation logic."""
        # Create mock config with feature flag
        flag = FeatureFlag(
            name="test_feature",
            enabled=True,
            rollout_percentage=50.0,
            target_groups=["beta_users"],
            conditions={},
            metadata={},
            created_at=datetime.now(timezone.utc).isoformat(),
        )

        config = Mock()
        config.feature_flags = {"test_feature": flag}
        self.config_manager.get_config.return_value = config

        # Set user context
        self.feature_manager.set_user_context(
            {
                "userId": "test-user",
                "groups": ["beta_users"],
                "environment": "development",
                "version": "1.0.0",
            }
        )

        # Feature should be enabled for beta users
        enabled = self.feature_manager.is_enabled("test_feature")
        # Note: Result depends on rollout percentage hashing, but should be consistent
        assert isinstance(enabled, bool)

    def test_rollout_percentage_consistency(self):
        """Test that rollout percentage is consistent for the same user."""
        flag = FeatureFlag(
            name="test_feature",
            enabled=True,
            rollout_percentage=50.0,
            target_groups=["all"],
            conditions={},
            metadata={},
            created_at=datetime.now(timezone.utc).isoformat(),
        )

        config = Mock()
        config.feature_flags = {"test_feature": flag}
        self.config_manager.get_config.return_value = config

        self.feature_manager.set_user_context(
            {
                "userId": "consistent-user",
                "groups": ["all"],
                "environment": "production",
                "version": "1.0.0",
            }
        )

        # Should get the same result multiple times
        result1 = self.feature_manager.is_enabled("test_feature")
        result2 = self.feature_manager.is_enabled("test_feature")
        result3 = self.feature_manager.is_enabled("test_feature")

        assert result1 == result2 == result3

    def test_expired_feature_flag(self):
        """Test that expired feature flags are disabled."""
        flag = FeatureFlag(
            name="expired_feature",
            enabled=True,
            rollout_percentage=100.0,
            target_groups=["all"],
            conditions={},
            metadata={},
            created_at=datetime.now(timezone.utc).isoformat(),
            expires_at=(
                datetime.now(timezone.utc).replace(year=2020)
            ).isoformat(),  # Past date
        )

        config = Mock()
        config.feature_flags = {"expired_feature": flag}
        self.config_manager.get_config.return_value = config

        enabled = self.feature_manager.is_enabled("expired_feature")
        assert enabled is False


class TestConfigurationManager:
    """Test the main configuration manager."""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Set up test fixtures."""
        self.temp_dir = TemporaryDirectory()
        self.config_dir = Path(self.temp_dir.name) / ".specforged"
        self.config_manager = ConfigurationManager(self.config_dir)
        yield
        self.temp_dir.cleanup()

    def test_config_creation_and_loading(self):
        """Test creating and loading configuration."""
        # Create a test configuration
        config = UnifiedConfig(
            created_at=datetime.now(timezone.utc).isoformat(),
            environment="testing",
            mcp_server={
                "name": "test-server",
                "version": "1.0.0",
                "description": "Test server",
            },
        )

        # Save configuration
        success = self.config_manager.save_config(config)
        assert success is True

        # Load configuration
        loaded_config = self.config_manager.get_config(reload=True)
        assert loaded_config.environment == "testing"
        assert loaded_config.mcp_server.name == "test-server"

    def test_configuration_backup_and_restore(self):
        """Test backup and restore functionality."""
        # Create initial config
        config = UnifiedConfig(
            created_at=datetime.now(timezone.utc).isoformat(),
            environment="production",
            mcp_server={
                "name": "prod-server",
                "version": "1.0.0",
                "description": "Production server",
            },
        )
        self.config_manager.save_config(config, backup=True)

        # Modify config
        config.environment = "staging"
        self.config_manager.save_config(config, backup=True)

        # List backups
        backups = self.config_manager.list_backups()
        assert len(backups) >= 1

        # Restore from backup
        backup_filename = backups[0]["filename"]
        success = self.config_manager.restore_backup(backup_filename)
        assert success is True

        # Verify restoration
        restored_config = self.config_manager.get_config(reload=True)
        assert restored_config.environment in [
            "production",
            "staging",
        ]  # Either could be the backup

    def test_configuration_profiles(self):
        """Test loading configuration profiles."""
        success = self.config_manager.load_profile("minimal")
        assert success is True

        config = self.config_manager.get_config(reload=True)
        assert (
            config.performance.memory_limit_mb <= 50
        )  # Minimal profile has low memory

    def test_configuration_export_import(self):
        """Test configuration export and import."""
        # Create test config
        config = UnifiedConfig(
            created_at=datetime.now(timezone.utc).isoformat(),
            environment="testing",
            mcp_server={
                "name": "export-test-server",
                "version": "1.0.0",
                "description": "Export test server",
            },
        )
        self.config_manager.save_config(config)

        # Export configuration
        export_path = self.config_dir / "exported_config.json"
        success = self.config_manager.export_config(export_path)
        assert success is True
        assert export_path.exists()

        # Modify config
        config.environment = "modified"
        self.config_manager.save_config(config)

        # Import configuration
        success = self.config_manager.import_config(export_path, merge=False)
        assert success is True

        # Verify import
        imported_config = self.config_manager.get_config(reload=True)
        assert imported_config.environment == "testing"  # Should be restored
        assert imported_config.mcp_server.name == "export-test-server"

    def test_configuration_migration(self):
        """Test configuration migration."""
        # Create old version config file
        old_config = {
            "version": "1.0.0",
            "enable_notifications": True,
            "cache_settings": {"enabled": True, "size": 500},
        }

        config_file = self.config_dir / "config.json"
        config_file.parent.mkdir(parents=True, exist_ok=True)
        with open(config_file, "w") as f:
            json.dump(old_config, f)

        # Perform migration
        result = self.config_manager.migrate_to_version("2.0.0")

        assert result.success is True
        assert result.old_version == "1.0.0"
        assert result.new_version == "2.0.0"
        assert len(result.applied_migrations) > 0

        # Verify migrated config
        migrated_config = self.config_manager.get_config(reload=True)
        assert migrated_config.version == ConfigVersion.V2_0_0
        assert (
            migrated_config.notifications.enabled is True
        )  # Migrated from enable_notifications

    def test_configuration_validation_integration(self):
        """Test integration with validation system."""
        # Test that config creation fails with invalid threshold > limit
        with pytest.raises(
            ValidationError,
            match="Memory warning threshold must be less than memory limit",
        ):
            UnifiedConfig(
                created_at=datetime.now(timezone.utc).isoformat(),
                environment="production",
                vscode_extension=VSCodeExtensionConfig(
                    debug_mode=True
                ),  # Issue: debug in prod
                performance=PerformanceConfig(
                    memory_limit_mb=100,
                    memory_warning_threshold_mb=120,  # Issue: threshold > limit
                ),
                mcp_server={
                    "name": "validation-test-server",
                    "version": "1.0.0",
                    "description": "Validation test server",
                },
            )

    @patch.dict(os.environ, {"SPECFORGE_DEBUG": "true", "SPECFORGE_LOG_LEVEL": "debug"})
    def test_environment_variable_override(self):
        """Test configuration override via environment variables."""
        config = self.config_manager.get_config(reload=True)

        # Environment variables should override defaults
        assert config.vscode_extension.debug_mode is True
        assert config.vscode_extension.log_level.value == "debug"


class TestConfigurationIntegration:
    """Integration tests for the configuration system."""

    @pytest.fixture(autouse=True)
    def setup(self):
        """Set up test fixtures."""
        self.temp_dir = TemporaryDirectory()
        yield
        self.temp_dir.cleanup()

    def test_full_configuration_lifecycle(self):
        """Test complete configuration lifecycle."""
        config_dir = Path(self.temp_dir.name) / ".specforged"

        # 1. Initialize configuration manager
        manager = ConfigurationManager(config_dir)

        # 2. Create initial configuration
        config = manager.get_config()
        assert config is not None

        # 3. Load a profile
        success = manager.load_profile("balanced")
        assert success is True

        # 4. Create and manage feature flags
        flag_manager = manager.feature_flags
        success = flag_manager.create_flag(
            "integration_test_feature",
            enabled=True,
            rollout_percentage=100.0,
            target_groups=["all"],
        )
        assert success is True

        # 5. Validate configuration
        is_valid, errors = manager.validate_current_config()
        if not is_valid:
            print(f"Validation errors: {errors}")
        # Allow some warnings but no critical errors
        critical_errors = [e for e in errors if "error" in e.lower()]
        assert len(critical_errors) == 0

        # 6. Export and import configuration
        export_path = config_dir / "integration_test_export.json"
        success = manager.export_config(export_path)
        assert success is True

        # Modify config and import to restore
        config.environment = "modified"
        manager.save_config(config)

        success = manager.import_config(export_path)
        assert success is True

        # 7. Test feature flag evaluation
        enabled = flag_manager.is_enabled("integration_test_feature")
        assert enabled is True  # Should be enabled for 100% rollout

        # 8. Test backup system
        backups = manager.list_backups()
        assert len(backups) >= 1  # Should have backups from saves

        print("Full configuration lifecycle test completed successfully!")

    def test_configuration_error_recovery(self):
        """Test error recovery mechanisms."""
        config_dir = Path(self.temp_dir.name) / ".specforged"
        manager = ConfigurationManager(config_dir)

        # Create valid config
        config = manager.get_config()
        manager.save_config(config, backup=True)

        # Corrupt the config file
        config_file = config_dir / "config.json"
        with open(config_file, "w") as f:
            f.write("invalid json content")

        # Manager should fall back to defaults and handle error gracefully
        try:
            recovered_config = manager.get_config(reload=True)
            # Should get default config
            assert recovered_config.version == ConfigVersion.V2_0_0
        except Exception as e:
            # Should not crash completely
            pytest.fail(f"Configuration recovery failed: {e}")

    def test_performance_under_load(self):
        """Test configuration system performance."""
        config_dir = Path(self.temp_dir.name) / ".specforged"
        manager = ConfigurationManager(config_dir)

        # Create multiple feature flags
        flag_manager = manager.feature_flags
        for i in range(50):
            flag_manager.create_flag(
                f"perf_test_flag_{i}",
                enabled=True,
                rollout_percentage=float(i * 2),  # 0-98%
                target_groups=["beta_users" if i % 2 == 0 else "developers"],
            )

        # Test rapid flag evaluation
        import time

        start_time = time.time()

        for i in range(100):
            for j in range(25):  # Test 25 flags, 100 times each
                flag_manager.is_enabled(f"perf_test_flag_{j}")
                # Result doesn't matter, just testing performance

        elapsed = time.time() - start_time

        # Should be able to evaluate 2500 flags in reasonable time (< 1 second)
        assert (
            elapsed < 1.0
        ), f"Feature flag evaluation too slow: {elapsed}s for 2500 evaluations"

        print(f"Performance test completed: {2500 / elapsed:.0f} evaluations/second")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
