# Compilations: page vs BUILDER's server migration (WEB 11-27)

Pinned by `tests/compilations-server-contract-1127.test.mjs` (no database; the migration is read with `git show origin/builder-compilations-server-1127:supabase/migrations/20261127000300_compilations_for_everyone.sql`). The page was NOT edited. Each row is a todo test in that file.

Everything else matches: RPC names and parameter names (`p_project`, `p_request`), the selects, the six run states, the eleven error codes (+ `stale`, set only by the server, documented extra), the limits (200 / 10 folders / 80 / 500 / 32 KB), the thirteen known parts, the schema string.

The one kind of disagreement: the page is LOOSER than the migration, so the save reaches the server and comes back refused with the server's sentence (never a wrong accept). The server's value check is at SQL line 57; its folder-name check is at SQL line 78. The page checks the words and the note with `PLACE` (`assets/app-compilations.js:11`, used at :31) and the folders with `NAME` only (:9, used at :35).

| # | Input the page accepts | Server refuses (SQL line) | Page side |
|---|---|---|---|
| 1 | words or note holding `~/Videos` (home path) | 57, `(^|\s)~[a-z0-9_]*[/\]` | :11 / :31 has no `~` rule |
| 2 | words, note or a folder holding `%USERPROFILE%` / `%TEMP%` | 57, `%[a-z_]+%` | :31 does not cover; :35 folders only run `NAME` |
| 3 | words or note holding `$HOME` | 57, `\$home\y` | :11 |
| 4 | a fullwidth slash or colon (U+FF0F, U+FF3C, U+2215, U+FF1A) in words, note or a folder | 57 | :9, :11 |
| 5 | a folder named like `a%2fb` (percent-encoded slash, backslash or colon) | 57, `%2f|%5c|%3a` | :35 |
| 6 | a folder holding the DEL character (U+007F) | 78, `[:cntrl:]` | :9 (`NAME` stops at U+001F) |

The opposite direction (page stricter) is harmless and not listed, for example `a..b/` or `/foo` in the words.
Suggested page fix, when Ryan says so: run the folders through `PLACE` too, and add `~`, `%name%`, `$HOME`, percent-encoded separators, the four fullwidth characters and U+007F to the two regexes.
