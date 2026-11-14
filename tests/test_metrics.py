from backend.metrics import compute_metrics

T = [f"2027-01-01T{h:02d}:00:00Z" for h in range(5)]  # paso de 60 min
FLAT = {"az_step_deg": 1, "el": [0.0] * 360, "source": "test"}


def _eph(sun_el, earth_el):
    n = len(sun_el)
    return {
        "t": T[:n],
        "sun": {"az": [10.0] * n, "el": sun_el},
        "earth": {"az": [20.0] * n, "el": earth_el},
        "source": "test",
    }


def test_sun_percentages_and_dark_run():
    m = compute_metrics(_eph([1, 1, -1, -1, 1], [1, 1, 1, 1, 1]), FLAT)
    assert m["sun_lit_pct"] == 60.0
    assert m["longest_dark_h"] == 2.0
    assert m["earth_visible_pct"] == 100.0
    assert m["longest_comms_gap_h"] == 0.0
    assert m["hours_to_sun_change"] == 2.0
    assert m["hours_to_earth_change"] is None
    assert m["intervals"]["sun"] == [[T[0], T[1]], [T[4], T[4]]]


def test_terrain_blocks_body():
    hor = {"az_step_deg": 1, "el": [5.0] * 360, "source": "test"}
    m = compute_metrics(_eph([3, 3, 3], [8, 8, 8]), hor)
    assert m["sun_lit_pct"] == 0.0       # 3° < horizonte de 5°
    assert m["earth_visible_pct"] == 100.0
