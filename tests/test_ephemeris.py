"""Ephemeris tests (role A). The first run downloads the kernels (requires internet)."""
from datetime import datetime, timezone

from backend.ephemeris import get_ephemeris

UTC = timezone.utc


def test_contract_format():
    start = datetime(2027, 1, 1, tzinfo=UTC)
    end = datetime(2027, 1, 2, tzinfo=UTC)
    r = get_ephemeris(-89.5, 0.0, start, end, 60)
    n = 25  # 24 h at 60-min steps, both endpoints included
    assert len(r["t"]) == n
    for body in ("sun", "earth"):
        assert len(r[body]["az"]) == n and len(r[body]["el"]) == n
        assert all(0.0 <= a < 360.0 for a in r[body]["az"])
        assert all(-90.0 <= e <= 90.0 for e in r[body]["el"])
    assert r["source"] != "mock"
    assert r["t"][0] == "2027-01-01T00:00:00Z"


def test_south_pole_sun_stays_low():
    """At the south pole the Sun rises only a few degrees all year."""
    start = datetime(2027, 1, 1, tzinfo=UTC)
    end = datetime(2027, 12, 31, tzinfo=UTC)
    r = get_ephemeris(-89.5, 0.0, start, end, 360)
    assert 0.0 < max(r["sun"]["el"]) < 3.0


def test_far_side_never_sees_earth():
    """A far-side site never sees the Earth."""
    start = datetime(2027, 1, 1, tzinfo=UTC)
    end = datetime(2027, 1, 31, tzinfo=UTC)
    r = get_ephemeris(0.0, 180.0, start, end, 180)
    assert max(r["earth"]["el"]) < 0.0


def test_sub_earth_point_sees_earth_high():
    """Near the centre of the near side the Earth is almost at the zenith."""
    start = datetime(2027, 1, 1, tzinfo=UTC)
    end = datetime(2027, 1, 31, tzinfo=UTC)
    r = get_ephemeris(0.0, 0.0, start, end, 180)
    assert min(r["earth"]["el"]) > 75.0