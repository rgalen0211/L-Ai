# Ryan's short server sitting: 7 pastes instead of about 60 (GEO, Wed 11-25)

Same steps, same order, same Tuesday commit eca5cf8b8ddd3d48ce07025de1002c26b88f007d as LAUNCH-LIVE-STEPS-1121.md section 00 steps 1 to 4a. Nothing is new: the SQL pastes are the reviewed migration and check files, joined; each ends in ONE line that says PASS or STOP. Resend = A, so step 3c is SKIPPED. Q673 check 1 row 6 is FALSE, so the buying lock is only a look for stripe-checkout. About 30 minutes of your time; the 3b after-check (live step 56) is a look later in the day and blocks nothing.

**How to copy a file:** in PowerShell, `Get-Content C:\Users\Ryan\Documents\GitHub\L-Ai\supabase\live-steps\<file> -Raw | Set-Clipboard`, then paste (Ctrl+V). SQL files go into the Supabase SQL Editor and you click Run; the two .ps1 files go into the PowerShell window and you press Enter (this PC does not run .ps1 files directly, so paste them).

| # | What | Where | PASS line | About |
|---|---|---|---|---|
| before 0 | Open status.supabase.com (CC1 08:15 item 4). GEO also reads it right before you start and posts what it says | browser | 'All Systems Operational', or nothing listed for Database, Edge Functions or the SQL Editor. Otherwise wait and tell GEO | 1 min |
| 0 | `git -C C:\Users\Ryan\Documents\GitHub\L-Ai fetch`, then `git -C C:\Users\Ryan\Documents\GitHub\L-Ai checkout eca5cf8b8ddd3d48ce07025de1002c26b88f007d`, then `git -C C:\Users\Ryan\Documents\GitHub\L-Ai rev-parse HEAD` | PowerShell | prints eca5cf8b8ddd3d48ce07025de1002c26b88f007d | 1 min |
| 1 | sitting_1_before.sql: every BEFORE check (Q634, steps 41 42 43 44 35 46 51 61 63), read-only | SQL Editor | first row `PASS: every BEFORE check is as the paper says` | 2 min |
| 2 | sitting_2_apply.sql: A1 to A19, the migration files byte for byte, in order. CHANGES the database. Run it ONCE | SQL Editor | `PASS: A1 to A19 applied; now paste 3` | 3 min |
| 3 | sitting_3_after.sql: every AFTER check of A1 to A19 incl. step 63 after, read-only | SQL Editor | ONE row `PASS: A1 to A19 are all applied and every AFTER row is true` | 2 min |
| 4 | sitting_4_deploys.ps1: purge secrets made and set (never printed), then 8 deploys with --no-verify-jwt (delete-account, ai-editor, film-page, ops-tick, connect, purge-uploads, purge-partial-uploads, guided-builder), then the buying-lock look | PowerShell | green `PASS: 8 functions deployed ...`; and one BUYING LOCK line: if it is yellow, delete stripe-checkout in Dashboard > Edge Functions | 8 min |
| 4b | 3b P3 part 2: Dashboard > Integrations > Vault > Add secret, twice: name `cron_purge_uploads` = the value after `PURGE_UPLOADS_SECRET=` in `$HOME\purge-secrets.env` (open it in Notepad), name `cron_purge_partial` = the value after `PURGE_PARTIAL_SECRET=`. Then `Remove-Item "$HOME\purge-secrets.env"` | Dashboard | both names listed in Vault | 4 min |
| 4c | live-steps/54_purge_jobs_before_check.sql, then live-steps/55_purge_jobs_schedule.sql | SQL Editor | 54: rows 1 to 5 true; 55: two rows, `purge-partial-uploads 30 * * * *` active and `purge-uploads 0 * * * *` active | 3 min |
| 5 | sitting_5_push.ps1: writes down origin/main (the undo target), pushes L-Ai main to the Tuesday commit (never forced), checks it, deploys redeem-invite with --no-verify-jwt | PowerShell | green `PASS: L-Ai main is eca5cf8b... and redeem-invite is deployed`; then the live /app/ page loads and signs in | 3 min |
| later | live-steps/56_purge_jobs_after_check.sql, a few minutes past the next :00 AND :30 | SQL Editor | all seven rows true | 1 min |

**If the SQL Editor refuses paste 2 as too long (it then ran nothing):** paste sitting_2a_apply_half.sql (A1 to A10, PASS line `PASS: A1 to A10 applied; now paste 2b`), then sitting_2b_apply_half.sql (A11 to A19, `PASS: A11 to A19 applied; now paste 3`), then paste 3 as above.

**On any STOP or error: stop there and send GEO the result rows (or the red lines).** Never run paste 2 a second time: each migration keeps its own begin and commit, so on an error the ones before it ARE applied and nothing after it ran; paste 3 then names the first step that is missing, and GEO gives you the rest one file at a time. Undo of anything: LAUNCH-LIVE-STEPS-1121.md section 3a, unchanged.

**What the pastes cover, one for one with the paper:** step 1 = pastes 1 to 3 (A1 to A19 with every BEFORE and AFTER check the paper names, step 63 before and after A19); step 2 + 3b P1 = block 4's deploys; step 3 (row 6 false) = block 4's look; 3b P2 + P3 part 1 = block 4's first lines; 3b P3 part 2 = 4b; 3b P4 + P5 = 4c; step 4 + 4a = block 5; 3b P6 = 'later'.

**Proof (supabase/tests/test_geo_sitting_batches.py, a throwaway local Postgres built like live before the sitting: every migration except A1 to A19, then the credits ledger):** paste 1 says PASS; paste 2 says PASS; paste 3 says PASS with every row; paste 1 run again then says STOP; must-fail 1: A9 left out, paste 3 says STOP and names A9 first; must-fail 2: an error planted in A7, paste 2 raises, A1 to A6 stay applied, nothing after runs, paste 3 names A7 first. The three SQL files are checked to be exactly what sitting_build.py writes.

**Where the BEFORE vectors differ from the paper's words, and why (the files changed after the paper was written):** step 46 has 8 rows, not 7 (row 5 is join_daily_max, made by A13, so false before); step 51 has 6 rows, not 5 (its own header: rows 2, 3 and 5 false before).
