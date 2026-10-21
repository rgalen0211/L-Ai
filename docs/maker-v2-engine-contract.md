# Maker v2: what the maker saves, and what ENGINE has to provide (stub interface; CONNECT 2026-10-20)

Status: the maker side exists behind `--v2` (or `RYAGRAM_MAKER_V2=1`), OFF by default. **ENGINE's side now exists on a branch (section 5), not yet merged**, so the page says plainly that the pictures are saved and checked but not drawn into the film. Design: `proposals\CONNECT-MAKER-V2-DESIGN.md` (sections 3, 5, 8).

## 1. What the maker writes: `overlays.json` in the work folder
```json
{
  "schema": "ryagram.maker-overlays/0",
  "saved": "2026-10-20 14:03:07",
  "images": [{"id": "img-1a2b3c4d", "file_name": "logo.png", "path": "C:\\...\\logo.png", "sha256": "...", "width": 800, "height": 600, "bytes": 51234, "rights_ticked": true}],
  "rules":  [{"phrase": "great news", "image_id": "img-1a2b3c4d", "seconds": 2.0, "mode": "full", "fade_s": 0.2}],
  "occurrences": [{"rule": 0, "at_s": [12.4, 31.0], "approximate": true}]
}
```
* `mode` is one of `full`, `centre`, `corner`, `lower_third`. `seconds` is 0.5 to 10. `fade_s` is 0 to 1 and at most half of `seconds`.
* The path stays inside the work folder of THIS computer. A receipt names pictures by file name and SHA-256 only, never by path.
* A picture is accepted only if its own first bytes say it is a still PNG, JPEG or WEBP (not animated, at most 20 MB and 25 million pixels), and a rule can use it only after the person ticked "I have the right to use this picture" (recorded as `rights_ticked`).

## 2. What ENGINE must provide (not built; CONNECT does not write it)
1. **Word times of the output film** in `plan` (and the receipt): for each clip, each word with its start and end in the FINISHED film's timeline. Until then the maker spreads a clip's words evenly over the clip's length and marks every occurrence `approximate: true`.
2. **A finishing pass** that reads `overlays.json` after the proven cut-and-join and draws each picture at each occurrence (ffmpeg `overlay` with `enable='between(t,a,b)'`, fade in and out, the placement from `mode`), in ONE extra pass. With no rules the pass is skipped and the film is byte-identical to today's.
3. The same overlay spec drawn by the browser preview (design section 4) so the preview and the render agree.

## 3. Defaults the maker uses, pending Ryan (design section 8)
Occurrences are looked for in the words of the BUILT film; placements are full frame, centre, corner, lower third; no dragging; captions and text overlays are not in this slice.

## 4. What stays on this computer (CC1 13:47, LOW-3)
* `overlays.json` is **never uploaded and never put into a receipt.** It keeps full file paths, and it lives only in the local work folder.
* The receipt names a picture by **name and sha256 only**, never by path.
* ENGINE **re-checks each picture's sha256 before drawing it**, so a file swapped after the person ticked the rights box is refused rather than drawn.
* A picture rule can put a real person's face beside words in another real person's voice. That is legal row G7 (CC1) in LEGAL-QUESTIONS-FOR-ATTORNEY.md; it does not block a test feature that is off.

## 5. ENGINE side, built (CONNECT 113, Ryagram branch `overlays-engine`; nothing live)
* `python -m ryagram.local plan|build ... --overlays overlays.json` (and `engine.plan/build(..., overlays=spec)`). The spec is the file above, with three optional additions: `captions` `{"on": bool, "size": "small"|"medium"|"large"}` (off unless asked), `texts` `[{"text", "start_s", "seconds", "position": "top"|"centre"|"bottom"}]` (at most 20, each 0.5 to 30 s), `look` `{"theme": "dark"|"light"}` (dark default; the dark page colour 0x14141a with light text, light swaps them).
* The answer of `plan` now always carries `words`: every word of the FINISHED film with `start_s`, `end_s` and its clip number (the receipt carries the MEASURED ones). With a spec it also carries `overlays`: per rule the picture's NAME, how many times the phrase is said and when (`at`), a plain-words `warning` when it is never said (nothing is drawn for that rule), and the number of caption lines and texts.
* `build` cuts and joins exactly as before, then ONE finishing pass draws the pictures, captions and texts on the film. With nothing to draw the pass is skipped and the film is byte-identical to the build without a spec. The receipt's `overlays.finish` says what was done; pictures are named by file name and SHA-256 only, never by path.
* Before anything is listened to the engine re-checks every picture a rule uses: it is there, its own first bytes say still PNG, JPEG or WEBP, it is at most 20 MB, its SHA-256 is the one the maker saved (a swapped file is refused) and the rights box was ticked. Shape limits: 20 pictures, 20 rules, 20 texts, 0.5 to 10 s, fade at most half of that, 200 drawn pictures in one film.
* Song films take no overlays yet (refused in words).
* Not built: music, drag to position, free text styling, the preview page. The font is the system's own (Arial on Windows, DejaVu elsewhere), copied into the work folder for the pass only.
