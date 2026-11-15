# Lunar Landing Site Navigator — NASA Space Apps 2026

Team (4): Martin (A), Sennie (B), Luis (C), Diego (D)
Challenge: "Lunar Landing Site Navigator" (Human Exploration / Moon / Software; Intermediate–Advanced).

> **Single source of truth for the team.** Anyone using Claude (chat or Claude Code) pastes this file at the start. If a contract or a decision changes, update it here and tell the group.

---

## 1. What the project is
A tool to **quickly compare lunar landing sites and dates** (mainly the south pole). It shows **where the Sun and the Earth are relative to the local horizon** (with real terrain), and computes **solar energy** and **Earth communication** metrics. It serves mission planners, educators and the general public.

**Long-term vision (after the submission):** a public, reproducible tool that anyone can run with NASA data, covering real mission sites, the LOLA horizon across the whole globe, and launch-window analysis. What exists today is the foundation for that.

## 2. What is done (status as of 15 November 2026)

| Module | Status | Where |
|---|---|---|
| A. Ephemerides | **Real.** Skyfield with DE421; validated against JPL Horizons for the 10 curated sites | `backend/ephemeris.py`, `tests/test_ephemeris*.py`, `tests/horizons_validation/` |
| B. Terrain | **Real for the 10 curated sites.** LOLA: local south-polar DEM (80 m/px) and remote global DEM (118 m/px); precomputed horizons committed to the repo | `backend/horizon.py`, `data/horizons/`, `scripts/build_horizons.py` |
| C. Frontend | **Real.** 2D panorama, 3D views "from outside" and "from the site" with LOLA + Clementine relief, site comparison, timeline | `frontend/index.html`, `frontend/vista3d.js`, `frontend/data/relief/` |
| D. Metrics and integration | **Real.** Metrics, site × date heatmap, educational mode, shared theme, README in English | `backend/metrics.py`, `backend/main.py`, `frontend/heatmap.html`, `frontend/educativo.html`, `frontend/theme.css`, `README.md` |

Branches: **everything is in `main`**. Merged pull requests: #1–#12. Work in progress: Sennie's branch `sennie/verificar-sitios` (verified site coordinates; pull request pending).

What is **not** done yet:
- Site coordinates in `data/sites.json` verified with Quickmap (`verified: false`). **Urgent for Shackleton** (see §8).
- Real terrain for custom coordinates: they currently use illustrative terrain, and the view says so.
- Final captions, pitch script and pitch video.
- Translation of the user-facing interface (HTML pages and 3D view text) and of `backend/horizon.py` and `tests/test_horizon.py`.

## 3. Key physical concepts
- No atmosphere: no refraction; the horizon is geometric and set by the terrain.
- South pole: the Sun barely rises a few degrees (axial tilt ~1.5°) and shadows are very long; the terrain decides almost everything.
- Earth: almost fixed in the sky from the near side, with a small libration wobble; from the south pole it sits close to the horizon and terrain blocks it easily. It is never visible from the far side.
- Lunar day ≈ 29.5 Earth days.

## 4. Stack and data
- **Backend:** Python 3.11+, FastAPI. It also serves the frontend (`uvicorn backend.main:app --reload`, from the repository root).
- **Frontend:** plain HTML + JS, no build step. Plotly.js for charts; Canvas 2D for the 3D views.
- **Ephemerides:** Skyfield with `de421.bsp` (JPL). Downloaded automatically on the first run (requires internet) into `data/kernels/`.
- **Terrain (NASA LRO, LOLA):**
  - South pole, 80°S–90°S: `LDEM_80S_80MPP_ADJ`, 80 m/px. Local download into `data/dem/` (see `data/dem/README.txt`). Source: [PGDA, NASA GSFC](https://pgda.gsfc.nasa.gov/products/90).
  - Rest of the Moon: LOLA Global LDEM 118 m/px, read remotely over HTTP (only the site's window). Source: [USGS Astrogeology](https://astrogeology.usgs.gov/search/map/moon_lro_lola_dem_118m).
  - Albedo for the lunar tone: Clementine UVVIS 750 nm Global Mosaic 118 m v2 (USGS Astrogeology).
  - The same LOLA data can be explored in [NASA Moon Trek](https://trek.nasa.gov/moon/).
- **Data committed to Git** (so evaluators can run the app without downloading anything):
  - `data/horizons/` (precomputed horizon profiles of the curated sites, ~44 KB).
  - `frontend/data/relief/` (globe and ground relief, 2.8 MB).
- **Data NOT committed to Git:** `data/dem/*.TIF`, `data/kernels/`, `data/cache/`. They are listed in `.gitignore`.
- Python requirements: `pip install -r requirements.txt` (includes `rasterio` and `pyproj`).

## 5. Conventions and contracts
**Global**
- Time in UTC, ISO 8601, constant step.
- Angles in degrees. Azimuth 0° = lunar north, clockwise. Geometric elevation (no refraction).
- Planetocentric latitude, east-positive longitude (−180..180).
- Code in English (snake_case), docstrings and comments in English, type hints everywhere.
- Every module returns a `source` field. `"mock"` = simulated calculation; any other value = real data (e.g. `"skyfield-de421"`, `"LOLA LDEM_80S_80MPP_ADJ (80 m/px)"`).

**Endpoints** (see `/docs` with the server running)

`GET /api/sites` → `[{id, name, lat, lon, mission, type, verified}]`

`GET /api/ephemeris?lat=&lon=&start=&end=&step_min=60` → `{"t":[...], "sun":{"az":[...],"el":[...]}, "earth":{"az":[...],"el":[...]}, "source":"skyfield-de421"}`

`GET /api/horizon?lat=&lon=&radius_km=50` → `{"az_step_deg":1, "el":[360 values], "source":"LOLA ..."}`

`GET /api/metrics?lat=&lon=&start=&end=&step_min=60` → `{"sun_lit_pct", "longest_dark_h", "sun_el_max_deg", "earth_visible_pct", "longest_comms_gap_h", "hours_to_sun_change", "hours_to_earth_change", "intervals":{"sun":[...],"earth":[...]}, "source":{"ephemeris":"...","horizon":"..."}}`

`GET /api/compare?sites=id1,id2&start=&end=&step_min=` → `[{id, name, metrics}]`

Rule: Sun/Earth are visible when their elevation is greater than the horizon elevation at that azimuth.

**Contract changes:** field names and units do not change without announcing it here and to the group.

## 6. How we work (everyone)
1. Always start from an up-to-date `main`: `git checkout main && git pull`.
2. Create a branch with your name and the topic: `martin/...`, `sennie/...`, `luis/...`, `diego/...` (e.g. `luis/vista3d-tweaks`).
3. Before opening a pull request: `pytest` green, and run the server to test in the browser.
4. Open a pull request to `main`. Someone other than the author reviews it.
5. Merge and **delete the branch** (remote and local) after the merge.
6. Do not commit heavy data or secrets. Check `git status` before each commit.

How we work with Claude: Diego uses Claude Code with access to the repo (it reads `CLAUDE.md`). Martin, Sennie and Luis can use the claude.ai chat and `PROMPTS.md`. The repo is the shared memory.

## 7. Owners and next steps

### A. Ephemerides — Martin (`backend/ephemeris.py`, `tests/`)
Done: real computation with Skyfield (PR #1); validation against JPL Horizons (PR #3); validation for the 10 curated sites on 3 dates at 4 times each, maximum separation 0.0064° against a 0.02° tolerance (PR #11); kernel download and validation documented in the README (PR #12).
Next (optional):
- Confirm timings for long ranges (the heatmap requests 12 windows of 29.5 days × 10 sites; it currently responds in a few seconds).

### B. Terrain — Sennie (`backend/horizon.py`, `data/horizons/`, `data/dem/`)
Done: real LOLA horizon with the local polar DEM (PR #5) and with the remote global DEM (PR #7); precomputed profiles for the 10 sites.
Next:
- Shackleton: with `-89.9, 129.8` the horizon reaches 33° and the Sun is down 0 % of the time. This suggests the point is inside the crater. Verify it against Quickmap (her branch `sennie/verificar-sitios` is in progress). If the coordinate changes, regenerate its profile with `python scripts/build_horizons.py shackleton`.
- Decide whether the fallback terrain for custom coordinates stays remote or a local global DEM is added.
- Keep `tests/test_horizon.py` green.
- After her pull request is merged, the docstrings in `backend/horizon.py` and `tests/test_horizon.py` will be translated to English (not yet done, to avoid conflicts with her work).

### C. Frontend — Luis (`frontend/index.html`, `frontend/vista3d.js`)
Done: redesign, comparison, timeline, 3D views with real relief.
Next:
- Review the five 3D views in the browser with different sites (Apollo 17, Apollo 11, Shackleton, south pole, custom coordinate) and note any visual defects.
- Improve the 3D help text: the text below the view says "Relief: LOLA" even when the ground is illustrative. The label inside the view is already correct.
- Translate the interface text to English (pages and the 3D view), and the comments in `vista3d.js`.
- Basic accessibility: contrast and focus on buttons and tabs.

### D. Metrics and integration — Diego (`backend/metrics.py`, `backend/main.py`, `scripts/`, docs, pitch)
Done: metrics, heatmap, educational mode, shared theme, relief and precomputed horizons, README in English, translation of the Python docstrings and comments in the in-scope modules.
Next:
- Update the figures in the README and the pitch with the final values once Sennie's Shackleton coordinate is merged.
- Captions and pitch script, in English, organized by the eight grading criteria.
- Final review: `pytest`, a clean start from a fresh clone without the DEM, and the four pages without simulated-data warnings.

## 8. Team pending items
- [ ] Verify the coordinates in `data/sites.json` against Quickmap (Shackleton first). Owner: Sennie (in progress).
- [ ] Decide the final list of curated sites. Owner: everyone.
- [ ] Confirm the Space Apps submission requirements (format, video, public repository). Owner: Diego.
- [ ] Review the challenge's Resources tab and add the data links to the README. Owner: Diego.
- [ ] Decide whether custom coordinates use a local fallback DEM. Owner: Sennie.
- [ ] Translate the remaining Spanish: interface text, `vista3d.js` comments, and the docstrings of `backend/horizon.py` and `tests/test_horizon.py`. Owners: Luis (interface and `vista3d.js`), Sennie (her files).

## 9. Validation (before we consider anything good)
- Sun and Earth against JPL Horizons at the 10 curated sites (done, Martin; see `tests/horizons_validation/validacion_horizons.md`).
- At the pole, the maximum solar elevation should be a few degrees (currently: Shackleton 1°, south pole ~1°).
- A far-side site never sees the Earth.
- Horizon consistent with the map: Apollo 17 ~14° to the north (North Massif), Apollo 11 almost flat.
- `pytest` green before every merge into `main`.

## 10. Risks
- Heavy and slow DEMs → per-site windows and caching (already solved for the curated sites).
- Internet needed on the first run (JPL kernels, remote global DEM) → that is why the horizons and relief are committed to Git.
- Reference frames and lunar conventions → fixed in §5 and validated against JPL and LOLA.
- Trying to do everything → freeze features at hour 10 of the plan.
- Free-plan limits of Claude → complete, concrete messages (see `PROMPTS.md`).

## 11. After the submission (long term)
- LOLA horizon for any coordinate, with a local global DEM.
- 2D polar map with the horizon and the light windows overlaid.
- Real Earth libration and communication with more than one antenna.
- More sites: CLPS missions and candidate sites from NASA and the Canadian Space Agency.
- Automatic validation against JPL in continuous integration.

## 12. Challenge reference plans
- **MVP:** one site + one date → horizon with Sun and Earth + basic metrics. *(Done.)*
- **Plus:** curated list, custom coordinates, LOLA terrain, timeline, comparison. *(Done, except custom coordinates with real relief.)*
- **Wow:** site × date heatmap, lunar-day animation, educational mode, 3D views. *(Done; the lunar-day animation is available in the timeline.)*

## Status (summary)
| Module | Status |
|---|---|
| Repository | on GitHub (`Diegohihght/luna-navigator`), `main` clean, no open pull requests, one branch in progress (`sennie/verificar-sitios`) |
| A. Ephemerides | real (Skyfield DE421, validated against JPL Horizons at the 10 sites) |
| B. Terrain | real for the 10 curated sites (LOLA); custom coordinates use illustrative relief |
| C. Frontend | real (2D, 3D from outside and from the site, comparison, heatmap, educational) |
| D. Metrics and integration | real; README in English done; pitch pending |
