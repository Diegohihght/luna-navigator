# UI polish: proposed changes for `index.html` and `vista3d.js`

Owner: **Luis** (role C). These files were left untouched in the `diego/pulido-ui` branch on purpose; this document lists what the UI audit found in them, so Luis can apply the changes he agrees with.

The same fixes were already applied to `heatmap.html` and `educativo.html`, so each item below has a working reference in those files.

Rules that still apply: do not change API fields, endpoints, units or backend logic; keep the `source` field and the simulated-data notice; keep the "illustrative terrain" notice for custom coordinates visible.

---

## High priority

### 1. Horizontal overflow on mobile (`index.html`)
At 390 px wide, the page scrolls sideways: it is 471 px wide. Measured offenders: the horizon `section.card` (471 px), its heading, help text, `#now` row and `.viewbar` (450 px), a `.vtab` button (426 px) and the horizon `svg` (449 px).

Likely cause: a grid column that cannot shrink below its content. Suggested fix, the same one used in `educativo.html`:

```css
.layout { grid-template-columns: minmax(0, 1fr); }   /* inside the max-width:900px rule */
.layout > * { min-width: 0; }
#chart svg { max-width: 100%; }
.viewbar { flex-wrap: wrap; }
```

Check: open the page at 390 px and confirm there is no sideways scroll.

### 2. The same navigation on every page (`index.html`)
`heatmap.html` and `educativo.html` show **Navegador · Heatmap · Educativo**, with the current page highlighted. `index.html` shows "Heatmap sitio × fecha", "Explicación paso a paso" and a "Modo educativo" checkbox. The educational page ends up with three different names, and the checkbox (which shows tooltips on the metrics) is easy to confuse with that page.

Suggested change:
- Use the same `<nav class="nav">` as the other two pages, with `class="on"` on **Navegador**.
- Rename the checkbox to something that says what it does, for example "Mostrar explicaciones".

### 3. 3D help text that contradicts the label (`vista3d.js`)
The help text under the 3D view always says "Relieve: altímetro LOLA de la sonda LRO (NASA)…", even when the ground is illustrative (custom coordinates). The label inside the view is already correct.

Suggested change: build the help text from the same condition the label uses (`tex.groundSite` and `tex.moon.real`), for example:
- Real data: "Relieve: altímetro LOLA de la sonda LRO (NASA); tono: mosaico Clementine 750 nm."
- Illustrative ground: "Suelo ilustrativo: no hay datos LOLA locales para este punto. El horizonte sí es real."

The illustrative-terrain notice must stay visible.

### 4. Plain-language errors with retry (`index.html`)
Today the error says "No se pudo cargar la lista de sitios. ¿Está corriendo el servidor (uvicorn backend.main:app --reload)?". Evaluators do not need a command line.

Suggested change: reuse the `showError(msg, retry, detail)` function from `heatmap.html`. It shows a plain message, a **Reintentar** button and the technical detail in small print. The error box should use `role="alert"`.

---

## Medium priority

### 5. One name per metric (`index.html`)
`index.html` says "Sol iluminado"; `heatmap.html` and `educativo.html` say "Sol visible" for the same metric (`sun_lit_pct`). Suggested: "Sol visible" everywhere.

### 6. Help text that contradicts the button (`index.html`)
Under "Calcular escenario" it says "Se recalcula solo al cambiar sitio, fechas o paso." If the page recalculates by itself, the button is not needed; if the button is needed, the text is wrong. Pick one.

### 7. "— h" in "Hasta cambio de Tierra" (`index.html`)
When the Earth does not change visibility in the period, the card shows "— h". Suggested: "No cambia en el periodo".

### 8. Waiting time for custom coordinates (`index.html`)
A custom coordinate can take about 40 s the first time (the terrain is read remotely). The button only says "Calculando…". Suggested: after a few seconds, add "Calculando el horizonte de un punto nuevo; la primera vez puede tardar hasta un minuto."

### 9. Accessibility of the view tabs and the 3D canvas (`vista3d.js`)
- The view buttons (Panorámica 2D, 3D desde fuera, 3D desde el sitio) behave as tabs: add `role="tab"` and keep `aria-selected` in sync (see `showTab` in `educativo.html`).
- The 3D canvas has no text alternative: add `role="img"` and an `aria-label` that names the site and the view.

---

## For Sennie (`data/sites.json`)
Shackleton was verified with Quickmap (`verified: true`), but its name still says "Borde del cráter Shackleton (aprox.)". Suggested: drop "(aprox.)". The name appears in every page, so this is a data change, not a frontend one.
