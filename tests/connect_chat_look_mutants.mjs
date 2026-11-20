// Must-fail proof for tests/connect-chat-look.test.mjs (the ONE shared look of the site and the chat): each mutant breaks ONE thing in a scratch copy and the suite must then FAIL.
// A baseline run on the unbroken copy must PASS first, and every text must occur exactly once. Run:  node tests/connect_chat_look_mutants.mjs   (exit 0 only when every mutant is caught)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-chatlook');
const C = 'supabase/functions/connect-core/';
const GEN = C + 'chat_look.ts', HP = C + 'home_panel.ts', MA = C + 'mcp_app.ts', UI = 'tools/chat-look/chat-ui.css', DS = 'tools/chat-look/source/ds.css', BUILD = 'tools/build-chat-look.mjs';
const mutants = [
  ['a token is changed by hand in the generated file (the site\'s accent colour)', GEN, '--accent:#ff8a3d;', '--accent:#ff0000;'],
  ['the site changes its accent and the chat is not rebuilt', DS, '--accent:#ff8a3d;', '--accent:#3dff8a;'],
  ['the chat layout is hand-edited in the generated file', GEN, '.rc-title{', '.rc-title{letter-spacing:9px;'],
  ['the chat layout writes a colour of its own', UI, '.rc-note.ok{color:var(--ok)}', '.rc-note.ok{color:#8fe3cf}'],
  ['the chat layout uses a token the site does not have', UI, '.rc-note.ok{color:var(--ok)}', '.rc-note.ok{color:var(--made-up)}'],
  ['the chat layout loads a picture', UI, '.rc-note.ok{color:var(--ok)}', '.rc-note.ok{background:url(a.png)}'],
  ['the home panel writes a colour of its own', HP, '":root{color-scheme:dark}" + chatCss("tokens", "controls", "flip", "base", "home")', '":root{color-scheme:dark}" + chatCss("tokens", "controls", "flip", "base", "home") + "a{color:#ffffff}"'],
  ['the home panel carries no shared look', HP, 'chatCss("tokens", "controls", "flip", "base", "home")', 'chatCss("base", "home")'],
  ['the account card carries no shared look', MA, 'chatCss("tokens", "controls", "base", "card")', 'chatCss("base", "card")'],
  ['the account card writes a colour of its own', MA, 'chatCss("tokens", "controls", "base", "card");', 'chatCss("tokens", "controls", "base", "card") + "a{color:#ffffff}";'],
  ['the build keeps no tokens (the chat gets no :root)', BUILD, "const KEEP = [':root', ", "const KEEP = ["],
];
const run = (cwd) => {
  const r = spawnSync(process.execPath, ['--test', '--test-timeout=60000', path.join('tests', 'connect-chat-look.test.mjs')], { encoding: 'utf8', cwd, timeout: 120000, killSignal: 'SIGKILL' });
  if (r.error) throw new Error('HUNG: the suite did not end in 2 minutes');
  return r;
};
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratch, 'supabase'), { recursive: true });
  fs.cpSync(path.join(root, 'supabase/functions'), path.join(scratch, 'supabase/functions'), { recursive: true });
  fs.cpSync(path.join(root, 'tests'), path.join(scratch, 'tests'), { recursive: true });
  fs.cpSync(path.join(root, 'tools'), path.join(scratch, 'tools'), { recursive: true });
  if (fs.existsSync(path.join(root, 'assets/ds.css'))) { fs.mkdirSync(path.join(scratch, 'assets'), { recursive: true }); for (const f of ['ds.css', 'ds-v11.css']) fs.copyFileSync(path.join(root, 'assets', f), path.join(scratch, 'assets', f)); }
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
  const r = run(scratch), caught = r.status !== 0 && /✖|not ok/.test(r.stdout + r.stderr);
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
