// Perfect City, the first working page (GEO 11-27; department geo_intelligence, behind the per-account switch perfectCity).
// The person picks a county and a kind of business, then puts a spot on the map. The page shows the nearest similar places
// (straight-line distance), how many are within 1, 2 and 5 km, and about how many people live around the spot, with the
// block group's people, density and median income. EVERY number says observed, calculated or estimated, and the page says
// what it does not know. Census layers ship with the page (public domain); the business points come from the server only
// (public.perfect_city_places: OpenStreetMap, private until attorney row G11), and the page says so when they are missing.
// All public words here are DRAFT, FOR RYAN'S YES.
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const COUNTIES = [
    { id: 'montgomery_oh', label: 'Montgomery County, Ohio (Dayton)', kinds: ['fast_food', 'restaurant', 'chicken', 'burger', 'pizza', 'grocery'] },
    { id: 'greene_oh', label: 'Greene County, Ohio (Beavercreek, Xenia)', kinds: ['fast_food', 'restaurant', 'chicken', 'burger', 'pizza'] }
  ];
  const KINDS = { fast_food: 'Fast food', restaurant: 'Restaurants', chicken: 'Chicken places', burger: 'Burger places', pizza: 'Pizza places', grocery: 'Supermarkets' };      // chicken, burger, pizza: the Ryagram engine's rules (tools/perfect-city/export_perfect_city.py SUBKINDS)
  const SHADES = { density: 'People per square kilometre', income: 'Median household income' };
  const FILL = ['#dfe6f3', '#b3c2e0', '#8299c7', '#55699f', '#2f3f73'];      // pale to dark blue (FACES' shade palette B)
  const NO_DATA = '#4a4a52';
  const W = 640, H = 480;
  const WORDS = {
    intro: 'Pick a county and a kind of business, then click the map, or type a latitude and longitude, to put a spot on it. Ryagram shows how far the nearest similar places are, how many are within 1, 2 and 5 km, and about how many people live around the spot.',
    notKnown: ['Distances are straight lines, not drive or walk times.',
      'The business points come from OpenStreetMap, made by volunteers: a place can be missing, closed or out of date.',
      'People within a ring are an estimate: a block group counts in full when its centre is inside the ring.',
      'Median income is a survey estimate with a margin of error, for the whole block group.',
      'There is no success score and no prediction. This shows what is there, not whether a business would do well.',
      'The map shows the places near your spot only: within 5 km, and the nearest five.'],
    noPlaces: 'The business points are not loaded on this account yet, so the map shows people and income only.',
    placesError: 'The business points could not be loaded. The map shows people and income only. Try again in a few minutes.',
    badTyped: 'Type a latitude and a longitude as numbers, for example 39.7589 and -84.1916.',
    pickSpot: 'Click the map, or type a latitude and longitude, to put a spot on it.',
    outside: 'That spot is outside the county. Put it inside the shaded area.'
  };
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const km1 = (x) => (x < 10 ? x.toFixed(2) : x.toFixed(1));

  function loadCensus(county) {
    const have = () => window.ryagramPerfectCityData && window.ryagramPerfectCityData[county];
    if (have()) return Promise.resolve(have());
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `/assets/perfect-city/${county}.census.js?v=20261127a`;
      s.onload = () => (have() ? resolve(have()) : reject(new Error('no data')));
      s.onerror = () => reject(new Error('no data'));
      document.head.append(s);
    });
  }

  function svg(tag, attrs = {}, kids = []) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
    for (const c of kids) el.append(c);
    return el;
  }

  async function view({ h, data }) {
    const pc = window.ryagramPerfectCity;
    const state = { county: COUNTIES[0].id, kind: 'fast_food', shade: 'density', spot: null, census: null, places: null, placesNote: '', credit: '' };
    const select = (id, label, options, value, onchange) => {
      const sel = h('select', { id, onchange: (e) => onchange(e.target.value) }, options.map(([v, t]) => h('option', { value: v }, t)));
      sel.value = value;
      return h('label', { class: 'pc-control', for: id }, label, ' ', sel);
    };
    const mapBox = h('div', { class: 'pc-map', id: 'pc-map' });
    const results = h('div', { class: 'pc-results', id: 'pc-results' });
    const status = h('p', { class: 'form-note', id: 'pc-status', role: 'status' });
    const credits = h('p', { class: 'meta', id: 'pc-credits' });
    const latIn = h('input', { id: 'pc-lat', type: 'text', inputmode: 'decimal', size: '9', placeholder: '39.7589', autocomplete: 'off' });
    const lonIn = h('input', { id: 'pc-lon', type: 'text', inputmode: 'decimal', size: '9', placeholder: '-84.1916', autocomplete: 'off' });
    const num = (v) => (/^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN);
    const typed = h('form', { class: 'pc-typed', onsubmit: (e) => {
      e.preventDefault();
      const lat = num(latIn.value), lon = num(lonIn.value);
      if (Number.isFinite(lat) && Number.isFinite(lon)) place([lon, lat]);
      else { status.textContent = WORDS.badTyped; latIn.focus(); }
    } }, h('span', { class: 'meta' }, 'Or type a spot: '),
      h('label', { class: 'pc-control', for: 'pc-lat' }, 'Latitude ', latIn), ' ',
      h('label', { class: 'pc-control', for: 'pc-lon' }, 'Longitude ', lonIn), ' ',
      h('button', { class: 'button secondary', type: 'submit', id: 'pc-go' }, 'Put the spot here'));
    let kindWrap = h('span');

    function kindSelect() {
      const c = COUNTIES.find((x) => x.id === state.county);
      if (!c.kinds.includes(state.kind)) state.kind = c.kinds[0];
      const hadFocus = document.activeElement && document.activeElement.id === 'pc-kind';
      kindWrap.replaceChildren(select('pc-kind', 'Business', c.kinds.map((k) => [k, KINDS[k]]), state.kind, (v) => { state.kind = v; refresh(); }));
      if (hadFocus) document.getElementById('pc-kind')?.focus();
    }

    // The server answers only for a spot: the places within 5 km of it and the nearest five (never a whole county: RENDERER 08:24, the licence question).
    async function loadPlaces() {
      state.places = null; state.placesNote = ''; state.credit = '';
      if (!state.spot) return;
      try {
        const r = await data.perfectCityPlaces(state.county, state.kind, state.spot[1], state.spot[0]);
        if (!r || !(r.loaded > 0)) { state.placesNote = WORDS.noPlaces; return; }
        state.places = Array.isArray(r.places) ? r.places.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)) : [];
        state.credit = typeof r.credit === 'string' ? r.credit : '';
      } catch { state.placesNote = WORDS.placesError; }
    }

    function drawMap() {
      const c = state.census, P = pc.projector(c.bbox, W, H);
      const value = state.shade === 'density' ? (u) => u.density : (u) => (u.income ? u.income[0] : null);
      const br = pc.bands(c.units, value);
      const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pc-svg', role: 'img', 'aria-label': `Map of ${c.name}: block groups shaded by ${SHADES[state.shade].toLowerCase()}${state.spot ? `, a spot at ${state.spot[1].toFixed(4)}, ${state.spot[0].toFixed(4)} with rings at 1, 2 and 5 km` : ''}${state.places ? `, and ${state.places.length} ${KINDS[state.kind].toLowerCase()} near it marked` : ''}` });
      for (const u of c.units) {
        const d = u.rings.map((r) => 'M' + r.map((p) => P.fwd(p).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z').join('');
        const b = pc.band(value(u), br);
        root.append(svg('path', { d, fill: b < 0 ? NO_DATA : FILL[b], stroke: '#14141a', 'stroke-width': '0.4', 'fill-rule': 'evenodd' }));
      }
      if (state.places) for (const p of state.places) {
        const [x, y] = P.fwd([p.lon, p.lat]);
        root.append(svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: '4.5', fill: '#ff9f43', stroke: '#14141a', 'stroke-width': '1.2', class: 'pc-place' }));
      }
      if (state.spot) {
        const [x, y] = P.fwd(state.spot);
        for (const r of pc.RINGS_KM) {
          root.append(svg('circle', { cx: x, cy: y, r: P.kmToPx(r).toFixed(1), fill: 'none', stroke: '#ffd166', 'stroke-width': '2', 'stroke-dasharray': '6 3', class: 'pc-ring' }));
          const t = svg('text', { x: x + 3, y: (y - P.kmToPx(r) - 3).toFixed(1), fill: '#ffd166', 'font-size': '13', 'font-weight': '700', stroke: '#14141a', 'stroke-width': '3', 'paint-order': 'stroke', 'aria-hidden': 'true', class: 'pc-ring-label' });
          t.textContent = `${r} km`;
          root.append(t);
        }
        root.append(svg('circle', { cx: x, cy: y, r: '5', fill: '#ffffff', stroke: '#14141a', 'stroke-width': '1.5', id: 'pc-spot' }));
      }
      root.addEventListener('click', (e) => {
        const box = root.getBoundingClientRect();
        const pt = [((e.clientX - box.left) / box.width) * W, ((e.clientY - box.top) / box.height) * H];
        place(P.inv(pt));
      });
      const legendTitle = SHADES[state.shade] + (state.shade === 'density' ? ' (calculated)' : ' (estimated)');
      const lab = (v) => (state.shade === 'income' ? '$' + fmt(v) : fmt(v));
      const keys = FILL.map((f, i) => h('li', {}, h('span', { class: 'pc-swatch', 'data-fill': f }), ' ',
        i === 0 ? `under ${lab(br[0])}` : i === FILL.length - 1 ? `${lab(br[i - 1])} or more` : `${lab(br[i - 1])} to ${lab(br[i])}`));
      const legend = h('div', { class: 'pc-legend' }, h('p', { class: 'meta' }, legendTitle), h('ul', { class: 'pc-keys' }, keys),
        h('p', { class: 'meta' }, 'Grey: no published figure.' + (state.places ? ' Orange dots: ' + KINDS[state.kind].toLowerCase() + ' within 5 km of the spot, and the nearest five.' : '')));
      // the swatch colours are attributes on SVG squares (the page's CSP allows no inline style)
      legend.querySelectorAll('.pc-swatch').forEach((s) => { const f = s.getAttribute('data-fill'); s.replaceChildren(svg('svg', { width: 14, height: 14, 'aria-hidden': 'true' }, [svg('rect', { width: 14, height: 14, fill: f })])); });
      mapBox.replaceChildren(root, legend);
    }

    // 'about 0' would contradict the block group's own count: when no block-group centre is inside a ring, say so instead.
    const peopleCell = (p) => (p.blockGroups === 0 ? 'no block-group centre inside (see the method below)' : `about ${fmt(p.about)}`);

    function drawResults() {
      const c = state.census;
      if (!state.spot) { results.replaceChildren(h('p', { class: 'form-intro' }, WORDS.pickSpot)); return; }
      const u = pc.unitAt(state.spot, c.units);
      if (!u) { results.replaceChildren(h('p', { class: 'form-note' }, WORDS.outside)); return; }
      const out = [h('h2', {}, 'Around this spot'),
        h('p', { class: 'meta', id: 'pc-spot-text' }, `Spot: ${state.spot[1].toFixed(5)}, ${state.spot[0].toFixed(5)} (latitude, longitude)`),
        h('h3', {}, 'The block group the spot is in'),
        h('ul', { class: 'pc-facts', id: 'pc-unit' },
          h('li', {}, `People: ${u.pop == null ? 'not published' : fmt(u.pop)}`, u.pop == null ? null : h('span', { class: 'pc-label' }, ' observed, 2020 Census')),
          h('li', {}, `People per square kilometre: ${u.density == null ? 'not available' : fmt(u.density)}`, u.density == null ? null : h('span', { class: 'pc-label' }, ' calculated')),
          h('li', {}, `Median household income: ${u.income ? '$' + fmt(u.income[0]) + (u.income[1] ? ` (plus or minus $${fmt(u.income[1])})` : '') : 'not published for this block group'}`, u.income ? h('span', { class: 'pc-label' }, ' estimated, American Community Survey 2019 to 2023') : null),
          h('li', { class: 'meta' }, `Census block group ${u.id}`))];
      const people = pc.peopleWithin(state.spot, c.units);
      if (state.places) {
        const near = pc.nearest(state.spot, state.places, 5), counts = pc.countsWithin(state.spot, state.places);
        out.push(h('h3', {}, `Nearest ${KINDS[state.kind].toLowerCase()}`),
          h('ol', { class: 'pc-facts', id: 'pc-nearest' }, near.map((p) => h('li', {}, `${p.name || '(no name in the map data)'}: ${km1(p.km)} km`, h('span', { class: 'pc-label' }, ' calculated, straight line')))));
        out.push(h('h3', {}, 'Within 1, 2 and 5 km'),
          h('table', { class: 'pc-table', id: 'pc-rings' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Ring'), h('th', { scope: 'col' }, KINDS[state.kind] + ' (calculated)'), h('th', { scope: 'col' }, 'People (estimated)'))),
            h('tbody', {}, counts.map((cnt, i) => h('tr', {}, h('th', { scope: 'row' }, `${cnt.km} km`), h('td', {}, fmt(cnt.count)), h('td', {}, peopleCell(people[i])))))));
      } else {
        out.push(h('h3', {}, 'Within 1, 2 and 5 km'),
          h('table', { class: 'pc-table', id: 'pc-rings' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Ring'), h('th', { scope: 'col' }, 'People (estimated)'))),
            h('tbody', {}, people.map((p) => h('tr', {}, h('th', { scope: 'row' }, `${p.km} km`), h('td', {}, peopleCell(p)))))));
      }
      out.push(h('p', { class: 'meta' }, 'People within a ring: ' + people[0].method + ', rounded to the nearest 100.'));
      results.replaceChildren(...out);
    }

    function drawCredits() {
      const s = state.census.sources;
      credits.replaceChildren(`Sources: ${s.boundaries}; ${s.population}; ${s.income}. ${s.calculated}${state.credit ? ' ' + state.credit + '.' : ''} This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau.`);
    }

    async function place(pt) {
      state.spot = pt; latIn.value = pt[1].toFixed(5); lonIn.value = pt[0].toFixed(5);
      await loadPlaces();
      drawMap(); drawResults(); drawCredits();
      status.textContent = state.placesNote || summaryLine();
    }

    function summaryLine() {
      const u = state.census && state.spot ? pc.unitAt(state.spot, state.census.units) : null;
      if (!u) return WORDS.outside;
      if (!state.places) return 'Spot placed. People and income are below.';
      const c5 = pc.countsWithin(state.spot, state.places)[2].count, n = pc.nearest(state.spot, state.places, 1)[0];
      return `Spot placed: ${c5} ${KINDS[state.kind].toLowerCase()} within 5 km${n ? `, the nearest ${km1(n.km)} km away` : ''}. Details are below.`;
    }

    // Is anything loaded at all? Asked once per county and kind, at the county's middle, so the note shows before any spot (MEDIUM 6).
    async function checkLoaded() {
      if (state.spot) return;
      const [x0, y0, x1, y1] = state.census.bbox;
      try {
        const r = await data.perfectCityPlaces(state.county, state.kind, (y0 + y1) / 2, (x0 + x1) / 2);
        state.placesNote = r && r.loaded > 0 ? '' : WORDS.noPlaces;
      } catch { state.placesNote = WORDS.placesError; }
    }

    async function refresh() {
      status.textContent = 'Loading...';
      try { state.census = await loadCensus(state.county); } catch { status.textContent = 'The map data could not be loaded. Try again later.'; return; }
      kindSelect();
      if (state.spot && !pc.unitAt(state.spot, state.census.units)) state.spot = null;
      await loadPlaces();
      await checkLoaded();
      status.textContent = state.placesNote;
      drawMap(); drawResults(); drawCredits();
    }

    const controls = h('div', { class: 'pc-controls' },
      select('pc-county', 'County', COUNTIES.map((c) => [c.id, c.label]), state.county, (v) => { state.county = v; state.spot = null; refresh(); }), ' ',
      kindWrap, ' ',
      select('pc-shade', 'Shade by', Object.entries(SHADES), state.shade, (v) => { state.shade = v; drawMap(); }));
    kindSelect();
    await refresh();
    return [h('h1', { tabindex: '-1' }, 'Perfect City'), h('p', { class: 'form-intro' }, WORDS.intro), controls, status, mapBox, typed, results,
      h('h2', {}, 'What this does not know'), h('ul', { class: 'soon-more', id: 'pc-not-known' }, WORDS.notKnown.map((t) => h('li', {}, t))), credits,
      h('p', { class: 'form-note', role: 'note' }, 'Draft wording, not yet approved.')];
  }

  window.ryagramPerfectCityPage = Object.freeze({ view, COUNTIES, KINDS, WORDS });
})();
