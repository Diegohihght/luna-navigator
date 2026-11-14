"""Validación de ephemeris.py contra JPL Horizons (rol A).

Referencia: Horizons, Observer Table, centro Luna (301) con sitio definido,
marco MEAN_ME, DE441, sin refracción, Apparent AZ & EL.
Fechas: 2027-01-01 00:00, 06:00, 12:00 y 18:00 UTC.

Tolerancia 0.02 grados: Horizons incluye aberración estelar y este cálculo
no, lo que da diferencias de hasta ~0.008 grados.
"""
from datetime import datetime, timezone

import pytest

from backend.ephemeris import get_ephemeris

TOL_DEG = 0.02
START = datetime(2027, 1, 1, tzinfo=timezone.utc)
END = datetime(2027, 1, 1, 18, tzinfo=timezone.utc)

CASES = {
    "polo_sur": {
        "lat": -89.5, "lon": 0.0,
        "sun_az": [263.107, 260.066, 257.025, 253.983],
        "sun_el": [0.954, 0.924, 0.894, 0.864],
        "earth_az": [7.179, 7.045, 6.894, 6.727],
        "earth_el": [-5.752, -5.911, -6.050, -6.170],
    },
    "cara_visible_20N_45E": {
        "lat": 20.0, "lon": 45.0,
        "sun_az": [292.244, 294.620, 297.272, 300.256],
        "sun_el": [-48.182, -50.802, -53.370, -55.874],
        "earth_az": [254.372, 254.688, 254.987, 255.266],
        "earth_el": [50.555, 50.499, 50.420, 50.318],
    },
    "cara_oculta_45S_120W": {
        "lat": -45.0, "lon": -120.0,
        "sun_az": [31.613, 27.776, 23.815, 19.740],
        "sun_el": [41.510, 42.571, 43.504, 44.298],
        "earth_az": [113.904, 113.667, 113.430, 113.195],
        "earth_el": [-30.147, -30.180, -30.188, -30.170],
    },
}


def _ang_diff(a: float, b: float) -> float:
    """Diferencia angular mínima en grados (maneja el cruce 0/360)."""
    return abs((a - b + 180.0) % 360.0 - 180.0)


@pytest.mark.parametrize("name", list(CASES))
def test_matches_horizons(name):
    case = CASES[name]
    r = get_ephemeris(case["lat"], case["lon"], START, END, 360)
    assert len(r["t"]) == 4
    for i in range(4):
        assert _ang_diff(r["sun"]["az"][i], case["sun_az"][i]) < TOL_DEG
        assert abs(r["sun"]["el"][i] - case["sun_el"][i]) < TOL_DEG
        assert _ang_diff(r["earth"]["az"][i], case["earth_az"][i]) < TOL_DEG
        assert abs(r["earth"]["el"][i] - case["earth_el"][i]) < TOL_DEG