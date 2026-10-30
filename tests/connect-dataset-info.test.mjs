// dataset_info (NEXT-CONNECT 158, PUNCH P6 connector half): a read-only tool that serves ENGINE's per-dataset records (docs/dataset-info.json, vendored byte for byte) so the person's AI can say what a dataset really covers.
// The tool uses no database at all: the test hands it a data layer that throws if anything touches it. tests/connect_dataset_info_mutants.mjs proves each must-fail by breaking the code or the vendored file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { TOOLS, datasetInfoText } from '../supabase/functions/connect-core/tools.ts';
import { toolList } from '../supabase/functions/connect-core/mcp.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { DATASETS } from '../supabase/functions/_shared/templates.ts';
import datasetInfoModule from '../supabase/functions/_shared/dataset_info.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
const SHARED = 'supabase/functions/_shared/';
const records = JSON.parse(fs.readFileSync(SHARED + 'dataset-info.json', 'utf8')).datasets;

function world() {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100); w.invite(A.userId, A.clientId);
  // a data layer that throws if the tool touches it: dataset_info reads the vendored records and nothing else
  const touched = new Proxy({}, { get() { throw new Error('dataset_info touched the database'); } });
  const env = { data: touched, policy: w.policy(), deps: { compile } };
  return { call: (name, args) => callTool(name, args, A, env) };
}
const usableId = records.map((r) => r.id).find((id) => Object.prototype.hasOwnProperty.call(DATASETS, id));
const unusableId = records.map((r) => r.id).find((id) => !Object.prototype.hasOwnProperty.call(DATASETS, id));

test('dataset_info is listed read-only and takes only a dataset id', () => {
  const t = toolList().find((x) => x.name === 'dataset_info');
  assert.ok(t, 'listed');
  assert.equal(t.annotations.readOnlyHint, true); assert.equal(t.annotations.destructiveHint, false);
  assert.deepEqual(Object.keys(t.inputSchema.properties), ['dataset_id']); assert.deepEqual(t.inputSchema.required, ['dataset_id']);
  assert.equal(TOOLS.find((x) => x.name === 'dataset_info').scope, 'read');
  assert.ok(!/call it first|you must|read it before/i.test(t.description));
});

test('a county dataset: the record is returned whole, with years, area changes, measures, licence and the CT adoption year', async () => {
  const { call } = world();
  const r = await call('dataset_info', { dataset_id: 'bea_cainc1_county_income_index' });
  assert.ok(!r.isError, r.text);
  assert.deepEqual(r.data.dataset, records.find((x) => x.id === 'bea_cainc1_county_income_index'));
  assert.match(r.text, /<untrusted source="dataset-info">/);
  assert.match(r.text, /Years: 1969 to 2024, annual/);
  assert.match(r.text, /Licence: U\.S\. Government work, public domain/);
  assert.match(r.text, /Changes to the areas: \d+ declared/);
  assert.match(r.text, /ct_planning_regions from 2024/);
  assert.match(r.text, /Measures: Per capita personal income/);
  assert.match(r.text, /Views it can be drawn as: map/);
  assert.match(r.text, /Method breaks: \d+/);
});

test('it says whether set_story accepts the dataset today, from the connector\'s own catalog', async () => {
  const { call } = world();
  assert.ok(usableId && unusableId, 'the test needs one of each');
  const yes = await call('dataset_info', { dataset_id: usableId });
  assert.equal(yes.data.usable_in_story, true); assert.match(yes.text, /can be drawn in a story today/);
  const no = await call('dataset_info', { dataset_id: unusableId });
  assert.equal(no.data.usable_in_story, false); assert.match(no.text, /NOT in the catalog/);
});

test('MUST-FAIL: a dataset with no source address is flagged as a known problem, not hidden (ENGINE\'s finding fhwa_hm212)', async () => {
  const { call } = world();
  const r = await call('dataset_info', { dataset_id: 'fhwa_hm212' });
  assert.ok(!r.isError, r.text);
  assert.ok(r.data.problems.some((p) => /no source address/.test(p)));
  assert.match(r.text, /Known problem: This dataset has no source address/);
  const fine = await call('dataset_info', { dataset_id: 'bea_cainc1_county_income_index' });
  assert.deepEqual(fine.data.problems, []);
});

test('MUST-FAIL: an unknown id is refused in words with close ids and a pointer, and a bad id is refused before it is looked up', async () => {
  const { call } = world();
  const near = await call('dataset_info', { dataset_id: 'bea_cainc1' });
  assert.equal(near.isError, true); assert.equal(near.code, 'not_found'); assert.match(near.text, /Close ids: bea_cainc1_county_income_index/); assert.match(near.text, /get_story_schema/);
  const far = await call('dataset_info', { dataset_id: 'no_such_thing' });
  assert.equal(far.isError, true); assert.equal(far.code, 'not_found'); assert.doesNotMatch(far.text, /Close ids/);
  for (const bad of ['Bad Id!', '../x', 'A'.repeat(101), '', 7, null]) {
    const r = await call('dataset_info', { dataset_id: bad });
    assert.equal(r.isError, true, JSON.stringify(bad)); assert.equal(r.code, 'args', JSON.stringify(bad));
  }
  assert.equal((await call('dataset_info', {})).isError, true);
  assert.equal((await call('dataset_info', { dataset_id: usableId, owner: 'u-bob' })).isError, true);
});

test('it reads nothing from the database (the data layer would throw) and a big record stays small', async () => {
  const { call } = world();
  const biggest = records.reduce((a, b) => (JSON.stringify(b).length > JSON.stringify(a).length ? b : a));
  const r = await call('dataset_info', { dataset_id: biggest.id });
  assert.ok(!r.isError, r.text);
  assert.ok(r.text.length < 12000, `text of ${r.text.length} characters`);
});

test('every one of the catalog records is described, and says what it must (the text builder directly: the dispatcher rations calls)', () => {
  for (const rec of records) {
    const { text } = datasetInfoText(rec, true);
    assert.ok(text.includes(rec.label) && text.includes('Years: ' + rec.periods.from + ' to ' + rec.periods.to) && text.includes('Measures: '), rec.id);
  }
});

test('THE VENDORED FILES: dataset-info.json is ENGINE\'s file byte for byte (its SHA-256 is the one recorded), the TS module holds exactly its data, and there are 106 unique records', () => {
  const src = fs.readFileSync(SHARED + 'dataset-info.source.txt', 'utf8');
  const sha = /^sha256 ([0-9a-f]{64})$/m.exec(src)?.[1];
  assert.ok(sha, 'the source note carries a SHA-256');
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(SHARED + 'dataset-info.json')).digest('hex'), sha);
  assert.match(src, /^engine_commit [0-9a-f]{8,40}$/m);
  assert.deepEqual(datasetInfoModule, JSON.parse(fs.readFileSync(SHARED + 'dataset-info.json', 'utf8')));
  assert.equal(records.length, 106); assert.equal(JSON.parse(fs.readFileSync(SHARED + 'dataset-info.json', 'utf8')).count, records.length);
  assert.equal(new Set(records.map((r) => r.id)).size, records.length);
  for (const r of records) for (const k of ['id', 'label', 'periods', 'geography', 'measures', 'views', 'missing_data', 'method_breaks', 'licence', 'url']) assert.ok(k in r, r.id + ' lacks ' + k);
});
