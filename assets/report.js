// Report a film (/report/): sends report_film_page(slug, reason, email, details, website) with the public key.
// Server side: supabase/migrations/20261010000100_ops_readiness.sql. Off until ryagramConfig.opsTools is true (or ?mock locally).
(() => {
  const SLUG = /^[A-Za-z0-9_-]{22}$/;
  const REASONS = ['child_safety', 'private_information', 'harassment', 'copyright', 'other'];

  // A pasted link (https://uselai.com/film/?s=<slug>), a bare slug, or "?s=<slug>" -> the slug, or null.
  function slugFrom(text) {
    const t = String(text || '').trim();
    if (SLUG.test(t)) return t;
    const m = t.match(/[?&]s=([A-Za-z0-9_-]{22})(?:[&#]|$)/);
    return m ? m[1] : null;
  }

  // Returns { error } or { body } (the RPC arguments).
  function build({ film, reason, email, details, website }) {
    const slug = slugFrom(film);
    if (!slug) return { error: 'Paste the film’s link (it looks like https://uselai.com/film/?s=…).' };
    if (!REASONS.includes(reason)) return { error: 'Choose what the problem is.' };
    const mail = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail) || mail.length > 200) return { error: 'Enter an email address we can reply to.' };
    const more = String(details || '').trim();
    if (more.length > 4000) return { error: 'That is too long. Please keep it under 4,000 characters.' };
    return { body: { p_slug: slug, p_reason: reason, p_email: mail, p_details: more, p_website: website || '' } };
  }

  // The server answers the same way for a film that exists and one that does not, so the page never confirms either.
  async function send(body, fetchFn = fetch, config = window.ryagramConfig || {}) {
    if (!config.supabaseUrl || !config.supabaseKey) throw new Error('Reports are not available just now. Please write to ryagram@uselai.com.');
    const res = await fetchFn(`${config.supabaseUrl}/rest/v1/rpc/report_film_page`, {
      method: 'POST', headers: { apikey: config.supabaseKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (res.ok) return true;
    let text = '';
    try { text = (await res.json()).message || ''; } catch { /* keep the plain message */ }
    throw new Error(/Too many/.test(text) ? 'Too many reports from this connection just now. Please try again later.'
      : 'Couldn’t send that just now. Please write to ryagram@uselai.com.');
  }

  function start() {
    const form = document.getElementById('report-form');
    if (!form) return;
    const cfg = window.ryagramConfig || {};
    const local = ['localhost', '127.0.0.1'].includes(location.hostname);
    const on = cfg.opsTools === true || (local && new URLSearchParams(location.search).has('mock'));
    const error = document.getElementById('r-error');
    const done = document.getElementById('r-done');
    const film = document.getElementById('r-film');
    const fromLink = new URLSearchParams(location.search).get('film');
    if (fromLink && SLUG.test(fromLink)) film.value = fromLink;
    if (!on) { form.hidden = true; done.hidden = false; done.textContent = 'Reporting from this page is not open yet. Please write to ryagram@uselai.com with the film’s link.'; return; }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      error.hidden = true;
      const r = build({ film: film.value, reason: form.querySelector('input[name="reason"]:checked')?.value,
                        email: document.getElementById('r-email').value, details: document.getElementById('r-details').value,
                        website: document.getElementById('r-website').value });
      if (r.error) { error.textContent = r.error; error.hidden = false; return; }
      try {
        if (!(local && new URLSearchParams(location.search).has('mock'))) await send(r.body);
        form.hidden = true;
        done.hidden = false;
      } catch (err) { error.textContent = err.message; error.hidden = false; }
    });
  }

  window.ryagramReport = { slugFrom, build, send };
  if (typeof document !== 'undefined') start();
})();
