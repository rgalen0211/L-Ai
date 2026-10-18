// Connecting an AI to a Ryagram account: the hosted consent page (#/connect/consent?request=<id>) and the account page's "Connected AIs" list with Disconnect.
//
// The authorization server is CONNECT's (the connect Edge Function and the connect_* SQL); this page is only where the SIGNED-IN PERSON decides. It shows who is asking (the app's
// name), the EXACT address the person will be sent back to, what the AI will be able to do, and that tools which spend credits ask first. Nothing is sent before a button is pressed.
// The page never sees a token or a code: connect_consent_decide returns the address to go to, and the page follows it only if it starts with the address it showed.
// Everything from the server goes in as text nodes, never as HTML.
(() => {
  const REQUEST = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;           // connect_requests.id, a UUID
  // The scope ids are CONNECT's (read, write, render_free; render_final is not offered in v1 and arrives in offered_scopes and credit_scopes only if it ever is).
  const SCOPE_WORDS = {
    read: 'See your projects, films and credit balance',
    write: 'Create projects and change your film stories',
    render_free: 'Make contact sheets and previews (free)',
    render_final: 'Ask for full renders (this spends credits, and it asks you first)'
  };
  const ALWAYS = ['Your AI acts as your Ryagram account.', 'Tools that spend credits will ask you first.', 'You can disconnect it any time: Account, then Connected AIs.'];
  const NOT_ALLOWED = 'This AI can’t be connected.';

  // ---------------------------------------------------------------- pure helpers (tested in node)
  const requestFromHash = hash => { const m = /^#\/connect\/consent\?request=([^&]+)$/.exec(hash || ''); return m && REQUEST.test(m[1]) ? m[1] : null; };
  const scopeWord = id => SCOPE_WORDS[id] || `Use the tool called ${String(id).slice(0, 40)}`;
  // The page follows the server's answer ONLY if it goes to the address it showed (exact start, same scheme and host): a changed destination is an error, never followed.
  function safeRedirect(shown, target) {
    try {
      const a = new URL(shown), b = new URL(target);
      if (a.origin !== b.origin || a.pathname !== b.pathname) return false;
      return String(target).startsWith(String(shown));
    } catch { return false; }
  }
  const hostOf = uri => { try { return new URL(uri).host; } catch { return ''; } };
  const ago = (iso, now = Date.now()) => {
    if (!iso) return 'never';
    const d = Math.max(0, Math.round((now - Date.parse(iso)) / 86400000));
    return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
  };
  const callsLine = n => (n === 1 ? 'used 1 time in the last 30 days' : `used ${Number(n) || 0} times in the last 30 days`);

  // ---------------------------------------------------------------- the screens
  function create(ctx) {
    const { h, data, busy, showError, errorLine, date, navigate = url => location.assign(url) } = ctx;

    // ---- the consent page
    async function consentView(requestId) {
      const back = h('a', { href: '#/', class: 'back' }, '← All projects');
      let c;
      try { c = await data.connectConsentCheck(requestId); } catch (err) { return [back, h('h1', { tabindex: '-1' }, 'Connect an AI'), h('p', { class: 'app-error', role: 'alert' }, err.message)]; }
      if (!c || c.allowed !== true) {
        return [back, h('h1', { tabindex: '-1' }, 'Connect an AI'), h('p', { class: 'app-error', role: 'alert' }, c && c.reason ? c.reason : NOT_ALLOWED),
                h('p', { class: 'form-note' }, 'Nothing was connected. You can close this page.')];
      }
      const error = errorLine();
      const scopes = c.offered_scopes || [];
      const spending = new Set(c.credit_scopes || []);
      const boxes = scopes.map(id => h('input', { type: 'checkbox', id: `cs-${id.replace(/[^a-z0-9]/gi, '-')}`, value: id, checked: true }));
      const approve = h('button', { class: 'button primary', type: 'button' }, 'Approve');
      const deny = h('button', { class: 'button secondary', type: 'button' }, 'Deny');
      const decide = async (button, yes) => {
        error.hidden = true;
        const picked = boxes.filter(b => b.checked).map(b => b.value);
        if (yes && !picked.length) { showError(error, new Error('Choose at least one thing, or press Deny.')); return; }
        await busy(button, yes ? 'Approving…' : 'Denying…', async () => {
          try {
            const r = await data.connectConsentDecide(requestId, yes, yes ? picked : []);
            if (!r || typeof r.redirect_to !== 'string' || !safeRedirect(c.redirect_uri, r.redirect_to)) throw new Error('The answer did not go back to the place shown above, so nothing was done. Close this page and start again from the AI.');
            approve.disabled = deny.disabled = true;
            navigate(r.redirect_to);
          } catch (err) { showError(error, err); }
        });
      };
      approve.addEventListener('click', () => decide(approve, true));
      deny.addEventListener('click', () => decide(deny, false));
      return [back, h('h1', { tabindex: '-1' }, `Connect ${c.client_name || 'an AI'} to Ryagram?`),
        h('p', { class: 'form-intro' }, `${c.client_name || 'This AI'} is asking to work with your Ryagram account.`),
        h('section', { class: 'consent-where' }, h('h2', {}, 'Where you will be sent'), h('p', {}, 'After you choose, you go back to:'),
          h('p', { class: 'consent-uri' }, h('strong', {}, c.redirect_host || hostOf(c.redirect_uri)), h('br'), h('code', {}, c.redirect_uri)),
          h('p', { class: 'form-note' }, 'If that is not where you expect to go back to, press Deny.')),
        h('section', { class: 'consent-can' }, h('h2', {}, 'What it will be able to do'),
          h('ul', { class: 'consent-scopes' }, scopes.map((id, i) => h('li', {}, h('label', { class: 'choice', for: boxes[i].id }, boxes[i], ' ', scopeWord(id), spending.has(id) ? h('span', { class: 'meta' }, ' (spends credits)') : null)))),
          h('p', { class: 'form-note' }, 'Untick anything you do not want to allow.')),
        h('section', { class: 'consent-always' }, h('h2', {}, 'Always true'), h('ul', {}, ALWAYS.map(t => h('li', {}, t)))),
        h('div', { class: 'actions-row' }, approve, deny), error];
    }

    // ---- the account page's list
    async function connectedSection() {
      const error = errorLine();
      const list = h('div');
      async function draw() {
        let rows;
        try { rows = await data.myConnectedAis(); } catch (err) { list.replaceChildren(h('p', { class: 'form-note' }, err.message)); return; }
        list.replaceChildren(rows.length ? h('ul', { class: 'project-list connected-list' }, rows.map(r => h('li', {},
          h('strong', {}, r.client_name || r.client_id), h('span', { class: 'meta' }, ` connected ${date(r.connected_at)}, last used ${ago(r.last_used_at)}, ${callsLine(r.calls_30d)}`),
          h('p', { class: 'form-note' }, (r.scopes || []).map(scopeWord).join('; ') || 'No permissions.'),
          h('button', { class: 'button secondary small', type: 'button', onclick: async event => {
            if (!confirm(`Disconnect ${r.client_name || 'this AI'}? It stops working with your account straight away.`)) return;
            error.hidden = true;
            await busy(event.currentTarget, 'Disconnecting…', async () => {
              try { await data.disconnectAi(r.client_id); await draw(); list.prepend(h('p', { class: 'form-note', role: 'status' }, `${r.client_name || 'The AI'} is disconnected.`)); }
              catch (err) { showError(error, err); }
            });
          } }, 'Disconnect')))) : h('p', { class: 'form-note' }, 'No AI is connected to your account.'));
      }
      await draw();
      return h('section', { class: 'account-section', 'aria-labelledby': 'acct-ais' }, h('h2', { id: 'acct-ais' }, 'Connected AIs'),
        h('p', { class: 'form-note' }, 'An AI you connect acts as your Ryagram account. Tools that spend credits ask you first. Disconnecting stops it at once.'), list, error);
    }

    return { consentView, connectedSection };
  }

  window.ryagramConnect = { create, SCOPE_WORDS, ALWAYS, requestFromHash, scopeWord, safeRedirect, hostOf, ago, callsLine, REQUEST };
})();
