// NEXT-WEB 198: the Dayton-style demo page for Geographic Intelligence, on SYNTHETIC data only (assets/geo-demo-data.js). No map library and no outside request: the "map" is drawn as SVG from the
// made-up shapes, so this page proves the idea (shaded areas, markers, click to drop a site, a ring, counts with their labels) before any real data or tile file exists.
// Shown only when the site switch geoDemo is ON (OFF). Words are drafts for Ryan.
(function () {
  const G = window.ryagramGeo, D = window.ryagramGeoDemoData;
  const NS = 'http://www.w3.org/2000/svg';
  const W = 800, H = 520, PAD = 12;
  const on = cfg => !!cfg && cfg.geoDemo === true;
  const COLOURS = { chicken: '#f2b134', burger: '#ef7a74', retail: '#a9b4ff' };
  const RAMP = ['#1d3442', '#24505c', '#2f6f73', '#43908a', '#6fd1bd'];

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

  function marker(p) {
    const x = px(p.lon), y = py(p.lat), c = COLOURS[p.category], common = { fill: c, stroke: '#101419', 'stroke-width': 1.5 };
    const title = s('title', {}, `${p.name} (${G.LABELS.includes(D.LABEL) ? D.LABEL : ''})`);
    if (p.category === 'chicken') return s('circle', { cx: x, cy: y, r: 5.5, ...common }, title);
    if (p.category === 'burger') return s('rect', { x: x - 5, y: y - 5, width: 10, height: 10, ...common }, title);
    return s('polygon', { points: `${x},${y - 6.5} ${x + 6},${y + 4.5} ${x - 6},${y + 4.5}`, ...common }, title);
  }

  function mount(root) {
    const state = { site: null, km: 2 };
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'geo-svg', role: 'img', 'aria-label': 'A made-up map: shaded areas by population, with chicken, burger and shop markers. Choose a site with the buttons or by clicking the map.' });
    const layer = s('g', {}), ringG = s('g', {}), siteG = s('g', {});
    for (const a of D.areas) layer.append(s('polygon', { points: a.ring.map(([lo, la]) => `${px(lo)},${py(la)}`).join(' '), fill: shade(a.population), stroke: '#0e1318', 'stroke-width': 1 }, s('title', {}, `${a.name}: ${fmt(a.population)} people (${D.LABEL})`)));
    for (const p of D.points) layer.append(marker(p));
    svg.append(layer, ringG, siteG);
    const results = h('table', { class: 'geo-results' });
    const status = h('p', { class: 'meta', role: 'status' });
    const radius = h('select', { id: 'geo-km', 'aria-label': 'Ring radius' }, [1, 2, 4].map(k => h('option', { value: String(k), selected: k === state.km }, `${k} km`)));
    radius.addEventListener('change', () => { state.km = Number(radius.value); draw(); });

    function setSite(site) { state.site = { lon: site.lon, lat: site.lat, name: site.name || 'Your site' }; draw(); }
    svg.addEventListener('click', ev => {
      const r = svg.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * W, y = ((ev.clientY - r.top) / r.height) * H;
      const lon = unx(x), lat = uny(y);
      if (lon < b.lon0 || lon > b.lon1 || lat < b.lat0 || lat > b.lat1) { status.textContent = 'That is outside the made-up map. Click inside it.'; return; }
      setSite({ lon, lat, name: 'Your site' });
    });

    function row(label, r, unit) {
      const v = r.value;
      const shown = v && typeof v === 'object' ? `${v.name}, ${v.km} km` : v == null ? 'none on the map' : `${fmt(v)}${unit || ''}`;
      return h('tr', {}, h('th', { scope: 'row' }, label), h('td', {}, shown), h('td', {}, h('span', { class: `geo-chip geo-${r.label.toLowerCase()}` }, r.label)), h('td', { class: 'meta' }, `${r.source}. ${r.note}`));
    }
    function draw() {
      ringG.replaceChildren(); siteG.replaceChildren();
      if (!state.site) { results.replaceChildren(h('caption', {}, 'Pick a site to see the numbers.')); status.textContent = 'No site yet.'; return; }
      const c = state.site, ring = G.ringPolygon(c, state.km);
      ringG.append(s('polygon', { points: ring.map(([lo, la]) => `${px(lo)},${py(la)}`).join(' '), fill: 'rgba(255,255,255,0.10)', stroke: '#ffffff', 'stroke-width': 2, 'stroke-dasharray': '7 5' }));
      const x = px(c.lon), y = py(c.lat);
      siteG.append(s('path', { d: `M${x},${y - 11} L${x + 8},${y} L${x},${y + 11} L${x - 8},${y} Z`, fill: '#ffffff', stroke: '#101419', 'stroke-width': 2 }, s('title', {}, 'Your site')));
      const src = `${D.SOURCE}, labelled ${D.LABEL}`;
      const rows = [
        ['Residents inside the ring', G.residentsInside(D.areas, c, state.km, src), ' people'],
        [D.categories.chicken + ' inside', G.countInside(D.points, c, state.km, 'chicken', src)],
        [D.categories.burger + ' inside', G.countInside(D.points, c, state.km, 'burger', src)],
        [D.categories.retail + ' inside', G.countInside(D.points, c, state.km, 'retail', src)],
        ['Nearest chicken place', G.nearestOf(D.points, c, 'chicken', src)],
      ];
      results.replaceChildren(h('caption', {}, `Inside a ${state.km} km straight-line ring around ${c.name}`),
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'What'), h('th', { scope: 'col' }, 'Number'), h('th', { scope: 'col' }, 'Label'), h('th', { scope: 'col' }, 'Where it comes from'))),
        h('tbody', {}, rows.map(r => row(r[0], r[1], r[2]))));
      status.textContent = `Site set. Ring of ${state.km} km drawn. The numbers below have changed.`;
    }

    const presets = h('div', { class: 'geo-presets', role: 'group', 'aria-label': 'Try a site' }, D.sites.map(si => h('button', { class: 'button secondary', type: 'button', onclick: () => setSite(si) }, si.name)));
    const legend = h('div', { class: 'geo-legend' },
      h('p', { class: 'meta' }, h('b', {}, 'Shading: '), `people per made-up area, from ${fmt(pMin)} (dark) to ${fmt(pMax)} (light).`),
      h('p', { class: 'meta' }, h('b', {}, 'Markers: '), 'circle = chicken place, square = burger place, triangle = shop, diamond = your site.'));
    const film = h('button', { class: 'button secondary', type: 'button', 'aria-disabled': 'true', onclick: ev => { ev.preventDefault(); status.textContent = 'Making a film from a map is not built yet.'; } }, 'Make this a film (not built yet)');
    root.replaceChildren(
      h('p', { class: 'shell-banner', role: 'note' }, h('strong', {}, 'SYNTHETIC DEMO DATA. '), 'The areas, people and shops on this map are made up to test the page. They are not Dayton, not the Census and not OpenStreetMap. Draft words for Ryan.'),
      h('h1', { tabindex: '-1' }, 'Where should a chicken place open? (demo)'),
      h('p', { class: 'help-intro' }, 'Click the map, or use the buttons, to drop a candidate site. A ring is drawn around it and the numbers inside it are counted. Every number says whether it was observed, calculated, estimated or simulated.'),
      h('div', { class: 'geo-controls' }, presets, h('label', { for: 'geo-km' }, 'Ring radius '), radius),
      h('p', { class: 'meta' }, 'The ring is a straight-line circle, not a drive time. A real drive area needs a routing engine we do not have yet.'),
      svg, legend, status, results, film);
    draw();
  }

  window.ryagramGeoDemo = Object.freeze({ on, mount, px, py, unx, uny });
  const root = document.getElementById('geo-demo'), off = document.getElementById('not-available');
  if (root && G && D) { const enabled = on(window.ryagramConfig); root.hidden = !enabled; if (off) off.hidden = enabled; if (enabled) mount(root); }
})();
