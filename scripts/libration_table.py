from datetime import datetime, timezone
import numpy as np
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from backend.ephemeris import get_ephemeris

S, E = datetime(2027, 1, 1, tzinfo=timezone.utc), datetime(2027, 1, 29, tzinfo=timezone.utc)
for name, lat, lon in [("Apolo 11", 0.67, 23.47), ("Apolo 17", 20.19, 30.77),
                       ("Limbo", 0.0, 80.0), ("Polo sur", -89.9, 0.0)]:
    d = get_ephemeris(lat, lon, S, E, 60)["earth"]
    az, el = np.array(d["az"]), np.array(d["el"])
    print(f"{name}: el {el.min():.1f}..{el.max():.1f}  (Δ {np.ptp(el):.1f}°)  "
          f"visible {100*(el>0).mean():.0f}%")