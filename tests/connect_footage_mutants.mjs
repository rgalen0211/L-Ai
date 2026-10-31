// Must-fail proof for tests/connect-footage-tool.test.mjs (NEXT-CONNECT 168): each mutant breaks ONE thing in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first. Run:  node tests/connect_footage_mutants.mjs   (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-ft');
const C = 'supabase/functions/connect-core/';
const T = C + 'tools.ts', Y = C + 'types.ts';
const SUITES = ['connect-footage-tool.test.mjs'];
const mutants = [
  ['the tool is listed', T, 'scope: "fetch_data", readOnly: false, idempotent: false, listed: false,', 'scope: "fetch_data", readOnly: false, idempotent: false,'],
  ['the switch is ignored (the tool works with nothing wired)', T, 'if (!sw || !(await sw.enabled())) {', 'if (false) {'],
  ['a switch that says no is ignored', T, '!(await sw.enabled())', 'false'],
  ['the item id is not checked', T, 'if (!FOOTAGE_ID[source]?.test(itemId))', 'if (false)'],
  ['an address in the reason is written', T, '    if (/https?:', '    if (false && /https?:'],
  ['the daily limit is gone', T, 'if (!(await ctx.policy.hit(ctx.principal, "footage", LIMITS.footagePlansPerDayPerUser, 86400))) {', 'if (false) {'],
  ['the tool needs only read permission', T, 'title: "Ask for public-domain footage", scope: "fetch_data"', 'title: "Ask for public-domain footage", scope: "read"'],
  ['the plan carries more than three fields', T, 'const r = await sw.request({ source, item_id: itemId, why });', 'const r = await sw.request({ source, item_id: itemId, why, url: String((a as { url?: unknown }).url ?? "") });'],
  ['the answer does not say nothing is downloaded', T, 'Nothing is downloaded until they press Approve, and you never receive the video.', 'It is queued.'],
  ['another source is accepted', T, 'enum: ["nasa", "nara"], description: "nasa = NASA', 'enum: ["nasa", "nara", "youtube"], description: "nasa = NASA'],
  ['the refusal does not say nothing was written', T, 'Nothing was written down. The person can download a film themselves', 'The person can download a film themselves'],
  ['the daily limit is far too high', Y, 'footagePlansPerDayPerUser: 20,', 'footagePlansPerDayPerUser: 2000,'],
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
