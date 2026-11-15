"""Precalcula el horizonte de los sitios curados y lo guarda en data/horizons/.

RESPONSABLE: Diego (rol D, integración). Usa el cálculo de backend/horizon.py (rol B).

Estos perfiles (360 números por sitio) SÍ se suben a Git: así la app corre sin
descargar ningún DEM (por ejemplo, los evaluadores del Space Apps).

Uso, desde la raíz del repo:
    python scripts/build_horizons.py            # todos los sitios de data/sites.json
    python scripts/build_horizons.py apollo15   # solo algunos ids

Fuentes (NASA LRO LOLA):
  - Polo sur (80°S-90°S): data/dem/LDEM_80S_80MPP_ADJ.TIF, 80 m/px (descarga local,
    ver data/dem/README.txt).
  - Resto de la Luna: DEM global de LOLA 118 m/px, leído en remoto (requiere internet).
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
    """Calcula y guarda los perfiles; devuelve 1 si algún sitio no tuvo datos reales."""
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
            print(f"[SIN DATOS] {s['id']}: {exc}")
            failed += 1
            continue
        out = horizon.PRECOMPUTED_DIR / horizon.horizon_filename(s["lat"], s["lon"], RADIUS_KM)
        out.write_text(json.dumps(result) + "\n", encoding="utf-8")
        el = result["el"]
        print(f"[OK] {s['id']:<13} {result['source']:<48} máx {max(el):6.2f}° "
              f"(az {el.index(max(el))}°)  mín {min(el):6.2f}°  {time.time() - t0:5.1f} s")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
