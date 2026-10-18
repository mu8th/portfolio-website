"""Bounded CNC portfolio demos, rebuilt from the project's supplied descriptions.

This module previews geometry. It does not control a machine, simulate stock,
apply cutter compensation, or prove that a program is suitable for a controller.
"""

from __future__ import annotations

import io
import math
import random
import re
import threading
from pathlib import Path

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
            if segment["kind"] == "drill":
                axis.plot([points[0][0]], [points[0][1]], marker="o", markersize=6,
                          markerfacecolor="none", markeredgecolor="#f472b6", linestyle="none")
                continue
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


#: G-codes that change modes this preview does not model but that never move
#: the tool on their own. They are skipped with a note, not an error.
_MODAL_NOTES: dict[int, str] = {
    4: "dwell (no motion)",
    40: "cutter compensation off",
    41: "cutter compensation is not applied; the programmed path is shown",
    42: "cutter compensation is not applied; the programmed path is shown",
    43: "tool length offset is not applied",
    49: "tool length offset off",
    54: "work offset G54 assumed at the origin", 55: "work offset ignored",
    56: "work offset ignored", 57: "work offset ignored", 58: "work offset ignored",
    59: "work offset ignored",
    61: "exact-stop mode (no effect on the path)", 64: "path-blending mode (no effect on the path)",
    93: "inverse-time feed mode", 95: "feed-per-revolution mode",
    98: "canned-cycle return mode", 99: "canned-cycle return mode",
}
#: G-codes whose motion cannot be previewed in work coordinates; the whole
#: line is skipped with a note.
_SKIP_LINE_NOTES: dict[int, str] = {
    28: "return to machine home is not previewed",
    30: "return to secondary home is not previewed",
    53: "machine-coordinate moves are not previewed",
    92: "coordinate offsets are not applied; later positions may be shifted",
}
_DRILL_CYCLES = {73, 74, 76, 81, 82, 83, 84, 85, 86, 87, 88, 89}
#: Words read for their value; anything else is ignored with a note.
_IGNORED_LETTERS: dict[str, str] = {
    "T": "tool selection (no effect on the path)",
    "H": "tool length offset number", "D": "cutter compensation number",
    "S": "spindle speed (no effect on the path)", "P": "dwell or cycle parameter",
    "Q": "peck depth", "L": "repeat count is not applied",
    "E": "extruder axis (3D printer code) is ignored",
    "A": "rotary axis is ignored", "B": "rotary axis is ignored", "C": "rotary axis is ignored",
    "K": "arc center K is ignored outside the XZ/YZ planes",
    "O": "program number", "U": "axis U is ignored", "V": "axis V is ignored",
    "W": "axis W is ignored",
}
_QUIET_M = {0, 1, 3, 4, 5, 6, 7, 8, 9, 2, 30}


#: Notes that cannot change the drawn XY path; everything else is a warning.
_INFO_CODES = {"O", "T", "S", "H", "D", "P", "Q", "G4", "G40", "G43", "G49", "G54", "G55",
               "G56", "G57", "G58", "G59", "G61", "G64", "G93", "G95", "G98", "G99", "drill",
               "end"}


class _Notes:
    """Collect parser notes grouped by code, with the lines they occurred on.

    Each note has a ``level``: ``info`` when the skipped code cannot change the
    drawn XY path (a tool change, spindle speed), ``warning`` when the preview
    may differ from what the machine would do (cutter compensation, G28, G92).
    """

    def __init__(self) -> None:
        self._items: dict[str, dict] = {}

    def add(self, code: str, message: str, line: int) -> None:
        level = "info" if code in _INFO_CODES or code.startswith("M") else "warning"
        item = self._items.setdefault(
            code, {"code": code, "message": message, "level": level, "lines": []}
        )
        if len(item["lines"]) < 12 and line not in item["lines"]:
            item["lines"].append(line)

    def as_list(self) -> list[dict]:
        return sorted(self._items.values(), key=lambda n: n["lines"][0])


def _radius_center(start: list[float], end: list[float], radius: float, clockwise: bool):
    """Arc center for R-format arcs (negative R selects the arc over 180 degrees)."""
    dx, dy = end[0] - start[0], end[1] - start[1]
    chord = math.hypot(dx, dy)
    if chord < 1e-9 or chord > 2 * abs(radius) + 1e-6:
        return None
    h = math.sqrt(max(radius * radius - (chord / 2) ** 2, 0.0))
    mx, my = (start[0] + end[0]) / 2, (start[1] + end[1]) / 2
    nx, ny = -dy / chord, dx / chord  # left of the start->end direction
    sign = -1.0 if clockwise else 1.0
    if radius < 0:
        sign = -sign
    return (mx + sign * nx * h, my + sign * ny * h)


def visualize(code: str, *, export: bool = True) -> dict:
    """Parse G-code into an XY toolpath preview with modal state.

    Supports G0/G1, XY arcs (G2/G3 with incremental I/J or R), G20/G21, G90/G91
    and drilling cycles (G81-G89, drawn as holes). Codes that do not change the
    XY path (tool changes, spindle, coolant, offsets) are skipped with a note,
    and codes whose motion cannot be previewed (G28, G92, ...) skip their line
    with a note, so real programs still render. The notes are returned in
    ``warnings`` so a preview never silently drops an operation.
    """
    if len(code) > 100_000 or len(code.splitlines()) > 2_000:
        raise ValueError("Use at most 2,000 lines and 100 KB of G-code.")
    position = [0.0, 0.0, 0.0]
    motion, absolute, scale, feed, plane = 0, True, 1.0, 0.0, 17
    drilling = False
    segments: list[dict] = []
    rapid_mm = cut_mm = 0.0
    holes = 0
    word_pattern = re.compile(r"([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))")
    notes = _Notes()
    point_count = 0
    for line_number, raw in enumerate(code.splitlines(), 1):
        line = re.sub(r"\([^()]*\)", "", raw.split(";", 1)[0]).strip().upper()
        if not line or line == "%":
            continue
        words = word_pattern.findall(line)
        if word_pattern.sub("", line).strip() or not words:
            notes.add("syntax", "unrecognized syntax; line skipped", line_number)
            continue
        values: dict[str, float] = {}
        skip_line = False
        motion_words = 0
        for letter, raw_value in words:
            value = float(raw_value)
            if not math.isfinite(value):
                raise ValueError(f"Line {line_number}: non-finite value.")
            if letter == "G":
                g = int(value) if value == int(value) else value
                if g in (0, 1, 2, 3) or g in _DRILL_CYCLES:
                    motion_words += 1
                    if motion_words > 1:
                        raise ValueError(f"Line {line_number}: conflicting motion G-codes.")
                if g in (0, 1, 2, 3):
                    motion, drilling = int(g), False
                elif g in (20, 21):
                    scale = 25.4 if g == 20 else 1.0
                elif g in (90, 91):
                    absolute = g == 90
                elif g in (17, 18, 19):
                    plane = int(g)
                    if g != 17:
                        notes.add(f"G{g}", "arcs outside the XY plane are skipped", line_number)
                elif g == 80:
                    drilling = False
                elif g in _DRILL_CYCLES:
                    drilling = True
                    notes.add("drill", "drilling cycles are drawn as holes", line_number)
                elif g in _SKIP_LINE_NOTES:
                    notes.add(f"G{g}", _SKIP_LINE_NOTES[g], line_number)
                    skip_line = True
                elif g in _MODAL_NOTES or g == 94:
                    if g != 94:
                        notes.add(f"G{g}", _MODAL_NOTES[g], line_number)
                else:
                    notes.add(f"G{raw_value}", "not modeled; line skipped", line_number)
                    skip_line = True
            elif letter == "M":
                m = int(value)
                if m not in _QUIET_M:
                    notes.add(f"M{m}", "machine function ignored", line_number)
                values.setdefault("M", value)
                if m in (2, 30):
                    values["M"] = value
            elif letter in "XYZIJFR":
                if letter in values:
                    raise ValueError(f"Line {line_number}: duplicate {letter} word.")
                values[letter] = value
            elif letter == "N":
                continue
            else:
                notes.add(letter, _IGNORED_LETTERS.get(letter, f"word {letter} ignored"),
                          line_number)
        if skip_line:
            continue
        if "F" in values:
            if values["F"] <= 0:
                raise ValueError(f"Line {line_number}: feed rate must be positive.")
            feed = values["F"] * scale
        if values.get("M") in (2, 30):
            for later, rest in enumerate(code.splitlines()[line_number:], line_number + 1):
                if re.sub(r"\([^()]*\)", "", rest.split(";", 1)[0]).strip() not in ("", "%"):
                    notes.add("end", "code after the program end is ignored", later)
                    break
            break
        if not any(k in values for k in "XYZIJ") and not (motion in (2, 3) and "R" in values):
            continue
        target = position.copy()
        for i, letter in enumerate("XYZ"):
            if letter in values:
                target[i] = _bounded(values[letter] * scale + (0 if absolute else position[i]))
        if drilling:
            point_count += 1
            if point_count > MAX_POINTS:
                raise ValueError("Toolpath is too detailed; use at most 10,000 preview points.")
            if math.dist(position[:2], target[:2]) > 1e-9:
                segments.append({"points": [position[:2], target[:2]], "kind": "rapid",
                                 "line": line_number, "motion": "G0", "feed": feed})
                rapid_mm += math.dist(position[:2], target[:2])
            segments.append({"points": [target[:2]], "kind": "drill", "line": line_number,
                             "motion": "cycle", "feed": feed})
            holes += 1
            position = [target[0], target[1], position[2]]
            continue
        points = [position[:2], target[:2]]
        distance = math.dist(position, target)
        if motion in (2, 3):
            if plane != 17:
                position = target
                continue
            if target[2] != position[2]:
                notes.add("helix", "helical arcs are drawn without their Z change", line_number)
            center = None
            if "R" in values and not any(k in values for k in "IJ"):
                center = _radius_center(position, target, values["R"] * scale, motion == 2)
                if center is None:
                    notes.add("R", "arc radius cannot reach the end point; move skipped",
                              line_number)
                    position = target
                    continue
            elif any(k in values for k in "IJ"):
                center = (position[0] + values.get("I", 0) * scale,
                          position[1] + values.get("J", 0) * scale)
            else:
                raise ValueError(f"Line {line_number}: arcs need I/J or R.")
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
              "rapid_mm": round(rapid_mm, 3), "moves": len(segments), "holes": holes,
              "units": "mm", "warnings": notes.as_list()}
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
    import ezdxf  # deferred: only DXF routes need it

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


#: Rapid rate assumed for cycle-time estimates (mm/min).
RAPID_MM_PER_MIN = 5_000


def _program(
    contours: list[Contour], feed: float = 600, depth: float = 1.0, safe_z: float = 5.0
) -> tuple[str, list[list[int]]]:
    """Emit a G21/G90 geometry program; return it with each contour's line span."""
    if not 0.1 <= depth <= 20 or not 1 <= safe_z <= 50:
        raise ValueError("Use a depth of 0.1-20 mm and a safe Z of 1-50 mm.")
    lines = ["(Geometry preview - verify tooling and controller before machining)",
             "G21 G90 G17 G94", f"G0 Z{safe_z:g}"]
    spans: list[list[int]] = []
    for i, contour in enumerate(contours, 1):
        first = len(lines) + 1
        lines.extend([f"(Contour {i})", f"G0 X{contour[0][0]:.4f} Y{contour[0][1]:.4f}",
                      f"G1 Z{-depth:g} F{feed:.0f}"])
        lines.extend(f"G1 X{x:.4f} Y{y:.4f}" for x, y in contour[1:])
        lines.append(f"G0 Z{safe_z:g}")
        spans.append([first, len(lines)])
    lines.append("M30")
    return "\n".join(lines) + "\n", spans


def generate_gcode(
    contours: list[Contour], feed: float = 600, depth: float = 1.0, safe_z: float = 5.0
) -> str:
    """Emit a geometry-only G21/G90 preview, retracting between separate contours."""
    return _program(contours, feed, depth, safe_z)[0]


def cycle_minutes(cut_mm: float, rapid_mm: float, feed: float) -> float:
    """Estimated run time: feed moves at ``feed``, rapids at RAPID_MM_PER_MIN."""
    return cut_mm / feed + rapid_mm / RAPID_MM_PER_MIN


def sample(name: str) -> str:
    if name not in {"mounting-plate", "bracket", "scattered"}:
        raise ValueError("Unknown sample drawing.")
    return (SAMPLE_DIR / f"{name}.dxf").read_text()


def convert(text: str, feed: float = 600, depth: float = 1.0, safe_z: float = 5.0) -> dict:
    """Convert DXF geometry to a G-code program and its preview.

    ``contour_lines`` gives each contour's first and last G-code line, so a UI
    can link a drawn contour to the code that cuts it.
    """
    contours, counts = extract_dxf(text)
    code, spans = _program(contours, feed, depth, safe_z)
    # Conversion can have more lines than an edited visualizer program.
    if len(code.splitlines()) > 2_000:
        raise ValueError("Converted drawing exceeds 2,000 G-code lines. Simplify the DXF.")
    preview = visualize(code, export=False)
    return {"contours": contours, "contour_lines": spans, "entities": counts, "gcode": code,
            "entity_count": sum(counts.values()), "feed": feed, "depth": depth,
            "safe_z": safe_z, "rapid_mm_per_min": RAPID_MM_PER_MIN,
            "cycle_minutes": round(cycle_minutes(preview["cut_mm"], preview["rapid_mm"], feed), 2),
            **preview}


def _travel(contours: list[Contour], start: Point = (0, 0)) -> float:
    position: Point = start
    distance = 0.0
    for contour in contours:
        distance += math.dist(position, contour[0])
        position = contour[-1]
    return distance


def _nearest(contours: list[Contour]) -> list[int]:
    """Greedy order: always travel to the closest unvisited contour start."""
    remaining = list(range(len(contours)))
    order: list[int] = []
    position: Point = (0, 0)
    while remaining:
        nxt = min(remaining, key=lambda i: math.dist(position, contours[i][0]))
        remaining.remove(nxt)
        order.append(nxt)
        position = contours[nxt][-1]
    return order


def _x_sort(contours: list[Contour]) -> list[int]:
    return sorted(range(len(contours)), key=lambda i: (contours[i][0][0], contours[i][0][1]))


def _two_opt(contours: list[Contour], max_passes: int = 50) -> list[int]:
    """Improve a nearest-neighbor tour by reversing the order of sub-sequences.

    Contours keep their own direction and start vertex, so only the visiting
    order changes. Travel is asymmetric (a contour may end away from where it
    started), so a reversal also flips every edge inside the reversed run;
    prefix sums of forward and backward edge costs score each candidate in
    O(1), and a pass over all candidates is O(n^2).
    """
    order = _nearest(contours)
    n = len(order)
    if n < 3:
        return order
    origin: Point = (0, 0)
    gap = [[math.dist(contours[a][-1], contours[b][0]) for b in range(n)] for a in range(n)]
    lead = [math.dist(origin, contours[b][0]) for b in range(n)]
    for _ in range(max_passes):
        fwd = [0.0]
        bwd = [0.0]
        for k in range(n - 1):
            fwd.append(fwd[-1] + gap[order[k]][order[k + 1]])
            bwd.append(bwd[-1] + gap[order[k + 1]][order[k]])
        best_delta, best_move = -1e-9, None
        for i in range(n - 1):
            before = lead[order[i]] if i == 0 else gap[order[i - 1]][order[i]]
            for j in range(i + 1, n):
                after_old = gap[order[j]][order[j + 1]] if j + 1 < n else 0.0
                old = before + (fwd[j] - fwd[i]) + after_old
                into = lead[order[j]] if i == 0 else gap[order[i - 1]][order[j]]
                after_new = gap[order[i]][order[j + 1]] if j + 1 < n else 0.0
                new = into + (bwd[j] - bwd[i]) + after_new
                if new - old < best_delta:
                    best_delta, best_move = new - old, (i, j)
        if best_move is None:
            break
        i, j = best_move
        order[i:j + 1] = order[i:j + 1][::-1]
    return order


ALGORITHMS = {
    "nearest": ("Nearest neighbor", _nearest),
    "x-sort": ("Sort by X position", _x_sort),
    "two-opt": ("Nearest neighbor + 2-opt", _two_opt),
}


def random_layout(seed: int, count: int = 12) -> list[Contour]:
    """Generate a reproducible scattered layout of closed rectangles and circles."""
    if not 1 <= count <= 24:
        raise ValueError("Use 1-24 contours.")
    rng = random.Random(seed)
    contours: list[Contour] = []
    for _ in range(count):
        x, y = rng.uniform(10, 190), rng.uniform(10, 110)
        if rng.random() < 0.5:
            w, h = rng.uniform(6, 18), rng.uniform(6, 14)
            contours.append([(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)])
        else:
            r = rng.uniform(3, 8)
            # 10-degree chords keep a 24-contour program well under 2,000 lines.
            contours.append([(x + r * math.cos(math.radians(a)), y + r * math.sin(math.radians(a)))
                             for a in range(0, 361, 10)])
    return contours


def _route(contours: list[Contour], order: list[int]) -> dict:
    ordered = [contours[i] for i in order]
    code = generate_gcode(ordered)
    preview = visualize(code, export=False)
    return {"segments": preview["segments"], "rapid_mm": round(_travel(ordered), 3),
            "order": [i + 1 for i in order], "gcode": code}


def optimize_contours(contours: list[Contour], algorithm: str = "nearest") -> dict:
    """Reorder independent contours; keep direction, start vertices, and geometry.

    ``algorithm`` is one of :data:`ALGORITHMS` or ``"all"``, which also returns
    every algorithm's route for comparison. The original order is kept if a
    heuristic would make XY rapid travel worse.
    """
    if algorithm != "all" and algorithm not in ALGORITHMS:
        raise ValueError("Choose nearest, x-sort, two-opt or all.")
    original = _travel(contours)
    routes = {}
    identity = list(range(len(contours)))
    for name, (label, fn) in ALGORITHMS.items():
        order = fn(contours)
        kept = _travel([contours[i] for i in order]) > original + 1e-8
        route = _route(contours, identity if kept else order)
        routes[name] = {**route, "label": label, "kept_original": kept,
                        "saved_pct": round(100 * (original - route["rapid_mm"]) / original, 2)
                        if original else 0}
    chosen = (min(routes, key=lambda n: routes[n]["rapid_mm"]) if algorithm == "all"
              else algorithm)
    best = routes[chosen]
    before = visualize(generate_gcode(contours), export=False)
    cut = sum(sum(math.dist(a, b) for a, b in zip(c, c[1:], strict=False)) for c in contours)
    result = {"before": before["segments"], "after": best["segments"],
              "before_mm": round(original, 3), "after_mm": best["rapid_mm"],
              "saved_mm": round(original - best["rapid_mm"], 3),
              "saved_pct": best["saved_pct"], "cut_mm": round(cut, 3),
              "contour_count": len(contours), "order": best["order"],
              "kept_original": best["kept_original"], "gcode": best["gcode"],
              "algorithm": chosen}
    if algorithm == "all":
        result["routes"] = {name: {k: r[k] for k in ("label", "rapid_mm", "saved_pct", "order",
                                                    "kept_original", "segments")}
                            for name, r in routes.items()}
    return result


def optimize(text: str, algorithm: str = "nearest") -> dict:
    """Optimize the contour order of a DXF drawing (see :func:`optimize_contours`)."""
    contours, _ = extract_dxf(text)
    return optimize_contours(contours, algorithm)
