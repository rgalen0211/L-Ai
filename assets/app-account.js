// Account basics (consumer audit, 2026-10-17): change email, download my data, and a visible way to get help. Delete my account already lives on the account page.
//
// Change email is Supabase Auth's own flow: the person asks for a new address, a link goes to it (the email_change template), and the address changes only when they press the
// button on that page. Until then they keep signing in with the old one. Nothing is stored by this page.
// Download my data is built in the browser from the tables the person can already read as themselves (row-level security gives them only their own rows): a JSON file. It is NOT
// everything the database holds about them (a server-side export is proposed to CC1); the file says so, and says what it leaves out (rendered film files, uploaded spreadsheets).
// Everything from the server goes in as text nodes, never as HTML.
(() => {
  const NOT_IN_THE_FILE = [
    'Your rendered films and contact sheets are not inside this file: each one has an Open link in its version’s Files list.',
    'Spreadsheets you uploaded are not inside this file: you already have the originals.',
    'Records that belong to the service rather than to you (payment events, abuse reports, internal logs) are not shown to you and are not in this file.'
  ];
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  // ---------------------------------------------------------------- pure helpers (tested in node)
  function emailProblem(next, current) {
    const e = String(next || '').trim();
    if (!e) return 'Type the new email address.';
    if (e.length > 254 || !EMAIL.test(e)) return 'That doesn’t look like an email address.';
    if (e.toLowerCase() === String(current || '').trim().toLowerCase()) return 'That is already your email address.';
    return null;
  }
  const sentLine = email => `We sent a link to ${email}. Your email address changes when you press the button in it. Until then, keep signing in with your current one. Check spam too.`;

  // The export object from what the page collected. `parts` maps a name to rows (or to {error} when a table could not be read, so the file says what is missing).
  function buildExport(parts, { email, now = new Date() } = {}) {
    const out = { exported_at: now.toISOString(), what_this_is: 'Your Ryagram data as you can read it: your own rows, in JSON. It is not a full copy of everything the service holds (see not_in_this_file).', account: { email: email || '' } };
    const missing = [];
    for (const [name, rows] of Object.entries(parts)) {
      if (rows && rows.error) { missing.push(`${name}: ${rows.error}`); out[name] = []; } else out[name] = Array.isArray(rows) ? rows : rows == null ? [] : rows;
    }
    out.not_in_this_file = [...NOT_IN_THE_FILE, ...missing.map(m => `Could not be read just now: ${m}`)];
    return out;
  }
  const fileName = (now = new Date()) => `ryagram-my-data-${now.toISOString().slice(0, 10)}.json`;

  // ---------------------------------------------------------------- the screens
  function create(ctx) {
    const { h, data, busy, showError, errorLine, download = (name, text) => {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } } = ctx;

    async function changeEmailSection(currentEmail) {
      const error = errorLine();
      const done = h('p', { class: 'form-note', role: 'status' });
      const input = h('input', { id: 'acct-new-email', type: 'email', autocomplete: 'email', required: true, maxlength: '254' });
      const send = h('button', { class: 'button secondary', type: 'submit' }, 'Send a confirmation link');
      const form = h('form', { class: 'contact-form', novalidate: true, onsubmit: async event => {
        event.preventDefault();
        error.hidden = true; done.textContent = '';
        const problem = emailProblem(input.value, currentEmail);
        if (problem) { showError(error, new Error(problem)); return; }
        await busy(send, 'Sending…', async () => {
          try { await data.changeEmail(input.value.trim()); done.textContent = sentLine(input.value.trim()); input.value = ''; } catch (err) { showError(error, err); }
        });
      } }, h('label', { for: 'acct-new-email' }, 'New email address'), input, send, done, error);
      return h('section', { class: 'account-section', 'aria-labelledby': 'acct-email-h' }, h('h2', { id: 'acct-email-h' }, 'Email address'),
        h('p', { class: 'form-note' }, currentEmail ? `You sign in with ${currentEmail}.` : 'Change the address you sign in with.'), form);
    }

    function exportSection(currentEmail) {
      const error = errorLine();
      const done = h('p', { class: 'form-note', role: 'status' });
      const button = h('button', { class: 'button secondary', type: 'button' }, 'Download my data');
      button.addEventListener('click', async () => {
        error.hidden = true; done.textContent = '';
        await busy(button, 'Collecting…', async () => {
          try {
            const parts = await data.collectMyData();
            const file = buildExport(parts, { email: currentEmail });
            download(fileName(), JSON.stringify(file, null, 2));
            done.textContent = `Your file ${fileName()} was made on this device. ${file.not_in_this_file.length ? 'It says what it leaves out.' : ''}`;
          } catch (err) { showError(error, err); }
        });
      });
      return h('section', { class: 'account-section', 'aria-labelledby': 'acct-export' }, h('h2', { id: 'acct-export' }, 'Download your data'),
        h('p', { class: 'form-note' }, 'A file with your projects, every version’s story, your jobs, credits and requests. It is made here on your device and goes nowhere. Your films and uploaded spreadsheets are not inside it.'), h('p', {}, button), done, error);
    }

    function helpSection() {
      return h('section', { class: 'account-section', 'aria-labelledby': 'acct-help' }, h('h2', { id: 'acct-help' }, 'Help'),
        h('p', {}, 'Questions about your account? ', h('a', { href: '/help/' }, 'Read the help pages'), ' for answers and a way to ask us.'));
    }

    return { changeEmailSection, exportSection, helpSection };
  }

  window.ryagramAccount = { create, emailProblem, sentLine, buildExport, fileName, NOT_IN_THE_FILE };
})();
