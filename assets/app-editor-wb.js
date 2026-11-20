// The editor as a WORKBENCH (WEB, 2026-11-20, Ryan: 'the editor mockup is leagues ahead, build it for real'; mockup proposals/WEB-DESIGN-1120/mock-editor-2.html): the page fits ONE screen and never scrolls:
// media and tracks on the left, the picture + scrub bar + toolbar in the middle, Look | History on the right, the timeline along the bottom; panels collapse and resize and the timeline scrolls inside itself.
// This file only REARRANGES the editor's own parts (assets/app-editor.js builds them, assets/app-editor-film.js draws the film): every control keeps its real handler and its real state. It adds NO change (op),
// no choice the draft cannot carry and no picture of its own: the pictures here are the film's own frames (the picture, the strip tiles, the media list), nothing else. Used only for a person's own film on the website
// (the real-frames path); every other editor (the chat panel, the maker's page, the design demo, compilations) keeps its page.
(() => {
  const KEY = 'ryagram.editor.panels.device';
  const store = {
    get() { try { return JSON.parse(window.localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } },
    set(v) { try { window.localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* blocked storage: the layout lasts until the page closes */ } }
  };
  const LIMITS = { left: [160, 480], right: [200, 520], bottom: [120, 0.6] };

  function mount(c) {
    const { h, root, filmEd, onStop } = c;
    const P = filmEd.parts;
    const saved = store.get();
    const body = document.body;
    body.classList.add('wb-page'); onStop(() => body.classList.remove('wb-page'));
    root.classList.add('le-wb');

    // ---- the top row: the way back, this film's name, saved or not, and every action (the same buttons, the same handlers)
    const back = root.querySelector(':scope > p > a[href="#/"]');
    const top = c.top;                                                                       // .le-top: title, pill, undo, revert, ask, save, final, and PRO's Simple | Pro switch
    const eyebrow = h('span', { class: 'wb-eyebrow' }, 'Edit your film');
    const tools = h('div', { class: 'wb-tools' });
    for (const el of [...top.children]) { if (el !== c.title && el !== c.pill) tools.append(el); }
    const head = h('div', { class: 'wb-top' }, back ? h('div', { class: 'wb-crumb' }, back) : null, h('div', { class: 'wb-name' }, eyebrow, c.title, c.pill), tools);

    // ---- panels
    const collapseBtn = (k, label) => h('button', { type: 'button', class: 'wb-collapse', 'data-collapse': k, 'aria-expanded': 'true', 'aria-label': `Collapse the ${label} panel`, title: `Collapse or open the ${label} panel` }, '‹');
    const panel = (k, name, headExtra, ...kids) => {
      const hd = h('div', { class: 'wb-ph' }, h('h2', {}, name), headExtra || null, collapseBtn(k, name.toLowerCase()));
      return h('section', { class: `wb-panel ${k}`, 'aria-label': name }, hd, ...kids);
    };

    // left: the film's own frames (made for the strip, so no extra work) and its layers, read from the plan
    const mediaGrid = h('div', { class: 'wb-media', role: 'list', 'aria-label': 'Frames of the film' });
    const layers = h('ul', { class: 'wb-layers le-pro-only' });
    const paintMedia = () => {
      const items = filmEd.media.items();
      mediaGrid.replaceChildren(...(items.length ? items.map(m => { const b = h('button', { type: 'button', class: 'wb-frame', role: 'listitem', 'aria-label': `Go to ${m.label}`, onclick: () => filmEd.media.seek(m.at) }, h('img', { src: m.uri, alt: '', draggable: 'false' }), h('span', {}, m.label)); return b; })
        : [h('p', { class: 'meta' }, 'The film’s frames appear here as they are drawn.')]));
    };
    filmEd.media.onChange(paintMedia); paintMedia();
    filmEd.ready.then(() => { const pl = filmEd.state().plan; if (pl) layers.replaceChildren(...pl.clips.map(cl => h('li', {}, h('span', { class: `wb-dot wb-dot-${cl.drawn ? 'film' : 'title'}`, 'aria-hidden': 'true' }), `${cl.label || cl.kind}`, h('span', { class: 'meta' }, ` ${cl.seconds.toFixed(1)} s`)))); });
    const left = panel('left', 'Media and tracks', null, h('div', { class: 'body' }, h('h3', { class: 'wb-cap' }, 'Frames of the film'), mediaGrid, h('h3', { class: 'wb-cap le-pro-only' }, 'Layers'), layers));

    // stage: messages, the picture (fits its own shape, no bars), the scrub bar, the key line, and the render dialog on top
    const picture = h('div', { class: 'wb-picture' }, P.view);
    const msgs = h('div', { class: 'wb-msgs' }, c.status, c.emptyNote, c.aiBox, c.banner, c.warns, P.status);
    const stage = h('section', { class: 'wb-panel stage', 'aria-label': 'Preview' }, h('div', { class: 'body' }, msgs, c.standin || null, picture, P.scrub, P.keys), c.renderBox);
    // the film's own parts show only once its plan and first window have really opened; until then (and if it never opens) the editor's plain box says so, in words
    const live = [P.view, P.scrub, P.keys, P.tracks, P.colourBox];
    for (const p of live) p.hidden = true;
    filmEd.ready.then(ok => { for (const p of live) p.hidden = !ok; picture.hidden = !ok; fit(); });

    // right: Look | History
    const lookBody = h('div', { class: 'wb-tabbody', id: 'wb-tab-look' }, c.lookPanel, P.colourBox);
    const proSide = root.querySelector('.le-pro-side');
    const histBody = h('div', { class: 'wb-tabbody', id: 'wb-tab-hist', hidden: true });
    if (proSide) histBody.append(proSide);
    const tabLook = h('button', { type: 'button', class: 'wb-tab on', role: 'tab', 'aria-selected': 'true', 'aria-controls': 'wb-tab-look' }, 'Look');
    const tabHist = h('button', { type: 'button', class: 'wb-tab le-pro-only', role: 'tab', 'aria-selected': 'false', 'aria-controls': 'wb-tab-hist' }, 'History');
    const pick = which => { const look = which === 'look'; tabLook.classList.toggle('on', look); tabHist.classList.toggle('on', !look); tabLook.setAttribute('aria-selected', String(look)); tabHist.setAttribute('aria-selected', String(!look)); lookBody.hidden = !look; histBody.hidden = look; };
    tabLook.addEventListener('click', () => pick('look')); tabHist.addEventListener('click', () => pick('hist'));
    const right = panel('right', 'Properties', h('div', { class: 'wb-tabs', role: 'tablist' }, tabLook, tabHist), h('div', { class: 'body' }, lookBody, histBody));
    right.querySelector(':scope > .wb-ph h2').classList.add('wb-sr');

    // bottom: the timeline (PRO's tool row on top of it), scrolling inside itself
    const proBar = root.querySelector('.le-pro');
    const tl = panel('bottom', 'Timeline', null, h('div', { class: 'body wb-tl' }, proBar || null, P.tracks));
    tl.classList.remove('bottom'); tl.classList.add('timeline');
    const grid = h('div', { class: 'wb', 'data-wb-own': '' }, left, stage, right, tl);                 // the editor binds its own panel handlers (collapse, resize, tabs): the shared script must not bind them twice

    // handles: drag or the arrow keys (Shift = a bigger step); collapse buttons; the choice is kept on this device
    const handle = (k, cls, label) => h('div', { class: `wb-resize ${cls} ${k}`, 'data-resize': k, role: 'separator', tabindex: '0', 'aria-label': label, 'aria-orientation': cls === 'v' ? 'vertical' : 'horizontal' });
    left.append(handle('left', 'v', 'Resize the media panel')); right.append(handle('right', 'v', 'Resize the properties panel')); tl.append(handle('bottom', 'h', 'Resize the timeline'));
    const cur = k => { const v = parseFloat(getComputedStyle(grid).getPropertyValue(`--wb-${k}`)); return Number.isFinite(v) ? v : (k === 'bottom' ? 260 : 280); };
    const clampTo = (k, v) => { const [lo, hi] = LIMITS[k]; const max = k === 'bottom' ? grid.getBoundingClientRect().height * hi : hi; return Math.max(lo, Math.min(max, v)); };
    const setSize = (k, v) => { grid.style.setProperty(`--wb-${k}`, `${Math.round(clampTo(k, v))}px`); saved.sizes = { ...(saved.sizes || {}), [k]: Math.round(clampTo(k, v)) }; store.set(saved); fit(); };
    for (const hd of grid.querySelectorAll('[data-resize]')) {
      const k = hd.dataset.resize;
      hd.addEventListener('pointerdown', e => {
        hd.classList.add('drag'); hd.setPointerCapture(e.pointerId); const rect = grid.getBoundingClientRect();
        const mv = ev => setSize(k, k === 'left' ? ev.clientX - rect.left : k === 'right' ? rect.right - ev.clientX : rect.bottom - ev.clientY);
        const up = () => { hd.classList.remove('drag'); hd.removeEventListener('pointermove', mv); hd.removeEventListener('pointerup', up); };
        hd.addEventListener('pointermove', mv); hd.addEventListener('pointerup', up);
      });
      hd.addEventListener('keydown', e => {
        const step = e.shiftKey ? 48 : 16, sign = k === 'bottom' ? (e.key === 'ArrowUp' ? 1 : e.key === 'ArrowDown' ? -1 : 0) : (k === 'left' ? (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0) : (e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0));
        if (!sign) return; e.preventDefault(); setSize(k, cur(k) + sign * step);
      });
    }
    for (const b of grid.querySelectorAll('[data-collapse]')) {
      const k = b.dataset.collapse === 'bottom' ? 'bottom' : b.dataset.collapse;
      const apply = () => { const on = grid.dataset[k] === 'collapsed'; b.setAttribute('aria-expanded', String(!on)); b.textContent = (k === 'bottom') ? (on ? '⌃' : '⌄') : (k === 'left' ? (on ? '›' : '‹') : (on ? '‹' : '›')); fit(); };
      b.addEventListener('click', () => { grid.dataset[k] = grid.dataset[k] === 'collapsed' ? '' : 'collapsed'; saved.collapsed = { ...(saved.collapsed || {}), [k]: grid.dataset[k] === 'collapsed' }; store.set(saved); apply(); });
      if (saved.collapsed && saved.collapsed[k]) { grid.dataset[k] = 'collapsed'; }
      apply();
    }
    if (saved.sizes) for (const [k, v] of Object.entries(saved.sizes)) if (LIMITS[k]) grid.style.setProperty(`--wb-${k}`, `${Math.round(v)}px`);
    // the timeline's collapse button lives in its own header (the grid area is called timeline)
    tl.querySelector('[data-collapse]').dataset.collapse = 'bottom';

    // ---- the picture fits the stage at ITS shape: the largest box of the film's aspect ratio that fits, centred; the stage's own surface shows around it (never black bars)
    function ratio() { const svg = P.view.querySelector('svg'); if (svg) { const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number); if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) return vb[2] / vb[3]; const w = parseFloat(svg.getAttribute('width')), hh = parseFloat(svg.getAttribute('height')); if (w > 0 && hh > 0) return w / hh; } return 16 / 9; }
    function fit() {
      const ar = ratio(), cw = picture.clientWidth, ch = picture.clientHeight;
      if (!cw || !ch) return;
      const pad = 12, w = Math.max(0, Math.min(cw - pad * 2, (ch - pad * 2) * ar)), hh = w / ar;
      P.view.style.width = `${Math.floor(w)}px`; P.view.style.height = `${Math.floor(hh)}px`; P.view.dataset.ratio = ar.toFixed(4);
    }
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
    if (ro) { ro.observe(picture); onStop(() => ro.disconnect()); }
    const mo = typeof MutationObserver === 'function' ? new MutationObserver(() => fit()) : null;
    if (mo) { mo.observe(P.view, { childList: true }); onStop(() => mo.disconnect()); }
    window.addEventListener('resize', fit); onStop(() => window.removeEventListener('resize', fit));

    // History is a PRO view: its tab shows with PRO (the PRO switch sets le-is-pro on the page's root)
    const syncPro = () => { const pro = root.classList.contains('le-is-pro'); if (!pro && !histBody.hidden) pick('look'); };
    const pm = typeof MutationObserver === 'function' ? new MutationObserver(syncPro) : null;
    if (pm) { pm.observe(root, { attributes: true, attributeFilter: ['class'] }); onStop(() => pm.disconnect()); }

    // the page: the compact top row, then the workbench; everything else the editor built (the empty note, the AI box, the banner, the render dialog, the warnings) is already inside a panel
    const foot = root.querySelector(':scope > p.meta:last-child');
    root.replaceChildren(head, grid, ...(foot ? [foot] : []));
    foot && foot.classList.add('wb-foot');
    fit();
    requestAnimationFrame(fit);
    return { grid, fit };
  }

  window.ryagramEditorWB = Object.freeze({ mount });
})();
