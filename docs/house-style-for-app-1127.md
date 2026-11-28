# House style for the desktop app page (WEB, 2026-11-27)

Answers Ryan's finding that the Desktop maker page (served on 127.0.0.1 by `tools/desktop_maker.py`) still has the old look. The file `docs/house-style-for-app-1127.css` is self-contained: system fonts only (no font file), no external URLs, no images. Preview: `docs/house-style-for-app-preview-1127.html` (all words are samples).

## Where the app page's look lives

`tools/desktop_maker.py`: markup in `PAGE` (line 1159 on origin/main 079350f8), styles in `CSS` (line 1215, served at `/maker.css`). Old look: teal-green `--brand:#175c52` (dark mode `#6fd1bd`), light-by-default with a `prefers-color-scheme` flip, outlined green pill buttons, 10 px radius cards, yellow `.banner`. Sources of the new tokens are all in `assets/ryagram-ds.css` (the site's design system; line numbers are on origin/main 079350f8):

| Token / rule | Site line |
|---|---|
| colours `--bg --paper --ink --ink-2 --muted --faint --line* --accent --accent-2 --accent-ink --glow --link --ok --warn --bad` | 11-16 |
| spacing scale `--s1..--s8` | 19 |
| fonts (serif headings, system sans) | 23-24 |
| type sizes | 25 |
| radii, `--shadow-1/2`, `--surface(-2)` | 27-31 |
| body background (two soft radial glows on `--bg`) | 33-34 |
| focus ring: 3 px accent, 3 px offset | 37 |
| h1/h2/h3, lede, eyebrow, small | 42-48 |
| `.button` base, sheen on hover | 100-103 |
| `.button.primary`: gradient `#ffa05c`-`#ff7a26`, shadow `inset 0 1px 0 rgba(255,255,255,.4), 0 10px 30px rgba(255,138,61,.28)` | 104 |
| secondary / small / quiet / danger / disabled | 106-110 |
| cards (`.card`: 32 px pad, 20 px radius, hairline, shadow) | 115 |
| badges | 133-136 |
| fields (48 px, dark well, 12 px radius) | 137 |

Checked in Chrome: the app's primary button computes the same box-shadow, gradient, radius, height and text colour as the live site's (`SAME box-shadow: True`).

Invented here (no site equivalent; built from the tokens above): progress bar (`progress` and `.progress`), spinner, `<details>` style, mock banner, checkboxes, `.problems/.ok/.warn`.

## How to use

Replace the `CSS` string with the contents of `house-style-for-app-1127.css` (or serve it at `/maker.css`). The sheet styles plain elements and the page's existing class names, so most markup stays. Mapping of the app page's elements:

| App page element | Class / result |
|---|---|
| `<p class="banner">` "Runs on this computer only" | `.banner` (quiet grey; was yellow). Mock mode: `.banner.mock` |
| `<h1>`, `<h2>` | serif headings, automatic |
| `.intro`, `.note` | lede / small muted text |
| `section.logbox` (log, sign-in, node, "What your AI asked for", links, share, downloads) | card look; keep `.logbox` or rename to `.card` |
| plain `<section>` steps 1-3 | no card by default; add `class="card"` if wanted |
| `.button.secondary`, `.button.primary` | unchanged names: dark pill / orange glow pill |
| Build (`#build`) | the one `.button.primary` per step; Plan stays `.secondary`; Cancel `.secondary` |
| `.slot` | inner card; `.slot.drop-over` dashed orange |
| `<select>`, `<input>`, `<textarea>`, labels | automatic, 48 px |
| `.logswitch` + checkbox | 44 px row, 24 px accent checkbox |
| `<progress id="model-dl-bar">` | styled orange bar (or `.progress > .progress__bar`) |
| `<details class="paste">` | the collapsible; for "Make a film by hand (advanced)" use `class="paste"` or `class="advanced"` |
| `.problems`, `.ok`, `.warn` | red-pink / mint / amber status text |
| `.log`, `.code`, `.panel`, `.row`, `.actions`, `.sr-only` | kept, restyled dark |
| new waiting indicator | `<span class="spinner" role="status" aria-label="...">` plus words |

## Do not copy

Nothing account, credit or sign-in specific: skip the site's `.app-account`, `.account-menu`, `.avatar`, `#sign-in`, `#create-account`, `#library` rules, the header/`dept-*` navigation, `.hero`, `.flip*` and the pointer-light `.card::before`. The app page says "no account"; the sheet has no credit wording and no images.

## Delete from the old CSS

`--brand:#175c52` and the dark `#6fd1bd` override, the `@media(prefers-color-scheme:dark)` block (page is now dark only), the green outlined `.button` and `.button.primary{background:var(--brand)}`, the yellow `.banner`, `a{color:var(--brand)}`, green focus outlines, `.paste summary` plain styling, 10 px field radius, white `--paper:#fff`. Other app pages with their own sheet (`tools/maker-live/live-base.css`, which still uses teal `--brand:#6fd1bd`, and the song page) are not covered by this file.

## Accessibility notes

Tap targets 44 px or more (measured: none under 44 at 1280 and 390 px). Visible focus on every control. Contrast on `#0b0c11`: ink 17.6, ink-2 11.7, muted 6.9, faint 5.3, link 10.5, ok 13.1, warn 11.5, bad 11.5; primary text `#1a1008` on the orange 7.2-9.3; white on danger 4.8. `prefers-reduced-motion`: spinner stops and shows as a dotted ring, sheen and hover lift off, transitions near zero. Status is never colour alone: keep the words.
