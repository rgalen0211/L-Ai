# Editor timeline layer: status against FACES' control table (WEB, 2026-11-27)

Source note: proposals/FACES-EDITOR-CONTROLS-DESIGN-1127.md is not on any branch or checkout WEB can read (FACES has not pushed it). This audit uses FACES' 08:4x post (the 14-control table is summarised there) and the live code at head web-editor-keys-fix-1127. Re-check the rows against the doc once it lands.

Honesty rules (FACES): text carries no numbers; durations never change what is shown; a look edit never changes the numbers; every control has an AI twin and the reverse.

## Table

| Control | Exists today | AI twin | Honesty rule and pinning test | Status / what blocks it | Builds |
|---|---|---|---|---|---|
| Scrub (slider, ruler, tile strip) | Data film: assets/app-editor.js:317-338 (range), :365 strip, assets/app-editor-timeline.js:61 build. Clip film: app-editor-film.js:70-90, ruler timeline.js:103 | None, and none needed: a playhead is not a change | Never an op. tests/editor-timeline.test.mjs (keys, ruler, strip); NEW tests/editor-timeline-honesty-1127.test.mjs pins "keys name a place, no op" | Done | WEB |
| Slider keys (arrows, Shift, J K L, Home End) | timeline.js:33 keyTarget; app-editor.js:331; app-editor-film.js:77 | n/a | editor-timeline.test.mjs "keyTarget" and "wiring" | Done | WEB |
| Trim clip start/end (clip film) | core.js:136-155 check, :194 apply; app-editor.js:818 (Length box), pace.js, padding.js, pro.js:168 (split) | Yes: `edit_tracks` op `trim_clip` (tools.ts:714; edit_state.ts:83; same cases in tests/edit-op-cases.json) | Number rule: min 0.3 s, never past the file (max_len), never outside the film. live-editor-core.test.mjs "trimming never...", "per-clip limits"; editor-padding.test.mjs; editor-pace.test.mjs; NEW honesty test (trim never changes look/words/pictures/source; Undo is byte-equal) | Done for clip films | WEB, CONNECT |
| Move clip (text, picture, music) | core.js:130, app-editor.js:817, drag + arrows | `edit_tracks` `move_clip` | Same tests; video clips refuse (follow each other) | Done | WEB, CONNECT |
| Reorder video clip | core.js:156 | `edit_tracks` `reorder_clip` | live-editor-core "reordering keeps one run" | Done | WEB, CONNECT |
| Per-scene seconds, clip film | Same as trim (the Length box); picture rules have `seconds` 0.5-10 (core.js:113) | `set_rule` seconds; trim | Bounds in core; live-editor-core "the five ops" | Done | WEB |
| Per-scene seconds, DATA film: title card | NO. The story schema has a seconds field (supabase/pipe1/story.schema.json:574, 0.5-12) for a clip, but no editor key, no look key | None | Not pinned | Blocked: not in `edit_look_keys` (edit_state.ts:8, nine keys) or the SQL list; engine must accept it as a style override that cannot touch periods | ENGINE (key), CONNECT (SQL + TS list), WEB (box) |
| Per-scene seconds, DATA film: outro | NO. Schema `outro.seconds` 5-20 (story.schema.json:37-44) exists, not in the editor | None | Not pinned | Same block as above | ENGINE, CONNECT, WEB |
| Period seconds on a data film (`hold_seconds` 0-10, schema :102) | NO, and FACES says never: it would change how long each number is shown | None, and must stay refused | NEW test pins that a data film refuses all timeline ops | Intended gap. Keep out of the list | none |
| Title / caption text on data film | NO (core.js:87 has set_clip_text for clip films only) | None for data films | Number rule not yet written | Blocked on FACES' yes and the number rule | WEB, CONNECT |
| Undo | core.js:290 undo, Undo button | `undo_my_changes` (tools.ts:732) | editor-core tests | Done | WEB, CONNECT |
| Redo | core.js:299 redoOne; Redo button and Ctrl+Y (this branch) | NO twin | tests/editor-redo-1127.test.mjs | UI done; connector twin missing | CONNECT |
| Shortcuts list `?` | This branch (keys fix) | n/a | editor-redo-1127 "PAGE" test | Done | WEB |

## Gaps in order

1. `redo_my_changes` does not exist (CONNECT). Every other control with a page button has a twin; this one breaks "every control has an AI twin".
2. Data-film title and outro seconds: the schema has the fields, nothing lets the person or the AI set them. ENGINE must name two keys (below), then CONNECT adds them to SQL `edit_look_keys` and edit_state.ts together (a test fails if the lists disagree), then WEB adds the boxes. Period seconds stay out.
3. Data-film title text with the number rule: needs FACES' yes on the labels; WEB can write the rule as a pure function and a test first.

## Op shapes for what is missing

All are existing op names where possible, so the closed op list does not grow.

- `set_look {key: "sequence.title_seconds", value: number}`: data films only. Bounds 0.5 to 12, step 0.1. Refused on anything else with "That setting is not available yet." (existing wording).
- `set_look {key: "sequence.outro_seconds", value: number}`: data films only. Bounds 5 to 20 (the schema's own), step 0.5.
- `unset_look {key}` for either: returns to the film's own length.
- Neither key may be allowed to touch `hold_seconds`, frames or data. ENGINE must prove with the sheet-path check that the numbers on screen are identical with and without the key.
- `redo_my_changes {}`: no args. Redoes the last undone batch of the same session, refused with "Nothing to redo." when the redo list is empty or a new change was made after the undo. Same scope (`edit`) as `undo_my_changes`; result carries `{revision, changes}`.
- `set_look {key: "text.title", value: string}` (data film title, later): 1 to 60 characters, plain words (the existing `plainPhrase` rule, core.js:32), AND no digit run unless it is one of the film's own years; refused in words.
- Page side for the seconds keys: a number box with min/max/step from the one shared table (`editor-controls.json`, CONNECT), the last good value restored on a bad entry (as the border box does at app-editor.js:597-601).

## Test added

tests/editor-timeline-honesty-1127.test.mjs (4 tests): time edits never change look, words, pictures or sources; Undo returns the first state byte for byte; a film with no clips refuses every timeline op in words; slider keys never produce an op. Tests for the missing keys belong with the change that adds them.
