# Words for a yes: every new public sentence the WEB branches add (2026-11-27)

Compared against live main f6312e3c. Read-only extraction from the branch diffs of assets/, app/ and the .html pages. Nothing was edited or run. One row per sentence; where one sentence is in several branches it is listed once, under the first branch in this order: wave8, credits-help, push5c, comp-mirror (with compstates), editor-poll2, games-polish2, depbar-walk, perfectcity-polish2, push4b, delivery-wide.

Flag: CLAIM = privacy, price, 'free', speed, legality, safety, 'never leaves', data-accuracy or a promise of a later feature. PLAIN = a label, an instruction or a status line. Judgement calls are mine; Ryan can move any row between the two.

What was not listed, and why:
- CSS, script paths and ?v= stamps, comments, CSP meta tags (not words a person reads).
- _archive/consulting/*: the old consulting copy moved there; GitHub Pages does not publish folders starting with an underscore, so it is not public.
- web-games-polish3-1127 does not exist on origin; web-games-polish2-1127 is used. web-wave8-1127 and web-credits-help-1127 are parents of the later branches, so their rows are in every stacked branch.
- web-home-ryagram-1127 adds no words beyond the front-door rows under wave8.
- Chat-editor generated strings: none appear in the assets/app/html diffs.
- Line numbers are lines of the file at that branch's head, not of the diff. Template text with [brackets] is filled in by the page.

## Needs Ryan's eye first

CLAIM rows only, in branch order (54 rows).


**web-wave8-1127**

- index.html:14: “Ryagram turns public data into short animated films and checks each one against its data. Create a free account to try it.”  (Search-result description (meta) of the front door)
- index.html:31: “Ryagram turns public data into short animated films, and checks each one against its data before you get it.”  (Front door, under the heading)
- index.html:37: “Start free, 16 credits  (16 is filled in from the site setting)”  (Front door, main button)
- index.html:45: “Open now / Data films / Questions answered with public data, drawn as a short animated film, with every source shown.”  (Front door, first project card)
- index.html:46: “Coming soon / Compilations / Say a phrase. Ryagram finds every time it is said in your own footage and strings the moments together. Soon it will turn your clips into songs, too.”  (Front door, project card (promise of a later feature))
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

**web-push5c-1127 (on top of web-push4b-1127)**

- assets/app-library.js:297; help/index.html:31 (same answer): “Films are made one at a time, oldest first. Yours starts when the ones ahead of it finish. A contact sheet or preview usually takes about 5 minutes and a full film up to about half an hour, so a long line can mean hours, or a day or more when many people join at once, such as a launch day. A full film is checked by a person before it starts, and it joins the end of the line when it is approved. The Render panel shows your place in line. You can have 2 films waiting at once. We do not send an email when a film is ready, so come back to this page to check.”  (In-app Help and /help/ (public).)
- assets/app-jobs.js:175: “(one-at-a-time sentence) (full-film sentence), and a sheet or preview ahead of yours takes a few minutes, so it may be hours with this many ahead.”  (Render panel, queue line (signed in); the two shared sentences are built from named parts defined elsewhere in the file)
- assets/app-jobs.js:176: “(one-at-a-time sentence) (full-film sentence), so yours may start after a few films, not a few minutes.”  (Render panel, queue line)
- assets/app-jobs.js:178: “(one-at-a-time sentence) Yours starts in about [hours], maybe more if full films are ahead of yours.”  (Render panel, queue line)
- assets/app-jobs.js:179: “(one-at-a-time sentence) It may be working on another film right now. Yours starts in about [time] and takes about 5 more. A full film ahead of yours can take up to half an hour, so it may take longer.”  (Render panel, queue line)

**web-comp-mirror-1127 (includes web-compstates-1127)**

- app-compilations.js:57: “[state words] [counts], counted on your computer.”  (Your requests tab, counts line)
- app-compilations.js:62: “Your videos never leave your computer. This page saves only your request: the words, the names of your folders, your note and the name of your compilation. The Ryagram app on your computer finds the matches and makes the film there.”  (Compilations page, privacy note)
- app-compilations.js:66 build_failed: “The film could not be built. Nothing left your computer. Try again in the Ryagram app.”  (same)
- app-compilations.js:66 crash: “Something went wrong on your computer. Nothing left it. Close the app, open it and try again.”  (same)
- app-compilations.js:91: “Added one folder. Only its name is used; nothing was read or sent.”  (Start tab, after picking a folder)
- app-compilations.js:127: “Your browser lists the folder’s files to this page only to read the folder’s name, and may use the word upload for it. Nothing is uploaded: nothing leaves your computer.”  (Start tab, hint under the folder picker)

**web-editor-poll2-1127**

- app-editor.js:568: “Only the page colour changes. Your data does not. Undo takes it back.”  (Editor, note under the background buttons)
- app-compilations.js:43/55/60/64 (older draft): “Your videos never leave your computer. This page saves only your request: the words, and the names of your folders. The Ryagram app on your computer finds the matches and makes the film there.”  (Compilations page in the app (signed in, 'compilations' switch on): privacy note (older wording))
- app-compilations.js:64 (older draft): “Your AI’s request could not be read. / Songs are made in the song tools, not here. / Choose where these videos are on your computer. / A folder you chose is not there any more. / A folder you chose has no videos. / Two folders hold the same videos. / No speech was found in your videos. / Your videos do not say it. / The draft could not be made into a film list. / The film could not be built. Nothing left your computer. / Something went wrong on your computer.”  (Compilations page in the app (signed in, 'compilations' switch on): run failure reasons (older wording; the 'Nothing left your computer' sentences are the claims))
- app-compilations.js:89 (older draft): “Added the folder name “[name]” ([n] file(s) in it). Only its name is used; nothing was read or sent.”  (Compilations page in the app (signed in, 'compilations' switch on): after picking a folder)

**web-games-polish2-1127**

- app-games.js:186: “Five sample rounds made from a made-up script. Names and guesses pass between this screen and the phones and are not kept.”  (Games room host screen in the app (signed in, 'games' switch on), note)
- game-phone-live.js:188: “DRAFT. Text only: no microphone and no camera. Your name and guesses go to the host’s screen in this room and are not kept.”  (Phone join page /game-phone/ (public link), banner at the top)

**web-perfectcity-polish2-1127**

- app-departments.js:12: “Put a spot on a county map and see how far the nearest similar places are and about how many people live around it.”  (Perfect City card sentence on the home and department pages)
- app-departments.js:12: “Ask about places with free public data: who lives near a spot, what is close by, and how counties have changed. Every number says whether it was counted, calculated or estimated.”  (Coming soon page line for Perfect City, and the front door card)
- app-perfect-city.js:22: “Distances are straight lines, not drive or walk times.”  (Perfect City page in the app (signed in, 'perfectCity' switch on), note on what it knows)
- app-perfect-city.js:23: “The business points come from OpenStreetMap, made by volunteers: a place can be missing, closed or out of date.”  (Perfect City page in the app (signed in, 'perfectCity' switch on), note)
- app-perfect-city.js:24: “People within a ring are an estimate: each block group's people are shared by the part of its area inside the ring, as if they were spread evenly.”  (Perfect City page in the app (signed in, 'perfectCity' switch on), note)
- app-perfect-city.js:25: “Median income is a survey estimate with a margin of error, for the whole block group.”  (Perfect City page in the app (signed in, 'perfectCity' switch on), note)
- app-perfect-city.js:26: “There is no success score and no prediction. This shows what is there, not whether a business would do well.”  (Perfect City page in the app (signed in, 'perfectCity' switch on), note)
- app-perfect-city.js:28: “One county at a time: places and people across the county line are not counted, even inside a ring.”  (Perfect City page in the app (signed in, 'perfectCity' switch on), note)
- app-perfect-city.js:38: “Each spot is looked up on its own. This shows what is around each spot side by side; it does not say which spot is better.”  (Perfect City page in the app (signed in, 'perfectCity' switch on), note)
- app-perfect-city.js:39: “The Census does not count chicken, burger or pizza places separately.”  (Perfect City page in the app (signed in, 'perfectCity' switch on), note)
- app-perfect-city.js:307: “This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau.”  (Perfect City page in the app (signed in, 'perfectCity' switch on), sources line)
- app-perfect-city.js:375-377: “Perfect City / What this does not know / Draft wording, not yet approved.”  (Perfect City page in the app (signed in, 'perfectCity' switch on), heading, section heading, and a draft notice at the foot)
- perfect-city-core.js:56: “each block group's people are shared by the part of its area inside the ring, assuming people are spread evenly inside it”  (Perfect City page in the app (signed in, 'perfectCity' switch on), method note)
- perfect-city/greene_oh.census.js:2; montgomery_oh.census.js:2: “Source lines: U.S. Census Bureau, cartographic boundary file cb_2023_39_bg_500k (block groups, 2020 geography) / U.S. Census Bureau, 2020 Census, table P1 (total population): OBSERVED / U.S. Census Bureau, American Community Survey 5-year, table B19013 (median household income, with margin of error): ESTIMATE / Area and people per square kilometre are CALCULATED here from the boundary file; shapes are simplified for the page. / Public domain ...  (the rest of the line is cut off in this review; read the file)”  (Perfect City page in the app (signed in, 'perfectCity' switch on), sources line)


## web-wave8-1127 (front door, library words, state-industry chart captions)

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
| index.html:46 | Coming soon / Compilations / Say a phrase. Ryagram finds every time it is said in your own footage and strings the moments together. Soon it will turn your clips into songs, too. | Front door, project card (promise of a later feature) | CLAIM |
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

## web-comp-mirror-1127 (Compilations page and FACES' error words; web-compstates-1127 is its parent, so its rows are here too)

The comp-mirror head adds no new words over compstates (its change is folder-name checking code only). The page shows only to an account with the 'compilations' switch on; the front-door card for it says Coming soon. Line numbers are in assets/app-compilations.js at the comp-mirror head. web-editor-poll2-1127 carries an older draft of some of these sentences (listed under the editor branch).

| file:line | exact words | where a person sees it | flag |
|---|---|---|---|
| app-compilations.js:27 | Type the words to look for. | Compilations page in the app (signed in, 'compilations' switch on): form error | PLAIN |
| app-compilations.js:28 | The words to look for can be at most 200 characters. | form error | PLAIN |
| app-compilations.js:30 | The note can be at most 500 characters. | form error | PLAIN |
| app-compilations.js:31 | Write words, not a place on your computer. Folders are named, never located. | form error | PLAIN |
| app-compilations.js:33 | Name at least one folder of yours that holds the videos. | form error | PLAIN |
| app-compilations.js:34 | Name at most 10 folders. | form error | PLAIN |
| app-compilations.js:36 | That is not a folder name. Type only the folder’s name, like Interviews, never where it is. | form error | PLAIN |
| app-compilations.js:45 | “[the words]”: [every time it is said / these words in this order], in [n] folder(s)[, as a song]. Saved [date] | Your requests tab, line under each request | PLAIN |
| app-compilations.js:52 | [state words] Something went wrong. Try again from the app. | Your requests tab, fallback when the app gives an unknown reason | PLAIN |
| app-compilations.js:54-56 | [n] match(es) / [n] clip(s) / [n] seconds long | Your requests tab, counts | PLAIN |
| app-compilations.js:57 | [state words] [counts], counted on your computer. | Your requests tab, counts line | CLAIM |
| app-compilations.js:61 | Say a phrase. Ryagram finds every time it is said in your own footage and strings the moments together. | Compilations page, intro | PLAIN |
| app-compilations.js:62 | Your videos never leave your computer. This page saves only your request: the words, the names of your folders, your note and the name of your compilation. The Ryagram app on your computer finds the matches and makes the film there. | Compilations page, privacy note | CLAIM |
| app-compilations.js:63 | Waiting for the Ryagram app on your computer. | Your requests tab, state | PLAIN |
| app-compilations.js:64 | The Ryagram app is planning your film. / The Ryagram app is finding the matches on your computer. / The Ryagram app is making your film on your computer. / Done. Your film is on your computer. / It did not finish. / Stopped. | Your requests tab, run states | PLAIN |
| app-compilations.js:66 request_invalid | The request could not be read. Save it again, or ask your AI to write it again. | Your requests tab, reason shown when a run fails | PLAIN |
| app-compilations.js:66 song_request | Compilations do not make songs. Take out the song and save again. | same | PLAIN |
| app-compilations.js:66 folder_not_chosen | A folder in your request is not chosen on your computer yet. Open the Ryagram app and choose where that folder is. | same | PLAIN |
| app-compilations.js:66 folder_missing | A folder you chose is not there any more. Open the Ryagram app and choose it again. | same | PLAIN |
| app-compilations.js:66 folder_empty | A folder you chose has no videos in it. Choose the folder that holds your videos. | same | PLAIN |
| app-compilations.js:66 folders_overlap | Two of your folders hold the same videos. Choose folders that do not overlap. | same | PLAIN |
| app-compilations.js:66 no_speech | No speech was found in your videos. Try videos where people talk. | same | PLAIN |
| app-compilations.js:66 not_said | Your videos do not say these words. Try other words, or add more folders. | same | PLAIN |
| app-compilations.js:66 edit_failed | The matches could not be turned into a film. Try again; if it happens twice, tell us. | same | PLAIN |
| app-compilations.js:66 build_failed | The film could not be built. Nothing left your computer. Try again in the Ryagram app. | same | CLAIM |
| app-compilations.js:66 stale | That request was replaced by a newer one. | same | PLAIN |
| app-compilations.js:66 crash | Something went wrong on your computer. Nothing left it. Close the app, open it and try again. | same | CLAIM |
| app-compilations.js:67 | The Ryagram app is not on a computer of yours yet. You can save a request now; the app reads it when you open it. | Your requests tab | PLAIN |
| app-compilations.js:80 | Every time it is said / These words in this order, one place each | Choice list 'How to find them' | PLAIN |
| app-compilations.js:91 | Added one folder. Only its name is used; nothing was read or sent. | Start tab, after picking a folder | CLAIM |
| app-compilations.js:95 | Save my request | Start tab, button | PLAIN |
| app-compilations.js:100 | Saving… | Start tab, button while saving | PLAIN |
| app-compilations.js:120 | Name your compilation (optional) | Start tab, label | PLAIN |
| app-compilations.js:121 | The words to find | Start tab, label | PLAIN |
| app-compilations.js:122 | Up to 200 characters. | Start tab, hint | PLAIN |
| app-compilations.js:123 | How to find them | Start tab, label | PLAIN |
| app-compilations.js:124 | Your folders (the names, one per line) | Start tab, label | PLAIN |
| app-compilations.js:125 | Type only a folder’s name, like Interviews. Never where it is on your computer. | Start tab, hint | PLAIN |
| app-compilations.js:126 | Or pick a folder to add its name | Start tab, label | PLAIN |
| app-compilations.js:127 | Your browser lists the folder’s files to this page only to read the folder’s name, and may use the word upload for it. Nothing is uploaded: nothing leaves your computer. | Start tab, hint under the folder picker | CLAIM |
| app-compilations.js:128 | A note to yourself (optional) | Start tab, label | PLAIN |
| app-compilations.js:132 | Saved. Open the Ryagram app on your computer to find the matches and make a preview. | After saving (status line) | PLAIN |
| app-compilations.js:137 | Couldn’t load your requests. | Your requests tab, error | PLAIN |
| app-compilations.js:142 | Get the Ryagram app | Your requests tab, link to /get-app/ | PLAIN |
| app-compilations.js:145 | No compilation requests yet. Start one on the first tab. | Your requests tab, empty | PLAIN |
| app-compilations.js:149 | Compilations | Page heading | PLAIN |
| app-compilations.js:150-151 | Start a compilation / Your requests | Tab names | PLAIN |
| app-compilations.js:153 | ← All projects | Back link | PLAIN |
| app-data.js:582 | Couldn’t save the request. | Error line after a failed save | PLAIN |
| app-data.js:584 and 586 | Couldn’t load your requests. | Error line | PLAIN |
| app-data.js:590 | A compilation | Title shown for a request that has no name | PLAIN |
| app-editor.js:381 | Redo / Redone. | See the editor table (these editor words are in compstates too) | PLAIN |
| app-editor.js:386-392 | Keyboard shortcuts / Shortcuts (list: see editor table) | See the editor table | PLAIN |

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

## web-games-polish2-1127 (Games room words; no polish3 branch exists on origin)

web-games-polish3-1127 is not on origin, so polish2 is used. The Games room host screen shows only to an account with the 'games' switch on (the front-door card says Coming soon); the phone page /game-phone/ is reachable by link. The sample-round files (game-rounds.js, game-gap-rounds.js) hold made-up sentences for sample rounds, e.g. 'We ____ a tiny orchestra living inside the old piano.'; they are sample game content, not site copy, and only the first sample line is quoted.

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
| app-games.js:176 | Try again | Games room host screen in the app (signed in, 'games' switch on), button on a failed room | PLAIN |
| app-games.js:177-178 | This page could not open a game room. Reload and try again. / This page could not open a game room. Check your connection and reload. | Games room host screen in the app (signed in, 'games' switch on) | PLAIN |
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

## web-depbar-walk-1127 (department pages)

This branch is the Games branch plus a department-pages change; relative to web-games-polish2-1127 it adds one visible sentence (the other department-page words are the Games and Perfect City rows).

| file:line | exact words | where a person sees it | flag |
|---|---|---|---|
| app-departments.js:285 | ← All projects | Back link above the Coming soon badge on every Coming soon department page | PLAIN |

## web-perfectcity-polish2-1127 (Perfect City)

Shown to an account with the 'perfectCity' switch on; everyone else keeps the Coming soon card. Numbers in [brackets] are filled in by the page.

| file:line | exact words | where a person sees it | flag |
|---|---|---|---|
| app-departments.js:12 | Put a spot on a county map and see how far the nearest similar places are and about how many people live around it. | Perfect City card sentence on the home and department pages | CLAIM |
| app-departments.js:12 | Ask about places with free public data: who lives near a spot, what is close by, and how counties have changed. Every number says whether it was counted, calculated or estimated. | Coming soon page line for Perfect City, and the front door card | CLAIM |
| app-perfect-city.js:11-12 | Montgomery County, Ohio (Dayton) / Greene County, Ohio (Beavercreek, Xenia) | Perfect City page in the app (signed in, 'perfectCity' switch on), county choice | PLAIN |
| app-perfect-city.js:14 | Fast food / Restaurants / Chicken places / Burger places / Pizza places / Supermarkets | Perfect City page in the app (signed in, 'perfectCity' switch on), business kinds | PLAIN |
| app-perfect-city.js:16 | People per square kilometre / Median household income | Perfect City page in the app (signed in, 'perfectCity' switch on), shade-by choices | PLAIN |
| app-perfect-city.js:21 | Pick a county and a kind of business, then tap or click the map, or type a latitude and longitude, to put a spot on it. Ryagram shows how far the nearest similar places are, how many are within 1, 2 and 5 km, and about how many people live around the spot. | Perfect City page in the app (signed in, 'perfectCity' switch on), intro | PLAIN |
| app-perfect-city.js:22 | Distances are straight lines, not drive or walk times. | Perfect City page in the app (signed in, 'perfectCity' switch on), note on what it knows | CLAIM |
| app-perfect-city.js:23 | The business points come from OpenStreetMap, made by volunteers: a place can be missing, closed or out of date. | Perfect City page in the app (signed in, 'perfectCity' switch on), note | CLAIM |
| app-perfect-city.js:24 | People within a ring are an estimate: each block group's people are shared by the part of its area inside the ring, as if they were spread evenly. | Perfect City page in the app (signed in, 'perfectCity' switch on), note | CLAIM |
| app-perfect-city.js:25 | Median income is a survey estimate with a margin of error, for the whole block group. | Perfect City page in the app (signed in, 'perfectCity' switch on), note | CLAIM |
| app-perfect-city.js:26 | There is no success score and no prediction. This shows what is there, not whether a business would do well. | Perfect City page in the app (signed in, 'perfectCity' switch on), note | CLAIM |
| app-perfect-city.js:27 | The map shows the places near your spot only: within 5 km, and the nearest five. | Perfect City page in the app (signed in, 'perfectCity' switch on), note | PLAIN |
| app-perfect-city.js:28 | One county at a time: places and people across the county line are not counted, even inside a ring. | Perfect City page in the app (signed in, 'perfectCity' switch on), note | CLAIM |
| app-perfect-city.js:29 | The business points are not loaded yet, so the map shows people and income only. | Perfect City page in the app (signed in, 'perfectCity' switch on), status | PLAIN |
| app-perfect-city.js:30 | The business points could not be loaded. The map shows people and income only. Try again in a few minutes. | Perfect City page in the app (signed in, 'perfectCity' switch on), status | PLAIN |
| app-perfect-city.js:31 | Type a latitude and a longitude as numbers, for example 39.7589 and -84.1916. | Perfect City page in the app (signed in, 'perfectCity' switch on), error | PLAIN |
| app-perfect-city.js:32 | Click the map, or type a latitude and longitude, to put a spot on it. | Perfect City page in the app (signed in, 'perfectCity' switch on), instruction | PLAIN |
| app-perfect-city.js:33 | That spot is outside the county. Put it inside the shaded area. | Perfect City page in the app (signed in, 'perfectCity' switch on), error | PLAIN |
| app-perfect-city.js:34-35 | Compare with a second spot / Remove the second spot | Perfect City page in the app (signed in, 'perfectCity' switch on), buttons | PLAIN |
| app-perfect-city.js:36 | Click the map, or type a latitude and longitude, to put spot B. | Perfect City page in the app (signed in, 'perfectCity' switch on), instruction | PLAIN |
| app-perfect-city.js:37 | Spot A: white circle, yellow dashed rings. Spot B: cyan square, cyan dotted rings. | Perfect City page in the app (signed in, 'perfectCity' switch on), key | PLAIN |
| app-perfect-city.js:38 | Each spot is looked up on its own. This shows what is around each spot side by side; it does not say which spot is better. | Perfect City page in the app (signed in, 'perfectCity' switch on), note | CLAIM |
| app-perfect-city.js:39 | The Census does not count chicken, burger or pizza places separately. | Perfect City page in the app (signed in, 'perfectCity' switch on), note | CLAIM |
| app-perfect-city.js:88-91 | Or type a spot: / Latitude / Longitude / Put the spot here | Perfect City page in the app (signed in, 'perfectCity' switch on), labels and button | PLAIN |
| app-perfect-city.js:96 | There is no [kind] data for [county] yet, so the page shows [other kind]. | Perfect City page in the app (signed in, 'perfectCity' switch on), notice | PLAIN |
| app-perfect-city.js:98 | Business | Perfect City page in the app (signed in, 'perfectCity' switch on), label | PLAIN |
| app-perfect-city.js:151-152 | Map of [county]: block groups shaded by [shade], a spot at [lat, lon] with rings at 1, 2 and 5 km ... (spoken description of the map; spot A and spot B version too) | Perfect City page in the app (signed in, 'perfectCity' switch on), screen-reader description of the map | PLAIN |
| app-perfect-city.js:188 | under [n] / [n] or more / [n] to [m] | Perfect City page in the app (signed in, 'perfectCity' switch on), legend labels | PLAIN |
| app-perfect-city.js:190 | Grey: no published figure. Rings: 1, 2 and 5 km around each spot (A: white circle, yellow dashes; B: cyan square, cyan dotted rings). / Dashed yellow rings: 1, 2 and 5 km around the spot (white dot). / within 5 km of either spot, and the nearest five to each. / within 5 km of the spot, and the nearest five. | Perfect City page in the app (signed in, 'perfectCity' switch on), legend | PLAIN |
| app-perfect-city.js:204-207 | [kind] (NAICS [code]) / restaurant (fast food, NAICS 722513) / the map data has [n] of this kind loaded / Census County Business Patterns [year] counts [n] [kind] establishments in this county (observed); [m]. | Perfect City page in the app (signed in, 'perfectCity' switch on), table notes | PLAIN |
| app-perfect-city.js:228-235 | Spot (latitude, longitude) / People in the spot's block group: observed, 2020 Census / estimated, American Community Survey 2019 to 2023 (plus or minus $[n], the survey's 90% margin of error) / Nearest [kind]: calculated, straight line, [n] km ([name] or "no name in the map data") / [kind] within [r] km / People within [r] km / Census block group / People per square kilometre in the block group | Perfect City page in the app (signed in, 'perfectCity' switch on), result table rows, each with observed / calculated / estimated labels | PLAIN |
| app-perfect-city.js:237-239 | Two spots side by side / Figure / Spot A / Spot B | Perfect City page in the app (signed in, 'perfectCity' switch on), table headings | PLAIN |
| app-perfect-city.js:242 and 297 | rounded to the nearest 100. | Perfect City page in the app (signed in, 'perfectCity' switch on), note | PLAIN |
| app-perfect-city.js:274-276 | Around this spot / The block group the spot is in | Perfect City page in the app (signed in, 'perfectCity' switch on), headings | PLAIN |
| app-perfect-city.js:275-293 | Spot: [lat, lon] (latitude, longitude) / People: [n] or not published, observed, 2020 Census / People per square kilometre: [n] or not available / Median household income: [$] or not published for this block group, estimated, American Community Survey 2019 to 2023 / Census block group [id] / Nearest [kind] ... calculated, straight line / Within 1, 2 and 5 km / Ring / People (estimated) / [kind] (calculated) | Perfect City page in the app (signed in, 'perfectCity' switch on), result block | PLAIN |
| app-perfect-city.js:305 | Sources: [boundaries]; [population]; [income]; [places source]. [calculated note] [credit] | Perfect City page in the app (signed in, 'perfectCity' switch on), sources line | PLAIN |
| app-perfect-city.js:307 | This product uses the Census Bureau Data API but is not endorsed or certified by the Census Bureau. | Perfect City page in the app (signed in, 'perfectCity' switch on), sources line | CLAIM |
| app-perfect-city.js:328-343 | [Spot A / Spot B]: not placed yet. / outside the county. / placed, people and income only. / [n] [kind] within 5 km ... / Comparing two spots. ... The table below shows them side by side. / Spot placed. People and income are below. / Spot placed: [n] [kind] within 5 km | Perfect City page in the app (signed in, 'perfectCity' switch on), status lines | PLAIN |
| app-perfect-city.js:358-359 | Loading... / The map data could not be loaded. Try again later. | Perfect City page in the app (signed in, 'perfectCity' switch on), status | PLAIN |
| app-perfect-city.js:370 | County / Shade by / Spot / Spot A / Spot B | Perfect City page in the app (signed in, 'perfectCity' switch on), control labels | PLAIN |
| app-perfect-city.js:370 | County changed to [county]: put a spot on the map. | Perfect City page in the app (signed in, 'perfectCity' switch on), status | PLAIN |
| app-perfect-city.js:375-377 | Perfect City / What this does not know / Draft wording, not yet approved. | Perfect City page in the app (signed in, 'perfectCity' switch on), heading, section heading, and a draft notice at the foot | CLAIM |
| perfect-city-core.js:48 | block groups whose centre is inside the ring, counted in full | Perfect City page in the app (signed in, 'perfectCity' switch on), method note | PLAIN |
| perfect-city-core.js:56 | each block group's people are shared by the part of its area inside the ring, assuming people are spread evenly inside it | Perfect City page in the app (signed in, 'perfectCity' switch on), method note | CLAIM |
| perfect-city/greene_oh.census.js:2; montgomery_oh.census.js:2 | Source lines: U.S. Census Bureau, cartographic boundary file cb_2023_39_bg_500k (block groups, 2020 geography) / U.S. Census Bureau, 2020 Census, table P1 (total population): OBSERVED / U.S. Census Bureau, American Community Survey 5-year, table B19013 (median household income, with margin of error): ESTIMATE / Area and people per square kilometre are CALCULATED here from the boundary file; shapes are simplified for the page. / Public domain ...  (the rest of the line is cut off in this review; read the file) | Perfect City page in the app (signed in, 'perfectCity' switch on), sources line | CLAIM |
| app-data.js:612 | Couldn’t load the business points. | Perfect City page in the app (signed in, 'perfectCity' switch on), error | PLAIN |

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

