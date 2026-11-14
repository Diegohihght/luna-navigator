"""Pruebas del horizonte (rol B).

Las pruebas del núcleo usan terreno sintético (no necesitan el DEM).
La prueba con LOLA real se omite si falta el archivo o rasterio.
"""
import math

import numpy as np
import pytest

from backend import horizon
from backend.horizon import _destination, compute_profile

R = horizon.MOON_RADIUS_M


def _flat(lats, lons):
    return np.zeros(np.shape(lats))


def _gc_distance_m(lat1, lon1, lat2, lon2):
    """Distancia de círculo máximo (haversine) en metros."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp = p2 - p1
    dl = np.radians(lon2) - np.radians(lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * R * np.arcsin(np.sqrt(np.clip(a, 0, 1)))


def _bump_at(lat, lon, az, dist_m, height=800.0, radius_m=3000.0):
    """Terreno plano con una montaña cónica en la dirección (az, dist).

    Es un cono (y no una meseta) para que el máximo sea único.
    """
    plat, plon = _destination(lat, lon, az, dist_m)

    def fn(lats, lons):
        d = _gc_distance_m(lats, lons, plat, plon)
        return height * np.clip(1.0 - d / radius_m, 0.0, None)

    return fn


def test_flat_terrain_horizon_is_zero():
    prof = compute_profile(-85.0, 30.0, 50_000, 100, _flat)
    assert len(prof) == 360
    assert np.all(np.isfinite(prof))
    assert np.all(prof < 0.01) and np.all(prof > -0.05)  # solo cae un poco por curvatura


@pytest.mark.parametrize("az", [0, 90, 180, 270])
def test_mountain_appears_at_correct_azimuth(az):
    """Una montaña al norte/este/sur/oeste debe verse en ese azimut (0 = norte, horario)."""
    lat, lon = -85.0, 30.0
    prof = compute_profile(lat, lon, 30_000, 100, _bump_at(lat, lon, az, 10_000))
    assert int(np.argmax(prof)) == az
    assert 4.0 < prof[az] < 4.8  # ~atan(800/10000) menos la caída por curvatura
    assert prof[(az + 180) % 360] < 0.05  # del lado opuesto no hay nada


def test_curvature_lowers_distant_terrain():
    """El mismo relieve más lejos se ve más bajo, y la curvatura lo baja más aún."""
    lat, lon = -85.0, 30.0
    near = compute_profile(lat, lon, 40_000, 100, _bump_at(lat, lon, 90, 8_000))
    far = compute_profile(lat, lon, 40_000, 100, _bump_at(lat, lon, 90, 30_000))
    assert near[90] > far[90] > 0.0


def test_pole_site_does_not_crash():
    prof = compute_profile(-90.0, 0.0, 10_000, 100, _flat)
    assert len(prof) == 360 and np.all(np.isfinite(prof))


def test_missing_data_is_ignored():
    """Donde el DEM no tiene datos (NaN) no se inventa terreno."""
    def fn(lats, lons):
        out = np.zeros(np.shape(lats))
        out[np.asarray(lats) > -84.9] = np.nan  # hueco al norte del sitio
        return out

    prof = compute_profile(-85.0, 30.0, 20_000, 100, fn)
    assert np.all(np.isfinite(prof))


def test_outside_dem_falls_back_to_flat(tmp_path, monkeypatch):
    """Apolo 11 (0.7°N) queda fuera del DEM polar: horizonte plano con source mock."""
    monkeypatch.setattr(horizon, "CACHE_DIR", tmp_path)
    r = horizon.get_horizon(0.674, 23.473)
    assert r["source"] == "mock"
    assert len(r["el"]) == 360 and set(r["el"]) == {0.0}
    assert r["az_step_deg"] == 1


def test_real_lola_dem(tmp_path, monkeypatch):
    pytest.importorskip("rasterio")
    pytest.importorskip("pyproj")
    if not horizon.DEM_FILE.exists():
        pytest.skip("falta data/dem/LDEM_80S_80MPP_ADJ.TIF")
    monkeypatch.setattr(horizon, "CACHE_DIR", tmp_path)

    for lat, lon in [(-84.79, 29.20), (-89.9, 129.8), (-90.0, 0.0)]:  # im2, shackleton, polo
        r = horizon.get_horizon(lat, lon, 50)
        assert r["source"].startswith("LOLA"), r["source"]
        assert len(r["el"]) == 360
        assert all(math.isfinite(v) for v in r["el"])
        assert -5.0 < min(r["el"]) and max(r["el"]) < 45.0

    # la segunda llamada sale del caché y da lo mismo
    assert horizon.get_horizon(-84.79, 29.20, 50) == horizon.get_horizon(-84.79, 29.20, 50)