// GAMES 11-27 (Claude 08:10): the Games department LIVE behind the per-account switch `games`. The whole round in two browsers is walked by GAMES' page check
// (a host and two phones through the test relay); this file pins the wiring and the host's pure rules so a later edit cannot quietly undo them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const load = (files, extra = {}) => { const ctx = { window: {}, console, URLSearchParams, location: { hostname: 'uselai.com', search: '', hash: '', origin: 'https://uselai.com' }, crypto: globalThis.crypto, ...extra }; ctx.window = Object.assign(ctx.window, ctx); vm.createContext(ctx); for (const f of files) vm.runInContext(read(f), ctx, { filename: f }); return ctx.window; };

test('SWITCH: games is true (launch step 82b: on for everyone), with its undo in words', () => {
  const cfg = read('assets/ryagram-config.js');
  assert.match(cfg, /\r?\n  games: true,\r?\n/);
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
  assert.match(body, /\/\^\[A-Z\]\{[68]\}\$\/\.test\(v\.code\)|CODE_LEN/); assert.match(body, /\/\^\[A-Za-z0-9\]\{8,32\}\$\/\.test\(v\.pid\)/); assert.match(body, /catch \{ return null; \}/);          // the code test: 6 letters before the holds contract, 8 after (builder C)
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
  let fakeNow = 1e6;          // the host's clock: moved 5 s a round, so the per-pid guess buckets (FACES 3.1, 1 guess a second) never drop a real guess here
  const host = W.ryagramGamesHost.mount(mkEl('div'), { h, Room, Score: S, Rounds: R, cfg: {}, now: () => fakeNow });
  for (let i = 0; i < 50 && !onMsg; i++) await new Promise(r => setTimeout(r, 10));          // the host makes its key, then opens the room
  assert.ok(onMsg, 'the host listens to the room');
  const CODE = host.state().code; assert.equal(CODE, await G.codeOf(host.state().pair.pub), 'the room code is made from the host key'); assert.match(CODE, new RegExp(`^[A-Z]{${G.CODE_LEN}}$`));
  const phone = async () => { const pair = await G.keyPair(); const pid = await G.pidOf(pair.pub); let seq = 0;          // a join carries a new nonce when the room library has them (holds contract 1)
    return { pid, pair, msg: (m, extra = {}) => G.sign(pair, CODE, { ...m, pid, seq: ++seq, ...(m.t === 'join' && G.newNonce ? { nonce: G.newNonce() } : {}), ...extra }) }; };
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
    host.next(); await host.settled(); fakeNow += 5000;
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

test('OPENING ROOM: a room that never opens shows no code, Start or Try again; a room that fails shows Try again only, with the role set before the words and no "reload"', async () => {
  const mkEl = tag => ({ tag, kids: [], attrs: {}, log: [], setAttribute(k, v) { this.attrs[k] = v; this.log.push(`attr:${k}`); }, removeAttribute(k) { delete this.attrs[k]; }, addEventListener() {}, append(...k) { this.kids.push(...k); }, replaceChildren(...k) { this.kids = k; }, querySelector() { return null; }, focus() {}, set textContent(v) { this._t = v; this.log.push('text'); }, get textContent() { return this._t; } });
  const h = (tag, attrs, ...kids) => { const e = mkEl(tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false && !k.startsWith('on')) e.attrs[k] = v; e.kids = kids.flat(); return e; };
  const walk = e => (e && typeof e === 'object') ? [e, ...(e.kids || []).flatMap(walk)] : [];
  const run = async connect => {
    const W = load(['assets/app-games.js'], { location: { hostname: '127.0.0.1', search: '?relay=http://127.0.0.1:9', hash: '#/d/games', origin: 'http://127.0.0.1:1', reload() {} }, setInterval: () => 1, clearInterval() {}, addEventListener() {}, removeEventListener() {} });
    const root = mkEl('div');
    W.ryagramGamesHost.mount(root, { h, Room: { keyPair: async () => ({ pub: 'p' }), codeOf: async () => 'ABCDEF', connect }, Score: {}, Rounds: { rounds: [{}] }, cfg: {} });
    await new Promise(r => setTimeout(r, 0));
    const all = walk(root);
    return { ids: all.map(e => e.attrs && e.attrs.id).filter(Boolean), status: all.filter(e => e.attrs && e.attrs.role === 'alert' || e.log.includes('text')) };
  };
  const opening = await run(() => new Promise(() => {}));
  for (const id of ['gh-code', 'gh-start', 'gh-retry']) assert.ok(!opening.ids.includes(id), `${id} is not drawn while the room is still opening`);
  const failed = await run(() => Promise.reject(new Error('x')));
  assert.ok(failed.ids.includes('gh-retry'), 'a failed room offers Try again');
  for (const id of ['gh-code', 'gh-start']) assert.ok(!failed.ids.includes(id), `${id} is not drawn for a failed room`);
  const st = failed.status.find(e => e.attrs.role === 'alert');
  assert.ok(st, 'the failure is announced with role=alert');
  assert.ok(st.log.indexOf('attr:role') < st.log.lastIndexOf('text'), 'role=alert is set before the words so a screen reader announces them');
  assert.ok(!/reload/i.test(st.textContent), 'the words say Try again, not reload');
  assert.match(st.textContent, /try again/i, 'the failure words say Try again');
});

test('FAILED ROOM: the status line is an alert BEFORE its words are set, so a screen reader announces the failure (WEB 10:39)', () => {
  const src = read('assets/app-games.js');
  assert.match(src, /const failed = text => \{ status\.setAttribute\('role', 'alert'\); status\.textContent = text;/);
});

// ===== ROOM SAFETY ON THE HOST (11-27 holds contract section 2; FACES-GAMES-ROOM-SAFETY-1127 sections 1, 3.2-3.3, 5; GAMES lead additions after RENDERER/GEO) =====
// The host is mounted on a STUB room library that implements the contract's API (showCode, newNonce, makeLimits with the FACES 3.1 numbers, nonce/why/closed formats)
// with fake, countable signatures, a fake clock and fake timers. So these tests do not wait for the real library and can count every signature check and every signed message.
// MUST FAIL: each scenario is also run on an in-memory copy of app-games.js with one check taken out, and the key it guards must turn false. All names are invented.
const HOST_SRC = 'assets/app-games.js';
const loadHost = (extra, edits = []) => {
  let src = read(HOST_SRC).replace(/\r\n/g, '\n');
  for (const [from, to] of edits) { assert.ok(src.includes(from), `mutant text is in ${HOST_SRC}: ${from}`); src = src.split(from).join(to); }
  const ctx = { console, URLSearchParams, location: { hostname: '127.0.0.1', search: '?relay=http://127.0.0.1:9', hash: '#/d/games', origin: 'http://127.0.0.1:1' }, addEventListener() {}, removeEventListener() {}, ...extra };
  ctx.window = ctx; vm.createContext(ctx);
  for (const f of ['assets/game-score.js', 'assets/game-rounds.js']) vm.runInContext(read(f), ctx, { filename: f });
  vm.runInContext(src, ctx, { filename: HOST_SRC });
  return ctx;
};
let focused = null;
class Node1 {
  constructor(tag) { this.tagName = tag; this.nodeType = 1; this.children = []; this.attrs = {}; this.listeners = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  addEventListener(t, cb) { (this.listeners[t] = this.listeners[t] || []).push(cb); }
  append(...k) { this.children.push(...k.map(c => (c && c.nodeType ? c : { nodeType: 3, textContent: String(c) }))); }
  replaceChildren(...k) { this.children = []; this.append(...k.filter(c => c != null)); }
  removeChild(c) { this.children = this.children.filter(x => x !== c); return c; }
  set textContent(v) { this.children = [{ nodeType: 3, textContent: String(v) }]; }
  get textContent() { return this.children.map(c => c.textContent).join(''); }
  all(pred, out = []) { for (const c of this.children) if (c.nodeType === 1) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
  querySelector(sel) { const pred = sel.startsWith('#') ? (e => e.id === sel.slice(1)) : sel.startsWith('.') ? (e => (e.attrs.class || '').split(' ').includes(sel.slice(1))) : (e => e.tagName === sel); return this.all(pred)[0] || null; }
  focus() { focused = this; }
}
const hh = (tag, attrs, ...kids) => { const e = new Node1(tag); for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? '' : v); } e.append(...kids.flat().filter(c => c != null)); return e; };
const click = el => { assert.ok(el, 'the button is there'); for (const cb of el.listeners.click || []) cb({}); };
const keydown = (el, key) => { for (const cb of el.listeners.keydown || []) cb({ key, preventDefault() {} }); };
const buttonNamed = (root, text) => root.all(e => e.tagName === 'button' && e.textContent === text)[0] || null;

function fakeTime() {
  let t = 0, id = 0; const q = [];
  const add = (fn, ms, every) => { q.push({ id: ++id, at: t + Math.max(0, ms), fn, every }); return id; };
  const drop = i => { const k = q.findIndex(x => x.id === i); if (k >= 0) q.splice(k, 1); };
  return { now: () => t, timers: { setTimeout: (fn, ms) => add(fn, ms, 0), clearTimeout: drop, setInterval: (fn, ms) => add(fn, ms, ms), clearInterval: drop },
    advance(ms) { const end = t + ms; for (;;) { q.sort((a, b) => a.at - b.at); const x = q[0]; if (!x || x.at > end) break; t = x.at; if (x.every) x.at += x.every; else q.shift(); x.fn(); } t = end; },
    pending: () => q.length };
}
function stubRoom(clockNow) {
  const calls = { verify: 0 }; let keys = 0, nonces = 0;
  const NONCE = /^[A-Za-z0-9_-]{22}$/, LET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const body = (code, m) => { const { sig, ...rest } = m; return code + '|' + JSON.stringify(Object.keys(rest).sort().map(k => [k, rest[k]])); };
  const fits = m => {
    if (!m || typeof m !== 'object') return false;
    if (m.t === 'join') return typeof m.pid === 'string' && typeof m.name === 'string' && NONCE.test(m.nonce || '');
    if (m.t === 'welcome') return NONCE.test(m.nonce || '') && typeof m.ok === 'boolean' && (m.why === undefined || (m.ok === false && ['removed', 'full', 'locked', 'started', 'name', 'closed'].includes(m.why)));
    if (m.t === 'state') return ['lobby', 'question', 'reveal', 'final', 'closed'].includes(m.phase) && Array.isArray(m.players) && (m.why === undefined || (m.phase === 'closed' && ['idle', 'host', 'newcode'].includes(m.why)));
    return ['guess', 'leave', 'got'].includes(m.t);
  };
  const bucket = (cap, n, ms) => { let tokens = cap, last = clockNow(); return () => { const t = clockNow(); if (t > last) { tokens = Math.min(cap, tokens + (t - last) * n / ms); last = t; } if (tokens >= 1) { tokens -= 1; return true; } return false; }; };
  const perPid = (cap, n, ms) => { const m = new Map(); return p => { if (!m.has(p)) m.set(p, bucket(cap, n, ms)); return m.get(p)(); }; };
  const conns = [];
  const Room = {
    CODE_LEN: 8,
    keyPair: async () => { keys += 1; const pub = 'K' + String(keys).padStart(86, '0'); return { pub, key: pub }; },
    pidOf: async pub => 'pid' + pub.slice(-12),
    codeOf: async pub => { const n = Number(pub.slice(1)); return LET[n % 24] + LET[(n * 7) % 24] + 'CDEFGH'; },
    showCode: c => c.slice(0, 4) + ' ' + c.slice(4),
    newNonce: () => ('n' + (++nonces)).padStart(22, 'x'),
    sign: async (pair, code, m) => { if (!fits(m)) throw new Error('That message is not one the game sends, so it was not signed.'); return { ...m, sig: pair.pub + '#' + body(code, m) }; },
    verify: async (pub, code, m) => { calls.verify += 1; return m.sig === pub + '#' + body(code, m); },
    makeLimits: () => ({ room: bucket(60, 30, 1000), pid: perPid(6, 3, 1000), guess: perPid(3, 1, 1000), newPid: bucket(6, 6, 60000), verify: bucket(20, 20, 1000), refusal: bucket(1, 1, 2000) }),
    validate: m => (fits(m) ? JSON.parse(JSON.stringify(m)) : null),
    connect: async o => { const c = { o, sent: [], cbs: new Set(), closed: false, async send(m) { if (c.closed) throw new Error('closed'); c.sent.push(JSON.parse(JSON.stringify(m))); }, onMessage(cb) { c.cbs.add(cb); return () => c.cbs.delete(cb); }, close() { c.closed = true; } }; conns.push(c); return c; },
  };
  return { Room, calls, conns };
}
const flush = async () => { for (let i = 0; i < 30; i++) await new Promise(r => setImmediate(r)); };
async function bench(o = {}) {
  const ft = fakeTime(); ft.advance(1e6);
  const { Room, calls, conns } = stubRoom(ft.now);
  const W = loadHost(o.names ? { ryagramGameNames: o.names } : {}, o.edits);
  const root = new Node1('div');
  const host = W.ryagramGamesHost.mount(root, { h: hh, Room, Score: W.ryagramGameScore, Rounds: W.ryagramGameRounds, cfg: {}, now: ft.now, timers: ft.timers, IDLE_MS: o.idle, WARN_MS: o.warn, seconds: o.seconds });
  await flush();
  const conn = () => conns[conns.length - 1];
  const b = { ft, Room, calls, conns, conn, root, host, W,
    code: () => host.state().code, hostPub: () => host.state().pair.pub,
    async deliver(m) { const v = Room.validate(m); if (v) for (const cb of [...conn().cbs]) cb(v); await host.settled(); await flush(); },
    sent: t => conn().sent.filter(m => !t || m.t === t),
    welcomes: pid => conn().sent.filter(m => m.t === 'welcome' && m.pid === pid),
    async phone(name) { const pair = await Room.keyPair(), pid = await Room.pidOf(pair.pub); let seq = 0;
      const p = { name, pair, pid, last: null, nonce: null,
        signed: async (m, extra = {}) => (p.last = await Room.sign(pair, b.code(), { ...m, pid, seq: ++seq, ...extra })),
        send: async (m, extra) => b.deliver(await p.signed(m, extra)),
        join: async (extra = {}) => { p.nonce = Room.newNonce(); return p.send({ t: 'join', name, pub: pair.pub, nonce: p.nonce }, extra); } };
      return p; },
    async seat(names) { const out = []; for (const [i, n] of names.entries()) { if (i && i % 6 === 0) ft.advance(61000); const p = await b.phone(n); await p.join(); out.push(p); } return out; },
  };
  return b;
}
const ok = async (b, m) => !!m && await b.Room.verify(b.hostPub(), b.code(), m);

async function wordsScenario(o = {}) {
  const b = await bench(o), out = {}, t = sel => (b.root.querySelector(sel) || { textContent: '' }).textContent;
  try {
    out.codeShown = /^[A-Z]{4} [A-Z]{4}$/.test(t('#gh-code')) && t('#gh-code').replace(' ', '') === b.code() && t('#gh-status') === `Room ${t('#gh-code')} is open.`;
    out.statement = t('#gh-statement').startsWith('The room code is the only lock on this game. Anyone who has the code can join, see the names and the questions, and see what players type. Do not post it or share it with people you do not want in the game. If someone you do not know joins, press Remove, then Lock the room.')
      && t('#gh-statement').includes('A room is a public channel: it is not stranger-proof.');
    out.help = t('#gh-help') === 'If someone keeps coming back, lock the room or start a new room code. Remove is a courtesy, not a ban: someone removed can come back from a new browser. Lock the room or start a new room code to keep them out.';
    out.seatsEmpty = t('#gh-seats') === 'Seats: 0 of 8 taken' && b.root.querySelector('#gh-seats').attrs.role === 'status';
    const lockBtn = b.root.querySelector('#gh-lock');
    out.openWords = lockBtn.textContent === 'Lock the room' && t('#gh-lock-note') === 'Open: anyone with the code can join.';
    click(lockBtn);
    out.lockWords = b.root.querySelector('#gh-lock') === lockBtn && lockBtn.textContent === 'Unlock the room' && t('#gh-lock-note') === 'Locked: nobody new can join. Players already in can still rejoin.' && b.host.state().locked === true;
    click(lockBtn);
    await b.seat(['Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal']);
    out.seatsFull = t('#gh-seats') === 'Seats: 8 of 8 taken. The room is full.' && b.root.querySelector('#gh-player-list').children.length === 8;
    out.removeLabel = b.root.querySelector('#gh-player-list').children[0].querySelector('button').attrs['aria-label'] === 'Remove Ana';
    out.newCodeInLobby = !!b.root.querySelector('#gh-newcode');
    click(b.root.querySelector('#gh-start')); await b.host.settled();
    out.autoLock = b.host.state().locked === true && t('#gh-auto-lock') === 'The room locked when the game started.' && !b.root.querySelector('#gh-lock') && !b.root.querySelector('#gh-newcode')
      && !!b.root.querySelector('#gh-player-list') && /Seats: 8 of 8/.test(t('#gh-seats'));
  } catch (e) { out.crashed = String(e.stack).slice(0, 300); }
  b.host.close();
  return out;
}
test('ROOM SAFETY: the code in two groups of 4, the FACES 5 statement and the public-channel line beside it, Seats, Lock/Unlock words, the honesty help line, and the room locks itself at the start', async () => {
  assert.deepEqual(await wordsScenario(), { codeShown: true, statement: true, help: true, seatsEmpty: true, openWords: true, lockWords: true, seatsFull: true, removeLabel: true, newCodeInLobby: true, autoLock: true });
});

async function keyboardScenario(o = {}) {
  const b = await bench(o), out = {}, t = sel => (b.root.querySelector(sel) || { textContent: '' }).textContent;
  try {
    const [A, B, C] = await b.seat(['Ana', 'Ben', 'Cy']);
    const list = b.root.querySelector('#gh-player-list'), rowOf = i => list.children[i];
    const removeA = rowOf(0).querySelector('.gh-remove');
    click(removeA);
    out.confirmInRow = /Remove Ana from the game\?/.test(rowOf(0).textContent) && !!buttonNamed(rowOf(0), 'Yes, remove Ana') && !!buttonNamed(rowOf(0), 'Keep Ana') && focused === buttonNamed(rowOf(0), 'Yes, remove Ana');
    keydown(rowOf(0).querySelector('.gh-confirm'), 'Escape');
    out.escapeKeeps = focused === removeA && !!b.host.state().players.find(p => p.pid === A.pid) && !/from the game\?/.test(rowOf(0).textContent);
    click(removeA); click(buttonNamed(rowOf(0), 'Keep Ana'));
    out.keepKeeps = focused === removeA && b.host.state().players.length === 3;
    click(removeA); click(buttonNamed(rowOf(0), 'Yes, remove Ana')); await b.host.settled(); await flush();
    out.removedFocusNext = focused === list.children[0].querySelector('.gh-remove') && /Ben/.test(list.children[0].textContent) && t('#gh-live') === 'Ana was removed.' && t('#gh-seats') === 'Seats: 2 of 8 taken';
    const told = b.welcomes(A.pid).pop();
    out.removalSigned = !!told && told.ok === false && told.why === 'removed' && told.problem === 'The host removed you from this game.' && told.nonce === A.nonce && await ok(b, told);
    const allowBtn = b.root.querySelector('#gh-removed').querySelector('button');
    out.undoLine = /Removed: Ana\./.test(t('#gh-removed')) && allowBtn.attrs['aria-label'] === 'Allow Ana again' && allowBtn.textContent === 'Allow again';
    for (const P of [B, C]) { const r = list.children[0]; click(r.querySelector('.gh-remove')); click(buttonNamed(r, `Yes, remove ${P.name}`)); await b.host.settled(); }
    out.lastGoesToLock = focused === b.root.querySelector('#gh-lock') && list.children.length === 0;
  } catch (e) { out.crashed = String(e.stack).slice(0, 300); }
  b.host.close();
  return out;
}
test('MUST FAIL: Remove asks in its own row (focus on Yes), Escape and Keep put focus back on Remove, Yes removes with a signed welcome why removed carrying the seating nonce, focus goes to the next Remove, then Lock', async () => {
  assert.deepEqual(await keyboardScenario(), { confirmInRow: true, escapeKeeps: true, keepKeeps: true, removedFocusNext: true, removalSigned: true, undoLine: true, lastGoesToLock: true });
});

async function bannedScenario(o = {}) {
  const b = await bench(o), out = {};
  try {
    const [A] = await b.seat(['Ana', 'Ben']);
    const seatingJoin = A.last;
    b.host.kick(A.pid); await b.host.settled();
    const v0 = b.calls.verify, w0 = b.welcomes(A.pid).length;
    for (let i = 0; i < 100; i++) { b.ft.advance(1000); await A.join(); await A.send({ t: 'leave' }); }
    await b.deliver(seatingJoin);          // the old join that seated Ana, played again
    out.bannedCostsNoVerify = b.calls.verify === v0;
    out.bannedGetsNoAnswer = b.welcomes(A.pid).length === w0 && !b.host.state().players.find(p => p.pid === A.pid);
    const X = await b.phone('ANA'); await X.join();
    const wx = b.welcomes(X.pid).pop();
    out.removedNameRefused = !!wx && wx.ok === false && wx.why === 'name' && wx.problem === 'Please pick a different name.' && wx.nonce === X.nonce && !b.host.state().players.find(p => p.pid === X.pid);
    b.ft.advance(11000);
    b.host.allow(A.pid);
    await A.join();
    const back = b.welcomes(A.pid).pop();
    out.allowAgainLetsIn = back.ok === true && back.nonce === A.nonce && !!b.host.state().players.find(p => p.pid === A.pid);
  } catch (e) { out.crashed = String(e.stack).slice(0, 300); }
  b.host.close();
  return out;
}
test('MUST FAIL: a removed pid costs no signature check and gets no answer (200 messages and its replayed seating join), its name is refused in this lobby, and Allow again lets the same key back in', async () => {
  assert.deepEqual(await bannedScenario(), { bannedCostsNoVerify: true, bannedGetsNoAnswer: true, removedNameRefused: true, allowAgainLetsIn: true });
});

async function floodScenario2(o = {}) {
  const b = await bench(o), out = {};
  try {
    await b.seat(['Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal']);
    b.ft.advance(61000);
    const v0 = b.calls.verify, n0 = b.sent('welcome').length, t0 = b.ft.now();
    for (let i = 0; i < 1000; i++) { const F = await b.phone('Fake' + i); await F.join(); b.ft.advance(1); }
    const refusals = b.sent('welcome').slice(n0);
    out.floodCostsNoVerify = b.calls.verify === v0;
    out.refusalsRateLimited = refusals.length >= 1 && refusals.length <= Math.floor((b.ft.now() - t0) / 2000) + 1;
    out.refusalsSaidFull = refusals.every(m => m.ok === false && m.why === 'full' && /^Room is full\. All 8 seats are taken\./.test(m.problem));
    const notice = b.root.querySelector('#gh-strikes');
    out.strikesNotice = !notice.hasAttribute('hidden') && /^Lots of tries to join this room\. Lock the room\?/.test(notice.textContent);
    click(buttonNamed(notice, 'Lock the room'));
    out.strikesLock = b.host.state().locked === true && notice.hasAttribute('hidden');
  } catch (e) { out.crashed = String(e.stack).slice(0, 300); }
  b.host.close();
  return out;
}
test('MUST FAIL: 1000 fresh-key joins into a full room cost no signature check and get at most one signed refusal per 2 s (why full); the host is offered Lock the room, which works', async () => {
  assert.deepEqual(await floodScenario2(), { floodCostsNoVerify: true, refusalsRateLimited: true, refusalsSaidFull: true, strikesNotice: true, strikesLock: true });
});

// DRAIN (host builder 11-27): the pid a message claims is not proven until its signature is checked, so the per-pid and guess buckets run only AFTER a good signature.
// 500 forged guesses under Ana's pid (a bad signature) within 1 s, and one more right before hers, must not spend Ana's tokens: her own signed guess 0.15 s after the flood
// is taken (with the buckets before the signature it never can be: her per-pid bucket would need 2 tokens and holds under 1.45). The forged flood still costs at most the
// verify bucket (20 a second, so at most 20 + 20 checks in this second).
async function drainScenario(o = {}) {
  const b = await bench(o), out = {};
  try {
    const [A] = await b.seat(['Ana', 'Ben']);
    b.host.start(); await b.host.settled(); await flush();
    const real = await A.signed({ t: 'guess', round: 0, text: 'the real one' });          // signed now, delivered after the flood
    const v0 = b.calls.verify;
    for (let i = 0; i < 500; i++) { await b.deliver({ t: 'guess', pid: A.pid, round: 0, text: 'forged ' + i, seq: 1000 + i, sig: 'not-ana' }); b.ft.advance(2); }
    out.floodVerifiesCapped = b.calls.verify - v0 <= 40 && b.calls.verify - v0 >= 1;
    out.forgedNotTaken = !b.host.state().guesses.has(A.pid);
    b.ft.advance(150);          // the room (30/s) and verify (20/s) buckets have 4 and 3 tokens again; a per-pid bucket (3/s) could hold at most 1.45
    await b.deliver({ t: 'guess', pid: A.pid, round: 0, text: 'forged last', seq: 1600, sig: 'not-ana' });          // the forger keeps going: one more just before hers
    await b.deliver(real);
    out.realGuessTaken = b.host.state().guesses.get(A.pid) === 'the real one' && b.sent('got').some(m => m.pid === A.pid && m.round === 0);
  } catch (e) { out.crashed = String(e.stack).slice(0, 300); }
  b.host.close();
  return out;
}
test('MUST FAIL: 500 forged guesses under a seated player\'s pid (bad signature) in 1 s cost at most the verify bucket and do not drain her tokens: her real signed guess 0.15 s later (right after one more forgery) is taken', async () => {
  assert.deepEqual(await drainScenario(), { floodVerifiesCapped: true, forgedNotTaken: true, realGuessTaken: true });
});

async function lockedScenario(o = {}) {
  const b = await bench(o), out = {};
  try {
    const [A] = await b.seat(['Ana', 'Ben']);
    b.host.lock(true);
    const v0 = b.calls.verify, D = await b.phone('Dee'); await D.join();
    const wd = b.welcomes(D.pid).pop();
    out.lockedRefusedNoVerify = b.calls.verify === v0 && !!wd && wd.ok === false && wd.why === 'locked' && wd.problem === 'The room is locked. Ask the host to unlock it.' && wd.nonce === D.nonce && await ok(b, wd);
    await A.join();
    const wa = b.welcomes(A.pid).pop();
    out.knownRejoins = wa.ok === true && wa.nonce === A.nonce && wa.why === undefined;
    b.host.lock(false); b.ft.advance(3000);
    b.host.start(); await b.host.settled();
    b.ft.advance(3000);
    const v1 = b.calls.verify, E = await b.phone('Eve'); await E.join();
    const we = b.welcomes(E.pid).pop();
    out.startedRefusedNoVerify = b.calls.verify === v1 && !!we && we.why === 'started' && we.problem === 'This game has already started. Wait for the next one.';
  } catch (e) { out.crashed = String(e.stack).slice(0, 300); }
  b.host.close();
  return out;
}
test('MUST FAIL: a locked room refuses a new pid (why locked, signed, no signature check) while a seated player rejoins; after the start a new pid is refused why started, no check', async () => {
  assert.deepEqual(await lockedScenario(), { lockedRefusedNoVerify: true, knownRejoins: true, startedRefusedNoVerify: true });
});

async function nonceScenario(o = {}) {
  const b = await bench(o), out = {};
  try {
    const [A] = await b.seat(['Ana', 'Ben']);
    out.echoed = b.welcomes(A.pid)[0].nonce === A.nonce;
    const v0 = b.calls.verify, n0 = b.welcomes(A.pid).length;
    b.ft.advance(5000);
    await A.send({ t: 'join', name: 'Ana', pub: A.pair.pub, nonce: A.nonce });          // a new seq, signed, but a nonce already used
    out.reusedNonceDropped = b.calls.verify === v0 && b.welcomes(A.pid).length === n0;
    const bare = await A.signed({ t: 'join', name: 'Ana', pub: A.pair.pub, nonce: b.Room.newNonce() }); delete bare.nonce;
    await b.deliver(bare);                                                                 // no nonce: the room library refuses it before the host sees it
    out.noNonceDropped = b.welcomes(A.pid).length === n0;
    const X = await b.phone('Ana'); await X.join();
    const refusedNonce = X.nonce;
    out.refusedFirst = b.welcomes(X.pid).length === 1 && b.welcomes(X.pid)[0].ok === false && b.welcomes(X.pid)[0].nonce === refusedNonce;
    b.host.start(); await b.host.settled();
    for (let i = 0; i < 5; i++) { b.host.reveal(); b.host.next(); await b.host.settled(); }
    click(b.root.querySelector('#gh-again')); await b.host.settled();
    b.ft.advance(61000);
    const v1 = b.calls.verify;
    await X.send({ t: 'join', name: 'Xan', pub: X.pair.pub, nonce: refusedNonce });          // the refused join's nonce, after Play again
    out.ringAfterPlayAgain = b.host.state().phase === 'lobby' && b.calls.verify === v1 && b.welcomes(X.pid).length === 1;
    const seqs = b.sent().map(m => m.seq);
    out.seqUp = seqs.every((s, i) => !i || s > seqs[i - 1]);
  } catch (e) { out.crashed = String(e.stack).slice(0, 300); }
  b.host.close();
  return out;
}
test('MUST FAIL: the welcome echoes the join nonce; a join with a nonce already seen is dropped before any signature check (also after Play again); a join with no nonce is never seen; the host seq only goes up', async () => {
  assert.deepEqual(await nonceScenario(), { echoed: true, reusedNonceDropped: true, noNonceDropped: true, refusedFirst: true, ringAfterPlayAgain: true, seqUp: true });
});

async function idleScenario(o = {}) {
  const b = await bench({ idle: 1000, warn: 300, ...o }), out = {}, t = sel => (b.root.querySelector(sel) || { textContent: '' }).textContent;
  try {
    const [A] = await b.seat(['Ana']);
    b.ft.advance(699);
    out.noWarnYet = b.root.querySelector('#gh-idle').hasAttribute('hidden');
    b.ft.advance(2);
    const box = b.root.querySelector('#gh-idle');
    out.warned = !box.hasAttribute('hidden') && t('#gh-idle-text') === 'This room closes in 2 minutes because nothing has happened. Press Keep the room open to stay.' && !!buttonNamed(box, 'Keep the room open');
    const old = b.conn(), pub = b.hostPub(), code = b.code();
    b.ft.advance(300); await b.host.settled(); await flush();
    const last = old.sent[old.sent.length - 1];
    out.closedSent = !!last && last.t === 'state' && last.phase === 'closed' && last.why === 'idle' && last.players.length === 0 && await b.Room.verify(pub, code, last);
    out.timersStopped = b.ft.pending() === 0;
    out.leftTheRoom = old.closed === true && old.cbs.size === 0 && b.host.state().closed === true;
    out.closedWords = t('#gh-closed') === 'The room closed after 15 minutes with nothing happening. Open a new room to play again.' && !!buttonNamed(b.root, 'Open a new room') && b.root.querySelector('#gh-idle').hasAttribute('hidden');
    const n = old.sent.length, v = b.calls.verify, leave = await A.signed({ t: 'leave' });
    for (const cb of [...old.cbs]) cb(leave);
    await b.host.settled();
    out.nothingAfter = old.sent.length === n && b.calls.verify === v;
    click(buttonNamed(b.root, 'Open a new room')); await flush();
    out.reopened = b.conns.length === 2 && b.conn() !== old && b.host.state().closed === false && t('#gh-code').replace(' ', '') === b.code() && b.host.state().players.length === 0;
  } catch (e) { out.crashed = String(e.stack).slice(0, 300); }
  b.host.close();
  return out;
}
test('MUST FAIL: IDLE: the warning 2 minutes before, then one signed state closed why idle, every timer and the beat stopped, the room left, the words, nothing taken after, and Open a new room opens one', async () => {
  assert.deepEqual(await idleScenario(), { noWarnYet: true, warned: true, closedSent: true, timersStopped: true, leftTheRoom: true, closedWords: true, nothingAfter: true, reopened: true });
});

async function keepOpenScenario(o = {}) {
  const b = await bench({ idle: 1000, warn: 300, seconds: 45, ...o }), out = {};
  try {
    const [A] = await b.seat(['Ana']);
    b.ft.advance(750);
    click(buttonNamed(b.root.querySelector('#gh-idle'), 'Keep the room open'));
    out.warningGone = b.root.querySelector('#gh-idle').hasAttribute('hidden');
    b.ft.advance(500);
    out.stillOpenAfterKeep = b.host.state().closed === false;
    b.ft.advance(400); await A.send({ t: 'leave' }); await A.join();          // a player's messages also count
    b.ft.advance(900);
    out.messageCounts = b.host.state().closed === false;
    b.host.start(); b.ft.advance(30000);
    out.roundNeverIdles = b.host.state().closed === false && b.host.state().phase === 'question';
    b.ft.advance(15500);          // the round's own clock ends it at 45 s; the idle clock starts again at the reveal
    out.revealThenIdle = b.host.state().phase === 'reveal' && b.host.state().closed === false;
    b.ft.advance(1000); await b.host.settled();
    out.closedAfter = b.host.state().closed === true;
  } catch (e) { out.crashed = String(e.stack).slice(0, 300); }
  b.host.close();
  return out;
}
test('MUST FAIL: Keep the room open starts the 15 minutes again, so does a player\'s message; a running round never closes for idling; the idle clock starts again at its reveal', async () => {
  assert.deepEqual(await keepOpenScenario(), { warningGone: true, stillOpenAfterKeep: true, messageCounts: true, roundNeverIdles: true, revealThenIdle: true, closedAfter: true });
});

async function beatScenario(o = {}) {
  const b = await bench({ idle: 10 * 60000, ...o }), out = {};
  try {
    const states = () => b.sent('state').length;
    let n = states(); b.ft.advance(20000); await flush();
    out.emptyRoomSilent = states() === n;
    const [A, B] = await b.seat(['Ana', 'Ben']);
    await flush(); n = states(); b.ft.advance(20000); await flush();
    out.beatWithPlayers = states() - n >= 3;
    b.host.start(); b.host.reveal(); await b.host.settled();
    b.ft.advance(2000); await A.send({ t: 'leave' }); await B.send({ t: 'leave' });
    await flush(); n = states(); b.ft.advance(20000); await flush();
    out.goneDoNotKeepBeat = states() === n;
  } catch (e) { out.crashed = String(e.stack).slice(0, 300); }
  b.host.close();
  return out;
}
test('MUST FAIL: the 5 s beat runs only while at least one player is active: an empty room and a room whose players have all left send nothing', async () => {
  assert.deepEqual(await beatScenario(), { emptyRoomSilent: true, beatWithPlayers: true, goneDoNotKeepBeat: true });
});

async function newCodeScenario(o = {}) {
  const b = await bench(o), out = {};
  try {
    await b.seat(['Ana', 'Ben']);
    const old = b.conn(), oldCode = b.code(), oldPub = b.hostPub();
    click(b.root.querySelector('#gh-newcode')); await flush(); await b.host.settled(); await flush();
    const last = old.sent[old.sent.length - 1];
    out.oldTold = last.t === 'state' && last.phase === 'closed' && last.why === 'newcode' && await b.Room.verify(oldPub, oldCode, last) && old.closed === true && old.cbs.size === 0;
    out.newRoom = b.conn() !== old && b.code() !== oldCode && b.hostPub() !== oldPub && b.host.state().players.length === 0 && /Seats: 0 of 8/.test(b.root.querySelector('#gh-seats').textContent);
    const first = b.conn().sent[0];
    out.seqNeverRestarts = !!first && first.seq > last.seq;
    await b.seat(['Cy']);
    b.host.start();
    out.lobbyOnly = !b.root.querySelector('#gh-newcode');
  } catch (e) { out.crashed = String(e.stack).slice(0, 300); }
  b.host.close();
  return out;
}
test('New room code (lobby only): the old room gets one signed state closed why newcode and is left; a new key, a new code, empty seats; the seq carries on', async () => {
  assert.deepEqual(await newCodeScenario(), { oldTold: true, newRoom: true, seqNeverRestarts: true, lobbyOnly: true });
});

async function playRemoveScenario(o = {}) {
  const b = await bench(o), out = {};
  try {
    const [A, B, C] = await b.seat(['Ana', 'Ben', 'Cy']);
    b.host.start(); await b.host.settled();
    b.ft.advance(2000); await A.send({ t: 'guess', round: 0, text: 'over the hill' }); await C.send({ t: 'guess', round: 0, text: 'a guess from cy' });
    out.waiting = b.host.state().phase === 'question';
    b.host.kick(C.pid); await b.host.settled();
    out.cyGuessDropped = !b.host.state().guesses.has(C.pid);
    b.ft.advance(2000); await B.send({ t: 'guess', round: 0, text: 'under the hill' });
    const rev = b.sent('state').filter(m => m.phase === 'reveal').pop();
    out.revealedWithoutCy = b.host.state().phase === 'reveal' && !!rev && !rev.reveal.results.some(r => r.name === 'Cy');
    const told = b.welcomes(C.pid).pop();
    out.removalSigned = told.why === 'removed' && told.nonce === C.nonce && await ok(b, told);
    const v = b.calls.verify; await C.join();
    out.removedCannotRejoin = b.calls.verify === v && b.welcomes(C.pid).length === 2;
  } catch (e) { out.crashed = String(e.stack).slice(0, 300); }
  b.host.close();
  return out;
}
test('Remove during play: the removed player\'s guess is dropped, the round reveals when everyone left has guessed, the removal is signed, and the same key cannot rejoin', async () => {
  assert.deepEqual(await playRemoveScenario(), { waiting: true, cyGuessDropped: true, revealedWithoutCy: true, removalSigned: true, removedCannotRejoin: true });
});

test('NAMES: when assets/game-names.js is loaded the host asks it (with the names taken) and sends its words with why name; removed names compare with its nameKey', async () => {
  const asked = [];
  const names = { problem: (n, taken) => { asked.push([n, [...taken]]); return n === 'Zorbo' ? { why: 'name', words: 'Pick another name for the game.' } : null; }, nameKey: n => n.toLowerCase().replace(/[^a-z]/g, '') };
  const b = await bench({ names });
  const [A] = await b.seat(['Ana']);
  const Z = await b.phone('Zorbo'); await Z.join();
  const wz = b.welcomes(Z.pid).pop();
  assert.equal(wz.ok, false); assert.equal(wz.why, 'name'); assert.equal(wz.problem, 'Pick another name for the game.');
  assert.deepEqual(asked.pop(), ['Zorbo', ['Ana']]);
  b.host.kick(A.pid); await b.host.settled();
  const Y = await b.phone('A-na'); b.ft.advance(61000); await Y.join();
  assert.equal(b.welcomes(Y.pid).pop().problem, 'Please pick a different name.', 'nameKey says A-na is Ana');
  b.host.close();
});

const HOST_MUTANTS = [
  { name: 'banned pid checked only after the signature', edits: [['if (s.banned.has(m.pid)) return;                                // 2. a removed pid never costs a signature check again', '']], scenario: bannedScenario, caught: ['bannedCostsNoVerify'] },
  { name: 'unknown pid on a full room verified (no cheap refusal)', edits: [['if (why) { strike(); refuseUnknown(m, why); return; }', '']], scenario: floodScenario2, caught: ['floodCostsNoVerify'] },
  { name: 'per-pid buckets back before the signature (a forger drains a real player)', edits: [["if (!lim.pid(m.pid) || (m.t === 'guess' && !lim.guess(m.pid))) return;", ''],
    ['if (known && m.seq <= known.seq) return;', "if (!lim.pid(m.pid) || (m.t === 'guess' && !lim.guess(m.pid))) return; if (known && m.seq <= known.seq) return;"]], scenario: drainScenario, caught: ['realGuessTaken'] },
  { name: 'signed refusals not rate limited', edits: [['if (!lim.refusal()) return; ', '']], scenario: floodScenario2, caught: ['refusalsRateLimited'] },
  { name: 'no strikes notice', edits: [['if (s.strikes >= STRIKES) showStrikes();', '']], scenario: floodScenario2, caught: ['strikesNotice'] },
  { name: 'lock not checked before the signature', edits: [["s.locked ? 'locked' : ", '']], scenario: lockedScenario, caught: ['lockedRefusedNoVerify'] },
  { name: 'no auto-lock at the start', edits: [['s.lockedByHost = s.locked; s.locked = true;', 's.lockedByHost = s.locked;']], scenario: wordsScenario, caught: ['autoLock'] },
  { name: 'reused join nonce not dropped before the signature', edits: [["if (m.t === 'join' && m.nonce && s.nonceSeen.has(m.nonce)) return;          // a join nonce seen before: a replayed join", '']], scenario: nonceScenario, caught: ['reusedNonceDropped', 'ringAfterPlayAgain'] },
  { name: 'welcome without the join nonce', edits: [['const n = nonce || s.joinNonce || s.nonceOf.get(pid)', 'const n = s.nonceOf.get(pid)']], scenario: nonceScenario, caught: ['refusedFirst'] },
  { name: 'idle close sends no closed state', edits: [["post({ t: 'state', phase: 'closed', why,", "Promise.resolve({ t: 'state', phase: 'closed', why,"]], scenario: idleScenario, caught: ['closedSent'] },
  { name: 'idle close leaves the beat running', edits: [['stopTimer(); unevery(s.beat); s.beat = null;', 'stopTimer();']], scenario: idleScenario, caught: ['timersStopped'] },
  { name: 'idle close stays subscribed', edits: [['if (s.off) { try { s.off(); } catch { /* already gone */ } s.off = null; }', '']], scenario: idleScenario, caught: ['leftTheRoom'] },
  { name: 'Keep the room open does not reset the clock', edits: [['function keepOpen() { touch();', 'function keepOpen() {']], scenario: keepOpenScenario, caught: ['stillOpenAfterKeep'] },
  { name: 'a player message does not reset the clock', edits: [['      if (s.closed) return;\n      touch();\n', '      if (s.closed) return;\n']], scenario: keepOpenScenario, caught: ['messageCounts'] },
  { name: 'idle close during a running round', edits: [["if (s.closed || s.phase === 'question') return;\n      s.warnT", 'if (s.closed) return;\n      s.warnT'], ["if (s.closed || s.phase === 'question') return Promise.resolve();", 'if (s.closed) return Promise.resolve();']], scenario: keepOpenScenario, caught: ['roundNeverIdles'] },
  { name: 'gone players keep the beat alive', edits: [["s.phase !== 'question' && active().length) broadcast();", "s.phase !== 'question' && s.players.length) broadcast();"]], scenario: beatScenario, caught: ['goneDoNotKeepBeat'] },
  { name: 'Escape does not keep the player', edits: [["if (e && e.key === 'Escape')", 'if (false)']], scenario: keyboardScenario, caught: ['escapeKeeps'] },
  { name: 'focus not moved to Yes', edits: [['if (yes.focus) yes.focus();', '']], scenario: keyboardScenario, caught: ['confirmInRow'] },
  { name: 'removal welcome without the seating nonce', edits: [['seatNonce(m.pid, s.joinNonce);\n        welcome(', '\n        welcome(']], scenario: keyboardScenario, caught: ['removalSigned'] },
];
for (const mu of HOST_MUTANTS) {
  test(`MUST FAIL (mutant caught): host: ${mu.name}`, async () => {
    const out = await mu.scenario({ edits: mu.edits });
    for (const k of mu.caught) assert.equal(out[k], false, `${mu.name}: ${k} must turn false (got ${JSON.stringify(out)})`);
  });
}

test('plain ASCII in the host script, its stylesheet and this test (no invisible or typographic characters typed in; escapes only)', () => {
  for (const f of [HOST_SRC, 'tests/games-live-1127.test.mjs', 'assets/app-games.css']) assert.ok(!/[^\x00-\x7f]/.test(read(f)), f);
});

test('LAUNCH FLIP (step 82b): with the shipped config (games: true) the Games page is on for a signed-in person whose account list is empty, and off with the old account value', async () => {
  const cfgWin = {}; vm.runInNewContext(read('assets/ryagram-config.js'), { window: cfgWin });
  const sw = { ryagramConfig: cfgWin.ryagramConfig }; vm.runInNewContext(read('assets/app-switches.js'), { window: sw });
  assert.equal(cfgWin.ryagramConfig.games, true);
  await sw.ryagramSwitches.load({ mySwitches: async () => [] }, cfgWin.ryagramConfig);
  assert.equal(sw.ryagramSwitches.featureOn('games'), true, 'on with no list');
  sw.ryagramSwitches._reset();
  const old = { ...cfgWin.ryagramConfig, games: 'account' };
  await sw.ryagramSwitches.load({ mySwitches: async () => [] }, old);
  assert.equal(sw.ryagramSwitches.featureOn('games', old), false, "control: 'account' and an empty list is off");
});
