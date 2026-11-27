// GAMES 11-27: the ROOM for a live round of "Guess the next line". A room is how the host screen (the TV) and the players' phones talk to each other: the host makes a short code,
// players type it on their phones, and every message after that (join, guess, the round's state, the reveal) passes between the browsers in that room.
// NOTHING IS STORED. In the real room, Supabase Realtime BROADCAST passes each message from one browser to the others that are in the same room at that moment and keeps nothing:
// no table, no log, no replay. A phone that joins late sees only what is sent after it joined. Close the pages and the room is gone.
// A LIMIT TO SAY PLAINLY: a room code is only 4 letters, so anyone who knows (or guesses) the code while the room is open can join it and see what is sent in it. The code keeps out
// strangers who do not know it; it is not a password. Nothing private belongs in a room: a scoreboard name, a typed guess and the round's public text only.
// Every message is checked both ways (validate): a message of an unknown kind, too long, or with a field out of range is refused when sent and dropped when received, unknown fields are
// removed, and invisible or control characters are cleaned out of every string.
// The 'relay' kind is FOR TESTS ON THIS COMPUTER ONLY: it talks to tools/game-relay.mjs on 127.0.0.1 and refuses to run unless both the page and the relay are on this computer.
(function () {
  const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';      // no I or O: on a TV across the room they read as 1 and 0
  const CODE_LEN = 4, MAX_BYTES = 8192;
  const NAME_MAX = 16, ANSWER_MAX = 120, PROBLEM_MAX = 200, HEARD_MAX = 400, VERDICT_MAX = 20, MAX_PLAYERS = 12;
  const PHASES = ['lobby', 'question', 'reveal', 'final'];
  const MODES = ['line', 'gap'];
  const LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]', '::1'];
  const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;
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
  const newCode = () => randomFrom(CODE_LETTERS, CODE_LEN);

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

  // Each kind of message: its required fields and its optional ones (left out when absent; a present but wrong optional field refuses the whole message).
  const KINDS = {
    join: { need: { pid, name } },
    welcome: { need: { pid, ok: v => typeof v === 'boolean' ? v : BAD }, may: { problem: v => text(v, 0, PROBLEM_MAX) } },
    guess: { need: { pid, round: v => int(v, 0, 99), text: v => text(v, 1, ANSWER_MAX) } },
    got: { need: { pid, round: v => int(v, 0, 99) } },
    state: {
      need: { phase: v => PHASES.includes(v) ? v : BAD, round: v => int(v, 0, 99), of: v => int(v, 0, 99), players: v => list(v, MAX_PLAYERS, name) },
      may: { answered: v => list(v, MAX_PLAYERS, name), heard_text: v => text(v, 0, HEARD_MAX), words_left: v => int(v, 0, 50), left_s: v => int(v, 0, 600), reveal, totals: v => list(v, MAX_PLAYERS, total),
             mode: v => (MODES.includes(v) ? v : BAD) },          // GAMES 11-27: which game the round is ('line' = Guess the next line, 'gap' = Fill the gap); absent means 'line'
    },
    leave: { need: { pid } },
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
          const r = await fetch(`${base}/send?${q}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
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

  window.ryagramGameRoom = Object.freeze({ CODE_LETTERS, CODE_LEN, newCode, normCode, channelName, validate, connect, MAX_BYTES });
})();
