// Must-fail proof for tests/departments-mount.test.mjs (WEB 11-20, the departments bar mount and unmount): each mutant breaks ONE thing in a scratch copy and the test must then FAIL. Baseline first. Run: node tests/departments_mount_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-dm');
const SUITES = ['departments-mount.test.mjs'];
const DP = 'assets/app-departments.js';
const mutants = [
  ["a bar asked for during the first wait appears after an unmount", DP, 'if (mine !== mountToken) return false;\n      const m = await load();', 'const m = await load();'],
  ["a bar asked for during the second wait appears after an unmount", DP, 'if (mine !== mountToken || !hasAny(m)) return false;', 'if (!hasAny(m)) return false;'],
  ["unmount does not cancel a bar that is loading", DP, 'const unmountBar = () => { mountToken++; cleanup(); };', 'const unmountBar = () => { cleanup(); };'],
  ["a second ask does not cancel the first", DP, 'const mine = ++mountToken;', 'const mine = mountToken;'],
  ["the media-query listener stays after the bar", DP, 'if (nav.dispose) nav.dispose(); ', ''],
  ["the address listener stays after the bar", DP, "window.removeEventListener('hashchange', onHash); ", ''],
  ["the outside-click listener stays after the bar", DP, "document.removeEventListener('click', onOutside); if (nav.dispose)", "if (nav.dispose)"],
  ["the page keeps the bar's mark after the bar", DP, "document.body.classList.remove('has-departments'); slot.replaceChildren(); slot.hidden = true; };\n      return true;", "slot.replaceChildren(); slot.hidden = true; };\n      return true;"],
  ["a non-invited account has no bar", DP, "try { invited = (await data.connectAccess()) === true; } catch { invited = false; }", "invited = (await data.connectAccess()) === true; if (!invited) return false;"],
  ["a non-invited account gets Start", DP, 'const items = invited ?', 'const items = true ?'],
  ["a failing list leaves no bar", DP, 'if (!hasAny(model)) { model = normalize(FALLBACK); }', ''],
  ["the bar mounts without the flag", DP, 'if (!slot || !flagOn()) return false;', 'if (!slot) return false;'],
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
