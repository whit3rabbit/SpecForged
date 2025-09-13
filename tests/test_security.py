"""
Comprehensive security testing suite for SpecForge MCP ecosystem.

Tests all security components including input validation, path security,
rate limiting, file operations, data sanitization, and audit logging.
"""

import tempfile
import time
from datetime import datetime
from pathlib import Path

import pytest

from src.specforged.security.audit_logger import (
    SecurityAuditLogger,
    SecurityEventSeverity,
    SecurityEventType,
)
from src.specforged.security.data_sanitizer import (
    PrivacyProtector,
    SensitiveDataDetector,
    SensitiveDataType,
)

# Import security modules
from src.specforged.security.input_validator import (
    DataSanitizer,
    InputValidator,
    ValidationError,
)
from src.specforged.security.path_security import (
    PathSecurityError,
    PathValidator,
    SecurePathHandler,
)
from src.specforged.security.rate_limiter import (
    ClientRateLimiter,
    RateLimitConfig,
    RateLimiter,
    RateLimitExceeded,
)
from src.specforged.security.secure_file_ops import (
    AtomicFileWriter,
    SecureFileError,
    SecureFileOperations,
)


class TestInputValidation:
    """Test input validation and sanitization functionality."""

    def setup_method(self):
        self.validator = InputValidator()
        self.sanitizer = DataSanitizer()

    def test_valid_create_spec_params(self):
        """Test validation of valid create spec parameters."""
        params = {
            "name": "Test Specification",
            "description": "A test specification",
            "spec_id": "test-spec",
        }

        result = self.validator.validate_operation_params("create_spec", params)
        assert result is not None
        assert "name" in result
        assert "description" in result
        assert "spec_id" in result

    def test_injection_attack_detection(self):
        """Test detection of various injection attacks."""
        injection_attempts = [
            # SQL injection
            "'; DROP TABLE users; --",
            "1' OR '1'='1",
            # XSS injection
            "<script>alert('xss')</script>",
            "javascript:alert('xss')",
            # Command injection
            "; rm -rf /",
            "| cat /etc/passwd",
            # Path traversal
            "../../../etc/passwd",
            "..\\..\\windows\\system32\\config\\sam",
        ]

        for payload in injection_attempts:
            with pytest.raises(ValidationError):
                self.validator.validate_operation_params(
                    "create_spec", {"name": payload, "description": "test"}
                )

    def test_oversized_input_rejection(self):
        """Test rejection of oversized inputs."""
        oversized_content = "A" * (1024 * 1024 + 1)  # > 1MB

        with pytest.raises(ValidationError):
            self.validator.validate_operation_params(
                "update_requirements",
                {"spec_id": "test", "content": oversized_content},
            )

    def test_malformed_data_handling(self):
        """Test handling of malformed data."""
        invalid_params = [
            None,
            [],
            42,
            "not_a_dict",
            {"name": None},  # Required field is None
            {"name": ""},  # Empty required field
        ]

        for params in invalid_params:
            with pytest.raises(ValidationError):
                self.validator.validate_operation_params("create_spec", params)

    def test_spec_id_validation(self):
        """Test spec ID format validation."""
        invalid_spec_ids = [
            "-invalid-start",  # Starts with hyphen
            "invalid-end-",  # Ends with hyphen
            "Invalid_Case",  # Contains uppercase
            "invalid space",  # Contains space
            "invalid/slash",  # Contains slash
            "a" * 51,  # Too long
        ]

        for spec_id in invalid_spec_ids:
            with pytest.raises(ValidationError):
                self.validator.validate_operation_params(
                    "delete_spec", {"spec_id": spec_id}
                )

    def test_task_number_validation(self):
        """Test task number format validation."""
        valid_task_numbers = ["1", "1.1", "2.3.4", "10.20.30"]
        invalid_task_numbers = ["", "a", "1.a", "1.", ".1", "1..2"]

        for task_number in valid_task_numbers:
            # Should not raise exception
            self.validator.validate_operation_params(
                "update_task_status",
                {
                    "spec_id": "test",
                    "task_number": task_number,
                    "status": "completed",
                },
            )

        for task_number in invalid_task_numbers:
            with pytest.raises(ValidationError):
                self.validator.validate_operation_params(
                    "update_task_status",
                    {
                        "spec_id": "test",
                        "task_number": task_number,
                        "status": "completed",
                    },
                )

    def test_data_sanitization(self):
        """Test data sanitization for logging."""
        sensitive_data = {
            "api_key": "sk-1234567890abcdef",
            "password": "supersecret123",
            "user_email": "user@example.com",
            "nested": {
                "token": "bearer_token_123456789",
                "safe_data": "this is safe",
            },
        }

        sanitized = self.sanitizer.sanitize_for_logging(sensitive_data)

        # Check sensitive data is redacted
        assert "[REDACTED]" in str(sanitized)
        assert "sk-1234567890abcdef" not in str(sanitized)
        assert "supersecret123" not in str(sanitized)
        assert "bearer_token_123456789" not in str(sanitized)

        # Check safe data is preserved
        assert "this is safe" in str(sanitized)


class TestPathSecurity:
    """Test path security and traversal prevention."""

    def setup_method(self):
        self.temp_dir = Path(tempfile.mkdtemp())
        self.path_validator = PathValidator([self.temp_dir])
        self.secure_handler = SecurePathHandler(self.temp_dir, self.temp_dir / "specs")

    def teardown_method(self):
        # Clean up temporary directory
        import shutil

        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_path_traversal_prevention(self):
        """Test prevention of directory traversal attacks."""
        traversal_attempts = [
            "../../../etc/passwd",
            "..\\..\\..\\windows\\system32\\config\\sam",
            "/etc/passwd",
            "C:\\windows\\system32\\config\\sam",
            "file:///etc/passwd",
            "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",  # URL encoded
        ]

        for attempt in traversal_attempts:
            with pytest.raises(PathSecurityError):
                self.path_validator.validate_path(attempt)

    def test_dangerous_filename_detection(self):
        """Test detection of dangerous filenames."""
        dangerous_filenames = [
            "malware.exe",
            "script.bat",
            "virus.com",
            "trojan.scr",
            "file\x00.txt",  # Null byte injection
            "file\n.txt",  # Newline injection
        ]

        for filename in dangerous_filenames:
            assert not self.path_validator.is_safe_filename(filename)

    def test_valid_path_acceptance(self):
        """Test that valid paths are accepted."""
        valid_file = self.temp_dir / "test.md"
        valid_file.touch()

        validated_path = self.path_validator.validate_path(valid_file)
        assert validated_path.exists()
        assert validated_path == valid_file.resolve()

    def test_specification_path_validation(self):
        """Test specification path validation."""
        # Valid spec path
        valid_path = self.secure_handler.validate_specification_path(
            "test-spec", "requirements.md"
        )
        assert "test-spec" in str(valid_path)
        assert "requirements.md" in str(valid_path)

        # Invalid spec ID
        with pytest.raises(PathSecurityError):
            self.secure_handler.validate_specification_path(
                "../evil-spec", "requirements.md"
            )

    def test_secure_temp_file_creation(self):
        """Test secure temporary file creation."""
        temp_path = self.secure_handler.create_secure_temp_path("test_", ".tmp")

        assert temp_path.parent.name == "tmp" or "tmp" in str(temp_path.parent)
        assert "test_" in temp_path.name
        assert temp_path.name.endswith(".tmp")


class TestRateLimiting:
    """Test rate limiting functionality."""

    def setup_method(self):
        self.config = RateLimitConfig(
            requests_per_minute=10,
            burst_limit=5,
            operation_limits={"create_spec": 2},
        )
        self.rate_limiter = RateLimiter(self.config)
        self.client_limiter = ClientRateLimiter(self.config)

    def test_basic_rate_limiting(self):
        """Test basic rate limiting functionality."""
        client_id = "test_client"

        # Should allow initial requests
        for i in range(5):
            self.rate_limiter.check_rate_limit(client_id, "heartbeat")

        # Should reject additional requests
        with pytest.raises(RateLimitExceeded):
            # Exceed burst limit
            for i in range(10):
                self.rate_limiter.check_rate_limit(client_id, "heartbeat")

    def test_operation_specific_limits(self):
        """Test operation-specific rate limits."""
        client_id = "test_client"

        # Create specs up to limit
        self.rate_limiter.check_rate_limit(client_id, "create_spec")
        self.rate_limiter.check_rate_limit(client_id, "create_spec")

        # Should reject additional create_spec requests
        with pytest.raises(RateLimitExceeded):
            # This should fail due to operation-specific limit
            for i in range(10):
                self.rate_limiter.check_rate_limit(client_id, "create_spec")

    def test_client_banning(self):
        """Test client banning for excessive violations."""
        client_id = "abusive_client"

        # Generate many violations
        for i in range(15):  # Exceed auto-ban threshold
            try:
                # Try to exceed limits repeatedly
                for j in range(20):
                    self.rate_limiter.check_rate_limit(client_id, "heartbeat")
            except RateLimitExceeded:
                pass  # Expected

        # Client should now be banned
        stats = self.rate_limiter.get_client_stats(client_id)
        assert stats is not None
        assert stats["is_banned"] or stats["violation_count"] >= 10

    def test_rate_limit_recovery(self):
        """Test that rate limits recover over time."""
        client_id = "test_client"

        # Fill up the bucket
        for i in range(5):
            self.rate_limiter.check_rate_limit(client_id, "heartbeat")

        # Should be rate limited now
        with pytest.raises(RateLimitExceeded):
            for i in range(10):
                self.rate_limiter.check_rate_limit(client_id, "heartbeat")

        # After waiting, should be able to make requests again
        # Note: In real tests, you'd mock time.time() to avoid actual delays
        time.sleep(1)  # Brief wait for token bucket refill

        # Should allow at least one more request
        self.rate_limiter.check_rate_limit(client_id, "heartbeat")


class TestSecureFileOperations:
    """Test secure file operations."""

    def setup_method(self):
        self.temp_dir = Path(tempfile.mkdtemp())
        self.path_handler = SecurePathHandler(self.temp_dir, self.temp_dir / "specs")
        self.file_ops = SecureFileOperations(self.path_handler)

    def teardown_method(self):
        import shutil

        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_atomic_file_writing(self):
        """Test atomic file writing operations."""
        test_file = self.temp_dir / "test.txt"
        test_content = "This is test content"

        # Write file atomically
        self.file_ops.write_file_safely(test_file, test_content)

        # Verify file exists and has correct content
        assert test_file.exists()
        content = self.file_ops.read_file_safely(test_file)
        assert content == test_content

    def test_file_size_limits(self):
        """Test file size limit enforcement."""
        test_file = self.temp_dir / "large.txt"
        # Create large content and write it to test file size limits
        large_content = "A" * (20 * 1024 * 1024)  # 20MB content
        test_file.write_text(large_content)

        with pytest.raises(SecureFileError):
            self.file_ops.read_file_safely(test_file, max_size=1024)  # 1KB limit

    def test_concurrent_file_access(self):
        """Test concurrent file access handling."""
        test_file = self.temp_dir / "concurrent.txt"

        # This would need to be more sophisticated in a real test
        # but demonstrates the concept
        with AtomicFileWriter(test_file) as f:
            f.write("Test content")

        assert test_file.exists()
        content = test_file.read_text()
        assert "Test content" in content

    def test_file_permission_security(self):
        """Test file permission setting."""
        test_file = self.temp_dir / "permissions.txt"
        self.file_ops.write_file_safely(test_file, "test")

        # Check that file has secure permissions
        file_stat = test_file.stat()
        permissions = file_stat.st_mode & 0o777

        # Should be readable/writable by owner only, readable by group
        assert permissions == 0o644

    def test_json_operations_security(self):
        """Test secure JSON operations."""
        test_file = self.temp_dir / "test.json"
        test_data = {"safe_data": "this is safe", "nested": {"key": "value"}}

        # Write JSON safely
        self.file_ops.write_json_safely(test_file, test_data)

        # Read JSON safely
        loaded_data = self.file_ops.read_json_safely(test_file)
        assert loaded_data == test_data

        # Test malformed JSON handling
        test_file.write_text("{ invalid json }")

        with pytest.raises(SecureFileError):
            self.file_ops.read_json_safely(test_file)

    def test_secure_file_deletion(self):
        """Test secure file deletion."""
        test_file = self.temp_dir / "sensitive.key"
        test_file.write_text("sensitive content")

        # Delete securely
        self.file_ops.delete_file_safely(test_file)

        # File should be gone
        assert not test_file.exists()


class TestDataSanitization:
    """Test data sanitization and privacy protection."""

    def setup_method(self):
        self.detector = SensitiveDataDetector()
        self.protector = PrivacyProtector()

    def test_sensitive_data_detection(self):
        """Test detection of various sensitive data types."""
        test_data = {
            "email": "user@example.com should be detected",
            "phone": "Call me at 555-123-4567",
            "ssn": "My SSN is 123-45-6789",
            "api_key": "api_key=sk-1234567890abcdef1234567890abcdef",
            "password": "password=supersecret123",
            "private_key": (
                "-----BEGIN RSA PRIVATE KEY-----\n"
                "MIIEpAIBAAKCAQEA...\n"
                "-----END RSA PRIVATE KEY-----"
            ),
        }

        for field, content in test_data.items():
            detections = self.detector.detect_sensitive_data(content)
            assert (
                len(detections) > 0
            ), f"Should detect sensitive data in {field}: {content}"

    def test_data_privacy_risk_assessment(self):
        """Test privacy risk assessment functionality."""
        high_risk_data = {
            "credit_card": "4111-1111-1111-1111",
            "ssn": "123-45-6789",
            "private_key": (
                "-----BEGIN PRIVATE KEY-----\n"
                "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC..."
            ),
        }

        assessment = self.protector.assess_privacy_risk(high_risk_data)

        assert assessment["risk_level"] in ["HIGH", "CRITICAL"]
        assert assessment["risk_score"] > 50
        assert len(assessment["detected_types"]) > 0
        assert len(assessment["recommendations"]) > 0

    def test_data_anonymization(self):
        """Test data anonymization functionality."""
        original_data = {
            "user_email": "john.doe@company.com",
            "phone_number": "555-123-4567",
            "description": "Contact john.doe@company.com for support",
        }

        anonymized = self.protector.anonymize_data(original_data)

        # Should not contain original sensitive data
        assert "john.doe@company.com" not in str(anonymized)
        assert "555-123-4567" not in str(anonymized)

        # Should contain pseudonyms
        assert "example.com" in str(anonymized) or "user" in str(anonymized)

    def test_consistent_pseudonymization(self):
        """Test that pseudonyms are consistent."""
        email = "user@example.com"

        pseudonym1 = self.protector.create_pseudonym(email, SensitiveDataType.EMAIL)
        pseudonym2 = self.protector.create_pseudonym(email, SensitiveDataType.EMAIL)

        # Should be consistent
        assert pseudonym1 == pseudonym2

        # Should be different from original
        assert pseudonym1 != email


class TestAuditLogging:
    """Test security audit logging functionality."""

    def setup_method(self):
        self.temp_dir = Path(tempfile.mkdtemp())
        self.log_file = self.temp_dir / "security.log"
        self.audit_logger = SecurityAuditLogger(self.log_file)

    def teardown_method(self):
        import shutil

        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_security_event_logging(self):
        """Test logging of security events."""
        event_id = self.audit_logger.log_security_event(
            event_type=SecurityEventType.INJECTION_ATTEMPT,
            severity=SecurityEventSeverity.ERROR,
            message="SQL injection attempt detected",
            client_id="test_client",
            details={"payload": "'; DROP TABLE users; --"},
        )

        assert event_id is not None
        assert self.log_file.exists()

        # Check log content
        log_content = self.log_file.read_text()
        assert "injection_attempt" in log_content
        assert "test_client" in log_content

    def test_input_validation_logging(self):
        """Test logging of input validation failures."""
        self.audit_logger.log_input_validation_failure(
            operation_type="create_spec",
            field="name",
            value="<script>alert('xss')</script>",
            error_message="XSS attempt detected",
            client_id="malicious_client",
        )

        log_content = self.log_file.read_text()
        assert "input_validation_failure" in log_content
        assert "xss_attempt" in log_content
        assert "create_spec" in log_content

    def test_rate_limit_logging(self):
        """Test logging of rate limit violations."""
        self.audit_logger.log_rate_limit_exceeded(
            client_id="abusive_client",
            operation_type="create_spec",
            limit_type="operation_limit",
            retry_after=60,
        )

        log_content = self.log_file.read_text()
        assert "rate_limit_exceeded" in log_content
        assert "abusive_client" in log_content

    def test_sensitive_data_logging(self):
        """Test logging of sensitive data detection."""
        self.audit_logger.log_sensitive_data_detected(
            data_types=["email", "phone"],
            confidence=0.95,
            operation_type="add_user_story",
            client_id="test_client",
        )

        log_content = self.log_file.read_text()
        assert "sensitive_data_detected" in log_content
        assert "email" in log_content
        assert "phone" in log_content

    def test_security_statistics(self):
        """Test security statistics collection."""
        # Generate some events
        for i in range(5):
            self.audit_logger.log_security_event(
                event_type=SecurityEventType.OPERATION_COMPLETED,
                severity=SecurityEventSeverity.INFO,
                message=f"Operation {i} completed",
            )

        stats = self.audit_logger.get_security_stats()
        assert stats["total_events"] >= 5
        assert "events_by_type" in stats
        assert "events_by_severity" in stats

    def test_log_file_rotation(self):
        """Test that log files are rotated when they get too large."""
        # This would be a more complex test in practice
        # For now, just verify the logging system can handle it
        large_message = "A" * 1000

        for i in range(1000):  # Generate many events
            self.audit_logger.log_security_event(
                event_type=SecurityEventType.SECURITY_ALERT,
                severity=SecurityEventSeverity.INFO,
                message=f"Event {i}: {large_message}",
            )

        # Should still be able to log
        assert self.log_file.exists()


class TestIntegratedSecurity:
    """Test integrated security functionality."""

    def setup_method(self):
        self.temp_dir = Path(tempfile.mkdtemp())
        self.path_handler = SecurePathHandler(self.temp_dir, self.temp_dir / "specs")
        self.file_ops = SecureFileOperations(self.path_handler)
        self.audit_logger = SecurityAuditLogger(self.temp_dir / "security.log")
        self.validator = InputValidator()
        self.rate_limiter = RateLimiter(RateLimitConfig())

    def teardown_method(self):
        import shutil

        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_end_to_end_security_flow(self):
        """Test complete security flow from input to file operations."""
        # Simulate a create spec operation
        operation_params = {
            "name": "Test Specification",
            "description": "A test specification for security testing",
            "spec_id": "security-test",
        }

        # 1. Input validation
        validated_params = self.validator.validate_operation_params(
            "create_spec", operation_params
        )
        assert validated_params is not None

        # 2. Rate limiting check
        client_id = "test_client"
        self.rate_limiter.check_rate_limit(client_id, "create_spec")

        # 3. Secure path validation
        spec_path = self.path_handler.validate_specification_path(
            validated_params["spec_id"], "spec.json"
        )

        # 4. Secure file operations
        spec_data = {
            "name": validated_params["name"],
            "description": validated_params["description"],
            "created_at": datetime.now().isoformat(),
        }

        self.file_ops.write_json_safely(spec_path, spec_data)

        # 5. Audit logging
        self.audit_logger.log_operation_security_event(
            operation_type="create_spec",
            event_type=SecurityEventType.OPERATION_COMPLETED,
            client_id=client_id,
            success=True,
            operation_details={"spec_id": validated_params["spec_id"]},
        )

        # Verify end result
        assert spec_path.exists()
        loaded_data = self.file_ops.read_json_safely(spec_path)
        assert loaded_data["name"] == operation_params["name"]

    def test_malicious_operation_blocking(self):
        """Test that malicious operations are properly blocked."""
        # Attempt directory traversal
        malicious_params = {
            "name": "Innocent Name",
            "description": "Innocent description",
            "spec_id": "../../../etc/passwd",
        }

        # Should fail at input validation
        with pytest.raises(ValidationError):
            self.validator.validate_operation_params("create_spec", malicious_params)

        # Log the security violation
        self.audit_logger.log_input_validation_failure(
            operation_type="create_spec",
            field="spec_id",
            value=malicious_params["spec_id"],
            error_message="Path traversal attempt detected",
        )

        # Verify logging occurred
        log_content = (self.temp_dir / "security.log").read_text()
        assert "path_traversal_attempt" in log_content

    def test_rate_limiting_integration(self):
        """Test rate limiting integration with other security measures."""
        client_id = "rapid_client"

        # Make many requests rapidly
        successful_requests = 0
        rate_limited_requests = 0

        for i in range(20):
            try:
                self.rate_limiter.check_rate_limit(client_id, "heartbeat")
                successful_requests += 1
            except RateLimitExceeded:
                rate_limited_requests += 1

                # Log rate limit violation
                self.audit_logger.log_rate_limit_exceeded(
                    client_id=client_id,
                    operation_type="heartbeat",
                    limit_type="burst_limit",
                    retry_after=10,
                )

        # Should have some successful and some rate limited
        assert successful_requests > 0
        assert rate_limited_requests > 0

        # Check audit log
        log_content = (self.temp_dir / "security.log").read_text()
        assert "rate_limit_exceeded" in log_content


# Attack scenario tests
class TestAttackScenarios:
    """Test various attack scenarios to ensure security measures are effective."""

    def setup_method(self):
        self.temp_dir = Path(tempfile.mkdtemp())
        self.validator = InputValidator()
        self.path_handler = SecurePathHandler(self.temp_dir, self.temp_dir / "specs")
        self.rate_limiter = RateLimiter(RateLimitConfig(requests_per_minute=10))

    def teardown_method(self):
        import shutil

        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_sql_injection_attack(self):
        """Test SQL injection attack scenarios."""
        sql_payloads = [
            "'; DROP TABLE specifications; --",
            "' OR '1'='1' --",
            "'; INSERT INTO admin (user) VALUES ('hacker'); --",
            "' UNION SELECT * FROM users --",
        ]

        for payload in sql_payloads:
            with pytest.raises(ValidationError, match="injection"):
                self.validator.validate_operation_params(
                    "create_spec", {"name": payload, "description": "test"}
                )

    def test_xss_attack_scenarios(self):
        """Test XSS attack scenarios."""
        xss_payloads = [
            "<script>alert('XSS')</script>",
            "javascript:alert('XSS')",
            "<img src=x onerror=alert('XSS')>",
            "<iframe src='javascript:alert(\"XSS\")'></iframe>",
            "javascript:/*--></title></style></textarea></script></xmp>",
        ]

        for payload in xss_payloads:
            with pytest.raises(ValidationError, match="injection"):
                self.validator.validate_operation_params(
                    "add_user_story",
                    {
                        "spec_id": "test",
                        "as_a": payload,
                        "i_want": "test",
                        "so_that": "test",
                    },
                )

    def test_path_traversal_attacks(self):
        """Test path traversal attack scenarios."""
        traversal_payloads = [
            "../../../etc/passwd",
            "..\\..\\..\\windows\\system32\\config\\sam",
            "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",
            "....//....//....//etc//passwd",
            "..%c0%af..%c0%af..%c0%afetc%c0%afpasswd",
        ]

        for payload in traversal_payloads:
            with pytest.raises((ValidationError, PathSecurityError)):
                # Try both input validation and path validation
                try:
                    self.validator.validate_operation_params(
                        "delete_spec", {"spec_id": payload}
                    )
                except ValidationError:
                    raise

                # If input validation doesn't catch it, path validation should
                self.path_handler.validate_specification_path(payload)

    def test_command_injection_attacks(self):
        """Test command injection attack scenarios."""
        command_payloads = [
            "; rm -rf /",
            "| cat /etc/passwd",
            "&& whoami",
            "`cat /etc/passwd`",
            "$(cat /etc/passwd)",
        ]

        for payload in command_payloads:
            with pytest.raises(ValidationError, match="injection"):
                self.validator.validate_operation_params(
                    "update_requirements",
                    {
                        "spec_id": "test",
                        "content": f"Innocent content {payload}",
                    },
                )

    def test_dos_attack_scenarios(self):
        """Test denial of service attack scenarios."""
        client_id = "attacker"

        # Rapid request attack
        blocked_count = 0
        for i in range(100):  # Many rapid requests
            try:
                self.rate_limiter.check_rate_limit(client_id, "create_spec")
            except RateLimitExceeded:
                blocked_count += 1

        # Should have blocked most requests
        assert blocked_count > 80

        # Memory exhaustion attack (large payload)
        huge_payload = "A" * (10 * 1024 * 1024)  # 10MB

        with pytest.raises(ValidationError, match="exceeds maximum size"):
            self.validator.validate_operation_params(
                "update_requirements",
                {"spec_id": "test", "content": huge_payload},
            )

    def test_privilege_escalation_attempts(self):
        """Test privilege escalation attempt scenarios."""
        # Attempt to access admin operations without proper authorization
        admin_operations = [
            "../../admin/delete_all_specs",
            "/admin/reset_system",
            "admin.exe",
            "sudo rm -rf",
        ]

        for attempt in admin_operations:
            with pytest.raises((ValidationError, PathSecurityError)):
                # Should be blocked at input validation or path validation
                self.validator.validate_operation_params(
                    "delete_spec", {"spec_id": attempt}
                )

    def test_data_exfiltration_attempts(self):
        """Test data exfiltration attempt scenarios."""
        exfiltration_attempts = [
            "../../../../../../etc/passwd",
            "C:\\Windows\\System32\\config\\SAM",
            "/proc/self/environ",
            "~/.ssh/id_rsa",
        ]

        for attempt in exfiltration_attempts:
            with pytest.raises((ValidationError, PathSecurityError)):
                if "../" in attempt or "\\" in attempt or attempt.startswith("/"):
                    # Path traversal should be caught
                    self.path_handler.validate_specification_path(attempt)
                else:
                    # Input validation should catch suspicious patterns
                    self.validator.validate_operation_params(
                        "set_current_spec", {"spec_id": attempt}
                    )


if __name__ == "__main__":
    # Run the security test suite
    pytest.main([__file__, "-v", "--tb=short"])
