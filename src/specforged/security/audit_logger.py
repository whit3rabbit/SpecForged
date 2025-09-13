"""
Security audit logging system for SpecForge MCP operations.

This module provides comprehensive security event logging, monitoring,
and audit trail capabilities for compliance and security analysis.
"""

import json
import logging
import threading
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from .data_sanitizer import PrivacyProtector


class SecurityEventType(Enum):
    """Types of security events to log."""

    # Authentication and Authorization
    AUTH_SUCCESS = "auth_success"
    AUTH_FAILURE = "auth_failure"
    PERMISSION_DENIED = "permission_denied"
    PRIVILEGE_ESCALATION = "privilege_escalation"

    # Input Validation and Injection Attempts
    INPUT_VALIDATION_FAILURE = "input_validation_failure"
    INJECTION_ATTEMPT = "injection_attempt"
    XSS_ATTEMPT = "xss_attempt"
    SQL_INJECTION_ATTEMPT = "sql_injection_attempt"
    COMMAND_INJECTION_ATTEMPT = "command_injection_attempt"

    # File System Security
    PATH_TRAVERSAL_ATTEMPT = "path_traversal_attempt"
    UNAUTHORIZED_FILE_ACCESS = "unauthorized_file_access"
    FILE_PERMISSION_VIOLATION = "file_permission_violation"
    SUSPICIOUS_FILE_OPERATION = "suspicious_file_operation"

    # Rate Limiting and DoS
    RATE_LIMIT_EXCEEDED = "rate_limit_exceeded"
    DOS_ATTEMPT = "dos_attempt"
    SUSPICIOUS_ACTIVITY = "suspicious_activity"
    CLIENT_BANNED = "client_banned"

    # Data Privacy
    SENSITIVE_DATA_DETECTED = "sensitive_data_detected"
    DATA_LEAK_ATTEMPT = "data_leak_attempt"
    PRIVACY_VIOLATION = "privacy_violation"

    # Operation Security
    OPERATION_STARTED = "operation_started"
    OPERATION_COMPLETED = "operation_completed"
    OPERATION_FAILED = "operation_failed"
    UNAUTHORIZED_OPERATION = "unauthorized_operation"

    # System Events
    SECURITY_CONFIGURATION_CHANGED = "security_config_changed"
    AUDIT_LOG_ACCESSED = "audit_log_accessed"
    SECURITY_ALERT = "security_alert"
    SYSTEM_COMPROMISE_SUSPECTED = "system_compromise_suspected"


class SecurityEventSeverity(Enum):
    """Severity levels for security events."""

    DEBUG = 0
    INFO = 1
    WARNING = 2
    ERROR = 3
    CRITICAL = 4


@dataclass
class SecurityEvent:
    """Individual security event record."""

    # Core event information
    event_id: str
    event_type: SecurityEventType
    severity: SecurityEventSeverity
    timestamp: datetime
    message: str

    # Context information
    client_id: Optional[str] = None
    source_ip: Optional[str] = None
    user_agent: Optional[str] = None
    operation_type: Optional[str] = None
    resource_path: Optional[str] = None

    # Additional data (will be sanitized)
    details: Dict[str, Any] = field(default_factory=dict)

    # Security metadata
    threat_indicators: List[str] = field(default_factory=list)
    risk_score: float = 0.0
    requires_action: bool = False

    # Processing metadata
    processed: bool = False
    alert_sent: bool = False
    investigator_notes: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        """Convert event to dictionary for serialization."""
        data = asdict(self)

        # Convert enum values to strings
        data["event_type"] = self.event_type.value
        data["severity"] = self.severity.value
        data["timestamp"] = self.timestamp.isoformat()

        return data

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SecurityEvent":
        """Create event from dictionary."""
        # Convert string values back to enums
        data["event_type"] = SecurityEventType(data["event_type"])
        data["severity"] = SecurityEventSeverity(data["severity"])
        data["timestamp"] = datetime.fromisoformat(data["timestamp"])

        return cls(**data)


class SecurityAuditLogger:
    """Main security audit logging system."""

    def __init__(
        self,
        log_file_path: Union[str, Path],
        max_file_size: int = 100 * 1024 * 1024,  # 100MB
        backup_count: int = 10,
        enable_console_output: bool = False,
    ):
        """
        Initialize security audit logger.

        Args:
            log_file_path: Path to audit log file
            max_file_size: Maximum size before rotation
            backup_count: Number of backup files to keep
            enable_console_output: Whether to also log to console
        """
        self.log_file_path = Path(log_file_path)
        self.max_file_size = max_file_size
        self.backup_count = backup_count
        self.enable_console_output = enable_console_output

        # Initialize privacy protector for data sanitization
        self.privacy_protector = PrivacyProtector()

        # Thread safety
        self._lock = threading.RLock()

        # Statistics
        self.stats = {
            "total_events": 0,
            "events_by_type": {},
            "events_by_severity": {},
            "alerts_sent": 0,
            "last_event": None,
        }

        # Alert thresholds (events per hour)
        self.alert_thresholds = {
            SecurityEventType.INJECTION_ATTEMPT: 5,
            SecurityEventType.PATH_TRAVERSAL_ATTEMPT: 10,
            SecurityEventType.RATE_LIMIT_EXCEEDED: 100,
            SecurityEventType.UNAUTHORIZED_OPERATION: 3,
            SecurityEventType.SENSITIVE_DATA_DETECTED: 20,
        }

        # Setup logging
        self._setup_logging()

        # Log system initialization
        self.log_security_event(
            event_type=SecurityEventType.SECURITY_CONFIGURATION_CHANGED,
            severity=SecurityEventSeverity.INFO,
            message="Security audit logging system initialized",
            details={
                "log_file": str(self.log_file_path),
                "max_file_size": self.max_file_size,
                "backup_count": self.backup_count,
            },
        )

    def _setup_logging(self):
        """Setup Python logging system for audit logs."""
        # Create logger
        self.logger = logging.getLogger("specforge_security_audit")
        self.logger.setLevel(logging.DEBUG)

        # Ensure log directory exists
        self.log_file_path.parent.mkdir(parents=True, exist_ok=True)

        # File handler with rotation
        from logging.handlers import RotatingFileHandler

        file_handler = RotatingFileHandler(
            self.log_file_path,
            maxBytes=self.max_file_size,
            backupCount=self.backup_count,
        )
        file_handler.setLevel(logging.DEBUG)

        # JSON formatter
        class JSONFormatter(logging.Formatter):
            def format(self, record):
                log_data = {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "level": record.levelname,
                    "message": record.getMessage(),
                    "module": record.module,
                    "function": record.funcName,
                    "line": record.lineno,
                }

                # Add extra data if present
                if hasattr(record, "security_event"):
                    log_data["security_event"] = record.security_event

                return json.dumps(log_data, ensure_ascii=False)

        file_handler.setFormatter(JSONFormatter())
        self.logger.addHandler(file_handler)

        # Console handler (optional)
        if self.enable_console_output:
            console_handler = logging.StreamHandler()
            console_handler.setLevel(logging.WARNING)  # Only warnings and above
            console_handler.setFormatter(
                logging.Formatter(
                    "%(asctime)s - SECURITY - %(levelname)s - %(message)s"
                )
            )
            self.logger.addHandler(console_handler)

    def log_security_event(
        self,
        event_type: SecurityEventType,
        severity: SecurityEventSeverity,
        message: str,
        client_id: Optional[str] = None,
        source_ip: Optional[str] = None,
        user_agent: Optional[str] = None,
        operation_type: Optional[str] = None,
        resource_path: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        threat_indicators: Optional[List[str]] = None,
        risk_score: float = 0.0,
    ) -> str:
        """
        Log a security event.

        Args:
            event_type: Type of security event
            severity: Event severity level
            message: Human-readable event description
            client_id: Client identifier
            source_ip: Source IP address
            user_agent: User agent string
            operation_type: Type of operation
            resource_path: Path to affected resource
            details: Additional event details
            threat_indicators: List of threat indicators
            risk_score: Risk score (0.0-10.0)

        Returns:
            Event ID
        """
        with self._lock:
            # Create event
            event = SecurityEvent(
                event_id=str(uuid.uuid4()),
                event_type=event_type,
                severity=severity,
                timestamp=datetime.now(timezone.utc),
                message=message,
                client_id=client_id,
                source_ip=source_ip,
                user_agent=user_agent,
                operation_type=operation_type,
                resource_path=resource_path,
                details=details or {},
                threat_indicators=threat_indicators or [],
                risk_score=risk_score,
                requires_action=self._requires_action(event_type, severity, risk_score),
            )

            # Sanitize sensitive data in details
            sanitized_details = self.privacy_protector.sanitize_for_logging(
                event.details
            )
            event.details = sanitized_details

            # Log the event
            log_level = self._get_log_level(severity)
            event_dict = event.to_dict()

            extra_data = {"security_event": event_dict}
            self.logger.log(log_level, message, extra=extra_data)

            # Update statistics
            self._update_stats(event)

            # Check for alerting conditions
            if self._should_alert(event):
                self._send_alert(event)

            return event.event_id

    def log_authentication_event(
        self,
        success: bool,
        client_id: str,
        details: Optional[Dict[str, Any]] = None,
    ):
        """Log authentication attempt."""
        event_type = (
            SecurityEventType.AUTH_SUCCESS
            if success
            else SecurityEventType.AUTH_FAILURE
        )
        severity = (
            SecurityEventSeverity.INFO if success else SecurityEventSeverity.WARNING
        )
        message = f"Authentication {'successful' if success else 'failed'} for client {client_id}"

        threat_indicators = []
        risk_score = 0.0

        if not success:
            threat_indicators.append("authentication_failure")
            risk_score = 3.0

        self.log_security_event(
            event_type=event_type,
            severity=severity,
            message=message,
            client_id=client_id,
            details=details,
            threat_indicators=threat_indicators,
            risk_score=risk_score,
        )

    def log_input_validation_failure(
        self,
        operation_type: str,
        field: str,
        value: Any,
        error_message: str,
        client_id: Optional[str] = None,
    ):
        """Log input validation failure."""
        # Check for injection patterns
        threat_indicators = []
        risk_score = 2.0

        if isinstance(value, str):
            value_str = str(value).lower()
            if any(
                pattern in value_str for pattern in ["script", "javascript", "eval"]
            ):
                threat_indicators.append("xss_attempt")
                risk_score = 7.0
            elif any(
                pattern in value_str
                for pattern in ["select", "union", "drop", "insert"]
            ):
                threat_indicators.append("sql_injection_attempt")
                risk_score = 8.0
            elif any(pattern in value_str for pattern in ["../", "..\\", "%2e%2e"]):
                threat_indicators.append("path_traversal_attempt")
                risk_score = 6.0
            elif any(pattern in value_str for pattern in [";", "|", "&", "`", "$("]):
                threat_indicators.append("command_injection_attempt")
                risk_score = 7.0

        self.log_security_event(
            event_type=SecurityEventType.INPUT_VALIDATION_FAILURE,
            severity=SecurityEventSeverity.WARNING,
            message=f"Input validation failed for {operation_type}.{field}: {error_message}",
            client_id=client_id,
            operation_type=operation_type,
            details={
                "field": field,
                "validation_error": error_message,
                "rejected_value_type": type(value).__name__,
                "rejected_value_length": len(str(value)) if value else 0,
            },
            threat_indicators=threat_indicators,
            risk_score=risk_score,
        )

    def log_rate_limit_exceeded(
        self,
        client_id: str,
        operation_type: str,
        limit_type: str,
        retry_after: float,
    ):
        """Log rate limit exceeded event."""
        self.log_security_event(
            event_type=SecurityEventType.RATE_LIMIT_EXCEEDED,
            severity=SecurityEventSeverity.WARNING,
            message=f"Rate limit exceeded for client {client_id} on {operation_type}",
            client_id=client_id,
            operation_type=operation_type,
            details={
                "limit_type": limit_type,
                "retry_after": retry_after,
            },
            threat_indicators=["rate_limit_violation"],
            risk_score=3.0,
        )

    def log_path_security_violation(
        self,
        attempted_path: str,
        violation_type: str,
        client_id: Optional[str] = None,
        operation_type: Optional[str] = None,
    ):
        """Log path security violation."""
        risk_score = 8.0 if "traversal" in violation_type.lower() else 5.0

        self.log_security_event(
            event_type=SecurityEventType.PATH_TRAVERSAL_ATTEMPT,
            severity=SecurityEventSeverity.ERROR,
            message=f"Path security violation: {violation_type}",
            client_id=client_id,
            operation_type=operation_type,
            resource_path=attempted_path,
            details={
                "violation_type": violation_type,
                "attempted_path": attempted_path,
            },
            threat_indicators=["path_traversal_attempt", "file_system_attack"],
            risk_score=risk_score,
        )

    def log_sensitive_data_detected(
        self,
        data_types: List[str],
        confidence: float,
        operation_type: Optional[str] = None,
        client_id: Optional[str] = None,
    ):
        """Log sensitive data detection."""
        risk_score = min(10.0, confidence * len(data_types))

        self.log_security_event(
            event_type=SecurityEventType.SENSITIVE_DATA_DETECTED,
            severity=(
                SecurityEventSeverity.WARNING
                if confidence < 0.8
                else SecurityEventSeverity.ERROR
            ),
            message=f"Sensitive data detected: {', '.join(data_types)}",
            client_id=client_id,
            operation_type=operation_type,
            details={
                "data_types": data_types,
                "confidence": confidence,
                "count": len(data_types),
            },
            threat_indicators=["sensitive_data_exposure"],
            risk_score=risk_score,
        )

    def log_operation_security_event(
        self,
        operation_type: str,
        event_type: SecurityEventType,
        client_id: Optional[str] = None,
        success: bool = True,
        error_message: Optional[str] = None,
        operation_details: Optional[Dict[str, Any]] = None,
    ):
        """Log operation-related security event."""
        severity = (
            SecurityEventSeverity.INFO if success else SecurityEventSeverity.WARNING
        )
        message = f"Operation {operation_type} {'completed' if success else 'failed'}"

        if error_message:
            message += f": {error_message}"

        details = operation_details or {}
        if error_message:
            details["error"] = error_message

        self.log_security_event(
            event_type=event_type,
            severity=severity,
            message=message,
            client_id=client_id,
            operation_type=operation_type,
            details=details,
            risk_score=0.0 if success else 2.0,
        )

    def _get_log_level(self, severity: SecurityEventSeverity) -> int:
        """Convert security severity to Python logging level."""
        mapping = {
            SecurityEventSeverity.DEBUG: logging.DEBUG,
            SecurityEventSeverity.INFO: logging.INFO,
            SecurityEventSeverity.WARNING: logging.WARNING,
            SecurityEventSeverity.ERROR: logging.ERROR,
            SecurityEventSeverity.CRITICAL: logging.CRITICAL,
        }
        return mapping.get(severity, logging.INFO)

    def _requires_action(
        self,
        event_type: SecurityEventType,
        severity: SecurityEventSeverity,
        risk_score: float,
    ) -> bool:
        """Determine if event requires immediate action."""
        # Critical events always require action
        if severity == SecurityEventSeverity.CRITICAL:
            return True

        # High risk score requires action
        if risk_score >= 7.0:
            return True

        # Specific event types that require action
        action_required_events = {
            SecurityEventType.INJECTION_ATTEMPT,
            SecurityEventType.PATH_TRAVERSAL_ATTEMPT,
            SecurityEventType.UNAUTHORIZED_OPERATION,
            SecurityEventType.SYSTEM_COMPROMISE_SUSPECTED,
            SecurityEventType.PRIVILEGE_ESCALATION,
        }

        return event_type in action_required_events

    def _update_stats(self, event: SecurityEvent):
        """Update logging statistics."""
        self.stats["total_events"] += 1
        self.stats["last_event"] = event.timestamp

        # Update by type
        event_type_str = event.event_type.value
        self.stats["events_by_type"][event_type_str] = (
            self.stats["events_by_type"].get(event_type_str, 0) + 1
        )

        # Update by severity
        severity_str = event.severity.name
        self.stats["events_by_severity"][severity_str] = (
            self.stats["events_by_severity"].get(severity_str, 0) + 1
        )

    def _should_alert(self, event: SecurityEvent) -> bool:
        """Determine if event should trigger an alert."""
        # Always alert on critical events
        if event.severity == SecurityEventSeverity.CRITICAL:
            return True

        # Alert on high risk scores
        if event.risk_score >= 8.0:
            return True

        # Check threshold-based alerting
        if event.event_type in self.alert_thresholds:
            threshold = self.alert_thresholds[event.event_type]
            # For now, just use threshold as trigger (in production, would track rate)
            return event.risk_score >= threshold / 10.0  # Convert to risk scale

        return False

    def _send_alert(self, event: SecurityEvent):
        """Send security alert (implementation depends on alerting system)."""
        # In a real implementation, this would integrate with:
        # - Email notifications
        # - Slack/Teams webhooks
        # - SIEM systems
        # - Security operation centers

        alert_message = (
            f"SECURITY ALERT: {event.event_type.value}\n"
            f"Severity: {event.severity.name}\n"
            f"Risk Score: {event.risk_score}\n"
            f"Message: {event.message}\n"
            f"Client: {event.client_id or 'Unknown'}\n"
            f"Time: {event.timestamp.isoformat()}"
        )

        # Log the alert
        self.logger.critical(f"SECURITY ALERT TRIGGERED: {alert_message}")

        # Update stats
        self.stats["alerts_sent"] += 1
        event.alert_sent = True

    def get_security_stats(self) -> Dict[str, Any]:
        """Get security logging statistics."""
        with self._lock:
            return {
                **self.stats,
                "alert_thresholds": {
                    k.value: v for k, v in self.alert_thresholds.items()
                },
                "log_file_size": (
                    self.log_file_path.stat().st_size
                    if self.log_file_path.exists()
                    else 0
                ),
            }

    def search_events(
        self,
        event_type: Optional[SecurityEventType] = None,
        severity: Optional[SecurityEventSeverity] = None,
        client_id: Optional[str] = None,
        since: Optional[datetime] = None,
        limit: int = 100,
    ) -> List[SecurityEvent]:
        """
        Search security events (basic implementation).

        In a production system, this would use a proper search index or database.
        """
        # This is a simplified implementation
        # In production, you'd want to use a proper log analysis tool
        events = []

        if not self.log_file_path.exists():
            return events

        try:
            with open(self.log_file_path, "r", encoding="utf-8") as f:
                for line in f:
                    try:
                        log_entry = json.loads(line)
                        if "security_event" in log_entry:
                            event_data = log_entry["security_event"]
                            event = SecurityEvent.from_dict(event_data)

                            # Apply filters
                            if event_type and event.event_type != event_type:
                                continue
                            if severity and event.severity != severity:
                                continue
                            if client_id and event.client_id != client_id:
                                continue
                            if since and event.timestamp < since:
                                continue

                            events.append(event)

                            if len(events) >= limit:
                                break

                    except (json.JSONDecodeError, KeyError, ValueError):
                        continue  # Skip malformed entries

        except Exception as e:
            self.logger.error(f"Failed to search events: {e}")

        return events

    def generate_security_report(self, hours: int = 24) -> Dict[str, Any]:
        """Generate a security report for the last N hours."""
        since = datetime.now(timezone.utc) - timedelta(hours=hours)
        events = self.search_events(since=since, limit=10000)

        # Analyze events
        report = {
            "report_period_hours": hours,
            "total_events": len(events),
            "events_by_type": {},
            "events_by_severity": {},
            "top_threat_indicators": {},
            "high_risk_events": [],
            "clients_with_violations": set(),
            "recommendations": [],
        }

        for event in events:
            # Count by type
            event_type = event.event_type.value
            report["events_by_type"][event_type] = (
                report["events_by_type"].get(event_type, 0) + 1
            )

            # Count by severity
            severity = event.severity.name
            report["events_by_severity"][severity] = (
                report["events_by_severity"].get(severity, 0) + 1
            )

            # Track threat indicators
            for indicator in event.threat_indicators:
                report["top_threat_indicators"][indicator] = (
                    report["top_threat_indicators"].get(indicator, 0) + 1
                )

            # High risk events
            if event.risk_score >= 7.0:
                report["high_risk_events"].append(
                    {
                        "event_id": event.event_id,
                        "type": event.event_type.value,
                        "risk_score": event.risk_score,
                        "message": event.message,
                        "timestamp": event.timestamp.isoformat(),
                    }
                )

            # Clients with violations
            if (
                event.client_id
                and event.severity.value >= SecurityEventSeverity.WARNING.value
            ):
                report["clients_with_violations"].add(event.client_id)

        # Convert set to list for JSON serialization
        report["clients_with_violations"] = list(report["clients_with_violations"])

        # Generate recommendations
        if report["events_by_type"].get("injection_attempt", 0) > 0:
            report["recommendations"].append(
                "Review input validation rules - injection attempts detected"
            )

        if report["events_by_type"].get("path_traversal_attempt", 0) > 0:
            report["recommendations"].append(
                "Strengthen path validation - traversal attempts detected"
            )

        if report["events_by_type"].get("rate_limit_exceeded", 0) > 10:
            report["recommendations"].append(
                "Review rate limiting policies - frequent violations"
            )

        return report
