# Calibrate for credits: what WEB's page needs from the server (proposed, 2026-11-27)

For BUILDER (SQL, earn rules) and CONNECT (the open-a-round tool). The page is `#/calibrate` (assets/app-calibrate.js), behind the per-account switch `calibrate`. Design: proposals/WEB-CALIBRATE-PAGE-1127.md. Names are proposals; WEB follows what BUILDER lands.

General: every function is for the signed-in person's own account (no account id argument), refuses unless that account has the switch `calibrate` (error text: `not_on`), and is callable with the person's browser session only. `my_calibration_answer_set` and `my_calibration_undo` MUST refuse a connector / AI session. The page never sends a clip, path, transcript or picture.

## my_calibration_consent_get() -> json
`{ "consented": boolean, "at": timestamptz|null, "words_id": text|null }`

## my_calibration_consent_set(p_on boolean, p_words_id text) -> json
Records the choice and the id of the words the page showed (`calibrate-consent-1`). Same return shape. `p_on=false` withdraws; earned credits stay. No task or round may be served while `consented` is false.

## my_calibration_round_get() -> json
```
{ "state": "ready" | "none" | "cap_reached" | "not_consented",
  "round": { "id": uuid, "total": int, "answered": int, "tasks": [ Task ... ] } | null,
  "cap": { "reached": boolean, "resets_at": timestamptz|null } }
```
Returns only tasks not yet answered by this person; never the correct answer or which tasks are hidden checks. A round opened by CONNECT's tool for this person is returned here; if none is open and the person may have one, the server may make one (BUILDER decides).

Task:
```
{ "id": uuid, "type": "better_cut" | "confirm_speaker" | "is_phrase" | "rate_match",
  "prompt": text,
  "clip": Clip | null,                       -- single-clip types
  "options": [ { "id": text, "label": text, "clip": Clip | null } ] }   -- better_cut: one clip per option
Clip: { "kind": "own_app" | "licensed", "url": text, "label": text, "start_seconds": number|null, "end_seconds": number|null }
```
`own_app` url: a loopback address served by the person's own Ryagram app (http://127.0.0.1:PORT/... or localhost). `licensed` url: https only, for a public-domain or licensed clip. The page plays nothing else. Clips only ever come from the person's own uploads or public-domain/licensed clips.

## my_calibration_answer_set(p_round uuid, p_task uuid, p_answer text) -> json
`p_answer` is one of the task's option ids, or the fixed word `skip`.
```
{ "ok": boolean, "answered": int, "total": int,
  "awarded": number|null,         -- credits for this answer as the server decided; null = say nothing about a number
  "cap_reached": boolean, "round_done": boolean }
```
Errors (message text): `not_on`, `not_consented`, `round_ended` (page asks for a new round), `task_unknown`, `cap_reached`.

## my_calibration_earned_get() -> json
```
{ "total": number, "today": number,
  "ledger": [ { "id": uuid, "at": timestamptz, "task_type": text, "credits": number, "undone": boolean } ]   -- newest first, at most 20 }
```
A ledger row per award (BUILDER's rule). The page shows numbers only as received.

## my_calibration_undo(p_ledger uuid) -> json
`{ "ok": boolean }`. Takes back one award of this person's own (credits removed, row marked `undone`).

## CONNECT: open-a-round tool
Asks the server to prepare a round for the person (their own uploads or licensed clips only). It has no way to read answers or write one. The page picks the round up through `my_calibration_round_get`.
