// Must-fail proof for tests/ryagram-look.test.mjs (WEB, 2026-11-15): each mutant breaks ONE thing in a scratch copy and the suite must then FAIL. Baseline must PASS first. Run: node tests/ryagram_look_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-look');
const CSS = 'assets/ryagram-look.css';
const mutants = [
  ['the accent is not the waiting page accent', CSS, '--accent:#ff8a3d;', '--accent:#1b6f63;'],
  ['the page colour drifts', CSS, '--bg:#14141a;', '--bg:#15151b;'],
  ['the panel colour drifts', CSS, '--paper:#1b1b23;', '--paper:#ffffff;'],
  ['the old brand token is left on teal', CSS, '--brand:#ff8a3d;', '--brand:#6fd1bd;'],
  ['the radius drifts', CSS, '--radius:18px;', '--radius:6px;'],
  ['the sheet writes words onto the page', CSS, 'body.ryagram-look .state{', 'body.ryagram-look .state::after{content:"x"}\nbody.ryagram-look .state{'],
  ['the sheet pulls something from outside', CSS, 'body.ryagram-look ::placeholder{', 'body.ryagram-look{background-image:url(https://example.com/a.png)}\nbody.ryagram-look ::placeholder{'],
  ['the accent colour is written outside a token', CSS, 'body.ryagram-look .button.danger{', 'body.ryagram-look .tag{border-color:#ff8a3d}\nbody.ryagram-look .button.danger{'],
  ['one page links an older stamp', 'help/index.html', 'ryagram-look.css?v=20261115a', 'ryagram-look.css?v=20261023a'],
  ['one page links the sheet twice', 'report/index.html', '<link rel="stylesheet" href="/assets/ryagram-look.css?v=20261115a">', '<link rel="stylesheet" href="/assets/ryagram-look.css?v=20261115a"><link rel="stylesheet" href="/assets/ryagram-look.css?v=20261115a">'],
  ['another sheet redefines the accent for the look', 'assets/help.css', '.help-main{max-width:760px;', 'body.ryagram-look{--accent:#00ff00;}\n.help-main{max-width:760px;'],
];
function run(cwd) { return spawnSync(process.execPath, ['--test', path.join('tests', 'ryagram-look.test.mjs')], { encoding: 'utf8', cwd }); }
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true }); fs.mkdirSync(scratch, { recursive: true });
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (/^(node_modules|\.git|\.claude|\.mut[\w-]*)$/.test(e.name)) continue;
    fs.cpSync(path.join(root, e.name), path.join(scratch, e.name), { recursive: true });
  }
}
fresh();
if (run(scratch).status) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to] of mutants) {
  fresh();
  const target = path.join(scratch, file), src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  if (!src.includes(from)) { console.log(`BROKEN MUTANT (text not found): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
