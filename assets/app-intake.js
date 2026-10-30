// The website intake (#/new): ONE basic question first, then only the questions that fit (NEXT-WEB 173; Ryan: "basic question first, then read the room"). Behind `intake` (off).
//   1. What do you want to make?  A data film / A compilation of your own footage / Something else (coming soon)
//   2. (data film)  What is it about?  Places on a map (county or state) / The whole globe (coming soon) / Places ranked over time (a bar race) / Change over time (lines)
// It never asks for anything the builder already asks; its job is to land a person on the RIGHT first screen: the guided builder with the film type chosen and, for a county map, the dataset list already
// narrowed to counties (#/build?type=map&q=county), a compilation on the way that exists today (the AI door, the computer the app runs on), and a coming-soon idea on its own page.
// Everything is fixed words: nothing from a person or a server is put into a link except choices from this file's own closed lists. Text nodes only, never HTML.
(() => {
  const Q1 = [
    { id: 'data', label: 'A data film', blurb: 'A question answered with public data, drawn as a short animated film, with every source shown.' },
    { id: 'compilation', label: 'A compilation of my own footage', blurb: 'Say a phrase, and Ryagram strings together every time it is said in your own videos.' },
    { id: 'soon', label: 'Something else', blurb: 'Maps you can question, games, cartoons. Not built yet: see what is coming.' }
  ];
  const Q2 = [
    { id: 'map', label: 'Places on a map', blurb: 'Counties or states, shaded by a number, year by year.' },
    { id: 'bars', label: 'Places ranked over time', blurb: 'A bar race: the top places as bars that move as the years pass.' },
    { id: 'line', label: 'How something changed', blurb: 'Lines over time for the top places.' },
    { id: 'globe', label: 'The whole globe', blurb: 'Countries and the world. Not built yet.', soon: 'geo_intelligence' }
  ];
  const TYPES = ['map', 'bars', 'line', 'paired'];
  const SOON_IDS = ['geo_intelligence', 'games', 'animation_studio'];

  // ---------------------------------------------------------------- pure helpers (tested in node)
  // The answers so far -> what to show next. Never a question whose answer would change nothing: a compilation or a coming-soon idea has no second question.
  function next(a) {
    a = a || {};
    if (!Q1.some(q => q.id === a.kind)) return { screen: 'kind' };
    if (a.kind === 'compilation') return { screen: 'compilation' };
    if (a.kind === 'soon') return { screen: 'soon', ids: SOON_IDS.slice() };
    if (!Q2.some(q => q.id === a.about)) return { screen: 'about' };
    const q = Q2.find(x => x.id === a.about);
    if (q.soon) return { screen: 'soon', ids: [q.soon], why: q.label };
    return { screen: 'build', href: buildHref(a.about) };
  }
  // The guided builder's address for a film type. A county map asks the builder to show county datasets first (a search word, from this file's list only).
  function buildHref(type) {
    if (!TYPES.includes(type)) return '#/build';
    return type === 'map' ? '#/build?type=map&q=county' : `#/build?type=${type}`;
  }
  // The builder's side of that address: only a known type and a short plain search word get through; anything else is ignored.
  function parseBuildQuery(hash) {
    const m = /^#\/build(?:\?(.*))?$/.exec(String(hash || ''));
    if (!m) return null;
    const out = {};
    for (const part of String(m[1] || '').split('&')) {
      const [k, v = ''] = part.split('=');
      if (k === 'type' && TYPES.includes(v)) out.type = v;
      else if (k === 'q' && /^[a-zA-Z ]{1,30}$/.test(decodeURIComponent(v.replace(/\+/g, ' ')))) out.q = decodeURIComponent(v.replace(/\+/g, ' '));
    }
    return out;
  }

  function create({ h }) {
    const D = () => window.ryagramDepartments;
    const soonLine = id => { const k = D() && D().KNOWN && D().KNOWN[id]; return k ? { label: k.label, line: k.line || k.sentence || '' } : { label: id, line: '' }; };
    const soonLink = id => (D() && D().flagOn && D().flagOn() ? `#/d/${id}` : null);

    function intakeView(onStop) {
      const a = {};
      const root = h('div', { class: 'intake' });
      const choice = (q, pick, mark) => h('button', { type: 'button', class: 'builder-card intake-choice', 'data-choice': q.id, onclick: () => pick(q.id) },
        h('strong', {}, q.label), h('span', { class: 'meta' }, q.blurb), mark ? h('span', { class: 'meta intake-soon' }, mark) : null);
      function draw() {
        const n = next(a);
        const back = n.screen === 'kind' ? null : h('button', { type: 'button', class: 'button secondary', onclick: () => { if (a.about) delete a.about; else delete a.kind; draw(); } }, 'Back');
        let body;
        if (n.screen === 'kind') {
          body = [h('h2', { tabindex: '-1' }, 'What do you want to make?'), h('div', { class: 'builder-list', role: 'group', 'aria-label': 'What to make' }, Q1.map(q => choice(q, id => { a.kind = id; draw(); })))];
        } else if (n.screen === 'about') {
          body = [h('h2', { tabindex: '-1' }, 'What is your film about?'), h('div', { class: 'builder-list', role: 'group', 'aria-label': 'What it is about' }, Q2.map(q => choice(q, id => { a.about = id; draw(); }, q.soon ? 'Coming soon' : null)))];
        } else if (n.screen === 'build') {
          body = [h('h2', { tabindex: '-1' }, 'Good: the step-by-step builder'), h('p', {}, 'It shows every dataset with its source and licence, and the first picture is free. You can change anything on the way.'),
            h('a', { class: 'button primary', href: n.href }, 'Open the builder'), ' ', h('a', { class: 'button secondary', href: '#/start' }, 'Or start it in your AI')];
        } else if (n.screen === 'compilation') {
          body = [h('h2', { tabindex: '-1' }, 'A compilation is made on your own computer'), h('p', {}, 'Your videos stay on your computer. Ryagram’s app finds the words in your footage and builds the film there. Start it from your AI, or sign your computer in.'),
            h('a', { class: 'button primary', href: '#/start' }, 'Start it in your AI'), ' ', h('a', { class: 'button secondary', href: '#/account' }, 'Your account and computers')];
        } else {
          body = [h('h2', { tabindex: '-1' }, n.why ? `${n.why}: not built yet` : 'Coming soon'), h('p', {}, 'None of this exists yet. Nothing is sent when you look.'),
            h('ul', { class: 'intake-soon-list' }, n.ids.map(id => { const k = soonLine(id), l = soonLink(id); return h('li', {}, h('strong', {}, k.label), ' ', k.line, l ? [' ', h('a', { href: l }, 'Read more')] : null); }))];
        }
        root.replaceChildren(h('a', { href: '#/', class: 'back' }, '← All projects'), h('h1', {}, 'Make a film'), ...body, ...(back ? [h('div', { class: 'actions-row builder-nav' }, back)] : []));
        const f = root.querySelector('h2'); if (f && f.focus) f.focus();
      }
      draw();
      return [root];
    }
    return { intakeView };
  }
  window.ryagramIntake = { Q1, Q2, TYPES, next, buildHref, parseBuildQuery, create };
})();
