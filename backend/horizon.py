"""Perfil de horizonte local (terreno) para un sitio lunar.

RESPONSABLE: Sennie (rol B)

ESTADO: cálculo real con DEMs de LOLA (NASA LRO). Orden de búsqueda:
  1. Horizonte precalculado en data/horizons/ (versionado en Git: permite
     correr la app sin descargar ningún DEM; lo genera scripts/build_horizons.py).
  2. Caché local en data/cache/.
  3. DEM polar local data/dem/LDEM_80S_80MPP_ADJ.TIF (80°S al polo, 80 m/px).
  4. DEM global de LOLA (118 m/px) leído en remoto por HTTP, solo la ventana
     del sitio (requiere internet; ~40 s la primera vez). Se desactiva con la
     variable de entorno LUNAR_GLOBAL_DEM="off" o se apunta a una copia local.
  5. Si nada funciona: horizonte plano con source="mock" (la app no se rompe).

Cómo funciona el cálculo:
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
import os
import time
from pathlib import Path
from typing import Callable

import numpy as np

log = logging.getLogger(__name__)

ROOT = Path(__file__).resolve().parent.parent
DEM_FILE = ROOT / "data" / "dem" / "LDEM_80S_80MPP_ADJ.TIF"  # 80-90°S, 80 m/px
CACHE_DIR = ROOT / "data" / "cache"
PRECOMPUTED_DIR = ROOT / "data" / "horizons"  # versionado en Git

# DEM global de LOLA (NASA LRO), 118 m/px, publicado por USGS Astrogeology:
# https://astrogeology.usgs.gov/search/map/moon_lro_lola_dem_118m
# Proyección cilíndrica simple, R = 1737.4 km, enteros con escala 0.5 (se aplica sola).
GLOBAL_DEM_DEFAULT = "https://planetarymaps.usgs.gov/mosaic/Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif"
GLOBAL_DEM = os.environ.get("LUNAR_GLOBAL_DEM", GLOBAL_DEM_DEFAULT)
REMOTE_RETRY_S = 300.0  # tras un fallo de red, no se reintenta el remoto durante 5 min
_remote_down_until = 0.0

MOON_RADIUS_M = 1_737_400.0  # radio de referencia de los LDEM de LOLA
AZ_STEP_DEG = 1
N_AZ = 360
MIN_STEP_M = 50.0  # paso mínimo del ray-marching
MAX_STEPS = 1500  # tope de pasos por rayo (limita memoria con radios grandes)
OBSERVER_HEIGHT_M = 0.0  # altura de la antena o panel sobre el terreno
MAX_WINDOW_PX = 12_000_000  # tope de píxeles leídos del DEM por sitio (~48 MB en float32)

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

    # La ventana se calcula proyectando el círculo de radio radius_m alrededor
    # del sitio: funciona con cualquier proyección (estereográfica polar o
    # cilíndrica, donde a latitudes altas el círculo se estira en este-oeste).
    # Igual que en compute_profile: en el polo exacto el rumbo no está definido.
    lat_c = float(np.clip(lat, -90.0 + 1e-6, 90.0 - 1e-6))
    ring_lat, ring_lon = _destination(lat_c, lon, np.arange(0.0, 360.0, 2.0), radius_m)
    rx, ry = to_xy(np.append(ring_lon, lon), np.append(ring_lat, lat))
    rx, ry = np.asarray(rx), np.asarray(ry)
    ring_cols = inv.a * rx + inv.b * ry + inv.c
    ring_rows = inv.d * rx + inv.e * ry + inv.f

    res_m = abs(ds.transform.a)
    margin = 4
    c_off = max(0, int(math.floor(ring_cols.min())) - margin)
    r_off = max(0, int(math.floor(ring_rows.min())) - margin)
    c_end = min(ds.width, int(math.ceil(ring_cols.max())) + margin + 1)
    r_end = min(ds.height, int(math.ceil(ring_rows.max())) + margin + 1)
    if (c_end - c_off) * (r_end - r_off) > MAX_WINDOW_PX:
        # Pasa con la proyección cilíndrica muy cerca de un polo (o al cruzar ±180°).
        raise _NoTerrainData("la ventana sería demasiado grande en este DEM (¿sitio cerca del polo?)")

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


def _dem_sources() -> list[tuple[str, str, bool]]:
    """DEMs a probar, en orden: (ruta o URL para rasterio, nombre, es_remoto)."""
    out: list[tuple[str, str, bool]] = []
    if DEM_FILE.exists():
        out.append((str(DEM_FILE), DEM_FILE.stem, False))
    g = (GLOBAL_DEM or "").strip()
    if g and g.lower() != "off":
        remote = g.startswith(("http://", "https://"))
        if not remote and not Path(g).exists():
            log.warning("LUNAR_GLOBAL_DEM apunta a un archivo que no existe: %s", g)
        else:
            path = f"/vsicurl/{g}" if remote else g
            stem = Path(g.split("?")[0]).stem.replace("Lunar_LRO_LOLA_", "")
            out.append((path, stem, remote))
    return out


def _compute_from_dem(lat: float, lon: float, radius_km: float) -> dict:
    global _remote_down_until
    sources = _dem_sources()
    if not sources:
        raise _NoTerrainData(f"no existe {DEM_FILE.name} en data/dem/ y el DEM global está desactivado")
    import rasterio  # import tardío: el resto de la app corre sin rasterio

    radius_m = radius_km * 1000.0
    reasons = []
    for path, name, remote in sources:
        if remote and time.monotonic() < _remote_down_until:
            reasons.append(f"{name}: remoto no disponible (fallo reciente)")
            continue
        env = dict(
            GDAL_HTTP_TIMEOUT=30, GDAL_HTTP_MAX_RETRY=2, GDAL_HTTP_RETRY_DELAY=1,
            GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.TIF",
        )
        try:
            with rasterio.Env(**env), rasterio.open(path) as ds:
                height_fn, res_m = _open_window(ds, lat, lon, radius_m)
        except _NoTerrainData as exc:
            reasons.append(f"{name}: {exc}")
            continue
        except Exception as exc:  # noqa: BLE001  (red caída, archivo corrupto, etc.)
            if remote:
                _remote_down_until = time.monotonic() + REMOTE_RETRY_S
            log.warning("No pude leer el DEM %s: %s", name, exc)
            reasons.append(f"{name}: {exc}")
            continue

        step_m = max(res_m, MIN_STEP_M, radius_m / MAX_STEPS)
        profile = compute_profile(lat, lon, radius_m, step_m, height_fn)
        return {
            "az_step_deg": AZ_STEP_DEG,
            "el": [round(float(v), 3) for v in profile],
            "source": f"LOLA {name} ({res_m:.0f} m/px)",
        }
    raise _NoTerrainData("; ".join(reasons))


# ---------------------------------------------------------------------------
# Caché, perfiles precalculados y respaldo
# ---------------------------------------------------------------------------
def horizon_filename(lat: float, lon: float, radius_km: float) -> str:
    """Nombre de archivo de un perfil (mismo esquema en caché y en precalculados)."""
    return f"horizon_{lat:.4f}_{lon:.4f}_r{radius_km:g}.json"


def _cache_path(lat: float, lon: float, radius_km: float) -> Path:
    return CACHE_DIR / horizon_filename(lat, lon, radius_km)


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

    Orden: perfil precalculado (data/horizons/), caché, DEM polar local, DEM
    global remoto. Si ninguno sirve, horizonte plano con source="mock".
    """
    pre = _read_cache(PRECOMPUTED_DIR / horizon_filename(lat, lon, radius_km))
    if pre is not None:
        return pre

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