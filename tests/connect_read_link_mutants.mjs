// Must-fail proof for tests/connect-read-link.test.mjs (the signed read link): each mutant breaks ONE rule of supabase/functions/editor-bundle/core.ts in a scratch copy (or, where two layers check the same rule,
// both layers) and the suite must then FAIL. A baseline run on the unbroken copy must PASS first, and every text must occur exactly once. Run:  node tests/connect_read_link_mutants.mjs
// Dropped as EQUIVALENT, with the reason: the signature-length check (`sig.length !== 32`): a signature of any other length makes the HMAC comparison fail by itself, so removing the check changes nothing a test can see.
// Dropped as EQUIVALENT too: the extra raw-path check (`..`, `//`, `%`) in handle(): the path pattern already allows only letters, digits, _ . - after /editor-bundle/, and a token that holds two dots, a slash or a
// percent sign cannot be a token (it has exactly one dot), so removing the extra check changes nothing a test can see; the pattern's own mutants below are what prove the path rule.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-readlink');
const C = 'supabase/functions/editor-bundle/core.ts';
const SUITES = ['connect-read-link.test.mjs'];
const KEYCHECK_VERIFY = 'if (typeof secret !== "string" || secret.length < MIN_KEY_CHARS) return null;';
const KEYCHECK_HANDLE = 'if (typeof secret !== "string" || secret.length < MIN_KEY_CHARS) return refuse("key");';
const CLOCK_HANDLE = 'if (typeof now !== "number" || !Number.isFinite(now)) return refuse("clock");';
const CLOCK_VERIFY = 'if (!Number.isFinite(now)) return null;';
const PATH = '/^[/]editor-bundle[/]([A-Za-z0-9_.-]+)$/.exec(raw)';
const ALLOWED = 'ok = (await deps.allowed(claims.project_id, claims.owner_hash)) === true;';
const mutants = [
  ['a longer lifetime is not capped when minting', [[C, 'Math.min(LINK_MAX_SECONDS, Math.max(1, Number.isFinite(asked) ? asked : LINK_MAX_SECONDS))', 'Math.max(1, Number.isFinite(asked) ? asked : LINK_MAX_SECONDS)']]],
  ['a signed link that lasts longer than 10 minutes is accepted', [[C, 'if (c.exp <= c.iat || c.exp - c.iat > LINK_MAX_SECONDS) return null;', 'if (c.exp <= c.iat) return null;']]],
  ['a link is still good in the second it expires', [[C, 'now >= c.exp ||', 'now > c.exp ||']]],
  ['expiry is not checked at all', [[C, 'if (now >= c.exp || now < c.iat - CLOCK_SKEW_SECONDS) return null;', 'if (now < c.iat - CLOCK_SKEW_SECONDS) return null;']]],
  ['a link from the future is accepted', [[C, ' || now < c.iat - CLOCK_SKEW_SECONDS) return null;', ') return null;']]],
  ['the signature is not checked', [[C, 'if (!(await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), sig, enc.encode(payload)))) return null;', '']]],
  ['a short or missing key is accepted (both layers)', [[C, KEYCHECK_VERIFY, ''], [C, KEYCHECK_HANDLE, '']]],
  ['the version is not checked', [[C, 'if (c.v !== LINK_VERSION || c.scope !== LINK_SCOPE) return null;', 'if (c.scope !== LINK_SCOPE) return null;']]],
  ['the scope is not checked', [[C, 'if (c.v !== LINK_VERSION || c.scope !== LINK_SCOPE) return null;', 'if (c.v !== LINK_VERSION) return null;']]],
  ['extra or missing fields in the payload are accepted', [[C, 'if (keys !== "exp,iat,jti,owner_hash,project_id,scope,v") return null;', '']]],
  ['the project id is not checked for form', [[C, 'typeof c.project_id !== "string" || !UUID.test(c.project_id) || ', '']]],
  ['times need not be whole numbers', [[C, 'if (!Number.isInteger(c.iat) || !Number.isInteger(c.exp)) return null;', '']]],
  ['an unreadable clock is accepted (both layers)', [[C, CLOCK_HANDLE, ''], [C, CLOCK_VERIFY, '']]],
  ['a site cookie is accepted', [[C, 'const REFUSED_HEADERS = ["cookie", "authorization",', 'const REFUSED_HEADERS = ["authorization",']]],
  ['an Authorization header is accepted', [[C, 'const REFUSED_HEADERS = ["cookie", "authorization",', 'const REFUSED_HEADERS = ["cookie",']]],
  ['a project named in a header is accepted', [[C, ', "x-project-id", "x-project", "x-editor-project"];', '];']]],
  ['a query string is accepted', [[C, 'if (url.search !== "" || url.hash !== "") return refuse("query");', '']]],
  ['the path may carry more after the token', [[C, PATH, '/^[/]editor-bundle[/]([A-Za-z0-9_.-]+)(?:[/].*)?$/.exec(raw)']]],
  ['the path may start anywhere', [[C, PATH, '/[/]([A-Za-z0-9_.-]+)$/.exec(raw)']]],
  ['any method is served', [[C, 'if (req.method !== "GET") {', 'if (false) {']]],
  ['the project, owner and grant are not asked about', [[C, ALLOWED, 'ok = true;']]],
  ['a database error lets the read through', [[C, 'catch { ok = false; }', 'catch { ok = true; }']]],
  ['the answer of the first read is remembered', [[C, ALLOWED, 'ok = ((globalThis as any).__ok ??= (await deps.allowed(claims.project_id, claims.owner_hash)) === true);']]],
  ['the bundle is offered as a download', [[C, 'const headers: Record<string, string> = { ...BASE_HEADERS,', 'const headers: Record<string, string> = { ...BASE_HEADERS, "Content-Disposition": "attachment",']]],
  ['the answer may be cached', [[C, '"Cache-Control": "no-store",', '"Cache-Control": "public, max-age=600",']]],
  ['a refusal is a redirect', [[C, 'new Response(FORBIDDEN_BODY, { status: 403,', 'new Response(FORBIDDEN_BODY, { status: 302,']]],
  ['a bad token gets its own words', [[C, 'if (!claims) return refuse("token");', 'if (!claims) return new Response("That link is not good.", { status: 403 });']]],
  ['the log carries the address', [[C, 'try { deps.log(why); }', 'try { deps.log(why + ":" + req.url); }']]],
  ['the token carries the account id', [[C, 'return [...d].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);', 'return ownerId;']]],
  ['the object type is taken from the store whatever it says', [[C, 'TYPES.has(obj.contentType) ? obj.contentType : "application/octet-stream"', 'obj.contentType']]],
];

function run(cwd) { return spawnSync(process.execPath, ['--test', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd }); }
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/functions/editor-bundle'), path.join(scratch, 'supabase/functions/editor-bundle'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
  for (const s of SUITES) fs.copyFileSync(path.join(root, 'tests', s), path.join(scratch, 'tests', s));
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
function cleanup() { fs.rmSync(scratch, { recursive: true, force: true }); }
fresh();
if (run(scratch).status) { console.log('BASELINE FAILS (nothing proved)'); cleanup(); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, edits] of mutants) {
  cleanup(); fresh();
  let broken = false;
  for (const [file, from, to] of edits) {
    const target = path.join(scratch, file);
    const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
    const n = src.split(from).length - 1;
    if (n !== 1) { console.log(`BROKEN MUTANT (text found ${n} times): ${name}`); missed++; broken = true; break; }
    fs.writeFileSync(target, src.replace(from, () => to));
  }
  if (broken) continue;
  const caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
cleanup();
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
