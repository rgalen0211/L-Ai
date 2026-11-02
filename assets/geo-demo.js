// NEXT-WEB 198, 199 and 201: the Dayton-style demo page for Geographic Intelligence, on SYNTHETIC data only (assets/geo-demo-data.js). No map library and no outside request: the "map" is drawn as SVG from the
// made-up shapes, so this page proves the idea (shaded areas, markers, click to drop a site, a ring, counts with their labels, two sites side by side) before any real data or tile file exists.
// Since 201 every number comes from assets/geo-catchment.js, a port of ENGINE's geo module, in the JSON contract ryagram.site-comparison/0 (tests/geo-contract.test.mjs); the page draws only what validates.
// Shown only when the site switch geoDemo is ON (OFF). Words are drafts for Ryan.
(function () {
  const G = window.ryagramGeo, D = window.ryagramGeoDemoData;
  const NS = 'http://www.w3.org/2000/svg';
  const W = 640, H = 560, PAD = 12;                          // close to the map's own shape, so a phone does not draw it as a thin strip
  const on = cfg => !!cfg && cfg.geoDemo === true;
  // RENDERER's map look (proposals/RENDERER-GEO-MAP-LOOK.md, NEXT-RENDERER 71), applied: the films' near-black page, one blue ramp (fewer residents = darker), thin page-coloured seams, amber circles for chicken,
  // grey squares for burgers (shape AND colour differ), a page-coloured halo round every marker, a red pin with its letter for a site, a solid ring with a light red wash, place labels on page-coloured plates.
  const PAGE = '#111218';
  const COLOURS = { chicken: '#f5a623', burger: '#c9ced6', retail: '#b9a7ff' };
  const RAMP = ['#243a63', '#2c4f85', '#3b6aa8', '#5588c6', '#7fb0ea'];
  const PIN = '#e5484d';                                                   // a site is a pin with its LETTER, so A and B never depend on colour

  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else if (k === 'class') el.className = v; else el.setAttribute(k, v === true ? '' : v); }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  };
  const s = (tag, attrs, ...kids) => {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) el.setAttribute(k, v);
    for (const c of kids.flat()) if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  };

  // Equirectangular within the small box: the box is a few tens of km wide, so a straight scale is fine for a picture (the distances come from the great-circle maths, not from the picture).
  const b = D.bbox, midLat = (b.lat0 + b.lat1) / 2, kx = Math.cos(midLat * Math.PI / 180);
  const spanX = (b.lon1 - b.lon0) * kx, spanY = b.lat1 - b.lat0;
  const scale = Math.min((W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
  const offX = (W - spanX * scale) / 2, offY = (H - spanY * scale) / 2;
  const px = lon => offX + (lon - b.lon0) * kx * scale, py = lat => H - (offY + (lat - b.lat0) * scale);
  const unx = x => b.lon0 + (x - offX) / (kx * scale), uny = y => b.lat0 + (H - y - offY) / scale;

  const pops = D.areas.map(a => a.population), pMin = Math.min(...pops), pMax = Math.max(...pops);
  const shade = p => RAMP[Math.min(RAMP.length - 1, Math.floor(((p - pMin) / Math.max(1, pMax - pMin)) * RAMP.length))];
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const metres = m => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${fmt(m)} m`);
  const show = (v, unit) => (Array.isArray(v) ? `$${fmt(v[0])} to $${fmt(v[1])}` : v == null ? 'none on the map' : unit === ' m' ? metres(v) : `${fmt(v)}${unit || ''}`);
  const signed = (d, unit) => (d == null ? 'not compared' : `${d > 0 ? '+' : d < 0 ? '−' : ''}${fmt(Math.abs(d))}${unit || ''}`);
  const weaker = (...ls) => ls.reduce((m, l) => (G.LABELS.indexOf(l) > G.LABELS.indexOf(m) ? l : m));

  function marker(p) {
    const x = px(p.lon), y = py(p.lat), c = COLOURS[p.category], common = { fill: c, stroke: PAGE, 'stroke-width': 3, 'paint-order': 'stroke' };
    const title = s('title', {}, `${p.name} (${D.LABEL})`);
    if (p.category === 'chicken') return s('circle', { cx: x, cy: y, r: 5.5, ...common }, title);
    if (p.category === 'burger') return s('rect', { x: x - 5, y: y - 5, width: 10, height: 10, ...common }, title);
    return s('polygon', { points: `${x},${y - 6.5} ${x + 6},${y + 4.5} ${x - 6},${y + 4.5}`, ...common }, title);
  }

  function mount(root) {
    const state = { A: null, B: null, active: 'A', m: 2000 };
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'geo-svg', role: 'img', 'aria-label': 'A made-up map: shaded areas by population, with chicken, burger and shop markers. Choose a site with the buttons or by clicking the map.' });
    const layer = s('g', {}), ringG = s('g', {}), siteG = s('g', {});
    for (const a of D.areas) layer.append(s('polygon', { points: a.ring.map(([lo, la]) => `${px(lo)},${py(la)}`).join(' '), fill: shade(a.population), stroke: PAGE, 'stroke-width': 1.5 }, s('title', {}, `${a.name}: ${fmt(a.population)} people (${D.LABEL})`)));
    const plates = s('g', {});
    for (const pl of D.places) { const x = px(pl.lon), y = py(pl.lat), w = pl.name.length * 8.6 + 14; plates.append(s('rect', { class: 'geo-plate', x: x - w / 2, y: y - 12, width: w, height: 22, rx: 3, fill: PAGE, opacity: 0.88 }), s('text', { class: 'geo-plate', x, y: y + 4, 'text-anchor': 'middle', fill: '#e8eaf0', 'font-size': 12, 'font-weight': 700, 'letter-spacing': 0.8 }, pl.name)); }
    for (const p of D.points) layer.append(marker(p));
    svg.append(layer, plates, ringG, siteG);
    const results = h('table', { class: 'geo-results' });
    const summary = h('p', { class: 'geo-summary' });
    const status = h('p', { class: 'meta', role: 'status' });
    const say = t => { status.textContent = t; };
    const radius = h('select', { id: 'geo-km', 'aria-label': 'Ring radius' }, [1000, 2000, 4000].map(k => h('option', { value: String(k), selected: k === state.m }, `${k / 1000} km`)));
    radius.addEventListener('change', () => { state.m = Number(radius.value); draw(); });

    const pick = h('fieldset', { class: 'geo-pick' }, h('legend', {}, 'Which site are you placing?'),
      ['A', 'B'].map(k => h('label', { class: 'geo-pick-opt' }, h('input', { type: 'radio', name: 'geo-site', value: k, checked: k === 'A', onchange: () => { state.active = k; say(`Placing site ${k}. Click the map or use a button.`); } }), `Site ${k}`)));
    const clearB = h('button', { class: 'button secondary', type: 'button', onclick: () => { state.B = null; state.active = 'A'; pick.querySelector('input[value="A"]').checked = true; draw(); say('Site B removed.'); } }, 'Remove site B');

    function setSite(site) {
      const k = state.active;
      state[k] = { lon: site.lon, lat: site.lat, name: `Site ${k}` };
      if (k === 'A' && !state.B) { state.active = 'B'; pick.querySelector('input[value="B"]').checked = true; }
      draw();
      say(state.A && state.B ? `Site ${k} set. Both sites are compared below.` : `Site ${k} set. Now place site B to compare, or change A.`);
    }
    svg.addEventListener('click', ev => {
      const r = svg.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * W, y = ((ev.clientY - r.top) / r.height) * H;
      const lon = unx(x), lat = uny(y);
      if (lon < b.lon0 || lon > b.lon1 || lat < b.lat0 || lat > b.lat1) { say('That is outside the made-up map. Click inside it.'); return; }
      setSite({ lon, lat });
    });

    const chip = r => h('span', { class: `geo-chip geo-${r.label.toLowerCase()}` }, r.label);
    const src = `${D.SOURCE}, labelled ${D.LABEL}`;
    function drawSite(k, c) {
      const ring = G.circle({ lon: c.lon, lat: c.lat }, state.m), x = px(c.lon), y = py(c.lat);
      ringG.append(s('polygon', { points: ring.map(([lo, la]) => `${px(lo)},${py(la)}`).join(' '), fill: 'rgba(229,72,77,0.16)', stroke: '#ffe3e4', 'stroke-width': 2.5, 'data-ring': k }));
      siteG.append(s('path', { d: `M${x},${y + 14} L${x - 9},${y - 5} A11 11 0 1 1 ${x + 9},${y - 5} Z`, fill: PIN, stroke: PAGE, 'stroke-width': 2.5, 'paint-order': 'stroke' }, s('title', {}, `Site ${k}`)),
        s('text', { class: 'geo-pinletter', x, y: y - 3, 'text-anchor': 'middle', fill: '#ffffff', 'font-size': 13, 'font-weight': 800 }, k));
    }
    const NAMES = Object.keys(D.categories);
    const siteOf = k => ({ id: k, lon: state[k].lon, lat: state[k].lat });
    const rowsOf = (block, ring) => [
      { what: 'Residents inside the ring', r: ring.residents, unit: ' people' },
      { what: 'Median household income across the areas touched', r: ring.income_range },
      ...NAMES.map(c => ({ what: `${D.categories[c]} inside`, r: ring.counts[c] })),
      { what: 'Nearest chicken place', r: block.nearest.chicken, unit: ' m' },
    ];
    function draw() {
      ringG.replaceChildren(); siteG.replaceChildren(); summary.textContent = '';
      for (const k of ['A', 'B']) if (state[k]) drawSite(k, state[k]);
      clearB.hidden = !state.B;
      if (!state.A && !state.B) { results.replaceChildren(h('caption', {}, 'Pick a site to see the numbers.')); return; }
      const key = String(state.m), opts = { areaSource: src, pointSource: src, snapshot: 'synthetic' };
      const km = `${state.m / 1000} km`;
      if (state.A && state.B) {
        const cmp = G.compareSites([siteOf('A'), siteOf('B')], [state.m], D.areas, D.points, NAMES, opts);
        const bad = G.validateComparison(cmp);
        if (bad.length) { results.replaceChildren(h('caption', {}, 'These numbers could not be shown.')); say(`The numbers did not pass the check (${bad[0]}), so nothing is shown.`); return; }
        const [a, b] = cmp.sites, ra = a.rings[key], rb = b.rings[key], d = cmp.differences[key];
        const rows = [
          { what: 'Residents inside the ring', a: ra.residents, b: rb.residents, diff: d.residents, unit: ' people' },
          { what: 'Median household income across the areas touched', a: ra.income_range, b: rb.income_range, diff: null },
          ...NAMES.map(c => ({ what: `${D.categories[c]} inside`, a: ra.counts[c], b: rb.counts[c], diff: d.counts[c] })),
          { what: 'Nearest chicken place', a: a.nearest.chicken, b: b.nearest.chicken, diff: null, unit: ' m' },
        ];
        results.replaceChildren(h('caption', {}, `Site A and site B, each inside a ${km} straight-line ring`),
          h('thead', {}, h('tr', {}, ['What', 'Site A', 'Site B', 'B minus A', 'Label', 'Where it comes from'].map(t => h('th', { scope: 'col' }, t)))),
          h('tbody', {}, rows.map(r => h('tr', {}, h('th', { scope: 'row' }, r.what), h('td', { 'data-col': 'Site A' }, show(r.a.value, r.unit)), h('td', { 'data-col': 'Site B' }, show(r.b.value, r.unit)),
            h('td', { 'data-col': 'B minus A' }, r.diff ? signed(r.diff.value, r.unit) : 'not compared'), h('td', {}, chip(r.diff || { label: weaker(r.a.label, r.b.label) })), h('td', { class: 'meta' }, `${r.a.source}. ${r.a.note}`)))));
        const more = (n, what) => (n === 0 ? `the same number of ${what}` : `${fmt(Math.abs(n))} ${n > 0 ? 'more' : 'fewer'} ${what}`);
        summary.textContent = `Compared with site A, site B has an estimated ${more(d.residents.value, 'residents')} inside its ring and ${more(d.counts.chicken.value, 'chicken places')}. This only counts what is inside each ring: it does not say which site is better, because there is no real sales or cost data here.`;
        return;
      }
      const k = state.A ? 'A' : 'B', block = G.siteBlock(siteOf(k), [state.m], D.areas, D.points, NAMES, opts), rows = rowsOf(block, block.rings[key]);
      results.replaceChildren(h('caption', {}, `Inside a ${km} straight-line ring around site ${k}`),
        h('thead', {}, h('tr', {}, ['What', 'Number', 'Label', 'Where it comes from'].map(t => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, rows.map(r => h('tr', {}, h('th', { scope: 'row' }, r.what), h('td', { 'data-col': 'Number' }, show(r.r.value, r.unit)), h('td', {}, chip(r.r)), h('td', { class: 'meta' }, `${r.r.source}. ${r.r.note}`)))));
    }

    const presets = h('div', { class: 'geo-presets', role: 'group', 'aria-label': 'Try a site' }, D.sites.map(si => h('button', { class: 'button secondary', type: 'button', onclick: () => setSite(si) }, si.name)));
    const legend = h('div', { class: 'geo-legend' },
      h('p', { class: 'meta' }, h('b', {}, 'Shading: '), `people per made-up area, from ${fmt(pMin)} (dark) to ${fmt(pMax)} (light).`),
      h('p', { class: 'meta' }, h('b', {}, 'Markers: '), 'circle = chicken place, square = burger place, triangle = shop, pin with a letter = a site (its ring is the solid circle round it).'));
    const film = h('button', { class: 'button secondary', type: 'button', 'aria-disabled': 'true', onclick: ev => { ev.preventDefault(); say('Making a film from a map is not built yet.'); } }, 'Make this a film (not built yet)');
    root.replaceChildren(h('div', { class: 'geo-stage' },
      h('p', { class: 'shell-banner', role: 'note' }, h('strong', {}, 'SYNTHETIC DEMO DATA. '), 'The areas, people and shops on this map are made up to test the page. They are not Dayton, not the Census and not OpenStreetMap. Draft words for Ryan.'),
      h('h1', { tabindex: '-1' }, 'Where should a chicken place open? (demo)'),
      h('p', { class: 'help-intro' }, 'Click the map, or use the buttons, to drop a candidate site. A ring is drawn around it and the numbers inside it are counted. Place a second site to compare the two side by side. Every number says whether it was observed, calculated, estimated or simulated.'),
      h('div', { class: 'geo-grid' },
        h('div', { class: 'geo-mapcol' }, svg, legend),
        h('div', { class: 'geo-panel' },
  h('div', { class: 'geo-controls' }, pick, presets, h('label', { for: 'geo-km' }, 'Ring radius '), radius, clearB),
  h('p', { class: 'meta' }, 'The ring is a straight-line circle, not a drive time. A real drive area needs a routing engine we do not have yet.'),
          status, summary, film)),
      results));
    draw();
  }

  window.ryagramGeoDemo = Object.freeze({ on, mount, px, py, unx, uny });
  const root = document.getElementById('geo-demo'), off = document.getElementById('not-available');
  if (root && G && D) { const enabled = on(window.ryagramConfig); root.hidden = !enabled; if (off) off.hidden = enabled; if (enabled) mount(root); }
})();
