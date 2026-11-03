# CLOUD-SITE review trains, 11-03

Two branches for Ryan to review and merge, both made from origin/main **4c6f48d** (unchanged since 11-02). They hold everything from the three CLOUD-SITE rounds (`cloud-site-1102`, `cloud-site-1102c`, `cloud-site-1102d`), split by kind:

| Train | What it holds | Changes what the site or the connector does? |
|---|---|---|
| **`cloud-site-tests-1103`** | New tests, checks, reports, and the `npm test` script fix | **No.** Only `tests/`, `tools/`, `docs/`, `supabase/tests/` and one line of `package.json` |
| **`cloud-site-features-1103`** | The Games phone page (switch OFF), the keyboard focus fix on two switched pages, and three bug fixes (the dataset_info words, a folder-name check, the sign-up guess limit), each with the test that proves it | **Yes**: listed in full under "Every behaviour change" |

Nothing was pushed to main, no PR was opened, nothing was deployed, every switch stays OFF, and no public wording was changed. Both trains also merge together cleanly (checked on a local throwaway branch: 1491 pass, 0 fail).

## How they were built (nothing rewritten)

The three round branches mix test commits and fix commits. Each fix was committed right after a test that fails without it. So a train cannot take a whole branch, and it must never take a failing test without its fix. I did this:

- **Merged directly with `--no-ff`** wherever a branch *begins* with commits of the right kind (merging a commit brings exactly it and the commits before it, unchanged):
  - tests train: cloud-site-1102 up to d58353f, cloud-site-1102c up to 0b85090, cloud-site-1102d up to 8c5807c;
  - features train: cloud-site-1102 up to ed165a2.
- **Cherry-picked with `-x`** the commits that sit after a commit of the other kind on their branch. Each copy names its original (`cherry picked from commit ...`). The copies went onto a side branch (`...-picks`), which was then merged with `--no-ff`.
- **One new commit** on the tests train: round 1's must-fail test file had an invisible character that was only fixed inside the folder fix (a features commit). The escaped lines are byte-identical to that fix, so the two trains still merge cleanly.
- The original branches are untouched and still pushed; no branch was deleted.

### `cloud-site-tests-1103` (main line, oldest first)

| Commit | What |
|---|---|
| 52bdc97 | merge of cloud-site-1102 up to d58353f: the coverage map (docs/CLOUD-SITE-MAP-1102.md) and 11 connector must-fail tests |
| a694193 | merge of cloud-site-1102c up to 0b85090: **the `npm test` fix** with its test, and 6 node + 13 SQL token-flow must-fail tests |
| b7d1c45 | merge of cloud-site-1102d up to 8c5807c: 10 SQL invite and sign-up must-fail tests |
| 48b43a5 | merge of the picks: 506dbd3 (<- bf0ee4c) the phone and keyboard check for geo-demo and game-tv; e52d8d4 (<- e11029b) the switches test; c05bdd2 (<- b3d7221) the public pages check and report; c9df92f, 0b53f40 (<- 1a16bd8, 181f22e) the page weight tool and report; 894fbdd (<- e652319) the connector abuse tests; f32d7f2 (<- 95d94e3) the round 1-3 report |
| 99037d6 | the source-hygiene escape (above) |
| cf0c70d | this file |
| (next) | the one-command pre-merge check, its test, and this section |

### `cloud-site-features-1103` (main line, oldest first)

| Commit | What |
|---|---|
| 5dd5f13 | merge of cloud-site-1102 up to ed165a2: the coverage map and must-fail tests it builds on, the **folder fix** (df0b48b failing test, 10fcab2 fix), and **the Games phone page** (ed165a2) |
| 484ce6a | merge of the picks: e147934, 3e69795 (<- 88762f3, 4820eef) the **keyboard focus fix**; 629df56, abe7eae (<- 72cffe2, ca8cf10) the **sign-up guess-limit fix**; e12795c, d7be64e (<- 18f9cc3, d97c113) the **dataset_info fix** |
| d43783d | this file |
| (next) | this file, with the pre-merge check section |

Not on either train: the three round reports' older versions (e6569a1, a8c92a4). The tests train carries the final one (f32d7f2).

## Exact test commands and results (run on 11-03 in the cloud box, Node 22.23.4)

Once per fresh checkout: `npm ci`. The SQL tests use a throwaway local Postgres, the same setup as every file in supabase/tests (`pgvenv/Scripts/python -m unittest ...` on Ryan's PC).

### On `cloud-site-tests-1103`

| Command | Result |
|---|---|
| `npm test` | 1478 tests: **1466 pass, 0 fail**, 12 skipped |
| `node tools/check-public-pages.mjs` | 24 pages, **0 hard findings**, 5 warnings (listed below for Ryan) |
| `node tools/check-phone-keyboard-pass.mjs` | 45 states, **0 failures** |
| `python -m unittest supabase/tests/test_connect.py` | 66 OK (existing suite, unchanged) |
| `python -m unittest supabase/tests/test_connect_oauth_mustfail.py` | 13 OK |
| `python -m unittest supabase/tests/test_invite_signup_mustfail.py` | 10 OK |
| `python -m unittest supabase/tests/test_connect_abuse.py` | 4 OK |
| `python -m unittest supabase/tests/test_invites.py` | 7 OK (existing) |

### On `cloud-site-features-1103`

This train does not carry the `npm test` fix, so run `node --test` (with no argument) here.

| Command | Result |
|---|---|
| `node --test` | 1485 tests: **1473 pass, 0 fail**, 12 skipped |
| `node tools/check-game-phone.mjs` | 27 screens (phone 320/375 and desktop, keyboard only), **0 failures** |
| `node tools/audit-a11y-switched.mjs` | 16 page views (live editor, My films, intake, tester wizard, admin tester computers, worker health), **0 findings** |
| `node tools/build-maker-live.mjs --check` | ok (the desktop maker's copy matches the site's editor) |
| `node tests/connect_mutants.mjs` | all 37 mutants caught |
| `node tests/connect_request_mutants.mjs` | all 16 mutants caught |
| `node tests/connect_dataset_info_mutants.mjs` | all 13 mutants caught |

### Both trains merged together (local check only, not pushed)

| Command | Result |
|---|---|
| `npm test` | 1503 tests: **1491 pass, 0 fail**, 12 skipped |
| `node tools/check-public-pages.mjs` | 25 pages (with /game-phone/), 0 hard findings |

## The one-command pre-merge check (on `cloud-site-tests-1103`)

```
node tools/pre-merge-check.mjs
```

It runs these in order and prints one PASS / FAIL / SKIP table. It exits 0 only if nothing failed, and it makes no network call, touches no database and deploys nothing.
1. The node tests: every `tests/*.test.mjs` and `*.test.cjs`, found by itself.
2. Both public-pages audits: `tools/check-public-pages.mjs` and `tools/audit-public-pages.py` (Python, standard library only).
3. Every browser page check the branch has (`check-phone-keyboard-pass`, `check-game-phone`, `audit-a11y-switched`; SKIP if Playwright is missing), and the maker copy check (`build-maker-live.mjs --check`).
4. Every connector mutant runner, `tests/connect_*mutants.mjs` (13 today; a new one is picked up automatically).

Options:
- `--quick`: the node tests and the public-pages audits only (about 15 s).
- `--sql <python>`: also the connector and invite SQL suites, with a Python that has pgserver and psycopg (on Ryan's PC: `--sql pgvenv/Scripts/python`).

`tests/pre-merge-check.test.mjs` checks that it finds every test file and every mutant runner, reads the node totals right, and calls a run FAIL when any step fails.

Results (11-03):

| Tree | Steps | Result |
|---|---|---|
| `cloud-site-tests-1103` (with `--sql`) | 23: node tests 1466 pass; both public-pages audits; the keyboard/phone pass; the maker check; 13 mutant runners (229 mutants, all caught); 5 SQL suites (100 tests) | **PASS**, about 3 minutes |
| `cloud-site-features-1103` (tool copied in to measure, not committed there; with `--sql`) | 20: node tests 1473 pass; audit-public-pages.py; the game-phone walk; the switched-pages audit (about 2 minutes on its own); the maker check; 13 mutant runners; 2 SQL suites | **PASS** |
| both trains merged (local only, with `--sql`) | 25: node tests 1491 pass; everything above together | **PASS** |
| a planted failing test | node tests: 1 fail | **FAIL**, exit 1 |
| a planted broken link on privacy-policy.html | both public-pages audits and the node page tests | **FAIL** |

## Every behaviour change (all on `cloud-site-features-1103`)

1. **The dataset_info words** (`supabase/functions/connect-core/tools.ts`). A measure with an empty role or kind no longer prints an empty field: "(per 100k, , rate)" becomes "(per 100k, rate)". The engine's record and the structured result are unchanged. Live only after `connect` is redeployed.
2. **Folder names in set_compilation_request** (same file). A folder that is "." or ".." once its spaces are trimmed is now refused in words, and nothing is saved. Before, " .." was saved as "..". Live only after `connect` is redeployed.
3. **The sign-up guess limit** (`supabase/functions/redeem-invite/redeem.ts`). The address used to count guesses is now the platform's own (cf-connecting-ip), else the LAST X-Forwarded-For hop; it used to be the FIRST, which the visitor writes. A visitor who never forges the header sees no difference. Live only after `redeem-invite` is redeployed. Check once on the real project which header arrives, as for creator-beta (supabase/README.md, "Creator beta").
4. **The keyboard's place in two switched-off pages:**
   - Files: `assets/app-editor.js`, `assets/app-tester-wizard.js`, `?v=20261103a` in `app/index.html` with its pairs in `tests/asset-versions.json`, and `tools/maker-live/live.js` (the desktop maker's copy, rebuilt from the site's file).
   - The live editor (`liveEditor`, OFF) and the tester wizard (`testerWizard`, OFF) now keep focus on the control you pressed (or its row, or its panel heading) when they redraw. Before, focus fell to the top of the page, and on the wizard that happened every 15 seconds.
   - Nobody sees this until those switches are on, except in the desktop maker, which uses the editor's code.
5. **The Games phone page** (new: `game-phone/index.html`, `assets/game-phone.js`, `assets/game-phone.css`; a new switch `gamePhone: false` in `assets/ryagram-config.js`).
   - It is hidden unless the switch is on, linked from nowhere, and noindex.
   - With the switch on, only a sample room works, nothing leaves the phone, and it is text only.
   - The real room (phones talking to the host's computer) is not built.
6. **Test scaffolding only, no site change** (`tests/fake-supabase.js`): a mock `admin_worker_health`, so the worker-health section can be drawn and checked in mock mode.

**`cloud-site-tests-1103` changes no behaviour.** Its one non-test change is the `test` line in `package.json`: from `node --test tests/` (which runs **no** test file on Node 22) to `node --test "tests/*.test.mjs" "tests/*.test.cjs"`.

## The bugs (file, line on main, proof)

| # | Bug | File, line on main 4c6f48d | Proof (fails before the fix, passes after) | Train |
|---|---|---|---|---|
| 1 | " .." was saved as the folder ".." | `supabase/functions/connect-core/tools.ts` 301 (trim after the schema's "."/".." rule) | `tests/cloud-site-connect-mustfail.test.mjs`, the "MUST FAIL (bug)" case | features |
| 2 | `npm test` ran no test file | `package.json` 7 | `tests/npm-test-script.test.mjs` | tests |
| 3 | Pressing a button dropped keyboard focus (live editor, tester wizard) | `assets/app-editor.js` 598 (`paint`), `assets/app-tester-wizard.js` 66 (`draw`; also every 15 s from line 86) | `tests/cloud-site-keep-focus.test.mjs` (6) and `tools/audit-a11y-switched.mjs` (68 findings before, 0 after) | features |
| 4 | The sign-up guess limit trusted a forged address | `supabase/functions/redeem-invite/redeem.ts` 46 | `tests/redeem-invite-mustfail.test.mjs`, first case (4 forged addresses were 4 callers, now 1) | features |
| 5 | dataset_info printed an empty field, "(per 100k, , rate)" | `supabase/functions/connect-core/tools.ts` 141 | `tests/connect-dataset-info-blank.test.mjs` (13 of 117 measures) | features |

## Public wording the code does not back (for Ryan; NOT changed)

1. **Help, "My own data (spreadsheet) won't read": "Your uploaded data is always deleted once it has been used; none of it is kept."**
   - Uploads are kept by default (`dataset_retention` default 'keep').
   - Only uploads marked "Don't keep" are deleted: after the final film or 7 idle days. So are ones the person deletes, and unreadable ones after a day.
   - Even then a small record (id, fingerprint, row count) stays.
2. **Same answer: "If the file can't be read ... the file is deleted automatically."** True, but after a day, not at once.
3. **Help, the look editor: "Nothing is sent to the server and no credits are used while you try things."** True today. It stops being true when the live editor switch goes on, because each change is then saved to the server as a draft the person's AI can see.
4. **The connector's instructions that every AI reads: "Tools that cost credits say so and need confirm=true …".** No tool an AI can see takes `confirm`, and a connection cannot spend credits at all. The sentence asks the AI to do something that does not exist.
5. **Ryagram page: "Every film is checked against its data before you get it …".** This cannot be checked from this repo (the checks run on the render worker); someone with that repo should confirm it.

## Other decisions for Ryan, in plain words

**Deploys** (none were done):
1. After merging the features train, redeploy **`connect`** (fixes 1 and 5) and **`redeem-invite`** (fix 4). Tonight's connect v10 from main has neither connector fix.

**Choices:**
2. **Should an invite code work only for the email it was sent to?** Today anyone holding the code can sign up with any email. A test pins today's behaviour, so changing it is a deliberate choice.
3. **22 of the 40 admin functions would let an admin act through an AI's sign-in token**; the other 18 refuse. Ryagram's own connector cannot reach them, so this matters only if Supabase ever issues such a token for an admin. Fixing it needs a database migration. A test stops the list from growing.
4. **The site may be publishing its Markdown files as pages** (README, docs, supabase/README). There is no `.nojekyll`, robots.txt or sitemap. Open https://uselai.com/README.html: if it shows a page, adding `.nojekyll` (or a robots.txt) is the usual answer.
5. **Page weight:** every app page downloads about 234 KB of our script (gzipped), including the live editor's 65 KB while that feature is off. The suggested cuts are in docs/APP-WEIGHT-1102.md; none were made.
6. **A flood of refused connector calls** still writes one log row per call. A per-minute cap on log rows would bound it.
7. **Admin Operations** drops keyboard focus after most buttons, like the two fixed pages did. It is not behind a switch, so I left it.
8. **The 16 switches that are ON:** confirm each one is meant to be (list in docs/CLOUD-SITE-1102.md, round 2).
9. **`tools/connect_predeploy_check.mjs`** says "17 checks failed, do not deploy" on main, although the tests it names pass. It is the deploy gate, so it needs a look.
10. The status file on your PC cannot be reached from the cloud, so this file is the status.
