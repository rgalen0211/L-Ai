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
let CODE = 'ABCDEFGH';          // set to the host's own code (made from its key) in each scenario
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
  const store = new Map(), clock = { off: 0 };
  const ctx = { Date: class extends Date { static now() { return Date.now() + clock.off; } }, console, URLSearchParams, URL, TextEncoder, crypto: globalThis.crypto, setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
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
  return { W: ctx, G: ctx.ryagramGameRoom, store, clock };
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

function mountHost(w, room, opts = {}) {
  const Room = { ...w.G, connect: async () => room.endpoint('host'), ...(opts.Room || {}) };          // opts.Room: a test may wrap a function (to count signature checks)
  return w.W.ryagramGamesHost.mount(opts.root || new El('div'), { h, Room, Score: w.W.ryagramGameScore, Rounds: w.W.ryagramGameRounds, cfg: {}, seconds: opts.seconds });
}
async function fakePhone(w, room, name) {
  const pair = await w.G.keyPair(), pid = await w.G.pidOf(pair.pub), end = room.endpoint(name);
  let seq = 0;
  const ph = { pair, pid, end, last: null,
    signed: async (m, extra = {}) => (ph.last = await w.G.sign(pair, CODE, { ...(m.t === 'join' ? { nonce: w.G.newNonce() } : {}), ...m, pid, seq: ++seq, ...extra })),
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
  const join = await G.sign(a, CODE, { t: 'join', pid, name: ' Ana ', nonce: G.newNonce(), pub: a.pub, seq: 1 });
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
  const n = 'AnaNonce_0123456789-xy';
  assert.deepEqual(J(G.validate({ t: 'join', pid: 'AnaPhone01', name: 'Ana', nonce: n, pub: k, seq: 0, sig: g })), { t: 'join', pid: 'AnaPhone01', name: 'Ana', nonce: n, pub: k, seq: 0, sig: g });
  assert.deepEqual(J(G.validate({ t: 'guess', pid: 'AnaPhone01', round: 0, text: 'x', seq: 1e9, sig: g, pub: k })), { t: 'guess', pid: 'AnaPhone01', round: 0, text: 'x', seq: 1e9, sig: g }, 'pub is for join and welcome only');
  assert.equal(G.validate({ t: 'welcome', pid: 'AnaPhone01', ok: true, nonce: n, pub: k, seq: 4, sig: g }).pub, k);
  for (const t of ['state', 'got', 'leave']) {
    const base = t === 'state' ? { t, phase: 'lobby', round: 0, of: 5, players: [] } : t === 'got' ? { t, pid: 'AnaPhone01', round: 0 } : { t, pid: 'AnaPhone01' };
    assert.equal(G.validate({ ...base, seq: 7, sig: g }).seq, 7, t);
  }
  for (const v of ['A'.repeat(79), 'A'.repeat(101), 'A'.repeat(86) + '+', 'A'.repeat(86) + '=', 'A'.repeat(85) + '\u00e9', 7, false]) {
    assert.equal(G.validate({ t: 'join', pid: 'AnaPhone01', name: 'Ana', nonce: n, pub: v }), null, `pub ${String(v).slice(-3)}`);
    assert.equal(G.validate({ t: 'leave', pid: 'AnaPhone01', sig: v }), null, `sig ${String(v).slice(-3)}`);
  }
  for (const v of [-1, 1.5, 1e9 + 1, '3', NaN, Infinity]) assert.equal(G.validate({ t: 'leave', pid: 'AnaPhone01', seq: v }), null, `seq ${v}`);
  assert.equal(G.validate({ t: 'join', pid: 'AnaPhone01', name: 'Ana', nonce: n, pub: k, sig: g, pad: 'z'.repeat(8200) }), null, 'MAX_BYTES still applies');
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
  await D.end.send(await w.G.sign(D.pair, CODE, { t: 'join', pid: E.pid, name: 'Dee', nonce: w.G.newNonce(), pub: D.pair.pub, seq: 1 }));
  await D.end.send({ t: 'join', pid: 'Unsigned0001', name: 'Una', nonce: w.G.newNonce() }); await settle();
  out.pidMismatchRefused = !welcomeFor(E.pid).length && !player(E.pid);
  out.unsignedJoinRefused = !welcomeFor('Unsigned0001').length && !player('Unsigned0001');
  // at most 3 good joins per pid in 10 s: the 4th is dropped unanswered
  const Rr = await fakePhone(w, room, 'r');
  for (let i = 0; i < 4; i++) await Rr.send({ t: 'join', name: 'Rae', pub: Rr.pair.pub });
  await settle();
  out.joinRateLimited = welcomeFor(Rr.pid).length === 3;
  // refused joins (a reserved name, from five new keys) are answered but remembered nowhere: no seat, no key kept
  // the new-pid bucket (FACES 3.1, round 2: 16 a minute) has room: A, B, E and Rr took 4, so all five below are answered with no clock step
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
  w.clock.off += 1100; await A.end.send(oldGuess); await settle();          // a second later, so the guess rate limit (2 per second) is not what drops it
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
  await B.end.send(await w.G.sign(B.pair, CODE, { t: 'join', pid: A.pid, name: 'Ana', nonce: w.G.newNonce(), pub: B.pair.pub, seq: 9000 })); await settle();
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
    w.G.sign(Eve.pair, CODE, { t: 'welcome', pid: m.pid, ok: false, problem: 'That name is taken by Eve. Pick another.', nonce: m.nonce, pub: Eve.pair.pub, seq: 1 }).then(x => Eve.end.send(x)); } });
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
    await Eve.end.send(await w.G.sign(Eve.pair, CODE, { t: 'welcome', pid: join.pid, ok: true, nonce: join.nonce, pub: Eve.pair.pub, seq: 1e8 }));
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
    out.realGotShown = /^Sent: \u201cover the hill\u201d\. You can change it until time is up\.$/.test(root.querySelector('#ph-sent').textContent);          // a stop after the quote (words check 10:13)
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
  out.newInvisiblesCleaned = hidden.every(n => { const v = G.validate({ t: 'join', pid: 'AnaPhone01', name: n, nonce: NONCE_OK }); return !!v && v.name === 'A na'; });
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
  root.querySelector('#ph-code').value = 'ABCDEFGH'; root.querySelector('#ph-name').value = 'Ana';
  await submit(root.querySelector('form'));
  assert.equal(opened, 0, 'the phone did not connect'); assert.equal(room.log.length, 0, 'nothing sent');
  assert.match(root.textContent, /cannot sign the game/);
});

// 11-27 HARDENING (WORKER and CC1 reviews; GAMES picture book). The room code is SLOW on purpose: PBKDF2-HMAC-SHA-256, 300,000 rounds, of the host's raw key.
const VECTOR_PUB = 'BA' + 'A'.repeat(85), VECTOR_CODE = 'QGTSLDWH';          // worked out once with node:crypto pbkdf2Sync (and checked again below)
async function codeScenario(w) {
  const G = w.G, out = {};
  out.kdfParams = JSON.stringify(G.CODE_KDF) === JSON.stringify({ name: 'PBKDF2', hash: 'SHA-256', salt: 'ryagram-game-room-v3', iterations: 300000, bits: 256 }) && Object.isFrozen(G.CODE_KDF);
  const t0 = Date.now(); const c = await G.codeOf(VECTOR_PUB); const ms = Date.now() - t0;
  out.knownVector = c === VECTOR_CODE;
  out.eightLetters = G.CODE_LEN === 8 && /^[ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/.test(c);
  out.sixRefused = await G.connect({ kind: 'realtime', client: { channel() { throw new Error('opened'); } }, code: 'ABCDEF' }).then(() => false, e => /room code is 8 letters/.test(e.message));
  const raw = Buffer.from(VECTOR_PUB, 'base64url'), d = (await import('node:crypto')).pbkdf2Sync(raw, 'ryagram-game-room-v3', 300000, 32, 'sha256'); let want = '';
  for (const b of d) if (b < 240 && want.length < 8) want += G.CODE_LETTERS[b % 24];
  out.sameAsNodePbkdf2 = want === VECTOR_CODE && c === want;
  out.slowOnPurpose = ms >= 25;          // about 50-120 ms on the PC it was measured on; 25 ms is a floor that plain SHA-256 (well under 1 ms) can never reach
  const t1 = Date.now(); out.cached = (await G.codeOf(VECTOR_PUB)) === c && Date.now() - t1 < 20;
  return out;
}

test('MUST FAIL: codeOf is PBKDF2-HMAC-SHA-256 (salt ryagram-game-room-v3, 300,000 rounds, 256 bits), 8 letters, slow on purpose, cached per key, and gives the known vector; a 6-letter code is refused', async () => {
  assert.deepEqual(await codeScenario(world()), { kdfParams: true, knownVector: true, eightLetters: true, sixRefused: true, sameAsNodePbkdf2: true, slowOnPurpose: true, cached: true });
});

// HOST CONTROLS: Remove (kick) and Lock the room, refused in plain words through the signed welcome, lines updated in place.
async function controlsScenario(w) {
  const room = bus(w.G), root = new El('div'), host = mountHost(w, room, { root }), out = {};
  await until(() => room.from('host', 'state').length > 0);
  CODE = host.state().code;
  const settle = async () => { await sleep(10); await host.settled(); await sleep(5); await host.settled(); };
  const welcomeFor = pid => room.from('host', 'welcome').filter(m => m.pid === pid);
  const player = pid => host.state().players.find(p => p.pid === pid);
  const hostPub = host.state().pair.pub;
  try {
    const A = await fakePhone(w, room, 'a'), B = await fakePhone(w, room, 'b'), C = await fakePhone(w, room, 'c'), D = await fakePhone(w, room, 'd');
    for (const [P, n] of [[A, 'Ana'], [B, 'Ben'], [C, 'Cy']]) await P.send({ t: 'join', name: n, pub: P.pair.pub });
    await settle();
    const list = root.querySelector('#gh-player-list'), rowA = list && list.children[0], lockBtn = root.querySelector('#gh-lock');
    out.rowsShown = !!list && list.children.length === 3 && /Ana/.test(rowA.textContent) && !!rowA.querySelector('button') && /Remove/.test(rowA.querySelector('button').textContent)
      && rowA.querySelector('button').attrs['aria-label'] === 'Remove Ana' && !!lockBtn && /Lock the room/.test(lockBtn.textContent);
    // Remove Ben: dropped and told once in a signed welcome (why removed, FACES 1.3 words); when he tries again he gets NO answer and no seat (a banned pid is dropped before any check)
    host.kick(B.pid); await settle();
    const told = welcomeFor(B.pid).pop();
    out.kickTold = !!told && told.ok === false && told.why === 'removed' && told.problem === 'The host removed you from this game.' && await w.G.verify(hostPub, CODE, told) && !player(B.pid);
    const toldCount = welcomeFor(B.pid).length;
    await B.send({ t: 'join', name: 'Ben', pub: B.pair.pub }); await settle();
    out.kickedRejoinRefused = toldCount === 2 && welcomeFor(B.pid).length === toldCount && !player(B.pid);
    out.rowsInPlace = root.querySelector('#gh-player-list') === list && list.children[0] === rowA && list.children.length === 2 && !/Ben/.test(list.textContent);
    // Lock: a new player is refused in words; a seated player can still come back; Unlock lets new players in again
    host.lock(true); await settle();
    out.lockInPlace = root.querySelector('#gh-lock') === lockBtn && /Unlock the room/.test(lockBtn.textContent) && /^Locked: nobody new can join\./.test(root.querySelector('#gh-lock-note').textContent);
    await D.send({ t: 'join', name: 'Dee', pub: D.pair.pub }); await settle();
    const wd = welcomeFor(D.pid).pop();
    out.lockedRefused = !!wd && wd.ok === false && wd.why === 'locked' && wd.problem === 'The room is locked. Ask the host to unlock it.' && await w.G.verify(hostPub, CODE, wd) && !player(D.pid);
    await A.send({ t: 'join', name: 'Ana', pub: A.pair.pub }); await settle();
    out.seatedComesBackWhileLocked = welcomeFor(A.pid).pop().ok === true;
    host.lock(false); await settle();
    await D.send({ t: 'join', name: 'Dee', pub: D.pair.pub }); await settle();
    out.unlockLetsIn = welcomeFor(D.pid).pop().ok === true && !!player(D.pid);
  } catch (e) { out.crashed = String(e).slice(0, 200); }
  host.close();
  return out;
}

test('MUST FAIL: host controls: Remove drops a player and tells that pid once (signed, why removed), then gives it no answer; Lock refuses new joins in words (signed, why locked); the lines update in place', async () => {
  assert.deepEqual(await controlsScenario(world()), { rowsShown: true, kickTold: true, kickedRejoinRefused: true, rowsInPlace: true, lockInPlace: true, lockedRefused: true, seatedComesBackWhileLocked: true, unlockLetsIn: true });
});

// GHOST SEATS and the kept-key store (WORKER LOW): a refused join replayed later seats no one; cycling throwaway pids never pushes out a seated or recently-gone player's key.
async function ghostScenario(w) {
  const room = bus(w.G), host = mountHost(w, room), out = {};
  await until(() => room.from('host', 'state').length > 0);
  CODE = host.state().code;
  const settle = async () => { await sleep(10); await host.settled(); await sleep(5); await host.settled(); };
  const welcomeFor = pid => room.from('host', 'welcome').filter(m => m.pid === pid);
  const player = pid => host.state().players.find(p => p.pid === pid);
  try {
    const A = await fakePhone(w, room, 'a'), X = await fakePhone(w, room, 'x'), S = await fakePhone(w, room, 's');
    await A.send({ t: 'join', name: 'Ana', pub: A.pair.pub }); await S.send({ t: 'join', name: 'Sol', pub: S.pair.pub }); await settle();
    await X.send({ t: 'join', name: 'Ana', pub: X.pair.pub }); await settle();
    const refusedJoin = X.last;
    out.refusedFirst = welcomeFor(X.pid).length === 1 && welcomeFor(X.pid)[0].ok === false && !player(X.pid);
    // 204 later joins (A and S coming back, 3 each per 10 s) push the refused join's nonce out of the host's ring of the last 200: from here only the seq memory stops its replay
    for (let i = 0; i < 34; i++) { w.clock.off += 10100; for (let k = 0; k < 3; k++) { await A.send({ t: 'join', name: 'Ana', pub: A.pair.pub }); await S.send({ t: 'join', name: 'Sol', pub: S.pair.pub }); } await settle(); }
    const ringRolled = !host.state().nonceSeen.has(refusedJoin.nonce) && host.state().nonceRing.length === 200;
    await A.send({ t: 'leave' }); await settle();          // the name Ana is free now
    await X.end.send(refusedJoin); await settle();          // the refused join, sent again word for word
    out.replayedRefusedJoinCannotSeat = ringRolled && !player(X.pid) && welcomeFor(X.pid).length === 1;
    await X.send({ t: 'join', name: 'Ana', pub: X.pair.pub }); await settle();
    out.freshJoinStillWorks = !!player(X.pid);
    // 100 throwaway pids join and leave (the room's clock steps 61 s after every 6: the host takes at most 8 new players in 5 s, and the new-pid bucket 16 a minute): the store stays bounded (it fills at the 94th),
    // and S (who leaves at the 88th, so gone under 10 minutes when the store is full) and X (seated) keep their keys; A, gone longer than 10 minutes, may be let go
    for (let i = 0; i < 100; i++) {
      if (i % 6 === 0) w.clock.off += 61000;
      if (i === 88) { await S.send({ t: 'leave' }); await settle(); }
      const T = await fakePhone(w, room, 't' + i); await T.send({ t: 'join', name: 'T' + i, pub: T.pair.pub }); await T.send({ t: 'leave' }); T.end.close();
      if (i % 6 === 5) await settle();
    }
    await settle();
    const keys = host.state().keys;
    out.keptBounded = keys.size <= 96 && keys.size >= 90 && !!player(X.pid) && !player(S.pid);          // the store really filled (so letting go was needed)
    out.goneKeyKept = keys.has(S.pid) && keys.has(X.pid);
  } catch (e) { out.crashed = String(e).slice(0, 200); }
  host.close();
  return out;
}

test('MUST FAIL: a refused join sent again later cannot seat its pid, and 100 throwaway pids cannot push out a seated or recently-gone player\'s key', async () => {
  assert.deepEqual(await ghostScenario(world()), { refusedFirst: true, replayedRefusedJoinCannotSeat: true, freshJoinStillWorks: true, keptBounded: true, goneKeyKept: true });
});

// THE PHONE: a replayed old welcome on rejoin is refused; a kicked phone is told so; a rejoin typed in another case keeps the host's name; a new round starts with no guess.
function mountPhone(w, room, endName) {
  const root = new El('div'), P = w.W.ryagramGamePhone, H = { ...P, codeProblem: v => P.codeProblem(v, w.G.CODE_LEN) };
  const api = w.W.ryagramGamePhoneLive.mount(root, H, { ...w.G, connect: async () => room.endpoint(endName) }, { games: 'account' });
  return { root, api, text: () => root.textContent };
}
async function phoneRejoinScenario(w) {
  const timers = []; w.W.setInterval = fn => { timers.push(fn); return timers.length; };
  const room = bus(w.G), host = mountHost(w, room, { seconds: 1 }), out = {};
  await until(() => room.from('host', 'state').length > 0);
  CODE = host.state().code;
  const settle = async () => { await sleep(15); await host.settled(); await sleep(15); };
  const RQ = String.fromCharCode(0x201d);
  try {
    const Eve = await fakePhone(w, room, 'eve'), Cy = await fakePhone(w, room, 'cy');
    await Cy.send({ t: 'join', name: 'Cy', pub: Cy.pair.pub }); await settle();          // a second player who never guesses, so no round ends early
    const p1 = mountPhone(w, room, 'p1');
    p1.root.querySelector('#ph-code').value = CODE; p1.root.querySelector('#ph-name').value = 'Ben';
    await submit(p1.root.querySelector('form')); await settle();
    const pid = room.from('p1', 'join')[0].pid, w1 = room.from('host', 'welcome').filter(m => m.pid === pid)[0];
    out.joined = /You are in room/.test(p1.text()) && !!w1;
    host.start(); await until(() => !!p1.root.querySelector('#ph-guess')); await settle();
    // the page reloads (pagehide leave; the seat stays), and the player types the name in lower case
    await p1.api.leave(); await settle();
    const p2 = mountPhone(w, room, 'p2');
    room.drop = (from, to, m) => from === 'host' && to === 'p2' && m.t === 'welcome';          // the host's real welcome is held back ...
    Eve.end.onMessage(m => { if (m.t === 'join' && m.pid === pid && !Eve.sent) { Eve.sent = true; Eve.end.send(w1); } });          // ... while Eve replays the OLD real one
    p2.root.querySelector('#ph-name').value = 'ben';
    const going = submit(p2.root.querySelector('form'));
    await until(() => Eve.sent); await settle(); await sleep(100);
    out.replayedWelcomeIgnored = Eve.sent === true && !!p2.root.querySelector('#ph-code');          // still waiting at the join form
    await until(() => room.from('host', 'welcome').filter(m => m.pid === pid).length >= 2);
    room.drop = () => false;
    const real = room.from('host', 'welcome').filter(m => m.pid === pid).pop();
    room.to('p2', real); await going; await settle();
    room.to('p2', room.from('host', 'state').pop()); await settle();          // the host's next state (its clock sends one every 5 s; the clocks do not run here)
    out.rejoined = !p2.root.querySelector('#ph-code') && real.seq > w1.seq && real.name === 'Ben';
    const seat = JSON.parse(w.store.get('ryagram-game-seat') || 'null');
    out.seatKeepsHostSeq = !!seat && seat.hostSeq >= real.seq && seat.name === 'Ben';
    await until(() => !!p2.root.querySelector('#ph-guess')); await settle();
    p2.root.querySelector('#ph-guess').value = 'over the hill'; await submit(p2.root.all(e => e.tagName === 'form')[0]); await settle();
    host.reveal(); await until(() => !!p2.root.querySelector('#ph-mine')); await settle();
    if (!p2.root.querySelector('#ph-mine')) throw new Error('no reveal on the phone: ' + p2.text().slice(150, 500));
    out.rejoinOtherCaseFindsOwnScore = /^You: \d+ points/.test(p2.root.querySelector('#ph-mine').textContent);
    // round 2: this phone sends NOTHING; at time up it must not show the round-1 guess
    host.next(); await until(() => !!p2.root.querySelector('#ph-guess') && /Round 2/.test(p2.text())); await settle();
    timers[timers.length - 1]();          // the phone's own clock, one tick: 1 s left -> time is up
    out.pendingClearedOnNewRound = !/over the hill/.test(p2.root.querySelector('#ph-sent').textContent);
    // round 3: a guess that ends in a full stop is not followed by a second one
    host.reveal(); await settle(); host.next(); await until(() => /Round 3/.test(p2.text()) && !!p2.root.querySelector('#ph-guess')); await settle();
    p2.root.querySelector('#ph-guess').value = 'garden shed.'; await submit(p2.root.all(e => e.tagName === 'form')[0]); await settle();
    timers[timers.length - 1]();
    const sentLine = p2.root.querySelector('#ph-sent').textContent;
    out.timeUpNoDoubleStop = /garden shed\./.test(sentLine) && !sentLine.includes('.' + RQ + '.') && /Time is up/.test(sentLine);
  } catch (e) { out.crashed = String(e).slice(0, 200); }
  host.close();
  return out;
}

test('MUST FAIL: the PHONE refuses a replayed old welcome on rejoin, keeps the highest host seq in its seat, takes the host\'s name for itself (ben for Ben), and starts each round with no guess', async () => {
  assert.deepEqual(await phoneRejoinScenario(world()), { joined: true, replayedWelcomeIgnored: true, rejoined: true, seatKeepsHostSeq: true, rejoinOtherCaseFindsOwnScore: true, pendingClearedOnNewRound: true, timeUpNoDoubleStop: true });
});

async function phoneKickScenario(w) {
  const room = bus(w.G), host = mountHost(w, room), out = {};
  await until(() => room.from('host', 'state').length > 0);
  CODE = host.state().code;
  const settle = async () => { await sleep(15); await host.settled(); await sleep(15); };
  try {
    const p = mountPhone(w, room, 'p');
    p.root.querySelector('#ph-code').value = CODE; p.root.querySelector('#ph-name').value = 'Ana';
    await submit(p.root.querySelector('form')); await settle();
    out.joined = /You are in room/.test(p.text());
    const pid = room.from('p', 'join')[0].pid;
    host.kick(pid); await settle(); await settle();
    const back = p.root.querySelector('#ph-back');
    const removedShown = /The host removed you from this game\./.test(p.root.querySelector('#ph-removed') ? p.root.querySelector('#ph-removed').textContent : '') && !!back && back.textContent === 'Back' && !p.root.querySelector('#ph-code') && !w.store.get('ryagram-game-seat');
    if (back) await press(back);
    out.phoneToldRemoved = removedShown && !!p.root.querySelector('#ph-code');          // Back goes to the code screen
    out.titleReset = p.root.querySelector('#ph-title').textContent === 'Guess the next line';
  } catch (e) { out.crashed = String(e).slice(0, 200); }
  host.close();
  return out;
}

test('MUST FAIL: a phone the host removes is told so in plain words (FACES 1.3) with a Back button to the join form, and keeps no seat', async () => {
  assert.deepEqual(await phoneKickScenario(world()), { joined: true, phoneToldRemoved: true, titleReset: true });
});

// RED TEAM 6a / 9e and the 11-27 holds (FACES 3.1-3.2): room-wide limits on the real room library. A burst of fresh-key joins gets at most 6 new pids a minute (the rest
// dropped unanswered); once the 8 seats are full a stranger's join gets a cheap 'full' refusal with NO signature check, at most one per 2 s for the whole room; a removed pid
// gets no answer at all; a seated player flooding signed guesses gets at most 2 taken per second and at most one 'got' waiting.
async function floodScenario(w) {
  const room = bus(w.G), verified = [];
  const host = mountHost(w, room, { Room: { verify: (pub, code, m) => { verified.push(m && m.pid); return w.G.verify(pub, code, m); } } }), out = {};
  await until(() => room.from('host', 'state').length > 0);
  CODE = host.state().code;
  const settle = async () => { await sleep(10); await host.settled(); await sleep(5); await host.settled(); };
  const player = pid => host.state().players.find(p => p.pid === pid);
  const answersTo = L => room.from('host', 'welcome').filter(m => L.some(F => F.pid === m.pid));
  const phones = async (tag, n) => { const L = []; for (let i = 0; i < n; i++) L.push(await fakePhone(w, room, tag + i)); return L; };
  try {
    const A = await fakePhone(w, room, 'a'), B = await fakePhone(w, room, 'b');
    await A.send({ t: 'join', name: 'Ana', pub: A.pair.pub }); await B.send({ t: 'join', name: 'Ben', pub: B.pair.pub }); await settle();
    // 30 new pids at one instant, all with a reserved name (refused only AFTER a signature check): the new-pid bucket (16 a minute; A and B took 2) lets 14 through
    // (15 if the real clock under the test adds a token), so at most 15 cost a check; without the bucket the verify bucket (20) is the only cap
    const burst = await phones('f', 30);
    for (const F of burst) await F.send({ t: 'join', name: 'Host', pub: F.pair.pub });
    await settle();
    const burstVerified = burst.filter(F => verified.includes(F.pid)).length;
    // a minute on: 6 new pids fill the 8 seats; another minute on: 6 more, all to a full room
    w.clock.off += 61000;
    const more = await phones('g', 6);
    for (const [i, F] of more.entries()) await F.send({ t: 'join', name: 'More' + i, pub: F.pair.pub });
    await settle();
    w.clock.off += 61000;
    const more2 = await phones('k', 6);
    for (const [i, F] of more2.entries()) await F.send({ t: 'join', name: 'Late' + i, pub: F.pair.pub });
    await settle();
    const extras = more2;
    out.roomJoinLimit = burstVerified >= 13 && burstVerified <= 15 && !burst.some(F => player(F.pid)) && more.every(F => player(F.pid)) && host.state().players.length === 8 && !extras.some(F => player(F.pid))
      && answersTo(extras).length >= 1 && answersTo(extras).every(m => m.ok === false && m.why === 'full' && /^Room is full\. All 8 seats are taken\./.test(m.problem))
      && extras.filter(F => verified.includes(F.pid)).length <= Math.min(1, answersTo(extras).length);          // a stranger on a full room costs a check only when its refusal is answered (one per 2 s)
    // refusals: one per 2 s for the whole room (each batch above came at one instant of the room's clock); a removed pid gets no answer and no signature check
    const inFakes = more.filter(F => player(F.pid));
    for (const F of inFakes) host.kick(F.pid);
    await settle();
    const before = room.from('host', 'welcome').length, v0 = verified.length;
    for (const F of inFakes) { await F.send({ t: 'join', name: 'Again', pub: F.pair.pub }); await F.send({ t: 'join', name: 'Again', pub: F.pair.pub }); }
    await settle();
    out.refusalsCapped = answersTo(more2).length === 1
      && inFakes.length === 6 && room.from('host', 'welcome').length === before && verified.length === v0 && !inFakes.some(F => player(F.pid));
    host.start(); await settle();
    const gotsBefore = room.from('host', 'got').length;
    for (let i = 0; i < 30; i++) await A.send({ t: 'guess', round: 0, text: 'flood ' + i });
    await settle();
    out.guessRateLimit = host.state().guesses.get(A.pid) === 'flood 1' && room.from('host', 'got').length - gotsBefore <= 2;
    w.clock.off += 1100;
    await A.send({ t: 'guess', round: 0, text: 'a real one' }); await settle();
    out.guessAfterASecond = host.state().guesses.get(A.pid) === 'a real one';
  } catch (e) { out.crashed = String(e).slice(0, 200); }
  host.close();
  return out;
}

test('MUST FAIL: room-wide limits: at most 16 new pids a minute, a full room refuses strangers with no signature check and at most one refusal per 2 s, a removed pid gets no answer, at most 2 guesses per pid per second', async () => {
  assert.deepEqual(await floodScenario(world()), { roomJoinLimit: true, refusalsCapped: true, guessRateLimit: true, guessAfterASecond: true });
});

// RED TEAM 7: names that show as nothing, look-alikes from other scripts, punctuation and piled-up marks.
async function names2Scenario(w) {
  const H = w.W.ryagramGamesHost, out = {}, players = [{ pid: 'AnaPhone01', name: 'Ana' }];
  const ch = c => String.fromCodePoint(c), blank = /do not show/;
  out.blankRefused = [ch(0x3164), ch(0xffa0), ch(0x115f) + 'x', ch(0x1160), ch(0x2800), 'Ben' + ch(0xe0041), 'Ben' + ch(0xfff9) + 'x' + ch(0xfffb), 'B' + ch(0x200b) + 'en', '...', '!!'].every(n => blank.test(H.nameProblem(n, players) || ''));
  out.marksCapped = blank.test(H.nameProblem('Be' + ch(0x301) + ch(0x302) + ch(0x303) + ch(0x304) + 'n', players) || '') && H.nameProblem('Zo' + ch(0xeb), players) === null;
  out.cyrillicSame = /already has that name/.test(H.nameProblem(ch(0x410) + 'n' + ch(0x430), players) || '');
  out.punctuationSame = /already has that name/.test(H.nameProblem('Ana!', players) || '') && /already has that name/.test(H.nameProblem('A.n.a', players) || '');
  out.reservedSkeleton = ['h' + ch(0x43e) + 'st', 'Admin!', 'ry-agram', ch(0x4bb) + 'ost', ch(0x280) + 'yagram', 'ADM' + ch(0x130) + 'N'].every(n => /kept for the game/.test(H.nameProblem(n, players) || ''));
  out.plainOk = ['Ben', 'Hostess', 'Zoe 2'].every(n => H.nameProblem(n, players) === null);
  return out;
}

test('MUST FAIL: names: blank-looking characters, no letter or digit, more than 2 marks are refused; Cyrillic look-alikes and punctuation count as the same name; kept names too', async () => {
  assert.deepEqual(await names2Scenario(world()), { blankRefused: true, marksCapped: true, cyrillicSame: true, punctuationSame: true, reservedSkeleton: true, plainOk: true });
});

// 11-27 v3 (holds contract section 1; FACES design sections 3 and 4): the join/welcome NONCE, the refusal reason (why), the 'closed' phase, showCode, and the RATE LIMITS
// (makeLimits, on a fake clock as in FACES 3.6). Pure checks on the room library; each is also run against the mutants below.
const NONCE_OK = 'AnaNonce_0123456789-xy';          // 22 base64url characters, invented
async function nonceScenario(w) {
  const G = w.G, out = {};
  const join = { t: 'join', pid: 'AnaPhone01', name: 'Ana' }, welcome = { t: 'welcome', pid: 'AnaPhone01', ok: true };
  out.joinNeedsNonce = G.validate(join) === null && !!G.validate({ ...join, nonce: NONCE_OK });
  out.welcomeNeedsNonce = G.validate(welcome) === null && !!G.validate({ ...welcome, nonce: NONCE_OK }) && G.validate({ ...welcome, ok: false, why: 'full' }) === null;
  const badNonces = [NONCE_OK.slice(1), NONCE_OK + 'A', NONCE_OK.slice(1) + '+', NONCE_OK.slice(1) + '/', NONCE_OK.slice(1) + '=', NONCE_OK.slice(1) + ' ', NONCE_OK.slice(1) + '.', 'A'.repeat(43), '', 22, null];
  out.nonceFormat = badNonces.every(n => G.validate({ ...join, nonce: n }) === null && G.validate({ ...welcome, nonce: n }) === null);
  const made = Array.from({ length: 50 }, () => G.newNonce());
  out.newNonceFormat = made.every(n => /^[A-Za-z0-9_-]{22}$/.test(n) && !!G.validate({ ...join, nonce: n })) && new Set(made).size === 50;
  // the nonce is inside the signature, and the signature label is ryagram-game-sig-2 (worked out here with node's own WebCrypto, not through game-room.js)
  const a = await G.keyPair(), pid = await G.pidOf(a.pub);
  const j = await G.sign(a, 'ABCDEFGH', { t: 'join', pid, name: 'Ana', nonce: NONCE_OK, pub: a.pub, seq: 1 });
  out.nonceSigned = (await G.verify(a.pub, 'ABCDEFGH', j)) && !(await G.verify(a.pub, 'ABCDEFGH', { ...j, nonce: 'BenNonce_0123456789-xy' }));
  const subtle = globalThis.crypto.subtle, key = await subtle.importKey('jwk', J(a.jwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signAs = async label => {
    const v = J(G.validate(j)); delete v.sig;
    const bytes = new TextEncoder().encode(label + '\nABCDEFGH\n' + JSON.stringify(Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]))));
    return { ...j, sig: Buffer.from(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes)).toString('base64url') };
  };
  out.sigLabel2 = (await G.verify(a.pub, 'ABCDEFGH', await signAs('ryagram-game-sig-2'))) && !(await G.verify(a.pub, 'ABCDEFGH', await signAs('ryagram-game-sig-1')));
  return out;
}

test('MUST FAIL: nonce: join and welcome need a 22-character base64url nonce, newNonce makes one (different each time), the nonce is signed, and the label is ryagram-game-sig-2', async () => {
  assert.deepEqual(await nonceScenario(world()), { joinNeedsNonce: true, welcomeNeedsNonce: true, nonceFormat: true, newNonceFormat: true, nonceSigned: true, sigLabel2: true });
});

async function whyScenario(w) {
  const G = w.G, out = {};
  const wel = x => G.validate({ t: 'welcome', pid: 'AnaPhone01', ok: false, nonce: NONCE_OK, ...x });
  out.welcomeWhyValues = ['removed', 'full', 'locked', 'started', 'name', 'closed'].every(why => !!wel({ why }) && wel({ why }).why === why);
  out.welcomeWhyOthersRefused = ['banned', 'Full', 'idle', 'newcode', '', ' full', 7, true].every(why => wel({ why }) === null);
  out.whyOnlyOnRefusal = wel({ ok: true, why: 'full' }) === null && !!wel({ ok: true }) && !!wel({});
  const st = x => G.validate({ t: 'state', phase: 'closed', round: 0, of: 5, players: [], ...x });
  out.closedPhase = !!st({}) && st({}).phase === 'closed' && !!st({ players: ['Ana'] });
  out.closedWhyValues = ['idle', 'host', 'newcode'].every(why => !!st({ why }) && st({ why }).why === why) && ['removed', 'full', 'Idle', '', 3].every(why => st({ why }) === null);
  out.whyOnlyWhenClosed = ['lobby', 'question', 'reveal', 'final'].every(phase => st({ phase, why: 'idle' }) === null && !!st({ phase }));
  out.showCode = G.showCode('abcdefgh') === 'ABCD EFGH' && G.showCode('ABCD-EFGH') === 'ABCD EFGH' && G.normCode(G.showCode('WXYZABCD')) === 'WXYZABCD';
  return out;
}

test('MUST FAIL: why: a refusal welcome may say removed/full/locked/started/name/closed (nothing else, never on ok), a closed state may say idle/host/newcode (only when closed); showCode is ABCD EFGH', async () => {
  assert.deepEqual(await whyScenario(world()), { welcomeWhyValues: true, welcomeWhyOthersRefused: true, whyOnlyOnRefusal: true, closedPhase: true, closedWhyValues: true, whyOnlyWhenClosed: true, showCode: true });
});

// RATE LIMITS on a fake clock (FACES 3.1 table): each bucket on its own makeLimits so one bucket's clock steps cannot refill another's test.
async function limitsScenario(w) {
  const G = w.G, out = {};
  const fresh = () => { let t = 5000; return { L: G.makeLimits({ now: () => t }), step: ms => { t += ms; }, back: ms => { t -= ms; } }; };
  const takeN = (f, n) => { let k = 0; for (let i = 0; i < n; i++) if (f()) k++; return k; };
  { const { L, step } = fresh(); out.roomBucket = takeN(L.room, 100) === 60 && (step(34), takeN(L.room, 5) === 1) && (step(1000), takeN(L.room, 100) === 30); }
  { const { L, step } = fresh(); const A = () => L.pid('A'); out.pidBucket = takeN(A, 10) === 6 && (step(334), takeN(A, 5) === 1) && (step(1000), takeN(A, 10) === 3); }
  { const { L, step } = fresh(); const A = () => L.guess('A'); out.guessBucket = takeN(A, 10) === 3 && (step(500), takeN(A, 5) === 0) && (step(500), takeN(A, 5) === 1); }
  { const { L } = fresh(); out.pidsIndependent = takeN(() => L.pid('A'), 10) === 6 && takeN(() => L.pid('B'), 10) === 6 && takeN(() => L.guess('A'), 10) === 3 && takeN(() => L.guess('B'), 10) === 3; }
  { const { L, step } = fresh(); out.newPidBucket = takeN(L.newPid, 30) === 16 && (step(3000), takeN(L.newPid, 5) === 0) && (step(1000), takeN(L.newPid, 5) === 1) && (step(60000), takeN(L.newPid, 30) === 16); }
  { const { L, step } = fresh(); out.verifyBucket = takeN(L.verify, 50) === 20 && (step(50), takeN(L.verify, 5) === 1) && (step(1000), takeN(L.verify, 50) === 20); }
  { const { L, step } = fresh(); out.refusalBucket = takeN(L.refusal, 5) === 1 && (step(1000), takeN(L.refusal, 5) === 0) && (step(1000), takeN(L.refusal, 5) === 1) && (step(10000), takeN(L.refusal, 5) === 1); }
  { const { L, step, back } = fresh(); const A = () => L.pid('A'); out.clockBackGivesNothing = takeN(A, 10) === 6 && (back(60000), takeN(A, 5) === 0) && (step(60000 + 334), takeN(A, 5) === 1); }
  // bounded: 1000 made-up pids keep at most LIMIT_PIDS (200) in each per-pid table
  { const { L } = fresh(); for (let i = 0; i < 1000; i++) { L.pid('Fake' + i); L.guess('Fake' + i); } const n = L.tracked(); out.boundedPids = G.LIMIT_PIDS === 200 && n.pid === 200 && n.guess === 200; }
  // the one let go is the one used LONGEST ago: a drained pid that keeps sending stays drained while a flood of new pids passes through
  { const { L } = fresh(); const Z = () => L.pid('Zed');
    takeN(Z, 10); for (let i = 0; i < 199; i++) L.pid('Fake' + i); const stillOut = !Z(); for (let i = 199; i < 299; i++) L.pid('Fake' + i);
    out.recentPidKept = stillOut && !Z(); }
  // real use: 8 phones, one guess a second each, for 60 s of fake time: nothing dropped
  { const { L, step } = fresh(); let ok = true;
    for (let s = 0; s < 60; s++) { step(1000); for (let p = 0; p < 8; p++) ok = L.room() && L.pid('Phone' + p) && L.guess('Phone' + p) && L.verify() && ok; }
    out.realUseFits = ok; }
  // with no clock given it uses the page's own clock
  { const L = G.makeLimits(); out.defaultClock = L.room() === true && L.pid('A') === true && Object.isFrozen(L); }
  return out;
}

test('MUST FAIL: rate limits (fake clock): room 60/30 per s, pid 6/3 per s, guess 3/1 per s, new pids 16 a minute, verifies 20 per s, refusals 1 per 2 s; per-pid tables hold at most 200; real use fits', async () => {
  assert.deepEqual(await limitsScenario(world()), { roomBucket: true, pidBucket: true, guessBucket: true, pidsIndependent: true, newPidBucket: true, verifyBucket: true, refusalBucket: true,
    clockBackGivesNothing: true, boundedPids: true, recentPidKept: true, realUseFits: true, defaultClock: true });
});

// PARTY (GEO A, round 2 11-27): a real party of 8 phones joins at one instant (no clock step at all) and all 8 are seated. With the old new-pid bucket of 6 a minute
// two of them would have seen 'No room with that code answered'.
async function partyScenario(w) {
  const room = bus(w.G), host = mountHost(w, room), out = {};
  await until(() => room.from('host', 'state').length > 0);
  CODE = host.state().code;
  const settle = async () => { await sleep(10); await host.settled(); await sleep(5); await host.settled(); };
  try {
    const L = [];
    for (let i = 0; i < 8; i++) L.push(await fakePhone(w, room, 'party' + i));
    for (const [i, F] of L.entries()) await F.send({ t: 'join', name: 'Guest' + i, pub: F.pair.pub });
    await settle();
    out.allEightSeated = host.state().players.length === 8 && L.every(F => host.state().players.some(p => p.pid === F.pid));
    out.allAnsweredYes = L.every(F => room.from('host', 'welcome').some(m => m.pid === F.pid && m.ok === true));
  } catch (e) { out.crashed = String(e).slice(0, 200); }
  host.close();
  return out;
}

test('MUST FAIL: a party of 8 phones joining at one instant (no clock step) are all seated', async () => {
  assert.deepEqual(await partyScenario(world()), { allEightSeated: true, allAnsweredYes: true });
});

// Each mutant takes ONE check out (in memory only); the scenario must then report that forgery as getting through. A mutant that changes nothing would fail on its own text check.
const HOST = 'assets/app-games.js', PHONE = 'assets/game-phone-live.js', ROOMJS = 'assets/game-room.js';
const MUTANTS = [
  { name: 'host: no signature check', file: HOST, edits: [['if (!(await Room.verify(pub, s.code, m))) return;', '']], scenario: hostScenario, caught: ['forgedGuessRefused', 'forgedLeaveRefused'] },
  { name: 'host: no seq check', file: HOST, edits: [['if (known && m.seq <= known.seq) return;', ''], ['(now.pub !== pub || m.seq <= now.seq)', '(now.pub !== pub)'], ['if (m.seq <= lastSeqOf(m.pid)) return;', ''], ['|| m.seq <= lastSeqOf(m.pid)) return;', ') return;']], scenario: hostScenario, caught: ['replayedLeaveRefused', 'replayedGuessRefused'] },
  { name: 'host: no pid-from-key check', file: HOST, edits: [['if ((await Room.pidOf(m.pub)) !== m.pid) return;', '']], scenario: hostScenario, caught: ['pidMismatchRefused'] },
  { name: 'host: unsigned messages taken', file: HOST, edits: [["if (s.closed || !['join', 'guess', 'leave'].includes(m.t) || !Number.isInteger(m.seq)) return;", "if (s.closed) return; if (!Number.isInteger(m.seq)) { onMessage(m); return; }"]], scenario: hostScenario, caught: ['unsignedJoinRefused', 'unsignedGuessRefused'] },
  { name: 'phone: host messages not verified', file: PHONE, edits: [['if (!(await Room.verify(s.hostPub, s.code, m)) || m.seq <= s.hostSeq) return false;', '']], scenario: phoneScenario, caught: ['forgedStateRefused', 'forgedGotRefused'] },
  { name: 'phone: host seq not checked', file: PHONE, edits: [['if (!s.hostPub || !Number.isInteger(m.seq) || m.seq <= s.hostSeq) return false;', 'if (!s.hostPub) return false;'], ['if (!(await Room.verify(s.hostPub, s.code, m)) || m.seq <= s.hostSeq) return false;', 'if (!(await Room.verify(s.hostPub, s.code, m))) return false;']], scenario: phoneScenario, caught: ['replayedStateRefused'] },
  { name: 'phone: host key pinned from whoever answers first (no code check)', file: PHONE, edits: [['Room.codeOf(m.pub).then(c => c === s.code, () => false)', 'Promise.resolve(true)']], scenario: phoneScenario, caught: ['strangerWelcomeIgnored'] },
  { name: 'host: no join rate limit', file: HOST, edits: [['if (!joinAllowed(m.pid)) return;', '']], scenario: hostScenario, caught: ['joinRateLimited'] },
  { name: 'host: refused joins remembered', file: HOST, edits: [['if (now || seated(m.pid)) remember(m.pid, pub, m.seq);', 'remember(m.pid, pub, m.seq);']], scenario: hostScenario, caught: ['refusedJoinsKeepNoKey'] },
  { name: 'host: names compared without NFKC', file: HOST, edits: [['if (players.some(p => fold(p.name) === fold(name)))', 'if (players.some(p => p.name.toLowerCase() === name.toLowerCase()))']], scenario: namesScenario, caught: ['fullWidthSame', 'ligatureSame'] },
  { name: 'host: no reserved names', file: HOST, edits: [["if (RESERVED_NAMES.includes(fold(name).trim()))", 'if (false)']], scenario: namesScenario, caught: ['reservedRefused'] },
  { name: 'room: invisible set without the four new characters', file: ROOMJS, edits: [['\\u00ad\\u034f\\u061c\\u180e', '']], scenario: namesScenario, caught: ['newInvisiblesCleaned'] },
  { name: 'room: verify says yes to anything signed', file: ROOMJS, edits: [['return await subtle().verify(SIGN_ALG, key, sig, bytes);', 'return true;']], scenario: hostScenario, caught: ['forgedGuessRefused', 'forgedLeaveRefused'] },
  // 11-27 hardening
  { name: 'room: the code from plain SHA-256 (the old fast code)', file: ROOMJS, edits: [["new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(CODE_SALT), iterations: CODE_ITERATIONS }, base, 256))", "new Uint8Array(await subtle().digest('SHA-256', raw))"]], scenario: codeScenario, caught: ['knownVector', 'sameAsNodePbkdf2', 'slowOnPurpose'] },
  // 11-27 holds: the removed-pid check is now s.banned, dropped before any check (and again after the signature, and in onMessage): all three go
  { name: 'host: a removed pid let back in', file: HOST, edits: [['if (s.banned.has(m.pid)) return;', ''], ['if (s.closed || s.banned.has(m.pid)) return;', 'if (s.closed) return;']], scenario: controlsScenario, caught: ['kickedRejoinRefused'] },
  { name: 'host: the lock ignored', file: HOST, edits: [['if (s.locked && !s.keys.has(m.pid)) { welcome(m.pid, false, LOCKED_TEXT); return; }', ''], ["s.locked ? 'locked' : ", '']], scenario: controlsScenario, caught: ['lockedRefused'] },          // 11-27: a new pid is refused before the signature (checked), a known one in onMessage
  { name: 'host: a refused join not remembered (ghost seat)', file: HOST, edits: [['if (m.seq <= lastSeqOf(m.pid)) return;', ''], ['|| m.seq <= lastSeqOf(m.pid)) return;', ') return;']], scenario: ghostScenario, caught: ['replayedRefusedJoinCannotSeat'] },
  { name: 'host: kept keys let go oldest first, recently gone or not', file: HOST, edits: [['for (const [p] of old) { s.keys.delete(p); if (s.keys.size < KEEP_KEYS) return true; }', 'for (const [p] of [...s.keys].filter(([p]) => !seated(p))) { s.keys.delete(p); return true; }']], scenario: ghostScenario, caught: ['goneKeyKept'] },
  // 11-27 holds: the phone also drops a welcome that does not echo one of its own nonces (FACES 4), which alone stops this replay; the mutant takes out both guards
  { name: 'phone: a rejoin takes an old welcome (no host seq check)', file: PHONE, edits: [['if (!Number.isInteger(m.seq) || m.seq <= s.hostSeq) return;', ''], ['if (!ourNonce(m.nonce)) return;', '']], scenario: phoneRejoinScenario, caught: ['replayedWelcomeIgnored'] },
  { name: 'phone: the name from the welcome not taken', file: PHONE, edits: [['s.welcomed = true; if (m.name) s.name = m.name; }', 's.welcomed = true; }']], scenario: phoneRejoinScenario, caught: ['rejoinOtherCaseFindsOwnScore'] },
  { name: 'phone: the last round\'s guess kept into a new round', file: PHONE, edits: [["s.sentText = ''; s.pending = '';", "s.sentText = '';"]], scenario: phoneRejoinScenario, caught: ['pendingClearedOnNewRound'] },
  { name: 'phone: the time-up line adds a stop after the quote', file: PHONE, edits: [['}' + String.fromCharCode(0x201d) + '${stopAfter(s.pending)} Time is up.`', '}' + String.fromCharCode(0x201d) + '. Time is up.`']], scenario: phoneRejoinScenario, caught: ['timeUpNoDoubleStop'] },
  { name: 'phone: a removal from the host ignored', file: PHONE, edits: [["else if (m.t === 'welcome' && m.pid === s.pid && s.welcomed && m.ok === false && m.pub === s.hostPub && m.nonce === s.seatNonce) { if (await fromHost(m)) notIn(m); }", '']], scenario: phoneKickScenario, caught: ['phoneToldRemoved'] },
  // 11-27 holds: the old room-wide join window (8 new pids per 5 s, after the signature) can no longer be reached: the new-pid bucket (6 a minute, before it) is the
  // limit now, so the mutant is on that bucket. Likewise the refusals a stranger can draw are capped by lim.refusal (one per 2 s), so that is the one taken out.
  { name: 'host: no room-wide join limit (the new-pid bucket)', file: HOST, edits: [['if (!lim.newPid()) { strike(); return; }', '']], scenario: floodScenario, caught: ['roomJoinLimit'] },
  { name: 'host: a stranger on a full room verified (no cheap refusal)', file: HOST, edits: [['if (why) { strike(); await refuseUnknown(m, why); return; }', '']], scenario: floodScenario, caught: ['roomJoinLimit'] },
  { name: 'host: refusals not capped', file: HOST, edits: [['if (!lim.refusal() || !lim.verify()) return;', 'if (!lim.verify()) return;']], scenario: floodScenario, caught: ['refusalsCapped'] },
  { name: 'host: no guess rate limit', file: HOST, edits: [["if (m.t === 'guess' && !guessAllowed(m.pid)) return; ", '']], scenario: floodScenario, caught: ['guessRateLimit'] },
  { name: 'host: blank-looking names let in', file: HOST, edits: [['BLANKISH.test(name) || ', '']], scenario: names2Scenario, caught: ['blankRefused'] },
  { name: 'host: no look-alike map', file: HOST, edits: [['const i = LOOK_FROM.indexOf(c); return i >= 0 ? LOOK_TO[i] : c;', 'return c;']], scenario: names2Scenario, caught: ['cyrillicSame', 'reservedSkeleton'] },
  // 11-27 v3 (holds contract section 1): the 8-letter code, the nonce, why, closed, and every rate-limit bucket
  { name: 'room: the 6-letter code again', file: ROOMJS, edits: [['const CODE_LEN = 8, MAX_BYTES', 'const CODE_LEN = 6, MAX_BYTES']], scenario: codeScenario, caught: ['knownVector', 'eightLetters', 'sixRefused'] },
  { name: 'room: the v2 salt (a 6-letter build could meet an 8-letter one)', file: ROOMJS, edits: [["'ryagram-game-room-v3', CODE_ITERATIONS", "'ryagram-game-room-v2', CODE_ITERATIONS"]], scenario: codeScenario, caught: ['kdfParams', 'knownVector', 'sameAsNodePbkdf2'] },
  { name: 'room: a join without a nonce taken', file: ROOMJS, edits: [['join: { need: { pid, name, nonce }, may: WITH_PUB },', 'join: { need: { pid, name }, may: { nonce, ...WITH_PUB } },']], scenario: nonceScenario, caught: ['joinNeedsNonce'] },
  { name: 'room: a welcome without a nonce taken', file: ROOMJS, edits: [["ok: v => typeof v === 'boolean' ? v : BAD, nonce }, may: { problem:", "ok: v => typeof v === 'boolean' ? v : BAD }, may: { nonce, problem:"]], scenario: nonceScenario, caught: ['welcomeNeedsNonce'] },
  { name: 'room: a nonce of any length', file: ROOMJS, edits: [['const NONCE = /^[A-Za-z0-9_-]{22}$/;', 'const NONCE = /^[A-Za-z0-9_-]{8,64}$/;']], scenario: nonceScenario, caught: ['nonceFormat'] },
  { name: 'room: a nonce of any characters', file: ROOMJS, edits: [['const NONCE = /^[A-Za-z0-9_-]{22}$/;', 'const NONCE = /^.{22}$/;']], scenario: nonceScenario, caught: ['nonceFormat'] },
  { name: 'room: newNonce from 12 bytes', file: ROOMJS, edits: [['crypto.getRandomValues(new Uint8Array(16))', 'crypto.getRandomValues(new Uint8Array(12))']], scenario: nonceScenario, caught: ['newNonceFormat'] },
  { name: 'room: the nonce left out of the signature', file: ROOMJS, edits: [['delete v.sig;', 'delete v.sig; delete v.nonce;']], scenario: nonceScenario, caught: ['nonceSigned'] },
  { name: 'room: the old signature label', file: ROOMJS, edits: [["'ryagram-game-sig-2\\n'", "'ryagram-game-sig-1\\n'"]], scenario: nonceScenario, caught: ['sigLabel2'] },
  { name: 'room: a welcome why of any short text', file: ROOMJS, edits: [['why: v => (WELCOME_WHY.includes(v) ? v : BAD)', 'why: v => text(v, 0, 20)']], scenario: whyScenario, caught: ['welcomeWhyOthersRefused'] },
  { name: 'room: why on an ok welcome taken', file: ROOMJS, edits: [['also: m => m.why === undefined || m.ok === false },', '},']], scenario: whyScenario, caught: ['whyOnlyOnRefusal'] },
  { name: "room: no 'closed' phase", file: ROOMJS, edits: [["'final', 'closed'];", "'final'];"]], scenario: whyScenario, caught: ['closedPhase', 'closedWhyValues'] },
  { name: 'room: a closed why of any short text', file: ROOMJS, edits: [['why: v => (CLOSED_WHY.includes(v) ? v : BAD)', 'why: v => text(v, 0, 20)']], scenario: whyScenario, caught: ['closedWhyValues'] },
  { name: 'room: why on a state of any phase', file: ROOMJS, edits: [["also: m => m.why === undefined || m.phase === 'closed',", '']], scenario: whyScenario, caught: ['whyOnlyWhenClosed'] },
  { name: 'room: showCode with no space', file: ROOMJS, edits: [["n.slice(0, 4) + ' ' + n.slice(4)", 'n']], scenario: whyScenario, caught: ['showCode'] },
  { name: 'limits: room bucket holds 600', file: ROOMJS, edits: [['room: Object.freeze({ cap: 60,', 'room: Object.freeze({ cap: 600,']], scenario: limitsScenario, caught: ['roomBucket'] },
  { name: 'limits: pid bucket holds 60', file: ROOMJS, edits: [['pid: Object.freeze({ cap: 6,', 'pid: Object.freeze({ cap: 60,']], scenario: limitsScenario, caught: ['pidBucket', 'pidsIndependent'] },
  { name: 'limits: guess bucket refills 10 per s', file: ROOMJS, edits: [['guess: Object.freeze({ cap: 3, n: 1,', 'guess: Object.freeze({ cap: 3, n: 10,']], scenario: limitsScenario, caught: ['guessBucket'] },
  { name: 'limits: the new-pid bucket back to 6 (a party of 8 is cut)', file: ROOMJS, edits: [['newPid: Object.freeze({ cap: 16, n: 16, ms: 60000 })', 'newPid: Object.freeze({ cap: 6, n: 6, ms: 60000 })']], scenario: partyScenario, caught: ['allEightSeated', 'allAnsweredYes'] },
  { name: 'limits: new pids refill every second, not every minute', file: ROOMJS, edits: [['newPid: Object.freeze({ cap: 16, n: 16, ms: 60000 })', 'newPid: Object.freeze({ cap: 16, n: 16, ms: 1000 })']], scenario: limitsScenario, caught: ['newPidBucket'] },
  { name: 'limits: verify bucket holds 200', file: ROOMJS, edits: [['verify: Object.freeze({ cap: 20,', 'verify: Object.freeze({ cap: 200,']], scenario: limitsScenario, caught: ['verifyBucket'] },
  { name: 'limits: a refusal every 0.2 s', file: ROOMJS, edits: [['refusal: Object.freeze({ cap: 1, n: 1, ms: 2000 })', 'refusal: Object.freeze({ cap: 1, n: 1, ms: 200 })']], scenario: limitsScenario, caught: ['refusalBucket'] },
  { name: 'limits: buckets never refill', file: ROOMJS, edits: [['tokens = Math.min(spec.cap, tokens + (t - last) * spec.n / spec.ms); last = t;', 'last = t;']], scenario: limitsScenario, caught: ['roomBucket', 'pidBucket', 'newPidBucket', 'refusalBucket', 'realUseFits'] },
  { name: 'limits: buckets refill past their cap', file: ROOMJS, edits: [['Math.min(spec.cap, tokens + (t - last) * spec.n / spec.ms)', 'tokens + (t - last) * spec.n / spec.ms']], scenario: limitsScenario, caught: ['refusalBucket'] },
  { name: 'limits: a clock that goes back gives tokens', file: ROOMJS, edits: [['if (t > last) { tokens = Math.min(spec.cap, tokens + (t - last) * spec.n / spec.ms); last = t; }', '{ tokens = Math.min(spec.cap, tokens + Math.abs(t - last) * spec.n / spec.ms); last = t; }']], scenario: limitsScenario, caught: ['clockBackGivesNothing'] },
  { name: 'limits: per-pid tables unbounded', file: ROOMJS, edits: [['while (map.size > LIMIT_PIDS) map.delete(map.keys().next().value);', '']], scenario: limitsScenario, caught: ['boundedPids'] },
  { name: 'limits: one bucket shared by every pid', file: ROOMJS, edits: [['const key = String(p);', "const key = '';"]], scenario: limitsScenario, caught: ['pidsIndependent'] },
  { name: 'limits: per-pid tables let go the oldest made, not the longest unused', file: ROOMJS, edits: [['if (b) map.delete(key);', 'if (b) { /* not moved */ }']], scenario: limitsScenario, caught: ['recentPidKept'] },
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
