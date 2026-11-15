/* vista3d.js — Vista 3D realista del horizonte (sin librerías externas, Canvas 2D).
 * Pestañas: Panorámica 2D · 3D desde fuera (Luna con relieve) · 3D desde el sitio (suelo con cráteres).
 * La Luna, el suelo y la Tierra se iluminan con la posición REAL del Sol (relieve por normales).
 * Relieve real (frontend/data/relief/, generado con scripts/build_relief.py):
 *   - Globo: alturas NASA LRO LOLA (118 m, promediadas a 1024x512) y albedo Clementine 750 nm.
 *   - Suelo desde el sitio: alturas LOLA en ±8 km alrededor de cada sitio curado.
 *   Si un punto no tiene datos (coordenadas personalizadas) se usa relieve ilustrativo y se indica.
 * Se engancha a updateNow() y drawChart() de index.html sin modificarlas.
 * Convención 3D: x = este, y = arriba, z = norte. Azimut 0° = norte, sentido horario.
 */
(function () {
  "use strict";
  const L10 = (key, en, params) => I18N.t(key, en, params);   // alias propio: `t` y `tr` se usan como variables locales más abajo
  const chart = document.getElementById("chart");
  if (!chart || typeof S === "undefined") return;

  const D2R = Math.PI / 180, TAU = Math.PI * 2;
  // Preferencias guardadas (vista y exageración) para no tener que reelegirlas en cada visita.
  const SAVED = (() => { try { return JSON.parse(localStorage.getItem("lunar.view") || "{}"); } catch (e) { return {}; } })();
  const EXAGS = [1, 2, 3, 5, 10];
  const st = {
    mode: "2d", exag: EXAGS.includes(SAVED.exag) ? SAVED.exag : 3, cache: null, follow: SAVED.follow !== false, inited: false,
    orbit: { yaw: Math.PI + 0.55, pitch: 0.35, dist: 13 },
    first: { yaw: 0, off: 0, poff: 0, pitch: 0.08, fov: 85 }
  };
  // Vista desde fuera: el Sol y la Tierra se dibujan lejos de la Luna (radio medido desde su centro).
  const ORB_SUN = 8.5, ORB_EARTH = 6.5, DIST_NEAR = 13, DIST_FAR = 26, DIST_MIN = 3.5, DIST_MAX = 36;
  const savePrefs = () => { try { localStorage.setItem("lunar.view", JSON.stringify({ mode: st.mode, exag: st.exag, follow: st.follow })); } catch (e) { /* sin almacenamiento: no pasa nada */ } };
  let canvas, ctx, W = 600, H = 360, dpr = 1;

  /* ---------- Estilos y elementos ---------- */
  const style = document.createElement("style");
  style.textContent = `
    .viewbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0 12px}
    .vtab,.vbtn{background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:99px;padding:6px 14px;font-size:13px;cursor:pointer}
    .vtab:hover,.vbtn:hover{filter:brightness(1.12)}
    .vbtn{display:inline-block}
    .vtab.on{background:var(--accent);color:#1b1630;border-color:var(--accent);font-weight:650}
    .vexag{display:none;align-items:center;gap:8px;margin-left:auto;font-size:13px;color:var(--muted)}
    .vexag select{width:auto;padding:5px 8px}
    .vsep{flex:1}
    .vzslide{display:none;align-items:center;gap:8px;font-size:13px;color:var(--muted)}
    .vzslide input{width:130px;padding:0;border:0;background:none;accent-color:var(--accent)}
    .vfollow{margin-left:0;cursor:pointer}.vfollow input{width:auto}
    #view3d{display:block;width:100%;border-radius:8px;cursor:grab;touch-action:none;background:#05070d}
    #view3d:active{cursor:grabbing}
    .vstage{display:none;position:relative}
    .vover{display:none;position:absolute;right:12px;bottom:12px;max-width:calc(100% - 24px);flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:8px;padding:7px 9px;
      background:rgba(8,12,24,.74);border:1px solid var(--line-strong,rgba(122,150,205,.38));border-radius:14px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 10px 26px rgba(0,0,0,.5)}
    .vover .vbtn{padding:5px 12px}
    .vhint{display:none;color:var(--muted);font-size:13px;margin:8px 0 0}`;
  document.head.appendChild(style);
  const bar = document.createElement("div");
  bar.className = "viewbar";
  bar.innerHTML =
    '<button class="vtab on" data-mode="2d" data-i18n="v3.tab.2d">2D panorama</button>' +
    '<button class="vtab" data-mode="orbit" data-i18n="v3.tab.orbit">3D from outside</button>' +
    '<button class="vtab" data-mode="first" data-i18n="v3.tab.first">3D from the site</button>' +
    '<label class="vexag vfollow" title="The camera turns and tilts to keep the Sun on screen" data-i18n-attr="title:v3.follow.title"><input type="checkbox" id="vfollow"> <span data-i18n="v3.follow">Camera follows the Sun</span></label>' +
    '<label class="vexag"><span data-i18n="v3.exag">Exaggerate heights</span> <select id="vexag">' + EXAGS.map(k => '<option value="' + k + '">' + (k === 1 ? "×1 (real)" : "×" + k) + '</option>').join("") + '</select></label>';
  canvas = document.createElement("canvas");
  canvas.id = "view3d";
  const hint = document.createElement("p");
  hint.className = "vhint";
  hint.setAttribute("data-i18n", "v3.hint");
  hint.textContent = "Drag to rotate · mouse wheel to zoom in or out · double-click to reset · + / − or the distance control zoom out and in · “Side view” places the camera to see how light travels across the Moon · shortcuts: 1/2/3 switch view, Z zooms out or in. In the outside view, the Sun and the Earth are drawn far from the Moon so you can see how the light travels across it; the dotted segment joins the site with the Sun. Relief: LOLA laser altimeter on NASA’s LRO spacecraft; Moon tone: Clementine 750 nm mosaic. In the site view, the ground adds illustrative micro-detail (small craters and grain) to the real shape of the terrain. It is lit by the real position of the Sun; the exaggeration stretches the relief smoothly and the bodies are drawn larger than in reality so they can be seen.";
  chart.parentNode.insertBefore(bar, chart);
  // La vista 3D va dentro de un "escenario" para poder poner los controles de cámara sobre la pantalla negra, abajo a la derecha.
  const stage = document.createElement("div");
  stage.className = "vstage";
  const over = document.createElement("div");
  over.className = "vover";
  over.innerHTML =
    '<button class="vbtn" id="vzoom" title="Zooms the camera out or in (shortcut: Z)" data-i18n-attr="title:v3.zoom.title">🔭 Zoom out</button>' +
    '<button class="vbtn" id="vside" title="Places the camera to the side to see how light travels across the Moon (shortcut: V)" data-i18n="v3.side" data-i18n-attr="title:v3.side.title">↔ Side view</button>' +
    '<label class="vzslide" title="Camera distance (also: mouse wheel, + and −)" data-i18n-attr="title:v3.dist.title"><span data-i18n="v3.dist">Distance</span> <input type="range" id="vzr" min="' + DIST_MIN + '" max="' + DIST_MAX + '" step="0.1"></label>';
  stage.appendChild(canvas); stage.appendChild(over);
  chart.parentNode.insertBefore(stage, chart.nextSibling);
  stage.parentNode.insertBefore(hint, stage.nextSibling);
  const exagBox = bar.querySelector(".vexag:not(.vfollow)"), followBox = bar.querySelector(".vfollow"), zoomBtn = over.querySelector("#vzoom"),
    sideBtn = over.querySelector("#vside"), zBox = over.querySelector(".vzslide"), zr = over.querySelector("#vzr");
  const updateZoomBtn = () => { zoomBtn.textContent = st.orbit.dist >= (DIST_NEAR + DIST_FAR) / 2 ? L10("v3.zoomin", "🔍 Zoom in") : L10("v3.zoomout", "🔭 Zoom out"); zr.value = st.orbit.dist; };
  bar.querySelector("#vexag").value = String(st.exag);
  bar.querySelector("#vfollow").checked = st.follow;

  /* ---------- Matemática 3D ---------- */
  const dirv = (az, el, r) => { const a = az * D2R, e = el * D2R, c = Math.cos(e); return [r * c * Math.sin(a), r * Math.sin(e), r * c * Math.cos(a)]; };
  /* Exageración vertical: se aplica a la TANGENTE de la elevación (como estirar el relieve en altura),
     no al ángulo. Así una cresta de 14° nunca se dispara a 89° y la pared del horizonte no se aplasta.
     El factor del horizonte es más suave que el del suelo; Sol y Tierra usan la misma función, así que
     "visible/oculto" sigue siendo coherente con lo que se dibuja. */
  const kw = () => 1 + (st.exag - 1) * 0.35;
  const ex = el => {
    if (el <= 0 || st.exag === 1) return Math.max(-90, Math.min(89, el));
    return Math.min(89, Math.atan(Math.tan(el * D2R) * kw()) / D2R);
  };
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sm = t => t * t * (3 - 2 * t);
  const effYaw = () => st.follow && S.eph ? S.eph.sun.az[S.i] * D2R + st.first.off : st.first.yaw;
  /* Inclinación que mantiene al Sol dentro del cuadro: de noche mira al horizonte, hacia donde saldría. */
  function sunPitch() {
    const e = ex(S.eph.sun.el[S.i]);
    const base = e < 3 ? 3 : e <= 25 ? e : 25 + (e - 25) * 0.4;   // con el Sol muy alto se deja ver algo de suelo
    return base * D2R;
  }
  const effPitch = () => st.follow && S.eph ? clamp(sunPitch() + st.first.poff, -0.45, 1.45) : st.first.pitch;

  function camera() {
    let P, f, focal;
    if (st.mode === "orbit") {
      const o = st.orbit, T = [0, -0.6, 0], cp = Math.cos(o.pitch);
      P = [T[0] + o.dist * Math.sin(o.yaw) * cp, T[1] + o.dist * Math.sin(o.pitch), T[2] + o.dist * Math.cos(o.yaw) * cp];
      f = norm([T[0] - P[0], T[1] - P[1], T[2] - P[2]]);
      focal = (H / 2) / Math.tan(20 * D2R);
    } else {
      const q = st.first, pitch = effPitch(), cp = Math.cos(pitch), yaw = effYaw();
      P = [0, 0, 0];
      f = [Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp];
      focal = (H / 2) / Math.tan(q.fov / 2 * D2R);
    }
    const r = norm([f[2], 0, -f[0]]);
    const u = [f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0]];
    return { P, f, r, u, focal };
  }
  function proj(c, p) {
    const vx = p[0] - c.P[0], vy = p[1] - c.P[1], vz = p[2] - c.P[2];
    const zc = vx * c.f[0] + vy * c.f[1] + vz * c.f[2];
    if (zc < 0.03) return null;
    const xc = vx * c.r[0] + vy * c.r[1] + vz * c.r[2], yc = vx * c.u[0] + vy * c.u[1] + vz * c.u[2];
    return { x: W / 2 + xc / zc * c.focal, y: H / 2 - yc / zc * c.focal, z: zc, d: vx * vx + vy * vy + vz * vz };
  }
  function path3d(cam, pts, close) {
    ctx.beginPath();
    let pen = false;
    for (const p of pts) {
      const q = proj(cam, p);
      if (!q) { pen = false; continue; }
      if (pen) ctx.lineTo(q.x, q.y); else { ctx.moveTo(q.x, q.y); pen = true; }
    }
    if (close) ctx.closePath();
  }
  function trajectories() {
    const e = S.eph;
    if (st.cache && st.cache.eph === e && st.cache.k === st.exag) return st.cache;
    const n = e.t.length, step = Math.max(1, Math.ceil(n / 400));
    const mk = b => { const out = []; for (let i = 0; i < n; i += step) out.push(dirv(b.az[i], ex(b.el[i]), 1)); return out; };
    const rg = a => Math.max(...a) - Math.min(...a);
    return (st.cache = { eph: e, k: st.exag, sun: mk(e.sun), earth: mk(e.earth), earthFixed: rg(e.earth.az) < 8 && rg(e.earth.el) < 8 });
  }

  /* ---------- Texturas procedurales (se generan una vez) ---------- */
  const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const tex = { moon: null, ground: null, earth: null, groundSite: null };
  let loading = false;

  /** Pendientes por texel del globo (se muestrean con interpolación bilineal al dibujar). */
  function addGrad(T) {
    const { Wt, Ht, hm } = T;
    T.gE = new Float32Array(Wt * Ht); T.gN = new Float32Array(Wt * Ht);
    for (let y = 0; y < Ht; y++) for (let x = 0; x < Wt; x++) {
      const k = y * Wt + x;
      T.gE[k] = (hm[y * Wt + (x + 1) % Wt] - hm[y * Wt + (x + Wt - 1) % Wt]) * 0.5;
      T.gN[k] = (hm[Math.max(0, y - 1) * Wt + x] - hm[Math.min(Ht - 1, y + 1) * Wt + x]) * 0.5;
    }
    return T;
  }
  /** Suelo del sitio: sobremuestrea el DEM (256 → 512), lo suaviza y deja listas las pendientes (m/m). */
  function prepGround(h16, N, E) {
    const M = 512, h = new Float32Array(M * M), t = new Float32Array(M * M);
    // Sobremuestreo bicúbico (Catmull-Rom): el campo resultante es continuo en pendiente, sin "escalones" de 62 m.
    const cr = (p0, p1, p2, p3, u) => p1 + 0.5 * u * (p2 - p0 + u * (2 * p0 - 5 * p1 + 4 * p2 - p3 + u * (3 * (p1 - p2) + p3 - p0)));
    const at = (x, y) => h16[clamp(y, 0, N - 1) * N + clamp(x, 0, N - 1)];
    for (let j = 0; j < M; j++) {
      const fy = (j + 0.5) * N / M - 0.5, y0 = Math.floor(fy), ty = fy - y0;
      for (let i = 0; i < M; i++) {
        const fx = (i + 0.5) * N / M - 0.5, x0 = Math.floor(fx), tx = fx - x0, row = [];
        for (let dj = -1; dj <= 2; dj++) row.push(cr(at(x0 - 1, y0 + dj), at(x0, y0 + dj), at(x0 + 1, y0 + dj), at(x0 + 2, y0 + dj), tx));
        h[j * M + i] = cr(row[0], row[1], row[2], row[3], ty);
      }
    }
    for (let pass = 0; pass < 2; pass++) {           // desenfoque 3×3: quita escalones y rayas del DEM
      for (let j = 0; j < M; j++) for (let i = 0; i < M; i++) {
        let s = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += h[clamp(j + dj, 0, M - 1) * M + clamp(i + di, 0, M - 1)];
        t[j * M + i] = s / 9;
      }
      h.set(t);
    }
    const pxm = 2 * E / M, sx = new Float32Array(M * M), sz = new Float32Array(M * M);
    for (let j = 1; j < M - 1; j++) for (let i = 1; i < M - 1; i++) {
      const r = j * M + i;
      sx[r] = (h[r + 1] - h[r - 1]) / (2 * pxm);     // dh/dx hacia el este
      sz[r] = (h[r - M] - h[r + M]) / (2 * pxm);     // dh/dz hacia el norte (fila 0 = norte)
    }
    return { M, pxm, extent: E, sx, sz };
  }

  /* ---------- Relieve real (LOLA + Clementine), con respaldo ilustrativo ---------- */
  const RELIEF = "/data/relief/", MOON_R = 1737400, M_PER_UNIT = 4500; // 1 unidad de escena = 4.5 km en el suelo
  const real = { state: "idle", manifest: null, ground: {} };
  const siteKey = s => (+s.lat).toFixed(4) + "_" + (+s.lon).toFixed(4);
  async function getBin(path, Type) {
    const r = await fetch(RELIEF + path);
    if (!r.ok) throw new Error(path + ": " + r.status);
    return new Type(await r.arrayBuffer());
  }
  async function loadReal() {
    real.state = "loading";
    try {
      const r = await fetch(RELIEF + "manifest.json");
      if (!r.ok) throw new Error("manifest " + r.status);
      const m = real.manifest = await r.json(), g = m.globe;
      const [h16, a8] = await Promise.all([getBin(g.heights, Int16Array), getBin(g.albedo, Uint8Array)]);
      const n = g.w * g.h, hm = new Float32Array(n), al = new Float32Array(n), texel = TAU * MOON_R / g.w;
      for (let k = 0; k < n; k++) { hm[k] = h16[k] / texel; al[k] = 0.2 + 0.72 * a8[k] / 255; }
      tex.moon = addGrad({ hm, al, Wt: g.w, Ht: g.h, real: true });
      real.state = "ready";
    } catch (err) {
      console.warn("LOLA relief not available; using illustrative relief.", err);
      real.state = "failed";
    }
    draw3D();
  }
  /** Suelo real del sitio: objeto listo, "loading" mientras se descarga, o null (sin datos). */
  function groundFor(site) {
    if (real.state !== "ready") return null;
    const key = siteKey(site), info = real.manifest.ground && real.manifest.ground.sites[key];
    if (!info) return null;
    const cur = real.ground[key];
    if (cur === undefined) {
      real.ground[key] = "loading";
      getBin(info.file, Int16Array).then(h16 => {
        const G = real.manifest.ground, M = tex.moon;
        let albedo = 0.55;
        if (M && M.real) {
          const iu = Math.min(M.Wt - 1, Math.floor((+site.lon / 360 + 0.5) * M.Wt)), iv = Math.min(M.Ht - 1, Math.floor((0.5 - site.lat / 180) * M.Ht));
          albedo = M.al[iv * M.Wt + iu];
        }
        real.ground[key] = Object.assign(prepGround(h16, G.n, G.extent_m), { albedo, source: info.source });
        draw3D();
      }).catch(err => { console.warn("Sin suelo LOLA para", key, err); real.ground[key] = "failed"; draw3D(); });
      return "loading";
    }
    return cur === "loading" ? "loading" : cur === "failed" ? null : cur;
  }

  /* Ruido fractal: suma de octavas bilineales; amplitud proporcional a la longitud de onda (pendiente constante). */
  function fbm(Wt, Ht, seed, octs, kS, base, wy) {
    const out = new Float32Array(Wt * Ht), r = rng(seed);
    for (let o = 0; o < octs; o++) {
      const gx = base << o, gy = Math.max(2, Math.round(gx * Ht / Wt)), gw = gx + 1, g = new Float32Array(gw * (gy + 1)), amp = kS * Wt / gx;
      for (let j = 0; j <= gy; j++) { for (let i = 0; i < gx; i++) g[j * gw + i] = (r() * 2 - 1) * amp; g[j * gw + gx] = g[j * gw]; }
      if (wy) for (let i = 0; i < gw; i++) g[gy * gw + i] = g[i];
      for (let y = 0; y < Ht; y++) {
        const fy = y / Ht * gy, j = fy | 0, ty = sm(fy - j), r0 = j * gw, r1 = (j + 1) * gw;
        for (let x = 0; x < Wt; x++) {
          const fx = x / Wt * gx, i = fx | 0, tx = sm(fx - i);
          const a = g[r0 + i] + (g[r0 + i + 1] - g[r0 + i]) * tx, b = g[r1 + i] + (g[r1 + i + 1] - g[r1 + i]) * tx;
          out[y * Wt + x] += a + (b - a) * ty;
        }
      }
    }
    return out;
  }
  /* Perfil de cráter: cuenco, pico central, borde elevado y manto de eyecciones (en "texels"). */
  let PH = 0, PA = 0;
  function prof(q, rp, fr) {
    const depth = 0.14 * rp, rim = 0.07 * rp, g = (q - 1) / 0.1;
    let h = 0, a = 0;
    if (q < 1) { h = -depth * (1 - q * q); if (rp > 14) h += 0.35 * depth * Math.exp(-(q / 0.12) * (q / 0.12)); a = -0.04 * fr; }
    const rg = Math.exp(-g * g);
    h += rim * rg; a += 0.1 * fr * rg;
    if (q > 1) { const e = 1 / (q * q * q); h += rim * 0.5 * e; a += 0.12 * fr * e; }
    PH = h; PA = a;
  }
  const MARIA = [[33, -16, 13], [28, 18, 7], [8, 31, 8], [17, 59, 5], [-21, -15, 8], [-24, -39, 6], [18, -57, 17], [-3, -8, 4], [43, -30, 6]];
  const BIG = [[-43.3, -11.4, 2.6], [9.7, -20, 1.8], [23.7, -47.4, 1.4], [8.1, -38, 1.3], [-12, -60, 2.2], [13, -70, 2.2], [-58, 20, 3.2], [-35, 12, 2.4], [-24, 160, 3]];

  function genMoon() {
    const Wt = 1536, Ht = 768, hm = fbm(Wt, Ht, 3, 6, 0.05, 4, false), al = fbm(Wt, Ht, 9, 5, 0.0003, 4, false);
    for (let k = 0; k < al.length; k++) al[k] = clamp(0.58 + al[k], 0.3, 0.85);
    for (const [la, lo, rad] of MARIA) {
      const yc = (90 - la) / 180 * Ht, xc = (lo + 180) / 360 * Wt, ry = Math.ceil(rad * 1.5 * Ht / 180), rx = Math.ceil(rad * 1.5 / Math.max(0.2, Math.cos(la * D2R)) * Wt / 360);
      for (let y = Math.max(0, Math.floor(yc - ry)); y <= Math.min(Ht - 1, Math.floor(yc + ry)); y++) {
        const cl = Math.max(0.15, Math.cos((90 - (y + 0.5) / Ht * 180) * D2R));
        for (let xx = Math.floor(xc - rx); xx <= xc + rx; xx++) {
          const x = ((xx % Wt) + Wt) % Wt, idx = y * Wt + x;
          const d = Math.hypot((xx - xc) * 360 / Wt * cl, (y - yc) * 180 / Ht) * (1 + (al[idx] - 0.58) * 5);
          const w = clamp((rad - d) / (rad * 0.3), 0, 1);
          if (w > 0) { al[idx] += (0.25 + (al[idx] - 0.58) * 0.5 - al[idx]) * w * 0.92; hm[idx] -= 7 * w; }
        }
      }
    }
    const stamp = (la, lo, rho, fr) => {
      const yc = (90 - la) / 180 * Ht, xc = (lo + 180) / 360 * Wt, rp = rho * Wt / 360;
      const ry = Math.ceil(2.6 * rho * Ht / 180), rx = Math.ceil(2.6 * rho / Math.max(0.15, Math.cos(la * D2R)) * Wt / 360);
      for (let y = Math.max(0, Math.floor(yc - ry)); y <= Math.min(Ht - 1, Math.floor(yc + ry)); y++) {
        const cl = Math.max(0.15, Math.cos((90 - (y + 0.5) / Ht * 180) * D2R));
        for (let xx = Math.floor(xc - rx); xx <= xc + rx; xx++) {
          const q = Math.hypot((xx - xc) * 360 / Wt * cl, (y - yc) * 180 / Ht) / rho;
          if (q > 2.6) continue;
          prof(q, rp, fr);
          const idx = y * Wt + (((xx % Wt) + Wt) % Wt);
          hm[idx] += PH; al[idx] += PA;
        }
      }
    };
    const r = rng(7);
    for (const b of BIG) stamp(b[0], b[1], b[2], 1);
    for (let i = 0; i < 1700; i++) stamp(Math.asin(r() * 2 - 1) / D2R, r() * 360 - 180, Math.min(7, 0.38 / Math.sqrt(r() * 0.97 + 0.03)), r() * r());
    for (let k = 0; k < al.length; k++) al[k] = clamp(al[k], 0.18, 0.95);
    return addGrad({ hm, al, Wt, Ht });
  }
  function genGround() {
    const P = 1024, hm = fbm(P, P, 21, 6, 0.035, 4, true), al = fbm(P, P, 5, 5, 0.0002, 4, true), r = rng(33);
    for (let k = 0; k < al.length; k++) al[k] = 0.5 + al[k];
    const stamp = (xc, yc, rp, fr) => {
      const R = Math.ceil(rp * 2.6);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const q = Math.hypot(dx, dy) / rp;
        if (q > 2.6) continue;
        prof(q, rp, fr);
        const idx = (((yc + dy) % P + P) % P) * P + (((xc + dx) % P + P) % P);
        hm[idx] += PH; al[idx] += PA;
      }
    };
    for (let i = 0; i < 520; i++) stamp(r() * P | 0, r() * P | 0, 4 / Math.sqrt(r() * 0.98 + 0.02), r() * r());
    for (let i = 0; i < 16; i++) stamp(r() * P | 0, r() * P | 0, 45 + r() * 80, r() * 0.5);
    for (let k = 0; k < al.length; k++) al[k] = clamp(al[k], 0.2, 0.85);
    return { hm, al, P };
  }
  function genEarth() {
    const Wt = 512, Ht = 256, nz = fbm(Wt, Ht, 41, 5, 0.0009, 4, false), cl = fbm(Wt, Ht, 77, 5, 0.0012, 4, false);
    const C = [[48, -100, 30, 20], [-15, -60, 14, 28], [5, 20, 22, 28], [52, 20, 22, 10], [50, 85, 45, 22], [22, 78, 10, 12], [0, 110, 14, 9], [-25, 134, 16, 11], [72, -40, 12, 9], [62, -110, 22, 10]];
    const land = new Float32Array(Wt * Ht);
    for (let y = 0; y < Ht; y++) for (let x = 0; x < Wt; x++) {
      const la = 90 - (y + 0.5) / Ht * 180, lo = (x + 0.5) / Wt * 360 - 180;
      let m = la < -68 ? 1 : -1;
      for (const [a, b, rx, ry] of C) { const dx = Math.min(Math.abs(lo - b), 360 - Math.abs(lo - b)) / rx, dy = (la - a) / ry; m = Math.max(m, 1 - dx * dx - dy * dy); }
      land[y * Wt + x] = m + nz[y * Wt + x] * 1.4;
    }
    return { land, cl, Wt, Ht };
  }

  /* ---------- Renderizado de esferas y suelo (píxel a píxel, con iluminación) ---------- */
  const GR = 1.8, GC = [0, -GR, 0];
  let EARTH_C = "#5ab0f0";
  const siteNow = () => (typeof currentSite === "function" && currentSite()) || { name: "Sitio", lat: 0, lon: 0 };
  function toLocal(latp, lonp, site) {
    const f = site.lat * D2R, d = (lonp - site.lon) * D2R, p = latp * D2R, cp = Math.cos(p);
    return [cp * Math.sin(d), cp * Math.cos(d) * Math.cos(f) + Math.sin(p) * Math.sin(f), -cp * Math.cos(d) * Math.sin(f) + Math.sin(p) * Math.cos(f)];
  }
  const bufs = {};
  function buffer(name, w, h) {
    let b = bufs[name];
    if (!b || b.w !== w || b.h !== h) { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); b = bufs[name] = { c, x, w, h, img: x.createImageData(w, h) }; }
    b.img.data.fill(0);
    return b;
  }

  function drawGlobe(cam, site, L) {
    const T = tex.moon, cq = proj(cam, GC);
    if (!cq) return;
    const sr = GR * cam.focal / Math.sqrt(Math.max(0.01, cq.d - GR * GR));
    const x0 = Math.max(0, Math.floor(cq.x - sr - 3)), x1 = Math.min(W, Math.ceil(cq.x + sr + 3));
    const y0 = Math.max(0, Math.floor(cq.y - sr - 3)), y1 = Math.min(H, Math.ceil(cq.y + sr + 3));
    const qs = quality(), bw = Math.ceil((x1 - x0) / qs), bh = Math.ceil((y1 - y0) / qs);
    if (bw < 2 || bh < 2) return;
    const B = buffer("globe", bw, bh), data = B.img.data;
    const f = site.lat * D2R, cf = Math.cos(f), sf = Math.sin(f), lon0 = site.lon * D2R;
    const O = [cam.P[0] - GC[0], cam.P[1] - GC[1], cam.P[2] - GC[2]], cc = O[0] * O[0] + O[1] * O[1] + O[2] * O[2] - GR * GR;
    const ps = Math.sqrt(cq.d) / cam.focal * qs, Wt = T.Wt, Ht = T.Ht, gE = T.gE, gN = T.gN, al = T.al;
    // Con alturas reales la pendiente ya es física (m/m): se usa tal cual, por la exageración elegida.
    const kN = T.real ? st.exag : 1.5;
    for (let py = 0; py < bh; py++) {
      const b = -((y0 + (py + 0.5) * qs) - H / 2) / cam.focal;
      for (let px = 0; px < bw; px++) {
        const a = ((x0 + (px + 0.5) * qs) - W / 2) / cam.focal;
        let dx = cam.f[0] + cam.r[0] * a + cam.u[0] * b, dy = cam.f[1] + cam.r[1] * a + cam.u[1] * b, dz = cam.f[2] + cam.r[2] * a + cam.u[2] * b;
        const il = 1 / Math.hypot(dx, dy, dz); dx *= il; dy *= il; dz *= il;
        const bb = O[0] * dx + O[1] * dy + O[2] * dz, disc = bb * bb - cc;
        if (disc < 0) continue;
        const t = -bb - Math.sqrt(disc);
        if (t < 0) continue;
        const nx = (O[0] + t * dx) / GR, ny = (O[1] + t * dy) / GR, nzz = (O[2] + t * dz) / GR;
        const pX = ny * cf - nzz * sf, pY = nx, pZ = ny * sf + nzz * cf;
        const lat = Math.asin(clamp(pZ, -1, 1)), lam = Math.atan2(pY, pX), clat = Math.max(0.2, Math.cos(lat));
        let u = ((lam + lon0) / TAU + 0.5) * Wt - 0.5; u = ((u % Wt) + Wt) % Wt;
        const vv = clamp((0.5 - lat / Math.PI) * Ht - 0.5, 0, Ht - 1.001);
        const iu = u | 0, iu1 = (iu + 1) % Wt, iv = vv | 0, tx = u - iu, ty = vv - iv;
        const i00 = iv * Wt + iu, i10 = iv * Wt + iu1, i01 = i00 + Wt, i11 = i10 + Wt;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        const sE = (gE[i00] * w00 + gE[i10] * w10 + gE[i01] * w01 + gE[i11] * w11) / clat;
        const sN = gN[i00] * w00 + gN[i10] * w10 + gN[i01] * w01 + gN[i11] * w11;
        const sl = Math.sin(lam), cl = Math.cos(lam), sp = Math.sin(lat), cp = Math.cos(lat);
        const eX = -sl, eY = cl, nX = -sp * cl, nY = -sp * sl, nZ = cp;
        const ex_ = eY, ey_ = eX * cf, ez_ = -eX * sf;
        const nx_ = nY, ny_ = nX * cf + nZ * sf, nz_ = -nX * sf + nZ * cf;
        let mx = nx - kN * (sE * ex_ + sN * nx_), my = ny - kN * (sE * ey_ + sN * ny_), mz = nzz - kN * (sE * ez_ + sN * nz_);
        const ml = 1 / Math.hypot(mx, my, mz); mx *= ml; my *= ml; mz *= ml;
        const day = clamp((nx * L[0] + ny * L[1] + nzz * L[2] + 0.04) / 0.14, 0, 1);
        const lamb = Math.max(0, mx * L[0] + my * L[1] + mz * L[2]) * day;
        const A = al[i00] * w00 + al[i10] * w10 + al[i01] * w01 + al[i11] * w11, v = A * (0.07 + 1.35 * lamb);
        const o = (py * bw + px) * 4;
        data[o] = clamp(v * 255 * 1.0 + 4, 0, 255); data[o + 1] = clamp(v * 255 * 0.975 + 5, 0, 255); data[o + 2] = clamp(v * 255 * 0.94 + 9, 0, 255);
        data[o + 3] = clamp(disc / (2 * GR * ps), 0, 1) * 255;
      }
    }
    B.x.putImageData(B.img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(B.c, x0, y0, bw * qs, bh * qs);
    const dc = [cam.P[0] - GC[0], cam.P[1] - GC[1], cam.P[2] - GC[2]];
    const mark = (lat, lon, color, label) => {
      const v = toLocal(lat, lon, site);
      if (v[0] * dc[0] + v[1] * dc[1] + v[2] * dc[2] < GR * 1.02) return;
      const q = proj(cam, [GC[0] + GR * v[0], GC[1] + GR * v[1], GC[2] + GR * v[2]]);
      if (!q) return;
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, 7); ctx.fill();
      ctx.fillStyle = "#e8eaf2"; ctx.font = "12px 'Public Sans', system-ui, sans-serif"; ctx.fillText(label, q.x + 8, q.y + 4);
    };
    mark(0, 0, EARTH_C, L10("v3.near", "Near side (faces the Earth)"));
    mark(90, 0, "#c5cbe0", L10("v3.northpole", "North pole")); mark(-90, 0, "#c5cbe0", L10("v3.southpole", "South pole"));
    ctx.fillStyle = "#c5cbe0"; ctx.font = "600 13px 'Public Sans', system-ui, sans-serif"; ctx.fillText(L10("v3.moon", "MOON"), cq.x - 20, Math.min(H - 6, cq.y + sr + 18));
  }

  /* Suelo: plano iluminado. Gran escala = pendientes reales del DEM de LOLA (suavizado y sobremuestreado);
     pequeña escala = microdetalle procedural (cráteres chicos y grano) que rellena lo que el DEM de 118 m
     no resuelve. Sin DEM local (coordenadas personalizadas) se usa solo el relieve ilustrativo. */
  function drawGround(cam, L, LE) {
    const G = tex.groundSite, T = tex.ground, P = T.P, hm = T.hm, al = T.al;
    const gs = quality() + 1, gw = Math.ceil(W / gs), gh = Math.ceil(H / gs), B = buffer("ground", gw, gh), data = B.img.data;
    const hgt = 0.97 * Math.sin(4 * D2R), gain = 1 + 1.6 * (1 - clamp(L[1] * 6, 0, 1));
    const sA = 0.9, sB = 0.22, MASK = P - 1;
    const kReal = st.exag, A0 = G ? G.albedo : 0.55, wDet = G ? 0.55 : 1;
    const M = G ? G.M : 0, E = G ? G.extent : 0, pxm = G ? G.pxm : 1, sxA = G ? G.sx : null, szA = G ? G.sz : null;
    const SMAX = 0.9;   // pendiente máxima mostrada (~42°): evita paredes verticales al exagerar
    for (let py = 0; py < gh; py++) {
      const b = -((py * gs + gs / 2) - H / 2) / cam.focal;
      for (let px = 0; px < gw; px++) {
        const a = ((px * gs + gs / 2) - W / 2) / cam.focal;
        const dx = cam.f[0] + cam.r[0] * a + cam.u[0] * b, dy = cam.f[1] + cam.r[1] * a + cam.u[1] * b, dz = cam.f[2] + cam.r[2] * a + cam.u[2] * b;
        if (dy > -1e-4) continue;
        const s = -hgt / dy, xw = s * dx, zw = s * dz, dist = s * Math.hypot(dx, dy, dz);
        const fA = clamp(1.25 - dist / 1.4, 0, 1), fB = clamp(1 - dist / 0.55, 0, 1);
        // --- gran escala: DEM real con interpolación bilineal
        let sx = 0, sz = 0;
        if (G) {
          const fi = (xw * M_PER_UNIT + E) / pxm - 0.5, fj = (E - zw * M_PER_UNIT) / pxm - 0.5;
          if (fi >= 1 && fi < M - 2 && fj >= 1 && fj < M - 2) {
            const i0 = fi | 0, j0 = fj | 0, tx = fi - i0, ty = fj - j0, r = j0 * M + i0;
            const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
            sx = (sxA[r] * w00 + sxA[r + 1] * w10 + sxA[r + M] * w01 + sxA[r + M + 1] * w11) * kReal;
            sz = (szA[r] * w00 + szA[r + 1] * w10 + szA[r + M] * w01 + szA[r + M + 1] * w11) * kReal;
            const m = Math.hypot(sx, sz);
            if (m > 1e-6) { const c = Math.tanh(m / SMAX) * SMAX / m; sx *= c; sz *= c; }
          }
          sx *= fA; sz *= fA;
        }
        // --- pequeña escala: textura procedural en dos octavas
        const uA = ((xw / sA * P) | 0) & MASK, vA = ((zw / sA * P) | 0) & MASK, uB = ((xw / sB * P + 317) | 0) & MASK, vB = ((zw / sB * P + 611) | 0) & MASK;
        const iA = vA * P + uA, iB = vB * P + uB;
        const hx = fA * (hm[vA * P + ((uA + 1) & MASK)] - hm[vA * P + ((uA - 1) & MASK)]) * 0.5 + 0.8 * fB * (hm[vB * P + ((uB + 1) & MASK)] - hm[vB * P + ((uB - 1) & MASK)]) * 0.5;
        const hz = fA * (hm[((vA + 1) & MASK) * P + uA] - hm[((vA - 1) & MASK) * P + uA]) * 0.5 + 0.8 * fB * (hm[((vB + 1) & MASK) * P + uB] - hm[((vB - 1) & MASK) * P + uB]) * 0.5;
        const tx_ = sx + wDet * hx, tz_ = sz + wDet * hz;
        const il = 1 / Math.hypot(tx_, 1, tz_);
        const lamb = Math.max(0, (-tx_ * L[0] + L[1] - tz_ * L[2]) * il);
        const earthS = LE ? LE.k * Math.max(0, (-tx_ * LE.d[0] + LE.d[1] - tz_ * LE.d[2]) * il) : 0;
        const alb = A0 * 0.8 + (al[iA] - 0.5) * 0.5 * fA + (al[iB] - 0.5) * 0.35 * fB + 0.2 * A0;
        const v = alb * (0.05 + 0.95 * gain * lamb + earthS) * (0.4 + 0.6 * fA), o = (py * gw + px) * 4;   // lejos se atenúa para fundirse con el horizonte
        data[o] = clamp(v * 255 + 3, 0, 255); data[o + 1] = clamp(v * 250 + 4, 0, 255); data[o + 2] = clamp(v * 240 + 8, 0, 255); data[o + 3] = 255;
      }
    }
    B.x.putImageData(B.img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(B.c, 0, 0, W, H);
  }

  function sunSprite(cam, p, rw, vis) {
    const q = proj(cam, p);
    if (!q) return;
    const r = Math.max(8, rw * cam.focal / q.z);
    ctx.save(); ctx.globalAlpha = vis ? 1 : 0.4;
    let g = ctx.createRadialGradient(q.x, q.y, r * 0.7, q.x, q.y, r * 7);
    g.addColorStop(0, "rgba(255,226,150,.6)"); g.addColorStop(0.25, "rgba(255,190,90,.2)"); g.addColorStop(1, "rgba(255,170,60,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q.x, q.y, r * 7, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(255,240,200,.28)"; ctx.lineWidth = 1.3;
    for (const [ux, uy] of [[1, 0], [0, 1], [0.7, 0.7], [0.7, -0.7]]) { ctx.beginPath(); ctx.moveTo(q.x - ux * r * 4.5, q.y - uy * r * 4.5); ctx.lineTo(q.x + ux * r * 4.5, q.y + uy * r * 4.5); ctx.stroke(); }
    g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, r);
    g.addColorStop(0, "#fffef5"); g.addColorStop(0.65, "#ffeeb0"); g.addColorStop(0.92, "#ffc860"); g.addColorStop(1, "#ff9c30");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, 7); ctx.fill();
    if (!vis) { ctx.setLineDash([4, 4]); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(q.x, q.y, r + 4, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = "#e8eaf2"; ctx.font = "600 13px 'Public Sans', system-ui, sans-serif"; ctx.fillText(vis ? L10("v3.sun", "Sun") : L10("v3.sun.hidden", "Sun (hidden)"), q.x + r + 8, q.y + 4);
    ctx.restore();
  }

  function earthSprite(cam, p, rw, L, spin, vis) {
    const T = tex.earth, q = proj(cam, p);
    if (!q) return;
    const r = clamp(Math.round(rw * cam.focal / q.z), 7, 90), n = r * 2 + 6, c = n / 2;
    const B = buffer("earth", n, n), data = B.img.data;
    const nv = norm([cam.P[0] - p[0], cam.P[1] - p[1], cam.P[2] - p[2]]);
    const hv = norm([L[0] + nv[0], L[1] + nv[1], L[2] + nv[2]]);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = (i + 0.5 - c) / r, y = -(j + 0.5 - c) / r, rr = x * x + y * y;
      if (rr > 1.04) continue;
      const nzv = Math.sqrt(Math.max(0, 1 - rr)), al = clamp((1 - Math.sqrt(rr)) * r, 0, 1);
      const wx = x * cam.r[0] + y * cam.u[0] + nzv * nv[0], wy = x * cam.r[1] + y * cam.u[1] + nzv * nv[1], wz = x * cam.r[2] + y * cam.u[2] + nzv * nv[2];
      const lat = Math.asin(clamp(y, -1, 1)), lon = Math.atan2(x, nzv) + spin;
      let u = (lon / TAU + 0.5) * T.Wt; u = ((u % T.Wt) + T.Wt) % T.Wt;
      const idx = clamp(((0.5 - lat / Math.PI) * T.Ht) | 0, 0, T.Ht - 1) * T.Wt + (u | 0);
      const land = T.land[idx] > 0.15, ice = Math.abs(lat) > 1.25 && land || Math.abs(lat) > 1.38, cloud = clamp(T.cl[idx] * 2.4 + 0.1, 0, 1);
      let R, G, Bc;
      if (ice) { R = 235; G = 240; Bc = 245; }
      else if (land) { const dry = clamp(1 - Math.abs(lat) * 1.1 + T.land[idx] * 0.3, 0, 1) * (Math.abs(lat) < 0.7 ? 1 : 0.4); R = 70 + 90 * dry; G = 105 + 30 * dry; Bc = 50 + 20 * dry; }
      else { R = 10; G = 45; Bc = 115; }
      R += (245 - R) * cloud * 0.85; G += (246 - G) * cloud * 0.85; Bc += (250 - Bc) * cloud * 0.85;
      const nl = wx * L[0] + wy * L[1] + wz * L[2], lit = clamp((nl + 0.05) / 0.2, 0, 1) * Math.max(0, nl) + 0.025;
      const spec = (!land && !ice && cloud < 0.3) ? Math.pow(Math.max(0, wx * hv[0] + wy * hv[1] + wz * hv[2]), 70) * 0.6 : 0;
      const rim = Math.pow(1 - nzv, 3) * (0.2 + Math.max(0, nl));
      const o = (j * n + i) * 4;
      data[o] = clamp(R * lit + 255 * spec + 60 * rim, 0, 255); data[o + 1] = clamp(G * lit + 255 * spec + 120 * rim, 0, 255); data[o + 2] = clamp(Bc * lit + 255 * spec + 255 * rim, 0, 255); data[o + 3] = al * 255;
    }
    B.x.putImageData(B.img, 0, 0);
    ctx.save(); ctx.globalAlpha = vis ? 1 : 0.4;
    const g = ctx.createRadialGradient(q.x, q.y, r * 0.95, q.x, q.y, r * 1.5);
    g.addColorStop(0, "rgba(110,170,255,.3)"); g.addColorStop(1, "rgba(110,170,255,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q.x, q.y, r * 1.5, 0, 7); ctx.fill();
    ctx.drawImage(B.c, q.x - c, q.y - c);
    if (!vis) { ctx.setLineDash([4, 4]); ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(q.x, q.y, r + 4, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
    ctx.fillStyle = "#e8eaf2"; ctx.font = "600 13px 'Public Sans', system-ui, sans-serif"; ctx.fillText(vis ? L10("v3.earth", "Earth") : L10("v3.earth.hidden", "Earth (hidden)"), q.x + r + 8, q.y + 4);
    ctx.restore();
  }

  const STARS = (() => { const r = rng(99), o = []; for (let i = 0; i < 320; i++) o.push([r() * 360, Math.asin(r() * 2 - 1) / D2R, 0.25 + r() * r() * 0.75]); return o; })();

  /* ---------- Escena ---------- */
  function message(txt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#05070d"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#9aa3bd"; ctx.font = "14px 'Public Sans', system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText(txt, W / 2, H / 2); ctx.textAlign = "left";
  }
  function render3D() {
    if (st.mode === "2d" || !ctx || !S.eph || !S.hor) return;
    const orbit = st.mode === "orbit";
    if (real.state === "idle") loadReal();
    if (real.state === "loading") { message(L10("v3.loading.relief", "Loading LOLA relief (NASA)…")); return; }
    if (!orbit) {
      const g = groundFor(siteNow());
      if (g === "loading") { message(L10("v3.loading.ground", "Loading the site’s LOLA terrain…")); return; }
      tex.groundSite = g;
    }
    if (!tex.earth || (orbit && !tex.moon) || (!orbit && !tex.ground)) {
      message(L10("v3.loading.gen", "Generating the Moon’s relief…"));
      if (!loading) { loading = true; setTimeout(() => { if (!tex.earth) tex.earth = genEarth(); if (st.mode === "orbit" && !tex.moon) tex.moon = genMoon(); if (st.mode === "first" && !tex.ground) tex.ground = genGround(); loading = false; draw3D(); }, 30); }
      return;
    }
    const cam = camera(), site = siteNow(), i = S.i, e = S.eph;
    const css = getComputedStyle(document.documentElement);
    const SUN = css.getPropertyValue("--sun").trim() || "#f4b942", EARTH = EARTH_C = css.getPropertyValue("--earth").trim() || "#5ab0f0";
    const sa = e.sun.az[i], se = e.sun.el[i], ea = e.earth.az[i], ee = e.earth.el[i], L = dirv(sa, se, 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#04060b"; ctx.fillRect(0, 0, W, H);
    for (const [a, el, br] of STARS) {
      const d = dirv(a, el, 60), q = proj(cam, [cam.P[0] + d[0], cam.P[1] + d[1], cam.P[2] + d[2]]);
      if (q) { ctx.fillStyle = `rgba(255,255,255,${br})`; ctx.fillRect(q.x, q.y, br > 0.7 ? 1.6 : 1, br > 0.7 ? 1.6 : 1); }
    }
    if (orbit) {
      drawGlobe(cam, site, L);
      const disc = []; for (let a = 0; a <= 360; a += 5) disc.push(dirv(a, 0, 1));
      path3d(cam, disc, true); ctx.fillStyle = "rgba(60,64,82,.35)"; ctx.fill();
    } else drawGround(cam, L, ee > horizonAt(ea) ? { d: dirv(ea, ee, 1), k: 0.11 } : null);   // luz terrestre tenue

    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(150,160,200,.14)";
    for (const el of [30, 60]) { const ring = []; for (let a = 0; a <= 360; a += 5) ring.push(dirv(a, el, 1)); path3d(cam, ring); ctx.stroke(); }
    for (let a = 0; a < 360; a += 45) { const mer = []; for (let el = 0; el <= 90; el += 6) mer.push(dirv(a, el, 1)); path3d(cam, mer); ctx.stroke(); }
    const hz = []; for (let a = 0; a <= 360; a += 3) hz.push(dirv(a, 0, 1));
    path3d(cam, hz); ctx.strokeStyle = "rgba(190,200,235,.35)"; ctx.stroke();

    const items = [], el0 = S.hor.el, n = el0.length, step = S.hor.az_step_deg, R = 0.97, baseEl = orbit ? -10 : -2.5;
    // Perfil suavizado (media ponderada de 5 puntos): quita los dientes de sierra del DEM sin cambiar la forma.
    const elS = new Float32Array(n), hS = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      let sum = 0, wsum = 0;
      for (let d = -2; d <= 2; d++) { const w = 3 - Math.abs(d); sum += el0[(k + d + n) % n] * w; wsum += w; }
      elS[k] = sum / wsum; hS[k] = ex(elS[k]);
    }
    const sunLow = 1 + 1.2 * (1 - clamp(L[1] * 6, 0, 1));
    const ridge = [];
    for (let k = 0; k < n; k++) {
      const a0 = k * step, a1 = (k + 1) * step, h0 = hS[k], h1 = hS[(k + 1) % n];
      const q0 = proj(cam, dirv(a0, h0, R)), q1 = proj(cam, dirv(a1, h1, R)), q2 = proj(cam, dirv(a1, baseEl, R)), q3 = proj(cam, dirv(a0, baseEl, R));
      ridge.push(q0);
      if (!q0 || !q1 || !q2 || !q3) continue;
      // Iluminación: cara que mira al Sol + inclinación local de la cresta (da volumen a las laderas).
      const am = (a0 + a1) / 2 * D2R, dd = dirv(am / D2R, 0, 1), tg = [Math.cos(am), 0, -Math.sin(am)];
      const facing = (orbit ? 1 : -1) * (dd[0] * L[0] + dd[1] * L[1] + dd[2] * L[2]);
      const slope = Math.tanh((elS[(k + 1) % n] - elS[(k + n - 1) % n]) * 0.25), tl = tg[0] * L[0] + tg[1] * L[1] + tg[2] * L[2];
      const lit = clamp(0.1 + 0.75 * facing - 0.5 * slope * tl, 0, 1);
      const lum = clamp(13 + 40 * lit * sunLow * 0.7 + Math.min(8, Math.max(0, elS[k]) * 0.8), 8, 68);
      const aTop = orbit ? 0.93 : 1, aBot = orbit ? 0.22 : 0.0;
      items.push({ d: 0.9409, f() {
        const yT = Math.min(q0.y, q1.y), yB = Math.max(q2.y, q3.y), g = ctx.createLinearGradient(0, yT, 0, Math.max(yT + 1, yB));
        g.addColorStop(0, `hsla(222,7%,${lum.toFixed(0)}%,${aTop})`); g.addColorStop(1, `hsla(222,6%,${(lum * 0.42).toFixed(0)}%,${aBot})`);
        ctx.beginPath(); ctx.moveTo(q0.x - 0.4, q0.y); ctx.lineTo(q1.x + 0.6, q1.y); ctx.lineTo(q2.x + 0.6, q2.y); ctx.lineTo(q3.x - 0.4, q3.y); ctx.closePath();
        ctx.fillStyle = g; ctx.fill();   // sin trazo: el trazo con degradado dibujaba rayitas entre columnas
      } });
    }
    items.push({ d: 0.9408, f() {          // línea de cresta: marca la silueta del horizonte
      ctx.beginPath(); let pen = false;
      for (const q of ridge) { if (!q) { pen = false; continue; } if (pen) ctx.lineTo(q.x, q.y); else { ctx.moveTo(q.x, q.y); pen = true; } }
      ctx.strokeStyle = "rgba(205,214,238,.5)"; ctx.lineWidth = 1.2; ctx.stroke();
    } });
    const tr = trajectories();
    // Desde fuera, los astros se colocan lejos, alrededor del centro de la Luna; la dirección es la misma que ve el sitio.
    const place = (v, r) => orbit ? [GC[0] + v[0] * r, GC[1] + v[1] * r, GC[2] + v[2] * r] : v;
    // ¿La Luna tapa este punto desde la cámara? (solo aplica en la vista desde fuera)
    const hidden = p => {
      if (!orbit) return false;
      const dx = p[0] - cam.P[0], dy = p[1] - cam.P[1], dz = p[2] - cam.P[2], l2 = dx * dx + dy * dy + dz * dz;
      const t = clamp(((GC[0] - cam.P[0]) * dx + (GC[1] - cam.P[1]) * dy + (GC[2] - cam.P[2]) * dz) / l2, 0, 1);
      return Math.hypot(cam.P[0] + t * dx - GC[0], cam.P[1] + t * dy - GC[1], cam.P[2] + t * dz - GC[2]) < GR * 0.98 && t < 1;
    };
    for (const [list, color, rr] of [[tr.sun, SUN, ORB_SUN], [tr.earth, EARTH, ORB_EARTH]]) for (const p0 of list) {
      const p = place(p0, rr), q = proj(cam, p);
      if (q && !hidden(p)) items.push({ d: q.d, f() { ctx.globalAlpha = 0.45; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(q.x, q.y, 1.7, 0, 7); ctx.fill(); ctx.globalAlpha = 1; } });
    }
    const sp = place(dirv(sa, ex(se), 1), ORB_SUN), ep = place(dirv(ea, ex(ee), 1), ORB_EARTH), sq = proj(cam, sp), eq = proj(cam, ep);
    const sunVis = se > horizonAt(sa), earthVis = ee > horizonAt(ea);
    const spin = -(Date.parse(e.t[i]) / 3.6e6) * 15 * D2R;
    const sunW = orbit ? 0.34 : 0.055, earthW = orbit ? 0.22 : 0.04, sunHid = hidden(sp), earthHid = hidden(ep);
    if (orbit && sq && !sunHid) {         // rayo de luz: del sitio al Sol
      const o = proj(cam, [0, 0, 0]);
      if (o) items.push({ d: 0.5, f() { ctx.save(); ctx.setLineDash([5, 6]); ctx.strokeStyle = sunVis ? "rgba(255,210,120,.55)" : "rgba(255,210,120,.2)"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(sq.x, sq.y); ctx.stroke(); ctx.restore(); } });
    }
    if (sq && sunVis && !sunHid) items.push({ d: sq.d - 0.02, f() { sunSprite(cam, sp, sunW, true); } });
    if (eq && earthVis && !earthHid) items.push({ d: eq.d - 0.02, f() { earthSprite(cam, ep, earthW, L, spin, true); } });
    items.sort((a, b) => b.d - a.d);
    for (const it of items) it.f();
    if (!sunVis && !sunHid) sunSprite(cam, sp, sunW, false);
    if (!earthVis && !earthHid) earthSprite(cam, ep, earthW, L, spin, false);

    ctx.font = "600 14px 'Public Sans', system-ui, sans-serif"; ctx.textAlign = "center";
    for (const [name, a] of [["N", 0], ["E", 90], ["S", 180], ["O", 270]]) {
      const q = proj(cam, dirv(a, 0, orbit ? 1.08 : 1));
      if (q) { ctx.fillStyle = a === 0 ? "#ef7b6b" : "#c5cbe0"; ctx.fillText(name, q.x, q.y - 6); }
    }
    ctx.textAlign = "left";
    if (orbit) {
      const b = proj(cam, [0, 0, 0]), t = proj(cam, [0, 0.16, 0]);
      if (b && t) {
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
        ctx.fillStyle = "#ef7b6b"; ctx.beginPath(); ctx.arc(t.x, t.y, 5, 0, 7); ctx.fill();
        ctx.fillStyle = "#e8eaf2"; ctx.font = "600 13px 'Public Sans', system-ui, sans-serif"; ctx.fillText(L10("v3.here", "You are here: {name}", { name: I18N.siteName(site) }), t.x + 10, t.y + 4);
      }
    }
    ctx.fillStyle = "#9aa3bd"; ctx.font = "12px 'Public Sans', system-ui, sans-serif";
    ctx.fillText((st.exag === 1 ? L10("v3.heights.real", "True heights") : L10("v3.heights.exag", "Exaggerated heights ×{k}", { k: st.exag })) + " · " + I18N.siteName(site) + " (" + (+site.lat).toFixed(2) + "°, " + (+site.lon).toFixed(2) + "°)", 12, 20);
    const relief = orbit
      ? (tex.moon && tex.moon.real ? L10("v3.relief.moon", "Relief: LOLA (NASA LRO) · tone: Clementine 750 nm") : L10("v3.relief.moon.fake", "Illustrative globe relief (LOLA data not loaded)"))
      : (tex.groundSite ? L10("v3.relief.ground", "Ground: {src} · ±8 km + illustrative micro-detail · view from ~300 m", { src: tex.groundSite.source }) : L10("v3.relief.ground.fake", "Illustrative ground: no local LOLA data for this point"));
    ctx.fillStyle = tex.groundSite || (orbit && tex.moon && tex.moon.real) ? "#7fd8b0" : "#f5d98f";
    ctx.fillText(relief, 12, 38);
    const notes = [];
    if (orbit && sunHid) notes.push(L10("v3.note.behind", "The Sun is behind the Moon from this camera: press “Side view” or rotate the view."));
    if (!sunVis) notes.push(L10("v3.note.night", "It is night here: the Sun is below the horizon (shown translucent)."));
    if (!orbit && st.follow && !sunVis) notes.push(L10("v3.note.aim", "The camera points to where the Sun would rise (it is now below the horizon)."));
    if (tr.earthFixed) notes.push(L10("v3.note.earth", "The Earth barely moves in the lunar sky: that is normal, the Moon always shows the same face."));
    ctx.fillStyle = "#f5d98f";
    notes.forEach((t, k) => ctx.fillText(t, 12, H - 12 - 18 * (notes.length - 1 - k)));
  }

  /* Un solo dibujo por fotograma, aunque lleguen muchas peticiones (arrastre, rueda, reproducción).
     Mientras se interactúa o se reproduce, el globo y el suelo se calculan a menor resolución; al parar, se redibujan nítidos. */
  let raf = 0, lowTimer = 0, settleTimer = 0;
  const quality = () => (st.lowq || S.timer) ? 2 : 1;
  function draw3D() {
    if (st.mode === "2d" || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; render3D(); });
  }
  function interact() {
    st.lowq = true; clearTimeout(lowTimer);
    lowTimer = setTimeout(() => { st.lowq = false; draw3D(); }, 160);
  }

  /* ---------- Modos, tamaño e interacción ---------- */
  function fit() {
    W = Math.max(300, Math.round(canvas.getBoundingClientRect().width || 600));
    H = Math.round(clamp(W * 0.5, 320, 500));
    dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr; canvas.height = H * dpr; canvas.style.height = H + "px";
    ctx = canvas.getContext("2d");
  }
  function resetView() {
    st.orbit = { yaw: (S.eph ? S.eph.sun.az[S.i] : 180) * D2R + Math.PI / 2, pitch: 0.35, dist: DIST_NEAR };   // de lado: la luz cruza la Luna
    updateZoomBtn();
    st.first = { yaw: (S.eph ? S.eph.sun.az[S.i] : 0) * D2R, off: 0, poff: 0, pitch: 0.08, fov: 85 };
  }
  function setMode(m) {
    st.mode = m;
    bar.querySelectorAll(".vtab").forEach(b => b.classList.toggle("on", b.dataset.mode === m));
    const is3d = m !== "2d";
    chart.style.display = is3d ? "none" : ""; stage.style.display = is3d ? "block" : "none";
    hint.style.display = is3d ? "block" : "none"; exagBox.style.display = is3d ? "flex" : "none";
    followBox.style.display = m === "first" ? "flex" : "none";
    over.style.display = m === "orbit" ? "flex" : "none";
    zBox.style.display = "flex";
    if (is3d) { resetView(); fit(); draw3D(); }
    savePrefs();
  }
  bar.addEventListener("click", ev => { const b = ev.target.closest(".vtab"); if (b) setMode(b.dataset.mode); });
  bar.querySelector("#vfollow").addEventListener("change", ev => {
    if (!ev.target.checked) { st.first.yaw = effYaw(); st.first.pitch = effPitch(); }   // al soltar al Sol, la cámara se queda donde está
    else { st.first.off = 0; st.first.poff = 0; }
    st.follow = ev.target.checked; savePrefs(); draw3D();
  });
  bar.querySelector("#vexag").addEventListener("change", ev => { st.exag = +ev.target.value; st.cache = null; savePrefs(); draw3D(); });
  window.addEventListener("resize", () => { if (st.mode !== "2d") { fit(); draw3D(); } });
  /* Al cambiar de idioma: el botón de zoom cambia de texto según la distancia, y el lienzo se vuelve a dibujar. */
  I18N.onChange(() => { updateZoomBtn(); if (st.mode !== "2d") draw3D(); });

  let drag = null;
  canvas.addEventListener("pointerdown", ev => { drag = { x: ev.clientX, y: ev.clientY }; canvas.setPointerCapture(ev.pointerId); });
  canvas.addEventListener("pointerup", () => { drag = null; });
  canvas.addEventListener("pointercancel", () => { drag = null; });
  canvas.addEventListener("pointermove", ev => {
    if (!drag) return;
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    drag = { x: ev.clientX, y: ev.clientY };
    interact();
    if (st.mode === "orbit") { st.orbit.yaw += dx * 0.008; st.orbit.pitch = clamp(st.orbit.pitch + dy * 0.006, 0.02, 1.45); }
    else {
      const k = st.first.fov / 75;
      if (st.follow) { st.first.off -= dx * 0.006 * k; st.first.poff = clamp(st.first.poff + dy * 0.005 * k, -1, 1); }
      else { st.first.yaw -= dx * 0.006 * k; st.first.pitch = clamp(st.first.pitch + dy * 0.005 * k, -0.45, 1.45); }
    }
    draw3D();
  });
  canvas.addEventListener("wheel", ev => {
    ev.preventDefault();
    interact();
    if (st.mode === "orbit") { st.orbit.dist = clamp(st.orbit.dist * (1 + ev.deltaY * 0.001), DIST_MIN, DIST_MAX); updateZoomBtn(); }
    else st.first.fov = clamp(st.first.fov * (1 + ev.deltaY * 0.001), 30, 100);
    draw3D();
  }, { passive: false });
  canvas.addEventListener("dblclick", () => { resetView(); draw3D(); });
  const setDist = d => { st.orbit.dist = clamp(d, DIST_MIN, DIST_MAX); updateZoomBtn(); interact(); draw3D(); };
  const toggleZoom = () => setDist(st.orbit.dist >= (DIST_NEAR + DIST_FAR) / 2 ? DIST_NEAR : DIST_FAR);
  const sideView = () => { st.orbit.yaw = (S.eph ? S.eph.sun.az[S.i] : 180) * D2R + Math.PI / 2; st.orbit.pitch = 0.35; draw3D(); };
  zoomBtn.addEventListener("click", toggleZoom);
  sideBtn.addEventListener("click", sideView);
  zr.addEventListener("input", () => setDist(+zr.value));
  zr.addEventListener("change", () => zr.blur());   // para que los atajos de teclado sigan funcionando
  // Atajos para clicar menos: 1/2/3 cambian de vista y Z aleja/acerca (no actúan al escribir en un campo).
  document.addEventListener("keydown", ev => {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const tag = ev.target && ev.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (ev.key === "1") setMode("2d");
    else if (ev.key === "2") setMode("orbit");
    else if (ev.key === "3") setMode("first");
    else if ((ev.key === "z" || ev.key === "Z") && st.mode === "orbit") toggleZoom();
    else if ((ev.key === "v" || ev.key === "V") && st.mode === "orbit") sideView();
    else if ((ev.key === "+" || ev.key === "=") && st.mode === "orbit") setDist(st.orbit.dist / 1.2);
    else if ((ev.key === "-" || ev.key === "_") && st.mode === "orbit") setDist(st.orbit.dist * 1.2);
  });

  /* ---------- Enganche con index.html (sin modificarlo) ---------- */
  if (typeof window.updateNow === "function") {
    const orig = window.updateNow;
    window.updateNow = function () {
      orig.apply(this, arguments);
      clearTimeout(settleTimer); settleTimer = setTimeout(() => { if (!S.timer) draw3D(); }, 200);   // al pausar, redibuja nítido
      if (!st.inited && S.eph) { st.inited = true; if (st.mode !== "2d") resetView(); }   // primera carga: orientar hacia el Sol
      draw3D();
    };
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => draw3D());
  if (SAVED.mode === "orbit" || SAVED.mode === "first") setMode(SAVED.mode);   // recuerda la última vista usada
  if (typeof window.drawChart === "function") { const orig = window.drawChart; window.drawChart = function () { orig.apply(this, arguments); st.cache = null; }; }
})();
