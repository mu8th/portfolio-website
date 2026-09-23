"""Live chaos-testing demo driven by the FaultLine engine.

Rather than faking an SLO breach, this service imports the sibling project
FaultLine's real experiment runner (the "faultline" package under
config.FAULTLINE_PKG) and runs a compact, self-contained experiment: it spawns
the bundled shop target as a subprocess, probes it continuously, injects real
CPU pressure, and grades SLO hypotheses against the collected samples.

FaultLine is a *package*, not a single module, so the lazy import uses
"submodule_search_locations" to make intra-package relative imports resolve.
The portfolio backend starts even when the FaultLine checkout is missing; the
chaos endpoints then return an error payload like every other demo.

Entry points:

* engine_available() -- presence check for /api/health.
* start_run() / status() -- REST (one run at a time).
* stream_frames() -- async generator of WebSocket frames (replay + live).
"""

from __future__ import annotations

import asyncio
import importlib.util
import sys
import uuid
from collections.abc import AsyncIterator
from typing import Any

from .. import config

_pkg: Any = None


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
    """Load the FaultLine package once and cache it."""
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


# ---------------------------------------------------------------------------
# Run state (one run at a time; frames buffered for late WebSocket joiners)
# ---------------------------------------------------------------------------

_run: dict[str, Any] | None = None
_lock = asyncio.Lock()
_subscribers: set[asyncio.Queue] = set()


def subscribe() -> asyncio.Queue:
    """Register one WebSocket client's frame queue."""
    q: asyncio.Queue = asyncio.Queue(maxsize=512)
    _subscribers.add(q)
    return q


def unsubscribe(q: asyncio.Queue) -> None:
    """Drop a disconnected client's frame queue."""
    _subscribers.discard(q)


def _publish(frame: dict[str, Any]) -> None:
    """Buffer the frame for replay and fan it out to every connected client."""
    if _run is not None and frame.get("type") != "replay":
        _run["frames"].append(frame)
    for q in list(_subscribers):
        try:
            q.put_nowait(frame)
        except asyncio.QueueFull:  # pragma: no cover - slow viewer, drop frame
            pass


def _demo_spec() -> Any:
    """Build a compact ~12s experiment programmatically (no YAML on disk).

    The fault-window p95 SLO is deliberately tight: saturating every core of
    the host makes the single-threaded shop target miss it, so the demo's
    verdict is a real FAIL with real evidence -- FaultLine catching an actual
    regression, not a scripted one.
    """
    m = importlib.import_module("faultline.models")  # spec classes live in the submodule
    return m.ExperimentSpec(
        name="portfolio-demo",
        description="CPU pressure against the bundled shop target; tight p95 SLO.",
        target=m.TargetSpec(
            kind="subprocess",
            command=["{python}", "-m", "examples.target.shop", "--port", "{port}"],
            cwd=str(config.FAULTLINE_DIR),
            health_url="http://127.0.0.1:{port}/health",
            wait_timeout_s=25,
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
        faults=[m.FaultSpec(type="cpu_pressure", duration_s=6, params={"workers": 8})],
        windows=m.WindowsSpec(baseline_s=2, recovery_s=2.5),
        slo=[
            m.SloSpec(name="p95 latency under pressure", window="fault", p95_latency_ms=25),
            m.SloSpec(name="survivability (error rate)", window="fault", error_rate_max=0.1),
            m.SloSpec(
                name="recovery",
                window="recovery",
                p95_latency_ms=300,
                error_rate_max=0.05,
            ),
        ],
    )


async def start_run() -> dict[str, Any]:
    """Start a demo run if none is in flight; returns the started/busy state."""
    global _run
    async with _lock:
        if _run is not None and not _run["done"]:
            return {"started": False, "busy": True}
        _get_pkg()  # raise early so the endpoint reports the real error
        state: dict[str, Any] = {
            "run_id": uuid.uuid4().hex[:12],
            "frames": [],
            "done": False,
        }
        _run = state
    asyncio.get_running_loop().create_task(_execute(state))
    return {"started": True, "run_id": state["run_id"]}


async def _execute(state: dict[str, Any]) -> None:
    """Run the experiment in the background, publishing frames as they happen."""
    try:
        _get_pkg()  # ensure the package is imported and registered in sys.modules
        # The async runner lives in the engine submodule (the top-level package
        # only re-exports the sync run_experiment wrapper).
        runner_cls = importlib.import_module("faultline.engine").ExperimentRunner

        def on_event(event: dict[str, Any]) -> None:
            _publish({"type": "event", **event})

        report = await runner_cls(
            _demo_spec(), on_event, base_dir=config.FAULTLINE_DIR
        ).run()
        state["final"] = report.to_dict()
    except Exception as exc:  # pragma: no cover - defensive
        state["error"] = str(exc)
    finally:
        state["done"] = True
        _publish(
            {"type": "final", "report": state.get("final"), "error": state.get("error")}
        )


def status() -> dict[str, Any]:
    """Current run state for the REST endpoint (engine presence + last result)."""
    return {
        "engine": engine_available(),
        "busy": bool(_run is not None and not _run["done"]),
        "last": (_run or {}).get("final") or {},
        "error": (_run or {}).get("error"),
    }


async def stream_frames() -> AsyncIterator[dict[str, Any]]:
    """Yield WebSocket frames for one client: buffered replay, then live."""
    q = subscribe()
    try:
        if _run is not None and _run["frames"]:
            yield {"type": "replay", "frames": list(_run["frames"])}
        while True:
            frame = await q.get()
            yield frame
            if frame.get("type") == "final":
                break
    finally:
        unsubscribe(q)
