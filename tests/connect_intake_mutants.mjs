// Must-fail proof for tests/connect-intake.test.mjs (NEXT-CONNECT 153): each mutant breaks ONE thing in a scratch copy of the connector code and the suite must then FAIL. A baseline run on the unbroken copy must PASS first.
// Run:  node tests/connect_intake_mutants.mjs   (exit 0 only when every mutant is caught)
// The intake is a pure function; there is no SQL half.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-in');
const C = 'supabase/functions/connect-core/';
const N = 'supabase/functions/node-core/';
const TOOLS = ['connect-intake.test.mjs'];
const I = C + 'intake.ts';
const mutants = [
  ['the scale is asked even when known', I, 'if (k.scale === undefined) {', 'if (true) {'],
  ['the place is asked even when known', I, 'if (k.place === undefined) {', 'if (true) {'],
  ['the dataset is asked even when known', I, 'if (k.dataset === undefined) {', 'if (true) {'],
  ['the years are asked even when known', I, 'if (k.years === undefined) {', 'if (true) {'],
  ['the picture is asked even when known', I, 'if (k.picture === undefined) {', 'if (true) {'],
  ['the app is asked even when known', I, 'if (k.have_app === undefined) {', 'if (true) {'],
  ['the folders are asked even when known', I, 'if (k.folders_named === undefined) {', 'if (true) {'],
  ['phrase or song is asked even when known', I, 'if (k.chose === undefined) {', 'if (true) {'],
  ['the kind is asked even when it can be read from the opening', I, '  if (k.scale !== undefined || k.place !== undefined || k.dataset !== undefined || k.years !== undefined || k.picture !== undefined) return "data_film";', ''],
  ['the globe is accepted as a picture', I, '  if (k.picture === "globe") {', '  if (false) {'],
  ['the globe is offered for a county film', I, 'county: ["county_map", "prism_map", "line", "bars"],', 'county: ["county_map", "prism_map", "line", "bars", "globe"],'],
  ['a city or world picture is accepted', I, '  if (k.scale !== "county" && k.scale !== "state") {', '  if (false) {'],
  ['a picture that does not fit the scale is accepted', I, '  if (!allowed.includes(k.picture)) {', '  if (false) {'],
  ['the final step tells the AI to ask again', I, 'then: "Do NOT ask the person anything else they already told you. Call get_story_schema', 'then: "Ask the person to confirm each detail again. Call get_story_schema'],
  ['a department that is not built is started', I, 'say: "That part of Ryagram is coming soon. It is not available yet, and nothing can be started in it today."', 'say: "That part of Ryagram is ready."'],
  ['the compilation is not pointed at the desktop app', I, 'by the Ryagram desktop app for Windows. Do you have the app?', 'by Ryagram. Do you have it?'],
  ['free text from the AI is echoed back', C + 'tools.ts', 'already_known: step.known });', 'already_known: step.known, echo: (a as { place?: string }).place });'],
  ['the tool is not read-only', C + 'tools.ts', 'title: "What to ask the person next", scope: "read", readOnly: true,', 'title: "What to ask the person next", scope: "read", readOnly: false,'],
  ['the instructions lose the never-ask-again rule', C + 'mcp.ts', 'never ask for something they already told you, even in their first message: pass what they said to suggest_next_step and put only the one question it returns. ', ''],
  ['the instructions lose the coming-soon rule', C + 'mcp.ts', 'Offer only what Ryagram draws today and say plainly what is coming soon (the 3D interactive globe is). ', ''],
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
const base = [run(scratch, TOOLS)].find((r) => r.status !== 0);
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
