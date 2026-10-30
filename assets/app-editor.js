// The live editor page (#/editor/data and #/editor/compilation), behind `liveEditor` (off). NEXT-WEB 152; design: proposals\WEB-LIVE-EDITOR.md.
// This first head runs on the MOCK app with a stand-in drawing and a stand-in clip list: the real drawer (ENGINE 35), the shared draft (CONNECT's editor_apply_ops)
// and the render progress panel come later. Every edit is an op from app-editor-core.js (closed list, checked, undoable); nothing here is sent anywhere,
// nothing spends a credit, and text from anywhere goes in as text nodes. No inline styles in the markup (the page's policy forbids them); positions are set from script.
(() => {
  const E = window.ryagramEditor;
  const SVG = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs = {}) => { const el = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v)); return el; };
  const mmss = t => `${Math.floor(t / 60)}:${(Math.floor(t % 60) + '').padStart(2, '0')}.${Math.floor((t * 10) % 10)}`;
  const YEARS = [1985, 1990, 1995, 2000, 2005, 2010];                       // the stand-in film runs 1985 to 2010
  const FIRST = YEARS[0], LAST = YEARS[YEARS.length - 1];
  const LOOK_ROWS = [                                                         // the rows the worker accepts today, in the order the panel shows them
    ['network.color', 'Line colour'], ['network.base_color', 'Base lines'], ['network.context_color', 'Background lines'], ['state.fill', 'Land colour'], ['page.background', 'Page colour']
  ];
  const WAITING = ['Theme', 'Marker shape', 'Border width', 'Glow', 'Labels'];   // ENGINE 35 names these keys; shown, not offered, until then
  const DATA_BASE = () => ({ look: { 'network.color': '#6fd1bd', 'network.base_color': '#c9a66b', 'network.context_color': '#5a5a66', 'state.fill': '#23232d', 'page.background': '#0d0d11' }, clips: [], duration: 0 });
  const CLIPS_BASE = () => ({ look: {}, duration: 12, clips: [
    { id: 'v1', track: 'video', start: 0, len: 2, label: 'great news everyone' }, { id: 'v2', track: 'video', start: 2, len: 2, label: 'we built a thing' },
    { id: 'v3', track: 'video', start: 4, len: 3, label: 'great news for the weekend' }, { id: 'v4', track: 'video', start: 7, len: 2.5, label: 'great news again', ai_altered: true, ai_altered_by: 'face tool' },
    { id: 'v5', track: 'video', start: 9.5, len: 2.5, label: 'nobody saw that coming' },
    { id: 'p1', track: 'pictures', start: 1.5, len: 2, label: 'house price' }, { id: 'p2', track: 'pictures', start: 6.2, len: 2.2, label: 'rent chart' },
    { id: 't1', track: 'text', start: 0.2, len: 3.5, label: 'Title', text: 'Housing, 2019 to 2024' }, { id: 't2', track: 'text', start: 9, len: 3, label: 'Thanks', text: 'Thanks for watching' },
    { id: 'music', track: 'music', start: 0, len: 12, label: 'your music file (stays on your computer)', source: 'song.wav', source_start: 0, level_db: -12, fade_in_s: 0, fade_out_s: 1, snap: false }],
    rules: [{ id: 'r1', phrase: 'great news', picture: 'img-1', seconds: 2, mode: 'corner', fade_s: 0.2 }], pictures: [{ id: 'img-1', name: 'house.png' }, { id: 'img-2', name: 'chart.png' }],
    look: { theme: 'dark', text_color: '#f2f2f2', box_color: '#14141a', box_opacity: 0.75, letterbox: '#000000' } });
  const TRACK_NAMES = { video: 'Video', pictures: 'Pictures', text: 'Text', music: 'Music' };

  function create({ h, data = null }) {
    const btn = (label, cls, onclick, attrs = {}) => h('button', { type: 'button', class: `button ${cls || 'secondary'}`.trim(), onclick, ...attrs }, label);

    function editorView(kind, onStop) {
      const isData = kind === 'data';
      const onPc = !!window.ryagramLiveHost;                                   // on the person's own computer: no demo film, no stand-in; only what the maker's draft holds
      // Data-film mode with the engine's own drawer (NEXT-WEB 154): when the page can get the film's look bundle (the host's bundle(project) call; in mock mode a synthetic one) and
      // ENGINE's look-draw.js is loaded, the preview IS the engine's drawing and the look panel offers the keys it honours. Without either, the stand-in drawing below stays.
      const DD = window.ryagramEditorData, RL = window.RyagramLook;
      const lookLoader = isData && DD && RL ? (window.ryagramLiveHost && typeof window.ryagramLiveHost.bundle === 'function' ? p => window.ryagramLiveHost.bundle(p) : typeof window.ryagramMockLookBundle === 'function' ? p => window.ryagramMockLookBundle(p) : null) : null;
      const bundleMode = !!lookLoader;
      let bundle = null, tl = null, bundleState = bundleMode ? 'opening' : 'none', bundleNote = '';
      let streamLeft = 0, streamNote = '';                                   // a streamed film: how many chunks are still on their way, and why it stopped if it did
      const ed = new E.Editor(onPc || bundleMode ? { look: {}, clips: [], duration: 0 } : isData ? DATA_BASE() : CLIPS_BASE());
      // The shared draft: in mock mode (the only place it runs until CONNECT's SQL is applied) with the stand-in functions; otherwise the page edits locally, as before.
      // The host: on the website the app's data layer (mock mode only, until CONNECT's SQL is applied); on the maker's own page (tools/maker-live/) window.ryagramLiveHost, whose rpc talks to the PC.
      const host = window.ryagramLiveHost || null;
      const project = host ? host.project : window.RYAGRAM_MOCK_EDITOR_PROJECT;
      const hostRpc = host ? host.rpc : (data && data.editorRpc && window.ryagramMock ? (n, a) => data.editorRpc(n, a) : null);
      const D = window.ryagramEditorDraft;
      let aiSaid = [], askedAt = 0, askTimer = 0;                               // what the person's AI changed (for the list), and when the person last sent it a note (0 = not waiting)
      const draft = hostRpc && project && D ? D.createDraft({ rpc: hostRpc, project, mode: kind, editor: ed, onChange: x => { if (x && ((x.applied && x.applied.length) || (x.skipped && x.skipped.length))) saved = false; if (x && x.ops && x.ops.length) { aiSaid.push(...x.ops); aiSaid = aiSaid.slice(-12); askedAt = 0; clearTimeout(askTimer); paintAiWait(false); } if (x && x.skipped && x.skipped.length) say(`${x.skipped.length} change${x.skipped.length === 1 ? '' : 's'} from your AI could not be applied here, so ${x.skipped.length === 1 ? 'it was' : 'they were'} left out.`); paint(); } }) : null;
      let position = bundleMode ? 0 : isData ? LAST : onPc ? 0 : 4.4;           // a year (stand-in), or a time in seconds
      let selected = isData ? null : onPc ? null : 'v3';
      let preview = null;                                                       // a colour being dragged in a chooser: shown, not yet an op
      let saved = true, message = '';
      const status = h('p', { class: 'form-note', role: 'status' });
      const say = t => { message = t; status.textContent = t; };

      // ---- the preview: a stand-in drawing (ENGINE 35's drawer replaces it); it redraws from the state at once
      const view = h('div', { class: 'le-view', role: 'img' });
      const pic = h('img', { class: 'le-svg', alt: '', draggable: 'false' });
      function drawBundle() {
        if (bundleState !== 'ready') {
          view.replaceChildren(h('p', { class: 'le-bundle-note', role: 'status' }, bundleState === 'opening' ? 'Opening the film…' : bundleNote));
          view.setAttribute('aria-label', bundleState === 'opening' ? 'Opening the film' : 'The film could not be opened');
          return;
        }
        const r = DD.pictureFor(RL, bundle, position, { ...ed.state.look, ...(preview || {}) });
        if (!r.error && !r.loading) pic.src = r.src;
        view.replaceChildren(pic);
        if (r.error) view.append(h('p', { class: 'le-bundle-note', role: 'status' }, r.error));
        if (r.loading) view.append(h('p', { class: 'le-bundle-note le-loading', role: 'status' }, streamNote || 'This part of the film is still loading. The picture below is the last one that was ready.'));
        else if (streamLeft > 0) view.append(h('p', { class: 'le-bundle-note le-loading', role: 'status' }, `Still loading the film: ${streamLeft} part${streamLeft === 1 ? '' : 's'} to come.`));
        else if (streamNote) view.append(h('p', { class: 'le-bundle-note', role: 'status' }, streamNote));
        view.setAttribute('aria-label', `Preview of ${tl.label(position)}`);
      }
      function drawData() {
        if (bundleMode) { drawBundle(); return; }
        const look = { ...ed.state.look, ...(preview || {}) };
        const reveal = (position - FIRST) / (LAST - FIRST);
        const svg = sv('svg', { viewBox: '0 0 160 90', class: 'le-svg' });
        svg.append(sv('rect', { width: 160, height: 90, fill: look['page.background'] }),
          sv('path', { d: 'M12 62 L30 30 L56 24 L78 36 L98 22 L126 30 L146 52 L120 70 L84 66 L52 74Z', fill: look['state.fill'], stroke: look['network.context_color'], 'stroke-width': 0.8 }),
          sv('path', { d: 'M60 70 L90 58 L130 56', fill: 'none', stroke: look['network.base_color'], 'stroke-width': 1.2 }));
        const road = sv('path', { d: 'M20 58 L38 36 L60 32 L80 44 L100 30 L124 40', fill: 'none', stroke: look['network.color'], 'stroke-width': 1.6, pathLength: 100, 'stroke-dasharray': `${Math.round(reveal * 100)} 100` });
        const title = sv('text', { x: 10, y: 14, fill: '#f2f2ef', 'font-size': 7 }); title.textContent = 'Stand-in drawing (the engine’s drawer comes later)';
        const yr = sv('text', { x: 150, y: 84, fill: '#b6b5ae', 'font-size': 9, 'text-anchor': 'end' }); yr.textContent = String(Math.round(position));
        svg.append(road, title, yr);
        view.replaceChildren(svg);
        view.setAttribute('aria-label', `Preview at ${Math.round(position)}`);
      }
      function drawClips() {
        const at = position, now = ed.state.clips.filter(c => at >= c.start && at < c.start + c.len);
        const vid = now.find(c => c.track === 'video'), txt = now.find(c => c.track === 'text'), pic = now.find(c => c.track === 'pictures');
        const svg = sv('svg', { viewBox: '0 0 160 90', class: 'le-svg' });
        svg.append(sv('rect', { width: 160, height: 90, fill: '#0d0d11' }));
        const t = sv('text', { x: 80, y: 44, 'text-anchor': 'middle', fill: '#f2f2ef', 'font-size': 9, 'font-weight': 700 }); t.textContent = vid ? vid.label : 'Nothing here yet';
        svg.append(t);
        if (pic) { const p = sv('text', { x: 80, y: 58, 'text-anchor': 'middle', fill: '#c9a66b', 'font-size': 6 }); p.textContent = `Picture: ${pic.label}`; svg.append(p); }
        if (txt && txt.text) { svg.append(sv('rect', { x: 14, y: 68, width: 132, height: 14, rx: 3, fill: '#000' })); const c = sv('text', { x: 80, y: 78, 'text-anchor': 'middle', fill: '#fff', 'font-size': 6 }); c.textContent = txt.text; svg.append(c); }
        view.replaceChildren(svg);
        view.setAttribute('aria-label', `Preview at ${mmss(at)}${vid ? ', ' + vid.label : ''}`);
      }

      // ---- on the person's computer the preview is the film itself: the host gives a small picture for the clip under the playhead (GET /api/live/frame), pictures laid over it
      // at their place, and the texts are laid out by BUILDER's text-layout.js from the film's own rules (GET /api/live/text-rules), the same numbers the engine uses.
      const hostPreview = !!(host && typeof host.frame === 'function' && !isData);
      let rules = null, drawSeq = 0, layoutProblem = '';
      const bitmaps = new Map();                                                 // `${clip id}|${tenth of a second}` -> Promise<ImageBitmap | null>; the last 80
      const GEOM = { full: [0, 0, 1, 1], centre: [0.25, 0.2, 0.5, 0.6], corner: [0.72, 0.05, 0.23, 0.26], lower_third: [0.08, 0.66, 0.84, 0.26] };
      const cv = hostPreview ? h('canvas', { class: 'le-canvas', width: 640, height: 360, role: 'img' }) : null;
      function frameOf(clipId, t) {
        const key = `${clipId}|${Math.round(t * 10)}`;
        if (!bitmaps.has(key)) {
          if (bitmaps.size >= 80) bitmaps.delete(bitmaps.keys().next().value);
          bitmaps.set(key, Promise.resolve().then(() => host.frame(clipId, Math.round(t * 10) / 10)).then(b => (b ? createImageBitmap(b) : null)).catch(() => null));
        }
        return bitmaps.get(key);
      }
      const contain = (ctx, bmp, x, y, w, hh) => { const k = Math.min(w / bmp.width, hh / bmp.height); ctx.drawImage(bmp, x + (w - bmp.width * k) / 2, y + (hh - bmp.height * k) / 2, bmp.width * k, bmp.height * k); };
      async function drawHost() {
        const R = ed.state.text_rules || rules;                                   // the summary's rules (the film's real canvas) first, then the host's own text-rules call
        const seq = ++drawSeq, at = position, W = R ? R.canvas[0] : 1280, H = R ? R.canvas[1] : 720;
        if (cv.height !== Math.round(640 * H / W)) cv.height = Math.round(640 * H / W);
        const ctx = cv.getContext('2d'), k = cv.width / W;
        const now = ed.state.clips.filter(c => at >= c.start && at < c.start + c.len);
        const vid = now.find(c => c.track === 'video');
        let bmp = null, bmpPics = [];
        if (vid && !(vid.slide === true && !vid.picture)) bmp = await frameOf(vid.id, at - vid.start);
        for (const p of now.filter(c => c.track === 'pictures')) bmpPics.push([p, await frameOf(p.id, 0)]);
        if (seq !== drawSeq) return;                                              // a newer playhead position took over
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const fl = ed.state.look || {}, light = fl.theme === 'light';
        ctx.fillStyle = /^#[0-9a-fA-F]{6}$/.test(fl.letterbox) ? fl.letterbox : '#000'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.setTransform(k, 0, 0, k, 0, 0);
        const slideText = vid && vid.slide === true && !vid.picture;
        if (slideText) { ctx.fillStyle = light ? '#f2f2f2' : '#14141a'; ctx.fillRect(0, 0, W, H); }   // a text slide is the words on a card in the film's theme (dark by default)
        else if (bmp) contain(ctx, bmp, 0, 0, W, H);
        else if (vid) { ctx.fillStyle = '#b6b5ae'; ctx.font = `${Math.round(H * 0.05)}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText(`${vid.label} (no picture for this moment)`, W / 2, H / 2); ctx.textAlign = 'start'; }
        for (const [p, b] of bmpPics) { if (!b) continue; const g = GEOM[p.mode] || GEOM.full; contain(ctx, b, g[0] * W, g[1] * H, g[2] * W, g[3] * H); }
        layoutProblem = '';
        const L = window.RyagramText;
        const words = [];
        if (slideText && vid.text) words.push({ text: vid.text, style: null, card: true });
        for (const t of now.filter(c => c.track === 'text' && c.text)) words.push({ text: t.text, style: t.style || null });
        for (const w of words) {
          try {
            if (w.card) { ctx.fillStyle = light ? '#14141a' : '#f2f2f2'; ctx.font = `${Math.round(H * 0.07)}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.fillText(w.text, W / 2, H / 2); ctx.textAlign = 'start'; }
            else if (L && R && w.style) { const lay = L.layout(R, w.text, w.style, ctx); L.draw(ctx, R, lay, w.text, { text: /^#[0-9a-fA-F]{6}$/.test(fl.text_color) ? fl.text_color : '#f2f2f2', box: /^#[0-9a-fA-F]{6}$/.test(fl.box_color) ? fl.box_color : '#14141a', alpha: Number.isFinite(fl.box_opacity) ? fl.box_opacity : 0.75 }); }
            else { const sz = Math.round(H * 0.05); ctx.font = `${sz}px Arial, sans-serif`; const tw = ctx.measureText(w.text).width; const x = (W - tw) / 2, y = H * 0.86; ctx.fillStyle = 'rgba(20,20,26,.75)'; ctx.fillRect(x - sz / 3, y - sz, tw + 2 * sz / 3, sz * 1.5); ctx.fillStyle = '#f2f2f2'; ctx.fillText(w.text, x, y); }
          } catch (e) { layoutProblem = String((e && e.message) || 'That text does not fit.').slice(0, 200); }
        }
        view.setAttribute('aria-label', `Preview at ${mmss(at)}${vid ? ', ' + vid.label : ''}${words.length ? ', text: ' + words.map(w => w.text).join(' / ').slice(0, 120) : ''}`);
        paintWarns();
      }
      if (hostPreview) {
        view.replaceChildren(cv);
        if (typeof host.textRules === 'function') host.textRules().then(r => { if (r && r.canvas && r.styles) { rules = r; drawHost(); } }).catch(() => {});
      }

      // ---- the scrubber: a real range input (keyboard and screen reader for free)
      const range = h('input', { type: 'range', class: 'le-range', id: 'le-range', 'aria-label': isData ? (bundleMode ? 'Period of the film' : 'Year') : 'Time in the film' });
      const posText = h('b', { class: 'le-pos' });
      const setPos = v => { position = v; paintPreview();
        const shown = bundleMode ? (tl ? tl.label(position) : '') : String(Math.round(position));
        posText.textContent = isData ? shown : `${mmss(position)} / ${mmss(ed.state.duration)}`;
        range.setAttribute('aria-valuetext', isData ? (bundleMode ? shown : `Year ${Math.round(position)}`) : `${mmss(position)} of ${mmss(ed.state.duration)}`); paintHead(); };
      const paintPreview = () => (isData ? drawData() : hostPreview ? drawHost() : drawClips());
      range.addEventListener('input', () => setPos(bundleMode ? (tl ? tl.seconds(Number(range.value)) : 0) : isData ? Number(range.value) : Number(range.value) / 10));
      const playBtn = btn('Play', 'secondary', () => {
        if (timer) { stopPlay(); return; }
        playBtn.textContent = 'Pause';
        if (bundleMode) {                                                       // one frame per tick at the film's own frame rate (capped at 12 a second so a slow phone keeps up)
          if (!tl) return;
          const ms = Math.max(1000 / 12, 1000 / tl.fps);
          timer = setInterval(() => { const f = tl.frame(position) + 1; setPos(tl.seconds(f >= tl.frames ? 0 : f)); range.value = String(tl.frame(position)); }, ms);
          return;
        }
        timer = setInterval(() => { const step = isData ? 0.25 : 0.1, max = isData ? LAST : ed.state.duration; if (position + step > max) { setPos(isData ? FIRST : 0); } else setPos(position + step); range.value = String(isData ? position : Math.round(position * 10)); }, isData ? 60 : 100);
      });
      let timer = null;
      const stopPlay = () => { if (timer) clearInterval(timer); timer = null; playBtn.textContent = 'Play'; };
      onStop(stopPlay);
      const scrub = h('div', { class: 'le-scrub' }, playBtn, range, posText);
      const ticks = isData ? h('div', { class: 'le-ticks', 'aria-hidden': 'true' }, bundleMode ? [] : YEARS.map(y => h('span', {}, String(y)))) : null;

      // ---- the controls
      const pill = h('span', { class: 'le-pill' });
      const undoBtn = btn('Undo', 'secondary', async () => { stopPlay(); if (draft) { const r = await draft.undo(); say(r.ok ? 'Undone.' : (r.reason || '')); } else { ed.undo(); say('Undone.'); } saved = false; paint(); });
      const revertBtn = btn('Revert', 'secondary', () => { ed.revert(); saved = true; say('Back to the last save.'); paint(); });
      const saveBtn = btn('Save', 'secondary', () => { ed.base = ed.state; ed.log = []; ed.redo = []; saved = true; say('Saved as this film’s working version (mock: nothing is stored yet).'); paint(); });
      const aiBtn = btn('Ask my AI', 'secondary', () => { aiBox.hidden = !aiBox.hidden; if (!aiBox.hidden) { paintChips(); note.focus(); } }, { class: 'button secondary le-ai-btn' });
      const finalBtn = btn(isData ? 'Render final film' : 'Build final film', 'primary', () => { stopPlay(); showCommit(); });
      const renderBox = h('div', { class: 'le-render', hidden: true });
      let locked = false;                                                       // locked: a render is using what was committed
      // What will render, in words (the look values or the clip list), then Start. Starting commits the draft (today's save and checks), then starts the job.
      function committedWords() {
        if (bundleMode) { const rows = DD.rowsFor(RL, bundle).filter(([k]) => ed.state.look[k] !== undefined); return rows.length ? ['The look you can see:', ...rows.map(([k, l]) => `${l}: ${ed.state.look[k]}`)] : ['The film\u2019s own look: nothing changed.']; }
        if (isData) return ['The look you can see:', ...LOOK_ROWS.map(([k, l]) => `${l} ${ed.state.look[k]}`)];
        const vids = ed.state.clips.filter(c => c.track === 'video');
        return [`${vids.length} video clips in this order: ${vids.map(c => c.label).join(', ')}.`, `${ed.state.clips.length - vids.length} pictures, text lines and music tracks, ${mmss(ed.state.duration)} long.`];
      }
      const closeRender = () => { renderBox.hidden = true; renderBox.replaceChildren(); };
      function showCommit() {
        renderBox.hidden = false;
        renderBox.replaceChildren(h('h2', {}, 'What will render'), h('p', { class: 'meta' }, 'This exact draft is what the final film is made from. Nothing is added and nothing is dropped.'),
          h('ul', {}, committedWords().map(t => h('li', {}, t))),
          h('div', { class: 'le-actions' }, btn('Start the render', 'primary', host && typeof host.render === 'function' ? startHostBuild : startJob), btn('Not yet', 'secondary', closeRender)));
        renderBox.querySelector('button').focus();
      }
      // On the person's own computer the maker builds the film itself (POST /api/live/render, one at a time) and answers when it is made: there is no job row and no per-frame numbers to
      // read, so the panel says what is happening and how long it has been, and never invents a percentage or a time left.
      async function startHostBuild() {
        locked = true; saved = true; ed.base = ed.state; ed.log = []; ed.redo = [];
        const t0 = Date.now();
        const head = h('p', { class: 'le-prog-head', role: 'status' }, 'Building your film on this computer.');
        const sub = h('p', { class: 'meta' }, 'This can take a few minutes. It is made here; nothing is sent anywhere. Keep this window open.');
        const clock = h('p', { class: 'meta' }, 'Working for 0:00');
        const result = h('p', { class: 'form-note', role: 'status' });
        renderBox.hidden = false;
        renderBox.replaceChildren(h('h2', {}, 'Building your film'), h('p', { class: 'meta' }, 'What you committed is what is built.'), head, sub, clock, result);
        paint();
        const tick = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); clock.textContent = `Working for ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }, 1000);
        onStop(() => clearInterval(tick));
        let r;
        try { r = await host.render(); } catch (e) { r = { error: 'The Ryagram app on this computer did not answer. Is it still open?' }; }
        clearInterval(tick);
        locked = false;
        const words = t => String((t && (t.message || t.error)) || '').replace(/[\u0000-\u001f<>]/g, ' ').slice(0, 400);
        if (r && !r.error) { head.textContent = 'Your film is ready.'; result.textContent = [words(r), r.film ? `File: ${String(r.film).replace(/[^A-Za-z0-9 ._()-]/g, '').slice(0, 120)}` : ''].filter(Boolean).join(' '); }
        else { head.textContent = 'The film could not be built.'; result.textContent = `${words(r)} Your edit is as you left it; you can change it and try again.`; }
        renderBox.append(h('div', { class: 'le-actions' }, btn('Close', 'secondary', closeRender)));
        paint();
      }
      // The progress panel. Mock: a fake job walks through drawing, encoding and the checks; the real one reads jobs.progress_detail (the same fields).
      function startJob() {
        const PR = window.ryagramEditorProgress, tracker = new PR.Tracker();
        locked = true; saved = true; ed.base = ed.state; ed.log = []; ed.redo = [];
        const t0 = Date.now(); let skew = 0, frozen = false, lastReading = null;
        const bar = h('div', { class: 'le-meter', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': 'The render, whole job' });
        const fill = h('i', {});
        bar.append(fill);
        const head = h('p', { class: 'le-prog-head' }), eta = h('p', { class: 'meta' }), then = h('p', { class: 'meta' }), quiet = h('p', { class: 'le-warn', role: 'status', hidden: true });
        const stillsRow = h('div', { class: 'le-stills', role: 'list', 'aria-label': 'Pictures from the film so far' });
        const cancel = btn('Cancel', 'secondary', () => end('cancelled'));
        const mock = window.ryagramMock ? h('p', { class: 'meta' }, btn('(mock) go quiet for 3 minutes', 'secondary', () => { skew += 180000; frozen = true; tick(); })) : null;
        renderBox.hidden = false;
        renderBox.replaceChildren(h('h2', {}, isData ? 'Rendering your film' : 'Building your film'), h('p', { class: 'meta' }, 'What you committed is what renders.'), head, bar, eta, then, quiet, stillsRow, h('div', { class: 'le-actions' }, cancel), mock);
        // the fake worker: 2,820 frames over about 9 s, then encoding, then the checks; no time left until it has a rate
        const reading = () => {
          const sec = (Date.now() - t0) / 1000;
          if (sec < 9) { const n = Math.floor(sec / 0.9); return { stage: 'drawing', done: Math.round(2820 * sec / 9), total: 2820, unit: 'frames', eta_s: sec < 1.5 ? null : (9 - sec) * 40, eta_is_a_guess: true, total_is_provisional: false,
            stills: Array.from({ length: n }, (_, i) => ({ id: i + 1, label: `Year ${1985 + Math.round((i + 1) * 2.5)}` })) }; }
          if (sec < 11) return { stage: 'encoding', done: Math.round((sec - 9) * 50), total: 100, unit: 'frames', eta_s: 8, eta_is_a_guess: true };
          if (sec < 12.5) return { stage: 'checking', done: Math.round((sec - 11) * 2), total: 3, unit: 'checks', eta_s: 3, eta_is_a_guess: true };
          return null;
        };
        let jobTimer = null;
        function draw(v) {
          head.textContent = v.headline;
          fill.style.width = `${Math.round(v.fraction * 100)}%`;
          bar.setAttribute('aria-valuenow', String(Math.round(v.fraction * 100)));
          bar.setAttribute('aria-valuetext', v.headline);
          eta.textContent = v.state === 'running' ? v.eta : (v.then || '');
          then.textContent = v.state === 'running' ? (v.then || '') : '';
          quiet.hidden = !v.stalled;
          quiet.textContent = v.stalledText || '';
          if (v.state === 'running' && v.stills && v.stills.length !== stillsRow.childElementCount) stillsRow.replaceChildren(...v.stills.map(s => h('div', { class: 'le-still', role: 'listitem' }, h('span', {}, s.label || `Picture ${s.id}`))));
        }
        function end(state) {
          clearInterval(jobTimer);
          tracker.finish(state);
          draw(tracker.view(null, Date.now()));
          locked = false;
          paint();
          cancel.disabled = true;
          renderBox.append(h('div', { class: 'le-actions' }, btn('Close', 'secondary', closeRender)));
        }
        function tick() {
          const r = frozen ? lastReading : reading();
          if (r === null && !frozen) { end('complete'); return; }
          if (!frozen) lastReading = r;
          draw(tracker.feed(r, Date.now() + skew));
        }
        jobTimer = setInterval(tick, 400);
        onStop(() => clearInterval(jobTimer));
        tick();
        paint();
        cancel.focus();
      }

      const banner = h('div', { class: 'le-banner', role: 'status', hidden: true });
      const warns = h('div', { class: 'le-warns' });

      // ---- Ask my AI: a note, then the person's own AI in a NEW chat (no server; the note travels as plain text in the address)
      const note = h('textarea', { id: 'le-note', rows: 3, maxlength: 300, 'aria-label': 'What should your AI change?' });
      const aiLinks = h('div', { class: 'le-ai-links' });
      // names the film (the project id, when it is a plain id, and the title) so the AI does not have to guess which project's editor is open (CONNECT 12:44)
      const aiFilm = () => (typeof project === 'string' && /^[0-9A-Za-z-]{8,64}$/.test(project) ? ` The film is project ${project}${host && host.title ? ` ("${E.cleanText(String(host.title)).slice(0, 60)}")` : ''}.` : '');
      const aiLine = () => `I am editing my Ryagram film and want you to change it.${aiFilm()} My note: ${E.cleanText(note.value) || 'make it clearer'}. Use the Ryagram connector. Read my open editor draft first and change only the draft. Do not render, save or spend credits.`;
      const aiChips = h('div', { class: 'le-ai-chips', 'aria-label': 'Things you can ask for' });
      const aiWait = h('p', { class: 'meta le-ai-wait', role: 'status', 'aria-live': 'polite', hidden: true });
      const paintAiWait = (late) => { aiWait.hidden = !askedAt; aiWait.textContent = !askedAt ? '' : late ? 'Nothing has changed yet. Your AI may still be reading the draft, or it may have asked you something in its own chat.' : 'Sent. Waiting for your AI. When it changes the draft, the changes appear here within a few seconds and you can undo them.'; };
      const markAsked = () => { askedAt = Date.now(); clearTimeout(askTimer); paintAiWait(false); askTimer = setTimeout(() => { if (askedAt) paintAiWait(true); }, 90000); };
      const aiBox = h('div', { class: 'le-ai', hidden: true }, h('label', { for: 'le-note' }, 'What should your AI change?'), note, aiChips, aiLinks, aiWait,
        h('p', { class: 'meta' }, 'It opens a new chat in your own Claude or ChatGPT with this ready. Your AI can change the draft you see here; it cannot render, save, publish or spend credits.'));
      const paintAiLinks = () => {
        const S = window.ryagramStart, line = aiLine();
        aiLinks.replaceChildren(...['claude', 'chatgpt'].filter(() => S && S.chatUrl && S.APPS).map(app => { const u = S && S.chatUrl ? S.chatUrl(app, line) : null; return u ? h('a', { class: 'button secondary', href: u, target: '_blank', rel: 'noopener noreferrer', onclick: markAsked }, S.APPS[app].label) : null; }),
          btn('Copy', 'secondary', async () => { try { await navigator.clipboard.writeText(line); markAsked(); say('Copied. Paste it into your AI.'); } catch { say('Could not copy. Select the note and copy it by hand.'); } }));
      };
      note.addEventListener('input', paintAiLinks);
      const paintChips = () => { const s = bundleMode && bundle && DD.suggestions ? DD.suggestions(RL, bundle) : []; aiChips.replaceChildren(...s.map(t => btn(t, 'secondary', () => { note.value = t; paintAiLinks(); note.focus(); }, { class: 'button secondary small le-chip' }))); };
      const mockAi = window.ryagramMock ? btn('(mock) my AI changes the line colour', 'secondary', async () => {
        if (draft && window.ryagramMockEditor) {                                  // the person's AI, through the connector: onto the shared draft; this page sees it on its next look
          const aiOp = isData ? { op: 'set_look', key: 'network.color', value: '#ff9f6b' } : { op: 'set_clip_text', id: 't1', text: 'Changed by my AI' };
          const r = window.ryagramMockEditor.ai.apply(project, kind, draft.revision, [aiOp], 'Claude');
          say(r.error ? r.error.message : '');
          return;
        }
        const r = ed.receive([{ op: 'set_look', key: 'network.color', value: '#ff9f6b' }], ed.revision);
        say(r.ok ? '' : r.reason === 'stale' ? 'Your AI changed this just now. Try again.' : r.reason); saved = false; paint();
      }, { class: 'button secondary le-mock' }) : null;

      // ---- the look panel (data films)
      const lookPanel = h('section', { class: 'le-panel', 'aria-labelledby': 'le-look-h' });
      // Bundle mode: the rows the engine's drawer honours (it names the ones it does not), the six presets, and the keys still waiting for the worker. A colour dragged in a chooser
      // is only previewed; releasing it makes the op. Nothing here uses credits: 'Render final film' is the only button that does.
      function paintBundleLook() {
        const touched = new Set(ed.aiTouched()), look = ed.state.look, dflt = DD.defaults(bundle, look), cur = DD.presetOf(look, bundle);
        const rows = DD.rowsFor(RL, bundle).map(([key, label, kind]) => {
          const id = `le-look-${key}`, val = look[key] !== undefined ? look[key] : dflt[key], mark = touched.has('look:' + key) ? h('span', { class: 'le-aimark' }, ' \u00b7 by your AI') : null;
          if (kind === 'theme') {
            const sel = h('select', { id, disabled: locked }, [['dark', 'Dark'], ['light', 'Light']].map(([v, w]) => h('option', { value: v, selected: val === v }, w)));
            sel.addEventListener('change', () => apply({ op: 'set_look', key, value: sel.value }));
            return h('div', { class: 'le-row' }, h('label', { for: id }, label, mark), sel);
          }
          if (kind === 'number') {
            const n = h('input', { type: 'number', id, min: '0', max: '4', step: '0.5', value: val, disabled: locked });
            n.addEventListener('change', () => apply({ op: 'set_look', key, value: Number(n.value) }));
            return h('div', { class: 'le-row' }, h('label', { for: id }, label, mark), n);
          }
          const input = h('input', { type: 'color', value: val, id, 'aria-label': label, disabled: locked });
          input.addEventListener('input', () => { preview = { [key]: input.value }; paintPreview(); });
          input.addEventListener('change', () => { preview = null; apply({ op: 'set_look', key, value: input.value }); });
          return h('div', { class: 'le-row' }, h('label', { for: id }, label, mark), input);
        });
        const presetRows = DD.PRESETS.map(p => {
          const on = cur && cur.id === p.id, notes = DD.cautions(p, bundle);
          return h('li', { class: `le-preset${on ? ' le-on' : ''}` },
            btn(p.label, 'secondary', async () => { const ops = DD.presetOps(p, ed.state.look, bundle); if (!ops.length) { say(DD.noRamp(bundle) && DD.presetOps(p, {}, null).length ? `${p.label} changes only the low and high colours, which this film does not use.` : `${p.label} is already applied.`); return; } if (await applyMany(ops)) say(`${p.label} is applied. Undo takes it back.`); }, { 'aria-pressed': on ? 'true' : 'false', 'data-preset': p.id, disabled: locked }),
            h('span', { class: 'meta' }, ` ${p.blurb}`), ...notes.map(t => h('span', { class: 'le-warn le-cau' }, t)));
        });
        lookPanel.replaceChildren(h('h2', { id: 'le-look-h' }, 'Look'),
          h('h3', {}, 'Ready-made looks'), h('ul', { class: 'le-presets' }, presetRows),
          h('p', { class: 'meta' }, 'A ready-made look sets the colours below; its middle colour waits for the worker and is not shown until it can be saved.'),
          ...(DD.isBars(bundle) ? [h('div', { class: 'le-bands', 'data-key': 'bars' }, h('p', { class: 'meta' }, `This film is a bar race. Its bars have one colour, so there are no low and high colours; the page colour${DD.hasLight(bundle) ? ' and the theme' : ''} work. Changing the bar colour waits for the worker.`),
            DD.barsPartial(bundle) ? h('p', { class: 'meta' }, `This preview holds only the first ${Math.round(bundle.frames / bundle.fps * 10) / 10} seconds of the film.`) : null)] : []),
          ...(DD.isBanded(bundle) ? [h('div', { class: 'le-bands', 'data-key': 'bands' }, h('p', { class: 'meta' }, 'This film colours its areas in solid bands, so the low and high colours do not apply. The bands are shown here; changing them waits for the worker, and the moving dots keep their colour.'),
            h('div', { class: 'le-band-row' }, DD.bandColours(bundle).map((c, i) => { const sw = h('span', { class: 'le-swatch', role: 'img', 'aria-label': `Band ${i + 1}: ${c}` }); sw.style.background = c; return sw; })))] : []),
          ...rows, ...DD.WAITING.map(w => h('div', { class: 'le-row le-waiting' }, h('span', {}, w), h('span', { class: 'meta' }, 'waiting for the worker'))),
          h('p', { class: 'le-free' }, 'Free. Nothing here uses credits. Only the final button does.'));
      }
      function paintLook() {
        if (bundleMode) { paintBundleLook(); return; }
        const touched = new Set(ed.aiTouched());
        lookPanel.replaceChildren(h('h2', { id: 'le-look-h' }, 'Look'),
          ...LOOK_ROWS.map(([key, label]) => {
            const input = h('input', { type: 'color', value: ed.state.look[key], id: `le-look-${key}`, 'aria-label': label, disabled: locked });
            input.addEventListener('input', () => { preview = { [key]: input.value }; paintPreview(); });
            input.addEventListener('change', () => { preview = null; apply({ op: 'set_look', key, value: input.value }); });
            return h('div', { class: 'le-row' }, h('label', { for: input.id }, label, touched.has('look:' + key) ? h('span', { class: 'le-aimark' }, ' · by your AI') : null), input);
          }),
          ...WAITING.map(w => h('div', { class: 'le-row le-waiting' }, h('span', {}, w), h('span', { class: 'meta' }, 'waiting for the engine'))),
          h('p', { class: 'le-free' }, 'Free. Nothing here uses credits. Only the final button does.'));
      }

      // ---- the tracks (compilation): lanes on a wide screen, a list on a phone; both from the same state, both make the same ops
      const open = track => !ed.state.lanes || ed.state.lanes.includes(track);          // the lanes the maker can build today (the track summary says); the others are shown, not editable
      const lanes = h('div', { class: 'le-lanes', role: 'group', 'aria-label': 'Tracks' });

      // ---- the film's own settings (CONNECT 13:12): the phrase rules ("every time a word is said, show a picture") and the look of the film's text and cards
      const rulesPanel = h('section', { class: 'le-panel', 'aria-labelledby': 'le-rules-h', hidden: true });
      const filmLookPanel = h('section', { class: 'le-panel', 'aria-labelledby': 'le-flook-h', hidden: true });
      let editingRule = null;
      const MODE_WORDS = { full: 'full frame', centre: 'centre', corner: 'corner', lower_third: 'lower third' };
      const field = (id, label, control) => h('div', { class: 'le-row' }, h('label', { for: id }, label), control);
      function paintRules() {
        const rules = ed.state.rules, pics = ed.state.pictures || [];
        rulesPanel.hidden = !Array.isArray(rules) || isData;
        if (rulesPanel.hidden) return;
        const picName = id => (pics.find(p => p.id === id) || {}).name || id;
        const cur = rules.find(r => r.id === editingRule) || null;
        const phrase = h('input', { type: 'text', id: 'le-r-phrase', maxlength: 60, value: cur ? cur.phrase : '' });
        const pic = h('select', { id: 'le-r-pic' }, pics.map(p => h('option', { value: p.id, selected: cur && cur.picture === p.id }, p.name)));
        const secs = h('input', { type: 'number', id: 'le-r-secs', min: '0.5', max: '10', step: '0.5', value: cur ? cur.seconds : 2 });
        const mode = h('select', { id: 'le-r-mode' }, Object.entries(MODE_WORDS).map(([v, w]) => h('option', { value: v, selected: cur ? cur.mode === v : v === 'corner' }, w)));
        const fade = h('input', { type: 'number', id: 'le-r-fade', min: '0', max: '1', step: '0.1', value: cur && cur.fade_s !== undefined ? cur.fade_s : 0.2 });
        const save = async () => {
          const op = { op: 'set_rule', phrase: phrase.value, picture: pic.value, seconds: Number(secs.value), mode: mode.value, fade_s: Number(fade.value) };
          if (cur) op.id = cur.id;
          if (await apply(op)) editingRule = null;
          paint();
        };
        rulesPanel.replaceChildren(h('h2', { id: 'le-rules-h' }, 'When a word is said'),
          h('p', { class: 'meta' }, 'Every time the film says the words, the picture shows for a few seconds. Add your pictures in the Ryagram app first.'),
          h('ul', { class: 'le-rule-list' }, rules.length ? rules.map(r => h('li', { class: 'le-item' },
            h('span', { class: 'le-itemtext' }, `"${r.phrase}": ${picName(r.picture)}, ${r.seconds} s, ${MODE_WORDS[r.mode] || r.mode}`),
            h('span', { class: 'le-mv' }, btn('Edit', 'secondary', () => { editingRule = r.id; paint(); }, { 'aria-label': `Edit the rule for ${r.phrase}` }),
              btn('Remove', 'secondary', async () => { await apply({ op: 'delete_rule', id: r.id }); if (editingRule === r.id) editingRule = null; paint(); }, { 'aria-label': `Remove the rule for ${r.phrase}` })))) : [h('li', { class: 'meta' }, 'No rules yet.')]),
          pics.length ? h('div', { class: 'le-rule-form', role: 'group', 'aria-label': cur ? 'Change this rule' : 'Add a rule' },
            field('le-r-phrase', 'When this is said', phrase), field('le-r-pic', 'Show this picture', pic), field('le-r-secs', 'For (seconds)', secs), field('le-r-mode', 'Where', mode), field('le-r-fade', 'Fade (seconds)', fade),
            h('div', { class: 'le-actions' }, btn(cur ? 'Save this rule' : 'Add this rule', 'primary', save), cur ? btn('Cancel', 'secondary', () => { editingRule = null; paint(); }) : null))
            : h('p', { class: 'meta' }, 'You have no pictures yet. Add one in the Ryagram app, then it appears here.'));
      }
      const FILM_LOOK_ROWS = [['theme', 'Page and text'], ['text_color', 'Text colour'], ['box_color', 'Text box colour'], ['box_opacity', 'Text box strength'], ['letterbox', 'Bars around the picture']];
      function paintFilmLook() {
        const lk = ed.state.look || {};
        filmLookPanel.hidden = isData || !FILM_LOOK_ROWS.some(([k]) => k in lk);
        if (filmLookPanel.hidden) return;
        const set = (key, value) => apply({ op: 'set_film_look', key, value });
        const colour = (key, label) => { const i = h('input', { type: 'color', id: `le-fl-${key}`, value: /^#[0-9a-fA-F]{6}$/.test(lk[key]) ? lk[key] : '#000000', 'aria-label': label, disabled: locked }); i.addEventListener('change', () => set(key, i.value)); return field(i.id, label, i); };
        const theme = h('select', { id: 'le-fl-theme', disabled: locked }, [['dark', 'Dark'], ['light', 'Light']].map(([v, w]) => h('option', { value: v, selected: lk.theme === v }, w)));
        theme.addEventListener('change', () => set('theme', theme.value));
        const op = h('input', { type: 'number', id: 'le-fl-box_opacity', min: '0', max: '1', step: '0.05', value: Number.isFinite(lk.box_opacity) ? lk.box_opacity : 0.75, disabled: locked });
        op.addEventListener('change', () => set('box_opacity', Number(op.value)));
        filmLookPanel.replaceChildren(h('h2', { id: 'le-flook-h' }, 'Look of the film'),
          field('le-fl-theme', 'Page and text', theme), colour('text_color', 'Text colour'), colour('box_color', 'Text box colour'), field('le-fl-box_opacity', 'Text box strength (0 to 1)', op), colour('letterbox', 'Bars around the picture'),
          h('p', { class: 'le-free' }, 'These settings change how every text and card in the film looks. Free, like everything here.'));
      }
      const list = h('div', { class: 'le-list', role: 'group', 'aria-label': 'Clips' });
      const clipPanel = h('section', { class: 'le-panel', 'aria-labelledby': 'le-clip-h' });
      const head = h('span', { class: 'le-head', 'aria-hidden': 'true' });
      function paintHead() { if (!isData) head.style.left = `${Math.min(100, (position / Math.max(1, ed.state.duration)) * 100)}%`; }
      const pct = t => `${(t / Math.max(1, ed.state.duration)) * 100}%`;
      async function apply(op) {
        stopPlay();
        if (locked) { say('A render is using what you committed. Cancel it to edit.'); return false; }
        const r = draft ? await draft.send([op]) : ed.do(op);                    // with a draft the server decides first; the screen follows only an accepted change
        if (r.ok) saved = false;
        say(r.ok ? '' : r.reason);
        paint();
        return r.ok;
      }
      async function applyMany(ops) {                                           // a preset: several look ops, each checked; with a draft they travel as one batch
        stopPlay();
        if (locked) { say('A render is using what you committed. Cancel it to edit.'); return false; }
        let ok = true, why = '';
        if (draft) { const r = await draft.send(ops); ok = r.ok; why = r.reason; }
        else for (const op of ops) { const r = ed.do(op); if (!r.ok) { ok = false; why = r.reason; break; } }
        if (ok) saved = false;
        say(ok ? '' : why);
        paint();
        return ok;
      }
      let refocus = null;                                                       // a keyboard edit rebuilds the lanes: focus goes back to the clip that was edited
      function keyOn(c) {
        return ev => {
          const step = ev.altKey ? 1 : 0.1, k = ev.key;
          if (k === 'Delete' || k === 'Backspace') { ev.preventDefault(); apply({ op: 'delete_clip', id: c.id }); return; }
          if (k === 'ArrowLeft' || k === 'ArrowRight') refocus = c.id;
          if (k !== 'ArrowLeft' && k !== 'ArrowRight') return;
          ev.preventDefault();
          const dir = k === 'ArrowRight' ? 1 : -1, vids = ed.state.clips.filter(x => x.track === 'video');
          if (ev.shiftKey) apply({ op: 'trim_clip', id: c.id, edge: 'end', to: Math.round((c.start + c.len + dir * step) * 10) / 10 });
          else if (c.track === 'video') apply({ op: 'reorder_clip', id: c.id, index: Math.max(0, Math.min(vids.length - 1, vids.indexOf(c) + dir)) });
          else apply({ op: 'move_clip', id: c.id, start: Math.max(0, Math.round((c.start + dir * step) * 10) / 10) });
        };
      }
      // Dragging: one op per drag, on release. A picture, text or music clip moves in time (snapping); a video clip is reordered by where it lands.
      function dragOn(el, c, bar) {
        el.addEventListener('pointerdown', ev => {
          if (ev.button !== 0) return;
          const grab = ev.target.dataset && ev.target.dataset.edge ? 'trim' : 'move', box = bar.getBoundingClientRect(), x0 = ev.clientX;
          selected = c.id; el.setPointerCapture(ev.pointerId); let moved = false, to = null;
          const secs = px => (px / box.width) * ed.state.duration;
          const mv = e2 => {
            moved = true;
            if (grab === 'trim') { to = Math.round((c.start + c.len + secs(e2.clientX - x0)) * 10) / 10; el.style.width = pct(Math.max(E.MIN_LEN, to - c.start)); }
            else if (c.track !== 'video') { to = E.snap(ed.state, c.id, c.start + secs(e2.clientX - x0), { playhead: position }); el.style.left = pct(to); }
            else { to = Math.max(0, Math.min(ed.state.clips.filter(x => x.track === 'video').length - 1, Math.round(((e2.clientX - box.left) / box.width * ed.state.duration - c.len / 2) / Math.max(0.5, c.len)))); }
          };
          const up = () => {
            el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
            if (!moved || to === null) { paint(); return; }
            if (grab === 'trim') apply({ op: 'trim_clip', id: c.id, edge: 'end', to });
            else if (c.track !== 'video') apply({ op: 'move_clip', id: c.id, start: to });
            else apply({ op: 'reorder_clip', id: c.id, index: to });
          };
          el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
        });
      }
      function paintLanes() {
        const touched = new Set(ed.aiTouched());
        lanes.replaceChildren(...E.TRACKS.map(track => {
          const bar = h('div', { class: 'le-bar' });
          if (!open(track)) return h('div', { class: 'le-lane' }, h('b', {}, TRACK_NAMES[track]), h('div', { class: 'le-bar le-off' }, h('span', { class: 'meta' }, 'Not available yet')));
          for (const c of ed.state.clips.filter(x => x.track === track)) {
            const el = h('button', { type: 'button', class: `le-clip le-c-${track}${selected === c.id ? ' le-sel' : ''}`, 'data-id': c.id,
              'aria-label': `${TRACK_NAMES[track]} clip ${c.label}${E.isMarked(ed.base, c) ? ', altered by an AI tool' : ''}, starts ${mmss(c.start)}, ${c.len} seconds. Arrow keys move it, Shift and arrows trim it, Delete removes it.` }, c.label + (touched.has('clip:' + c.id) ? ' · AI' : '') + (E.isMarked(ed.base, c) ? ' · AI-altered' : ''),
              h('span', { class: 'le-edge', 'data-edge': 'end', 'aria-hidden': 'true' }));
            el.style.left = pct(c.start); el.style.width = pct(c.len);
            el.addEventListener('click', () => { selected = c.id; refocus = c.id; paint(); });
            el.addEventListener('keydown', keyOn(c));
            el.addEventListener('focus', () => { if (selected === c.id) return; selected = c.id; for (const o of lanes.querySelectorAll('.le-clip')) o.classList.toggle('le-sel', o.dataset.id === c.id); paintClipPanel(); });
            dragOn(el, c, bar);
            bar.append(el);
          }
          if (track === 'video') bar.append(head);
          return h('div', { class: 'le-lane' }, h('b', {}, TRACK_NAMES[track]), bar);
        }));
      }
      function paintList() {
        const touched = new Set(ed.aiTouched());
        list.replaceChildren(...ed.state.clips.filter(c => open(c.track)).map(c => {
          const vids = ed.state.clips.filter(x => x.track === 'video'), i = vids.indexOf(c);
          const moves = c.track === 'video'
            ? [btn('Up', 'secondary', () => apply({ op: 'reorder_clip', id: c.id, index: i - 1 }), { 'aria-label': `Move ${c.label} earlier`, disabled: i === 0 }),
               btn('Down', 'secondary', () => apply({ op: 'reorder_clip', id: c.id, index: i + 1 }), { 'aria-label': `Move ${c.label} later`, disabled: i === vids.length - 1 })]
            : [btn('Earlier', 'secondary', () => apply({ op: 'move_clip', id: c.id, start: Math.max(0, Math.round((c.start - 0.1) * 10) / 10) }), { 'aria-label': `Start ${c.label} earlier` }),
               btn('Later', 'secondary', () => apply({ op: 'move_clip', id: c.id, start: Math.round((c.start + 0.1) * 10) / 10 }), { 'aria-label': `Start ${c.label} later` })];
          return h('div', { class: `le-item le-c-${c.track}${selected === c.id ? ' le-sel' : ''}` },
            h('span', { class: 'le-dot', 'aria-hidden': 'true' }),
            h('button', { type: 'button', class: 'le-itemtext', onclick: () => { selected = c.id; paint(); } }, `${TRACK_NAMES[c.track]}: ${c.label} · ${mmss(c.start)} · ${c.len} s${touched.has('clip:' + c.id) ? ' · by your AI' : ''}${E.isMarked(ed.base, c) ? ' · AI-altered' : ''}`),
            h('span', { class: 'le-mv' }, moves,
              btn('Shorter', 'secondary', () => apply({ op: 'trim_clip', id: c.id, edge: 'end', to: Math.round((c.start + c.len - 0.1) * 10) / 10 }), { 'aria-label': `Make ${c.label} shorter` }),
              btn('Longer', 'secondary', () => apply({ op: 'trim_clip', id: c.id, edge: 'end', to: Math.round((c.start + c.len + 0.1) * 10) / 10 }), { 'aria-label': `Make ${c.label} longer` })));
        }));
      }
      function paintClipPanel() {
        const c = ed.state.clips.find(x => x.id === selected);
        if (!c) { clipPanel.replaceChildren(h('h2', { id: 'le-clip-h' }, 'Clip'), h('p', { class: 'meta' }, 'Pick a clip to change it here.')); return; }
        const num = (id, label, value, onchange, dis) => { const i = h('input', { type: 'number', id, step: '0.1', min: '0', value, disabled: dis }); i.addEventListener('change', () => onchange(Number(i.value))); return h('div', { class: 'le-row' }, h('label', { for: id }, label), i); };
        const rows = [num('le-start', 'Starts (seconds)', c.start, v => apply({ op: 'move_clip', id: c.id, start: v }), c.track === 'video'),
                      num('le-len', 'Length (seconds)', c.len, v => apply({ op: 'trim_clip', id: c.id, edge: 'end', to: Math.round((c.start + v) * 10) / 10 }))];
        if (c.track === 'text' || (c.track === 'video' && c.slide === true && !c.picture)) { const t = h('input', { type: 'text', id: 'le-text', maxlength: (ed.state.limits && ed.state.limits.text_chars) || 200, value: c.text || '' }); t.addEventListener('change', () => apply({ op: 'set_clip_text', id: c.id, text: t.value })); rows.push(h('div', { class: 'le-row' }, h('label', { for: 'le-text' }, 'Text'), t)); }

        if (c.track === 'music') {
          const mnum = (key, label, lo, hi, step) => { const i = h('input', { type: 'number', id: `le-m-${key}`, min: String(lo), max: String(hi), step: String(step), value: Number.isFinite(c[key]) ? c[key] : 0 }); i.addEventListener('change', () => apply({ op: 'set_music', [key]: Number(i.value) })); return h('div', { class: 'le-row' }, h('label', { for: i.id }, label), i); };
          const snap = h('input', { type: 'checkbox', id: 'le-m-snap', checked: c.snap === true }); snap.addEventListener('change', () => apply({ op: 'set_music', snap: snap.checked }));
          rows.push(mnum('level_db', 'Loudness (dB, -30 to 6)', -30, 6, 1), mnum('fade_in_s', 'Fade in (seconds)', 0, 5, 0.5), mnum('fade_out_s', 'Fade out (seconds)', 0, 5, 0.5), mnum('source_start', 'Start this far into the song (seconds)', 0, 86400, 1),
            h('div', { class: 'le-row' }, h('label', { for: 'le-m-snap' }, 'Cut on the beat'), snap));
        }
        if (c.track === 'text' || (c.track === 'video' && c.slide === true && !c.picture)) {
          const st = h('select', { id: 'le-style', 'aria-label': 'Text style' }, [h('option', { value: '', selected: !c.style, disabled: true }, c.style ? 'Style' : 'Position as before')].concat(
            [['title', 'Title (top)'], ['caption', 'Caption (bottom)'], ['lower_third', 'Lower third']].map(([v, w]) => h('option', { value: v, selected: c.style === v }, w))));
          st.addEventListener('change', () => { if (st.value) apply({ op: 'set_clip_style', id: c.id, style: st.value }); });
          rows.push(h('div', { class: 'le-row' }, h('label', { for: 'le-style' }, 'Text style'), st));
        }
        clipPanel.replaceChildren(h('h2', { id: 'le-clip-h' }, `${TRACK_NAMES[c.track]}: ${c.label}`), ...rows,
          btn('Remove this clip', 'secondary', () => { selected = null; apply({ op: 'delete_clip', id: c.id }); }),
          h('p', { class: 'le-free' }, 'Your videos never leave your computer. This page edits the list; your computer draws it.'));
      }

      function paintBanner() {
        const n = ed.log.filter(e => e.by === 'ai').length;
        banner.hidden = n === 0;
        if (n) banner.replaceChildren(h('span', {}, h('b', {}, `Your AI changed ${n} thing${n === 1 ? '' : 's'}.`), ' They are marked below.'), ...(isData && DD.describeOps && aiSaid.length ? [h('ul', { class: 'le-ai-list' }, DD.describeOps(aiSaid).map(t => h('li', {}, t)))] : []), btn('Undo my AI’s changes', 'secondary', async () => { if (draft) await draft.undoAi(); else ed.undoAi(); saved = false; say('Your AI’s changes are undone.'); paint(); }));
      }
      function paintWarns() {
        const out = [];
        if (layoutProblem) out.push(layoutProblem);
        if (bundleMode) { if (bundleState === 'ready') out.push(...DD.warnings(bundle, ed.state.look)); }
        else if (isData) {
          const lk = ed.state.look;
          if (lk['network.color'].toLowerCase() === lk['page.background'].toLowerCase()) out.push('The lines are the same colour as the page, so you cannot see them. You can still render; the final checks decide if it is publishable.');
          if (lk['state.fill'].toLowerCase() === lk['page.background'].toLowerCase()) out.push('The land is the same colour as the page.');
        } else {
          for (const c of ed.state.clips) if (c.track === 'text' && c.text && ed.state.clips.some(v => v.track === 'video' && v.start < c.start + c.len && c.start < v.start + v.len) === false) out.push(`The text "${c.text}" is not over any video clip.`);
        }
        warns.replaceChildren(...out.map(t => h('p', { class: 'le-warn', role: 'status' }, t)));
      }

      function paint() {
        pill.textContent = onPc ? 'Kept on this computer' : saved ? 'Saved' : 'Draft, not saved';
        if (onPc) { saveBtn.hidden = true; revertBtn.hidden = true; }                // the maker keeps every change as it happens: there is nothing to save or revert to
        const empty = onPc && !isData && !ed.state.clips.length;
        emptyNote.hidden = !empty;
        if (!isData && position > ed.state.duration) position = Math.max(0, ed.state.duration);   // never 0:04.4 of 0:01.1
        undoBtn.disabled = locked || ed.log.length === 0; revertBtn.disabled = locked || (ed.log.length === 0 && saved); finalBtn.disabled = locked; saveBtn.disabled = locked;
        if (bundleMode) { range.min = '0'; range.max = String(tl ? tl.frames - 1 : 0); range.step = '1'; range.value = String(tl ? tl.frame(position) : 0); range.disabled = !tl; playBtn.disabled = !tl; if (bundleState === 'ready') paintLook(); }
        else if (isData) { range.min = String(FIRST); range.max = String(LAST); range.step = '1'; range.value = String(Math.round(position)); paintLook(); }
        else { range.min = '0'; range.max = String(Math.round(ed.state.duration * 10)); range.step = '1'; range.value = String(Math.round(position * 10)); paintLanes(); paintList(); paintClipPanel(); paintRules(); paintFilmLook(); }
        paintBanner(); paintWarns(); paintAiLinks(); setPos(position);
        if (refocus) { const el = [...lanes.querySelectorAll('.le-clip')].find(e => e.dataset.id === refocus); refocus = null; if (el) el.focus(); }
      }

      const title = h('h1', { tabindex: '-1' }, host ? String(host.title || 'Edit your film').slice(0, 80) : isData ? 'Edit your film: obesity and fast food' : 'Edit your film: housing montage');
      const emptyNote = h('p', { class: 'le-warn', role: 'status', hidden: true }, 'There is no film to edit yet. In the Ryagram app, choose your clips and press Plan, then open this page again.');
      const root = h('div', { class: 'le' },
        host ? null : h('p', {}, h('a', { href: '#/' }, '← All projects')),
        h('div', { class: 'le-top' }, title, pill, undoBtn, revertBtn, aiBtn, saveBtn, finalBtn),
        status, emptyNote, aiBox, banner, renderBox,
        h('div', { class: 'le-cols' },
          h('div', { class: 'le-main' }, view, scrub, ticks, warns, isData ? null : [lanes, list]),
          isData ? lookPanel : h('div', { class: 'le-side' }, clipPanel, filmLookPanel, rulesPanel)),
        mockAi ? h('p', { class: 'meta' }, mockAi) : null,
        host ? h('p', { class: 'meta' }, 'Everything here is drawn and kept on your computer. Nothing uses credits until you press the final button.') : h('p', { class: 'meta' }, bundleMode ? 'The picture is drawn by the engine’s own drawer from a made-up sample film; nothing here is stored or sent, and nothing uses credits. ' : 'Stand-in preview for the design; nothing here is stored or sent, and nothing uses credits. ', h('a', { href: isData ? '#/editor/compilation' : '#/editor/data' }, isData ? 'See the compilation editor' : 'See the data film editor')));
      paint();
      if (bundleMode) {                                                         // fetch the film's drawing data once; the page stays usable (the title, Ask my AI) while it opens
        const problem = t => { bundleState = 'failed'; bundleNote = t; paint(); };
        Promise.resolve().then(() => lookLoader(project)).then(b => {
          if (b && b.stream && typeof b.stream.next === 'function') {            // a STREAMED film: the head opens the page at once, the chunks fill the periods in as they arrive
            const bad = DD.streamProblem(b.stream.head);
            if (bad) { problem(bad); return; }
            bundle = RL.progressive(b.stream.head); tl = DD.timeline(RL, bundle); bundleState = 'ready'; streamLeft = bundle.periods.length; position = 0;
            ticks.replaceChildren(...tl.ticks.map(m => { const t = h('span', {}, String(m.period)); t.style.left = `${m.at * 100}%`; return t; }));
            paint();
            (async () => {
              try { for (;;) { const n = await b.stream.next(); if (!n) break; RL.addPeriod(bundle, n.period, n.chunk); streamLeft = Math.max(0, streamLeft - 1); paint(); } streamLeft = 0; }
              catch { streamLeft = 0; streamNote = 'Some of the film could not be loaded, so parts of the preview stay blank. Try again in a minute.'; }
              paint();
            })();
            return;
          }
          const why = DD.bundleProblem(b);
          if (why) { problem(why); return; }
          bundle = b; tl = DD.timeline(RL, b); bundleState = 'ready';
          position = tl.seconds(tl.frames - 1);                                 // open on the last period: the film's finished picture
          ticks.replaceChildren(...tl.ticks.map(m => { const t = h('span', {}, String(m.period)); t.style.left = `${m.at * 100}%`; return t; }));
          paint();
        }).catch(() => problem('The film\u2019s drawing data could not be opened. Try again in a minute.'));
      }
      if (draft) {                                                              // read the draft, then look for the AI's changes every two seconds while this page is open and visible
        draft.open().then(r => { if (!r.ok) say(r.reason); paint(); });
        const pollTimer = setInterval(async () => { if (document.hidden || locked) return; const r = await draft.poll(); if (r.ok && (r.applied.length || r.skipped.length)) { saved = false; paint(); } }, 2000);
        const beat = setInterval(() => { if (!document.hidden) draft.heartbeat(); }, 15000);
        onStop(() => { clearInterval(pollTimer); clearInterval(beat); });
      }
      return root;
    }
    return { editorView };
  }

  window.ryagramEditorPage = { create, YEARS, LOOK_ROWS, WAITING, DATA_BASE, CLIPS_BASE };
})();
