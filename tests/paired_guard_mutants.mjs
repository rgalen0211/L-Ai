// Must-fail proof for tests/paired-guard.test.mjs and the paired cases in tests/ai-editor.test.mjs and tests/app-templates.test.cjs (WEB, launch slice IN 2): each mutant breaks ONE thing in a scratch copy
// and the suites must then FAIL. A baseline run on the unbroken copy must PASS first. Run:  node tests/paired_guard_mutants.mjs   (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-pg');
const SUITES = ['paired-guard.test.mjs', 'ai-editor.test.mjs', 'app-templates.test.cjs'];
const TPL = 'assets/app-templates.js', LIB = 'assets/app-library.js', TS = 'supabase/functions/_shared/templates.ts', TOOLS = 'supabase/functions/ai-editor/tools.ts';
const mutants = [
  ['the page builds the paired template again', TPL, "if (t.unmeasured) throw new Error(", "if (false) throw new Error("],
  ['the page builds a paired catalog story again', TPL, "if (info.view === 'paired' || info.view === 'panel') throw new Error(", "if (false) throw new Error("],
  ['the page lets a panel catalog story through', TPL, "if (info.view === 'paired' || info.view === 'panel') throw new Error(", "if (info.view === 'paired') throw new Error("],
  ['the page picker offers the paired template again', LIB, "T.TEMPLATES.filter(t => !t.unmeasured).filter(", "T.TEMPLATES.filter("],
  ['the template is no longer marked', TPL, "      unmeasured: true },", "      },"],
  ['the AI editor can draft the paired template', TOOLS, "?.unmeasured) return { text: UNMEASURED_WORDS, isError: true };", "?.unmeasured) return { text: '', isError: false };"],
  ['the AI editor tool list offers the paired template', TOOLS, "enum: TEMPLATES.filter((t) => !(t as { unmeasured?: boolean }).unmeasured).map((t) => t.id)", "enum: TEMPLATES.map((t) => t.id)"],
  ['a saved story is not checked for keyframes_per_year', TOOLS, '(c as { view?: unknown }).view === "panel")\n        && !(st', '(c as { view?: unknown }).view === "panel") && false\n        && !(st'],
  ['any settings object counts as measured', TOOLS, '!(st && typeof st === "object" && Number.isInteger((st as { keyframes_per_year?: unknown }).keyframes_per_year))', '!(st && typeof st === "object")'],
  ['a map view is refused too', TOOLS, '(c as { view?: unknown }).view === "paired" || (c as { view?: unknown }).view === "panel")', '(c as { view?: unknown }).view === "paired" || (c as { view?: unknown }).view === "panel" || (c as { view?: unknown }).view === "map")'],
  ['the refusal does not say what to do instead', TS, 'so use a map, bars or line view, or make this film in the Ryagram app.', 'so it is not possible.'],
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
