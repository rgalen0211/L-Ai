// Signing a computer in to a Ryagram account: the device-approval page (#/device) and the account page's "Computers signed in" list with Remove.
//
// DRAFT against a MOCK backend (WEB, r9 M2, 2026-10-20): the real device-code functions are CONNECT's and WORKER's and do not exist yet, so the four data calls here
// (deviceRequestCheck, deviceDecide, myComputers, removeComputer) are placeholders whose names and shapes are proposals. The page is OFF (desktopApp: false) and live is untouched.
//
// What the page guarantees, from CC1's 13:20 and 13:34 reviews: it shows a code the person TYPED or followed from a link, and says to approve only a code that is on THEIR OWN screen right
// now (someone can start a code on their own computer and send the link); the computer's name comes from the app, so it is untrusted text, shown as "It calls itself"; it shows when the
// code was asked for and, if the server knows, roughly where; Approve turns off once the code has ended; nothing is sent when the page opens except a check; and the page never sees a token.
// Everything from the server goes in as text nodes, never as HTML.
(() => {
  // The user code: 8 characters from an alphabet with no look-alikes (no 0, O, 1, I or L), shown as XXXX-XXXX.
  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const CODE = new RegExp(`^[${ALPHABET}]{8}$`);
  const EXPIRED = 'This code has ended. Start again in the Ryagram app.';
  const WARN = 'Approve only if this code is on YOUR screen right now, in the Ryagram app you just opened. If someone sent you this link or code, press Deny.';

  // ---------------------------------------------------------------- pure helpers (tested in node)
  const normalizeCode = text => {
    const s = String(text || '').toUpperCase().replace(/[\s-]+/g, '');
    return CODE.test(s) ? s : null;
  };
  const showCode = c => `${c.slice(0, 4)}-${c.slice(4)}`;
  // #/device or #/device?code=ABCD-2345 (hyphen optional, any case). Anything else is not this page.
  const codeFromHash = hash => {
    const m = /^#\/device(?:\?code=([A-Za-z0-9-]+))?$/.exec(hash || '');
    if (!m) return { page: false, code: null };
    return { page: true, code: m[1] ? normalizeCode(m[1]) : null };
  };
  const ago = (iso, now = Date.now()) => {
    if (!iso) return 'never';
    const d = Math.max(0, Math.round((now - Date.parse(iso)) / 86400000));
    return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
  };
  // A code lives about 10 minutes (CC1). The page says when it ends, warns with 2 minutes left, and turns Approve off once it has ended.
  function expiry(iso, now = Date.now()) {
    const end = Date.parse(iso);
    if (!Number.isFinite(end)) return { state: 'unknown', text: '' };
    const left = end - now;
    if (left <= 0) return { state: 'expired', text: EXPIRED };
    const at = new Date(end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const mins = Math.max(1, Math.ceil(left / 60000));
    if (left <= 2 * 60000) return { state: 'soon', text: `This code ends at ${at}, in ${mins} minute${mins === 1 ? '' : 's'}. Decide now, or start again in the app.` };
    return { state: 'ok', text: `This code ends at ${at}.` };
  }

  // ---------------------------------------------------------------- the screens
  function create(ctx) {
    const { h, data, busy, showError, errorLine, date } = ctx;

    // ---- the approval page
    async function deviceView(prefill) {
      const back = h('a', { href: '#/', class: 'back' }, '← All projects');
      const error = errorLine();
      const out = h('div', { class: 'device-out', 'aria-live': 'polite' });
      const input = h('input', { id: 'device-code', type: 'text', maxlength: '12', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'device-code-note', value: prefill ? showCode(prefill) : '' });
      const check = h('button', { class: 'button primary', type: 'button' }, 'Check this code');

      async function show(code) {
        let c;
        try { c = await data.deviceRequestCheck(code); } catch (err) { out.replaceChildren(h('p', { class: 'app-error', role: 'alert' }, err.message)); return; }
        if (!c || c.allowed !== true) {
          out.replaceChildren(h('p', { class: 'app-error', role: 'alert' }, c && c.reason ? c.reason : 'That code can’t be used.'), h('p', { class: 'form-note' }, 'Nothing was approved. You can close this page.'));
          return;
        }
        const approve = h('button', { class: 'button primary', type: 'button' }, 'Approve this computer');
        const deny = h('button', { class: 'button secondary', type: 'button' }, 'Deny');
        const expiryLine = h('p', { class: 'form-note device-expiry', role: 'status' });
        const decide = async (button, yes) => {
          error.hidden = true;
          await busy(button, yes ? 'Approving…' : 'Denying…', async () => {
            try {
              const r = await data.deviceDecide(code, yes);
              approve.disabled = deny.disabled = true;
              out.replaceChildren(yes
                ? h('p', { class: 'form-note', role: 'status' }, `This computer is signed in until ${r && r.expires_at ? date(r.expires_at) : 'it expires'}. You can remove it any time: Account, then Computers signed in. Go back to the Ryagram app.`)
                : h('p', { class: 'form-note', role: 'status' }, 'Nothing was approved. You can close this page.'));
            } catch (err) { showError(error, err); }
          });
        };
        approve.addEventListener('click', () => decide(approve, true));
        deny.addEventListener('click', () => decide(deny, false));
        const tick = () => {
          const e = expiry(c.expires_at);
          expiryLine.textContent = e.text;
          expiryLine.className = `form-note device-expiry${e.state === 'soon' || e.state === 'expired' ? ' device-expiry-warn' : ''}`;
          if (e.state === 'expired') { approve.disabled = true; approve.title = EXPIRED; }
          return e.state;
        };
        if (tick() !== 'expired' && c.expires_at) {
          const timer = setInterval(() => { if (!expiryLine.isConnected || tick() === 'expired') clearInterval(timer); }, 15000);
        }
        out.replaceChildren(
          h('p', { class: 'device-warn', role: 'note' }, h('strong', {}, 'Check before you approve. '), WARN),
          h('dl', { class: 'device-facts' },
            h('dt', {}, 'Code'), h('dd', {}, h('code', {}, showCode(code))),
            h('dt', {}, 'The computer calls itself'), h('dd', {}, c.device_name ? String(c.device_name).slice(0, 80) : 'no name'),
            h('dt', {}, 'Asked for'), h('dd', {}, c.requested_at ? new Date(c.requested_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'not known'),
            h('dt', {}, 'Roughly where'), h('dd', {}, c.approx_place ? String(c.approx_place).slice(0, 80) : 'not known')),
          h('p', { class: 'form-note' }, 'If you approve, this computer can use your Ryagram account for 30 days. It cannot spend your credits, and you can remove it any time.'),
          expiryLine, h('div', { class: 'actions-row' }, approve, deny));
      }

      check.addEventListener('click', async () => {
        error.hidden = true;
        const code = normalizeCode(input.value);
        if (!code) { showError(error, new Error('Type the 8 characters shown in the app, like ABCD-2345.')); return; }
        await busy(check, 'Checking…', () => show(code));
      });
      input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); check.click(); } });
      if (prefill) show(prefill);                    // a link carried the code: look it up (a check only; nothing is approved until a button is pressed)
      return [back, h('h1', { tabindex: '-1' }, 'Approve this computer?'),
        h('p', { class: 'form-intro' }, 'The Ryagram app on a computer is asking to sign in to your account.'),
        h('label', { for: 'device-code' }, 'The code shown in the app'), input,
        h('p', { id: 'device-code-note', class: 'form-note' }, 'Eight characters, like ABCD-2345.'), h('div', { class: 'actions-row' }, check), error, out];
    }

    // ---- the account page's list
    async function computersSection() {
      const error = errorLine();
      const list = h('div');
      async function draw() {
        let rows;
        try { rows = await data.myComputers(); } catch (err) { list.replaceChildren(h('p', { class: 'form-note' }, err.message)); return; }
        list.replaceChildren(rows.length ? h('ul', { class: 'project-list connected-list' }, rows.map(r => h('li', {},
          h('strong', {}, String(r.name || 'A computer').slice(0, 80)),
          h('span', { class: 'meta' }, ` signed in ${date(r.created_at)}, last used ${ago(r.last_used_at)}, ends ${date(r.expires_at)}`),
          h('button', { class: 'button secondary small', type: 'button', onclick: async event => {
            if (!confirm(`Remove ${r.name || 'this computer'}? It is signed out straight away.`)) return;
            error.hidden = true;
            await busy(event.currentTarget, 'Removing…', async () => {
              try { await data.removeComputer(r.id); await draw(); list.prepend(h('p', { class: 'form-note', role: 'status' }, `${r.name || 'The computer'} is removed.`)); }
              catch (err) { showError(error, err); }
            });
          } }, 'Remove this computer')))) : h('p', { class: 'form-note' }, 'No computer is signed in to your account.'));
      }
      await draw();
      return h('section', { class: 'account-section', 'aria-labelledby': 'acct-computers' }, h('h2', { id: 'acct-computers' }, 'Computers signed in'),
        h('p', { class: 'form-note' }, 'Computers where you use the Ryagram app. Removing one signs it out at once.'), list, error);
    }

    return { deviceView, computersSection };
  }

  window.ryagramDevice = { ALPHABET, normalizeCode, showCode, codeFromHash, expiry, EXPIRED, WARN, ago, create };
})();
