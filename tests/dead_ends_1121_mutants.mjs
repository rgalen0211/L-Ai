// Must-fail proof for tests/dead-ends-1121.test.mjs (WEB dead-end sweep 11-21): each mutant puts ONE sweep fault back in a scratch copy and the test must then FAIL. Baseline first. Run: node tests/dead_ends_1121_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-de');
const SUITES = ['dead-ends-1121.test.mjs'];
const DP = 'assets/app-departments.js';
const SM = 'assets/app-start.js';
const ED = 'assets/app-editor.js';
const mutants = [
  ["row 1: the Data films page shows the AI heading and #/start link to every account", DP, 'const aiBlock = invited ?', 'const aiBlock = true ?'],
  ["row 1: a failing connect check counts as invited", SM, 'catch { return false; } }', 'catch { return true; } }'],
  ["row 1: the strip no longer uses the shared gate", SM, 'if (!(await canStart(data))) return null;', 'if (false) return null;'],
  ["row 2: the sign-up button is drawn for an account that is not invited", DP, "if (!invited) { area.replaceChildren(", "if (false) { area.replaceChildren("],
  ["row 2: the invited-only line promises a retry", DP, "invitedOnly: 'Sign-up for this is for invited accounts for now.'", "invitedOnly: 'Sign-up for this is for invited accounts for now. Try again in a minute.'"],
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
  fs.cpSync(path.join(root, 'app'), path.join(scratch, 'app'), { recursive: true });
  fs.cpSync(path.join(root, 'help'), path.join(scratch, 'help'), { recursive: true });
  fs.copyFileSync(path.join(root, '.gitattributes'), path.join(scratch, '.gitattributes'));
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
fresh();
const base = run(scratch).status;
if (base) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
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
