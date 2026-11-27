// CONNECT 11-27: one table-driven suite that holds EVERY tool of the connector to the same six questions the matrix in proposals/CONNECT-TOOL-COVERAGE-1127.md asks:
//   (b) not signed in / token refused   (c) missing scope   (e) bad input, one case per schema constraint   (f) the per-minute limits   (g) privacy: nothing of another person, no secret, no place on a computer
// plus "a stranger's project id is refused" for every tool that takes a project. The tool list is read from TOOLS itself, so a tool added tomorrow is held to all of it without anyone remembering to.
// Against the connector's own code and its in-memory stand-in world. Must-fail proof: tests/connect_tool_coverage_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { TOOLS } from '../supabase/functions/connect-core/tools.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { LIMITS } from '../supabase/functions/connect-core/types.ts';

const compile = makeCompile(Ajv2020);
const ALL_SCOPES = ['read', 'write', 'render_free', 'render_final', 'edit', 'fetch_data', 'submit_data'];
const A = { tokenHash: 'h-alice-SECRETHASH', userId: 'u-alice', clientId: 'client-claude' };
const B = { tokenHash: 'h-bob-SECRETHASH', userId: 'u-bob', clientId: 'client-claude' };
const N = { tokenHash: 'h-nobody', userId: 'u-nobody', clientId: 'client-claude' };       // a person with an account who never connected an AI
const R = { tokenHash: 'h-ro', userId: 'u-ro', clientId: 'client-ro' };                   // a read-only connection
const UUID1 = '00000000-0000-4000-8000-000000000001';

function world() {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100); w.addUser(B.userId, 'bob@example.test', 100); w.addUser(N.userId, 'nobody@example.test', 100); w.addUser(R.userId, 'ro@example.test', 100);
  w.invite(A.userId, A.clientId, ALL_SCOPES); w.invite(B.userId, B.clientId, ALL_SCOPES); w.invite(R.userId, R.clientId, ['read']);
  // every switch on, so a tool is judged on its own guards and not on "not open" (the switch tests are in each tool's own file)
  for (const u of [A, B, R]) { const f = w.users.get(u.userId); f.switches = ['compilations', 'games', 'geo', 'forecast', 'footage', 'preparedData']; }
  const env = (p) => ({ data: w.data(p.userId), policy: w.policy(), deps: { compile }, chatEditor: true, homePanel: true, preparedData: true });
  const call = async (p, name, args) => { w.counters.clear(); return callTool(name, args, p, env(p)); };
  return { w, env, call };
}
/** Everything a call could change, for "nothing was done": every user's rows (Maps flattened), not the limit counters. */
const snap = (w) => JSON.stringify([...w.users], (k, v) => (v instanceof Map ? [...v] : v));
/** The words an answer carries: its text and every string inside its data, as the AI reads them (not as JSON escapes them: a backslash in a schema pattern is not a Windows path). */
const leaves = (v, out = []) => { if (typeof v === 'string') out.push(v); else if (Array.isArray(v)) v.forEach((x) => leaves(x, out)); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.push(k); leaves(x, out); } return out; };
const everything = (r) => [String(r.text), ...leaves(r.data ?? {})].join('\n');

/** A value that satisfies a schema, or undefined when the generator cannot tell (the tool is then listed, never silently skipped). */
function sample(s, name = '') {
  if (!s || typeof s !== 'object') return undefined;
  if (s.enum) return s.enum[0];
  if (s.anyOf || s.oneOf || s.allOf) return undefined;
  if (s.type === 'string') {
    if (s.pattern && /\[0-9a-f\]\{8\}/.test(s.pattern)) return UUID1;
    const cands = ['abc', 'Abc', 'a.png', 'My Videos', 'x1', 'a b', 'a,b\n1,2', 'https://example.test/a.csv'];
    const min = s.minLength ?? 0;
    for (const c of cands) { const v = c.padEnd(min, 'a'); if (s.maxLength && v.length > s.maxLength) continue; if (!s.pattern || new RegExp(s.pattern).test(v)) return v; }
    return undefined;
  }
  if (s.type === 'integer' || s.type === 'number') return Math.min(Math.max(s.minimum ?? 1, 1), s.maximum ?? 1);
  if (s.type === 'boolean') return true;
  if (s.type === 'array') { const n = Math.max(s.minItems ?? 0, 0); const it = s.items ? sample(s.items) : 'a'; return n && it === undefined ? undefined : Array.from({ length: n }, () => it); }
  if (s.type === 'object') {
    const o = {};
    for (const k of s.required ?? []) { const v = sample((s.properties ?? {})[k], k); if (v === undefined) return undefined; o[k] = v; }
    return o;
  }
  return undefined;
}

/** Where the generated call is valid for the schema but the tool wants more before it looks at the project (it says so with its own "args"): the missing part, by hand. */
const HAND = { set_look: { set: [{ key: 'network.color', value: '#112233' }] } };

const NAMES = TOOLS.map((t) => t.name);
test('the list this suite walks is the connector\'s own: every tool, none skipped', () => {
  assert.ok(NAMES.length >= 34, 'at least the 24 listed tools and the ten unlisted/gated ones the matrix names');
  assert.equal(new Set(NAMES).size, NAMES.length);
  for (const n of ['request_full_render', 'request_footage', 'submit_prepared_data', 'forecast_series', 'place_question', 'what_is_within', 'get_film_link', 'make_preview']) assert.ok(NAMES.includes(n), n);
});

test('(b) NOT SIGNED IN: with no connection, a revoked one or another AI client, EVERY tool says so in words, before its arguments are read, and nothing is done', async () => {
  const { w, call } = world();
  const before = snap(w);
  for (const t of TOOLS) {
    for (const p of [N, { tokenHash: 'h-x', userId: A.userId, clientId: 'a-client-alice-never-connected' }]) {
      for (const args of [{}, { not: 'valid' }, sample(t.inputSchema) ?? {}]) {
        const r = await call(p, t.name, args);
        assert.equal(r.isError, true, t.name); assert.equal(r.code, 'no_grant', `${t.name} for ${p.clientId}`);
        assert.doesNotMatch(everything(r), /h-nobody|SECRETHASH|alice@example|u-alice/, t.name);
      }
    }
  }
  w.revoke(A.userId, A.clientId);
  for (const t of TOOLS) assert.equal((await call(A, t.name, {})).code, 'no_grant', `${t.name} after revoke`);
  assert.equal(snap(w), before, 'no call wrote anything');
});

test('(c) MISSING SCOPE: a connection holding every scope EXCEPT a tool\'s own is refused by the gate; one holding only its own passes the gate; a read-only connection is refused every non-read tool', async () => {
  const { w, call } = world();
  let i = 0;
  for (const t of TOOLS) {
    const without = { tokenHash: 'h-w' + i, userId: A.userId, clientId: 'without-' + t.name };
    const only = { tokenHash: 'h-o' + i, userId: A.userId, clientId: 'only-' + t.name };
    i++;
    w.invite(A.userId, without.clientId, ALL_SCOPES.filter((s) => s !== t.scope));
    w.invite(A.userId, only.clientId, [t.scope]);
    const r = await call(without, t.name, sample(t.inputSchema) ?? {});
    assert.equal(r.code, 'scope', `${t.name} needs ${t.scope}`);
    assert.equal(r.isError, true, t.name);
    const ok = await call(only, t.name, sample(t.inputSchema) ?? {});
    assert.notEqual(ok.code, 'scope', `${t.name} is open to a connection that holds exactly ${t.scope}`);
    assert.notEqual(ok.code, 'no_grant', t.name);
    const ro = await call(R, t.name, sample(t.inputSchema) ?? {});
    if (t.scope === 'read') assert.notEqual(ro.code, 'scope', `${t.name} is a read tool: a read-only connection may call it`);
    else assert.equal(ro.code, 'scope', `${t.name} is not a read tool: a read-only connection is refused`);
  }
});

test('(c) the scope a tool needs agrees with what it does: no tool that is read-only asks for more than read; no write-flagged tool is offered under read', () => {
  for (const t of TOOLS) {
    if (t.readOnly === true) assert.equal(t.scope === 'read' || t.scope === 'edit', true, `${t.name}: a read-only tool is under read (or the editor's own scope for opening it)`);
    if (t.scope === 'read' && !t.readOnly) assert.ok(t.chatEditor || t.homePanel || t.name === 'editor_film_card', `${t.name}: a non-read-only tool under the read scope is only the chat panel's own`);
    assert.ok(ALL_SCOPES.includes(t.scope), `${t.name} has a scope the database knows`);
  }
});

// ---------------------------------------------------------------------------------------------------- (e) bad input
/** Every single-constraint violation of the top level of a schema, from a valid baseline: [label, args]. */
function violations(schema, base) {
  const out = [];
  const props = schema.properties ?? {};
  for (const k of schema.required ?? []) { const a = { ...base }; delete a[k]; out.push([`missing required "${k}"`, a]); }
  for (const [k, ps] of Object.entries(props)) {
    const has = k in base;
    const withK = (v) => ({ ...base, [k]: v });
    if (ps.type === 'string') out.push([`"${k}" is a number`, withK(12345)]);
    if (ps.type === 'number' || ps.type === 'integer') out.push([`"${k}" is a word`, withK('abc')]);
    if (ps.type === 'boolean') out.push([`"${k}" is a word`, withK('yes')]);
    if (ps.type === 'array') out.push([`"${k}" is not a list`, withK('abc')]);
    if (ps.type === 'object') out.push([`"${k}" is a list`, withK([1])]);
    if (ps.enum) out.push([`"${k}" is not an allowed word`, withK('not-allowed-word')]);
    if (ps.type === 'string' && ps.maxLength) out.push([`"${k}" is over ${ps.maxLength}`, withK('a'.repeat(ps.maxLength + 1))]);
    if (ps.type === 'string' && ps.minLength) out.push([`"${k}" is under ${ps.minLength}`, withK('')]);
    if (ps.type === 'string' && ps.pattern && !/\[0-9a-f\]\{8\}/.test(ps.pattern)) out.push([`"${k}" breaks its pattern`, withK('a/b\\c:d*?"<>|')]);
    if (ps.type === 'string' && ps.pattern && /\[0-9a-f\]\{8\}/.test(ps.pattern)) out.push([`"${k}" is not an id`, withK('not-a-uuid')]);
    if (ps.minimum !== undefined && (ps.type === 'number' || ps.type === 'integer')) out.push([`"${k}" is under ${ps.minimum}`, withK(ps.minimum - 1)]);
    if (ps.maximum !== undefined && (ps.type === 'number' || ps.type === 'integer')) out.push([`"${k}" is over ${ps.maximum}`, withK(ps.maximum + 1)]);
    if (ps.type === 'integer') out.push([`"${k}" is not whole`, withK((ps.minimum ?? 1) + 0.5)]);
    if (ps.type === 'array' && ps.maxItems !== undefined) out.push([`"${k}" has more than ${ps.maxItems} items`, withK(Array.from({ length: ps.maxItems + 1 }, () => (ps.items ? sample(ps.items) ?? 'a' : 'a')))]);
    if (ps.type === 'array' && ps.minItems) out.push([`"${k}" has fewer than ${ps.minItems} items`, withK([])]);
    void has;
  }
  if (schema.additionalProperties === false) { out.push(['an unknown field', { ...base, zz_unknown_field: 1 }]); out.push(['a path field', { ...base, path: 'C:\\Videos\\a.mp4' }]); }
  return out;
}

test('(e) BAD INPUT, every tool, every schema constraint: a valid baseline passes the schema, and EACH single violation (missing, wrong type, not an allowed word, too long, too short, pattern, range, whole number, list size, an unknown field) is refused', () => {
  const cannot = [];
  let cases = 0;
  for (const t of TOOLS) {
    const base = sample(t.inputSchema);
    const check = compile(t.inputSchema);
    if (base === undefined) { cannot.push(t.name); continue; }
    assert.deepEqual(check(base), [], `${t.name}: the generated baseline must be valid, or every violation below proves nothing`);
    for (const [label, args] of violations(t.inputSchema, base)) {
      cases++;
      assert.ok(check(args).length > 0, `${t.name}: ${label} must be refused`);
    }
  }
  assert.ok(cases > 350, `${cases} violations checked`);
  assert.deepEqual(cannot, [], 'the generator can build a valid call for every tool (a tool it cannot is listed here and needs a hand-made case)');
});

test('(e) BAD INPUT through the gate: an array, a string, a number or an unknown field for EVERY tool is "args", the tool never runs, and nothing is written', async () => {
  const { w, call } = world();
  const before = snap(w);
  for (const t of TOOLS) {
    const base = sample(t.inputSchema) ?? {};
    for (const bad of [[1, 2], 'text', 42, ...(t.inputSchema.additionalProperties === false ? [{ ...base, zz_unknown_field: 1 }, { ...base, path: 'C:\\x.mp4', url: 'https://example.test/', credits: 0, confirm: true, force: true }] : [])]) {
      const r = await call(A, t.name, bad);
      assert.equal(r.isError, true, `${t.name} ${JSON.stringify(bad).slice(0, 40)}`);
      assert.equal(r.code, 'args', `${t.name} ${JSON.stringify(bad).slice(0, 40)}`);
    }
    for (const k of t.inputSchema.required ?? []) {
      const a = { ...base }; delete a[k];
      const r = await call(A, t.name, a);
      assert.equal(r.code, 'args', `${t.name} without ${k}`);
    }
  }
  assert.equal(snap(w), before, 'no refused call wrote anything');
});

test('(e) every tool schema is closed: an AI cannot add a field the tool does not name', () => {
  for (const t of TOOLS) assert.equal(t.inputSchema.additionalProperties, false, t.name);
});

// ---------------------------------------------------------------------------------------------------- (f) limits
test('(f) THE CALL LIMITS, every tool: at 60 calls a minute from one connection or 120 from one account the next call is "rate" with the limit named as data, before the tool runs and before its arguments are read', async () => {
  const { w, env } = world();
  const before = snap(w);
  for (const t of TOOLS) {
    for (const [key, which, max] of [[`u-alice|calls:client-claude`, 'connection_calls', LIMITS.callsPerMinutePerClient], [`u-alice|calls_acct`, 'account_calls', LIMITS.callsPerMinutePerAccount]]) {
      w.counters.clear();
      w.counters.set(key, max);
      if (t.chatEditor === 'app') continue;   // the chat panel has its own buckets (panel_calls), tested in connect-chat-editor-server
      const r = await callTool(t.name, sample(t.inputSchema) ?? {}, A, env(A));
      assert.equal(r.isError, true, `${t.name} ${which}`); assert.equal(r.code, 'rate', `${t.name} ${which}`);
      assert.equal(r.data?.limit, which, `${t.name}: the answer names which limit it was`);
      assert.equal(r.data?.max, max);
      assert.match(r.text, /minute/i);
    }
  }
  assert.equal(snap(w), before, 'a limited call did nothing');
  // control: one below the limit still runs, so the numbers above are the real ones
  w.counters.clear(); w.counters.set('u-alice|calls:client-claude', LIMITS.callsPerMinutePerClient - 1);
  assert.notEqual((await callTool('whoami_and_credits', {}, A, env(A))).code, 'rate');
});

// ---------------------------------------------------------------------------------------------------- (g) privacy
const LEAKS = [/SECRETHASH/, /h-alice|h-bob/, /bob@example|nobody@example|ro@example/, /u-bob|u-nobody|u-ro/, /BOB-PRIVATE/, /[A-Za-z]:\\/, /\/Users\//, /(^|[\s"'(])\\\\[A-Za-z0-9._-]+\\[A-Za-z0-9$]/, /service_role|SUPABASE_|postgres(ql)?:\/\//i, /Bearer\s+[A-Za-z0-9._-]{8,}/, /\bat\s+\S+\.(ts|js|mjs):\d+/, /password\s*[:=]/i];

test('(g) PRIVACY, every tool: whatever each tool answers to the signed-in person (answers and refusals alike) holds no token, no other person\'s email, id or project title, no place on a computer, no connection string and no stack trace', async () => {
  const { w, call } = world();
  const alice = (await call(A, 'create_project', { title: 'ALICE-FILM' })).data.project_id;
  const bob = (await call(B, 'create_project', { title: 'BOB-PRIVATE-TITLE' })).data.project_id;
  assert.ok(alice && bob);
  let answered = 0, refused = 0;
  for (const t of TOOLS) {
    const base = sample(t.inputSchema) ?? {};
    for (const k of ['project_id', 'p_project']) if (k in base) base[k] = alice;
    for (const args of [base, {}]) {
      const r = await call(A, t.name, args);
      const all = everything(r);
      for (const re of LEAKS) assert.doesNotMatch(all, re, `${t.name} ${r.isError ? 'refusal' : 'answer'}: ${re}`);
      r.isError ? refused++ : answered++;
    }
  }
  assert.ok(answered > 15 && refused > 15, `both answers (${answered}) and refusals (${refused}) were looked at`);
  // the scan can see: a planted leak in the same shape is found
  assert.ok(LEAKS.some((re) => re.test('see C:\\Users\\alice\\a.mp4')) && LEAKS.some((re) => re.test('token h-alice-SECRETHASH')), 'the patterns match what they are for');
});

test('(g) A STRANGER\'S PROJECT, every tool that takes a project: Bob naming Alice\'s project id is refused as if it did not exist, nothing of hers is shown and nothing of hers changes', async () => {
  const { w, call } = world();
  const alice = (await call(A, 'create_project', { title: 'ALICE-PRIVATE-TITLE' })).data.project_id;
  const aliceRows = () => JSON.stringify(w.users.get(A.userId), (k, v) => (v instanceof Map ? [...v] : v));
  const rowsBefore = aliceRows();
  const taking = TOOLS.filter((t) => 'project_id' in (t.inputSchema.properties ?? {}) || 'p_project' in (t.inputSchema.properties ?? {}));
  assert.ok(taking.length >= 12, `${taking.length} tools take a project`);
  for (const t of taking) {
    const base = { ...(sample(t.inputSchema) ?? {}), ...(HAND[t.name] ?? {}) };
    for (const k of ['project_id', 'p_project']) if (k in base) base[k] = alice;
    const r = await call(B, t.name, base);
    assert.notEqual(r.code, 'args', `${t.name}: the call must get past the schema for this to mean anything (${r.text.slice(0, 120)})`);
    assert.ok(r.isError === true || r.refused === true, `${t.name} must refuse Bob`);
    // the plain answer is "that project is not yours / not found" (not a crash that happens to be an error): the chat panel's own five calls speak the database's PT404, the full render is refused for everyone
    assert.equal(r.code, t.name === 'request_full_render' ? 'not_available' : ['editor_apply_ops', 'editor_undo', 'editor_undo_all_ai', 'my_edit_ops_since', 'editor_heartbeat'].includes(t.name) ? 'PT404' : 'not_found', `${t.name} answers as if the project did not exist`);
    assert.doesNotMatch(everything(r), /ALICE-PRIVATE-TITLE|alice@example|u-alice/, t.name);
  }
  assert.equal(aliceRows(), rowsBefore, 'Alice\'s rows are untouched');
});

// ---------------------------------------------------------------------------------------------------- the scope of every tool, pinned
// (the generic checks above read each tool's declared scope, so a tool quietly moved to a weaker scope would still pass them: this table is what the scope SHOULD be)
const PINNED = {
  whoami_and_credits: ['read', true],
  list_projects: ['read', true],
  get_story: ['read', true],
  create_project: ['write', false],
  get_story_schema: ['read', true],
  dataset_info: ['read', true],
  set_story: ['write', false],
  set_compilation_request: ['write', false],
  get_compilation_status: ['read', true],
  open_compilations_page: ['read', true],
  make_contact_sheet: ['render_free', false],
  make_preview: ['render_free', false],
  request_full_render: ['read', true],
  job_status: ['read', true],
  get_film_link: ['read', true],
  get_edit_state: ['read', true],
  set_look: ['edit', false],
  edit_tracks: ['edit', false],
  undo_my_changes: ['edit', false],
  request_download: ['fetch_data', false],
  list_my_downloads: ['read', true],
  submit_prepared_data: ['submit_data', false],
  list_my_data: ['read', true],
  suggest_next_step: ['read', true],
  get_cost_estimate: ['read', true],
  request_footage: ['fetch_data', false],
  get_clip_explanations: ['read', true],
  get_draft_messages: ['read', true],
  what_is_within: ['read', true],
  geo_answer: ['read', true],
  place_question: ['read', true],
  forecast_series: ['read', true],
  forecast_answer: ['read', true],
  open_editor: ['edit', true],
  editor_film_card: ['read', false],
  editor_apply_ops: ['edit', false],
  editor_undo: ['edit', false],
  editor_undo_all_ai: ['edit', false],
  my_edit_ops_since: ['edit', true],
  editor_heartbeat: ['edit', false],
  open_ryagram_home: ['read', true],
  list_games: ['read', true],
  open_games_page: ['read', true],
};

test('(c) PINNED: every tool\'s scope and read-only flag are exactly the table (a new tool must be added here on purpose, with the scope it deserves; spend-capable scopes stay out of reach: no tool asks for render_final)', () => {
  assert.deepEqual(TOOLS.map((t) => t.name).sort(), Object.keys(PINNED).sort(), 'a tool was added or removed: add it to PINNED with its scope, and to the matrix in proposals/CONNECT-TOOL-COVERAGE-1127.md');
  for (const t of TOOLS) assert.deepEqual([t.scope, t.readOnly === true], PINNED[t.name], t.name);
  assert.ok(!TOOLS.some((t) => t.scope === 'render_final'), 'no tool can start a paid full render');
});

test('(d) THE SWITCHES: a tool that belongs to the chat editor, the home panel or the AI-prepared-data switch is "no such tool" while its switch is off, for a connection that holds the scope, and nothing is done; with the switch on the same call is not "unknown_tool"', async () => {
  const { w, env } = world();
  const before = snap(w);
  const gated = TOOLS.filter((t) => t.chatEditor || t.homePanel || t.preparedData);
  assert.ok(gated.length >= 8, `${gated.length} gated tools`);
  for (const t of gated) {
    const off = await callTool(t.name, sample(t.inputSchema) ?? {}, A, { ...env(A), chatEditor: false, homePanel: false, preparedData: false });
    assert.equal(off.isError, true, t.name); assert.equal(off.code, 'unknown_tool', `${t.name} is hidden while its switch is off`);
  }
  assert.equal(snap(w), before, 'a hidden tool did nothing');
  for (const t of gated) {
    const on = await callTool(t.name, sample(t.inputSchema) ?? {}, A, env(A));
    assert.notEqual(on.code, 'unknown_tool', `${t.name} exists with its switch on`);
  }
});

test('(f) get_film_link: the daily limit on link requests ends in "rate" in plain words with nothing handed out, only for the person who used it up', async () => {
  const { w, env } = world();
  const mine = (await callTool('create_project', { title: 'Links' }, A, env(A))).data.project_id;
  const bobs = (await callTool('create_project', { title: 'Links' }, B, env(B))).data.project_id;
  w.counters.set('u-alice|links', LIMITS.linksPerDayPerUser);
  const r = await callTool('get_film_link', { project_id: mine }, A, env(A));
  assert.equal(r.isError, true); assert.equal(r.code, 'rate');
  assert.match(r.text, /limit/i);
  assert.doesNotMatch(r.text, /https?:\/\//);
  assert.notEqual((await callTool('get_film_link', { project_id: bobs }, B, env(B))).code, 'rate', 'another person is not limited by Alice\'s count');
  w.counters.set('u-alice|links', LIMITS.linksPerDayPerUser - 1);
  assert.notEqual((await callTool('get_film_link', { project_id: mine }, A, env(A))).code, 'rate', 'one below the limit still answers');
});

test('whoami_and_credits tells the truth about what a connection cannot do: a full render can never be started, and the answer says so as words and as data', async () => {
  const { call } = world();
  const r = await call(A, 'whoami_and_credits', {});
  assert.equal(r.isError, undefined);
  assert.equal(r.data.full_render_enabled, false);
  assert.match(r.text, /can never be started from a connection/);
});

test('(a) SUCCESS, the plain read tools: each answers the signed-in person in words and as data, and list_projects shows only that person\'s own projects, without times', async () => {
  const { call } = world();
  await call(A, 'create_project', { title: 'Alice one' }); await call(A, 'create_project', { title: 'Alice two' });
  await call(B, 'create_project', { title: 'BOB-PRIVATE-TITLE' });
  const list = await call(A, 'list_projects', {});
  assert.equal(list.isError, undefined, list.text);
  assert.match(list.text, /Alice one/); assert.match(list.text, /Alice two/); assert.doesNotMatch(everything(list), /BOB-PRIVATE/);
  assert.equal(list.data.projects.length, 2);
  assert.ok(list.data.projects.every((p) => !('created_at' in p) && !('updated_at' in p)), 'no timestamps (the directory rule)');
  const schema = await call(A, 'get_story_schema', {});
  assert.equal(schema.isError, undefined, schema.text);
  assert.match(schema.text, /Engine rules/); assert.match(schema.text, /Dataset catalog/);
  for (const [name, args] of [['whoami_and_credits', {}], ['list_my_downloads', {}], ['suggest_next_step', {}]]) {
    const r = await call(A, name, args);
    assert.equal(r.isError, undefined, `${name}: ${r.text}`); assert.ok(r.text.length > 10, name);
  }
});

test('(f/spend) NO TOOL SPENDS: a connection holding every scope calls every tool with a valid-looking call, twice: credits and holds never move, no answer reports credits used, and no full-render job exists afterwards', async () => {
  const { w, call } = world();
  const id = (await call(A, 'create_project', { title: 'Spend probe' })).data.project_id;
  const u = w.users.get(A.userId);
  const [credits, held] = [u.credits, u.held];
  for (let round = 0; round < 2; round++) {
    for (const t of TOOLS) {
      const base = { ...(sample(t.inputSchema) ?? {}), ...(HAND[t.name] ?? {}) };
      for (const k of ['project_id', 'p_project']) if (k in base) base[k] = id;
      const r = await call(A, t.name, base);
      assert.ok(!r.credits, `${t.name} reports credits used`);
    }
  }
  assert.deepEqual([u.credits, u.held], [credits, held], 'credits and holds are where they were');
  assert.ok(!u.jobs.some((j) => /final|full/i.test(JSON.stringify(j))), 'no full-render job was made');
});
