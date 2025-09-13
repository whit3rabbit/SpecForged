"""
Configuration management for SpecForged MCP Server.

Supports multiple configuration sources with proper precedence:
1. Environment variables (highest priority)
2. Project-level .specforged.yaml
3. User-level ~/.specforged/config.yaml
4. Default values (lowest priority)
"""

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional

import yaml


@dataclass
class ServerConfig:
    """Server configuration options"""

    # Core server settings
    name: str = "SpecForge"
    port: int = 8000
    host: str = "127.0.0.1"
    log_level: str = "INFO"

    # Project and specifications
    project_root: Optional[str] = None
    base_dir: str = ".specifications"

    # Queue processing
    queue_processing_enabled: bool = True
    queue_processing_interval: int = 5000  # milliseconds
    heartbeat_interval: int = 30000  # milliseconds
    cleanup_interval: int = 3600000  # milliseconds

    # Security settings
    security_audit_enabled: bool = True
    rate_limiting_enabled: bool = True
    max_requests_per_minute: int = 100

    # HTTP server specific
    cors_enabled: bool = True
    cors_origins: list = field(default_factory=lambda: ["*"])

    # Development options
    debug_mode: bool = False
    auto_reload: bool = False

    # MCP settings
    mcp_protocol_version: str = "2024-11-05"
    client_timeout: int = 30000  # milliseconds


class ConfigurationLoader:
    """Loads configuration from multiple sources with proper precedence"""

    def __init__(self, project_root: Optional[Path] = None):
        self.project_root = project_root or self._detect_project_root()
        self.user_config_dir = Path.home() / ".specforged"

    def _detect_project_root(self) -> Path:
        """Detect project root by looking for common markers"""
        current = Path.cwd()

        # Common project markers
        markers = [
            ".git",
            ".hg",
            ".svn",  # VCS
            "package.json",
            "pyproject.toml",
            "Cargo.toml",  # Package managers
            ".specforged.yaml",
            ".specforged.yml",  # Our config
            "requirements.txt",
            "setup.py",
            "setup.cfg",  # Python
        ]

        # Walk up the directory tree
        for parent in [current] + list(current.parents):
            for marker in markers:
                if (parent / marker).exists():
                    return parent

        # Fallback to current directory
        return current

    def load_config(self) -> ServerConfig:
        """Load configuration from all sources with proper precedence"""
        # Start with defaults
        config_dict = {}

        # 1. Load user-level configuration
        user_config = self._load_user_config()
        if user_config:
            config_dict.update(user_config)

        # 2. Load project-level configuration
        project_config = self._load_project_config()
        if project_config:
            config_dict.update(project_config)

        # 3. Override with environment variables
        env_config = self._load_env_config()
        config_dict.update(env_config)

        # Create config object
        config = ServerConfig(**config_dict)

        # Set project root if not specified
        if not config.project_root:
            config.project_root = str(self.project_root)

        return config

    def _load_user_config(self) -> Optional[Dict[str, Any]]:
        """Load user-level configuration from ~/.specforged/config.yaml"""
        config_file = self.user_config_dir / "config.yaml"

        if not config_file.exists():
            # Try alternative names
            for alt_name in [
                "config.yml",
                "specforged.yaml",
                "specforged.yml",
            ]:
                alt_file = self.user_config_dir / alt_name
                if alt_file.exists():
                    config_file = alt_file
                    break
            else:
                return None

        try:
            with open(config_file, "r", encoding="utf-8") as f:
                return yaml.safe_load(f) or {}
        except (yaml.YAMLError, IOError) as e:
            print(f"Warning: Failed to load user config from {config_file}: {e}")
            return None

    def _load_project_config(self) -> Optional[Dict[str, Any]]:
        """Load project-level configuration from .specforged.yaml"""
        # Try different config file names
        config_names = [
            ".specforged.yaml",
            ".specforged.yml",
            "specforged.yaml",
            "specforged.yml",
        ]

        for config_name in config_names:
            config_file = self.project_root / config_name
            if config_file.exists():
                try:
                    with open(config_file, "r", encoding="utf-8") as f:
                        return yaml.safe_load(f) or {}
                except (yaml.YAMLError, IOError) as e:
                    print(
                        f"Warning: Failed to load project config from {config_file}: {e}"
                    )
                    continue

        return None

    def _load_env_config(self) -> Dict[str, Any]:
        """Load configuration from environment variables"""
        env_config = {}

        # Environment variable mappings
        env_mappings = {
            "SPECFORGED_NAME": "name",
            "SPECFORGED_PORT": ("port", int),
            "SPECFORGED_HOST": "host",
            "SPECFORGED_LOG_LEVEL": "log_level",
            "SPECFORGE_PROJECT_ROOT": "project_root",
            "SPECFORGE_BASE_DIR": "base_dir",
            "SPECFORGED_DEBUG": ("debug_mode", bool),
            "SPECFORGED_AUTO_RELOAD": ("auto_reload", bool),
            "SPECFORGED_CORS_ENABLED": ("cors_enabled", bool),
            "SPECFORGED_SECURITY_AUDIT": ("security_audit_enabled", bool),
            "SPECFORGED_RATE_LIMITING": ("rate_limiting_enabled", bool),
            "SPECFORGED_MAX_REQUESTS": ("max_requests_per_minute", int),
        }

        for env_var, config_key in env_mappings.items():
            env_value = os.environ.get(env_var)
            if env_value is not None:
                if isinstance(config_key, tuple):
                    key, converter = config_key
                    try:
                        if converter == bool:
                            env_config[key] = env_value.lower() in (
                                "true",
                                "1",
                                "yes",
                                "on",
                            )
                        else:
                            env_config[key] = converter(env_value)
                    except (ValueError, TypeError) as e:
                        print(
                            f"Warning: Invalid value for {env_var}: {env_value} ({e})"
                        )
                else:
                    env_config[config_key] = env_value

        return env_config

    def save_user_config(self, config: Dict[str, Any]) -> bool:
        """Save configuration to user config file"""
        try:
            # Ensure config directory exists
            self.user_config_dir.mkdir(parents=True, exist_ok=True)

            config_file = self.user_config_dir / "config.yaml"

            with open(config_file, "w", encoding="utf-8") as f:
                yaml.dump(config, f, default_flow_style=False, sort_keys=True)

            return True

        except (yaml.YAMLError, IOError) as e:
            print(f"Error: Failed to save user config: {e}")
            return False

    def save_project_config(self, config: Dict[str, Any]) -> bool:
        """Save configuration to project config file"""
        try:
            config_file = self.project_root / ".specforged.yaml"

            with open(config_file, "w", encoding="utf-8") as f:
                yaml.dump(config, f, default_flow_style=False, sort_keys=True)

            return True

        except (yaml.YAMLError, IOError) as e:
            print(f"Error: Failed to save project config: {e}")
            return False

    def create_default_user_config(self) -> bool:
        """Create a default user configuration file"""
        default_config = {
            "# SpecForged User Configuration": None,
            "# This file contains your personal SpecForged settings": None,
            "": None,
            "# Server settings": None,
            "log_level": "INFO",
            "debug_mode": False,
            "": None,
            "# Default project settings": None,
            "base_dir": ".specifications",
            "": None,
            "# Security settings": None,
            "security_audit_enabled": True,
            "rate_limiting_enabled": True,
            "max_requests_per_minute": 100,
            "": None,
            "# HTTP server settings": None,
            "cors_enabled": True,
            "cors_origins": ["*"],
        }

        # Clean up the config (remove comment entries)
        clean_config = {
            k: v
            for k, v in default_config.items()
            if v is not None and not k.startswith("#")
        }

        return self.save_user_config(clean_config)


def load_configuration(project_root: Optional[Path] = None) -> ServerConfig:
    """
    Load SpecForged configuration from all sources.

    Args:
        project_root: Optional project root directory. If not specified, will be auto-detected.

    Returns:
        ServerConfig: Complete configuration object
    """
    loader = ConfigurationLoader(project_root)
    return loader.load_config()


def get_config_paths(project_root: Optional[Path] = None) -> Dict[str, Path]:
    """
    Get paths to configuration files.

    Returns:
        Dict mapping config type to file path
    """
    loader = ConfigurationLoader(project_root)

    return {
        "user": loader.user_config_dir / "config.yaml",
        "project": loader.project_root / ".specforged.yaml",
        "project_root": loader.project_root,
    }
