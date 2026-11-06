// Must-fail proof for tests/connect-tools-hostile.test.mjs (the hostile-arguments sweep of every tool): each mutant breaks ONE guard in a scratch copy and the sweep must then FAIL. Baseline first. Run:  node tests/connect_tools_hostile_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-hostile');
const C = 'supabase/functions/connect-core/';
const D = C + 'dispatch.ts', T = C + 'tools.ts';
// Dropped as EQUIVALENT under this sweep, with the reason: removing the gate's catch of a throwing tool, or the friendly error text, or the check that arguments are an object, changes nothing the sweep can see, because the schema check in front
// of every tool already refuses what would make one throw (the three combined mutants below remove that check first, and are caught).
const SUITES = ['connect-tools-hostile.test.mjs'];
const CATCH = '} catch (e) {NL    return finish({ text: friendlyError(e), isError: true, code: "error" }, "error", "tool_error");NL  }';
const RETHROW = '} catch (e) {NL    throw e;NL  }';
const mutants = [
  ['the argument check is skipped', [[D, 'if (problems.length) return refused(', 'if (false) return refused(']]],
  ['the argument check is skipped and a throwing tool is not caught', [[D, 'if (problems.length) return refused(', 'if (false) return refused('], [D, CATCH, RETHROW]]],
  ['the argument check is skipped and an error message is shown whatever it says', [[D, 'if (problems.length) return refused(', 'if (false) return refused('], [T, 'if (!own || msg.length > 300) return "Ryagram could not do that right now. Nothing was changed. Try again in a moment.";', 'if (false) return "x";']]],
].map(([n, e]) => [n, e.map(([f, a, b]) => [f, a.replaceAll('NL', String.fromCharCode(10)), b.replaceAll('NL', String.fromCharCode(10))])]);

function run(cwd) {
  return spawnSync(process.execPath, ['--test', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd });
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
function cleanup() { fs.rmSync(scratch, { recursive: true, force: true }); }          // the scratch copy sits inside the repo, so node finds the repo's node_modules by itself; nothing is linked
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
    if (!src.includes(from)) { console.log(`BROKEN MUTANT (text not found): ${name}`); missed++; broken = true; break; }
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
