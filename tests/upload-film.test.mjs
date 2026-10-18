// A film from the person's OWN upload (ENGINE-BYOD-GAPS.md, S3): describeUpload and compileUploadFilm, by the same compileFilm and
// the same rules as the catalog. Nothing here reads a file or a value: only the confirmed mapping and the worker's report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, STORY_SCHEMA } from '../supabase/functions/_shared/catalog_data.ts';
import { compileFilm, FilmError, COUNTY_CONTINUOUS_NOTICE } from '../supabase/functions/_shared/film.ts';
import { describeUpload, compileUploadFilm, mappingProblems, uploadRef, UploadError, UPLOAD_LICENCE, UPLOAD_SOURCE_LINE } from '../supabase/functions/_shared/upload_film.ts';
import { checkAgainst } from '../supabase/functions/_shared/schema_check.ts';
import { PRESETS } from '../supabase/functions/_shared/profile_data.ts';

const plain = x => JSON.parse(JSON.stringify(x));
const DS = '3f2b8a52-6c1e-4a7d-9b04-0d5e2a9c7f11';
const SENTINEL = 'ZZSAMPLEVALUEZZ';
const report = (over = {}) => ({
  format: 'csv', sha256: 'a'.repeat(64), rows: 480,
  columns: [
    { index: 0, header: 'County FIPS', kind: 'place', sample: [SENTINEL, '01003'] }, { index: 1, header: 'County', kind: 'text', sample: ['Baldwin County'] },
    { index: 2, header: 'State', kind: 'text', sample: ['AL'] }, { index: 3, header: 'Year', kind: 'period', sample: ['2016'] },
    { index: 4, header: 'Uninsured share (%)', kind: 'number', sample: ['5.0'] }],
  guess: { place_index: 0, period_index: 3, value_indexes: [4], geography: 'us_counties', cadence: 'annual', wide: false },
  periods: { first: '2016', last: '2023', count: 8 }, unmatched: { count: 2, names: [SENTINEL] }, state_column_index: 2, sheet: '', sheets: [], ...over,
});
const mapping = (over = {}) => ({ place_index: 0, period_index: 3, value_indexes: [4], geography: 'us_counties', cadence: 'annual', state_index: 2, banded_index: 4,
  measure_names: { 4: 'Uninsured share (%)' }, ...over });
const upload = (over = {}) => ({ dataset_id: DS, label: 'County uninsured share', status: 'approved', mapping: mapping(), ingest_report: report(), ...over });
const errs = (fn) => { try { fn(); return null; } catch (e) { assert.ok(e instanceof UploadError || e instanceof FilmError, String(e)); return e.errors; } };
const say = (fn) => (errs(fn) ?? []).join(' | ');

test('describeUpload: a confirmed county upload becomes a catalog-shaped entry made only of the mapping and the report counts', () => {
  const e = describeUpload(upload());
  assert.equal(e.id, 'u_3f2b8a526c1e4a7d9b040d5e');
  assert.equal(uploadRef(DS), e.id);
  assert.deepEqual([e.geography.id, e.geography.noun, e.period.from, e.period.to, e.period.cadence, e.window], ['us_counties', 'counties', '2016', '2023', 'annual', ['2016', '2023']]);
  assert.deepEqual(e.film_types, ['map', 'bars', 'line']);
  assert.equal(e.measures[0].label, 'Uninsured share (%)');
  assert.equal(e.status, 'usable'); assert.equal(e.licence, UPLOAD_LICENCE); assert.equal(e.source_line, UPLOAD_SOURCE_LINE);
  assert.match(e.notes, /2 places in your file are not on this map and are not drawn/);
  assert.ok(!JSON.stringify(e).includes(SENTINEL), 'no value, code or name from the file (a sample, an unmatched name) is copied into the entry');
  assert.ok(!JSON.stringify(e).includes('Baldwin'), 'nor a county name');
  assert.equal(describeUpload(upload({ ingest_report: report({ unmatched: { count: 1, names: [] } }) })).notes, '1 place in your file is not on this map and is not drawn.');
  assert.equal(describeUpload(upload({ ingest_report: report({ unmatched: { count: 0, names: [] } }) })).notes, '');
});

test("MUST-FAIL: an upload that is not confirmed, or whose mapping the SQL would refuse, cannot become a film (the SQL's own words)", () => {
  assert.match(say(() => describeUpload(upload({ status: 'pending' }))), /Confirm what your columns mean/);
  assert.match(say(() => describeUpload(upload({ status: undefined }))), /Confirm what your columns mean/);
  assert.match(say(() => describeUpload(upload({ ingest_report: report({ guess: { wide: true } }) }))), /years across the columns/);
  const bad = {
    'a key the SQL does not know': [{ axis: 1 }, /something unexpected/],
    'no place column': [{ place_index: undefined }, /Choose which column is the place/],
    'a geography that is not states or counties': [{ geography: 'world' }, /states or counties/],
    'a cadence that is not yearly or monthly': [{ cadence: 'weekly' }, /yearly or monthly/],
    'no value columns': [{ value_indexes: [] }, /1 to 8 columns/],
    'nine value columns': [{ value_indexes: [4, 5, 6, 7, 8, 9, 10, 11, 12] }, /1 to 8 columns/],
    'a column that is not in the file': [{ value_indexes: [9], banded_index: 9 }, /isn't in the file/],
    'one column used twice': [{ value_indexes: [3], banded_index: 3 }, /only be used for one thing/],
    'counties with no state': [{ state_index: undefined }, /County names need a state/],
    'a state that is not a state': [{ state_index: undefined, state: 'ZZ' }, /isn't a U\.S\. state/],
    'a main column that is not a value column': [{ banded_index: 0 }, /main column has to be one of the value columns/],
    'a measure name that is too long': [{ measure_names: { 4: 'x'.repeat(81) } }, /name needs 1 to 80 characters/],
    'a measure name for a column that is not a value column': [{ measure_names: { 2: 'Name' } }, /name needs 1 to 80 characters/],
  };
  for (const [name, [over, re]] of Object.entries(bad)) assert.match(say(() => describeUpload(upload({ mapping: mapping(over) }))), re, name);
  assert.equal(describeUpload(upload({ mapping: mapping({ state_index: undefined, state: 'AL' }) })).geography.id, 'us_counties', 'CONTROL: one chosen state is fine instead of a state column');
  // the periods must agree with the cadence the person confirmed, and be readable
  assert.match(say(() => describeUpload(upload({ mapping: mapping({ cadence: 'monthly' }) }))), /do not match the yearly or monthly choice/);
  assert.match(say(() => describeUpload(upload({ ingest_report: report({ periods: { first: '2023', last: '2016', count: 8 } }) }))), /periods could not be read/);
  assert.match(say(() => describeUpload(upload({ ingest_report: report({ periods: null }) }))), /periods could not be read/);
  assert.match(say(() => describeUpload(upload({ label: '' }))), /needs 1 to 80 characters/);
  assert.match(say(() => describeUpload(upload({ label: 'a‮b' }))), /control or invisible/);
  assert.match(say(() => describeUpload(upload({ dataset_id: 'not-a-uuid' }))), /not a dataset id/);
  assert.match(say(() => describeUpload(null)), /expected the upload's record/);
  assert.equal(mappingProblems(mapping(), report()).length, 0, 'control: the sound mapping has no problem');
});

test("compileUploadFilm: the same compileFilm and the same county rules; the story names u_<hex> and the worker's schema accepts it", () => {
  const up = upload();
  const r = compileUploadFilm({ film_type: 'map', title: 'Who has no health insurance?' }, up);
  assert.equal(r.story.sequence.clips[1].dataset, 'u_3f2b8a526c1e4a7d9b040d5e');
  assert.deepEqual(checkAgainst(STORY_SCHEMA, r.story), [], "the worker's own schema accepts the story");
  assert.match(r.story.notes, /Source: data supplied by the film's maker|Supplied by the person who made this film/);
  // a county look is parsed, validated, converted and told, exactly as for a catalog county dataset
  const solid = compileUploadFilm({ film_type: 'map', title: 'x', look: PRESETS['clean-light'] }, up);
  assert.equal(solid.story.sequence.style_overrides.choropleth.continuous, true);
  assert.deepEqual(solid.report.look.converted, [COUNTY_CONTINUOUS_NOTICE]);
  assert.match(say(() => compileUploadFilm({ film_type: 'map', title: 'x', look: JSON.stringify(PRESETS['wtds-classic']) }, up)), /too small to hatch/, 'a TEXT hatching look is refused');
  assert.match(say(() => compileUploadFilm({ film_type: 'map', title: 'x', look: PRESETS['wtds-classic'] }, up)), /too small to hatch/);
  const banded = plain(PRESETS['clean-light']); banded.look.ramp.continuous = false;
  assert.match(say(() => compileUploadFilm({ film_type: 'map', title: 'x', look: banded }, up)), /county map is drawn as continuous colour/);
  const slow = compileUploadFilm({ film_type: 'map', title: 'x', look: PRESETS['warm-documentary'] }, up);
  assert.ok(slow.report.warnings.some(w => /slow pacing/.test(w)), 'a slow look is told it will be shortened');
  // CONTROL: a STATE upload keeps its bands and may hatch
  const st = upload({ mapping: mapping({ geography: 'us_states', state_index: undefined }), ingest_report: report({ guess: { geography: 'us_states', wide: false } }) });
  const stFilm = compileUploadFilm({ film_type: 'map', title: 'x', look: PRESETS['wtds-classic'] }, st);
  assert.equal(stFilm.story.sequence.style_overrides.choropleth.mode, 'hatch');
  assert.notEqual(stFilm.story.sequence.style_overrides.choropleth.continuous, true);
  for (const type of ['bars', 'line']) assert.deepEqual(checkAgainst(STORY_SCHEMA, compileUploadFilm({ film_type: type, title: 'x' }, up).story), []);
  assert.match(say(() => compileUploadFilm({ film_type: 'paired', title: 'x' }, up)), /'paired' is not offered/);
  assert.match(say(() => compileUploadFilm({ film_type: 'map', title: 'x', axis: 'dynamic' }, up)), /unknown key 'axis'/);
  assert.match(say(() => compileUploadFilm({ film_type: 'map', title: 'x', measure: 'value' }, up)), /a story cannot choose it/);
  // years inside the span are honoured; outside are refused
  assert.deepEqual(compileUploadFilm({ film_type: 'map', title: 'x', years: { start: '2018', end: '2021' } }, up).report.window, { start: '2018', end: '2021' });
  assert.match(say(() => compileUploadFilm({ film_type: 'map', title: 'x', years: { start: '2010' } }, up)), /before this dataset's coverage/);
  assert.match(say(() => compileUploadFilm({ film_type: 'map', title: 'x', years: { end: '2030' } }, up)), /outside this dataset's coverage/);
});

test("MUST-FAIL: an upload film can name only that upload; a catalog film can never name an upload; another person's id is unreachable", () => {
  const up = upload();
  const id = describeUpload(up).id;
  assert.equal(compileUploadFilm({ dataset: id, film_type: 'map', title: 'x' }, up).story.sequence.clips[1].dataset, id, 'control: naming itself is fine');
  assert.match(say(() => compileUploadFilm({ dataset: 'bls_state_unemployment', film_type: 'map', title: 'x' }, up)), /is not this upload/, 'a catalog dataset');
  assert.match(say(() => compileUploadFilm({ dataset: 'u_' + 'f'.repeat(24), film_type: 'map', title: 'x' }, up)), /is not this upload/, "another person's upload id");
  assert.match(say(() => compileUploadFilm(null, up)), /must be an object/);
  // from the catalog side an upload id is simply not a dataset
  assert.match(say(() => compileFilm({ dataset: id, film_type: 'map', title: 'x' })), /is not in the catalog/);
  assert.ok(!CATALOG.some(e => /^u_/.test(e.id)), 'no upload is ever in the catalog');
  // an unconfirmed upload never reaches compileFilm
  assert.match(say(() => compileUploadFilm({ film_type: 'map', title: 'x' }, upload({ status: 'pending' }))), /Confirm what your columns mean/);
});

test('NOTHING OF THE FILE is in what compileUploadFilm returns: no sample, no unmatched name, no county name', () => {
  const r = compileUploadFilm({ film_type: 'map', title: 'My counties' }, upload());
  const blob = JSON.stringify(r);
  for (const s of [SENTINEL, 'Baldwin', '01003']) assert.ok(!blob.includes(s), `${s} must not appear`);
  assert.match(r.story.notes, /2 places in your file are not on this map/);
});
