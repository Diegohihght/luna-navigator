"""Perfil de horizonte local (terreno) para un sitio lunar.

RESPONSABLE: Sennie (rol B)

ESTADO: STUB con datos simulados (source="mock"). Reemplazar por el cálculo real:
  1. Recortar el DEM de LOLA alrededor del sitio (radio ~ radius_km).
  2. Para cada azimut 0..359, recorrer el terreno hacia afuera (ray-marching) y
     guardar el ángulo máximo de elevación, considerando la curvatura lunar
     (R ~ 1737.4 km).
  3. Cachear el resultado en data/cache/ para los sitios de data/sites.json.

Contrato de salida:
{
  "az_step_deg": 1,
  "el": [360 valores],      # elevación del horizonte en cada azimut (grados)
  "source": "mock" | "LOLA <producto y resolución>"
}
"""
from __future__ import annotations

import math


def get_horizon(lat: float, lon: float, radius_km: float = 50.0) -> dict:
    """Devuelve la elevación del horizonte para az = 0..359 (paso 1°)."""
    el = []
    for az in range(360):
        base = 1.5 + 1.0 * math.sin(math.radians(3 * az))
        bump = 5.0 * math.exp(-(((az - 120) / 15.0) ** 2))  # una "montaña" simulada
        el.append(round(base + bump, 3))
    return {"az_step_deg": 1, "el": el, "source": "mock"}
