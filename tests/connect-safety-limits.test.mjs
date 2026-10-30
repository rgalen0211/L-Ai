// Connector safety limits (NEXT-CONNECT 169): too many calls (one connection, then one whole account), an oversized story, and a story that keeps failing. Every refusal is in words, says what was
// not done, and where it can, carries the numbers as data. Against the in-memory stand-in for the database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { LIMITS } from '../supabase/functions/connect-core/types.ts';
import { build, TEMPLATES } from '../supabase/functions/_shared/templates.ts';

const compile = makeCompile(Ajv2020);
const P = (client) => ({ tokenHash: 'h-' + client, userId: 'u-alice', clientId: client });
const A = P('client-claude');
function world(clients = ['client-claude']) {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100);
  for (const c of clients) w.invite(A.userId, c);
  const env = (p) => ({ data: w.data(p.userId), policy: w.policy(), deps: { compile } });
  return { w, call: (p, name, args = {}) => callTool(name, args, p, env(p)) };
}
const story = (headline = 'Limits check') => { const t = TEMPLATES[0]; return build(t.id, t.datasets[0], headline); };
const saved = async (call, headline) => {
  const id = (await call(A, 'create_project', { title: 'Film' })).data.project_id;
  const r = await call(A, 'set_story', { project_id: id, story: story(headline) });
  assert.equal(r.isError, undefined, r.text);
  return id;
};
const settle = async (call, jobId) => { for (let i = 0; i < 4; i++) await call(A, 'job_status', { job_id: jobId }); };
const failJob = (w, jobId, state = 'failed') => { const j = w.users.get(A.userId).jobs.find((x) => x.id === jobId); assert.ok(j, 'job exists'); j.state = state; };

test('the numbers are what the paper says', () => {
  assert.equal(LIMITS.callsPerMinutePerClient, 60); assert.equal(LIMITS.callsPerMinutePerAccount, 120); assert.equal(LIMITS.ladderPerHourPerUser, 30);
  assert.equal(LIMITS.failedJobsPerStory, 3); assert.equal(LIMITS.maxStoryBytes, 256 * 1024);
  assert.ok(LIMITS.callsPerMinutePerAccount > LIMITS.callsPerMinutePerClient, 'one connection must reach its own limit before the account limit');
});

test('one connection: the 61st call in a minute is refused in words, with how long to wait', async () => {
  const { call } = world();
  for (let i = 0; i < LIMITS.callsPerMinutePerClient; i++) assert.equal((await call(A, 'whoami_and_credits')).isError, undefined, 'call ' + (i + 1));
  const r = await call(A, 'whoami_and_credits');
  assert.equal(r.isError, true); assert.equal(r.code, 'rate');
  assert.match(r.text, /from this connection/); assert.match(r.text, /Wait a minute/);
  assert.deepEqual([r.data.limit, r.data.max, r.data.window_seconds, r.data.retry_after_seconds, r.data.started], ['connection_calls', 60, 60, 60, false]);
});

test('a second connection has its own minute: one busy AI does not lock out the others', async () => {
  const { call } = world(['client-claude', 'client-gpt']);
  const B = P('client-gpt');
  for (let i = 0; i < LIMITS.callsPerMinutePerClient; i++) await call(A, 'whoami_and_credits');
  assert.equal((await call(A, 'whoami_and_credits')).code, 'rate');
  assert.equal((await call(B, 'whoami_and_credits')).isError, undefined, 'the other connection is not limited by the first');
});

test('the whole account: three connections together stop at 120 calls a minute, and the refusal says it is the account', async () => {
  const clients = ['client-claude', 'client-gpt', 'client-code'];
  const { call } = world(clients);
  for (const c of clients) for (let i = 0; i < 40; i++) assert.equal((await call(P(c), 'whoami_and_credits')).isError, undefined);
  const r = await call(P('client-claude'), 'whoami_and_credits');
  assert.equal(r.isError, true); assert.equal(r.code, 'rate');
  assert.match(r.text, /on this Ryagram account/); assert.match(r.text, /every connected AI together/);
  assert.deepEqual([r.data.limit, r.data.max, r.data.retry_after_seconds], ['account_calls', 120, 60]);
  assert.equal((await call(P('client-gpt'), 'get_story_schema')).code, 'rate', 'every connection of the account is stopped, not only the last one');
});

test('the hourly job limit says its number and that the person can still start the step in the app', async () => {
  const { call } = world();
  const id = await saved(call);
  for (let i = 0; i < LIMITS.ladderPerHourPerUser; i++) await call(A, 'make_contact_sheet', { project_id: id });
  const r = await call(A, 'make_contact_sheet', { project_id: id });
  assert.equal(r.code, 'rate'); assert.match(r.text, /30 an hour/); assert.match(r.text, /Ryagram app/);
  assert.deepEqual([r.data.limit, r.data.retry_after_seconds], ['hourly_jobs', 3600]);
});

test('an oversized story: refused with its size, the limit, a fix in words, and nothing saved', async () => {
  const { w, call } = world();
  const id = await saved(call, 'First');
  const before = JSON.stringify(w.users.get(A.userId).versions.map((v) => [v.id, v.story_sha256]));
  const big = story('Big'); big.sequence.clips[0].headline = 'x'.repeat(LIMITS.maxStoryBytes);
  const r = await call(A, 'set_story', { project_id: id, story: big });
  assert.equal(r.refused, true); assert.equal(r.code, 'checks_failed'); assert.equal(r.data.saved, false); assert.equal(r.data.errors[0].code, 'story_size');
  assert.match(r.text, /limit is 256 KB/); assert.match(r.text, /Nothing was saved/);
  assert.match(r.data.errors[0].fix, /split the film into two projects/);
  assert.equal(JSON.stringify(w.users.get(A.userId).versions.map((v) => [v.id, v.story_sha256])), before, 'the saved story is unchanged');
});

test('a story that keeps failing: the 4th contact sheet is refused until the story changes', async () => {
  const { w, call } = world();
  const id = await saved(call, 'Same');
  for (let i = 0; i < LIMITS.failedJobsPerStory; i++) {
    const s = await call(A, 'make_contact_sheet', { project_id: id });
    assert.equal(s.data.started, true, `attempt ${i + 1}: ${s.text}`);
    failJob(w, s.data.job_id);
  }
  const r = await call(A, 'make_contact_sheet', { project_id: id });
  assert.equal(r.isError, true); assert.equal(r.code, 'repeated_failures');
  assert.match(r.text, /already failed 3 times/); assert.match(r.text, /NOTHING was started/); assert.match(r.text, /set_story/);
  assert.deepEqual([r.data.started, r.data.failed_attempts, r.data.limit], [false, 3, 3]);
  const changed = await call(A, 'set_story', { project_id: id, story: story('A changed story') });
  assert.equal(changed.isError, undefined, changed.text);
  assert.equal((await call(A, 'make_contact_sheet', { project_id: id })).data.started, true, 'a changed story starts fresh');
});

test('failed previews of one story: the 4th is refused; a finished preview or failed sheets are not counted against it', async () => {
  const { w, call } = world();
  const id = await saved(call, 'Preview story');
  const sheet = await call(A, 'make_contact_sheet', { project_id: id }); await settle(call, sheet.data.job_id);
  const start = async (s, e) => { const p = await call(A, 'make_preview', { project_id: id, start_seconds: s, end_seconds: e }); assert.equal(p.data?.started, true, p.text); return p.data.job_id; };
  failJob(w, await start(0, 3)); failJob(w, await start(3, 6));
  const finished = await start(6, 9); await settle(call, finished);                    // 2 failed + 1 finished: only the 2 count
  const fourth = await call(A, 'make_preview', { project_id: id, start_seconds: 1, end_seconds: 4 });
  assert.notEqual(fourth.code, 'repeated_failures', 'a finished preview is not a failure');
  assert.equal(fourth.code, 'costs_credits', 'the free previews are used up: that is the other rule, and it still applies');
});

test('three failed previews of the same story: the next one is refused, in words, before anything is priced or started', async () => {
  const { w, call } = world();
  const id = await saved(call, 'Failing preview');
  const sheet = await call(A, 'make_contact_sheet', { project_id: id }); await settle(call, sheet.data.job_id);
  for (const [s, e] of [[0, 3], [3, 6], [6, 9]]) { const p = await call(A, 'make_preview', { project_id: id, start_seconds: s, end_seconds: e }); assert.equal(p.data?.started, true, p.text); failJob(w, p.data.job_id); }
  const r = await call(A, 'make_preview', { project_id: id, start_seconds: 1, end_seconds: 4 });
  assert.equal(r.code, 'repeated_failures'); assert.match(r.text, /The preview of this exact story has already failed 3 times/); assert.match(r.text, /NOTHING was started/);
  assert.equal(r.data.started, false);
  const sheetAgain = await call(A, 'make_contact_sheet', { project_id: id });
  assert.notEqual(sheetAgain.code, 'repeated_failures', 'failed previews are a different count from failed sheets');
  const changed = await call(A, 'set_story', { project_id: id, story: story('Changed for the preview') });
  assert.equal(changed.isError, undefined, changed.text);
});

test('cancelled jobs are not failures', async () => {
  const { w, call } = world();
  const id = await saved(call, 'Cancel story');
  for (let i = 0; i < LIMITS.failedJobsPerStory + 1; i++) {
    const s = await call(A, 'make_contact_sheet', { project_id: id });
    assert.equal(s.data.started, true, `attempt ${i + 1}: ${s.text}`);
    failJob(w, s.data.job_id, 'cancelled');
  }
});
