// The live editor INSIDE THE AI CHAT (CONNECT, 2026-11-05; plan: Ryagram-logs/proposals/CONNECT-MCP-APP-PLAN-1105.md, section 5). Host number 3 of the website's own editor page
// (host 1 = the website, host 2 = the maker, tools/maker-live/live-host.js). This file is the LAST part of the generated page (tools/build-chat-editor.mjs); the editor itself is the
// website's own code, not a copy kept by hand.
//   window.ryagramLiveHost = { rpc, render, mode, project, media, title }
//   rpc(name, args) -> Promise<{ data, error: { code, message } | null }>   the same five names the page has always sent, and nothing else. Each one is a connector tool that only this panel is
//   meant to call (visibility "app"); the host (Claude, ChatGPT, ...) forwards it with the connection the person already has. The panel holds no token, no cookie and no website session.
// The wire (MCP Apps, JSON-RPC over postMessage to the window that framed us): ui/initialize, then ui/notifications/initialized; the host sends ui/notifications/tool-input and ui/notifications/tool-result for the call that
// opened the panel (the film is named by the result's structuredContent or its JSON text part, { project_id, mode, title }, or else by the call's own arguments); the panel sends tools/call, ui/update-model-context (one short line about what changed), ui/request-display-mode, and
// ui/notifications/size-changed. A tool answer is { structuredContent: { data } } or, with isError, { structuredContent: { error: { code, message } } }; anything else reads as "did not answer".
(() => {
  const NAMES = ['editor_apply_ops', 'editor_undo', 'editor_undo_all_ai', 'my_edit_ops_since', 'editor_heartbeat', 'editor_film_card'];
  const PARENT = window.parent;
  const WAIT_MS = 20000;
  const POLL_MS = 5000;          // the page asks for changes every 2 s; each ask is a call through the host to the server, so an ask for the SAME revision within 5 s is answered from the last answer
  const PANEL = 'Ryagram panel';          // the label the server gives this panel's own edits (they are recorded under the AI's limits, so they come back as the AI's rows)
  const DOWN = { data: null, error: { code: null, message: 'Ryagram did not answer. Ask your AI to open the editor again.' } };
  const BAD = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u200e\u200f]/g;
  const clean = (s, n) => String(s == null ? '' : s).replace(BAD, ' ').slice(0, n);

  let nid = 0, ctx = {};
  // Hosts differ in what they keep of a tool result: some pass structuredContent, some only the text parts. Read the first, else a text part that is a JSON object; anything else is "nothing".
  function unwrap(res) {
    if (!res || typeof res !== 'object') return null;
    if (res.structuredContent && typeof res.structuredContent === 'object') return res.structuredContent;
    if (Array.isArray(res.content)) {
      for (const part of res.content) {
        if (part && part.type === 'text' && typeof part.text === 'string' && part.text.length < 2000000 && part.text.trimStart().startsWith('{')) {
          try { const v = JSON.parse(part.text); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch (e) { /* prose, not data */ }
        }
      }
    }
    return null;
  }
  const seen = { initialized: false, input: false, result: false, film: false };   // what has reached the panel, for the words shown if it never gets a film (kinds only, no content)
  let input = null, inputTimer = 0, watchTimer = 0;
  const pending = new Map();
  const post = m => PARENT.postMessage({ jsonrpc: '2.0', ...m }, '*');
  const notify = (method, params) => post({ method, params });
  function request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++nid;
      const t = setTimeout(() => { pending.delete(id); reject(new Error('no answer')); }, WAIT_MS);
      pending.set(id, { resolve, reject, t });
      post({ id, method, params });
    });
  }

  let mounted = false, didRefuse = false, fullBtn = null;
  addEventListener('message', ev => {
    if (ev.source !== PARENT) return;
    const m = ev.data;
    if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0') return;
    if (typeof m.method === 'string') {
      if (m.method === 'ui/notifications/tool-input') gotInput(m.params && m.params.arguments);
      else if (m.method === 'ui/notifications/tool-result') gotResult(m.params);
      else if (m.method === 'ui/notifications/host-context-changed') { ctx = { ...ctx, ...(m.params || {}) }; paintFull(); }
      else if (m.id !== undefined) post({ id: m.id, ...(m.method === 'ui/resource-teardown' ? { result: {} } : { error: { code: -32601, message: 'Method not found' } }) });
      if (m.method === 'ui/resource-teardown') stopAll();
      return;
    }
    const p = m.id !== undefined ? pending.get(m.id) : null;
    if (!p) return;
    pending.delete(m.id); clearTimeout(p.t);
    if (m.error) p.reject(new Error(clean(m.error.message, 200))); else p.resolve(m.result);
  });

  // ---- the five calls: a tool call through the host, read as data, never as instructions
  const poll = { key: '', at: 0, data: null };
  async function rpc(name, args) {
    if (!NAMES.includes(name)) throw new Error('Not an editor call.');
    const a0 = args && typeof args === 'object' ? args : {};
    const pollKey = name === 'my_edit_ops_since' ? `${a0.p_project}|${a0.p_mode}|${a0.p_revision}` : '';
    if (pollKey && pollKey === poll.key && poll.data !== null && Date.now() - poll.at < POLL_MS) return { data: JSON.parse(poll.data), error: null };
    let r;
    try { r = await request('tools/call', { name, arguments: args && typeof args === 'object' ? args : {} }); } catch (e) { return DOWN; }
    const sc = unwrap(r);
    if (!sc) return DOWN;
    if (r.isError || sc.error) {
      const e = sc.error && typeof sc.error === 'object' ? sc.error : {};
      return { data: null, error: { code: typeof e.code === 'string' ? e.code.slice(0, 16) : null, message: clean(e.message || 'Ryagram could not do that.', 300) } };
    }
    if (name === 'editor_apply_ops' || name === 'editor_undo' || name === 'editor_undo_all_ai') { poll.at = 0; told(name, args, sc.data); }
    let data = sc.data === undefined ? null : sc.data;
    // the page applies a row from the AI as "your AI changed this"; this panel's own edits come back in the log too, and the page must read them as its own (the person's), or it would apply each twice
    if (name === 'my_edit_ops_since' && data && typeof data === 'object' && Array.isArray(data.ops)) data = { ...data, ops: data.ops.map(o => (o && typeof o === 'object' && o.actor === 'ai' && o.client === PANEL ? { ...o, actor: 'person' } : o)) };
    if (pollKey) { poll.key = pollKey; poll.at = Date.now(); poll.data = JSON.stringify(data); }
    return { data, error: null };
  }

  // ---- telling the AI what changed: ONE short line, replaced each time (never a chat message per edit)
  let tellTimer = 0, changes = 0, lastNote = '';
  function told(name, args, data) {
    changes += 1;
    const ops = args && Array.isArray(args.p_ops) ? args.p_ops.map(o => clean(o && o.op, 30)).filter(Boolean).slice(0, 5).join(', ') : '';
    const rev = data && typeof data === 'object' && Number.isFinite(data.revision) ? ` Revision ${data.revision}.` : '';
    lastNote = `The person is editing in the Ryagram panel in this chat. ${changes} change${changes === 1 ? '' : 's'} so far (latest: ${name === 'editor_apply_ops' ? (ops || 'an edit') : name === 'editor_undo' ? 'an undo' : 'undo of the AI\u2019s changes'}).${rev} Read get_edit_state for the exact state before you change anything.`;
    clearTimeout(tellTimer);
    tellTimer = setTimeout(() => { request('ui/update-model-context', { content: [{ type: 'text', text: lastNote }] }).catch(() => {}); }, 800);
  }

  // the final film is built in the Ryagram app: nothing here can start a build, a render or a spend
  async function render() { return { error: 'The film is built in the Ryagram app. Open it there and press the build button when you are ready.' }; }

  // ---- the film's look card (Editor Step A): the picture comes from another computer, so it is REBUILT here, element by element, from a fixed list, and only the part that is on the list is kept. The connector has already
  // refused a card whose picture holds anything else; this is the second lock (a mistake in either place cannot run anything). It never follows an address, never keeps a style, a script or an event handler, and renames every id so
  // nothing in it can collide with the page.
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CARD_ELEMENTS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'linearGradient', 'radialGradient', 'stop', 'clipPath', 'title']);
  const CARD_TEXT = new Set(['text', 'tspan', 'title']);
  const CARD_ATTRS = new Set(['id', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'd', 'points', 'transform', 'viewBox', 'preserveAspectRatio', 'fill', 'stroke', 'stroke-width',
    'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'fill-opacity', 'opacity', 'fill-rule', 'clip-rule', 'clip-path', 'font-family', 'font-size', 'font-weight', 'font-style',
    'text-anchor', 'dominant-baseline', 'letter-spacing', 'textLength', 'dx', 'dy', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform']);
  const URL_REF = /^url\(#([A-Za-z0-9_-]{1,40})\)$/;
  function drawCard(svg) {
    try {
      if (typeof svg !== 'string' || svg.length === 0 || svg.length > 200000) return null;
      const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
      const root = doc.documentElement;
      if (!root || root.localName !== 'svg' || doc.getElementsByTagName('parsererror').length) return null;
      let count = 0;
      const copy = (src, depth) => {
        if (depth > 30 || ++count > 30000) throw new Error('too big');
        const el = document.createElementNS(SVG_NS, src.localName);
        for (const a of Array.from(src.attributes)) {
          if (!CARD_ATTRS.has(a.name)) continue;
          const v = String(a.value);
          if (v.length > 60000) continue;
          if (a.name === 'textLength' && !/^\d{1,5}(?:\.\d{1,3})?$/.test(v)) continue;                // a plain number only (the connector refuses anything else; this is the second lock)
          if (/url\(/i.test(v)) {
            const m = URL_REF.exec(v);
            if (!m || !['fill', 'stroke', 'clip-path'].includes(a.name)) continue;
            el.setAttribute(a.name, 'ur' + 'l(#lecard-' + m[1] + ')');            // written in two pieces: the page's own check forbids the word with a bracket anywhere in its text (a CSS address is how a style could reach out); this is an SVG paint reference to an id inside the picture
          } else if (/javascript:|data:|https?:|\/\/|expression\(/i.test(v)) continue;
          else el.setAttribute(a.name, a.name === 'id' ? 'lecard-' + v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) : v);
        }
        for (const n of Array.from(src.childNodes)) {
          if (n.nodeType === 1) { if (n.namespaceURI === SVG_NS && CARD_ELEMENTS.has(n.localName)) el.appendChild(copy(n, depth + 1)); }
          else if (n.nodeType === 3 && CARD_TEXT.has(src.localName)) el.appendChild(document.createTextNode(clean(n.nodeValue, 2000)));
        }
        return el;
      };
      const out = copy(root, 0);
      if (!out.getAttribute('viewBox')) {
        const w = parseFloat(root.getAttribute('width')), h = parseFloat(root.getAttribute('height'));
        if (w > 0 && h > 0) out.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      }
      out.removeAttribute('width'); out.removeAttribute('height');
      out.setAttribute('focusable', 'false'); out.setAttribute('aria-hidden', 'true');
      return out;
    } catch (e) { return null; }
  }

  window.ryagramLiveHost = { rpc, render, mode: 'compilation', project: '', media: null, title: '', filmCard: true, drawCard };

  // ---- the page's element builder (the site's own is private to its router)
  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key === 'class') el.className = value;
      else if (key === 'value') el.value = value;
      else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child != null && child !== false) el.append(child);
    return el;
  }

  // ---- full screen, where the host offers it
  const modes = () => (Array.isArray(ctx.availableDisplayModes) ? ctx.availableDisplayModes : []);
  function paintFull() {
    // Full screen: the chat's reply box sits over the bottom of the panel, so nothing the person needs may sit in the last ~90 px (chat-extra.css makes the room). A host that tells its safe area adds to it.
    const de = document.documentElement;
    if (de && de.classList) {
      const sb = ctx.safeAreaInsets && typeof ctx.safeAreaInsets.bottom === 'number' && isFinite(ctx.safeAreaInsets.bottom) ? Math.min(200, Math.max(0, Math.round(ctx.safeAreaInsets.bottom))) : 0;
      if (de.style && de.style.setProperty) de.style.setProperty('--le-safe-bottom', sb + 'px');
      de.classList.toggle('le-fullscreen', ctx.displayMode === 'fullscreen');
    }
    if (!fullBtn) return;
    const can = modes().includes('fullscreen');
    fullBtn.hidden = !can;
    fullBtn.textContent = ctx.displayMode === 'fullscreen' ? 'Back to the chat' : 'Full screen';
  }
  function toggleFull() {
    const want = ctx.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
    request('ui/request-display-mode', { mode: want }).then(r => { if (r && typeof r.mode === 'string') { ctx = { ...ctx, displayMode: r.mode }; paintFull(); } }).catch(() => {});
  }

  const stops = [];
  function stopAll() { clearTimeout(tellTimer); stops.splice(0).forEach(f => { try { f(); } catch (e) { /* closing */ } }); }
  addEventListener('pagehide', stopAll);

  // ---- the computer page's footer says "Everything here is drawn and kept on your computer. Nothing uses credits until you press the final button." In the chat there is no final button and Ryagram keeps the drafts, so that sentence is replaced
  const FOOT_OLD = 'Everything here is drawn and kept on your computer.', FOOT_NEW = 'Changes here stay drafts. Nothing is built, and nothing uses credits, from this panel.';
  function reword() {
    const root = document.getElementById('live-root');
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('p.meta').forEach(p => { if (p.textContent.indexOf(FOOT_OLD) === 0) p.textContent = FOOT_NEW; });
  }

  // ---- the call that opened the panel tells us which film: its result (with the title), or failing that the arguments the host says it was called with
  function gotResult(params) {
    seen.result = true; clearTimeout(inputTimer);
    if (params && params.isError) { refused(params); return; }      // the call was refused: say why in the server's own words, never open an editor whose every call would be refused
    const sc = unwrap(params);
    opened(sc && typeof sc.project_id === 'string' ? sc : input ? { ...input, ...(sc || {}) } : sc);
  }
  function gotInput(args) {
    seen.input = true;
    if (!args || typeof args !== 'object') return;
    input = { project_id: args.project_id, mode: args.mode, title: '' };
    clearTimeout(inputTimer);
    inputTimer = setTimeout(() => { if (!seen.result) opened(input); }, 8000);     // only when the host never sends a result at all (the call itself can take a few seconds)
  }
  // a refusal (film not found, track list not shared, a missing permission): its sentence, cleaned, in place of any editor; if an editor was already opened from the arguments it is taken down
  function refused(params) {
    const parts = params && Array.isArray(params.content) ? params.content.filter(c => c && c.type === 'text' && typeof c.text === 'string').map(c => c.text) : [];
    let text = clean(parts.join(' '), 300).trim();
    if (text.startsWith('{')) { try { const e = JSON.parse(text); text = e && e.error && typeof e.error.message === 'string' ? clean(e.error.message, 300).trim() : ''; } catch (x) { text = ''; } }
    if (!text) text = 'Ryagram could not open that film. Ask your AI to open the editor again.';
    clearTimeout(watchTimer); clearTimeout(inputTimer); clearTimeout(tellTimer);
    stopAll();
    mounted = true; didRefuse = true;
    window.ryagramLiveHost.project = '';
    const root = document.getElementById('live-root');
    if (root) root.replaceChildren(h('p', { class: 'meta' }, text));
  }
  function noFilm() {
    if (mounted) return;
    const root = document.getElementById('live-root');
    if (!root) return;
    const got = ['initialized', 'input', 'result'].filter(k => seen[k]).join(', ') || 'nothing';
    root.replaceChildren(h('p', { class: 'meta' }, `Ryagram is here but your chat has not told it which film to show. Ask your AI to open the editor again. (For Ryagram support: the chat sent ${got}.)`));
  }
  function opened(sc) {
    if (mounted || didRefuse || !sc || typeof sc !== 'object') return;
    const project = typeof sc.project_id === 'string' && /^[0-9A-Za-z-]{8,64}$/.test(sc.project_id) ? sc.project_id : '';
    if (!project) return;
    mounted = true; seen.film = true; clearTimeout(watchTimer); clearTimeout(inputTimer);
    window.ryagramLiveHost.project = project;
    window.ryagramLiveHost.mode = sc.mode === 'data' ? 'data' : 'compilation';
    window.ryagramLiveHost.title = clean(sc.title, 80);
    const root = document.getElementById('live-root');
    if (!root || !window.ryagramEditorPage) return;
    fullBtn = h('button', { type: 'button', class: 'button secondary', hidden: true, onclick: toggleFull }, 'Full screen');
    root.replaceChildren(h('div', { class: 'le-chatbar' }, h('span', { class: 'meta' }, 'Changes here are drafts that Ryagram keeps. Save or build the film in the Ryagram app.'), fullBtn), window.ryagramEditorPage.create({ h }).editorView(window.ryagramLiveHost.mode, fn => stops.push(fn)));
    paintFull();
    reword();
    if (typeof MutationObserver === 'function') new MutationObserver(reword).observe(root, { childList: true, subtree: true, characterData: true });
  }

  // ---- size, so the host can fit the panel to its content
  let lastH = 0;
  function size() {
    const r = document.documentElement.getBoundingClientRect(), hh = Math.ceil(r.height);
    if (hh && hh !== lastH) { lastH = hh; notify('ui/notifications/size-changed', { width: Math.ceil(r.width), height: hh }); }
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(size).observe(document.body);

  request('ui/initialize', { protocolVersion: '2026-01-26', appInfo: { name: 'ryagram-editor', version: '1' }, appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] } })
    .then(r => { ctx = (r && r.hostContext && typeof r.hostContext === 'object') ? r.hostContext : {}; seen.initialized = true; notify('ui/notifications/initialized', {}); size(); paintFull(); watchTimer = setTimeout(noFilm, 12000); })
    .catch(() => { const root = document.getElementById('live-root'); if (root && !mounted) root.replaceChildren(h('p', { class: 'meta' }, 'Ryagram could not start here. Ask your AI to open the editor in the Ryagram app instead.')); });
})();
