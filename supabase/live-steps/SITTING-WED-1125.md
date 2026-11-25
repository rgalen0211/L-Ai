# Ryan's short server sitting: 7 pastes instead of about 60 (GEO, Wed 11-25)

Same steps, same order, same Tuesday commit as LAUNCH-LIVE-STEPS-1121.md section 00 steps 1 to 4a; nothing new. In plain words:
- The SQL pastes are the reviewed files, joined.
- The old payment function is only looked at; if it is there, you delete it.
- Sign-up mail goes through Resend's free plan, so the alert-cap step (3c) is skipped.
- One read-only check (step 56) is left for later today; it blocks nothing.

**How long, honestly (CC1 12:39):** about 40 minutes from step 0 to the end of block 5 if nothing stops. That is about 30 minutes of copying, pasting and reading, plus about 10 minutes of waiting, mostly the 8 deploys in block 4. The 1 h 45 min in GEO's 06:51 post was the OLD order, about 60 pastes; it is not this card. WORKER's item 5 (about 10 minutes) comes after, then step 56 later.

**One rule for every SQL paste:** read the TOP row of the result. It starts with `PASS` = go on to the next row of this table. It starts with `STOP` = stop there (see 'On a STOP or an error' below). The Editor may show a box about a query that changes data: for paste 2 and 4c, click **Run this query**.

**How to send GEO a result:** type or paste it into GEO's window (this Claude session), as you did at 07:22. GEO answers there with the next step or the fix.

**Two folders (CC1 08:40):**
- Your L-Ai folder stays on the Tuesday commit, clean. The deploys and the push run from it.
- The sitting files live only on GEO's branch, so step 0b puts them in a SECOND folder, C:\Users\Ryan\Documents\GitHub\L-Ai-sitting-1125. Every copy below reads from that folder.

**How to copy a file:** in PowerShell, `Get-Content C:\Users\Ryan\Documents\GitHub\L-Ai-sitting-1125\supabase\live-steps\<file> -Raw | Set-Clipboard`, then paste with Ctrl+V.
- SQL files go into the Supabase SQL Editor; click Run.
- The two .ps1 files go into the PowerShell window; press Enter. This PC does not run .ps1 files directly, so paste them.

**Type only the commits shown in the commands.** The card names others (16bf8979 is this card, eca5cf8b the Tuesday commit); never type those anywhere else.

| # | What | Where | PASS line | About |
|---|---|---|---|---|
| before 0 | Open status.supabase.com (CC1 08:15 item 4). GEO also reads it right before you start and posts what it says | browser | 'All Systems Operational', or nothing listed for Database, Edge Functions or the SQL Editor. If something is listed: wait 15 minutes, look again, and tell GEO; do not start while it is listed | 1 min |
| 0 | `git -C C:\Users\Ryan\Documents\GitHub\L-Ai fetch`, then `git -C C:\Users\Ryan\Documents\GitHub\L-Ai checkout eca5cf8b8ddd3d48ce07025de1002c26b88f007d`, then `git -C C:\Users\Ryan\Documents\GitHub\L-Ai rev-parse HEAD`. The checkout prints a long 'detached HEAD' message: that is normal. If it REFUSES because files would be overwritten, send GEO the message and never force it | PowerShell | the last command prints eca5cf8b8ddd3d48ce07025de1002c26b88f007d | 1 min |
| 0b | `git -C C:\Users\Ryan\Documents\GitHub\L-Ai worktree add --detach C:\Users\Ryan\Documents\GitHub\L-Ai-sitting-1125 7e61a005a10f4bee3e0f6e44ce009002e7f9c34d`, then `git -C C:\Users\Ryan\Documents\GitHub\L-Ai-sitting-1125 rev-parse HEAD`. If git says it does not know the commit, run `git -C C:\Users\Ryan\Documents\GitHub\L-Ai fetch` and try again | PowerShell | prints 7e61a005a10f4bee3e0f6e44ce009002e7f9c34d (the commit both proofs ran; every paste in it is the one proven). Then `git -C C:\Users\Ryan\Documents\GitHub\L-Ai status --porcelain` prints nothing | 1 min |
| 1 | sitting_1_before.sql: every BEFORE check, read-only | SQL Editor | top row `PASS: every BEFORE check is as expected` | 2 min |
| 2 | sitting_2_apply.sql: A1 to A19, the migration files byte for byte, in order. CHANGES the database. Run it ONCE | SQL Editor | top row `PASS: A1 to A19 applied; now paste 3` | 3 min |
| 3 | sitting_3_after.sql: every AFTER check of A1 to A19 (incl. step 63 after), read-only | SQL Editor | top row `PASS: A1 to A19 are all applied and every AFTER row is true` | 2 min |
| 4 | sitting_4_deploys.ps1: makes and sets the two purge secrets (never printed), deploys 8 functions with --no-verify-jwt (delete-account, ai-editor, film-page, ops-tick, connect, purge-uploads, purge-partial-uploads, guided-builder), then looks for the old payment function | PowerShell | the last green line starts `PASS: 8 functions deployed`, and one BUYING LOCK line. If that line is yellow: Dashboard > Edge Functions > stripe-checkout > Delete function | 8 min |
| 4b | Dashboard > Integrations > Vault > Add secret, twice. First open the file: `notepad C:\Users\Ryan\purge-secrets.env`. Secret 1: name `cron_purge_uploads`, value = everything AFTER `PURGE_UPLOADS_SECRET=` on its line (64 letters and digits; no quotes, no spaces, not the equals sign). Secret 2: name `cron_purge_partial`, value = everything after `PURGE_PARTIAL_SECRET=`. Close Notepad, then `Remove-Item C:\Users\Ryan\purge-secrets.env` | Dashboard | both names listed in Vault | 4 min |
| 4c | live-steps/54_purge_jobs_before_check.sql, then live-steps/55_purge_jobs_schedule.sql, both from the L-Ai-sitting-1125 folder | SQL Editor | 54: rows 1 to 5 true. 55 (click Run this query): two rows, `purge-partial-uploads 30 * * * *` active and `purge-uploads 0 * * * *` active | 3 min |
| 5 | sitting_5_push.ps1: writes down origin/main (the undo target), pushes L-Ai main to the Tuesday commit (never forced), checks it, deploys redeem-invite with --no-verify-jwt | PowerShell | the last green line starts `PASS: L-Ai main is eca5cf8b`; then the live /app/ page loads and you can sign in | 3 min |
| later | live-steps/56_purge_jobs_after_check.sql from the L-Ai-sitting-1125 folder. Run it ONCE, at a time when both a :00 and a :30 have passed since 4c (so at most about 65 minutes after 4c) | SQL Editor | all seven rows true. If rows 6 or 7 are false, run it again after the next :00 or :30 and send GEO the grid if still false | 1 min |
| last | `git -C C:\Users\Ryan\Documents\GitHub\L-Ai worktree remove C:\Users\Ryan\Documents\GitHub\L-Ai-sitting-1125` after step 56 is all true. It is safe to leave the folder until tomorrow; it holds only the branch's own files | PowerShell | no output; `git -C C:\Users\Ryan\Documents\GitHub\L-Ai worktree list` no longer shows it | 1 min |

**If the SQL Editor refuses paste 2 as too long (it then ran nothing):** paste sitting_2a_apply_half.sql (A1 to A10, top row `PASS: A1 to A10 applied; now paste 2b`), then sitting_2b_apply_half.sql (A11 to A19, top row `PASS: A11 to A19 applied; now paste 3`), then paste 3 as above.

**On a STOP or an error, by step (send GEO the rows or the red lines each time):**
- **Paste 1 says STOP:** NOTHING has changed (it only reads). Stop and send the rows.
- **Paste 2 shows an error:** run `rollback;` ALONE in the SQL Editor, then paste 3, and send both results. NEVER run paste 2 again. Each migration keeps its own begin and commit, so the ones before the error ARE applied and nothing after it ran. Paste 3 names the first step missing, and GEO gives you the rest one file at a time. (`rollback;` first, because the failed file's begin can leave the Editor's session stuck; BUILDER 08:39.)
- **Paste 3 says STOP:** do NOT run paste 2 again. Send the rows.
- **Block 4 shows a red STOP:** fix what it names, then running block 4 again is SAFE only BEFORE step 4b (the secrets file is still there, so it reuses the same two secrets, and a deploy again is harmless). After 4b has deleted that file, do NOT run block 4 again: it would make NEW secrets that differ from the two in Vault. Ask GEO.
- **Block 5 shows a red STOP:**
  - If it says the push was REFUSED: do not run it again; tell CC1.
  - If the push IS done and only redeem-invite failed: running block 5 again is SAFE. The push of the same commit then says 'Everything up-to-date', and the deploy runs again.

Undo of anything: LAUNCH-LIVE-STEPS-1121.md section 3a, unchanged.

**If a function misbehaves after block 4 or 5: put the old one back** (ENGINE proposals/ENGINE-FUNCTION-UNDO-1125.md, checked by GEO in git, following every file each function imports).
- Redeploy ONLY the function that misbehaves, from a clean folder of ITS undo commit in the table below, never from your Wednesday folder.
- For **connect**, ask CC1 first and do not guess.
- In PowerShell (use npx.cmd, not npx: this PC refuses npx's .ps1), with `<commit>` = that function's row below:
  `git -C C:\Users\Ryan\Documents\GitHub\L-Ai worktree add C:\Users\Ryan\Documents\GitHub\L-Ai-undo-1125 <commit>`, then `Set-Location C:\Users\Ryan\Documents\GitHub\L-Ai-undo-1125`, then `npx.cmd supabase functions deploy <name> --project-ref jxtkfishqfxuptwjzczz --no-verify-jwt`.
- That folder is made ONLY if an undo is needed. When the undo is done: `Set-Location C:\Users\Ryan\Documents\GitHub\L-Ai`, then `git -C C:\Users\Ryan\Documents\GitHub\L-Ai worktree remove C:\Users\Ryan\Documents\GitHub\L-Ai-undo-1125`. Check: `git -C C:\Users\Ryan\Documents\GitHub\L-Ai worktree list` no longer shows it.

| Function | Undo commit | How sure (GEO's git check) |
|---|---|---|
| redeem-invite, join, stripe-checkout, stripe-webhook | 6a07e0dd | CERTAIN: the function and every file it imports are byte-identical in 6a07e0dd and live main e947f26a, so whatever day it was deployed from main, this is it |
| delete-account, film-page, ops-tick, purge-uploads | 6a07e0dd | CERTAIN, same reason (not in ENGINE's table; GEO checked) |
| purge-partial-uploads | 6a07e0dd (redeploy; do NOT delete: Claude's 08:25 Dashboard snapshot shows it IS deployed, updated 1 month ago) | CERTAIN for the code |
| guided-builder | 6a07e0dd | MEDIUM (ENGINE): deployed about 11-05; 6a07e0dd is the 11-05 09:49 commit. It differs from main in TWO imported files, the catalog list AND profile.ts (ENGINE named only the catalog) |
| ai-editor | 6a07e0dd | HIGH: the 08:25 snapshot says updated 20 days ago (about 11-05). On main its code and imports changed on 11-04 21:35, 11-13 and 11-20, and not between: any deploy from main from the evening of 11-04 to 11-13 is the same bytes as 6a07e0dd. Only a deploy before 11-04 21:35 would differ |
| connect | most likely e947f26a (live main), BUT ask CC1 first and do not guess | MEDIUM: the snapshot says updated 5 days ago (11-20). Its code changed on main many times on 11-20 (03:19 to 11:17, last 7e0a0cf0) and never after, so a deploy on 11-20 after 11:17 is exactly e947f26a; one earlier that day would be an in-between commit, and only CC1 can settle which |
| stripe-checkout | if block 4 deleted it, do NOT put it back today: the old one lets any signed-in stranger pay with Stripe's test card for real credits (section 2a). Undo only if CC1 says, from 6a07e0dd; the paid launch deploys the NEW one instead | the snapshot shows it IS deployed, so block 4's yellow line will ask you to delete it (the buying lock, section 2a b) |

A function undo never undoes SQL; the SQL undos are LAUNCH-LIVE-STEPS-1121.md section 3a. Undo of the push: block 5's yellow 'origin/main was' line, and a revert commit CC1 names (never --force).

**What the pastes cover, one for one with the paper:** step 1 = pastes 1 to 3 (A1 to A19 with every BEFORE and AFTER check the paper names, step 63 before and after A19); step 2 + 3b P1 = block 4's deploys; step 3 (row 6 false) = block 4's look; 3b P2 + P3 part 1 = block 4's first lines; 3b P3 part 2 = 4b; 3b P4 + P5 = 4c; step 4 + 4a = block 5; 3b P6 = 'later'.

**Proof (supabase/tests/test_geo_sitting_batches.py, a throwaway local Postgres built like live before the sitting: every migration except A1 to A19, then the credits ledger):** paste 1 says PASS; paste 2 says PASS; paste 3 says PASS with every row; paste 1 run again then says STOP; must-fail 1: A9 left out, paste 3 says STOP and names A9 first; must-fail 2: an error planted in A7, paste 2 raises, A1 to A6 stay applied, nothing after runs, paste 3 names A7 first. The three SQL files are checked to be exactly what sitting_build.py writes.

**Where the BEFORE vectors differ from the paper's words, and why** (paste 1 runs every BEFORE check at the very start, before A1, and some check files grew after the paper was written; each was read row by row and confirmed on the live-before database): step 42 (A8): rows 1, 3 AND 4 false (row 4 tests account_redact_contact, which A5 makes; the paper's vector was for right before A8); step 46 (A13): 8 rows, not 7, and rows 1 to 5 and 7 false, 6 and 8 true (row 3 now also looks for join_daily_max, which A13 adds; row 5 is join_daily_max itself); step 51 (A14): 6 rows, not 5, rows 2, 3 and 5 false (its own header). The proof database loads the credits ledger as live has it (main e947f26a), not the Tuesday file, which already carries A14's change.
