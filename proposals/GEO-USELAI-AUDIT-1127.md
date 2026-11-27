# uselai.com audit and redirect table (GEO, Fri 11-27 early)

Read-only. Sources: git at live L-Ai main `f6312e3c`, WEB's front-door branch `web-home-ryagram-1127`, and plain
GET/HEAD requests to the public pages of https://uselai.com (no function URLs, no SQL, no dashboards).
Paper only. Nothing here is live, and nothing was changed.

## 0. Four facts that shape everything

1. **Hosting.** The site is GitHub Pages: legacy build from `main` at `/`, CNAME `uselai.com`, HTTPS enforced,
   certificate for `uselai.com` and `www.uselai.com` until 2027-02-04. `www` answers 301 to the apex.
2. **No server redirects.** GitHub Pages cannot send a 301 for a path (no `_redirects`, no `.htaccess`). The
   only redirect it sends by itself is `/folder` to `/folder/`. So every "redirect" in the table below is
   a small stub page (`<meta http-equiv="refresh">` + canonical + noindex). Google treats a 0-second meta
   refresh as a permanent redirect.
3. **The whole repo is served.** The repo is public, and Pages serves EVERY file in it, not just the pages.
   I saw these answer 200: `/proposals/WEB-AGE-CONFIRM-1121.md`, `/docs/APP-WEIGHT-1102.md`,
   `/supabase/migrations/...sql`, `/tests/a11y-pass.test.mjs`, `/README.md` and `/package.json`.
   Nothing secret has been found in them; the repo is public on GitHub anyway. But search engines can
   list them under uselai.com, and they say L'Ai and consulting.
   `robots.txt` and `sitemap.xml` are both absent (404).
4. **DNS is at GoDaddy** (`ns27/ns28.domaincontrol.com`), not Cloudflare.

## 1. Every public page today (live, HTTP status seen 00:3x)

| URL | Status | Title today | Indexed? | Part |
|---|---|---|---|---|
| `/` | 200 | L'Ai \| AI Workflow Automation | yes | CONSULTING home (becomes Ryagram's front door) |
| `/workflow-audit/` | 200 | Free 15-Minute Workflow Audit \| L'Ai | yes | CONSULTING |
| `/workflow-audit-thanks.html` | 200 | Workflow Audit Received \| L'Ai | noindex | CONSULTING |
| `/thank-you.html` | 200 | Thanks \| L'Ai | noindex | CONSULTING (contact form) |
| `/ryagram/` (`/ryagram` 301s here) | 200 | Ryagram: you have a question... \| L'Ai | yes | Ryagram landing |
| `/app/` (and every `#/...`) | 200 | Ryagram \| L'Ai | noindex | app |
| `/film/?s=` | 200 | A data film, made with Ryagram \| L'Ai | yes | shared film links |
| `/get-app/#t=` | 200 | Get the Ryagram app \| L'Ai | noindex | invite emails |
| `/help/` | 200 | Ryagram help \| L'Ai | yes | app |
| `/connect-ai/` | 200 | Connect your AI \| L'Ai | noindex | connector |
| `/report/` | 200 | Report a film \| L'Ai | noindex | app |
| `/terms/` | 200 | Terms of Use (preview) \| L'Ai | noindex | legal |
| `/privacy-policy.html` | 200 | Privacy Policy \| L'Ai | yes | legal |
| `/404.html` | 404 page | Page not found \| L'Ai | noindex | site |
| `/ai-content/`, `/geo-demo/`, `/preview-demo/`, `/game-tv/`, `/game-phone/` | 200 | (draft or preview) \| L'Ai | noindex | Ryagram drafts |
| `/landing-drafts/compilations/`, `/landing-drafts/song-films/` | 200 | (draft) \| L'Ai | noindex | Ryagram drafts |
| `/directory-drafts/terms/`, `/directory-drafts/privacy/`, `/legal-drafts/terms.html`, `/legal-drafts/privacy-policy.html` | 200 | (draft) \| L'Ai | noindex | legal drafts |
| `/tools/maker-edit/edit.html`, `maker-live/live.html`, `maker-song/song.html` | 200 | Edit your film, ... | noindex | tools |
| `/terms/terms.html` | **404** | none | none | **named by both connector listings** (see 4) |

Checked and NOT on uselai.com (404): `/mindwise-war-room-demo/`, `/buddy-war-room/`, `/casino/`,
`/MindWise-Trading-Lab/`, `/crm/`, `/crm-room/`, `/demo/`, `/demos/`. The CRM Room is the separate site
`https://3d-crm.pages.dev`, which is linked only from the consulting home. MindWise and "consulting" appear
in NO visible text, JS or email in the repo. Only the consulting home says "consultation".

**Tags:** no page has any `og:*` or `twitter:*` tag, so link previews use the title and description only.
Canonicals are absolute `https://uselai.com/...` on about 20 pages.

## 2. REDIRECT TABLE (old URL to new), for WEB's front door

| Old URL | New | How | Why / risk |
|---|---|---|---|
| `/` | `/` (Ryagram front door) | same URL, new page | **must keep `/assets/auth-forward.js`** (WEB's branch keeps it, line 12): email links that Supabase handled land on the root with tokens or errors in the `#`. Old consulting anchors (`#contact`, `#crm-room`, `#faq`, `#how`, `#opportunities`, `#sprint`, `#top`) just land at the top: harmless. |
| `/workflow-audit/`, `/workflow-audit`, `/workflow-audit/index.html` | `/` | stub: noindex, canonical `/`, refresh 0 | It is indexed today, so the stub tells Google it moved. The original goes to `archive/consulting/` (WEB done). |
| `/workflow-audit-thanks.html` (and `?ref=fs`) | `/` | stub | Formspree's `_redirect` pointed here. Its form leaves with the consulting home. |
| `/thank-you.html` | `/` | stub | It shows Ryan's personal uselai address today. The stub must not. |
| `/ryagram/`, `/ryagram` | **keep as is** (recommended), or a stub to `/` | Ryan's call (WEB's open question) | If it becomes a stub, it MUST: (a) keep `?query` and `#hash` (YouTube descriptions and `publish-template.json` send `/ryagram/?utm_source=youtube&utm_campaign=<slug>`); (b) keep loading `auth-forward.js`; (c) still contain the word "ryagram" in its HTML, or `.github/workflows/ops-ping.yml` line 25 fails every 6 hours. All six auth email footers link `https://uselai.com/ryagram/`. |
| `https://3d-crm.pages.dev` (CRM Room) | not ours to redirect | none | It is a separate Cloudflare Pages site. Once the link leaves the home page it stays public, unless Ryan takes it down (his call). |
| `calendar.app.google/...` booking, Formspree form | removed with the consulting home | none | Nothing on our side to redirect. |
| `/terms/terms.html` | `/terms/` | stub (new file) | It is 404 today, but both draft directory listings name it as `terms_url`. Fix the listings (preferred) or add the stub BEFORE any directory submission. |
| `/proposals/*`, `/docs/*`, `/supabase/*`, `/tests/*`, `/README.md`, `/package.json` | unchanged | add `robots.txt` with `Disallow` for these folders | robots.txt does not hide the files (the repo is public), but it keeps them out of search results under the Ryagram domain. New file, no visible words. |

**Must stay EXACTLY as today** (sign-in, email, connector and old film links): `/app/` with every hash route
(`#/auth?token_hash=`, `#/auth/expired`, `#/join?code=`, `#/connect/consent?request=`, `#/delivery/<id>`,
`#/device`, `#/credits`, `#/create-account`), `/film/?s=`, `/get-app/#t=`, `/help/`, `/connect-ai/`,
`/terms/`, `/privacy-policy.html`, `/report/`, `/404.html`, `CNAME`, `assets/auth-forward.js`.
WEB's branch changes none of these paths. Its edits to `app/index.html` and `help/index.html` are one line
each: RENDERER, please confirm they are text-only.

## 3. Where "L'Ai" shows to a visitor (BRAND = a Ryan wording call; LEGAL-KEEP = do not touch)

- **Header wordmark on every Ryagram page:** a big "L'Ai" next to "Ryagram" on `app/`, `help/`, `film/`,
  `connect-ai/`, `get-app/`, `report/`, `ryagram/`, the drafts and the game pages. Its aria-label is
  "L'Ai home". BRAND.
- **Every page title ends "| L'Ai".** So do the JS fallbacks `assets/app-library.js:237` ("Ryagram | L'Ai" with a
  curly apostrophe), `assets/game-phone.js:135` and `assets/game-tv.js:134`. BRAND. The titles of
  `terms/` and `privacy-policy.html` are BRAND as well, but those pages are legal: Ryan or the attorney decides.
- **Footer** "Ryagram, from L'Ai. Operated by L'Ai, LLC.": "from L'Ai" is BRAND; "Operated by L'Ai, LLC" is
  LEGAL-KEEP. The new front door keeps the order's exact line "Ryagram is operated by L'Ai, LLC."
- **`404.html` line 27** "The L'Ai home page", and `game-phone/` / `game-tv/` line 29, the same. BRAND
  (after the front door, "/" is Ryagram's home, so only the words are off).
- **All six auth email templates** (`supabase/email-templates/*.html` line 5) show a big "L'Ai" wordmark
  above "Ryagram". The footer "Ryagram is operated by L'Ai, LLC." is LEGAL-KEEP. Subjects are Ryagram-only.
  Changing the wordmark is a dashboard paste (Ryan).
- **Inside Claude and ChatGPT:** the connector widgets show an "L'Ai" mark next to the heading
  (`connect-core/home_panel.ts:152,187`, `connect-core/mcp_app.ts:83,140`). The MCP name and title are
  "ryagram" and "Ryagram". The OAuth metadata documentation links (`connect-core/oauth.ts:63,77`)
  point at `https://uselai.com/`. That is the consulting home today; after the front door it is
  Ryagram's home, so it needs no change. CONNECT owns the widget mark.
- **`privacy-policy.html`:** it describes the Workflow Audit, the Google calendar booking, the inquiry
  form and "the L'Ai typeface through Google Fonts" (lines 50-55). Its header label reads "AI workflow
  automation for small business". This is LEGAL. Do not touch it. A row goes to
  LEGAL-QUESTIONS-FOR-ATTORNEY: once the consulting side is gone, the policy still describes it.
- **Senders:** auth mail goes out through Resend SMTP as `noreply@uselai.com` (supabase/README.md line 294:
  the Gmail steps below it are SUPERSEDED). The display name lives in the dashboard. Ops mail uses the
  secret `OPS_MAIL_FROM`. The Stripe public name and statement descriptor are not in the repo
  (dashboard). CONNECT is auditing those live names.
- **Third parties that see a visitor's address:** Google Fonts (`fonts.googleapis.com`,
  `fonts.gstatic.com`) on every public page except `preview-demo/` and `tools/maker-*`; `cdn.jsdelivr.net`
  (supabase-js) on `app/`; Formspree, Google Calendar and 3d-crm.pages.dev on the consulting home only.
  The Meta Pixel and the Cloudflare beacon are coded but OFF: `analytics-config.js` is empty.
  FACES' LOW 2 (fonts) belongs with the attorney row.

## 4. Flags: things that would break sign-in, email links or the connector

1. **`auth-forward.js` must stay on `/`.** It is also on `/ryagram/`: keep it there if `/ryagram/`
   becomes a stub. WEB's branch: kept on `/`.
2. **Supabase Site URL stays `https://uselai.com`** (the bare origin). The front door changes no path that
   `{{ .SiteURL }}/app/#/auth?...` uses. There is nothing to change in Auth for tonight's work.
3. **`ops-ping.yml`** greps `https://uselai.com/ryagram/` for "ryagram". Any `/ryagram/` change must keep
   that word, or the uptime check pages Ryan.
4. **Both draft connector listings point `terms_url` at `/terms/terms.html`, which is 404 live.** A
   reviewer would hit a dead link. Fix this before any submission (CONNECT).
5. **The `order_status()` SQL on live hands out `https://uselai.com/app/#/delivery/<id>`.** Nothing changes
   tonight. It matters only at a domain move (see DOMAIN-MOVE-PLAN-1127.md).
6. **Stubs drop the `?query`.** That is fine for the consulting URLs, but NOT for `/ryagram/` (utm tags) and
   never for any `/app/`, `/film/` or `/get-app/` URL. Those must not become stubs.
