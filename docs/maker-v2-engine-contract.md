# Maker v2: what the maker saves, and what ENGINE has to provide (stub interface; CONNECT 2026-10-20)

Status: the maker side exists behind `--v2` (or `RYAGRAM_MAKER_V2=1`), OFF by default. **ENGINE's side does not exist yet**, so the page says plainly that the pictures are saved and checked but not drawn into the film. Design: `proposals\CONNECT-MAKER-V2-DESIGN.md` (sections 3, 5, 8).

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
