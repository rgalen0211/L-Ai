// Must-fail proof for tests/connect-download-tools.test.mjs and tests/node-download-plans.test.mjs (NEXT-CONNECT 152): each mutant breaks ONE thing in a scratch copy of the connector / node code and the named
// suite(s) must then FAIL. A baseline run on the unbroken copy must PASS first. Run:  node tests/connect_download_mutants.mjs   (exit 0 only when every mutant is caught)
// The SQL half is the authority and has its own mutants (supabase/tests/test_node_download_plans.py with DOWNLOAD_PLANS_SQL).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-dl');
const C = 'supabase/functions/connect-core/';
const N = 'supabase/functions/node-core/';
const TOOLS = ['connect-download-tools.test.mjs'];
const NODE = ['node-download-plans.test.mjs'];
const mutants = [
  ['request_download needs only read', C + 'tools.ts', 'title: "Ask to download a public data file", scope: "fetch_data"', 'title: "Ask to download a public data file", scope: "read"'],
  ['list_my_downloads needs fetch_data', C + 'tools.ts', 'title: "See my download requests", scope: "read"', 'title: "See my download requests", scope: "fetch_data"'],
  ['the address is not checked before it is written', C + 'tools.ts', 'if (bad) return refuse(bad + " Nothing was written.", "args");', 'if (false) return refuse(bad + " Nothing was written.", "args");'],
  ['http is accepted', C + 'tools.ts', 'if (p.protocol !== "https:")', 'if (false)'],
  ['a user name in the address is accepted', C + 'tools.ts', 'if (p.username || p.password || u.includes("@"))', 'if (false)'],
  ['a port is accepted', C + 'tools.ts', 'if (p.port) return', 'if (false) return'],
  ['a bare IP number is accepted', C + 'tools.ts', '|| /^[0-9.]+$/.test(p.hostname)', ''],
  ['non-visible characters are accepted in the address', C + 'tools.ts', '|| /[^\\x21-\\x7e]/.test(u)', ''],
  ['the host is shown without the untrusted wrapper', C + 'tools.ts', 'untrusted("download-host", r.host)', 'r.host'],
  ['the reason is not cleaned', C + 'tools.ts', 'const why = cleanText(a.why, 300);', 'const why = String(a.why);'],
  ['the answer claims the file was fetched', C + 'tools.ts', 'Nothing is downloaded until they press Download on their computer.', 'The file has been downloaded.'],
  ['five waiting is not enforced (stand-in)', C + 'fake.ts', '.length >= 5) throw err("There are already 5 download requests', '.length >= 500) throw err("There are already 5 download requests'],
  ['plans of everyone are listed (stand-in)', C + 'fake.ts', 'listDownloads: async () => u().plans.slice().reverse()', 'listDownloads: async () => [...this.users.values()].flatMap((x) => x.plans).reverse()'],
  ['the database call names another function', 'supabase/functions/connect/db.ts', '"connect_request_download"', '"connect_request_downloads"', ['connect-oauth.test.mjs'], 'every SQL function the server names'],
  ['the scope is not advertised', C + 'rest.ts', 'fetch_data: "Ask the Ryagram desktop app', 'fetch_data_off: "Ask the Ryagram desktop app', ['connect-mcp-sdk.test.mjs'], 'every address the metadata advertises'],
  ['the node route returns finished plans too (stand-in)', N + 'fake.ts', '["waiting", "downloading", "unpacking"].includes(p.state)', 'true', NODE],
  ['the node route returns more than five', N + 'router.ts', '.slice(0, 5).map((r) => ({ id: r.id, request: r.request, state: r.state }))', '.map((r) => ({ id: r.id, request: r.request, state: r.state }))', NODE],
  ['the node route returns the owner id', N + 'router.ts', '.map((r) => ({ id: r.id, request: r.request, state: r.state }))', '.map((r) => ({ id: r.id, request: r.request, state: r.state, owner: (r as { owner?: string }).owner ?? "x" }))', NODE],
  ['an update may set waiting', N + 'router.ts', 'const DL_STATES = ["declined",', 'const DL_STATES = ["waiting", "declined",', NODE],
  ['a receipt may come with any state', N + 'router.ts', ' || b.state !== "done")) return bad();', ')) return bad();', NODE],
  ['the update id is not checked', N + 'router.ts', 'if (typeof b.id !== "string" || !UUID.test(b.id) || typeof b.state', 'if (typeof b.state', NODE],
  ['a missing plan is not "not found"', N + 'router.ts', 'if (r === null || r === undefined) return fail(404, "not_found", "That download request was not found.");', '', NODE],
  ['the database text is shown on a refused receipt', N + 'router.ts', 'return fail(400, "invalid_request", "That download update was not accepted.");', 'return fail(400, "invalid_request", String((e as Error).message));', NODE],
];

function run(cwd, suites, pattern) {
  return spawnSync(process.execPath, ['--test', ...(pattern ? ['--test-name-pattern', pattern] : []), ...suites.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd });
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/migrations'), path.join(scratch, 'supabase/migrations'), { recursive: true });
  fs.cpSync(path.join(root, 'tests'), path.join(scratch, 'tests'), { recursive: true });
  fs.cpSync(path.join(root, 'assets'), path.join(scratch, 'assets'), { recursive: true });
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
fresh();
const base = [run(scratch, TOOLS), run(scratch, NODE), run(scratch, ['connect-oauth.test.mjs'], 'every SQL function the server names'), run(scratch, ['connect-mcp-sdk.test.mjs'], 'every address the metadata advertises')].find((r) => r.status !== 0);
if (base) { console.log('BASELINE FAILS (nothing proved):\n' + base.stdout.slice(-800)); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to, suites, pattern] of mutants) {
  fresh();
  const target = path.join(scratch, file);
  const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  if (!src.includes(from)) { console.log(`BROKEN MUTANT (text not found): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = run(scratch, Array.isArray(suites) ? suites : TOOLS, pattern).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
