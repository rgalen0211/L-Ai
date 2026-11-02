// NEXT-WEB 198: SYNTHETIC data for the Geographic Intelligence demo page. Every shape, number and shop here is MADE UP by a fixed formula to test the page. It is NOT Dayton, not the Census and not
// OpenStreetMap, although the coordinates sit near Dayton so the distances look real. Its label everywhere is Simulated. Real data comes later through its own adapters with receipts, free public data only.
(function () {
  const ORIGIN = { lon: -84.26, lat: 39.70 }, DLON = 0.025, DLAT = 0.02, COLS = 6, ROWS = 5;
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const r = rng(20261102);
  const areas = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    const x0 = ORIGIN.lon + col * DLON, y0 = ORIGIN.lat + row * DLAT;
    const centreness = 1 - Math.hypot(col - (COLS - 1) / 2, row - (ROWS - 1) / 2) / 4;               // denser near the middle, like a town
    areas.push({
      id: `BG-${row + 1}${col + 1}`, name: `Made-up area ${row + 1}-${col + 1}`,
      ring: [[x0, y0], [x0 + DLON, y0], [x0 + DLON, y0 + DLAT], [x0, y0 + DLAT]],
      population: Math.round(600 + 1900 * Math.max(0.1, centreness) * (0.7 + 0.6 * r())),
      income: Math.round(32000 + 40000 * r() * (0.6 + 0.4 * centreness)),
    });
  }
  const points = [];
  const make = (category, label, n) => { for (let i = 1; i <= n; i++) points.push({ id: `${category}-${i}`, category, name: `${label} ${i}`, lon: ORIGIN.lon + 0.01 + r() * (COLS * DLON - 0.02), lat: ORIGIN.lat + 0.008 + r() * (ROWS * DLAT - 0.016) }); };
  make('chicken', 'Made-up chicken place', 14); make('burger', 'Made-up burger place', 18); make('retail', 'Made-up shop', 12);
  const sites = [
    { id: 'middle', name: 'Middle of the map', lon: ORIGIN.lon + COLS * DLON / 2, lat: ORIGIN.lat + ROWS * DLAT / 2 },
    { id: 'north', name: 'North edge', lon: ORIGIN.lon + COLS * DLON * 0.35, lat: ORIGIN.lat + ROWS * DLAT * 0.88 },
    { id: 'south', name: 'South-east corner', lon: ORIGIN.lon + COLS * DLON * 0.82, lat: ORIGIN.lat + ROWS * DLAT * 0.14 },
  ];
  window.ryagramGeoDemoData = Object.freeze({
    SOURCE: 'Synthetic fixture (made up for testing)', LABEL: 'Simulated',
    bbox: { lon0: ORIGIN.lon, lat0: ORIGIN.lat, lon1: ORIGIN.lon + COLS * DLON, lat1: ORIGIN.lat + ROWS * DLAT },
    areas, points, sites,
    categories: { chicken: 'Chicken places', burger: 'Burger places', retail: 'Shops' },
  });
})();
