# Words for a yes: every new public sentence the WEB branches add (2026-11-27, refreshed 10:30 against current heads)

Counts: 239 rows, 39 CLAIM rows, 9 changed since 09:50, 9 removed. GEO's branch, listed separately as FYI: 51 rows, 19 CLAIM rows, 17 changed since 09:50, 4 removed.

Compared against live main f6312e3c. Read-only extraction from the branch diffs of assets/, app/ and the .html pages. Nothing was edited or run. One row per sentence; where one sentence is in several branches it is listed once, under the first branch in this order: wave8, credits-help, push5c, comp-fold2, editor-poll2, games-polish3, depbar3, GEO's branch (FYI), push4b, delivery-wide.

Heads used now (earlier heads in brackets where they moved): wave8 383edc58; credits-help 7cfa306e; push4b 4f4247e5; push5c 240b4efb; web-comp-fold2-1127 33389560 [was comp-mirror f14eb79a]; web-editor-poll2-1127 40e2c9c7 (unchanged); web-games-polish3-1127 c689071c [was polish2 c0e302a1]; web-depbar3-1127 f574362c [was depbar-walk 3636893d]; geo-perfect-city-1127 0576502f [was perfectcity-polish2 f3c6ad6e]. Not on origin, so nothing listed: web-backlink-1127 and web-editor-textlegend-1127.

Flag: CLAIM = privacy, price, 'free', speed, legality, safety, 'never leaves', data-accuracy or a promise of a later feature. PLAIN = a label, an instruction or a status line. Judgement calls are mine; Ryan can move any row between the two. “changed since 09:50” marks a row whose words differ from the first version of this paper. REMOVED marks words that go away.

What was not listed, and why:
- CSS, script paths and ?v= stamps, comments, CSP meta tags (not words a person reads).
- _archive/consulting/*: the old consulting copy moved there; GitHub Pages does not publish folders starting with an underscore, so it is not public.
- web-wave8-1127 and web-credits-help-1127 are parents of the later branches, so their rows are in every stacked branch. web-home-ryagram-1127 adds no words beyond the front-door rows under wave8.
- Chat-editor generated strings: none appear in the assets/app/html diffs.
- Line numbers are lines of the file at that branch's head, not of the diff. Template text with [brackets] is filled in by the page.
- Unchanged since 09:50, so rows are as before: wave8, credits-help, push4b, push5c, editor-poll2, delivery-wide. The depbar3 signed-out walk adds no words.

## Needs Ryan's eye first

CLAIM rows only for the WEB branches (39 rows), plus the removed words, in branch order. GEO's page has its own 19 CLAIM rows at the end under GEO's branch (FYI).


**web-wave8-1127**

- index.html:14: “Ryagram turns public data into short animated films and checks each one against its data. Create a free account to try it.”  (Search-result description (meta) of the front door)
- index.html:31: “Ryagram turns public data into short animated films, and checks each one against its data before you get it.”  (Front door, under the heading)
- index.html:37: “Start free, 16 credits  (16 is filled in from the site setting)”  (Front door, main button)
- index.html:45: “Open now / Data films / Questions answered with public data, drawn as a short animated film, with every source shown.”  (Front door, first project card)
- index.html:47: “Coming soon / Perfect City / Ask about places with free public data: who lives near a spot, what is close by, and how counties have changed. Every number says whether it was counted, calculated or estimated.”  (Front door, project card)
- index.html:48: “Coming soon / Games / Play with your own data and footage in small games you can share.”  (Front door, project card (promise of a later feature))
- index.html:49: “Coming soon / Animation Studio / Simple cartoons you direct, with mouths that move to your voice.”  (Front door, project card (promise of a later feature))
- index.html:84: “We draw it / Ryagram builds an animated film from public data, with every source listed.”  (Front door, step 2)
- index.html:85: “You get it, checked / Each film is checked against its data before you get it.”  (Front door, step 3)
- index.html:93: “Ryagram is open to anyone 18 or older.”  (Front door, closing section)
- index.html:95: “When you confirm your email you get 16 welcome credits, once for each email address. If you sign up with an invite code, you get the credits that code gives instead.”  (Front door, closing section (the 16 is filled in from the site setting))
- assets/app-library.js:411: “No films yet. Your first picture is free.”  (Home page, empty film list (signed in))
- assets/app-library.js:499: “We can’t find that film. It may have expired (films are kept 30 days) or belong to another account.”  (Delivered-film page, error line)

**web-credits-help-1127**

- help/index.html:29 / app-library.js:296: “Ryagram turns public data into short animated films, and checks each one against its data before you get it. You ask a question and it draws the answer, with every source listed.”  (Help page /help/ (public) and in-app Help)
- help/index.html:31: “Making an account is free. When you confirm your email you get 16 welcome credits, once for each email address. If you sign up with an invite code, you get the credits that code gives instead. A free account can make free contact sheets. Each project gets 6 free previews (15 across all projects in any 24 hours); then 1 credit each. Buying credits is not open yet.”  (Help page /help/ (public))
- app-library.js:297: “Making an account is free. A free account can make free contact sheets. Buying credits is not open yet.”  (In-app Help (shorter version of the answer above))
- help/index.html:33 / app-library.js:298: “A contact sheet or preview usually takes about 5 minutes and a full film up to about half an hour once it starts. Films are made one at a time, so a long line can mean hours.”  (Help page /help/ (public) and in-app Help)
- help/index.html:35 / app-library.js:299: “For now each full film is looked at by a person before it starts. It waits with its credits held, and if it is not approved they come back. We do not send an email when a film is ready, so check the film’s page.”  (Help page /help/ (public) and in-app Help)
- help/index.html:37 / app-library.js:300: “Open My films: it lists every film you are making and where it stands. A finished film is under the Files tab of its page, and it is kept for 30 days.”  (Help page /help/ (public) and in-app Help)
- help/index.html:39 / app-library.js:301: “Ryagram draws from public data it already has, such as housing permits, unemployment, health and industry. Pick a ready-made film to see what is on offer. You cannot upload your own data yet.”  (Help page /help/ (public) and in-app Help)
- assets/app-library.js:1103: “When you ask for a full film, its credits are held: set aside, not spent. The line at the top of this page shows how many are available and how many are held. If the film fails, or you cancel it before it starts, the credits come back.”  (In-app Credits page)
- assets/app-library.js:1104: “When your credits run out, contact sheets and your free previews still work. More credits are coming soon.”  (In-app Credits page)

**web-push5c-1127**

- assets/app-library.js:297; help/index.html:31 (same answer): “Films are made one at a time, oldest first. Yours starts when the ones ahead of it finish. A contact sheet or preview usually takes about 5 minutes and a full film up to about half an hour, so a long line can mean hours, or a day or more when many people join at once, such as a launch day. A full film is checked by a person before it starts, and it joins the end of the line when it is approved. The Render panel shows your place in line. You can have 2 films waiting at once. We do not send an email when a film is ready, so come back to this page to check.”  (In-app Help and /help/ (public).)
- assets/app-jobs.js:175: “(one-at-a-time sentence) (full-film sentence), and a sheet or preview ahead of yours takes a few minutes, so it may be hours with this many ahead.”  (Render panel, queue line (signed in); the two shared sentences are built from named parts defined elsewhere in the file)
- assets/app-jobs.js:176: “(one-at-a-time sentence) (full-film sentence), so yours may start after a few films, not a few minutes.”  (Render panel, queue line)
- assets/app-jobs.js:178: “(one-at-a-time sentence) Yours starts in about [hours], maybe more if full films are ahead of yours.”  (Render panel, queue line)
- assets/app-jobs.js:179: “(one-at-a-time sentence) It may be working on another film right now. Yours starts in about [time] and takes about 5 more. A full film ahead of yours can take up to half an hour, so it may take longer.”  (Render panel, queue line)

**web-comp-fold2-1127**

- app-compilations.js:67: “[state words] [counts], counted on your computer.”  (Your requests tab, counts line)
- app-compilations.js:72: “Your videos never leave your computer. This page saves only your request: the words, the names of your folders, your note and the name of your compilation. The Ryagram app on your computer finds the matches and makes the film there.”  (Compilations page, privacy note)
- app-compilations.js:77 build_failed: “The film could not be built. Nothing left your computer. Try again in the Ryagram app.”  (same: the reason shown when a run fails)
- app-compilations.js:77 crash: “Something went wrong on your computer. Nothing left it. Close the app, open it and try again.”  (same: the reason shown when a run fails)
- app-compilations.js:102: “Added one folder. Only its name is used; nothing was read or sent.”  (Start tab, after picking a folder)
- app-compilations.js:138: “Your browser lists the folder’s files to this page only to read the folder’s name, and may use the word upload for it. Nothing is uploaded: nothing leaves your computer.”  (Start tab, hint under the folder picker)
- REMOVED, index.html:46 (wave8 added it): “Say a phrase. Ryagram finds every time it is said in your own footage and strings the moments together. Soon it will turn your clips into songs, too.”  (Front door, Compilations card. Gone in fold2)
- REMOVED, ryagram/index.html:157 (on live main too): “...strings the moments together. Soon it will turn your clips into songs, too.”  (/ryagram/ page, Compilation Maker card. Gone in fold2)
- REMOVED, assets/app-departments.js:10 (on live main too): “...strings the moments together. Soon it will turn your clips into songs, too.”  (Compilations Coming soon line in the app. Gone in fold2)
- REMOVED, supabase/functions/connect-core/home_panel.ts:20 (on live main too): “...strings the moments together. Soon it will turn your clips into songs, too.”  (The line a connected AI is given for Compilations. Gone in fold2)
- REMOVED, app-compilations.js:77 stale (older text): “That request was replaced by a newer one.”  (Replaced by “The build stopped reporting. You can start it again from the app.”)
- REMOVED, app-compilations.js:77 edit_failed (older text): “...if it happens twice, tell us.”  (Replaced by “...use Contact at the bottom of the page.”)
- REMOVED, app-compilations.js tab names (older text): “Start a compilation / Your requests”  (Replaced by “Start / Requests”)
- REMOVED, app-compilations.js counts (older text): “[n] seconds long” for 1  (Now “1 second long”)

**web-editor-poll2-1127**

- app-editor.js:568: “Only the page colour changes. Your data does not. Undo takes it back.”  (Editor, note under the background buttons)
- app-compilations.js:43/55/60/64 (older draft): “Your videos never leave your computer. This page saves only your request: the words, and the names of your folders. The Ryagram app on your computer finds the matches and makes the film there.”  (Compilations page in the app (signed in, 'compilations' switch on): privacy note (older wording))
- app-compilations.js:64 (older draft): “Your AI’s request could not be read. / Songs are made in the song tools, not here. / Choose where these videos are on your computer. / A folder you chose is not there any more. / A folder you chose has no videos. / Two folders hold the same videos. / No speech was found in your videos. / Your videos do not say it. / The draft could not be made into a film list. / The film could not be built. Nothing left your computer. / Something went wrong on your computer.”  (Compilations page in the app (signed in, 'compilations' switch on): run failure reasons (older wording; the 'Nothing left your computer' sentences are the claims))
- app-compilations.js:89 (older draft): “Added the folder name “[name]” ([n] file(s) in it). Only its name is used; nothing was read or sent.”  (Compilations page in the app (signed in, 'compilations' switch on): after picking a folder)

**web-games-polish3-1127**

- app-games.js:186: “Five sample rounds made from a made-up script. Names and guesses pass between this screen and the phones and are not kept.”  (Games room host screen in the app (signed in, 'games' switch on), note)
- game-phone-live.js:188: “DRAFT. Text only: no microphone and no camera. Your name and guesses go to the host’s screen in this room and are not kept.”  (Phone join page /game-phone/ (public link), banner at the top)
- REMOVED, app-games.js:177-178 (polish2): “This page could not open a game room. Reload and try again.” / “This page could not open a game room. Check your connection and reload.”  (Games room host screen, failed room)

## web-wave8-1127 (front door, library words, state-industry chart captions)

Head 383edc58, unchanged since 09:50 except the one row marked changed below.

Also carries the same front-door text as web-home-ryagram-1127 (that branch adds no words that wave8 lacks); every later stack branch contains these rows too. Archive pages under _archive/consulting are not listed: the old consulting copy moved there, GitHub Pages does not publish folders starting with an underscore, and the text is not new.

| file:line | exact words | where a person sees it | flag |
|---|---|---|---|
| index.html:13 | Ryagram: you have a question, Ryagram makes the data answer it | Browser tab title of the front door | PLAIN |
| index.html:14 | Ryagram turns public data into short animated films and checks each one against its data. Create a free account to try it. | Search-result description (meta) of the front door | CLAIM |
| index.html:25 | Skip to the sign-up | Hidden skip link, shown on keyboard focus | PLAIN |
| index.html:26 | Ryagram home / Create an account | aria-labels of the logo link and the top button | PLAIN |
| index.html:30 | You have a question. Ryagram makes the data answer it. | Front door, main heading | PLAIN |
| index.html:31 | Ryagram turns public data into short animated films, and checks each one against its data before you get it. | Front door, under the heading | CLAIM |
| index.html:34 | A map of US states shaded by adult obesity, with dots for new restaurants. | Alt text of the hero picture | PLAIN |
| index.html:35 | A film made with Ryagram. | Caption of the hero picture | PLAIN |
| index.html:37 | Start free, 16 credits  (16 is filled in from the site setting) | Front door, main button | CLAIM |
| index.html:37 | Sign in | Front door, link next to the button | PLAIN |
| index.html:38 | Bring your own AI: connect Claude or ChatGPT to your account (Account, then Connected AIs) and ask it to build a film. | Front door, line shown only when the connector switch is on | PLAIN |
| index.html:43 | What Ryagram makes | Front door, section heading | PLAIN |
| index.html:45 | Open now / Data films / Questions answered with public data, drawn as a short animated film, with every source shown. | Front door, first project card | CLAIM |
| index.html:46 | Coming soon / Compilations / Say a phrase. Ryagram finds every time it is said in your own footage and strings the moments together. | Front door, project card. In wave8 alone the card ends with the songs sentence (see REMOVED under web-comp-fold2-1127); with fold2 it reads as here | PLAIN; changed since 09:50 |
| index.html:47 | Coming soon / Perfect City / Ask about places with free public data: who lives near a spot, what is close by, and how counties have changed. Every number says whether it was counted, calculated or estimated. | Front door, project card | CLAIM |
| index.html:48 | Coming soon / Games / Play with your own data and footage in small games you can share. | Front door, project card (promise of a later feature) | CLAIM |
| index.html:49 | Coming soon / Animation Studio / Simple cartoons you direct, with mouths that move to your voice. | Front door, project card (promise of a later feature) | CLAIM |
| index.html:56-57 | Films made with Ryagram / From finished films made with Ryagram. | Front door, films row heading and line | PLAIN |
| index.html:60 | A map of US counties changing colour year by year, from a film about building permits. | aria-label of film 1 picture | PLAIN |
| index.html:61-62 | America Never Started Building Again / Watch the full film | Front door, film 1 title and link | PLAIN |
| index.html:65 | A map and a bar race side by side, from a film about fast food and obesity. | aria-label of film 2 picture | PLAIN |
| index.html:66-67 | Did Fast Food Grow With Obesity? / Watch the full film | Front door, film 2 title and link | PLAIN |
| index.html:70 | The Interstate Highway System growing across a map of the United States, road by road, in the year each was built. A film made with Ryagram. | aria-label of film 3 picture | PLAIN |
| index.html:71-72 | Rise of the Interstate Highway, 1956-1993 / Watch the full film | Front door, film 3 title and link | PLAIN |
| index.html:81 | How it works | Front door, section heading | PLAIN |
| index.html:83 | Ask / Tell us the question you want data to answer. | Front door, step 1 | PLAIN |
| index.html:84 | We draw it / Ryagram builds an animated film from public data, with every source listed. | Front door, step 2 | CLAIM |
| index.html:85 | You get it, checked / Each film is checked against its data before you get it. | Front door, step 3 | CLAIM |
| index.html:92 | Make one | Front door, closing section heading | PLAIN |
| index.html:93 | Ryagram is open to anyone 18 or older. | Front door, closing section | CLAIM |
| index.html:95 | When you confirm your email you get 16 welcome credits, once for each email address. If you sign up with an invite code, you get the credits that code gives instead. | Front door, closing section (the 16 is filled in from the site setting) | CLAIM |
| index.html:99 | Ryagram is operated by L'Ai, LLC. / ryagram@uselai.com / Terms of Use / Privacy Policy / AI content / Need help? Get help | Front door, footer | PLAIN |
| thank-you.html:14; workflow-audit-thanks.html:14; workflow-audit/index.html:14 | This page has moved. Go to Ryagram. | Old links /thank-you.html, /workflow-audit-thanks.html, /workflow-audit/ now show only this line | PLAIN |
| assets/app-builder.js:31 | Private health care and social assistance as a share of private jobs, state by state, 1998 to 2023. / Which states depend most on private health care & social assistance? | Chart description and question on the ready-made film page | PLAIN |
| assets/app-builder.js:32 | Manufacturing as a share of private jobs: the top states as lines, 1998 to 2023. / Which states depend most on manufacturing? | Ready-made film page | PLAIN |
| assets/app-builder.js:33 | Accommodation and food services as a share of private jobs: the top states as lines, 1998 to 2023. / Which states depend most on accommodation & food services? | Ready-made film page | PLAIN |
| assets/app-builder.js:34 | Construction as a share of private jobs, state by state, 1998 to 2023. / Which states depend most on construction? | Ready-made film page | PLAIN |
| assets/app-builder.js:35 | Retail as a share of private jobs: the top states as lines, 1998 to 2023. / Which states depend most on retail? | Ready-made film page | PLAIN |
| assets/app-builder.js:36 | Transportation and warehousing as a share of private jobs: the top states as lines, 1998 to 2023. / Which states depend most on transportation & warehousing? | Ready-made film page | PLAIN |
| assets/app-library.js:411 | No films yet. Your first picture is free. | Home page, empty film list (signed in) | CLAIM |
| assets/app-library.js:412 | No films yet. Name your first film above, then pick a ready-made film to start from. | Home page, empty film list (signed in) | PLAIN |
| assets/app-library.js:497 | Open or download / Make another film | Delivered-film page: two buttons | PLAIN |
| assets/app-library.js:499 | We can’t find that film. It may have expired (films are kept 30 days) or belong to another account. | Delivered-film page, error line | CLAIM |
| assets/app-library.js:1309 | Files | Tab name on a film page | PLAIN |

## web-credits-help-1127 (Credits and Help)

Help page text is added to /help/index.html (public) and the same questions are in the in-app Help panel (app-library.js).

| file:line | exact words | where a person sees it | flag |
|---|---|---|---|
| help/index.html:28 / app-library.js:296 | What is Ryagram? | Help question | PLAIN |
| help/index.html:29 / app-library.js:296 | Ryagram turns public data into short animated films, and checks each one against its data before you get it. You ask a question and it draws the answer, with every source listed. | Help page /help/ (public) and in-app Help | CLAIM |
| help/index.html:30 / app-library.js:297 | Is it free? | Help question | PLAIN |
| help/index.html:31 | Making an account is free. When you confirm your email you get 16 welcome credits, once for each email address. If you sign up with an invite code, you get the credits that code gives instead. A free account can make free contact sheets. Each project gets 6 free previews (15 across all projects in any 24 hours); then 1 credit each. Buying credits is not open yet. | Help page /help/ (public) | CLAIM |
| app-library.js:297 | Making an account is free. A free account can make free contact sheets. Buying credits is not open yet. | In-app Help (shorter version of the answer above) | CLAIM |
| help/index.html:32 / app-library.js:298 | How long does a film take? | Help question | PLAIN |
| help/index.html:33 / app-library.js:298 | A contact sheet or preview usually takes about 5 minutes and a full film up to about half an hour once it starts. Films are made one at a time, so a long line can mean hours. | Help page /help/ (public) and in-app Help | CLAIM |
| help/index.html:34 / app-library.js:299 | Why does a full film wait for approval? | Help question | PLAIN |
| help/index.html:35 / app-library.js:299 | For now each full film is looked at by a person before it starts. It waits with its credits held, and if it is not approved they come back. We do not send an email when a film is ready, so check the film’s page. | Help page /help/ (public) and in-app Help | CLAIM |
| help/index.html:36 / app-library.js:300 | Where is my film? | Help question | PLAIN |
| help/index.html:37 / app-library.js:300 | Open My films: it lists every film you are making and where it stands. A finished film is under the Files tab of its page, and it is kept for 30 days. | Help page /help/ (public) and in-app Help | CLAIM |
| help/index.html:38 / app-library.js:301 | Which data can I use? | Help question | PLAIN |
| help/index.html:39 / app-library.js:301 | Ryagram draws from public data it already has, such as housing permits, unemployment, health and industry. Pick a ready-made film to see what is on offer. You cannot upload your own data yet. | Help page /help/ (public) and in-app Help | CLAIM |
| assets/app-library.js:294 | First questions | In-app Help, section heading | PLAIN |
| assets/app-library.js:1101 | How credits work | In-app Credits page, section heading | PLAIN |
| assets/app-library.js:1103 | When you ask for a full film, its credits are held: set aside, not spent. The line at the top of this page shows how many are available and how many are held. If the film fails, or you cancel it before it starts, the credits come back. | In-app Credits page | CLAIM |
| assets/app-library.js:1104 | When your credits run out, contact sheets and your free previews still work. More credits are coming soon. | In-app Credits page | CLAIM |

## web-push5c-1127 (queue words, on top of push4b)

Push 5c rewrites the queue-wait sentences and the Help answer about a film still queued.

| file:line | exact words | where a person sees it | flag |
|---|---|---|---|
| assets/app-library.js:297 | Why is my film still "Queued"? | In-app Help question | PLAIN |
| assets/app-library.js:297; help/index.html:31 (same answer) | Films are made one at a time, oldest first. Yours starts when the ones ahead of it finish. A contact sheet or preview usually takes about 5 minutes and a full film up to about half an hour, so a long line can mean hours, or a day or more when many people join at once, such as a launch day. A full film is checked by a person before it starts, and it joins the end of the line when it is approved. The Render panel shows your place in line. You can have 2 films waiting at once. We do not send an email when a film is ready, so come back to this page to check. | In-app Help and /help/ (public). | CLAIM |
| assets/app-jobs.js:175 | (one-at-a-time sentence) (full-film sentence), and a sheet or preview ahead of yours takes a few minutes, so it may be hours with this many ahead. | Render panel, queue line (signed in); the two shared sentences are built from named parts defined elsewhere in the file | CLAIM |
| assets/app-jobs.js:176 | (one-at-a-time sentence) (full-film sentence), so yours may start after a few films, not a few minutes. | Render panel, queue line | CLAIM |
| assets/app-jobs.js:178 | (one-at-a-time sentence) Yours starts in about [hours], maybe more if full films are ahead of yours. | Render panel, queue line | CLAIM |
| assets/app-jobs.js:179 | (one-at-a-time sentence) It may be working on another film right now. Yours starts in about [time] and takes about 5 more. A full film ahead of yours can take up to half an hour, so it may take longer. | Render panel, queue line | CLAIM |
| assets/app-ops.js:242 | [n] full render(s) waiting for your approval, oldest first. Approving puts it in line, at the end; declining returns the person’s credits. / No full renders are waiting for approval. | Owner/operator screens only (not shown to ordinary visitors) | PLAIN |

## web-comp-fold2-1127 (Compilations page and FACES' error words; includes comp-mirror and compstates)

Head 33389560 (was comp-mirror f14eb79a at 09:50; fold2 adds two commits, 3919beca 09:54 and 33389560 10:14). The page shows only to an account with the 'compilations' switch on; the front-door card for it says Coming soon. Line numbers are lines of assets/app-compilations.js at the fold2 head (a ~ means approximate). web-editor-poll2-1127 carries an older draft of some of these sentences (listed under the editor branch); fold2's sentences replace them if both are merged.

Changed since 09:50: the earlier-version line (new), the stale and edit_failed reasons, the unknown-state rule, '1 second long', the tab labels Start and Requests, the no-app line rule, and the songs sentence is REMOVED everywhere (rows at the end of this section). The folder-name check changed in code only.

| file:line | exact words | where a person sees it | flag |
|---|---|---|---|
| app-compilations.js:34 | Type the words to look for. | Compilations page in the app (signed in, 'compilations' switch on): form error | PLAIN |
| app-compilations.js:35 | The words to look for can be at most 200 characters. | form error | PLAIN |
| app-compilations.js:37 | The note can be at most 500 characters. | form error | PLAIN |
| app-compilations.js:38 | Write words, not a place on your computer. Folders are named, never located. | form error | PLAIN |
| app-compilations.js:40 | Name at least one folder of yours that holds the videos. | form error | PLAIN |
| app-compilations.js:41 | Name at most 10 folders. | form error | PLAIN |
| app-compilations.js:43 | That is not a folder name. Type only the folder’s name, like Interviews, never where it is. | form error | PLAIN |
| app-compilations.js:52 | “[the words]”: [every time it is said / these words in this order], in [n] folder(s)[, as a song]. Saved [date] | Your requests tab, line under each request | PLAIN |
| app-compilations.js:62 | [state words] Something went wrong. Try again from the app. | Your requests tab, only for a failed run whose reason the page does not know. An unknown STATE now shows only the waiting line, never this or any counts | PLAIN; changed since 09:50 |
| app-compilations.js:64-66 | [n] match(es) / [n] clip(s) / 1 second long / [n] seconds long | Your requests tab, counts. “1 second long” is new: before it said “1 seconds long” | PLAIN; changed since 09:50 |
| app-compilations.js:67 | [state words] [counts], counted on your computer. | Your requests tab, counts line | CLAIM |
| app-compilations.js:71 | Say a phrase. Ryagram finds every time it is said in your own footage and strings the moments together. | Compilations page, intro | PLAIN |
| app-compilations.js:72 | Your videos never leave your computer. This page saves only your request: the words, the names of your folders, your note and the name of your compilation. The Ryagram app on your computer finds the matches and makes the film there. | Compilations page, privacy note | CLAIM |
| app-compilations.js:73 | Waiting for the Ryagram app on your computer. | Your requests tab, state (also shown when a run has no state, or a state the page does not know) | PLAIN |
| app-compilations.js:74 | This is for an earlier version of your request. Save again to start over. | Your requests tab, shown when a run belongs to an older save of the request (new since 09:50; it replaces showing the waiting line) | PLAIN; changed since 09:50 |
| app-compilations.js:75 | The Ryagram app is planning your film. / The Ryagram app is finding the matches on your computer. / The Ryagram app is making your film on your computer. / Done. Your film is on your computer. / It did not finish. / Stopped. | Your requests tab, run states | PLAIN |
| app-compilations.js:77 request_invalid | The request could not be read. Save it again, or ask your AI to write it again. | Your requests tab, reason shown when a run fails (FACES’ closed list of reasons the app can report; every one is quoted here, twelve with stale) | PLAIN |
| app-compilations.js:77 song_request | Compilations do not make songs. Take out the song and save again. | same: the reason shown when a run fails | PLAIN |
| app-compilations.js:77 folder_not_chosen | A folder in your request is not chosen on your computer yet. Open the Ryagram app and choose where that folder is. | same: the reason shown when a run fails | PLAIN |
| app-compilations.js:77 folder_missing | A folder you chose is not there any more. Open the Ryagram app and choose it again. | same: the reason shown when a run fails | PLAIN |
| app-compilations.js:77 folder_empty | A folder you chose has no videos in it. Choose the folder that holds your videos. | same: the reason shown when a run fails | PLAIN |
| app-compilations.js:77 folders_overlap | Two of your folders hold the same videos. Choose folders that do not overlap. | same: the reason shown when a run fails | PLAIN |
| app-compilations.js:77 no_speech | No speech was found in your videos. Try videos where people talk. | same: the reason shown when a run fails | PLAIN |
| app-compilations.js:77 not_said | Your videos do not say these words. Try other words, or add more folders. | same: the reason shown when a run fails | PLAIN |
| app-compilations.js:77 edit_failed | The matches could not be turned into a film. Try again; if it happens twice, use Contact at the bottom of the page. | same. Before: “...if it happens twice, tell us.” | PLAIN; changed since 09:50 |
| app-compilations.js:77 build_failed | The film could not be built. Nothing left your computer. Try again in the Ryagram app. | same: the reason shown when a run fails | CLAIM |
| app-compilations.js:77 stale | The build stopped reporting. You can start it again from the app. | same; also now the only line shown (no counts) for a run in the stale state. Before: “That request was replaced by a newer one.” | PLAIN; changed since 09:50 |
| app-compilations.js:77 crash | Something went wrong on your computer. Nothing left it. Close the app, open it and try again. | same: the reason shown when a run fails | CLAIM |
| app-compilations.js:78 | The Ryagram app is not on a computer of yours yet. You can save a request now; the app reads it when you open it. | Your requests tab; now shown only when the list of the person’s computers loaded and is empty AND no request has a run yet | PLAIN; changed since 09:50 |
| app-compilations.js:91 | Every time it is said / These words in this order, one place each | Choice list ‘How to find them’ | PLAIN |
| app-compilations.js:102 | Added one folder. Only its name is used; nothing was read or sent. | Start tab, after picking a folder | CLAIM |
| app-compilations.js:~140 | Save my request | Start tab, button | PLAIN |
| app-compilations.js:111 | Saving… | Start tab, button while saving | PLAIN |
| app-compilations.js:131 | Name your compilation (optional) | Start tab, label | PLAIN |
| app-compilations.js:132 | The words to find | Start tab, label | PLAIN |
| app-compilations.js:133 | Up to 200 characters. | Start tab, hint | PLAIN |
| app-compilations.js:134 | How to find them | Start tab, label | PLAIN |
| app-compilations.js:135 | Your folders (the names, one per line) | Start tab, label | PLAIN |
| app-compilations.js:136 | Type only a folder’s name, like Interviews. Never where it is on your computer. | Start tab, hint | PLAIN |
| app-compilations.js:137 | Or pick a folder to add its name | Start tab, label | PLAIN |
| app-compilations.js:138 | Your browser lists the folder’s files to this page only to read the folder’s name, and may use the word upload for it. Nothing is uploaded: nothing leaves your computer. | Start tab, hint under the folder picker | CLAIM |
| app-compilations.js:139 | A note to yourself (optional) | Start tab, label | PLAIN |
| app-compilations.js:143 | Saved. Open the Ryagram app on your computer to find the matches and make a preview. | After saving (status line) | PLAIN |
| app-compilations.js:148 | Couldn’t load your requests. | Your requests tab, error | PLAIN |
| app-compilations.js:153 | Get the Ryagram app | Your requests tab, link to /get-app/ | PLAIN |
| app-compilations.js:156 | No compilation requests yet. Start one on the first tab. | Your requests tab, empty | PLAIN |
| app-compilations.js:164 | Compilations | Page heading | PLAIN |
| app-compilations.js:161-162 | Start / Requests | Tab names. Before: “Start a compilation / Your requests” | PLAIN; changed since 09:50 |
| app-compilations.js:164 | ← All projects | Back link | PLAIN |
| app-data.js:582 | Couldn’t save the request. | Error line after a failed save | PLAIN |
| app-data.js:584 and 586 | Couldn’t load your requests. | Error line | PLAIN |
| app-data.js:590 | A compilation | Title shown for a request that has no name | PLAIN |
| app-editor.js:381 | Redo / Redone. | See the editor table (these editor words are in compstates too) | PLAIN |
| app-editor.js:386-392 | Keyboard shortcuts / Shortcuts (list: see editor table) | See the editor table | PLAIN |

### Removed or replaced by fold2

| file:line | the words that go | where | flag |
|---|---|---|---|
| index.html:46 (wave8 added it) | “Say a phrase. Ryagram finds every time it is said in your own footage and strings the moments together. Soon it will turn your clips into songs, too.” | Front door, Compilations card. Gone in fold2 | REMOVED in web-comp-fold2-1127 |
| ryagram/index.html:157 (on live main too) | “...strings the moments together. Soon it will turn your clips into songs, too.” | /ryagram/ page, Compilation Maker card. Gone in fold2 | REMOVED in web-comp-fold2-1127 |
| assets/app-departments.js:10 (on live main too) | “...strings the moments together. Soon it will turn your clips into songs, too.” | Compilations Coming soon line in the app. Gone in fold2 | REMOVED in web-comp-fold2-1127 |
| supabase/functions/connect-core/home_panel.ts:20 (on live main too) | “...strings the moments together. Soon it will turn your clips into songs, too.” | The line a connected AI is given for Compilations. Gone in fold2 | REMOVED in web-comp-fold2-1127 |
| app-compilations.js:77 stale (older text) | “That request was replaced by a newer one.” | Replaced by “The build stopped reporting. You can start it again from the app.” | REMOVED in web-comp-fold2-1127 |
| app-compilations.js:77 edit_failed (older text) | “...if it happens twice, tell us.” | Replaced by “...use Contact at the bottom of the page.” | REMOVED in web-comp-fold2-1127 |
| app-compilations.js tab names (older text) | “Start a compilation / Your requests” | Replaced by “Start / Requests” | REMOVED in web-comp-fold2-1127 |
| app-compilations.js counts (older text) | “[n] seconds long” for 1 | Now “1 second long” | REMOVED in web-comp-fold2-1127 |

## web-editor-poll2-1127 (editor Redo, shortcuts, colours/background, statuses, undo messages)

The Redo, Shortcuts and Undone/Redone words are also in web-compstates-1127 and web-comp-mirror-1127 (listed here once). Chat-editor generated strings: no generated file changed in this branch's assets/app/html diff, so there are none to list. The last block is an older draft of the Compilations page words that this branch carries; compstates/comp-mirror replace those sentences.

| file:line | exact words | where a person sees it | flag |
|---|---|---|---|
| app-editor.js:393 | Redo | Button in the editor top bar | PLAIN |
| app-editor.js:393 | Redone. | Polite status line after Redo (screen readers) | PLAIN |
| app-editor.js:392 | Undone. | Status line after Undo (wording of the status is touched by this branch) | PLAIN |
| app-editor.js:394 | Back to the last save. | Status line after Revert | PLAIN |
| app-editor.js:404 | Shortcuts / Keyboard shortcuts (?) | Editor button text and its aria-label | PLAIN |
| app-editor.js:386-392 (shortcuts box) | Shortcuts. Ctrl+Z undo. Ctrl+Y or Ctrl+Shift+Z redo (on a Mac, Cmd instead of Ctrl). On the picture slider: Space or K play and pause; Left or Right arrow one step; Shift with an arrow, or J L, a tenth of the film. In Pro: J K L shuttle; , . one frame; [ ] previous or next cut or marker; M add a marker; S split a clip (clip films). ? shows or hides this list | Editor, list opened by the Shortcuts button | PLAIN |
| app-editor.js:87 | Trimmed the clip to [n] seconds. | Editor polite status after a trim | PLAIN |
| app-editor.js:88 | Moved the clip to start at [n] seconds. | Editor polite status after a move | PLAIN |
| app-editor.js:89 | Moved the clip later / earlier, now number [n] of [m]. | Editor polite status after a reorder | PLAIN |
| app-editor.js:333 | Year [n]   /   [n] seconds of [m] | Screen-reader value text of the picture slider | PLAIN |
| app-editor.js:566 | Background | Editor, group heading | PLAIN |
| app-editor.js:561 | Black / Dark / White | Editor, three background buttons | PLAIN |
| app-editor.js:567 | That background is already chosen. | Editor status line | PLAIN |
| app-editor.js:568 | Only the page colour changes. Your data does not. Undo takes it back. | Editor, note under the background buttons | CLAIM |
| app-editor.js:571 | Colour palette | Editor, group heading | PLAIN |
| app-editor.js:572 | Use the film’s own colours | Editor, button | PLAIN |
| app-editor.js:572 | The film’s own colours are back. Undo takes your colours back. | Editor status line | PLAIN |
| app-editor.js:607 and 645 | Colours | Editor, section heading | PLAIN |
| app-editor.js:391 | Could not undo. Try again. | Editor status line when an undo throws | PLAIN |
| app-editor-draft.js:116 | Could not undo. Try again. | Editor status line | PLAIN |
| app-editor-draft.js:117 | That could not be undone. | Editor status line | PLAIN |
| app-editor-draft.js:122 | That change could not be undone, because a newer change to the same setting stands. Nothing was changed. | Editor status line | PLAIN |
| app-editor-draft.js:129 | Nothing to undo here. | Editor status line | PLAIN |
| app-editor-draft.js:130 | That change was already undone. | Editor status line | PLAIN |
| app-editor-draft.js:133 | Part of that could not be undone. The parts that were undone are off the screen. | Editor status line (the first sentence can also be an error text from the server) | PLAIN |
| app-editor-pro.js:177 | Wait for the last change to finish. | Pro editor status line | PLAIN |
| app-editor-pro.js:178 | The film is locked, so nothing can be undone now. | Pro editor status line | PLAIN |
| app-editor-pro.js:179 | Close What will render first, then undo. | Pro editor status line | PLAIN |
| app-editor-pro.js:185-186 | That could not be undone. | Pro editor status line | PLAIN |
| app-editor-pro.js:188 | Could not undo. Try again. | Pro editor status line | PLAIN |
| app-compilations.js:34 (older draft) | “[first 40 characters]” is not a folder name. Type only the folder’s name, like Interviews, never where it is. | Compilations page in the app (signed in, 'compilations' switch on): form error. Older wording; it echoes what was typed, which compstates removed | PLAIN |
| app-compilations.js:43/55/60/64 (older draft) | Your videos never leave your computer. This page saves only your request: the words, and the names of your folders. The Ryagram app on your computer finds the matches and makes the film there. | Compilations page in the app (signed in, 'compilations' switch on): privacy note (older wording) | CLAIM |
| app-compilations.js:64 (older draft) | Your AI’s request could not be read. / Songs are made in the song tools, not here. / Choose where these videos are on your computer. / A folder you chose is not there any more. / A folder you chose has no videos. / Two folders hold the same videos. / No speech was found in your videos. / Your videos do not say it. / The draft could not be made into a film list. / The film could not be built. Nothing left your computer. / Something went wrong on your computer. | Compilations page in the app (signed in, 'compilations' switch on): run failure reasons (older wording; the 'Nothing left your computer' sentences are the claims) | CLAIM |
| app-compilations.js:89 (older draft) | Added the folder name “[name]” ([n] file(s) in it). Only its name is used; nothing was read or sent. | Compilations page in the app (signed in, 'compilations' switch on): after picking a folder | CLAIM |
| app-compilations.js:103/136 | Saved. Open the Ryagram app on your computer to find the matches and make a preview. / No compilation requests yet. Start one on the first tab. | Compilations page in the app (signed in, 'compilations' switch on) | PLAIN |

## web-games-polish3-1127 (Games room words)

Head c689071c (09:44; polish2 was c0e302a1). The only words that changed since 09:50 are the two failed-room lines marked below. The Games room host screen shows only to an account with the 'games' switch on (the front-door card says Coming soon); the phone page /game-phone/ is reachable by link. The sample-round files (game-rounds.js, game-gap-rounds.js) hold made-up sentences for sample rounds, e.g. 'We ____ a tiny orchestra living inside the old piano.'; they are sample game content, not site copy, and only the first sample line is quoted.

| file:line | exact words | where a person sees it | flag |
|---|---|---|---|
| app-departments.js:201 | Guess the next line: a line is read out and stops, and everyone types on their phone what comes next. | Games page, intro under the heading | PLAIN |
| app-games.js:23 | Type a name for the scoreboard. | Games room host screen in the app (signed in, 'games' switch on) | PLAIN |
| app-games.js:24 | Someone in this room already has that name. Add a letter or pick another. | Games room host screen in the app (signed in, 'games' switch on) | PLAIN |
| app-games.js:25 | This room is full ([n] players). | Games room host screen in the app (signed in, 'games' switch on) | PLAIN |
| app-games.js:46 | Opening a room… | Games room host screen in the app (signed in, 'games' switch on) | PLAIN |
| app-games.js:65 | A message did not reach the phones. It is sent again every 5 seconds. | Games room host screen in the app (signed in, 'games' switch on) | PLAIN |
| app-games.js:73 | This game has already started. Wait for the next one. | Games room host screen in the app (signed in, 'games' switch on) and phone page | PLAIN |
| app-games.js:78 / 83 | [name] joined. / [name] left. | Games room host screen in the app (signed in, 'games' switch on), status line | PLAIN |
| app-games.js:102 / 144 | [n] seconds left | Games room host screen in the app (signed in, 'games' switch on) | PLAIN |
| app-games.js:103 / 144 | Round [n] of [m]. | Games room host screen in the app (signed in, 'games' switch on) | PLAIN |
| app-games.js:112 | The answer was: [answer]. | Games room host screen in the app (signed in, 'games' switch on) | PLAIN |
| app-games.js:115 | The game is over. [names] share / takes first place. | Games room host screen in the app (signed in, 'games' switch on) | PLAIN |
| app-games.js:124 / 137 | Players ([n] of [max]): [names]. / No one has joined yet. | Games room host screen in the app (signed in, 'games' switch on) | PLAIN |
| app-games.js:127 / 149 | Guesses in: [n] of [m] | Games room host screen in the app (signed in, 'games' switch on) | PLAIN |
| app-games.js:134 | Waiting for players | Games room host screen in the app (signed in, 'games' switch on) | PLAIN |
| app-games.js:135 | Room code | Games room host screen in the app (signed in, 'games' switch on) | PLAIN |
| app-games.js:136 | On a phone, open [address] and type the room code. | Games room host screen in the app (signed in, 'games' switch on) | PLAIN |
| app-games.js:138 | Which game? | Games room host screen in the app (signed in, 'games' switch on) | PLAIN |
| app-games.js:139 | A line stops partway; type what comes next. / A line has one word missing; type the missing word. | Games room host screen in the app (signed in, 'games' switch on), the two game choices | PLAIN |
| app-games.js:141 | Start the game | Games room host screen in the app (signed in, 'games' switch on), button | PLAIN |
| app-games.js:146 | Read this line aloud and say "blank" for the gap: the players type the missing word. / One word is missing. | Games room host screen in the app (signed in, 'games' switch on) | PLAIN |
| app-games.js:147 | Read this line aloud, then stop: the players guess what comes next. (These sample rounds have no video.) | Games room host screen in the app (signed in, 'games' switch on) | PLAIN |
| app-games.js:148 | [n] word is / words are left to guess. | Games room host screen in the app (signed in, 'games' switch on) | PLAIN |
| app-games.js:150 | Show the answer now | Games room host screen in the app (signed in, 'games' switch on), button | PLAIN |
| app-games.js:153-154 | Round [n]: the answer / [n] points ([verdict]) | Games room host screen in the app (signed in, 'games' switch on) | PLAIN |
| app-games.js:156 | See the final scores / Next round | Games room host screen in the app (signed in, 'games' switch on), buttons | PLAIN |
| app-games.js:159-160 | [place]. [name]: [total] / A tie shares the place. | Games room host screen in the app (signed in, 'games' switch on), scoreboard | PLAIN |
| app-games.js:176-178 | Try again / This page could not open a game room. Try again. / This page could not open a game room. Check your connection and try again. | Games room host screen in the app (signed in, 'games' switch on), failed room: the line is announced first, then the Try again button shows | PLAIN; changed since 09:50 |
| app-games.js:181 | Room [code] is open. | Games room host screen in the app (signed in, 'games' switch on) | PLAIN |
| app-games.js:186 | Five sample rounds made from a made-up script. Names and guesses pass between this screen and the phones and are not kept. | Games room host screen in the app (signed in, 'games' switch on), note | CLAIM |
| game-phone-live.js:61 / 77 | Room code | Phone join page /game-phone/ (public link), label | PLAIN |
| game-phone-live.js:59 | The [n] letters on the host's screen. | Phone join page /game-phone/ (public link), hint | PLAIN |
| game-phone-live.js:60 | For the scoreboard, at most [n] letters. | Phone join page /game-phone/ (public link), hint | PLAIN |
| game-phone-live.js:60 | Your name | Phone join page /game-phone/ (public link), label | PLAIN |
| game-phone-live.js:61 / 78 | Join the room | Phone join page /game-phone/ (public link), button | PLAIN |
| game-phone-live.js:74 | Joining… | Phone join page /game-phone/ (public link), button while joining | PLAIN |
| game-phone-live.js:73 / 79 | This page could not reach the game rooms. Reload the page and try again. / This page could not reach the game rooms. Check your connection and try again. | Phone join page /game-phone/ (public link) | PLAIN |
| game-phone-live.js:93 | No room with that code answered. Check the letters on the host’s screen. | Phone join page /game-phone/ (public link) | PLAIN |
| game-phone-live.js:95 | The host did not let you in. | Phone join page /game-phone/ (public link) | PLAIN |
| game-phone-live.js:98 | You joined room [code] as [name]. | Phone join page /game-phone/ (public link) | PLAIN |
| game-phone-live.js:103 | Join a game | Phone join page /game-phone/ (public link), heading | PLAIN |
| game-phone-live.js:104 | You were in room [code] as [name]. Press Join the room to go back in with your score. | Phone join page /game-phone/ (public link) | PLAIN |
| game-phone-live.js:104 | The host starts a game on their screen and shows a room code. | Phone join page /game-phone/ (public link) | PLAIN |
| game-phone-live.js:109-111 | You are in room [code] / Players: [names] / Waiting for the host to start. / You left the room. | Phone join page /game-phone/ (public link) | PLAIN |
| game-phone-live.js:124 | Type the one word that goes in the gap. / Type the words you think come next. [n] word is / words are left. | Phone join page /game-phone/ (public link) | PLAIN |
| game-phone-live.js:136 | Your guess did not reach the host. Send it again. | Phone join page /game-phone/ (public link) | PLAIN |
| game-phone-live.js:137-138 | Sent / Send my guess | Phone join page /game-phone/ (public link), button | PLAIN |
| game-phone-live.js:140-142 | Round [n] of [m]. Fill the gap: one word is missing. / Round [n] of [m]: fill the gap / The line, with one word missing | Phone join page /game-phone/ (public link) | PLAIN |
| game-phone-live.js:149-153 | The answer was: [answer]. You scored [n]. / You: [n] points ([verdict]). / You sent no guess this round. / The host starts the next round. | Phone join page /game-phone/ (public link) | PLAIN |
| game-phone-live.js:162-164 | The game is over. You came [place] with [n] points. | Phone join page /game-phone/ (public link) | PLAIN |
| game-phone-live.js:170 | Sent: “[guess]”. You can change it until time is up. | Phone join page /game-phone/ (public link) | PLAIN |
| game-phone-live.js:175-176 | The host’s screen stopped answering. / If the host opened a new room, join again with the new code on their screen. | Phone join page /game-phone/ (public link) | PLAIN |
| game-phone-live.js:177 | Join a room | Phone join page /game-phone/ (public link), button | PLAIN |
| game-phone-live.js:188 | DRAFT. Text only: no microphone and no camera. Your name and guesses go to the host’s screen in this room and are not kept. | Phone join page /game-phone/ (public link), banner at the top | CLAIM |
| game-phone-live.js:189 | Guess the next line | Phone join page /game-phone/ (public link), heading | PLAIN |
| game-phone.js:139 | Guess the next line, phone / Ryagram  (and  Guess the next line, phone (draft) / L'Ai) | Phone join page /game-phone/ (public link), browser tab title | PLAIN |
| game-phone.js:141 | The sample room could not be made, so nothing is shown. | Phone join page /game-phone/ (public link) | PLAIN |
| game-room.js:117-185 | This room connection is closed. / That message is not one the game sends, so it was not sent. / The message did not reach the room. Check the connection and try again. / The room took too long to answer. Check the connection and try again. / Could not reach the room. Check the connection and try again. | Game pages, shown if a room connection fails (the other game-room.js messages, e.g. 'onMessage needs a function.', 'The test relay ...', are developer errors) | PLAIN |
| game-gap-rounds.js:4 | We ____ a tiny orchestra living inside the old piano. (first of the made-up sample sentences; the file lists more such sentences, e.g. about a dictionary learning to sing and seventeen sleepy seagulls) | Sample game rounds | PLAIN |

### Removed by games-polish3

| file:line | the words that go | where | flag |
|---|---|---|---|
| app-games.js:177-178 (polish2) | “This page could not open a game room. Reload and try again.” / “This page could not open a game room. Check your connection and reload.” | Games room host screen, failed room | REMOVED |

## web-depbar3-1127 (department pages, signed-out walk)

Head f574362c (10:07; depbar-walk was 3636893d). Merges web-games-polish3-1127 and web-signedout-walk-1127; the signed-out walk adds no words (CSS 44 px footer links, a test switch and tests). web-backlink-1127 is not on origin, so nothing from it is listed. The games rows are listed once, under web-games-polish3-1127. This branch is the Games branch plus a department-pages change; relative to web-games-polish2-1127 it adds one visible sentence (the other department-page words are the Games and Perfect City rows).

| file:line | exact words | where a person sees it | flag |
|---|---|---|---|
| app-departments.js:285 | ← All projects | Back link above the Coming soon badge on every Coming soon department page | PLAIN |

## GEO's branch (FYI): geo-perfect-city-1127

Head 0576502f (10:10). The earlier list used web-perfectcity-polish2-1127 (f3c6ad6e); this section replaces it. This is not a WEB branch: the words below are the ones GEO's page adds against live main f6312e3c, listed so Ryan knows what is there. The page ends with its own notice, ‘Draft wording, not yet approved.’ It shows only to an account with the 'perfectCity' switch on; everyone else keeps the Coming soon card. Flags are mine. “changed since 09:50” means the row differs from what the earlier list showed at polish2. Line numbers are lines of assets/app-perfect-city.js at 0576502f unless another file is named. Numbers in [brackets] are filled in by the page.

| file:line | exact words | where a person sees it | flag |
|---|---|---|---|
| app-departments.js:12 | Put a spot on a county map and see how far the nearest similar places are and about how many people live around it. | Perfect City card sentence on the home and department pages (for the switch-on account) | CLAIM |
| app-departments.js:12 | Ask about places with free public data: who lives near a spot and what is close by, in two Ohio counties for now. Every number says whether it was counted, calculated or estimated. | Perfect City line on the Coming soon page. The front-door card keeps main's longer sentence (‘...and how counties have changed...’) | CLAIM; changed since 09:50 |
| :11-12 | Montgomery County, Ohio (Dayton) / Greene County, Ohio (Beavercreek, Xenia) | County choice | PLAIN |
| :14 | Fast food / Restaurants / Chicken places / Burger places / Pizza places / Supermarkets | Business kinds | PLAIN |
| :15 | fast food place / restaurant / chicken place / burger place / pizza place / supermarket | Said when exactly one is counted (‘1 restaurant’, never ‘1 restaurants’) | PLAIN; changed since 09:50 |
| :17 | limited-service restaurants (fast food) / full-service restaurants / supermarkets and grocery stores | Words in the Census count line (no industry code on the page now) | PLAIN; changed since 09:50 |
| :18 | People per square kilometre / Median household income | Shade-by choices | PLAIN |
| :23 | Pick a county and a kind of business, then tap or click the map, or type a latitude and longitude, to put a spot on it. Ryagram shows how far the nearest similar places are, how many are within 1, 2 and 5 km, and about how many people live around the spot. | Intro | PLAIN |
| :24 | Distances are straight lines, not drive or walk times. | ‘What this does not know’ list | CLAIM |
| :25 | The business points come from OpenStreetMap, made by volunteers: a place can be missing, closed or out of date. | same list | CLAIM |
| :26 | People within a ring are an estimate: each block group's people are shared by the part of its area inside the ring, as if they were spread evenly. | same list | CLAIM |
| :27 | Median income is a survey estimate with a margin of error, for the whole block group. | same list | CLAIM |
| :28 | There is no success score and no prediction. This shows what is there, not whether a business would do well. | same list | CLAIM |
| :29 | The map shows the places near your spot only: within 5 km, and the nearest five, at most the nearest 60. | same list | CLAIM; changed since 09:50 (adds ‘at most the nearest 60’) |
| :30 | One county at a time: places and people across the county line are not counted, even inside a ring. | same list | CLAIM |
| :31 | The business points are not loaded yet, so the map shows people and income only. | Status | PLAIN |
| :32 | The business points could not be loaded. The map shows people and income only. Try again in a few minutes. | Status | PLAIN |
| :33 | Type a latitude (from -90 to 90) and a longitude (from -180 to 180) as numbers, with a point before the decimals (a comma is not accepted), for example 39.7589 and -84.1916. | Error for a typed spot | PLAIN; changed since 09:50 |
| :34 | Try again | Button shown when the business points failed to load | PLAIN; changed since 09:50 (new) |
| :35 | Looking up the places near this spot... | Status while the points load | PLAIN; changed since 09:50 (new) |
| :36 | There are more places near this spot than one answer carries (the nearest 60), so counts that reach past the 60th place say at least. | Note under the results | CLAIM; changed since 09:50 (new) |
| :37 | The map shows only the nearest 60 places. The counts within 1, 2 and 5 km are of every place loaded. | Note under the results | CLAIM; changed since 09:50 (new) |
| :38 | Tap or click the map, or type a latitude and longitude, to put a spot on it. | Instruction | PLAIN; changed since 09:50 (before: ‘Click the map...’) |
| :39 | That spot is outside the county. Put it inside the shaded area. | Error | PLAIN |
| :40-41 | Compare with a second spot / Remove the second spot | Buttons | PLAIN |
| :42 | Tap or click the map, or type a latitude and longitude, to put spot B. | Instruction | PLAIN; changed since 09:50 (before: ‘Click the map...’) |
| :43 | Spot A: white circle, yellow dashed rings. Spot B: cyan square, cyan dotted rings. | Key | PLAIN |
| :44 | Each spot is looked up on its own. This shows what is around each spot side by side; it does not say which spot is better. | Note | CLAIM |
| :45 | The Census does not count chicken, burger or pizza places separately. | Note | CLAIM |
| :103-106 | Or type a spot: / Latitude / Longitude / Put the spot here | Labels and button | PLAIN |
| :111 | [kind]: no places of this kind are loaded for [county] yet, so the page shows [other kind] instead. | Notice | PLAIN |
| :113 | Business | Label | PLAIN |
| :182 | Map of [county]: block groups shaded by [shade], a spot at [lat, lon] with rings at 1, 2 and 5 km, and [n] [kind] near it marked (spot A and spot B versions too) | Screen-reader description of the map | PLAIN |
| :220 | under [n] / [n] or more / [n] to [m] | Legend labels | PLAIN |
| :222 | Grey: no published figure. Rings: 1, 2 and 5 km around each spot (A: white circle, yellow dashes; B: cyan square, cyan dotted rings). / Dashed yellow rings: 1, 2 and 5 km around the spot (white dot). / Orange dots: [kind] within 5 km of the spot, and the nearest five. | Legend | PLAIN |
| :238 | The Census Bureau's count of [limited-service restaurants (fast food) / full-service restaurants / supermarkets and grocery stores] in this county (County Business Patterns [year], observed): [n, or ‘fewer than 3 or none (not published)’]. The map data has [n] of this kind loaded. / The map data count is not known | Count line beside the map | CLAIM; changed since 09:50 (before: ‘Census County Business Patterns [year] counts [n] [kind] establishments...’) |
| :259-267 | Spot (latitude, longitude) / Census block group / People in the spot's block group: observed, 2020 Census / People per square kilometre in the block group: calculated / Median household income in the block group: estimated, American Community Survey [years] (plus or minus $[n], the survey's 90% margin of error) / Nearest [kind]: observed, from OpenStreetMap; distance calculated, straight line / [kind] within [r] km: calculated / People within [r] km: estimated | Two-spot table rows | CLAIM; changed since 09:50 (survey years now come from the data file; ‘observed, from OpenStreetMap’ is new) |
| :268-275 | Two spots side by side / Figure / Spot A / Spot B / People within a ring: [method], rounded to the nearest 100. | Table headings and note | PLAIN |
| perfect-city-core.js:48, 56 | block groups whose centre is inside the ring, counted in full / each block group's people shared by the part of its area inside the ring, assuming people are spread evenly inside it | Method note (the second is the one shown) | CLAIM |
| :339-363 | Around this spot / Spot: [lat, lon] (latitude, longitude) / The block group the spot is in / People: [n or not published] observed, 2020 Census / People per square kilometre: [n or not available] calculated / Median household income: [$] ... estimated, American Community Survey [years] / Census block group [id] / Nearest [kind] observed, from OpenStreetMap / Within 1, 2 and 5 km / Ring / [kind] (calculated) / People (estimated) | Result block | CLAIM; changed since 09:50 (survey years; ‘observed, from OpenStreetMap’) |
| :373-377 | Sources: U.S. Census Bureau block group boundaries (2020 geography); U.S. Census Bureau, 2020 Census population counts (observed); U.S. Census Bureau, American Community Survey [years] median household income (estimated); U.S. Census Bureau, County Business Patterns [year] business counts (observed). Area and people per square kilometre are calculated here from the boundaries; the shapes are simplified for the page. [the server's OpenStreetMap credit] (openstreetmap.org/copyright). This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau. | Sources line | CLAIM; changed since 09:50 (plain words in place of table and file codes) |
| :411-417 | Comparing two spots. / Spot A: not placed yet. / outside the county. / placed, people and income only. / [n, or ‘at least [n]’] [kind] within 5 km, the nearest [n] km away. / The table below shows them side by side. / Spot placed. People and income are below. / Spot placed: [n] [kind] within 5 km, the nearest [n] km away. Details are below. | Status lines | PLAIN; changed since 09:50 (‘at least’ and the singular kind words) |
| :445-447 | The map data for [county] could not be loaded. Still showing [county]. Try again later. / The map data could not be loaded. Try again later. | Status | PLAIN |
| :460 | County / Shade by / Spot / Spot A / Spot B; County changed to [county]: put a spot on the map. | Control labels and status | PLAIN |
| :466-467 | Perfect City / What this does not know / Draft wording, not yet approved. | Heading, section heading, draft notice at the foot | CLAIM |
| perfect-city/greene_oh.census.js:2; montgomery_oh.census.js:2 | Data file source lines (‘U.S. Census Bureau, cartographic boundary file cb_2023_39_bg_500k (block groups, 2020 geography)’, ‘...2020 Census, table P1 (total population): OBSERVED’, ‘...American Community Survey 5-year, table B19013 (median household income, with margin of error): ESTIMATE’, ‘Public domain (U.S. government work).’) and a new field income_years ‘2019 to 2023’ | No longer printed as they are: the page builds its own plain-words source line (the Sources row above) and reads only the survey years from these files | PLAIN; changed since 09:50 |
| app-data.js (perfectCityPlaces) | Couldn’t load the business points. | Error | PLAIN |

### Removed from the Perfect City words since the earlier list

| the words that go | flag |
|---|---|
| “Type a latitude and a longitude as numbers, for example 39.7589 and -84.1916.” | REMOVED |
| “Click the map, or type a latitude and longitude, to put a spot on it.” / “...to put spot B.” | REMOVED |
| “Census County Business Patterns [year] counts [n] [kind] establishments in this county (observed); [m].” and the industry code (NAICS) text | REMOVED |
| “Sources: [boundaries]; [population]; [income]; ...” built from the data file's table and file codes | REMOVED |

## web-push4b-1127 (test credits screen)

Everything here is on an owner screen only. Listed because it is new words in the app, not because a visitor sees it.

| file:line | exact words | where a person sees it | flag |
|---|---|---|---|
| app-data.js:634 | Couldn’t give the test credits. | Owner/operator screens only (not shown to ordinary visitors) | PLAIN |
| app-data.js:635 | Couldn’t undo that top-up. | Owner/operator screens only (not shown to ordinary visitors) | PLAIN |
| app-data.js:636 | Couldn’t load the test top-ups. | Owner/operator screens only (not shown to ordinary visitors) | PLAIN |
| app-device.js:385 | Undo top-up [n] for [who] / Undo | Owner/operator screens only (not shown to ordinary visitors) | PLAIN |
| app-device.js:389-390 | Undone from the Test credits list / Top-up [n] undone: [back] credits taken back from [who]. / Top-up [n] marked undone. All of it was already spent, so nothing was taken back. | Owner/operator screens only (not shown to ordinary visitors) | PLAIN |
| app-device.js:397 | For:  | Owner/operator screens only (not shown to ordinary visitors) | PLAIN |
| app-device.js:398 | No test credits given yet. Nothing can be given until the account is on the owner list (live step 78c in the database). | Owner/operator screens only (not shown to ordinary visitors) | PLAIN |
| app-device.js:400 | Give test credits | Owner/operator screens only (not shown to ordinary visitors) | PLAIN |
| app-device.js:404-405 | Type the test account’s email. / A test top-up is 1 to 100 credits. / Say what the credits are for, in a few words. | Owner/operator screens only (not shown to ordinary visitors) | PLAIN |
| app-device.js:407-409 | Yes, give them / No, go back / Give [n] test credits to [email]? Credits that get spent cannot be taken back by an undo. | Owner/operator screens only (not shown to ordinary visitors) | PLAIN |
| app-device.js:417 | [n] test credits given to [email] (top-up [id]). It is in the list below, with an Undo. | Owner/operator screens only (not shown to ordinary visitors) | PLAIN |
| app-device.js:424-430 | Test credits / Give test credits to one of your own test accounts. Only accounts on the owner list can get them (you add an account in the database with live step 78c); any other address gets nothing. Every top-up is written down and can be undone: an undo takes back only what is not spent yet. / Test account email / Credits / 1 to 100 at a time, at most 200 a day for one account. / What they are for (a few words, saved with the top-up) / 3 to 200 characters. | Owner/operator screens only (not shown to ordinary visitors) | PLAIN |
| app-device.js:432,441 | Last top-ups / History | Owner/operator screens only (not shown to ordinary visitors) | PLAIN |

## web-delivery-wide-1127

No new words. Its diff only changes layout (a CSS class on the delivered-film video, stamps) and focus handling; the two lines that mention 'Yes, render it', 'Waiting for approval' and 'All my films' are code comments, not text a person sees.

