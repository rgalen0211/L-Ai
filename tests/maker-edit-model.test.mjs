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

const win = { ryagramEditModel: M, sessionStorage: { getItem: () => null, setItem() {} } };
vm.runInNewContext(read('tools/maker-edit/fixture.js'), { window: win, sessionStorage: win.sessionStorage, setTimeout, URLSearchParams, location: { search: '' } });
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
  bad(x => { x.clips[0].file_name = 'C:\\Users\\sam\\video.mp4'; }, /never by a full path|by name only/);
  bad(x => { x.clips[0].file_name = '../video.mp4'; }, /never by a full path|by name only/);
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

test('FOLDER-RELATIVE CLIP NAMES: a clip may name its video inside a chosen folder; a full path is refused; backslashes become slashes', () => {
  const x = clone(base); x.clips[0].file_name = 'my-clips\\Season 2\\a.mp4'; x.clips[1].file_name = 'my-clips/b.mp4';
  const p = M.normalize(x);
  assert.equal(p.clips[0].file_name, 'my-clips/Season 2/a.mp4'); assert.equal(p.clips[1].file_name, 'my-clips/b.mp4');
  for (const bad of ['C:' + BSL + 'pics' + BSL + 'a.png', '/home/me/a.png', '../a.png', 'a/../b.png']) { const y = clone(base); y.clips[0].file_name = bad; refuses(() => M.normalize(y), /never by a full path/); }
});

test('SLIDES: a picture of the person\'s own is its own stretch of the film; it needs its rights tick; the page shows it full frame for its whole length', () => {
  const withP = withPic(base, false);
  const noTick = M.ops.addSlide(withP, { image_id: PIC.id, seconds: 3, after: 'c1' });
  assert.equal(noTick.clips[1].slide.image_id, PIC.id); assert.equal(noTick.clips[1].file_name, PIC.file_name);
  assert.deepEqual(noTick.clips[1].words, []);
  assert.equal(M.specs(noTick).length, 0, 'no tick, nothing drawn');
  assert.ok(M.warnings(noTick).some(w => /its slide will show nothing/.test(w.text)));
  const ok = M.ops.setRights(noTick, PIC.id, true), tl = M.timeline(ok), sl = tl.clips[1];
  assert.equal(tl.total_s, Math.round((M.timeline(base).total_s + 3) * 1000) / 1000, 'the film is 3 seconds longer');
  assert.equal(sl.slide, PIC.id); assert.equal(sl.length_s, 3);
  const sp = M.specs(ok).find(s => s.id === 'slide-' + noTick.clips[1].id);
  assert.ok(sp && sp.kind === 'image' && sp.x === 0 && sp.y === 0 && sp.w === 1 && sp.h === 1 && sp.start_s === sl.start_s && sp.length_s === 3);
  assert.equal(M.frameAt(ok, sl.start_s + 1).active.filter(a => a.kind === 'image').length, 1);
  assert.equal(M.frameAt(ok, sl.start_s + 1).clip, noTick.clips[1].id);
  assert.equal(M.frameAt(ok, sl.start_s - 0.5).active.filter(a => a.kind === 'image').length, 0);
  const first = M.ops.addSlide(withPic(), { image_id: PIC.id, seconds: 2 });
  assert.equal(first.clips[0].slide.image_id, PIC.id, 'with no clip named it goes first');
  refuses(() => M.ops.addSlide(base, { image_id: 'nope', seconds: 3 }), /Choose a picture/);
  refuses(() => M.ops.addSlide(withP, { image_id: PIC.id, seconds: 0.2, after: 'c1' }), /at least 0\.3|0\.5|long/);
  refuses(() => M.ops.addSlide(withP, { image_id: PIC.id, seconds: 11, after: 'c1' }), /up to 10 seconds/);
  const end = M.ops.addSlide(withPic(), { image_id: PIC.id, seconds: 2, after: 'end' });
  assert.equal(end.clips[end.clips.length - 1].slide.image_id, PIC.id, 'at the end puts it last');
  let many = withPic(); for (let i = 0; i < 10; i++) many = M.ops.addSlide(many, { image_id: PIC.id, seconds: 1, after: 'end' });
  refuses(() => M.ops.addSlide(many, { image_id: PIC.id, seconds: 1, after: 'end' }), /up to 10 slides/);
  refuses(() => M.ops.removeImage(ok, PIC.id), /slide still uses/);
  const nudged = M.ops.nudge(ok, noTick.clips[1].id, 'out', 0.5);
  assert.equal(M.timeline(nudged).clips[1].length_s, 3.5, 'the end buttons change how long a slide stays');
  refuses(() => M.ops.nudge(ok, noTick.clips[1].id, 'in', 0.1), /starts at 0 seconds/);
  const bad = clone(ok); bad.clips[1].file_name = 'other.png'; refuses(() => M.normalize(bad), /named after its picture/);
  const bad2 = clone(ok); bad2.clips[1].slide.image_id = 'nope'; refuses(() => M.normalize(bad2), /not in this film/);
  const text = M.stringify(ok); assert.equal(M.stringify(M.parse(text)), text); assert.deepEqual(M.parse(text), ok);
  const total = M.timeline(ok).total_s;
  for (let t = 0; t <= total + 1e-9; t += 0.1) assert.deepEqual(M.frameAt(M.parse(text), t), M.frameAt(ok, t), `at ${t.toFixed(1)} s`);
});

test('ONE SHARED WORKSPACE: the film has a mode, and the tools the page offers follow it; a data film has options and text, no clips', () => {
  assert.equal(base.mode, 'compilation');
  assert.deepEqual(M.features('compilation'), { clips: true, slides: true, rules: true, captions: true, text: true, look: true, options: false });
  assert.deepEqual(M.features('data'), { clips: false, slides: false, rules: false, captions: false, text: false, look: false, options: true });
  const d = M.normalize({ schema: M.SCHEMA, mode: 'data', clips: [] });
  assert.equal(d.mode, 'data'); assert.deepEqual(d.clips, []); assert.deepEqual(d.options, {});
  refuses(() => M.normalize({ schema: M.SCHEMA, mode: 'data', clips: [clone(base.clips[0])] }), /no clips/);
  const x = clone(base); x.mode = 'games'; refuses(() => M.normalize(x), /does not know this kind of film/);
  delete x.mode; assert.equal(M.normalize(x).mode, 'compilation', 'older lists without a mode are compilations');
  refuses(() => M.ops.addRule(d, { phrase: 'a', image_id: 'x' }), /does not use rules/);
  refuses(() => M.ops.setCaptions(d, { on: true }), /does not use captions/);
  refuses(() => M.ops.addSlide(d, { image_id: 'x', seconds: 3 }), /does not use slides/);
  refuses(() => M.ops.moveClip(d, 'c1', 1), /does not use clips/);
  refuses(() => M.ops.addText(d, { text: 'Hello', start_s: 1 }), /does not use free text/);
  const c = M.normalize(clone(base));
  refuses(() => M.ops.setOption(c, ROWS, 'theme', 'light'), /does not use options/);
  assert.equal(M.timeline(d).total_s, 0);
  assert.deepEqual(M.frameAt(d, 1).active, []);
});

const ROWS = [
  { id: 'theme', label: 'Page', control: 'choice', choices: [{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }], default: 'dark', status: 'built' },
  { id: 'page_background', label: 'Page colour', control: 'colour', default: { dark: '#14141a', light: '#fcfcfb' }, status: 'built', hard: { pattern: '#RRGGBB' } },
  { id: 'dots_radius', label: 'Dot size', control: 'slider', min: 0.5, max: 6, step: 0.5, default: 3.4, status: 'built', hard: { minimum: 0.5, maximum: 6 } },
  { id: 'bars_label_width', label: 'Space for names', control: 'number', min: 60, max: 600, default: 190, status: 'built', hard: { minimum: 60, maximum: 600 } },
  { id: 'ramp_continuous', label: 'Smooth colours', control: 'toggle', default: null, status: 'built' },
  { id: 'name', label: 'Film name', control: 'text', default: null, status: 'built', hard: { maxLength: 12 } },
  { id: 'clarity_fade', label: 'Data fade', control: 'slider', min: 0, max: 5, default: 1, status: 'planned' },
  { id: 'sequence_clips', label: 'Scenes', control: 'list', default: [], status: 'built' },
];
const DATA = M.normalize({ schema: M.SCHEMA, mode: 'data', clips: [] });

test('OPTIONS (the shared list): each control type is checked against its own limits, in plain words; blank goes back to the default', () => {
  const v = id => ROWS.find(r => r.id === id);
  assert.equal(M.validateOption(v('theme'), 'light'), 'light');
  refuses(() => M.validateOption(v('theme'), 'purple'), /Choose one of the listed values for Page/);
  assert.equal(M.validateOption(v('page_background'), '#ABCDEF'), '#abcdef');
  refuses(() => M.validateOption(v('page_background'), 'red'), /is a colour like #14141a/);
  assert.equal(M.validateOption(v('dots_radius'), 2), 2);
  refuses(() => M.validateOption(v('dots_radius'), 7), /at most 6/);
  refuses(() => M.validateOption(v('dots_radius'), 0.1), /at least 0\.5/);
  refuses(() => M.validateOption(v('dots_radius'), 'big'), /is a number/);
  refuses(() => M.validateOption(v('dots_radius'), NaN), /is a number/);
  assert.equal(M.validateOption(v('bars_label_width'), 200), 200);
  refuses(() => M.validateOption(v('bars_label_width'), 10), /at least 60/);
  assert.equal(M.validateOption(v('ramp_continuous'), true), true);
  refuses(() => M.validateOption(v('ramp_continuous'), 'yes'), /on or off/);
  assert.equal(M.validateOption(v('name'), '  My film '), 'My film');
  refuses(() => M.validateOption(v('name'), 'x'.repeat(13)), /at most 12 characters/);
  refuses(() => M.validateOption(v('clarity_fade'), 2), /coming later/);
  refuses(() => M.validateOption(v('sequence_clips'), []), /set by the film itself/);
  refuses(() => M.validateOption(null, 1), /not in the list/);
  for (const blank of [null, '']) assert.equal(M.validateOption(v('theme'), blank), null);
  assert.equal(M.defaultFor(v('page_background'), 'light'), '#fcfcfb');
  assert.equal(M.defaultFor(v('page_background'), 'dark'), '#14141a');
  assert.equal(M.defaultFor(v('dots_radius'), 'dark'), 3.4);
});

test('OPTIONS IN THE EDIT LIST: set, change, reset to the default, refuse an unknown or coming-later option; stable bytes; the old list is untouched', () => {
  const snap = JSON.stringify(DATA);
  let e = M.ops.setOption(DATA, ROWS, 'theme', 'light');
  e = M.ops.setOption(e, ROWS, 'dots_radius', 4.5); e = M.ops.setOption(e, ROWS, 'page_background', '#102030');
  assert.deepEqual(e.options, { dots_radius: 4.5, page_background: '#102030', theme: 'light' });
  assert.deepEqual(Object.keys(e.options), ['dots_radius', 'page_background', 'theme'], 'sorted keys: the same bytes every time');
  assert.equal(JSON.stringify(DATA), snap);
  const back = M.ops.setOption(e, ROWS, 'theme', null);
  assert.equal('theme' in back.options, false, 'blank puts it back to the default');
  refuses(() => M.ops.setOption(e, ROWS, 'nope', 1), /not in the list/);
  refuses(() => M.ops.setOption(e, ROWS, 'clarity_fade', 2), /coming later/);
  refuses(() => M.ops.setOption(e, ROWS, 'dots_radius', 99), /at most 6/);
  assert.deepEqual(M.ops.resetOptions(e).options, {});
  const text = M.stringify(e); assert.equal(M.stringify(M.parse(text)), text); assert.deepEqual(M.parse(text), e);
  const x = clone(e); x.options.sneaky = 1;
  assert.doesNotThrow(() => M.normalize(x), 'shape only, when no list is given');
  refuses(() => M.normalize(x, { rows: ROWS }), /sneaky is not an option/);
  const y = clone(e); y.options.dots_radius = 99;
  refuses(() => M.normalize(y, { rows: ROWS }), /at most 6/);
  const z = clone(e); z.options['bad key!'] = 1; refuses(() => M.normalize(z), /name the maker does not know/);
  const w = clone(e); w.options.theme = { a: 1 }; refuses(() => M.normalize(w), /not valid/);
  const c = clone(base); c.options = { theme: 'dark' }; refuses(() => M.normalize(c), /Options belong to data films/);
});

const BSL = String.fromCharCode(92);
test('PICTURES FROM A FOLDER and TEXT SIZE: folder-relative picture names (never a full path), one rights tick for all, a text size that reaches the overlay spec and the frame', () => {
  const FP = [{ id: 'img-f1', file_name: 'my-pictures' + BSL + 'title-card.png', sha256: 'cd'.repeat(32), width: 400, height: 300 }, { id: 'img-f2', file_name: 'my-pictures/Season 2/logo.png', sha256: 'ef'.repeat(32), width: 400, height: 300 }];
  let e = M.ops.addImages(base, FP);
  assert.deepEqual(e.images.map(m => m.file_name), ['my-pictures/title-card.png', 'my-pictures/Season 2/logo.png'], 'a backslash becomes a slash');
  assert.equal(M.ops.addImages(e, FP).images.length, 2, 'adding the same folder twice does not repeat a picture');
  assert.ok(e.images.every(m => m.rights_ticked === false));
  e = M.ops.setRightsAll(e, true); assert.ok(e.images.every(m => m.rights_ticked === true));
  for (const bad of ['C:\pics\a.png', '/home/me/a.png', '../a.png', 'a/../b.png']) { const x = clone(e); x.images[0].file_name = bad; refuses(() => M.normalize(x), /never by a full path/); }
  e = M.ops.addRule(e, { phrase: 'great news', image_id: 'img-f1', seconds: 2, mode: 'full' });
  e = M.ops.addSlide(e, { image_id: 'img-f2', seconds: 2, after: 'c1' });
  assert.equal(e.clips[1].file_name, 'my-pictures/Season 2/logo.png', 'a slide is named after its folder picture');
  const t = M.ops.addText(base, { text: 'Big words', start_s: 1, length_s: 2, size: 'large' }).texts[0];
  assert.equal(t.size, 'large');
  assert.equal(M.ops.addText(base, { text: 'Plain', start_s: 1 }).texts[0].size, 'medium', 'medium by default');
  refuses(() => M.ops.addText(base, { text: 'x', start_s: 1, size: 'huge' }), /small, medium or large/);
  const withT = M.ops.addText(base, { text: 'Big words', start_s: 1, length_s: 2, size: 'large' });
  assert.equal(M.specs(withT).find(s => s.kind === 'text').size, 'large');
  assert.equal(M.frameAt(withT, 1.5).active.find(a => a.kind === 'text').size, 'large');
  assert.equal(M.parse(M.stringify(withT)).texts[0].size, 'large');
});

test('MUST-FAIL (Claude 12:30): a rule whose phrase is not said says so in plain words and draws nothing; NO overlay of any kind runs past the end of the film', () => {
  const none = withRule(withPic(), { phrase: 'never said anywhere' });
  assert.ok(M.warnings(none).some(w => /"never said anywhere" is not said in this film, so that picture will not show\./.test(w.text)));
  assert.equal(M.specs(none).length, 0);
  // every kind of overlay near the end, each asking for more time than is left
  let e = withPic(); e = M.ops.setCaptions(e, { on: true });
  const total = M.timeline(e).total_s;
  e = M.ops.addRule(e, { phrase: 'that is the end', image_id: PIC.id, seconds: 10, mode: 'full', fade_s: 0.2 });
  e = M.ops.addText(e, { text: 'The very end', start_s: total - 0.5, length_s: 30 });
  { // before the slide lengthens the film: the rule and the captions really sit at the very end, and are cut to it
    const tl0 = M.timeline(e), sp0 = M.specs(e);
    assert.ok(sp0.some(s => s.kind === 'image') && sp0.some(s => s.kind === 'caption') && sp0.some(s => s.kind === 'text'));
    for (const s of sp0) assert.ok(s.start_s + s.length_s <= tl0.total_s + 1e-6, `${s.id} ends at ${s.start_s + s.length_s} past the end ${tl0.total_s}`);
  }
  e = M.ops.addSlide(e, { image_id: PIC.id, seconds: 10, after: 'end' });
  const tl = M.timeline(e), sp = M.specs(e);
  assert.ok(sp.length >= 4, 'rule, text, slide and captions are all there');
  for (const s of sp) assert.ok(s.start_s + s.length_s <= tl.total_s + 1e-6, `${s.id} ends at ${s.start_s + s.length_s} past the end ${tl.total_s}`);
  for (let t = tl.total_s; t <= tl.total_s + 5; t += 0.5) assert.deepEqual(M.frameAt(e, t, { tl, specs: sp }).active.filter(a => a.kind !== 'image' || a.opacity > 0), M.frameAt(e, tl.total_s, { tl, specs: sp }).active.filter(a => a.kind !== 'image' || a.opacity > 0), 'nothing new appears after the end');
  const late = M.ops.addText(base, { text: 'Too late', start_s: M.timeline(base).total_s + 1, length_s: 3 });
  assert.equal(M.specs(late).filter(s => s.kind === 'text').length, 0, 'a text that starts after the end draws nothing');
  assert.ok(M.warnings(late).some(w => /starts after the film has ended/.test(w.text)));
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
  assert.deepEqual(fetches, ['fetch(path', 'fetch(path'], 'the two fetches are inside the maker host and take a path of the maker');
  assert.doesNotMatch(js, /&t=|[?&]t=\$\{/, 'the token is never put in an address');
  assert.doesNotMatch(html, /fixture\.js/, 'the real page never loads the practice cut');
  assert.match(js, /has\('fixture'\)\) \{ await loadScript\('fixture\.js'\)/, 'the practice cut is loaded only for ?fixture');
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

test('CLEAN CUTS (NEXT-WEB 135): a film-wide on/off kept in the edit list, off by default, refused in words when it is not a plain true or false; every other edit, a save and a reload keep it', () => {
  assert.equal(base.clean_cuts, false, 'off by default');
  const old = clone(base); delete old.clean_cuts; assert.equal(M.normalize(old).clean_cuts, false, 'older lists without the field are off');
  old.clean_cuts = null; assert.equal(M.normalize(old).clean_cuts, false);
  let e = M.ops.setCleanCuts(base, true);
  assert.equal(e.clean_cuts, true);
  assert.equal(base.clean_cuts, false, 'the old list is untouched');
  // every other edit keeps it
  e = M.ops.addText(e, { text: 'Hi', start_s: 0.5 }); e = M.ops.setCaptions(e, { on: true }); e = M.ops.moveClip(e, e.clips[1].id, -1);
  assert.equal(e.clean_cuts, true, 'other edits never drop the field');
  // a save and a reload keep it, in the same bytes
  const text = M.stringify(e); assert.match(text, /"clean_cuts": true/);
  assert.equal(M.parse(text).clean_cuts, true); assert.equal(M.stringify(M.parse(text)), text);
  assert.equal(M.ops.setCleanCuts(e, false).clean_cuts, false, 'and it turns off again');
  // must-fail: anything that is not a plain boolean is refused in words
  for (const bad of ['yes', 'true', 1, 0, {}, []]) { const x = clone(base); x.clean_cuts = bad; refuses(() => M.normalize(x), /Clean cuts are on or off\./); }
  // a data film has no cuts
  refuses(() => M.normalize({ schema: M.SCHEMA, mode: 'data', clips: [], clean_cuts: true }), /Clean cuts belong to compilations/);
  assert.equal(M.normalize({ schema: M.SCHEMA, mode: 'data', clips: [] }).clean_cuts, false);
  refuses(() => M.ops.setCleanCuts(DATA, true), /does not use clips|clean cuts/i);
});
