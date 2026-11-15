"""Validation of Earth's libration against JPL Horizons (role A).

Compares the Earth az/el from backend/ephemeris.py with JPL Horizons over a
full libration cycle (2027-01-01 to 2027-01-29, 6 h step) at 4 sites, and
against a "fixed Earth" model (constant mean direction, i.e. no libration).

Usage (from the project root, with internet and the environment active):
    python tests/horizons_validation/libration_horizons.py

Writes jpl_libration_reference.json (cache) and libration_horizons.md.
Does not touch the files produced by compare_horizons.py.
"""
import json
import math
import sys
import time
import urllib.parse
import urllib.request
import warnings
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))

from backend.ephemeris import get_ephemeris  # noqa: E402
from compare_horizons import API_URL, TOL_DEG, _NUM, _sep_deg, _unit  # noqa: E402

warnings.filterwarnings("ignore", category=DeprecationWarning)

START = datetime(2027, 1, 1, tzinfo=timezone.utc)
END = datetime(2027, 1, 29, tzinfo=timezone.utc)
STEP_MIN = 360
SITES = [
    ("Apollo 11", 0.67, 23.47),
    ("Apollo 17", 20.19, 30.77),
    ("Limb", 0.0, 80.0),
    ("South pole", -89.9, 0.0),
]
REF_PATH = HERE / "jpl_libration_reference.json"
MD_PATH = HERE / "libration_horizons.md"


def _query_earth(lat: float, lon: float):
    """Apparent Earth az/el (no refraction) from Horizons for the whole window."""
    params = {
        "format": "text",
        "COMMAND": "'399'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon % 360.0:.6f},{lat:.6f},0'",
        "START_TIME": f"'{START:%Y-%m-%d %H:%M}'",
        "STOP_TIME": f"'{END:%Y-%m-%d %H:%M}'",
        "STEP_SIZE": f"'{STEP_MIN} min'",
        "QUANTITIES": "'4'",
        "ANG_FORMAT": "'DEG'",
        "APPARENT": "'AIRLESS'",
        "CSV_FORMAT": "'YES'",
    }
    url = API_URL + "?" + urllib.parse.urlencode(params)
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=90) as resp:
                text = resp.read().decode("utf-8", errors="replace")
            if "$$SOE" not in text:
                raise RuntimeError("No ephemeris table:\n" + text[:800])
            block = text.split("$$SOE")[1].split("$$EOE")[0]
            az, el = [], []
            for line in block.strip().splitlines():
                nums = [float(f) for f in (x.strip() for x in line.split(",")[1:]) if _NUM.match(f)]
                if len(nums) < 2:
                    raise RuntimeError(f"Unrecognised row: {line!r}")
                az.append(nums[0])
                el.append(nums[1])
            return az, el
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Horizons failed after 3 attempts: {last}")


def _fixed_direction(az, el):
    """Mean direction (az, el) of a set of directions: the 'no libration' model."""
    vecs = [_unit(a, e) for a, e in zip(az, el)]
    mx, my, mz = (sum(v[i] for v in vecs) / len(vecs) for i in range(3))
    norm = math.sqrt(mx * mx + my * my + mz * mz)
    return math.degrees(math.atan2(mx, my)) % 360.0, math.degrees(math.asin(mz / norm))


def main() -> int:
    ref = json.loads(REF_PATH.read_text(encoding="utf-8")) if REF_PATH.exists() else {}
    lines = [
        "# Earth libration validation against JPL Horizons",
        "",
        f"Window: {START:%Y-%m-%d} to {END:%Y-%m-%d} UTC, {STEP_MIN // 60} h step. "
        f"Body: Earth. Tolerance: {TOL_DEG}°.",
        "",
        "| Site | Points | Max sep. vs Horizons (°) | Mean sep. (°) "
        "| Earth el. range (°) | Max error if Earth were fixed (°) | Result |",
        "|---|---|---|---|---|---|---|",
    ]
    any_fail = False
    try:
        for name, lat, lon in SITES:
            mine = get_ephemeris(lat, lon, START, END, STEP_MIN)["earth"]
            cached = ref.get(name)
            if not cached or cached["lat"] != lat or cached["lon"] != lon:
                az, el = _query_earth(lat, lon)
                ref[name] = {"lat": lat, "lon": lon, "az": az, "el": el}
                time.sleep(0.5)
            jpl = ref[name]
            if len(jpl["az"]) != len(mine["az"]):
                raise RuntimeError(f"{name}: {len(jpl['az'])} Horizons points vs {len(mine['az'])} mine")

            seps = [
                _sep_deg(mine["az"][i], mine["el"][i], jpl["az"][i], jpl["el"][i])
                for i in range(len(mine["az"]))
            ]
            fix_az, fix_el = _fixed_direction(jpl["az"], jpl["el"])
            fixed_err = max(_sep_deg(a, e, fix_az, fix_el) for a, e in zip(jpl["az"], jpl["el"]))
            el_range = max(jpl["el"]) - min(jpl["el"])
            ok = max(seps) < TOL_DEG
            any_fail = any_fail or not ok
            lines.append(
                f"| {name} | {len(seps)} | {max(seps):.4f} | {sum(seps) / len(seps):.4f} "
                f"| {el_range:.1f} | {fixed_err:.1f} | {'OK' if ok else 'REVIEW'} |"
            )
            print(f"ok  {name}")
    finally:
        REF_PATH.write_text(json.dumps(ref, indent=1), encoding="utf-8")

    MD_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 1 if any_fail else 0


if __name__ == "__main__":
    sys.exit(main())