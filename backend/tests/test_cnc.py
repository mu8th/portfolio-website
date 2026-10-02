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
    "G81 X10 Y20", "G18 G2 X10 I5", "G1 X10 X20", "G0 G1 X10",
    "G2 X10 I1", "G3 X10 Z5 I5", "G0 X100001", "G1 X10 F0",
    "G0 X10\nM30\nG1 Y10", "G1 X10 Q2", "garbage",
])
def test_unsupported_programs_are_rejected(code: str) -> None:
    with pytest.raises(ValueError):
        cnc.visualize(code, export=False)


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
            invalid = await client.post("/api/cnc/visualize", json={"code": "G81 X10"})
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
