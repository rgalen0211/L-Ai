# CLOUD-SITE 11-02: what was done

Two rounds. Round 1 is on `cloud-site-1102`; round 2 is on `cloud-site-1102c` (both from origin/main 4c6f48d). Round 2 is at the end of this file.

Session: CLOUD-SITE (cloud). Started from origin/main **4c6f48d**. Nothing live: no deploy, no SQL against any database, no migration, no call to a live address.
No new dependency (the browser checks use the Playwright already on the machine). Every new page is behind its switch, OFF.

## Branches

| Branch | Head | What |
|---|---|---|
| `cloud-site-1102` | e6569a1 | round 1: all five tasks |
| `cloud-site-1102c` | the commit that adds round 2 to this file (parent e11029b) | round 2: all five tasks |

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
