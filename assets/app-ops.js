// Operations helpers for the app: the "rendering is delayed" notice and the help form's checks. Pure functions.
// Server side: supabase/migrations/20261010000100_ops_readiness.sql (service_status, submit_support).
(() => {
  const TOPICS = [['render', 'A film is stuck or failed'], ['credits', 'Credits'], ['account', 'My account'],
                  ['upload', 'My own data (upload)'], ['other', 'Something else']];
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  // service_status() -> the notice text, or null when nothing should be shown ('ok', 'unknown', or no answer at all).
  function bannerText(status, timeZone) {
    if (!status || status.rendering !== 'delayed') return null;
    const t = Date.parse(status.last_check_in || '');
    const since = Number.isFinite(t)
      ? ` The render machine last checked in at ${new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) })}.` : '';
    return `Rendering is delayed.${since} Your film will start as soon as it is back. If it waits more than an hour we cancel it and give your credits back.`;
  }

  // "#/help?job=<uuid>" -> the job id, or null (anything else is ignored, never passed on).
  function jobFromHash(hash) {
    const m = String(hash || '').match(/^#\/help\?job=([0-9a-f-]{36})$/);
    return m && UUID.test(m[1]) ? m[1] : null;
  }

  // Returns an error sentence, or null when the form can be sent.
  function checkSupport({ email, topic, message }) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim()) || String(email).trim().length > 200) return 'Enter an email address we can reply to.';
    if (!TOPICS.some(([id]) => id === topic)) return 'Choose what this is about.';
    const n = String(message || '').trim().length;
    if (n < 5) return 'Tell us a little more (at least a few words).';
    if (n > 4000) return 'That is too long. Please keep it under 4,000 characters.';
    return null;
  }

  window.ryagramOps = { TOPICS, bannerText, jobFromHash, checkSupport };
})();
