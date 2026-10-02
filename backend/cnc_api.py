"""Request validation and routes for the three CNC project demos."""

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from .services import cnc

router = APIRouter(prefix="/api/cnc", tags=["CNC demos"])


class GCodeInput(BaseModel):
    code: str = Field(min_length=1, max_length=100_000)


class DrawingInput(BaseModel):
    sample: str = "mounting-plate"
    dxf: str | None = Field(default=None, min_length=1, max_length=500_000)
    feed: float = Field(default=600, ge=50, le=3000)
    algorithm: str = "nearest"


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
        return cnc.visualize(body.code)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/convert")
def convert(body: DrawingInput) -> dict:
    try:
        return cnc.convert(_drawing(body), body.feed)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/optimize")
def optimize(body: DrawingInput) -> dict:
    try:
        return cnc.optimize(_drawing(body), body.algorithm)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
