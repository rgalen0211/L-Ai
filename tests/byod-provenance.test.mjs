// BYOD S5 scaffold (ENGINE-BYOD-GAPS.md gaps 2 and 3), behind byodGuide: who published the data, the licence or permission, the unit, the attestation. All sentences marked
// PLACEHOLDER are draft: Ryan's final wording is RYAN-QUEUE Q5. The page only COLLECTS and previews; the closing card and the video description are drawn by the engine (proposed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {};
for (const f of ['app-uploads.js', 'app-data.js', 'app-jobs.js']) vm.runInNewContext(read(`assets/${f}`), { window: win, setTimeout, clearTimeout });
const U = win.ryagramUploads;
const plain = x => JSON.parse(JSON.stringify(x));
const GOOD = { publisher: 'Census Bureau', link: 'https://example.gov/rents', licence: 'public_domain', licence_note: '', unit: 'dollars', decimals: 0, attested: true };

test('CLEAN: fields are trimmed, control and invisible characters removed, lengths capped, a made-up licence or decimals is dropped', () => {
  const c = U.cleanProvenance({ publisher: `  Census${String.fromCharCode(0x202e)} Bureau${String.fromCharCode(0)} `, link: 'x'.repeat(999), licence: 'made_up', licence_note: ' n ', unit: '  dollars  ', decimals: 9, attested: 'yes' });
  assert.equal(c.publisher, 'Census Bureau');
  assert.equal(c.link.length, 300);
  assert.equal(c.licence, '');
  assert.equal(c.decimals, 0);
  assert.equal(c.attested, false, 'only true is an attestation');
  assert.deepEqual(plain(U.cleanProvenance(null)), { publisher: '', link: '', licence: '', licence_note: '', unit: '', decimals: 0, attested: false });
});

test('PROBLEMS: each missing piece is named in words, in the order a person fills them; a good set is accepted', () => {
  assert.equal(U.provenanceProblem({}), 'Say who published or owns this data.');
  assert.match(U.provenanceProblem({ publisher: 'A' }), /what lets you use it/);
  assert.equal(U.provenanceProblem({ publisher: 'A', licence: 'other' }), 'Describe what lets you use this data.');
  assert.match(U.provenanceProblem({ publisher: 'A', licence: 'own_data' }), /what the numbers are in/);
  assert.match(U.provenanceProblem({ publisher: 'A', licence: 'own_data', unit: '%' }), /Tick the box/);
  assert.equal(U.provenanceProblem(GOOD), '');
  assert.equal(U.provenanceProblem({ ...GOOD, licence: 'other', licence_note: 'Emailed permission from the owner' }), '');
});

test('CARD PREVIEW: the lines the closing card will carry, including the as-supplied label (draft wording)', () => {
  const lines = U.provenanceCard(GOOD);
  assert.deepEqual(plain(lines), ['Source: Census Bureau (https://example.gov/rents)', 'Licence or permission: Public domain', 'Unit: dollars', 'Figures as supplied by the film’s maker; not checked by Ryagram.']);
  assert.equal(U.AS_SUPPLIED, lines[3]);
  assert.match(U.provenanceCard({ ...GOOD, licence: 'other', licence_note: 'Owner emailed me' })[1], /^Licence or permission: Owner emailed me$/);
  assert.match(U.provenanceCard({})[0], /Source: —/);
});

test('PLACEHOLDERS ARE MARKED: the attestation, the as-supplied label and the page note all carry the PLACEHOLDER mark so none can be mistaken for approved wording', () => {
  assert.match(U.PLACEHOLDER, /PLACEHOLDER WORDING, pending Ryan and the lawyer/);
  const lib = read('assets/app-library.js');
  assert.ok(lib.includes("`${U.PLACEHOLDER} Your film will show its source, and say the figures are yours.`"));
  assert.ok(lib.includes("U.ATTESTATION, ' ', h('span', { class: 'meta' }, U.PLACEHOLDER)"));
  const src = read('assets/app-uploads.js');
  assert.ok(src.includes('PLACEHOLDER: the closing-card and description label') && src.includes('RYAN-QUEUE Q5'));
});

test('DATA AND MOCK: the page sends the proposed set_dataset_provenance with exactly these arguments, the database side refuses a missing piece, and a dataset without it cannot be used in a film when that rule is on', async () => {
  const client = createFakeClient({ requireProvenance: true });
  const data = win.ryagramData(client);
  const made = await data.createProject('Rents');
  client.db.datasets.push({ id: 'd1', owner_id: 'u-ryan', source: 'upload', status: 'approved', name: 'rents.csv', filename_label: 'rents.csv', geography: 'us_states', mapping: { cadence: 'annual' },
                            ingest_report: { periods: { first: '2015', last: '2023' } }, retention: 'keep', deleted_at: null, delete_requested_at: null });
  await assert.rejects(data.attachUpload(made.version.id, 'd1'), /Say where this data comes from before using it in a film/);
  for (const [bad, re] of [[{ publisher: '' }, /who published/], [{ licence: 'nope' }, /what lets you use it/], [{ unit: '' }, /numbers are in/], [{ attested: false }, /may publish charts/]]) {
    await assert.rejects(data.setUploadProvenance('d1', { ...GOOD, ...bad }), re, JSON.stringify(bad));
  }
  await data.setUploadProvenance('d1', U.cleanProvenance(GOOD));
  const call = client.log.filter(l => l.rpc === 'set_dataset_provenance').pop();
  assert.deepEqual(plain(call.args), { p_dataset: 'd1', p_publisher: 'Census Bureau', p_link: 'https://example.gov/rents', p_licence: 'public_domain', p_licence_note: null, p_unit: 'dollars', p_decimals: 0, p_attested: true });
  assert.ok(await data.attachUpload(made.version.id, 'd1'), 'now it can be used');
});

test('FLAG AND GATING: only with byodGuide, "These are right" needs a complete provenance first and saves it before the mapping; the SQL it calls is a PROPOSAL named in one place', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /const provBox = byodGuideOn\(\) \? provenanceFields\(prov\) : null;/);
  assert.match(lib, /if \(provBox\) \{ const pp = U\.provenanceProblem\(prov\); if \(pp\) return showError\(note, new Error\(pp\)\); \}/);
  assert.ok(lib.indexOf('await data.setUploadProvenance(ds.id, U.cleanProvenance(prov));') < lib.indexOf('await data.confirmMapping(ds.id, U.clean(mapping)); await refresh();'), 'provenance first, then the mapping');
  const dataSrc = read('assets/app-data.js');
  assert.ok(dataSrc.includes("client.rpc('set_dataset_provenance', { p_dataset: datasetId, p_publisher: p.publisher, p_link: p.link || null, p_licence: p.licence, p_licence_note: p.licence_note || null, p_unit: p.unit, p_decimals: p.decimals, p_attested: p.attested === true })"));
  assert.match(read('assets/ryagram-config.js'), /byodGuide: false,/);
});
