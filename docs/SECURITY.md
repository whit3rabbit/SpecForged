# SpecForge Security Guide

This document provides comprehensive security guidelines for the SpecForge MCP ecosystem, including security features, best practices, and threat mitigation strategies.

## 🔒 Security Overview

SpecForge implements a multi-layered security approach to protect against common threats:

- **Input Validation & Sanitization**: Prevents injection attacks and malformed data
- **Path Security**: Prevents directory traversal and unauthorized file access
- **Rate Limiting**: Protects against DoS attacks and abuse
- **Secure File Operations**: Atomic operations with proper permissions
- **Data Privacy Protection**: Sensitive data detection and sanitization
- **Audit Logging**: Comprehensive security event tracking
- **Client-Side Security**: VS Code extension security controls

## 🛡️ Security Features

### 1. Input Validation Framework

**Location**: `src/specforged/security/input_validator.py`

The input validation framework provides:

- **Schema-based validation** for all MCP operations
- **Injection pattern detection** (SQL, XSS, Command, Path Traversal)
- **Size limit enforcement** to prevent memory exhaustion
- **Type checking and format validation**
- **Sanitization** of user inputs

**Example Usage**:
```python
from src.specforged.security import InputValidator

validator = InputValidator()
validated_params = validator.validate_operation_params(
    operation_type="create_spec",
    params={"name": "My Spec", "description": "Test spec"}
)
```

**Validation Rules**:
- Spec IDs: lowercase alphanumeric with hyphens, max 50 chars
- Names: max 1KB, HTML escaped, injection-checked
- Content: max 1MB, injection-checked
- Task numbers: format `\d+(\.\d+)*`

### 2. Path Security System

**Location**: `src/specforged/security/path_security.py`

Prevents directory traversal and ensures safe file operations:

- **Path normalization** with symlink resolution
- **Traversal attack prevention** (`../`, `..\\`, encoded variants)
- **Whitelist-based directory access** 
- **Safe filename validation**
- **Secure temporary file creation**

**Example Usage**:
```python
from src.specforged.security import SecurePathHandler

handler = SecurePathHandler(project_root, specs_dir)
safe_path = handler.validate_specification_path("my-spec", "requirements.md")
```

**Blocked Patterns**:
- `../`, `..\\` (parent directory access)
- Absolute paths (`/`, `C:\\`)
- Null bytes, control characters
- Dangerous extensions (`.exe`, `.bat`, `.scr`)

### 3. Rate Limiting System

**Location**: `src/specforged/security/rate_limiter.py`

Protects against abuse and DoS attacks:

- **Token bucket algorithm** for burst handling
- **Sliding window** for sustained rate tracking
- **Operation-specific limits** (e.g., 10 spec creations/hour)
- **Progressive penalties** with exponential backoff
- **Automatic client banning** for repeated violations

**Configuration**:
```python
config = RateLimitConfig(
    requests_per_minute=60,
    burst_limit=10,
    operation_limits={
        "create_spec": 10,
        "delete_spec": 5,  # More restrictive for destructive operations
    },
    auto_ban_threshold=10,
    ban_duration_seconds=3600
)
```

### 4. Secure File Operations

**Location**: `src/specforged/security/secure_file_ops.py`

Provides atomic, secure file operations:

- **Atomic writes** via temporary files and atomic moves
- **File locking** to prevent race conditions
- **Secure permissions** (0o644 for files, 0o755 for dirs)
- **Secure deletion** with overwriting for sensitive files
- **Size limits** and validation

**Example Usage**:
```python
from src.specforged.security import SecureFileOperations

file_ops = SecureFileOperations(path_handler)
file_ops.write_file_safely(file_path, content, create_backup=True)
```

### 5. Data Privacy Protection

**Location**: `src/specforged/security/data_sanitizer.py`

Detects and protects sensitive data:

- **Pattern-based detection** of PII, credentials, keys
- **Confidence scoring** for detection accuracy
- **Data sanitization** for logs and external communication
- **Anonymization** with consistent pseudonyms
- **Privacy risk assessment**

**Detected Data Types**:
- Email addresses, phone numbers, SSNs
- API keys, tokens, passwords, private keys
- Credit card numbers, IP addresses
- Personal names, addresses

### 6. Security Audit Logging

**Location**: `src/specforged/security/audit_logger.py`

Comprehensive security event logging:

- **Structured logging** in JSON format
- **Event classification** by type and severity
- **Automatic alerting** for critical events
- **Log rotation** to prevent disk exhaustion
- **Search and reporting** capabilities

**Event Types**:
- Authentication & authorization events
- Input validation failures & injection attempts
- File system security violations
- Rate limiting & DoS protection
- Data privacy events
- System security alerts

## 🏗️ VS Code Extension Security

### Client-Side Validation

**Location**: `vscode-specforged/src/security/`

The VS Code extension provides first-line security:

- **Input validation** before sending to MCP server
- **Rate limiting** for user operations
- **Security event monitoring** and alerts
- **Configuration-based security policies**

### Security Configuration

Add to VS Code `settings.json`:

```json
{
  "specforge.security.enableInputValidation": true,
  "specforge.security.enableRateLimiting": true,
  "specforge.security.enableAuditLogging": true,
  "specforge.security.maxOperationsPerMinute": 60,
  "specforge.security.maxConcurrentOperations": 5,
  "specforge.security.blockSuspiciousActivity": true,
  "specforge.security.alertOnSecurityEvents": true
}
```

### Security Commands

- `SpecForge: View Security Events` - View security monitoring dashboard
- `SpecForge: Open Security Settings` - Configure security policies
- `SpecForge: Reset Security State` - Clear rate limits and violations

## 🚨 Threat Model & Mitigation

### 1. Injection Attacks

**Threats**:
- SQL injection via operation parameters
- XSS through user-provided content
- Command injection in file paths/names
- Path traversal attacks

**Mitigations**:
- Comprehensive input validation with pattern matching
- HTML escaping and sanitization
- Parameterized operations (no direct string concatenation)
- Path normalization and whitelist validation

### 2. Denial of Service (DoS)

**Threats**:
- Rate-based flooding attacks
- Memory exhaustion via large payloads
- Resource exhaustion through concurrent operations

**Mitigations**:
- Multi-tier rate limiting (global, per-client, per-operation)
- Size limits on all inputs
- Concurrent operation limits
- Automatic client banning for abuse

### 3. Unauthorized File Access

**Threats**:
- Directory traversal attacks
- Access to system files outside project scope
- Symlink-based attacks
- Privilege escalation via file operations

**Mitigations**:
- Strict path validation with traversal prevention
- Whitelist-based directory access control
- Symlink resolution and validation
- Secure file permissions (644/755)

### 4. Data Privacy Breaches

**Threats**:
- Sensitive data in logs or error messages  
- PII exposure through operation parameters
- Credential leakage in configuration

**Mitigations**:
- Automatic sensitive data detection
- Log sanitization with pattern matching
- Privacy risk assessment
- Anonymization with consistent pseudonyms

### 5. System Compromise

**Threats**:
- Malicious file uploads
- Code execution via crafted inputs
- Configuration tampering

**Mitigations**:
- File extension restrictions
- Input validation prevents code injection
- Secure file permissions
- Comprehensive audit logging

## 🔧 Configuration

### Security Configuration File

Create `security_config.yaml`:

```yaml
input_validation:
  enable: true
  max_content_size: 1048576  # 1MB
  max_name_size: 1024        # 1KB
  injection_detection: true
  
rate_limiting:
  enable: true
  requests_per_minute: 60
  burst_limit: 10
  operation_limits:
    create_spec: 10
    update_requirements: 100
    delete_spec: 5
  auto_ban_threshold: 10
  ban_duration: 3600

path_security:
  enable: true
  allowed_extensions: [".md", ".json", ".yaml", ".txt"]
  forbidden_extensions: [".exe", ".bat", ".cmd", ".scr"]
  max_path_length: 260

file_operations:
  enable_atomic_writes: true
  create_backups: true
  secure_permissions: true
  secure_deletion: true

audit_logging:
  enable: true
  log_level: "INFO"
  max_file_size: 104857600  # 100MB
  backup_count: 10
  alert_on_critical: true

data_privacy:
  enable_detection: true
  enable_sanitization: true
  anonymization_mode: "pseudonym"  # or "redact"
  confidence_threshold: 0.8
```

### Environment Variables

```bash
# Security settings
SPECFORGE_SECURITY_STRICT_MODE=true
SPECFORGE_SECURITY_AUDIT_LOG=/path/to/security.log
SPECFORGE_SECURITY_MAX_FILE_SIZE=1048576
SPECFORGE_SECURITY_RATE_LIMIT_RPM=60

# Development/testing
SPECFORGE_SECURITY_BYPASS_VALIDATION=false  # Never set to true in production!
SPECFORGE_SECURITY_DEBUG_MODE=false
```

## 🧪 Security Testing

### Running Security Tests

```bash
# Run all security tests
python -m pytest tests/test_security.py -v

# Run specific test categories
python -m pytest tests/test_security.py::TestInputValidation -v
python -m pytest tests/test_security.py::TestAttackScenarios -v

# Run with coverage
python -m pytest tests/test_security.py --cov=src/specforged/security --cov-report=html
```

### Security Test Categories

1. **Input Validation Tests**: Injection attacks, malformed data, size limits
2. **Path Security Tests**: Directory traversal, dangerous filenames
3. **Rate Limiting Tests**: DoS attacks, client banning, recovery
4. **File Security Tests**: Atomic operations, permissions, deletion
5. **Data Privacy Tests**: Sensitive data detection, anonymization
6. **Audit Logging Tests**: Event logging, statistics, rotation
7. **Attack Scenarios**: End-to-end attack simulation

### Manual Security Testing

```python
# Test injection detection
from src.specforged.security import InputValidator

validator = InputValidator()

# These should raise ValidationError
test_payloads = [
    "'; DROP TABLE users; --",
    "<script>alert('xss')</script>",
    "../../../etc/passwd",
    "| rm -rf /"
]

for payload in test_payloads:
    try:
        validator.validate_operation_params("create_spec", {"name": payload})
        print(f"❌ FAILED: {payload} was not blocked")
    except ValidationError:
        print(f"✅ BLOCKED: {payload}")
```

## 📊 Security Monitoring

### Real-Time Monitoring

1. **Security Dashboard**: View security events and statistics
2. **Alert System**: Immediate notifications for critical events
3. **Rate Limit Monitoring**: Track client behavior and violations
4. **Privacy Risk Assessment**: Monitor sensitive data exposure

### Log Analysis

Security logs are in JSON format for easy parsing:

```json
{
  "timestamp": "2024-01-15T10:30:45.123Z",
  "level": "ERROR", 
  "security_event": {
    "event_type": "injection_attempt",
    "severity": "error",
    "client_id": "suspicious_client",
    "message": "SQL injection attempt detected",
    "details": {
      "operation": "create_spec",
      "field": "name",
      "threat_indicators": ["sql_injection_attempt"]
    }
  }
}
```

### Metrics and Reporting

- **Security Events by Type/Severity**: Track attack patterns
- **Client Behavior Analysis**: Identify suspicious clients
- **Rate Limiting Statistics**: Monitor system load and abuse
- **Privacy Risk Trends**: Track sensitive data exposure

## 🚀 Best Practices

### For Developers

1. **Always validate input** at both client and server levels
2. **Use parameterized operations** instead of string concatenation  
3. **Implement proper error handling** without information disclosure
4. **Log security events** with appropriate detail levels
5. **Regular security testing** with automated and manual approaches

### For Operators

1. **Monitor security logs** regularly for suspicious activity
2. **Configure appropriate rate limits** based on usage patterns
3. **Keep audit logs** for compliance and incident response
4. **Regular security assessments** of deployed systems
5. **Incident response procedures** for security events

### For Users

1. **Keep extensions updated** for latest security fixes
2. **Review security settings** and configure appropriately
3. **Report suspicious behavior** through proper channels
4. **Don't include sensitive data** in specifications unnecessarily
5. **Use secure authentication** methods where available

## 🔄 Security Updates

### Staying Current

- Monitor security advisories for dependencies
- Subscribe to security mailing lists for MCP ecosystem
- Regular dependency updates and vulnerability scanning
- Automated security testing in CI/CD pipelines

### Reporting Security Issues

To report security vulnerabilities:

1. **Do not** create public GitHub issues for security problems
2. Email security reports to: security@specforge.dev
3. Include detailed reproduction steps and impact assessment
4. Allow reasonable time for fix development and testing
5. Coordinate disclosure timing with maintainers

### Security Release Process

1. **Assessment**: Evaluate severity and impact
2. **Fix Development**: Create and test security patches
3. **Testing**: Comprehensive security testing of fixes
4. **Release**: Coordinated release with security advisory
5. **Communication**: Clear communication about impact and mitigations

## 📚 Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/) - Web application security risks
- [CWE Common Weakness Enumeration](https://cwe.mitre.org/) - Software weakness classification
- [NIST Cybersecurity Framework](https://www.nist.gov/cyberframework) - Security best practices
- [MCP Security Guidelines](https://modelcontextprotocol.io/security) - MCP-specific security considerations

---

**Note**: Security is an ongoing process, not a one-time implementation. Regular review and updates of security measures are essential for maintaining system integrity and user trust.