// Perfect City ring counts (GEO 11-27, RENDERER 09:12 MEDIUM): public.perfect_city_places carries at most 60 places, so in a dense cluster the page must NOT count
// the rings from the array it was sent. The server now sends 'within' (the true counts within 1, 2 and 5 km, counted before the cap) and the page prints those;
// without 'within' (an older server) it falls back to counting the array and says 'at least' past the farthest place sent.
// The REAL page script runs here on a tiny fake DOM, with the real Census page data; every business point is INVENTED (never OpenStreetMap data).
// MUST-FAIL: the same walk on a planted page that counts from the array is caught.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const PAGE = read('assets/app-perfect-city.js');
const CORE = read('assets/perfect-city-core.js');
const CENSUS = read('assets/perfect-city/montgomery_oh.census.js');
const SPOT = [39.75893, -84.19157];           // typed with 5 decimals, inside Montgomery County (downtown Dayton)

// a tiny DOM: enough for the page's h() calls and its SVG map
class El {
  constructor(tag, attrs = {}) { this.tag = tag; this.attrs = { ...attrs }; this.kids = []; this.textContent = ''; this.value = ''; }
  setAttribute(k, v) { this.attrs[k] = v; }
  getAttribute(k) { return this.attrs[k]; }
  append(...k) { this.kids.push(...flat(k)); }
  replaceChildren(...k) { this.kids = flat(k); }
  addEventListener() {}
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 480 }; }
  focus() {}
}
const flat = (k) => k.flat(Infinity).filter((x) => x != null && x !== false && x !== '');
const h = (tag, attrs, ...kids) => { const e = new El(tag, attrs || {}); e.append(...kids); return e; };
const text = (e) => (e == null ? '' : typeof e === 'string' || typeof e === 'number' ? String(e) : e.textContent + e.kids.map(text).join(''));
const find = (e, pred) => { if (!(e instanceof El)) return null; if (pred(e)) return e; for (const k of e.kids) { const f = find(k, pred); if (f) return f; } return null; };
const byId = (roots, id) => roots.map((r) => find(r, (e) => e.attrs.id === id)).find(Boolean) || null;
const tick = () => new Promise((r) => setTimeout(r, 0));

// the invented answer: 80 places within 2 km of the spot asked about, at most 60 sent (nearest first), like the real function
function denseAnswer(pc, { lat, lon, withinToo }) {
  const all = Array.from({ length: 80 }, (_, i) => ({ name: `Test Dense ${i + 1}`, lat: lat + (i % 9) * 0.0015, lon: lon + Math.floor(i / 9) * 0.0015 }));
  const d = all.map((p) => ({ p, km: pc.km([lon, lat], [p.lon, p.lat]) })).sort((a, b) => a.km - b.km);
  const r = { county: 'montgomery_oh', kind: 'fast_food', radius_km: 5, max_places: 60, credit: 'Map data (c) OpenStreetMap contributors (ODbL)', loaded: 80,
    places: d.slice(0, 60).map((x) => x.p) };
  if (withinToo) r.within = { 1: d.filter((x) => x.km <= 1).length, 2: d.filter((x) => x.km <= 2).length, 5: d.filter((x) => x.km <= 5).length };
  return r;
}

// run the page (src: the page script, real or planted), type the spot, and read what it prints
async function walk(src, { withinToo = true } = {}) {
  const win = {};
  const doc = { createElementNS: (ns, tag) => new El(tag), createElement: (tag) => new El(tag), getElementById: () => null, activeElement: null, head: new El('head') };
  const ctx = vm.createContext({ window: win, document: doc, setTimeout, console });
  vm.runInContext(CORE, ctx); vm.runInContext(CENSUS, ctx); vm.runInContext(src, ctx);
  const calls = [];
  const data = { perfectCityPlaces: async (county, kind, lat, lon) => { calls.push([lat, lon]); return denseAnswer(win.ryagramPerfectCity, { lat, lon, withinToo }); } };
  const roots = await win.ryagramPerfectCityPage.view({ h, data });
  const form = roots.map((r) => find(r, (e) => e.tag === 'form')).find(Boolean);
  byId(roots, 'pc-lat').value = String(SPOT[0]); byId(roots, 'pc-lon').value = String(SPOT[1]);
  form.attrs.onsubmit({ preventDefault() {} });
  for (let i = 0; i < 50 && !byId(roots, 'pc-rings'); i++) await tick();
  const rings = byId(roots, 'pc-rings');
  assert.ok(rings, 'the rings table is drawn');
  const tbody = find(rings, (e) => e.tag === 'tbody');
  const cells = tbody.kids.map((tr) => text(tr.kids[1]));
  return { cells, calls, status: text(byId(roots, 'pc-status')), mapCapped: text(byId(roots, 'pc-map-capped')), capped: text(byId(roots, 'pc-capped')),
    dots: denseAnswer(win.ryagramPerfectCity, { lat: calls.at(-1)[0], lon: calls.at(-1)[1], withinToo }) };
}

const expectedWithin = async () => (await walk(PAGE)).dots.within;

test('a dense cluster: 80 places within 2 km, the answer carries 60, and the page prints the TRUE counts (80, not 60), with a note that the map shows the nearest 60', async () => {
  const w = await expectedWithin();
  assert.equal(w[2], 80); assert.equal(w[5], 80); assert.ok(w[1] > 0 && w[1] < 80);
  const r = await walk(PAGE);
  assert.deepEqual(r.cells, [String(w[1]), '80', '80']);
  assert.ok(!r.cells.some((c) => /at least|60/.test(c)), r.cells.join(' | '));
  assert.match(r.mapCapped, /only the nearest 60 places/);
  assert.equal(r.capped, '', 'with the true counts, no "at least" note');
  assert.match(r.status, /80 fast food within 5 km/);
});

test('an older server (no within): the page falls back to the places sent and says "at least" past the farthest one', async () => {
  const r = await walk(PAGE, { withinToo: false });
  assert.deepEqual(r.cells.slice(1), ['at least 60', 'at least 60']);
  assert.match(r.capped, /say at least/);
  assert.equal(r.mapCapped, '');
  assert.match(r.status, /at least 60 fast food within 5 km/);
});

test('the spot is rounded to 4 decimals before perfect_city_places is called (like the summary function)', async () => {
  const r = await walk(PAGE);
  assert.deepEqual(r.calls.at(-1), [39.7589, -84.1916]);
  for (const [lat, lon] of r.calls) for (const x of [lat, lon]) assert.equal(Math.round(x * 1e4) / 1e4, x, `${x} has at most 4 decimals`);
});

test('MUST-FAIL: a planted page that counts the rings from the array it received is caught', async () => {
  const plants = [
    ['counts = ringCounts(state.spot, state.places, state.within, state.capKm)', 'counts = pc.countsWithin(state.spot, state.places).map((c) => ({ ...c, exact: true }))'],
    ['(within ? { ...c, count: within[c.km], exact: true }', '(false ? { ...c, count: within[c.km], exact: true }']
  ];
  for (const [from, to] of plants) {
    assert.equal(PAGE.split(from).length, 2, `the plant target is in the page exactly once: ${from}`);
    const r = await walk(PAGE.replace(from, to));
    assert.notDeepEqual(r.cells.slice(1), ['80', '80'], `the planted page still printed 80: ${to}`);
    assert.ok(r.cells.slice(1).every((c) => /60/.test(c)), `the planted page counts the 60 it was sent: ${r.cells.join(' | ')}`);
  }
  // and the round-trip: the unplanted page passes the check that the plants fail
  assert.deepEqual((await walk(PAGE)).cells.slice(1), ['80', '80']);
});
