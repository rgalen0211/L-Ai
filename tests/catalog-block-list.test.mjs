// ENGINE's catalog block list (CC1 ruling 2026-11-23 09:24, part b): the (dataset, view) films the machine's own checks fail are never offered
// by the guided builder. The generator (tools/gen-catalog.py --block-list) drops them from film_types in supabase/functions/_shared/catalog_data.ts
// and from views in assets/app-catalog-data.js. The generated-file drift test is in tests/film-compile.test.mjs (it passes the committed copy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { CATALOG } from '../supabase/functions/_shared/catalog_data.ts';
import { handle } from '../supabase/functions/guided-builder/builder.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const plain = x => JSON.parse(JSON.stringify(x));
const COPY = path.join(root, 'tools', 'data', 'engine-catalog-block-list-1123.json');
const ENGINE_FILE = process.env.ENGINE_BLOCK_LIST || path.join(os.homedir(), 'Ryagram-logs', 'proposals', 'ENGINE-CATALOG-BLOCK-LIST-1123-v2.json');
const block = JSON.parse(read('tools/data/engine-catalog-block-list-1123.json'));
const pairs = Object.entries(block).flatMap(([id, vs]) => vs.map(v => [id, v]));

const win = {};
vm.runInNewContext(read('assets/app-catalog-data.js'), { window: win });
const PUB = win.ryagramCatalogData;

// ENGINE's FINAL list v2 (2026-11-23 09:55): 16 datasets, 58 pairs; file sha256 is of the text with plain LF and no trailing newline (ENGINE's 09:55 correction).
const V2_FILE_SHA256 = 'c5a110285e934ac4cbaefe1338e62088e676e6d03dc139409744b5bcee662e46';
// The parsed list in canonical form (keys sorted, each view list sorted, python json.dumps spacing), exactly what tools/gen-catalog.py hashes; its first 12 hex digits are in both generated headers.
const canonical = o => '{' + Object.keys(o).sort().map(k => `${JSON.stringify(k)}: [${[...o[k]].sort().map(v => JSON.stringify(v)).join(', ')}]`).join(', ') + '}';
const CANON_SHA256 = '843a1e5a2062008cae613b02f6ca9d254ecc7fc91546a82cbb82c4136307ffbe';
const sha = x => crypto.createHash('sha256').update(x).digest('hex');

test('BLOCK LIST v2: the committed copy has ENGINE\'s final shape (16 datasets, 58 pairs) and both pinned hashes, and names real catalog datasets', () => {
  assert.equal(Object.keys(block).length, 16);
  assert.equal(pairs.length, 58);
  assert.equal(sha(read('tools/data/engine-catalog-block-list-1123.json').replace(/\r\n/g, '\n')), V2_FILE_SHA256, 'the committed list is not ENGINE\'s v2 file (CRLF is read as LF)');
  assert.equal(sha(canonical(block)), CANON_SHA256, 'the parsed list changed');
  for (const [id, vs] of Object.entries(block)) for (const v of ['paired', 'panel']) assert.ok(vs.includes(v), `${id} must block ${v} (the engine refuses both for every catalog dataset)`);
  for (const [id, v] of pairs) {
    assert.ok(CATALOG.some(e => e.id === id), `${id} is not in the server catalog`);
    assert.ok(['map', 'bars', 'line', 'paired', 'panel', 'shares'].includes(v), `${id}: ${v}`);
  }
});

test('BLOCK LIST v2: the committed copy equals ENGINE\'s v2 file when that file is present (parsed JSON, not bytes)', t => {
  if (!fs.existsSync(ENGINE_FILE)) { t.skip(`ENGINE's file is not here (${ENGINE_FILE}): the committed copy is not compared`); return; }
  assert.deepEqual(plain(JSON.parse(fs.readFileSync(ENGINE_FILE, 'utf8'))), plain(block), 'ENGINE changed its block list: copy it to tools/data/ and regenerate (python tools/gen-catalog.py --block-list ...)');
});

test('NO BLOCKED PAIR is offered, in either generated file; every unblocked film type of those datasets still is', () => {
  const blocked = new Set(pairs.map(([id, v]) => `${id}|${v}`));
  // the site only ever offers map, bars and line: the v2 pairs paired, panel and shares are in the list for the worker and the seed, never in film_types
  for (const e of CATALOG) for (const v of e.film_types) assert.ok(['map', 'bars', 'line'].includes(v), `${e.id} offers ${v}`);
  for (const [id, v] of pairs.filter(([, v]) => ['map', 'bars', 'line'].includes(v))) {
    assert.ok(!CATALOG.find(e => e.id === id).film_types.includes(v), `server catalog still offers ${id} ${v}`);
    assert.ok(!PUB.entries.find(e => e.id === id)?.views.includes(v), `public catalog still offers ${id} ${v}`);
  }
  for (const e of CATALOG) for (const v of e.film_types) assert.ok(!blocked.has(`${e.id}|${v}`), `${e.id} ${v}`);
  for (const e of PUB.entries) for (const v of e.views) assert.ok(!blocked.has(`${e.id}|${v}`), `${e.id} ${v}`);
  // unblocked pairs stay: bps_county_permits keeps line; cbp_mining_share_state keeps bars and line; a dataset not on the list keeps all it had
  assert.deepEqual(plain(CATALOG.find(e => e.id === 'bps_county_permits').film_types), ['line']);
  assert.deepEqual(plain(CATALOG.find(e => e.id === 'cbp_mining_share_state').film_types), ['bars', 'line']);
  assert.deepEqual(plain(PUB.entries.find(e => e.id === 'bps_county_permits').views.filter(v => ['map', 'bars', 'line'].includes(v))), ['line']);
  const untouched = CATALOG.filter(e => !block[e.id] && e.status === 'usable');
  assert.ok(untouched.length >= 5);
  for (const e of untouched) assert.ok(e.film_types.length >= 1, e.id);
  assert.deepEqual(plain(CATALOG.find(e => e.id === 'state_obesity_fastfood').film_types), ['map', 'bars', 'line']);
  // a blocked dataset is never left with nothing to offer while it is usable
  for (const e of CATALOG) if (e.status === 'usable') assert.ok(e.film_types.length >= 1, `${e.id} is usable with no film type`);
});

test('THE GENERATED FILES name the block list (header: its parsed-canonical hash and the 20 map/bars/line pairs it removes) and the counts agree', () => {
  const head = new RegExp(`block list \\(tools/data/engine-catalog-block-list-1123\\.json, sha ${CANON_SHA256.slice(0, 12)}\\): 20 \\(dataset, view\\) pairs\\.`);
  assert.match(read('supabase/functions/_shared/catalog_data.ts'), head);
  assert.match(read('assets/app-catalog-data.js'), head);
  assert.equal(CATALOG.filter(e => e.status === 'usable').reduce((n, e) => n + e.film_types.length, 0), 51);
});

// ---- the guided builder itself, in a vm, over the real function and the real catalog: the type step shows only what the catalog offers.
class El {
  constructor(tag, attrs, kids) { this.tag = tag; this.attrs = attrs || {}; this.kids = []; this.hidden = false; this.value = this.attrs.value ?? ''; this.append(...(kids || [])); }
  append(...xs) { for (const x of xs.flat(Infinity)) if (x != null && x !== false) this.kids.push(x); }
  replaceChildren(...xs) { this.kids = []; this.append(...xs); }
  addEventListener(n, f) { (this.on ||= {})[n] = f; }
  focus() {}
  set textContent(t) { this.kids = [String(t)]; }
  walk(f) { f(this); for (const k of this.kids) if (k instanceof El) k.walk(f); }
  all(f) { const out = []; this.walk(e => { if (f(e)) out.push(e); }); return out; }
  querySelector(sel) { return this.all(e => e.tag === sel)[0] || null; }
  text() { return this.kids.map(k => (k instanceof El ? k.text() : String(k))).join(''); }
}
const h = (tag, attrs, ...kids) => new El(tag, attrs, kids);

const ORIGIN = 'https://uselai.com';
const call = async body => (await handle(new Request('https://x.supabase.co/functions/v1/guided-builder', { method: 'POST',
  headers: { origin: ORIGIN, authorization: 'Bearer good', 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  { allowedOrigins: [ORIGIN], verifyUser: async jwt => (jwt === 'good' ? { id: 'u1' } : null) })).json();
const data = { builderCatalog: () => call({ action: 'catalog' }), builderDescribe: id => call({ action: 'describe', dataset: id }), listLooks: async () => [] };

async function typeStepFor(datasetId, preset = {}) {
  const w = { ryagramBuilder: null };
  vm.runInNewContext(read('assets/app-builder.js'), { window: w, setTimeout, clearTimeout, location: {} });
  const { builderView } = w.ryagramBuilder.create({ h, data, busy: async f => f(), showError: () => {}, errorLine: () => h('p', {}) });
  const out = await builderView(() => {}, preset);
  const builder = out.flat(Infinity).find(e => e instanceof El && e.attrs.class === 'builder');
  const radio = () => builder.all(e => e.tag === 'input' && e.attrs.type === 'radio');
  const nextButton = () => builder.all(e => e.tag === 'button' && e.text() === 'Next')[0];
  const pick = radio().find(r => r.attrs.name === 'bd-dataset' && r.attrs.value === datasetId);
  assert.ok(pick, `${datasetId} is offered as a dataset`);
  pick.attrs.onchange();
  await new Promise(r => setTimeout(r, 20));
  for (let i = 0; i < 3; i++) nextButton().attrs.onclick();                   // dataset -> measure -> years -> film type
  assert.match(builder.all(e => e.tag === 'h2').map(e => e.text()).join('|'), /What kind of film\?/);
  return radio().filter(r => r.attrs.name === 'bd-type').map(r => r.attrs.value);
}

test('THE GUIDED BUILDER (assets/app-builder.js:256, the real function and the real catalog): a blocked type is not offered for a blocked dataset; an unblocked one still is', async () => {
  assert.deepEqual(await typeStepFor('bps_county_permits'), ['line'], 'Housing: map and bars are blocked');
  assert.deepEqual(await typeStepFor('cbp_mining_share_state'), ['bars', 'line'], 'map is blocked');
  assert.deepEqual(await typeStepFor('cbp_retail_share_state'), ['map', 'line'], 'bars is blocked');
  // the start page's Housing preset (a map) is not on offer either: the step opens with nothing chosen rather than a blocked film
  const types = await typeStepFor('bps_county_permits', { type: 'map' });
  assert.ok(!types.includes('map'));
  assert.deepEqual(await typeStepFor('state_obesity_fastfood'), ['map', 'bars', 'line'], 'CONTROL: a dataset not on the list keeps all three');
});
