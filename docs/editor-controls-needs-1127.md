# Live editor controls that need a new op or engine key (WEB 11-27)

The editor page ships only controls built from ops the shared list already has (`set_look`, `unset_look`, and the clip ops in `tests/edit-op-cases.json`).
The controls below were asked for and are NOT built, because each needs a new look key or op. None of them may be faked in the page.

Rules for every twin (SQL `ryagram_private.edit_op_problem`, connect-core `edit_state.ts`, editor core `check`, the engine drawer):
- no control changes the data: no series values, labels taken from the data, years, or order of rows; and none may touch the number rule (a number is drawn as the data states it, never rounded, rescaled or hidden by a setting);
- every value is checked on both sides with the same bounds; an unknown key or bad value is refused in words, never clamped silently;
- each op is a look change: Undo and Redo return the look byte-equal; the final film renders the same as the preview.

## 1. Title text
- op: `set_look`, key `title.text`, value string, 1 to 80 characters, plain words (same rule as `plainPhrase`: no `<`, `>`, slashes, `http:`, `www.`). `unset_look` returns the film's own title.
- owner: ENGINE (the drawer must read it) then BUILDER (schema) then CONNECT (`edit_look_keys` row, case in `tests/edit-op-cases.json`).
- must not break: the title is a label only; it must not replace or hide the source line or the dataset's own claim text.

## 2. Caption text
- op: `set_look`, key `caption.text`, value string, 1 to 140 characters, same plain-words rule. Empty string is refused; use `unset_look`.
- must not break: the caption must never state a number that is not in the data; the page warns that the words are the person's own, and the film's source line stays.

## 3. Text size
- op: `set_look`, key `text.scale`, value number, 0.8 to 1.5 in steps of 0.1 (checked: finite, in range).
- must not break: scaling text must never clip or drop a value label; the drawer must refuse the film (not shrink the number) if a label would not fit.

## 4. Legend position
- op: `set_look`, key `legend.position`, enum `bottom` | `right` | `top` (no hidden option).
- must not break: the legend may move but never be removed, because it carries the scale a reader needs to read the colours honestly.

## 5. Bar colour for bar races (already named as waiting by ENGINE)
- op: `set_look`, key `bars.color`, value `#rrggbb`. Today the bars have one colour the worker cannot take.
- must not break: colour only; bar lengths and order come from the data.

## 6. Middle colour of a three-stop ramp (waiting for the worker)
- op: `set_look`, key `choropleth.mid`, value `#rrggbb`; `unset_look` returns the film's own.

For each: add the key to `tests/edit-op-cases.json` (`look_keys` and an ok case plus a refusal case), the SQL table, the TypeScript twin and the editor core's `LOOK_KEYS`; then the page can add the row, and `tests/editor-colours-1127.test.mjs` shows the pattern for the Undo/Redo and data-unchanged checks.
