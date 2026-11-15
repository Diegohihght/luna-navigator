"""Compress the local polar LOLA DEM to int16 (0.5 m steps) for the repository.

Input : data/dem/LDEM_80S_80MPP_ADJ.TIF   (float32, 80 m/px, 181 MB, NaN = nodata)
Output: data/dem/LDEM_80S_80MPP_ADJ_i16.tif (int16, GDAL scale 0.5, nodata -32768, ~46 MB)

The file stores heights as integers with GDAL scale/offset metadata; readers
(backend/horizon.py, scripts/build_relief.py) apply the scale when they read it.
Maximum rounding error: 0.25 m.

Usage (from the repository root):
    .venv/bin/python scripts/compress_dem.py
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "dem" / "LDEM_80S_80MPP_ADJ.TIF"
DST = ROOT / "data" / "dem" / "LDEM_80S_80MPP_ADJ_i16.tif"
SCALE = 0.5          # metres per integer step
NODATA = -32768      # int16 minimum, reserved for "no data"


def compress(src: Path = SRC, dst: Path = DST) -> None:
    """Write the int16 copy of the DEM at `dst`."""
    with rasterio.open(src) as r:
        a = r.read(1).astype("float64")
        profile = r.profile.copy()
    valid = np.isfinite(a)
    steps = np.round(np.where(valid, a, 0.0) / SCALE)
    if np.abs(steps[valid]).max() >= 32767:
        raise ValueError("heights do not fit in int16 at this scale")
    out = np.where(valid, steps, NODATA).astype("int16")
    profile.update(dtype="int16", nodata=NODATA, compress="deflate", predictor=2,
                   tiled=True, blockxsize=512, blockysize=512, zlevel=9)
    with rasterio.open(dst, "w", **profile) as w:
        w.write(out, 1)
        w.scales = (SCALE,)
        w.offsets = (0.0,)


if __name__ == "__main__":
    compress()
    print(f"wrote {DST} ({DST.stat().st_size / 2**20:.1f} MB)")
