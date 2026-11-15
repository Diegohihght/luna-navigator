# Lunar Landing Site Navigator

An interactive tool to compare lunar landing sites and dates. For a given site and time window, it shows where the **Sun** and the **Earth** sit relative to the **real local horizon** (computed from NASA LOLA topography), and derives energy and communication metrics: solar elevation, daylight, dark periods, Earth visibility, and time remaining until sunset or Earthset.

Built for the **NASA Space Apps Challenge 2026** — challenge: *"Lunar Landing Site Navigator"*.

> Status: all four modules run on real data. See [CONTEXTO.md](CONTEXTO.md) for the team's current status and the open items (site coordinate verification is still pending).

---

## Who it is for

- **Mission planners:** quickly compare site/date combinations and see how a schedule change affects solar power and communications.
- **Educators and students:** the educational mode explains, with the site's own numbers, why the Moon's south pole is hard to operate in.
- **The public:** the 3D views show the lunar sky and terrain with the real Sun and Earth positions.

## What you can do

| Page | URL | What it shows |
|---|---|---|
| Navigator | `/` | Pick a curated site or custom coordinates and a date range. Summary metrics, horizon view (2D), 3D views from outside the Moon and from the site, timeline, and side-by-side site comparison. |
| Heatmap | `/heatmap.html` | Site × date-window heatmap of the percentage of time with the Sun above the local horizon. Answers "what happens if the launch slips?" |
| Educational | `/educativo.html` | Three lessons (solar elevation, Earth visibility, effect of terrain) and a "myths and facts" tab, using the selected site's numbers. |

The API is documented interactively at `/docs` when the server is running.

## Quick start

Requirements: Python 3.11 or newer.

```bash
git clone https://github.com/Diegohihght/luna-navigator.git
cd luna-navigator
python -m venv .venv
# Windows (PowerShell):  .venv\Scripts\Activate.ps1
# macOS / Linux:         source .venv/bin/activate
pip install -r requirements.txt
uvicorn backend.main:app --reload
```

Open http://127.0.0.1:8000 (app) or http://127.0.0.1:8000/docs (API).

Curated sites already have precomputed horizons and terrain in the repository (`data/horizons/`, `frontend/data/relief/`), so the app works for them without any large download. Custom coordinates are computed on demand and cached in `data/cache/`.

Run the tests with `pytest`.

### First run: JPL kernels and terrain

**The first run needs internet**, for two things that are downloaded automatically:

- **Planetary ephemerides.** The Sun and Earth positions are computed with Skyfield from JPL data. On the first calculation, Skyfield downloads `de421.bsp` (JPL DE421, about 16 MB) and the lunar frame files `moon_080317.tf`, `pck00008.tpc` and `moon_pa_de421_1900-2050.bpc`, into `data/kernels/`. Later runs use the local files and work offline. `data/kernels/` is in `.gitignore` and is not committed.
- **Terrain for sites outside the south polar region.** The LOLA global elevation model is read remotely, and only the window around each site is downloaded.

To prepare for a demonstration without internet, run once with a connection:

```bash
python -c "from datetime import datetime, timezone; from backend.ephemeris import get_ephemeris; t = datetime(2027, 1, 1, tzinfo=timezone.utc); get_ephemeris(0, 0, t, t, 60)"
```

**Validation.** The ephemeris values were compared against JPL Horizons for the 10 curated sites on 3 dates (2027-01-01, 2027-01-10 and 2027-01-20), at 00:00, 06:00, 12:00 and 18:00 UTC. The largest angular separation is 0.0064°, against a tolerance of 0.02°. The table is in [`tests/horizons_validation/validacion_horizons.md`](tests/horizons_validation/validacion_horizons.md).

## Data sources

All scientific inputs come from NASA or partner agencies.

| Data | Used for | Source |
|---|---|---|
| JPL DE421 planetary ephemeris | Positions of the Sun and the Earth as seen from each site | NASA JPL, via [Skyfield](https://rhodesmill.org/skyfield/) |
| JPL Horizons | Independent check of the ephemeris values (`tests/horizons_validation/`, `tests/test_ephemeris_horizons.py`) | [NASA JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) |
| LOLA south polar DEM, `LDEM_80S_80MPP_ADJ` (80 m/px, 80–90°S) | Horizon and terrain near the south pole | NASA GSFC, [Planetary Geodesy Data Archive](https://pgda.gsfc.nasa.gov/products/90) |
| LOLA Global LDEM, 118 m/px | Horizon and terrain for the rest of the Moon | [USGS Astrogeology](https://astrogeology.usgs.gov/search/map/moon_lro_lola_dem_118m) |
| Clementine UVVIS 750 nm global mosaic, 118 m v2 | Surface tone (albedo) of the 3D Moon | USGS Astrogeology, `Lunar_Clementine_UVVIS_750nm_Global_Mosaic_118m_v2` in the [planetarymaps](https://planetarymaps.usgs.gov/mosaic/) archive |

The same LOLA data can be explored in [NASA Moon Trek](https://trek.nasa.gov/moon/). Site positions are to be checked against [LROC Quickmap](https://quickmap.lroc.asu.edu/).

## How it works

1. **Ephemerides.** For each time step, the Sun and Earth are located with DE421 from the site's position on the lunar surface, and converted to azimuth and geometric elevation (no atmospheric refraction, as the Moon has no atmosphere). Azimuth 0° is lunar north, increasing clockwise.
2. **Horizon.** For each azimuth from 0° to 359°, the code walks along the great circle of the lunar sphere outwards from the site (up to 50 km), and records the highest terrain elevation angle, including the curvature of the Moon (R = 1737.4 km). The result is 360 values.
3. **Visibility.** The Sun or the Earth is visible when its elevation is greater than the horizon elevation at its azimuth.
4. **Metrics.** Solar illumination percentage, longest dark period, maximum solar elevation, Earth visibility percentage, longest communications gap, and hours until the next change of Sun or Earth visibility.

## Method notes and limitations

- The horizon uses the LOLA elevation models as published. Heights are not corrected for local rock or dust, and the 80 m and 118 m grids cannot resolve small craters.
- The 3D surface away from the curated sites is illustrative and is labelled as such in the interface.
- **Shackleton rim coordinates are still unverified.** At the current coordinate the horizon is high and the Sun is hidden for most of the period. This is being checked against LROC Quickmap; treat that site's numbers as provisional.
- Earth libration is included implicitly, because the Earth position is computed for each site. The JPL check above covers the Sun and Earth positions, but libration has not been checked separately.
- The Moon's orbital variations are included by the DE421 ephemeris.

## Repository layout

```
backend/              FastAPI app, ephemerides, horizon, metrics
frontend/             Pages (index, heatmap, educational) and the 3D view
frontend/data/relief/ Committed LOLA and Clementine relief (2.8 MB)
data/sites.json       Curated landing sites
data/horizons/        Committed precomputed horizons (360 values per site)
data/dem/             Optional local south polar DEM (not committed; see its README)
data/kernels/         Ephemeris kernels, downloaded on first run (not committed)
data/cache/           Runtime cache (not committed)
scripts/              build_horizons.py, build_relief.py
tests/                pytest suite and the JPL Horizons validation table
```

Regenerate the committed data when coordinates or sources change:

```bash
python scripts/build_horizons.py            # horizons for all curated sites
python scripts/build_relief.py              # globe and site relief
```

## Team

| Role | Member | Responsibility |
|---|---|---|
| A. Ephemerides | Martin | `backend/ephemeris.py`, JPL validation |
| B. Terrain | Sennie | `backend/horizon.py`, horizons and DEM handling |
| C. Frontend | Luis | `frontend/`, 3D views |
| D. Metrics and integration | Diego | `backend/metrics.py`, `backend/main.py`, scripts, documentation |

## Contributing

- Start from an up-to-date `main`: `git checkout main && git pull`.
- Create a branch named after you and the topic, for example `luis/3d-tweaks`.
- Run `pytest` and check the pages in a browser before opening a pull request.
- Open a pull request to `main`. A teammate other than the author reviews it.
- Delete the branch after it is merged.

## Use of AI tools

This project was built with the help of AI tools, as declared here in line with the challenge rules.

- **Tool used:** Anthropic's Claude models, through Claude Code (command-line agent in the repository) and the claude.ai chat.
- **What the AI helped with:** drafting and refactoring Python and JavaScript code, writing tests, debugging, drafting documentation (including this README), and suggesting visualization designs.
- **What the team did:** defined the scientific scope, chose data sources, set the validation criteria, reviewed and ran every change, and decided what was kept. Astronomical values are checked against JPL Horizons, and terrain values come directly from the published LOLA products. The validation table is kept in `tests/horizons_validation/`.
- **Limits we are aware of:** AI-generated code can contain errors, so every change was tested before merging, and open issues are listed in [CONTEXTO.md](CONTEXTO.md).

## References

- Folkner, W. M., Williams, J. G., & Boggs, D. H. (2009). The Planetary and Lunar Ephemerides DE421. JPL Interplanetary Network Progress Report 42-178.
- Smith, D. E., Zuber, M. T., Neumann, G. A., Lemoine, F. G., Mazarico, E., Torrence, M. H., et al. (2010). The Lunar Orbiter Laser Altimeter investigation on the Lunar Reconnaissance Orbiter mission. Space Science Reviews, 150, 209–241. https://doi.org/10.1007/s11214-009-9512-y
- Barker, M. K., Mazarico, E., Neumann, G. A., et al. (2023). A New View of the Lunar South Pole from the Lunar Orbiter Laser Altimeter (LOLA). The Planetary Science Journal, 4(9), 183. https://doi.org/10.3847/PSJ/acf3e1 ([record](https://doaj.org/article/210a43e5612a45e680189a9674460e93))
- Rhodes, B. (2019). Skyfield: High precision research-grade positions for planets and Earth satellites generator. Astrophysics Source Code Library, ascl:1907.024.
- NASA Lunar Reconnaissance Orbiter (LRO) mission: https://lunar.gsfc.nasa.gov/
- NASA Moon Trek: https://trek.nasa.gov/moon/
- NASA JPL Horizons: https://ssd.jpl.nasa.gov/horizons/
- LROC Quickmap: https://quickmap.lroc.asu.edu/
- Canadian Space Agency, Moon exploration: https://www.asc-csa.gc.ca/eng/astronomy/moon-exploration/
