"""
Performance configuration management for SpecForge MCP ecosystem.

This module provides centralized configuration for all performance optimizations
including caching, batching, streaming, memory management, and background processing.
"""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

import yaml
from pydantic import BaseModel, Field, field_validator


class PerformanceProfile(str):
    """Performance profile constants."""

    MINIMAL = "minimal"  # Minimal resource usage
    BALANCED = "balanced"  # Balance between performance and resources
    PERFORMANCE = "performance"  # Maximum performance
    DEVELOPMENT = "development"  # Development-friendly settings
    PRODUCTION = "production"  # Production-optimized settings


@dataclass
class CacheConfig:
    """Configuration for caching systems."""

    # LRU Cache settings
    lru_cache_size: int = 1000
    lru_cache_ttl_seconds: int = 300  # 5 minutes

    # Result caching
    enable_result_caching: bool = True
    result_cache_max_size: int = 500
    result_cache_ttl_seconds: int = 300

    # Parse result caching
    enable_parse_caching: bool = True
    parse_cache_ttl_seconds: int = 60

    # Cache cleanup
    auto_cleanup_expired: bool = True
    cleanup_interval_seconds: int = 300  # 5 minutes


@dataclass
class BatchingConfig:
    """Configuration for operation batching."""

    # Basic batching
    enable_batching: bool = True
    max_batch_size: int = 50
    batch_timeout_ms: int = 1000

    # Smart batching
    enable_smart_batching: bool = True
    enable_dependency_aware_batching: bool = True
    enable_type_based_batching: bool = True

    # Deduplication
    enable_operation_deduplication: bool = True
    deduplication_window_seconds: int = 60


@dataclass
class StreamingConfig:
    """Configuration for streaming JSON processing."""

    # Basic streaming
    enable_streaming: bool = True
    streaming_threshold_bytes: int = 1024 * 1024  # 1MB
    chunk_size_bytes: int = 8192

    # Advanced streaming
    enable_incremental_parsing: bool = True
    incremental_threshold_bytes: int = 50 * 1024 * 1024  # 50MB

    # Compression
    enable_compression: bool = True
    compression_threshold_operations: int = 100
    compression_level: int = 6


@dataclass
class MemoryConfig:
    """Configuration for memory management."""

    # Memory limits
    max_memory_usage_mb: int = 100
    enable_memory_monitoring: bool = True
    memory_warning_threshold_mb: int = 80

    # Garbage collection
    enable_aggressive_gc: bool = False
    gc_threshold_mb: int = 90

    # Queue management
    max_queue_size: int = 10000
    queue_compaction_threshold: float = 0.7  # Compact when 70% completed
    auto_queue_compaction: bool = True


@dataclass
class BackgroundConfig:
    """Configuration for background processing."""

    # Background tasks
    enable_background_processing: bool = True
    background_cleanup_interval_seconds: int = 60
    background_optimization_interval_seconds: int = 300  # 5 minutes

    # File system optimization
    enable_fs_optimization: bool = True
    cleanup_temp_files: bool = True
    temp_file_max_age_hours: int = 1
    max_backup_files: int = 5


@dataclass
class ConcurrencyConfig:
    """Configuration for concurrent processing."""

    # Basic concurrency
    max_parallel_operations: int = 3
    enable_concurrent_processing: bool = True

    # File watcher debouncing
    enable_file_watcher_debouncing: bool = True
    debounce_delay_ms: int = 250

    # Batched processing
    enable_batch_parallel_processing: bool = True
    parallel_batch_size: int = 10


class PerformanceConfigModel(BaseModel):
    """Pydantic model for performance configuration validation."""

    profile: str = Field(default=PerformanceProfile.BALANCED)

    # Component configurations
    cache: CacheConfig = Field(default_factory=CacheConfig)
    batching: BatchingConfig = Field(default_factory=BatchingConfig)
    streaming: StreamingConfig = Field(default_factory=StreamingConfig)
    memory: MemoryConfig = Field(default_factory=MemoryConfig)
    background: BackgroundConfig = Field(default_factory=BackgroundConfig)
    concurrency: ConcurrencyConfig = Field(default_factory=ConcurrencyConfig)

    # Global settings
    enable_performance_monitoring: bool = True
    enable_detailed_metrics: bool = True
    metrics_collection_interval_seconds: int = 30

    @field_validator("profile")
    @classmethod
    def validate_profile(cls, v):
        valid_profiles = [
            PerformanceProfile.MINIMAL,
            PerformanceProfile.BALANCED,
            PerformanceProfile.PERFORMANCE,
            PerformanceProfile.DEVELOPMENT,
            PerformanceProfile.PRODUCTION,
        ]
        if v not in valid_profiles:
            raise ValueError(f"Invalid profile: {v}. Must be one of {valid_profiles}")
        return v

    @field_validator("memory")
    @classmethod
    def validate_memory_config(cls, v):
        if v.max_memory_usage_mb <= 0:
            raise ValueError("max_memory_usage_mb must be positive")
        if v.memory_warning_threshold_mb >= v.max_memory_usage_mb:
            raise ValueError(
                "memory_warning_threshold_mb must be less than max_memory_usage_mb"
            )
        return v

    @field_validator("batching")
    @classmethod
    def validate_batching_config(cls, v):
        if v.max_batch_size <= 0:
            raise ValueError("max_batch_size must be positive")
        if v.batch_timeout_ms <= 0:
            raise ValueError("batch_timeout_ms must be positive")
        return v


class PerformanceConfigManager:
    """Centralized performance configuration manager."""

    def __init__(self, config_path: Optional[Path] = None):
        self.config_path = config_path
        self._config: Optional[PerformanceConfigModel] = None
        self._profile_configs = self._load_profile_configs()

    def load_config(self, profile: Optional[str] = None) -> PerformanceConfigModel:
        """Load performance configuration."""
        # Try to load from file first
        if self.config_path and self.config_path.exists():
            config = self._load_from_file()
        else:
            # Use environment-based configuration
            config = self._load_from_environment()

        # Apply profile if specified
        if profile:
            config = self._apply_profile(config, profile)
        elif not config.profile:
            # Auto-detect profile based on environment
            config.profile = self._detect_profile()
            config = self._apply_profile(config, config.profile)

        self._config = config
        return config

    def save_config(
        self, config: PerformanceConfigModel, path: Optional[Path] = None
    ) -> None:
        """Save configuration to file."""
        save_path = path or self.config_path
        if not save_path:
            raise ValueError("No save path specified")

        # Convert to dictionary for serialization
        config_dict = self._config_to_dict(config)

        save_path.parent.mkdir(parents=True, exist_ok=True)
        with open(save_path, "w") as f:
            yaml.dump(config_dict, f, default_flow_style=False, indent=2)

    def get_config(self) -> PerformanceConfigModel:
        """Get current configuration."""
        if self._config is None:
            self._config = self.load_config()
        return self._config

    def update_config(self, updates: Dict[str, Any]) -> PerformanceConfigModel:
        """Update configuration with new values."""
        config = self.get_config()
        config_dict = self._config_to_dict(config)

        # Apply updates recursively
        self._update_dict_recursive(config_dict, updates)

        # Validate updated configuration
        self._config = PerformanceConfigModel(**config_dict)
        return self._config

    def _load_from_file(self) -> PerformanceConfigModel:
        """Load configuration from YAML file."""
        with open(self.config_path, "r") as f:
            config_dict = yaml.safe_load(f)

        return PerformanceConfigModel(**config_dict)

    def _load_from_environment(self) -> PerformanceConfigModel:
        """Load configuration from environment variables."""
        config_dict = {}

        # Map environment variables to config paths
        env_mappings = {
            "SPECFORGE_PERF_PROFILE": "profile",
            "SPECFORGE_MAX_MEMORY_MB": "memory.max_memory_usage_mb",
            "SPECFORGE_MAX_BATCH_SIZE": "batching.max_batch_size",
            "SPECFORGE_ENABLE_CACHING": "cache.enable_result_caching",
            "SPECFORGE_ENABLE_STREAMING": "streaming.enable_streaming",
            "SPECFORGE_MAX_PARALLEL": "concurrency.max_parallel_operations",
            "SPECFORGE_DEBOUNCE_MS": "concurrency.debounce_delay_ms",
        }

        for env_var, config_path in env_mappings.items():
            value = os.getenv(env_var)
            if value is not None:
                # Parse value based on type
                if value.lower() in ("true", "false"):
                    value = value.lower() == "true"
                elif value.isdigit():
                    value = int(value)
                elif "." in value and value.replace(".", "").isdigit():
                    value = float(value)

                self._set_nested_value(config_dict, config_path, value)

        return PerformanceConfigModel(**config_dict)

    def _apply_profile(
        self, config: PerformanceConfigModel, profile: str
    ) -> PerformanceConfigModel:
        """Apply performance profile to configuration."""
        if profile not in self._profile_configs:
            raise ValueError(f"Unknown profile: {profile}")

        profile_config = self._profile_configs[profile]
        config_dict = self._config_to_dict(config)

        # Merge profile configuration
        self._update_dict_recursive(config_dict, profile_config)
        config_dict["profile"] = profile

        return PerformanceConfigModel(**config_dict)

    def _detect_profile(self) -> str:
        """Auto-detect appropriate performance profile."""
        # Check for development environment
        if (
            os.getenv("NODE_ENV") == "development"
            or os.getenv("SPECFORGE_DEV") == "true"
        ):
            return PerformanceProfile.DEVELOPMENT

        # Check for production environment
        if (
            os.getenv("NODE_ENV") == "production"
            or os.getenv("SPECFORGE_PROD") == "true"
        ):
            return PerformanceProfile.PRODUCTION

        # Check for performance mode
        if os.getenv("SPECFORGE_PERFORMANCE") == "true":
            return PerformanceProfile.PERFORMANCE

        # Check for minimal mode (resource-constrained environments)
        if os.getenv("SPECFORGE_MINIMAL") == "true":
            return PerformanceProfile.MINIMAL

        # Default to balanced
        return PerformanceProfile.BALANCED

    def _load_profile_configs(self) -> Dict[str, Dict[str, Any]]:
        """Load predefined performance profile configurations."""
        return {
            PerformanceProfile.MINIMAL: {
                "cache": {
                    "lru_cache_size": 100,
                    "result_cache_max_size": 50,
                    "enable_parse_caching": False,
                },
                "batching": {
                    "max_batch_size": 10,
                    "enable_smart_batching": False,
                    "enable_operation_deduplication": False,
                },
                "streaming": {
                    "enable_streaming": False,
                    "enable_compression": False,
                },
                "memory": {
                    "max_memory_usage_mb": 30,
                    "enable_memory_monitoring": True,
                    "max_queue_size": 1000,
                },
                "background": {
                    "enable_background_processing": False,
                    "enable_fs_optimization": False,
                },
                "concurrency": {
                    "max_parallel_operations": 1,
                    "enable_concurrent_processing": False,
                },
            },
            PerformanceProfile.BALANCED: {
                "cache": {
                    "lru_cache_size": 1000,
                    "result_cache_max_size": 500,
                    "enable_parse_caching": True,
                },
                "batching": {
                    "max_batch_size": 50,
                    "enable_smart_batching": True,
                    "enable_operation_deduplication": True,
                },
                "streaming": {
                    "enable_streaming": True,
                    "enable_compression": True,
                    "compression_level": 6,
                },
                "memory": {
                    "max_memory_usage_mb": 100,
                    "enable_memory_monitoring": True,
                    "max_queue_size": 10000,
                },
                "background": {
                    "enable_background_processing": True,
                    "background_cleanup_interval_seconds": 60,
                },
                "concurrency": {
                    "max_parallel_operations": 3,
                    "enable_concurrent_processing": True,
                },
            },
            PerformanceProfile.PERFORMANCE: {
                "cache": {
                    "lru_cache_size": 5000,
                    "result_cache_max_size": 2000,
                    "enable_parse_caching": True,
                },
                "batching": {
                    "max_batch_size": 100,
                    "enable_smart_batching": True,
                    "enable_operation_deduplication": True,
                },
                "streaming": {
                    "enable_streaming": True,
                    "enable_compression": True,
                    "compression_level": 3,  # Faster compression
                },
                "memory": {
                    "max_memory_usage_mb": 500,
                    "enable_memory_monitoring": True,
                    "max_queue_size": 50000,
                    "enable_aggressive_gc": False,
                },
                "background": {
                    "enable_background_processing": True,
                    "background_cleanup_interval_seconds": 30,
                },
                "concurrency": {
                    "max_parallel_operations": 10,
                    "enable_concurrent_processing": True,
                },
            },
            PerformanceProfile.DEVELOPMENT: {
                "cache": {
                    "lru_cache_size": 500,
                    "result_cache_max_size": 200,
                    "cache_ttl_seconds": 60,  # Shorter TTL for development
                },
                "batching": {
                    "max_batch_size": 20,
                    "batch_timeout_ms": 500,  # Faster processing
                },
                "memory": {
                    "max_memory_usage_mb": 200,
                    "enable_memory_monitoring": True,
                    "max_queue_size": 5000,
                },
                "background": {
                    "enable_background_processing": True,
                    "background_cleanup_interval_seconds": 120,
                },
                "concurrency": {"debounce_delay_ms": 100},  # Faster response in dev
                "enable_detailed_metrics": True,
            },
            PerformanceProfile.PRODUCTION: {
                "cache": {
                    "lru_cache_size": 2000,
                    "result_cache_max_size": 1000,
                    "enable_parse_caching": True,
                },
                "batching": {
                    "max_batch_size": 75,
                    "enable_smart_batching": True,
                    "enable_operation_deduplication": True,
                },
                "streaming": {
                    "enable_streaming": True,
                    "enable_compression": True,
                    "compression_level": 6,
                },
                "memory": {
                    "max_memory_usage_mb": 150,
                    "enable_memory_monitoring": True,
                    "max_queue_size": 20000,
                    "enable_aggressive_gc": True,
                },
                "background": {
                    "enable_background_processing": True,
                    "background_cleanup_interval_seconds": 45,
                    "enable_fs_optimization": True,
                },
                "concurrency": {
                    "max_parallel_operations": 5,
                    "enable_concurrent_processing": True,
                },
                "enable_detailed_metrics": False,  # Reduce overhead in production
            },
        }

    def _config_to_dict(self, config: PerformanceConfigModel) -> Dict[str, Any]:
        """Convert configuration to dictionary."""
        return {
            "profile": config.profile,
            "cache": {
                "lru_cache_size": config.cache.lru_cache_size,
                "lru_cache_ttl_seconds": config.cache.lru_cache_ttl_seconds,
                "enable_result_caching": config.cache.enable_result_caching,
                "result_cache_max_size": config.cache.result_cache_max_size,
                "result_cache_ttl_seconds": config.cache.result_cache_ttl_seconds,
                "enable_parse_caching": config.cache.enable_parse_caching,
                "parse_cache_ttl_seconds": config.cache.parse_cache_ttl_seconds,
                "auto_cleanup_expired": config.cache.auto_cleanup_expired,
                "cleanup_interval_seconds": config.cache.cleanup_interval_seconds,
            },
            "batching": {
                "enable_batching": config.batching.enable_batching,
                "max_batch_size": config.batching.max_batch_size,
                "batch_timeout_ms": config.batching.batch_timeout_ms,
                "enable_smart_batching": config.batching.enable_smart_batching,
                "enable_dependency_aware_batching": (
                    config.batching.enable_dependency_aware_batching
                ),
                "enable_type_based_batching": (
                    config.batching.enable_type_based_batching
                ),
                "enable_operation_deduplication": (
                    config.batching.enable_operation_deduplication
                ),
                "deduplication_window_seconds": (
                    config.batching.deduplication_window_seconds
                ),
            },
            "streaming": {
                "enable_streaming": config.streaming.enable_streaming,
                "streaming_threshold_bytes": (
                    config.streaming.streaming_threshold_bytes
                ),
                "chunk_size_bytes": config.streaming.chunk_size_bytes,
                "enable_incremental_parsing": (
                    config.streaming.enable_incremental_parsing
                ),
                "incremental_threshold_bytes": (
                    config.streaming.incremental_threshold_bytes
                ),
                "enable_compression": config.streaming.enable_compression,
                "compression_threshold_operations": (
                    config.streaming.compression_threshold_operations
                ),
                "compression_level": config.streaming.compression_level,
            },
            "memory": {
                "max_memory_usage_mb": config.memory.max_memory_usage_mb,
                "enable_memory_monitoring": config.memory.enable_memory_monitoring,
                "memory_warning_threshold_mb": (
                    config.memory.memory_warning_threshold_mb
                ),
                "enable_aggressive_gc": config.memory.enable_aggressive_gc,
                "gc_threshold_mb": config.memory.gc_threshold_mb,
                "max_queue_size": config.memory.max_queue_size,
                "queue_compaction_threshold": config.memory.queue_compaction_threshold,
                "auto_queue_compaction": config.memory.auto_queue_compaction,
            },
            "background": {
                "enable_background_processing": (
                    config.background.enable_background_processing
                ),
                "background_cleanup_interval_seconds": (
                    config.background.background_cleanup_interval_seconds
                ),
                "background_optimization_interval_seconds": (
                    config.background.background_optimization_interval_seconds
                ),
                "enable_fs_optimization": config.background.enable_fs_optimization,
                "cleanup_temp_files": config.background.cleanup_temp_files,
                "temp_file_max_age_hours": config.background.temp_file_max_age_hours,
                "max_backup_files": config.background.max_backup_files,
            },
            "concurrency": {
                "max_parallel_operations": config.concurrency.max_parallel_operations,
                "enable_concurrent_processing": (
                    config.concurrency.enable_concurrent_processing
                ),
                "enable_file_watcher_debouncing": (
                    config.concurrency.enable_file_watcher_debouncing
                ),
                "debounce_delay_ms": config.concurrency.debounce_delay_ms,
                "enable_batch_parallel_processing": (
                    config.concurrency.enable_batch_parallel_processing
                ),
                "parallel_batch_size": config.concurrency.parallel_batch_size,
            },
            "enable_performance_monitoring": config.enable_performance_monitoring,
            "enable_detailed_metrics": config.enable_detailed_metrics,
            "metrics_collection_interval_seconds": (
                config.metrics_collection_interval_seconds
            ),
        }

    def _update_dict_recursive(
        self, target: Dict[str, Any], updates: Dict[str, Any]
    ) -> None:
        """Update dictionary recursively."""
        for key, value in updates.items():
            if (
                isinstance(value, dict)
                and key in target
                and isinstance(target[key], dict)
            ):
                self._update_dict_recursive(target[key], value)
            else:
                target[key] = value

    def _set_nested_value(self, target: Dict[str, Any], path: str, value: Any) -> None:
        """Set nested dictionary value using dot notation."""
        keys = path.split(".")
        current = target

        # Navigate to the parent of the target key
        for key in keys[:-1]:
            if key not in current:
                current[key] = {}
            current = current[key]

        # Set the final value
        current[keys[-1]] = value


# Global configuration instance
_config_manager: Optional[PerformanceConfigManager] = None


def get_performance_config(
    config_path: Optional[Path] = None, profile: Optional[str] = None
) -> PerformanceConfigModel:
    """Get global performance configuration."""
    global _config_manager

    if _config_manager is None:
        _config_manager = PerformanceConfigManager(config_path)

    return _config_manager.load_config(profile)


def update_performance_config(
    updates: Dict[str, Any],
) -> PerformanceConfigModel:
    """Update global performance configuration."""
    global _config_manager

    if _config_manager is None:
        _config_manager = PerformanceConfigManager()

    return _config_manager.update_config(updates)


def reset_performance_config() -> None:
    """Reset global performance configuration."""
    global _config_manager
    _config_manager = None
