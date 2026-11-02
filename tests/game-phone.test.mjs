// CLOUD-SITE 11-02: the PHONE page for Guess the next line (/game-phone/, behind gamePhone, OFF). Players join with the TV's code and send a typed guess; only the SAMPLE room works and
// nothing leaves the phone. These tests prove the helpers (code, name, guess), that the sample room carries the public view only (never an answer or anyone's guess), the switch, and
// the page wiring. The browser walk, phone width, keyboard and accessibility scan are in tools/check-game-phone.mjs (Node Playwright, local server only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const J = x => JSON.parse(JSON.stringify(x));
const sample = JSON.parse(read('tests/fixtures/game-night-sample.json'));
const win = {}; vm.runInNewContext(read('assets/game-phone.js'), { window: win, document: { getElementById: () => null } });
const P = win.ryagramGamePhone;

test('the switch: only gamePhone exactly true turns it on; the config ships it OFF', () => {
  assert.deepEqual([P.on({}), P.on({ gamePhone: 'true' }), P.on({ gamePhone: 1 }), P.on({ gameTv: true }), P.on(null), P.on(undefined), P.on({ gamePhone: true })], [false, false, false, false, false, false, true]);
  assert.match(read('assets/ryagram-config.js'), /\n  gamePhone: false,/);
});

test('MUST FAIL: a room code is 4 letters with no I, no O and no number; spaces, a dash and lower case are forgiven', () => {
  for (const ok of ['GAME', 'game', ' ga-me ', 'G A M E', 'ABCD', 'zzzz']) assert.equal(P.codeProblem(ok), null, ok);
  for (const bad of ['', '   ', 'GAM', 'GAMES', 'G1ME', 'GOME', 'GIME', 'GAM3', 'ÄBCD', 'GA_E', '<scr', 'GAME;']) assert.ok(P.codeProblem(bad), JSON.stringify(bad));
  assert.match(P.codeProblem(''), /Type the room code/); assert.match(P.codeProblem('G0ME'), /no I, no O and no numbers/);
  assert.equal(P.normCode(' ga-me '), 'GAME'); assert.ok(!P.CODE_LETTERS.includes('I') && !P.CODE_LETTERS.includes('O')); assert.equal(P.CODE_LETTERS.length, 24);
});

test('MUST FAIL: a name is 1 to 16 letters after cleaning, and not one already in the room (any case)', () => {
  assert.equal(P.nameProblem('Dee'), null); assert.equal(P.nameProblem('  Dee  '), null); assert.equal(P.nameProblem('x'.repeat(16)), null); assert.equal(P.nameProblem('😀'.repeat(16)), null, 'counted in letters, not code units');
  assert.match(P.nameProblem(''), /Type a name/); assert.match(P.nameProblem('   '), /Type a name/); assert.match(P.nameProblem('\u200b\u0000'), /Type a name/, 'invisible characters only');
  assert.match(P.nameProblem('x'.repeat(17)), /at most 16/);
  assert.match(P.nameProblem('ana', ['Ana', 'Ben']), /already has that name/); assert.equal(P.nameProblem('Anna', ['Ana']), null);
  assert.equal(P.clean('  a\u0000b \u202e c\t\nd '), 'a b c d', 'control and direction characters become spaces, runs of spaces collapse');
});

test('MUST FAIL: a guess is 1 to 120 characters after cleaning; the counter counts what will be sent', () => {
  assert.equal(P.answerProblem('harbour at midnight'), null); assert.equal(P.answerProblem('x'.repeat(120)), null); assert.equal(P.answerProblem(`  ${'x'.repeat(120)}  `), null);
  assert.match(P.answerProblem(''), /Type your guess/); assert.match(P.answerProblem(' \n\t '), /Type your guess/); assert.match(P.answerProblem('x'.repeat(121)), /at most 120/);
  assert.equal(P.counterText(''), '0 of 120 characters'); assert.equal(P.counterText('  a  b '), '3 of 120 characters');
});

test('MUST FAIL: the sample room holds the public view ONLY: no answer, no recorded guess, no reveal; it refuses a broken sample', async () => {
  const room = P.sampleRoom(sample);
  assert.equal(room.code, 'GAME'); assert.equal(room.sample, true); assert.equal(room.rounds.length, sample.rounds.length); assert.deepEqual(J(room.players), sample.players);
  for (const [i, r] of room.rounds.entries()) {
    assert.deepEqual(Object.keys(r).sort(), ['heard_text', 'words_left']);
    assert.equal(r.heard_text, sample.rounds[i].public.heard_text); assert.equal(r.words_left, sample.rounds[i].public.words_left);
  }
  const all = JSON.stringify(room.rounds);
  for (const r of sample.rounds) {
    assert.ok(!all.includes(r.reveal.answer_text), 'no answer text');
    for (const g of r.guesses) if (g.text) assert.ok(!all.includes(g.text), `no recorded guess (${g.text})`);
  }
  assert.equal(P.sampleRoom(null), null); assert.equal(P.sampleRoom({ schema: 'x', rounds: [{}] }), null); assert.equal(P.sampleRoom({ ...J(sample), rounds: [] }), null);
  const s = J(sample); s.rounds[0].public.heard_text = ''; assert.equal(P.sampleRoom(s), null);
  // sending to the sample room keeps the guess in memory only and says ok
  assert.deepEqual(J(await room.send('Dee', 0, 'a guess')), { ok: true }); assert.equal(room.sentCount(), 1);
});

test('MUST FAIL: the code never reads the answer or anyone\'s guess, asks for no microphone, camera or file, and makes no outside request and stores nothing', () => {
  const code = read('assets/game-phone.js');
  assert.ok(!/reveal|answer_text|\.guesses|base_points|\.totals/.test(code), 'the phone never touches the answer, the recorded guesses or the scores');
  assert.ok(!/getUserMedia|mediaDevices|SpeechRecognition|type: ?'file'|<input[^>]*file|capture/.test(code), 'text only');
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|new Function|innerHTML|https?:\/\//.test(code), 'no network, no storage, no HTML strings');
  assert.match(code, /DRAFT\. /); assert.match(code, /nothing you type leaves this phone/); assert.match(code, /Text only/);
  assert.match(code, /role: 'alert'/); assert.match(code, /'aria-describedby'/); assert.match(code, /'aria-invalid'/); assert.match(code, /for: id/);
});

test('the page: noindex, hidden unless gamePhone is on, the scripts in order, no inline script, no outside script, no connections allowed', () => {
  const html = read('game-phone/index.html');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/); assert.match(html, /<p id="not-available">This page is not available yet\.<\/p>/); assert.match(html, /<div id="game-phone" hidden><h1>[^<]+<\/h1><\/div>/);
  assert.match(html, /connect-src 'none'/); assert.match(html, /form-action 'none'/);
  const at = n => html.indexOf(`src="/assets/${n}`); assert.ok(at('ryagram-config.js') > 0 && at('ryagram-config.js') < at('game-tv-sample.js') && at('game-tv-sample.js') < at('game-phone.js'));
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html) && !/<script[^>]*src="https?:/.test(html)); assert.match(html, /<a href="\/ai-content\/">AI content<\/a>/);
  assert.match(html, /game-phone\.css\?v=/); assert.match(read('assets/game-phone.css'), /font-size:16px/, 'inputs are 16 px so a phone does not zoom');
});

test('it is linked from nowhere else', () => {
  const all = fs.readdirSync(new URL('..', import.meta.url)).filter(f => f.endsWith('.html')).map(f => read(f)).join('\n') + read('help/index.html') + read('ryagram/index.html') + read('game-tv/index.html');
  assert.ok(!/game-phone/.test(all)); assert.ok(!/game-phone/.test(read('assets/app-library.js') + read('assets/app-departments.js') + read('assets/game-tv.js')));
});
