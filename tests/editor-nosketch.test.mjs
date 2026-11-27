// A person's own film in the website's editor (WEB 11-20; assets/app-editor.js): no made-up sketch, the film's own latest sheet or preview with an honest line, and Look rows that can really take effect.
// The three functions that do it (drawNoSketch, loadSheet, extraLookRows) are cut out of the page's source and run here against a tiny DOM and fakes, so the BEHAVIOUR is tested, not just the words. The page
// in real Chrome is tools/check-live-editor-nosketch.py. Must-fails: tests/editor_nosketch_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SRC = read('assets/app-editor.js');
const between = (a, b) => { const i = SRC.indexOf(a), j = SRC.indexOf(b, i); assert.ok(i > 0 && j > i, `markers ${a} .. ${b}`); return SRC.slice(i, j); };

class El {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.value = ''; this.disabled = false; }
  append(...ks) { for (const k of ks.flat(Infinity)) if (k != null && k !== false) this.children.push(k); }
  replaceChildren(...ks) { this.children = []; this.append(...ks); }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  fire(t) { for (const f of this.listeners[t] || []) f({}); }
  get text() { return this.children.map(c => (c instanceof El ? c.text : String(c))).join(''); }
  all(pred, out = []) { for (const c of this.children) if (c instanceof El) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
}
const h = (tag, attrs, ...kids) => {
  const e = new El(tag);
  if (attrs && !Array.isArray(attrs) && typeof attrs === 'object' && !(attrs instanceof El)) { for (const [k, v] of Object.entries(attrs)) { if (k === 'disabled') e.disabled = v; else if (k === 'value') e.value = String(v); else e.attrs[k] = v; } }
  else if (attrs != null) kids.unshift(attrs);
  e.append(...kids); return e;
};

// ---- the picture area: drawNoSketch + loadSheet, run with the page's own variables as arguments
const SHEET_SRC = between('function drawNoSketch()', 'function drawData()');
function pictureArea({ data, routeProject = 'proj-1', destroyed = false } = {}) {
  const view = new El('div');
  const factory = vm.runInNewContext(`(function (h, view, data, routeProject, state) { let filmState = state.filmState, sheet = null, drawnKey = '', destroyedEditor = state.destroyed; const drawData = () => drawNoSketch();
    ${SHEET_SRC}
    return { drawNoSketch, loadSheet, setFilm(s) { filmState = s; }, get sheet() { return sheet; }, set sheet(v) { sheet = v; }, destroy() { destroyedEditor = true; } }; })`, { Promise, String, Array, console });
  const api = factory(h, view, data, routeProject, { filmState: 'none', destroyed });
  return { view, api };
}
const art = (kind, p, at) => ({ kind, storage_path: p, created_at: at });
const dataOf = ({ versions, arts, fail }) => {
  const asked = { versions: [], urls: [] };
  return { asked, getProject: async id => { if (fail === 'project') throw new Error('no'); return { versions }; },
    getVersion: async id => { asked.versions.push(id); if (fail === 'version') throw new Error('no'); return { artifacts: arts[id] || [] }; },
    fileUrl: async p => { asked.urls.push(p); return p.startsWith('missing') ? null : 'https://files.example/' + p; } };
};

test('NO SKETCH: while the film opens, one plain line; once it cannot be drawn, a plain sentence and the way to the film’s page; never a drawing', () => {
  const { view, api } = pictureArea({ data: null });
  api.setFilm('opening'); api.drawNoSketch();
  assert.equal(view.text, 'Opening your film’s own picture…');
  assert.equal(view.all(e => e.tag === 'svg').length, 0);
  api.setFilm('none'); api.drawNoSketch();
  assert.match(view.text, /cannot be drawn in this editor yet, so no drawing is shown: a made-up one would not be your film\./);
  const link = view.all(e => e.tag === 'a')[0];
  assert.equal(link.attrs.href, '#/p/proj-1'); assert.equal(link.text, 'Open this film’s page');
  assert.equal(view.attrs.role, 'group', 'the area is not an image (it holds a link)'); assert.ok(view.attrs['aria-label']);
  assert.equal(view.all(e => e.tag === 'svg' || e.tag === 'path').length, 0);
});

test('NO SKETCH: a redraw with nothing new keeps the same elements (a playing preview is not restarted); a new state redraws', () => {
  const { view, api } = pictureArea({ data: null });
  api.sheet = { src: 'https://f/p.mp4', kind: 'preview', note: 'n' }; api.drawNoSketch();
  const first = view.children[1]; assert.equal(first.tag, 'video');
  api.drawNoSketch(); api.drawNoSketch();
  assert.equal(view.children[1], first, 'the same video element');
  api.sheet = { src: 'https://f/other.mp4', kind: 'preview', note: 'n' }; api.drawNoSketch();
  assert.notEqual(view.children[1], first, 'a different film file redraws');
});

test('NO SKETCH: the film’s own sheet is an image with its honest line; a preview is a video with controls; no file says so', () => {
  const a = pictureArea({ data: null });
  a.api.sheet = { src: 'https://f/s.png', kind: 'contact sheet', note: 'This is your film’s latest contact sheet, made 2026-11-19, from version 2. It is not live: it does not show the changes you make here.' }; a.api.drawNoSketch();
  const img = a.view.all(e => e.tag === 'img')[0];
  assert.equal(img.attrs.src, 'https://f/s.png'); assert.match(img.attrs.alt, /contact sheet/); assert.match(a.view.text, /It is not live/);
  const b = pictureArea({ data: null });
  b.api.sheet = { src: 'https://f/p.mp4', kind: 'preview', note: 'x' }; b.api.drawNoSketch();
  const vid = b.view.all(e => e.tag === 'video')[0];
  assert.equal(vid.attrs.controls, true); assert.equal(vid.attrs.src, 'https://f/p.mp4');
  const c = pictureArea({ data: null }); c.api.sheet = 'none'; c.api.drawNoSketch();
  assert.match(c.view.text, /This film has no contact sheet or preview yet\./);
  assert.equal(c.view.all(e => e.tag === 'img' || e.tag === 'video').length, 0);
});

test('LATEST SHEET: newest version first, at most four versions looked at, a contact sheet before a preview before a thumbnail, and the line names the kind, the date and the version', async () => {
  const data = dataOf({ versions: [{ id: 'v1', number: 1 }, { id: 'v5', number: 5 }, { id: 'v3', number: 3 }, { id: 'v2', number: 2 }, { id: 'v4', number: 4 }],
    arts: { v5: [], v4: [art('thumbnail', 'th4.png', '2026-11-19T10:00:00Z'), art('preview', 'pv4.mp4', '2026-11-19T10:00:00Z'), art('contact_sheet', 'cs4.png', '2026-11-18T09:00:00Z')] } });
  const { view, api } = pictureArea({ data }); await api.loadSheet();
  assert.deepEqual(data.asked.versions, ['v5', 'v4'], 'v5 has nothing, v4 has files: stop there');
  assert.equal(api.sheet.src, 'https://files.example/cs4.png', 'the contact sheet wins');
  assert.match(api.sheet.note, /latest contact sheet, made 2026-11-18, from version 4\. It is not live/);
  assert.equal(view.all(e => e.tag === 'img').length, 1, 'and it is drawn');
  const only4 = dataOf({ versions: [1, 2, 3, 4, 5, 6].map(n => ({ id: 'v' + n, number: n })), arts: {} });
  const w = pictureArea({ data: only4 }); await w.api.loadSheet();
  assert.deepEqual(only4.asked.versions, ['v6', 'v5', 'v4', 'v3'], 'four newest only');
  assert.equal(w.api.sheet, 'none'); assert.match(w.view.text, /no contact sheet or preview yet/);
  const pv = dataOf({ versions: [{ id: 'a', number: 1 }], arts: { a: [art('thumbnail', 't.png'), art('preview', 'p.mp4', '2026-11-17T01:00:00Z')] } });
  const q = pictureArea({ data: pv }); await q.api.loadSheet();
  assert.equal(q.api.sheet.kind, 'preview'); assert.match(q.api.sheet.note, /latest preview, made 2026-11-17, from version 1/);
  const th = dataOf({ versions: [{ id: 'a', number: 1 }], arts: { a: [art('thumbnail', 't.png')] } });
  const r = pictureArea({ data: th }); await r.api.loadSheet();
  assert.equal(r.api.sheet.kind, 'contact sheet', 'a thumbnail is shown as the sheet it stands for'); assert.doesNotMatch(r.api.sheet.note, /made /, 'no date, none invented');
});

test('LATEST SHEET: a file with no address is skipped for an older one; a failed read leaves the plain sentence; no data calls draws nothing; a stopped page is not drawn into; nothing is ever made or asked of the engine', async () => {
  const skip = dataOf({ versions: [{ id: 'new', number: 2 }, { id: 'old', number: 1 }], arts: { new: [art('contact_sheet', 'missing-new.png')], old: [art('contact_sheet', 'old.png')] } });
  const a = pictureArea({ data: skip }); await a.api.loadSheet();
  assert.equal(a.api.sheet.src, 'https://files.example/old.png'); assert.match(a.api.sheet.note, /from version 1/);
  for (const fail of ['project', 'version']) {
    const b = pictureArea({ data: dataOf({ versions: [{ id: 'v', number: 1 }], arts: {}, fail }) }); await b.api.loadSheet();
    assert.equal(b.api.sheet, null, fail); assert.match(b.view.text, /cannot be drawn in this editor yet/); assert.equal(b.view.all(e => e.tag === 'img').length, 0);
  }
  const c = pictureArea({ data: { listProjects() {} } }); await c.api.loadSheet();
  assert.equal(c.view.children.length, 0, 'no way to read: nothing drawn, nothing thrown');
  const d = pictureArea({ data: dataOf({ versions: [{ id: 'v', number: 1 }], arts: { v: [art('contact_sheet', 's.png')] } }) });
  d.api.destroy(); await d.api.loadSheet(); assert.equal(d.view.children.length, 0, 'a page that was left is not drawn into');
  assert.doesNotMatch(SHEET_SRC, /submitJob|createJob|contact_sheet'\s*,\s*\{|request_|film_bundle|invoke\(/, 'reads only: no job, no engine');
});

// ---- the Look rows
const ROWS_SRC = between('function extraLookRows()', 'function paintLook()');
function lookRows({ look = {}, locked = false, aiTouched = [] } = {}) {
  const ops = [];
  const said = [];
  const factory = vm.runInNewContext(`(function (h, ed, locked, apply, btn, say, renderPath) { ${ROWS_SRC} return extraLookRows; })`, { Number, String, Array, Set });
  const btn = (label, cls, onclick, attrs = {}) => { const b = h('button', attrs, label); b.addEventListener('click', onclick); return b; };
  const rows = factory(h, { state: { look }, aiTouched: () => aiTouched }, locked, op => ops.push(op), btn, t => said.push(t), () => null)();
  const root = h('div', {}, ...rows);
  return { root, ops, said, sel: () => root.all(e => e.tag === 'select')[0], num: () => root.all(e => e.tag === 'input' && e.attrs.type === 'number')[0], colours: () => root.all(e => e.tag === 'input' && e.attrs.type === 'color') };
}
const core = {}; vm.runInNewContext(read('assets/app-editor-core.js'), { window: core, console, Math, Number, String, Object, Array, Set, Map, JSON, Date });
const LOOK_KEYS = core.ryagramEditor.LOOK_KEYS;

test('LOOK ROWS: Theme, Border width, Low and High colour, named plainly, with the engine’s defaults; nothing the draft cannot take', () => {
  const r = lookRows();
  assert.equal(r.sel().value, '', 'an unset Theme reads as the film’s own, never as Dark'); assert.deepEqual(r.sel().children.map(o => o.value), ['', 'dark', 'light']);
  assert.equal(r.num().value, '', 'an unset Border width is empty, never 2'); assert.equal(r.num().attrs.min, '0'); assert.equal(r.num().attrs.max, '4');
  assert.ok(r.root.text.includes('Not set'), 'unset rows say so');
  assert.deepEqual(r.colours().map(c => c.value), ['#232838', '#e8eefb'], 'the dark ramp ends');
  for (const w of ['Theme', 'Border width', 'Low colour', 'High colour']) assert.ok(r.root.text.includes(w), w);
  for (const w of ['Glow', 'Metal', 'Middle colour', 'Marker shape', 'Labels', 'waiting']) assert.ok(!r.root.text.includes(w), 'no ' + w + ' row');
  const light = lookRows({ look: { 'sequence.theme': 'light', 'state.outline_width': 3, 'choropleth.low': '#112233' } });
  assert.equal(light.sel().value, 'light'); assert.equal(light.num().value, '3');
  assert.deepEqual(light.colours().map(c => c.value), ['#112233', '#16233f'], 'a set colour is shown; the unset end shows the light default');
  assert.deepEqual(lookRows({ look: { 'sequence.theme': 'light' } }).colours().map(c => c.value), ['#eef1f6', '#16233f'], 'the light ramp ends when nothing is set');
  assert.ok(lookRows({ look: { 'sequence.theme': 'light' }, aiTouched: ['look:sequence.theme'] }).root.text.includes('by your AI'), 'an AI change to a new row is marked like the colour rows');
  assert.ok(lookRows({ locked: true }).sel().disabled && lookRows({ locked: true }).num().disabled && lookRows({ locked: true }).colours().every(c => c.disabled), 'locked while a change is being made');
});

test('LOOK ROWS: each change is ONE set_look with a key the draft accepts and a value its rule allows; a border width outside 0 to 4 or not a number is not sent', () => {
  const r = lookRows();
  r.sel().value = 'light'; r.sel().fire('change');
  r.num().value = '3.5'; r.num().fire('change');
  r.colours()[0].value = '#ff00aa'; r.colours()[0].fire('change');
  r.colours()[1].value = '#00ffaa'; r.colours()[1].fire('change');
  assert.deepEqual(JSON.parse(JSON.stringify(r.ops)), [{ op: 'set_look', key: 'sequence.theme', value: 'light' }, { op: 'set_look', key: 'state.outline_width', value: 3.5 }, { op: 'set_look', key: 'choropleth.low', value: '#ff00aa' }, { op: 'set_look', key: 'choropleth.high', value: '#00ffaa' }]);
  for (const op of r.ops) { assert.ok(LOOK_KEYS[op.key], op.key + ' is a key the editor core accepts'); assert.equal(LOOK_KEYS[op.key](op.value), true, `${op.key} = ${op.value}`); }
  const bad = lookRows();
  for (const v of ['9', '-1', 'abc', '', '4.5']) { bad.num().value = v; bad.num().fire('change'); assert.equal(bad.num().value, '', 'the box goes back to the last good value (nothing set: empty), never a ' + v + ' left standing'); }
  assert.deepEqual(JSON.parse(JSON.stringify(bad.ops)), [], 'nothing out of range or not a number is sent');
  assert.equal(bad.said.length, 4, 'each out-of-range or non-number entry says 0 to 4 (an empty box says nothing)'); assert.ok(bad.said.every(t => t.includes('0 to 4')));
  const kept = lookRows({ look: { 'state.outline_width': 3 } }); kept.num().value = '9'; kept.num().fire('change');
  assert.equal(kept.num().value, '3', 'a set width comes back when a bad one is typed');
  const back = lookRows({ look: { 'sequence.theme': 'light', 'state.outline_width': 3 } });
  back.root.all(e => e.tag === 'button').forEach(b => b.fire('click'));
  assert.deepEqual(JSON.parse(JSON.stringify(back.ops)), [{ op: 'unset_look', key: 'sequence.theme' }, { op: 'unset_look', key: 'state.outline_width' }], 'Use the film’s own is an unset_look');
  const own = lookRows({ look: { 'sequence.theme': 'light' } }); own.sel().value = ''; own.sel().fire('change');
  assert.deepEqual(JSON.parse(JSON.stringify(own.ops)), [{ op: 'unset_look', key: 'sequence.theme' }], 'choosing The film’s own unsets the theme');
  assert.equal(LOOK_KEYS['state.outline_width'](9), false); assert.equal(LOOK_KEYS['state.outline_width'](4), true); assert.equal(LOOK_KEYS['sequence.theme']('sepia'), false);
});

test('LOOK ROWS: every key the rows send is one the database lists as accepted (edit_look_keys), so the draft never refuses a row', () => {
  const sql = read('supabase/migrations/20261027000400_live_editor.sql') + read('supabase/migrations/20261127000100_look_keys_text_scale_legend_position.sql');   // the table's first rows + the reviewed insert that adds text.scale and layout.legend_position
  const sent = [...ROWS_SRC.matchAll(/key: '([a-z_.]+)'/g)].map(m => m[1]).concat([...ROWS_SRC.matchAll(/colour\('([a-z_.]+)'/g)].map(m => m[1]));
  assert.ok(new Set(sent).size >= 4, 'found the keys: ' + sent);
  for (const k of new Set(sent)) { assert.ok(sql.includes(`('${k}',`), `${k} is in edit_look_keys`); assert.ok(LOOK_KEYS[k], `${k} is in the editor core`); }
});

test('WIRING: a person’s own film is a project in the address with no host and no bundle; its Look panel shows these rows in place of the waiting list; its title is generic', () => {
  assert.match(SRC, /const realFilm = isData && !!routeProject && !window\.ryagramLiveHost && !bundleMode;/);
  assert.match(SRC, /\.\.\.\(realFilm \? extraLookRows\(\) : WAITING\.map\(/);
  assert.match(SRC, /if \(realFilm\) \{ drawNoSketch\(\); return; \}/);
  assert.match(SRC, /if \(realFilm\) loadSheet\(\);/);
  assert.match(SRC, /routeProject \? 'Edit your film' : isData \? 'Edit your film: obesity and fast food'/);
  assert.match(SRC, /\.\.\.\(realFilm \? \[view\] : \[view, cardOn \? cardBox : null, scrub, stripHolder, ticks,/, 'the made-up year slider, strip and ticks are not on the page for a real film');
  assert.match(SRC, /routeProject \? \(realFilm \? 'No drawing is made up for your film\. ' :/);
});

test('LOOK ROWS (engine-style-keys-1127): Text size (0.85 to 1, smaller only) and Key position send one set_look each, refuse out-of-range, and the unset goes back to the film\'s own', () => {
  const byId = (r, id) => r.root.all(e => e.attrs && e.attrs.id === id)[0];
  const r = lookRows();
  const ts = byId(r, 'le-look-text-scale'), lp = byId(r, 'le-look-legend-position');
  assert.ok(ts && lp, 'both rows exist'); assert.equal(ts.attrs.min, '0.85'); assert.equal(ts.attrs.max, '1'); assert.equal(ts.value, ''); assert.equal(lp.value, '');
  assert.deepEqual(lp.children.map(o => o.value), ['', 'bottom_left', 'bottom_right']);
  for (const w of ['Text size', 'Key position']) assert.ok(r.root.text.includes(w), w);
  ts.value = '0.9'; ts.fire('change'); lp.value = 'bottom_right'; lp.fire('change');
  assert.deepEqual(JSON.parse(JSON.stringify(r.ops)), [{ op: 'set_look', key: 'text.scale', value: 0.9 }, { op: 'set_look', key: 'layout.legend_position', value: 'bottom_right' }]);
  for (const op of r.ops) assert.equal(LOOK_KEYS[op.key](op.value), true, `${op.key} = ${op.value}`);
  const bad = lookRows(); const bts = byId(bad, 'le-look-text-scale');
  for (const v of ['1.2', '0.5', 'abc', '1.01']) { bts.value = v; bts.fire('change'); assert.equal(bts.value, '', 'never a ' + v + ' left standing'); }
  assert.deepEqual(JSON.parse(JSON.stringify(bad.ops)), [], 'nothing out of range is sent'); assert.ok(bad.said.length === 4 && bad.said.every(t => t.includes('0.85 to 1')));
  const set = lookRows({ look: { 'text.scale': 0.9, 'layout.legend_position': 'bottom_right' } });
  assert.equal(byId(set, 'le-look-text-scale').value, '0.9'); assert.equal(byId(set, 'le-look-legend-position').value, 'bottom_right');
  const own = lookRows({ look: { 'layout.legend_position': 'bottom_right' } }); const ol = byId(own, 'le-look-legend-position'); ol.value = ''; ol.fire('change');
  assert.deepEqual(JSON.parse(JSON.stringify(own.ops)), [{ op: 'unset_look', key: 'layout.legend_position' }]);
  assert.equal(LOOK_KEYS['text.scale'](1.01), false); assert.equal(LOOK_KEYS['layout.legend_position']('top_left'), false);
});
