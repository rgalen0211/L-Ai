// CLOUD-SITE 11-02 round 3 (task 5): the bug Ryan saw tonight. dataset_info printed "(per 100k, , rate)" for the restaurants measure of state_obesity_fastfood: the engine's record
// has an empty role there, and 12 other measures have an empty kind, which printed "(..., banded, )". The record is vendored byte for byte from ENGINE, so the words are fixed,
// not the data: an empty field is left out. These cases fail on the old formatter (tools.ts datasetInfoText) and pass on the fixed one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { datasetInfoText } from '../supabase/functions/connect-core/tools.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import datasetInfo from '../supabase/functions/_shared/dataset_info.ts';

const A = { tokenHash: 'h', userId: 'u', clientId: 'c' };
const call = async (args) => { const w = new FakeWorld(); w.addUser('u', 'a@example.test', 5); w.invite('u', 'c'); return callTool('dataset_info', args, A, { data: w.data('u'), policy: w.policy(), deps: { compile: makeCompile(Ajv2020) } }); };
const EMPTY_FIELD = /\(\s*,|,\s*,|,\s*\)|\(\s*\)/;

test('MUST FAIL (bug): the restaurants measure reads "(per 100k, rate)", with no empty field', async () => {
  const r = await call({ dataset_id: 'state_obesity_fastfood' });
  assert.equal(r.isError, undefined, r.text);
  assert.match(r.text, /Limited-service restaurants per 100,000 residents \(per 100k, rate\)/);
  assert.doesNotMatch(r.text, /per 100k, , rate/);
  assert.equal(r.data.dataset.measures.find((m) => m.id === 'restaurants_per_100k').role, '', 'the engine\'s record itself is unchanged (vendored byte for byte)');
});

test('MUST FAIL (bug): no dataset\'s words carry an empty field anywhere (13 of 117 measures have an empty role or kind)', () => {
  const bad = [];
  for (const d of datasetInfo.datasets) {
    const { text } = datasetInfoText(d, true);
    for (const line of text.split('\n')) if (EMPTY_FIELD.test(line)) bad.push(`${d.id}: ${line.slice(0, 160)}`);
  }
  assert.deepEqual(bad, []);
});

test('the fields that ARE there are all kept, in order; a missing unit still says "no unit"', () => {
  const d = (measures) => ({ id: 'x', label: 'X', topic: 't', source: 's', sources: [], licence: 'l', url: 'https://x.example', source_line: '', vintage: '', notes: '',
    periods: { from: '2000', to: '2001', cadence: 'annual', known_gaps: {} }, geography: { id: 'g', noun: 'states', label: 'States', kind: 'k', shape: 's', time_varying: false, adoptions: {} },
    measures, views: ['map'], missing_data: { absence_is_ambiguous: false, label: '', phrase: '', note: '', excluded_label: '' }, method_breaks: [] });
  const line = (m) => datasetInfoText(d([m]), true).text.split('\n').find((l) => l.startsWith('Measures:'));
  assert.equal(line({ label: 'A', unit: '%', role: 'banded', kind: 'share' }), 'Measures: A (%, banded, share).');
  assert.equal(line({ label: 'A', unit: '%', role: 'banded', kind: '' }), 'Measures: A (%, banded).');
  assert.equal(line({ label: 'A', unit: 'per 100k', role: '', kind: 'rate' }), 'Measures: A (per 100k, rate).');
  assert.equal(line({ label: 'A', unit: '', role: 'path', kind: '' }), 'Measures: A (no unit, path).');
  assert.equal(line({ label: 'A', unit: '', role: '', kind: '' }), 'Measures: A (no unit).');
});
