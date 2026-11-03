# CLOUD-SITE 11-02: what was done

Three rounds, each on its own branch from origin/main 4c6f48d: round 1 on `cloud-site-1102`, round 2 on `cloud-site-1102c`, round 3 on `cloud-site-1102d`. Rounds 2 and 3 follow round 1 below. **The decisions for Ryan from all three rounds are collected at the very end.**

Session: CLOUD-SITE (cloud). Started from origin/main **4c6f48d**. Nothing live: no deploy, no SQL against any database, no migration, no call to a live address.
No new dependency (the browser checks use the Playwright already on the machine). Every new page is behind its switch, OFF.

## Branches

| Branch | Head | What |
|---|---|---|
| `cloud-site-1102` | e6569a1 | round 1: all five tasks |
| `cloud-site-1102c` | a8c92a4 | round 2: all five tasks |
| `cloud-site-1102d` | the commit that adds round 3 to this file (parent d97c113) | round 3: all six tasks |

No other branch was made: the work was small enough to review in order. Commits, oldest first:

| Commit | Task | What |
|---|---|---|
| 1df5438 | 1 | docs/CLOUD-SITE-MAP-1102.md: where the failure tests are thin |
| d58353f | 2 | 11 must-fail connector tests (no behaviour change; all pass on the old code) |
| df0b48b | 2 | the FAILING test that proves the folder bug (red on purpose; this commit also fails tests/source-hygiene because of one invisible character in the test file, fixed in the next commit) |
| 10fcab2 | 2 | the fix for the folder bug, plus a mutant for it |
| ed165a2 | 3 | the Games phone page, /game-phone/, switch `gamePhone` OFF |
| bf0ee4c | 4 | the phone-size and keyboard check for /geo-demo/ and /game-tv/ |

## Bugs found

### 1. A folder named " .." is saved as ".." (connector, set_compilation_request): FIXED

- **File:** `supabase/functions/connect-core/tools.ts`, the `folders` line in `setCompilationRequest.run` (line 301 before the fix).
- **What:** the schema refuses a folder that is exactly `.` or `..`, but the tool trims the name AFTER the schema has looked at it. `" .."` passes the schema and is saved as `".."` (also `".. "`, `" . "`).
  The SQL (`supabase/migrations/20261026000300_compilation_requests.sql`) does not check folder names, so the tool was the only guard.
- **Proof:** `tests/cloud-site-connect-mustfail.test.mjs`, test "MUST FAIL (bug): a folder name that is "." or ".." once its spaces are trimmed..." failed on df0b48b
  (the saved request held `[".."]`) and passes on 10fcab2.
- **Fix:** after trimming, the list is checked again and the call refused in words, nothing saved. The checklist's folder must be one of these folders, so it is covered too. The schema rule stays (it is what the AI reads).
- **Mutant:** `tests/connect_request_mutants.mjs` now also runs the new test file and has a mutant that removes the new line: all 16 mutants caught.
- **Needs Ryan:** the `connect` function must be redeployed from a tree that has the fix for it to reach the live connector. I did not deploy.

### 2. `npm test` fails on Node 22 (not changed)

`package.json` has `"test": "node --test tests/"`; Node 22 does not take a folder there (`Cannot find module '/home/user/L-Ai/tests'`). `node --test` with no argument runs the same files.
I left package.json alone (every session shares it). One-line fix if you want it: `"test": "node --test"`.

### 3. `tools/connect_predeploy_check.mjs` says "17 CHECK(S) FAILED" on untouched main (not changed)

It reports `ran 0` for every set, on 4c6f48d as well as on this branch, while the suites it names pass when run directly (for example `node --test tests/connect-oauth-guard.test.mjs`: 15 pass).
So it is the script's reading of the test output in this Node version, not the code. Worth a look before the next connect deploy, since its "do not deploy" is the gate.

## Task 2: the must-fail tests

`tests/cloud-site-connect-mustfail.test.mjs` (12 tests), against the connector's own code and its in-memory stand-in (no database):

- the gate: arguments that are an array, a string, a number or `true` are refused before any tool runs; a database fault while checking the grant or a limit becomes the plain sentence, runs nothing and leaks no token or address; a failed log write never changes the answer; the REST face refuses a JSON array body the same way;
- account limits that had no test: 20 new projects a day (an existing title does not count, another account is not affected), 50 link answers a day, a title that is only spaces or invisible characters;
- nothing of another account: `list_projects` and `whoami_and_credits` show nothing of theirs; `get_film_link` with your own project and THEIR finished job id lists nothing; cost estimate, story, editor state, set_look and undo on their project say "not found" and carry no story text;
- the folder bug above.

## Task 3: the Games phone page

`/game-phone/` (`game-phone/index.html`, `assets/game-phone.js`, `assets/game-phone.css`), switch `gamePhone: false` in `assets/ryagram-config.js` (same pattern as `gameTv`; the config's `?v=` was not bumped, as with gameTv).

- A player types the 4-letter room code from the TV (no I, no O, no numbers; lower case, spaces and a dash forgiven) and a name (1 to 16 letters, not one already in the room), then a typed guess each round (1 to 120 characters, with a counter). Text only: no microphone, camera, picture or file.
- **Only the sample room works** (code GAME). It is built from the recorded sample's PUBLIC view only (what was said so far, how many words are left); the answer and the recorded players' guesses are never copied in. A guess "sent" there stays in the page's memory. The page's CSP has `connect-src 'none'`, and the code has no fetch, socket or storage.
- The real room (phones talking to the host's Ryagram app) is NOT built; `room.send()` is the one place it would plug in. Design needed from Ryan/BUILDER (proposals/BUILDER-GAME-ROOM-1102.md is not in this repo, so I could not follow it).
- Errors are words tied to their field (`aria-describedby`, `aria-invalid`, `role="alert"`), focus goes to the field that needs fixing, and each new screen moves focus to its heading.
- Unlinked, noindex (added to the lists in `tests/public-pages.test.mjs`).
- **Tested:** `tests/game-phone.test.mjs` (8 node tests: switch, code/name/guess rules, the sample room holds no answer and no recorded guess, no network/storage/media in the code, page wiring, linked from nowhere).
  `node tools/check-game-phone.mjs`: switch OFF shows the plain line; ON, the whole sample walked with the keyboard only at 320 px, 375 px and desktop, wrong inputs refused, answer never on screen, the `tools/audit-a11y.py` scan on every screen: 27 screens, 0 failures.

## Task 4: phone size and keyboard on /geo-demo/ and /game-tv/

`node tools/check-phone-keyboard-pass.mjs` at 320, 375 and 1200 px with each switch ON in a local config copy: every Tab stop has a focus ring and every control is reached; geo-demo driven by keyboard
(mode radios by arrow key, the three example sites, the radius, kind-of-place and distance selects keep focus and redraw the numbers); game-tv walked through the whole game with Tab + Enter and again
with the right arrow key, focus moving to each new heading; no sideways scroll; no console error; no outside request; the audit-a11y scan on every state. **45 states, 0 failures: nothing broke, so
neither page was changed.** I also looked at 320 px screenshots of both (the geo results table stacks into cards; the TV screen fits).

The Python Playwright checks (`tools/check-game-tv.py`, `tools/audit-a11y-*.py`, ...) could not run here (no Python Playwright, no Chrome channel). The new checks are Node and use the same scan.

## Task 5: public wording the code does not back (NOT changed: for Ryan)

| Where | Wording | What the code does |
|---|---|---|
| `help/index.html`, "My own data (spreadsheet) won't read" | "Your uploaded data is always deleted once it has been used; none of it is kept." | Uploads default to **keep**: `dataset_retention` default `'keep'` (`supabase/migrations/20261004000300_uploads_worker_and_sweep.sql` line 72; account default `upload_retention ... default 'keep'`). The sweeper (`uploads_due_for_deletion`, same file line 116) deletes only uploads marked "Don't keep" (after the final film or 7 idle days), ones the person deleted, and unreadable ones after 1 day. Even then a tombstone stays (id, hash, row count; line 131). |
| `help/index.html`, same answer | "If the file can't be read ... the file is deleted automatically." | True, but after a day (`status = 'rejected' and last_activity_at < now() - interval '1 day'`), not at once. Fine if "automatically" is meant loosely. |
| `help/index.html`, "Can I change my film's colours and look before it renders?" | "Nothing is sent to the server and no credits are used while you try things." | True today. Once `liveEditor` is turned on it is not: the live editor sends each change to the server as a shared draft (`assets/app-editor-draft.js` line 36, `rpc('editor_apply_ops', ...)`), so the person's AI can see it. Change the words when that switch goes on. |
| The connector's instructions every AI reads (`supabase/functions/connect-core/mcp.ts` line 19, `INSTRUCTIONS`; also shown to this session) | "Tools that cost credits say so and need confirm=true; never set confirm=true unless the person has agreed to the stated cost." | No listed tool takes `confirm`. A connection cannot spend credits at all: a step that costs credits is refused (`startJob` in tools.ts) and `make_preview` with `confirm` is refused as a bad argument (tests/connect-tools.test.mjs). Only the unlisted `request_full_render` has `confirm`, and it is always refused. The sentence tells an AI to do something that does not exist. |
| `ryagram/index.html` | "Every film is checked against its data before you get it: honest axes, every number traced, uncertainty stated." | Cannot be checked from this repo: those checks run on the render worker (another repo). Listed so someone with that repo confirms it. |

I found no other claim on index.html, ryagram/index.html, help/index.html, get-app/index.html or the privacy policy that the code here contradicts.

## How everything was tested

- Full suite `node --test`: on 4c6f48d 1437 pass / 0 fail / 12 skipped; on this branch 1457 pass / 0 fail / 12 skipped (20 new tests).
- `node tests/connect_request_mutants.mjs`: all 16 mutants caught.
- `node tools/check-game-phone.mjs`: 27 screens, 0 failures. `node tools/check-phone-keyboard-pass.mjs`: 45 states, 0 failures.

## Not done / needs Ryan

- The status file the repo's CLAUDE.md asks for (`C:\Users\Ryan\Ryagram-logs\status\WEB.md` and `log.md`) is on Ryan's PC; this cloud session cannot reach it, so this file is the status.
- Redeploy `connect` from a tree with 10fcab2 for the folder fix to be live (I deployed nothing).
- Decide the help wording on upload deletion, and the connector's `confirm=true` sentence (table above).
- The real game room transport for the phone page.

---

# Round 2 (branch `cloud-site-1102c`, from origin/main 4c6f48d)

Same rules: nothing live, no PR, switches OFF, nothing pushed to main. This file and docs/CLOUD-SITE-MAP-1102.md were copied over from `cloud-site-1102` so both rounds are in one place.

**Important for Ryan, from round 1:** the connector you deployed tonight (connect v10 from main 4c6f48d) does **not** have round 1's folder fix (10fcab2): that fix is only on `cloud-site-1102`.
Until it is merged and `connect` is deployed again, the live `set_compilation_request` still saves `" .."` as the folder `".."`. (The SQL does not check folder names; the desktop app reads them as names among the person's chosen folders.)

| Commit | Task | What |
|---|---|---|
| b181fd1 | 1 | the FAILING test that proves `npm test` ran no test file |
| a0ada7e | 1 | the fix: `npm test` runs every test file |
| 697c4ff | 2 | must-fail tests for the sign-in and token flow (13 SQL on a local Postgres, 6 node) |
| 0b85090 | 1 | the npm test check compares with the files on disk (a new, uncommitted test file made it fail) |
| 88762f3 | 3 | the audit for the switched app pages and the FAILING tests that prove the focus bug |
| 4820eef | 3 | the fix: the live editor and the tester wizard keep the keyboard's place |
| e11029b | 4 | the one switches test |

## Bugs found in round 2

### 4. `npm test` ran no test file on Node 22: FIXED (on this branch only)

- **File:** `package.json` line 7: `"test": "node --test tests/"`.
- **What:** Node 22 does not take a folder as a test argument; it tries to load `tests` as one module and stops. `npm test` reported 1 test, 1 failure, and ran none of the 168 test files.
- **Proof:** `tests/npm-test-script.test.mjs` resolves the script's own arguments the way Node 22 does (each a file or a glob, never a folder; it does not run the suite, which would run itself)
  and compares them with the test files in `tests/`. It failed on b181fd1 (`"tests/" is a folder`) and passes on a0ada7e. A second case shows the old script resolves to no file at all.
- **Fix:** `"test": "node --test \"tests/*.test.mjs\" \"tests/*.test.cjs\""`. Node expands the quoted globs itself, so it works the same on Windows (cmd passes the double quotes through). `npm test`: 1452 pass, 0 fail, 12 skipped.

### 5. Live editor and tester wizard drop keyboard focus when they redraw: FIXED (both features still OFF)

- **Files:** `assets/app-editor.js` line 598 on main (`function paint()`, which rebuilds the Look, clip list, clip and rules panels); `assets/app-tester-wizard.js` line 66 (`function draw(r)`), which also runs every 15 seconds from line 86.
- **What:** each redraw threw away the control that had focus. After pressing a ready-made look, Up, Down, Shorter, Longer or a clip, or the wizard's "I checked" or "Check again", a keyboard or screen-reader user was dropped at the top of the page.
  On the wizard this happened every 15 seconds even while the person was only reading.
- **Proof:** `node tools/audit-a11y-switched.mjs` presses every button with Enter, from a fresh load each time, and checks that focus stays on the page. On main: **68 "drops focus" findings** (editor-data 5 presets, editor-compilation clip buttons, wizard 2, on phone and desktop). After 4820eef: 0.
  `tests/cloud-site-keep-focus.test.mjs` (6 node tests on a small stand-in DOM) failed on 88762f3 and passes on 4820eef.
- **Fix:** `paint()` and `draw()` remember the focused control and focus the same one after the redraw: in the editor by its label, preset or clip id; in the wizard by a new `data-wiz` attribute. If that control is now disabled (Up on what became the first clip), the next control in its row gets focus; if it is gone, its panel's heading does.
  `app-editor.js` and `app-tester-wizard.js` are at `?v=20261103a` (pairs added to tests/asset-versions.json). `tools/maker-live/live.js` was rebuilt from the site's file (`node tools/build-maker-live.mjs --check`: ok), so the desktop maker's copy has the fix too.

### Not fixed, for Ryan: admin Operations drops focus too (not behind a switch)

The same press check on `#/admin/ops` drops focus after: Mark reviewed, Remove, Save limit, Save plan, Save rate, Record cost, 4/8/12/26 weeks, Send the invite, Approve and make an invite code, Approve only, Mark answered.
Those sections are live (not switched), so I left them. The same fix would apply there (`assets/app-library.js`, the admin ops view). The worker-health section itself has no buttons and passes.

## Task 2: the sign-in and token flow

The decisions are made in SQL, so most of the proof is SQL. **I ran the SQL suites on a throwaway local Postgres 16 in this cloud box, never a real database**:
`supabase/tests/test_connect.py` 66 pass (the existing suite, unchanged), and the new `supabase/tests/test_connect_oauth_mustfail.py` 13 pass. (This box has no `pgserver` wheel, so I used a stand-in kept in my scratch folder, outside the repo; your usual `pgvenv` setup runs these files as they are.)

`supabase/tests/test_connect_oauth_mustfail.py` adds what test_connect.py did not cover:
- **expired:** an expired token answers 401 at every one of 17 `connect_*` doors, not only `connect_whoami`; an expired access token can be refreshed, but the new token keeps only the scopes it was given even after the grant was widened.
- **revoked:** revoking either the access or the refresh token ends both; a revoke with a raw token or garbage changes nothing and never errors; a revoked grant stops every door.
- **admin and worker accounts:** a person who becomes an administrator AFTER connecting loses their unexchanged code, their refresh token and their access token at once (every door 403); the same for a person who becomes a render worker; an admin with access switched on by hand still gets no code and no token.
- **wrong account:** a code is bound to its client, redirect address and verifier (another client, another address or the raw code all give invalid_grant and no token); a refresh token is not an access token and the reverse; Alice's token never sees or writes Bob's project, even on doors Bob has used.
- **scope limits:** a sweep of 17 doors against 5 scopes: every door refuses a token missing its scope (403) and opens with it; `render_final`, `admin` and `service_role` can never be requested or granted.
- **proof the tests bite:** two SQL mutants on a scratch run (reverted): `connect_edit_ops` asking only `read` is caught by the sweep; the actor skipping the person check is caught by the admin and worker tests.

`tests/connect-oauth-mustfail.test.mjs` (6, node) covers the HTTP face wired as `connect/index.ts` wires it: an expired, revoked or unknown token gets 401 with `error="invalid_token"` on MCP and REST and no tool function is ever called; a token revoked between two calls fails on the next one (nothing is cached); only the token's SHA-256 ever reaches the database; a read-only token is refused a write tool by the gate and the write function is never called; a token that dies in the middle of a call gets the plain sign-in sentence; the token endpoint answers `invalid_grant` and never echoes the code or refresh token.

No bug was found in the token flow.

## Task 3: the switched app pages

`node tools/audit-a11y-switched.mjs` covers the live editor (data and compilation), My films (plain and tester), the intake, the tester wizard, admin Tester computers and worker health on admin Operations.
It runs in mock mode with a local server only, at phone 390 px and desktop 1280 px, with the switches turned ON in a local config copy only. It uses the same checks as `tools/audit-a11y-app.py` (which needs Chrome): the shared scan for names, headings, contrast, 40 px targets and alt text; sideways scroll; messages in live regions; the Tab walk with focus marks and no trap; plus the new press-every-button focus check. It also checks that each switched feature actually shows.
- Result: 16 page views, 0 findings after the fix. Before it: the 68 focus findings above, nothing else.
- To make worker health checkable at all I added a mock `admin_worker_health` to `tests/fake-supabase.js` (mock only). Without it the section never drew in mock mode.

## Task 4: the switches test

`tests/switches-off.test.mjs` is one test:
- Every switch is false except the 16 you turned on (named in the test); a new switch must ship false.
- Every served read of an OFF switch is strict (`=== true` / `!== true`).
- Every OFF switch is wired to something (except `catalog` and `catalogComingSoon`, which stay off and unread on purpose).
- Every `data-flag` entry is `hidden` in the HTML and names a real switch.
- Every stand-alone switched page keeps its content hidden, and its own `on()` answers false with the shipped config.
- The help page's switch code, run with the shipped config, shows nothing that needs an OFF switch.

It passes today. Four mutants each make it fail: a switch flipped on, a loose read in game-tv.js, a help entry without `hidden`, a new switch shipped on.
- **For Ryan:** the 16 switches that are ON: visitCounting, credits, payments, stripeTestMode, accountTools, passwordReset, inviteSignup, opsTools, filmRequests, guidedBuilder, lookEditor, renderOrders, connectAi, aiFirst, departments, desktopApp. If any of those is not one you meant to be on, say so: I changed none of them.

## How round 2 was tested

- `npm test` (now working): 1452 pass, 0 fail, 12 skipped (14 new tests on this branch).
- Local Postgres 16, throwaway: `test_connect.py` 66 OK; `test_connect_oauth_mustfail.py` 13 OK; two SQL mutants caught.
- `node tools/audit-a11y-switched.mjs`: 16 page views, 0 findings (68 before the fix).
- `node tools/build-maker-live.mjs --check`: ok.

## Needs Ryan (both rounds)

- Merge and redeploy `connect` for round 1's folder fix (10fcab2, on `cloud-site-1102`). Tonight's v10 from main does not have it.
- Round 1's `tools/connect_predeploy_check.mjs` problem is still open: it reports 17 failures on main while the suites it names pass. It is the deploy gate.
- The wording findings in round 1's task 5 table (help upload deletion, the connector's `confirm=true` sentence, the live editor sentence, the engine checks). I did not change public wording.
- Admin Operations focus loss (above), if you want it fixed.
- The 16 ON switches list (above).
- Your status file on your PC (`C:\Users\Ryan\Ryagram-logs\status\WEB.md`) is not reachable from the cloud; this file is the status.

---

# Round 3 (branch `cloud-site-1102d`, from origin/main 4c6f48d)

Same rules: nothing live, no PR, switches OFF, no public wording changed, nothing pushed to main. The SQL tests ran on a throwaway local Postgres 16 in the cloud box (never a real database), as in round 2.
Note: this branch starts from main, so it has main's broken `npm test`; use `node --test` here (round 2's fix is on `cloud-site-1102c`).

| Commit | Task | What |
|---|---|---|
| 8c5807c | 1 | invite and sign-up must-fail tests in SQL (10) |
| 72cffe2 | 1 | the FAILING test that proves the forged-address bug in redeem-invite |
| ca8cf10 | 1 | the fix |
| b3d7221 | 2 | public pages check script, test and report (docs/PUBLIC-PAGES-REPORT-1102.md) |
| 1a16bd8, 181f22e | 3 | app page weight tool and report (docs/APP-WEIGHT-1102.md); a correction to the report |
| e652319 | 4 | connector abuse tests (7 node, 4 SQL with real concurrent connections) |
| 18f9cc3 | 5 | the FAILING test that proves the dataset_info empty field |
| d97c113 | 5 | the fix |

## Bugs found in round 3

### 6. redeem-invite's guess limit trusts an address the visitor writes: FIXED (not deployed)

- **File:** `supabase/functions/redeem-invite/redeem.ts` line 46 on main: `(cf-connecting-ip ?? x-forwarded-for).split(",")[0]`.
- **What:** without cf-connecting-ip it takes the FIRST X-Forwarded-For hop, which the client writes. A guesser who changes that header on every try gets a fresh 10-guesses-an-hour allowance each time; only the 300-an-hour site cap is left.
  creator-beta (`apply.ts` callerAddress) and node (`router.ts` caller) already take the LAST hop, the one the platform's proxy appended (CC1 MED-1).
- **Proof:** `tests/redeem-invite-mustfail.test.mjs`, first case: 4 forged first hops behind one real hop were 4 different callers on 72cffe2, and are 1 caller on ca8cf10.
- **Fix:** cf-connecting-ip if present, else the last X-Forwarded-For hop. **Needs Ryan:** redeploy `redeem-invite` from a tree with ca8cf10. As with creator-beta, check once on the real project which header arrives (supabase/README.md, "Creator beta").

### 7. dataset_info prints an empty field: '(per 100k, , rate)': FIXED (not deployed)

- **File:** `supabase/functions/connect-core/tools.ts` line 141 on main (datasetInfoText, the Measures line).
- **What:** it joined unit, role and kind with ", " whatever they held. ENGINE's record (vendored byte for byte) has an empty role for state_obesity_fastfood's restaurants_per_100k (Ryan's case), and an empty kind for 12 other measures, which printed "(USD, banded, )". 13 of 117 measures.
- **Proof:** `tests/connect-dataset-info-blank.test.mjs` failed on 18f9cc3 (all 3 cases) and passes on d97c113: no line of any dataset's words has an empty field, and the restaurants measure reads "(per 100k, rate)".
- **Fix:** empty parts are left out; a missing unit still reads "no unit"; the record itself and the structured result are unchanged. `connect_dataset_info_mutants` 13/13 and `connect_mutants` 37/37 still caught.
- **Needs Ryan:** live only after `connect` is deployed from a tree with d97c113. Separately, ENGINE may want to fill those empty role/kind fields in docs/dataset-info.json.

## Task 1: invite and sign-up

`supabase/tests/test_invite_signup_mustfail.py` (10, local Postgres), with no behaviour change:
- **Expired:** a code one second past its expiry is refused, takes no use, counts as a guess, and reads the same as a made-up code.
- **Reused:** a one-use code redeems once; after a real sign-up its use never comes back (a late release changes nothing); a release gives a use back once however often it is called; a disabled code is refused with uses left.
- **Wrong email:** a malformed or listed email takes no use and is not counted as a guess. The SQL alone refuses an untrimmed address; redeem.ts trims and lowers it first.
- **Admin-only, for testers:** every one of the 40 `admin_*` functions refuses a tester and a plain account with 42501; the tester flag grants nothing admin; a tester mints no code.
- **Proof the tests bite:** two SQL mutants (admin_invite_person without its admin check; a release that frees a used redemption) were both caught.

`tests/redeem-invite-mustfail.test.mjs` (7, node) covers the function in front:
- the forged-address bug above;
- an address that already has an account gets exactly the same answer as a new one;
- expired, used-up and made-up codes get one plain sentence;
- the email reaches the database trimmed and lower case, and an over-long code is cut;
- non-string fields are refused before the database is asked;
- a database fault never shows its text;
- another site gets 403 before the database, with no CORS permission.

Two things pinned for Ryan to decide (tests pass today and fail if the behaviour changes):
- **A code sent to one address redeems with any address.** The send binds the address (so an admin cannot mail the code to anyone else), but `invite_reserve` never checks it: the code is the credential. If invites should only work for the address they were sent to, that is one SQL change in invite_reserve plus a new sentence for the person.
- **22 of the 40 admin functions do not refuse an admin acting through an OAuth client token** (a token carrying a client_id). The other 18 do, through `require_admin` / `require_app_session` ("an admin acts from the app, never through a connected AI").
  The 22: ack_stripe, answer_support, cost_delete_threshold, cost_record, cost_rollup, cost_set_plan, cost_set_rate, cost_set_threshold, creator_beta, creator_flow_set, creator_invite, decide_creator, department_interest_counts, film_request_set, film_requests, funnel, invite_app_link_make, invite_person, invite_send_begin, invite_send_undo, ops, review_report (each `admin_`).
  Ryagram's own connector cannot reach any of them (its role may run `connect_*` only), so this matters only if a Supabase-issued OAuth token for an admin ever exists. Fixing it needs a migration, which this session may not write. The test pins the list so it can only shrink.

## Task 2: public pages

`node tools/check-public-pages.mjs [--write]` reads every served page from the files and checks links, anchors, assets, alt text, titles, language, viewport, descriptions and noindex on drafts. `tests/public-pages-check.test.mjs` runs it and also proves it catches 8 kinds of planted fault. The report is `docs/PUBLIC-PAGES-REPORT-1102.md`.
- **0 hard findings** on the 24 pages: no broken internal link, anchor or asset; no image without alt; every page has a title; every draft or private page says noindex.
- **For Ryan (warnings):** there is no robots.txt and no sitemap.xml. Every file in the repository is served (tools/ 268, supabase/ 266, tests/ 230 ...).
- **For Ryan:** with no `.nojekyll`, GitHub Pages most likely builds the site with Jekyll, which publishes the 22 Markdown files as HTML pages with no noindex. That includes README, docs/connect-runbook, the maker contracts and supabase/README. **Check one in a browser (https://uselai.com/README.html) before acting.** A `.nojekyll` file, or a robots.txt with Disallow lines, are the two usual answers; both are live-site changes, so they are yours.
- Smaller: app/index.html has 4 h1 in its HTML (one visible at a time); film's "Sources" link (#sources) only works once the film has drawn.

## Task 3: page weight

`node tools/measure-app-weight.mjs [--write]` measures offline (local gzip server, mock mode, Chromium, simulated 4G, median of 3). The report is `docs/APP-WEIGHT-1102.md`.
- Every app page is the same document: 38 of our scripts (729.6 KB, **234.0 KB gzipped**) plus 4 stylesheets (12.0 KB gzipped) plus the Supabase UMD build (54.1 KB gzipped) and the font. That is 44 requests and about 471 KB on the wire on every page, with the heading on screen in about 4.4 s.
- Heaviest of ours: app-library.js 37.4 KB gzipped (about 13% run on the first screen), app-editor.js 18.8 KB, scene-draw-rules.min.js 13.6 KB, app-data.js 13.3 KB.
- **Suggested cuts (none made):**
  1. Load the live-editor stack on demand: 10 files, 64.8 KB gzipped on every page for a feature that is OFF.
  2. The same for the other OFF pages (10.0 KB) and the admin-only code (9.8 KB).
  3. Split app-library.js by route.
  4. Measure a slimmer Supabase client. It still needs auth, PostgREST, storage and realtime, so measure before deciding.
  5. Mark the scripts `defer`.
  6. Self-host the font.
  7. A long cache lifetime if the site ever moves behind a CDN.
- A budget to hold afterwards: at most 150 KB of our JS gzipped off the editor, and the heading in under 2.5 s on the simulated 4G.

## Task 4: connector abuse

No bug found.
- **`tests/connect-abuse.test.mjs` (7, node):**
  - 100 calls at the same instant from one connection: exactly 60 run, and 40 are refused with "wait" data.
  - A project burst stops at 20.
  - Alice and Bob interleaving 70 calls: 60 each, and no refusal names the other.
  - One account's spent limits leave the other's alone, and two AIs share one account limit.
  - A story is measured in UTF-8 bytes: 320 KB of emoji under 256K characters is refused.
  - Three failed previews block the fourth before anything is priced; another account and a changed story are not blocked.
  - Every refusal an abusive client can trigger reads as plain words.
- **`supabase/tests/test_connect_abuse.py` (4, local Postgres, real concurrent connections):**
  - A burst on 6 connections is counted exactly once per call.
  - Two accounts bursting together each get their own allowance.
  - **Five identical contact sheets started at the same instant queue one job.** Without submit_job's version-row lock the test failed 3 runs out of 3, with 2 to 4 duplicate jobs.
  - A revoked token's burst is refused and counts nothing.
- **For Ryan (no change made):** every refused call still writes a row to connect_calls, so a flood beyond the limits still costs one log write per call. A cap on log rows per minute per connection would bound it.

## How round 3 was tested

- `node --test` (main's `npm test` is broken on this branch): 1456 pass, 0 fail, 12 skipped (+20 node tests).
- Local Postgres 16, throwaway: test_invite_signup_mustfail.py 10 OK; test_connect_abuse.py 4 OK. The existing test_invites, test_invite_someone, test_invite_email, test_invite_app_links and test_creator_beta suites stay OK.
- Mutants: 2 invite mutants and the submit_job lock mutant were caught; connect_dataset_info_mutants 13/13 and connect_mutants 37/37.
- `node tools/check-public-pages.mjs`: 0 hard. `node tools/measure-app-weight.mjs`: report written.

---

# Decisions for Ryan (all rounds)

**Deploys** (nothing was deployed by this session; each needs its branch merged first):
1. `connect`, for the folder fix (round 1, 10fcab2 on `cloud-site-1102`) and the dataset_info fix (round 3, d97c113 on `cloud-site-1102d`). Tonight's v10 from main has neither.
2. `redeem-invite`, for the forged-address fix (round 3, ca8cf10 on `cloud-site-1102d`).

**Merges with no deploy:**
3. The `npm test` fix (round 2, `cloud-site-1102c`).
4. The live editor and tester wizard focus fix (round 2, `cloud-site-1102c`; both features stay OFF).

**Choices:**
5. Should an invite code work only for the address it was sent to? Today any address works (round 3).
6. Should the 22 older admin functions refuse an admin acting through an OAuth client token, as the other 18 do? This needs a migration (round 3).
7. Add `.nojekyll`, or a robots.txt? Check first whether https://uselai.com/README.html is live (round 3).
8. The page-weight cuts and budget in docs/APP-WEIGHT-1102.md (round 3).
9. A cap on connect_calls log rows during a flood (round 3).
10. Admin Operations drops keyboard focus after most buttons. It is not switched, so it was not fixed (round 2).
11. The 16 ON switches listed in round 2: confirm each is meant to be on.
12. The public wording findings from round 1, task 5 (help upload deletion, the connector's `confirm=true` sentence, the live editor sentence, the engine checks). Not changed.
13. `tools/connect_predeploy_check.mjs` reports 17 failures on main while the suites it names pass. It is your deploy gate (round 1).
14. Your status file on your PC is not reachable from the cloud, so this file is the status.
