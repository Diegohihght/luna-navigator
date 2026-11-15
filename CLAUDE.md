# Lunar Landing Site Navigator — instrucciones para Claude Code

Proyecto para NASA Space Apps 2026 (reto "Navegador del sitio de aterrizaje lunar"). Lee `CONTEXTO.md` antes de empezar: contiene el reto, los contratos de API y el reparto de roles.

## Qué hace la app
Dado un sitio lunar (lat, lon) y un rango de fechas, calcula la posición del Sol y de la Tierra respecto al horizonte local (incluyendo el terreno) y deriva métricas de energía y comunicación. Permite comparar sitios y fechas.

## Stack
- Backend: Python 3.11+, FastAPI (`backend/`), ejecutado con `uvicorn backend.main:app --reload` desde la raíz.
- Frontend: HTML + JavaScript sin build (`frontend/`), Plotly.js. Lo sirve el mismo FastAPI.
- Pruebas: `pytest` desde la raíz.

## Reglas
- Respeta los contratos de `CONTEXTO.md` (nombres de campos, unidades, formato de tiempo). No los cambies sin avisarme y sin actualizar `CONTEXTO.md`.
- Convenciones: UTC en ISO 8601; ángulos en grados; azimut 0° = norte lunar, sentido horario; elevación geométrica (sin refracción); latitud planetocéntrica, longitud este positiva (−180..180).
- Código en inglés (snake_case), docstrings y comentarios en inglés (decisión del equipo: el proyecto se entrega en inglés), type hints en todo.
- Cada módulo tiene un responsable (ver `CONTEXTO.md`). Edita solo los archivos del rol de la persona con la que estás hablando, salvo que se te pida otra cosa.
- Los módulos `ephemeris.py` y `horizon.py` empiezan como stubs con `source: "mock"`. Al reemplazarlos por cálculo real, mantén la firma y el formato de salida, y cambia `source`.
- No subas datos pesados (DEM, kernels) a Git; van en `data/dem/`, `data/kernels/`, `data/cache/` (ignorados).
- Valida cálculos astronómicos contra JPL Horizons antes de darlos por buenos. Si no estás seguro de una API o convención, dilo y consulta la documentación en vez de asumir.
- Cambios pequeños y verificables: corre `pytest` y arranca el servidor antes de dar algo por terminado.
