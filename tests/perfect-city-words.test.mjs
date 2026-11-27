// Perfect City words (GEO 11-27, reviews FACES 09:31, CC1 09:43 and 09:48). The REAL page script runs on a small fake DOM that treats a null or undefined
// child the way a browser does (replaceChildren(null) prints 'null'), with the real Census page data; every business point is INVENTED (never OpenStreetMap data).
//   A. no 'null', 'undefined' or 'NaN' is ever printed (a null cap note printed 'null' under the ring table);
//   B. a count of 1 is said in the singular ('1 fast food place', never '1 fast food' or '1 restaurants');
//   C. plain words, no codes: the official count names the industry in words (no NAICS code), the credits name each source plainly, and the nearest
//      places carry their source word (observed, from OpenStreetMap);
//   F. a malformed 'within' (a missing ring, a negative number, a string) falls back to counting the places sent and says 'at least';
//   G. the prompts say tap or click, and the typed-spot message says the ranges (-90 to 90, -180 to 180);
//   H. the survey years come from the data file (sources.income_years), never typed in the page.
// MUST-FAIL: each check also runs on a planted page with the old line put back, and must catch it. Every plant target is in the page exactly once.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const PAGE = read('assets/app-perfect-city.js');
const CORE = read('assets/perfect-city-core.js');
const CENSUS = read('assets/perfect-city/montgomery_oh.census.js');
const SPOT = [39.7589, -84.1916];           // inside Montgomery County (downtown Dayton)

// a browser-like child: an element stays, anything else becomes text the way the DOM does it (null -> 'null', undefined -> 'undefined')
const asChild = (x) => (x instanceof El ? x : String(x));
class El {
  constructor(tag, attrs = {}) { this.tag = tag; this.attrs = { ...attrs }; this.kids = []; this.textContent = ''; this.value = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k]; }
  append(...k) { this.kids.push(...k.map(asChild)); }
  replaceChildren(...k) { this.kids = k.map(asChild); }
  addEventListener() {}
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 480 }; }
  focus() {}
}
// the app's own h(): it drops null and false children (assets/app-library.js); only replaceChildren/append on a built element see a raw null
const h = (tag, attrs, ...kids) => { const e = new El(tag, attrs || {}); e.append(...kids.flat(Infinity).filter((x) => x != null && x !== false)); return e; };
const text = (e) => (e == null ? '' : typeof e === 'string' ? e : e.textContent + e.kids.map(text).join(''));
const labels = (e) => (typeof e === 'string' ? [] : [e.attrs['aria-label'] || '', ...e.kids.flatMap(labels)]);
const find = (e, pred) => { if (!(e instanceof El)) return null; if (pred(e)) return e; for (const k of e.kids) { const f = find(k, pred); if (f) return f; } return null; };
const byId = (roots, id) => roots.map((r) => find(r, (e) => e.attrs.id === id)).find(Boolean) || null;
const tick = () => new Promise((r) => setTimeout(r, 0));

// invented answers: ONE place 1.5 km north (no cap), or 80 places in a dense cluster (60 sent), with 'within' as given
function oneAnswer({ lat, lon }) {
  return { county: 'montgomery_oh', kind: 'fast_food', radius_km: 5, max_places: 60, credit: 'Map data (c) OpenStreetMap contributors (ODbL)', loaded: 1,
    within: { 1: 0, 2: 1, 5: 1 }, places: [{ name: 'Test One', lat: lat + 1.5 / 111.195, lon }] };
}
function denseAnswer(pc, { lat, lon }, within) {
  const all = Array.from({ length: 80 }, (_, i) => ({ name: `Test Dense ${i + 1}`, lat: lat + (i % 9) * 0.0015, lon: lon + Math.floor(i / 9) * 0.0015 }));
  const d = all.map((p) => ({ p, km: pc.km([lon, lat], [p.lon, p.lat]) })).sort((a, b) => a.km - b.km);
  const r = { county: 'montgomery_oh', kind: 'fast_food', radius_km: 5, max_places: 60, credit: 'Map data (c) OpenStreetMap contributors (ODbL)', loaded: 80,
    places: d.slice(0, 60).map((x) => x.p) };
  if (within !== undefined) r.within = within;
  return r;
}

// run the page (src: real or planted), type a spot, and read everything it shows
async function walk(src, { answer = 'one', within, census = CENSUS, typed = SPOT } = {}) {
  const win = {};
  const doc = { createElementNS: (ns, tag) => new El(tag), createElement: (tag) => new El(tag), getElementById: () => null, activeElement: null, head: new El('head') };
  const ctx = vm.createContext({ window: win, document: doc, setTimeout, console });
  vm.runInContext(CORE, ctx); vm.runInContext(census, ctx); vm.runInContext(src, ctx);
  const data = { perfectCityPlaces: async (county, kind, lat, lon) => (answer === 'one' ? oneAnswer({ lat, lon }) : denseAnswer(win.ryagramPerfectCity, { lat, lon }, within)) };
  const roots = await win.ryagramPerfectCityPage.view({ h, data });
  const form = roots.map((r) => find(r, (e) => e.tag === 'form')).find(Boolean);
  byId(roots, 'pc-lat').value = String(typed[0]); byId(roots, 'pc-lon').value = String(typed[1]);
  form.attrs.onsubmit({ preventDefault() {} });
  for (let i = 0; i < 50 && !byId(roots, 'pc-rings'); i++) await tick();
  await tick();
  const rings = byId(roots, 'pc-rings');
  const cells = rings ? find(rings, (e) => e.tag === 'tbody').kids.map((tr) => text(tr.kids[1])) : [];
  const all = roots.map(text).join('\n') + '\n' + roots.flatMap(labels).join('\n');
  return { all, cells, words: win.ryagramPerfectCityPage.WORDS, status: text(byId(roots, 'pc-status')), official: text(byId(roots, 'pc-official')),
    credits: text(roots.find((r) => r.attrs && r.attrs.id === 'pc-credits') || byId(roots, 'pc-credits') || new El('p')),
    nearestHead: (() => { const ol = byId(roots, 'pc-nearest'); if (!ol) return ''; const res = roots.find((r) => find(r, (e) => e === ol)); const parent = find(res, (e) => e.kids.includes(ol)); const i = parent.kids.indexOf(ol); return text(parent.kids[i - 1]); })() };
}

const CODES = /NAICS|\b\d{6}\b|cb_20\d\d|B19013|\bP1\b|cbp\d\dco|table /;
const CHECKS = {
  // A: nothing prints null, undefined or NaN (no cap here: the cap note is null)
  async noNull(src) {
    const r = await walk(src), bad = [];
    if (!r.cells.length) bad.push('setup: the rings table is not drawn');
    // a plain substring: a stray null sits glued to its neighbours ('104,000nullThe Census'), so no word-boundary test sees it
    for (const w of ['null', 'undefined', 'NaN']) {
      const at = r.all.indexOf(w);
      if (at >= 0) bad.push(`the page prints ${w}: ...${r.all.slice(Math.max(0, at - 60), at + 20)}...`);
    }
    return bad;
  },
  // B: '1 fast food place within 5 km', and the map says '1 fast food place near it'
  async singular(src) {
    const r = await walk(src), bad = [];
    if (!/Spot placed: 1 fast food place within 5 km/.test(r.status)) bad.push(`status: ${r.status}`);
    if (!/and 1 fast food place near it marked/.test(r.all)) bad.push('the map label does not say 1 fast food place');
    if (/\b1 (fast food|restaurants|supermarkets|\w+ places)\b(?! place)/.test(r.all.replace(/1 fast food place/g, ''))) bad.push('a plural after 1 is still printed');
    return bad;
  },
  // C: the official line and the credits in plain words, no codes; the nearest heading has its source word
  async plainWords(src) {
    const r = await walk(src), bad = [];
    if (!r.official.includes("The Census Bureau's count of limited-service restaurants (fast food) in this county (County Business Patterns 2023, observed): 515.")) bad.push(`official: ${r.official}`);
    if (CODES.test(r.official)) bad.push(`official carries a code: ${r.official}`);
    if (!/^Sources: U\.S\. Census Bureau block group boundaries/.test(r.credits) || CODES.test(r.credits)) bad.push(`credits: ${r.credits}`);
    if (!/OpenStreetMap contributors/.test(r.credits) || !/not endorsed or certified/.test(r.credits)) bad.push('credits lost the OpenStreetMap credit or the Census API notice');
    if (r.nearestHead !== 'Nearest fast food observed, from OpenStreetMap') bad.push(`nearest heading: ${r.nearestHead}`);
    if (CODES.test(r.all)) bad.push(`a code is printed somewhere: ${r.all.match(CODES)[0]}`);
    return bad;
  },
  // H: the survey years follow the data file
  async yearsFromData(src) {
    const bad = [], r = await walk(src);
    if (!r.all.includes('American Community Survey 2019 to 2023')) bad.push('the survey years 2019 to 2023 are not shown');
    const moved = CENSUS.replace('"income_years":"2019 to 2023"', '"income_years":"2018 to 2022"');
    if (moved === CENSUS) return ['setup: the data file has no income_years'];
    const r2 = await walk(src, { census: moved });
    if (!r2.all.includes('American Community Survey 2018 to 2022') || r2.all.includes('2019 to 2023')) bad.push('the survey years do not follow sources.income_years');
    return bad;
  },
  // F: a malformed within falls back to 'at least'
  async badWithin(src) {
    const bad = [];
    for (const [what, within] of [['a missing ring', { 1: 40, 2: 80 }], ['a negative number', { 1: 40, 2: -80, 5: 80 }], ['a string', { 1: 40, 2: '80', 5: 80 }], ['not an object', 'lots']]) {
      const r = await walk(src, { answer: 'dense', within });
      if (r.cells.length !== 3 || r.cells[1] !== 'at least 60' || r.cells[2] !== 'at least 60') bad.push(`${what}: the 2 and 5 km rings show ${r.cells.join(' | ')}`);
      if (/NaN|-80|undefined/.test(r.all)) bad.push(`${what}: the bad value reached the page`);
    }
    return bad;
  },
  // G: tap or click, and the ranges in the typed-spot message
  async tapAndRanges(src) {
    const bad = [], r = await walk(src);
    for (const k of ['intro', 'pickSpot', 'pickB']) if (!/tap or click the map/i.test(r.words[k])) bad.push(`${k}: ${r.words[k]}`);
    if (/(^|[^r] )click the map/i.test(Object.values(r.words).filter((w) => typeof w === 'string').join(' ').replace(/tap or click the map/gi, ''))) bad.push('a prompt still says click only');
    const far = await walk(src, { typed: [95, -84.19] });
    if (!/from -90 to 90/.test(far.status) || !/from -180 to 180/.test(far.status)) bad.push(`latitude 95: ${far.status}`);
    return bad;
  }
};

// the old line put back, one per check (C has two: the official line and the credits)
const PLANTS = {
  noNull: [['results.replaceChildren(...out.filter((x) => x != null && x !== false));', 'results.replaceChildren(...out);']],
  singular: [['const kindWords = (kind, n) => (n === 1 ? KIND_ONE[kind] : KINDS[kind].toLowerCase());', 'const kindWords = (kind, n) => KINDS[kind].toLowerCase();']],
  plainWords: [
    ['const what = OFFICIAL_KIND[state.kind] || k.label.toLowerCase();', 'const what = `${OFFICIAL_KIND[state.kind]} (NAICS ${k.naics})`;'],
    ["${plain.join('; ')}", '${s.boundaries}; ${s.population}; ${s.income}'],
    ["`Nearest ${KINDS[state.kind].toLowerCase()}`, h('span', { class: 'pc-label' }, ' observed, from OpenStreetMap')", '`Nearest ${KINDS[state.kind].toLowerCase()}`']
  ],
  yearsFromData: [["return y ? `American Community Survey ${y}`", "return y ? 'American Community Survey 2019 to 2023'"]],
  badWithin: [['if (!Number.isInteger(n) || n < 0) return null;', '']],
  tapAndRanges: [
    ["pickB: 'Tap or click the map", "pickB: 'Click the map"],
    ['latitude (from -90 to 90) and a longitude (from -180 to 180) as numbers', 'latitude and a longitude as numbers']
  ]
};

for (const [name, check] of Object.entries(CHECKS)) {
  test(`${name}: the page passes`, async () => assert.deepEqual(await check(PAGE), []));
  for (const [i, [from, to]] of PLANTS[name].entries()) {
    test(`${name}: MUST-FAIL ${i + 1} (the old line put back) is caught`, async () => {
      assert.equal(PAGE.split(from).length - 1, 1, `plant ${name} ${i + 1}: the target is not in the page exactly once: ${from}`);
      const bad = await check(PAGE.replace(from, to));
      assert.ok(bad.length > 0, `plant ${name} ${i + 1} was NOT caught`);
    });
  }
}

test('the data files carry the survey years, and the page types none', () => {
  for (const f of ['montgomery_oh', 'greene_oh']) assert.match(read(`assets/perfect-city/${f}.census.js`), /"income_years":"\d{4} to \d{4}"/, f);
  assert.doesNotMatch(PAGE, /20\d\d to 20\d\d/);
});
