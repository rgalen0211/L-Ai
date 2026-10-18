// "Your look" (assets/app-looks.js): the form model and helpers, the data layer against the mock, and the guards that keep the editor inside ENGINE's spec. The rules
// themselves are the engine's (tests/profile-core.test.mjs replays its fixtures); the database half is the engine's supabase/tests/test_engine_profiles.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const win = {};
for (const f of ['profile-core.js', 'app-looks.js', 'app-data.js', 'app-jobs.js']) vm.runInNewContext(read(`assets/${f}`), { window: win, TextEncoder, URLSearchParams, setTimeout, clearTimeout });
const L = win.ryagramLooks, P = win.ryagramProfile;
const plain = x => JSON.parse(JSON.stringify(x));

test('SETPATH: a value is set, an empty one REMOVES the key (the theme default applies) and empty parents are pruned; the original is untouched', () => {
  const base = P.forkPreset('clean-light', 'mine');
  const a = L.setPath(base, 'look.ramp.low', '#112233');
  assert.equal(a.look.ramp.low, '#112233');
  assert.equal(base.look.ramp.low, '#eef1f6');
  const b = L.setPath(a, 'look.dots.radius', '');
  assert.ok(!('radius' in b.look.dots));
  let c = base;
  for (const k of ['color', 'baseline_color', 'radius']) c = L.setPath(c, `look.dots.${k}`, null);
  assert.ok(!('dots' in c.look), 'the empty dots object is gone');
  assert.equal(L.setPath({}, 'pacing.transition.kind', 'cut').pacing.transition.kind, 'cut');
});

test('CHECK: shape problems first (and only), then the engine\'s colour sentences tied to their control; warnings only when valid', () => {
  const ok = P.forkPreset('clean-light', 'mine');
  assert.deepEqual(plain(L.check(ok).errors), []);
  const bad = L.setPath(ok, 'look.page_background', '#fff');
  const r = L.check(bad);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].path, 'look.page_background');
  assert.match(r.errors[0].text, /does not match/);
  const close = L.setPath(L.setPath(ok, 'look.ramp.low', '#444444'), 'look.ramp.high', '#4c4c4c');
  const c = L.check(close);
  assert.match(c.errors[0].text, /only 3 dE apart; they need at least 20/);
  assert.equal(c.errors[0].path, 'look.ramp');
  assert.deepEqual(plain(L.problemsFor(c.errors, 'look.ramp.low').map(p => p.path)), ['look.ramp']);        // a group problem shows at each control in the group
  assert.deepEqual(plain(L.problemsFor(c.errors, 'look.theme')), []);
  assert.deepEqual(plain(L.check(L.setPath(ok, 'look.canvas', [1080, 1920])).warnings.length > 0), true);       // the engine's vertical warning
  assert.deepEqual(plain(L.check(L.setPath(ok, 'look.axis', 1)).warnings), []);                                   // not valid: no warnings, only errors
  assert.match(L.check(L.setPath(ok, 'look.axis', 1)).errors[0].text, /unknown key 'axis'/);
  assert.deepEqual(plain(L.toProblem('profile: expected an object')), { path: '', text: 'profile: expected an object' });
});

test('QUICK LOOK: page, a 5-swatch ramp from the colours, dots, no-data, and the theme defaults when a colour is unset or invalid', () => {
  const p = L.setPath(L.setPath(P.forkPreset('clean-light', 'mine'), 'look.ramp.low', '#000000'), 'look.ramp.high', '#ffffff');
  const q = L.quickLook(p);
  assert.deepEqual(plain(q.ramp), ['#000000', '#404040', '#808080', '#bfbfbf', '#ffffff']);
  assert.equal(q.page, '#fcfcfb');
  const dark = L.quickLook({ look: { theme: 'dark', page_background: '#nothex' } });
  assert.equal(dark.page, P.THEME_DEFAULTS.dark.page.background);                                          // an invalid colour never reaches the mock
  assert.equal(L.quickLook({ pacing: { title_card: { fade: 0.4, align: 'center' } } }).align, 'center');
});

test('HASH: the same look hashes the same whatever the key order; any change changes it', () => {
  const a = P.forkPreset('clean-light', 'mine');
  const reorder = v => (Array.isArray(v) ? v.map(reorder) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().reverse().map(k => [k, reorder(v[k])])) : v);
  const b = reorder(a);
  assert.notEqual(JSON.stringify(a), JSON.stringify(b));                                                   // the key order really differs
  assert.equal(L.hashProfile(a), L.hashProfile(b));
  assert.notEqual(L.hashProfile(a), L.hashProfile(L.setPath(a, 'look.fps', 24)));
  assert.match(L.hashProfile(a), /^[0-9a-f]{8}$/);
});

test('DIFF: an applied look is described in words, old to new, and clip-level changes are counted', () => {
  const story = plain(P.SAMPLE_STORY);
  const { story: after, report } = P.applyProfile(P.getPreset('print-mono'), story, 'restyle');
  const words = L.diffWords(story, after, plain(report.changed));
  assert.ok(words.some(w => /^Colour scale/.test(w)), words.join('|'));
  assert.ok(words.every(w => !/sequence\./.test(w)), 'no raw paths');
  const theme = P.getPreset('bold-social');
  const light = P.getPreset('clean-light');
  const r = P.applyProfile(theme, plain(P.applyProfile(light, story).story));
  assert.ok(L.diffWords(P.applyProfile(light, story).story, r.story, plain(r.report.changed)).some(w => w === 'Theme: light → dark'));
  assert.deepEqual(plain(L.diffWords({}, {}, [])), []);
});

test('NAMES: a free name is chosen next to the existing ones', () => {
  assert.equal(L.uniqueName([], 'my-look'), 'my-look');
  assert.equal(L.uniqueName(['my-look'], 'my-look'), 'my-look-2');
  assert.equal(L.uniqueName(['my-look', 'my-look-2'], 'my-look'), 'my-look-3');
});

test('DATA: save, list, read, default, overwrite by name, delete; the database refuses a rogue key and a 21st look', async () => {
  const data = win.ryagramData(createFakeClient());
  const a = P.forkPreset('clean-light', 'house-style', 'House style');
  await data.saveLook(a, true);
  await data.saveLook(P.forkPreset('bold-social', 'vertical-promo'), false);
  let rows = await data.listLooks();
  assert.deepEqual(rows.map(r => [r.name, r.is_default]), [['house-style', true], ['vertical-promo', false]]);
  assert.deepEqual(plain((await data.getLook('house-style')).spec), plain(a));                              // round trip: the same values come back
  assert.equal((await data.defaultLook()).name, 'house-style');
  await data.saveLook(P.forkPreset('print-mono', 'house-style', 'House style 2'), false);                   // same name: overwritten, still the default
  rows = await data.listLooks();
  assert.equal(rows.length, 2);
  assert.equal(rows.find(r => r.name === 'house-style').title, 'House style 2');
  assert.equal(rows.find(r => r.name === 'house-style').is_default, true);
  await data.saveLook(P.forkPreset('bold-social', 'vertical-promo'), true);
  assert.equal((await data.defaultLook()).name, 'vertical-promo');
  const rogue = plain(a); rogue.look.axis = 1;
  await assert.rejects(data.saveLook(rogue, false), /field the engine profile does not allow/);              // the backstop, as if the request were hand-edited
  const nameless = plain(a); delete nameless.name;
  await assert.rejects(data.saveLook(nameless, false), /needs a name/);
  await data.deleteLook(rows[0].id);
  assert.equal((await data.listLooks()).length, 1);
  for (let i = 0; i < 19; i++) await data.saveLook(P.forkPreset('clean-light', `look-${i}`), false);
  await assert.rejects(data.saveLook(P.forkPreset('clean-light', 'one-too-many'), false), /at most 20/);
});

test('SAMPLE SHEET: it runs on the person\'s own "Profile preview (sample)" project as a contact_sheet job with the engine\'s sample periods, never a render', async () => {
  const client = createFakeClient();
  const data = win.ryagramData(client);
  const story = P.applyProfile(P.getPreset('clean-light'), P.SAMPLE_STORY).story;
  const q = await data.lookSheet(story, P.SAMPLE_SHEET_PERIODS);
  assert.ok(q.versionId);
  const job = client.db.jobs[0];
  assert.equal(job.job_type, 'contact_sheet');
  assert.deepEqual(plain(job.params), { periods: plain(P.SAMPLE_SHEET_PERIODS) });
  assert.equal(client.db.projects[0].title, 'Profile preview (sample)');
  assert.deepEqual(plain(client.db.versions[0].story_spec), plain(story));
  client.db.jobs[0].state = 'complete';
  const q2 = await data.lookSheet(story, P.SAMPLE_SHEET_PERIODS);                                                 // the same project is reused, not a second one
  assert.equal(client.db.projects.length, 1);
  assert.ok(q2.versionId);
  assert.ok(!client.db.jobs.some(j => j.job_type === 'final_render'));
});

// ---- the guards that keep the editor inside ENGINE's spec
function leaves(node, path = '', out = []) {
  if (node.properties) for (const [k, v] of Object.entries(node.properties)) leaves(v, path ? `${path}.${k}` : k, out);
  else out.push(path);
  return out;
}
test('SPEC: every form field is a real schema path, and every look/pacing/reserved knob the engine has has a control (a new engine knob fails here, so it is not silently missing)', () => {
  const schemaLeaves = new Set(leaves(P.PROFILE_SCHEMA));
  const fields = [...L.SECTIONS.flatMap(s => s.fields), ...L.LATER].map(f => f.path);
  for (const f of fields) assert.ok(schemaLeaves.has(f), `${f} is not in the engine's schema`);
  const covered = new Set(fields);
  const missing = [...schemaLeaves].filter(p => /^(look|pacing|reserved)\./.test(p) && !covered.has(p));
  assert.deepEqual(missing, [], 'engine knobs with no control: ' + missing.join(', '));
});

test('LOCKED: no control for the data, scale, axis, sources, notes, no-data wording, the drawing method or any check, and the locked panel says so', () => {
  const paths = [...L.SECTIONS.flatMap(s => s.fields), ...L.LATER].map(f => f.path).join(' ');
  assert.doesNotMatch(paths, /dataset|axis|scale|source|note|no_data_label|label_text|callout|renderer|preflight|break|check/);
  assert.match(L.LOCKED_TEXT, /can’t change the data, the scale, the sources, the notes/);
  assert.match(L.LATER_TEXT, /Not applied yet/);
});

test('SOURCE: the editor has no validator of its own, no raw HTML, no inline style attribute (CSP), and says "look" to the person', () => {
  const src = read('assets/app-looks.js');
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML|setAttribute\('style'|\bstyle:/);
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /dE apart|MIN_RAMP_SPAN|function lab\(|contrast\(/);
  const ui = src.slice(src.indexOf('function create(ctx)'));
  assert.doesNotMatch(ui.replace(/'[^']*profile[^']*'/g, ''), /h\([^)]*'[^']*[Pp]rofile[ ,.]/);          // words on screen: "look", not "profile"
});

test('FLAG: the editor ships OFF (lookEditor: false) until the engine branch is merged and SQL 20261017000300 is applied; the routes and links wait for it', () => {
  assert.match(read('assets/ryagram-config.js'), /lookEditor: false,/);
  const lib = read('assets/app-library.js');
  assert.match(lib, /const looksOn = \(\) => window\.ryagramConfig\?\.lookEditor === true \|\| !!window\.ryagramMock;/);
  for (const re of [/looksOn\(\) && hash === '#\/looks'/, /looksOn\(\) && \(m = hash\.match\(\/\^#\\\/looks\\\/new/, /looksOn\(\) && \(m = hash\.match\(\/\^#\\\/looks\\\/edit/]) assert.match(lib, re);
  assert.match(lib, /const looksLink = looksOn\(\)/);
  assert.match(lib, /const lookApply = looksOn\(\) && !locked/);
  assert.ok(read('app/index.html').indexOf('profile-core.js') < read('app/index.html').indexOf('app-looks.js') && read('app/index.html').indexOf('app-looks.js') < read('app/index.html').indexOf('app-library.js'));
});
