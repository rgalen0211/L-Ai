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
    { id: 'v3', track: 'video', start: 4, len: 3, label: 'great news for the weekend' }, { id: 'v4', track: 'video', start: 7, len: 2.5, label: 'great news again' },
    { id: 'v5', track: 'video', start: 9.5, len: 2.5, label: 'nobody saw that coming' },
    { id: 'p1', track: 'pictures', start: 1.5, len: 2, label: 'house price' }, { id: 'p2', track: 'pictures', start: 6.2, len: 2.2, label: 'rent chart' },
    { id: 't1', track: 'text', start: 0.2, len: 3.5, label: 'Title', text: 'Housing, 2019 to 2024' }, { id: 't2', track: 'text', start: 9, len: 3, label: 'Thanks', text: 'Thanks for watching' },
    { id: 'm1', track: 'music', start: 0, len: 12, label: 'your music file (stays on your computer)' }] });
  const TRACK_NAMES = { video: 'Video', pictures: 'Pictures', text: 'Text', music: 'Music' };

  function create({ h }) {
    const btn = (label, cls, onclick, attrs = {}) => h('button', { type: 'button', class: `button ${cls || 'secondary'}`.trim(), onclick, ...attrs }, label);

    function editorView(kind, onStop) {
      const isData = kind === 'data';
      const ed = new E.Editor(isData ? DATA_BASE() : CLIPS_BASE());
      let position = isData ? LAST : 4.4;                                       // a year, or a time in seconds
      let selected = isData ? null : 'v3';
      let preview = null;                                                       // a colour being dragged in a chooser: shown, not yet an op
      let saved = true, message = '';
      const status = h('p', { class: 'form-note', role: 'status' });
      const say = t => { message = t; status.textContent = t; };

      // ---- the preview: a stand-in drawing (ENGINE 35's drawer replaces it); it redraws from the state at once
      const view = h('div', { class: 'le-view', role: 'img' });
      function drawData() {
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

      // ---- the scrubber: a real range input (keyboard and screen reader for free)
      const range = h('input', { type: 'range', class: 'le-range', id: 'le-range', 'aria-label': isData ? 'Year' : 'Time in the film' });
      const posText = h('b', { class: 'le-pos' });
      const setPos = v => { position = v; paintPreview(); posText.textContent = isData ? String(Math.round(position)) : `${mmss(position)} / ${mmss(ed.state.duration)}`;
        range.setAttribute('aria-valuetext', isData ? `Year ${Math.round(position)}` : `${mmss(position)} of ${mmss(ed.state.duration)}`); paintHead(); };
      const paintPreview = () => (isData ? drawData() : drawClips());
      range.addEventListener('input', () => setPos(isData ? Number(range.value) : Number(range.value) / 10));
      const playBtn = btn('Play', 'secondary', () => {
        if (timer) { stopPlay(); return; }
        playBtn.textContent = 'Pause';
        timer = setInterval(() => { const step = isData ? 0.25 : 0.1, max = isData ? LAST : ed.state.duration; if (position + step > max) { setPos(isData ? FIRST : 0); } else setPos(position + step); range.value = String(isData ? position : Math.round(position * 10)); }, isData ? 60 : 100);
      });
      let timer = null;
      const stopPlay = () => { if (timer) clearInterval(timer); timer = null; playBtn.textContent = 'Play'; };
      onStop(stopPlay);
      const scrub = h('div', { class: 'le-scrub' }, playBtn, range, posText);
      const ticks = isData ? h('div', { class: 'le-ticks', 'aria-hidden': 'true' }, YEARS.map(y => h('span', {}, String(y)))) : null;

      // ---- the controls
      const pill = h('span', { class: 'le-pill' });
      const undoBtn = btn('Undo', 'secondary', () => { stopPlay(); ed.undo(); saved = false; say('Undone.'); paint(); });
      const revertBtn = btn('Revert', 'secondary', () => { ed.revert(); saved = true; say('Back to the last save.'); paint(); });
      const saveBtn = btn('Save', 'secondary', () => { ed.base = ed.state; ed.log = []; ed.redo = []; saved = true; say('Saved as this film’s working version (mock: nothing is stored yet).'); paint(); });
      const aiBtn = btn('Ask my AI', 'secondary', () => { aiBox.hidden = !aiBox.hidden; if (!aiBox.hidden) note.focus(); }, { class: 'button secondary le-ai-btn' });
      const finalBtn = btn(isData ? 'Render final film' : 'Build final film', 'primary', () => { stopPlay(); showCommit(); });
      const renderBox = h('div', { class: 'le-render', hidden: true });
      let locked = false;                                                       // locked: a render is using what was committed
      // What will render, in words (the look values or the clip list), then Start. Starting commits the draft (today's save and checks), then starts the job.
      function committedWords() {
        if (isData) return ['The look you can see:', ...LOOK_ROWS.map(([k, l]) => `${l} ${ed.state.look[k]}`)];
        const vids = ed.state.clips.filter(c => c.track === 'video');
        return [`${vids.length} video clips in this order: ${vids.map(c => c.label).join(', ')}.`, `${ed.state.clips.length - vids.length} pictures, text lines and music tracks, ${mmss(ed.state.duration)} long.`];
      }
      const closeRender = () => { renderBox.hidden = true; renderBox.replaceChildren(); };
      function showCommit() {
        renderBox.hidden = false;
        renderBox.replaceChildren(h('h2', {}, 'What will render'), h('p', { class: 'meta' }, 'This exact draft is what the final film is made from. Nothing is added and nothing is dropped.'),
          h('ul', {}, committedWords().map(t => h('li', {}, t))),
          h('div', { class: 'le-actions' }, btn('Start the render', 'primary', startJob), btn('Not yet', 'secondary', closeRender)));
        renderBox.querySelector('button').focus();
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
        const cancel = btn('Cancel', 'secondary', () => end('cancelled'));
        const mock = window.ryagramMock ? h('p', { class: 'meta' }, btn('(mock) go quiet for 3 minutes', 'secondary', () => { skew += 180000; frozen = true; tick(); })) : null;
        renderBox.hidden = false;
        renderBox.replaceChildren(h('h2', {}, isData ? 'Rendering your film' : 'Building your film'), h('p', { class: 'meta' }, 'What you committed is what renders.'), head, bar, eta, then, quiet, h('div', { class: 'le-actions' }, cancel), mock);
        // the fake worker: 2,820 frames over about 9 s, then encoding, then the checks; no time left until it has a rate
        const reading = () => {
          const sec = (Date.now() - t0) / 1000;
          if (sec < 9) return { stage: 'drawing', done: Math.round(2820 * sec / 9), total: 2820, unit: 'frames', eta_s: sec < 1.5 ? null : (9 - sec) * 40, eta_is_a_guess: true, total_is_provisional: false };
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
      const aiLine = () => `I am editing my Ryagram film and want you to change it. My note: ${E.cleanText(note.value) || 'make it clearer'}. Use the Ryagram connector. Read my open editor draft first and change only the draft. Do not render, save or spend credits.`;
      const aiBox = h('div', { class: 'le-ai', hidden: true }, h('label', { for: 'le-note' }, 'What should your AI change?'), note, aiLinks,
        h('p', { class: 'meta' }, 'It opens a new chat in your own Claude or ChatGPT with this ready. Your AI can change the draft you see here; it cannot render, save, publish or spend credits.'));
      const paintAiLinks = () => {
        const S = window.ryagramStart, line = aiLine();
        aiLinks.replaceChildren(...['claude', 'chatgpt'].map(app => { const u = S && S.chatUrl ? S.chatUrl(app, line) : null; return u ? h('a', { class: 'button secondary', href: u, target: '_blank', rel: 'noopener noreferrer' }, S.APPS[app].label) : null; }),
          btn('Copy', 'secondary', async () => { try { await navigator.clipboard.writeText(line); say('Copied. Paste it into your AI.'); } catch { say('Could not copy. Select the note and copy it by hand.'); } }));
      };
      note.addEventListener('input', paintAiLinks);
      const mockAi = window.ryagramMock ? btn('(mock) my AI changes the line colour', 'secondary', () => {
        const r = ed.receive([{ op: 'set_look', key: isData ? 'network.color' : 'network.color', value: '#ff9f6b' }], ed.revision);
        say(r.ok ? '' : r.reason === 'stale' ? 'Your AI changed this just now. Try again.' : r.reason); saved = false; paint();
      }, { class: 'button secondary le-mock' }) : null;

      // ---- the look panel (data films)
      const lookPanel = h('section', { class: 'le-panel', 'aria-labelledby': 'le-look-h' });
      function paintLook() {
        const touched = new Set(ed.aiTouched());
        lookPanel.replaceChildren(h('h2', { id: 'le-look-h' }, 'Look'),
          ...LOOK_ROWS.map(([key, label]) => {
            const input = h('input', { type: 'color', value: ed.state.look[key], id: `le-look-${key}`, 'aria-label': label, disabled: locked });
            input.addEventListener('input', () => { preview = { [key]: input.value }; paintPreview(); });
            input.addEventListener('change', () => { preview = null; const r = ed.do({ op: 'set_look', key, value: input.value }); saved = false; say(r.ok ? '' : r.reason); paint(); });
            return h('div', { class: 'le-row' }, h('label', { for: input.id }, label, touched.has('look:' + key) ? h('span', { class: 'le-aimark' }, ' · by your AI') : null), input);
          }),
          ...WAITING.map(w => h('div', { class: 'le-row le-waiting' }, h('span', {}, w), h('span', { class: 'meta' }, 'waiting for the engine'))),
          h('p', { class: 'le-free' }, 'Free. Nothing here uses credits. Only the final button does.'));
      }

      // ---- the tracks (compilation): lanes on a wide screen, a list on a phone; both from the same state, both make the same ops
      const open = track => !ed.state.lanes || ed.state.lanes.includes(track);          // the lanes the maker can build today (the track summary says); the others are shown, not editable
      const lanes = h('div', { class: 'le-lanes', role: 'group', 'aria-label': 'Tracks' });
      const list = h('div', { class: 'le-list', role: 'group', 'aria-label': 'Clips' });
      const clipPanel = h('section', { class: 'le-panel', 'aria-labelledby': 'le-clip-h' });
      const head = h('span', { class: 'le-head', 'aria-hidden': 'true' });
      function paintHead() { if (!isData) head.style.left = `${Math.min(100, (position / Math.max(1, ed.state.duration)) * 100)}%`; }
      const pct = t => `${(t / Math.max(1, ed.state.duration)) * 100}%`;
      function apply(op) { stopPlay(); if (locked) { say('A render is using what you committed. Cancel it to edit.'); return false; } const r = ed.do(op); if (r.ok) saved = false; say(r.ok ? '' : r.reason); paint(); return r.ok; }
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
              'aria-label': `${TRACK_NAMES[track]} clip ${c.label}, starts ${mmss(c.start)}, ${c.len} seconds. Arrow keys move it, Shift and arrows trim it, Delete removes it.` }, c.label + (touched.has('clip:' + c.id) ? ' · AI' : ''),
              h('span', { class: 'le-edge', 'data-edge': 'end', 'aria-hidden': 'true' }));
            el.style.left = pct(c.start); el.style.width = pct(c.len);
            el.addEventListener('click', () => { selected = c.id; paint(); });
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
            h('button', { type: 'button', class: 'le-itemtext', onclick: () => { selected = c.id; paint(); } }, `${TRACK_NAMES[c.track]}: ${c.label} · ${mmss(c.start)} · ${c.len} s${touched.has('clip:' + c.id) ? ' · by your AI' : ''}`),
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
        if (c.track === 'text') { const t = h('input', { type: 'text', id: 'le-text', maxlength: (ed.state.limits && ed.state.limits.text_chars) || 200, value: c.text || '' }); t.addEventListener('change', () => apply({ op: 'set_clip_text', id: c.id, text: t.value })); rows.push(h('div', { class: 'le-row' }, h('label', { for: 'le-text' }, 'Text'), t)); }
        clipPanel.replaceChildren(h('h2', { id: 'le-clip-h' }, `${TRACK_NAMES[c.track]}: ${c.label}`), ...rows,
          btn('Remove this clip', 'secondary', () => { selected = null; apply({ op: 'delete_clip', id: c.id }); }),
          h('p', { class: 'le-free' }, 'Your videos never leave your computer. This page edits the list; your computer draws it.'));
      }

      function paintBanner() {
        const n = ed.log.filter(e => e.by === 'ai').length;
        banner.hidden = n === 0;
        if (n) banner.replaceChildren(h('span', {}, h('b', {}, `Your AI changed ${n} thing${n === 1 ? '' : 's'}.`), ' They are marked below.'), btn('Undo my AI’s changes', 'secondary', () => { ed.undoAi(); saved = false; say('Your AI’s changes are undone.'); paint(); }));
      }
      function paintWarns() {
        const out = [];
        if (isData) {
          const lk = ed.state.look;
          if (lk['network.color'].toLowerCase() === lk['page.background'].toLowerCase()) out.push('The lines are the same colour as the page, so you cannot see them. You can still render; the final checks decide if it is publishable.');
          if (lk['state.fill'].toLowerCase() === lk['page.background'].toLowerCase()) out.push('The land is the same colour as the page.');
        } else {
          for (const c of ed.state.clips) if (c.track === 'text' && c.text && ed.state.clips.some(v => v.track === 'video' && v.start < c.start + c.len && c.start < v.start + v.len) === false) out.push(`The text "${c.text}" is not over any video clip.`);
        }
        warns.replaceChildren(...out.map(t => h('p', { class: 'le-warn', role: 'status' }, t)));
      }

      function paint() {
        pill.textContent = saved ? 'Saved' : 'Draft, not saved';
        undoBtn.disabled = locked || ed.log.length === 0; revertBtn.disabled = locked || (ed.log.length === 0 && saved); finalBtn.disabled = locked; saveBtn.disabled = locked;
        if (isData) { range.min = String(FIRST); range.max = String(LAST); range.step = '1'; range.value = String(Math.round(position)); paintLook(); }
        else { range.min = '0'; range.max = String(Math.round(ed.state.duration * 10)); range.step = '1'; range.value = String(Math.round(position * 10)); paintLanes(); paintList(); paintClipPanel(); }
        paintBanner(); paintWarns(); paintAiLinks(); setPos(position);
        if (refocus) { const el = [...lanes.querySelectorAll('.le-clip')].find(e => e.dataset.id === refocus); refocus = null; if (el) el.focus(); }
      }

      const title = h('h1', { tabindex: '-1' }, isData ? 'Edit your film: obesity and fast food' : 'Edit your film: housing montage');
      const root = h('div', { class: 'le' },
        h('p', {}, h('a', { href: '#/' }, '← All projects')),
        h('div', { class: 'le-top' }, title, pill, undoBtn, revertBtn, aiBtn, saveBtn, finalBtn),
        status, aiBox, banner, renderBox,
        h('div', { class: 'le-cols' },
          h('div', { class: 'le-main' }, view, scrub, ticks, warns, isData ? null : [lanes, list]),
          isData ? lookPanel : clipPanel),
        mockAi ? h('p', { class: 'meta' }, mockAi) : null,
        h('p', { class: 'meta' }, 'Stand-in preview for the design; nothing here is stored or sent, and nothing uses credits. ', h('a', { href: isData ? '#/editor/compilation' : '#/editor/data' }, isData ? 'See the compilation editor' : 'See the data film editor')));
      paint();
      return root;
    }
    return { editorView };
  }

  window.ryagramEditorPage = { create, YEARS, LOOK_ROWS, WAITING, DATA_BASE, CLIPS_BASE };
})();
