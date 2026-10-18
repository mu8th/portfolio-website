"""Measure, fix, measure: the profiler demo, driven by the real ``@profile``.

The performance-profiler project's decorator (:data:`config.PROFILER_LIB`)
records CPU time, wall time and net memory growth per call. This service uses
it on a small order-report workload with three classic backend slowdowns, each
paired with its fix:

* ``load_orders``: an N+1 query loop, fixed with one JOIN. SQLite runs
  in-process here, so the network round trip a database server adds to every
  query is modeled with a 0.1 ms sleep per query (:data:`ROUND_TRIP_S`). That
  makes N+1 what it is in production: a wall-time problem with little CPU,
  which is exactly what the profiler's CPU-versus-wall columns show.
* ``match_vip``: membership tests against a list, fixed with a set.
* ``totals_by_day``: a full scan of every order per day, fixed with one pass.

A visitor profiles the report, applies the fix for the hottest function, and
profiles again, so the demo shows the before/after a performance change is
judged by. Every number is measured on the server for that request.

Each run decorates fresh wrappers, so measurements never accumulate across
visitors, and runs are serialized because the decorator reads process CPU time.
Results are cached briefly per fix set to keep the shared server responsive.
"""

from __future__ import annotations

import importlib.util
import random
import sqlite3
import threading
import time
from collections.abc import Callable
from typing import Any

from .. import config

#: Workload size: orders, customers, VIP customers, days covered.
ORDERS, CUSTOMERS, VIPS, DAYS = 1_000, 4_000, 2_000, 365
#: Each step runs this many times per measurement for stable averages.
REPEAT = 2
#: Modeled network round trip per database query (seconds).
ROUND_TRIP_S = 0.0001
#: Seconds a result is reused for the same fix set.
CACHE_TTL_S = 60.0

STEPS: dict[str, dict[str, str]] = {
    "load_orders": {
        "problem": "N+1 queries: one SELECT per order to fetch its customer.",
        "fix": "One JOIN fetches every order with its customer.",
    },
    "match_vip": {
        "problem": "`customer_id in vip_list` scans a list for every order.",
        "fix": "A set makes each membership test constant-time.",
    },
    "totals_by_day": {
        "problem": "Rescans all orders once per day of the report.",
        "fix": "One pass accumulates every day's total in a dict.",
    },
}

_lib: Any = None
_run_lock = threading.Lock()
_cache: dict[tuple[str, ...], tuple[float, dict[str, Any]]] = {}


def _get_lib() -> Any:
    """Load the performance-profiler library by path once and cache it."""
    global _lib
    if _lib is None:
        spec = importlib.util.spec_from_file_location("perf_profiler_lib", str(config.PROFILER_LIB))
        if spec is None or spec.loader is None:
            raise RuntimeError(f"Cannot load profiler lib from {config.PROFILER_LIB}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _lib = module
    return _lib


# ── The workload ──────────────────────────────────────────────────────────


def _database() -> tuple[sqlite3.Connection, list[int]]:
    """Build a seeded in-memory shop database (deterministic across runs)."""
    rng = random.Random(7)
    conn = sqlite3.connect(":memory:")
    conn.execute("CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT)")
    conn.execute(
        "CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER, day INTEGER, "
        "total_cents INTEGER)"
    )
    conn.executemany(
        "INSERT INTO customers VALUES (?, ?)",
        [(i, f"customer-{i}") for i in range(1, CUSTOMERS + 1)],
    )
    conn.executemany(
        "INSERT INTO orders VALUES (?, ?, ?, ?)",
        [
            (i, rng.randint(1, CUSTOMERS), rng.randint(1, DAYS), rng.randint(500, 50_000))
            for i in range(1, ORDERS + 1)
        ],
    )
    vips = rng.sample(range(1, CUSTOMERS + 1), VIPS)
    return conn, vips


def _query(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> list[tuple]:
    """Run one query, paying the modeled network round trip."""
    time.sleep(ROUND_TRIP_S)
    return conn.execute(sql, params).fetchall()


def load_orders_slow(conn: sqlite3.Connection) -> list[tuple[Any, ...]]:
    rows = _query(conn, "SELECT id, customer_id, day, total_cents FROM orders")
    out = []
    for order_id, customer_id, day, total in rows:
        name = _query(conn, "SELECT name FROM customers WHERE id = ?", (customer_id,))[0][0]
        out.append((order_id, customer_id, day, total, name))
    return out


def load_orders_fast(conn: sqlite3.Connection) -> list[tuple[Any, ...]]:
    return _query(
        conn,
        "SELECT o.id, o.customer_id, o.day, o.total_cents, c.name "
        "FROM orders o JOIN customers c ON c.id = o.customer_id ORDER BY o.id",
    )


def match_vip_slow(rows: list[tuple], vips: list[int]) -> int:
    return sum(1 for row in rows if row[1] in vips)


def match_vip_fast(rows: list[tuple], vips: list[int]) -> int:
    vip_set = set(vips)
    return sum(1 for row in rows if row[1] in vip_set)


def totals_by_day_slow(rows: list[tuple]) -> dict[int, int]:
    totals = {}
    for day in range(1, DAYS + 1):
        totals[day] = sum(row[3] for row in rows if row[2] == day)
    return totals


def totals_by_day_fast(rows: list[tuple]) -> dict[int, int]:
    totals = dict.fromkeys(range(1, DAYS + 1), 0)
    for row in rows:
        totals[row[2]] += row[3]
    return totals


_IMPLS: dict[str, tuple[Callable[..., Any], Callable[..., Any]]] = {
    "load_orders": (load_orders_slow, load_orders_fast),
    "match_vip": (match_vip_slow, match_vip_fast),
    "totals_by_day": (totals_by_day_slow, totals_by_day_fast),
}


def _named(name: str, fn: Callable[..., Any]) -> Callable[..., Any]:
    """Give the slow and fast variants one public name in the profile."""

    def step(*args: Any) -> Any:
        return fn(*args)

    step.__name__ = step.__qualname__ = name
    return step


def _measure(fixes: frozenset[str], memory: bool) -> dict[str, Any]:
    """Run the report with fresh decorated steps; return results by name."""
    lib = _get_lib()
    steps = {
        name: lib.profile(_named(name, impls[1] if name in fixes else impls[0]), memory=memory)
        for name, impls in _IMPLS.items()
    }
    conn, vips = _database()
    try:
        for _ in range(1 if memory else REPEAT):
            rows = steps["load_orders"](conn)
            steps["match_vip"](rows, vips)
            steps["totals_by_day"](rows)
    finally:
        conn.close()
    out = {}
    for name, fn in steps.items():
        result = next(iter(lib.get_profiler_data(fn).values()))
        out[name] = result
    return out


def run_benchmark(fixes: list[str] | tuple[str, ...] = ()) -> dict[str, Any]:
    """Profile the order report with the given steps fixed.

    Args:
        fixes: Step names (see :data:`STEPS`) whose fast variant to use.

    Returns:
        Per-function CPU, wall and memory measurements, the hot path, the next
        suggested fix, and the total report time.

    Raises:
        ValueError: If ``fixes`` names an unknown step.
    """
    unknown = set(fixes) - set(STEPS)
    if unknown:
        raise ValueError("Unknown step: " + ", ".join(sorted(unknown)))
    key = tuple(sorted(set(fixes)))
    now = time.monotonic()
    cached = _cache.get(key)
    if cached and now - cached[0] < CACHE_TTL_S:
        return {**cached[1], "cached": True}

    with _run_lock:
        started = time.perf_counter()
        timing = _measure(frozenset(key), memory=False)
        memory = _measure(frozenset(key), memory=True)
        elapsed = time.perf_counter() - started

    functions = []
    for name, res in timing.items():
        functions.append({
            "function_name": name,
            "fixed": name in key,
            "call_count": res.call_count,
            "total_cpu_time": round(res.total_cpu_time, 6),
            "avg_cpu_time_ms": round(res.avg_cpu_time * 1000, 3),
            "avg_wall_time_ms": round(res.total_duration / max(1, res.call_count) * 1000, 3),
            "memory_kb": round(memory[name].memory_peak / 1024, 1),
            **STEPS[name],
        })
    total = sum(f["total_cpu_time"] for f in functions) or 1e-9
    wall = sum(f["avg_wall_time_ms"] for f in functions) or 1e-9
    for f in functions:
        f["cpu_pct"] = round(f["total_cpu_time"] / total * 100, 1)
        f["wall_pct"] = round(f["avg_wall_time_ms"] / wall * 100, 1)
        f["waiting_pct"] = (
            round(max(0.0, 1 - f["avg_cpu_time_ms"] / f["avg_wall_time_ms"]) * 100, 1)
            if f["avg_wall_time_ms"] > 0 else 0.0
        )
    # Rank by wall time: it is what a caller waits for. CPU share is reported
    # alongside, so a function that mostly waits (N+1) stands out.
    functions.sort(key=lambda f: f["avg_wall_time_ms"], reverse=True)
    hot = functions[0]
    next_fix = next((f["function_name"] for f in functions if not f["fixed"]), None)
    result = {
        "workload": {"orders": ORDERS, "customers": CUSTOMERS, "vips": VIPS, "days": DAYS,
                     "repeat": REPEAT, "round_trip_ms": ROUND_TRIP_S * 1000},
        "fixes": list(key),
        "functions": functions,
        "report_cpu_ms": round(sum(f["avg_cpu_time_ms"] for f in functions), 2),
        "report_wall_ms": round(sum(f["avg_wall_time_ms"] for f in functions), 2),
        "total_cpu_time": round(total, 6),
        "hot_path": hot["function_name"],
        "hot_path_pct": hot["wall_pct"],
        "next_fix": next_fix,
        "measured_in_ms": round(elapsed * 1000, 1),
        "cached": False,
    }
    _cache[key] = (now, result)
    return result
