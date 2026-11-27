// Fill the gap, live: each round of assets/game-gap-rounds.js shows one made-up line with ONE word hidden, and is scored by assets/game-score.js scoreGuess UNCHANGED (the browser
// port of the engine's guess_line.score_guess) with the hidden word as a one-word answer. tests/fixtures/game-gap-golden.json holds the real Python score for invented guesses on every
// round (both written by tools/make-game-gaps.py over a MADE-UP transcript). These tests prove the port gives exactly those results and that the shown line never gives the word away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const J = x => JSON.parse(JSON.stringify(x));
const SCORE_JS = process.env.GAME_SCORE_JS ? fs.readFileSync(process.env.GAME_SCORE_JS, 'utf8') : read('assets/game-score.js');                          // a scratch copy, for must-fail runs
const GAPS_JS = process.env.GAME_GAPS_JS ? fs.readFileSync(process.env.GAME_GAPS_JS, 'utf8').replace(/\r\n/g, '\n') : read('assets/game-gap-rounds.js');   // a scratch copy, for must-fail runs
const sw = {}; vm.runInNewContext(SCORE_JS, { window: sw });
const S = sw.ryagramGameScore;
const rw = {}; vm.runInNewContext(GAPS_JS, { window: rw });
const pack = rw.ryagramGameGapRounds;
const golden = JSON.parse(read('tests/fixtures/game-gap-golden.json'));
const roundOf = r => ({ answer: r.answer, rarity: r.rarity, words_left: r.public.words_left });
const GAP = '____';
const MADE_UP = read('tools/make-game-gaps.py');

test('the pack and the golden file are the engine\'s, plainly made up, and line up round by round', () => {
  assert.equal(pack.schema, 'ryagram.game-gap-rounds/0'); assert.match(pack.note, /MADE-UP/); assert.equal(golden.schema, 'ryagram.game-gap-golden/0');
  assert.equal(pack.rounds.length, 5); assert.equal(golden.rounds.length, 5);
  pack.rounds.forEach((r, i) => {
    assert.deepEqual(Object.keys(r.public).sort(), ['difficulty', 'id', 'shown_text', 'words_left']);
    assert.equal(golden.rounds[i].id, r.public.id);
    assert.equal(r.public.words_left, 1); assert.equal(r.answer.length, 1); assert.equal(r.phrase_count, 1);
    assert.equal(r.rarity, r.answer[0].rarity, 'the round\'s rarity is the hidden word\'s rarity');
    assert.ok(golden.rounds[i].cases.length >= 15);
    assert.ok(Math.abs(S.basePoints(roundOf(r)) - r.base_points) < 1e-9, 'base points follow the engine\'s base_points');
  });
});

test('every golden case: scoreGuess gives exactly the engine\'s points, accuracy, verdict, marks and truncated flag', () => {
  let n = 0;
  pack.rounds.forEach((r, i) => {
    for (const c of golden.rounds[i].cases) {
      assert.deepStrictEqual(J(S.scoreGuess(roundOf(r), c.guess)), c.result, `round ${i} case "${c.label}" (${JSON.stringify(c.guess)})`); n++;
    }
  });
  assert.ok(n >= 75, `only ${n} golden cases`);
});

test('the shown line has exactly one gap, never holds the hidden word, and with the word put back is exactly the made-up line', () => {
  pack.rounds.forEach((r, i) => {
    const shown = r.public.shown_text, word = r.answer[0].word;
    assert.equal(shown.split(GAP).length - 1, 1, `round ${i}: one gap in ${JSON.stringify(shown)}`);
    assert.ok(!shown.toLowerCase().includes(word.toLowerCase()), `round ${i}: ${JSON.stringify(shown)} gives away "${word}"`);
    assert.ok(!JSON.stringify(r.public).toLowerCase().includes(word.toLowerCase()), `round ${i}: the public view gives away "${word}"`);
    const line = shown.replace(GAP, word);
    assert.equal(line, golden.rounds[i].line, `round ${i}: the word put back`);
    assert.ok(MADE_UP.includes(`'${line}'`), `"${line}" is one of the made-up lines`);
    assert.ok(word.length >= 4 && !shown.startsWith(GAP), `round ${i}: the rule (at least 4 letters, not the first word)`);
  });
});

test('the 5 hidden words are distinct', () => {
  const words = pack.rounds.map(r => r.answer[0].norm);
  assert.equal(new Set(words).size, 5, words.join(', '));
});
