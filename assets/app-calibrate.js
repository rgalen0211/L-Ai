// "Help tune Ryagram, earn credits" (#/calibrate; WEB 11-27, Ryan's idea of 11:42; proposals/WEB-CALIBRATE-PAGE-1127.md). Behind the per-account switch 'calibrate'.
// A person who opts in answers a few quick questions about clips (pick the better cut, confirm the speaker, is this the phrase, rate a match); the SERVER decides every credit.
// This page: sends only the consent choice, the round token, the item token and the option the person chose (one answer per item); never a clip, a path, a transcript or a time; shows only what the server sends
// (progress, what was earned this round / today / this week, why there is no award yet, why it is closed to this account); it computes no credit, knows nothing about which items the server uses to check answers, and measures no time (too fast is the server's word);
// shows NO task and loads NO clip until the person has ticked the opt-in; sends an answer ONLY from a real click or key press (event.isTrusted), so a script or an AI cannot answer for the person.
// FOR RYAN'S YES: every public word on this page is new. No legal wording (the lawyer reads the consent later; the page sends the id of the words it showed).
(() => {
  const CONSENT_ID = 'calibrate-consent-1';
  const TYPES = ['better_cut', 'confirm_speaker', 'is_phrase', 'rate_match'];
  const WORDS = {
    title: 'Help tune Ryagram, earn credits',
    soon: 'Coming soon.',
    offer: 'Help Ryagram get better at making films. Answer a few quick questions about clips, and Ryagram adds free credits to your account.',
    clips: 'The clips are your own videos, or clips that are free to use. They are never anyone else’s videos.',
    noAi: 'Answer yourself. Answers that look automated earn nothing.',
    optIn: 'My answers may be used to improve Ryagram.',
    turnOn: 'Turn on',
    stop: 'Stop helping and withdraw my consent',
    stopped: 'Stopped.',
    skip: 'Skip this one',
    keys: 'Press a number to answer, S to skip.',
    noRound: 'There are no questions right now. Come back later.',
    roundDone: 'That is all for this round. Thank you.',
    noAward: 'No credits for this round yet, because some of the check questions were not all right.',
    pending: 'Your credits for this round will be added to your account later.',
    cap: 'You have reached today’s limit. Come back tomorrow.',
    capWeek: 'You have reached this week’s limit. Come back next week.',
    budget: 'The credits for helping this week are all given out. Come back next week.',
    paused: 'Helping is paused on your account for now.',
    tooFast: 'Too fast. Take your time.',
    gate: { both: 'Help tune opens after {days} days and your first film.', days: 'Help tune opens after {days} days.', film: 'Help tune opens after your first film.', none: 'Help tune is not open for your account yet.' },
    saved: 'Saved.',
    loading: 'Loading…',
    untrusted: 'Answers only count from your own click or key press.',
    clipApp: 'Open the Ryagram app on your computer to see this clip.',
    cantShow: 'We can’t show this question. Skip it.',
    takeBack: 'Take back',
    takenBack: 'Taken back.',
    tryAgain: 'Try again',
    homeLine: 'Answer a few quick questions about clips and Ryagram adds free credits to your account.',
    open: 'Open',
    err: {
      load: 'Couldn’t load your questions. Try again in a minute.',
      consent: 'Couldn’t save your choice. Try again.',
      answer: 'Couldn’t save that answer. Try it again.',
      ended: 'That round has ended. Here is a new one.',
      used: 'That question was already answered.',
      notOn: 'This isn’t on for your account yet.',
      undo: 'Couldn’t take that back. Try again.'
    },
    types: { better_cut: 'Picked a cut', confirm_speaker: 'Confirmed a speaker', is_phrase: 'Checked a phrase', rate_match: 'Rated a match' },
    other: 'A round'
  };

  // Only a real click or key press counts: a script's element.click() or dispatchEvent() has isTrusted === false. (A speed bump: the server is the real gate.)
  const isReal = ev => !!ev && ev.isTrusted === true;
  const num = n => (typeof n === 'number' && Number.isFinite(n) ? n : null);
  const text = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

  // A clip is played only from the person's OWN Ryagram app on their computer (a loopback address) or from an https link the server gives for a licensed clip. Nothing else (no file:, no javascript:, no other http host).
  const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d{1,5})?(\/[^\s]*)?$/i;
  const HTTPS = /^https:\/\/[^\s/@]+(\/[^\s]*)?$/i;
  function clipUrl(clip) {
    if (!clip || typeof clip !== 'object' || typeof clip.url !== 'string' || clip.url.length > 2000) return null;
    if (clip.kind === 'own_app') return LOOPBACK.test(clip.url) ? clip.url : null;
    if (clip.kind === 'licensed') return HTTPS.test(clip.url) ? clip.url : null;
    return null;
  }
  // The person's own clips carry no label and no times (the server must not hold names or times from their videos); only a licensed clip may have a label.
  const clipOf = c => (c && typeof c === 'object' ? { kind: c.kind, url: clipUrl(c), label: c.kind === 'licensed' ? text(c.label, 120) : '' } : null);

  // A task from the server -> the card this page can draw, or null (then the card says so and offers only Skip). Never invents options.
  function taskShape(t) {
    if (!t || typeof t !== 'object' || typeof t.token !== 'string' || !t.token || t.token.length > 200) return null;      // t.token = the item token the server issued for this person and this round
    if (!TYPES.includes(t.type)) return null;
    const prompt = text(t.prompt, 400);
    if (!prompt) return null;
    if (!Array.isArray(t.options) || t.options.length < 1 || t.options.length > 9) return null;
    const options = [];
    for (const o of t.options) {
      if (!o || typeof o.id !== 'string' || !o.id || o.id.length > 40 || o.id === 'skip') return null;
      const label = text(o.label, 120);
      if (!label) return null;
      options.push({ id: o.id, label, clip: clipOf(o.clip) });
    }
    if (new Set(options.map(o => o.id)).size !== options.length) return null;
    if (t.type === 'better_cut' && !(options.length === 2 && options.every(o => o.clip && o.clip.url))) return null;
    return { token: t.token, type: t.type, prompt, clip: clipOf(t.clip), options };
  }

  // The lines of the earned block: only numbers the server sent, never a number of our own.
  function earnedLines(e) {
    const out = [];
    const row = (k, label) => { if (e && num(e[k]) !== null) out.push(`${label}: ${e[k]}`); };
    row('round', 'Earned this round'); row('today', 'Earned today'); row('week', 'Earned this week'); row('total', 'Credits earned so far'); row('pending', 'Waiting to be added');
    return out;
  }
  // The account-gate line: the numbers come from the server (never typed here).
  function gateLine(g) {
    const d = g && num(g.days_needed) !== null && g.days_needed > 0 ? g.days_needed : null, f = !!(g && g.needs_film === true), G = WORDS.gate;
    return d !== null && f ? G.both.replace('{days}', d) : d !== null ? G.days.replace('{days}', d) : f ? G.film : G.none;
  }
  const card = h => h('section', { class: 'cal-home', 'aria-labelledby': 'cal-home-h' },
    h('h2', { id: 'cal-home-h' }, WORDS.title), h('p', { class: 'form-note' }, WORDS.homeLine), h('a', { class: 'button secondary', href: '#/calibrate', id: 'cal-home-link' }, WORDS.open));

  function create({ h, data, date, isOn }) {
    const on = isOn || (() => !!(window.ryagramSwitches && window.ryagramSwitches.featureOn('calibrate') === true));

    async function pageView() {
      const back = h('a', { href: '#/', class: 'back' }, '← All projects');
      const title = h('h1', { tabindex: '-1' }, WORDS.title);
      if (!on()) return [back, title, h('p', { class: 'form-intro', id: 'cal-soon' }, WORDS.soon)];      // switch off: one line, no call, no form

      const status = h('p', { class: 'form-note cal-status', role: 'status', 'aria-live': 'polite' });
      const alert = h('p', { class: 'form-note app-error', role: 'alert', hidden: true });
      const main = h('div', { class: 'cal-main' });
      const earnedBox = h('div', { class: 'cal-earned' });
      let queue = [], round = null, busyNow = false, retry = null, withdrawNote = '';
      const say = s => { status.textContent = s || ''; };
      const fail = (s, again) => { alert.textContent = s; alert.hidden = false; retry = again || null; if (again) main.append(h('button', { class: 'button secondary', type: 'button', id: 'cal-retry', onclick: ev => { if (isReal(ev)) again(); } }, WORDS.tryAgain)); };
      const clearAlert = () => { alert.hidden = true; alert.textContent = ''; retry = null; };
      const notOn = err => /not_on/.test(String(err && err.message));
      const show = (...nodes) => main.replaceChildren(...nodes.filter(Boolean));

      // ---- the earned block (numbers from the server only) with a Take back per award
      async function drawEarned() {
        let e;
        try { e = await data.myCalibrationEarned(); } catch { earnedBox.replaceChildren(); return; }
        const lines = earnedLines(e);
        const rows = Array.isArray(e && e.ledger) ? e.ledger.filter(r => r && typeof r.id === 'string').slice(0, 20) : [];
        earnedBox.replaceChildren(...[
          lines.length ? h('p', { class: 'cal-earned-lines', id: 'cal-earned' }, lines.join('. ') + '.') : null,
          rows.length ? h('ul', { class: 'project-list cal-ledger' }, rows.map(r => {
            const label = `${WORDS.types[r.task_type] || WORDS.other}${num(r.credits) !== null ? `, ${r.credits}` : ''}${r.at && !isNaN(new Date(r.at)) && date ? `, ${date(r.at)}` : ''}`;
            const undo = h('button', { class: 'button secondary small cal-undo', type: 'button', 'aria-label': `${WORDS.takeBack}: ${label}`, onclick: async ev => {
              if (!isReal(ev)) { say(WORDS.untrusted); return; }
              if (busyNow) return; busyNow = true; clearAlert();
              try { await data.undoMyCalibrationAward(r.id); say(WORDS.takenBack); await drawEarned(); } catch { alert.textContent = WORDS.err.undo; alert.hidden = false; } finally { busyNow = false; }
            } }, WORDS.takeBack);
            return h('li', {}, h('span', { class: 'meta' }, label), ' ', r.undone ? h('span', { class: 'meta' }, '(taken back)') : undo);
          })) : null].filter(Boolean));
      }

      // ---- consent not given: the offer, the opt-in, nothing else; NO task is fetched
      function drawConsent(cleared, note) {
        queue = []; round = null; earnedBox.replaceChildren();
        const box = h('input', { type: 'checkbox', id: 'cal-optin', class: 'cal-optin' });
        const go = h('button', { class: 'button primary', type: 'button', id: 'cal-on', disabled: true }, WORDS.turnOn);
        box.addEventListener('change', () => { go.disabled = !box.checked; });
        go.addEventListener('click', async ev => {
          if (!isReal(ev)) { say(WORDS.untrusted); return; }
          if (!box.checked || busyNow) return;
          busyNow = true; clearAlert(); go.disabled = true;
          try { const c = await data.setMyCalibrationConsent(true, CONSENT_ID); if (!c || c.consented !== true) throw new Error('x'); busyNow = false; await load(); }
          catch (err) { busyNow = false; go.disabled = !box.checked; alert.textContent = notOn(err) ? WORDS.err.notOn : WORDS.err.consent; alert.hidden = false; }
        });
        show(h('p', { class: 'form-intro' }, WORDS.offer), h('p', { class: 'form-note' }, WORDS.clips), h('p', { class: 'form-note' }, WORDS.noAi),
          h('label', { class: 'cal-optin-label', for: 'cal-optin' }, box, h('span', {}, WORDS.optIn)), h('div', { class: 'actions-row' }, go));
        if (cleared) { say(WORDS.stopped); if (note) main.append(h('p', { class: 'form-note', id: 'cal-withdrawn-note' }, note)); }      // what happens to earlier answers, in the server's words
      }

      // The withdraw control: always visible while the person is opted in. It calls consent_set(false); what happens to earlier answers is the SERVER's sentence (consent_get.withdraw_note, and again in the reply).
      const stopButton = () => h('div', { class: 'cal-stop-block' }, h('button', { class: 'button secondary', type: 'button', id: 'cal-stop', onclick: async ev => {
        if (!isReal(ev)) { say(WORDS.untrusted); return; }
        if (busyNow) return; busyNow = true; clearAlert();
        try { const c = await data.setMyCalibrationConsent(false, CONSENT_ID); busyNow = false; drawConsent(true, text(c && c.note, 600)); } catch { busyNow = false; alert.textContent = WORDS.err.consent; alert.hidden = false; }
      } }, WORDS.stop), withdrawNote ? h('p', { class: 'form-note', id: 'cal-withdraw-note' }, withdrawNote) : null);

      const drawNone = () => { show(h('p', { class: 'form-intro', id: 'cal-none' }, WORDS.noRound), stopButton()); };
      const drawCap = week => { show(h('p', { class: 'form-intro', id: 'cal-cap' }, week ? WORDS.capWeek : WORDS.cap), stopButton()); };
      const drawNote = (id, words) => { show(h('p', { class: 'form-intro', id }, words), stopButton()); };
      const drawGate = (g, withStop) => { show(h('p', { class: 'form-intro', id: 'cal-gate' }, gateLine(g)), withStop ? stopButton() : null); };
      // End of a round: only what the server says about it (earned / no award yet / added later); never which questions were checks.
      const drawDone = result => { show(h('p', { class: 'form-intro', id: 'cal-done' }, WORDS.roundDone), result === 'no_award' ? h('p', { class: 'form-note', id: 'cal-noaward' }, WORDS.noAward) : result === 'pending' ? h('p', { class: 'form-note', id: 'cal-pending' }, WORDS.pending) : null, stopButton()); };

      // ---- one task card at a time
      async function sendAnswer(task, answer, ev) {
        if (!isReal(ev)) { say(WORDS.untrusted); return; }
        if (busyNow) return; busyNow = true; clearAlert();
        main.querySelectorAll('button').forEach(b => { b.disabled = true; });
        try {
          const r = await data.setMyCalibrationAnswer(round, task.token, answer);      // the round token, the item token, the chosen option: nothing else
          if (!r || r.ok !== true) throw new Error('x');
          queue = queue.filter(t => t && t.token !== task.token);
          say(WORDS.saved);
          busyNow = false;
          await drawEarned();
          if (r.cap_reached === true) { drawCap(r.cap_period === 'week'); return; }
          if (r.round_done === true || !queue.length) { drawDone(r.round_result); return; }
          drawTask(num(r.answered), num(r.total));
        } catch (err) {
          busyNow = false;
          const m = String(err && err.message);
          if (/round_ended/.test(m)) { say(WORDS.err.ended); await loadRound(); return; }
          if (/cap_reached/.test(m)) { drawCap(false); return; }
          if (/item_used/.test(m)) { queue = queue.filter(t => t && t.token !== task.token); if (queue.length) drawTask(null, null); else drawDone(null); say(WORDS.err.used); return; }
          drawTask(null, null);
          if (/too_fast/.test(m)) say(WORDS.tooFast);      // only because the server said so; the page measures nothing
          else { alert.textContent = notOn(err) ? WORDS.err.notOn : WORDS.err.answer; alert.hidden = false; }
        }
      }

      function clipEl(c) {
        if (!c) return null;
        if (!c.url) return h('p', { class: 'form-note cal-clip-note' }, WORDS.cantShow);
        const note = h('p', { class: 'form-note cal-clip-note', hidden: true }, WORDS.clipApp);
        const v = h('video', { class: 'cal-video', controls: true, playsinline: true, preload: 'none', 'aria-label': c.label || 'Clip' });
        v.addEventListener('error', () => { note.hidden = false; });
        v.src = c.url;      // set only here, only for an opted-in person, only for the two allowed shapes
        return h('div', { class: 'cal-clip' }, c.label ? h('p', { class: 'meta' }, c.label) : null, v, note);
      }

      function drawTask(answered, total) {
        const raw = queue[0];
        if (!raw) { drawDone(); return; }
        const task = taskShape(raw);
        const skipBtn = t => h('button', { class: 'button secondary cal-skip', type: 'button', id: 'cal-skip', onclick: ev => sendAnswer(t, 'skip', ev) }, WORDS.skip);
        const head = h('h2', { tabindex: '-1', class: 'cal-task-h', id: 'cal-task-h' }, task ? task.prompt : WORDS.cantShow);
        const progress = answered !== null && total !== null ? h('p', { class: 'form-note cal-progress', id: 'cal-progress' }, `${answered} of ${total} answered.`) : null;
        let body;
        if (!task) body = h('div', { class: 'actions-row' }, skipBtn({ token: String(raw && raw.token || '') }));
        else {
          const withClips = task.options.some(o => o.clip);
          const opts = h('div', { class: withClips ? 'cal-opts cal-opts-clips' : 'cal-opts' }, task.options.map((o, i) => {
            const b = h('button', { class: 'button primary cal-opt', type: 'button', 'data-option': o.id, onclick: ev => sendAnswer(task, o.id, ev) }, `${i + 1}. ${o.label}`);
            return o.clip ? h('div', { class: 'cal-opt-clip' }, clipEl(o.clip), b) : b;
          }));
          body = [clipEl(task.clip), opts, h('div', { class: 'actions-row' }, skipBtn(task)), h('p', { class: 'form-note cal-keys' }, WORDS.keys)];
        }
        const cardEl = h('div', { class: 'cal-task', id: 'cal-task', 'data-type': task ? task.type : 'unknown', tabindex: '-1' }, head, progress, body);
        cardEl.addEventListener('keydown', ev => {      // answer keys work only while focus is inside the card, and only as real key presses
          if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat) return;
          const k = String(ev.key || '');
          const isDigit = /^[1-9]$/.test(k), isSkip = k === 's' || k === 'S';
          if (!isDigit && !isSkip) return;
          if (!isReal(ev)) { say(WORDS.untrusted); return; }
          ev.preventDefault();
          if (isSkip) sendAnswer(task || { token: String(raw && raw.token || '') }, 'skip', ev);
          else if (task && task.options[Number(k) - 1]) sendAnswer(task, task.options[Number(k) - 1].id, ev);
        });
        show(cardEl, stopButton());
        head.focus && head.focus({ preventScroll: false });
      }

      async function loadRound() {
        clearAlert();
        let r;
        try { r = await data.myCalibrationRound(); } catch (err) { show(); fail(notOn(err) ? WORDS.err.notOn : WORDS.err.load, notOn(err) ? null : loadRound); return; }
        const st = r && r.state;
        if (st === 'not_consented') { drawConsent(false); return; }
        await drawEarned();
        if (st === 'gate') { drawGate(r.gate, true); return; }
        if (st === 'paused') { drawNote('cal-paused', WORDS.paused); return; }
        if (st === 'budget_used') { drawNote('cal-budget', WORDS.budget); return; }
        if (st === 'cap_reached' || (r && r.cap && r.cap.reached === true)) { drawCap(!!(r.cap && r.cap.period === 'week')); return; }
        const tasks = r && r.round && Array.isArray(r.round.tasks) ? r.round.tasks.slice(0, 50) : [];
        if (st !== 'ready' || !r.round || typeof r.round.token !== 'string' || !tasks.length) { drawNone(); return; }
        round = r.round.token; queue = tasks;
        drawTask(num(r.round.answered), num(r.round.total));
      }

      async function load() {
        clearAlert(); show(h('p', { class: 'form-intro loading', role: 'status' }, WORDS.loading));
        let c;
        try { c = await data.myCalibrationConsent(); } catch (err) { show(); fail(notOn(err) ? WORDS.err.notOn : WORDS.err.load, notOn(err) ? null : load); return; }
        withdrawNote = text(c && c.withdraw_note, 600);
        if (!c || c.consented !== true) { if (c && c.gate && typeof c.gate === 'object') drawGate(c.gate, false); else drawConsent(false); return; }      // the account is not yet allowed to help: say so before asking for consent. No round call, no clip, until the person has opted in
        await loadRound();
      }

      await load();
      return [back, title, status, alert, main, earnedBox];
    }
    return { pageView };
  }

  window.ryagramCalibrate = { WORDS, CONSENT_ID, TYPES, isReal, clipUrl, taskShape, earnedLines, gateLine, card, create };
})();
