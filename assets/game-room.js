// GAMES 11-27: the ROOM for a live round of "Guess the next line". A room is how the host screen (the TV) and the players' phones talk to each other: the host makes a short code,
// players type it on their phones, and every message after that (join, guess, the round's state, the reveal) passes between the browsers in that room.
// NOTHING IS STORED. In the real room, Supabase Realtime BROADCAST passes each message from one browser to the others that are in the same room at that moment and keeps nothing:
// no table, no log, no replay. A phone that joins late sees only what is sent after it joined. Close the pages and the room is gone.
// A LIMIT TO SAY PLAINLY: a room code is only 6 letters, so anyone who knows (or guesses) the code while the room is open can join it and see what is sent in it. The code keeps out
// strangers who do not know it; it is not a password. Nothing private belongs in a room: a scoreboard name, a typed guess and the round's public text only.
// SIGNED (11-27): since anyone in the room can send, every join/guess/leave is signed by the phone's own key (its pid is made from that key) and every state/welcome/got by the
// host's key (sign/verify/keyPair/pidOf below). The host drops what a pid's key did not sign; a phone drops what the host key it pinned did not sign. A phone
// pins the host's key only from a welcome whose key gives the very code the player typed (codeOf), so a stranger who answers first cannot pose as the host: they would
// need a key whose SHA-256 maps to the same 6 letters (24^6, about 191 million keys to try on average, while the room is open). THE LIMIT LEFT: that search is possible
// for a determined attacker with time and hardware; and anyone with the code can still join under their own name and see the room's public text.
// Every message is checked both ways (validate): a message of an unknown kind, too long, or with a field out of range is refused when sent and dropped when received, unknown fields are
// removed, and invisible or control characters are cleaned out of every string.
// The 'relay' kind is FOR TESTS ON THIS COMPUTER ONLY: it talks to tools/game-relay.mjs on 127.0.0.1 and refuses to run unless both the page and the relay are on this computer.
(function () {
  const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';      // no I or O: on a TV across the room they read as 1 and 0
  const CODE_LEN = 6, MAX_BYTES = 8192;          // GAMES 11-27: 6 letters made from the host's public key (codeOf), so the code a player types also names the host's key
  const NAME_MAX = 16, ANSWER_MAX = 120, PROBLEM_MAX = 200, HEARD_MAX = 400, VERDICT_MAX = 20, MAX_PLAYERS = 12;
  const PHASES = ['lobby', 'question', 'reveal', 'final'];
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
  const KINDS = {
    join: { need: { pid, name }, may: WITH_PUB },
    welcome: { need: { pid, ok: v => typeof v === 'boolean' ? v : BAD }, may: { problem: v => text(v, 0, PROBLEM_MAX), ...WITH_PUB } },
    guess: { need: { pid, round: v => int(v, 0, 99), text: v => text(v, 1, ANSWER_MAX) }, may: SIGNED },
    got: { need: { pid, round: v => int(v, 0, 99) }, may: SIGNED },
    state: {
      need: { phase: v => PHASES.includes(v) ? v : BAD, round: v => int(v, 0, 99), of: v => int(v, 0, 99), players: v => list(v, MAX_PLAYERS, name) },
      may: { answered: v => list(v, MAX_PLAYERS, name), heard_text: v => text(v, 0, HEARD_MAX), words_left: v => int(v, 0, 50), left_s: v => int(v, 0, 600), reveal, totals: v => list(v, MAX_PLAYERS, total),
             mode: v => (MODES.includes(v) ? v : BAD), ...SIGNED },          // GAMES 11-27: which game the round is ('line' = Guess the next line, 'gap' = Fill the gap); absent means 'line'
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
    return out;
  }

  // GAMES 11-27: SIGNED MESSAGES. There is no server to say who sent what (a broadcast reaches everyone in the room, and anyone with the code can send), so each sender signs.
  // A phone makes an ECDSA P-256 key pair on its first join; its player id IS the first 20 letters and digits of base64url(SHA-256(raw public key)), so a pid cannot be used
  // with another key. The host remembers each pid's key and last seq; the phone pins the host's key from the welcome sent to it. Host and phones share these four functions.
  // What is signed: a fixed label, the room code and the message as validate cleans it, every field but sig, keys in sorted order (so the bytes are the same on both sides).
  const ALG = { name: 'ECDSA', namedCurve: 'P-256' }, SIGN_ALG = { name: 'ECDSA', hash: 'SHA-256' };
  const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const subtle = () => { const c = typeof crypto !== 'undefined' ? crypto : null; if (!c || !c.subtle) throw new Error('This browser cannot sign game messages (no crypto.subtle).'); return c.subtle; };
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
    return new TextEncoder().encode('ryagram-game-sig-1\n' + normCode(code) + '\n' + JSON.stringify(sorted(v)));
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
  // The ROOM CODE of a host key: SHA-256 of the raw key, its bytes below 240 taken in order (240 = 10 x 24, so no letter is more likely), each mod 24 onto CODE_LETTERS.
  // The host's room code is codeOf(its own key), so the code a player reads off the host's screen binds the host key: a phone pins only a key whose code is the code it typed.
  async function codeOf(pub) {
    const raw = typeof pub === 'string' && B64U_KEY.test(pub) ? unb64u(pub) : null;
    if (!raw) return '';
    let out = '', bytes = new Uint8Array(await subtle().digest('SHA-256', raw));
    for (;;) {
      for (const b of bytes) if (b < 240 && out.length < CODE_LEN) out += CODE_LETTERS[b % 24];
      if (out.length === CODE_LEN) return out;
      bytes = new Uint8Array(await subtle().digest('SHA-256', bytes));          // fewer than 6 usable bytes in 32 (about 1 in 10^25): hash again
    }
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

  window.ryagramGameRoom = Object.freeze({ CODE_LETTERS, CODE_LEN, codeOf, normCode, channelName, validate, connect, MAX_BYTES, keyPair, pidOf, sign, verify });
})();
