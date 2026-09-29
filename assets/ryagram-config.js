// Supabase project that stores Ryagram waitlist signups (see supabase/ryagram-waitlist.sql).
// supabaseUrl: the Project URL, e.g. https://abcdefghijklmnop.supabase.co
// supabaseKey: the publishable key (sb_publishable_...) or the legacy anon key.
// Both are meant to be public; the database only lets this key add rows.
// Never put a secret or service_role key here.
// Empty means not connected: the form sends nothing and points people to email.
window.ryagramConfig = Object.freeze({
  supabaseUrl: 'https://jxtkfishqfxuptwjzczz.supabase.co',
  supabaseKey: 'sb_publishable_6bjao-hnRZ0t2WAMwcJD9g_3zJ7paR0',
  // Cloudflare Turnstile site key (public). Empty = the waitlist inserts directly, without the check.
  turnstileSiteKey: ''
});
