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
const H = 'tools/chat-editor/live-host.js', AE = 'assets/app-editor.js', CSS = 'tools/chat-editor/chat-extra.css', ET = 'supabase/functions/connect-core/editor_tools.ts';
const SUITES = ['connect-film-card-panel.test.mjs', 'connect-chat-editor.test.mjs', 'connect-chat-nosketch.test.mjs', 'connect-film-card.test.mjs', 'connect-panel-card-backslash.test.mjs'];
const BS = String.fromCharCode(92);
const ADDRESS = `} else if (/javascript:|data:|https?:|${BS}/${BS}/|expression${BS}(/i.test(v)) continue;`;
const browserOnly = process.argv.includes('--no-browser');

// [name, file, from, to, kind]
const mutants = [
  ['the panel drops the length adjustment the connector allows', H, "'textLength', 'lengthAdjust', 'xml:space', 'dx',", "'textLength', 'xml:space', 'dx',", 'source'],
  ['the panel keeps an attribute with a backslash', H, "if (v.indexOf(String.fromCharCode(92)) >= 0) continue;", "", 'source'],
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
  ['a press that is taken gets no reads to watch it', AE, "cardBusy = true; cardNote = ''; cardPolls = 0; cardSlow = 0; cardQuiet = 0; paintCard();", "cardBusy = true; cardNote = ''; cardSlow = 0; cardQuiet = 0; paintCard();", 'source'],
  ['the retry line has no style', CSS, '.le-cardretry{margin-top:8px}', '', 'source'],
  // ---- Try again words (GAMES review 11-18: the two sentences must not disagree; the note names no stale time; a raw error is never shown)
  ['with the button the card also says open the editor again in ten minutes', AE, "retryable ? \"Drawing the film's picture did not work this time.\" : (cardMsg ||", "(cardMsg ||", 'both'],
  ['a failure with no button loses the connector words', AE, "retryable ? \"Drawing the film's picture did not work this time.\" : (cardMsg || \"The film's picture is not available.\")", "\"Drawing the film's picture did not work this time.\"", 'both'],
  ['the too-early note names a time again', AE, "if (pressed && cardRefresh === 'failed') cardNote = 'Not yet. Please try again in a few minutes.';", "if (pressed && cardRefresh === 'failed') cardNote = 'Not yet: it can be tried again about ten minutes after it failed.';", 'both'],
  ['a refused press shows any error text', AE, "typeof e.code === 'string' && /^PT" + BS + "d{3}$/.test(e.code) && ", "", 'both'],
  // ---- Step B (11-18): the open panel notices, with reads only
  ['the quiet re-read comes far too soon', AE, '(age >= 0 ? 620000 - age * 1000 : 620000)', '(age >= 0 ? 620000 - age * 1000 : 6200)', 'both'],
  ['the quiet re-read asks', AE, 'cardTimer = setTimeout(() => loadCard(false), quietMs(', 'cardTimer = setTimeout(() => loadCard(true), quietMs(', 'both'],
  ['the quiet re-read repeats for ever', AE, 'cardQuiet++ < 1', 'cardQuiet++ < 100', 'both'],
  ['the quiet re-read is a fixed timer that runs on', AE, 'cardTimer = setTimeout(() => loadCard(false), quietMs(', 'cardTimer = setInterval(() => loadCard(false), quietMs(', 'both'],
  ['a film the engine cannot draw is read again too', AE, "(cardCode === 'engine_error' && cardState === 'failed' && !cardRetry)", "(cardState === 'failed' && !cardRetry)", 'browser'],
  ['the slow reads never stop', AE, 'cardSlow++ < 10', 'cardSlow++ < 100000', 'both'],
  ['the slow reads ask', AE, 'loadCard(false), 120000', 'loadCard(true), 120000', 'both'],
  ['there are no slow reads', AE, 'else if (waiting && cardSlow++ < 10)', 'else if (false)', 'both'],
  ['a press does not start the quiet re-read again', AE, 'cardSlow = 0; cardQuiet = 0; paintCard();', 'cardSlow = 0; paintCard();', 'source'],
  // ---- Step B, GAMES review finding 1 (11-18): a stopped view stops its card reads
  ['the view stopping does not clear the card timer', AE, 'cardStopped = true; clearTimeout(cardTimer);', 'cardStopped = true;', 'source'],
  ['a stopped view still starts a read', AE, '!project || cardStopped) return;', '!project) return;', 'source'],
  ['a read in flight after the stop still paints and parks a timer', AE, 'if (cardStopped) return;\n        const d = r &&', 'const d = r &&', 'source'],
  // ---- Step B, GAMES finding 2 (11-19): the quiet re-read is timed from the failure
  ['the age is ignored: always the fixed wait', AE, '(age >= 0 ? 620000 - age * 1000 : 620000)', '(false ? 620000 - age * 1000 : 620000)', 'both'],
  ['the age is counted in minutes', AE, '620000 - age * 1000 : 620000)', '620000 - age * 60000 : 620000)', 'both'],
  ['an age beyond what the database still refuses is trusted', AE, "n >= 0 && n <= 600 ? n : -1", "n >= 0 && n <= 600000 ? n : -1", 'both'],
  // (a negative age passing ageOf alone is NOT a mutant: quietMs turns any age below 0 into the fixed wait too, so the two guards back each other; the guard in quietMs has its own mutant below, and the Chrome scenario feeds -5)
  ['a missing or negative age counts as an age', AE, '(age >= 0 ? 620000 - age * 1000 : 620000)', '(true ? 620000 - age * 1000 : 620000)', 'both'],
  ['a text that looks like a number is trusted as an age', AE, "typeof n === 'number' && n >= 0", "n >= 0", 'both'],
  ['a failed refresh is timed from the newest picture age', AE, "quietMs(cardState === 'failed' ? cardAge : cardRefreshAge)", "quietMs(cardAge)", 'both'],
  ['the refresh age is never read from the answer', AE, "cardRefreshAge = ageOf(d.refresh && d.refresh.failed_s);", "cardRefreshAge = -1;", 'both'],
  // ---- the chat panel never shows the stand-in sketch for a data film (CONNECT 11-20, fix A of CONNECT-CHAT-PANEL-STANDIN-1120.md); the shared editor file is not touched
  ['a data film is never marked: the sketch stays', H, "root.classList.add('le-nosketch');", "", 'both'],
  ['a CLIP film is marked too', H, "if (window.ryagramLiveHost.mode !== 'data') return;", "if (false) return;", 'both'],
  ['the sketch picture is not hidden', CSS, ".le-nosketch .le-standin>.le-view,", "", 'both'],
  ['the slider row is not hidden', CSS, ".le-nosketch .le-standin>.le-scrub,", "", 'both'],
  ['the years under the sketch are not hidden', CSS, ".le-nosketch .le-standin>.le-ticks,", "", 'both'],
  ['the timeline holder under the sketch is not hidden', CSS, ".le-nosketch .le-standin>.le-tl-holder,", "", 'source'],
  ['the keys line under the sketch is not hidden', CSS, ".le-nosketch .le-standin>.le-keys,", "", 'both'],
  ['the five waiting rows are not hidden', CSS, ".le-nosketch .le-row.le-waiting{display:none!important}", ".le-nosketch .le-row.le-waitingx{display:none!important}", 'both'],
  ['the plain sentence never shows', CSS, ".le-card[hidden]+.le-nopic{display:block}", ".le-card[hidden]+.le-nopic{display:none}", 'both'],
  ['the plain sentence always shows', CSS, ".le-nopic{display:none;", ".le-nopic{display:block;", 'both'],
  ['the plain sentence is never added', H, "if (card && !(card.nextElementSibling", "if (false && card && !(card.nextElementSibling", 'both'],
  ['the waiting sentence still says stand-in', H, "window.ryagramLiveHost.mode === 'data' && p.textContent.indexOf(STAND_OLD) > 0", 'false', 'both'],
  ['the plain sentence points to a stand-in', H, "const NOPIC = \"No picture of your film is shown here yet. The film's real frames", "const NOPIC = \"No picture of your film is shown here yet. The stand-in is on show; the film's real frames", 'both'],
  ['the connector tells a film the engine cannot draw to keep a stand-in', ET, "so no picture is shown here. The film's real frames are in the editor on the Ryagram website.\",", "The editor keeps its stand-in picture.\",", 'source'],
  ['the connector tells a too big picture to keep a stand-in', ET, "No picture is shown here; the film's real frames are in the editor on the Ryagram website.`", "The editor keeps its stand-in picture.`", 'source'],
];

function suites(cwd) {
  const gen = spawnSync(process.execPath, [path.join('tools', 'build-chat-editor.mjs')], { encoding: 'utf8', cwd });
  if (gen.status) return gen;
  return spawnSync(process.execPath, ['--test', ...SUITES.map((s) => path.join('tests', s))], { encoding: 'utf8', cwd });
}
function browser(cwd) {
  return spawnSync('py', ['-I', path.join('tools', 'check-chat-editor.py'), path.join(cwd, 'shots')], { encoding: 'utf8', cwd, env: { ...process.env }, timeout: 420000, killSignal: 'SIGKILL' });   // a frozen page must END the check (and be named HUNG), never stall the whole run (11-20: a planted fault that re-fired the page's own observer froze Chrome for 13 minutes)
}
function fresh() {
  fs.rmSync(scratch, { recursive: true, force: true });
  fs.mkdirSync(scratch, { recursive: true });
  for (const d of ['supabase/functions', 'tests', 'assets', 'tools']) fs.cpSync(path.join(root, d), path.join(scratch, d), { recursive: true });
  if (fs.existsSync(path.join(root, 'package.json'))) fs.copyFileSync(path.join(root, 'package.json'), path.join(scratch, 'package.json'));
}
fresh();
if (suites(scratch).status) { console.log('BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
if (!browserOnly && (() => { const r = browser(scratch); return r.error || r.status; })()) { console.log('BROWSER BASELINE FAILS (nothing proved)'); fs.rmSync(scratch, { recursive: true, force: true }); process.exit(2); }
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
  const bres = wantBrowser ? browser(scratch) : null;
  if (bres && bres.error) { console.log(`HUNG    ${name} (the real-Chrome check did not end in 7 minutes: not counted as caught; write the fault so the page fails, not freezes)`); missed++; continue; }
  const bw = bres ? bres.status !== 0 : null;
  const caught = wantBrowser ? s && bw : s;
  const how = kind === 'browser' ? `real Chrome ${bw ? 'failed' : 'PASSED'}` : wantBrowser ? `offline suites ${s ? 'failed' : 'PASSED'}, real Chrome ${bw ? 'failed' : 'PASSED'}` : `offline suites ${s ? 'failed' : 'PASSED'}`;
  console.log(`${caught ? 'caught ' : 'MISSED '} ${name} (${how})`);
  if (!caught) missed++;
}
fs.rmSync(scratch, { recursive: true, force: true });
console.log(missed ? `${missed} mutant(s) not caught or broken` : `all ${mutants.length} mutants caught`);
process.exit(missed ? 1 : 0);
