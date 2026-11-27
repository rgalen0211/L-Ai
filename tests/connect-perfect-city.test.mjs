// Perfect City, the connector's side (CONNECT 2026-11-27, Ryan's "turn the other departments on"): two read-only tools, list_perfect_city_options and open_perfect_city.
// They run nothing and read no place: they say what GEO's page offers (static, announced by GEO 08:10) with the basis word of every number, what it does not know, and where the page is.
// The gate is the account's own switch `perfectCity`. Against the in-memory stand-in for the database; every account here is made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { TOOLS } from '../supabase/functions/connect-core/tools.ts';
import { toolList } from '../supabase/functions/connect-core/mcp.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { PC_PLACES, PC_BUSINESS_TYPES, PC_LAYERS, PC_MEASURES, PC_NOT_KNOWN, PERFECT_CITY_PAGE, PERFECT_CITY_ANNOUNCED, PC_OFF_WORDS } from '../supabase/functions/connect-core/perfect_city.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
const B = { tokenHash: 'h-bob', userId: 'u-bob', clientId: 'client-claude' };
const C = { tokenHash: 'h-carol', userId: 'u-carol', clientId: 'client-claude' };
const NAMES = ['list_perfect_city_options', 'open_perfect_city'];
function world({ alice = ['perfectCity'], bob = [] } = {}) {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100); w.invite(A.userId, A.clientId, ['read']);
  w.addUser(B.userId, 'bob@example.test', 100); w.invite(B.userId, B.clientId, ['read']);
  w.addUser(C.userId, 'carol@example.test', 100); w.invite(C.userId, C.clientId, ['write']);                      // no read scope
  w.users.get(A.userId).switches = alice; w.users.get(B.userId).switches = bob; w.users.get(C.userId).switches = ['perfectCity'];
  const used = [];                                                                                              // every call a tool made on the database layer
  const env = (p, wrap) => {
    const d = w.data(p.userId);
    const spy = new Proxy(d, { get: (t, k) => (typeof t[k] === 'function' ? (...x) => { used.push(String(k)); return (wrap?.[k] ?? t[k])(...x); } : t[k]) });
    return { data: spy, policy: w.policy(), deps: { compile } };
  };
  return { w, used, call: (name, args = {}, p = A, wrap) => callTool(name, args, p, env(p, wrap)) };
}
const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');

test('both tools exist, are listed, read-only, free of side effects, and take only the fields they name', () => {
  for (const n of NAMES) {
    const t = TOOLS.find((x) => x.name === n);
    assert.ok(t, n); assert.equal(t.scope, 'read'); assert.equal(t.readOnly, true); assert.equal(t.idempotent, true);
    assert.notEqual(t.listed, false, 'a person\'s AI must be able to see it (it refuses in words when the switch is off)');
    assert.equal(t.inputSchema.additionalProperties, false);
    assert.ok(toolList().some((x) => x.name === n && x.annotations.readOnlyHint === true && x.annotations.destructiveHint === false));
  }
  assert.deepEqual(Object.keys(TOOLS.find((x) => x.name === NAMES[0]).inputSchema.properties), []);
  assert.deepEqual(Object.keys(TOOLS.find((x) => x.name === NAMES[1]).inputSchema.properties).sort(), ['business_type', 'place']);
  assert.deepEqual(TOOLS.find((x) => x.name === NAMES[1]).inputSchema.required, []);
  for (const k of ['place', 'business_type']) assert.equal(TOOLS.find((x) => x.name === NAMES[1]).inputSchema.properties[k].pattern, '^[a-z][a-z0-9_]{1,30}$', k + ' is a short lowercase id, checked by the schema as well as by the lookup');
});

test('the descriptions are plain: no price, no credit amount, no promise of a score or a verdict', () => {
  for (const n of NAMES) {
    const d = TOOLS.find((x) => x.name === n).description;
    assert.ok(!/\$|\bcredits? \d|\b\d+ credits?\b|price|is free|and free|for free|free of charge/i.test(d), n + ': ' + d);
    assert.ok(!/\b(best|ideal|profitable|will succeed|recommend)/i.test(d), n);
    assert.match(d, /switched on/, n + ' says it needs the switch');
  }
});

test('switch OFF (empty list, or other switches only): both tools refuse in plain words, say it is owner-only, and look nothing up', async () => {
  for (const sw of [[], ['myFilms', 'compilations', 'perfectcity', 'PerfectCity']]) {
    const { call, used } = world({ alice: sw });
    for (const n of NAMES) {
      const r = await call(n, {});
      assert.equal(r.isError, true, n); assert.equal(r.code, 'not_available');
      assert.equal(r.text, PC_OFF_WORDS);
      assert.match(r.text, /owner-only switch/); assert.match(r.text, /Nothing was looked up/);
      assert.equal(r.data.on, false); assert.equal(r.data.owner_only, true); assert.equal(r.data.looked_up, false);
      assert.equal(JSON.stringify(r).includes('Dayton'), false, 'no part of the department is shown to an account without the switch');
    }
    assert.ok(used.every((m) => m === 'switches' || m === 'departments'), used.join());
  }
});

test('switch is per account: the same call is on for one person and refused for another', async () => {
  const { call } = world({ alice: ['perfectCity'], bob: [] });
  assert.equal((await call(NAMES[0], {}, A)).isError, undefined);
  assert.equal((await call(NAMES[0], {}, B)).code, 'not_available');
});

test('a switch list that cannot be read is OFF (fails closed), and says so in words', async () => {
  const { call } = world();
  for (const n of NAMES) {
    const r = await call(n, {}, A, { switches: async () => { throw new Error('db down'); } });
    assert.equal(r.isError, true); assert.equal(r.code, 'unavailable'); assert.match(r.text, /could not be read just now/); assert.equal(r.data.available, false);
  }
  const r = await call(NAMES[0], {}, A, { switches: async () => 'perfectCity' });                  // not a list: not on
  assert.equal(r.code, 'unavailable');
});

test('the public flip: a department the server already calls working for the person opens it without their own switch; "soon" does not', async () => {
  const { w, call } = world({ alice: [] });
  assert.equal((await call(NAMES[0])).code, 'not_available');                                      // the seed says soon
  w.users.get(A.userId).departments = w.departments.map((d) => (d.id === 'geo_intelligence' ? { ...d, status: 'working' } : d));
  assert.equal((await call(NAMES[0])).isError, undefined);
  w.users.get(A.userId).departments = w.departments.map((d) => (d.id === 'games' ? { ...d, status: 'working' } : d));
  assert.equal((await call(NAMES[0])).code, 'not_available', 'another department working is not this one');
  const r = await call(NAMES[0], {}, A, { departments: async () => { throw new Error('x'); } });
  assert.equal(r.code, 'not_available', 'a failed department read is off');
});

test('not signed in, revoked, or no read permission: refused by the gate before the tool runs', async () => {
  const { w, call, used } = world();
  const stranger = { tokenHash: 'h-x', userId: 'u-x', clientId: 'client-claude' };
  for (const n of NAMES) {
    assert.equal((await call(n, {}, stranger)).code, 'no_grant');
    assert.equal((await call(n, {}, C)).code, 'scope', 'a connection without read permission cannot ask');
  }
  assert.ok(!used.includes('switches'), 'the switch was not even read');
  w.grants.delete(`${A.userId}|${A.clientId}`);
  assert.equal((await call(NAMES[0], {}, A)).code, 'no_grant');
});

test('list_perfect_city_options (switch on): the places, kinds of business, layers and measures, each with its basis word', async () => {
  const { call, used } = world();
  const r = await call(NAMES[0]);
  assert.equal(r.isError, undefined, r.text);
  const d = r.data;
  assert.equal(d.department.id, 'geo_intelligence'); assert.equal(d.department.label, 'Perfect City'); assert.equal(d.department.switch, 'perfectCity');
  assert.deepEqual(d.places.map((p) => p.id), ['montgomery_oh', 'greene_oh']);
  assert.deepEqual(d.business_types.map((b) => b.id), ['fast_food', 'food_places', 'grocery']);
  assert.deepEqual(d.layers.map((l) => [l.id, l.basis]), [['population', 'observed'], ['population_density', 'calculated'], ['median_household_income', 'estimated']]);
  assert.deepEqual(d.measures.map((m) => [m.id, m.basis]), [['nearest_distance', 'calculated'], ['businesses_within_rings', 'calculated'], ['people_within_rings', 'estimated']]);
  assert.deepEqual(d.rings_km, [1, 2, 5]); assert.deepEqual(d.basis_words, ['observed', 'calculated', 'estimated']);
  for (const x of [...d.layers, ...d.measures]) assert.ok(d.basis_words.includes(x.basis), x.id + ' has a basis word');
  assert.equal(d.page, '#/d/geo_intelligence'); assert.equal(d.shows_numbers_here, false);
  assert.match(d.status, /GEO to confirm|will confirm/);
  assert.ok(used.every((m) => m === 'switches' || m === 'departments'), 'the tool touched nothing but the switch list: ' + used.join());
});

test('honesty: the words say what is not known, every number kind carries its word, and no number about any place appears', async () => {
  const { call } = world();
  const r = await call(NAMES[0]);
  const t = r.text;
  for (const re of [/no sales or customer data/, /no success score and no ranking/, /straight lines/, /no drive times/, /whole counties/, /private source that may not be loaded/]) assert.match(t, re);
  for (const w of ['observed', 'calculated', 'estimated']) assert.match(t, new RegExp(w));
  assert.match(t, /you cannot see the page's numbers/);
  assert.deepEqual(r.data.not_known, [...PC_NOT_KNOWN]); assert.ok(r.data.not_known.length >= 6);
  // the only numbers anywhere in the answer are the ring sizes (1, 2, 5 km) and the date stamp of the announcement: no population, income, count or distance of any place
  const nums = [];
  JSON.stringify(r.data, (k, v) => { if (typeof v === 'number') nums.push(v); return v; });
  assert.deepEqual(nums.sort(), [1, 2, 5]);
  assert.ok(!/\b\d{3,}\b/.test(t.replace(PERFECT_CITY_ANNOUNCED, '').replace('2020 Census', 'Census')), 'no big number in the words: ' + t);
  assert.ok(!/\b(best|ideal|profitable|will succeed|recommend|winner|high demand|good location)/i.test(t));
});

test('what the AI may see is aggregate and public: no person, no address, no path, no coordinates, no link', async () => {
  const { call } = world();
  for (const r of [await call(NAMES[0]), await call(NAMES[1], { place: 'greene_oh', business_type: 'grocery' })]) {
    const all = r.text + JSON.stringify(r.data);
    assert.ok(!/@|[A-Za-z]:\\|\/Users\/|https?:|\blat\b|\blon\b|latitude|longitude|alice|bob|carol|token|secret/i.test(all), all.slice(0, 300));
  }
});

test('open_perfect_city: the page and the steps, no choice made and nothing looked up', async () => {
  const { call, used, w } = world();
  const r = await call(NAMES[1]);
  assert.equal(r.isError, undefined, r.text);
  assert.equal(r.data.page, PERFECT_CITY_PAGE); assert.equal(r.data.place, null); assert.equal(r.data.business_type, null);
  assert.equal(r.data.chosen_for_the_person, false); assert.equal(r.data.shows_numbers_here, false); assert.equal(r.data.steps.length, 4);
  assert.match(r.text, /#\/d\/geo_intelligence/); assert.match(r.text, /signed in/); assert.match(r.text, /you cannot see them/);
  assert.match(r.text, /What it does not know/);
  const r2 = await call(NAMES[1], { place: 'greene_oh', business_type: 'grocery' });
  assert.equal(r2.data.place, 'greene_oh'); assert.equal(r2.data.business_type, 'grocery');
  assert.match(r2.text, /Greene County, Ohio/); assert.match(r2.text, /Grocery/);
  assert.equal(r2.data.chosen_for_the_person, false);
  assert.ok(used.every((m) => m === 'switches' || m === 'departments'), used.join());
  assert.equal(w.users.get(A.userId).geo.size, 0, 'no question was written');
  assert.equal(w.users.get(A.userId).projects.length, 0);
});

test('open_perfect_city: a place or kind of business that is not offered, a wrong form, an extra field: refused in words with the real choices', async () => {
  const { call, used } = world();
  for (const args of [{ place: 'paris_fr' }, { business_type: 'casino' }, { place: 'montgomery_oh', business_type: 'fast_food_chain' }, { place: 'dayton' }]) {
    const r = await call(NAMES[1], args);
    assert.equal(r.isError, true, JSON.stringify(args)); assert.equal(r.code, 'args');
    assert.match(r.text, /montgomery_oh/); assert.match(r.text, /grocery/); assert.match(r.text, /Nothing was opened or looked up/);
    assert.deepEqual(r.data.places, ['montgomery_oh', 'greene_oh']);
  }
  for (const args of [{ place: 'Dayton, OH' }, { place: 5 }, { place: '../../etc' }, { business_type: 'x'.repeat(200) }, { extra: 1 }, { place: null }]) {
    const r = await call(NAMES[1], args);
    assert.equal(r.isError, true, JSON.stringify(args)); assert.equal(r.code, 'args');
  }
  assert.equal((await call(NAMES[0], { place: 'greene_oh' })).code, 'args', 'the list takes no arguments');
  assert.ok(!used.includes('askGeo') && !used.includes('askGeoShape') && !used.includes('getGeo'));
});

test('the order of refusals: switch off wins over bad input, so an off account learns nothing about the options', async () => {
  const { call } = world({ alice: [] });
  const r = await call(NAMES[1], { place: 'paris_fr' });
  assert.equal(r.code, 'not_available'); assert.ok(!/montgomery_oh|Dayton/.test(r.text));
});

test('limits: the connection\'s calls-per-minute limit still stops a loop of these tools', async () => {
  const { call } = world();
  let last;
  for (let i = 0; i < 70; i++) last = await call(NAMES[0]);
  assert.equal(last.code, 'rate'); assert.equal(last.data.started, false);
});

test('the page address is the site\'s own: #/d/<department id> exactly as assets/app-departments.js builds it, and the site calls the department Perfect City', () => {
  const win = { addEventListener() {}, removeEventListener() {} };
  vm.runInNewContext(read('assets/app-departments.js'), { window: win, document: { addEventListener() {}, removeEventListener() {}, body: {}, createElement() { return {}; } }, console });
  const D = win.ryagramDepartments;
  assert.equal(PERFECT_CITY_PAGE, D.pathOf('geo_intelligence'));
  assert.equal(D.KNOWN.geo_intelligence.label, 'Perfect City');
});

test('no new database call: the department needs no SQL of its own from the connector, and the real function wires nothing for it', () => {
  const src = read('supabase/functions/connect-core/perfect_city.ts');
  assert.ok(!/ctx\.data\.(ask|get|save|submit|edit|create|request)/.test(src), 'only switches() and departments() are read');
  assert.ok(!/fetch\(|Deno\.env|import\.meta/.test(src));
  const db = read('supabase/functions/connect/db.ts');
  assert.ok(!/perfect_city|perfectcity/i.test(db), 'db.ts has no Perfect City call');
});

test('the home panel says Perfect City, and leaves the department\'s status to the server', () => {
  const hp = read('supabase/functions/connect-core/home_panel.ts');
  assert.match(hp, /geo_intelligence: \{ label: "Perfect City"/);
  assert.ok(!/Opportunity Map"/.test(hp.split('\n').filter((l) => /label:/.test(l)).join('\n')));
});

test('the constants file names GEO as the owner and says the values are announced, to be confirmed', () => {
  const src = read('supabase/functions/connect-core/perfect_city.ts');
  assert.match(src, /GEO OWNS/); assert.match(src, /GEO to confirm/);
  assert.equal(PC_PLACES.length, 2); assert.equal(PC_BUSINESS_TYPES.length, 3); assert.equal(PC_LAYERS.length, 3); assert.equal(PC_MEASURES.length, 3);
});
