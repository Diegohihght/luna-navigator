"""Generate the real relief data for the 3D views (frontend/vista3d.js).

OWNER: Diego (role D, integration). Reuses the DEM reading code in backend/horizon.py.

Output in frontend/data/relief/ (committed to git, about 3 MB in total):
  - globe_lola_1024x512.i16      global heights (m, little-endian Int16), 1 px ≈ 0.35° ≈ 10.7 km.
  - globe_albedo_1024x512.u8     albedo at 750 nm (Uint8, stretched between percentiles 1 and 99).
  - ground/ground_<lat>_<lon>.i16  local heights (m, little-endian Int16) of 256 × 256 px within
                                   ±8 km of each curated site (row 0 = north, col 0 = west).
  - manifest.json                sizes, files and sources.

Sources (NASA):
  - Heights: LRO LOLA Global LDEM 118 m (USGS Astrogeology) and, at the south pole,
    LOLA LDEM_80S_80MPP_ADJ 80 m (NASA GSFC PGDA, local file in data/dem/).
  - Albedo: Clementine UVVIS 750 nm Global Mosaic 118 m v2 (USGS Astrogeology).

Usage (from the repository root; requires internet, takes a few minutes):
    python scripts/build_relief.py            # globe + ground of all sites
    python scripts/build_relief.py --ground   # ground of the sites only
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
    """Read full rows of a remote GeoTIFF (in parallel) and average them to GLOBE_W columns."""
    import rasterio
    from rasterio.windows import Window

    def work(chunk: list[int]) -> dict[int, np.ndarray]:
        out = {}
        with rasterio.Env(**ENV), rasterio.open("/vsicurl/" + url) as ds:
            scale = ds.scales[0]
            k = ds.width // GLOBE_W
            for r in chunk:
                a = ds.read(1, window=Window(0, r, ds.width, 1), masked=True)[0].astype("float64")
                a = np.ma.masked_equal(a, 0) if ds.dtypes[0] == "uint8" else a  # 0 = no data in the mosaic
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
    """Fill gaps with the mean of their row (or the global mean if the row is empty)."""
    out = img.copy()
    gmean = np.nanmean(out)
    for j in range(out.shape[0]):
        row = out[j]
        m = np.nanmean(row) if np.isfinite(row).any() else gmean
        row[~np.isfinite(row)] = m
    return out


def build_globe() -> dict:
    """Global height map (LOLA) and albedo map (Clementine) at GLOBE_W × GLOBE_H."""
    src_h = 46080
    rows = [int((j + 0.5) * src_h / GLOBE_H) for j in range(GLOBE_H)]
    t0 = time.time()
    dem = _sample_rows(DEM_URL, rows)
    print(f"  LOLA heights: {time.time() - t0:.0f} s")
    t0 = time.time()
    alb = _sample_rows(ALBEDO_URL, rows)
    print(f"  Clementine albedo: {time.time() - t0:.0f} s")

    h = _fill_nan(np.stack([dem[r] for r in rows]))
    a = _fill_nan(np.stack([alb[r] for r in rows]))
    # Clementine is unreliable near the poles (very low Sun: banding and noise). The
    # contrast is computed with |lat| < 60°, and above that it blends to neutral grey (75° = pure grey).
    lat = 90.0 - (np.arange(GLOBE_H) + 0.5) * 180.0 / GLOBE_H
    mid = np.abs(lat) < 60
    lo, hi = np.percentile(a[mid], [1, 99])
    a01 = np.clip((a - lo) / (hi - lo), 0, 1)
    w = np.clip((np.abs(lat) - 60.0) / 15.0, 0, 1)[:, None]
    a8 = (a01 * (1 - w) + np.median(a01[mid]) * w) * 255

    OUT.mkdir(parents=True, exist_ok=True)
    np.round(h).astype("<i2").tofile(OUT / "globe_lola_1024x512.i16")
    np.round(a8).astype("u1").tofile(OUT / "globe_albedo_1024x512.u8")
    print(f"  heights: {h.min():.0f} .. {h.max():.0f} m")
    return {
        "w": GLOBE_W, "h": GLOBE_H,
        "heights": "globe_lola_1024x512.i16", "albedo": "globe_albedo_1024x512.u8",
        "heights_source": "NASA LRO LOLA Global LDEM 118 m (USGS Astrogeology), promedio a 1024x512",
        "albedo_source": ("Clementine UVVIS 750 nm Global Mosaic 118 m v2 (USGS Astrogeology), estirado p1-p99 "
                          "en |lat|<60°; por encima de 60° se funde a gris neutro (dato poco fiable en los polos)"),
        "layout": "equirectangular, fila 0 = 90°N, columna 0 = 180°W; Int16 LE en metros / Uint8",
    }


def build_ground(site: dict) -> dict | None:
    """Local heights (m) on an N × N grid of ±GROUND_EXTENT_M around the site."""
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
        print(f"  [OK] {site['id']:<13} {name} ({res_m:.0f} m/px)  relief {hgt.min():.0f}..{hgt.max():.0f} m")
        return {"file": f"ground/{fname}", "source": f"LOLA {name} ({res_m:.0f} m/px)"}
    print(f"  [NO DATA] {site['id']}")
    return None


def main(argv: list[str]) -> int:
    """Generate the globe and/or ground data and write manifest.json."""
    OUT.mkdir(parents=True, exist_ok=True)
    mpath = OUT / "manifest.json"
    manifest = json.loads(mpath.read_text(encoding="utf-8")) if mpath.exists() else {}
    if "--ground" not in argv:
        print("Globe:")
        manifest["globe"] = build_globe()
    print("Local ground of the sites:")
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
