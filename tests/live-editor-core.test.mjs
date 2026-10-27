// The live editor's logic (assets/app-editor-core.js, NEXT-WEB 152): ops from a closed list, each checked and undoable; the video lane stays one run;
// snapping; the AI's ops arrive tagged, against a revision, and can be undone as a group; the person's undo can not be silently repeated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const window = {};
vm.runInNewContext(fs.readFileSync(path.join(here, '..', 'assets/app-editor-core.js'), 'utf8'), { window, Error, Math, Number, Array, Object, String, JSON, Set, RegExp });
const E = window.ryagramEditor;
const plain = x => JSON.parse(JSON.stringify(x));

const base = () => ({
  look: { 'network.color': '#6fd1bd' },
  duration: 12,
  clips: [
    { id: 'v1', track: 'video', start: 0, len: 2, label: 'one' },
    { id: 'v2', track: 'video', start: 2, len: 2, label: 'two' },
    { id: 'v3', track: 'video', start: 4, len: 3, label: 'three' },
    { id: 'p1', track: 'pictures', start: 5, len: 2, label: 'rent chart' },
    { id: 't1', track: 'text', start: 1, len: 3, label: 'Title', text: 'Housing' },
    { id: 'm1', track: 'music', start: 0, len: 12, label: 'music' }
  ]
});
const ed = () => new E.Editor(base());

test('the op list is closed: an unknown op, a missing clip and an unknown or hostile look key are refused with plain words', () => {
  const s = E.newState(base());
  for (const op of [null, 5, {}, { op: 'drop_table' }, { op: 'set_look', key: 'theme.evil', value: '#000000' }, { op: 'set_look', key: '__proto__', value: '#000000' },
                    { op: 'set_look', key: 'constructor', value: '#000000' }, { op: 'move_clip', id: 'nope', start: 1 }]) {
    assert.equal(typeof E.check(s, op), 'string', JSON.stringify(op));
  }
  assert.equal(E.check(s, { op: 'set_look', key: 'network.color', value: '#112233' }), null);                  // control
  for (const v of ['red', '#12345', '#GGGGGG', 123, null, '#1234567']) assert.equal(typeof E.check(s, { op: 'set_look', key: 'network.color', value: v }), 'string', String(v));
});

test('apply is pure: the state it is given is never changed, and the revision goes up by one', () => {
  const s = E.newState(base()), before = plain(s);
  const n = E.apply(s, { op: 'set_look', key: 'page.background', value: '#000000' });
  assert.deepEqual(plain(s), before);
  assert.equal(n.revision, 1);
  assert.equal(n.look['page.background'], '#000000');
});

test('a picture, text or music clip moves inside the film; a video clip does not move by hand', () => {
  const s = E.newState(base());
  assert.equal(E.check(s, { op: 'move_clip', id: 'p1', start: 6 }), null);
  assert.equal(E.apply(s, { op: 'move_clip', id: 'p1', start: 6 }).clips.find(c => c.id === 'p1').start, 6);
  assert.match(E.check(s, { op: 'move_clip', id: 'p1', start: 11 }), /outside the film/);                     // 11 + 2 > 12
  assert.match(E.check(s, { op: 'move_clip', id: 'p1', start: -1 }), /outside/);
  assert.match(E.check(s, { op: 'move_clip', id: 'v1', start: 3 }), /Reorder/);
  assert.match(E.check(s, { op: 'move_clip', id: 'p1', start: NaN }), /outside/);
});

test('trimming never makes a clip shorter than the minimum, and a video trim packs the next clips up', () => {
  const s = E.newState(base());
  assert.match(E.check(s, { op: 'trim_clip', id: 'p1', edge: 'end', to: 5.1 }), /shorter than 0.3/);          // 0.1 s
  assert.equal(E.check(s, { op: 'trim_clip', id: 'p1', edge: 'end', to: 5.3 }), null);                         // exactly the minimum
  assert.match(E.check(s, { op: 'trim_clip', id: 'p1', edge: 'start', to: 7 }), /shorter/);
  const n = E.apply(s, { op: 'trim_clip', id: 'v1', edge: 'end', to: 1 });
  assert.deepEqual(plain(n.clips.filter(c => c.track === 'video').map(c => [c.id, c.start, c.len])), [['v1', 0, 1], ['v2', 1, 2], ['v3', 3, 3]]);
  assert.equal(E.check(s, { op: 'trim_clip', id: 'v2', edge: 'start', to: 2.5 }), null);                       // a video clip's start can be cut now (the file's start moves)
  const p = E.apply(s, { op: 'trim_clip', id: 'p1', edge: 'start', to: 5.5 }).clips.find(c => c.id === 'p1');
  assert.deepEqual([p.start, p.len], [5.5, 1.5]);                                                                // the end stays where it was
  assert.match(E.check(s, { op: 'trim_clip', id: 'm1', edge: 'end', to: 13 }), /outside/);
});

test('reordering the video lane keeps it one run with no gaps and no overlap', () => {
  const s = E.newState(base());
  const n = E.apply(s, { op: 'reorder_clip', id: 'v3', index: 0 });
  const vids = n.clips.filter(c => c.track === 'video');
  assert.deepEqual(plain(vids.map(c => c.id)), ['v3', 'v1', 'v2']);
  assert.deepEqual(plain(vids.map(c => c.start)), [0, 3, 5]);
  assert.equal(vids.at(-1).start + vids.at(-1).len, 7);
  assert.match(E.check(s, { op: 'reorder_clip', id: 'v3', index: 3 }), /no such place/);
  assert.match(E.check(s, { op: 'reorder_clip', id: 'v3', index: -1 }), /no such place/);
  assert.match(E.check(s, { op: 'reorder_clip', id: 'v3', index: 1.5 }), /no such place/);
  assert.match(E.check(s, { op: 'reorder_clip', id: 'p1', index: 0 }), /Only video/);
  assert.equal(n.clips.filter(c => c.track !== 'video').length, 3);                                              // the other lanes are untouched
});

test('deleting a video clip closes the gap; text is data (capped, no markup, no direction tricks)', () => {
  const s = E.newState(base());
  assert.deepEqual(plain(E.apply(s, { op: 'delete_clip', id: 'v1' }).clips.filter(c => c.track === 'video').map(c => c.start)), [0, 2]);
  assert.match(E.check(s, { op: 'set_clip_text', id: 'v1', text: 'x' }), /Only a text clip/);
  const dirty = 'Hello <img src=x onerror=1>' + String.fromCharCode(0x202e) + 'evil' + String.fromCharCode(1) + 'x'.repeat(500);
  const t = E.apply(s, { op: 'set_clip_text', id: 't1', text: dirty }).clips.find(c => c.id === 't1').text;
  assert.ok(!/[<>]/.test(t));
  assert.ok(!t.includes(String.fromCharCode(0x202e)) && !t.includes(String.fromCharCode(1)));
  assert.ok(t.length <= 200);
  assert.match(t, /^Hello img src=x onerror=1evil/);
});

test('snapping goes to the playhead, then to another clip\'s edge, then to the grid, only within reach', () => {
  const s = E.newState(base());
  assert.equal(E.snap(s, 'p1', 3.08, { playhead: 3 }), 3);                                                       // near the playhead
  assert.equal(E.snap(s, 'p1', 6.9), 7);                                                                         // the end of v3 (7) is within reach
  assert.equal(E.snap(s, 'p1', 8.43, { grid: 0.1 }), 8.4);                                                       // nothing within reach: the grid
  assert.equal(E.snap(s, 'p1', 3.95), 4);                                                                        // the start of v3 (4)
  assert.equal(E.snap(s, 'p1', 2.2, { playhead: 9 }), 2.2);                                                      // nothing within reach: the grid value
  assert.equal(E.snap(s, 'p1', -3), 0);                                                                          // never before the start
});

test('undo and redo walk the log; revert goes back to the base; an op that no longer applies is dropped, not forced', () => {
  const e = ed();
  assert.equal(e.do({ op: 'set_look', key: 'network.color', value: '#ff0000' }).ok, true);
  assert.equal(e.do({ op: 'reorder_clip', id: 'v3', index: 0 }).ok, true);
  assert.equal(e.state.clips[0].id, 'v3');
  e.undo();
  assert.equal(e.state.clips[0].id, 'v1');
  assert.equal(e.state.look['network.color'], '#ff0000');
  e.redoOne();
  assert.equal(e.state.clips[0].id, 'v3');
  e.undo(); e.undo();
  assert.equal(e.state.look['network.color'], '#6fd1bd');
  assert.equal(e.undo().ok, false);                                                                              // nothing left
  e.redoOne(); e.redoOne();                                                                                      // both redos work in turn
  assert.equal(e.state.clips[0].id, 'v3');
  e.revert();
  assert.deepEqual(plain(e.state), plain(E.newState(base())));
  assert.deepEqual(e.do({ op: 'move_clip', id: 'v1', start: 1 }).ok, false);                                    // a refused op changes nothing
  assert.equal(e.log.length, 0);
});

test('the AI\'s ops: only against the current revision, all or none, at most 20, and tagged so the banner can name them', () => {
  const e = ed();
  const r0 = e.revision;
  assert.deepEqual(plain(e.receive([{ op: 'set_look', key: 'network.color', value: '#00ff00' }], r0 + 5)), { ok: false, reason: 'stale', revision: r0 });
  assert.equal(e.state.look['network.color'], '#6fd1bd');                                                        // nothing applied
  const bad = e.receive([{ op: 'set_look', key: 'network.color', value: '#00ff00' }, { op: 'delete_clip', id: 'ghost' }], r0);
  assert.equal(bad.ok, false);
  assert.equal(e.state.look['network.color'], '#6fd1bd');                                                        // the first op did not slip in
  assert.equal(e.receive(Array(21).fill({ op: 'set_look', key: 'network.color', value: '#00ff00' }), r0).ok, false);
  const ok = e.receive([{ op: 'set_look', key: 'network.color', value: '#00ff00' }, { op: 'move_clip', id: 'p1', start: 6 }], r0);
  assert.deepEqual(plain(ok), { ok: true, count: 2 });
  assert.deepEqual(plain(e.log.map(x => x.by)), ['ai', 'ai']);
  assert.deepEqual(plain(e.aiTouched()), ['look:network.color', 'clip:p1']);
  assert.equal(e.revision, r0 + 2);
});

test('Undo my AI\'s changes removes only the AI\'s ops and keeps the person\'s', () => {
  const e = ed();
  e.do({ op: 'reorder_clip', id: 'v3', index: 0 });
  e.receive([{ op: 'set_look', key: 'network.color', value: '#00ff00' }], e.revision);
  e.do({ op: 'set_clip_text', id: 't1', text: 'Mine' });
  assert.deepEqual(plain(e.undoAi()), { ok: true, count: 1 });
  assert.equal(e.state.look['network.color'], '#6fd1bd');
  assert.equal(e.state.clips[0].id, 'v3');
  assert.equal(e.state.clips.find(c => c.id === 't1').text, 'Mine');
  assert.deepEqual(plain(e.log.map(x => x.by)), ['you', 'you']);
  assert.equal(e.undoAi().ok, false);                                                                            // nothing of the AI's left
});

test('an op the person undid can not be silently repeated by the AI; a changed value can', () => {
  const e = ed();
  e.do({ op: 'set_look', key: 'network.color', value: '#112233' });
  e.undo();
  const same = e.receive([{ op: 'set_look', key: 'network.color', value: '#112233' }], e.revision);
  assert.equal(same.ok, false);
  assert.match(same.reason, /just undid/);
  assert.equal(e.state.look['network.color'], '#6fd1bd');
  assert.equal(e.receive([{ op: 'set_look', key: 'network.color', value: '#445566' }], e.revision).ok, true);   // control: a different value is a new change
  e.undoAi();
  const again = e.receive([{ op: 'set_look', key: 'network.color', value: '#445566' }], e.revision);             // the person undid the AI's change: not repeated either
  assert.equal(again.ok, false);
});

test('the ops the page sends are exactly the closed list, and every one of them is checked', () => {
  assert.deepEqual(plain(E.OPS), ['set_look', 'unset_look', 'move_clip', 'trim_clip', 'reorder_clip', 'set_clip_text', 'delete_clip', 'add_clip']);
  const s = E.newState(base());
  for (const op of E.OPS) assert.equal(typeof E.check(s, { op }), 'string', op + ' with no arguments must be refused');
  assert.deepEqual(plain(Object.keys(E.LOOK_KEYS).sort()), ['network.base_color', 'network.color', 'network.context_color', 'page.background', 'state.fill']);
});

test('speaker, voice and cast fields are local-only (FACES 62): stripped from any clip that arrives, never in the state, the log or an undo; the AI-altered marker (FACES 63) is kept through every op', () => {
  const b = base();
  b.clips[0].speaker = 'Ann'; b.clips[0].speaker_state = 'one'; b.clips[1].voice = 'v-9'; b.clips[2].cast_badge = { line: 1, person: 'Bob' }; b.clips[2].faces = ['x'];
  b.clips[1].ai_altered = true; b.clips[1].ai_altered_by = 'face tool';
  const s = E.newState(b);
  for (const c of s.clips) for (const k of E.LOCAL_ONLY) assert.ok(!(k in c), `${c.id} still has ${k}`);
  assert.equal(JSON.stringify(s).includes('Ann'), false);
  assert.equal(JSON.stringify(s).includes('v-9'), false);
  const e = new E.Editor(b);
  e.do({ op: 'reorder_clip', id: 'v2', index: 0 });
  e.do({ op: 'trim_clip', id: 'v2', edge: 'end', to: 1.5 });
  e.receive([{ op: 'delete_clip', id: 'v1' }], e.revision);
  e.undo();
  const v4 = e.state.clips.find(c => c.id === 'v2');
  assert.equal(v4.ai_altered, true);
  assert.equal(v4.ai_altered_by, 'face tool');
  e.undoAi(); e.revert();
  assert.equal(e.state.clips.find(c => c.id === 'v2').ai_altered, true);
  assert.equal(JSON.stringify([e.log, e.state]).includes('Ann'), false);
  assert.deepEqual(plain(E.LOCAL_ONLY).includes('ai_altered'), false);                                 // the marker is never on the strip list
});

test('per-clip limits (BUILDER 21): a video clip trimmed at its start moves source_start and the run packs again; before the file start and past its end are refused; min_len and max_len bind', () => {
  const b = base();
  b.clips[1] = { ...b.clips[1], source: 'a.mp4', source_start: 1, min_len: 0.3, max_len: 3 };            // v2: 2 s long, starts 1 s into a.mp4, 3 s of file left
  const s = E.newState(b);
  const cut = E.apply(s, { op: 'trim_clip', id: 'v2', edge: 'start', to: 2.5 });
  const v2 = cut.clips.find(c => c.id === 'v2');
  assert.deepEqual(plain([v2.source_start, v2.len, v2.max_len, v2.source]), [1.5, 1.5, 2.5, 'a.mp4']);
  assert.deepEqual(plain(cut.clips.filter(c => c.track === 'video').map(c => [c.id, c.start])), [['v1', 0], ['v2', 2], ['v3', 3.5]]);
  assert.match(E.check(s, { op: 'trim_clip', id: 'v2', edge: 'start', to: 0.9 }), /before the start of the video file/);               // 1.1 s earlier, only 1 s of file before
  assert.match(E.check(s, { op: 'trim_clip', id: 'v2', edge: 'end', to: 5.5 }), /past the end of the video file/);                 // 3.5 s > 3 s of file
  assert.equal(E.check(s, { op: 'trim_clip', id: 'v2', edge: 'end', to: 5 }), null);                                                  // exactly the rest of the file
  const near = E.newState({ ...b, clips: b.clips.map(c => (c.id === 'v2' ? { ...c, source_start: 0.5, max_len: 3.5 } : c)) });
  assert.match(E.check(near, { op: 'trim_clip', id: 'v2', edge: 'start', to: 1.4 }), /before the start of the video file/);        // 0.6 s earlier, only 0.5 s of file before
  assert.equal(E.check(near, { op: 'trim_clip', id: 'v2', edge: 'start', to: 1.5 }), null);
  const sl = E.newState({ duration: 12, clips: [{ id: 's1', track: 'video', start: 0, len: 5, label: 'slide', picture: 'p', min_len: 0.5, max_len: 10 }] });
  assert.match(E.check(sl, { op: 'trim_clip', id: 's1', edge: 'end', to: 0.4 }), /shorter than 0.5/);
  assert.match(E.check(sl, { op: 'trim_clip', id: 's1', edge: 'end', to: 10.5 }), /past the end/);
  const t = E.newState({ duration: 12, clips: [{ id: 't', track: 'text', start: 1, len: 2, label: 'T', text: 'hi', min_len: 0.5, max_len: 30 }] });
  assert.match(E.check(t, { op: 'trim_clip', id: 't', edge: 'end', to: 1.2 }), /shorter than 0.5/);
});

test('lanes the maker can build (BUILDER 21): an edit in any other lane is refused; the text cap comes from limits and is refused, not silently cut', () => {
  const b = { ...base(), lanes: ['video', 'text'], limits: { text_chars: 20 } };
  const s = E.newState(b);
  assert.deepEqual(plain(s.lanes), ['video', 'text']);
  assert.match(E.check(s, { op: 'move_clip', id: 'p1', start: 6 }), /can not be edited here yet/);
  assert.match(E.check(s, { op: 'delete_clip', id: 'm1' }), /can not be edited here yet/);
  assert.equal(E.check(s, { op: 'reorder_clip', id: 'v3', index: 0 }), null);                                  // control: a video clip is fine
  assert.equal(E.check(s, { op: 'set_clip_text', id: 't1', text: 'twenty letters long!' }), null);              // exactly 20
  assert.match(E.check(s, { op: 'set_clip_text', id: 't1', text: 'twenty-one letters 1.' }), /at most 20 letters/);
  assert.equal(E.newState({ ...base(), lanes: ['video', 'nonsense'] }).lanes.includes('nonsense'), false);       // an unknown lane name is dropped
  assert.equal(E.newState(base()).lanes, undefined);                                                            // no summary lanes: nothing is hidden (the mock)
});

test('the AI-altered marker follows the FOOTAGE (CC1 10:37): a clip whose stretch of the same file overlaps a stretch marked when the editor opened shows as marked, even after the marked clip is deleted', () => {
  const clips = [
    { id: 'A', track: 'video', start: 0, len: 10, label: 'A', source: 'x.mp4', source_start: 10, max_len: 100, ai_altered: true },
    { id: 'B', track: 'video', start: 10, len: 10, label: 'B', source: 'x.mp4', source_start: 20, max_len: 100 },
    { id: 'C', track: 'video', start: 20, len: 5, label: 'C', source: 'y.mp4', source_start: 10, max_len: 100 },
    { id: 'D', track: 'video', start: 25, len: 5, label: 'D', source: 'x.mp4', source_start: 40, max_len: 100 }
  ];
  const e = new E.Editor({ duration: 40, clips });
  const marked = id => E.isMarked(e.base, e.state.clips.find(c => c.id === id));
  assert.deepEqual(plain(['A', 'B', 'C', 'D'].map(marked)), [true, false, false, false]);                      // touching at 20 s is not overlapping; another file is not; a later stretch is not
  assert.equal(e.do({ op: 'trim_clip', id: 'B', edge: 'start', to: 5 }).ok, true);                             // the lane time 5 is 5 s before B's start: B now begins 5 s earlier in the file (15 to 30), overlapping A's 10 to 20
  assert.equal(marked('B'), true);
  assert.equal(e.do({ op: 'delete_clip', id: 'A' }).ok, true);                                                 // the evidence clip is gone ...
  assert.equal(marked('B'), true);                                                                              // ... the footage is still marked
  assert.equal(marked('C'), false);
  e.undo(); e.undo();
  assert.equal(marked('B'), false);                                                                             // undone back to 20 to 30
  // BUILDER 10:43: a marked clip trimmed OFF the altered footage is built unmarked, so the page shows it unmarked; a clip with no recorded source keeps its own marker
  const off = { id: 'A', track: 'video', start: 0, len: 3, label: 'A', source: 'x.mp4', source_start: 21, ai_altered: true };
  assert.equal(E.isMarked(e.base, off), false);
  assert.equal(E.isMarked(e.base, { id: 'q', track: 'video', start: 0, len: 2, label: 'q', ai_altered: true }), true);
  assert.equal(E.isMarked(e.base, { id: 'z', track: 'video', start: 0, len: 2, label: 'z' }), false);        // no source recorded: nothing to compare, not marked by guesswork
  assert.equal(E.isMarked(e.base, { id: 'z', track: 'text', start: 0, len: 2, label: 'z', ai_altered: true }), true);   // its own marker always counts
});
