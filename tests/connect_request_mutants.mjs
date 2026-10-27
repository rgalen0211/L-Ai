// Must-fail proof for tests/connect-compilation-request.test.mjs (NEXT-CONNECT 118): each mutant breaks ONE thing in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first (so a "caught" means the suite really noticed). Run:  node tests/connect_request_mutants.mjs   (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-req');
const D = 'supabase/functions/connect-core/';
const SUITE = 'connect-compilation-request.test.mjs';
const mutants = [
  ['no ownership check on the project', D + 'tools.ts', 'if (!saved) return NOT_YOURS("project");', 'if (false) return NOT_YOURS("project");'],
  ['no daily limit', D + 'tools.ts', 'if (!(await ctx.policy.hit(ctx.principal, "compilation_requests"', 'if (false && !(await ctx.policy.hit(ctx.principal, "compilation_requests"'],
  ['a place hidden in the words is accepted', D + 'tools.ts', 'if (words.some((w) => w && looksLikePlace(w)))', 'if (false)'],
  ['a folder may be a path', D + 'tools.ts', 'const NAME_PATTERN = String.raw`^[^\\\\/:*?"<>|\\u0000-\\u001f]{1,80}$`;', 'const NAME_PATTERN = String.raw`^.{0,300}$`;'],
  ['a folder may be . or ..', D + 'tools.ts', ', not: { enum: [".", ".."] } }', ' }'],
  ['a picture may be any file', D + 'tools.ts', 'const PICTURE_PATTERN = String.raw`^[^\\\\/:*?"<>|\\u0000-\\u001f]{1,100}\\.(png|jpg|jpeg|webp|PNG|JPG|JPEG|WEBP)$`;', 'const PICTURE_PATTERN = String.raw`^.{1,300}$`;'],
  ['the tool is a read tool', D + 'tools.ts', 'title: "Ask for a compilation", scope: "write", readOnly: false,', 'title: "Ask for a compilation", scope: "read", readOnly: false,'],
  ['the tool says it is read-only', D + 'tools.ts', 'title: "Ask for a compilation", scope: "write", readOnly: false,', 'title: "Ask for a compilation", scope: "write", readOnly: true,'],
  ['folders are not required', D + 'tools.ts', '}, ["project_id", "phrase", "folders"]),', '}, ["project_id", "phrase"]),'],
  ['any number of rules', D + 'tools.ts', 'rules: { type: "array", maxItems: 20, items', 'rules: { type: "array", maxItems: 2000, items'],
  ['the phrase is echoed without the untrusted wrapper', D + 'tools.ts', 'Saved the request for ${untrusted("phrase", phrase)}', 'Saved the request for ${phrase}'],
  ['song defaults to on', D + 'tools.ts', 'song: a.song === true,', 'song: a.song !== false,'],
  ['a repeated folder name is kept twice', D + 'tools.ts', 'const folders = [...new Set((a.folders as string[]).map((f) => f.trim()).filter(Boolean))];', 'const folders = (a.folders as string[]);'],
  ['the real database call names another function', 'supabase/functions/connect/db.ts', '"connect_set_compilation_request"', '"connect_set_compilation_requests"'],
  ['the answer claims a build was started', D + 'tools.ts', 'Nothing has been built and no credit was used.', 'The film is being built.'],
];

function run(cwd) {
  return spawnSync(process.execPath, ['--test', path.join('tests', SUITE)], { encoding: 'utf8', cwd });
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
  fs.copyFileSync(path.join(root, 'tests', SUITE), path.join(scratch, 'tests', SUITE));
}
fresh();
const base = run(scratch);
if (base.status !== 0) { console.log('BASELINE FAILS (nothing proved):\n' + base.stdout.slice(-800)); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to] of mutants) {
  fresh();
  const target = path.join(scratch, file);
  const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  if (!src.includes(from)) { console.log(`BROKEN MUTANT (text not found): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, to));
  const caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
