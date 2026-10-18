// The app's Render button on the order path (PIPE-1: request_final_render, the approval queue), its words, the delivery page, and the small account/project fixes that
// shipped with it. The database half is the PIPE session's supabase/tests/test_pipe1_orders.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const win = {};
for (const f of ['app-data.js', 'app-jobs.js']) vm.runInNewContext(read(`assets/${f}`), { window: win, setTimeout, clearTimeout });
const J = win.ryagramJobs;
const plain = x => JSON.parse(JSON.stringify(x));

// a version with a finished contact sheet and preview for its story
function ready(client) {
  const v = { id: 'v1', project_id: 'p1', number: 1, state: 'draft', story_spec: { schema: 1, engine: 'sequence' }, story_sha256: 'sha-x' };
  client.db.versions.push(v);
  client.db.jobs.push({ id: 'sheet1', version_id: 'v1', job_type: 'contact_sheet', state: 'complete', story_sha256: 'sha-x', engine_commit: 'abc1234' },
                      { id: 'prev1', version_id: 'v1', job_type: 'preview', state: 'complete', story_sha256: 'sha-x', engine_commit: 'abc1234' });
  return v;
}

test('ORDER: with auto_render off a full render is REQUESTED and waits for approval with its credits held; nothing is queued; the words say so', async () => {
  const client = createFakeClient({ autoRender: false });
  ready(client);
  const data = win.ryagramData(client);
  const order = await data.requestFinalRender('prev1', 'app-test-key-0001');
  assert.equal(order.state, 'awaiting_approval');
  assert.ok(!client.db.jobs.some(j => j.job_type === 'final_render'), 'no final job exists until Ryan approves');
  const st = await data.orderStatus(order.id);
  assert.match(J.orderLine(st), /waiting for approval. We approve each one by hand for now. 10 credits are held. They come back if it is not approved\./);
  assert.equal(J.ORDER_WORDS[st.state], 'Waiting for approval');
  assert.deepEqual(plain((await data.listOrders('v1')).map(o => o.state)), ['awaiting_approval']);
  const rpcs = client.log.filter(l => l.rpc).map(l => l.rpc);
  assert.ok(rpcs.includes('request_final_render'));
  assert.ok(!rpcs.includes('submit_job'), 'the direct path is not used on the order path');
});

test('ORDER: with auto_render on it starts at once; a key is spent for good; one open request per preview; a cancel returns the order to the person', async () => {
  const client = createFakeClient({ autoRender: true });
  ready(client);
  const data = win.ryagramData(client);
  const order = await data.requestFinalRender('prev1', 'app-test-key-0002');
  assert.equal(order.state, 'running');
  assert.ok(client.db.jobs.some(j => j.job_type === 'final_render'));
  await assert.rejects(data.requestFinalRender('prev1', 'app-test-key-0003'), /already has a full-render request/);
  await assert.rejects(data.requestFinalRender('prev1', 'app-test-key-0002'), /key_reused/);
  await assert.rejects(data.requestFinalRender('prev1', 'short'), /8 to 100/);
  await assert.rejects(data.requestFinalRender('nope', 'app-test-key-0004'), /not yours, or not finished/);
  const c2 = createFakeClient({ autoRender: false });
  ready(c2);
  const d2 = win.ryagramData(c2);
  const o2 = await d2.requestFinalRender('prev1', 'app-test-key-0005');
  assert.equal((await d2.cancelOrder(o2.id)).state, 'cancelled');
  assert.match(J.orderLine(await d2.orderStatus(o2.id)), /You cancelled the full render. Your credits were returned\./);
  assert.equal(J.orderOpen('awaiting_approval') && J.orderOpen('running') && !J.orderOpen('delivered'), true);
});

test('WORDS: every order state has a sentence that says what happened to the credits, and a deleted film says it was kept 30 days', () => {
  for (const state of ['declined', 'expired', 'cancelled', 'editorial_action_required', 'failed']) assert.match(J.orderLine({ state, stages: [] }), /credits were returned/, state);
  assert.match(J.orderLine({ state: 'running', stages: [{ stage: 'final_render', credits_quoted: 1 }] }), /on its way. 1 credit are held|1 credit/);
  assert.match(J.orderLine({ state: 'delivered', delivery: { id: 'd', expires_at: '2026-11-17T00:00:00Z', deleted: false } }), /ready, kept for 30 days \(until 2026-11-17\)/);
  assert.match(J.orderLine({ state: 'delivered', delivery: { id: 'd', deleted: true } }), /kept for 30 days and has been deleted/);
  assert.equal(J.orderLine(null), '');
});

test('DELIVERY: the film link comes from get-delivery-url (the database decides), and its refusals are shown in words', async () => {
  const client = createFakeClient({ autoRender: false });
  ready(client);
  const data = win.ryagramData(client);
  const order = await data.requestFinalRender('prev1', 'app-test-key-0006');
  const o = client.db.render_orders[0];
  o.state = 'delivered'; o.delivery = { id: '11111111-1111-4111-8111-111111111111', label: 'x', expires_at: '2026-11-17T00:00:00Z', deleted: false };
  const got = await data.deliveryUrl(o.delivery.id);
  assert.equal(got.label, 'AI-assisted');
  assert.ok(got.url);
  assert.equal(client.log.at(-1).fn, 'get-delivery-url');
  await assert.rejects(data.deliveryUrl('22222222-2222-4222-8222-222222222222'), /Film not found/);
  o.delivery.deleted = true;
  await assert.rejects(data.deliveryUrl(o.delivery.id), /kept for its 30 days and has been deleted/);
  assert.ok(order);
});

test('WIRING: the Render button takes the order path when renderOrders is on and the old direct path otherwise; every request makes a NEW key; an open order keeps the page polling', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /const ordersOn = \(\) => window\.ryagramConfig\?\.renderOrders === true \|\| !!window\.ryagramMock;/);
  assert.match(lib, /if \(ordersOn\(\)\) \{ requestOrder\(ladder\.preview\.id\); return; \}/);
  assert.match(lib, /submit\(finalButton, 'final_render', \{\}, \{ sheetJobId: ladder\.sheet\.id, previewJobId: ladder\.preview\.id \}\);/);       // the legacy path is still there
  assert.match(lib, /data\.requestFinalRender\(previewJobId, `app-\$\{previewJobId\.slice\(0, 8\)\}-\$\{Date\.now\(\)\.toString\(36\)\}-\$\{Math\.random\(\)\.toString\(36\)\.slice\(2, 8\)\}`\)/);
  assert.match(lib, /jobs\.some\(J\.isActive\) \|\| openOrders/);
  assert.match(lib, /ordersOn\(\) && \(m = hash\.match\(new RegExp\(`\^#\/delivery\/\$\{UUID\}\$`\)\)\)/);
  assert.match(read('assets/ryagram-config.js'), /renderOrders: false,/);                                                // ships OFF until PIPE-1's SQL is applied
  assert.doesNotMatch(lib.slice(lib.indexOf('async function requestOrder')), /insert\(|\.from\('jobs'\)/);               // a full render is requested, never inserted
});

test('PASSWORD: the 12-character minimum is stated and enforced on the set-password screen and the account page', () => {
  const html = read('app/index.html'), lib = read('assets/app-library.js'), auth = read('assets/app-auth.js');
  assert.match(html, /New password \(at least 12 characters\)/);
  assert.equal((html.match(/minlength="12"/g) || []).length, 2);
  assert.match(lib, /'New password \(at least 12 characters\)'/);
  assert.equal((lib.match(/id: 'acct-password2?', type: 'password', autocomplete: 'new-password', minlength: '12'/g) || []).length, 2);
  assert.match(auth, /password\.value\.length < 12/);
  assert.doesNotMatch(html + lib, /at least 10 characters/);
});

test('POINTER: a project page points non-technical people to Request a film (only when requests are on)', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /const helpNote = requestsOn\(\) \? h\('p', \{ class: 'form-note request-pointer' \}, 'Not sure how to build a film\? ', h\('a', \{ href: '#\/request' \}, 'Request a film'\)/);
  assert.match(lib, /h\('h1', \{ tabindex: '-1' \}, project\.title\),\r?\n\s+helpNote,/);
});
