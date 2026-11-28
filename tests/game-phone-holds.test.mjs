// GAMES 11-27 HOLDS, the PHONE side (contract section 3; FACES room safety 1.3, 3.4, 3.5, 4, 5): the 8-letter code, a new nonce per join attempt with one retry at 3 s,
// a welcome taken only when it echoes one of this phone's nonces AND is signed by the key the typed code names, the welcome's seq as the floor (older host messages dropped
// BEFORE any signature work), refusal words by why, removed mid-game, the closed room (idle / newcode / host) stopping every clock, and the names check.
// The phone (assets/game-phone-live.js) is mounted on a tiny fake page with a STUB room that follows the contract's API (CODE_LEN 8, newNonce, nonce and why on
// welcomes, phase 'closed'), so these tests do not wait for the new assets/game-room.js; the stub signs with HMAC and counts every verify. Timers run 20 times faster.
// MUST FAIL: each guarded check is taken out again in an in-memory copy of the phone script and its scenario must then see the bad message get through.
// All names and text here are invented. Nothing is written to disk and nothing leaves this computer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import nodeCrypto from 'node:crypto';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const PHONE = 'assets/game-phone-live.js';
const SCALE = 20;          // the phone's timers run 20 times faster: retry at 150 ms, give up at 300 ms
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(ok, ms = 2000) { const t0 = Date.now(); while (!ok()) { if (Date.now() - t0 > ms) return false; await sleep(3); } return true; }
const CODE = 'HQRMWKTP', TYPED = 'hqrm wktp';

// A tiny fake page: just what the phone script uses.
class El {
  constructor(tag) { this.tagName = String(tag).toLowerCase(); this.nodeType = 1; this.children = []; this.attrs = {}; this.listeners = {}; this.hidden = false; this.value = ''; this.disabled = false; this.className = '';
    this.classList = { toggle() {} }; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(t, cb) { (this.listeners[t] = this.listeners[t] || []).push(cb); }
  append(...k) { this.children.push(...k); }
  replaceChildren(...k) { this.children = k; }
  set textContent(v) { this.children = [{ nodeType: 3, textContent: String(v) }]; }
  get textContent() { return this.children.filter(Boolean).map(c => c.textContent).join(''); }
  all(pred, out = []) { for (const c of this.children) if (c && c.nodeType === 1) { if (pred(c)) out.push(c); c.all(pred, out); } return out; }
  querySelector(sel) { const pred = sel.startsWith('#') ? (e => e.id === sel.slice(1) || e.attrs.id === sel.slice(1)) : (e => e.tagName === sel); return this.all(pred)[0] || null; }
  focus() {}
}

// The STUB room (contract API). Keys are random strings with an HMAC secret; codeOf gives CODE only for the host's key.
function stubRoom() {
  const secrets = new Map(), codes = new Map(), listeners = new Set(), sent = [];
  const b64 = n => nodeCrypto.randomBytes(n).toString('base64url');
  const sorted = v => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;
  const canon = (code, m) => { const c = { ...m }; delete c.sig; return 'stub-sig-2\n' + code + '\n' + JSON.stringify(sorted(c)); };
  const mac = (secret, text) => nodeCrypto.createHmac('sha256', secret).update(text).digest('base64url');
  const R = {
    CODE_LEN: 8, verifies: 0, connects: 0, closed: 0, codes, sent,
    normCode: s => String(s ?? '').toUpperCase().replace(/[\s-]/g, ''),
    newNonce: () => b64(16),
    validate: m => (m && typeof m === 'object' && typeof m.t === 'string' ? JSON.parse(JSON.stringify(m)) : null),
    keyPair: async jwk => {
      if (jwk) { if (!secrets.has(jwk.x)) secrets.set(jwk.x, jwk.d); return { pub: jwk.x, jwk, key: jwk.d }; }
      const pub = 'B' + b64(64), d = b64(32); secrets.set(pub, d);
      return { pub, jwk: { kty: 'EC', crv: 'P-256', x: pub, d }, key: d };
    },
    pidOf: async pub => nodeCrypto.createHash('sha256').update(String(pub)).digest('hex').slice(0, 20),
    codeOf: async pub => codes.get(pub) || 'ZZZZZZZZ',
    sign: async (pair, code, msg) => ({ ...msg, sig: mac(pair.key, canon(code, msg)) }),
    verify: async (pub, code, m) => { R.verifies++; const sec = secrets.get(pub); return !!sec && typeof m.sig === 'string' && m.sig === mac(sec, canon(code, m)); },
    connect: async () => { R.connects++; return { send: async m => { sent.push(JSON.parse(JSON.stringify(m))); }, onMessage: cb => { listeners.add(cb); return () => listeners.delete(cb); }, close() { R.closed++; listeners.clear(); } }; },
    deliver: m => { for (const cb of [...listeners]) cb(R.validate(m)); },
    from: t => sent.filter(m => m.t === t),
  };
  return R;
}

// One browser world: game-phone.js and the (maybe mutated) live phone script in one context, a session store, fake intervals, faster timeouts.
function world({ edits = [], names = null, store = new Map() } = {}) {
  const intervals = new Map(), clock = { off: 0 }; let iid = 0;
  const ctx = { console, URLSearchParams, URL, Date: class extends Date { static now() { return Date.now() + clock.off; } }, crypto: globalThis.crypto,
    setTimeout: (fn, ms) => setTimeout(fn, Math.max(0, (ms || 0) / SCALE)), clearTimeout,
    setInterval: fn => { intervals.set(++iid, fn); return iid; }, clearInterval: id => { intervals.delete(id); },
    location: { hostname: '127.0.0.1', search: '?relay=http://127.0.0.1:9', hash: '', origin: 'http://127.0.0.1:1' },
    sessionStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { createElement: t => new El(t), createTextNode: t => ({ nodeType: 3, textContent: String(t) }), getElementById: () => null },
    addEventListener() {}, removeEventListener() {} };
  ctx.window = ctx;
  if (names) ctx.ryagramGameNames = names;
  vm.createContext(ctx);
  vm.runInContext(read('assets/game-phone.js'), ctx, { filename: 'game-phone.js' });
  let src = read(PHONE);
  for (const [from, to] of edits) { assert.ok(src.includes(from), `mutant text is in ${PHONE}: ${from}`); src = src.split(from).join(to); }
  vm.runInContext(src, ctx, { filename: PHONE });
  return { W: ctx, store, intervals, clock };
}

// A phone mounted on the stub room, and the real host's key (its code is CODE).
async function setup(opts = {}) {
  const w = world(opts), R = opts.R || stubRoom();
  const host = opts.host || await R.keyPair(); R.codes.set(host.pub, CODE);
  const Eve = await R.keyPair();          // another phone in the room, with her own key
  let hseq = opts.hseq || 0;
  const P = w.W.ryagramGamePhone, H = { ...P, codeProblem: v => P.codeProblem(v, R.CODE_LEN) };          // as assets/game-phone.js passes it in live mode
  const root = new El('div');
  const api = w.W.ryagramGamePhoneLive.mount(root, H, R, { games: 'account' });
  const t = {
    w, R, host, Eve, root, api, text: () => root.textContent, q: sel => root.querySelector(sel), tx: sel => { const e = root.querySelector(sel); return e ? e.textContent : null; },
    hostSigned: async m => R.sign(host, CODE, { ...m, seq: ++hseq }),
    hostSeqNow: () => hseq,
    seat: () => JSON.parse(w.store.get('ryagram-game-seat') || 'null'),
    submit: async form => { for (const cb of (form || root.querySelector('form')).listeners.submit || []) await cb({ preventDefault() {} }); },
    press: async b => { if (!b) throw new Error('no such button'); for (const cb of b.listeners.click || []) await cb({}); },
    button: re => root.all(e => e.tagName === 'button' && re.test(e.textContent))[0] || null,
    type: (code, name) => { root.querySelector('#ph-code').value = code; root.querySelector('#ph-name').value = name; },
  };
  return t;
}
// Type, press Join, wait for the join to be sent; the join finishes when `going` resolves.
async function startJoin(t, name = 'Ana', code = TYPED) {
  t.type(code, name);
  const before = t.R.from('join').length;
  const going = t.submit();
  await until(() => t.R.from('join').length > before);
  return { going, join: t.R.from('join')[before] };
}
async function joinOk(t, name = 'Ana') {
  const { going, join } = await startJoin(t, name);
  t.R.deliver(await t.hostSigned({ t: 'welcome', pid: join.pid, ok: true, name, nonce: join.nonce, pub: t.host.pub }));
  await going;
  return join;
}
const question = async (t, round = 0) => t.hostSigned({ t: 'state', phase: 'question', round, of: 3, players: ['Ana', 'Ben'], heard_text: 'down by the old', words_left: 2, left_s: 30 });

// SCENARIO 1: the join (code, statement, nonce, retry, replayed and wrong-key welcomes, the seq floor before verify).
async function joinScenario(w) {
  const out = {};
  const t = await setup(w);
  try {
    out.hint = t.tx('#ph-code-hint') === 'The 8 letters on the host' + "'" + 's screen.';
    out.roomForSpace = Number(t.q('#ph-code').attrs.maxlength) >= 9;
    out.statement = t.tx('#ph-statement') === 'The room code is the only lock on this game. A room is a public channel: anyone with the code can join. Do not type anything private. The host can remove players.';
    // genuine host states recorded BEFORE this phone's welcome (old seqs), kept to replay later
    const old = [await question(t), await t.hostSigned({ t: 'state', phase: 'lobby', round: 0, of: 3, players: ['Mallory'] })];
    const oldWelcome = await t.hostSigned({ t: 'welcome', pid: 'placeholder', ok: true, nonce: 'A'.repeat(22), pub: t.host.pub });
    const { going, join } = await startJoin(t);
    out.codeNormalised = join.t === 'join' && join.name === 'Ana' && t.R.verifies === 0;
    out.nonceSent = /^[A-Za-z0-9_-]{22}$/.test(join.nonce || '');
    // a recorded genuine welcome (the host's key, a good signature) for an old join: its nonce is not one this phone sent
    t.R.deliver(await t.R.sign(t.host, CODE, { t: 'welcome', pid: join.pid, ok: true, name: 'Mallory', nonce: oldWelcome.nonce, pub: t.host.pub, seq: t.hostSeqNow() + 50 }));
    await sleep(20);
    out.recordedWelcomeIgnored = !!t.q('#ph-code') && !/You are in room/.test(t.text());
    // Eve answers with the RIGHT nonce (she hears the join) but her own key: the code names the host's key, not hers
    t.R.deliver(await t.R.sign(t.Eve, CODE, { t: 'welcome', pid: join.pid, ok: false, why: 'removed', problem: 'removed', nonce: join.nonce, pub: t.Eve.pub, seq: 1e8 }));
    // ... or the host's key with her signature
    t.R.deliver(await t.R.sign(t.Eve, CODE, { t: 'welcome', pid: join.pid, ok: true, name: 'Mallory', nonce: join.nonce, pub: t.host.pub, seq: 1e8 + 1 }));
    await sleep(20);
    out.wrongKeyIgnored = !!t.q('#ph-code') && !t.q('#ph-removed') && !/Mallory/.test(t.text());
    // nobody real answered yet: the phone sends the join once more at 3 s, with a NEW nonce and a higher seq
    await until(() => t.R.from('join').length >= 2, 1000);
    const joins = t.R.from('join');
    out.retried = joins.length === 2 && joins[1].nonce !== joins[0].nonce && /^[A-Za-z0-9_-]{22}$/.test(joins[1].nonce || '') && joins[1].seq > joins[0].seq && joins[1].pid === joins[0].pid;
    // the host's real welcome, echoing the FIRST nonce (still one of this phone's, under 10 s old)
    t.R.deliver(await t.hostSigned({ t: 'welcome', pid: join.pid, ok: true, name: 'Ana', nonce: join.nonce, pub: t.host.pub }));
    await going;
    out.joined = /You are in room HQRMWKTP/.test(t.text()) && !!t.seat() && t.seat().hostSeq === t.hostSeqNow() && t.seat().code === CODE;
    // the floor: the recorded states (seq below the welcome's) are dropped BEFORE verify; a new one is verified once and shown
    const v0 = t.R.verifies;
    for (const m of old) t.R.deliver(m);
    await sleep(20);
    out.staleDroppedBeforeVerify = t.R.verifies === v0 && !t.q('#ph-guess') && !/Mallory/.test(t.text());
    t.R.deliver(await t.hostSigned({ t: 'state', phase: 'lobby', round: 0, of: 3, players: ['Ana', 'Ben'] }));
    await until(() => /Players: Ana, Ben/.test(t.text()), 300);
    out.freshStateShown = /Players: Ana, Ben/.test(t.text()) && t.R.verifies === v0 + 1;
    // a host message that is not from the pinned key: an unsigned got is dropped
    out.stillIn = !!t.q('#ph-lobby-players');
  } catch (e) { out.crashed = String(e && e.stack || e).slice(0, 300); }
  return out;
}

test('MUST FAIL: the join: 8-letter hint and statement, a 22-char nonce, one retry with a new nonce, a recorded welcome and a wrong-key welcome ignored, and the welcome seq floor drops older states before verify', async () => {
  assert.deepEqual(await joinScenario({}), { hint: true, roomForSpace: true, statement: true, codeNormalised: true, nonceSent: true, recordedWelcomeIgnored: true, wrongKeyIgnored: true,
    retried: true, joined: true, staleDroppedBeforeVerify: true, freshStateShown: true, stillIn: true });
});

// SCENARIO 2: refusals by why, and nobody answering.
async function refusalScenario(w) {
  const out = {};
  const refuse = async (why, problem, legacy) => {
    const t = await setup(w);
    const { going, join } = await startJoin(t);
    const m = { t: 'welcome', pid: join.pid, ok: false, problem, nonce: join.nonce, pub: t.host.pub };
    if (!legacy) m.why = why;
    t.R.deliver(await t.hostSigned(m)); await going;
    return t;
  };
  try {
    let t = await refuse('full', 'This room is full (8 players).');
    out.fullWords = t.tx('#ph-join-note') === 'Room is full. All 8 seats are taken. Ask the host to remove someone, or wait for the next game.' && !!t.button(/^Try again$/) && !!t.q('#ph-code');
    t = await refuse('locked', 'This room is locked.');
    out.lockedWords = t.tx('#ph-join-note') === 'The room is locked. Ask the host to unlock it.' && !!t.button(/^Join the room$/);
    t = await refuse('started', 'This game has already started. Wait for the next one.');
    out.startedWords = t.tx('#ph-join-note') === 'This game has already started. Wait for the next one.';
    t = await refuse('name', 'Please pick a different name.');
    out.nameOnField = t.tx('#ph-name-err') === 'Please pick a different name.' && t.tx('#ph-join-note') === '';
    t = await refuse('locked', 'This room is locked.', true);
    out.legacyLockedWords = t.tx('#ph-join-note') === 'The room is locked. Ask the host to unlock it.';
    t = await refuse('removed', 'removed');
    out.removedAtJoin = t.tx('#ph-removed') === 'The host removed you from this game.' && !!t.button(/^Back$/) && t.seat() === null && t.R.from('leave').length === 0;
    await t.press(t.button(/^Back$/));
    out.backToCode = !!t.q('#ph-code') && (t.q('#ph-code') || {}).value === '';
    // nobody answers: two joins (the retry), then the existing words
    t = await setup(w);
    t.type(TYPED, 'Ana'); await t.submit();
    out.noAnswer = t.tx('#ph-code-err') === 'No room with that code answered. Check the letters on the host' + "'" + 's screen.' && t.R.from('join').length === 2;
  } catch (e) { out.crashed = String(e && e.stack || e).slice(0, 300); }
  return out;
}

test('MUST FAIL: refusals say why in FACES\' words: full (Try again), locked, started, a name problem on the name field, removed (Back, no seat), an older host\'s words read the same, and no answer', async () => {
  assert.deepEqual(await refusalScenario({}), { fullWords: true, lockedWords: true, startedWords: true, nameOnField: true, legacyLockedWords: true, removedAtJoin: true, backToCode: true, noAnswer: true });
});

// SCENARIO 3: removed mid-game.
async function removedScenario(w) {
  const out = {};
  try {
    const t = await setup(w);
    const join = await joinOk(t);
    t.R.deliver(await question(t)); await until(() => !!t.q('#ph-guess'), 300);
    out.inRound = !!t.q('#ph-guess') && t.w.intervals.size === 2;          // the round clock and the silent-host watch
    // a removal signed by Eve, and a genuine one replayed with an old seq: nothing happens
    t.R.deliver(await t.R.sign(t.Eve, CODE, { t: 'welcome', pid: join.pid, ok: false, why: 'removed', problem: 'removed', nonce: join.nonce, pub: t.host.pub, seq: 1e8 }));
    t.R.deliver(await t.R.sign(t.host, CODE, { t: 'welcome', pid: join.pid, ok: false, why: 'removed', problem: 'removed', nonce: join.nonce, pub: t.host.pub, seq: 1 }));
    await sleep(20);
    out.forgedRemovalIgnored = !!t.q('#ph-guess') && !t.q('#ph-removed') && !!t.seat();
    // the host's own key and a new seq, but not the nonce of the join that seated this phone: dropped before verify
    const v0 = t.R.verifies;
    t.R.deliver(await t.hostSigned({ t: 'welcome', pid: join.pid, ok: false, why: 'removed', problem: 'removed', nonce: t.R.newNonce(), pub: t.host.pub }));
    // the seated nonce but an old seq (a replayed removal): dropped before verify
    t.R.deliver(await t.R.sign(t.host, CODE, { t: 'welcome', pid: join.pid, ok: false, why: 'removed', problem: 'removed', nonce: join.nonce, pub: t.host.pub, seq: 1 }));
    await sleep(20);
    out.wrongNonceRemovalIgnored = !!t.q('#ph-guess') && !t.q('#ph-removed') && t.R.verifies === v0;
    const leavesBefore = t.R.from('leave').length;
    t.R.deliver(await t.hostSigned({ t: 'welcome', pid: join.pid, ok: false, why: 'removed', problem: 'The host removed you from this game.', nonce: join.nonce, pub: t.host.pub }));
    await until(() => !!t.q('#ph-removed'), 300);
    out.removedShown = !!t.q('#ph-removed') && t.tx('#ph-removed') === 'The host removed you from this game.' && !!t.button(/^Back$/);
    out.seatCleared = t.seat() === null;
    out.timersStopped = t.w.intervals.size === 0 && t.R.closed >= 1 && t.R.from('leave').length === leavesBefore;
  } catch (e) { out.crashed = String(e && e.stack || e).slice(0, 300); }
  return out;
}

test('MUST FAIL: removed mid-game: a forged, replayed or wrong-nonce removal does nothing (the last two before verify); the host\'s signed removal shows FACES\' words with Back, clears the seat and stops the clocks', async () => {
  assert.deepEqual(await removedScenario({}), { inRound: true, forgedRemovalIgnored: true, wrongNonceRemovalIgnored: true, removedShown: true, seatCleared: true, timersStopped: true });
});

// SCENARIO 4: the closed room.
async function closedScenario(w) {
  const out = {};
  const closeWith = async why => {
    const t = await setup(w);
    await joinOk(t, 'Ana');
    t.R.deliver(await question(t)); await until(() => !!t.q('#ph-guess'), 300);
    const running = t.w.intervals.size;
    const sentBefore = t.R.sent.length;
    t.R.deliver(await t.hostSigned({ t: 'state', phase: 'closed', why, round: 0, of: 3, players: [] }));
    await until(() => !t.q('#ph-guess'), 300);
    return { t, running, quiet: t.R.sent.length === sentBefore };
  };
  try {
    let { t, running, quiet } = await closeWith('idle');
    out.idleWords = t.tx('#ph-closed') === 'The host' + "'" + 's room closed because nothing happened for 15 minutes. Ask the host for the new code.';
    out.idleStopsTimers = running === 2 && t.w.intervals.size === 0 && t.R.closed === 1 && quiet;
    out.idleSeatCleared = t.seat() === null;
    await t.press(t.button(/^Join a room$/));
    out.idleBackKeepsName = !!t.q('#ph-code') && (t.q('#ph-name') || {}).value === 'Ana';
    ({ t } = await closeWith('newcode'));
    out.newcode = t.tx('#ph-note') === 'The host started a new room. Type the new code.' && (t.q('#ph-code') || {}).value === '' && (t.q('#ph-name') || {}).value === 'Ana' && t.w.intervals.size === 0;
    ({ t } = await closeWith('host'));
    out.hostWords = t.tx('#ph-closed') === 'The host closed the room.' && t.w.intervals.size === 0;
  } catch (e) { out.crashed = String(e && e.stack || e).slice(0, 300); }
  return out;
}

test('MUST FAIL: a closed room: idle and host say FACES\' words, newcode goes back to the code screen keeping the name, and every clock and the silent-host watch stop with no message sent', async () => {
  assert.deepEqual(await closedScenario({}), { idleWords: true, idleStopsTimers: true, idleSeatCleared: true, idleBackKeepsName: true, newcode: true, hostWords: true });
});

// SCENARIO 4b: the silent host. The phone leaves the channel (no message sent), keeps its seat, and Join a room reconnects as the same player.
async function silentScenario(w) {
  const out = {};
  try {
    const t = await setup(w);
    const join = await joinOk(t, 'Ana');
    const sentBefore = t.R.sent.length;
    t.w.clock.off += 20000;          // nothing from the host for 20 s (SILENT_MS is 16 s)
    for (const fn of [...t.w.intervals.values()]) fn();
    out.notice = /stopped answering/.test(t.text()) && !!t.q('#ph-again');
    out.connectionClosed = t.R.closed === 1 && t.w.intervals.size === 0 && t.R.sent.length === sentBefore;
    out.seatKept = !!t.seat() && t.seat().pid === join.pid;
    await t.press(t.q('#ph-again'));
    out.rejoinOffered = !!t.q('#ph-rejoin') && (t.q('#ph-code') || {}).value === CODE;
    const { going, join: j2 } = await startJoin(t, 'Ana', CODE);
    t.R.deliver(await t.hostSigned({ t: 'welcome', pid: j2.pid, ok: true, name: 'Ana', nonce: j2.nonce, pub: t.host.pub })); await going;
    out.reconnected = t.R.connects === 2 && j2.pid === join.pid && /You are in room/.test(t.text());
  } catch (e) { out.crashed = String(e && e.stack || e).slice(0, 300); }
  return out;
}

test('MUST FAIL: the silent host: the notice shows, the phone closes its connection (an abandoned phone holds no channel) and keeps its seat; Join a room reconnects as the same player', async () => {
  assert.deepEqual(await silentScenario({}), { notice: true, connectionClosed: true, seatKept: true, rejoinOffered: true, reconnected: true });
});

// SCENARIO 5: the names check, the rejoin, and the Sending/Sent lines (kept behaviour).
async function keptScenario(w) {
  const out = {};
  try {
    const names = { problem: n => (/zorbo/i.test(n) ? { why: 'name', words: 'Please pick a different name.' } : null) };
    let t = await setup({ ...w, names });
    t.type(TYPED, 'Zorbo'); await t.submit();
    out.namesChecked = t.tx('#ph-name-err') === 'Please pick a different name.' && t.R.connects === 0 && t.R.sent.length === 0;
    t = await setup(w);
    const join = await joinOk(t, 'Ana');
    t.R.deliver(await question(t)); await until(() => !!t.q('#ph-guess'), 300);
    (t.q('#ph-guess') || {}).value = 'river bend';
    await t.submit(t.root.all(e => e.tagName === 'form')[0]);
    out.sending = /^Sending/.test(t.tx('#ph-sent'));
    t.R.deliver(await t.hostSigned({ t: 'got', pid: join.pid, round: 0 }));
    await until(() => /^Sent:/.test(t.tx('#ph-sent')), 300);
    out.sent = /^Sent: .river bend.\. You can change it until time is up\.$/.test(t.tx('#ph-sent'));
    // the page reloads: the same tab (same store) joins again as the same player, with a new nonce
    await t.api.leave();
    const t2 = await setup({ ...w, store: t.w.store, R: t.R, host: t.host, hseq: t.hostSeqNow() });
    const { going, join: j2 } = await startJoin(t2, 'ana');
    out.rejoinSamePid = j2.pid === join.pid && j2.nonce !== join.nonce && j2.seq > join.seq;
    t2.R.deliver(await t2.hostSigned({ t: 'welcome', pid: j2.pid, ok: true, name: 'Ana', nonce: j2.nonce, pub: t2.host.pub })); await going;
    out.rejoined = /You are in room HQRMWKTP/.test(t2.text());
    // an old 6-letter seat reads as no seat
    const store = new Map([['ryagram-game-seat', JSON.stringify({ ...t2.seat(), code: 'HQRMWK' })]]);
    const t3 = await setup({ ...w, store });
    out.oldSeatIgnored = !t3.q('#ph-rejoin') && (t3.q('#ph-code') || {}).value === '';
  } catch (e) { out.crashed = String(e && e.stack || e).slice(0, 300); }
  return out;
}

// SCENARIO (F2 11-27): the host's guess limit drops a guess with no answer. No 'got' in 5 s (250 ms here): the phone stops saying Sending, says so on the guess
// field (role alert) with Send enabled; a late got still marks the guess sent and clears that line.
async function gotWaitScenario(w) {
  const out = {};
  try {
    const t = await setup(w);
    const join = await joinOk(t, 'Ana');
    t.R.deliver(await question(t)); await until(() => !!t.q('#ph-guess'), 300);
    t.q('#ph-guess').value = 'river bend';
    await t.submit(t.root.all(e => e.tagName === 'form')[0]);
    out.sending = /^Sending/.test(t.tx('#ph-sent'));
    const NOT = 'Your guess did not reach the host. Send it again.';
    await until(() => t.tx('#ph-guess-err') === NOT, 1000);
    const err = t.q('#ph-guess-err');
    out.notSentShown = !!err && err.textContent === NOT && err.attrs.role === 'alert' && t.q('#ph-guess').attrs['aria-invalid'] === 'true';
    out.sendingCleared = !/Sending/.test(t.tx('#ph-sent') || '');
    out.sendEnabled = !!t.q('#ph-send') && t.q('#ph-send').disabled !== true;
    t.R.deliver(await t.hostSigned({ t: 'got', pid: join.pid, round: 0 }));
    await until(() => /^Sent:/.test(t.tx('#ph-sent')), 300);
    out.lateGotSent = /^Sent: .river bend.\. You can change it until time is up\.$/.test(t.tx('#ph-sent')) && t.tx('#ph-guess-err') === '';
  } catch (e) { out.crashed = String(e && e.stack || e).slice(0, 300); }
  return out;
}

test('MUST FAIL: a guess with no got in 5 s says it did not reach the host (Send enabled), and a late got still marks it sent', async () => {
  assert.deepEqual(await gotWaitScenario({}), { sending: true, notSentShown: true, sendingCleared: true, sendEnabled: true, lateGotSent: true });
});

// SCENARIO (round 2, CC1 E): five 'No room with that code answered' in a row and the Join button waits 30 s (1.5 s here) with plain words; no join is sent meanwhile.
async function missesScenario(w) {
  const out = {};
  try {
    const t = await setup(w);
    const TOO = 'Too many tries. Wait 30 seconds, then check the letters on the host' + "'" + 's screen.';
    for (let i = 0; i < 5; i++) { t.type('wrxn gltz', 'Ana'); await t.submit(); }
    const joinsAfter5 = t.R.from('join').length;
    const btn = t.button(/^Join the room$/) || t.root.all(e => e.tagName === 'button')[0];
    out.fiveTries = joinsAfter5 >= 5 && t.tx('#ph-code-err') === 'No room with that code answered. Check the letters on the host' + "'" + 's screen.';
    out.tooManyShown = t.tx('#ph-join-note') === TOO && t.q('#ph-join-note').attrs.role === 'alert' && t.q('#ph-join-note').hidden === false && !!btn && btn.disabled === true;
    t.type('wrxn gltz', 'Ana'); await t.submit();
    out.sixthNotSent = t.R.from('join').length === joinsAfter5;
    await sleep(MISS_WAIT_REAL + 200);
    out.waitEnds = !!btn && btn.disabled === false && t.q('#ph-join-note').hidden === true;
    const before = t.R.from('join').length;
    const { going, join } = await startJoin(t);
    t.R.deliver(await t.hostSigned({ t: 'welcome', pid: join.pid, ok: true, name: 'Ana', nonce: join.nonce, pub: t.host.pub }));
    await going;
    out.thenJoins = t.R.from('join').length > before && /You are in room HQRMWKTP/.test(t.text());
  } catch (e) { out.crashed = String(e && e.stack || e).slice(0, 300); }
  return out;
}
const MISS_WAIT_REAL = 30000 / SCALE;

test('MUST FAIL: five wrong codes in a row: the Join button waits 30 s with plain words (role alert) and sends nothing meanwhile; then it works again', async () => {
  assert.deepEqual(await missesScenario({}), { fiveTries: true, tooManyShown: true, sixthNotSent: true, waitEnds: true, thenJoins: true });
});

test('kept behaviour: the names check (when assets/game-names.js is there) stops a join before any connection; Sending then Sent; a rejoin keeps its pid with a new nonce; an old 6-letter seat is no seat', async () => {
  assert.deepEqual(await keptScenario({}), { namesChecked: true, sending: true, sent: true, rejoinSamePid: true, rejoined: true, oldSeatIgnored: true });
});

test('two-press leave and the silent-host notice are still there', () => {
  const src = read(PHONE);
  assert.match(src, /'Press again to leave this game'/);
  assert.match(src, /The host\u2019s screen stopped answering/);
  assert.match(src, /JOIN_WAIT_MS = 6000;/); assert.match(src, /JOIN_RETRY_MS = 3000;/); assert.match(src, /NONCE_KEEP_MS = 10000;/);
});

test('the phone page loads the new phone script and stylesheet versions', () => {
  const html = read('game-phone/index.html');
  assert.match(html, /\/assets\/game-phone-live\.js\?v=20261127p1d"/); assert.match(html, /\/assets\/game-phone\.css\?v=20261127g4"/);
});

test('the 11-27 holds lines added to the phone script are plain ASCII', () => {
  const src = read(PHONE);
  const lines = src.split('\n').filter(l => /nonce|Nonce|refusalWhy|WORDS|closedRoom|removedScreen|notIn|drop\(|ryagramGameNames|JOIN_RETRY_MS/.test(l));
  assert.ok(lines.length > 10);
  for (const l of lines) assert.ok(!/[^\x00-\x7f]/.test(l), l.slice(0, 100));
  assert.ok(!/[^\x00-\x7f]/.test(read('tests/game-phone-holds.test.mjs')));
});

// MUST FAIL: each check taken out (in memory only); the scenario must then see that bad message get through.
const MUTANTS = [
  { name: 'no nonce check: a recorded welcome is taken', edits: [['if (!ourNonce(m.nonce)) return;', '']], scenario: joinScenario, caught: ['recordedWelcomeIgnored'] },
  { name: 'no code check: whoever answers with the nonce is the host', edits: [['Room.codeOf(m.pub).then(c => c === s.code, () => false)', 'Promise.resolve(true)']], scenario: joinScenario, caught: ['wrongKeyIgnored'] },
  { name: 'no seq floor before verify', edits: [['if (!s.hostPub || !Number.isInteger(m.seq) || m.seq <= s.hostSeq) return false;', 'if (!s.hostPub) return false;']], scenario: joinScenario, caught: ['staleDroppedBeforeVerify'] },
  { name: 'no retry', edits: [['if (!done && s.conn) sendJoin().catch(() => {});', '']], scenario: joinScenario, caught: ['retried'] },
  { name: 'the retry reuses the first nonce', edits: [['nonce: freshNonce() }); }', 'nonce: s.n1 || (s.n1 = freshNonce()) }); }']], scenario: joinScenario, caught: ['retried'] },
  { name: 'full and locked read from the old words', edits: [['joinNote.textContent = WORDS[why];', 'joinNote.textContent = answer.problem;']], scenario: refusalScenario, caught: ['fullWords', 'lockedWords'] },
  { name: 'a removal mid-game ignored', edits: [['if (why === \'removed\' || !why) { drop(); removedScreen(); }', '']], scenario: removedScenario, caught: ['removedShown', 'seatCleared'] },
  { name: 'a removal without the seated nonce', edits: [[' && m.nonce === s.seatNonce) { if (await fromHost(m)) notIn(m); }', ') { if (await fromHost(m)) notIn(m); }']], scenario: removedScenario, caught: ['wrongNonceRemovalIgnored'] },
  { name: 'the silent host keeps the channel open', edits: [['      drop(true);', '      stopTimer();']], scenario: silentScenario, caught: ['connectionClosed'] },
  { name: 'a removal from any key', edits: [['if (!(await Room.verify(s.hostPub, s.code, m)) || m.seq <= s.hostSeq) return false;', '']], scenario: removedScenario, caught: ['forgedRemovalIgnored'] },
  { name: 'a closed room keeps its clocks', edits: [['stopTimer(); unwatch(); if (s.retry)', 'if (s.retry)']], scenario: closedScenario, caught: ['idleStopsTimers'] },
  { name: 'a closed room ignored', edits: [["if (m.phase === 'closed') { closedRoom(m.why); return; }", '']], scenario: closedScenario, caught: ['idleWords'] },
  { name: 'no got timeout: Sending forever', edits: [['s.gotWait = setTimeout(() => {', 's.gotWait = (() => {']], scenario: gotWaitScenario, caught: ['notSentShown', 'sendingCleared'] },
  { name: 'no wrong-code throttle', edits: [['if (s.misses >= MISSES_MAX) {', 'if (false) {']], scenario: missesScenario, caught: ['tooManyShown', 'sixthNotSent'] },
  { name: 'no names check', edits: [["|| namesProblem(H.clean(name.input.value))", '']], scenario: keptScenario, caught: ['namesChecked'] },
];

for (const mu of MUTANTS) {
  test(`MUST FAIL (mutant caught): ${mu.name}`, async () => {
    const out = await mu.scenario({ edits: mu.edits });
    for (const k of mu.caught) assert.equal(out[k], false, `${mu.name}: ${k} must turn false when the check is gone (got ${JSON.stringify(out)})`);
  });
}

test('WEB WALK 13:28: the guess box stops at the limit the counter shows, Enter sends (Shift+Enter keeps a new line), and Play again replaces the game-over line on the phone', () => {
  const src = fs.readFileSync(new URL('../assets/game-phone-live.js', import.meta.url), 'utf8').split(String.fromCharCode(13)).join('');
  assert.match(src, /el\('textarea', \{ rows: '3', maxlength: String\(H\.ANSWER_MAX\),/);
  assert.match(src, /ev\.key === 'Enter' && !ev\.shiftKey && !ev\.isComposing\) \{ ev\.preventDefault\(\); const f = guess\.input\.form; if \(f && f\.requestSubmit\) f\.requestSubmit\(\);/);
  assert.match(src, /if \(s\.phase === 'final'\) live\.textContent = 'Back in the lobby\. Wait for the host to start the next game\.';/);
});
