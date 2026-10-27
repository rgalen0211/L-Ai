// The creator beta form on /ryagram/#creators. Sends the application to the creator-beta function (which stores it for Ryan to approve).
// Off until ryagramConfig.creatorBeta is true (deploy the function and apply SQL 20261014000100 first); until then the form says to email.
(() => {
  const CONTACT = 'ryagram@uselai.com';
  const KINDS = [['youtuber', 'YouTuber'], ['podcaster', 'Podcaster'], ['newsletter', 'Newsletter writer'], ['journalist', 'Journalist'],
                 ['teacher', 'Teacher'], ['researcher', 'Researcher'], ['other', 'Something else']];

  // The same rules the database applies (20261014000100_creator_beta.sql); this only saves a round trip. Returns an error sentence or null.
  function checkCreator(v) {
    const t = x => String(x == null ? '' : x).trim();
    const n = t(v.name), m = t(v.makes), q = t(v.question), l = t(v.link);
    if (n.length < 2 || n.length > 100) return 'Enter your name.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t(v.email)) || t(v.email).length > 200) return 'Enter an email address we can reply to.';
    if (!KINDS.some(([id]) => id === v.kind)) return 'Choose what describes you best.';
    if (m.length < 3 || m.length > 200) return 'Tell us what you make (a few words).';
    if (!/^https:\/\/\S+$/.test(l) || l.length < 10 || l.length > 300) return 'Add a link to your channel or site (it starts with https://).';
    if (q.length < 10 || q.length > 1000) return 'Tell us the question you would answer with data (10 to 1,000 characters).';
    return null;
  }

  const api = { KINDS, checkCreator };
  if (typeof window !== 'undefined') window.ryagramCreator = api;

  const form = typeof document !== 'undefined' ? document.getElementById('creator-form') : null;
  if (!form) return;
  const button = form.querySelector('button[type="submit"]');
  const status = document.getElementById('creator-status');
  const config = window.ryagramConfig || {};
  const baseUrl = String(config.supabaseUrl || '').replace(/\/+$/, '');
  const key = String(config.supabaseKey || '');
  let sending = false;

  function say(message) { status.hidden = false; status.textContent = message; status.focus(); }

  // WHILE THE FORM IS OFF (Ryan, 2026-10-17: the landing ships before the Terms and Privacy pages): no form to fill in for nothing. The hero
  // button asks for an invite by email, and the form's place says how. Turning creatorBeta on brings both back unchanged.
  const INVITE_MAIL = `mailto:${CONTACT}?subject=${encodeURIComponent('Ryagram invite request')}`;
  if (config.creatorBeta !== true) {
    const hero = document.querySelector('.rg-hero-cta a.rg-btn');
    if (hero) { hero.textContent = 'Email to request an invite'; hero.href = INVITE_MAIL; }
    form.querySelector('.creator-fields').hidden = true;
    status.hidden = false;
    status.textContent = '';
    status.append(`Creator beta applications open soon. To request an invite now, email `,
      Object.assign(document.createElement('a'), { href: INVITE_MAIL, textContent: CONTACT }), ' with your link and the question you would answer with data.');
    return;
  }

  function done() {
    form.querySelector('.creator-fields').hidden = true;
    say('Thanks, we have your application. We read every one and will email you at the address you gave.');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending) return;
    const el = form.elements;
    const values = { name: el.name.value, email: el.email.value, kind: el.kind.value, makes: el.makes.value, link: el.link.value, question: el.question.value };
    const problem = checkCreator(values);
    if (problem) { say(problem); return; }
    // Hidden from people; a filled value means a bot. Look successful, send nothing.
    if (el.website.value) { done(); return; }
    if (config.creatorBeta !== true || !baseUrl || !key) {
      say(`Creator beta applications open soon. Email ${CONTACT} with your link and your question and we’ll add you by hand.`);
      return;
    }
    sending = true;
    button.disabled = true;
    button.textContent = 'Sending…';
    form.setAttribute('aria-busy', 'true');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const trimmed = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.trim()]));
      const response = await fetch(`${baseUrl}/functions/v1/creator-beta`, {
        method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ ...trimmed, website: el.website.value })
      });
      if (response.ok) { done(); return; }
      let message = '';
      try { message = (await response.json()).error || ''; } catch { /* keep the generic line */ }
      say((response.status === 422 || response.status === 429) && message ? message : `We couldn’t send that just now. Please try again, or email ${CONTACT}.`);
    } catch {
      say(`The connection dropped before we could confirm. Your answers are still here; try again, or email ${CONTACT}.`);
    } finally {
      clearTimeout(timeout);
      sending = false;
      button.disabled = false;
      button.textContent = 'Apply for the creator beta';
      form.removeAttribute('aria-busy');
    }
  });
})();
