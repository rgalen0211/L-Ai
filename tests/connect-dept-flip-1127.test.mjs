// The FLIP test (CONNECT 11-27): the three departments Ryan turns on one account at a time (Compilations, Games, Perfect City), every tool of each, through the REAL dispatch against the stand-in world.
// The decision it pins: the department tools are LISTED for everyone (read scope) and REFUSE per account until the account's own switch is on (or the department says 'working' for it: the public flip).
//   switch name          department id        tools (all scope read)
//   compilations         compilations         get_compilation_status, open_compilations_page
//   games                games                list_games, open_games_page
//   perfectCity          geo_intelligence     list_perfect_city_options, open_perfect_city   (perfect_city_summary joined with Perfect City part B)
// Every closed answer is checked for what it must NOT say: nothing of the department's contents. Planted faults for this file: tests/connect_dept_flip_mutants.mjs.
// What it found while being written (also in the paper CONNECT-DEPT-FLIP-1127.md): Compilations has a THIRD way to be open, the account's desktop-app flag; set_compilation_request is gated by that flag only, never by the switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { TOOLS } from '../supabase/functions/connect-core/tools.ts';
import { toolList, handleMcp } from '../supabase/functions/connect-core/mcp.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';

const compile = makeCompile(Ajv2020);
const NO_PROJECT = '00000000-0000-4000-8000-000000000001';

// ---------------------------------------------------------------- the three departments, as the code names them
const DEPTS = {
  compilations: {
    sw: 'compilations', id: 'compilations',
    tools: [['get_compilation_status', (ctx) => ({ project_id: ctx.projectId })], ['open_compilations_page', () => ({})]],
    // what a closed answer must never carry: the saved request's words, the folder names, the page address
    secrets: ['great news', 'My Videos', 'Holiday', '#/d/compilations', 'builds_on'],
  },
  games: {
    sw: 'games', id: 'games',
    tools: [['list_games', () => ({})], ['open_games_page', () => ({})]],
    secrets: ['Guess the next line', 'guess_the_next_line', '/app/#/d/games', '/game-phone', 'room code', 'four-letter', 'Fill the gap', 'fill_the_gap', 'Which game', 'Start the game', 'four letters', 'sample rounds'],
  },
  perfectCity: {
    sw: 'perfectCity', id: 'geo_intelligence',
    tools: [['list_perfect_city_options', () => ({})], ['open_perfect_city', () => ({})], ['perfect_city_summary', () => ({ place: 'montgomery_oh', business_type: 'fast_food', lat: 39.7589, lon: -84.1916 })]],
    switchOnly: true,                       // GEO's helper refuses 42501 without the switch, so the department being 'working' for everyone does NOT open these tools: the switch is the only key (Perfect City part B decision, 11-27)
    secrets: ['Dayton', 'Montgomery', 'Greene', 'Beavercreek', 'montgomery_oh', 'fast_food', 'Census', 'kilometre', '#/d/geo_intelligence'],
  },
};
const ALL = Object.entries(DEPTS).flatMap(([dept, d]) => d.tools.map(([name, args]) => ({ dept, d, name, args })));
const SWITCHES = Object.values(DEPTS).map((d) => d.sw);

// ---------------------------------------------------------------- the stand-in world: one account per call of world(), made up
function world({ switches = [], departments, desktop = false, scopes = ['read', 'write', 'render_free'] } = {}) {
  const w = new FakeWorld();
  const P = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
  w.addUser(P.userId, 'alice@example.test', 100); w.invite(P.userId, P.clientId, scopes);
  const u = w.users.get(P.userId);
  u.switches = switches; u.desktopApp = desktop;
  if (departments) u.departments = departments;
  const used = [];
  const env = (wrap) => {
    const d = w.data(P.userId);
    const spy = new Proxy(d, { get: (t, k) => (typeof t[k] === 'function' ? (...x) => { used.push(String(k)); return (wrap?.[k] ?? t[k])(...x); } : t[k]) });
    return { data: spy, policy: w.policy(), deps: { compile } };
  };
  const call = (name, args = {}, wrap) => callTool(name, args, P, env(wrap));
  return { w, u, P, used, call, env };
}
/** the account's departments list with the named ids saying 'working' */
const working = (w, ...ids) => w.departments.map((x) => (ids.includes(x.id) ? { ...x, status: 'working' } : { ...x }));
/** a project the Compilations status tool can be pointed at, holding a request with words that must never leak while closed */
async function withProject(h) {
  const prev = h.u.desktopApp;
  h.u.desktopApp = true;                                                         // the request is written while the account may (the saved words are then there to leak)
  const mk = await h.call('create_project', { title: 'Compilation' });
  assert.equal(mk.isError, undefined, mk.text);
  const set = await h.call('set_compilation_request', { project_id: mk.data.project_id, phrase: 'great news', folders: ['My Videos', 'Holiday'] });
  assert.equal(set.isError, undefined, set.text);
  h.u.desktopApp = prev;
  h.projectId = mk.data.project_id;
  h.used.length = 0;
  return h;
}
const everything = (r) => JSON.stringify([r.text, r.data ?? null]);
const READ_ONLY_BY_GATE = new Set(['switches', 'departments', 'whoami']);

// ---------------------------------------------------------------- 0. the inventory is what the paper says
test('the department tools: exactly these names, all read scope, read-only, listed, closed schemas', () => {
  for (const { name } of ALL) {
    const t = TOOLS.find((x) => x.name === name);
    assert.ok(t, name + ' exists');
    assert.equal(t.scope, 'read', name); assert.equal(t.readOnly, true, name); assert.equal(t.destructive ?? false, false, name);
    assert.notEqual(t.listed, false, name + ' must be listed (the decision: listed for everyone, refuses per account)');
    assert.equal(t.inputSchema.additionalProperties, false, name);
    assert.ok(!t.chatEditor && !t.homePanel && !t.preparedData, name + ' does not hang on another connector switch');
  }
});

test('TRIPWIRE: every tool named for one of these departments is covered here (a new one, e.g. perfect_city_summary, must be added to DEPTS)', () => {
  const covered = new Set(ALL.map((x) => x.name));
  // not switch-gated and judged on their own below: set_compilation_request (gated by the desktop-app flag only)
  const OUTSIDE = new Set(['set_compilation_request']);
  const dept = TOOLS.filter((t) => /compilation|perfect_city|game/i.test(t.name) && !OUTSIDE.has(t.name));
  const missing = dept.filter((t) => !covered.has(t.name)).map((t) => t.name);
  assert.deepEqual(missing, [], 'add these to DEPTS in tests/connect-dept-flip-1127.test.mjs so their flip is tested: ' + missing.join(', '));
});

// ---------------------------------------------------------------- 1. switch absent => refused in plain words, nothing of the department shown
for (const { dept, d, name, args } of ALL) {
  test(`${name}: switch absent (and the department says "soon"): refused in plain words, shows nothing of ${dept}, reads nothing but the gate`, async () => {
    const h = await withProject(world({ switches: [], desktop: false }));
    const r = await h.call(name, args(h));
    assert.equal(r.isError, true, name + ': ' + r.text);
    assert.match(r.code, /^(not_available|unavailable)$/);
    assert.match(r.text, /not (open|available|switched on)|could not be read/i, 'says in words that it is not open: ' + r.text);
    assert.match(r.text, /Nothing was looked up|nothing was looked up|not available|not open/);
    for (const s of d.secrets) assert.ok(!everything(r).includes(s), `${name} closed answer must not contain "${s}": ${everything(r)}`);
    assert.ok(!/undefined|\[object|NaN/.test(everything(r)));
    assert.notEqual(r.data?.looked_up, true);
    assert.ok(h.used.every((m) => READ_ONLY_BY_GATE.has(m)), 'a closed tool touched only the gate: ' + h.used.join());
  });
}

// ---------------------------------------------------------------- 2. ONLY another department's switch on => still refused (no cross-opening)
for (const { dept, d, name, args } of ALL) {
  test(`${name}: with only OTHER departments' switches on it is still refused`, async () => {
    const others = SWITCHES.filter((s) => s !== d.sw);
    for (const sw of [...others.map((s) => [s]), others, ['myFilms'], ['myFilms', ...others]]) {
      const h = await withProject(world({ switches: sw, desktop: false }));
      const r = await h.call(name, args(h));
      assert.equal(r.isError, true, `${name} with ${sw}: ${r.text}`);
      assert.equal(r.code, 'not_available');
      for (const s of d.secrets) assert.ok(!everything(r).includes(s), `${name} with ${sw} leaked "${s}"`);
    }
  });
  test(`${name}: another department saying "working" does not open it`, async () => {
    for (const other of Object.values(DEPTS).filter((x) => x.id !== d.id)) {
      const h0 = world({ switches: [], desktop: false });
      const h = await withProject(Object.assign(h0, {}));
      h.u.departments = working(h.w, other.id);
      const r = await h.call(name, args(h));
      assert.equal(r.isError, true, `${name} with ${other.id} working: ${r.text}`);
      assert.equal(r.code, 'not_available');
    }
  });
}

// ---------------------------------------------------------------- 3. the right switch => works
for (const { dept, d, name, args } of ALL) {
  test(`${name}: with the switch "${d.sw}" on it works (no desktop app, department still "soon"), and still only reads`, async () => {
    for (const sw of [[d.sw], [...SWITCHES], ['myFilms', d.sw]]) {
      const h = await withProject(world({ switches: sw, desktop: false }));
      const r = await h.call(name, args(h));
      assert.equal(r.isError, undefined, `${name} with ${sw}: ${r.text}`);
      assert.ok(r.text.length > 20);
      assert.ok(h.used.every((m) => ['switches', 'departments', 'whoami', 'compilationGet', 'perfectCitySummary'].includes(m)), 'opened tools only read: ' + h.used.join());
    }
  });
  test(`${name}: the switch is per account (same call: on for one person, refused for another)`, async () => {
    const h = await withProject(world({ switches: [d.sw], desktop: false }));
    const bob = { tokenHash: 'h-bob', userId: 'u-bob', clientId: 'client-claude' };
    h.w.addUser(bob.userId, 'bob@example.test', 100); h.w.invite(bob.userId, bob.clientId, ['read']); h.w.users.get(bob.userId).desktopApp = false;
    assert.equal((await h.call(name, args(h))).isError, undefined);
    const rb = await callTool(name, args(h), bob, { data: h.w.data(bob.userId), policy: h.w.policy(), deps: { compile } });
    assert.equal(rb.isError, true);
    assert.equal(rb.code, 'not_available');
  });
}

// ---------------------------------------------------------------- 4. the public flip: the department says 'working' for the person, no switch
for (const { dept, d, name, args } of ALL) {
  test(`${name}: the public flip: "${d.id}" working in the departments list opens it with no switch; "soon" or a malformed row does not`, async () => {
    const h = await withProject(world({ switches: [], desktop: false }));
    h.u.departments = working(h.w, d.id);
    const r = await h.call(name, args(h));
    if (d.switchOnly) { assert.equal(r.isError, true, name + ' must stay closed on the public flip alone (the switch is its only key): ' + r.text); return; }
    assert.equal(r.isError, undefined, name + ': ' + r.text);
    for (const odd of [{ id: d.id, label: 'x' }, { id: d.id, label: 'x', status: 'Working' }, { id: d.id, label: 'x', status: 'working ' }, { id: d.id + 'x', label: 'x', status: 'working' }, { id: d.id.toUpperCase(), label: 'x', status: 'working' }, { id: d.id, label: 'x', status: 'soon' }, null]) {
      h.u.departments = [odd];
      const c = await h.call(name, args(h));
      assert.equal(c.isError, true, `${name} with row ${JSON.stringify(odd)}: ${c.text}`);
    }
  });
}

// ---------------------------------------------------------------- 5. a switch list that cannot be read => closed
for (const { dept, d, name, args } of ALL) {
  test(`${name}: switch list unreadable (throws, or is not a list) => closed, in words, nothing shown`, async () => {
    const h = await withProject(world({ switches: [d.sw], desktop: false }));                 // the switch IS on in the data: only the read fails
    for (const bad of [async () => { throw new Error('db down'); }, async () => d.sw, async () => ({ [d.sw]: true }), async () => null, async () => undefined, async () => 42]) {
      h.u.departments = undefined;
      const r = await h.call(name, args(h), { switches: bad });
      assert.equal(r.isError, true, `${name}: ${r.text}`);
      assert.match(r.code, /^(not_available|unavailable)$/);
      for (const s of d.secrets) assert.ok(!everything(r).includes(s), `${name} leaked "${s}" while the switch list was unreadable`);
    }
    // both lists unreadable
    const both = await h.call(name, args(h), { switches: async () => { throw new Error('x'); }, departments: async () => { throw new Error('y'); } });
    assert.equal(both.isError, true);
    for (const s of d.secrets) assert.ok(!everything(both).includes(s));
  });
}

// ---------------------------------------------------------------- 6. a misspelt or differently cased switch => closed
const NEAR_MISSES = ['Games', 'GAMES', 'game', 'games ', ' games', 'perfectcity', 'PerfectCity', 'perfectCities', 'perfect_city', 'Perfect City', 'perfectCity ', 'geo_intelligence', 'geoIntelligence', 'compilation', 'Compilations', 'COMPILATIONS', 'compilations ', 'compilation_s', 'comp', ''];
for (const { dept, d, name, args } of ALL) {
  test(`${name}: only the exact switch "${d.sw}" opens it; near misses (case, space, singular, department id) stay closed`, async () => {
    for (const bad of NEAR_MISSES.filter((s) => s !== d.sw)) {
      const h = await withProject(world({ switches: [bad], desktop: false }));
      const r = await h.call(name, args(h));
      assert.equal(r.isError, true, `${name} must stay closed for the switch ${JSON.stringify(bad)}: ${r.text}`);
      assert.equal(r.code, 'not_available');
    }
    const h = await withProject(world({ switches: [d.sw], desktop: false }));
    assert.equal((await h.call(name, args(h))).isError, undefined, 'and the exact name opens it');
  });
}

// ---------------------------------------------------------------- 7. tools/list: listed for everyone, scope read, whatever the account's switches
test('tools/list shows every department tool to every account (listed for everyone, refuse per account), read scope, read-only hint', async () => {
  const names = ALL.map((x) => x.name);
  const viaList = Object.fromEntries(toolList().map((t) => [t.name, t]));
  for (const n of names) {
    assert.ok(viaList[n], n + ' is in toolList()');
    assert.equal(TOOLS.find((t) => t.name === n).scope, 'read');
    assert.equal(viaList[n].annotations.readOnlyHint, true); assert.equal(viaList[n].annotations.destructiveHint, false);
  }
  // over the real MCP face, for accounts with no switch, one switch, and all switches: the same list
  for (const sw of [[], ['games'], SWITCHES]) {
    const h = world({ switches: sw, desktop: false });
    const deps = { verifyToken: async (t) => (t === 'tok' ? h.P : null), dataFor: () => h.w.data(h.P.userId), policy: h.w.policy(), deps: { compile }, resourceMetadataUrl: 'https://example.test/m' };
    const res = await handleMcp(new Request('https://example.test/mcp', { method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }), deps);
    const tools = (await res.json()).result.tools;
    for (const n of names) assert.ok(tools.some((t) => t.name === n), `${n} is listed for an account with switches ${JSON.stringify(sw)}`);
  }
});

test('over the real MCP face a closed department answers as a refusal (isError true), an open one as an answer', async () => {
  for (const { d, name, args } of ALL) {
    for (const [sw, open] of [[[], false], [[d.sw], true]]) {
      const h = await withProject(world({ switches: sw, desktop: false }));
      const deps = { verifyToken: async (t) => (t === 'tok' ? h.P : null), dataFor: () => h.w.data(h.P.userId), policy: h.w.policy(), deps: { compile }, resourceMetadataUrl: 'https://example.test/m' };
      const res = await handleMcp(new Request('https://example.test/mcp', { method: 'POST', headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args(h) } }) }), deps);
      const out = (await res.json()).result;
      assert.equal(out.isError, !open, `${name} switches ${JSON.stringify(sw)}`);
      if (!open) for (const s of d.secrets) assert.ok(!JSON.stringify(out).includes(s), `${name} leaked "${s}" over MCP`);
    }
  }
});

// ---------------------------------------------------------------- 8. before the gate: not signed in and no permission are refused before the switch is even read
test('no connection, or no read permission: refused before any department switch is read', async () => {
  for (const { d, name, args } of ALL) {
    const h = world({ switches: SWITCHES, desktop: true, scopes: ['write'] });
    const r = await h.call(name, args({ projectId: NO_PROJECT }));
    assert.equal(r.code, 'scope', name);
    const stranger = { tokenHash: 'h-x', userId: 'u-x', clientId: 'client-x' };
    const s = await callTool(name, args({ projectId: NO_PROJECT }), stranger, h.env());
    assert.equal(s.code, 'no_grant', name);
    assert.ok(!h.used.includes('switches'), name + ': the switch was not read');
    for (const x of d.secrets) assert.ok(!everything(r).includes(x) && !everything(s).includes(x));
  }
});

// ---------------------------------------------------------------- 9. Compilations: what the switch does NOT govern (pinned as it is today)
test('Compilations has a THIRD way to be open: an account with the desktop-app flag is open with no switch (the invited testers keep it); the switch opens it for an account without', async () => {
  for (const name of ['get_compilation_status', 'open_compilations_page']) {
    const withApp = await withProject(world({ switches: [], desktop: true }));
    const r = await withApp.call(name, DEPTS.compilations.tools.find((t) => t[0] === name)[1](withApp));
    assert.equal(r.isError, undefined, name + ' is open for an account that has the desktop app, switch or not: ' + r.text);
  }
  // so switching 'compilations' OFF again closes it only for an account without the desktop-app flag
  const h = await withProject(world({ switches: ['compilations'], desktop: false }));
  assert.equal((await h.call('open_compilations_page')).isError, undefined);
  h.u.switches = [];
  assert.equal((await h.call('open_compilations_page')).code, 'not_available', 'undo = switch off: refuses again at once');
});

test('set_compilation_request: the desktop-app flag OR the Compilations switch opens it (11-27 09:30: BUILDER lets a switch-only account sign in its own computer); with neither it refuses', async () => {
  const noApp = await world({ switches: [], desktop: false });
  const id = (await noApp.call('create_project', { title: 'T' })).data.project_id;
  const refused = await noApp.call('set_compilation_request', { project_id: id, phrase: 'great news', folders: ['My Videos'] });
  assert.equal(refused.isError, true); assert.equal(refused.code, 'not_available');
  assert.equal(refused.data.reason, 'desktop_app_not_open');
  const sw = await world({ switches: ['compilations'], desktop: false });
  const id3 = (await sw.call('create_project', { title: 'T' })).data.project_id;
  const viaSwitch = await sw.call('set_compilation_request', { project_id: id3, phrase: 'great news', folders: ['My Videos'] });
  assert.equal(viaSwitch.isError, undefined, viaSwitch.text);
  const app = world({ switches: [], desktop: true });
  const id2 = (await app.call('create_project', { title: 'T' })).data.project_id;
  const ok = await app.call('set_compilation_request', { project_id: id2, phrase: 'great news', folders: ['My Videos'] });
  assert.equal(ok.isError, undefined, ok.text);
  assert.equal(TOOLS.find((t) => t.name === 'set_compilation_request').scope, 'write');
  assert.ok(toolList().some((t) => t.name === 'set_compilation_request'), 'listed too');
});

// ---------------------------------------------------------------- 10. flipping on and off through one account: the same person, one action, back and forth
test('one account, one action each way: off -> refused, switch on -> works, switch off -> refused again at once (for each department)', async () => {
  for (const { d, name, args } of ALL) {
    const h = await withProject(world({ switches: [], desktop: false }));
    assert.equal((await h.call(name, args(h))).isError, true, name + ' off');
    h.u.switches = [d.sw];
    assert.equal((await h.call(name, args(h))).isError, undefined, name + ' on');
    h.u.switches = [];
    assert.equal((await h.call(name, args(h))).isError, true, name + ' off again');
  }
});
