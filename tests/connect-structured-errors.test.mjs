// Structured refusals (NEXT-CONNECT 157, PUNCH P2 + P4): a story that fails its checks, and a full render a connection cannot start, come back as a RESULT the AI can act on (ok false, field paths, codes, suggested fixes),
// not as a tool error; and the follow-on schema noise (a bad title card also failing the data-view branch: "missing dataset", "missing view", "kind must be render") is counted but never listed.
// tests/connect_structured_mutants.mjs proves each must-fail by breaking the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { checkStoryStructured } from '../supabase/functions/connect-core/story_check.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { build, TEMPLATES } from '../supabase/functions/_shared/templates.ts';
import storySchema from '../supabase/functions/_shared/story_schema.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };

function world() {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100); w.invite(A.userId, A.clientId);
  const env = () => ({ data: w.data(A.userId), policy: w.policy(), deps: { compile } });
  const call = (name, args) => callTool(name, args, A, env());
  return { w, call };
}
const goodStory = () => { const t = TEMPLATES[0]; return build(t.id, t.datasets[0], 'Test headline'); };
const check = (story) => checkStoryStructured(story, compile(storySchema));
const clipIndex = (story, kind) => story.sequence.clips.findIndex((c) => c.kind === kind);

test('a good story has no problems', () => {
  const r = check(goodStory());
  assert.equal(r.ok, true); assert.deepEqual(r.errors, []); assert.equal(r.suppressed, 0);
});

test('a title card with a too-long headline: ONE primary problem with its path, a code and a fix, and none of the data-view noise', () => {
  const s = goodStory(); const i = clipIndex(s, 'title');
  s.sequence.clips[i].headline = 'x'.repeat(200);
  const r = check(s);
  assert.equal(r.ok, false);
  const text = JSON.stringify(r.errors);
  assert.doesNotMatch(text, /dataset|"view"|must be render|exactly one/i);                              // the other branch's complaints are follow-on noise
  assert.ok(r.suppressed > 0, 'the follow-on messages are counted');
  const e = r.errors.find((x) => x.path === `/sequence/clips/${i}/headline`);
  assert.ok(e, text);
  assert.equal(e.code, 'length'); assert.match(e.fix, /160/); assert.equal(e.where, `clip ${i + 1}, headline`);
  assert.equal(r.errors.filter((x) => x.path === `/sequence/clips/${i}/headline`).length, 1, 'said once, not once by the schema and once by the title rules');
  for (const x of r.errors) assert.deepEqual(Object.keys(x).sort(), ['code', 'fix', 'message', 'path', 'where']);
});

test('MUST-FAIL: a title card with neither headline nor subhead says it ONCE (not two "missing" lines and an anyOf)', () => {
  const s = goodStory(); const i = clipIndex(s, 'title');
  delete s.sequence.clips[i].headline; delete s.sequence.clips[i].subhead;
  const r = check(s);
  const about = r.errors.filter((e) => /headline or a subhead/.test(e.message));
  assert.equal(about.length, 1, JSON.stringify(r.errors));
  assert.equal(about[0].code === 'missing_field' || about[0].code === 'rule', true);
  assert.doesNotMatch(JSON.stringify(r.errors), /dataset|"view"/);
});

test('a data view with an unknown field: only the data-view rules speak, not the title card\'s', () => {
  const s = goodStory(); const i = clipIndex(s, 'render');
  s.sequence.clips[i].bogus = 1;
  const r = check(s);
  const e = r.errors.find((x) => x.code === 'unknown_field');
  assert.ok(e, JSON.stringify(r.errors)); assert.equal(e.path, `/sequence/clips/${i}`); assert.match(e.fix, /Remove "bogus"/);
  assert.doesNotMatch(JSON.stringify(r.errors), /headline|seconds|must be title/i);
  assert.ok(r.suppressed > 0, 'the title card complaints about this data view are counted, not listed');
});

test('a clip with no usable kind gets ONE problem about kind, not both branches\' complaints', () => {
  const s = goodStory(); s.sequence.clips[0].kind = 'banner';
  const r = check(s);
  const mine = r.errors.filter((e) => e.path.startsWith('/sequence/clips/0'));
  assert.equal(mine.length, 1, JSON.stringify(mine));
  assert.equal(mine[0].path, '/sequence/clips/0/kind'); assert.equal(mine[0].code, 'not_allowed_value'); assert.match(mine[0].fix, /title, render/);
});

test('the story as a whole is listed before its clips', () => {
  const s = goodStory(); delete s.name;
  const i = clipIndex(s, 'title'); s.sequence.clips[i].headline = 'y'.repeat(300);
  const r = check(s);
  assert.ok(r.errors.length >= 2, JSON.stringify(r.errors));
  assert.equal(r.errors[0].path.startsWith('/sequence/clips'), false);
  assert.equal(r.errors[r.errors.length - 1].path.startsWith('/sequence/clips'), true);
});

test('rules that are not in the schema (a repeated id, an unknown dataset) are problems too, with the clip\'s path', () => {
  const s = goodStory(); s.sequence.clips.push({ ...s.sequence.clips[0] });
  const r = check(s);
  const e = r.errors.find((x) => x.code === 'rule' && /share the id/.test(x.message));
  assert.ok(e, JSON.stringify(r.errors)); assert.match(e.path, /^\/sequence\/clips\/\d+$/);
});

test('set_story: a failed story is a RESULT (ok false, saved false) with the structured errors AND the old plain list; nothing is saved; the log counts it as refused', async () => {
  const { call, w } = world();
  const id = (await call('create_project', { title: 'Film' })).data.project_id;
  const s = goodStory(); const i = clipIndex(s, 'title'); s.sequence.clips[i].headline = 'z'.repeat(250);
  const r = await call('set_story', { project_id: id, story: s });
  assert.ok(!r.isError, 'a result, not a tool error');
  assert.equal(r.data.ok, false); assert.equal(r.data.saved, false); assert.equal(r.code, 'checks_failed');
  assert.ok(Array.isArray(r.data.errors) && r.data.errors.length >= 1 && r.data.error_count === r.data.errors.length);
  assert.ok(Array.isArray(r.data.failed_checks) && r.data.failed_checks.every((m) => typeof m === 'string'));
  assert.ok(r.data.suppressed > 0);
  assert.match(r.text, /^The story was NOT saved\./); assert.match(r.text, /left out because they only repeat these/); assert.match(r.text, /Fix: /);
  assert.deepEqual(w.users.get(A.userId).versions[0].story_spec, {});
  const log = w.logs[w.logs.length - 1];
  assert.equal(log.result, 'refused'); assert.equal(log.code, 'checks_failed'); assert.ok(log.failedChecks >= 1);
});

test('request_full_render: refused as a RESULT that says what is not allowed, why, and what to do instead', async () => {
  const { call } = world();
  const r = await call('request_full_render', { project_id: '00000000-0000-4000-8000-000000000001' });
  assert.ok(!r.isError);
  assert.deepEqual({ ok: r.data.ok, allowed: r.data.allowed, started: r.data.started, credits_used: r.data.credits_used, code: r.data.code }, { ok: false, allowed: false, started: false, credits_used: 0, code: 'not_available' });
  assert.match(r.data.reason, /cannot be started from an AI connection/); assert.match(r.data.what_to_do, /Render final film/);
});

test('a good story still saves, as a normal result', async () => {
  const { call } = world();
  const id = (await call('create_project', { title: 'Film' })).data.project_id;
  const r = await call('set_story', { project_id: id, story: goodStory() });
  assert.ok(!r.isError); assert.ok(!r.refused); assert.notEqual(r.data?.ok, false);
});
