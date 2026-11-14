"""Pruebas de efemérides (rol A). La primera corrida descarga kernels (internet)."""
from datetime import datetime, timezone

from backend.ephemeris import get_ephemeris

UTC = timezone.utc


def test_contract_format():
    start = datetime(2027, 1, 1, tzinfo=UTC)
    end = datetime(2027, 1, 2, tzinfo=UTC)
    r = get_ephemeris(-89.5, 0.0, start, end, 60)
    n = 25  # 24 h con paso de 60 min, ambos extremos incluidos
    assert len(r["t"]) == n
    for body in ("sun", "earth"):
        assert len(r[body]["az"]) == n and len(r[body]["el"]) == n
        assert all(0.0 <= a < 360.0 for a in r[body]["az"])
        assert all(-90.0 <= e <= 90.0 for e in r[body]["el"])
    assert r["source"] != "mock"
    assert r["t"][0] == "2027-01-01T00:00:00Z"


def test_south_pole_sun_stays_low():
    """En el polo sur el Sol sube solo unos pocos grados durante todo el año."""
    start = datetime(2027, 1, 1, tzinfo=UTC)
    end = datetime(2027, 12, 31, tzinfo=UTC)
    r = get_ephemeris(-89.5, 0.0, start, end, 360)
    assert 0.0 < max(r["sun"]["el"]) < 3.0


def test_far_side_never_sees_earth():
    """Un sitio de la cara oculta nunca ve la Tierra."""
    start = datetime(2027, 1, 1, tzinfo=UTC)
    end = datetime(2027, 1, 31, tzinfo=UTC)
    r = get_ephemeris(0.0, 180.0, start, end, 180)
    assert max(r["earth"]["el"]) < 0.0


def test_sub_earth_point_sees_earth_high():
    """Cerca del centro de la cara visible la Tierra está casi en el cenit."""
    start = datetime(2027, 1, 1, tzinfo=UTC)
    end = datetime(2027, 1, 31, tzinfo=UTC)
    r = get_ephemeris(0.0, 0.0, start, end, 180)
    assert min(r["earth"]["el"]) > 75.0