// Waiting without burning the person's AI allowance (NEXT-CONNECT 153, Ryan 22:54 after Maria's test): when a contact sheet or preview is queued and the render machine is offline or busy, the connector
// must tell the person's AI plainly, with fields it can act on, to STOP CHECKING. A scripted AI that polls job_status in a loop must stop after the first answer that says the machine is not responding.
// Against the in-memory stand-in (the SQL half, connect_rendering_state, has its own test in supabase/tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { waitAdvice } from '../supabase/functions/connect-core/tools.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { build, TEMPLATES } from '../supabase/functions/_shared/templates.ts';

const compile = () => () => [];
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };

function world() {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100); w.invite(A.userId, A.clientId);
  const env = (p) => ({ data: w.data(p.userId), policy: w.policy(), deps: { compile } });
  return { w, call: (p, name, args) => callTool(name, args, p, env(p)) };
}
const goodStory = () => { const t = TEMPLATES[0]; return build(t.id, t.datasets[0], 'Test headline'); };
async function queued(call, tool = 'make_contact_sheet', afterSheet = () => {}) {
  const id = (await call(A, 'create_project', { title: 'Film' })).data.project_id;
  await call(A, 'set_story', { project_id: id, story: goodStory() });
  if (tool === 'make_preview') {                       // a preview waits for a FINISHED contact sheet of the same story (PUNCH P3)
    const sheet = await call(A, 'make_contact_sheet', { project_id: id });
    for (let i = 0; i < 4; i++) await call(A, 'job_status', { job_id: sheet.data.job_id });
  }
  afterSheet();
  const started = await call(A, tool, { project_id: id });
  return { id, started };
}
/** An AI that does what a careless one does: ask again and again until it is told to stop, at most 30 times. It obeys do_not_poll only. */
async function pollingAi(call, jobId) {
  let asks = 0, last = null;
  while (asks < 30) {
    last = await call(A, 'job_status', { job_id: jobId });
    asks++;
    if (last.data.state === 'complete' || last.data.state === 'failed') break;
    if (last.data.do_not_poll === true) break;
  }
  return { asks, last };
}

test('THE MACHINE IS OFFLINE: the answer to the start says so, says the job is safe, and says to stop checking; the polling AI asks exactly once', async () => {
  const { w, call } = world();
  w.rendering = 'delayed';
  const { started } = await queued(call);
  assert.match(started.text, /render machine is not responding right now/);
  assert.match(started.text, /will start when the machine is back/);
  assert.match(started.text, /Do not keep checking/);
  assert.equal(started.data.do_not_poll, true); assert.equal(started.data.poll_after_s, null); assert.equal(started.data.rendering, 'delayed');
  const { asks, last } = await pollingAi(call, started.data.job_id);
  assert.equal(asks, 1, 'the scripted AI stops after the first offline answer');
  assert.equal(last.data.state, 'queued'); assert.equal(last.data.do_not_poll, true);
  assert.match(last.text, /not responding right now/); assert.match(last.text, /watch their Ryagram projects page/);
  assert.match(last.text, /not failed/);
  assert.doesNotMatch(last.text, /\b\d+ (minutes|hours)\b/);                                                 // no estimate it cannot back
});

test('A PREVIEW is told the same, and so is the film link of a project whose job is waiting', async () => {
  const { w, call } = world();
  const { id, started } = await queued(call, 'make_preview', () => { w.rendering = 'delayed'; });   // the machine goes away after the sheet
  assert.equal(started.data.do_not_poll, true);
  const link = await call(A, 'get_film_link', { project_id: id, job_id: started.data.job_id });   // the sheet is finished; ask for the waiting preview
  assert.match(link.text, /Nothing is finished yet/); assert.match(link.text, /not responding right now/); assert.match(link.text, /Do not keep checking/);
  assert.equal(link.data.do_not_poll, true);
});

test('THE MACHINE IS FINE: no offline words, a time to wait before one more check, and the plea not to loop', async () => {
  const { call } = world();
  const { started } = await queued(call);
  assert.doesNotMatch(started.text, /not responding/);
  assert.match(started.text, /Do not keep checking/);
  const st = await call(A, 'job_status', { job_id: started.data.job_id });
  assert.equal(st.data.state, 'running');
  assert.equal(st.data.do_not_poll, false); assert.equal(st.data.poll_after_s, 60); assert.match(st.text, /about a minute at the earliest/);
  assert.match(st.text, /Do not keep checking: every check uses the person's own AI allowance/);
  const { asks, last } = await pollingAi(call, started.data.job_id);
  assert.equal(last.data.state, 'complete'); assert.ok(asks <= 3);
});

test('A FINISHED JOB has no waiting advice at all', async () => {
  const { call } = world();
  const { started } = await queued(call);
  await call(A, 'job_status', { job_id: started.data.job_id });
  const done = await call(A, 'job_status', { job_id: started.data.job_id });
  assert.equal(done.data.state, 'complete');
  assert.doesNotMatch(done.text, /Do not keep checking|not responding/);
  assert.equal(done.data.do_not_poll, undefined);
});

test('A JOB ON THE PERSONS OWN COMPUTER that is asleep: the first answer says to stop checking', async () => {
  const { w, call } = world();
  w.setLocal(A.userId, { lastSeenAt: new Date(Date.now() - 300000).toISOString(), computerName: 'Sam-PC', awake: false });
  const { started } = await queued(call);
  assert.equal(started.data.run_on, 'owner_local'); assert.equal(started.data.do_not_poll, true);
  const { asks } = await pollingAi(call, started.data.job_id);
  assert.equal(asks, 1);
});

test('"unknown" (the machine was never seen) is not an alarm, and a state check that fails never breaks the answer', async () => {
  const { w, call } = world();
  w.rendering = 'unknown';
  const { started } = await queued(call);
  assert.doesNotMatch(started.text, /not responding/); assert.equal(started.data.rendering, 'unknown');
  const w2 = new FakeWorld();
  w2.addUser(A.userId, 'alice@example.test', 100); w2.invite(A.userId, A.clientId);
  const broken = w2.data(A.userId);
  broken.renderingState = async () => { throw new Error('db down'); };
  const call2 = (p, name, args) => callTool(name, args, p, { data: broken, policy: w2.policy(), deps: { compile } });
  const { started: s2 } = await queued(call2);
  assert.ok(!s2.isError, s2.text); assert.equal(s2.data.rendering, 'unknown'); assert.equal(s2.data.do_not_poll, false);
});

test('waitAdvice by itself: only an unfinished job is advised, and only a queued house job on a delayed machine is told not to poll', () => {
  for (const s of ['complete', 'failed', 'cancelled', 'editorial_action_required']) assert.equal(waitAdvice(s, 'delayed', false), null, s);
  assert.equal(waitAdvice('queued', 'delayed', false).data.do_not_poll, true);
  assert.equal(waitAdvice('running', 'delayed', false).data.do_not_poll, false);                               // already running: the machine is evidently there
  assert.equal(waitAdvice('queued', 'ok', false).data.do_not_poll, false);
  assert.equal(waitAdvice('queued', 'ok', true).data.do_not_poll, true);                                       // a sleeping computer of the person's own
});
