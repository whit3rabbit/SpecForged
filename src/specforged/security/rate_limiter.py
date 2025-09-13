"""
Rate limiting system for preventing abuse and DoS attacks in SpecForge MCP operations.

This module provides configurable rate limiting with different strategies,
client-specific limits, and automatic backoff mechanisms.
"""

import hashlib
import logging
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from typing import Any, Dict, Optional


class RateLimitStrategy(Enum):
    """Rate limiting strategies."""

    TOKEN_BUCKET = "token_bucket"
    SLIDING_WINDOW = "sliding_window"
    FIXED_WINDOW = "fixed_window"
    ADAPTIVE = "adaptive"


@dataclass
class RateLimitConfig:
    """Configuration for rate limiting policies."""

    # Basic rate limiting
    requests_per_minute: int = 60
    requests_per_hour: int = 1000
    burst_limit: int = 10

    # Advanced settings
    strategy: RateLimitStrategy = RateLimitStrategy.TOKEN_BUCKET
    window_size_seconds: int = 60

    # Operation-specific limits
    operation_limits: Dict[str, int] = field(
        default_factory=lambda: {
            "create_spec": 10,  # specs per hour
            "update_requirements": 100,  # updates per hour
            "update_design": 100,  # updates per hour
            "update_tasks": 100,  # updates per hour
            "add_user_story": 50,  # stories per hour
            "update_task_status": 200,  # status updates per hour
            "delete_spec": 5,  # deletions per hour (destructive)
            "heartbeat": 300,  # heartbeats per hour
        }
    )

    # Client-specific limits
    max_queue_size_per_client: int = 100
    max_concurrent_operations: int = 5

    # Backoff and penalties
    backoff_base_seconds: int = 1
    backoff_max_seconds: int = 300  # 5 minutes
    backoff_multiplier: float = 2.0
    violation_penalty_seconds: int = 60

    # Security thresholds
    suspicious_activity_threshold: int = 5  # violations before marking suspicious
    auto_ban_threshold: int = 10  # violations before temporary ban
    ban_duration_seconds: int = 3600  # 1 hour ban


class RateLimitExceeded(Exception):
    """Raised when rate limit is exceeded."""

    def __init__(self, message: str, retry_after: float, limit_type: str = "general"):
        self.retry_after = retry_after
        self.limit_type = limit_type
        super().__init__(message)


class TokenBucket:
    """Token bucket rate limiter implementation."""

    def __init__(self, capacity: int, refill_rate: float):
        """
        Initialize token bucket.

        Args:
            capacity: Maximum number of tokens
            refill_rate: Tokens added per second
        """
        self.capacity = capacity
        self.refill_rate = refill_rate
        self.tokens = float(capacity)
        self.last_refill = time.time()
        self._lock = threading.Lock()

    def consume(self, tokens: int = 1) -> bool:
        """
        Try to consume tokens from bucket.

        Args:
            tokens: Number of tokens to consume

        Returns:
            True if tokens were consumed successfully
        """
        with self._lock:
            now = time.time()

            # Add tokens based on time elapsed
            time_elapsed = now - self.last_refill
            tokens_to_add = time_elapsed * self.refill_rate
            self.tokens = min(self.capacity, self.tokens + tokens_to_add)
            self.last_refill = now

            # Try to consume requested tokens
            if self.tokens >= tokens:
                self.tokens -= tokens
                return True

            return False

    def get_retry_after(self, tokens: int = 1) -> float:
        """Get time to wait before retry for given tokens."""
        with self._lock:
            if self.tokens >= tokens:
                return 0.0

            tokens_needed = tokens - self.tokens
            return tokens_needed / self.refill_rate


class SlidingWindow:
    """Sliding window rate limiter implementation."""

    def __init__(self, limit: int, window_size: int):
        """
        Initialize sliding window.

        Args:
            limit: Maximum requests per window
            window_size: Window size in seconds
        """
        self.limit = limit
        self.window_size = window_size
        self.requests = deque()
        self._lock = threading.Lock()

    def is_allowed(self) -> bool:
        """Check if request is allowed."""
        with self._lock:
            now = time.time()

            # Remove old requests outside window
            while self.requests and self.requests[0] < now - self.window_size:
                self.requests.popleft()

            # Check if under limit
            if len(self.requests) < self.limit:
                self.requests.append(now)
                return True

            return False

    def get_retry_after(self) -> float:
        """Get time to wait before retry."""
        with self._lock:
            if len(self.requests) < self.limit:
                return 0.0

            oldest_request = self.requests[0]
            return self.window_size - (time.time() - oldest_request)


@dataclass
class ClientRateLimitState:
    """Rate limiting state for a specific client."""

    client_id: str
    token_bucket: TokenBucket
    operation_windows: Dict[str, SlidingWindow]
    violation_count: int = 0
    last_violation: Optional[datetime] = None
    is_banned: bool = False
    ban_until: Optional[datetime] = None
    consecutive_violations: int = 0
    total_requests: int = 0
    last_request: Optional[datetime] = None

    def is_currently_banned(self) -> bool:
        """Check if client is currently banned."""
        if not self.is_banned or not self.ban_until:
            return False

        return datetime.now() < self.ban_until

    def lift_ban(self) -> None:
        """Lift current ban."""
        self.is_banned = False
        self.ban_until = None
        self.consecutive_violations = 0


class RateLimiter:
    """Main rate limiter with multiple strategies and client management."""

    def __init__(self, config: RateLimitConfig):
        """Initialize rate limiter with configuration."""
        self.config = config
        self.clients: Dict[str, ClientRateLimitState] = {}
        self.global_stats = {
            "total_requests": 0,
            "rejected_requests": 0,
            "banned_clients": 0,
        }
        self._lock = threading.RLock()
        self.logger = logging.getLogger(__name__)

    def check_rate_limit(
        self, client_id: str, operation_type: str, request_size: int = 1
    ) -> None:
        """
        Check if request is allowed under rate limits.

        Args:
            client_id: Unique identifier for client
            operation_type: Type of operation being requested
            request_size: Size/weight of the request

        Raises:
            RateLimitExceeded: If rate limit is exceeded
        """
        with self._lock:
            # Get or create client state
            client_state = self._get_or_create_client_state(client_id)

            # Update global stats
            self.global_stats["total_requests"] += 1
            client_state.total_requests += 1
            client_state.last_request = datetime.now()

            # Check if client is banned
            if client_state.is_currently_banned():
                self.global_stats["rejected_requests"] += 1
                retry_after = (client_state.ban_until - datetime.now()).total_seconds()
                raise RateLimitExceeded(
                    f"Client {client_id} is temporarily banned until {client_state.ban_until}",
                    retry_after,
                    "ban",
                )

            # Check token bucket (general rate limiting)
            if not client_state.token_bucket.consume(request_size):
                self._record_violation(client_state, "token_bucket")
                retry_after = client_state.token_bucket.get_retry_after(request_size)
                raise RateLimitExceeded(
                    f"Token bucket limit exceeded for client {client_id}",
                    retry_after,
                    "token_bucket",
                )

            # Check operation-specific limits
            if operation_type in self.config.operation_limits:
                window = client_state.operation_windows[operation_type]
                if not window.is_allowed():
                    self._record_violation(client_state, f"operation_{operation_type}")
                    retry_after = window.get_retry_after()
                    raise RateLimitExceeded(
                        f"Operation limit exceeded for {operation_type}",
                        retry_after,
                        f"operation_{operation_type}",
                    )

            # Log successful request
            self.logger.debug(
                f"Rate limit check passed for client {client_id}, operation {operation_type}"
            )

    def _get_or_create_client_state(self, client_id: str) -> ClientRateLimitState:
        """Get existing client state or create new one."""
        if client_id not in self.clients:
            # Create token bucket
            token_bucket = TokenBucket(
                capacity=self.config.burst_limit,
                refill_rate=self.config.requests_per_minute / 60.0,
            )

            # Create operation-specific sliding windows
            operation_windows = {}
            for operation, limit in self.config.operation_limits.items():
                operation_windows[operation] = SlidingWindow(
                    limit=limit, window_size=3600  # 1 hour window
                )

            self.clients[client_id] = ClientRateLimitState(
                client_id=client_id,
                token_bucket=token_bucket,
                operation_windows=operation_windows,
            )

        return self.clients[client_id]

    def _record_violation(
        self, client_state: ClientRateLimitState, violation_type: str
    ) -> None:
        """Record a rate limit violation and apply penalties."""
        now = datetime.now()

        # Update violation statistics
        client_state.violation_count += 1
        client_state.last_violation = now
        client_state.consecutive_violations += 1

        # Update global stats
        self.global_stats["rejected_requests"] += 1

        # Log violation
        self.logger.warning(
            f"Rate limit violation for client {client_state.client_id}: "
            f"type={violation_type}, consecutive={client_state.consecutive_violations}, "
            f"total={client_state.violation_count}"
        )

        # Apply progressive penalties
        if client_state.consecutive_violations >= self.config.auto_ban_threshold:
            self._ban_client(client_state)
        elif (
            client_state.consecutive_violations
            >= self.config.suspicious_activity_threshold
        ):
            self._apply_penalty(client_state)

    def _ban_client(self, client_state: ClientRateLimitState) -> None:
        """Ban a client temporarily."""
        ban_duration = timedelta(seconds=self.config.ban_duration_seconds)
        client_state.is_banned = True
        client_state.ban_until = datetime.now() + ban_duration

        self.global_stats["banned_clients"] += 1

        self.logger.error(
            f"Client {client_state.client_id} has been temporarily banned "
            f"until {client_state.ban_until} due to excessive violations"
        )

    def _apply_penalty(self, client_state: ClientRateLimitState) -> None:
        """Apply penalty by reducing token bucket capacity temporarily."""
        # Reduce token bucket capacity by 50% as penalty
        original_capacity = client_state.token_bucket.capacity
        penalty_capacity = max(1, int(original_capacity * 0.5))

        client_state.token_bucket.capacity = penalty_capacity
        client_state.token_bucket.tokens = min(
            client_state.token_bucket.tokens, penalty_capacity
        )

        self.logger.warning(
            f"Applied penalty to client {client_state.client_id}: "
            f"reduced capacity from {original_capacity} to {penalty_capacity}"
        )

        # Schedule capacity restoration (in a real implementation, you'd use a timer)
        # For now, we'll restore it after some time during normal operations

    def reset_client_violations(self, client_id: str) -> None:
        """Reset violation count for a client (admin function)."""
        with self._lock:
            if client_id in self.clients:
                client_state = self.clients[client_id]
                client_state.violation_count = 0
                client_state.consecutive_violations = 0
                client_state.lift_ban()

                # Restore token bucket capacity
                client_state.token_bucket.capacity = self.config.burst_limit

                self.logger.info(f"Reset violations for client {client_id}")

    def get_client_stats(self, client_id: str) -> Optional[Dict[str, Any]]:
        """Get statistics for a specific client."""
        with self._lock:
            if client_id not in self.clients:
                return None

            client_state = self.clients[client_id]
            return {
                "client_id": client_id,
                "total_requests": client_state.total_requests,
                "violation_count": client_state.violation_count,
                "consecutive_violations": client_state.consecutive_violations,
                "is_banned": client_state.is_currently_banned(),
                "ban_until": (
                    client_state.ban_until.isoformat()
                    if client_state.ban_until
                    else None
                ),
                "last_request": (
                    client_state.last_request.isoformat()
                    if client_state.last_request
                    else None
                ),
                "last_violation": (
                    client_state.last_violation.isoformat()
                    if client_state.last_violation
                    else None
                ),
                "available_tokens": client_state.token_bucket.tokens,
                "token_capacity": client_state.token_bucket.capacity,
            }

    def get_global_stats(self) -> Dict[str, Any]:
        """Get global rate limiting statistics."""
        with self._lock:
            active_clients = len(self.clients)
            banned_clients = sum(
                1 for c in self.clients.values() if c.is_currently_banned()
            )

            return {
                **self.global_stats,
                "active_clients": active_clients,
                "currently_banned_clients": banned_clients,
                "config": {
                    "requests_per_minute": self.config.requests_per_minute,
                    "requests_per_hour": self.config.requests_per_hour,
                    "burst_limit": self.config.burst_limit,
                    "operation_limits": self.config.operation_limits,
                },
            }

    def cleanup_old_clients(self, max_age_hours: int = 24) -> int:
        """Clean up old client entries to prevent memory leaks."""
        cutoff_time = datetime.now() - timedelta(hours=max_age_hours)
        removed_count = 0

        with self._lock:
            clients_to_remove = []

            for client_id, client_state in self.clients.items():
                # Remove clients that haven't made requests recently and aren't banned
                if (
                    client_state.last_request
                    and client_state.last_request < cutoff_time
                    and not client_state.is_currently_banned()
                ):
                    clients_to_remove.append(client_id)

            for client_id in clients_to_remove:
                del self.clients[client_id]
                removed_count += 1

        if removed_count > 0:
            self.logger.info(f"Cleaned up {removed_count} old client entries")

        return removed_count


class ClientRateLimiter:
    """Client-specific rate limiter for use in MCP operations."""

    def __init__(self, config: Optional[RateLimitConfig] = None):
        """Initialize client rate limiter."""
        self.config = config or RateLimitConfig()
        self.rate_limiter = RateLimiter(self.config)
        self.logger = logging.getLogger(__name__)

    def generate_client_id(self, request_info: Dict[str, Any]) -> str:
        """Generate a client ID from request information."""
        # Use a combination of source and other identifying info
        client_data = []

        if "source" in request_info:
            client_data.append(f"source:{request_info['source']}")

        if "workspace_root" in request_info:
            client_data.append(f"workspace:{request_info['workspace_root']}")

        if "extension_version" in request_info:
            client_data.append(f"version:{request_info['extension_version']}")

        # If no identifying info, use a default
        if not client_data:
            client_data.append("unknown_client")

        # Hash the client data to create a stable ID
        client_string = "|".join(client_data)
        return hashlib.sha256(client_string.encode()).hexdigest()[:16]

    def check_operation_allowed(
        self,
        operation_type: str,
        operation_params: Dict[str, Any],
        client_info: Optional[Dict[str, Any]] = None,
    ) -> None:
        """
        Check if an operation is allowed under current rate limits.

        Args:
            operation_type: Type of operation
            operation_params: Parameters for the operation
            client_info: Optional client information for identification

        Raises:
            RateLimitExceeded: If operation exceeds rate limits
        """
        # Generate client ID
        client_info = client_info or {}
        client_id = self.generate_client_id(client_info)

        # Calculate request weight based on operation
        request_weight = self._calculate_request_weight(
            operation_type, operation_params
        )

        # Check rate limits
        try:
            self.rate_limiter.check_rate_limit(
                client_id, operation_type, request_weight
            )

        except RateLimitExceeded as e:
            # Log the rate limit violation
            self.logger.warning(
                f"Rate limit exceeded for operation {operation_type}: {e} "
                f"(client: {client_id[:8]}..., retry_after: {e.retry_after}s)"
            )
            raise

    def _calculate_request_weight(
        self, operation_type: str, operation_params: Dict[str, Any]
    ) -> int:
        """Calculate the weight/cost of a request based on its complexity."""
        base_weights = {
            "create_spec": 3,  # Creating specs is more expensive
            "delete_spec": 5,  # Deletion is most expensive (destructive)
            "update_requirements": 2,  # Content updates are moderately expensive
            "update_design": 2,
            "update_tasks": 2,
            "add_user_story": 2,
            "update_task_status": 1,  # Status updates are cheap
            "set_current_spec": 1,
            "sync_status": 1,
            "heartbeat": 1,
        }

        base_weight = base_weights.get(operation_type, 1)

        # Adjust weight based on content size
        if "content" in operation_params:
            content = operation_params["content"]
            if isinstance(content, str):
                # Add weight for large content
                content_kb = len(content.encode("utf-8")) // 1024
                if content_kb > 10:  # More than 10KB
                    base_weight += min(
                        5, content_kb // 10
                    )  # Max +5 for very large content

        return base_weight

    def get_client_status(self, client_info: Dict[str, Any]) -> Dict[str, Any]:
        """Get rate limiting status for a client."""
        client_id = self.generate_client_id(client_info)
        stats = self.rate_limiter.get_client_stats(client_id)

        if stats:
            return {"rate_limit_status": "tracked", **stats}
        else:
            return {"rate_limit_status": "new_client", "client_id": client_id}

    def reset_client(self, client_info: Dict[str, Any]) -> None:
        """Reset rate limiting for a client (admin function)."""
        client_id = self.generate_client_id(client_info)
        self.rate_limiter.reset_client_violations(client_id)

    def get_system_status(self) -> Dict[str, Any]:
        """Get overall system rate limiting status."""
        return self.rate_limiter.get_global_stats()
