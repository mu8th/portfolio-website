"""Direction-aware OpenAPI compatibility diff for the portfolio demo.

Compares two versions of an OpenAPI document and classifies every change as
breaking or non-breaking for *existing clients*. The same edit can go either
way depending on where a schema is used:

* In a **request** body, clients are the writers. A new required field, an
  optional field becoming required, or a narrower type (number -> integer)
  breaks clients that send what used to be valid.
* In a **response** body, clients are the readers. Removing a field or widening
  a type breaks them; a new field, a field becoming always-present, or a
  narrower type (an integer still parses as a number) does not.

Schemas referenced from both directions get the stricter verdict, and schemas
referenced from neither are treated as both, so an unknown is never reported
as safe. Every change carries the line it sits on in each document and a
plain-English ``impact`` so the demo can show what a client would experience.

The bundled "Orders API" fixtures (v1.2.0 -> v1.3.0) live in
:data:`config.SAMPLES_DIR`; :func:`diff_texts` diffs any edited version
against them. This is a focused compatibility checker, not a complete OpenAPI
diff: it covers endpoints, component schemas and their top-level properties.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import yaml

from .. import config

#: Bound on an edited spec submitted from the demo.
MAX_SPEC_BYTES = 50_000

OLD_FILE = "orders_v1.2.0.yaml"
NEW_FILE = "orders_v1.3.0.yaml"

_METHODS = {"get", "put", "post", "delete", "patch", "head", "options", "trace"}


@dataclass
class Change:
    """A single classified spec change."""

    kind: str  # removed_endpoint | added_endpoint | removed_field | added_field | ...
    severity: str  # breaking | non-breaking
    target: str  # endpoint or fully-qualified field
    detail: str  # what changed, in plain words
    impact: str = ""  # what an existing client experiences
    direction: str = ""  # request | response | both | "" for endpoints
    old_line: int | None = None
    new_line: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "severity": self.severity,
            "target": self.target,
            "detail": self.detail,
            "impact": self.impact,
            "direction": self.direction,
            "old_line": self.old_line,
            "new_line": self.new_line,
        }


@dataclass
class DiffResult:
    """Aggregated result of diffing two OpenAPI specs."""

    old_version: str
    new_version: str
    changes: list[Change] = field(default_factory=list)

    @property
    def breaking_count(self) -> int:
        return sum(1 for c in self.changes if c.severity == "breaking")

    @property
    def non_breaking_count(self) -> int:
        return sum(1 for c in self.changes if c.severity == "non-breaking")

    def to_dict(self) -> dict[str, Any]:
        return {
            "old_version": self.old_version,
            "new_version": self.new_version,
            "changes": [c.to_dict() for c in self.changes],
            "breaking_count": self.breaking_count,
            "non_breaking_count": self.non_breaking_count,
            "status": "FAIL" if self.breaking_count else "PASS",
        }


# ── Parsing and line locations ────────────────────────────────────────────


def parse_spec(text: str) -> dict[str, Any]:
    """Parse OpenAPI YAML (or JSON) text into a mapping.

    Raises:
        ValueError: With a line-specific message when the text is not a YAML
            mapping or exceeds :data:`MAX_SPEC_BYTES`.
    """
    if len(text.encode("utf-8")) > MAX_SPEC_BYTES:
        raise ValueError("Spec is larger than the 50 KB demo limit.")
    try:
        doc = yaml.safe_load(text)
    except yaml.YAMLError as exc:
        mark = getattr(exc, "problem_mark", None)
        where = f" on line {mark.line + 1}" if mark is not None else ""
        problem = getattr(exc, "problem", None) or "invalid YAML"
        raise ValueError(f"YAML error{where}: {problem}.") from exc
    if not isinstance(doc, dict):
        raise ValueError("The spec must be a YAML mapping (an OpenAPI document).")
    return doc


def _line_map(text: str) -> dict[tuple[str, ...], int]:
    """Map every mapping-key path in the YAML text to its 1-based line."""
    lines: dict[tuple[str, ...], int] = {}
    try:
        root = yaml.compose(text)
    except yaml.YAMLError:
        return lines

    def walk(node: Any, path: tuple[str, ...]) -> None:
        if isinstance(node, yaml.MappingNode):
            for key, value in node.value:
                if isinstance(key, yaml.ScalarNode):
                    child = (*path, str(key.value))
                    lines[child] = key.start_mark.line + 1
                    walk(value, child)

    walk(root, ())
    return lines


def _load_fixture(name: str) -> str:
    return (config.SAMPLES_DIR / name).read_text(encoding="utf-8")


def fixture_texts() -> dict[str, str]:
    """Return the bundled old and new spec texts."""
    return {"old": _load_fixture(OLD_FILE), "new": _load_fixture(NEW_FILE)}


# ── Schema usage (request vs response) ────────────────────────────────────


def _refs(node: Any) -> set[str]:
    """Collect component schema names referenced anywhere under ``node``."""
    found: set[str] = set()
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
            found.add(ref.rsplit("/", 1)[-1])
        for value in node.values():
            found |= _refs(value)
    elif isinstance(node, list):
        for value in node:
            found |= _refs(value)
    return found


def _usage(spec: dict[str, Any]) -> dict[str, set[str]]:
    """Map schema name -> {"request", "response"} directions it is used in.

    References are followed through nested schemas, so a schema embedded in a
    response schema is a response schema too.
    """
    schemas = _schemas(spec)
    direct: dict[str, set[str]] = {}
    for item in (spec.get("paths") or {}).values():
        if not isinstance(item, dict):
            continue
        for method, op in item.items():
            if method.lower() not in _METHODS or not isinstance(op, dict):
                continue
            for name in _refs(op.get("requestBody")) | _refs(op.get("parameters")):
                direct.setdefault(name, set()).add("request")
            for name in _refs(op.get("responses")):
                direct.setdefault(name, set()).add("response")

    usage: dict[str, set[str]] = {name: set(dirs) for name, dirs in direct.items()}
    changed = True
    while changed:
        changed = False
        for name, dirs in list(usage.items()):
            for child in _refs(schemas.get(name)):
                before = len(usage.setdefault(child, set()))
                usage[child] |= dirs
                changed |= len(usage[child]) != before
    return usage


def _direction(name: str, old_usage: dict, new_usage: dict) -> str:
    dirs = old_usage.get(name, set()) | new_usage.get(name, set())
    if dirs == {"request"}:
        return "request"
    if dirs == {"response"}:
        return "response"
    return "both"  # used both ways, or unreferenced: assume the stricter case


# ── Diff ──────────────────────────────────────────────────────────────────


def _endpoints(spec: dict[str, Any]) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for path, item in (spec.get("paths") or {}).items():
        if not isinstance(item, dict):
            continue
        for method in item:
            if method.lower() in _METHODS:
                out.append((path, method.lower()))
    return out


def _schemas(spec: dict[str, Any]) -> dict[str, Any]:
    return ((spec.get("components") or {}).get("schemas")) or {}


def _fields(schema: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(schema, dict):
        return {}
    required = set(schema.get("required") or [])
    out: dict[str, dict[str, Any]] = {}
    for name, prop in (schema.get("properties") or {}).items():
        if isinstance(prop, dict):
            out[name] = {"type": prop.get("type"), "required": name in required}
    return out


def _type_verdict(old: Any, new: Any, direction: str) -> tuple[str, str]:
    """Classify a property type change; returns (severity, impact)."""
    narrowing = (old, new) == ("number", "integer")
    widening = (old, new) == ("integer", "number")
    if narrowing:
        if direction == "response":
            return "non-breaking", "Integers still parse as numbers, so readers are unaffected."
        return "breaking", f"A client sending a decimal such as 19.99 is rejected ({new} expected)."
    if widening:
        if direction == "request":
            return "non-breaking", "Every integer clients already send is still a valid number."
        return "breaking", "Readers that expect whole numbers can now receive decimals."
    return "breaking", f"Clients built for {old} values get {new} values instead."


def _diff(old: dict[str, Any], new: dict[str, Any], old_text: str, new_text: str) -> DiffResult:
    old_lines, new_lines = _line_map(old_text), _line_map(new_text)
    result = DiffResult(
        old_version=str((old.get("info") or {}).get("version", "old")),
        new_version=str((new.get("info") or {}).get("version", "new")),
    )

    old_eps, new_eps = set(_endpoints(old)), set(_endpoints(new))
    for path, method in sorted(old_eps - new_eps):
        result.changes.append(Change(
            "removed_endpoint", "breaking", f"{method.upper()} {path}",
            "endpoint removed",
            f"Clients calling {method.upper()} {path} now get 404 or 405.",
            old_line=old_lines.get(("paths", path, method)),
            new_line=new_lines.get(("paths", path)),
        ))
    for path, method in sorted(new_eps - old_eps):
        result.changes.append(Change(
            "added_endpoint", "non-breaking", f"{method.upper()} {path}",
            "new endpoint",
            "Existing clients never call it, so nothing changes for them.",
            new_line=new_lines.get(("paths", path, method)),
        ))

    old_usage, new_usage = _usage(old), _usage(new)
    old_schemas, new_schemas = _schemas(old), _schemas(new)
    for name in sorted(old_schemas):
        base = ("components", "schemas", name)
        if name not in new_schemas:
            result.changes.append(Change(
                "removed_schema", "breaking", f"schemas.{name}", f"schema {name} removed",
                f"Every operation that used {name} changes shape.",
                old_line=old_lines.get(base),
            ))
            continue
        direction = _direction(name, old_usage, new_usage)
        before, after = _fields(old_schemas[name]), _fields(new_schemas[name])
        for fname in sorted(before.keys() | after.keys()):
            prop = (*base, "properties", fname)
            target = f"{name}.{fname}"
            o, n = before.get(fname), after.get(fname)
            lines = {"old_line": old_lines.get(prop), "new_line": new_lines.get(prop)}
            if o and not n:
                if direction == "request":
                    severity = "non-breaking"
                    impact = f"Clients that still send {fname} have it ignored."
                else:
                    severity = "breaking"
                    impact = f"Clients reading {name}.{fname} get nothing back."
                req = "required" if o["required"] else "optional"
                result.changes.append(Change(
                    "removed_field", severity, target, f"{req} field {fname} removed",
                    impact, direction, **lines,
                ))
            elif n and not o:
                if n["required"] and direction != "response":
                    result.changes.append(Change(
                        "added_required_field", "breaking", target,
                        f"new required field {fname}",
                        f"Requests from existing clients omit {fname} and are rejected with 422.",
                        direction, **lines,
                    ))
                else:
                    req = "required" if n["required"] else "optional"
                    impact = (
                        "Existing clients ignore a field they do not know about."
                        if direction == "response"
                        else f"Existing clients do not send {fname}; it is optional, so "
                        "their requests still validate."
                    )
                    result.changes.append(Change(
                        "added_field", "non-breaking", target, f"new {req} field {fname}",
                        impact, direction, **lines,
                    ))
            elif o and n:
                if o["type"] != n["type"]:
                    severity, impact = _type_verdict(o["type"], n["type"], direction)
                    result.changes.append(Change(
                        "type_change", severity, target,
                        f"type {o['type']} -> {n['type']}", impact, direction, **lines,
                    ))
                if not o["required"] and n["required"]:
                    if direction == "response":
                        severity = "non-breaking"
                        impact = f"Responses now always include {fname}; readers lose nothing."
                    else:
                        severity = "breaking"
                        impact = f"Requests that omit {fname} are now rejected with 422."
                    result.changes.append(Change(
                        "now_required", severity, target, f"{fname} is now required",
                        impact, direction, **lines,
                    ))
                elif o["required"] and not n["required"]:
                    if direction == "request":
                        severity = "non-breaking"
                        impact = f"Clients may keep sending {fname}; it is simply optional now."
                    else:
                        severity = "breaking"
                        impact = f"Readers that assume {fname} is always present can fail."
                    result.changes.append(Change(
                        "now_optional", severity, target, f"{fname} is now optional",
                        impact, direction, **lines,
                    ))
    for name in sorted(set(new_schemas) - set(old_schemas)):
        result.changes.append(Change(
            "added_schema", "non-breaking", f"schemas.{name}", f"schema {name} added",
            "A new schema changes nothing for existing clients.",
            new_line=new_lines.get(("components", "schemas", name)),
        ))
    return result


def diff_texts(old_text: str, new_text: str) -> DiffResult:
    """Diff two OpenAPI documents given as YAML/JSON text.

    Raises:
        ValueError: If either document cannot be parsed (message names the line).
    """
    return _diff(parse_spec(old_text), parse_spec(new_text), old_text, new_text)


def diff_specs(new_text: str | None = None) -> DiffResult:
    """Diff the bundled v1.2.0 fixture against v1.3.0, or against ``new_text``."""
    texts = fixture_texts()
    return diff_texts(texts["old"], texts["new"] if new_text is None else new_text)
