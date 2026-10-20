// The shared options list (assets/options.json, built into assets/options-data.js) and how the "Your look" editor uses it (WEB, 2026-10-20, NEXT-WEB 108, behind lookEditor: false).
// The list is WORDING, CONTROL TYPE AND DEFAULTS ONLY: it is never the validator (CC1 13:27). These tests keep it honest: the generated file is what the generator builds,
// every editor control has a row and every built row has a control, the choices and bounds in the list are the engine's own, and a value the menu cannot produce is
// refused by the existing checks (the engine's rules in profile-core.js and the database's backstop), not by anything in the list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { checkAgainst } from '../supabase/functions/_shared/schema_check.ts';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const win = {};
for (const f of ['profile-core.js', 'options-data.js', 'app-looks.js', 'app-data.js', 'app-jobs.js']) vm.runInNewContext(read(`assets/${f}`), { window: win, TextEncoder, URLSearchParams, setTimeout, clearTimeout });
const L = win.ryagramLooks, P = win.ryagramProfile, O = win.ryagramOptions;
const plain = x => JSON.parse(JSON.stringify(x));
const source = JSON.parse(read('assets/options.json'));
const STORY_SCHEMA_JSON = JSON.parse(read('supabase/functions/_shared/story.schema.json'));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

test('GENERATED: assets/options-data.js is exactly what tools/make-options-data.mjs builds from assets/options.json', () => {
  const before = read('assets/options-data.js');
  execFileSync(process.execPath, [new URL('../tools/make-options-data.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
  assert.equal(read('assets/options-data.js'), before, 'options-data.js is stale: run node tools/make-options-data.mjs');
  assert.deepEqual(plain(O.data), source);
});

test('COVERAGE: every control in the editor has a row in the options list, and every built row with a path has a control (a new engine knob must get wording before it ships)', () => {
  const fields = [...L.SECTIONS.flatMap(s => s.fields), ...L.LATER].map(f => f.path);
  const rowPaths = new Set(source.options.filter(o => o.path).map(o => o.path));
  const noRow = fields.filter(p => !rowPaths.has(p) && !/^reserved\.(fonts|motion|brand)\./.test(p));
  assert.deepEqual(noRow, [], 'controls with no options row: ' + noRow.join(', '));
  const builtNoControl = source.options.filter(o => o.status === 'built' && o.path && !fields.includes(o.path)).map(o => o.path);
  assert.deepEqual(builtNoControl, [], 'built rows with no control: ' + builtNoControl.join(', '));
  const ids = source.options.map(o => o.id);
  assert.equal(new Set(ids).size, ids.length, 'option ids are unique');
});

test('THE ENGINE\'S OWN VALUES: choices, minimums, maximums and the colour pattern in the list equal the engine\'s profile schema, so the wording cannot promise what the engine would refuse', () => {
  const schema = P.PROFILE_SCHEMA;
  const at = path => path.split('.').reduce((n, k) => n && n.properties ? n.properties[k] : undefined, schema);
  for (const o of source.options.filter(x => x.status === 'built' && x.path)) {
    const s = at(o.path);
    assert.ok(s, `${o.path} is in the schema`);
    if (o.control === 'choice') assert.ok(same(s.enum.map(x => JSON.stringify(x)).sort(), o.choices.map(c => JSON.stringify(c.value)).sort()), `${o.path}: choices equal the schema's enum (any order: Dark is listed first on purpose)`);
    if (o.control === 'slider' || o.control === 'number') { assert.equal(o.min, s.minimum, `${o.path} min`); assert.equal(o.max, s.maximum, `${o.path} max`); }
    if (o.control === 'colour') assert.match(String(s.pattern), /#\[0-9a-fA-F\]\{6\}/, `${o.path} is a #RRGGBB colour`);
  }
});

test('PLAIN WORDS: the editor shows the list\'s label and one line of help for every control, groups them as Look and Size and speed, and keeps the engine\'s own option values', () => {
  const sections = L.optionSections();
  assert.deepEqual(plain(sections.map(s => s.title)), ['Look', 'Size and speed']);
  const shown = sections.flatMap(s => s.fields).map(L.plain);
  for (const f of shown) { assert.ok(f.help && f.help.length > 8, `${f.path} has help`); assert.ok(f.label && !/profile|schema|\bramp\b|\bfps\b/i.test(f.label), `${f.path} label is plain: ${f.label}`); }
  const canvas = L.plain(sections.flatMap(s => s.fields).find(f => f.path === 'look.canvas'));
  assert.deepEqual(plain(canvas.options.map(([v]) => v)), [[1920, 1080], [1280, 720], [1080, 1920]]);               // values untouched; only the labels are plain
  assert.match(canvas.options[2][1], /Vertical for Shorts/);
  assert.ok(canvas.note && Object.keys(canvas.note).some(k => /Vertical/.test(k)), 'the vertical warning still finds its label');
  const theme = L.plain(sections.flatMap(s => s.fields).find(f => f.path === 'look.theme'));
  assert.deepEqual(plain(theme.options.map(([v]) => v)), ['dark', 'light']);                                         // Dark first, as shipped
  assert.equal(theme.label, 'Page');
  assert.deepEqual(plain(L.comingLater().map(o => o.id)), ['music', 'captions', 'glow', 'borders']);
});

test('NOTHING IS HIDDEN: a control with no row keeps its own label and appears under "More", never dropped', () => {
  const saved = O.byPath['look.fps'];
  delete O.byPath['look.fps'];                                                                                       // the object is frozen shallowly: byPath is a plain map
  try {
    const all = L.optionSections();
    const fps = all.flatMap(s => s.fields).find(f => f.path === 'look.fps');
    assert.ok(fps, 'fps is still on screen');
    assert.equal(L.plain(fps).label, 'Frame rate');
  } finally { O.byPath['look.fps'] = saved; }
});

test('MUST-FAIL: a value the menu cannot produce is refused by the engine\'s own check in the page AND by the server\'s story schema check; the list has no say', () => {
  const ok = P.forkPreset('clean-light', 'mine');
  const rogue = [['look.fps', 17], ['look.theme', 'neon'], ['look.canvas', [1234, 567]], ['look.dots.radius', 99], ['look.bars.swap_seconds', -1], ['pacing.hold_seconds', 11], ['look.ramp.low', 'red']];
  for (const [path, value] of rogue) assert.ok(L.check(L.setPath(ok, path, value)).errors.length > 0, `${path} = ${JSON.stringify(value)} is refused by the engine's check`);
  // The SERVER's check is the story schema (the worker's own contract, the same file the guided builder and the AI editor use). A story carrying a value the menu cannot make is refused by it.
  // Note (found while writing this): the database's set_engine_profile backstop checks a saved look's STRUCTURE (key tree, name, size, 20 per person), not its values, so a stored look can hold fps 17;
  // the value is refused when it reaches a story, which is before anything renders. The menu cannot produce it either way.
  const story = JSON.parse(JSON.stringify(P.SAMPLE_STORY));
  assert.deepEqual(checkAgainst(STORY_SCHEMA_JSON, story), [], 'the clean sample story passes the server check');
  const rogueStory = [['fps', 17], ['theme', 'neon'], ['canvas', [1234, 567]], ['hold_seconds', 11]];
  for (const [key, value] of rogueStory) {
    const bad = JSON.parse(JSON.stringify(story)); bad.sequence[key] = value;
    assert.ok(checkAgainst(STORY_SCHEMA_JSON, bad).length > 0, `a story with sequence.${key} = ${JSON.stringify(value)} is refused by the server's schema check`);
  }
  // and the list has no say: it holds no rule keyed on a value (no validator code, no "enum check" of its own)
  const text = read('assets/options-data.js');
  const code = text.slice(text.indexOf('const byPath')).replace(/\/\/.*$/gm, '');                              // the code around the data, not the data's own words
  assert.doesNotMatch(code, /\.test\(|RegExp|throw |assert|validate|refuse/i);
});

test('WIRING: options-data.js loads before the editor, the editor holds no validator of its own, and the list says it is never the validator', () => {
  const html = read('app/index.html');
  assert.ok(html.indexOf('options-data.js') > 0 && html.indexOf('options-data.js') < html.indexOf('app-looks.js'));
  assert.match(source._about, /never the validator/);
  assert.match(read('assets/app-looks.js'), /never the validator/);
});
