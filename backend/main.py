"""Main API (integration: Diego).

Run from the repository root:
    uvicorn backend.main:app --reload
Open: http://127.0.0.1:8000        (frontend)
      http://127.0.0.1:8000/docs   (interactive API documentation)
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.staticfiles import StaticFiles

from . import ephemeris, horizon, metrics

ROOT = Path(__file__).resolve().parent.parent
SITES_FILE = ROOT / "data" / "sites.json"
MAX_SAMPLES = 20000

app = FastAPI(title="Lunar Landing Site Navigator")


def _sites() -> list[dict]:
    return json.loads(SITES_FILE.read_text(encoding="utf-8"))


def _parse_dt(value: str) -> datetime:
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, f"Invalid date: {value!r}. Use ISO 8601, e.g. 2027-01-01T00:00:00Z")
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _eph(lat: float, lon: float, start: str, end: str, step_min: int) -> dict:
    s, e = _parse_dt(start), _parse_dt(end)
    if e <= s:
        raise HTTPException(400, "end must be later than start")
    n = int((e - s).total_seconds() / 60 / step_min) + 1
    if n > MAX_SAMPLES:
        raise HTTPException(400, f"Too many samples ({n}). Increase step_min or reduce the range.")
    return ephemeris.get_ephemeris(lat, lon, s, e, step_min)


LAT = Query(..., ge=-90, le=90)
LON = Query(..., ge=-180, le=180)
STEP = Query(60, ge=1, le=1440)


@app.get("/api/sites")
def api_sites():
    return _sites()


@app.get("/api/ephemeris")
def api_ephemeris(lat: float = LAT, lon: float = LON, start: str = Query(...), end: str = Query(...), step_min: int = STEP):
    return _eph(lat, lon, start, end, step_min)


@app.get("/api/horizon")
def api_horizon(lat: float = LAT, lon: float = LON, radius_km: float = Query(50, gt=0, le=500)):
    return horizon.get_horizon(lat, lon, radius_km)


@app.get("/api/metrics")
def api_metrics(lat: float = LAT, lon: float = LON, start: str = Query(...), end: str = Query(...), step_min: int = STEP):
    eph = _eph(lat, lon, start, end, step_min)
    hor = horizon.get_horizon(lat, lon)
    return metrics.compute_metrics(eph, hor)


@app.get("/api/compare")
def api_compare(sites: str = Query(..., description="comma-separated ids"), start: str = Query(...), end: str = Query(...), step_min: int = STEP):
    by_id = {s["id"]: s for s in _sites()}
    out = []
    for sid in [x.strip() for x in sites.split(",") if x.strip()]:
        if sid not in by_id:
            raise HTTPException(404, f"Sitio desconocido: {sid}")
        s = by_id[sid]
        eph = _eph(s["lat"], s["lon"], start, end, step_min)
        hor = horizon.get_horizon(s["lat"], s["lon"])
        out.append({"id": sid, "name": s["name"], "metrics": metrics.compute_metrics(eph, hor)})
    return out


# The frontend is served by this same app (no Node or build step). Keep this mount last.
app.mount("/", StaticFiles(directory=ROOT / "frontend", html=True), name="frontend")
