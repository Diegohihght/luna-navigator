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
  const chart = document.getElementById("chart");
  if (!chart || typeof S === "undefined") return;

  const D2R = Math.PI / 180, TAU = Math.PI * 2;
  const st = {
    mode: "2d", exag: 1, cache: null, follow: true,
    orbit: { yaw: Math.PI + 0.55, pitch: 0.5, dist: 4.6 },
    first: { yaw: 0, off: 0, pitch: 0.08, fov: 85 }
  };
  let canvas, ctx, W = 600, H = 360, dpr = 1;

  /* ---------- Estilos y elementos ---------- */
  const style = document.createElement("style");
  style.textContent = `
    .viewbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:4px 0 12px}
    .vtab{background:var(--panel2);color:var(--text);border:1px solid var(--line);border-radius:99px;padding:6px 14px;font-size:13px;cursor:pointer}
    .vtab:hover{filter:brightness(1.12)}
    .vtab.on{background:var(--accent);color:#1b1630;border-color:var(--accent);font-weight:650}
    .vexag{display:none;align-items:center;gap:8px;margin-left:auto;font-size:13px;color:var(--muted)}
    .vexag select{width:auto;padding:5px 8px}
    .vfollow{margin-left:0;cursor:pointer}.vfollow input{width:auto}
    #view3d{display:none;width:100%;border-radius:8px;cursor:grab;touch-action:none;background:#05070d}
    #view3d:active{cursor:grabbing}
    .vhint{display:none;color:var(--muted);font-size:13px;margin:8px 0 0}`;
  document.head.appendChild(style);
  const bar = document.createElement("div");
  bar.className = "viewbar";
  bar.innerHTML =
    '<button class="vtab on" data-mode="2d">Panorámica 2D</button>' +
    '<button class="vtab" data-mode="orbit">3D desde fuera</button>' +
    '<button class="vtab" data-mode="first">3D desde el sitio</button>' +
    '<label class="vexag vfollow"><input type="checkbox" id="vfollow" checked> La cámara sigue al Sol</label>' +
    '<label class="vexag">Exagerar alturas <select id="vexag"><option value="1" selected>×1 (real)</option><option value="3">×3</option><option value="6">×6</option><option value="10">×10</option></select></label>';
  canvas = document.createElement("canvas");
  canvas.id = "view3d";
  const hint = document.createElement("p");
  hint.className = "vhint";
  hint.textContent = "Arrastra para girar · rueda del ratón para acercar o alejar · doble clic para reiniciar. Relieve: altímetro LOLA de la sonda LRO (NASA); tono de la Luna: mosaico Clementine 750 nm. Se ilumina con la posición real del Sol; las alturas se pueden exagerar y los astros se dibujan más grandes que en la realidad para que se vean.";
  chart.parentNode.insertBefore(bar, chart);
  chart.parentNode.insertBefore(canvas, chart.nextSibling);
  canvas.parentNode.insertBefore(hint, canvas.nextSibling);
  const exagBox = bar.querySelector(".vexag:not(.vfollow)"), followBox = bar.querySelector(".vfollow");

  /* ---------- Matemática 3D ---------- */
  const dirv = (az, el, r) => { const a = az * D2R, e = el * D2R, c = Math.cos(e); return [r * c * Math.sin(a), r * Math.sin(e), r * c * Math.cos(a)]; };
  const ex = el => Math.max(-90, Math.min(89, el * st.exag));
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sm = t => t * t * (3 - 2 * t);
  const effYaw = () => st.follow && S.eph ? S.eph.sun.az[S.i] * D2R + st.first.off : st.first.yaw;

  function camera() {
    let P, f, focal;
    if (st.mode === "orbit") {
      const o = st.orbit, T = [0, -0.6, 0], cp = Math.cos(o.pitch);
      P = [T[0] + o.dist * Math.sin(o.yaw) * cp, T[1] + o.dist * Math.sin(o.pitch), T[2] + o.dist * Math.cos(o.yaw) * cp];
      f = norm([T[0] - P[0], T[1] - P[1], T[2] - P[2]]);
      focal = (H / 2) / Math.tan(20 * D2R);
    } else {
      const q = st.first, cp = Math.cos(q.pitch), yaw = effYaw();
      P = [0, 0, 0];
      f = [Math.sin(yaw) * cp, Math.sin(q.pitch), Math.cos(yaw) * cp];
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
      tex.moon = { hm, al, Wt: g.w, Ht: g.h, real: true };
      real.state = "ready";
    } catch (err) {
      console.warn("Relieve LOLA no disponible; uso relieve ilustrativo.", err);
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
        real.ground[key] = { hm: Float32Array.from(h16), n: G.n, extent: G.extent_m, albedo, source: info.source };
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
    return { hm, al, Wt, Ht };
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
    const bw = x1 - x0, bh = y1 - y0;
    if (bw < 2 || bh < 2) return;
    const B = buffer("globe", bw, bh), data = B.img.data;
    const f = site.lat * D2R, cf = Math.cos(f), sf = Math.sin(f), lon0 = site.lon * D2R;
    const O = [cam.P[0] - GC[0], cam.P[1] - GC[1], cam.P[2] - GC[2]], cc = O[0] * O[0] + O[1] * O[1] + O[2] * O[2] - GR * GR;
    const ps = Math.sqrt(cq.d) / cam.focal, Wt = T.Wt, Ht = T.Ht, hm = T.hm, al = T.al;
    // Con alturas reales la pendiente ya es física (m/m): se usa tal cual, por la exageración elegida.
    const kN = T.real ? st.exag : 1.5;
    for (let py = 0; py < bh; py++) {
      const b = -((y0 + py + 0.5) - H / 2) / cam.focal;
      for (let px = 0; px < bw; px++) {
        const a = ((x0 + px + 0.5) - W / 2) / cam.focal;
        let dx = cam.f[0] + cam.r[0] * a + cam.u[0] * b, dy = cam.f[1] + cam.r[1] * a + cam.u[1] * b, dz = cam.f[2] + cam.r[2] * a + cam.u[2] * b;
        const il = 1 / Math.hypot(dx, dy, dz); dx *= il; dy *= il; dz *= il;
        const bb = O[0] * dx + O[1] * dy + O[2] * dz, disc = bb * bb - cc;
        if (disc < 0) continue;
        const t = -bb - Math.sqrt(disc);
        if (t < 0) continue;
        const nx = (O[0] + t * dx) / GR, ny = (O[1] + t * dy) / GR, nzz = (O[2] + t * dz) / GR;
        const pX = ny * cf - nzz * sf, pY = nx, pZ = ny * sf + nzz * cf;
        const lat = Math.asin(clamp(pZ, -1, 1)), lam = Math.atan2(pY, pX), clat = Math.max(0.2, Math.cos(lat));
        let u = ((lam + lon0) / TAU + 0.5) * Wt; u = ((u % Wt) + Wt) % Wt;
        const iu = u | 0, iv = clamp(((0.5 - lat / Math.PI) * Ht) | 0, 0, Ht - 1), idx = iv * Wt + iu;
        const sE = (hm[iv * Wt + (iu + 1) % Wt] - hm[iv * Wt + (iu + Wt - 1) % Wt]) * 0.5 / clat;
        const sN = (hm[Math.max(0, iv - 1) * Wt + iu] - hm[Math.min(Ht - 1, iv + 1) * Wt + iu]) * 0.5;
        const sl = Math.sin(lam), cl = Math.cos(lam), sp = Math.sin(lat), cp = Math.cos(lat);
        const eX = -sl, eY = cl, nX = -sp * cl, nY = -sp * sl, nZ = cp;
        const ex_ = eY, ey_ = eX * cf, ez_ = -eX * sf;
        const nx_ = nY, ny_ = nX * cf + nZ * sf, nz_ = -nX * sf + nZ * cf;
        let mx = nx - kN * (sE * ex_ + sN * nx_), my = ny - kN * (sE * ey_ + sN * ny_), mz = nzz - kN * (sE * ez_ + sN * nz_);
        const ml = 1 / Math.hypot(mx, my, mz); mx *= ml; my *= ml; mz *= ml;
        const day = clamp((nx * L[0] + ny * L[1] + nzz * L[2] + 0.04) / 0.14, 0, 1);
        const lamb = Math.max(0, mx * L[0] + my * L[1] + mz * L[2]) * day;
        const A = al[idx], v = A * (0.07 + 1.35 * lamb);
        const o = (py * bw + px) * 4;
        data[o] = clamp(v * 255 * 1.0 + 4, 0, 255); data[o + 1] = clamp(v * 255 * 0.975 + 5, 0, 255); data[o + 2] = clamp(v * 255 * 0.94 + 9, 0, 255);
        data[o + 3] = clamp(disc / (2 * GR * ps), 0, 1) * 255;
      }
    }
    B.x.putImageData(B.img, 0, 0);
    ctx.drawImage(B.c, x0, y0);
    const dc = [cam.P[0] - GC[0], cam.P[1] - GC[1], cam.P[2] - GC[2]];
    const mark = (lat, lon, color, label) => {
      const v = toLocal(lat, lon, site);
      if (v[0] * dc[0] + v[1] * dc[1] + v[2] * dc[2] < GR * 1.02) return;
      const q = proj(cam, [GC[0] + GR * v[0], GC[1] + GR * v[1], GC[2] + GR * v[2]]);
      if (!q) return;
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(q.x, q.y, 4, 0, 7); ctx.fill();
      ctx.fillStyle = "#e8eaf2"; ctx.font = "12px system-ui, sans-serif"; ctx.fillText(label, q.x + 8, q.y + 4);
    };
    mark(0, 0, EARTH_C, "Cara visible (mira a la Tierra)");
    mark(90, 0, "#c5cbe0", "Polo norte"); mark(-90, 0, "#c5cbe0", "Polo sur");
    ctx.fillStyle = "#c5cbe0"; ctx.font = "600 13px system-ui, sans-serif"; ctx.fillText("LUNA", cq.x - 20, Math.min(H - 6, cq.y + sr + 18));
  }

  /* Suelo real: plano iluminado con las pendientes del DEM de LOLA alrededor del sitio. */
  function drawGroundReal(cam, L, G) {
    const gw = Math.ceil(W / 2), gh = Math.ceil(H / 2), B = buffer("ground", gw, gh), data = B.img.data;
    const hgt = 0.97 * Math.sin(4 * D2R), gain = 1 + 1.6 * (1 - clamp(L[1] * 6, 0, 1));
    const N = G.n, E = G.extent, pxm = 2 * E / N, h = G.hm, k = st.exag / (2 * pxm), A0 = G.albedo;
    for (let py = 0; py < gh; py++) {
      const b = -((py * 2 + 1) - H / 2) / cam.focal;
      for (let px = 0; px < gw; px++) {
        const a = ((px * 2 + 1) - W / 2) / cam.focal;
        const dx = cam.f[0] + cam.r[0] * a + cam.u[0] * b, dy = cam.f[1] + cam.r[1] * a + cam.u[1] * b, dz = cam.f[2] + cam.r[2] * a + cam.u[2] * b;
        if (dy > -1e-4) continue;
        const s = -hgt / dy, dist = s * Math.hypot(dx, dy, dz);
        const fi = (s * dx * M_PER_UNIT + E) / pxm - 0.5, fj = (E - s * dz * M_PER_UNIT) / pxm - 0.5;
        let sx = 0, sz = 0;
        if (fi >= 1 && fi < N - 1 && fj >= 1 && fj < N - 1) {
          const r = (fj | 0) * N + (fi | 0);
          sx = (h[r + 1] - h[r - 1]) * k;      // dh/dx hacia el este
          sz = (h[r - N] - h[r + N]) * k;      // dh/dz hacia el norte (fila 0 = norte)
        }
        const fade = clamp(1.25 - dist / 1.4, 0, 1);
        sx *= fade; sz *= fade;
        const il = 1 / Math.hypot(sx, 1, sz), lamb = Math.max(0, (-sx * L[0] + L[1] - sz * L[2]) * il);
        const v = A0 * (0.04 + 0.95 * gain * lamb), o = (py * gw + px) * 4;
        data[o] = clamp(v * 255 + 3, 0, 255); data[o + 1] = clamp(v * 250 + 4, 0, 255); data[o + 2] = clamp(v * 240 + 8, 0, 255); data[o + 3] = 255;
      }
    }
    B.x.putImageData(B.img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(B.c, 0, 0, W, H);
  }

  function drawGround(cam, L) {
    if (tex.groundSite) return drawGroundReal(cam, L, tex.groundSite);
    const T = tex.ground, P = T.P, gw = Math.ceil(W / 2), gh = Math.ceil(H / 2);
    const B = buffer("ground", gw, gh), data = B.img.data, hm = T.hm, al = T.al;
    const hgt = 0.97 * Math.sin(4 * D2R), gain = 1 + 1.6 * (1 - clamp(L[1] * 6, 0, 1));
    const sA = 0.9, sB = 0.22;
    for (let py = 0; py < gh; py++) {
      const b = -((py * 2 + 1) - H / 2) / cam.focal;
      for (let px = 0; px < gw; px++) {
        const a = ((px * 2 + 1) - W / 2) / cam.focal;
        const dx = cam.f[0] + cam.r[0] * a + cam.u[0] * b, dy = cam.f[1] + cam.r[1] * a + cam.u[1] * b, dz = cam.f[2] + cam.r[2] * a + cam.u[2] * b;
        if (dy > -1e-4) continue;
        const s = -hgt / dy, xw = s * dx, zw = s * dz, dist = s * Math.hypot(dx, dy, dz);
        const uA = ((xw / sA * P) | 0) & (P - 1), vA = ((zw / sA * P) | 0) & (P - 1), uB = ((xw / sB * P + 317) | 0) & (P - 1), vB = ((zw / sB * P + 611) | 0) & (P - 1);
        const iA = vA * P + uA, iB = vB * P + uB;
        const fA = clamp(1.25 - dist / 1.4, 0, 1), fB = clamp(1 - dist / 0.55, 0, 1);
        const hx = fA * (hm[vA * P + ((uA + 1) & (P - 1))] - hm[vA * P + ((uA - 1) & (P - 1))]) * 0.5 + 0.8 * fB * (hm[vB * P + ((uB + 1) & (P - 1))] - hm[vB * P + ((uB - 1) & (P - 1))]) * 0.5;
        const hz = fA * (hm[((vA + 1) & (P - 1)) * P + uA] - hm[((vA - 1) & (P - 1)) * P + uA]) * 0.5 + 0.8 * fB * (hm[((vB + 1) & (P - 1)) * P + uB] - hm[((vB - 1) & (P - 1)) * P + uB]) * 0.5;
        const il = 1 / Math.hypot(hx, 1, hz), lamb = Math.max(0, (-hx * L[0] + L[1] - hz * L[2]) * il);
        const A = 0.5 + (al[iA] - 0.5) * fA + (al[iB] - 0.5) * 0.6 * fB;
        const v = A * (0.04 + 0.95 * gain * lamb), o = (py * gw + px) * 4;
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
    ctx.fillStyle = "#e8eaf2"; ctx.font = "600 13px system-ui, sans-serif"; ctx.fillText("Sol" + (vis ? "" : " (oculto)"), q.x + r + 8, q.y + 4);
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
    ctx.fillStyle = "#e8eaf2"; ctx.font = "600 13px system-ui, sans-serif"; ctx.fillText("Tierra" + (vis ? "" : " (oculta)"), q.x + r + 8, q.y + 4);
    ctx.restore();
  }

  const STARS = (() => { const r = rng(99), o = []; for (let i = 0; i < 320; i++) o.push([r() * 360, Math.asin(r() * 2 - 1) / D2R, 0.25 + r() * r() * 0.75]); return o; })();

  /* ---------- Escena ---------- */
  function message(txt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#05070d"; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#9aa3bd"; ctx.font = "14px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText(txt, W / 2, H / 2); ctx.textAlign = "left";
  }
  function draw3D() {
    if (st.mode === "2d" || !ctx || !S.eph || !S.hor) return;
    const orbit = st.mode === "orbit";
    if (real.state === "idle") loadReal();
    if (real.state === "loading") { message("Cargando relieve LOLA (NASA)…"); return; }
    if (!orbit) {
      const g = groundFor(siteNow());
      if (g === "loading") { message("Cargando el terreno LOLA del sitio…"); return; }
      tex.groundSite = g;
    }
    if (!tex.earth || (orbit && !tex.moon) || (!orbit && !tex.groundSite && !tex.ground)) {
      message("Generando relieve de la Luna…");
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
    } else drawGround(cam, L);

    ctx.lineWidth = 1; ctx.strokeStyle = "rgba(150,160,200,.14)";
    for (const el of [30, 60]) { const ring = []; for (let a = 0; a <= 360; a += 5) ring.push(dirv(a, el, 1)); path3d(cam, ring); ctx.stroke(); }
    for (let a = 0; a < 360; a += 45) { const mer = []; for (let el = 0; el <= 90; el += 6) mer.push(dirv(a, el, 1)); path3d(cam, mer); ctx.stroke(); }
    const hz = []; for (let a = 0; a <= 360; a += 3) hz.push(dirv(a, 0, 1));
    path3d(cam, hz); ctx.strokeStyle = "rgba(190,200,235,.35)"; ctx.stroke();

    const items = [], el = S.hor.el, n = el.length, step = S.hor.az_step_deg, R = 0.97, baseEl = orbit ? -12 : -4;
    for (let k = 0; k < n; k++) {
      const a0 = k * step, a1 = (k + 1) * step, h0 = ex(el[k]), h1 = ex(el[(k + 1) % n]);
      const pts = [dirv(a0, h0, R), dirv(a1, h1, R), dirv(a1, baseEl, R), dirv(a0, baseEl, R)].map(p => proj(cam, p));
      if (pts.some(q => !q)) continue;
      const dd = dirv(a0, 0, 1), cosF = (orbit ? 1 : -1) * (dd[0] * L[0] + dd[1] * L[1] + dd[2] * L[2]);
      const lum = 14 + 46 * Math.max(0, cosF) * (1 + 1.2 * (1 - clamp(L[1] * 6, 0, 1))) * 0.7 + Math.min(10, Math.max(0, el[k]) * 1.2) + 3 * Math.sin(a0 * 0.37);
      const color = `hsl(222,6%,${clamp(lum, 8, 70).toFixed(0)}%)`;
      items.push({ d: 0.9409, f() {
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        for (let m = 1; m < 4; m++) ctx.lineTo(pts[m].x, pts[m].y);
        ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = color; ctx.lineWidth = 0.7; ctx.stroke();
      } });
    }
    const tr = trajectories();
    for (const [list, color] of [[tr.sun, SUN], [tr.earth, EARTH]]) for (const p of list) {
      const q = proj(cam, p);
      if (q) items.push({ d: q.d, f() { ctx.globalAlpha = 0.45; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(q.x, q.y, 1.7, 0, 7); ctx.fill(); ctx.globalAlpha = 1; } });
    }
    const sp = dirv(sa, ex(se), 1), ep = dirv(ea, ex(ee), 1), sq = proj(cam, sp), eq = proj(cam, ep);
    const sunVis = se > horizonAt(sa), earthVis = ee > horizonAt(ea);
    const spin = -(Date.parse(e.t[i]) / 3.6e6) * 15 * D2R;
    if (sq && sunVis) items.push({ d: sq.d - 0.02, f() { sunSprite(cam, sp, 0.055, true); } });
    if (eq && earthVis) items.push({ d: eq.d - 0.02, f() { earthSprite(cam, ep, 0.04, L, spin, true); } });
    items.sort((a, b) => b.d - a.d);
    for (const it of items) it.f();
    if (!sunVis) sunSprite(cam, sp, 0.055, false);
    if (!earthVis) earthSprite(cam, ep, 0.04, L, spin, false);

    ctx.font = "600 14px system-ui, sans-serif"; ctx.textAlign = "center";
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
        ctx.fillStyle = "#e8eaf2"; ctx.font = "600 13px system-ui, sans-serif"; ctx.fillText("Estás aquí: " + site.name, t.x + 10, t.y + 4);
      }
    }
    ctx.fillStyle = "#9aa3bd"; ctx.font = "12px system-ui, sans-serif";
    ctx.fillText((st.exag === 1 ? "Alturas reales" : "Alturas exageradas ×" + st.exag) + " · " + site.name + " (" + (+site.lat).toFixed(2) + "°, " + (+site.lon).toFixed(2) + "°)", 12, 20);
    const relief = orbit
      ? (tex.moon && tex.moon.real ? "Relieve: LOLA (NASA LRO) · tono: Clementine 750 nm" : "Relieve del globo ilustrativo (datos LOLA no cargados)")
      : (tex.groundSite ? "Suelo: " + tex.groundSite.source + " · ±8 km · vista desde ~300 m" : "Suelo ilustrativo: no hay datos LOLA locales para este punto");
    ctx.fillStyle = tex.groundSite || (orbit && tex.moon && tex.moon.real) ? "#7fd8b0" : "#f5d98f";
    ctx.fillText(relief, 12, 38);
    const notes = [];
    if (!sunVis) notes.push("Es de noche aquí: el Sol está bajo el horizonte (se muestra en transparencia).");
    if (tr.earthFixed) notes.push("La Tierra casi no se mueve en el cielo lunar: es normal, la Luna siempre muestra la misma cara.");
    ctx.fillStyle = "#f5d98f";
    notes.forEach((t, k) => ctx.fillText(t, 12, H - 12 - 18 * (notes.length - 1 - k)));
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
    st.orbit = { yaw: (S.eph ? S.eph.sun.az[S.i] : 180) * D2R + 0.45, pitch: 0.5, dist: 4.6 };
    st.first = { yaw: (S.eph ? S.eph.sun.az[S.i] : 0) * D2R, off: 0, pitch: 0.08, fov: 85 };
  }
  function setMode(m) {
    st.mode = m;
    bar.querySelectorAll(".vtab").forEach(b => b.classList.toggle("on", b.dataset.mode === m));
    const is3d = m !== "2d";
    chart.style.display = is3d ? "none" : ""; canvas.style.display = is3d ? "block" : "none";
    hint.style.display = is3d ? "block" : "none"; exagBox.style.display = is3d ? "flex" : "none";
    followBox.style.display = m === "first" ? "flex" : "none";
    if (is3d) { resetView(); fit(); draw3D(); }
  }
  bar.addEventListener("click", ev => { const b = ev.target.closest(".vtab"); if (b) setMode(b.dataset.mode); });
  bar.querySelector("#vfollow").addEventListener("change", ev => { if (!ev.target.checked) st.first.yaw = effYaw(); else st.first.off = 0; st.follow = ev.target.checked; draw3D(); });
  bar.querySelector("#vexag").addEventListener("change", ev => { st.exag = +ev.target.value; st.cache = null; draw3D(); });
  window.addEventListener("resize", () => { if (st.mode !== "2d") { fit(); draw3D(); } });

  let drag = null;
  canvas.addEventListener("pointerdown", ev => { drag = { x: ev.clientX, y: ev.clientY }; canvas.setPointerCapture(ev.pointerId); });
  canvas.addEventListener("pointerup", () => { drag = null; });
  canvas.addEventListener("pointercancel", () => { drag = null; });
  canvas.addEventListener("pointermove", ev => {
    if (!drag) return;
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    drag = { x: ev.clientX, y: ev.clientY };
    if (st.mode === "orbit") { st.orbit.yaw += dx * 0.008; st.orbit.pitch = clamp(st.orbit.pitch + dy * 0.006, 0.02, 1.45); }
    else {
      const k = st.first.fov / 75;
      if (st.follow) st.first.off -= dx * 0.006 * k; else st.first.yaw -= dx * 0.006 * k;
      st.first.pitch = clamp(st.first.pitch + dy * 0.005 * k, -0.45, 1.25);
    }
    draw3D();
  });
  canvas.addEventListener("wheel", ev => {
    ev.preventDefault();
    if (st.mode === "orbit") st.orbit.dist = clamp(st.orbit.dist * (1 + ev.deltaY * 0.001), 2.4, 10);
    else st.first.fov = clamp(st.first.fov * (1 + ev.deltaY * 0.001), 30, 100);
    draw3D();
  }, { passive: false });
  canvas.addEventListener("dblclick", () => { resetView(); draw3D(); });

  /* ---------- Enganche con index.html (sin modificarlo) ---------- */
  if (typeof window.updateNow === "function") { const orig = window.updateNow; window.updateNow = function () { orig.apply(this, arguments); draw3D(); }; }
  if (typeof window.drawChart === "function") { const orig = window.drawChart; window.drawChart = function () { orig.apply(this, arguments); st.cache = null; }; }
})();
