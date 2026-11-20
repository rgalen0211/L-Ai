// PRO mode for the live editor (WEB 11-20, CLAUDE's 06:22 order, paper proposals/WEB-PRO-EDITOR-1120.md): the technical layer a video editor expects, added BESIDE the simple page, never instead of it.
// Everything here is either the page's own tool (zoom, frame step, J K L, markers, safe-area guides: they change nothing in the film) or built from the changes the editor already has (split a text or picture clip = one
// trim_clip + one add_clip, as ONE undo step; the history list only reads the editor's log and uses its own undo). No new change (op), no SQL, no connector tool, no engine field: the person's AI can do every
// film change here with the tools it has (edit_tracks, set_look, undo_my_changes). Nothing here edits a data value.
// The page (assets/app-editor.js) calls mount() once with what PRO needs; with no `ryagramEditorPro` loaded the page is exactly as before. Simple is the default; the choice is kept per account on this device.
(() => {
  const MODE_KEY = 'ryagram.editorMode.';
  const MARK_KEY = 'ryagram.editorMarkers.';
  const ZOOMS = [1, 2, 4, 8];
  const keep = {
    get(k) { try { return window.localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { window.localStorage.setItem(k, v); } catch { /* blocked storage: the choice lasts until the page closes */ } }
  };
  const r1 = n => Math.round(n * 10) / 10;
  const mmss = t => { t = Math.max(0, t); return `${Math.floor(t / 60)}:${(Math.floor(t % 60) + '').padStart(2, '0')}.${Math.floor((t * 10) % 10)}`; };
  // 0:07.4 and, when the picture has real frames, the frame number: "0:07.4 · frame 178".
  function timecode(seconds, fps) { seconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0; return fps && fps > 10 ? `${mmss(seconds)} · frame ${Math.round(seconds * fps)}` : mmss(seconds); }
  // The look keys in plain words (a person reads the history list, not the story's own key names); a key with no plain name is shown as 'a look setting'.
  const KEY_WORDS = { 'network.color': 'line colour', 'network.base_color': 'base lines colour', 'network.context_color': 'background lines colour', 'state.fill': 'land colour', 'page.background': 'page colour',
    'choropleth.low': 'low colour', 'choropleth.high': 'high colour', 'state.outline_width': 'border width', 'sequence.theme': 'theme' };
  const keyWords = k => (KEY_WORDS[k] ? `the ${KEY_WORDS[k]}` : 'a look setting');
  // One plain sentence for a change in the history list. Values are shown as given (they were checked when they were made).
  function describe(op) {
    const a = op || {};
    switch (a.op) {
      case 'set_look': return `Set ${keyWords(a.key)} to ${a.value}`;
      case 'unset_look': return `Put ${keyWords(a.key)} back to the film’s own`;
      case 'set_film_look': return `Set the film’s ${a.key} to ${a.value}`;
      case 'move_clip': return `Moved clip ${a.id} to ${r1(a.start)} s`;
      case 'trim_clip': return `Trimmed the ${a.edge} of clip ${a.id} to ${r1(a.to)} s`;
      case 'reorder_clip': return `Moved clip ${a.id} to place ${Number(a.index) + 1}`;
      case 'set_clip_text': return `Changed the text of clip ${a.id}`;
      case 'set_clip_style': return `Made clip ${a.id} a ${String(a.style).replace('_', ' ')}`;
      case 'delete_clip': return `Deleted clip ${a.id}`;
      case 'add_clip': return `Added a ${a.track === 'text' ? 'text line' : 'picture'} at ${r1(a.start)} s`;
      case 'set_music': return 'Changed the music';
      case 'set_rule': return `Set the picture rule for “${String(a.phrase || '').slice(0, 30)}”`;
      case 'delete_rule': return 'Removed a picture rule';
      default: return 'A change';
    }
  }

  function mount(c) {
    const { h, root, ed } = c;
    const btn = (label, onclick, attrs = {}) => h('button', { type: 'button', class: 'button secondary small', onclick, ...attrs }, label);
    let pro = false, zoom = 0, rate = 0, shuttle = 0, safeOn = false, markers = [];
    const markKey = MARK_KEY + (c.project || 'none');
    try { const m = JSON.parse(keep.get(markKey) || '[]'); if (Array.isArray(m)) markers = m.filter(x => Number.isFinite(x) && x >= 0).slice(0, 200); } catch { markers = []; }
    const t = () => (typeof c.transport === 'function' ? c.transport() : null);
    const total = () => { const x = t(); return x ? x.total() : (ed.state.duration || 0); };

    // ---- the Simple | Pro switch
    const simpleB = h('button', { type: 'button', class: 'le-pro-seg on', 'aria-pressed': 'true', onclick: () => setMode(false, true) }, 'Simple');
    const proB = h('button', { type: 'button', class: 'le-pro-seg', 'aria-pressed': 'false', onclick: () => setMode(true, true) }, 'Pro');
    const modeSwitch = h('span', { class: 'le-pro-switch', role: 'group', 'aria-label': 'Editor mode' }, simpleB, proB);
    let modeKey = MODE_KEY + 'device';

    // ---- the tool bar
    const tc = h('b', { class: 'le-pro-tc', 'aria-label': 'Time and frame' }, '0:00.0');                    // not a live region: it changes five times a second during play and a screen reader would read every change
    const note = h('p', { class: 'meta le-pro-note' }, '');
    const zoomLabel = h('span', { class: 'meta le-pro-zoomlabel' }, 'Zoom 1×');
    const markStrip = h('div', { class: 'le-pro-marks', 'aria-label': 'Your markers' });
    const bar = h('section', { class: 'le-pro', 'aria-label': 'Pro tools', hidden: true },
      h('div', { class: 'le-pro-row' },
        btn('◀ Frame', () => step(-1), { 'aria-label': 'Back one frame' }), btn('Frame ▶', () => step(1), { 'aria-label': 'Forward one frame' }),
        btn('J', () => shuttleKey(-1), { 'aria-label': 'Shuttle backwards (J, again for faster)' }), btn('K', () => shuttleKey(0), { 'aria-label': 'Stop (K)' }), btn('L', () => shuttleKey(1), { 'aria-label': 'Shuttle forwards (L, again for faster)' }),
        tc,
        btn('Marker (M)', () => addMarker(), { 'aria-label': 'Put a marker at the playhead' }),
        btn('◀ Marker', () => jump(-1), { 'aria-label': 'Previous marker' }), btn('Marker ▶', () => jump(1), { 'aria-label': 'Next marker' }),
        btn('Safe areas', () => { safeOn = !safeOn; paintSafe(); }, { id: 'le-pro-safe', 'aria-pressed': 'false' }),
        ...(c.isData ? [] : [btn('Zoom −', () => setZoom(zoom - 1), { 'aria-label': 'Zoom the timeline out' }), btn('Zoom +', () => setZoom(zoom + 1), { 'aria-label': 'Zoom the timeline in' }), zoomLabel]),       // a data film has no lanes to zoom: its strip and ruler are the film's own
        c.isData ? null : btn('Split at playhead (S)', () => split(), { id: 'le-pro-split' })),
      markStrip, note);

    // ---- history and the engine rows
    const histList = h('ol', { class: 'le-pro-hist' });
    const panel = h('section', { class: 'le-pro le-pro-side', 'aria-labelledby': 'le-pro-hist-h', hidden: true },
      h('h2', { id: 'le-pro-hist-h' }, 'History'),
      h('p', { class: 'meta' }, 'Every change on this page, newest last, and who made it. Undo goes back through them.'),
      histList,
      h('h2', {}, 'Output'),
      h('p', { class: 'meta' }, 'Shape, size and frame rate are set when the film is made. The engine offers 16:9 and 9:16, 1080p or 720p, and 24, 25 or 30 frames a second.'),
      h('h2', {}, 'Not possible yet'),
      h('ul', { class: 'meta le-pro-needs' }, ['Camera zoom and pan over time', 'Keyframes for colours', 'Changing the speed of a clip', 'A square (1:1) film', 'Ducking the music under a voice'].map(x => h('li', {}, `${x}: needs the engine`))));

    // ---- helpers over the page
    function setMode(on, remember) {
      pro = !!on;
      root.classList.toggle('le-is-pro', pro);
      bar.hidden = !pro; panel.hidden = !pro;
      simpleB.classList.toggle('on', !pro); proB.classList.toggle('on', pro);
      simpleB.setAttribute('aria-pressed', String(!pro)); proB.setAttribute('aria-pressed', String(pro));
      if (!pro) { stopShuttle(); setZoom(0); safeOn = false; }
      paintSafe(); refresh();
      if (remember) keep.set(modeKey, pro ? 'pro' : 'simple');
    }
    function views() {
      const a = [root.querySelector('.le-view')];
      const f = c.filmEl ? c.filmEl() : null;
      if (f) a.push(f.querySelector('.le-film-view'));
      return a.filter(Boolean);
    }
    function paintSafe() {
      for (const v of views()) v.classList.toggle('le-pro-safe', pro && safeOn);
      const b = bar.querySelector('#le-pro-safe'); if (b) b.setAttribute('aria-pressed', String(pro && safeOn));
    }
    function setZoom(n) {
      zoom = Math.max(0, Math.min(ZOOMS.length - 1, n));
      root.style.setProperty('--le-zoom', String(ZOOMS[zoom]));
      root.classList.toggle('le-zoomed', zoom > 0);
      zoomLabel.textContent = `Zoom ${ZOOMS[zoom]}×`;
    }
    function seek(s) { const x = t(); if (!x) return false; c.stopPlay(); x.seek(Math.max(0, Math.min(x.total(), s))); return true; }
    function step(n) {
      const x = t(); if (!x) { say('There is no picture to step through here yet.'); return; }
      const d = x.fps && x.fps > 10 ? 1 / x.fps : 0.1;
      seek(x.pos() + n * d);
    }
    function say(msg) { note.textContent = msg || ''; }
    function stopShuttle() { if (shuttle) clearInterval(shuttle); shuttle = 0; rate = 0; }
    function shuttleKey(dir) {
      if (!pro) return;
      const x = t(); if (!x) { say('There is no picture to play through here yet.'); return; }
      c.stopPlay();
      if (dir === 0) { stopShuttle(); say(''); return; }
      rate = (rate !== 0 && Math.sign(rate) === dir) ? Math.max(-4, Math.min(4, rate + dir)) : dir;       // again in the same direction goes faster, the other way reverses at normal speed
      say(`${rate > 0 ? 'Forward' : 'Backward'} ${Math.abs(rate)}×. K stops.`);
      if (!shuttle) shuttle = setInterval(() => {
        const y = t(); if (!y) { stopShuttle(); return; }
        const next = y.pos() + rate * 0.1;
        if (next <= 0 || next >= y.total()) { seek(next <= 0 ? 0 : y.total()); stopShuttle(); say(''); return; }
        seek(next);
      }, 100);
    }
    function saveMarks() { keep.set(markKey, JSON.stringify(markers)); }
    function addMarker() {
      const x = t(); const at = r1(x ? x.pos() : 0);
      if (!markers.some(m => Math.abs(m - at) < 0.05)) { markers.push(at); markers.sort((a, b) => a - b); saveMarks(); }
      paintMarks();
    }
    function jump(dir) {
      const x = t(); const now = x ? x.pos() : 0;
      const to = dir > 0 ? markers.find(m => m > now + 0.05) : [...markers].reverse().find(m => m < now - 0.05);
      if (to === undefined) { say(markers.length ? 'No marker that way.' : 'No markers yet. Press M to put one at the playhead.'); return; }
      seek(to);
    }
    function paintMarks() {
      const d = Math.max(0.001, total());
      markStrip.replaceChildren(...markers.map((m, i) => {
        const b = h('button', { type: 'button', class: 'le-pro-mark', 'aria-label': `Marker ${i + 1} at ${mmss(m)}. Press to go there; Delete removes it.`, title: mmss(m) }, String(i + 1));
        b.style.left = `${Math.min(100, (m / d) * 100)}%`;
        b.addEventListener('click', () => seek(m));
        b.addEventListener('keydown', ev => { if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); markers.splice(i, 1); saveMarks(); paintMarks(); } });
        return b;
      }));
      markStrip.hidden = !markers.length;
    }
    // Split the selected text or picture clip at the playhead: shorten it to the playhead and add the rest as a new clip, one undo step. A video clip needs a new change the maker agrees to (paper: SMALL), so it says so.
    async function split() {
      const sel = ed.state.clips.find(k => k.id === (c.selected ? c.selected() : null));
      if (!sel) { say('Pick a text or picture clip first, then put the playhead inside it.'); return; }
      if (sel.track !== 'text' && sel.track !== 'pictures') { say('Splitting a video clip needs a new kind of change that is not built yet. Text and picture clips can be split.'); return; }
      const x = t(); const at = r1(x ? x.pos() : 0);
      const min = sel.track === 'text' ? 0.5 : 0.3;
      if (at < sel.start + min - 1e-9 || at > sel.start + sel.len - min + 1e-9) { say(`Put the playhead inside the clip, at least ${min} s from each end.`); return; }
      const rest = r1(sel.start + sel.len - at);
      const add = sel.track === 'text' ? { op: 'add_clip', track: 'text', start: at, len: rest, text: sel.text || '' } : { op: 'add_clip', track: 'pictures', start: at, len: rest, picture: sel.picture };
      const trim = { op: 'trim_clip', id: sel.id, edge: 'end', to: at };
      const E = window.ryagramEditor, bad = E && typeof E.check === 'function' ? (E.check(ed.state, trim) || E.check(ed.state, add)) : null;      // both are checked BEFORE either is made: a refusal never leaves half a split
      if (bad) { say(bad); return; }
      const ok = await c.applyMany([trim, add], true);
      say(ok ? `Split at ${mmss(at)}. Undo takes it back in one step.` : '');
    }
    async function undoBack(i) {
      for (let guard = 0; guard < 60 && ed.log.length > i; guard += 1) {
        const before = ed.log.length;
        const r = c.draft ? await c.draft.undo() : ed.undo();
        if (r && r.ok === false) { say(r.reason || 'That could not be undone.'); break; }
        if (ed.log.length >= before) { say('That could not be undone.'); break; }
      }
      c.markUnsaved(); c.paint();
    }
    let histSig = null;                                              // null = never painted (an empty history still has to say 'No changes yet.')
    function paintHist() {
      const sig = ed.log.map(e => `${describe(e.op)}|${e.by}`).join('\n') + (c.locked() ? '|locked' : '');
      if (sig === histSig) return;                                      // unchanged: leave the list (and the focus in it) alone
      histSig = sig;
      const items = ed.log.map((e, i) => h('li', { class: e.by === 'ai' ? 'le-pro-ai' : '' },
        h('span', {}, `${describe(e.op)} `), h('span', { class: 'meta' }, e.by === 'ai' ? '· your AI ' : '· you '),
        btn('Undo back to here', () => undoBack(i), { 'aria-label': `Undo step ${i + 1} and everything after it`, disabled: !!c.locked() })));
      histList.replaceChildren(...(items.length ? items : [h('li', { class: 'meta' }, 'No changes yet.')]));
    }
    function refresh() {
      if (!pro) return;
      paintHist(); paintMarks(); paintSafe();
      const x = t(); tc.textContent = x ? timecode(x.pos(), x.fps && x.fps > 10 ? x.fps : 0) : '–';
    }

    // ---- keys (PRO only; never while typing in a field)
    const typing = el => el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !['range', 'button', 'checkbox', 'radio', 'color'].includes(el.type)) || el.isContentEditable);
    const onKey = ev => {
      if (!pro || ev.ctrlKey || ev.metaKey || ev.altKey || typing(ev.target)) return;
      const k = ev.key.toLowerCase();
      if (k === 'j') shuttleKey(-1); else if (k === 'l') shuttleKey(1); else if (k === 'k') shuttleKey(0);
      else if (k === 'm') addMarker(); else if (ev.key === ',' ) step(-1); else if (ev.key === '.') step(1);
      else if (ev.key === '[') jump(-1); else if (ev.key === ']') jump(1);
      else if (k === 's' && !c.isData) split();
      else return;
      ev.preventDefault(); ev.stopPropagation();                      // the slider's own J and L (a tenth of the film) give way in PRO: here they shuttle
    };
    root.addEventListener('keydown', onKey, true);

    // ---- zoom scroll: the ruler follows the lanes
    const lanes = c.lanes, ruler = c.rulerHolder;
    if (lanes && ruler) lanes.addEventListener('scroll', () => { ruler.scrollLeft = lanes.scrollLeft; });

    // ---- place it on the page and start
    const top = root.querySelector('.le-top');
    if (top) top.append(modeSwitch);
    const cols = root.querySelector('.le-cols');
    if (top && top.parentNode) top.parentNode.insertBefore(bar, top.nextSibling);
    if (cols && cols.parentNode) cols.parentNode.insertBefore(panel, cols.nextSibling);
    c.onPaint(refresh);
    const tick = setInterval(() => { if (pro && !document.hidden) { const x = t(); if (x) tc.textContent = timecode(x.pos(), x.fps && x.fps > 10 ? x.fps : 0); } }, 200);
    c.onStop(() => { clearInterval(tick); stopShuttle(); root.removeEventListener('keydown', onKey, true); });
    setZoom(0);
    (async () => {                                                   // the choice is kept per account on this device (no server value yet: paper, SMALL)
      let who = 'device';
      try { if (window.ryagramApp && window.ryagramApp.client) { const s = await window.ryagramApp.client.auth.getSession(); who = (s.data && s.data.session && s.data.session.user && s.data.session.user.id) || 'device'; } } catch { who = 'device'; }
      modeKey = MODE_KEY + who;
      if (keep.get(modeKey) === 'pro') setMode(true, false);
    })();
    return { setMode, refresh, split, step, addMarker, shuttleKey, setZoom, state: () => ({ pro, zoom: ZOOMS[zoom], markers: markers.slice(), safeOn }) };
  }

  window.ryagramEditorPro = Object.freeze({ mount, describe, timecode, ZOOMS });
})();
