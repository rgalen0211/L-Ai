// Must-fail proof for tests/connect-catalog-gap.test.mjs (the catalog-only gap): each mutant breaks ONE thing in a scratch copy of the connector's words and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_catalog_gap_mutants.mjs   (one runner at a time, alone)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// a planted fault that makes a suite HANG must end the run loudly, never stall it; a timeout is neither "caught" nor "missed"
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes (' + (r.error ? r.error.code : 'a test timed out') + '): end its node child by its own PID and write the fault so a test fails, not hangs'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-catgap');
const SUITE = 'connect-catalog-gap.test.mjs';
const IN = 'supabase/functions/connect-core/intake.ts', TL = 'supabase/functions/connect-core/tools.ts', MC = 'supabase/functions/connect-core/mcp.ts', SC = 'supabase/functions/connect-core/story_check.ts', GD = 'connect-ai/index.html', TP = 'supabase/functions/_shared/templates.ts';
const mutants = [
  ['the dataset question no longer says what the catalog holds', IN, 'options: [], say: CATALOG_SAYS,', 'options: [], say: null,'],
  ['the dataset question forgets the no-match rule', IN, 'continue with suggest_next_step. ${NO_MATCH}` });', 'continue with suggest_next_step.` });'],
  ['the confirm step forgets the no-match rule', IN, 'which one you chose. ${NO_MATCH} Then create_project', 'which one you chose. Then create_project'],
  ['the old poor-match line is back', IN, 'which one you chose. ${NO_MATCH} Then create_project', 'which one you chose (ask only if it is a poor match). ${NO_MATCH} Then create_project'],
  ['the question gives rent as an example again', IN, 'for example building permits, unemployment, obesity, or the jobs in one industry)', 'for example rent, building permits, unemployment, obesity)'],
  ['the tool description gives a rent example again', TL, '(a county map of building permits in Ohio since 2010', '(a county map of rent in Ohio since 2010'],
  ['the rule lets the AI invent a dataset id', IN, 'never invent a dataset id, and do not build', 'and do not build'],
  ['the rule lets the AI swap in another dataset silently', IN, 'never swap in a different dataset without saying so, never invent', 'never invent'],
  ['the rule lets the AI build a film that is not the one asked for', IN, ', and do not build a film that is not the one they asked for. "', '. "'],
  ['the rule promises an upload the site may not have switched on', IN, 'say that this subject cannot be made through this connection yet.', 'say that they can upload it in the Ryagram app.'],
  ['the rule names submit_prepared_data as if it were always there', IN, 'If submit_prepared_data is among your tools, a table of their own subject', 'Use submit_prepared_data: a table of their own subject'],
  ['the catalog sentence forgets the industry shares', IN, 'state unemployment, and the share of private-sector jobs in each industry by state.";', 'state unemployment.";'],
  ['the standing instructions forget the no-swap rule', MC, "never swap in another dataset without saying so, and never invent a dataset id; if submit", 'never invent a dataset id; if submit'],
  ['the story rules say again that nothing can be added', TL, "you cannot add data yourself, and if the person's subject is not in the catalog you say so plainly instead of swapping in another dataset.", 'you cannot upload data.'],
  ['the refusal for an unknown dataset forgets the plain-words rule', SC, ' If the person asked for a subject that is not on this list, tell them plainly that Ryagram does not have it; do not swap in another dataset without saying so.`);', '`);'],
  ['dataset_info forgets the plain-words rule', TL, ' If the person asked for a subject that is not among them, tell them plainly that Ryagram does not have it; do not swap in another dataset without saying so.`, "not_found");', '`, "not_found");'],
  ['the public guide forgets the catalog line', GD, "    <li>It can draw only the subjects in Ryagram's own catalog of data. If you ask for a subject that is not there, it should tell you so plainly and offer the closest one, not swap in another without saying.</li>\n", ''],
  ['a new family of dataset is added and the catalog sentence is not updated', TP, '  bls_state_unemployment: { label: "State unemployment rate (BLS LAUS, monthly)", start: "2019-01", end: "2022-12" },\n', '  bls_state_unemployment: { label: "State unemployment rate (BLS LAUS, monthly)", start: "2019-01", end: "2022-12" },\n  zzz_new_family: { label: "A new family", start: "2010", end: "2019" },\n'],
];

function run(cwd) {
  return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', path.join('tests', SUITE)], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' }));
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase'), path.join(scratch, 'supabase'), { recursive: true });
  fs.mkdirSync(path.join(scratch, 'connect-ai'), { recursive: true });
  fs.copyFileSync(path.join(root, GD), path.join(scratch, GD));
  fs.mkdirSync(path.join(scratch, 'tests'), { recursive: true });
  fs.copyFileSync(path.join(root, 'tests', SUITE), path.join(scratch, 'tests', SUITE));
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
fresh();
if (run(scratch).status) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to] of mutants) {
  fresh();
  const target = path.join(scratch, file);
  const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  const n = src.split(from).length - 1;
  if (n !== 1) { console.log(`BROKEN MUTANT (text found ${n} times, need 1): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
