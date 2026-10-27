// The live editor on the person's own computer (NEXT-WEB 152 / NEXT-CONNECT 142): the host seam and the mount. This file is the LAST part of the generated live.js
// (tools/build-maker-live.mjs); the editor itself is the website's own code, not a copy kept by hand.
//   window.ryagramLiveHost = { rpc, mode, project, media, title }
//   rpc(name, args) -> Promise<{ data, error: { code, message } | null }>     POST /api/live/rpc  { name, args }, header X-Maker-Token (the maker's own token convention)
// Only the five editor_* names are ever sent. The address carries ?t=<token>&mode=compilation|data&project=<id>; the token is kept for this tab and taken out of the address bar.
(() => {
  const NAMES = ['editor_apply_ops', 'editor_undo', 'editor_undo_all_ai', 'my_edit_ops_since', 'editor_heartbeat'];
  const q = new URLSearchParams(location.search);
  let token = q.get('t') || '';
  try {
    if (token) sessionStorage.setItem('maker-token', token); else token = sessionStorage.getItem('maker-token') || '';
  } catch (e) { /* works for this load without it */ }
  if (q.has('t')) { try { q.delete('t'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q.toString() : '')); } catch (e) { /* the address stays */ } }
  const mode = q.get('mode') === 'data' ? 'data' : 'compilation';
  const project = String(q.get('project') || '').slice(0, 64);

  async function rpc(name, args) {
    if (!NAMES.includes(name)) throw new Error('Not an editor call.');
    try {
      const res = await fetch('/api/live/rpc', { method: 'POST', headers: { 'X-Maker-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args }) });
      const body = await res.json();
      if (!body || typeof body !== 'object') return { data: null, error: { code: null, message: 'The Ryagram app gave an answer this page cannot read.' } };
      return { data: body.error ? null : (body.data === undefined ? null : body.data), error: body.error ? { code: body.error.code || null, message: String(body.error.message || '') } : null };
    } catch (e) {
      return { data: null, error: { code: null, message: 'The Ryagram app on this computer did not answer. Is it still open?' } };
    }
  }
  window.ryagramLiveHost = { rpc, mode, project, media: null, title: '' };

  // the element builder the page was written with (the site's own is private to its router)
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
  const root = document.getElementById('live-root');
  if (!root || !window.ryagramEditorPage) return;
  const stops = [];
  root.replaceChildren(window.ryagramEditorPage.create({ h }).editorView(mode, fn => stops.push(fn)));
  addEventListener('pagehide', () => stops.forEach(f => { try { f(); } catch (e) { /* closing */ } }));
})();
