# The edit-and-preview page: what it is, and what the maker (CONNECT) and the engine (ENGINE) plug into it (WEB, NEXT-WEB 120)

Status: built on branch `maker-edit-space`, off. Nothing opens it yet: the maker does not serve it until CONNECT 113 wires the calls below. The page runs on its own with `?fixture` (a made-up cut, original lines, no maker, nothing fetched).

Try it: `python -m http.server 8198 --bind 127.0.0.1 -d tools/maker-edit`, then open `http://127.0.0.1:8198/edit.html?fixture`. Check it in real Chrome: `python tools/check-maker-edit.py`. Model tests: `node --test tests/maker-edit-model.test.mjs`.

## 1. What the person gets (Ryan's words, SAM-KIT-SESSION2-NEEDS item 3)
After Plan makes the rough cut the person lands on **Edit your film**: the picture with a scrubber they can drag or step with the arrow keys (every moment shows), a strip of the clips in order (the words each says, length, file name), and three panels.
* **Clips:** trim the start or end by 0.1 s, move a clip earlier or later, take it out, choose a cut or a short crossfade into the next, play just that clip. Undo.
* **Images and text:** add a picture (tick "I have the right to use this picture"); the rule **"every time [words] is said, show [picture] for [N] seconds, [full frame / centre / corner / lower third], fade [s]"** with its occurrences listed ("3 times", each a button that jumps there); captions on or off (size, top or bottom); free text (what, when, how long, where).
* **Look:** dark (default) or light; text colour and box colour from a small palette; how solid the box is.
* **Warnings, never blocks:** a phrase that is not said ("'crypto' is not said in this film"), a picture without its tick, two pictures on top of each other, text over the captions, text past the end, colours hard to read together (contrast under 4.5), a very short clip.
* **Render** is the only step that spends time. Everything else is drawn in the browser from the edit list, free and at once. The page says so.

## 2. The edit list (`edit.json`, schema `ryagram.maker-edit/0`), written by `edit-model.js`
```json
{"schema":"ryagram.maker-edit/0","film":{"width":1280,"height":720,"fps":30},"seq":3,
 "clips":[{"id":"c1","file_name":"first-video.mp4","in_s":4,"out_s":5.8,"join":{"kind":"cut","s":0},
           "words":[{"w":"great","s":4.1,"e":4.55}, ...]}],
 "images":[{"id":"img-1","file_name":"logo.png","sha256":"<64 hex>","width":800,"height":600,"rights_ticked":true}],
 "rules":[{"id":"r1","phrase":"great news","image_id":"img-1","seconds":2,"mode":"full","fade_s":0.2}],
 "texts":[{"id":"t1","text":"Thanks for watching","start_s":10,"length_s":3,"position":"lower_third"}],
 "captions":{"on":true,"size":"medium","position":"bottom"},
 "look":{"theme":"dark","text_color":"#f3f6f5","box_color":"#000000","box_opacity":0.6,"letterbox":"#0b0f0e"},
 "music":null}
```
* **Names, never paths.** A clip or picture is named by file name; a picture also by SHA-256. The host maps an id to the file on the person's PC. The list is never uploaded and never goes into a receipt with a path (CONNECT-MAKER-V2 section 7, CC1 13:47). The validator refuses a path.
* **Word times.** `words[].s/e` are SOURCE times; the page places them in the FINISHED film (`timeline()` in the model) by the clips' order, trims and crossfades. ENGINE's real output word times (design: `plan` returns them) replace nothing here: they fill `words`.
* **One validator** (`normalize`): the page, a test and the host all go through it; bad lists are refused in plain words. It is a mirror of what the engine will accept, not a replacement for the engine's own check at render.
* `music` must be `null` for now (v2.1).
* **`mode`** (default `"compilation"`; older lists without it are compilations): ONE shared editing workspace for every kind of film (Claude 13:12). `features(mode)` says which tools the page offers: compilation has clips, slides, rules, captions, text and look; a **data film is declared** (text and look only; no clips, rules, captions or slides) **but refused until it is built** ("Editing a data film here is not built yet"). The page hides the Clips tab and the strip, and each fieldset, from the mode; the operations refuse what the mode does not use ("This kind of film does not use rules").
* **Folder-relative clip names:** a clip may name its video as a path INSIDE a folder the person chose (`my-clips/Season 2/a.mp4`; backslashes become slashes); a full path, `..`, a drive letter or a leading slash is refused ("never by a full path").
* **Slides (the person's own picture as its own stretch of the film):** a clip with `"slide": {"image_id": "img-1"}`, `file_name` = the picture's file name, `in_s` 0, `out_s` = how long it stays (0.5 to 10 s, up to 10 slides in a film, at the start, at the end or after a clip: the engine's own limits, CONNECT 13:44), no words, a cut or crossfade join like any clip. It needs the picture's rights tick (without it nothing draws and the page warns). `specs()` gives it as an `image` spec, full frame, for the clip's whole length with a 0.2 s fade; ENGINE draws it as a still-image clip (the sequence engine has one). The picture cannot be removed while a slide uses it.
* Saving gives stable bytes: saving what was opened gives the same text.

## 3. The overlay spec: ONE list, two drawers (for ENGINE's finishing pass)
`specs(edit)` returns the list the browser draws and the render must draw. Every item: `kind` (`image`, `caption`, `text`), `source` (picture id), `text`, `start_s`, `length_s`, a box `x, y, w, h` in the film's own 0..1 coordinates, `fade_s`, `z` (images under captions under text).
* **Where a picture sits:** `full` (0,0,1,1), `centre` (.25,.2,.5,.6), `corner` (.72,.05,.23,.26), `lower_third` (.08,.66,.84,.26). Pictures keep their shape inside the box (contain).
* **Fade:** linear in and out over `fade_s`; opacity at time t = min(1, (t-start)/fade, (start+length-t)/fade).
* **Captions:** one line per clip, split into runs of at most 7 words; each runs from its first word's start to its last word's end plus 0.15 s.
* **Rights:** a picture without `rights_ticked` produces no spec at all. ENGINE re-checks the picture's SHA-256 before drawing it (CONNECT contract, section 4).
* Same overlay in the browser (CSS) and the render (ffmpeg `overlay` / `drawtext`, one finishing pass after the proven cut-and-join, skipped when there is none) is what keeps preview and render equal. The preview-matches-render check (design section 6, item 2) is CONNECT/ENGINE's; the page gives it `window.ryagramEdit.frame(t)` (what is on screen at t) to compare against.

## 4. The host: the one object the page talks to
`window.ryagramEditFixtureHost` (practice cut) or the maker host built into `edit.js` (`apiHost`). Calls carry the maker's token in `X-Maker-Token` (taken from `?t=` or sessionStorage, as the maker page does); the picture is fetched with the same header and shown from a `blob:` address, so the token is never in an address or in history. Nothing leaves the maker's own address (`connect-src 'self'`).

| Page call | Maker route | Answer |
|---|---|---|
| `load()` | `GET /api/edit` | `{"edit": <edit list>}` |
| `save(text)` | `POST /api/edit` `{"edit": ...}` | `{"saved": true}` (the maker validates again, writes `edit.json` beside the film) |
| `proxy()` / `rebuildProxy(edit)` | `GET` / `POST /api/edit/proxy` | `{"state": "ready"|"updating"|"failed", "url": <address of the 360p rough-cut mp4, served with Range>|null}`; `null` = the page draws a stand-in picture with the words |
| `pickImage()` | `POST /api/image/pick` | `{"image": {id, file_name, sha256, width, height}}` (the maker checks it is a real still image, size caps, as today) |
| `imageUrl(id)` | `GET /api/image/file?id=..` (token in the header) | the picture bytes (the page shows them from a `blob:` address) |
| `render(edit)` | `POST /api/edit/render` | `{"message": ...}`; one at a time (the page turns the button off while it runs; the maker must also refuse a second) |
| `back()` | navigate to the Plan page | |

Errors: any non-200 with `{"error": "plain sentence"}`; the page shows the sentence and never the status code.
`edit.html` has a locked content policy (`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'`); a maker that serves it should send the same as a header.

## 5. Not built (v2.1 and later)
Music and its level; "other take" swap; dragging a picture or text on the film; transitions beyond cut and crossfade; free text styling; several tracks; a bundled font for the finished render (the page uses the person's system font; the render's font is ENGINE's). Song-mode screens are item 121.

## 6. Tests
`tests/maker-edit-model.test.mjs` (12; 12 planted breakages caught): validator, clock, the rule finds every occurrence (also across clip borders and after reordering; never a guess), rights tick, warnings, fade and frame at a second, the edits, save-then-open (same bytes, same picture every 0.1 s), page source (no HTML from text, one fetch to the maker, locked policy, no outside address), plain words.
`tools/check-maker-edit.py` (real Chrome; local only): scrub every second against the list; keyboard on the scrubber; add picture, tick, rule, captions, text; look and order; save, reload, same bytes and same picture at every half second; every control has a name; phone width (no sideways scroll, buttons 44 px); a second Render press refused; the maker host stand-in (token, load, pick, save equals the page's list, one render).
