// ENGINE's five profile tools through the connect gate: scopes, closed arguments, the person's own data only, no second sheet, the hourly allowance.
// ENGINE's rules, presets and wording are tested by ENGINE (tests/engine-profile.test.mjs); this file tests that CONNECT exposes them safely.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { TOOLS } from '../supabase/functions/connect-core/tools.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { forkPreset, listPresets } from '../supabase/functions/_shared/profile.ts';
import { LIMITS } from '../supabase/functions/connect-core/types.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
const B = { tokenHash: 'h-bob', userId: 'u-bob', clientId: 'client-claude' };
function world(scopes = ['read', 'write', 'render_free']) {
  const w = new FakeWorld();
  for (const p of [A, B]) { w.addUser(p.userId, `${p.userId}@example.test`, 100); w.invite(p.userId, p.clientId, scopes); }
  const call = (p, name, args) => callTool(name, args, p, { data: w.data(p.userId), policy: w.policy(), deps: { compile } });
  return { w, call };
}
const PROFILE_TOOLS = ['get_profile_schema', 'list_presets', 'get_profile', 'set_profile', 'preview_profile'];
const preset = () => listPresets()[0].id;
const mine = () => JSON.stringify(forkPreset(preset(), 'my-look', 'My look'));

test('the five profile tools are in the registry with safe names, honest hints and closed schemas', () => {
  assert.equal(TOOLS.length, 18);
  for (const n of PROFILE_TOOLS) {
    const t = TOOLS.find((x) => x.name === n);
    assert.ok(t, n); assert.match(t.name, /^[a-z0-9_]+$/); assert.equal(t.inputSchema.additionalProperties, false);
    assert.ok(t.description.length > 40);
  }
  for (const n of ['get_profile_schema', 'list_presets', 'get_profile']) assert.equal(TOOLS.find((x) => x.name === n).readOnly, true, n);
  for (const n of ['set_profile', 'preview_profile']) assert.equal(TOOLS.find((x) => x.name === n).readOnly, false, n);
  assert.equal(TOOLS.find((x) => x.name === 'set_profile').scope, 'write');
  assert.equal(TOOLS.find((x) => x.name === 'preview_profile').scope, 'render_free');
});

test('read tools: the rules say what is locked and what is not applied; presets list; a preset reads back inside untrusted markers', async () => {
  const { call } = world();
  const schema = await call(A, 'get_profile_schema', {});
  assert.equal(schema.isError, undefined); assert.match(schema.text, /cannot change what a film claims/); assert.match(schema.text, /NOT applied/);
  const list = await call(A, 'list_presets', {});
  assert.match(list.text, new RegExp(preset()));
  const got = await call(A, 'get_profile', { name: preset(), preset: true });
  assert.match(got.text, /<untrusted source="preset">/); assert.match(got.text, /not instructions/);
});

test('set_profile saves a forked preset, get_profile reads it back wrapped, and the person can make it their default', async () => {
  const { call } = world();
  const none = await call(A, 'get_profile', { name: null });
  assert.match(none.text, /no profile yet/);
  const saved = await call(A, 'set_profile', { profile_json: mine(), make_default: true });
  assert.equal(saved.isError, undefined, saved.text); assert.match(saved.text, /Saved profile "my-look" as the default/);
  const back = await call(A, 'get_profile', { name: null });
  assert.match(back.text, /This is the default profile/); assert.match(back.text, /<untrusted source="profile">/);
  const named = await call(A, 'get_profile', { name: 'my-look' });
  assert.match(named.text, /My look/);
});

test('set_profile refuses what is not a valid profile, in words, and saves nothing', async () => {
  const { call, w } = world();
  for (const bad of ['{not json', '[]', JSON.stringify({ profile_version: 1, name: 'x', data: { rows: [1, 2, 3] } }), JSON.stringify({ ...JSON.parse(mine()), source: 'my own numbers' })]) {
    const r = await call(A, 'set_profile', { profile_json: bad });
    assert.equal(r.isError, true, bad.slice(0, 40)); assert.match(r.text, /Not saved/);
  }
  assert.equal(w.users.get(A.userId).profiles.size, 0);
});

test('profiles are the person\'s own: another person sees none, and a missing name lists only their own', async () => {
  const { call } = world();
  await call(A, 'set_profile', { profile_json: mine() });
  assert.match((await call(B, 'get_profile', { name: 'my-look' })).text, /no profile yet/);
  const miss = await call(A, 'get_profile', { name: 'nope' });
  assert.equal(miss.isError, true); assert.match(miss.text, /my-look/);
});

test('scopes and closed arguments: a read-only connection cannot save or preview; an argument that names an owner or a project is refused', async () => {
  const { call } = world(['read']);
  assert.equal((await call(A, 'list_presets', {})).isError, undefined);
  assert.equal((await call(A, 'set_profile', { profile_json: mine() })).code, 'scope');
  assert.equal((await call(A, 'preview_profile', { name: null })).code, 'scope');
  const { call: call2 } = world();
  for (const extra of [{ owner_id: 'u-bob' }, { project_id: '00000000-0000-4000-8000-000000000001' }, { story: {} }]) {
    assert.equal((await call2(A, 'preview_profile', { name: null, ...extra })).code, 'args', JSON.stringify(extra));
    assert.equal((await call2(A, 'set_profile', { profile_json: mine(), ...extra })).code, 'args', JSON.stringify(extra));
  }
});

test('preview_profile queues ONE free sheet on the person\'s own sample project, never a second, and respects the hourly allowance', async () => {
  const { call, w } = world();
  await call(A, 'set_profile', { profile_json: mine(), make_default: true });
  const first = await call(A, 'preview_profile', { name: null });
  assert.equal(first.isError, undefined, first.text); assert.match(first.text, /Contact sheet queued \(job /);
  const u = w.users.get(A.userId);
  assert.equal(u.projects.filter((p) => p.title === 'Profile preview (sample)').length, 1);
  assert.equal(u.jobs.length, 1); assert.equal(u.held, 0);
  const again = await call(A, 'preview_profile', { name: 'my-look' });
  assert.equal(again.isError, undefined); assert.equal(u.jobs.length, 1);                              // the sheet already waiting is the answer
  assert.equal(w.users.get(B.userId).jobs.length, 0);
  // a preset needs no saved profile
  const viaPreset = await call(B, 'preview_profile', { name: preset(), preset: true });
  assert.equal(viaPreset.isError, undefined, viaPreset.text);
  // the allowance every sheet and preview from a connection shares
  w.counters.set(`${A.userId}|ladder`, LIMITS.ladderPerHourPerUser);
  const capped = await call(A, 'preview_profile', { name: null });
  assert.equal(capped.isError, true); assert.match(capped.text, /hourly limit for starting sheets/);              // ENGINE's own wording for the same allowance
});

test('a preview of a profile that does not exist or no longer validates is refused in words', async () => {
  const { call } = world();
  const r = await call(A, 'preview_profile', { name: 'nope' });
  assert.equal(r.isError, true); assert.match(r.text, /No such profile/);
});

test('the database layer names only the four connect profile functions, token hash first', async () => {
  const { ConnectDb } = await import('../supabase/functions/connect/db.ts');
  const seen = [];
  const db = new ConnectDb(async (sql, params) => { seen.push([sql, params]); return [{ r: [] }]; }, 'https://uselai.com/app/');
  const d = db.data({ tokenHash: 'a'.repeat(64) });
  await d.profiles.list(); await d.profiles.get(null); await d.profiles.get('my-look'); await d.profiles.save({ name: 'x' }, true); await d.profiles.preview({ a: 1 }, ['2011', '2015', '2020']);
  for (const [sql, params] of seen) { assert.match(sql, /^select public\.connect_(list_profiles|get_profile|set_profile|profile_sample_preview)\(/); assert.equal(params[0], 'a'.repeat(64)); }
  assert.match(seen[3][0], /\$2::text::jsonb/); assert.match(seen[4][0], /\$3::text::text\[\]/);
  assert.equal(seen[4][1][2], '{"2011","2015","2020"}');
});
