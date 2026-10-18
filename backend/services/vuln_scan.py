"""Vulnerability-scanner demo, driven by the vulnerability-scanner engine.

The vulnerability-scanner project ships a stdlib-only engine (in
:data:`config.SCANNER_ENGINE`). This service loads it by path and uses it two
ways:

* :func:`scan_sample` scans a small, deliberately vulnerable shop app bundled
  under ``samples/scan_target``. Every planted flaw and every safe look-alike
  is labeled in ``expected.json``, so the demo reports measured precision and
  recall instead of an unexplained count.
* :func:`scan_snippet` scans text a visitor pastes, with the same rules.

The engine is loaded lazily, so the portfolio backend starts even when the
scanner checkout is missing; the endpoints then return an error payload.
"""

from __future__ import annotations

import importlib.util
import json
import tempfile
import time
from pathlib import Path
from typing import Any

from .. import config

SAMPLE_DIR = config.SAMPLES_DIR / "scan_target"

#: Display label per engine category.
LABELS: dict[str, str] = {
    "sqli": "SQL injection",
    "xss": "XSS",
    "secrets": "Hardcoded secret",
    "outdated_deps": "Outdated dependency",
}

#: File name the rules assume for each snippet language.
SNIPPET_FILES: dict[str, str] = {
    "python": "snippet.py",
    "javascript": "snippet.js",
    "config": "settings.env",
}

MAX_SNIPPET_BYTES = 20_000

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


def _map_finding(finding: dict[str, Any], lines: list[str] | None = None) -> dict[str, Any]:
    """Convert one engine finding into the shape the demo uses."""
    location = str(finding.get("location", ""))
    file_part, _, line_part = location.rpartition(":")
    try:
        line_no = int(finding.get("line") or line_part)
    except ValueError:
        line_no = 0
    category = str(finding.get("category", ""))
    code = ""
    if lines is not None and 1 <= line_no <= len(lines):
        code = lines[line_no - 1]
    elif category == "outdated_deps":
        code = str(finding.get("description", ""))
    return {
        "file": file_part,
        "line": line_no,
        "column": finding.get("column"),
        "end_column": finding.get("end_column"),
        "category": category,
        "label": LABELS.get(category, category),
        "severity_score": float(finding.get("severity_score", 0.0)),
        "code": code.rstrip()[:200],
        "remediation": finding.get("remediation_suggestion") or "",
    }


def _expected() -> list[dict[str, Any]]:
    """Load the labels and resolve each one to a (file, line) by its quoted text."""
    labels = json.loads((SAMPLE_DIR / "expected.json").read_text(encoding="utf-8"))["lines"]
    cache: dict[str, list[str]] = {}
    resolved: list[dict[str, Any]] = []
    for label in labels:
        lines = cache.setdefault(
            label["file"],
            (SAMPLE_DIR / label["file"]).read_text(encoding="utf-8").splitlines(),
        )
        line_no = next((i for i, text in enumerate(lines, 1) if label["text"] in text), 0)
        if not line_no:
            raise RuntimeError(f"expected.json label not found: {label['file']}: {label['text']}")
        resolved.append({**label, "line": line_no, "code": lines[line_no - 1].rstrip()})
    return resolved


def scan_sample() -> dict[str, Any]:
    """Scan the labeled sample app and grade the engine against the labels.

    Returns:
        ``lines`` (every labeled line plus any unlabeled finding, each with a
        ``verdict``: true_positive, missed, correctly_ignored or false_positive),
        a ``summary`` with precision and recall, and the raw ``findings``.
    """
    started = time.perf_counter()
    engine = _get_engine()
    result = engine.scan_codebase(str(SAMPLE_DIR))
    file_lines: dict[str, list[str]] = {}

    def lines_of(rel: str) -> list[str]:
        if rel not in file_lines:
            path = SAMPLE_DIR / rel
            text = path.read_text(encoding="utf-8") if path.is_file() else ""
            file_lines[rel] = text.splitlines()
        return file_lines[rel]

    findings = []
    for raw in result.get("vulnerabilities", []):
        if str(raw.get("location", "")).startswith(("README.md", "expected.json")):
            continue
        rel = str(raw.get("location", "")).rpartition(":")[0]
        findings.append(_map_finding(raw, lines_of(rel)))
    by_line = {(f["file"], f["line"]): f for f in findings}

    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, int]] = set()
    for label in _expected():
        key = (label["file"], label["line"])
        seen.add(key)
        found = by_line.get(key)
        flaw = label.get("flaw")
        if flaw:
            verdict = "true_positive" if found and found["category"] == flaw else "missed"
        else:
            verdict = "false_positive" if found else "correctly_ignored"
        rows.append({
            "file": label["file"], "line": label["line"], "code": label["code"],
            "expected": flaw, "why": label.get("why", ""), "finding": found,
            "verdict": verdict, "labeled": True,
        })
    for key, found in by_line.items():
        if key not in seen:
            rows.append({
                "file": found["file"], "line": found["line"], "code": found["code"],
                "expected": None, "why": "Not labeled as a flaw.", "finding": found,
                "verdict": "false_positive", "labeled": False,
            })
    order = {name: i for i, name in enumerate(["shop/db.py", "shop/config.py", "static/app.js",
                                                "requirements.txt"])}
    rows.sort(key=lambda r: (order.get(r["file"], 99), r["line"]))

    counts = {v: sum(1 for r in rows if r["verdict"] == v) for v in
              ("true_positive", "missed", "correctly_ignored", "false_positive")}
    tp, fp, fn = counts["true_positive"], counts["false_positive"], counts["missed"]
    files = sorted({r["file"] for r in rows})
    return {
        "target": "sample shop app",
        "files_scanned": len(files),
        "lines": rows,
        "summary": {
            **counts,
            "precision": round(tp / (tp + fp), 3) if tp + fp else 1.0,
            "recall": round(tp / (tp + fn), 3) if tp + fn else 1.0,
        },
        "findings": findings,
        "scan_time_ms": round((time.perf_counter() - started) * 1000, 2),
    }


def scan_snippet(code: str, language: str = "python") -> dict[str, Any]:
    """Scan pasted code with the engine's rules.

    Uses the engine's in-memory ``scan_text`` when it has one; older engines
    only scan paths, so the snippet is written to a private temporary file.

    Raises:
        ValueError: For an unknown language or a snippet over 20 KB.
    """
    if language not in SNIPPET_FILES:
        raise ValueError("Choose python, javascript or config.")
    if len(code.encode("utf-8")) > MAX_SNIPPET_BYTES:
        raise ValueError("Paste at most 20 KB of code.")
    started = time.perf_counter()
    engine = _get_engine()
    filename = SNIPPET_FILES[language]
    if hasattr(engine, "scan_text"):
        raw = engine.scan_text(code, filename)["vulnerabilities"]
    else:  # pragma: no cover - engine versions before scan_text()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / filename
            path.write_text(code, encoding="utf-8")
            raw = engine.scan_codebase(str(path))["vulnerabilities"]
    lines = code.splitlines()
    findings = sorted((_map_finding(f, lines) for f in raw), key=lambda f: f["line"])
    return {
        "language": language,
        "line_count": len(lines),
        "findings": findings,
        "scan_time_ms": round((time.perf_counter() - started) * 1000, 2),
    }
