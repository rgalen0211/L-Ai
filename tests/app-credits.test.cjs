const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createFakeClient } = require('./fake-supabase.js');
const { createMockWorker } = require('./mock-worker.js');

function load(file) {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', file), 'utf8'), { window });
  return window;
}
const C = load('app-credits.js').ryagramCredits;
const plain = v => JSON.parse(JSON.stringify(v));
const ryagramData = load('app-data.js').ryagramData;
const story = (...views) => ({ schema: 1, engine: 'sequence', name: 's',
  sequence: { clips: views.map(v => ({ kind: 'render', view: v, dataset: 'state_obesity_fastfood', start: '2011', end: '2023' })) } });

test('prices read plainly and affordability explains itself', () => {
  assert.equal(C.priceLabel({ credits: 0, free_preview: false }), 'free');
  assert.equal(C.priceLabel({ credits: 0, free_preview: true }), 'free preview');
  assert.equal(C.priceLabel({ credits: 1 }), '1 credit');
  assert.equal(C.priceLabel({ credits: 10 }), '10 credits');
  assert.deepEqual(plain(C.affordable({ credits: 10, available: 10 })), { ok: true });
  assert.deepEqual(plain(C.affordable({ credits: 10, available: 4 })), { ok: false, reason: 'This needs 10 credits and you have 4 credits.' });
  assert.equal(C.affordable({ credits: 1, available: -10 }).reason, 'This needs 1 credit and you have 0 credits.');
  assert.deepEqual(plain(C.affordable({ credits: 0, free_preview: true, available: -10 })), { ok: true });   // free work continues
});

test('a job says what happened to its credits', () => {
  assert.equal(C.jobCredits({ free_preview: true, credits_quoted: 0 }), 'Free preview');
  assert.equal(C.jobCredits({ credits_quoted: 0 }), 'Free');
  assert.equal(C.jobCredits({ credits_quoted: 10, held: 10 }), '10 credits held until it finishes');
  assert.equal(C.jobCredits({ credits_quoted: 10, held: 10, captured: 10 }), '10 credits spent');
  assert.equal(C.jobCredits({ credits_quoted: 10, held: 10, released: 10 }), '10 credits returned');
  assert.equal(C.jobCredits({ credits_quoted: 10, held: 10, captured: 10, refunded: 10 }), '10 credits spent, 10 credits refunded');
  assert.equal(C.balanceLine([{ available: 22, held: 8 }]), '22 credits available, 8 held by jobs in progress');
  assert.match(C.balanceLine([{ available: -10, held: 0 }]), /paid renders are paused/);
});

async function world(credits, views = ['paired']) {
  const client = createFakeClient({ credits });
  const data = ryagramData(client);
  const { version } = await data.createProject('Film');
  await data.saveStory(version.id, story(...views));
  const worker = createMockWorker(client);
  const until = async id => { for (let i = 0; i < 60; i++) { const j = client.db.jobs.find(x => x.id === id);
    if (['complete', 'failed', 'cancelled', 'editorial_action_required'].includes(j.state)) return j; worker.tick(); } };
  return { client, data, version, worker, until };
}

test('mock ledger: the final is priced by its most expensive view, held, then spent', async () => {
  const w = await world(30, ['line', 'map', 'paired']);
  assert.equal((await w.data.creditQuote(w.version.id, 'final_render')).credits, 10);
  const sheet = await w.data.submitJob(w.version.id, 'contact_sheet', {}); await w.until(sheet.id);
  const prev = await w.data.submitJob(w.version.id, 'preview', { window_s: [0, 10] }); await w.until(prev.id);
  const final = await w.data.submitJob(w.version.id, 'final_render', {}, { sheetJobId: sheet.id, previewJobId: prev.id });
  assert.deepEqual((await w.data.creditBalances()).map(r => [r.available, r.held]), [[20, 10]]);
  await w.until(final.id);
  const acct = await w.data.jobAccounting(w.version.id);
  assert.equal(C.jobCredits(acct[final.id]), '10 credits spent');
  assert.equal(C.jobCredits(acct[sheet.id]), 'Free');
  assert.equal(C.jobCredits(acct[prev.id]), 'Free preview');
  assert.deepEqual((await w.data.creditBalances()).map(r => [r.available, r.held]), [[20, 0]]);
});

test('mock ledger: a failed render returns its credits; too few credits is refused before anything runs', async () => {
  const w = await world(10, ['map']);
  w.worker.setOutcome('gate');
  const sheet = await w.data.submitJob(w.version.id, 'contact_sheet', {});
  w.worker.setOutcome('succeed');
  await w.until(sheet.id);
  const prev = await w.data.submitJob(w.version.id, 'preview', { window_s: [0, 10] }); await w.until(prev.id);
  w.worker.setOutcome('crash_always');
  const final = await w.data.submitJob(w.version.id, 'final_render', {}, { sheetJobId: sheet.id, previewJobId: prev.id });
  await w.until(final.id);
  assert.equal(C.jobCredits((await w.data.jobAccounting(w.version.id))[final.id]), '8 credits returned');
  assert.equal((await w.data.creditBalances())[0].available, 10);

  const poor = await world(5, ['paired']);
  const q = await poor.data.creditQuote(poor.version.id, 'final_render');
  assert.equal(C.affordable(q).ok, false);
});

test('mock ledger: 6 free previews per project, then 1 credit each', async () => {
  const w = await world(3, ['map']);
  for (let i = 0; i < 6; i++) {
    assert.equal((await w.data.creditQuote(w.version.id, 'preview')).free_preview, true);
    const p = await w.data.submitJob(w.version.id, 'preview', { window_s: [0, 10] });
    await w.until(p.id);
  }
  const seventh = await w.data.creditQuote(w.version.id, 'preview');
  assert.deepEqual([seventh.free_preview, seventh.credits], [false, 1]);
  await w.data.submitJob(w.version.id, 'preview', { window_s: [0, 10] });
  assert.equal((await w.data.creditBalances())[0].available, 2);
});

test('without the ledger, the credit calls fail quietly and nothing is charged', async () => {
  const client = createFakeClient();
  const data = ryagramData(client);
  const { version } = await data.createProject('Film');
  await assert.rejects(data.creditBalances());
  await assert.rejects(data.creditQuote(version.id, 'preview'));
});
