// The chat panel's own copy of the film card's attribute check refuses a backslash (CONNECT, 2026-11-20; CC1's deep review LOW 1 of the audit merge). The connector already refuses a backslash in any attribute
// of the card's picture (film_card.ts checkSvg: a CSS escape such as a backslash plus 75 can spell the word url and so reach what is refused); the panel rebuilds the picture element by element and is the SECOND lock,
// so it must hold the same rule on its own: if the connector's check were ever weakened, the panel alone must still drop such an attribute. Real-Chrome behaviour of the card: tools/check-chat-editor.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EDITOR_HTML } from '../supabase/functions/connect-core/editor_page.ts';

const HOST = fs.readFileSync(new URL('../tools/chat-editor/live-host.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const GUARD = 'if (v.indexOf(String.fromCharCode(92)) >= 0) continue;';

test('drawCard drops any attribute whose value holds a backslash, before it looks at url references, and the built page carries the same line', () => {
  const draw = HOST.slice(HOST.indexOf('function drawCard(svg) {'), HOST.indexOf('window.ryagramLiveHost = {', HOST.indexOf('function drawCard(svg) {')));
  assert.ok(draw.includes(GUARD), 'the guard is in drawCard');
  assert.ok(draw.indexOf(GUARD) < draw.indexOf('/url\\(/i.test(v)'), 'it comes before the url reference rule, so an escaped spelling never reaches it');
  assert.ok(draw.indexOf(GUARD) > draw.indexOf('const v = String(a.value);'), 'it reads the value it was given');
  assert.ok(EDITOR_HTML.includes(GUARD), 'the generated page holds it');
});

test('the connector refuses the same thing first, by this exact line (the two locks agree)', () => {
  const server = fs.readFileSync(new URL('../supabase/functions/connect-core/film_card.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(server.includes('if (val.includes(String.fromCharCode(92))) return ["An attribute has a backslash'), 'film_card.ts refuses a backslash in an attribute value, by that line');
});
