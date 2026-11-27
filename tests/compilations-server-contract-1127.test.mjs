// Pins the site's Compilations calls against BUILDER's server migration, WITHOUT a database (WEB 11-27).
// The migration text is a pinned copy in tests/fixtures/ (the commit is in its name); the branch origin/builder-compilations-server-1127 is compared to it when present and any drift is printed.
// The page refuses everything the migration refuses (the mismatches of 11-27 are resolved; docs/compilations-contract-mismatches-1127.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('..', import.meta.url);
const read = p => fs.readFileSync(new URL(p, ROOT), 'utf8');
const BRANCH = 'origin/builder-compilations-server-1127';
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });

// The migration text: a pinned copy under tests/fixtures/ (named with the commit it came from) is what the tests use, so they do not go quiet if the branch is deleted.
// When the branch is still there it is compared to the pin; a difference is noted in the test output (drift), not silently ignored.
const PIN = 'tests/fixtures/compilations-server-87675142-20261127000300.sql';
let SQL = null, SKIP = false, BRANCH_SQL = null;
try { SQL = read(PIN).replace(/\r/g, ''); } catch (e) { SKIP = `the pinned migration ${PIN} is missing`; }
try {
  const name = git('ls-tree', '--name-only', BRANCH, 'supabase/migrations/').split('\n').find(n => /\/20261127000300_.*\.sql$/.test(n));
  if (name) BRANCH_SQL = git('show', `${BRANCH}:${name}`).replace(/\r/g, '');
} catch { BRANCH_SQL = null; }
if (SQL === null && BRANCH_SQL !== null) { SQL = BRANCH_SQL; SKIP = false; }
const DRIFT = BRANCH_SQL === null ? 'the branch is not available here; checked against the pinned copy only' : (BRANCH_SQL === SQL ? null : `DRIFT: ${BRANCH} differs from the pinned copy ${PIN}; refresh the pin and re-check the page`);
if (DRIFT) console.log('# compilations contract: ' + DRIFT);
const T = (name, a, b) => { const opts = typeof a === 'function' ? {} : a, fn = typeof a === 'function' ? a : b; test(name, { skip: SKIP || undefined, ...opts }, fn); };

const win = {};
vm.runInNewContext(read('assets/app-compilations.js'), { window: win });
const C = win.ryagramCompilations;
const DATA = read('assets/app-data.js');
const list = s => [...s.matchAll(/'([^']+)'/g)].map(m => m[1]);
const sorted = a => [...a].sort();

// ---- what the migration says, parsed from its text
const sig = n => { const m = SQL.match(new RegExp(`create function public\\.${n}\\(([^)]*)\\)\\s+returns`)); return m && m[1].split(',').map(s => s.trim().split(/\s+/)); };
const runsBlock = () => SQL.match(/create table public\.compilation_runs \(([\s\S]*?)\n\);/)[1];
const runStates = () => list(runsBlock().match(/state text not null check \(state in \(([^)]*)\)/)[1]);
const errorCodes = () => list(SQL.match(/codes constant text\[\] := array\[([^\]]*)\]/)[1]);
const requestKeys = () => list(SQL.match(/k <> all \(array\[([^\]]*)\]/)[1]);
// the columns of public.compilation_requests (its own migration, 20261026000300, in this tree)
const requestCols = () => read('supabase/migrations/20261026000300_compilation_requests.sql').match(/create table public\.compilation_requests \(([\s\S]*?)\n\);/)[1]
  .split('\n').map(l => l.trim().match(/^([a-z_0-9]+) /)).filter(Boolean).map(m => m[1]);

// ---- the migration's request checks, mirrored in JS (compilation_request_problem). Returns a short reason or null.
const INVISIBLE = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
const SQL_PLACE = /([a-z]:[\\/]|\\\\[a-z0-9]|(^|[^a-z0-9._-])\/(users|home|mnt|volumes|private|tmp|var|media|etc|srv|opt|root)\/|[a-z][a-z0-9+.-]*:\/\/|%2f|%5c|%3a|(^|\s)~[a-z0-9_]*[/\\]|%[a-z_]+%|\$home\b|[\uff0f\uff3c\u2215\uff1a])/i;
const SQL_KEYS = /"([a-z_]*path[a-z_]*|urls?|uri|href|src|files?|filename|video|audio|dir|directory|location)"\s*:/i;
const allStrings = (x, out = []) => { if (typeof x === 'string') out.push(x); else if (x && typeof x === 'object') for (const v of Object.values(x)) allStrings(v, out); return out; };
function serverProblem(p) {
  if (p === null || typeof p !== 'object' || Array.isArray(p) || p.schema !== 'ryagram.compilation-request/0') return 'not valid';
  const t = JSON.stringify(p);
  if (Buffer.byteLength(t) > 32768) return 'too long';
  if (SQL_KEYS.test(t)) return 'file key';
  if (SQL_PLACE.test(allStrings(p).join('\n').replace(INVISIBLE, ''))) return 'place';
  for (const k of Object.keys(p)) if (!requestKeys().includes(k)) return 'unknown part ' + k;
  if (typeof p.phrase !== 'string' || ![...p.phrase.trim()].length || [...p.phrase].length > 200) return 'phrase';
  if ('search' in p && !['every', 'words'].includes(p.search)) return 'search';
  if (!Array.isArray(p.folders) || p.folders.length < 1 || p.folders.length > 10) return 'folders count';
  for (const e of p.folders) {
    const f = typeof e === 'string' ? e.trim() : null, n = f === null ? 0 : [...e].length;
    if (f === null || ![...f].length || n > 80 || f === '.' || f === '..' || /[\\/:*?"<>|\x00-\x1f\x7f-\x9f]/.test(f)) return 'folder name';
  }
  if (p.song === true || p.mode === 'song') return 'song';
  if ('note' in p && (typeof p.note !== 'string' || [...p.note].length > 500)) return 'note';
  return null;
}
const wire = r => JSON.parse(JSON.stringify(r));

// ---- 1. the calls
T('RPC: app-data.js calls my_compilation_set and my_compilation_get by the migration\'s names and parameter names', () => {
  assert.deepEqual(sig('my_compilation_set'), [['p_project', 'uuid'], ['p_request', 'jsonb']]);
  assert.deepEqual(sig('my_compilation_get'), [['p_project', 'uuid']]);
  const setCall = DATA.match(/client\.rpc\('my_compilation_set', \{([^}]*)\}/)[1];
  assert.deepEqual([...setCall.matchAll(/(p_[a-z_]+):/g)].map(m => m[1]), sig('my_compilation_set').map(a => a[0]));
  const getCall = DATA.match(/client\.rpc\('my_compilation_get', \{([^}]*)\}/)[1];
  assert.deepEqual([...getCall.matchAll(/(p_[a-z_]+):/g)].map(m => m[1]), sig('my_compilation_get').map(a => a[0]));
  assert.ok(/grant execute on function public\.my_compilation_set\(uuid, jsonb\), public\.my_compilation_get\(uuid\) to authenticated/.test(SQL), 'both are granted to the signed-in person');
  assert.ok(!/rpc\('node_compilation_report'/.test(DATA), 'the site never calls the computer-only report');
});

T('SELECTS: the page names only columns the tables and my_compilation_get have', () => {
  const cols = requestCols();
  assert.deepEqual(cols, ['project_id', 'owner_id', 'request', 'request_sha256', 'updated_at']);
  const sel = DATA.match(/from\('compilation_requests'\)\.select\('([^']*)'\)/)[1].split(',').map(s => s.trim());
  for (const c of sel) assert.ok(cols.includes(c), 'compilation_requests has no column ' + c);
  const body = SQL.match(/create function public\.my_compilation_get[\s\S]*?\nend \$\$;/)[0];
  const runKeys = list(body.match(/'run', \(select jsonb_build_object\(([\s\S]*?)\)\s*from public\.compilation_runs c/)[1]);
  for (const k of ['state', 'matches', 'clips', 'film_seconds', 'error_code', 'current']) assert.ok(runKeys.includes(k), 'my_compilation_get run has no ' + k);
  const page = read('assets/app-compilations.js');
  for (const m of page.matchAll(/\brun\.([a-z_]+)/g)) assert.ok(runKeys.includes(m[1]), 'the page reads run.' + m[1] + ' which the server does not return');
  const rb = runsBlock();
  for (const c of ['state', 'matches', 'clips', 'film_seconds', 'error_code']) assert.ok(new RegExp(`^\\s*${c} `, 'm').test(rb), 'compilation_runs has no ' + c);
});

// ---- 2. the words
T('STATES: WORDS.states are exactly the migration\'s six run states', () => {
  assert.deepEqual(sorted(Object.keys(C.WORDS.states)), sorted(runStates()));
  assert.equal(runStates().length, 6);
});

T('ERRORS: WORDS.errors keys are the migration\'s eleven reasons plus the one documented extra, stale (set only by the server)', () => {
  const codes = errorCodes();
  assert.equal(codes.length, 11);
  assert.deepEqual(sorted(Object.keys(C.WORDS.errors)), sorted([...codes, 'stale']));
  assert.ok(/p_error_code = 'stale'/.test(SQL) && /error_code = 'stale'/.test(SQL), 'the server sets stale itself and refuses the computer\'s');
  assert.ok(/error_code text check \(error_code ~ '\^\[a-z_\]\{1,40\}\$'\)/.test(SQL));
  for (const k of Object.keys(C.WORDS.errors)) assert.match(k, /^[a-z_]{1,40}$/);
});

// ---- 3. the request the page builds against the migration's own request rules
T('LIMITS: the page\'s limits equal the numbers in the migration text', () => {
  assert.ok(SQL.includes('> 32768'));
  assert.ok(/char_length\(btrim\(p ->> 'phrase'\)\) < 1 or char_length\(p ->> 'phrase'\) > 200/.test(SQL) && C.LIMITS.phrase === 200);
  assert.ok(/jsonb_array_length\(p -> 'folders'\) not between 1 and 10/.test(SQL) && C.LIMITS.folders === 8 && C.LIMITS.folders <= 10);      // FACES' engine takes 1 to 8; the server accepts 1 to 10: a smaller page limit is safe
  assert.ok(/char_length\(f\) < 1 or char_length\(e #>> '\{\}'\) > 80/.test(SQL));
  assert.ok(/char_length\(p ->> 'note'\) > 500/.test(SQL) && C.LIMITS.note === 500);
  assert.ok(SQL.includes("'schema', 'phrase', 'search', 'mode', 'folders', 'song', 'clean_cuts', 'rules', 'texts', 'cards', 'clip_labels', 'note', 'checklist'"));
  assert.ok(SQL.includes("'ryagram.compilation-request/0'"));
});

T('SHAPE: a request the page builds passes every mirrored migration check, and uses only parts the migration knows', () => {
  const r = C.buildRequest({ phrase: 'of the people', search: 'words', folders: 'Interviews\nB-roll', note: 'a note' }).request;
  assert.equal(r.schema, 'ryagram.compilation-request/0');
  for (const k of Object.keys(r)) assert.ok(requestKeys().includes(k), k);
  assert.equal(serverProblem(wire(r)), null);
  const maxed = C.buildRequest({ phrase: 'x'.repeat(200), note: 'n'.repeat(500), folders: Array.from({ length: 8 }, (_, i) => 'f'.repeat(78) + i).join(',') }).request;
  assert.equal(serverProblem(wire(maxed)), null, 'the largest request the page allows');
  assert.ok(Buffer.byteLength(JSON.stringify(maxed)) < 32768);
});

T('MIRROR SELF-CHECK: the JS mirror refuses what the migration refuses (a place, a link, a bad name, a song, too many folders)', () => {
  const ok = { schema: 'ryagram.compilation-request/0', phrase: 'x', folders: ['A'] };
  assert.equal(serverProblem(ok), null);
  for (const bad of [{ ...ok, phrase: 'see http://x' }, { ...ok, phrase: 'C:\\x' }, { ...ok, folders: ['a/b'] }, { ...ok, folders: [] }, { ...ok, folders: Array(11).fill('a') }, { ...ok, song: true }, { ...ok, path: 'x' }, { ...ok, phrase: '' }, { ...ok, extra: 1 }])
    assert.ok(serverProblem(bad), JSON.stringify(bad));
});

// Every input the migration refuses, the page must refuse too, in its own plain sentence (the page may be stricter, never looser).
// These were the eight todo mismatches of 11-27 (docs/compilations-contract-mismatches-1127.md); the page now refuses each one.
const BS = String.fromCharCode(92);
const MUST_REFUSE = {
  'a home path in the words': { form: { phrase: 'in ~/Videos please', folders: 'A' }, say: 'words' },
  'a home path in the note': { form: { phrase: 'x', folders: 'A', note: 'see ~' + BS + 'Videos' }, say: 'words' },
  'an environment name in the words': { form: { phrase: 'from %USERPROFILE% today', folders: 'A' }, say: 'words' },
  '$HOME in the words': { form: { phrase: 'under $HOME now', folders: 'A' }, say: 'words' },
  '$home in the note': { form: { phrase: 'x', folders: 'A', note: '$home' }, say: 'words' },
  'a fullwidth slash in the words': { form: { phrase: 'a\uff0fb', folders: 'A' }, say: 'words' },
  'a fullwidth colon in the note': { form: { phrase: 'x', folders: 'A', note: 'a\uff1ab' }, say: 'words' },
  'a percent-encoded slash in the words': { form: { phrase: 'a%2Fb', folders: 'A' }, say: 'words' },
  'a percent-encoded slash in a folder name': { form: { phrase: 'x', folders: 'a%2fb' }, say: 'folder' },
  'an environment name as a folder': { form: { phrase: 'x', folders: '%TEMP%' }, say: 'folder' },
  'a fullwidth slash as a folder': { form: { phrase: 'x', folders: 'a\uff0fb' }, say: 'folder' },
  'a fullwidth backslash as a folder': { form: { phrase: 'x', folders: 'a\uff3cb' }, say: 'folder' },
  'a home path after an opening bracket in the words': { form: { phrase: 'see (/home/x', folders: 'A' }, say: 'words' },
  'a home path after a quote in the note': { form: { phrase: 'x', folders: 'A', note: 'at "/Users/me/v' }, say: 'words' },
  'a link in the words': { form: { phrase: 'see https://example.com', folders: 'A' }, say: 'words' },
  'a C1 control character in a folder name': { form: { phrase: 'x', folders: 'a\u0085b' }, say: 'folder' },
  'a DEL character in a folder name': { form: { phrase: 'x', folders: 'a\x7fb' }, say: 'folder' },
  'a home path hidden by an invisible character': { form: { phrase: 'a ~\u200b/x', folders: 'A' }, say: 'words' },
};
const SAY = { words: /^Write words, not a place on your computer\./, folder: /^That is not a folder name\./ };
// the page's answer, then the migration's on the request it built (a page refusal counts as agreeing with a migration refusal)
const both = form => { const b = C.buildRequest(form); return { page: b.error || null, server: b.error ? undefined : serverProblem(wire(b.request)) }; };

for (const [name, { form, say }] of Object.entries(MUST_REFUSE)) T(`REFUSED: ${name}: the page refuses it in its plain sentence, never echoing what was typed`, () => {
  const b = C.buildRequest(form);
  assert.ok(b.error, 'the page let through what the migration refuses');
  assert.match(b.error, SAY[say]);
  for (const v of Object.values(form)) if (v.length > 2) assert.ok(!b.error.includes(v.trim()), 'the sentence echoes the typed text');
  const echoed = /(~|%|\$home|\uff0f|\uff1a|\x7f|\u0085|home|https)/i.test(b.error);
  assert.ok(!echoed, 'the sentence echoes a character that was typed');
});
// The migration (mirrored) refuses the same inputs when sent raw, so each of these is a real server refusal, not a page-only rule.
for (const [name, { form }] of Object.entries(MUST_REFUSE)) T(`SERVER REFUSES RAW: ${name}`, () => {
  const folders = String(form.folders).split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
  const raw = { schema: 'ryagram.compilation-request/0', phrase: String(form.phrase).trim(), folders, song: false, clean_cuts: false, rules: [], texts: [], note: form.note || '' };
  assert.ok(serverProblem(wire(raw)), 'the mirror accepts it: the case is not a mismatch');
});

// Normal names and words must still pass: the stricter rules do not catch ordinary text.
const NORMAL = {
  'B-roll as a folder': { phrase: 'x', folders: 'B-roll' },
  'Interviews 2 as a folder': { phrase: 'x', folders: 'Interviews 2' },
  'both together': { phrase: 'x', folders: 'Interviews 2, B-roll, Été 2024' },
  'a percent sign in the words': { phrase: '100% sure', folders: 'A' },
  'two percent signs apart in the words': { phrase: '50% of it, then 20% more', folders: 'A' },
  'a percent sign in the note': { phrase: 'x', folders: 'A', note: 'about 5% of the clips' },
  'a percent sign in a folder': { phrase: 'x', folders: '100% Done' },
  'a tilde in the words': { phrase: 'about ~5 minutes', folders: 'A' },
  'a tilde in a folder': { phrase: 'x', folders: 'Trip ~2024' },
  'a dollar sign in the words': { phrase: 'it cost $5 at home', folders: 'A' },
  'brackets and a percent in the words': { phrase: '(and then) 100% sure', folders: 'A' },
  'a slash-free bracketed word': { phrase: 'see (home) and (users)', folders: 'A' },
  'home as a plain word': { phrase: 'going home', folders: 'Home movies' },
};
for (const [name, form] of Object.entries(NORMAL)) T(`NORMAL: ${name}: the page accepts it and so does the migration`, () => {
  const b = C.buildRequest(form);
  assert.ok(!b.error, b.error);
  assert.equal(serverProblem(wire(b.request)), null);
});

const AGREE = {
  'a link in the words': { phrase: 'see http://example.com now', folders: 'A' },
  'a link in the note': { phrase: 'x', folders: 'A', note: 'https://example.com' },
  'plain': { phrase: 'of the people', folders: 'Interviews, B-roll' },
  'accents and a long dash': { phrase: 'café – ça va', folders: 'Été\nB roll' },
  'a dotted folder': { phrase: 'x', folders: 'v1.2 final' },
  'ten folders': { phrase: 'x', folders: 'a,b,c,d,e,f,g,h,i,j' },
  'a phrase of 200': { phrase: 'y'.repeat(200), folders: 'A' },
  'a note of 500': { phrase: 'x', folders: 'A', note: 'n'.repeat(500) },
  'a drive letter in the words': { phrase: 'C:' + BS + 'x', folders: 'A' },
  'a slash path in the words': { phrase: 'go to /users/x/y', folders: 'A' },
  'a share in the words': { phrase: BS + BS + 'srv' + BS + 'x', folders: 'A' },
  'a colon in a folder': { phrase: 'x', folders: 'C:' },
  'a star in a folder': { phrase: 'x', folders: 'a*b' },
  'dot dot': { phrase: 'x', folders: '..' },
  'a folder of 81': { phrase: 'x', folders: 'f'.repeat(81) },
  'eleven folders': { phrase: 'x', folders: 'a,b,c,d,e,f,g,h,i,j,k' },
};
for (const [name, form] of Object.entries(AGREE)) T(`AGREE: ${name}: the page never lets through what the migration refuses`, () => {
  const r = both(form);
  assert.ok(r.page || r.server === null, 'the page accepted it and the migration refuses it: ' + r.server);
});
