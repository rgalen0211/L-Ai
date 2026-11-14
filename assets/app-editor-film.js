// The data editor with the film's REAL frames (WEB, 2026-11-13, CC1 item 1, piece B): a picture the engine drew, a slider and a ruler over the whole film, the film's own blocks as a lane, the playhead
// and the video-editor keys. It exists only when the page has a film API (window.ryagramFilmApi(project) -> { plan(), window(text, { onProgress }) }): CONNECT's request_film_bundle plus the signed link on the
// live site, a fixture in the tests. Without one the editor keeps its stand-in picture and nothing here runs. Windows come through assets/app-editor-frames.js (opened and checked there).
//
//   mount({ h, api, onStop }) -> { el, ready: Promise<boolean>, destroy() }
// Everything a person reads from the story (a clip label) goes in with textContent. A moment whose window is not here yet shows the last picture and says what is happening; no picture is invented.
(() => {
  const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}.${Math.floor((t * 10) % 10)}`;
  const progressLine = p => (typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1 ? `Drawing this part of your film: ${Math.floor(p * 100)}%` : 'Drawing this part of your film.');

  async function loadFonts(files) {                                             // the fonts the engine used, so the picture's text is the film's text (an inline SVG sees the page's fonts)
    if (typeof FontFace !== 'function' || !document.fonts) return;
    for (const [name, bytes] of Object.entries(files || {})) {
      if (!name.startsWith('fonts/')) continue;
      try { const face = new FontFace(name.slice(6).replace(/\.woff2$/i, ''), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); await face.load(); document.fonts.add(face); } catch { /* the system font stays */ }
    }
  }

  function mount({ h, api, onStop = () => {} }) {
    const F = window.ryagramEditorFrames, TL = window.ryagramEditorTimeline;
    const status = h('p', { class: 'form-note le-film-status', role: 'status' }, 'Opening your film…');
    const view = h('div', { class: 'le-view le-film-view', role: 'img', 'aria-label': 'Your film at the chosen moment' });
    const range = h('input', { type: 'range', class: 'le-range', id: 'le-film-range', 'aria-label': 'Moment in your film', min: 0, max: 0, step: 1, value: 0, disabled: true });
    const posText = h('b', { class: 'le-pos' }, '');
    const playBtn = h('button', { type: 'button', class: 'button secondary', disabled: true }, 'Play');
    const tracks = h('div', { class: 'le-film-tracks' });
    const keys = h('p', { class: 'meta le-keys' }, 'Keys on the slider: arrows step, Shift+arrows or J and L jump a tenth of the film, Space or K plays and pauses, Home and End go to the ends.');
    const colourBox = h('section', { class: 'le-film-colours', 'aria-labelledby': 'le-film-col-h' });
    const el = h('div', { class: 'le-film' }, view, status, h('div', { class: 'le-scrub' }, playBtn, range, posText), tracks, keys, colourBox);
    let thumbTimer = null, thumbRow = null, thumbTiles = [], retry = null, store = null, plan = null, position = 0, timer = null, destroyed = false, lastSvg = false, rulerPaint = null, headBar = null;
    const fontsDone = new Set();

    const total = () => plan.totalSeconds;
    const say = (text, alert) => { status.textContent = text; status.setAttribute('role', alert ? 'alert' : 'status'); };
    const inRender = s => plan && s >= plan.renderStart && s <= plan.renderStart + plan.renderSeconds;

    // Try colours: the colours the picture under the playhead uses, each a picker; a change redraws at once (ENGINE's recolour, no engine run). Preview only: the words say so.
    let colourSig = '';
    const swatches = new Map();
    function paintColours() {
      const pal = store ? store.paletteAt(position).slice(0, 8) : [];
      const sig = pal.map(c => c.colour).join(',');
      if (sig === colourSig) return;
      colourSig = sig; swatches.clear();
      if (!pal.length) { colourBox.replaceChildren(); return; }
      const rows = pal.map(c => {
        const id = 'le-film-col-' + c.colour.slice(1);
        const input = h('input', { type: 'color', id, value: (store.colours[c.colour] || c.colour), 'aria-label': `Colour ${c.colour}, used in ${c.elements} places` });
        input.addEventListener('input', () => { const next = { ...store.colours, [c.colour]: input.value }; store.setColours(next); draw(); });
        swatches.set(c.colour, input);
        return h('li', {}, input, h('label', { for: id }, `Used in ${c.elements} places${c.fixed ? `, and ${c.fixed} more in patterns` : ''}`));
      });
      const reset = h('button', { type: 'button', class: 'button secondary small' }, 'Put the film’s colours back');
      reset.addEventListener('click', () => { store.setColours({}); for (const [col, input] of swatches) input.value = col; draw(); });
      colourBox.replaceChildren(h('h2', { id: 'le-film-col-h' }, 'Try colours'), h('p', { class: 'meta' }, 'This changes the picture you see here only. It is not saved to your film yet.'), h('ul', { class: 'le-film-col-list' }, rows), reset);
    }
    const THUMB_GAP = 120;                                                           // ms between two thumbnail drawings, so playback and the slider stay quick
    // Thumbnails under the film lane: tiles of the whole film, each filled from a window that is ALREADY loaded (never asks for a window of its own), one picture per tick so the page stays quick. A tile with no picture stays a plain block with its time.
    function fillThumbs() {
      thumbTimer = null; if (destroyed || !store || !thumbTiles.length) return;
      const next = thumbTiles.find(t => !t.done && inRender(t.second) && store.stateOf(t.second) === 'ready');
      if (!next) return;
      let uri = null; try { uri = store.thumbUri(next.second, 160); } catch (e) { uri = null; }
      next.done = true;                                                              // one try per tile and window state: a drawer that cannot draw it leaves the plain block
      if (typeof uri === 'string' && /^data:image\//.test(uri)) { next.img.src = uri; next.btn.classList.add('le-film-thumb-on'); }
      thumbTimer = setTimeout(fillThumbs, THUMB_GAP);
    }
    const kickThumbs = () => { if (!thumbTimer && !destroyed && thumbTiles.length) thumbTimer = setTimeout(fillThumbs, THUMB_GAP); };
    function paintHead() { if (rulerPaint) rulerPaint(Math.min(1, position / Math.max(0.001, total()))); }
    function draw() {
      if (!store) return;
      posText.textContent = `${mmss(position)} / ${mmss(total())}`;
      range.setAttribute('aria-valuetext', `${mmss(position)} of ${mmss(total())}`);
      paintHead();
      if (!inRender(position)) { view.replaceChildren(h('p', { class: 'meta le-film-block' }, 'This part of your film is a title or a clip that is drawn when the film is made.')); lastSvg = false; say(''); return; }
      store.want(position);
      const r = store.frameAt(position);
      kickThumbs();
      if (r.state === 'ready') { view.innerHTML = r.svg; lastSvg = true; say(''); paintColours(); }
      else if (r.state === 'failed') say(r.reason || 'This part of your film could not be drawn.', true);
      else if (r.state === 'idle' && r.reason) { say(`${r.reason} Trying again in a moment.`); if (!retry && !destroyed) retry = setTimeout(() => { retry = null; if (!destroyed) draw(); }, 3000); }
      else say(progressLine(store.progressOf(position)));                       // the worker's own heartbeat 0..1, or a plain line: never a number it did not send
      if (r.state !== 'ready' && !lastSvg) view.replaceChildren(h('p', { class: 'meta le-film-block' }, 'Drawing this part of your film.'));
    }
    const seekSeconds = s => { stop(); position = Math.max(0, Math.min(total(), s)); range.value = String(Math.min(plan.totalFrames - 1, Math.round(position * plan.fps))); draw(); };
    function stop() { if (timer) clearInterval(timer); timer = null; playBtn.textContent = 'Play'; }
    onStop(() => { destroyed = true; stop(); if (retry) clearTimeout(retry); if (thumbTimer) clearTimeout(thumbTimer); });

    range.addEventListener('input', () => { stop(); position = Math.min(total(), Number(range.value) / plan.fps); draw(); });
    range.addEventListener('keydown', ev => {
      const kt = TL.keyTarget(ev, { value: Number(range.value), min: 0, max: Number(range.max), step: 1 });
      if (!kt) return; ev.preventDefault();
      if (kt.toggle) { playBtn.click(); return; }
      stop(); range.value = String(kt.value); position = kt.value / plan.fps; draw();
    });
    playBtn.addEventListener('click', () => {
      if (timer) { stop(); return; }
      playBtn.textContent = 'Pause';
      timer = setInterval(() => {                                                   // eight pictures a second: a picture is a large drawing, so playback holds while the next window is still being made
        const next = position + 0.125;
        if (next > total()) { seekSeconds(0); stop(); return; }
        if (inRender(next)) { store.want(next); if (store.stateOf(next) !== 'ready') { draw(); return; } }
        position = next; range.value = String(Math.min(plan.totalFrames - 1, Math.round(position * plan.fps))); draw();
      }, 125);
    });

    function buildTracks() {
      const dur = total(), rl = TL.ruler({ h, duration: dur, seek: s => seekSeconds(s) });
      rulerPaint = rl.paint;
      const bar = h('div', { class: 'le-bar le-film-bar', 'aria-hidden': 'true' });
      for (const c of plan.clips) {
        const b = h('span', { class: `le-film-clip${c.drawn ? ' le-film-drawn' : ''}`, title: c.label || c.kind }, c.label || c.kind);
        b.style.left = `${(c.start / dur) * 100}%`; b.style.width = `${Math.max(0.5, (c.seconds / dur) * 100)}%`;
        bar.append(b);
      }
      thumbTiles = TL.thumbSeconds(TL.maxTilesFor(window.innerWidth), dur).map(second => {
        const img = h('img', { alt: '', draggable: 'false' }), btn = h('button', { type: 'button', class: 'le-film-thumb', 'aria-label': `Go to ${mmss(second)}` }, img, h('span', {}, mmss(second)));
        btn.addEventListener('click', () => seekSeconds(second));
        return { second, img, btn, done: false };
      });
      thumbRow = h('div', { class: 'le-film-thumbs' }, ...thumbTiles.map(t => t.btn));
      tracks.replaceChildren(h('div', { class: 'le-ruler-holder' }, rl.lane), h('div', { class: 'le-film-lane' }, h('b', { 'aria-hidden': 'true' }, 'Film'), bar), h('div', { class: 'le-film-lane' }, h('b', { 'aria-hidden': 'true' }, 'Moments'), thumbRow));
    }

    const ready = (async () => {
      try {
        plan = null;
        const raw = await api.plan();
        store = new F.FrameStore({ plan: raw, drawer: F.drawer, fetchWindow: (text, o) => api.window(text, o),
          onChange: (text, e) => {
            if (destroyed) return;
            if (e.state === 'ready' && !fontsDone.has(text)) { fontsDone.add(text); loadFonts(e.win.fonts).then(() => { if (!destroyed) draw(); }); }
            draw();
          } });
        plan = store.plan;
        range.max = String(plan.totalFrames - 1); range.disabled = false; playBtn.disabled = false;
        buildTracks();
        position = plan.renderStart; range.value = String(Math.min(plan.totalFrames - 1, Math.round(position * plan.fps)));
        draw();
        return true;
      } catch (err) {
        say((err && err.message ? String(err.message).replace(/[^\x20-\x7e]/g, ' ').slice(0, 200) : '') || 'Your film could not be opened here.', true);
        return false;
      }
    })();
    return { el, ready, destroy() { destroyed = true; stop(); }, state: () => ({ position, plan, store }) };
  }

  window.ryagramEditorFilm = { mount, mmss, progressLine };
})();
