# Games phone walk at 390 px, Fri 11-27

Walked by WEB on `origin/games-on-push1-flip-1127` (584da583; page from games-on-push1-1127 89dfedb9). Read-mostly: no code was changed.

## How it was driven

- Host: 1280x800 on `/app/?mock&aiconnected&gameson&relay=...#/d/games`. Phones: 390x844 mobile contexts (touch, 2x) on `/game-phone/?relay=...`, one context per player.
- GAMES' own `tools/game-relay.mjs` on 127.0.0.1 only; a local static server on 127.0.0.1 only (its CSP `connect-src` widened for the relay, the same test-tool gap RENDERER logged at 09:59). Every request to any other host was aborted (only the supabase script and the Google font were attempted). No Postgres, no accounts, mock only.
- Playwright (Python, headless Chromium). Screenshots are full-page, 780 px wide, and stay in `D:/Ryagram-scratch/WEB/gameswalk-shots/` (not in git). Driver: `D:/Ryagram-scratch/WEB/gameswalk-tmp/walk.py`, raw numbers in `walk.json`.
- Per screen the driver measured: document scrollWidth against the viewport, every element's bounding rect against the viewport (the screen-reader-only live region sits at left -9999 on purpose and is ignored), every button/input under 44 px, clipped text, live regions, focus, and the forbidden word list.
- Screens: 42 phone screens (rows below) plus 14 host screens (index at the end). No page error, no console error. No `null`, `undefined`, `NaN` or raw error text on any screen.

## Result in one paragraph

At 390 px there is no horizontal scroll on any screen, every tap target is at least 44 px (buttons 52 px high, inputs 16 px font so iOS does not zoom), nothing is clipped, and every error is in plain words. The round played through: create, join two phones, duplicate name, bad and wrong code, start, two guesses, reveal, round 2, reload and rejoin, leave, no rejoin mid-game, rounds 3 to 5, final scores, play again, host Remove, lock/unlock, 9th phone refused.

## Defects, worst first

1. Enter in the guess box does not send. It adds a line. Only the Send button sends, and no text says so. `assets/game-phone-live.js:288` (textarea, no keydown handler). Shot 16.
2. The guess box accepts 160 characters while the counter says "of 120": it shows "160 of 120 characters" with no warning, and the round took the overlong guess. `assets/game-phone-live.js:288` (`maxlength = ANSWER_MAX + 40`). Shot 18.
3. After Play again, a phone still on the end screen keeps the old live-region line "The game is over. You came 1st..." while the lobby shows, and nothing says a new game is starting. `assets/game-phone-live.js:331` (live text set, not cleared when `lobby()` runs at :268). Shot 31.
4. The guess box is not focused when a round starts (focus goes to the heading, by design `:126`). A player taps the box each round. Not a bug if intended; noted because focus was asked about.
5. The label "WHAT WAS SAID SO FAR" is 13.6 px, the smallest text on the phones. `assets/game-phone.css:11` (`.85rem`). Everything else is 15 px or more.

Smaller: the lobby Leave button leaves at once while the in-game one needs two presses (`assets/game-phone-live.js:273` against `:340`); the DRAFT banner takes about a third of the first screen on the join form and the removed screen; when the host closes the tab the phones show no notice (shot 42); the full-room screen changes the button to "Try again" (`:243`).

## Words you asked about (upload, clip, private, safe, secure)

- "private": phone join form, every time it shows: "A room is a public channel: anyone with the code can join. Do not type anything private." (`assets/game-phone-live.js:44`). A warning, not a claim.
- "secure": only if the browser cannot sign messages: "Open this page on a secure (https) address ..." (`assets/game-phone-live.js:199`; host page `assets/app-games.js:566`). Not reached in this walk (127.0.0.1 counts as secure).
- Host lobby: "it is not stranger-proof". No "upload", "clip", "safe" or "encrypt" appears on any screen walked.

## Focus, keyboard, live regions

- Every screen change moves focus to the screen heading (tabindex -1); errors move focus to the field at fault. Join with Enter works. Enter does not send a guess (defect 1).
- Status changes are announced: `.ph-live` (polite) carries joins, rounds, reveals, final scores and the leave prompt; errors are role alert; the timer is aria-live off. The Players line and game line in the lobby are polite.
- Labels: "Room code" (with hint), "Your name", and the guess box is labelled "Your guess for the next line".

## Screens (phone, 390 px)

| # | Step | Shot (in `D:/Ryagram-scratch/WEB/gameswalk-shots/`) | Findings | Measures |
|---|------|------|------|------|
| 1 | 1 join form first load (A) | 01-1-join-form-first-load-A.png | Join form. Code field 8 letters, autocapitalize on, name field autocomplete nickname. Header banner (DRAFT) fills about a third of the first screen. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none; words: private |
| 2 | 2 empty submit (A) | 02-2-empty-submit-A.png | Empty submit: both errors shown, focus goes to the code field, errors are role alert. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none; words: private |
| 3 | 3 malformed code QQ (A) | 03-3-malformed-code-qq-A.png | Malformed code (QQ): plain-words error "8 letters ... no I, no O and no numbers", focus on code. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none; words: private |
| 4 | 4 code with a digit (A) | 04-4-code-with-a-digit-A.png | Code with a digit: same error, good. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none; words: private |
| 5 | 5 wrong code 8 letters (A) | 05-5-wrong-code-8-letters-A.png | Wrong 8-letter code: "No room with that code answered" after the ~9 s wait; no "Joining..." progress text was seen during the wait (not captured). | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none; words: private |
| 6 | 6 name empty (A) | 06-6-name-empty-A.png | Empty name: "Type a name for the scoreboard." | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none; words: private |
| 7 | 7 name too long (40 chars) (A) | 07-7-name-too-long-40-chars-A.png | 40-char name: "A name is at most 16 letters." Name input maxlength is 24, so it is rejected, not cut. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none; words: private |
| 8 | 8 join A (lowercase code, Enter key) (A) | 08-8-join-a-lowercase-code-enter-key-A.png | Joined with Enter in the name field (works) and a lowercase code (accepted). Focus moves to the h2. Live region says "You joined room ...". | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 9 | 9 duplicate name (B) | 09-9-duplicate-name-B.png | Duplicate name (ana vs Ana): refused in plain words, focus on name. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none; words: private |
| 10 | 10 join B (B) | 10-10-join-b-B.png | B joined; Players line is aria-live polite. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 11 | 11 A lobby after B joined (A) | 11-11-a-lobby-after-b-joined-A.png | A lobby after B joined: Players line updated live. The status line "You joined room ... as Ana" is stale but harmless. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 12 | 12 round 1 prompt (A) | 12-12-round-1-prompt-A.png | Round 1 prompt: all targets >= 44 px. "WHAT WAS SAID SO FAR" label is 13.6 px (assets/game-phone.css:11, .85rem). Focus is on the heading, not the guess box (guess box is NOT auto-focused). Timer is aria-live off (good). | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 13 | 13 round 1 prompt (B) | 13-13-round-1-prompt-B.png | Same for B. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 14 | 14 send empty guess (A) | 14-14-send-empty-guess-A.png | Send with empty box: "Type your guess first." as role alert, focus goes to the guess box. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 15 | 15 guess typed (A) | 15-15-guess-typed-A.png | Typed guess: counter updates ("19 of 120 characters"). | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 16 | 16 A pressed Enter in guess box (A) | 16-16-a-pressed-enter-in-guess-box-A.png | DEFECT: Enter inside the guess box adds a new line and does NOT send; only the Send button does (assets/game-phone-live.js:288, textarea with no keydown handler). Nothing on screen says so. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 17 | 16c A tapped Send my guess (A) | 17-16c-a-tapped-send-my-guess-A.png | Tapped Send: "Sent: ... You can change it until time is up." as a status line, focus stays on the button. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 18 | 17 B overlong guess 400 chars (B) | 18-17-b-overlong-guess-400-chars-B.png | 400 characters pasted: box keeps 160 and the counter reads "160 of 120 characters" with no warning (assets/game-phone-live.js:288 maxlength = ANSWER_MAX + 40). B then sent it and the round revealed, so the overlong guess was accepted. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 19 | 18 B sent -> reveal (B) | 19-18-b-sent-reveal-B.png | B after both guessed: answer reveal, "You scored 0", scoreboard Ana/Ben. Live region announces it. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 20 | 19 reveal (A) | 20-19-reveal-A.png | A reveal, same. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 21 | 20 round 2 (A) | 21-20-round-2-A.png | Round 2 prompt, A. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 22 | 21 round 2 (B) | 22-21-round-2-B.png | Round 2 prompt, B. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 23 | 22 A reloaded: rejoin form (A) | 23-22-a-reloaded-rejoin-form-A.png | A reloaded: rejoin form says "You were in room ... Press Join the room to go back in with your score." (role status). Code and name fields are empty, so the button works without retyping. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none; words: private |
| 24 | 23 A back in round 2 (A) | 24-23-a-back-in-round-2-A.png | A back in round 2 with the seat. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 25 | 24 B leave first press (B) | 25-24-b-leave-first-press-B.png | In-game Leave first press: button text and live region say "Press again to leave this game." Two-step works. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 26 | 25 B left (B) | 26-25-b-left-B.png | B left: back on the join form with "You left the room." | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none; words: private |
| 27 | 26 A guessed after B left (A) | 27-26-a-guessed-after-b-left-A.png | A guessed after B left: reveal fires with one player. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 28 | 27 B rejoin mid-game (B) | 28-27-b-rejoin-mid-game-B.png | B rejoin mid-game: "This game has already started. Wait for the next one." in the join note (role alert), focus on the button. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none; words: private |
| 29 | 28 round 3 reveal (A) | 29-28-round-3-reveal-A.png | Round 3 reveal. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 30 | 29 final scores (A) | 30-29-final-scores-A.png | Final scores: "You came 1st with 5 points", list 1. Ana 2. Ben. Phone shows Leave the room only (no "waiting for host" line). | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 31 | 30 after play again (A) | 31-30-after-play-again-A.png | After the host pressed Play again: A is back in a lobby, but the live region still reads the old "The game is over. You came 1st with 5 points." and the screen has no sentence saying a new game is starting. B was not in this lobby (had left). | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 32 | 31 C joined lobby (C) | 32-31-c-joined-lobby-C.png | C joined the new lobby. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 33 | 32 C removed by host (C) | 33-32-c-removed-by-host-C.png | Host removed C: "The host removed you from this game." plus Back button; one visible line (the heading), the same words also sit in the live region. Focus goes to the heading. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 34 | 32c C taps Back after removal (C) | 34-32c-c-taps-back-after-removal-C.png | C pressed Back: join form, empty. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none; words: private |
| 35 | 33 C tries same name again (C) | 35-33-c-tries-same-name-again-C.png | C tried the removed name again: "Please pick a different name." in plain words. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none; words: private |
| 36 | 34 C retries new name (C) | 36-34-c-retries-new-name-C.png | C joined with a new name (Cyril). The host page says Remove is a courtesy and not a ban, so this is as documented. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 37 | 35 ninth phone full (N) | 37-35-ninth-phone-full-N.png | 9th phone, room full: "Room is full. All 8 seats are taken. Ask the host to remove someone, or wait for the next game." and the button changes to "Try again" (assets/game-phone-live.js:243). | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none; words: private |
| 38 | 35c lobby leave first press (x0) | 38-35c-lobby-leave-first-press-x0.png | Lobby Leave (first press): leaves at once with no confirm, unlike the in-game two-step. Inconsistent but low risk. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none; words: private |
| 39 | 35d lobby after leave (x0) | 39-35d-lobby-after-leave-x0.png | After lobby leave: join form with "You left the room." | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none; words: private |
| 40 | 36 locked room with free seat (N) | 40-36-locked-room-with-free-seat-N.png | Locked room with a free seat: "The room is locked. Ask the host to unlock it." | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none; words: private |
| 41 | 37 unlocked, joins (N) | 41-37-unlocked-joins-N.png | After unlock: 9th phone joins; Players line lists all 8 names on one line. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |
| 42 | 38 host closed tab (12 s) (A) | 42-38-host-closed-tab-12-s-A.png | Host closed the tab; 12 s later the phone still shows the lobby/final state with no notice that the host is gone. | hscroll: none (scrollWidth 390 / viewport 390); targets under 44 px: none |

## Host screens (1280x800), shots only

00-host-lobby-empty, 08b-host-sees-A, 10b-host-sees-A-B, 11b-host-round1, 16b-host-1of2, 19b-host-reveal, 25b-host-after-B-left, 29b-host-final, 30b-host-lobby-again, 31b-host-3-players, 32b-host-remove-confirm, 32c-host-after-remove, 35b-host-full, 36b-host-locked (all `.png` in the same folder). The host Remove has an inline confirm ("Yes, remove") and an "Allow again" undo; Lock/Unlock works and the 9th phone sees "The room is locked." The host page was not measured at 390 px (it is a desktop page).
