# Compilations Requests tab: progress, counts only (WEB 11-27)

Ryan's finding (inbox 23:06): the Requests tab mirrors the desktop app's progress with COUNTS ONLY, never a file name, folder or word.

## The contract (BUILDER 23:12, MAILBOX "BUILDER CONFIRMS THE PROGRESS CONTRACT")

`my_compilation_get`'s `run` (and the row `run` in `myCompilationRequests`) gains `step_done`, `step_total`, `percent`, all whole integers or null.
`step_total` 0 to 1000; `step_done` 0 to `step_total` (only with `step_total`); `percent` 0 to 100. In planning and matching the step is a VIDEO; in building it is a CLIP.
The server nulls all three at done, failed, cancelled and stale. Absent means null, so old callers keep working.

## The words (assets/app-compilations.js, WORDS.progress, runLine)

- planning: `The Ryagram app is planning your film: video N of M, about P% overall.`
- matching: `The Ryagram app is finding the matches: video N of M, about P% overall.`
- building: `The Ryagram app is making your film: clip N of M, about P% overall.`
- only the valid parts are shown: the pair alone gives `video N of M.`; the percent alone gives `about P% overall.`; neither gives the old line.
- `step_done` 0 with a total says `getting started` (never "video 0 of M").
- anything not a whole number in range is ignored (strings, decimals, negatives, above 100, `step_done` above `step_total`, a total of 0 or above 1000); raw values are never printed.
- never for done, failed, cancelled, stale, unknown states, an earlier run (`current` false) or no run.
- a `<progress>` (max 100, `aria-valuemin/max/now`, an `aria-label`) sits directly under the run line, only when the percent is valid. It is a sibling of the polite status line, not inside it, so a changing value is not announced by the live region; no `aria-live` assertive anywhere.
- the page does not poll: the line changes when the list is drawn again.

## FOR RYAN'S YES

These are new public words on a page about a film the app does not yet make for everyone. The honest-launch sentences (nothing is made until the app opens for you) are unchanged; these lines appear only when a signed-in app computer reports a real run.

## Server side

The progress columns arrive in BUILDER's FUTURE migration 20261128000100. tests/compilations-server-contract-1127.test.mjs still pins the CURRENT migration (20261127000300) and is not changed; until the new migration is live every run has no counts and the page shows today's lines.

## Mock and tests

`?compon&comprun=matching&compstep=2:3:45` (done:total:percent; a field may be empty), or `compstep=<state>:<done>:<total>:<percent>`; bad variants `compstep=bad|over|dec|neg|big`.
tests/compilations-page-1127.test.mjs (PROGRESS tests); tools/check-compilations-page.py (progress states at 390 and 1280).
