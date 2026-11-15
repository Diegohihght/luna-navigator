"""Validación de efemérides contra JPL Horizons para los sitios curados (rol A).

Para cada sitio de data/sites.json y cada fecha, consulta la API de Horizons
(Sol y Tierra, AZ/EL aparentes, sin refracción, centro Luna con sitio
geodésico), compara con backend/ephemeris.py y guarda:
  - jpl_reference.json       valores de Horizons (los usa
                             tests/test_ephemeris_sites.py sin necesitar internet)
  - validacion_horizons.csv  detalle de cada comparación
  - validacion_horizons.md   resumen por sitio y cuerpo

Uso (desde la raíz del proyecto, con internet y el entorno activo):
    python tests/horizons_validation/compare_horizons.py --limit 1 --debug
    python tests/horizons_validation/compare_horizons.py

La métrica es la separación angular entre las dos direcciones, no az y el por
separado: cerca del cenit el azimut es muy sensible y exagera la diferencia.
Los valores ya consultados se guardan en jpl_reference.json y no se vuelven a
pedir (salvo que cambie la lat/lon del sitio).
"""
import argparse
import csv
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
import warnings
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT))

from backend.ephemeris import get_ephemeris  # noqa: E402

warnings.filterwarnings("ignore", category=DeprecationWarning)

API_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"
BODIES = {"sun": "10", "earth": "399"}
DATES = ["2027-01-01", "2027-01-10", "2027-01-20"]
TOL_DEG = 0.02
REF_PATH = HERE / "jpl_reference.json"
CSV_PATH = HERE / "validacion_horizons.csv"
MD_PATH = HERE / "validacion_horizons.md"

_NUM = re.compile(r"^-?\d+(\.\d+)?$")


def _unit(az: float, el: float):
    """Vector unitario (este, norte, arriba) de una dirección az/el en grados."""
    a, e = math.radians(az), math.radians(el)
    return (math.cos(e) * math.sin(a), math.cos(e) * math.cos(a), math.sin(e))


def _sep_deg(az1: float, el1: float, az2: float, el2: float) -> float:
    """Separación angular (grados) entre dos direcciones az/el."""
    u, v = _unit(az1, el1), _unit(az2, el2)
    dot = sum(x * y for x, y in zip(u, v))
    cross = (
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
    )
    return math.degrees(math.atan2(math.sqrt(sum(c * c for c in cross)), dot))


def _parse(text: str):
    """Extrae [(az, el), ...] de la tabla CSV de Horizons ($$SOE ... $$EOE)."""
    if "$$SOE" not in text:
        raise RuntimeError("Respuesta sin tabla de efemérides:\n" + text[:800])
    block = text.split("$$SOE")[1].split("$$EOE")[0]
    rows = []
    for line in block.strip().splitlines():
        fields = [f.strip() for f in line.split(",")]
        nums = [float(f) for f in fields[1:] if _NUM.match(f)]
        if len(nums) < 2:
            raise RuntimeError(f"Fila no reconocida: {line!r}")
        rows.append((nums[0], nums[1]))
    if len(rows) != 4:
        raise RuntimeError(f"Se esperaban 4 filas y llegaron {len(rows)}")
    return rows


def _query(body_id: str, lat: float, lon: float, start: datetime, end: datetime, debug: bool = False):
    """Pide a Horizons az/el aparentes (sin refracción) desde un sitio lunar."""
    params = {
        "format": "text",
        "COMMAND": f"'{body_id}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'OBSERVER'",
        "CENTER": "'coord@301'",
        "COORD_TYPE": "'GEODETIC'",
        "SITE_COORD": f"'{lon % 360.0:.6f},{lat:.6f},0'",  # lon este, lat, alt km
        "START_TIME": f"'{start:%Y-%m-%d %H:%M}'",
        "STOP_TIME": f"'{end:%Y-%m-%d %H:%M}'",
        "STEP_SIZE": "'360 min'",
        "QUANTITIES": "'4'",
        "ANG_FORMAT": "'DEG'",
        "APPARENT": "'AIRLESS'",
        "CSV_FORMAT": "'YES'",
    }
    url = API_URL + "?" + urllib.parse.urlencode(params)
    last = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:
                text = resp.read().decode("utf-8", errors="replace")
            if debug:
                print("---- respuesta cruda de Horizons (primeros 3000 caracteres) ----")
                print(text[:3000])
                print("------------------------------------------------------------")
            return _parse(text)
        except Exception as exc:  # noqa: BLE001
            last = exc
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"Horizons falló tras 3 intentos: {last}")


def _load_sites():
    data = json.loads((ROOT / "data" / "sites.json").read_text(encoding="utf-8"))
    if isinstance(data, dict):
        data = data.get("sites", list(data.values()))
    return [
        {"id": s["id"], "name": s.get("name", s["id"]), "lat": float(s["lat"]), "lon": float(s["lon"])}
        for s in data
    ]


def main() -> int:
    ap = argparse.ArgumentParser(description="Valida ephemeris.py contra JPL Horizons.")
    ap.add_argument("--limit", type=int, default=0, help="solo los primeros N sitios (para probar)")
    ap.add_argument("--debug", action="store_true", help="muestra la respuesta cruda de la primera consulta")
    ap.add_argument("--dates", nargs="*", default=DATES, help="fechas AAAA-MM-DD (00:00 a 18:00 UTC)")
    args = ap.parse_args()

    sites = _load_sites()
    if args.limit:
        sites = sites[: args.limit]

    ref = json.loads(REF_PATH.read_text(encoding="utf-8")) if REF_PATH.exists() else {}
    rows, first = [], True
    try:
        for site in sites:
            for day in args.dates:
                start = datetime.fromisoformat(day).replace(tzinfo=timezone.utc)
                end = start + timedelta(hours=18)
                mine = get_ephemeris(site["lat"], site["lon"], start, end, 360)
                for body, body_id in BODIES.items():
                    key = f"{site['id']}|{day}|{body}"
                    cached = ref.get(key)
                    if not cached or cached["lat"] != site["lat"] or cached["lon"] != site["lon"]:
                        pairs = _query(body_id, site["lat"], site["lon"], start, end, debug=args.debug and first)
                        first = False
                        ref[key] = {
                            "lat": site["lat"],
                            "lon": site["lon"],
                            "az": [p[0] for p in pairs],
                            "el": [p[1] for p in pairs],
                        }
                        time.sleep(0.3)
                    jpl = ref[key]
                    for i, t in enumerate(mine["t"]):
                        rows.append(
                            {
                                "site": site["id"],
                                "date": day,
                                "t_utc": t,
                                "body": body,
                                "my_az": mine[body]["az"][i],
                                "my_el": mine[body]["el"][i],
                                "jpl_az": jpl["az"][i],
                                "jpl_el": jpl["el"][i],
                                "sep_deg": round(
                                    _sep_deg(mine[body]["az"][i], mine[body]["el"][i], jpl["az"][i], jpl["el"][i]), 4
                                ),
                            }
                        )
                print(f"ok  {site['id']}  {day}")
    finally:
        REF_PATH.write_text(json.dumps(ref, indent=1), encoding="utf-8")

    with CSV_PATH.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)

    worst = {}
    for r in rows:
        k = (r["site"], r["body"])
        worst[k] = max(worst.get(k, 0.0), r["sep_deg"])
    lines = [
        "# Validación de efemérides contra JPL Horizons",
        "",
        f"Fechas: {', '.join(args.dates)} (00:00, 06:00, 12:00 y 18:00 UTC). "
        f"Métrica: separación angular máxima entre ephemeris.py y Horizons. Tolerancia: {TOL_DEG}°.",
        "",
        "| Sitio | Cuerpo | Separación máx. (°) | Resultado |",
        "|---|---|---|---|",
    ]
    any_fail = False
    for (site_id, body), sep in sorted(worst.items()):
        ok = sep < TOL_DEG
        any_fail = any_fail or not ok
        lines.append(f"| {site_id} | {body} | {sep:.4f} | {'OK' if ok else 'REVISAR'} |")
    MD_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print("\n".join(lines))
    return 1 if any_fail else 0


if __name__ == "__main__":
    sys.exit(main())