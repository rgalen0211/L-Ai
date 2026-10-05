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
const S = load('app-sources.js').ryagramSources;
const ryagramData = load('app-data.js').ryagramData;
const plain = v => JSON.parse(JSON.stringify(v));

test('a card shows exactly what the row says, as plain text, with a dash for anything missing', () => {
  const c = plain(S.cardView({ title: 'Manufacturing share', publisher: 'U.S. Census Bureau', source_url: 'https://www.census.gov/x',
                               coverage: 'US state, 1998 to 2023', licence_short: 'Public domain', licence_full: 'U.S. Government work.', kind: 'catalog' }));
  assert.deepEqual(c, { title: 'Manufacturing share', publisher: 'U.S. Census Bureau', url: 'https://www.census.gov/x',
                        coverage: 'US state, 1998 to 2023', licenceShort: 'Public domain', licenceFull: 'U.S. Government work.', kind: 'catalog', noRedistribution: false });
  const empty = S.cardView({});
  assert.deepEqual([empty.title, empty.publisher, empty.coverage, empty.licenceShort, empty.url], [S.DASH, S.DASH, S.DASH, S.DASH, '']);
  assert.equal(S.cardView(null).title, S.DASH);
  // An upload says it is the person's data, and that they confirm the right to use it.
  const up = S.cardView({ title: 'My file', kind: 'upload' });
  assert.deepEqual([up.publisher, up.licenceShort, up.kind], ['Your data', 'You confirm you may use this data', 'upload']);
});

test('row text is untrusted: control characters stripped, links only https', () => {
  const c = S.cardView({ title: 'A\u202eB\u0000C  <b>x</b>', source_url: 'javascript:alert(1)', publisher: 'P', coverage: 'c', licence_short: 'l' });
  assert.equal(c.title, 'A B C <b>x</b>');            // kept as text; the page never uses innerHTML
  assert.equal(c.url, '');
  for (const bad of ['http://x.example/', 'data:text/html,hi', '//x.example', 'https://']) assert.equal(S.cardView({ source_url: bad }).url, '');
  assert.equal(S.cardView({ source_url: 'https://a.example/p?q=1' }).url, 'https://a.example/p?q=1');
});

test('the note says what the screen is, and when it is read-only', () => {
  assert.match(S.note({ editable: true, count: 0 }), /Start from an example film/);
  assert.match(S.note({ editable: true, count: 2 }), /Up to 5 sources per film, one clip each/);
  assert.match(S.note({ editable: false, count: 2 }), /finished, so its sources are fixed/);
  assert.equal(S.MAX, 5);
});

test('syncSources: rows follow the story; refusals read plainly; null when the SQL is not applied', async () => {
  const client = createFakeClient();
  const data = ryagramData(client);
  const { version } = await data.createProject('Film');
  const story = (...ids) => ({ schema: 1, engine: 'sequence', name: 's', sequence: { clips: ids.map(d => ({ kind: 'render', dataset: d, view: 'map' })) } });
  await data.saveStory(version.id, story('state_obesity_fastfood', 'bps_county_permits'));
  let rows = await data.syncSources(version.id);
  assert.deepEqual(rows.map(r => r.dataset_ref), ['state_obesity_fastfood', 'bps_county_permits']);
  assert.match(rows[0].licence_short, /public domain/);
  await data.saveStory(version.id, story('bps_county_permits'));
  assert.deepEqual((await data.syncSources(version.id)).map(r => r.dataset_ref), ['bps_county_permits']);
  await data.saveStory(version.id, story('cbp_retail_employment'));
  await assert.rejects(data.syncSources(version.id), /can't run it yet/);
  await data.saveStory(version.id, story('nope'));
  await assert.rejects(data.syncSources(version.id), /don't have data called/);
  await data.saveStory(version.id, story(...Array.from({ length: 6 }, (_, i) => `d${i}`)));
  await assert.rejects(data.syncSources(version.id), /up to 5 sources/);
  const old = ryagramData({ rpc: async () => ({ data: null, error: { message: 'Could not find the function public.sync_version_sources(p_version) in the schema cache', code: 'PGRST202' } }) });
  assert.equal(await old.syncSources('v'), null);
});

test('licence-restricted data says so on its card, only when the row says so', () => {
  assert.equal(S.cardView({ title: 'x', no_redistribution: true }).noRedistribution, true);
  for (const v of [false, 'true', 1, null, undefined]) assert.equal(S.cardView({ title: 'x', no_redistribution: v }).noRedistribution, false);
});
