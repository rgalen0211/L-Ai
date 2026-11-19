// The chat editor panel's half of Editor Step A (CONNECT, 2026-11-09; contract proposals/CONNECT-EDITOR-STEP-A-CONTRACT-1109.md): the film's real colours and one real still, drawn from a card the Ryagram computer made.
// Behaviour is proved in a real browser by tools/check-chat-editor.py (20 checks: real colours, the still rebuilt from the allowed elements only, no script, no outside address, waiting, failed, stale, unavailable, unparseable).
// This file pins, offline, the rules that must not drift in the source: who may run the card code, the one list of allowed picture parts (the same as the connector's checker), how often the panel asks, and what it says.
// Must-fails: tests/connect_film_card_panel_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EDITOR_HTML } from '../supabase/functions/connect-core/editor_page.ts';
import { SVG_ATTRS, SVG_ELEMENTS } from '../supabase/functions/connect-core/film_card.ts';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const HOST = read('tools/chat-editor/live-host.js'), EDITOR = read('assets/app-editor.js'), CSS = read('tools/chat-editor/chat-extra.css');
const list = (src, name) => [...new Function(`return ${new RegExp(`const ${name} = new Set\\((\\[[\\s\\S]*?\\])\\)`).exec(src)[1]}`)()];

test('only the chat host can run the card code: it sets filmCard and drawCard, and the editor needs both (the website and the maker never do)', () => {
  assert.match(HOST, /window\.ryagramLiveHost = \{ rpc, render, mode: 'compilation', project: '', media: null, title: '', filmCard: true, drawCard, siteLink \};/);
  assert.ok(EDITOR.includes("const cardOn = isData && !!host && host.filmCard === true && typeof hostRpc === 'function' && typeof host.drawCard === 'function' && !bundleMode;"));
  assert.ok(EDITOR.includes('if (cardOn) setTimeout(() => loadCard(true), 0);'), 'the first ask only when the card code may run');
  for (const other of ['tools/maker-live/live-host.js']) assert.ok(!/filmCard/.test(read(other)), `${other} does not offer the card`);
  assert.match(HOST, /const NAMES = \['editor_apply_ops', 'editor_undo', 'editor_undo_all_ai', 'my_edit_ops_since', 'editor_heartbeat', 'editor_film_card'\];/);
});

test('the chat host rebuilds the picture from EXACTLY the connector checker\'s allowed lists, and drops the rest', () => {
  assert.deepEqual(list(HOST, 'CARD_ELEMENTS').sort(), [...SVG_ELEMENTS].sort());
  assert.deepEqual(list(HOST, 'CARD_ATTRS').sort(), [...SVG_ATTRS].filter((a) => a !== 'xmlns').sort(), 'the same attributes (the one xmlns on the root is the checker\'s alone: the rebuild never copies it)');
  assert.deepEqual(list(HOST, 'CARD_TEXT').sort(), ['text', 'title', 'tspan']);
  for (const bad of ['script', 'style', 'image', 'foreignObject', 'use', 'animate']) assert.ok(!list(HOST, 'CARD_ELEMENTS').includes(bad), bad);
  for (const bad of ['style', 'href', 'class', 'onclick', 'onload']) assert.ok(!list(HOST, 'CARD_ATTRS').includes(bad), bad);
});

test('the rebuild keeps no address and no outside reference, renames every id, caps its size and depth, and never throws', () => {
  const from = HOST.indexOf('function drawCard(svg) {');
  const draw = HOST.slice(from, HOST.indexOf('window.ryagramLiveHost = {', from));
  assert.ok(draw.includes('svg.length > 300000) return null'), 'the size cap');
  assert.ok(draw.includes('depth > 30 || ++count > 30000'), 'the depth and element caps');
  // the film's hatch: a pattern keeps only direct line, path and rect children with nothing inside them, refers to nothing, has a tile of 2 to 64, and there are at most 100
  assert.deepEqual(list(HOST, 'PATTERN_CHILDREN').sort(), ['line', 'path', 'rect']);
  assert.ok(draw.includes("if (src.localName === 'pattern' && ++patterns > 100) throw new Error('too many patterns');"), 'at most 100 patterns');
  assert.ok(draw.includes("if (!tile('width') || !tile('height')) return null;"), 'a tile that is not 2 to 64 leaves the whole pattern out');
  assert.ok(draw.includes("if (patternish && /url\\(/i.test(v)) continue;"), 'a pattern and what is inside it refer to nothing');
  assert.ok(draw.includes("a.name === 'patternUnits' && v !== 'userSpaceOnUse' && v !== 'objectBoundingBox') continue;"), 'the units are one of two words');
  assert.ok(draw.includes("a.name === 'patternTransform') && src.localName !== 'pattern') continue;"), 'a pattern attribute only on a pattern');
  assert.ok(draw.includes("(!inPattern && !(src.localName === 'pattern') || (src.localName === 'pattern' && PATTERN_CHILDREN.has(n.localName)))"), 'a pattern holds its three kinds of child and nothing deeper');
  assert.ok(draw.includes("a.name === 'id' ? 'lecard-' + v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) : v"), 'ids are renamed');
  assert.ok(draw.includes("'ur' + 'l(#lecard-' + m[1] + ')'"), 'a paint reference follows the renamed id');
  assert.ok(draw.includes("['fill', 'stroke', 'clip-path'].includes(a.name)"), 'a reference only in the three paint attributes');
  assert.ok(draw.includes("a.name === 'lengthAdjust' && v !== 'spacing' && v !== 'spacingAndGlyphs') continue;"), 'a length adjustment is one of its two words or it is dropped');
  assert.ok(draw.includes("if (v === 'preserve' || v === 'default') el.setAttributeNS(XML_NS, 'xml:space', v)"), 'xml:space is kept only as one of its two words, in the xml namespace');
  assert.ok(draw.includes("a.name === 'textLength' && !/^\\d{1,5}(?:\\.\\d{1,3})?$/.test(v)) continue;"), 'a text length is a plain number or it is dropped');
  assert.ok(draw.includes('/javascript:|data:|https?:|\\/\\/|expression\\(/i.test(v)) continue;'), 'no address or script in a value');
  assert.ok(draw.includes("n.namespaceURI === SVG_NS && CARD_ELEMENTS.has(n.localName)"), 'only elements of the SVG namespace on the list');
  assert.ok(draw.includes("n.nodeType === 3 && CARD_TEXT.has(src.localName)"), 'text only inside text elements');
  assert.ok(draw.includes('} catch (e) { return null; }'), 'a bad picture is "no picture", never an error');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|\.src\s*=|setAttribute\('style'|XMLSerializer/.test(draw), 'nothing is built from markup text');
  assert.ok(!/createElementNS\(SVG_NS, '(script|style|image|use|foreignObject)'/.test(draw));
});

test('the panel asks once, then at most every 15 seconds and 40 times, and the person\'s own changes and the old card are never lost', () => {
  const block = EDITOR.slice(EDITOR.indexOf('async function loadCard(ask, pressed) {'), EDITOR.indexOf('// ---- the preview: a stand-in drawing'));
  assert.ok(block.includes("...(ask ? { p_ask: true } : {})"), 'p_ask only on the first call');
  assert.ok(block.includes("...(cardHave ? { p_have: cardHave } : {})"), 'a card already held is not fetched again');
  assert.ok(block.includes('++cardPolls < 40) {') && block.includes('setTimeout(() => loadCard(false), 15000);'));
  assert.ok(block.includes('if (!d) {') && /if \(pressed\) \{ const e = [^\n]*\n\s*return;\n\s*\}/.test(block), 'an unavailable tool changes nothing the person sees, except one sentence after their own press of Try again');
  assert.ok(block.includes("if (d.card && typeof d.card === 'object') {"), 'a reply without a card keeps the card already shown');
  assert.ok(block.includes("else if (cardState === 'failed' && card) cardRefresh = 'failed';"), 'a failed refresh keeps the old card');
  assert.ok(!block.includes('setInterval'), 'no fixed timer that could run on');
  // the film's own colours sit UNDER the person's draft and OVER the starting colours (the swatch line itself is the one tests/connect-editor-look.test.mjs pins)
  assert.ok(EDITOR.includes("'page.background': '#0d0d11', ...CARD_LOOK }, clips: [], duration: 0 });"));
  assert.ok(EDITOR.includes('value: ed.state.look[key] !== undefined ? ed.state.look[key] : DATA_BASE().look[key], id: `le-look-${key}`'));
  assert.ok(block.includes('CARD_LOOK[k] = v;'));
});

test('what the person reads: the waiting, the failed, the stale and the unparseable cases each have their sentence, in the built page too', () => {
  for (const s of ["Your film's own colours and picture are being drawn by the Ryagram computer. Until then the editor shows a simple stand-in.", ' It is taking a while: the Ryagram computer may be switched off.',
    'This picture is from an earlier version of the film.', 'A newer picture is being drawn.', 'A newer picture could not be drawn.', 'The picture of your film could not be shown here.',
    'These colours are from an earlier version of the film.', "These are the film's own colours, as saved. A colour you change here is yours.", "A colour the picture did not name is shown in the editor's own starting colour.",
    'It does not move when you change a colour here.', 'How your film looks']) {
    assert.ok(EDITOR.includes(s), s);
    assert.ok(EDITOR_HTML.includes(s.replace(/'/g, "'")), `the built page has it: ${s}`);
  }
  // the old sentence stays for a film with no card yet (the look test pins it)
  assert.ok(EDITOR.includes("lookNote(\"A colour this film has not changed is shown in the editor's own starting colour. The film's own colours are not shown here yet.\")"));
  assert.ok(CSS.includes('.le-card{') && CSS.includes('.le-cardpic svg{display:block;width:100%;height:100%}'));
});

test('Try again (CONNECT 11-18, card retry plan A): a button only for a picture the engine failed to draw, one press = one ask through the database\'s own ten-minute rule, words for "now", "not yet" and "could not ask", no timer of its own', () => {
  const block = EDITOR.slice(EDITOR.indexOf('const cardWaiting = '), EDITOR.indexOf('// ---- the preview: a stand-in drawing'));
  for (const s of ['Try again', 'You can try again now.', 'It can be tried again about ten minutes after it failed.', 'Not yet. Please try again in a few minutes.', 'Could not ask just now.', "Drawing the film's picture did not work this time."]) {
    assert.ok(EDITOR.includes(s), s);
    assert.ok(EDITOR_HTML.includes(s), `the built page has it: ${s}`);
  }
  assert.ok(block.includes("cardState === 'failed' && cardCode === 'engine_error'"), 'the button is for a picture that failed because the engine broke, and for nothing else (a film the engine cannot draw has nothing to retry)');
  assert.ok(block.includes("cardRefresh === 'failed' && cardRefreshCode === 'engine_error'"), 'and under an older picture whose newer one failed the same way');
  assert.ok(block.includes('cardRetry = d.retry === true') && block.includes('cardRefreshRetry = !!(d.refresh && d.refresh.retry === true)'), 'the words follow the database\'s own answer, not the panel\'s guess');
  assert.ok(block.includes("retryable ? \"Drawing the film's picture did not work this time.\" : (cardMsg ||"), 'with the button the card says only that it did not work, and the connector\'s longer "open the editor again in about ten minutes" is kept for a failure with no button, so the two never disagree');
  assert.ok(!block.includes('Not yet: it can be tried again about ten minutes'), 'the too-early note names no time (nothing re-reads the card, so a time would go stale)');
  assert.ok(block.includes('/^PT\\d{3}$/.test(e.code)'), 'a refused press shows the connector\'s own words only for the codes it writes for people, never raw database or network text');
  assert.ok(block.includes('await loadCard(true, true);'), 'a press is the same call as opening the editor: with p_ask, so the database decides');
  assert.equal([...block.matchAll(/loadCard\(true/g)].length, 1, 'p_ask is sent from exactly one place: the press');
  assert.ok(block.includes('if (cardBusy) return;'), 'a second press while the first is out does nothing');
  assert.ok(!/setTimeout\([^)]*tryCardAgain|setInterval/.test(block), 'the panel never retries by itself: only the person\'s press asks again');
  assert.ok(block.includes("cardPolls = 0;"), 'a press that is accepted gets the usual 40 reads to watch it');
  assert.ok(block.includes('disabled: cardBusy'), 'the button is off while the ask is out');
  assert.ok(!/\b(alert|confirm|prompt)\s*\(/.test(block), 'no browser box');
  assert.ok(CSS.includes('.le-cardretry{margin-top:8px}') && CSS.includes('.le-cardretry p{margin:0 0 6px}'), 'the retry line has its own small style');
});

test('Step B (card retry plan B, CONNECT 11-18): an open panel notices without a reload, with a few READS and never an ask, and every count is bounded', () => {
  const block = EDITOR.slice(EDITOR.indexOf('const cardWaiting = '), EDITOR.indexOf('// ---- the preview: a stand-in drawing'));
  assert.ok(block.includes('else if (waiting && cardSlow++ < 10) {') && block.includes('setTimeout(() => loadCard(false), 120000);'), 'after the 39 quick reads, 10 slow ones every 2 minutes, then none');
  assert.ok(block.includes('else if (tooSoon && cardQuiet++ < 1) {') && block.includes('setTimeout(() => loadCard(false), 620000);'), 'a failed picture not yet old enough: ONE quiet read about 10 minutes 20 seconds on');
  assert.ok(block.includes("const tooSoon = (cardCode === 'engine_error' && cardState === 'failed' && !cardRetry) || (cardState === 'ready' && cardRefreshCode === 'engine_error' && cardRefresh === 'failed' && !cardRefreshRetry);"), 'only the kind a retry can fix, and only while the database says not yet');
  assert.ok(block.includes('cardPolls = 0; cardSlow = 0; cardQuiet = 0; paintCard();'), 'a press starts the counts again');
  assert.equal([...block.matchAll(/loadCard\(true/g)].length, 1, 'every timer reads (loadCard(false)); only the press asks');
  assert.ok(!block.includes('setInterval'), 'no fixed timer that could run on');
});

test('Step B, GAMES review 11-18 finding 1: a stopped view stops its card reads (the timer is cleared, a read in flight paints nothing and parks nothing)', () => {
  const block = EDITOR.slice(EDITOR.indexOf('const cardWaiting = '), EDITOR.indexOf('// ---- the preview: a stand-in drawing'));
  assert.ok(EDITOR.includes('let cardStopped = false; onStop(() => { cardStopped = true; clearTimeout(cardTimer); });'), 'the view stopping clears the card timer and says so');
  assert.ok(block.includes('if (!cardOn || !project || cardStopped) return;'), 'a stopped view starts no read');
  assert.ok(block.includes('if (cardStopped) return;\n        const d = r &&'), 'a read that comes back after the stop paints nothing and parks no timer');
});

test('the built page carries all of it and stays inside its budget', () => {
  assert.ok(EDITOR_HTML.includes('function drawCard(svg)') && EDITOR_HTML.includes('async function loadCard(ask, pressed)'));
  assert.ok(EDITOR_HTML.includes("filmCard: true, drawCard, siteLink }"));
  assert.ok(Buffer.byteLength(EDITOR_HTML) <= 300 * 1024, `${Buffer.byteLength(EDITOR_HTML)} bytes`);
  assert.ok(!EDITOR_HTML.includes('url('), 'the page names no CSS address (the rebuild writes the paint reference in two pieces)');
});
