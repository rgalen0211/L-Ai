(() => {
  const CONTACT = 'ryan.galen@uselai.com';

  // Accepts a bare video ID or any common YouTube link; returns '' for anything else.
  function youtubeId(value) {
    const raw = String(value || '').trim();
    if (/^[\w-]{11}$/.test(raw)) return raw;
    let url;
    try { url = new URL(raw); } catch { return ''; }
    const host = url.hostname.replace(/^(www\.|m\.)/, '');
    let id = '';
    if (host === 'youtu.be') id = url.pathname.slice(1);
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      id = url.searchParams.get('v') || (url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/) || [])[1] || '';
    }
    return /^[\w-]{11}$/.test(id) ? id : '';
  }

  // Film slots: set data-youtube on a .film-slot to a link or ID and it becomes a player.
  for (const slot of document.querySelectorAll('.film-slot[data-youtube]')) {
    const id = youtubeId(slot.dataset.youtube);
    if (!id) continue;
    const frame = document.createElement('iframe');
    frame.src = `https://www.youtube-nocookie.com/embed/${id}`;
    frame.title = slot.dataset.title || 'Ryagram film';
    frame.loading = 'lazy';
    frame.allow = 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    frame.referrerPolicy = 'strict-origin-when-cross-origin';
    frame.allowFullscreen = true;
    slot.querySelector('.film-frame').replaceChildren(frame);
    slot.classList.add('is-live');
  }

  const form = document.getElementById('waitlist-form');
  if (!form) return;
  const button = form.querySelector('button[type="submit"]');
  const status = document.getElementById('waitlist-status');
  const config = window.ryagramConfig || {};
  const baseUrl = String(config.supabaseUrl || '').replace(/\/+$/, '');
  const key = String(config.supabaseKey || '');
  // With a Turnstile site key the form goes through the waitlist-join Edge Function, which
  // checks with Cloudflare that a person filled it in. Without one it inserts directly, as before.
  const siteKey = String(config.turnstileSiteKey || '');
  let sending = false;
  let token = '';
  let widget = null;

  if (siteKey) {
    const box = form.querySelector('.turnstile-box');
    box.hidden = false;
    window.ryagramTurnstileReady = () => {
      widget = window.turnstile.render(box, {
        sitekey: siteKey,
        action: 'waitlist',
        callback: t => { token = t; },
        'expired-callback': () => { token = ''; },
        'error-callback': () => { token = ''; }
      });
    };
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=ryagramTurnstileReady';
    script.async = true;
    document.head.append(script);
  }

  function say(message) {
    status.hidden = false;
    status.textContent = message;
    status.focus();
  }

  function joined() {
    form.querySelector('.waitlist-fields').hidden = true;
    say('You’re on the list. We’ll email you when there’s something to try.');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending || !form.reportValidity()) return;
    // Hidden from people; a filled value means a bot. Look successful, send nothing.
    if (form.elements.website.value) { joined(); return; }
    if (!baseUrl || !key) {
      say(`The waitlist isn’t connected yet. Email ${CONTACT} and we’ll add you by hand.`);
      return;
    }
    if (siteKey && !token) {
      say('Please complete the check above the button, then press Join again.');
      return;
    }
    sending = true;
    button.disabled = true;
    button.textContent = 'Joining…';
    form.setAttribute('aria-busy', 'true');
    const headers = { apikey: key, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
    // Legacy anon keys are JWTs and go in Authorization too; publishable keys must not.
    if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
    const useCase = form.elements.use_case.value.trim();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const email = form.elements.email.value.trim();
    try {
      const response = siteKey
        ? await fetch(`${baseUrl}/functions/v1/waitlist-join`, {
            method: 'POST',
            headers: { apikey: key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, use_case: useCase || null, token }),
            signal: controller.signal
          })
        : await fetch(`${baseUrl}/rest/v1/ryagram_waitlist`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ email, use_case: useCase || null, source: 'uselai.com/ryagram' }),
            signal: controller.signal
          });
      // 409 is the unique-email rule on the direct path: already on the list, which is the
      // outcome they wanted. Same message either way, so the form can't reveal who signed up.
      if (response.ok || (!siteKey && response.status === 409)) { joined(); return; }
      const problem = siteKey ? (await response.json().catch(() => ({}))).error : null;
      say(problem === 'check'
        ? 'The check didn’t go through. Please complete it again, then press Join.'
        : `We couldn’t add you just now. Please try again, or email ${CONTACT}.`);
    } catch {
      say(`The connection dropped before we could confirm. Your details are still here; try again, or email ${CONTACT}.`);
    } finally {
      clearTimeout(timeout);
      // A Turnstile token works once; get a fresh one for any retry.
      if (siteKey && widget !== null && window.turnstile) { window.turnstile.reset(widget); token = ''; }
      sending = false;
      button.disabled = false;
      button.textContent = 'Join the waitlist';
      form.removeAttribute('aria-busy');
    }
  });
})();
