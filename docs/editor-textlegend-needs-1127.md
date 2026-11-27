# Text size and Legend position: what the server twins must add (WEB 11-27)

ENGINE's branch `engine-style-keys-1127` (ac12ef9f, Ryagram repo) adds two look keys to the story schema (`ryagram/worker/schema.py`, `story.schema.json`, under `style_overrides`):

| draft look key | story path | kind | bounds / values |
| --- | --- | --- | --- |
| `text.scale` | `style.text.scale` | number | 0.85 to 1.0 inclusive (finite) |
| `layout.legend_position` | `style.layout.legend_position` | enum | `bottom_left` (the engine's default) or `bottom_right` |

The page half is built and shipped DARK. The editor core holds `LOOK_KEYS_V2 = false` (`assets/app-editor-core.js`). While it is false the keys are not in the editor's `LOOK_KEYS`,
no control is drawn, and nothing is sent. The mock turns it on with `?lookv2` so the controls can be seen and tested. Nothing in the page changes the data or the number rule.

## What to add (both twins together, one change)

1. SQL, `public.edit_look_keys` (migration `20261027000400_live_editor.sql` holds the first nine rows; add a reviewed new migration, never edit that one):
   - `('text.scale', 'number', null, 0.85, 1.0, false)`
   - `('layout.legend_position', 'enum', array['bottom_left', 'bottom_right'], null, null, false)`
   - `edit_op_problem` already reads kind, choices, min and max from the table: no function change. Its refusals ("must be between 0.85 and 1", "can only be: bottom_left, bottom_right") must be the same words as the TypeScript twin.
2. TypeScript, `supabase/functions/connect-core/edit_state.ts` `LOOK_KEYS`:
   - `{ key: "text.scale", kind: "number", min: 0.85, max: 1.0 }`
   - `{ key: "layout.legend_position", kind: "enum", choices: ["bottom_left", "bottom_right"] }`
   - and the connector's tool input schemas that list the keys (read from `LOOK_KEYS`; check `tests/connect-edit-tools.test.mjs`).
3. The draft-to-story step that turns look keys into `style_overrides` (the worker's look apply, and `assets/app-editor-data.js` `storyOverrides` for the page's own preview) maps `text.scale` to `style.text.scale` and `layout.legend_position` to `style.layout.legend_position`. The page's preview cannot draw them (ENGINE's drawer, `assets/preview/look-draw.js`, would have to); the controls say so in words.
4. Shared cases: add the keys to `look_keys` and the cases in `tests/edit-op-cases-textlegend-1127.json` to `tests/edit-op-cases.json` (SQL `supabase/tests/test_live_editor.py` and `tests/connect-edit-tools.test.mjs` run that file through both twins). It is kept in a separate file now because adding it before the twins know the keys would fail both.
5. Then, and only then, set `LOOK_KEYS_V2 = true` in the core, add the keys to `Object.keys(E.LOOK_KEYS)`-based vectors (`tools/make-edit-vectors.mjs` regenerates `tests/edit-vectors.json`), bump the stamps, and regenerate `tools/build-chat-editor.mjs` and `tools/build-maker-live.mjs` output.

## Tests that must still pass

- `tests/editor-textlegend-1127.test.mjs`: gate off by default, bounds refused (never clamped), undo/redo byte-equal, data unchanged.
- `tests/editor-colours-1127.test.mjs` and the other editor tests (undo, redo, a11y, poll).
- SQL and TypeScript twin cases (`tests/edit-op-cases.json`): the same accepted and refused ops on both sides.
- Honesty (no control may change the data or the number rule): neither key may alter a series value, a label taken from the data, a year, the order of rows, or how a number is written (a number is drawn as the data states it, never rounded, rescaled or hidden by a setting). `text.scale` only multiplies type sizes inside the engine's checked range (the engine refuses rather than shrinks past it); `layout.legend_position` only moves the colour key, never removes it, and the engine refuses it in words on other views, portrait frames, a map with a run strip, or a footnote that would collide. The page must show that refusal when the final film says it, not hide it.
- Refusals in words: an unknown key, a value outside 0.85 to 1.0, or any other position word is refused by both twins with a plain sentence.

## Page behaviour (for CONNECT and ENGINE to know)

- "Text size": Smaller (0.85), A little smaller (0.92), Normal (1.0), and "The film's own" (`unset_look`). "Legend position": Bottom left, Bottom right, "The film's own". Each is a real button, at least 44 px tall, `aria-pressed`, disabled while a render uses the draft. One use is one op and one Undo step.
- The "what will render" list names both rows when set.
