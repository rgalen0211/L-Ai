# Calibrate: the earn rules (BUILDER, 2026-11-27, revision 2, DESIGN STAGE)

Ryan's idea (11:40): people help tune the compilation maker and earn free credits. FACES designs the tasks and the engine, WEB the page, CONNECT the AI's read-only tools, BUILDER the earn rules below. Ryan's pace order (11:45): design first; the build sits behind the per-account switch **calibrate**, off for everyone.
This revision takes FACES' abuse model numbers wherever they are stricter, WORKER's three 11:52 HIGHs, RENDERER's T5b, CONNECT's 12:01 contract and WEB's aee1ec4f contract.
Files (NOT APPLIED, NOT RUN: no Postgres in the design window; the test file is py_compiled only): `supabase/migrations/20261127001100_calibrate_earn.sql`, its rollback, live step `84_calibrate_check.sql`, `supabase/tests/test_calibrate_earn.py`.

## The numbers, all FOR RYAN'S YES (one dashboard row each, no code)

| Rule | Proposed |
|---|---|
| Unit | tenths of a credit, kept in their own table; only WHOLE credits go to the ledger, through `grant_credits` |
| Pay | a verified round pays 0.5 credit, scaled by the share of its items that are paid (known-answer or site-served) and answered with care |
| Own footage | answers on a person's own clips earn nothing in v1 |
| Caps | 3 credits in any 24 hours, 10 in any 7 days (rolling, never a calendar day); undone awards still count |
| Round | 18 items, 3 of them known-answer (1 in 6), 30 minutes, one open round, 10 rounds a day |
| Gold | at least 2 of the round's 3 right AND 80 percent over the last 20 known-answer items across rounds; a skip or no answer is wrong |
| Pace | minimum seconds per task kind on the server's clock (phrase 2, speaker 3, rate 3, better cut 4, trim 6); a third too-fast answer makes the round pay 0; a skip is never too fast |
| Gate | account 7 days old AND one film Ryagram itself rendered (a spent render hold) or a purchase; a compilation the PC reports never counts |
| Hold | every award waits 24 hours before it lands |
| Budget | 50 credits a week for everyone together (never above 200); past it, awards wait for next week |

An honest careful person earns about 0.5 credit per 6-minute round, so the 3-a-day cap is 6 rounds; a 6-credit film is 12 rounds.

## How a round works

1. **Consent first.** The words (below) are stored with the time and version. Withdrawing stops new rounds at once.
2. **Start.** The SERVER picks the 3 known-answer items from its own pack (public domain or licensed, never own footage) and the rest, shuffles them, and returns per-round **item tokens**, never item ids, gold flags or sources. Item ids differ per person and round, so two accounts cannot match items to share answers.
3. **Answer.** One answer per item ever (a choice or `skip`), only while the round is open, timed by the server.
4. **Finish.** Scored once. It returns only `{result, tenths, release_at}`: never an accepted count, never which items were known-answer. An expired round is refused, and its known-answer items count as wrong.
5. **Release.** After 24 hours the tick (and the person's own next start or finish) adds the award's tenths to the person's tenths and sends whole credits through `grant_credits` ('grant', 'granted' pool, created_by `calibrate:<award>`). Nothing is released while the week's budget is used up, the switch is off, or the gold record has fallen.

**Own footage (WORKER HIGH 3):** an own-footage item holds only an opaque `loc_...` reference. A table check refuses a label, times, words or a path, and refuses gold. The person's own app resolves the reference locally.

**The AI never answers.** Consent, answer and finish refuse a connected AI's token (`require_app_session`), AND refuse the connector's own login (RENDERER T5b: `connect_actor` sets no client_id), AND are not granted to `connect_runner`. The connector gets one read-only call, `connect_calibration_status`. There is no AI round opener (CONNECT's advice).

## The award ledger and the undo

- `calibrate_awards` is append-only (a trigger refuses update and delete), with an 'award' row (+tenths) and at most one 'reversal' row (-tenths). Releases and whole-credit moves sit in two more append-only tables, each move tied to its credit_ledger row.
- **Undo** (`ryagram_private.calibrate_award_undo(award, note)`, dashboard only) appends the reversal. A held award then never lands. A landed one comes out of the person's tenths first; anything short is taken back in whole credits through `adjust_credits`, at most what calibrate itself granted (net), at most the pool. What is still short becomes a calibrate debt that the next releases pay first. A balance never goes below zero.
- **Cannot do, said plainly:** the ledger has ONE 'granted' pool for welcome and calibrate credits, so it cannot tell which credits were spent. If the person already spent calibrate credits, the take-back lands on welcome credits (never more than calibrate gave). A real fix is a new pool value in `credit_pool`, which is a ledger change for Ryan.
- **Rollback** refuses, in words, while any award is held or anyone holds part of a credit or a debt. Granted credits stay in the ledger.

## Where the other contracts differ, and what changes

**CONNECT (connect-calibrate-1127 8fbc87b6, paper section 6).** BUILDER adopts `public.connect_calibration_status(p_token_hash text)` as written (connect_runner only, read only, no items). CONNECT must change: (1) the schema becomes `ryagram.calibration-status/1`, and amounts are in TENTHS: `daily_cap` becomes `daily_cap_tenths`, `earned_today` becomes `counted_today_tenths` (every award in the last rolling 24 hours, undone ones too, because that is what the cap counts), `remaining_today` becomes `remaining_today_tenths`, `earned_total` becomes `credits_kept_total` (whole credits granted minus taken back), plus new `held_tenths`. (2) "today" in the tool words becomes "in the last 24 hours". (3) No `calibrate_round_open(.., 'ai')`: removed.

**WEB (web-calibrate2-1127 aee1ec4f).** Agreed: no per-answer amount, settle at close, tokens, no own-footage labels or times, no word about which items were checks. Differences:
- Names: WEB's `my_calibration_*` versus BUILDER's `calibrate_*`. Proposal: WEB adopts `calibrate_consent_set(p_yes)`, `calibrate_round_start()` / `calibrate_round_items(p_round)`, `calibrate_answer(p_round uuid, p_item_token uuid, p_answer)`, `calibrate_round_finish(p_round)`, or BUILDER adds thin `my_calibration_*` wrappers at build time (one hour, no rule change).
- Round token: WEB wants an opaque round token; BUILDER uses the round's uuid, owner-checked. Same safety; WEB treats it as opaque.
- Results: WEB's `awarded / no_award / pending` map to BUILDER's `held` = pending, `gold_too_low` and `too_fast` = no_award, `cap_reached` (with day or week, to add), `nothing_paid`. The answer call returns only an id; `round_done` and counts come from `calibrate_round_items`.
- Too fast: WEB expects the answer call to refuse with `too_fast` and keep the question. BUILDER scores pace at finish (FACES' three-strikes rule). BUILDER can add the per-answer refusal if Ryan prefers it (RYAN DECIDES 6).
- `consent_set(p_on, p_words_id)`: BUILDER stores its own words and version server-side; WEB should send only yes or no and show the words the call returns.
- `my_calibration_undo(p_ledger)` for the person: not in BUILDER's design; undo is Ryan's dashboard call only.
- States `gate`, `budget_used`, `paused`: the hints `calibrate_too_new` and `calibrate_off` exist; `budget_used` shows as held awards waiting (`release_at` passed). `paused` is not built (FACES' 7-day pause after two failed rounds is open).

**FACES.** The known-answer key stays on the server (the safer of FACES' two options). The PC never sends `gold_id`. Real answers on own footage are recorded but unpaid.

## RYAN DECIDES

1. Every number in the table above, including the 50-credit weekly budget and whether the page states it.
2. The consent words: "My answers may be used to improve Ryagram. I answer each task myself: no AI tool or script answers for me. Credits I earn can be taken back if checks show the answers were not really mine. I can stop at any time." Also: on withdrawal, delete the past answers or keep them?
3. Own-footage answers: nothing in v1 (proposed), or a small flat rate later.
4. The undo landing on welcome credits: accept it, or add a 'calibrate' credit pool (a ledger change).
5. Whether the AI may open a round at all (proposed: no, read-only status only).
6. Too-fast handled per answer (WEB) or per round (FACES, proposed), or both.
7. FACES' extra rules not built yet: the trust score, the 7-day pause after two failed rounds, and the first-month 20-credit lifetime review.
8. Legal: a row for LEGAL-QUESTIONS-FOR-ATTORNEY.md (are earned credits taxable value? do the words cover training the engine?). It does not block the build.
