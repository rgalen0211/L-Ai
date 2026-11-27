// GAMES 11-27 (Claude 08:10, the Games department live behind the switch `games`): the PHONE side of a LIVE round of "Guess the next line".
// A player opens /game-phone/, types the room code the host's screen shows and a name, and sends a typed guess each round. TEXT ONLY: no microphone,
// no camera, no picture, no file. The phone talks to the host's screen through the room in assets/game-room.js (Supabase Realtime broadcast on
// uselai.com; a test relay on 127.0.0.1 only): nothing is stored anywhere, and the phone never sees an answer before the host's screen reveals it.
// The host scores; the phone only shows what the host sends. Words are drafts FOR RYAN'S YES.
(function () {
  const local = () => ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  const liveOn = cfg => !!cfg && (cfg.games === true || cfg.games === 'account');
  const JOIN_WAIT_MS = 6000;

  // Which room the page uses: the test relay only when this page AND the relay are on this computer; otherwise Supabase Realtime with the public key.
  function roomOptions(cfg, code) {
    const q = new URLSearchParams(location.search);
    if (local() && q.get('relay')) return { kind: 'relay', base: q.get('relay'), code };
    if (!window.supabase || !cfg || !cfg.supabaseUrl || !cfg.supabaseKey) return null;
    const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    return { kind: 'realtime', client, code };
  }
  const newPid = () => { const a = new Uint8Array(12); crypto.getRandomValues(a); return [...a].map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 20); };

  function mount(root, H, Room, cfg) {
    const el = (tag, attrs, ...kids) => {
      const n = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : String(v)); }
      for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
      return n;
    };
    const s = { conn: null, off: null, pid: newPid(), name: '', code: '', round: -1, phase: '', sentText: '', timer: null, left: 0 };
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
    async function leave() { stopTimer(); if (s.off) s.off(); s.off = null; if (s.conn) { try { await s.conn.send({ t: 'leave', pid: s.pid }); } catch { /* the room is gone */ } s.conn.close(); } s.conn = null; }

    function join(note) {
      s.round = -1; s.phase = '';
      const code = field('ph-code', 'Room code', `The ${Room.CODE_LEN} letters on the host's screen.`, el('input', { type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '9', class: 'ph-input ph-code' }));
      const name = field('ph-name', 'Your name', `For the scoreboard, at most ${H.NAME_MAX} letters.`, el('input', { type: 'text', autocomplete: 'nickname', maxlength: String(H.NAME_MAX + 8), class: 'ph-input' }));
      const button = el('button', { type: 'submit', class: 'ph-btn' }, 'Join the room');
      const form = el('form', { class: 'ph-form', novalidate: true, onsubmit: async ev => {
        ev.preventDefault();
        const cp = H.codeProblem(code.input.value), np = H.nameProblem(name.input.value, []);
        showErr(code, cp); showErr(name, np);
        if (cp) return code.input.focus();
        if (np) return name.input.focus();
        s.code = Room.normCode(code.input.value); s.name = H.clean(name.input.value);
        const opts = roomOptions(cfg, s.code);
        if (!opts) { showErr(code, 'This page could not reach the game rooms. Reload the page and try again.'); return code.input.focus(); }
        button.disabled = true; button.textContent = 'Joining…';
        try {
          s.conn = await Room.connect(opts);
        } catch {
          button.disabled = false; button.textContent = 'Join the room';
          showErr(code, 'This page could not reach the game rooms. Check your connection and try again.'); return code.input.focus();
        }
        const answer = await new Promise(resolve => {
          const t = setTimeout(() => resolve(null), JOIN_WAIT_MS);
          s.off = s.conn.onMessage(m => {
            if (m.t === 'welcome' && m.pid === s.pid) { clearTimeout(t); resolve(m); }
            else if (m.t === 'state') onState(m);
          });
          s.conn.send({ t: 'join', pid: s.pid, name: s.name }).catch(() => { clearTimeout(t); resolve(null); });
        });
        if (!answer || !answer.ok) {
          await leave();
          button.disabled = false; button.textContent = 'Join the room';
          const why = answer ? answer.problem : 'No room with that code answered. Check the letters on the host’s screen.';
          if (answer && /name/i.test(why || '')) { showErr(name, why); return name.input.focus(); }
          showErr(code, why || 'The host did not let you in.'); return code.input.focus();
        }
        live.textContent = `You joined room ${s.code} as ${s.name}.`;
        lobby();
      } }, code.node, name.node, button);
      show([el('h2', { tabindex: '-1' }, 'Join a game'), note ? el('p', { class: 'ph-meta', role: 'status' }, note) : null, el('p', { class: 'ph-meta' }, 'The host starts a game on their screen and shows a room code.'), form]);
    }

    function lobby(players) {
      s.phase = 'lobby';
      show([el('h2', { tabindex: '-1' }, `You are in room ${s.code}`), el('p', {}, `Your name: `, el('strong', {}, s.name)),
        el('p', { class: 'ph-meta', id: 'ph-lobby-players' }, players && players.length ? `Players: ${players.join(', ')}` : 'Waiting for the host to start.'),
        el('button', { type: 'button', class: 'ph-btn ph-ghost', onclick: async () => { await leave(); join('You left the room.'); } }, 'Leave the room')]);
    }

    function tick(counter) {
      stopTimer();
      const draw = () => { counter.textContent = s.left > 0 ? `${s.left} seconds left` : 'Time is up'; };
      draw();
      s.timer = setInterval(() => { s.left = Math.max(0, s.left - 1); draw(); if (!s.left) stopTimer(); }, 1000);
    }

    function question(m) {
      s.phase = 'question'; s.round = m.round; s.sentText = '';
      const guess = field('ph-guess', 'Your guess for the next line', `Type the words you think come next. ${m.words_left} word${m.words_left === 1 ? ' is' : 's are'} left.`,
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
        try { await s.conn.send({ t: 'guess', pid: s.pid, round: s.round, text }); } catch { showErr(guess, 'Your guess did not reach the host. Send it again.'); return guess.input.focus(); }
        s.sentText = text; sentLine.textContent = `Sent: “${text}”. You can change it until time is up.`;
      } }, guess.node, counter, el('button', { type: 'submit', class: 'ph-btn', id: 'ph-send' }, 'Send my guess'), sentLine);
      s.left = m.left_s || 0;
      live.textContent = `Round ${m.round + 1} of ${m.of}. ${m.words_left} words are left to guess.`;
      show([el('h2', { tabindex: '-1' }, `Round ${m.round + 1} of ${m.of}`), clock, el('p', { class: 'ph-label' }, 'What was said so far'), el('p', { class: 'ph-heard' }, `“${m.heard_text} …”`), form]);
      tick(clock);
    }

    function reveal(m) {
      s.phase = 'reveal'; stopTimer();
      const mine = (m.reveal && m.reveal.results || []).find(r => r.name === s.name);
      live.textContent = `The answer was: ${m.reveal ? m.reveal.answer_text : ''}. You scored ${mine ? mine.points : 0}.`;
      show([el('h2', { tabindex: '-1' }, `Round ${m.round + 1}: the answer`), el('p', { class: 'ph-heard', id: 'ph-answer' }, `“${m.reveal ? m.reveal.answer_text : ''}”`),
        el('p', { id: 'ph-mine' }, mine ? `You: ${mine.points} points (${mine.verdict}).` : 'You sent no guess this round.'),
        el('ul', { class: 'ph-meta' }, (m.reveal && m.reveal.results || []).map(r => el('li', {}, `${r.name}: ${r.points}`))),
        el('p', { class: 'ph-meta' }, 'The host starts the next round.')]);
    }

    function final(m) {
      s.phase = 'final'; stopTimer();
      const totals = m.totals || [];
      live.textContent = 'The game is over.';
      show([el('h2', { tabindex: '-1' }, 'The game is over'), el('ol', { id: 'ph-totals' }, totals.map(t => el('li', {}, `${t.name}: ${t.total}`))),
        el('button', { type: 'button', class: 'ph-btn ph-ghost', onclick: async () => { await leave(); join('You left the room.'); } }, 'Leave the room')]);
    }

    function onState(m) {
      if (!s.conn) return;
      if (m.phase === 'lobby') { if (s.phase === 'lobby' || s.phase === '') { const p = stage.querySelector('#ph-lobby-players'); if (p) p.textContent = m.players.length ? `Players: ${m.players.join(', ')}` : 'Waiting for the host to start.'; else lobby(m.players); } else lobby(m.players); return; }
      if (m.phase === 'question') { if (s.phase !== 'question' || s.round !== m.round) question(m); else s.left = m.left_s || 0; return; }
      if (m.phase === 'reveal') { if (s.phase !== 'reveal' || s.round !== m.round) reveal(m); return; }
      if (m.phase === 'final') { if (s.phase !== 'final') final(m); }
    }

    root.replaceChildren(el('div', { class: 'ph-screen' },
      el('p', { class: 'ph-banner', role: 'note' }, el('strong', {}, 'DRAFT. '), 'Text only: no microphone and no camera. Your name and guesses go to the host’s screen in this room and are not kept.'),
      el('h1', {}, 'Guess the next line'), live, stage));
    join();
    window.addEventListener('pagehide', () => { leave(); });
    return { leave };
  }

  window.ryagramGamePhoneLive = Object.freeze({ liveOn, roomOptions, mount, JOIN_WAIT_MS });
})();
