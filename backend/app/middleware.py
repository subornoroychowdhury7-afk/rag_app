"""HTTP middlewares for request tracing, security headers, and rate limiting."""

from collections import deque
import logging
import re
import threading
import time
import uuid

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("rag.middleware")

_SAFE_REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9\-_\.]{1,64}$")


class RequestContextMiddleware(BaseHTTPMiddleware):
    """Attach correlation ID (X-Request-ID), latency timing, and structured access logs."""

    async def dispatch(self, request: Request, call_next):
        incoming_id = (request.headers.get("X-Request-ID") or "").strip()
        request_id = incoming_id if _SAFE_REQUEST_ID_RE.match(incoming_id) else str(uuid.uuid4())
        request.state.request_id = request_id

        started = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)

        response.headers["X-Request-ID"] = request_id
        response.headers["X-Process-Time-Ms"] = str(elapsed_ms)

        logger.info(
            "http_request method=%s path=%s status=%s duration_ms=%s request_id=%s",
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
            request_id,
        )
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Inject baseline security headers on every HTTP response."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), geolocation=(), microphone=(self)")
        return response


class SlidingWindowRateLimiter:
    """Thread-safe in-memory per-client sliding-window rate limiter."""

    def __init__(self, max_requests: int = 60, window_seconds: int = 60, enabled: bool = True):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.enabled = enabled
        self._buckets: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def reset(self) -> None:
        """Clear all tracked client request timestamps (useful in automated tests)."""
        with self._lock:
            self._buckets.clear()

    def check(self, client_key: str) -> None:
        """Record a request for client_key or raise HTTP 429 when over limit."""
        if not self.enabled or self.max_requests <= 0:
            return

        now = time.monotonic()
        cutoff = now - self.window_seconds

        with self._lock:
            bucket = self._buckets.setdefault(client_key, deque())
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()

            if len(bucket) >= self.max_requests:
                retry_after = max(1, int(self.window_seconds - (now - bucket[0])) + 1)
                raise HTTPException(
                    status_code=429,
                    detail="Rate limit exceeded. Please wait before sending more requests.",
                    headers={"Retry-After": str(retry_after)},
                )

            bucket.append(now)


def extract_client_key(request: Request) -> str:
    """Resolve stable client identifier honoring X-Forwarded-For behind reverse proxies."""
    forwarded = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
    if forwarded:
        return forwarded
    return request.client.host if request.client else "unknown"
