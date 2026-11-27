# Compilations honest launch words: the CONNECT places (WEB 11-27, fold3)

ALL words below are new public words: FOR RYAN'S YES. Source: FACES' proposals/FACES-COMPILATIONS-HONEST-LAUNCH-WORDS-1127.md (line numbers are FACES' on connect-all-1127; re-find them on your head). WEB changed only the page, the home tiles, assets/app-departments.js and the home_panel.ts line + its fixture; everything else here is CONNECT's.

Rule: every sentence is true when only the saved request exists. The app that makes the film is not open to everyone yet. Never promise a film, a date or a credit use.

| file | line | replace with |
|---|---|---|
| supabase/functions/connect-core/tools.ts | 308-310 (tool description) | Only saves the request. Nothing is made and no credits are used. The Ryagram app makes the film and is not open to everyone yet. Never promise a film. |
| supabase/functions/connect-core/tools.ts | 370 (set_compilation_request result) | Request saved. Nothing is made and no credits are used. The Ryagram app makes the film; it is not open to everyone yet. Do not promise a film or a date. |
| supabase/functions/connect-core/tools.ts | 53 and 310 (no-app gate) | For an account with the switch use the 370 words; keep "not available to them yet" only for accounts without the switch. |
| supabase/functions/connect-core/tools.ts | 409 (stale reason) | drop "they can start it again in the Ryagram app" until the app ships (WEB's page already did the same). |
| supabase/functions/connect-core/tools.ts | 429 (get_compilation_status, waiting) | Saved. Nothing is made until the Ryagram app, not open to everyone yet, finds it. No credits are used. |
| supabase/functions/connect-core/tools.ts | 460 (status, no request) | ...Saving it stores the request only; the film is made later by the Ryagram app. |
| supabase/functions/connect-core/tools.ts | 485-486 (open_compilations_page) | The page shows saved requests. The Ryagram app makes the film and is not open to everyone yet. No credits are used. |
| supabase/functions/connect-core/tools.ts | 388 (department status label) | label "Testing", never "Working", until the app can make a film. |
| supabase/functions/connect-core/tools.ts | new (what happens next) | Your request is saved. The film is made by the Ryagram app on your computer, which is not open to everyone yet. Nothing is made until then, and no credits are used. When the app opens for you, it will find your request. |
| supabase/functions/connect-core/intake.ts | 82 (app question) | The film is made by the Ryagram app on your computer, which is not open to everyone yet. Should I save a request for it? |
| supabase/functions/connect-core/intake.ts | 86 (no app, end) | ...write down the request; the app will find it when it opens for them. Nothing is made until then. |
| supabase/functions/connect-core/intake.ts | 103 (after saving) | Tell them: request saved, nothing is made yet, no credits used, the app will find it when it opens for them. |

## Already changed by WEB on branch web-comp-fold3-1127 (will conflict with CONNECT if CONNECT edits the same line)

- supabase/functions/connect-core/home_panel.ts line 20 and tests/home-panel-departments.json line 28: the compilations line now reads "Save a request for a phrase in your footage. The film needs the Ryagram app, not open to everyone yet." (same sentence as the site tile and assets/app-departments.js). tests/connect_home_panel_mutants.mjs follows it. CONNECT: take WEB's line on merge, do not re-edit it.
- The page itself (assets/app-compilations.js, stamp 20261127c10): the song-request words now read "Save a new request without the song." (the form has no edit), the server's 42501 door refusal has its own plain sentence, folder limit 8 (server takes 1 to 10; FACES' engine 1 to 8).

After the app ships, restore the product words (also FOR RYAN'S YES).
