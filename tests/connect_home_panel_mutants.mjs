// Must-fail proof for tests/connect-home-panel.test.mjs (the Ryagram home panel in the chat): each mutant breaks ONE thing in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every text must occur exactly once. A mutant is 'source' (the offline suite must FAIL) or 'browser' (the real-Chrome check tools/check-home-panel.py must FAIL with a failed check or a missing element,
// never a crash of its own). Run:  node tests/connect_home_panel_mutants.mjs [--no-browser]   (exit 0 only when every mutant is caught; the browser needs Chrome and playwright, TEMP on D:)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// a planted fault that makes a suite HANG must end the run loudly, never stall it (node:test has no time limit of its own); a timeout is neither "caught" nor "missed" (11-20 audit)
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suites did not end in 5 minutes (' + (r.error ? r.error.code : 'a test timed out') + '; a test that hangs for 2 minutes fails by itself, so this means a synchronous loop, and its node child may still be running: end it by its own PID): write the fault so a test fails, not hangs'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-home');
const C = 'supabase/functions/connect-core/';
const SUITES = ['connect-home-panel.test.mjs'];
const HEAD = 'name: "get_story", title: "Read back a project\'s saved story", scope: "read", readOnly: true';
const SC = C + 'story_check.ts';
const F = C + 'fake.ts';
const H = C + 'home_panel.ts', TL = C + 'tools.ts', DI = C + 'dispatch.ts', MC = C + 'mcp.ts', MA = C + 'mcp_app.ts';
const mutants = [
  ['a working department with no page is shown', H, `if (r.status === "working" && w.page && PAGE.test(w.page))`, `if (r.status === "working")`],
  ['a soon department is given a page to open', H, `starts: [], page: null });`, `starts: [], page: "#/" });`],
  ['a department listed twice is taken twice (the last wins)', H, `!byId.has(r.id)`, `true`],
  ['the site order is not kept', H, `export const HOME_ORDER = ["data_films", "compilations", "geo_intelligence", "games", "animation_studio", "studio"] as const;`, `export const HOME_ORDER = ["games", "compilations", "geo_intelligence", "data_films", "animation_studio", "studio"] as const;`],
  // Studio (Q639): the department the database lists last, shown as Coming soon with Ryan's own words and nothing to press
  ['Studio is not last in the order', H, `"games", "animation_studio", "studio"] as const;`, `"games", "studio", "animation_studio"] as const;`],
  ['Studio is left out of the order, so it is never shown', H, `"games", "animation_studio", "studio"] as const;`, `"games", "animation_studio"] as const;`],
  ['Studio has no words, so the panel drops it', H, `  studio: { label: "Studio", line: "Your podcast’s`, `  studio_off: { label: "Studio", line: "Your podcast’s`],
  ['Studio says a price', H, `finds the moments worth sharing.",`, `finds the moments worth sharing, from $9 a month.",`],
  ['Studio names a competitor', H, `Your podcast’s camera crew and editor in one:`, `Your podcast’s camera crew and editor in one, like Riverside:`],
  ['Studio promises live switching', H, `cuts to the right camera as people talk,`, `cuts to the right camera live as people talk,`],
  ['Studio drops the not-built sentence', H, `    notYet: ["Not built yet: none of this works today, there is no price and no date."] },`, `    notYet: [] },`],
  ['Studio is given a page to open, a dead link for a department that is not built', H, `  studio: { label: "Studio", line:`, `  studio: { page: "#/d/studio", label: "Studio", line:`],
  ['Studio is given a line to start in the chat', H, `  studio: { label: "Studio", line:`, `  studio: { starts: ["Make me a podcast cut."], label: "Studio", line:`],
  ['the stand-in database lists no Studio, so the panel test never sees it', F, `{ id: "animation_studio", label: "Animation Studio", status: "soon" }, { id: "studio", label: "Studio", status: "soon" }];`, `{ id: "animation_studio", label: "Animation Studio", status: "soon" }];`],
  ['my films is missing', H, `out.push(...working, mine, ...soon);`, `out.push(...working, ...soon);`],
  ['the panel takes the database label', H, `const label = w.label;`, `const label = r.label;`],
  ['the geographic line promises where a business would do well', H, `so it does not say where a business would do well.`, `so it says where a business would do well.`],
  ['a date is promised', H, `No price and no date.`, `No price, due 2027.`],
  ['the compilations line differs from the site', H, `Say a phrase. Ryagram finds every time it is said in your own footage`, `Say a phrase. Ryagram finds the best time it is said in your own footage`],
  ['the page loads a script from outside', H, `<title>Ryagram home</title>`, `<title>Ryagram home</title><script src=\\"https://x.example/a.js\\"></script>`],
  ['the page builds from markup', H, `root.textContent='';`, `root.innerHTML='';`],
  ['any fragment may be opened', H, `function openPage(page){if(appUrl&&PAGE.test(page||'')){`, `function openPage(page){if(appUrl){`],
  // The refusal: the line comes back as an EXAMPLE, the host's words are kept, the message goes in the shape the spec's types give.
  ['a host that refuses the message gets nothing', H, `if(!refused(r))return;`, `if(true)return;`, 'browser'],
  ['a result that says isError is taken for success', H, `r.error||(r.result&&r.result.isError===true)`, `r.error`, 'browser'],
  ['the message goes as one block, not a list', H, `content:[{type:'text',text:text}]},function(r){got(r,true);}`, `content:{type:'text',text:text}},function(r){got(r,true);}`, 'browser'],
  ['a host that calls the list shape invalid is not asked again', H, `(e.code===-32602||/invalid|format/i.test(String(e.message||'')))`, `false`, 'browser'],
  ['every refusal is asked again', H, `(e.code===-32602||/invalid|format/i.test(String(e.message||'')))`, `true`, 'browser'],
  ['a host without the message capability is still sent the message', H, `function canSend(){return !(caps&&typeof caps==='object'&&!caps.message);}`, `function canSend(){return true;}`, 'browser'],
  ['the button says it will start the chat on a host that cannot', H, `canSend()?'Start this in the chat':'Show what to say'`, `'Start this in the chat'`, 'browser'],
  ['the host\'s answer is not shown', H, `'The chat app answered: '+said(r));`, `'');`, 'browser'],
  ['the host\'s answer is not written to the console', H, `try{console.warn('ryagram-home: ui/message refused: '+JSON.stringify(r.error||r.result).slice(0,300));}catch(x){}`, ``, 'browser'],
  ['the example has a dashed box again', H, `.example{margin:8px 0 0;padding:2px 0 2px 12px;border:0;border-left:3px solid #ff8a3d;`, `.example{margin:8px 0 0;padding:2px 0 2px 12px;border:1px dashed #3a3a44;border-left:3px solid #ff8a3d;`, 'browser'],
  ['the example has no left bar', H, `border:0;border-left:3px solid #ff8a3d;`, `border:0;`, 'browser'],
  ['the main button goes back to teal', H, `border:1px solid #ff8a3d;background:#ff8a3d;color:#14141a;font:inherit;font-weight:800`, `border:1px solid #6fd1bd;background:#0e0e13;color:#8fe0cf;font:inherit;font-weight:800`, 'source'],
  ['the quiet button is filled again', H, `button.quiet{background:transparent;`, `button.quiet{background:#ff8a3d;`, 'source'],
  ['the heading is plain sans again', H, `font:400 24px/1 Georgia,Times New Roman,serif`, `font-size:16px;font-weight:650`, 'source'],
  ['the example has no label', H, ` x.appendChild(el('p','why',why));x.appendChild(el('p','label','Example:'));`, ` x.appendChild(el('p','why',why));`, 'browser'],
  ['the sentence has no quotes', H, `q.appendChild(document.createTextNode(Q1));`, ``, 'browser'],
  ['the example has no Copy button', H, `b=btn('Copy','quiet',function(){copyLine(x,b,text);});x.appendChild(b);`, `b=btn('Copy','quiet',function(){copyLine(x,b,text);});`, 'browser'],
  ['Copy writes the quoted sentence', H, `navigator.clipboard.writeText(text).then(done,viaSelect)`, `navigator.clipboard.writeText(Q1+text+Q2).then(done,viaSelect)`, 'browser'],
  ['a refused clipboard says Copied anyway', H, `if(ok)done();else hold();`, `done();`, 'browser'],
  ['a refused clipboard selects the quote marks too', H, `var q=x.querySelector('.said');`, `var q=x.querySelector('.quote');`, 'browser'],
  ['a refused clipboard does not say what to press', H, `h.textContent='Press Ctrl+C (Cmd+C on a Mac) to copy it.';`, `h.textContent='';`, 'browser'],
  ['asking again piles up examples', H, `var old=box.querySelector('.example');if(old)old.remove();`, ``, 'browser'],
  ['the example is built from markup', H, ` q.appendChild(document.createTextNode(Q1));q.appendChild(w);`, ` q.innerHTML=text;q.appendChild(w);`, 'source'],
  ['an address that is not https is put in the page', H, `const link = appUrl && APP_URL.test(appUrl) ? appUrl : "";`, `const link = appUrl ?? "";`],
  ['the tool is listed with its switch off', MC, `&& (!t.homePanel || homePanel) && (!t.preparedData || preparedData)).map(`, `&& (!t.preparedData || preparedData)).map(`],
  ['the tool runs with its switch off', DI, `(found.homePanel && !env.homePanel)`, `false`],
  ['the page is served with its switch off', MA, `!(home && cfg.homePanel)`, `!(home)`],
  ['the tool carries no page', MC, `: t.homePanel ? toolUiMeta(HOME_URI) :`, `:`],
  ['my films always opens the projects page', H, `page: filmsOn ? MY_FILMS.pageOn : MY_FILMS.page };`, `page: MY_FILMS.page };`],
  ['my films always opens the films page', H, `page: filmsOn ? MY_FILMS.pageOn : MY_FILMS.page };`, `page: MY_FILMS.pageOn };`],
  ['any switch turns the films page on', H, `switches.includes("myFilms")`, `switches.length > 0`],
  ['a switch list that cannot be read throws', TL, `    const switches = await ctx.data.switches().catch(() => [] as string[]);`, `    const switches = await ctx.data.switches();`],
  ['the geographic line is not GEO\'s', H, `Ask about places with free public data: who lives near a spot`, `Ask a map a question: where would a new shop do well, who lives near a spot`],
  ['the first rule says every number is labelled a second time', H, `rules: ["It counts places,`, `rules: ["Every number is labelled: observed, calculated, estimated or simulated.", "It counts places,`],
  ['the geographic line loses the site\'s last sentence', H, ` how counties have changed. Every number says whether it was counted, calculated or estimated.",`, ` how counties have changed.",`],
  ['a score is promised', H, `No score and no ranking of places.`, `A score for every place.`],
  ['a database that cannot answer throws', TL, `    const rows = await ctx.data.departments().catch(() => null);`, `    const rows = await ctx.data.departments();`],
  ['the tool is not read-only', TL, `scope: "read", readOnly: true, idempotent: true, homePanel: true,`, `scope: "read", readOnly: false, idempotent: true, homePanel: true,`],
];

const noBrowser = process.argv.includes('--no-browser');
function browser(cwd) {
  return spawnSync('py', ['-I', path.join('tools', 'check-home-panel.py')], { encoding: 'utf8', cwd, env: { ...process.env }, timeout: 420000, killSignal: 'SIGKILL' });   // a frozen page must END the check (and be named HUNG), never stall the whole run: playwright's evaluate() has no timeout of its own (11-20 audit; the film-card-panel runner got this on 11-20 after a planted fault froze Chrome for 13 minutes)
}
function run(cwd) {
  return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' }));
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
  fs.cpSync(path.join(root, 'tests'), path.join(scratch, 'tests'), { recursive: true });
  fs.cpSync(path.join(root, 'assets'), path.join(scratch, 'assets'), { recursive: true });
  fs.cpSync(path.join(root, 'tools'), path.join(scratch, 'tools'), { recursive: true });
  // no node_modules junction here (11-20 audit): the scratch sits inside the repo, so node finds the repo's node_modules by itself, and a recursive delete of a junction can follow it into the shared folder
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
fresh();
const base = run(scratch).status || (noBrowser ? 0 : (() => { const r = browser(scratch); return r.error || r.status; })());
if (base) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to, kind = 'source'] of mutants) {
  if (kind === 'browser' && noBrowser) continue;
  fresh();
  const target = path.join(scratch, file);
  const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  const n = src.split(from).length - 1;
  if (n !== 1 || from === to) { console.log(`BROKEN MUTANT (text found ${n} times, need 1, or no change): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  let caught, how = '';
  if (kind === 'browser') {
    const r = browser(scratch), said = r.stdout + r.stderr;
    if (r.error) { console.log(`HUNG    ${name} (the real-Chrome check did not end in 7 minutes: not counted as caught; write the fault so the page fails, not freezes)`); missed++; continue; }
    // caught only when the check itself says so: a failed check line, or the element or message it waits for never came; any other crash is "ran badly", not a catch
    caught = r.status !== 0 && (/^  FAIL /m.test(r.stdout) || /FAILED:/.test(r.stdout) || /TimeoutError: (Locator|Page)\.wait_for/.test(r.stderr));
    how = caught ? ` (${(r.stdout.match(/^  FAIL (.*)$/m) || ['', 'an element the check waits for never came'])[1].slice(0, 90)})` : ` (rc ${r.status}, the check did not fail on its own words: ${said.slice(-120).replace(/\s+/g, ' ')})`;
  } else caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}${how}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
