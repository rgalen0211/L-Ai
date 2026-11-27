// GAMES 11-27 (Claude 08:10, the Games department live behind the switch `games`): the PHONE side of a LIVE round of "Guess the next line".
// A player opens /game-phone/, types the room code the host's screen shows and a name, and sends a typed guess each round. TEXT ONLY: no microphone,
// no camera, no picture, no file. The phone talks to the host's screen through the room in assets/game-room.js (Supabase Realtime broadcast on
// uselai.com; a test relay on 127.0.0.1 only): nothing is stored on any server, and the phone never sees an answer before the host's screen reveals it.
// The host scores; the phone only shows what the host sends. Words are drafts FOR RYAN'S YES.
// REJOIN: this browser TAB remembers its own seat (room code, its player id, its name, its signing key and counter, the host key it pinned) in sessionStorage, which is gone
// when the tab is closed, so a phone whose page reloads mid-game (a sleeping screen, a dropped connection) joins again as the same player and keeps its score.
// SIGNED (11-27): the player id is made from this phone's own key and every join/guess/leave is signed with it, so another phone in the room cannot speak for this one;
// what the host sends is shown only when the host key pinned from this phone's welcome signed it, and a welcome is taken (and its key pinned) ONLY when its key gives the
// very room code the player typed (ryagramGameRoom.codeOf): the code on the host's screen names the host's key, so whoever answers first cannot pose as the host.
// The limit: a stranger would need a key whose code (PBKDF2, 300,000 rounds, about 60 ms per key on a PC: see assets/game-room.js) gives the same 6 letters, about 191 million
// keys on average: months on one core, hours on a GPU. codeOf is slow on purpose, so this phone checks each candidate key once, in parallel, at most 64 per join.
// SAID PLAINLY: an attacker with the code and a precomputed table of host keys (a one-time cost of about 8 core-years or 1.3 GPU-days) CAN pose as the host to a
// phone that joins after them; the slow code raises that cost, it does not remove it.
// 11-27 (WORKER LOW): the seat keeps the highest host seq this phone has taken, and a rejoin takes only a welcome above it, so a replayed old welcome cannot set it back.
// 11-27 (host controls): a signed 'not in' welcome after this phone got in means the host removed it: the phone says so and goes back to the join form.
(function () {
  const local = () => ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  const liveOn = cfg => !!cfg && (cfg.games === true || cfg.games === 'account');
  const JOIN_WAIT_MS = 6000;
  const SILENT_MS = 16000;          // the host sends its state at least every 5 s: three missed in a row means its screen has gone (GAMES a11y audit HIGH 2)

  // Which room the page uses: the test relay only when this page AND the relay are on this computer; otherwise Supabase Realtime with the public key.
  function roomOptions(cfg, code) {
    const q = new URLSearchParams(location.search);
    if (local() && q.get('relay')) return { kind: 'relay', base: q.get('relay'), code };
    if (!window.supabase || !cfg || !cfg.supabaseUrl || !cfg.supabaseKey) return null;
    const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    return { kind: 'realtime', client, code };
  }
  const SEAT_KEY = 'ryagram-game-seat';
  // The tab's seat: { code, pid, name, jwk, seq, hostPub } or null. SIGNED ROOM (11-27): jwk is this phone's private signing key (its pid is made from it, see
  // ryagramGameRoom.pidOf), seq the last number it used (a reload goes on above it), hostPub the host key it pinned. Any problem reading or writing it (storage blocked,
  // a bad value) means "no seat": the player simply joins as new, with a new key.
  function readSeat() {
    try {
      const v = JSON.parse(sessionStorage.getItem(SEAT_KEY) || 'null');
      return v && /^[A-Z]{6}$/.test(v.code) && /^[A-Za-z0-9]{8,32}$/.test(v.pid) && typeof v.name === 'string' && v.name.length <= 16
        && v.jwk && typeof v.jwk === 'object' && typeof v.jwk.d === 'string' && Number.isInteger(v.seq) && v.seq >= 0 && v.seq < 1e9
        && (v.hostPub == null || (typeof v.hostPub === 'string' && /^[A-Za-z0-9_-]{80,100}$/.test(v.hostPub)))
        && (v.hostSeq == null || (Number.isInteger(v.hostSeq) && v.hostSeq >= -1 && v.hostSeq <= 1e9)) ? v : null;
    } catch { return null; }
  }
  const writeSeat = seat => { try { if (seat) sessionStorage.setItem(SEAT_KEY, JSON.stringify(seat)); else sessionStorage.removeItem(SEAT_KEY); } catch { /* storage blocked: no rejoin, nothing else changes */ } };

  function mount(root, H, Room, cfg) {
    const el = (tag, attrs, ...kids) => {
      const n = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : String(v)); }
      for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
      return n;
    };
    const s = { conn: null, off: null, pid: '', name: '', code: '', round: -1, phase: '', sentText: '', timer: null, left: 0,
      pair: null, seq: 0, sentSeq: 0, kept: false, hostPub: null, hostSeq: -1, leaveMsg: null, outQ: Promise.resolve(), inQ: Promise.resolve() };
    // SIGNED ROOM (11-27). Every join/guess/leave carries the next seq and this phone's signature; the numbers are kept in the seat as they are used, so a reload goes on above them.
    // After each send a signed leave is made ready, so a closing page (pagehide) can send it at once without waiting for the signature.
    const seatNow = () => ({ code: s.code, pid: s.pid, name: s.name, jwk: s.pair.jwk, seq: s.seq, hostPub: s.hostPub, hostSeq: s.hostSeq });
    const nextSeq = () => { s.seq += 1; if (s.kept) writeSeat(seatNow()); return s.seq; };
    const prepareLeave = async () => {
      if (!s.conn || !s.pair) return;
      const seq = nextSeq(), m = await Room.sign(s.pair, s.code, { t: 'leave', pid: s.pid, seq });
      if (seq > s.sentSeq) s.leaveMsg = m;
    };
    const sendSigned = msg => {
      const conn = s.conn;
      if (!conn || !s.pair) return Promise.reject(new Error('This room connection is closed.'));
      const p = s.outQ.then(async () => { const seq = nextSeq(); s.sentSeq = seq; await conn.send(await Room.sign(s.pair, s.code, { ...msg, seq })); });
      s.outQ = p.catch(() => {}).then(prepareLeave).catch(() => {});
      return p;
    };
    // What the host sends is shown only when it is signed by the host key this phone pinned from its welcome, with a seq above the last one taken; the rest is dropped.
    const fromHost = async m => {
      if (!s.hostPub || !Number.isInteger(m.seq) || m.seq <= s.hostSeq) return false;
      if (!(await Room.verify(s.hostPub, s.code, m)) || m.seq <= s.hostSeq) return false;
      s.hostSeq = m.seq; s.lastHeard = Date.now(); if (s.kept) writeSeat(seatNow()); return true;          // ANY verified host message counts as heard; the highest host seq stays in the seat
    };
    // 11-27 (red team HIGH W1): a welcome is checked at once, NOT in the one-at-a-time queue, its key's (slow) code worked out once per key (de-duplicated), all in parallel,
    // and at most MAX_CANDIDATES different keys per join attempt. THE TRADE-OFF: codeOf is slow enough to make grinding a host key expensive and fast enough that a few dozen
    // fake hosts cannot block a join; a stranger who gets more than MAX_CANDIDATES fake welcomes in before the host's real one makes that attempt fail ('No room answered'),
    // and the player tries again. It can delay a join; it can never pin a wrong host.
    const MAX_CANDIDATES = 64;
    const live = el('p', { class: 'ph-live', role: 'status', 'aria-live': 'polite' });
    const stage = el('div', { class: 'ph-stage' });
    const show = (kids, focus) => { stage.replaceChildren(...kids.filter(Boolean)); (focus || stage.querySelector('h2')).focus(); };
    function field(id, labelText, hint, input) {
      input.id = id; input.setAttribute('aria-describedby', `${id}-hint ${id}-err`);
      const err = el('p', { class: 'ph-err', id: `${id}-err`, role: 'alert' });
      return { input, err, node: el('div', { class: 'ph-field' }, el('label', { for: id }, labelText), el('p', { class: 'ph-hint', id: `${id}-hint` }, hint), input, err) };
    }
    const showErr = (f, msg) => { f.err.textContent = msg || ''; if (msg) f.input.setAttribute('aria-invalid', 'true'); else f.input.removeAttribute('aria-invalid'); };
    const stopTimer = () => { if (s.timer) clearInterval(s.timer); s.timer = null; };
    const endDot = t => String(t || '').replace(/[.!?]+$/, '');
    const stopAfter = t => (/[.!?]$/.test(String(t || '')) ? '' : '.');          // a full stop after a quoted guess, unless the guess ends with its own . ! or ?
    const watch = () => { if (s.watch) clearInterval(s.watch); s.lastHeard = Date.now(); s.watch = setInterval(() => {
      if (s.welcomed && s.conn && Date.now() - s.lastHeard > SILENT_MS) { clearInterval(s.watch); s.watch = null; silent(); } }, 2000); };
    const unwatch = () => { if (s.watch) clearInterval(s.watch); s.watch = null; };
    async function leave() {
      stopTimer(); unwatch(); if (s.off) s.off(); s.off = null;
      const conn = s.conn, ready = s.leaveMsg && s.leaveMsg.seq > s.sentSeq ? s.leaveMsg : null;
      s.leaveMsg = null;
      if (conn && s.pair) {
        try {
          if (ready) { s.sentSeq = ready.seq; s.kept = false; await conn.send(ready); }          // sent at once: a closing page does not wait for a signature
          else { const seq = nextSeq(); s.sentSeq = seq; s.kept = false; await conn.send(await Room.sign(s.pair, s.code, { t: 'leave', pid: s.pid, seq })); }
        } catch { /* the room is gone */ }
      }
      s.kept = false;
      if (conn) conn.close();
      s.conn = null;
    }

    function join(note) {
      s.round = -1; s.phase = ''; live.textContent = ''; banner.hidden = false; setTitle(null, false);          // the page title back to the default, not the last game's
      const code = field('ph-code', 'Room code', `The ${Room.CODE_LEN} letters on the host's screen.`, el('input', { type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '9', class: 'ph-input ph-code' }));
      const name = field('ph-name', 'Your name', `For the scoreboard, at most ${H.NAME_MAX} letters.`, el('input', { type: 'text', autocomplete: 'nickname', maxlength: String(H.NAME_MAX + 8), class: 'ph-input' }));
      const button = el('button', { type: 'submit', class: 'ph-btn' }, 'Join the room');
      const joinNote = el('p', { class: 'ph-meta ph-join-note', role: 'alert', id: 'ph-join-note', hidden: true });
      const form = el('form', { class: 'ph-form', novalidate: true, onsubmit: async ev => {
        ev.preventDefault();
        const cp = H.codeProblem(code.input.value), np = H.nameProblem(name.input.value, []);
        showErr(code, cp); showErr(name, np);
        if (cp) return code.input.focus();
        if (np) return name.input.focus();
        s.code = Room.normCode(code.input.value); s.name = H.clean(name.input.value);
        const seat = readSeat();
        s.welcomed = false;
        const opts = roomOptions(cfg, s.code);
        if (!opts) { showErr(code, 'This page could not reach the game rooms. Reload the page and try again.'); return code.input.focus(); }
        button.disabled = true; button.textContent = 'Joining\u2026';
        // the same room and name in this tab: the same player (the same key, so the same pid); otherwise a new key and so a new pid
        const same = !!(seat && seat.code === s.code && seat.name.toLowerCase() === s.name.toLowerCase());
        try {
          s.pair = null;
          if (same) { try { const p = await Room.keyPair(seat.jwk); if ((await Room.pidOf(p.pub)) === seat.pid) s.pair = p; } catch { s.pair = null; } }
          s.kept = !!s.pair; s.seq = s.kept ? seat.seq : 0; s.hostPub = s.kept ? (seat.hostPub || null) : null;
          if (!s.pair) s.pair = await Room.keyPair();
          s.pid = await Room.pidOf(s.pair.pub);
        } catch {
          button.disabled = false; button.textContent = 'Join the room';
          showErr(code, 'This browser cannot sign the game\u2019s messages. Open this page on a secure (https) address in an up-to-date browser.'); return code.input.focus();
        }
        s.sentSeq = s.seq; s.hostSeq = s.kept && s.hostPub && Number.isInteger(seat.hostSeq) ? seat.hostSeq : -1; s.leaveMsg = null; s.outQ = Promise.resolve(); s.inQ = Promise.resolve();
        const pinned = s.hostPub, tried = new Map();          // pub -> Promise: does this key give the typed code?
        try {
          s.conn = await Room.connect(opts);
        } catch {
          button.disabled = false; button.textContent = 'Join the room';
          showErr(code, 'This page could not reach the game rooms. Check your connection and try again.'); return code.input.focus();
        }
        const answer = await new Promise(resolve => {
          let done = false;
          const t = setTimeout(() => { done = true; resolve(null); }, JOIN_WAIT_MS);
          // nothing from the room is shown before the host has let this phone in, and then only what the pinned host key signed
          const candidate = async m => {
            if (!m.pub || (pinned && m.pub !== pinned)) return;          // a rejoin keeps the host key it pinned before
            if (!Number.isInteger(m.seq) || m.seq <= s.hostSeq) return;          // a rejoin takes only a welcome newer than every host message it took before (a replay is old)
            if (!(await Room.verify(m.pub, s.code, m)) || done) return;          // the cheap check first
            if (!tried.has(m.pub)) { if (tried.size >= MAX_CANDIDATES) return; tried.set(m.pub, Room.codeOf(m.pub).then(c => c === s.code, () => false)); }
            if (!(await tried.get(m.pub)) || done) return;          // the key must be the one the typed code names: a stranger's welcome (ok or not, any problem text) is ignored
            done = true; clearTimeout(t);
            if (m.ok) { s.hostPub = m.pub; s.hostSeq = m.seq; s.welcomed = true; if (m.name) s.name = m.name; }          // the name the host seated this phone under (a rejoin typed in another case)
            resolve(m);
          };
          const handle = async m => {
            if (m.t === 'state' && s.welcomed) { if (await fromHost(m)) onState(m); }
            else if (m.t === 'got' && m.pid === s.pid && s.welcomed) { if (await fromHost(m)) gotIt(m); }
            else if (m.t === 'welcome' && m.pid === s.pid && s.welcomed && m.ok === false && m.pub === s.hostPub) { if (await fromHost(m)) removed(m.problem); }
          };
          s.off = s.conn.onMessage(m => {
            if (m.t === 'welcome' && m.pid === s.pid && !done && !s.welcomed) { candidate(m).catch(() => {}); return; }          // outside the queue, in parallel
            s.inQ = s.inQ.then(() => handle(m)).catch(() => {});
          });
          sendSigned({ t: 'join', pid: s.pid, name: s.name, pub: s.pair.pub }).catch(() => { if (!done) { done = true; clearTimeout(t); resolve(null); } });
        });
        if (!answer || !answer.ok) {
          await leave();
          button.disabled = false; button.textContent = 'Join the room';
          const why = answer ? answer.problem : 'No room with that code answered. Check the letters on the host’s screen.';
          if (answer && /name/i.test(why || '')) { showErr(name, why); return name.input.focus(); }
          if (answer && /full|started|locked|removed/i.test(why || '')) { joinNote.textContent = why; joinNote.hidden = false; return button.focus(); }        // the code was right: say it above the form (8-player test LOW)
          showErr(code, why || 'The host did not let you in.'); return code.input.focus();
        }
        s.welcomed = true; s.kept = true; writeSeat(seatNow()); banner.hidden = true; watch();        // the draft note collapses once in, so Send stays on a small screen (audit 16)
        live.textContent = `You joined room ${s.code} as ${s.name}.`;
        lobby();
      } }, code.node, name.node, button);
      const seat = note ? null : readSeat();          // after "Leave the room" the form starts empty
      if (seat) { code.input.value = seat.code; name.input.value = seat.name; }
      show([el('h2', { tabindex: '-1' }, 'Join a game'), note ? el('p', { class: 'ph-meta', role: 'status' }, note) : null,
        joinNote, seat ? el('p', { class: 'ph-meta', role: 'status', id: 'ph-rejoin' }, `You were in room ${seat.code} as ${seat.name}. Press Join the room to go back in with your score.`) : el('p', { class: 'ph-meta' }, 'The host starts a game on their screen and shows a room code.'), form]);
    }

    function lobby(players) {
      s.phase = 'lobby';
      show([el('h2', { tabindex: '-1' }, `You are in room ${s.code}`), el('p', {}, `Your name: `, el('strong', {}, s.name)),
        el('p', { class: 'ph-meta', id: 'ph-lobby-game', 'aria-live': 'polite' }, 'The game: Guess the next line.'),
        el('p', { class: 'ph-meta', id: 'ph-lobby-players', 'aria-live': 'polite' }, players && players.length ? `Players: ${players.join(', ')}` : 'Waiting for the host to start.'),
        el('button', { type: 'button', class: 'ph-btn ph-ghost', onclick: async () => { await leave(); writeSeat(null); join('You left the room.'); } }, 'Leave the room')]);
    }

    function tick(counter) {
      stopTimer();
      const draw = () => { counter.textContent = s.left > 0 ? `${s.left} seconds left` : 'Time is up'; };
      draw();
      s.timer = setInterval(() => { s.left = Math.max(0, s.left - 1); draw(); if (!s.left) { stopTimer(); const b = stage.querySelector('#ph-send'); if (b) b.disabled = true; const g = stage.querySelector('#ph-guess'); if (g) g.readOnly = true; const sl = stage.querySelector('#ph-sent'); if (sl && s.pending) sl.textContent = `Your guess: “${s.pending}”${stopAfter(s.pending)} Time is up.`; } }, 1000);        // time is up: no guess can land late (audit 13)
    }

    function question(m) {
      s.phase = 'question'; s.round = m.round; s.sentText = ''; s.pending = '';          // a new round starts with no guess (never the last round's)
      const gap = m.mode === 'gap';           // GAMES 11-27: Fill the gap shows the whole line with one word missing and asks for that word
      setTitle(m.mode, true);
      const guess = field('ph-guess', gap ? 'The missing word' : 'Your guess for the next line', gap ? 'Type the one word that goes in the gap.' : `Type the words you think come next. ${m.words_left} word${m.words_left === 1 ? ' is' : 's are'} left.`,
        el('textarea', { rows: '3', maxlength: String(H.ANSWER_MAX + 40), autocomplete: 'off', class: 'ph-input ph-guess' }));
      const counter = el('p', { class: 'ph-count', id: 'ph-guess-count' }, H.counterText(''));
      const clock = el('p', { class: 'ph-meta', id: 'ph-clock', 'aria-live': 'off' });
      const sentLine = el('p', { class: 'ph-meta', id: 'ph-sent', role: 'status' });
      guess.input.setAttribute('aria-describedby', 'ph-guess-hint ph-guess-count ph-guess-err');
      guess.input.addEventListener('input', () => { counter.textContent = H.counterText(guess.input.value); if (guess.err.textContent) showErr(guess, null); });
      const form = el('form', { class: 'ph-form', novalidate: true, onsubmit: async ev => {
        ev.preventDefault();
        const p = H.answerProblem(guess.input.value); showErr(guess, p);
        if (p) return guess.input.focus();
        const text = H.clean(guess.input.value);
        s.sentText = text; s.pending = text; sentLine.textContent = 'Sending…';          // set BEFORE the send: the host's 'got' can arrive before send() resolves (3-player test race); 'Sent' only on 'got' (audit 13)
        try { await sendSigned({ t: 'guess', pid: s.pid, round: s.round, text }); } catch { s.pending = ''; sentLine.textContent = ''; showErr(guess, 'Your guess did not reach the host. Send it again.'); return guess.input.focus(); }
      } }, guess.node, counter, el('button', { type: 'submit', class: 'ph-btn', id: 'ph-send' }, 'Send my guess'), sentLine);
      const leaveBtn = () => twoStepLeave();        // leave at any time, not only in the lobby (verify H1); a second press is needed so a mis-tap under Send does not drop the player
      s.left = m.left_s || 0;
      live.textContent = gap ? `Round ${m.round + 1} of ${m.of}. Fill the gap: one word is missing.` : `Round ${m.round + 1} of ${m.of}. ${m.words_left} word${m.words_left === 1 ? ' is' : 's are'} left to guess.`;
      show([el('h2', { tabindex: '-1' }, gap ? `Round ${m.round + 1} of ${m.of}: fill the gap` : `Round ${m.round + 1} of ${m.of}`), clock,
        el('p', { class: 'ph-label' }, gap ? 'The line, with one word missing' : 'What was said so far'), el('p', { class: 'ph-heard', id: 'ph-heard' }, gap ? `“${m.heard_text}”` : `“${m.heard_text} …”`), form, leaveBtn()]);
      tick(clock);
    }

    function reveal(m) {
      s.phase = 'reveal'; stopTimer(); setTitle(m.mode, true);
      const mine = (m.reveal && m.reveal.results || []).find(r => r.name === s.name);
      live.textContent = `The answer was: ${endDot(m.reveal ? m.reveal.answer_text : '')}. You scored ${mine ? mine.points : 0}.`;
      show([el('h2', { tabindex: '-1' }, `Round ${m.round + 1}: the answer`), el('p', { class: 'ph-heard', id: 'ph-answer' }, `“${m.reveal ? m.reveal.answer_text : ''}”`),
        el('p', { id: 'ph-mine' }, mine ? `You: ${mine.points} points (${mine.verdict}).` : 'You sent no guess this round.'),
        el('ul', { class: 'ph-meta' }, (m.reveal && m.reveal.results || []).map(r => el('li', {}, `${r.name}: ${r.points}`))),
        el('p', { class: 'ph-meta' }, 'The host starts the next round.'),
        twoStepLeave()]);
    }

    function final(m) {
      s.phase = 'final'; stopTimer(); setTitle(m.mode, false);
      const totals = m.totals || [];             // ranked by the host (highest first); a tie shares the place
      let place = 0, last = null; const placed = totals.map((t, i) => { if (t.total !== last) { place = i + 1; last = t.total; } return { ...t, place }; });
      const me = placed.find(t => t.name === s.name);
      const nth = n => n + ((n % 100 >= 11 && n % 100 <= 13) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
      const shared = me && placed.filter(t => t.place === me.place).length > 1;
      const mine = me ? `You came ${nth(me.place)}${shared ? ' (shared)' : ''} with ${me.total} points.` : '';
      live.textContent = me ? `The game is over. ${mine}` : 'The game is over.';
      show([el('h2', { tabindex: '-1' }, 'The game is over'), me ? el('p', { id: 'ph-place' }, mine) : null,
        el('ul', { id: 'ph-totals', class: 'ph-meta' }, placed.map(t => el('li', {}, `${t.place}. ${t.name}: ${t.total}`))),
        el('button', { type: 'button', class: 'ph-btn ph-ghost', onclick: async () => { await leave(); writeSeat(null); join('You left the room.'); } }, 'Leave the room')]);
    }

    function twoStepLeave() {
      let armed = null;
      const b = el('button', { type: 'button', class: 'ph-btn ph-ghost ph-leave', onclick: async () => {
        if (!armed) { b.textContent = 'Press again to leave this game'; live.textContent = 'Press again to leave this game.'; armed = setTimeout(() => { armed = null; b.textContent = 'Leave the room'; }, 5000); return; }
        clearTimeout(armed); await leave(); writeSeat(null); join('You left the room.'); } }, 'Leave the room');
      return b;
    }

    function gotIt(m) {
      if (s.phase !== 'question' || m.round !== s.round) return;
      const line = stage.querySelector('#ph-sent'); if (line && s.pending) line.textContent = `Sent: “${s.pending}”${stopAfter(s.pending)} You can change it until time is up.`;        // the guess exactly as typed (verify2 LOW)
    }

    async function removed(why) {
      await leave(); writeSeat(null);
      join(why || 'The host removed you from this room.');
    }

    function silent() {
      stopTimer();
      live.textContent = 'The host’s screen stopped answering.';
      show([el('h2', { tabindex: '-1' }, 'The host’s screen stopped answering'), el('p', {}, 'If the host opened a new room, join again with the new code on their screen.'),
        el('button', { type: 'button', class: 'ph-btn', id: 'ph-again', onclick: async () => { await leave(); writeSeat(null); join('Type the new code from the host’s screen.'); } }, 'Join a room')]);
    }

    function onState(m) {
      if (!s.conn) return;
      if (m.phase === 'lobby') { if (s.phase === 'lobby' || s.phase === '') { const p = stage.querySelector('#ph-lobby-players'); if (p) p.textContent = m.players.length ? `Players: ${m.players.join(', ')}` : 'Waiting for the host to start.'; else lobby(m.players); } else lobby(m.players);
        const g = stage.querySelector('#ph-lobby-game'); if (g) g.textContent = m.mode === 'gap' ? 'The game: Fill the gap.' : 'The game: Guess the next line.'; setTitle(m.mode, false); return; }
      if (m.phase === 'question') { if (s.phase !== 'question' || s.round !== m.round) question(m); else s.left = m.left_s || 0; return; }
      if (m.phase === 'reveal') { if (s.phase !== 'reveal' || s.round !== m.round) reveal(m); return; }
      if (m.phase === 'final') { if (s.phase !== 'final') final(m); }
    }

    const banner = el('p', { class: 'ph-banner', role: 'note' }, el('strong', {}, 'DRAFT. '), 'Text only: no microphone and no camera. The game saves nothing to an account or a file. Your name and guesses go to everyone in this room, and this tab remembers your seat until you close it. Anyone with the room code can join.');
    const title = el('h1', { id: 'ph-title' }, 'Guess the next line');
    const setTitle = (mode, compact) => { title.textContent = mode === 'gap' ? 'Fill the gap' : 'Guess the next line'; title.classList.toggle('ph-compact', !!compact); };        // the page's own title says which game (8-player test LOW); small during a round so Send stays higher
    root.replaceChildren(el('div', { class: 'ph-screen' }, banner, title, live, stage));
    join();
    window.addEventListener('pagehide', () => { leave(); });
    return { leave };
  }

  window.ryagramGamePhoneLive = Object.freeze({ liveOn, roomOptions, mount, JOIN_WAIT_MS });
})();
