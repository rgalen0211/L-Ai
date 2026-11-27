// GAMES 11-27 (Claude 08:10, the Games department live behind the switch `games`): the HOST screen of a LIVE round of "Guess the next line", on the
// Games department page (#/d/games) for a signed-in account whose switch list names `games` (featureOn('games') in assets/app-switches.js).
// The host's screen opens a room with a code (assets/game-room.js: Supabase Realtime broadcast on uselai.com, a test relay on 127.0.0.1 only),
// players join on their phones at /game-phone/, each round shows what was said so far, the phones send typed guesses, and THIS screen scores them with
// the engine's own rules (assets/game-score.js, proven equal to ryagram/games/guess_line.py by tests/game-score.test.mjs) and sends the answer and the points.
// The rounds are FIVE made-up rounds made by the real engine over a MADE-UP transcript (assets/game-rounds.js): no real show, person or clip, and no video
// (the host reads the line aloud). Nothing is stored: no table, no file, no account row; closing the page ends the room. Words are drafts FOR RYAN'S YES.
// SIGNED (11-27): the room has no server, so this screen checks every join/guess/leave against the key its player id is made from (and a seq above the last one), and signs
// everything it sends with its own key. The ROOM CODE is made from that key (ryagramGameRoom.codeOf), and a phone pins the host key only when it gives the code typed.
// Joins are limited to 3 per pid in 10 s; a refused join keeps no seat and no key; names are compared in NFKC lower case and host/ryagram/admin are kept for the game.
// A refused join leaves its pid's seq behind for the whole room, so replaying it later cannot seat that pid; kept keys are bounded per room and never let go while seated or recently gone.
// ROOM SAFETY (11-27 holds, FACES-GAMES-ROOM-SAFETY-1127 sections 1, 3.2-3.3, 5; the shared contract holds-contract-1127 section 2):
// - Seats line (`Seats: 3 of 8 taken`), each player with Remove and an INLINE confirm (Escape keeps the player), an `Allow again` undo, Lock/Unlock with its words, the room locks
//   itself when the game starts, and `New room code` in the lobby (closes this room with a signed 'closed' state, makes a new key, so a new code, and empty seats).
// - A removed pid goes in s.banned and is dropped BEFORE any signature check; its name is refused for the rest of the lobby. Being honest: a new key is a new pid, so a
//   person can come back under a new key; Lock the room and New room code are what really stop them (the help line says so).
// - checked(m) runs the cheap checks first (FACES 3.2): closed, banned, the room bucket, the seq, a reused join nonce, the new-pid bucket (strikes), then
//   an UNKNOWN pid on a full, locked or started room gets one rate-limited signed refusal WITHOUT any verify; only then the verify bucket and Room.verify, and only
//   after a good signature the per-pid and guess buckets (a forged message under a real player's pid must not spend that player's tokens).
// - IDLE (hold 3): 15 minutes with no join, guess, leave or host press (outside a running question round) closes the room: a 2-minute warning with `Keep the room open`,
//   then one signed state phase 'closed' why 'idle', every timer and the 5 s beat stopped, the room left, and a button to open a new room.
(function () {
  const MAX_PLAYERS = 8, ROUND_SECONDS = 45;
  const IDLE_MS = 15 * 60000, WARN_MS = 2 * 60000;          // the room closes after 15 minutes with nothing happening; the warning comes 2 minutes before
  const local = () => ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  const on = () => !!(window.ryagramSwitches && window.ryagramSwitches.featureOn('games'));

  function roomOptions(cfg, code) {
    const q = new URLSearchParams(location.search);
    if (local() && q.get('relay')) return { kind: 'relay', base: q.get('relay'), code };
    if (!window.supabase || !cfg || !cfg.supabaseUrl || !cfg.supabaseKey) return null;
    const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    return { kind: 'realtime', client, code };
  }

  // Pure helpers (tested in node).
  // GAMES 11-27: names are compared in NFKC and lower case, so a look-alike (full-width letters, a ligature, other case) counts as the same name; a few names are kept for the game.
  const RESERVED_NAMES = ['host', 'ryagram', 'admin'];
  // 11-27 (red team MEDIUM 7): names and the kept names are compared on a simple CONFUSABLE SKELETON: NFKC, lower case, marks stripped, common Cyrillic and Greek look-alikes
  // mapped to Latin, and everything but letters and digits dropped ('Ana!', 'A n a' and Cyrillic 'Ana' are one name). A name must have a letter or a digit, at most 2 combining
  // marks, and none of the characters that show as nothing (default-ignorable, Hangul fillers, the braille blank, tag characters).
  const LOOK_FROM = '\u0430\u0435\u043e\u0440\u0441\u0443\u0445\u0456\u0458\u0455\u0501\u03b1\u03bf\u03c1\u03bd\u03b9\u03ba\u03c7\u03b5\u03c5\u03c4\u04bb\u051b\u051d\u1d00\u0299\u1d04\u1d05\u1d07\u0262\u029c\u026a\u1d0a\u1d0b\u029f\u1d0d\u0274\u1d0f\u1d18\u0280\ua731\u1d1b\u1d1c\u1d20\u1d21\u028f\u1d22', LOOK_TO = 'aeopcyxijsdaopvikxeuthqwabcdeghijklmnoprstuvwyz';          // Cyrillic, Greek and small-capital look-alikes
  const BLANKISH = /[\p{Default_Ignorable_Code_Point}\u3164\uffa0\u115f\u1160\u2800\ufff9-\ufffb\u{e0000}-\u{e007f}]/u;
  const fold = n => String(n).normalize('NFKC').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/[^\x00-\x7f]/g, c => { const i = LOOK_FROM.indexOf(c); return i >= 0 ? LOOK_TO[i] : c; }).replace(/[^\p{L}\p{N}]+/gu, '');
  function nameProblem(name, players) {
    if (!name) return 'Type a name for the scoreboard.';
    if (BLANKISH.test(name) || !/[\p{L}\p{N}]/u.test(name) || (String(name).normalize('NFC').match(/\p{M}/gu) || []).length > 2) return 'That name has characters that do not show. Use letters and numbers in your name.';
    if (RESERVED_NAMES.includes(fold(name).trim())) return 'That name is kept for the game itself. Pick another name.';
    if (players.some(p => fold(p.name) === fold(name))) return 'Someone in this room already has that name. Add a letter or pick another.';
    if (players.length >= MAX_PLAYERS) return `This room is full (${MAX_PLAYERS} players).`;
    return null;
  }
  function ranks(totals) {
    const sorted = [...totals].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    let place = 0, last = null;
    return sorted.map((t, i) => { if (t.total !== last) { place = i + 1; last = t.total; } return { ...t, place }; });
  }
  function scoreRound(Score, round, players, guesses) {
    return players.map(p => {
      const text = guesses.get(p.pid) || '';
      const r = Score.scoreGuess(round, text);
      const verdict = round.answer.length === 1 && r.marks[0] && r.marks[0].mark === 'near' ? 'close, a near form' : r.verdict;        // one-word answers (Fill the gap): 'a few words' read oddly; the points are the engine's, unchanged
      return { name: p.name, points: r.points, verdict, text, marks: r.marks };
    });
  }

  // THE WORDS (FACES sections 1 and 5). What a refused phone is told (the phone shows its own words by `why`; the host sends the same sentence in `problem` too).
  const KICKED_TEXT = 'The host removed you from this game.', LOCKED_TEXT = 'The room is locked. Ask the host to unlock it.';
  const STARTED_TEXT = 'This game has already started. Wait for the next one.', REMOVED_NAME_TEXT = 'Please pick a different name.';
  const FULL_TEXT = `Room is full. All ${MAX_PLAYERS} seats are taken. Ask the host to remove someone, or wait for the next game.`;
  const WHY_OF = { [KICKED_TEXT]: 'removed', [LOCKED_TEXT]: 'locked', [STARTED_TEXT]: 'started', [FULL_TEXT]: 'full' };
  const TEXT_OF = { removed: KICKED_TEXT, locked: LOCKED_TEXT, started: STARTED_TEXT, full: FULL_TEXT };
  // What the host screen says.
  const STATEMENT = 'The room code is the only lock on this game. Anyone who has the code can join, see the names and the questions, and see what players type. Do not post it or share it with people you do not want in the game. If someone you do not know joins, press Remove, then Lock the room.';
  const HELP_TEXT = 'If someone keeps coming back, lock the room or start a new room code.';
  const COURTESY_TEXT = 'Remove is a courtesy, not a ban: someone removed can come back from a new browser. Lock the room or start a new room code to keep them out.';          // RENDERER 11:45
  const PUBLIC_TEXT = 'A room is a public channel: it is not stranger-proof.';
  const AUTO_LOCK_TEXT = 'The room locked when the game started.';
  const STRIKES_TEXT = 'Lots of tries to join this room. Lock the room?';
  const IDLE_WARN_TEXT = 'This room closes in 2 minutes because nothing has happened. Press Keep the room open to stay.';
  const IDLE_CLOSED_TEXT = 'The room closed after 15 minutes with nothing happening. Open a new room to play again.';
  const seatsText = n => (n >= MAX_PLAYERS ? `Seats: ${n} of ${MAX_PLAYERS} taken. The room is full.` : `Seats: ${n} of ${MAX_PLAYERS} taken`);
  const lockNoteText = locked => (locked ? 'Locked: nobody new can join. Players already in can still rejoin.' : 'Open: anyone with the code can join.');

  function mount(root, opts) {
    const { h, Room, Score, Rounds, GapRounds, cfg, seconds } = opts;
    const secs = seconds || ROUND_SECONDS;
    // IDLE_MS / WARN_MS / now / timers can be given by tests (small numbers or a fake clock); the page uses the real ones.
    const idleMs = opts.IDLE_MS > 0 ? opts.IDLE_MS : IDLE_MS;
    const warnMs = opts.WARN_MS > 0 && opts.WARN_MS < idleMs ? opts.WARN_MS : Math.min(WARN_MS, Math.floor(idleMs / 2));
    const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    const T = opts.timers || {};
    const later = (fn, ms) => {
      const set = T.setTimeout || (typeof setTimeout === 'function' ? setTimeout : null); if (!set) return null;
      const id = set(fn, ms); if (id && typeof id.unref === 'function') id.unref(); return id;          // unref: a test process is never kept alive by the idle clock
    };
    const unlater = id => { if (id == null) return; const clear = T.clearTimeout || (typeof clearTimeout === 'function' ? clearTimeout : null); if (clear) clear(id); };
    const every = (fn, ms) => (T.setInterval || setInterval)(fn, ms);
    const unevery = id => { if (id != null) (T.clearInterval || clearInterval)(id); };
    const Names = () => opts.Names || (typeof window !== 'undefined' && window.ryagramGameNames) || null;          // assets/game-names.js when it is loaded
    const nameKey = n => { const N = Names(); return N && typeof N.nameKey === 'function' ? N.nameKey(n) : fold(n); };
    const shownCode = () => (typeof Room.showCode === 'function' ? Room.showCode(s.code) : s.code);
    const q = sel => (stage.querySelector ? stage.querySelector(sel) : null);
    const show = (el, kids) => { el.replaceChildren(...kids); if (kids.length) { if (typeof el.removeAttribute === 'function') el.removeAttribute('hidden'); } else el.setAttribute('hidden', ''); };

    // s.closed: no room is open (before the first one opens, after an idle close or New room code, after the page is left). s.unmounted: the page itself is gone.
    const s = { code: '', conn: null, off: null, players: [], phase: 'lobby', round: -1, guesses: new Map(), totals: new Map(), left: 0, timer: null, results: null, closed: true, unmounted: false };
    const live = h('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite', id: 'gh-live' });
    const stage = h('div', { class: 'gh-stage' });
    const status = h('p', { class: 'form-note', id: 'gh-status', role: 'status' }, 'Opening a room\u2026');
    const strikeBox = h('p', { class: 'form-note gh-strikes', id: 'gh-strikes', role: 'status', hidden: true });
    const idleBox = h('div', { class: 'form-note gh-idle', id: 'gh-idle', role: 'status', hidden: true });
    const joinUrl = `${location.origin}/game-phone/`;
    // GAMES 11-27: two modes. 'line' = Guess the next line (assets/game-rounds.js); 'gap' = Fill the gap (assets/game-gap-rounds.js: a line with ONE word hidden, scored by the
    // same engine rules on a one-word answer). The gap mode is offered only when its rounds are loaded.
    const MODE_ROUNDS = { line: Rounds, gap: GapRounds || (typeof window !== 'undefined' && window.ryagramGameGapRounds) || null };
    s.mode = 'line';
    let rounds = Rounds.rounds;
    const setMode = m => { if (s.phase !== 'lobby' || !MODE_ROUNDS[m]) return; s.mode = m; rounds = MODE_ROUNDS[m].rounds; draw(); const r = stage.querySelector && stage.querySelector(`#gh-mode-${m}`); if (r) r.focus(); broadcast(); };        // focus back on the chosen radio (verify M1)

    const publicState = () => {
      const base = { t: 'state', mode: s.mode, phase: s.phase, round: Math.max(0, s.round), of: rounds.length, players: s.players.map(p => p.name) };
      if (s.phase === 'question') { const r = rounds[s.round].public; return { ...base, heard_text: s.mode === 'gap' ? r.shown_text : r.heard_text, words_left: r.words_left, left_s: s.left, answered: s.players.filter(p => s.guesses.has(p.pid)).map(p => p.name) }; }
      if (s.phase === 'reveal') return { ...base, reveal: { answer_text: rounds[s.round].public && rounds[s.round].answer.map(w => w.word).join(' '), results: s.results.map(({ name, points, verdict, text }) => ({ name, points, verdict, text })) }, totals: totalsList() };
      if (s.phase === 'final') return { ...base, totals: totalsList() };
      return base;
    };
    const totalsList = () => ranks(s.players.map(p => ({ name: p.name, total: s.totals.get(p.pid) || 0 }))).map(({ name, total }) => ({ name, total }));        // ranked, so every phone lists the same order (GAMES a11y audit 5)
    const active = () => s.players.filter(p => !p.gone);
    const endDot = t => String(t).replace(/[.!?]+$/, '');          // the answer may end with its own full stop: never two (audit 8)
    // SIGNED ROOM (11-27): every message this screen sends carries the next seq and this screen's signature, sent one after another so the seq order is the arrival order;
    // a welcome also carries this screen's public key, which the phone pins. Every join/guess/leave is checked first (checked() below); anything that fails is dropped unanswered.
    // The seq is never restarted while this page lives (not on Play again, not on a new room code), so a phone never mistakes a new message for an old one.
    // The key, code and connection are taken when a message is queued, so the room's last 'closed' state still goes out signed by the room it closes.
    s.seq = 0; s.joinNonce = ''; s.outQ = Promise.resolve(); s.inQ = Promise.resolve(); s.waiting = 0;
    const post = msg => {
      const conn = s.conn, pair = s.pair, code = s.code;
      const p = s.outQ.then(async () => { if (!conn || !pair) throw new Error('closed'); s.seq += 1; await conn.send(await Room.sign(pair, code, { ...msg, seq: s.seq })); });
      s.outQ = p.catch(() => {});
      return p;
    };
    // The nonce a welcome carries: the join's own (echoed, so the phone knows the answer is to THIS join), else the last one this pid joined with, else a new one.
    const nonceField = (pid, nonce) => { const n = nonce || s.joinNonce || s.nonceOf.get(pid) || (typeof Room.newNonce === 'function' ? Room.newNonce() : ''); return n ? { nonce: n } : {}; };
    // a welcome that lets a player in carries the name the host seated them under (a rejoin typed 'ben' for 'Ben' is still Ben), so the phone finds itself in results and totals;
    // a refusal carries `why` (removed, full, locked, started, name) for the phone's own words, and the same sentence in `problem`.
    const welcome = (pid, ok, problem, name, force, nonce) => (!ok && !force && !within(s.refusals, REFUSALS, REFUSAL_MS)) ? Promise.resolve() : post({ t: 'welcome', pid, ok, pub: s.pair.pub, ...(problem ? { problem } : {}), ...(!ok ? { why: WHY_OF[problem] || 'name' } : {}), ...nonceField(pid, nonce), ...(ok && name ? { name } : {}) }).catch(() => {});
    const openText = () => `Room ${shownCode()} is open.`;
    const broadcast = () => { if (s.conn && !s.closed) post(publicState()).then(() => { if (s.sendFailed) { s.sendFailed = false; status.textContent = openText(); } }, () => { s.sendFailed = true; status.textContent = 'A message did not reach the phones. It is sent again every 5 seconds.'; }); };
    const stopTimer = () => { unevery(s.timer); s.timer = null; };

    // A join must carry the key its pid is made from and be signed by it. The key of a player who got IN is remembered (even after a leave, so an old message cannot be
    // replayed), and every later join/guess/leave from that pid must be signed by the SAME key with a seq above the last one taken. A refused join keeps no key and no seat
    // (only its pid's last seq, below); at most JOIN_LIMIT good joins per pid in JOIN_WINDOW_MS are taken.
    // 11-27 (WORKER LOWs, red team 6a/9a/9e): EVERY pid's last seq is kept for the whole room (pid -> seq only, never let go), so no old message of any pid (seated, gone,
    // removed or refused) is ever taken twice: a replayed refused join seats no one, even after many join/leave cycles. Kept KEYS are bounded at KEEP_KEYS: a new player's key
    // is taken only when there is room after letting go keys of players gone longer than GONE_KEEP_MS, so cycling throwaway pids never pushes out a seated or recently-gone
    // player's key (new joins are dropped instead). Room-wide limits: at most ROOM_JOINS new pids in ROOM_JOIN_MS, at most REFUSALS refusal welcomes in REFUSAL_MS (past
    // that a join gets no answer), at most GUESSES guesses per pid in GUESS_MS (the rest dropped unanswered), and at most one 'got' waiting to be sent per pid.
    // 11-27 holds: on top of those, the room, new-pid and verify buckets of Room.makeLimits (FACES 3.1) run BEFORE any signature check, the per-pid and guess buckets after a good one; at most IN_WAIT messages wait to be checked (newer dropped).
    // THE LIMIT: a flood can still keep NEW players out for a while (they see 'No room answered'); the host sees the strikes notice and can lock the room or remove fake players.
    const JOIN_LIMIT = 3, JOIN_WINDOW_MS = 10000, KEEP_KEYS = 96, GONE_KEEP_MS = 10 * 60000, ROOM_JOINS = 8, ROOM_JOIN_MS = 5000, REFUSALS = 10, REFUSAL_MS = 5000, GUESSES = 2, GUESS_MS = 1000;
    const IN_WAIT = 50, NONCE_RING = 200, NONCE_OF_MAX = 200, STRIKES = 20, STRIKE_MS = 60000;
    const PASS = () => true;
    // Room.makeLimits is the room library's (assets/game-room.js); a page with an older library gets no buckets (the older limits above still hold).
    const makeLim = () => (typeof Room.makeLimits === 'function' ? Room.makeLimits({ now }) : { room: PASS, pid: PASS, guess: PASS, newPid: PASS, verify: PASS, refusal: PASS });
    let lim = makeLim();
    // Everything that belongs to ONE room (a new room code starts it all again; s.seq is not in here).
    const fresh = () => {
      s.joinTimes = new Map(); s.lastSeq = new Map(); s.roomJoins = []; s.refusals = []; s.guessTimes = new Map(); s.gotPending = new Set(); s.keys = new Map();
      s.banned = new Set(); s.removed = new Map(); s.removedNames = new Set(); s.locked = false; s.lockedByHost = false; s.rows = new Map();
      s.nonceSeen = new Set(); s.nonceRing = []; s.nonceOf = new Map(); s.strikes = 0; s.strikeT0 = 0;
      s.players = []; s.phase = 'lobby'; s.round = -1; s.guesses = new Map(); s.totals = new Map(); s.results = null; s.left = 0; s.sendFailed = false;
      lim = makeLim();
    };
    fresh();
    const lastSeqOf = pid => (s.lastSeq.has(pid) ? s.lastSeq.get(pid) : -1);
    const within = (list, n, ms) => { const t = now(); while (list.length && t - list[0] >= ms) list.shift(); if (list.length >= n) return false; list.push(t); return true; };
    const guessAllowed = pid => { const l = s.guessTimes.get(pid) || []; s.guessTimes.set(pid, l); return within(l, GUESSES, GUESS_MS); };
    const seated = pid => s.players.some(p => p.pid === pid);
    const unseat = pid => { const k = s.keys.get(pid); if (k) k.left = now(); };
    const roomForKey = () => {
      if (s.keys.size < KEEP_KEYS) return true;
      const t = now();
      const old = [...s.keys].filter(([p, k]) => !seated(p) && k.left && t - k.left > GONE_KEEP_MS).sort((a, b) => a[1].left - b[1].left);
      for (const [p] of old) { s.keys.delete(p); if (s.keys.size < KEEP_KEYS) return true; }
      return false;
    };
    const joinAllowed = pid => {
      const t = now();
      for (const [p, ts] of s.joinTimes) { const keep = ts.filter(x => t - x < JOIN_WINDOW_MS); if (keep.length) s.joinTimes.set(p, keep); else s.joinTimes.delete(p); }
      const ts = s.joinTimes.get(pid) || [];
      if (ts.length >= JOIN_LIMIT) return false;
      ts.push(t); s.joinTimes.set(pid, ts); return true;
    };
    const remember = (pid, pub, seq) => {
      const k = s.keys.get(pid);
      if (k) { k.seq = seq; if (seated(pid)) k.left = null; return; }
      s.keys.set(pid, { pub, seq, left: null });
    };
    // the last NONCE_RING join nonces taken: a join that comes again with one of them is dropped before any verify (a recorded join cannot be replayed)
    const nonceTaken = nonce => {
      if (!nonce || s.nonceSeen.has(nonce)) return;
      s.nonceSeen.add(nonce); s.nonceRing.push(nonce); if (s.nonceRing.length > NONCE_RING) s.nonceSeen.delete(s.nonceRing.shift());
    };
    // the nonce of the join that SEATED a pid (a rejoin replaces it): an unsolicited welcome to that pid (a removal) carries it, as the phone expects
    const seatNonce = (pid, nonce) => { if (!nonce) return; s.nonceOf.delete(pid); s.nonceOf.set(pid, nonce); if (s.nonceOf.size > NONCE_OF_MAX) s.nonceOf.delete(s.nonceOf.keys().next().value); };
    // STRIKES (FACES 3.3): joins from new pids dropped by the bucket, or refused because the room is full, locked or started; 20 in a minute and the host is offered the lock.
    const strike = () => {
      const t = now();
      if (!s.strikeT0 || t - s.strikeT0 >= STRIKE_MS) { s.strikeT0 = t; s.strikes = 0; }
      s.strikes += 1;
      if (s.strikes >= STRIKES) showStrikes();
    };
    function showStrikes() {
      if (s.closed || s.locked || s.strikesShown) return;
      s.strikesShown = true;
      show(strikeBox, [STRIKES_TEXT, ' ', h('button', { class: 'button secondary', type: 'button', id: 'gh-strike-lock', onclick: act(() => setLock(true)) }, 'Lock the room')]);
    }
    const hideStrikes = () => { s.strikesShown = false; show(strikeBox, []); };
    // An UNKNOWN pid asking to join a full, locked or started room: at most one signed refusal per 2 s for the whole room (lim.refusal), the rest get no answer and cost
    // no signature check. Round 2 (CC1 MUST, 11-27): a join that IS answered is verified first (one check per 2 s at most, from the verify bucket too), and only a join that
    // verifies has its nonce (the nonce ring) and its pid's seq recorded before the refusal goes out, so the same recorded join cannot seat a ghost after Unlock or Play
    // again. A join dropped by either bucket, or one that does not verify, records NOTHING (an unverified seq is never kept: a forged high seq would lock a real player out).
    async function refuseUnknown(m, why) {
      if (!lim.refusal() || !lim.verify()) return;
      if (!m.pub || (await Room.pidOf(m.pub)) !== m.pid) return;
      if (!(await Room.verify(m.pub, s.code, m))) return;
      if (s.closed || s.banned.has(m.pid) || m.seq <= lastSeqOf(m.pid) || (m.nonce && s.nonceSeen.has(m.nonce))) return;
      s.lastSeq.set(m.pid, m.seq); nonceTaken(m.nonce);          // recorded: this join can never be taken again
      welcome(m.pid, false, TEXT_OF[why], null, false, m.nonce || '');
    }

    // FACES 3.2: cheap checks first. Room.validate already ran in the room connection (format and length only, no crypto; it refuses a join without a nonce).
    async function checked(m) {
      if (!m) return;
      if (s.closed || !['join', 'guess', 'leave'].includes(m.t) || !Number.isInteger(m.seq)) return;
      if (s.banned.has(m.pid)) return;                                // 2. a removed pid never costs a signature check again
      if (!lim.room()) return;                                        // 3. all senders together
      const known = s.keys.get(m.pid);
      if (known && m.seq <= known.seq) return;                        // 4. the stale seq (the per-pid buckets wait for the signature: see 7b)
      if (m.seq <= lastSeqOf(m.pid)) return;          // the room keeps every pid's last seq: a replay (of a refused join too) is never taken
      if (m.t === 'join' && m.nonce && s.nonceSeen.has(m.nonce)) return;          // a join nonce seen before: a replayed join
      if (m.t === 'join' && !known && !seated(m.pid)) {
        if (!lim.newPid()) { strike(); return; }                      // 5. new pids for the whole room
        const why = s.phase !== 'lobby' ? 'started' : s.locked ? 'locked' : s.players.length >= MAX_PLAYERS ? 'full' : '';
        if (why) { strike(); await refuseUnknown(m, why); return; }   // 6. no seat for a stranger: no verify unless the refusal is answered
      }
      let pub;
      if (m.t === 'join') {
        if (!m.pub || (known && known.pub !== m.pub)) return;
        if ((await Room.pidOf(m.pub)) !== m.pid) return;
        pub = m.pub;
      } else {
        if (!known) return;
        pub = known.pub;
      }
      if (!lim.verify()) return;                                      // 7. signature checks for the whole room
      if (!(await Room.verify(pub, s.code, m))) return;
      if (s.closed || s.banned.has(m.pid)) return;                    // the room closed, or the host removed this pid, while it was being checked
      const now = s.keys.get(m.pid);                      // checked again: another message for this pid may have been taken while this one was being verified
      if ((now && (now.pub !== pub || m.seq <= now.seq)) || m.seq <= lastSeqOf(m.pid)) return;
      if (m.t === 'join' && m.nonce && s.nonceSeen.has(m.nonce)) return;
      s.lastSeq.set(m.pid, m.seq);
      if (m.t !== 'join') now.seq = m.seq;
      // 7b. per pid, only AFTER the signature: the pid a message claims is not proven before it, so a stranger forging messages under a seated player's pid would
      // otherwise drain that player's tokens and silence them (host builder 11-27). Forged floods still cost at most the room and verify buckets (20 checks a second).
      if (!lim.pid(m.pid) || (m.t === 'guess' && !lim.guess(m.pid))) return;
      if (m.t !== 'join') { if (m.t === 'guess' && !guessAllowed(m.pid)) return; onMessage(m); return; }
      if (!now && (!roomForKey() || !within(s.roomJoins, ROOM_JOINS, ROOM_JOIN_MS))) return;
      if (!joinAllowed(m.pid)) return;
      nonceTaken(m.nonce);
      s.joinNonce = m.nonce || '';
      onMessage(m);
      s.joinNonce = '';
      if (now || seated(m.pid)) remember(m.pid, pub, m.seq);          // only a player who got in (or was in) keeps a key
    }
    const take = m => {
      if (s.waiting >= IN_WAIT) return;                               // the queue waiting for checks is capped; newer messages are dropped
      s.waiting += 1;
      s.inQ = s.inQ.then(() => checked(m)).catch(() => {}).then(() => { s.waiting -= 1; });
    };

    // The name check for a NEW player: the shared name rules (assets/game-names.js) when loaded, else this file's own.
    const joinNameProblem = name => {
      const N = Names();
      if (N && typeof N.problem === 'function') { const p = N.problem(name, s.players.map(x => x.name)); return p ? String(p.words || REMOVED_NAME_TEXT) : null; }
      return nameProblem(name, s.players);
    };

    // Only an ACCEPTED message counts as something happening for the idle clock (GEO LOW 11-27): a refused join, a leave or guess that is not taken, or anything that
    // fails its checks never touches it, so someone with the code cannot keep an empty lobby open forever.
    const seen = () => touch();
    function onMessage(m) {
      if (s.closed) return;
      if (m.t === 'join') {
        if (s.banned.has(m.pid)) return;
        const known = s.players.find(p => p.pid === m.pid);
        if (known) { known.gone = false; seatNonce(m.pid, s.joinNonce); welcome(m.pid, true, null, known.name); seen(); broadcast(); refresh(); return; }
        if (s.phase !== 'lobby') { welcome(m.pid, false, STARTED_TEXT); return; }
        // F1 (11-27): a pid that held a seat in this room (its key is kept: a lobby leave, a page reload) is not a stranger, so a lock does not keep it out
        // ('Players already in can still rejoin'); it still needs a free seat. A truly new pid gets 'locked'. A removed pid never gets here (banned).
        if (s.locked && !s.keys.has(m.pid)) { welcome(m.pid, false, LOCKED_TEXT); return; }
        if (s.players.length >= MAX_PLAYERS) { welcome(m.pid, false, FULL_TEXT); return; }
        if (s.removedNames.has(nameKey(m.name))) { welcome(m.pid, false, REMOVED_NAME_TEXT); return; }          // a removed player's name, for the rest of this lobby
        const problem = joinNameProblem(m.name);
        if (problem) { welcome(m.pid, false, problem); return; }
        s.players.push({ pid: m.pid, name: m.name }); s.totals.set(m.pid, 0); seatNonce(m.pid, s.joinNonce); seen();
        welcome(m.pid, true, null, m.name);
        live.textContent = `${m.name} joined.`;
        refresh(); broadcast(); return;
      }
      if (m.t === 'leave') {
        const who = s.players.find(p => p.pid === m.pid); if (!who) return;
        seen();
        live.textContent = `${who.name} left.`;                  // audit 10
        if (s.phase === 'lobby') { s.players = s.players.filter(p => p.pid !== m.pid); s.totals.delete(m.pid); unseat(m.pid); refresh(); broadcast(); return; }
        who.gone = true;                                          // after the start a player keeps their place on this game's scoreboard; Play again drops them (audit 3)
        if (s.phase === 'question' && active().length && active().every(p => s.guesses.has(p.pid))) reveal(`${who.name} left.`); else refresh();        // the leave is said WITH the answer, not overwritten by it (verify2 MEDIUM)
        return;
      }
      if (m.t === 'guess') {
        if (s.phase !== 'question' || m.round !== s.round || !s.players.some(p => p.pid === m.pid)) return;
        const back = s.players.find(p => p.pid === m.pid); back.gone = false;
        seen();
        s.guesses.set(m.pid, m.text);
        if (!s.gotPending.has(m.pid)) { s.gotPending.add(m.pid); post({ t: 'got', pid: m.pid, round: m.round }).catch(() => {}).then(() => { s.gotPending.delete(m.pid); }); }          // one 'got' waiting per pid
        refresh();
        if (active().every(p => s.guesses.has(p.pid))) reveal();
      }
    }

    function startRound(i) {
      if (s.closed) return;
      if (s.phase === 'lobby') { s.lockedByHost = s.locked; s.locked = true; s.removedNames.clear(); hideStrikes(); }          // the room locks itself when the game starts; the lobby's name ban ends with the lobby
      s.phase = 'question'; s.round = i; s.guesses = new Map(); s.results = null; s.left = secs; s.gotPending = new Set(); s.guessTimes = new Map();          // the guess limit and the one waiting got are per round
      stopTimer();
      s.timer = every(() => { s.left = Math.max(0, s.left - 1); if (!s.left) { reveal(); return; } const c = stage.querySelector('#gh-clock'); if (c) c.textContent = `${s.left} seconds left`; if (s.left % 5 === 0) broadcast(); }, 1000);
      live.textContent = `Round ${i + 1} of ${rounds.length}.`;
      armIdle();
      draw(true); broadcast();
    }
    function reveal(prefix) {
      if (s.phase !== 'question') return;
      if (typeof prefix !== 'string') prefix = '';
      stopTimer();
      s.results = scoreRound(Score, rounds[s.round], s.players, s.guesses);
      for (const r of s.results) { const p = s.players.find(x => x.name === r.name); s.totals.set(p.pid, (s.totals.get(p.pid) || 0) + r.points); }
      s.phase = 'reveal';
      live.textContent = `${prefix ? prefix + ' ' : ''}The answer was: ${endDot(rounds[s.round].answer.map(w => w.word).join(' '))}.`;
      armIdle();
      draw(true); broadcast();
    }
    function finish() { s.phase = 'final'; stopTimer(); const top = ranks(totalsList()).filter(t => t.place === 1).map(t => t.name); live.textContent = `The game is over. ${top.join(' and ')} ${top.length > 1 ? 'share' : 'takes'} first place.`; armIdle(); draw(true); broadcast(); }

    // HOST CONTROLS. kick: the player is dropped, told so in a signed welcome (why 'removed'), the pid goes in s.banned (dropped before any check from now on) and the name
    // is refused for the rest of the lobby. Works in the lobby and during play: in a round the player's guess is dropped, and if everyone left has guessed the round reveals.
    function kick(pid) {
      if (s.closed) return false;
      const who = s.players.find(p => p.pid === pid); if (!who) return false;
      s.banned.add(pid); s.removed.set(pid, who.name); s.removedNames.add(nameKey(who.name));
      s.players = s.players.filter(p => p.pid !== pid); s.totals.delete(pid); s.guesses.delete(pid); unseat(pid);
      welcome(pid, false, KICKED_TEXT, null, true);
      live.textContent = `${who.name} was removed.`;
      if (s.phase === 'question' && active().length && active().every(p => s.guesses.has(p.pid))) { reveal(`${who.name} was removed.`); return true; }
      if (s.phase === 'reveal' && s.results) { s.results = s.results.filter(r => r.name !== who.name); draw(false); broadcast(); return true; }          // GEO M3: the removed player's row leaves the shown and sent reveal
      refresh(); broadcast(); return true;
    }
    // Allow again: the undo for a removal (the pid and the name may join again).
    function allow(pid) {
      if (!s.removed.has(pid)) return false;
      const name = s.removed.get(pid);
      s.banned.delete(pid); s.removed.delete(pid); s.removedNames.delete(nameKey(name));
      live.textContent = `${name} is allowed again.`;
      refresh(); return true;
    }
    function setLock(on) {
      if (s.closed) return;
      s.locked = !!on;
      if (s.locked) hideStrikes();
      const b = q('#gh-lock'); if (b) b.textContent = s.locked ? 'Unlock the room' : 'Lock the room';
      const n = q('#gh-lock-note'); if (n) n.textContent = lockNoteText(s.locked);
      live.textContent = lockNoteText(s.locked);
    }
    const focusFirst = (...els) => { const el = els.find(Boolean); if (el && el.focus) el.focus(); };
    // The inline confirm (FACES 1.2): in the player's own row, focus on `Yes, remove Ana`; Escape or `Keep Ana` puts the row back and focus on its Remove.
    function askRemove(pid) {
      const p = s.players.find(x => x.pid === pid), li = s.rows.get(pid); if (!p || !li) return;
      for (const [other, l] of s.rows) if (other !== pid && l.ghBox) unask(other, false);
      const yes = h('button', { class: 'button primary gh-yes', type: 'button', onclick: act(() => confirmRemove(pid)) }, `Yes, remove ${p.name}`);
      const keep = h('button', { class: 'button secondary gh-keep', type: 'button', onclick: act(() => unask(pid, true)) }, `Keep ${p.name}`);
      const box = h('span', { class: 'gh-confirm', onkeydown: e => { if (e && e.key === 'Escape') { if (e.preventDefault) e.preventDefault(); touch(); unask(pid, true); } } },
        h('span', { class: 'gh-confirm-text' }, `Remove ${p.name} from the game?`), ' ', yes, ' ', keep);
      li.ghBox = box; li.replaceChildren(li.ghName, ' ', box);
      if (yes.focus) yes.focus();
    }
    function unask(pid, focus) {
      const li = s.rows.get(pid); if (!li || !li.ghBox) return;
      li.ghBox = null; li.replaceChildren(li.ghName, ' ', li.ghRemove);
      if (focus && li.ghRemove.focus) li.ghRemove.focus();
    }
    function confirmRemove(pid) {
      const i = s.players.findIndex(p => p.pid === pid);
      if (!kick(pid)) return;
      const next = s.players[Math.min(i, s.players.length - 1)], li = next && s.rows.get(next.pid);
      focusFirst(li && li.ghRemove, q('#gh-lock'), q('h2'));
    }
    function allowClicked(pid) {
      if (!allow(pid)) return;
      const more = q('#gh-removed'), btn = more && more.querySelector ? more.querySelector('button') : null;
      focusFirst(btn, q('#gh-lock'), q('h2'));
    }
    const row = p => {
      const name = h('span', { class: 'gh-player-name' }, p.gone ? `${p.name} (left)` : p.name);
      const rm = h('button', { class: 'button secondary gh-remove', type: 'button', 'aria-label': `Remove ${p.name}`, onclick: act(() => askRemove(p.pid)) }, 'Remove');
      const li = h('li', { class: 'gh-player' }, name, ' ', rm);
      li.ghName = name; li.ghRemove = rm; li.ghBox = null; li.ghGone = !!p.gone;
      return li;
    };
    const removedRows = () => [...s.removed].map(([pid, name]) => h('li', { class: 'gh-removed-row' }, `Removed: ${name}. `,
      h('button', { class: 'button secondary gh-allow', type: 'button', 'aria-label': `Allow ${name} again`, onclick: act(() => allowClicked(pid)) }, 'Allow again')));
    function again() {
      for (const p of s.players) if (p.gone) unseat(p.pid);
      s.players = active(); s.phase = 'lobby'; s.round = -1; s.guesses = new Map(); s.results = null; s.locked = s.lockedByHost;          // back to the lobby: the lock is what the host chose before the start
      for (const p of s.players) s.totals.set(p.pid, 0);
      live.textContent = 'Back in the lobby with the same players. Press Start when everyone is ready.';          // GAMES 11-27 (FACES walk): replaces the old game is over line
      armIdle(); draw(true); broadcast();
    }

    // THE PLAYERS PANEL, in every phase: the seats line, a row per player with Remove, the removed players with Allow again, the lock line, the help line, and (lobby) New room code.
    function panel() {
      const lobby = s.phase === 'lobby';
      s.rows = new Map(s.players.map(p => [p.pid, row(p)]));
      const removed = removedRows();
      return [
        h('p', { class: 'meta gh-seats', id: 'gh-seats', role: 'status' }, seatsText(s.players.length)),
        h('ul', { class: 'gh-player-list', id: 'gh-player-list', 'aria-label': 'Players in the room' }, s.players.map(p => s.rows.get(p.pid))),
        h('ul', { class: 'gh-removed', id: 'gh-removed', 'aria-label': 'Removed players', hidden: removed.length ? null : true }, removed),
        lobby ? h('p', { class: 'gh-lock-line' }, h('button', { class: 'button secondary', type: 'button', id: 'gh-lock', onclick: act(() => setLock(!s.locked)) }, s.locked ? 'Unlock the room' : 'Lock the room'),
          ' ', h('span', { class: 'meta', id: 'gh-lock-note' }, lockNoteText(s.locked)))
          : h('p', { class: 'meta gh-lock-line', id: 'gh-auto-lock' }, AUTO_LOCK_TEXT),
        h('p', { class: 'meta gh-help', id: 'gh-help' }, HELP_TEXT, ' ', COURTESY_TEXT),
        lobby ? h('button', { class: 'button secondary', type: 'button', id: 'gh-newcode', onclick: act(() => newCode()) }, 'New room code') : null,
      ].filter(Boolean);          // GAMES 11-27 (FACES walk): no null may reach replaceChildren, it would print the word null
    }

    // Changes that do NOT change the phase (a join, a leave, a guess, a removal) update their own lines in place, so the host's keyboard focus stays where it is (audit HIGH 1).
    function refresh() {
      if (s.closed) return;
      const seats = q('#gh-seats'), list = q('#gh-player-list');
      if (!seats || !list) return draw();
      seats.textContent = seatsText(s.players.length);
      // rows in place: a row that stays is never re-made, so a focused Remove button (or an open confirm) keeps its focus
      const inPlace = typeof list.removeChild === 'function', want = new Map(s.players.map(p => [p.pid, p]));
      for (const [pid, li] of [...s.rows]) if (!want.has(pid) || li.ghGone !== !!want.get(pid).gone) { s.rows.delete(pid); if (inPlace) list.removeChild(li); }
      for (const p of s.players) if (!s.rows.has(p.pid)) { const li = row(p); s.rows.set(p.pid, li); if (inPlace) list.append(li); }
      if (!inPlace || s.players.some((p, i) => list.children && list.children[i] !== s.rows.get(p.pid))) list.replaceChildren(...s.players.map(p => s.rows.get(p.pid)));
      const removed = q('#gh-removed'); if (removed) show(removed, removedRows());
      if (s.phase === 'lobby') {
        const st = q('#gh-start');
        if (st) { if (s.players.length) st.removeAttribute('disabled'); else st.setAttribute('disabled', ''); }
      } else if (s.phase === 'question') {
        const an = q('#gh-answered'); if (an) an.textContent = `Guesses in: ${active().filter(x => s.guesses.has(x.pid)).length} of ${active().length}`;
      }
    }
    const markWord = m => h('span', { class: `gh-mark gh-${m.mark}` }, m.word, h('span', { class: 'visually-hidden' }, ` (${m.mark})`));
    function draw(focus) {
      if (s.closed) return;
      let kids;
      if (s.phase === 'lobby') {
        kids = [h('h2', { tabindex: '-1' }, 'Waiting for players'),
          h('p', { class: 'gh-code-line' }, 'Room code ', h('strong', { class: 'gh-code', id: 'gh-code' }, shownCode())),
          h('p', { class: 'gh-statement', id: 'gh-statement' }, STATEMENT, ' ', PUBLIC_TEXT),
          h('p', {}, 'On a phone, open ', h('strong', {}, joinUrl), ' and type the room code.'),
          ...panel(),
          MODE_ROUNDS.gap ? h('fieldset', { class: 'gh-modes', id: 'gh-modes' }, h('legend', {}, 'Which game?'),
            ...[['line', 'Guess the next line', 'A line stops partway; type what comes next.'], ['gap', 'Fill the gap', 'A line has one word missing; type the missing word.']].map(([v, label, hint]) =>
              h('label', { class: 'gh-mode', for: `gh-mode-${v}` }, h('input', { type: 'radio', name: 'gh-mode', id: `gh-mode-${v}`, value: v, checked: s.mode === v ? true : null, onchange: act(() => setMode(v)) }), ' ', h('strong', {}, label), h('span', { class: 'meta' }, ` ${hint}`)))) : null,
          h('button', { class: 'button primary', type: 'button', id: 'gh-start', disabled: s.players.length ? null : true, onclick: act(() => startRound(0)) }, 'Start the game')];
      } else if (s.phase === 'question') {
        const r = rounds[s.round].public;
        kids = [h('h2', { tabindex: '-1' }, `Round ${s.round + 1} of ${rounds.length}`), h('p', { class: 'meta', id: 'gh-clock' }, `${s.left} seconds left`),
          ...(s.mode === 'gap'
            ? [h('p', { class: 'meta' }, 'Read this line aloud and say "blank" for the gap: the players type the missing word.'), h('p', { class: 'gh-heard', id: 'gh-heard' }, `\u201c${r.shown_text}\u201d`), h('p', { class: 'meta' }, 'One word is missing.')]
            : [h('p', { class: 'meta' }, 'Read this line aloud, then stop: the players guess what comes next. (These sample rounds have no video.)'), h('p', { class: 'gh-heard', id: 'gh-heard' }, `\u201c${r.heard_text} \u2026\u201d`),
               h('p', { class: 'meta' }, `${r.words_left} word${r.words_left === 1 ? ' is' : 's are'} left to guess.`)]),
          h('p', { id: 'gh-answered', 'aria-live': 'polite' }, `Guesses in: ${active().filter(p => s.guesses.has(p.pid)).length} of ${active().length}`),
          h('button', { class: 'button secondary', type: 'button', id: 'gh-reveal', onclick: act(() => reveal()) }, 'Show the answer now'), ...panel()];
      } else if (s.phase === 'reveal') {
        const round = rounds[s.round], last = s.round + 1 >= rounds.length;
        kids = [h('h2', { tabindex: '-1' }, `Round ${s.round + 1}: the answer`), h('p', { class: 'gh-heard', id: 'gh-answer' }, `\u201c${round.answer.map(w => w.word).join(' ')}\u201d`),
          h('ul', { class: 'gh-results', id: 'gh-results' }, s.results.map(r => h('li', {}, h('strong', {}, r.name), ` ${r.points} points (${r.verdict})`, r.text ? h('span', { class: 'meta' }, ` \u201c${r.text}\u201d`) : h('span', { class: 'meta' }, ' no guess'),
            r.text ? h('span', { class: 'gh-marks' }, ' ', r.marks.map(markWord)) : null))),
          h('button', { class: 'button primary', type: 'button', id: 'gh-next', onclick: act(() => (last ? finish() : startRound(s.round + 1))) }, last ? 'See the final scores' : 'Next round'), ...panel()];
      } else {
        const rk = ranks(totalsList());
        kids = [h('h2', { tabindex: '-1' }, 'Final scores'), h('ul', { id: 'gh-final', class: 'gh-final' }, rk.map(t => h('li', {}, `${t.place}. ${t.name}: ${t.total}`))),
          h('p', { class: 'meta' }, 'A tie shares the place.'), h('button', { class: 'button primary', type: 'button', id: 'gh-again', onclick: act(() => again()) }, 'Play again with the same players'), ...panel()];
      }
      stage.replaceChildren(...kids);
      if (focus) { const hd = stage.querySelector('h2'); if (hd) hd.focus(); }
    }

    // IDLE (hold 3). Any join, guess or leave taken, and any host press, starts the 15 minutes again. A running question round has its own clock and is never closed for idling.
    function armIdle() {
      unlater(s.warnT); unlater(s.idleT); s.warnT = s.idleT = null;
      if (s.idleShown) { s.idleShown = false; show(idleBox, []); }
      if (s.closed || s.phase === 'question') return;
      s.warnT = later(showIdleWarn, idleMs - warnMs);
      s.idleT = later(() => { idleClose(); }, idleMs);
    }
    const touch = () => { if (!s.closed) armIdle(); };
    function act(fn) { return (...a) => { const r = fn(...a); touch(); return r; }; }          // every host press counts as something happening
    function showIdleWarn() {
      if (s.closed || s.phase === 'question') return;
      s.idleShown = true;
      show(idleBox, [h('p', { id: 'gh-idle-text' }, IDLE_WARN_TEXT), h('button', { class: 'button primary', type: 'button', id: 'gh-keep-open', onclick: () => keepOpen() }, 'Keep the room open')]);
    }
    function keepOpen() { touch(); live.textContent = 'The room stays open.'; focusFirst(q('h2')); }
    // Closing a room: one signed state phase 'closed' with its why, then every timer and the beat stopped and the room left. Nothing from the room is taken after this.
    function closeRoom(why) {
      if (s.closed) return Promise.resolve();
      s.closed = true;
      stopTimer(); unevery(s.beat); s.beat = null; unlater(s.warnT); unlater(s.idleT); s.warnT = s.idleT = null;
      s.idleShown = false; show(idleBox, []); hideStrikes();
      if (s.off) { try { s.off(); } catch { /* already gone */ } s.off = null; }
      const conn = s.conn;
      const last = conn ? post({ t: 'state', phase: 'closed', why, mode: s.mode, round: Math.max(0, s.round), of: rounds.length, players: [] }).catch(() => {}) : Promise.resolve();
      s.conn = null;
      return last.then(() => { if (conn) { try { conn.close(); } catch { /* already gone */ } } });
    }
    function idleClose() {
      if (s.closed || s.phase === 'question') return Promise.resolve();
      const done = closeRoom('idle');
      status.textContent = 'The room is closed.';
      const btn = h('button', { class: 'button primary', type: 'button', id: 'gh-reopen', onclick: () => { openRoom(true); } }, 'Open a new room');
      stage.replaceChildren(h('h2', { tabindex: '-1' }, 'The room is closed'), h('p', { class: 'gh-closed', id: 'gh-closed' }, IDLE_CLOSED_TEXT), btn);
      live.textContent = IDLE_CLOSED_TEXT;
      return done;
    }
    // New room code (lobby only): the phones are told this room is closed (why 'newcode'), and a new key makes a new code with empty seats.
    function newCode() {
      if (s.closed || s.phase !== 'lobby') return Promise.resolve();
      return closeRoom('newcode').then(() => openRoom(true)).then(() => { if (!s.closed) live.textContent = `The new room code is ${shownCode()}. The old code no longer works.`; });
    }

    function close() {
      if (s.unmounted) return;
      s.unmounted = true;
      window.removeEventListener('hashchange', onHash);
      closeRoom('host');
    }
    const onHash = () => { if (location.hash !== '#/d/games') close(); };
    window.addEventListener('hashchange', onHash);

    // the room code is made from this screen's own key (codeOf): a phone pins a host key only when it gives the code the player typed. No signing, no room: never unsigned.
    // WEB polish 11-27 (web-games-polish-1127 1dcf25a5, folded by GAMES): nothing is drawn until the room is open, and a failure shows its reason with a Try again button.
    async function openRoom(focus) {
      if (s.unmounted || s.opening || !s.closed) return;
      s.opening = true;
      try {
        fresh(); s.pair = null; s.code = '';
        status.setAttribute('role', 'status'); status.textContent = 'Opening a room\u2026'; stage.replaceChildren();
        const failed = text => { status.setAttribute('role', 'alert'); status.textContent = text;        // role first, then the words, so a screen reader announces them (WEB web-games-final-1127 0087b3a8)
          const again = h('button', { class: 'button primary', type: 'button', id: 'gh-retry', onclick: () => location.reload() }, 'Try again');
          stage.replaceChildren(again); if (again.focus) again.focus(); };
        try { s.pair = await Room.keyPair(); s.code = await Room.codeOf(s.pair.pub); if (!s.code) throw new Error('no code'); } catch { s.pair = null; failed('This browser cannot sign the game\u2019s messages, so it cannot open a room. Open this page on a secure (https) address in an up-to-date browser.'); return; }
        const opts = roomOptions(cfg, s.code);
        if (!opts) { failed('This page could not open a game room. Try again.'); return; }
        let conn;
        try { conn = await Room.connect(opts); } catch { failed('This page could not open a game room. Check your connection and try again.'); return; }
        if (s.unmounted) { conn.close(); return; }
        s.conn = conn; s.closed = false;
        s.off = s.conn.onMessage(take);
        status.textContent = openText();
        draw(focus); broadcast();
        s.beat = every(() => { if (!s.closed && s.phase !== 'question' && active().length) broadcast(); }, 5000);        // the question phase sends every 5 s from its own clock; a room with no ACTIVE player (none, or all gone) sends nothing
        armIdle();
      } finally { s.opening = false; }
    }
    openRoom(false);

    root.replaceChildren(h('p', { class: 'form-note', role: 'note' }, 'Five sample rounds made from a made-up script. The game saves nothing to an account or a file, but every name and guess goes to everyone in this room, and anyone with the room code can join: it is not a password.'),
      status, strikeBox, idleBox, live, stage);        // honest privacy words (CC1 09:33); the stage stays empty until the room is open (WEB polish)
    // the same functions the host's buttons call (tests drive a whole game through them)
    return { close, state: () => s, settled: async () => { for (let i = 0; i < 4; i++) { await s.inQ; await s.outQ; } }, start: act(() => startRound(0)), reveal: act(() => reveal()), kick: pid => { const r = kick(pid); touch(); return r; },
      allow: pid => { const r = allow(pid); touch(); return r; }, lock: on => { setLock(on); touch(); }, newCode: () => { const p = newCode(); return p; }, keepOpen, idleClose,
      next: act(() => (s.round + 1 >= rounds.length ? finish() : startRound(s.round + 1))) };
  }

  window.ryagramGamesHost = Object.freeze({ on, roomOptions, nameProblem, ranks, scoreRound, mount, MAX_PLAYERS, ROUND_SECONDS, IDLE_MS, WARN_MS });
})();
