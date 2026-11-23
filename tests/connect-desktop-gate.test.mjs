// The desktop-app gate and the listed-only faces (CONNECT 2026-11-23, CC1's ruling 12:03; migration 20261123000500 makes connect_whoami say desktop_app).
// Customer step: a stranger's AI (Connect-an-AI open to everyone) is never sent to a desktop app only invited testers can get: the compilation and download tools refuse, nothing is saved or left waiting, the compilation
// question says "not available to you yet"; an invited tester still gets everything; and an AI that guesses the name of a tool tools/list does not offer is told there is no such tool.
// Runs the real tools and faces against the in-memory world; talks to nothing. Must-fails: tests/connect_desktop_gate_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { handleMcp } from '../supabase/functions/connect-core/mcp.ts';
import { handleRest } from '../supabase/functions/connect-core/rest.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };

function world({ app = true } = {}) {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 0); w.invite(A.userId, A.clientId, ['read', 'write', 'render_free', 'fetch_data']);
  w.setDesktopApp(A.userId, app);
  const env = (p) => ({ data: w.data(p.userId), policy: w.policy(), deps: { compile } });
  const call = (name, args) => callTool(name, args, A, env(A));
  return { w, env, call };
}
const REQUEST = { phrase: 'hello', folders: ['clips'], rules: [], texts: [], cards: [], checklist: [] };

test('a stranger (no desktop app): the compilation request is refused, nothing is saved, and the words say it is not available yet', async () => {
  const { w, call } = world({ app: false });
  const id = (await call('create_project', { title: 'Film' })).data.project_id;
  const r = await call('set_compilation_request', { project_id: id, ...REQUEST });
  assert.equal(r.isError, true);
  assert.equal(r.code, 'not_available');
  assert.match(r.text, /needs the Ryagram desktop app, which is not open to this account yet/);
  assert.match(r.text, /NOTHING was saved or written down/);
  assert.equal(r.data.saved, false);
  assert.equal(w.users.get(A.userId).requests.size, 0, 'no request was stored');
});

test('a stranger: a download request is refused, no plan is left waiting, and listing downloads says the same', async () => {
  const { w, call } = world({ app: false });
  const r = await call('request_download', { url: 'https://www.census.gov/data/file.csv', why: 'population by county', folder: 'data' });
  assert.equal(r.isError, true); assert.equal(r.code, 'not_available');
  assert.match(r.text, /A download request needs the Ryagram desktop app/);
  assert.equal(w.users.get(A.userId).plans.length, 0, 'no plan is waiting for an app that will never open it');
  const l = await call('list_my_downloads', {});
  assert.equal(l.isError, true); assert.equal(l.code, 'not_available');
});

test('a stranger asking for a compilation is told it is not available and offered a data film; a data film question is unchanged', async () => {
  const { call } = world({ app: false });
  const c = await call('suggest_next_step', { kind: 'compilation' });
  assert.equal(c.data.step, 'not_available');
  assert.match(c.text, /not available to them yet|not open to this account yet/);
  assert.ok(!/where to get the app/i.test(c.text));
  const d = await call('suggest_next_step', { kind: 'data_film' });
  assert.notEqual(d.data.step, 'not_available');
});

test('an invited tester (desktop app) keeps everything: the request is saved, the download plan is written, the compilation question asks about the app', async () => {
  const { w, call } = world({ app: true });
  const id = (await call('create_project', { title: 'Film' })).data.project_id;
  const r = await call('set_compilation_request', { project_id: id, ...REQUEST });
  assert.equal(r.isError, undefined, r.text);
  assert.equal(w.users.get(A.userId).requests.size, 1);
  const dl = await call('request_download', { url: 'https://www.census.gov/data/file.csv', why: 'population by county', folder: 'data' });
  assert.equal(dl.isError, undefined, dl.text);
  assert.equal(w.users.get(A.userId).plans.length, 1);
  const c = await call('suggest_next_step', { kind: 'compilation' });
  assert.notEqual(c.data.step, 'not_available');
});

test('an older server that does not say (no desktop_app answer) is treated as allowed: nothing changes until migration 20261123000500 is applied', async () => {
  const { w, env } = world({ app: true });
  const e = env(A);
  const data = { ...e.data, whoami: async () => { const { desktop_app, ...rest } = await e.data.whoami(); return rest; } };
  const id = (await callTool('create_project', { title: 'Film' }, A, { ...e, data })).data.project_id;
  const r = await callTool('set_compilation_request', { project_id: id, ...REQUEST }, A, { ...e, data });
  assert.equal(r.isError, undefined, r.text);
  assert.equal(w.users.get(A.userId).requests.size, 1);
});

// ------------------------------------------------------------------------------------------ the faces refuse a tool that is not listed
function faces() {
  const { w, env } = world({ app: true });
  const deps = { ...env(A), verifyToken: w.verifyToken, dataFor: (t, p) => w.data(p.userId), resourceMetadataUrl: 'https://x.test/functions/v1/connect/.well-known/oauth-protected-resource' };
  w.issue('tok-alice', A);
  const post = (body) => handleMcp(new Request('https://x.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer tok-alice' }, body: JSON.stringify(body) }), deps);
  const rest = (name) => handleRest(new Request('https://x.test/v1/tools/' + name, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer tok-alice' }, body: '{}' }), '/v1/tools/' + name, deps, 'https://x.test');
  return { post, rest };
}

test('MCP and REST: an AI that guesses the name of an unlisted tool is told there is no such tool; the polite refusal of the full render still answers', async () => {
  const { post, rest } = faces();
  for (const name of ['place_question', 'forecast_series', 'forecast_answer', 'geo_answer', 'what_is_within', 'request_footage', 'get_clip_explanations', 'get_draft_messages']) {
    const m = await (await post({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: {} } })).json();
    assert.equal(m.result.isError, true, name);
    assert.match(m.result.content[0].text, new RegExp(`There is no tool called "${name}"`), name);
    const r = await rest(name);
    const body = await r.json();
    assert.equal(body.isError, true, name);
    assert.match(body.text, /There is no tool called/, name);
  }
  const full = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'request_full_render', arguments: { project_id: 'x' } } })).json();
  assert.doesNotMatch(full.result.content[0].text, /There is no tool called/);
  const listed = await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'whoami_and_credits', arguments: {} } })).json();
  assert.equal(listed.result.isError, false);
});

test('the tools\' own direct calls (their tests, the mutants) are not affected: dispatch alone still reaches an unlisted tool', async () => {
  const { call } = world({ app: true });
  const r = await call('place_question', { lat: 40, lon: -83, minutes: 10 });
  assert.notEqual(r.code, 'unknown_tool', 'reached the tool, which refuses on its own switch');
});

// ------------------------------------------------------------------------------------------ the migration says the same rule as the download function
import fs from 'node:fs';
const sql = (p) => fs.readFileSync(new URL('../supabase/' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
test('migration 20261123000500: desktop_app is request_app_download\'s rule (not a worker; an invited tester or an administrator), one function changed, grants kept, ends with the gate line', () => {
  const m = sql('migrations/20261123000500_connect_whoami_desktop_app.sql');
  assert.match(m, /^begin; create or replace function public\.connect_whoami\(p_token_hash text\) returns jsonb/);
  assert.match(m, /desk := not exists \(select 1 from public\.workers w where w\.user_id = me\) and \(coalesce\(\(select s\.local_compute from public\.account_settings s where s\.owner_id = me\), false\) or exists \(select 1 from public\.app_admins a where a\.user_id = me\)\);/);
  assert.match(m, /'available', avail, 'held', held, 'desktop_app', desk\);/);
  assert.ok(!/\b(grant|revoke|drop|alter|insert|update|delete)\b/i.test(m), 'no grant, no table, no data');
  assert.match(m, / select ryagram_private\.gate_apply\(\); commit;$/);
  const dl = sql('migrations/20261026000500_app_downloads.sql');
  assert.ok(dl.includes("if exists (select 1 from public.workers w where w.user_id = p_owner) then raise exception 'A worker account is not a person.'"), 'the download function still refuses a worker');
  assert.ok(dl.includes("coalesce((select s.local_compute from public.account_settings s where s.owner_id = p_owner), false) or exists (select 1 from public.app_admins a where a.user_id = p_owner)"), 'and still allows a tester or an administrator: the two rules are the same');
  const rb = sql('rollbacks/20261123000500_connect_whoami_desktop_app_rollback.sql');
  assert.ok(!/desktop_app/.test(rb) && /select ryagram_private\.gate_apply\(\); commit;$/.test(rb));
});
