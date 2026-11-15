"""Ephemerides: positions of the Sun and the Earth seen from a lunar site.

OWNER: Martin (role A)

STATUS: real computation with Skyfield (JPL DE421) and the MOON_ME frame
(Mean Earth / Polar Axis), the same frame in which selenographic coordinates
are given (and LOLA's). Includes physical libration.

Output contract:
{
  "t": ["2027-01-01T00:00:00Z", ...],        # UTC, ISO 8601, constant step
  "sun":   {"az": [...], "el": [...]},       # degrees; az 0 = lunar north, clockwise
  "earth": {"az": [...], "el": [...]},       # geometric elevation (no refraction)
  "source": "mock" | "skyfield-de421" | ...
}

Validate against JPL Horizons (https://ssd.jpl.nasa.gov/horizons/) at 2-3 sites.

Implementation notes:
- Kernels are downloaded automatically on first run (requires internet) and
  stored in data/kernels/ (NOT committed to git).
- Positions are computed from the Moon's centre (with light time) and rotated
  to the MOON_ME frame. The observer's position (mean lunar radius) is then
  subtracted to include parallax, which matters for the Earth.
- The local basis (east, north, up) is built from planetocentric latitude and
  positive east longitude.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

import numpy as np
from skyfield.api import Loader, PlanetaryConstants

MOON_RADIUS_KM = 1737.4
SOURCE = "skyfield-de421"
KERNEL_DIR = Path(__file__).resolve().parent.parent / "data" / "kernels"


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@lru_cache(maxsize=1)
def _load_kernels():
    """Load the timescale, ephemerides and lunar frame (once only)."""
    loader = Loader(str(KERNEL_DIR))
    ts = loader.timescale()
    eph = loader("de421.bsp")
    pc = PlanetaryConstants()
    pc.read_text(loader("moon_080317.tf"))
    pc.read_text(loader("pck00008.tpc"))
    pc.read_binary(loader("moon_pa_de421_1900-2050.bpc"))
    frame = pc.build_frame_named("MOON_ME_DE421")
    return ts, eph, frame


def _enu_basis(lat_deg: float, lon_deg: float):
    """Local basis (east, north, up) in the MOON_ME frame, as unit vectors."""
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    up = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    east = np.array([-np.sin(lon), np.cos(lon), 0.0])
    north = np.array([-np.sin(lat) * np.cos(lon), -np.sin(lat) * np.sin(lon), np.cos(lat)])
    return east, north, up


def _az_el(target_icrf_km, rot, east, north, up, observer_km):
    """Az/el (degrees) of a body, given its vector from the Moon's centre.

    target_icrf_km: (3, N) in ICRF. rot: (3, 3, N) ICRF -> MOON_ME.
    """
    v = np.einsum("ijn,jn->in", rot, target_icrf_km)  # into the lunar frame
    v = v - observer_km[:, None]  # relative to the observer (parallax)
    e, n, u = east @ v, north @ v, up @ v
    dist = np.sqrt(e * e + n * n + u * u)
    el = np.degrees(np.arcsin(u / dist))
    az = np.degrees(np.arctan2(e, n)) % 360.0
    return az, el


def get_ephemeris(lat: float, lon: float, start: datetime, end: datetime, step_min: int) -> dict:
    """Return az/el of the Sun and the Earth for the site (lat, lon) between start and end."""
    if step_min <= 0:
        raise ValueError("step_min must be > 0")
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)
    if end < start:
        raise ValueError("end debe ser >= start")

    times, step, cur = [], timedelta(minutes=step_min), start
    while cur <= end:
        times.append(cur)
        cur += step

    ts, eph, frame = _load_kernels()
    t = ts.from_datetimes(times)

    rot = np.asarray(frame.rotation_at(t))
    if rot.ndim == 2:
        rot = rot[:, :, None]

    moon = eph["moon"]
    moon_at = moon.at(t)
    sun_km = np.atleast_2d(moon_at.observe(eph["sun"]).position.km.T).T
    earth_km = np.atleast_2d(moon_at.observe(eph["earth"]).position.km.T).T

    east, north, up = _enu_basis(lat, lon)
    observer_km = MOON_RADIUS_KM * up

    sun_az, sun_el = _az_el(sun_km, rot, east, north, up, observer_km)
    earth_az, earth_el = _az_el(earth_km, rot, east, north, up, observer_km)

    return {
        "t": [_iso(d) for d in times],
        "sun": {"az": np.round(sun_az, 3).tolist(), "el": np.round(sun_el, 3).tolist()},
        "earth": {"az": np.round(earth_az, 3).tolist(), "el": np.round(earth_el, 3).tolist()},
        "source": SOURCE,
    }