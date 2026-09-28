# Supabase (Ryagram)

One Supabase project holds the waitlist (Phase 1) and the app (Phase 2A).
Nothing here runs automatically: each file is pasted into the SQL Editor once.

## Apply, in this order

In the project: **SQL Editor → New query**, paste the whole file, **Run**.

1. `ryagram-waitlist.sql` (Phase 1 waitlist)
2. `migrations/20260928000100_2a_core.sql` (projects, versions, jobs, artifacts,
   metering, workers, kill switch, storage bucket `ryagram-artifacts`)

Each file is one transaction: if it fails, nothing is half-applied.

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

## Kill switch

Table Editor → `control` (one row):

- `claims_enabled`: false = the worker takes no new jobs
- `disabled_job_types`: e.g. `{final_render}` pauses those jobs everywhere
- `ai_enabled`: for the AI editor, later

No website redeploy needed.

## What the website may hold

Only the Project URL and the publishable key (`assets/ryagram-config.js`). The
database decides everything else. Never put the secret/service_role key, the
worker password or an Anthropic key in this repo; the repo is public.

## Tests

The schema is tested against a local Postgres with Supabase stand-ins
(`tests/supabase_stub.sql`); see `tests/test_2a_core.py` for setup. The tests cover
privacy between users, anonymous access, r1/r2 independence, parameter
allow-lists, the contact sheet → preview → final ladder, worker confinement,
upload size/type checks, sequential exactly-once claiming, lost-worker retry,
crash vs gate failure, the kill switch and cancel.
