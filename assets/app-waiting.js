// Option B, the pages (Ryan 2026-11-04 11:17; plan proposals\WEB-SIGNIN-WAITING-PLAN-1104.md): a REAL account made without an invite code that stays WAITING until access opens.
// This file only DRAWS. The gate is the server's (CONNECT-WAITING-GATE-PLAN-1104: account_status, row policies, require_active in every function). Page code never decides access:
// it asks my_access() and draws what comes back; ANY answer other than 'active', or a failed call, draws the waiting page (fail closed).
// Switch: waitingAccounts in assets/ryagram-config.js (default false; mock mode is on). Everything from the server goes in as text nodes, never as HTML.
// Draft words for Ryan: every sentence here that a person reads is a draft until he approves it.
(() => {
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const on = () => window.ryagramConfig?.waitingAccounts === true || !!window.ryagramMock;

  // ---------------------------------------------------------------- pure helpers (tested in node)
  // The server's answer, as 'active' or 'waiting'. Only the exact word 'active' (or {status:'active'}) opens the app.
  function accessOf(answer) {
    const word = answer && typeof answer === 'object' ? answer.status : answer;
    return word === 'active' ? 'active' : 'waiting';
  }
  // What this person may see at this address. A WAITING (or unknown) account gets the waiting page whatever the address says.
  function pageFor(access, hash) {
    return access === 'active' ? 'normal' : 'waiting';
  }
  function signUpProblem(email) {
    const e = String(email || '').trim();
    if (!e || e.length > 254 || !EMAIL.test(e)) return 'Type your email address.';
    return null;
  }
  // The one place a new account is asked for. Q378 = A (Ryan 11-04 15:47): CONNECT's join function, email only. It sends the invite-style email; the person confirms the address and
  // chooses a password from that link, as testers do. Supabase's own sign-up stays OFF. {ok, off, message}: off = the switch is not on yet (the page sends people to the waitlist).
  async function signUp(data, email) {
    return data.joinWaiting(String(email || '').trim());
  }
  // One line for #/admin/ops: how many are waiting, and how many of them have confirmed their address (only a confirmed one can be approved).
  function waitingSummary(list) {
    const rows = Array.isArray(list) ? list : [];
    const confirmed = rows.filter(r => r && r.confirmed === true).length;
    if (!rows.length) return 'Nobody is waiting.';
    const who = rows.length === 1 ? '1 account is waiting' : `${rows.length} accounts are waiting`;
    return `${who}; ${confirmed} ${confirmed === 1 ? 'has' : 'have'} confirmed the address and can be approved.`;
  }

  const WORDS = {
    title: 'You are on the list',
    line: 'We will email you when your access opens.',
    detail: 'Ryagram is opening to a few people at a time. Until then your account is held here: you can change your password or delete your account, and nothing else is open.',
    noCredits: 'No credits are held or charged on a waiting account.'
  };

  // ---------------------------------------------------------------- pages
  function create({ h, data, busy, showError, errorLine }) {
    // #/waiting: the only page a WAITING account can reach.
    async function waitingView(email, onOpened) {
      const claimError = errorLine(), claimNote = h('p', { class: 'form-note', role: 'status' });
      const code = h('input', { id: 'wt-code', name: 'code', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', maxlength: '40', placeholder: 'RYA-XXXX-XXXX', required: true });
      const claimBtn = h('button', { class: 'button primary', type: 'submit' }, 'Use this code');
      const claimForm = h('form', { class: 'contact-form', onsubmit: async event => {
        event.preventDefault(); claimError.hidden = true; claimNote.textContent = '';
        if (!claimForm.reportValidity()) return;
        await busy(claimBtn, 'Checking…', async () => {
          try {
            const r = await data.claimInvite(code.value);
            if (accessOf(r) === 'active') { claimNote.textContent = 'Your access is open.'; code.value = ''; onOpened(); }
            else claimNote.textContent = (r && typeof r.message === 'string' && r.message.slice(0, 300)) || 'That code could not be used.';      // server text: a plain string, cut, never markup
          } catch (err) { showError(claimError, err); }
        });
      } }, h('label', { for: 'wt-code' }, 'Invite code'), code, claimBtn, claimNote, claimError);

      const pwError = errorLine(), pwDone = h('p', { class: 'form-note', role: 'status' });
      const pw = h('input', { id: 'wt-password', type: 'password', autocomplete: 'new-password', minlength: '12', required: true });
      const pw2 = h('input', { id: 'wt-password2', type: 'password', autocomplete: 'new-password', minlength: '12', required: true });
      const pwSave = h('button', { class: 'button secondary', type: 'submit' }, 'Change password');
      const pwForm = h('form', { class: 'contact-form', onsubmit: async event => {
        event.preventDefault(); pwError.hidden = true; pwDone.textContent = '';
        if (!pwForm.reportValidity()) return;
        if (pw.value !== pw2.value) { showError(pwError, new Error('The two passwords don’t match.')); return; }
        await busy(pwSave, 'Saving…', async () => {
          try { await data.changePassword(pw.value); pw.value = pw2.value = ''; pwDone.textContent = 'Password changed.'; }
          catch (err) { showError(pwError, err); }
        });
      } }, h('label', { for: 'wt-password' }, 'New password (at least 12 characters)'), pw, h('label', { for: 'wt-password2' }, 'The same again'), pw2, pwSave, pwDone, pwError);

      const delError = errorLine(), delNote = h('p', { class: 'form-note', role: 'status' });
      const typed = h('input', { id: 'wt-delete-email', type: 'email', autocomplete: 'off', required: true });
      const del = h('button', { class: 'button danger', type: 'submit' }, 'Delete my account');
      const delForm = h('form', { class: 'contact-form', onsubmit: async event => {
        event.preventDefault(); delError.hidden = true;
        if (!delForm.reportValidity()) return;
        if (!confirm('Delete your account? This can’t be undone.')) return;
        await busy(del, 'Deleting…', async () => {
          try {
            const result = await data.deleteAccount(typed.value);
            if (result?.status === 'deleted') { await data.signOut(); return; }
            delNote.textContent = result?.message || 'Your request is recorded.';
          } catch (err) { showError(delError, err); }
        });
      } }, h('label', { for: 'wt-delete-email' }, 'Type your email to confirm'), typed, del, delNote, delError);

      const signOut = h('button', { class: 'button secondary', type: 'button', id: 'wt-sign-out', onclick: () => data.signOut() }, 'Sign out');
      return [
        h('h1', { tabindex: '-1' }, WORDS.title),
        h('p', { class: 'form-intro', role: 'status' }, WORDS.line),
        h('p', { class: 'form-note' }, WORDS.detail),
        email ? h('p', { class: 'meta' }, `Signed in as ${email}`) : null,
        h('section', { class: 'account-section', 'aria-labelledby': 'wt-invite' }, h('h2', { id: 'wt-invite' }, 'Have an invite code?'),
          h('p', { class: 'form-note' }, 'A valid code opens your access now.'), claimForm),
        h('section', { class: 'account-section', 'aria-labelledby': 'wt-pw' }, h('h2', { id: 'wt-pw' }, 'Password'), pwForm),
        h('section', { class: 'account-section account-danger', 'aria-labelledby': 'wt-del' }, h('h2', { id: 'wt-del' }, 'Delete your account'),
          h('p', {}, 'This deletes your login and removes you from the list, at once.'), delForm),
        h('p', {}, signOut)
      ];
    }

    // #/admin/waiting: Ryan only. The server refuses everyone else; the page also asks isAppAdmin before drawing it.
    async function adminView() {
      const asked = await data.adminWaitingList();
      const rows = (Array.isArray(asked) ? asked : []).filter(r => r && typeof r === 'object' && typeof r.user_id === 'string');      // a row that is not an object with an id is ignored, not a crash
      const note = h('p', { class: 'form-note', role: 'status' }), error = errorLine();
      const body = h('ul', { class: 'wl-list' });
      const count = h('p', { class: 'meta', id: 'wl-count' });
      const fmt = iso => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); };
      const draw = list => {
        count.textContent = list.length === 1 ? '1 account is waiting.' : `${list.length} accounts are waiting.`;
        body.replaceChildren(...list.map(r => {
          // Only a confirmed address can be approved (the server refuses the others too): an unconfirmed row says so and has no button.
          if (r.confirmed !== true) {
            return h('li', { class: 'wl-row' }, h('span', { class: 'wl-who' }, h('strong', {}, r.email), h('span', { class: 'meta' }, ` joined ${fmt(r.joined_at)}, address not confirmed yet`)));
          }
          const b = h('button', { class: 'button primary', type: 'button', 'aria-label': `Approve ${r.email}` }, 'Approve');
          b.addEventListener('click', async () => {
            error.hidden = true; note.textContent = '';
            if (!confirm(`Open access for ${r.email}? They get the normal welcome credits and an email.`)) return;
            await busy(b, 'Approving…', async () => {
              try {
                const res = await data.adminApproveWaiting(r.user_id, 'approved in the admin page');
                note.textContent = (res && res.message) || `${r.email} is approved.`;
                draw(list.filter(x => x.user_id !== r.user_id));
              } catch (err) { showError(error, err); }
            });
          });
          return h('li', { class: 'wl-row' }, h('span', { class: 'wl-who' }, h('strong', {}, r.email), h('span', { class: 'meta' }, ` joined ${fmt(r.joined_at)}`)), b);
        }));
        if (!list.length) body.replaceChildren(h('li', { class: 'wl-row' }, 'Nobody is waiting.'));
      };
      draw(rows);
      return [
        h('a', { href: '#/', class: 'back' }, '← All projects'),
        h('h1', { tabindex: '-1' }, 'Waiting list'),
        h('p', { class: 'form-intro' }, 'Accounts made without an invite code. Approving one opens the app for that person with the normal welcome credits.'),
        count,
        body,
        note, error
      ];
    }
    return { waitingView, adminView };
  }

  window.ryagramWaiting = Object.freeze({ on, accessOf, pageFor, signUpProblem, signUp, waitingSummary, create, WORDS });
})();
