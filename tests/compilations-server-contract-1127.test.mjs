// Pins the site's Compilations calls against BUILDER's server migration, WITHOUT a database (WEB 11-27).
// The migration text is read from the branch origin/builder-compilations-server-1127 with `git show` (like the other tests that read a branch); no git or no branch = skipped in words.
// Where the page and the migration disagree the assertion is marked todo and listed in docs/compilations-contract-mismatches-1127.md. The page is NOT edited by this test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('..', import.meta.url);
const read = p => fs.readFileSync(new URL(p, ROOT), 'utf8');
const BRANCH = 'origin/builder-compilations-server-1127';
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 });

let SQL = null, SKIP = false;
try {
  const name = git('ls-tree', '--name-only', BRANCH, 'supabase/migrations/').split('\n').find(n => /\/20261127000300_.*\.sql$/.test(n));
  SKIP = name ? false : `the migration 20261127000300_* is not on ${BRANCH}`;
  if (name) SQL = git('show', `${BRANCH}:${name}`).replace(/\r/g, '');
} catch (e) { SKIP = `git or ${BRANCH} is not available here (${String(e.message).split('\n')[0]}); contract not checked`; }
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
  if (typeof p.phrase !== 'string' || ![...p.phrase.trim()].length || [...p.phrase.trim()].length > 200) return 'phrase';
  if ('search' in p && !['every', 'words'].includes(p.search)) return 'search';
  if (!Array.isArray(p.folders) || p.folders.length < 1 || p.folders.length > 10) return 'folders count';
  for (const e of p.folders) {
    const f = typeof e === 'string' ? e.trim() : null, n = f === null ? 0 : [...f].length;
    if (f === null || n < 1 || n > 80 || f === '.' || f === '..' || /[\\/:*?"<>|\x00-\x1f\x7f]/.test(f)) return 'folder name';
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
  assert.ok(/char_length\(btrim\(p ->> 'phrase'\)\) not between 1 and 200/.test(SQL) && C.LIMITS.phrase === 200);
  assert.ok(/jsonb_array_length\(p -> 'folders'\) not between 1 and 10/.test(SQL) && C.LIMITS.folders === 10);
  assert.ok(/char_length\(f\) not between 1 and 80/.test(SQL));
  assert.ok(/char_length\(p ->> 'note'\) > 500/.test(SQL) && C.LIMITS.note === 500);
  assert.ok(SQL.includes("'schema', 'phrase', 'search', 'mode', 'folders', 'song', 'clean_cuts', 'rules', 'texts', 'cards', 'clip_labels', 'note', 'checklist'"));
  assert.ok(SQL.includes("'ryagram.compilation-request/0'"));
});

T('SHAPE: a request the page builds passes every mirrored migration check, and uses only parts the migration knows', () => {
  const r = C.buildRequest({ phrase: 'of the people', search: 'words', folders: 'Interviews\nB-roll', note: 'a note' }).request;
  assert.equal(r.schema, 'ryagram.compilation-request/0');
  for (const k of Object.keys(r)) assert.ok(requestKeys().includes(k), k);
  assert.equal(serverProblem(wire(r)), null);
  const maxed = C.buildRequest({ phrase: 'x'.repeat(200), note: 'n'.repeat(500), folders: Array.from({ length: 10 }, (_, i) => 'f'.repeat(78) + i).join(',') }).request;
  assert.equal(serverProblem(wire(maxed)), null, 'the largest request the page allows');
  assert.ok(Buffer.byteLength(JSON.stringify(maxed)) < 32768);
});

T('MIRROR SELF-CHECK: the JS mirror refuses what the migration refuses (a place, a link, a bad name, a song, too many folders)', () => {
  const ok = { schema: 'ryagram.compilation-request/0', phrase: 'x', folders: ['A'] };
  assert.equal(serverProblem(ok), null);
  for (const bad of [{ ...ok, phrase: 'see http://x' }, { ...ok, phrase: 'C:\\x' }, { ...ok, folders: ['a/b'] }, { ...ok, folders: [] }, { ...ok, folders: Array(11).fill('a') }, { ...ok, song: true }, { ...ok, path: 'x' }, { ...ok, phrase: '' }, { ...ok, extra: 1 }])
    assert.ok(serverProblem(bad), JSON.stringify(bad));
});

// Every input the page ACCEPTS must be accepted by the server too (the page may be stricter, never looser).
// A looser page is a KNOWN mismatch: listed in docs/compilations-contract-mismatches-1127.md and registered as todo.
const BS = String.fromCharCode(92);
const KNOWN = {
  'a home path in the words': { phrase: 'in ~/Videos please', folders: 'A' },
  'an environment name in the words': { phrase: 'from %USERPROFILE% today', folders: 'A' },
  '$HOME in the words': { phrase: 'under $HOME now', folders: 'A' },
  'a fullwidth slash in the words': { phrase: 'a\uff0fb', folders: 'A' },
  'a percent-encoded slash in a folder name': { phrase: 'x', folders: 'a%2fb' },
  'an environment name as a folder': { phrase: 'x', folders: '%TEMP%' },
  'a fullwidth slash as a folder': { phrase: 'x', folders: 'a\uff0fb' },
  'a DEL character in a folder name': { phrase: 'x', folders: 'a\x7fb' },
};
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
// the page's answer, then the migration's on the request it built (a page refusal counts as agreeing with a migration refusal)
const both = form => { const b = C.buildRequest(form); return { page: b.error || null, server: b.error ? undefined : serverProblem(wire(b.request)) }; };

for (const [name, form] of Object.entries(AGREE)) T(`AGREE: ${name}: the page never lets through what the migration refuses`, () => {
  const r = both(form);
  assert.ok(r.page || r.server === null, 'the page accepted it and the migration refuses it: ' + r.server);
});
for (const [name, form] of Object.entries(KNOWN)) T(`TODO MISMATCH: ${name}: the page accepts it, the migration refuses it`, { todo: 'see docs/compilations-contract-mismatches-1127.md' }, () => {
  const r = both(form);
  assert.ok(r.page || r.server === null, 'the page lets through what the migration refuses: ' + r.server);
});
// Guard: a KNOWN entry that stops disagreeing (page or migration changed) must move to AGREE and out of the doc.
T('KNOWN list is current: each listed mismatch still exists (page accepts, mirror refuses)', () => {
  for (const [name, form] of Object.entries(KNOWN)) {
    const r = both(form);
    assert.ok(!r.page && r.server, name + ' no longer disagrees: move it to AGREE and update the doc');
  }
});
