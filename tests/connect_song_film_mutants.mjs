// Must-fail proof for tests/connect-song-film-tool.test.mjs (NEXT-CONNECT 182): each mutant breaks ONE thing in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first. Run:  node tests/connect_song_film_mutants.mjs   (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-sf');
const T = 'supabase/functions/connect-core/tools.ts';
const SUITES = ['connect-song-film-tool.test.mjs'];
const mutants = [
  ['the switch answer is ignored', T, 'if (!sw || !(await sw.enabled())) {\n      return refuse("Song films cannot be asked', 'if (!sw) {\n      return refuse("Song films cannot be asked'],
  ['a copyright mark in a lyric line is accepted', T, 'if (t.includes(m)) return m;', 'if (false) return m;'],
  ['a published song is an allowed origin', T, 'const LYRIC_ORIGINS = ["written_for_this_film", "own_or_licensed", "public_domain"] as const;', 'const LYRIC_ORIGINS = ["written_for_this_film", "own_or_licensed", "public_domain", "published_song"] as const;'],
  ['the request is marked verified', T, 'verified: false, cast, folders,', 'verified: true as unknown as false, cast, folders,'],
  ['the source of the lyrics is not required', T, 'if (!source) return refuse("Say where the lyrics come from', 'if (false) return refuse("Say where the lyrics come from'],
  ['an address in the source is accepted', T, 'if (looksLikeLink(source) ||', 'if (false ||'],
  ['a cast row can name a line that is not there', T, 'if (cast.some((c) => c.line > lyrics.length))', 'if (false)'],
  ['another person project can be written to', T, 'if (!(await ctx.data.editState(String(a.project_id)))) return NOT_YOURS("project");', ''],
  ['the daily limit is gone', T, 'if (!(await ctx.policy.hit(ctx.principal, "songfilm", LIMITS.songFilmRequestsPerDayPerUser, 86400))) {', 'if (false) {'],
  ['the same singer twice on a line is accepted', T, 'if (new Set(cast.map(', 'if (false && new Set(cast.map('],
  ['the default speed cap is wrong', T, 'a.speed_cap === undefined ? 1.5 :', 'a.speed_cap === undefined ? 9 :'],
  ['the answer does not say the lyrics are not verified', T, 'marked as NOT verified by Ryagram. ', ' . '],
  ['the tool is listed', T, 'title: "Ask for a song film", scope: "write", readOnly: false, destructive: true, idempotent: true, listed: false,', 'title: "Ask for a song film", scope: "write", readOnly: false, destructive: true, idempotent: true,'],
  ['the declaration is shown outside the untrusted fence', T, '(${untrusted("lyrics-source", source)})', '(${source})'],
  ['the lyric line cap is gone', T, 'maxItems: MAX_SONG_LINES, items: { type: "string", minLength: 1, maxLength: 120 }', 'items: { type: "string", minLength: 1, maxLength: 120 }'],
];

function run(cwd) {
  return spawnSync(process.execPath, ['--test', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd });
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
  fs.cpSync(path.join(root, 'tests'), path.join(scratch, 'tests'), { recursive: true });
  fs.cpSync(path.join(root, 'assets'), path.join(scratch, 'assets'), { recursive: true });
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
fresh();
if (run(scratch).status) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to] of mutants) {
  fresh();
  const target = path.join(scratch, file);
  const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  if (!src.includes(from)) { console.log(`BROKEN MUTANT (text not found): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
