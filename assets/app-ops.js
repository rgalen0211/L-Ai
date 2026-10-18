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

  // Stripe events the webhook could not match (nothing was changed for them): Ryan fixes them by hand, then marks them reviewed.
  function stripeLine(st) {
    if (!st || !st.available) return 'Payments are not set up yet, so there is nothing to review.';
    const open = Number(st.open) || 0;
    return open ? `${plural(open, 'payment event')} need${open === 1 ? 's' : ''} your review: nothing was changed for ${open === 1 ? 'it' : 'them'}. Fix by hand (adjust or grant credits), then mark ${open === 1 ? 'it' : 'them'} reviewed.` : 'No payment events need review.';
  }

  // Creator beta applications on the Operations screen (SQL 20261014000100).
  const CREATOR_KIND_WORDS = { youtuber: 'YouTuber', podcaster: 'Podcaster', newsletter: 'Newsletter writer', journalist: 'Journalist', teacher: 'Teacher', researcher: 'Researcher', other: 'Something else' };
  function creatorLine(cb) {
    if (!cb) return 'Creator applications are not set up yet (apply SQL 20261014000100).';
    const w = Number(cb.waiting) || 0;
    return `${plural(w, 'application')} waiting. ${Number(cb.approved) || 0} approved, ${Number(cb.declined) || 0} declined so far. Approving sends nothing and grants no credits: reply from your inbox and grant the free beta credits by hand.`;
  }

  // ---- The creator beta flow: film requests (people) and the queue and invites (Ryan). SQL 20261016000200.
  const REQUEST_STATUS_WORDS = { new: 'Waiting', in_progress: 'In progress', delivered: 'Delivered', declined: 'Declined, your credits were returned' };
  function checkRequest({ question, notes }) {
    const q = String(question || '').replace(/\s+/g, ' ').trim();
    if (q.length < 10) return 'Tell us the question you want answered (at least a few words).';
    if (q.length > 1000) return 'That question is too long. Please keep it under 1,000 characters.';
    if (String(notes || '').trim().length > 1000) return 'Keep the notes under 1,000 characters.';
    return null;
  }
  function requestCostLine(cost) {
    if (cost == null) return 'A film request costs credits.';
    return `A film request costs ${plural(Number(cost), 'credit')}. If we cannot make it, you get them back.`;
  }
  function checkDelivery(url) {
    return /^https:\/\/\S+$/.test(String(url || '').trim()) && String(url).trim().length <= 500 ? null : 'To mark it delivered, paste the https link to the film.';
  }
  // The email Ryan sends with an invite code: a mailto: link, so he reads and sends it himself (nothing is sent for him).
  function inviteMailto({ name, email, code, credits }) {
    const subject = 'Your Ryagram creator beta invite';
    const body = [`Hi ${String(name || '').split(' ')[0] || 'there'},`, '',
      `You're in. Your invite code is ${code}.`, '',
      'Go to https://uselai.com/app/, choose "Have an invite code?", and enter the code with this email address. You will get an email to set your password' + (Number(credits) > 0 ? `, and ${plural(Number(credits), 'beta credit')} will be waiting for you.` : '.'), '',
      'Beta credits are free, in exchange for your feedback. If you talk about or promote Ryagram, or a film you made with it, please say your credits were free.'].join('\n');
    return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  // ---- Funnel on the Operations screen (SQL 20261017000900): counts per step, conversion between steps, by source and by week.
  // The first two steps are VISITS (anonymous); every other step counts each account once. The chain below is the order people go through.
  const FUNNEL_LABELS = { landing_view: 'Saw the landing page', signup_started: 'Started signing up', signup_done: 'Signed up', first_project: 'Made a first project', contact_sheet: 'Made a contact sheet',
    preview: 'Made a preview', film_requested: 'Requested a film', film_delivered: 'Film delivered', purchase: 'Bought credits', subscription_start: 'Started a plan', subscription_cancel: 'Cancelled a plan',
    return_7d: 'Came back after 7 days', return_30d: 'Came back after 30 days' };
  const FUNNEL_CHAIN = ['landing_view', 'signup_started', 'signup_done', 'first_project', 'contact_sheet', 'preview', 'film_requested', 'film_delivered', 'purchase'];
  const FUNNEL_SIDE = ['subscription_start', 'subscription_cancel', 'return_7d', 'return_30d'];          // judged against people who signed up
  const FUNNEL_KEY = ['landing_view', 'signup_done', 'first_project', 'film_requested', 'purchase'];     // the columns of the by-source and by-week tables
  const pct = (n, d) => (d > 0 ? `${Math.round((n / d) * 1000) / 10}%` : '\u2014');
  function funnelRows(f) {
    if (!f || !Array.isArray(f.steps)) return [];
    const by = Object.fromEntries(f.steps.map(s => [s.event, s.total]));
    const rows = [];
    FUNNEL_CHAIN.forEach((event, i) => rows.push({ event, label: FUNNEL_LABELS[event], total: by[event] || 0,
      fromPrevious: i ? pct(by[event] || 0, by[FUNNEL_CHAIN[i - 1]] || 0) : '', fromFirst: i ? pct(by[event] || 0, by.landing_view || 0) : '' }));
    for (const event of FUNNEL_SIDE) rows.push({ event, label: FUNNEL_LABELS[event], total: by[event] || 0, fromPrevious: pct(by[event] || 0, by.signup_done || 0), fromFirst: '', side: true });
    return rows;
  }
  function funnelBySource(f) {
    if (!f || !Array.isArray(f.steps)) return [];
    const step = e => f.steps.find(s => s.event === e) || { by_source: {} };
    const sources = [...new Set(FUNNEL_KEY.flatMap(e => Object.keys(step(e).by_source || {})))];
    return sources.map(src => {
      const counts = Object.fromEntries(FUNNEL_KEY.map(e => [e, (step(e).by_source || {})[src] || 0]));
      return { source: src, counts, signupRate: pct(counts.signup_done, counts.landing_view) };
    }).sort((a, b) => (b.counts.landing_view + b.counts.signup_done) - (a.counts.landing_view + a.counts.signup_done) || a.source.localeCompare(b.source));
  }
  function funnelByWeek(f) {
    if (!f || !Array.isArray(f.steps)) return [];
    const step = e => f.steps.find(s => s.event === e) || { by_week: {} };
    return [...(f.weeks || [])].reverse().map(week => ({ week, counts: Object.fromEntries(FUNNEL_KEY.map(e => [e, (step(e).by_week || {})[week] || 0])) }));
  }
  const funnelLine = f => (f ? 'Visits (the first two steps) are counted each time; every other step counts each account once, the first time it happens. Source = the link\u2019s utm_source, else the referring site, else direct.'
                            : 'Funnel tracking is not set up yet (apply SQL 20261017000900).');

  // ---- Costs on the Operations screen (SQL 20261016000100). An unknown cost is never shown as $0.
  const COST_VENDORS = [['stripe', 'Stripe'], ['resend', 'Resend (email)'], ['supabase', 'Supabase'], ['domain', 'Domain'], ['cloud', 'Cloud'], ['anthropic', 'Anthropic (AI editor)'], ['render', 'Rendering'], ['other', 'Other']];
  const vendorWord = v => (COST_VENDORS.find(([id]) => id === v) || [v, v])[1];
  const usd2 = n => {
    const x = Number(n) || 0;
    return `$${x !== 0 && Math.abs(x) < 0.01 ? x.toFixed(4) : x.toFixed(2)}`;
  };
  function unknownNote(n) {
    return n > 0 ? `, plus ${plural(n, 'event')} with an unknown cost (not counted)` : '';
  }
  function costLine(c) {
    if (!c) return 'Cost tracking is not set up yet (apply SQL 20261016000100).';
    const today = (c.days || [])[0] || { total_usd: 0, unknown_events: 0 };
    const m = c.month || { total_usd: 0, unknown_events: 0 };
    const t = c.test && c.test.events ? ` Stripe test mode: ${plural(c.test.events, 'event')} (no real money, not counted).` : '';
    const u = c.unknown_mode && c.unknown_mode.events ? ` ${plural(c.unknown_mode.events, 'event')} came without a live or test flag: not counted as money and never alarmed.` : '';
    return `Today ${usd2(today.total_usd)} known${unknownNote(today.unknown_events)}. This month ${usd2(m.total_usd)} known${unknownNote(m.unknown_events)}.${t}${u}`;
  }
  function usageLine(u) {
    if (!u) return '';
    const e = u.emails_today == null ? 'unknown' : String(Math.round(u.emails_today));
    const s = u.storage_bytes == null ? 'unknown' : `${(u.storage_bytes / 1048576).toFixed(1)} MB`;
    return `Emails sent today by our own alerts and digests: ${e} (sign-up emails are not counted here; see the Resend dashboard). Stored films, sheets and previews: ${s}.`;
  }
  const THRESHOLD_STATUS = { ok: 'under the limit', warn: 'WARNING', over: 'OVER THE LIMIT', off: 'off' };
  function thresholdLine(t) {
    const who = t.vendor ? vendorWord(t.vendor) : 'All vendors';
    const pct = t.limit_usd > 0 ? Math.round((Number(t.spent_usd) / Number(t.limit_usd)) * 100) : 0;
    return `${who}, per ${t.period}: ${usd2(t.spent_usd)} of ${usd2(t.limit_usd)} (${pct}%), warns at ${t.warn_pct}%: ${THRESHOLD_STATUS[t.status] || t.status}`;
  }
  function checkThreshold({ vendor, period, limit, warnPct }) {
    if (vendor && !COST_VENDORS.some(([id]) => id === vendor)) return 'Choose a vendor, or all vendors.';
    if (period !== 'day' && period !== 'month') return 'Choose per day or per month.';
    const l = Number(limit);
    if (!Number.isFinite(l) || l <= 0 || l > 100000) return 'Enter a limit above $0.';
    const w = Number(warnPct);
    if (!Number.isInteger(w) || w < 1 || w > 99) return 'The warning percentage must be a whole number from 1 to 99.';
    return null;
  }
  function checkPlan({ vendor, plan, monthly, startsOn }) {
    if (!COST_VENDORS.some(([id]) => id === vendor)) return 'Choose a vendor.';
    if (!String(plan || '').trim() || String(plan).length > 60) return 'Name the plan.';
    const m = Number(monthly);
    if (!Number.isFinite(m) || m < 0 || m > 100000 || String(monthly).trim() === '') return 'Enter the monthly price in dollars (0 is allowed).';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startsOn || ''))) return 'Enter the date the plan starts.';
    return null;
  }
  function checkManualCost({ vendor, amount, on }) {
    if (!COST_VENDORS.some(([id]) => id === vendor)) return 'Choose a vendor.';
    const a = Number(amount);
    if (!Number.isFinite(a) || a < 0 || a > 1000000 || String(amount).trim() === '') return 'Enter the amount in dollars.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(on || ''))) return 'Enter the date it was charged.';
    return null;
  }

  const ENDED_WORDS = { failed: 'Failed', cancelled: 'Cancelled', editorial_action_required: 'Stopped by a check' };
  const REASON_WORDS = { child_safety: 'Child safety', private_information: 'Private information', harassment: 'Harassment', copyright: 'Copyright', other: 'Other' };

  window.ryagramOps = { FUNNEL_LABELS, FUNNEL_CHAIN, FUNNEL_KEY, funnelRows, funnelBySource, funnelByWeek, funnelLine, TOPICS, bannerText, jobFromHash, checkSupport, ago, renderingLine, queueLine, spendLines, backupLine, childSafetyLine, stripeLine, creatorLine, CREATOR_KIND_WORDS, REQUEST_STATUS_WORDS, checkRequest, requestCostLine, checkDelivery, inviteMailto, usd, ENDED_WORDS, REASON_WORDS, COST_VENDORS, vendorWord, usd2, costLine, usageLine, thresholdLine, checkThreshold, checkPlan, checkManualCost };
})();
