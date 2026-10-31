// Departments in the site's top bar (NEXT-WEB 147; design proposals/WEB-DEPARTMENTS.md; Ryan 2026-10-26 17:52: not-built departments are shown, marked "Coming soon", as marketing).
// Behind `departments` (off; needs connectAi and aiFirst). The server owns WHICH departments exist and whether each WORKS for this account (my_departments(): rows {id, label, status: 'working' | 'soon'});
// this page owns the WORDS and the picture for each id it knows, and ignores an id it does not know. A failing my_departments() shows nothing new: today's header stays exactly as it is.
// A "Coming soon" page has one plain line, an optional picture, and "Tell me when it's ready", which stores the person's interest (account, department, time: nothing else) and sends NOTHING:
// there is no email or message path in this file. Everything from the server goes in as text nodes, never as HTML.
(() => {
  // The public wording below is APPROVED as drafted (Ryan 2026-10-28 10:59, Q303 / Q244): the draft note that used to sit on every Coming soon page is gone.
  const KNOWN = {
    data_films: { label: 'Data films', page: true, sentence: 'Questions answered with public data, drawn as a short animated film, with every source shown.' },
    compilations: { label: 'Compilations', line: 'Say a phrase. Ryagram finds every time it is said in your own footage and strings the moments together. Soon it will turn your clips into songs, too.', picture: 'phrase' },
    geo_intelligence: { label: 'Geographic Intelligence', line: 'Ask a map a question: where would a new shop do well, how well is a city laid out, how do places connect. Every number is labelled observed, calculated, estimated or simulated, so you always know what is a fact and what is a guess.' },
    games: { label: 'Games', line: 'Play with your own data and footage in small games you can share.', placeholder: true },
    animation_studio: { label: 'Animation Studio', line: 'Simple cartoons you direct: characters you can pose, with mouths that move to your voice.' }
  };
  const ORDER = ['data_films', 'compilations', 'geo_intelligence', 'games', 'animation_studio'];
  const WORDS = {
    soonGroup: 'Coming soon', soonMark: 'soon', tag: 'Coming soon', button: 'Tell me when it’s ready', noted: 'Noted. We’ll let you know here when it is ready.', takeBack: 'Take it back',
    saveError: 'Couldn’t save that just now. Try again in a minute.', fewLines: 'Start one in your AI', yourFilms: 'Your data films', noAi: 'No AI? Build it step by step',
    unavailable: 'This page isn’t available on this account'
  };

  // ---------------------------------------------------------------- pure helpers (tested in node)
  const known = id => Object.prototype.hasOwnProperty.call(KNOWN, id);
  // The server's rows become what the bar shows: only ids this page knows, only the two statuses, each once. A 'working' id the page has no page for is NOT shown (never a dead link); a 'soon' id
  // the page has no words for is NOT shown (never an empty page). The order is the page's own.
  function normalize(rows) {
    if (!Array.isArray(rows)) return null;
    const seen = new Set(), working = [], soon = [];
    for (const r of rows) {
      const id = r && typeof r.id === 'string' ? r.id : '';
      if (!known(id) || seen.has(id)) continue;
      seen.add(id);
      if (r.status === 'working' && KNOWN[id].page === true) working.push(id);
      else if (r.status === 'soon' && typeof KNOWN[id].line === 'string') soon.push(id);
    }
    const by = list => ORDER.filter(id => list.includes(id));
    return { working: by(working), soon: by(soon) };
  }
  const hasAny = m => !!m && (m.working.length > 0 || m.soon.length > 0);
  const pathOf = id => `#/d/${id}`;
  const idFromHash = hash => { const m = /^#\/d\/([a-z_]+)$/.exec(hash || ''); return m && known(m[1]) ? m[1] : null; };
  const flagOn = () => window.ryagramConfig?.departments === true && window.ryagramConfig?.aiFirst === true && window.ryagramConfig?.connectAi === true;

  // ---------------------------------------------------------------- the bar and the pages
  function create({ h, data, startUi }) {
    let model = null, cleanup = () => {};

    async function load() {
      try { model = normalize(await data.myDepartments()); } catch { model = null; }
      return model;
    }

    // The bar: Start, the departments that work, ONE "Coming soon" group, My films, Credits. On a phone the list sits behind one Menu button.
    function barElement(m) {
      const link = (href, text, extra = {}) => h('a', { href, ...extra }, text);
      const items = [h('li', {}, link('#/start', 'Start'))];
      for (const id of m.working) items.push(h('li', {}, link(pathOf(id), KNOWN[id].label)));
      if (m.soon.length) {
        items.push(h('li', { class: 'dept-soon' }, h('details', { class: 'soon-group' }, h('summary', {}, WORDS.soonGroup),
          h('ul', {}, m.soon.map(id => h('li', {}, link(pathOf(id), KNOWN[id].label), h('span', { class: 'soon-tag' }, WORDS.soonMark)))))));
      }
      items.push(h('li', {}, link(window.ryagramConfig && window.ryagramConfig.myFilms === true ? '#/films' : '#/', 'My films')));
      if (window.ryagramConfig?.credits === true) items.push(h('li', {}, link('#/credits', 'Credits')));
      items.push(h('li', { class: 'dept-extra' }, link('/help/', 'Help')), h('li', { class: 'dept-extra' }, link('#/account', 'Account')));      // on a phone the header's own Help and Account links move into the Menu
      const toggle = h('button', { class: 'button secondary dept-menu', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'dept-list' }, 'Menu');
      const nav = h('nav', { class: 'dept-bar', 'aria-label': 'Departments' }, toggle, h('ul', { id: 'dept-list', class: 'dept-list' }, items));
      toggle.addEventListener('click', () => { const open = nav.classList.toggle('open'); toggle.setAttribute('aria-expanded', open ? 'true' : 'false'); });
      const soonDetails = nav.querySelector('details.soon-group');
      const phoneQuery = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 700px)') : null;
      const onPhone = () => !!phoneQuery && phoneQuery.matches;
      const syncSoon = () => { if (soonDetails) { if (onPhone()) soonDetails.setAttribute('open', ''); else soonDetails.removeAttribute('open'); } };      // on a phone the Coming soon items sit open under their heading in the Menu; on a desktop the list opens on a click
      if (phoneQuery && phoneQuery.addEventListener) phoneQuery.addEventListener('change', syncSoon);
      syncSoon();
      const closeSoon = () => { if (soonDetails && !onPhone()) soonDetails.removeAttribute('open'); };      // the Coming soon list never stays open over the page (a desktop list)
      nav.addEventListener('click', ev => { if (ev.target && ev.target.closest && ev.target.closest('a')) { nav.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); closeSoon(); } });
      nav.closeSoon = closeSoon;
      nav.closeMenu = () => { nav.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); };      // a page change closes the phone Menu
      return nav;
    }
    function markCurrent(nav) {
      const here = location.hash || '#/';
      for (const a of nav.querySelectorAll('a')) { if (a.getAttribute('href') === here || (here === '' && a.getAttribute('href') === '#/')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }
    }
    // Fills the header's slot. With the flag's conditions not met, or my_departments() failing, or nothing to show, the slot stays hidden and the header is exactly as it was.
    async function mountBar(slot) {
      cleanup();
      cleanup = () => { document.body.classList.remove('has-departments'); if (slot) { slot.replaceChildren(); slot.hidden = true; } };
      if (!slot || !flagOn()) return false;
      try { if ((await data.connectAccess()) !== true) return false; } catch { return false; }
      const m = await load();
      if (!hasAny(m)) return false;
      const nav = barElement(m);
      slot.replaceChildren(nav);
      slot.hidden = false;
      document.body.classList.add('has-departments');                          // the header's own Help and Account links give way to the bar on a phone
      markCurrent(nav);
      const onHash = () => { markCurrent(nav); nav.closeSoon(); nav.closeMenu(); };
      const onOutside = ev => { if (!nav.contains(ev.target)) nav.closeSoon(); };                // a click anywhere else closes the Coming soon list
      window.addEventListener('hashchange', onHash);
      document.addEventListener('click', onOutside);
      cleanup = () => { window.removeEventListener('hashchange', onHash); document.removeEventListener('click', onOutside); document.body.classList.remove('has-departments'); slot.replaceChildren(); slot.hidden = true; };
      return true;
    }
    const unmountBar = () => cleanup();

    const homeLink = () => h('a', { class: 'button primary', id: 'department-home', href: '#/' }, 'Back to your projects');
    const unavailable = () => [h('h1', { tabindex: '-1' }, WORDS.unavailable), h('p', { class: 'form-intro', role: 'status' }, 'It may belong to a different account, or it may have been removed.'), homeLink()];

    // A department that works: heading and sentence, the AI strip, your films, and the no-AI way.
    async function workingPage(id) {
      const strip = startUi ? await startUi().strip() : null;
      let projects = [];
      try { projects = await data.listProjects(); } catch { projects = []; }
      const list = projects.length
        ? h('ul', { class: 'project-list' }, projects.map(p => h('li', {}, h('a', { href: `#/p/${p.id}` }, p.title), h('span', { class: 'meta' }, p.latest ? ` Version ${p.latest.number}` : ''))))
        : h('p', { class: 'form-intro' }, 'No data films yet. Start one in your AI, or build one step by step.');
      return [h('h1', { tabindex: '-1' }, KNOWN[id].label), h('p', { class: 'form-intro' }, KNOWN[id].sentence),
              h('h2', {}, WORDS.fewLines), strip || h('p', { class: 'meta' }, h('a', { href: '#/start' }, 'Connect your AI to start films by talking')),
              h('h2', {}, WORDS.yourFilms), list, h('p', { class: 'meta' }, h('a', { href: '#/build' }, WORDS.noAi))];
    }

    // The small picture a Coming soon page may carry: text only, drawn here, never an image from the server.
    function phrasePicture() {
      return h('div', { class: 'soon-picture', role: 'img', 'aria-label': 'An illustration of a phrase found in a person’s own videos' },
        h('p', { class: 'meta' }, 'PHRASE “of the people, by the people”'),
        h('p', {}, '0:41  of the people, by the people, for the people'), h('p', {}, '3:17  a government of the people, by the people'),
        h('p', { class: 'meta' }, 'An illustration with public-domain words (Lincoln, 1863) and made-up timestamps, not a screenshot.'));
    }

    // A Coming soon page: tag, heading, one line, an optional picture, and the button that records interest (and sends nothing).
    async function soonPage(id) {
      const k = KNOWN[id];
      let noted = false;
      try { noted = (await data.myDepartmentInterests()).includes(id); } catch { noted = false; }
      const area = h('div', { class: 'soon-action' });
      const msg = h('p', { class: 'form-note', role: 'status', 'aria-live': 'polite' });
      const draw = () => {
        if (noted) {
          const back = h('button', { class: 'link-button', type: 'button', id: 'soon-takeback', onclick: async () => {
            try { await data.withdrawDepartmentInterest(id); noted = false; msg.textContent = ''; draw(); } catch { msg.textContent = WORDS.saveError; }
          } }, WORDS.takeBack);
          area.replaceChildren(h('p', { id: 'soon-noted', role: 'status' }, WORDS.noted, ' ', back));
        } else {
          area.replaceChildren(h('button', { class: 'button primary', type: 'button', id: 'soon-notify', onclick: async () => {
            try { await data.registerDepartmentInterest(id); noted = true; msg.textContent = ''; draw(); } catch { msg.textContent = WORDS.saveError; }
          } }, WORDS.button));
        }
      };
      draw();
      return [h('span', { class: 'soon-tag soon-tag-big' }, WORDS.tag), h('h1', { tabindex: '-1' }, k.label), h('p', { class: 'form-intro' }, k.line),
              k.picture === 'phrase' ? phrasePicture() : null, area, msg];
    }

    // #/d/<id>. An id this account's list does not include, or any failure, is the plain "not available" page with a way home: never a blank page.
    async function pageView(id) {
      const m = model || await load();
      if (!m || !known(id)) return unavailable();
      if (m.working.includes(id)) return workingPage(id);
      if (m.soon.includes(id)) return soonPage(id);
      return unavailable();
    }

    return { mountBar, unmountBar, pageView, load };
  }

  window.ryagramDepartments = { KNOWN, ORDER, WORDS, normalize, hasAny, pathOf, idFromHash, flagOn, create };
})();
