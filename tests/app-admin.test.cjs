const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createFakeClient } = require('./fake-supabase.js');

function load(file) {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', file), 'utf8'), { window });
  return window;
}
const A = load('app-admin.js').ryagramAdmin;
const ryagramData = load('app-data.js').ryagramData;
const plain = v => JSON.parse(JSON.stringify(v));

test('totals per film link, biggest first, no-link last', () => {
  const rows = [
    { day: '2026-10-03', campaign: 'r002-industry-story', utm_source: 'youtube', signups: 2 },
    { day: '2026-10-04', campaign: 'r002-industry-story', utm_source: 'youtube', signups: 1 },
    { day: '2026-10-03', campaign: null, utm_source: null, signups: 5 },
    { day: '2026-10-03', campaign: 'housing-supply-story', utm_source: 'youtube', signups: 1 },
    { day: '2026-10-03', campaign: 'AbCd', utm_source: 'film_page', signups: 4 }];
  assert.deepEqual(plain(A.byFilm(rows)), [
    { campaign: 'AbCd', utm_source: 'film_page', signups: 4 },
    { campaign: 'r002-industry-story', utm_source: 'youtube', signups: 3 },
    { campaign: 'housing-supply-story', utm_source: 'youtube', signups: 1 },
    { campaign: null, utm_source: null, signups: 5 }]);
  assert.deepEqual(plain(A.byFilm([])), []);
  assert.equal(A.campaignLabel(null), 'No film link (the page directly)');
  assert.equal(A.dayLabel('2026-10-03'), 'Sat, Oct 3, 2026');
});

test('not an admin, or the SQL not applied, means no admin view; the counts call goes to the RPC', async () => {
  const data = ryagramData(createFakeClient());
  assert.equal(await data.isAppAdmin(), true);                                   // mock user
  assert.equal((await data.waitlistByFilm(30)).length, 5);                   // the mock's rows inside 30 days
  const missing = ryagramData({ rpc: async () => ({ data: null, error: { message: 'function public.is_app_admin() does not exist' } }) });
  assert.equal(await missing.isAppAdmin(), false);
  const notAdmin = ryagramData({ rpc: async () => ({ data: false, error: null }) });
  assert.equal(await notAdmin.isAppAdmin(), false);
  const refused = ryagramData({ rpc: async () => ({ data: null, error: { message: 'Only an admin can see the waitlist counts.' } }) });
  await assert.rejects(refused.waitlistByFilm(30), /Only an admin/);
});
