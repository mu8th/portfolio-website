"""Real vulnerability scanning, driven by the vulnerability-scanner's real engine.

The vulnerability-scanner project ships a stdlib-only static analysis engine (in
:data:`config.SCANNER_ENGINE`) that walks a directory tree, applies compiled
regex heuristics for SQLi, XSS, and hardcoded secrets to every scannable text
file, and checks pinned dependency versions against a small offline advisory
table. Its own API is built on top of the same ``scan_codebase()`` function, so
this service calls that real function once per sibling repository instead of
re-implementing any of the scanning logic here.

Findings therefore reflect the actual code on disk (for example the
``POSTGRES_PASSWORD=*** secrets in the compose files), not canned data. The
engine is loaded lazily on first use so the portfolio backend can start even
when the vulnerability-scanner checkout is missing; affected endpoints then return an
error payload instead of crashing at import time.
"""

from __future__ import annotations

import importlib.util
import time
from typing import Any

from .. import config

# Map engine category -> display label used by the frontend scan visual.
_LABELS: dict[str, str] = {
    "sqli": "SQLi",
    "xss": "XSS",
    "secrets": "Secret",
    "outdated_deps": "Outdated dep",
}

_engine: Any = None


def _get_engine() -> Any:
    """Import the vulnerability-scanner engine module by absolute path (cached)."""
    global _engine
    if _engine is None:
        spec = importlib.util.spec_from_file_location(
            "vuln_scanner_engine", str(config.SCANNER_ENGINE)
        )
        if spec is None or spec.loader is None:
            raise RuntimeError(f"Cannot load scanner engine from {config.SCANNER_ENGINE}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _engine = module
    return _engine


def _map_finding(repo_name: str, finding: dict[str, Any]) -> dict[str, Any]:
    """Convert one engine finding into the shape the frontend scan visual uses.

    The engine reports ``location`` as ``"relative/path:lineno"`` and a
    human-readable ``description``; the demo visual wants separate fields plus
    the offending source line, which for pattern findings is embedded in the
    description after a fixed prefix.
    """
    location = str(finding.get("location", ""))
    file_part, _, line_part = location.rpartition(":")
    try:
        line_no = int(line_part)
    except ValueError:
        line_no = 0

    category = str(finding.get("category", ""))
    description = str(finding.get("description", ""))
    if category == "outdated_deps":
        code = description
    else:
        prefix = f"Suspicious {category} pattern on line {line_no}: "
        code = description[len(prefix):] if description.startswith(prefix) else description

    return {
        "repo": repo_name,
        "file": file_part,
        "line": line_no,
        "category": category,
        "label": _LABELS.get(category, category),
        "severity_score": float(finding.get("severity_score", 0.0)),
        "code": code[:120],
    }


def _select_shown(findings: list[dict[str, Any]], max_findings: int) -> list[dict[str, Any]]:
    """Pick which findings the demo visual shows.

    A pure severity cut would fill the whole card with a single category (the
    repos contain far more XSS sinks than anything else), so the selection is
    category-aware: categories are interleaved round-robin up to half the budget,
    then the remainder fills strictly by severity. The result still reads
    worst-first and every class of flaw the engine found stays represented.
    """
    by_cat: dict[str, list[dict[str, Any]]] = {}
    for f in findings:
        by_cat.setdefault(f["category"], []).append(f)
    # Categories ordered by their most severe finding.
    cats = sorted(by_cat, key=lambda c: -max(x["severity_score"] for x in by_cat[c]))
    cap = max(1, max_findings // 2)
    taken: dict[str, int] = {c: 0 for c in cats}
    shown: list[dict[str, Any]] = []
    while len(shown) < max_findings:
        progressed = False
        for c in cats:
            if len(shown) >= max_findings:
                break
            if taken[c] >= cap or taken[c] >= len(by_cat[c]):
                continue
            shown.append(by_cat[c][taken[c]])
            taken[c] += 1
            progressed = True
        if not progressed:
            break
    # Fill any leftover budget with the most severe findings not yet shown.
    shown_ids = {id(f) for f in shown}
    for f in findings:
        if len(shown) >= max_findings:
            break
        if id(f) not in shown_ids:
            shown.append(f)
    shown.sort(key=lambda f: (-f["severity_score"], f["repo"], f["file"], f["line"]))
    return shown


def scan_repos(max_findings: int = 25) -> dict[str, Any]:
    """Scan all sibling repos with the vulnerability-scanner's real ``scan_codebase()``.

    Args:
        max_findings: Upper bound on returned findings (category-aware selection,
            worst-first within the shown set).

    Returns:
        A dict with total counts, a severity breakdown, and the ordered
        ``findings`` list that drives the scanner demo visual.

    Raises:
        RuntimeError: If the vulnerability-scanner engine cannot be loaded.
    """
    started = time.perf_counter()
    engine = _get_engine()

    all_findings: list[dict[str, Any]] = []
    for name in config.REPO_NAMES:
        repo_dir = config.SERVER_DIR / name
        if not repo_dir.is_dir():
            continue
        result = engine.scan_codebase(str(repo_dir))
        for finding in result.get("vulnerabilities", []):
            all_findings.append(_map_finding(name, finding))

    # Order: most severe first, then stable by repo/file/line.
    all_findings.sort(key=lambda f: (-f["severity_score"], f["repo"], f["file"], f["line"]))
    shown = _select_shown(all_findings, max_findings)

    breakdown = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    sev_bucket = {1.0: "critical", 0.8: "high", 0.5: "medium", 0.2: "low"}
    for f in all_findings:
        breakdown[sev_bucket.get(f["severity_score"], "low")] += 1

    return {
        "repos_scanned": len(config.REPO_NAMES),
        "total_findings": len(all_findings),
        "shown_findings": len(shown),
        "severity_breakdown": breakdown,
        "scan_time_ms": round((time.perf_counter() - started) * 1000, 2),
        "findings": shown,
    }
