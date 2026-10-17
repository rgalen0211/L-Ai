// A person who clicks an auth email link that Supabase itself handled (the default template, or a link that expired) lands on the SITE ROOT with the result in
// the address fragment: #error=access_denied&error_code=otp_expired&..., or #access_token=...&refresh_token=...&type=recovery. The root is the L'Ai home
// page, which cannot do anything with it, so send the person to the app, which can: an error goes to the friendly "link expired, send a new one" screen,
// a session goes to the app, which asks 'Continue as <email>' before taking it (nothing signs in from the address bar). Only the fragment (never sent to a server) is looked at. Loaded by the home page and /ryagram/.
(() => {
  const raw = (location.hash || '').replace(/^#\/?/, '');
  if (!raw || /^\/?auth\//.test(raw) || location.pathname.startsWith('/app/')) return;
  const p = new URLSearchParams(raw);
  if (p.has('error') || p.has('error_code')) {
    location.replace('/app/#/auth/expired');
  } else if (p.has('access_token') && p.has('refresh_token')) {
    location.replace('/app/#' + raw);
  }
})();
