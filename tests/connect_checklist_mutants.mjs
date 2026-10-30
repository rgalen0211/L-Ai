// Must-fail proof for tests/connect-media-checklist.test.mjs (NEXT-CONNECT 161): each mutant breaks ONE thing in a scratch copy of the connector code and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first. Run:  node tests/connect_get_story_mutants.mjs   (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-cl');
const C = 'supabase/functions/connect-core/';
const SUITES = ['connect-media-checklist.test.mjs'];
const T = C + 'tools.ts';
const mutants = [
  ['a link in an item is accepted', T, 'if (checklist.some((c) => looksLikeLink(`${c.what} ${c.from} ${c.must_contain}`)))', 'if (false)'],
  ['the link rule misses a bare site address', T, '(com|org|net|gov|edu|io|co|us|uk)', '(zzzzz)'],
  ['the link rule misses www', T, 'bwww', 'bwwx'],
  ['a place in an item is accepted', T, 'if (checklist.some((c) => looksLikePlace(`${c.what} ${c.from} ${c.must_contain}`)))', 'if (false)'],
  ['an item may name a folder that is not in the request', T, 'if (checklist.some((c) => !folders.includes(c.folder)))', 'if (false)'],
  ['an item may have no words', T, 'if (checklist.some((c) => !c.what))', 'if (false)'],
  ['the count may be anything', T, 'count: { type: "integer", minimum: 1, maximum: 20,', 'count: { type: "number",'],
  ['any number of items', T, 'checklist: { type: "array", maxItems: MAX_CHECKLIST,', 'checklist: { type: "array",'],
  ['an item may carry extra fields', T, '}, ["what", "folder"]),', '}, ["what", "folder"]).additionalProperties === 0 ? {} : { ...obj({}, []), type: "object", properties: {}, additionalProperties: true }),'],
  ['the tool does not store the checklist', T, 'note, ...(checklist.length ? { checklist } : {}) };', 'note };'],
  ['an empty checklist is stored', T, '...(checklist.length ? { checklist } : {})', 'checklist'],
  ['the text is not cleaned', T, 'what: cleanText(c.what, 200)', 'what: String(c.what)'],
  ['the ids are not given by the tool', T, 'id: `c${i + 1}`', 'id: String(c.id ?? "x")'],
  ['the folder is not trimmed', T, 'folder: String(c.folder).trim()', 'folder: String(c.folder)'],
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
