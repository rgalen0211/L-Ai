// Must-fail proof for tests/connect-editor-controls-1127.test.mjs and tools/chat-editor/controls_check.mjs (the editor's one control table): each mutant plants ONE fault (or, where marked, a fault
// plus the removal of the check that would have caught it) in a scratch copy, regenerates the chat page from the broken sources, and the suite must then FAIL. A baseline run on the unbroken copy
// must PASS first. Every text mutant must match exactly once; a JSON mutant is a function that edits the parsed table and must change it.
// Run:  node tests/connect_editor_controls_mutants.mjs         (run it ALONE, one at a time in this tree; the scratch is .mut-dm/edctl, never deleted: each mutant starts by copying the originals back over it)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-dm', 'edctl');
const TABLE = 'tools/chat-editor/controls.json', CORE = 'assets/app-editor-core.js', DRAFT = 'assets/app-editor-draft.js', APP = 'assets/app-editor.js', TOOLS = 'supabase/functions/connect-core/tools.ts', CHECK = 'tools/chat-editor/controls_check.mjs';
const SUITE = 'tests/connect-editor-controls-1127.test.mjs';

const json = fn => src => { const d = JSON.parse(src); fn(d); const out = JSON.stringify(d, null, 2); if (out === JSON.stringify(JSON.parse(src), null, 2)) throw new Error('the JSON mutant changed nothing'); return out; };
const ctl = (d, id) => { const c = d.controls.find(x => x.id === id); if (!c) throw new Error('no control ' + id); return c; };
const text = (from, to) => src => { const n = src.split(from).length - 1; if (n !== 1) throw new Error(`text found ${n} times, need 1: ${from.slice(0, 60)}`); return src.replace(from, () => to); };

// [name, [[file, edit], ...]]
const mutants = [
  // ---- the table loses or mislabels an entry
  ['an op is removed from the table (delete_clip)', [[TABLE, json(d => { d.controls = d.controls.filter(c => c.op !== 'delete_clip'); })]]],
  ['all the rule controls are removed (set_rule) and the known gap list is left', [[TABLE, json(d => { d.controls = d.controls.filter(c => c.op !== 'set_rule'); })]]],
  ['a control is pointed at an op the core does not know', [[TABLE, json(d => { ctl(d, 'clip_up').op = 'flip_clip'; })]]],
  ['a control is renamed (its button text no longer matches the page)', [[TABLE, json(d => { ctl(d, 'clip_up').source.snippet = "btn('Upward', 'secondary', () => apply({ op: 'reorder_clip'"; })]]],
  ['a control id is used twice', [[TABLE, json(d => { ctl(d, 'clip_down').id = 'clip_up'; })]]],
  ['a control names an AI tool that does not exist', [[TABLE, json(d => { ctl(d, 'music_level').aiTool = 'edit_music'; })]]],
  ['a control names an AI tool that does not take its op', [[TABLE, json(d => { ctl(d, 'clip_up').aiTool = 'set_look'; })]]],
  ['a look key the core accepts has no control (state.fill)', [[TABLE, json(d => { d.controls = d.controls.filter(c => c.id !== 'look_state_fill'); })]]],
  ['a control says it is in the chat panel, and the gate evidence is left (Theme)', [[TABLE, json(d => { ctl(d, 'look_theme').inChat = true; })]]],
  ['a control the page shows is marked as not in the chat panel with no evidence (Up)', [[TABLE, json(d => { const c = ctl(d, 'clip_up'); c.inChat = false; c.inChatWhy = 'it is hidden because I say so, and nothing proves it'; })]]],
  ['a range in the table is wrong (loudness maximum 7)', [[TABLE, json(d => { ctl(d, 'music_level').params.level_db.max = 7; })]]],
  ['a control from a file the chat page is not built from is claimed in the chat panel (Split)', [[TABLE, json(d => { const c = ctl(d, 'clip_split'); c.inChat = true; delete c.inChatGate; delete c.inChatWhy; })]]],
  ['a known gap is dropped (add_clip has no chat control)', [[TABLE, json(d => { d.knownGaps = d.knownGaps.filter(g => g !== 'no-chat-control:add_clip'); })]]],
  ['a known gap that is not a gap is added', [[TABLE, json(d => { d.knownGaps.push('no-chat-control:move_clip'); })]]],
  ['a planned control is marked as existing', [[TABLE, json(d => { const c = ctl(d, 'planned_text_size'); c.status = 'exists'; c.op = 'set_look'; })]]],
  ['a control that is in the chat page is marked as still on the web branch (Redo)', [[TABLE, json(d => { const c = ctl(d, 'redo'); c.status = 'web-branch'; c.web = { branch: 'web-editor-controls-1127', head: 'b886295e' }; })]]],
  ['a merged control is marked as not in the chat page (Redo)', [[TABLE, json(d => { ctl(d, 'redo').inChat = false; })]]],
  ['an example is not an op of the control', [[TABLE, json(d => { ctl(d, 'text_style').example = { op: 'set_clip_text', id: 't1', text: 'x' }; })]]],
  // ---- the code grows or loses something the table must follow
  ['the core learns a new op that has no entry', [[CORE, text("'delete_rule', 'set_film_look'];", "'delete_rule', 'set_film_look', 'set_title_text'];")]]],
  ['the core forgets an op the table names (delete_rule)', [[CORE, text("'set_rule', 'delete_rule', 'set_film_look'];", "'set_rule', 'set_film_look'];")]]],
  ['the core accepts a new look key that has no control', [[CORE, text("'sequence.theme': v => v === 'light' || v === 'dark'", "'sequence.theme': v => v === 'light' || v === 'dark', 'text.scale': v => typeof v === 'number'")]]],
  ['the core accepts a new film-look key that has no control', [[CORE, text("'box_opacity', 'letterbox', 'lyric_card'];", "'box_opacity', 'letterbox', 'lyric_card', 'shadow'];")]]],
  ['the core takes a fourth text style', [[CORE, text("const STYLES = ['title', 'caption', 'lower_third'];", "const STYLES = ['title', 'caption', 'lower_third', 'huge'];")]]],
  ['the loudness range of the core moves (7)', [[CORE, text("!inRange(op.level_db, -30, 6)", "!inRange(op.level_db, -30, 7)")]]],
  ['the connector drops an op from edit_tracks (set_rule)', [[TOOLS, text('"set_clip_style", "set_music", "set_rule", "delete_rule", "set_film_look"] },', '"set_clip_style", "set_music", "delete_rule", "set_film_look"] },')]]],
  ['the connector renames an AI tool (undo_my_changes)', [[TOOLS, text('name: "undo_my_changes"', 'name: "undo_mine"')]]],
  ['the connector\'s tool range for fades moves (fade_in_s maximum 9)', [[TOOLS, text('fade_in_s: { type: "number", minimum: 0, maximum: 5 }', 'fade_in_s: { type: "number", minimum: 0, maximum: 9 }')]]],
  // ---- behaviour the per-control tests prove
  ['Undo does not restore the film (core)', [[CORE, text('this.state = this._replay(this.log).s;', 'this.state = this.state;')]]],
  ['a text style is not applied', [[CORE, text('c.style = op.style;', '')]]],
  ['the draft\'s undo does not reach the screen', [[DRAFT, text('      editor.undo();\n      return { ok: true };', '      return { ok: true };')]]],
  ['a colour is not checked (any text is a colour)', [[CORE, text("const COLOR = v => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);", 'const COLOR = v => typeof v === \'string\';')]]],
  // ---- the page loses a control
  ['the Up button is gone from the page', [[APP, text("btn('Up', 'secondary', () => apply({ op: 'reorder_clip'", "btn('Upp', 'secondary', () => apply({ op: 'reorder_clip'")]]],
  ['the loudness field is gone from the page', [[APP, text("mnum('level_db', 'Loudness (dB, -30 to 6)'", "mnum('level_db', 'Volume'")]]],
  // ---- the checker itself loses a rule while the table has the matching fault (the test's own independent assertions must still fail)
  ['the checker no longer reports a missing entry, and delete_clip has no entry', [[CHECK, text('bad(`NO ENTRY for op "${op}": the core knows it and controls.json has no control for it`)', '0')], [TABLE, json(d => { d.controls = d.controls.filter(c => c.op !== 'delete_clip'); })]]],
  ['the checker no longer checks the AI tool names, and a control names a missing tool', [[CHECK, text('if (!byName.has(c.aiTool)) bad(', 'if (false) bad(')], [TABLE, json(d => { ctl(d, 'music_level').aiTool = 'edit_music'; })]]],
];

const copy = (rel) => fs.cpSync(path.join(root, rel), path.join(scratch, rel), { recursive: true, force: true });
function fresh() {
  fs.mkdirSync(scratch, { recursive: true });
  for (const d of ['supabase/functions', 'tools/chat-editor', 'tools/maker-live', 'assets']) copy(d);
  for (const f of ['tools/build-chat-editor.mjs', 'package.json', SUITE, 'tests/fake-editor-rpcs.js']) { fs.mkdirSync(path.dirname(path.join(scratch, f)), { recursive: true }); fs.copyFileSync(path.join(root, f), path.join(scratch, f)); }
}
function run() {
  // the page is REGENERATED from the broken sources, so "the committed page equals the generator" is not the only thing that can notice a lost control
  const gen = spawnSync(process.execPath, ['--no-warnings', path.join('tools', 'build-chat-editor.mjs')], { encoding: 'utf8', cwd: scratch });
  if (gen.status) return { status: gen.status, out: gen.stderr };
  const r = spawnSync(process.execPath, ['--no-warnings', '--test', '--test-timeout=120000', SUITE], { encoding: 'utf8', cwd: scratch, timeout: 300000, killSignal: 'SIGKILL' });
  if (r.error) throw new Error('HUNG or crashed: ' + r.error.code);
  return { status: r.status, out: r.stdout + r.stderr };
}
fresh();
const base = run();
if (base.status) { console.log('BASELINE FAILS (nothing proved)\n' + base.out.split('\n').filter(l => /^✖|not ok/.test(l)).slice(0, 8).join('\n')); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, edits] of mutants) {
  fresh();
  try { for (const [file, fn] of edits) { const t = path.join(scratch, file); fs.writeFileSync(t, fn(fs.readFileSync(t, 'utf8').replace(/\r\n/g, '\n'))); } }
  catch (e) { console.log(`BROKEN MUTANT (${e.message}): ${name}`); missed++; continue; }
  const r = run();
  const caught = r.status !== 0 && /^✖|not ok|FAIL/m.test(r.out);
  const lines = r.out.split(/\r?\n/);
  const why = (lines.find(l => /^✖ /.test(l) && !/failing tests/.test(l)) || lines.find(l => /^FAIL /.test(l)) || '').replace(/\s*\(\d[\d.]*ms\)$/, '').slice(0, 110);
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}${why ? '  <- ' + why : ''}`);
  if (!caught) missed++;
}
fresh();            // leave the scratch holding the unbroken copy
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
