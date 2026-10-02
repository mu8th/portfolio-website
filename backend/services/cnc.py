"""Bounded CNC portfolio demos, rebuilt from the project's supplied descriptions.

This module previews geometry. It does not control a machine, simulate stock,
apply cutter compensation, or prove that a program is suitable for a controller.
"""

from __future__ import annotations

import io
import math
import re
import threading
from pathlib import Path

import ezdxf
from matplotlib.figure import Figure

SAMPLE_DIR = Path(__file__).resolve().parents[1] / "samples" / "cnc"
MAX_POINTS = 10_000
MAX_ENTITIES = 100
MAX_COORD = 100_000
PLOT_LOCK = threading.Lock()
Point = tuple[float, float]
Contour = list[Point]


def _bounded(value: float) -> float:
    if not math.isfinite(value) or abs(value) > MAX_COORD:
        raise ValueError("Coordinates must be finite and within ±100,000 mm.")
    return value


def _arc_points(center: Point, radius: float, start: float, sweep: float) -> Contour:
    _bounded(radius)
    # At most 2 degrees per chord; the demo explicitly labels curves as tessellated.
    steps = max(2, math.ceil(abs(sweep) / (math.pi / 90)))
    return [
        (_bounded(center[0] + radius * math.cos(start + sweep * i / steps)),
         _bounded(center[1] + radius * math.sin(start + sweep * i / steps)))
        for i in range(steps + 1)
    ]


def _plot(segments: list[dict]) -> str:
    """Create an actual Matplotlib SVG export without global pyplot state."""
    with PLOT_LOCK:
        figure = Figure(figsize=(8, 4.5), facecolor="#0c111a", layout="constrained")
        axis = figure.subplots()
        axis.set_facecolor("#0c111a")
        for segment in segments:
            points = segment["points"]
            rapid = segment["kind"] == "rapid"
            axis.plot([p[0] for p in points], [p[1] for p in points],
                      color="#fbbf24" if rapid else "#67e8f9",
                      linestyle="--" if rapid else "-", linewidth=1 if rapid else 1.8)
        axis.set_aspect("equal", adjustable="datalim")
        axis.set_xlabel("X (mm)", color="#aebacc")
        axis.set_ylabel("Y (mm)", color="#aebacc")
        axis.tick_params(colors="#aebacc")
        axis.grid(alpha=0.15)
        for spine in axis.spines.values():
            spine.set_color("#3a4658")
        output = io.StringIO()
        figure.savefig(output, format="svg", metadata={"Date": None})
        figure.clear()
        return output.getvalue()


def visualize(code: str, *, export: bool = True) -> dict:
    """Parse a strict XY-plane subset with modal motion, units, and positioning.

    Arc centers use incremental I/J, even in G90. Unsupported words/codes fail
    explicitly so a preview never silently drops an operation.
    """
    if len(code) > 100_000 or len(code.splitlines()) > 2_000:
        raise ValueError("Use at most 2,000 lines and 100 KB of G-code.")
    position = [0.0, 0.0, 0.0]
    motion, absolute, scale, feed = 0, True, 1.0, 0.0
    segments: list[dict] = []
    rapid_mm = cut_mm = 0.0
    word_pattern = re.compile(r"([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))")
    point_count = 0
    ended = False
    for line_number, raw in enumerate(code.splitlines(), 1):
        line = re.sub(r"\([^()]*\)", "", raw.split(";", 1)[0]).strip().upper()
        if not line or line == "%":
            continue
        if ended:
            raise ValueError(f"Line {line_number}: code follows the program end.")
        words = word_pattern.findall(line)
        if word_pattern.sub("", line).strip() or not words:
            raise ValueError(f"Line {line_number}: unrecognized G-code syntax.")
        values: dict[str, float] = {}
        groups: set[str] = set()
        for letter, raw_value in words:
            value = float(raw_value)
            if not math.isfinite(value):
                raise ValueError(f"Line {line_number}: non-finite value.")
            if letter == "G":
                if value not in (0, 1, 2, 3, 17, 20, 21, 90, 91, 94):
                    raise ValueError(f"Line {line_number}: G{raw_value} is not supported.")
                group = ("motion" if value in (0, 1, 2, 3) else
                         "units" if value in (20, 21) else
                         "position" if value in (90, 91) else str(value))
                if group in groups:
                    raise ValueError(f"Line {line_number}: conflicting G-codes.")
                groups.add(group)
                if value in (0, 1, 2, 3):
                    motion = int(value)
                elif value in (20, 21):
                    scale = 25.4 if value == 20 else 1.0
                elif value in (90, 91):
                    absolute = value == 90
            elif letter not in "XYZIJFNSM":
                raise ValueError(f"Line {line_number}: {letter} is not supported.")
            else:
                if letter in values:
                    raise ValueError(f"Line {line_number}: duplicate {letter} word.")
                values[letter] = value
        if "M" in values:
            if values["M"] not in (2, 3, 5, 30):
                raise ValueError(f"Line {line_number}: unsupported M-code.")
            ended = values["M"] in (2, 30)
        if "F" in values:
            if values["F"] <= 0:
                raise ValueError(f"Line {line_number}: feed rate must be positive.")
            feed = values["F"] * scale
        if motion not in (2, 3) and any(k in values for k in "IJ"):
            raise ValueError(f"Line {line_number}: I/J requires G2 or G3.")
        if not any(k in values for k in "XYZIJ"):
            continue
        target = position.copy()
        for i, letter in enumerate("XYZ"):
            if letter in values:
                target[i] = _bounded(values[letter] * scale + (0 if absolute else position[i]))
        points = [position[:2], target[:2]]
        distance = math.dist(position, target)
        if motion in (2, 3):
            if not any(k in values for k in "IJ"):
                raise ValueError(f"Line {line_number}: arcs need an I/J center offset.")
            if target[2] != position[2]:
                raise ValueError(f"Line {line_number}: helical arcs are not supported.")
            center = (position[0] + values.get("I", 0) * scale,
                      position[1] + values.get("J", 0) * scale)
            radius = math.dist(position[:2], center)
            if radius < 1e-8 or not math.isclose(
                    radius, math.dist(target[:2], center), rel_tol=1e-4, abs_tol=0.01):
                raise ValueError(f"Line {line_number}: arc radii do not match.")
            start = math.atan2(position[1] - center[1], position[0] - center[0])
            end = math.atan2(target[1] - center[1], target[0] - center[0])
            sweep = (end - start) % math.tau if motion == 3 else -((start - end) % math.tau)
            if abs(sweep) < 1e-10:
                sweep = math.tau if motion == 3 else -math.tau
            points = _arc_points(center, radius, start, sweep)
            points[0], points[-1] = position[:2], target[:2]
            distance = radius * abs(sweep)
        point_count += len(points)
        if point_count > MAX_POINTS:
            raise ValueError("Toolpath is too detailed; use at most 10,000 preview points.")
        if distance > 1e-9:
            kind = "rapid" if motion == 0 else "cut"
            segments.append({"points": points, "kind": kind, "line": line_number,
                             "motion": f"G{motion}", "feed": feed})
            if kind == "rapid":
                rapid_mm += distance
            else:
                cut_mm += distance
        position = target
    if not segments:
        raise ValueError("No supported motion found. Add a G0/G1/G2/G3 toolpath.")
    result = {"segments": segments, "cut_mm": round(cut_mm, 3),
              "rapid_mm": round(rapid_mm, 3), "moves": len(segments), "units": "mm"}
    if export:
        result["svg"] = _plot(segments)
    return result


def _primitive(entity) -> Contour:
    if entity.dxftype() == "LINE":
        return [(float(entity.dxf.start.x), float(entity.dxf.start.y)),
                (float(entity.dxf.end.x), float(entity.dxf.end.y))]
    center = entity.dxf.center
    start = 0 if entity.dxftype() == "CIRCLE" else math.radians(entity.dxf.start_angle)
    sweep = (math.tau if entity.dxftype() == "CIRCLE" else
             math.radians((entity.dxf.end_angle - entity.dxf.start_angle) % 360))
    return _arc_points((center.x, center.y), entity.dxf.radius, start, sweep)


def extract_dxf(text: str) -> tuple[list[Contour], dict]:
    """Read planar millimetre DXF geometry with ezdxf, rejecting partial conversion."""
    if len(text) > 500_000:
        raise ValueError("Use an ASCII DXF smaller than 500 KB.")
    try:
        drawing = ezdxf.read(io.StringIO(text))
        entities = list(drawing.modelspace())
    except Exception as exc:
        raise ValueError("Could not read this ASCII DXF. Try a bundled sample.") from exc
    if drawing.units not in (0, 4):
        raise ValueError("This demo accepts millimetre or unitless (assumed mm) DXF files.")
    if not entities or len(entities) > MAX_ENTITIES:
        raise ValueError("Use a drawing with 1–100 model-space entities.")
    supported = {"LINE", "LWPOLYLINE", "CIRCLE", "ARC"}
    unsupported = sorted({e.dxftype() for e in entities} - supported)
    if unsupported:
        raise ValueError("Unsupported DXF entities: " + ", ".join(unsupported))
    contours: list[Contour] = []
    counts: dict[str, int] = {}
    for entity in entities:
        kind = entity.dxftype()
        counts[kind] = counts.get(kind, 0) + 1
        if tuple(entity.dxf.get("extrusion", (0, 0, 1))) != (0, 0, 1):
            raise ValueError("Use geometry on the XY plane with the default extrusion.")
        if kind == "LWPOLYLINE":
            if abs(entity.dxf.elevation) > 1e-8:
                raise ValueError("DXF geometry must be planar at Z=0.")
            if len(entity) > MAX_POINTS:
                raise ValueError("Polyline exceeds the preview point limit.")
            if entity.has_arc:
                points: Contour = []
                for part in entity.virtual_entities():
                    points.extend(_primitive(part) if not points else _primitive(part)[1:])
            else:
                points = [(p.x, p.y) for p in entity.vertices_in_wcs()]
                if entity.closed and points:
                    points.append(points[0])
        else:
            z_values = ([entity.dxf.start.z, entity.dxf.end.z] if kind == "LINE"
                        else [entity.dxf.center.z])
            if any(abs(z) > 1e-8 for z in z_values):
                raise ValueError("DXF geometry must be planar at Z=0.")
            points = _primitive(entity)
        if len(points) < 2:
            raise ValueError("A DXF entity has no usable path.")
        for point in points:
            for coordinate in point:
                _bounded(coordinate)
        contours.append(points)
        if sum(map(len, contours)) > MAX_POINTS:
            raise ValueError("Drawing exceeds 10,000 preview points.")
    return contours, counts


def generate_gcode(contours: list[Contour], feed: float = 600) -> str:
    """Emit a geometry-only G21/G90 preview, retracting between separate contours."""
    lines = ["(Geometry preview - verify tooling and controller before machining)",
             "G21 G90 G17 G94", "G0 Z5"]
    for i, contour in enumerate(contours, 1):
        lines.extend([f"(Contour {i})", f"G0 X{contour[0][0]:.4f} Y{contour[0][1]:.4f}",
                      f"G1 Z-1 F{feed:.0f}"])
        lines.extend(f"G1 X{x:.4f} Y{y:.4f}" for x, y in contour[1:])
        lines.append("G0 Z5")
    lines.append("M30")
    return "\n".join(lines) + "\n"


def sample(name: str) -> str:
    if name not in {"mounting-plate", "bracket", "scattered"}:
        raise ValueError("Unknown sample drawing.")
    return (SAMPLE_DIR / f"{name}.dxf").read_text()


def convert(text: str, feed: float = 600) -> dict:
    contours, counts = extract_dxf(text)
    code = generate_gcode(contours, feed)
    # Conversion can have more lines than an edited visualizer program.
    if len(code.splitlines()) > 2_000:
        raise ValueError("Converted drawing exceeds 2,000 G-code lines. Simplify the DXF.")
    return {"contours": contours, "entities": counts, "gcode": code,
            "entity_count": sum(counts.values()), **visualize(code, export=False)}


def _travel(contours: list[Contour]) -> float:
    position: Point = (0, 0)
    distance = 0.0
    for contour in contours:
        distance += math.dist(position, contour[0])
        position = contour[-1]
    return distance


def optimize(text: str, algorithm: str = "nearest") -> dict:
    """Reorder independent contours; keep direction, start vertices, and geometry.

    The original order is kept if a heuristic would make XY rapid travel worse.
    This intentionally does not reorder arbitrary modal machine programs.
    """
    contours, _ = extract_dxf(text)
    original = _travel(contours)
    if algorithm == "x-sort":
        ordered = sorted(contours, key=lambda p: (p[0][0], p[0][1]))
    elif algorithm == "nearest":
        remaining = contours.copy()
        ordered = []
        position: Point = (0, 0)
        while remaining:
            index = min(range(len(remaining)), key=lambda i: math.dist(position, remaining[i][0]))
            contour = remaining.pop(index)
            ordered.append(contour)
            position = contour[-1]
    else:
        raise ValueError("Choose nearest or x-sort.")
    kept_original = _travel(ordered) > original + 1e-8
    if kept_original:
        ordered = contours.copy()
    improved = _travel(ordered)
    before = visualize(generate_gcode(contours), export=False)
    after_code = generate_gcode(ordered)
    after = visualize(after_code, export=False)
    cut = sum(sum(math.dist(a, b) for a, b in zip(c, c[1:], strict=False)) for c in contours)
    return {"before": before["segments"], "after": after["segments"],
            "before_mm": round(original, 3), "after_mm": round(improved, 3),
            "saved_mm": round(original - improved, 3),
            "saved_pct": round(100 * (original - improved) / original, 2) if original else 0,
            "cut_mm": round(cut, 3), "contour_count": len(contours),
            "order": [next(i + 1 for i, c in enumerate(contours) if c is p) for p in ordered],
            "kept_original": kept_original, "gcode": after_code, "algorithm": algorithm}
