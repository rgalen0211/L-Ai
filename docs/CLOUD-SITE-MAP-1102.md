# CLOUD-SITE map 11-02: where the failure tests are thin

Session: CLOUD-SITE (cloud), branch `cloud-site-1102`, from origin/main 4c6f48d. Read-only survey; nothing live was touched.

Baseline on 4c6f48d: `node --test` (no argument) runs 1449 tests: 1437 pass, 0 fail, 12 skipped.
Note for Ryan: `npm test` runs `node --test tests/`, and on Node 22 that **fails** (`Cannot find module '/home/user/L-Ai/tests'`): Node 22 does not take a folder as a
test argument. `node --test` with no argument finds the same files. I have not changed package.json (it is shared by every session); one-line fix if you want it:
`"test": "node --test"`.

## How I measured

For every tool in `supabase/functions/connect-core/tools.ts` (24 tools) I counted the test files that call it, and read the `test(` titles in the
`tests/connect-*.test.mjs` files for refusal paths: bad input, not invited / wrong scope, limits, and another account's ids. The connector is already
heavily tested (mutation files `tests/connect_*_mutants.mjs` for most tools), so "weak" below means a specific refusal path with no test that fails if the
check is removed.

## Connector tools (supabase/functions/connect-core)

| Tool | Files | Thin or missing |
|---|---|---|
| whoami_and_credits | 5 | Nothing proves account B never sees A's label or balance (trivial in the fake, but untested). |
| list_projects | 1 | **No cross-account test**: nothing proves B's list leaves out A's projects. No refusal test at all. |
| get_story | 1 | Good (cross-account and missing version are covered). |
| create_project | 14 | **Daily limit (20 a day) untested.** Whitespace-only title (cleaned to empty) untested. An existing title must not count against the limit: untested. |
| get_story_schema | 2 | Read-only, no input; fine. |
| dataset_info | 1 | Good. |
| set_story | 10 | Good (checks, oversize, cross-account, finished version). |
| set_compilation_request | 3 | Good overall, **but a real gap**: the folder rule `not: {enum: [".", ".."]}` is checked BEFORE the name is trimmed, so `" .."` passes the schema and is saved as `".."` (see the bug below). The SQL (`20261026000300_compilation_requests.sql`) does not check folder names, so the tool is the only check. |
| make_contact_sheet / make_preview | 6 / 5 | Good (ladder, cost, repeats, cross-account). |
| request_full_render | 4 | Good (refused whatever the arguments). |
| job_status | 6 | Good. |
| get_film_link | 4 | **Daily link limit (50) untested.** A `job_id` that belongs to ANOTHER account, passed with your own project: no test that it shows nothing. |
| get_edit_state / set_look / edit_tracks / undo_my_changes | 1-5 | Good (cross-account test covers all four). |
| request_download / list_my_downloads | 1 | Good; list never shows url/why/folder: covered. |
| suggest_next_step | 1 (+ intake tests) | Read-only; fine. |
| get_cost_estimate | 1 | Good. |
| request_footage | 1 | Good (OFF path proven). |
| get_clip_explanations / get_draft_messages | 1 | Good (cross-account covered). |

### The gate (dispatch.ts) and the faces

| Path | Thin or missing |
|---|---|
| `dispatch.ts` arguments that are an array or a string ("must be a JSON object") | **Untested** in the connector tests. |
| `dispatch.ts` grant lookup throws (`grant_lookup`) / limit lookup throws (`limit_lookup`) | **Untested**: nothing proves a database fault becomes the plain sentence and starts nothing. |
| `dispatch.ts` a failed log write never changes the answer | **Untested.** |
| Account-wide limit (`calls_acct`, 120 a minute for all of one person's AIs) | Covered in connect-safety-limits. |
| REST: a body that is a JSON array; a call before sign-in | Array body untested (goes to the gate's "JSON object" refusal). |
| `connect/db.ts` (the real data layer) | Only the mapping is unit-tested (mutant files); it is a thin `select public.connect_x(...)` wrapper and the SQL is tested in `supabase/tests/test_connect.py` (not run here: no database). |

## App pages

Every script in `assets/` is named by at least one test. The ones named by only one test (thinnest): analytics-config, app-catalog, app-editor-padding,
app-editor-transcript, auth-forward, directory-drafts, film-remix, game-tv, game-tv-sample, geo-demo, geo-demo-data, get-app, help-flags,
landing-drafts, lazy-video, mac-note, ryagram-loops, workflow-audit.

For the two pages in this session's scope:

- `/game-tv/` (`assets/game-tv.js`, `tests/game-tv.test.mjs`): the helpers and the switch are tested in node; the walk through the screens, phone width and
  keyboard are in Python Playwright checks (`tools/check-game-tv.py`, `tools/audit-a11y-gametv.py`) that need Chrome and are not part of `node --test`.
- `/geo-demo/` (`assets/geo-demo.js`, `tests/geo-demo.test.mjs`): same shape: node tests for helpers and wiring, the browser checks in
  `tools/check-geo-demo.py` / `tools/audit-a11y-geo.py`.

The Python Playwright checks did not run in this cloud box (no Python Playwright, no Chrome channel). For tasks 3 and 4 I drive the pages with the
preinstalled Node Playwright and Chromium instead (scripts named in docs/CLOUD-SITE-1102.md).

## What task 2 will add

Must-fail tests for every **bold** gap above, without changing behaviour, plus one bug fix (folder names trimmed before the `.`/`..` check), failing test first.
