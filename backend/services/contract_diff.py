"""Real OpenAPI breaking-change detection.

The portfolio's "API Contract Tester" project is meant to maintain *living
contracts* between an OpenAPI spec and its deployed behaviour. The engine that
used to back it was a stub (and had a broken import), so this module implements
the thing for real: it loads two versions of an OpenAPI spec and classifies every
change that would break an existing client.

The demo diffs the same "Orders API" across two versions (v1.2.0 -> v1.3.0) that
live in :data:`config.SAMPLES_DIR`, so the visual shows genuine, reproducible
breaking changes rather than scripted lines.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import yaml

from .. import config


@dataclass
class Change:
    """A single classified spec change."""

    kind: str  # removed_endpoint | removed_field | added_required_field | type_change
    severity: str  # breaking | non-breaking
    target: str  # path or fully-qualified field
    detail: str  # human-readable description

    def to_dict(self) -> dict[str, str]:
        return {
            "kind": self.kind,
            "severity": self.severity,
            "target": self.target,
            "detail": self.detail,
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

    def to_dict(self) -> dict[str, object]:
        return {
            "old_version": self.old_version,
            "new_version": self.new_version,
            "changes": [c.to_dict() for c in self.changes],
            "breaking_count": self.breaking_count,
            "non_breaking_count": self.non_breaking_count,
            "status": "FAIL" if self.breaking_count else "PASS",
        }


def _load(paths: dict[str, str]) -> dict:
    """Load the two sample specs from disk into plain dicts."""
    old_raw = (config.SAMPLES_DIR / paths["old"]).read_text(encoding="utf-8")
    new_raw = (config.SAMPLES_DIR / paths["new"]).read_text(encoding="utf-8")
    old = yaml.safe_load(old_raw) or {}
    new = yaml.safe_load(new_raw) or {}
    return {"old": old, "new": new}


def _endpoints(spec: dict) -> dict[str, set]:
    """Map HTTP method -> set of path keys for a spec."""
    eps: dict[str, set] = {}
    for path, item in (spec.get("paths") or {}).items():
        if not isinstance(item, dict):
            continue
        for method in item:
            eps.setdefault(method.lower(), set()).add(path)
    return eps


def _schemas(spec: dict) -> dict:
    """Return the ``components.schemas`` map (empty if absent)."""
    return ((spec.get("components") or {}).get("schemas")) or {}


def _field_types(schema: dict) -> dict[str, dict]:
    """Flatten a schema object to field -> {type, required}."""
    props = schema.get("properties") or {}
    required = set(schema.get("required") or [])
    out: dict[str, dict] = {}
    for name, prop in props.items():
        if not isinstance(prop, dict):
            continue
        out[name] = {"type": prop.get("type"), "required": name in required}
    return out


def _diff_endpoints(old: dict, new: dict, result: DiffResult) -> None:
    old_eps = _endpoints(old)
    new_eps = _endpoints(new)
    # Removed endpoints or removed methods on existing endpoints are breaking.
    for method, paths in old_eps.items():
        kept = new_eps.get(method, set())
        for path in paths - kept:
            result.changes.append(
                Change("removed_endpoint", "breaking", path, f"{method.upper()} {path} removed")
            )
    # New endpoints are additive.
    for method, paths in new_eps.items():
        was = old_eps.get(method, set())
        for path in paths - was:
            result.changes.append(
                Change("added_endpoint", "non-breaking", path, f"{method.upper()} {path} added")
            )


def _diff_schemas(old: dict, new: dict, result: DiffResult) -> None:
    old_schemas = _schemas(old)
    new_schemas = _schemas(new)
    for name in old_schemas:
        if name not in new_schemas:
            result.changes.append(
                Change("removed_schema", "breaking", f"schemas.{name}", f"schema '{name}' removed")
            )
            continue
        old_fields = _field_types(old_schemas[name])
        new_fields = _field_types(new_schemas[name])
        for fname, oldf in old_fields.items():
            if fname not in new_fields:
                result.changes.append(
                    Change(
                        "removed_field",
                        "breaking",
                        f"schemas.{name}.{fname}",
                        f"field '{fname}' removed (required={oldf['required']})",
                    )
                )
                continue
            newf = new_fields[fname]
            if oldf["type"] != newf["type"]:
                result.changes.append(
                    Change(
                        "type_change",
                        "breaking",
                        f"schemas.{name}.{fname}",
                        f"type changed {oldf['type']} -> {newf['type']}",
                    )
                )
            if not oldf["required"] and newf["required"]:
                result.changes.append(
                    Change(
                        "added_required_field",
                        "breaking",
                        f"schemas.{name}.{fname}",
                        f"field '{fname}' is now required",
                    )
                )
        for fname in new_fields:
            if fname not in old_fields:
                result.changes.append(
                    Change(
                        "added_field",
                        "non-breaking",
                        f"schemas.{name}.{fname}",
                        f"field '{fname}' added (required={new_fields[fname]['required']})",
                    )
                )


def diff_specs(
    old_path: str = "orders_v1.2.0.yaml", new_path: str = "orders_v1.3.0.yaml"
) -> DiffResult:
    """Diff two sample OpenAPI specs and return classified changes."""
    specs = _load({"old": old_path, "new": new_path})
    old, new = specs["old"], specs["new"]
    result = DiffResult(
        old_version=str(old.get("info", {}).get("version")),
        new_version=str(new.get("info", {}).get("version")),
    )
    _diff_endpoints(old, new, result)
    _diff_schemas(old, new, result)
    return result
