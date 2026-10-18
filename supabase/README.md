# Supabase (Ryagram)

One Supabase project holds the waitlist (Phase 1) and the app (Phase 2A).
Nothing here runs automatically: each file is pasted into the SQL Editor once.

## Apply, in this order

In the project: **SQL Editor → New query**, paste the whole file, **Run**.

1. `ryagram-waitlist.sql` (Phase 1 waitlist)
2. `migrations/20260928000100_2a_core.sql` (projects, versions, jobs, artifacts,
   metering, workers, kill switch, storage bucket `ryagram-artifacts`)
3. `migrations/20260928000200_2a_complete_is_final.sql` (a complete version takes
   no new jobs; replaces `submit_job` only)
4. `migrations/20260928000300_2a_worker_is_not_a_person.sql` (the worker login
   can't create projects, versions or jobs of its own)
5. `migrations/20260928000400_2a_worker_test_fixes.sql` (fixes from WORKER's tests:
   `no_output` code, cancel while validating/uploading, per-attempt `queued_at`,
   partial uploads hidden at once and purged after 24 hours)
6. `migrations/20260929000100_2a_not_found_is_404.sql` (a request for something that
   isn't yours answers 404 instead of 500; nothing else changes)
7. `migrations/20260929000400_2a_ladder_engine_commit.sql` (a final render carries
   the engine commit its preview was drawn with, so the engine can refuse the
   final if the worker was updated in between)
8. `migrations/20260929000500_current_engine_commit.sql` (read-only: tells the app
   which engine version the worker runs, so it can explain a disabled final render)
9. `migrations/20260929000700_preview_needs_window.sql` (a preview without
   `window_s` is refused at submit; the worker would reject it anyway. Independent of
   the AI editor's 0600 file, so it can run with or without it)
10. `migrations/20260929000800_film_pages.sql` (public film pages; nothing is public until an
   owner publishes, and the page needs the film-page function; see "Public film pages")
11. `migrations/20260929000900_account_basics.sql` (the upload data choice and account deletion;
   see "Account basics")
12. `migrations/20261003000100_job_progress_detail.sql` (live render progress; the worker's
   4-argument heartbeat needs it)
13. `migrations/20261003000200_invite_codes.sql` (beta invite codes; see "Beta invites")
14. `migrations/20261003000300_admin_waitlist_by_film.sql` (your "Waitlist by film" counts; see
   "Waitlist by film")
15. `migrations/20261004000100_version_sources.sql`, then `catalog_sources_seed.sql` (the sources screen;
   see "Sources screen")
16. `migrations/20261004000200_uploads_schema.sql`, then `migrations/20261004000300_uploads_worker_and_sweep.sql`
   (upload your own data, phase 1; see "Uploads")

Each file is one transaction: if it fails, nothing is half-applied.

**Not in the 2A set:** `phase-2b/credits_ledger.sql` is the 2B credits ledger. Don't
run it until Phase 2B is approved; it goes after the files above.

## Auth settings (2A-1)

- **Authentication → Sign In / Providers → Email:** enabled. Turn **off**
  "Allow new users to sign up". Only accounts made in the dashboard can sign in.
- **Authentication → URL Configuration → Site URL:** `https://uselai.com` (the bare origin, no `/app/`: the email templates add `/app/#/auth?...` themselves, and a Site URL ending in `/app/` makes every link `/app//app/`)

## Accounts

Ryan: **Authentication → Users → Add user → Create new user**. Enter the email
and a password, tick **Auto Confirm User**.

The render worker is its own user, made the same way. Use an address that exists
only as a login, e.g. `worker-ryan-pc@uselai.com`, and a long random password.
Then in the SQL Editor:

```sql
insert into public.workers (user_id, name)
select id, 'ryan-pc' from auth.users where email = 'worker-ryan-pc@uselai.com';
```

The worker's email and password go only into `D:\RyagramWorker\secrets\worker.env`,
typed by Ryan. Never into chat, a repo, or the website. The worker never gets the
service_role key.

To cut the worker off at once: Table Editor → `workers` → set `enabled` to false.
Changing its password or deleting the user also works.

## Partial-upload cleanup (Edge Function)

`functions/purge-partial-uploads` deletes files left by jobs that failed or were
cancelled mid-upload, 24 hours after the job ended. People never see those files in
the meantime; the database hides them. Deploy it once (CLI:
`supabase functions deploy purge-partial-uploads`, or Dashboard → Edge Functions),
then schedule it hourly: Dashboard → Integrations → Cron → new job → Supabase Edge
Function `purge-partial-uploads`, with the header `Authorization: Bearer <service
role key>`. It refuses any other caller and touches only what the database lists. (On this project that key is the new-style `sb_secret_...` one, see the ops readiness section for the Vault-based cron SQL.)

## AI editor (branch ai-editor): switching it on

Built and tested end to end against a scripted Claude; it has never called the real API.
Every step is yours except where WEB is named, and nothing costs money until step 6.

1. **Anthropic account.** At console.anthropic.com create an API account (separate from your
   Claude subscription), add billing, and set a **monthly spend limit** (e.g. $20 while testing)
   with email alerts. Create one API key named `ryagram-ai-editor`.
2. **Key into Supabase, by you:** Edge Functions → Secrets → `ANTHROPIC_API_KEY`. Never paste it
   in chat, the repo or the website.
3. **SQL Editor**, in order: `migrations/20260929000500_current_engine_commit.sql` (if not run
   yet), then `migrations/20260929000600_ai_editor.sql`. Harmless: the editor stays off.
4. **Deploy:** `npx supabase functions deploy ai-editor --project-ref jxtkfishqfxuptwjzczz --no-verify-jwt`
   (it checks the sign-in itself). If the function logs that it has no public key, also add the
   secret `RYAGRAM_PUBLISHABLE_KEY` = the publishable key.
5. **Merge `ai-editor` to main** (with your OK). The panel stays hidden (`aiEditor: false`).
6. **Switch on:** Table Editor → `control` → `ai_enabled` = true. Then WEB sets `aiEditor: true`
   in `assets/ryagram-config.js` and, with your OK, merges it; WEB checks the live function
   (anonymous call refused, one real turn, usage rows priced, cache reads on the second turn).

Caps, all on the `control` row: `ai_turns_per_day` (100, rolling 24 h), `ai_exec_calls_per_hour`
(30 sheets/previews started by the editor), `ai_tool_calls_per_turn` (12), `ai_project_alert_usd`
(3.00, flags `ai_turns.spend_alert`; not a limit). **Kill switch:** `ai_enabled` = false stops
every request at once. Models: `claude-haiku-4-5` by default (4k output), `claude-sonnet-5` for
new stories, failed checks and explicit escalation (8k output, medium effort). Usage per call is
in `ai_usage` with its cost at the `ai_prices` version.

## Stripe in test mode (branch stripe): what Ryan creates

Built and tested without a Stripe account: Stripe's own fixture objects, a scripted Stripe
API, and the SQL on a local Postgres. Nothing has called Stripe yet. Everything below stays in
**test mode**; no real money moves. A live key is refused by `stripe-checkout`, and live events
are refused by the database, until `stripe_settings.live_ok` is set (a later, separate decision).

1. **Stripe account → test mode** (the "Test mode" / sandbox switch in the Dashboard).
2. **Product catalogue → add five products**, each with one price in USD:

   | Product | Price | Type | Code |
   |---|---|---|---|
   | Ryagram Starter pack | $12 | One-off | `pack_starter` |
   | Ryagram Maker pack | $30 | One-off | `pack_maker` |
   | Ryagram Studio pack | $60 | One-off | `pack_studio` |
   | Ryagram Creator plan | $24 / month | Recurring, monthly | `sub_creator` |
   | Ryagram Pro plan | $69 / month | Recurring, monthly | `sub_pro` |

   Copy each price's id (`price_...`). The amounts must match `credit_prices` exactly: an
   amount that differs gets no credits and is held for review.
3. **Settings → Billing → Customer portal** (test mode): allow *cancel at end of period*,
   *update payment method* and *invoice history*. Turn **off** switching plans and changing
   quantities (plan changes would need a pricing decision first). Save.
4. **Developers → API keys**: create a **restricted key** (`rk_test_...`) with *Write* on
   Customers, Checkout Sessions and Customer portal, and nothing else. Or use the test secret
   key (`sk_test_...`). You paste it into Supabase yourself (step 6), never into chat or the repo.
5. **Developers → Webhooks → Add endpoint**:
   - URL: `https://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/stripe-webhook`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
     `invoice.paid`, `customer.subscription.created`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `charge.refunded`
   - Copy the endpoint's **signing secret** (`whsec_...`).
6. **Supabase → Edge Functions → Secrets**: add `STRIPE_SECRET_KEY` (step 4) and
   `STRIPE_WEBHOOK_SECRET` (step 5).
7. **SQL Editor**, in order: `phase-2b/credits_ledger.sql` (if not run yet), then
   `phase-2b/stripe_test_mode.sql`. Then tell the database which Stripe price sells which code,
   with your ids from step 2:

   ```sql
   insert into public.stripe_prices (price_code, stripe_price_id, mode) values
     ('pack_starter', 'price_...', 'payment'),
     ('pack_maker',   'price_...', 'payment'),
     ('pack_studio',  'price_...', 'payment'),
     ('sub_creator',  'price_...', 'subscription'),
     ('sub_pro',      'price_...', 'subscription');
   ```
8. **Deploy both functions** (the checkout checks the person's sign-in itself; the webhook
   checks Stripe's signature):

   ```
   npx supabase functions deploy stripe-checkout --project-ref jxtkfishqfxuptwjzczz --no-verify-jwt
   npx supabase functions deploy stripe-webhook --project-ref jxtkfishqfxuptwjzczz --no-verify-jwt
   ```
9. **Turn on the page** (a merge to main, with your OK): `credits: true` and `payments: true`
   in `assets/ryagram-config.js`. The Credits page says it's test mode and names Stripe's test
   card, 4242 4242 4242 4242 (any future date, any CVC).
10. **Check**: buy Starter with the test card. Within a minute the balance goes up by 10, and
    `select * from stripe_events order by received_at desc` shows `applied`. Refund it from the
    Stripe Dashboard: the 10 credits are removed (`charge.refunded`).

**Watch:** `select * from stripe_events where outcome = 'needs_review'`. These are payments
that didn't add up (wrong amount, unknown price, partial refund, a refund of a plan invoice).
Nothing changed for them; `detail` says what happened, and you settle each by hand with
`grant_credits` or `adjust_credits`. Stripe's own retries are safe: a repeated event returns
`replay` and changes nothing.

**How it fits:** `stripe-checkout` makes one Stripe customer per person and a Checkout Session
tagged with their user id; the browser only ever goes to `checkout.stripe.com` or
`billing.stripe.com`. Credits are granted only by `stripe-webhook` → `stripe_apply`, through the
ledger's `grant_credits` and `reverse_purchase`: packs on `checkout.session.completed` (paid),
plan months on `invoice.paid` (first month and each renewal, once per billing period, with the
2× rollover cap), and a full pack refund on `charge.refunded`.

## Public film pages (branch film-page): switching them on

"Made with Ryagram · View sources" pages, per the marketing strategy. **Opt-in per film, off by
default**: a finished film gets a *Public page* panel in /app/, and nothing is public until its
owner presses *Publish a public page*. *Stop sharing* turns it off; publishing again brings back
the same link. The page lives at `https://uselai.com/film/?s=<22-character slug>`.

What a page shows: the film, its title and subhead, and for each dataset the source names,
https links, licence notes, method, how derived figures were worked out, known breaks in the
series, the measures drawn, and a short public receipt (period, area, length, drawn date, engine
commit). It is built by the `film-page` function from the film's receipt, by allowlist: the
receipt itself (machine paths, cache fingerprints, reproduce commands) is never served, and a
film made from uploaded data names only "the maker’s own data". Video and poster links are
signed for an hour; the page data is cached for 5 minutes, so *Stop sharing* takes effect within
minutes.

1. **SQL Editor:** `migrations/20260929000800_film_pages.sql` (after 0700; independent of the
   2B and Stripe files).
   **Then** `migrations/20261013000100_film_publish_confirmed.sql`: the database refuses to publish a
   film made from the owner's own upload unless the caller says the owner confirmed (it replaces
   `film_publish` with a 5-argument version). Apply it BEFORE deploying the updated function.
2. **Deploy** (visitors aren't signed in; owners' tokens are checked inside):

   ```
   npx supabase functions deploy film-page --project-ref jxtkfishqfxuptwjzczz --no-verify-jwt
   ```
   No secrets to add.
3. **Merge with `filmPages: true`** in `assets/ryagram-config.js` (with your OK).
4. **Check:** publish a finished film, open its link in a private window, then *Stop sharing* and
   reload after 5 minutes: "No film here".

Not built yet: the "Made with Ryagram" mark on exported films (an engine option for CC1/RENDERER),
link previews with the film's own title and poster (the page is a static file, so shared links
show the generic Ryagram card), and the owner's choice to show uploaded data.

## Account basics (branch account): switching them on

**Password reset** (hidden until step 5):

1. **Authentication → URL Configuration:** Site URL `https://uselai.com`; add
   `https://uselai.com/app/` to Redirect URLs.
2. **Authentication → Emails → Reset password:** replace the link in the template with
   `<a href="{{ .SiteURL }}/app/?reset={{ .TokenHash }}">Choose a new password</a>`. The app checks
   that token itself (`verifyOtp`), so the link works in any browser, and it removes the token from
   the address bar at once. Supabase's default link would put tokens in the `#`, where /app/'s own
   page addresses live.
3. **Authentication → Policies/Providers → Email:** set the minimum password length to 10 (the
   app asks for 10).
4. **Emails to anyone but you need your own email sender:** see "Email sender" below. Supabase's
   built-in sender only delivers to the project's team members, a few per hour. Until then, reset
   links reach only your own address.
5. **Then turn on the button:** `passwordReset: true` in `assets/ryagram-config.js` (a merge, with
   your OK). Until then "Forgot your password?" stays hidden, so no one gets a link that can't work.

People can also change their password on the new **Account** page (the email in the header links
to it), without email.

**The data choice and deleting an account:**

1. **SQL Editor:** `migrations/20260929000900_account_basics.sql`.
2. **Deploy** (no secrets; the person's token is checked inside):

   ```
   npx supabase functions deploy delete-account --project-ref jxtkfishqfxuptwjzczz --no-verify-jwt
   ```
3. **Merge with `accountTools: true`** in `assets/ryagram-config.js` (with your OK).

What they do:
- *Data you upload*: the person's default, *Store my data* unless they change it (spec 2B-6
  wording). Uploads don't exist yet, so today it only records the default. From now on, the
  database makes every version drawn from a *don't keep* dataset non-restorable at once, and a
  dataset that wasn't kept can never be marked kept again.
- *Delete your account*: typed-email confirmation. It is refused while a render is running.
  Without credit history, it deletes the person's stored files (everything under their folder,
  partial uploads included) and then their login, which removes every row they own. With credit
  history, the ledger is an append-only financial record and restricts deletion, so the request
  is recorded in `account_deletion_requests` for you to close by hand (QUESTIONS.md Q6). The
  waitlist table is separate: an address there stays until you remove it.

**Watch:** `select * from account_deletion_requests`.

## Email templates: who is named

The Auth emails (invite, reset password, confirm) are edited in the Supabase dashboard, not in this repo. End each one with the operator and the Ryagram contact, in plain text:

```
Ryagram is operated by L'Ai, LLC. Questions: ryagram@uselai.com
```

**Auth links are spent by a button (2026-10-17):** opening a link (a mail scanner, a preview) spends nothing; `/app/` shows one button and only pressing it runs `verifyOtp`. An expired link shows "That link has expired" with a resend box; the home page and `/ryagram/` forward `#error=...` (or an already-verified `#access_token=...`) to the app (`assets/auth-forward.js`); `passwordReset` is on. Dashboard steps: `Ryagram-logs/proposals/WEB-AUTH-LINKS-FIX-STEPS.md`.

**Auth emails link through our own domain (2026-10-11):** every template's link is `{{ .SiteURL }}/app/#/auth?token_hash={{ .TokenHash }}&type=<type>` (`signup`, `invite`, `magiclink`, `recovery`, `email_change`). The app checks the token itself (`verifyOtp`) and removes it from the address bar; links already sent as `/app/?reset=` or `/app/?invite=` keep working. Five ready-to-paste templates (HTML, matching plain text, subject) are in `supabase/email-templates/`; paste them in Supabase > Authentication > Emails **only after this route is deployed**. Steps: `Ryagram-logs/proposals/WEB-AUTH-EMAIL-TEMPLATES.md`.

(Ryan, 2026-10-07: the operator is L'Ai, LLC, and Ryagram's pages, policy and app give ryagram@uselai.com. The sender address below is a separate setting: it stays the Google Workspace mailbox until a Send-As for ryagram@ is set up.)

## Email sender: Google Workspace (ryan.galen@uselai.com) via Supabase custom SMTP

**SUPERSEDED (Ryan, 2026-10-10): custom SMTP is set up with Resend instead**, sender `noreply@uselai.com`, domain verified (DKIM and SPF). The Google Workspace steps below are kept only as a fallback; do not follow them. The Auth email templates are now editable: ready-to-paste versions are in `supabase/email-templates/` (see "Email templates: who is named").

Password-reset and invite emails need this; nothing else changes. Checked against Google's and
Supabase's docs on 2026-10-03. Gmail's SMTP server takes a Workspace address plus an **app
password** ("less secure apps" ended 1 May 2025). Google's SMTP relay needs fixed sending IPs, which
Supabase doesn't have, so it isn't used here. The app password goes into Supabase only, never into
chat or this repo.

- [ ] **2-Step Verification on** for ryan.galen@uselai.com (myaccount.google.com → Security). If the
      next step says app passwords aren't available, check Admin console → Security →
      Authentication → 2-Step Verification allows it for your account.
- [ ] **Create an app password** at myaccount.google.com/apppasswords, named "Supabase Ryagram".
      Copy the 16 characters. Changing your Google password revokes it, and then emails stop until
      you make a new one and paste it in.
- [ ] **DNS for uselai.com: already in place** (looked up 2026-10-03; DNS at GoDaddy): SPF
      `v=spf1 include:_spf.google.com ~all`, a `google._domainkey` DKIM key, and DMARC `p=quarantine`.
      Only confirm Admin console → Apps → Google Workspace → Gmail → Authenticate email says
      *Authenticating email* for uselai.com; if not, press *Start authentication*. Change no records.
- [ ] **Supabase → Authentication → Emails → SMTP Settings → enable custom SMTP:**
  - Host `smtp.gmail.com`, port `465`
  - Username `ryan.galen@uselai.com`, password: the app password
  - Sender email `ryan.galen@uselai.com` (Gmail sends as the signed-in address; any other From
    would need a "Send mail as" alias first), sender name `Ryagram`
- [ ] **Supabase → Authentication → Rate Limits:** custom SMTP starts at 30 emails an hour. Keep
      it for the beta; Gmail's own cap is 2,000 a day.
- [ ] **Test to an address outside uselai.com:** Authentication → Users → your test user →
      *Send password recovery*. In Gmail's "Show original", check SPF, DKIM and DMARC all say PASS,
      and that it didn't land in spam.
- [ ] **Then** the template edits and switches: password reset ("Account basics" above, steps 2
      and 5) and beta invites (below, steps 2 to 5). Auth emails also show in your Sent folder,
      and replies come to your inbox.

## Beta invites: switching them on

Sign-up stays closed to the public: **Authentication → Providers → Email → "Allow new users to
sign up" stays OFF.** You hand out codes; a person enters a code and their email on the sign-in
page, Supabase emails them an invite, and they choose a password from its link. Codes are stored
only as hashes; a wrong code is throttled (10 an hour from one address, 300 an hour overall), and
the answer never says whether an email already has an account.

1. **Email sender first:** the checklist above. Supabase's built-in sender only reaches the
   project's team members, so invites wouldn't arrive.
2. **Authentication → Emails → Invite user:** replace the link in the template with
   `<a href="{{ .SiteURL }}/app/?invite={{ .TokenHash }}">Join Ryagram</a>` (Site URL
   `https://uselai.com`, as for password reset). The app checks that token itself.
3. **SQL Editor:** `migrations/20261003000200_invite_codes.sql`.
4. **Deploy** (visitors aren't signed in; no secrets):

   ```
   npx supabase functions deploy redeem-invite --project-ref jxtkfishqfxuptwjzczz --no-verify-jwt
   ```
5. **Merge with `inviteSignup: true`** in `assets/ryagram-config.js` (with your OK).
6. **Issue codes** in the SQL Editor; each is shown once, so copy it then:

   ```sql
   select public.invite_issue('Beta wave 1', 10, 14);   -- label, uses, days valid -> RYA-XXXX-XXXX
   select label, uses, max_uses, expires_at, disabled from public.invite_codes order by created_at desc;
   update public.invite_codes set disabled = true where label = 'Beta wave 1';   -- stop a code
   select email, status, created_at from public.invite_redemptions order by created_at desc;  -- who joined
   ```
   A person can type the code with or without `RYA-`, in any case, with spaces.

## Waitlist by film (branch admin-waitlist): admin-only counts

A signed-in page for you only, `#/admin/waitlist` (a "Waitlist by film" link appears on your
projects page): signups per film link (`utm_campaign`), by day in New York time, for the last 30
days, 90 days or year. **Counts only**: the page never receives an email address.

The waitlist itself stays insert-only for everyone. The one new read path is
`waitlist_by_film(days, tz)`, which returns only (day, campaign, utm_source, signups) and only to an
account in `app_admins`; anyone else gets "permission denied". `app_admins` is seeded with the
account whose email is ryan.galen@uselai.com when the SQL runs; nobody can add themselves, and no
role can read or change it over the API.

1. **SQL Editor:** `migrations/20261003000300_admin_waitlist_by_film.sql`. If you haven't signed in
   to /app/ with ryan.galen@uselai.com yet, the seed finds no account and adds nobody; then run
   the `insert into public.app_admins ...` line from the file's header after signing up.
2. Merge (with your OK). No function to deploy and no secrets.

## Dataset catalog (branch catalog): switching it on

"Browse all datasets" under the template picker: every dataset the engine registers that a film can
use, by topic (work and industry, housing, population, health, roads, income, banking, politics),
each with one line about it and its source, and a "Use this data" button that writes a complete story
you can then adjust. **Off by default** (`catalog: false` in `assets/ryagram-config.js`); no SQL, no
function, no secrets.

What is offered is decided by the worker, not by us: a dataset is **Ready** only if it is on the
installed worker's allowlist. The data file `assets/app-catalog-data.js` is GENERATED, never edited:

```
python tools/gen-catalog.py --engine <an engine checkout> --setup C:\Users\Ryan\Ryagram-logs\proposals\WORKER-SETUP.ps1 --commit <engine commit>
```

Run it with the engine's own Python after the engine or the worker's allowlist changes; it records the
engine commit. `tests/app-catalog.test.cjs` fails if the committed lists drift from WORKER-SETUP.ps1,
if a ready dataset has no credit shape row, or if a story can't be built.

Two switches: `catalog` (the browser itself) and `catalogComingSoon` (also list datasets the worker
can't run yet, marked "Coming soon"; default off). Recommended: leave `catalogComingSoon` off, and turn
`catalog` on only when the ready list is broad (see the proposal in the mailbox).

## Sources screen (branch sources): "What this film is made from"

On a version's page, above the example films: one card per source of the film, each with its publisher
(linked), what it covers, and a short licence line that opens the full licence text. The film's story is
the truth: the database keeps the version's sources in step with the datasets the story names (at most 5;
a dataset Ryagram has but can't run yet is refused in plain words), and fills every card's facts from an
internal table, so nothing on a card comes from the browser. Later, ticked suggestions and uploads add
rows to the same table. The screen stays hidden until this SQL is applied.

1. **SQL Editor:** `migrations/20261004000100_version_sources.sql`.
2. **SQL Editor:** `catalog_sources_seed.sql` (generated; idempotent). Rerun it, and regenerate it with
   `tools/gen-catalog.py`, whenever the engine's datasets or the worker's allowlist change.
3. Merge (with your OK). No function to deploy, no secrets, no flag.

## Uploads (branch uploads-phase1): "Your own data", spreadsheets only

Phase 1 reads **.csv, .tsv, .xlsx and .ods** (up to 10 MB; 20 datasets and 100 MB per person; U.S. states or
counties). Phase 2 (PDFs, scans, handwriting) is separate and is not built. The panel on a version page stays
hidden until `uploads: true` in `assets/ryagram-config.js`.

**How a file travels**

1. `create_upload(label, ext, bytes, retention)` checks type, size and quota and opens a slot for exactly one
   file at `<user id>/<dataset id>/source.<ext>` in the **private** bucket `ryagram-uploads`.
2. The browser uploads into that slot (the storage policy allows only the person's own open slot, once).
3. `finish_upload(dataset)` checks the file arrived and queues it in `dataset_ingests`.
4. **The worker** reads it (contract below) and reports what it found. Nothing is usable yet.
5. The person checks what the reader found and confirms what each column means
   (`confirm_dataset_mapping`); only then is the dataset `approved`. County names need a state: a state
   column, or one state chosen by the person. A file with years across the columns is turned away in plain words.
6. `attach_upload_to_version(version, dataset)` makes it the film's data (one uploaded dataset per film) and a
   source card ("Your data"); the story names it `u_<first 24 hex of the dataset id>` and `sync_version_sources`
   accepts that name only for the owner's approved uploads.
7. Deleting (`request_dataset_deletion`) hides it at once and detaches it; the sweeper removes the file.

**Store / Don't keep.** Kept data stays until the person deletes it or the account. Don't-keep files are removed
when the final film is complete, after 7 days without activity, or 1 day after a file couldn't be read.
Deleted rows keep only a tombstone (id, hash, row count); no name, mapping or sample values.

**The worker's contract** (the same text heads `migrations/20261004000300_uploads_worker_and_sweep.sql`)

- `claim_next_ingest()` returns one `(ingest_id, dataset_id, storage_path, ext, bytes)` or nothing. One piece of
  work at a time per worker (a file waits for a render in progress). While it holds the claim, the worker's own
  JWT can download exactly that file from `ryagram-uploads`; no other.
- `report_ingest(ingest_id, report)` once per file. `report` is a closed shape: `format`, `sha256`, `rows`
  (<= 1,000,000), `columns` (1 to 60: `index`, `header` <= 80, `kind` place|period|number|text, up to 5 `sample`
  values <= 40 characters), `guess` (`place_index`, `period_index`, `value_indexes`, `geography`, `cadence`,
  `wide`), `periods` (`first`, `last`, `count`), `unmatched` (`count`, up to 20 `names`), `state_column_index`,
  `sheet`, `sheets`. Anything else is refused. Samples are the person's values, shown only to them.
- `fail_ingest(ingest_id, code, detail)`: code is one of `too_large`, `unreadable`, `not_a_table`,
  `too_many_rows`, `too_many_columns`, `unsupported`, `timeout`, `unknown`; `detail` is one plain sentence for the
  person (<= 300 characters) and never contains values from the file.
- Read values only: no formulas evaluated, no macros, no external links; caps on unzipped size, sheets, rows,
  columns and time. A file that breaks a cap is failed, never partly reported.
- A lost worker's claim lapses after 15 minutes and is retried up to 3 times.
- **Not built yet (worker/engine):** rendering a story that names `u_...` data. The worker's story validator and
  dataset allowlist know only catalog names; the engine's `ingested` plug-in needs the confirmed mapping (the
  `mapping` and `ingest_report` columns). Until that exists a film built on an upload fails at the worker, which is why
  the flag stays off.

**Switching it on**

1. **SQL Editor:** the two migrations above, in order.
2. Deploy `purge-uploads` (`supabase functions deploy purge-uploads --no-verify-jwt`) and schedule it hourly
   exactly like `purge-partial-uploads` (service role key as the bearer). Redeploy `delete-account` so an account
   deletion removes uploaded files too.
3. WORKER builds the reader and the render path above.
4. Merge, then set `uploads: true`.

## Kill switch

Table Editor → `control` (one row):

- `claims_enabled`: false = the worker takes no new jobs
- `disabled_job_types`: e.g. `{final_render}` pauses those jobs everywhere
- `ai_enabled`: for the AI editor, later

No website redeploy needed.

## Grants

The project has "Automatically expose new tables" **off**, so no role gets
anything by default, `service_role` included. Every grant the app needs is in
the SQL files, schema USAGE too. Anything new (a table, a function, an Edge
Function using `service_role`) must grant its own access explicitly.

## What the website may hold

Only the Project URL and the publishable key (`assets/ryagram-config.js`). The
database decides everything else. Never put the secret/service_role key, the
worker password, an Anthropic key, a Stripe key or signing secret, or the email app password in this repo; the repo is public.

## Acceptance test (2A-1), once the project is live

Make a second test person (Authentication → Users → Add user, Auto Confirm) in
addition to your own account and the worker's. Before the render worker is
started, from the repo root:

```
node supabase/acceptance/2a1-acceptance.mjs
```

It asks for the Project URL, the publishable key and the three logins (passwords
typed hidden; or set the environment variables named at the top of the file).
It checks that you can sign in, that anonymous visitors get nothing, that the
second person sees none of your rows or files, and that the worker login can use
only its own functions, by running one tiny job the way the worker would.
`--dry-run` lists the checks without sending anything. It leaves one archived
project named `acceptance-<time>` and one 16-byte file.

## Tests

Uploads: `tests/test_uploads.py` (Postgres), `tests/purge-uploads.test.mjs`, `tests/delete-account.test.mjs`,
`tests/app-uploads*.test.cjs`.

The schema is tested against a local Postgres with Supabase stand-ins
(`tests/supabase_stub.sql`, which models this project's no-default-grants
setting); see `tests/test_2a_core.py` for setup. The tests cover the waitlist's
insert-only access, privacy between users, anonymous access, r1/r2 independence, parameter
allow-lists, the contact sheet → preview → final ladder, worker confinement,
upload size/type checks, sequential exactly-once claiming, lost-worker retry,
retry_job vs final failures, metering for handed-back attempts, finished
versions staying locked, the kill switch and cancel.

## Visit counting (uselai.com/ryagram/)

A cookieless count of visits to the Ryagram page, nothing displayed on the page. Two parts, both off until switched on:

1. **Cloudflare Web Analytics** (the independent total; filters bots). uselai.com is served by GitHub Pages (DNS points at GitHub, not at Cloudflare), so there is no Cloudflare Pages project to toggle: use the JS snippet. In the Cloudflare dashboard: *Analytics & Logs* -> *Web Analytics* -> *Add a site* -> hostname `uselai.com` -> choose the manual JavaScript snippet (not "automatic setup", which needs the site proxied through Cloudflare) -> copy the 32-character `token` from the snippet -> put it in `assets/analytics-config.js` as `cloudflareBeaconToken`. The token is public (it ships in the page), not a secret. Only `/ryagram/` loads the beacon; its Content-Security-Policy already allows `static.cloudflareinsights.com` and `cloudflareinsights.com`.
2. **A tally by link source** (`?ref=youtube`, or failing that `?utm_source=`), because Cloudflare does not break visits out by query parameter. SQL `migrations/20261006000100_visit_counting.sql` (after 20261003000300): table `ryagram_visits` (day, path, source, count: no visitor id, cookie, address or agent), `record_visit` (anyone may add 1), `visits_by_day` and `visits_by_source` (admin only). Apply it, then set `visitCounting: true` in `assets/ryagram-config.js`. Ryan's view is `/app/#/admin/visits` (visits, signups and signup rate, by day and by source). A signup keeps its `ref` in the existing `source` column.

Counted: one per page load; skipped for Do Not Track, Global Privacy Control, automated browsers and obvious crawlers. The privacy policy has one sentence on it.

## Hands-off operations (branch ops-readiness): switching it on

Design and audit: `Ryagram-logs/proposals/WEB-OPS-READINESS.md`. Nothing below is applied or deployed until Claude has reviewed the SQL.

1. Apply `migrations/20261010000100_ops_readiness.sql` (after the AI editor, film pages and app_admins migrations). It also replaces `ai_reserve_turn` with the capped version and adds `control.ai_daily_usd_cap` ($5), `ai_monthly_usd_cap` ($60) and `ai_project_cap_usd` ($5): tune them in the Table Editor on the `control` row.
2. Redeploy `ai-editor` (it now asks `ai_budget_ok` before every Anthropic call). Deploy `ops-tick` and `ops-digest` the same way as `purge-uploads` (`--no-verify-jwt`).
3. Schedule by SQL with `pg_cron` + `pg_net`: `ops-tick` every MINUTE (a child-safety report's first email goes out within a minute), `ops-digest` daily at 13:00 UTC. **Key:** the functions' `SUPABASE_SERVICE_ROLE_KEY` is the new-style `sb_secret_...` key, not the legacy `eyJ...` JWT (that one gets 403 from `isService()`). Save the `sb_secret_...` key in Vault as `service_role_key` and read it in the job:
   ```sql
   select cron.schedule('ops-tick', '* * * * *', $$ select net.http_post(
     url := 'https://<project-ref>.supabase.co/functions/v1/ops-tick',
     headers := jsonb_build_object('Content-Type', 'application/json',
       'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
     body := '{}'::jsonb) $$);
   -- ops-digest: the same with '0 13 * * *' and /functions/v1/ops-digest
   ```
   Verify: `select status_code, content, created from net._http_response order by created desc limit 5;` shows 200 (403 = wrong key type or missing Vault secret).
4. Mail is DRY-RUN by default: every alert and digest is written to the `ops_outbox` table (Table Editor) and nothing is sent. **Secrets already set (Ryan, 2026-10-10): `RESEND_API_KEY` and `OPS_MAIL_FROM`; the Resend domain is verified (DKIM and SPF).** `OPS_MAIL_MODE` is still unset, so it stays in dry-run. **Going live = set the secret `OPS_MAIL_MODE=resend`, but only after CC1 has approved ops-readiness, the SQL is applied and the `ops-tick` and `ops-digest` functions are deployed and scheduled.** Anything missing keeps it in dry-run. (Supabase's own Auth emails use the same Resend account through custom SMTP, set separately in Authentication > Emails.)
5. WORKER adds one `worker_ping(free_gb)` call per minute. Until then rendering status is `unknown` and no worker alert is raised.
6. Merge `.github/workflows/ops-ping.yml` only after step 1.
7. **Launch checklist (Ryan, 2026-10-10): raise the site-wide AI caps before public launch; consider per-user caps tied to credits.** The defaults ($5 a day, $60 a month, $5 a project) suit one user. A call whose model has no row in `ai_prices` is counted at the most expensive known price and raises one alert `ai_price_missing:<model>`: add the price row to clear it.
8. **Backups:** after the daily backup is installed (proposals/WEB-BACKUP-DESIGN.md), set `ops_settings.backups_expected = true` in the Table Editor; from then on a good dump older than 2 days raises one alert.
9. **Before go-live, look at one real `ai_usage` row** after the first editor turn: `model` must be the alias in `ai_prices` (`claude-haiku-4-5` / `claude-sonnet-5`), `cost_usd` not null. The editor records usage under the REQUESTED model, so a dated name from the API cannot make a call unpriced; if `ai_price_missing` ever alerts, add the price row.
10. **HARD GATE before the report form is switched on (`opsTools`): verify the report limits see the real caller.** `report_film_page` keys its limits on the `cf-connecting-ip` header (set by Cloudflare, which a client cannot forge), else the LAST hop of `x-forwarded-for`, else the typed email. If `cf-connecting-ip` does not reach PostgREST, the last forwarded hop is probably a SHARED proxy or edge address: then one person's 5 reports an hour blocks everyone, child safety included, and the check must FAIL. Test from a phone and a laptop: send two harmless reports (reason: other) to a test page from each and read `abuse_reports.reporter_key`: it must differ between the two devices and be the same for two reports from one device. If every key is the same, or every report has a new key, do NOT switch the form on; tell Claude (the limits then fall back to the typed email, which does not stop a flood).
11. **Child-safety reports (Ryan, 2026-10-12).** A report with the reason `child_safety` is ALWAYS recorded (no limit can refuse it) and raises an URGENT alert that is emailed at once, bypassing the daily alert-mail allowance. The page is hidden pending your review, but at most `ops_settings.child_safety_holds_per_hour` (default 10) pages an hour site-wide; above that the report is still recorded and the alert says the page is NOT hidden, and `#/admin/ops` lists it first. Because the alert goes out on the next `ops-tick`, schedule `ops-tick` **every minute** (Dashboard > Integrations > Cron; it is a cheap SQL pass that only sends mail when something is new) so the worst-case delay is about a minute. **Launch checklist: a lawyer confirms the CSAM reporting duties (NCMEC) and the review process before public launch.** **Ryan's answers (2026-10-14):** (a) the FIRST urgent email goes out at once; after that ONE grouped email at most every 15 minutes (`ops_settings.urgent_mail_every_min`) covers everything since, and nothing is dropped: urgent mail is its own outbox kind (`urgent`), so it never counts against, and is never held by, the 20-a-day allowance for ordinary alerts. One mail lists up to 100 reports; every report is on `#/admin/ops`. (b) A reporter's first 5 reports in an hour (`report_detail_per_reporter_hour`) keep their full details; after that each report is still recorded as a SHORT record (time, reporter, page, reason; no free text, `details_omitted`), and `#/admin/ops` says so. Child-safety reports are never refused for it; other reasons keep their per-reporter limit. Hides by child-safety reports do not use up the ordinary per-reporter or hourly hide allowances, and report handling takes a lock so concurrent reports cannot race past the caps.

## Creator beta (branch creator-beta): switching it on

YouTubers, podcasters, newsletter writers, journalists, teachers and researchers apply on `/ryagram/#creators` (name, email, who they are,
what they make, a link, and the question they would answer with data). Ryan approves or declines each one on `#/admin/ops`
("Creator beta applications"). The page says plainly that beta credits are free in exchange for feedback and that any promotion is disclosed.

- **Stored:** `public.creator_applications`, tagged `source = 'creator_beta'`. RLS is on and every grant is revoked, the service role
  included, so nobody can read or change a row directly. The ONLY writer is `creator_beta_apply`, callable by the service role only (the
  `creator-beta` function). Ryan's two functions (`admin_creator_beta`, `admin_decide_creator`) are gated by `is_app_admin()`.
- **Approving sends nothing and grants no credits.** It marks the row and clears its alert. Ryan replies from his inbox and grants the free
  credits by hand (the invite code or `grant_credits`), so nothing can cost money by itself.
- **Limits:** one application per email; **3 an hour per caller** and 40 an hour site-wide (each a friendly "try again later"); a hidden
  honeypot field. The per-caller limit is checked first, so one spammer is refused long before the site-wide cap is near and cannot lock real
  applicants out. The function hashes the caller's address with the New York day (sha-256) and passes only the hash; the address is never stored
  and the key changes daily. Only stored applications count. A request with no address gets no per-caller limit (never one shared bucket).
  People behind one shared address (a school or newsroom) share its 3 an hour.
- **Verify once on the live project** (like the report form's go-live step): which header carries the real caller address. The function reads
  `cf-connecting-ip` (set by Cloudflare, overwrites anything the client sent), else the LAST hop of `x-forwarded-for`, never the first.
  After deploying, apply from two different networks and check `select count(distinct caller_key) from creator_applications` is 2, not 1.
  If it is 1 (every caller looks the same) the per-caller limit would block everybody after 3: do not switch the form on until fixed.
- **Alerts:** each new application raises one `creator:<id>` alert (in the daily digest and "Needs you"), cleared when Ryan decides it.

To switch it on (in this order):

1. **SQL Editor:** `migrations/20261014000100_creator_beta.sql`, after `20261010000100_ops_readiness.sql` (it uses that file's alert ledger
   and `is_app_admin`).
2. **Deploy** (visitors are not signed in):

   ```
   npx supabase functions deploy creator-beta --project-ref jxtkfishqfxuptwjzczz --no-verify-jwt
   ```
   **Address hashes use a secret (2026-10-17).** The per-caller key is an HMAC-SHA256 of the address and the day, keyed with the Edge secret `CALLER_HASH_SECRET`
   (any long random string; if it is not set the function uses the project's own service key, so there is never an unsalted hash; an address with no secret at all
   is refused). The abuse reporter key is made the same way in SQL from a random secret in the closed table `ryagram_private.hash_secret`
   (`migrations/20261017000100_hash_secrets.sql`, after `20261010000100_ops_readiness.sql`). Rotating either secret only resets that day's limits.
3. Set `creatorBeta: true` in `assets/ryagram-config.js` and push. Until then the form tells people to email ryagram@uselai.com and sends nothing.

## Creator beta flow (branch creator-flow): invite, sign up, credits, request a film

The whole path for a creator on Stripe TEST mode, with Ryan fulfilling each film by hand from his PC until the job runner has a status file:

1. A creator applies on `/ryagram/#creators` (see "Creator beta").
2. Ryan opens `#/admin/ops` > Creator beta applications and clicks **Approve and make an invite code**. The database makes a single-use code (valid 30 days, stored only as a hash) that carries welcome credits (default 20; change with `select admin_creator_flow_set(<film request credits>, <welcome credits>);`). The code is shown **once**, with an **Email it** link (a `mailto:`: Ryan reads and sends it himself; nothing is sent for him).
3. The creator enters the code and their email under "Have an invite code?" (needs `inviteSignup: true`, custom SMTP and `redeem-invite`, see "Beta invites"), gets Supabase's invite email, sets a password. When the invite email goes out, `invite_sent` grants the welcome credits ONCE (ledger entry `grant`, `created_by = invite:<redemption>`).
4. In the app they open **Request a film** (needs `filmRequests: true`): a question and optional notes. A request costs `film_request_credits` (default 10), taken at once in the ledger's spending order; at most 3 open at a time. It appears in Ryan's queue (`Film requests`) and raises one alert (`film_request:<id>`).
5. Ryan makes the film on his PC, uploads it anywhere with an https link (YouTube unlisted is fine), and clicks **Mark delivered** with that link; the creator sees **Watch your film**. **Decline** returns exactly the credits that request took, from the pools they came from, once. A delivered request keeps its credits spent.

The seam for BUILDER's job runner: `admin_film_request_set(id, status, note, url)` is the ONE place a request changes state. When a runner status file exists, a service-side caller can move requests through it; the screens and the credit rules do not change. (Today it is `is_app_admin()`-gated; a service-role variant is a small addition when the file's format is known: it does not exist yet.)

To switch it on (after the ledger is live and the creator beta is on): apply `migrations/20261016000200_creator_flow.sql` (after `20261003000200_invite_codes.sql`, `20261010000100_ops_readiness.sql`, `20261014000100_creator_beta.sql` and `phase-2b/credits_ledger.sql`), then set `filmRequests: true` and push. The two numbers are **confirmed by Ryan (2026-10-16): 10 credits per film request and 20 welcome credits** (the defaults in `creator_flow_settings`; `admin_creator_flow_set` can still change them later). **The dollar value of a credit is deliberately unset until costmeter has measured real render costs: no screen, table or message in this flow shows or computes a price per credit.**


**Invite someone (2026-10-17, `migrations/20261017000200_invite_someone.sql`, after `20261016000300_retention_purge.sql`).** `#/admin/ops` > Creator beta applications > **Invite someone**: Ryan types a friend's name (and, if he wants, welcome credits; blank = the usual 20) and their email. The database gets only the name and the credits (`admin_invite_person(name, credits)`, admin only): it makes a single-use code valid 30 days, labelled `invite: <name>`, that grants the welcome credits when the person signs up (`invite_sent`, once). The code is shown ONCE with an **Email it** link (a `mailto:` built in the browser from the address Ryan typed: the address is never sent to the database until the person redeems). Retention: `retention_purge()` (replaced in this migration) deletes such a code, and with it the redemption that holds the email, 12 months after it was last used, or 12 months after it expired if nobody used it. The Privacy draft says so.

## Cost ledger (branch cost-ledger): switching it on

Every $-bearing event in one closed table (`cost_events`), a daily rollup and Ryan's limits on `#/admin/ops` > Costs. Full design, the Stripe test-mode plumbing plan and each vendor's spend-cap steps: `Ryagram-logs\proposals\WEB-COST-LEDGER-AND-TEST-PLAN.md`.

- **Unknown is unknown:** `amount_usd` NULL is never added as $0; totals name how many events have an unknown cost. Each event has a `mode`: `live`, `test` (Stripe test mode) or `unknown` (the source gave no live/test flag: never defaulted to live). Only `live` counts as money or toward an alarm; the others are shown apart.
- **Closed tables:** RLS on, every grant revoked (service role included). Writers are `cost_record_events`, `cost_ingest_render_meter`, `cost_tick`, `cost_sync_get/set` (service role only) and Ryan's `admin_cost_*` functions (`is_app_admin()`).
- **Sources:** Stripe's own balance transactions (the real fee per charge, read-only, `cost-sync` function), plan fees Ryan states (accrued daily), render cost from `job_metering` cpu seconds (unknown until he states a core-hour rate), a daily stored-bytes and live-email reading, typed costs, and (once BUILDER publishes the format) `renders.jsonl` lines. Sign-up emails and uploaded datasets are NOT counted (UNKNOWN).

To switch it on (in this order):

1. **SQL Editor:** `migrations/20261016000100_cost_ledger.sql`, after `20261010000100_ops_readiness.sql` and the 2A core.
2. **Stripe key, its OWN secret:** create a NEW **restricted** key (`rk_test_...`, later `rk_live_...`) with **Balance: Read and nothing else** (add "Balance transaction sources: Read" only if the first call is refused), and store it as the secret **`STRIPE_READ_KEY`**. Do NOT reuse `STRIPE_SECRET_KEY`: Supabase secrets are project-wide, so that would hand `cost-sync` the checkout key. `cost-sync` refuses a full `sk_...` key and takes the mode from the `rk_` prefix. A cost event that arrives with no live/test flag is stored as mode `unknown`: shown apart, never counted as money, never alarmed.
3. **Deploy:** `npx supabase functions deploy cost-sync --project-ref jxtkfishqfxuptwjzczz --no-verify-jwt`
4. **Schedule:** every **hour** (`0 * * * *`) with `cron.schedule` + `net.http_post` to `/functions/v1/cost-sync`, the same Vault-based `sb_secret_...` pattern as `ops-tick` (step 3 of the ops readiness section). Alarms are evaluated on that run, so they can be up to an hour late.
5. **Seeded by the migration (Ryan, 2026-10-16), editable on `#/admin/ops` > Costs:** limits of **$5 a day and $50 a month across every vendor, warning at 80%, alerts only** (nothing here can block or stop anything), and a **render core-hour rate of $0** (renders on his own PC cost $0 in cash; the cloud rate comes from BUILDER's trial). Still to enter: your plans (Supabase, Resend, Workspace; the Supabase plan is being checked) and costs nothing can see (a domain renewal).

Tests: `tests/cost-ledger.test.mjs` (the function, wording, forms, screen wiring) and `supabase/tests/test_cost_ledger.py` (closed tables, idempotence, rollup, plans, render and storage readings, alarms). Run the SQL tests with `TEMP`, `TMP` and `TMPDIR` on D: (the storage rule).

## Retention purge (branch retention-purge): the Privacy Policy's retention promises

`retention_purge()` deletes what the policy says is deleted, once per New York day, called by the **ops-tick** function every minute (no new schedule, no new function): creator beta applications **12 months after the decision** (with the invite code made for them, which holds their name, and its redemption, which holds their email); help requests **3 years after they were answered**; reports **3 years after they were reviewed**, **except child-safety reports, which are never deleted by this job** (they are kept as legal preservation requirements say: counsel to confirm, then change the rule in the function if it needs a period). Undecided applications, unreviewed reports and unanswered requests are never touched: they still need Ryan.

1. **SQL Editor:** `migrations/20261016000300_retention_purge.sql` (after the ops, creator beta and invite code migrations).
2. **Redeploy `ops-tick`** (it now calls the purge): `npx supabase functions deploy ops-tick --project-ref jxtkfishqfxuptwjzczz --no-verify-jwt`.
3. Check: `select * from retention_runs;` shows today's date after the next minute tick.

## Funnel tracking (branch funnel-events): first-party, no cookies, no pixels

`migrations/20261017000900_funnel_events.sql` (apply after `20261017000200_invite_someone.sql`; it replaces `retention_purge()` once more) and `assets/funnel.js`, behind `funnelTracking: false` in `assets/ryagram-config.js`. Spec: Ryan, 2026-10-17.

- **Tables:** `funnel_events` (event, time, the account if any, utm_source/medium/campaign, referrer domain) and `funnel_accounts` (the source attached to an account). RLS on, an `is_app_admin()` read policy and nothing else: no one can insert, update or delete through the API; the service role has no grant either.
- **Render steps (Ryan 2026-10-18):** `render_ordered` (a trigger on `render_orders`: a full render was REQUESTED, i.e. an order row exists; it may still be declined, expire or fail, so this counts requests, not renders that ran) is the funnel's FIRST ORDER; `render_approved` (a trigger on `render_stages`: Ryan's decision stamp on a final render that was not declined). Both once per account. The triggers are installed by `funnel_install_triggers()` only where the PIPE-1 tables exist, so apply this file after `20261017000600`.
- **Events:** `landing_view` and `signup_started` are anonymous (`funnel_anon()`, callable with the public key, only those two names, stops at 5,000 an hour). `signup_done` (first confirmed email, a trigger on `auth.users`), `first_project`, `contact_sheet`, `preview`, `film_requested`, `film_delivered`, `purchase` (a `purchase` credit-ledger row), `subscription_start` / `subscription_cancel` are written by TRIGGERS on the real tables, so the page cannot invent or skip a step. `return_7d` / `return_30d`: `funnel_return_visit()` when a signed-in person opens the app 7 / 30 or more days after confirming their email. Each account counts once per step except purchases and plan starts/cancels.
- **Triggers on tables made by hand** (the credits ledger and Stripe, `supabase/phase-2b/*.sql`) are installed by `ryagram_private.funnel_install_triggers()`, which the migration runs once; **run it again after applying a phase-2b file later**.
- **Source:** `assets/funnel.js` keeps ONE small record in this browser's local storage (not a cookie) when a visit comes from a utm link or another site (a direct visit stores nothing); the first touch wins. At first sign-in it calls `funnel_attach_source()` once (the database keeps the first answer; earlier steps such as `signup_done` take it) and deletes the record. Nothing else personal is sent or stored. Skipped entirely for Do Not Track, Global Privacy Control, automated browsers and crawlers. **A person who signs in from a different browser than the one that saw the link has no source (counted as direct).**
- **Ryan's view:** `#/admin/ops` > Funnel: people per step, conversion from the step before and from the first step, by source, by week (4 / 8 / 12 / 26 weeks). Visits are counted each time; every other step counts accounts.
- **Retention:** `retention_purge()` deletes raw events 13 months after they happened (the source row stays while the account does); deleting an account removes its source row and unlinks its events. The Privacy draft says so (`funnel-tracking`).
- **Switching it on:** apply the SQL, publish the Privacy line (`legal-approve.py ... --requires-ok ...,funnel-tracking`), then set `funnelTracking: true`. Ads later add their own pixels only after the lawyer.
- Tests: `supabase/tests/test_funnel.py` (13), `tests/funnel.test.mjs` (12), real Chrome `tools/check-funnel.py`.
