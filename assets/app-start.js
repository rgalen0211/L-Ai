// The AI-first front door (#/start): "Connect your AI" first for an invited account with no connected AI, then "Start a film": a few starting lines, each of which opens a NEW
// Claude or ChatGPT chat with the line ready (and always offers Copy). The guided builder and the dataset list stay, under "No AI? Build it step by step". Behind aiFirst (off).
// Design: proposals\WEB-AI-FIRST-FRONT-DOOR.md; Ryan's answers 2026-10-26 12:12: a 7-day "Not now"; invitees without an AI KEEP the door; the starter lines as drafted.
//
// Nothing here reads a person's data into a link: the starter lines are fixed text. "Is an AI connected" is CONNECT's my_connected_ais() (rows > 0); "may this account use connections"
// is connectAccess(). Everything from the server goes in as text nodes, never as HTML. A failing check falls back to the library, never to a blank door.
(() => {
  // Ends every line so any AI knows what to do. The connector already refuses to spend credits, so this is courtesy, not security.
  const TAIL = 'Use the Ryagram connector. Show me a free contact sheet before anything that costs credits.';
  const LINES = [
    { id: 'housing', text: 'Make me a film about housing costs in my county' },
    { id: 'population', text: 'Show how my state’s population changed since 1970' },
    { id: 'spreadsheet', text: 'Use my spreadsheet to make a map' },
    { id: 'rents', text: 'What changed most in US rents this decade? Make it a film' },
    { id: 'article', text: 'Make a short film about the numbers in this article: [paste a link]' },
    { id: 'income', text: 'Compare my county with the state average on income' }
  ];
  const STRIP = 3;                                  // the library strip shows the first three lines, then "More lines"
  const APPS = {
    claude: { label: 'Claude', fresh: 'https://claude.ai/new', prefill: 'https://claude.ai/new?q=' },
    chatgpt: { label: 'ChatGPT', fresh: 'https://chatgpt.com/', prefill: 'https://chatgpt.com/?q=' }
  };
  const MAX_URL = 1800;                             // a longer address is not offered as a prefill link (Copy still works)
  const SNOOZE_KEY = 'ryagram.start.notnow';
  const SNOOZE_MS = 7 * 24 * 3600 * 1000;           // Ryan 2026-10-26: "Not now" lasts 7 days
  const POLL_MS = 10000;

  // ---------------------------------------------------------------- pure helpers (tested in node)
  const lineWithTail = text => `${String(text).trim()} ${TAIL}`;
  // The address that opens a new chat for an app with the line ready. Only a fixed starter line (or its tail) is ever encoded: nothing from a person's account.
  function chatUrl(app, text) {
    const a = APPS[app];
    if (!a) return '';
    const url = a.prefill + encodeURIComponent(lineWithTail(text));
    return url.length <= MAX_URL ? url : a.fresh;
  }
  // Which app a connected AI is, from the name it registered under. Unknown names get no highlighted button (both stay plain).
  function appOf(name) {
    const n = String(name == null ? '' : name).toLowerCase();
    if (/claude|anthropic/.test(n)) return 'claude';
    if (/chatgpt|openai/.test(n)) return 'chatgpt';
    return '';
  }
  const connectedName = rows => {
    const r = (Array.isArray(rows) ? rows : []).find(x => x && typeof x.client_name === 'string' && x.client_name.trim());
    return r ? r.client_name.trim().slice(0, 60) : '';
  };
  // Which screen #/start shows. A check that failed (null) is "library": never a blank door. Not invited: the library. Otherwise no AI = connect, an AI = start.
  function screenFor({ allowed, rows }) {
    if (allowed !== true || !Array.isArray(rows)) return 'library';
    return rows.length === 0 ? 'connect' : 'start';
  }
  // Is "Not now" still in force? `stored` is the time it was pressed, in milliseconds; anything else is "not snoozed".
  const snoozed = (stored, now) => { const t = Number(stored); return Number.isFinite(t) && t > 0 && now >= t && now - t < SNOOZE_MS; };
  // Where the plain library address sends a signed-in person: to the door only when the flag is on, they are invited, no AI is connected and "Not now" is not in force.
  const landsOnDoor = ({ flag, allowed, rows, notNowAt, now }) => flag === true && allowed === true && Array.isArray(rows) && rows.length === 0 && !snoozed(notNowAt, now);
  const flagOn = () => window.ryagramConfig?.aiFirst === true && window.ryagramConfig?.connectAi === true;

  const store = {
    get() { try { return window.localStorage.getItem(SNOOZE_KEY); } catch { return null; } },
    set(v) { try { window.localStorage.setItem(SNOOZE_KEY, String(v)); } catch { /* blocked storage: the door simply shows again */ } },
    clear() { try { window.localStorage.removeItem(SNOOZE_KEY); } catch { /* nothing to clear */ } }
  };

  // ---------------------------------------------------------------- the page
  function create({ h, data, refresh }) {
    // Copy always works where the browser allows it; where it does not, the line is shown selected so the person can copy it by hand.
    async function copyLine(text, note) {
      try {
        await navigator.clipboard.writeText(lineWithTail(text));
        note.textContent = 'Copied. Paste it into a new chat.';
      } catch {
        note.textContent = '';
        const box = h('input', { class: 'start-copybox', type: 'text', readonly: true, 'aria-label': 'The line to copy', value: lineWithTail(text) });
        note.append('Select this and copy it: ', box);
        box.focus(); box.select();
      }
    }

    // One row: the line, then Claude / ChatGPT / Copy. The connected AI's button is the highlighted one. The buttons copy first, so a link that does not fill in costs one paste.
    function lineRow(line, mine, note) {
      const open = key => h('a', { class: `button${mine === key ? ' primary' : ''}`, href: chatUrl(key, line.text), target: '_blank', rel: 'noopener noreferrer',
        'aria-label': `Open a new ${APPS[key].label} chat with: ${line.text}`, onclick: () => { copyLine(line.text, note); } }, APPS[key].label);
      return h('li', { class: 'start-line' }, h('span', { class: 'start-text' }, line.text),
        h('span', { class: 'start-buttons' }, open('claude'), open('chatgpt'),
          h('button', { class: 'button', type: 'button', 'aria-label': `Copy: ${line.text}`, onclick: () => copyLine(line.text, note) }, 'Copy')));
    }

    const builderLink = () => h('a', { href: '#/build' }, 'No AI? Build it step by step');

    function connectScreen() {
      const check = async () => { try { const rows = await data.myConnectedAis(); if (Array.isArray(rows) && rows.length > 0) refresh(); } catch { /* keep waiting */ } };
      const timer = setInterval(check, POLL_MS);
      const onFocus = () => { check(); };
      window.addEventListener('focus', onFocus);
      document.addEventListener('visibilitychange', onFocus);
      const stop = () => { clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
      const view = [
        h('h1', { tabindex: '-1' }, 'Use your AI to make films'),
        h('p', { class: 'form-intro' }, 'Connect Claude or ChatGPT once. Then you just tell it what you want, and it makes the film with Ryagram.'),
        h('div', { class: 'start-step' }, h('strong', {}, '1. Pick your AI'), h('p', { class: 'meta' }, 'We show the exact steps for it, in a new tab.')),
        h('p', {}, h('a', { class: 'button primary', href: '/connect-ai/#claude', target: '_blank', rel: 'noopener' }, 'Connect Claude')),
        h('p', {}, h('a', { class: 'button primary', href: '/connect-ai/#chatgpt', target: '_blank', rel: 'noopener' }, 'Connect ChatGPT (beta)')),
        h('div', { class: 'start-step' }, h('strong', {}, '2. Come back here'), h('p', { class: 'meta', role: 'status' }, 'This page notices when your AI is connected and takes you to the next step.')),
        h('p', { class: 'meta' }, builderLink(), ' · ', h('button', { class: 'linklike', type: 'button', id: 'start-notnow', onclick: () => { store.set(Date.now()); location.hash = '#/'; } }, 'Not now'))
      ];
      return { view, stop };
    }

    function startScreen(rows) {
      const name = connectedName(rows);
      const mine = appOf(name);
      const note = h('p', { class: 'form-note', role: 'status' });
      return [
        name ? h('p', { class: 'start-pill', role: 'status' }, `${name} is connected`) : null,
        h('h1', { tabindex: '-1' }, 'Start a film'),
        h('p', { class: 'form-intro' }, 'Your AI now speaks for Ryagram. Pick a starting line and it opens a new chat with it ready.'),
        h('ul', { class: 'start-lines' }, LINES.map(l => lineRow(l, mine, note))),
        note,
        h('p', { class: 'meta' }, 'Each button opens a new chat. If it does not fill in, press Copy and paste it.'),
        h('p', { class: 'meta' }, builderLink(), ' · ', h('a', { href: '#/account' }, 'Connected AIs'), ' · ', h('a', { href: '#/' }, 'Your projects'))
      ];
    }

    // #/start. Any failure of either check shows the library, never a blank door.
    async function startView(onStop, libraryView) {
      let allowed = false, rows = null;
      try { allowed = await data.connectAccess(); rows = allowed === true ? await data.myConnectedAis() : null; } catch { allowed = false; rows = null; }
      const screen = screenFor({ allowed, rows });
      if (screen === 'library') return libraryView();
      if (screen === 'connect') { const s = connectScreen(); onStop(s.stop); return s.view; }
      store.clear();
      return startScreen(rows);
    }

    // The strip on top of the library: pills for the first lines when an AI is connected, or one line asking to connect when not. Never blocks the library: any failure shows nothing.
    async function strip() {
      try {
        if (await data.connectAccess() !== true) return null;
        const rows = await data.myConnectedAis();
        if (!Array.isArray(rows)) return null;
        if (rows.length === 0) return h('p', { class: 'start-bar' }, h('a', { href: '#/start' }, 'Connect your AI to start films by talking'));
        const mine = appOf(connectedName(rows));
        const note = h('span', { class: 'meta', role: 'status' });
        const pills = LINES.slice(0, STRIP).map(l => mine
          ? h('a', { class: 'start-pill-link', href: chatUrl(mine, l.text), target: '_blank', rel: 'noopener noreferrer', onclick: () => { copyLine(l.text, note); } }, l.text)
          : h('a', { class: 'start-pill-link', href: '#/start' }, l.text));
        return h('div', { class: 'start-strip' }, h('span', { class: 'meta' }, 'Start a film'), ' ', pills, ' ', h('a', { class: 'start-pill-link', href: '#/start' }, 'More lines'), ' ', note);
      } catch { return null; }
    }

    // Does the plain library address go to the door? Asked only when the flag is on; any failure means "no, show the library".
    async function shouldLandOnDoor() {
      if (!flagOn()) return false;
      try {
        const allowed = await data.connectAccess();
        const rows = allowed === true ? await data.myConnectedAis() : null;
        return landsOnDoor({ flag: true, allowed, rows, notNowAt: store.get(), now: Date.now() });
      } catch { return false; }
    }

    return { startView, strip, shouldLandOnDoor };
  }

  window.ryagramStart = { TAIL, LINES, STRIP, APPS, SNOOZE_MS, SNOOZE_KEY, lineWithTail, chatUrl, appOf, connectedName, screenFor, snoozed, landsOnDoor, flagOn, create };
})();
