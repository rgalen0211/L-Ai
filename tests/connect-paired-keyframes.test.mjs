// A story the connector accepts must be one the engine accepts (WALK A, CC1 18:19). The engine refuses a PAIRED or PANEL clip whose settings do not carry keyframes_per_year
// (Ryan's ruling 2026-09-28: it is measured per story, minutes of drawing, never defaulted: ryagram/sequence/compose.py). The connector's own 'paired' starter (build() in
// _shared/templates.ts) used to pass set_story and then fail in the engine, over and over (engine_error, retried every ten minutes). Now set_story says it once, in words.
// Offline against the in-memory stand-in; invented account and story.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { checkStoryStructured, checkStory } from '../supabase/functions/connect-core/story_check.ts';
import { TEMPLATES, build } from '../supabase/functions/_shared/templates.ts';
import storySchema from '../supabase/functions/_shared/story_schema.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
function world() {
  const w = new FakeWorld(); w.addUser(A.userId, 'alice@example.test', 100); w.invite(A.userId, A.clientId);
  const call = (name, args) => callTool(name, args, A, { data: w.data(A.userId), policy: w.policy(), deps: { compile } });
  return { call };
}
const check = (story) => checkStoryStructured(story, compile(storySchema));
const clipsOf = (s) => s.sequence.clips;
const withView = (view, settings) => { const s = build('map', 'state_obesity_fastfood', 'Invented headline'); const r = clipsOf(s).find((c) => c.kind === 'render'); r.view = view; if (settings) r.settings = settings; else delete r.settings; return s; };

test('the connector\'s own paired starter is refused by set_story in words, once, and nothing is saved', async () => {
  const { call } = world();
  const id = (await call('create_project', { title: 'Invented paired film' })).data.project_id;
  const story = build('paired', 'state_obesity_fastfood', 'Invented headline');
  const r = await call('set_story', { project_id: id, story });
  assert.equal(r.refused, true, r.text); assert.equal(r.code, 'checks_failed'); assert.equal(r.data.saved, false);
  assert.match(r.text, /Clip 2 is a paired view/); assert.match(r.text, /keyframes_per_year/);
  assert.match(r.data.errors[0].message, /map, bars or line/);                // what to do instead, in the sentence itself (the fix field says it again)
  assert.equal(r.data.errors.length, 1, 'said once');
  assert.equal(r.data.errors[0].path, '/sequence/clips/1/settings/keyframes_per_year');
});

test('a panel view without keyframes_per_year is refused the same way', () => {
  const r = check(withView('panel', { top_n: 10 }));
  assert.equal(r.ok, false); assert.match(r.plain.join(' '), /Clip 2 is a panel view/);
});

test('a paired or panel view WITH a measured keyframes_per_year is accepted (the person measured it; the connector never invents one)', () => {
  for (const view of ['paired', 'panel']) {
    const r = check(withView(view, { keyframes_per_year: 6 }));
    assert.equal(r.ok, true, view + ': ' + r.plain.join(' | '));
  }
  assert.equal(check(withView('paired', { keyframes_per_year: 1 })).ok, false, 'the schema still holds it to 2..24');
});

test('map, bars and line views are untouched', () => {
  for (const view of ['map', 'bars', 'line']) assert.equal(check(withView(view)).ok, true, view);
});

test('EVERY starter the connector can build is either accepted or refused in words for this reason (never accepted and then refused by the engine)', () => {
  let paired = 0;
  for (const t of TEMPLATES) for (const d of t.datasets) {
    const s = build(t.id, d, 'Invented headline');
    const r = check(s);
    if (t.view === 'paired' || t.view === 'panel') { paired++; assert.equal(r.ok, false, `${t.id}/${d} is a ${t.view} starter with no keyframes_per_year`); assert.match(r.plain.join(' '), /keyframes_per_year/); }
    else assert.equal(r.ok, true, `${t.id}/${d}: ${r.plain.join(' | ')}`);
  }
  assert.ok(paired >= 1, 'the paired starter is in the list this test walks');
});

test('the plain-sentence check (checkStory) says the same, so every caller agrees', () => {
  assert.match(checkStory(build('paired', 'state_obesity_fastfood', 'x'), compile(storySchema)).join(' '), /keyframes_per_year/);
});

test('the AI is told the rule before it writes the story (get_story_schema)', async () => {
  const { call } = world();
  const r = await call('get_story_schema', {});
  assert.match(r.text, /paired or panel view needs "keyframes_per_year"/);
  assert.match(r.text, /cannot be measured here/);
});
