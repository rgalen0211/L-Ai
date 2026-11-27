// THE HARD RULE (CONNECT 11-27): no tool that can spend credits may also be a write tool, and an AI connection cannot spend credits at all.
//   (a) from the ToolDef flags of EVERY tool in TOOLS: a tool that carries a spend marker (the render ladder, a confirm / credits / amount / price argument) never has write, edit, fetch_data or submit_data scope and is never destructive;
//   (b) from a stand-in world run: calling every department tool (switch on, switch off, list unreadable, bad arguments, no permission) leaves the credits ledger untouched (balance, held, jobs, previews used) and costs 0 in the call log;
//   (c) no answer of a department tool, in any state of any fixture below, contains a file path (a drive letter, a backslash, /Users/, /home/, file://).
// Planted faults: tests/connect_dept_flip_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { TOOLS } from '../supabase/functions/connect-core/tools.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';

const compile = makeCompile(Ajv2020);

// ---------------------------------------------------------------- (a) the flags
const WRITE_LIKE = new Set(['write', 'edit', 'fetch_data', 'submit_data']);
const SPEND_ARGS = /^(confirm|confirmed|credits?|amount|spend|pay|payment|price|cost|buy|purchase|charge)$/i;
const spendMarkers = (t) => [
  ...(t.ladder ? ['ladder (starts render jobs)'] : []),
  ...Object.keys(t.inputSchema?.properties ?? {}).filter((k) => SPEND_ARGS.test(k)).map((k) => 'argument ' + k),
];

test('no tool in TOOLS is both write-like and able to spend credits (flags: scope, readOnly, destructive, ladder, spend arguments)', () => {
  assert.ok(TOOLS.length > 30, 'the whole tool list is looked at: ' + TOOLS.length);
  for (const t of TOOLS) {
    const m = spendMarkers(t);
    if (!m.length) continue;
    assert.ok(!WRITE_LIKE.has(t.scope), `${t.name} has scope ${t.scope} and ${m.join(', ')}: a tool that can spend must never be a write tool`);
    assert.ok(t.destructive !== true, `${t.name} is destructive and ${m.join(', ')}`);
  }
});

test('the spend-capable tools are exactly the known ones and each is held to the free scope or to a read-only refusal', () => {
  const spenders = TOOLS.filter((t) => spendMarkers(t).length).map((t) => `${t.name}:${t.scope}:${t.readOnly ? 'ro' : 'rw'}`).sort();
  // make_contact_sheet and make_preview start only FREE jobs (a connection cannot spend: the quote refuses anything that costs);
  // request_full_render is refused every time, listed:false, read-only. A new entry here must be decided on purpose.
  assert.deepEqual(spenders, ['make_contact_sheet:render_free:rw', 'make_preview:render_free:rw', 'request_full_render:read:ro']);
  const full = TOOLS.find((t) => t.name === 'request_full_render');
  assert.equal(full.listed, false);
});

test('no tool takes a credit or payment argument other than the one refused confirm, and no tool is named for buying or paying', () => {
  for (const t of TOOLS) {
    assert.ok(!/(^|_)(buy|pay|purchase|checkout|charge|spend|topup|top_up|subscribe)(_|$)/.test(t.name), t.name);
    for (const k of Object.keys(t.inputSchema?.properties ?? {})) {
      if (SPEND_ARGS.test(k)) assert.equal(`${t.name}.${k}`, 'request_full_render.confirm', `${t.name} takes a ${k} argument`);
    }
  }
});

test('the department tools carry no spend marker at all and are read scope', () => {
  const names = ['get_compilation_status', 'open_compilations_page', 'list_games', 'open_games_page', 'list_perfect_city_options', 'open_perfect_city'];
  for (const n of names) {
    const t = TOOLS.find((x) => x.name === n);
    assert.deepEqual(spendMarkers(t), [], n);
    assert.equal(t.scope, 'read'); assert.equal(t.readOnly, true);
  }
  // any other tool named for a department (perfect_city_summary ...) is held to the same
  for (const t of TOOLS.filter((x) => /perfect_city|game|compilation_status|compilations_page/.test(x.name))) {
    assert.deepEqual(spendMarkers(t), [], t.name);
    assert.equal(t.scope, 'read', t.name);
  }
});

// ---------------------------------------------------------------- (b)(c) a stand-in world run
const DEPT_TOOLS = TOOLS.filter((t) => /^(get_compilation_status|open_compilations_page|list_games|open_games_page|list_perfect_city_options|open_perfect_city|perfect_city_summary)$/.test(t.name)).map((t) => t.name);
const SWITCHES = ['compilations', 'games', 'perfectCity'];
const PATHISH = [/[A-Za-z]:[\\/](?!\/)/, /\\/, /\/Users\//i, /\/home\//i, /file:\/\//i, /\/mnt\//i, /\/var\/|\/tmp\//];
const strings = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => strings(x, out)); else if (v && typeof v === 'object') Object.values(v).forEach((x) => strings(x, out)); return out; };
const SEEN = [];                                                                // every answer of every fixture, for (c)

function world({ switches, departments, desktop = true, scopes = ['read', 'write', 'render_free'], credits = 100 } = {}) {
  const w = new FakeWorld();
  const P = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
  w.addUser(P.userId, 'alice@example.test', credits); w.invite(P.userId, P.clientId, scopes);
  const u = w.users.get(P.userId);
  u.switches = switches; u.desktopApp = desktop;
  if (departments) u.departments = departments;
  return { w, u, P, env: (wrap) => { const d = w.data(P.userId); return { data: wrap ? new Proxy(d, { get: (t, k) => wrap[k] ?? t[k] }) : d, policy: w.policy(), deps: { compile } }; } };
}
const ledger = (h) => JSON.stringify({ credits: h.u.credits, held: h.u.held, jobs: h.u.jobs.length, previews: [...h.u.previewsUsed], logs: h.w.logs.map((l) => l.credits ?? 0) });
const argsFor = (name, projectId) => (name === 'get_compilation_status' ? { project_id: projectId } : {});

const STATES = [
  ['switch on', { switches: SWITCHES }],
  ['switch off', { switches: [], desktop: false }],
  ['public flip', { switches: [], desktop: false, working: ['compilations', 'games', 'geo_intelligence'] }],
  ['no permission', { switches: SWITCHES, scopes: ['write'] }],
  ['list unreadable', { switches: SWITCHES, desktop: false, wrap: { switches: async () => { throw new Error('db down'); } } }],
  ['no credits at all', { switches: SWITCHES, credits: 0 }],
];

for (const name of DEPT_TOOLS) {
  test(`${name}: in every state the credits ledger is untouched, the call log says 0 credits, and no answer holds a file path`, async () => {
    for (const [label, st] of STATES) {
      const h = world(st);
      if (st.working) h.u.departments = h.w.departments.map((x) => (st.working.includes(x.id) ? { ...x, status: 'working' } : { ...x }));
      // a project holding a request whose words are the kind a path could hide in
      const mk = await callTool('create_project', { title: 'Compilation' }, h.P, h.env());
      let projectId = mk.data?.project_id ?? '00000000-0000-4000-8000-000000000001';
      if (mk.data?.project_id && st.scopes === undefined) await callTool('set_compilation_request', { project_id: projectId, phrase: 'great news', folders: ['My Videos'] }, h.P, h.env());
      const before = ledger(h);
      const bad = [{}, { project_id: 'C:\\Users\\alice\\clips' }, { place: '/home/alice', business_type: 'file:///x' }, { x: 1 }];
      for (const a of [argsFor(name, projectId), ...bad]) {
        const r = await callTool(name, a, h.P, h.env(st.wrap));
        SEEN.push({ name, label, text: r.text, data: r.data });
        assert.ok(!(r.credits > 0), `${name} [${label}] reported credits ${r.credits}`);
        assert.ok(!(typeof r.data?.credits === 'number' && r.data.credits > 0), `${name} [${label}] data.credits ${r.data?.credits}`);
        for (const s of [r.text, ...strings(r.data)]) for (const re of PATHISH) assert.ok(!re.test(s), `${name} [${label}] answer holds a path-like text (${re}): ${s.slice(0, 160)}`);
      }
      // the ledger before the calls (after the fixture's own create_project) equals the ledger after: only the log grew, with zero credits
      const after = JSON.parse(ledger(h)); const was = JSON.parse(before);
      assert.equal(after.credits, was.credits, `${name} [${label}] balance`);
      assert.equal(after.held, was.held, `${name} [${label}] held`);
      assert.equal(after.jobs, was.jobs, `${name} [${label}] jobs`);
      assert.deepEqual(after.previews, was.previews, `${name} [${label}] previews used`);
      assert.ok(after.logs.every((c) => c === 0), `${name} [${label}] call log credits ${after.logs.join()}`);
      assert.equal(h.u.credits, st.credits ?? 100); assert.equal(h.u.held, 0);
    }
  });
}

test('every answer collected above was looked at: the fixtures really produced both refusals and answers for every department tool', () => {
  for (const name of DEPT_TOOLS) {
    const mine = SEEN.filter((s) => s.name === name);
    assert.ok(mine.length >= STATES.length * 4, name + ': ' + mine.length);
    assert.ok(mine.some((s) => s.label === 'switch on' && /\S/.test(s.text)), name);
  }
});

test('the path scan itself can see a path (so an empty scan means something)', () => {
  for (const bad of ['C:\\Users\\x', 'C:/Users/x', '\\\\server\\share', '/Users/alice/v.mp4', '/home/alice', 'file:///etc/x', 'a\\b']) assert.ok(PATHISH.some((re) => re.test(bad)), bad);
  for (const fine of ['/app/#/d/games', '/game-phone/', '#/d/compilations', 'https://example.test/x', 'Open Games from the top bar.']) assert.ok(!PATHISH.some((re) => re.test(fine)), fine);
});
