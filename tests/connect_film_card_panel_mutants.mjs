// Must-fail proof for the chat editor panel's half of Editor Step A (tests/connect-film-card-panel.test.mjs and the card checks in tools/check-chat-editor.py): each mutant breaks ONE rule in a scratch copy, the page is REGENERATED
// from the broken source, and it must then FAIL. Three kinds (source / browser / both): the SOURCE mutants must fail the offline suites; the BROWSER mutants must fail the real-Chrome check (tools/check-chat-editor.py, needs Chrome and playwright, TEMP on D:).
// A baseline run on the unbroken copy must PASS first, and every text must occur exactly once (a pattern that no longer matches is BROKEN, never "caught").
// Run:  node tests/connect_film_card_panel_mutants.mjs [--no-browser]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratch = path.join(root, '.mut-cardpanel');
const H = 'tools/chat-editor/live-host.js', AE = 'assets/app-editor.js', CSS = 'tools/chat-editor/chat-extra.css';
const SUITES = ['connect-film-card-panel.test.mjs', 'connect-chat-editor.test.mjs'];
const BS = String.fromCharCode(92);
const ADDRESS = `} else if (/javascript:|data:|https?:|${BS}/${BS}/|expression${BS}(/i.test(v)) continue;`;
const browserOnly = process.argv.includes('--no-browser');

// [name, file, from, to, kind]
const mutants = [
  ['the panel drops the length adjustment the connector allows', H, "'textLength', 'lengthAdjust', 'xml:space', 'dx',", "'textLength', 'xml:space', 'dx',", 'source'],
  ['the panel drops xml:space the connector allows', H, "'textLength', 'lengthAdjust', 'xml:space', 'dx',", "'textLength', 'lengthAdjust', 'dx',", 'source'],
  ['a length adjustment may be any word', H, "if (a.name === 'lengthAdjust' && v !== 'spacing'", "if (false && v !== 'spacing'", 'source'],
  ['xml:space may be any word', H, "if (v === 'preserve' || v === 'default') el.setAttributeNS(", "if (true) el.setAttributeNS(", 'source'],
  ['xml:space is written outside its namespace', H, "el.setAttributeNS(XML_NS, 'xml:space', v)", "el.setAttribute('xml:space', v)", 'source'],
  ['the panel drops the text length attribute the connector allows', H, "'letter-spacing', 'textLength', 'lengthAdjust',", "'letter-spacing', 'lengthAdjust',", 'source'],
  ['a text length may be any text', H, "if (a.name === 'textLength' && !", "if (false && !", 'source'],
  ['the chat host does not offer the card', H, 'filmCard: true, drawCard, siteLink };', 'drawCard, siteLink };', 'source'],
  ['the editor runs the card code on any host', AE, 'host.filmCard === true && ', '', 'source'],
  ['the picture may hold a script element', H, "const CARD_ELEMENTS = new Set(['svg', 'g',", "const CARD_ELEMENTS = new Set(['script', 'svg', 'g',", 'both'],
  ['the picture may carry a style attribute', H, "'gradientUnits', 'gradientTransform', 'patternUnits', 'patternTransform']);", "'gradientUnits', 'gradientTransform', 'patternUnits', 'patternTransform', 'style']);", 'both'],
  ['ids inside the picture are not renamed', H, "a.name === 'id' ? 'lecard-' + v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) : v", 'v', 'both'],
  ['an address may stay in an attribute', H, ADDRESS, '} else if (false) continue;', 'both'],
  ['a pattern may hold a circle in the panel', H, "const PATTERN_CHILDREN = new Set(['line', 'path', 'rect']);", "const PATTERN_CHILDREN = new Set(['line', 'path', 'rect', 'circle']);", 'both'],
  ['the panel keeps what is inside a pattern child', H, "(!inPattern && !(src.localName === 'pattern') ||", "(true ||", 'both'],
  ['the panel keeps a reference inside a pattern', H, "if (patternish && /url" + BS + "(/i.test(v)) continue;", "if (false) continue;", 'both'],
  ['the panel keeps a pattern whose tile is not 2 to 64', H, "if (!tile('width') || !tile('height')) return null;", "if (false) return null;", 'both'],
  ['the panel does not count patterns', H, "++patterns > 100", "++patterns > 100000", 'source'],
  ['a pattern attribute may be on any element in the panel', H, "a.name === 'patternTransform') && src.localName !== 'pattern') continue;", "a.name === 'patternTransform') && false) continue;", 'source'],
  ['the panel keeps any pattern units word', H, "a.name === 'patternUnits' && v !== 'userSpaceOnUse' && v !== 'objectBoundingBox') continue;", "false) continue;", 'source'],
  ['the panel drops the pattern element', H, "'clipPath', 'title', 'pattern']);", "'clipPath', 'title']);", 'source'],
  ['the panel cap stays at 200000', H, 'svg.length > 300000', 'svg.length > 200000', 'both'],
  ['the picture size is not limited', H, 'svg.length > 300000', 'svg.length > 3000000', 'source'],
  ['the depth and element count are not limited', H, 'depth > 30 || ++count > 30000', 'depth > 3000 || ++count > 3000000', 'source'],
  ['the panel asks on every poll', AE, 'loadCard(false), 15000', 'loadCard(true), 15000', 'source'],
  ['the panel polls far too fast', AE, 'loadCard(false), 15000', 'loadCard(false), 150', 'source'],
  ['the panel polls for ever', AE, '++cardPolls < 40', '++cardPolls < 4000000', 'source'],
  ['the panel fetches a card it already holds', AE, ' ...(cardHave ? { p_have: cardHave } : {})', '', 'source'],
  ['the stale sentence is gone', AE, "'This picture is from an earlier version of the film.'", "''", 'both'],
  ['a reply without a card throws the shown card away', AE, "if (d.card && typeof d.card === 'object') {", 'if (true) {', 'source'],
  ['the swatches ignore the card', AE, "'page.background': '#0d0d11', ...CARD_LOOK }", "'page.background': '#0d0d11' }", 'both'],
  ['the card is never asked for', AE, 'if (cardOn) setTimeout(() => loadCard(true), 0);', '', 'both'],
  ['a further call name is allowed', H, "'editor_heartbeat', 'editor_film_card'];", "'editor_heartbeat', 'editor_film_card', 'set_look'];", 'source'],
  ['the picture box has no style', CSS, '.le-cardpic svg{display:block;width:100%;height:100%}', '', 'source'],
  // ---- Try again (11-18): the panel's button for a picture the engine failed to draw
  ['Try again is offered for every failed picture, even one a retry cannot fix', AE, "cardState === 'failed' && cardCode === 'engine_error'", "cardState === 'failed'", 'both'],
  ['a press does not ask (no p_ask)', AE, 'await loadCard(true, true);', 'await loadCard(false, true);', 'both'],
  ['the panel presses Try again by itself', AE, 'cardRetry = d.retry === true;', "cardRetry = d.retry === true; if (cardRetry && cardState === 'failed') setTimeout(tryCardAgain, 0);", 'both'],
  ['a second press while the first is out asks again', AE, 'if (cardBusy) return;', 'if (false) return;', 'source'],
  ['the button stays usable while the ask is out', AE, 'disabled: cardBusy }', 'disabled: false }', 'source'],
  ['the words say "now" when the database said not yet', AE, "(may ? 'You can try again now.' :", "(!may ? 'You can try again now.' :", 'browser'],
  ['a press that is too early says nothing', AE, "if (pressed && cardState === 'failed') cardNote = 'Not yet. Please try again in a few minutes.';", '', 'browser'],
  ['a refused press says nothing', AE, "cardNote = 'Could not ask just now.' + (m ? ' ' + m : '');", "cardNote = '';", 'both'],
  ['an older picture whose newer one failed has no button', AE, "if (cardRefresh === 'failed' && cardRefreshCode === 'engine_error') kids.push(retryLine(cardRefreshRetry));", '', 'both'],
  ['under an older picture the button words follow the wrong flag', AE, 'kids.push(retryLine(cardRefreshRetry));', 'kids.push(retryLine(cardRetry));', 'browser'],
  ['a press that is taken gets no reads to watch it', AE, "cardBusy = true; cardNote = ''; cardPolls = 0; paintCard();", "cardBusy = true; cardNote = ''; paintCard();", 'source'],
  ['the retry line has no style', CSS, '.le-cardretry{margin-top:8px}', '', 'source'],
  // ---- Try again words (GAMES review 11-18: the two sentences must not disagree; the note names no stale time; a raw error is never shown)
  ['with the button the card also says open the editor again in ten minutes', AE, "retryable ? \"Drawing the film's picture did not work this time.\" : (cardMsg ||", "(cardMsg ||", 'both'],
  ['a failure with no button loses the connector words', AE, "retryable ? \"Drawing the film's picture did not work this time.\" : (cardMsg || \"The film's picture is not available.\")", "\"Drawing the film's picture did not work this time.\"", 'both'],
  ['the too-early note names a time again', AE, "if (pressed && cardRefresh === 'failed') cardNote = 'Not yet. Please try again in a few minutes.';", "if (pressed && cardRefresh === 'failed') cardNote = 'Not yet: it can be tried again about ten minutes after it failed.';", 'both'],
  ['a refused press shows any error text', AE, "/^PT" + BS + "d{3}$/.test(e.code)", "true", 'both'],
];

function suites(cwd) {
  const gen = spawnSync(process.execPath, [path.join('tools', 'build-chat-editor.mjs')], { encoding: 'utf8', cwd });
  if (gen.status) return gen;
  return spawnSync(process.execPath, ['--test', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd });
}
function browser(cwd) {
  return spawnSync('py', ['-I', path.join('tools', 'check-chat-editor.py'), path.join(cwd, 'shots')], { encoding: 'utf8', cwd, env: { ...process.env } });
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  for (const d of ['supabase/functions', 'tests', 'assets', 'tools']) fs.cpSync(path.join(root, d), path.join(scratch, d), { recursive: true });
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
fresh();
if (suites(scratch).status) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
if (!browserOnly && browser(scratch).status) { console.log('BROWSER BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
console.log('baseline passes');
let missed = 0;
for (const [name, file, from, to, kind] of mutants) {
  fresh();
  const target = path.join(scratch, file);
  const src = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  const n = src.split(from).length - 1;
  if (n !== 1 || from === to) { console.log(`BROKEN MUTANT (text found ${n} times, need 1, or no change): ${name}`); missed++; continue; }
  fs.writeFileSync(target, src.replace(from, () => to));
  // SOURCE mutants must fail the offline suites; BOTH mutants must fail the offline suites AND the real-Chrome check (the behaviour is proved in the browser, the text is pinned offline)
  if (kind === 'browser' && browserOnly) { console.log(`skipped (browser only) ${name}`); continue; }
  const s = kind === 'browser' ? (spawnSync(process.execPath, [path.join('tools', 'build-chat-editor.mjs')], { encoding: 'utf8', cwd: scratch }).status === 0) : suites(scratch).status !== 0; // a browser-only mutant still needs the generated page rebuilt from the broken source, or Chrome sees the unbroken page
  const wantBrowser = (kind === 'both' || kind === 'browser') && !browserOnly;
  const bw = wantBrowser ? browser(scratch).status !== 0 : null;
  const caught = wantBrowser ? s && bw : s;
  const how = kind === 'browser' ? `real Chrome ${bw ? 'failed' : 'PASSED'}` : wantBrowser ? `offline suites ${s ? 'failed' : 'PASSED'}, real Chrome ${bw ? 'failed' : 'PASSED'}` : `offline suites ${s ? 'failed' : 'PASSED'}`;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name} (${how})`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught or broken` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
