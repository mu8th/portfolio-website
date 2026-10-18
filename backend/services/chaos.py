"""Live chaos-testing demo driven by the FaultLine engine.

This service imports the sibling project FaultLine's real experiment runner
(the ``faultline`` package under :data:`config.FAULTLINE_PKG`) and runs a short
experiment against FaultLine's bundled shop service: it spawns the service,
probes ``POST /api/orders`` and ``GET /health`` continuously, injects one fault,
and grades SLO hypotheses on the orders probe.

A visitor chooses the fault and whether to apply a mitigation, so the demo can
show the loop chaos engineering exists for: an experiment finds a breach, a
change is made, and the same experiment proves (or disproves) the fix.

* ``cpu``: CPU pressure. Mitigation: the shop's inventory check is cached
  (``SHOP_WORKLOAD=0``), so orders no longer compete for the CPU.
* ``latency``: 250 ms of network delay in front of the service. No mitigation
  is offered: the fix belongs in clients (timeouts, retries, failover).
* ``kill``: the process is killed. Mitigation: a supervisor restarts it 1 s
  later instead of never.

Every hypothesis uses the same 60 ms p95 limit, which steady state (the
baseline window) must meet first. One run happens at a time; viewers who
connect mid-run get a replay and then the live stream. The last result for each
scenario is saved under :data:`config.CACHE_DIR`, so a visitor sees real
evidence immediately and can rerun it live.
"""

from __future__ import annotations

import asyncio
import importlib
import importlib.util
import json
import re
import sys
import time
import uuid
from collections.abc import AsyncIterator
from typing import Any

from .. import config

#: The p95 latency limit every hypothesis uses (milliseconds).
SLO_P95_MS = 60

SCENARIOS: dict[str, dict[str, Any]] = {
    "cpu": {
        "label": "CPU pressure",
        "fault": {"type": "cpu_pressure", "duration_s": 6, "params": {"workers": 8}},
        "describe": "Eight CPU-burning processes compete with the service for 6 s.",
        "mitigation": {
            "label": "Cache the inventory check",
            "describe": "Orders skip their CPU-heavy inventory check (SHOP_WORKLOAD=0).",
            "env": {"SHOP_WORKLOAD": "0"},
        },
    },
    "latency": {
        "label": "Network delay",
        "fault": {
            "type": "network_delay",
            "duration_s": 6,
            "params": {"latency_ms": 250, "jitter_ms": 50, "drop_rate": 0.0},
        },
        "describe": "A proxy adds 250 ± 50 ms to every request for 6 s.",
        "mitigation": None,
        "no_mitigation_reason": (
            "Network delay is fixed on the client side (timeouts, retries, failover), "
            "which this probe setup does not model."
        ),
    },
    "kill": {
        "label": "Process kill",
        "fault": {"type": "process_kill", "duration_s": 6, "params": {"restart_after_s": 0}},
        "describe": "The service process is killed; nothing brings it back.",
        "mitigation": {
            "label": "Supervisor restart",
            "describe": "A supervisor restarts the process 1 s after it dies.",
            "params": {"restart_after_s": 1},
        },
    },
}

_PROBE_RE = re.compile(r"^(GET|POST)\s+\S+?(/api/orders|/health)\b")

_pkg: Any = None
_run: dict[str, Any] | None = None
_lock = asyncio.Lock()
_subscribers: set[asyncio.Queue] = set()
_last: dict[str, Any] | None = None


# ── Engine loading ────────────────────────────────────────────────────────


def _load_faultline() -> Any:
    """Import the FaultLine package by absolute path (it is not on sys.path)."""
    init = config.FAULTLINE_PKG / "__init__.py"
    if not init.is_file():
        raise RuntimeError(f"FaultLine checkout not found at {config.FAULTLINE_PKG}")
    spec = importlib.util.spec_from_file_location(
        "faultline",
        str(init),
        submodule_search_locations=[str(config.FAULTLINE_PKG)],
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load FaultLine package from {config.FAULTLINE_PKG}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["faultline"] = module  # intra-package relative imports need it
    spec.loader.exec_module(module)
    return module


def _get_pkg() -> Any:
    global _pkg
    if _pkg is None:
        _pkg = _load_faultline()
    return _pkg


def engine_available() -> bool:
    """Return True when the FaultLine package imports cleanly."""
    try:
        _get_pkg()
        return True
    except Exception:  # pragma: no cover - defensive
        return False


# ── Saved results ─────────────────────────────────────────────────────────


def _key(scenario: str, mitigation: bool) -> str:
    return f"{scenario}:{'fixed' if mitigation else 'baseline'}"


def _store_path() -> Any:
    return config.CACHE_DIR / "faultline-runs.json"


def _load_store() -> dict[str, Any]:
    global _last
    if _last is None:
        try:
            _last = json.loads(_store_path().read_text(encoding="utf-8"))
        except (OSError, ValueError):
            _last = {}
    return _last


def _save_store(store: dict[str, Any]) -> None:
    try:
        path = _store_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(store), encoding="utf-8")
        tmp.replace(path)
    except OSError:  # pragma: no cover - read-only disk: keep in memory only
        pass


# ── Experiment definition ─────────────────────────────────────────────────


def validate_choice(scenario: str, mitigation: bool) -> None:
    """Raise ValueError for an unknown scenario or an unavailable mitigation."""
    if scenario not in SCENARIOS:
        raise ValueError("Choose cpu, latency or kill.")
    if mitigation and SCENARIOS[scenario]["mitigation"] is None:
        raise ValueError(SCENARIOS[scenario]["no_mitigation_reason"])


def _spec(scenario: str, mitigation: bool) -> Any:
    """Build the experiment for one scenario (no YAML on disk)."""
    _get_pkg()
    m = importlib.import_module("faultline.models")
    plan = SCENARIOS[scenario]
    fix = plan["mitigation"] if mitigation else None
    fault = dict(plan["fault"])
    fault["params"] = {**fault["params"], **((fix or {}).get("params") or {})}

    command = ["{python}", "-m", "examples.target.shop", "--port", "{port}"]
    env = dict((fix or {}).get("env") or {})
    target_kwargs: dict[str, Any] = {}
    if env:
        if "env" in getattr(m.TargetSpec, "model_fields", {}):
            target_kwargs["env"] = env
        else:  # FaultLine before TargetSpec.env: set it through argv, still no shell
            command = ["env", *(f"{k}={v}" for k, v in env.items()), *command]

    if scenario == "kill":
        fault_slo = m.SloSpec(
            name="downtime stays bounded", window="fault", probe=0, error_rate_max=0.8
        )
    else:
        fault_slo = m.SloSpec(
            name=f"orders p95 ≤ {SLO_P95_MS} ms under the fault",
            window="fault", probe=0, p95_latency_ms=SLO_P95_MS, error_rate_max=0.1,
        )
    return m.ExperimentSpec(
        name=f"portfolio-{scenario}{'-mitigated' if mitigation else ''}",
        description=plan["describe"],
        target=m.TargetSpec(
            kind="subprocess",
            command=command,
            cwd=str(config.FAULTLINE_DIR),
            health_url="http://127.0.0.1:{port}/health",
            wait_timeout_s=25,
            **target_kwargs,
        ),
        probes=[
            m.ProbeSpec(
                url="http://127.0.0.1:{port}/api/orders",
                method="POST",
                body={"product_id": "sku-001", "quantity": 1},
                interval_s=0.4,
            ),
            m.ProbeSpec(url="http://127.0.0.1:{port}/health", interval_s=0.4),
        ],
        faults=[m.FaultSpec(**fault)],
        windows=m.WindowsSpec(baseline_s=2.5, recovery_s=3),
        slo=[
            m.SloSpec(
                name=f"steady state: orders p95 ≤ {SLO_P95_MS} ms", window="baseline",
                probe=0, p95_latency_ms=SLO_P95_MS, error_rate_max=0.05,
            ),
            fault_slo,
            m.SloSpec(
                name="recovers within the SLO", window="recovery", probe=0,
                p95_latency_ms=SLO_P95_MS, error_rate_max=0.05,
            ),
        ],
    )


# ── Per-probe statistics ──────────────────────────────────────────────────


def _percentile(values: list[float], p: float) -> float | None:
    """Linear-interpolated percentile (the method FaultLine's SLO checks use)."""
    if not values:
        return None
    ordered = sorted(values)
    rank = (p / 100) * (len(ordered) - 1)
    lo = int(rank)
    hi = min(lo + 1, len(ordered) - 1)
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (rank - lo)


def probe_stats(events: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """p95, sample count and error rate per probe per window, from probe events."""
    stats: dict[str, dict[str, Any]] = {}
    for probe in ("orders", "health"):
        for window in ("baseline", "fault", "recovery"):
            samples = [e for e in events if e.get("probe") == probe and e.get("phase") == window]
            latencies = [e["latency_ms"] for e in samples if e.get("ok") and e.get("latency_ms")]
            errors = sum(1 for e in samples if not e.get("ok"))
            p95 = _percentile(latencies, 95)
            stats.setdefault(probe, {})[window] = {
                "samples": len(samples),
                "p95_ms": round(p95, 1) if p95 is not None else None,
                "error_rate": round(errors / len(samples), 3) if samples else None,
            }
    return stats


# ── Runs and streaming ────────────────────────────────────────────────────


def subscribe() -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=512)
    _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    _subscribers.discard(q)


def _publish(frame: dict[str, Any]) -> None:
    """Buffer the frame for replay and fan it out to every connected client."""
    if _run is not None:
        _run["frames"].append(frame)
    for q in list(_subscribers):
        try:
            q.put_nowait(frame)
        except asyncio.QueueFull:  # pragma: no cover - slow viewer, drop frame
            pass


def _annotate(event: dict[str, Any]) -> dict[str, Any]:
    """Tag probe events with which endpoint they hit ("orders" or "health")."""
    if "ok" in event:
        match = _PROBE_RE.match(str(event.get("message", "")))
        if match:
            event["probe"] = "orders" if match.group(2) == "/api/orders" else "health"
    return event


async def start_run(scenario: str = "cpu", mitigation: bool = False) -> dict[str, Any]:
    """Start a run if none is in flight; returns the started/busy state."""
    global _run
    validate_choice(scenario, mitigation)
    async with _lock:
        if _run is not None and not _run["done"]:
            return {"started": False, "busy": True, "running": _run["meta"]}
        _get_pkg()  # raise early so the endpoint reports the real error
        meta = {"scenario": scenario, "mitigation": mitigation,
                "run_id": uuid.uuid4().hex[:12], "started_at": time.time()}
        _run = {"meta": meta, "frames": [], "events": [], "done": False}
        state = _run
    _publish({"type": "start", **meta})
    asyncio.get_running_loop().create_task(_execute(state))
    return {"started": True, **meta}


async def _execute(state: dict[str, Any]) -> None:
    meta = state["meta"]
    try:
        _get_pkg()
        runner_cls = importlib.import_module("faultline.engine").ExperimentRunner

        def on_event(event: dict[str, Any]) -> None:
            event = _annotate(dict(event))
            state["events"].append(event)
            _publish({"type": "event", **event})

        report = await runner_cls(
            _spec(meta["scenario"], meta["mitigation"]), on_event, base_dir=config.FAULTLINE_DIR
        ).run()
        state["final"] = report.to_dict()
    except Exception as exc:  # pragma: no cover - defensive
        state["error"] = str(exc)
    finally:
        state["done"] = True
        stats = probe_stats(state["events"])
        if state.get("final") is not None:
            store = _load_store()
            store[_key(meta["scenario"], meta["mitigation"])] = {
                **meta, "finished_at": time.time(), "report": state["final"],
                "events": [e for e in state["events"] if "probe" in e or e["phase"] != "target"],
                "probe_stats": stats,
            }
            _save_store(store)
        _publish({"type": "final", **meta, "report": state.get("final"),
                  "probe_stats": stats, "error": state.get("error")})


def status(scenario: str = "cpu", mitigation: bool = False) -> dict[str, Any]:
    """Engine presence, current run (if any), and the saved result for a choice."""
    validate_choice(scenario, mitigation)
    store = _load_store()
    return {
        "engine": engine_available(),
        "busy": bool(_run is not None and not _run["done"]),
        "running": _run["meta"] if _run is not None and not _run["done"] else None,
        "last": store.get(_key(scenario, mitigation)),
        "slo_p95_ms": SLO_P95_MS,
        "scenarios": {
            name: {
                "label": plan["label"],
                "describe": plan["describe"],
                "mitigation": (
                    {k: plan["mitigation"][k] for k in ("label", "describe")}
                    if plan["mitigation"] else None
                ),
                "no_mitigation_reason": plan.get("no_mitigation_reason"),
            }
            for name, plan in SCENARIOS.items()
        },
    }


async def stream_frames() -> AsyncIterator[dict[str, Any]]:
    """Yield WebSocket frames for one client: buffered replay, then live."""
    q = subscribe()
    try:
        if _run is not None and _run["frames"]:
            yield {"type": "replay", "frames": list(_run["frames"]), "done": _run["done"]}
        while True:
            frame = await q.get()
            yield frame
            if frame.get("type") == "final":
                break
    finally:
        unsubscribe(q)
