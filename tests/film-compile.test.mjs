// The guided builder's back end: catalog detail (server only) and compileFilm.
//
// Optional checks need the engine and Python; set RYAGRAM_ENGINE to an engine checkout (and RYAGRAM_SETUP to
// WORKER-SETUP.ps1) to run them. Without it they are reported SKIPPED, never passed:
//   - the story the function returns is accepted by the worker's own validate_story (the authority);
//   - the committed catalog_data.ts equals a fresh regeneration;
//   - tools/gen-catalog.py without --detail-out writes the two public outputs byte-for-byte as the previous script.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { CATALOG, STORY_SCHEMA, STORY_SCHEMA_SHA256, CATALOG_ENGINE } from '../supabase/functions/_shared/catalog_data.ts';
import { compileFilm, describeDataset, searchCatalog, latestPossible, FilmError, FILM_TYPES, COUNTY_CONTINUOUS_NOTICE, countySlowPacingNotice } from '../supabase/functions/_shared/film.ts';
import { checkAgainst } from '../supabase/functions/_shared/schema_check.ts';
import { DATASETS } from '../supabase/functions/_shared/templates.ts';
import { listableEntries, listableProblems, publicLeaks } from '../supabase/functions/_shared/catalog_rules.ts';
import { validateProfile, ProfileError } from '../supabase/functions/_shared/profile.ts';
import { contradiction } from '../supabase/functions/_shared/catalog_rules.ts';
import { PRESETS } from '../supabase/functions/_shared/profile_data.ts';

const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const plain = x => JSON.parse(JSON.stringify(x));
const refusedProfile = p => { try { validateProfile(p); return null; } catch (e) { assert.ok(e instanceof ProfileError); return e.errors; } };
const refused = (req, opts) => { try { compileFilm(req, opts); return null; } catch (e) { assert.ok(e instanceof FilmError, String(e)); return e.errors; } };
const usable = CATALOG.filter(e => e.status === 'usable');
// Rules about a dataset's SHAPE (geography, film types, method breaks) are tested on every listable dataset with its status forced to usable:
// the motion gate leaves only the measured ones usable, and these rules do not depend on that.
const ALL_USABLE = CATALOG.map(e => ({ ...e, status: 'usable' }));
const ENGINE = process.env.RYAGRAM_ENGINE, SETUP = process.env.RYAGRAM_SETUP;
const python = process.env.PYTHON || 'python';
const ALLOW = path.join(root, 'supabase', 'functions', '_shared', 'worker_allowlist.txt');
const LISTING = path.join(root, 'supabase', 'functions', '_shared', 'listing_decisions.json');
const SHARED = path.join(root, 'supabase', 'functions', '_shared');
const MOTION_RECORD = path.join(SHARED, 'motion_record.txt'), MOTION_BASELINE = path.join(SHARED, 'motion_baseline.txt'), MOTION_SKIP_OK = path.join(SHARED, 'motion_skip_named.txt');
const MOTION_ARGS = ['--motion', MOTION_RECORD, '--motion-baseline', MOTION_BASELINE, '--motion-skip-ok', MOTION_SKIP_OK];

// ------------------------------------------------------------------------------------------ the catalog

test('the detail catalog is well formed and lists no dataset the public catalog does not', () => {
  assert.match(CATALOG_ENGINE, /^[0-9a-f]{12}$/);
  assert.match(STORY_SCHEMA_SHA256, /^[0-9a-f]{64}$/);
  assert.ok(CATALOG.length > 60 && usable.length >= 20);
  assert.equal(new Set(CATALOG.map(e => e.id)).size, CATALOG.length);
  const pub = fs.readFileSync(path.join(root, 'assets', 'app-catalog-data.js'), 'utf8');
  const ids = [...pub.matchAll(/^   "id": "([a-z0-9_]+)"/gm)].map(m => m[1]);
  assert.ok(ids.length > 60);
  for (const e of CATALOG) {
    assert.match(e.id, /^[a-z0-9_]{1,64}$/);
    assert.ok(['usable', 'next', 'later'].includes(e.status), e.id);
    assert.ok(e.title && e.publisher && e.licence, `${e.id} needs a title, a publisher and a licence`);
    assert.ok(e.film_types.every(t => FILM_TYPES.includes(t)), e.id);
    assert.ok(e.film_types.length, `${e.id} offers no film type`);
    for (const m of e.measures) assert.ok(m.story_measure === null || ['rate', 'count'].includes(m.story_measure), e.id);
    assert.ok(e.period.from, e.id);
    assert.doesNotMatch(e.id, /^example_corp_|_fixture|^ryan_|lewis_clark|brooks_liscow|network/);   // fixtures and private data never
  }
  // every dataset of the public catalog is here
  for (const id of ids) assert.ok(CATALOG.some(e => e.id === id), `${id} is in the public catalog but not the detail`);
  // the dataset pins equal the templates' own
  for (const e of CATALOG) if (e.style) assert.deepEqual(e.style, DATASETS[e.id]?.style, `${e.id}: style pin differs from templates.ts`);
});

test('the detail file says it is generated, server-only, and names the schema it vendored', () => {
  const head = fs.readFileSync(path.join(root, 'supabase', 'functions', '_shared', 'catalog_data.ts'), 'utf8').split('\n').slice(0, 5).join('\n');
  assert.match(head, /GENERATED by tools\/gen-catalog\.py --detail-out, do not edit/);
  assert.match(head, /ryagram\/worker\/story\.schema\.json, sha256 [0-9a-f]{64}/);
  assert.match(head, /SERVER ONLY/);
  assert.ok(head.includes(STORY_SCHEMA_SHA256));
});

test('searchCatalog and describeDataset serve a server-side caller: bounded, no licence essays', () => {
  const hits = searchCatalog('unemployment', { usableOnly: true });
  assert.ok(hits.length && hits.length <= 25 && hits.every(h => h.status === 'usable'));
  assert.ok(searchCatalog('', { limit: 999 }).length <= 25);
  assert.deepEqual(searchCatalog('zzzz-no-such-thing'), []);
  const d = describeDataset('state_obesity_fastfood');
  assert.ok(d.measures.length >= 2 && d.film_types.includes('map'));
  assert.equal(d.licence, CATALOG.find(e => e.id === d.id).licence, 'one reader: the full licence comes from describeDataset (CC1)');
  assert.ok(d.source_line && d.listable_class);
  assert.equal(describeDataset('nope'), null);
});

// ------------------------------------------------------------------------------------------ compile

test('every usable dataset compiles in every film type it offers, and the worker schema accepts the story', () => {
  let n = 0;
  for (const e of usable) {
    for (const ft of e.film_types) {
      const { story, report } = compileFilm({ dataset: e.id, film_type: ft, title: `Test film ${e.id}` });
      assert.deepEqual(checkAgainst(STORY_SCHEMA, story), [], `${e.id} ${ft}`);
      assert.equal(story.sequence.clips[1].dataset, e.id);
      assert.equal(story.sequence.clips[1].view, ft);
      assert.ok(story.notes.includes(e.publisher) && story.notes.includes(e.id), 'sources are recorded in the notes');
      assert.equal(report.dataset.id, e.id);
      assert.ok(report.window.start <= report.window.end);
      n++;
    }
  }
  assert.ok(n >= 40, `compiled ${n} combinations`);
});

test('bar races leave the hold to the engine (the view default), and set the fixed axis', () => {
  const { story } = compileFilm({ dataset: 'cbp_manufacturing_share_state', film_type: 'bars', title: 'Manufacturing' });
  assert.equal(story.sequence.hold_seconds, undefined);
  assert.deepEqual(story.sequence.clips[1].settings, { top_n: 10, axis: 'fixed' });
});

test('measure: a selectable measure sets the story measure; unselectable and unknown are refused with the choices', () => {
  const e = usable.find(x => x.measures.some(m => m.story_measure === 'count') && x.measures.some(m => m.story_measure === 'rate'));
  assert.ok(e, 'some usable dataset offers both rate and count');
  const count = e.measures.find(m => m.story_measure === 'count');
  const r = compileFilm({ dataset: e.id, film_type: e.film_types[0], title: 'Counts', measure: count.id });
  assert.equal(r.story.sequence.clips[1].settings.measure, 'count');
  assert.equal(r.report.measure.id, count.id);
  const blocked = usable.flatMap(x => x.measures.filter(m => m.story_measure === null).map(m => [x, m]))[0];
  if (blocked) {
    const err = refused({ dataset: blocked[0].id, film_type: blocked[0].film_types[0], title: 'x', measure: blocked[1].id });
    assert.match(err.join(), /a story cannot choose it/);
  }
  assert.match(refused({ dataset: e.id, film_type: e.film_types[0], title: 'x', measure: 'nope' }).join(), /is not a measure of/);
});

test('years: defaults, monthly years, bounds and order are checked', () => {
  const monthly = usable.find(x => x.period.cadence === 'monthly');
  const r = compileFilm({ dataset: monthly.id, film_type: monthly.film_types[0], title: 'M', years: { start: '2019', end: '2020' } });
  assert.deepEqual([r.report.window.start, r.report.window.end], ['2019-01', '2020-12']);
  assert.match(refused({ dataset: monthly.id, film_type: monthly.film_types[0], title: 'x', years: { start: '1800' } }).join(), /before this dataset's coverage/);
  assert.match(refused({ dataset: monthly.id, film_type: monthly.film_types[0], title: 'x', years: { start: '2020', end: '2019' } }).join(), /after end/);
  const annual = usable.find(x => x.period.cadence === 'annual' && x.period.to);
  assert.match(refused({ dataset: annual.id, film_type: annual.film_types[0], title: 'x', years: { start: '2019-03' } }).join(), /not a year/);
  assert.match(refused({ dataset: annual.id, film_type: annual.film_types[0], title: 'x', years: { end: String(Number(annual.period.to) + 1) } }).join(), /outside this dataset's coverage/);
  assert.match(refused({ dataset: annual.id, film_type: annual.film_types[0], title: 'x', years: 'all' }).join(), /an object with start/);
});

test('MUST-FAIL: every way to ask for something the engine cannot honestly draw is refused, all reasons at once', () => {
  const e = usable[0];
  const ok = { dataset: e.id, film_type: e.film_types[0], title: 'A film' };
  assert.equal(refused(ok), null, 'control');
  const cases = {
    'unknown dataset': [{ ...ok, dataset: 'nope' }, /not in the catalog/],
    'a dataset the worker is not set up for': [{ ...ok, dataset: CATALOG.find(x => x.status !== 'usable').id }, /not usable yet/],
    'private data': [{ ...ok, dataset: 'ryan_anything' }, /not in the catalog/],
    'an unknown film type': [{ ...ok, film_type: 'pie' }, /is not one of/],
    'a film type the dataset does not offer (a NON-paired type: fhwa_hm212 is a line-only dataset, asked for a map)': [{ ...ok, dataset: 'fhwa_hm212', film_type: 'map' }, /'map' is not offered for fhwa_hm212; it offers line/, { catalog: ALL_USABLE }],
    'a paired film (its own refusal)': [{ ...ok, film_type: 'paired' }, /'paired' is not offered: a paired film needs keyframes_per_year/],
    'a subset of places': [{ ...ok, places: ['TX', 'CA'] }, /subset of places is not supported/],
    'a blank title': [{ ...ok, title: '   ' }, /must not be blank/],
    'a missing title': [{ dataset: ok.dataset, film_type: ok.film_type }, /title: required/],
    'an invisible character in the title': [{ ...ok, title: 'a\u202eb' }, /invisible characters/],
    'a title too long': [{ ...ok, title: 'x'.repeat(161) }, /longer than 160/],
    'an unknown key (a scale, an axis, a source)': [{ ...ok, axis: 'dynamic' }, /unknown key 'axis'/],
    'a domain': [{ ...ok, domain: [0, 1] }, /unknown key 'domain'/],
    'a no-data label': [{ ...ok, no_data_label: 'zero' }, /unknown key/],
    'a non-object': [null, /must be an object/],
  };
  for (const [name, [req, re, opts]] of Object.entries(cases)) {
    const errs = refused(req, opts);
    assert.ok(errs, `${name} should be refused`);
    assert.match(errs.join(' | '), re, name);
  }
  // several faults are all reported together
  const many = refused({ dataset: 'nope', film_type: 'pie', title: '', places: ['x'], axis: 1 });
  assert.ok(many.length >= 5, many.join(' | '));
});

test('a title with line-breaking text is flattened to one line; ordinary punctuation survives', () => {
  const { story } = compileFilm({ dataset: usable[0].id, film_type: usable[0].film_types[0], title: "Who's up?   Who's down - 2011 to 2023" });
  assert.equal(story.sequence.clips[0].headline, "Who's up? Who's down - 2011 to 2023");
  assert.match(story.name, /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/);
});

test('a window that crosses a method change warns and records it in the notes (unconditional: the dataset and the window are chosen to cross)', () => {
  const O = { catalog: ALL_USABLE };
  const e = ALL_USABLE.find(x => x.listable && x.id === 'bps_us_unit_mix');
  assert.ok(e && e.methodology_breaks.some(b => b.period === '2023'), 'bps_us_unit_mix has a method change at 2023');
  const crossing = compileFilm({ dataset: e.id, film_type: e.film_types[0], title: 'Across a break', years: { start: '2018', end: '2024' } }, O);
  assert.ok(crossing.report.window.start < '2023' && crossing.report.window.end >= '2023', 'the window crosses 2023');
  assert.ok(crossing.report.warnings.some(w => w.includes('2023')), 'warned');
  assert.ok(crossing.story.notes.includes('2023'), 'recorded');
  // CONTROL: a window that stops before the change is not warned about it
  const before = compileFilm({ dataset: e.id, film_type: e.film_types[0], title: 'Before the break', years: { start: '2015', end: '2020' } }, O);
  assert.ok(!before.report.warnings.some(w => /2023/.test(w)), 'a window before the break is not warned');
});

// ------------------------------------------------------------------------------------------ the look

test('the look is applied by the profile compiler and changes ONLY look fields (honesty is not modifiable)', () => {
  for (const e of [...usable.slice(0, 6), ...usable.filter(x => x.style)]) {
    const base = compileFilm({ dataset: e.id, film_type: e.film_types[0], title: 'Look test' });
    for (const id of Object.keys(PRESETS)) {
      if ((e.style?.choropleth?.continuous || (/counties/.test(e.geography.id) && e.film_types[0] === 'map')) && PRESETS[id].look?.ramp?.mode === 'hatch') {
        assert.match(refused({ dataset: e.id, film_type: e.film_types[0], title: 'Look test', look: PRESETS[id] }).join(), /too small to hatch/, `${e.id} ${id}`);
        continue;
      }
      const styled = compileFilm({ dataset: e.id, film_type: e.film_types[0], title: 'Look test', look: PRESETS[id] });
      assert.deepEqual(checkAgainst(STORY_SCHEMA, styled.story), [], `${e.id} ${id}`);
      assert.equal(styled.report.look.applied, true);
      const a = base.story, b = styled.story;
      assert.equal(b.notes, a.notes);
      assert.equal(b.name, a.name);
      for (const i of [0, 1]) {
        const ka = plain(a.sequence.clips[i]), kb = plain(b.sequence.clips[i]);
        for (const k of ['kind', 'id', 'dataset', 'view', 'start', 'end', 'settings', 'headline', 'subhead', 'seconds']) assert.deepEqual(kb[k], ka[k], `${e.id} ${id} clip ${i} ${k}`);
      }
      assert.ok(styled.report.look.changed.every(p => /^sequence\.(theme|canvas|fps|hold_seconds|style_overrides\.|clips\.\d+\.(transition|fade|align))/.test(p)), styled.report.look.changed.join());
    }
  }
});

test('render-proof finding: a hatching look on EVERY county-level map is refused (only one dataset was pinned, so the rest compiled and failed texture_carrying_capacity)', () => {
  // The county RULES are about the dataset's geography, not its measured status, so they are tested on every listable county dataset
  // with its status forced to usable (the gate would otherwise leave only two).
  const FORCED = CATALOG.map(e => ({ ...e, status: 'usable' }));
  const O = { catalog: FORCED };
  const counties = FORCED.filter(e => e.listable && /counties/.test(e.geography.id) && e.film_types.includes('map'));
  assert.ok(counties.length > 20, 'many usable county datasets');
  for (const e of counties) {
    assert.match(refused({ dataset: e.id, film_type: 'map', title: 'x', look: PRESETS['wtds-classic'] }, O).join(), /too small to hatch/, e.id);
    assert.equal(refused({ dataset: e.id, film_type: 'map', title: 'x', look: PRESETS['clean-light'] }, O), null, `control: a solid look compiles on ${e.id}`);
  }
  for (const e of counties) {
    const s = compileFilm({ dataset: e.id, film_type: 'map', title: 'x', look: PRESETS['clean-light'] }, O).story;
    assert.equal(s.sequence.style_overrides.choropleth.continuous, true, `${e.id}: a solid look on a county map is drawn as continuous colour (a banded one fails the 90 percent motion count)`);
    assert.equal(s.sequence.style_overrides.choropleth.mode, 'solid', e.id);
  }
  // The person is TOLD, in the compile result, before anything is rendered or paid for.
  for (const e of counties) {
    const r = compileFilm({ dataset: e.id, film_type: 'map', title: 'x', look: PRESETS['clean-light'] }, O);
    assert.deepEqual(r.report.look.converted, [COUNTY_CONTINUOUS_NOTICE], `${e.id}: the conversion is named in look.converted`);
    assert.ok(r.report.warnings.includes(COUNTY_CONTINUOUS_NOTICE), `${e.id}: and in warnings, where the looks page and the sheet read it`);
  }
  assert.match(COUNTY_CONTINUOUS_NOTICE, /continuous ramp, not as a few bands/);
  // A slow-paced look on a county map is told plainly that pacing will mostly shorten it (measured: 2 s per year left 76 of 100 windows still).
  for (const e of counties) {
    const w = compileFilm({ dataset: e.id, film_type: 'map', title: 'x', look: PRESETS['warm-documentary'] }, O);
    assert.ok(w.report.warnings.includes(countySlowPacingNotice(2)), `${e.id}: warm-documentary (2 s per year) is told its slow pacing is mostly shortened`);
    assert.ok(w.report.look.converted.includes(countySlowPacingNotice(2)), e.id);
    assert.equal(w.story.sequence.hold_seconds, 2, `${e.id}: the story still says 2 s (pacing happens at render; the data is untouched)`);
    const fast = compileFilm({ dataset: e.id, film_type: 'map', title: 'x', look: PRESETS['clean-light'] }, O);
    assert.ok(!fast.report.warnings.some(x => /slow pacing/.test(x)), `${e.id}: control: a look with no slow hold is not told`);
  }
  assert.match(countySlowPacingNotice(2), /mostly shortened so the film visibly moves/);
  const stSlow = compileFilm({ dataset: FORCED.find(e => e.listable && e.geography.id === 'us_states' && e.film_types.includes('map')).id, film_type: 'map', title: 'x', look: PRESETS['warm-documentary'] }, O);
  assert.ok(!stSlow.report.warnings.some(x => /slow pacing/.test(x)), 'control: a state map with the same look is not told (its hatched/banded film is judged by the frame count, not shortened)');
  const noLook = compileFilm({ dataset: counties[0].id, film_type: 'map', title: 'x' }, O);
  assert.ok(!noLook.report.warnings.includes(COUNTY_CONTINUOUS_NOTICE) && noLook.report.look.converted.length === 0, 'control: no look, no notice');
  const states = FORCED.find(e => e.listable && e.geography.id === 'us_states' && e.film_types.includes('map'));
  const stRes = compileFilm({ dataset: states.id, film_type: 'map', title: 'x', look: PRESETS['clean-light'] }, O);
  const st = stRes.story;
  assert.notEqual(st.sequence.style_overrides.choropleth.continuous, true, 'control: a state map is NOT forced continuous: it keeps its bands');
  assert.equal(st.sequence.style_overrides.choropleth.mode, 'solid');
  assert.ok(!stRes.report.warnings.includes(COUNTY_CONTINUOUS_NOTICE) && stRes.report.look.converted.length === 0, 'control: a state map is not told about a conversion that did not happen');
  assert.equal(refused({ dataset: states.id, film_type: 'map', title: 'x', look: PRESETS['wtds-classic'] }, O), null, 'control: a state map takes a hatching look');
  const bars = counties.find(e => e.film_types.includes('bars') && !e.style);
  assert.equal(refused({ dataset: bars.id, film_type: 'bars', title: 'x', look: PRESETS['wtds-classic'] }, O), null, 'a bar film does not hatch, so the look is fine there');
});

test('HIGH-2: a look sent as JSON TEXT gets every county rule too (parsed and validated first); MED-4: a banded county look is refused', () => {
  const O = { catalog: ALL_USABLE };
  const county = ALL_USABLE.find(e => e.listable && e.id === 'cbp_arts_establishments');
  const req = look => ({ dataset: county.id, film_type: 'map', title: 'x', look });
  // MUST-FAIL: the hatching look as a STRING was compiled with mode hatch before the fix
  assert.match(refused(req(JSON.stringify(PRESETS['wtds-classic'])), O).join(), /too small to hatch/, 'a string look is refused like an object look');
  assert.match(refused(req(JSON.stringify(PRESETS['print-mono'])), O).join(), /too small to hatch/);
  // the conversion and its notice reach a string look too
  const r = compileFilm(req(JSON.stringify(PRESETS['clean-light'])), O);
  assert.equal(r.story.sequence.style_overrides.choropleth.continuous, true, 'a string look is drawn continuous on a county map');
  assert.deepEqual(r.report.look.converted, [COUNTY_CONTINUOUS_NOTICE]);
  // CONTROL: the same string look on a state map is untouched
  const state = ALL_USABLE.find(e => e.listable && e.geography.id === 'us_states' && e.film_types.includes('map'));
  assert.equal(compileFilm({ dataset: state.id, film_type: 'map', title: 'x', look: JSON.stringify(PRESETS['wtds-classic']) }, O).story.sequence.style_overrides.choropleth.mode, 'hatch');
  // an invalid string look is refused with the profile's reasons, prefixed
  assert.match(refused(req('{not json'), O).join(), /look: profile is not valid JSON/);
  assert.match(refused(req(JSON.stringify({ ...PRESETS['clean-light'], axis: 1 })), O).join(), /look: .*unknown key 'axis'/);
  // MED-4: continuous false on a solid county look would be drawn banded with no notice
  const banded = plain(PRESETS['clean-light']);
  banded.look.ramp.continuous = false;
  assert.match(refused(req(banded), O).join(), /a county map is drawn as continuous colour/, 'object form');
  assert.match(refused(req(JSON.stringify(banded)), O).join(), /a county map is drawn as continuous colour/, 'string form');
  assert.equal(refused({ dataset: state.id, film_type: 'map', title: 'x', look: banded }, O), null, 'control: a state map may ask for bands');
  const barsFilm = ALL_USABLE.find(e => e.listable && /counties/.test(e.geography.id) && e.film_types.includes('bars') && !e.style);
  assert.equal(refused({ dataset: barsFilm.id, film_type: 'bars', title: 'x', look: banded }, O), null, 'control: a bar film does not draw the ramp');
});

test('MED-3: inherited keys (constructor, __proto__, hasOwnProperty, toString) are unknown keys, as in Python; LOWs: title length in code points, years must be text', () => {
  for (const key of ['constructor', '__proto__', 'hasOwnProperty', 'toString', 'valueOf']) {
    const p = JSON.parse(`{"profile_version":1,"name":"x","${key}":{"a":1}}`);
    assert.ok(Object.keys(p).includes(key), `${key} is an own key of the parsed profile`);
    assert.match((refusedProfile(p) ?? []).join(), new RegExp(`unknown key '${key}'`), key);
    const nested = JSON.parse(`{"profile_version":1,"name":"x","look":{"${key}":1}}`);
    assert.match((refusedProfile(nested) ?? []).join(), new RegExp(`unknown key '${key}'`), `look.${key}`);
  }
  assert.equal(refusedProfile({ profile_version: 1, name: 'ok' }), null, 'control');
  const e = usable[0];
  const emoji = '\u{1F600}'.repeat(100);              // 100 code points, 200 UTF-16 units
  assert.equal(refused({ dataset: e.id, film_type: e.film_types[0], title: emoji }), null, '100 emoji are 100 characters, under the 160 limit');
  assert.match(refused({ dataset: e.id, film_type: e.film_types[0], title: '\u{1F600}'.repeat(161) }).join(), /longer than 160/, 'MUST-FAIL: 161 emoji are too long');
  assert.match(refused({ dataset: e.id, film_type: e.film_types[0], title: 'x', years: { start: ['2019'] } }).join(), /expected a year or month as text/, 'MUST-FAIL: an array is not a year');
  assert.match(refused({ dataset: e.id, film_type: e.film_types[0], title: 'x', years: { end: { a: 1 } } }).join(), /expected a year or month as text/);
});

test('the BY-SA backstop (TypeScript and Python patterns) catches every spelling; ordinary prose is not caught', () => {
  const spellings = ['CC BY-SA 4.0', 'CC BY SA 4.0', 'CC BY\u2013SA 4.0', 'CC BY\u2011SA 4.0', 'Creative Commons Attribution-ShareAlike', 'Attribution Share Alike',
    'Share-Alike', 'an ODbL overlay', 'Open Database Licence', 'Open Database License 1.0'];
  const fine = ['U.S. Government work, public domain. The Census Bureau asks that the source be cited.', 'Public domain, 17 USC 105', 'CC BY 4.0', 'Sourced by Sarah, a statistician', 'Distributed by SAS'];
  for (const text of spellings) assert.ok(contradiction({ id: 'x', licence: `Public domain. ${text}`, notes: '' }), `TS: ${text}`);
  for (const text of fine) assert.equal(contradiction({ id: 'x', licence: `Public domain. ${text}`, notes: '' }), null, `TS control: ${text}`);
  const py = run(python, ['-c', [
    'import importlib.util,json,sys',
    `spec=importlib.util.spec_from_file_location('g', ${JSON.stringify(path.join(root, 'tools', 'gen-catalog.py'))})`,
    'm=importlib.util.module_from_spec(spec); sys.argv=["g"]; spec.loader.exec_module(m)',
    'bad=json.loads(sys.stdin.readline()); ok=json.loads(sys.stdin.readline())',
    'print(json.dumps([[t, bool(m.TRIPWIRE.search("Public domain. "+t))] for t in bad]+[[t, bool(m.TRIPWIRE.search(t))] for t in ok]))'].join('\n')],
    { input: JSON.stringify(spellings) + '\n' + JSON.stringify(fine) + '\n', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  assert.equal(py.status, 0, py.stderr);
  const got = JSON.parse(py.stdout);
  for (const [t, hit] of got.slice(0, spellings.length)) assert.equal(hit, true, `Python: ${t}`);
  for (const [t, hit] of got.slice(spellings.length)) assert.equal(hit, false, `Python control: ${t}`);
});

test('a bad look is refused with the profile reasons, prefixed; a look cannot carry a claim', () => {
  const e = usable[0];
  const ok = { dataset: e.id, film_type: e.film_types[0], title: 'x' };
  const bad = plain(PRESETS['clean-light']);
  bad.look.axis = 'dynamic';
  const errs = refused({ ...ok, look: bad });
  assert.match(errs.join(), /look: .*unknown key 'axis'/);
  assert.match(refused({ ...ok, look: { profile_version: 1, name: 'x', look: { ramp: { low: '#444444', high: '#4c4c4c' } } } }).join(), /look: .*apart/);
  assert.equal(refused({ ...ok, look: null }), null, 'no look is fine');
});

test('a county template pin survives a solid look and a hatching look is refused with the reason', () => {
  const e = CATALOG.find(x => x.style && x.status === 'usable');
  assert.ok(e, 'a usable dataset with a pinned style');
  const base = compileFilm({ dataset: e.id, film_type: e.film_types[0], title: 'County' });
  assert.deepEqual(base.story.sequence.style_overrides, e.style);
  assert.match(refused({ dataset: e.id, film_type: e.film_types[0], title: 'County', look: PRESETS['wtds-classic'] }).join(), /too small to hatch/);
  const solid = compileFilm({ dataset: e.id, film_type: e.film_types[0], title: 'County', look: PRESETS['clean-light'] });
  assert.equal(solid.story.sequence.style_overrides.choropleth.continuous, true, 'the pin survives a solid look');
  assert.equal(solid.story.sequence.style_overrides.choropleth.mode, 'solid');
});

test('the schema checker is not asleep: it refuses what the worker refuses', () => {
  const { story } = compileFilm({ dataset: usable[0].id, film_type: usable[0].film_types[0], title: 'x' });
  const bad = [
    s => { s.sequence.fps = 60; }, s => { s.sequence.clips[1].view = 'pie'; }, s => { s.sequence.surprise = 1; },
    s => { s.sequence.clips = []; }, s => { delete s.schema; }, s => { s.sequence.clips[0].fade = 9; },
    s => { s.sequence.clips[0] = { kind: 'title', seconds: 3 }; }, s => { s.notes = 'a\nb'; },
  ];
  for (const mut of bad) { const t = plain(story); mut(t); assert.ok(checkAgainst(STORY_SCHEMA, t).length, JSON.stringify(mut.toString())); }
  assert.deepEqual(checkAgainst(STORY_SCHEMA, story), [], 'control');
});

// ------------------------------------------------------------------------------------------ optional: the worker, the generator

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', ...opts });

test('the worker\'s own validate_story accepts every story this function returns', { skip: !ENGINE && 'RYAGRAM_ENGINE not set: SKIPPED, not passed' }, () => {
  const stories = [];
  for (const e of usable) for (const ft of e.film_types) {
    stories.push(compileFilm({ dataset: e.id, film_type: ft, title: `Worker check ${e.id}` }).story);
    stories.push(compileFilm({ dataset: e.id, film_type: ft, title: `Worker check ${e.id}`, look: PRESETS['bold-social'] }).story);
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'film-'));
  const f = path.join(tmp, 'stories.json');
  fs.writeFileSync(f, JSON.stringify(stories));
  const code = `import json,sys\nsys.path.insert(0, sys.argv[1])\nfrom ryagram.worker.schema import validate_story, Rejected\nbad=0\nfor s in json.load(open(sys.argv[2])):\n    ids={c['dataset'] for c in s['sequence']['clips'] if c['kind']=='render'}\n    try:\n        validate_story(s, datasets=ids)\n    except Rejected as e:\n        bad+=1; print('REFUSED', s['name'], str(e)[:200])\nprint('checked', len(json.load(open(sys.argv[2]))), 'refused', bad)\nsys.exit(1 if bad else 0)\n`;
  const r = run(python, ['-I', '-c', code, ENGINE, f]);
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /checked \d+ refused 0/);
});

// The engine checkout may hold untracked files (an ingested manifest is where a person's own data lives) and CRLF is
// what a normal Windows checkout makes of LF text. Both are handled: the test exports the COMMIT, and compares text
// with line endings normalised.
const lf = buf => Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
function exportCommit(dest) {
  fs.mkdirSync(dest, { recursive: true });
  const tf = path.join(dest, 'engine.tar');
  const tar = spawnSync('git', ['-C', ENGINE, 'archive', '--format=tar', '-o', tf, 'HEAD', 'ryagram'], { encoding: 'utf8' });
  assert.equal(tar.status, 0, String(tar.stderr));
  // Python's tarfile, not a system tar: a Windows path such as C:/x is read by GNU tar as a remote host.
  const code = ['import sys,tarfile', 't=tarfile.open(sys.argv[1])', 'try:', '    t.extractall(sys.argv[2], filter="data")',
    'except TypeError:', '    t.extractall(sys.argv[2])'].join(String.fromCharCode(10));
  const x = run(python, ['-I', '-c', code, tf, dest]);
  assert.equal(x.status, 0, x.stderr);
  fs.rmSync(tf);
  return dest;
}

test('the committed catalog_data.ts equals a fresh regeneration; the public outputs are byte-identical with and without --detail-out',
  { skip: (!ENGINE || !SETUP) && 'RYAGRAM_ENGINE / RYAGRAM_SETUP not set: SKIPPED, not passed' }, (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));      // cleaned up even when an assertion fails
  const tree = exportCommit(path.join(tmp, 'engine'));          // the same commit, whatever the checkout holds
  const commit = run('git', ['-C', ENGINE, 'rev-parse', '--short=12', 'HEAD']).stdout.trim();
  const mk = name => { for (const d of ['tools', 'assets', 'supabase']) fs.mkdirSync(path.join(tmp, name, d), { recursive: true });
    fs.copyFileSync(path.join(root, 'assets', 'app-templates.js'), path.join(tmp, name, 'assets', 'app-templates.js')); return path.join(tmp, name); };
  const A = mk('A'), B = mk('B');
  fs.copyFileSync(path.join(root, 'tools', 'gen-catalog.py'), path.join(A, 'tools', 'gen-catalog.py'));
  fs.copyFileSync(path.join(root, 'tools', 'gen-catalog.py'), path.join(B, 'tools', 'gen-catalog.py'));
  const args = (dir, extra) => [path.join(dir, 'tools', 'gen-catalog.py'), '--engine', tree, '--setup', SETUP, '--allowlist', ALLOW, ...MOTION_ARGS, '--listing', LISTING, '--commit', CATALOG_ENGINE, '--out', path.join(dir, 'assets', 'app-catalog-data.js'), ...extra];
  assert.equal(run(python, args(A, [])).status, 0);
  assert.equal(run(python, args(B, ['--detail-out', path.join(B, 'catalog_data.ts')])).status, 0);
  assert.ok(lf(fs.readFileSync(path.join(A, 'assets', 'app-catalog-data.js'))).equals(lf(fs.readFileSync(path.join(B, 'assets', 'app-catalog-data.js')))), 'public catalog differs with the flag');
  assert.ok(lf(fs.readFileSync(path.join(A, 'supabase', 'catalog_sources_seed.sql'))).equals(lf(fs.readFileSync(path.join(B, 'supabase', 'catalog_sources_seed.sql')))), 'seed differs with the flag');
  const committed = lf(fs.readFileSync(path.join(root, 'supabase', 'functions', '_shared', 'catalog_data.ts')));
  assert.ok(committed.equals(lf(fs.readFileSync(path.join(B, 'catalog_data.ts')))), 'catalog_data.ts is stale: regenerate it with tools/gen-catalog.py --detail-out');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('THE MOTION GATE: usable needs a pass/na line (or the baseline, or a skip Ryan named); no line and skip are NOT usable; fail is later',
  { skip: (!ENGINE || !SETUP) && 'RYAGRAM_ENGINE / RYAGRAM_SETUP not set: SKIPPED, not passed' }, (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-motion-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const tree = exportCommit(path.join(tmp, 'engine'));
  const ids = fs.readFileSync(ALLOW, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  const line = (id, m = 'pass') => `${id} motion=${m} paced=none engine=ba0e116 measured=2026-10-18`;
  const gen = (name, recordLines, baseline = [], skipOk = []) => {
    const d = path.join(tmp, name);
    for (const x of ['tools', 'assets', 'supabase']) fs.mkdirSync(path.join(d, x), { recursive: true });
    fs.copyFileSync(path.join(root, 'assets', 'app-templates.js'), path.join(d, 'assets', 'app-templates.js'));
    fs.copyFileSync(path.join(root, 'tools', 'gen-catalog.py'), path.join(d, 'tools', 'gen-catalog.py'));
    const w = (f, lines) => { const p = path.join(d, f); fs.writeFileSync(p, lines.join('\n') + '\n'); return p; };
    const r = run(python, [path.join(d, 'tools', 'gen-catalog.py'), '--engine', tree, '--setup', SETUP, '--allowlist', ALLOW, '--listing', LISTING,
      '--commit', CATALOG_ENGINE, '--motion', w('motion.txt', recordLines), '--motion-baseline', w('baseline.txt', baseline), '--motion-skip-ok', w('skipok.txt', skipOk),
      '--out', path.join(d, 'assets', 'app-catalog-data.js')]);
    return { r, pub: r.status === 0 ? fs.readFileSync(path.join(d, 'assets', 'app-catalog-data.js'), 'utf8') : '' };
  };
  const statusOf = (pub, id) => { const m = new RegExp(`"id": "${id}",[\\s\\S]*?"status": "([a-z]+)"`).exec(pub); return m && m[1]; };
  const listableAllow = ids.filter(i => CATALOG.find(e => e.id === i && e.listable));
  const [target, other, third, fourth] = listableAllow;
  const all = (m = 'pass') => ids.map(i => line(i, m));
  const control = gen('ctl', all());
  assert.equal(control.r.status, 0, control.r.stderr);
  assert.equal(statusOf(control.pub, target), 'usable', 'CONTROL: a measured pass is usable');
  assert.equal(statusOf(control.pub, 'cbp_arts_establishments'), 'usable', 'CONTROL: every allowlisted id with a pass line is usable');
  // MUST-FAIL: NO LINE = NOT USABLE (never usable by omission), and not on the baseline either
  const noLine = gen('noline', ids.filter(i => i !== target).map(i => line(i)));
  assert.equal(noLine.r.status, 0, noLine.r.stderr);
  assert.equal(statusOf(noLine.pub, target), 'next', 'MUST-FAIL: an allowlisted id with no motion line is NEXT, not usable');
  assert.equal(statusOf(noLine.pub, other), 'usable', 'and the measured ones are unaffected');
  // the baseline grandfathers ONLY an id with no line
  assert.equal(statusOf(gen('base', ids.filter(i => i !== target).map(i => line(i)), [target]).pub, target), 'usable', 'CONTROL: a baselined id with no line stays usable');
  assert.equal(statusOf(gen('basefail', [line(target, 'fail'), ...ids.filter(i => i !== target).map(i => line(i))], [target]).pub, target), 'later', 'MUST-FAIL: a measured FAIL beats the baseline');
  assert.equal(statusOf(gen('baseskip', [line(target, 'skip'), ...ids.filter(i => i !== target).map(i => line(i))], [target]).pub, target), 'next', 'MUST-FAIL: a measured SKIP beats the baseline');
  // skip is not a pass, unless Ryan names the dataset
  const skip = gen('skip', ids.map(i => line(i, i === target ? 'skip' : 'pass')));
  assert.equal(skip.r.status, 0, skip.r.stderr);
  assert.equal(statusOf(skip.pub, target), 'next', 'MUST-FAIL: a skip dataset is NOT usable');
  assert.equal(statusOf(gen('skipok', ids.map(i => line(i, i === target ? 'skip' : 'pass')), [], [target]).pub, target), 'usable', 'CONTROL: a skip dataset Ryan named is usable');
  assert.equal(statusOf(gen('skipother', ids.map(i => line(i, i === target ? 'skip' : 'pass')), [], [other]).pub, target), 'next', 'naming a different dataset does not rescue it');
  // fail is later, na is usable
  assert.equal(statusOf(gen('fail', ids.map(i => line(i, i === target ? 'fail' : 'pass'))).pub, target), 'later', 'MUST-FAIL: a fail dataset is later');
  assert.equal(statusOf(gen('na', ids.map(i => line(i, i === target ? 'na' : 'pass'))).pub, target), 'usable', 'na (nothing to measure) is usable');
  // refused outright
  assert.notEqual(gen('extra', [...all(), line('not_on_the_allowlist')]).r.status, 0, 'MUST-FAIL: a line for an id off the allowlist is refused');
  assert.notEqual(gen('twice', [...all(), line(target)]).r.status, 0, 'MUST-FAIL: two lines for one id are refused');
  assert.notEqual(gen('junk', [...all(), 'cbp_x motion=maybe paced=none engine=ba0e116 measured=2026-10-18']).r.status, 0, 'MUST-FAIL: an unparseable line is refused');
  assert.notEqual(gen('badbase', all(), ['Not An Id']).r.status, 0, 'MUST-FAIL: a baseline line that is not an id is refused');
  void third; void fourth;
});

test('the COMMITTED catalog obeys the gate: usable = baseline + measured pass/na + named skips, and nothing else; the seed agrees',
  () => {
  const rd = f => fs.readFileSync(path.join(SHARED, f), 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'));
  const baseline = new Set(rd('motion_baseline.txt')), skipNamed = new Set(rd('motion_skip_named.txt'));
  const rec = Object.fromEntries(rd('motion_record.txt').map(l => { const m = /^(\S+) motion=(\S+) /.exec(l); return [m[1], m[2]]; }));
  const allow = new Set(rd('worker_allowlist.txt').filter(l => !l.startsWith('#views')));
  const expected = new Set([...allow].filter(i => rec[i] === undefined ? baseline.has(i) : rec[i] === 'pass' || rec[i] === 'na' || (rec[i] === 'skip' && skipNamed.has(i))));
  assert.deepEqual(CATALOG.filter(e => e.status === 'usable').map(e => e.id).sort(), [...expected].sort());
  for (const i of allow) if (!expected.has(i)) assert.notEqual(CATALOG.find(e => e.id === i).status, 'usable', `${i} is not measured, so it is not usable`);
  assert.ok(!expected.has('cbp_arts_establishments'), 'the skip dataset is not usable until Ryan names it');
  // the live seed: runnable true exactly for the usable ones (about 60 rows must NOT flip on live)
  const seed = fs.readFileSync(path.join(root, 'supabase', 'catalog_sources_seed.sql'), 'utf8');
  const runnableIds = [...seed.matchAll(/\('([a-z0-9_]+)',[^\n]*?,\s*(true|false)\)/g)].filter(m => m[2] === 'true').map(m => m[1]);
  assert.deepEqual(runnableIds.sort(), [...expected].sort(), 'catalog_sources_seed.sql runnable = the gated usable set');
});

test('MUST-FAIL: an untracked INGESTED dataset in the engine checkout never reaches a catalog (privacy and determinism)',
  { skip: (!ENGINE || !SETUP) && 'RYAGRAM_ENGINE / RYAGRAM_SETUP not set: SKIPPED, not passed' }, (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-ing-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));      // cleaned up even when an assertion fails
  const repo = exportCommit(path.join(tmp, 'checkout'));
  const git = (...a) => run('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a]);
  assert.equal(git('init', '-q').status, 0);
  assert.equal(git('add', '-A').status, 0);
  assert.equal(git('commit', '-q', '-m', 'engine').status, 0);
  // a person's own ingested file: a manifest that is NOT committed
  const manifests = path.join(repo, 'ryagram', 'maprace', 'datasets', 'ingested', 'manifests');
  fs.mkdirSync(manifests, { recursive: true });
  const probe = 'zz_untracked_probe';
  fs.writeFileSync(path.join(manifests, `${probe}.json`), JSON.stringify({
    manifest_version: 1, id: probe, label: 'Probe, a persons own file (local)', topic: 'Local', cadence: 'annual', sheet: '',
    notes: 'untracked ingested probe', saved_at: '2026-10-17T00:00:00+00:00',
    mapping: { place_index: 0, period_index: 1, value_indexes: [2], geography: 'us_states', entity_kind: 'geographic', cadence: 'annual',
      melt_wide: false, wide_prefix: '', measure_names: { 2: 'Spend' }, banded_index: 2, counted_index: null },
    source: { kind: 'local', origin: 'probe.csv', format: 'csv', retrieved: '2026-10-17', size: 1, local: true }, file: 'samples/probe.csv',
    provenance: { local: true, file_name: 'probe.csv', publisher: '', license: 'Public domain', source_line: 'Source: local file', retrieved: '2026-10-17',
      match_rate: null, mapping: { place_column: 'a', period_column: 'b', value_column: 'c', geography: 'us_states', melted_wide: false }, rows_in: 1, rows_used: 1 },
    measures: [{ id: 'amount', label: 'Spend', unit: 'USD', role: 'banded' }] }));
  // CONTROL: the probe is real. The engine, imported from the working tree, lists it.
  const listing = 'import sys,json\nsys.path.insert(0, sys.argv[1])\nfrom ryagram.maprace import datasets as D\nprint(json.dumps([d["id"] for d in D.listing()]))';
  const ids = run(python, ['-I', '-c', listing, repo]);
  assert.equal(ids.status, 0, ids.stderr);
  assert.ok(JSON.parse(ids.stdout).includes(probe), 'control: the untracked manifest must be visible to the engine for this test to mean anything');
  const gen = (extra, outDir) => {
    for (const d of ['assets', 'supabase', 'tools']) fs.mkdirSync(path.join(outDir, d), { recursive: true });
    fs.copyFileSync(path.join(root, 'assets', 'app-templates.js'), path.join(outDir, 'assets', 'app-templates.js'));
    fs.copyFileSync(path.join(root, 'tools', 'gen-catalog.py'), path.join(outDir, 'tools', 'gen-catalog.py'));
    return run(python, [path.join(outDir, 'tools', 'gen-catalog.py'), '--engine', repo, '--setup', SETUP, '--allowlist', ALLOW, ...MOTION_ARGS, '--listing', LISTING, '--out', path.join(outDir, 'assets', 'app-catalog-data.js'), ...extra]);
  };
  // 1. the detail run reads the COMMIT: the probe is absent from every output
  const d1 = path.join(tmp, 'detail');
  const r1 = gen(['--detail-out', path.join(d1, 'catalog_data.ts')], d1);
  assert.equal(r1.status, 0, r1.stderr);
  for (const f of [path.join(d1, 'catalog_data.ts'), path.join(d1, 'assets', 'app-catalog-data.js'), path.join(d1, 'supabase', 'catalog_sources_seed.sql')]) {
    assert.ok(!fs.readFileSync(f, 'utf8').includes(probe), `${f} contains the untracked ingested dataset`);
  }
  // 2. even a run over the WORKING tree (no detail flag) excludes it, by the ingested rule
  const d2 = path.join(tmp, 'plain');
  const r2 = gen([], d2);
  assert.equal(r2.status, 0, r2.stderr);
  for (const f of [path.join(d2, 'assets', 'app-catalog-data.js'), path.join(d2, 'supabase', 'catalog_sources_seed.sql')]) {
    assert.ok(!fs.readFileSync(f, 'utf8').includes(probe), `${f} contains the ingested dataset (working-tree run)`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------ who may be listed (RULINGS 2026-10-17)
// `listable` is a FIELD decided per dataset in listing_decisions.json; catalog_rules.ts CHECKS it against the prose.

const DECISIONS = JSON.parse(fs.readFileSync(path.join(root, 'supabase', 'functions', '_shared', 'listing_decisions.json'), 'utf8'));

test('listable is a decided field: every catalog entry has a decision, the data carries it, and it passes its own checks', () => {
  assert.deepEqual(listableProblems(), []);
  const ids = new Set(CATALOG.map(e => e.id));
  for (const id of ids) assert.ok(DECISIONS.decisions[id], `${id} has no listing decision`);
  for (const id of Object.keys(DECISIONS.decisions)) assert.ok(ids.has(id), `${id} has a decision but is not in the catalog (stale)`);
  for (const e of CATALOG) {
    const d = DECISIONS.decisions[e.id];
    assert.equal(e.listable, d.listable, e.id);
    assert.equal(e.listable_class, d.class, e.id);
    assert.ok(String(d.why).trim(), `${e.id}: the decision records no reason`);
    if (e.listable) assert.ok(e.publisher && e.licence && e.licence_short, `${e.id} must show a source and a licence`);
  }
  assert.ok(CATALOG.filter(e => e.listable).length >= 90);
  assert.ok(listableEntries({ usableOnly: true }).every(e => e.status === 'usable' && e.listable));
  assert.ok(searchCatalog('', { limit: 25 }).every(h => CATALOG.find(e => e.id === h.id).listable));
});

test('Ryan\'s ruling: CC BY-SA, in whole or in part, is NOT listable (redistricting_2026 is the real case); so is INTERNAL', () => {
  const byId = Object.fromEntries(CATALOG.map(e => [e.id, e]));
  assert.equal(byId.redistricting_2026.listable, false);
  assert.match(byId.redistricting_2026.licence, /CC BY-SA/);
  assert.equal(byId.qcew_biggest_employer.listable, false);
  assert.match(byId.qcew_biggest_employer.notes, /INTERNAL/);
  assert.equal(byId.cdc_state_obesity.listable, false);
  // a person (the default audience) cannot find, describe or compile them
  for (const id of ['redistricting_2026', 'qcew_biggest_employer', 'cdc_state_obesity']) {
    assert.equal(describeDataset(id), null, id);
    assert.deepEqual(searchCatalog(id, {}), [], id);
    assert.match(refused({ dataset: id, film_type: 'map', title: 'x' }).join(), /is not in the catalog/, id);
  }
});

test('MUST-FAIL: every way a `listable: true` can contradict its own text is caught (the checks read prose to CATCH, never to decide)', () => {
  const base = plain(CATALOG.find(e => e.listable && e.status === 'usable'));
  assert.deepEqual(listableProblems([base]), [], 'control: a sound listable entry');
  const planted = {
    'CC BY-SA in the licence (Ryan\'s ruling)': { licence: 'U.S. Government work, public domain. Seat figures: Wikipedia, CC BY-SA 4.0.' },
    'CC BY-SA written share-alike': { licence: 'Creative Commons Attribution Share-Alike 4.0, public domain base' },
    'CC BY SA with spaces': { licence: 'U.S. Government work, public domain. Seat figures: CC BY SA 4.0.' },
    'Attribution Share Alike (two words)': { licence: 'Creative Commons Attribution Share Alike 4.0, public domain base' },
    'CC BY-SA with an en dash': { licence: 'U.S. Government work, public domain. Seat figures: CC BY–SA 4.0.' },
    'CC BY-SA with a non-breaking hyphen': { licence: 'U.S. Government work, public domain. Seat figures: CC BY‑SA 4.0.' },
    'an ODbL share-alike overlay': { licence: 'U.S. Government work, public domain, with an ODbL overlay for the boundary layer' },
    'Open Database License written out': { licence: 'Public domain. Boundaries under the Open Database Licence' },
    'INTERNAL in the notes (the qcew case)': { notes: 'A frozen table, pinned. INTERNAL.' },
    'Not public domain (BUILDER MED-4)': { licence: 'Not public domain' },
    'licensed for internal use only (BUILDER MED-4)': { licence: 'Public domain data, licensed for internal use only' },
    'non-commercial': { licence: 'CC BY-NC 4.0, public domain inputs' },
    'no derivatives': { licence: 'CC BY-ND 4.0' },
    'all rights reserved': { licence: 'U.S. Government work. All rights reserved by the packager' },
    'a private licence': { licence: 'Private' },
    'a personal-data licence': { licence: 'Personal data, public domain wording copied by mistake' },
    'proprietary': { licence: 'Public domain framing; proprietary extract' },
    'confidential': { notes: 'Confidential until release' },
    'a licence that names no open licence': { licence: 'Custom terms, ask the publisher' },
    'an empty licence': { licence: '', licence_short: '' },
    'a fixture id': { id: 'example_corp_costs' },
    'a personal id': { id: 'ryan_spending_flows' },
  };
  for (const [name, patch] of Object.entries(planted)) {
    const e = { ...base, ...patch, listable: true, listable_class: 'us-gov-public-domain', listable_why: 'planted' };
    assert.ok(listableProblems([e]).length, `${name}: marked listable must fail`);
    assert.deepEqual(listableEntries({}, [e]), [], `${name}: a catalog that fails its rule lists nothing`);
  }
  // ordinary prose that merely contains the words is NOT a false alarm
  for (const lic of ['U.S. Government work, public domain. Covers the private sector.', 'Public domain (BEA); personal income is the measure']) {
    assert.deepEqual(listableProblems([{ ...base, licence: lic }]), [], lic);
  }
  // the field's own consistency
  assert.ok(listableProblems([{ ...base, listable: 'yes' }]).length);
  assert.ok(listableProblems([{ ...base, listable_class: 'not-listable' }]).length);            // listable true with class not-listable
  assert.ok(listableProblems([{ ...base, listable: false, listable_class: 'us-gov-public-domain' }]).length);
  assert.ok(listableProblems([{ ...base, listable_class: 'whatever' }]).length);
  assert.ok(listableProblems([{ ...base, listable_why: '' }]).length);
  assert.ok(listableProblems([{ ...base, publisher: '' }]).length);                              // rule 5: a source
  assert.ok(listableProblems([{ ...base, licence_short: '' }]).length);                          // rule 5: a licence
});

test('the GENERATOR refuses a missing, contradicting or stale listing decision (it never lists by default)',
  { skip: (!ENGINE || !SETUP) && 'RYAGRAM_ENGINE / RYAGRAM_SETUP not set: SKIPPED, not passed' }, (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-list-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));      // cleaned up even when an assertion fails
  const tree = exportCommit(path.join(tmp, 'engine'));
  const dec = JSON.parse(JSON.stringify(DECISIONS));
  const run1 = (decisions, name) => {
    const lf = path.join(tmp, `${name}.json`);
    fs.writeFileSync(lf, JSON.stringify(decisions));
    for (const d of ['assets', 'supabase', 'tools']) fs.mkdirSync(path.join(tmp, name, d), { recursive: true });
    fs.copyFileSync(path.join(root, 'assets', 'app-templates.js'), path.join(tmp, name, 'assets', 'app-templates.js'));
    fs.copyFileSync(path.join(root, 'tools', 'gen-catalog.py'), path.join(tmp, name, 'tools', 'gen-catalog.py'));
    return run(python, [path.join(tmp, name, 'tools', 'gen-catalog.py'), '--engine', tree, '--setup', SETUP, '--allowlist', ALLOW, ...MOTION_ARGS, '--listing', lf,
      '--out', path.join(tmp, name, 'assets', 'app-catalog-data.js'), '--detail-out', path.join(tmp, name, 'catalog_data.ts')]);
  };
  assert.equal(run1(dec, 'control').status, 0, 'control: the real decisions generate');
  const missing = JSON.parse(JSON.stringify(dec)); delete missing.decisions.bls_state_unemployment;
  const r1 = run1(missing, 'missing');
  assert.notEqual(r1.status, 0); assert.match(r1.stderr, /no listing decision for bls_state_unemployment/);
  const flipped = JSON.parse(JSON.stringify(dec)); flipped.decisions.redistricting_2026 = { listable: true, class: 'us-gov-public-domain', why: 'planted' };
  const r2 = run1(flipped, 'bysa');
  assert.notEqual(r2.status, 0); assert.match(r2.stderr, /redistricting_2026 is decided listable but its licence or notes say 'BY-SA'/);
  const internal = JSON.parse(JSON.stringify(dec)); internal.decisions.qcew_biggest_employer = { listable: true, class: 'us-gov-public-domain', why: 'planted' };
  const r3 = run1(internal, 'internal');
  assert.notEqual(r3.status, 0); assert.match(r3.stderr, /qcew_biggest_employer is decided listable but .* 'INTERNAL'/);
  const inconsistent = JSON.parse(JSON.stringify(dec)); inconsistent.decisions.bls_state_unemployment = { listable: true, class: 'not-listable', why: 'planted' };
  assert.notEqual(run1(inconsistent, 'inconsistent').status, 0);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------ BUILDER's review: paired, years, notes, look pin

test('MUST-FAIL (HIGH-1): a paired film is refused with its reason, no film type offered by the catalog is paired, and the REAL engine refuses what it would have built', () => {
  const e = usable.find(x => x.id === 'state_obesity_fastfood');
  assert.ok(e && !e.film_types.includes('paired'));
  assert.ok(usable.every(x => !x.film_types.includes('paired')));
  const errs = refused({ dataset: e.id, film_type: 'paired', title: 'x' });
  assert.match(errs.join(), /paired.*keyframes_per_year measured/);
});

test('the real engine refuses a paired story that has no keyframes_per_year (the dead end the old compileFilm could build)',
  { skip: !ENGINE && 'RYAGRAM_ENGINE not set: SKIPPED, not passed' }, () => {
  const story = { schema: 1, name: 'p', engine: 'sequence', notes: 'x', sequence: { canvas: [1920, 1080], fps: 30, theme: 'dark', clips: [
    { kind: 'title', id: 'open', seconds: 3, fade: 0.4, headline: 'H', subhead: 'S' },
    { kind: 'render', id: 'main', dataset: 'state_obesity_fastfood', view: 'paired', start: '2011', end: '2023' }] } };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paired-'));
  const sf = path.join(tmp, 's.json'); fs.writeFileSync(sf, JSON.stringify(story));
  const code = ['import json,sys', 'sys.path.insert(0, sys.argv[1])', 'from ryagram import sequence as sq', 'from ryagram.sequence import compose',
    'seq = sq.Sequence.from_json(json.load(open(sys.argv[2])))', 'clip = [c for c in seq.clips if c.kind == "render"][0]',
    'try:', '    compose.build_session(clip, seq)', '    print("BUILT")', 'except sq.SequenceError as e:', '    print("REFUSED", str(e)[:120])'].join(String.fromCharCode(10));
  const r = run(python, ['-I', '-c', code, ENGINE, sf]);
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.match(r.stdout, /REFUSED clip 'main' is a paired race and its story does not say how many keyframes/, r.stdout + r.stderr);
});

const TODAY = '2026-10-17';
const bls = () => CATALOG.find(e => e.id === 'bls_state_unemployment');

test('MUST-FAIL (MED-3): an open-ended series cannot be asked past its latest PUBLISHED period (BUILDER saw 2031-12 accepted; 2026-09 is not out on 2026-10-17)', () => {
  const e = bls();
  const req = { dataset: e.id, film_type: 'line', title: 'x' };
  const outcome = (years, today = TODAY) => { try { return compileFilm({ ...req, years }, { today }); } catch (x) { return x.errors; } };
  assert.match(outcome({ start: '2025-06', end: '2031-12' }).join(), /later than this series can hold.*latest PUBLISHED period is 2026-08/);
  assert.match(outcome({ start: '2026-01', end: '2026-09' }).join(), /latest PUBLISHED period is 2026-08/, 'the calendar month that has ended is not yet published');
  const ok = outcome({ start: '2024-01', end: '2026-08' });
  assert.ok(!Array.isArray(ok) && ok.report.window.end === '2026-08', 'control: the latest published month is accepted');
  // the clock decides, and by PUBLICATION: after the release date the same request is fine
  assert.equal(latestPossible(e, '2026-10-17'), '2026-08');
  assert.equal(latestPossible(e, '2026-10-20'), '2026-08');
  assert.equal(latestPossible(e, '2026-10-21'), '2026-09');
  assert.ok(!Array.isArray(outcome({ start: '2026-01', end: '2026-09' }, '2026-10-22')));
  assert.equal(latestPossible({ period: { to: '2023', cadence: 'annual', from: '1990' } }, '2030-01-01'), '2023', 'a closed series ends where it ends');
  assert.equal(latestPossible({ period: { to: '', cadence: 'annual', from: '1990' } }, '2026-10-17'), '2025');
});

test('years: one end given means the other is the dataset edge (start-only runs to the latest published period); neither means the known-good window', () => {
  const e = bls();
  const run1 = years => compileFilm({ dataset: e.id, film_type: 'line', title: 'x', years }, { today: TODAY }).report.window;
  assert.deepEqual(run1({ start: '2023-01' }), { start: '2023-01', end: '2026-08' }, 'start-only ends at the latest PUBLISHED period');
  assert.deepEqual(run1({ start: '2020-01' }), { start: '2020-01', end: '2026-08' }, 'start-only does NOT stop at the known-good window end');
  assert.deepEqual(run1({ end: '2015-12' }), { start: e.period.from, end: '2015-12' }, 'end-only starts at coverage');
  assert.deepEqual(run1({ end: '2021-12' }), { start: e.period.from, end: '2021-12' });
  assert.deepEqual(run1({}), { start: '2019-01', end: '2022-12' }, 'neither: the catalog known-good window');
  const annual = CATALOG.find(x => x.id === 'cbp_manufacturing_share_state');
  const a1 = compileFilm({ dataset: annual.id, film_type: 'bars', title: 'x', years: { start: '2010' } }).report.window;
  assert.deepEqual(a1, { start: '2010', end: annual.period.to }, 'a closed annual series: start-only ends at its coverage end');
});

test('MUST-FAIL (MED-3): known gaps are consulted: a film cannot start or end on one, and one inside is said and recorded', () => {
  const e = bls();
  assert.ok(Object.keys(e.known_gaps).includes('2025-10'));
  const asked = years => { try { return compileFilm({ dataset: e.id, film_type: 'line', title: 'x', years }, { today: TODAY }); } catch (x) { return x.errors; } };
  assert.match(asked({ start: '2025-10', end: '2026-06' }).join(), /2025-10 was not published by the source.*federal shutdown.*cannot start or end/);
  assert.match(asked({ start: '2025-01', end: '2025-10' }).join(), /cannot start or end on it/);
  const inside = asked({ start: '2025-01', end: '2026-03' });
  assert.ok(inside.report.warnings.some(w => /contains 2025-10.*did not publish/.test(w)));
  assert.match(inside.story.notes, /Not published by the source: 2025-10/);
  assert.ok(!asked({ start: '2024-01', end: '2025-06' }).report.warnings.some(w => /contains/.test(w)), 'control: a window that avoids the gap is silent');
});

test('method-change periods that are SPANS compare as spans, not as strings (BUILDER MED-3)', () => {
  const e = plain(usable.find(x => x.period.cadence === 'annual' && x.period.to && x.period.from <= '2005' && x.period.to >= '2020'));
  e.methodology_breaks = [{ period: '2010-2020', what: 'A span note.', effect: 'Applies across.' }, { period: '2008', what: 'A point.', effect: 'Changes here.' }];
  const cat = [e];
  e.listable = true;
  const w = (start, end) => compileFilm({ dataset: e.id, film_type: e.film_types[0], title: 'x', years: { start, end } }, { catalog: cat, today: TODAY }).report.warnings;
  assert.ok(w('2012', '2014').some(x => /applies across 2010 to 2020/.test(x)), 'a window inside the span');
  assert.ok(w('2005', '2011').some(x => /applies across 2010 to 2020/.test(x)), 'a window that overlaps its start');
  assert.ok(!w('2005', '2009').some(x => /applies across/.test(x)), 'control: a window wholly before the span');
  assert.ok(w('2005', '2009').some(x => /method change at 2008/.test(x)), 'a point inside');
  assert.ok(!w('2008', '2009').some(x => /method change at 2008/.test(x)), 'control: starting AT a point is not crossing it');
});

test('MUST-FAIL (LOW-9): a long licence is never the thing the 4000-character cap drops; the long notes go first', () => {
  const e = plain(usable[0]);
  e.notes = 'N'.repeat(6000);
  e.licence = 'Public domain. ' + 'L'.repeat(300);
  e.listable = true;
  const r = compileFilm({ dataset: e.id, film_type: e.film_types[0], title: 'x' }, { catalog: [e] });
  assert.ok(r.story.notes.length <= 4000);
  assert.ok(r.story.notes.includes(e.licence), 'the licence survives whole');
  assert.ok(r.story.notes.includes('Source:'));
  assert.ok(r.story.notes.endsWith('...'), 'the notes were the part shortened');
  e.licence = 'Public domain. ' + 'L'.repeat(3000);
  const r2 = compileFilm({ dataset: e.id, film_type: e.film_types[0], title: 'x' }, { catalog: [e] });
  assert.ok(r2.story.notes.includes('Licence: Public domain.') && r2.story.notes.includes('(full terms at the source)'), 'an overlong licence is shortened with a pointer, not dropped');
});

test('MUST-FAIL (LOW-7): a look that would undo a dataset\'s pinned style is refused with the reason; one that restates it is fine', () => {
  const e = CATALOG.find(x => x.style && x.status === 'usable');
  const mk = ramp => ({ profile_version: 1, name: 'x', look: { ramp } });
  const ask = look => refused({ dataset: e.id, film_type: e.film_types[0], title: 'x', look });
  assert.match(ask(mk({ continuous: false, steps: 3 })).join(), /a county map is drawn as continuous colour.*leave .continuous. unset or true/);
  assert.match(ask(mk({ mode: 'hatch' })).join(), /too small to hatch/);
  assert.equal(ask(mk({ continuous: true, mode: 'solid' })), null, 'control: restating the pin is fine');
  assert.equal(ask(mk({ steps: 5 })), null, 'control: steps alone do not undo it');
  assert.equal(ask({ profile_version: 1, name: 'x', look: { theme: 'light' } }), null, 'control: a look that does not touch it');
});

// ------------------------------------------------------------------------------------------ BUILDER's review: leak probe, staleness, validator

// The probe as a function, so a test can prove it CAN FAIL: it returns every detail-only fragment a text contains.
function leakedFragments(text, frags) { return frags.filter(f => text.includes(f)); }

test('SERVER ONLY (MED-5): none of the detail-only text (notes, method changes, known gaps, the full licence) is in any public file, and the probe can fail', () => {
  const frags = [];
  for (const e of CATALOG) {
    if (e.notes.length >= 60) frags.push(e.notes.slice(0, 60));
    if (e.licence.length >= 60) frags.push(e.licence.slice(0, 60));
    for (const b of e.methodology_breaks) { if (b.what.length >= 40) frags.push(b.what.slice(0, 40)); if (b.effect.length >= 40) frags.push(b.effect.slice(0, 40)); }
    for (const why of Object.values(e.known_gaps)) if (String(why).length >= 20) frags.push(String(why));
  }
  assert.ok(frags.length > 100, `only ${frags.length} probe fragments`);
  // A front end that lists datasets (RULINGS 2026-10-17) may legitimately show the licence; when WEB adds that, it names the
  // fields here on purpose, in a reviewed commit. Today nothing is exempt.
  const EXEMPT_FIELDS = [];
  assert.deepEqual(EXEMPT_FIELDS, []);
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(x => x.isDirectory()
    ? (['node_modules', '.git', 'supabase', 'tests', 'tools'].includes(x.name) ? [] : walk(path.join(d, x.name))) : [path.join(d, x.name)]);
  const publicFiles = walk(root).filter(f => /\.(js|html|json|css|ts|mjs|txt|md|xml|svg)$/i.test(f));
  assert.ok(publicFiles.length > 20);
  for (const f of publicFiles) {
    const text = fs.readFileSync(f, 'utf8');
    assert.deepEqual(leakedFragments(text, frags), [], `${f} contains detail-only catalog text`);
    assert.doesNotMatch(text, /catalog_data\.ts|_shared\/film|schema_check|catalog_rules|listing_decisions/, `${f} refers to a server-only module`);
  }
  // THE CONTROL: plant one fragment of each kind in a COPY of a real public file and the probe must find it (and only it).
  const real = fs.readFileSync(path.join(root, 'assets', 'app-catalog-data.js'), 'utf8');
  assert.deepEqual(leakedFragments(real, frags), [], 'control baseline: the real public file is clean');
  const withNotes = CATALOG.find(e => e.notes.length >= 60), withLicence = CATALOG.find(e => e.licence.length >= 60);
  const withBreak = CATALOG.find(e => e.methodology_breaks.some(b => b.what.length >= 40));
  const withGap = CATALOG.find(e => Object.keys(e.known_gaps).length);
  const planted = {
    'notes': withNotes.notes.slice(0, 60), 'the full licence': withLicence.licence.slice(0, 60),
    'a method change': withBreak.methodology_breaks.find(b => b.what.length >= 40).what.slice(0, 40), 'a known gap': String(Object.values(withGap.known_gaps)[0]),
  };
  for (const [what, frag] of Object.entries(planted)) {
    const tainted = `${real}\n// ${frag}\n`;
    assert.ok(leakedFragments(tainted, frags).includes(frag), `the probe must catch ${what} planted in a public file`);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-'));
    try {
      const f = path.join(dir, 'planted-public.js');
      fs.writeFileSync(f, tainted);
      assert.ok(leakedFragments(fs.readFileSync(f, 'utf8'), frags).length >= 1, `${what}: found when read back from a file`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('MED-NEW: the PUBLIC catalog holds LISTABLE datasets only, and the checker can fail (anyone can fetch assets/app-catalog-data.js)', () => {
  const pub = fs.readFileSync(path.join(root, 'assets', 'app-catalog-data.js'), 'utf8');
  const ctx = { window: {} };
  new Function('window', pub)(ctx.window);
  const P = ctx.window.ryagramCatalogData;
  assert.deepEqual(publicLeaks(P.entries), [], 'the public file lists something that may not be listed');
  for (const id of ['redistricting_2026', 'qcew_biggest_employer', 'cdc_state_obesity']) {
    assert.ok(!P.entries.some(e => e.id === id), `${id} must not be in the public catalog`);
    assert.ok(!pub.includes(id), `${id} must not appear anywhere in the public file`);
  }
  // both ways: every LISTABLE dataset is in the public file, so the public file is neither leaky nor incomplete
  const listable = CATALOG.filter(e => e.listable).map(e => e.id).sort();
  assert.deepEqual(P.entries.map(e => e.id).sort(), listable);
  // MUST-FAIL: plant each kind of leak in a copy of the entries
  const entry = plain(P.entries[0]);
  assert.match(publicLeaks([...P.entries, { ...entry, id: 'redistricting_2026' }]).join(), /redistricting_2026.*NOT listable/);
  assert.match(publicLeaks([...P.entries, { ...entry, id: 'qcew_biggest_employer' }]).join(), /qcew_biggest_employer.*NOT listable/);
  assert.match(publicLeaks([...P.entries, { ...entry, id: 'ryan_spending_flows' }]).join(), /unknown to the server catalog/);
  // and a catalog whose decision flips makes a previously clean public entry a leak
  const flipped = plain(CATALOG); const hit = flipped.find(e => e.id === P.entries[0].id); hit.listable = false; hit.listable_why = 'planted';
  assert.match(publicLeaks(P.entries, flipped).join(), /NOT listable \(planted\)/);
});

test('MED-6: the committed PUBLIC catalog and the server detail agree BOTH ways (listable ids, statuses, engine commit, the allow list)', () => {
  const pub = fs.readFileSync(path.join(root, 'assets', 'app-catalog-data.js'), 'utf8');
  const ctx = { window: {} };
  new Function('window', pub)(ctx.window);
  const P = ctx.window.ryagramCatalogData;
  assert.equal(P.engine, CATALOG_ENGINE, 'the public file and the server detail were generated from different engine commits');
  const pubIds = new Map(P.entries.map(e => [e.id, e.status]));
  const srvListable = new Map(CATALOG.filter(e => e.listable).map(e => [e.id, e.status]));
  for (const id of pubIds.keys()) assert.ok(srvListable.has(id), `${id} is in the public catalog but is not a listable server entry`);
  for (const id of srvListable.keys()) assert.ok(pubIds.has(id), `${id} is a listable server entry but is not in the public catalog (the public file is stale)`);
  for (const [id, st] of pubIds) assert.equal(srvListable.get(id), st, `${id}: status differs`);
  assert.equal(pubIds.size, srvListable.size);
  const allow = fs.readFileSync(ALLOW, 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#'));
  assert.deepEqual([...P.allow].sort(), [...allow].sort());
  // control: the checks can fail
  const stale = new Map(srvListable); stale.delete('bls_state_unemployment');
  assert.ok([...pubIds.keys()].some(id => !stale.has(id)));
});

test('MED-2: the worker\'s REAL validate_story, given the worker\'s REAL allowlist and views, accepts every story and refuses planted ones',
  { skip: !ENGINE && 'RYAGRAM_ENGINE not set: SKIPPED, not passed' }, () => {
  const allowText = fs.readFileSync(ALLOW, 'utf8');
  const views = {};
  for (const m of allowText.matchAll(/^#views (\S+) (\S+)$/gm)) views[m[1]] = m[2].split(',');
  const allow = allowText.split(/\r?\n/).filter(l => l && !l.startsWith('#'));
  assert.ok(allow.length >= 80 && Object.keys(views).length >= 1);
  const stories = [];
  for (const e of usable) for (const ft of e.film_types) {
    stories.push({ story: compileFilm({ dataset: e.id, film_type: ft, title: `Worker check ${e.id}` }, { today: TODAY }).story, expect: 'accept' });
    stories.push({ story: compileFilm({ dataset: e.id, film_type: ft, title: `Worker check ${e.id}`, look: PRESETS['bold-social'] }, { today: TODAY }).story, expect: 'accept' });
  }
  const base = plain(stories[0].story);
  const planted = (name, edit) => { const s = plain(base); edit(s); stories.push({ story: s, expect: 'refuse', name }); };
  planted('a dataset not on the worker allowlist', s => { s.sequence.clips[1].dataset = 'cdc_state_obesity'; });
  planted('a view the worker does not offer for fhwa_hm212', s => { s.sequence.clips[1].dataset = 'fhwa_hm212'; s.sequence.clips[1].view = 'bars'; });
  planted('an unknown key', s => { s.sequence.clips[1].settings = { axis_max: 5 }; });
  planted('a period range out of order', s => { s.sequence.clips[1].start = '2023'; s.sequence.clips[1].end = '2011'; });
  planted('a vertical story with a bad fps', s => { s.sequence.fps = 60; });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'film-'));
  const f = path.join(tmp, 'in.json');
  fs.writeFileSync(f, JSON.stringify({ allow, views, stories }));
  const code = ['import json,sys', 'sys.path.insert(0, sys.argv[1])', 'from ryagram.worker.schema import validate_story, Rejected', 'from ryagram import sequence as sq',
    'd=json.load(open(sys.argv[2]))', 'bad=0', 'for item in d["stories"]:', '    s=item["story"]', '    try:',
    '        validate_story(s, datasets=set(d["allow"]), views=d["views"])', '        got="accept"', '    except Rejected:', '        got="refuse"',
    '    if got!=item["expect"]:', '        bad+=1; print("MISMATCH", item.get("name") or s["name"], "expected", item["expect"], "got", got)',
    '    if item["expect"]=="accept": sq.Sequence.from_json(s)',
    'print("checked", len(d["stories"]), "mismatches", bad)', 'sys.exit(1 if bad else 0)'].join(String.fromCharCode(10));
  const r = run(python, ['-I', '-c', code, ENGINE, f]);
  fs.rmSync(tmp, { recursive: true, force: true });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /checked \d+ mismatches 0/);
});

test('LOW-8: the vendored schema hash is of the committed file with line endings normalised, so it is the same on any checkout',
  { skip: !ENGINE && 'RYAGRAM_ENGINE not set: SKIPPED, not passed' }, () => {
  const blob = spawnSync('git', ['-C', ENGINE, 'show', 'HEAD:ryagram/worker/story.schema.json'], { maxBuffer: 1 << 26 });
  assert.equal(blob.status, 0, String(blob.stderr));
  const lfBytes = Buffer.from(blob.stdout.toString('utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10)), 'utf8');
  const sha = crypto.createHash('sha256').update(lfBytes).digest('hex');
  assert.equal(STORY_SCHEMA_SHA256, sha);
});

test('worker_allowlist.txt is the EXPORTER\'s exact output: re-rendering its own ids and views with tools/export_allowlist.py gives the same bytes',
  { skip: !ENGINE && 'RYAGRAM_ENGINE not set: SKIPPED, not passed' }, () => {
  const exporter = path.join(ENGINE, 'tools', 'export_allowlist.py');
  assert.ok(fs.existsSync(exporter), 'tools/export_allowlist.py is not in the engine checkout (it landed on main with allowexport 8e9b17c)');
  const committed = fs.readFileSync(ALLOW, 'utf8');
  assert.ok(!committed.includes('\r'), 'the allowlist must be LF');
  const code = ['import importlib.util,re,sys', 'spec=importlib.util.spec_from_file_location("ea", sys.argv[1])', 'm=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'text=open(sys.argv[2],encoding="utf-8",newline="").read()', 'lines=text.split(chr(10))',
    'ids=[l for l in lines if l and not l.startswith("#")]', 'views={}',
    'for l in lines:', '    v=re.match(r"^#views (\\S+) (\\S+)$", l)', '    if v: views[v.group(1)]=v.group(2).split(",")',
    'head=re.match(r"^# count: (\\d+)\\n# worker\\.toml \\[datasets\\]\\.allow, engine ([0-9a-f]{7}), read (\\d{4}-\\d\\d-\\d\\d) by WORKER\\n", text)',
    'assert head, "the provenance header is not the exporter\'s"', 'assert int(head.group(1))==len(ids), "count header"',
    'out=m.render(sorted(ids), head.group(2), head.group(3), {i: views[i] for i in sorted(views)})',
    'print("EQUAL" if out==text else "DIFFERENT")'].join(String.fromCharCode(10));
  const r = run(python, ['-I', '-c', code, exporter, ALLOW]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.trim(), 'EQUAL');
  // a view restriction the worker enforces must still be carried: fhwa_hm212 is offered as a line only (worker.toml [datasets.views])
  assert.match(committed, /^#views fhwa_hm212 line$/m);
  // MUST-FAIL: a hand edit (an extra comment line, a reordered id, a swapped id) is not the exporter's output
  const edit = (t) => fs.writeFileSync(path.join(os.tmpdir(), 'allow-edit.txt'), t);
  for (const [name, text] of [['an added comment', committed.replace('\n#views', '\n# hand note\n#views')],
                              ['a swapped pair of ids', (() => { const l = committed.split('\n'); [l[3], l[4]] = [l[4], l[3]]; return l.join('\n'); })()]]) {
    edit(text);
    const bad = run(python, ['-I', '-c', code, exporter, path.join(os.tmpdir(), 'allow-edit.txt')]);
    assert.ok(bad.status !== 0 || bad.stdout.trim() === 'DIFFERENT', `${name} must not read as the exporter's output`);
  }
  fs.rmSync(path.join(os.tmpdir(), 'allow-edit.txt'), { force: true });
});


function refused2(req, catalog) { try { compileFilm(req, { catalog }); return null; } catch (e) { assert.ok(e instanceof FilmError); return e.errors; } }

test('MUST-FAIL: a caller acting for a person never sees a non-listable entry, by search, describe or compile; the system audience must ask by name', () => {
  const base = plain(CATALOG.find(e => e.listable && e.status === 'usable'));
  const hidden = { ...base, id: 'zz_hidden_probe', title: 'Hidden probe dataset', listable: false, listable_why: 'personal' };
  const cat = [...CATALOG, hidden];
  assert.deepEqual(searchCatalog('hidden probe', {}, cat), [], 'search must not reveal it');
  assert.deepEqual(searchCatalog('zz_hidden_probe', { usableOnly: true, limit: 25 }, cat), []);
  assert.equal(describeDataset('zz_hidden_probe', {}, cat), null, 'describe must not reveal it');
  const req = { dataset: 'zz_hidden_probe', film_type: hidden.film_types[0], title: 'x' };
  const asked = refused2(req, cat);
  assert.match(asked.join(), /is not in the catalog/);
  const unknown = refused2({ ...req, dataset: 'zz_no_such_dataset' }, cat);
  assert.deepEqual(asked.map(x => x.replace('zz_hidden_probe', '#')), unknown.map(x => x.replace('zz_no_such_dataset', '#')), 'a hidden dataset answers exactly like an unknown one (no existence leak)');
  // the system audience, asked for by name, does see it (internal tooling only)
  assert.equal(searchCatalog('hidden probe', { audience: 'system' }, cat).length, 1);
  assert.ok(describeDataset('zz_hidden_probe', { audience: 'system' }, cat));
  // control: a listable entry is visible to a person
  assert.ok(describeDataset(base.id, {}, cat));
  assert.ok(searchCatalog(base.title.split(' ')[0], {}, cat).length);
});
