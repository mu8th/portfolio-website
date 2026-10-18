"""Request validation and routes for the three CNC project demos."""

from typing import Literal

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from .services import cnc

router = APIRouter(prefix="/api/cnc", tags=["CNC demos"])


class GCodeInput(BaseModel):
    code: str = Field(min_length=1, max_length=100_000)
    #: Render the Matplotlib SVG too (slower; the page asks only for downloads).
    export: bool = False


class DrawingInput(BaseModel):
    sample: str = "mounting-plate"
    dxf: str | None = Field(default=None, min_length=1, max_length=500_000)
    feed: float = Field(default=600, ge=50, le=3000)
    depth: float = Field(default=1.0, ge=0.1, le=20)
    safe_z: float = Field(default=5.0, ge=1, le=50)
    algorithm: Literal["nearest", "x-sort", "two-opt", "all"] = "nearest"
    #: "random" generates a reproducible scattered layout from ``seed``.
    layout: Literal["drawing", "random"] = "drawing"
    seed: int = Field(default=1, ge=0, le=1_000_000)
    count: int = Field(default=12, ge=1, le=24)


def _drawing(body: DrawingInput) -> str:
    return body.dxf if body.dxf is not None else cnc.sample(body.sample)


@router.get("/sample/{name}")
def sample(name: str) -> PlainTextResponse:
    try:
        return PlainTextResponse(
            cnc.sample(name), media_type="application/dxf",
            headers={"Content-Disposition": f'attachment; filename="{name}.dxf"'},
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/visualize")
def visualize(body: GCodeInput) -> dict:
    try:
        return cnc.visualize(body.code, export=body.export)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/convert")
def convert(body: DrawingInput) -> dict:
    try:
        return cnc.convert(_drawing(body), body.feed, body.depth, body.safe_z)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/optimize")
def optimize(body: DrawingInput) -> dict:
    try:
        if body.layout == "random":
            result = cnc.optimize_contours(cnc.random_layout(body.seed, body.count),
                                           body.algorithm)
            return {**result, "layout": "random", "seed": body.seed}
        return {**cnc.optimize(_drawing(body), body.algorithm), "layout": "drawing"}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
