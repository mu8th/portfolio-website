"""Per-client rate limits for the demo endpoints that cost real CPU.

The portfolio runs on one small always-free core, and several demos do real
work (a FaultLine run injects CPU pressure on purpose). A sliding window per
client and endpoint keeps one visitor, or a bot, from making every demo slow
for everyone else.

The app binds to loopback behind Caddy, so the client address comes from the
first ``X-Forwarded-For`` hop when the direct peer is local; otherwise the
peer address is used as-is.
"""

from __future__ import annotations

import threading
import time
from collections import deque
from collections.abc import Callable

from fastapi import HTTPException, Request

_LOOPBACK = {"127.0.0.1", "::1", "localhost"}
_lock = threading.Lock()
_hits: dict[tuple[str, str], deque[float]] = {}
_last_sweep = 0.0


def client_id(request: Request) -> str:
    """Best-effort client address (trusting X-Forwarded-For only from loopback)."""
    peer = request.client.host if request.client else "unknown"
    if peer in _LOOPBACK:
        forwarded = request.headers.get("x-forwarded-for", "")
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return peer


def check(bucket: str, client: str, limit: int, window_s: float) -> float | None:
    """Record a hit; return seconds to wait if over the limit, else None."""
    global _last_sweep
    now = time.monotonic()
    with _lock:
        hits = _hits.setdefault((bucket, client), deque())
        while hits and now - hits[0] >= window_s:
            hits.popleft()
        if len(hits) >= limit:
            return window_s - (now - hits[0])
        hits.append(now)
        if now - _last_sweep > 300:  # drop idle clients so memory stays bounded
            _last_sweep = now
            for key in [k for k, v in _hits.items() if not v or now - v[-1] > 3600]:
                del _hits[key]
    return None


def limit(bucket: str, max_calls: int, window_s: float) -> Callable[[Request], None]:
    """FastAPI dependency: allow ``max_calls`` per ``window_s`` per client."""

    def dependency(request: Request) -> None:
        wait = check(bucket, client_id(request), max_calls, window_s)
        if wait is not None:
            raise HTTPException(
                status_code=429,
                detail=f"Too many runs of this demo. Try again in {max(1, round(wait))} s.",
                headers={"Retry-After": str(max(1, round(wait)))},
            )

    return dependency


def reset() -> None:
    """Forget all recorded hits (tests)."""
    with _lock:
        _hits.clear()
