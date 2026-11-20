// The chat host's reword() must SETTLE (CONNECT, 2026-11-20). The host runs reword() on every redraw through a MutationObserver (childList, subtree, characterData), and reword() itself writes the page
// (p.textContent = ..., and it inserts the plain "no picture" sentence). If one pass leaves text that the next pass rewrites again, each write re-fires the observer and the page loops forever: on 11-20 a planted
// fault of exactly that shape froze Chrome for 13 minutes. Behaviour in real Chrome is tools/check-chat-editor.py (it would hang, not fail); this file proves it offline in milliseconds, by running the REAL reword()
// source against a tiny fake page whose observer re-fires on every write, and proves the test itself can fail (the same page with the old planted fault does not settle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const HOST = fs.readFileSync(new URL('../tools/chat-editor/live-host.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const from = HOST.indexOf('const FOOT_OLD');
const to = HOST.indexOf('// ---- the call that opened the panel', from);
assert.ok(from > 0 && to > from, 'the reword block is where the test expects it');
const BLOCK = HOST.slice(from, to);

// A fake page: paragraphs whose textContent setter counts as a mutation, a card box, and an observer that re-runs reword() once per round while any write happened (what the real observer does).
function run(block, mode, paragraphs, withCard) {
  let writes = 0;
  const mk = (text) => ({ _t: text, get textContent() { return this._t; }, set textContent(v) { this._t = v; writes += 1; } });
  const ps = paragraphs.map(mk);
  const classes = new Set();
  let card = null;
  const root = {
    classList: { add: (c) => classes.add(c) },
    querySelectorAll: () => ps,
    querySelector: (sel) => (sel === '.le-card' ? card : null),
  };
  if (withCard) {
    card = { nextElementSibling: null, insertAdjacentElement(where, el) { assert.equal(where, 'afterend'); this.nextElementSibling = el; writes += 1; return el; } };
  }
  const h = (tag, attrs, text) => ({ tag, attrs, textContent: text, classList: { contains: (c) => String(attrs.class).split(' ').includes(c) } });
  const win = { ryagramLiveHost: { mode } };
  const doc = { getElementById: (id) => (id === 'live-root' ? root : null) };
  const api = new Function('window', 'document', 'h', block + '\nreturn { reword };')(win, doc, h);
  let rounds = 0;
  do { writes = 0; api.reword(); rounds += 1; } while (writes > 0 && rounds < 50);   // the observer fires again only if the last pass wrote something
  return { rounds, settled: writes === 0, texts: ps.map((p) => p.textContent), card, classes };
}

const FOOT_OLD = /const FOOT_OLD = '([^']+)'/.exec(BLOCK)[1];
const STAND_OLD = /const STAND_OLD = '([^']+)'/.exec(BLOCK)[1];
const TEXTS = [FOOT_OLD + ' More words after.', 'The picture is a made-up drawing.' + STAND_OLD, 'An ordinary line.'];

test('a data film settles within two passes: the footer is reworded once, the stand-in sentence is cut once, the plain sentence is added once', () => {
  const r = run(BLOCK, 'data', TEXTS, true);
  assert.ok(r.settled && r.rounds <= 3, `settled=${r.settled} rounds=${r.rounds}`);
  assert.ok(!r.texts.some((t) => t.includes(STAND_OLD)), 'no stand-in sentence is left');
  assert.ok(!r.texts.some((t) => t.startsWith(FOOT_OLD)), 'the old footer is gone');
  assert.equal(r.texts[2], 'An ordinary line.', 'other lines are left alone');
  assert.ok(r.card.nextElementSibling && r.card.nextElementSibling.attrs.class.includes('le-nopic'), 'the plain sentence follows the card box');
  assert.ok(r.classes.has('le-nosketch'));
});

test('a clip film and a page with no card settle too, and a clip film keeps its sentence and is not marked', () => {
  const clip = run(BLOCK, 'clips', TEXTS, true);
  assert.ok(clip.settled && clip.rounds <= 3);
  assert.ok(clip.texts[1].includes(STAND_OLD), 'a clip film is left as it is');
  assert.ok(!clip.classes.has('le-nosketch'));
  const nocard = run(BLOCK, 'data', TEXTS, false);
  assert.ok(nocard.settled && nocard.rounds <= 3);
});

test('running reword() again on a settled page writes NOTHING (idempotent)', () => {
  const r = run(BLOCK, 'data', ['Everything here is drawn and kept on your computer. x', 'a' + STAND_OLD], false);   // no card here: the plain sentence's own insert is proved once-only in the first test
  assert.ok(r.settled);
  // a second, separate run over the already reworded texts must not write
  const again = run(BLOCK, 'data', r.texts, false);
  assert.equal(again.rounds, 1, 'one pass, no writes');
});

test('MUST-FAIL: the old planted fault (re-assigning the same text) does NOT settle, so this test would catch it', () => {
  const bad = BLOCK.replace("p.textContent = p.textContent.replace(STAND_OLD, '');", 'p.textContent = p.textContent;');
  assert.notEqual(bad, BLOCK, 'the fault text was found');
  const r = run(bad, 'data', TEXTS, true);
  assert.ok(!r.settled && r.rounds === 50, `it must loop: settled=${r.settled} rounds=${r.rounds}`);
});
