# Connector parity: what a connected AI is told about options (NEXT-CONNECT 104)

**Ryan 13:49:** control and direction go through the user's connected AI, so the AI must be able to reach the full range of options the desktop app has. **The server-side story check stays the ONLY validator**; the list is wording.

## What changed

* `get_story_schema` now returns, after the engine rules, **a plain-words list of every option the shared list marks as the AI's** (128 story fields today): the path to write into the story, a label and one line of help, the choice words where there are choices, **the allowed values and hard limits** (taken from the list's own `hard` bounds), **what happens if it is left out** (the default, taken from the app's own "Your look" row where the two are the same option, otherwise "set by the engine"), and a "Careful" line where the list has one. Defaults are dark first: page dark, 1920 x 1080, 30 fps.
* `get_story_schema` with `option` set to a path or an id returns **the full explanation of that one option** (what it changes, when to use it, an example, what to be careful about) so the default answer stays short; an unknown name is refused in a sentence the AI can relay.
* The list names **what is NOT available yet** (planned, reserved and engine-only rows: 19 today) so the AI does not write them, and the one option that exists **only in the app's account look** (Smooth colours, `look.ramp.continuous`: no story field carries it yet).
* `set_story`'s description and the rules tell the AI to set an option by writing its path into the story and that a value outside its range is refused with the reason.

## Where the list comes from (and how to refresh it)

`supabase/functions/_shared/options_list.json` is a copy of WEB's merged `options.draft.json` (171 rows). `node tools/gen_options_list_ts.mjs` regenerates `options_list.ts` (ASCII only, with the source SHA-256); `tests/connect-options.test.mjs` fails if the two differ. The rows the AI sees are those with `source: story` and `connector: yes` and a path; profile rows that say `same_as` a story row lend it their default, choice words and longer help and are not listed twice.

## What the tests prove (12, with 22 deliberate breakages that all fail them)

The vendored list equals the source; every available row appears once with its bound and default; no TODO text; every hard limit is stated; dark-first defaults arrive through the profile twin; groups read in a person's order; **every row the list calls not available is really refused by the story check** (so the warning is true); the one-option explanation works and refuses an unknown name; and **for the 89 rows whose bound can be exercised on the template story, the real schema accepts an in-range value and refuses an out-of-range one in plain words** (no row promised more than the check allows). The other 39 are settings that need a particular chart type or data in the story (a network's shield settings, a bar race's callouts); the test run prints how many it could not exercise (39), so the gap is visible.

## What this does NOT do (decisions for Claude, WEB and Ryan)

1. **The account's default look cannot be set by the AI.** The per-film story fields cover every look option the app has except one (above), so an AI can make any film look any way; but "make this my default look from now on" is the profile (`set_engine_profile`), which has no connector tool. A tool for it would need a new write scope, a SQL wrapper, and CC1's review (about 2 days); I recommend waiting until someone asks for it.
2. **`look.ramp.continuous` has no story field.** Either ENGINE adds one or the list should say `connector: no` for it (WEB).
3. The 39 unexercised rows are checked by the schema in production but not by this test; a test story per chart type would cover them (about a day).
4. The text grows: the options section is about 32 KB of text on top of a 14 KB schema; `option` is the way to keep an AI's context small.
