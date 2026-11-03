// CLOUD-SITE 11-02 (docs/CLOUD-SITE-MAP-1102.md): must-fail tests for the connector paths the map found thin. They pin what the code ALREADY does
// (no behaviour change): the gate's refusals, the daily limits that had no test, and that nothing of another account's leaks through a tool.
// Against the connector's own code and its in-memory stand-in world (supabase/functions/connect-core/fake.ts). No database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { handleRest } from '../supabase/functions/connect-core/rest.ts';
import { LIMITS } from '../supabase/functions/connect-core/types.ts';
import { build, TEMPLATES } from '../supabase/functions/_shared/templates.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
const B = { tokenHash: 'h-bob', userId: 'u-bob', clientId: 'client-claude' };
const GENERIC = /Ryagram could not do that right now\. Nothing was changed\./;

function world() {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100); w.addUser(B.userId, 'bob@example.test', 7);
  w.invite(A.userId, A.clientId); w.invite(B.userId, B.clientId);
  const env = (p, policy = w.policy()) => ({ data: w.data(p.userId), policy, deps: { compile } });
  const call = (p, name, args, policy) => callTool(name, args, p, env(p, policy));
  return { w, env, call };
}
const goodStory = () => { const t = TEMPLATES[0]; return build(t.id, t.datasets[0], 'Test headline'); };
const settle = async (call, p, jobId) => { for (let i = 0; i < 4; i++) await call(p, 'job_status', { job_id: jobId }); };

// ------------------------------------------------------------------------------------------------ the gate (dispatch.ts)

test('MUST FAIL: arguments that are not a JSON object (an array, a string, a number, true) are refused before any tool runs, and logged as args', async () => {
  const { w, call } = world();
  for (const bad of [[], ['x'], 'project', 42, true]) {
    const before = w.users.get(A.userId).projects.length;
    const r = await call(A, 'create_project', bad);
    assert.equal(r.isError, true, JSON.stringify(bad)); assert.equal(r.code, 'args', JSON.stringify(bad));
    assert.match(r.text, /must be a JSON object/);
    assert.equal(w.users.get(A.userId).projects.length, before, 'nothing was created');
  }
  assert.ok(w.logs.slice(-5).every((l) => l.tool === 'create_project' && l.result === 'refused' && l.code === 'args'));
  // control: null and undefined mean "no arguments" for a tool that takes none
  assert.equal((await call(A, 'whoami_and_credits', null)).isError, undefined);
  assert.equal((await call(A, 'whoami_and_credits', undefined)).isError, undefined);
});

test('MUST FAIL: a database fault while checking the grant or a limit becomes the plain sentence, runs nothing, and leaks nothing of the fault', async () => {
  const { w, call } = world();
  const secret = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2VjcmV0c2VjcmV0 at db.internal:5432';
  const boom = async () => { throw Object.assign(new Error(secret), { code: 'XX000' }); };
  const base = w.policy();
  const g = await call(A, 'create_project', { title: 'Grant down' }, { ...base, grantFor: boom });
  assert.equal(g.isError, true); assert.equal(g.code, 'error'); assert.match(g.text, GENERIC); assert.ok(!g.text.includes('eyJ') && !g.text.includes('5432'));
  const l = await call(A, 'create_project', { title: 'Limit down' }, { ...base, hit: boom });
  assert.equal(l.isError, true); assert.equal(l.code, 'error'); assert.match(l.text, GENERIC); assert.ok(!l.text.includes('eyJ'));
  assert.equal(w.users.get(A.userId).projects.length, 0, 'no tool ran');
  assert.deepEqual(w.logs.slice(-2).map((x) => [x.result, x.code]), [['error', 'grant_lookup'], ['error', 'limit_lookup']]);
});

test('MUST FAIL: a log write that fails never changes the answer (an ok stays ok, a refusal stays a refusal)', async () => {
  const { w, call } = world();
  const policy = { ...w.policy(), log: async () => { throw new Error('log table is gone'); } };
  const ok = await call(A, 'create_project', { title: 'Still made' }, policy);
  assert.equal(ok.isError, undefined); assert.equal(ok.data.created, true);
  const no = await call(A, 'create_project', { title: 'x', owner_id: B.userId }, policy);
  assert.equal(no.isError, true); assert.equal(no.code, 'args');
});

test('MUST FAIL (REST face): a JSON array body is refused by the gate as "not a JSON object", with 200 and isError, and nothing is created', async () => {
  const { w } = world();
  w.issue('tok-alice', A);
  const deps = { verifyToken: w.verifyToken, dataFor: (_t, p) => w.data(p.userId), policy: w.policy(), deps: { compile }, resourceMetadataUrl: 'https://x.test/.well-known/oauth-protected-resource' };
  const post = (body) => handleRest(new Request('https://x.test/functions/v1/connect/v1/tools/create_project', { method: 'POST', headers: { authorization: 'Bearer tok-alice', 'content-type': 'application/json' }, body }), '/v1/tools/create_project', deps, 'https://x.test/functions/v1/connect');
  const r = await post('[{"title":"x"}]');
  assert.equal(r.status, 200); const j = await r.json(); assert.equal(j.isError, true); assert.match(j.text, /must be a JSON object/);
  assert.equal((await post('"just a string"')).status, 200);
  assert.equal(w.users.get(A.userId).projects.length, 0);
});

// ------------------------------------------------------------------------------------------------ limits that had no test

test(`MUST FAIL: create_project allows ${LIMITS.projectsPerDayPerUser} new projects a day through a connection, then refuses in words and creates nothing`, async () => {
  const { w, call } = world();
  for (let i = 0; i < LIMITS.projectsPerDayPerUser; i++) assert.equal((await call(A, 'create_project', { title: `Film ${i}` })).data.created, true, `project ${i}`);
  const r = await call(A, 'create_project', { title: 'One too many' });
  assert.equal(r.isError, true); assert.equal(r.code, 'rate'); assert.match(r.text, new RegExp(`${LIMITS.projectsPerDayPerUser} projects a day`));
  assert.equal(w.users.get(A.userId).projects.length, LIMITS.projectsPerDayPerUser);
  // an existing title is returned, not created, so it is not refused by the limit
  const again = await call(A, 'create_project', { title: 'Film 0' });
  assert.equal(again.isError, undefined); assert.equal(again.data.created, false);
  // the limit is the person's: another account is not affected
  assert.equal((await call(B, 'create_project', { title: 'Bob film' })).data.created, true);
});

test('MUST FAIL: an existing title does not use up the daily allowance', async () => {
  const { w, call } = world();
  await call(A, 'create_project', { title: 'Same' });
  for (let i = 0; i < 30; i++) assert.equal((await call(A, 'create_project', { title: 'Same' })).data.created, false);
  assert.equal(w.counters.get(`${A.userId}|projects`), 1, 'only the one real creation was counted');
});

test('MUST FAIL: a title that is only spaces or control characters is refused, and nothing is created', async () => {
  const { w, call } = world();
  for (const title of ['   ', '\u0000\u0001', '​​']) {
    const r = await call(A, 'create_project', { title });
    assert.equal(r.isError, true, JSON.stringify(title)); assert.equal(r.code, 'args', JSON.stringify(title));
  }
  assert.equal(w.users.get(A.userId).projects.length, 0);
});

test(`MUST FAIL: get_film_link gives ${LIMITS.linksPerDayPerUser} answers a day, then refuses in words and lists no link`, async () => {
  const { call } = world();
  const id = (await call(A, 'create_project', { title: 'Links' })).data.project_id;
  for (let i = 0; i < LIMITS.linksPerDayPerUser; i++) assert.equal((await call(A, 'get_film_link', { project_id: id })).isError, undefined, `link ${i}`);
  const r = await call(A, 'get_film_link', { project_id: id });
  assert.equal(r.isError, true); assert.equal(r.code, 'rate'); assert.match(r.text, /Link limit for today/); assert.equal(r.data, undefined);
});

// ------------------------------------------------------------------------------------------------ nothing of another account

test('MUST FAIL: list_projects and whoami never show another account\'s projects, label or balance', async () => {
  const { call } = world();
  const alices = (await call(A, 'create_project', { title: 'Alice secret film' })).data.project_id;
  const list = await call(B, 'list_projects', {});
  assert.deepEqual(list.data.projects, []); assert.ok(!list.text.includes(alices) && !list.text.includes('Alice secret'));
  const who = await call(B, 'whoami_and_credits', {});
  assert.equal(who.data.account, 'bob@example.test'); assert.equal(who.data.credits_available, 7);
  assert.ok(!who.text.includes('alice'));
});

test('MUST FAIL: get_film_link with my own project but ANOTHER account\'s finished job id lists nothing of theirs', async () => {
  const { call } = world();
  const bobs = (await call(B, 'create_project', { title: 'Bob' })).data.project_id;
  assert.equal((await call(B, 'set_story', { project_id: bobs, story: goodStory() })).isError, undefined);
  const sheet = await call(B, 'make_contact_sheet', { project_id: bobs }); await settle(call, B, sheet.data.job_id);
  assert.equal((await call(B, 'job_status', { job_id: sheet.data.job_id })).data.state, 'complete');
  const mine = (await call(A, 'create_project', { title: 'Mine' })).data.project_id;
  const r = await call(A, 'get_film_link', { project_id: mine, job_id: sheet.data.job_id });
  assert.equal(r.isError, undefined); assert.deepEqual(r.data.links, []); assert.ok(!r.text.includes(sheet.data.job_id));
  // and the job itself is "not found" for Alice
  assert.equal((await call(A, 'job_status', { job_id: sheet.data.job_id })).code, 'not_found');
});

test('MUST FAIL: a cost estimate, a story read and the editor state for another account\'s project say "not found" and carry no data of theirs', async () => {
  const { w, call } = world();
  w.invite(B.userId, B.clientId, ['read', 'write', 'render_free', 'edit']);
  const alices = (await call(A, 'create_project', { title: 'Alice' })).data.project_id;
  await call(A, 'set_story', { project_id: alices, story: goodStory() });
  for (const [tool, args] of [['get_cost_estimate', { project_id: alices, step: 'contact_sheet' }], ['get_story', { project_id: alices }], ['get_edit_state', { project_id: alices }],
      ['set_look', { project_id: alices, base_revision: 0, set: [{ key: 'theme', value: 'dark' }] }], ['undo_my_changes', { project_id: alices, mode: 'data' }]]) {
    const r = await call(B, tool, args);
    if (tool === 'undo_my_changes' || tool === 'set_look') { assert.equal(r.isError, true, tool); assert.ok(['not_found', 'args'].includes(r.code), `${tool}: ${r.code}`); }
    else { assert.equal(r.code, 'not_found', tool); }
    assert.ok(!r.text.includes('Test headline') && !JSON.stringify(r.data ?? {}).includes('Test headline'), `${tool} leaks no story text`);
  }
});
