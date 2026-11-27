# WEB merge order, 2026-11-27 (second rehearsal, current heads; nothing pushed to main)

Live main = f6312e3c. This replaces the first version (9c56f28a), which predated the newer heads. Every head below was fetched and merged
for real, one after the other, in a detached worktree (`D:/Ryagram-scratch/WEB/wt-rehearsal2`, never a ref). The merges there are ordinary
`git merge --no-commit` runs with the resolutions below, committed locally (a local detached chain, not pushed). Combined rehearsal tip:
**886a2a73** (last commit = a one-line pin fix, see step 5). `node --test "tests/*.test.mjs" "tests/*.test.cjs"` on it: 2769 tests,
2765 pass, **4 fail**: all four are the pre-existing `tests/connect-e2e-script.test.mjs` subtests ("on the real code every step passes",
"the app steps pass on the real code and each one is a step of its own", "the live way of running...", "without a second account the step that
needs one is SKIPPED"), the same four the first rehearsal saw on web-comp-mirror alone (the step "the app pages: each one the connector lists
is a small page that loads nothing from outside"). The old fifth failure (`compilations-server-contract-1127` LIMITS) is fixed by fold2.
`tools/build-chat-editor.mjs --check` and `tools/build-maker-live.mjs --check`: both ok (no regeneration needed). node_modules was a COPY of the
Documents/GitHub one (ajv and the MCP SDK). No Postgres, no live probes; pgserver lanes (`supabase/tests/test_perfect_city_*.py`) not run.

## Heads (all fetched 11-27) and how they stack

| Head | Tip | Sits on | Note |
|---|---|---|---|
| web-push5c-1127 (includes web-push4b-1127 4f4247e5) | 240b4efb | main (fast-forward) | 33 commits over main |
| web-comp-fold2-1127 | 33389560 | main; contains contract/mirror/fold (f14eb79a, 3919beca) and compstates | the whole Compilations line |
| games-on-compfold-1127 (GAMES) | 2b139c5a | merge of games-live-1127 (709796cf) into fold 3919beca | contains the whole Games line incl. signed rooms; NOT fold2's 33389560 |
| web-games-polish3-1127 (WEB) | c689071c | older Compilations line (games-live f4c03dc6, polish, polish2) | does NOT contain 709796cf (signed rooms) |
| web-depbar3-1127 | f574362c | polish3 (c689071c) plus web-signedout-walk-1127 | contains polish3 |
| web-editor-poll2-1127 | 40e2c9c7 | web-compilations-1127 (base 6a0c0249) | gated off by default (switch `editoron`) |
| geo-perfect-city-1127 (GEO) | 0576502f | main | GEO's fold of its whole Perfect City line; web-perfectcity-polish2-1127 (f3c6ad6e) is NOT an ancestor of it, so use GEO's head and skip polish2 |
| web-backlink-1127, web-editor-textlegend-1127 | not pushed | | not in this order; they slot in after step 6 when pushed (editor-textlegend: stamps on the editor files as in step 6) |

### Games: which head carries what, and the right Games row now

- **games-on-compfold-1127 carries** the Games department on the new Compilations head and everything GAMES built through 709796cf: the
  signed room messages and host key bound to the room code (`Room.keyPair`/`Room.codeOf` in app-games.js, game-room.js g4, tools/game-relay.mjs),
  Fill the gap mode, rejoin, answer-leak test, the a11y audit fixes, 8-player fixes. It also already folds WEB's first host polish (1dcf25a5:
  no room code or Start until the room is open, Try again button) in its own `failed` helper.
- **web-games-polish3-1127 carries**, beyond that, only the last two polish commits: c0e302a1 (stamp g6) and c689071c (the failure is
  announced with the role set BEFORE the words; the words say "Try again", not "Reload"; a test, `OPENING ROOM`, in tests/games-live-1127.test.mjs;
  stamp g7). It lacks the signed rooms and sits on an older Compilations line.
- **Right Games row now: games-on-compfold-1127 (step 3), then web-games-polish3-1127 on top (step 4) for those two commits.** Do not take
  polish3 alone (it would drop signed rooms) and do not skip it (the announcement fix and its test would be lost). Step 4 below is that
  merge; it has one real content conflict. Cleaner alternative if GAMES agrees: GAMES cherry-picks c689071c onto games-on-compfold-1127 and WEB drops polish3
  (the same two edits plus the test-mock fix in step 4); the final tree is identical.

## Recommended order

1. **web-push5c-1127** (fast-forward of main; no conflict).
2. **web-comp-fold2-1127** (Compilations line).
3. **games-on-compfold-1127** (Games on the fold).
4. **web-games-polish3-1127** (host-failure announcement; supersedes polish/polish2).
5. **web-depbar3-1127** (contains polish3, so it only adds the depbar and signed-out walk).
6. **web-editor-poll2-1127**.
7. **geo-perfect-city-1127** (last: oldest base, touches the most shared stamps, and two real content spots).

Fold2 and games-on-compfold: games-on-compfold is cut from fold 3919beca, fold2 is 33389560 on top of it, so step 3 merges cleanly in
content (see the conflicts below: stamps and lists only), and fold2's newer c9 files win.

## Resolution rule for every `?v=` conflict (the same each time)

For each stamped asset compare the file against the MERGE BASE on each side (`git diff $(git merge-base HEAD <head>) <side> -- assets/<file>`):
- changed on one side only: take that side's `?v=` (a stamp from a branch that did not touch the file is stale);
- changed on both sides: a NEW stamp and a row `"<stamp>": "<sha256 of the LF-normalised file>"` in `tests/asset-versions.json` (the test covers `app-*.js` the page loads; ryagram-config.js rows were added too);
- `tests/asset-versions.json`: take the UNION of both sides' rows (parse stage 2 and 3, `setdefault`; never drop a pair), then add the new rows; `json.dumps(indent=1)` round-trips the file byte for byte;
- ryagram-config.js carries ONE stamp on every page that loads it (site-consistency test): after each merge set the new stamp across ALL html pages (root `index.html` is not in the conflict list in steps 3..7 but must follow);
- tests that assert stamps (`departments`, `signin-landing`, `trust-label`, `windows-download`, and `signed-out-departments-1127`, which pins `app.css`) follow app/index.html: after resolving, grep each old stamp in tests/ (the signed-out one sits outside every conflict hunk and failed `TAP TARGETS` until fixed);
- do not restamp `app.css` globally: `preview-demo/index.html` and `tests/preview-offline.test.mjs` carry their own `app.css?v=20261023a`/`20261011a`; restrict to app/index.html + the tests that pin it;
- switch lists are unions: `tests/account-switch.test.mjs` (sorted `'account'` list), `tests/switches-off.test.mjs` `ACCOUNT_SWITCHES`, and the `my_switches` mock in `tests/fake-supabase.js` (final line below);
- generated files (editor_page.ts, maker-live/live.js/live.css) merged textually and stayed correct: both `--check`s print ok; run them again after the real merge and regenerate only if one exits 1.

Final `my_switches` mock line in tests/fake-supabase.js (all sources): `noswitches ? [] : (compon ? ['myFilms','compilations', ...extra] : editoron ? ['myFilms','liveEditor', ...extra] : ['myFilms', ...extra]).concat(topupon ? ['adminTestTopup'] : []).concat(perfectcity ? ['perfectCity'] : [])`, with `const extra = gameson ? ['games'] : []` above it, then GEO's `perfect_city_places` mock after the `},`.

## Conflicts, per step

1. push5c onto main: none.
2. **fold2 onto 5c** (22 files; same set as before): `app/index.html` (ryagram-config t1 vs c1; app-data t1 vs c2; app-jobs p5 vs w1; app-library p5 vs c1), the 13 other pages that load ryagram-config.js, `tests/asset-versions.json`, tests `account-switch`, `departments`, `fake-supabase.js`, `signin-landing`, `switches-off`, `trust-label`, `windows-download`. Both sides changed ryagram-config.js, app-data.js, app-library.js, app.css: new stamp **z1** for those four (app.css z1 only in app/index.html and trust-label); app-jobs p5 (5c), app-device t1 (5c), app-departments c9 and app-compilations c9 (fold2 only). Lists gain `compilations` (keep `adminTestTopup`); mock gains `compon` branch plus the topupon concat.
3. **games-on-compfold onto that** (19 files): `app/index.html` (config gf vs z1; the game scripts block), the 13 pages, `account-switch`, `departments`, `fake-supabase.js`, `switches-off`, `asset-versions.json`. Config and app-departments changed on both sides: **z2** (rows added). app-compilations: keep fold2's c9 (games side has the older c8). Take the games script block (game-score/rounds/gap-rounds g1, game-room g4, app-games g8). Lists gain `games`; mock takes GAMES' `extra` form and keeps the topupon concat.
4. **web-games-polish3 onto that** (20 files, multiple merge bases f4c03dc6 and b4b98bea): the same stamp/list files as step 3 (all resolve to HEAD: polish3's side is the stale g7/gs/c3/17b set) plus **`assets/app-games.js` (real content, 2 hunks)**. Rule: keep HEAD (GAMES' signed-room code and its honest privacy words, the `stage` comment); take polish3's wording "Try again." (HEAD said "Press Try again."); and in the `failed` helper set `role=alert` BEFORE `textContent` (c689071c). app-games.js changed on both sides: new stamp **g9** + row. Real test spot: polish3's `OPENING ROOM` test (tests/games-live-1127.test.mjs) builds a `Room` mock with only `newCode`/`connect`; with the signed-room host the mock must also have `keyPair` and `codeOf`, otherwise the host fails at once and the "not drawn while opening" check fails: the rehearsal changed the mock to `Room: { newCode, keyPair: async () => ({ pub: 'k' }), codeOf: async () => 'ABCD', connect }`. Needs a look by WEB/GAMES.
5. **web-depbar3 onto that** (4 files): `app/index.html` (app.css z1 vs c6; game scripts block: app-games g9 vs g7, departments z2 vs d1, compilations c9 vs c3, editor-core e1 vs 17b, game-room g4 vs g2), `tests/departments`, `tests/trust-label`, `asset-versions.json`. app.css and app-departments.js changed on both sides: **z3** (rows: app-departments z3). app-games stays g9; game-room g4; compilations c9; editor-core e1. Not in the conflict list but must be fixed: `tests/signed-out-departments-1127.test.mjs` pins `app.css?v=20261127c6` -> z3 (that is the last commit 886a2a73).
6. **web-editor-poll2 onto that** (3 files): `app/index.html` (css block: keep app.css z3, take editor i1 and editor-pro h1; script block: keep the game scripts and departments z3, editor-core h1, compilations new **z4**), **`assets/app-compilations.js` (real content, 2 hunks)**, `asset-versions.json` (z4 row for app-compilations.js). Content rule unchanged from the first rehearsal: keep HEAD (fold2) in both hunks (separate `savedNote` live region, `cut(...)`, `role: 'status'` on each `.comp-run`), drop the editor chain's `role: 'status', 'aria-live'` on the list; the status region exists already, two would announce twice. A one-line check by WEB that the editor chain's intent (list announced when redrawn) is met is still wanted. The editor line stays gated off by default.
7. **geo-perfect-city onto that** (24 files, base main): `app/index.html` (4 hunks), **`assets/app-departments.js` (real content, 3 hunks)**, the 13 pages, `account-switch`, `departments`, `fake-supabase.js`, `signin-landing`, `switches-off`, `trust-label`, `windows-download`, `asset-versions.json`, and **two new ones**: `supabase/functions/connect-core/home_panel.ts` and `tests/home-panel-departments.json`. Details:
   - app/index.html: keep HEAD for app.css z3, editor i1/h1, app-pages-ds w11, app-games.css g2, free-account-line h2, app-jobs p5, app-templates a, app-library z1, app-editor-core h1, compilations z4, the game scripts; take GEO's `app-site.css?v=20261127pcf1` (GEO is the only side that changed it); ADD `perfect-city.css pcf1`, `perfect-city-core.js pcf2`, `app-perfect-city.js pcf2`. Config, app-data and app-departments changed on both sides: **z5** (rows added; config z5 also on all 14 html pages incl. root `index.html`, geo-demo).
   - app-departments.js hunk 1: the compilations line from HEAD (no "Soon it will turn your clips into songs, too." sentence: fold2 removed it) and the whole `geo_intelligence` entry from GEO (`page: true`, `sentence`, the Ohio-counties line, plus its comment). Hunk 2: keep BOTH the compilations/games promotion and GEO's perfectCity block. Hunk 3: keep all three route returns (compilations, games, geo_intelligence).
   - home_panel.ts and tests/home-panel-departments.json: compilations line from HEAD (no songs sentence), `geo_intelligence` line from GEO ("...in two Ohio counties for now..."). The departments.js and home_panel lines for geo then agree.
   - Lists: `account-switch` gains `perfectCity` (sorted: ... 'myFilms', 'perfectCity', 'testerFilmProgress' ...); `switches-off` appends `'perfectCity'`; fake-supabase: the final line above plus GEO's `perfect_city_places` mock.
   - Tests asserting stamps follow app/index.html: app-data z5/departments z5 (the final app-departments stamp is z5 everywhere, app-library z1, app.css z3, device t1).

Final stamps in the rehearsal's app/index.html: ryagram-config z5, app-data z5, app-departments z5, app-compilations z4, app-library z1, app.css z3, app-games g9, game-room g4, app-editor-core h1, app-editor.css i1, app-editor-pro.css h1, app-jobs p5, app-device t1, free-account-line h2, app-templates a, app-site.css pcf1, perfect-city.css pcf1, perfect-city-core pcf2, app-perfect-city pcf2.

## Notes

- Differences from the first rehearsal (9c56f28a): fold2 replaces comp-mirror (and fixes the LIMITS test); the Games row is now games-on-compfold then polish3 (signed rooms kept); depbar3 and the signed-out walk replace depbar-walk; GEO's geo-perfect-city-1127 replaces web-perfectcity-polish2 and adds two files to the step-7 conflicts (home_panel.ts, home-panel-departments.json).
- Resolution scripts (Python, stamp setter and JSON-union helper) are in `D:/Ryagram-scratch/WEB/mo2/` (mo.py, s2.py..s7.py); they are not part of the repo.
- Pair conflicts against main alone were not re-run; each step above is against the combined result of the steps before it.
