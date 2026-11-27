// Perfect City, the first working page (GEO 11-27; department geo_intelligence, behind the per-account switch perfectCity).
// The person picks a county and a kind of business, then puts a spot on the map. The page shows the nearest similar places
// (straight-line distance), how many are within 1, 2 and 5 km, and about how many people live around the spot, with the
// block group's people, density and median income. EVERY number says observed, calculated or estimated, and the page says
// what it does not know. Census layers ship with the page (public domain); the business points come from the server only
// (public.perfect_city_places: OpenStreetMap, private until attorney row G11; bank branches from the FDIC Summary of Deposits), and the page says so when they are missing.
// The credit on screen is the one the server sends for the kind (OpenStreetMap, or FDIC for bank branches).
// All public words here are DRAFT, FOR RYAN'S YES.
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const COUNTIES = [
    { id: 'montgomery_oh', label: 'Montgomery County, Ohio (Dayton)', kinds: ['fast_food', 'restaurant', 'chicken', 'burger', 'pizza', 'sandwich', 'mexican', 'asian', 'grocery', 'bank'] },
    { id: 'greene_oh', label: 'Greene County, Ohio (Beavercreek, Xenia)', kinds: ['fast_food', 'restaurant', 'chicken', 'burger', 'pizza', 'sandwich', 'mexican', 'asian', 'bank'] }
  ];
  const KINDS = { fast_food: 'Fast food', restaurant: 'Restaurants', chicken: 'Chicken places', burger: 'Burger places', pizza: 'Pizza places', sandwich: 'Sandwich places', mexican: 'Mexican places', asian: 'Asian places', grocery: 'Supermarkets', bank: 'Bank branches' };      // chicken ... asian: the Ryagram engine's rules (tools/perfect-city/export_perfect_city.py SUBKINDS); bank: FDIC, not OpenStreetMap
  const KIND_ONE = { fast_food: 'fast food place', restaurant: 'restaurant', chicken: 'chicken place', burger: 'burger place', pizza: 'pizza place', sandwich: 'sandwich place', mexican: 'Mexican place', asian: 'Asian place', grocery: 'supermarket', bank: 'bank branch' };      // one of a kind: '1 restaurant', never '1 restaurants' (CC1 09:43)
  const kindLower = (k) => KINDS[k].replace(/^\S+/, (w) => (w === 'Mexican' || w === 'Asian' ? w : w.toLowerCase()));      // 'fast food', 'chicken places', but 'Mexican places'
  const kindWords = (kind, n) => (n === 1 ? KIND_ONE[kind] : kind === 'fast_food' ? 'fast food places' : kindLower(kind));      // a counted phrase: '8 fast food places', never '8 fast food' (GEO 11-27)
  const sourceOf = (kind) => (kind === 'bank' ? 'the FDIC branch list' : 'OpenStreetMap');      // where the business points of this kind come from, in page words
  // What each food sub-kind's sorting rule misses, said under the results (the Ryagram engine's limits, in page words). A place is in one food kind at most:
  // the kinds are checked in the order chicken, burger, pizza, sandwich, Mexican, Asian, and the first that fits wins.
  const KIND_LIMITS = {
    chicken: 'Chicken places are sorted by the map data\'s cuisine tag or a known chain name, so a place with neither is missed.',
    burger: 'Burger places are sorted by the map data\'s cuisine tag or a known chain name, so a place with neither is missed. A place also tagged chicken is counted there instead.',
    pizza: 'Pizza places are sorted by the map data\'s cuisine tag or a known chain name, so a place with neither is missed. A place also tagged chicken or burger is counted there instead.',
    sandwich: 'Sandwich places are sorted by the map data\'s cuisine tag or a known chain name, so a place with neither is missed. The kinds are checked in the order chicken, burger, pizza, sandwich, Mexican, Asian, so a place also tagged chicken, burger or pizza is counted there instead.',
    mexican: 'Mexican places are sorted by the map data\'s cuisine tag or a known chain name, so a place with neither is missed. The kinds are checked in the order chicken, burger, pizza, sandwich, Mexican, Asian, so a place also tagged one of the first four is counted there instead.',
    asian: 'Asian places are sorted by the map data\'s cuisine tag or a known chain name. Indian places are not counted here. Independent places are often not tagged with a cuisine, so Asian places are undercounted.',
    bank: 'FDIC-insured bank branches only. Credit unions are not included.'      // not a sorting rule: the FDIC list's own limit
  };
  const OFFICIAL_KIND = { fast_food: 'limited-service restaurants (fast food)', restaurant: 'full-service restaurants', grocery: 'supermarkets and grocery stores' };      // the County Business Patterns industry in plain words: no industry code on the page (CC1 09:48)
  // Kinds whose official line is said in its own plain words (County Business Patterns commercial banking, for bank; the code stays in the data file).
  const OFFICIAL_PLAIN = { bank: 'bank offices' };
  const OSM_CREDIT = /OpenStreetMap/;      // only the OpenStreetMap credit carries the link to its copyright page
  const SHADES = { density: 'People per square kilometre', income: 'Median household income' };
  const FILL = ['#dfe6f3', '#b3c2e0', '#8299c7', '#55699f', '#2f3f73'];      // pale to dark blue (FACES' shade palette B)
  const NO_DATA = '#4a4a52';
  const W = 640, H = 480;
  const WORDS = {
    intro: 'Pick a county and a kind of business, then tap or click the map, or type a latitude and longitude, to put a spot on it. Ryagram shows how far the nearest similar places are, how many are within 1, 2 and 5 km, and about how many people live around the spot.',
    notKnown: ['Distances are straight lines, not drive or walk times.',
      'The business points come from OpenStreetMap, made by volunteers: a place can be missing, closed or out of date.',
      "People within a ring are an estimate: each block group's people are shared by the part of its area inside the ring, as if they were spread evenly.",
      'Median income is a survey estimate with a margin of error, for the whole block group.',
      'There is no success score and no prediction. This shows what is there, not whether a business would do well.',
      'The map shows the places near your spot only: within 5 km, and the nearest five, at most the nearest 60.',
      'One county at a time: places and people across the county line are not counted, even inside a ring.'],
    // for bank branches the second line says the FDIC list's limits instead of OpenStreetMap's
    notKnownBank: 'The bank branches come from the FDIC Summary of Deposits, a yearly list as of June 30: a branch opened or closed since then can be missing or still listed.',
    noPlaces: 'The business points are not loaded yet, so the map shows people and income only.',
    placesError: 'The business points could not be loaded. The map shows people and income only. Try again in a few minutes.',
    badTyped: 'Type a latitude (from -90 to 90) and a longitude (from -180 to 180) as numbers, with a point before the decimals (a comma is not accepted), for example 39.7589 and -84.1916.',
    retry: 'Try again',
    retrying: 'Trying again...',
    stillFailing: 'Still not working. Try again in a few minutes.',
    looking: 'Looking up the places near this spot...',
    capped: 'There are more places near this spot than one answer carries (the nearest 60), so counts that reach past the 60th place say at least.',
    mapCapped: 'The map shows only the nearest 60 places. The counts within 1, 2 and 5 km are of every place loaded.',
    pickSpot: 'Tap or click the map, or type a latitude and longitude, to put a spot on it.',
    outside: 'That spot is outside the county. Put it inside the shaded area.',
    compareAdd: 'Compare with a second spot',
    compareRemove: 'Remove the second spot',
    pickB: 'Tap or click the map, or type a latitude and longitude, to put spot B.',
    compareMarks: 'Spot A: white circle, yellow dashed rings. Spot B: cyan square, cyan dotted rings.',
    compareNote: 'Each spot is looked up on its own. This shows what is around each spot side by side; it does not say which spot is better.',
    notCounted: 'The Census does not count chicken, burger, pizza, sandwich, Mexican or Asian places separately.'
  };
  // what the page does not know, for the kind on screen: bank branches swap the OpenStreetMap line for the FDIC list's
  const notKnownFor = (kind) => WORDS.notKnown.map((t) => (kind === 'bank' && /OpenStreetMap/.test(t) ? WORDS.notKnownBank : t));
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const km1 = (x) => (x < 10 ? x.toFixed(2) : x.toFixed(1));
  const nearAway = (x) => (km1(x) === '0.00' ? 'right at this spot (under 10 m)' : `${km1(x)} km away`);      // never 'the nearest 0.00 km away' (GEO 11-27)
  // The Census top-codes median household income at 250001, meaning "$250,000 or more"; its margin is then not a real figure (WORKER 10:17)
  const TOP_INCOME = 250001;
  const incomeText = (inc) => (!inc ? 'not published for this block group'
    : inc[0] >= TOP_INCOME ? '$250,000 or more (the survey does not publish higher; no margin of error is given for it)'
      : '$' + fmt(inc[0]) + (inc[1] ? ` (plus or minus $${fmt(inc[1])}, the survey's 90% margin of error)` : ''));
  // the spot sent to the server: 4 decimals (about 11 m), like perfect_city_summary_for; half away from zero, as Postgres round() does
  const r4 = (x) => Math.sign(x) * Math.round(Math.abs(x) * 1e4) / 1e4;

  function loadCensus(county) {
    const have = () => window.ryagramPerfectCityData && window.ryagramPerfectCityData[county];
    if (have()) return Promise.resolve(have());
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `/assets/perfect-city/${county}.census.js?v=20261127pcm1`;      // pcm1: sources.income_years (pcf2) with not_counted naming sandwich, mexican and asian and the bank count (more-kinds d); b: the County Business Patterns counts
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
    const state = { county: COUNTIES[0].id, kind: 'fast_food', shade: 'density', spot: null, census: null, places: null, within: null, capKm: null, loaded: null, placesNote: '', credit: '',
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
    const notKnownList = h('ul', { class: 'soon-more', id: 'pc-not-known' }, notKnownFor(state.kind).map((t) => h('li', {}, t)));      // redrawn with the credits when the kind changes
    const latIn = h('input', { id: 'pc-lat', type: 'text', inputmode: 'decimal', size: '9', placeholder: '39.7589', autocomplete: 'off' });
    const lonIn = h('input', { id: 'pc-lon', type: 'text', inputmode: 'decimal', size: '9', placeholder: '-84.1916', autocomplete: 'off' });
    const targetWrap = h('span');
    const compareBar = h('div', { class: 'pc-typed', id: 'pc-compare-bar' });
    // +39.7589, .5 and 39. are numbers; a comma decimal (39,7589) is not, and the message says so
    const num = (v) => (/^\s*[+-]?(\d+\.?\d*|\.\d+)\s*$/.test(v) ? Number(v) : NaN);
    // a refused typed spot is said next to the form too (role=alert), not only in #pc-status above the map, far away on a phone (WEB 10:19)
    const typedAlert = h('p', { class: 'form-note', id: 'pc-typed-alert', role: 'alert' });
    const typed = h('form', { class: 'pc-typed', onsubmit: (e) => {
      e.preventDefault();
      const lat = num(latIn.value), lon = num(lonIn.value);
      if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) { typedAlert.textContent = ''; place([lon, lat], state.compare ? state.target : 'A'); }
      else {
        // the results stay for the spot already put down: say which one, so the bad text in the box is not read as their spot
        const shown = state.census && state.spot && pc.unitAt(state.spot, state.census.units) ? state.spot : null;
        status.textContent = WORDS.badTyped + (!shown ? '' : state.compare ? ' The results below are still for the spots already on the map.'
          : ` The results below are still for the spot at ${shown[1].toFixed(5)}, ${shown[0].toFixed(5)}.`);
        typedAlert.textContent = status.textContent;
        latIn.focus();
      }
    } },h('span', { class: 'meta' }, 'Or type a spot: '), targetWrap,
      h('label', { class: 'pc-control', for: 'pc-lat' }, 'Latitude ', latIn), ' ',
      h('label', { class: 'pc-control', for: 'pc-lon' }, 'Longitude ', lonIn), ' ',
      h('button', { class: 'button secondary', type: 'submit', id: 'pc-go' }, 'Put the spot here'), typedAlert);
    let kindWrap = h('span');

    function kindSelect() {
      const c = COUNTIES.find((x) => x.id === state.county);
      if (!c.kinds.includes(state.kind)) { state.kindNote = `${KINDS[state.kind]}: no places of this kind are loaded for ${c.label} yet, so the page shows ${kindLower(c.kinds[0])} instead.`; state.kind = c.kinds[0]; }
      const hadFocus = document.activeElement && document.activeElement.id === 'pc-kind';
      kindWrap.replaceChildren(select('pc-kind', 'Business', c.kinds.map((k) => [k, KINDS[k]]), state.kind, (v) => { state.kind = v; refresh(); }));
      if (hadFocus) document.getElementById('pc-kind')?.focus();
    }

    // The server answers only for a spot: the places within 5 km of it and the nearest five (never a whole county: RENDERER 08:24, the licence question).
    // Each spot has its own request token: an older answer that arrives late is dropped, and an answer is used only if it is
    // still for the county, kind and spot it was asked for. A spot outside the county is not asked about at all (no use of the day's count).
    const asked = { A: 0, B: 0 };
    // the server's true ring counts {1: n, 2: n, 5: n}, or null when it sent none (an older server) or any is not a whole number
    const withinOf = (r) => {
      const w = r && r.within, out = {};
      if (!w || typeof w !== 'object') return null;
      for (const k of pc.RINGS_KM) { const n = w[String(k)]; if (!Number.isInteger(n) || n < 0) return null; out[k] = n; }
      return out;
    };
    const spotOf = (which) => (which === 'B' ? (state.compare ? state.b.spot : null) : state.spot);
    const keyOf = (spot) => (spot ? [state.county, state.kind, spot[0], spot[1]].join('|') : '');
    async function fetchPlaces(which) {
      const spot = spotOf(which), got = { places: null, note: '', credit: '', loaded: null, capKm: null, within: null };
      const mine = ++asked[which];
      if (!spot || !state.census || !pc.unitAt(spot, state.census.units)) return got;      // outside the county: no server call
      if (state.dayLimit) { got.note = state.dayLimit; return got; }                       // the day's limit was reached: ask nothing more today
      const key = keyOf(spot);
      const stale = () => mine !== asked[which] || key !== keyOf(spotOf(which));
      try {
        const r = await data.perfectCityPlaces(state.county, state.kind, r4(spot[1]), r4(spot[0]));
        if (stale()) return null;
        got.loaded = r && Number.isFinite(r.loaded) ? r.loaded : null;
        if (!r || !(r.loaded > 0)) { got.note = WORDS.noPlaces; return got; }
        got.places = Array.isArray(r.places) ? r.places.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)) : [];
        got.credit = typeof r.credit === 'string' ? r.credit : '';
        // at the cap the answer holds only the nearest N: counts are exact only for rings inside the farthest place sent
        if (got.places.length >= (Number.isFinite(r.max_places) ? r.max_places : 60)) got.capKm = Math.max(...got.places.map((q) => pc.km(spot, [q.lon, q.lat])));
        got.within = withinOf(r);
      } catch (e) {
        if (stale()) return null;
        if (/today.s limit/i.test(String(e && e.message))) { state.dayLimit = String(e.message); got.note = state.dayLimit; }
        else got.note = WORDS.placesError;
      }
      return got;
    }
    // true when the answer was used; false when a newer request for that spot superseded it
    async function loadPlaces() {
      const r = await fetchPlaces('A');
      if (!r) return false;
      state.places = r.places; state.placesNote = r.note; state.credit = r.credit; state.loaded = r.loaded; state.capKm = r.capKm; state.within = r.within;
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
      // a spot outside the county is never drawn (no dot, no rings in the empty corner): the status line says it is outside, once
      const inA = !!(state.spot && pc.unitAt(state.spot, c.units)), inB = !!(two && pc.unitAt(state.b.spot, c.units));
      const spotsWords = inA && inB ? `, spot A at ${at(state.spot)} and spot B at ${at(state.b.spot)}, each with rings at 1, 2 and 5 km`
        : inA ? `, ${two ? 'spot A' : 'a spot'} at ${at(state.spot)} with rings at 1, 2 and 5 km` : inB ? `, spot B at ${at(state.b.spot)} with rings at 1, 2 and 5 km` : '';
      const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pc-svg', role: 'img', 'aria-label': `Map of ${c.name}: block groups shaded by ${SHADES[state.shade].toLowerCase()}${spotsWords}${anyPlaces ? `, and ${shown.length} ${kindWords(state.kind, shown.length)} near ${two ? 'them' : 'it'} marked` : ''}` });
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
          // B's rings are a little heavier than A's: thin dots read faint on a phone, where the map is drawn at about half size (RENDERER 09:19)
          root.append(svg('circle', { cx: x, cy: y, r: P.kmToPx(r).toFixed(1), fill: 'none', stroke: colour, 'stroke-width': b ? '3.5' : '2', 'stroke-dasharray': b ? '4 3' : '6 3', class: b ? 'pc-ring pc-ring-b' : 'pc-ring' }));
        }
        // no ring labels on the map: at county scale the 1 and 2 km rings sit a few pixels apart (re-walk HIGH 1); the legend names them
        if (b) root.append(svg('rect', { x: x - 9, y: y - 9, width: 18, height: 18, fill: colour, stroke: '#14141a', 'stroke-width': '3', id: 'pc-spot-b' }));
        else root.append(svg('circle', { cx: x, cy: y, r: '8', fill: '#ffffff', stroke: '#14141a', 'stroke-width': '2', id: 'pc-spot' }));
        if (letter) {
          const t = svg('text', { x: x + 10, y: y + 7, fill: '#ffffff', 'font-size': '22', 'font-weight': '700', stroke: '#14141a', 'stroke-width': '4', 'paint-order': 'stroke', 'aria-hidden': 'true', class: 'pc-spot-letter' });
          t.textContent = letter;
          root.append(t);
        }
      };
      if (inA) drawSpot(state.spot, state.compare ? 'A' : '');
      if (inB) drawSpot(state.b.spot, 'B');
      root.addEventListener('click', (e) => {
        if (state.loading) return;                                   // a county is loading: this map is the old one
        const box = root.getBoundingClientRect();
        const pt = [((e.clientX - box.left) / box.width) * W, ((e.clientY - box.top) / box.height) * H];
        typedAlert.textContent = '';
        // after a map click the keyboard and screen reader land on the results heading, not left on the map (WEB 10:19)
        place(P.inv(pt), state.compare ? state.target : 'A').then((drawn) => { if (drawn) document.getElementById('pc-results-head')?.focus(); });
      });
      const legendTitle = SHADES[state.shade] + (state.shade === 'density' ? ' (calculated)' : ' (estimated)');
      const lab = (v) => (state.shade === 'income' ? (v >= TOP_INCOME ? '$250,000' : '$' + fmt(v)) : fmt(v));
      // no break points (no published figure at all, or too few): one plain swatch line, never "under NaN" (WORKER 10:17)
      const keys = !br.length ? [h('li', {}, h('span', { class: 'pc-swatch', 'data-fill': FILL[0] }), ' ', 'every block group with a published figure (too few figures to band)')]
        : FILL.map((f, i) => h('li', {}, h('span', { class: 'pc-swatch', 'data-fill': f }), ' ',
          i === 0 ? `under ${lab(br[0])}` : i === FILL.length - 1 ? `${lab(br[i - 1])} or more` : `${lab(br[i - 1])} to ${lab(br[i])}`));
      const capNote = state.capKm != null || (two && state.b.capKm != null) ? ', at most the nearest 60' : '';
      const legend = h('div', { class: 'pc-legend' }, h('p', { class: 'meta' }, legendTitle), h('ul', { class: 'pc-keys' }, keys),
        h('p', { class: 'meta' }, 'Grey: no published figure.' + (inA && inB ? ' Rings: 1, 2 and 5 km around each spot (A: white circle, yellow dashes; B: cyan square, cyan dotted rings).' : inA ? ' Dashed yellow rings: 1, 2 and 5 km around the spot (white dot).' : inB ? ' Cyan dotted rings: 1, 2 and 5 km around spot B (cyan square).' : '') + (!anyPlaces ? '' : two ? ' Orange dots: ' + kindLower(state.kind) + ' within 5 km of either spot, and the nearest five to each' + capNote + '.' : ' Orange dots: ' + kindLower(state.kind) + ' within 5 km of the spot, and the nearest five' + capNote + '.')));
      // the swatch colours are attributes on SVG squares (the page's CSP allows no inline style)
      legend.querySelectorAll('.pc-swatch').forEach((s) => { const f = s.getAttribute('data-fill'); s.replaceChildren(svg('svg', { width: 14, height: 14, 'aria-hidden': 'true' }, [svg('rect', { width: 14, height: 14, fill: f })])); });
      mapBox.replaceChildren(root, legend);
    }

    // The official count beside the map data (County Business Patterns, public domain), so a stranger can see how complete the map data is.
    // A code with no published row is 'fewer than 3 or none (not published)', never 0. There is no CBP code for chicken, burger, pizza, sandwich, Mexican or Asian places.
    function officialLine() {
      const o = state.census.official;
      if (!o || !o.kinds) return null;
      const k = o.kinds[state.kind];
      if (!k) return o.not_counted && o.not_counted.includes(state.kind) ? h('p', { class: 'meta', id: 'pc-official' }, WORDS.notCounted) : null;
      if (OFFICIAL_PLAIN[state.kind]) {      // plain words, no code: "the Census Bureau's count of bank offices"
        const n = Number.isFinite(k.est) ? fmt(k.est) : 'fewer than 3 or none (not published)';
        const m = state.loaded == null ? 'the number of FDIC branches loaded is not known' : `the FDIC branch list has ${fmt(state.loaded)} loaded`;
        return h('p', { class: 'meta', id: 'pc-official' }, `The Census Bureau's count of ${OFFICIAL_PLAIN[state.kind]} in this county is ${n} (observed, County Business Patterns ${o.year}); ${m}.`);
      }
      const what = OFFICIAL_KIND[state.kind] || k.label.toLowerCase();      // plain words: the industry code stays in the data file, off the page
      const n = Number.isFinite(k.est) ? fmt(k.est) : 'fewer than 3 or none (not published)';
      const m = state.loaded == null ? 'The map data count is not known' : `The map data has ${fmt(state.loaded)} of this kind loaded`;
      return h('p', { class: 'meta', id: 'pc-official' }, `The Census Bureau's count of ${what} in this county (County Business Patterns ${o.year}, observed): ${n}. ${m}.`);
    }


    // What the food sub-kind's sorting rule misses (KIND_LIMITS), or nothing for a base kind.
    const kindLimitsLine = () => (KIND_LIMITS[state.kind] ? h('p', { class: 'meta', id: 'pc-kind-limits' }, KIND_LIMITS[state.kind]) : null);

    // area weighting counts any block group the ring touches; if none is touched, say so instead of a bare 0.
    const peopleCell = (p) => (p.blockGroups === 0 ? 'none counted (see the method below)' : `about ${fmt(p.about)}`);

    // Compare mode: one table, a row per figure, a column per spot. No 'better' column and no score (the page's rule: no success score).
    function drawCompare() {
      const c = state.census, kind = KINDS[state.kind];
      const col = (spot, places, within, capKm) => {
        const u = spot ? pc.unitAt(spot, c.units) : null;
        return { spot, u, places, people: u ? pc.peopleWithinArea(spot, c.units) : null,
          counts: u && places ? ringCounts(spot, places, within, capKm) : null, near: u && places ? pc.nearest(spot, places, 1)[0] : null };
      };
      const cols = [col(state.spot, state.places, state.within, state.capKm), col(state.b.spot, state.b.places, state.b.within, state.b.capKm)];
      // every cell says why when there is no figure: not placed yet, outside the county, or the business points not loaded
      const cell = (k, f) => (!k.spot ? 'not placed yet' : !k.u ? 'outside the county' : f(k));
      const placesCell = (k, f) => cell(k, (x) => (x.places ? f(x) : 'business points not loaded'));
      const row = (head, label, f) => h('tr', {}, h('th', { scope: 'row' }, head, label ? h('span', { class: 'pc-label' }, ' ' + label) : null), ...cols.map((k) => h('td', {}, f(k))));
      const rows = [
        row('Spot (latitude, longitude)', '', (k) => (k.spot ? `${k.spot[1].toFixed(5)}, ${k.spot[0].toFixed(5)}` : 'not placed yet')),
        row('Census block group', '', (k) => cell(k, (x) => x.u.id)),
        row("People in the spot's block group", 'observed, 2020 Census', (k) => cell(k, (x) => (x.u.pop == null ? 'not published' : fmt(x.u.pop)))),
        row('People per square kilometre in the block group', 'calculated', (k) => cell(k, (x) => (x.u.density == null ? 'not available' : fmt(x.u.density)))),
        row('Median household income in the block group', `estimated, ${acsWords()}`, (k) => cell(k, (x) => incomeText(x.u.income))),
        row(`Nearest ${kindLower(state.kind)}`, `observed, from ${sourceOf(state.kind)}; distance calculated, straight line`, (k) => placesCell(k, (x) => (x.near ? `${km1(x.near.km)} km (${x.near.name || 'no name in the map data'})` : 'none found'))),
        ...pc.RINGS_KM.map((r, i) => row(`${kind} within ${r} km`, 'calculated', (k) => placesCell(k, (x) => countText(x.counts[i])))),
        ...pc.RINGS_KM.map((r, i) => row(`People within ${r} km`, 'estimated', (k) => cell(k, (x) => peopleCell(x.people[i]))))
      ];
      results.replaceChildren(h('h2', { id: 'pc-results-head', tabindex: '-1' }, 'Two spots side by side'),
        h('div', { class: 'pc-table-wrap' }, h('table', { class: 'pc-table pc-compare', id: 'pc-compare' },
          h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Figure'), h('th', { scope: 'col' }, 'Spot A'), h('th', { scope: 'col' }, 'Spot B'))),
          h('tbody', {}, rows))),
        h('p', { class: 'meta' }, WORDS.compareNote),
        ...[[state.capKm, state.within], [state.b.capKm, state.b.within]].filter(([k]) => k != null).map(([, w]) => (w ? WORDS.mapCapped : WORDS.capped))
          .filter((t, i, all) => all.indexOf(t) === i).map((t) => h('p', { class: 'form-note' }, t)),
        ...[kindLimitsLine()].filter(Boolean),      // replaceChildren would write a bare null as the text 'null'
        h('p', { class: 'meta' }, 'People within a ring: ' + pc.peopleWithinArea(state.spot, []).at(0).method + ', rounded to the nearest 100.'));
    }

    // The places within 1, 2 and 5 km. The server sends the TRUE counts (within, counted before the 60-place cap: RENDERER 09:12); the page uses them when they are there.
    // Without them (an older server) it counts the places it was sent, and a ring that reaches past the farthest one sent says 'at least'.
    function ringCounts(spot, places, within, capKm) {
      return pc.countsWithin(spot, places).map((c) => (within ? { ...c, count: within[c.km], exact: true }
        : { ...c, exact: !(capKm != null && c.km > capKm) }));
    }
    const countText = (cnt) => (cnt.exact ? fmt(cnt.count) : `at least ${fmt(cnt.count)}`);
    // the survey's years come from the data file (sources.income_years), never typed here
    const acsWords = () => { const y = state.census && state.census.sources && state.census.sources.income_years; return y ? `American Community Survey ${y}` : 'American Community Survey, 5-year'; };

    function drawCompareBar() {
      // a second spot is offered only once spot A is inside the county (an outside spot has nothing to compare)
      if (!state.spot || (!state.compare && !pc.unitAt(state.spot, state.census.units))) { compareBar.replaceChildren(); targetWrap.replaceChildren(); return; }
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

    function drawAll() { drawMap(); drawResults(); drawCredits(); drawCompareBar(); drawRetry(); }

    // the business points failed to load (not the day's limit, not 'none loaded'): a real Try again that asks the server again
    const retryWrap = h('div', { class: 'pc-retry-wrap', id: 'pc-retry-wrap' });
    const failed = () => state.placesNote === WORDS.placesError || (state.compare && state.b.note === WORDS.placesError);
    function drawRetry() {
      retryWrap.replaceChildren(...(failed() ? [h('button', { class: 'button secondary pc-retry', type: 'button', id: 'pc-retry', onclick: retry }, WORDS.retry)] : []));
    }
    async function retry() {
      if (state.loading || state.retrying) return;
      state.retrying = true;
      status.textContent = WORDS.retrying;      // the person sees that Try again ran (GEO 11-27)
      try {
        if (state.spot) {
          // only the spot whose ask failed is asked again: each ask counts toward the day's limit (GEO review 10)
          const aBad = state.placesNote === WORDS.placesError, bBad = !!(state.compare && state.b.spot && state.b.note === WORDS.placesError);
          if ((aBad || !bBad) && !(await loadPlaces())) return;      // a newer spot was put down meanwhile: that one draws
          if (bBad && !(await loadPlacesB())) return;
        } else if (!(await checkLoaded())) return;                  // a newer probe, county or spot superseded it: that one draws
      } finally { state.retrying = false; }
      drawAll();
      status.textContent = failed() ? WORDS.stillFailing : state.compare ? statusLine() : (state.placesNote || (state.spot ? summaryLine() : ''));
      document.getElementById('pc-retry')?.focus();                  // still failing: the keyboard stays on the button
    }

    function drawResults() {
      const c = state.census;
      if (state.compare && state.spot) { drawCompare(); return; }
      if (!state.spot) { results.replaceChildren(h('p', { class: 'form-intro' }, WORDS.pickSpot)); return; }
      const u = pc.unitAt(state.spot, c.units);
      if (!u) { results.replaceChildren(h('p', { class: 'form-intro' }, WORDS.pickSpot)); return; }      // the status line says 'outside the county' (once)
      const out = [h('h2', { id: 'pc-results-head', tabindex: '-1' }, 'Around this spot'),
        h('p', { class: 'meta', id: 'pc-spot-text' }, `Spot: ${state.spot[1].toFixed(5)}, ${state.spot[0].toFixed(5)} (latitude, longitude)`),
        h('h3', {}, 'The block group the spot is in'),
        h('ul', { class: 'pc-facts', id: 'pc-unit' },
          h('li', {}, `People: ${u.pop == null ? 'not published' : fmt(u.pop)}`, u.pop == null ? null : h('span', { class: 'pc-label' }, ' observed, 2020 Census')),
          h('li', {}, `People per square kilometre: ${u.density == null ? 'not available' : fmt(u.density)}`, u.density == null ? null : h('span', { class: 'pc-label' }, ' calculated')),
          h('li', {}, `Median household income: ${incomeText(u.income)}`, u.income ? h('span', { class: 'pc-label' }, ` estimated, ${acsWords()}`) : null),
          h('li', { class: 'meta' }, `Census block group ${u.id}`))];
      const people = pc.peopleWithinArea(state.spot, c.units);
      if (state.places) {
        const near = pc.nearest(state.spot, state.places, 5), counts = ringCounts(state.spot, state.places, state.within, state.capKm);
        out.push(h('h3', {}, `Nearest ${kindLower(state.kind)}`, h('span', { class: 'pc-label' }, ` observed, from ${sourceOf(state.kind)}`)),
          h('ol', { class: 'pc-facts', id: 'pc-nearest' }, near.map((p) => h('li', {}, `${p.name || '(no name in the map data)'}: ${km1(p.km)} km`, h('span', { class: 'pc-label' }, ' calculated, straight line')))));
        out.push(h('h3', {}, 'Within 1, 2 and 5 km'),
          h('table', { class: 'pc-table', id: 'pc-rings' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Ring'), h('th', { scope: 'col' }, KINDS[state.kind] + ' (calculated)'), h('th', { scope: 'col' }, 'People (estimated)'))),
            h('tbody', {}, counts.map((cnt, i) => h('tr', {}, h('th', { scope: 'row' }, `${cnt.km} km`), h('td', {}, countText(cnt)), h('td', {}, peopleCell(people[i])))))),
          state.capKm == null ? null : state.within ? h('p', { class: 'form-note', id: 'pc-map-capped' }, WORDS.mapCapped) : h('p', { class: 'form-note', id: 'pc-capped' }, WORDS.capped));
      } else {
        out.push(h('h3', {}, 'Within 1, 2 and 5 km'),
          h('table', { class: 'pc-table', id: 'pc-rings' }, h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Ring'), h('th', { scope: 'col' }, 'People (estimated)'))),
            h('tbody', {}, people.map((p) => h('tr', {}, h('th', { scope: 'row' }, `${p.km} km`), h('td', {}, peopleCell(p)))))));
      }
      const off = officialLine();
      if (off) out.push(off);
      const lim = kindLimitsLine();
      if (lim) out.push(lim);
      out.push(h('p', { class: 'meta' }, 'People within a ring: ' + people[0].method + ', rounded to the nearest 100.'));
      results.replaceChildren(...out.filter((x) => x != null && x !== false));      // a null part (no cap note) must not print 'null' (FACES 09:31)
    }

    function drawCredits() {
      const s = state.census.sources;
      const o = state.census.official;
      const credit = state.credit || (state.compare ? state.b.credit : '');
      // the brackets and the link are one unbreakable inline piece, so a line never ends on '(' or starts with ')' (RENDERER 09:19)
      // each source in plain words: no file, table or industry codes (CC1 09:48); the survey years come from the data
      const plain = ['U.S. Census Bureau block group boundaries (2020 geography)', 'U.S. Census Bureau, 2020 Census population counts (observed)',
        `U.S. Census Bureau, ${acsWords()} median household income (estimated)`].concat(o && o.year ? [`U.S. Census Bureau, County Business Patterns ${o.year} business counts (observed)`] : []);
      const osm = OSM_CREDIT.test(credit);      // the server's credit for this kind: OpenStreetMap (with its link) or FDIC for bank branches (no link)
      credits.replaceChildren(`Sources: ${plain.join('; ')}. Area and people per square kilometre are calculated here from the boundaries; the shapes are simplified for the page.${credit ? ' ' + credit + (osm ? ' ' : '.') : ''}`,
        osm ? h('span', { class: 'pc-credit-link' }, '(', h('a', { href: 'https://www.openstreetmap.org/copyright', rel: 'noopener', target: '_blank' }, 'openstreetmap.org/copyright'), ').') : '',
        // what is true (CC1 10:11): the exporter reads saved files, never the API; their receipts name api.census.gov as where they were fetched once
        ` The people and income figures come from the U.S. Census Bureau (the 2020 Census and the ${acsWords()}), read from copies saved earlier from the Census Bureau Data API, not asked of it live. This product is not endorsed or certified by the Census Bureau.`);
      notKnownList.replaceChildren(...notKnownFor(state.kind).map((t) => h('li', {}, t)));
    }

    // which: 'A' or 'B'. Only the spot that moved is asked about again (each spot is its own server call).
    async function place(pt, which = 'A') {
      if (state.loading) return;
      const inside = state.census && pc.unitAt(pt, state.census.units);
      latIn.value = inside ? pt[1].toFixed(5) : ''; lonIn.value = inside ? pt[0].toFixed(5) : '';      // a refused spot leaves no coordinates in the boxes (GEO 11-27)
      if (which === 'B' && state.compare) { state.b.spot = pt; state.b.places = null; } else { state.spot = pt; state.places = null; }
      if (inside && !state.dayLimit) { drawMap(); status.textContent = WORDS.looking; }
      let fresh;
      if (which === 'B' && state.compare) fresh = await loadPlacesB(); else fresh = await loadPlaces();
      if (!fresh) return false;                                    // a newer spot was put down meanwhile: that one draws
      drawAll();
      status.textContent = statusLine();
      return true;                                                 // drawn (the map click moves focus to the results heading)
    }

    function statusLine() {
      if (!state.compare) return state.placesNote || summaryLine();
      const notes = [...new Set([state.placesNote, state.b.note].filter(Boolean))];
      return [...notes, summaryLine()].join(' ');
    }

    // one spot in words, for the status line in compare mode
    function spotWords(name, spot, places, within, capKm) {
      if (!spot) return `${name}: not placed yet.`;
      if (!pc.unitAt(spot, state.census.units)) return `${name}: outside the county.`;
      if (!places) return `${name}: placed, people and income only.`;
      const r5 = ringCounts(spot, places, within, capKm)[2], n = pc.nearest(spot, places, 1)[0];
      return `${name}: ${countText(r5)} ${kindWords(state.kind, r5.count)} within 5 km${n ? `, the nearest ${nearAway(n.km)}` : ''}.`;
    }

    function summaryLine() {
      if (state.compare && state.census) {
        return `Comparing two spots. ${spotWords('Spot A', state.spot, state.places, state.within, state.capKm)} ${spotWords('Spot B', state.b.spot, state.b.places, state.b.within, state.b.capKm)} ${state.b.spot ? 'The table below shows them side by side.' : WORDS.pickB}`;
      }
      const u = state.census && state.spot ? pc.unitAt(state.spot, state.census.units) : null;
      if (!u) return WORDS.outside;
      if (!state.places) return 'Spot placed. People and income are below.';
      const r5 = ringCounts(state.spot, state.places, state.within, state.capKm)[2], n = pc.nearest(state.spot, state.places, 1)[0];
      return `Spot placed: ${countText(r5)} ${kindWords(state.kind, r5.count)} within 5 km${n ? `, the nearest ${nearAway(n.km)}` : ''}. Details are below.`;
    }

    // Is anything loaded at all? Asked once per county and kind, at the county's middle, so the note shows before any spot (MEDIUM 6).
    // Its own request token, like fetchPlaces: a late answer is dropped when a newer probe was sent, the county or kind changed, or a spot was put down
    // meanwhile (CC1 10:11). Returns false for a dropped answer: whoever superseded it draws.
    let probed = 0;
    async function checkLoaded() {
      if (state.spot) return true;
      if (state.dayLimit) { state.placesNote = state.dayLimit; return true; }
      const mine = ++probed, county = state.county, kind = state.kind;
      const probeStale = () => mine !== probed || county !== state.county || kind !== state.kind || state.spot != null;
      const [x0, y0, x1, y1] = state.census.bbox;
      try {
        const r = await data.perfectCityPlaces(county, kind, r4((y0 + y1) / 2), r4((x0 + x1) / 2));
        if (probeStale()) return false;
        state.loaded = r && Number.isFinite(r.loaded) ? r.loaded : null;
        state.placesNote = r && r.loaded > 0 ? '' : WORDS.noPlaces;
      } catch (e) {
        if (probeStale()) return false;
        if (/today.s limit/i.test(String(e && e.message))) state.dayLimit = String(e.message);
        state.placesNote = state.dayLimit || WORDS.placesError;
      }
      return true;
    }

    // Each county or kind change gets a token: only the newest refresh may write. A second county change while one loads is not blocked; the
    // newest choice wins and the older load, landing late, is dropped (CC1 10:11), so the county named in the select is the one on screen.
    let refreshing = 0;
    async function refresh() {
      const mine = ++refreshing, stale = () => mine !== refreshing;
      status.textContent = 'Loading...';
      state.loading = true;
      let census;
      try { census = await loadCensus(state.county); }
      catch {
        if (stale()) return;                                          // a newer county was picked meanwhile: that one draws
        state.loading = false;
        const wanted = COUNTIES.find((c) => c.id === state.county);
        if (state.census) {                                           // keep the county that is on screen, and say so
          state.county = state.census.county;
          const sel = document.getElementById('pc-county'); if (sel) sel.value = state.county;
          status.textContent = `The map data for ${wanted ? wanted.label : 'that county'} could not be loaded. Still showing ${state.census.name}. Try again later.`;
        } else status.textContent = 'The map data could not be loaded. Try again later.';
        return;
      }
      if (stale()) return;                                            // a slow county landed after a newer pick: drop it
      state.census = census;
      state.loading = false;
      kindSelect();
      // a false is a stale answer (a newer kind, county or spot asked meanwhile): whoever asked later draws (WORKER 10:17, two quick kind changes)
      if (!(await loadPlaces()) || stale()) return;
      if (state.compare && (!(await loadPlacesB()) || stale())) return;
      if (!(await checkLoaded()) || stale()) return;
      drawAll();
      status.textContent = [state.kindNote, state.compare ? statusLine() : (state.placesNote || (state.spot ? summaryLine() : ''))].filter(Boolean).join(' ');
      state.kindNote = '';
    }

    const controls = h('div', { class: 'pc-controls' },
      select('pc-county', 'County', COUNTIES.map((c) => [c.id, c.label]), state.county, (v) => { state.county = v; state.spot = null; state.compare = false; state.target = 'A'; state.b = noB(); latIn.value = ''; lonIn.value = ''; state.kindNote = `County changed to ${COUNTIES.find((c) => c.id === v).label}: put a spot on the map.`; refresh(); }), ' ',
      kindWrap, ' ',
      select('pc-shade', 'Shade by', Object.entries(SHADES), state.shade, (v) => { state.shade = v; drawMap(); }));
    kindSelect();
    await refresh();
    return [h('h1', { tabindex: '-1' }, 'Perfect City'), h('p', { class: 'form-intro' }, WORDS.intro), controls, status, retryWrap, mapBox, compareBar, typed, results,
      h('h2', {}, 'What this does not know'), notKnownList, credits,
      h('p', { class: 'form-note', role: 'note' }, 'Draft wording, not yet approved.')];
  }

  window.ryagramPerfectCityPage = Object.freeze({ view, COUNTIES, KINDS, KIND_LIMITS, WORDS, OFFICIAL_PLAIN, notKnownFor, creditLinked: (c) => OSM_CREDIT.test(String(c || '')) });
})();
