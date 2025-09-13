"""
Data sanitization and privacy protection utilities for SpecForge.

This module provides comprehensive data sanitization, sensitive data detection,
and privacy protection features to ensure user data is handled securely.
"""

import re
import logging
import hashlib
import uuid
from typing import Any, Dict, List, Optional, Pattern, Set, Tuple, Union
from dataclasses import dataclass
from enum import Enum
import json


class DataPrivacyError(Exception):
    """Raised when data privacy operations fail."""

    pass


class SensitiveDataType(Enum):
    """Types of sensitive data that should be protected."""

    EMAIL = "email"
    PHONE = "phone"
    SSN = "ssn"
    CREDIT_CARD = "credit_card"
    IP_ADDRESS = "ip_address"
    API_KEY = "api_key"
    PASSWORD = "password"
    TOKEN = "token"
    SECRET = "secret"
    PRIVATE_KEY = "private_key"
    PERSONAL_NAME = "personal_name"
    ADDRESS = "address"
    DATE_OF_BIRTH = "date_of_birth"
    FINANCIAL_INFO = "financial_info"


@dataclass
class SensitivePattern:
    """Configuration for a sensitive data pattern."""

    pattern: Pattern[str]
    data_type: SensitiveDataType
    confidence: float  # 0.0 to 1.0
    replacement: str
    description: str


class SensitiveDataDetector:
    """Detects sensitive data in text using pattern matching and heuristics."""

    def __init__(self):
        """Initialize sensitive data detector with patterns."""
        self.patterns: List[SensitivePattern] = []
        self.logger = logging.getLogger(__name__)
        self._initialize_patterns()

    def _initialize_patterns(self):
        """Initialize detection patterns for various sensitive data types."""

        # Email addresses
        self.patterns.append(
            SensitivePattern(
                pattern=re.compile(
                    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"
                ),
                data_type=SensitiveDataType.EMAIL,
                confidence=0.95,
                replacement="[EMAIL]",
                description="Email address",
            )
        )

        # Phone numbers (various formats)
        phone_patterns = [
            r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b",  # US format
            r"\b\(\d{3}\)\s?\d{3}[-.\s]?\d{4}\b",  # (555) 123-4567
            r"\b\+\d{1,3}\s?\d{1,14}\b",  # International
        ]
        for pattern in phone_patterns:
            self.patterns.append(
                SensitivePattern(
                    pattern=re.compile(pattern),
                    data_type=SensitiveDataType.PHONE,
                    confidence=0.85,
                    replacement="[PHONE]",
                    description="Phone number",
                )
            )

        # SSN (US Social Security Number)
        self.patterns.append(
            SensitivePattern(
                pattern=re.compile(r"\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b"),
                data_type=SensitiveDataType.SSN,
                confidence=0.80,
                replacement="[SSN]",
                description="Social Security Number",
            )
        )

        # Credit card numbers (basic patterns)
        cc_patterns = [
            r"\b4\d{3}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b",  # Visa
            r"\b5[1-5]\d{2}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b",  # MasterCard
            r"\b3[47]\d{2}[-\s]?\d{6}[-\s]?\d{5}\b",  # American Express
        ]
        for pattern in cc_patterns:
            self.patterns.append(
                SensitivePattern(
                    pattern=re.compile(pattern),
                    data_type=SensitiveDataType.CREDIT_CARD,
                    confidence=0.90,
                    replacement="[CREDIT_CARD]",
                    description="Credit card number",
                )
            )

        # IP addresses
        ip_patterns = [
            r"\b(?:\d{1,3}\.){3}\d{1,3}\b",  # IPv4
            r"\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b",  # IPv6 (simplified)
        ]
        for pattern in ip_patterns:
            self.patterns.append(
                SensitivePattern(
                    pattern=re.compile(pattern),
                    data_type=SensitiveDataType.IP_ADDRESS,
                    confidence=0.75,
                    replacement="[IP_ADDRESS]",
                    description="IP address",
                )
            )

        # API keys and tokens (common patterns)
        api_patterns = [
            (r'api[_-]?key[\'"\s]*[=:][\'"\s]*[a-zA-Z0-9]{20,}', "API key"),
            (
                r'access[_-]?token[\'"\s]*[=:][\'"\s]*[a-zA-Z0-9._-]{20,}',
                "Access token",
            ),
            (r"bearer\s+[a-zA-Z0-9._-]{20,}", "Bearer token"),
            (r"sk-[a-zA-Z0-9]{32,}", "Secret key (OpenAI-style)"),
            (r"xoxb-[0-9]{12}-[0-9]{12}-[a-zA-Z0-9]{24}", "Slack bot token"),
        ]
        for pattern_str, desc in api_patterns:
            self.patterns.append(
                SensitivePattern(
                    pattern=re.compile(pattern_str, re.IGNORECASE),
                    data_type=SensitiveDataType.API_KEY,
                    confidence=0.95,
                    replacement="[API_KEY]",
                    description=desc,
                )
            )

        # Passwords (in configuration context)
        password_patterns = [
            r'pass(word)?[\'"\s]*[=:][\'"\s]*[^\s\'"]{6,}',
            r'pwd[\'"\s]*[=:][\'"\s]*[^\s\'"]{6,}',
        ]
        for pattern in password_patterns:
            self.patterns.append(
                SensitivePattern(
                    pattern=re.compile(pattern, re.IGNORECASE),
                    data_type=SensitiveDataType.PASSWORD,
                    confidence=0.85,
                    replacement="[PASSWORD]",
                    description="Password",
                )
            )

        # Private keys
        self.patterns.append(
            SensitivePattern(
                pattern=re.compile(
                    r"-----BEGIN .* PRIVATE KEY-----.*?-----END .* PRIVATE KEY-----",
                    re.DOTALL,
                ),
                data_type=SensitiveDataType.PRIVATE_KEY,
                confidence=1.0,
                replacement="[PRIVATE_KEY]",
                description="Private key",
            )
        )

        # Secrets and tokens (generic)
        secret_patterns = [
            r'secret[\'"\s]*[=:][\'"\s]*[a-zA-Z0-9]{16,}',
            r'token[\'"\s]*[=:][\'"\s]*[a-zA-Z0-9._-]{20,}',
        ]
        for pattern in secret_patterns:
            self.patterns.append(
                SensitivePattern(
                    pattern=re.compile(pattern, re.IGNORECASE),
                    data_type=SensitiveDataType.SECRET,
                    confidence=0.80,
                    replacement="[SECRET]",
                    description="Secret/Token",
                )
            )

    def detect_sensitive_data(self, text: str) -> List[Dict[str, Any]]:
        """
        Detect sensitive data in text.

        Args:
            text: Text to analyze

        Returns:
            List of detected sensitive data items
        """
        detections = []

        for pattern_config in self.patterns:
            matches = pattern_config.pattern.finditer(text)

            for match in matches:
                detection = {
                    "type": pattern_config.data_type.value,
                    "confidence": pattern_config.confidence,
                    "description": pattern_config.description,
                    "start": match.start(),
                    "end": match.end(),
                    "text": match.group(),
                    "replacement": pattern_config.replacement,
                }
                detections.append(detection)

        # Sort by position in text
        detections.sort(key=lambda x: x["start"])

        # Remove overlapping detections (keep highest confidence)
        filtered_detections = []
        for detection in detections:
            # Check if this detection overlaps with any existing one
            overlaps = False
            for existing in filtered_detections:
                if (
                    detection["start"] < existing["end"]
                    and detection["end"] > existing["start"]
                ):
                    # Overlap detected, keep the one with higher confidence
                    if detection["confidence"] > existing["confidence"]:
                        filtered_detections.remove(existing)
                    else:
                        overlaps = True
                    break

            if not overlaps:
                filtered_detections.append(detection)

        return filtered_detections

    def has_sensitive_data(self, text: str, min_confidence: float = 0.8) -> bool:
        """
        Check if text contains sensitive data above confidence threshold.

        Args:
            text: Text to check
            min_confidence: Minimum confidence threshold

        Returns:
            True if sensitive data is detected
        """
        detections = self.detect_sensitive_data(text)
        return any(d["confidence"] >= min_confidence for d in detections)

    def get_sensitive_data_types(
        self, text: str, min_confidence: float = 0.8
    ) -> Set[SensitiveDataType]:
        """
        Get types of sensitive data detected in text.

        Args:
            text: Text to analyze
            min_confidence: Minimum confidence threshold

        Returns:
            Set of detected sensitive data types
        """
        detections = self.detect_sensitive_data(text)
        return {
            SensitiveDataType(d["type"])
            for d in detections
            if d["confidence"] >= min_confidence
        }


class PrivacyProtector:
    """Protects privacy by sanitizing, masking, and anonymizing data."""

    def __init__(self):
        """Initialize privacy protector."""
        self.detector = SensitiveDataDetector()
        self.logger = logging.getLogger(__name__)

        # Cache for consistent pseudonymization
        self._pseudonym_cache: Dict[str, str] = {}

        # Patterns for sensitive field names
        self.sensitive_field_patterns = [
            re.compile(r".*pass(word)?.*", re.IGNORECASE),
            re.compile(r".*secret.*", re.IGNORECASE),
            re.compile(r".*token.*", re.IGNORECASE),
            re.compile(r".*key.*", re.IGNORECASE),
            re.compile(r".*auth.*", re.IGNORECASE),
            re.compile(r".*credential.*", re.IGNORECASE),
            re.compile(r".*email.*", re.IGNORECASE),
            re.compile(r".*phone.*", re.IGNORECASE),
            re.compile(r".*ssn.*", re.IGNORECASE),
        ]

    def sanitize_for_logging(self, data: Any, max_depth: int = 5) -> Any:
        """
        Sanitize data for safe logging by removing/masking sensitive information.

        Args:
            data: Data to sanitize
            max_depth: Maximum recursion depth

        Returns:
            Sanitized data safe for logging
        """
        return self._sanitize_recursive(data, max_depth, 0, for_logging=True)

    def sanitize_for_storage(self, data: Any, max_depth: int = 10) -> Any:
        """
        Sanitize data for storage with less aggressive masking.

        Args:
            data: Data to sanitize
            max_depth: Maximum recursion depth

        Returns:
            Sanitized data safe for storage
        """
        return self._sanitize_recursive(data, max_depth, 0, for_logging=False)

    def _sanitize_recursive(
        self, data: Any, max_depth: int, current_depth: int, for_logging: bool = True
    ) -> Any:
        """Recursively sanitize data structure."""

        if current_depth >= max_depth:
            return "[REDACTED - MAX DEPTH REACHED]"

        if isinstance(data, dict):
            sanitized = {}
            for key, value in data.items():
                if self._is_sensitive_field_name(key):
                    # Always redact sensitive field names
                    sanitized[key] = "[REDACTED]"
                elif isinstance(value, (dict, list, tuple)):
                    sanitized[key] = self._sanitize_recursive(
                        value, max_depth, current_depth + 1, for_logging
                    )
                elif isinstance(value, str):
                    sanitized[key] = self._sanitize_string(value, for_logging)
                else:
                    sanitized[key] = value
            return sanitized

        elif isinstance(data, list):
            return [
                self._sanitize_recursive(
                    item, max_depth, current_depth + 1, for_logging
                )
                for item in data
            ]

        elif isinstance(data, tuple):
            return tuple(
                self._sanitize_recursive(
                    item, max_depth, current_depth + 1, for_logging
                )
                for item in data
            )

        elif isinstance(data, str):
            return self._sanitize_string(data, for_logging)

        else:
            return data

    def _sanitize_string(self, text: str, for_logging: bool = True) -> str:
        """Sanitize a string value."""
        if len(text) > 10000:  # Very long strings
            text = text[:5000] + "... [TRUNCATED] ..." + text[-100:]

        # Detect sensitive data
        detections = self.detector.detect_sensitive_data(text)

        if not detections:
            return text

        # Replace sensitive data (work backwards to preserve indices)
        sanitized = text
        for detection in reversed(detections):
            start, end = detection["start"], detection["end"]

            if for_logging:
                # More aggressive masking for logs
                replacement = detection["replacement"]
            else:
                # Preserve some structure for storage
                original = detection["text"]
                if detection["type"] == SensitiveDataType.EMAIL.value:
                    # Keep domain for emails in storage
                    parts = original.split("@")
                    if len(parts) == 2:
                        replacement = f"[MASKED]@{parts[1]}"
                    else:
                        replacement = "[EMAIL]"
                elif detection["type"] == SensitiveDataType.PHONE.value:
                    # Keep last 4 digits for phone numbers
                    digits = re.sub(r"[^\d]", "", original)
                    if len(digits) >= 4:
                        replacement = f"[PHONE-****{digits[-4:]}]"
                    else:
                        replacement = "[PHONE]"
                else:
                    replacement = detection["replacement"]

            sanitized = sanitized[:start] + replacement + sanitized[end:]

        return sanitized

    def _is_sensitive_field_name(self, field_name: str) -> bool:
        """Check if a field name indicates sensitive data."""
        return any(
            pattern.match(field_name) for pattern in self.sensitive_field_patterns
        )

    def create_pseudonym(
        self, original_value: str, data_type: SensitiveDataType
    ) -> str:
        """
        Create a consistent pseudonym for a sensitive value.

        Args:
            original_value: Original sensitive value
            data_type: Type of sensitive data

        Returns:
            Consistent pseudonym
        """
        # Create a stable hash-based pseudonym
        cache_key = f"{data_type.value}:{original_value}"

        if cache_key in self._pseudonym_cache:
            return self._pseudonym_cache[cache_key]

        # Generate deterministic pseudonym
        hash_obj = hashlib.sha256(cache_key.encode())
        hash_hex = hash_obj.hexdigest()

        if data_type == SensitiveDataType.EMAIL:
            pseudonym = f"user{hash_hex[:8]}@example.com"
        elif data_type == SensitiveDataType.PHONE:
            pseudonym = f"555-{hash_hex[:3]}-{hash_hex[3:7]}"
        elif data_type == SensitiveDataType.PERSONAL_NAME:
            # Generate pronounceable pseudonym
            consonants = "bcdfghjklmnpqrstvwxyz"
            vowels = "aeiou"
            name = ""
            for i in range(6):
                if i % 2 == 0:
                    name += consonants[int(hash_hex[i], 16) % len(consonants)]
                else:
                    name += vowels[int(hash_hex[i], 16) % len(vowels)]
            pseudonym = name.capitalize()
        else:
            pseudonym = f"[{data_type.value.upper()}-{hash_hex[:8]}]"

        self._pseudonym_cache[cache_key] = pseudonym
        return pseudonym

    def anonymize_data(self, data: Any) -> Any:
        """
        Anonymize data by replacing sensitive values with pseudonyms.

        Args:
            data: Data to anonymize

        Returns:
            Anonymized data
        """
        return self._anonymize_recursive(data, max_depth=10, current_depth=0)

    def _anonymize_recursive(
        self, data: Any, max_depth: int, current_depth: int
    ) -> Any:
        """Recursively anonymize data structure."""

        if current_depth >= max_depth:
            return "[REDACTED - MAX DEPTH]"

        if isinstance(data, dict):
            anonymized = {}
            for key, value in data.items():
                if isinstance(value, (dict, list)):
                    anonymized[key] = self._anonymize_recursive(
                        value, max_depth, current_depth + 1
                    )
                elif isinstance(value, str):
                    anonymized[key] = self._anonymize_string(value)
                else:
                    anonymized[key] = value
            return anonymized

        elif isinstance(data, list):
            return [
                self._anonymize_recursive(item, max_depth, current_depth + 1)
                for item in data
            ]

        elif isinstance(data, str):
            return self._anonymize_string(data)

        else:
            return data

    def _anonymize_string(self, text: str) -> str:
        """Anonymize sensitive data in a string."""
        detections = self.detector.detect_sensitive_data(text)

        if not detections:
            return text

        # Replace with pseudonyms (work backwards to preserve indices)
        anonymized = text
        for detection in reversed(detections):
            start, end = detection["start"], detection["end"]
            original = detection["text"]
            data_type = SensitiveDataType(detection["type"])

            pseudonym = self.create_pseudonym(original, data_type)
            anonymized = anonymized[:start] + pseudonym + anonymized[end:]

        return anonymized

    def assess_privacy_risk(self, data: Any) -> Dict[str, Any]:
        """
        Assess privacy risk of data.

        Args:
            data: Data to assess

        Returns:
            Privacy risk assessment
        """
        if isinstance(data, str):
            text_to_analyze = data
        else:
            # Convert to JSON string for analysis
            try:
                text_to_analyze = json.dumps(data, default=str, ensure_ascii=False)
            except (TypeError, ValueError):
                text_to_analyze = str(data)

        detections = self.detector.detect_sensitive_data(text_to_analyze)

        # Calculate risk score
        risk_weights = {
            SensitiveDataType.PRIVATE_KEY: 10,
            SensitiveDataType.PASSWORD: 9,
            SensitiveDataType.API_KEY: 8,
            SensitiveDataType.SECRET: 8,
            SensitiveDataType.TOKEN: 7,
            SensitiveDataType.SSN: 9,
            SensitiveDataType.CREDIT_CARD: 9,
            SensitiveDataType.EMAIL: 5,
            SensitiveDataType.PHONE: 5,
            SensitiveDataType.IP_ADDRESS: 3,
            SensitiveDataType.PERSONAL_NAME: 4,
            SensitiveDataType.ADDRESS: 6,
            SensitiveDataType.DATE_OF_BIRTH: 7,
            SensitiveDataType.FINANCIAL_INFO: 8,
        }

        total_risk = 0
        detected_types = set()
        high_confidence_detections = 0

        for detection in detections:
            data_type = SensitiveDataType(detection["type"])
            confidence = detection["confidence"]

            # Weight by confidence and type
            risk_contribution = risk_weights.get(data_type, 5) * confidence
            total_risk += risk_contribution

            detected_types.add(data_type)

            if confidence >= 0.9:
                high_confidence_detections += 1

        # Normalize risk score to 0-100 scale
        max_possible_risk = len(detections) * 10
        normalized_risk = min(
            100, (total_risk / max_possible_risk * 100) if max_possible_risk > 0 else 0
        )

        # Determine risk level
        if normalized_risk >= 80:
            risk_level = "CRITICAL"
        elif normalized_risk >= 60:
            risk_level = "HIGH"
        elif normalized_risk >= 40:
            risk_level = "MEDIUM"
        elif normalized_risk >= 20:
            risk_level = "LOW"
        else:
            risk_level = "MINIMAL"

        return {
            "risk_score": round(normalized_risk, 2),
            "risk_level": risk_level,
            "total_detections": len(detections),
            "high_confidence_detections": high_confidence_detections,
            "detected_types": [dt.value for dt in detected_types],
            "recommendations": self._get_privacy_recommendations(
                detected_types, risk_level
            ),
            "detections": [
                {
                    "type": d["type"],
                    "confidence": d["confidence"],
                    "description": d["description"],
                }
                for d in detections
            ],
        }

    def _get_privacy_recommendations(
        self, detected_types: Set[SensitiveDataType], risk_level: str
    ) -> List[str]:
        """Generate privacy recommendations based on detected sensitive data."""
        recommendations = []

        if risk_level in ["CRITICAL", "HIGH"]:
            recommendations.append(
                "Immediate action required: Remove or encrypt sensitive data"
            )

        if SensitiveDataType.PRIVATE_KEY in detected_types:
            recommendations.append(
                "Private keys detected: Store in secure key management system"
            )

        if SensitiveDataType.PASSWORD in detected_types:
            recommendations.append("Passwords detected: Use secure password hashing")

        if SensitiveDataType.API_KEY in detected_types:
            recommendations.append(
                "API keys detected: Store in environment variables or vault"
            )

        if any(
            dt in detected_types
            for dt in [SensitiveDataType.SSN, SensitiveDataType.CREDIT_CARD]
        ):
            recommendations.append(
                "PII detected: Implement data encryption and access controls"
            )

        if SensitiveDataType.EMAIL in detected_types:
            recommendations.append(
                "Email addresses detected: Consider pseudonymization for analytics"
            )

        if not recommendations:
            recommendations.append("Consider data minimization and retention policies")

        return recommendations
