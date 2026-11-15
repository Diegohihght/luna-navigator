"""Precompute the horizon of the curated sites and save it to data/horizons/.

OWNER: Diego (role D, integration). Uses the horizon computation in backend/horizon.py (role B).

These profiles (360 numbers per site) ARE committed to git, so the app runs
without downloading any DEM (for example, for the Space Apps evaluators).

Usage, from the repository root:
    python scripts/build_horizons.py            # all sites in data/sites.json
    python scripts/build_horizons.py apollo15   # only the given ids

Sources (NASA LRO LOLA):
  - South pole (80°S-90°S): data/dem/LDEM_80S_80MPP_ADJ.TIF, 80 m/px (local
    download, see data/dem/README.txt).
  - Rest of the Moon: LOLA global DEM, 118 m/px, read remotely (requires internet).
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import horizon  # noqa: E402

RADIUS_KM = 50.0


def main(ids: list[str]) -> int:
    """Compute and save the profiles; returns 1 if any site had no real data."""
    sites = json.loads((ROOT / "data" / "sites.json").read_text(encoding="utf-8"))
    if ids:
        sites = [s for s in sites if s["id"] in ids]
    horizon.PRECOMPUTED_DIR.mkdir(parents=True, exist_ok=True)
    failed = 0
    for s in sites:
        t0 = time.time()
        try:
            result = horizon._compute_from_dem(s["lat"], s["lon"], RADIUS_KM)
        except horizon._NoTerrainData as exc:
            print(f"[NO DATA] {s['id']}: {exc}")
            failed += 1
            continue
        out = horizon.PRECOMPUTED_DIR / horizon.horizon_filename(s["lat"], s["lon"], RADIUS_KM)
        out.write_text(json.dumps(result) + "\n", encoding="utf-8")
        el = result["el"]
        print(f"[OK] {s['id']:<13} {result['source']:<48} max {max(el):6.2f}° "
              f"(az {el.index(max(el))}°)  min {min(el):6.2f}°  {time.time() - t0:5.1f} s")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
