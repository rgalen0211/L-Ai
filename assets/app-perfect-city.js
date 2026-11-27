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
  const OFFICIAL_KIND = { fast_food: 'limited-service restaurant (fast food)', restaurant: 'full-service restaurant', grocery: 'supermarket and grocery store' };      // the County Business Patterns industry, said as a noun before 'establishments'
  const SHADES = { density: 'People per square kilometre', income: 'Median household income' };
  const FILL = ['#dfe6f3', '#b3c2e0', '#8299c7', '#55699f', '#2f3f73'];      // pale to dark blue (FACES' shade palette B)
  const NO_DATA = '#4a4a52';
  const W = 640, H = 480;
  const WORDS = {
    intro: 'Pick a county and a kind of business, then click the map, or type a latitude and longitude, to put a spot on it. Ryagram shows how far the nearest similar places are, how many are within 1, 2 and 5 km, and about how many people live around the spot.',
    notKnown: ['Distances are straight lines, not drive or walk times.',
      'The business points come from OpenStreetMap, made by volunteers: a place can be missing, closed or out of date.',
      "People within a ring are an estimate: each block group's people are shared by the part of its area inside the ring, as if they were spread evenly.",
      'Median income is a survey estimate with a margin of error, for the whole block group.',
      'There is no success score and no prediction. This shows what is there, not whether a business would do well.',
      'The map shows the places near your spot only: within 5 km, and the nearest five.',
      'One county at a time: places and people across the county line are not counted, even inside a ring.'],
    noPlaces: 'The business points are not loaded yet, so the map shows people and income only.',
    placesError: 'The business points could not be loaded. The map shows people and income only. Try again in a few minutes.',
    badTyped: 'Type a latitude and a longitude as numbers, for example 39.7589 and -84.1916.',
    pickSpot: 'Click the map, or type a latitude and longitude, to put a spot on it.',
    outside: 'That spot is outside the county. Put it inside the shaded area.',
    compareAdd: 'Compare with a second spot',
    compareRemove: 'Remove the second spot',
    pickB: 'Click the map, or type a latitude and longitude, to put spot B.',
    compareMarks: 'Spot A: white circle, yellow dashed rings. Spot B: cyan square, cyan dotted rings.',
    compareNote: 'Each spot is looked up on its own. This shows what is around each spot side by side; it does not say which spot is better.',
    notCounted: 'The Census does not count chicken, burger or pizza places separately.'
  };
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const km1 = (x) => (x < 10 ? x.toFixed(2) : x.toFixed(1));

  function loadCensus(county) {
    const have = () => window.ryagramPerfectCityData && window.ryagramPerfectCityData[county];
    if (have()) return Promise.resolve(have());
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `/assets/perfect-city/${county}.census.js?v=20261127b`;      // b: the County Business Patterns counts (official) added
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
    // spot A is state.spot (with its places); compare mode adds spot B (state.b), asked of the server ON ITS OWN, so the 60-place cap and the daily count apply per spot
    const state = { county: COUNTIES[0].id, kind: 'fast_food', shade: 'density', spot: null, census: null, places: null, loaded: null, placesNote: '', credit: '',
      compare: false, target: 'A', b: { spot: null, places: null, note: '', credit: '' } };
    const noB = () => ({ spot: null, places: null, note: '', credit: '' });
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
    const targetWrap = h('span');
    const compareBar = h('div', { class: 'pc-typed', id: 'pc-compare-bar' });
    const num = (v) => (/^\s*-?\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN);
    const typed = h('form', { class: 'pc-typed', onsubmit: (e) => {
      e.preventDefault();
      const lat = num(latIn.value), lon = num(lonIn.value);
      if (Number.isFinite(lat) && Number.isFinite(lon)) place([lon, lat], state.compare ? state.target : 'A');
      else { status.textContent = WORDS.badTyped; latIn.focus(); }
    } }, h('span', { class: 'meta' }, 'Or type a spot: '), targetWrap,
      h('label', { class: 'pc-control', for: 'pc-lat' }, 'Latitude ', latIn), ' ',
      h('label', { class: 'pc-control', for: 'pc-lon' }, 'Longitude ', lonIn), ' ',
      h('button', { class: 'button secondary', type: 'submit', id: 'pc-go' }, 'Put the spot here'));
    let kindWrap = h('span');

    function kindSelect() {
      const c = COUNTIES.find((x) => x.id === state.county);
      if (!c.kinds.includes(state.kind)) { state.kindNote = `There is no ${KINDS[state.kind].toLowerCase()} data for ${c.label} yet, so the page shows ${KINDS[c.kinds[0]].toLowerCase()}.`; state.kind = c.kinds[0]; }
      const hadFocus = document.activeElement && document.activeElement.id === 'pc-kind';
      kindWrap.replaceChildren(select('pc-kind', 'Business', c.kinds.map((k) => [k, KINDS[k]]), state.kind, (v) => { state.kind = v; refresh(); }));
      if (hadFocus) document.getElementById('pc-kind')?.focus();
    }

    // The server answers only for a spot: the places within 5 km of it and the nearest five (never a whole county: RENDERER 08:24, the licence question).
    // Each spot has its own request token: an older answer that arrives late is dropped, and an answer is used only if it is
    // still for the county, kind and spot it was asked for. A spot outside the county is not asked about at all (no use of the day's count).
    const asked = { A: 0, B: 0 };
    const spotOf = (which) => (which === 'B' ? (state.compare ? state.b.spot : null) : state.spot);
    const keyOf = (spot) => (spot ? [state.county, state.kind, spot[0], spot[1]].join('|') : '');
    async function fetchPlaces(which) {
      const spot = spotOf(which), got = { places: null, note: '', credit: '', loaded: null };
      const mine = ++asked[which];
      if (!spot || !state.census || !pc.unitAt(spot, state.census.units)) return got;      // outside the county: no server call
      const key = keyOf(spot);
      const stale = () => mine !== asked[which] || key !== keyOf(spotOf(which));
      try {
        const r = await data.perfectCityPlaces(state.county, state.kind, spot[1], spot[0]);
        if (stale()) return null;
        got.loaded = r && Number.isFinite(r.loaded) ? r.loaded : null;
        if (!r || !(r.loaded > 0)) { got.note = WORDS.noPlaces; return got; }
        got.places = Array.isArray(r.places) ? r.places.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)) : [];
        got.credit = typeof r.credit === 'string' ? r.credit : '';
      } catch {
        if (stale()) return null;
        got.note = WORDS.placesError;
      }
      return got;
    }
    // true when the answer was used; false when a newer request for that spot superseded it
    async function loadPlaces() {
      const r = await fetchPlaces('A');
      if (!r) return false;
      state.places = r.places; state.placesNote = r.note; state.credit = r.credit; state.loaded = r.loaded;
      return true;
    }
    async function loadPlacesB() {
      const r = await fetchPlaces('B');
      if (!r) return false;
      state.b = { spot: state.b.spot, ...r };
      return true;
    }

    function drawMap() {
      const c = state.census, P = pc.projector(c.bbox, W, H);
      const value = state.shade === 'density' ? (u) => u.density : (u) => (u.income ? u.income[0] : null);
      const br = pc.bands(c.units, value);
      const two = state.compare && state.b.spot;
      const at = (s) => `${s[1].toFixed(4)}, ${s[0].toFixed(4)}`;
      const shown = [];                                      // the places near A, and near B in compare mode, each point once
      const seen = new Set();
      for (const list of [state.places, two ? state.b.places : null]) if (list) for (const p of list) { const k = p.lat + ',' + p.lon; if (!seen.has(k)) { seen.add(k); shown.push(p); } }
      const anyPlaces = !!(state.places || (two && state.b.places));
      const spotsWords = !state.spot ? '' : two ? `, spot A at ${at(state.spot)} and spot B at ${at(state.b.spot)}, each with rings at 1, 2 and 5 km` : `, a spot at ${at(state.spot)} with rings at 1, 2 and 5 km`;
      const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pc-svg', role: 'img', 'aria-label': `Map of ${c.name}: block groups shaded by ${SHADES[state.shade].toLowerCase()}${spotsWords}${anyPlaces ? `, and ${shown.length} ${KINDS[state.kind].toLowerCase()} near ${two ? 'them' : 'it'} marked` : ''}` });
      for (const u of c.units) {
        const d = u.rings.map((r) => 'M' + r.map((p) => P.fwd(p).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z').join('');
        const b = pc.band(value(u), br);
        root.append(svg('path', { d, fill: b < 0 ? NO_DATA : FILL[b], stroke: '#14141a', 'stroke-width': '0.4', 'fill-rule': 'evenodd' }));
      }
      for (const p of shown) {
        const [x, y] = P.fwd([p.lon, p.lat]);
        root.append(svg('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: '6', fill: '#ff9f43', stroke: '#14141a', 'stroke-width': '1.5', class: 'pc-place' }));
      }
      // one spot's rings and mark; in compare mode the ring labels and a letter say which spot (A: white circle, yellow rings; B: blue square, blue rings)
      const drawSpot = (spot, letter) => {
        const [x, y] = P.fwd(spot), b = letter === 'B';
        const colour = b ? '#7bdff2' : '#ffd166';
        for (const r of pc.RINGS_KM) {
          root.append(svg('circle', { cx: x, cy: y, r: P.kmToPx(r).toFixed(1), fill: 'none', stroke: colour, 'stroke-width': '2', 'stroke-dasharray': b ? '2 3' : '6 3', class: b ? 'pc-ring pc-ring-b' : 'pc-ring' }));
        }
        // no ring labels on the map: at county scale the 1 and 2 km rings sit a few pixels apart (re-walk HIGH 1); the legend names them
        if (b) root.append(svg('rect', { x: x - 7, y: y - 7, width: 14, height: 14, fill: colour, stroke: '#14141a', 'stroke-width': '2', id: 'pc-spot-b' }));
        else root.append(svg('circle', { cx: x, cy: y, r: '8', fill: '#ffffff', stroke: '#14141a', 'stroke-width': '2', id: 'pc-spot' }));
        if (letter) {
          const t = svg('text', { x: x + 10, y: y + 7, fill: '#ffffff', 'font-size': '22', 'font-weight': '700', stroke: '#14141a', 'stroke-width': '4', 'paint-order': 'stroke', 'aria-hidden': 'true', class: 'pc-spot-letter' });
          t.textContent = letter;
          root.append(t);
        }
      };
      if (state.spot) drawSpot(state.spot, state.compare ? 'A' : '');
      if (two) drawSpot(state.b.spot, 'B');
      root.addEventListener('click', (e) => {
        const box = root.getBoundingClientRect();
        const pt = [((e.clientX - box.left) / box.width) * W, ((e.clientY - box.top) / box.height) * H];
        place(P.inv(pt), state.compare ? state.target : 'A');
      });
      const legendTitle = SHADES[state.shade] + (state.shade === 'density' ? ' (calculated)' : ' (estimated)');
      const lab = (v) => (state.shade === 'income' ? '$' + fmt(v) : fmt(v));
      const keys = FILL.map((f, i) => h('li', {}, h('span', { class: 'pc-swatch', 'data-fill': f }), ' ',
        i === 0 ? `under ${lab(br[0])}` : i === FILL.length - 1 ? `${lab(br[i - 1])} or more` : `${lab(br[i - 1])} to ${lab(br[i])}`));
      const legend = h('div', { class: 'pc-legend' }, h('p', { class: 'meta' }, legendTitle), h('ul', { class: 'pc-keys' }, keys),
        h('p', { class: 'meta' }, 'Grey: no published figure.' + (two ? ' Rings: 1, 2 and 5 km around each spot (A: white circle, yellow dashes; B: cyan square, cyan dotted rings).' : state.spot ? ' Dashed yellow rings: 1, 2 and 5 km around the spot (white dot).' : '') + (!anyPlaces ? '' : two ? ' Orange dots: ' + KINDS[state.kind].toLowerCase() + ' within 5 km of either spot, and the nearest five to each.' : ' Orange dots: ' + KINDS[state.kind].toLowerCase() + ' within 5 km of the spot, and the nearest five.')));
      // the swatch colours are attributes on SVG squares (the page's CSP allows no inline style)
      legend.querySelectorAll('.pc-swatch').forEach((s) => { const f = s.getAttribute('data-fill'); s.replaceChildren(svg('svg', { width: 14, height: 14, 'aria-hidden': 'true' }, [svg('rect', { width: 14, height: 14, fill: f })])); });
      mapBox.replaceChildren(root, legend);
    }

    // The official count beside the map data (County Business Patterns, public domain), so a stranger can see how complete the map data is.
    // A code with no published row is 'fewer than 3 or none (not published)', never 0. There is no CBP code for chicken, burger or pizza.
    function officialLine() {
      const o = state.census.official;
      if (!o || !o.kinds) return null;
      const k = o.kinds[state.kind];
      if (!k) return o.not_counted && o.not_counted.includes(state.kind) ? h('p', { class: 'meta', id: 'pc-official' }, WORDS.notCounted) : null;
      const name = OFFICIAL_KIND[state.kind] || k.label.toLowerCase();
      const what = name.endsWith(')') ? `${name.slice(0, -1)}, NAICS ${k.naics})` : `${name} (NAICS ${k.naics})`;      // 'restaurant (fast food, NAICS 722513)'
      const n = Number.isFinite(k.est) ? fmt(k.est) : 'fewer than 3 or none (not published)';
      const m = state.loaded == null ? 'the map data count is not known' : `the map data has ${fmt(state.loaded)} of this kind loaded`;
      return h('p', { class: 'meta', id: 'pc-official' }, `Census County Business Patterns ${o.year} counts ${n} ${what} establishments in this county (observed); ${m}.`);
    }


    // area weighting counts any block group the ring touches; if none is touched, say so instead of a bare 0.
    const peopleCell = (p) => (p.blockGroups === 0 ? 'none counted (see the method below)' : `about ${fmt(p.about)}`);

    // Compare mode: one table, a row per figure, a column per spot. No 'better' column and no score (the page's rule: no success score).
    function drawCompare() {
      const c = state.census, kind = KINDS[state.kind];
      const col = (spot, places) => {
        const u = spot ? pc.unitAt(spot, c.units) : null;
        return { spot, u, places, people: u ? pc.peopleWithinArea(spot, c.units) : null,
          counts: u && places ? pc.countsWithin(spot, places) : null, near: u && places ? pc.nearest(spot, places, 1)[0] : null };
      };
      const cols = [col(state.spot, state.places), col(state.b.spot, state.b.places)];
      // every cell says why when there is no figure: not placed yet, outside the county, or the business points not loaded
      const cell = (k, f) => (!k.spot ? 'not placed yet' : !k.u ? 'outside the county' : f(k));
      const placesCell = (k, f) => cell(k, (x) => (x.places ? f(x) : 'business points not loaded'));
      const row = (head, label, f) => h('tr', {}, h('th', { scope: 'row' }, head, label ? h('span', { class: 'pc-label' }, ' ' + label) : null), ...cols.map((k) => h('td', {}, f(k))));
      const rows = [
        row('Spot (latitude, longitude)', '', (k) => (k.spot ? `${k.spot[1].toFixed(5)}, ${k.spot[0].toFixed(5)}` : 'not placed yet')),
        row('Census block group', '', (k) => cell(k, (x) => x.u.id)),
        row("People in the spot's block group", 'observed, 2020 Census', (k) => cell(k, (x) => (x.u.pop == null ? 'not published' : fmt(x.u.pop)))),
        row('People per square kilometre in the block group', 'calculated', (k) => cell(k, (x) => (x.u.density == null ? 'not available' : fmt(x.u.density)))),
        row('Median household income in the block group', 'estimated, American Community Survey 2019 to 2023', (k) => cell(k, (x) => (x.u.income ? '$' + fmt(x.u.income[0]) + (x.u.income[1] ? ` (plus or minus $${fmt(x.u.income[1])}, the survey's 90% margin of error)` : '') : 'not published for this block group'))),
        row(`Nearest ${kind.toLowerCase()}`, 'calculated, straight line', (k) => placesCell(k, (x) => (x.near ? `${km1(x.near.km)} km (${x.near.name || 'no name in the map data'})` : 'none found'))),
        ...pc.RINGS_KM.map((r, i) => row(`${kind} within ${r} km`, 'calculated', (k) => placesCell(k, (x) => fmt(x.counts[i].count)))),
        ...pc.RINGS_KM.map((r, i) => row(`People within ${r} km`, 'estimated', (k) => cell(k, (x) => peopleCell(x.people[i]))))
      ];
      results.replaceChildren(h('h2', {}, 'Two spots side by side'),
        h('div', { class: 'pc-table-wrap' }, h('table', { class: 'pc-table pc-compare', id: 'pc-compare' },
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Figure'), h('th', { scope: 'col' }, 'Spot A'), h('th', { scope: 'col' }, 'Spot B'))),
          h('tbody', {}, rows))),
        h('p', { class: 'meta' }, WORDS.compareNote),
        h('p', { class: 'meta' }, 'People within a ring: ' + pc.peopleWithinArea(state.spot, []).at(0).method + ', rounded to the nearest 100.'));
    }

    function drawCompareBar() {
      if (!state.spot) { compareBar.replaceChildren(); targetWrap.replaceChildren(); return; }
      if (!state.compare) {
        compareBar.replaceChildren(h('button', { class: 'button secondary', type: 'button', id: 'pc-compare-add', onclick: () => {
          state.compare = true; state.target = 'B'; state.b = noB(); latIn.value = ''; lonIn.value = '';
          drawAll(); status.textContent = WORDS.pickB; document.getElementById('pc-compare-remove')?.focus();
        } }, WORDS.compareAdd));
        targetWrap.replaceChildren();
        return;
      }
      compareBar.replaceChildren(h('button', { class: 'button secondary', type: 'button', id: 'pc-compare-remove', onclick: () => {
        state.compare = false; state.target = 'A'; state.b = noB(); latIn.value = state.spot[1].toFixed(5); lonIn.value = state.spot[0].toFixed(5);
        drawAll(); status.textContent = state.placesNote || summaryLine(); document.getElementById('pc-compare-add')?.focus();
      } }, WORDS.compareRemove), ' ', h('span', { class: 'meta', id: 'pc-marks' }, WORDS.compareMarks));
      // the typed form says which spot it moves (keyboard path for spot B)
      targetWrap.replaceChildren(select('pc-target', 'Spot', [['A', 'Spot A'], ['B', 'Spot B']], state.target, (v) => {
        state.target = v; const s = v === 'B' ? state.b.spot : state.spot;
        latIn.value = s ? s[1].toFixed(5) : ''; lonIn.value = s ? s[0].toFixed(5) : '';
      }), ' ');
    }

    function drawAll() { drawMap(); drawResults(); drawCredits(); drawCompareBar(); }

    function drawResults() {
      const c = state.census;
      if (state.compare && state.spot) { drawCompare(); return; }
      if (!state.spot) { results.replaceChildren(h('p', { class: 'form-intro' }, WORDS.pickSpot)); return; }
      const u = pc.unitAt(state.spot, c.units);
      if (!u) { results.replaceChildren(h('p', { class: 'form-note' }, WORDS.outside)); return; }
      const out = [h('h2', {}, 'Around this spot'),
        h('p', { class: 'meta', id: 'pc-spot-text' }, `Spot: ${state.spot[1].toFixed(5)}, ${state.spot[0].toFixed(5)} (latitude, longitude)`),
        h('h3', {}, 'The block group the spot is in'),
        h('ul', { class: 'pc-facts', id: 'pc-unit' },
          h('li', {}, `People: ${u.pop == null ? 'not published' : fmt(u.pop)}`, u.pop == null ? null : h('span', { class: 'pc-label' }, ' observed, 2020 Census')),
          h('li', {}, `People per square kilometre: ${u.density == null ? 'not available' : fmt(u.density)}`, u.density == null ? null : h('span', { class: 'pc-label' }, ' calculated')),
          h('li', {}, `Median household income: ${u.income ? '$' + fmt(u.income[0]) + (u.income[1] ? ` (plus or minus $${fmt(u.income[1])}, the survey's 90% margin of error)` : '') : 'not published for this block group'}`, u.income ? h('span', { class: 'pc-label' }, ' estimated, American Community Survey 2019 to 2023') : null),
          h('li', { class: 'meta' }, `Census block group ${u.id}`))];
      const people = pc.peopleWithinArea(state.spot, c.units);
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
      const off = officialLine();
      if (off) out.push(off);
      out.push(h('p', { class: 'meta' }, 'People within a ring: ' + people[0].method + ', rounded to the nearest 100.'));
      results.replaceChildren(...out);
    }

    function drawCredits() {
      const s = state.census.sources;
      const o = state.census.official;
      const credit = state.credit || (state.compare ? state.b.credit : '');
      credits.replaceChildren(`Sources: ${s.boundaries}; ${s.population}; ${s.income}${o && o.source ? '; ' + o.source.replace(/\.$/, '') : ''}. ${s.calculated}${credit ? ' ' + credit + ' (' : ''}`,
        credit ? h('a', { href: 'https://www.openstreetmap.org/copyright', rel: 'noopener', target: '_blank' }, 'openstreetmap.org/copyright') : '',
        `${credit ? ').' : ''} This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau.`);
    }

    // which: 'A' or 'B'. Only the spot that moved is asked about again (each spot is its own server call).
    async function place(pt, which = 'A') {
      latIn.value = pt[1].toFixed(5); lonIn.value = pt[0].toFixed(5);
      let fresh;
      if (which === 'B' && state.compare) { state.b.spot = pt; fresh = await loadPlacesB(); } else { state.spot = pt; fresh = await loadPlaces(); }
      if (!fresh) return;                                          // a newer spot was put down meanwhile: that one draws
      drawAll();
      status.textContent = statusLine();
    }

    function statusLine() {
      if (!state.compare) return state.placesNote || summaryLine();
      const notes = [...new Set([state.placesNote, state.b.note].filter(Boolean))];
      return [...notes, summaryLine()].join(' ');
    }

    // one spot in words, for the status line in compare mode
    function spotWords(name, spot, places) {
      if (!spot) return `${name}: not placed yet.`;
      if (!pc.unitAt(spot, state.census.units)) return `${name}: outside the county.`;
      if (!places) return `${name}: placed, people and income only.`;
      const c5 = pc.countsWithin(spot, places)[2].count, n = pc.nearest(spot, places, 1)[0];
      return `${name}: ${c5} ${KINDS[state.kind].toLowerCase()} within 5 km${n ? `, the nearest ${km1(n.km)} km away` : ''}.`;
    }

    function summaryLine() {
      if (state.compare && state.census) {
        return `Comparing two spots. ${spotWords('Spot A', state.spot, state.places)} ${spotWords('Spot B', state.b.spot, state.b.places)} ${state.b.spot ? 'The table below shows them side by side.' : WORDS.pickB}`;
      }
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
        state.loaded = r && Number.isFinite(r.loaded) ? r.loaded : null;
        state.placesNote = r && r.loaded > 0 ? '' : WORDS.noPlaces;
      } catch { state.placesNote = WORDS.placesError; }
    }

    async function refresh() {
      status.textContent = 'Loading...';
      try { state.census = await loadCensus(state.county); } catch { status.textContent = 'The map data could not be loaded. Try again later.'; return; }
      kindSelect();
      await loadPlaces();
      if (state.compare) await loadPlacesB();
      await checkLoaded();
      drawAll();
      status.textContent = state.compare ? statusLine() : (state.placesNote || (state.spot ? summaryLine() : '') || state.kindNote || '');
      state.kindNote = '';
    }

    const controls = h('div', { class: 'pc-controls' },
      select('pc-county', 'County', COUNTIES.map((c) => [c.id, c.label]), state.county, (v) => { state.county = v; state.spot = null; state.compare = false; state.target = 'A'; state.b = noB(); state.kindNote = `County changed to ${COUNTIES.find((c) => c.id === v).label}: put a spot on the map.`; refresh(); }), ' ',
      kindWrap, ' ',
      select('pc-shade', 'Shade by', Object.entries(SHADES), state.shade, (v) => { state.shade = v; drawMap(); }));
    kindSelect();
    await refresh();
    return [h('h1', { tabindex: '-1' }, 'Perfect City'), h('p', { class: 'form-intro' }, WORDS.intro), controls, status, mapBox, compareBar, typed, results,
      h('h2', {}, 'What this does not know'), h('ul', { class: 'soon-more', id: 'pc-not-known' }, WORDS.notKnown.map((t) => h('li', {}, t))), credits,
      h('p', { class: 'form-note', role: 'note' }, 'Draft wording, not yet approved.')];
  }

  window.ryagramPerfectCityPage = Object.freeze({ view, COUNTIES, KINDS, WORDS });
})();
