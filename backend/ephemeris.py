"""Efemérides: posición del Sol y de la Tierra vistas desde un sitio lunar.

RESPONSABLE: Martin (rol A)

ESTADO: STUB con datos simulados (source="mock"). Reemplazar el cuerpo de
`get_ephemeris` por el cálculo real (Skyfield con marco lunar, o SpiceyPy),
respetando EXACTAMENTE la firma y el formato de salida.

Contrato de salida:
{
  "t": ["2027-01-01T00:00:00Z", ...],        # UTC, ISO 8601, paso constante
  "sun":   {"az": [...], "el": [...]},       # grados; az 0 = norte lunar, horario
  "earth": {"az": [...], "el": [...]},       # elevación geométrica (sin refracción)
  "source": "mock" | "skyfield-de440" | ...
}

Validar contra JPL Horizons (https://ssd.jpl.nasa.gov/horizons/) en 2-3 sitios.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get_ephemeris(lat: float, lon: float, start: datetime, end: datetime, step_min: int) -> dict:
    """Devuelve az/el de Sol y Tierra para el sitio (lat, lon) entre start y end."""
    t, sun_az, sun_el, earth_az, earth_el = [], [], [], [], []
    step = timedelta(minutes=step_min)
    cur = start
    sun_amp = min(90.0, (90.0 - abs(lat)) + 1.5)  # simulado
    while cur <= end:
        d = (cur - start).total_seconds() / 86400.0
        sun_phase = 2 * math.pi * d / 29.53
        earth_phase = 2 * math.pi * d / 27.3
        t.append(_iso(cur))
        sun_az.append(round((360.0 * d / 29.53) % 360.0, 3))
        sun_el.append(round(sun_amp * math.sin(sun_phase), 3))
        earth_az.append(round(30.0 + 10.0 * math.sin(earth_phase), 3))
        earth_el.append(round(4.0 + 6.0 * math.sin(earth_phase + 1.0), 3))
        cur += step
    return {
        "t": t,
        "sun": {"az": sun_az, "el": sun_el},
        "earth": {"az": earth_az, "el": earth_el},
        "source": "mock",
    }
