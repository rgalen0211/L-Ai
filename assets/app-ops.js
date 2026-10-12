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
    return `Rendering is delayed.${since} Your film will start as soon as it is back. If it waits more than an hour we stop it and give your credits back.`;
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

  // ---- Ryan's Operations screen (#/admin/ops): pure wording over admin_ops().
  const usd = n => `$${Number(n || 0).toFixed(2)}`;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

  function ago(iso, now = Date.now()) {
    const t = Date.parse(iso || '');
    if (!Number.isFinite(t)) return 'never';
    const min = Math.max(0, Math.floor((now - t) / 60000));
    if (min < 1) return 'just now';
    if (min < 60) return `${plural(min, 'minute')} ago`;
    if (min < 2880) return `${plural(Math.floor(min / 60), 'hour')} ago`;
    return `${plural(Math.floor(min / 1440), 'day')} ago`;
  }

  function renderingLine(d, now) {
    const word = { ok: 'Rendering is running.', delayed: 'Rendering is DELAYED: the render machine has stopped checking in.', unknown: 'Rendering status is unknown: the worker has not reported in yet.' }[d.rendering] || 'Rendering status is unknown.';
    const seen = d.last_check_in ? ` Last check-in ${ago(d.last_check_in, now)}.` : '';
    const disk = d.free_gb != null ? ` ${Number(d.free_gb).toFixed(0)} GB free on the render disk.` : '';
    return word + seen + disk;
  }

  function queueLine(d) {
    const old = d.oldest_queued_min > 0 ? ` The oldest has waited ${d.oldest_queued_min >= 60 ? plural(Math.floor(d.oldest_queued_min / 60), 'hour') : plural(d.oldest_queued_min, 'minute')}.` : '';
    return `${d.queued} queued, ${d.running} running.${d.queued ? old : ''}`;
  }

  function spendLines(ai) {
    if (!ai) return [];
    const state = ai.enabled === false ? 'The AI editor is switched off.' : ai.state === 'paused' ? 'The AI editor is PAUSED by a spend cap.' : ai.state === 'warn' ? 'Spend is over 80% of a cap.' : 'The AI editor is within its caps.';
    return [state, `Today ${usd(ai.day_spent)} of ${usd(ai.day_cap)}. This month ${usd(ai.month_spent)} of ${usd(ai.month_cap)}.`];
  }

  function backupLine(b, now) {
    if (!b) return 'No backup information.';
    if (!b.expected) return b.last_daily_ok ? `Backups are not being watched yet (last good dump ${ago(b.last_daily_ok, now)}).` : 'Backups are not set up yet.';
    const size = b.last_daily_bytes != null ? `, ${(b.last_daily_bytes / 1048576).toFixed(1)} MB` : '';
    const test = b.last_restore_test ? ` Restore test ${b.last_restore_ok ? 'passed' : 'FAILED'} ${ago(b.last_restore_test, now)}.` : ' No restore test yet.';
    return `Last good daily dump ${ago(b.last_daily_ok, now)}${size}.${test}`;
  }

  // Child-safety reports (Ryan, 2026-10-12): always recorded, hidden automatically up to an hourly cap, URGENT alert for every one.
  function childSafetyLine(cs) {
    if (!cs) return 'No child-safety information.';
    const open = Number(cs.open) || 0;
    const head = open ? `${plural(open, 'open child-safety report')}${cs.open_not_hidden ? `, ${cs.open_not_hidden} NOT hidden (the hourly cap was reached): review ${cs.open_not_hidden === 1 ? 'it' : 'them'} first` : ', all hidden pending your review'}.` : 'No open child-safety reports.';
    return `${head} Pages hidden automatically this hour: ${cs.holds_this_hour} of ${cs.holds_cap}.`;
  }

  const ENDED_WORDS = { failed: 'Failed', cancelled: 'Cancelled', editorial_action_required: 'Stopped by a check' };
  const REASON_WORDS = { child_safety: 'Child safety', private_information: 'Private information', harassment: 'Harassment', copyright: 'Copyright', other: 'Other' };

  window.ryagramOps = { TOPICS, bannerText, jobFromHash, checkSupport, ago, renderingLine, queueLine, spendLines, backupLine, childSafetyLine, usd, ENDED_WORDS, REASON_WORDS };
})();
