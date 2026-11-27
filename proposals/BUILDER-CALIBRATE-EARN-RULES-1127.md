# Calibrate: the earn rules (BUILDER, 2026-11-27, revision 3, DESIGN STAGE)

Ryan's idea (11:40): people help tune the compilation maker and earn free credits. FACES designs the tasks and the engine, WEB the page, CONNECT the AI's read-only tools, BUILDER the earn rules below. Ryan's pace order (11:45): design first; the build sits behind the master switch `ops_settings.calibrate_enabled` (new, off) and the per-account switch **calibrate** (off for everyone).
Revision 3 answers RENDERER's 12:43 review (HOLD) and adopts WEB's page contract (web-calibrate2-1127 aee1ec4f, `docs/calibrate-contract-needs-1127.md`) and CONNECT's status shape (connect-calibrate-1127) as written.
Files (NOT APPLIED, NOT RUN: no Postgres in the design window; the test file is py_compiled only): `supabase/migrations/20261127001100_calibrate_earn.sql`, `supabase/rollbacks/20261127001100_calibrate_earn_rollback.sql`, live step `84_calibrate_check.sql` (10 rows), `supabase/tests/test_calibrate_earn.py`.

## ONE contract: every page call and the function that answers it

| Page (assets/app-calibrate.js) | Server function (all return jsonb) | Returns |
|---|---|---|
| `data.myCalibrationConsent()` | `public.my_calibration_consent_get()` | `{consented, at, words_id, withdraw_note, gate}`; consented means a yes to the CURRENT words |
| `data.setMyCalibrationConsent(true/false, 'calibrate-consent-1')` | `public.my_calibration_consent_set(p_on boolean, p_words_id text)` | `{consented, at, words_id, note}`; the words live server-side by id (`ryagram_private.calibrate_consent_words`); an old or unknown id: `words_unknown`; withdrawing always works, even with a switch off |
| `data.myCalibrationRound()` | `public.my_calibration_round_get()` | `{state, round, gate, cap}`; states ready, none, cap_reached (period day, week, or null = the lifetime cap), gate, budget_used, paused, not_consented. It opens a round when none is open (there is no separate start call) |
| `data.setMyCalibrationAnswer(round, item, answer)` | `public.my_calibration_answer_set(p_round text, p_item text, p_answer text)` | `{ok, answered, total, cap_reached, cap_period, round_done, round_result}`; the last answer closes the round; `round_result` is always null |
| `data.myCalibrationEarned()` | `public.my_calibration_earned_get()` | `{round, today, week, total, pending, ledger[]}`; `round` and `pending` always null; ledger rows `{id (the round token), at, task_type null, credits, undone}` |
| `data.undoMyCalibrationAward(id)` | `public.my_calibration_undo(p_ledger uuid)` | `{ok: true}`; the person gives back their own released award (same clamped undo as the dashboard) |
| CONNECT `open_calibration` / totals tool | `public.connect_calibration_status(p_token_hash text)` | CONNECT's keys exactly, schema `ryagram.calibration-status/0`, whole credits |

Error messages start with the page's code word: `not_on`, `not_consented`, `round_ended` (also an item token past 15 minutes: the page reloads the round and gets new tokens), `item_used`, `task_unknown`, `words_unknown`, `not_undoable`, `not_person` (a connector).
Task types are the page's: `better_cut`, `confirm_speaker`, `is_phrase`, `rate_match`. FACES' `ab_padding` = `better_cut`, `speaker_same` = `confirm_speaker`. Result mapping: held = pending, gold_too_low and too_fast = no_award, but neither is ever SAID (see 4).

**Page calls not matched exactly, and why:**
- `round_result` is never `awarded`, `no_award` or `pending` (RENDERER 4 overrides the contract): the page then shows only "round done". `too_fast` is never raised per answer: pace is scored at close (FACES' rule), so the page's "Too fast" line never shows.
- FACES' `trim` has no page card (two offsets, not a choice), so it is not a served type in v1.
- Licensed clips are `https://<media_url_base>/<64-hex handle>`: the handle resolver (an edge function turning a handle into a short signed storage URL) is NOT built; `media_url_base` is a placeholder (`https://media.invalid/calibrate/`). Own clips are `http://127.0.0.1:47811/calibrate/clip/<handle>` (port a placeholder; FACES' PC app must serve it). The page's CSP needs both (WEB).
- WEB's mock answers with option ids yes/no; the server's ids are positional letters a, b, c (shuffled per round). The page treats ids as opaque, so nothing changes there.

## What revision 3 changes (RENDERER's defects 1 to 5 and the cheap partials)

1. **One contract** (above). The old `calibrate_*` person calls are gone.
2. **Ring leak.** Per account, per round: item tokens; the media goes out only as a per-round opaque handle (`calibrate_media_handles`), never `media_ref`; every served item carries only its task kind's generic prompt (an item's own words travel inside the media, e.g. a caption), so no prompt identifies an item and gold is not told apart from plain; the options are shuffled per round (not rate_match) and served as positional letters, so the right letter differs; labels come from the task kind, never from the item.
3. **Withdrawal.** `consent_set(false)` cancels every held award at once (a reversal row, note "consent withdrawn: cancelled, not paid") and closes the open round; every release re-checks consent and cancels the held awards of a withdrawn person. A later yes does not revive them.
4. **The finish tells nothing.** The last answer returns `round_done` and `round_result` null for a passed and a failed round alike. Rounds, awards, releases and credit moves have NO grant to any API role (read only through the calls). `earned_get` lists a round only once its hold is over, as paid (credits) or 0, never why. Caps count ROUNDS at their full possible pay, so a cap never moves because checks passed. The connector's numbers are credits actually granted.
5. **Budget, lifetime cap, master switch.** A round RESERVES its full pay from the global weekly budget when it opens; no room = state `budget_used` and no round (so no award can ever be made past the budget); the unused part returns at close. A lifetime cap per account (`lifetime_cap_tenths`, 100 credits). `ops_settings.calibrate_enabled` (new column, off): off = no new round, no answer, no release, at once (held awards wait, not cancelled); withdrawing still works.
6. **Partials.** Item tokens expire after 15 minutes (`token_minutes`) and are re-issued by `round_get`; a repeat close returns the same `{"done": true}` and scores nothing twice; 3 rounds failing the known-answer bar inside 7 days pause the account for 7 days (state `paused`); a new current words row means everyone says yes again; items carry `status` pending, cleared or withdrawn and only cleared items are served.

Kept from revision 2: tenths, whole credits only through `grant_credits`; settle at close; gold from the site's own pack only; own footage only as `loc_...` references, served only to its owner, never gold, unpaid in v1; server-clock pace; 24 h hold; append-only award ledger; the clamped undo with a calibrate debt; the AI never answers (app session AND not the connector login, and no grant to `connect_runner`); the rollback refuses while awards are held (it now also drops `ops_settings.calibrate_enabled`).

## The numbers, all FOR RYAN'S YES (one dashboard row each, no code)

Round 18 items, 3 known-answer; 0.5 credit a verified round, scaled by the paid share; at least 2 of the round's 3 right AND 80 percent over the last 20; pace (phrase 2 s, speaker 3, rate 3, better cut 4), a third too-fast answer pays 0; caps 3 credits in any 24 hours and 10 in any 7 days (counted on rounds), 10 rounds a day; **lifetime 100 credits per account**; hold 24 h; weekly budget 50 credits for everyone (never above 200); gate 7 days AND a server-rendered film; round 30 minutes, token 15 minutes; strikes 3 in 7 days, pause 7 days.

## Left for later (not built, said plainly)

- Consensus of 3 distinct accounts on non-gold items (RENDERER T10): non-gold answers pay without agreement in this revision.
- Gold bank rotation (T9: a 5x bank, 30-day rotation, retire at 98 percent).
- Email-hash and disposable-domain checks (T2).
- The training-exclusion statement and excluding withdrawn people's answers from future tuning batches (T14): see RYAN DECIDES 3.
- The media handle resolver (edge function) and FACES' PC loopback server.
- A per-answer `too_fast` refusal (RYAN DECIDES 6).

## RYAN DECIDES

1. Every number above, including the 100-credit lifetime cap and the 50-credit weekly budget.
2. The consent words (calibrate-consent-1) and the withdraw note: "If you stop, credits not yet added are cancelled and never added. Credits already added stay yours. Your earlier answers stay with Ryagram, without your name."
3. T14's sentence for the consent and withdraw words: "Answers already used to tune Ryagram cannot be taken out of tuning that already happened; after you stop, your answers are left out of future tuning." (Not built: the exclusion needs FACES' batch builder to read withdrawn_at.)
4. Whether `round_result` stays silent (proposed, RENDERER 4) or the page may say pending; and the page's home card words "adds free credits" (RENDERER 6, WEB's legal row).
5. Own-footage answers: nothing in v1 (proposed).
6. Too-fast per answer (WEB) or per round (FACES, built).
7. The person's own "Take back" (built, same clamped undo) or dashboard-only (WEB drops the button).
8. The undo landing on welcome credits (one 'granted' pool), or a 'calibrate' credit pool (a ledger change).
9. Whether the AI may open a round (proposed: no; only the read-only status).
10. Legal: a row for LEGAL-QUESTIONS-FOR-ATTORNEY.md (earned credits as taxable value; consent covering engine training). It does not block the build.
