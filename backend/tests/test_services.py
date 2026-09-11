"""Tests for the portfolio demo backend services.

Run from the ``portfolio-website`` directory:

    python -m pytest backend/tests -q

These tests assert that every demo service returns *real* data (not canned
constants): the contract diff finds the expected breaking changes, the profiler
produces positive CPU timings, and the scanner finds real hits in the repos.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Make the ``backend`` package importable when tests run from the repo root.
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.main import summary  # noqa: E402
from backend.services import contract_diff, profiling, rag, repo_stats, vuln_scan  # noqa: E402


def test_summary_aggregates_real_metrics() -> None:
    """The hero ticker's single-call payload must carry honest, real numbers."""
    data = summary()
    assert data["status"] == "operational"
    # These mirror the live repo stats, so they must be positive and consistent.
    assert data["projects_shipped"] == 4
    assert data["files_committed"] > 0
    assert data["lines_of_code"] > 0
    assert data["commits_pushed"] >= 0
    # The real repos contain at least one genuine finding (compose secrets).
    assert data["vulns_detected"] >= 1
    assert data["ci"] == "green"


def test_contract_diff_finds_breaking_changes() -> None:
    result = contract_diff.diff_specs()
    assert result.breaking_count >= 4, f"expected >=4 breaking changes, got {result.breaking_count}"
    d = result.to_dict()
    assert d["status"] == "FAIL"
    kinds = {c.kind for c in result.changes}
    # The v1.2.0 -> v1.3.0 bump must surface these real classes of change.
    assert "removed_endpoint" in kinds  # DELETE /orders/{id}
    assert "removed_field" in kinds  # Order.email
    assert "type_change" in kinds  # Order.total number -> integer
    assert "added_required_field" in kinds  # Order.payment_method
    assert "added_endpoint" in kinds  # POST /orders/{id}/refunds


def test_profiling_returns_real_cpu_timings() -> None:
    result = profiling.run_benchmark(iterations=3, n=50_000)
    assert result["functions"], "expected at least one profiled function"
    assert result["total_cpu_time"] > 0, "total CPU time must be positive (real timing)"
    assert result["hot_path"] != "n/a"
    total_pct = sum(f["cpu_pct"] for f in result["functions"])
    assert 99.0 <= total_pct <= 101.0, f"percentages should sum to ~100, got {total_pct}"
    # Call counts must reflect the requested iterations (aggregated per name).
    for f in result["functions"]:
        assert f["call_count"] == 3


def test_repo_stats_counts_python_files() -> None:
    stats = repo_stats.get_stats()
    assert stats["projects_shipped"] == 4
    assert stats["files_committed"] > 0
    assert stats["lines_of_code"] > 0
    assert len(stats["repos"]) == 4
    # At least one repo should be present and have Python LOC.
    present = [r for r in stats["repos"] if r["present"]]
    assert present, "expected at least one sibling repo to be present"
    assert any(r["py_loc"] > 0 for r in present)
    # The project suites are real and non-trivial. CI only checks out two of
    # the four sibling repos, so scale the floor by what is actually present:
    # each present repo ships 15+ tests, plus this backend's own suite (7).
    assert stats["automated_tests"] >= len(present) * 15 + 5


def test_vuln_scan_finds_real_findings() -> None:
    result = vuln_scan.scan_repos()
    assert result["repos_scanned"] == 4
    # The real repos contain at least one genuine secret (compose passwords),
    # so a real scan must find something.
    assert result["total_findings"] >= 1, "expected at least one real finding"
    assert result["findings"], "expected a non-empty findings list"
    for f in result["findings"]:
        assert f["line"] >= 1
        assert f["severity_score"] > 0
        valid_repos = (
            "api-contract-tester", "performance-profiler",
            "vulnerability-scanner", "code-rag",
        )
        assert f["repo"] in valid_repos


def _mock_urlopen(payload: dict):
    """Build a fake ``urlopen`` returning a canned JSON body from code-rag."""
    import io
    import json
    from unittest import mock

    body = io.BytesIO(json.dumps(payload).encode("utf-8"))
    resp = mock.Mock()
    resp.status = 200
    resp.read.return_value = body.read()
    resp.__enter__ = mock.Mock(return_value=resp)
    resp.__exit__ = mock.Mock(return_value=False)
    return mock.patch.object(rag.urllib.request, "urlopen", return_value=resp)


def test_rag_returns_cited_answer() -> None:
    """A successful code-rag response must surface the answer and its sources."""
    payload = {
        "answer": "Chunks are ranked by cosine similarity to the query embedding.",
        "model": "test-model",
        "latency_ms": 1234.6,
        "sources": [
            {
                "path": "coderag/retrieval.py",
                "symbol": "rank",
                "start_line": 42,
                "score": 0.87,
                "snippet": "x",
            },
            {
                "path": "coderag/embed.py",
                "symbol": "embed",
                "start_line": 18,
                "score": 0.63,
                "snippet": "y",
            },
        ],
    }
    with _mock_urlopen(payload):
        out = rag.ask("How does retrieval rank chunks?")
    assert out["status"] == "OK"
    assert "cosine similarity" in out["answer"]
    assert len(out["sources"]) == 2
    assert out["sources"][0]["path"] == "coderag/retrieval.py"
    assert out["latency_ms"] == 1235
    assert out["model"] == "test-model"


def test_rag_degrades_gracefully_when_server_down() -> None:
    """If the code-rag server is unreachable, return an ERROR payload, not raise."""
    import urllib.error
    from unittest import mock

    with mock.patch.object(
        rag.urllib.request, "urlopen", side_effect=urllib.error.URLError("connection refused")
    ):
        out = rag.ask("any question")
    assert out["status"] == "ERROR"
    assert out["answer"] == ""
    assert out["sources"] == []
    assert out["model"] == "n/a"
