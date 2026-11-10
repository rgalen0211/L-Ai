// Must-fail proof for tests/connect-directory-descriptions.test.mjs (the description lint and what it guards): each mutant takes ONE rule out of the lint, or puts one bad sentence back into a real description, in a scratch copy, and the test must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every text must occur exactly once (a pattern that no longer matches is BROKEN, never "caught").
// Run:  node tests/connect_directory_descriptions_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-desc');
const BS = String.fromCharCode(92);
const L = 'tools/connect-description-lint.mjs', ET = 'supabase/functions/connect-core/editor_tools.ts', TL = 'supabase/functions/connect-core/tools.ts';
const mutants = [
  ['a name of any shape is accepted', L, "if (!/^[a-z][a-z0-9_]{0,63}$/.test(n))", 'if (false)'],
  ['a tool needs no title', L, "if (typeof t?.title !== 'string' || !t.title.trim() || t.title.length > 80)", 'if (false)'],
  ['a hidden character in a title is accepted', L, 'else if (INVISIBLE.test(t.title))', 'else if (false)'],
  ['MCP, plugin or server may be in a name', L, "if (/\\b(mcp|plugin|server)\\b/i.test(`${n} ${t?.title ?? ''}`))", 'if (false)'],
  ['a description that says nothing is accepted', L, "if (typeof d !== 'string' || d.trim().length < 20)", 'if (false)'],
  ['a description of any length is accepted', L, 'if (d.length > MAX_DESCRIPTION)', 'if (false)'],
  ['a hidden character in a description is accepted', L, 'if (INVISIBLE.test(d)) p.push(', 'if (false) p.push('],
  ['an override or steering sentence is accepted', L, 'for (const re of OVERRIDE) if (re.test(d))', 'for (const re of []) if (re.test(d))'],
  ['promotion or comparison is accepted', L, 'for (const re of PROMOTION) if (re.test(d))', 'for (const re of []) if (re.test(d))'],
  ['an address or a fetch-instructions sentence is accepted', L, 'for (const re of EXTERNAL) if (re.test(d))', 'for (const re of []) if (re.test(d))'],
  ['encoded or hidden-looking text is accepted', L, 'for (const re of ENCODED) if (re.test(d))', 'for (const re of []) if (re.test(d))'],
  ['a description may name a tool the server does not have', L, 'if (!knownTools.includes(m[1]))', 'if (false)'],
  ['a tool listed twice is accepted', L, 'if (seen.has(t.name)) p.push(', 'if (false) p.push('],
  ['an imperative in lower case is not found', L, ')\\b[^.;]*[.;]?/gi;', ')\\b[^.;]*[.;]?/g;'],
  ['"Read-only" counts as an imperative', L, 'Read(?!-)', 'Read'],
  ['a no-cap description limit is raised', L, 'export const MAX_DESCRIPTION = 900;', 'export const MAX_DESCRIPTION = 90000;'],
  ['an override pattern is dropped: ignore previous', L, '/ignore (all |any |your |the )?(previous|prior|above|system)/i, ', ''],
  ['a promotion pattern is dropped: best', L, '/\\b(best|leading|#1|premium|world-class|unrivalled|cutting-edge)\\b/i, ', ''],
  ['a web address pattern is dropped', L, '/https?:\\/\\//i, /\\bwww\\./i, ', ''],
  ['"do not call it yourself" is put back in a panel tool', ET, '"ONLY for the Ryagram editor panel, which calls it. Undoes one earlier', '"ONLY for the Ryagram editor panel; do not call it yourself. Undoes one earlier'],
  ['"Use list_my_downloads" is put back in a tool', TL, 'list_my_downloads shows what became of them.', 'Use list_my_downloads to see what became of them.'],
  ['"before you promise" is put back in dataset_info', TL, 'It tells what a map or a range of years can cover before a person is promised one.', 'Use it before you promise a person a map or a range of years.'],
  ['a generative model is accepted anywhere', L, 'for (const re of GENERATIVE) { const m = re.exec(String(text));', 'for (const re of []) { const m = re.exec(String(text));'],
  ['a title is not checked for generative models', L, 'lintGenerative(`${n} ${t?.title ?? ' + "''" + '} ${d}`, at)', 'lintGenerative(`${d}`, at)'],
  ['a voice clone is accepted', L, 'voice clon' + BS + 'w*|', ''],
  ['text to video is accepted', L, '/text[ -]to[ -](?:image|video|speech|music|audio)/i, ', ''],
  ['image generation is put back in a real description', TL, 'Starts a new, empty film project. Free.', 'Starts a new, empty film project with image generation for the cover. Free.'],
  ['a promotion is added to a tool', TL, 'Starts a new, empty film project. Free.', 'Starts a new, empty film project. The best film tool. Free.'],
];

function run(cwd) {
  return spawnSync(process.execPath, ['--test', path.join('tests', 'connect-directory-descriptions.test.mjs')], { encoding: 'utf8', cwd });
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  for (const d of ['supabase/functions', 'supabase/directory', 'tools', 'tests']) fs.cpSync(path.join(root, d), path.join(scratch, d), { recursive: true });
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
  if (n !== 1 || from === to) { console.log(`BROKEN MUTANT (text found ${n} times, need 1, or no change): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught or broken` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
