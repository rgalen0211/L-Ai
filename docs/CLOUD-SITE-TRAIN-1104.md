# CLOUD-SITE 11-04: the sign-in page layout and the waiting-account tests

Branch **`cloud-site-1104a`**, from origin/main **faf8228**.
- Nothing was pushed to main, no PR was opened, nothing was deployed, and no switch was turned on.
- **Merging it changes the live sign-in page.** That is the point of task 1, since Ryan asked for this layout, but it should be a conscious merge.

## HANDOFF (11-04, cloud credit ending; local sessions take over)

### (a) Exact head
- Branch **`cloud-site-1104a`**, from origin/main **faf8228**.
- Code head **ae0fd03**: the last commit with code or tests. The commit that adds this handoff section sits on top of it, and changes only this file.
- To get the true head: `git fetch origin cloud-site-1104a && git log -1 --format=%h origin/cloud-site-1104a`.
- Nothing is uncommitted. Nothing was pushed to main, no PR was opened, nothing was deployed, and no switch was changed.

### (b) Done and tested
1. **Sign-in layout split (Ryan 11-04 11:15)**, in commit c084cd4:
   - The sign-in page shows only the sign-in box (Email, Password, Sign in, Forgot your password?). Under it: "Have an invite code?", "First time here? Create an account" (the waitlist form for now) and "Get help".
   - "Have an invite code?" opens its own page, `/app/#/join`: Invite code, Your email, Join, Back to sign in.
   - Invite links (`#/join?code=&email=` and `/app/?code=`) land there filled in, send nothing, and are cleaned from the address bar.
   - Tested by `node tools/check-sign-in-pages.mjs`: 320, 390 and 1280 px, layout, keyboard order, both kinds of invite link, the accessibility scan. **0 failures.**
   - Unit tests: tests/app-auth.test.cjs (26) and tests/consumer-basics.test.mjs.
   - **Screenshots, before (main) and after, at 320, 390 and 1280 px: `docs/sign-in-1104/`.**
2. **Waiting-account must-fail tests**, in commit f391b92:
   - `supabase/tests/test_waiting_gate.py` (8 tests). It skips while the database has no `ryagram_private.is_waiting(uuid)`. Against a scratch "gate" that only marks accounts and enforces nothing, the 4 enforcement tests fail and the other 4 pass.
   - `tests/waiting-accounts.test.mjs`: 2 cases run now and pass (no Stripe session, download link or film link is handed out on a refusal). 3 are skipped until the gate (the person must be told why, with a 403).
3. **The whole branch:** `node --test` gives 1495 pass, 0 fail, 15 skipped. `node tools/pre-merge-check.mjs` passes all 20 steps.

### (c) Not done (pick up cold)
1. **Line up the waiting tests with CONNECT's real gate** (`connect-waiting-gate-1104`).
   - Do not write new gate code: CONNECT has built it.
   - At the top of `supabase/tests/test_waiting_gate.py`, change `mark_waiting()` to how that gate marks an account (it assumes a `public.waiting_accounts` row) and `WAITING_STATUS_FN` to its status function (it assumes `my_access_status()`). Also change `GATE` if its check function is not `ryagram_private.is_waiting(uuid)`.
   - Then run the file with the gate's migration in `supabase/migrations`: `pgvenv/Scripts/python -m unittest supabase/tests/test_waiting_gate.py -v`. Every failure is either a function the gate misses or a test that needs adapting.
2. **Remove the skips in `tests/waiting-accounts.test.mjs`** once the gate's error code and sentence are fixed.
   - Set `WAITING_GATE_CODE` (the env var, or the default in the file) to the gate's code.
   - Expected failures until fixed: **stripe-checkout** answers 502 "Stripe didn't answer" (`supabase/functions/stripe-checkout/checkout.ts`, the catch at the end of `handle`), and **get-delivery-url** answers 404 "Film not found" (`deliver.ts`). Each needs to pass the database's sentence on with a 403.
   - **app-download** already does this for PT403 (`core.ts`, `PLAIN`).
3. **Reconcile with CC1's wiring** (`cc1-waiting-wire-1104`). Both branches touch the signed-out pages (`app/index.html`, `assets/app-auth.js`), so merge one onto the other and run `node tools/check-sign-in-pages.mjs` and `node --test`.
   - Expect conflicts in `tests/asset-versions.json` and the `?v=` stamps in `app/index.html` (both bump `app-auth.js`): keep one new stamp and record its hash.
   - When real waiting accounts exist, point "First time here? Create an account" (`id="create-account"` in `app/index.html`) at the real sign-up instead of `/ryagram/#waitlist`, and update the expected link in `tests/consumer-basics.test.mjs` and `tools/check-sign-in-pages.mjs`.
4. **Run the Chrome-only Python checks** that click "Have an invite code?" on a machine with Chrome: `tools/audit-flow.py`, `tools/audit-app-pass.py`, `tools/check-first-run-phone.py`. They should pass unchanged (the click now opens the join page), but this cloud box had no Chrome to prove it.
5. **Earlier rounds, still open** (details in `docs/CLOUD-SITE-TRAIN-1103.md`):
   - Should the 22 older admin functions refuse an admin acting through an OAuth client token? That needs a migration.
   - `.nojekyll` or a robots.txt for the Markdown files; check https://uselai.com/README.html first.
   - The page-weight cuts in `docs/APP-WEIGHT-1102.md`.
   - Admin Operations losing keyboard focus after its buttons.
   - The connector's "confirm=true" instruction sentence.
   - The wording drafts in `docs/PUBLIC-WORDING-DRAFTS-1103.md` (on the closed branch `cloud-site-1103f`).

### (d) Decisions for Ryan, in plain words
1. **Merge `cloud-site-1104a` when you want the new sign-in page live.** Merging main publishes it. The screenshots in `docs/sign-in-1104/` show the before and after.
2. **Choose where "First time here? Create an account" goes.** Today it goes to the waitlist form; when CONNECT's waiting accounts are live it should go to the real sign-up.
3. **Agree with CONNECT on one error code and sentence** that a waiting person sees when the server refuses them (PT403 already works for the desktop download). Until checkout passes it on, a waiting person who tries to buy credits would be told "Stripe didn't answer", which is wrong.
4. **Which branch goes first:** this one or CC1's waiting wiring. Both change the sign-in area, so one has to be merged onto the other.


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
| ae0fd03 | The first version of this file |
| (next) | The handoff section above |
