"""Portfolio demo backend -- FastAPI application.

The app binds to loopback in both local and production deployments. Public
traffic reaches it only through the site's reverse proxy; do not expose the
application port directly.

Endpoints
---------
* ``GET  /api/health``            -- liveness plus which engines are reachable.
* ``GET  /api/stats``             -- file, Python-source, test and commit counts.
* ``GET  /api/summary``           -- hero snapshot (cached for 10 minutes).
* ``GET  /api/contract``          -- v1.2.0 -> v1.3.0 compatibility diff + both specs.
* ``POST /api/contract``          -- diff an edited v1.3.0 against v1.2.0.
* ``POST /api/contract/validate`` -- validate a response body (contract tester engine).
* ``GET  /api/profile``           -- profile the order report with chosen fixes.
* ``GET  /api/scan``              -- graded scan of the labeled vulnerable sample app.
* ``POST /api/scan/snippet``      -- scan pasted code.
* ``POST /api/rag``               -- question to the code-rag server.
* ``GET  /api/chaos``             -- saved FaultLine result for a scenario + run state.
* ``POST /api/chaos/run``         -- start a FaultLine experiment (one at a time).
* ``WS   /ws/chaos``              -- live experiment frames (replay first).
* ``/api/cnc/*``                  -- the three CNC demos (see ``cnc_api``).

Every data endpoint degrades gracefully: if an engine or repo is missing it
returns an error payload the frontend understands instead of a 500. Endpoints
that do real CPU work are rate limited per client (:mod:`backend.ratelimit`).
"""

from __future__ import annotations

import logging
import re
import threading
import time
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config
from .cnc_api import router as cnc_router
from .ratelimit import limit
from .services import (
    chaos,
    contract_diff,
    contract_validate,
    profiling,
    rag,
    repo_stats,
    vuln_scan,
)
from .services.repo_stats import StatsPayload

logger = logging.getLogger("portfolio-backend")

app = FastAPI(title="Portfolio Demo Backend", version="2.0.0")
app.include_router(cnc_router, dependencies=[Depends(limit("cnc", 60, 60))])

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
            "contract_tester": config.CONTRACT_ENGINE.exists(),
            "samples": (config.SAMPLES_DIR / contract_diff.OLD_FILE).exists(),
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
    """Return live repository statistics."""
    try:
        return repo_stats.get_stats()
    except Exception:  # pragma: no cover - defensive
        logger.exception("stats failed")
        return {"projects_shipped": 0, "repository_files": 0, "python_lines": 0,
                "commit_count": 0, "test_functions": 0, "ci_workflows": 0, "repos": []}


_SUMMARY_TTL_S = 600.0
_summary_cache: dict[str, Any] = {}
_summary_lock = threading.Lock()


@app.get("/api/summary")
def summary() -> dict:
    """Hero snapshot: live demos, Python lines, test functions, CI workflows.

    Walking every repo and its git history on each page view would cost the
    shared core real time, and the trees only change on deploy, so the result
    is cached for 10 minutes.
    """
    with _summary_lock:
        cached = _summary_cache.get("value")
        if cached and time.monotonic() - _summary_cache["at"] < _SUMMARY_TTL_S:
            return cached
        try:
            s = repo_stats.get_stats()
        except Exception:  # pragma: no cover - defensive
            logger.exception("summary stats failed")
            s = {"projects_shipped": 0, "python_lines": 0, "test_functions": 0,
                 "ci_workflows": 0}
        value = {
            "status": "operational",
            "live_demos": 8,
            "projects_shipped": int(s.get("projects_shipped", 0) or 0),
            "python_lines": int(s.get("python_lines", 0) or 0),
            "test_functions": int(s.get("test_functions", 0) or 0),
            "ci_workflows": int(s.get("ci_workflows", 0) or 0),
        }
        _summary_cache.update(value=value, at=time.monotonic())
        return value


# ── Contract tester ───────────────────────────────────────────────────────


class SpecInput(BaseModel):
    spec: str = Field(min_length=1, max_length=contract_diff.MAX_SPEC_BYTES)


class ValidateInput(BaseModel):
    body: str = Field(min_length=1, max_length=contract_validate.MAX_BODY_BYTES)
    path: str = Field(default="/orders/{order_id}", max_length=200)
    method: str = Field(default="get", pattern="^(?i:get|post|put|patch|delete)$")
    spec: str | None = Field(default=None, max_length=contract_diff.MAX_SPEC_BYTES)


@app.get("/api/contract")
def contract() -> dict:
    """Diff the bundled fixtures; include both spec texts for the side-by-side view."""
    try:
        texts = contract_diff.fixture_texts()
        return {**contract_diff.diff_specs().to_dict(), "old_spec": texts["old"],
                "new_spec": texts["new"],
                "sample_response": contract_validate.SAMPLE_BODY}
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("contract diff failed")
        return {"error": str(exc), "changes": [], "breaking_count": 0, "status": "ERROR"}


@app.post("/api/contract", dependencies=[Depends(limit("contract", 40, 60))])
def contract_edited(body: SpecInput) -> dict:
    """Diff an edited spec against the bundled v1.2.0."""
    try:
        return contract_diff.diff_specs(body.spec).to_dict()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/contract/validate", dependencies=[Depends(limit("contract", 40, 60))])
def contract_validate_body(body: ValidateInput) -> dict:
    """Validate a response body against the contract with the tester's engine."""
    try:
        return contract_validate.validate(body.body, body.path, body.method.lower(), body.spec)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - engine missing
        logger.exception("contract validation failed")
        return {"status": "ERROR", "error": str(exc), "violations": []}


# ── Profiler ──────────────────────────────────────────────────────────────


@app.get("/api/profile", dependencies=[Depends(limit("profile", 20, 60))])
def profile(fixes: str = "") -> dict:
    """Profile the order report with the comma-separated steps fixed."""
    chosen = [f for f in (part.strip() for part in fixes.split(",")) if f]
    try:
        return profiling.run_benchmark(chosen)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("profile failed")
        return {"error": str(exc), "functions": [], "hot_path": "n/a"}


# ── Scanner ───────────────────────────────────────────────────────────────


class SnippetInput(BaseModel):
    code: str = Field(min_length=1, max_length=vuln_scan.MAX_SNIPPET_BYTES)
    language: str = "python"


@app.get("/api/scan")
def scan() -> dict:
    """Scan the labeled vulnerable sample app and grade the result."""
    try:
        return vuln_scan.scan_sample()
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("scan failed")
        return {"error": str(exc), "lines": [], "summary": {}}


@app.post("/api/scan/snippet", dependencies=[Depends(limit("scan", 40, 60))])
def scan_snippet(body: SnippetInput) -> dict:
    """Scan pasted code with the scanner's rules."""
    try:
        return vuln_scan.scan_snippet(body.code, body.language)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - engine missing
        logger.exception("snippet scan failed")
        return {"error": str(exc), "findings": []}


# ── CodeRAG ───────────────────────────────────────────────────────────────


@app.post("/api/rag", dependencies=[Depends(limit("rag", 30, 60))])
def rag_ask(body: dict) -> dict:
    """Proxy a question to the code-rag server and return its cited answer."""
    question = str(body.get("question", ""))[:240] if isinstance(body, dict) else ""
    try:
        return rag.ask(question)
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("rag ask failed")
        return {"status": "ERROR", "error": str(exc), "answer": "",
                "sources": [], "model": "n/a", "latency_ms": 0}


# ── FaultLine ─────────────────────────────────────────────────────────────


class ChaosInput(BaseModel):
    scenario: str = "cpu"
    mitigation: bool = False


@app.post("/api/chaos/run", dependencies=[Depends(limit("chaos", 4, 600))])
async def chaos_run(body: ChaosInput | None = None) -> dict:
    """Start a FaultLine experiment (one at a time across all visitors)."""
    choice = body or ChaosInput()
    try:
        return await chaos.start_run(choice.scenario, choice.mitigation)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("chaos run failed to start")
        return {"started": False, "busy": False, "error": str(exc)}


@app.get("/api/chaos")
def chaos_status(scenario: str = "cpu", mitigation: bool = False) -> dict:
    """Saved result for a scenario, plus whether a run is in flight."""
    try:
        return chaos.status(scenario, mitigation)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("chaos status failed")
        return {"engine": False, "busy": False, "last": None, "error": str(exc)}


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

    ALLOWED_SEGMENTS = frozenset({"index.html", "script.js", "styles.css", "assets",
                                  "robots.txt", "sitemap.xml"})

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
