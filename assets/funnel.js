// First-party funnel tracking (SQL 20261017000900): our own database only, no third-party pixels, no cookies.
//
// What it does, and all it does:
//   * remembers how a visitor first found us, as ONE small record in this browser's local storage: utm_source / utm_medium / utm_campaign from the link and the
//     referrer's DOMAIN (youtube.com). No identifier, no address, nothing else. It is stored only when there is something to store (a direct visit stores nothing).
//   * /ryagram/ page load -> funnel_anon('landing_view', this visit's source); the invite-code form -> funnel_anon('signup_started', the stored source).
//   * first sign-in -> funnel_attach_source(the stored source) ONCE (the database keeps the first answer), then the record is deleted from the browser;
//     every app load -> funnel_return_visit() (the database decides whether it is a 7- or 30-day return).
//   * every other step (first project, contact sheet, preview, film request and delivery, purchase, subscription) is written by the database itself.
// Off until ryagramConfig.funnelTracking is true (the SQL must be applied first). Skipped entirely, storing and sending nothing, for Do Not Track, Global Privacy
// Control, automated browsers and obvious crawlers. Never blocks or changes the page; every failure is swallowed.
(() => {
  const KEY = 'ryagram-source';
  const clean = (v, max = 60) => String(v || '').toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, max);

  function enabled() {
    try {
      const cfg = window.ryagramConfig || {};
      if (cfg.funnelTracking !== true || !cfg.supabaseUrl || !cfg.supabaseKey) return false;
      if (typeof navigator === 'undefined' || typeof location === 'undefined') return false;
      if (navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true || navigator.webdriver) return false;
      if (/bot|crawl|spider|headless|preview|lighthouse/i.test(navigator.userAgent || '')) return false;
      return true;
    } catch { return false; }
  }

  // The referrer's domain, or '' for a direct visit or one of our own pages.
  function referrerDomain() {
    try {
      if (!document.referrer) return '';
      const host = new URL(document.referrer).hostname.toLowerCase().replace(/^www\./, '');
      if (!host || host === location.hostname.replace(/^www\./, '') || /(^|\.)uselai\.com$/.test(host)) return '';
      return clean(host, 100);
    } catch { return ''; }
  }

  function currentSource() {
    let p;
    try { p = new URLSearchParams(location.search || ''); } catch { p = new URLSearchParams(''); }
    return { s: clean(p.get('utm_source') || p.get('ref')), m: clean(p.get('utm_medium')), c: clean(p.get('utm_campaign')), r: referrerDomain() };
  }
  const isEmpty = src => !src.s && !src.m && !src.c && !src.r;

  function stored() {
    try { const v = JSON.parse(window.localStorage.getItem(KEY) || 'null'); return v && typeof v === 'object' ? { s: clean(v.s), m: clean(v.m), c: clean(v.c), r: clean(v.r, 100) } : null; } catch { return null; }
  }
  // First touch wins: a record already there is never replaced.
  function remember() {
    try {
      if (stored()) return;
      const src = currentSource();
      if (!isEmpty(src)) window.localStorage.setItem(KEY, JSON.stringify(src));
    } catch { /* storage may be blocked: the visit still counts, only the account's source is lost */ }
  }
  function forget() { try { window.localStorage.removeItem(KEY); } catch { /* nothing to do */ } }

  function anon(event, src) {
    try {
      const cfg = window.ryagramConfig, base = String(cfg.supabaseUrl).replace(/\/+$/, ''), key = String(cfg.supabaseKey);
      const headers = { apikey: key, 'Content-Type': 'application/json' };
      if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
      Promise.resolve(fetch(`${base}/rest/v1/rpc/funnel_anon`, { method: 'POST', keepalive: true, headers,
        body: JSON.stringify({ p_event: event, p_utm_source: src.s, p_utm_medium: src.m, p_utm_campaign: src.c, p_referrer: src.r }) })).catch(() => {});
    } catch { /* never in the way */ }
  }

  function landingView() {
    if (!enabled()) return;
    if (location.pathname.replace(/index\.html$/, '') !== '/ryagram/') return;
    remember();
    anon('landing_view', currentSource());
  }

  function signupStarted() {
    if (!enabled()) return;
    remember();
    anon('signup_started', stored() || currentSource());
  }

  // After sign-in: the account's source (once), then the return-visit check. `client` is the app's Supabase client.
  async function signedIn(client) {
    if (!enabled()) return;
    try {
      const src = stored();
      if (src && !isEmpty(src)) {
        const { error } = await client.rpc('funnel_attach_source', { p_utm_source: src.s, p_utm_medium: src.m, p_utm_campaign: src.c, p_referrer: src.r });
        if (!error) forget();                                                  // attached (or already had one): the browser keeps nothing
      }
      await client.rpc('funnel_return_visit');
    } catch { /* never in the way */ }
  }

  window.ryagramFunnel = { landingView, signupStarted, signedIn, currentSource, clean, KEY };
  if (typeof document !== 'undefined' && document.readyState !== 'loading') landingView();
  else if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', landingView);
})();
