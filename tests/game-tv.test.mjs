// NEXT-WEB 203: the TV screen page for Guess the next line (/game-tv/, behind gameTv, OFF). It replays a RECORDED sample game made by FACES' real engine (Ryagram ryagram/games/guess_line.py) over a MADE-UP
// transcript (tools/make-game-sample.py). The page scores nothing itself; these tests prove the sample is what the engine promises, the page's small helpers, and the page wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const J = x => JSON.parse(JSON.stringify(x));
const sample = JSON.parse(read('tests/fixtures/game-night-sample.json'));
const sw = {}; vm.runInNewContext(read('assets/game-tv-sample.js'), { window: sw });
const win = { ryagramGameTvSample: sw.ryagramGameTvSample }; vm.runInNewContext(read('assets/game-tv.js'), { window: win, document: { getElementById: () => null } });
const T = win.ryagramGameTv;

test('the page\'s copy of the sample is exactly the recorded engine output, and it is plainly made up', () => {
  assert.deepEqual(J(sw.ryagramGameTvSample), sample);
  assert.equal(sample.schema, 'ryagram.game-night-sample/0'); assert.match(sample.note, /MADE-UP/); assert.match(sample.rounds[0].public.file, /^made-up-show/);
  assert.equal(sample.rounds.length, 3); assert.deepEqual(J(sample.players), ['Ana', 'Ben', 'Cy']);
});

test('what the engine promised holds in the recording: the public view has no answer, the totals add up, no round pays more than a perfect guess, each verdict matches its points', () => {
  const totals = Object.fromEntries(sample.players.map(p => [p, 0]));
  for (const r of sample.rounds) {
    assert.deepEqual(Object.keys(r.public).sort(), ['clip_start_ms', 'difficulty', 'file', 'heard_text', 'id', 'stop_ms', 'words_left']);
    const answerWords = r.reveal.answer_text.split(' ');
    assert.equal(answerWords.length, r.public.words_left); assert.ok(!JSON.stringify(r.public).includes(r.reveal.answer_text), 'the public view never holds the answer');
    assert.ok(r.public.stop_ms > r.public.clip_start_ms);
    for (const g of r.guesses) {
      totals[g.player] += g.result.points; assert.ok(g.result.points <= Math.round(r.reveal.base_points));
      assert.equal(g.result.marks.length, answerWords.length);
      if (g.result.verdict === 'no guess' || g.result.verdict === 'miss') assert.equal(g.result.points, 0);
      if (g.result.verdict === 'exact') assert.ok(g.result.marks.every(m => m.mark === 'exact'));
    }
  }
  assert.deepEqual(totals, sample.totals);
});

test('places: a tie shares the place and the next place is skipped; names order ties; 1st 2nd 3rd 4th', () => {
  assert.deepEqual(J(T.ranks({ Ana: 10, Ben: 10, Cy: 5 })).map(r => [r.player, r.place]), [['Ana', 1], ['Ben', 1], ['Cy', 3]]);
  assert.deepEqual(J(T.ranks({ A: 3, B: 9, C: 6 })).map(r => [r.player, r.place]), [['B', 1], ['C', 2], ['A', 3]]);
  assert.deepEqual(J(T.ranks({ A: 0, B: 0 })).map(r => r.place), [1, 1]); assert.deepEqual(J(T.ranks({})), []);
  assert.deepEqual([1, 2, 3, 4, 11].map(T.placeWord), ['1st', '2nd', '3rd', '4th', '11th']);
});

test('the one line of why: from the engine\'s own marks, plain, and never invents a number', () => {
  const mk = (verdict, marks, extra) => ({ verdict, marks: marks.map(m => ({ word: 'w', mark: m })), ...extra });
  assert.equal(T.reasonFor(mk('no guess', ['missed', 'missed'])), 'no guess, so no points');
  assert.equal(T.reasonFor(mk('miss', ['missed', 'missed', 'missed'])), 'none of the 3 words, so no points');
  assert.equal(T.reasonFor(mk('exact', ['exact', 'exact'])), '2 of the 2 words, exact');
  assert.equal(T.reasonFor(mk('close', ['exact', 'near', 'exact'])), '3 of the 3 words (1 nearly), close');
  assert.match(T.reasonFor(mk('partial', ['exact', 'missed'], { truncated: true })), /cut because it was far too long/);
  for (const r of sample.rounds) for (const g of r.guesses) assert.ok(T.reasonFor(g.result).length > 5);
});

test('the timer words and the checker: it refuses a sample whose public view leaks the answer, whose totals do not add up, or that is not a sample', () => {
  assert.equal(T.timerText(30), '30 seconds left'); assert.equal(T.timerText(1), '1 second left'); assert.equal(T.timerText(0), 'Time is up'); assert.equal(T.timerText(-3), 'Time is up');
  assert.deepEqual(J(T.check(sample)), []);
  const bad = fn => { const s = J(sample); fn(s); return T.check(s); };
  assert.ok(bad(s => { s.rounds[0].public.answer_text = s.rounds[0].reveal.answer_text; })[0].match(/public view holds the answer/));
  assert.ok(bad(s => { s.totals.Ana += 1; }).some(m => /totals do not add up/.test(m)));
  assert.ok(bad(s => { s.rounds = []; }).some(m => /no rounds/.test(m)));
  assert.ok(bad(s => { delete s.rounds[1].reveal; }).some(m => /no reveal/.test(m)));
  assert.ok(bad(s => { s.rounds[0].guesses[0].result.points = 'lots'; }).some(m => /has no score/.test(m)));
  assert.deepEqual(J(T.check(null)), ['not a game night sample']); assert.deepEqual(J(T.check({ schema: 'x' })), ['not a game night sample']);
});

test('the generator exists, says how to check it, and writes both copies; the page: noindex, hidden unless gameTv is exactly true, no outside request, nothing stored, nothing fetched', () => {
  const py = read('tools/make-game-sample.py'); assert.match(py, /guess_line/); assert.match(py, /--check/); assert.match(py, /game-tv-sample\.js/);
  const html = read('game-tv/index.html');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/); assert.match(html, /<p id="not-available">This page is not available yet\.<\/p>/); assert.match(html, /<div id="game-tv" hidden><\/div>/);
  const at = n => html.indexOf(`src="/assets/${n}`); assert.ok(at('ryagram-config.js') > 0 && at('ryagram-config.js') < at('game-tv-sample.js') && at('game-tv-sample.js') < at('game-tv.js'));
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html) && !/<script[^>]*src="https?:/.test(html)); assert.match(html, /<a href="\/ai-content\/">AI content<\/a>/);
  assert.match(read('assets/ryagram-config.js'), /\n  gameTv: false,/);
  const code = read('assets/game-tv.js');
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|eval\(|WebSocket|https?:\/\//.test(code), 'no network, storage or outside address');
  assert.deepEqual([T.on({}), T.on({ gameTv: 'true' }), T.on({ gameTv: 1 }), T.on({ gameTv: true }), T.on(null)], [false, false, false, true, false]);
  assert.match(code, /SAMPLE NIGHT/); assert.match(code, /Typing guesses and live scoring run in the Ryagram app/); assert.match(code, /This sample has no video/);
  const answerUses = code.split('reveal.answer_text').length - 1; assert.equal(answerUses, 3, 'the answer text is used in the checker, the reveal and the reveal announcement only');
  const q = code.slice(code.indexOf("if (phase === 'question')"), code.indexOf("} else if (phase === 'locked')")); assert.ok(!/answer_text|r\.reveal|g\.text|r\.guesses/.test(q), 'the question screen draws neither the answer nor any guess');
});

test('it is linked from nowhere else', () => {
  const all = fs.readdirSync(new URL('..', import.meta.url)).filter(f => f.endsWith('.html')).map(f => read(f)).join('\n') + read('help/index.html') + read('ryagram/index.html');
  assert.ok(!/game-tv/.test(all)); assert.ok(!/game-tv/.test(read('assets/app-library.js') + read('assets/app-departments.js')));
});
