# Public pages report, 11-02 (CLOUD-SITE, round 3)

Made by `node tools/check-public-pages.mjs --write` from the files on the branch (no network, no browser). 24 pages served.

## Hard findings

None: every internal link, anchor and asset resolves; every image has alt text; every page has a title, a language and a viewport; every indexed page has a description; every draft or private page says noindex.

## Warnings (for Ryan; none fails the check)

- app/index.html: 4 <h1> in the HTML
- film/index.html: link "#sources" goes to an anchor that film/index.html's own script draws (#sources); it goes nowhere until the script has drawn it
- there is no robots.txt: crawlers get no Disallow for /tests/, /tools/, /supabase/, /docs/ (every file in the repo is served)
- there is no sitemap.xml listing the pages that should be found
- there is no .nojekyll, so GitHub Pages most likely publishes these 22 Markdown files as pages with no noindex (verify in a browser, e.g. https://uselai.com/README.html): README.md, docs/connect-guides/README.md, docs/connect-guides/chatgpt.md, docs/connect-guides/claude-code.md, docs/connect-guides/claude.md, docs/connect-guides/copilot-studio.md ...

## Indexed pages

- film/index.html
- help/index.html
- index.html
- privacy-policy.html
- ryagram/index.html
- workflow-audit/index.html

## Pages that keep search engines away (noindex)

- 404.html
- ai-content/index.html
- app/index.html
- connect-ai/index.html
- directory-drafts/privacy/index.html
- directory-drafts/terms/index.html
- game-tv/index.html
- geo-demo/index.html
- get-app/index.html
- landing-drafts/compilations/index.html
- landing-drafts/song-films/index.html
- legal-drafts/privacy-policy.html
- legal-drafts/terms.html
- preview-demo/index.html
- report/index.html
- terms/index.html
- thank-you.html
- workflow-audit-thanks.html

### noindex pages an indexed page links to

A crawler finds these, and noindex keeps them out of the results. Each is listed so it stays a choice.

- app/index.html (from help/index.html, ryagram/index.html)
- terms/index.html (from film/index.html, help/index.html, privacy-policy.html, ryagram/index.html)
- ai-content/index.html (from film/index.html, help/index.html, privacy-policy.html, ryagram/index.html)
- report/index.html (from film/index.html, help/index.html)
- workflow-audit-thanks.html (from workflow-audit/index.html)

## Everything else the site serves

GitHub Pages serves every file in the repository (except names starting with a dot or an underscore). The page check above covers the HTML pages; the rest are served as plain files:

- tools/ 268 files
- supabase/ 266 files
- tests/ 230 files
- assets/ 104 files
- docs/ 19 files
- (root) 11 files
- film/ 4 files
- preview-demo/ 4 files
- directory-drafts/ 2 files
- landing-drafts/ 2 files
- legal-drafts/ 2 files
- ai-content/ 1 files
- app/ 1 files
- connect-ai/ 1 files
- game-tv/ 1 files
- geo-demo/ 1 files
- get-app/ 1 files
- help/ 1 files
- report/ 1 files
- ryagram/ 1 files
- terms/ 1 files
- workflow-audit/ 1 files

robots.txt: absent. sitemap.xml: absent. .nojekyll: absent.

### Markdown files GitHub Pages most likely publishes as pages

Without .nojekyll, GitHub Pages builds the site with Jekyll, which turns Markdown files into HTML pages even without front matter. None of them carries noindex. Verify on the live site before acting (this check makes no network call).

- README.md (would be /README.html)
- docs/connect-guides/README.md (would be /docs/connect-guides/README.html)
- docs/connect-guides/chatgpt.md (would be /docs/connect-guides/chatgpt.html)
- docs/connect-guides/claude-code.md (would be /docs/connect-guides/claude-code.html)
- docs/connect-guides/claude.md (would be /docs/connect-guides/claude.html)
- docs/connect-guides/copilot-studio.md (would be /docs/connect-guides/copilot-studio.html)
- docs/connect-guides/gemini.md (would be /docs/connect-guides/gemini.html)
- docs/connect-guides/grok.md (would be /docs/connect-guides/grok.html)
- docs/connect-guides/le-chat.md (would be /docs/connect-guides/le-chat.html)
- docs/connect-guides/not-possible.md (would be /docs/connect-guides/not-possible.html)
- docs/connect-guides/perplexity.md (would be /docs/connect-guides/perplexity.html)
- docs/connect-runbook.md (would be /docs/connect-runbook.html)
- docs/maker-edit-host-contract.md (would be /docs/maker-edit-host-contract.html)
- docs/maker-live-host-contract.md (would be /docs/maker-live-host-contract.html)
- docs/maker-signin-contract.md (would be /docs/maker-signin-contract.html)
- docs/maker-song-host-contract.md (would be /docs/maker-song-host-contract.html)
- docs/maker-song-routes.md (would be /docs/maker-song-routes.html)
- docs/maker-v2-engine-contract.md (would be /docs/maker-v2-engine-contract.html)
- docs/model-download.md (would be /docs/model-download.html)
- docs/node-function-contract.md (would be /docs/node-function-contract.html)
- supabase/README.md (would be /supabase/README.html)
- supabase/directory/SUBMISSION-CHECKLIST.md (would be /supabase/directory/SUBMISSION-CHECKLIST.html)

