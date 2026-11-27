// Must-fail proof for tests/connect-stranger-words.test.mjs (what the connector says to a stranger's AI): each mutant breaks ONE thing in a scratch copy and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every mutant's text must occur EXACTLY once. Run:  node tests/connect_stranger_words_mutants.mjs   (one runner at a time, alone)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const noHang = (r) => { if (r.error || /test timed out after/.test(String(r.stdout) + String(r.stderr))) throw new Error('HUNG: the suite did not end in 5 minutes'); return r; };

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-strangerwords');
const SUITE = 'connect-stranger-words.test.mjs';
const TL = 'supabase/functions/connect-core/tools.ts', SC = 'supabase/functions/connect-core/story_check.ts', TP = 'supabase/functions/_shared/templates.ts', IN = 'supabase/functions/connect-core/intake.ts', MC = 'supabase/functions/connect-core/mcp.ts';
const mutants = [
  ['the unmeasured-view words steer to a map or bars again', TP, 'so use a line view (it works for every dataset; a map or bars only where dataset_info says the engine draws them).', 'so use a map, bars or line view.'],
  ['the paired fix hint steers to a map or bars again', SC, '"Use a line view (it works for every dataset), or put a measured', '"Use a map, bars or line view, or put a measured'],
  ['the story RULES steer to a map or bars again', TL, 'use a line view (it works for every dataset; a map or bars only where dataset_info says the engine draws them) unless the person gives you that number.', 'use a map, bars or line view unless the person gives you that number.'],
  ['dataset_info stops saying a line works for every dataset', TL, 'A line view works for every dataset.', 'A map works for every dataset.'],
  ['dataset_info no longer warns before promising a map or bars', TL, 'Use it before you promise a person a map, bars or a range of years (a line view works for every dataset). ', 'Use it before you promise a person a map or a range of years. '],
  ['the compilation tool no longer says the app is not open to everyone', TL, 'The desktop app is not open to everyone yet: ask the person first whether they have it, and if they do not, tell them plainly that compilations are not available to them yet. ', ''],
  ['the saved-request answer sends everyone to the app again', TL, 'If the person has the Ryagram desktop app (it is not open to everyone yet), it shows the request there and they build the film on their own computer; their videos never leave it. If they do not have the app, tell them plainly that compilations are not available to them yet.', 'The person opens the Ryagram app on their own computer, checks the request and builds the film there; their videos never leave it.'],
  ['the download tool no longer says the app is not open to everyone', TL, ' This needs the Ryagram desktop app, which is not open to everyone yet: if the person does not have it, tell them plainly that a download cannot be made for them yet.', ''],
  ['the download answer promises the app to everyone again', TL, 'in their Ryagram desktop app (if they have it: it is not open to everyone yet) and decides there.', 'in their Ryagram desktop app and decides there.'],
  ['the intake step sends a stranger to the website for the app again', IN, "The app is not open to everyone yet: if they do not already have it, tell them plainly that compilations are not available to them yet and offer a data film instead; if they will get it later, you can write down what they want so the app shows it when they open it.", "Tell them where to get the app on the Ryagram website (Account), and that you can write down what they want so the app shows it when they open it."],
  ['whoami promises a final film to everyone again', TL, 'and a final film needs credits: if the person has credits they press "Render final film" in the Ryagram app; if they have none, say plainly that a final film is not possible for them right now and do not promise one.', 'the person presses "Render final film" in the Ryagram app.'],
  ['the refused-final-film answer promises it to everyone again', TL, "A final film needs credits, and only the person can spend them. If they have credits, they press 'Render final film' in the Ryagram app. If they have none, tell them plainly that a final film is not possible for them right now, and do not promise one.", "Tell the person to press 'Render final film' in the Ryagram app."],
  ['the cost estimate promises a final film to a person who cannot pay', TL, ' : "A connection cannot start it, and the person does not have the credits for a final film, so do not promise one.");', ' : "A connection cannot start it: the person presses \'Render final film\' in the Ryagram app.");'],
  ['the server instructions promise a final film to everyone again', MC, ', and a person with no credits cannot start it: say so plainly and do not promise a final film. ', '. '],
];

function run(cwd) { return noHang(spawnSync(process.execPath, ['--test', '--test-timeout=120000', path.join('tests', SUITE)], { encoding: 'utf8', cwd, timeout: 300000, killSignal: 'SIGKILL' })); }
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase', 'functions'), path.join(scratch, 'supabase', 'functions'), { recursive: true });
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
