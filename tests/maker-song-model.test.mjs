// Song mode screens of the desktop maker (tools/maker-song/; NEXT-WEB 121). Model tests plus source checks; the page is driven in real Chrome by tools/check-maker-song.py.
// What it guarantees: the pasted words are read one line at a time and refused in plain words when they cannot be used; a song plan from the engine is validated before the page trusts it (a word built from sounds
// is ONE person's sounds, nothing is a path, nothing is out of order); the page says plainly what is said as it is, built from sounds, a gap, or left quiet; the flags are the rules' (30 ms from the beat,
// 0.5x to 3x stretch, a voice change, a held picture); a swap changes only that word and never the old plan; saving and opening gives the same bytes; the page writes no HTML from text and makes no call but to its own maker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const M = require('../tools/maker-song/song-model.js');

const win = { ryagramSongModel: M };
vm.runInNewContext(read('tools/maker-song/fixture.js'), { window: win, sessionStorage: { getItem: () => null, setItem() {} } });
const host = win.ryagramSongFixtureHost;
const lines = M.parseLyrics(host.practiceLyrics);
const plan = M.parse(JSON.stringify((await host.build({ lines, track: { file_name: 'my-song.mp3', seconds: 40 }, guide: null })).plan));   // through JSON: the fixture ran in another realm
const clone = o => JSON.parse(JSON.stringify(o));
const refuses = (fn, re) => assert.throws(fn, e => e instanceof M.SongError && re.test(e.message), String(re));
const firstOf = (p, pred) => { for (const l of p.lines) for (let i = 0; i < l.words.length; i++) if (pred(l.words[i], l, i)) return { n: l.n, i, w: l.words[i], l }; return null; };

test('THE WORDS: one line of the song per line; blanks dropped; too much or nothing is refused in plain words', () => {
  assert.deepEqual(M.parseLyrics('  first line \r\n\r\n second   line\n'), ['first line', 'second line']);
  refuses(() => M.parseLyrics(''), /Paste your words/);
  refuses(() => M.parseLyrics('  \n \n'), /Paste your words/);
  refuses(() => M.parseLyrics(null), /Paste your words/);
  refuses(() => M.parseLyrics('word '.repeat(41)), /Line 1 has more than 40 words/);
  refuses(() => M.parseLyrics(Array.from({ length: 201 }, () => 'x').join('\n')), /more than 200 lines/);
  refuses(() => M.parseLyrics('a'.repeat(20001)), /a lot of words/);
  assert.deepEqual(M.wordsOf("Don't STOP, now!"), ['dont', 'stop', 'now']);
});

test('THE PRACTICE PLAN shows every state the screens must tell apart, and counts add up', () => {
  const s = M.summarize(plan);
  assert.equal(s.words, 20);
  assert.equal(s.real + s.gaps + s.quiet, s.words);
  assert.equal(s.whole + s.built, s.real);
  assert.ok(s.built > 0 && s.gaps > 0 && s.off_beat > 0 && s.stretchy > 0 && s.switches > 0 && s.bursts > 0, JSON.stringify(s));
  assert.ok(s.say.some(t => /built from sounds/.test(t)) && s.say.some(t => /a gap/.test(t)) && s.say.some(t => /voice changes/.test(t)));
  assert.ok(s.max_err_ms >= s.median_err_ms);
});

test('THE VIDEOS the words are found in: names only, no repeats, at least one', () => {
  assert.deepEqual(M.normalizeVideos([{ file_name: 'a.mp4' }, { file_name: 'b.mp4' }]), [{ file_name: 'a.mp4' }, { file_name: 'b.mp4' }]);
  refuses(() => M.normalizeVideos([]), /Choose the videos/);
  refuses(() => M.normalizeVideos(null), /Choose the videos/);
  refuses(() => M.normalizeVideos([{ file_name: 'C:\\v\\a.mp4' }]), /by file name only/);
  refuses(() => M.normalizeVideos([{ file_name: 'a.mp4' }, { file_name: 'a.mp4' }]), /twice/);
  refuses(() => M.normalizeVideos(Array.from({ length: 301 }, (_, i) => ({ file_name: `v${i}.mp4` }))), /more than 300/);
});

test('THE ENGINE\'S PLAN IS VALIDATED: bad plans are refused in plain words, never half-trusted', () => {
  const bad = (patch, re) => { const x = clone(plan); patch(x); refuses(() => M.normalize(x), re); };
  const built = firstOf(plan, w => w.status === 'syllables' || w.status === 'phonemes');
  const real = firstOf(plan, w => w.status === 'whole');
  bad(x => { x.schema = 'other/1'; }, /different version/);
  bad(x => { x.track.file_name = 'C:\\Music\\song.mp3'; }, /name and a length/);
  bad(x => { x.guide = { file_name: '../v.wav' }; }, /by file name only/);
  bad(x => { x.cast = []; }, /names nobody/);
  bad(x => { x.cast[1].id = x.cast[0].id; }, /repeated id/);
  bad(x => { x.lines[real.n - 1].words[real.i].speaker_id = 'nobody-here'; }, /does not name/);
  bad(x => { x.lines[real.n - 1].words[real.i].file_name = 'C:\\v\\a.mp4'; }, /by file name only, not by path/);
  bad(x => { x.lines[built.n - 1].words[built.i].pieces[1].speaker_id = x.cast.find(c => c.id !== x.lines[built.n - 1].words[built.i].speaker_id).id; }, /mixes two people/);
  bad(x => { x.lines[built.n - 1].words[built.i].pieces = [x.lines[built.n - 1].words[built.i].pieces[0]]; }, /needs its pieces/);
  bad(x => { x.lines[0].words[0].beat_s = 999; x.lines[0].words[0].end_s = 1000; }, /outside the music/);
  bad(x => { const w = x.lines[0].words; [w[0].beat_s, w[1].beat_s] = [w[1].beat_s, w[0].beat_s]; }, /not in order|outside the music/);
  bad(x => { const w = x.lines[1].words; w[1].beat_s = w[0].beat_s - 0.5; w[1].end_s = w[0].beat_s - 0.2; }, /not in order/);
  bad(x => { x.lines[real.n - 1].words[real.i].status = 'maybe'; }, /said as is, built from sounds, or a gap/);
  bad(x => { x.lines[real.n - 1].words[real.i].offset_ms = 'soon'; }, /landing time that is not a number/);
  bad(x => { x.lines[real.n - 1].words[real.i].stretch = 0; }, /stretch that is not valid/);
  bad(x => { x.lines = []; }, /no lines/);
  bad(x => { x.lines[0].words = []; }, /no words/);
  assert.throws(() => M.normalize(null), M.SongError);
  assert.throws(() => M.parse('{nope'), M.SongError);
});

test('A ROW WITH NO MEASURED OFFSET is allowed (the receipt has the measured ones): it is null, never a guess, never flagged, never counted', () => {
  const x = clone(plan), t = firstOf(plan, w => w.status === 'whole');
  delete x.lines[t.n - 1].words[t.i].offset_ms; x.lines[t.n - 1].words[t.i].alternatives.forEach(a => delete a.offset_ms);
  const p = M.normalize(x), w = p.lines[t.n - 1].words[t.i];
  assert.equal(w.offset_ms, null);
  assert.ok(w.alternatives.every(a => a.offset_ms === null));
  assert.ok(!M.flags(p, p.lines[t.n - 1], t.i).some(f => /beat/.test(f)));
  assert.ok(M.summarize(p).off_beat <= M.summarize(plan).off_beat);
  const all = clone(plan); all.lines.forEach(l => l.words.forEach(v => { delete v.offset_ms; v.alternatives && v.alternatives.forEach(a => delete a.offset_ms); }));
  const s2 = M.summarize(M.normalize(all));
  assert.equal(s2.off_beat, 0); assert.equal(s2.median_err_ms, 0);
  assert.ok(M.stringify(p).includes('"offset_ms": null'));
  assert.equal(M.parse(M.stringify(p)).lines[t.n - 1].words[t.i].offset_ms, null);
  const sw = M.ops.swap(p, t.n, t.i, w.alternatives[0].id).lines[t.n - 1].words[t.i];
  assert.equal(sw.offset_ms, null);
});

test('A BUILT WORD from CONNECT 112 may carry a play-button name and a clash note; the name is a file name only', () => {
  const x = clone(plan), b = firstOf(plan, w => w.status === 'syllables');
  Object.assign(x.lines[b.n - 1].words[b.i], { preview: 'built-brooks.wav', voice_may_clash: true });
  const p = M.normalize(x), w = p.lines[b.n - 1].words[b.i];
  assert.equal(w.preview, 'built-brooks.wav');
  assert.ok(M.flags(p, p.lines[b.n - 1], b.i).some(f => /may not match each other/.test(f)));
  assert.ok(!M.flags(plan, plan.lines[b.n - 1], b.i).some(f => /may not match/.test(f)));
  x.lines[b.n - 1].words[b.i].preview = 'C:\\work\\a.wav';
  refuses(() => M.normalize(x), /file name only, not a path/);
  assert.equal(M.parse(M.stringify(p)).lines[b.n - 1].words[b.i].preview, 'built-brooks.wav');
});

test('PLAIN WORDS FOR EACH STATE, and a speaker is never shown as an id', () => {
  const real = firstOf(plan, w => w.status === 'whole'), built = firstOf(plan, w => w.status === 'syllables'), gap = firstOf(plan, w => w.status === 'gap');
  assert.equal(M.statusText(real.w), 'Said as it is');
  assert.match(M.statusText(built.w), /^Built from sounds: \w+ \+ \w+$/);
  assert.match(M.statusText(gap.w), /^Gap: nobody in your files says this word$/);
  assert.equal(M.statusText({ ...gap.w, quiet: true }), 'Left quiet');
  assert.equal(M.speakerLabel(plan, 'v-a'), 'Voice 1');
  assert.equal(M.speakerLabel(plan, 'v-b'), 'Narrator');
  assert.equal(M.speakerLabel(plan, 'zz'), 'Nobody');
});

test('THE FLAGS ARE THE RULES\': 30 ms off the beat, stretch beyond 3x or under 0.5x, a voice change, a held picture, a loudness jump; a gap is never flagged', () => {
  const p = clone(plan), t = firstOf(p, (w, l, i) => w.status === 'whole' && i === 0 && l.words.length > 2), w = p.lines[t.n - 1].words[t.i], line = p.lines[t.n - 1];
  Object.assign(w, { offset_ms: 12, stretch: 1, burst: false, step_db: null });
  assert.deepEqual(M.flags(p, line, t.i), []);
  w.offset_ms = 31; assert.match(M.flags(p, line, t.i).join('|'), /Lands 31 ms after the beat/);
  w.offset_ms = -45; assert.match(M.flags(p, line, t.i).join('|'), /Lands 45 ms before the beat/);
  w.offset_ms = 30; assert.deepEqual(M.flags(p, line, t.i), [], '30 ms is allowed');
  w.stretch = 3.4; assert.match(M.flags(p, line, t.i).join('|'), /Stretched a lot \(3\.4 times\)/);
  w.stretch = 0.4; assert.match(M.flags(p, line, t.i).join('|'), /Squeezed a lot/);
  w.stretch = 1; w.burst = true; assert.match(M.flags(p, line, t.i).join('|'), /picture stays on the first clip/);
  w.burst = false; w.step_db = 9; assert.match(M.flags(p, line, t.i).join('|'), /loudness jumps 9 dB/);
  const g = firstOf(p, x => x.status === 'gap');
  p.lines[g.n - 1].words[g.i].offset_ms = 500;
  assert.deepEqual(M.flags(p, p.lines[g.n - 1], g.i), []);
  const sw = firstOf(plan, (x, l, i) => { const prev = l.words.slice(0, i).reverse().find(y => y.status !== 'gap'); return prev && prev.speaker_id !== x.speaker_id && x.status !== 'gap'; });
  assert.match(M.flags(plan, sw.l, sw.i).join('|'), /The voice changes here, from (Voice 1|Narrator) to (Voice 1|Narrator)/);
});

test('A SWAP changes only that word: the other take goes in, the old one becomes a take to go back to, and the old plan is untouched', () => {
  const snap = JSON.stringify(plan);
  const t = firstOf(plan, w => w.status === 'whole' && w.alternatives.length >= 2), alt = t.w.alternatives[0];
  const next = M.ops.swap(plan, t.n, t.i, alt.id), w = next.lines[t.n - 1].words[t.i];
  assert.equal(JSON.stringify(plan), snap, 'the old plan is not changed');
  assert.equal(w.file_name, alt.file_name); assert.equal(w.speaker_id, alt.speaker_id); assert.equal(w.src_s, alt.src_s); assert.equal(w.stretch, alt.stretch);
  assert.ok(w.alternatives.some(a => a.file_name === t.w.file_name && a.src_s === t.w.src_s), 'the take it replaced can be chosen again');
  assert.ok(!w.alternatives.some(a => a.id === alt.id));
  assert.equal(w.beat_s, t.w.beat_s, 'the beat does not move');
  next.lines.forEach((l, li) => l.words.forEach((x, wi) => { if (!(li === t.n - 1 && wi === t.i)) assert.deepEqual(x, plan.lines[li].words[wi]); }));
  refuses(() => M.ops.swap(plan, t.n, t.i, 'nope'), /not offered for this word/);
  refuses(() => M.ops.swap(plan, 99, 0, 'x'), /not in the plan any more/);
  const built = firstOf(plan, w => w.status !== 'whole' && w.status !== 'gap' && w.alternatives.length);
  const b = M.ops.swap(plan, built.n, built.i, built.w.alternatives[0].id).lines[built.n - 1].words[built.i];
  assert.equal(b.status, 'whole'); assert.deepEqual(b.pieces, []);
  assert.ok(M.summarize(M.ops.swap(plan, built.n, built.i, built.w.alternatives[0].id)).built < M.summarize(plan).built, 'swapping a built word for a real take lowers the built count');
});

test('A GAP CAN BE LEFT QUIET, and only a gap; it is counted, and it never makes a line "fully real"', () => {
  const g = firstOf(plan, w => w.status === 'gap'), real = firstOf(plan, w => w.status === 'whole');
  const q = M.ops.quiet(plan, g.n, g.i, true);
  assert.equal(M.summarize(q).quiet, 1);
  assert.equal(M.summarize(q).gaps, M.summarize(plan).gaps - 1);
  assert.equal(M.summarize(q).full_lines, M.summarize(plan).full_lines, 'a quiet beat is not a real voice');
  assert.equal(M.summarize(M.ops.quiet(q, g.n, g.i, false)).quiet, 0);
  refuses(() => M.ops.quiet(plan, real.n, real.i, true), /Only a gap/);
  assert.match(M.summarize(q).say.join(' '), /1 beat is left quiet/);
});

test('SAVE THEN OPEN: the same bytes and the same plan; no path anywhere in it', () => {
  const tiny = clone(plan); tiny.lines[0].words[0].status === 'gap' || (tiny.lines[0].words[0].offset_ms = -0.2);
  const z = firstOf(plan, w => w.status !== 'gap'); const t2 = clone(plan); t2.lines[z.n - 1].words[z.i].offset_ms = -0.2;
  assert.ok(Object.is(M.normalize(t2).lines[z.n - 1].words[z.i].offset_ms, 0), 'a tiny early landing is 0, never minus zero (it would read back different)');
  const g = firstOf(plan, w => w.status === 'gap'), t = firstOf(plan, w => w.status === 'whole' && w.alternatives.length);
  let p = M.ops.quiet(plan, g.n, g.i, true); p = M.ops.swap(p, t.n, t.i, t.w.alternatives[0].id);
  const text = M.stringify(p), again = M.parse(text);
  assert.equal(M.stringify(again), text);
  assert.deepEqual(again, p);
  assert.doesNotMatch(text, /[A-Za-z]:\\|\\\\|\/Users\//);
});

test('THE PAGE\'S SOURCE: no HTML built from text, no call but to its own maker, a locked-down content policy, no outside address, plain words', () => {
  const js = read('tools/maker-song/song.js').replace(/\/\/.*$/gm, ''), model = read('tools/maker-song/song-model.js').replace(/\/\/.*$/gm, ''), html = read('tools/maker-song/song.html');
  for (const src of [js, model]) assert.doesNotMatch(src, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|XMLHttpRequest|sendBeacon|WebSocket|importScripts/);
  assert.doesNotMatch(model, /fetch\(|localStorage|sessionStorage|document\.|window\./, 'the model touches nothing but its input');
  assert.deepEqual(js.match(/fetch\(([^,)]*)/g) || [], ['fetch(path', 'fetch(r.url']);
  assert.doesNotMatch(js, /&t=|[?&]t=\$\{|'t=' \+/, 'the token is never put in an address');
  assert.doesNotMatch(html, /fixture\.js/, 'the real page never loads the practice build');
  assert.match(js, /has\('fixture'\)\) \{ await loadScript\('fixture\.js'\)/, 'the practice build is loaded only for ?fixture');
  for (const p of ['/api/song', '/api/song/track', '/api/song/videos', '/api/song/guide', '/api/song/build', '/api/song/hear', '/api/song/render']) assert.ok(js.includes(p), p);
  assert.doesNotMatch(js, /https?:\/\//);
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'/);
  assert.doesNotMatch(html, /https?:\/\/|<script>|onclick=|style=/);
  assert.doesNotMatch(read('tools/maker-song/song.css'), /https?:|@import|url\(/);
  assert.doesNotMatch([js, model, html].join(' '), /Exit code|whisper|demucs|ffmpeg|traceback|\[object|\bNaN\b/i);
});
