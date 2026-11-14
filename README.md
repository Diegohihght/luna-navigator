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
