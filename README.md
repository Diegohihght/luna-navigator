# Lunar Landing Site Navigator

NASA Space Apps 2026. Herramienta para comparar sitios de aterrizaje lunar y fechas, mostrando la posición del Sol y la Tierra respecto al horizonte local.

## Arranque rápido
Requisitos: Python 3.11+ y VS Code.

```bash
git clone <URL-del-repo>
cd lunar-navigator
python -m venv .venv
# Windows (PowerShell):  .venv\Scripts\Activate.ps1
# Windows (cmd):         .venv\Scripts\activate.bat
# Mac/Linux:             source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload
```
Abre http://127.0.0.1:8000 (app) y http://127.0.0.1:8000/docs (API).

Pruebas: `pytest`

En VS Code: `Ctrl+Shift+P` → "Python: Select Interpreter" → elige `.venv`.

### Primera ejecución: kernels de JPL

Las efemérides (posición del Sol y de la Tierra) se calculan con Skyfield y
los datos de JPL/NASA. La primera vez que se calcula una efeméride, Skyfield
descarga automáticamente estos archivos a `data/kernels/`:

- `de421.bsp`: posiciones planetarias (JPL DE421)
- `moon_080317.tf`, `pck00008.tpc` y `moon_pa_de421_1900-2050.bpc`:
  orientación y marco de referencia de la Luna

**Requiere conexión a internet** y puede tardar unos minutos según la conexión
(son unas decenas de MB). Las siguientes ejecuciones usan los archivos locales
y funcionan sin internet. La carpeta `data/kernels/` está en `.gitignore`: no se
sube a Git.

Para dejarlo listo antes de una demostración sin internet, ejecuta una vez con
conexión:

    python -c "from datetime import datetime, timezone; from backend.ephemeris import get_ephemeris; t = datetime(2027, 1, 1, tzinfo=timezone.utc); get_ephemeris(0, 0, t, t, 60)"

## Qué modela la efeméride

La posición del Sol y de la Tierra se calcula con las efemérides JPL DE421 y la orientación física de la Luna (PCK lunar de JPL, marco Mean Earth), por lo que incluye de forma nativa la libración, la excentricidad orbital, la inclinación del eje y el paralaje del observador. Se validó contra JPL Horizons en los 10 sitios curados (separación angular máxima 0.0064°; tabla en `tests/horizons_validation/validacion_horizons.md`). Con esto la Tierra oscila entre 13° y 20° (pico a pico) en elevación según el sitio, y desde el polo sur queda sobre el horizonte geométrico solo cerca del 46% del tiempo, cruzándolo periódicamente.

## Equipo y módulos
| Rol | Persona | Archivos |
|---|---|---|
| A. Efemérides | Martin | `backend/ephemeris.py` |
| B. Terreno | Sennie | `backend/horizon.py`, `data/dem/` |
| C. Frontend | Luis | `frontend/` |
| D. Métricas, integración, pitch | Diego | `backend/metrics.py`, `backend/main.py`, docs |

Ver `CONTEXTO.md` para el reto, los contratos y el plan.

## Flujo de Git
```bash
git checkout -b nombre-modulo          # una vez, ej. martin-ephemeris
git pull origin main                   # antes de empezar a trabajar
git add . && git commit -m "mensaje claro"
git push -u origin nombre-modulo       # y unir a main en cuanto algo funcione
```
`main` siempre debe arrancar. No edites la carpeta de otro rol.

## Recursos
- [Quickmap LROC](https://quickmap.lroc.asu.edu/) · [NASA Moon Trek](https://trek.nasa.gov/moon/) · [JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) · [CSA Moon exploration](https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/)
