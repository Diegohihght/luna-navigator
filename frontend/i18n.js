/* i18n.js — idiomas de la interfaz (inglés por defecto, español opcional).
 *
 * Idea: el inglés está escrito en el propio HTML y en las llamadas t('clave', 'English text');
 * el español vive en diccionarios (i18n-*.js) que se registran con I18N.add('es', {...}).
 *
 * HTML estático:
 *   <span data-i18n="clave">English</span>                       -> texto
 *   <p data-i18n-html="clave">English with <b>markup</b></p>     -> HTML
 *   <button data-i18n-attr="aria-label:clave;title:otra">        -> atributos
 * JavaScript:
 *   t('clave', 'English {n} text', { n: 3 })                     -> cadena en el idioma activo
 *   I18N.onChange(() => rerender())                              -> repintar contenido dinámico
 *
 * El idioma se guarda en localStorage ("lunar.lang"); también se puede forzar con ?lang=es.
 */
(function () {
  'use strict';
  const KEY = 'lunar.lang', LANGS = ['en', 'es'];
  // Claves comunes a todas las páginas (selector de idioma y navegación).
  const dict = { es: {
    'i18n.switch': 'Idioma',
    'nav.navigator': 'Navegador',
    'nav.heatmap': 'Heatmap',
    'nav.edu': 'Educativo',
  } };
  const missing = new Set();
  const listeners = [];

  function readLang() {
    try {
      const q = new URLSearchParams(location.search).get('lang');
      if (LANGS.includes(q)) { try { localStorage.setItem(KEY, q); } catch (_) {} return q; }
      const s = localStorage.getItem(KEY);
      if (LANGS.includes(s)) return s;
    } catch (_) {}
    return 'en';
  }
  let lang = readLang();
  // Si el idioma guardado es español, se oculta la página un instante para no ver el inglés parpadear.
  if (lang !== 'en') document.documentElement.classList.add('i18n-pending');

  const fmt = (s, p) => p ? s.replace(/\{(\w+)\}/g, (m, k) => (k in p ? p[k] : m)) : s;

  /** Cadena traducida. `en` es el texto en inglés (por defecto); el español sale del diccionario. */
  function t(key, en, params) {
    if (lang === 'es') {
      const v = dict.es[key];
      if (v !== undefined) return fmt(v, params);
      missing.add(key);
    }
    return fmt(en, params);
  }

  function esText(key) { return dict.es[key]; }

  /** Traduce los elementos marcados con data-i18n* dentro de `root`. */
  function apply(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(el => {
      if (el.dataset.i18nEn === undefined) el.dataset.i18nEn = el.textContent;
      const k = el.dataset.i18n;
      el.textContent = (lang === 'es' && dict.es[k] !== undefined) ? dict.es[k] : el.dataset.i18nEn;
      if (lang === 'es' && dict.es[k] === undefined) missing.add(k);
    });
    root.querySelectorAll('[data-i18n-html]').forEach(el => {
      if (el.dataset.i18nEn === undefined) el.dataset.i18nEn = el.innerHTML;
      const k = el.dataset.i18nHtml;
      el.innerHTML = (lang === 'es' && dict.es[k] !== undefined) ? dict.es[k] : el.dataset.i18nEn;
      if (lang === 'es' && dict.es[k] === undefined) missing.add(k);
    });
    root.querySelectorAll('[data-i18n-attr]').forEach(el => {
      el.dataset.i18nAttr.split(';').forEach(pair => {
        const [attr, k] = pair.split(':').map(x => x.trim());
        if (!attr || !k) return;
        const store = 'i18nEn' + attr.replace(/(^|-)(\w)/g, (m, a, c) => c.toUpperCase());
        if (el.dataset[store] === undefined) el.dataset[store] = el.getAttribute(attr) || '';
        el.setAttribute(attr, (lang === 'es' && dict.es[k] !== undefined) ? dict.es[k] : el.dataset[store]);
        if (lang === 'es' && dict.es[k] === undefined) missing.add(k);
      });
    });
    if (root === document) {
      document.documentElement.lang = lang;
      const ti = document.querySelector('title[data-i18n]');
      if (ti) document.title = ti.textContent;
    }
  }

  // ---- Nombres de sitios (la API los devuelve en español; aquí se sirven por id) ----
  const SITES = {
    apollo11:     { en: 'Apollo 11 (Sea of Tranquility)',    short: 'Apollo 11', mission: 'Apollo 11' },
    apollo12:     { en: 'Apollo 12 (Oceanus Procellarum)',   short: 'Apollo 12', mission: 'Apollo 12' },
    apollo14:     { en: 'Apollo 14 (Fra Mauro)',             short: 'Apollo 14', mission: 'Apollo 14' },
    apollo15:     { en: 'Apollo 15 (Hadley–Apennine)',       short: 'Apollo 15', mission: 'Apollo 15' },
    apollo16:     { en: 'Apollo 16 (Descartes)',             short: 'Apollo 16', mission: 'Apollo 16' },
    apollo17:     { en: 'Apollo 17 (Taurus–Littrow)',        short: 'Apollo 17', mission: 'Apollo 17' },
    chandrayaan3: { en: 'Chandrayaan-3 (Shiv Shakti)',       short: 'Chandrayaan-3', mission: 'Chandrayaan-3' },
    im2:          { en: 'IM-2 (south polar region)',         short: 'IM-2', mission: 'CLPS IM-2' },
    shackleton:   { en: 'Shackleton crater rim',             short: 'Shackleton crater rim', mission: 'South pole candidate' },
    south_pole:   { en: 'Lunar south pole',                  short: 'Lunar south pole', mission: 'Reference' },
  };
  /** Nombre completo del sitio en el idioma activo ({id, name}). Los sitios desconocidos conservan su nombre. */
  function siteName(s) { return (lang === 'en' && SITES[s.id]) ? SITES[s.id].en : s.name; }
  /** Nombre sin el paréntesis (para ejes y tablas). */
  function siteShort(s) {
    if (lang === 'en' && SITES[s.id]) return SITES[s.id].short;
    return s.name.replace(/\s*\(.*$/, '');
  }
  function siteMission(s) {
    if (lang === 'en' && SITES[s.id]) return SITES[s.id].mission;
    return s.mission;
  }
  /** Traduce el nombre devuelto por la API (por ejemplo en /api/compare, que no trae el id en el nombre). */
  function nameById(id, fallback) { return (lang === 'en' && SITES[id]) ? SITES[id].en : fallback; }
  function shortById(id, fallback) {
    if (lang === 'en' && SITES[id]) return SITES[id].short;
    return (fallback || '').replace(/\s*\(.*$/, '');
  }

  // ---- Selector de idioma, arriba de la página ----
  function buildSwitch() {
    if (document.getElementById('langswitch')) return;
    const host = document.querySelector('header.topbar, header');
    if (!host) return;
    const box = document.createElement('div');
    box.id = 'langswitch'; box.className = 'langswitch';
    box.setAttribute('role', 'group'); box.setAttribute('aria-label', t('i18n.switch', 'Language'));
    box.innerHTML = LANGS.map(l => `<button type="button" data-lang="${l}" lang="${l}" aria-pressed="${l === lang}" title="${l === 'en' ? 'English' : 'Español'}">${l.toUpperCase()}</button>`).join('');
    box.addEventListener('click', e => { const b = e.target.closest('button[data-lang]'); if (b) set(b.dataset.lang); });
    host.appendChild(box);
  }
  function syncSwitch() {
    const box = document.getElementById('langswitch'); if (!box) return;
    box.setAttribute('aria-label', t('i18n.switch', 'Language'));
    box.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  }

  function set(next) {
    if (!LANGS.includes(next) || next === lang) return;
    lang = next;
    try { localStorage.setItem(KEY, lang); } catch (_) {}
    refresh();
  }
  function refresh() {
    apply(document); syncSwitch();
    listeners.forEach(fn => { try { fn(lang); } catch (e) { console.error(e); } });
    document.documentElement.classList.remove('i18n-pending');
  }

  window.I18N = {
    t, apply, set, siteName, siteShort, siteMission, nameById, shortById, esText,
    get lang() { return lang; },
    add(l, entries) { if (l === 'es') Object.assign(dict.es, entries); },
    onChange(fn) { listeners.push(fn); },
    missing() { return [...missing]; },
    ready() { buildSwitch(); refresh(); },
  };
  window.t = t;

  // Se aplica al cargar; los diccionarios (scripts posteriores) ya están registrados en DOMContentLoaded.
  document.addEventListener('DOMContentLoaded', () => window.I18N.ready());
})();
