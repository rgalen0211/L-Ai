# App page weight and load steps, 11-02 (CLOUD-SITE, round 3)

Made by `node tools/measure-app-weight.mjs --write`, offline: local server, mock mode, Chromium, cold cache, a simulated 4G phone connection (9 Mbps down, 85 ms). The pinned Supabase library is measured from node_modules (the same version); the page font is cut off. Times are from this cloud box, so compare them with each other, not with a phone in the hand. **Suggestions only: nothing here was changed.**

## What app/index.html loads

Every app page is the same document: **38 of our scripts (729.6 KB, 234.0 KB gzipped)** and **4 of our stylesheets (42.4 KB, 12.0 KB gzipped)**, plus the Supabase library from jsDelivr (212.8 KB, 54.1 KB gzipped) and the Google font. 0 scripts are deferred or async; 0 sit in the head.

### The heaviest files (gzipped, as GitHub Pages sends them)

| File | Raw | Gzipped | Blocks first paint |
|---|---|---|---|
| https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js (outside) | 212.8 KB | 54.1 KB | no |
| /assets/app-library.js | 139.4 KB | 37.4 KB | no |
| /assets/app-editor.js | 63.4 KB | 18.8 KB | no |
| /assets/preview/scene-draw-rules.min.js | 39.0 KB | 13.6 KB | no |
| /assets/app-data.js | 46.8 KB | 13.3 KB | no |
| /assets/app-device.js | 34.2 KB | 10.5 KB | no |
| /assets/app-looks.js | 33.5 KB | 10.0 KB | no |
| /assets/app-builder.js | 30.4 KB | 9.6 KB | no |
| /assets/profile-core.js | 36.6 KB | 9.4 KB | no |
| /assets/app-ops.js | 24.6 KB | 8.7 KB | no |
| /assets/preview/look-draw.js | 23.3 KB | 7.7 KB | no |
| /assets/app-editor-core.js | 24.0 KB | 7.6 KB | no |
| /assets/app.css | 27.7 KB | 7.1 KB | yes |
| /assets/app-jobs.js | 18.0 KB | 6.6 KB | no |
| /assets/app-connect.js | 18.3 KB | 6.6 KB | no |

## Per page (median of 3)

| Page | Requests | On the wire | DOM ready | Load | Heading on screen | Mock files (not on the real site) |
|---|---|---|---|---|---|---|
| projects | 44 | 471.3 KB | 3863 ms | 4275 ms | 4328 ms | 4, 36.4 KB |
| signed-out | 44 | 471.3 KB | 3875 ms | 3876 ms | 3904 ms | 0, 0.0 KB |
| account | 44 | 471.3 KB | 3863 ms | 4271 ms | 4305 ms | 4, 36.4 KB |
| credits | 44 | 471.3 KB | 3869 ms | 4277 ms | 4320 ms | 4, 36.4 KB |
| build | 44 | 471.3 KB | 3883 ms | 4295 ms | 4340 ms | 4, 36.4 KB |
| looks | 44 | 471.3 KB | 3854 ms | 4262 ms | 4294 ms | 4, 36.4 KB |
| help | 44 | 471.3 KB | 3879 ms | 4288 ms | 4319 ms | 4, 36.4 KB |
| admin-ops | 44 | 471.3 KB | 3855 ms | 4264 ms | 4323 ms | 4, 36.4 KB |

## How much of each script the first screen runs (projects page)

| Script | Size | Run on the first screen | Not run |
|---|---|---|---|
| jsdelivr:@supabase/supabase-js@2.117.2/dist/umd/supabase.js | 212.8 KB | 4% | 204.6 KB |
| /assets/app-library.js | 139.3 KB | 13% | 120.9 KB |
| /assets/app-editor.js | 63.4 KB | 5% | 60.4 KB |
| /assets/preview/scene-draw-rules.min.js | 39.0 KB | 1% | 38.5 KB |
| /assets/app-data.js | 46.6 KB | 30% | 32.8 KB |
| /assets/app-device.js | 34.1 KB | 17% | 28.3 KB |
| /assets/app-looks.js | 33.5 KB | 21% | 26.3 KB |
| /assets/app-builder.js | 30.3 KB | 21% | 23.8 KB |
| /assets/preview/look-draw.js | 23.3 KB | 13% | 20.4 KB |
| /assets/app-editor-core.js | 24.0 KB | 24% | 18.1 KB |
| /assets/app-ops.js | 24.6 KB | 29% | 17.5 KB |
| /assets/profile-core.js | 36.6 KB | 62% | 14.0 KB |
| /assets/app-auth.js | 22.2 KB | 41% | 13.2 KB |
| /assets/app-connect.js | 18.3 KB | 31% | 12.7 KB |
| /assets/app-jobs.js | 17.9 KB | 31% | 12.3 KB |

## Suggested cuts (for Ryan; none made)

In order of what they save on every page view. Each is a change to app/index.html and the router, and each needs its own tests; none touches a switch or public wording.

1. **Load on demand: The live editor stack (#/editor/*, behind liveEditor, OFF): loaded on every page.** 10 files, 195.2 KB (64.8 KB gzipped) that the other pages download, parse and run for nothing. Load them the first time their route opens (one small loader that adds the script tags in order and waits), or drop them from the page while their switch is OFF.
2. **Load on demand: Other pages behind switches that are OFF (intake, My films, tester wizard).** 3 files, 26.2 KB (10.0 KB gzipped) that the other pages download, parse and run for nothing. Load them the first time their route opens (one small loader that adds the script tags in order and waits), or drop them from the page while their switch is OFF.
3. **Load on demand: Admin-only code (an admin is one account).** 2 files, 27.1 KB (9.8 KB gzipped) that the other pages download, parse and run for nothing. Load them the first time their route opens (one small loader that adds the script tags in order and waits), or drop them from the page while their switch is OFF.
4. **Split app-library.js by route.** 139.4 KB (37.4 KB gzipped), the biggest file of ours; the projects page runs about 13% of it. The admin views and the film/version views are the natural first pieces.
5. **A smaller Supabase client.** The UMD build is 212.8 KB (54.1 KB gzipped) and the first screen runs about 4% of it. The app uses sign-in, RPC calls, storage (uploads, downloads, signed links: app-data.js) and a realtime channel for job updates (app-data.js, client.channel('jobs:...')), so a slimmer build still needs auth-js, postgrest-js, storage-js and realtime-js; the saving is the UMD wrapper and what those four do not use, so measure it before deciding. Pin it the same way, with an integrity hash. It also removes the one outside script every page waits for.
6. **Mark the scripts defer.** They already sit at the end of the body, so this saves little today, but with defer the browser can fetch all of them while it parses, and a later move into the head cannot make them block the first paint. Their order is kept.
7. **Self-host the page font.** The Google Fonts stylesheet is render-blocking and comes from another host (already a pending decision in the page weight pass). One weight of Noto Serif Display, as a woff2 under /assets, with font-display: swap.
8. **One cache rule for the ?v= files.** Every script carries a version, so a long cache lifetime would be safe, but GitHub Pages sets its own (10 minutes). If the site ever moves behind a CDN that allows headers, `Cache-Control: max-age=31536000, immutable` on /assets/*?v= makes every return visit load from the cache.

Budget to hold once the cuts are in (a suggestion): **at most 150 KB of our JS gzipped on any page that is not the editor**, at most 15 KB of our CSS gzipped, and the projects page heading on screen in under 2.5 s on the simulated 4G above. Today: about 234 KB of our JS gzipped on every page, and about 4.4 s.

