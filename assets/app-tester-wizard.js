// NEXT-WEB 192: the tester first-run wizard (#/tester-start, behind testerWizard, OFF). Four steps in plain words: signed in, your computer, your disk, your first film.
// The page can SEE two of them (a computer signed in and seen lately; a film made). It cannot see the computer's disk: that step is the person's own yes, and the page says so.
// Every sentence is a draft for Ryan's wording (public text is his and the lawyer's); the disk number is left for him to set.
(function () {
  const SEEN_MS = 180000;                                    // the same "awake" rule as the Account and My films pages: used in the last three minutes
  const DISK_KEY = 'ryagram.testerWizard.diskChecked';       // a per-browser convenience only; the page works without it
  const WORDS = {
    title: 'Get started as a tester',
    intro: 'Four short steps. Your films are made on your own computer, not on ours, so the first two make sure that computer is ready.',
    notTester: 'This page is for invited testers. If you were invited, ask Ryan to turn it on for your account.',
    loadError: 'This page could not read your account just now. Try again in a minute.',
    again: 'Check again',
    diskNote: 'This page cannot see your computer’s disk, so only you can say yes here.',
    diskDone: 'You said the drive has room. Say so again any time if that changes.',
  };
  const ago = ms => { const m = Math.max(0, Math.round(ms / 60000)); if (m < 2) return 'a minute ago'; if (m < 120) return `${m} minutes ago`; const hr = Math.round(m / 60); if (hr < 48) return `${hr} hours ago`; return `${Math.round(hr / 24)} days ago`; };
  // The app is Windows only today (proposals/CONNECT-MAC-READY-PLAN.md). The same two draft sentences as the download pages (NEXT-WEB 184); the words are Ryan's to decide.
  const MAC_LINES = ['The Ryagram app is for Windows today. A Mac version is planned. It is not built yet, and there is no date.', 'On a Mac you can sign in to Ryagram in your browser, but making a film on your own computer needs the Windows app.'];
  const isMac = nav => { const s = String((nav && ((nav.userAgentData && nav.userAgentData.platform) || nav.platform)) || ''), ua = String((nav && nav.userAgent) || ''); return /^mac/i.test(s) && !/iphone|ipad|ipod/i.test(ua); };
  const clean = s => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60);

  // The computers the person has signed in (revoked ones never count; an expired sign-in is not a working computer), and whether one is awake.
  function computerFacts(rows, now) {
    const live = (Array.isArray(rows) ? rows : []).filter(r => r && typeof r === 'object' && !r.revoked_at && !(Number.isFinite(Date.parse(r.expires_at)) && Date.parse(r.expires_at) <= now));
    const used = r => (Number.isFinite(Date.parse(r.last_used_at)) ? Date.parse(r.last_used_at) : null);
    const awake = live.filter(r => used(r) !== null && now - used(r) < SEEN_MS);
    const latest = live.slice().sort((a, b) => (used(b) || 0) - (used(a) || 0))[0] || null;
    const pick = awake[0] || latest;
    return { count: live.length, awake: awake.length > 0, name: pick ? clean(pick.computer_name || pick.device_name || pick.name) || 'Your computer' : '', lastSeenMs: pick && used(pick) !== null ? now - used(pick) : null };
  }

  // input: { tester, computers, films, diskChecked, now, startHref }. Returns { notTester } or { steps: [{ id, title, state: done|now|next, words, action }], current, allDone }.
  function steps(input) {
    const i = input || {};
    if (i.tester !== true) return { notTester: true, steps: [], current: null, allDone: false };
    const now = Number.isFinite(i.now) ? i.now : Date.now();
    const c = computerFacts(i.computers, now);
    const films = Array.isArray(i.films) ? i.films.length : 0;
    const list = [];
    list.push({ id: 'signin', title: 'You are signed in', done: true, words: 'This page is only open to a signed-in invited tester, so this step is done.' });
    let computerWords, computerAction = null;
    if (c.awake) computerWords = `${c.name} is awake: the Ryagram app on it was seen in the last 3 minutes.`;
    else if (c.count > 0) { computerWords = `${c.name} is signed in, but it was ${c.lastSeenMs === null ? 'not seen yet' : `last seen ${ago(c.lastSeenMs)}`}. Open the Ryagram app on it and leave it open.`; computerAction = { label: 'See my computers', href: '#/account' }; }
    else if (i.platform === 'mac') { computerWords = `${MAC_LINES.join(' ')} Your films wait until a Windows computer is signed in with this account.`; computerAction = null; }
    else { computerWords = 'No computer is signed in yet. Get the Ryagram app on the computer you will make films on, and sign in to it with this account. Your films wait until you do.'; computerAction = { label: 'Get the app and sign in', href: '#/account' }; }
    list.push({ id: 'computer', title: 'Your computer', done: c.awake, words: computerWords, action: computerAction });
    list.push({ id: 'disk', title: 'Room on your drive', done: i.diskChecked === true,
      words: i.diskChecked === true ? WORDS.diskDone : `Films are made on your computer’s own drive, and the Ryagram app pauses a film when that drive is nearly full. Before your first film, check the drive the app uses has room: [DRAFT: Ryan to set how many GB]. ${WORDS.diskNote}` });
    list.push({ id: 'film', title: 'Your first film', done: films > 0,
      words: films > 0 ? `You have ${films === 1 ? 'a film' : `${films} films`} already. See where ${films === 1 ? 'it stands' : 'they stand'} on My films.` : 'Make a short film. It starts on your computer, so leave the app open until it is done.',
      action: films > 0 ? { label: 'My films', href: '#/films' } : { label: 'Make my first film', href: String(i.startHref || '#/') } });
    const firstUndone = list.findIndex(s => !s.done);
    list.forEach((s, k) => { s.state = s.done ? 'done' : (k === firstUndone ? 'now' : 'next'); delete s.done; });
    return { steps: list, current: firstUndone < 0 ? null : list[firstUndone].id, allDone: firstUndone < 0 };
  }

  const storedDisk = () => { try { return window.localStorage.getItem(DISK_KEY) === '1'; } catch (e) { return false; } };
  const storeDisk = on => { try { if (on) window.localStorage.setItem(DISK_KEY, '1'); else window.localStorage.removeItem(DISK_KEY); } catch (e) { /* the step just asks again next time */ } };
  const STATE_WORD = { done: 'Done', now: 'Do this now', next: 'Next' };

  function create({ h, data, errorLine, startHref }) {
    async function wizardView(onStop) {
      const error = errorLine ? errorLine() : null;
      const body = h('div', { class: 'wiz-body' });
      let diskChecked = storedDisk();
      function draw(r) {
        if (r.notTester) { body.replaceChildren(h('p', { class: 'form-intro', role: 'status' }, WORDS.notTester)); return; }
        const kids = [h('ol', { class: 'wiz-steps' }, r.steps.map((s, k) => h('li', { class: `wiz-step wiz-${s.state}`, 'aria-current': s.state === 'now' ? 'step' : null },
          h('h2', {}, `${k + 1}. ${s.title}`), h('p', { class: 'meta' }, h('b', {}, STATE_WORD[s.state])), h('p', {}, s.words),
          ...(s.id === 'disk' ? [h('button', { class: 'button secondary', type: 'button', 'aria-pressed': String(diskChecked), onclick: () => { diskChecked = !diskChecked; storeDisk(diskChecked); load(); } }, diskChecked ? 'I need to check again' : 'I checked: the drive has room')] : []),
          ...(s.action ? [h('a', { class: `button ${s.state === 'now' ? 'primary' : 'secondary'}`, href: s.action.href }, s.action.label)] : []))))];
        if (r.allDone) kids.push(h('p', { class: 'form-intro', role: 'status' }, 'All four steps are done. You are set.'));
        kids.push(h('button', { class: 'button secondary', type: 'button', onclick: load }, WORDS.again));
        body.replaceChildren(...kids);
      }
      async function load() {
        let tester = false, computers = [], films = [];
        try { tester = data.myLocalCompute ? await data.myLocalCompute() : false; }
        catch (e) { body.replaceChildren(h('p', { class: 'app-error', role: 'alert' }, WORDS.loadError)); return; }
        if (tester) {
          try { computers = await data.myComputers(); } catch (e) { computers = []; }
          try { films = await data.listFilms(); } catch (e) { films = []; }
        }
        draw(steps({ tester, computers, films, diskChecked, now: Date.now(), startHref: startHref ? startHref() : '#/', platform: isMac(typeof navigator !== 'undefined' ? navigator : null) ? 'mac' : 'other' }));
      }
      const timer = setInterval(() => { if (!document.hidden) load(); }, 15000);      // a computer that wakes shows as awake without a reload
      if (onStop) onStop(() => clearInterval(timer));
      await load();
      return [h('a', { href: '#/', class: 'back' }, '← All projects'), h('h1', { tabindex: '-1' }, WORDS.title), h('p', { class: 'form-intro' }, WORDS.intro), error, body];
    }
    return { wizardView };
  }
  const flagOn = () => !!(window.ryagramConfig && window.ryagramConfig.testerWizard === true);
  window.ryagramTesterWizard = { WORDS, SEEN_MS, DISK_KEY, computerFacts, steps, create, flagOn, isMac, MAC_LINES };
})();
