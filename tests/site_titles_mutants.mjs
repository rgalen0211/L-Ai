// Must-fail proof for tests/site-titles.test.mjs (WEB 11-20, tab titles and ways back): each mutant breaks ONE thing in a scratch copy and the test must then FAIL. Baseline first. Run: node tests/site_titles_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-st');
const SUITES = ['site-titles.test.mjs'];
const LB = 'assets/app-library.js';
const mutants = [
  ["the tab keeps the old title", LB, "document.title = h1 && h1.textContent.trim() ? `${h1.textContent.trim()} | Ryagram` : 'Ryagram | L’Ai';", "void 0;"],
  ["a blank heading makes a blank title", LB, "h1 && h1.textContent.trim() ? `${h1.textContent.trim()} | Ryagram`", "h1 ? `${h1.textContent.trim()} | Ryagram`"],
  ["the title has no product", LB, "`${h1.textContent.trim()} | Ryagram`", "`${h1.textContent.trim()}`"],
  ["an admin page goes back to the user home", LB, "first.setAttribute('href', '#/admin');", ""],
  ["the admin back link keeps its old words", LB, "first.textContent = '← Admin';", ""],
  ["every page gets a second way back", LB, "if (!first && !isHome && h1 && !root.querySelector('a[href=\"#/\"]'))", "if (!first && !isHome && h1)"],
  ["the home page gets a way back to itself", LB, "const isHome = hash === '' || hash === '#/' || hash === '#';", "const isHome = false;"],
  ["a page with its own back link gets another", LB, "if (!first && !isHome", "if (!isHome"],
  ["sign-out leaves the page title", LB, "stopAdminNav(); document.title = titleWas;", "stopAdminNav();"],
  ["the polish never runs", LB, "polishPage(hash);\n      root.querySelector", "root.querySelector"],
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
