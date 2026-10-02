"""Portfolio demo backend -- FastAPI application.

The app binds to loopback in both local and production deployments. Public
traffic reaches it only through the site's reverse proxy; do not expose the
application port directly.

Endpoints
---------
* ``GET  /api/health``    -- liveness probe.
* ``GET  /api/stats``     -- filesystem, Python-source, test-function, and Git-history counts.
* ``GET  /api/contract``  -- compatibility diff of bundled OpenAPI fixtures.
* ``GET  /api/profile``   -- CPU profile of a bounded benchmark workload.
* ``GET  /api/scan``      -- heuristic pattern scan of the sibling repos.
* ``POST /api/chaos/run`` -- start a real FaultLine chaos experiment.
* ``GET  /api/chaos``     -- last chaos run verdict + SLO evidence.
* ``WS   /ws/profile``    -- live-streaming profiling metrics.
* ``WS   /ws/chaos``      -- live-streamed chaos experiment events.

Every data endpoint degrades gracefully: if a real engine or repo is missing
the endpoint returns an error payload the frontend understands, rather than
500-ing, so the site keeps working even if the backend can't reach everything.
"""

from __future__ import annotations

import logging
import re

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .cnc_api import router as cnc_router
from .services import chaos, contract_diff, profiling, rag, repo_stats, vuln_scan
from .services.repo_stats import StatsPayload

logger = logging.getLogger("portfolio-backend")

app = FastAPI(title="Portfolio Demo Backend", version="1.0.0")
app.include_router(cnc_router)

# Local static-site development uses a separate origin. Production serves the
# page and API through one reverse-proxy origin, so it does not need CORS.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8080", "http://127.0.0.1:8080"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    """Return liveness plus which real engines/repos are reachable."""
    return {
        "status": "ok",
        "engines": {
            "profiler": config.PROFILER_LIB.exists(),
            "scanner": config.SCANNER_ENGINE.exists(),
            "samples": (config.SAMPLES_DIR / "orders_v1.2.0.yaml").exists(),
            "code_rag": _code_rag_up(),
            "faultline": (config.FAULTLINE_PKG / "__init__.py").exists(),
        },
    }


def _code_rag_up() -> bool:
    """Return True if the code-rag demo server answers ``/api/status``."""
    import urllib.request

    try:
        url = f"http://{config.CODE_RAG_HOST}:{config.CODE_RAG_PORT}/api/status"
        with urllib.request.urlopen(url, timeout=3) as resp:
            return resp.status == 200
    except Exception:  # pragma: no cover - network probe
        return False


@app.get("/api/stats")
def stats() -> StatsPayload:
    """Return live repository statistics for the About counters."""
    try:
        return repo_stats.get_stats()
    except Exception:  # pragma: no cover - defensive
        logger.exception("stats failed")
        return {"projects_shipped": 0, "repository_files": 0,
                "python_lines": 0, "commit_count": 0,
                "test_functions": 0, "repos": []}


@app.get("/api/contract")
def contract() -> dict:
    """Return the compatibility diff for the bundled OpenAPI fixtures."""
    try:
        return contract_diff.diff_specs().to_dict()
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("contract diff failed")
        return {"error": str(exc), "changes": [], "breaking_count": 0, "status": "ERROR"}


@app.get("/api/profile")
def profile(iterations: int = 5) -> dict:
    """Profile the demo's bounded benchmark workload."""
    try:
        return profiling.run_benchmark(iterations=max(1, min(iterations, 50)))
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("profile failed")
        return {"error": str(exc), "functions": [], "hot_path": "n/a"}


@app.get("/api/scan")
def scan(max_findings: int = 25) -> dict:
    """Return heuristic pattern matches from a scan of sibling repos."""
    try:
        return vuln_scan.scan_repos(max_findings=max(1, min(max_findings, 200)))
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("scan failed")
        return {"error": str(exc), "findings": [], "total_findings": 0}


@app.post("/api/rag")
def rag_ask(body: dict) -> dict:
    """Proxy a question to the code-rag server and return its cited answer."""
    question = str(body.get("question", "")) if isinstance(body, dict) else ""
    try:
        return rag.ask(question)
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("rag ask failed")
        return {"status": "ERROR", "error": str(exc), "answer": "",
                "sources": [], "model": "n/a", "latency_ms": 0}


@app.post("/api/chaos/run")
async def chaos_run() -> dict:
    """Start a real FaultLine experiment (one at a time)."""
    try:
        return await chaos.start_run()
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("chaos run failed to start")
        return {"started": False, "busy": False, "error": str(exc)}


@app.get("/api/chaos")
def chaos_status() -> dict:
    """Return the last chaos verdict + SLO evidence (empty until first run)."""
    try:
        return chaos.status()
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("chaos status failed")
        return {"engine": False, "busy": False, "last": {}, "error": str(exc)}


@app.get("/api/summary")
def summary() -> dict:
    """Return a single aggregate payload for the hero status ticker.

    Bundles live repo statistics and heuristic scanner match counts into one
    request for the hero snapshot. Scanner matches are not confirmed
    vulnerabilities. Each field degrades to a safe default if its source is
    unavailable.
    """
    stats: StatsPayload = {
        "projects_shipped": 0,
        "repository_files": 0,
        "python_lines": 0,
        "commit_count": 0,
        "test_functions": 0,
        "repos": [],
    }
    potential_matches = 0
    try:
        stats = repo_stats.get_stats()
    except Exception:  # pragma: no cover - defensive
        logger.exception("summary stats failed")
    try:
        potential_matches = int(
            vuln_scan.scan_repos(max_findings=1).get("total_findings", 0)
        )
    except Exception:  # pragma: no cover - defensive
        logger.exception("summary scan failed")

    return {
        "status": "operational",
        "projects_shipped": int(stats.get("projects_shipped", 0) or 0),
        "python_lines": int(stats.get("python_lines", 0) or 0),
        "test_functions": int(stats.get("test_functions", 0) or 0),
        "potential_matches": potential_matches,
    }


@app.websocket("/ws/profile")
async def ws_profile(websocket: WebSocket) -> None:
    """Stream live profiling metric frames to the connected client."""
    await websocket.accept()
    try:
        async for frame in profiling.stream_metrics(frames=15, interval=0.4):
            await websocket.send_json(frame)
    except WebSocketDisconnect:
        return
    except Exception:  # pragma: no cover - defensive
        logger.exception("ws stream failed")
        return


@app.websocket("/ws/chaos")
async def ws_chaos(websocket: WebSocket) -> None:
    """Stream live chaos experiment frames (replay of an in-flight run first)."""
    await websocket.accept()
    try:
        async for frame in chaos.stream_frames():
            await websocket.send_json(frame)
    except WebSocketDisconnect:
        return
    except Exception:  # pragma: no cover - defensive
        logger.exception("chaos ws stream failed")
        return


class _PublicStaticFiles(StaticFiles):
    """StaticFiles that serves only the public site assets.

    The mount root is the whole portfolio-website checkout, which also contains
    ``.git``, ``.github``, the backend package and deploy tooling. None of that
    is part of the public site, so anything whose first path segment is not an
    approved web asset is answered with 404 instead of leaking the file.
    """

    ALLOWED_SEGMENTS = frozenset({"index.html", "script.js", "styles.css", "assets"})

    async def get_response(self, path: str, scope) -> PlainTextResponse:
        # Starlette normalizes with os.path.normpath, so on Windows the
        # separator is a backslash and the root path arrives as ".". Split on
        # both separators and drop "." / ".." to be platform-proof.
        segments = [seg for seg in re.split(r"[/\\]+", path) if seg not in (".", "..")]
        if segments and segments[0] not in self.ALLOWED_SEGMENTS:
            return PlainTextResponse("Not Found", status_code=404)
        return await super().get_response(path, scope)


# Serve the static site from the same process so a single port can host both the
# page and its API when running this backend directly (optional; the site is
# usually served separately on 8080).
app.mount("/", _PublicStaticFiles(directory=str(config.SITE_DIR), html=True), name="site")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.BIND_HOST, port=config.BIND_PORT, log_level="info")
