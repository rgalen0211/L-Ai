# Compilations: page vs BUILDER's server migration (WEB 11-27)

Pinned by `tests/compilations-server-contract-1127.test.mjs` (no database; the migration is read with `git show origin/builder-compilations-server-1127:supabase/migrations/20261127000300_compilations_for_everyone.sql`).

Everything matches: RPC names and parameter names (`p_project`, `p_request`), the selects, the six run states, the eleven error codes (+ `stale`, set only by the server, documented extra), the limits (200 / 10 folders / 80 / 500 / 32 KB), the thirteen known parts, the schema string.

The six cases where the page was looser than the migration (a `~/` path, `%NAME%` also as a folder, `$HOME`, a fullwidth slash or colon, `%2f` in a folder, the DEL character in a folder) are RESOLVED (20261127c7): `PLACE` and `NAME` in `assets/app-compilations.js` now refuse exactly what the migration refuses, with the same plain sentences, and the folders also run through the place check. No mismatch remains open. Normal names (`B-roll`, `Interviews 2`) and words with a percent sign (`100% sure`) still pass; both are tested.

The opposite direction (page stricter) is harmless and not listed, for example `a..b/` or `/foo` in the words.

Refreshed to BUILDER's a20f1a05 (000300, blob c4e48e86): 1 to 8 folders (page and server agree), the "Name 1 to 8 folders." sentence, a checklist `id` key (the page sends no checklist). One open item, NOT mirrored here because it needs an asset change (stamp pins): the server now also strips C1, U+2028/2029, variation selectors, interlinear marks and tag characters before its place check, and refuses those characters in a folder name; `INVISIBLE` and `NAME` in `assets/app-compilations.js` are narrower, so the page is looser for those characters only (the server still refuses them). The test's mirror already uses the wider list.
