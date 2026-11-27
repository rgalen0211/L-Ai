// What a connected AI is told about credits when the free previews are used up (CONNECT 2026-11-23, GAMES 10:37 HIGH 2 on the Connect-an-AI-for-everyone path).
// Customer step: a stranger who connects Claude or ChatGPT with 0 credits and buying closed is never told "start it in the Ryagram app" for a preview the app cannot start either; they are told the free previews are used up
// and that, without credits, nothing more can be started right now. A person WITH enough credits is still sent to the app. Runs the real tools against the in-memory world; talks to nothing. Must-fails: tests/connect_credit_words_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { build, TEMPLATES } from '../supabase/functions/_shared/templates.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };

function world(credits) {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', credits);
  w.invite(A.userId, A.clientId);
  const env = (p) => ({ data: w.data(p.userId), policy: w.policy(), deps: { compile } });
  const call = (p, name, args) => callTool(name, args, p, env(p));
  return { w, call };
}
const goodStory = () => { const t = TEMPLATES[0]; return build(t.id, t.datasets[0], 'Test headline'); };
async function readyToPreview(credits) {
  const { w, call } = world(credits);
  const id = (await call(A, 'create_project', { title: 'Film' })).data.project_id;
  assert.equal((await call(A, 'set_story', { project_id: id, story: goodStory() })).isError, undefined);
  const s = await call(A, 'make_contact_sheet', { project_id: id });
  for (let i = 0; i < 4; i++) await call(A, 'job_status', { job_id: s.data.job_id });
  w.users.get(A.userId).previewsUsed.set(w.users.get(A.userId).projects[0].id, 3);       // the free previews are used up: the next one would cost 5
  return { w, call, id };
}
const SEND_TO_APP = /start it in the Ryagram app|person starts it in the Ryagram app/i;

test('with no credits a refused preview says so and does NOT send the person to the app for it', async () => {
  const { call, id } = await readyToPreview(0);
  const r = await call(A, 'make_preview', { project_id: id });
  assert.equal(r.code, 'costs_credits');
  assert.match(r.text, /each project gets 6 free previews, and each person gets 15 free previews in any 24 hours/);
  assert.match(r.text, /NOTHING was started/);
  assert.match(r.text, /0 credits, which is not enough, so nothing more can be made right now/);
  assert.match(r.text, /do not send them to the Ryagram app for it/);
  assert.doesNotMatch(r.text, SEND_TO_APP);
});

test('with enough credits a refused preview still sends the person to the app', async () => {
  const { call, id } = await readyToPreview(100);
  const r = await call(A, 'make_preview', { project_id: id });
  assert.equal(r.code, 'costs_credits');
  assert.match(r.text, /has 100 credits, so they can start it themselves: they press the button in the Ryagram app/);
  assert.match(r.text, /An AI cannot spend credits/);
});

test('the cost estimate says nothing more can start when the person cannot pay, and sends them to the app when they can', async () => {
  const poor = await readyToPreview(0);
  const e0 = await poor.call(A, 'get_cost_estimate', { project_id: poor.id, step: 'preview' });
  assert.match(e0.text, /does not have enough, so nothing more can be started right now/);
  assert.doesNotMatch(e0.text, SEND_TO_APP);
  const rich = await readyToPreview(100);
  const e1 = await rich.call(A, 'get_cost_estimate', { project_id: rich.id, step: 'preview' });
  assert.match(e1.text, /the person starts it in the Ryagram app/);
});

test('whoami tells the real free-preview rule and does not promise that previews are always free or send a person with no credits to the app', async () => {
  const { call } = world(0);
  const r = await call(A, 'whoami_and_credits', {});
  assert.match(r.text, /A contact sheet is free\. A preview is free for the first 6 of a project \(15 in any 24 hours\), then it costs 1 credit/);
  assert.match(r.text, /if they have none, nothing more can be started right now, so do not send them there for it/);
  assert.doesNotMatch(r.text, /Contact sheets and previews started from a connection are free/);
});
