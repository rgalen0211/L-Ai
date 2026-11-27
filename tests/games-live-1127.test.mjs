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
  assert.match(src, /s\.pid = seat && seat\.code === s\.code && seat\.name\.toLowerCase\(\) === s\.name\.toLowerCase\(\) \? seat\.pid : newPid\(\);/);
  assert.equal((src.match(/await leave\(\); writeSeat\(null\); join\('You left the room\.'\)/g) || []).length, 2, 'both Leave buttons forget the seat');
  assert.match(src, /else if \(m\.t === 'state' && s\.welcomed\) onState\(m\);/, 'nothing from the room is shown before the host lets the phone in');
  // the stored value is checked before use
  const store = new Map(); const ss = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
  const W = load(['assets/game-phone-live.js'], { sessionStorage: ss });
  assert.equal(typeof W.ryagramGamePhoneLive.mount, 'function');
  const body = src.slice(src.indexOf('function readSeat'), src.indexOf('const writeSeat'));
  assert.match(body, /\/\^\[A-Z\]\{4\}\$\/\.test\(v\.code\)/); assert.match(body, /\/\^\[A-Za-z0-9\]\{8,32\}\$\/\.test\(v\.pid\)/); assert.match(body, /catch \{ return null; \}/);
});
