// Perfect City engine adapter (ENGINE 11-27). No DOM, no network, no dependencies. ASCII only.
// Turns the PAGE's own data (window.ryagramPerfectCityData[county], and the places the server returned for a spot)
// into the arguments of PerfectCityGeodesy.computeNumbers, and returns the engine-style numbers:
// nearest, nearest_km, within, click_block_group, people_est, county_edge_km, ring_leaves_place, nearest_may_miss_across_edge.
// Browser: window.PerfectCityEngineAdapter (needs window.PerfectCityGeodesy loaded first). Node: require().
//
// What the page holds (read from assets/app-perfect-city.js, perfect-city-core.js and assets/perfect-city/*.census.js):
//   pageData = { units: [ { id, rings: [[[lon,lat],...closed],...], pop (null = not published), km2, density, income, centre } ], bbox, ... }
//   points   = state.places: [ { name, lat, lon, ... } ] from the server: the places within 5 km of the spot plus the nearest five, at most 60.
//
// ASSUMPTIONS THAT DIFFER FROM THE PYTHON ENGINE (the numbers can differ by these, and the page must keep saying so):
//  1. SHAPES: the page's rings are the Census cartographic boundary (cb_..._500k) rounded to 4 or 5 decimals, so they are
//     SIMPLIFIED. The engine works on the full-detail shapes. Edges, areas and which block group a spot is in can move a little.
//  2. AREA FOR SHARING PEOPLE: a block group's whole area is NOT the unit's published km2. It is the area of the SAME simplified
//     rings in the page's own flat local projection (km per degree at the spot, as core.js peopleWithinArea does; holes
//     subtract), so the share inside a ring is (simplified area inside) / (simplified area), never above 1. The published km2
//     is for density only. The engine uses its Albers area; the flat local area differs from that by well under 1 per cent at county size.
//  3. IN PLACE: every unit the page holds is one county, so every unit gets in_place = true. The engine also knew other-county
//     block groups as context; the page has none, so an edge of the county is always treated as an edge of the place.
//  4. POINTS: the server's points are cut by distance (within 5 km and the nearest five, at most 60), NOT filtered by county.
//     computeNumbers drops points outside every unit, as the engine does, so near a county line a point the page shows may not be counted here.
//     Counts for a ring wider than the farthest point sent are only a lower bound when the server answer hit its cap
//     (the caller must keep its own cap warning; this function does not know the cap).
//  5. DISTANCES: WGS84 ellipsoid (Vincenty), not the page's haversine on a mean sphere (about 0.3 per cent apart).
//  6. PEOPLE: computed exactly (disc area inside a ring, not a 96-sided polygon), and rounded as the engine rounds (nearest 10 from
//     100 up, whole numbers below), not to the page's nearest 100. A caller that wants the page's wording rounds again.
(function (root, factory) {
  const G = (typeof module === 'object' && module.exports) ? require('./perfect-city-geodesy.js') : root.PerfectCityGeodesy;
  const api = factory(G);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PerfectCityEngineAdapter = api;
})(typeof self !== 'undefined' ? self : this, function (G) {
  const R_KM = 6371.0088;                                  // the page's radius (core.js), used only for the flat local area
  const rad = (d) => d * Math.PI / 180;

  function inRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // Signed shoelace area in lon/lat degrees: positive = anticlockwise.
  function signed(ring) { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]); return -a / 2; }

  // The flat local area (km2) the page shares people by, for ONE unit, as core.js peopleWithinArea: holes (a ring whose first vertex
  // lies inside another ring of the unit) subtract. Exported so a test can show it equals the page's own number.
  function pageAreaKm2(unit, spot) {
    const kx = rad(1) * R_KM * Math.cos(rad(spot[1])), ky = rad(1) * R_KM;
    let full = 0;
    unit.rings.forEach((ring, i) => {
      const hole = unit.rings.some((other, j) => j !== i && inRing(ring[0], other));
      const pts = ring.slice(0, -1).map((p) => [(p[0] - spot[0]) * kx, (p[1] - spot[1]) * ky]);
      let a = 0; for (let m = 0, n = pts.length - 1; m < pts.length; n = m++) a += (pts[n][0] + pts[m][0]) * (pts[n][1] - pts[m][1]);
      full += (hole ? -1 : 1) * Math.abs(a) / 2;
    });
    return full;
  }

  // Outer rings clockwise, holes anticlockwise (the order areaInDisc needs so a hole subtracts). Holes are found as the page finds them.
  function orient(unit) {
    return unit.rings.map((ring, i) => {
      const hole = unit.rings.some((other, j) => j !== i && inRing(ring[0], other));
      const ccw = signed(ring) > 0;
      return (hole ? ccw : !ccw) ? ring : ring.slice().reverse();
    });
  }

  // pageData: the page's census object ({ units }). click: [lon, lat]. radiiKm: e.g. [1, 2, 5].
  // points: the server's places [{ name, lat, lon }] (default: none). Returns computeNumbers' result, plus nothing else.
  function toEngineNumbers(pageData, click, radiiKm, points) {
    const units = pageData.units.map((u) => ({
      id: u.id,
      in_place: true,
      pop: u.pop == null ? null : u.pop,                    // null = not published: adds nothing, as in the engine
      area_km2: pageAreaKm2(u, click),                      // the page's simplified-shape area (assumption 2)
      rings: orient(u)
    }));
    const pts = (points || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
      .map((p) => ({ name: p.name == null ? '' : p.name, lon: p.lon, lat: p.lat }));
    return G.computeNumbers({ units }, click, radiiKm, pts);
  }

  return { toEngineNumbers, pageAreaKm2 };
});
