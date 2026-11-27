// GAMES 11-27 (Claude 08:10, the Games department live behind the switch `games`): the HOST screen of a LIVE round of "Guess the next line", on the
// Games department page (#/d/games) for a signed-in account whose switch list names `games` (featureOn('games') in assets/app-switches.js).
// The host's screen opens a room with a 4-letter code (assets/game-room.js: Supabase Realtime broadcast on uselai.com, a test relay on 127.0.0.1 only),
// players join on their phones at /game-phone/, each round shows what was said so far, the phones send typed guesses, and THIS screen scores them with
// the engine's own rules (assets/game-score.js, proven equal to ryagram/games/guess_line.py by tests/game-score.test.mjs) and sends the answer and the points.
// The rounds are FIVE made-up rounds made by the real engine over a MADE-UP transcript (assets/game-rounds.js): no real show, person or clip, and no video
// (the host reads the line aloud). Nothing is stored: no table, no file, no account row; closing the page ends the room. Words are drafts FOR RYAN'S YES.
// SIGNED (11-27): the room has no server, so this screen checks every join/guess/leave against the key its player id is made from (and a seq above the last one), and signs
// everything it sends with its own key. The ROOM CODE is made from that key (ryagramGameRoom.codeOf), and a phone pins the host key only when it gives the code typed.
// Joins are limited to 3 per pid in 10 s; a refused join keeps no seat and no key; names are compared in NFKC lower case and host/ryagram/admin are kept for the game.
// HOST CONTROLS (11-27, CC1 review MEDIUM: fake players could fill all 8 seats for good): in the lobby each player has a Remove button (the player is dropped and that pid is
// refused for the rest of this room) and the host can Lock the room (new joins are refused: 'This room is locked.'). Both refusals go out as a signed welcome. A refused join
// leaves its pid's seq behind for the whole room, so replaying it later cannot seat that pid; kept keys are bounded per room and never let go while seated or recently gone.
(function () {
  const MAX_PLAYERS = 8, ROUND_SECONDS = 45;
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

  function mount(root, { h, Room, Score, Rounds, GapRounds, cfg, seconds }) {
    const secs = seconds || ROUND_SECONDS;
    const s = { code: '', conn: null, off: null, players: [], phase: 'lobby', round: -1, guesses: new Map(), totals: new Map(), left: 0, timer: null, results: null, closed: false };
    const live = h('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite', id: 'gh-live' });
    const stage = h('div', { class: 'gh-stage' });
    const status = h('p', { class: 'form-note', id: 'gh-status', role: 'status' }, 'Opening a room…');
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
    s.seq = 0; s.keys = new Map(); s.outQ = Promise.resolve(); s.inQ = Promise.resolve();
    const post = msg => {
      const p = s.outQ.then(async () => { if (!s.conn || !s.pair) throw new Error('closed'); const conn = s.conn; s.seq += 1; await conn.send(await Room.sign(s.pair, s.code, { ...msg, seq: s.seq })); });
      s.outQ = p.catch(() => {});
      return p;
    };
    // a welcome that lets a player in carries the name the host seated them under (a rejoin typed 'ben' for 'Ben' is still Ben), so the phone finds itself in results and totals
    const welcome = (pid, ok, problem, name, force) => (!ok && !force && !within(s.refusals, REFUSALS, REFUSAL_MS)) ? Promise.resolve() : post({ t: 'welcome', pid, ok, pub: s.pair.pub, ...(problem ? { problem } : {}), ...(ok && name ? { name } : {}) }).catch(() => {});
    const openText = () => `Room ${s.code} is open.`;
    const broadcast = () => { if (s.conn) post(publicState()).then(() => { if (s.sendFailed) { s.sendFailed = false; status.textContent = openText(); } }, () => { s.sendFailed = true; status.textContent = 'A message did not reach the phones. It is sent again every 5 seconds.'; }); };
    const stopTimer = () => { if (s.timer) clearInterval(s.timer); s.timer = null; };
    const KICKED_TEXT = 'The host removed you from this room.', LOCKED_TEXT = 'This room is locked.';
    const lockNote = () => (s.locked ? 'The room is locked: no one new can join.' : 'New players can join.');

    // A join must carry the key its pid is made from and be signed by it. The key of a player who got IN is remembered (even after a leave, so an old message cannot be
    // replayed), and every later join/guess/leave from that pid must be signed by the SAME key with a seq above the last one taken. A refused join keeps no key and no seat
    // (only its pid's last seq, below); at most JOIN_LIMIT good joins per pid in JOIN_WINDOW_MS are taken.
    // 11-27 (WORKER LOWs, red team 6a/9a/9e): EVERY pid's last seq is kept for the whole room (pid -> seq only, never let go), so no old message of any pid (seated, gone,
    // removed or refused) is ever taken twice: a replayed refused join seats no one, even after many join/leave cycles. Kept KEYS are bounded at KEEP_KEYS: a new player's key
    // is taken only when there is room after letting go keys of players gone longer than GONE_KEEP_MS, so cycling throwaway pids never pushes out a seated or recently-gone
    // player's key (new joins are dropped instead). Room-wide limits: at most ROOM_JOINS new pids in ROOM_JOIN_MS, at most REFUSALS refusal welcomes in REFUSAL_MS (past
    // that a join gets no answer), at most GUESSES guesses per pid in GUESS_MS (the rest dropped unanswered), and at most one 'got' waiting to be sent per pid.
    // THE LIMIT: a flood can still keep NEW players out for a while (they see 'No room answered'); the host can lock the room and remove fake players.
    const JOIN_LIMIT = 3, JOIN_WINDOW_MS = 10000, KEEP_KEYS = 96, GONE_KEEP_MS = 10 * 60000, ROOM_JOINS = 8, ROOM_JOIN_MS = 5000, REFUSALS = 10, REFUSAL_MS = 5000, GUESSES = 2, GUESS_MS = 1000;
    s.joinTimes = new Map(); s.lastSeq = new Map(); s.roomJoins = []; s.refusals = []; s.guessTimes = new Map(); s.gotPending = new Set(); s.kicked = new Set(); s.locked = false; s.rows = new Map();
    const lastSeqOf = pid => (s.lastSeq.has(pid) ? s.lastSeq.get(pid) : -1);
    const within = (list, n, ms) => { const t = Date.now(); while (list.length && t - list[0] >= ms) list.shift(); if (list.length >= n) return false; list.push(t); return true; };
    const guessAllowed = pid => { const l = s.guessTimes.get(pid) || []; s.guessTimes.set(pid, l); return within(l, GUESSES, GUESS_MS); };
    const seated = pid => s.players.some(p => p.pid === pid);
    const unseat = pid => { const k = s.keys.get(pid); if (k) k.left = Date.now(); };
    const roomForKey = () => {
      if (s.keys.size < KEEP_KEYS) return true;
      const now = Date.now();
      const old = [...s.keys].filter(([p, k]) => !seated(p) && k.left && now - k.left > GONE_KEEP_MS).sort((a, b) => a[1].left - b[1].left);
      for (const [p] of old) { s.keys.delete(p); if (s.keys.size < KEEP_KEYS) return true; }
      return false;
    };
    const joinAllowed = pid => {
      const now = Date.now();
      for (const [p, ts] of s.joinTimes) { const keep = ts.filter(t => now - t < JOIN_WINDOW_MS); if (keep.length) s.joinTimes.set(p, keep); else s.joinTimes.delete(p); }
      const ts = s.joinTimes.get(pid) || [];
      if (ts.length >= JOIN_LIMIT) return false;
      ts.push(now); s.joinTimes.set(pid, ts); return true;
    };
    const remember = (pid, pub, seq) => {
      const k = s.keys.get(pid);
      if (k) { k.seq = seq; if (seated(pid)) k.left = null; return; }
      s.keys.set(pid, { pub, seq, left: null });
    };
    async function checked(m) {
      if (s.closed || !['join', 'guess', 'leave'].includes(m.t) || !Number.isInteger(m.seq)) return;
      const known = s.keys.get(m.pid);
      let pub;
      if (m.t === 'join') {
        if (!m.pub || (known && known.pub !== m.pub)) return;
        if ((await Room.pidOf(m.pub)) !== m.pid) return;
        pub = m.pub;
      } else {
        if (!known) return;
        pub = known.pub;
      }
      if (known && m.seq <= known.seq) return;
      if (m.seq <= lastSeqOf(m.pid)) return;          // the room keeps every pid's last seq: a replay (of a refused join too) is never taken
      if (!(await Room.verify(pub, s.code, m))) return;
      const now = s.keys.get(m.pid);                      // checked again: another message for this pid may have been taken while this one was being verified
      if ((now && (now.pub !== pub || m.seq <= now.seq)) || m.seq <= lastSeqOf(m.pid)) return;
      s.lastSeq.set(m.pid, m.seq);
      if (m.t !== 'join') { now.seq = m.seq; if (m.t === 'guess' && !guessAllowed(m.pid)) return; onMessage(m); return; }
      if (!now && (!roomForKey() || !within(s.roomJoins, ROOM_JOINS, ROOM_JOIN_MS))) return;
      if (!joinAllowed(m.pid)) return;
      onMessage(m);
      if (now || seated(m.pid)) remember(m.pid, pub, m.seq);          // only a player who got in (or was in) keeps a key
    }
    const take = m => { s.inQ = s.inQ.then(() => checked(m)).catch(() => {}); };

    function onMessage(m) {
      if (s.closed) return;
      if (m.t === 'join') {
        if (s.kicked.has(m.pid)) { welcome(m.pid, false, KICKED_TEXT); return; }
        const known = s.players.find(p => p.pid === m.pid);
        if (known) { known.gone = false; welcome(m.pid, true, null, known.name); broadcast(); return; }
        if (s.locked) { welcome(m.pid, false, LOCKED_TEXT); return; }
        if (s.phase !== 'lobby') { welcome(m.pid, false, 'This game has already started. Wait for the next one.'); return; }
        const problem = nameProblem(m.name, s.players);
        if (problem) { welcome(m.pid, false, problem); return; }
        s.players.push({ pid: m.pid, name: m.name }); s.totals.set(m.pid, 0);
        welcome(m.pid, true, null, m.name);
        live.textContent = `${m.name} joined.`;
        refresh(); broadcast(); return;
      }
      if (m.t === 'leave') {
        const who = s.players.find(p => p.pid === m.pid); if (!who) return;
        live.textContent = `${who.name} left.`;                  // audit 10
        if (s.phase === 'lobby') { s.players = s.players.filter(p => p.pid !== m.pid); s.totals.delete(m.pid); unseat(m.pid); refresh(); broadcast(); return; }
        who.gone = true;                                          // after the start a player keeps their place on this game's scoreboard; Play again drops them (audit 3)
        if (s.phase === 'question' && active().length && active().every(p => s.guesses.has(p.pid))) reveal(`${who.name} left.`); else refresh();        // the leave is said WITH the answer, not overwritten by it (verify2 MEDIUM)
        return;
      }
      if (m.t === 'guess') {
        if (s.phase !== 'question' || m.round !== s.round || !s.players.some(p => p.pid === m.pid)) return;
        const back = s.players.find(p => p.pid === m.pid); back.gone = false;
        s.guesses.set(m.pid, m.text);
        if (!s.gotPending.has(m.pid)) { s.gotPending.add(m.pid); post({ t: 'got', pid: m.pid, round: m.round }).catch(() => {}).then(() => { s.gotPending.delete(m.pid); }); }          // one 'got' waiting per pid
        refresh();
        if (active().every(p => s.guesses.has(p.pid))) reveal();
      }
    }

    function startRound(i) {
      s.phase = 'question'; s.round = i; s.guesses = new Map(); s.results = null; s.left = secs; s.gotPending = new Set(); s.guessTimes = new Map();          // the guess limit and the one waiting got are per round
      stopTimer();
      s.timer = setInterval(() => { s.left = Math.max(0, s.left - 1); if (!s.left) { reveal(); return; } const c = stage.querySelector('#gh-clock'); if (c) c.textContent = `${s.left} seconds left`; if (s.left % 5 === 0) broadcast(); }, 1000);
      live.textContent = `Round ${i + 1} of ${rounds.length}.`;
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
      draw(true); broadcast();
    }
    function finish() { s.phase = 'final'; stopTimer(); const top = ranks(totalsList()).filter(t => t.place === 1).map(t => t.name); live.textContent = `The game is over. ${top.join(' and ')} ${top.length > 1 ? 'share' : 'takes'} first place.`; draw(true); broadcast(); }
    // HOST CONTROLS (lobby only). kick: the player is dropped, told so in a signed welcome, and that pid is refused for the rest of this room. setLock: new joins are refused.
    // Both update their own lines in place (refresh), so keyboard focus stays on the controls: after Remove it moves to the next player's Remove (or Lock the room).
    function kick(pid) {
      if (s.phase !== 'lobby') return false;
      const who = s.players.find(p => p.pid === pid); if (!who) return false;
      s.kicked.add(pid); s.players = s.players.filter(p => p.pid !== pid); s.totals.delete(pid); unseat(pid);
      welcome(pid, false, KICKED_TEXT, null, true);
      live.textContent = `${who.name} was removed from the room.`;
      refresh(); broadcast(); return true;
    }
    function setLock(on) {
      s.locked = !!on;
      const b = stage.querySelector ? stage.querySelector('#gh-lock') : null; if (b) b.textContent = s.locked ? 'Unlock the room' : 'Lock the room';
      const n = stage.querySelector ? stage.querySelector('#gh-lock-note') : null; if (n) n.textContent = lockNote();
      live.textContent = lockNote();
    }
    const removeClicked = pid => {
      const i = s.players.findIndex(p => p.pid === pid);
      if (!kick(pid)) return;
      const next = s.players[Math.min(i, s.players.length - 1)], li = next && s.rows.get(next.pid);
      const target = li && li.querySelector ? li.querySelector('button') : (stage.querySelector ? stage.querySelector('#gh-lock') : null);
      if (target && target.focus) target.focus();
    };
    const row = p => h('li', { class: 'gh-player' }, h('span', { class: 'gh-player-name' }, p.name), ' ',
      h('button', { class: 'button secondary gh-remove', type: 'button', 'aria-label': `Remove ${p.name} from the room`, onclick: () => removeClicked(p.pid) }, 'Remove'));
    function again() { for (const p of s.players) if (p.gone) unseat(p.pid); s.players = active(); s.phase = 'lobby'; s.round = -1; s.guesses = new Map(); s.results = null; for (const p of s.players) s.totals.set(p.pid, 0); draw(true); broadcast(); }

    // Changes that do NOT change the phase (a join, a leave, a guess) update their own lines in place, so the host's keyboard focus stays where it is (audit HIGH 1).
    function refresh() {
      const q = sel => (stage.querySelector ? stage.querySelector(sel) : null);
      if (s.phase === 'lobby') {
        const pl = q('#gh-players'), st = q('#gh-start');
        if (!pl || !st) return draw();
        pl.textContent = s.players.length ? `Players (${s.players.length} of ${MAX_PLAYERS}): ${s.players.map(x => x.name).join(', ')}` : 'No one has joined yet.';
        if (s.players.length) st.removeAttribute('disabled'); else st.setAttribute('disabled', '');
        const list = q('#gh-player-list');
        if (list) {          // rows in place: a row that stays is never re-made, so a focused Remove button keeps its focus
          const inPlace = typeof list.removeChild === 'function', want = new Set(s.players.map(p => p.pid));
          for (const [pid, li] of [...s.rows]) if (!want.has(pid)) { s.rows.delete(pid); if (inPlace) list.removeChild(li); }
          for (const p of s.players) if (!s.rows.has(p.pid)) { const li = row(p); s.rows.set(p.pid, li); if (inPlace) list.append(li); }
          if (!inPlace) list.replaceChildren(...s.players.map(p => s.rows.get(p.pid)));
        }
      } else if (s.phase === 'question') {
        const an = q('#gh-answered'); if (an) an.textContent = `Guesses in: ${active().filter(x => s.guesses.has(x.pid)).length} of ${active().length}`;
      }
    }
    const markWord = m => h('span', { class: `gh-mark gh-${m.mark}` }, m.word, h('span', { class: 'visually-hidden' }, ` (${m.mark})`));
    function draw(focus) {
      let kids;
      if (s.phase === 'lobby') {
        kids = [h('h2', { tabindex: '-1' }, 'Waiting for players'),
          h('p', { class: 'gh-code-line' }, 'Room code ', h('strong', { class: 'gh-code', id: 'gh-code' }, s.code)),
          h('p', {}, 'On a phone, open ', h('strong', {}, joinUrl), ' and type the room code.'),
          h('p', { class: 'meta', id: 'gh-players' }, s.players.length ? `Players (${s.players.length} of ${MAX_PLAYERS}): ${s.players.map(p => p.name).join(', ')}` : 'No one has joined yet.'),
          (s.rows = new Map(s.players.map(p => [p.pid, row(p)])), h('ul', { class: 'gh-player-list', id: 'gh-player-list', 'aria-label': 'Players in the room' }, s.players.map(p => s.rows.get(p.pid)))),
          h('p', { class: 'gh-lock-line' }, h('button', { class: 'button secondary', type: 'button', id: 'gh-lock', onclick: () => setLock(!s.locked) }, s.locked ? 'Unlock the room' : 'Lock the room'),
            ' ', h('span', { class: 'meta', id: 'gh-lock-note' }, lockNote())),
          MODE_ROUNDS.gap ? h('fieldset', { class: 'gh-modes', id: 'gh-modes' }, h('legend', {}, 'Which game?'),
            ...[['line', 'Guess the next line', 'A line stops partway; type what comes next.'], ['gap', 'Fill the gap', 'A line has one word missing; type the missing word.']].map(([v, label, hint]) =>
              h('label', { class: 'gh-mode', for: `gh-mode-${v}` }, h('input', { type: 'radio', name: 'gh-mode', id: `gh-mode-${v}`, value: v, checked: s.mode === v ? true : null, onchange: () => setMode(v) }), ' ', h('strong', {}, label), h('span', { class: 'meta' }, ` ${hint}`)))) : null,
          h('button', { class: 'button primary', type: 'button', id: 'gh-start', disabled: s.players.length ? null : true, onclick: () => startRound(0) }, 'Start the game')];
      } else if (s.phase === 'question') {
        const r = rounds[s.round].public;
        kids = [h('h2', { tabindex: '-1' }, `Round ${s.round + 1} of ${rounds.length}`), h('p', { class: 'meta', id: 'gh-clock' }, `${s.left} seconds left`),
          ...(s.mode === 'gap'
            ? [h('p', { class: 'meta' }, 'Read this line aloud and say "blank" for the gap: the players type the missing word.'), h('p', { class: 'gh-heard', id: 'gh-heard' }, `“${r.shown_text}”`), h('p', { class: 'meta' }, 'One word is missing.')]
            : [h('p', { class: 'meta' }, 'Read this line aloud, then stop: the players guess what comes next. (These sample rounds have no video.)'), h('p', { class: 'gh-heard', id: 'gh-heard' }, `“${r.heard_text} …”`),
               h('p', { class: 'meta' }, `${r.words_left} word${r.words_left === 1 ? ' is' : 's are'} left to guess.`)]),
          h('p', { id: 'gh-answered', 'aria-live': 'polite' }, `Guesses in: ${active().filter(p => s.guesses.has(p.pid)).length} of ${active().length}`),
          h('button', { class: 'button secondary', type: 'button', id: 'gh-reveal', onclick: reveal }, 'Show the answer now')];
      } else if (s.phase === 'reveal') {
        const round = rounds[s.round], last = s.round + 1 >= rounds.length;
        kids = [h('h2', { tabindex: '-1' }, `Round ${s.round + 1}: the answer`), h('p', { class: 'gh-heard', id: 'gh-answer' }, `“${round.answer.map(w => w.word).join(' ')}”`),
          h('ul', { class: 'gh-results', id: 'gh-results' }, s.results.map(r => h('li', {}, h('strong', {}, r.name), ` ${r.points} points (${r.verdict})`, r.text ? h('span', { class: 'meta' }, ` “${r.text}”`) : h('span', { class: 'meta' }, ' no guess'),
            r.text ? h('span', { class: 'gh-marks' }, ' ', r.marks.map(markWord)) : null))),
          h('button', { class: 'button primary', type: 'button', id: 'gh-next', onclick: () => (last ? finish() : startRound(s.round + 1)) }, last ? 'See the final scores' : 'Next round')];
      } else {
        const rk = ranks(totalsList());
        kids = [h('h2', { tabindex: '-1' }, 'Final scores'), h('ul', { id: 'gh-final', class: 'gh-final' }, rk.map(t => h('li', {}, `${t.place}. ${t.name}: ${t.total}`))),
          h('p', { class: 'meta' }, 'A tie shares the place.'), h('button', { class: 'button primary', type: 'button', id: 'gh-again', onclick: again }, 'Play again with the same players')];
      }
      stage.replaceChildren(...kids);
      if (focus) { const hd = stage.querySelector('h2'); if (hd) hd.focus(); }
    }

    function close() {
      if (s.closed) return; s.closed = true; stopTimer(); if (s.beat) clearInterval(s.beat);
      if (s.off) s.off(); if (s.conn) s.conn.close(); s.conn = null;
      window.removeEventListener('hashchange', onHash);
    }
    const onHash = () => { if (location.hash !== '#/d/games') close(); };
    window.addEventListener('hashchange', onHash);

    (async () => {
      // the room code is made from this screen's own key (codeOf): a phone pins a host key only when it gives the code the player typed. No signing, no room: never unsigned.
      // WEB polish 11-27 (web-games-polish-1127 1dcf25a5, folded by GAMES): nothing is drawn until the room is open, and a failure shows its reason with a Try again button.
      const failed = text => { status.setAttribute('role', 'alert'); status.textContent = text;        // role first, then the words, so a screen reader announces them (WEB web-games-final-1127 0087b3a8)
        const again = h('button', { class: 'button primary', type: 'button', id: 'gh-retry', onclick: () => location.reload() }, 'Try again');
        stage.replaceChildren(again); if (again.focus) again.focus(); };
      try { s.pair = await Room.keyPair(); s.code = await Room.codeOf(s.pair.pub); if (!s.code) throw new Error('no code'); } catch { s.pair = null; failed('This browser cannot sign the game\u2019s messages, so it cannot open a room. Open this page on a secure (https) address in an up-to-date browser.'); return; }
      const opts = roomOptions(cfg, s.code);
      if (!opts) { failed('This page could not open a game room. Press Try again.'); return; }
      try { s.conn = await Room.connect(opts); } catch { failed('This page could not open a game room. Check your connection and press Try again.'); return; }
      if (s.closed) { s.conn.close(); return; }
      s.off = s.conn.onMessage(take);
      status.textContent = openText();
      draw(); broadcast();
      s.beat = setInterval(() => { if (!s.closed && s.phase !== 'question' && s.players.length) broadcast(); }, 5000);        // the question phase sends every 5 s from its own clock; an empty room sends nothing
    })();

    root.replaceChildren(h('p', { class: 'form-note', role: 'note' }, h('strong', {}, 'DRAFT. '), 'Five sample rounds made from a made-up script. The game saves nothing to an account or a file, but every name and guess goes to everyone in this room, and anyone with the room code can join: it is not a password.'),
      status, live, stage);        // honest privacy words (CC1 09:33); the stage stays empty until the room is open (WEB polish)
    // the same functions the host's buttons call (tests drive a whole game through them)
    return { close, state: () => s, settled: async () => { for (let i = 0; i < 4; i++) { await s.inQ; await s.outQ; } }, start: () => startRound(0), reveal, kick, lock: on => setLock(on), next: () => (s.round + 1 >= rounds.length ? finish() : startRound(s.round + 1)) };
  }

  window.ryagramGamesHost = Object.freeze({ on, roomOptions, nameProblem, ranks, scoreRound, mount, MAX_PLAYERS, ROUND_SECONDS });
})();
