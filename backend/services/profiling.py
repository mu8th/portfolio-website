"""Real-time performance profiling, driven by the performance-profiler's real engine.

Rather than fabricating flame-graph numbers, this service imports the
performance-profiler's actual ``@profile`` decorator (from
:data:`config.PROFILER_LIB`) and measures a small, realistic in-process
workload. The numbers returned -- call counts, total/avg/max CPU time -- are the
real timings produced by the profiler, so each run is different.

The profiler library and its decorator are applied lazily on first use, so the
portfolio backend can start even when the performance-profiler checkout is missing;
the profiling endpoints then return an error payload instead of crashing at
import time.

Two entry points:

* :func:`run_benchmark` -- a one-shot measurement (used by the ``/api/profile``
  REST endpoint).
* :func:`stream_metrics` -- an async generator of live metric frames, fed by a
  background loop, used by the WebSocket demo endpoint.
"""

from __future__ import annotations

import asyncio
import importlib.util
import math
import time
from collections.abc import AsyncIterator, Callable
from typing import Any

from .. import config


def _load_profiler_module():
    """Import the performance-profiler ``profiler.py`` by absolute path (not on sys.path)."""
    spec = importlib.util.spec_from_file_location("perf_profiler_lib", str(config.PROFILER_LIB))
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load profiler lib from {config.PROFILER_LIB}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_lib: Any = None
_workloads: dict[str, Callable[[int], int]] = {}


def _get_lib() -> Any:
    """Load the performance-profiler library once and cache it."""
    global _lib
    if _lib is None:
        _lib = _load_profiler_module()
    return _lib


def _get_workloads() -> dict[str, Callable[[int], int]]:
    """Decorate the workload functions with the real ``@profile`` (once)."""
    if not _workloads:
        lib = _get_lib()
        for name in ("db_query", "render_template", "encode_payload"):
            _workloads[name] = lib.profile(_WORKLOAD_IMPLS[name])
    return _workloads


def db_query(n: int) -> int:
    """Simulated hot query path -- the classic 'db.query()' hotspot."""
    s = 0
    for i in range(n):
        s += i * i
    return s


def render_template(n: int) -> int:
    """Simulated render pass -- a lighter CPU consumer."""
    total = 0
    for i in range(n):
        total += int(math.sqrt(i))
    return total


def encode_payload(n: int) -> int:
    """Simulated serialization step."""
    buf = 0
    for i in range(n):
        buf += (i + i) & 0xFF
    return buf


_WORKLOAD_IMPLS: dict[str, Callable[[int], int]] = {
    "db_query": db_query,
    "render_template": render_template,
    "encode_payload": encode_payload,
}


def run_benchmark(iterations: int = 5, n: int = 300_000) -> dict[str, Any]:
    """Profile the three workload functions and return real aggregated metrics.

    Args:
        iterations: How many times to call each function (aggregated by name).
        n: Workload size per call (controls measured CPU time).

    Returns:
        A dict with ``functions`` (per-function metrics), ``hot_path`` (the
        function consuming the most wall CPU), and a ``total_cpu_time`` summary.
    """
    lib = _get_lib()
    workloads = _get_workloads()

    for _ in range(iterations):
        for fn in workloads.values():
            fn(n)

    functions: list[dict[str, Any]] = []
    for name in ("db_query", "render_template", "encode_payload"):
        result = lib.get_profiler_data(workloads[name])
        for res in result.values():
            functions.append(
                {
                    "function_name": res.function_name,
                    "call_count": res.call_count,
                    "total_cpu_time": round(res.total_cpu_time, 6),
                    "avg_cpu_time_ms": round(res.avg_cpu_time * 1000, 3),
                    "max_cpu_time_ms": round(res.max_cpu_time * 1000, 3),
                }
            )

    total = sum(f["total_cpu_time"] for f in functions) or 1.0
    for f in functions:
        f["cpu_pct"] = round(f["total_cpu_time"] / total * 100, 1)
    functions.sort(key=lambda f: f["total_cpu_time"], reverse=True)
    hot = functions[0] if functions else {}
    return {
        "iterations": iterations,
        "workload": n,
        "functions": functions,
        "total_cpu_time": round(total, 6),
        "hot_path": hot.get("function_name", "n/a"),
        "hot_path_pct": hot.get("cpu_pct", 0.0),
    }


async def stream_metrics(frames: int = 12, interval: float = 0.5) -> AsyncIterator[dict[str, Any]]:
    """Yield live metric frames for the WebSocket demo.

    Each frame reports the total call count, cumulative CPU time, and a rolling
    per-frame delta so the dashboard can show motion. Runs for a bounded number
    of frames so the demo is self-terminating.
    """
    lib = _get_lib()
    hot_fn = _get_workloads()["db_query"]

    started = time.perf_counter()
    prev_calls = 0
    prev_cpu = 0.0
    for i in range(frames):
        hot_fn(120_000)
        res = lib.get_profiler_data(hot_fn)
        r = next(iter(res.values()))
        calls = r.call_count
        cpu = r.total_cpu_time
        yield {
            "frame": i + 1,
            "calls_total": calls,
            "calls_this_frame": calls - prev_calls,
            "cpu_total": round(cpu, 6),
            "cpu_this_frame_ms": round((cpu - prev_cpu) * 1000, 3),
            "uptime_s": round(time.perf_counter() - started, 3),
        }
        prev_calls = calls
        prev_cpu = cpu
        await asyncio.sleep(interval)
