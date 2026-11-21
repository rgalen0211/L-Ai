// Ryagram design system: behaviour (WEB, 2026-11-20). No dependencies. Pairs with assets/ryagram-ds.css; both only act under body.ryagram-ds.
//
// CONTRACT for pages (PAGES-FLIP, EDITOR-PORT and every later page use ONLY this):
//   window.ryagramDs.mount(root)  call it after a view has been drawn into `root` (a container element). It initialises every [data-flip] carousel, and every
//                                 [data-parallax] layer inside `root`, and DISPOSES whatever the previous mount() set up (so a view that is replaced leaves no listener behind).
//   window.ryagramDs.init(root)   the same without disposing the previous mount; returns a dispose() function (for a view that owns its own lifetime).
//   window.ryagramDs.unmount()    dispose the current mount (sign-out).
// Markup of a flip carousel (sections you flip through; the hash form is #section=<panel id>):
//   <div class="flip" data-flip data-flip-label="Sections">
//     <div class="flip-bar"><button class="flip-arrow" data-flip-prev aria-label="Previous section">‹</button>
//       <div class="flip-tabs" role="tablist"><button class="flip-tab" role="tab" aria-controls="p1"><span class="n">1</span> Make it</button> ...</div>
//       <button class="flip-arrow" data-flip-next aria-label="Next section">›</button></div>
//     <div class="flip-viewport"><div class="flip-track"><section class="flip-panel" id="p1" role="tabpanel">...</section> ...</div></div>
//     <div class="flip-dots"><button class="flip-dot" aria-label="Section 1"></button> ...</div><p class="flip-hint"></p>
//   </div>      (a long list inside a panel goes in <div class="scroll-panel">; the page itself never grows with a list)
// The account menu in the header is wired here too (button [data-account-btn], panel [data-account-menu]).
(() => {
  const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- flip carousel
  function initFlip(flip, off) {
    const tabs = [...flip.querySelectorAll('.flip-tab')], panels = [...flip.querySelectorAll('.flip-panel')], track = flip.querySelector('.flip-track');
    const dots = [...flip.querySelectorAll('.flip-dot')], prev = flip.querySelector('[data-flip-prev]'), next = flip.querySelector('[data-flip-next]'), hint = flip.querySelector('.flip-hint');
    if (!track || !panels.length) return;
    if (flip.dataset.flipBound === 'true') return;                     // assets/app-flip.js built and drives this one (address kept as ?section=); never bind it twice
    let i = 0;
    const idOf = p => (p.id || '');
    const go = (n, focusTab) => {
      i = Math.max(0, Math.min(panels.length - 1, n));
      track.style.transform = `translateX(${-i * 100}%)`;
      tabs.forEach((t, k) => { t.setAttribute('aria-selected', String(k === i)); t.tabIndex = k === i ? 0 : -1; });
      dots.forEach((d, k) => { if (k === i) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
      panels.forEach((p, k) => { p.setAttribute('aria-hidden', String(k !== i)); p.inert = k !== i; });
      if (prev) prev.disabled = i === 0;
      if (next) next.disabled = i === panels.length - 1;
      if (hint) hint.textContent = `${i + 1} of ${panels.length}. Left and right arrows move between sections.`;
      const sel = tabs[i], bar = sel && sel.parentElement;
      if (bar && bar.scrollWidth > bar.clientWidth) { const a = sel.getBoundingClientRect(), b = bar.getBoundingClientRect(); bar.scrollLeft += (a.left + a.width / 2) - (b.left + b.width / 2); }
      if (focusTab && sel) sel.focus();
    };
    // the app's own router uses the hash (#/p/<id>): the section is kept in a second fragment-less place, so never overwrite a route; a standalone page uses #section=<id>
    const remember = () => { const m = /^#section=/.test(location.hash) || !location.hash; if (m && idOf(panels[i])) { try { history.replaceState(null, '', `#section=${idOf(panels[i])}`); } catch { /* ignore */ } } };
    const onTab = k => () => { go(k); remember(); };
    const listeners = [];
    const on = (el, ev, fn, opt) => { if (!el) return; el.addEventListener(ev, fn, opt); listeners.push(() => el.removeEventListener(ev, fn, opt)); };
    tabs.forEach((t, k) => { on(t, 'click', onTab(k)); on(t, 'keydown', e => { if (e.key === 'Home') { go(0, true); remember(); e.preventDefault(); } if (e.key === 'End') { go(panels.length - 1, true); remember(); e.preventDefault(); } }); });
    dots.forEach((d, k) => on(d, 'click', onTab(k)));
    on(prev, 'click', () => { go(i - 1); remember(); });
    on(next, 'click', () => { go(i + 1); remember(); });
    const key = e => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable],[role=slider]')) return;
      if (!flip.isConnected || flip.closest('[hidden]')) return;
      if (e.key === 'ArrowRight') { go(i + 1); remember(); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { go(i - 1); remember(); e.preventDefault(); }
    };
    on(document, 'keydown', key);
    let x0 = null, y0 = null; const vp = flip.querySelector('.flip-viewport');
    on(vp, 'touchstart', e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    on(vp, 'touchend', e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) { go(i + (dx < 0 ? 1 : -1)); remember(); } x0 = null; }, { passive: true });
    const m = /^#section=(.+)$/.exec(location.hash || ''); const start = m ? panels.findIndex(p => p.id === m[1]) : -1;
    go(start >= 0 ? start : 0);
    off.push(() => listeners.forEach(f => f()));
    flip.ryagramFlip = { go: n => go(n), index: () => i };
  }

  // ---- parallax: one transform per layer per frame; off under reduced motion
  function initParallax(root, off) {
    const layers = [...root.querySelectorAll('[data-parallax]')];
    if (!layers.length || reduce()) return;
    let queued = false;
    const tick = () => { queued = false; const y = window.scrollY; for (const l of layers) l.style.transform = `translate3d(0,${(y * Number(l.dataset.parallax)).toFixed(1)}px,0)`; };
    const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(tick); } };
    window.addEventListener('scroll', onScroll, { passive: true }); tick();
    off.push(() => { window.removeEventListener('scroll', onScroll); for (const l of layers) l.style.transform = ''; });
  }

  // ---- the card light follows the pointer (a custom property only; no layout)
  let sheenOn = false;
  function initSheen() {
    if (sheenOn || reduce()) return; sheenOn = true;
    document.addEventListener('pointermove', e => { const c = e.target.closest && e.target.closest('body.ryagram-ds .card, body.ryagram-ds .film-card, body.ryagram-ds .dept-card'); if (c) { const r = c.getBoundingClientRect(); c.style.setProperty('--mx', `${((e.clientX - r.left) / r.width * 100).toFixed(0)}%`); } }, { passive: true });
  }

  // ---- the account menu in the header (static markup, wired once)
  let headerDone = false;
  function initHeader() {
    if (headerDone) return; const btn = document.querySelector('[data-account-btn]'), menu = document.querySelector('[data-account-menu]'); if (!btn || !menu) return; headerDone = true;
    const close = (focusBtn) => { if (menu.hidden) return; menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); if (focusBtn) btn.focus(); };
    const open = () => { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); const first = menu.querySelector('a,button'); if (first) first.focus(); };
    btn.addEventListener('click', () => { if (menu.hidden) open(); else close(false); });
    document.addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target) && e.target !== btn && !btn.contains(e.target)) close(false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(true); });
    window.addEventListener('hashchange', () => close(false));
    menu.addEventListener('click', e => { if (e.target.closest('a')) close(false); });
    menu.addEventListener('keydown', e => {
      const items = [...menu.querySelectorAll('a:not([hidden]),button:not([hidden])')], k = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { items[(k + 1) % items.length].focus(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { items[(k - 1 + items.length) % items.length].focus(); e.preventDefault(); }
    });
  }

  let current = [];
  function dispose() { for (const f of current.splice(0)) { try { f(); } catch { /* a listener already gone */ } } }
  function init(root) {
    const off = [];
    if (!root) return () => {};
    for (const f of root.querySelectorAll('[data-flip]')) initFlip(f, off);
    initParallax(root, off);
    return () => { for (const f of off.splice(0)) { try { f(); } catch { /* ignore */ } } };
  }
  function mount(root) { dispose(); const d = init(root); current.push(d); return d; }
  function boot() { initHeader(); initSheen(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.ryagramDs = Object.freeze({ init, mount, unmount: dispose, initHeader });
})();
