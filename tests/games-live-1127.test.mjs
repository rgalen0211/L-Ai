// GAMES 11-27 (Claude 08:10): the Games department LIVE behind the per-account switch `games`. The whole round in two browsers is walked by GAMES' page check
// (a host and two phones through the test relay); this file pins the wiring and the host's pure rules so a later edit cannot quietly undo them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const load = (files, extra = {}) => { const ctx = { window: {}, console, URLSearchParams, location: { hostname: 'uselai.com', search: '', hash: '', origin: 'https://uselai.com' }, crypto: globalThis.crypto, ...extra }; ctx.window = Object.assign(ctx.window, ctx); vm.createContext(ctx); for (const f of files) vm.runInContext(read(f), ctx, { filename: f }); return ctx.window; };

test('SWITCH: games is exactly \'account\' (on only for an account whose list names it), with its undo in words', () => {
  const cfg = read('assets/ryagram-config.js');
  assert.match(cfg, /\r?\n  games: 'account',\r?\n/);
  assert.match(cfg, /Undo: false/);
  assert.match(cfg, /gameTv: false,/); assert.match(cfg, /gamePhone: false,/);           // the old sample pages' switches are unchanged
});

test('APP: the four game scripts load before the departments script, the host script is version-pinned, and its stylesheet is linked', () => {
  const html = read('app/index.html');
  const at = n => html.indexOf(`src="/assets/${n}?v=`);
  for (const f of ['game-score.js', 'game-rounds.js', 'game-room.js', 'app-games.js']) assert.ok(at(f) > 0 && at(f) < at('app-departments.js'), `${f} before app-departments.js`);
  assert.ok(at('app-departments.js') < at('app-library.js'));
  assert.match(html, /href="\/assets\/app-games\.css\?v=/);
  const pins = JSON.parse(read('tests/asset-versions.json'));
  assert.ok(pins['app-games.js'], 'app-games.js is in the version record');
});

test('DEPARTMENTS: Games becomes a working page ONLY when featureOn(\'games\') and all four game scripts are loaded; otherwise it stays Coming soon', () => {
  const src = read('assets/app-departments.js');
  assert.match(src, /const gamesHostOn = \(\) => !!\(window\.ryagramGamesHost && window\.ryagramGamesHost\.on\(\) && window\.ryagramGameRoom && window\.ryagramGameScore && window\.ryagramGameRounds\);/);
  assert.match(src, /if \(id === 'games' && m\.working\.includes\(id\) && gamesHostOn\(\)\) return gamesPage\(\);/);
  assert.match(src, /if \(gamesHostOn\(\)\) \{ model\.soon = model\.soon\.filter\(x => x !== 'games'\);/);
  const host = read('assets/app-games.js');
  assert.match(host, /const on = \(\) => !!\(window\.ryagramSwitches && window\.ryagramSwitches\.featureOn\('games'\)\);/);
});

test('HOST RULES: names are unique ignoring case, a room holds 8, ranks share a tied place, and a round is scored with the engine port for every player (no guess = 0)', () => {
  const W = load(['assets/game-score.js', 'assets/game-rounds.js', 'assets/app-games.js']);
  const H = W.ryagramGamesHost, S = W.ryagramGameScore, R = W.ryagramGameRounds;
  const players = [{ pid: 'a1b2c3d4e5', name: 'Ana' }];
  assert.equal(H.nameProblem('ANA', players), 'Someone in this room already has that name. Add a letter or pick another.');
  assert.equal(H.nameProblem('Ben', players), null);
  assert.match(H.nameProblem('Zed', Array.from({ length: 8 }, (_, i) => ({ pid: `p${i}aaaaaaaa`, name: `P${i}` }))), /full \(8 players\)/);
  assert.equal(JSON.stringify(H.ranks([{ name: 'Ana', total: 10 }, { name: 'Ben', total: 30 }, { name: 'Cy', total: 10 }]).map(r => [r.name, r.place])), JSON.stringify([['Ben', 1], ['Ana', 2], ['Cy', 2]]));
  const round = R.rounds[0], answer = round.answer.map(w => w.word).join(' ');
  const res = H.scoreRound(S, round, [{ pid: 'p1aaaaaaaa', name: 'Ana' }, { pid: 'p2aaaaaaaa', name: 'Ben' }], new Map([['p1aaaaaaaa', answer]]));
  assert.equal(res[0].points, Math.round(round.base_points)); assert.equal(res[0].verdict, 'exact');
  assert.equal(res[1].points, 0); assert.equal(res[1].verdict, 'no guess'); assert.equal(res[1].text, '');
});

test('HOST: the test relay is used ONLY when the page is on this computer; on uselai.com the room is Supabase Realtime with a client that keeps no session', () => {
  let made = null;
  const W = load(['assets/app-games.js'], { location: { hostname: 'uselai.com', search: '?relay=http://127.0.0.1:9', hash: '', origin: 'https://uselai.com' }, supabase: { createClient: (u, k, o) => (made = { u, k, o }) } });
  const o = W.ryagramGamesHost.roomOptions({ supabaseUrl: 'https://x.supabase.co', supabaseKey: 'pk' }, 'ABCD');
  assert.equal(o.kind, 'realtime'); assert.equal(made.o.auth.persistSession, false);
  const L = load(['assets/app-games.js'], { location: { hostname: '127.0.0.1', search: '?relay=http://127.0.0.1:9', hash: '', origin: 'http://127.0.0.1:1' } });
  assert.equal(L.ryagramGamesHost.roomOptions({}, 'ABCD').kind, 'relay');
});

test('PHONE: live mode needs games on (true or \'account\'); the sample room is unchanged otherwise; the phone shows no answer before the host reveals it', () => {
  const P = load(['assets/game-phone-live.js']).ryagramGamePhoneLive;
  assert.equal(P.liveOn({ games: 'account' }), true); assert.equal(P.liveOn({ games: true }), true);
  for (const v of [false, 'true', 1, undefined]) assert.equal(P.liveOn({ games: v }), false);
  const phone = read('assets/game-phone.js');
  assert.match(phone, /const live = !!\(L && R && L\.liveOn\(window\.ryagramConfig\)\);/);
  const live = read('assets/game-phone-live.js');
  assert.ok(!/answer_text/.test(live.split('function reveal')[0]), 'no answer is read before the reveal screen');
});

test('REJOIN: the phone remembers its seat in THIS TAB only (sessionStorage), reuses its player id only for the same room and name, forgets it on Leave, and a bad stored value means a new seat', () => {
  const src = read('assets/game-phone-live.js');
  assert.match(src, /sessionStorage\.getItem\(SEAT_KEY\)/); assert.ok(!/localStorage/.test(src), 'never localStorage: the seat dies with the tab');
  assert.match(src, /const same = !!\(seat && seat\.code === s\.code && seat\.name\.toLowerCase\(\) === s\.name\.toLowerCase\(\)\);/);
  assert.match(src, /if \(same\) \{ try \{ const p = await Room\.keyPair\(seat\.jwk\); if \(\(await Room\.pidOf\(p\.pub\)\) === seat\.pid\) s\.pair = p; \} catch \{ s\.pair = null; \} \}/, 'the same seat reuses its key only when the pid is that key\'s');
  assert.match(src, /s\.pid = await Room\.pidOf\(s\.pair\.pub\);/, 'the pid is always made from the key');
  const leaves = (src.match(/'Leave the room'\)/g) || []).length, forget = (src.match(/await leave\(\); writeSeat\(null\); join\('You left the room\.'\)/g) || []).length;
  assert.ok(leaves >= 3, 'a phone can leave in the lobby, during a round and at the final'); assert.equal(forget, leaves, 'every Leave button forgets the seat');
  assert.match(src, /if \(m\.t === 'state' && s\.welcomed\) \{ if \(await fromHost\(m\)\) onState\(m\); \}/, 'nothing from the room is shown before the host lets the phone in, and then only what the pinned host key signed');
  assert.match(src, /else if \(m\.t === 'got' && m\.pid === s\.pid && s\.welcomed\) \{ if \(await fromHost\(m\)\) gotIt\(m\); \}/);
  // the stored value is checked before use
  const store = new Map(); const ss = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const W = load(['assets/game-phone-live.js'], { sessionStorage: ss });
  assert.equal(typeof W.ryagramGamePhoneLive.mount, 'function');
  const body = src.slice(src.indexOf('function readSeat'), src.indexOf('const writeSeat'));
  assert.match(body, /\/\^\[A-Z\]\{6\}\$\/\.test\(v\.code\)/); assert.match(body, /\/\^\[A-Za-z0-9\]\{8,32\}\$\/\.test\(v\.pid\)/); assert.match(body, /catch \{ return null; \}/);
});

test('NO ANSWER BEFORE THE REVEAL: across a whole game (host mounted on a fake room), no message before a reveal holds any of that round\'s answer, and every reveal holds it whole with the engine\'s points', async () => {
  const mkEl = tag => ({ tag, kids: [], attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {}, append(...k) { this.kids.push(...k); }, replaceChildren(...k) { this.kids = k; }, querySelector() { return null; }, focus() {} });
  const h = (tag, attrs, ...kids) => { const e = mkEl(tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false && !k.startsWith('on')) e.setAttribute(k, v); e.kids = kids.flat(); return e; };
  const W = load(['assets/game-room.js', 'assets/game-score.js', 'assets/game-rounds.js', 'assets/app-games.js'], { location: { hostname: '127.0.0.1', search: '?relay=http://127.0.0.1:9', hash: '#/d/games', origin: 'http://127.0.0.1:1' },
    setInterval: () => 1, clearInterval() {}, addEventListener() {}, removeEventListener() {}, TextEncoder });
  const sent = []; let onMsg = null;
  const G = W.ryagramGameRoom;                  // the real signing helper: the fake phones sign exactly as the real ones do
  const Room = { ...G, connect: async () => ({ send: async m => { sent.push(JSON.parse(JSON.stringify(m))); }, onMessage: cb => { onMsg = cb; return () => {}; }, close() {} }) };
  const R = W.ryagramGameRounds, S = W.ryagramGameScore;
  const host = W.ryagramGamesHost.mount(mkEl('div'), { h, Room, Score: S, Rounds: R, cfg: {} });
  for (let i = 0; i < 50 && !onMsg; i++) await new Promise(r => setTimeout(r, 10));          // the host makes its key, then opens the room
  assert.ok(onMsg, 'the host listens to the room');
  const CODE = host.state().code; assert.equal(CODE, await G.codeOf(host.state().pair.pub), 'the room code is made from the host key'); assert.match(CODE, /^[A-Z]{6}$/);
  const phone = async () => { const pair = await G.keyPair(); const pid = await G.pidOf(pair.pub); let seq = 0;
    return { pid, pair, msg: (m, extra = {}) => G.sign(pair, CODE, { ...m, pid, seq: ++seq, ...extra }) }; };
  const deliver = async m => { onMsg(G.validate(m)); await host.settled(); };          // as the room does: validated first
  const pa = await phone(), pb = await phone(), pc = await phone();
  await deliver(await pa.msg({ t: 'join', name: 'Ana', pub: pa.pair.pub })); await deliver(await pb.msg({ t: 'join', name: 'Ben', pub: pb.pair.pub }));
  await deliver(await pc.msg({ t: 'join', name: 'ANA', pub: pc.pair.pub }));
  assert.ok(sent.some(m => m.t === 'welcome' && m.pid === pc.pid && m.ok === false), 'a name differing only in case is refused');
  await deliver({ t: 'join', pid: 'dddddddd1', name: 'Dee' });
  assert.ok(!sent.some(m => m.pid === 'dddddddd1'), 'an unsigned join gets no answer at all');
  // every message the host sent is signed by the key its welcome carries, with a seq that only goes up
  const hostPub = sent.find(m => m.t === 'welcome').pub;
  for (const m of sent) assert.equal(await G.verify(hostPub, CODE, m), true, `host ${m.t} is signed`);
  for (let i = 1; i < sent.length; i++) assert.ok(sent[i].seq > sent[i - 1].seq, 'host seq goes up');
  host.start(); await host.settled();
  for (let i = 0; i < R.rounds.length; i++) {
    const words = R.rounds[i].answer.map(w => w.word.toLowerCase().replace(/[^a-z0-9']/g, '')).filter(w => w.length > 3 && !R.rounds[i].public.heard_text.toLowerCase().includes(w));
    const mark = sent.length;
    if (i === 0) {                                // Ben's key cannot speak for Ana: a guess with Ana's pid signed by Ben is dropped (no got, no score)
      await deliver(await G.sign(pb.pair, CODE, { t: 'guess', pid: pa.pid, round: 0, text: 'forged by ben', seq: 999 }));
      assert.ok(!sent.slice(mark).some(m => m.t === 'got'), 'no got for a forged guess');
    }
    await deliver(await pa.msg({ t: 'guess', round: i, text: R.rounds[i].answer.map(w => w.word).join(' ') }));
    assert.ok(sent.slice(mark).some(m => m.t === 'got' && m.pid === pa.pid && m.round === i), `round ${i + 1}: Ana's guess is acknowledged`);
    const pre = sent.slice(0, sent.length).filter(m => m.t === 'state' && m.phase === 'question' && m.round === i);
    assert.ok(pre.length >= 1, `round ${i + 1} was sent as a question`);
    for (const m of pre) for (const w of words) assert.ok(!JSON.stringify(m).toLowerCase().includes(w), `round ${i + 1}: '${w}' was sent before the reveal`);
    await deliver(await pb.msg({ t: 'guess', round: i, text: 'nothing like it' }));           // both in: the host reveals at once
    const rev = sent.slice(mark).find(m => m.t === 'state' && m.phase === 'reveal' && m.round === i);
    assert.ok(rev, `round ${i + 1} was revealed`);
    assert.equal(rev.reveal.answer_text, R.rounds[i].answer.map(w => w.word).join(' '));
    const ana = rev.reveal.results.find(r => r.name === 'Ana');
    assert.equal(ana.points, S.scoreGuess(R.rounds[i], R.rounds[i].answer.map(w => w.word).join(' ')).points);
    host.next(); await host.settled();
  }
  const fin = sent.filter(m => m.t === 'state' && m.phase === 'final').pop();
  assert.ok(fin, 'the final was sent');
  const sum = R.rounds.reduce((t, r) => t + S.scoreGuess(r, r.answer.map(w => w.word).join(' ')).points, 0);
  assert.equal(fin.totals.find(t => t.name === 'Ana').total, sum);
  for (const m of sent) assert.equal(await G.verify(hostPub, CODE, m), true, `host ${m.t} is signed`);
  host.close();
});

test('MODES: the room accepts mode line or gap only; the host offers Fill the gap only when its rounds are loaded, sends mode with every state, and a gap question shows the line with its gap (never the word)', async () => {
  const Room = load(['assets/game-room.js'], { TextEncoder }).ryagramGameRoom;
  const base = { t: 'state', phase: 'lobby', round: 0, of: 5, players: [] };
  assert.equal(Room.validate({ ...base, mode: 'gap' }).mode, 'gap'); assert.equal(Room.validate({ ...base, mode: 'line' }).mode, 'line');
  assert.equal(Room.validate({ ...base, mode: 'quiz' }), null); assert.equal(Room.validate(base).mode, undefined);
  const host = read('assets/app-games.js');
  assert.match(host, /gap: GapRounds \|\| \(typeof window !== 'undefined' && window\.ryagramGameGapRounds\) \|\| null/);
  assert.match(host, /MODE_ROUNDS\.gap \? h\('fieldset'/);
  assert.match(host, /const setMode = m => \{ if \(s\.phase !== 'lobby' \|\| !MODE_ROUNDS\[m\]\) return;/, 'the mode changes only in the lobby');
  assert.match(host, /heard_text: s\.mode === 'gap' \? r\.shown_text : r\.heard_text/);
  const html = read('app/index.html'); assert.ok(html.indexOf('/assets/game-gap-rounds.js?v=') > 0 && html.indexOf('/assets/game-gap-rounds.js?v=') < html.indexOf('/assets/app-games.js?v='));
  const W = load(['assets/game-gap-rounds.js']);
  for (const r of W.ryagramGameGapRounds.rounds) assert.ok(!r.public.shown_text.toLowerCase().split(/[^a-z']+/).includes(r.answer[0].norm), 'the shown line never holds the word');
});
