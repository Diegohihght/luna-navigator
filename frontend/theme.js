/* Utilidades de tema compartidas para las gráficas Plotly de heatmap y educativo. */
window.LunarTheme = (() => {
  const C = {
    text: '#c9d2e8', muted: '#8e9bba', grid: 'rgba(122,150,205,.14)', zero: 'rgba(122,150,205,.45)',
    sun: '#ffb43b', earth: '#4da3ff', terrain: 'rgba(142,155,186,.55)', terrainLine: '#9aa7c7', accent: '#4cc9f0',
  };
  const font = 'Inter, "Segoe UI", system-ui, sans-serif';

  /** Layout Plotly oscuro y transparente; `extra` se mezcla encima (un nivel de profundidad en ejes). */
  function layout(extra = {}) {
    const axis = (o = {}) => ({
      gridcolor: C.grid, zerolinecolor: C.zero, linecolor: C.grid, tickcolor: C.grid,
      tickfont: { color: C.muted, size: 11.5 }, title: { font: { color: C.muted, size: 12 } }, ...o,
    });
    const base = {
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      font: { color: C.text, family: font, size: 12 },
      margin: { t: 14, l: 56, r: 16, b: 46 },
      hoverlabel: { bgcolor: '#101830', bordercolor: '#4cc9f0', font: { color: '#e8edf8', family: font, size: 12.5 } },
      legend: { orientation: 'h', y: 1.12, x: 0, font: { color: C.text, size: 12 } },
    };
    const out = { ...base, ...extra };
    out.xaxis = axis(extra.xaxis || {});
    out.yaxis = axis(extra.yaxis || {});
    return out;
  }

  /** Escala secuencial de un solo tono (ámbar solar): oscuro = poco Sol, claro = mucho Sol.
      El extremo bajo queda apenas por encima del fondo para que 0 % se distinga del vacío. */
  const sunScale = [
    [0.00, '#1a1626'], [0.12, '#3a2230'], [0.28, '#6b3418'], [0.45, '#a8531a'],
    [0.62, '#e07b1c'], [0.80, '#ffb43b'], [1.00, '#fff0b8'],
  ];

  return { C, layout, sunScale, config: { responsive: true, displaylogo: false, displayModeBar: false } };
})();
