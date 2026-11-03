// CLOUD-SITE 11-02: the PHONE page for "Guess the next line" (/game-phone/, behind gamePhone, OFF). The partner of the TV screen (/game-tv/): a player joins a room with the
// code the TV shows, picks a name for the scoreboard, and sends a typed guess each round. TEXT ONLY: no microphone, no camera, no picture, no file.
// Nothing leaves the phone today: the only room the page knows is the SAMPLE room (code GAME), built from the recorded sample game's PUBLIC view (what was said so far and how many
// words are left), never its answers or anyone's guesses. A guess "sent" to the sample room stays in this page's memory and is gone on reload. The real room (players' phones talking to
// the host's Ryagram app) is not built: `send` is the one place it would plug in. No storage, no network, no outside address. Words are drafts for Ryan.
(function () {
  const on = cfg => !!cfg && cfg.gamePhone === true;
  const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';      // no I or O: on a TV across the room they read as 1 and 0
  const CODE_LEN = 4, NAME_MAX = 16, ANSWER_MAX = 120;
  const SAMPLE_CODE = 'GAME';
  const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g;

  const clean = s => String(s ?? '').replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  const chars = s => [...s].length;
  // A code as typed on a phone: lower case, spaces or a dash in the middle are all fine.
  const normCode = s => String(s ?? '').toUpperCase().replace(/[\s-]/g, '');
  function codeProblem(s) {
    const c = normCode(s);
    if (!c) return 'Type the room code from the TV.';
    if (c.length !== CODE_LEN || ![...c].every(ch => CODE_LETTERS.includes(ch))) return `A room code is ${CODE_LEN} letters from the TV, like ${SAMPLE_CODE}. It has no I, no O and no numbers.`;
    return null;
  }
  function nameProblem(s, taken = []) {
    const n = clean(s);
    if (!n) return 'Type a name for the scoreboard.';
    if (chars(n) > NAME_MAX) return `A name is at most ${NAME_MAX} letters.`;
    if (taken.some(t => t.toLowerCase() === n.toLowerCase())) return 'Someone in this room already has that name. Add a letter or pick another.';
    return null;
  }
  function answerProblem(s) {
    const a = clean(s);
    if (!a) return 'Type your guess first.';
    if (chars(a) > ANSWER_MAX) return `A guess is at most ${ANSWER_MAX} characters.`;
    return null;
  }
  const counterText = s => `${chars(clean(s))} of ${ANSWER_MAX} characters`;

  // The sample room: ONLY the public view of each recorded round. The answer and the recorded players' guesses are never copied in.
  function sampleRoom(sample) {
    if (!sample || sample.schema !== 'ryagram.game-night-sample/0' || !Array.isArray(sample.rounds) || !sample.rounds.length) return null;
    const rounds = sample.rounds.map(r => ({ heard_text: String(r.public && r.public.heard_text || ''), words_left: Number(r.public && r.public.words_left) || 0 }));
    if (rounds.some(r => !r.heard_text || r.words_left < 1)) return null;
    const sent = [];
    return Object.freeze({ code: SAMPLE_CODE, sample: true, players: (sample.players || []).map(String), rounds,
      send: (name, round, text) => { sent.push({ name, round, text }); return Promise.resolve({ ok: true }); }, sentCount: () => sent.length });
  }

  function mount(root, rooms) {
    const el = (tag, attrs, ...kids) => {
      const n = document.createElement(tag);
      for (const [k, v] of Object.entries(attrs || {})) { if (v == null || v === false) continue; if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (k === 'class') n.className = v; else n.setAttribute(k, v === true ? '' : v); }
      for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
      return n;
    };
    const state = { room: null, name: '', round: 0, sent: null };
    const live = el('p', { class: 'ph-live', role: 'status', 'aria-live': 'polite' });
    const stage = el('div', { class: 'ph-stage' });

    // One field with its label, its hint and its own error line, tied together for a screen reader.
    function field(id, labelText, hint, input) {
      input.id = id; input.setAttribute('aria-describedby', `${id}-hint ${id}-err`);
      const err = el('p', { class: 'ph-err', id: `${id}-err`, role: 'alert' });
      return { input, err, node: el('div', { class: 'ph-field' }, el('label', { for: id }, labelText), el('p', { class: 'ph-hint', id: `${id}-hint` }, hint), input, err) };
    }
    const showErr = (f, msg) => { f.err.textContent = msg || ''; if (msg) f.input.setAttribute('aria-invalid', 'true'); else f.input.removeAttribute('aria-invalid'); };
    const show = (kids, focus) => { stage.replaceChildren(...kids); (focus || stage.querySelector('h2')).focus(); };

    function join() {
      state.room = null; state.round = 0; state.sent = null;
      const code = field('ph-code', 'Room code', `The ${CODE_LEN} letters on the TV.`, el('input', { type: 'text', inputmode: 'text', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '9', class: 'ph-input ph-code' }));
      const name = field('ph-name', 'Your name', `For the scoreboard, at most ${NAME_MAX} letters.`, el('input', { type: 'text', autocomplete: 'nickname', maxlength: String(NAME_MAX + 8), class: 'ph-input' }));
      const form = el('form', { class: 'ph-form', novalidate: true, onsubmit: ev => {
        ev.preventDefault();
        const cp = codeProblem(code.input.value);
        const room = cp ? null : rooms.find(r => r.code === normCode(code.input.value));
        const codeMsg = cp || (room ? null : 'There is no room with that code right now. Check the letters on the TV.');
        const np = nameProblem(name.input.value, room ? room.players : []);
        showErr(code, codeMsg); showErr(name, np);
        if (codeMsg) return code.input.focus();
        if (np) return name.input.focus();
        state.room = room; state.name = clean(name.input.value); live.textContent = `You joined room ${room.code} as ${state.name}.`;
        question();
      } }, code.node, name.node, el('button', { type: 'submit', class: 'ph-btn' }, 'Join the room'));
      show([el('h2', { tabindex: '-1' }, 'Join a game'), el('p', { class: 'ph-meta' }, `To try it, use the sample room: its code is ${SAMPLE_CODE}.`), form]);
    }

    function question() {
      const r = state.room.rounds[state.round], total = state.room.rounds.length;
      state.sent = null;
      const guess = field('ph-guess', 'Your guess for the next line', `Type the words you think come next. ${r.words_left} word${r.words_left === 1 ? ' is' : 's are'} left.`,
        el('textarea', { rows: '3', maxlength: String(ANSWER_MAX + 40), autocomplete: 'off', class: 'ph-input ph-guess' }));
      const counter = el('p', { class: 'ph-count', id: 'ph-guess-count' }, counterText(''));
      guess.input.setAttribute('aria-describedby', 'ph-guess-hint ph-guess-count ph-guess-err');
      guess.input.addEventListener('input', () => { counter.textContent = counterText(guess.input.value); if (guess.err.textContent) showErr(guess, null); });
      const form = el('form', { class: 'ph-form', novalidate: true, onsubmit: async ev => {
        ev.preventDefault();
        const p = answerProblem(guess.input.value); showErr(guess, p);
        if (p) return guess.input.focus();
        const text = clean(guess.input.value);
        const res = await state.room.send(state.name, state.round, text).catch(() => ({ ok: false }));
        if (!res || !res.ok) { showErr(guess, 'Your guess did not reach the TV. Check you are on the same network and send it again.'); return guess.input.focus(); }
        state.sent = text; sent();
      } }, guess.node, counter, el('button', { type: 'submit', class: 'ph-btn' }, 'Send my guess'));
      live.textContent = `Round ${state.round + 1} of ${total}. ${r.words_left} words are left to guess.`;
      show([el('h2', { tabindex: '-1' }, `Round ${state.round + 1} of ${total}`), el('p', { class: 'ph-label' }, 'What was said so far'), el('p', { class: 'ph-heard' }, `“${r.heard_text} …”`), form]);
    }

    function sent() {
      const last = state.round + 1 >= state.room.rounds.length;
      const kids = [el('h2', { tabindex: '-1' }, 'Guess sent'), el('p', { class: 'ph-meta' }, 'Your guess: ', el('strong', {}, `“${state.sent}”`)),
        el('p', {}, 'Watch the TV: the answer and the points are shown there, not on your phone.')];
      if (state.room.sample) kids.push(el('p', { class: 'ph-meta' }, 'Sample room: your guess stayed on this phone and nothing was sent anywhere.'));
      kids.push(el('button', { type: 'button', class: 'ph-btn ph-ghost', onclick: () => question() }, 'Change my guess'));
      if (state.room.sample) kids.push(el('button', { type: 'button', class: 'ph-btn', onclick: () => { if (last) return over(); state.round += 1; question(); } }, last ? 'Finish the sample' : 'Next round (sample)'));
      live.textContent = 'Your guess was sent. Watch the TV.';
      show(kids);
    }

    function over() {
      live.textContent = 'That was the last round.';
      show([el('h2', { tabindex: '-1' }, 'That was the last round'), el('p', {}, 'The final scores are on the TV.'), el('button', { type: 'button', class: 'ph-btn', onclick: () => join() }, 'Leave the room')]);
    }

    root.replaceChildren(el('div', { class: 'ph-screen' },
      el('p', { class: 'ph-banner', role: 'note' }, el('strong', {}, 'DRAFT. '), 'Only the sample room works: nothing you type leaves this phone. Text only: no microphone and no camera. Draft words for Ryan.'),
      el('h1', {}, 'Guess the next line'), live, stage));
    join();
  }

  window.ryagramGamePhone = Object.freeze({ on, normCode, codeProblem, nameProblem, answerProblem, counterText, clean, sampleRoom, mount, CODE_LETTERS, CODE_LEN, NAME_MAX, ANSWER_MAX, SAMPLE_CODE });
  const root = document.getElementById('game-phone'), off = document.getElementById('not-available'), S = window.ryagramGameTvSample;
  if (root) {
    const enabled = on(window.ryagramConfig);
    root.hidden = !enabled; if (off) off.hidden = enabled;
    if (enabled) { const room = sampleRoom(S); if (!room) root.textContent = 'The sample room could not be made, so nothing is shown.'; else mount(root, [room]); }
  }
})();
