// Find data through the data layer against the fake client: search, the queue, Ryan's counts, my own requests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createFakeClient } = require('./fake-supabase.js');

function load(file) {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', file), 'utf8'), { window, URL });
  return window;
}
const ryagramData = load('app-data.js').ryagramData;
const S = load('app-search.js').ryagramSearch;
const plain = v => JSON.parse(JSON.stringify(v));

test('a search returns cards with the table’s facts; a tie marks none; an unsupported request is told plainly and queued', async () => {
  const client = createFakeClient();
  const data = ryagramData(client);
  const one = S.answerView(await data.searchSources('Which states depend on manufacturing?'));
  assert.equal(one.cards.length, 1);
  assert.deepEqual([one.cards[0].publisher, one.cards[0].coverage, one.cards[0].recommended], ['U.S. Census Bureau, County Business Patterns', 'US state (plus DC), 1998 to 2023, annual', true]);
  const tie = S.answerView(await data.searchSources('compare unemployment and obesity'));
  assert.equal(tie.cards.length, 2);
  assert.ok(tie.cards.every(c => !c.recommended && c.reason === ''));
  const none = S.answerView(await data.searchSources('burglaries by county'));
  assert.deepEqual([none.cards.length, none.verdict.code], [0, 'no_such_data']);
  assert.equal(client.db.data_gaps.length, 1);
  await assert.rejects(data.searchSources('   '), /Write what you want to see/);
});

test('Ryan sees counts first and the words only on demand; a person sees and deletes their own requests', async () => {
  const client = createFakeClient();
  const data = ryagramData(client);
  for (const t of ['burglaries by county', 'burglaries by county', 'retail by county']) await data.searchSources(t);
  const rows = plain(await data.dataGapsByNeed(365));
  assert.deepEqual(rows.map(r => [r.asks, r.reason]), [[2, 'no_such_data'], [1, 'exists_not_runnable_yet']]);
  assert.ok(rows.every(r => !('request_text' in r)));                                  // counts carry no words
  const texts = plain(await data.dataGapRequests(rows[0].need_key));
  assert.deepEqual(texts.map(t => t.request_text), ['burglaries by county', 'burglaries by county']);
  assert.equal(await data.myDataRequestCount(), 3);
  assert.equal(await data.deleteMyDataRequests(), 3);
  assert.equal(await data.myDataRequestCount(), 0);
});

test('without the SQL the request count is null (the account section stays hidden)', async () => {
  const client = createFakeClient();
  const from = client.from;
  client.from = t => (t === 'data_gaps' ? { select: async () => ({ data: null, error: { message: 'relation "data_gaps" does not exist' } }) } : from(t));
  assert.equal(await ryagramData(client).myDataRequestCount(), null);
});
