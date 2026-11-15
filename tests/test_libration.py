"""Evidencia de que la libración está modelada (Tierra no fija en el cielo lunar)."""
from datetime import datetime, timezone

import numpy as np
import pytest

from backend.ephemeris import get_ephemeris

START = datetime(2027, 1, 1, tzinfo=timezone.utc)
END = datetime(2027, 1, 29, tzinfo=timezone.utc)  # > 27.3 días (un mes anomalístico)


def _earth(lat, lon):
    e = get_ephemeris(lat, lon, START, END, 60)["earth"]
    return np.array(e["az"]), np.array(e["el"])


def test_earth_oscillates_near_limb():
    """Cerca del limbo la libración (~±7°) mueve la Tierra varios grados."""
    _, el = _earth(0.0, 80.0)
    assert el.max() - el.min() > 8.0


def test_earth_oscillates_at_south_pole():
    """En el polo sur la Tierra sube y baja del horizonte por libración en latitud."""
    _, el = _earth(-89.9, 0.0)
    assert el.max() > 0 > el.min()
    assert el.max() - el.min() > 8.0


def test_earth_never_visible_far_side():
    _, el = _earth(0.0, 180.0)
    assert el.max() < 0


def test_earth_differs_from_fixed_model():
    """Un modelo 'Tierra fija' daría rango ~0; el real debe ser claramente mayor."""
    az, el = _earth(0.0, 80.0)
    assert np.ptp(az) > 5.0