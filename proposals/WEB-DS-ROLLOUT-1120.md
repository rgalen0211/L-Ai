# Design system rollout (WEB, 2026-11-20)

Branch `web-dsfound-1120` (from `web-site-1120` f822b80). Ryan's order: front end is the week's #1; design OK ("night and day"); editor on one screen; other pages flip instead of scrolling.

## What is in the foundation

| File | What it is |
|---|---|
| `assets/ryagram-ds.css` | The production sheet. Tokens (8-pt scale `--s1..--s10`, type scale, colours, glow), header, account menu, buttons, cards, hero + parallax layers, home components, flip carousel, scroll panel, workbench. Every rule starts `body.ryagram-ds.ryagram-look`, so it beats the older sheets by specificity (no `!important`) and does nothing on a page that has not opted in. |
| `assets/ryagram-ds.js` | Behaviour, no dependencies. `window.ryagramDs.init()` (page load), `.mount(root)` after a view is drawn, `.unmount()` before the next. Flip (tabs, dots, prev/next, arrow keys, Home/End, swipe, `#section=<id>`), workbench (collapse, drag/keyboard resize, sizes remembered in `localStorage` `ryagram.ds.panels`), parallax (one transform per frame, off for reduced motion), sheen (`--mx` on cards), account menu (Escape, outside click, arrow keys). |
| `app/index.html` | `body.ryagram-ds`, the one-line header (wordmark, nav pills, avatar button), the account menu (Signed in as, Account, Help, then Sign out as a quiet item, plus Admin for admins). |
| `tools/check-design-system.py` | Chrome, mock mode, local server. Rules: header one line at 1280/1024/820/390 (nothing spills or overlaps), Sign out inside the menu, card padding >= 24, cards in a row share a width, text >= 16 px from a card edge, no sideways scroll. `--selftest` plants one fault per rule in a scratch copy: all caught. |

## Contract for the other workers

Markup (all classes are in the sheet; nothing else is needed):

- `.card`, `.btn` / `.button` (`.primary`, `.quiet`, `.small`), `.badge` (`.ok .warn .soon`), `.field`, `.eyebrow`, `.lede`, `.display`, `.section`, `.grid .col-*`, `.cards-3`.
- Flip: `.flip > .flip-bar (.flip-arrow[data-flip-prev|next], .flip-tabs > .flip-tab[role=tab]) + .flip-viewport > .flip-track > .flip-panel[role=tabpanel][id] + .flip-dots > .flip-dot + .flip-hint`. Call `ryagramDs.mount(root)` after the view is in the DOM (the library already does this for every route).
- `.scroll-panel`: a long list scrolls inside its own panel, the page does not.
- Workbench (editor): `.wb` with `.wb-panel.left | .stage | .right | .timeline`, each with a header and `.body`; `[data-collapse]` buttons; `.wb-resize[data-resize=left|right|bottom]` handles. The page never scrolls; the timeline scrolls inside itself.

Header hooks kept: `#sign-out` (handler in `app-auth.js`), `#account`, `#account-email`, `.admin-link`, `.dept-bar/.dept-list/.dept-menu/.dept-slot/.dept-extra`. Sign out and Admin are now menu items, so a Chrome check must open the menu first (or JS-click `#sign-out`); `tools/check-admin-nav.py` has an `open_account()` helper.

## Done in this branch

1. Foundation (sheet, script, header, account menu, flip/workbench components).
2. Home page body per `proposals/WEB-DESIGN-1120/mock-home.html`: parallax hero from our own film, the Start card, film cards (equal widths), departments (first one featured), credits, quiet links.
3. Checks and tests moved with it: nine source pins in the node suite, six Chrome checks that clicked Sign out in the bar, the departments check (Help/Account now in the menu), the brand-baseline check (wordmark and Ryagram share a baseline again).

## Not in this branch (other workers)

- Editor (`assets/app-editor*`, branch `web-ds-1120`): put it on `.wb`.
- Version page and every other page (`web-dspages-1120`): put sections in `.flip`, long lists in `.scroll-panel`.
- Public pages (`/film/`, `/help/`, `/report/`...) keep their look until they opt in with `body.ryagram-ds` plus the header markup.

## Known edges

- The sheet is dark only (Ryan's design). It sets the older sheets' status colours to dark values so a light-scheme browser cannot mix light tints into it (found by `check-first-run-phone`).
- A button needs a solid `background-color` under its gradient, or the contrast checks read the page behind it.
- Brand label "Ryagram" hides under 360 px only.
