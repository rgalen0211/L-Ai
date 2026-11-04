# CLOUD-SITE 11-04: the sign-in page layout and the waiting-account tests

Branch **`cloud-site-1104a`**, from origin/main **faf8228**.
- Nothing was pushed to main, no PR was opened, nothing was deployed, and no switch was turned on.
- **Merging it changes the live sign-in page.** That is the point of task 1, since Ryan asked for this layout, but it should be a conscious merge.

## 1. The sign-in page (Ryan, 11-04 11:15)

**What a person sees now:**
- **Sign in** (`/app/`, signed out): only the sign-in box (Email, Password, Sign in), then "Forgot your password?". Under them, one per line:
  - **Have an invite code?** This opens its own page. It shows only while invite sign-up is switched on (`inviteSignup`, which is on), as before.
  - **First time here? Create an account.** For now this opens the existing waitlist form (`/ryagram/#waitlist`). Ryan chose real accounts that are locked in a "waiting" state, but that is CONNECT's server work, so sign-ups stay closed.
  - **Trouble signing in? Get help**, as before.
- **Have an invite code?** (`/app/#/join`), laid out like sign-in: Invite code, Your email, Join, then "Back to sign in".
- **Invite links** (the email's `/app/#/join?code=...&email=...`, and `/app/?code=...`) land on that page with both boxes filled.
  - Nothing is sent until the person presses Join.
  - The address bar is cleaned to `#/join`, so the code and the email do not stay in it or in the history.
- **Keyboard:** the Tab order on each page is top to bottom as listed. Moving between the two pages puts focus on the new page's heading. Someone who signs in while on `#/join` goes to their projects, not to an empty page.
- **Before and after screenshots** at 320, 390 and 1280 px are in `docs/sign-in-1104/` (`before-*` from main, `after-*` from this branch).

**What changed in the code:**
- `app/index.html`: the sign-in section, and a new `#join` section that holds the invite form.
- `assets/app-auth.js`: routing between the two signed-out pages, and where invite links land.
- `assets/app.css`: the link list, with 44 px tap targets.
- `app-auth.js` and `app.css` are at `?v=20261104a`, with the pairs added in `tests/asset-versions.json`.
- Words: the only new text is Ryan's own ("Have an invite code?", "First time here? Create an account", "Back to sign in"). The old line "No invite yet? Join the waitlist to ask for an invite." is gone, replaced by "Create an account". The join page's heading is "Have an invite code?".

**How it was tested:**

| Command | Result |
|---|---|
| `node --test` | 1495 pass, 0 fail, 15 skipped (the 3 waiting skips below plus the 12 that were already skipped) |
| `node tools/check-sign-in-pages.mjs` (new) | 6 pages (sign-in and join at 320, 390 and 1280 px), **0 failures** |
| `node tools/pre-merge-check.mjs` | **PASS**, 20 of 20 steps (node tests, both public-pages audits, every page check, 13 connector mutant runners). The new sign-in check is now part of it. |

The new check runs the real app script, signed out, against a local server, with the pinned Supabase library served from `node_modules` (a signed-out client makes no network call; any outside request fails the check). At each width it checks:
- exactly what each page shows, and in what order;
- the keyboard order on both pages;
- Enter on "Have an invite code?", then on "Back to sign in", and where focus lands;
- both kinds of invite link (filled, nothing sent, the address cleaned);
- the accessibility scan of `tools/audit-a11y.py` (names, headings, contrast, 40 px targets, sideways scroll);
- no console error.

Tests that changed with it:
- `tests/app-auth.test.cjs`: two cases rewritten for the new pages, and one now counts the one-time listener rather than all listeners.
- `tests/consumer-basics.test.mjs`: the new links.
- Three tests that pin the version stamps moved forward, as the repo does with every bump.

The Python checks that click "Have an invite code?" (`audit-flow.py`, `audit-app-pass.py`, `check-first-run-phone.py`) should keep working: the click now opens the join page, where the invite form is visible. They need Chrome, so they were not run here.

## 2. Waiting accounts: must-fail tests, skipped until the gate exists

Ryan's rule: a **waiting** account may reach only the "You are on the list" page, its settings, and deleting the account. Everything else must be refused **by the server**, not just hidden by the page. The gate is CONNECT's and does not exist yet, so these tests are written now and wait for it.

**`supabase/tests/test_waiting_gate.py`** (8 tests, local Postgres). The whole file **skips** while the database has no `ryagram_private.is_waiting(uuid)`, and runs on its own once CONNECT adds it. It checks that:
- **Every database function the app calls** (36 of them) refuses a waiting account with 42501 before it even looks at its arguments.
- **The five functions the edge functions call** for the person also refuse a waiting owner: checkout and credits (`stripe_checkout_context`, `stripe_set_customer`), the desktop download (`request_app_download`) and film links (`delivery_object_for`, `compilation_object_for`).
- A waiting account **writes no app table, uploads nothing, buys nothing**, and **cannot connect an AI**: `connect_person_ok` must be false, consent is refused, and so is any token.
- It **can** read its "on the list" status, change its settings (exactly as the app does), and request deletion (through delete-account's own path).
- An ordinary account is not stopped (the control).

**Proof that they test the enforcement and not just the marker:** I added a throwaway "gate" that only marks accounts as waiting and enforces nothing (temporary, never committed). The four enforcement tests **failed** and the other four passed. With no gate at all, the file skips.

**Two places for CONNECT to adapt** if the gate is shaped differently: `mark_waiting()` (how an account is put in the waiting state; it assumes a `public.waiting_accounts` row) and `WAITING_STATUS_FN` (the function the "on the list" page reads; it assumes `my_access_status()`).

**`tests/waiting-accounts.test.mjs`** covers the edge functions.
- **Running now (pass):** whatever the gate's refusal looks like, nothing is handed out: no Stripe checkout session, no desktop-download link, no film link.
- **Skipped until the gate:** the person is told why, with a 403 and the database's own sentence. I ran these unskipped to see where things stand:
  - **Checkout:** fails today. A refusal turns into **502 "Stripe didn't answer. Try again in a minute."** stripe-checkout passes no database sentence through.
  - **Film links:** fails today. The answer is 404 "Film not found".
  - **Desktop download:** already passes, provided the gate uses error code `PT403`.

## Things for Ryan and CONNECT, in plain words

1. **Merging this branch changes the live sign-in page** to the layout above. The screenshots show the before and after.
2. **"Create an account" goes to the waitlist form for now.** When CONNECT's waiting accounts exist, point that link at the real sign-up. The rest of the page does not need to change.
3. **The waiting gate needs one error code, chosen with the edge functions in mind.** `PT403` with a plain sentence already reaches the person through the desktop download. Checkout and film links need a small change to pass the sentence on: today a waiting person who tries to buy credits would see "Stripe didn't answer". The skipped tests say exactly what is expected.
4. **The gate must sit in the database functions themselves**, before any argument check, so that a hidden page is never the only lock. `test_waiting_gate.py` lists every function it must cover. A new app function should be added to that list.
5. **Seen while mapping:** the app calls `set_dataset_provenance`, which no SQL file in this repo defines. The app's own comment says it refuses until that proposed SQL exists, so it is not a bug, just a gap to close. `compilation_object_for` exists only as a draft (`supabase/connect-drafts/`).
6. The status file on Ryan's PC cannot be reached from the cloud, so this file is the status.

## Commits

| Commit | What |
|---|---|
| c084cd4 | The sign-in layout, the join page, the new check, the tests and the screenshots |
| f391b92 | The waiting-account must-fail tests (SQL and edge functions), skipped until the gate |
| (next) | This file |
