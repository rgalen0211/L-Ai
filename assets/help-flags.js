// Help page: an entry marked data-flag="name" is shown only when that switch is ON in the site's config (assets/ryagram-config.js). Without this script, or with the switch off or unknown,
// the entry stays hidden, so help never describes something the site does not offer yet. data-flag may list several names separated by spaces; ALL of them must be on.
(() => {
  const cfg = (typeof window !== 'undefined' && window.ryagramConfig) || {};
  document.querySelectorAll('[data-flag]').forEach(el => {
    const names = String(el.getAttribute('data-flag') || '').split(/\s+/).filter(Boolean);
    if (names.length && names.every(n => cfg[n] === true)) el.hidden = false;
  });
})();
