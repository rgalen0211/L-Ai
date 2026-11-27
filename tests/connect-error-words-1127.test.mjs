// The plain words an AI (and so a stranger who asks it) is handed when the connector refuses or cannot go on (CONNECT 11-27, proposals/CONNECT-ERROR-WORDS-1127.md; DRAFTS for Ryan's yes).
// Five required cases: out of credits, a full film asked from the AI, the free-preview limit, a dataset Ryagram does not have, and a sign-in that has ended. Each pins the NEW sentences, the part of each that must not move
// (the error code, the status code, the data fields an AI branches on, every number the code enforces) and that the OLD words are gone. Words only: nothing here changes who is refused. Must-fails: tests/connect_error_words_1127_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { friendlyError } from '../supabase/functions/connect-core/tools.ts';
import { handleMcp } from '../supabase/functions/connect-core/mcp.ts';
import { handleRest } from '../supabase/functions/connect-core/rest.ts';
import { LIMITS } from '../supabase/functions/connect-core/types.ts';
import { build, TEMPLATES } from '../supabase/functions/_shared/templates.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
// words an AI repeats to a person must not carry the project's own jargon (the tool names and field names the AI itself uses are fine)
const JARGON = /\b(scope|token|RPC|schema|JWT|OAuth|errcode|SQLSTATE|PT\d{3})\b/i;

function world(credits, scopes) {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', credits);
  if (scopes) w.invite(A.userId, A.clientId, scopes); else w.invite(A.userId, A.clientId);
  const env = (p, extra = {}) => ({ data: w.data(p.userId), policy: w.policy(), deps: { compile }, ...extra });
  const call = (p, name, args, extra) => callTool(name, args, p, env(p, extra));
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

// ------------------------------------------------------------------------------------------------ 1. out of credits
test('OUT OF CREDITS: a refused preview says what happened, that nothing is lost, that an AI cannot spend credits, and that no more can be made right now', async () => {
  const { call, id } = await readyToPreview(0);
  const r = await call(A, 'make_preview', { project_id: id });
  assert.equal(r.isError, true); assert.equal(r.code, 'costs_credits');                                        // the AI branches on the code: unchanged
  assert.deepEqual([r.credits, r.data.started, r.data.credits], [5, false, 5]);                               // and on these fields: unchanged
  assert.match(r.text, /^The preview needs 5 credits, because the free previews are used up/);
  assert.match(r.text, /NOTHING was started, and nothing was lost: the saved story and the contact sheet are untouched\./);
  assert.match(r.text, /An AI cannot spend credits\./);
  assert.match(r.text, /The person has 0 credits, which is not enough, so nothing more can be made right now: tell them so plainly, and do not send them to the Ryagram app for it\./);
  assert.doesNotMatch(r.text, /press the button in the Ryagram app/);                                         // a person with none is not sent to a button that will not work
  assert.doesNotMatch(r.text, /A connection cannot spend credits|would cost/);                                // the old words are gone
  assert.doesNotMatch(r.text, JARGON);
  assert.doesNotMatch(r.text, /\$|price|dollar/i);                                                            // never a price
});

// ------------------------------------------------------------------------------------------------ 2. a full film asked from the AI
test('FULL FILM FROM THE AI: refused every time, in words that keep the rule "the person presses the button in Ryagram", whatever is sent', async () => {
  const { call } = world(100);
  for (const extra of [{}, { confirm: true }, { confirm: true, preview_job_id: '33333333-3333-4333-8333-333333333333' }]) {
    // called the way both faces call it (listedOnly): this one unlisted tool stays callable, for this refusal
    const r = await call(A, 'request_full_render', { project_id: '11111111-1111-4111-8111-111111111111', ...extra }, { listedOnly: true });
    assert.equal(r.refused, true); assert.equal(r.code, 'not_available');
    assert.deepEqual([r.data.ok, r.data.allowed, r.data.started, r.data.credits_used, r.data.code], [false, false, false, 0, 'not_available']);
    assert.equal(r.data.reason, 'An AI cannot start a full film render. Nothing was started and no credits were used.');
    assert.match(r.data.what_to_do, /^A final film needs credits, and only the person can spend them\. If they have credits, they press 'Render final film' in the Ryagram app\. If they have none, tell them plainly that a final film is not possible for them right now, and do not promise one\.$/);
    assert.equal(r.text, `${r.data.reason} ${r.data.what_to_do}`);
    assert.doesNotMatch(r.text, /A full render cannot be started from an AI connection/);                    // the old words are gone
    assert.doesNotMatch(r.text, JARGON);
  }
});

test('FULL FILM FROM THE AI: the database\'s own refusal of it (a direct call) reads the same way', () => {
  const sql = (message, code = '42501') => Object.assign(new Error(message), { code });
  const t = friendlyError(sql('Full renders cannot be started from an AI connection yet. Start it in the Ryagram app.'));
  assert.match(t, /^An AI cannot start a full film render\. Nothing was started and no credits were used\. The person starts the final film themselves by pressing 'Render final film' in the Ryagram app\.$/);
  const c = friendlyError(sql('This would cost credits. Credits can only be spent from the Ryagram app for now; start it there.'));
  assert.match(c, /^This needs credits, and an AI cannot spend credits\. Nothing was started and no credits were used\./);
  // an unknown database sentence is still shown as the database wrote it, and the generic one is unchanged
  assert.equal(friendlyError(sql('Some other plain sentence.')), 'Some other plain sentence.');
  assert.equal(friendlyError(sql('x'.repeat(301))), 'Ryagram could not do that right now. Nothing was changed. Try again in a moment.');
});

// ------------------------------------------------------------------------------------------------ 3. the free-preview limits
test('FREE-PREVIEW LIMIT: the words give both limits exactly as the code enforces them (6 for a project, 15 in any 24 hours) and send a person WITH credits to the button', async () => {
  const { call, id } = await readyToPreview(100);
  const r = await call(A, 'make_preview', { project_id: id });
  assert.equal(r.code, 'costs_credits');
  assert.match(r.text, /each project gets 6 free previews, and each person gets 15 free previews in any 24 hours\./);
  assert.match(r.text, /The person has 100 credits, so they can start it themselves: they press the button in the Ryagram app\./);
  assert.match(r.text, /An AI cannot spend credits\./);
  assert.doesNotMatch(r.text, /do not send them to the Ryagram app/);
  assert.doesNotMatch(r.text, JARGON);
  // one credit is "1 credit", never "1 credits"
  const { call: call2, id: id2, w } = await readyToPreview(1);
  w.users.get(A.userId).previewsUsed.set(w.users.get(A.userId).projects[0].id, 3);
  const one = await call2(A, 'make_preview', { project_id: id2 });
  assert.match(one.text, /The person has 1 credit,/);
  assert.doesNotMatch(one.text, /\b1 credits\b/);
});

test('FREE-PREVIEW LIMIT: the hourly limit on starting sheets and previews still says its number (read from the code) and that the app is open to the person', async () => {
  const { w, call } = world(100);
  const id = (await call(A, 'create_project', { title: 'Film' })).data.project_id;
  await call(A, 'set_story', { project_id: id, story: goodStory() });
  const p = w.policy(); const hit = p.hit;
  const env = { data: w.data(A.userId), policy: { ...p, hit: async (pr, bucket, ...rest) => (bucket === 'ladder' ? false : hit(pr, bucket, ...rest)) }, deps: { compile } };
  const r = await callTool('make_contact_sheet', { project_id: id }, A, env);
  assert.equal(r.code, 'rate'); assert.equal(r.data.limit, 'hourly_jobs'); assert.equal(r.data.max, LIMITS.ladderPerHourPerUser);
  assert.match(r.text, new RegExp(`\\(${LIMITS.ladderPerHourPerUser} an hour\\)`));
});

// ------------------------------------------------------------------------------------------------ 4. a dataset Ryagram does not have
test('DATASET NOT ALLOWED: set_story names the dataset, says Ryagram does not have it, lists what it can draw, and tells the AI to say so plainly', async () => {
  const { call } = world(10);
  const id = (await call(A, 'create_project', { title: 'Film' })).data.project_id;
  const story = goodStory();
  const clip = story.sequence.clips.find((c) => c.kind === 'render'); clip.dataset = 'median_age_by_state';
  const r = await call(A, 'set_story', { project_id: id, story });
  assert.equal(r.code, 'checks_failed'); assert.equal(r.refused, true); assert.equal(r.data.saved, false);   // the AI branches on these: unchanged
  assert.match(r.text, /^The story was NOT saved\./);
  const line = r.data.errors.map((e) => e.message).find((m) => /median_age_by_state/.test(m));
  assert.match(line, /^Clip \d+ uses the dataset "median_age_by_state", which Ryagram does not have: it is not in the catalog, and not among the person's own uploaded data \(list_my_data shows that\)\. The datasets Ryagram can draw are: /);
  assert.match(line, /If the person asked for a subject that is not on this list, tell them plainly that Ryagram does not have it; do not swap in another dataset without saying so\.$/);
  assert.doesNotMatch(line, /Allowed:|not in the Ryagram catalog or among/);                                   // the old words are gone
  assert.doesNotMatch(line, JARGON);
});

test('DATASET NOT ALLOWED: dataset_info for a name Ryagram does not have says so without "the engine\'s records"', async () => {
  const { call } = world(10);
  const r = await call(A, 'dataset_info', { dataset_id: 'median_age_by_state' });
  assert.equal(r.isError, true); assert.equal(r.code, 'not_found');
  assert.match(r.text, /^Ryagram has no dataset called "median_age_by_state"\./);
  assert.match(r.text, /tell them plainly that Ryagram does not have it; do not swap in another dataset without saying so\.$/);
  assert.doesNotMatch(r.text, /engine's records/);
});

test('DATASET NOT ALLOWED: a place question or a forecast that the service will not answer on this data says so, and that asking again will not change it', async () => {
  const { w, call } = world(10);
  const geo = { enabled: async () => true };
  for (const [tool, code, want] of [['geo_answer', 'data_not_allowed', /^For now, place questions are answered only on made-up example data, and this place is not part of it, so there is no answer\. Asking again will not change that\./],
                                    ['forecast_answer', 'data_not_allowed', /^For now, forecasts are not available for real use, so there is no forecast\. Asking again will not change that\./]]) {
    const id = '44444444-4444-4444-8444-444444444444';
    const row = { id, state: 'failed', fail_code: code, fail_detail: null, shape: tool === 'forecast_answer' ? 'forecast' : 'within_minutes', waited_s: 0, answer: null, lat: null, lon: null, minutes: null, categories: [], horizon: null };
    const env = { data: { ...w.data(A.userId), getGeo: async () => row }, policy: w.policy(), deps: { compile, geo, forecast: geo } };
    const r = await callTool(tool, { id }, A, env);
    assert.equal(r.code, 'bad_report'); assert.equal(r.data.fail_code, code);                                   // unchanged
    assert.match(r.text, want); assert.match(r.text, /Nothing is shown\.$/);
    assert.doesNotMatch(r.text, /switched on for real use|only answered on example data/);
  }
});

// ------------------------------------------------------------------------------------------------ 5. a sign-in that has ended
const dead = {
  verifyToken: async () => null, dataFor: () => { throw new Error('a dead sign-in must never reach the data'); }, policy: { grantFor: async () => { throw new Error('nor the policy'); } },
  deps: { compile }, resourceMetadataUrl: 'https://ref.supabase.co/functions/v1/connect/.well-known/oauth-protected-resource',
};
const SIGNED_OUT = 'This AI is not signed in to Ryagram, or its sign-in has ended. Nothing was done, and nothing in the account was lost. To go on, connect Ryagram again in the AI app and sign in when it asks.';

test('SIGN-IN ENDED: MCP and REST answer 401 with the same plain sentence, and still the challenge the AI app needs to sign in again', async () => {
  const mcp = await handleMcp(new Request('https://x.test/mcp', { method: 'POST', headers: { authorization: 'Bearer rga_old', 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }), dead);
  const rest = await handleRest(new Request('https://x.test/v1/tools/list_projects', { method: 'POST', headers: { authorization: 'Bearer rga_old' }, body: '{}' }), '/v1/tools/list_projects', dead, 'https://x.test');
  for (const r of [mcp, rest]) {
    assert.equal(r.status, 401);                                                                              // the status is unchanged
    assert.match(r.headers.get('www-authenticate'), /^Bearer error="invalid_token", resource_metadata="https:\/\/ref\.supabase\.co\//);   // and so is the challenge
    const body = await r.json();
    assert.equal(body.error, SIGNED_OUT);
    assert.doesNotMatch(body.error, JARGON);
    assert.doesNotMatch(body.error, /^Sign in to Ryagram to use/);                                            // the old words are gone
  }
});

test('SIGN-IN ENDED: a sign-in that ends in the middle of a call (the database says so) gets the same sentence; so do a removed connection and a connection switched off', () => {
  const sql = (message, code) => Object.assign(new Error(message), { code });
  assert.equal(friendlyError(sql('Sign in to Ryagram to use this connection.', 'PT401')), SIGNED_OUT);
  assert.match(friendlyError(sql('AI connections to Ryagram are switched off right now.', 'PT403')), /^AI connections to Ryagram are switched off right now, so nothing was done\. Nothing in the account was lost\. Try again later\.$/);
  assert.match(friendlyError(sql('This account is not enabled for AI connections, or the connection was revoked or does not allow that.', 'PT403')), /Account, then Connected AIs, in the Ryagram app/);
});

test('SIGN-IN ENDED: a connection that is gone, and a permission the AI was never given, each say what to do next in the Ryagram app', async () => {
  const { w, call } = world(10, ['read']);
  const wrote = await call(A, 'create_project', { title: 'Film' });
  assert.equal(wrote.code, 'scope'); assert.equal(wrote.isError, true);
  assert.match(wrote.text, /^This AI was not given permission to create projects and change film stories when it was connected, so nothing was done\. There is no switch for it in Ryagram\. To add it, the person opens Account, then Connected AIs, in the Ryagram app and presses Disconnect, then connects the AI again/);
  assert.doesNotMatch(wrote.text, /was not allowed to do that|write\)/);
  assert.doesNotMatch(wrote.text, JARGON);
  w.revoke(A.userId, A.clientId);
  const gone = await call(A, 'list_projects', {});
  assert.equal(gone.code, 'no_grant'); assert.equal(gone.isError, true);
  assert.match(gone.text, /^This AI cannot use this Ryagram account right now: the connection may have been removed, AI connections may be switched off, or the account may not be allowed to connect an AI\. Nothing was done, and nothing was lost\./);
  assert.match(gone.text, /Account, then Connected AIs, in the Ryagram app/);
  assert.doesNotMatch(gone.text, /cannot use AI connections right now/);
});

test('TOO BIG: a request over the size limit says the limit (read from the code) and that nothing was saved', async () => {
  const big = 'x'.repeat(LIMITS.maxBodyBytes + 10);
  const live = { ...dead, verifyToken: async () => ({ tokenHash: 'h' }) };
  const r = await handleMcp(new Request('https://x.test/mcp', { method: 'POST', headers: { authorization: 'Bearer rga_ok', 'content-type': 'application/json' }, body: big }), live);
  assert.equal(r.status, 413);
  assert.equal((await r.json()).error, `That request was too big for Ryagram to accept (the limit is ${LIMITS.maxBodyBytes / 1024} KB). Nothing was saved. Send less in one go.`);
});

test('DAILY CREDIT CAP: the database\'s "daily_cap" sentence reaches the AI without the code word, and the code the AI branches on is unchanged', async () => {
  const e = Object.assign(new Error("daily_cap: you have reached today's credit limit. Try again tomorrow."), { code: 'PTCAP' });
  assert.equal(friendlyError(e), "The person has reached today's limit on how many credits can be used, so nothing was started. Nothing was lost. They can try again later.");
  const { errorCodeOf } = await import('../supabase/functions/connect-core/tools.ts');
  assert.equal(errorCodeOf(e), 'daily_credit_cap');
});

// ------------------------------------------------------------------------------------------------ the two sentences every refused call can meet
test('BAD DETAILS: a call whose arguments do not fit says nothing was done, in the same words for every tool', async () => {
  const { call } = world(10);
  const r = await call(A, 'create_project', { title: '' });
  assert.equal(r.isError, true); assert.equal(r.code, 'args');
  assert.match(r.text, /^Ryagram could not use those details, so nothing was done: /);
  assert.doesNotMatch(r.text, /The call was not understood/);
});

test('UNREADABLE ANSWER: an answer from the house computer that fails the checks is not shown, and the AI is told not to guess', async () => {
  const { w, call } = world(10);
  const on = { enabled: async () => true };
  const id = '55555555-5555-4555-8555-555555555555';
  const row = { id, state: 'answered', shape: 'forecast', fail_code: null, fail_detail: null, waited_s: 0, answer: { nothing: 'useful' }, lat: null, lon: null, minutes: null, categories: [], horizon: 3 };
  const env = { data: { ...w.data(A.userId), getGeo: async () => row }, policy: w.policy(), deps: { compile, geo: on, forecast: on } };
  const r = await callTool('forecast_answer', { id }, A, env);
  assert.equal(r.isError, true); assert.equal(r.code, 'bad_report');                                          // the AI branches on the code: unchanged
  assert.equal(r.text, 'Ryagram got an answer back but could not trust it, so none of it is shown. Nothing was changed. Tell the person the answer could not be shown; do not guess at it.');
  assert.doesNotMatch(r.text, /in a shape this connection knows|labelled/);
  const g = await callTool('geo_answer', { id }, A, { ...env, data: { ...env.data, getGeo: async () => ({ ...row, shape: 'within_minutes', lat: 31, lon: -97, minutes: 10, categories: [] }) } });
  assert.equal(g.code, 'bad_report'); assert.equal(g.text, r.text);
});
