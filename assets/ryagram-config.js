// Supabase project that stores Ryagram waitlist signups (see supabase/ryagram-waitlist.sql).
// supabaseUrl: the Project URL, e.g. https://abcdefghijklmnop.supabase.co
// supabaseKey: the publishable key (sb_publishable_...) or the legacy anon key.
// Both are meant to be public; the database only lets this key add rows.
// Never put a secret or service_role key here.
// Empty means not connected: the form sends nothing and points people to email.
window.ryagramConfig = Object.freeze({
  // Count visits to /ryagram/ (a cookieless tally by day and link source, for Ryan's private view at #/admin/visits).
  // Turn on only once SQL 20261006000100 is applied (supabase/README.md, "Visit counting").
  visitCounting: true,
  supabaseUrl: 'https://jxtkfishqfxuptwjzczz.supabase.co',
  supabaseKey: 'sb_publishable_6bjao-hnRZ0t2WAMwcJD9g_3zJ7paR0',
  // Show the AI editor panel in /app/. Turn on only after the ai-editor function is deployed
  // and control.ai_enabled is true (supabase/README.md, "AI editor").
  aiEditor: false,
  // Show credits (balance, prices, holds) in /app/. Turn on only once the 2B ledger is applied.
  // STRIPE TEST WINDOW (Ryan, 2026-10-16): ON only while Ryan runs the Stripe TEST-mode plumbing test, then reverted (branch stripe-test-window-revert).
  credits: true,
  // Show the Credits page (packs and plans through Stripe Checkout). Turn on only once the
  // stripe-checkout and stripe-webhook functions are deployed (supabase/README.md, "Stripe").
  // STRIPE TEST WINDOW: see credits above. stripeTestMode below must stay true; tests/stripe-test-window.test.cjs enforces it.
  payments: true,
  // While Stripe runs with test keys, the Credits page says so and names the test card.
  stripeTestMode: true,
  // Show "Public page" on finished films in /app/. Turn on only once the film-page function is
  // deployed and its SQL applied (supabase/README.md, "Public film pages").
  filmPages: false,
  // Show the data choice and "Delete your account" on the account page. Turn on only once SQL
  // 0900 is applied and delete-account is deployed (supabase/README.md, "Account basics").
  // Changing a password works without it.
  accountTools: true,
  // Show "Forgot your password?" on sign-in. Turn on only after the reset-password email template
  // points at /app/?reset={{ .TokenHash }} and custom SMTP is set (supabase/README.md, "Account basics").
  passwordReset: true,
  // Offer the "Industry" template (CBP sector-share bar races, 1998-2023). Turn on only once the
  // worker's dataset allowlist includes the cbp_*_share_state datasets (WORKER-SETUP.ps1).
  industryTemplate: false,
  // Show "Have an invite code?" on sign-in. Turn on only once custom SMTP is set, the invite email
  // template points at /app/?invite={{ .TokenHash }}, and redeem-invite is deployed
  // (supabase/README.md, "Beta invites").
  inviteSignup: true,
  // Show "Your own data" (spreadsheet upload) on a version in /app/. Turn on only once SQL 20261004000200 and
  // 20261004000300 are applied, purge-uploads is deployed and scheduled, and the worker reads uploads
  // (supabase/README.md, "Uploads").
  uploads: false,
  // The guide for people bringing their own spreadsheet (BYOD audit 2026-10-18): a starter film made from the upload when the story is blank, a pointer to it from the top of the
  // version page, an example of a good file, and plain words for a file with its years across the columns. Needs uploads: true. Off until Ryan has seen it.
  byodGuide: false,
  // Show the "rendering is delayed" notice and the help form (#/help) in /app/. Turn on only once SQL 20261010000100 is applied
  // (supabase/README.md, "Hands-off operations").
  opsTools: true,
  // Send creator beta applications (the form on /ryagram/#creators). Turn on only once SQL 20261014000100 is applied and the creator-beta
  // function is deployed (supabase/README.md, "Creator beta"); until then the form tells people to email.
  creatorBeta: false,
  // Show "Request a film" in /app/ (the creator beta: people ask, Ryan makes each film by hand). Turn on only once SQL 20261016000200 is applied and
  // the credits ledger is live (supabase/README.md, "Creator beta flow").
  filmRequests: true,
  // First-party funnel tracking (our own database, no cookies, no third-party pixels): the source of a visit, kept once in the browser until sign-up. Turn on only once
  // SQL 20261017000900 is applied and the Privacy Policy line for it is published (supabase/README.md, "Funnel tracking").
  funnelTracking: false,
  // Send full renders through request_final_render (the approval queue). Turn on only once SQL 20261017000500 and 20261017000600 (PIPE-1) are applied; until then the old direct path is used.
  renderOrders: true,
  // Connecting an AI (Claude, ChatGPT): the consent page (#/connect/consent) and Account > Connected AIs. Turn on only once CONNECT's SQL (20261018000100_connect_ai.sql) is applied and the
  // connect function is deployed (supabase/README.md, "Connecting an AI").
  connectAi: false,
  // PERMANENTLY OFF (Ryan, 2026-10-04): there is no dataset picker or browse list for users, ever. The
  // catalog (assets/app-catalog-data.js) is the internal list Ryagram's AI chooses from, server side;
  // nothing in the app reads these two flags. tests/app-catalog.test.cjs fails if either turns true.
  catalog: false,
  catalogComingSoon: false
});
