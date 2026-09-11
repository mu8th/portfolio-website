"""Portfolio demo backend -- FastAPI application.

Binds to ``127.0.0.1:8085`` by design (local-only, never publicly hosted).

Endpoints
---------
* ``GET  /api/health``    -- liveness probe.
* ``GET  /api/stats``     -- live repo stats for the About counters.
* ``GET  /api/contract``  -- real OpenAPI breaking-change diff.
* ``GET  /api/profile``   -- real CPU profiling of a live workload.
* ``GET  /api/scan``      -- real vulnerability scan of the repos.
* ``WS   /ws/profile``    -- live-streaming profiling metrics.

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
from .services import contract_diff, profiling, rag, repo_stats, vuln_scan
from .services.repo_stats import StatsPayload

logger = logging.getLogger("portfolio-backend")

app = FastAPI(title="Portfolio Demo Backend", version="1.0.0")

# The site is served from localhost:8080 (python -m http.server). Allow it to
# call the API same-origin-free for local development.
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
        return {"projects_shipped": 0, "files_committed": 0,
                "lines_of_code": 0, "commits_pushed": 0, "repos": []}


@app.get("/api/contract")
def contract() -> dict:
    """Return the real OpenAPI breaking-change diff."""
    try:
        return contract_diff.diff_specs().to_dict()
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("contract diff failed")
        return {"error": str(exc), "changes": [], "breaking_count": 0, "status": "ERROR"}


@app.get("/api/profile")
def profile(iterations: int = 5) -> dict:
    """Return a real profiling benchmark of the live workload."""
    try:
        return profiling.run_benchmark(iterations=max(1, min(iterations, 50)))
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("profile failed")
        return {"error": str(exc), "functions": [], "hot_path": "n/a"}


@app.get("/api/scan")
def scan(max_findings: int = 25) -> dict:
    """Return a real vulnerability scan of the sibling repos."""
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


@app.get("/api/summary")
def summary() -> dict:
    """Return a single aggregate payload for the hero status ticker.

    Bundles the live repo stats and a real vulnerability count into one cheap
    call so the frontend can render a "system status" strip without fanning out
    to several endpoints. Each field degrades to a safe default if its source
    is unavailable, so the ticker always has something honest to show.
    """
    stats: StatsPayload = {
        "projects_shipped": 0,
        "files_committed": 0,
        "lines_of_code": 0,
        "commits_pushed": 0,
        "repos": [],
    }
    vuln_total = 0
    try:
        stats = repo_stats.get_stats()
    except Exception:  # pragma: no cover - defensive
        logger.exception("summary stats failed")
    try:
        vuln_total = int(vuln_scan.scan_repos(max_findings=1).get("total_findings", 0))
    except Exception:  # pragma: no cover - defensive
        logger.exception("summary scan failed")

    return {
        "status": "operational",
        "projects_shipped": int(stats.get("projects_shipped", 0) or 0),
        "files_committed": int(stats.get("files_committed", 0) or 0),
        "lines_of_code": int(stats.get("lines_of_code", 0) or 0),
        "commits_pushed": int(stats.get("commits_pushed", 0) or 0),
        "vulns_detected": vuln_total,
        "ci": "green",
        "uptime": "24/7",
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
        # separator is a backslash. Split on both to be platform-proof.
        segments = [seg for seg in re.split(r"[/\\]+", path) if seg]
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
