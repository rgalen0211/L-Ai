// "Shape the film": the settings controls and the AI editor's set_look tool (editor parity audit).
// The same logic lives in supabase/functions/_shared/look.ts and assets/app-look.js; this checks the two
// copies are identical, that every field lands where the worker's schema wants it, that bad values are
// refused in plain words, and (when a Ryagram checkout is present) that what it writes passes the worker's
// own validate_story at the edges of every range.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LOOK_FIELDS, applyLook, describeLook } from '../supabase/functions/_shared/look.ts';
import { TOOLS, runTool, lookPatch } from '../supabase/functions/ai-editor/tools.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = p => fs.readFileSync(path.join(here, '..', p), 'utf8').replace(/\r\n/g, '\n');
const plain = x => JSON.parse(JSON.stringify(x));
const region = text => text.slice(text.indexOf('// BEGIN SHARED\n'), text.indexOf('// END SHARED'));

const win = {};
vm.runInNewContext(read('assets/app-templates.js'), { window: win });
const T = win.ryagramTemplates;
const story = (tpl, ds) => plain(T.build(tpl, ds, 'A headline'));
const MAP = () => story('map', 'state_obesity_fastfood');
const BARS = () => story('bars', 'bls_state_unemployment');
const LINE = () => story('line', 'bls_state_unemployment');
const PAIRED = () => story('paired', 'state_obesity_fastfood');

test('the page and the Edge Function run the same code', () => {
  assert.equal(region(read('assets/app-look.js')), region(read('supabase/functions/_shared/look.ts')));
  const w = {};
  vm.runInNewContext(read('assets/app-look.js'), { window: w });
  assert.deepEqual(Object.keys(w.ryagramLook).sort(), ['BASE', 'FIELDS', 'THEMES', 'apply', 'de', 'describe']);
  const s = MAP();
  const p = { title: { headline: 'New words' }, look: { map_mode: 'solid' } };
  assert.deepEqual(plain(w.ryagramLook.apply(s, p)), plain(applyLook(s, p)));
});

test('each setting lands in the key the worker schema names', () => {
  const s = applyLook(MAP(), {
    film: { theme: 'light', hold_seconds: 1.5 },
    title: { index: 0, headline: 'H', subhead: 'S', credit: 'C', seconds: 4.5, align: 'left', fade: 0.7 },
    view: { index: 0, start: '2012', end: '2020', first_period: '2013', last_period: '2019', hold_seconds: 2, subtitle: 'cap',
            top_n: 8, axis: 'dynamic', line_top_n: 4, period_years: 3, transition: 'fade', transition_seconds: 1 },
    look: { map_mode: 'solid', map_low: '#AABBCC', map_high: '#112233', map_steps: '5', map_continuous: false, map_key_label: 'one colour',
            no_data_label: 'n/a', outline_width: 1.5, dot_value: 500, dot_radius: 2.5, swap_seconds: 0.5 }
  });
  assert.equal(s.ok, true, JSON.stringify(s.problems));
  const q = s.story.sequence;
  assert.equal(q.theme, 'light');
  assert.equal(q.hold_seconds, 1.5);
  assert.deepEqual(plain(q.clips[0]), { kind: 'title', id: 'open', seconds: 4.5, fade: 0.7, headline: 'H', subhead: 'S', credit: 'C', align: 'left' });
  const r = q.clips[1];
  assert.deepEqual([r.start, r.end, r.first_period, r.last_period, r.hold_seconds, r.subtitle], ['2012', '2020', '2013', '2019', 2, 'cap']);
  assert.deepEqual(plain(r.settings), { top_n: 8, axis: 'dynamic', line_top_n: 4, period_years: 3 });
  assert.deepEqual(plain(r.transition), { kind: 'fade', seconds: 1 });
  assert.deepEqual(plain(q.style_overrides), {
    choropleth: { mode: 'solid', low: '#aabbcc', high: '#112233', steps: 5, continuous: false, single_label: 'one colour' },
    layout: { no_data_label: 'n/a' }, state: { outline_width: 1.5 }, dots: { value: 500, radius: 2.5 }, bars: { swap_seconds: 0.5 } });
});

test('it never changes the story it is given, and null or empty removes an optional setting', () => {
  const s = MAP();
  const before = JSON.stringify(s);
  const a = applyLook(s, { view: { index: 0, subtitle: 'x', top_n: 5 }, look: { outline_width: 2 } });
  assert.equal(JSON.stringify(s), before);
  const b = applyLook(a.story, { view: { index: 0, subtitle: '', top_n: null }, look: { outline_width: null } });
  assert.equal(b.ok, true);
  assert.deepEqual(plain(b.story), plain(s));                                   // back to exactly where it started (no empty leftovers)
  assert.deepEqual(b.changed.map(x => x.split(':')[1].trim()), ['removed', 'removed', 'removed']);
});

test('bad values are refused in plain words and nothing is applied', () => {
  const cases = [
    [{ title: { seconds: 90 } }, /Seconds on screen must be between 0\.5 and 60/],
    [{ title: { seconds: '' } }, /can't be left empty/],
    [{ title: { headline: 'x'.repeat(1001) } }, /at most 1000 characters/],
    [{ view: { start: '16' } }, /look like 2016 or 2016-03/],
    [{ view: { start: '2020', end: '2015' } }, /after the last/],
    [{ view: { top_n: 25 } }, /between 1 and 20/],
    [{ view: { top_n: 2.5 } }, /whole number/],
    [{ view: { axis: 'wobbly' } }, /fixed or dynamic/],
    [{ look: { map_low: 'blue' } }, /colour like #1a4fa3/],
    [{ look: { map_steps: '12' } }, /auto, or a whole number from 1 to 9/],
    [{ look: { outline_width: 9 } }, /between 0 and 4/],
    [{ look: { map_continuous: true } }, /Smooth colour needs the map fill set to solid/],
    [{ film: { theme: 'sepia' } }, /light or dark/],
    [{ film: { hold_seconds: 11 } }, /between 0 and 10/],
    [{ film: { canvas: 1 } }, /isn't something that can be changed here/],
    [{ title: { index: 3, headline: 'x' } }, /no such title card/],
    [{ view: { index: 2, subtitle: 'x' } }, /no such data view/]
  ];
  for (const [patch, re] of cases) {
    const s = MAP();
    const out = applyLook(s, patch);
    assert.equal(out.ok, false, JSON.stringify(patch));
    assert.match(out.problems.join(' '), re, JSON.stringify(patch));
    assert.equal(out.story, undefined);
  }
  assert.equal(applyLook({}, { film: { theme: 'light' } }).ok, false);
});

test('line breaks are turned into spaces and the person is told', () => {
  const out = applyLook(MAP(), { title: { subhead: 'Contiguous United States\n39,279 miles' } });
  assert.equal(out.ok, true);
  assert.equal(out.story.sequence.clips[0].subhead, 'Contiguous United States 39,279 miles');
  assert.match(out.notes[0], /line breaks were turned into spaces/);
  assert.equal(applyLook(MAP(), { title: { subhead: 'a b' } }).notes.length, 0);
});

test('describe reports what is in the story for the controls', () => {
  const d = describeLook(applyLook(BARS(), { view: { index: 0, top_n: 7 }, look: { swap_seconds: 0.4 } }).story);
  assert.equal(d.titles.length, 1);
  assert.equal(d.titles[0].headline, 'A headline');
  assert.equal(d.views[0].view, 'bars');
  assert.equal(d.views[0].top_n, 7);
  assert.equal(d.look.swap_seconds, 0.4);
  assert.equal(d.look.map_mode, null);
  assert.deepEqual(describeLook({}).views, []);
});

// ---- the AI editor's set_look -------------------------------------------------------------------
test('set_look is a strict tool built from the same fields', () => {
  const t = TOOLS.find(x => x.name === 'set_look');
  assert.ok(t);
  const props = Object.keys(t.input_schema.properties);
  assert.deepEqual([...props].sort(), [...t.input_schema.required].sort());
  assert.equal(t.input_schema.additionalProperties, false);
  for (const [scope, fields] of Object.entries(LOOK_FIELDS)) {
    for (const f of Object.keys(fields)) {
      const key = ({ film: 'film_', title: 'title_', view: 'view_', look: '' })[scope] + f;
      assert.ok(props.includes(key), key);
    }
  }
  assert.equal(new Set(props).size, props.length);                                   // no two settings share a name
});

function ctx(story) {
  const w = { story, saved: [], actions: [] };
  w.data = {
    async getVersion() { return { version: { id: 'v', project_id: 'p', number: 1, state: 'draft', story_spec: w.story, story_sha256: 'x' }, project: { id: 'p', title: 'T' }, jobs: [] }; },
    async saveStory(_id, s) { w.story = s; w.saved.push(s); return { story_sha256: 'y' }; }
  };
  w.versionId = 'v';
  w.actions = [];
  return w;
}
const none = Object.fromEntries(Object.keys(TOOLS.find(x => x.name === 'set_look').input_schema.properties).map(k => [k, null]));

test('set_look saves what the person asked and says what changed', async () => {
  const c = ctx(MAP());
  const out = await runTool('set_look', { ...none, title_index: 0, title_headline: 'Where obesity is highest', title_seconds: 5, map_low: '#ffffe0', swap_seconds: null }, c);
  assert.equal(out.isError, undefined, out.text);
  assert.match(out.text, /Headline \(title card 1\): Where obesity is highest/);
  assert.equal(c.saved.length, 1);
  assert.equal(c.story.sequence.clips[0].seconds, 5);
  assert.equal(c.story.sequence.style_overrides.choropleth.low, '#ffffe0');
  assert.deepEqual(c.actions, [{ type: 'story_changed' }]);
});

test('set_look clears a setting named in clear, and refuses with the plain reason', async () => {
  const c = ctx(applyLook(MAP(), { view: { index: 0, subtitle: 'old' } }).story);
  const cleared = await runTool('set_look', { ...none, clear: ['view_subtitle'] }, c);
  assert.equal(cleared.isError, undefined, cleared.text);
  assert.equal(c.story.sequence.clips[1].subtitle, undefined);
  const bad = await runTool('set_look', { ...none, title_seconds: 90 }, c);
  assert.equal(bad.isError, true);
  assert.match(bad.text, /Seconds on screen must be between 0\.5 and 60/);
  const unknown = await runTool('set_look', { ...none, clear: ['canvas'] }, c);
  assert.equal(unknown.isError, true);
  assert.equal((await runTool('set_look', { ...none }, c)).text, 'Nothing to change.');
  assert.equal(c.saved.length, 1);                                                   // only the first change was saved
});

test('lookPatch maps flat inputs onto scopes', () => {
  const { patch, unknown } = lookPatch({ ...none, view_index: 1, view_top_n: 6, film_theme: 'light', map_mode: 'hatch', clear: ['title_credit', 'bogus'] });
  assert.deepEqual(plain(patch), { film: { theme: 'light' }, title: { credit: null }, view: { index: 1, top_n: 6 }, look: { map_mode: 'hatch' } });
  assert.deepEqual(unknown, ['bogus']);
});

// ---- against the worker's own validate_story ----------------------------------------------------
const repo = process.env.RYAGRAM_REPO || path.join(here, '..', '..', 'Ryagram');
const haveEngine = fs.existsSync(path.join(repo, 'ryagram', 'worker', 'schema.py'));
const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

// Has the worker's schema dropped its 6 s title-card and 160-character caps yet (Ryan's W2, 2026-10-05)? Until it has,
// the edge test uses the old caps for those four fields and the relaxed-caps test below is skipped.
function workerAccepts(story) {
  if (!haveEngine) return false;
  const py = ['import sys, json', `sys.path.insert(0, ${JSON.stringify(repo)})`, 'from ryagram.worker.schema import validate_story, Rejected',
    'try:', '    validate_story(json.loads(sys.argv[1]), datasets={"d_x"}); print("yes")', 'except Rejected:', '    print("no")'].join(String.fromCharCode(10));
  const run = spawnSync(python, ['-c', py, JSON.stringify(story)], { encoding: 'utf8' });
  return run.status === 0 && run.stdout.trim() === 'yes';
}
const longCard = applyLook(MAP(), { title: { seconds: 12, subhead: 'w '.repeat(200).trim() } }).story;
if (longCard) longCard.sequence.clips[1].dataset = 'd_x';
const relaxed = workerAccepts(longCard);
const OLD = { seconds: 6, text: 160 };

function edges(spec, name) {
  if (spec.kind === 'num') return [spec.lo, !relaxed && name === 'seconds' ? OLD.seconds : spec.hi];
  if (spec.kind === 'enum') return spec.values;
  if (spec.kind === 'period') return ['2020', '2020-03'];
  if (spec.kind === 'colour') return ['#FF00FF', '#00ffff'];
  if (spec.kind === 'bool') return [true, false];
  if (spec.kind === 'steps') return ['auto', 1, 9];
  if (spec.kind === 'text') return ['x', 'y'.repeat(!relaxed && ['headline', 'subhead', 'credit'].includes(name) ? OLD.text : spec.max)];
  return [];
}

test('the worker accepts a long title card and a long subhead', { skip: !haveEngine ? 'no Ryagram checkout (set RYAGRAM_REPO)' : !relaxed && 'worker schema not relaxed yet (W2)' }, () => {
  assert.equal(relaxed, true);
});

test('everything it writes, at the edge of every range, passes the worker validate_story', { skip: !haveEngine && 'no Ryagram checkout (set RYAGRAM_REPO)' }, () => {
  const stories = [];
  const bases = { map: MAP, bars: BARS, line: LINE, paired: PAIRED };
  for (const make of Object.values(bases)) {
    for (const [scope, fields] of Object.entries(LOOK_FIELDS)) {
      for (const [name, spec] of Object.entries(fields)) {
        for (const value of edges(spec, name)) {
          const patch = { [scope]: { index: 0, [name]: value } };
          if (name === 'map_continuous' && value === true) patch.look = { map_mode: 'solid', map_continuous: true };
          const out = applyLook(make(), patch);
          assert.equal(out.ok, true, `${scope}.${name}=${value}: ${JSON.stringify(out.problems)}`);
          stories.push({ label: `${scope}.${name}=${value}`, story: out.story });
        }
      }
    }
  }
  // Everything at once, too.
  const all = { film: {}, title: { index: 0 }, view: { index: 0 }, look: {} };
  for (const [scope, fields] of Object.entries(LOOK_FIELDS)) for (const [name, spec] of Object.entries(fields)) all[scope][name] = edges(spec, name)[0];
  all.look.map_continuous = false;
  all.look.map_high = '#00ffff';
  all.look.dot_baseline_color = '#00ffff';
  const everything = applyLook(MAP(), all);
  assert.equal(everything.ok, true, JSON.stringify(everything.problems));
  stories.push({ label: 'everything at once', story: everything.story });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ryagram-look-'));
  try {
    const file = path.join(dir, 'stories.json');
    fs.writeFileSync(file, JSON.stringify(stories));
    const py = [
      'import sys, json',
      `sys.path.insert(0, ${JSON.stringify(repo)})`,
      'from ryagram.worker.schema import validate_story, Rejected',
      'bad = []',
      'for item in json.load(open(sys.argv[1], encoding="utf-8")):',
      '    ds = {c["dataset"] for c in item["story"]["sequence"]["clips"] if c["kind"] == "render"}',
      '    try:',
      '        validate_story(item["story"], datasets=ds)',
      '    except Rejected as e:',
      '        bad.append([item["label"], e.errors[:3]])',
      'print(json.dumps({"checked": len(json.load(open(sys.argv[1], encoding="utf-8"))), "bad": bad}))'
    ].join('\n');
    const run = spawnSync(python, ['-c', py, file], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const res = JSON.parse(run.stdout.trim().split('\n').pop());
    assert.deepEqual(res.bad, []);
    assert.ok(res.checked > 100, `only ${res.checked} stories checked`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('invisible and control characters are stripped from words, as the worker schema requires', () => {
  const zw = String.fromCharCode(0x200b), bidi = String.fromCharCode(0x202e), nul = String.fromCharCode(0);
  const out = applyLook(MAP(), { title: { headline: `Hel${zw}lo${bidi} wor${nul}ld` } });
  assert.equal(out.ok, true);
  assert.equal(out.story.sequence.clips[0].headline, 'Hel lo wor ld');
  assert.doesNotMatch(out.story.sequence.clips[0].headline, new RegExp('[' + zw + bidi + nul + ']'));
});

// ---- themes ---------------------------------------------------------------------------------
import { LOOK_THEMES, LOOK_BASE, lookDE } from '../supabase/functions/_shared/look.ts';

test('lookDE is the engine CIE76 distance (values measured with ryagram.maprace.colour.dE)', () => {
  const cases = [['#232838', '#14141a', 12.0], ['#e8eefb', '#14141a', 87.5], ['#eef1f6', '#fcfcfb', 5.1], ['#2a0845', '#fff68f', 124.8], ['#00e5ff', '#1f1f27', 83.7]];
  for (const [a, b, want] of cases) assert.ok(Math.abs(lookDE(a, b) - want) < 0.15, `${a} ${b} ${lookDE(a, b)}`);
});

test('every named theme applies, is recognised by name, and passes the worker schema and the contrast rules', () => {
  const stories = [];
  for (const make of [MAP, BARS, LINE, PAIRED]) {
    for (const [key, t] of Object.entries(LOOK_THEMES)) {
      const out = applyLook(make(), { theme: key });
      assert.equal(out.ok, true, `${key}: ${JSON.stringify(out.problems)}`);
      assert.equal(out.story.sequence.theme, t.theme);
      assert.equal(describeLook(out.story).theme_name, key);
      stories.push({ label: `theme ${key}`, story: out.story });
    }
  }
  assert.equal(describeLook(MAP()).theme_name, 'night');
  assert.equal(describeLook(applyLook(MAP(), { look: { map_low: '#aa0000' } }).story).theme_name, 'custom');
  if (haveEngine) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ryagram-theme-'));
    try {
      const file = path.join(dir, 's.json');
      fs.writeFileSync(file, JSON.stringify(stories));
      const py = ['import sys, json', `sys.path.insert(0, ${JSON.stringify(repo)})`, 'from ryagram.worker.schema import validate_story, Rejected', 'bad = []',
        'for it in json.load(open(sys.argv[1], encoding="utf-8")):', '    ds = {c["dataset"] for c in it["story"]["sequence"]["clips"] if c["kind"] == "render"}',
        '    try:', '        validate_story(it["story"], datasets=ds)', '    except Rejected as e:', '        bad.append([it["label"], e.errors[:2]])', 'print(json.dumps(bad))'].join(String.fromCharCode(10));
      const run = spawnSync(python, ['-c', py, file], { encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
      assert.deepEqual(JSON.parse(run.stdout.trim()), []);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

test('switching theme resets earlier colours, and an explicit colour in the same change wins', () => {
  const a = applyLook(MAP(), { look: { map_mode: 'solid', map_low: '#ffffe0', map_high: '#800026', no_data_fill: '#ffcc00' } }).story;
  const b = applyLook(a, { theme: 'atlas' }).story;
  assert.equal(b.sequence.theme, 'light');
  assert.equal(b.sequence.style_overrides, undefined);
  const c = applyLook(a, { theme: 'print', look: { outline_width: 1 } }).story;
  assert.equal(c.sequence.style_overrides.state.outline_width, 1);
  assert.equal(c.sequence.style_overrides.choropleth.mode, 'hatch');
  const bad = applyLook(MAP(), { theme: 'sepia' });
  assert.equal(bad.ok, false);
  assert.match(bad.problems[0], /isn't one of the themes: Night, Atlas, Print, High contrast/);
});

test('the engine contrast rules refuse close colours in plain words', () => {
  const solid = { map_mode: 'solid' };
  const cases = [
    [{ ...solid, map_low: '#232838', map_high: '#252a3a', map_steps: '5' }, /too close together to tell 5 steps apart/],
    [{ ...solid, map_low: '#232838', map_high: '#262b3b' }, /too close together to give readable steps/],
    [{ ...solid, map_low: '#14141b' }, /low colour would disappear into the page/],
    [{ ...solid, map_high: '#15151b' }, /high colour would disappear into the page/],
    [{ no_data_fill: '#202028' }, /missing data is too close/],
    [{ dot_color: '#202028' }, /small dots need a stronger contrast/],
    [{ dot_color: '#00e5ff', dot_baseline_color: '#10e0f8' }, /two kinds of dots are too close/]
  ];
  for (const [look, re] of cases) {
    const out = applyLook(MAP(), { look });
    assert.equal(out.ok, false, JSON.stringify(look));
    assert.match(out.problems.join(' '), re, JSON.stringify(look));
  }
  // The same colours are fine where they do not matter (hatched map: low/high are unused) and the theme base is judged on the light page.
  assert.equal(applyLook(MAP(), { look: { map_low: '#232838', map_high: '#252a3a' } }).ok, true);
  assert.equal(applyLook(MAP(), { film: { theme: 'light' }, look: { ...solid, map_low: '#eef1f6', map_high: '#16233f', map_steps: '5' } }).ok, true);
  for (const t of Object.values(LOOK_BASE)) assert.ok(lookDE(t.page, t.fill) > 0);
});

test('the engine own defaults pass the rules the picker applies', () => {
  for (const [name, b] of Object.entries(LOOK_BASE)) {
    assert.ok(lookDE(b.low, b.page) >= 5 && lookDE(b.high, b.page) >= 5, `${name} ramp ends vs page`);
    assert.ok(lookDE(b.dot, b.fill) >= 20 && lookDE(b.dot, b.page) >= 20, `${name} dot`);
    assert.ok(lookDE(b.low, b.high) >= 5 * 4, `${name} ramp carries 5 steps`);
  }
});

test('set_look can change a theme and the colours of single elements', async () => {
  const props = Object.keys(TOOLS.find(x => x.name === 'set_look').input_schema.properties);
  assert.ok(props.includes('theme') && props.includes('no_data_fill') && props.includes('dot_color') && props.includes('dot_baseline_color'));
  const none2 = Object.fromEntries(props.map(k => [k, null]));
  const c = ctx(MAP());
  const out = await runTool('set_look', { ...none2, theme: 'print' }, c);
  assert.equal(out.isError, undefined, out.text);
  assert.equal(c.story.sequence.theme, 'light');
  const bad = await runTool('set_look', { ...none2, dot_color: '#f7f6f2' }, c);
  assert.equal(bad.isError, true);
  assert.match(bad.text, /small dots need a stronger contrast/);
});
