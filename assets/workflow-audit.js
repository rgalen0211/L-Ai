(() => {
  const other = document.getElementById('systems-other');
  const details = document.getElementById('other-details');
  const input = document.getElementById('other-software');
  function updateOther() {
    details.hidden = !other.checked;
    input.disabled = !other.checked;
  }
  other.addEventListener('change', updateOther);
  window.addEventListener('pageshow', updateOther);
  updateOther();

  const form = document.getElementById('audit-form');
  const button = form.querySelector('button[type="submit"]');
  const status = document.getElementById('form-status');
  let sending = false;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending || !form.reportValidity()) return;
    sending = true;
    button.disabled = true;
    button.textContent = 'Sending…';
    form.setAttribute('aria-busy', 'true');
    status.hidden = false;
    status.textContent = 'Sending your task…';
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
      try { window.laiAnalytics?.auditSubmitted(); } catch { /* Optional tracking. */ }
      // This marker is navigation context only, never proof for conversion tracking.
      window.location.assign('/workflow-audit-thanks.html?ref=fs');
    } catch (error) {
      status.textContent = error instanceof TypeError || error.name === 'AbortError'
        ? 'We couldn’t confirm delivery because the connection was interrupted. Your details are still here. Check your connection before retrying, or email ryan.galen@uselai.com if you’re unsure whether it arrived.'
        : error.message;
      status.focus();
      sending = false;
      button.disabled = false;
      button.textContent = 'Send My Task';
    } finally {
      clearTimeout(timeout);
      form.removeAttribute('aria-busy');
    }
  });
})();
