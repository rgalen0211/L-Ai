// The live preview viewer: draws a scene bundle's frames in the page as the person drags a slider. Free: nothing is
// sent to a server and no credits are involved. The rules for WHAT a frame looks like belong to the engine's reference
// drawer (window.ryagramSceneDraw, vendored); the rules for WHICH frame and WHEN are in preview-core.js.
//
//   const viewer = await ryagramPreview.mount(host, { scene, fonts, drawer, env });   // host: an empty element
//   viewer.setFrame(120); viewer.state(); viewer.destroy();
(() => {
  const C = window.ryagramPreviewCore;
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (v === false || v == null) continue; if (k === 'class') n.className = v; else if (k in n && k !== 'list') n[k] = v; else n.setAttribute(k, v); }
    n.append(...kids.filter(Boolean));
    return n;
  };

  async function loadFonts(files) {
    const loaded = [];
    if (typeof FontFace !== 'function' || !document.fonts) return loaded;
    for (const [name, bytes] of Object.entries(files || {})) {
      if (!name.startsWith('fonts/')) continue;
      const family = name.slice(6).replace(/\.woff2$/i, '');
      try { const face = new FontFace(family, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); await face.load(); document.fonts.add(face); loaded.push(face); }
      catch { /* a font that will not load leaves the system font in its place */ }
    }
    return loaded;
  }

  // Graphics only -> a canvas, for the exact-year cache. Text is not baked in (an SVG used as an image cannot see the page's fonts).
  function rasterize(svg, width, height) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        c.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(c);
      };
      img.onerror = () => reject(new Error('could not rasterize'));
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
  }

  async function mount(host, { scene, fonts = {}, drawer = window.ryagramSceneDraw, env = {}, snapAlways = false } = {}) {
    C.parseScene(scene);
    if (!drawer || typeof drawer.draw !== 'function') throw new C.SceneError('The preview drawing code isn’t loaded.');
    const marks = C.marksOf(scene);
    const device = C.deviceClass({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, width: window.innerWidth, ...env });
    const budget = new C.FrameBudget({ device, startSnapped: snapAlways });
    const cache = new C.FrameCache(80);
    const faces = await loadFonts(fonts);
    const [cw, ch] = scene.canvas;
    const bw = Math.min(900, cw), bh = Math.round(bw * ch / cw);

    // --- the page of the viewer
    const svgHost = el('div', { class: 'pv-svg' });
    const bitmap = el('canvas', { class: 'pv-bitmap', width: bw, height: bh, hidden: true, 'aria-hidden': 'true' });
    const stage = el('div', { class: 'pv-stage', role: 'img', 'aria-label': 'The film at the chosen moment' }, bitmap, svgHost);
    stage.style.aspectRatio = `${cw} / ${ch}`;
    const slider = el('input', { type: 'range', class: 'pv-slider', min: 0, max: scene.frames - 1, step: 1, value: 0, 'aria-label': 'Moment in the film' });
    const label = el('output', { class: 'pv-label', 'aria-hidden': 'true' });
    const playBtn = el('button', { type: 'button', class: 'button secondary pv-play' }, 'Play');
    const note = el('p', { class: 'form-note pv-note', role: 'status', hidden: true }, 'Showing exact years while you drag.');
    const notches = el('div', { class: 'pv-notches', 'aria-hidden': 'true' });
    for (const s of C.stills(scene)) {
      const n = el('span', { class: 'pv-notch' });
      n.style.left = `${(s.first / Math.max(1, scene.frames - 1)) * 100}%`;
      n.style.width = `${Math.max(0.6, ((s.last - s.first + 1) / Math.max(1, scene.frames - 1)) * 100)}%`;
      notches.append(n);
    }
    host.replaceChildren(stage, el('div', { class: 'pv-controls' }, playBtn, el('div', { class: 'pv-track' }, slider, notches), label), note);

    let frame = 0, shown = -1, dragging = false, playing = false, raf = 0, pending = false, destroyed = false;
    let playT0 = 0, playF0 = 0, lastMs = 0;

    function draw(f, { snapped = false } = {}) {
      const t0 = performance.now();
      const cached = snapped ? cache.get(f) : undefined;
      if (snapped && cached) {
        const g = bitmap.getContext('2d');
        g.clearRect(0, 0, bw, bh); g.drawImage(cached, 0, 0);
        bitmap.hidden = false;
        svgHost.innerHTML = drawer.draw(scene, f, { parts: 'texts' });
      } else {
        bitmap.hidden = true;
        svgHost.innerHTML = drawer.draw(scene, f, { parts: 'all' });
      }
      const ms = performance.now() - t0;
      shown = f;
      lastMs = ms;
      return ms;
    }
    function show(f, { fromUser = false } = {}) {
      frame = C.clampFrame(scene, f);
      slider.value = String(frame);
      const snapMode = dragging && budget.mode === 'snap';
      const target = C.frameWhileDragging(dragging ? budget.mode : 'live', marks, frame);
      const ms = draw(target, { snapped: snapMode });
      if (dragging || playing) budget.record(ms);
      note.hidden = !(dragging && budget.mode === 'snap');
      slider.setAttribute('aria-valuetext', C.valueText(scene, marks, frame, drawer.describe));
      label.textContent = `${scene.clock.periods[C.periodAt(marks, frame)]}  ${C.mmss(frame, scene.fps)}`;
      if (fromUser) schedulePrefetch();
    }
    function request(f) { frame = C.clampFrame(scene, f); if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; if (!destroyed) show(frame); }); }

    // --- the exact-year cache, filled in idle time, nearest the current position first
    let prefetchTimer = 0;
    function schedulePrefetch() { clearTimeout(prefetchTimer); prefetchTimer = setTimeout(prefetch, 400); }
    async function prefetch() {
      for (const f of C.cachePlan(marks, frame)) {
        if (destroyed || dragging || playing) return;
        if (cache.has(f)) continue;
        try { cache.set(f, await rasterize(drawer.draw(scene, f, { parts: 'graphics' }), bw, bh), frame); } catch { return; }
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // --- input
    slider.addEventListener('pointerdown', () => { dragging = true; stopPlay(); });
    const release = () => { if (!dragging) return; dragging = false; note.hidden = true; const was = budget.mode; show(frame, { fromUser: true }); if (was === 'snap') budget.probe(lastMs); };
    slider.addEventListener('pointerup', release);
    slider.addEventListener('pointercancel', release);
    slider.addEventListener('input', () => { if (!dragging) { show(Number(slider.value), { fromUser: true }); } else request(Number(slider.value)); });
    slider.addEventListener('keydown', e => {
      const to = C.keyTarget(scene, marks, frame, e.key, e.shiftKey);
      if (to === null || e.key === 'ArrowUp' || e.key === 'ArrowDown') return;      // the native slider keeps the plain arrows
      e.preventDefault(); stopPlay(); show(to, { fromUser: true });
    });

    function tickPlay(now) {
      if (!playing || destroyed) return;
      const f = playF0 + ((now - playT0) * scene.fps) / 1000;
      if (f >= scene.frames - 1) { show(scene.frames - 1); stopPlay(); return; }
      if (Math.round(f) !== shown) show(Math.round(f));
      raf = requestAnimationFrame(tickPlay);
    }
    function startPlay() {
      if (frame >= scene.frames - 1) frame = 0;
      playing = true; playBtn.textContent = 'Pause'; playT0 = performance.now(); playF0 = frame;
      raf = requestAnimationFrame(tickPlay);
    }
    function stopPlay() { playing = false; cancelAnimationFrame(raf); playBtn.textContent = 'Play'; }
    playBtn.addEventListener('click', () => { if (playing) stopPlay(); else startPlay(); });
    const onHide = () => { if (document.hidden) stopPlay(); };
    document.addEventListener('visibilitychange', onHide);

    show(0);
    schedulePrefetch();
    return {
      setFrame: f => show(f, { fromUser: true }),
      // The scene, restyled in place by the editor (a patched copy); redraws the current frame and refills the cache.
      setScene(next) { Object.assign(scene, next); cache.clear(); show(frame); schedulePrefetch(); },
      state: () => ({ frame, shown, mode: budget.mode, playing, cached: cache.size, device, marks }),
      budget, cache,
      destroy() { destroyed = true; stopPlay(); clearTimeout(prefetchTimer); document.removeEventListener('visibilitychange', onHide); cache.clear(); for (const f of faces) try { document.fonts.delete(f); } catch { /* ok */ } host.replaceChildren(); }
    };
  }

  window.ryagramPreview = { mount, rasterize, loadFonts };
})();
