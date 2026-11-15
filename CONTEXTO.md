# Lunar Landing Site Navigator — NASA Space Apps 2026

Equipo (4): Martin (A), Sennie (B), Luis (C), Diego (D)
Reto: "Navegador del sitio de aterrizaje lunar" (Exploración humana / Luna / Software; Intermedio–Avanzado).

> **Fuente de verdad del equipo.** Quien use Claude (chat o Claude Code) lo pega al inicio. Si cambia un contrato o una decisión, se actualiza aquí y se avisa en el grupo.

---

## 1. Qué es el proyecto
Herramienta para **comparar rápido sitios de aterrizaje y fechas** en la Luna (sobre todo el polo sur). Muestra **dónde están el Sol y la Tierra respecto al horizonte local** (con el relieve real), y calcula métricas de **energía solar** y **comunicación con la Tierra**. Sirve a planificadores, educadores y público general.

**Visión a largo plazo (después de la entrega):** una herramienta pública y reproducible que cualquiera pueda correr con datos de la NASA, con sitios de misiones reales, horizonte LOLA en todo el globo y análisis de ventanas de lanzamiento. Lo de hoy es la base para eso.

## 2. Qué está hecho (estado al 15 de noviembre de 2026)

| Módulo | Estado | Dónde |
|---|---|---|
| A. Efemérides | **Real.** Skyfield con DE421; validado contra JPL Horizons | `backend/ephemeris.py`, `tests/test_ephemeris*.py` |
| B. Terreno | **Real para los 10 sitios curados.** LOLA: DEM polar local (80 m/px) y DEM global remoto (118 m/px); horizontes precalculados versionados | `backend/horizon.py`, `data/horizons/`, `scripts/build_horizons.py` |
| C. Frontend | **Real.** Panorámica 2D, vistas 3D "desde fuera" y "desde el sitio" con relieve LOLA + Clementine, comparación, línea de tiempo | `frontend/index.html`, `frontend/vista3d.js`, `frontend/data/relief/` |
| D. Métricas e integración | **Real.** Métricas, heatmap sitio × fecha, modo educativo, tema compartido | `backend/metrics.py`, `backend/main.py`, `frontend/heatmap.html`, `frontend/educativo.html`, `frontend/theme.css` |

Ramas: **todo está en `main`**. No quedan ramas abiertas. PRs mergeados: #1–#8.

Lo que **aún no está**:
- Coordenadas de `data/sites.json` verificadas con Quickmap (`verified: false`). **Urgente para Shackleton** (ver §8).
- Relieve real para coordenadas personalizadas: hoy usan relieve ilustrativo y la vista lo indica.
- README final, capturas, guion y video del pitch.

## 3. Conceptos físicos clave
- Sin atmósfera: sin refracción; el horizonte es geométrico y lo define el terreno.
- Polo sur: el Sol apenas sube unos grados (inclinación axial ~1.5°) y las sombras son larguísimas; el terreno decide casi todo.
- Tierra: casi fija en el cielo desde la cara visible, con oscilación por libración; desde el polo sur queda cerca del horizonte y el terreno la tapa fácilmente. Desde la cara oculta no se ve.
- Día lunar ≈ 29.5 días terrestres.

## 4. Stack y datos
- **Backend:** Python 3.11+, FastAPI. Sirve también el frontend (`uvicorn backend.main:app --reload`, desde la raíz).
- **Frontend:** HTML + JS sin build. Plotly.js para gráficas; Canvas 2D para las vistas 3D.
- **Efemérides:** Skyfield con `de421.bsp` (JPL). Se descarga sola la primera vez (requiere internet) a `data/kernels/`.
- **Terreno (NASA LRO, LOLA):**
  - Polo sur, 80°S–90°S: `LDEM_80S_80MPP_ADJ`, 80 m/px. Descarga local a `data/dem/` (ver `data/dem/README.txt`). Fuente: [PGDA, NASA GSFC](https://pgda.gsfc.nasa.gov/products/90).
  - Resto de la Luna: LOLA Global LDEM 118 m/px, leído en remoto por HTTP (solo la ventana del sitio). Fuente: [USGS Astrogeology](https://astrogeology.usgs.gov/search/map/moon_lro_lola_dem_118m).
  - Albedo para el tono de la Luna: Clementine UVVIS 750 nm Global Mosaic 118 m v2 (USGS Astrogeology).
  - Los mismos datos LOLA se ven en [NASA Moon Trek](https://trek.nasa.gov/moon/).
- **Datos que sí van a Git** (así los evaluadores corren la app sin descargar nada):
  - `data/horizons/` (perfiles de horizonte de los sitios curados, ~44 KB).
  - `frontend/data/relief/` (relieve del globo y del suelo, 2.8 MB).
- **Datos que NO van a Git:** `data/dem/*.TIF`, `data/kernels/`, `data/cache/`. Están en `.gitignore`.
- Requisitos de Python: `pip install -r requirements.txt` (incluye `rasterio` y `pyproj`).

## 5. Convenciones y contratos
**Globales**
- Tiempo UTC, ISO 8601, paso constante.
- Ángulos en grados. Azimut 0° = norte lunar, sentido horario. Elevación geométrica (sin refracción).
- Latitud planetocéntrica, longitud este positiva (−180..180).
- Código en inglés (snake_case), docstrings y comentarios en español, type hints.
- Todo módulo devuelve `source`. Valor `"mock"` = cálculo simulado; cualquier otro valor = dato real (p. ej. `"skyfield-de421"`, `"LOLA LDEM_80S_80MPP_ADJ (80 m/px)"`).

**Endpoints** (`/docs` con el servidor corriendo)

`GET /api/sites` → `[{id, name, lat, lon, mission, type, verified}]`

`GET /api/ephemeris?lat=&lon=&start=&end=&step_min=60` → `{"t":[...], "sun":{"az":[...],"el":[...]}, "earth":{"az":[...],"el":[...]}, "source":"skyfield-de421"}`

`GET /api/horizon?lat=&lon=&radius_km=50` → `{"az_step_deg":1, "el":[360 valores], "source":"LOLA ..."}`

`GET /api/metrics?lat=&lon=&start=&end=&step_min=60` → `{"sun_lit_pct", "longest_dark_h", "sun_el_max_deg", "earth_visible_pct", "longest_comms_gap_h", "hours_to_sun_change", "hours_to_earth_change", "intervals":{"sun":[...],"earth":[...]}, "source":{"ephemeris":"...","horizon":"..."}}`

`GET /api/compare?sites=id1,id2&start=&end=&step_min=` → `[{id, name, metrics}]`

Regla: Sol/Tierra visibles si su elevación > elevación del horizonte en ese azimut.

**Cambios de contrato:** no se cambian nombres de campos ni unidades sin avisar aquí y en el grupo.

## 6. Cómo trabajar (para todos)
1. Partir siempre de `main` actualizado: `git checkout main && git pull`.
2. Crear una rama con tu nombre y el tema: `martin/...`, `sennie/...`, `luis/...`, `diego/...` (ej.: `luis/vista3d-ajustes`).
3. Antes de abrir PR: `pytest` en verde y arrancar el servidor para probar en el navegador.
4. Abrir PR a `main`. Una persona distinta a quien lo escribió lo revisa.
5. Mergear y **borrar la rama** (remota y local) después del merge.
6. No subir datos pesados ni secretos. Revisa `git status` antes de cada commit.

Cómo trabajamos con Claude: Diego usa Claude Code con acceso al repo (lee `CLAUDE.md`). Martin, Sennie y Luis pueden usar el chat de claude.ai y `PROMPTS.md`. El repo es la memoria compartida.

## 7. Responsables y próximos pasos

### A. Efemérides — Martin (`backend/ephemeris.py`, `tests/`)
Ya hecho: cálculo real con Skyfield (PR #1) y validación contra JPL Horizons (PR #3).
Siguiente:
- Confirmar tiempos con rangos largos (el heatmap pide 12 ventanas de 29.5 días × 10 sitios; hoy responde en pocos segundos).
- Ampliar la validación contra JPL Horizons a los 10 sitios curados, en 2–3 fechas cada uno, y guardar la tabla en `tests/`.
- Documentar en el README cómo se descarga el kernel la primera vez.

### B. Terreno — Sennie (`backend/horizon.py`, `data/horizons/`, `data/dem/`)
Ya hecho: horizonte LOLA real con DEM polar local (PR #5) y con DEM global remoto (PR #7); perfiles precalculados para los 10 sitios.
Siguiente:
- Revisar el resultado de Shackleton: con `-89.9, 129.8` el horizonte llega a 33° y el Sol sale 0 % del tiempo. Eso sugiere que el punto está dentro del cráter; hay que verificarlo con Quickmap y, si cambia la coordenada, regenerar su perfil con `python scripts/build_horizons.py shackleton`.
- Decidir si el DEM de respaldo para coordenadas personalizadas se queda remoto o se añade un DEM global local.
- Mantener las pruebas de `tests/test_horizon.py` en verde.

### C. Frontend — Luis (`frontend/index.html`, `frontend/vista3d.js`)
Ya hecho: rediseño, comparación, línea de tiempo, vistas 3D con relieve real.
Siguiente:
- Revisar en el navegador las cinco vistas 3D con sitios distintos (Apolo 17, Apolo 11, Shackleton, polo sur, coordenada personalizada) y anotar cualquier defecto visual.
- Mejorar la ayuda de la vista 3D: el texto de abajo dice "Relieve: LOLA" aunque el suelo sea ilustrativo; la etiqueta dentro de la vista sí es correcta.
- Accesibilidad básica: contraste y foco en botones y pestañas.

### D. Métricas e integración — Diego (`backend/metrics.py`, `backend/main.py`, `scripts/`, docs, pitch)
Ya hecho: métricas, heatmap, modo educativo, tema compartido, relieve y horizontes precalculados.
Siguiente:
- README final: cómo correr la app, de dónde sale cada dato y cómo regenerar `data/horizons/` y `frontend/data/relief/`.
- Capturas y guion del pitch, con las cifras reales.
- Revisión final: `pytest`, arranque limpio y las cuatro páginas sin avisos de datos simulados.

## 8. Pendientes del equipo
- [ ] Verificar coordenadas de `data/sites.json` con Quickmap (Shackleton primero). Responsable: Sennie.
- [ ] Decidir sitios finales de la lista curada. Responsable: todos.
- [ ] Confirmar requisitos de entrega del Space Apps (formato, video, repositorio público). Responsable: Diego.
- [ ] Revisar la pestaña Recursos del reto y pegar enlaces de datos en el README. Responsable: Diego.
- [ ] Decidir si las coordenadas personalizadas usan un DEM local de respaldo. Responsable: Sennie.

## 9. Validación (antes de dar algo por bueno)
- Sol y Tierra contra JPL Horizons en 2–3 sitios y fechas (Martin).
- En el polo, la elevación máxima del Sol debe ser de pocos grados (hoy: Shackleton 1°, polo sur ~1°).
- Un sitio de la cara oculta nunca debe ver la Tierra.
- Horizonte coherente con el mapa: Apolo 17 ~14° al norte (Macizo Norte), Apolo 11 casi plano.
- `pytest` en verde antes de cada merge a `main`.

## 10. Riesgos
- DEM pesado y lento → recortes por sitio y caché (ya resuelto para los sitios curados).
- Conexión a internet en la primera ejecución (kernels de JPL, DEM global remoto) → por eso los horizontes y el relieve van versionados en Git.
- Marcos de referencia y convenciones lunares → fijadas en §5 y validadas contra JPL y LOLA.
- Querer hacer todo → congelar funcionalidades en la hora 10 del plan.
- Límites del plan gratuito de Claude → mensajes completos y concretos (ver `PROMPTS.md`).

## 11. Después de la entrega (largo plazo)
- Horizonte LOLA para cualquier coordenada, con DEM global local.
- Mapa polar 2D con el horizonte y las ventanas de luz superpuestas.
- Libración real de la Tierra y comunicación con más de una antena.
- Más sitios: misiones CLPS y candidatos de la NASA y de la Agencia Espacial Canadiense.
- Validación automática contra JPL en la integración continua.

## 12. Planes de referencia del reto
- **MVP:** un sitio + una fecha → horizonte con Sol y Tierra + métricas básicas. *(Hecho.)*
- **Plus:** lista curada, coordenadas propias, terreno LOLA, línea de tiempo, comparación. *(Hecho, salvo coordenadas propias con relieve real.)*
- **Wow:** heatmap sitio × fecha, animación de un día lunar, modo educativo, vistas 3D. *(Hecho; animación de un día lunar disponible en la línea de tiempo.)*

## Estado (resumen)
| Módulo | Estado |
|---|---|
| Repo | en GitHub (`Diegohihght/luna-navigator`), `main` limpio, sin ramas abiertas |
| A. Efemérides | real (Skyfield DE421, validado) |
| B. Terreno | real para los 10 sitios curados (LOLA); coordenadas personalizadas con relieve ilustrativo |
| C. Frontend | real (2D, 3D desde fuera y desde el sitio, comparación, heatmap, educativo) |
| D. Métricas e integración | real; falta README y pitch |
