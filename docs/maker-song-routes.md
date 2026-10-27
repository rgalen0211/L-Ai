# The maker's song routes (CONNECT 111b): what `tools/maker_song.py` does for WEB's song page

Off unless the maker is started with `--song` (or `RYAGRAM_MAKER_SONG=1`). The main page then has a link, "Sing a line to your music". Nothing here is public, nothing is uploaded, and no film is made without a plan the person has looked at.

```
python tools/desktop_maker.py --song --engine <the Ryagram folder with the song branch> --open
```

Words built from sounds (item 112) are a second switch, `--song-forge` (or `RYAGRAM_MAKER_SONG_FORGE=1`), and also need the alignment model on the PC. The maker never downloads it; the engine says so in one plain sentence when it is missing, and the word stays a gap. The download is a decision of Ryan's (RYAN-QUEUE Q165).

## The routes (all behind the maker's token; 127.0.0.1 only)
| Route | What it does |
|---|---|
| `GET /song`, `/song.js`, `/song-model.js`, `/song.css` | WEB's page, with its own content policy (`media-src 'self' blob:`). The page needs the token in the address; the files need the local host name. |
| `GET /api/song` | the saved plan (`song.json` in the films folder), checked again; a damaged file opens as "nothing saved". |
| `POST /api/song` | save the page's plan. Checked: the right schema, names and never paths, words in order, a built word is ONE person's pieces. |
| `POST /api/song/videos` | the operating system's file dialog; the answer is file NAMES only. A different video with a name already used is refused (the page works by names). |
| `POST /api/song/track`, `/guide` | the file dialog for one sound; checked as real audio with ffmpeg; answers name and length. |
| `POST /api/song/build` | writes the song recipe, runs the engine's `plan --json` (no film), answers with the plan the screens read (`view` of the engine's answer). Blocks until done; one job at a time. |
| `POST /api/song/hear` | `word`: the person's own take, cut from their video (or the built word's play-button file). `line`: the line's takes on their beats. Not stretched, no music; the page already says the film differs a little. `alt`, a gap, or anything else: `null` (the page then plays its practice tone and says so). |
| `GET /api/song/audio?id=` | that sound; needs the token header (so the token is never in an address). |
| `POST /api/song/render` | the film: the engine's `build --approve-plan <id of the plan built here>`. One at a time. |

## Rules held here, each tried in `tools/check-maker-song-wire.py`
* The plan on the screen must be the plan the engine made (same words, each said by the same clip at the same seconds). The page's own plan carries no id, so the maker passes the ENGINE's id, and the engine refuses a changed plan again. The build takes no overrides, so a swapped clip, or a real word left quiet, is refused with "Press Build again".
* Plain words only. An engine sentence written for a command line (slot ids, `--bind`) is replaced by the maker's own words; an unknown one is shown with every path and flag taken out.
* A failed render keeps no film and no receipt.
* File names only in anything the page sees or the maker saves; never a path.

## Checking it
`python tools/check-maker-song-wire.py <a Ryagram checkout that has the song modules> <a folder for the screenshots>` (both required): part A without a browser, part B in real Chrome. The engine's plan and build run a stand-in `ryagram.local` (the engine's own planner and view on made-up timings; a real tiny MP4), so no speech model is needed. The operating system's two file dialogs cannot be scripted, so the check replaces only those.

Not built: swapping another take (the build takes no overrides yet), hearing a word over the music, cancelling a build from the page.
