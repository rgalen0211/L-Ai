# Maker plain words (branch maker-plain-words): WORDING IS RYAN'S

Every visible string this branch changes, old and new side by side. It comes from `proposals/WEB-MAKER-PLAIN-WORDS.md`. Only wording that keeps the same meaning is changed; nothing about what the maker does changes. **This is for Ryan to accept or refuse. It is not in any kit.** To refuse, do not merge it; the kit pins stay on `maker-sam-words`.

The main word swaps (used everywhere): Plan -> **Check my videos**; Build -> **Make my film**; Recipe -> **Film idea**; slot -> **place**; speech model -> **Listening quality**; network -> **internet**; clip -> **piece**; receipt -> **record of the run**; "door checks" -> dropped. Code, element ids, the engine commands and the paste box examples are unchanged.

| # | old | new |
|---|---|---|
| 1 | `Press Plan again. If it happens again` | `Press Check my videos again. If it happens again` |
| 2 | `Refused: the recipe or one of the files is not right, so nothing was run.` | `Stopped: the film idea or one of the files has a problem, so nothing was run.` |
| 3 | `Read the lines below: they name the file or slot. Fix it, then press Plan again.` | `The lines below name the file or place. Fix it, then press Check my videos again.` |
| 4 | `The files you chose do not say every word the recipe needs. Nothing was written.` | `Your videos do not say every word the film idea needs. Nothing was made.` |
| 5 | `Add a file that says the missing words, or pick a recipe whose words your files do say, then press Plan again.` | `Add a video that says the missing words, or pick a film idea that fits your videos, then press Check my videos again.` |
| 6 | `Blocked: the build tried to use the network, which it must not. Nothing was kept.` | `Stopped: the film maker tried to use the internet, which it must not do. Nothing was kept.` |
| 7 | `Anything half-made is in the work folder; no film was kept. Press Plan to start again.` | `Anything half-made is left in the work folder; no film was kept. Press Check my videos to start again.` |
| 8 | `"Ready to build. No film has been written yet.", "Press Build. It reuses the words Plan already heard."` | `"Ready. No film has been made yet.", "Press Make my film. It reuses the words already heard."` |
| 9 | `That recipe is not in the recipes folder.` | `That film idea is not in the film ideas folder.` |
| 10 | `Press Plan first for exactly these files, and wait for it to say it is ready.` | `Press Check my videos first for exactly these videos, and wait until it says ready.` |
| 11 | `Press Plan for exactly these files first.` | `Press Check my videos for exactly these videos first.` |
| 12 | `f"The recipe is refused: {` | `f"The film idea cannot be used: {` |
| 13 | `"Not a slot of this recipe: "` | `"Not a place in this film idea: "` |
| 14 | `The slot “{s['label']}” has no file yet.` | `“{s['label']}” has no video yet.` |
| 15 | `The slot “{s['label']}” takes one file; it has` | `“{s['label']}” takes one video; it has` |
| 16 | `"The model must be one of ` | `"The listening quality must be one of ` |
| 17 | `not a slot=file line` | `it should look like place=file` |
| 18 | `"none (the build has a guard that stops any network attempt)"` | `"none (the maker blocks the internet while it works)"` |
| 19 | `Build a film first; the answers are saved next to it.` | `Make a film first; the answers are saved next to it.` |
| 20 | `"Did the model download work? How long did it take?"` | `"Did the first-time download work? How long did it take?"` |
| 21 | `"Did the plan show what you expected it to find? What was missing or wrong?"` | `"Did Check my videos show what you expected it to find? What was missing or wrong?"` |
| 22 | `"Did you trust the Plan before pressing Build? What would have made you trust it more?"` | `"Did you trust the check before pressing Make my film? What would have made you trust it more?"` |
| 23 | `"How long did Plan and Build take, and did that feel too slow, fine, or fast?"` | `"How long did checking and making take, and did that feel too slow, fine, or fast?"` |
| 24 | `Make a film from a recipe and your own video files, on this computer. Choose a recipe, give each slot a file, press Plan to hear the files and see what would be built, then Build.` | `Make a film from your own videos, on this computer. Pick a film idea, give each place a video, press Check my videos to see what would be made, then Make my film.` |
| 25 | `<h2 id="h-recipe">1. Recipe</h2>` | `<h2 id="h-recipe">1. Film idea</h2>` |
| 26 | `<label for="recipe">Recipe</label>` | `<label for="recipe">Film idea</label>` |
| 27 | `This recipe is refused: ${r.problem}` | `This film idea cannot be used: ${r.problem}` |
| 28 | `'${r.file} (refused)'` | `'${r.file} (cannot be used)'` |
| 29 | `'No recipe files (.json) were found in the recipes folder.'` | `'No film idea files (.json) were found in the recipes folder.'` |
| 30 | `the recipe file stays as it is.` | `the film idea file stays as it is.` |
| 31 | `(or put it in the recipe).` | `(or put it in the film idea file).` |
| 32 | `<h2 id="h-files">2. Your files</h2>` | `<h2 id="h-files">2. Your videos</h2>` |
| 33 | `Paste bind lines instead` | `Paste file lines instead` |
| 34 | `<label for="model">Speech model on this computer</label>` | `<label for="model">Listening quality on this computer</label>` |
| 35 | `A larger model hears more words and is slower. Use the same one the finder used.` | `A bigger setting hears more words and is slower. Use the same one you used when you found the words.` |
| 36 | `<h2 id="h-plan">3. Plan, then Build</h2>` | `<h2 id="h-plan">3. Check, then make</h2>` |
| 37 | `aria-describedby="why">Plan</button>` | `aria-describedby="why">Check my videos</button>` |
| 38 | `aria-describedby="why" disabled>Build</button>` | `aria-describedby="why" disabled>Make my film</button>` |
| 39 | `Build turns on after a Plan says the files are ready.` | `Make my film turns on after Check my videos says your videos are ready.` |
| 40 | `A job is running, so Plan and Build are off until it ends. You can cancel it.` | `Something is running, so Check my videos and Make my film are off until it ends. You can cancel it.` |
| 41 | `The plan is ready. Press Build.` | `Ready. Press Make my film.` |
| 42 | `Used. Check the slots above, then press Plan.` | `Used. Check the boxes above, then press Check my videos.` |
| 43 | `${k} is not a slot of this recipe` | `${k} is not a place in this film idea` |
| 44 | `'The files and the recipe pass the door checks.'` | `'Your videos and the film idea are fine.'` |
| 45 | `'Film it would write'` | `'Film it would make'` |
| 46 | `'Words it will find'` | `'Words it will look for'` |
| 47 | `el('dt', {}, 'Files')` | `el('dt', {}, 'Videos')` |
| 48 | `el('dt', {}, 'Speech model')` | `el('dt', {}, 'Listening quality')` |
| 49 | `el('dt', {}, 'Network')` | `el('dt', {}, 'Internet use')` |
| 50 | `'Room on the work drive'` | `'Space left on the drive'` |
| 51 | `'Choose a recipe first.'` | `'Pick a film idea first.'` |
| 52 | `Now the plan listens to your files and says what it would build. It writes no film. It keeps the words it hears, so Build does not listen again.` | `Now the maker listens to your videos and shows what it would make. It does not make the film yet. It keeps the words it hears, so making the film does not listen again.` |
| 53 | `j.kind === 'plan' ? 'Listening to your files' : 'Building'` | `j.kind === 'plan' ? 'Listening to your files' : 'Making the film'` |
| 54 | `'Building the film.'` | `'Making the film.'` |
| 55 | `'It would cut ${a.clips.length} clip${a.clips.length === 1 ? '' : 's'}, about` | `'It would use ${a.clips.length} piece${a.clips.length === 1 ? '' : 's'}, about` |
| 56 | `clip(s), ${j.receipt.seconds.toFixed(1)} s, network attempts: ${j.receipt.network_attempts}. A receipt is beside it.` | `piece(s), ${j.receipt.seconds.toFixed(1)} s, internet use: ${j.receipt.network_attempts}. A record of the run is saved beside it.` |
| 57 | `'Plan ready: ${j.plan.clips.length} clip${j.plan.clips.length === 1 ? '' : 's'}, about ${j.plan.seconds_estimate} seconds. Build is now on.'` | `'Ready: ${j.plan.clips.length} piece${j.plan.clips.length === 1 ? '' : 's'}, about ${j.plan.seconds_estimate} seconds. Make my film is now on.'` |
| 58 | `'Cannot build yet. Not said anywhere in your files: ${j.plan.gaps.join(', ')}.'` | `'Cannot make the film yet. These words are not in your videos: ${j.plan.gaps.join(', ')}.'` |
| 59 | `'Not said anywhere in the files you chose: ${a.gaps.join(', ')}.'` | `'These words are not in the videos you chose: ${a.gaps.join(', ')}.'` |

Also changed (tests and audits only): the checks and `audit-maker-a11y.py` look for the new words. The ten questions FACES wrote are changed in 4 of 10 (questions 3, 5, 6 and 7 used Plan, Build and "model"); they are in the table above.