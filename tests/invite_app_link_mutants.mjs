// Must-fail proof for tests/app-link.test.mjs, tests/send-invite-app-link.test.mjs and tests/send-invite.test.mjs (NEXT-CONNECT 162): each mutant breaks ONE thing in a scratch copy of the code and the suites must then FAIL.
// A baseline run on the unbroken copy must PASS first. Run:  node tests/invite_app_link_mutants.mjs   (exit 0 only when every mutant is caught)
// The SQL half has its own must-fails (supabase/tests/test_invite_app_links.py) and the page has tools/check-get-app-mutants.py.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-il');
const L = 'supabase/functions/app-link/core.ts';
const S = 'supabase/functions/send-invite/send.ts';
const SUITES = ['app-link.test.mjs', 'send-invite-app-link.test.mjs', 'send-invite.test.mjs'];
const mutants = [
  ['the function answers when switched off', L, 'if (!deps.enabled()) return reply(404, { error: "Not found." });', ''],
  ['a foreign page is allowed', L, 'if (!allowed) return reply(403, { error: "Not allowed from this page." });', ''],
  ['GET is allowed', L, 'if (req.method !== "POST") return reply(405, { error: "Use POST." });', ''],
  ['the database is asked with the token, not its hash', L, 'const hash = await deps.sha256Hex(token);', 'const hash = token;'],
  ['the token format is not checked', L, 'if (!TOKEN.test(token)) return reply(404, { error: NOT_GOOD });', ''],
  ['capital letters are a good token', L, 'const TOKEN = /^[0-9a-f]{64}$/;', 'const TOKEN = /^[0-9a-fA-F]{64}$/i;'],
  ['a huge body is read', L, 'if (text.length > 512) return reply(400, { error: "Bad request." });', ''],
  ['any action is taken', L, 'if (body.action !== "peek" && body.action !== "redeem") return reply(400, { error: "Bad request." });', ''],
  ['peek uses the link up', L, 'const p = await deps.peek(hash);', 'const p = { ok: true, file_name: (await deps.redeem(hash)).file_name, size_bytes: 1 };'],
  ['redeem signs before the database has marked the link used', L, 'rel = await deps.redeem(hash);', 'rel = { kind: "app", file_name: "app-1.zip", size_bytes: 1, sha256: "c".repeat(64), object_key: "releases/app-1.zip", expires_seconds: 900 };'],
  ['an unconfigured function uses the link up first', L, 'if (!deps.configured()) return reply(503, { error: "The download is not set up yet." });', ''],
  ['a used link gets a different answer from an unknown one', L, 'if (e.code === "PT404") return reply(404, { error: NOT_GOOD });', 'if (e.code === "PT404") return reply(410, { error: "used" });'],
  ['the reply can be cached', L, '"Cache-Control": "no-store", ', ''],
  ['the object key is in the reply', L, 'return reply(200, { url, expires_in: rel.expires_seconds,', 'return reply(200, { url, object_key: rel.object_key, expires_in: rel.expires_seconds,'],
  ['the link lives longer than 15 minutes', L, 'const url = await deps.presign(rel.object_key, rel.expires_seconds, rel.file_name);', 'const url = await deps.presign(rel.object_key, 86400, rel.file_name);'],
  ['the token is logged on a failure', L, 'console.error("app-link sign failed");', 'console.error("app-link sign failed " + token);'],
  ['the invite always gets the link when the switch is on', S, 'if (body.include_app_link === true) {', 'if (true) {'],
  ['the switch is ignored', S, 'if (!deps.appLink?.enabled()) appLink = "off";', 'if (false) appLink = "off";'],
  ['the token goes in the query string', S, 'return `${siteUrl.replace(/\\/$/, "")}/get-app/#t=${encodeURIComponent(token)}`;', 'return `${siteUrl.replace(/\\/$/, "")}/get-app/?t=${encodeURIComponent(token)}`;'],
  ['a failed link aborts the invite', S, 'catch { console.error("send-invite app link failed"); appLink = "failed"; }', 'catch (e) { throw e; }'],
  ['the error text is logged', S, 'catch { console.error("send-invite app link failed"); appLink = "failed"; }', 'catch (e) { console.error("send-invite app link failed " + (e as Error).message); appLink = "failed"; }'],
  ['the email always carries the app paragraph', S, '...(app ? [', '...(true ? ['],
  ['the approved signature is no longer last', S, '"The Ryagram Team",', '"The Ryagram Team", "P.S. get the app",'],
  ['the token is in the answer to the admin page', S, 'app_link: appLink,', 'app_link: appLink, token: app?.url,'],
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
