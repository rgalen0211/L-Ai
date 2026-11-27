// Perfect City, the arithmetic (GEO 11-27). No DOM, no network: the page (app-perfect-city.js) and the tests call these.
// Every result carries its label: OBSERVED (a published count), CALCULATED (exact arithmetic on published data),
// ESTIMATED (an approximation, with the method said in words). Distances are STRAIGHT LINES, never drive times.
(function (root) {
  const R_KM = 6371.0088;                                  // mean Earth radius (IUGG)
  const RINGS_KM = [1, 2, 5];
  const rad = (d) => d * Math.PI / 180;

  // Great-circle distance in km between [lon, lat] points (haversine): CALCULATED.
  function km(a, b) {
    const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
    return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  // Ray casting on one ring of [lon, lat] (good enough at county scale; the ring is closed).
  function inRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // A unit's rings: a point inside an odd number of them is inside the unit (holes subtract).
  function inUnit(pt, unit) { return unit.rings.reduce((n, r) => n + (inRing(pt, r) ? 1 : 0), 0) % 2 === 1; }
  function unitAt(pt, units) { return units.find((u) => inUnit(pt, u)) || null; }

  // The nearest places to a spot: CALCULATED straight-line distances, nearest first.
  function nearest(spot, places, n = 5) {
    return places.map((p) => ({ ...p, km: km(spot, [p.lon, p.lat]) })).sort((a, b) => a.km - b.km).slice(0, n);
  }

  // How many places within each ring: CALCULATED (a count of the points loaded; points can be missing from the map data).
  function countsWithin(spot, places, rings = RINGS_KM) {
    const d = places.map((p) => km(spot, [p.lon, p.lat]));
    return rings.map((r) => ({ km: r, count: d.filter((x) => x <= r).length, label: 'calculated' }));
  }

  // About how many people live within each ring: ESTIMATED. Method, in words: a block group counts in full when its
  // centre is inside the ring and not at all when it is outside (people are not spread evenly, and a block group on
  // the edge is all in or all out), so the figure is rounded to the nearest 100 and always called "about".
  function peopleWithin(spot, units, rings = RINGS_KM) {
    return rings.map((r) => {
      const inside = units.filter((u) => u.pop != null && km(spot, u.centre) <= r);
      const total = inside.reduce((s, u) => s + u.pop, 0);
      return { km: r, about: Math.round(total / 100) * 100, blockGroups: inside.length, label: 'estimated',
               method: 'block groups whose centre is inside the ring, counted in full' };
    });
  }

  // About how many people live within each ring, AREA-WEIGHTED: ESTIMATED. Method, in words: each block group's people are shared by the part of its
  // area inside the ring (a 96-sided circle, clipped in a flat local projection), which assumes people are spread evenly inside each block group.
  // GEO's estimate check of 11-27 (kept outside the repo) found the centre method off by a median 58% at 1 km, with false zeros; this is
  // the Ryagram engine's own method (ryagram/geo/catchment.py residents_inside). Rounded to the nearest 100.
  const AREA_METHOD = "each block group's people shared by the part of its area inside the ring, assuming people are spread evenly inside it";
  function shoelace(pts) { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return Math.abs(a) / 2; }
  // Sutherland-Hodgman: clip any polygon by a CONVEX polygon (the circle), both counter-clockwise or both clockwise does not matter for the area.
  function clip(subject, convex) {
    let out = subject;
    for (let i = 0; i < convex.length && out.length; i++) {
      const a = convex[i], b = convex[(i + 1) % convex.length], inp = out; out = [];
      const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      const sgn = side(convex[(i + 2) % convex.length]) >= 0 ? 1 : -1;      // which side of a->b is inside
      const inside = (p) => side(p) * sgn >= 0;
      for (let k = 0; k < inp.length; k++) {
        const p = inp[k], q = inp[(k + 1) % inp.length], pin = inside(p), qin = inside(q);
        if (pin) out.push(p);
        if (pin !== qin) {
          const sp = side(p), sq = side(q), t = sp / (sp - sq);
          out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
        }
      }
    }
    return out;
  }
  function peopleWithinArea(spot, units, rings = RINGS_KM) {
    const kx = rad(1) * R_KM * Math.cos(rad(spot[1])), ky = rad(1) * R_KM;          // km per degree at the spot
    const loc = (p) => [(p[0] - spot[0]) * kx, (p[1] - spot[1]) * ky];
    return rings.map((r) => {
      const circle = Array.from({ length: 96 }, (_, i) => [r * Math.cos((2 * Math.PI * i) / 96), r * Math.sin((2 * Math.PI * i) / 96)]);
      let total = 0, touched = 0;
      for (const u of units) {
        if (u.pop == null || !u.pop) continue;
        if (km(spot, u.centre) > r + 15) continue;                                   // far away: cannot touch the ring (block groups here are under 15 km across)
        let full = 0, inside = 0;
        u.rings.forEach((ring, i) => {
          const hole = u.rings.some((other, j) => j !== i && inRing(ring[0], other));
          const pts = ring.slice(0, -1).map(loc);
          const sgn = hole ? -1 : 1;
          full += sgn * shoelace(pts);
          inside += sgn * shoelace(clip(pts, circle));
        });
        if (full > 0 && inside > 0) { total += u.pop * Math.min(1, inside / full); touched++; }
      }
      return { km: r, about: Math.round(total / 100) * 100, blockGroups: touched, label: 'estimated', method: AREA_METHOD };
    });
  }

  // Shading bands for the map: five equal-count bands of the value over the county's units (CALCULATED break points).
  function bands(units, value, k = 5) {
    const xs = units.map(value).filter((v) => v != null && Number.isFinite(v)).sort((a, b) => a - b);
    if (!xs.length) return [];
    const br = [];
    for (let i = 1; i < k; i++) br.push(xs[Math.min(xs.length - 1, Math.floor((i * xs.length) / k))]);
    return br;
  }
  function band(v, br) { if (v == null) return -1; let i = 0; while (i < br.length && v >= br[i]) i++; return i; }

  // A simple equirectangular projection for one county (x scaled by cos of the middle latitude), into a w x h box.
  function projector(bbox, w, h, pad = 8) {
    const [x0, y0, x1, y1] = bbox, k = Math.cos(rad((y0 + y1) / 2));
    const sx = (w - 2 * pad) / ((x1 - x0) * k), sy = (h - 2 * pad) / (y1 - y0), s = Math.min(sx, sy);
    const ox = pad + ((w - 2 * pad) - (x1 - x0) * k * s) / 2, oy = pad + ((h - 2 * pad) - (y1 - y0) * s) / 2;
    const fwd = ([lon, lat]) => [ox + (lon - x0) * k * s, oy + (y1 - lat) * s];
    const inv = ([x, y]) => [x0 + (x - ox) / (k * s), y1 - (y - oy) / s];
    const kmToPx = (d) => (d / (R_KM * rad(1))) * s;       // one degree of latitude = R * pi/180 km
    return { fwd, inv, kmToPx };
  }

  const api = { km, inRing, inUnit, unitAt, nearest, countsWithin, peopleWithin, peopleWithinArea, clip, shoelace, bands, band, projector, RINGS_KM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ryagramPerfectCity = Object.freeze(api);
})(typeof window !== 'undefined' ? window : globalThis);
