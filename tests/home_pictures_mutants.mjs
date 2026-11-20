// Must-fail proof for the home page's film-card pictures and the light picture read (FIXHOME 11-20) over tests/site-pages.test.mjs + tests/site-audit-1120.test.mjs; was: must-fail proof for tests/site-pages.test.mjs (WEB 11-20, the Admin page and the film cards): each mutant breaks ONE thing in a scratch copy and the test must then FAIL. Baseline first. Run: node tests/home_pictures_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-hp');
const SUITES = ['site-pages.test.mjs', 'site-audit-1120.test.mjs'];
const SP = 'assets/app-site.js', LB = 'assets/app-library.js', DT = 'assets/app-data.js';
const mutants = [
  ["a card reads its picture through the heavy getVersion again", SP, 'await data.artifactsFor(versionId)', '(await data.getVersion(versionId)).artifacts'],
  ["an address that stopped working leaves a broken picture", SP, "img.addEventListener('error', () => { seen.drop(version); holder.replaceChildren(letter()); });", ''],
  ["a dropped address is served from the cache again", SP, 'seen.drop(version); holder', 'holder'],
  ["no picture yet is remembered for ten minutes", SP, 'makeCache(10 * 60 * 1000, 30 * 1000)', 'makeCache(10 * 60 * 1000, 10 * 60 * 1000)'],
  ["a good address is kept past its life", SP, 'makeCache(10 * 60 * 1000, 30 * 1000)', 'makeCache(20 * 60 * 1000, 30 * 1000)'],
  ["the light read also returns previews", DT, ".in('kind', ['thumbnail', 'contact_sheet'])", ''],
  ["the light read also returns deleted files", DT, ".is('deleted_at', null).order('created_at', { ascending: false }), 'Couldn’t load the picture.'", ".order('created_at', { ascending: false }), 'Couldn’t load the picture.'"],
  ["the light read returns oldest first", DT, ".order('created_at', { ascending: false }), 'Couldn’t load the picture.'", ".order('created_at', { ascending: true }), 'Couldn’t load the picture.'"],
  ["the light read selects more columns than a card needs", DT, "select('id, kind, storage_path, created_at')", "select('id, kind, storage_path, created_at, job_id')"],
  ["the project list forgets the version id", DT, "client.from('versions').select('id, project_id, number, state')\n            .in('project_id'", "client.from('versions').select('project_id, number, state')\n            .in('project_id'"],
  ["Ask your AI shows for every account on the flag alone", LB, "aiInvited ? h('a', { class: 'button secondary', href: '#/start' }, 'Ask your AI') : null", "startOn() ? h('a', { class: 'button secondary', href: '#/start' }, 'Ask your AI') : null"],
  ["a failed invited check throws instead of drawing nothing", LB, 'await connectAllowed(data).catch(() => false)', 'await connectAllowed(data)'],
  ["a film with no version still asks", SP, "if (version && data && typeof data.artifactsFor", "if (data && typeof data.artifactsFor"],
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
