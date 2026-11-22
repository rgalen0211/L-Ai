// Flip sections for long pages (WEB, 2026-11-20, Ryan 11:55: no long vertical scrolls). One section is in view at a time; a tab row with dots, arrows, the keyboard and a swipe move between them; the position is
// remembered in the address as ?section=<id> (the address is the route here, so it is kept with history.replaceState and read back on load). The page's main action and key facts stay above the fold.
//   window.ryagramFlip.create({ h, sections: [{ id, label, el, hidden? }], initial, onChange }) -> { el, go(id), current() }
// Markup contract (shared with the design system): .flip[data-flip] > .flip-bar (.flip-arrow[data-flip-prev], .flip-tabs > button.flip-tab[role=tab], .flip-arrow[data-flip-next]) + .flip-viewport > .flip-track > .flip-panel[role=tabpanel][id]*
// + .flip-dots > .flip-dot. If the design system's own behaviour (window.ryagramDs) is loaded it is NOT duplicated: this file binds only elements it built itself and marks them data-flip-bound.
// Everything a person typed is put in as text; a section's element is whatever the page built.
(() => {
  const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function sectionFromAddress(ids) {
    const m = /[?&]section=([a-z0-9_-]+)/i.exec(String(location.hash || ''));
    return m && ids.includes(m[1]) ? m[1] : null;
  }

  function create({ h, sections, initial = null, onChange = () => {}, label = 'Sections', address = true }) {
    const list = sections.filter(s => s && s.el && !s.hidden);
    const ids = list.map(s => s.id);
    let at = Math.max(0, ids.indexOf((address ? sectionFromAddress(ids) : null) || initial || ids[0]));
    const uid = Math.random().toString(36).slice(2, 7);
    const tabEls = list.map((s, i) => h('button', { type: 'button', class: 'flip-tab', role: 'tab', id: `flip-tab-${uid}-${s.id}`, 'aria-controls': `section-${s.id}`, 'aria-selected': 'false', tabindex: '0' },
      h('span', { class: 'n', 'aria-hidden': 'true' }, String(i + 1)), s.label));
    const prev = h('button', { type: 'button', class: 'flip-arrow', 'data-flip-prev': '', 'aria-label': 'Previous section' }, '‹');
    const next = h('button', { type: 'button', class: 'flip-arrow', 'data-flip-next': '', 'aria-label': 'Next section' }, '›');
    const where = h('p', { class: 'flip-where meta', role: 'status', 'aria-live': 'polite' });
    const panels = list.map(s => h('div', { class: 'flip-panel', role: 'tabpanel', id: `section-${s.id}`, 'aria-labelledby': `flip-tab-${uid}-${s.id}`, 'data-flip-section': s.id }, s.el));
    const track = h('div', { class: 'flip-track' }, panels);
    const dots = list.map((s, i) => h('span', { class: 'flip-dot', 'aria-hidden': 'true' }));
    const viewport = h('div', { class: 'flip-viewport' }, track);
    // The viewport is overflow:hidden, but the browser still scrolls it sideways when something inside asks to be seen (scrollIntoView on a section, focus on a field): the track is then shown at the wrong place
    // and a stranger lands on the Help panel instead of Connected AIs (WEB walk 11-22, /app/#/account?connect=claude at 390 wide). Only the track's own transform may move panels: put any scroll back at once.
    viewport.addEventListener('scroll', () => { if (viewport.scrollLeft !== 0) viewport.scrollLeft = 0; });
    const root = h('section', { class: 'flip', 'data-flip': '', 'aria-label': label },
      h('div', { class: 'flip-bar' }, prev, h('div', { class: 'flip-tabs', role: 'tablist', 'aria-label': label }, tabEls), next),
      viewport, h('div', { class: 'flip-dots' }, dots), where);

    // Put the chosen tab in the middle of the tab row. Measured only once the row is on the page (a row that opens on a later tab, e.g. ?connect=claude, was left showing tabs 1 to 3).
    function centre() {
      const tab = tabEls[at], row = tab.parentElement;
      if (row && row.getBoundingClientRect) { const r = tab.getBoundingClientRect(), p = row.getBoundingClientRect(); row.scrollLeft += (r.left + r.width / 2) - (p.left + p.width / 2); }
    }

    function go(n, { user = true } = {}) {
      const to = typeof n === 'string' ? ids.indexOf(n) : n;
      if (to < 0 || to >= list.length) return;
      at = to;
      track.style.transform = `translateX(${-at * 100}%)`;
      track.style.transition = reduce() ? 'none' : '';
      tabEls.forEach((t, k) => { t.setAttribute('aria-selected', String(k === at)); t.tabIndex = 0; });
      dots.forEach((d, k) => { if (k === at) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
      panels.forEach((p, k) => { p.setAttribute('aria-hidden', String(k !== at)); p.inert = k !== at; });
      prev.disabled = at === 0; next.disabled = at === list.length - 1;
      where.textContent = `${list[at].label}: ${at + 1} of ${list.length}`;
      centre();
      if (user && address) {
        try { const base = String(location.hash).replace(/[?&]section=[a-z0-9_-]*/i, ''); history.replaceState(null, '', `${base}${base.includes('?') ? '&' : '?'}section=${ids[at]}`); } catch { /* the address stays as it is */ }
      }
      onChange(ids[at], at);
    }

    tabEls.forEach((t, k) => t.addEventListener('click', () => go(k)));
    prev.addEventListener('click', () => go(at - 1)); next.addEventListener('click', () => go(at + 1));
    root.querySelector('.flip-tabs').addEventListener('keydown', e => {
      if (e.key === 'Home') { go(0); tabEls[0].focus(); e.preventDefault(); }
      else if (e.key === 'End') { go(list.length - 1); tabEls[list.length - 1].focus(); e.preventDefault(); }
    });
    const typing = t => t && t.closest && t.closest('input,textarea,select,[contenteditable],[role=slider]');
    const onKey = e => {
      if (!root.isConnected || e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return;
      if (e.key === 'ArrowRight') { go(at + 1); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { go(at - 1); e.preventDefault(); }
    };
    document.addEventListener('keydown', onKey);
    let x0 = null, y0 = null;
    viewport.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    viewport.addEventListener('touchend', e => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; x0 = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(at + (dx < 0 ? 1 : -1));       // a vertical scroll is not a flip
    }, { passive: true });
    root.dataset.flipBound = 'true';
    go(at, { user: false });
    if (typeof setTimeout === 'function') for (const ms of [0, 120, 500]) setTimeout(() => { if (root.isConnected) centre(); }, ms);       // once the page has put the row on screen
    return { el: root, go, current: () => ids[at], destroy: () => document.removeEventListener('keydown', onKey) };
  }

  window.ryagramFlip = Object.freeze({ create, sectionFromAddress });
})();
