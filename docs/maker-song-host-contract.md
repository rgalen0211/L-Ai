# The song screens: what they show, and what the maker (CONNECT 111) and the engine plug into them (WEB, NEXT-WEB 121)

Status: built on branch `maker-song-screens`, off. Nothing opens it yet: the maker does not serve it until CONNECT 111 wires the calls below. It runs on its own with `?fixture` (an invented build of four original lines; no song, no lyric, no maker, nothing fetched).

Try it: `python -m http.server 8199 --bind 127.0.0.1 -d tools/maker-song`, then open `http://127.0.0.1:8199/song.html?fixture`. Check it in real Chrome: `python tools/check-maker-song.py`. Model tests: `node --test tests/maker-song-model.test.mjs`. Same house style and same host idea as the edit page (`docs/maker-edit-host-contract.md`, branch `maker-edit-space`).

## 1. What the person sees (Claude's brief for item 121)
1. **Your words.** Paste the lyrics, one line of the song per line. A count ("4 lines, 20 words"). Nothing is uploaded. Too much or nothing is refused in plain words.
2. **Your music.** Choose the track; optionally add a track of just the singing (the "guide vocal", for example the person's own song-maker export). If the track has the singing in it the maker finds each word's beat from it.
3. **Your song, word by word** (after Build). A summary in plain words ("18 of 20 words are real voices (90%); 2 of 4 lines are fully real", "7 words are built from sounds ... the joins can sound a little robotic", "2 words are a gap: nobody in your files says them", words off the beat, words stretched, voice changes). Then **one lane per line: every word is a box on its beat** (time, word, who says it, a mark for "built from sounds", "gap", "quiet", and "check" when a rule flags it). **Hear this line** on every line.
   Press a word box for its detail, inside its line: who says it, the beat, where it comes from (file name and seconds), whether it is said as it is or **built from sounds** (the pieces, e.g. "tex + as"), how far it was stretched, how far it lands from the beat, the flags in plain words, **Hear this word**, and **the other takes of this word with Hear it / Use this one** (the swap). A **gap** says plainly that nobody in the chosen videos says it and offers **Leave this beat quiet** (and to put it back); to use another word the person changes the words in step 1 and presses Build again.
4. **Make the film** (the only step that costs time) and **Save my song**.

Plain words only: a voice with no name is "Voice 1", "Voice 2" (never an id); "built from sounds", never phoneme or syllable jargon; no exit codes or model names.

## 2. The song plan (`ryagram.song-plan/0`): what the engine returns, validated by `song-model.js`
```json
{"schema":"ryagram.song-plan/0",
 "track":{"file_name":"my-song.mp3","seconds":40}, "guide":{"file_name":"my-singing.wav"},
 "cast":[{"id":"v-a","name":null},{"id":"v-b","name":"Narrator"}],
 "lines":[{"text":"<the line as pasted>","words":[
   {"w":"morning","beat_s":0.62,"end_s":1.14,"status":"syllables","speaker_id":"v-a","file_name":"first-video.mp4",
    "src_s":13.4,"src_e":13.85,"stretch":1.7,"offset_ms":-8,"step_db":2.5,"burst":false,
    "pieces":[{"text":"morn","speaker_id":"v-a"},{"text":"ing","speaker_id":"v-a"}],
    "alternatives":[{"id":"alt-1-2-a","speaker_id":"v-b","file_name":"third-video.mp4","src_s":22.4,"src_e":22.9,"stretch":1.1,"offset_ms":4}]},
   {"w":"quiet","beat_s":7.1,"end_s":7.62,"status":"gap"}]}]}
```
* `status`: `whole` (said as it is), `syllables` or `phonemes` (built from sounds; R3 of CLAUDE-BIG-CLUB-V3-RULES.md), `gap` (a stated gap). A gap carries no clip. `quiet: true` is the person's choice to leave a gap's beat quiet.
* **A built word is ONE person's sounds** (R3): the validator refuses a plan whose pieces mix two people ("A word is built from one person's sounds only") and one that has fewer than two pieces.
* `beat_s / end_s` are the word's slot in the music (from the guide vocal's alignment). `offset_ms` is how far the placed word lands from its beat (R1: more than 30 ms is flagged on screen; the engine's own check must-fail stays the authority). It may be **absent or null** (CONNECT S4: the plan rows carry no offset, the receipt has the measured ones): the page then says "Not measured yet", never flags it and never counts it. `stretch` is the time-stretch factor (R1: beyond 3x or under 0.5x is flagged "stretched a lot / squeezed a lot" for the listen-pass, not blocked). `step_db` the loudest level jump at a join (over 6 dB is flagged). `burst` marks a stretch where the audio changes source quickly and the picture holds the first clip (R4).
* A voice change inside a line is flagged where it happens; the summary counts them (R2 D).
* **Names, never paths.** Files are named by file name only (a path is refused); speakers by `id` with an optional name. The plan is never uploaded and holds no path.
* `alternatives` are the other takes of the same word (another person, or another occurrence) the engine already searched. **Use this one** swaps one in; the replaced take goes into `alternatives` so the person can go back. The page recomputes the summary itself from the words, so it always agrees with what is shown.
* Stable bytes: saving what was opened gives the same text (no minus zero, canonical order).

## 3. The host (`window.ryagramSongFixtureHost`, or the maker host built into `song.js`)
Calls carry the maker's token in `X-Maker-Token` (taken from `?t=` or sessionStorage); the sound is fetched with the same header and played from a `blob:` address, so the token is never in an address or in history. Nothing leaves the maker's own address (`connect-src 'self'`, `media-src 'self' blob:`).

| Page call | Maker route | Answer |
|---|---|---|
| `load()` | `GET /api/song` | `{"plan": <song plan> or null}` (null = nothing saved: the page starts at step 1) |
| `pickTrack()` / `pickGuide()` | `POST /api/song/track` / `/api/song/guide` | `{"track": {file_name, seconds}}` / `{"guide": {file_name}}` (the maker checks the file is real audio, as today) |
| `build({lines, track, guide})` | `POST /api/song/build` | `{"plan": ...}` (a long job: the page shows "Building..." and the maker answers when done, or streams progress later) |
| `hear({kind: "line"|"word"|"alt", n, i, id})` | `POST /api/song/hear` | `{"url": "/api/song/audio?..."}` (fetched with the token header; the audio of that line, word or other take, mixed over the music) or null; with null the practice build plays a tone per word |
| `save(text)` | `POST /api/song` `{"plan": ...}` | `{"saved": true}` (the maker validates again and writes `song.json` beside the film) |
| `render(plan)` | `POST /api/song/render` | `{"message": ...}`; one at a time (the page turns the button off; the maker must refuse a second too) |
| `back()` | navigate to the Plan page | |

Errors: any non-200 with `{"error": "plain sentence"}`; the page shows the sentence and never the status code. `song.html` has a locked content policy (`default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'`); a maker that serves it should send the same as a header.

## 4. Open choices (Ryan's, not made here)
* **What fills an uncovered beat** (CLAUDE-BIG-CLUB-V3-RULES.md, "What is Ryan's"): the page offers "Leave this beat quiet" per gap and says so plainly, with "change the words and Build again" as the other way. Options the rules list and the page does not offer yet: instrumental fill, only fully covered lines, a reworded line chosen on this page, wait. Ryan picks; the page then adds the button.
* Pitch matching, white house graphics, M3 legal: not here.
* Everything stays internal and person-checked (Ryan 10-20): the screens add no automation and publish nothing.

## 5. Not built
Dragging a word to another beat; mixing level of the music against the voices; a waveform; playing the whole song with the picture (the film is the render's); reword-a-line in place (it needs the maker to look the new words up, so it is Build again).

## 6. Tests
`tests/maker-song-model.test.mjs` (9; 12 planted breakages caught: the 30 ms limit widened, the stretch limit widened, a built word mixing two people, a swap changing the old plan, a gap counted as a real voice, a voice shown as its id, a real word left quiet, a path accepted, minus zero kept, words out of order accepted, HTML built from text, a call to another address): the words, the plan validator, plain words per state, the flags, the swap, leave-quiet, save-then-open, the page's source.
`tools/check-maker-song.py` (real Chrome, local only): refuse a build with no words or no music in plain words; build; every word is a box named with line, beat, voice and state; summary; gap, quiet and put back; a built word shows its sounds; a flag says why; swap another take (the beat does not move, the replaced take can be chosen again); Hear this line (a tone per word with a voice); Tab then Enter on the word boxes; save, reload, same bytes; every control has a name; the film button off while a render runs; 375 px phone (no sideways page scroll, 44 px buttons); the maker host stand-in (token, track, guide, build request by name, hear, save equals the page's plan, one render, wrong token gives a plain sentence).
