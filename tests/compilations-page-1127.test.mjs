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
  assert.ok(C.buildRequest({ phrase: 'x', folders: Array.from({ length: 11 }, (_, i) => 'f' + i).join(',') }).error);
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
test('LOCAL: the folder picker reads only the folder NAME and a file count; the words say nothing is uploaded', () => {
  const page = read('assets/app-compilations.js');
  assert.ok(page.includes("split('/')[0]"));
  assert.ok(page.includes('Nothing is uploaded: nothing leaves your computer.') && page.includes('Your videos never leave your computer.'));
});
test('RUN LINES: what the person\'s computer reported becomes a plain line: counts only, a closed list of reasons, the generic line for anything else', () => {
  const W = C.WORDS, run = s => C.runLine(s, W);
  assert.equal(run(null), W.waiting);
  assert.match(run({ state: 'matching', matches: 7 }), /finding the matches on your computer\. 7 matches\.$/);
  assert.match(run({ state: 'done', matches: 7, clips: 7, film_seconds: 41.2 }), /^Done\. Your film is on your computer\. 7 matches, 7 clips, 41 seconds long\.$/);
  assert.match(run({ state: 'failed', error_code: 'not_said' }), /It did not finish\. Your videos do not say it\.$/);
  assert.match(run({ state: 'failed', error_code: '<b>x</b>' }), /Something went wrong\. Try again from the app\.$/);
  assert.equal(run({ state: 'nonsense' }), W.waiting);
});
test('HONEST OPTIONS (FACES 08:21): no song box and no clean-cuts box (the engine refuses a song request and makes no clean cuts); the request always sends song false and clean_cuts false; the privacy paragraph is on the first tab once', () => {
  const page = read('assets/app-compilations.js');
  assert.ok(!page.includes("id: 'comp-song'") && !page.includes("id: 'comp-cuts'"));
  assert.equal((page.match(/WORDS\.local/g) || []).length, 1);
  assert.ok(page.includes('may use the word upload'));
});
