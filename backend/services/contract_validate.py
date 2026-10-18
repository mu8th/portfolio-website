"""Validate a response body against a contract with the API Contract Tester engine.

The api-contract-tester project's enforcer (:data:`config.CONTRACT_ENGINE`)
extracts an operation's 200-response schema from an OpenAPI document, converts
it to JSON Schema and reports field-level violations, marking missing required
fields and type mismatches as breaking. This service loads that module by path,
the same way the scanner demo loads its engine, and runs only its validation
step on a body the visitor supplies. No live HTTP call is made.
"""

from __future__ import annotations

import importlib.util
import json
from typing import Any

from .. import config
from . import contract_diff

#: Bound on a pasted response body.
MAX_BODY_BYTES = 20_000

_engine: Any = None

#: A response a v1.2.0 server would send for GET /orders/{order_id}.
SAMPLE_BODY: dict[str, Any] = {
    "id": "3f2c9a1e-8b7d-4e2a-9c11-5d4e6f7a8b90",
    "email": "ada@example.com",
    "total": 19.99,
    "status": "paid",
    "currency": "USD",
}


def _get_engine() -> Any:
    """Import the api-contract-tester enforcer module by absolute path (cached)."""
    global _engine
    if _engine is None:
        spec = importlib.util.spec_from_file_location(
            "api_contract_enforcer", str(config.CONTRACT_ENGINE)
        )
        if spec is None or spec.loader is None:
            raise RuntimeError(f"Cannot load contract engine from {config.CONTRACT_ENGINE}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _engine = module
    return _engine


def validate(
    body_text: str,
    path: str = "/orders/{order_id}",
    method: str = "get",
    spec_text: str | None = None,
) -> dict[str, Any]:
    """Validate a JSON response body against an operation's 200-response schema.

    Args:
        body_text: The response body as JSON text.
        path: Operation path as written in the spec.
        method: HTTP method of the operation.
        spec_text: Contract to validate against; defaults to the bundled v1.3.0.

    Returns:
        ``{"violations": [...], "breaking": n, "path", "method", "version"}``.

    Raises:
        ValueError: For an oversized or non-JSON body, an unparseable spec, or
            an operation with no 200 JSON response schema.
    """
    if len(body_text.encode("utf-8")) > MAX_BODY_BYTES:
        raise ValueError("Response body is larger than the 20 KB demo limit.")
    try:
        body = json.loads(body_text)
    except json.JSONDecodeError as exc:
        where = f"line {exc.lineno}, column {exc.colno}"
        raise ValueError(f"Body is not valid JSON ({where}).") from exc
    text = spec_text if spec_text is not None else contract_diff.fixture_texts()["new"]
    spec = contract_diff.parse_spec(text)
    engine = _get_engine()
    raw = engine.get_response_schema(spec, path, method)
    if raw is None:
        raise ValueError(f"{method.upper()} {path} has no 200 JSON response schema in this spec.")
    schema = engine.openapi_to_jsonschema(raw, spec)
    violations = [v.model_dump() for v in engine.validate_response(schema, body)]
    return {
        "path": path,
        "method": method.upper(),
        "version": str((spec.get("info") or {}).get("version", "")),
        "violations": violations,
        "breaking": sum(1 for v in violations if v["breaking_change"]),
        "status": "FAIL" if violations else "PASS",
    }
