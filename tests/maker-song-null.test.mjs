// The desktop maker's song page must never write the word "null" (CC1 18:27, found 2026-10-26 in tonight's rehearsal: it showed twice, under the words box and above the word-by-word board).
// Cause: the page built those panels with the browser's own append(), which writes the TEXT "null" for a null argument. Every append now goes through put(), which skips null, undefined and false the
// way the page's own h() helper does. The page in real Chrome is tools/check-maker-song.py (it asserts no stray null/undefined/NaN on the words page and on the board, and fails on the old code).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src = fs.readFileSync(new URL('../tools/maker-song/song.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = src.replace(/^\s*\/\/.*$/gm, '');

test('PUT: skips null, undefined and false (at any depth), keeps 0 and text, and never writes the word null', () => {
  const line = code.split('\n').find(l => l.trim().startsWith('const put = '));
  assert.ok(line, 'the page has put()');
  class Node {}
  const ctx = { Node, document: { createTextNode: t => ({ text: t }) } };
  vm.runInNewContext(`${line}\nthis.put = put;`, ctx);
  const added = [];
  const el = { append: k => added.push(k.text !== undefined ? k.text : k) };
  const same = ctx.put(el, 'a', null, undefined, false, 0, ['b', null, ['c', undefined, false]], 'd');
  assert.equal(same, el, 'it returns the element');
  assert.deepEqual(added, ['a', '0', 'b', 'c', 'd']);
  const node = new Node();
  const el2 = { append: k => added.push(k) };
  ctx.put(el2, node);
  assert.equal(added[added.length - 1], node, 'a real node is appended as it is');
  assert.ok(!added.some(x => x === 'null' || x === 'undefined' || x === 'false'));
});

test('NO RAW APPEND: the only append() calls left on the song page are the script loader, h() and put() itself; every panel goes through put()', () => {
  const raw = code.split('\n').filter(l => l.includes('.append('));
  assert.equal(raw.length, 3, raw.map(l => l.trim().slice(0, 70)).join(' | '));
  assert.ok(raw.some(l => l.includes('document.head.append(')), 'the script loader');
  assert.ok(raw.some(l => l.includes('el.append(k instanceof Node ? k : document.createTextNode(String(k)))') && l.includes('for (let i = plain')), 'h()');
  assert.ok(raw.some(l => l.includes('const put =')), 'put()');
  assert.ok((code.match(/\bput\(/g) || []).length >= 20, 'the panels use put()');
});

test('MUST-FAIL: a raw append of a possible null on this page is caught by the same guard', () => {
  const bad = code + "\n  box.append(h('h2', {}, 'x'), S.guide ? h('span', {}, 'g') : null);\n";
  assert.equal(bad.split('\n').filter(l => l.includes('.append(')).length, 4, 'one more raw append than allowed');
});
