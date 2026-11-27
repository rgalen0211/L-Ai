# WEB: "Help tune Ryagram, earn credits" page and Your projects card (design, 2026-11-27)

Source: Ryan's idea, inbox 11:42, PRIORITY 2. Status: DESIGN. Every public word below is FOR RYAN'S YES (nothing is live; the page is behind the per-account switch `calibrate`, OFF for everyone).
Not in this page: the earn rules and every number about credits (BUILDER sets them; the page shows only what the server says), the tasks' content (FACES), the AI tool that opens a round (CONNECT), legal wording for the consent (the lawyer reads it later; the page sends the id of the words it showed so the server records which words a person agreed to).

## 1. What the page is

- Route `#/calibrate` (no department; same shape as `#/films`). Page code: `assets/app-calibrate.js` (`window.ryagramCalibrate`), data wrappers in `assets/app-data.js`.
- Switch `calibrate: 'account'` in `assets/ryagram-config.js`; read only through `featureOn('calibrate')`. Switch off: the route shows one Coming soon page and makes NO call; Your projects shows no card.
- A card on Your projects (the home), in the "Departments" tab inside that tab's own scroll panel (so the home never gets longer: tools/check-pages-flip.py caps each tab and the other tabs have no room), only when the switch is on: heading "Help tune Ryagram, earn credits", one line, a link to `#/calibrate`. The card makes no call either (it never shows a number); a returning person sees what they earned on the page itself.
- The page never sends a clip, a path, a transcript or a picture. It sends only: the consent choice and the id of the words shown, a round id, a task id and the option the person chose. Tasks arrive as small text and option cards plus a clip REFERENCE.

## 2. Page states

| # | State | What shows | Calls made |
|---|---|---|---|
| S0 | Switch off | h1 + "Coming soon" line + back link. No form. | none |
| S1 | Loading | "Loading…" (role=status) | consent_get |
| S2 | Consent not given | offer line, where-clips-come-from line, no-AI line, the opt-in checkbox, "Turn on" (disabled until ticked). NO task is fetched or drawn. | consent_get only |
| S3 | Consent given, a round | progress line, the current task card (one at a time), "Skip this one", "Stop helping" | round_get |
| S4 | No round available | "There are no questions right now. Come back later." + earned block + "Stop helping" | round_get |
| S5 | A task, 4 types | see section 3 | none until answered |
| S6 | Answered / progress | "Saved. 3 of 8 answered." (aria-live), the next task; the awarded line only if the server sent a number | answer_set |
| S7 | Round done | "That is all for this round. Thank you." + earned block | none |
| S8 | Daily cap reached | the daily-cap line; no task drawn; earned block | round_get says so |
| S9 | Earned (any consented state) | "Credits earned so far: N" and "Earned today: N" from the server (omitted when the server sends none); the list of recent awards, each with "Take back" | earned_get |
| S10 | Error | one plain line (role=alert) per call; the page stays usable and offers "Try again" | the failed call |
| S11 | Consent withdrawn | back to S2 with the checkbox cleared; earned credits stay | consent_set(false) |

## 3. The four task types (FACES designs the content; the page draws by shape)

All arrive as `{ id, type, prompt, options:[{id,label,clip?}], clip? }`. The page draws `prompt` as text, then the clip(s), then one button per option, then "Skip this one". It never computes whether an answer is right.

1. `better_cut` (pick the better cut): two options, each with its own clip (A and B).
2. `confirm_speaker` (confirm the speaker): one clip, options such as "Yes, the same person" / "No, a different person" / "Can't tell".
3. `is_phrase` ("is this the phrase?"): one clip and the phrase as text in `prompt`; options "Yes" / "No" / "Can't tell".
4. `rate_match` (rate a match): one clip; five options, ids `1`..`5` with labels from the server.

An unknown `type`, a missing prompt or an option list the page cannot draw: the card says "We can't show this question. Skip it." with only Skip. The page never invents options.

CSP note: the app page's media-src today allows only the project's own storage host, so a `licensed` clip must be a signed URL on that host, and an `own_app` (loopback) clip needs `media-src http://127.0.0.1:* http://localhost:*` added to app/index.html (a WEB change for Ryan's yes, not made in this skeleton; until then the page shows the "Open the Ryagram app" line for those).

Clips: `clip = { kind: 'own_app' | 'licensed', url, label, start_seconds?, end_seconds? }`. `own_app` is served by the person's OWN Ryagram app on their computer (a loopback address, http://127.0.0.1 or localhost); `licensed` is an https URL the server gives for a public-domain or licensed clip. The page plays a clip only for those two shapes and refuses anything else (no `file:`, no other host over http, no `javascript:`), so a task cannot make the page load a path or another site's video. If an own_app clip does not load (the app is closed): "Open the Ryagram app on your computer to see this clip." and Skip. A clip is never preloaded before the person has opted in.

## 4. Only the person answers

- An answer is sent only from a real click on a page button or a real key press (`event.isTrusted === true`). A click made by script (`element.click()`, `dispatchEvent`) is ignored and says nothing that helps a script (a polite line: "Answers only count from your own click or key press."). This is a speed bump, not the gate: the server is the gate (BUILDER's hidden known-answer checks, per-task rate limits, and `my_calibration_answer_set` refused for any connector or AI session: it is callable only with the person's own browser session).
- CONNECT's AI tool may OPEN a round (it calls a connector tool that asks the server to prepare one); it has no tool to answer. The page needs no AI path at all.
- No answer is pre-selected, no option has a default, no timer, no "answer all" button, no auto-advance without a click.
- Keyboard answer keys work only while focus is inside the task card (so they are not page-wide character shortcuts): number keys `1`..`9` choose the option with that number, `S` skips, and only as real key presses. A hint line shows them.

## 5. Data calls (proposed names; BUILDER builds the SQL, CONNECT the open-a-round tool)

Full shapes in `docs/calibrate-contract-needs-1127.md`. All are RPCs for the signed-in person's own account, none takes an account id, all refuse unless the person has the switch `calibrate`.

- `my_calibration_consent_get()` -> `{ consented, at, words_id }`
- `my_calibration_consent_set(p_on boolean, p_words_id text)` -> same shape. `p_words_id` is a fixed id of the words the page showed (`calibrate-consent-1`), so the lawyer's later wording gets a new id and a re-ask.
- `my_calibration_round_get()` -> `{ state, round?, cap }`
- `my_calibration_answer_set(p_round uuid, p_task uuid, p_answer text)` -> `{ ok, answered, total, awarded, cap_reached, round_done }`
- `my_calibration_earned_get()` -> `{ total, today, ledger:[{ id, at, task_type, credits, undone }] }`
- `my_calibration_undo(p_ledger uuid)` -> `{ ok }` (takes back one award; the answer stays recorded as taken back)

`awarded` may be null (a held or hidden-checked answer): the page then says only "Saved." and never guesses a number.

## 6. FOR RYAN'S YES: the words

Page title (h1): **Help tune Ryagram, earn credits**
Home card heading: **Help tune Ryagram, earn credits** / card line: **Answer a few quick questions about clips and Ryagram adds free credits to your account.** / link: **Open**

Offer line: **Help Ryagram get better at making films. Answer a few quick questions about clips, and Ryagram adds free credits to your account.**
Where the clips come from: **The clips are your own videos, or clips that are free to use. They are never anyone else’s videos.**
Opt-in checkbox label: **My answers may be used to improve Ryagram.**
Turn-on button: **Turn on**
No-AI line: **Only you can answer. Your AI can open a round for you, but it cannot answer or earn credits for you.**
Stop button: **Stop helping** / after it: **Stopped. Credits you earned stay yours.**
Switch off (S0): **Coming soon.**
Not signed in: the usual sign-in page (the route is signed-in only).
Progress: **{n} of {total} answered.** / saved: **Saved.** / saved with a number from the server: **Saved. You earned {n}.**
Skip: **Skip this one** / key hint: **Press a number to answer, S to skip.**
No round (S4): **There are no questions right now. Come back later.**
Round done (S7): **That is all for this round. Thank you.**
Daily cap (S8): **You have reached today’s limit. Come back tomorrow.** (with `cap.resets_at`: **More questions open {time}.**)
Earned block: **Credits earned so far: {n}** / **Earned today: {n}** / take back button: **Take back** / after: **Taken back.**
Clip lines: **Open the Ryagram app on your computer to see this clip.** / **We can’t show this question. Skip it.**
Untrusted click/key: **Answers only count from your own click or key press.**
Error lines (each with a **Try again** button where it makes sense):
- load: **Couldn’t load your questions. Try again in a minute.**
- consent save: **Couldn’t save your choice. Try again.**
- answer save: **Couldn’t save that answer. Try it again.**
- round ended (server says `round_ended`): **That round has ended. Here is a new one.** (the page asks for a new round)
- not on: **This isn’t on for your account yet.**
- take back: **Couldn’t take that back. Try again.**

Not on the page, by design: any amount of credits promised, any "per answer" or "per day" figure, the word "paid", any legal wording about data use beyond the one checkbox sentence (the lawyer reads it later), any mention of TV or films from Ryan's own library.

## 7. Accessibility and phone

- Every button and the checkbox are at least 44 px tall and wide on a phone (the checkbox label is the tap target); option buttons stack on a phone, sit in a row at 1280.
- Status changes (saved, progress, cap, errors) go to one `role="status" aria-live="polite"` line; errors `role="alert"`. Focus moves to the new task card heading after an answer so a screen reader hears the next question.
- Clips are `<video controls playsinline preload="none">` with a text label; no autoplay; a transcript line is not needed because the prompt is text.
- The whole page works by keyboard (Tab order: consent, then the task's clip, the options, Skip, Stop helping). Number keys are an extra, not the only way.
- No horizontal scroll at 320 px; text wraps (`overflow-wrap`).
- Reduced motion: no animation to begin with.

## 8. Tests planned (tests/calibrate-page-1127.test.mjs)

Switch off draws nothing and calls nothing; no task call before the opt-in; the opt-in sends the words id; an untrusted click and key are ignored; no path, clip bytes or text of a clip in any call (only ids and the chosen option); only the planned words are on the page (a list of plain words); no credit number is hard-coded; an unknown task type offers only Skip; a clip URL of a bad shape is not played. Plus a Playwright walk at 390 and 1280 through S0..S11 in the mock.

## 9. Questions for the others

- BUILDER: names and shapes in the contract; confirm `awarded` may be null and `cap.resets_at` is a timestamp; confirm the connector/AI session is refused on `my_calibration_answer_set`.
- CONNECT: the open-a-round tool needs only to create/mark a round for this person; the page reads it through `my_calibration_round_get`.
- FACES: per-type prompt and option wording arrives in the task; the page needs no per-type text of its own.
