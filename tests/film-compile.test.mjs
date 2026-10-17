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
import { spawnSync } from 'node:child_process';
import { CATALOG, STORY_SCHEMA, STORY_SCHEMA_SHA256, CATALOG_ENGINE } from '../supabase/functions/_shared/catalog_data.ts';
import { compileFilm, describeDataset, searchCatalog, FilmError, FILM_TYPES } from '../supabase/functions/_shared/film.ts';
import { checkAgainst } from '../supabase/functions/_shared/schema_check.ts';
import { DATASETS } from '../supabase/functions/_shared/templates.ts';
import { classifyListable, listableEntries, listableProblems } from '../supabase/functions/_shared/catalog_rules.ts';
import { validateProfile } from '../supabase/functions/_shared/profile.ts';
import { PRESETS } from '../supabase/functions/_shared/profile_data.ts';

const root = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const plain = x => JSON.parse(JSON.stringify(x));
const refused = req => { try { compileFilm(req); return null; } catch (e) { assert.ok(e instanceof FilmError, String(e)); return e.errors; } };
const usable = CATALOG.filter(e => e.status === 'usable');
const ENGINE = process.env.RYAGRAM_ENGINE, SETUP = process.env.RYAGRAM_SETUP;
const python = process.env.PYTHON || 'python';

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

test('SERVER ONLY: no browser file imports the detail catalog, the compile function or the schema checker', () => {
  // RULINGS 2026-10-17 lets a front end LIST datasets to invited users (source and licence shown). That is WEB's change
  // and uses the public catalog; the server function and the detail file stay server side, and this keeps it so.
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(x => x.isDirectory()
    ? (['node_modules', '.git', 'supabase', 'tests', 'tools'].includes(x.name) ? [] : walk(path.join(d, x.name))) : [path.join(d, x.name)]);
  const publicFiles = walk(root).filter(f => /\.(js|html|json|css|ts|mjs|txt|md|xml)$/i.test(f));
  assert.ok(publicFiles.length > 20);
  for (const f of publicFiles) {
    const text = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(text, /catalog_data\.ts|_shared\/film|schema_check/, `${f} refers to a server-only module`);
  }
  assert.ok(!fs.existsSync(path.join(root, 'assets', 'catalog_data.ts')));
  // the vendored worker schema is not in any public file
  for (const f of publicFiles) assert.ok(!fs.readFileSync(f, 'utf8').includes(STORY_SCHEMA_SHA256), `${f} carries the schema hash`);
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
  assert.equal(d.licence, undefined);
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
  assert.match(refused({ dataset: monthly.id, film_type: monthly.film_types[0], title: 'x', years: { start: '1800' } }).join(), /outside this dataset's coverage/);
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
    'a film type the dataset does not offer': [{ ...ok, dataset: CATALOG.find(x => x.status === 'usable' && !x.film_types.includes('paired')).id, film_type: 'paired' }, /is not offered/],
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
  for (const [name, [req, re]] of Object.entries(cases)) {
    const errs = refused(req);
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

test('a window that crosses a method change warns and records it in the notes', () => {
  const e = usable.find(x => x.methodology_breaks.length && x.methodology_breaks.some(b => b.period > x.period.from.slice(0, b.period.length)));
  assert.ok(e, 'some usable dataset has a method change inside its coverage');
  const b = e.methodology_breaks.find(x => x.period > e.period.from.slice(0, x.period.length));
  const to = e.period.to || e.period.from;
  const r = compileFilm({ dataset: e.id, film_type: e.film_types[0], title: 'Across a break', years: { start: e.period.from, end: to.length === 4 && b.period.length === 4 ? to : to } });
  if (r.report.window.start < b.period.padEnd(r.report.window.start.length, '0') && r.report.window.end >= b.period) {
    assert.ok(r.report.warnings.some(w => w.includes(b.period)), 'warned');
    assert.ok(r.story.notes.includes(b.period), 'recorded');
  }
});

// ------------------------------------------------------------------------------------------ the look

test('the look is applied by the profile compiler and changes ONLY look fields (honesty is not modifiable)', () => {
  for (const e of [...usable.slice(0, 6), ...usable.filter(x => x.style)]) {
    const base = compileFilm({ dataset: e.id, film_type: e.film_types[0], title: 'Look test' });
    for (const id of Object.keys(PRESETS)) {
      if (e.style?.choropleth?.continuous && PRESETS[id].look?.ramp?.mode === 'hatch') {
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

test('the committed catalog_data.ts equals a fresh regeneration; the public outputs are byte-identical to the previous script',
  { skip: (!ENGINE || !SETUP) && 'RYAGRAM_ENGINE / RYAGRAM_SETUP not set: SKIPPED, not passed' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-'));
  const mk = name => { for (const d of ['tools', 'assets', 'supabase']) fs.mkdirSync(path.join(tmp, name, d), { recursive: true });
    fs.copyFileSync(path.join(root, 'assets', 'app-templates.js'), path.join(tmp, name, 'assets', 'app-templates.js')); return path.join(tmp, name); };
  const A = mk('A'), B = mk('B');
  // The previous script (origin/main's) must write the same two public files as this one does without the flag.
  const prev = run('git', ['-C', root, 'show', 'origin/main:tools/gen-catalog.py']);
  fs.copyFileSync(path.join(root, 'tools', 'gen-catalog.py'), path.join(A, 'tools', 'gen-catalog.py'));
  fs.copyFileSync(path.join(root, 'tools', 'gen-catalog.py'), path.join(B, 'tools', 'gen-catalog.py'));
  const args = (dir, extra) => [path.join(dir, 'tools', 'gen-catalog.py'), '--engine', ENGINE, '--setup', SETUP, '--commit', CATALOG_ENGINE, '--out', path.join(dir, 'assets', 'app-catalog-data.js'), ...extra];
  assert.equal(run(python, args(A, [])).status, 0);
  assert.equal(run(python, args(B, ['--detail-out', path.join(B, 'catalog_data.ts')])).status, 0);
  assert.ok(fs.readFileSync(path.join(A, 'assets', 'app-catalog-data.js')).equals(fs.readFileSync(path.join(B, 'assets', 'app-catalog-data.js'))), 'public catalog differs with the flag');
  assert.ok(fs.readFileSync(path.join(A, 'supabase', 'catalog_sources_seed.sql')).equals(fs.readFileSync(path.join(B, 'supabase', 'catalog_sources_seed.sql'))), 'seed differs with the flag');
  const committed = fs.readFileSync(path.join(root, 'supabase', 'functions', '_shared', 'catalog_data.ts'));
  assert.ok(committed.equals(fs.readFileSync(path.join(B, 'catalog_data.ts'))), 'catalog_data.ts is stale: regenerate it with tools/gen-catalog.py --detail-out');
  if (prev.status === 0 && !/--detail-out/.test(prev.stdout)) {
    const P = mk('P');
    fs.writeFileSync(path.join(P, 'tools', 'gen-catalog.py'), prev.stdout);
    assert.equal(run(python, args(P, [])).status, 0);
    assert.ok(fs.readFileSync(path.join(P, 'assets', 'app-catalog-data.js')).equals(fs.readFileSync(path.join(A, 'assets', 'app-catalog-data.js'))), 'public catalog differs from the previous script');
    assert.ok(fs.readFileSync(path.join(P, 'supabase', 'catalog_sources_seed.sql')).equals(fs.readFileSync(path.join(A, 'supabase', 'catalog_sources_seed.sql'))), 'seed differs from the previous script');
  } else {
    console.log('note: origin/main already has --detail-out (or is not available), so the previous-script comparison was not made');
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------ who may be listed (RULINGS 2026-10-17)

test('every catalog entry carries a listable flag that the rule re-derives, and every listable entry shows source and licence', () => {
  assert.deepEqual(listableProblems(), []);
  for (const e of CATALOG) {
    assert.equal(typeof e.listable, 'boolean', e.id);
    assert.ok(e.listable_why, e.id);
    assert.deepEqual(classifyListable(e), [e.listable, e.listable_why], e.id);
    if (e.listable) assert.ok(e.publisher && e.licence && e.licence_short, `${e.id} must show a source and a licence`);
  }
  const listed = CATALOG.filter(e => e.listable);
  assert.ok(listed.length >= 20, `only ${listed.length} listable`);
  assert.ok(listableEntries({ usableOnly: true }).every(e => e.status === 'usable' && e.listable));
  assert.ok(searchCatalog('', { listableOnly: true, limit: 25 }).every(h => CATALOG.find(e => e.id === h.id).listable));
});

test('MUST-FAIL: a personal, synthetic-named or non-public-licence entry marked listable is caught, whichever way the flag is wrong', () => {
  const base = plain(CATALOG.find(e => e.listable && e.status === 'usable'));
  assert.deepEqual(listableProblems([base]), [], 'control: a public-domain entry marked listable is sound');
  const bad = {
    'personal data by id': { id: 'ryan_spending_flows', licence: 'Private' },
    'personal data by licence word': { licence: 'Personal data, not for sharing' },
    'a fixture by id': { id: 'example_corp_costs', licence: 'Synthetic' },
    'non-commercial licence': { licence: 'CC BY-NC 4.0' },
    'no-derivatives licence': { licence: 'CC BY-ND 4.0' },
    'all rights reserved': { licence: 'All rights reserved by the publisher' },
    'an unrecognised licence': { licence: 'Custom terms, ask the publisher' },
    'an empty licence': { licence: '' },
  };
  for (const [name, patch] of Object.entries(bad)) {
    const e = { ...base, ...patch, listable: true, listable_why: 'public domain' };
    assert.ok(listableProblems([e]).length, `${name}: marked listable must fail`);
    assert.deepEqual(listableEntries({}, [e]), [], `${name}: a catalog that fails its rule lists nothing`);
  }
  // the other direction: a public-domain entry wrongly marked NOT listable is also a mismatch
  assert.ok(listableProblems([{ ...base, listable: false, listable_why: 'personal' }]).length);
  // a listable entry that shows no source or no licence fails rule 5
  assert.ok(listableProblems([{ ...base, publisher: '' }]).length);
  assert.ok(listableProblems([{ ...base, licence_short: '' }]).length);
  // and the rule says yes where it should
  for (const lic of ['U.S. Government work, public domain', 'Public domain (17 USC 105), U.S. Census Bureau', 'CC BY 4.0', 'CC0 1.0']) {
    assert.equal(classifyListable({ id: 'x', licence: lic })[0], true, lic);
  }
});
