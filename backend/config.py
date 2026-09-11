"""Runtime configuration for the portfolio demo backend.

All paths are resolved from this file's location so the backend works no matter
what the current working directory is at launch. The portfolio project
repositories are expected to live as siblings of the ``portfolio-website``
checkout, all under one shared projects directory (override with the
``PORTFOLIO_SERVER_DIR`` environment variable).
"""

from __future__ import annotations

import os
from pathlib import Path

# portfolio-website/backend
BACKEND_DIR: Path = Path(__file__).resolve().parent
# portfolio-website (owns the static site)
SITE_DIR: Path = BACKEND_DIR.parent
# Developer home that holds the sibling project repositories
SERVER_DIR: Path = Path(os.environ.get("PORTFOLIO_SERVER_DIR", str(SITE_DIR.parent)))

#: Repository names used for live stats and the real vulnerability scan.
REPO_NAMES: tuple[str, ...] = (
    "api-contract-tester",
    "performance-profiler",
    "vulnerability-scanner",
    "code-rag",
)

# Sibling repository directories.
PERF_PROFILER_DIR: Path = SERVER_DIR / "performance-profiler"
VULN_SCANNER_DIR: Path = SERVER_DIR / "vulnerability-scanner"
CODE_RAG_DIR: Path = SERVER_DIR / "code-rag"

#: The code-rag demo server (separate FastAPI app) that the RAG demo proxies to.
#: Localhost only by design. Override via the environment if it runs elsewhere.
CODE_RAG_HOST: str = os.environ.get("CODE_RAG_HOST", "127.0.0.1")
CODE_RAG_PORT: int = int(os.environ.get("CODE_RAG_PORT", "8090"))

# The real engines we reuse (not copies) so demos are backed by the projects'
# actual code.
PROFILER_LIB: Path = PERF_PROFILER_DIR / "profiler.py"
SCANNER_ENGINE: Path = VULN_SCANNER_DIR / "backend" / "services" / "scanner.py"

# Bundled OpenAPI sample specs used by the contract-diff demo.
SAMPLES_DIR: Path = BACKEND_DIR / "samples"

# Network binding. Localhost only by design (never publicly hosted).
BIND_HOST: str = os.environ.get("PORTFOLIO_HOST", "127.0.0.1")
BIND_PORT: int = int(os.environ.get("PORTFOLIO_PORT", "8085"))

#: Directories excluded from file walks (VCS, caches, virtualenvs).
WALK_SKIP: frozenset[str] = frozenset(
    {
        ".git",
        "__pycache__",
        "node_modules",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        ".venv",
        "venv",
    }
)
