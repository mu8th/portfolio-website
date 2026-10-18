"""Tests for the portfolio demo backend services.

Run from the ``portfolio-website`` directory:

    python -m pytest backend/tests -q

The demos reuse sibling repositories' engines; CI checks them out under
``vendor/`` and points ``PORTFOLIO_SERVER_DIR`` at it (see ci.yml).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

# Make the ``backend`` package importable when tests run from the repo root.
ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend import ratelimit  # noqa: E402
from backend.services import (  # noqa: E402
    chaos,
    contract_diff,
    contract_validate,
    profiling,
    rag,
    repo_stats,
    vuln_scan,
)

# ── Summary and stats ─────────────────────────────────────────────────────


def test_summary_reports_demo_and_quality_numbers() -> None:
    from backend.main import summary

    data = summary()
    assert data["status"] == "operational"
    assert data["live_demos"] == 8
    assert data["python_lines"] > 0
    assert data["test_functions"] > 0
    assert data["ci_workflows"] >= 1
    assert "potential_matches" not in data  # no vulnerability count in the hero
    assert summary() is data  # served from the 10-minute cache


def test_repo_stats_counts_python_files() -> None:
    stats = repo_stats.get_stats()
    assert stats["projects_shipped"] == 5
    assert len(stats["repos"]) == 5
    present = [r for r in stats["repos"] if r["present"]]
    assert present, "expected at least one sibling repo to be present"
    assert any(r["py_loc"] > 0 for r in present)
    assert stats["ci_workflows"] >= 1  # this repository's own CI at least


# ── Contract tester ───────────────────────────────────────────────────────


def _changes() -> dict[str, dict]:
    return {c["target"]: c for c in contract_diff.diff_specs().to_dict()["changes"]}


def test_contract_diff_is_direction_aware() -> None:
    changes = _changes()
    # Request side: clients write the body, so tightening it breaks them.
    assert changes["OrderCreate.payment_method"]["severity"] == "breaking"
    assert changes["OrderCreate.currency"]["kind"] == "now_required"
    assert changes["OrderCreate.currency"]["severity"] == "breaking"
    assert changes["OrderCreate.total"]["severity"] == "breaking"  # number -> integer
    assert changes["OrderCreate.note"]["severity"] == "non-breaking"
    # Response side: clients read the body, so guaranteeing more is safe.
    assert changes["Order.payment_method"]["severity"] == "non-breaking"
    assert changes["Order.currency"]["severity"] == "non-breaking"
    assert changes["Order.total"]["severity"] == "non-breaking"  # integers parse as numbers
    assert changes["Order.email"]["severity"] == "breaking"
    assert changes["Order.total"]["direction"] == "response"


def test_contract_diff_endpoints_lines_and_impact() -> None:
    result = contract_diff.diff_specs().to_dict()
    assert result["status"] == "FAIL"
    assert result["breaking_count"] == 6 and result["non_breaking_count"] == 5
    changes = _changes()
    removed = changes["DELETE /orders/{order_id}"]
    assert removed["kind"] == "removed_endpoint" and removed["severity"] == "breaking"
    old_lines = contract_diff.fixture_texts()["old"].splitlines()
    assert old_lines[removed["old_line"] - 1].strip() == "delete:"
    assert changes["POST /orders/{order_id}/refunds"]["severity"] == "non-breaking"
    assert all(c["impact"] for c in result["changes"])


def test_edited_spec_is_rediffed_and_bad_yaml_names_the_line() -> None:
    texts = contract_diff.fixture_texts()
    assert contract_diff.diff_specs(texts["old"]).to_dict()["changes"] == []
    with pytest.raises(ValueError, match="line 2"):
        contract_diff.diff_specs("openapi: 3.0.3\npaths: [unclosed\n")


def test_response_validation_uses_the_contract_tester_engine() -> None:
    pytest.importorskip("jsonschema")
    if not contract_validate.config.CONTRACT_ENGINE.exists():
        pytest.skip("api-contract-tester checkout not present")
    result = contract_validate.validate(json.dumps(contract_validate.SAMPLE_BODY))
    fields = {v["field_name"]: v for v in result["violations"]}
    assert result["status"] == "FAIL" and result["version"] == "1.3.0"
    assert fields["total"]["actual_type"] == "number" and fields["total"]["breaking_change"]
    assert fields["payment_method"]["actual_type"] == "missing"
    fixed = {**contract_validate.SAMPLE_BODY, "total": 1999, "payment_method": "card"}
    assert contract_validate.validate(json.dumps(fixed))["status"] == "PASS"
    with pytest.raises(ValueError, match="not valid JSON"):
        contract_validate.validate("{")


# ── Profiler ──────────────────────────────────────────────────────────────


def test_profiler_measures_then_confirms_each_fix() -> None:
    before = profiling.run_benchmark([])
    assert before["hot_path"] == "load_orders"  # N+1 dominates wall time
    slow = {f["function_name"]: f for f in before["functions"]}
    assert slow["load_orders"]["waiting_pct"] > 50  # mostly waiting, not computing
    assert all(f["call_count"] == profiling.REPEAT for f in before["functions"])

    after = profiling.run_benchmark(["load_orders", "match_vip", "totals_by_day"])
    fast = {f["function_name"]: f for f in after["functions"]}
    for name in profiling.STEPS:
        assert fast[name]["fixed"]
        assert fast[name]["avg_wall_time_ms"] < slow[name]["avg_wall_time_ms"]
    assert after["report_wall_ms"] * 5 < before["report_wall_ms"]
    assert after["next_fix"] is None
    assert profiling.run_benchmark([])["cached"] is True
    with pytest.raises(ValueError):
        profiling.run_benchmark(["nope"])


def test_profiler_fixes_do_not_change_results() -> None:
    conn, vips = profiling._database()
    rows = profiling.load_orders_slow(conn)
    assert rows == profiling.load_orders_fast(conn)
    assert profiling.match_vip_slow(rows, vips) == profiling.match_vip_fast(rows, vips)
    assert profiling.totals_by_day_slow(rows) == profiling.totals_by_day_fast(rows)


# ── Scanner ───────────────────────────────────────────────────────────────


def test_sample_scan_is_graded_against_labels() -> None:
    result = vuln_scan.scan_sample()
    summary = result["summary"]
    labeled = json.loads((vuln_scan.SAMPLE_DIR / "expected.json").read_text())["lines"]
    graded = [r for r in result["lines"] if r["verdict"] != "false_positive"]
    assert len(graded) == len(labeled)
    assert summary["true_positive"] + summary["missed"] == sum(1 for x in labeled if x.get("flaw"))
    assert summary["recall"] >= 0.8
    # The cross-line flaw is a documented limit of line rules.
    missed = [r for r in result["lines"] if r["verdict"] == "missed"]
    assert any("BASE_QUERY + clause" in r["code"] for r in missed)


def test_snippet_scan_returns_spans() -> None:
    out = vuln_scan.scan_snippet("q = \"SELECT * FROM t WHERE a = '\" + a + \"'\"\nok = 1")
    assert [f["category"] for f in out["findings"]] == ["sqli"]
    assert out["findings"][0]["line"] == 1
    with pytest.raises(ValueError):
        vuln_scan.scan_snippet("x", "cobol")


# ── CodeRAG proxy ─────────────────────────────────────────────────────────


def _mock_urlopen(payload: dict):
    """Build a fake ``urlopen`` returning a canned JSON body from code-rag."""
    import io
    from unittest import mock

    body = io.BytesIO(json.dumps(payload).encode("utf-8"))
    resp = mock.Mock()
    resp.status = 200
    resp.read.return_value = body.read()
    resp.__enter__ = mock.Mock(return_value=resp)
    resp.__exit__ = mock.Mock(return_value=False)
    return mock.patch.object(rag.urllib.request, "urlopen", return_value=resp)


def test_rag_returns_cited_answer_with_passages() -> None:
    payload = {
        "answer": "Chunks are ranked by BM25 [1].",
        "model": "simulated",
        "latency_ms": 1.4,
        "confident": True,
        "best_score": 0.61,
        "sources": [
            {"path": "coderag/services/simulate.py", "symbol": "LexicalIndex",
             "start_line": 159, "end_line": 224, "score": 0.61, "snippet": "class Lexical",
             "text": "class LexicalIndex:\n    ..."},
        ],
    }
    with _mock_urlopen(payload):
        out = rag.ask("How does retrieval rank passages?")
    assert out["status"] == "OK" and out["confident"] is True
    assert out["sources"][0]["text"].startswith("class LexicalIndex")
    assert out["best_score"] == 0.61


def test_rag_passes_through_low_confidence() -> None:
    payload = {"answer": "No confident match in this codebase.", "sources": [],
               "confident": False, "best_score": 0.04, "model": "simulated"}
    with _mock_urlopen(payload):
        out = rag.ask("best pizza recipe")
    assert out["confident"] is False and out["sources"] == []


def test_rag_degrades_gracefully_when_server_down() -> None:
    import urllib.error
    from unittest import mock

    with mock.patch.object(
        rag.urllib.request, "urlopen", side_effect=urllib.error.URLError("connection refused")
    ):
        out = rag.ask("any question")
    assert out["status"] == "ERROR"
    assert out["answer"] == "" and out["sources"] == []


# ── FaultLine ─────────────────────────────────────────────────────────────


def test_chaos_choices_are_validated() -> None:
    chaos.validate_choice("cpu", True)
    chaos.validate_choice("kill", False)
    with pytest.raises(ValueError):
        chaos.validate_choice("latency", True)  # no mitigation offered
    with pytest.raises(ValueError):
        chaos.validate_choice("disk", False)


def test_chaos_specs_apply_the_mitigation() -> None:
    if not (chaos.config.FAULTLINE_PKG / "__init__.py").is_file():
        pytest.skip("faultline checkout not present")
    pytest.importorskip("httpx")
    cpu = chaos._spec("cpu", True)
    env = getattr(cpu.target, "env", None) or {}
    assert env.get("SHOP_WORKLOAD") == "0" or "SHOP_WORKLOAD=0" in cpu.target.command
    assert chaos._spec("kill", False).faults[0].params["restart_after_s"] == 0
    assert chaos._spec("kill", True).faults[0].params["restart_after_s"] == 1
    for spec in (cpu, chaos._spec("latency", False)):
        assert {s.window for s in spec.slo} == {"baseline", "fault", "recovery"}
        assert all(s.p95_latency_ms in (None, chaos.SLO_P95_MS) for s in spec.slo)


def test_chaos_probe_stats_split_orders_and_health() -> None:
    events = [chaos._annotate(e) for e in [
        {"phase": "fault", "message": "POST http://127.0.0.1:9/api/orders -> 201 240.0ms",
         "ok": True, "latency_ms": 240.0},
        {"phase": "fault", "message": "GET http://127.0.0.1:9/health -> 200 3.0ms",
         "ok": True, "latency_ms": 3.0},
        {"phase": "fault", "message": "POST http://127.0.0.1:9/api/orders -> ERR",
         "ok": False, "latency_ms": None},
    ]]
    stats = chaos.probe_stats(events)
    assert stats["orders"]["fault"] == {"samples": 2, "p95_ms": 240.0, "error_rate": 0.5}
    assert stats["health"]["fault"]["p95_ms"] == 3.0


# ── Rate limiting ─────────────────────────────────────────────────────────


def test_rate_limit_window() -> None:
    ratelimit.reset()
    assert ratelimit.check("t", "1.2.3.4", 2, 60) is None
    assert ratelimit.check("t", "1.2.3.4", 2, 60) is None
    wait = ratelimit.check("t", "1.2.3.4", 2, 60)
    assert wait is not None and 0 < wait <= 60
    assert ratelimit.check("t", "5.6.7.8", 2, 60) is None  # other clients unaffected
    ratelimit.reset()
