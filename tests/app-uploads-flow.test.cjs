// The upload path through the data layer against the fake client: slot, file, read, confirm, use, delete.
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
const U = load('app-uploads.js').ryagramUploads;
const plain = v => JSON.parse(JSON.stringify(v));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const CSV = 'State,Year,Jobs\nAlabama,2019,100\nAlabama,2020,110\nTexas,2019,900\nTexas,2020,950\n';
function world() {
  const client = createFakeClient({ uploadReadMs: 5 });
  const pid = client.newId(), vid = client.newId();
  client.db.projects.push({ id: pid, title: 'p', created_at: client.now(), updated_at: client.now(), archived_at: null });
  client.db.versions.push({ id: vid, project_id: pid, number: 1, state: 'draft', story_spec: { sequence: { clips: [{ kind: 'render', dataset: 'state_obesity_fastfood', view: 'map' }] } }, dataset_id: null });
  return { client, data: ryagramData(client), vid };
}
const up = (data, body = CSV, name = 'jobs.csv') => {
  const file = new File([body], name);
  const check = U.checkFile(file);
  return data.startUpload(file, { label: check.label, ext: check.ext, contentType: U.MIME[check.ext], retention: 'dont_keep' });
};

test('a csv goes in, is read, confirmed and used, and the type sent is ours, not the browser’s guess', async () => {
  const { client, data, vid } = world();
  const id = await up(data);
  assert.deepEqual(client.log.filter(l => l.upload).map(l => [l.bucket, l.type]), [['ryagram-uploads', 'text/csv']]);
  let [row] = await data.listUploads();
  assert.deepEqual([row.id, U.chip(row, row.ingest).key, row.retention], [id, 'reading', 'dont_keep']);
  await sleep(30);
  [row] = await data.listUploads();
  assert.equal(U.chip(row, row.ingest).key, 'check');
  const m = U.draft(row.ingest_report);
  assert.equal(U.problem(m, row.ingest_report), '');
  await data.confirmMapping(id, U.clean(m));
  [row] = await data.listUploads();
  assert.equal(U.chip(row, row.ingest).key, 'ready');
  const ref = await data.attachUpload(vid, id);
  assert.match(ref, /^u_[0-9a-f]{24}$/);
  const story = U.useInStory(client.db.versions[0].story_spec, ref);
  assert.equal(story.sequence.clips[0].dataset, ref);
  client.db.versions[0].story_spec = story;
  const sources = plain(await data.syncSources(vid));
  assert.deepEqual(sources.map(s => [s.kind, s.dataset_ref, s.publisher]), [['upload', ref, 'Your data']]);
  assert.match(sources[0].coverage, /2019 to 2020/);
  await data.deleteUpload(id);
  assert.deepEqual(plain(await data.listUploads()), []);
  assert.equal(client.db.versions[0].dataset_id, null);
});

test('files that can’t be used say why in the worker’s words, and a story naming someone else’s data is refused', async () => {
  const { client, data, vid } = world();
  await up(data, 'just some words', 'notes.csv');
  await up(data, 'a,b\n1,2\n', 'tiny.xlsx');
  await sleep(30);
  const rows = await data.listUploads();
  assert.deepEqual(rows.map(r => U.chip(r, r.ingest).key), ['failed', 'failed']);
  assert.match(U.chip(rows[1], rows[1].ingest).detail, /table|reader/i);
  const wide = await up(data, 'State,2019,2020,2021\nAlabama,1,2,3\n', 'wide.csv');
  await sleep(30);
  const [w] = (await data.listUploads()).filter(r => r.id === wide);
  assert.equal(U.draft(w.ingest_report), null);
  await assert.rejects(data.confirmMapping(wide, { place_index: 0 }), /years across the columns/);
  await assert.rejects(data.attachUpload(vid, wide), /Confirm what the columns mean/);
  client.db.versions[0].story_spec = { sequence: { clips: [{ kind: 'render', dataset: 'u_' + 'a'.repeat(24) }] } };
  await assert.rejects(data.syncSources(vid), /isn't ready, or isn't yours/);
});

test('an upload that never arrives leaves nothing behind, and a locked film can’t take new data', async () => {
  const { client, data, vid } = world();
  const storage = client.storage.from;
  client.storage.from = () => ({ ...storage('ryagram-uploads'), upload: async () => ({ data: null, error: { message: 'network' } }) });
  await assert.rejects(up(data), /didn.t upload/);
  assert.deepEqual(plain(await data.listUploads()), []);
  client.storage.from = storage;
  const id = await up(data);
  await sleep(30);
  await data.confirmMapping(id, U.clean(U.draft((await data.listUploads())[0].ingest_report)));
  client.db.versions[0].state = 'complete';
  await assert.rejects(data.attachUpload(vid, id), /can't change its data/);
});

test('when the SQL isn’t applied the panel has nothing to show', async () => {
  const { client, data } = world();
  const from = client.from;
  const chain = { select: () => chain, eq: () => chain, is: () => chain,
                  order: async () => ({ data: null, error: { message: 'column datasets.filename_label does not exist' } }) };
  client.from = table => (table === 'datasets' ? chain : from(table));
  assert.equal(await data.listUploads(), null);
});

test('the limits are enforced the way the database does', async () => {
  const { data } = world();
  await assert.rejects(data.startUpload({ size: 11 * 1024 * 1024 }, { label: 'big.csv', ext: 'csv', contentType: 'text/csv' }), /10 MB/);
  await assert.rejects(data.startUpload({ size: 5 }, { label: 'a.exe', ext: 'exe', contentType: 'x' }), /\.csv, \.tsv/);
  for (let i = 0; i < 20; i++) await up(data, CSV, `f${i}.csv`);
  await assert.rejects(up(data, CSV, 'one-too-many.csv'), /up to 20/);
});
