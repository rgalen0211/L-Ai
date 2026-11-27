// GAMES 11-27: the ROOM for a live round of Guess the next line (assets/game-room.js) and its test-only relay (tools/game-relay.mjs). These tests prove the room code rules, that every
// message kind is checked (unknown fields dropped, strings cleaned, anything out of range or too big refused), the Supabase Realtime wiring against a FAKE client (channel name, self:false,
// subscribe outcomes, own messages never coming back), that the relay refuses anything not on this computer, and one end-to-end round trip through the real relay started as a child.
// All names and text here are invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const J = x => JSON.parse(JSON.stringify(x));
const SRC = read('assets/game-room.js');

function load(extra = {}) {
  const win = {};
  vm.runInNewContext(SRC, { window: win, crypto: webcrypto, URL, TextEncoder, location: { hostname: '127.0.0.1' }, ...extra });
  return win.ryagramGameRoom;
}
const R = load();
const PID_A = 'AnaPhone01', PID_B = 'BenPhone02';

// A tiny EventSource over node http: enough for the relay (open, message, error, close).
class TinyEventSource {
  constructor(url) {
    this.listeners = { open: [], message: [], error: [] };
    this.req = http.get(url, res => {
      if (res.statusCode !== 200) { res.resume(); return this.fire('error', {}); }
      this.fire('open', {});
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2);
          const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
          if (data) this.fire('message', { data });
        }
      });
    });
    this.req.on('error', () => this.fire('error', {}));
  }
  addEventListener(type, cb) { (this.listeners[type] || []).push(cb); }
  fire(type, ev) { for (const cb of this.listeners[type] || []) cb(ev); }
  close() { this.req.destroy(); }
}

test('MUST FAIL: a room code is 6 letters with no I and no O, made from the host key (codeOf, unbiased), forgiving spaces, dashes and lower case', async () => {
  assert.equal(R.CODE_LETTERS, 'ABCDEFGHJKLMNPQRSTUVWXYZ'); assert.equal(R.CODE_LEN, 6); assert.equal(R.MAX_BYTES, 8192);
  const seen = new Set();
  for (let i = 0; i < 8; i++) { const k = await R.keyPair(); const c = await R.codeOf(k.pub); assert.match(c, /^[ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/); assert.equal(await R.codeOf(k.pub), c, 'the same key, the same code'); seen.add(c); }
  assert.ok(seen.size >= 7, 'codes vary with the key');          // 8 keys, not 40: codeOf is slow on purpose now (PBKDF2, about 60 ms each)
  // the mapping by hand (11-27 v2): PBKDF2-HMAC-SHA-256 of the raw key, salt ryagram-game-room-v2, 300,000 rounds, 32 bytes; bytes below 240 in order, mod 24
  const k = await R.keyPair(); const raw = Buffer.from(k.pub, 'base64url');
  const h = (await import('node:crypto')).pbkdf2Sync(raw, 'ryagram-game-room-v2', 300000, 32, 'sha256'); let want = '';
  for (const b of h) if (b < 240 && want.length < 6) want += R.CODE_LETTERS[b % 24];
  assert.equal(await R.codeOf(k.pub), want);
  assert.equal(await R.codeOf('not a key'), '');
  assert.ok(!('newCode' in R), 'no random code: the code is made from the key');
  assert.ok(!/Math\.random/.test(SRC));
  assert.equal(R.normCode(' ab-cd ef '), 'ABCDEF'); assert.equal(R.normCode('w x y z a b'), 'WXYZAB'); assert.equal(R.normCode(null), '');
  assert.equal(R.channelName('ABCDEF'), 'ryagram-game-ABCDEF');
  assert.ok(Object.isFrozen(R)); assert.deepEqual(Object.keys(R).sort(), ['CODE_KDF', 'CODE_LEN', 'CODE_LETTERS', 'MAX_BYTES', 'channelName', 'codeOf', 'connect', 'keyPair', 'normCode', 'pidOf', 'sign', 'validate', 'verify']);
});

test('MUST FAIL: validate accepts each good kind and returns a clean copy with unknown fields dropped', () => {
  const v = m => J(R.validate(m));
  assert.deepEqual(v({ t: 'join', pid: PID_A, name: '  Ana  ', extra: 'x', admin: true }), { t: 'join', pid: PID_A, name: 'Ana' });
  assert.deepEqual(v({ t: 'join', pid: 'a'.repeat(8), name: 'x'.repeat(16) }), { t: 'join', pid: 'a'.repeat(8), name: 'x'.repeat(16) });
  assert.deepEqual(v({ t: 'join', pid: 'Z'.repeat(32), name: '\u{1F600}'.repeat(16) }), { t: 'join', pid: 'Z'.repeat(32), name: '\u{1F600}'.repeat(16) }, 'counted in letters, not code units');
  assert.deepEqual(v({ t: 'welcome', pid: PID_A, ok: true }), { t: 'welcome', pid: PID_A, ok: true });
  assert.deepEqual(v({ t: 'welcome', pid: PID_A, ok: false, problem: 'That name is taken.' }), { t: 'welcome', pid: PID_A, ok: false, problem: 'That name is taken.' });
  assert.deepEqual(v({ t: 'guess', pid: PID_B, round: 0, text: 'the cat sat down' }), { t: 'guess', pid: PID_B, round: 0, text: 'the cat sat down' });
  assert.deepEqual(v({ t: 'guess', pid: PID_B, round: 99, text: 'y'.repeat(120) }), { t: 'guess', pid: PID_B, round: 99, text: 'y'.repeat(120) });
  assert.deepEqual(v({ t: 'got', pid: PID_B, round: 3 }), { t: 'got', pid: PID_B, round: 3 });
  assert.deepEqual(v({ t: 'leave', pid: PID_B, why: 'x' }), { t: 'leave', pid: PID_B });
  assert.deepEqual(v({ t: 'state', phase: 'lobby', round: 0, of: 5, players: [] }), { t: 'state', phase: 'lobby', round: 0, of: 5, players: [] });
  const full = {
    t: 'state', phase: 'reveal', round: 2, of: 5, players: ['Ana', 'Ben', 'Cy'], answered: ['Ana', 'Cy'], heard_text: 'and then the boat went', words_left: 3, left_s: 0,
    reveal: { answer_text: 'over the hill', results: [{ name: 'Ana', points: 100, verdict: 'exact', text: 'over the hill', secret: 1 }, { name: 'Cy', points: 0, verdict: 'miss', text: '' }], other: 1 },
    totals: [{ name: 'Ana', total: 1000 }, { name: 'Cy', total: 0 }], host_secret: 'nope',
  };
  const out = v(full);
  assert.ok(!('host_secret' in out) && !('other' in out.reveal) && !('secret' in out.reveal.results[0]));
  assert.deepEqual(out.reveal.results[0], { name: 'Ana', points: 100, verdict: 'exact', text: 'over the hill' });
  assert.deepEqual(out.totals, full.totals); assert.equal(out.words_left, 3); assert.equal(out.left_s, 0);
  for (const phase of ['lobby', 'question', 'reveal', 'final']) assert.ok(R.validate({ t: 'state', phase, round: 0, of: 0, players: ['Ana'] }), phase);
  assert.ok(R.validate({ t: 'state', phase: 'final', round: 0, of: 0, players: Array.from({ length: 12 }, (_, i) => 'P' + i) }), '12 players');
  const copy = { t: 'join', pid: PID_A, name: 'Ana' }; assert.notEqual(R.validate(copy), copy, 'a copy, not the same object');
});

test('MUST FAIL: validate refuses bad messages', () => {
  const bad = [
    null, undefined, 'join', 42, [], { }, { t: 'hello', pid: PID_A }, { t: 'toString' }, { t: '__proto__' }, { t: 'constructor', pid: PID_A },
    { t: 'join', pid: PID_A, name: 'x'.repeat(17) }, { t: 'join', pid: PID_A, name: '' }, { t: 'join', pid: PID_A, name: ' \u200b\u0000 ' }, { t: 'join', pid: PID_A }, { t: 'join', pid: PID_A, name: 7 },
    { t: 'join', pid: 'short', name: 'Ana' }, { t: 'join', pid: 'a'.repeat(33), name: 'Ana' }, { t: 'join', pid: 'Ana-Phone-1', name: 'Ana' }, { t: 'join', pid: 12345678, name: 'Ana' }, { t: 'join', name: 'Ana' },
    { t: 'welcome', pid: PID_A, ok: 'yes' }, { t: 'welcome', pid: PID_A }, { t: 'welcome', pid: PID_A, ok: false, problem: 'p'.repeat(201) },
    { t: 'guess', pid: PID_A, round: 100, text: 'hi' }, { t: 'guess', pid: PID_A, round: -1, text: 'hi' }, { t: 'guess', pid: PID_A, round: 1.5, text: 'hi' }, { t: 'guess', pid: PID_A, round: '1', text: 'hi' },
    { t: 'guess', pid: PID_A, round: 1, text: '' }, { t: 'guess', pid: PID_A, round: 1, text: 'y'.repeat(121) }, { t: 'guess', pid: PID_A, round: 1 },
    { t: 'got', pid: PID_A }, { t: 'leave' },
    { t: 'state', phase: 'paused', round: 0, of: 5, players: [] }, { t: 'state', phase: 'lobby', round: 0, of: 100, players: [] }, { t: 'state', phase: 'lobby', round: 0, of: 5 },
    { t: 'state', phase: 'lobby', round: 0, of: 5, players: Array.from({ length: 13 }, (_, i) => 'P' + i) }, { t: 'state', phase: 'lobby', round: 0, of: 5, players: ['x'.repeat(17)] },
    { t: 'state', phase: 'lobby', round: 0, of: 5, players: [''] }, { t: 'state', phase: 'lobby', round: 0, of: 5, players: 'Ana' },
    { t: 'state', phase: 'question', round: 0, of: 5, players: [], words_left: 51 }, { t: 'state', phase: 'question', round: 0, of: 5, players: [], left_s: 601 },
    { t: 'state', phase: 'question', round: 0, of: 5, players: [], heard_text: 'h'.repeat(401) }, { t: 'state', phase: 'question', round: 0, of: 5, players: [], answered: ['x'.repeat(17)] },
    { t: 'state', phase: 'reveal', round: 0, of: 5, players: [], reveal: { answer_text: 'a', results: [{ name: 'Ana', points: 101, verdict: 'x', text: '' }] } },
    { t: 'state', phase: 'reveal', round: 0, of: 5, players: [], reveal: { answer_text: 'a', results: [{ name: 'Ana', points: 1, verdict: 'v'.repeat(21), text: '' }] } },
    { t: 'state', phase: 'reveal', round: 0, of: 5, players: [], reveal: { answer_text: 'a'.repeat(401), results: [] } },
    { t: 'state', phase: 'reveal', round: 0, of: 5, players: [], reveal: 'over the hill' },
    { t: 'state', phase: 'final', round: 0, of: 5, players: [], totals: [{ name: 'Ana', total: 1001 }] }, { t: 'state', phase: 'final', round: 0, of: 5, players: [], totals: [{ name: 'Ana', total: 2.5 }] },
  ];
  for (const m of bad) assert.equal(R.validate(m), null, JSON.stringify(m));
  // over MAX_BYTES as JSON, even when the extra size is in a field that would be dropped
  assert.equal(R.validate({ t: 'join', pid: PID_A, name: 'Ana', pad: 'z'.repeat(8200) }), null);
  assert.equal(R.validate({ t: 'state', phase: 'reveal', round: 0, of: 5, players: [], heard_text: '\u{1F600}'.repeat(400), reveal: { answer_text: '\u{1F600}'.repeat(400), results: [] },
    totals: [], answered: [], pad: '\u00e9'.repeat(3000) }), null, 'counted in bytes, not characters');
  const loop = { t: 'join', pid: PID_A, name: 'Ana' }; loop.self = loop; assert.equal(R.validate(loop), null, 'a message that cannot be JSON is refused');
});

test('MUST FAIL: control and invisible characters are cleaned out of every string', () => {
  assert.equal(R.validate({ t: 'join', pid: PID_A, name: 'A\u0000n\u200ba\u202e' }).name, 'A n a');
  assert.equal(R.validate({ t: 'guess', pid: PID_A, round: 1, text: '\tone\r\ntwo\u0007  three\ufeff' }).text, 'one two three');
  const s = R.validate({ t: 'state', phase: 'reveal', round: 1, of: 2, players: ['Cy\u2066'], heard_text: 'went\u0000 up', reveal: { answer_text: 'the\u200d end', results: [{ name: '\u200fBen', points: 5, verdict: 'close\u0001', text: 'the\u0085end' }] }, totals: [{ name: 'Ana\u0009', total: 5 }] });
  assert.deepEqual(J(s.players), ['Cy']); assert.equal(s.heard_text, 'went up'); assert.equal(s.reveal.answer_text, 'the end');
  assert.deepEqual(J(s.reveal.results[0]), { name: 'Ben', points: 5, verdict: 'close', text: 'the end' }); assert.equal(s.totals[0].name, 'Ana');
  assert.equal(R.validate({ t: 'welcome', pid: PID_A, ok: false, problem: 'a\u001bb' }).problem, 'a b');
});

// A FAKE supabase-js v2 client: channels on one shared bus, broadcast honouring config.broadcast.self the way the real server does.
function fakeBus() {
  const channels = [];
  const made = [];
  return {
    channels, made,
    client({ status = 'SUBSCRIBED' } = {}) {
      const removed = [];
      const client = {
        removed,
        channel(name, cfg) {
          const ch = {
            name, cfg, handlers: [], subscribed: false, sent: [],
            on(type, filter, cb) { ch.handlers.push({ type, filter, cb }); return ch; },
            subscribe(cb) { setTimeout(() => { if (status === 'SUBSCRIBED') { ch.subscribed = true; channels.push(ch); } cb(status); }, 0); return ch; },
            send(msg) {
              ch.sent.push(msg);
              for (const other of channels) {
                if (other.name !== ch.name || !other.subscribed) continue;
                if (other === ch && !(ch.cfg && ch.cfg.config && ch.cfg.config.broadcast && ch.cfg.config.broadcast.self)) continue;
                for (const h of other.handlers) if (h.type === 'broadcast' && h.filter.event === msg.event) h.cb({ type: 'broadcast', event: msg.event, payload: J(msg.payload) });
              }
              return Promise.resolve('ok');
            },
          };
          made.push(ch);
          return ch;
        },
        removeChannel(ch) { removed.push(ch); ch.subscribed = false; const i = channels.indexOf(ch); if (i >= 0) channels.splice(i, 1); return Promise.resolve('ok'); },
      };
      return client;
    },
  };
}
const tick = () => new Promise(r => setTimeout(r, 5));
// A connect that should be refused at once must not hang the run when a fault lets it through: it fails after 2 s instead.
const soon = p => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('still waiting: it was not refused')), 2000).unref())]);

test('MUST FAIL: realtime: the channel is ryagram-game-CODE with self false and no ack; a message reaches the other side only, never its sender; invalid ones are refused and dropped', async () => {
  const bus = fakeBus();
  const hostClient = bus.client(), phoneClient = bus.client(), otherRoom = bus.client();
  const host = await R.connect({ kind: 'realtime', client: hostClient, code: 'ab-cd-ef' });
  const phone = await R.connect({ kind: 'realtime', client: phoneClient, code: 'ABCDEF' });
  const stranger = await R.connect({ kind: 'realtime', client: otherRoom, code: 'WXYZAB' });
  assert.equal(bus.made[0].name, 'ryagram-game-ABCDEF'); assert.equal(bus.made[2].name, 'ryagram-game-WXYZAB');
  for (const ch of bus.made) assert.deepEqual(J(ch.cfg), { config: { broadcast: { self: false, ack: false } } });
  for (const ch of bus.made) assert.deepEqual(J(ch.handlers.map(h => [h.type, h.filter])), [['broadcast', { event: 'msg' }]]);
  const got = { host: [], phone: [], stranger: [] };
  host.onMessage(m => got.host.push(J(m))); const unsub = phone.onMessage(m => got.phone.push(J(m))); stranger.onMessage(m => got.stranger.push(J(m)));

  await phone.send({ t: 'join', pid: PID_A, name: ' Ana ', junk: 1 });
  await tick();
  assert.deepEqual(got.host, [{ t: 'join', pid: PID_A, name: 'Ana' }]);
  assert.deepEqual(got.phone, [], 'the sender never hears itself'); assert.deepEqual(got.stranger, [], 'another room hears nothing');
  assert.deepEqual(J(bus.made[1].sent), [{ type: 'broadcast', event: 'msg', payload: { t: 'join', pid: PID_A, name: 'Ana' } }], 'only the clean copy is sent');

  await host.send({ t: 'welcome', pid: PID_A, ok: true });
  await tick();
  assert.deepEqual(got.phone, [{ t: 'welcome', pid: PID_A, ok: true }]); assert.equal(got.host.length, 1, 'the host never hears itself');

  // invalid outgoing: refused with an Error and nothing sent
  const before = bus.made[1].sent.length;
  await assert.rejects(phone.send({ t: 'join', pid: PID_A, name: 'x'.repeat(17) }), err => /not one the game sends/.test(err.message));
  await assert.rejects(phone.send({ t: 'cheat', pid: PID_A }), err => err instanceof Error || /not one/.test(String(err)));
  assert.equal(bus.made[1].sent.length, before);
  // invalid incoming (from a client that does not use game-room.js): dropped silently
  const raw = bus.made[0];
  for (const h of bus.made[1].handlers) { h.cb({ payload: { t: 'guess', pid: PID_B, round: 500, text: 'hi' } }); h.cb({ payload: 'nonsense' }); h.cb({}); h.cb(undefined); }
  assert.equal(got.phone.length, 1, 'nothing invalid delivered'); assert.ok(raw);

  unsub();
  await host.send({ t: 'state', phase: 'lobby', round: 0, of: 3, players: ['Ana'] }); await tick();
  assert.equal(got.phone.length, 1, 'an unsubscribed listener hears nothing');

  phone.close();
  assert.equal(phoneClient.removed.length, 1); assert.equal(phoneClient.removed[0], bus.made[1], 'close removes its own channel');
  await assert.rejects(phone.send({ t: 'leave', pid: PID_A }), /closed/);
  host.close(); stranger.close();
});

test('MUST FAIL: realtime: CHANNEL_ERROR and TIMED_OUT reject in plain words and remove the channel; a bad code or a missing client is refused', async () => {
  const bus = fakeBus();
  for (const [status, words] of [['CHANNEL_ERROR', /Could not reach the room/], ['TIMED_OUT', /took too long/]]) {
    const c = bus.client({ status });
    await assert.rejects(R.connect({ kind: 'realtime', client: c, code: 'ABCDEF' }), err => words.test(err.message));
    assert.equal(c.removed.length, 1, `${status}: the channel is removed`);
  }
  await assert.rejects(R.connect({ kind: 'realtime', client: bus.client(), code: 'AB1DEF' }), /room code/);
  await assert.rejects(R.connect({ kind: 'realtime', client: bus.client(), code: 'ABIOEF' }), /room code/);
  await assert.rejects(R.connect({ kind: 'realtime', code: 'ABCDEF' }), /Supabase/);
  await assert.rejects(R.connect({ kind: 'carrier-pigeon', code: 'ABCDEF' }), /realtime' or 'relay/);
  await assert.rejects(R.connect(null), /options/);
});

test('MUST FAIL: relay is for this computer only: a page or a relay anywhere else is refused before anything is opened', async () => {
  let opened = 0;
  const ES = class { constructor() { opened++; } addEventListener() {} close() {} };
  const at = host => load({ location: { hostname: host }, EventSource: ES, fetch: () => { opened++; return Promise.resolve({ ok: true }); } });
  for (const [page, base] of [['uselai.com', 'http://127.0.0.1:9000'], ['127.0.0.1', 'https://uselai.com'], ['127.0.0.1', 'http://127.0.0.2:9000'], ['192.168.1.5', 'http://192.168.1.5:9000'],
    ['127.0.0.1', 'http://localhost.evil.test:9000'], ['127.0.0.1', 'http://127.0.0.1.nip.io:9000'], ['localhost', 'not a url'], ['', 'http://127.0.0.1:9000'], ['127.0.0.1', 'file:///C:/x']]) {
    await assert.rejects(soon(at(page).connect({ kind: 'relay', base, code: 'ABCDEF' })), err => /this computer|web address/.test(err.message), `${page} ${base}`);
  }
  await assert.rejects(soon(load({ location: undefined, EventSource: ES }).connect({ kind: 'relay', base: 'http://127.0.0.1:9000', code: 'ABCDEF' })), /this computer/);
  await assert.rejects(soon(at('127.0.0.1').connect({ kind: 'relay', base: 'http://127.0.0.1:9000', code: 'ABCDE' })), /room code/);
  assert.equal(opened, 0, 'no stream opened and nothing sent');
});

test('MUST FAIL: end to end through tools/game-relay.mjs: two phones in one room, a join reaches the other only, another room hears nothing, CORS is 127.0.0.1 only', async () => {
  const child = spawn(process.execPath, [fileURL('tools/game-relay.mjs'), '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const port = await new Promise((resolve, reject) => {
      let out = '';
      const t = setTimeout(() => reject(new Error('relay did not start: ' + out)), 10000);
      child.stdout.on('data', d => { out += d; const m = out.match(/RELAY (\d+)/); if (m) { clearTimeout(t); resolve(Number(m[1])); } });
      child.on('exit', code => { clearTimeout(t); reject(new Error('relay exited ' + code)); });
    });
    const base = `http://127.0.0.1:${port}`;
    const ctx = () => load({ location: { hostname: '127.0.0.1' }, EventSource: TinyEventSource, fetch });
    const ana = await ctx().connect({ kind: 'relay', base, code: 'ab-cd-ef' });
    const ben = await ctx().connect({ kind: 'relay', base: base + '/', code: 'ABCDEF' });
    const cy = await ctx().connect({ kind: 'relay', base, code: 'WXYZAB' });
    const got = { ana: [], ben: [], cy: [] };
    ana.onMessage(m => got.ana.push(J(m))); ben.onMessage(m => got.ben.push(J(m))); cy.onMessage(m => got.cy.push(J(m)));
    await ana.send({ t: 'join', pid: PID_A, name: 'Ana', note: 'dropped' });
    const until = async ok => { for (let i = 0; i < 200 && !ok(); i++) await new Promise(r => setTimeout(r, 10)); };
    await until(() => got.ben.length > 0);
    await new Promise(r => setTimeout(r, 150));
    assert.deepEqual(got.ben, [{ t: 'join', pid: PID_A, name: 'Ana' }]);
    assert.deepEqual(got.ana, [], 'the sender never hears itself'); assert.deepEqual(got.cy, [], 'another room hears nothing');
    await assert.rejects(ana.send({ t: 'join', pid: PID_A, name: 'x'.repeat(17) }), /not one the game sends/);

    // the relay itself: a raw invalid payload is passed on, and the client drops it
    const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
    assert.equal((await post('/send?room=ABCDEF&sid=RawSender01', JSON.stringify({ t: 'guess', pid: PID_B, round: 999, text: 'hi' }))).status, 204);
    await new Promise(r => setTimeout(r, 150));
    assert.equal(got.ben.length, 1, 'invalid incoming dropped');
    // limits and CORS
    assert.equal((await post('/send?room=ABCDEF&sid=RawSender01', JSON.stringify({ pad: 'z'.repeat(9000) }))).status, 413);
    assert.equal((await post('/send?room=ABCDEF&sid=RawSender01', '{not json')).status, 400);
    assert.equal((await post('/send?room=abcdef&sid=x', '{}')).status, 400);
    const okOrigin = await post('/send?room=ABCDEF&sid=RawSender01', '{}', { origin: 'http://127.0.0.1:5173' });
    assert.equal(okOrigin.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173');
    for (const o of ['https://uselai.com', 'http://127.0.0.1.evil.test', 'http://localhost:5173']) {
      const r = await post('/send?room=ABCDEF&sid=RawSender01', '{}', { origin: o });
      assert.equal(r.headers.get('access-control-allow-origin'), null, o);
    }
    ana.close(); ben.close(); cy.close();
  } finally {
    if (child.exitCode === null) process.kill(child.pid);   // our own child, by its own PID
    await new Promise(r => (child.exitCode !== null || child.signalCode !== null) ? r() : child.on('exit', r));
  }
  assert.ok(read('tools/game-relay.mjs').includes("'127.0.0.1'") && !/listen\([^)]*0\.0\.0\.0/.test(read('tools/game-relay.mjs')), 'the relay listens on 127.0.0.1 only');
});

function fileURL(p) { return fileURLToPath(new URL(`../${p}`, import.meta.url)); }

test('the header says what the room is, that nothing is stored, the short-code limit, and that relay is for tests on this computer only', () => {
  const head = SRC.split('(function')[0];
  assert.match(head, /NOTHING IS STORED/); assert.match(head, /Supabase Realtime BROADCAST/); assert.match(head, /keeps nothing/);
  assert.match(head, /anyone who knows/); assert.match(head, /it is not a password/); assert.match(head, /FOR TESTS ON THIS COMPUTER ONLY/);
  assert.ok(!/localStorage|sessionStorage|indexedDB|document\.cookie|eval\(|new Function|innerHTML/.test(SRC), 'no storage, no HTML strings');
  assert.match(read('tools/game-relay.mjs'), /TEST-ONLY/); assert.match(read('tools/game-relay.mjs'), /NEVER used on uselai\.com/);
  assert.ok(!/[^\x00-\x7f]/.test(SRC) && !/[^\x00-\x7f]/.test(read('tools/game-relay.mjs')), 'plain ASCII source: no invisible characters slipped in');
});
