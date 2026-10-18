"""Geometry, modal parsing, and API regression checks for CNC demos."""

import asyncio
import io
import math

import ezdxf
import httpx
import pytest

from backend.main import app
from backend.services import cnc


def drawing(contours: list[list[tuple[float, float]]]) -> str:
    document = ezdxf.new("R2000")
    document.units = 4
    for contour in contours:
        document.modelspace().add_lwpolyline(contour)
    stream = io.StringIO()
    document.write(stream)
    return stream.getvalue()


def test_modal_moves_units_and_z_distance() -> None:
    result = cnc.visualize("G20 G90\nG0 X1\nG91\nG1 X1 F10\nY1\nZ1", export=False)
    assert result["rapid_mm"] == 25.4
    assert result["cut_mm"] == 76.2
    assert result["segments"][-1]["points"][-1] == [50.8, 25.4]
    assert result["segments"][-1]["feed"] == 254


def test_arcs_have_exact_distance_and_correct_direction() -> None:
    clockwise = cnc.visualize("G0 X10\nG2 X-10 I-10 J0", export=False)
    counter = cnc.visualize("G0 X10\nG3 X-10 I-10 J0", export=False)
    assert clockwise["cut_mm"] == pytest.approx(math.pi * 10, abs=0.001)
    assert clockwise["segments"][-1]["points"][45][1] < 0
    assert counter["segments"][-1]["points"][45][1] > 0
    circle = cnc.visualize("G0 X10\nG3 I-10 J0", export=False)
    assert circle["cut_mm"] == pytest.approx(math.tau * 10, abs=0.001)


@pytest.mark.parametrize("code", [
    "G18 G2 X10 I5", "G1 X10 X20", "G0 G1 X10", "G2 X10 I1", "G0 X100001",
    "G1 X10 F0", "garbage", "G2 X10 Y0",
])
def test_invalid_programs_are_rejected(code: str) -> None:
    with pytest.raises(ValueError):
        cnc.visualize(code, export=False)


def test_real_programs_render_with_notes_instead_of_failing() -> None:
    program = "\n".join([
        "%", "O1000 (job)", "G21 G90 G17 G40 G49 G54", "T2 M6", "S12000 M3 M8",
        "G0 X0 Y0 Z5", "G43 H2 Z5", "G1 Z-1 F600", "G41 D1", "G1 X10",
        "G28 G91 Z0", "G90", "G1 X10 Y10", "M5 M9", "M30", "G1 X999",
    ])
    result = cnc.visualize(program, export=False)
    notes = {n["code"]: n for n in result["warnings"]}
    assert notes["T"]["level"] == "info" and notes["T"]["lines"] == [4]
    assert notes["G41"]["level"] == "warning"
    assert notes["G28"]["lines"] == [11]  # skipped line: no move to machine home
    assert notes["end"]["lines"] == [16]  # nothing after M30 is drawn
    assert result["segments"][-1]["points"][-1] == [10, 10]


def test_r_format_arcs_match_ij_arcs() -> None:
    by_r = cnc.visualize("G0 X10\nG2 X-10 R10", export=False)
    by_ij = cnc.visualize("G0 X10\nG2 X-10 I-10 J0", export=False)
    assert by_r["cut_mm"] == pytest.approx(by_ij["cut_mm"], abs=1e-3)
    minor = cnc.visualize("G0 X0\nG3 X10 Y10 R10", export=False)["cut_mm"]
    major = cnc.visualize("G0 X0\nG3 X10 Y10 R-10", export=False)["cut_mm"]
    assert minor == pytest.approx(math.pi * 5, abs=1e-3)  # quarter circle
    assert major == pytest.approx(math.pi * 15, abs=1e-3)  # three quarters


def test_drilling_cycles_are_drawn_as_holes() -> None:
    result = cnc.visualize("G0 X0 Y0\nG81 X10 Y10 Z-3 R1 F100\nX20\nX30\nG80\nG0 X0",
                           export=False)
    assert result["holes"] == 3
    holes = [s["points"][0] for s in result["segments"] if s["kind"] == "drill"]
    assert holes == [[10, 10], [20, 10], [30, 10]]


def test_helical_arcs_and_3d_printer_words_are_noted() -> None:
    helix = cnc.visualize("G0 X10\nG3 X10 Z5 I-10", export=False)
    assert {n["code"] for n in helix["warnings"]} == {"helix"}
    printer = cnc.visualize("G28\nM104 S200\nG1 X10 Y10 E1.2 F1500", export=False)
    assert {"G28", "M104", "E"} <= {n["code"] for n in printer["warnings"]}


@pytest.mark.parametrize("name", ["mounting-plate", "bracket", "scattered"])
def test_dxf_conversion_round_trips_through_visualizer(name: str) -> None:
    result = cnc.convert(cnc.sample(name), feed=750)
    assert result["entity_count"] == len(result["contours"])
    assert "G21 G90 G17 G94" in result["gcode"]
    assert "F750" in result["gcode"]
    assert result["gcode"].rstrip().endswith("M30")
    parsed = cnc.visualize(result["gcode"], export=False)
    assert parsed["cut_mm"] == result["cut_mm"]
    assert parsed["moves"] == result["moves"]


def test_bulged_polyline_is_not_flattened_to_a_straight_line() -> None:
    document = ezdxf.new("R2000")
    document.units = 4
    document.modelspace().add_lwpolyline([(0, 0, 1), (10, 0, 0)], format="xyb")
    stream = io.StringIO()
    document.write(stream)
    contours, _ = cnc.extract_dxf(stream.getvalue())
    assert len(contours[0]) > 2
    assert max(abs(p[1]) for p in contours[0]) == pytest.approx(5)


def test_unsupported_and_nonplanar_dxf_are_rejected() -> None:
    for kind in ("text", "nonplanar", "inches"):
        document = ezdxf.new("R2000")
        if kind == "text":
            document.modelspace().add_text("unsupported")
        elif kind == "nonplanar":
            document.modelspace().add_line((0, 0, 2), (10, 10, 2))
        else:
            document.units = 1
            document.modelspace().add_line((0, 0), (10, 10))
        stream = io.StringIO()
        document.write(stream)
        with pytest.raises(ValueError):
            cnc.extract_dxf(stream.getvalue())


@pytest.mark.parametrize("algorithm", ["nearest", "x-sort"])
def test_optimization_preserves_all_contours_and_never_worsens_travel(algorithm: str) -> None:
    text = cnc.sample("scattered")
    contours, _ = cnc.extract_dxf(text)
    result = cnc.optimize(text, algorithm)
    assert result["after_mm"] <= result["before_mm"]
    assert sorted(result["order"]) == list(range(1, len(contours) + 1))
    assert result["cut_mm"] == 324
    before_cuts = [s["points"] for s in result["before"] if s["kind"] == "cut"]
    after_cuts = [s["points"] for s in result["after"] if s["kind"] == "cut"]
    assert sorted(before_cuts) == sorted(after_cuts)
    if algorithm == "nearest":
        assert result["saved_pct"] == 59.42


def test_worse_sort_retains_original_order() -> None:
    # The first contour ends exactly at the second start; X sorting breaks that.
    text = drawing([[(10, 0), (1, 0)], [(1, 0), (100, 0)]])
    result = cnc.optimize(text, "x-sort")
    assert result["kept_original"] is True
    assert result["order"] == [1, 2]
    assert result["saved_pct"] == 0


def test_matplotlib_export_and_api_validation() -> None:
    async def check() -> None:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            valid = await client.post("/api/cnc/visualize",
                                      json={"code": "G0 X10\nG1 Y10 F600"})
            assert valid.status_code == 200
            assert "<svg" in valid.json()["svg"]
            invalid = await client.post("/api/cnc/visualize", json={"code": "garbage"})
            assert invalid.status_code == 422
            for path, body in [("convert", {"feed": 0}), ("convert", {"dxf": "invalid"}),
                               ("optimize", {"algorithm": "random"})]:
                assert (await client.post(f"/api/cnc/{path}", json=body)).status_code == 422
            assert (await client.get("/api/cnc/sample/scattered")).status_code == 200
            assert (await client.get("/api/cnc/sample/unknown")).status_code == 404
            # New public assets are served; backend source is still private.
            assert (await client.get("/assets/cnc-demos.js")).status_code == 200
            assert (await client.get("/backend/services/cnc.py")).status_code == 404
    asyncio.run(check())


def test_conversion_options_line_spans_and_cycle_time() -> None:
    result = cnc.convert(cnc.sample("mounting-plate"), feed=600, depth=2.5, safe_z=8)
    lines = result["gcode"].splitlines()
    assert "G1 Z-2.5 F600" in lines and "G0 Z8" in lines
    assert len(result["contour_lines"]) == len(result["contours"])
    first, last = result["contour_lines"][0]
    assert lines[first - 1] == "(Contour 1)" and lines[last - 1] == "G0 Z8"
    expected = result["cut_mm"] / 600 + result["rapid_mm"] / cnc.RAPID_MM_PER_MIN
    assert result["cycle_minutes"] == pytest.approx(expected, abs=0.01)
    with pytest.raises(ValueError):
        cnc.convert(cnc.sample("mounting-plate"), depth=50)


def test_two_opt_is_never_worse_and_finds_small_optima() -> None:
    import itertools

    for seed in range(4):
        contours = cnc.random_layout(seed, 6)
        best = min(cnc._travel(list(p)) for p in itertools.permutations(contours))
        nearest = cnc._travel([contours[i] for i in cnc._nearest(contours)])
        two_opt = cnc._travel([contours[i] for i in cnc._two_opt(contours)])
        assert best - 1e-6 <= two_opt <= nearest + 1e-6


def test_compare_all_algorithms_on_a_reproducible_random_layout() -> None:
    contours = cnc.random_layout(42, 12)
    assert contours == cnc.random_layout(42, 12)
    result = cnc.optimize_contours(contours, "all")
    routes = result["routes"]
    assert set(routes) == {"nearest", "x-sort", "two-opt"}
    assert result["algorithm"] == min(routes, key=lambda n: routes[n]["rapid_mm"])
    assert routes["two-opt"]["rapid_mm"] <= routes["nearest"]["rapid_mm"] + 1e-6
    for route in routes.values():
        assert sorted(route["order"]) == list(range(1, 13))
