#!/usr/bin/env python3
"""
SpecForge Performance CLI Tool

A command-line interface for monitoring, benchmarking, and optimizing
the performance of the SpecForge MCP ecosystem.
"""

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

import click
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.table import Table
from rich.panel import Panel
from rich.text import Text

from specforged.config.performance import (
    PerformanceConfigManager,
    PerformanceProfile,
    get_performance_config,
)

# Try to import test modules (they may not be available in production)
try:
    from tests.test_performance_benchmarks import PerformanceBenchmarks

    BENCHMARKS_AVAILABLE = True
except ImportError:
    BENCHMARKS_AVAILABLE = False

console = Console()


@click.group()
@click.version_option()
def cli():
    """SpecForge Performance CLI - Monitor and optimize MCP ecosystem performance."""
    pass


@cli.command()
@click.option(
    "--profile",
    type=click.Choice(
        [
            PerformanceProfile.MINIMAL,
            PerformanceProfile.BALANCED,
            PerformanceProfile.PERFORMANCE,
            PerformanceProfile.DEVELOPMENT,
            PerformanceProfile.PRODUCTION,
        ]
    ),
    help="Performance profile to show",
)
@click.option("--config-path", type=click.Path(), help="Path to configuration file")
def config(profile: Optional[str], config_path: Optional[str]):
    """Show current performance configuration."""
    try:
        config_mgr = PerformanceConfigManager(
            Path(config_path) if config_path else None
        )
        perf_config = config_mgr.load_config(profile)

        console.print(
            Panel.fit(
                f"[bold green]SpecForge Performance Configuration[/bold green]\n"
                f"Profile: [bold cyan]{perf_config.profile}[/bold cyan]",
                border_style="green",
            )
        )

        # Cache Configuration
        table = Table(title="Cache Configuration", show_header=True)
        table.add_column("Setting", style="cyan", no_wrap=True)
        table.add_column("Value", style="magenta")

        table.add_row("LRU Cache Size", str(perf_config.cache.lru_cache_size))
        table.add_row(
            "Result Caching",
            "✅ Enabled" if perf_config.cache.enable_result_caching else "❌ Disabled",
        )
        table.add_row("Result Cache Size", str(perf_config.cache.result_cache_max_size))
        table.add_row(
            "Cache TTL (seconds)", str(perf_config.cache.result_cache_ttl_seconds)
        )
        console.print(table)

        # Batching Configuration
        table = Table(title="Batching Configuration", show_header=True)
        table.add_column("Setting", style="cyan", no_wrap=True)
        table.add_column("Value", style="magenta")

        table.add_row(
            "Batching Enabled",
            "✅ Enabled" if perf_config.batching.enable_batching else "❌ Disabled",
        )
        table.add_row("Max Batch Size", str(perf_config.batching.max_batch_size))
        table.add_row(
            "Smart Batching",
            (
                "✅ Enabled"
                if perf_config.batching.enable_smart_batching
                else "❌ Disabled"
            ),
        )
        table.add_row(
            "Operation Deduplication",
            (
                "✅ Enabled"
                if perf_config.batching.enable_operation_deduplication
                else "❌ Disabled"
            ),
        )
        console.print(table)

        # Memory Configuration
        table = Table(title="Memory Configuration", show_header=True)
        table.add_column("Setting", style="cyan", no_wrap=True)
        table.add_column("Value", style="magenta")

        table.add_row("Max Memory (MB)", str(perf_config.memory.max_memory_usage_mb))
        table.add_row(
            "Memory Monitoring",
            (
                "✅ Enabled"
                if perf_config.memory.enable_memory_monitoring
                else "❌ Disabled"
            ),
        )
        table.add_row("Max Queue Size", str(perf_config.memory.max_queue_size))
        table.add_row(
            "Auto Compaction",
            "✅ Enabled" if perf_config.memory.auto_queue_compaction else "❌ Disabled",
        )
        console.print(table)

    except Exception as e:
        console.print(f"[bold red]Error loading configuration: {e}[/bold red]")
        sys.exit(1)


@cli.command()
@click.option(
    "--profile",
    type=click.Choice(
        [
            PerformanceProfile.MINIMAL,
            PerformanceProfile.BALANCED,
            PerformanceProfile.PERFORMANCE,
            PerformanceProfile.DEVELOPMENT,
            PerformanceProfile.PRODUCTION,
        ]
    ),
    required=True,
    help="Performance profile to set",
)
@click.option(
    "--config-path", type=click.Path(), help="Path to save configuration file"
)
@click.option("--force", is_flag=True, help="Force overwrite existing configuration")
def set_profile(profile: str, config_path: Optional[str], force: bool):
    """Set performance profile."""
    try:
        save_path = (
            Path(config_path) if config_path else Path("specforge-performance.yml")
        )

        if save_path.exists() and not force:
            if not click.confirm(f"Configuration file {save_path} exists. Overwrite?"):
                console.print("[yellow]Operation cancelled.[/yellow]")
                return

        config_mgr = PerformanceConfigManager(save_path)
        perf_config = config_mgr.load_config(profile)
        config_mgr.save_config(perf_config, save_path)

        console.print(
            f"[bold green]✅ Performance profile set to '{profile}'[/bold green]"
        )
        console.print(f"[dim]Configuration saved to: {save_path}[/dim]")

    except Exception as e:
        console.print(f"[bold red]Error setting profile: {e}[/bold red]")
        sys.exit(1)


@cli.command()
@click.option(
    "--setting",
    required=True,
    help="Configuration setting to update (e.g., cache.lru_cache_size)",
)
@click.option("--value", required=True, help="New value for the setting")
@click.option("--config-path", type=click.Path(), help="Path to configuration file")
def update(setting: str, value: str, config_path: Optional[str]):
    """Update a specific configuration setting."""
    try:
        config_mgr = PerformanceConfigManager(
            Path(config_path) if config_path else None
        )

        # Parse value based on type
        if value.lower() in ("true", "false"):
            parsed_value = value.lower() == "true"
        elif value.isdigit():
            parsed_value = int(value)
        elif "." in value and value.replace(".", "").isdigit():
            parsed_value = float(value)
        else:
            parsed_value = value

        # Create update dictionary
        updates = {}
        keys = setting.split(".")
        current = updates

        for key in keys[:-1]:
            current[key] = {}
            current = current[key]
        current[keys[-1]] = parsed_value

        config_mgr.update_config(updates)

        console.print(f"[bold green]✅ Updated {setting} = {value}[/bold green]")

    except Exception as e:
        console.print(f"[bold red]Error updating configuration: {e}[/bold red]")
        sys.exit(1)


@cli.command()
@click.option("--output", type=click.Path(), help="Save results to file")
@click.option(
    "--format",
    type=click.Choice(["table", "json"]),
    default="table",
    help="Output format",
)
def benchmark(output: Optional[str], format: str):
    """Run performance benchmarks."""
    if not BENCHMARKS_AVAILABLE:
        console.print("[bold red]❌ Performance benchmarks not available.[/bold red]")
        console.print("[dim]Install with: pip install -e .[dev][/dim]")
        sys.exit(1)

    async def run_benchmarks():
        benchmarks = PerformanceBenchmarks()

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            task = progress.add_task("Running benchmarks...", total=None)
            results = await benchmarks.run_all_benchmarks()
            progress.complete_task(task)

        if format == "json":
            results_json = json.dumps(results, indent=2, default=str)
            if output:
                Path(output).write_text(results_json)
                console.print(f"[green]Results saved to {output}[/green]")
            else:
                console.print(results_json)
        else:
            display_benchmark_results(results)
            if output:
                # Save as JSON even when displaying as table
                results_json = json.dumps(results, indent=2, default=str)
                Path(output).write_text(results_json)
                console.print(f"[dim]Results also saved to {output}[/dim]")

    try:
        asyncio.run(run_benchmarks())
    except Exception as e:
        console.print(f"[bold red]Benchmark failed: {e}[/bold red]")
        sys.exit(1)


def display_benchmark_results(results: Dict[str, Any]):
    """Display benchmark results in a nice table format."""
    # Overall status
    passed_count = sum(
        1 for result in results.values() if result.get("status", "").startswith("✅")
    )
    total_count = len(results)

    # Status panel
    status_color = (
        "green"
        if passed_count == total_count
        else "yellow" if passed_count > 0 else "red"
    )
    console.print(
        Panel(
            f"[bold {status_color}]{passed_count}/{total_count} benchmarks passed[/bold {status_color}]",
            title="Benchmark Results",
            border_style=status_color,
        )
    )

    # Results table
    table = Table(title="Performance Benchmark Details", show_header=True)
    table.add_column("Benchmark", style="cyan", no_wrap=True)
    table.add_column("Status", justify="center")
    table.add_column("Key Metric", style="magenta")
    table.add_column("Value", style="green", justify="right")

    for name, result in results.items():
        status = result.get("status", "❓ UNKNOWN")

        # Find the most relevant metric to display
        key_metric = None
        key_value = None

        metric_priorities = [
            "throughput_ops_per_sec",
            "hit_rate",
            "average_throughput_mb_per_sec",
            "speedup_ratio",
            "memory_increase_mb",
            "optimization_time_ms",
        ]

        for metric in metric_priorities:
            if metric in result:
                key_metric = metric.replace("_", " ").title()
                value = result[metric]
                if isinstance(value, float):
                    key_value = f"{value:.2f}"
                else:
                    key_value = str(value)
                break

        if not key_metric:
            key_metric = "Operations"
            key_value = str(result.get("operation_count", "N/A"))

        table.add_row(name, status, key_metric, key_value)

    console.print(table)

    # Performance targets
    console.print("\n[bold cyan]Performance Targets:[/bold cyan]")
    targets = [
        (
            "Cache hit rate",
            "> 40%",
            results.get("LRU Cache Performance", {}).get("hit_rate", 0) > 0.4,
        ),
        (
            "Queue throughput",
            "≥ 50 ops/sec",
            results.get("Queue Processing Throughput", {}).get(
                "throughput_ops_per_sec", 0
            )
            >= 50,
        ),
        (
            "Memory usage",
            "< 100MB",
            results.get("Memory Usage Under Load", {}).get("peak_memory_mb", 200) < 100,
        ),
        (
            "JSON parsing",
            "> 5MB/sec",
            results.get("Streaming JSON Parser", {}).get(
                "average_throughput_mb_per_sec", 0
            )
            > 5,
        ),
    ]

    for target, requirement, met in targets:
        status = "✅" if met else "❌"
        console.print(f"  {status} {target}: {requirement}")


@cli.command()
@click.option(
    "--project-root", type=click.Path(exists=True), help="Project root directory"
)
@click.option("--watch", is_flag=True, help="Monitor performance continuously")
@click.option("--interval", default=30, help="Monitoring interval in seconds")
def monitor(project_root: Optional[str], watch: bool, interval: int):
    """Monitor performance metrics."""
    # This would integrate with the actual queue processor if available
    console.print(
        "[yellow]⚠️  Performance monitoring requires a running MCP server.[/yellow]"
    )

    if project_root:
        project_path = Path(project_root)

        # Check for MCP files
        files_to_check = [
            "mcp-operations.json",
            "specforge-sync.json",
            "mcp-results.json",
        ]

        table = Table(title="MCP File Status", show_header=True)
        table.add_column("File", style="cyan")
        table.add_column("Status", justify="center")
        table.add_column("Size", style="magenta", justify="right")
        table.add_column("Modified", style="green")

        for filename in files_to_check:
            file_path = project_path / filename
            if file_path.exists():
                stat = file_path.stat()
                status = "✅ Found"
                size = f"{stat.st_size / 1024:.1f} KB"
                modified = time.strftime(
                    "%Y-%m-%d %H:%M:%S", time.localtime(stat.st_mtime)
                )
            else:
                status = "❌ Missing"
                size = "-"
                modified = "-"

            table.add_row(filename, status, size, modified)

        console.print(table)

    if watch:
        console.print(
            f"[dim]Monitoring would refresh every {interval} seconds...[/dim]"
        )
        console.print(
            "[yellow]Note: Full monitoring requires integration with running MCP server.[/yellow]"
        )


@cli.command()
@click.option(
    "--project-root",
    type=click.Path(exists=True),
    required=True,
    help="Project root directory",
)
@click.option(
    "--dry-run",
    is_flag=True,
    help="Show what would be optimized without making changes",
)
def optimize(project_root: str, dry_run: bool):
    """Optimize performance of MCP files."""
    project_path = Path(project_root)

    console.print(
        "[bold cyan]🔍 Analyzing MCP files for optimization opportunities...[/bold cyan]"
    )

    optimizations = []

    # Check operation queue
    queue_file = project_path / "mcp-operations.json"
    if queue_file.exists():
        stat = queue_file.stat()
        size_mb = stat.st_size / 1024 / 1024

        if size_mb > 10:  # 10MB threshold
            optimizations.append(
                f"Large operation queue: {size_mb:.1f}MB - Consider cleanup"
            )

        try:
            with open(queue_file, "r") as f:
                data = json.load(f)
                operations = data.get("operations", [])

                completed = sum(
                    1 for op in operations if op.get("status") == "COMPLETED"
                )
                if completed > len(operations) * 0.5:
                    optimizations.append(
                        f"Queue has {completed} completed operations - Consider compaction"
                    )
        except:
            optimizations.append("Cannot parse operation queue - May be corrupted")

    # Check for temporary files
    temp_files = list(project_path.glob("*.tmp"))
    if temp_files:
        total_size = sum(f.stat().st_size for f in temp_files)
        optimizations.append(
            f"Found {len(temp_files)} temporary files ({total_size/1024:.1f}KB)"
        )

    # Check for old backup files
    backup_files = list(project_path.glob("*.corrupted_*"))
    if len(backup_files) > 5:
        optimizations.append(
            f"Found {len(backup_files)} backup files - Keep only recent ones"
        )

    if optimizations:
        console.print("\n[bold yellow]🔧 Optimization Opportunities:[/bold yellow]")
        for i, opt in enumerate(optimizations, 1):
            console.print(f"  {i}. {opt}")

        if dry_run:
            console.print(
                "\n[dim]This was a dry run. Use --no-dry-run to apply optimizations.[/dim]"
            )
        else:
            if click.confirm("\nApply optimizations?"):
                apply_optimizations(project_path, optimizations)
            else:
                console.print("[yellow]Optimizations cancelled.[/yellow]")
    else:
        console.print(
            "[bold green]✅ No optimization opportunities found![/bold green]"
        )


def apply_optimizations(project_path: Path, optimizations: list):
    """Apply the identified optimizations."""
    with Progress(console=console) as progress:
        task = progress.add_task("Applying optimizations...", total=len(optimizations))

        for opt in optimizations:
            if "temporary files" in opt:
                # Clean up temporary files
                temp_files = list(project_path.glob("*.tmp"))
                for temp_file in temp_files:
                    try:
                        temp_file.unlink()
                    except OSError:
                        pass

            elif "backup files" in opt:
                # Keep only 5 most recent backup files
                backup_files = list(project_path.glob("*.corrupted_*"))
                backup_files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
                for backup_file in backup_files[5:]:
                    try:
                        backup_file.unlink()
                    except OSError:
                        pass

            progress.advance(task)

    console.print("[bold green]✅ Optimizations applied successfully![/bold green]")


@cli.command()
@click.option("--export-path", type=click.Path(), help="Export configuration to file")
def export_config(export_path: Optional[str]):
    """Export current performance configuration."""
    try:
        config = get_performance_config()

        config_dict = {
            "profile": config.profile,
            "cache": {
                "lru_cache_size": config.cache.lru_cache_size,
                "enable_result_caching": config.cache.enable_result_caching,
                "result_cache_max_size": config.cache.result_cache_max_size,
            },
            "batching": {
                "enable_batching": config.batching.enable_batching,
                "max_batch_size": config.batching.max_batch_size,
                "enable_smart_batching": config.batching.enable_smart_batching,
            },
            "memory": {
                "max_memory_usage_mb": config.memory.max_memory_usage_mb,
                "max_queue_size": config.memory.max_queue_size,
            },
            "concurrency": {
                "max_parallel_operations": config.concurrency.max_parallel_operations,
                "debounce_delay_ms": config.concurrency.debounce_delay_ms,
            },
        }

        if export_path:
            with open(export_path, "w") as f:
                json.dump(config_dict, f, indent=2)
            console.print(f"[green]Configuration exported to {export_path}[/green]")
        else:
            console.print(json.dumps(config_dict, indent=2))

    except Exception as e:
        console.print(f"[bold red]Error exporting configuration: {e}[/bold red]")
        sys.exit(1)


if __name__ == "__main__":
    cli()
