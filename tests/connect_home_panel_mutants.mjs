// Must-fail proof for tests/connect-home-panel.test.mjs (the Ryagram home panel in the chat): each mutant breaks ONE thing in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every text must occur exactly once. Run:  node tests/connect_home_panel_mutants.mjs   (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-home');
const C = 'supabase/functions/connect-core/';
const SUITES = ['connect-home-panel.test.mjs'];
const HEAD = 'name: "get_story", title: "Read back a project\'s saved story", scope: "read", readOnly: true';
const SC = C + 'story_check.ts';
const H = C + 'home_panel.ts', TL = C + 'tools.ts', DI = C + 'dispatch.ts', MC = C + 'mcp.ts', MA = C + 'mcp_app.ts';
const mutants = [
  ['a working department with no page is shown', H, `if (r.status === "working" && w.page && PAGE.test(w.page))`, `if (r.status === "working")`],
  ['a soon department is given a page to open', H, `starts: [], page: null });`, `starts: [], page: "#/" });`],
  ['a department listed twice is taken twice (the last wins)', H, `!byId.has(r.id)`, `true`],
  ['the site order is not kept', H, `export const HOME_ORDER = ["data_films", "compilations", "geo_intelligence", "games", "animation_studio"] as const;`, `export const HOME_ORDER = ["games", "compilations", "geo_intelligence", "data_films", "animation_studio"] as const;`],
  ['my films is missing', H, `out.push(...working, mine, ...soon);`, `out.push(...working, ...soon);`],
  ['a label over 60 characters is accepted', H, `r.label.length <= 60`, `r.label.length <= 6000`],
  ['the geographic line promises where a business would do well', H, `so it does not say where a business would do well.`, `so it says where a business would do well.`],
  ['a date is promised', H, `No price and no date.`, `No price, due 2027.`],
  ['the compilations line differs from the site', H, `Say a phrase. Ryagram finds every time it is said in your own footage`, `Say a phrase. Ryagram finds the best time it is said in your own footage`],
  ['the page loads a script from outside', H, `<title>Ryagram home</title>`, `<title>Ryagram home</title><script src=\\"https://x.example/a.js\\"></script>`],
  ['the page builds from markup', H, `root.textContent='';`, `root.innerHTML='';`],
  ['any fragment may be opened', H, `function openPage(page){if(appUrl&&PAGE.test(page||'')){`, `function openPage(page){if(appUrl){`],
  ['a host that refuses the message gets nothing', H, `if(r&&r.error){`, `if(false){`],
  ['an address that is not https is put in the page', H, `const link = appUrl && APP_URL.test(appUrl) ? appUrl : "";`, `const link = appUrl ?? "";`],
  ['the tool is listed with its switch off', MC, `&& (!t.homePanel || homePanel)).map(`, `).map(`],
  ['the tool runs with its switch off', DI, `(found.homePanel && !env.homePanel)`, `false`],
  ['the page is served with its switch off', MA, `!(home && cfg.homePanel)`, `!(home)`],
  ['the tool carries no page', MC, `: t.homePanel ? toolUiMeta(HOME_URI) :`, `:`],
  ['my films always opens the projects page', H, `page: filmsOn ? MY_FILMS.pageOn : MY_FILMS.page };`, `page: MY_FILMS.page };`],
  ['my films always opens the films page', H, `page: filmsOn ? MY_FILMS.pageOn : MY_FILMS.page };`, `page: MY_FILMS.pageOn };`],
  ['any switch turns the films page on', H, `switches.includes("myFilms")`, `switches.length > 0`],
  ['a switch list that cannot be read throws', TL, `await ctx.data.switches().catch(() => [] as string[]);`, `await ctx.data.switches();`],
  ['the geographic line is not GEO\'s', H, `Ask about places with free public data: who lives near a spot`, `Ask a map a question: where would a new shop do well, who lives near a spot`],
  ['a score is promised', H, `No score and no ranking of places.`, `A score for every place.`],
  ['a database that cannot answer throws', TL, `const rows = await ctx.data.departments().catch(() => null);`, `const rows = await ctx.data.departments();`],
  ['the tool is not read-only', TL, `scope: "read", readOnly: true, idempotent: true, homePanel: true,`, `scope: "read", readOnly: false, idempotent: true, homePanel: true,`],
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
