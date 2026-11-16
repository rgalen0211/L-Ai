// Must-fail proof for tests/ryagram-look.test.mjs (WEB, 2026-11-15): each mutant breaks ONE thing in a scratch copy and the suite must then FAIL. Baseline must PASS first. Run: node tests/ryagram_look_mutants.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-look');
const CSS = 'assets/ryagram-look.css';
const mutants = [
  ['the accent is not the waiting page accent', CSS, '--accent:#ff8a3d;', '--accent:#1b6f63;'],
  ['the page colour drifts', CSS, '--bg:#14141a;', '--bg:#15151b;'],
  ['the panel colour drifts', CSS, '--paper:#1b1b23;', '--paper:#ffffff;'],
  ['the old brand token is left on teal', CSS, '--brand:#ff8a3d;', '--brand:#6fd1bd;'],
  ['the radius drifts', CSS, '--radius:18px;', '--radius:6px;'],
  ['the sheet writes words onto the page', CSS, 'body.ryagram-look .state{', 'body.ryagram-look .state::after{content:"x"}\nbody.ryagram-look .state{'],
  ['the sheet pulls something from outside', CSS, 'body.ryagram-look ::placeholder{', 'body.ryagram-look{background-image:url(https://example.com/a.png)}\nbody.ryagram-look ::placeholder{'],
  ['the accent colour is written outside a token', CSS, 'body.ryagram-look .button.danger{', 'body.ryagram-look .tag{border-color:#ff8a3d}\nbody.ryagram-look .button.danger{'],
  ['one page links an older stamp', 'help/index.html', 'ryagram-look.css?v=20261116a', 'ryagram-look.css?v=20261023a'],
  ['one page links the sheet twice', 'report/index.html', '<link rel="stylesheet" href="/assets/ryagram-look.css?v=20261116a">', '<link rel="stylesheet" href="/assets/ryagram-look.css?v=20261115a"><link rel="stylesheet" href="/assets/ryagram-look.css?v=20261115a">'],
  ['a dressed page loses the look class', 'terms/index.html', '<body class="ryagram-look">', '<body>'],
  ['the field border is too faint', CSS, '--line-strong:#7d7d89;', '--line-strong:#3a3a44;'],
  ['the muted text is too dim', CSS, '--muted:#b6b5ae;', '--muted:#5a5a60;'],
  ['the sheet turns smooth scrolling on', CSS, 'body.ryagram-look ::placeholder{', 'html{scroll-behavior:smooth}\nbody.ryagram-look ::placeholder{'],
  ['anchor targets no longer clear the header', CSS, 'body.ryagram-look [id]{scroll-margin-top:80px}', 'body.ryagram-look [id]{scroll-margin-top:0px}'],
  ['section cards lose their inner padding', CSS, 'body.ryagram-look .ops-section{padding:20px 22px}', 'body.ryagram-look .ops-section{padding:0}'],
  ['a form inside a section card is a card again', CSS, 'body.ryagram-look .ops-section .contact-form,body.ryagram-look .account-section .invite-panel,body.ryagram-look .ops-section .invite-panel{padding:0;border:0;', 'body.ryagram-look .ops-section .contact-form,body.ryagram-look .account-section .invite-panel,body.ryagram-look .ops-section .invite-panel{padding:0;border:1px solid #fff;'],
  ['a script-focused heading shows a ring again', CSS, 'body.ryagram-look [tabindex="-1"]:focus,body.ryagram-look [tabindex="-1"]:focus-visible{outline:none}', 'body.ryagram-look [tabindex="-1"]:focus{outline:none}'],
  ['table header words break inside a word again', CSS, 'body.ryagram-look .admin-table th{overflow-wrap:normal;', 'body.ryagram-look .admin-table th{overflow-wrap:anywhere;'],
  ['the day pills touch each other again', CSS, 'body.ryagram-look p>.button.small{margin:8px 8px 8px 0}', 'body.ryagram-look p>.button.small{margin:0}'],
  ['version rows are plain rows again', CSS, 'body.ryagram-look .project-list,body.ryagram-look .version-list{border-top:0;display:grid;gap:12px}', 'body.ryagram-look .project-list{border-top:0;display:grid;gap:12px}'],
  ['the film nav gap is unguarded (shows the nav on a phone)', CSS, '@media(min-width:561px){body.ryagram-look .page-nav{display:flex;align-items:center;gap:8px 20px}}', 'body.ryagram-look .page-nav{display:flex;align-items:center;gap:8px 20px}'],
  ['light: the muted text is too pale on white', CSS, '--muted:#5b5a55;', '--muted:#a0a09a;'],
  ['light: the focus ring is the pale orange on white', CSS, '--ring:#c2540a;', '--ring:#ff8a3d;'],
  ['light: small orange text is the pale orange on white', CSS, '--accent-text:#a8470a;', '--accent-text:#ff8a3d;'],
  ['light: the whole light block is gone', CSS, '@media(prefers-color-scheme:light){', '@media(prefers-color-scheme:print){'],
  ['light: a status chip is too pale', CSS, '--ok:#0f5a49;', '--ok:#7fd6b8;'],
  ['light: the header keeps its dark glass', CSS, '--header-bg:rgba(251,250,247,.92);', '--hdr:rgba(251,250,247,.92);'],
  ['a status chip colour is a literal again', CSS, '{background:var(--ok-bg);color:var(--ok)}', '{background:#173a33;color:#9fe8d6}'],
  ['the page focus ring reads the pale orange again', CSS, 'body.ryagram-look :focus-visible{outline:3px solid var(--ring)', 'body.ryagram-look :focus-visible{outline:3px solid var(--accent)'],
  ['the editor islands are not kept dark in a light page', CSS, 'body.ryagram-look .le-view,body.ryagram-look .le-lanes,body.ryagram-look .le-banner,body.ryagram-look .le-ai{--ink', 'body.ryagram-look .le-xx{--ink'],
  ['a phone admin table does not scroll sideways', CSS, '@media(max-width:560px){body.ryagram-look .admin-table{display:block;overflow-x:auto', '@media(max-width:560px){body.ryagram-look .admin-table{display:table;overflow-x:auto'],
  ['a phone admin table breaks words letter by letter', CSS, 'white-space:nowrap;overflow-wrap:normal;word-break:normal', 'white-space:nowrap;overflow-wrap:anywhere;word-break:normal'],
  ['the Render and consent cards lose their inner padding', CSS, 'body.ryagram-look .consent-always{padding:20px 22px}', 'body.ryagram-look .consent-always{padding:0}'],
  ['the daily-cap box is a full-width box again', CSS, '{flex:0 1 8em;max-width:8em}', '{flex:1}'],
  ['another sheet redefines the accent for the look', 'assets/help.css', '.help-main{max-width:760px;', 'body.ryagram-look{--accent:#00ff00;}\n.help-main{max-width:760px;'],
];
function run(cwd) { return spawnSync(process.execPath, ['--test', path.join('tests', 'ryagram-look.test.mjs')], { encoding: 'utf8', cwd }); }
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true }); fs.mkdirSync(scratch, { recursive: true });
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (/^(node_modules|\.git|\.claude|\.mut[\w-]*)$/.test(e.name)) continue;
    fs.cpSync(path.join(root, e.name), path.join(scratch, e.name), { recursive: true });
  }
}
fresh();
if (run(scratch).status) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to] of mutants) {
  fresh();
  const target = path.join(scratch, file), src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  if (!src.includes(from)) { console.log(`BROKEN MUTANT (text not found): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  const caught = run(scratch).status !== 0;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name}`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
