# WEB: "Help tune Ryagram, earn credits" page and Your projects card (design, revised 2026-11-27 after the abuse reviews)

Source: Ryan's idea, inbox 11:42, PRIORITY 2. Status: DESIGN plus a mock-only skeleton (assets/app-calibrate.js). Every public word below is FOR RYAN'S YES (nothing is live; the page is behind the per-account switch `calibrate`, OFF for everyone).
Revision: folds in FACES' abuse model, RENDERER's 11:44 threat model, GEO's 11:47 list and WORKER's 11:52 independent read. Server half: docs/calibrate-contract-needs-1127.md.
Not in this page: the earn rules and every number about credits (BUILDER sets them; the page shows only what the server says), the tasks' content (FACES), the AI tool (CONNECT), legal wording (the lawyer reads it later; the page sends the id of the words it showed).

## 0. Open questions (read these first)

### 0.1 WORKER's HIGH 1, in plain words: under option (a) the main defences cannot run
FACES recommends option (a): the person's own computer builds the questions and sends them (and the hidden check questions) itself. Then the server never serves the questions, so it cannot time them, cannot tell its own check questions from real ones, and cannot check a real answer at all. The check clips come from a bundled pack of about 40 public-domain clips that anyone can look up, and a modified app can tell them from the person's own footage, so a script can answer the pack right and invent the rest. The gate, the caps and the minimum time all fall back on trust in the PC. The fix WORKER proposes (and this page is built for): the SERVER picks the check slots and the pack ids for every round, serves the items (item tokens), and pays only for server-served items; answers about the person's own footage earn nothing, or a small flat amount after a check. WEB's page needs nothing different either way: it shows what the server returns.
Needs: BUILDER and CONNECT (and FACES for the item source), then Ryan's yes.

### 0.2 What each reviewer raised that needs BUILDER, CONNECT or Ryan
| # | From | Question | Who |
|---|---|---|---|
| 1 | WORKER HIGH 1 | Who builds and serves the items: the server (defences run) or the PC (they cannot)? See 0.1. | BUILDER, CONNECT, FACES, Ryan |
| 2 | WORKER HIGH 2 | "Has made a film" is fakeable (compilations are free and reported by the PC): count only server-rendered films with a capture row, or a purchase. Page: the gate line says "your first film" and the server decides what counts. | BUILDER |
| 3 | WORKER HIGH 3 | Own-clip labels and times would reach the server. Done: for an own clip the contract carries only an opaque loopback handle (no label, file name, times or path); the page drops any label or times if sent, and answer_set sends only (round token, item token, option id); a test proves no request body carries label, start, end or path keys. | FACES, BUILDER |
| 4 | WORKER MED 4 | Under (a) the answer token sits on the PC, so an AI with file access can answer; the page says only "Answers that look automated earn nothing", never "proves you are human". Same care in CONNECT's words. | CONNECT, Ryan |
| 5 | WORKER MED 5, FACES, RENDERER | One clawback rule: FACES says "debt", RENDERER says "clamp at zero, fraud clawback only for admins". Honest people's past awards must not be reversed when a check item is retired. The page's "Take back" and the withdraw words depend on it. | BUILDER |
| 6 | WORKER MED 6 | Raw answers append-only (RENDERER) against "delete my answers" (GEO). The withdraw note is the server's sentence, so the page does not promise either. | BUILDER, Ryan |
| 7 | WORKER LOW 7 | The numbers differ across the papers: check rate 1 in 5 (BUILDER), 1 in 6 (FACES), 2 to 3 in 10 (RENDERER); round of 10 or 15 items; award 1 credit per 10 answers (BUILDER) against 0.5 credit per verified round (FACES); daily cap 5 or 3 credits; gate "7 days OR a film" (BUILDER) against "7 days AND a film" (FACES, RENDERER); minimum time 2 s or per type. One set, held on the server. The page hard-codes none of them. | BUILDER, Ryan |
| 8 | RENDERER T5b | `connect_actor` sets the user but no `client_id`, so `require_app_session` may pass inside a connector transaction: a must-fail test or a marker for answer, consent and undo. | BUILDER |
| 9 | CONNECT | May the AI open a round at all (their advice: no; a read-only status tool only)? The page's no-AI line no longer promises that it can. | Ryan, CONNECT |
| 10 | FACES, RENDERER | The 24 hour hold and the weekly programme budget are server states; the page has plain lines for "added later" and "all given out" (new words below). | BUILDER, Ryan |
| 11 | BUILDER, FACES | Does the person get a "Take back" button at all? BUILDER's undo is dashboard-only; FACES reverses with a new row. If it stays dashboard-only the page drops the button. | BUILDER |
| 12 | RENDERER T14 | Withdrawal excludes the person's answers from future tuning; past training cannot be undone. The sentence must be true: the server's words. Version bump forces a re-ask (the page sends the words id). | BUILDER, Ryan, lawyer |
| 13 | RENDERER T12, T13 | Own clips only ever shown to their owner; the public-domain list needs provenance. Not a page matter, but the page's "clips" line makes a public promise. | FACES, BUILDER |
| 14 | GEO | Words to avoid (pay, wages, income, cash); adult accounts only; credits are not transferable; legal row LC10. The page avoids the words; adult gate is the server's. | Ryan, lawyer |
| 15 | FACES | Whether a CSP change (media-src for loopback clips) is allowed. | Ryan |
| 16 | BUILDER | The weekly cap window: calendar or rolling (the page says "today" and "this week" as the server's states). | BUILDER |

### 0.3 Every NEW public sentence (all FOR RYAN'S YES)
New or changed since the first version, in section 6: the no-AI line (changed), the withdraw button (changed) and "Stopped." (shortened), the no-award line, the added-later line, the weekly-limit line, the all-given-out line, the paused line, "Too fast. Take your time.", the four account-gate lines, "That question was already answered.", and the earned labels "Earned this round", "Earned this week" and "Waiting to be added". Removed: "Credits you earned stay yours" (only the server says what happens to credits and answers), "Your AI can open a round for you" and the per-answer "You earned {n}".

## 1. What the page is

- Route `#/calibrate` (no department; same shape as `#/films`). Page code: `assets/app-calibrate.js` (`window.ryagramCalibrate`), data wrappers in `assets/app-data.js`.
- Switch `calibrate: 'account'` in `assets/ryagram-config.js`; read only through `featureOn('calibrate')`. Switch off: the route shows one Coming soon page and makes NO call; Your projects shows no card.
- A card on Your projects, in the "Departments" tab's own scroll panel (the home never gets longer: tools/check-pages-flip.py caps each tab), only when the switch is on: heading, one line, a link to `#/calibrate`. The card makes no call.
- The page only DISPLAYS what the server returns. It never computes a credit, never knows which item is a known-answer item, never measures time, never shows the right answer. It sends only: the consent choice with the words id, the round token, the item token and the chosen option (or the word skip). It sends no clip, path, label, time, transcript or key count.

## 2. Page states

| # | State | What shows | Calls |
|---|---|---|---|
| S0 | Switch off | h1 + "Coming soon." + back link | none |
| S1 | Loading | "Loading…" | consent_get |
| S2 | Consent not given | offer line, clips line, no-AI line, opt-in box, "Turn on" (off until ticked). No task is fetched. | consent_get only |
| S2g | Account not allowed yet (server says `gate`, in consent_get or round_get) | one gate line built from the server's numbers; no opt-in box if not yet opted in; the withdraw control if opted in | none beyond the above |
| S3 | A round | progress, the task card, "Skip this one", the withdraw control | round_get |
| S4 | No round | "There are no questions right now. Come back later." + earned block + withdraw | round_get |
| S5 | A task | section 3 | none until answered |
| S6 | Answered | "Saved." and "{n} of {total} answered." (aria-live), the next card. Never a per-answer amount. | answer_set |
| S6f | Server says too fast | "Too fast. Take your time." and the same question stays | none |
| S6u | Server says item already answered | "That question was already answered." and the next card | none |
| S7 | Round done | "That is all for this round. Thank you." + one more line only when the server says so: no award (S7n) or added later (S7p); the earned block | earned_get |
| S7n | Round result `no_award` | "No credits for this round yet, because some of the check questions were not all right." Never says which questions were checks, how many, or the right answers. | none |
| S8 | Limit reached (server says `cap_reached`, with `period` day or week) | the daily or the weekly limit line; no task | round_get / answer_set |
| S8b | Programme's weekly credits all given out (`budget_used`) | one line | round_get |
| S8p | Paused (`paused`) | one line, no reason | round_get |
| S9 | Earned (any opted-in state) | the server's numbers: this round, today, this week, so far, waiting (each only when sent) + recent awards with "Take back" if the server offers undo | earned_get |
| S10 | Error | one plain line (role=alert) and "Try again" | the failed call |
| S11 | Consent withdrawn | back to S2 with the box clear, "Stopped." and the server's sentence about earlier answers | consent_set(false) |

## 3. The four task types (FACES designs the content; the page draws by shape)

All arrive as `{ token, type, prompt, options:[{id,label,clip?}], clip? }` where `token` is the item token. The page draws `prompt` as text, then the clip(s), then one button per option, then "Skip this one". It never computes whether an answer is right.
1. `better_cut`: two options, each with its own clip.
2. `confirm_speaker`: one clip, options such as yes / no / can't tell.
3. `is_phrase`: one clip and the phrase as text in `prompt`; yes / no / can't tell.
4. `rate_match`: one clip; five options with labels from the server.
An unknown type, a missing prompt or token, or an option list the page cannot draw: the card says "We can’t show this question. Skip it." with only Skip.

Clips: `{ kind: 'own_app' | 'licensed', url, label? }`. `own_app` is a loopback address of the person's OWN Ryagram app; `licensed` is an https URL the server gives. Nothing else is played (no `file:`, no other http host, no `javascript:`). The person's own clips carry NO label and NO times on the page (the server must not hold file names or times from their videos); only a licensed clip may show a label. If an own clip does not load: "Open the Ryagram app on your computer to see this clip." and Skip. Nothing is preloaded before the opt-in. CSP: the app page's media-src allows only the project's storage host today; loopback clips need `media-src http://127.0.0.1:* http://localhost:*` (a WEB change for Ryan's yes, not made in this skeleton).

## 4. Only the person answers, and what the page does NOT claim

- A real click or key press only (`event.isTrusted === true`). A script's `click()` or `dispatchEvent` is ignored with the polite line "Answers only count from your own click or key press." This is a speed bump, not the gate.
- The server is the gate: it refuses `my_calibration_answer_set` for any connector or AI session, needs the item token and the round token, takes one answer per item, measures the minimum time per item itself, decides which items are checks, and pays per verified round. A scripted browser with the person's own login looks the same to the server as the person: that is why caps, checks and the hold exist.
- The page says "Answer yourself. Answers that look automated earn nothing." It does NOT say it proves you are human, and it does not promise that an AI can or cannot open a round.
- No answer is pre-selected, no timer, no "answer all", no auto-advance without a click. Number keys 1 to 9 and S work only while focus is inside the card, only as real key presses.
- Withdrawal: a visible control "Stop helping and withdraw my consent" in every opted-in state. It calls `consent_set(false, 'calibrate-consent-1')`. What happens to earlier answers and credits is shown in the SERVER's words (`withdraw_note` before the click, the reply's `note` after); the page adds none of its own.

## 5. Data calls (proposed names; BUILDER builds the SQL)

Full shapes in `docs/calibrate-contract-needs-1127.md`. All are for the signed-in person's own account, none takes an account id, all refuse unless the person has the switch.
- `my_calibration_consent_get()` -> `{ consented, at, words_id, withdraw_note, gate }`
- `my_calibration_consent_set(p_on boolean, p_words_id text)` -> `{ consented, at, words_id, note }`
- `my_calibration_round_get()` -> `{ state: ready | none | cap_reached | gate | budget_used | paused | not_consented, round?: { token, total, answered, tasks }, gate?, cap: { reached, period } }`
- `my_calibration_answer_set(p_round text, p_item text, p_answer text)` -> `{ ok, answered, total, cap_reached, cap_period, round_done, round_result: awarded | no_award | pending }`; errors include `round_ended`, `item_used`, `too_fast`
- `my_calibration_earned_get()` -> `{ round, today, week, total, pending, ledger }`
- `my_calibration_undo(p_ledger uuid)` -> `{ ok }` (only if BUILDER exposes undo to the person)

## 6. FOR RYAN'S YES: the words

Page title (h1): **Help tune Ryagram, earn credits**
Home card heading: **Help tune Ryagram, earn credits** / card line: **Answer a few quick questions about clips and Ryagram adds free credits to your account.** / link: **Open**

Offer line: **Help Ryagram get better at making films. Answer a few quick questions about clips, and Ryagram adds free credits to your account.**
Where the clips come from: **The clips are your own videos, or clips that are free to use. They are never anyone else’s videos.**
Opt-in checkbox label: **My answers may be used to improve Ryagram.**
Turn-on button: **Turn on**
No-AI line (NEW): **Answer yourself. Answers that look automated earn nothing.**
Withdraw button (NEW): **Stop helping and withdraw my consent** / after it: **Stopped.** and then the server's sentence about earlier answers (not the page's words)
Switch off: **Coming soon.**
Loading: **Loading…**
Progress: **{n} of {total} answered.** / saved: **Saved.**
Skip: **Skip this one** / key hint: **Press a number to answer, S to skip.**
No round: **There are no questions right now. Come back later.**
Round done: **That is all for this round. Thank you.**
No award yet (NEW): **No credits for this round yet, because some of the check questions were not all right.**
Added later (NEW): **Your credits for this round will be added to your account later.**
Daily limit: **You have reached today’s limit. Come back tomorrow.**
Weekly limit (NEW): **You have reached this week’s limit. Come back next week.**
Programme's weekly credits used up (NEW): **The credits for helping this week are all given out. Come back next week.**
Paused (NEW): **Helping is paused on your account for now.**
Too fast, only when the server says so (NEW): **Too fast. Take your time.**
Account not open yet (NEW; the days come from the server, never typed on the page):
- days and a first film: **Help tune opens after {days} days and your first film.**
- days only: **Help tune opens after {days} days.**
- a first film only: **Help tune opens after your first film.**
- neither number known: **Help tune is not open for your account yet.**
Earned block, each line only when the server sends the number: **Earned this round: {n}** / **Earned today: {n}** / **Earned this week: {n}** / **Credits earned so far: {n}** / **Waiting to be added: {n}** (NEW: the first, third and last) / take back button: **Take back** / after: **Taken back.**
Clip lines: **Open the Ryagram app on your computer to see this clip.** / **We can’t show this question. Skip it.**
Untrusted click or key: **Answers only count from your own click or key press.**
Error lines (with **Try again** where it makes sense):
- load: **Couldn’t load your questions. Try again in a minute.**
- consent save: **Couldn’t save your choice. Try again.**
- answer save: **Couldn’t save that answer. Try it again.**
- round ended: **That round has ended. Here is a new one.**
- item already answered (NEW): **That question was already answered.**
- not on: **This isn’t on for your account yet.**
- take back: **Couldn’t take that back. Try again.**

Not on the page, by design: any amount of credits promised, any rate ("per answer", "per round", "a day"), the word "paid", the words pay, wages, income and cash, any legal wording, any claim that it proves a person is human, any claim about what happens to earlier answers (the server says), which questions are checks, TV or films from Ryan's own library.

## 7. Accessibility and phone

- Every button and the checkbox is at least 44 px tall on a phone (the checkbox label is the tap target); option buttons stack on a phone, sit in a row at 1280.
- Status changes (saved, progress, too fast, limits) go to one `role="status" aria-live="polite"` line; errors `role="alert"`. Focus moves to the new card heading after an answer.
- Clips are `<video controls playsinline preload="none">` with a text label (licensed clips) or "Clip"; no autoplay.
- Works by keyboard (Tab order: consent, clip, options, Skip, the withdraw control). Number keys are an extra.
- No horizontal scroll at 320 px; reduced motion: no animation.

## 8. Tests (tests/calibrate-page-1127.test.mjs, tests/fake-supabase.js flags)

Switch off draws nothing and calls nothing; no task call before the opt-in; the opt-in sends the words id; untrusted clicks and keys ignored on every control; every answer is (round token, item token, option) and nothing else; an item answered once is dropped; too fast shows only when the server says; no-award, added-later and awarded states; the gate line follows the server's numbers (7, 3, 2, none) with no task and no clip; daily, weekly, all-given-out and paused lines; the withdraw control in every opted-in state with the server's words only; no digit next to the word credit in the page file and no number in any word; the page file knows nothing about checks and measures no time; own clips carry no label or times. Mock flags (`?calibon` plus): `calibconsented`, `calibwithdraw`, `calibgate[=days]`, `calibcap`, `calibcapweek`, `calibcapafter=N`, `calibnoaward`, `calibpending`, `calibfast`, `calibnone`, `caliberr`, `calibanswererr`, `calibended`, `calibtype=`, `calibbad`. Plus a Playwright walk at 390 and 1280 over every state: no horizontal overflow, 44 px targets.

## 9. Questions for the others

See section 0. In short: BUILDER (items served by the server, per-round awards, one number set, gate that counts real films, one clawback rule, connector refusal proof, answer deletion, undo for the person), CONNECT (AI opens a round or not; words), FACES (item source, no labels or times for own clips), Ryan (every number, every new sentence in 0.3, the AI line, deleting answers on withdrawal, the CSP change).
