// The edit list of a clip film and the edit page's rules (tools/maker-edit/; NEXT-WEB 120). Pure model tests plus source checks; the page itself is driven in real Chrome by tools/check-maker-edit.py.
// What it guarantees: every edit passes the one validator or is refused in plain words; the rule "every time <phrase> is said, show <picture>" finds every occurrence in the BUILT film (across clip borders,
// after reordering) and never guesses; a picture without its rights tick never draws; what is on screen at a second is a pure function of the edit list, and save then open gives the same list and the
// same picture at every moment; the page writes no HTML from text, makes no call but to its own maker, and carries a locked-down content policy.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const M = require('../tools/maker-edit/edit-model.js');

const win = { sessionStorage: { getItem: () => null, setItem() {} } };
vm.runInNewContext(read('tools/maker-edit/fixture.js'), { window: win, sessionStorage: win.sessionStorage, setTimeout });
const base = M.normalize(await win.ryagramEditFixtureHost.load());
const PIC = { id: 'img-demo', file_name: 'demo-star.png', sha256: 'ab'.repeat(32), width: 400, height: 300 };
const withPic = (e = base, ticked = true) => M.ops.setRights(M.ops.addImage(e, PIC), PIC.id, ticked);
const withRule = (e = withPic(), r = {}) => M.ops.addRule(e, { phrase: 'great news', image_id: PIC.id, seconds: 2, mode: 'full', fade_s: 0.2, ...r });
const clone = o => JSON.parse(JSON.stringify(o));
const refuses = (fn, re) => assert.throws(fn, e => e instanceof M.EditError && re.test(e.message), String(re));

test('THE PRACTICE CUT IS A VALID EDIT LIST: six clips, dark by default, captions off, no pictures', () => {
  assert.equal(base.clips.length, 6);
  assert.equal(base.look.theme, 'dark');
  assert.equal(base.captions.on, false);
  assert.deepEqual(base.images, []);
  assert.equal(M.timeline(base).clips.length, 6);
  assert.ok(M.timeline(base).total_s > 5);
});

test('ONE VALIDATOR: bad lists are refused in plain words, never half-accepted', () => {
  const bad = (patch, re) => { const x = clone(base); patch(x); refuses(() => M.normalize(x), re); };
  bad(x => { x.schema = 'other/9'; }, /different version/);
  bad(x => { x.clips[0].file_name = 'C:\\Users\\sam\\video.mp4'; }, /by name only/);
  bad(x => { x.clips[0].file_name = '../video.mp4'; }, /by name only/);
  bad(x => { x.clips[0].out_s = x.clips[0].in_s + 0.1; }, /at least 0\.3/);
  bad(x => { x.clips[1].id = x.clips[0].id; }, /repeated id/);
  bad(x => { x.clips = []; }, /no clips/);
  bad(x => { x.music = { file: 'a.mp3' }; }, /Music is not/);
  bad(x => { x.look.text_color = 'red'; }, /six-digit/);
  bad(x => { x.captions.size = 'huge'; }, /small, medium or large/);
  bad(x => { x.images = [{ ...PIC, sha256: 'xyz' }]; }, /fingerprint/);
  bad(x => { x.images = [PIC]; x.rules = [{ id: 'r1', phrase: 'great news', image_id: 'nope', seconds: 2, mode: 'full', fade_s: 0.2 }]; }, /not in this film/);
  bad(x => { x.images = [PIC]; x.rules = [{ id: 'r1', phrase: 'great news', image_id: PIC.id, seconds: 1.5, mode: 'full', fade_s: 1 }]; }, /at most half/);
  bad(x => { x.images = [PIC]; x.rules = [{ id: 'r1', phrase: 'great news', image_id: PIC.id, seconds: 11, mode: 'full', fade_s: 0 }]; }, /0\.5 and 10/);
  bad(x => { x.images = [PIC]; x.rules = [{ id: 'r1', phrase: '   ', image_id: PIC.id, seconds: 2, mode: 'full', fade_s: 0 }]; }, /words to listen for/);
  bad(x => { x.images = [PIC]; x.rules = [{ id: 'r1', phrase: 'a', image_id: PIC.id, seconds: 2, mode: 'sideways', fade_s: 0 }]; }, /where the picture sits/);
  bad(x => { x.texts = [{ id: 't1', text: '', start_s: 0, length_s: 3, position: 'top' }]; }, /1 to 200/);
  assert.throws(() => M.normalize(null), M.EditError);
  assert.throws(() => M.parse('{not json'), M.EditError);
});

test('THE CLOCK: clips sit end to end, a crossfade overlaps, and every word lands in the FINISHED film', () => {
  const tl = M.timeline(base);
  assert.equal(tl.clips[0].start_s, 0);
  tl.clips.slice(1).forEach((c, i) => assert.equal(c.start_s, tl.clips[i].end_s));
  const w0 = base.clips[0].words[0], t0 = tl.clips[0].words[0];
  assert.equal(t0.s, Math.round((w0.s - base.clips[0].in_s) * 1000) / 1000);
  const x = clone(base); x.clips[0].join = { kind: 'crossfade', s: 0.3 };
  const tl2 = M.timeline(M.normalize(x));
  assert.equal(tl2.clips[1].start_s, Math.round((tl2.clips[0].end_s - 0.3) * 1000) / 1000);
  assert.ok(tl2.total_s < tl.total_s);
});

test('"EVERY TIME <PHRASE> IS SAID": finds every occurrence, across clip borders, and a phrase that is not there gives none (never a guess)', () => {
  assert.equal(M.occurrences(base, 'great news').length, 3);
  assert.equal(M.occurrences(base, 'Great, NEWS!').length, 3, 'case and punctuation do not matter');
  assert.deepEqual(M.occurrences(base, 'crypto'), []);
  assert.deepEqual(M.occurrences(base, 'news great'), []);
  const x = clone(base);                                                   // "great" last word of one clip, "news" first word of the next
  x.clips = [{ id: 'a', file_name: 'a.mp4', in_s: 0, out_s: 2, words: [{ w: 'so', s: 0.1, e: 0.4 }, { w: 'great', s: 1.0, e: 1.8 }], join: { kind: 'cut', s: 0 } },
             { id: 'b', file_name: 'b.mp4', in_s: 5, out_s: 7, words: [{ w: 'news', s: 5.1, e: 5.8 }, { w: 'today', s: 6, e: 6.8 }], join: { kind: 'cut', s: 0 } }];
  const y = M.normalize(x), occ = M.occurrences(y, 'great news');
  assert.equal(occ.length, 1);
  assert.equal(occ[0].at_s, 1.0);
  assert.equal(occ[0].end_s, 2.8);
});

test('REORDERING RE-FINDS THE OCCURRENCES at the new times; the picture follows the words', () => {
  const e = withRule();
  const before = M.specs(e).map(s => s.start_s);
  const moved = M.ops.moveClip(e, 'c5', -1);
  const after = M.specs(moved).map(s => s.start_s);
  assert.equal(before.length, 3);
  assert.equal(after.length, 3);
  assert.notDeepEqual(before, after);
  for (const s of M.specs(moved)) assert.ok(M.timeline(moved).clips.some(c => c.words.some(w => w.s === s.start_s && w.w === 'great')), 'each picture starts exactly on a "great"');
});

test('A PICTURE NEEDS ITS RIGHTS TICK: without it nothing draws and the page warns; with it, one spec per occurrence', () => {
  const unticked = withRule(withPic(base, false));
  assert.equal(M.specs(unticked).length, 0);
  assert.ok(M.warnings(unticked).some(w => /Tick "I have the right/.test(w.text)));
  const ticked = withRule();
  const sp = M.specs(ticked);
  assert.equal(sp.length, 3);
  assert.ok(sp.every(s => s.kind === 'image' && s.source === PIC.id && s.length_s === 2));
});

test('WARN, NEVER BLOCK: a rule that finds nothing, low contrast, text past the end and text on the captions are warned, and the list still saves', () => {
  const none = withRule(withPic(), { phrase: 'crypto' });
  assert.ok(M.warnings(none).some(w => /"crypto" is not said in this film/.test(w.text)));
  assert.equal(M.specs(none).length, 0);
  let e = M.ops.setCaptions(base, { on: true });
  assert.equal(M.warnings(e).filter(w => w.where === 'look').length, 0, 'the default look reads well');
  e = M.ops.setLook(e, { text_color: '#ffffff', box_color: '#ffffff', box_opacity: 1 });
  assert.ok(M.warnings(e).some(w => /hard to read/.test(w.text)));
  const late = M.ops.addText(base, { text: 'Hello', start_s: M.timeline(base).total_s - 1, length_s: 5 });
  assert.ok(M.warnings(late).some(w => /runs past the end/.test(w.text)));
  assert.doesNotThrow(() => M.stringify(late));
  const onCaps = M.ops.addText(M.ops.setCaptions(base, { on: true }), { text: 'Over the words', start_s: 0.2, length_s: 3, position: 'bottom' });
  assert.ok(M.warnings(onCaps).some(w => /sits on the captions/.test(w.text)));
  const a = withRule(withPic(), { mode: 'full', seconds: 6 });
  assert.ok(M.warnings(a).some(w => /on top of each other/.test(w.text)) || M.specs(a).length < 2, 'overlapping pictures are warned');
});

test('FRAME AT A SECOND: fade in and out, only inside its time, captions by clip, text on top', () => {
  const e = M.ops.addText(M.ops.setCaptions(withRule(), { on: true }), { text: 'Hello there', start_s: 1, length_s: 2, position: 'top' });
  const at = M.specs(e).find(s => s.kind === 'image').start_s;
  const f0 = M.frameAt(e, at), fMid = M.frameAt(e, at + 1), fEnd = M.frameAt(e, at + 2);
  assert.equal(f0.active.find(a => a.kind === 'image').opacity, 0, 'a fade starts at nothing');
  assert.equal(fMid.active.find(a => a.kind === 'image').opacity, 1);
  assert.equal(fEnd.active.find(a => a.kind === 'image'), undefined, 'gone when its time is up');
  assert.ok(M.frameAt(e, 1.5).active.some(a => a.kind === 'text' && a.text === 'Hello there'));
  assert.ok(M.frameAt(e, 0.7).active.some(a => a.kind === 'caption' && /great news everyone/.test(a.text)));
  const order = M.frameAt(e, 1.5).active.map(a => a.kind);
  assert.deepEqual(order, [...order].sort((a, b) => ({ image: 1, caption: 2, text: 3 }[a] - { image: 1, caption: 2, text: 3 }[b])), 'images under captions under text');
  const tl = M.timeline(e);
  assert.equal(M.frameAt(e, tl.clips[1].start_s).clip, 'c2', 'on a clip border the next clip is showing');
  assert.equal(M.frameAt(e, tl.clips[1].start_s - 0.1).clip, 'c1', 'just before it, the earlier one');
  assert.equal(M.frameAt(e, tl.total_s).clip, 'c6', 'at the very end, the last clip');
  assert.equal(M.frameAt(e, -3).t, 0);
  assert.equal(M.frameAt(e, 1e6).t, M.timeline(e).total_s);
});

test('THE EDITS: each returns a new valid list or says why not; the old list is never changed', () => {
  const snap = JSON.stringify(base);
  const m = M.ops.moveClip(base, 'c1', 1);
  assert.deepEqual(m.clips.map(c => c.id).slice(0, 2), ['c2', 'c1']);
  refuses(() => M.ops.moveClip(base, 'c1', -1), /already first/);
  refuses(() => M.ops.moveClip(base, 'c6', 1), /already last/);
  const n = M.ops.nudge(base, 'c2', 'out', -0.1);
  assert.equal(n.clips[1].out_s, Math.round((base.clips[1].out_s - 0.1) * 1000) / 1000);
  refuses(() => M.ops.nudge(base, 'c2', 'out', -50), /at least 0\.3|before|not a time/);
  refuses(() => M.ops.nudge(base, 'c2', 'in', -1000), /before its video begins/);
  const r = M.ops.removeClip(base, 'c3');
  assert.equal(r.clips.length, 5);
  assert.equal(M.occurrences(r, 'great news').length, 2, 'taking a clip out takes its occurrence out');
  let one = base; for (const id of ['c1', 'c2', 'c3', 'c4', 'c5']) one = M.ops.removeClip(one, id);
  refuses(() => M.ops.removeClip(one, 'c6'), /at least one clip/);
  refuses(() => M.ops.moveClip(base, 'zz', 1), /not in the film any more/);
  assert.equal(JSON.stringify(base), snap);
  refuses(() => M.ops.removeImage(withRule(), PIC.id), /rule still uses/);
  const lite = M.ops.setLook(base, { theme: 'light' });
  assert.equal(lite.look.text_color, M.THEMES.light.text_color);
  assert.equal(lite.look.letterbox, M.THEMES.light.letterbox);
  assert.equal(M.ops.setLook(lite, { text_color: '#0b3d5c' }).look.theme, 'light');
});

test('SAVE THEN OPEN: the same bytes, the same list, and the same picture at every tenth of a second', () => {
  let e = withRule(); e = M.ops.setCaptions(e, { on: true, size: 'large' }); e = M.ops.addText(e, { text: 'Thanks for watching', start_s: 10, length_s: 3 });
  e = M.ops.moveClip(e, 'c4', -1); e = M.ops.setLook(e, { theme: 'light' }); e = M.ops.nudge(e, 'c1', 'out', -0.1);
  const text = M.stringify(e), again = M.parse(text);
  assert.equal(M.stringify(again), text, 'saving what was opened gives the same bytes');
  assert.deepEqual(again, e);
  const total = M.timeline(e).total_s;
  for (let t = 0; t <= total + 1e-9; t += 0.1) assert.deepEqual(M.frameAt(again, t), M.frameAt(e, t), `at ${t.toFixed(1)} s`);
  assert.doesNotMatch(text, /[A-Za-z]:\\|\\\\|\/Users\//, 'no path in the saved list');
  assert.match(text, /"sha256"/);
});

test('THE PAGE\'S SOURCE: no HTML built from text, no call but to its own maker, a locked-down content policy, no outside address', () => {
  const js = read('tools/maker-edit/edit.js').replace(/\/\/.*$/gm, ''), model = read('tools/maker-edit/edit-model.js').replace(/\/\/.*$/gm, ''), html = read('tools/maker-edit/edit.html');
  for (const src of [js, model]) assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|XMLHttpRequest|sendBeacon|WebSocket|importScripts/);
  assert.doesNotMatch(model, /fetch\(|localStorage|sessionStorage|document\.|window\./, 'the model touches nothing but its input');
  const fetches = js.match(/fetch\(([^,)]*)/g) || [];
  assert.deepEqual(fetches, ['fetch(path'], 'the one fetch is inside the maker host and takes a path of the maker');
  assert.match(js, /const call = async \(path, body\)/);
  for (const p of ['/api/edit', '/api/edit/proxy', '/api/image/pick', '/api/image/file', '/api/edit/render']) assert.ok(js.includes(p), p);
  assert.doesNotMatch(js, /https?:\/\//);
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'/);
  assert.doesNotMatch(html, /https?:\/\/|<script>|onclick=|style=/);
  assert.doesNotMatch(read('tools/maker-edit/edit.css'), /https?:|@import|url\(/);
});

test('THE WORDS ON THE PAGE are plain: no exit codes, no model or engine names, no raw errors on screen', () => {
  const ui = ['edit.js', 'edit.html', 'edit-model.js'].map(f => read('tools/maker-edit/' + f).replace(/\/\/.*$/gm, '')).join(' ');
  assert.doesNotMatch(ui, /Exit code|whisper|ffmpeg|traceback|\[object|\bNaN\b/i);
});
