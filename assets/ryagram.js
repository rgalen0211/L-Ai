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
  let sending = false;

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
    try {
      const response = await fetch(`${baseUrl}/rest/v1/ryagram_waitlist`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: form.elements.email.value.trim(), use_case: useCase || null, source: 'uselai.com/ryagram' }),
        signal: controller.signal
      });
      // 409 is the unique-email rule: already on the list, which is the outcome they wanted.
      // Same message either way, so the form can't be used to test who has signed up.
      if (response.ok || response.status === 409) { joined(); return; }
      say(`We couldn’t add you just now. Please try again, or email ${CONTACT}.`);
    } catch {
      say(`The connection dropped before we could confirm. Your details are still here; try again, or email ${CONTACT}.`);
    } finally {
      clearTimeout(timeout);
      sending = false;
      button.disabled = false;
      button.textContent = 'Join the waitlist';
      form.removeAttribute('aria-busy');
    }
  });
})();
