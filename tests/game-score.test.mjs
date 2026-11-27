// Guess the next line, live: assets/game-score.js is a browser PORT of the engine's guess_line.score_guess (Ryagram ryagram/games/guess_line.py). These tests prove it gives EXACTLY the
// engine's results: tests/fixtures/game-score-golden.json holds the real Python score for every invented guess on the rounds of assets/game-rounds.js (both written by tools/make-game-rounds.py
// over a MADE-UP transcript), plus the engine's answer for word-rule cases (numbers, endings, near misses that are not near, Unicode folding, Python's whitespace).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const J = x => JSON.parse(JSON.stringify(x));
const SCORE_JS = process.env.GAME_SCORE_JS ? fs.readFileSync(process.env.GAME_SCORE_JS, 'utf8') : read('assets/game-score.js');     // GAME_SCORE_JS: a scratch copy, for must-fail runs
const sw = {}; vm.runInNewContext(SCORE_JS, { window: sw });
const S = sw.ryagramGameScore;
const rw = {}; vm.runInNewContext(read('assets/game-rounds.js'), { window: rw });
const pack = rw.ryagramGameRounds;
const golden = JSON.parse(read('tests/fixtures/game-score-golden.json'));
const roundOf = r => ({ answer: r.answer, rarity: r.rarity, words_left: r.public.words_left });

test('the pack and the golden file are the engine\'s, plainly made up, and line up round by round', () => {
  assert.equal(pack.schema, 'ryagram.game-rounds/0'); assert.match(pack.note, /MADE-UP/); assert.equal(golden.schema, 'ryagram.game-score-golden/0');
  assert.equal(pack.rounds.length, 5); assert.equal(golden.rounds.length, 5); assert.equal(pack.seed, golden.seed);
  pack.rounds.forEach((r, i) => {
    assert.equal(golden.rounds[i].id, r.public.id); assert.match(r.public.file, /^made-up-show/);
    assert.equal(r.answer.length, r.public.words_left); assert.ok(golden.rounds[i].cases.length >= 25);
    assert.ok(Math.abs(S.basePoints(roundOf(r)) - r.base_points) < 2.5e-5, 'base points from the stored rarity (6 places: at most 40 x 5e-7 off) match the engine');
  });
  assert.ok(Object.isFrozen(S));
});

test('every golden case: scoreGuess gives exactly the engine\'s points, accuracy, verdict, marks and truncated flag', () => {
  let n = 0;
  pack.rounds.forEach((r, i) => {
    for (const c of golden.rounds[i].cases) {
      assert.deepStrictEqual(J(S.scoreGuess(roundOf(r), c.guess)), c.result, `round ${i} case "${c.label}" (${JSON.stringify(c.guess)})`); n++;
    }
  });
  assert.ok(n >= 125, `only ${n} golden cases`);
});

test('the word rules give the engine\'s answers: credit, one edit, loose keys, normalize_word, normalize_phrase', () => {
  for (const c of golden.credit) {
    assert.equal(S.credit(c.g, c.a), c.credit, `credit(${c.g}, ${c.a})`); assert.equal(S.oneEdit(c.g, c.a), c.one_edit, `oneEdit(${c.g}, ${c.a})`);
  }
  for (const c of golden.loose_keys) assert.deepStrictEqual(J(S.looseKeys(c.word)), c.keys, `looseKeys(${c.word})`);
  for (const c of golden.words) assert.equal(S.normalizeWord(c.word), c.norm, `normalizeWord(${JSON.stringify(c.word)})`);
  for (const c of golden.phrases) assert.deepStrictEqual(J(S.normalizePhrase(c.phrase)), c.words, `normalizePhrase(${JSON.stringify(c.phrase)})`);
});

test('hand-checked cases (counted by hand from the rules, not from the engine)', () => {
  const rnd = { answer: [{ word: 'garden', norm: 'garden', rarity: 1 }, { word: 'shed.', norm: 'shed', rarity: 1 }], rarity: 1, words_left: 2 };
  assert.equal(S.basePoints(rnd), 40 + 40 + 4);                         // 40 + 40 x 1 + 20 x 2 / 10
  assert.deepStrictEqual(J(S.scoreGuess(rnd, 'Garden SHED!')), { points: 84, accuracy: 1, verdict: 'exact', marks: [{ word: 'garden', mark: 'exact' }, { word: 'shed.', mark: 'exact' }], truncated: false });
  // one near word: coverage (1.5 + 0.6 x 1.5) / 3 = 0.8, precision 1.6 / 2 = 0.8, accuracy 0.64, points round(0.64 x 84 = 53.76) = 54
  assert.deepStrictEqual(J(S.scoreGuess(rnd, 'gardens shed')), { points: 54, accuracy: 0.64, verdict: 'partial', marks: [{ word: 'garden', mark: 'near' }, { word: 'shed.', mark: 'exact' }], truncated: false });
  // padding: coverage 1, precision 2 / 4 = 0.5, points 42
  assert.equal(S.scoreGuess(rnd, 'garden shed purple kettle').points, 42);
  assert.deepStrictEqual(J(S.scoreGuess(rnd, '  ')), { points: 0, accuracy: 0, verdict: 'no guess', marks: [{ word: 'garden', mark: 'missed' }, { word: 'shed.', mark: 'missed' }], truncated: false });
  assert.equal(S.scoreGuess(rnd, 'zip '.repeat(12)).truncated, true);      // cap 3 x 2 + 5 = 11 words
  assert.equal(S.scoreGuess(rnd, 'zip '.repeat(11)).truncated, false);
  // wrong order: only one word aligns, coverage 1.5 / 3 = 0.5, precision 1 / 2 = 0.5, accuracy 0.25, points round(21) = 21
  assert.deepStrictEqual([S.scoreGuess(rnd, 'shed garden').verdict, S.scoreGuess(rnd, 'shed garden').accuracy, S.scoreGuess(rnd, 'shed garden').points], ['a few words', 0.25, 21]);
  assert.deepStrictEqual(J(S.guessWords('garden-shed', ['gardenshed'])), ['gardenshed']);
  assert.deepStrictEqual(J(S.guessWords('garden\u2014shed', ['garden', 'shed'])), ['garden', 'shed']);
  assert.equal(S.normalizeWord('Caf\u00e9'), 'cafe'); assert.equal(S.normalizeWord('don\u2019t'), "don't");
  assert.equal(S.credit('hear', 'here'), 0); assert.equal(S.credit('cat', 'cart'), 0); assert.equal(S.credit('17', 'seventeen'), 0.6); assert.equal(S.credit('heard', 'heart'), 0.6);
  assert.equal(S.credit('heard', 'hered'), 0);      // two letters differ (the engine docstring calls this a near miss, but its own _credit says 0, and the port follows the code)
});

test('Python rounding: a .5 points total goes to the even number, not always up', () => {
  const one = (rarity, n) => ({ answer: Array.from({ length: n }, (_, k) => ({ word: `w${k}`, norm: `w${k}`, rarity })), rarity, words_left: n });
  // base 40 + 40 x 0.0625 + 20 x 0.1 = 44.5 exactly; an exact one-word guess scores round(44.5) = 44 in Python (Math.round would say 45)
  assert.equal(S.scoreGuess(one(0.0625, 1), 'w0').points, 44);
  // base 40 + 40 x 0.1875 + 20 x 0.1 = 49.5 exactly: round(49.5) = 50
  assert.equal(S.scoreGuess(one(0.1875, 1), 'w0').points, 50);
  // an exact tie in the accuracy: 4 words of weight 1, one right word in 8 typed: coverage 0.25 x precision 0.125 = 0.03125 exactly; Python round(0.03125, 4) = 0.0312 (toFixed would say 0.0313)
  const tie = S.scoreGuess(one(0.5, 4), 'w0 zip zip zip zip zip zip zip');
  assert.deepStrictEqual([tie.accuracy, tie.points, tie.verdict], [0.0312, 2, 'a few words']);      // points round(0.03125 x 68 = 2.125) = 2
});

test('the public view of each round never holds the answer: the clip stops before the first answer word and heard_text is only the words heard', () => {
  for (const r of pack.rounds) {
    assert.deepEqual(Object.keys(r.public).sort(), ['clip_start_ms', 'difficulty', 'file', 'heard_text', 'id', 'stop_ms', 'words_left']);
    const answerText = r.answer.map(a => a.word).join(' ');
    assert.ok(!JSON.stringify(r.public).includes(answerText));
    assert.ok(r.public.stop_ms > r.public.clip_start_ms);
    const heard = r.public.heard_text.split(' ');
    // the heard words plus the answer make one whole made-up line: the answer is what follows, never part of what is heard
    const sentence = heard.concat(r.answer.map(a => a.word)).join(' ');
    assert.ok(read('tools/make-game-rounds.py').includes(`'${sentence}'`), `"${sentence}" is one of the made-up lines`);
    // the made-up timing (320 ms words, 40 ms gaps, the clip starts 800 ms before the line): the first answer word starts at line start + heard x 360; the clip stops before it
    const lineStart = r.public.clip_start_ms + 800, firstAnswerStart = lineStart + heard.length * 360;
    assert.ok(r.public.stop_ms < firstAnswerStart && r.public.stop_ms >= firstAnswerStart - 40, `stop ${r.public.stop_ms} vs first answer word ${firstAnswerStart}`);
  }
  const code = SCORE_JS;
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|eval\(|WebSocket|https?:\/\//.test(code), 'no network, storage or outside address');
  assert.match(code, /PORT of the Ryagram engine's guess_line\.score_guess/); assert.match(code, /tests\/game-score\.test\.mjs/);
});
