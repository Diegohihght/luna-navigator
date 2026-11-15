# Horizontes precalculados (versionados en Git)

Perfil de horizonte local de cada sitio curado de `data/sites.json`, con radio de 50 km.
Permiten correr la app **sin descargar ningún DEM**: `backend/horizon.py` los busca antes que nada.

- Formato: el mismo contrato de `/api/horizon` (`az_step_deg`, `el` con 360 valores en grados, `source`).
- Nombre: `horizon_<lat>_<lon>_r<radio>.json` (lat/lon con 4 decimales).
- Se regeneran con `python scripts/build_horizons.py` (o `... build_horizons.py <id>` para un sitio).
  Si cambian las coordenadas de un sitio, hay que regenerar su perfil.

## Fuentes (NASA LRO, Lunar Orbiter Laser Altimeter)

| Zona | Producto | Resolución | Cómo se obtiene |
|---|---|---|---|
| 80°S – polo sur | `LDEM_80S_80MPP_ADJ` ([PGDA, NASA GSFC](https://pgda.gsfc.nasa.gov/products/90)) | 80 m/px | descarga local en `data/dem/` (ver su README) |
| Resto de la Luna | LOLA Global LDEM 118 m ([USGS Astrogeology](https://astrogeology.usgs.gov/search/map/moon_lro_lola_dem_118m)) | 118 m/px | lectura remota por HTTP de la ventana del sitio |

Son los mismos datos LOLA que muestra [NASA Moon Trek](https://trek.nasa.gov/moon/).
