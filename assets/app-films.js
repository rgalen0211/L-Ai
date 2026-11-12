// My films (#/films): ONE page listing a person's films with where each one stands (not started, waiting, making, ready, failed and why), a link to open it, and Try again where trying again is free and allowed
// (NEXT-WEB 174). Behind `myFilms` (off). The page reads what the library already reads (projects, their newest version, that version's jobs); it never decides anything the database decides:
// the words come from app-jobs.js (STATE_LABELS, problem), and Try again only appears where app-jobs.js's own canRetry says a retry is allowed and the job is the free contact sheet. A final render costs
// credits and a preview needs a window, so for those the row says so and links to the film's page. Everything from the server goes in as text nodes, never as HTML.
(() => {
  const WORDS = {
    none: 'Not started', waiting: 'Waiting', making: 'Being made', ready: 'Ready', failed: 'Did not finish', stopped: 'Stopped',
    noFilms: 'No films yet. Start one from All projects.', loadError: 'Couldn’t load your films.', open: 'Open', again: 'Try again', openToRun: 'Open to run it again'
  };
  const READY_WORD = { contact_sheet: 'The contact sheet is ready', preview: 'The preview is ready', final_render: 'The film is ready' };
  const RANK = { final_render: 3, preview: 2, contact_sheet: 1 };

  // ---------------------------------------------------------------- pure helpers (tested in node)
  // A TESTER account's films are made on its own computer (the Ryagram app), so for it "waiting" and "being made" say where. `own` = { tester: true, computers: [my_computers rows], now } or nothing.
  // The computer is "seen" when its sign-in was used in the last 3 minutes (the app's ping keeps last_used_at fresh); otherwise it is named with how long ago it was last seen. Unreadable = no claim.
  const SEEN_MS = 3 * 60 * 1000;
  function agoWords(iso, now) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return 'a while ago';
    const m = Math.max(0, Math.round((now - t) / 60000));
    return m < 1 ? 'just now' : m < 60 ? `${m} minute${m === 1 ? '' : 's'} ago` : m < 48 * 60 ? `${Math.round(m / 60)} hour${Math.round(m / 60) === 1 ? '' : 's'} ago` : `${Math.round(m / 1440)} days ago`;
  }
  function computerState(own) {
    if (!own || own.tester !== true || !Array.isArray(own.computers)) return null;
    const now = Number.isFinite(own.now) ? own.now : Date.now();
    const live = own.computers.filter(c => c && !c.revoked_at);
    if (!live.length) return { state: 'none' };
    const seen = live.map(c => Date.parse(c.last_used_at)).filter(Number.isFinite).sort((a, b) => b - a)[0];
    if (seen !== undefined && now - seen <= SEEN_MS) return { state: 'seen' };
    return { state: 'stale', ago: seen === undefined ? 'not yet' : agoWords(new Date(seen).toISOString(), now), name: String(live[0].computer_name || 'Your computer').slice(0, 60) };
  }
  const WAIT_WHY = {
    none: 'Waiting for your computer. No computer is signed in to your account. Open the Ryagram app on your computer and sign in.',
    seen: 'Waiting for your computer to pick it up. It is signed in and was seen a moment ago.',
    stale: c => `Waiting for your computer. ${c.name} was last seen ${c.ago}. Open the Ryagram app on it so it can pick this film up.`
  };

  // One film's row from its project, its newest version and that version's jobs (newest first). J is app-jobs.js (passed in so this file has no globals of its own).
  function rowFor(film, J, own) {
    const p = film.project || {}, v = film.version || null, jobs = Array.isArray(film.jobs) ? film.jobs.slice().sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))) : [];
    const row = { id: p.id, title: String(p.title || 'Untitled').slice(0, 120), version: v ? v.number : null, status: 'none', word: WORDS.none, why: '', href: v ? `#/v/${v.id}` : `#/p/${p.id}`, again: null, openToRun: false, updated: p.updated_at || null };
    if (!v || !jobs.length) return row;
    const active = jobs.find(j => J.isActive(j));
    if (active) {
      const queued = active.state === 'queued';
      row.status = queued ? 'waiting' : 'making';
      row.word = queued ? WORDS.waiting : WORDS.making;
      row.why = `${J.TYPE_LABELS[active.job_type] || active.job_type}: ${J.STATE_LABELS[active.state] || active.state}.`;
      const cs = computerState(own);
      if (cs) {                                                                    // a tester's film: say where it is
        if (queued) { const w = WAIT_WHY[cs.state]; row.why = `${J.TYPE_LABELS[active.job_type] || active.job_type}: ${typeof w === 'function' ? w(cs) : w}`; }
        else { row.word = 'Being made on your computer'; row.why = `${J.TYPE_LABELS[active.job_type] || active.job_type}: ${J.STATE_LABELS[active.state] || active.state}. Keep the Ryagram app open until it finishes.`; }
      }
      return row;
    }
    const done = jobs.filter(j => j.state === 'complete').sort((a, b) => (RANK[b.job_type] || 0) - (RANK[a.job_type] || 0))[0];
    const last = jobs[0];
    if (last.state === 'complete') {
      row.status = 'ready'; row.word = WORDS.ready; row.why = READY_WORD[last.job_type] || `${J.TYPE_LABELS[last.job_type] || last.job_type} is ready.`;
      return row;
    }
    if (last.state === 'cancelled') {
      row.status = 'stopped'; row.word = WORDS.stopped; row.why = `${J.TYPE_LABELS[last.job_type] || last.job_type} was stopped.${done ? ` ${READY_WORD[done.job_type] || ''}`.trimEnd() : ''}`;
    } else {
      row.status = 'failed'; row.word = WORDS.failed; row.why = J.problem(last);
    }
    if (J.canRetry(last, v.state, jobs)) {
      if (last.job_type === 'contact_sheet') row.again = { versionId: v.id, jobType: 'contact_sheet' };
      else row.openToRun = true;
    }
    return row;
  }
  const rowsFor = (films, J, own) => (Array.isArray(films) ? films : []).map(f => rowFor(f, J, own));
  // Failed and waiting first (they need a person), then making, then the rest; each group newest first.
  const ORDER = { failed: 0, waiting: 1, making: 2, stopped: 3, ready: 4, none: 5 };
  const sorted = rows => rows.slice().sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || String(b.updated).localeCompare(String(a.updated)));

  function create({ h, data, J, busy, showError, errorLine, date }) {
    async function filmsView(onStop) {
      const error = errorLine();
      const list = h('ul', { class: 'project-list films-list' });
      async function load() {
        let films;
        try { films = await data.listFilms(); } catch (err) { list.replaceChildren(h('li', {}, h('p', { class: 'app-error', role: 'alert' }, WORDS.loadError))); return; }
        let own = null;                                                                // a tester account (behind its own switch): where its films are on ITS computer; unreadable = no claim
        if (window.ryagramSwitches && window.ryagramSwitches.featureOn('testerFilmProgress') === true && data.myLocalCompute) {
          try { if (await data.myLocalCompute()) own = { tester: true, computers: await data.myComputers(), now: Date.now() }; } catch { own = null; }
        }
        const rows = sorted(rowsFor(films, J, own));
        if (!rows.length) { list.replaceChildren(h('li', {}, h('p', { class: 'form-intro' }, WORDS.noFilms))); return; }
        list.replaceChildren(...rows.map(r => h('li', { class: `film-row film-${r.status}` },
          h('a', { href: r.href }, h('strong', {}, r.title)),
          h('span', { class: 'meta' }, r.version ? ` · Version ${r.version}` : '', r.updated ? ` · updated ${date(r.updated)}` : ''),
          h('p', { class: `state film-state-${r.status}` }, h('b', {}, r.word), r.why ? ` ${r.why}` : ''),
          r.again ? h('button', { class: 'button secondary small', type: 'button', onclick: async event => {
            await busy(event.currentTarget, 'Submitting…', async () => { try { await data.submitJob(r.again.versionId, r.again.jobType, {}); await load(); } catch (err) { showError(error, err); } });
          } }, WORDS.again) : null,
          r.openToRun ? h('a', { class: 'button secondary small', href: r.href }, WORDS.openToRun) : null)));
      }
      const timer = setInterval(() => { if (!document.hidden) load(); }, 15000);        // a film that is waiting or being made moves on without a reload
      onStop(() => clearInterval(timer));
      await load();
      return [h('a', { href: '#/', class: 'back' }, '← All projects'), h('h1', { tabindex: '-1' }, 'My films'),
        h('p', { class: 'form-intro' }, 'Every film you are making, and where it stands. Films that need you come first.'), error, list];
    }
    return { filmsView };
  }
  window.ryagramFilms = { WORDS, rowFor, rowsFor, sorted, create, computerState, agoWords, SEEN_MS };
})();
