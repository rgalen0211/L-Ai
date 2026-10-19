// Q6 (Ryan: yes): "these columns are years" for wide files, WEB's half of ENGINE's interface of 2026-10-18 12:36 (agreed): the worker melts the file in memory and reports the LONG columns,
// report.wide_groups lists the year-column groups and report.wide_chosen the default; the person ticks "These columns are years"; the mapping sent is the usual one plus melt_wide and wide_prefix.
// Behind byodGuide. The SQL check (mapping_ok) is a proposal to CC1; the mock implements the proposed rules so the page is tested end to end.
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

const LONG = { rows: 10, columns: [{ index: 0, header: 'State', kind: 'place', sample: ['Alabama'] }, { index: 1, header: 'period', kind: 'period', sample: ['2019'] }, { index: 2, header: 'Value', kind: 'number', sample: ['3'] }],
  guess: { place_index: 0, period_index: 1, value_indexes: [2], geography: 'us_states', cadence: 'annual', wide: true },
  wide_groups: [{ prefix: '', first: '2019', last: '2021', count: 3 }, { prefix: 'rent', first: '2015', last: '2023', count: 9 }], wide_chosen: 'rent', periods: { first: '2019', last: '2021', count: 3 } };

test('OFFERED: only a report that says it is wide AND lists groups gets the step; an old report (no groups) keeps the refusal', () => {
  assert.equal(U.wideOffered(LONG), true);
  assert.equal(U.wideGroups(LONG).length, 2);
  assert.equal(U.wideOffered({ ...LONG, wide_groups: undefined }), false);
  assert.equal(U.wideOffered({ ...LONG, guess: { ...LONG.guess, wide: false } }), false);
  assert.equal(U.draft({ ...LONG, wide_groups: undefined }, { wide: true }), null, 'old report: no draft, the page shows the old words');
  assert.equal(U.draft(LONG, { wide: false }), null, 'without byodGuide the old refusal');
  assert.match(U.groupLabel(LONG.wide_groups[0]), /^The year columns: 2019 to 2021 \(3 years\)$/);
  assert.match(U.groupLabel(LONG.wide_groups[1]), /^rent: 2015 to 2023 \(9 years\)$/);
});

test('DRAFT, PROBLEM AND CLEAN: the draft starts unticked on the default group; unticked is refused in words; clean sends melt_wide and wide_prefix and nothing else new; a long file sends neither', () => {
  const m = U.draft(LONG, { wide: true });
  assert.equal(m.melt_wide, false);
  assert.equal(m.wide_prefix, 'rent', 'the engine\'s wide_chosen');
  assert.equal(U.problem(m, LONG), 'Tick “These columns are years” to go on.');
  m.melt_wide = true;
  assert.equal(U.problem(m, LONG), '');
  const sent = U.clean(m);
  assert.equal(sent.melt_wide, true);
  assert.equal(sent.wide_prefix, 'rent');
  assert.deepEqual(Object.keys(sent).sort(), ['cadence', 'geography', 'measure_names', 'melt_wide', 'period_index', 'place_index', 'value_indexes', 'wide_prefix', 'banded_index'].sort());
  const longReport = { ...LONG, guess: { ...LONG.guess, wide: false }, wide_groups: undefined };
  const lm = U.draft(longReport, { wide: true });
  assert.ok(!('melt_wide' in lm) && !('melt_wide' in U.clean(lm)), 'a long file never sends melt_wide');
});

test('MOCK (the proposed SQL rules): a wide file needs the tick, melt_wide on a long file is refused, a prefix outside the report is refused, and a ticked wide file is accepted', async () => {
  const client = createFakeClient({ uploadReadMs: 5 });
  const data = win.ryagramData(client);
  const up = async (name, text) => { const r = await data.startUpload(new File([text], name, { type: 'text/csv' }), { label: name, ext: 'csv', contentType: 'text/csv', retention: 'keep' }); await new Promise(res => setTimeout(res, 60)); return client.db.datasets.at(-1); };
  const wideDs = await up('wide.csv', 'State,2019,2020,2021\nAlabama,1,2,3\nAlaska,4,5,6\nTexas,7,8,9\n');
  assert.equal(wideDs.ingest_report.guess.wide, true);
  assert.deepEqual(plain(wideDs.ingest_report.columns.map(c => c.header)), ['State', 'period', 'Value'], 'the report lists the LONG columns');
  assert.deepEqual(plain(wideDs.ingest_report.wide_groups), [{ prefix: '', first: '2019', last: '2021', count: 3 }]);
  const m = U.draft(wideDs.ingest_report, { wide: true });
  await assert.rejects(data.confirmMapping(wideDs.id, U.clean(m)), /Tick "These columns are years" and confirm/);
  m.melt_wide = true;
  await assert.rejects(data.confirmMapping(wideDs.id, { ...U.clean(m), wide_prefix: 'nope' }), /not one of the file/);
  await data.confirmMapping(wideDs.id, U.clean(m));
  assert.equal(wideDs.status, 'approved');
  const longDs = await up('long.csv', 'State,Year,Rent\nAlabama,2015,1\nAlabama,2016,2\nAlaska,2015,3\n');
  const lm = U.draft(longDs.ingest_report, { wide: true });
  await assert.rejects(data.confirmMapping(longDs.id, { ...U.clean(lm), melt_wide: true, wide_prefix: '' }), /does not have its years across the columns/);
});

test('PAGE: the tick and the group choice are drawn from the report only with byodGuide; the old refusal words are untouched; the group choice appears only for more than one group', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /const mapping = U\.draft\(report, \{ wide: byodGuideOn\(\) \}\);/);
  assert.match(lib, /const wideBox = mapping\.melt_wide === undefined \? null : \(\(\) => \{/);
  assert.match(lib, /const pick = groups\.length > 1 \? /);
  assert.ok(lib.includes("h('label', { class: 'choice' }, tick, h('span', {}, U.WIDE_TICK))"));
  assert.ok(lib.includes('byodGuideOn() ? U.WIDE_HELP : U.problem(null, report)'), 'the old words stay for old reports');
});

test('MORE THAN ONE GROUP (CC1 LOW-1): under the group choice the page says the example values come from the default choice and do not change when another group is picked', () => {
  const lib = read('assets/app-library.js');
  assert.ok(lib.includes("class: 'form-note wide-examples-note'"));
  assert.ok(lib.includes("The example values shown below are from the default choice ("));
  assert.ok(lib.includes("they stay as they are when you pick another group."));
  assert.match(lib, /const pick = groups\.length > 1 \? h\('div'[\s\S]*wide-examples-note[\s\S]*\) : null;/, 'only in the several-groups case');
});

