# Domain move plan: uselai.com to a Ryagram domain (GEO, Fri 11-27) -- PAPER ONLY

Ryan (Thu 23:24): uselai.com has nothing to do with Ryagram, so the site moves to a Ryagram domain some day.
Tonight's front door stays on uselai.com. This plan lists every place the domain is written or registered,
the order of the move so sign-in, email links and old film links never break, and the undo for each
step. **Nothing here is done, bought or made live.** Every live step is Ryan's. Every main push is CC1's, on
Ryan's yes. Read with GEO-USELAI-AUDIT-1127.md, which has the page list, the redirect table and the flags.
`NEW` below means the new domain, for example `ryagram.<tld>`. Ryan picks the name.

## 1. What it costs

| Item | Money? | Note |
|---|---|---|
| **Registering NEW** | **YES: the only money step.** A yearly registrar fee; the price depends on the name and the ending. | **Flagged, not bought.** Ryan buys it himself. L'Ai, LLC should be the registrant, like uselai.com (the attorney row decides). |
| Keeping uselai.com | already paid (renews yearly) | **It must keep renewing for years**: old emails, YouTube descriptions and shared film links point at it. Letting it lapse breaks every one of them, and someone else could buy it. |
| GitHub Pages on NEW | free | one custom domain per repo |
| Cloudflare DNS + redirect rules for the old domain | free plan | only if Ryan picks option A in step 5 |
| Resend: a second sending domain | free plan allows it (check the plan page on the day) | Free is 100 emails a day across all domains |
| Mailbox `ryagram@NEW` | free **as an alias domain** in Google Workspace (uselai.com mail is Google: SPF includes `_spf.google.com`) | A new Workspace USER would cost money. Use an alias or alias domain instead. Check on the day. |
| Stripe, Supabase, Claude/ChatGPT connector | free to change | |

## 2. Every place uselai.com is written or registered

The prep column says whether a step can be done BEFORE the move without changing anything for anyone.

### A. Repo: the site (L-Ai)
| Where | What | Prep? | On the move |
|---|---|---|---|
| `CNAME` | `uselai.com` | no | becomes `NEW` (step 5) |
| about 20 `<link rel="canonical" href="https://uselai.com/...">` | SEO | no | rewrite to NEW after the switch (FACES' LOW 1: full https canonical once the domain is final) |
| `index.html` (front door) | relative links only (WEB's branch) | already done | nothing |
| `ryagram@uselai.com` mailto and visible text (app, help, connect-ai, report, ryagram, terms, privacy, ai-content; JS `CONTACT` constants in `ryagram.js`, `creator-beta.js`, `app-connect.js`, `app-data.js`, `app-tester-wizard.js`, `report.js`) | contact address | no | only after `ryagram@NEW` receives mail (step 3). **Terms and Privacy wording is legal: the attorney decides.** |
| `assets/funnel.js:32` regex `uselai\.com` | drops self-referrals | **yes**: accept both | |
| `assets/app-auth.js:335,356` and `app-library.js:1605` | use `location.origin` | already domain-free | nothing |
| `get-app.js`, `report.js`, `app-link/core.ts:25,77` visible text "sign in at uselai.com" | words | no | new words for Ryan |
| `.github/workflows/ops-ping.yml:25` | uptime check on `https://uselai.com/ryagram/` | no | switch to NEW right after step 5 |
| `tools/launch-smoke.py:363` `--base` default; `tools/make_app_bundle.py` approval hosts | tools | yes (both hosts) | |
| 83 test files and 19 tools pin the domain | tests | with each change | each change carries its own test edits |

### B. Repo: edge functions (each change is a deploy, Ryan's step)
| Where | What | Prep? |
|---|---|---|
| CORS `allowedOrigins: ["https://uselai.com","https://www.uselai.com"]` in 15 functions: ai-editor, app-download, app-link, approve-waiting, claim-invite, creator-beta, delete-account, film-page, get-delivery-url, guided-builder, join, redeem-invite, send-invite, source-fetch, stripe-checkout | which page may call the function | **yes: ADD NEW and www.NEW, keep the old.** If this is missed, every call from NEW fails. |
| `siteUrl: "https://uselai.com"` in approve-waiting (approval email), film-page (`/film/?s=` share link), join and redeem-invite (invite redirect `/app/`), send-invite (join link, `/get-app/#t=`), stripe-checkout (return URL `/app/#/credits`) | links the functions build | **yes: read a `SITE_URL` secret, defaulting to today's value.** It flips at step 6. |
| `connect/index.ts`: `CONNECT_APP_URL` (default `https://uselai.com/app/`), `CONNECT_CONSENT_URL` (secret, points at `/app/#/connect/consent`) | OAuth consent page | already env; the flip is step 6 |
| `NODE_APPROVAL_URL` (secret) | desktop sign-in approval page | env; **desktop apps already installed accept only hosts baked in at build** (`--signin-approval-host`). Ship builds with BOTH hosts long before the flip. |
| `connect-core/oauth.ts:63,77` documentation links | information only | any time after NEW serves |
| `_shared/fetch_rules.ts:9` User-Agent names the site and ryagram@ | courtesy to data sites | any time |
| `_shared/ops_mail.ts:9` `OPS_TO = ryagram@uselai.com` | alert recipient | only after the new mailbox works (or never: alerts can keep going to the old address) |
| Connector issuer and resource | `CONNECT_PUBLIC_URL` or `SUPABASE_URL` (supabase.co) | **not domain-bound. Keep it that way.** |

### C. Live SQL (applied migrations)
| Where | What | Prep? |
|---|---|---|
| `ryagram_private.order_status()` (20261017000600_pipe1_orders.sql:887, template pipe1_orders.template.sql:554) | hands out `https://uselai.com/app/#/delivery/<id>` | **yes: a new migration reads the origin from a one-row config, defaulting to uselai.com.** The flip is one `update` at step 6, the undo the reverse `update`. RENDERER reviews it, with a must-fail. |
| `join_waitlist()` source label `uselai.com/ryagram`; `ai_reserve_turn()` error text names ryagram@ | label / words | optional; old rows keep the old label |
| `app_admins` seed by Ryan's personal uselai address | applied once, keyed by user id | nothing breaks |

### D. Supabase dashboard (Ryan)
| Where | What | Order |
|---|---|---|
| Authentication > URL Configuration > **Redirect URLs** | today `https://uselai.com/app/` | **ADD `https://NEW/app/` at step 4 and KEEP the old one for months.** Reset and invite links already sent go to the old one. |
| Authentication > URL Configuration > **Site URL** | `https://uselai.com` (bare origin, no `/app/`) | flips to `https://NEW` at step 6, **only after NEW serves `/app/`**. Every confirm, reset, magic-link, invite and email-change link is built from it. |
| Authentication > Emails > **SMTP** | Resend, sender `noreply@uselai.com` (supabase/README.md:294) | sender flips to `noreply@NEW` at step 6, **only after Resend shows NEW verified**. Link domain and sender domain should match for spam scores, so flip them in the same sitting. |
| Email templates (six) | footers link `https://uselai.com/ryagram/` and mailto ryagram@; action links use `{{ .SiteURL }}` | footers pasted at step 7 |

### E. Resend
| Where | Order |
|---|---|
| Sending domain uselai.com (DKIM, SPF records in GoDaddy DNS) | **keep it.** |
| Add NEW as a second domain; put its DKIM, SPF and return-path records in NEW's DNS; wait for "Verified" | step 3 |
| Secret `OPS_MAIL_FROM` | step 6 or later |

### F. Mail: the contact address `ryagram@uselai.com`
Step 3: add NEW to Google Workspace as an alias domain, so `ryagram@NEW` lands in the same mailbox. Add
NEW's MX, SPF, DKIM and DMARC. Test from an outside address. **Keep `ryagram@uselai.com` receiving forever**:
it is printed in Terms, Privacy, emails and the connector listings.

### G. Claude and ChatGPT connectors (CONNECT owns the details)
- The connector URL is on supabase.co today. **Recommendation: keep the connector URL off any brand domain**,
  or decide its permanent host BEFORE the first directory submission: OpenAI never lets the origin change
  (SUBMISSION-CHECKLIST.md:9,13). Moving the connector URL later breaks every connected AI.
- The listings (`supabase/directory/*.json`, DRAFTS) name `website`, `documentation_url`, `support_url`,
  `privacy_policy_url` and `terms_url` on uselai.com. Update them at step 7, or submit them with NEW from
  the start if NEW is bought first. `terms_url` `/terms/terms.html` is **404 today**: fix it regardless.
- The OAuth consent page (`CONNECT_CONSENT_URL`) moves at step 6. The old domain keeps redirecting `/app/#...` with the hash.

### H. Stripe (Ryan's dashboard)
- The Checkout return URL is built by stripe-checkout from `siteUrl` (B above) and flips with `SITE_URL` at step 6.
- Business website URL and the public business name are dashboard settings. Change them at step 7.
  L'Ai, LLC stays the legal name.
- Webhook endpoint: a supabase.co function URL, not domain-bound.

### I. Cloudflare
- **R2** (films, deliveries): the code signs URLs on `r2.cloudflarestorage.com` (`R2_HOST`, `R2_BUCKET`,
  `R2_ACCOUNT_ID`, key names only), so it is not domain-bound. **Check the bucket's CORS policy in the
  dashboard** (it is not in the repo): if it lists `https://uselai.com` as an allowed origin, ADD NEW at step 4.
- **Web Analytics:** the beacon token belongs to the "uselai.com" site. It is OFF today (empty config). Make a new site for NEW, if ever turned on.
- **DNS:** uselai.com DNS is at **GoDaddy**, not Cloudflare (`ns27/ns28.domaincontrol.com`).

### J. The render PC (`worker.toml` / `worker.env`)
From the code (`ryagram/worker/__main__.py:24`, `config.py`), not the live file: the worker needs
`RYAGRAM_SUPABASE_URL`, `RYAGRAM_SUPABASE_KEY`, `RYAGRAM_WORKER_EMAIL` and `RYAGRAM_WORKER_PASSWORD`. The URL is
supabase.co. The worker's login email is an `@uselai.com` address, but it is only a login name: **it need not
change**, and changing it risks the worker's sign-in. worker.toml's sections (engine, cache, datasets, work
limits) name no web domain. **WORKER: please confirm no key in the live worker.toml or worker.env holds a
uselai.com value (key NAMES only).**

## 3. The order (nothing ever breaks)

Rule for every step: the old domain keeps working the whole time, and both domains stay allowed until the very end.

| Step | What | Who | Breaks if skipped | Undo |
|---|---|---|---|---|
| **0. Prep (now, no money)** | On branches with tests: CORS lists accept both; `SITE_URL` secret with today's default; `order_status()` reads a config row (default uselai.com); funnel.js both; desktop builds with both approval hosts; robots.txt; fix the listings' `terms_url` | WEB, CONNECT, BUILDER, RENDERER review, CC1 merge, Ryan deploys | nothing yet | each is a revert or redeploy of the previous version; the config row default keeps behaviour identical |
| **1. Buy NEW** | registrar | **Ryan (money)** | | a cancellation within the registrar's grace period |
| **2. DNS for NEW** | GitHub Pages A/AAAA records for the apex, `www` CNAME to `rgalen0211.github.io` (it does not serve yet) | Ryan | | delete the records |
| **3. Mail on NEW** | Workspace alias domain + MX/SPF/DKIM/DMARC; Resend adds NEW, wait for Verified; test `ryagram@NEW` from outside | Ryan | sending from NEW before Verified = spam folder or refusals | remove the alias domain / the Resend domain; uselai.com mail is untouched throughout |
| **4. Allow NEW everywhere** | Supabase Redirect URLs ADD `https://NEW/app/`; deploy the both-domain CORS functions; R2 CORS ADD NEW if listed | Ryan | step 6 fails: sign-in redirects refused, every API call blocked | remove the added entries (the old ones are never removed here) |
| **5. Switch hosting** | (a) set up the OLD-domain redirector first (below); (b) CC1 pushes `CNAME` = NEW; (c) GitHub issues NEW's certificate (minutes, up to about an hour), then "Enforce HTTPS"; (d) turn the redirector on | CC1 push on Ryan's yes; Ryan for DNS | without a redirector, every old link 404s | push `CNAME` = uselai.com back; switch the redirector off; the GitHub certificate for uselai.com is re-issued (minutes) |
| **6. Flip what builds links** | Supabase Site URL = `https://NEW`; SMTP sender `noreply@NEW`; `SITE_URL` secret = NEW (redeploy the 6 functions); `CONNECT_APP_URL`, `CONNECT_CONSENT_URL`, `NODE_APPROVAL_URL` = NEW; `order_status` config row = NEW; ops-ping URL; then one test sign-up, one reset, one invite, one connector consent, one delivery link | Ryan (dashboard, secrets, SQL), CC1 (ops-ping) | | set each value back; keep the old values on paper before the sitting |
| **7. Words and listings** | canonicals; footers in the six email templates; contact addresses (only where the attorney agrees); connector listings; Stripe business URL | WEB, CONNECT, Ryan | | revert commits / paste the old templates back |
| **8. Much later (months)** | remove uselai.com from CORS and Redirect URLs **only when no traffic arrives through the old domain**. Arguably never: the old domain keeps redirecting, and the cost of keeping both allowed is nil. | Ryan | | add back |

### The old-domain redirector (step 5) -- Ryan picks one
GitHub Pages serves one domain per repo, so after the CNAME flip uselai.com is served by nothing unless we set this up.
- **Option A (recommended): Cloudflare.** Weeks before step 5, move uselai.com's DNS from GoDaddy to
  Cloudflare's free plan, **copying every record exactly first: MX, SPF, DKIM (Google and Resend), DMARC,
  the GitHub A records and any verification TXT**, with no proxy, so nothing changes. Check mail both ways for a day.
  At step 5, turn on the proxy for `uselai.com` and `www` with one Redirect Rule:
  301 to `https://NEW` + the same path + the same query. The browser keeps the `#` part on a 301, so
  `/app/#/auth?token_hash=...`, `/app/#/delivery/<id>`, `/get-app/#t=` and the auth-forward hash all arrive intact.
  Undo: switch the rule and proxy off (seconds). Risk: the DNS copy (a missed MX record breaks mail), which is why it goes first and alone.
- **Option B: a second GitHub Pages repo** (`uselai-redirect`, CNAME `uselai.com`) whose `index.html` and
  `404.html` run `location.replace('https://NEW' + location.pathname + location.search + location.hash)`,
  plus a meta refresh. No DNS move, but it is not a real 301 (search engines move slower). uselai.com is
  down while GitHub issues its certificate (minutes to an hour) right after the flip. Undo: delete the repo's CNAME.

## 4. What tonight's front door already does right
- Relative links only, and no "uselai.com" in its visible words (WEB's branch `web-home-ryagram-1127`).
- It keeps `auth-forward.js` on `/`, the `/app/` paths, `/film/`, `/get-app/`, `/terms/`, `/privacy-policy.html`, `/help/` and `/connect-ai/`.
- It changes no Supabase setting, secret or SQL.
