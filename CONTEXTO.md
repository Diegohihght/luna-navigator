# Lunar Landing Site Navigator — NASA Space Apps 2026

Equipo (4): Martin (A), Sennie (B), Luis (C), Diego (D)
Reto: "Navegador del sitio de aterrizaje lunar" (Exploración humana / Luna / Software; Intermedio–Avanzado)
Tiempo disponible: 13 horas desde el arranque.

> Fuente de verdad del equipo. Quien use el chat de Claude lo pega al inicio. Si cambia un contrato o una decisión, se actualiza aquí y se avisa en el grupo.

---

## 1. Qué pide el reto (en una línea)
Herramienta intuitiva para **comparar rápido sitios de aterrizaje y fechas** en la Luna (sobre todo el polo sur), mostrando **dónde están el Sol y la Tierra respecto al horizonte local**, para evaluar **energía solar** y **comunicación directa con la Tierra**.

## 2. Requisitos
**Núcleo (sin esto no hay proyecto)**
- Elegir sitio: lista curada + coordenadas personalizadas.
- Elegir fecha y hora.
- Mostrar Sol y Tierra respecto al horizonte del sitio.
- Métricas: elevación solar, duración de luz, ventanas de visibilidad de la Tierra, tiempo hasta puesta de Sol / de Tierra.
- Comparar escenarios rápido (sitios y fechas).

**Diferenciadores (opcionales)**
- Terreno real (LOLA) para el horizonte (crítico en el polo sur).
- Línea de tiempo / animación de un día lunar o varios.
- Mapa 2D del polo y/o 3D.
- Modo educativo.
- Libración de la Tierra.

Debe servir a planificadores, educadores y público general.

## 3. Conceptos físicos clave
- Sin atmósfera: sin refracción; el horizonte es geométrico y lo define el terreno.
- Polo sur: el Sol apenas sube unos pocos grados (inclinación axial ~1.5°) y las sombras son larguísimas; el terreno decide casi todo.
- Tierra: casi fija en el cielo desde la cara visible, con oscilación por libración; desde el polo sur queda cerca del horizonte y el terreno la tapa fácilmente. Desde la cara oculta no se ve directamente.
- Día lunar ≈ 29.5 días terrestres.

## 4. Stack (decidido)
- Backend: Python 3.11+, FastAPI. Sirve también el frontend.
- Frontend: HTML + JS sin build, Plotly.js (Leaflet si hacemos mapa polar).
- Efemérides: Skyfield con kernels JPL y marco lunar (alternativa: SpiceyPy). Confirmar API en la documentación.
- Terreno: LOLA (vía Moon Trek / PDS), recortes polares. Ray-marching con curvatura lunar (R ≈ 1737.4 km).
- Cachear horizonte y efemérides de los sitios curados; calcular bajo demanda para coordenadas personalizadas.

## 5. Convenciones y contratos
**Globales**
- Tiempo UTC, ISO 8601, paso constante.
- Ángulos en grados. Azimut 0° = norte lunar, sentido horario. Elevación geométrica.
- Latitud planetocéntrica, longitud este positiva (−180..180). Confirmar contra la documentación de LOLA.
- Código en inglés (snake_case), docstrings en español, type hints.
- Todo módulo devuelve `source`: `"mock"` hasta que haya cálculo real.

**Endpoints** (implementados en `backend/main.py`; ver `/docs` con el servidor corriendo)

`GET /api/sites` → `[{id, name, lat, lon, mission, type, verified}]` (de `data/sites.json`; las coordenadas están marcadas `verified: false` hasta contrastarlas con Quickmap).

`GET /api/ephemeris?lat=&lon=&start=&end=&step_min=60` →
```json
{"t":["2027-01-01T00:00:00Z"],
 "sun":{"az":[0.0],"el":[0.0]},
 "earth":{"az":[0.0],"el":[0.0]},
 "source":"mock"}
```

`GET /api/horizon?lat=&lon=&radius_km=50` →
```json
{"az_step_deg":1,"el":[360 valores],"source":"mock"}
```

`GET /api/metrics?lat=&lon=&start=&end=&step_min=60` →
```json
{"sun_lit_pct":0.0,"longest_dark_h":0.0,"sun_el_max_deg":0.0,
 "earth_visible_pct":0.0,"longest_comms_gap_h":0.0,
 "hours_to_sun_change":0.0,"hours_to_earth_change":0.0,
 "intervals":{"sun":[["t0","t1"]],"earth":[["t0","t1"]]},
 "source":{"ephemeris":"mock","horizon":"mock"}}
```
Regla: Sol/Tierra visible si su elevación > elevación del horizonte en ese azimut.

`GET /api/compare?sites=id1,id2&start=&end=&step_min=` → `[{id, name, metrics}]`

## 6. Módulos y responsables
| Rol | Persona | Archivos | Entrega |
|---|---|---|---|
| A. Efemérides | **Martin** | `backend/ephemeris.py` | az/el de Sol y Tierra reales, validados contra JPL Horizons |
| B. Terreno | **Sennie** | `backend/horizon.py`, `data/dem/` | perfil de horizonte con LOLA, cacheado para los sitios curados |
| C. Frontend | **Luis** | `frontend/` | selector, vista de horizonte, línea de tiempo, comparación |
| D. Métricas e integración | **Diego** | `backend/metrics.py`, `backend/main.py`, docs, pitch | métricas, heatmap sitio × fecha, modo educativo, README, presentación |

Cómo trabajamos con Claude: Diego usa Claude Code con acceso al repo (lee `CLAUDE.md`). Martin, Sennie y Luis usan el chat de claude.ai y siguen `PROMPTS.md`. El repo es la memoria compartida.

## 7. Plan de 13 horas
| Horas | Objetivo |
|---|---|
| 0–1 | Repo creado, todos clonan y corren `uvicorn backend.main:app --reload` con datos mock. |
| 1–5 | Cada rol reemplaza su stub por la versión real (rama propia, merge a `main` apenas funcione). |
| 5–7 | **Integración de punta a punta con datos reales para un sitio = MVP.** |
| 7–10 | Plus: sitios curados, coordenadas personalizadas, línea de tiempo, comparación lado a lado, heatmap sitio × fecha. |
| 10–11 | Congelar funcionalidades. Validar contra Horizons. Pulir interfaz. |
| 11–13 | README, capturas, guion, video/pitch y envío. Ajustar según los requisitos de entrega. |

Si algo se atrasa, se recorta alcance, no calidad del núcleo: terreno plano + efemérides reales es mejor que todo a medias.

## 8. Alcance
- **MVP:** un sitio + una fecha → horizonte con Sol y Tierra + métricas básicas, de punta a punta.
- **Plus:** lista curada, coordenadas propias, terreno LOLA, línea de tiempo de varios días, comparación.
- **Wow:** heatmap sitio × fecha ("¿qué pasa si se retrasa el lanzamiento?"), animación de un día lunar, modo educativo, mapa polar o 3D.

## 9. Validación
- Comparar az/el de Sol y Tierra con JPL Horizons en 2–3 sitios y fechas.
- En el polo, la elevación máxima del Sol debe ser de pocos grados.
- Un sitio de la cara oculta nunca debe ver la Tierra.
- Horizonte coherente con el mapa (cráteres → horizonte alto).
- `pytest` en verde antes de cada merge a `main`.

## 10. Riesgos
- DEM pesado y lento → recortes pequeños y caché.
- Marcos de referencia y convenciones de coordenadas lunares → fijarlos y validar temprano.
- Querer hacer todo → congelar funcionalidades en la hora 10.
- Límites del plan gratuito de Claude → mensajes completos y concretos (ver `PROMPTS.md`).

## 11. Pendientes
- [ ] Revisar la pestaña Recursos del reto y pegar enlaces de datos.
- [ ] Confirmar requisitos de entrega (formato, video, repositorio público, etc.).
- [ ] Verificar coordenadas de `data/sites.json` con Quickmap.
- [ ] Decidir sitios finales de la lista curada.

## Estado
| Módulo | Estado | Notas |
|---|---|---|
| Repo + mocks | listo | subido a GitHub (`Diegohihght/luna-navigator`) |
| A. Efemérides | real en `main` (`source: "skyfield-de421"`) | PR #1 (cálculo con Skyfield) y PR #3 (validación contra JPL Horizons). Pendiente: revisar rendimiento con rangos largos |
| B. Terreno | código real en `main` (PR #5), requiere el DEM local | `horizon.py` lee `data/dem/LDEM_80S_80MPP_ADJ.TIF` (no va en Git) y necesita `rasterio`. Sin el archivo devuelve horizonte plano con `source: "mock"`, así que las páginas siguen mostrando el aviso |
| C. Frontend | rediseño en `main` (PR #4) | `index.html` con selector, horizonte SVG, línea de tiempo y comparación. Tema compartido `theme.css` en rama `diego/ui-refresh`, pendiente de PR |
| D. Métricas e integración | en `main` con tests | métricas (PR #2 heatmap sitio × fecha y modo educativo). Pendiente: README y guion del pitch |
