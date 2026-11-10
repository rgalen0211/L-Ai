// The games AI host contract checker (CONNECT, 2026-11-09; BACKLOG CONNECT-5; contract proposals/CONNECT-GAMES-AI-HOST-CONTRACT-1109.md): tools/games-host-contract.mjs. The good example passes; EVERY rule has a planted bad case that must fail with its own words,
// so a checker that stops looking is caught here, not in GAMES' stand-in night. The examples are the shared fixtures (tests/fixtures/games-host/build.mjs, all invented). Must-fails of the checker itself: tests/games_host_contract_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { goodManifest, goodTranscript } from './fixtures/games-host/build.mjs';
import { ALWAYS_BANNED_KEYS, DESTRUCTIVE, OPTIONAL_TOOLS, QUOTED_REMINDER, READ_ONLY, REQUIRED_TOOLS, SECRET_KEYS, checkManifest, checkTranscript } from '../tools/games-host-contract.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));
const RLO = String.fromCharCode(0x202e), NUL = String.fromCharCode(0);
const dir = new URL('./fixtures/games-host/', import.meta.url);

test('the committed good-manifest.json and good-transcript.json are exactly what build.mjs makes (so GAMES reads the examples this checker is tested with)', () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(new URL('good-manifest.json', dir), 'utf8')), goodManifest());
  assert.deepEqual(JSON.parse(fs.readFileSync(new URL('good-transcript.json', dir), 'utf8')), goodTranscript());
  for (const f of ['good-manifest.json', 'good-transcript.json']) assert.ok(!/[^\x20-\x7e\r\n]/.test(fs.readFileSync(new URL(f, dir), 'utf8')), `${f}: plain ASCII only`);
});

test('the good tool list and the good night meet the contract', () => {
  assert.deepEqual(checkManifest(goodManifest()), []);
  assert.deepEqual(checkTranscript(goodTranscript()), []);
  const names = goodManifest().map((t) => t.name);
  assert.deepEqual(names, [...REQUIRED_TOOLS, ...OPTIONAL_TOOLS]);
  assert.deepEqual(goodManifest().filter((t) => t.annotations.readOnlyHint).map((t) => t.name), READ_ONLY);
  assert.deepEqual(goodManifest().filter((t) => t.annotations.destructiveHint).map((t) => t.name), DESTRUCTIVE);
  assert.deepEqual(checkManifest(goodManifest().filter((t) => !OPTIONAL_TOOLS.includes(t.name))), [], 'the two seat tools may be absent when the AI seat is off');
});

// ------------------------------------------------------------------------------------------------ the tool list: one planted fault per rule
const by = (m, n) => m.find((t) => t.name === n);
const MANIFEST_FAULTS = [
  ['a tool missing', (m) => m.filter((t) => t.name !== 'reveal'), /The tool reveal is missing/],
  ['a tool listed twice', (m) => [...m, clone(by(m, 'lock'))], /lock is listed twice/],
  ['a tool that is not a games tool', (m) => [...m, { ...clone(by(m, 'lock')), name: 'delete_library' }], /delete_library is not one of the games tools/],
  ['a name with capitals', (m) => { by(m, 'lock').name = 'Lock'; return m; }, /the name must be lowercase/],
  ['a tool that waits or watches', (m) => [...m, { ...clone(by(m, 'lock')), name: 'wait_for_reveal' }], /would invite the AI to loop/],
  ['no annotations', (m) => { delete by(m, 'lock').annotations; return m; }, /all four annotations/],
  ['a missing annotation', (m) => { delete by(m, 'lock').annotations.idempotentHint; return m; }, /all four annotations/],
  ['a tool that reaches outside the room', (m) => { by(m, 'lock').annotations.openWorldHint = true; return m; }, /openWorldHint must be false/],
  ['a reading tool not marked read-only', (m) => { by(m, 'scores').annotations.readOnlyHint = false; return m; }, /readOnlyHint must be true/],
  ['a changing tool marked read-only', (m) => { by(m, 'lock').annotations.readOnlyHint = true; return m; }, /readOnlyHint must be false/],
  ['remove not marked destructive', (m) => { by(m, 'remove').annotations.destructiveHint = false; return m; }, /destructiveHint must be true/],
  ['end_night not marked destructive', (m) => { by(m, 'end_night').annotations.destructiveHint = false; return m; }, /destructiveHint must be true/],
  ['a tool wrongly marked destructive', (m) => { by(m, 'skip').annotations.destructiveHint = true; return m; }, /not destructive; only remove and end_night are/],
  ['a description that is too short', (m) => { by(m, 'lock').description = 'Locks.'; return m; }, /20 to 600 characters/],
  ['a description that is too long', (m) => { by(m, 'lock').description = 'x'.repeat(601); return m; }, /20 to 600 characters/],
  ['a description with a web address', (m) => { by(m, 'lock').description += ' See https://example.org/x for more.'; return m; }, /holds a web address/],
  ['room_status that does not mention changed_at', (m) => { by(m, 'room_status').description = 'Reads what the TV shows, quoted as data, whenever you like.'; return m; }, /must tell the AI to use changed_at/],
  ['a tool both read-only and destructive', (m) => { by(m, 'scores').annotations.destructiveHint = true; return m; }, /cannot be both read-only and destructive/],
  ['a destructive tool that does not say it only asks', (m) => { by(m, 'remove').description = 'Removes a player from the room right away, for good.'; return m; }, /must say it only asks \(waiting\) and the host presses Confirm/],
  ['a reading tool that does not say players\' words are data', (m) => { by(m, 'scores').description = 'Reads the standings after the last reveal, for the AI to announce.'; return m; }, /players' words come back under quoted/],
  ['an input that is not closed', (m) => { by(m, 'lock').inputSchema.additionalProperties = true; return m; }, /closed object/],
  ['an input that takes an address', (m) => { by(m, 'open_room').inputSchema.properties.room_url = { type: 'string', maxLength: 100 }; return m; }, /would take an address or a file/],
  ['a text input with no limit', (m) => { by(m, 'let_back').inputSchema.properties.name = { type: 'string' }; return m; }, /needs a maximum length/],
  ['a list input with no limit', (m) => { by(m, 'open_room').inputSchema.properties.extra = { type: 'array', items: { type: 'string' } }; return m; }, /needs a maximum size/],
  ['an input that is a web address', (m) => { by(m, 'let_back').inputSchema.properties.name = { type: 'string', maxLength: 40, format: 'uri' }; return m; }, /takes a web address/],
  ['the join card tool shows no page', (m) => { delete by(m, 'join_card')._meta; return m; }, /_meta\.ui\.resourceUri must be ui:\/\/ryagram-games\/join/],
  ['the join card tool shows another page', (m) => { by(m, 'open_room')._meta.ui.resourceUri = 'ui://ryagram-games/other'; return m; }, /_meta\.ui\.resourceUri must be/],
  ['another tool shows a page', (m) => { by(m, 'scores')._meta = { ui: { resourceUri: 'ui://ryagram-games/join' } }; return m; }, /only open_room and join_card show a page/],
];
test('every rule of the tool list has a planted fault that is caught, with its own words', () => {
  for (const [name, f, want] of MANIFEST_FAULTS) {
    const problems = checkManifest(f(clone(goodManifest())));
    assert.ok(problems.length >= 1, name);
    assert.ok(problems.some((x) => want.test(x)), `${name}: ${problems.join(' | ')}`);
  }
  assert.deepEqual(checkManifest('x'), ['The tool list is not a list.']);
  assert.ok(checkManifest([1]).some((x) => /not an object/.test(x)));
});

// ------------------------------------------------------------------------------------------------ a night: one planted fault per rule
const at = (t, tool, nth = 0) => t.filter((e) => e.kind === 'call' && e.tool === tool)[nth];
const sc = (e) => e.result.structuredContent;
const NIGHT_FAULTS = [
  ['no structured result', (t) => { delete at(t, 'lock').result.structuredContent; }, /no structuredContent object/],
  ['no changed_at', (t) => { delete sc(at(t, 'lock')).changed_at; }, /changed_at must be a whole number/],
  ['a changed_at that is not a whole number', (t) => { sc(at(t, 'lock')).changed_at = 5.5; }, /changed_at must be a whole number/],
  ['a negative changed_at', (t) => { sc(at(t, 'lock')).changed_at = -1; }, /changed_at must be a whole number/],
  ['changed_at that goes backwards', (t) => { sc(at(t, 'room_status', 2)); sc(at(t, 'scores', 1)).changed_at = 1; }, /changed_at went backwards|changed_at/],
  ['no refusal field', (t) => { delete sc(at(t, 'lock')).refusal; }, /refusal must be the room's sentence or null/],
  ['a refusal that is not text', (t) => { sc(at(t, 'lock')).refusal = 5; }, /refusal must be the room's sentence or null/],
  ['a refusal reported as an error', (t) => { sc(at(t, 'reveal')).refusal = 'A Bluff is still being written.'; at(t, 'reveal').result.isError = true; }, /a refusal is a result, not an error/],
  ['words that are too long', (t) => { at(t, 'lock').result.content[0].text = 'x'.repeat(601); }, /1 to 600 characters/],
  ['no words at all', (t) => { at(t, 'lock').result.content = []; }, /1 to 600 characters/],
  ['a control character in the words', (t) => { at(t, 'lock').result.content[0].text = 'Locked.' + NUL; }, /control or direction character/],
  ['a direction mark in the words', (t) => { at(t, 'lock').result.content[0].text = 'Locked.' + RLO; }, /control or direction character/],
  ['quoted that is not a list', (t) => { sc(at(t, 'room_status', 2)).quoted = 'x'; }, /quoted must be a list/],
  ['a quoted entry with an extra field', (t) => { sc(at(t, 'room_status', 2)).quoted[0].score = 3; }, /exactly \{ from, text \}/],
  ['a quoted entry that is too long', (t) => { sc(at(t, 'room_status', 2)).quoted[0].text = 'a made-up line '.repeat(20); }, /longer than its limit/],
  ['a quoted entry with a direction mark', (t) => { sc(at(t, 'room_status', 2)).quoted[0].text = 'made-up' + RLO + ' line'; }, /quoted entry holds a control or direction character/],
  ['quoted text with no reminder', (t) => { at(t, 'room_status', 2).result.content[0].text = 'Round 1, writing: one fake line so far.'; }, /must open with the reminder/],
  ['a player\'s words inside the tool\'s own sentence', (t) => { at(t, 'room_status', 2).result.content[0].text = QUOTED_REMINDER + ' Ana wrote: a made-up fake line about a made-up show'; }, /appear inside the tool's own sentence/],
  ['a player\'s words in another field', (t) => { sc(at(t, 'room_status', 2)).view.last_line = 'a made-up fake line about a made-up show'; }, /appear outside quoted/],
  ['a secret key before the reveal', (t) => { sc(at(t, 'room_status', 2)).view.answer = 'the made-up answer'; }, /carries answer .* before the reveal/],
  ['who wrote the fake, before the reveal', (t) => { sc(at(t, 'room_status', 2)).view.bluff_writer = 'Ana'; }, /carries bluff_writer/],
  ['the hidden character, before the reveal', (t) => { sc(at(t, 'room_status', 2)).view.hidden_character = 'a made-up person'; }, /carries hidden_character/],
  ['a hand, before the reveal', (t) => { sc(at(t, 'room_status', 2)).view.hands = [['card']]; }, /carries hands/],
  ['a file name key', (t) => { sc(at(t, 'room_status', 2)).view.file = 'clip.bin'; }, /carries file/],
  ['clip times keys', (t) => { sc(at(t, 'room_status', 2)).view.start_time = 12; }, /carries start_time/],
  ['the phone address key', (t) => { sc(at(t, 'join_card')).phone_url = 'x'; }, /carries phone_url/],
  ['an IP address in a text', (t) => { sc(at(t, 'join_card')).hint = 'Join at 192.168.1.20 on the same Wi-Fi'; }, /holds an IP address/],
  ['a web address in the words', (t) => { at(t, 'join_card').result.content[0].text = 'Join code KXQT at http://x.example/join'; }, /the words hold a web address/],
  ['a media file name in a text', (t) => { sc(at(t, 'room_status', 2)).view.note = 'Playing clip_017.mp4'; }, /holds a media file name/],
  ['a time inside a file in a text', (t) => { sc(at(t, 'room_status', 2)).view.note = 'Clip at 00:12:31'; }, /holds a time inside a file/],
  ['a path on the computer in a text', (t) => { sc(at(t, 'room_status', 2)).view.note = 'from D:\\Ryagram\\clips'; }, /holds a path on the computer/],
  ['a local host name in a text', (t) => { sc(at(t, 'join_card')).hint = 'Open localhost to join'; }, /holds a local host name/],
  ['the join card with no code', (t) => { delete sc(at(t, 'join_card')).code; }, /the card must carry the 4-letter code/],
  ['the join card with a lowercase code', (t) => { sc(at(t, 'join_card')).code = 'kxqt'; }, /the card must carry the 4-letter code/],
  ['remove that finishes by itself', (t) => { sc(at(t, 'remove')).state = 'done'; }, /must come back waiting/],
  ['end_night that finishes by itself', (t) => { sc(at(t, 'end_night')).state = 'done'; }, /must come back waiting/],
  ['a waiting step with no ask_id', (t) => { delete sc(at(t, 'remove')).ask_id; }, /needs an ask_id/],
  ['a step finished that the TV never confirmed', (t) => { t.splice(t.findIndex((e) => e.kind === 'tv_confirm'), 1); }, /Confirm was never pressed/],
  ['asking again with nothing new returns the whole view', (t) => { sc(at(t, 'room_status', 1)).view = { phase: 'between_rounds' }; }, /must say nothing_changed and carry no view/],
  ['asking again with nothing new does not say so', (t) => { delete sc(at(t, 'room_status', 1)).nothing_changed; }, /must say nothing_changed/],
  ['scores in a round in play that are not the last reveal\'s', (t) => { sc(at(t, 'scores', 1)).as_of = 'now'; }, /must say as_of last_reveal/],
  ['scores in a round in play for the wrong round', (t) => { sc(at(t, 'scores', 1)).round = 2; }, /not the round in play/],
  ['a round the AI wrote that does not say so', (t) => { delete sc(at(t, 'next_round', 1)).written_by_ai; }, /must say written_by_ai/],
  ['a round the AI wrote that the AI plays', (t) => { delete sc(at(t, 'next_round', 1)).ai_seat_sits_out; }, /must sit out a round it wrote/],
  ['the AI plays a round it wrote', (t) => { t.push({ kind: 'call', tool: 'play', args: { token: 'seat-token', move: 'a guess', round_written_by_ai: true }, result: { content: [{ type: 'text', text: 'Played.' }], structuredContent: { refusal: null, changed_at: 10 }, isError: false }, phase: 'round_in_play' }); }, /played a round it wrote/],
];
test('every rule of a night has a planted fault that is caught, with its own words', () => {
  for (const [name, f, want] of NIGHT_FAULTS) {
    const t = clone(goodTranscript());
    f(t);
    const problems = checkTranscript(t);
    assert.ok(problems.length >= 1, `${name}: nothing was caught`);
    assert.ok(problems.some((x) => want.test(x)), `${name}: ${problems.join(' | ')}`);
  }
  assert.deepEqual(checkTranscript('x'), ['The transcript is not a list.']);
});

test('after the reveal the answer may be shown (the secrets rule is "before the reveal"); where a file is and where the room is are never shown, at any time', () => {
  const t = clone(goodTranscript());
  const reveal = at(t, 'reveal');
  sc(reveal).answer = 'the made-up answer';
  reveal.phase = 'revealed';
  assert.deepEqual(checkTranscript(t), []);
  sc(reveal).file = 'x';
  assert.ok(checkTranscript(t).some((x) => /carries file/.test(x)));
  assert.ok(SECRET_KEYS.includes('answer') && ALWAYS_BANNED_KEYS.includes('file') && !ALWAYS_BANNED_KEYS.includes('answer'));
});

test('a refusal in the room\'s own words is an ordinary result: a refused destructive ask need not say waiting, and a Bluff reveal refusal is allowed', () => {
  const t = clone(goodTranscript());
  const rm = at(t, 'remove');
  rm.result.structuredContent = { refusal: 'Ben is not in the room.', changed_at: 8 };
  assert.deepEqual(checkTranscript(t).filter((x) => /Step 12/.test(x)), []);
});

// ------------------------------------------------------------------------------------------------ the command line
test('the command line: exit 0 for the good examples, 1 with the problems printed for a bad one, 2 for an unreadable file', () => {
  const run = (...a) => spawnSync(process.execPath, [new URL('../tools/games-host-contract.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), ...a], { encoding: 'utf8' });
  const good = (n) => new URL(n, dir).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const ok = run(good('good-manifest.json'), good('good-transcript.json'));
  assert.equal(ok.status, 0); assert.match(ok.stdout, /meets the contract/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghc-'));
  try {
    const m = goodManifest(); m.find((t) => t.name === 'remove').annotations.destructiveHint = false;
    fs.writeFileSync(path.join(tmp, 'm.json'), JSON.stringify(m));
    const bad = run(path.join(tmp, 'm.json'), good('good-transcript.json'));
    assert.equal(bad.status, 1); assert.match(bad.stdout, /manifest: Tool remove: it removes or ends, so destructiveHint must be true/); assert.match(bad.stdout, /1 problem\(s\)/);
    fs.writeFileSync(path.join(tmp, 'x.json'), '{not json');
    const un = run(path.join(tmp, 'x.json'));
    assert.equal(un.status, 2); assert.match(un.stdout, /unreadable input/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
