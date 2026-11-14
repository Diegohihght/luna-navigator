"""Perfil de horizonte local (terreno) para un sitio lunar.

RESPONSABLE: Sennie (rol B)

ESTADO: cálculo real con el DEM polar de LOLA (data/dem/). Si el sitio queda
fuera del DEM, o falta el archivo o una librería, devuelve horizonte plano con
source="mock" para que el resto de la app no se rompa.

Cómo funciona:
  1. Se lee del DEM solo una ventana alrededor del sitio (no el mapa completo).
  2. Para cada azimut 0..359 se camina sobre la esfera lunar (círculo máximo)
     desde el sitio hacia afuera, hasta radius_km.
  3. En cada paso se calcula el ángulo de elevación del terreno visto desde el
     sitio, con geometría esférica exacta (incluye la curvatura lunar).
  4. El horizonte en ese azimut es el máximo de esos ángulos.
  5. El resultado se guarda en data/cache/ para no recalcularlo.

Contrato de salida:
{
  "az_step_deg": 1,
  "el": [360 valores],      # elevación del horizonte en cada azimut (grados)
  "source": "mock" | "LOLA <producto y resolución>"
}

Convenciones: azimut 0 = norte lunar, sentido horario (90 = este); latitud
planetocéntrica; longitud este positiva; elevación geométrica.
"""
from __future__ import annotations

import json
import logging
import math
from pathlib import Path
from typing import Callable

import numpy as np

log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
DEM_FILE = ROOT / "data" / "dem" / "LDEM_80S_80MPP_ADJ.TIF"  # 80-90°S, 80 m/px
CACHE_DIR = ROOT / "data" / "cache"

MOON_RADIUS_M = 1_737_400.0  # radio de referencia de los LDEM de LOLA
AZ_STEP_DEG = 1
N_AZ = 360
MIN_STEP_M = 50.0  # paso mínimo del ray-marching
MAX_STEPS = 1500  # tope de pasos por rayo (limita memoria con radios grandes)
OBSERVER_HEIGHT_M = 0.0  # altura de la antena o panel sobre el terreno

# Función que da la altura del terreno (m) en arreglos de lat/lon (grados).
# Devuelve NaN donde no hay datos.
HeightFn = Callable[[np.ndarray, np.ndarray], np.ndarray]


class _NoTerrainData(Exception):
    """El sitio no tiene datos de terreno (fuera del DEM o sin archivo)."""


# ---------------------------------------------------------------------------
# Núcleo geométrico (solo NumPy, no depende del DEM)
# ---------------------------------------------------------------------------
def _destination(lat_deg: float, lon_deg: float, az_deg, dist_m):
    """Punto destino al avanzar dist_m desde (lat, lon) con rumbo az (círculo máximo).

    az_deg y dist_m se pueden pasar como arreglos que se combinan por broadcasting.
    Devuelve (lat, lon) en grados, con lon en -180..180.
    """
    lat1 = math.radians(lat_deg)
    lon1 = math.radians(lon_deg)
    az = np.radians(az_deg)
    delta = np.asarray(dist_m, dtype=float) / MOON_RADIUS_M

    sin_lat2 = math.sin(lat1) * np.cos(delta) + math.cos(lat1) * np.sin(delta) * np.cos(az)
    sin_lat2 = np.clip(sin_lat2, -1.0, 1.0)
    lat2 = np.arcsin(sin_lat2)
    lon2 = lon1 + np.arctan2(
        np.sin(az) * np.sin(delta) * math.cos(lat1),
        np.cos(delta) - math.sin(lat1) * sin_lat2,
    )
    lon_out = (np.degrees(lon2) + 180.0) % 360.0 - 180.0
    return np.degrees(lat2), lon_out


def _elevation_deg(h_target, dist_m, h_observer: float):
    """Elevación (grados) de un punto del terreno visto desde el observador.

    Geometría esférica exacta: observador a radio R + h_observer, objetivo a
    radio R + h_target, separados por un arco de dist_m sobre la superficie.
    """
    delta = np.asarray(dist_m, dtype=float) / MOON_RADIUS_M
    r_target = MOON_RADIUS_M + h_target
    num = r_target * np.cos(delta) - (MOON_RADIUS_M + h_observer)
    den = r_target * np.sin(delta)
    return np.degrees(np.arctan2(num, den))


def compute_profile(
    lat: float,
    lon: float,
    radius_m: float,
    step_m: float,
    height_fn: HeightFn,
    observer_height_m: float = OBSERVER_HEIGHT_M,
) -> np.ndarray:
    """Calcula el horizonte (360 valores, grados) con ray-marching sobre la esfera."""
    # En el polo exacto el norte no está definido: se corre una distancia ínfima
    # (~0.03 m) a lo largo del meridiano del sitio. Es coherente con ephemeris.py.
    lat = float(np.clip(lat, -90.0 + 1e-6, 90.0 - 1e-6))

    h_site = float(height_fn(np.array([lat]), np.array([lon]))[0])
    if not math.isfinite(h_site):
        raise _NoTerrainData("el sitio no tiene datos de terreno")
    h_observer = h_site + observer_height_m

    az = np.arange(0, 360, AZ_STEP_DEG, dtype=float)[:, None]  # (360, 1)
    dist = np.arange(step_m, radius_m + step_m / 2.0, step_m)[None, :]  # (1, n)

    lats, lons = _destination(lat, lon, az, dist)  # (360, n)
    heights = np.asarray(height_fn(lats.ravel(), lons.ravel()), dtype=float).reshape(lats.shape)

    el = _elevation_deg(heights, dist, h_observer)  # NaN donde no hay terreno
    el = np.where(np.isfinite(el), el, -np.inf)
    horizon = el.max(axis=1)
    return np.where(np.isfinite(horizon), horizon, 0.0)


# ---------------------------------------------------------------------------
# Lectura del DEM de LOLA
# ---------------------------------------------------------------------------
def _bilinear(arr: np.ndarray, rows: np.ndarray, cols: np.ndarray) -> np.ndarray:
    """Interpolación bilineal en coordenadas de píxel (centros en enteros)."""
    h, w = arr.shape
    out = np.full(rows.shape, np.nan)
    ok = (rows >= 0) & (rows <= h - 1) & (cols >= 0) & (cols <= w - 1)
    r, c = rows[ok], cols[ok]
    r0 = np.floor(r).astype(int)
    c0 = np.floor(c).astype(int)
    r1 = np.minimum(r0 + 1, h - 1)
    c1 = np.minimum(c0 + 1, w - 1)
    fr, fc = r - r0, c - c0
    top = arr[r0, c0] * (1 - fc) + arr[r0, c1] * fc
    bot = arr[r1, c0] * (1 - fc) + arr[r1, c1] * fc
    out[ok] = top * (1 - fr) + bot * fr
    return out


def _lonlat_to_xy(ds) -> Callable:
    """Devuelve f(lon, lat) -> (x, y) en el sistema de coordenadas del DEM.

    Usa la proyección que trae el propio archivo (no se asume orientación).
    Si el archivo no trae CRS utilizable, usa estereográfica polar sur con
    lon_0 = 0 como respaldo.
    """
    if ds.crs is not None:
        try:
            import pyproj

            crs = pyproj.CRS.from_wkt(ds.crs.to_wkt())
            transformer = pyproj.Transformer.from_crs(crs.geodetic_crs, crs, always_xy=True)
            return lambda lon, lat: transformer.transform(lon, lat)
        except Exception as exc:  # noqa: BLE001
            log.warning("No pude usar el CRS del DEM (%s); uso estereográfica polar sur.", exc)
    else:
        log.warning("El DEM no trae CRS; uso estereográfica polar sur con lon_0 = 0.")

    def fallback(lon, lat):
        lon_r = np.radians(np.asarray(lon, dtype=float))
        lat_r = np.radians(np.asarray(lat, dtype=float))
        rho = 2.0 * MOON_RADIUS_M * np.tan(np.pi / 4.0 + lat_r / 2.0)
        return rho * np.sin(lon_r), rho * np.cos(lon_r)

    return fallback


def _open_window(ds, lat: float, lon: float, radius_m: float):
    """Lee del DEM una ventana alrededor del sitio y devuelve (height_fn, res_m)."""
    from rasterio.windows import Window

    to_xy = _lonlat_to_xy(ds)
    inv = ~ds.transform

    x0, y0 = to_xy(lon, lat)
    col0 = inv.a * x0 + inv.b * y0 + inv.c
    row0 = inv.d * x0 + inv.e * y0 + inv.f
    if not (0 <= col0 < ds.width and 0 <= row0 < ds.height):
        raise _NoTerrainData("el sitio está fuera de la cobertura del DEM")

    res_m = abs(ds.transform.a)
    half = int(math.ceil(radius_m / res_m)) + 4
    c_off = max(0, int(col0) - half)
    r_off = max(0, int(row0) - half)
    c_end = min(ds.width, int(col0) + half + 1)
    r_end = min(ds.height, int(row0) + half + 1)

    data = ds.read(1, window=Window(c_off, r_off, c_end - c_off, r_end - r_off), masked=True)
    arr = data.astype("float32").filled(np.nan)
    scale, offset = ds.scales[0], ds.offsets[0]
    if scale != 1.0 or offset != 0.0:
        arr = arr * scale + offset

    def height_fn(lats: np.ndarray, lons: np.ndarray) -> np.ndarray:
        x, y = to_xy(lons, lats)
        cols = inv.a * x + inv.b * y + inv.c - c_off - 0.5
        rows = inv.d * x + inv.e * y + inv.f - r_off - 0.5
        return _bilinear(arr, np.asarray(rows), np.asarray(cols))

    return height_fn, res_m


def _compute_from_dem(lat: float, lon: float, radius_km: float) -> dict:
    if not DEM_FILE.exists():
        raise _NoTerrainData(f"no existe {DEM_FILE.name} en data/dem/")
    import rasterio  # import tardío: el resto de la app corre sin rasterio

    radius_m = radius_km * 1000.0
    with rasterio.open(DEM_FILE) as ds:
        height_fn, res_m = _open_window(ds, lat, lon, radius_m)

    step_m = max(res_m, MIN_STEP_M, radius_m / MAX_STEPS)
    profile = compute_profile(lat, lon, radius_m, step_m, height_fn)
    return {
        "az_step_deg": AZ_STEP_DEG,
        "el": [round(float(v), 3) for v in profile],
        "source": f"LOLA {DEM_FILE.stem} ({res_m:.0f} m/px)",
    }


# ---------------------------------------------------------------------------
# Caché y respaldo
# ---------------------------------------------------------------------------
def _cache_path(lat: float, lon: float, radius_km: float) -> Path:
    name = f"horizon_{DEM_FILE.stem}_{lat:.4f}_{lon:.4f}_r{radius_km:g}.json"
    return CACHE_DIR / name


def _read_cache(path: Path) -> dict | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if len(data["el"]) == N_AZ and data["source"] != "mock":
            return data
    except (OSError, ValueError, KeyError, TypeError):
        pass
    return None


def _write_cache(path: Path, result: dict) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(result), encoding="utf-8")
    except OSError as exc:
        log.warning("No pude guardar el caché del horizonte: %s", exc)


def _flat_horizon() -> dict:
    return {"az_step_deg": AZ_STEP_DEG, "el": [0.0] * N_AZ, "source": "mock"}


def get_horizon(lat: float, lon: float, radius_km: float = 50.0) -> dict:
    """Devuelve la elevación del horizonte para az = 0..359 (paso 1°).

    Usa el DEM de LOLA cuando el sitio está dentro de su cobertura (80°S al
    polo). En otro caso devuelve horizonte plano con source="mock".
    """
    path = _cache_path(lat, lon, radius_km)
    cached = _read_cache(path)
    if cached is not None:
        return cached

    try:
        result = _compute_from_dem(lat, lon, radius_km)
    except _NoTerrainData as exc:
        log.info("Horizonte plano (mock) para (%s, %s): %s", lat, lon, exc)
        return _flat_horizon()
    except Exception:  # noqa: BLE001
        log.exception("Falló el cálculo del horizonte; uso horizonte plano (mock).")
        return _flat_horizon()

    _write_cache(path, result)
    return result