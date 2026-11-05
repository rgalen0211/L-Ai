// The live editor INSIDE THE AI CHAT (CONNECT, 2026-11-05; plan: Ryagram-logs/proposals/CONNECT-MCP-APP-PLAN-1105.md, section 5). Host number 3 of the website's own editor page
// (host 1 = the website, host 2 = the maker, tools/maker-live/live-host.js). This file is the LAST part of the generated page (tools/build-chat-editor.mjs); the editor itself is the
// website's own code, not a copy kept by hand.
//   window.ryagramLiveHost = { rpc, render, mode, project, media, title }
//   rpc(name, args) -> Promise<{ data, error: { code, message } | null }>   the same five names the page has always sent, and nothing else. Each one is a connector tool that only this panel is
//   meant to call (visibility "app"); the host (Claude, ChatGPT, ...) forwards it with the connection the person already has. The panel holds no token, no cookie and no website session.
// The wire (MCP Apps, JSON-RPC over postMessage to the window that framed us): ui/initialize, then ui/notifications/initialized; the host sends ui/notifications/tool-result for the call that
// opened the panel (structuredContent: { project_id, mode, title }); the panel sends tools/call, ui/update-model-context (one short line about what changed), ui/request-display-mode, and
// ui/notifications/size-changed. A tool answer is { structuredContent: { data } } or, with isError, { structuredContent: { error: { code, message } } }; anything else reads as "did not answer".
(() => {
  const NAMES = ['editor_apply_ops', 'editor_undo', 'editor_undo_all_ai', 'my_edit_ops_since', 'editor_heartbeat'];
  const PARENT = window.parent;
  const WAIT_MS = 20000;
  const PANEL = 'Ryagram panel';          // the label the server gives this panel's own edits (they are recorded under the AI's limits, so they come back as the AI's rows)
  const DOWN = { data: null, error: { code: null, message: 'Ryagram did not answer. Ask your AI to open the editor again.' } };
  const BAD = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u200e\u200f]/g;
  const clean = (s, n) => String(s == null ? '' : s).replace(BAD, ' ').slice(0, n);

  let nid = 0, ctx = {};
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

  let mounted = false, fullBtn = null;
  addEventListener('message', ev => {
    if (ev.source !== PARENT) return;
    const m = ev.data;
    if (!m || typeof m !== 'object' || m.jsonrpc !== '2.0') return;
    if (typeof m.method === 'string') {
      if (m.method === 'ui/notifications/tool-result') opened(m.params && m.params.structuredContent);
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
  async function rpc(name, args) {
    if (!NAMES.includes(name)) throw new Error('Not an editor call.');
    let r;
    try { r = await request('tools/call', { name, arguments: args && typeof args === 'object' ? args : {} }); } catch (e) { return DOWN; }
    const sc = r && typeof r === 'object' ? r.structuredContent : null;
    if (!sc || typeof sc !== 'object') return DOWN;
    if (r.isError || sc.error) {
      const e = sc.error && typeof sc.error === 'object' ? sc.error : {};
      return { data: null, error: { code: typeof e.code === 'string' ? e.code.slice(0, 16) : null, message: clean(e.message || 'Ryagram could not do that.', 300) } };
    }
    if (name === 'editor_apply_ops' || name === 'editor_undo' || name === 'editor_undo_all_ai') told(name, args, sc.data);
    let data = sc.data === undefined ? null : sc.data;
    // the page applies a row from the AI as "your AI changed this"; this panel's own edits come back in the log too, and the page must read them as its own (the person's), or it would apply each twice
    if (name === 'my_edit_ops_since' && data && typeof data === 'object' && Array.isArray(data.ops)) data = { ...data, ops: data.ops.map(o => (o && typeof o === 'object' && o.actor === 'ai' && o.client === PANEL ? { ...o, actor: 'person' } : o)) };
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

  window.ryagramLiveHost = { rpc, render, mode: 'compilation', project: '', media: null, title: '' };

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

  // ---- the call that opened the panel tells us which film
  function opened(sc) {
    if (mounted || !sc || typeof sc !== 'object') return;
    const project = typeof sc.project_id === 'string' && /^[0-9A-Za-z-]{8,64}$/.test(sc.project_id) ? sc.project_id : '';
    if (!project) return;
    mounted = true;
    window.ryagramLiveHost.project = project;
    window.ryagramLiveHost.mode = sc.mode === 'data' ? 'data' : 'compilation';
    window.ryagramLiveHost.title = clean(sc.title, 80);
    const root = document.getElementById('live-root');
    if (!root || !window.ryagramEditorPage) return;
    fullBtn = h('button', { type: 'button', class: 'button secondary', hidden: true, onclick: toggleFull }, 'Full screen');
    root.replaceChildren(h('div', { class: 'le-chatbar' }, h('span', { class: 'meta' }, 'Changes here are drafts that Ryagram keeps. Save or build the film in the Ryagram app.'), fullBtn), window.ryagramEditorPage.create({ h }).editorView(window.ryagramLiveHost.mode, fn => stops.push(fn)));
    paintFull();
  }

  // ---- size, so the host can fit the panel to its content
  let lastH = 0;
  function size() {
    const r = document.documentElement.getBoundingClientRect(), hh = Math.ceil(r.height);
    if (hh && hh !== lastH) { lastH = hh; notify('ui/notifications/size-changed', { width: Math.ceil(r.width), height: hh }); }
  }
  if (typeof ResizeObserver === 'function') new ResizeObserver(size).observe(document.body);

  request('ui/initialize', { protocolVersion: '2026-01-26', appInfo: { name: 'ryagram-editor', version: '1' }, appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] } })
    .then(r => { ctx = (r && r.hostContext && typeof r.hostContext === 'object') ? r.hostContext : {}; notify('ui/notifications/initialized', {}); size(); paintFull(); })
    .catch(() => { const root = document.getElementById('live-root'); if (root && !mounted) root.replaceChildren(h('p', { class: 'meta' }, 'Ryagram could not start here. Ask your AI to open the editor in the Ryagram app instead.')); });
})();
