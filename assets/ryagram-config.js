// Supabase project that stores Ryagram waitlist signups (see supabase/ryagram-waitlist.sql).
// supabaseUrl: the Project URL, e.g. https://abcdefghijklmnop.supabase.co
// supabaseKey: the publishable key (sb_publishable_...) or the legacy anon key.
// Both are meant to be public; the database only lets this key add rows.
// Never put a secret or service_role key here.
// Empty means not connected: the form sends nothing and points people to email.
window.ryagramConfig = Object.freeze({
  supabaseUrl: 'https://jxtkfishqfxuptwjzczz.supabase.co',
  supabaseKey: 'sb_publishable_6bjao-hnRZ0t2WAMwcJD9g_3zJ7paR0',
  // Show the AI editor panel in /app/. Turn on only after the ai-editor function is deployed
  // and control.ai_enabled is true (supabase/README.md, "AI editor").
  aiEditor: false,
  // Show credits (balance, prices, holds) in /app/. Turn on only once the 2B ledger is applied.
  credits: false,
  // Show the Credits page (packs and plans through Stripe Checkout). Turn on only once the
  // stripe-checkout and stripe-webhook functions are deployed (supabase/README.md, "Stripe").
  payments: false,
  // While Stripe runs with test keys, the Credits page says so and names the test card.
  stripeTestMode: true,
  // Show "Public page" on finished films in /app/. Turn on only once the film-page function is
  // deployed and its SQL applied (supabase/README.md, "Public film pages").
  filmPages: false,
  // Show the data choice and "Delete your account" on the account page. Turn on only once SQL
  // 0900 is applied and delete-account is deployed (supabase/README.md, "Account basics").
  // Changing a password works without it.
  accountTools: false,
  // Show "Forgot your password?" on sign-in. Turn on only after the reset-password email template
  // points at /app/?reset={{ .TokenHash }} and custom SMTP is set (supabase/README.md, "Account basics").
  passwordReset: false,
  // Offer the "Industry" template (CBP sector-share bar races, 1998-2023). Turn on only once the
  // worker's dataset allowlist includes the cbp_*_share_state datasets (WORKER-SETUP.ps1).
  industryTemplate: false,
  // Show "Have an invite code?" on sign-in. Turn on only once custom SMTP is set, the invite email
  // template points at /app/?invite={{ .TokenHash }}, and redeem-invite is deployed
  // (supabase/README.md, "Beta invites").
  inviteSignup: false,
  // Show "Browse all datasets" under the template picker: the engine's catalog by topic, with what
  // the worker can run today marked ready. Off until Ryan has seen it (supabase README, "Catalog").
  catalog: false,
  // With the catalog on, also list the datasets the worker can't run yet, marked "Coming soon".
  // Off by default: the catalog lists what can run, and nothing it can't.
  catalogComingSoon: false
});
