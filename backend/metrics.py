"""Métricas de energía y comunicación a partir de efemérides + horizonte.

RESPONSABLE: Diego (rol D)

Regla: el Sol (o la Tierra) es visible en un instante si su elevación es mayor
que la elevación del horizonte en su azimut.
"""
from __future__ import annotations

from datetime import datetime

import numpy as np


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _horizon_at(hor: dict, az) -> np.ndarray:
    """Elevación del horizonte interpolada (periódica) en los azimuts dados."""
    step = hor.get("az_step_deg", 1)
    grid = np.arange(len(hor["el"])) * step
    return np.interp(np.asarray(az, dtype=float) % 360.0, grid, hor["el"], period=360.0)


def _visible(body: dict, hor: dict) -> np.ndarray:
    return np.asarray(body["el"], dtype=float) > _horizon_at(hor, body["az"])


def _intervals(t: list[str], mask: np.ndarray) -> list[list[str]]:
    out, start = [], None
    for i, m in enumerate(mask):
        if m and start is None:
            start = i
        elif not m and start is not None:
            out.append([t[start], t[i - 1]])
            start = None
    if start is not None:
        out.append([t[start], t[-1]])
    return out


def _longest_run(mask: np.ndarray, value: bool) -> int:
    best = cur = 0
    for m in mask:
        cur = cur + 1 if bool(m) == value else 0
        best = max(best, cur)
    return best


def _hours_to_change(mask: np.ndarray, idx: int, step_h: float) -> float | None:
    """Horas desde idx hasta que el estado de visibilidad cambia (None si no cambia)."""
    for j in range(idx + 1, len(mask)):
        if mask[j] != mask[idx]:
            return round((j - idx) * step_h, 3)
    return None


def compute_metrics(eph: dict, hor: dict) -> dict:
    t = eph["t"]
    step_h = 1.0
    if len(t) > 1:
        step_h = (_parse(t[1]) - _parse(t[0])).total_seconds() / 3600.0

    sun_vis = _visible(eph["sun"], hor)
    earth_vis = _visible(eph["earth"], hor)

    return {
        "sun_lit_pct": round(float(sun_vis.mean()) * 100, 2),
        "longest_dark_h": round(_longest_run(sun_vis, False) * step_h, 3),
        "sun_el_max_deg": round(float(np.max(eph["sun"]["el"])), 3),
        "earth_visible_pct": round(float(earth_vis.mean()) * 100, 2),
        "longest_comms_gap_h": round(_longest_run(earth_vis, False) * step_h, 3),
        "hours_to_sun_change": _hours_to_change(sun_vis, 0, step_h),
        "hours_to_earth_change": _hours_to_change(earth_vis, 0, step_h),
        "intervals": {
            "sun": _intervals(t, sun_vis),
            "earth": _intervals(t, earth_vis),
        },
        "source": {"ephemeris": eph.get("source"), "horizon": hor.get("source")},
    }
