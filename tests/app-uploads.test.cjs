const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-uploads.js'), 'utf8'), { window });
const U = window.ryagramUploads;
const plain = v => JSON.parse(JSON.stringify(v));

const report = (over = {}) => ({ columns: [{ header: 'State' }, { header: 'Year' }, { header: 'Jobs' }, { header: 'Rate' }],
  guess: { place_index: 0, period_index: 1, value_indexes: [2, 3], geography: 'us_states', cadence: 'annual', wide: false }, ...over });

test('a file is checked by name, size and type, with a plain reason', () => {
  const ok = U.checkFile({ name: 'C:\\Users\\me\\jobs 2020.CSV', size: 1000 });
  assert.deepEqual(plain(ok), { ok: true, ext: 'csv', label: 'jobs 2020.CSV', problem: '' });
  for (const [file, re] of [[{ name: 'a.pdf', size: 5 }, /\.csv, \.tsv, \.xlsx and \.ods/], [{ name: 'a.xls', size: 5 }, /Save it as \.xlsx/],
                            [{ name: 'a.xlsm', size: 5 }, /macros/], [{ name: 'a.csv', size: 0 }, /empty/], [{ name: 'a.csv', size: 11 * 1024 * 1024 }, /11 MB.*10 MB/],
                            [{ name: 'noext', size: 5 }, /\.csv/], [null, /Choose a file/]]) {
    const r = U.checkFile(file);
    assert.equal(r.ok, false, JSON.stringify(file));
    assert.match(r.problem, re);
  }
  assert.match(U.checkFile({ name: 'a.csv', size: 5 }, { count: 20 }).problem, /up to 20 uploaded/);
  assert.equal(U.checkFile({ name: 'a\u202etxt.csv', size: 5 }).label, 'a txt.csv');
});

test('the chip says where an upload is, and a failure shows the worker\u2019s plain sentence', () => {
  assert.equal(U.chip({ status: 'pending_validation' }).key, 'reading');
  assert.equal(U.chip({ status: 'pending_validation', ingest_report: {} }).key, 'check');
  assert.equal(U.chip({ status: 'approved' }).key, 'ready');
  assert.equal(U.chip({ status: 'approved', delete_requested_at: 'x' }).key, 'deleting');
  const f = U.chip({ status: 'rejected' }, { state: 'failed', error_detail: 'This isn\u2019t a table.\u0007' });
  assert.deepEqual([f.key, f.detail], ['failed', 'This isn\u2019t a table.']);
  assert.match(U.chip({ status: 'rejected' }, null).detail, /couldn\u2019t read/i);
});

test('the starting mapping is the reader\u2019s guess; a wide file has none', () => {
  const m = plain(U.draft(report({ state_column_index: null })));
  assert.deepEqual(m, { place_index: 0, period_index: 1, value_indexes: [2, 3], geography: 'us_states', cadence: 'annual',
                        measure_names: { 2: 'Jobs', 3: 'Rate' }, banded_index: 2 });
  assert.equal(U.draft(report({ guess: { wide: true } })), null);
  assert.equal(U.draft({}), null);
  assert.equal(plain(U.draft(report({ guess: { place_index: 0, period_index: 1, value_indexes: [2], geography: null, cadence: null, wide: false }, state_column_index: 3 }))).geography, 'us_states');
});

test('the same rules as the database give an instant answer', () => {
  const r = report();
  const base = () => plain(U.draft(r));
  assert.equal(U.problem(base(), r), '');
  assert.match(U.problem(null, r), /years across the columns/);
  const cases = [[{ value_indexes: [] }, /1 to 8/], [{ value_indexes: [9] }, /isn\u2019t in the file/], [{ period_index: 0 }, /only be used for one thing/],
                 [{ geography: 'us_counties' }, /need a state/], [{ geography: 'us_counties', state: 'ZZ' }, /isn\u2019t a U\.S\. state/],
                 [{ measure_names: { 2: '', 3: 'x' } }, /1 to 80/], [{ cadence: 'daily' }, /yearly or monthly/], [{ place_index: 'a' }, /which column is the place/]];
  for (const [over, re] of cases) assert.match(U.problem({ ...base(), ...over }, r), re, JSON.stringify(over));
  assert.equal(U.problem({ ...base(), geography: 'us_counties', state: 'TX' }, r), '');
});

test('what is sent has only the keys the database accepts', () => {
  const m = { ...plain(U.draft(report())), state: 'TX', junk: 1, banded_index: 9 };
  assert.deepEqual(plain(U.clean(m)), { place_index: 0, period_index: 1, value_indexes: [2, 3], geography: 'us_states', cadence: 'annual', measure_names: { 2: 'Jobs', 3: 'Rate' } });
  const c = U.clean({ ...m, geography: 'us_counties', banded_index: 3 });
  assert.deepEqual([c.state, c.banded_index, 'junk' in c], ['TX', 3, false]);
  assert.equal('state' in U.clean({ ...m, geography: 'us_counties', state_index: 3, value_indexes: [2] }), false);
});
