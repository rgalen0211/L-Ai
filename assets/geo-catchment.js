// NEXT-WEB 198: the catchment math for the Geographic Intelligence demo page, in plain JavaScript so the page needs no server.
// ENGINE 70 (the engine's own catchment module) was still open when this was written, so this is a small contract taken from that item's text: point in polygon, distance rings, counts inside an
// area, nearest of a category, and EVERY result carries a label (Observed, Calculated, Estimated or Simulated) and its source. When ENGINE's shape exists, reconcile the names, not the rules.
// Straight-line distances only (a ring, not a drive time): a drive area needs a routing engine this site does not have, and the page says so.
(function () {
  const LABELS = Object.freeze(['Observed', 'Calculated', 'Estimated', 'Simulated']);
  const R_KM = 6371.0088;
  const rad = d => (d * Math.PI) / 180;
  const num = v => typeof v === 'number' && Number.isFinite(v);
  const isPt = p => !!p && num(p.lat) && num(p.lon);

  // Great-circle distance in kilometres between two {lat, lon} points.
  function haversineKm(a, b) {
    if (!isPt(a) || !isPt(b)) return NaN;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  // Ray casting. ring: [[lon, lat], ...] (open or closed). A point exactly on an edge counts as inside.
  function pointInPolygon(pt, ring) {
    if (!isPt(pt) || !Array.isArray(ring) || ring.length < 3) return false;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      const cross = (pt.lon - xi) * (yj - yi) - (pt.lat - yi) * (xj - xi);
      if (cross === 0 && Math.min(xi, xj) <= pt.lon && pt.lon <= Math.max(xi, xj) && Math.min(yi, yj) <= pt.lat && pt.lat <= Math.max(yi, yj)) return true;
      if ((yi > pt.lat) !== (yj > pt.lat) && pt.lon < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // A circle of radius km around a centre as a polygon ring [[lon, lat], ...] (steps points).
  function ringPolygon(center, km, steps = 72) {
    if (!isPt(center) || !(km > 0)) return [];
    const out = [], dLat = km / 111.19492664, cosLat = Math.cos(rad(center.lat));
    for (let i = 0; i < steps; i++) {
      const a = (2 * Math.PI * i) / steps;
      out.push([center.lon + (Math.sin(a) * dLat) / cosLat, center.lat + Math.cos(a) * dLat]);
    }
    return out;
  }

  const result = (value, label, source, note) => {
    if (!LABELS.includes(label)) throw new Error(`label must be one of ${LABELS.join(', ')}`);
    return { value, label, source: String(source), note: note ? String(note) : '' };
  };

  // How many points of a category lie within km of the centre.
  function countInside(points, center, km, category, source) {
    const n = (Array.isArray(points) ? points : []).filter(p => isPt(p) && p.category === category && haversineKm(center, p) <= km).length;
    return result(n, 'Calculated', source || 'counted from the points given', `straight-line ring of ${km} km, not a drive time`);
  }

  // The nearest point of a category: { point, km } wrapped in a labelled result, or value null when there is none.
  function nearestOf(points, center, category, source) {
    let best = null;
    for (const p of Array.isArray(points) ? points : []) {
      if (!isPt(p) || p.category !== category) continue;
      const d = haversineKm(center, p);
      if (best === null || d < best.km) best = { point: p, km: d };
    }
    return result(best ? { name: best.point.name, km: Math.round(best.km * 100) / 100 } : null, 'Calculated', source || 'measured from the points given', 'straight-line distance');
  }

  // Residents inside the ring: each area's population times the share of that area inside the ring, the share found by testing a grid of sample points inside the area.
  // This ASSUMES people are spread evenly inside an area, so it is labelled Calculated with that stated, never Observed.
  function residentsInside(areas, center, km, source, grid = 12) {
    let total = 0;
    for (const a of Array.isArray(areas) ? areas : []) {
      if (!a || !Array.isArray(a.ring) || !num(a.population)) continue;
      const xs = a.ring.map(p => p[0]), ys = a.ring.map(p => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      let inArea = 0, inRing = 0;
      for (let i = 0; i < grid; i++) for (let j = 0; j < grid; j++) {
        const pt = { lon: x0 + ((i + 0.5) / grid) * (x1 - x0), lat: y0 + ((j + 0.5) / grid) * (y1 - y0) };
        if (!pointInPolygon(pt, a.ring)) continue;
        inArea++;
        if (haversineKm(center, pt) <= km) inRing++;
      }
      if (inArea) total += a.population * (inRing / inArea);
    }
    return result(Math.round(total), 'Calculated', source || 'area populations given', 'assumes people are spread evenly inside each area');
  }

  window.ryagramGeo = Object.freeze({ LABELS, haversineKm, pointInPolygon, ringPolygon, countInside, nearestOf, residentsInside, result });
})();
