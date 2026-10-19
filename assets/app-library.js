// Ryagram library views (2A-2): projects -> versions (r1, r2, ...) -> one version.
// Routes: #/ (projects), #/p/<id> (a project), #/v/<id> (a version, with its
// render panel: 2A-3).
// Everything from the database goes in as text nodes, never as HTML.
(() => {
  const EDITABLE = ['draft', 'sampling', 'previewing', 'editorial_action_required', 'ready_to_render'];
  const STATE_LABELS = {
    draft: 'Draft', sampling: 'Sampling', previewing: 'Previewing',
    editorial_action_required: 'Needs a decision', ready_to_render: 'Ready to render',
    queued: 'Queued', rendering: 'Rendering', validating: 'Checking', uploading: 'Uploading',
    complete: 'Complete', failed: 'Failed', archived: 'Archived', non_restorable: 'Can’t be rebuilt'
  };
  const KIND_LABELS = {
    final_video: 'Final film', preview: 'Preview', contact_sheet: 'Contact sheet', thumbnail: 'Thumbnail',
    receipt: 'Receipt (JSON)', receipt_text: 'Receipt', metering: 'Metering'
  };
  const UUID = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';

  function h(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (key === 'class') el.className = value;
      else if (key === 'value') el.value = value;
      else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
      if (child != null && child !== false) el.append(child);   // strings become text nodes
    }
    return el;
  }

  const date = iso => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const badge = state => h('span', { class: `state state-${state}` }, STATE_LABELS[state] || state);
  function bytes(n) {
    if (n == null) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
    return `${i ? n.toFixed(1) : n} ${units[i]}`;
  }

  // Credits show once the 2B ledger is live (credits: true in ryagram-config.js), or in mock mode.
  const creditsOn = () => window.ryagramConfig?.credits === true || !!window.ryagramMock;
  // Buying credits (Stripe) shows once checkout and the webhook are deployed (payments: true), or in mock mode.
  // Public film pages show once the film-page function is deployed (filmPages: true), or in mock mode.
  const filmPagesOn = () => window.ryagramConfig?.filmPages === true || !!window.ryagramMock;
  // Data choice and account deletion show once SQL 0900 and delete-account are live (accountTools: true), or in mock mode.
  const byodGuideOn = () => (window.ryagramConfig?.uploads === true && window.ryagramConfig?.byodGuide === true) || !!window.ryagramMock;
  const uploadsOn = () => window.ryagramConfig?.uploads === true || !!window.ryagramMock;
  const accountToolsOn = () => window.ryagramConfig?.accountTools === true || !!window.ryagramMock;
  // The delayed-rendering notice and the help form show once SQL 20261010000100 is applied (opsTools: true), or in mock mode.
  // Full renders go through request_final_render (and its approval queue) once SQL 20261017000500/600 are applied (renderOrders: true), or in mock mode.
  // Ryan 2026-10-18: the same words on the delivery page and the public film page (assets/film.js).
  const AI_LABEL = 'AI-assisted (Ryagram)';
  const ordersOn = () => window.ryagramConfig?.renderOrders === true || !!window.ryagramMock;
  // Connecting an AI (the consent page and Connected AIs) shows once CONNECT's SQL and function are live (connectAi: true), or in mock mode.
  const connectOn = () => window.ryagramConfig?.connectAi === true || !!window.ryagramMock;
  const requestsOn = () => window.ryagramConfig?.filmRequests === true || !!window.ryagramMock;   // the creator beta's film requests (SQL 20261016000200)
  const funnelOn = () => window.ryagramConfig?.funnelTracking === true || !!window.ryagramMock;
  const opsOn = () => window.ryagramConfig?.opsTools === true || !!window.ryagramMock;
  const paymentsOn = () => creditsOn() && (window.ryagramConfig?.payments === true || !!window.ryagramMock);

  function mount(root, data) {
    let token = 0;
    let stopView = () => {};                      // timers and subscriptions of the page on screen

    async function route() {
      const mine = ++token;
      const hash = location.hash;
      const stops = [];
      const onStop = fn => stops.push(fn);
      if (!root.childElementCount) root.replaceChildren(h('p', { class: 'form-intro loading', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Loading…'));
      let view;
      try {
        let m;
        if ((m = hash.match(new RegExp(`^#/p/${UUID}$`)))) view = await projectView(m[1]);
        else if ((m = hash.match(new RegExp(`^#/v/${UUID}$`)))) view = await versionView(m[1], onStop);
        else if (hash === '#/account') view = await accountView();
        else if (ordersOn() && (m = hash.match(new RegExp(`^#/delivery/${UUID}$`)))) view = await deliveryView(m[1]);
        else if (connectOn() && window.ryagramConnect.requestFromHash(hash)) view = await connectUi().consentView(window.ryagramConnect.requestFromHash(hash));
        else if (requestsOn() && hash === '#/request') view = await requestView();
        else if (opsOn() && (hash === '#/help' || /^#\/help\?job=/.test(hash))) view = await helpView();
        else if (hash === '#/admin/waitlist' && await data.isAppAdmin()) view = await waitlistAdminView(onStop);
        else if (hash === '#/admin/visits' && await data.isAppAdmin()) view = await visitsAdminView(onStop);
        else if (opsOn() && hash === '#/admin/ops' && await data.isAppAdmin()) view = await opsAdminView(onStop);
        else if (funnelOn() && hash === '#/admin/funnel' && await data.isAppAdmin()) view = await funnelAdminView(onStop);
        else if (ordersOn() && hash === '#/admin/renders' && await data.isAppAdmin()) view = await rendersAdminView(onStop);
        else if (paymentsOn() && (m = hash.match(/^#\/credits(?:\?paid=((?:pack|sub)_[a-z]+))?$/))) view = await creditsView(m[1], onStop);
        else view = await libraryView();
      } catch (err) {
        view = [h('h1', { tabindex: '-1' }, 'Something went wrong'),
                h('p', { class: 'app-error', role: 'alert' }, err.message),
                h('a', { href: '#/' }, 'Back to your projects')];
      }
      if (mine !== token) { stops.forEach(fn => fn()); return; }   // a newer page load won
      stopView();
      stopView = () => stops.forEach(fn => fn());
      const notice = opsOn() ? await delayedNotice() : null;      // after the page is ready; never blocks it (no answer = no notice)
      if (mine !== token) return;
      root.replaceChildren(...[notice, view].flat(Infinity).filter(x => x != null && x !== false));   // optional parts may be null
      root.querySelector('h1')?.focus();
    }

    async function delayedNotice() {
      const text = window.ryagramOps.bannerText(await data.serviceStatus());
      return text ? h('p', { class: 'app-status', role: 'status' }, text) : null;
    }

    // --- #/help  the help form. Signed-in people's job (from #/help?job=<id>) is attached by the server.
    async function helpView() {
      const O = window.ryagramOps;
      const job = O.jobFromHash(location.hash);
      const known = window.ryagramApp?.client ? ((await window.ryagramApp.client.auth.getSession()).data.session?.user?.email || '') : '';
      const error = errorLine();
      const done = h('p', { class: 'form-note', role: 'status', hidden: true });
      const email = h('input', { id: 'help-email', type: 'email', required: true, maxlength: '200', autocomplete: 'email', value: known });
      const topics = O.TOPICS.map(([id, label]) => h('label', { class: 'choice' },
        h('input', { type: 'radio', name: 'help-topic', value: id, ...(id === (job ? 'render' : 'other') ? { checked: true } : {}) }), ' ', label));
      const topicValue = () => form.querySelector('input[name="help-topic"]:checked')?.value;
      const message = h('textarea', { id: 'help-message', required: true, rows: '6', maxlength: '4000' });
      const trap = h('input', { id: 'help-website', name: 'website', type: 'text', tabindex: '-1', autocomplete: 'off' });   // honeypot
      const send = h('button', { class: 'button primary', type: 'submit' }, 'Send');
      const form = h('form', { class: 'contact-form', onsubmit: async event => {
        event.preventDefault();
        error.hidden = true;
        const problem = O.checkSupport({ email: email.value, topic: topicValue(), message: message.value });
        if (problem) { showError(error, new Error(problem)); return; }
        await busy(send, 'Sending\u2026', async () => {
          try {
            const id = await data.submitSupport({ email: email.value.trim(), topic: topicValue(), message: message.value.trim(), job, website: trap.value });
            form.hidden = true;
            done.textContent = `Thank you. We got it${Number(id) > 0 ? ` (ticket #${id})` : ''} and will reply to ${email.value.trim()} within 2 working days.`;
            done.hidden = false;
          } catch (err) { showError(error, err); }
        });
      } },
        h('label', { for: 'help-email' }, 'Your email'), email,
        h('fieldset', { class: 'choices' }, h('legend', {}, 'What is it about?'), topics),
        h('label', { for: 'help-message' }, 'What happened?'), message,
        h('div', { class: 'hp-field', 'aria-hidden': 'true' }, h('label', { for: 'help-website' }, 'Leave this empty'), trap),
        job ? h('p', { class: 'form-note' }, 'This message will include the film you came from, so we can look into it. We never see its contents.') : null,
        send, error);
      return [h('a', { href: '#/', class: 'back' }, '\u2190 All projects'), h('h1', { tabindex: '-1' }, 'Get help'),
              h('p', { class: 'form-note' }, 'Common questions are answered in the ', h('a', { href: '/help/' }, 'help pages'), '. Otherwise write to us here and we reply within 2 working days.'),
              form, done];
    }

    function errorLine() {
      return h('p', { class: 'form-note app-error', role: 'alert', hidden: true });
    }
    function showError(el, err) {
      el.textContent = err.message;
      el.hidden = false;
    }
    async function busy(button, label, work) {
      const was = button.textContent;
      button.disabled = true;
      button.textContent = label;
      try { await work(); } finally { button.disabled = false; button.textContent = was; }
    }

    // Connecting an AI (assets/app-connect.js): built once, with this page's helpers.
    let connectCache = null;
    const connectUi = () => connectCache || (connectCache = window.ryagramConnect.create({ h, data, busy, showError, errorLine, date }));

    // --- #/  all projects
    async function libraryView() {
      const projects = await data.listProjects();
      const error = errorLine();
      const input = h('input', { id: 'np-title', name: 'title', required: true, maxlength: '200', autocomplete: 'off',
                                 placeholder: 'What’s the story?' });
      const create = h('button', { class: 'button primary', type: 'submit' }, 'Create');
      const form = h('form', { class: 'inline-form', onsubmit: async event => {
        event.preventDefault();
        if (!form.reportValidity()) return;
        error.hidden = true;
        await busy(create, 'Creating…', async () => {
          try {
            const { version } = await data.createProject(input.value);
            location.hash = `#/v/${version.id}`;
          } catch (err) { showError(error, err); }
        });
      } }, h('label', { for: 'np-title' }, 'New project'), h('div', { class: 'inline-row' }, input, create), error);

      const list = projects.length
        ? h('ul', { class: 'project-list' }, projects.map(p => h('li', {},
            h('a', { href: `#/p/${p.id}` }, p.title),
            h('span', { class: 'meta' },
              p.latest ? [`r${p.latest.number} · `, badge(p.latest.state), ` · updated ${date(p.updated_at)}`]
                       : `No versions · updated ${date(p.updated_at)}`))))
        : h('p', { class: 'form-intro' }, 'No projects yet. A project is one film you are making. Name it above, then pick a ready-made film to start from.');
      const credits = creditsOn() ? h('p', { class: 'credit-balance' }, 'Loading credits…') : null;
      if (credits) data.creditBalances().then(rows => {
        credits.replaceChildren(window.ryagramCredits.balanceLine(rows),
                                ...(paymentsOn() ? [' · ', h('a', { href: '#/credits' }, 'Buy credits')] : []));
      }).catch(() => { credits.textContent = 'Couldn’t load your credits.'; });
      // Ryan only: the link appears once is_app_admin() says so (never before its SQL is applied).
      const adminLinks = h('p', { class: 'meta admin-links', hidden: true }, h('a', { href: '#/admin/waitlist' }, 'Waitlist by film'), ' \u00b7 ', h('a', { href: '#/admin/visits' }, 'Visits and signups'), ...(opsOn() ? [' \u00b7 ', h('a', { href: '#/admin/ops' }, 'Operations')] : []), ...(ordersOn() ? [' \u00b7 ', h('a', { href: '#/admin/renders' }, 'Render approvals')] : []), ...(funnelOn() ? [' \u00b7 ', h('a', { href: '#/admin/funnel' }, 'Funnel by day')] : []));
      data.isAppAdmin().then(yes => { adminLinks.hidden = !yes; });
      const help = opsOn() ? h('p', { class: 'meta' }, h('a', { href: '#/help' }, 'Get help')) : null;
      const requestLink = requestsOn() ? h('p', { class: 'meta' }, h('a', { href: '#/request' }, 'Request a film')) : null;
      const creditsNote = creditsOn() ? h('p', { class: 'form-note' }, 'Credits pay for full films and for previews beyond your free ones. Contact sheets are free.') : null;
      return [h('h1', { tabindex: '-1' }, 'Your projects'), h('p', { class: 'form-intro' }, 'Each project is one film. Start one below and Ryagram draws it from public data, with its sources shown.'),
              credits, creditsNote, requestLink, adminLinks, form, list, help];
    }

    // --- #/admin/waitlist  Ryan only: signups per film link (utm_campaign) per day. Counts only.
    async function waitlistAdminView(onStop) {
      const A = window.ryagramAdmin;
      const error = errorLine();
      const range = h('select', { id: 'wl-days' },
        [[30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last year']].map(([d, t]) => h('option', { value: String(d) }, t)));
      range.value = '90';
      const body = h('div', { class: 'admin-body' }, h('p', { class: 'form-note' }, 'Loading\u2026'));
      async function load() {
        error.hidden = true;
        try {
          const rows = await data.waitlistByFilm(Number(range.value));
          const totals = A.byFilm(rows);
          const total = totals.reduce((n, r) => n + r.signups, 0);
          body.replaceChildren(
            h('p', {}, `${total.toLocaleString('en-US')} signup${total === 1 ? '' : 's'} in this period.`),
            totals.length ? h('table', { class: 'admin-table' },
              h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Film link'), h('th', { scope: 'col' }, 'From'), h('th', { scope: 'col', class: 'num' }, 'Signups'))),
              h('tbody', {}, totals.map(r => h('tr', {}, h('td', {}, A.campaignLabel(r.campaign)), h('td', {}, r.utm_source || '\u2014'),
                                                     h('td', { class: 'num' }, String(r.signups)))))) : '',
            ...(rows.length ? [h('h2', {}, 'By day'), h('table', { class: 'admin-table' },
              h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Day'), h('th', { scope: 'col' }, 'Film link'), h('th', { scope: 'col', class: 'num' }, 'Signups'))),
              h('tbody', {}, rows.map(r => h('tr', {}, h('td', {}, A.dayLabel(r.day)), h('td', {}, A.campaignLabel(r.campaign)),
                                                   h('td', { class: 'num' }, String(r.signups))))))] : []));
        } catch (err) { body.replaceChildren(); showError(error, err); }
      }
      range.addEventListener('change', load);
      load();
      return [
        h('a', { href: '#/', class: 'back' }, '\u2190 All projects'),
        h('h1', { tabindex: '-1' }, 'Waitlist by film'),
        h('p', { class: 'form-note' }, 'Signups per film link (the utm_campaign in each film\u2019s description), by day in New York time. Counts only: no email addresses are shown here.'),
        h('div', { class: 'inline-row' }, h('label', { for: 'wl-days' }, 'Period'), range),
        body, error
      ];
    }

    // --- #/request  a creator asks for a film: the question, what it costs, and where each request stands (Ryan makes it by hand for now)
    // --- #/delivery/<id>  a delivered film (kept 30 days): the link is signed for an hour, by the database's say-so
    async function deliveryView(id) {
      let got = null, problem = '';
      try { got = await data.deliveryUrl(id); } catch (err) { problem = err.message; }
      return [h('a', { href: '#/', class: 'back' }, '\u2190 All projects'), h('h1', { tabindex: '-1' }, 'Your film'),
        got ? [h('video', { controls: true, preload: 'metadata', src: got.url }), h('p', {}, h('a', { class: 'button secondary', href: got.url, rel: 'noopener noreferrer', target: '_blank' }, 'Open or download')),
               h('p', { class: 'form-note' }, `${AI_LABEL}. This film is kept for 30 days, then deleted. This link works for an hour; come back to this page for a new one.`)]
            : h('p', { class: 'app-error', role: 'alert' }, problem)];
    }

    async function requestView() {
      const O = window.ryagramOps;
      const error = errorLine();
      const done = h('p', { class: 'form-note', role: 'status', hidden: true });
      const cost = h('p', { class: 'form-note' }, O.requestCostLine(null));
      const balance = h('p', { class: 'credit-balance form-note' }, creditsOn() ? 'Loading credits\u2026' : '');
      const question = h('textarea', { id: 'rq-question', name: 'question', rows: '4', required: true, minlength: '10', maxlength: '1000', placeholder: 'For example: Did cities that legalized duplexes build more homes within five years?' });
      const notes = h('textarea', { id: 'rq-notes', name: 'notes', rows: '3', maxlength: '1000', placeholder: 'Anything that helps: the years, the places, the data you have in mind' });
      const send = h('button', { class: 'button primary', type: 'submit' }, 'Send request');
      const list = h('div', { class: 'request-list' });
      async function reload() {
        const [rows, c, bal] = await Promise.all([data.myFilmRequests().catch(() => []), data.filmRequestCost().catch(() => null), creditsOn() ? data.creditBalances().catch(() => null) : null]);
        cost.textContent = O.requestCostLine(c);
        if (bal) balance.replaceChildren(window.ryagramCredits.balanceLine(bal));
        list.replaceChildren(rows.length ? h('ul', { class: 'project-list' }, rows.map(r => h('li', {},
          h('strong', {}, `#${r.id} ${O.REQUEST_STATUS_WORDS[r.status] || r.status}`), h('span', { class: 'meta' }, ` ${date(r.created_at)}, ${r.credits} credits`),
          h('p', {}, r.question),
          r.admin_note ? h('p', { class: 'form-note' }, `Note: ${r.admin_note}`) : null,
          r.status === 'delivered' && r.delivered_url ? h('p', {}, h('a', { href: r.delivered_url, rel: 'noopener noreferrer', target: '_blank' }, 'Watch your film')) : null)))
          : h('p', { class: 'form-note' }, 'No requests yet.'));
      }
      const form = h('form', { class: 'contact-form', onsubmit: async event => {
        event.preventDefault();
        error.hidden = true; done.hidden = true;
        const problem = O.checkRequest({ question: question.value, notes: notes.value });
        if (problem) { showError(error, new Error(problem)); return; }
        await busy(send, 'Sending\u2026', async () => {
          try {
            const id = await data.requestFilm(question.value.trim(), notes.value.trim());
            question.value = ''; notes.value = '';
            done.textContent = `Request #${id} sent. You can follow it below; the film appears here when it is ready.`;
            done.hidden = false;
            await reload();
          } catch (err) { showError(error, err); }
        });
      } }, h('label', { for: 'rq-question' }, 'The question you want answered'), question,
           h('label', { for: 'rq-notes' }, 'Notes (optional)'), notes, send, error);
      await reload();
      return [h('a', { href: '#/', class: 'back' }, '\u2190 All projects'), h('h1', { tabindex: '-1' }, 'Request a film'),
              h('p', { class: 'form-note' }, 'Tell us the question you want data to answer. We make the film and send it back here. This is a private beta, so each one is made by hand.'),
              balance, cost, form, done, h('h2', {}, 'Your requests'), list];
    }

    // --- #/admin/ops  Ryan only: is it all running, and what needs him. Counts and ids; the three buttons are the only changes.
    // --- #/admin/funnel  Ryan only, read-only: people at each step, day by day (signups, first preview, first order). Behind the funnelTracking flag; nothing here changes anything.
    async function funnelAdminView(onStop) {
      const O = window.ryagramOps;
      const error = errorLine();
      const out = h('div', {}, h('p', { class: 'form-note' }, 'Loading\u2026'));
      let days = 14;
      async function load() {
        let got;
        try { got = await data.adminFunnelEvents(days); } catch (err) { out.replaceChildren(); showError(error, err); return; }
        error.hidden = true;
        const d = O.funnelDaily(got.rows, { days });
        out.replaceChildren(
          h('p', {}, [7, 14, 30].map(n => h('button', { class: `button secondary small${n === days ? ' is-chosen' : ''}`, type: 'button', 'aria-pressed': String(n === days), onclick: async () => { days = n; await load(); } }, `${n} days`)), ' '),
          h('p', { class: 'form-note' }, O.funnelDailyLine(d)),
          got.truncated ? h('p', { class: 'form-note' }, 'Very busy: only the newest 50,000 events were counted.') : '',
          h('table', { class: 'admin-table funnel-days' }, h('thead', {}, h('tr', {}, h('th', {}, 'Day (Eastern)'), d.steps.map(s => h('th', { class: 'num' }, O.DAY_LABELS[s])))),
            h('tbody', {}, d.days.map(r => h('tr', {}, h('td', {}, r.day), d.steps.map(s => h('td', { class: 'num' }, String(r.counts[s]))))),
              h('tr', { class: 'funnel-total' }, h('th', {}, 'Total'), d.steps.map(s => h('th', { class: 'num' }, String(d.totals[s])))))),
          h('p', { class: 'form-note' }, 'Visits are counted each time; every other step counts an account once, the first time it happens. This page only reads.'));
      }
      await load();
      return [h('a', { href: '#/', class: 'back' }, '\u2190 All projects'), h('h1', { tabindex: '-1' }, 'Funnel by day'),
        h('p', { class: 'form-note' }, 'Signups \u2192 first preview \u2192 first order, counted day by day from our own database. No third-party tools.'), out, error];
    }

    // --- #/admin/renders  Ryan only: the full renders waiting for approval. Approve starts the render; Decline returns the credits. Redrawn after each call returns.
    async function rendersAdminView(onStop) {
      const O = window.ryagramOps;
      const error = errorLine();
      const out = h('div');
      const note = id => h('input', { type: 'text', maxlength: '500', autocomplete: 'off', placeholder: 'Note (optional)', 'aria-label': `Note for request ${id}` });
      async function load() {
        let rows;
        try { rows = await data.adminRenderQueue(); } catch (err) { out.replaceChildren(); showError(error, err); return; }
        const now = Date.now();
        out.replaceChildren(h('p', { class: 'form-note' }, O.renderQueueLine(rows)),
          rows.length ? h('ul', { class: 'ops-list render-queue' }, rows.map(r => {
            const n = note(r.stage_id.slice(0, 8));
            const decide = (approve, label, busyLabel) => h('button', { class: `button ${approve ? 'primary' : 'secondary'} small`, type: 'button', onclick: async event => {
              if (!approve && !confirm(`Decline this full render? ${r.credits_held} credit${r.credits_held === 1 ? '' : 's'} go back to ${r.owner_email || 'the person'}.`)) return;
              error.hidden = true;
              await busy(event.currentTarget, busyLabel, async () => {
                try { await data.adminRenderDecide(r.stage_id, approve, n.value.trim()); await load(); } catch (err) { showError(error, err); }
              });
            } }, label);
            return h('li', {}, h('strong', {}, r.film_title || 'A film'), h('span', { class: 'meta' }, ` ${r.owner_email || 'an account'}, ${O.RENDER_SOURCE_WORDS[r.source] || r.source}, ${r.credits_held} credit${r.credits_held === 1 ? '' : 's'} held`),
              h('p', { class: 'form-note' }, O.renderWhen(r, now)), h('div', { class: 'inline-row' }, n, ' ', decide(true, 'Approve', 'Approving\u2026'), ' ', decide(false, 'Decline', 'Declining\u2026')),
              r.owner_id ? capRow(r) : null);
          })) : '');
      }
      // A cap for the person who asked (the queue knows their id; the caps list below only shows people who already have one)
      const capRow = r => {
        const input = h('input', { type: 'text', inputmode: 'numeric', maxlength: '6', size: '6', placeholder: 'credits a day', 'aria-label': `Daily cap for ${r.owner_email || 'this person'}` });
        const btn = h('button', { class: 'button secondary small', type: 'button' }, 'Set daily cap');
        btn.addEventListener('click', async () => {
          if (!input.value.trim()) { showError(error, new Error('Type how many credits a day first.')); return; }          // an empty box would delete the cap
          const checked = O.checkCap(input.value);
          if (checked.error) { showError(error, new Error(checked.error)); return; }
          error.hidden = true;
          await busy(btn, 'Saving\u2026', async () => { try { await data.adminSetUserCap(r.owner_id, checked.value); input.value = ''; await loadCaps(); } catch (err) { showError(error, err); } });
        });
        return h('div', { class: 'inline-row' }, input, ' ', btn);
      };
      // --- the auto-render switch and the per-person daily caps (existing admin functions only)
      const switchBox = h('div', { class: 'render-switch' });
      const capsBox = h('div', { class: 'render-caps' });
      async function loadSwitch() {
        let s;
        try { s = await data.adminAutoRender(); } catch (err) { switchBox.replaceChildren(); showError(error, err); return; }
        switchBox.replaceChildren(h('p', { class: s.on ? 'form-note switch-on' : 'form-note' }, O.autoRenderLine(s.on)),
          h('button', { class: `button ${s.on ? 'secondary' : 'primary'} small`, type: 'button', id: 'auto-render-toggle', onclick: async event => {
            const turningOn = !s.on;
            if (turningOn && !confirm('Turn auto-render ON? New full renders will start at once, without your approval. Requests already waiting stay waiting and still need your decision. Daily caps still apply.')) return;
            error.hidden = true;
            await busy(event.currentTarget, 'Saving\u2026', async () => {
              try { await data.adminSetAutoRender(turningOn); await loadSwitch(); await load(); } catch (err) { showError(error, err); }
            });
          } }, s.on ? 'Turn auto-render off' : 'Turn auto-render on'),
          s.defaultCap == null ? '' : h('p', { class: 'form-note' }, `Everyone without their own cap gets ${s.defaultCap} credit${s.defaultCap === 1 ? '' : 's'} a day.`));
      }
      async function loadCaps() {
        let caps;
        try { caps = await data.adminUserCaps(); } catch (err) { capsBox.replaceChildren(); showError(error, err); return; }
        const save = async (owner, text, button, after) => {
          const checked = O.checkCap(text);
          if (checked.error) { showError(error, new Error(checked.error)); return; }
          error.hidden = true;
          await busy(button, 'Saving\u2026', async () => { try { await data.adminSetUserCap(owner, checked.value); await after(); } catch (err) { showError(error, err); } });
        };
        capsBox.replaceChildren(h('h2', {}, 'Daily credit caps'),
          h('p', { class: 'form-note' }, 'A cap limits how many credits one person can spend in 24 hours. Empty and Save puts a person back on the default.'),
          caps.length ? h('ul', { class: 'ops-list' }, caps.map(c => {
            const input = h('input', { type: 'text', inputmode: 'numeric', value: String(c.credits_per_day), 'aria-label': `Daily cap for ${c.email || 'this account'}`, maxlength: '6', size: '6' });
            const btn = h('button', { class: 'button secondary small', type: 'button' }, 'Save');
            btn.addEventListener('click', () => save(c.owner_id, input.value, btn, loadCaps));
            return h('li', {}, h('span', { class: 'meta' }, O.capLine(c)), h('div', { class: 'inline-row' }, input, ' ', btn));
          })) : h('p', { class: 'form-note' }, 'Nobody has their own cap yet. Set one from a waiting request above.'));
      }
      await Promise.all([loadSwitch(), loadCaps(), load()]);
      return [h('a', { href: '#/', class: 'back' }, '\u2190 All projects'), h('h1', { tabindex: '-1' }, 'Render approvals'),
        switchBox, h('p', { class: 'form-note' }, 'Full renders wait here while auto-render is off. The person\u2019s credits are held until you decide.'), out, capsBox, error];
    }

    async function opsAdminView(onStop) {
      const O = window.ryagramOps;
      const error = errorLine();
      const body = h('div', { class: 'admin-body' }, h('p', { class: 'form-note' }, 'Loading\u2026'));
      const section = (title, ...kids) => h('section', { class: 'ops-section' }, h('h2', {}, title), ...kids);
      const none = text => h('p', { class: 'form-note' }, text);
      const button = (label, work) => h('button', { class: 'button secondary small', type: 'button', onclick: async event => {
        await busy(event.currentTarget, 'Saving\u2026', async () => { try { await work(); await load(); } catch (err) { showError(error, err); } });
      } }, label);
      // --- the invite code just made (shown ONCE: the database keeps only its hash) with a mailto: link, so Ryan reads and sends the email himself
      let invited = null;
      function invitePanel() {
        if (!invited) return null;
        const { name, email, code, credits } = invited;
        return h('div', { class: 'invite-panel', role: 'status' },
          h('p', {}, h('strong', {}, `Invite code for ${name}: `), h('code', {}, code), '  (shown once; copy it now)'),
          h('p', {}, h('a', { class: 'button secondary small', href: O.inviteMailto({ name, email, code, credits: credits == null ? null : credits }) }, `Email it to ${email}`), ' ',
            button('Done', async () => { invited = null; })));
      }
      // --- Invite someone: a friend Ryan names before the public form is live. The address is used ONLY for the mailto: link; the database gets the name and the credits.
      function invitePersonForm() {
        const name = h('input', { id: 'ip-name', name: 'name', type: 'text', required: true, maxlength: '100', autocomplete: 'off' });
        const email = h('input', { id: 'ip-email', name: 'email', type: 'email', required: true, maxlength: '320', autocomplete: 'off' });
        const credits = h('input', { id: 'ip-credits', name: 'credits', type: 'number', min: '0', max: '1000', step: '1', placeholder: 'the usual welcome credits' });
        return miniForm('Invite someone', [field('Their name', name), field('Their email (stays in your mail program)', email), field('Welcome credits (optional)', credits)], 'Make an invite code', async () => {
          const c = credits.value.trim() === '' ? null : Number(credits.value);
          const code = await data.adminInvitePerson(name.value, c);
          invited = { name: name.value.trim(), email: email.value.trim(), code, credits: c };
        });
      }
      // --- the film request queue: what creators asked for, to make by hand and then mark delivered (with the film's https link) or decline (credits go back)
      function queueSection(q, now) {
        if (!q) return section('Film requests', h('p', {}, 'Film requests are not set up yet (apply SQL 20261016000200).'));
        return section(`Film requests (${q.waiting})`,
          h('p', {}, q.waiting ? `${q.waiting} request${q.waiting === 1 ? '' : 's'} to make. Make each film on your PC, upload it, then paste its https link here.` : 'No requests waiting.'),
          q.items.length ? h('ul', { class: 'ops-list' }, q.items.map(r => {
            const url = h('input', { id: `fr-url-${r.id}`, type: 'url', placeholder: 'https:// link to the finished film', maxlength: '500' });
            const note = h('input', { id: `fr-note-${r.id}`, type: 'text', placeholder: 'Note to the creator (optional)', maxlength: '500' });
            return h('li', {},
              h('strong', {}, `#${r.id} ${O.REQUEST_STATUS_WORDS[r.status] || r.status}`), h('span', { class: 'meta' }, ` ${r.email || 'unknown'}, ${r.credits} credits, ${O.ago(r.created_at, now)}`),
              h('p', {}, 'Question: ', r.question), r.notes ? h('p', {}, 'Notes: ', r.notes) : null,
              h('div', { class: 'ops-form' }, h('label', { class: 'ops-field' }, 'Film link', url), h('label', { class: 'ops-field' }, 'Note', note)),
              r.status === 'new' ? button('Start', () => data.adminFilmRequestSet(r.id, 'in_progress', note.value, null)) : null, ' ',
              button('Mark delivered', async () => { const problem = O.checkDelivery(url.value); if (problem) throw new Error(problem); await data.adminFilmRequestSet(r.id, 'delivered', note.value, url.value.trim()); }), ' ',
              button(`Decline (returns ${r.credits} credits)`, () => data.adminFilmRequestSet(r.id, 'declined', note.value, null)));
          })) : null,
          q.recent.length ? h('details', { class: 'ops-details' }, h('summary', {}, 'Last 10 finished'),
            h('ul', { class: 'ops-list' }, q.recent.map(r => h('li', {}, `#${r.id} ${O.REQUEST_STATUS_WORDS[r.status] || r.status}: ${r.question}`,
              r.delivered_url ? [' ', h('a', { href: r.delivered_url, rel: 'noopener noreferrer', target: '_blank' }, 'film')] : null)))) : null);
      }
      // --- Costs: every $ event the ledger holds (Stripe's own fee per charge, plan fees, render cpu cost, storage and email readings, typed invoices),
      // a daily rollup, the limits Ryan sets, and the forms to state a plan, a rate or a cost. Unknown is shown as unknown, never as $0.
      const vendorSelect = (id, withAll) => h('select', { id, name: id },
        withAll ? [h('option', { value: '' }, 'All vendors')] : [],
        O.COST_VENDORS.map(([v, label]) => h('option', { value: v }, label)));
      const field = (label, input) => h('label', { class: 'ops-field' }, label, input);
      const miniForm = (summary, fields, submitLabel, run) => {
        const fail = errorLine();
        const submit = h('button', { class: 'button secondary small', type: 'submit' }, submitLabel);
        const form = h('form', { class: 'ops-form', onsubmit: async event => {
          event.preventDefault();
          fail.hidden = true;
          await busy(submit, 'Saving\u2026', async () => { try { await run(); await load(); } catch (err) { showError(fail, err); } });
        } }, fields, submit, fail);
        return h('details', { class: 'ops-details' }, h('summary', {}, summary), form);
      };
      // --- Funnel: counts per step, conversion between steps, by source and by week
      let funnelWeeks = 8;
      function funnelSection(f) {
        if (!f) return section('Funnel', h('p', {}, O.funnelLine(null)));
        const th = (t, numeric) => h('th', { scope: 'col', class: numeric ? 'num' : null }, t);
        const rows = O.funnelRows(f), srcs = O.funnelBySource(f), weeks = O.funnelByWeek(f);
        const label = e => O.FUNNEL_LABELS[e];
        return section(`Funnel (last ${funnelWeeks} weeks)`,
          h('p', { class: 'form-note' }, O.funnelLine(f)),
          h('p', {}, [4, 8, 12, 26].map(n => h('button', { class: `button secondary small${n === funnelWeeks ? ' is-chosen' : ''}`, type: 'button', 'aria-pressed': String(n === funnelWeeks),
            onclick: async () => { funnelWeeks = n; await load(); } }, `${n} weeks`)), ' '),
          h('table', { class: 'admin-table funnel-steps' },
            h('thead', {}, h('tr', {}, th('Step'), th('People', true), th('From the step before', true), th('From the first step', true))),
            h('tbody', {}, rows.map(r => h('tr', { class: r.side ? 'funnel-side' : null }, h('td', {}, r.label), h('td', { class: 'num' }, String(r.total)), h('td', { class: 'num' }, r.fromPrevious || '\u2014'),
              h('td', { class: 'num' }, r.fromFirst || '\u2014'))))),
          h('p', { class: 'form-note' }, 'The last four rows are measured against people who signed up.'),
          h('h3', {}, 'By source'),
          srcs.length ? h('table', { class: 'admin-table funnel-sources' },
            h('thead', {}, h('tr', {}, th('Source'), O.FUNNEL_KEY.map(e => th(label(e), true)), th('Visit to signup', true))),
            h('tbody', {}, srcs.map(r => h('tr', {}, h('td', {}, r.source), O.FUNNEL_KEY.map(e => h('td', { class: 'num' }, String(r.counts[e]))), h('td', { class: 'num' }, r.signupRate)))))
            : h('p', { class: 'form-note' }, 'Nothing recorded yet.'),
          h('h3', {}, 'By week (Monday starts, New York time)'),
          weeks.length ? h('table', { class: 'admin-table funnel-weeks' },
            h('thead', {}, h('tr', {}, th('Week'), O.FUNNEL_KEY.map(e => th(label(e), true)))),
            h('tbody', {}, weeks.map(r => h('tr', {}, h('td', {}, r.week), O.FUNNEL_KEY.map(e => h('td', { class: 'num' }, String(r.counts[e]))))))) : null);
      }
      function costSection(c, now) {
        if (!c) return section('Costs', h('p', {}, O.costLine(null)));
        const num = (id, extra) => h('input', { id, name: id, type: 'number', min: '0', step: 'any', required: true, ...(extra || {}) });
        const day = id => h('input', { id, name: id, type: 'date', required: true });
        const thVendor = vendorSelect('cost-th-vendor', true);
        const thPeriod = h('select', { id: 'cost-th-period' }, h('option', { value: 'day' }, 'per day'), h('option', { value: 'month' }, 'per month'));
        const thLimit = num('cost-th-limit', { min: '0.01' });
        const thWarn = num('cost-th-warn', { min: '1', max: '99', step: '1', value: '80' });
        const plVendor = vendorSelect('cost-pl-vendor', false);
        const plName = h('input', { id: 'cost-pl-name', name: 'plan', type: 'text', required: true, maxlength: '60', placeholder: 'For example: Pro' });
        const plMonthly = num('cost-pl-monthly');
        const plStart = day('cost-pl-start');
        const plGb = h('input', { id: 'cost-pl-gb', name: 'gb', type: 'number', min: '0', step: 'any', placeholder: 'optional' });
        const rtCpu = num('cost-rt-cpu');
        const mcVendor = vendorSelect('cost-mc-vendor', false);
        const mcAmount = num('cost-mc-amount');
        const mcDate = day('cost-mc-date');
        const mcNote = h('input', { id: 'cost-mc-note', name: 'note', type: 'text', maxlength: '300', placeholder: 'For example: uselai.com renewal' });
        const th = (t, numeric) => h('th', { scope: 'col', class: numeric ? 'num' : null }, t);
        return section('Costs',
          h('p', { class: c.thresholds.some(t => t.status === 'over') ? 'app-error' : '' }, O.costLine(c)),
          h('p', { class: 'form-note' }, O.usageLine(c.usage)),
          h('table', { class: 'admin-table' },
            h('thead', {}, h('tr', {}, th('Day'), th('Known total', true), th('By vendor'), th('Unknown', true))),
            h('tbody', {}, c.days.map(r => h('tr', {}, h('td', {}, r.day), h('td', { class: 'num' }, O.usd2(r.total_usd)),
              h('td', {}, Object.entries(r.by_vendor || {}).map(([v, n]) => `${O.vendorWord(v)} ${O.usd2(n)}`).join(', ') || '\u2014'),
              h('td', { class: 'num' }, r.unknown_events ? String(r.unknown_events) : '\u2014'))))),
          h('p', { class: 'form-note' }, 'This month by vendor: ', Object.entries(c.month.by_vendor || {}).map(([v, n]) => `${O.vendorWord(v)} ${O.usd2(n)}`).join(', ') || 'nothing known yet', '.'),
          h('h3', {}, 'Limits (you are emailed once when one is reached)'),
          c.thresholds.length ? h('ul', { class: 'ops-list' }, c.thresholds.map(t => h('li', { class: t.status === 'over' ? 'app-error' : '' }, O.thresholdLine(t), ' ',
            button('Remove', () => data.adminCostDeleteThreshold(t.id))))) : h('p', { class: 'form-note' }, 'No limits set yet. Nothing alarms until you set one.'),
          miniForm('Set a limit', [field('Vendor', thVendor), field('Per', thPeriod), field('Limit ($)', thLimit), field('Warn at (%)', thWarn)], 'Save limit', async () => {
            const input = { vendor: thVendor.value, period: thPeriod.value, limit: thLimit.value, warnPct: thWarn.value };
            const problem = O.checkThreshold(input);
            if (problem) throw new Error(problem);
            await data.adminCostSetThreshold(input.vendor, input.period, Number(input.limit), Number(input.warnPct));
          }),
          h('h3', {}, 'Plans you pay for'),
          c.plans.length ? h('ul', { class: 'ops-list' }, c.plans.map(p => h('li', {}, `${O.vendorWord(p.vendor)}: ${p.plan}, ${O.usd2(p.monthly_usd)} a month since ${p.starts_on}`))) : h('p', { class: 'form-note' }, 'No plans entered. Plan fees stay out of the totals until you enter them.'),
          miniForm('Enter a plan', [field('Vendor', plVendor), field('Plan', plName), field('Per month ($)', plMonthly), field('Starts on', plStart), field('Storage included (GB)', plGb)], 'Save plan', async () => {
            const input = { vendor: plVendor.value, plan: plName.value, monthly: plMonthly.value, startsOn: plStart.value };
            const problem = O.checkPlan(input);
            if (problem) throw new Error(problem);
            await data.adminCostSetPlan(input.vendor, input.plan.trim(), Number(input.monthly), input.startsOn, plGb.value ? { storage_gb: Number(plGb.value) } : {});
          }),
          h('h3', {}, 'Render cost per core-hour'),
          h('p', { class: 'form-note' }, c.rates.filter(r => r.vendor === 'render').length ? c.rates.filter(r => r.vendor === 'render').map(r => `${r.kind}: ${O.usd2(r.unit_usd)}${r.note ? ` (${r.note})` : ''}`).join('; ') : 'Not set, so every render\u2019s cost shows as unknown. On your own machine you may know it is $0 in cash; enter that only if you are sure.'),
          miniForm('Set the render rate', [field('One core-hour costs ($)', rtCpu)], 'Save rate', async () => {
            const n = Number(rtCpu.value);
            if (!Number.isFinite(n) || n < 0 || rtCpu.value.trim() === '') throw new Error('Enter the price in dollars (0 is allowed).');
            await data.adminCostSetRate('render', 'cpu_hour', n, 'stated by Ryan');
          }),
          h('h3', {}, 'A cost nothing here can see'),
          miniForm('Record a cost (an invoice, a renewal)', [field('Vendor', mcVendor), field('Amount ($)', mcAmount), field('Charged on', mcDate), field('Note', mcNote)], 'Record cost', async () => {
            const input = { vendor: mcVendor.value, amount: mcAmount.value, on: mcDate.value };
            const problem = O.checkManualCost(input);
            if (problem) throw new Error(problem);
            await data.adminCostRecord(input.vendor, Number(input.amount), input.on, mcNote.value.trim());
          }),
          h('details', { class: 'ops-details' }, h('summary', {}, 'Latest 15 recorded events'),
            c.recent.length ? h('ul', { class: 'ops-list' }, c.recent.map(r => h('li', {},
              `${O.vendorWord(r.vendor)} ${r.kind}: ${r.amount_usd == null ? 'unknown cost' : O.usd2(r.amount_usd)}${r.mode === 'live' ? '' : r.mode === 'test' ? ' (test mode)' : ' (mode unknown)'}`,
              h('span', { class: 'meta' }, ` ${O.ago(r.occurred_at, now)}`)))) : h('p', { class: 'form-note' }, 'Nothing recorded yet.')));
      }
      async function load() {
        error.hidden = true;
        let d;
        try { d = await data.adminOps(); } catch (err) { body.replaceChildren(); showError(error, err); return; }
        let cb = null;     // creator applications; null until their SQL is applied (the rest of the screen works without it)
        try { cb = await data.adminCreatorBeta(); } catch { cb = null; }
        let fr = null;     // the film request queue; null until SQL 20261016000200 is applied
        try { fr = await data.adminFilmRequests(); } catch { fr = null; }
        let cost = null;   // the cost ledger; null until its SQL is applied
        try { cost = await data.adminCostRollup(14); } catch { cost = null; }
        let funnel = null; // the funnel; null until SQL 20261017000900 is applied
        try { funnel = await data.adminFunnel(funnelWeeks); } catch { funnel = null; }
        const now = Date.now();
        body.replaceChildren(
          section('Rendering', h('p', { class: d.rendering === 'delayed' ? 'app-error' : '' }, O.renderingLine(d, now)), h('p', {}, O.queueLine(d))),
          section('Child safety', h('p', { class: d.child_safety && d.child_safety.open_not_hidden ? 'app-error' : '' }, O.childSafetyLine(d.child_safety))),
          section('Needs you', d.open_alerts.length ? h('ul', { class: 'ops-list' }, d.open_alerts.map(a => h('li', {}, a.detail, h('span', { class: 'meta' }, ` since ${O.ago(a.since, now)}`)))) : none('Nothing needs you.')),
          section('Stuck jobs', d.stuck.length ? h('ul', { class: 'ops-list' }, d.stuck.map(j => h('li', {}, `${j.job_type} ${j.state}, attempt ${j.attempt}`, h('span', { class: 'meta' }, ` ${j.id}, lease expired ${O.ago(j.lease_expired_at, now)}`)))) : none('None.')),
          section('Ended without a film (last 7 days)', d.ended.length ? h('ul', { class: 'ops-list' }, d.ended.map(j => h('li', {}, `${O.ENDED_WORDS[j.state] || j.state}: ${j.job_type}`, h('span', { class: 'meta' }, ` ${j.error_code || 'no code'}, ${O.ago(j.ended_at, now)}, ${j.id}`)))) : none('None.'),
            h('p', { class: 'form-note' }, 'Their credits are released by the ledger; the owner sees the amount on the film.')),
          section('AI editor spend', O.spendLines(d.ai).map(t => h('p', {}, t))),
          section('Backups', h('p', {}, O.backupLine(d.backups, now))),
          section('Payments to review', h('p', { class: d.stripe && d.stripe.open ? 'app-error' : '' }, O.stripeLine(d.stripe)),
            d.stripe && d.stripe.items.length ? h('ul', { class: 'ops-list' }, d.stripe.items.map(e => h('li', {},
              h('strong', {}, e.type), h('span', { class: 'meta' }, ` ${e.event_id}, ${O.ago(e.received_at, now)}${e.livemode ? ', LIVE mode' : ', test mode'}`),
              h('p', {}, e.detail || '(no detail recorded)'), button('Mark reviewed', () => data.adminAckStripe(e.event_id))))) : null),
          queueSection(fr, now),
          costSection(cost, now),
          funnelSection(funnel),
          section(`Creator beta applications (${cb ? cb.waiting : 0})`, h('p', {}, O.creatorLine(cb)), invitePanel(), invitePersonForm(),
            cb && cb.items.length ? h('ul', { class: 'ops-list' }, cb.items.map(a => h('li', {},
              h('strong', {}, `#${a.id} ${a.name}`), h('span', { class: 'meta' }, ` ${O.CREATOR_KIND_WORDS[a.kind] || a.kind}, ${a.email}, ${O.ago(a.created_at, now)}`),
              h('p', {}, 'Makes: ', a.makes, ' \u00b7 ', h('a', { href: a.link, rel: 'noopener noreferrer', target: '_blank' }, a.link)),
              h('p', {}, 'Question: ', a.question),
              button('Approve and make an invite code', async () => { const code = await data.adminCreatorInvite(a.id, null); invited = { name: a.name, email: a.email, code }; }), ' ',
              button('Approve only', () => data.adminDecideCreator(a.id, 'approved')), ' ', button('Decline', () => data.adminDecideCreator(a.id, 'declined'))))) : null),
          section(`Help requests (${d.support_open})`, d.support.length ? h('ul', { class: 'ops-list' }, d.support.map(q => h('li', {},
            h('strong', {}, `#${q.id} ${q.topic}`), h('span', { class: 'meta' }, ` ${q.email}, ${O.ago(q.created_at, now)}${q.job_id ? `, film job ${q.job_id} (${q.job_state}${q.job_error_code ? `, ${q.job_error_code}` : ''})` : ''}`),
            h('p', {}, q.message), button('Mark answered', () => data.adminAnswerSupport(q.id))))) : none('None waiting.')),
          section(`Abuse reports (${d.abuse_waiting})`, d.abuse.length ? h('ul', { class: 'ops-list' }, d.abuse.map(r => h('li', {},
            h('strong', {}, `#${r.id} ${O.REASON_WORDS[r.reason] || r.reason}`), h('span', { class: 'meta' }, ` ${O.ago(r.created_at, now)}${r.auto_held ? ', page hidden' : ', page still up'}, `), h('a', { href: `/film/?s=${r.slug}` }, 'film page'),
            r.reporter ? h('span', { class: 'meta' }, ` reporter ${r.reporter}`) : null,
            r.details ? h('p', {}, r.details) : null,
            r.details_omitted ? h('p', { class: 'form-note' }, 'Short record: this reporter had already sent more than 5 reports in an hour, so only the time, reporter, page and reason were kept (no free text).') : null,
            button('Restore the page', () => data.adminReviewReport(r.id, 'restored')), ' ', button('Remove the page', () => data.adminReviewReport(r.id, 'removed')), ' ', button('Dismiss', () => data.adminReviewReport(r.id, 'dismissed'))))) : none('None waiting.')),
          section('Recent messages (dry-run until email is set up)', d.outbox.length ? h('ul', { class: 'ops-list' }, d.outbox.map(o => h('li', {}, `${o.kind}: ${o.subject}`, h('span', { class: 'meta' }, ` ${o.mode === 'live' ? 'sent' : 'not sent (dry run)'}, ${O.ago(o.created_at, now)}`)))) : none('None.')));
      }
      load();
      const timer = setInterval(load, 60000);
      onStop(() => clearInterval(timer));
      return [h('a', { href: '#/', class: 'back' }, '\u2190 All projects'), h('h1', { tabindex: '-1' }, 'Operations'),
              h('p', { class: 'form-note' }, 'Everything the daily email says, live. It refreshes every minute.'), body, error];
    }

    // --- #/admin/visits  Ryan only: visits to /ryagram/ by day and by link source, with signups beside them and the
    // signup rate. A cookieless tally (SQL 20261006000100): counts only, nothing about any visitor.
    async function visitsAdminView(onStop) {
      const A = window.ryagramAdmin;
      const error = errorLine();
      const DAYS_ID = 'vs-days';   // (a reporting period, not a dataset picker)
      const range = h('select', { id: DAYS_ID },
        [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']].map(([d, t]) => h('option', { value: String(d) }, t)));
      range.value = '30';
      const body = h('div', { class: 'admin-body' }, h('p', { class: 'form-note' }, 'Loading\u2026'));
      const th = (t, num) => h('th', { scope: 'col', class: num ? 'num' : null }, t);
      async function load() {
        error.hidden = true;
        try {
          const [days, sources] = await Promise.all([data.visitsByDay(Number(range.value)), data.visitsBySource(Number(range.value))]);
          const t = A.visitTotals(days);
          const top = A.topSources(sources);
          body.replaceChildren(
            h('p', {}, `${t.visits.toLocaleString('en-US')} visit${t.visits === 1 ? '' : 's'}, ${t.signups.toLocaleString('en-US')} signup${t.signups === 1 ? '' : 's'}: ${t.rate} of visits became a signup.`),
            h('h2', {}, 'Top sources'),
            top.length ? h('table', { class: 'admin-table' },
              h('thead', {}, h('tr', {}, th('Source'), th('Visits', true), th('Signups', true), th('Signup rate', true))),
              h('tbody', {}, top.map(r => h('tr', {}, h('td', {}, A.sourceLabel(r.source)), h('td', { class: 'num' }, String(r.visits)),
                                           h('td', { class: 'num' }, String(r.signups)), h('td', { class: 'num' }, A.signupRate(r.visits, r.signups)))))) : h('p', { class: 'form-note' }, 'Nothing counted yet.'),
            h('h2', {}, 'By day'),
            days.length ? h('table', { class: 'admin-table' },
              h('thead', {}, h('tr', {}, th('Day'), th('Visits', true), th('Signups', true), th('Signup rate', true))),
              h('tbody', {}, days.map(r => h('tr', {}, h('td', {}, A.dayLabel(r.day)), h('td', { class: 'num' }, String(r.visits)),
                                          h('td', { class: 'num' }, String(r.signups)), h('td', { class: 'num' }, A.signupRate(r.visits, r.signups)))))) : '');
        } catch (err) { body.replaceChildren(); showError(error, err); }
      }
      range.addEventListener('change', load);
      load();
      return [
        h('a', { href: '#/', class: 'back' }, '\u2190 All projects'),
        h('h1', { tabindex: '-1' }, 'Visits and signups'),
        h('p', { class: 'form-note' }, 'Page loads of uselai.com/ryagram/ by day (New York time) and by link source (?ref=youtube, or the film link\u2019s utm_source), next to waitlist signups. A cookieless tally: nothing identifies a visitor, so these are visits, not people. Cloudflare Web Analytics is the independent total.'),
        h('div', { class: 'inline-row' }, h('label', { for: DAYS_ID }, 'Period'), range),
        body, error
      ];
    }

    // --- #/account  password, the data choice, deleting the account
    async function accountView() {
      const email = window.ryagramApp?.client ? ((await window.ryagramApp.client.auth.getSession()).data.session?.user?.email || '') : '';

      // Change password
      const pwError = errorLine();
      const pwDone = h('p', { class: 'form-note', role: 'status' });
      const pw = h('input', { id: 'acct-password', type: 'password', autocomplete: 'new-password', minlength: '12', required: true });
      const pw2 = h('input', { id: 'acct-password2', type: 'password', autocomplete: 'new-password', minlength: '12', required: true });
      const pwSave = h('button', { class: 'button secondary', type: 'submit' }, 'Change password');
      const pwForm = h('form', { class: 'contact-form', onsubmit: async event => {
        event.preventDefault();
        pwError.hidden = true; pwDone.textContent = '';
        if (!pwForm.reportValidity()) return;
        if (pw.value !== pw2.value) { showError(pwError, new Error('The two passwords don’t match.')); return; }
        await busy(pwSave, 'Saving…', async () => {
          try { await data.changePassword(pw.value); pw.value = pw2.value = ''; pwDone.textContent = 'Password changed.'; }
          catch (err) { showError(pwError, err); }
        });
      } },
        h('label', { for: 'acct-password' }, 'New password (at least 12 characters)'), pw,
        h('label', { for: 'acct-password2' }, 'The same again'), pw2, pwSave, pwDone, pwError);

      const sections = [
        h('a', { href: '#/', class: 'back' }, '← All projects'),
        h('h1', { tabindex: '-1' }, 'Your account'),
        email ? h('p', { class: 'meta' }, `Signed in as ${email}`) : null,
        h('section', { class: 'account-section', 'aria-labelledby': 'acct-pw' }, h('h2', { id: 'acct-pw' }, 'Password'), pwForm)
      ];
      let helpSection = null;
      if (window.ryagramAccount) {
        const acct = window.ryagramAccount.create({ h, data, busy, showError, errorLine });
        sections.splice(4, 0, await acct.changeEmailSection(email));
        sections.push(acct.exportSection(email));
        helpSection = acct.helpSection();
      }
      if (connectOn()) sections.push(await connectUi().connectedSection());
      if (!accountToolsOn()) return helpSection ? [...sections, helpSection] : sections;

      // The store / don't-keep choice (spec 2B-6), as the default for uploads.
      const choiceNote = h('p', { class: 'form-note', role: 'status' });
      const choiceError = errorLine();
      let current = 'keep';
      try { current = await data.uploadRetention(); } catch (err) { showError(choiceError, err); }
      const option = (value, title, text) => h('label', { class: 'choice' },
        h('input', { type: 'radio', name: 'retention', value, checked: current === value, onchange: async () => {
          choiceError.hidden = true; choiceNote.textContent = '';
          try { await data.setUploadRetention(value); choiceNote.textContent = 'Saved.'; }
          catch (err) { showError(choiceError, err); }
        } }),
        h('span', {}, h('strong', {}, title), h('span', { class: 'choice-text' }, text)));
      sections.push(h('section', { class: 'account-section', 'aria-labelledby': 'acct-data' },
        h('h2', { id: 'acct-data' }, 'Data you upload'),
        h('p', { class: 'form-note' }, 'Your default for data you upload. You can choose again for each upload. (Films from Ryagram’s own data aren’t affected.)'),
        h('fieldset', { class: 'choices', 'aria-labelledby': 'acct-data' },
          option('keep', 'Store my data (default)', 'Ryagram privately keeps this dataset because it’s needed to rebuild the film later.'),
          option('dont_keep', 'Don’t keep my data', 'Ryagram deletes the input data after processing. The film can’t be rebuilt after its rendered copy is archived.')),
        choiceNote, choiceError));

      // Delete account
      const delError = errorLine();
      const delNote = h('p', { class: 'form-note', role: 'status' });
      const typed = h('input', { id: 'acct-delete-email', type: 'email', autocomplete: 'off', required: true });
      const del = h('button', { class: 'button danger', type: 'submit' }, 'Delete my account');
      const delForm = h('form', { class: 'contact-form', onsubmit: async event => {
        event.preventDefault();
        delError.hidden = true;
        if (!delForm.reportValidity()) return;
        if (!confirm('Delete your account, every project, film and file? This can’t be undone.')) return;
        await busy(del, 'Deleting…', async () => {
          try {
            const result = await data.deleteAccount(typed.value);
            if (result?.status === 'deleted') { await data.signOut(); return; }
            delNote.textContent = result?.message || 'Your request is recorded.';
          } catch (err) { showError(delError, err); }
        });
      } },
        h('label', { for: 'acct-delete-email' }, 'Type your email to confirm'), typed, del, delNote, delError);
      sections.push(h('section', { class: 'account-section account-danger', 'aria-labelledby': 'acct-delete' },
        h('h2', { id: 'acct-delete' }, 'Delete your account'),
        h('p', {}, 'This deletes your login, every project and version, every film and file, and any public film pages, at once. Renders must have finished first. If you’ve bought or used credits, those records are kept as financial records and your account is closed by hand within 30 days.'),
        delForm));
      if (helpSection) sections.push(helpSection);
      return sections;
    }

    // --- #/credits  packs and plans (Stripe Checkout; credits arrive through the webhook)
    async function creditsView(paidCode, onStop) {
      const C = window.ryagramCredits;
      const [offers, plan] = await Promise.all([data.shopOffers(), data.myPlan()]);
      const error = errorLine();
      const balance = h('p', { class: 'credit-balance' }, 'Loading credits…');
      let before = null;
      async function loadBalance() {
        try {
          const rows = await data.creditBalances();
          const total = rows.reduce((n, r) => n + r.available, 0);
          balance.textContent = C.balanceLine(rows);
          return total;
        } catch { balance.textContent = 'Couldn’t load your credits.'; return null; }
      }
      loadBalance().then(total => { before = total; });

      // Back from Stripe: the webhook grants the credits, usually within seconds. Look a few times.
      let thanks = null;
      if (paidCode) {
        // Shown ONCE, on the return from Checkout: drop ?paid=... from the address now (no hashchange fires), so a reload or a later visit shows no stale thanks.
        try { history.replaceState(null, '', location.pathname + location.search + '#/credits'); } catch { /* the banner just stays until the next visit */ }
        thanks = h('p', { class: 'form-note credit-thanks', role: 'status' },
          `Thanks. Stripe has your payment for ${C.offerName(paidCode)}; the credits appear here once Stripe confirms it, usually within a minute.`);
        let tries = 0;
        const timer = setInterval(async () => {
          const total = await loadBalance();
          if (++tries >= 20 || (before != null && total != null && total > before)) {
            clearInterval(timer);
            if (total > before) thanks.textContent = 'Your credits have arrived.';
          }
        }, 3000);
        onStop(() => clearInterval(timer));
      }

      const go = async (button, label, work) => {
        error.hidden = true;
        await busy(button, label, async () => {
          try { location.assign(await work()); } catch (err) { showError(error, err); }
        });
      };
      const current = C.planLine(plan);
      const offerItem = p => {
        const blocked = p.monthly && C.hasPlan(plan);
        return h('li', { class: 'offer' },
          h('strong', {}, C.offerName(p.code)), h('span', { class: 'meta' }, C.offerLine(p)),
          h('button', { class: 'button secondary small', type: 'button', disabled: blocked,
                        title: blocked ? 'You already have a plan. Use Manage plan to change it.' : null,
                        onclick: event => go(event.currentTarget, 'Opening Stripe…', () => data.startCheckout(p.code)) },
            p.monthly ? 'Subscribe' : 'Buy'));
      };
      const packs = offers.filter(p => !p.monthly), plans = offers.filter(p => p.monthly);
      const testMode = window.ryagramMock
        ? 'Mock mode: nothing goes to Stripe, and buying adds the credits at once.'
        : window.ryagramConfig?.stripeTestMode !== false
          ? 'Test mode: no real money moves. Use the card 4242 4242 4242 4242 with any future date and any CVC.' : null;
      return [
        h('a', { href: '#/', class: 'back' }, '← All projects'),
        h('h1', { tabindex: '-1' }, 'Credits'),
        balance, thanks,
        testMode ? h('p', { class: 'form-note credit-test-mode' }, testMode) : null,
        testMode && !window.ryagramMock ? h('p', { class: 'form-note credit-test-label' }, 'Test mode — prices are placeholders, no real charge.') : null,
        current || plan ? h('div', { class: 'plan-now' },
          current ? h('p', {}, current) : null,
          h('button', { class: 'button secondary small', type: 'button',
                        onclick: event => go(event.currentTarget, 'Opening…', () => data.openBillingPortal()) }, 'Manage plan')) : null,
        packs.length ? [h('h2', {}, 'Credit packs'), h('ul', { class: 'offer-list' }, packs.map(offerItem)),
                        h('p', { class: 'form-note' }, 'Pack credits never expire.')] : null,
        plans.length ? [h('h2', {}, 'Monthly plans'), h('ul', { class: 'offer-list' }, plans.map(offerItem)),
                        h('p', { class: 'form-note' }, 'Unused plan credits carry over, up to two months’ worth. Cancel any time from Manage plan.')] : null,
        offers.length ? null : h('p', { class: 'form-intro' }, 'Nothing is on sale yet.'),
        error,
        h('p', { class: 'form-note' }, 'Payments are handled by Stripe. Ryagram never sees your card.')
      ];
    }

    // --- #/p/<id>  one project and its versions
    async function projectView(id) {
      const { project, versions } = await data.getProject(id);
      const numberOf = Object.fromEntries(versions.map(v => [v.id, v.number]));
      const error = errorLine();

      const renameInput = h('input', { name: 'title', required: true, maxlength: '200', value: project.title, 'aria-label': 'Project name' });
      const renameButton = h('button', { class: 'button primary', type: 'submit' }, 'Save name');
      const renameForm = h('form', { class: 'inline-form', hidden: true, onsubmit: async event => {
        event.preventDefault();
        if (!renameForm.reportValidity()) return;
        await busy(renameButton, 'Saving…', async () => {
          try { await data.renameProject(project.id, renameInput.value); await route(); }
          catch (err) { showError(error, err); }
        });
      } }, h('div', { class: 'inline-row' }, renameInput, renameButton));

      const actions = h('div', { class: 'actions-row' },
        h('button', { class: 'button secondary', type: 'button', onclick: () => {
          renameForm.hidden = !renameForm.hidden;
          if (!renameForm.hidden) renameInput.focus();
        } }, 'Rename'),
        h('button', { class: 'button secondary', type: 'button', onclick: async event => {
          if (!confirm(`Archive “${project.title}”? Its versions and files are kept.`)) return;
          await busy(event.currentTarget, 'Archiving…', async () => {
            try { await data.archiveProject(project.id); location.hash = '#/'; }
            catch (err) { showError(error, err); }
          });
        } }, 'Archive project'));

      const rows = [...versions].reverse().map(v => h('li', {},
        h('a', { href: `#/v/${v.id}`, class: 'version-link' }, `r${v.number}`),
        badge(v.state),
        h('span', { class: 'meta' },
          v.parent_version_id && numberOf[v.parent_version_id] ? `from r${numberOf[v.parent_version_id]} · ` : '',
          date(v.created_at)),
        h('button', { class: 'button secondary small', type: 'button', onclick: async event => {
          await busy(event.currentTarget, 'Copying…', async () => {
            try { const nv = await data.createVersion(project.id, v.id); location.hash = `#/v/${nv.id}`; }
            catch (err) { showError(error, err); }
          });
        } }, `New version from r${v.number}`)));

      const helpNote = requestsOn() ? h('p', { class: 'form-note request-pointer' }, 'Not sure how to build a film? ', h('a', { href: '#/request' }, 'Request a film'), ' and we will make it for you.') : null;
      return [
        h('a', { href: '#/', class: 'back' }, '← All projects'),
        h('h1', { tabindex: '-1' }, project.title),
        helpNote,
        actions, renameForm, error,
        h('h2', {}, 'Versions'),
        h('p', { class: 'form-intro' }, 'Each version keeps its own story and files. Making a new version copies the story and leaves the old one as it was.'),
        h('ul', { class: 'version-list' }, rows)
      ];
    }

    // --- #/v/<id>  one version
    async function versionView(id, onStop) {
      const { version: v, project, parent, artifacts } = await data.getVersion(id);
      const locked = !EDITABLE.includes(v.state);
      const error = errorLine();
      const saved = h('p', { class: 'form-note', role: 'status' });
      const savedHere = h('p', { class: 'form-note', role: 'status' });          // the same confirmation, beside the Save story button inside the folded form

      const newVersion = async event => {
        await busy(event.currentTarget, 'Copying…', async () => {
          try { const nv = await data.createVersion(v.project_id, v.id); location.hash = `#/v/${nv.id}`; }
          catch (err) { showError(error, err); }
        });
      };

      const files = filesSection(v, artifacts);
      const jobs = jobsPanel(v, {
        settled: () => files.refresh(),
        versionChanged: () => route()
      });
      onStop(jobs.stop);

      const story = h('textarea', { id: 'story', class: 'story', spellcheck: 'false', readonly: locked,
                                    'aria-describedby': 'story-help', value: JSON.stringify(v.story_spec, null, 2) });
      const save = h('button', { class: 'button primary', type: 'submit', disabled: locked }, 'Save story');
      const storyForm = h('form', { onsubmit: async event => {
        event.preventDefault();
        error.hidden = true;
        saved.textContent = '';
        savedHere.textContent = '';
        let parsed;
        try { parsed = JSON.parse(story.value); } catch (err) {
          showError(error, new Error(`That isn’t valid JSON: ${err.message}`));
          return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          showError(error, new Error('The story must be a JSON object.'));
          return;
        }
        await busy(save, 'Saving…', async () => {
          try {
            const result = await data.saveStory(v.id, parsed);
            saved.textContent = savedHere.textContent = 'Saved. Earlier sheets and previews were of the old story, so the final render needs new ones.';
            jobs.storyChanged(result.story_sha256);
            sources.refresh();
          } catch (err) { showError(error, err); }
        });
      } },
        h('label', { for: 'story' }, 'Story'),
        h('p', { id: 'story-help', class: 'form-note' }, locked
          ? `This version is ${(STATE_LABELS[v.state] || v.state).toLowerCase()} and can’t change. Make a new version from it to keep working.`
          : 'The story file this version renders from. The render worker checks it in full before drawing anything.'),
        story, locked ? null : save, savedHere, error);

      // What this film is made from: the database follows the story; refreshed whenever the story changes.
      const sources = sourcesPanel(v, !locked);
      // Using an upload as this film's data points the story's render clips at it (v1: one uploaded dataset per film).
      const uploads = uploadsOn() ? uploadsPanel(v, !locked, async (ref, ds) => {
        let built = window.ryagramUploads.useInStory(v.story_spec, ref);
        // BYOD guide: a blank story gets a starter film made from the upload (a title and one clip for the data), so the person is never left at a dead end.
        if (!built && byodGuideOn() && window.ryagramTemplates.isBlank(v.story_spec)) {
          const per = ds?.ingest_report?.periods;
          if (per?.first && per?.last) built = window.ryagramTemplates.buildFor({ id: ref, label: ds.filename_label || ds.name || 'Your data', start: String(per.first), end: String(per.last), view: 'map', note: 'Started from your own data. Edit the headline, the years (start and end) or the view, then make a contact sheet.' }, project.title);
        }
        if (!built) throw new Error('Add a render clip to the story first, then use your data in it.');
        const result = await data.saveStory(v.id, built);
        v.story_spec = built;
        story.value = JSON.stringify(built, null, 2);
        saved.textContent = 'Your data is now this film\u2019s data. Make a contact sheet to see it.';
        jobs.storyChanged(result.story_sha256);
        sources.refresh();
      }) : null;
      // BYOD guide: a line near the top for people who want their own spreadsheet (the upload sits in the folded Advanced panel at the bottom, which a new person does not look in).
      let advanced = null;
      const byodPointer = uploads && byodGuideOn() && !locked
        ? h('p', { class: 'form-note byod-pointer' }, 'Have your own spreadsheet? ', h('button', { class: 'link-button', type: 'button', onclick: () => {
          if (!advanced) return;
          advanced.open = true;
          advanced.scrollIntoView({ block: 'start' });
          document.getElementById('upload-file')?.focus();
        } }, 'Use your own data')) : null;
      const picker = locked ? null : templatePicker(project, v, async built => {
        const blank = window.ryagramTemplates.isBlank(v.story_spec);
        if (!blank && !confirm('Replace the current story with this template? Save a new version first if you want to keep it.')) return false;
        const result = await data.saveStory(v.id, built);
        v.story_spec = built;
        story.value = JSON.stringify(built, null, 2);
        saved.textContent = 'Template applied and saved. Change the headline or years if you like, then make a contact sheet.';
        jobs.storyChanged(result.story_sha256);
        sources.refresh();
        return true;
      });

      const editorOn = window.ryagramConfig?.aiEditor === true || !!window.ryagramMock;
      const chat = editorOn && !locked ? editorPanel(v, {
        storyChanged: () => route(),
        refreshJobs: () => jobs.refresh()
      }) : null;

      return [
        h('a', { href: `#/p/${project.id}`, class: 'back' }, `← ${project.title}`),
        h('h1', { tabindex: '-1' }, `r${v.number} `, badge(v.state)),
        h('p', { class: 'meta' }, parent ? `Made from r${parent.number} · ` : '', `created ${date(v.created_at)}`),
        h('div', { class: 'actions-row' },
          h('button', { class: 'button secondary', type: 'button', onclick: newVersion }, `New version from r${v.number}`),
          v.state === 'complete'
            ? h('button', { class: 'button secondary', type: 'button', onclick: async event => {
                await busy(event.currentTarget, 'Archiving…', async () => {
                  try { await data.setVersionState(v.id, 'archived'); await route(); }
                  catch (err) { showError(error, err); }
                });
              } }, 'Archive this version')
            : null),
        v.state === 'complete' && filmPagesOn() ? sharePanel(v, project) : null,
        picker,
        byodPointer,
        saved,                                      // "Template applied and saved ...": shown here, not inside the folded story file
        chat,
        sources.el,
        jobs.el,
        files.el,
        // Everything below is still here, just folded: the story file itself and your own data (a spreadsheet) are for people who want them.
        advanced = h('details', { class: 'advanced-panel', id: 'advanced-panel' }, h('summary', {}, 'Advanced: your own data and the story file'),
          h('p', { class: 'form-note' }, 'Most films start from a ready-made film above. Use these if you want to bring your own spreadsheet or edit the story file directly.'),
          uploads?.el, storyForm)
      ];
    }

    // "What this film is made from": one card per source with its publisher, coverage and a short licence
    // that opens the full text. The facts come from the database, not from this page (sync_version_sources).
    // Hidden when that SQL isn't applied yet; a problem (too many sources, data we can't run) shows in place.
    function sourcesPanel(v, editable) {
      const S = window.ryagramSources;
      const el = h('section', { class: 'app-panel sources-panel', 'aria-labelledby': 'sources-title', hidden: true },
        h('h2', { id: 'sources-title' }, 'What this film is made from'));
      let latest = 0;
      async function refresh() {
        const mine = ++latest;
        let rows, problem = '';
        try { rows = await data.syncSources(v.id); }
        catch (err) {
          problem = err.message;                                     // a refused sync leaves the old rows in place: show them
          rows = await data.listSources(v.id).catch(() => []);
        }
        if (mine !== latest) return;
        if (rows === null) { el.hidden = true; return; }              // not available yet
        el.hidden = false;
        const cards = rows.map(r => {
          const c = S.cardView(r);
          const full = c.licenceFull ? h('div', { class: 'source-licence-full', hidden: true },
            h('p', {}, c.licenceFull), c.url ? h('p', {}, h('a', { href: c.url, target: '_blank', rel: 'noopener noreferrer' }, `${c.publisher} (the publisher\u2019s page)`)) : null) : null;
          const toggle = h('button', { class: 'link-button', type: 'button', 'aria-expanded': 'false', onclick: event => {
            if (!full) return;
            full.hidden = !full.hidden;
            event.currentTarget.setAttribute('aria-expanded', String(!full.hidden));
          } }, c.licenceShort);
          return h('li', { class: 'source-card' },
            h('strong', {}, c.title),
            h('p', { class: 'meta' }, 'Source: ', c.url ? h('a', { href: c.url, target: '_blank', rel: 'noopener noreferrer' }, c.publisher) : c.publisher),
            h('p', { class: 'meta' }, `Covers: ${c.coverage}`),
            h('p', { class: 'meta' }, 'Licence: ', full ? toggle : c.licenceShort, full ? ' (full text)' : ''),
            full);
        });
        el.replaceChildren(...[el.firstChild,
          cards.length ? h('ul', { class: 'source-cards' }, cards) : null,
          problem ? h('p', { class: 'form-note app-error', role: 'alert' }, problem) : null,
          h('p', { class: 'form-note' }, S.note({ editable, count: cards.length }))].filter(Boolean));
      }
      refresh();
      return { el, refresh };
    }

    // "Your own data": upload a spreadsheet, check what the reader found, confirm what the columns mean, use it in this film.
    // The file goes to the person's own private slot; only the worker reads it. Hidden when the SQL isn't applied yet.
    // Everything the reader reports about a file (names, sample values) is the person's own text and goes in as text nodes.
    function uploadsPanel(v, editable, useInFilm) {
      const U = window.ryagramUploads;
      const el = h('section', { class: 'app-panel uploads-panel', 'aria-labelledby': 'uploads-title', hidden: true });
      const error = errorLine();
      let list = [], timer = null, open = null, latest = 0, retention = 'keep';

      const ready = async () => {
        try { retention = await data.uploadRetention(); } catch { /* keep is the default */ }
        const box = el.querySelector(`input[name=upload-retention][value=${retention === 'dont_keep' ? 'dont_keep' : 'keep'}]`);
        if (box) box.checked = true;       // the account's choice is where each upload starts
      };

      const fileInput = h('input', { type: 'file', id: 'upload-file', accept: U.ACCEPT });
      const rights = h('input', { type: 'checkbox', id: 'upload-rights' });
      const radio = (value, title, text) => h('label', { class: 'choice' },
        h('input', { type: 'radio', name: 'upload-retention', value, checked: value === 'keep' }),
        h('span', {}, h('strong', {}, title), h('span', { class: 'choice-text' }, text)));
      const keepChoices = h('fieldset', { class: 'choices' }, h('legend', {}, 'Should Ryagram keep this file?'),
        radio('keep', 'Store my data', 'Kept privately until you delete it, so the film can be rebuilt later.'),
        radio('dont_keep', 'Don\u2019t keep my data', 'Deleted once your final film is made, or after 7 days without activity. The film can\u2019t be rebuilt afterwards.'));
      const send = h('button', { class: 'button', type: 'submit' }, 'Upload');
      const form = h('form', { class: 'upload-form', onsubmit: async event => {
        event.preventDefault();
        error.hidden = true;
        const file = fileInput.files[0];
        const check = U.checkFile(file, { count: list.length });
        if (!check.ok) return showError(error, new Error(check.problem));
        if (!rights.checked) return showError(error, new Error('Tick the box to confirm you may use this data.'));
        const choice = form.querySelector('input[name=upload-retention]:checked')?.value || retention;
        await busy(send, 'Uploading\u2026', async () => {
          try {
            await data.startUpload(file, { label: check.label, ext: check.ext, contentType: U.MIME[check.ext], retention: choice });
            form.reset();
            await refresh();
          } catch (err) { showError(error, err); }
        });
      } },
        h('label', { for: 'upload-file' }, 'A spreadsheet (.csv, .tsv, .xlsx or .ods, up to 10 MB)'), fileInput,
        keepChoices,
        h('label', { class: 'choice' }, rights, h('span', {}, 'I have the right to use this data.')),
        send);

      // Where the data comes from (S5). Every word marked PLACEHOLDER is draft wording; the person's answers are kept in `prov` and shown back as the closing card will read.
      function provenanceFields(prov) {
        const card = h('ul', { class: 'prov-card', 'aria-live': 'polite' });
        const draw = () => card.replaceChildren(...U.provenanceCard(prov).map(l => h('li', {}, l)));
        const text = (id, label, key, hint) => { const i = h('input', { id, type: 'text', maxlength: String(U.FIELD_MAX[key]), autocomplete: 'off', oninput: () => { prov[key] = i.value; draw(); } }); return h('div', { class: 'field' }, h('label', { for: id }, label), i, hint ? h('p', { class: 'form-note' }, hint) : null); };
        const lic = h('select', { 'aria-label': 'What lets you use it', onchange: () => { prov.licence = lic.value; note.hidden = prov.licence !== 'other'; draw(); } }, h('option', { value: '' }, 'Choose\u2026'), U.LICENCES.map(([k, t]) => h('option', { value: k }, t)));
        const note = h('div', { class: 'field', hidden: true }, h('label', { for: 'prov-licence-note' }, 'Describe it'), h('input', { id: 'prov-licence-note', type: 'text', maxlength: String(U.FIELD_MAX.licence_note), oninput: e => { prov.licence_note = e.target.value; draw(); } }));
        const dec = h('select', { 'aria-label': 'Decimals to show', onchange: () => { prov.decimals = Number(dec.value); } }, [0, 1, 2, 3].map(n => h('option', { value: String(n) }, `${n} decimal place${n === 1 ? '' : 's'}`)));
        const ok = h('input', { id: 'prov-attest', type: 'checkbox', onchange: () => { prov.attested = ok.checked; } });
        draw();
        return h('fieldset', { class: 'prov-fields' }, h('legend', {}, 'Where does this data come from?'),
          h('p', { class: 'form-note prov-placeholder' }, `${U.PLACEHOLDER} Your film will show its source, and say the figures are yours.`),
          text('prov-publisher', 'Who published or owns it', 'publisher'), text('prov-link', 'A web link to the data (optional; it goes in the video description, never on the film itself)', 'link'),
          h('label', { class: 'field' }, h('span', {}, 'What lets you use it'), lic), note,
          text('prov-unit', 'What the numbers are in (dollars, percent, people\u2026)', 'unit'), h('label', { class: 'field' }, h('span', {}, 'Decimals to show (films do not use this yet)'), dec),
          h('label', { class: 'choice' }, ok, h('span', {}, U.ATTESTATION, ' ', h('span', { class: 'meta' }, U.PLACEHOLDER))),
          h('p', { class: 'form-note' }, 'This is how the closing card of your film will read:'), card);
      }

      function mappingForm(ds) {
        const report = ds.ingest_report;
        const mapping = U.draft(report);
        if (!mapping) {
          return h('p', { class: 'form-note app-error', role: 'alert' }, byodGuideOn() ? U.WIDE_HELP : U.problem(null, report));
        }
        const cols = report.columns;
        const shown = (c) => `${U.text(c.header) || `Column ${c.index + 1}`}${c.sample?.length ? ` (${c.sample.slice(0, 3).map(U.text).join(', ')})` : ''}`;
        const note = errorLine();
        const select = (label, key, { allowNone = false } = {}) => {
          const s = h('select', { 'aria-label': label, onchange: () => {
            mapping[key] = s.value === '' ? null : Number(s.value);
            if (key === 'state_index') drawCounty();
          } },
            allowNone ? h('option', { value: '' }, 'None') : null,
            cols.map(c => h('option', { value: String(c.index), selected: mapping[key] === c.index }, shown(c))));
          return h('label', { class: 'field' }, h('span', {}, label), s);
        };
        const stateSelect = h('select', { 'aria-label': 'State for these counties', onchange: e => { mapping.state = e.target.value || undefined; } },
          h('option', { value: '' }, 'Choose a state\u2026'),
          Object.entries(U.STATES).map(([code, name]) => h('option', { value: code, selected: mapping.state === code }, name)));
        const county = h('div', { class: 'field' });
        function drawCounty() {
          const need = mapping.geography === 'us_counties' && mapping.state_index == null;
          county.replaceChildren(...(mapping.geography === 'us_counties'
            ? [h('p', { class: 'form-note' }, 'County names need a state. Pick the column that has it, or the one state they are all in.'),
               select('Column with the state', 'state_index', { allowNone: true }), need ? h('label', { class: 'field' }, h('span', {}, 'Or the state'), stateSelect) : null]
            : []).filter(Boolean));
        }
        const geo = h('fieldset', { class: 'choices' }, h('legend', {}, 'The places are'),
          ...[['us_states', 'U.S. states'], ['us_counties', 'U.S. counties']].map(([value, title]) => h('label', { class: 'choice' },
            h('input', { type: 'radio', name: `geo-${ds.id}`, value, checked: mapping.geography === value, onchange: () => { mapping.geography = value; drawCounty(); } }),
            h('span', {}, title))));
        const cadence = h('fieldset', { class: 'choices' }, h('legend', {}, 'The periods are'),
          ...[['annual', 'Yearly'], ['monthly', 'Monthly']].map(([value, title]) => h('label', { class: 'choice' },
            h('input', { type: 'radio', name: `cad-${ds.id}`, value, checked: mapping.cadence === value, onchange: () => { mapping.cadence = value; } }),
            h('span', {}, title))));
        const values = h('fieldset', { class: 'choices' }, h('legend', {}, 'Columns of values (1 to 8) and what to call each'),
          ...cols.filter(c => c.index !== mapping.place_index && c.index !== mapping.period_index).map(c => {
            const on = mapping.value_indexes.includes(c.index);
            const name = h('input', { type: 'text', maxlength: '80', 'aria-label': `Name for ${U.text(c.header)}`, value: mapping.measure_names[String(c.index)] || U.text(c.header),
              oninput: () => { mapping.measure_names[String(c.index)] = name.value; } });
            const box = h('input', { type: 'checkbox', checked: on, onchange: () => {
              mapping.value_indexes = box.checked ? [...mapping.value_indexes, c.index].sort((a, b) => a - b) : mapping.value_indexes.filter(i => i !== c.index);
              mapping.measure_names[String(c.index)] ??= U.text(c.header);
              if (!mapping.value_indexes.includes(mapping.banded_index)) mapping.banded_index = mapping.value_indexes[0];
            } });
            return h('div', { class: 'value-row' }, h('label', { class: 'choice' }, box, h('span', {}, shown(c))), name);
          }));
        drawCounty();
        // S5 scaffold (byodGuide): who published it, the licence or permission, the unit, and the attestation. PLACEHOLDER wording (Ryan's final wording is RYAN-QUEUE Q5).
        const prov = { publisher: '', link: '', licence: '', licence_note: '', unit: '', decimals: 0, attested: false };
        const provBox = byodGuideOn() ? provenanceFields(prov) : null;
        const confirmBtn = h('button', { class: 'button', type: 'button', onclick: async () => {
          note.hidden = true;
          const problem = U.problem(mapping, report);
          if (problem) return showError(note, new Error(problem));
          if (provBox) { const pp = U.provenanceProblem(prov); if (pp) return showError(note, new Error(pp)); }
          await busy(confirmBtn, 'Saving\u2026', async () => {
            try {
              if (provBox) await data.setUploadProvenance(ds.id, U.cleanProvenance(prov));
              await data.confirmMapping(ds.id, U.clean(mapping)); await refresh();
            } catch (err) { showError(note, err); }
          });
        } }, 'These are right');
        const rows = report.rows;
        const per = report.periods;
        return h('div', { class: 'mapping-form' },
          h('p', { class: 'form-note' }, `We found ${rows.toLocaleString()} rows${per ? `, ${per.first} to ${per.last}` : ''}. Check what each column means. Only you can see these values.`),
          select('The place column', 'place_index'), select('The period column', 'period_index'), geo, county, cadence, values, provBox,
          h('div', { class: 'actions-row' }, confirmBtn), note);
      }

      function card(ds) {
        const c = U.chip(ds, ds.ingest);
        const inUse = v.dataset_id === ds.id;
        const del = h('button', { class: 'button secondary small', type: 'button', onclick: async () => {
          if (!confirm('Delete this data? The file is removed from Ryagram and any film using it loses it.')) return;
          await busy(del, 'Deleting\u2026', async () => {
            try { await data.deleteUpload(ds.id); await refresh(); } catch (err) { showError(error, err); }
          });
        } }, 'Delete');
        const use = c.key === 'ready' && editable && !inUse ? h('button', { class: 'button small', type: 'button', onclick: async () => {
          await busy(use, 'Adding\u2026', async () => {
            try { await data.attachUpload(v.id, ds.id).then(ref => useInFilm(ref, ds)); v.dataset_id = ds.id; await refresh(); }
            catch (err) { showError(error, err); }
          });
        } }, 'Use in this film') : null;
        const edit = c.key === 'ready' ? h('button', { class: 'link-button', type: 'button', onclick: () => { open = open === ds.id ? null : ds.id; draw(); } }, 'See the columns') : null;
        return h('li', { class: 'upload-card' },
          h('strong', {}, ds.filename_label || ds.name || 'Your data'), ' ', h('span', { class: `state state-upload-${c.key}` }, byodGuideOn() && c.key === 'check' && !U.draft(ds.ingest_report) ? 'Needs a different layout' : c.label),
          h('p', { class: 'meta' }, [bytes(ds.bytes), ds.ext ? ds.ext.toUpperCase() : '', ds.retention === 'dont_keep' ? 'Deleted after your final film' : 'Kept until you delete it'].filter(Boolean).join(' \u00b7 '),
            inUse ? ' \u00b7 In use in this film' : ''),
          c.key === 'reading' ? h('p', { class: 'form-note', role: 'status' }, 'We\u2019re reading it. This usually takes under a minute.') : null,
          c.key === 'failed' ? h('p', { class: 'form-note app-error' }, c.detail) : null,
          c.key === 'check' ? mappingForm(ds) : null,
          c.key === 'ready' && open === ds.id ? h('ul', { class: 'column-list' }, (ds.ingest_report?.columns || []).map(col => h('li', {}, `${U.text(col.header)} (${col.kind})`))) : null,
          h('div', { class: 'actions-row' }, use, edit, c.key === 'deleting' ? null : del));
      }

      // What a good file looks like (BYOD guide): the shape, as a small table.
      function exampleBox() {
        const X = U.EXAMPLE;
        return h('details', { class: 'byod-hint' }, h('summary', {}, 'What should my file look like?'),
          h('p', { class: 'form-note' }, 'One row for each place and year: a column for the place, a column for the year, and a column of values. Places are U.S. states or U.S. counties.'),
          h('table', { class: 'byod-example' }, h('thead', {}, h('tr', {}, X.head.map(t => h('th', {}, t)))), h('tbody', {}, X.rows.map(r => h('tr', {}, r.map(t => h('td', {}, t)))))));
      }

      function draw() {
        el.replaceChildren(...[
          h('h2', { id: 'uploads-title' }, 'Your own data'),
          h('p', { class: 'form-note' }, 'Upload a spreadsheet with one row per U.S. state or county and year. Only you can see it. You can delete it at any time.'),
          byodGuideOn() ? exampleBox() : null,
          editable ? form : null,
          error,
          list.length ? h('ul', { class: 'upload-cards' }, list.map(card)) : null].filter(Boolean));
      }

      async function refresh() {
        const mine = ++latest;
        clearTimeout(timer);
        let rows;
        try { rows = await data.listUploads(); } catch (err) { showError(error, err); return; }
        if (mine !== latest) return;
        if (rows === null) { el.hidden = true; return; }
        el.hidden = false;
        list = rows.filter(d => !d.delete_requested_at);
        // Don't redraw a half-filled mapping form out from under someone: only redraw when nothing is being edited.
        if (!el.querySelector('.mapping-form') || list.some(d => U.chip(d, d.ingest).key !== 'check')) draw();
        if (list.some(d => U.chip(d, d.ingest).key === 'reading') && el.isConnected !== false) timer = setTimeout(refresh, 3000);
      }
      refresh().then(ready);
      return { el, refresh };
    }

    // A finished film's public page: off until the owner publishes it; they can stop at any time.
    function sharePanel(v, project) {
      const heading = h('h2', { id: 'share-title' }, 'Public page');
      const el = h('section', { class: 'app-panel share-panel', 'aria-labelledby': 'share-title' },
        heading, h('p', { class: 'form-note' }, 'Loading…'));
      const error = errorLine();
      const pageUrl = slug => (window.ryagramMock ? `/film/?mock&s=${slug}` : `${location.origin}/film/?s=${slug}`);

      async function draw() {
        let page;
        try { page = await data.filmPage(v.id); } catch (err) { el.replaceChildren(heading, error); showError(error, err); return; }
        if (page?.published) {
          const url = pageUrl(page.slug);
          const copy = h('button', { class: 'button secondary small', type: 'button', onclick: async () => {
            try { await navigator.clipboard.writeText(url); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select the link to copy it'; }
          } }, 'Copy link');
          const stop = h('button', { class: 'button secondary small', type: 'button', onclick: async () => {
            if (!confirm('Stop sharing? The link stops working (visitors may still see it for a few minutes). Publishing again later brings back the same link.')) return;
            await busy(stop, 'Stopping…', async () => {
              try { await data.unpublishFilm(v.id); await draw(); } catch (err) { showError(error, err); }
            });
          } }, 'Stop sharing');
          el.replaceChildren(heading,
            h('p', {}, `On since ${date(page.published_at)}. Anyone with the link can watch this film and read its sources.`),
            h('p', { class: 'share-link' }, h('a', { href: url, target: '_blank', rel: 'noopener' }, url)),
            h('div', { class: 'actions-row' }, copy, stop), error);
          return;
        }
        const title = h('input', { id: 'share-title-input', maxlength: '120', value: page?.title || project.title, autocomplete: 'off' });
        const go = h('button', { class: 'button primary', type: 'button', onclick: async () => {
          if (!confirm('Publish a public page for this film? Anyone with the link can watch it and read its sources and method. Uploaded data is never shown.')) return;
          error.hidden = true;
          await busy(go, 'Publishing…', async () => {
            try {
              // A film made from the person's own upload asks once more, in plain words (the page shows the film and its sources, never the data).
              const out = await data.publishFilmWithConfirm(v.id, title.value, message => confirm(message));
              await draw();                                                          // published, or (cancelled) back to the plain "Off" panel: nothing is public
              if (out && out.cancelled) return;
            } catch (err) { showError(error, err); }
          });
        } }, 'Publish a public page');
        el.replaceChildren(heading,
          h('p', { class: 'form-note' }, page ? 'Off. You stopped sharing this film; publishing again brings back the same link.'
            : 'Off. A public page shows this film, where its data came from and how it was drawn, marked “Made with Ryagram”. Nothing is public until you publish.'),
          h('label', { for: 'share-title-input' }, 'Page title'),
          h('div', { class: 'inline-row' }, title, go), error);
      }
      draw();
      return el;
    }

    // The AI editor, as a panel on the version page. Replies are text nodes only.
    function editorPanel(v, { storyChanged, refreshJobs }) {
      const log = h('div', { class: 'chat-log', 'aria-live': 'polite' });
      const error = errorLine();
      const input = h('textarea', { id: 'chat-input', rows: '2', maxlength: '4000', placeholder: 'Ask the editor: “make it a map of 2016 to 2022”, “why did the check stop this?”' });
      const send = h('button', { class: 'button primary', type: 'submit' }, 'Send');
      const line = (role, text) => log.append(h('div', { class: `chat-msg chat-${role}` },
        h('span', { class: 'chat-who' }, role === 'user' ? 'You' : 'Editor'), h('p', {}, text)));

      data.editorHistory(v.id).then(rows => rows.forEach(r => line(r.role, r.content))).catch(() => {});

      const form = h('form', { class: 'chat-form', onsubmit: async event => {
        event.preventDefault();
        const message = input.value.trim();
        if (!message) return;
        error.hidden = true;
        line('user', message);
        input.value = '';
        await busy(send, 'Thinking…', async () => {
          try {
            const res = await data.askEditor(v.id, message);
            line('assistant', res.reply);
            for (const a of res.actions || []) {
              if (a.type === 'needs_approval') line('assistant', 'Ready when you are: press “Render final film” in the Render panel below. That click is your approval.');
              if (a.type === 'version_created') log.append(h('p', { class: 'form-note' }, h('a', { href: `#/v/${a.version_id}` }, `Open r${a.number}`)));
              if (a.type === 'job_submitted') refreshJobs();
            }
            if ((res.actions || []).some(a => a.type === 'story_changed')) storyChanged();
          } catch (err) { showError(error, err); }
        });
      } }, h('label', { for: 'chat-input', class: 'visually-hidden' }, 'Message to the editor'), input, send, error);

      return h('section', { class: 'chat-panel', 'aria-labelledby': 'chat-title' },
        h('h2', { id: 'chat-title' }, 'Editor'),
        h('p', { class: 'form-note' }, 'Describe the film you want or ask about a check. It edits this version’s story and can start sheets and previews; only you can start the final film.'),
        log, form);
    }

    // "Start from a ready-made film": each card is one complete film (a view of one dataset), so there is
    // nothing to pick the data from. No dataset dropdown and no browse list, by Ryan's ruling (2026-10-04):
    // choosing data belongs to the sourcing step (type what you want to see; or upload your own).
    function templatePicker(project, v, apply) {
      const T = window.ryagramTemplates;
      const blank = T.isBlank(v.story_spec);
      const error = errorLine();
      // One card per template x dataset it was drawn on. A template with a default dataset (Industry,
      // behind its flag) shows only that one: the other sectors are for the sourcing step, not a list here.
      const offered = T.TEMPLATES.filter(t => !t.flag || window.ryagramConfig?.[t.flag] === true || window.ryagramMock)
        .flatMap(t => (t.defaultDataset ? [t.defaultDataset] : t.datasets).map(id => ({ t, id, key: `${t.id}:${id}` })));
      const short = id => String((T.DATASETS[id] || {}).label || id).replace(/\s*\(.*$/, '');
      let chosen = offered.find(o => o.t.id === 'map' && o.id === 'state_obesity_fastfood') || offered[0];

      const headline = h('input', { id: 'tpl-headline', maxlength: '160', value: project.title, autocomplete: 'off' });
      const note = h('p', { class: 'form-note' });
      const cards = h('div', { class: 'template-grid', role: 'radiogroup', 'aria-label': 'Ready-made films' });

      let headlineEdited = false;
      headline.addEventListener('input', () => { headlineEdited = true; });
      function choose() {
        const { t, id } = chosen;
        note.textContent = [t.note || '', t.confirmed ? '' : 'This view hasn\u2019t been rendered on this data before, so check the contact sheet closely.']
          .filter(Boolean).join(' ');
        if (!headlineEdited) headline.value = t.headline || (T.DATASETS[id] || {}).headline || project.title;
      }
      function drawCards() {
        cards.replaceChildren(...offered.map(o => h('label', { class: `template-card${o === chosen ? ' is-chosen' : ''}` },
          h('input', { type: 'radio', name: 'tpl', value: o.key, checked: o === chosen,
                       onchange: () => { chosen = o; drawCards(); choose(); } }),
          h('strong', {}, o.t.label), h('span', {}, short(o.id)), h('span', { class: 'meta' }, o.t.blurb))));
      }
      drawCards();
      choose();

      const use = h('button', { class: 'button primary', type: 'submit' }, 'Use this film');
      const form = h('form', { class: 'template-form', onsubmit: async event => {
        event.preventDefault();
        error.hidden = true;
        await busy(use, 'Applying\u2026', async () => {
          try {
            if (await apply(T.build(chosen.t.id, chosen.id, headline.value))) details.open = false;
          } catch (err) { showError(error, err); }
        });
      } },
        cards,
        h('div', { class: 'template-fields' }, h('div', {}, h('label', { for: 'tpl-headline' }, 'Headline'), headline)),
        note, use, error);

      const details = h('details', { class: 'template-picker', open: blank },
        h('summary', {}, blank ? 'Start from a ready-made film' : 'Start again from a ready-made film'),
        h('p', { class: 'form-note' }, 'Each is a complete film you can then adjust.'),
        form);
      return details;
    }

    // Files for a version, refreshed on its own when a job finishes so the
    // story editor above is never reset.
    function filesSection(v, initial) {
      const list = h('div');
      const el = h('section', { 'aria-labelledby': 'files-title' }, h('h2', { id: 'files-title' }, 'Files'), list);
      async function draw(artifacts) {
        list.replaceChildren(artifacts.length
          ? h('ul', { class: 'file-list' }, await Promise.all(artifacts.map(async a => {
              let url = null;
              try { url = await data.fileUrl(a.storage_path); } catch { /* shown as unavailable */ }
              const label = [KIND_LABELS[a.kind] || a.kind, bytes(a.bytes) && ` · ${bytes(a.bytes)}`];
              let preview = null;
              if (url && (a.kind === 'final_video' || a.kind === 'preview')) {
                preview = h('video', { controls: true, preload: 'metadata', src: url });
              } else if (url && (a.kind === 'thumbnail' || a.kind === 'contact_sheet')) {
                preview = h('img', { src: url, alt: KIND_LABELS[a.kind], loading: 'lazy' });
              }
              return h('li', {}, preview,
                h('span', {}, label),
                url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open') : h('span', { class: 'meta' }, 'unavailable'));
            })))
          : h('p', { class: 'form-intro' }, 'Nothing rendered for this version yet.'));
      }
      draw(initial);
      return {
        el,
        async refresh() {
          try { draw((await data.getVersion(v.id)).artifacts); } catch { /* keep what is shown */ }
        }
      };
    }

    // 2A-3: submit sheet / preview / final, queue position, live state.
    // Realtime pushes changes; every 10 s it also re-reads while anything is
    // in flight (queue positions move with other people's jobs) or whenever
    // Realtime is not connected.
    function jobsPanel(v, { settled, versionChanged }) {
      const J = window.ryagramJobs;
      let jobs = [];
      let positions = {};
      let engine = null;                           // the worker's current engine version, if known
      let quotes = {};                             // job type -> credit_quote, when credits are on
      let accounting = {};                         // job id -> job_accounting row
      let balance = null;
      const C = window.ryagramCredits;
      const balanceNote = h('p', { class: 'form-note credit-balance', hidden: !creditsOn() });
      let storySha = v.story_sha256;
      let stopped = false;
      let seen;                                    // job id -> state at the last read
      const error = errorLine();
      const liveNote = h('span', { class: 'meta live-note' }, 'Connecting…');
      const listEl = h('div', { 'aria-live': 'polite' }, h('p', { class: 'form-intro' }, 'Loading jobs…'));

      const periods = h('input', { id: 'run-periods', inputmode: 'numeric', placeholder: '2016, 2018, 2020', autocomplete: 'off' });
      const winStart = h('input', { id: 'run-start', type: 'number', min: '0', step: '0.5', placeholder: '0', 'aria-label': 'Preview start, seconds' });
      const winEnd = h('input', { id: 'run-end', type: 'number', min: '0', step: '0.5', placeholder: '10', 'aria-label': 'Preview end, seconds' });
      const sheetButton = h('button', { class: 'button secondary', type: 'button' }, 'Make contact sheet');
      const previewButton = h('button', { class: 'button secondary', type: 'button' }, 'Make preview');
      const finalButton = h('button', { class: 'button primary', type: 'button' }, 'Render final film');
      const finalNote = h('p', { class: 'form-note' });
      const orderBox = h('div', { class: 'order-box', 'aria-live': 'polite' });
      let openOrders = false;                                        // an order waiting or running keeps the page polling
      const lockedNote = h('p', { class: 'form-note', hidden: true });
      const controls = h('div', { class: 'run-controls' },
        h('div', { class: 'run-step' },
          h('label', { for: 'run-periods' }, '1. Contact sheet ', h('span', {}, '(years, optional)')),
          h('div', { class: 'inline-row' }, periods, sheetButton)),
        h('div', { class: 'run-step' },
          h('label', { for: 'run-start' }, '2. Preview ', h('span', {}, '(seconds; 10 s at most; blank = the first 10 s)')),
          h('div', { class: 'inline-row' }, winStart, winEnd, previewButton)),
        h('div', { class: 'run-step' },
          h('span', { class: 'step-label' }, '3. Final film'),
          finalNote, finalButton, orderBox),
        h('p', { class: 'form-note run-timing' }, 'Jobs keep running if you leave this page.'));

      async function submit(button, type, params, ladder) {
        error.hidden = true;
        await busy(button, 'Submitting…', async () => {
          try {
            await data.submitJob(v.id, type, params, ladder);
            if (type === 'final_render') { versionChanged(); return; }
            await refresh();
          } catch (err) { showError(error, err); }
        });
      }

      sheetButton.addEventListener('click', () => {
        const p = J.parsePeriods(periods.value);
        if (p.error) return showError(error, new Error(p.error));
        submit(sheetButton, 'contact_sheet', p.value ? { periods: p.value } : {});
      });
      previewButton.addEventListener('click', () => {
        const w = J.parseWindow(winStart.value, winEnd.value);
        if (w.error) return showError(error, new Error(w.error));
        const q = quotes.preview;
        if (creditsOn() && q && !q.error && q.credits > 0
            && !confirm(`Your free previews are used up for now, so this one costs ${C.plural(q.credits)}. Go ahead?`)) return;
        submit(previewButton, 'preview', { window_s: w.value || [0, 10] });   // the worker requires a window
      });
      finalButton.addEventListener('click', () => {
        const ladder = J.ladder(jobs, storySha, engine);
        if (!ladder.ready) return showError(error, new Error(ladder.missing));
        const q = quotes.final_render;
        const cost = creditsOn() && q && !q.error && q.credits
          ? ` It uses ${C.plural(q.credits)}, held now and returned if the render fails.` : '';
        if (!confirm(`Render the final film of r${v.number}? Its story locks while it renders; later changes need a new version.${cost}`)) return;
        if (ordersOn()) { requestOrder(ladder.preview.id); return; }                  // the order path: held for approval while auto_render is off
        submit(finalButton, 'final_render', {}, { sheetJobId: ladder.sheet.id, previewJobId: ladder.preview.id });
      });

      // A full render is REQUESTED: while auto_render is off it waits for Ryan with the credits held; with it on it starts at once. A key is spent for good, so each request makes a new one.
      async function requestOrder(previewJobId) {
        error.hidden = true;
        await busy(finalButton, 'Requesting\u2026', async () => {
          try {
            await data.requestFinalRender(previewJobId, `app-${previewJobId.slice(0, 8)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
            await loadOrders();
            await refresh();
          } catch (err) { showError(error, err); }
        });
      }
      async function loadOrders() {
        if (!ordersOn()) return;
        let rows = [];
        try { rows = await data.listOrders(v.id); } catch { return; }
        const shown = [];
        for (const o of rows.slice(0, 3)) {
          let st = null;
          try { st = await data.orderStatus(o.id); } catch { st = { state: o.state, stages: [] }; }
          const actions = [];
          if (J.orderOpen(st.state)) actions.push(h('button', { class: 'button secondary small', type: 'button', onclick: async event => {
            if (!confirm('Cancel this full render? Your credits are returned.')) return;
            await busy(event.currentTarget, 'Cancelling\u2026', async () => { try { await data.cancelOrder(o.id); await loadOrders(); } catch (err) { showError(error, err); } });
          } }, 'Cancel the request'));
          if (st.state === 'delivered' && st.delivery && !st.delivery.deleted) actions.push(h('a', { class: 'button primary small', href: `#/delivery/${st.delivery.id}` }, 'Open your film'));
          shown.push(h('li', {}, h('strong', {}, `${J.ORDER_WORDS[st.state] || st.state} `), h('span', { class: 'meta' }, `${date(o.created_at)}. `), J.orderLine(st), ' ', actions));
        }
        openOrders = rows.some(o => J.orderOpen(o.state));
        orderBox.replaceChildren(...(shown.length ? [h('ul', { class: 'order-list' }, shown)] : []));      // (replaceChildren(null) would print the word "null")
      }

      function syncControls() {
        const takes = J.versionTakesJobs(v.state);
        controls.hidden = !takes;
        lockedNote.hidden = takes;
        lockedNote.textContent = `This version is ${(STATE_LABELS[v.state] || v.state).toLowerCase()}, so it can’t take new jobs.`;
        const busyType = type => jobs.some(j => j.job_type === type && J.isActive(j));
        const why = { sheet: '', preview: '', final: '' };                 // why a button is off: its tooltip, and the not-allowed cursor
        sheetButton.disabled = busyType('contact_sheet');
        if (sheetButton.disabled) why.sheet = 'A contact sheet is already being made.';
        previewButton.disabled = busyType('preview');
        if (previewButton.disabled) why.preview = 'A preview is already being made.';
        const ladder = J.ladder(jobs, storySha, engine);
        finalButton.disabled = !ladder.ready || busyType('final_render');
        if (!ladder.ready) why.final = ladder.missing || 'Make a contact sheet and a preview of this story first.';
        else if (busyType('final_render')) why.final = 'A full render is already being made.';
        finalNote.textContent = ladder.ready
          ? `Uses the contact sheet from ${date(ladder.sheet.created_at)} and the preview from ${date(ladder.preview.created_at)}. ${ordersOn() ? 'Clicking requests the full render: while we approve them by hand it waits, with your credits held, and they come back if it is not approved.' : 'Clicking is your approval.'}`
          : ladder.missing;
        if (creditsOn()) {
          const whyKey = (button, reason) => { const k = button === sheetButton ? 'sheet' : button === previewButton ? 'preview' : 'final'; if (!why[k]) why[k] = reason; };      // (an earlier reason, such as no sheet yet, is the truer one)
          const label = (button, base, type) => {
            const q = quotes[type];
            button.textContent = q && !q.error ? `${base} · ${C.priceLabel(q)}` : base;
            const can = q && !q.error ? C.affordable(q) : { ok: true };
            if (!can.ok) { button.disabled = true; whyKey(button, q?.error ? q.error : can.reason); }
            return q?.error ? q.error : can.ok ? '' : can.reason;
          };
          const sheetWhy = label(sheetButton, 'Make contact sheet', 'contact_sheet');
          const previewWhy = label(previewButton, 'Make preview', 'preview');
          const finalWhy = label(finalButton, 'Render final film', 'final_render');
          if (quotes.final_render?.error) { finalButton.disabled = true; if (!why.final) why.final = quotes.final_render.error; }
          if (finalWhy && ladder.ready) finalNote.textContent = finalWhy;
          balanceNote.textContent = [balance ? `Credits: ${C.balanceLine(balance)}.` : '', sheetWhy, previewWhy].filter(Boolean).join(' ');
        }
        for (const [button, key] of [[sheetButton, 'sheet'], [previewButton, 'preview'], [finalButton, 'final']]) {
          if (button.disabled) { button.dataset.locked = 'true'; button.title = why[key] || button.title || 'Not available right now.'; }
          else { delete button.dataset.locked; button.removeAttribute('title'); }
        }
      }

      // Live progress for each active job: Stage, Frames (or Clips) done / total, ETA and Running
      // for, each "\u2014" until the data gives it. The ETA comes from what this page has seen:
      // frames done over elapsed time (J.etaSeconds). The worker's own sentence shows below when it
      // sends no structured detail (older workers).
      const sightings = new Map();                      // job id -> samples (J.addSample)
      function progressBlock(j) {
        const p = J.progressView(j, Date.now(), sightings.get(j.id) || []);
        if (!p) return null;
        const bar = p.fraction == null
          ? h('progress', { 'aria-label': `${p.stage === '\u2014' ? 'Progress' : p.stage}: no count yet` })
          : h('progress', { max: '1', value: String(p.fraction), 'aria-label': `${p.stage}: ${Math.floor(p.fraction * 100)}%` });
        const row = (k, v) => [h('dt', {}, k), h('dd', {}, v)];
        return h('div', { class: 'job-progress' },
          bar,
          p.working
            ? h('p', { class: 'working' }, p.elapsed ? `Working\u2026 ${p.elapsed}` : 'Working\u2026')
            : h('dl', { class: 'progress-fields' },
              row('Stage', p.stage), row(p.countLabel, p.count), row('ETA', p.eta), row('Running for', p.running)),
          !j.progress_detail && j.progress_note ? h('p', { class: 'form-note' }, j.progress_note) : null);
      }

      // "Your credits were returned." under a failed or stopped job, from the ledger (job_accounting), never guessed.
      function returnedLine(j, note) {
        const text = C.returnedNote(accounting[j.id]);
        return text && !(note || '').toLowerCase().includes('returned') ? h('p', { class: 'form-note credit-returned' }, text) : null;
      }

      function jobItem(j) {
        const active = J.isActive(j);
        const failed = ['failed', 'editorial_action_required', 'cancelled'].includes(j.state);
        const note = active ? J.progressNote(j, positions[j.id]) : failed ? J.problem(j) : '';
        return h('li', { class: `job job-row-${j.state}` },
          h('strong', {}, J.TYPE_LABELS[j.job_type] || j.job_type),
          h('span', { class: `state job-${j.state}` }, J.STATE_LABELS[j.state] || j.state),
          h('span', { class: 'meta' }, date(j.created_at)),
          creditsOn() && accounting[j.id] ? h('span', { class: 'meta credit-line' }, C.jobCredits(accounting[j.id])) : null,
          progressBlock(j),
          note && !J.progressView(j) ? h('p', { class: failed && j.state !== 'cancelled' ? 'form-note job-problem' : 'form-note' }, note) : null,
          active && !j.cancel_requested
            ? h('button', { class: 'button secondary small', type: 'button', onclick: async event => {
                await busy(event.currentTarget, 'Cancelling…', async () => {
                  try { await data.cancelJob(j.id); await refresh(); } catch (err) { showError(error, err); }
                });
              } }, 'Cancel') : null,
          J.canRetry(j, v.state, jobs)
            ? h('button', { class: 'button secondary small', type: 'button', onclick: event =>
                submit(event.currentTarget, j.job_type,
                       j.job_type === 'preview' && !j.params?.window_s ? { ...j.params, window_s: [0, 10] } : j.params || {},
                       j.job_type === 'final_render' ? { sheetJobId: j.sheet_job_id, previewJobId: j.preview_job_id } : undefined)
              }, 'Try again') : null,
          creditsOn() && failed ? returnedLine(j, note) : null,
          failed && j.state !== 'cancelled' && (J.rawDetail(j) || opsOn())
            ? h('details', { class: 'job-help' }, h('summary', {}, 'Get help with this'),
                J.rawDetail(j) ? h('p', { class: 'form-note' }, 'What the render machine reported, in its own words:') : null,
                J.rawDetail(j) ? h('code', {}, J.rawDetail(j)) : null,
                opsOn() ? h('a', { class: 'meta', href: `#/help?job=${j.id}` }, 'Send this to us') : null) : null);
      }

      function draw() {
        const now = Date.now();
        for (const j of jobs) {
          if (J.isActive(j)) sightings.set(j.id, J.addSample(sightings.get(j.id) || [], j, now));
          else sightings.delete(j.id);
        }
        syncControls();
        listEl.replaceChildren(jobs.length
          ? h('ul', { class: 'job-list' }, jobs.map(jobItem))
          : h('p', { class: 'form-intro' }, 'No jobs yet. Start with a contact sheet.'));
        liveNote.textContent = watch.live() ? '● Live' : 'Updating every 10 seconds';
      }

      let running = null;
      let again = false;
      async function refresh() {
        if (stopped) return;
        if (running) { again = true; return running; }
        running = (async () => {
          do {
            again = false;
            try {
              const [fresh, currentEngine] = await Promise.all([data.listJobs(v.id), data.currentEngine()]);
              engine = currentEngine;
              if (creditsOn()) {
                const types = ['contact_sheet', 'preview', 'final_render'];
                const [q, acct, bal] = await Promise.all([
                  Promise.all(types.map(t => data.creditQuote(v.id, t).catch(err => ({ error: err.message })))),
                  data.jobAccounting(v.id).catch(() => ({})),
                  data.creditBalances().catch(() => null)
                ]);
                quotes = Object.fromEntries(types.map((t, i) => [t, q[i]]));
                accounting = acct;
                balance = bal;
              }
              const pos = {};
              await Promise.all(fresh.filter(j => j.state === 'queued').map(async j => {
                try { pos[j.id] = await data.queuePosition(j.id); } catch { /* position unknown */ }
              }));
              if (stopped) return;
              const before = seen;
              seen = new Map(fresh.map(j => [j.id, j.state]));
              jobs = fresh;
              positions = pos;
              error.hidden = true;
              if (before) {
                const changed = fresh.filter(j => before.get(j.id) !== j.state);
                // A final render's state is the version's state: redraw the whole page.
                if (changed.some(j => j.job_type === 'final_render')) { versionChanged(); return; }
                if (changed.some(j => j.state === 'complete')) settled();
              }
            } catch (err) {
              if (!stopped) showError(error, err);
            }
            await loadOrders();
            if (!stopped) draw();
          } while (again && !stopped);
        })();
        try { await running; } finally { running = null; }
      }

      const watch = data.watchJobs(v.id, () => refresh());
      const timer = setInterval(() => {
        if (!watch.live() || jobs.some(J.isActive) || openOrders) refresh();
        else liveNote.textContent = '● Live';
      }, 10000);
      refresh();

      const el = h('section', { class: 'jobs-panel', 'aria-labelledby': 'jobs-title' },
        h('div', { class: 'jobs-head' }, h('h2', { id: 'jobs-title' }, 'Render'), liveNote),
        h('p', { class: 'form-intro' }, 'A contact sheet and a preview of the current story come first; the final film uses both.'),
        h('p', { class: 'form-note' }, 'A contact sheet is a quick grid of still frames to check the look. A preview is a short clip. The final film is the full render.'),
        controls, balanceNote, lockedNote, error, listEl);

      return {
        el,
        refresh,
        storyChanged(sha) { storySha = sha; v.story_sha256 = sha; syncControls(); },
        stop() { stopped = true; clearInterval(timer); watch.stop(); }
      };
    }

    window.addEventListener('hashchange', route);
    route();
    return () => { token++; stopView(); window.removeEventListener('hashchange', route); root.replaceChildren(); };
  }

  window.ryagramLibrary = { mount };
})();
