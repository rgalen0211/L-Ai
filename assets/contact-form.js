(() => {
  const form = document.getElementById('contact-form');
  if (!form) return;
  const button = form.querySelector('button[type="submit"]');
  const status = document.getElementById('contact-form-status');
  const redirectTo = form.querySelector('input[name="_redirect"]')?.value || 'https://uselai.com/thank-you.html';
  let sending = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending || !form.reportValidity()) return;
    sending = true;
    button.disabled = true;
    button.textContent = 'Sending…';
    form.setAttribute('aria-busy', 'true');
    status.hidden = false;
    status.textContent = 'Sending your message…';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.ok !== true) {
        const errors = Array.isArray(result?.errors)
          ? result.errors.map(error => error.message).filter(Boolean).join(' ')
          : '';
        throw new Error(errors || 'We couldn’t confirm your submission. Please try again or email ryan.galen@uselai.com.');
      }
      // Only an acknowledged Formspree response reaches this branch.
      // Keep measurement failures separate from form success and navigation.
      try { window.laiAnalytics?.contactSubmitted(); } catch { /* Optional tracking. */ }
      window.location.assign(redirectTo);
    } catch (error) {
      status.textContent = error instanceof TypeError || error.name === 'AbortError'
        ? 'We couldn’t confirm delivery because the connection was interrupted. Your details are still here. Check your connection before retrying, or email ryan.galen@uselai.com if you’re unsure whether it arrived.'
        : error.message;
      status.focus();
      sending = false;
      button.disabled = false;
      button.textContent = 'Send L’Ai inquiry';
    } finally {
      clearTimeout(timeout);
      form.removeAttribute('aria-busy');
    }
  });
})();
