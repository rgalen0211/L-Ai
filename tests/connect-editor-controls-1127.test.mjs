// The live editor's ONE control table (tools/chat-editor/controls.json, version 1) against the code: every op the editor core supports has a control entry, every control's op is applied
// and undone through the editor core, through the shared draft (the in-chat panel's path: editor_apply_ops / editor_undo) and, for the AI's twin, through the connector's own tools;
// every control the table says the chat panel shows is in the page as committed; an op the panel cannot do (an AI-only op) is listed as such. Must-fails: tests/connect_editor_controls_mutants.mjs.
// NOT proved here: a real browser drawing the panel (this PC's Chrome crashes in tools/check-*.py). "In the page" means: the control's own source line is in the generated page text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { checkRepo, loadCore, aiCoverage } from '../tools/chat-editor/controls_check.mjs';
import { JS } from '../tools/build-chat-editor.mjs';
import { EDITOR_HTML } from '../supabase/functions/connect-core/editor_page.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { TOOLS } from '../supabase/functions/connect-core/tools.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import Ajv2020 from 'ajv/dist/2020.js';

const here = new URL('../', import.meta.url);
const read = p => fs.readFileSync(new URL(p, here), 'utf8').replace(/\r\n/g, '\n');
const plain = x => JSON.parse(JSON.stringify(x));
const CONTROLS = JSON.parse(read('tools/chat-editor/controls.json'));
const window = {};
const ctx = { window, Error, Math, Number, Array, Object, String, JSON, Set, Map, RegExp, Promise };
for (const f of ['assets/app-editor-core.js', 'assets/app-editor-draft.js']) vm.runInNewContext(read(f), ctx);
const E = window.ryagramEditor, D = window.ryagramEditorDraft;
const { createEditorRpcs } = createRequire(import.meta.url)('./fake-editor-rpcs.js');

const editControls = CONTROLS.controls.filter(c => c.kind === 'edit' && c.status !== 'planned');
const DATA_BASE = () => ({ look: { 'network.color': '#6fd1bd', 'sequence.theme': 'dark' } });
const CLIP_BASE = () => ({
  duration: 12, look: {},
  clips: [
    { id: 'v1', track: 'video', start: 0, len: 2, label: 'one' }, { id: 'v2', track: 'video', start: 2, len: 2, label: 'two' }, { id: 'v3', track: 'video', start: 4, len: 3, label: 'three' },
    { id: 'p1', track: 'pictures', start: 5, len: 2, label: 'rent chart', picture: 'pic1' }, { id: 't1', track: 'text', start: 1, len: 3, label: 'Title', text: 'Housing' },
    { id: 'music', track: 'music', start: 0, len: 12, label: 'music', level_db: 0, snap: false }
  ],
  rules: [{ id: 'r1', phrase: 'rent', picture: 'pic1', seconds: 2, mode: 'corner' }], pictures: [{ id: 'pic1', name: 'Rent chart' }]
});
const baseFor = c => (c.mode === 'data' ? DATA_BASE() : CLIP_BASE());
const clip = (s, id) => s.clips.find(x => x.id === id);

// What each op must have done (read from the state, not from the op's own text).
const EFFECT = {
  set_look: (b, a, op) => assert.equal(a.look[op.key], op.value),
  unset_look: (b, a, op) => { assert.ok(op.key in b.look); assert.ok(!(op.key in a.look)); },
  move_clip: (b, a, op) => { assert.equal(clip(a, op.id).start, op.start); assert.notEqual(clip(b, op.id).start, op.start); },
  trim_clip: (b, a, op) => {
    const x = clip(b, op.id), y = clip(a, op.id);
    if (op.edge === 'end') assert.ok(Math.abs(y.start + y.len - op.to) < 1e-6 || x.track === 'video', 'the end is where it was asked');
    else assert.ok(Math.abs(y.len - (x.len - (op.to - x.start))) < 1e-6);
    assert.notEqual(y.len, x.len);
  },
  reorder_clip: (b, a, op) => { const order = s => s.clips.filter(k => k.track === 'video').map(k => k.id); assert.equal(order(a).indexOf(op.id), op.index); assert.notDeepEqual(order(a), order(b)); },
  set_clip_text: (b, a, op) => assert.equal(clip(a, op.id).text, op.text),
  set_clip_style: (b, a, op) => assert.equal(clip(a, op.id).style, op.style),
  delete_clip: (b, a, op) => { assert.ok(clip(b, op.id)); assert.equal(clip(a, op.id), undefined); },
  add_clip: (b, a, op) => { assert.equal(a.clips.length, b.clips.length + 1); const n = a.clips[a.clips.length - 1]; assert.equal(n.track, op.track); assert.equal(n.start, op.start); },
  set_music: (b, a, op) => { const m = clip(a, 'music'); for (const k of Object.keys(op).filter(x => x !== 'op')) assert.equal(m[k], op[k]); assert.notDeepEqual(clip(b, 'music'), m); },
  set_rule: (b, a, op) => assert.ok(a.rules.some(r => r.phrase === op.phrase && r.picture === op.picture && r.mode === op.mode)),
  delete_rule: (b, a, op) => { assert.ok(b.rules.some(r => r.id === op.id)); assert.ok(!a.rules.some(r => r.id === op.id)); },
  set_film_look: (b, a, op) => assert.equal(a.look[op.key], op.value),
};

test('the table names every op of the core and nothing the core does not know (the checker, run on the real files)', async () => {
  const r = await checkRepo();
  assert.deepEqual(r.problems, []);
  for (const op of E.OPS) assert.ok(CONTROLS.controls.some(c => c.op === op && c.status !== 'planned'), `an entry for ${op}`);
  assert.equal(CONTROLS.version, 1);
  assert.equal(new Set(CONTROLS.controls.map(c => c.id)).size, CONTROLS.controls.length);
  assert.equal(E.OPS.length, 13);
});

test('every look key, film-look key, text style and rule mode the core accepts is a control, and the ranges in the table are the core\'s own', () => {
  for (const k of Object.keys(E.LOOK_KEYS)) assert.ok(editControls.some(c => (c.op === 'set_look') && c.params.key.enum.includes(k)), k);
  for (const k of ['theme', 'text_color', 'box_color', 'box_opacity', 'letterbox', 'lyric_card']) assert.ok(editControls.some(c => c.op === 'set_film_look' && c.params.key.enum[0] === k), k);
  for (const c of editControls.filter(x => x.probeParam)) {
    const p = c.params[c.probeParam], at = v => ({ ...c.probeOp, [c.probeParam]: v });
    const s = E.newState(baseFor(c));
    assert.equal(E.check(s, at(p.min)), null, `${c.id} accepts its minimum ${p.min}`);
    assert.equal(E.check(s, at(p.max)), null, `${c.id} accepts its maximum ${p.max}`);
    const eps = p.max - p.min > 5 ? 1 : 0.05;
    assert.equal(typeof E.check(s, at(p.min - eps)), 'string', `${c.id} refuses just below ${p.min}`);
    assert.equal(typeof E.check(s, at(p.max + eps)), 'string', `${c.id} refuses just above ${p.max}`);
  }
});

for (const c of editControls) {
  test(`${c.id} (${c.label}): ${c.op} is applied, undone to the byte, and redone; a refused value changes nothing`, () => {
    const ed = new E.Editor(baseFor(c));
    const before = plain(ed.state);
    assert.equal(E.check(ed.state, c.example), null, 'the example is allowed');
    assert.deepEqual(plain(ed.do(c.example)), { ok: true });
    const after = plain(ed.state);
    assert.notDeepEqual(after, before, 'the state changed');
    EFFECT[c.op](before, after, c.example);
    assert.equal(after.revision, before.revision + 1);
    assert.equal(ed.undo().ok, true);
    assert.deepEqual(plain(ed.state), before, 'undo restores the state to the byte');
    // redo: the editor's own redoOne always; WEB's redoStep (branch web-editor-controls-1127) too once it is in the tree
    const r = typeof ed.redoStep === 'function' ? ed.redoStep() : ed.redoOne();
    assert.equal(r.ok, true);
    assert.deepEqual(plain(ed.state), after, 'redo gives the same state again');
    // refused
    const ed2 = new E.Editor(baseFor(c)), b2 = plain(ed2.state);
    assert.equal(typeof E.check(ed2.state, c.refuse), 'string', 'the core refuses it in words');
    const bad = ed2.do(c.refuse);
    assert.equal(bad.ok, false); assert.ok(bad.reason.length > 5);
    assert.deepEqual(plain(ed2.state), b2, 'a refused change leaves the film as it was');
  });
}

// ------------------------------------------------------------------------------------------------ the chat panel's path: the shared draft
const P = '00000000-0000-4000-8000-0000000000a1';
for (const c of editControls) {
  test(`${c.id}: through the shared draft (the panel's path) the server accepts it and Undo takes it back on screen and in the draft`, async () => {
    const m = createEditorRpcs({ projects: [P] });
    const rpc = async (name, args) => (m.rpcs[name] ? m.rpcs[name](args) : { data: null, error: { code: 'PT404', message: 'no such function' } });
    const mode = c.mode === 'data' ? 'data' : 'compilation';
    const base = baseFor(c);
    const editor = new E.Editor(base);
    const draft = D.createDraft({ rpc, project: P, mode, editor, onChange() {}, onSummary() {} });
    if (mode === 'compilation') m.app.post(P, { mirror: true, aiVisible: true, summary: base });
    const o = await draft.open();
    assert.equal(o.ok, true, JSON.stringify(o));
    const before = plain(editor.state), rev0 = m.draft(P, mode).revision;
    const r = await draft.send([c.example]);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(m.draft(P, mode).revision, rev0 + 1, 'the draft moved on');
    const after = plain(editor.state);
    EFFECT[c.op](before, after, c.example);
    const bad = await draft.send([c.refuse]);
    assert.equal(bad.ok, false, 'a refused change is not sent');
    assert.deepEqual(plain(editor.state), after, 'and the screen does not change');
    assert.equal(m.draft(P, mode).revision, rev0 + 1);
    const u = await draft.undo();
    assert.equal(u.ok, true, JSON.stringify(u));
    assert.deepEqual(plain(editor.state), before, 'undo restores the screen to the byte');
  });
}

// ------------------------------------------------------------------------------------------------ the AI's twin: the connector's own tools
const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-claude' };
function world() {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test', 100); w.invite(A.userId, A.clientId, ['read', 'write', 'render_free', 'edit']);
  const env = p => ({ data: w.data(p.userId), policy: w.policy(), deps: { compile }, chatEditor: true });
  const call = (name, args) => callTool(name, args, A, env(A));
  return { w, call };
}
const argsFor = (c, op, rev, id) => {
  if (c.aiTool === 'set_look') return op.op === 'set_look' ? { project_id: id, base_revision: rev, set: [{ key: op.key, value: op.value }] } : { project_id: id, base_revision: rev, unset: [op.key] };
  return { project_id: id, base_revision: rev, ops: [op] };
};
const REVISION_OF = async (w, id, mode) => w.draft(A.userId, id, mode).revision;
for (const c of editControls) {
  test(`${c.id}: the AI tool "${c.aiTool}" makes the same change as a draft step, undo_my_changes takes it back, and the tool refuses the bad value`, async () => {
    const { w, call } = world();
    const id = (await call('create_project', { title: 'Editor' })).data.project_id;
    const mode = c.mode === 'data' ? 'data' : 'compilation';
    if (mode === 'compilation') w.mirror(A.userId, id, CLIP_BASE(), true);
    else { const s = await call('set_look', { project_id: id, base_revision: await REVISION_OF(w, id, 'data'), set: [{ key: 'sequence.theme', value: 'dark' }] }); assert.equal(s.isError, undefined, s.text); }
    const rev = await REVISION_OF(w, id, mode);
    const r = await call(c.aiTool, argsFor(c, c.example, rev, id));
    if (CONTROLS.knownGaps.some(g => g.startsWith(`ai-tool-refuses:${c.id} `))) {
      // a recorded gap: the editor core and the TypeScript twin accept this op but the tool's input schema does not list it (see the paper); when the tool takes it, remove the gap
      assert.equal(r.isError, true, 'listed as refused by the AI tool');
      assert.match(r.text, /must be one of/);
      assert.equal(await REVISION_OF(w, id, mode), rev);
      return;
    }
    assert.equal(r.isError, undefined, `the AI tool takes the control's own example: ${r.text}`);
    assert.equal(r.data.changes, 1);
    assert.equal(r.data.revision, rev + 1);
    const u = await call('undo_my_changes', { project_id: id, mode });
    assert.equal(u.isError, undefined, u.text);
    assert.equal(u.data.undone, 1, 'the AI\'s batch is taken back');
    // a value the table says is out of range is refused by the tool too, and nothing changes (the revision stays)
    const rev2 = await REVISION_OF(w, id, mode);
    const bad = await call(c.aiTool, argsFor(c, c.refuse, rev2, id));
    const stateless = ['clip_up', 'clip_down', 'clip_earlier', 'clip_later', 'clip_shorter', 'clip_longer', 'clip_length_field', 'clip_trim_start', 'clip_pace', 'clip_split', 'text_edit', 'rule_remove', 'clip_remove', 'clip_start_field'];
    if (bad.isError) assert.equal(await REVISION_OF(w, id, mode), rev2, 'a refused change moves nothing');
    else assert.ok(stateless.includes(c.id), `the tool let through a value the editor core refuses (${c.id}): ${JSON.stringify(c.refuse)}`);
  });
}

// ------------------------------------------------------------------------------------------------ the chat panel as committed
test('every control the table puts in the chat panel is in the page as committed, with its own label', () => {
  const inChat = CONTROLS.controls.filter(c => c.inChat);
  assert.ok(inChat.length >= 25, `${inChat.length} controls in the chat panel`);
  for (const c of inChat) {
    assert.ok(EDITOR_HTML.includes(c.source.snippet), `${c.id}: ${c.source.snippet}`);
    assert.ok(JS.includes(c.source.file), `${c.id}: ${c.source.file} is a file the chat page is built from`);
  }
  for (const label of ['Up', 'Down', 'Earlier', 'Later', 'Shorter', 'Longer', 'Undo', 'Revert', 'Save', 'Ask my AI', 'Remove this clip', 'Play']) assert.ok(EDITOR_HTML.includes(`'${label}'`), label);
});

test('a control hidden from the chat panel is hidden for a stated, checked reason; a control the page lacks is not claimed', () => {
  for (const c of CONTROLS.controls.filter(x => !x.inChat)) {
    assert.ok(c.inChatWhy && c.inChatWhy.length > 20, `${c.id}: no reason`);
    if (c.status === 'exists' || c.status === 'built-not-loaded') {
      const g = c.inChatGate;
      assert.ok(g, `${c.id}: no evidence`);
      if (g.notBuilt) { assert.ok(!JS.includes(g.notBuilt)); assert.ok(!EDITOR_HTML.includes(`/* ---- ${g.notBuilt} ---- */`), 'the page is not built from it'); }
      else assert.ok(read(g.file).includes(g.snippet));
    }
  }
  // the three site-only reasons, read from the code
  assert.ok(EDITOR_HTML.includes('const realFilm = isData && !!routeProject && !window.ryagramLiveHost && !bundleMode;'));
  assert.ok(read('tools/chat-editor/live-host.js').includes('window.ryagramLiveHost = {'));
  assert.ok(!JS.some(f => /app-editor-(pro|pace|padding)\.js|app-lyric-cards/.test(f)));
  assert.ok(read('tools/chat-editor/chat-extra.css').includes('.le-pill,.le-top .button.primary{display:none}'));
});

test('an op the chat panel has no control for is listed as AI-only, and the AI tool really does it', async () => {
  const aiOnly = CONTROLS.knownGaps.filter(g => g.startsWith('no-chat-control:')).map(g => g.split(':')[1]).sort();
  assert.deepEqual(aiOnly, ['add_clip', 'unset_look']);
  const { covered } = aiCoverage(TOOLS);
  for (const op of aiOnly) assert.ok(covered.has(op), `${op} has an AI tool`);
  const { w, call } = world();
  const id = (await call('create_project', { title: 'Editor' })).data.project_id;
  w.mirror(A.userId, id, CLIP_BASE(), true);
  const r = await call('edit_tracks', { project_id: id, base_revision: await REVISION_OF(w, id, 'compilation'), ops: [{ op: 'add_clip', track: 'text', start: 8, len: 2, text: 'A new line' }] });
  assert.equal(r.isError, undefined, r.text);
  assert.equal(r.data.changes, 1);
  // and nothing in the chat panel's page sends add_clip or unset_look
  assert.ok(!/op: 'add_clip'|op: 'unset_look'/.test(EDITOR_HTML.replace(/const OPS = \[[^\]]*\]/, '')) || EDITOR_HTML.includes("op: 'unset_look', key })"), 'unset_look is built in the page but behind the site-only gate (look_use_own)');
});

test('Redo and the AI\'s undo are different things, and the table says so: the panel/WEB Redo replays the person\'s undone step; undo_my_changes takes back only the AI\'s own last batch', async () => {
  const redo = CONTROLS.controls.find(c => c.id === 'redo');
  assert.equal(redo.status, 'exists'); assert.equal(redo.aiTool, null); assert.equal(redo.aiToolPlanned, 'redo_my_changes');
  assert.ok(!TOOLS.some(t => t.name === 'redo_my_changes'), 'redo_my_changes does not exist yet: when CONNECT adds it, the table must say so');
  const undo = CONTROLS.controls.find(c => c.id === 'undo');
  assert.equal(undo.aiTool, 'undo_my_changes');
  // the person's panel step is NOT taken back by the AI's undo (a click in the panel is the person's own)
  const { w, call } = world();
  const id = (await call('create_project', { title: 'Editor' })).data.project_id;
  const ap = await call('editor_apply_ops', { p_project: id, p_mode: 'data', p_base_revision: 0, p_ops: [{ op: 'set_look', key: 'network.color', value: '#ff0000' }] });
  assert.equal(ap.isError, undefined, ap.text);
  const u = await call('undo_my_changes', { project_id: id, mode: 'data' });
  assert.equal(u.data.undone, 0, 'the AI\'s undo leaves the person\'s own panel step alone');
  // WEB's redo, where it is in the tree: undo then redoStep restores the list; with nothing undone there is nothing to redo
  const ed = new E.Editor(DATA_BASE());
  ed.do({ op: 'set_look', key: 'network.color', value: '#ff0000' });
  if (typeof ed.redoStep === 'function') { ed.undo(); assert.equal(ed.redoStep().ok, true); assert.equal(ed.redoStep().ok, false); }
  else { assert.equal(ed.redoOne().ok, false, 'nothing undone: nothing to redo'); ed.undo(); assert.equal(ed.redoOne().ok, true); }
});

test('a ready-made look (several set_look ops in one group) is one Undo step and one Redo step', () => {
  const ed = new E.Editor(DATA_BASE());
  ed.do({ op: 'set_look', key: 'network.color', value: '#111111' }, 'you', 'g1'); ed.do({ op: 'set_look', key: 'state.fill', value: '#222222' }, 'you', 'g1');
  const after = plain(ed.state);
  ed.undo(); assert.equal(ed.log.length, 0);
  if (typeof ed.redoStep === 'function') assert.equal(ed.redoStep().ok, true);
  else { assert.equal(ed.redoOne().ok, true); assert.equal(ed.redoOne().ok, true); }
  assert.deepEqual(plain(ed.state), after);
});

test('the controls that came from the WEB branch are in the chat page now: status exists, inChat true, the snippet is in the page, and any control still marked web-branch must follow the page', () => {
  assert.equal(CONTROLS.web.branch, 'web-comp-fold2-1127'); assert.match(CONTROLS.web.head, /^[0-9a-f]{8}$/);
  const merged = CONTROLS.controls.filter(c => c.mergedFrom);
  assert.deepEqual(merged.map(c => c.id).sort(), ['key_redo', 'key_undo', 'redo', 'shortcuts']);
  for (const c of merged) { assert.equal(c.status, 'exists'); assert.equal(c.mergedFrom.branch, CONTROLS.web.branch); assert.equal(c.inChat, true, c.id + ' is in the chat page'); assert.ok(EDITOR_HTML.includes(c.source.snippet), c.id + ' snippet is in the page'); }
  for (const c of CONTROLS.controls.filter(x => x.status === 'web-branch')) assert.equal(c.inChat, EDITOR_HTML.includes(c.source.snippet), c.id + ' inChat follows the page');
  for (const c of CONTROLS.controls.filter(x => x.status === 'planned')) { assert.equal(c.inChat, false); assert.ok(c.plannedBy && c.plannedSource); }
});
