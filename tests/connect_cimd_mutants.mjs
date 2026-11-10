// Must-fail proof for tests/connect-cimd.test.mjs and tests/connect-oauth.test.mjs ("Use Claude's published identity": the document checks, the exact allowlist, the real fetch, the metadata flag, the switch): each mutant
// breaks ONE rule in a scratch copy and the suites must then FAIL. A baseline run on the unbroken copy must PASS first, and every text must occur exactly once (a pattern that no longer matches is BROKEN, never "caught").
// The SQL half has its own runner: tests/cimd_sql_mutants.py.
// Run:  node tests/connect_cimd_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-cimd');
const CI = 'supabase/functions/connect-core/cimd.ts', OA = 'supabase/functions/connect-core/oauth.ts', IX = 'supabase/functions/connect/index.ts', DB = 'supabase/functions/connect/db.ts';
const SUITES = ['connect-cimd.test.mjs', 'connect-oauth.test.mjs'];
const mutants = [
  // ---- the document checks
  ['a document that did not answer 200 is accepted', CI, 'if (res.status !== 200) return', 'if (false) return'],
  ['a document that is not JSON is accepted', CI, 'if (!/^application', 'if (false && !/^application'],
  ['a document of any size is accepted', CI, '.byteLength > CIMD_MAX_BYTES) return', '.byteLength > 1e9) return'],
  ['a document naming another client_id is accepted', CI, 'if (doc.client_id !== url) return', 'if (false) return'],
  ['a document with no or too many redirect addresses is accepted', CI, 'if (!Array.isArray(uris) || uris.length < 1 || uris.length > 5 ||', 'if (!Array.isArray(uris) ||'],
  ['a redirect address the sign-in did not ask for is accepted', CI, 'if (!uris.includes(requestedRedirect)) return', 'if (false) return'],
  ['a confidential client (any auth method) is accepted', CI, 'if (method !== undefined && method !== "none") return', 'if (false) return'],
  ['a document carrying a secret or keys is accepted', CI, 'if ("client_secret" in doc || "jwks" in doc || "jwks_uri" in doc) return', 'if (false) return'],
  // ---- the real fetch
  ['the real fetch follows a redirect', CI, 'redirect: "manual"', 'redirect: "follow"'],
  ['the real fetch has no time limit', CI, ', signal: AbortSignal.timeout(CIMD_TIMEOUT_MS)', ''],
  ['the real fetch fetches an address that is not https', CI, 'if (!/^https:\\/\\//.test(url)) return', 'if (false) return'],
  ['the real fetch reads a document of any size', CI, 'if (n > CIMD_MAX_BYTES) {', 'if (n > 1e9) {'],
  ['the real fetch throws on a network failure', CI, '  } catch {\n    return { status: 0, contentType: null, text: null };\n  }\n};', '  } finally {}\n};'],
  // ---- who is fetched at all
  ['an address that is not on the allowlist is fetched', OA, '|| !d.cimd.allowed.has(clientId)) return NOT_REGISTERED;', ') return NOT_REGISTERED;'],
  ['a failed fetch or a bad document does not stop the sign-in', OA, 'if (!res.ok) return "The assistant', 'if (false) return "The assistant'],
  ['a refused registration does not stop the sign-in', OA, 'catch (e) { return WHY[code(e)] ?? NOT_REGISTERED; }', 'catch (e) { /* ignored */ }'],
  ['a refused registration is remembered', OA, '  try { await d.store.registerCimdClient(clientId, res.redirectUris); }', '  rememberRedirects(clientId, res.redirectUris);\n  try { await d.store.registerCimdClient(clientId, res.redirectUris); }'],
  ['the cache hands out a redirect address it never held', CI, 'hit.until > now && hit.uris.includes(redirect) ? hit.uris : null', 'hit.until > now ? hit.uris : null'],
  ['the cache never expires', CI, 'hit.until > now &&', 'true &&'],
  // ---- the metadata and the switch
  ['the metadata advertises the support even when it is off', OA, '...(cimd ? { client_id_metadata_document_supported: true } : {}),', '...({ client_id_metadata_document_supported: true }),'],
  ['the support is advertised in only one of the two documents', OA, '...authorizationServerMetadata(base, cimd),', '...authorizationServerMetadata(base, false),'],
  ['the metadata documents are built without the switch', OA, 'authorizationServerMetadata(d.baseUrl, !!d.cimd))', 'authorizationServerMetadata(d.baseUrl, true))'],
  ['CIMD is on by default', IX, '.trim().toLowerCase() === "on";', '.trim().toLowerCase() !== "off";'],
  ['the allowlist handed to the server holds more than Claude', CI, 'new Set(["https://claude.ai/oauth/mcp-oauth-client-metadata"])', 'new Set(["https://claude.ai/oauth/mcp-oauth-client-metadata", "https://evil.example/doc"])'],
  ['the database adapter calls another function', DB, '"connect_cimd_client"', '"connect_register_client"'],
];
function run(cwd) {
  return spawnSync(process.execPath, ['--test', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd });
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  for (const d of ['supabase/functions', 'supabase/migrations', 'tests', 'tools']) fs.cpSync(path.join(root, d), path.join(scratch, d), { recursive: true });
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
  const n = src.split(from).length - 1;
  if (n !== 1 || from === to) { console.log(`BROKEN MUTANT (text found ${n} times, need 1, or no change): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const r = run(scratch);
  const caught = r.status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught or broken` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
