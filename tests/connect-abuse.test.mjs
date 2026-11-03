// CLOUD-SITE 11-02 round 3 (task 4): the connector under abuse: bursts of calls at the same instant, two accounts hammering at once, oversized stories measured in BYTES, and a
// story whose previews keep failing. Every refusal must be plain words: it says what was not done and what to do, with no code, no stack, no JSON and no internal name.
// Against the connector's own code and its in-memory stand-in (the SQL half of the same story is supabase/tests/test_connect_abuse.py, on a local Postgres).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { LIMITS } from '../supabase/functions/connect-core/types.ts';
import { build, TEMPLATES } from '../supabase/functions/_shared/templates.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
const A2 = { tokenHash: 'h-alice-2', userId: 'u-alice', clientId: 'client-chatgpt' };
const B = { tokenHash: 'h-bob', userId: 'u-bob', clientId: 'client-claude' };
function world() {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100); w.addUser(B.userId, 'bob@example.test', 100);
  w.invite(A.userId, A.clientId); w.invite(A.userId, A2.clientId); w.invite(B.userId, B.clientId);
  const env = (p) => ({ data: w.data(p.userId), policy: w.policy(), deps: { compile } });
  return { w, call: (p, name, args = {}) => callTool(name, args, p, env(p)) };
}
const story = (headline = 'Abuse check') => { const t = TEMPLATES[0]; return build(t.id, t.datasets[0], headline); };

/** Plain words: a sentence a person can act on. No error code, no stack, no JSON, no SQL, no internal names, not too long, and it says what to do or what was (not) done. */
function assertPlain(text, where) {
  assert.equal(typeof text, 'string', where);
  assert.ok(text.length > 20 && text.length < 700, `${where}: length ${text.length}`);
  assert.doesNotMatch(text, /\b(PT\d{3}|P0002|42501|22023|SQLSTATE|undefined|null|NaN|\[object|TypeError|Error:|stack|at \w+ \(|connect_[a-z_]+\(|policy\.|ctx\.|\{"|":)/, where);
  assert.match(text, /\.\s*$|\)\s*$/, `${where}: ends as a sentence`);
  assert.match(text, /wait|try|tomorrow|change|tell|start|ask|nothing|not|no |must|limit|cannot/i, `${where}: says what happened or what to do`);
}

test('BURST: 100 calls from one connection at the same instant: exactly 60 run, 40 are refused in plain words with how long to wait', async () => {
  const { call } = world();
  const rs = await Promise.all(Array.from({ length: 100 }, () => call(A, 'whoami_and_credits')));
  const ok = rs.filter((r) => !r.isError), no = rs.filter((r) => r.isError);
  assert.equal(ok.length, LIMITS.callsPerMinutePerClient); assert.equal(no.length, 100 - LIMITS.callsPerMinutePerClient);
  for (const r of no) {
    assert.equal(r.code, 'rate'); assertPlain(r.text, 'burst refusal');
    assert.deepEqual({ limit: r.data.limit, retry: r.data.retry_after_seconds, started: r.data.started }, { limit: 'connection_calls', retry: 60, started: false });
  }
});

test('BURST: a burst of project creations at the same instant stops at the day\'s limit; nothing beyond it is created', async () => {
  const { w, call } = world();
  const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => call(A, 'create_project', { title: `Burst ${i}` })));
  assert.equal(rs.filter((r) => r.data?.created === true).length, LIMITS.projectsPerDayPerUser);
  assert.equal(w.users.get(A.userId).projects.length, LIMITS.projectsPerDayPerUser);
  for (const r of rs.filter((x) => x.isError)) { assert.equal(r.code, 'rate'); assertPlain(r.text, 'project limit'); }
});

test('TWO ACCOUNTS AT ONCE: Alice and Bob each send 70 calls interleaved at the same instant: each gets exactly 60, and no refusal names the other', async () => {
  const { call } = world();
  const jobs = [];
  for (let i = 0; i < 70; i++) { jobs.push(call(A, 'list_projects').then((r) => ['A', r])); jobs.push(call(B, 'list_projects').then((r) => ['B', r])); }
  const rs = await Promise.all(jobs);
  for (const who of ['A', 'B']) {
    const mine = rs.filter(([w]) => w === who).map(([, r]) => r);
    assert.equal(mine.filter((r) => !r.isError).length, LIMITS.callsPerMinutePerClient, who);
    for (const r of mine.filter((x) => x.isError)) { assert.doesNotMatch(r.text, /alice|bob/i); assertPlain(r.text, `${who} refusal`); }
  }
});

test('TWO ACCOUNTS AT ONCE: Alice using up her hourly sheets, her links and her projects leaves Bob\'s untouched; her two AIs share her account limit', async () => {
  const { w, call } = world();
  // Alice's day of projects and links, and her hour of sheets, all spent (counters set directly: the fake does not model time windows)
  w.counters.set(`${A.userId}|projects`, LIMITS.projectsPerDayPerUser); w.counters.set(`${A.userId}|links`, LIMITS.linksPerDayPerUser); w.counters.set(`${A.userId}|ladder`, LIMITS.ladderPerHourPerUser);
  const a = (await call(A, 'create_project', { title: 'one more' }));
  assert.equal(a.code, 'rate'); assertPlain(a.text, 'alice projects');
  const bid = (await call(B, 'create_project', { title: 'Bob film' })).data.project_id;
  assert.ok(bid, 'Bob still creates');
  assert.equal((await call(B, 'set_story', { project_id: bid, story: story() })).isError, undefined);
  assert.equal((await call(B, 'make_contact_sheet', { project_id: bid })).data.started, true, 'Bob still starts a sheet');
  assert.equal((await call(B, 'get_film_link', { project_id: bid })).isError, undefined, 'Bob still gets links');
  // the account limit counts every AI of the account together: Alice's second AI is stopped at the account's 120, Bob is not
  w.counters.set(`${A.userId}|calls_acct`, LIMITS.callsPerMinutePerAccount);
  const a2 = await call(A2, 'whoami_and_credits');
  assert.equal(a2.code, 'rate'); assert.equal(a2.data.limit, 'account_calls'); assertPlain(a2.text, 'account limit');
  assert.equal((await call(B, 'whoami_and_credits')).isError, undefined);
});

test('OVERSIZED: a story is measured in BYTES: under the limit in characters but over it in UTF-8 is refused with its size, and nothing is saved', async () => {
  const { w, call } = world();
  const id = (await call(A, 'create_project', { title: 'Big' })).data.project_id;
  const big = story(); big.sequence.clips[0].subhead = '\u{1F600}'.repeat(80 * 1024);           // 160K UTF-16 units, 320 KB of UTF-8
  assert.ok(JSON.stringify(big).length < LIMITS.maxStoryBytes, 'under the limit counted in characters');
  const r = await call(A, 'set_story', { project_id: id, story: big });
  assert.equal(r.refused, true); assert.equal(r.data.saved, false); assert.match(r.text, /limit is 256 KB/); assert.match(r.text, /\b3\d\d KB\b/);
  assert.deepEqual(w.users.get(A.userId).versions.find((v) => v.project_id === id).story_spec, {}, 'nothing saved');
  const r2 = await call(A, 'set_story', { project_id: id, story: { ...story(), pad: 'x'.repeat(LIMITS.maxStoryBytes) } });
  assert.equal(r2.refused, true); assert.match(r2.text, /limit is 256 KB/, 'the size is checked before anything else');
});

test('REPEATED FAILED PREVIEWS: after 3 failures of one story the next is refused in plain words before anything is priced; another account and a changed story start fresh', async () => {
  const { w, call } = world();
  const setup = async (p, headline) => {
    const id = (await call(p, 'create_project', { title: `Film ${headline}` })).data.project_id;
    await call(p, 'set_story', { project_id: id, story: story(headline) });
    const s = await call(p, 'make_contact_sheet', { project_id: id }); for (let i = 0; i < 4; i++) await call(p, 'job_status', { job_id: s.data.job_id });
    return id;
  };
  const id = await setup(A, 'Fails a lot');
  for (let i = 0; i < LIMITS.failedJobsPerStory; i++) {
    const pv = await call(A, 'make_preview', { project_id: id });
    assert.equal(pv.data.started, true, `preview ${i + 1}`);
    w.users.get(A.userId).jobs.find((j) => j.id === pv.data.job_id).state = 'failed';
  }
  let priced = 0; const realQuote = w.data(A.userId).quote;
  const r = await callTool('make_preview', { project_id: id }, A, { data: { ...w.data(A.userId), quote: async (...a) => { priced++; return realQuote(...a); } }, policy: w.policy(), deps: { compile } });
  assert.equal(r.code, 'repeated_failures'); assert.equal(priced, 0, 'refused before anything is priced'); assert.equal(r.data.started, false); assertPlain(r.text, 'repeated failures');
  // Bob's same-looking story is his own: not counted
  const bid = await setup(B, 'Fails a lot');
  assert.equal((await call(B, 'make_preview', { project_id: bid })).data.started, true);
  // Alice changes one word: the new story starts fresh
  await call(A, 'set_story', { project_id: id, story: story('Fails a lot, fixed') });
  const s2 = await call(A, 'make_contact_sheet', { project_id: id }); for (let i = 0; i < 4; i++) await call(A, 'job_status', { job_id: s2.data.job_id });
  // ... it is no longer refused as a repeat; here the project's 3 free previews were used by the failures, so it is refused because it would cost credits, in plain words
  const again = await call(A, 'make_preview', { project_id: id });
  assert.notEqual(again.code, 'repeated_failures');
  assert.equal(again.code, 'costs_credits'); assertPlain(again.text, 'costs credits'); assert.equal(again.data.started, false);
});

test('PLAIN WORDS everywhere: every refusal an abusive client can trigger reads as a sentence', async () => {
  const { w, call } = world();
  const texts = [];
  const push = async (p, name, args) => { const r = await call(p, name, args); if (r.isError || r.refused) texts.push([name, r.text]); };
  await push(A, 'no_such_tool', {});
  await push(A, 'create_project', []);
  await push(A, 'create_project', { title: 'x', owner_id: 'u-bob' });
  await push(A, 'make_preview', { project_id: '00000000-0000-4000-8000-000000000999', start_seconds: 0, end_seconds: 30 });
  await push(A, 'set_story', { project_id: '00000000-0000-4000-8000-000000000999', story: story() });
  await push(A, 'request_full_render', { project_id: '00000000-0000-4000-8000-000000000999', confirm: true });
  await push(A, 'set_compilation_request', { project_id: '00000000-0000-4000-8000-000000000999', phrase: 'C:\\Users\\me', folders: ['x'] });
  w.revoke(A.userId, A.clientId); await push(A, 'whoami_and_credits', {});
  assert.ok(texts.length >= 7, texts.map((t) => t[0]).join(','));
  for (const [name, t] of texts) assertPlain(t.replace(/^The call was not understood: .*/, 'The call was not understood, so nothing was done. Change the arguments.'), name);
});
