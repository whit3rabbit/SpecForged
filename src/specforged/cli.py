#!/usr/bin/env python3
"""
SpecForge CLI Entry Points

Provides command-line interfaces for running SpecForge MCP server variants.
"""

import argparse
import sys
from pathlib import Path
from typing import Any

from . import __version__
from .server import create_server, run_server
from .server_config import ConfigurationLoader, get_config_paths, load_configuration


def specforge_mcp() -> None:
    """Main entry point for SpecForge MCP server (for pipx)"""
    parser = argparse.ArgumentParser(description="SpecForge MCP Server")
    parser.add_argument(
        "--version", action="version", version=f"SpecForge {__version__}"
    )
    parser.add_argument(
        "--base-dir",
        type=str,
        default=None,
        help="Directory to store specifications (e.g., . or ./specifications)",
    )
    args = parser.parse_args()

    print("Starting SpecForge MCP Server...")
    print("Mode Classification: Enabled")
    print("Spec Management: Ready")
    print("Workflow Phases: Requirements → Design → Planning → Execution")

    try:
        # If a base directory is explicitly provided, use it;
        # otherwise, rely on server defaults/env
        if args.base_dir:
            from pathlib import Path

            server = create_server(base_dir=Path(args.base_dir).expanduser().resolve())
            server.run()
        else:
            run_server()
    except KeyboardInterrupt:
        print("\nSpecForge MCP Server stopped.")
        sys.exit(0)


def specforge_http() -> None:
    """Entry point for SpecForge HTTP server (for pipx)"""
    import uvicorn
    from starlette.applications import Starlette
    from starlette.middleware.cors import CORSMiddleware
    from starlette.responses import JSONResponse
    from starlette.routing import Mount, Route

    print("Starting SpecForge HTTP Server...")
    print("Mode Classification: Enabled")
    print("Spec Management: Ready")
    print("HTTP API: Available")

    # Create MCP server
    mcp_server = create_server("SpecForge-HTTP")

    # Create HTTP routes
    async def health_check(request) -> JSONResponse:
        return JSONResponse({"status": "healthy", "service": "SpecForge"})

    # Create Starlette app
    app = Starlette(
        routes=[
            Route("/health", health_check),
            Mount("/mcp", mcp_server.streamable_http_app()),
        ]
    )

    # Add CORS middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Get port from environment or default
    import os

    port = int(os.getenv("PORT", 8000))

    print(f"Server starting on port {port}")
    print("Health check available at /health")
    print("MCP endpoints available at /mcp/*")

    try:
        uvicorn.run(app, host="0.0.0.0", port=port)
    except KeyboardInterrupt:
        print("\nSpecForge HTTP Server stopped.")
        sys.exit(0)


def specforge_new(args: Any) -> None:
    """Entry point for SpecForge project wizard (for pipx)"""
    from pathlib import Path

    from .templates import TemplateManager
    from .wizard import run_wizard

    print("🚀 SpecForge Project Wizard")
    print("Creating new specification with guided setup...")

    base_dir = args.base_dir if hasattr(args, "base_dir") else "specifications"
    template = args.template if hasattr(args, "template") else None

    if template:
        # Check if template exists
        template_manager = TemplateManager()
        available = template_manager.get_available_templates()
        if template not in available:
            print(f"❌ Template '{template}' not found.")
            print(f"Available templates: {', '.join(available.keys())}")
            sys.exit(1)
        print(f"📋 Using template: {available[template]['name']}")

    try:
        spec_id = run_wizard(base_dir)
        if spec_id:
            print(f"\n🎉 Project specification '{spec_id}' created successfully!")
            print(f"📁 Location: {Path(base_dir).resolve() / spec_id}")
            print("\nNext steps:")
            print("  1. Review generated files")
            print("  2. Start implementing tasks")
            print(
                f"  3. Use 'specforged mcp --base-dir {base_dir}' " f"to access via MCP"
            )
        else:
            print("❌ Project creation cancelled or failed.")
            sys.exit(1)
    except KeyboardInterrupt:
        print("\n❌ Wizard cancelled by user.")
        sys.exit(0)
    except (ImportError, ModuleNotFoundError, OSError, ValueError) as e:
        print(f"❌ Error creating project: {e}")
        sys.exit(1)


def specforge_init(args: Any) -> None:
    """Initialize SpecForged in the current directory"""
    import yaml
    from rich.console import Console
    from rich.prompt import Confirm, Prompt

    console = Console()

    console.print("🚀 [bold blue]SpecForged Initialization[/bold blue]")
    console.print("Setting up SpecForged for standalone usage...")

    # Check if already initialized
    config_paths = get_config_paths()
    project_config = config_paths["project"]

    if project_config.exists() and not args.force:
        console.print(
            f"❌ Project already has SpecForged configuration: {project_config}"
        )
        console.print("Use --force to overwrite existing configuration")
        return

    # Get project information
    project_name = Prompt.ask("Project name", default=Path.cwd().name)
    base_dir = Prompt.ask("Specifications directory", default=".specifications")

    # Create project configuration
    project_config_data = {
        "# SpecForged Project Configuration": None,
        "name": project_name,
        "base_dir": base_dir,
        "debug_mode": False,
        "queue_processing_enabled": True,
        "security_audit_enabled": True,
        "rate_limiting_enabled": True,
    }

    # Clean up config (remove comments)
    clean_config = {
        k: v
        for k, v in project_config_data.items()
        if v is not None and not k.startswith("#")
    }

    try:
        # Create config file
        with open(project_config, "w", encoding="utf-8") as f:
            yaml.dump(clean_config, f, default_flow_style=False, sort_keys=True)

        console.print(f"✅ Project configuration created: {project_config}")

        # Create specifications directory
        specs_dir = Path(base_dir)
        specs_dir.mkdir(exist_ok=True)
        console.print(f"✅ Specifications directory created: {specs_dir}")

        # Optionally create user configuration
        user_config_path = config_paths["user"]
        if not user_config_path.exists():
            if Confirm.ask("Create user configuration file?", default=True):
                loader = ConfigurationLoader()
                if loader.create_default_user_config():
                    console.print(f"✅ User configuration created: {user_config_path}")
                else:
                    console.print("❌ Failed to create user configuration")

        console.print(
            "\n🎉 [bold green]SpecForged initialization complete![/bold green]"
        )
        console.print("\nNext steps:")
        console.print("  • Run 'specforged serve' to start the MCP server")
        console.print("  • Run 'specforged status' to check server health")
        console.print("  • Edit .specforged.yaml to customize settings")

    except Exception as e:
        console.print(f"❌ Initialization failed: {e}")
        sys.exit(1)


def specforge_status(args: Any) -> None:
    """Check SpecForged server and project status"""

    from rich.console import Console
    from rich.table import Table

    console = Console()

    console.print("🔍 [bold blue]SpecForged Status[/bold blue]")

    # Load configuration
    try:
        config = load_configuration()
        console.print("✅ Configuration loaded from multiple sources")
    except Exception as e:
        console.print(f"❌ Configuration error: {e}")
        return

    # Check project status
    config_paths = get_config_paths()

    # Create status table
    table = Table(title="Project Status")
    table.add_column("Component", style="cyan")
    table.add_column("Status", style="bold")
    table.add_column("Location", style="dim")

    # Check configuration files
    if config_paths["project"].exists():
        table.add_row("Project Config", "✅ Found", str(config_paths["project"]))
    else:
        table.add_row("Project Config", "❌ Missing", str(config_paths["project"]))

    if config_paths["user"].exists():
        table.add_row("User Config", "✅ Found", str(config_paths["user"]))
    else:
        table.add_row("User Config", "⚠️ Not Found", str(config_paths["user"]))

    # Check specifications directory
    specs_dir = Path(config.base_dir)
    if specs_dir.exists():
        spec_count = len(list(specs_dir.glob("*/spec.json")))
        table.add_row("Specifications", f"✅ {spec_count} specs", str(specs_dir))
    else:
        table.add_row("Specifications", "❌ Directory missing", str(specs_dir))

    # Check project root
    project_root = Path(config.project_root or ".")
    table.add_row("Project Root", "📁 Detected", str(project_root))

    console.print(table)

    # Try to get server health if running
    if hasattr(args, "check_server") and args.check_server:
        console.print("\n🏥 [bold blue]Server Health Check[/bold blue]")
        try:
            # This would require running server health check
            # For now, just show configuration
            console.print("ℹ️ Server health check requires running server")
        except Exception as e:
            console.print(f"❌ Server health check failed: {e}")


def specforge_config(args: Any) -> None:
    """Manage SpecForged configuration"""
    import yaml
    from rich.console import Console
    from rich.table import Table

    console = Console()

    if args.action == "show":
        # Show current configuration
        try:
            config = load_configuration()
            config_paths = get_config_paths()

            console.print("📋 [bold blue]Current Configuration[/bold blue]")

            # Show configuration sources
            table = Table(title="Configuration Sources")
            table.add_column("Source", style="cyan")
            table.add_column("File", style="dim")
            table.add_column("Exists", style="bold")

            table.add_row(
                "User",
                str(config_paths["user"]),
                "✅" if config_paths["user"].exists() else "❌",
            )
            table.add_row(
                "Project",
                str(config_paths["project"]),
                "✅" if config_paths["project"].exists() else "❌",
            )
            table.add_row("Environment", "ENV variables", "✅ Active")

            console.print(table)

            # Show active configuration
            console.print("\n🔧 [bold blue]Active Settings[/bold blue]")
            settings_table = Table()
            settings_table.add_column("Setting", style="cyan")
            settings_table.add_column("Value", style="bold")

            settings_table.add_row("Name", config.name)
            settings_table.add_row(
                "Project Root", config.project_root or "Auto-detected"
            )
            settings_table.add_row("Base Directory", config.base_dir)
            settings_table.add_row("Debug Mode", "✅" if config.debug_mode else "❌")
            settings_table.add_row(
                "Security Audit",
                "✅" if config.security_audit_enabled else "❌",
            )
            settings_table.add_row(
                "Rate Limiting", "✅" if config.rate_limiting_enabled else "❌"
            )

            console.print(settings_table)

        except Exception as e:
            console.print(f"❌ Failed to load configuration: {e}")

    elif args.action == "edit":
        # Open configuration file for editing
        config_paths = get_config_paths()

        if args.user:
            config_file = config_paths["user"]
            config_type = "user"
        else:
            config_file = config_paths["project"]
            config_type = "project"

        console.print(f"📝 Opening {config_type} configuration: {config_file}")

        # Create file if it doesn't exist
        if not config_file.exists():
            if config_type == "user":
                loader = ConfigurationLoader()
                loader.create_default_user_config()
            else:
                config_file.parent.mkdir(parents=True, exist_ok=True)
                default_project_config = {
                    "name": "SpecForged",
                    "base_dir": ".specifications",
                    "debug_mode": False,
                }
                with open(config_file, "w") as f:
                    yaml.dump(default_project_config, f, default_flow_style=False)

        # Try to open with editor
        import os

        editor = os.environ.get("EDITOR", "nano")
        os.system(f'{editor} "{config_file}"')


def specforge_serve() -> None:
    """Start SpecForged MCP server (alias for specforged command)"""
    print("🚀 Starting SpecForged MCP Server...")

    try:
        # Load configuration
        config = load_configuration()

        print(f"Configuration loaded - Project: {config.name}")
        print(f"Base directory: {config.base_dir}")
        print(f"Debug mode: {'enabled' if config.debug_mode else 'disabled'}")

        # Create and run server with configuration
        server = create_server(config=config)
        server.run()

    except KeyboardInterrupt:
        print("\n✋ SpecForged MCP Server stopped.")
        sys.exit(0)
    except Exception as e:
        print(f"❌ Server startup failed: {e}")
        sys.exit(1)


def main() -> None:
    """Main CLI with subcommands"""
    parser = argparse.ArgumentParser(
        description="SpecForge - Specification-driven development with MCP"
    )
    parser.add_argument(
        "--version", action="version", version=f"SpecForge {__version__}"
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # Initialize project command
    init_parser = subparsers.add_parser(
        "init", help="Initialize SpecForged in current directory"
    )
    init_parser.add_argument(
        "--force", action="store_true", help="Overwrite existing configuration"
    )

    # Serve command (alias for MCP server)
    subparsers.add_parser("serve", help="Start SpecForged MCP server")

    # Status command
    status_parser = subparsers.add_parser(
        "status", help="Check SpecForged project status"
    )
    status_parser.add_argument(
        "--server", action="store_true", help="Check running server health"
    )

    # Config management command
    config_parser = subparsers.add_parser(
        "config", help="Manage SpecForged configuration"
    )
    config_subparsers = config_parser.add_subparsers(
        dest="action", help="Config actions"
    )

    config_subparsers.add_parser("show", help="Show current configuration")
    config_edit = config_subparsers.add_parser("edit", help="Edit configuration file")
    config_edit.add_argument(
        "--user",
        action="store_true",
        help="Edit user config instead of project config",
    )

    # MCP server command
    subparsers.add_parser("mcp", help="Run MCP server (legacy)")

    # HTTP server command
    http_parser = subparsers.add_parser("http", help="Run HTTP server")
    http_parser.add_argument("--port", type=int, default=8000, help="Port to run on")

    # New project wizard command
    new_parser = subparsers.add_parser(
        "new", help="Create new project specification via interactive wizard"
    )
    new_parser.add_argument(
        "--base-dir",
        type=str,
        default="specifications",
        help="Directory to store specifications",
    )
    new_parser.add_argument(
        "--template",
        type=str,
        choices=[
            "web-app",
            "rest-api",
            "cli-tool",
            "python-lib",
            "microservice",
        ],
        help="Use a predefined project template",
    )

    args = parser.parse_args()

    if args.command == "init":
        specforge_init(args)
    elif args.command == "serve":
        specforge_serve()
    elif args.command == "status":
        specforge_status(args)
    elif args.command == "config":
        if args.action:
            specforge_config(args)
        else:
            # Default to showing config
            args.action = "show"
            specforge_config(args)
    elif args.command == "mcp":
        specforge_mcp()
    elif args.command == "http":
        if hasattr(args, "port"):
            import os

            os.environ["PORT"] = str(args.port)
        specforge_http()
    elif args.command == "new":
        specforge_new(args)
    else:
        # Default to serve command (most common usage)
        specforge_serve()


if __name__ == "__main__":
    main()
