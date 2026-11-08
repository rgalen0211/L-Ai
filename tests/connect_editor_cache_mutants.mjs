// Must-fail proof for tests/connect-editor-cache.test.mjs (the editor page in the AI chat can not be a stale page): each mutant breaks ONE thing in a scratch copy, the page is REGENERATED from the broken source
// (so the "committed page = generator" test is not the only thing that notices), and the suites must then FAIL. A baseline run on the unbroken copy must PASS first, and every text must occur exactly once.
// Run:  node tests/connect_editor_cache_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-edcache');
const A = 'supabase/functions/connect-core/mcp_app.ts', B = 'tools/build-chat-editor.mjs', AE = 'assets/app-editor.js', H = 'tools/chat-editor/live-host.js';
const SUITES = ['connect-editor-cache.test.mjs', 'connect-chat-editor.test.mjs', 'connect-mcp-app.test.mjs'];
const mutants = [
  ['the page address does not change with the build', A, 'export const EDITOR_URI = "ui://ryagram/editor-" + EDITOR_BUILD;', 'export const EDITOR_URI = "ui://ryagram/editor";'],
  ['the old address is not answered (a host with an old list gets "no such page")', A, 'u === EDITOR_URI_LEGACY || (typeof u === "string"', '(typeof u === "string"'],
  ['an address of the editor shape is answered with anything after it', A, '[0-9a-f]{12}$/;', '[0-9a-f]{12}/;'],
  ['an address of the editor shape is answered with any characters', A, 'editor-[0-9a-f]{12}$/;', 'editor-.*$/;'],
  ['the editor page is answered when the switch is off', A, 'if (uri !== CARD_URI && !(editor && cfg.chatEditor)) return null;', 'if (uri !== CARD_URI && !editor) return null;'],
  ['an old address is answered with the card', A, 'text: editor ? EDITOR_HTML : cardHtml(cfg.appUrl)', 'text: uri === EDITOR_URI ? EDITOR_HTML : cardHtml(cfg.appUrl)'],
  ['the build id ignores the sources', B, "update(page('')).digest", "update('x').digest"],
  ['the build id does not cover the first script', B, "update(page('')).digest", "update(page('').replace(/addEventListener\\('error'.*?<\\/script>/s, '')).digest"],
  ['the page does not carry its build', B, ' data-build=\"${id}\"', ''],
  ['the error words do not name the build', B, "+'. Panel build ${id}.';r.textContent", "+'.';r.textContent"],
  ['the error words name a build that is not the page\'s', B, "+'. Panel build ${id}.';r.textContent", "+'. Panel build 000000000000.';r.textContent"],
  ['the error words leave out where it threw', B, "+') At '+c(f||'unknown',90)+' line '+c(l||'?',6)+' column '+c(k||'?',6)+(st", "+')'+(st"],
  ['the error words leave out the stack', B, "+(st?'. Stack: '+st:'')+", "+"],
  ['the error words take the file from the wrong field', B, "show(e&&e.message,e&&e.filename,e&&e.lineno,e&&e.colno,", "show(e&&e.message,e&&e.type,e&&e.lineno,e&&e.colno,"],
  ['the error is not written to the console', B, "try{console.error('Ryagram panel error',m,f,l,k,t);}catch(x){}", ""],
  ['the error words keep control and direction characters', B, ".replace(/[^ -~]/g,' ')", ""],
  ['a string-method call is added to the shared editor file', AE, "const hue = k => (typeof lk[k] === 'string' ? lk[k].toLowerCase() : '');", "const hue = k => (typeof lk[k] === 'string' ? lk[k].toLowerCase().toUpperCase() : '');"],
  ['a string-method call is added to the chat host', H, "let text = clean(parts.join(' '), 300).trim();", "let text = clean(parts.join(' '), 300).trim().trim();"],
];

function run(cwd) {
  const gen = spawnSync(process.execPath, [path.join('tools', 'build-chat-editor.mjs')], { encoding: 'utf8', cwd });
  if (gen.status) return gen;
  return spawnSync(process.execPath, ['--test', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd });
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  for (const d of ['supabase/functions', 'tests', 'assets', 'tools/chat-editor', 'tools/maker-live']) fs.cpSync(path.join(root, d), path.join(scratch, d), { recursive: true });
  fs.copyFileSync(path.join(root, 'tools/build-chat-editor.mjs'), path.join(scratch, 'tools/build-chat-editor.mjs'));
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
  const r = run(scratch);
  const caught = r.status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
