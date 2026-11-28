// GAMES 11-27: the ROOM for a live round of "Guess the next line". A room is how the host screen (the TV) and the players' phones talk to each other: the host makes a short code,
// players type it on their phones, and every message after that (join, guess, the round's state, the reveal) passes between the browsers in that room.
// NOTHING IS STORED. In the real room, Supabase Realtime BROADCAST passes each message from one browser to the others that are in the same room at that moment and keeps nothing:
// no table, no log, no replay. A phone that joins late sees only what is sent after it joined. Close the pages and the room is gone.
// A LIMIT TO SAY PLAINLY: a room code is 8 letters (11-27 v3, was 6), so anyone who knows (or guesses) the code while the room is open can join it and see what is sent in it. The code
// keeps out strangers who do not know it; it is not a password. Nothing private belongs in a room: a scoreboard name, a typed guess and the round's public text only.
// SIGNED (11-27): since anyone in the room can send, every join/guess/leave is signed by the phone's own key (its pid is made from that key) and every state/welcome/got by the
// host's key (sign/verify/keyPair/pidOf below). The host drops what a pid's key did not sign; a phone drops what the host key it pinned did not sign. A phone
// pins the host's key only from a welcome whose key gives the very code the player typed (codeOf), so a stranger who answers first cannot pose as the host.
// NONCE (11-27 v3, FACES design section 4): every join carries a fresh random nonce (newNonce) and the host's welcome must echo it, inside the signature, so a recorded old
// welcome cannot be played back to a phone that joins again. The signature label is 'ryagram-game-sig-2' so builds from before the nonce and the 8-letter code cannot mix.
// THE CODE IS DELIBERATELY SLOW (11-27, WORKER and CC1 review MEDIUM): codeOf is PBKDF2-HMAC-SHA-256 over the host's raw public key, CODE_ITERATIONS = 300,000 rounds.
// Measured in node 24 on this PC (one core, for the 6-letter code; the work per key is the same for 8): 52 to 122 ms per codeOf, mostly about 60 ms, so one core tries
// about 14 keys/s (a phone is slower, perhaps 2 to 4 times). The NUMBERS BELOW ARE ESTIMATES worked out from that rate, not measured attacks.
// GRINDING ONE ROOM: a stranger who wants to pose as the host must make keys until one gives the same 8 letters: 24^8, about 1.1e11 keys on average (576 times the
// 6-letter 1.9e8). One core: about 1.1e11 / 14 = 7.9e9 s, about 250 core-years. A GPU: public cracking benchmarks put a top GPU near 1e10 PBKDF2-SHA-256 rounds/s,
// about 33,000 codes/s here, so about 38 days per room on one GPU (the 6-letter code was about 1.6 h).
// A TABLE OF EVERY CODE: the salt is fixed, so keys can be made ahead of time. Covering all 1.1e11 codes takes about 1.1e11 x ln(1.1e11), about 2.8e12 keys (it was 3.6e9):
// about 6,300 core-years, or about 980 GPU-days, plus several terabytes to keep one key per code. A table that covers HALF the codes needs about 7.6e10 keys (about 27 GPU-days)
// and answers about half the rooms. (The 6-letter table was about 8 core-years or 1.3 GPU-days.)
// THE TRADE-OFF (red team HIGH W1): 800,000 rounds (about 0.2 s) made a flood of fake welcomes able to stall a phone's join, so the count stays 300,000: slow enough to make
// grinding a host key expensive, fast enough that a phone can check a few dozen candidate host keys (in parallel, once each) inside its join wait.
// SAID PLAINLY: a determined, well-funded attacker who builds such a table (or rents many GPUs) and knows a room's code CAN answer new phones before the host and pose as
// the host to them (showing them made-up rounds and text; their guesses still reach the real host signed). The 8-letter code raises that cost from hours to GPU-months;
// it does not make it impossible. A QR of the host key would close it.
// LIMITS (11-27 v3, FACES section 3): makeLimits gives the host cheap token buckets (the whole room, each pid, guesses, new pids, signature checks, signed refusals) to
// run BEFORE any signature work, so a flood costs comparisons, not ECDSA. Its per-pid memory is capped (LIMIT_PIDS), so a flood of made-up pids cannot grow it.
// CLOSED (11-27 v3): a state with phase 'closed' tells the phones the room has ended, with why: 'idle' (nothing happened for a while), 'host' (the host closed it) or
// 'newcode' (the host started a new room with a new code).
// THE LIMIT LEFT: the code keeps out strangers who do not know it and makes posing as the host expensive; it is not a password, and anyone with the code can still join
// under their own name and see the room's public text.
// Every message is checked both ways (validate): a message of an unknown kind, too long, or with a field out of range is refused when sent and dropped when received, unknown fields are
// removed, and invisible or control characters are cleaned out of every string.
// The 'relay' kind is FOR TESTS ON THIS COMPUTER ONLY: it talks to tools/game-relay.mjs on 127.0.0.1 and refuses to run unless both the page and the relay are on this computer.
(function () {
  const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';      // no I or O: on a TV across the room they read as 1 and 0
  const CODE_LEN = 8, MAX_BYTES = 8192;          // GAMES 11-27 v3: 8 letters (was 6) made from the host's public key (codeOf), so the code a player types also names the host's key
  const NAME_MAX = 16, ANSWER_MAX = 120, PROBLEM_MAX = 200, HEARD_MAX = 400, VERDICT_MAX = 20, MAX_PLAYERS = 8;          // one number with assets/app-games.js (8 seats; round 2 11-27)
  const PHASES = ['lobby', 'question', 'reveal', 'final', 'closed'];          // 'closed' (11-27 v3): the room has ended; the state may say why (CLOSED_WHY)
  const WELCOME_WHY = ['removed', 'full', 'locked', 'started', 'name', 'closed'];          // a refusal's fixed reason, so the phone does not depend on the free text in problem
  const CLOSED_WHY = ['idle', 'host', 'newcode'];
  const NONCE = /^[A-Za-z0-9_-]{22}$/;          // 16 random bytes as base64url (newNonce)
  const MODES = ['line', 'gap'];
  const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]', '::1'];
  const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;          // keep equal to assets/game-phone.js
  const PID = /^[A-Za-z0-9]{8,32}$/;
  const SID_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  const clean = s => String(s ?? '').replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  const chars = s => [...s].length;
  const normCode = s => String(s ?? '').toUpperCase().replace(/[\s-]/g, '');
  const codeOk = c => typeof c === 'string' && c.length === CODE_LEN && [...c].every(ch => CODE_LETTERS.includes(ch));
  const channelName = code => 'ryagram-game-' + code;
  // The code as the host screen shows it: a space after the first 4 letters ('ABCD EFGH'), easier to read across a room. normCode takes the space out again.
  const showCode = c => { const n = normCode(c); return n.length > 4 ? n.slice(0, 4) + ' ' + n.slice(4) : n; };

  // Random letters from a fixed alphabet with no bias: bytes past the last whole multiple of the alphabet are thrown away.
  function randomFrom(letters, n) {
    const top = 256 - (256 % letters.length);
    let out = '';
    while (out.length < n) {
      const bytes = crypto.getRandomValues(new Uint8Array(n * 2));
      for (const b of bytes) if (b < top && out.length < n) out += letters[b % letters.length];
    }
    return out;
  }

  // Field checks. Each returns the clean value, or BAD.
  const BAD = Symbol('bad');
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const text = (v, min, max) => { if (typeof v !== 'string') return BAD; const s = clean(v); const n = chars(s); return n >= min && n <= max ? s : BAD; };
  const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max ? v : BAD;
  const pid = v => typeof v === 'string' && PID.test(v) ? v : BAD;
  const name = v => text(v, 1, NAME_MAX);
  const list = (v, max, each) => {
    if (!Array.isArray(v) || v.length > max) return BAD;
    const out = v.map(each);
    return out.includes(BAD) ? BAD : out;
  };
  const result = v => {
    if (!isObj(v)) return BAD;
    const r = { name: name(v.name), points: int(v.points, 0, 100), verdict: text(v.verdict, 0, VERDICT_MAX), text: text(v.text, 0, ANSWER_MAX) };
    return Object.values(r).includes(BAD) ? BAD : r;
  };
  const total = v => {
    if (!isObj(v)) return BAD;
    const r = { name: name(v.name), total: int(v.total, 0, 1000) };
    return Object.values(r).includes(BAD) ? BAD : r;
  };
  const reveal = v => {
    if (!isObj(v)) return BAD;
    const r = { answer_text: text(v.answer_text, 0, HEARD_MAX), results: list(v.results, MAX_PLAYERS, result) };
    return Object.values(r).includes(BAD) ? BAD : r;
  };

  // GAMES 11-27 (signed room): seq is the sender's own counter (strictly increasing), sig its ECDSA P-256 signature, pub its raw public key (join and welcome only). validate only
  // checks their FORMAT; whether a signature is good is checked by verify below, by the host and the phones themselves.
  const B64U_KEY = /^[A-Za-z0-9_-]{80,100}$/;
  const b64uField = v => typeof v === 'string' && B64U_KEY.test(v) ? v : BAD;
  const SIGNED = { seq: v => int(v, 0, 1e9), sig: b64uField };
  const WITH_PUB = { ...SIGNED, pub: b64uField };

  // Each kind of message: its required fields and its optional ones (left out when absent; a present but wrong optional field refuses the whole message).
  // nonce (11-27 v3): REQUIRED on join (new for every attempt) and on welcome (the host echoes the join's), so it is inside both signatures. why on a welcome is only for
  // a refusal (ok false); why on a state only for phase 'closed'. Those two pairings are checked in the kind's `also` (still format only, no crypto).
  const nonce = v => typeof v === 'string' && NONCE.test(v) ? v : BAD;
  const KINDS = {
    join: { need: { pid, name, nonce }, may: WITH_PUB },
    welcome: { need: { pid, ok: v => typeof v === 'boolean' ? v : BAD, nonce }, may: { problem: v => text(v, 0, PROBLEM_MAX), why: v => (WELCOME_WHY.includes(v) ? v : BAD), name, ...WITH_PUB },          // name: the name the host seated this pid under (11-27)
      also: m => m.why === undefined || m.ok === false },
    guess: { need: { pid, round: v => int(v, 0, 99), text: v => text(v, 1, ANSWER_MAX) }, may: SIGNED },
    got: { need: { pid, round: v => int(v, 0, 99) }, may: SIGNED },
    state: {
      need: { phase: v => PHASES.includes(v) ? v : BAD, round: v => int(v, 0, 99), of: v => int(v, 0, 99), players: v => list(v, MAX_PLAYERS, name) },
      may: { answered: v => list(v, MAX_PLAYERS, name), heard_text: v => text(v, 0, HEARD_MAX), words_left: v => int(v, 0, 50), left_s: v => int(v, 0, 600), reveal, totals: v => list(v, MAX_PLAYERS, total),
             mode: v => (MODES.includes(v) ? v : BAD), why: v => (CLOSED_WHY.includes(v) ? v : BAD), ...SIGNED },          // GAMES 11-27: which game the round is ('line' = Guess the next line, 'gap' = Fill the gap); absent means 'line'
      also: m => m.why === undefined || m.phase === 'closed',
    },
    leave: { need: { pid }, may: SIGNED },
  };

  function byteLength(msg) {
    try { const s = JSON.stringify(msg); return typeof s === 'string' ? new TextEncoder().encode(s).length : Infinity; } catch { return Infinity; }
  }

  // A clean copy of a valid message, or null.
  function validate(msg) {
    if (!isObj(msg) || byteLength(msg) > MAX_BYTES) return null;
    const t = msg.t;
    if (typeof t !== 'string' || !Object.prototype.hasOwnProperty.call(KINDS, t)) return null;
    const kind = KINDS[t], out = { t };
    for (const [k, check] of Object.entries(kind.need)) {
      const v = check(msg[k]);
      if (v === BAD) return null;
      out[k] = v;
    }
    for (const [k, check] of Object.entries(kind.may || {})) {
      if (msg[k] === undefined || msg[k] === null) continue;
      const v = check(msg[k]);
      if (v === BAD) return null;
      out[k] = v;
    }
    if (kind.also && !kind.also(out)) return null;
    return out;
  }

  // GAMES 11-27: SIGNED MESSAGES. There is no server to say who sent what (a broadcast reaches everyone in the room, and anyone with the code can send), so each sender signs.
  // A phone makes an ECDSA P-256 key pair on its first join; its player id IS the first 20 letters and digits of base64url(SHA-256(raw public key)), so a pid cannot be used
  // with another key. The host remembers each pid's key and last seq; the phone pins the host's key from the welcome sent to it. Host and phones share these four functions.
  // What is signed: a fixed label, the room code and the message as validate cleans it, every field but sig, keys in sorted order (so the bytes are the same on both sides).
  const ALG = { name: 'ECDSA', namedCurve: 'P-256' }, SIGN_ALG = { name: 'ECDSA', hash: 'SHA-256' };
  const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const subtle = () => { const c = typeof crypto !== 'undefined' ? crypto : null; if (!c || !c.subtle) throw new Error('This browser cannot sign game messages (no crypto.subtle): open the game on a secure (https) page in an up-to-date browser.'); return c.subtle; };
  function b64u(buf) {
    const b = new Uint8Array(buf); let out = '';
    for (let i = 0; i < b.length; i += 3) {
      const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0), left = b.length - i;
      out += B64U[(n >> 18) & 63] + B64U[(n >> 12) & 63] + (left > 1 ? B64U[(n >> 6) & 63] : '') + (left > 2 ? B64U[n & 63] : '');
    }
    return out;
  }
  function unb64u(s) {
    if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
    const out = new Uint8Array(Math.floor(s.length * 3 / 4)); let bits = 0, acc = 0, j = 0;
    for (const ch of s) { acc = (acc << 6) | B64U.indexOf(ch); bits += 6; if (bits >= 8) { bits -= 8; out[j++] = (acc >> bits) & 255; } }
    return out;
  }
  const sorted = v => Array.isArray(v) ? v.map(sorted) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;
  function signedText(code, msg) {
    const v = validate(msg); if (!v) return null;
    delete v.sig;
    return new TextEncoder().encode('ryagram-game-sig-2\n' + normCode(code) + '\n' + JSON.stringify(sorted(v)));
  }
  const pubKeys = new Map();          // pub -> imported CryptoKey (a few per room)
  async function importPub(pub) {
    if (pubKeys.has(pub)) return pubKeys.get(pub);
    const raw = typeof pub === 'string' && B64U_KEY.test(pub) ? unb64u(pub) : null;
    if (!raw || raw.length !== 65 || raw[0] !== 4) return null;
    let key = null; try { key = await subtle().importKey('raw', raw, ALG, false, ['verify']); } catch { key = null; }
    if (key) { if (pubKeys.size > 200) pubKeys.clear(); pubKeys.set(pub, key); }
    return key;
  }
  // A key pair: a new one, or the one in a stored JWK (the phone's seat). { pub, jwk, key }; jwk is what to store, key signs.
  async function keyPair(jwk) {
    if (jwk !== undefined && jwk !== null) {
      if (!isObj(jwk) || jwk.kty !== 'EC' || jwk.crv !== 'P-256' || ![jwk.x, jwk.y, jwk.d].every(p => typeof p === 'string' && /^[A-Za-z0-9_-]{43}$/.test(p))) throw new Error('That stored key is not a game key.');
      const clean = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d };
      const key = await subtle().importKey('jwk', clean, ALG, false, ['sign']);
      const raw = new Uint8Array(65); raw[0] = 4; raw.set(unb64u(jwk.x), 1); raw.set(unb64u(jwk.y), 33);
      return Object.freeze({ pub: b64u(raw), jwk: Object.freeze(clean), key });
    }
    const made = await subtle().generateKey(ALG, true, ['sign', 'verify']);
    const full = await subtle().exportKey('jwk', made.privateKey);
    const clean = { kty: 'EC', crv: 'P-256', x: full.x, y: full.y, d: full.d };
    const key = await subtle().importKey('jwk', clean, ALG, false, ['sign']);
    return Object.freeze({ pub: b64u(await subtle().exportKey('raw', made.publicKey)), jwk: Object.freeze(clean), key });
  }
  // The player id that belongs to a public key ('' for a key that is not one).
  async function pidOf(pub) {
    const raw = typeof pub === 'string' && B64U_KEY.test(pub) ? unb64u(pub) : null;
    if (!raw) return '';
    return b64u(await subtle().digest('SHA-256', raw)).replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
  }
  // The ROOM CODE of a host key (11-27 v2): PBKDF2-HMAC-SHA-256 with password = the raw public key, salt = CODE_SALT, CODE_ITERATIONS rounds, 256 bits out; its bytes below
  // 240 taken in order (240 = 10 x 24, so no letter is more likely), each mod 24 onto CODE_LETTERS. Slow on purpose (see the header): about 60 ms here, so it is cached per key.
  // The host's room code is codeOf(its own key), so the code a player reads off the host's screen binds the host key: a phone pins only a key whose code is the code it typed.
  const CODE_SALT = 'ryagram-game-room-v3', CODE_ITERATIONS = 300000;          // v3 (11-27): 8 letters; a new salt so a 6-letter build never meets an 8-letter one
  const CODE_KDF = Object.freeze({ name: 'PBKDF2', hash: 'SHA-256', salt: CODE_SALT, iterations: CODE_ITERATIONS, bits: 256 });
  const codes = new Map();          // pub -> Promise of its code (the same key always gives the same code; a few per room)
  async function slowCode(raw) {
    const base = await subtle().importKey('raw', raw, 'PBKDF2', false, ['deriveBits']);
    let out = '', bytes = new Uint8Array(await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(CODE_SALT), iterations: CODE_ITERATIONS }, base, 256));
    for (;;) {
      for (const b of bytes) if (b < 240 && out.length < CODE_LEN) out += CODE_LETTERS[b % 24];
      if (out.length === CODE_LEN) return out;
      bytes = new Uint8Array(await subtle().digest('SHA-256', bytes));          // fewer than 8 usable bytes in 32 (about 1 in 10^24): hash again
    }
  }
  function codeOf(pub) {
    const raw = typeof pub === 'string' && B64U_KEY.test(pub) ? unb64u(pub) : null;
    if (!raw) return Promise.resolve('');
    if (codes.has(pub)) return codes.get(pub);
    let p;
    try { p = slowCode(raw); } catch (e) { return Promise.reject(e); }
    p = p.catch(e => { codes.delete(pub); throw e; });
    if (codes.size >= 32) codes.clear();
    codes.set(pub, p);
    return p;
  }
  // A copy of msg with its sig, signed by the key pair for this room. msg must already carry its seq.
  async function sign(pair, code, msg) {
    if (!pair || !pair.key) throw new Error('sign needs a key pair.');
    if (!isObj(msg) || !Number.isInteger(msg.seq)) throw new Error('A signed message needs its seq.');
    const bytes = signedText(code, { ...msg, sig: undefined });
    if (!bytes) throw new Error('That message is not one the game sends, so it was not signed.');
    return { ...msg, sig: b64u(await subtle().sign(SIGN_ALG, pair.key, bytes)) };
  }
  // true only when msg carries a seq and a sig made by the key pub over this room's code and the message's own fields.
  async function verify(pub, code, msg) {
    try {
      if (!isObj(msg) || !Number.isInteger(msg.seq) || typeof msg.sig !== 'string' || !B64U_KEY.test(msg.sig)) return false;
      const sig = unb64u(msg.sig); if (!sig || sig.length !== 64) return false;
      const bytes = signedText(code, msg); if (!bytes) return false;
      const key = await importPub(pub); if (!key) return false;
      return await subtle().verify(SIGN_ALG, key, sig, bytes);
    } catch { return false; }
  }

  // A fresh nonce for one join attempt (11-27 v3): 16 random bytes, base64url, 22 characters. The host echoes it in its signed welcome.
  const newNonce = () => b64u(crypto.getRandomValues(new Uint8Array(16)));

  // RATE LIMITS (11-27 v3, FACES design section 3.1): token buckets the host checks BEFORE any signature work. Each bucket holds up to cap tokens and gets n tokens back
  // every ms milliseconds (smoothly); a message takes one token or is dropped. now() is the clock in ms (tests pass a fake one). Pure: no DOM, no timers.
  const LIMITS = Object.freeze({
    room: Object.freeze({ cap: 60, n: 30, ms: 1000 }),          // every message from every sender in the room
    pid: Object.freeze({ cap: 6, n: 3, ms: 1000 }),             // messages from one known pid
    guess: Object.freeze({ cap: 3, n: 1, ms: 1000 }),           // guesses from one pid
    newPid: Object.freeze({ cap: 16, n: 16, ms: 60000 }),       // joins from pids the room has not seen (16: a real party of 8 phones joining at once, each retrying once, fits; GEO A 11-27)
    verify: Object.freeze({ cap: 20, n: 20, ms: 1000 }),        // signature checks in the whole room
    refusal: Object.freeze({ cap: 1, n: 1, ms: 2000 }),         // signed refusals sent to unknown pids
  });
  const LIMIT_PIDS = 200;          // at most this many pids kept per per-pid table; past it the one used longest ago is let go (it comes back with a full bucket)
  const defaultNow = () => (typeof performance !== 'undefined' && performance && typeof performance.now === 'function' ? performance.now() : Date.now());
  function bucket(spec, t0) {
    let tokens = spec.cap, last = t0;
    return t => {
      if (t > last) { tokens = Math.min(spec.cap, tokens + (t - last) * spec.n / spec.ms); last = t; }          // a clock that goes back gives nothing back
      if (tokens >= 1) { tokens -= 1; return true; }
      return false;
    };
  }
  function makeLimits(opts) {
    const now = opts && typeof opts.now === 'function' ? opts.now : defaultNow;
    const at = () => { const t = Number(now()); return Number.isFinite(t) ? t : 0; };
    const one = name => { const b = bucket(LIMITS[name], at()); return () => b(at()); };
    const perPid = name => {
      const map = new Map();
      return { size: () => map.size, take: p => {
        const key = String(p);
        let b = map.get(key);
        if (b) map.delete(key);          // move to the newest end
        else b = bucket(LIMITS[name], at());
        map.set(key, b);
        while (map.size > LIMIT_PIDS) map.delete(map.keys().next().value);
        return b(at());
      } };
    };
    const pidT = perPid('pid'), guessT = perPid('guess');
    return Object.freeze({
      room: one('room'), newPid: one('newPid'), verify: one('verify'), refusal: one('refusal'),
      pid: pidT.take, guess: guessT.take,
      tracked: () => ({ pid: pidT.size(), guess: guessT.size() }),          // how many pids each per-pid table holds now (never more than LIMIT_PIDS)
    });
  }

  // The part both kinds share: listeners, the check on the way in, and the check on the way out.
  function wrap(sendRaw, closeRaw) {
    const listeners = new Set();
    let closed = false;
    const deliver = payload => {
      if (closed) return;
      const msg = validate(payload);
      if (!msg) return;                                   // an invalid message is dropped without a word
      for (const cb of [...listeners]) { try { cb(msg); } catch { /* one listener's error does not stop the others */ } }
    };
    const api = Object.freeze({
      send(msg) {
        if (closed) return Promise.reject(new Error('This room connection is closed.'));
        const good = validate(msg);
        if (!good) return Promise.reject(new Error('That message is not one the game sends, so it was not sent.'));
        return Promise.resolve().then(() => sendRaw(good));
      },
      onMessage(cb) {
        if (typeof cb !== 'function') throw new Error('onMessage needs a function.');
        listeners.add(cb);
        return () => { listeners.delete(cb); };
      },
      close() {
        if (closed) return;
        closed = true; listeners.clear();
        try { closeRaw(); } catch { /* already gone */ }
      },
    });
    return { api, deliver };
  }

  function connectRealtime(opts) {
    const client = opts.client, code = normCode(opts.code);
    if (!client || typeof client.channel !== 'function') return Promise.reject(new Error('The live room needs the Supabase connection, and it is missing.'));
    if (!codeOk(code)) return Promise.reject(new Error(`A room code is ${CODE_LEN} letters with no I, no O and no numbers.`));
    return new Promise((resolve, reject) => {
      const channel = client.channel(channelName(code), { config: { broadcast: { self: false, ack: false } } });
      const { api, deliver } = wrap(
        async payload => {
          const r = await channel.send({ type: 'broadcast', event: 'msg', payload });
          if (r === 'error' || r === 'timed out') throw new Error('The message did not reach the room. Check the connection and try again.');
        },
        () => { client.removeChannel(channel); },
      );
      channel.on('broadcast', { event: 'msg' }, ev => deliver(ev && ev.payload));
      let settled = false;
      channel.subscribe(status => {
        if (settled) return;
        if (status === 'SUBSCRIBED') { settled = true; resolve(api); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          settled = true; api.close();
          reject(new Error(status === 'TIMED_OUT' ? 'The room took too long to answer. Check the connection and try again.' : 'Could not reach the room. Check the connection and try again.'));
        }
      });
    });
  }

  function connectRelay(opts) {
    const pageHost = typeof location !== 'undefined' && location ? String(location.hostname) : '';
    let baseUrl;
    try { baseUrl = new URL(String(opts.base)); } catch { return Promise.reject(new Error('The test relay address is not a web address.')); }
    if (!LOCAL_HOSTS.includes(pageHost) || !LOCAL_HOSTS.includes(baseUrl.hostname) || !/^https?:$/.test(baseUrl.protocol)) {
      return Promise.reject(new Error('The test relay runs only on this computer: both the page and the relay must be on 127.0.0.1, localhost or [::1].'));
    }
    const code = normCode(opts.code);
    if (!codeOk(code)) return Promise.reject(new Error(`A room code is ${CODE_LEN} letters with no I, no O and no numbers.`));
    const base = String(opts.base).replace(/\/+$/, '');
    const sid = randomFrom(SID_LETTERS, 16);
    const q = `room=${encodeURIComponent(code)}&sid=${encodeURIComponent(sid)}`;
    return new Promise((resolve, reject) => {
      const es = new EventSource(`${base}/stream?${q}`);
      const { api, deliver } = wrap(
        async payload => {
          const r = await fetch(`${base}/send?${q}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), keepalive: true });
          if (!r.ok) throw new Error('The test relay did not take the message.');
        },
        () => { es.close(); },
      );
      let opened = false;
      es.addEventListener('open', () => { if (!opened) { opened = true; resolve(api); } });
      es.addEventListener('error', () => { if (!opened) { opened = true; api.close(); reject(new Error('Could not reach the test relay on this computer.')); } });
      es.addEventListener('message', ev => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (!isObj(m) || m.sid === sid) return;            // never our own message back
        deliver(m.payload);
      });
    });
  }

  function connect(opts) {
    if (!isObj(opts)) return Promise.reject(new Error('connect needs its options.'));
    if (opts.kind === 'realtime') return connectRealtime(opts);
    if (opts.kind === 'relay') return connectRelay(opts);
    return Promise.reject(new Error("A room connection is 'realtime' or 'relay'."));
  }

  window.ryagramGameRoom = Object.freeze({ CODE_LETTERS, CODE_LEN, CODE_KDF, codeOf, normCode, showCode, channelName, validate, connect, MAX_BYTES, keyPair, pidOf, sign, verify,
    newNonce, makeLimits, LIMITS, LIMIT_PIDS, MAX_PLAYERS });
})();
