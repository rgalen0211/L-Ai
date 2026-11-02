// NEXT-WEB 198, 199 and 201: the catchment maths for the Geographic Intelligence demo page, in plain JavaScript so the page needs no server.
// This is a PORT of ENGINE's own module (Ryagram ryagram/geo/catchment.py and compare.py, branch geo-catchment-1102): the same rules, the same units (metres), the same labels, the same result shape.
// The contract is the JSON "ryagram.site-comparison/0": tests/fixtures/geo-demo-inputs.json (synthetic inputs) run through ENGINE's code give tests/fixtures/geo-site-comparison-demo.json
// (tools/make-geo-fixture.py), and tests/geo-contract.test.mjs proves this file gives the same values, labels and structure for the same inputs.
// Every result is { value, label, source, note } and the label is one of Observed, Calculated, Estimated, Simulated. Rings are straight-line circles, never drive times.
(function () {
  const LABELS = Object.freeze(['Observed', 'Calculated', 'Estimated', 'Simulated']);
  const SCHEMA = 'ryagram.site-comparison/0';
  const EARTH_R = 6371008.8, CIRCLE_STEPS = 96;
  const RANK = { Observed: 0, Calculated: 1, Estimated: 2, Simulated: 3 };
  const LEGEND = { Observed: 'straight from a source', Calculated: 'arithmetic on observed things, no assumption', Estimated: 'needs an assumption, stated beside the number', Simulated: 'a model was run' };
  const rad = d => (d * Math.PI) / 180, deg = r => (r * 180) / Math.PI;
  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  // Python's round(): halves go to the even neighbour, so the two languages agree on the half.
  const pyRound = (x, nd = 0) => {
    const m = 10 ** nd, y = x * m, f = Math.floor(y), d = y - f;
    const r = d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1);
    return nd ? r / m : r;
  };
  const g = n => String(Number(n));                                                              // Python's {x:g} for the radii used here (whole metres)

  function result(value, label, source, note) {
    if (!LABELS.includes(label)) throw new Error(`a result is labelled one of ${LABELS.join(', ')}, not ${label}`);
    if (!source) throw new Error('a result names its source');
    return { value, label, source: String(source), note: note || '' };
  }

  function haversineM(lon1, lat1, lon2, lat2) {
    const p1 = rad(lat1), p2 = rad(lat2), dphi = p2 - p1, dl = rad(lon2 - lon1);
    const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  const project = (lon, lat, lon0, lat0) => [rad(lon - lon0) * EARTH_R * Math.cos(rad(lat0)), rad(lat - lat0) * EARTH_R];
  const ringXY = (ring, lon0, lat0) => ring.map(([x, y]) => project(x, y, lon0, lat0));

  // The ring around the site as a lon/lat polygon: a STRAIGHT-LINE circle.
  function circle(site, radiusM, steps = CIRCLE_STEPS) {
    if (!(radiusM > 0)) throw new Error('a ring needs a radius above zero');
    const out = [];
    for (let k = 0; k < steps; k++) {
      const a = (2 * Math.PI * k) / steps, dx = radiusM * Math.cos(a), dy = radiusM * Math.sin(a);
      out.push([site.lon + deg(dx / (EARTH_R * Math.cos(rad(site.lat)))), site.lat + deg(dy / EARTH_R)]);
    }
    return out;
  }

  // Ray casting in flat metres; a point exactly on an edge counts as inside.
  function pointInPolygon(x, y, ring) {
    let inside = false;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % n];
      if ((y1 - y) * (y2 - y) <= 0 && (x2 - x1) * (y - y1) === (x - x1) * (y2 - y1) && Math.min(x1, x2) <= x && x <= Math.max(x1, x2)) return true;
      if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / (y2 - y1) + x1) inside = !inside;
    }
    return inside;
  }
  const shoelace = poly => { let s = 0; for (let i = 0; i < poly.length; i++) { const j = (i + 1) % poly.length; s += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1]; } return s; };
  const area = poly => Math.abs(shoelace(poly)) / 2;

  // Area of `subject` inside the CONVEX polygon `clip` (Sutherland-Hodgman; both in flat metres).
  function clipArea(subject, clipIn) {
    let clip = clipIn;
    if (clip.length < 3 || subject.length < 3) return 0;
    if (shoelace(clip) < 0) clip = clip.slice().reverse();
    let out = subject.slice();
    for (let i = 0; i < clip.length; i++) {
      const a = clip[i], b = clip[(i + 1) % clip.length], inp = out;
      out = [];
      if (!inp.length) break;
      const side = p => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      const cross = (p, q) => { const sp = side(p), sq = side(q), t = sp / (sp - sq); return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]; };
      for (let j = 0; j < inp.length; j++) {
        const p = inp[j], q = inp[(j + 1) % inp.length];
        if (side(q) >= 0) { if (side(p) < 0) out.push(cross(p, q)); out.push(q); }
        else if (side(p) >= 0) out.push(cross(p, q));
      }
    }
    return out.length >= 3 ? area(out) : 0;
  }

  function pointsInside(site, radiusM, points, opts = {}) {
    const { category = null, source = '', snapshot = '' } = opts;
    const ring = ringXY(circle(site, radiusM), site.lon, site.lat);
    let hits = 0, skipped = 0;
    for (const p of points) {
      if (category !== null && p.category !== category) continue;
      if (p.lon == null || p.lat == null) { skipped++; continue; }
      const [x, y] = project(p.lon, p.lat, site.lon, site.lat);
      if (pointInPolygon(x, y, ring)) hits++;
    }
    let note = `${category === null ? 'all points' : category + ' points'} listed in ${source || 'the data'}` + (snapshot ? ` (${snapshot})` : '') + ` within a straight-line ring of ${g(radiusM)} m; not a drive time`;
    if (skipped) note += `; ${skipped} listed point(s) had no position and are not counted`;
    return result(hits, 'Calculated', source || 'the supplied points', note);
  }

  function nearest(site, points, opts = {}) {
    const { category = null, source = '', snapshot = '' } = opts;
    let best = null, bestD = null;
    for (const p of points) {
      if (category !== null && p.category !== category) continue;
      if (p.lon == null || p.lat == null) continue;
      const d = haversineM(site.lon, site.lat, p.lon, p.lat);
      if (bestD === null || d < bestD || (d === bestD && String(p.id) < String(best.id))) { best = p; bestD = d; }
    }
    if (best === null) return result(null, 'Calculated', source || 'the supplied points', `no ${category || ''} point is listed in ${source || 'the data'}; that is not the same as none existing`.replace('  ', ' '));
    return result(pyRound(bestD, 1), 'Calculated', source || 'the supplied points', `straight-line distance in metres to ${best.id}` + (snapshot ? ` (${snapshot})` : '') + '; not a drive time');
  }

  // Each area's published count shared by the part of its area inside the ring. ASSUMES PEOPLE ARE SPREAD EVENLY inside each area, so it is Estimated and says so.
  function residentsInside(site, radiusM, areas, opts = {}) {
    const ring = ringXY(circle(site, radiusM), site.lon, site.lat);
    let total = 0; const missing = [];
    for (const a of areas) {
      const poly = ringXY(a.ring, site.lon, site.lat);
      const whole = poly.length >= 3 ? area(poly) : 0;
      if (whole <= 0) continue;
      const inside = clipArea(poly, ring);
      if (inside <= 0) continue;
      if (a.population == null) { missing.push(a.id); continue; }
      total += a.population * Math.min(1, inside / whole);
    }
    let note = `each area's published count shared by the part of its area inside a straight-line ring of ${g(radiusM)} m; assumes people are spread evenly inside each area; not a drive time`;
    if (missing.length) note += `; ${missing.length} area(s) inside the ring have no published figure and are left out, not counted as zero`;
    return result(pyRound(total), 'Estimated', opts.source || 'the supplied areas', note);
  }

  // The lowest and highest published median income among the areas the ring touches (a range: averaging medians would be arithmetic on the wrong thing).
  function incomeRangeInside(site, radiusM, areas, opts = {}) {
    const ring = ringXY(circle(site, radiusM), site.lon, site.lat);
    const vals = []; let missing = 0;
    for (const a of areas) {
      const poly = ringXY(a.ring, site.lon, site.lat);
      if (poly.length >= 3 && clipArea(poly, ring) > 0) { if (a.income == null) missing++; else vals.push(a.income); }
    }
    const rng = vals.length ? [Math.min(...vals), Math.max(...vals)] : null;
    return result(rng, 'Estimated', opts.source || 'the supplied areas',
      'lowest and highest published median household income among the areas the ring touches; survey estimates with margins of error' + (missing ? `; ${missing} touched area(s) have no estimate` : ''));
  }

  const weakest = (...labels) => labels.reduce((m, l) => (RANK[l] > RANK[m] ? l : m));
  function diff(a, b, what) {
    if (a.value === null || b.value === null) return { value: null, label: weakest(a.label, b.label), note: `${what}: no difference, one of the two has no value` };
    return { value: b.value - a.value, label: weakest(a.label, b.label), note: `${what}: second site minus first; carries the weaker of the two labels` };
  }
  const res = r => ({ value: r.value, label: r.label, source: r.source, note: r.note });

  // One site's block: every ring (by radius) and the nearest of each category.
  function siteBlock(site, radiiM, areas, points, categories, o = {}) {
    const rings = {};
    for (const r of radiiM) {
      rings[g(r)] = {
        residents: res(residentsInside(site, r, areas, { source: o.areaSource })),
        income_range: res(incomeRangeInside(site, r, areas, { source: o.areaSource })),
        counts: Object.fromEntries(categories.map(c => [c, res(pointsInside(site, r, points, { category: c, source: o.pointSource, snapshot: o.snapshot }))])),
      };
    }
    return { id: site.id, lon: site.lon, lat: site.lat, rings, nearest: Object.fromEntries(categories.map(c => [c, res(nearest(site, points, { category: c, source: o.pointSource, snapshot: o.snapshot }))])) };
  }

  // Two or more sites side by side, as the JSON contract ryagram.site-comparison/0. NO SCORE, NO WINNER: ranking is always null.
  function compareSites(sites, radiiM, areas, points, categories, o = {}) {
    if (sites.length < 2) throw new Error('a comparison needs at least two sites');
    if (new Set(sites.map(s => s.id)).size !== sites.length) throw new Error('two sites share an id');
    const radii = radiiM.map(Number);
    if (!radii.length || radii.some(r => !(r > 0))) throw new Error('every ring needs a radius above zero');
    const blocks = sites.map(s => siteBlock(s, radii, areas, points, categories, o));
    const [first, second] = blocks, diffs = {};
    for (const key of Object.keys(first.rings)) {
      diffs[key] = { residents: diff(first.rings[key].residents, second.rings[key].residents, 'residents inside'),
        counts: Object.fromEntries(categories.map(c => [c, diff(first.rings[key].counts[c], second.rings[key].counts[c], `${c} points inside`)])) };
    }
    return { schema: SCHEMA, radii_m: radii, categories: categories.slice(), sites: blocks, differences: diffs, difference_between: [first.id, second.id], ranking: null, legend: { ...LEGEND },
      notes: ['There is no score and no \'better\' site: ranking sites would need real sales data, and none is used. Read the counts and distances.', 'Rings are straight-line circles, not drive times.',
        'Residents are estimates that assume people are spread evenly inside each area; counts are of the points LISTED in the data, which may not be everything that exists.'] };
  }

  // Is this object the contract? Returns a list of plain-words problems (empty = fine). The page refuses anything else rather than drawing half of it.
  function validateComparison(c) {
    const bad = [];
    const isResult = r => r && typeof r === 'object' && 'value' in r && LABELS.includes(r.label) && typeof r.note === 'string';
    if (!c || typeof c !== 'object') return ['not an object'];
    if (c.schema !== SCHEMA) bad.push(`schema is not ${SCHEMA}`);
    if (!Array.isArray(c.radii_m) || !c.radii_m.length || !c.radii_m.every(r => isNum(r) && r > 0)) bad.push('radii_m is not a list of positive numbers');
    if (!Array.isArray(c.categories) || !c.categories.length) bad.push('categories is not a list');
    if (c.ranking !== null) bad.push('ranking must be null: there is no winner');
    if (!Array.isArray(c.sites) || c.sites.length < 2) bad.push('fewer than two sites');
    else for (const s of c.sites) {
      if (typeof s.id !== 'string' || !isNum(s.lon) || !isNum(s.lat)) bad.push('a site has no id or position');
      for (const key of (c.radii_m || []).map(g)) {
        const r = s.rings && s.rings[key];
        if (!r) { bad.push(`site ${s.id}: no ring ${key}`); continue; }
        if (!isResult(r.residents) || !isResult(r.income_range)) bad.push(`site ${s.id} ring ${key}: residents or income range is not a labelled result`);
        for (const cat of c.categories || []) if (!isResult(r.counts && r.counts[cat])) bad.push(`site ${s.id} ring ${key}: no labelled count for ${cat}`);
      }
      for (const cat of c.categories || []) if (!isResult(s.nearest && s.nearest[cat])) bad.push(`site ${s.id}: no labelled nearest for ${cat}`);
    }
    if (!c.differences || typeof c.differences !== 'object') bad.push('no differences');
    else for (const key of (c.radii_m || []).map(g)) {
      const d = c.differences[key];
      if (!d || !isResult(d.residents)) { bad.push(`no labelled difference for residents at ${key}`); continue; }
      for (const cat of c.categories || []) if (!isResult(d.counts && d.counts[cat])) bad.push(`no labelled difference for ${cat} at ${key}`);
    }
    if (!Array.isArray(c.difference_between) || c.difference_between.length !== 2) bad.push('difference_between is not two site ids');
    if (!Array.isArray(c.notes) || !c.notes.length) bad.push('no notes');
    return bad;
  }

  window.ryagramGeo = Object.freeze({ LABELS, SCHEMA, EARTH_R, haversineM, circle, pointInPolygon, clipArea, pointsInside, nearest, residentsInside, incomeRangeInside, siteBlock, compareSites, validateComparison, result, pyRound });
})();
