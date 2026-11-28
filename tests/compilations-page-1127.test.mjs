// The Compilations department page (WEB 11-27, wave 8 departments on): behind the per-account switch 'compilations'; it saves a REQUEST (words + folder NAMES) and never sends or reads a clip or a path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const win = {};
vm.runInNewContext(read('assets/app-compilations.js'), { window: win });
const C = win.ryagramCompilations;
test('REQUEST: the form builds exactly the connector\'s request shape (schema ryagram.compilation-request/0), folders as unique NAMES', () => {
  const r = C.buildRequest({ phrase: ' of the people ', folders: 'Interviews, B-roll\nInterviews', search: 'words', song: true, cleanCuts: true, note: 'n' }).request;
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { schema: 'ryagram.compilation-request/0', phrase: 'of the people', search: 'words', folders: ['Interviews', 'B-roll'], song: false, clean_cuts: false, rules: [], texts: [], note: 'n' });
  assert.equal(C.buildRequest({ phrase: 'x', folders: 'A' }).request.search, 'every');
});
test('NO PATHS, NO EMPTIES, NO OVERSIZE: a path, a slash, a drive letter, dots, no folder, no words, too many folders are refused in plain words', () => {
  const BS = String.fromCharCode(92);
  for (const bad of ['a/b', 'C:/x', 'C:' + BS + 'x', BS + BS + 'srv' + BS + 'share', '..', '.', 'a*b']) assert.ok(C.buildRequest({ phrase: 'x', folders: bad }).error, bad);
  assert.ok(C.buildRequest({ phrase: '', folders: 'A' }).error);
  assert.ok(C.buildRequest({ phrase: 'x', folders: '' }).error);
  assert.ok(C.buildRequest({ phrase: 'x'.repeat(201), folders: 'A' }).error);
  assert.ok(C.buildRequest({ phrase: 'x', folders: Array.from({ length: 9 }, (_, i) => 'f' + i).join(',') }).error);
  assert.ok(!C.buildRequest({ phrase: 'x', folders: Array.from({ length: 8 }, (_, i) => 'f' + i).join(',') }).error, 'eight folders are allowed (FACES 1 to 8; the server takes 1 to 10)');
  assert.ok(C.buildRequest({ phrase: 'see C:' + BS + 'temp', folders: 'A' }).error, 'a place in the words');
});
test('SWITCH: compilations is an account switch, the department module promotes it only behind featureOn, the page only calls the proposed RPC and reads under RLS', () => {
  assert.match(read('assets/ryagram-config.js'), /^\s*compilations: 'account',/m);
  const d = read('assets/app-departments.js');
  assert.ok(d.includes("featureOn('compilations') === true") && d.includes("if (id === 'compilations' && compilationsOn()"));
  const data = read('assets/app-data.js');
  assert.ok(data.includes("client.rpc('my_compilation_set', { p_project: projectId, p_request: request })"));
  assert.ok(data.includes("client.from('compilation_requests').select('project_id, request, updated_at')"));
  const page = read('assets/app-compilations.js');
  assert.ok(!/fetch\(|XMLHttpRequest|FileReader|\.text\(\)|arrayBuffer|FormData/.test(page), 'the page reads and sends no file');
});
test('LOCAL: no folder picker (FACES 11-27); the words say the videos never leave the computer, the app will ask where each folder is', () => {
  const page = read('assets/app-compilations.js');
  assert.ok(!page.includes('webkitdirectory') && !page.includes('comp-pick') && !page.includes('may use the word upload'));
  assert.ok(page.includes('Your videos never leave your computer.'));
  assert.equal(C.WORDS.folderAsk, 'The Ryagram app will ask you where each folder is.');
});
test('RUN LINES: what the person\'s computer reported becomes a plain line: counts only, a closed list of reasons, the generic line for anything else', () => {
  const W = C.WORDS, run = s => C.runLine(s, W);
  assert.equal(run(null), W.waiting);
  assert.equal(run(undefined), W.waiting);
  assert.match(run({ state: 'matching', matches: 7 }), /finding the matches on your computer\. 7 matches, counted on your computer\.$/);
  assert.match(run({ state: 'done', matches: 7, clips: 7, film_seconds: 41.2 }), /^Done\. Your film is on your computer\. 7 matches, 7 clips, 41 seconds long, counted on your computer\.$/);
  assert.match(run({ state: 'failed', error_code: 'not_said' }), /It did not finish. Your videos do not say these words. Try other words, or add more folders.$/);
  assert.match(run({ state: 'failed', error_code: '<b>x</b>' }), /Something went wrong\. Try again from the app\.$/);
  assert.match(run({ state: 'cancelled', matches: 3 }), /^Stopped\. 3 matches, counted on your computer\.$/);
  assert.equal(run({ state: 'nonsense' }), W.waiting);
  assert.match(C.requestLine({ request: { phrase: 'x'.repeat(130), folders: ['a'] } }), /x…”/);      // a cut phrase says so
  assert.ok(read('assets/app-compilations.js').includes("savedNote"));      // the Saved line is repeated at the top of tab 2
});
test('HONEST OPTIONS (FACES 08:21): no song box and no clean-cuts box (the engine refuses a song request and makes no clean cuts); the request always sends song false and clean_cuts false; the privacy paragraph is on the first tab once', () => {
  const page = read('assets/app-compilations.js');
  assert.ok(!page.includes("id: 'comp-song'") && !page.includes("id: 'comp-cuts'"));
  assert.equal((page.match(/WORDS\.local/g) || []).length, 1);
  });
test('GAMES REVIEW 11-27: an old run is not shown, a typed place is never echoed, a refused save archives its empty project, a failed list load is plain, stale has words', () => {
  const W = C.WORDS;
  assert.equal(C.runLine({ state: 'done', current: false, matches: 3 }, W), W.earlier);
  assert.match(C.runLine({ state: 'done', current: true, matches: 3 }, W), /^Done\./);
  const b = C.buildRequest({ phrase: 'x', folders: 'bad:name' });
  assert.equal(b.error.includes('bad:name'), false);
  assert.match(b.error, /^That is not a folder name\./);
  assert.equal(W.errors.stale, 'The build stopped reporting.');
  assert.equal(C.runLine({ state: 'done', current: false, matches: 3 }, W), 'This is for an earlier version of your request. Save again to start over.');
  const pg = read('assets/app-compilations.js');
  assert.ok(pg.includes('data.myComputers()') && !pg.includes('myLocalCompute'), 'the no-app line is keyed on the computers list, not the tester flag');
  assert.match(W.local, /your note and the name of your compilation/);
  const page = read('assets/app-compilations.js');
  assert.ok(page.includes('data.archiveProject(made.project.id)') && page.includes('plainRefusal') && !page.includes('err.message)); return; }'));
});
test('WEB 11-27 fold2: unknown state shows only the waiting line, stale its own sentence, edit_failed points nowhere, the no-app line hides once a run is reported, no songs promise', () => {
  const W = C.WORDS;
  assert.equal(C.runLine({ state: 'zzz', matches: 4, clips: 2 }, W), W.waiting);
  assert.equal(C.runLine({ state: 'stale', matches: 4 }, W), W.errors.stale);
  assert.ok(!/tell us/.test(W.errors.edit_failed) && /Contact/.test(W.errors.edit_failed));
  const pg = read('assets/app-compilations.js');
  assert.ok(pg.includes("haveApp === false && !rows.some(r => r && r.run"), 'the no-app line is hidden when a run is already reported');
  assert.ok(pg.includes("label: 'Start', el: start") && pg.includes("label: 'Requests', el:"));
  assert.ok(!read('assets/app-departments.js').includes('into songs'));
});
test('WEB fold2: film length is singular for one second, plural for 0 and more', () => {
  const W = C.WORDS;
  assert.match(C.runLine({ state: 'done', film_seconds: 1 }, W), /1 second long/);
  assert.doesNotMatch(C.runLine({ state: 'done', film_seconds: 1 }, W), /1 seconds/);
  assert.match(C.runLine({ state: 'done', film_seconds: 0 }, W), /0 seconds long/);
  assert.match(C.runLine({ state: 'done', film_seconds: 41 }, W), /41 seconds long/);
});
test('WEB fold3 (FACES honest launch words; WORKER 11:49): no promise of a film, no progress for a request alone, no song printed, door refusal, title and folder rules', () => {
  const W = C.WORDS;
  // every new sentence under 20 words and none promises a film or a time
  for (const k of ['intro', 'waiting', 'saved', 'noApp', 'folderAsk', 'songRow', 'door']) for (const sentence of W[k].split(/(?<=[.:;?])\s+/)) assert.ok(sentence.split(/\s+/).length < 20, sentence);
  assert.equal(W.intro, 'Save a request: a phrase and folder names. The Ryagram app makes the film; it is not open to everyone yet.');
  assert.equal(W.saved, 'Saved. Nothing is made yet: the Ryagram app, not open to everyone yet, makes the film. No credits are used.');
  assert.equal(W.waiting, 'Saved. Nothing is made until the Ryagram app opens for you; it will find this request.');
  assert.equal(W.noApp, 'The Ryagram app is not open to everyone yet. Your saved request will be found when it opens for you.');
  assert.match(W.local, /Nothing is made until the app opens for you\. No credits are used\.$/);
  assert.ok(!/Soon|queued|in progress|working on it|spinner|minutes|today|tomorrow/i.test(JSON.stringify([W.intro, W.local, W.waiting, W.saved, W.noApp])));
  // a request with no run, or a run with nothing real in it, never shows a state, a count or a failure
  for (const run of [null, undefined, {}, { state: 5 }, { state: 'zzz', matches: 4 }]) {
    const line = C.runLine(run, W);
    assert.equal(line, W.waiting);
    assert.ok(!/planning|finding the matches|making your film|Done|did not finish|Stopped|match|clip|second/i.test(line));
  }
  const pg = read('assets/app-compilations.js');
  assert.ok(!pg.includes('/get-app/') && !pg.includes('Get the Ryagram app'), 'no get-app link: that page is for invited testers');
  // a song request: no "as a song", its own plain line, no edit promised
  assert.ok(!/as a song/.test(C.requestLine({ request: { phrase: 'x', folders: ['a'], song: true } })));
  assert.ok(C.isSong({ request: { song: true } }) && C.isSong({ request: { mode: 'song' } }) && !C.isSong({ request: { song: false } }));
  assert.equal(W.songRow, 'This request asks for a song; Compilations do not make songs. Save a new one without the song.');
  assert.ok(!/Take out the song/.test(W.errors.song_request) && /without the song/.test(W.errors.song_request));
  assert.ok(pg.includes('isSong(r) ? WORDS.songRow'));
  // the door: the server's refusal for an account that is not let in gets its own sentence (no role guessed)
  assert.equal(C.doorRefusal({ code: '42501', message: 'permission denied for function my_compilation_set' }), W.door);
  assert.equal(C.doorRefusal({ message: 'Compilations are not open for this account yet.' }), W.door);
  assert.equal(C.doorRefusal({ message: 'Name 1 to 10 folders.' }), null);
  assert.equal(C.doorRefusal(null), null);
  assert.ok(!/admin|worker|waiting|invited/i.test(W.door));
  // names: no comma or semicolon in a name; a place in the compilation's name is refused like one in the words
  assert.deepEqual(JSON.parse(JSON.stringify(C.folderList('Interviews, 2019'))), ['Interviews', '2019']);
  assert.match(C.buildRequest({ phrase: 'x', folders: 'a;b' }).error, /semicolon or a comma/);
  assert.match(C.buildRequest({ phrase: 'x', folders: 'A', title: 'see C:' + String.fromCharCode(92) + 'temp' }).error, /^Write words, not a place/);
  assert.ok(!C.buildRequest({ phrase: 'x', folders: 'A', title: 'My compilation' }).error);
  assert.match(C.buildRequest({ phrase: 'x', folders: 'a,b,c,d,e,f,g,h,i' }).error, /at most 8/);
  assert.ok(pg.includes('title: title.value'));
});
test('PROGRESS (Ryan 11-27, counts only): planning / matching / building say video or clip N of M and a percent; partial values say only what is valid; bad values are ignored', () => {
  const W = C.WORDS, run = o => C.runLine(o, W);
  assert.equal(run({ state: 'planning', step_done: 2, step_total: 3, percent: 45 }), 'The Ryagram app is planning your film: video 2 of 3, about 45% overall.');
  assert.equal(run({ state: 'matching', step_done: 2, step_total: 3, percent: 45 }), 'The Ryagram app is finding the matches: video 2 of 3, about 45% overall.');
  assert.equal(run({ state: 'building', step_done: 3, step_total: 4, percent: 80 }), 'The Ryagram app is making your film: clip 3 of 4, about 80% overall.');
  // the pair alone, the percent alone, neither
  assert.equal(run({ state: 'planning', step_done: 1, step_total: 3 }), 'The Ryagram app is planning your film: video 1 of 3.');
  assert.equal(run({ state: 'building', percent: 80 }), 'The Ryagram app is making your film: about 80% overall.');
  assert.equal(run({ state: 'planning', step_done: null, step_total: null, percent: null }), W.states.planning);
  assert.equal(run({ state: 'matching' }), W.states.matching);
  // step_done 0 says getting started, never "video 0 of M"
  assert.equal(run({ state: 'planning', step_done: 0, step_total: 3, percent: 0 }), 'The Ryagram app is planning your film: getting started, about 0% overall.');
  assert.ok(!/video 0|clip 0/.test(run({ state: 'building', step_done: 0, step_total: 4 })));
  // the last step and the edges are valid
  assert.match(run({ state: 'building', step_done: 4, step_total: 4, percent: 100 }), /clip 4 of 4, about 100% overall\.$/);
  assert.match(run({ state: 'planning', step_done: 0, step_total: 1000, percent: 0 }), /getting started/);
  // counts that were already shown stay, after the progress
  assert.equal(run({ state: 'matching', matches: 7, step_done: 2, step_total: 3, percent: 45 }), 'The Ryagram app is finding the matches: video 2 of 3, about 45% overall. 7 matches, counted on your computer.');
  // bad values are ignored field by field: strings, decimals, negatives, > 100, done > total, total 0 or > 1000, booleans, NaN, objects
  const bad = [{ step_done: '2', step_total: '3', percent: '45' }, { step_done: 2.5, step_total: 3, percent: 45.5 }, { step_done: -1, step_total: 3, percent: -5 }, { step_done: 5, step_total: 3, percent: 101 },
    { step_done: 1, step_total: 0, percent: 1000 }, { step_done: 1, step_total: 1001, percent: NaN }, { step_done: true, step_total: true, percent: true }, { step_done: {}, step_total: [], percent: Infinity }, { step_done: 1 }];
  for (const b of bad) {
    const line = run({ state: 'planning', ...b });
    assert.equal(line, W.states.planning, JSON.stringify(b));
    assert.ok(!/NaN|undefined|null|Infinity|object/.test(line));
  }
  assert.equal(run({ state: 'planning', step_done: 5, step_total: 3, percent: 45 }), 'The Ryagram app is planning your film: about 45% overall.');      // done > total: the pair goes, the valid percent stays
  assert.equal(run({ state: 'building', step_done: 2, step_total: 4, percent: 150 }), 'The Ryagram app is making your film: clip 2 of 4.');
  assert.equal(run({ state: 'planning', step_total: 3, percent: 10 }), 'The Ryagram app is planning your film: about 10% overall.');      // a total with no done is not a step
});
test('PROGRESS: never for done / failed / cancelled / stale / unknown states, an earlier run, or no run; the progress bar needs a valid percent', () => {
  const W = C.WORDS, full = { step_done: 2, step_total: 3, percent: 45 };
  for (const state of ['done', 'failed', 'cancelled', 'stale', 'zzz', 'Planning', '']) {
    const line = C.runLine({ state, error_code: 'not_said', ...full }, W);
    assert.ok(!/of 3|45%|overall|getting started/.test(line), state + ': ' + line);
    assert.equal(C.progressOf({ state, ...full }), null, state);
  }
  assert.equal(C.runLine({ state: 'planning', current: false, ...full }, W), W.earlier);
  assert.equal(C.progressOf({ state: 'planning', current: false, ...full }), null);
  for (const none of [null, undefined, {}, { state: 5, ...full }]) { assert.equal(C.runLine(none, W), W.waiting); assert.equal(C.progressOf(none), null); }
  assert.deepEqual(JSON.parse(JSON.stringify(C.progressOf({ state: 'building', ...full }))), { done: 2, total: 3, percent: 45 });
  assert.equal(C.progressOf({ state: 'building', step_done: 1, step_total: 3 }).percent, null);
  const pg = read('assets/app-compilations.js');
  assert.ok(pg.includes("h('progress', { class: 'comp-progress', max: 100, value: progressPercent(r.run)") && pg.includes("'aria-label': WORDS.progress.bar") && pg.includes("'aria-valuenow'"));
  assert.ok(pg.includes("isSong(r) || progressPercent(r.run) === null ? null : h('progress'"), 'the bar shows only for a valid percent');
  assert.ok(!/aria-live['"]?\s*[:=]\s*['"]assertive/.test(pg));
});
test('PROGRESS: counts only: no file name, folder, path or word from the run ever reaches a line, even if the app sent extras', () => {
  const W = C.WORDS, BS = String.fromCharCode(92);
  const extras = { current_file: 'Secret Interview.mp4', folder: 'Interviews', word: 'people', path: 'C:' + BS + 'Users' + BS + 'me', title: 'x', step_name: 'cutting Secret Interview.mp4' };
  for (const state of ['planning', 'matching', 'building']) {
    const line = C.runLine({ state, step_done: 2, step_total: 3, percent: 45, ...extras }, W);
    assert.ok(!/Secret|Interview|\.mp4|people|Users|cutting|:[\\/]/.test(line), line);
    assert.match(line, /^The Ryagram app is (planning your film|finding the matches|making your film): (video|clip) 2 of 3, about 45% overall\.$/);
  }
  assert.ok(!/upload|queued|spinner|minutes|soon/i.test(JSON.stringify(W.progress)));
});
test('PROGRESS: the mock, the stamp pair and the note: the progress columns are not in the current server migration (FOR RYAN YES)', () => {
  const m = read('tests/fake-supabase.js');
  assert.ok(m.includes('compstep'));
  const doc = read('docs/compilations-progress-page-1127.md');
  assert.ok(doc.includes("FOR RYAN'S YES") && doc.includes('20261128000100') && doc.includes('step_done') && doc.includes('step_total') && doc.includes('percent'));
  const html = read('app/index.html');
  assert.match(html, /app-compilations\.js\?v=20261127r1l/);
});
