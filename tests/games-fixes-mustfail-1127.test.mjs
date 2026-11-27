// GEO 11-27 (Claude 12:57): MUST-FAIL tests for the three Games launch fixes on games-on-push1-flip-1127 (584da583):
//   (a) a refused join is answered only after its signature check, and only then are its nonce and seq recorded; an unverified message records nothing;
//   (b) the player cap: 8 seats on the host (the room library says the same), a ninth phone at the same instant as eight is refused, the eight are seated;
//   (c) the beat and the idle close: the room closes after the REAL 15 minutes (no test override), and after the close nothing at all is sent on any connection.
// GEO planted reverts of each fix in a separate copy (D:/Ryagram-scratch/GEO/review-games/mf); the ones the older files did not catch get a scenario here.
// The host is mounted on the same STUB room as tests/games-live-1127.test.mjs (fake signatures that are counted, a fake clock and fake timers).
// MUST FAIL: each mutant below is applied to an in-memory copy of the host script only. Its target text must be there EXACTLY once, and its scenario must turn the
// named key false. All names are invented. Nothing is written to disk and nothing leaves this computer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const count = (s, f) => s.split(f).length - 1;

const HOST_SRC = 'assets/app-games.js';
const loadHost = (extra, edits = []) => {
  let src = read(HOST_SRC).replace(/\r\n/g, '\n');
  for (const [from, to] of edits) { assert.equal(count(src, from), 1, `mutant text is in ${HOST_SRC} exactly once: ${from}`); src = src.split(from).join(to); }
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
    makeLimits: () => ({ room: bucket(60, 30, 1000), pid: perPid(6, 3, 1000), guess: perPid(3, 1, 1000), newPid: bucket(16, 16, 60000), verify: bucket(20, 20, 1000), refusal: bucket(1, 1, 2000) }),
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
    async seat(names) { const out = []; for (const n of names) { const p = await b.phone(n); await p.join(); out.push(p); } return out; },          // no clock step: 8 phones at one instant fit the new-pid bucket (16)
  };
  return b;
}

// (c) the REAL idle time: no IDLE_MS or WARN_MS given, so the host's own 15 minutes and 2 minutes are what run. The older idle tests pass small numbers in, so a host
// that closed after 30 minutes (or never warned at 13) would still pass them.
async function realIdleScenario(o = {}) {
  const b = await bench(o), out = {};
  try {
    await b.seat(['Ana']);
    const old = b.conn(), MIN = 60000;
    b.ft.advance(13 * MIN - 5);
    out.noWarnBefore13 = b.root.querySelector('#gh-idle').hasAttribute('hidden');
    b.ft.advance(10);
    out.warnAt13 = !b.root.querySelector('#gh-idle').hasAttribute('hidden');
    b.ft.advance(2 * MIN - 15); await b.host.settled(); await flush();
    out.openBefore15 = b.host.state().closed === false;
    b.ft.advance(10); await b.host.settled(); await flush();
    const last = old.sent[old.sent.length - 1];
    out.closedAt15 = b.host.state().closed === true && !!last && last.t === 'state' && last.phase === 'closed' && last.why === 'idle';
    out.exported = b.W.ryagramGamesHost.IDLE_MS === 15 * MIN && b.W.ryagramGamesHost.WARN_MS === 2 * MIN;
  } catch (e) { out.crashed = String(e.stack).slice(0, 300); }
  b.host.close();
  return out;
}
test('MUST FAIL: the real idle time: no warning before 13 minutes, the warning at 13, still open just before 15, closed why idle at 15 (no test override)', async () => {
  assert.deepEqual(await realIdleScenario(), { noWarnBefore13: true, warnAt13: true, openBefore15: true, closedAt15: true, exported: true });
});

// (c) 0 messages after the close: the stub connection here does NOT refuse a send after close() (a real channel may still deliver one), so any message the host
// tries after its closed state is counted. Ten minutes of fake time with two seated players, then the counts on every connection must not move.
async function silentAfterCloseScenario(o = {}) {
  const b = await bench({ idle: 60000, warn: 10000, ...o }), out = {};
  try {
    for (const c of b.conns) c.send = async m => { c.sent.push(JSON.parse(JSON.stringify(m))); };
    await b.seat(['Ana', 'Ben']);
    const old = b.conn();
    b.ft.advance(60001); await b.host.settled(); await flush();
    const last = old.sent[old.sent.length - 1];
    out.closedIsLast = b.host.state().closed === true && !!last && last.phase === 'closed' && last.why === 'idle';
    const n = old.sent.length, conns = b.conns.length;
    b.ft.advance(10 * 60000); await b.host.settled(); await flush();
    out.zeroAfterClose = old.sent.length === n && b.conns.length === conns;
    out.noTimersLeft = b.ft.pending() === 0;
    out.connClosed = old.closed === true;
  } catch (e) { out.crashed = String(e.stack).slice(0, 300); }
  b.host.close();
  return out;
}
test('MUST FAIL: after the idle close the closed state is the last message: nothing more is sent on the old connection in 10 minutes, no timer is left, and the connection is closed', async () => {
  assert.deepEqual(await silentAfterCloseScenario(), { closedIsLast: true, zeroAfterClose: true, noTimersLeft: true, connClosed: true });
});

// (c) the beat only for ACTIVE players, checked straight after a single leave in the lobby (the older beat test reaches 'all gone' through a started game).
async function lobbyBeatScenario(o = {}) {
  const b = await bench({ idle: 10 * 60000, ...o }), out = {};
  try {
    const states = () => b.sent('state').length;
    const [A] = await b.seat(['Ana']);
    let n = states(); b.ft.advance(20000); await flush();
    out.beatsWithOne = states() - n >= 3;
    await A.send({ t: 'leave' }); await flush();
    out.leftIsGone = b.host.state().players.every(p => p.gone || p.pid !== A.pid);
    n = states(); b.ft.advance(30000); await flush();
    out.silentWhenAllGone = states() === n;
  } catch (e) { out.crashed = String(e.stack).slice(0, 300); }
  b.host.close();
  return out;
}
test('MUST FAIL: the 5 s beat in the lobby: it beats with one player, and once that player has left (gone, or dropped) it sends nothing for 30 s', async () => {
  assert.deepEqual(await lobbyBeatScenario(), { beatsWithOne: true, leftIsGone: true, silentWhenAllGone: true });
});

// (b) the cap: 8 phones at one instant (no clock step) are all seated; a ninth 6 s later (so the 5 s join window cannot be what stops it) gets one signed refusal
// why full with its own nonce, and no seat.
async function ninthScenario(o = {}) {
  const b = await bench(o), out = {};
  try {
    const eight = await b.seat(['Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal']);
    out.eightSeated = b.host.state().players.length === 8 && eight.every(P => b.welcomes(P.pid).some(m => m.ok === true));
    b.ft.advance(6000);          // past the room's own join window (8 joins in 5 s), so only the seat count can refuse the ninth
    const I = await b.phone('Ivy'); await I.join();
    const w = b.welcomes(I.pid);
    out.ninthRefusedFull = w.length === 1 && w[0].ok === false && w[0].why === 'full' && w[0].nonce === I.nonce;
    out.ninthNotSeated = b.host.state().players.length === 8 && !b.host.state().players.some(p => p.pid === I.pid);
    out.cap8 = b.W.ryagramGamesHost.MAX_PLAYERS === 8;
  } catch (e) { out.crashed = String(e.stack).slice(0, 300); }
  b.host.close();
  return out;
}
test('MUST FAIL: 8 phones at one instant are all seated; a ninth is refused why full (signed, its own nonce) and not seated', async () => {
  assert.deepEqual(await ninthScenario(), { eightSeated: true, ninthRefusedFull: true, ninthNotSeated: true, cap8: true });
});

// (b) one number: the room library and the host both say 8, read from the two files themselves (no stub).
test('one number, from the files: MAX_PLAYERS = 8 in assets/game-room.js and in assets/app-games.js, each written once', () => {
  const room = read('assets/game-room.js'), host = read(HOST_SRC);
  assert.equal(count(room, 'MAX_PLAYERS = 8;'), 1); assert.equal(count(room, 'MAX_PLAYERS = '), 1);
  assert.equal(count(host, 'const MAX_PLAYERS = 8, ROUND_SECONDS'), 1); assert.equal(count(host, 'MAX_PLAYERS = '), 1);
  assert.equal(count(room, 'newPid: Object.freeze({ cap: 16, n: 16, ms: 60000 })'), 1);
});

const MUTANTS = [
  { name: '(c) the idle close after 30 minutes', edits: [['const IDLE_MS = 15 * 60000, WARN_MS = 2 * 60000;', 'const IDLE_MS = 30 * 60000, WARN_MS = 2 * 60000;']], scenario: realIdleScenario, caught: ['warnAt13', 'closedAt15', 'exported'] },
  { name: '(c) the warning 5 minutes before', edits: [['const IDLE_MS = 15 * 60000, WARN_MS = 2 * 60000;', 'const IDLE_MS = 15 * 60000, WARN_MS = 5 * 60000;']], scenario: realIdleScenario, caught: ['noWarnBefore13', 'exported'] },
  { name: '(c) no idle close at all', edits: [['s.idleT = later(() => { idleClose(); }, idleMs);', 's.idleT = null;']], scenario: realIdleScenario, caught: ['closedAt15'] },
  { name: '(c) the idle close says why host', edits: [["const done = closeRoom('idle');", "const done = closeRoom('host');"]], scenario: realIdleScenario, caught: ['closedAt15'] },
  { name: '(c) keep sending after the close (beat left running, broadcast ignores closed)', edits: [['stopTimer(); unevery(s.beat); s.beat = null; unlater(s.warnT);', 'stopTimer(); unlater(s.warnT);'],
    ['const broadcast = () => { if (s.conn && !s.closed) post(', 'const broadcast = () => { if (s.conn) post('],
    ["if (!s.closed && s.phase !== 'question' && active().length) broadcast(); }, 5000);", "if (s.phase !== 'question' && active().length) broadcast(); }, 5000);"],
    ['      s.conn = null;\n      return last.then(', '      return last.then(']], scenario: silentAfterCloseScenario, caught: ['zeroAfterClose', 'noTimersLeft'] },
  { name: '(c) the beat not stopped at the close', edits: [['stopTimer(); unevery(s.beat); s.beat = null; unlater(s.warnT);', 'stopTimer(); unlater(s.warnT);']], scenario: silentAfterCloseScenario, caught: ['noTimersLeft'] },
  { name: '(c) the connection not closed', edits: [['return last.then(() => { if (conn) { try { conn.close(); } catch { /* already gone */ } } });', 'return last;']], scenario: silentAfterCloseScenario, caught: ['connClosed'] },
  { name: '(c) the beat always, players or not', edits: [["s.phase !== 'question' && active().length) broadcast();", "s.phase !== 'question') broadcast();"]], scenario: lobbyBeatScenario, caught: ['silentWhenAllGone'] },
  { name: '(b) 9 seats on the host', edits: [['const MAX_PLAYERS = 8, ROUND_SECONDS = 45;', 'const MAX_PLAYERS = 9, ROUND_SECONDS = 45;']], scenario: ninthScenario, caught: ['ninthRefusedFull', 'ninthNotSeated', 'cap8'] },
  { name: '(b) off by one: > instead of >= in both full checks', edits: [["s.players.length >= MAX_PLAYERS ? 'full' : ''", "s.players.length > MAX_PLAYERS ? 'full' : ''"], ['if (s.players.length >= MAX_PLAYERS) { welcome(m.pid, false, FULL_TEXT); return; }', 'if (s.players.length > MAX_PLAYERS) { welcome(m.pid, false, FULL_TEXT); return; }']], scenario: ninthScenario, caught: ['ninthRefusedFull'] },          // the name check's own cap still holds the seat count at 8
  { name: '(b) no full check at all (all three caps)', edits: [["s.players.length >= MAX_PLAYERS ? 'full' : ''", "''"], ['if (s.players.length >= MAX_PLAYERS) { welcome(m.pid, false, FULL_TEXT); return; }', ''],
    ['if (players.length >= MAX_PLAYERS) return `This room is full (${MAX_PLAYERS} players).`;', '']], scenario: ninthScenario, caught: ['ninthRefusedFull', 'ninthNotSeated'] },
  { name: '(b) the cheap full refusal and the seat check gone (the name check still caps)', edits: [["s.players.length >= MAX_PLAYERS ? 'full' : ''", "''"], ['if (s.players.length >= MAX_PLAYERS) { welcome(m.pid, false, FULL_TEXT); return; }', '']], scenario: ninthScenario, caught: ['ninthRefusedFull'] },
];
for (const mu of MUTANTS) {
  test(`MUST FAIL (mutant caught): ${mu.name}`, async () => {
    const out = await mu.scenario({ edits: mu.edits });
    for (const k of mu.caught) assert.equal(out[k], false, `${mu.name}: ${k} must turn false (got ${JSON.stringify(out)})`);
  });
}

test('plain ASCII in this test file (no invisible or typographic characters typed in)', () => {
  assert.ok(!/[^\x00-\x7f]/.test(read('tests/games-fixes-mustfail-1127.test.mjs')));
});
