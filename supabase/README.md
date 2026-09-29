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

Each file is one transaction: if it fails, nothing is half-applied.

**Not in the 2A set:** `phase-2b/credits_ledger.sql` is the 2B credits ledger. Don't
run it until Phase 2B is approved; it goes after the five files above.

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
worker password or an Anthropic key in this repo; the repo is public.

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

The schema is tested against a local Postgres with Supabase stand-ins
(`tests/supabase_stub.sql`, which models this project's no-default-grants
setting); see `tests/test_2a_core.py` for setup. The tests cover the waitlist's
insert-only access, privacy between users, anonymous access, r1/r2 independence, parameter
allow-lists, the contact sheet → preview → final ladder, worker confinement,
upload size/type checks, sequential exactly-once claiming, lost-worker retry,
retry_job vs final failures, metering for handed-back attempts, finished
versions staying locked, the kill switch and cancel.
