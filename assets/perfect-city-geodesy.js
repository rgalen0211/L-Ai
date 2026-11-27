// Perfect City geodesy (ENGINE 11-27). No DOM, no network, no dependencies. Reproduces the numbers of the Ryagram engine
// (ryagram/maprace/localarea.py compute_numbers): WGS84 ellipsoid distances, people by AREA SHARE inside the ring,
// ring_leaves_place and county_edge_km. Works in the browser (window.PerfectCityGeodesy) and in node (require).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PerfectCityGeodesy = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const A = 6378137;                       // WGS84 semi-major axis, metres
  const F = 1 / 298.257223563;             // WGS84 flattening
  const B = A * (1 - F);
  const R_MEAN_M = 6371008.8;
  const rad = (d) => d * Math.PI / 180;

  // Spherical fallback, only used where Vincenty does not converge (near antipodal points).
  function sphere(lon1, lat1, lon2, lat2) {
    const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
    const s = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    const d = 2 * R_MEAN_M * Math.asin(Math.min(1, Math.sqrt(s)));
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return { m: d, az: Math.atan2(y, x), converged: false };
  }

  // Vincenty inverse: { m: metres, az: initial azimuth in radians clockwise from north, converged }.
  function inverse(lon1, lat1, lon2, lat2) {
    if (lon1 === lon2 && lat1 === lat2) return { m: 0, az: 0, converged: true };
    const L = rad(lon2 - lon1);
    const U1 = Math.atan((1 - F) * Math.tan(rad(lat1))), U2 = Math.atan((1 - F) * Math.tan(rad(lat2)));
    const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
    let lam = L, sinSig = 0, cosSig = 0, sig = 0, cos2a = 0, cos2sm = 0, done = false;
    for (let i = 0; i < 200; i++) {
      const sinLam = Math.sin(lam), cosLam = Math.cos(lam);
      sinSig = Math.hypot(cU2 * sinLam, cU1 * sU2 - sU1 * cU2 * cosLam);
      cosSig = sU1 * sU2 + cU1 * cU2 * cosLam;
      sig = Math.atan2(sinSig, cosSig);
      const sinAlpha = cU1 * cU2 * sinLam / sinSig;
      cos2a = 1 - sinAlpha * sinAlpha;
      cos2sm = cos2a === 0 ? 0 : cosSig - 2 * sU1 * sU2 / cos2a;      // equatorial line
      const C = F / 16 * cos2a * (4 + F * (4 - 3 * cos2a));
      const prev = lam;
      lam = L + (1 - C) * F * sinAlpha * (sig + C * sinSig * (cos2sm + C * cosSig * (-1 + 2 * cos2sm * cos2sm)));
      if (Math.abs(lam - prev) < 1e-13) { done = true; break; }
      if (!isFinite(lam) || Math.abs(lam) > Math.PI) break;            // antipodal: no convergence
    }
    if (!done) return sphere(lon1, lat1, lon2, lat2);
    const u2 = cos2a * (A * A - B * B) / (B * B);
    const k1 = (Math.sqrt(1 + u2) - 1) / (Math.sqrt(1 + u2) + 1);
    const a1 = (1 + k1 * k1 / 4) / (1 - k1);
    const b1 = k1 * (1 - 3 * k1 * k1 / 8);
    const dSig = b1 * sinSig * (cos2sm + b1 / 4 * (cosSig * (-1 + 2 * cos2sm * cos2sm) -
      b1 / 6 * cos2sm * (-3 + 4 * sinSig * sinSig) * (-3 + 4 * cos2sm * cos2sm)));
    const az = Math.atan2(cU2 * Math.sin(lam), cU1 * sU2 - sU1 * cU2 * Math.cos(lam));
    return { m: B * a1 * (sig - dSig), az, converged: true };
  }

  // WGS84 geodesic distance in km between two points given as numbers (degrees).
  function ellipsoidDistanceKm(lon1, lat1, lon2, lat2) { return inverse(lon1, lat1, lon2, lat2).m / 1000; }

  // Azimuthal equidistant projection round the click (true distance and bearing from the click): [x, y] in km.
  function aeqd(click, lon, lat) {
    const g = inverse(click[0], click[1], lon, lat);
    const s = g.m / 1000;
    return [s * Math.sin(g.az), s * Math.cos(g.az)];
  }

  function inRing(x, y, ring) {                                        // the engine's ray casting rule
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const inUnit = (pt, u) => u.rings.reduce((n, r) => n + (inRing(pt[0], pt[1], r) ? 1 : 0), 0) % 2 === 1;

  // Signed area of the triangle (origin, a, b) intersected with the disc of radius r round the origin.
  function triCircle(ax, ay, bx, by, r) {
    const dx = bx - ax, dy = by - ay;
    const a = dx * dx + dy * dy;
    if (a === 0) return 0;
    const b = ax * dx + ay * dy, c = ax * ax + ay * ay - r * r;
    const disc = b * b - a * c;
    const cross = (px, py, qx, qy) => px * qy - py * qx;
    const sector = (px, py, qx, qy) => 0.5 * r * r * Math.atan2(cross(px, py, qx, qy), px * qx + py * qy);
    const tri = (px, py, qx, qy) => 0.5 * cross(px, py, qx, qy);
    const aIn = ax * ax + ay * ay <= r * r, bIn = bx * bx + by * by <= r * r;
    if (aIn && bIn) return tri(ax, ay, bx, by);
    if (disc <= 0) return sector(ax, ay, bx, by);
    const sq = Math.sqrt(disc);
    const t1 = (-b - sq) / a, t2 = (-b + sq) / a;
    if (t1 >= 1 || t2 <= 0) return sector(ax, ay, bx, by);
    const s = Math.max(t1, 0), e = Math.min(t2, 1);
    const px = ax + s * dx, py = ay + s * dy, qx = ax + e * dx, qy = ay + e * dy;
    return sector(ax, ay, px, py) + tri(px, py, qx, qy) + sector(qx, qy, bx, by);
  }
  // Exact area (km2) of a set of rings (outer clockwise, holes anticlockwise, so a hole subtracts) inside the disc round the origin.
  function areaInDisc(rings, r) {
    let tot = 0;
    for (const ring of rings) for (let i = 0; i < ring.length - 1; i++) tot += triCircle(ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1], r);
    return Math.abs(tot);
  }

  // Exterior edges: edges of in-place units that no other in-place unit shares (vertices rounded to 1e-7 degree, undirected).
  function exteriorEdges(units) {
    const key = (p) => Math.round(p[0] * 1e7) + ',' + Math.round(p[1] * 1e7);
    const count = new Map(), edges = new Map();
    for (const u of units) {
      if (!u.in_place) continue;
      for (const ring of u.rings) for (let i = 0; i < ring.length - 1; i++) {
        const k1 = key(ring[i]), k2 = key(ring[i + 1]);
        const k = k1 < k2 ? k1 + '|' + k2 : k2 + '|' + k1;
        count.set(k, (count.get(k) || 0) + 1);
        edges.set(k, [ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]]);
      }
    }
    return [...edges].filter(([k]) => count.get(k) === 1).map(([, e]) => e);
  }

  function roundHalfEven(x, digits) {                                  // Python round(x, digits): half to even
    const m = 10 ** digits, y = x * m, f = Math.floor(y), d = y - f;
    const r = d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1);
    return r / m;
  }
  const rkey = (r) => String(r);                                       // "1", "2", "5", "0.5" like Python's f"{r:g}"

  // place: { units: [{ id, in_place, pop, area_km2, rings: [[[lon,lat],...],...] }], exteriorEdges?: [[lon1,lat1,lon2,lat2],...] }
  // click: [lon, lat]; radiiKm: e.g. [1, 2, 5]; points: [{ name, lon, lat }, ...] (default place.points).
  // Points outside every in-place unit are dropped first, as in the engine.
  function computeNumbers(place, click, radiiKm, points) {
    const units = place.units.filter((u) => u.in_place);
    const pts = (points || place.points || []).filter((p) => units.some((u) => inUnit([p.lon, p.lat], u)));
    const out = {};
    const d = pts.map((p) => ellipsoidDistanceKm(click[0], click[1], p.lon, p.lat));
    const order = d.map((v, i) => i).sort((i, j) => d[i] - d[j] || i - j);
    out.nearest = order.slice(0, 5).map((i) => ({ name: pts[i].name, km: roundHalfEven(d[i], 4), lon: pts[i].lon, lat: pts[i].lat }));
    out.nearest_km = pts.length ? roundHalfEven(d[order[0]], 4) : null;
    out.within = {};
    for (const r of radiiKm) out.within[rkey(r)] = d.filter((v) => v <= r).length;
    const hit = units.find((u) => inUnit(click, u));
    out.click_block_group = hit ? hit.id : null;
    const proj = units.map((u) => u.rings.map((ring) => ring.map((p) => aeqd(click, p[0], p[1]))));
    out.people_est = {};
    for (const r of radiiKm) {
      let tot = 0;
      units.forEach((u, k) => {
        if (!u.pop) return;
        let far = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const ring of proj[k]) for (const [x, y] of ring) {
          far = Math.max(far, Math.hypot(x, y)); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
        let share;
        if (far <= r) share = 1;
        else if (x1 < -r || x0 > r || y1 < -r || y0 > r) share = 0;
        else share = u.area_km2 > 0 ? Math.max(0, Math.min(1, areaInDisc(proj[k], r) / u.area_km2)) : 0;
        tot += u.pop * share;
      });
      out.people_est[rkey(r)] = tot >= 100 ? roundHalfEven(tot, -1) : roundHalfEven(tot, 0);
    }
    const edges = place.exteriorEdges || exteriorEdges(units);
    let edge = null;
    for (const e of edges) {
      const p1 = aeqd(click, e[0], e[1]), p2 = aeqd(click, e[2], e[3]);
      const dx = p2[0] - p1[0], dy = p2[1] - p1[1], l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, -(p1[0] * dx + p1[1] * dy) / l2)) : 0;
      const dist = Math.hypot(p1[0] + t * dx, p1[1] + t * dy);
      if (edge === null || dist < edge) edge = dist;
    }
    out.county_edge_km = edge === null ? null : roundHalfEven(edge, 4);
    out.ring_leaves_place = {};
    for (const r of radiiKm) out.ring_leaves_place[rkey(r)] = edge !== null && edge < r;
    out.nearest_may_miss_across_edge = edge !== null && (out.nearest_km === null || out.nearest_km > edge);
    return out;
  }

  return { ellipsoidDistanceKm, computeNumbers, exteriorEdges, areaInDisc };
});
