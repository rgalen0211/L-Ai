# Calibrate for credits: what WEB's page needs from the server (proposed, revised 2026-11-27 after the abuse reviews)

For BUILDER (SQL, earn rules) and CONNECT (the AI tool). The page is `#/calibrate` (assets/app-calibrate.js), behind the per-account switch `calibrate`. Design: proposals/WEB-CALIBRATE-PAGE-1127.md. Names are proposals; WEB follows what BUILDER lands.
Reviews folded in: FACES' abuse model (FACES-CALIBRATE-ABUSE-MODEL-1127), RENDERER's threat model (11:44), GEO's list (11:47), WORKER's independent read (11:52), CONNECT's paper (12:01).

## The rule for this contract: the page only DISPLAYS what the server returns

The page never decides a credit, never knows which question is a check, never measures time, never sees a correct answer. Everything below that looks like a rule (a minimum time, a cap, a gate, an award, a hold, a pause) is the server's; the page shows the state the server names, in one plain line, and nothing else. In particular:
- No number about credits is typed on the page. Awards, "this round", "today", "this week", "waiting", the gate's days: all arrive as values and are shown as received (or omitted when absent).
- The page does not say which items were checks. When a round earns nothing because checks failed, the server returns the state `no_award`; the page says "no credits for this round yet, because some of the check questions were not all right" and nothing about which ones, how many, or what the right answer was.
- The page sends only: the round token, the item token, and the option the person chose (or `skip`). No clip, path, label, time, transcript, event count or key log.

General: every function is for the signed-in person's own account (no account id argument), refuses unless that account has the switch `calibrate` (error text `not_on`), and is callable with the person's own browser session only. `my_calibration_answer_set`, `my_calibration_consent_set` and `my_calibration_undo` MUST refuse a connector / AI session (see RENDERER's T5b: `connect_actor` sets the user but not `client_id`, so `require_app_session` alone may not refuse inside a connector transaction; BUILDER proves it with a must-fail test or a marker). No function returns which item is a check, a correct answer, a trust score or a gold rate.

## my_calibration_consent_get() -> json
```
{ "consented": boolean, "at": timestamptz|null, "words_id": text|null,
  "withdraw_note": text|null,          -- the SERVER's sentence about what happens to earlier answers if the person withdraws; shown next to the withdraw control
  "gate": Gate|null }                  -- set when the account may not help yet (see Gate); then the page shows the gate line and NO opt-in box
```

## my_calibration_consent_set(p_on boolean, p_words_id text) -> json
Records the choice and the id of the words the page showed (`calibrate-consent-1`). `p_on=false` withdraws. Returns `{ "consented": boolean, "at": ..., "words_id": ..., "note": text|null }`; on withdrawal `note` is the server's sentence about earlier answers and earned credits (kept, removed, or deleted: BUILDER and Ryan decide; the page adds no words of its own about it). No round or item may be served while `consented` is false.

## my_calibration_round_get() -> json
```
{ "state": "ready" | "none" | "cap_reached" | "gate" | "budget_used" | "paused" | "not_consented",
  "round": { "token": text, "total": int, "answered": int, "tasks": [ Task ... ] } | null,
  "gate": Gate | null,                                   -- when state = "gate"
  "cap": { "reached": boolean, "period": "day" | "week" | null } }
```
- A round is `total` items (the server picks N; the page shows "{answered} of {total} answered"). `round.token` is for one round, bound to the person, short-lived.
- `tasks` holds only items not yet answered. Each Task has its own single-use `token`. The server serves items to the person's browser session; the AI tool never receives them.
- `gate`: the account is not yet allowed (age, first film). `cap_reached` with `period`: the daily or the weekly limit. `budget_used`: the programme's weekly credits are all given out. `paused`: earning is paused for this account (the server's reason is never shown). All of these are states, not numbers: the page shows one line each.
- Never returned: the correct answer, which tasks are checks, a trust score.

Gate: `{ "days_needed": int|null, "needs_film": boolean }` -- the days still to wait (or the rule's days; the server decides which) and whether a first film is still needed. The page builds "Help tune opens after {days} days and your first film." from these two values (FOR RYAN'S YES); nothing is hard-coded.

Task:
```
{ "token": text, "type": "better_cut" | "confirm_speaker" | "is_phrase" | "rate_match",
  "prompt": text, "clip": Clip | null,
  "options": [ { "id": text, "label": text, "clip": Clip | null } ] }
Clip (own_app): { "kind": "own_app", "url": text }                      -- ONLY a loopback address whose path is an opaque handle the person's own app resolves; no label, no file name, no start/end times, no path
Clip (licensed): { "kind": "licensed", "url": text, "label": text|null }
```
For the person's OWN footage nothing identifying ever reaches the server in either direction: the server holds only the item token (and, if it needs one, the opaque handle); the app resolves the token to the clip locally and plays it from loopback; any words the person sees come from the server's `prompt` text or from the local app, and are never echoed back. `my_calibration_answer_set` sends only (round token, item token, chosen option id).
- `own_app` url: a loopback address of the person's own Ryagram app (http://127.0.0.1:PORT/... or localhost), an OPAQUE local reference. NO label and NO start/end times for `own_app` clips (WORKER 11:52 HIGH 3: the server must not hold file names or times from the person's own videos; the page also drops them if sent). `licensed` url: https only, a public-domain or licensed clip; only a licensed clip may carry a label.
- Under FACES' option (a) the PC builds the items (WORKER HIGH 1) and the server cannot serve, time or check them. See the open questions in the design doc. The page works the same if the SERVER serves the items, which is what the defences need.
- CSP: media-src on the app page allows only the project's storage host today; `licensed` urls must be signed URLs on that host; `own_app` loopback clips need media-src to allow http://127.0.0.1:* and http://localhost:* (WEB adds it when Ryan says yes).

## my_calibration_answer_set(p_round text, p_item text, p_answer text) -> json
`p_round` is the round token, `p_item` the item token, `p_answer` one of the task's option ids or the fixed word `skip`. One answer per item: a repeat of an item token is refused (`item_used`) and writes nothing. The minimum seconds per item is measured by the server from "item served" to "answer received"; the page sends no time.
```
{ "ok": boolean, "answered": int, "total": int,
  "cap_reached": boolean, "cap_period": "day" | "week" | null,
  "round_done": boolean,
  "round_result": "awarded" | "no_award" | "pending" | null }    -- only when round_done
```
No amount is returned per answer (an award is per round, decided when the round closes). `round_result`: `awarded` (the amounts come from earned_get), `no_award` (the check questions were not all right; nothing else is said), `pending` (credits will be added later, e.g. a hold).
Errors (message text): `not_on`, `not_consented`, `round_ended` (the page asks for a new round), `item_used` (the page drops the item), `task_unknown`, `cap_reached`, `too_fast` (the ONLY trigger for the line "Too fast. Take your time."; the question stays), and anything else shows a plain "couldn't save" line.

## my_calibration_earned_get() -> json
```
{ "round": number|null, "today": number|null, "week": number|null, "total": number|null, "pending": number|null,
  "ledger": [ { "id": uuid, "at": timestamptz, "task_type": text|null, "credits": number, "undone": boolean } ]   -- newest first, at most 20 }
```
Each field is shown as received ("Earned this round", "Earned today", "Earned this week", "Credits earned so far", "Waiting to be added") and omitted when null or absent. A ledger row per award (per round).

## my_calibration_undo(p_ledger uuid) -> json
`{ "ok": boolean }`. Takes back one award of this person's own. BUILDER's draft keeps undo dashboard-only; if so the page drops its "Take back" button (open question).

## CONNECT: the AI tool
Per CONNECT's 12:01 paper: a read-only status tool (counts only, no items) and, only if Ryan says yes, a third `start_calibration_round` tool that can only OPEN a round. It never receives items, item tokens or answers and has no answer scope. The page needs no AI path, and it does not say "your AI can open a round" (that depends on Ryan's decision).
