"""Genera los datos de relieve real para las vistas 3D (frontend/vista3d.js).

RESPONSABLE: Diego (rol D, integración). Reutiliza la lectura de DEMs de backend/horizon.py.

Salida en frontend/data/relief/ (versionada en Git, ~3 MB en total):
  - globe_lola_1024x512.i16      alturas globales (m, Int16 little-endian), 1 px ≈ 0.35° ≈ 10.7 km.
  - globe_albedo_1024x512.u8     albedo 750 nm (Uint8, estirado entre percentiles 1 y 99).
  - ground/ground_<lat>_<lon>.i16  alturas locales (m, Int16 LE) de 256 × 256 px en ±8 km
                                   alrededor de cada sitio curado (fila 0 = norte, col 0 = oeste).
  - manifest.json                tamaños, archivos y fuentes.

Fuentes (NASA):
  - Alturas: LRO LOLA Global LDEM 118 m (USGS Astrogeology) y, en el polo sur,
    LOLA LDEM_80S_80MPP_ADJ 80 m (NASA GSFC PGDA, archivo local en data/dem/).
  - Albedo: Clementine UVVIS 750 nm Global Mosaic 118 m v2 (USGS Astrogeology).

Uso (desde la raíz; requiere internet, tarda unos minutos):
    python scripts/build_relief.py            # globo + suelo de todos los sitios
    python scripts/build_relief.py --ground   # solo el suelo de los sitios
"""
from __future__ import annotations

import json
import math
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import horizon  # noqa: E402

OUT = ROOT / "frontend" / "data" / "relief"
MOSAIC = "https://planetarymaps.usgs.gov/mosaic/"
DEM_URL = MOSAIC + "Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif"
ALBEDO_URL = MOSAIC + "Lunar_Clementine_UVVIS_750nm_Global_Mosaic_118m_v2.tif"
GLOBE_W, GLOBE_H = 1024, 512
GROUND_N, GROUND_EXTENT_M = 256, 8000.0
ENV = dict(GDAL_HTTP_TIMEOUT=60, GDAL_HTTP_MAX_RETRY=4, GDAL_HTTP_RETRY_DELAY=2,
           GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif")


def _sample_rows(url: str, rows: list[int], workers: int = 8) -> dict[int, np.ndarray]:
    """Lee filas completas de un GeoTIFF remoto (en paralelo) y las promedia a GLOBE_W columnas."""
    import rasterio
    from rasterio.windows import Window

    def work(chunk: list[int]) -> dict[int, np.ndarray]:
        out = {}
        with rasterio.Env(**ENV), rasterio.open("/vsicurl/" + url) as ds:
            scale = ds.scales[0]
            k = ds.width // GLOBE_W
            for r in chunk:
                a = ds.read(1, window=Window(0, r, ds.width, 1), masked=True)[0].astype("float64")
                a = np.ma.masked_equal(a, 0) if ds.dtypes[0] == "uint8" else a  # 0 = sin datos en el mosaico
                a = a.reshape(GLOBE_W, k).mean(axis=1) * scale
                out[r] = np.ma.filled(a, np.nan)
        return out

    chunks = [rows[i::workers] for i in range(workers)]
    res: dict[int, np.ndarray] = {}
    with ThreadPoolExecutor(workers) as ex:
        for part in ex.map(work, chunks):
            res.update(part)
    return res


def _fill_nan(img: np.ndarray) -> np.ndarray:
    """Rellena huecos con el promedio de su fila (o el global si la fila está vacía)."""
    out = img.copy()
    gmean = np.nanmean(out)
    for j in range(out.shape[0]):
        row = out[j]
        m = np.nanmean(row) if np.isfinite(row).any() else gmean
        row[~np.isfinite(row)] = m
    return out


def build_globe() -> dict:
    """Mapa global de alturas (LOLA) y de albedo (Clementine) a GLOBE_W × GLOBE_H."""
    src_h = 46080
    rows = [int((j + 0.5) * src_h / GLOBE_H) for j in range(GLOBE_H)]
    t0 = time.time()
    dem = _sample_rows(DEM_URL, rows)
    print(f"  alturas LOLA: {time.time() - t0:.0f} s")
    t0 = time.time()
    alb = _sample_rows(ALBEDO_URL, rows)
    print(f"  albedo Clementine: {time.time() - t0:.0f} s")

    h = _fill_nan(np.stack([dem[r] for r in rows]))
    a = _fill_nan(np.stack([alb[r] for r in rows]))
    # Clementine es poco fiable cerca de los polos (Sol muy bajo: bandas y ruido). El
    # contraste se calcula con |lat| < 60° y por encima se funde a gris neutro (75° = gris puro).
    lat = 90.0 - (np.arange(GLOBE_H) + 0.5) * 180.0 / GLOBE_H
    mid = np.abs(lat) < 60
    lo, hi = np.percentile(a[mid], [1, 99])
    a01 = np.clip((a - lo) / (hi - lo), 0, 1)
    w = np.clip((np.abs(lat) - 60.0) / 15.0, 0, 1)[:, None]
    a8 = (a01 * (1 - w) + np.median(a01[mid]) * w) * 255

    OUT.mkdir(parents=True, exist_ok=True)
    np.round(h).astype("<i2").tofile(OUT / "globe_lola_1024x512.i16")
    np.round(a8).astype("u1").tofile(OUT / "globe_albedo_1024x512.u8")
    print(f"  alturas: {h.min():.0f} .. {h.max():.0f} m")
    return {
        "w": GLOBE_W, "h": GLOBE_H,
        "heights": "globe_lola_1024x512.i16", "albedo": "globe_albedo_1024x512.u8",
        "heights_source": "NASA LRO LOLA Global LDEM 118 m (USGS Astrogeology), promedio a 1024x512",
        "albedo_source": ("Clementine UVVIS 750 nm Global Mosaic 118 m v2 (USGS Astrogeology), estirado p1-p99 "
                          "en |lat|<60°; por encima de 60° se funde a gris neutro (dato poco fiable en los polos)"),
        "layout": "equirectangular, fila 0 = 90°N, columna 0 = 180°W; Int16 LE en metros / Uint8",
    }


def build_ground(site: dict) -> dict | None:
    """Alturas locales (m) en una malla N × N de ±GROUND_EXTENT_M alrededor del sitio."""
    import rasterio

    lat, lon = site["lat"], site["lon"]
    lat_c = float(np.clip(lat, -90 + 1e-6, 90 - 1e-6))
    n, e = GROUND_N, GROUND_EXTENT_M
    c = (np.arange(n) + 0.5) / n * 2 * e - e
    x_east, z_north = np.meshgrid(c, c[::-1])  # fila 0 = norte
    dist = np.hypot(x_east, z_north)
    az = np.degrees(np.arctan2(x_east, z_north)) % 360.0
    lats, lons = horizon._destination(lat_c, lon, az, dist)

    for path, name, _remote in horizon._dem_sources():
        try:
            with rasterio.Env(**ENV), rasterio.open(path) as ds:
                height_fn, res_m = horizon._open_window(ds, lat, lon, e * math.sqrt(2) + 500)
        except horizon._NoTerrainData:
            continue
        hgt = height_fn(lats.ravel(), lons.ravel()).reshape(n, n)
        if not np.isfinite(hgt).any():
            continue
        hgt = np.where(np.isfinite(hgt), hgt, np.nanmean(hgt))
        fname = f"ground_{lat:.4f}_{lon:.4f}.i16"
        (OUT / "ground").mkdir(parents=True, exist_ok=True)
        np.round(hgt).astype("<i2").tofile(OUT / "ground" / fname)
        print(f"  [OK] {site['id']:<13} {name} ({res_m:.0f} m/px)  relieve {hgt.min():.0f}..{hgt.max():.0f} m")
        return {"file": f"ground/{fname}", "source": f"LOLA {name} ({res_m:.0f} m/px)"}
    print(f"  [SIN DATOS] {site['id']}")
    return None


def main(argv: list[str]) -> int:
    """Genera globo y/o suelos y escribe manifest.json."""
    OUT.mkdir(parents=True, exist_ok=True)
    mpath = OUT / "manifest.json"
    manifest = json.loads(mpath.read_text(encoding="utf-8")) if mpath.exists() else {}
    if "--ground" not in argv:
        print("Globo:")
        manifest["globe"] = build_globe()
    print("Suelo local de los sitios:")
    sites = json.loads((ROOT / "data" / "sites.json").read_text(encoding="utf-8"))
    ground = {}
    for s in sites:
        r = build_ground(s)
        if r:
            ground[f"{s['lat']:.4f}_{s['lon']:.4f}"] = r
    manifest["ground"] = {"n": GROUND_N, "extent_m": GROUND_EXTENT_M,
                          "layout": "fila 0 = norte, columna 0 = oeste; Int16 LE en metros",
                          "sites": ground}
    mpath.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return 0 if len(ground) == len(sites) else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
