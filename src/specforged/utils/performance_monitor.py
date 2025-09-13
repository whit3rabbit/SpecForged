"""
Performance monitoring and dashboard utilities for SpecForge MCP ecosystem.

This module provides real-time performance monitoring, metrics collection,
and dashboard generation for both the Python MCP server and VS Code extension.
"""

import asyncio
import json
import logging
import threading
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Union


@dataclass
class PerformanceSnapshot:
    """Single point-in-time performance measurement."""

    timestamp: datetime
    component: str  # 'queue_processor' or 'vscode_extension'
    metrics: Dict[str, Union[int, float, str]]
    alerts: List[str] = None

    def __post_init__(self):
        if self.alerts is None:
            self.alerts = []


@dataclass
class PerformanceThresholds:
    """Performance alert thresholds."""

    max_memory_mb: float = 150.0
    min_throughput_ops_sec: float = 25.0
    max_processing_time_ms: float = 10000.0
    min_cache_hit_rate: float = 0.7
    max_error_rate: float = 0.1
    max_queue_size: int = 8000


class PerformanceMetricsCollector:
    """Collects and aggregates performance metrics."""

    def __init__(self, retention_hours: int = 24):
        self.retention_hours = retention_hours
        self.metrics_history: deque = deque()
        self.logger = logging.getLogger(__name__)
        self._lock = threading.Lock()

    def add_snapshot(self, snapshot: PerformanceSnapshot) -> None:
        """Add a performance snapshot to the collection."""
        with self._lock:
            self.metrics_history.append(snapshot)
            self._cleanup_old_metrics()

    def _cleanup_old_metrics(self) -> None:
        """Remove metrics older than retention period."""
        cutoff_time = datetime.now(timezone.utc) - timedelta(hours=self.retention_hours)

        while self.metrics_history and self.metrics_history[0].timestamp < cutoff_time:
            self.metrics_history.popleft()

    def get_recent_metrics(
        self, component: str = None, hours: int = 1
    ) -> List[PerformanceSnapshot]:
        """Get recent metrics for a specific component."""
        cutoff_time = datetime.now(timezone.utc) - timedelta(hours=hours)

        with self._lock:
            recent_metrics = [
                snapshot
                for snapshot in self.metrics_history
                if snapshot.timestamp >= cutoff_time
                and (component is None or snapshot.component == component)
            ]

        return recent_metrics

    def get_aggregated_metrics(
        self, component: str = None, hours: int = 1
    ) -> Dict[str, Any]:
        """Get aggregated metrics for a time period."""
        recent_metrics = self.get_recent_metrics(component, hours)

        if not recent_metrics:
            return {}

        # Aggregate numeric metrics
        aggregated = {
            "count": len(recent_metrics),
            "time_range_hours": hours,
            "component": component or "all",
        }

        # Collect all metric keys
        all_keys = set()
        for snapshot in recent_metrics:
            all_keys.update(snapshot.metrics.keys())

        # Calculate aggregations for each numeric metric
        for key in all_keys:
            values = []
            for snapshot in recent_metrics:
                if key in snapshot.metrics:
                    value = snapshot.metrics[key]
                    if isinstance(value, (int, float)):
                        values.append(value)

            if values:
                aggregated[key] = {
                    "avg": sum(values) / len(values),
                    "min": min(values),
                    "max": max(values),
                    "latest": values[-1] if values else 0,
                }

        # Count alerts
        all_alerts = []
        for snapshot in recent_metrics:
            all_alerts.extend(snapshot.alerts or [])

        aggregated["alerts"] = {
            "total": len(all_alerts),
            "unique": len(set(all_alerts)),
            "recent": list(set(all_alerts)),
        }

        return aggregated


class PerformanceAlertManager:
    """Manages performance alerts and notifications."""

    def __init__(self, thresholds: PerformanceThresholds = None):
        self.thresholds = thresholds or PerformanceThresholds()
        self.logger = logging.getLogger(__name__)
        self.active_alerts: Dict[str, datetime] = {}
        self.alert_cooldown_minutes = 5

    def check_thresholds(self, metrics: Dict[str, Any]) -> List[str]:
        """Check metrics against thresholds and return alerts."""
        alerts = []

        # Memory usage alert
        memory_mb = metrics.get("memory_usage_mb", 0)
        if memory_mb > self.thresholds.max_memory_mb:
            alerts.append(
                f"High memory usage: {memory_mb:.1f}MB "
                f"(threshold: {self.thresholds.max_memory_mb}MB)"
            )

        # Throughput alert
        throughput = metrics.get("queue_throughput", 0)
        if throughput > 0 and throughput < self.thresholds.min_throughput_ops_sec:
            alerts.append(
                f"Low throughput: {throughput:.1f} ops/sec "
                f"(threshold: {self.thresholds.min_throughput_ops_sec})"
            )

        # Processing time alert
        processing_time = metrics.get("avg_processing_time_ms", 0)
        if processing_time > self.thresholds.max_processing_time_ms:
            alerts.append(
                f"High processing time: {processing_time:.1f}ms "
                f"(threshold: {self.thresholds.max_processing_time_ms}ms)"
            )

        # Cache hit rate alert
        cache_hit_rate = metrics.get("cache_hit_rate", 1.0)
        if cache_hit_rate < self.thresholds.min_cache_hit_rate:
            alerts.append(
                f"Low cache hit rate: {cache_hit_rate:.1%} "
                f"(threshold: {self.thresholds.min_cache_hit_rate:.1%})"
            )

        # Queue size alert
        queue_size = metrics.get("queue_size", 0)
        if queue_size > self.thresholds.max_queue_size:
            alerts.append(
                f"Large queue size: {queue_size} operations "
                f"(threshold: {self.thresholds.max_queue_size})"
            )

        return self._filter_cooldown_alerts(alerts)

    def _filter_cooldown_alerts(self, alerts: List[str]) -> List[str]:
        """Filter out alerts that are in cooldown period."""
        now = datetime.now(timezone.utc)
        filtered_alerts = []

        for alert in alerts:
            alert_key = alert.split(":")[0]  # Use first part as key

            last_alert_time = self.active_alerts.get(alert_key)
            if (
                last_alert_time is None
                or (now - last_alert_time).total_seconds()
                > self.alert_cooldown_minutes * 60
            ):
                filtered_alerts.append(alert)
                self.active_alerts[alert_key] = now

        return filtered_alerts


class PerformanceDashboard:
    """Generates performance dashboard data and visualizations."""

    def __init__(self, metrics_collector: PerformanceMetricsCollector):
        self.metrics_collector = metrics_collector
        self.logger = logging.getLogger(__name__)

    def generate_dashboard_data(self) -> Dict[str, Any]:
        """Generate comprehensive dashboard data."""
        dashboard = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "queue_processor": self._get_component_dashboard("queue_processor"),
            "vscode_extension": self._get_component_dashboard("vscode_extension"),
            "summary": self._get_summary_dashboard(),
            "alerts": self._get_active_alerts(),
        }

        return dashboard

    def _get_component_dashboard(self, component: str) -> Dict[str, Any]:
        """Generate dashboard data for a specific component."""
        # Get metrics for different time periods
        recent_1h = self.metrics_collector.get_aggregated_metrics(component, 1)
        recent_6h = self.metrics_collector.get_aggregated_metrics(component, 6)
        recent_24h = self.metrics_collector.get_aggregated_metrics(component, 24)

        return {
            "component": component,
            "last_1_hour": recent_1h,
            "last_6_hours": recent_6h,
            "last_24_hours": recent_24h,
            "trends": self._calculate_trends(component),
        }

    def _get_summary_dashboard(self) -> Dict[str, Any]:
        """Generate summary dashboard across all components."""
        all_recent = self.metrics_collector.get_recent_metrics(hours=1)

        if not all_recent:
            return {"status": "no_data"}

        # Calculate overall health score
        health_score = self._calculate_health_score(all_recent)

        # Get system-wide statistics
        total_operations = sum(
            snapshot.metrics.get("operations_processed", 0) for snapshot in all_recent
        )

        avg_memory = (
            sum(snapshot.metrics.get("memory_usage_mb", 0) for snapshot in all_recent)
            / len(all_recent)
            if all_recent
            else 0
        )

        return {
            "health_score": health_score,
            "total_operations_1h": total_operations,
            "avg_memory_usage_mb": avg_memory,
            "active_components": len(set(s.component for s in all_recent)),
            "last_update": (
                all_recent[-1].timestamp.isoformat() if all_recent else None
            ),
        }

    def _get_active_alerts(self) -> List[Dict[str, Any]]:
        """Get all active alerts from recent metrics."""
        recent_metrics = self.metrics_collector.get_recent_metrics(hours=1)

        all_alerts = []
        for snapshot in recent_metrics:
            for alert in snapshot.alerts or []:
                all_alerts.append(
                    {
                        "message": alert,
                        "component": snapshot.component,
                        "timestamp": snapshot.timestamp.isoformat(),
                        "severity": self._get_alert_severity(alert),
                    }
                )

        # Remove duplicates and sort by timestamp
        unique_alerts = []
        seen_messages = set()

        for alert in reversed(all_alerts):  # Start with most recent
            if alert["message"] not in seen_messages:
                unique_alerts.append(alert)
                seen_messages.add(alert["message"])

        return list(reversed(unique_alerts))  # Return in chronological order

    def _calculate_trends(self, component: str) -> Dict[str, str]:
        """Calculate performance trends for a component."""
        # Get metrics for trend calculation
        recent_30min = self.metrics_collector.get_aggregated_metrics(component, 0.5)
        recent_1h = self.metrics_collector.get_aggregated_metrics(component, 1)

        trends = {}

        if recent_30min and recent_1h:
            # Compare key metrics
            metrics_to_trend = [
                "memory_usage_mb",
                "queue_throughput",
                "cache_hit_rate",
            ]

            for metric in metrics_to_trend:
                if metric in recent_30min and metric in recent_1h:
                    recent_val = recent_30min[metric]["avg"]
                    older_val = recent_1h[metric]["avg"]

                    if recent_val > older_val * 1.1:
                        trends[metric] = "increasing"
                    elif recent_val < older_val * 0.9:
                        trends[metric] = "decreasing"
                    else:
                        trends[metric] = "stable"

        return trends

    def _calculate_health_score(
        self, snapshots: List[PerformanceSnapshot]
    ) -> Dict[str, Any]:
        """Calculate overall system health score (0-100)."""
        if not snapshots:
            return {"score": 0, "status": "unknown"}

        # Factors that affect health score
        factors = {
            "memory_usage": 1.0,  # Weight: memory usage impact
            "throughput": 1.2,  # Weight: throughput impact
            "cache_performance": 0.8,  # Weight: cache performance impact
            "error_rate": 1.5,  # Weight: error rate impact
            "alerts": 2.0,  # Weight: active alerts impact
        }

        total_weight = sum(factors.values())
        weighted_score = 0

        # Calculate memory usage score (0-100, lower usage = higher score)
        avg_memory = sum(s.metrics.get("memory_usage_mb", 0) for s in snapshots) / len(
            snapshots
        )
        memory_score = max(0, 100 - (avg_memory / 2))  # Penalty starts at 200MB
        weighted_score += memory_score * factors["memory_usage"]

        # Calculate throughput score (0-100, higher throughput = higher score)
        avg_throughput = sum(
            s.metrics.get("queue_throughput", 0) for s in snapshots
        ) / len(snapshots)
        throughput_score = min(100, avg_throughput * 2)  # 50 ops/sec = 100 score
        weighted_score += throughput_score * factors["throughput"]

        # Calculate cache performance score
        avg_cache_hit_rate = sum(
            s.metrics.get("cache_hit_rate", 0) for s in snapshots
        ) / len(snapshots)
        cache_score = avg_cache_hit_rate * 100  # Direct percentage
        weighted_score += cache_score * factors["cache_performance"]

        # Error rate score (assume 0 errors for now, could be enhanced)
        error_score = 100  # No error tracking yet
        weighted_score += error_score * factors["error_rate"]

        # Alert penalty
        total_alerts = sum(len(s.alerts or []) for s in snapshots)
        alert_penalty = min(50, total_alerts * 10)  # Max 50 point penalty
        alert_score = max(0, 100 - alert_penalty)
        weighted_score += alert_score * factors["alerts"]

        # Calculate final score
        final_score = weighted_score / total_weight

        # Determine status
        if final_score >= 90:
            status = "excellent"
        elif final_score >= 75:
            status = "good"
        elif final_score >= 60:
            status = "fair"
        elif final_score >= 40:
            status = "poor"
        else:
            status = "critical"

        return {
            "score": round(final_score, 1),
            "status": status,
            "factors": {
                "memory": round(memory_score, 1),
                "throughput": round(throughput_score, 1),
                "cache": round(cache_score, 1),
                "errors": round(error_score, 1),
                "alerts": round(alert_score, 1),
            },
        }

    def _get_alert_severity(self, alert_message: str) -> str:
        """Determine alert severity based on message content."""
        alert_lower = alert_message.lower()

        if any(word in alert_lower for word in ["critical", "failed", "error"]):
            return "critical"
        elif any(word in alert_lower for word in ["high", "low", "slow"]):
            return "warning"
        else:
            return "info"

    def export_dashboard_html(self, output_path: Path) -> None:
        """Export dashboard as HTML file."""
        dashboard_data = self.generate_dashboard_data()

        html_content = self._generate_html_dashboard(dashboard_data)

        with open(output_path, "w", encoding="utf-8") as f:
            f.write(html_content)

        self.logger.info(f"Dashboard exported to {output_path}")

    def _generate_html_dashboard(self, dashboard_data: Dict[str, Any]) -> str:
        """Generate HTML dashboard content."""
        return f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SpecForge Performance Dashboard</title>
    <style>
        body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }}  /* noqa: E501 */
        .container {{ max-width: 1200px; margin: 0 auto; }}
        .header {{ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 10px; margin-bottom: 20px; }}  /* noqa: E501 */
        .header h1 {{ margin: 0; font-size: 2.5em; }}
        .header p {{ margin: 5px 0 0 0; opacity: 0.9; }}
        .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }}  /* noqa: E501 */
        .card {{ background: white; border-radius: 10px; padding: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }}  /* noqa: E501 */
        .card h2 {{ margin-top: 0; color: #333; border-bottom: 2px solid #eee; padding-bottom: 10px; }}  /* noqa: E501 */
        .metric {{ display: flex; justify-content: space-between; margin: 10px 0; padding: 10px; background: #f8f9fa; border-radius: 5px; }}  /* noqa: E501 */
        .metric-name {{ font-weight: 600; color: #555; }}
        .metric-value {{ font-weight: 700; color: #007bff; }}
        .health-score {{ font-size: 3em; font-weight: bold; text-align: center; padding: 20px; }}
        .health-excellent {{ color: #28a745; }}
        .health-good {{ color: #17a2b8; }}
        .health-fair {{ color: #ffc107; }}
        .health-poor {{ color: #fd7e14; }}
        .health-critical {{ color: #dc3545; }}
        .alert {{ padding: 10px; margin: 5px 0; border-radius: 5px; }}
        .alert-critical {{ background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }}
        .alert-warning {{ background-color: #fff3cd; color: #856404; border: 1px solid #ffeaa7; }}
        .alert-info {{ background-color: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }}
        .timestamp {{ font-size: 0.8em; color: #666; }}
    </style>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>SpecForge Performance Dashboard</h1>
            <p>Generated at: {dashboard_data['generated_at']}</p>
        </div>

        <div class="grid">
            <!-- Health Score Card -->
            <div class="card">
                <h2>System Health</h2>
                <div class="health-score health-{dashboard_data['summary'].get('status', 'unknown')}">  # noqa: E501
                    {dashboard_data['summary'].get('health_score', {}).get('score', 'N/A')}
                </div>
                <div style="text-align: center; font-size: 1.2em; text-transform: capitalize;">
                    {dashboard_data['summary'].get('health_score', {}).get('status', 'Unknown')}
                </div>
            </div>

            <!-- Queue Processor Metrics -->
            <div class="card">
                <h2>Queue Processor</h2>
                {self._format_component_metrics(dashboard_data.get('queue_processor', {}))}
            </div>

            <!-- VS Code Extension Metrics -->
            <div class="card">
                <h2>VS Code Extension</h2>
                {self._format_component_metrics(dashboard_data.get('vscode_extension', {}))}
            </div>

            <!-- Active Alerts -->
            <div class="card">
                <h2>Active Alerts</h2>
                {self._format_alerts(dashboard_data.get('alerts', []))}
            </div>
        </div>
    </div>
</body>
</html>
        """

    def _format_component_metrics(self, component_data: Dict[str, Any]) -> str:
        """Format component metrics for HTML display."""
        if not component_data or "last_1_hour" not in component_data:
            return "<p>No recent data available</p>"

        metrics = component_data["last_1_hour"]
        html_parts = []

        # Format key metrics
        key_metrics = [
            ("operations_processed", "Operations Processed"),
            ("memory_usage_mb", "Memory Usage (MB)"),
            ("queue_throughput", "Throughput (ops/sec)"),
            ("cache_hit_rate", "Cache Hit Rate"),
            ("avg_processing_time_ms", "Avg Processing Time (ms)"),
        ]

        for key, label in key_metrics:
            if key in metrics and "latest" in metrics[key]:
                value = metrics[key]["latest"]
                if key == "cache_hit_rate":
                    value_str = f"{value:.1%}"
                elif isinstance(value, float):
                    value_str = f"{value:.2f}"
                else:
                    value_str = str(value)

                html_parts.append(
                    f"""
                    <div class="metric">
                        <span class="metric-name">{label}</span>
                        <span class="metric-value">{value_str}</span>
                    </div>
                """
                )

        return "".join(html_parts) if html_parts else "<p>No metrics available</p>"

    def _format_alerts(self, alerts: List[Dict[str, Any]]) -> str:
        """Format alerts for HTML display."""
        if not alerts:
            return "<p style='color: #28a745;'>No active alerts</p>"

        html_parts = []
        for alert in alerts[-10:]:  # Show last 10 alerts
            severity = alert.get("severity", "info")
            message = alert.get("message", "")
            timestamp = alert.get("timestamp", "")
            component = alert.get("component", "")

            html_parts.append(
                f"""
                <div class="alert alert-{severity}">
                    <strong>{component}:</strong> {message}
                    <div class="timestamp">{timestamp}</div>
                </div>
            """
            )

        return "".join(html_parts)


class PerformanceMonitor:
    """Main performance monitoring coordinator."""

    def __init__(self, config_path: Optional[Path] = None):
        self.config = self._load_config(config_path)
        self.metrics_collector = PerformanceMetricsCollector(
            retention_hours=self.config.get("monitoring", {}).get(
                "metrics_retention_hours", 24
            )
        )
        self.alert_manager = PerformanceAlertManager()
        self.dashboard = PerformanceDashboard(self.metrics_collector)
        self.logger = logging.getLogger(__name__)

        # Background monitoring
        self._monitoring_active = False
        self._monitoring_task: Optional[asyncio.Task] = None

    def _load_config(self, config_path: Optional[Path]) -> Dict[str, Any]:
        """Load performance monitoring configuration."""
        if config_path and config_path.exists():
            try:
                with open(config_path, "r") as f:
                    return json.load(f)
            except Exception as e:
                logging.error(f"Failed to load config from {config_path}: {e}")

        # Default configuration
        return {
            "monitoring": {
                "metrics_retention_hours": 24,
                "update_interval_ms": 5000,
                "enable_metrics_collection": True,
            }
        }

    def record_metrics(self, component: str, metrics: Dict[str, Any]) -> None:
        """Record metrics for a component."""
        # Check for alerts
        alerts = self.alert_manager.check_thresholds(metrics)

        # Create snapshot
        snapshot = PerformanceSnapshot(
            timestamp=datetime.now(timezone.utc),
            component=component,
            metrics=metrics,
            alerts=alerts,
        )

        # Add to collector
        self.metrics_collector.add_snapshot(snapshot)

        # Log alerts
        for alert in alerts:
            self.logger.warning(f"Performance alert [{component}]: {alert}")

    async def start_monitoring(self) -> None:
        """Start background performance monitoring."""
        if self._monitoring_active:
            return

        self._monitoring_active = True
        self._monitoring_task = asyncio.create_task(self._monitoring_loop())
        self.logger.info("Performance monitoring started")

    async def stop_monitoring(self) -> None:
        """Stop background performance monitoring."""
        self._monitoring_active = False

        if self._monitoring_task:
            self._monitoring_task.cancel()
            try:
                await self._monitoring_task
            except asyncio.CancelledError:
                pass
            self._monitoring_task = None

        self.logger.info("Performance monitoring stopped")

    async def _monitoring_loop(self) -> None:
        """Background monitoring loop."""
        update_interval = (
            self.config.get("monitoring", {}).get("update_interval_ms", 5000) / 1000
        )

        while self._monitoring_active:
            try:
                # Generate dashboard data (this could trigger additional monitoring)
                dashboard_data = self.dashboard.generate_dashboard_data()

                # Log summary information
                health_score = dashboard_data.get("summary", {}).get("health_score", {})
                if health_score:
                    self.logger.info(
                        f"System health: {health_score.get('score', 'N/A')} ({health_score.get('status', 'unknown')})"  # noqa: E501
                    )

                await asyncio.sleep(update_interval)

            except Exception as e:
                self.logger.error(f"Error in monitoring loop: {e}")
                await asyncio.sleep(update_interval)

    def get_dashboard_data(self) -> Dict[str, Any]:
        """Get current dashboard data."""
        return self.dashboard.generate_dashboard_data()

    def export_dashboard(self, output_path: Path) -> None:
        """Export performance dashboard to HTML."""
        self.dashboard.export_dashboard_html(output_path)

    def get_performance_summary(self) -> Dict[str, Any]:
        """Get a summary of current performance status."""
        dashboard_data = self.get_dashboard_data()

        return {
            "health_score": dashboard_data.get("summary", {}).get("health_score", {}),
            "active_alerts": len(dashboard_data.get("alerts", [])),
            "components_active": len(
                [
                    comp
                    for comp in ["queue_processor", "vscode_extension"]
                    if dashboard_data.get(comp, {})
                    .get("last_1_hour", {})
                    .get("count", 0)
                    > 0
                ]
            ),
            "last_update": dashboard_data.get("generated_at"),
        }


# Convenience function for easy integration
def create_performance_monitor(
    config_path: Optional[Path] = None,
) -> PerformanceMonitor:
    """Create and configure a performance monitor."""
    return PerformanceMonitor(config_path)


if __name__ == "__main__":
    # Example usage (asyncio already imported at top)

    async def demo_monitoring():
        """Demonstrate performance monitoring."""
        monitor = create_performance_monitor()

        # Start monitoring
        await monitor.start_monitoring()

        # Simulate some metrics
        for i in range(10):
            monitor.record_metrics(
                "queue_processor",
                {
                    "operations_processed": i * 10,
                    "memory_usage_mb": 50 + i * 5,
                    "queue_throughput": 25 + i,
                    "cache_hit_rate": 0.8 + i * 0.02,
                    "avg_processing_time_ms": 100 + i * 10,
                },
            )

            await asyncio.sleep(1)

        # Generate dashboard
        dashboard_data = monitor.get_dashboard_data()
        print(json.dumps(dashboard_data, indent=2, default=str))

        # Export HTML dashboard
        output_path = Path("performance_dashboard.html")
        monitor.export_dashboard(output_path)
        print(f"Dashboard exported to {output_path}")

        # Stop monitoring
        await monitor.stop_monitoring()

    # Run demo
    asyncio.run(demo_monitoring())
