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
  const BAD_CODE = "That code doesn't look right. Codes never use the letters O, I or L or the numbers 0 or 1. Check the app and try again.";
  // WORKER's rev2 draft (191fc78): device_request_check returns { state: 'unknown' | 'used' | 'expired' | 'pending', computer_name, requested_at, rough_location, expires_at } instead of raising.
  const STATE_WORDS = { unknown: 'That code was not found. Check the code in the app and type it again.', used: 'That code has already been used.', expired: 'This code has ended. Start again in the Ryagram app.' };
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
    if (!m) return { page: false, code: null, bad: false };
    const code = m[1] ? normalizeCode(m[1]) : null;
    return { page: true, code, bad: !!m[1] && !code };               // a code in the link that is not a real code is said so, not silently dropped
  };
  // A computer just approved has not been heard from yet; that must not read like a failure (FACES 16:12 fix 4): "waiting for the app to finish signing in" for the first 3 minutes, "not seen yet" only after that.
  function seenWords(r, now = Date.now()) {
    if (r.last_used_at) return now - Date.parse(r.last_used_at) < 120000 ? 'last used just now' : 'last seen ' + ago(r.last_used_at, now);
    const minutes = (now - Date.parse(r.created_at)) / 60000;
    return Number.isFinite(minutes) && minutes < 3 ? 'waiting for the app to finish signing in' : 'not seen yet';
  }
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

  // The release is ready only when it carries an https address, a file name and a 64-hex SHA-256 (Ryan fills assets/windows-release.js when he hosts the file).
  function windowsReady(rel) {
    return !!rel && typeof rel.url === 'string' && /^https:\/\/[^\s]+$/.test(rel.url) && typeof rel.fileName === 'string' && /^[A-Za-z0-9._ -]{1,80}$/.test(rel.fileName) && typeof rel.sha256 === 'string' && /^[0-9a-f]{64}$/.test(rel.sha256);
  }

  // The admin form's own pre-check (the server checks again; WORKER's draft needs 3 to 300 characters of reason). A courtesy, never the gate.
  const REASON_MIN = 3, REASON_MAX = 300;
  function checkTesterForm(email, reason) {
    const e = String(email || '').trim(), r = String(reason || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'Type the account email, like name@example.com.';
    if (r.length < REASON_MIN) return 'Say why, in a few words.';
    if (r.length > REASON_MAX) return `Keep the reason under ${REASON_MAX + 1} characters.`;
    return null;
  }

  // ---------------------------------------------------------------- the screens
  function create(ctx) {
    const { h, data, busy, showError, errorLine, date, whoami } = ctx;

    // ---- the approval page
    async function deviceView(prefill, bad) {
      const back = h('a', { href: '#/', class: 'back' }, '← All projects');
      const error = errorLine();
      const out = h('div', { class: 'device-out', 'aria-live': 'polite' });
      const input = h('input', { id: 'device-code', type: 'text', maxlength: '12', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': 'device-code-note', value: prefill ? showCode(prefill) : '' });
      const check = h('button', { class: 'button primary', type: 'button' }, 'Check this code');
      const formBox = h('div', { class: 'device-form' });
      const heading = h('h1', { tabindex: '-1' }, 'Approve this computer?');

      async function show(code) {
        let c;
        // the server stores the code as XXXX-XXXX, so that is the form we send (found by the local end-to-end run)
        try { c = await data.deviceRequestCheck(showCode(code)); } catch (err) { out.replaceChildren(h('p', { class: 'app-error', role: 'alert' }, err.message)); return; }
        const named = c && (c.computer_name || c.device_name);
        if (!c || (c.state && c.state !== 'pending') || !named) {                                 // only a pending code shows facts; the others say why in words
          out.replaceChildren(h('p', { class: 'app-error', role: 'alert' }, (c && STATE_WORDS[c.state]) || 'That code can’t be used.'), h('p', { class: 'form-note' }, 'Nothing was approved. You can close this page.'));
          return;
        }
        let me = '';
        try { me = whoami ? String(await whoami() || '') : ''; } catch { me = ''; }                // which account the computer would join (CC1 13:48)
        const approve = h('button', { class: 'button primary', type: 'button' }, 'Approve this computer');
        const deny = h('button', { class: 'button secondary', type: 'button' }, 'Deny');
        const expiryLine = h('p', { class: 'form-note device-expiry', role: 'status' });
        const decide = async (button, yes) => {
          error.hidden = true;
          await busy(button, yes ? 'Approving…' : 'Denying…', async () => {
            try {
              const r = await data.deviceDecide(showCode(code), yes);
              approve.disabled = deny.disabled = true;
              formBox.hidden = true;                                                                  // the answer is given: no form left that looks unfinished
              const until = r && r.expires_at ? date(r.expires_at) : r && r.token_days ? date(new Date(Date.now() + Number(r.token_days) * 86400000).toISOString()) : null;
              heading.textContent = yes ? 'This computer is signed in' : 'Nothing was signed in';              // the answer replaces the question (FACES 16:12 fix 1)
              heading.focus();
              out.replaceChildren(yes
                ? h('div', { class: 'device-done', role: 'status' }, h('p', { class: 'device-consent' }, until ? `It works until ${until}.` : 'It works for 30 days.'),
                    h('p', { class: 'device-consent' }, 'Go back to the Ryagram app.'), h('p', { class: 'form-note' }, 'You can remove this computer any time: Account, then Computers signed in.'))
                : h('div', { class: 'device-done', role: 'status' }, h('p', { class: 'device-consent' }, 'If you did not start this, you can ignore it.')));
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
            h('dt', {}, 'The name it gave itself (not checked)'), h('dd', {}, String(named).slice(0, 80)),
            h('dt', {}, 'Asked at'), h('dd', {}, (c.requested_at || c.asked_at) ? new Date(c.requested_at || c.asked_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'not known'),
            h('dt', {}, 'Roughly where (a guess from its network)'), h('dd', {}, (c.rough_location || c.approx_place) ? String(c.rough_location || c.approx_place).slice(0, 80) : 'not known')),
          me ? h('p', { class: 'device-who' }, 'You are signed in as ', h('strong', {}, me.slice(0, 120)), '. This computer will join this account. Not you? Sign out first.') : '',
          h('p', { class: 'device-consent' }, 'If you approve, this computer can make films for you for 30 days. It cannot spend your credits or change your account. You can remove it any time.'),
          h('p', { class: 'form-note' }, 'Approve signs this computer in. Deny signs nothing in.'),
          expiryLine, h('div', { class: 'actions-row' }, approve, deny));
      }

      check.addEventListener('click', async () => {
        error.hidden = true;
        const code = normalizeCode(input.value);
        if (!code) { showError(error, new Error(BAD_CODE)); return; }
        await busy(check, 'Checking…', () => show(code));
      });
      input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); check.click(); } });
      if (prefill) show(prefill);                    // a link carried the code: look it up (a check only; nothing is approved until a button is pressed)
      formBox.append(h('label', { for: 'device-code' }, 'The code shown in the app'), input,
        h('p', { id: 'device-code-note', class: 'form-note' }, 'Eight characters, like ABCD-2345.'), h('div', { class: 'actions-row' }, check));
      return [back, heading,
        h('p', { class: 'form-intro' }, 'The Ryagram app on a computer is asking to sign in to your account.'),
        (bad ? h('p', { class: 'app-error', role: 'alert' }, BAD_CODE) : null),
        formBox, error, out];
    }

    // ---- the account page's list
    async function computersSection() {
      const error = errorLine();
      const list = h('div');
      const tester = data.myLocalCompute ? await data.myLocalCompute() : false;                  // a tester's films render on their own computer
      if (!tester) {                                                                           // CC1 16:24 point 5: only a flagged account (or one that already has a computer) sees this section
        let mine = [];
        try { mine = (await data.myComputers()).filter(r => !r.revoked_at); } catch { mine = []; }
        if (!mine.length) return null;
      }
      async function draw() {
        let rows;
        try { rows = (await data.myComputers()).filter(r => !r.revoked_at); } catch (err) { list.replaceChildren(h('p', { class: 'form-note' }, err.message)); return; }
        list.replaceChildren(rows.length ? h('ul', { class: 'project-list connected-list' }, rows.map(r => h('li', {},
          h('strong', {}, String(r.computer_name || r.device_name || r.name || 'A computer').slice(0, 80)),
          h('span', { class: 'meta' }, ` added ${date(r.created_at)}, ${seenWords(r)}, works until ${date(r.expires_at)}`),
          h('button', { class: 'button secondary small', type: 'button', onclick: async event => {
            if (!confirm(`Remove ${r.computer_name || r.device_name || r.name || 'this computer'}? It is signed out straight away.`)) return;
            error.hidden = true;
            await busy(event.currentTarget, 'Removing…', async () => {
              try { await data.removeComputer(r.id); await draw(); list.prepend(h('p', { class: 'form-note', role: 'status' }, `${r.computer_name || r.device_name || r.name || 'The computer'} is removed.`)); }
              catch (err) { showError(error, err); }
            });
          } }, 'Remove this computer')))) : h('p', { class: 'form-note' }, tester ? 'No computer is signed in. Your films wait until you sign one in with the Ryagram app.' : 'No computer is signed in to your account.'));
      }
      await draw();
      return h('section', { class: 'account-section', 'aria-labelledby': 'acct-computers' }, h('h2', { id: 'acct-computers' }, 'Computers signed in'),
        tester ? h('p', { class: 'device-tester', role: 'note' }, h('strong', {}, 'Your films are made on your own computer. '), 'It is a computer you sign in here, not Ryagram’s machine, and it costs you no credits. If none is signed in, your film waits.') : null,
        h('p', { class: 'form-note' }, 'Computers where you use the Ryagram app. Removing one signs it out at once.'), list, error);
    }

    // ---- "Ryagram for Windows": the download card, for tester accounts only (NEXT-WEB 118; Ryan 17:12 and 17:18: download, double-click, done).
    // Everything the card says about the file comes from window.ryagramWindowsApp (assets/windows-release.js): until Ryan hosts the file the button is OFF and says so. The page makes no network call:
    // the button is a plain link the person follows. The personal-use notice has a slot (hidden until the lawyer's wording is put in; no session writes it).
    async function windowsAppSection() {
      const tester = data.myLocalCompute ? await data.myLocalCompute() : false;
      if (!tester) return null;                                                               // only an account with the tester flag sees the card
      const rel = (typeof window !== 'undefined' && window.ryagramWindowsApp) || {};
      const ready = windowsReady(rel);
      const name = ready ? rel.fileName : 'the file';
      return h('section', { class: 'account-section windows-card', 'aria-labelledby': 'acct-windows' }, h('h2', { id: 'acct-windows' }, 'Ryagram for Windows'),
        h('p', { class: 'form-note' }, 'The Ryagram app for your Windows computer. Your films are made on it.'),
        h('dl', { class: 'windows-facts' },
          h('dt', {}, 'File'), h('dd', {}, ready ? h('code', {}, rel.fileName) : 'shown here when the file is ready'),
          h('dt', {}, 'Size'), h('dd', {}, ready && rel.sizeMb ? `about ${rel.sizeMb} MB. The listening model is downloaded separately, the first time you run it.` : 'shown here when the file is ready'),
          h('dt', {}, 'SHA-256'), h('dd', {}, ready ? h('code', { class: 'windows-sha' }, rel.sha256) : 'shown here when the file is ready')),
        ready
          ? h('a', { class: 'button primary', href: rel.url, rel: 'noopener', download: rel.fileName }, 'Download Ryagram for Windows')
          : h('div', {}, h('button', { class: 'button primary', type: 'button', disabled: true }, 'Not ready yet'), h('p', { class: 'form-note' }, 'The download appears here when it is ready.')),
        h('ol', { class: 'windows-steps' },
          h('li', {}, h('strong', {}, 'Download '), `${name} and unzip it into a folder on a drive with room to spare (right-click, Extract all). It needs about 582 MB unpacked, plus the listening model (Balanced is about 464 MB): about 1.1 GB free in all.`),
          h('li', {}, h('strong', {}, 'Check it. '), 'Optional, but do it: open PowerShell in the folder you downloaded to and paste this line: ', h('code', {}, `Get-FileHash ${ready ? rel.fileName : '<the file>'} -Algorithm SHA256`),
            '. The 64 characters it prints must equal the SHA-256 above.'),
          h('li', {}, h('strong', {}, 'Open it. '), 'In the unzipped folder, double-click ', h('strong', {}, 'Open Ryagram'), ' (it looks like a small window or gear icon, and it is the only file to double-click; the folder holds many). The first time, Windows may say "Windows protected your PC": press More info, then Run anyway, ',
            h('strong', {}, 'but only if the file name is exactly '), ready ? h('code', {}, rel.fileName) : 'the one shown above', ' and the SHA-256 matches. If anyone else ever asks you to press Run anyway, say no.'),
          h('li', {}, h('strong', {}, 'First run. '), 'Press ', h('strong', {}, 'Download the listening model'), ' (Balanced is already chosen for you, about 464 MB), then press ', h('strong', {}, 'Sign in to Ryagram'), ' and approve the code on this website.')),
        h('p', { class: 'form-note' }, 'Films from your own clips need nothing more. Films you order on the website and make on this computer also need Google Chrome installed and about 5 GB of free memory (Edge is untested).'),
        h('p', { class: 'form-note' }, 'To remove it, delete the folder. To sign this computer out, press Remove this computer in the "Computers signed in" list just below this card.'),
        h('p', { class: 'form-note windows-notice', hidden: !(rel.personalUseNotice), 'data-slot': 'personal-use-notice' }, rel.personalUseNotice ? String(rel.personalUseNotice).slice(0, 1200) : ''));
    }

    // ---- admin: who is a tester (an admin-only page; the server is the gate, every change is written to an audit row)
    async function testerAdminView() {
      const back = h('a', { href: '#/', class: 'back' }, '← All projects');
      const error = errorLine();
      const email = h('input', { id: 'tester-email', type: 'email', autocomplete: 'off', maxlength: '200', spellcheck: 'false' });
      const reason = h('input', { id: 'tester-reason', type: 'text', autocomplete: 'off', maxlength: String(REASON_MAX), 'aria-describedby': 'tester-reason-note' });
      const status = h('p', { class: 'form-note', role: 'status' });
      const history = h('div', { class: 'tester-history' });
      async function drawHistory() {
        let rows;
        try { rows = await data.adminLocalComputeAudit(); } catch (err) { history.replaceChildren(h('p', { class: 'form-note' }, err.message)); return; }
        history.replaceChildren(rows.length ? h('ul', { class: 'project-list' }, rows.map(r => h('li', {},
          h('strong', {}, String(r.user_email || 'an account').slice(0, 120)),
          h('span', { class: 'meta' }, ` ${r.was_on ? 'on' : 'off'} to ${r.turned_on ? 'on' : 'off'} by ${String(r.set_by_email || 'an admin').slice(0, 120)}, ${new Date(r.at).toLocaleString()}`),
          h('p', { class: 'form-note' }, 'Why: ', String(r.reason || '').slice(0, REASON_MAX))))) : h('p', { class: 'form-note' }, 'No changes yet.'));
      }
      const change = async (button, on) => {
        error.hidden = true; status.textContent = '';
        const problem = checkTesterForm(email.value, reason.value);
        if (problem) { showError(error, new Error(problem)); return; }
        await busy(button, on ? 'Turning on…' : 'Turning off…', async () => {
          try {
            await data.adminSetLocalCompute(email.value, on, reason.value);
            status.textContent = `${email.value.trim()} is ${on ? 'now' : 'no longer'} a tester. The change is in the history below.`;
            reason.value = '';
            await drawHistory();
          } catch (err) { showError(error, err); }
        });
      };
      const onBtn = h('button', { class: 'button primary', type: 'button' }, 'Turn on');
      const offBtn = h('button', { class: 'button secondary', type: 'button' }, 'Turn off');
      onBtn.addEventListener('click', () => change(onBtn, true));
      offBtn.addEventListener('click', () => change(offBtn, false));
      await drawHistory();
      return [back, h('h1', { tabindex: '-1' }, 'Tester computers'),
        h('p', { class: 'form-intro' }, 'A tester account makes its films on its own computer instead of Ryagram’s machine, and pays no credits for them. Only an admin can change this, and every change is written down.'),
        h('label', { for: 'tester-email' }, 'Account email'), email,
        h('label', { for: 'tester-reason' }, 'Why (a few words, saved in the history)'), reason,
        h('p', { id: 'tester-reason-note', class: 'form-note' }, `${REASON_MIN} to ${REASON_MAX} characters.`),
        h('div', { class: 'actions-row' }, onBtn, offBtn), status, error,
        h('h2', {}, 'History'), history];
    }

    return { deviceView, computersSection, windowsAppSection, testerAdminView };
  }

  window.ryagramDevice = { windowsReady, seenWords, checkTesterForm, REASON_MIN, REASON_MAX, BAD_CODE, ALPHABET, normalizeCode, showCode, codeFromHash, expiry, EXPIRED, WARN, ago, create };
})();
