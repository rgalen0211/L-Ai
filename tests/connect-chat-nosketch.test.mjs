// The chat editor panel never shows the stand-in sketch for a data film (CONNECT, 2026-11-20; paper proposals/CONNECT-CHAT-PANEL-STANDIN-1120.md, fix A).
// The editor page (assets/app-editor.js, the website's own code, shared with the site and the maker) draws invented shapes as a data film's preview. In the chat the film's own picture is the card still, so the chat host
// (tools/chat-editor/live-host.js) marks a DATA film's panel with .le-nosketch, chat-extra.css hides the sketch, its slider row and the five "waiting for the engine" rows under that class, and a plain sentence (.le-nopic)
// stands in the picture's place while there is no card box. The shared editor file is NOT changed. Behaviour in real Chrome: tools/check-chat-editor.py. Must-fails: tests/connect_film_card_panel_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EDITOR_HTML } from '../supabase/functions/connect-core/editor_page.ts';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const HOST = read('tools/chat-editor/live-host.js'), CSS = read('tools/chat-editor/chat-extra.css'), EDITOR = read('assets/app-editor.js'), TOOLS = read('supabase/functions/connect-core/editor_tools.ts');

test('the chat host marks only a DATA film, and puts the plain sentence right after the card box exactly once', () => {
  const from = HOST.indexOf('function noSketch(root) {');
  const fn = HOST.slice(from, HOST.indexOf('function reword() {', from));
  assert.ok(fn.includes("if (window.ryagramLiveHost.mode !== 'data') return;"), 'a clip film is left as it is');
  assert.ok(fn.includes("root.classList.add('le-nosketch');"), 'the marker class');
  assert.ok(fn.includes("const card = root.querySelector('.le-card');"));
  assert.ok(fn.includes("if (card && !(card.nextElementSibling && card.nextElementSibling.classList.contains('le-nopic'))) card.insertAdjacentElement('afterend', h('p', { class: 'meta le-nopic', role: 'status' }, NOPIC));"), 'once, after the card box, so a sibling rule can show it');
  assert.ok(HOST.includes("const NOPIC = \"No picture of your film is shown here yet. The film's real frames are in the editor on the Ryagram website.\";"));
  assert.ok(!/stand-in/i.test(HOST.slice(HOST.indexOf('const NOPIC'), HOST.indexOf('\n', HOST.indexOf('const NOPIC')))), 'the sentence names no stand-in');
});

test('reword runs the marker on every redraw and cuts the one sentence that mentions a stand-in, in a data film only', () => {
  const from = HOST.indexOf('function reword() {');
  const fn = HOST.slice(from, HOST.indexOf('// ---- the call that opened the panel', from));
  assert.ok(fn.includes("else if (window.ryagramLiveHost.mode === 'data' && p.textContent.indexOf(STAND_OLD) > 0) p.textContent = p.textContent.replace(STAND_OLD, '');"));
  assert.ok(fn.includes('noSketch(root);'));
  assert.ok(/reword\(\);\s*if \(typeof MutationObserver === 'function'\) new MutationObserver\(reword\)/.test(HOST), 'it runs once the film opens and again whenever the page redraws');
  // the sentence it cuts must still be the editor's own words, or the cut would silently stop working
  const old = /const STAND_OLD = '([^']+)';/.exec(HOST)[1];
  assert.ok(EDITOR.includes(old), 'the shared editor still says it: ' + old);
});

test('the stylesheet hides the sketch, the slider row, the keys line, the years and the five waiting rows ONLY under .le-nosketch, and shows the sentence only while the card box is hidden', () => {
  for (const sel of ['.le-nosketch .le-standin>.le-view', '.le-nosketch .le-standin>.le-scrub', '.le-nosketch .le-standin>.le-tl-holder', '.le-nosketch .le-standin>.le-ticks', '.le-nosketch .le-standin>.le-keys', '.le-nosketch .le-row.le-waiting']) {
    assert.ok(CSS.includes(sel), sel);
  }
  assert.ok(CSS.includes('.le-nosketch .le-row.le-waiting{display:none!important}'));
  assert.ok(/\.le-nopic\{display:none;/.test(CSS), 'hidden unless a rule shows it');
  assert.ok(CSS.includes('.le-card[hidden]+.le-nopic{display:block}'), 'shown only while there is no card box');
  assert.ok(!/(^|\n)\.le-standin>\.le-view/.test(CSS) && !/(^|\n)\.le-view\{display:none/.test(CSS), 'no rule hides the sketch without the marker');
  // the maker's page and the website never load this file
  assert.ok(!fs.readFileSync(new URL('../tools/maker-live/live-host.js', import.meta.url), 'utf8').includes('le-nosketch'));
});

test('the built page carries the same host code and rules as the sources (it was regenerated)', () => {
  for (const t of ["root.classList.add('le-nosketch');", "card.insertAdjacentElement('afterend'", 'No picture of your film is shown here yet.', '.le-card[hidden]+.le-nopic{display:block}', '.le-nosketch .le-row.le-waiting{display:none!important}', "p.textContent.replace(STAND_OLD, '')"]) {
    assert.ok(EDITOR_HTML.includes(t), t);
  }
});

test('the shared editor file is untouched by this change: it still draws its stand-in (the maker and the website keep it) and still has the five waiting rows', () => {
  assert.ok(EDITOR.includes("title.textContent = 'Stand-in drawing"), 'the sketch is still there for the other hosts');
  assert.ok(EDITOR.includes("const WAITING = ['Theme', 'Marker shape', 'Border width', 'Glow', 'Labels'];"));
});

test('the connector never tells the panel to keep a stand-in picture: a film the engine cannot draw, or a picture too big, says no picture is shown here and where the real frames are', () => {
  assert.ok(!/stand-in picture/i.test(TOOLS), 'no "stand-in picture" in the connector words');
  assert.ok(TOOLS.includes('view_not_supported: "The engine cannot draw a picture of this kind of film yet, so no picture is shown here. The film\'s real frames are in the editor on the Ryagram website.",'));
  assert.ok(TOOLS.includes("No picture is shown here; the film's real frames are in the editor on the Ryagram website.`"));
});
