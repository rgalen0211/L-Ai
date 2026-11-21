// Must-fail proof for tests/site-pages.test.mjs (WEB 11-20, the Admin page and the film cards): each mutant breaks ONE thing in a scratch copy and the test must then FAIL. Baseline first. Run: node tests/site_pages_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-sp');
const SUITES = ['site-pages.test.mjs'];
const SP = 'assets/app-site.js', LB = 'assets/app-library.js';
const mutants = [
  ["a group with no page is still drawn", SP, '.filter(s => s.items.length)', ''],
  ["an admin page lands in no group", SP, "const GROUPS = ['People', 'Films', 'Computers'];", "const GROUPS = ['People', 'Films'];"],
  ["the Admin page has no way back", SP, "h('p', { class: 'meta' }, h('a', { href: '#/' }, 'Back to your projects'))", "null"],
  ["the empty Admin page says nothing", SP, "h('p', { class: 'form-intro' }, 'No admin pages are switched on.')", "h('span', {}, '')"],
  ["a card with no title gets no mark", SP, "String(project.title || '?').trim().slice(0, 1).toUpperCase() || '?'", "String(project.title).trim().slice(0, 1).toUpperCase()"],
  ["a card links somewhere else", SP, "h('h3', {}, h('a', { href: `#/p/${project.id}` }, project.title))", "h('h3', {}, h('a', { href: `#/v/${project.id}` }, project.title))"],
  ["the contact sheet comes before the thumbnail", SP, "arts.find(x => x.kind === 'thumbnail') || arts.find(x => x.kind === 'contact_sheet')", "arts.find(x => x.kind === 'contact_sheet') || arts.find(x => x.kind === 'thumbnail')"],
  ["a preview is drawn as a picture", SP, "arts.find(x => x.kind === 'thumbnail') || arts.find(x => x.kind === 'contact_sheet')", "arts.find(x => x.kind === 'thumbnail') || arts.find(x => x.kind === 'contact_sheet') || arts.find(x => x.kind === 'preview')"],
  ["a read that fails breaks the page", SP, '} catch { url = null; }', '} finally { }'],
  ["more than two reads at once", SP, 'while (running < 2 && queue.length)', 'while (running < 9 && queue.length)'],
  ["a film is read again every time", SP, 'if (hit !== undefined) return hit;', ''],
  ["a card that left the page is touched", SP, 'if (url && li.isConnected)', 'if (url)'],
    ["everything is read at once, near the screen or not", SP, "if (typeof IntersectionObserver !== 'function') { load(); return; }", "load(); return;"],
  ["a reached card stays observed", SP, "shared.unobserve(e.target); waiting.delete(e.target);", "waiting.delete(e.target);"],
  ["an observer for every card", SP, "if (!shared) shared = new IntersectionObserver(", "shared = new IntersectionObserver("],
  ["an address is kept for ever", SP, "m.set(k, { v, until: now() + (v ? ttlMs : failMs) });", "m.set(k, { v, until: Infinity });"],
  ["a failed read is kept as long as an address", SP, "(v ? ttlMs : failMs)", "ttlMs"],
  ["the cache grows without end", SP, "if (m.size > 200) m.delete(m.keys().next().value);", ""],
  ["an expired address is still used", SP, "if (now() > e.until) { m.delete(k); return undefined; }", ""],
  ["the Admin link is a menu again", LB, "menu = h('a', { class: 'menu-link admin-link', href: '#/admin', role: 'menuitem' }, 'Admin');", "menu = h('details', { class: 'admin-menu' }, h('summary', {}, 'Admin'));"],
  ["the Admin page opens for anyone", LB, "hash === '#/admin' && await data.isAppAdmin()", "hash === '#/admin'"],
  ["an admin page is missing from the Admin page", LB, "['#/admin/visits', 'Visits and signups',", "['#/admin/visitz', 'Visits and signups',"],
  ["the logo does not go home", LB, "brand.setAttribute('href', '#/');", ""],
  ["the logo stays home after sign-out", LB, "if (brand && brandWas) brand.setAttribute('href', brandWas);", ""],
  ["the brand label is renamed again", LB, "brand.setAttribute('href', '#/'); }", "brand.setAttribute('href', '#/'); brand.setAttribute('aria-label', 'Ryagram, your projects'); }"],
  ["the home page is not built from the card module", LB, 'S.filmCard({ h, project: p,', 'S.filmCardX({ h, project: p,'],
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
