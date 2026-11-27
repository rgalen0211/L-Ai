// GAMES 11-27: the SIGNED live room (WORKER review MEDIUM: every message reaches everyone in the room and there is no server, so a phone could send a guess or a leave
// with another player's pid, and anyone with the code could send a forged state to every phone). These tests prove, in node with the real WebCrypto:
//   the shared helper (assets/game-room.js keyPair/pidOf/sign/verify) and the new field formats in validate;
//   the HOST (assets/app-games.js, mounted on a fake room) drops a guess with A's pid signed by B, a replayed leave, a join whose pid is not its key's, and unsigned messages;
//   the PHONE (assets/game-phone-live.js, mounted on a tiny fake page) pins the host key from its welcome and drops a forged or replayed state and a forged got;
//   and MUST FAIL: each refusal is run again against an in-memory copy of the code with that one check taken out, and the scenario must then see the forgery get through.
// All names and text here are invented. Nothing is written to disk: the mutants are strings in memory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const J = x => JSON.parse(JSON.stringify(x));
let CODE = 'ABCDEF';          // set to the host's own code (made from its key) in each scenario
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(ok, ms = 3000) { const t0 = Date.now(); while (!ok()) { if (Date.now() - t0 > ms) return false; await sleep(5); } return true; }
const SOURCES = ['assets/game-room.js', 'assets/game-score.js', 'assets/game-rounds.js', 'assets/app-games.js', 'assets/game-phone.js', 'assets/game-phone-live.js'];

// A tiny fake page: just what the phone and host scripts use.
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
const h = (tag, attrs, ...kids) => { const e = new El(tag); for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false && !k.startsWith('on')) e.setAttribute(k, v); e.children = kids.flat().filter(c => c != null).map(c => (c.nodeType ? c : { nodeType: 3, textContent: String(c) })); return e; };

// One browser world: the six scripts (or mutated copies) in one context, a session store, and the page bits they touch.
function world(mutate = {}) {
  const store = new Map();
  const ctx = { console, URLSearchParams, URL, TextEncoder, crypto: globalThis.crypto, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
    location: { hostname: '127.0.0.1', search: '?relay=http://127.0.0.1:9', hash: '#/d/games', origin: 'http://127.0.0.1:1' },
    sessionStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) },
    document: { createElement: t => new El(t), createTextNode: t => ({ nodeType: 3, textContent: String(t) }), getElementById: () => null },
    addEventListener() {}, removeEventListener() {} };
  ctx.window = ctx;
  vm.createContext(ctx);
  for (const f of SOURCES) {
    let src = read(f);
    for (const [from, to] of (mutate[f] || [])) { assert.ok(src.includes(from), `mutant text is in ${f}: ${from}`); src = src.split(from).join(to); }
    vm.runInContext(src, ctx, { filename: f });
  }
  return { W: ctx, G: ctx.ryagramGameRoom, store };
}

// A fake room: every endpoint's message (validated, as the real room does) reaches every OTHER endpoint; drop() can hold some back; log keeps everything sent.
function bus(G) {
  const ends = [], log = [];
  const b = {
    log, drop: () => false,
    endpoint(name) {
      const ls = new Set();
      const e = {
        name, ls,
        async send(m) {
          const v = G.validate(m); if (!v) throw new Error('not one the game sends');
          log.push({ from: name, m: J(v) });
          for (const o of ends) if (o !== e && !b.drop(name, o.name, v)) for (const cb of [...o.ls]) setTimeout(() => cb(G.validate(J(v))), 0);
        },
        onMessage(cb) { ls.add(cb); return () => ls.delete(cb); },
        close() { ls.clear(); const i = ends.indexOf(e); if (i >= 0) ends.splice(i, 1); },
      };
      ends.push(e); return e;
    },
    to(name, m) { for (const o of ends) if (o.name === name) for (const cb of [...o.ls]) cb(G.validate(J(m))); },
    from: (name, t) => log.filter(x => x.from === name && (!t || x.m.t === t)).map(x => x.m),
  };
  return b;
}

function mountHost(w, room) {
  const Room = { ...w.G, connect: async () => room.endpoint('host') };
  return w.W.ryagramGamesHost.mount(new El('div'), { h, Room, Score: w.W.ryagramGameScore, Rounds: w.W.ryagramGameRounds, cfg: {} });
}
async function fakePhone(w, room, name) {
  const pair = await w.G.keyPair(), pid = await w.G.pidOf(pair.pub), end = room.endpoint(name);
  let seq = 0;
  const ph = { pair, pid, end, last: null,
    signed: async (m, extra = {}) => (ph.last = await w.G.sign(pair, CODE, { ...m, pid, seq: ++seq, ...extra })),
    send: async (m, extra) => end.send(await ph.signed(m, extra)) };
  return ph;
}

test('MUST FAIL: the helper: a pid is bound to its key, a stored key gives the same pid, a good join/guess/leave verifies, and a wrong key, room, field, seq or sig does not', async () => {
  const { G } = world();
  const a = await G.keyPair(), b = await G.keyPair();
  assert.match(a.pub, /^[A-Za-z0-9_-]{87}$/, 'raw P-256 key, base64url');
  const pid = await G.pidOf(a.pub);
  assert.match(pid, /^[A-Za-z0-9]{20}$/); assert.notEqual(pid, await G.pidOf(b.pub));
  const back = await G.keyPair(J(a.jwk)); assert.equal(back.pub, a.pub, 'the seat key gives the same public key'); assert.equal(await G.pidOf(back.pub), pid);
  assert.deepEqual(Object.keys(a.jwk).sort(), ['crv', 'd', 'kty', 'x', 'y'], 'only the key itself is stored');
  const join = await G.sign(a, CODE, { t: 'join', pid, name: ' Ana ', pub: a.pub, seq: 1 });
  const guess = await G.sign(back, CODE, { t: 'guess', pid, round: 2, text: 'over the hill', seq: 2 });
  const leave = await G.sign(a, CODE, { t: 'leave', pid, seq: 3 });
  for (const m of [join, guess, leave]) { assert.match(m.sig, /^[A-Za-z0-9_-]{86}$/); assert.equal(await G.verify(a.pub, CODE, G.validate(m)), true, m.t); }
  assert.equal(await G.verify(a.pub, CODE, join), true, 'the name is signed as validate cleans it, so the raw and the clean copy both verify');
  assert.equal(await G.verify(b.pub, CODE, guess), false, 'another key');
  assert.equal(await G.verify(a.pub, 'WXYZ', guess), false, 'another room');
  assert.equal(await G.verify(a.pub, CODE, { ...guess, text: 'under the hill' }), false, 'a changed field');
  assert.equal(await G.verify(a.pub, CODE, { ...guess, round: 3 }), false, 'a changed round');
  assert.equal(await G.verify(a.pub, CODE, { ...guess, seq: 9 }), false, 'a changed seq');
  assert.equal(await G.verify(a.pub, CODE, { ...guess, pid: 'OtherPlayer0001' }), false, 'a changed pid');
  assert.equal(await G.verify(a.pub, CODE, { ...guess, t: 'got' }), false, 'a changed kind');
  const { seq, ...noSeq } = guess; assert.equal(await G.verify(a.pub, CODE, noSeq), false, 'no seq');
  const { sig, ...noSig } = guess; assert.equal(await G.verify(a.pub, CODE, noSig), false, 'no sig');
  assert.equal(await G.verify(a.pub, CODE, { ...guess, sig: guess.sig.slice(0, 84) + 'AA' }), false, 'a broken sig');
  assert.equal(await G.verify('A'.repeat(87), CODE, guess), false, 'a key that is not a point');
  assert.equal(await G.verify(a.pub, CODE, null), false);
  assert.equal(await G.pidOf('not a key'), '');
  await assert.rejects(G.sign(a, CODE, { t: 'leave', pid }), /seq/);
  await assert.rejects(G.sign(a, CODE, { t: 'cheat', pid, seq: 1 }), /not one the game sends/);
  await assert.rejects(G.keyPair({ kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'd' }), /not a game key/);
});

test('MUST FAIL: validate takes pub/sig as base64url of 80 to 100 characters and seq as an integer 0 to 1e9, on the right kinds only, and keeps MAX_BYTES', async () => {
  const { G } = world();
  const k = 'A'.repeat(87), g = 'B'.repeat(86);
  assert.deepEqual(J(G.validate({ t: 'join', pid: 'AnaPhone01', name: 'Ana', pub: k, seq: 0, sig: g })), { t: 'join', pid: 'AnaPhone01', name: 'Ana', pub: k, seq: 0, sig: g });
  assert.deepEqual(J(G.validate({ t: 'guess', pid: 'AnaPhone01', round: 0, text: 'x', seq: 1e9, sig: g, pub: k })), { t: 'guess', pid: 'AnaPhone01', round: 0, text: 'x', seq: 1e9, sig: g }, 'pub is for join and welcome only');
  assert.equal(G.validate({ t: 'welcome', pid: 'AnaPhone01', ok: true, pub: k, seq: 4, sig: g }).pub, k);
  for (const t of ['state', 'got', 'leave']) {
    const base = t === 'state' ? { t, phase: 'lobby', round: 0, of: 5, players: [] } : t === 'got' ? { t, pid: 'AnaPhone01', round: 0 } : { t, pid: 'AnaPhone01' };
    assert.equal(G.validate({ ...base, seq: 7, sig: g }).seq, 7, t);
  }
  for (const v of ['A'.repeat(79), 'A'.repeat(101), 'A'.repeat(86) + '+', 'A'.repeat(86) + '=', 'A'.repeat(85) + '\u00e9', 7, false]) {
    assert.equal(G.validate({ t: 'join', pid: 'AnaPhone01', name: 'Ana', pub: v }), null, `pub ${String(v).slice(-3)}`);
    assert.equal(G.validate({ t: 'leave', pid: 'AnaPhone01', sig: v }), null, `sig ${String(v).slice(-3)}`);
  }
  for (const v of [-1, 1.5, 1e9 + 1, '3', NaN, Infinity]) assert.equal(G.validate({ t: 'leave', pid: 'AnaPhone01', seq: v }), null, `seq ${v}`);
  assert.equal(G.validate({ t: 'join', pid: 'AnaPhone01', name: 'Ana', pub: k, sig: g, pad: 'z'.repeat(8200) }), null, 'MAX_BYTES still applies');
  assert.equal(G.MAX_BYTES, 8192);
});

// The HOST scenario: what got through. On the real code every refusal is true.
async function hostScenario(w) {
  const room = bus(w.G), host = mountHost(w, room), out = {};
  await until(() => room.from('host', 'state').length > 0);
  CODE = host.state().code;
  const A = await fakePhone(w, room, 'a'), B = await fakePhone(w, room, 'b'), D = await fakePhone(w, room, 'd'), E = await fakePhone(w, room, 'e');
  const settle = async () => { await sleep(10); await host.settled(); await sleep(5); await host.settled(); };
  const welcomeFor = pid => room.from('host', 'welcome').filter(m => m.pid === pid);
  const player = pid => host.state().players.find(p => p.pid === pid);
  try {
  await A.send({ t: 'join', name: 'Ana', pub: A.pair.pub }); await B.send({ t: 'join', name: 'Ben', pub: B.pair.pub }); await settle();
  const wa = welcomeFor(A.pid)[0];
  out.goodJoin = !!(wa && wa.ok && wa.pub && await w.G.verify(wa.pub, CODE, wa)) && !!player(A.pid) && !!player(B.pid);
  // a join whose pid is not made from its key (D's key, E's pid), and an unsigned join
  await D.end.send(await w.G.sign(D.pair, CODE, { t: 'join', pid: E.pid, name: 'Dee', pub: D.pair.pub, seq: 1 }));
  await D.end.send({ t: 'join', pid: 'Unsigned0001', name: 'Una' }); await settle();
  out.pidMismatchRefused = !welcomeFor(E.pid).length && !player(E.pid);
  out.unsignedJoinRefused = !welcomeFor('Unsigned0001').length && !player('Unsigned0001');
  // at most 3 good joins per pid in 10 s: the 4th is dropped unanswered
  const Rr = await fakePhone(w, room, 'r');
  for (let i = 0; i < 4; i++) await Rr.send({ t: 'join', name: 'Rae', pub: Rr.pair.pub });
  await settle();
  out.joinRateLimited = welcomeFor(Rr.pid).length === 3;
  // refused joins (a reserved name, from five new keys) are answered but remembered nowhere: no seat, no key kept
  const keysBefore = host.state().keys.size, playersBefore = host.state().players.length;
  const refused = [];
  for (let i = 0; i < 5; i++) { const X = await fakePhone(w, room, 'x' + i); refused.push(X); await X.send({ t: 'join', name: i % 2 ? 'ADMIN' : 'Host', pub: X.pair.pub }); }
  await settle();
  out.refusedJoinsKeepNoKey = refused.every(X => welcomeFor(X.pid).length === 1 && welcomeFor(X.pid)[0].ok === false) && host.state().keys.size === keysBefore && host.state().players.length === playersBefore;
  host.start(); await settle();
  // B's key, A's pid: the forged guess is dropped (no got, no guess, no score)
  await B.end.send(await w.G.sign(B.pair, CODE, { t: 'guess', pid: A.pid, round: 0, text: 'forged by ben', seq: 999 })); await settle();
  out.forgedGuessRefused = !host.state().guesses.has(A.pid) && !room.from('host', 'got').some(m => m.pid === A.pid);
  await B.end.send({ t: 'guess', pid: A.pid, round: 0, text: 'unsigned by ben' }); await settle();
  out.unsignedGuessRefused = !host.state().guesses.has(A.pid);
  await A.send({ t: 'guess', round: 0, text: 'over the hill' }); await settle();
  out.goodGuess = host.state().guesses.get(A.pid) === 'over the hill' && room.from('host', 'got').some(m => m.pid === A.pid && m.round === 0);
  // a replayed guess (A's own, same seq) does not overwrite a later one
  const oldGuess = A.last;
  await A.send({ t: 'guess', round: 0, text: 'under the hill' }); await settle();
  await A.end.send(oldGuess); await settle();
  out.replayedGuessRefused = host.state().guesses.get(A.pid) === 'under the hill';
  // B's key cannot make A leave
  await B.end.send(await w.G.sign(B.pair, CODE, { t: 'leave', pid: A.pid, seq: 5000 })); await settle();
  out.forgedLeaveRefused = !player(A.pid).gone;
  // A leaves, rejoins (reloaded page, same key); the old leave sent again must not drop A
  await A.send({ t: 'leave' }); await settle();
  const leftOk = player(A.pid).gone === true; const oldLeave = A.last;
  await A.send({ t: 'join', name: 'Ana', pub: A.pair.pub }); await settle();
  const backOk = player(A.pid).gone === false && welcomeFor(A.pid).length === 2;
  await A.end.send(oldLeave); await settle();
  out.goodLeave = leftOk && backOk;
  out.replayedLeaveRefused = player(A.pid).gone === false;
  // a rejoin with A's pid but B's key is refused
  await B.end.send(await w.G.sign(B.pair, CODE, { t: 'join', pid: A.pid, name: 'Ana', pub: B.pair.pub, seq: 9000 })); await settle();
  out.hijackJoinRefused = welcomeFor(A.pid).length === 2;
  // everything the host sent is signed by its own key, seq strictly up
  const sent = room.from('host'); let up = true;
  for (let i = 1; i < sent.length; i++) if (!(sent[i].seq > sent[i - 1].seq)) up = false;
  let signed = true; for (const m of sent) if (!(await w.G.verify(wa.pub, CODE, m))) signed = false;
  out.hostSigned = up && signed && sent.length > 5;
  } catch (e) { out.crashed = String(e).slice(0, 200); }
  host.close();
  return out;
}

const press = async (btn) => { for (const cb of btn.listeners.click || []) await cb({}); };
const submit = async form => { for (const cb of form.listeners.submit || []) await cb({ preventDefault() {} }); };

// The PHONE scenario: a real host, a real phone, and Eve (another phone in the room with her own key) sending forged host messages.
async function phoneScenario(w) {
  const room = bus(w.G), host = mountHost(w, room), out = {};
  await until(() => room.from('host', 'state').length > 0);
  CODE = host.state().code;
  const root = new El('div');
  const P = w.W.ryagramGamePhone, H = { ...P, codeProblem: v => P.codeProblem(v, w.G.CODE_LEN) };          // as assets/game-phone.js passes it in live mode
  w.W.ryagramGamePhoneLive.mount(root, H, { ...w.G, connect: async () => room.endpoint('phone') }, { games: 'account' });
  const settle = async () => { await sleep(15); await host.settled(); await sleep(15); };
  try {
  const Eve = await fakePhone(w, room, 'eve');
  Eve.end.onMessage(m => { if (m.t === 'join' && !Eve.answered) { Eve.answered = true;
    w.G.sign(Eve.pair, CODE, { t: 'welcome', pid: m.pid, ok: false, problem: 'That name is taken by Eve. Pick another.', pub: Eve.pair.pub, seq: 1 }).then(x => Eve.end.send(x)); } });
  root.querySelector('#ph-code').value = CODE.slice(0, 3).toLowerCase() + '-' + CODE.slice(3); root.querySelector('#ph-name').value = 'Ana';
  await submit(root.querySelector('form'));
  const text = () => root.textContent;
  out.joined = text().includes('You are in room ' + CODE);
  out.strangerWelcomeIgnored = Eve.answered === true && out.joined && !/taken by Eve/.test(text());
  const Ben = await fakePhone(w, room, 'ben'); await Ben.send({ t: 'join', name: 'Ben', pub: Ben.pair.pub });
  const join = room.from('phone', 'join')[0];
  out.joinSigned = !!join && join.pid === await w.G.pidOf(join.pub) && await w.G.verify(join.pub, CODE, join) && Number.isInteger(join.seq);
  const seat = JSON.parse(w.store.get('ryagram-game-seat') || 'null');
  const welcome = room.from('host', 'welcome')[0];
  out.seatKept = !!seat && seat.pid === join.pid && !!seat.jwk && seat.jwk.d && seat.hostPub === welcome.pub && seat.seq >= join.seq
    && (await w.G.pidOf((await w.G.keyPair(seat.jwk)).pub)) === seat.pid;
  await until(() => /Players: Ana, Ben/.test(text())); await settle();
  out.realStateShown = /Players: Ana, Ben/.test(text());
  // Each step below is ordered so that a check taken out (the mutants) cannot hide a LATER check: e.g. a forged got let through sets a high seq, so the forged state uses a higher one.
  // A crash is recorded as crashed, never as a catch (a mutant must turn its own key false).
    // a forged welcome offering Eve's key, after the real one was taken: nothing changes
    await Eve.end.send(await w.G.sign(Eve.pair, CODE, { t: 'welcome', pid: join.pid, ok: true, pub: Eve.pair.pub, seq: 1e8 }));
    await settle();
    out.forgedWelcomeRefused = !/Mallory/.test(text()) && /Players: Ana, Ben/.test(text());
    const oldLobby = room.from('host', 'state').filter(m => m.phase === 'lobby').pop();
    host.start(); await until(() => !!root.querySelector('#ph-guess')); await settle();
    out.realQuestionShown = !!root.querySelector('#ph-guess');
    // a forged got: the host's real got is held back from the phone, Eve sends one signed by her key; the phone must not say Sent
    room.drop = (from, to, m) => from === 'host' && to === 'phone' && m.t === 'got';
    root.querySelector('#ph-guess').value = 'over the hill';
    await submit(root.all(e => e.tagName === 'form')[0]);
    await until(() => room.from('host', 'got').length > 0); await settle();
    await Eve.end.send(await w.G.sign(Eve.pair, CODE, { t: 'got', pid: join.pid, round: 0, seq: 5e8 })); await settle();
    out.forgedGotRefused = !/Sent:/.test(root.querySelector('#ph-sent').textContent) && /Sending/.test(root.querySelector('#ph-sent').textContent);
    room.drop = () => false;
    room.to('phone', room.from('host', 'got')[0]); await settle();
    out.realGotShown = /Sent:/.test(root.querySelector('#ph-sent').textContent);
    const guess = room.from('phone', 'guess')[0];
    out.guessSigned = !!guess && guess.pid === join.pid && guess.seq > join.seq && await w.G.verify(join.pub, CODE, guess) && host.state().guesses.get(join.pid) === 'over the hill';
    // a replayed genuine host state (a real signature, an old seq) must not take the phone back to the lobby
    await Eve.end.send(oldLobby); await settle();
    out.replayedStateRefused = !!root.querySelector('#ph-guess') && !root.querySelector('#ph-lobby-players');
    // a forged state (Eve's key, the highest seq) and an unsigned one
    await Eve.end.send(await w.G.sign(Eve.pair, CODE, { t: 'state', phase: 'lobby', round: 0, of: 5, players: ['Mallory'], seq: 1e9 }));
    await Eve.end.send({ t: 'state', phase: 'lobby', round: 0, of: 5, players: ['Mallory'] });
    await settle();
    out.forgedStateRefused = !/Mallory/.test(text()) && !!root.querySelector('#ph-guess');
    // the two-press leave sends a leave signed by the phone's key with a higher seq, and the host takes it
    const leaveBtn = root.all(e => /ph-leave/.test(e.className || ''))[0];
    await press(leaveBtn); await press(leaveBtn); await settle();
    const leave = room.from('phone', 'leave').pop();
    out.leaveSigned = !!leave && leave.seq > guess.seq && await w.G.verify(join.pub, CODE, leave) && host.state().players.find(p => p.pid === join.pid).gone === true;
  } catch (e) { out.crashed = String(e).slice(0, 200); }
  host.close();
  return out;
}

test('MUST FAIL: the HOST drops a guess or leave with A\'s pid signed by B, a replayed guess or leave, a join whose pid is not its key\'s, and unsigned messages; it signs all it sends', async () => {
  const out = await hostScenario(world());
  assert.deepEqual(out, { goodJoin: true, pidMismatchRefused: true, unsignedJoinRefused: true, joinRateLimited: true, refusedJoinsKeepNoKey: true, forgedGuessRefused: true, unsignedGuessRefused: true, goodGuess: true,
    replayedGuessRefused: true, forgedLeaveRefused: true, goodLeave: true, replayedLeaveRefused: true, hijackJoinRefused: true, hostSigned: true });
});

test('MUST FAIL: the PHONE signs its join/guess/leave, keeps its key and the pinned host key in its seat, and drops a forged state, a forged welcome, a replayed state and a forged got', async () => {
  const out = await phoneScenario(world());
  assert.deepEqual(out, { joined: true, strangerWelcomeIgnored: true, joinSigned: true, seatKept: true, realStateShown: true, forgedWelcomeRefused: true, realQuestionShown: true, forgedGotRefused: true, realGotShown: true,
    guessSigned: true, replayedStateRefused: true, forgedStateRefused: true, leaveSigned: true });
});

// LOOK-ALIKE NAMES and the invisible set (pure checks, also run against mutants below).
async function namesScenario(w) {
  const H = w.W.ryagramGamesHost, G = w.G, out = {};
  const wide = t => [...t].map(c => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)).join('');          // full-width letters, built here so this file stays ASCII
  const players = [{ pid: 'AnaPhone01', name: 'Ana' }, { pid: 'FixPhone01', name: 'fix' }];
  out.fullWidthSame = /already has that name/.test(H.nameProblem(wide('ANA'), players) || '');
  out.ligatureSame = /already has that name/.test(H.nameProblem(String.fromCharCode(0xFB01) + 'x', players) || '');
  out.reservedRefused = ['host', 'Ryagram', 'ADMIN', wide('admin')].every(n => /kept for the game/.test(H.nameProblem(n, players) || ''));
  out.plainNamesOk = ['Hostess', 'Ben', 'Admiral'].every(n => H.nameProblem(n, players) === null);
  const hidden = [0xAD, 0x34F, 0x61C, 0x180E].map(c => 'A' + String.fromCharCode(c) + 'na');
  out.newInvisiblesCleaned = hidden.every(n => { const v = G.validate({ t: 'join', pid: 'AnaPhone01', name: n }); return !!v && v.name === 'A na'; });
  const roomSet = /const INVISIBLE = (.*?);/.exec(read('assets/game-room.js'))[1], phoneSet = /const INVISIBLE = (.*?);/.exec(read('assets/game-phone.js'))[1];
  out.sameSetOnPhone = roomSet === phoneSet && w.W.ryagramGamePhone.clean(hidden[0]) === 'A na';
  return out;
}

test('MUST FAIL: names: a look-alike (NFKC, any case) of a player\'s name is refused, host/ryagram/admin are kept, and the four new invisible characters are cleaned the same on host and phone', async () => {
  assert.deepEqual(await namesScenario(world()), { fullWidthSame: true, ligatureSame: true, reservedRefused: true, plainNamesOk: true, newInvisiblesCleaned: true, sameSetOnPhone: true });
});

test('MUST FAIL: no signing, no game: without crypto.subtle the host opens no room and the phone sends no join, each saying so in plain words', async () => {
  const w = world();
  const noSubtle = { getRandomValues: a => globalThis.crypto.getRandomValues(a) };
  w.W.crypto = noSubtle;
  let opened = 0;
  const hostRoot = new El('div');
  w.W.ryagramGamesHost.mount(hostRoot, { h, Room: { ...w.G, connect: async () => { opened++; return bus(w.G).endpoint('host'); } }, Score: w.W.ryagramGameScore, Rounds: w.W.ryagramGameRounds, cfg: {} });
  await sleep(50);
  assert.equal(opened, 0, 'no room opened');
  assert.match(hostRoot.textContent, /cannot sign the game/);
  const room = bus(w.G), root = new El('div'), P = w.W.ryagramGamePhone;
  w.W.ryagramGamePhoneLive.mount(root, { ...P, codeProblem: v => P.codeProblem(v, w.G.CODE_LEN) }, { ...w.G, connect: async () => { opened++; return room.endpoint('phone'); } }, { games: 'account' });
  root.querySelector('#ph-code').value = 'ABCDEF'; root.querySelector('#ph-name').value = 'Ana';
  await submit(root.querySelector('form'));
  assert.equal(opened, 0, 'the phone did not connect'); assert.equal(room.log.length, 0, 'nothing sent');
  assert.match(root.textContent, /cannot sign the game/);
});

// Each mutant takes ONE check out (in memory only); the scenario must then report that forgery as getting through. A mutant that changes nothing would fail on its own text check.
const HOST = 'assets/app-games.js', PHONE = 'assets/game-phone-live.js', ROOMJS = 'assets/game-room.js';
const MUTANTS = [
  { name: 'host: no signature check', file: HOST, edits: [['if (!(await Room.verify(pub, s.code, m))) return;', '']], scenario: hostScenario, caught: ['forgedGuessRefused', 'forgedLeaveRefused'] },
  { name: 'host: no seq check', file: HOST, edits: [['if (known && m.seq <= known.seq) return;', ''], ['(now.pub !== pub || m.seq <= now.seq)', '(now.pub !== pub)']], scenario: hostScenario, caught: ['replayedLeaveRefused', 'replayedGuessRefused'] },
  { name: 'host: no pid-from-key check', file: HOST, edits: [['if ((await Room.pidOf(m.pub)) !== m.pid) return;', '']], scenario: hostScenario, caught: ['pidMismatchRefused'] },
  { name: 'host: unsigned messages taken', file: HOST, edits: [["if (s.closed || !['join', 'guess', 'leave'].includes(m.t) || !Number.isInteger(m.seq)) return;", "if (s.closed) return; if (!Number.isInteger(m.seq)) { onMessage(m); return; }"]], scenario: hostScenario, caught: ['unsignedJoinRefused', 'unsignedGuessRefused'] },
  { name: 'phone: host messages not verified', file: PHONE, edits: [['if (!(await Room.verify(s.hostPub, s.code, m)) || m.seq <= s.hostSeq) return false;', '']], scenario: phoneScenario, caught: ['forgedStateRefused', 'forgedGotRefused'] },
  { name: 'phone: host seq not checked', file: PHONE, edits: [['if (!s.hostPub || !Number.isInteger(m.seq) || m.seq <= s.hostSeq) return false;', 'if (!s.hostPub) return false;'], ['if (!(await Room.verify(s.hostPub, s.code, m)) || m.seq <= s.hostSeq) return false;', 'if (!(await Room.verify(s.hostPub, s.code, m))) return false;']], scenario: phoneScenario, caught: ['replayedStateRefused'] },
  { name: 'phone: host key pinned from whoever answers first (no code check)', file: PHONE, edits: [['if ((await Room.codeOf(m.pub)) !== s.code) return;', '']], scenario: phoneScenario, caught: ['strangerWelcomeIgnored'] },
  { name: 'host: no join rate limit', file: HOST, edits: [['if (!joinAllowed(m.pid)) return;', '']], scenario: hostScenario, caught: ['joinRateLimited'] },
  { name: 'host: refused joins remembered', file: HOST, edits: [['if (now || s.players.some(p => p.pid === m.pid)) remember(m.pid, pub, m.seq);', 'remember(m.pid, pub, m.seq);']], scenario: hostScenario, caught: ['refusedJoinsKeepNoKey'] },
  { name: 'host: names compared without NFKC', file: HOST, edits: [['if (players.some(p => fold(p.name) === fold(name)))', 'if (players.some(p => p.name.toLowerCase() === name.toLowerCase()))']], scenario: namesScenario, caught: ['fullWidthSame', 'ligatureSame'] },
  { name: 'host: no reserved names', file: HOST, edits: [["if (RESERVED_NAMES.includes(fold(name).trim()))", 'if (false)']], scenario: namesScenario, caught: ['reservedRefused'] },
  { name: 'room: invisible set without the four new characters', file: ROOMJS, edits: [['\\u00ad\\u034f\\u061c\\u180e', '']], scenario: namesScenario, caught: ['newInvisiblesCleaned'] },
  { name: 'room: verify says yes to anything signed', file: ROOMJS, edits: [['return await subtle().verify(SIGN_ALG, key, sig, bytes);', 'return true;']], scenario: hostScenario, caught: ['forgedGuessRefused', 'forgedLeaveRefused'] },
];

for (const mu of MUTANTS) {
  test(`MUST FAIL (mutant caught): ${mu.name}`, async () => {
    const out = await mu.scenario(world({ [mu.file]: mu.edits }));
    for (const k of mu.caught) assert.equal(out[k], false, `${mu.name}: ${k} must turn false when the check is gone (got ${JSON.stringify(out)})`);
  });
}

test('plain ASCII in the three signed-room scripts and this test (no invisible characters slipped in)', () => {
  for (const f of [ROOMJS, 'tests/game-room-signed.test.mjs']) assert.ok(!/[^\x00-\x7f]/.test(read(f)), f);
  for (const f of [HOST, PHONE]) {          // these two had typographic quotes before this change; the signed-room lines must add none
    const lines = read(f).split('\n').filter(l => /sign|seq|pinned|fromHost|keyPair|pidOf|hostPub/.test(l));
    for (const l of lines) assert.ok(!/[^\x00-\x7f]/.test(l), `${f}: ${l.slice(0, 80)}`);
  }
});
