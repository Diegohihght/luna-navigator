# Cómo trabajar con Claude en el chat (Martin, Sennie, Luis)

Diego usa Claude Code con acceso al repo. Ustedes usan el chat de claude.ai (plan gratuito), que tiene límites de mensajes. Para aprovecharlo:

- Pidan cosas completas en un solo mensaje (módulo entero + pruebas), no preguntas sueltas.
- Peguen solo lo necesario: `CONTEXTO.md` al inicio y el archivo que están tocando, no todo el repo.
- Si la conversación se vuelve larga, abran un chat nuevo y vuelvan a pegar `CONTEXTO.md` y su archivo actual.
- Antes de pedir ayuda: `git pull` para tener lo último.
- Siempre pidan: "responde con el archivo completo, listo para reemplazar el mío".
- Prueben lo que Claude les dé en su máquina antes de hacer commit. Si falla, peguen el error completo (traceback) y el código.

## Prompt de inicio (pegar al abrir un chat)

```
Soy [NOMBRE], rol [A/B/C], en un equipo de 4 para NASA Space Apps 2026.
Programamos en Python con VS Code. A continuación está CONTEXTO.md con el reto,
los contratos de API y el reparto. Mi módulo es [ARCHIVO(S)]. Respeta los
contratos exactamente. Responde en español, con código completo y listo para
copiar, y dime cómo probarlo.

[PEGAR CONTEXTO.md]
```

## Plantilla por tarea

```
TAREA: [qué debe hacer]
ENTRADA: [parámetros y tipos]
SALIDA: [formato exacto, según el contrato]
RESTRICCIONES: [librerías, rendimiento, límites]
MI CÓDIGO ACTUAL: [pegar el archivo]
QUIERO: el archivo completo + una prueba + cómo ejecutarla
```

## Primer encargo sugerido por rol

**Martin (A, efemérides)**
> Reemplaza el stub de `get_ephemeris` en `backend/ephemeris.py` por un cálculo real con Skyfield usando los kernels de JPL y el marco lunar (principal axes / ME). Debe devolver az/el de Sol y Tierra vistos desde (lat, lon) en la superficie de la Luna, con el formato del contrato. Dime cómo descargar los kernels, dónde guardarlos (`data/kernels/`) y cómo validar contra JPL Horizons para un sitio y una fecha. Si algo de la API de Skyfield no lo sabes con certeza, dilo.

**Sennie (B, terreno)**
> Reemplaza el stub de `get_horizon` en `backend/horizon.py`. Primero explícame qué producto de LOLA/Moon Trek descargar para el polo sur (resolución razonable para una prueba de 13 horas) y cómo leerlo en Python. Luego implementa el perfil de horizonte por ray-marching con curvatura lunar (R = 1737.4 km), con caché en `data/cache/` y un modo de respaldo con horizonte plano si falta el DEM.

**Luis (C, frontend)**
> Mejora `frontend/index.html` (HTML + JS sin build, Plotly.js). Quiero: selector de sitio y fechas, vista de horizonte 360° con Sol y Tierra, una línea de tiempo que muestre cuándo son visibles el Sol y la Tierra (usando `intervals` de `/api/metrics`), y un diseño claro para público general y planificadores. Usa los endpoints del contrato; mientras tanto trabaja con los datos simulados que devuelve el backend.
