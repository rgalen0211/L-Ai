// Must-fail proof for tests/node-compilation.test.mjs and tests/get-delivery-url-compilation.test.mjs (NEXT-CONNECT 120): each mutant breaks ONE thing in a scratch copy of the function code and the suites
// must then FAIL. A baseline run on the unbroken copy must PASS first (so a "caught" means the suites really noticed). Run:  node tests/node_compilation_mutants.mjs   (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-comp');
const R = 'supabase/functions/node-core/router.ts';
const G = 'supabase/functions/get-delivery-url/deliver.ts';
const SUITES = ['node-compilation.test.mjs', 'get-delivery-url-compilation.test.mjs'];
const mutants = [
  ['the routes exist when the function is off', R, 'if (isCompilation && !d.compilationLinksOn) return fail(404', 'if (false && isCompilation && !d.compilationLinksOn) return fail(404'],
  ['the rights tick is not required', R, 'if (b.rights !== true) return fail(400, "rights_required"', 'if (false) return fail(400, "rights_required"'],
  ['no cap in the function before the database', R, 'if (bytes > cap) return fail(413, "too_large", `That film is larger than this computer', 'if (false) return fail(413, "too_large", `That film is larger than this computer'],
  ['an odd path is signed', R, '|| !compilationPathOk(r.path, r.id)) return fail(500', '|| false) return fail(500'],
  ['the folder name of the path is not checked', R, '/compilations/(${', '/[a-z]+/(${'],
  ['the film id in the path is not checked', R, 'return !!m && m[2].toLowerCase() === id.toLowerCase();', 'return !!m;'],
  ['no per-address limit', R, 'if (!(await d.db.hit(who, "compilation_ip", 60, 60)))', 'if (false && !(await d.db.hit(who, "compilation_ip", 60, 60)))'],
  ['the database sentences are not mapped', R, 'if (COMPILATION_ROUTES.includes(route)) { const r = compilationRefusal(e); if (r) return r; }', ''],
  ['the id to finish or cancel is not checked', R, 'if (typeof b.id !== "string" || !UUID.test(b.id)) return fail(400', 'if (false) return fail(400'],
  ['the request can name the path to sign', R, 'upload_url: await d.storage.signUpload(r.path) }', 'upload_url: await d.storage.signUpload(String(b.path ?? r.path)) }'],
  ['the status route answers without a token check', R, 'if (!TOKEN.test(token)) return fail(401', 'if (false) return fail(401'],
  ['a compilation link has the data-film label', G, '      label = "Made on your computer";\n', ''],
  ['an expired compilation is "not found" not "gone"', G, 'if (/kept for its (30 )?days|no longer stored/.test((err2 as Error).message ?? "")) return reply(410', 'if (false) return reply(410'],
  ['a path outside the caller\'s folder is signed', G, 'if (!path.startsWith(`${user.id}/`)) return reply(404', 'if (false) return reply(404'],
  ['the compilation lookup is tried when off', G, 'if (!deps.compilationFor) return reply(404, { error: "Film not found." });', 'if (!deps.compilationFor) { deps.compilationFor = async (o, d) => `${o}/compilations/${d}.mp4`; }'],
  ['the real layer calls another SQL function', 'supabase/functions/node/db.ts', '"node_compilation_begin"', '"node_compilation_begins"'],
  ['the real layer passes the rights as text', 'supabase/functions/node/db.ts', '["text", "text", "bigint", "text", "boolean", "numeric", "int", "int"]', '["text", "text", "bigint", "text", "text", "numeric", "int", "int"]'],
];

function run(cwd) { return spawnSync(process.execPath, ['--test', ...SUITES.map((f) => path.join('tests', f))], { encoding: 'utf8', cwd }); }
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
  for (const f of SUITES) fs.copyFileSync(path.join(root, 'tests', f), path.join(scratch, 'tests', f));
}
fresh();
const base = run(scratch);
if (base.status !== 0) { console.log('BASELINE FAILS (nothing proved):\n' + (base.stdout + base.stderr).slice(-800)); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to] of mutants) {
  fresh();
  const target = path.join(scratch, file);
  const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  if (!src.includes(from)) { console.log(`BROKEN MUTANT (text not found): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, to));
  const r = run(scratch);
  const caught = r.status !== 0 && /ℹ fail [1-9]|✖/.test(r.stdout);
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
