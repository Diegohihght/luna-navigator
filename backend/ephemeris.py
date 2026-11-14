"""Efemérides: posición del Sol y de la Tierra vistas desde un sitio lunar.

RESPONSABLE: Martin (rol A)

ESTADO: cálculo real con Skyfield (JPL DE421) y el marco lunar MOON_ME
(Mean Earth / Polar Axis), el mismo marco en que se dan las coordenadas
selenográficas (y las de LOLA). Incluye libración física.

Contrato de salida:
{
  "t": ["2027-01-01T00:00:00Z", ...],        # UTC, ISO 8601, paso constante
  "sun":   {"az": [...], "el": [...]},       # grados; az 0 = norte lunar, horario
  "earth": {"az": [...], "el": [...]},       # elevación geométrica (sin refracción)
  "source": "mock" | "skyfield-de421" | ...
}

Validar contra JPL Horizons (https://ssd.jpl.nasa.gov/horizons/) en 2-3 sitios.

Notas de implementación:
- Los kernels se descargan solos la primera vez (requiere internet) y se
  guardan en data/kernels/ (NO se suben a git).
- Las posiciones se calculan desde el centro de la Luna (con tiempo de luz)
  y se rotan al marco MOON_ME. Luego se resta la posición del observador
  (radio medio lunar) para incluir el paralaje, que importa para la Tierra.
- La base local (este, norte, arriba) se arma con latitud planetocéntrica
  y longitud este positiva.
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
    """Carga (una sola vez) escala de tiempo, efemérides y marco lunar."""
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
    """Base local (este, norte, arriba) en el marco MOON_ME, vectores unitarios."""
    lat = np.radians(lat_deg)
    lon = np.radians(lon_deg)
    up = np.array([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)])
    east = np.array([-np.sin(lon), np.cos(lon), 0.0])
    north = np.array([-np.sin(lat) * np.cos(lon), -np.sin(lat) * np.sin(lon), np.cos(lat)])
    return east, north, up


def _az_el(target_icrf_km, rot, east, north, up, observer_km):
    """Az/el (grados) de un cuerpo dado su vector desde el centro de la Luna.

    target_icrf_km: (3, N) en ICRF. rot: (3, 3, N) ICRF -> MOON_ME.
    """
    v = np.einsum("ijn,jn->in", rot, target_icrf_km)  # al marco lunar
    v = v - observer_km[:, None]  # desde el observador (paralaje)
    e, n, u = east @ v, north @ v, up @ v
    dist = np.sqrt(e * e + n * n + u * u)
    el = np.degrees(np.arcsin(u / dist))
    az = np.degrees(np.arctan2(e, n)) % 360.0
    return az, el


def get_ephemeris(lat: float, lon: float, start: datetime, end: datetime, step_min: int) -> dict:
    """Devuelve az/el de Sol y Tierra para el sitio (lat, lon) entre start y end."""
    if step_min <= 0:
        raise ValueError("step_min debe ser > 0")
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