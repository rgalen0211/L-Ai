# WEB merge order, 2026-11-27 (rehearsal, nothing pushed to main)

Live main = f6312e3c. Every head below was fetched, rehearsed with `git merge-tree --write-tree` (pairs) and then merged for real in a
detached worktree (`D:/Ryagram-scratch/WEB/wt-rehearsal`, never a ref). Combined rehearsal tip: **88446335** (a local detached commit,
not pushed). `node --test "tests/*.test.mjs" "tests/*.test.cjs"` on it: 2693 tests, 2676 pass, **5 fail**; the same 5 fail on web-comp-mirror-1127
alone (2607 tests, 5 fail), so they are not caused by the merges. web-push5c-1127 alone: 2531 tests, 0 fail. node_modules was a COPY of
the Documents/GitHub one (ajv and the MCP SDK are needed; without it ~76 test files fail on import, which is environmental).

The 5 pre-existing failures (all from the Compilations line; for BUILDER/WEB to look at, not a merge issue):
- tests/compilations-server-contract-1127.test.mjs "LIMITS": the page's `phrase` limit (200) is not in the migration text that the test reads.
- tests/connect-e2e-script.test.mjs, 4 subtests: the step "the app pages: each one the connector lists is a small page that loads nothing from outside" fails.

## Heads and how they stack

| Head | Tip | Sits on | vs main alone |
|---|---|---|---|
| web-push5c-1127 (includes web-push4b-1127 4f4247e5) | 240b4efb | main (a fast-forward) | clean |
| web-comp-mirror-1127 (includes web-comp-contract-1127 58307bc2, web-compstates-1127 8622d50d, web-compilations-1127 b886295e) | f14eb79a | main | clean |
| web-games-polish3-1127 (includes polish2 c0e302a1, polish 1dcf25a5, games-on-compilations-1127 a3fad37d) | c689071c | web-compilations line (base b4b98bea) | clean |
| web-depbar-walk-1127 | 3636893d | web-games-polish-1127 1dcf25a5 | clean |
| web-editor-poll2-1127 (editor chain: final, poll, poll2) | 40e2c9c7 | web-compilations-1127 (base 6a0c0249) | clean |
| web-perfectcity-polish2-1127 | f3c6ad6e | main f6312e3c | clean |

Facts that decide the order: the push line (push4b/5c) is cut from 4dbb58a9, which every other branch already contains, and it is the only
line that is a pure fast-forward of main; contract is an ancestor of mirror, 4b of 5c, polish of polish2 of polish3 and of depbar, so
merge only mirror, 5c, polish3. web-games-polish3-1127 was pushed late (c689071c, one commit over polish2: app-games.js ?v=g7).

## Recommended order

1. **web-push5c-1127** (fast-forward of main; no conflict).
2. **web-comp-mirror-1127** (whole compilations line: compilations, compstates, contract, mirror).
3. **web-games-polish3-1127** (supersedes polish2; skip polish2 as a separate merge; contains the stamp-defect fix that depbar inherits as a defect).
4. **web-depbar-walk-1127**.
5. **web-editor-poll2-1127**.
6. **web-perfectcity-polish2-1127** (last: it is the oldest-based line and touches the most shared stamps).

Any order works textually (each pair below conflicts only in stamps/lists plus two real content spots), but stamp bumps are cheapest in this order
because each step then sees one "both changed" set. Rehearsed in exactly this order (polish2 merged, then polish3 on top; the result is the same as polish3 alone).

## Resolution rule for every `?v=` conflict (the same each time)

For each stamped asset in a conflicting hunk, compare the file against the MERGE BASE on each side:
- changed on one side only: take that side's `?v=` (even if the other side's stamp looks newer; stamps from a branch that did not touch the file are stale, e.g. games side's `app-compilations.js?v=c3`, `app-editor-core.js?v=20261117b`, `free-account-line.js?v=w1`);
- changed on both sides: a NEW stamp for the merge (this rehearsal used 20261127z1..z5; any unused value works) and add its row `"<stamp>": "<sha256 of the LF-normalised file>"` to `tests/asset-versions.json` for that asset (the test only covers `app-*.js` the page loads; ryagram-config.js and app-data.js rows were added too);
- `tests/asset-versions.json`: keep the UNION of both sides' rows (never drop a pair); where one stamp name is used on both sides with different hashes (`app-compilations.js` 20261127c4: comp-mirror row vs the editor chain's row) keep the mirror's row and add the new merged stamp;
- ryagram-config.js carries ONE stamp on every page that loads it (site-consistency test): after the merge, `sed` the stamp across ALL html pages, including pages the incoming branch did not touch (root `index.html` stayed on the previous stamp after step 6 and failed the test until fixed);
- tests that assert stamps (`departments`, `signin-landing`, `trust-label`, `windows-download`, `device-landing`) follow app/index.html: set them to the final stamp; they sit next to, not inside, conflict hunks, so grep each old stamp after resolving.
- switch lists are unions: `tests/account-switch.test.mjs` (the sorted `'account'` list), `tests/switches-off.test.mjs` `ACCOUNT_SWITCHES`, and the `my_switches` mock in `tests/fake-supabase.js` (comp `?compon`, games `?gameson`, editor `?editoron`, topup `?topupon`, perfect city `?perfectcity` + its `perfect_city_places` mock).
- Generated files: after steps 1-6 `node tools/build-chat-editor.mjs --check` and `node tools/build-maker-live.mjs --check` both report ok, i.e. NO regeneration was needed (editor_page.ts, maker-live/live.js and live.css merge textually and stay correct). Run the two `--check`s anyway after the real merge; if one exits 1, run it without `--check` and commit the written file.

## Conflicts, per step (conflicting files; the rule above resolves the stamps)

1. 5c onto main: none.
2. comp-mirror onto 5c (22 files): `app/index.html` (ryagram-config t1 vs c1; app-data t1 vs c2; app-jobs p5 vs w1; app-library p5 vs c1), the 13 other pages that load ryagram-config.js (t1 vs c1), `tests/asset-versions.json`, and tests `account-switch`, `departments`, `fake-supabase.js`, `signin-landing`, `switches-off`, `trust-label`, `windows-download`. Both sides changed ryagram-config.js, app-data.js, app-library.js, app.css (and app-builder.js, same stamp both sides, no conflict): new stamp 20261127z1 for config/data/library, z1 for app.css (app.css only appears in app/index.html and trust-label, set both). app-jobs: take p5 (5c), app-device: take t1 (5c), app-departments: take c1 (mirror). Switch lists: add `compilations` to the push line's lists (keep `adminTestTopup`).
3. games (polish2/polish3) onto that (19 files): `app/index.html` (game scripts block; ryagram-config), the 13 pages, `account-switch`, `departments`, `fake-supabase.js`, `switches-off`, `asset-versions.json`. Both changed only ryagram-config.js: z2. app-departments: take games' gs; app-compilations: keep c7 (mirror), editor-core keep e1; add the 5 game scripts + app-games (polish3: g7). Lists gain `games`; mock gains `extra` for `?gameson`. polish3 onto polish2: `app/index.html` (g6 -> g7) and `asset-versions.json` (union); take g7.
4. depbar onto that (3 files): `app/index.html` (app.css c4 vs z1; app-departments d1 vs gs; app-games g5 vs g6; compilations c3 vs c7; editor-core 20261117b vs e1), `tests/departments.test.mjs`, `tests/trust-label.test.mjs`. app.css changed both sides: **z3**; departments: take **d1** (depbar only); games g6/g7 stays (depbar's g5 is the stale stamp polish2 fixes); compilations c7, editor-core e1. Update departments/trust-label to d1 and z3. (Without polish2 first, depbar re-introduces the stale games stamp.)
5. editor-poll2 onto that (3 files): `app/index.html` (app.css z3 vs e2: keep z3, the editor chain did not change app.css; app-editor.css take i1; app-editor-pro.css take h1; app-editor-core take h1; app-departments keep d1; app-compilations new **z4**), **`assets/app-compilations.js` (real content conflict, 2 hunks)**, `tests/asset-versions.json`. Content rule: keep the mirror/HEAD side in both hunks (the separate `savedNote` live region, `cut(...)`, and `role: 'status'` on each `.comp-run` row); drop the editor chain's `role: 'status', 'aria-live'` on the list and its removal of the row role, because the mirror already provides the status region and the two would announce twice. Then add the `z4` row for app-compilations.js. Needs a one-line check by WEB that the editor chain's intent (the list announced when it redraws) is still met.
6. perfectcity onto that (22 files): `app/index.html` (4 hunks: app-pages-ds.css keep w11, ADD perfect-city.css pc4; ryagram-config + app-data both changed: **z5**; free-account-line keep h2, app-jobs p5, app-templates a (the perfect city side is the stale main-era w1/w1/v3c); script block gets perfect-city-core.js a and app-perfect-city.js pc6 added; app-departments both changed: **z5**; editor-core h1; app-library keep z1), the 13 pages (z5), **`assets/app-departments.js` (real content conflict, 2 hunks: keep BOTH blocks, the compilations/games promotion and the geo_intelligence (Perfect City) promotion, and keep all three `if (id === ...)` route returns)**, `tests/asset-versions.json` (union + z5 rows for ryagram-config.js, app-data.js, app-departments.js), tests: `account-switch` (add `perfectCity`), `departments`, `fake-supabase.js` (keep the games/comp/editor/topup mock and ADD the `?perfectcity` concat and the `perfect_city_places` mock), `signin-landing`, `switches-off` (add `perfectCity`), `trust-label`, `windows-download`. Also set the root `index.html` ryagram-config stamp to z5.

Final stamps in the rehearsal's app/index.html: ryagram-config z5, app-data z5, app-departments z5, app-compilations z4, app-library z1, app.css z3, app-games g7, app-editor-core h1, app-editor.css i1, app-editor-pro.css h1, app-jobs p5, app-device t1, free-account-line h2, app-templates a, perfect-city.css pc4, app-perfect-city pc6.

## Notes

- Ran no Postgres, no live probes. pgserver lanes (`supabase/tests/test_perfect_city_*.py`) were not run here.
- The rehearsal tip 88446335 is a local detached commit; reproduce it by merging in the order above with the rules in this file.
- Pair conflicts against comp-mirror alone (for reference): games-polish2 = app/index.html + asset-versions.json; depbar = those + trust-label test; editor-poll2 = those + assets/app-compilations.js; perfectcity and push5c = 20+ files (stamps on every page).
