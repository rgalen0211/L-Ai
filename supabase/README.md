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
17. `migrations/20261004000500_worker_job_upload.sql` (the worker learns which confirmed upload a render job reads;
   see "Uploads")

Each file is one transaction: if it fails, nothing is half-applied.

**Not in the 2A set:** `phase-2b/credits_ledger.sql` is the 2B credits ledger. Don't
run it until Phase 2B is approved; it goes after the files above.

## Auth settings (2A-1)

- **Authentication → Sign In / Providers → Email:** enabled. Turn **off**
  "Allow new users to sign up". Only accounts made in the dashboard can sign in.
- **Authentication → URL Configuration → Site URL:** `https://uselai.com/app/`

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
role key>`. It refuses any other caller and touches only what the database lists.

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

## Email sender: Google Workspace (ryan.galen@uselai.com) via Supabase custom SMTP

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
- **The worker's reader and the render path are built** (Ryagram branch `uploadreader`, docs/WORKER-UPLOADS.md there; review by
  WORKER, then CC1): CSV, TSV, XLSX and ODS are read in a sandboxed child (no macros, no formulas evaluated, formula-injection
  safe, zip-bomb and entity-expansion safe, hard caps); a render job whose story names `u_<24 hex>` is allowed by its own
  `dataset_id`, the worker asks `worker_job_upload(job)` (migration 20261004000500) for the confirmed mapping, builds a
  job-local dataset for the engine, draws the film, and deletes everything. Uploaded values never reach a receipt, a log or an
  error; planted-sentinel tests prove it on a real render. Needs the worker's `[uploads]` section (`enabled = true`)

**Switching it on**

1. **SQL Editor:** the two migrations above, in order.
2. Deploy `purge-uploads` (`supabase functions deploy purge-uploads --no-verify-jwt`) and schedule it hourly
   exactly like `purge-partial-uploads` (service role key as the bearer). Redeploy `delete-account` so an account
   deletion removes uploaded files too.
3. Run `20261004000500_worker_job_upload.sql`; merge the Ryagram `uploadreader` branch (WORKER + CC1 review, Ryan's OK), add
   `[uploads] enabled = true` to worker.toml and update the worker.
4. Merge this branch, then set `uploads: true`.

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
