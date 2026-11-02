# CLOUD-SITE 11-02: what was done

Session: CLOUD-SITE (cloud). Started from origin/main **4c6f48d**. Nothing live: no deploy, no SQL against any database, no migration, no call to a live address.
No new dependency (the browser checks use the Playwright already on the machine). Every new page is behind its switch, OFF.

## Branches

| Branch | Head | What |
|---|---|---|
| `cloud-site-1102` | the commit that adds this file (parent bf0ee4c) | all five tasks, one after another |

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
