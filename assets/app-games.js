// GAMES 11-27 (Claude 08:10, the Games department live behind the switch `games`): the HOST screen of a LIVE round of "Guess the next line", on the
// Games department page (#/d/games) for a signed-in account whose switch list names `games` (featureOn('games') in assets/app-switches.js).
// The host's screen opens a room with a 4-letter code (assets/game-room.js: Supabase Realtime broadcast on uselai.com, a test relay on 127.0.0.1 only),
// players join on their phones at /game-phone/, each round shows what was said so far, the phones send typed guesses, and THIS screen scores them with
// the engine's own rules (assets/game-score.js, proven equal to ryagram/games/guess_line.py by tests/game-score.test.mjs) and sends the answer and the points.
// The rounds are FIVE made-up rounds made by the real engine over a MADE-UP transcript (assets/game-rounds.js): no real show, person or clip, and no video
// (the host reads the line aloud). Nothing is stored: no table, no file, no account row; closing the page ends the room. Words are drafts FOR RYAN'S YES.
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
  function nameProblem(name, players) {
    if (!name) return 'Type a name for the scoreboard.';
    if (players.some(p => p.name.toLowerCase() === name.toLowerCase())) return 'Someone in this room already has that name. Add a letter or pick another.';
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
      return { name: p.name, points: r.points, verdict: r.verdict, text, marks: r.marks };
    });
  }

  function mount(root, { h, Room, Score, Rounds, GapRounds, cfg, seconds }) {
    const secs = seconds || ROUND_SECONDS;
    const s = { code: Room.newCode(), conn: null, off: null, players: [], phase: 'lobby', round: -1, guesses: new Map(), totals: new Map(), left: 0, timer: null, results: null, closed: false };
    const live = h('p', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite', id: 'gh-live' });
    const stage = h('div', { class: 'gh-stage' });
    const status = h('p', { class: 'form-note', id: 'gh-status', role: 'status' }, 'Opening a room…');
    const joinUrl = `${location.origin}/game-phone/`;
    // GAMES 11-27: two modes. 'line' = Guess the next line (assets/game-rounds.js); 'gap' = Fill the gap (assets/game-gap-rounds.js: a line with ONE word hidden, scored by the
    // same engine rules on a one-word answer). The gap mode is offered only when its rounds are loaded.
    const MODE_ROUNDS = { line: Rounds, gap: GapRounds || (typeof window !== 'undefined' && window.ryagramGameGapRounds) || null };
    s.mode = 'line';
    let rounds = Rounds.rounds;
    const setMode = m => { if (s.phase !== 'lobby' || !MODE_ROUNDS[m]) return; s.mode = m; rounds = MODE_ROUNDS[m].rounds; draw(); broadcast(); };

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
    const broadcast = () => { if (s.conn) s.conn.send(publicState()).catch(() => { status.textContent = 'A message did not reach the phones. It is sent again every 5 seconds.'; }); };
    const stopTimer = () => { if (s.timer) clearInterval(s.timer); s.timer = null; };

    function onMessage(m) {
      if (s.closed) return;
      if (m.t === 'join') {
        const known = s.players.find(p => p.pid === m.pid);
        if (known) { known.gone = false; s.conn.send({ t: 'welcome', pid: m.pid, ok: true }).catch(() => {}); broadcast(); return; }
        if (s.phase !== 'lobby') { s.conn.send({ t: 'welcome', pid: m.pid, ok: false, problem: 'This game has already started. Wait for the next one.' }).catch(() => {}); return; }
        const problem = nameProblem(m.name, s.players);
        if (problem) { s.conn.send({ t: 'welcome', pid: m.pid, ok: false, problem }).catch(() => {}); return; }
        s.players.push({ pid: m.pid, name: m.name }); s.totals.set(m.pid, 0);
        s.conn.send({ t: 'welcome', pid: m.pid, ok: true }).catch(() => {});
        live.textContent = `${m.name} joined.`;
        refresh(); broadcast(); return;
      }
      if (m.t === 'leave') {
        const who = s.players.find(p => p.pid === m.pid); if (!who) return;
        live.textContent = `${who.name} left.`;                  // audit 10
        if (s.phase === 'lobby') { s.players = s.players.filter(p => p.pid !== m.pid); s.totals.delete(m.pid); refresh(); broadcast(); return; }
        who.gone = true;                                          // after the start a player keeps their place on this game's scoreboard; Play again drops them (audit 3)
        if (s.phase === 'question' && active().length && active().every(p => s.guesses.has(p.pid))) reveal(); else refresh();
        return;
      }
      if (m.t === 'guess') {
        if (s.phase !== 'question' || m.round !== s.round || !s.players.some(p => p.pid === m.pid)) return;
        const back = s.players.find(p => p.pid === m.pid); back.gone = false;
        s.guesses.set(m.pid, m.text);
        s.conn.send({ t: 'got', pid: m.pid, round: m.round }).catch(() => {});
        refresh();
        if (active().every(p => s.guesses.has(p.pid))) reveal();
      }
    }

    function startRound(i) {
      s.phase = 'question'; s.round = i; s.guesses = new Map(); s.results = null; s.left = secs;
      stopTimer();
      s.timer = setInterval(() => { s.left = Math.max(0, s.left - 1); if (!s.left) { reveal(); return; } const c = stage.querySelector('#gh-clock'); if (c) c.textContent = `${s.left} seconds left`; if (s.left % 5 === 0) broadcast(); }, 1000);
      live.textContent = `Round ${i + 1} of ${rounds.length}.`;
      draw(true); broadcast();
    }
    function reveal() {
      if (s.phase !== 'question') return;
      stopTimer();
      s.results = scoreRound(Score, rounds[s.round], s.players, s.guesses);
      for (const r of s.results) { const p = s.players.find(x => x.name === r.name); s.totals.set(p.pid, (s.totals.get(p.pid) || 0) + r.points); }
      s.phase = 'reveal';
      live.textContent = `The answer was: ${endDot(rounds[s.round].answer.map(w => w.word).join(' '))}.`;
      draw(true); broadcast();
    }
    function finish() { s.phase = 'final'; stopTimer(); const top = ranks(totalsList()).filter(t => t.place === 1).map(t => t.name); live.textContent = `The game is over. ${top.join(' and ')} ${top.length > 1 ? 'share' : 'takes'} first place.`; draw(true); broadcast(); }
    function again() { s.players = active(); s.phase = 'lobby'; s.round = -1; s.guesses = new Map(); s.results = null; for (const p of s.players) s.totals.set(p.pid, 0); draw(true); broadcast(); }

    // Changes that do NOT change the phase (a join, a leave, a guess) update their own lines in place, so the host's keyboard focus stays where it is (audit HIGH 1).
    function refresh() {
      const q = sel => (stage.querySelector ? stage.querySelector(sel) : null);
      if (s.phase === 'lobby') {
        const pl = q('#gh-players'), st = q('#gh-start');
        if (!pl || !st) return draw();
        pl.textContent = s.players.length ? `Players (${s.players.length} of ${MAX_PLAYERS}): ${s.players.map(x => x.name).join(', ')}` : 'No one has joined yet.';
        if (s.players.length) st.removeAttribute('disabled'); else st.setAttribute('disabled', '');
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
      const opts = roomOptions(cfg, s.code);
      if (!opts) { status.textContent = 'This page could not open a game room. Reload and try again.'; return; }
      try { s.conn = await Room.connect(opts); } catch { status.textContent = 'This page could not open a game room. Check your connection and reload.'; return; }
      if (s.closed) { s.conn.close(); return; }
      s.off = s.conn.onMessage(onMessage);
      status.textContent = `Room ${s.code} is open.`;
      draw(); broadcast();
      s.beat = setInterval(() => { if (!s.closed && s.phase !== 'question') broadcast(); }, 5000);        // the question phase sends every 5 s from its own clock
    })();

    root.replaceChildren(h('p', { class: 'form-note', role: 'note' }, h('strong', {}, 'DRAFT. '), 'Five sample rounds made from a made-up script. Names and guesses pass between this screen and the phones and are not kept.'),
      status, live, stage);
    draw();
    // the same functions the host's buttons call (tests drive a whole game through them)
    return { close, state: () => s, start: () => startRound(0), reveal, next: () => (s.round + 1 >= rounds.length ? finish() : startRound(s.round + 1)) };
  }

  window.ryagramGamesHost = Object.freeze({ on, roomOptions, nameProblem, ranks, scoreRound, mount, MAX_PLAYERS, ROUND_SECONDS });
})();
