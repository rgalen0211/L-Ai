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
  assert.match(HOST, /window\.ryagramLiveHost = \{ rpc, render, mode: 'compilation', project: '', media: null, title: '', filmCard: true, drawCard \};/);
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
  assert.ok(draw.includes('svg.length > 200000) return null'), 'the size cap');
  assert.ok(draw.includes('depth > 30 || ++count > 30000'), 'the depth and element caps');
  assert.ok(draw.includes("a.name === 'id' ? 'lecard-' + v.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) : v"), 'ids are renamed');
  assert.ok(draw.includes("'ur' + 'l(#lecard-' + m[1] + ')'"), 'a paint reference follows the renamed id');
  assert.ok(draw.includes("['fill', 'stroke', 'clip-path'].includes(a.name)"), 'a reference only in the three paint attributes');
  assert.ok(draw.includes('/javascript:|data:|https?:|\\/\\/|expression\\(/i.test(v)) continue;'), 'no address or script in a value');
  assert.ok(draw.includes("n.namespaceURI === SVG_NS && CARD_ELEMENTS.has(n.localName)"), 'only elements of the SVG namespace on the list');
  assert.ok(draw.includes("n.nodeType === 3 && CARD_TEXT.has(src.localName)"), 'text only inside text elements');
  assert.ok(draw.includes('} catch (e) { return null; }'), 'a bad picture is "no picture", never an error');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|\.src\s*=|setAttribute\('style'|XMLSerializer/.test(draw), 'nothing is built from markup text');
  assert.ok(!/createElementNS\(SVG_NS, '(script|style|image|use|foreignObject)'/.test(draw));
});

test('the panel asks once, then at most every 15 seconds and 40 times, and the person\'s own changes and the old card are never lost', () => {
  const block = EDITOR.slice(EDITOR.indexOf('async function loadCard(ask) {'), EDITOR.indexOf('// ---- the preview: a stand-in drawing'));
  assert.ok(block.includes("...(ask ? { p_ask: true } : {})"), 'p_ask only on the first call');
  assert.ok(block.includes("...(cardHave ? { p_have: cardHave } : {})"), 'a card already held is not fetched again');
  assert.ok(block.includes('++cardPolls < 40) {') && block.includes('setTimeout(() => loadCard(false), 15000);'));
  assert.ok(block.includes("if (!d) return;"), 'an unavailable tool changes nothing the person sees');
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

test('the built page carries all of it and stays inside its budget', () => {
  assert.ok(EDITOR_HTML.includes('function drawCard(svg)') && EDITOR_HTML.includes('async function loadCard(ask)'));
  assert.ok(EDITOR_HTML.includes("filmCard: true, drawCard }"));
  assert.ok(Buffer.byteLength(EDITOR_HTML) <= 300 * 1024, `${Buffer.byteLength(EDITOR_HTML)} bytes`);
  assert.ok(!EDITOR_HTML.includes('url('), 'the page names no CSS address (the rebuild writes the paint reference in two pieces)');
});
