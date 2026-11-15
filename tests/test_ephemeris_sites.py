"""Compara ephemeris.py con los valores de JPL Horizons guardados (rol A).

Usa tests/horizons_validation/jpl_reference.json, generado con
tests/horizons_validation/compare_horizons.py, así que no necesita internet.
Si el archivo no existe, las pruebas se omiten.
"""
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from backend.ephemeris import get_ephemeris

REF_PATH = Path(__file__).parent / "horizons_validation" / "jpl_reference.json"
TOL_DEG = 0.02
_REF = json.loads(REF_PATH.read_text(encoding="utf-8")) if REF_PATH.exists() else {}


def _sep_deg(az1: float, el1: float, az2: float, el2: float) -> float:
    """Separación angular (grados) entre dos direcciones az/el."""

    def unit(az, el):
        a, e = math.radians(az), math.radians(el)
        return (math.cos(e) * math.sin(a), math.cos(e) * math.cos(a), math.sin(e))

    u, v = unit(az1, el1), unit(az2, el2)
    dot = sum(x * y for x, y in zip(u, v))
    cross = (
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
    )
    return math.degrees(math.atan2(math.sqrt(sum(c * c for c in cross)), dot))


@pytest.mark.skipif(not _REF, reason="falta tests/horizons_validation/jpl_reference.json")
@pytest.mark.parametrize("key", sorted(_REF))
def test_matches_jpl(key):
    site_id, day, body = key.split("|")
    ref = _REF[key]
    start = datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
    r = get_ephemeris(ref["lat"], ref["lon"], start, start + timedelta(hours=18), 360)
    for i in range(len(ref["az"])):
        sep = _sep_deg(r[body]["az"][i], r[body]["el"][i], ref["az"][i], ref["el"][i])
        assert sep < TOL_DEG, f"{site_id} {day} {body} hora {i * 6}h: separación {sep:.4f}°"