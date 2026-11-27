// "Help tune Ryagram, earn credits" (#/calibrate; WEB 11-27, Ryan's idea of 11:42; proposals/WEB-CALIBRATE-PAGE-1127.md). Behind the per-account switch 'calibrate'.
// A person who opts in answers a few quick questions about clips (pick the better cut, confirm the speaker, is this the phrase, rate a match); the SERVER decides every credit.
// This page: sends only the consent choice, a round id, a task id and the option the person chose; never a clip, a path or a transcript; shows only the numbers the server sends;
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
    noAi: 'Only you can answer. Your AI can open a round for you, but it cannot answer or earn credits for you.',
    optIn: 'My answers may be used to improve Ryagram.',
    turnOn: 'Turn on',
    stop: 'Stop helping',
    stopped: 'Stopped. Credits you earned stay yours.',
    skip: 'Skip this one',
    keys: 'Press a number to answer, S to skip.',
    noRound: 'There are no questions right now. Come back later.',
    roundDone: 'That is all for this round. Thank you.',
    cap: 'You have reached today’s limit. Come back tomorrow.',
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
      notOn: 'This isn’t on for your account yet.',
      undo: 'Couldn’t take that back. Try again.'
    },
    types: { better_cut: 'Picked a cut', confirm_speaker: 'Confirmed a speaker', is_phrase: 'Checked a phrase', rate_match: 'Rated a match' },
    other: 'An answer'
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
  const clipOf = c => (c && typeof c === 'object' ? { kind: c.kind, url: clipUrl(c), label: text(c.label, 120), start: num(c.start_seconds), end: num(c.end_seconds) } : null);

  // A task from the server -> the card this page can draw, or null (then the card says so and offers only Skip). Never invents options.
  function taskShape(t) {
    if (!t || typeof t !== 'object' || typeof t.id !== 'string' || !t.id || t.id.length > 64) return null;
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
    return { id: t.id, type: t.type, prompt, clip: clipOf(t.clip), options };
  }

  // The lines of the earned block: only numbers the server sent, never a number of our own.
  function earnedLines(e) {
    const out = [];
    if (e && num(e.total) !== null) out.push(`Credits earned so far: ${e.total}`);
    if (e && num(e.today) !== null) out.push(`Earned today: ${e.today}`);
    return out;
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
      let queue = [], round = null, busyNow = false, retry = null;
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
      function drawConsent(cleared) {
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
        if (cleared) say(WORDS.stopped);
      }

      const stopButton = () => h('button', { class: 'button secondary', type: 'button', id: 'cal-stop', onclick: async ev => {
        if (!isReal(ev)) { say(WORDS.untrusted); return; }
        if (busyNow) return; busyNow = true; clearAlert();
        try { await data.setMyCalibrationConsent(false, CONSENT_ID); busyNow = false; drawConsent(true); } catch { busyNow = false; alert.textContent = WORDS.err.consent; alert.hidden = false; }
      } }, WORDS.stop);

      const drawNone = () => { show(h('p', { class: 'form-intro', id: 'cal-none' }, WORDS.noRound), stopButton()); };
      const drawCap = () => { show(h('p', { class: 'form-intro', id: 'cal-cap' }, WORDS.cap), stopButton()); };
      const drawDone = () => { show(h('p', { class: 'form-intro', id: 'cal-done' }, WORDS.roundDone), stopButton()); };

      // ---- one task card at a time
      async function sendAnswer(task, answer, ev) {
        if (!isReal(ev)) { say(WORDS.untrusted); return; }
        if (busyNow) return; busyNow = true; clearAlert();
        main.querySelectorAll('button').forEach(b => { b.disabled = true; });
        try {
          const r = await data.setMyCalibrationAnswer(round, task.id, answer);
          if (!r || r.ok !== true) throw new Error('x');
          queue = queue.filter(t => t && t.id !== task.id);
          const got = num(r.awarded);
          say(got !== null ? `${WORDS.saved} You earned ${got}.` : WORDS.saved);
          busyNow = false;
          await drawEarned();
          if (r.cap_reached === true) { drawCap(); say(`${WORDS.saved}`); return; }
          if (r.round_done === true || !queue.length) { drawDone(); return; }
          drawTask(num(r.answered), num(r.total));
        } catch (err) {
          busyNow = false;
          if (/round_ended/.test(String(err && err.message))) { say(WORDS.err.ended); await loadRound(); return; }
          if (/cap_reached/.test(String(err && err.message))) { drawCap(); return; }
          drawTask(null, null); alert.textContent = notOn(err) ? WORDS.err.notOn : WORDS.err.answer; alert.hidden = false;
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
        if (!task) body = h('div', { class: 'actions-row' }, skipBtn({ id: String(raw && raw.id || '') }));
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
          if (isSkip) sendAnswer(task || { id: String(raw && raw.id || '') }, 'skip', ev);
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
        if (st === 'cap_reached' || (r && r.cap && r.cap.reached === true)) { drawCap(); return; }
        const tasks = r && r.round && Array.isArray(r.round.tasks) ? r.round.tasks.slice(0, 50) : [];
        if (st !== 'ready' || !r.round || typeof r.round.id !== 'string' || !tasks.length) { drawNone(); return; }
        round = r.round.id; queue = tasks;
        drawTask(num(r.round.answered), num(r.round.total));
      }

      async function load() {
        clearAlert(); show(h('p', { class: 'form-intro loading', role: 'status' }, WORDS.loading));
        let c;
        try { c = await data.myCalibrationConsent(); } catch (err) { show(); fail(notOn(err) ? WORDS.err.notOn : WORDS.err.load, notOn(err) ? null : load); return; }
        if (!c || c.consented !== true) { drawConsent(false); return; }      // no round call, no clip, until the person has opted in
        await loadRound();
      }

      await load();
      return [back, title, status, alert, main, earnedBox];
    }
    return { pageView };
  }

  window.ryagramCalibrate = { WORDS, CONSENT_ID, TYPES, isReal, clipUrl, taskShape, earnedLines, card, create };
})();
