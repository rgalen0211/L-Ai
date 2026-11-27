# Clip film editor walk, 2026-11-27

Walked /app/?mock#/editor/compilation (Simple and Pro) at 360, 390, 768, 1280 with Playwright: scrub, trim (Shorter/Longer, Length seconds), reorder (Up/Down), move (Earlier/Later), split (Pro). No sideways scroll, no overlaps, no page errors at any width. Screenshots: D:/Ryagram-scratch/WEB/clipwalk.

## Fixed in CSS (assets/app-editor.css, assets/app-editor-pro.css)
- Pro J, K, L buttons were 40 to 43 px wide at 768 and 1280: now min-width 44.
- 360 px, Pro: the Pro tools wrapped to about 450 px, putting the picture at y 1000 of a 740 px screen. Now one swipeable row; the picture is at y 597.
- 360 px: top buttons took five rows; now three to a row (picture 56 px higher).

## Needs the three forbidden files (not changed)
- assets/app-editor.js:319 the time slider has only an aria-label: no aria-valuetext, so a screen reader hears a raw number, not "0:04.4 of 0:12.0". Set range.setAttribute('aria-valuetext', ...) where the readout is painted.
- assets/app-editor.js:82 say() fills the role=status line only for some actions. After Shorter, Later, Up and a typed Length the status stayed empty (checked at 360), so a screen-reader user gets no confirmation of a trim or move. apply() should say e.g. "Shortened to 2.9 s." / "Moved later."
- assets/app-editor.js:~828 (the Pro bar sits above the picture, inserted in app-editor-pro.js:221 after .le-top): a real fix is to insert it after the scrub row, not before the picture; needs the order in app-editor.js (or pro.js:221, which is allowed, if wanted next).
