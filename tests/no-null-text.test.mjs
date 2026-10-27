// A visible "null" on a page: DOM replaceChildren/append/prepend turn a null argument into the TEXT "null" (the app's own h() helper drops null children, the DOM methods do not).
// Found 2026-10-17 in the consumer audit: the Render panel printed "null" under the final-render button, and the Render approvals, Waitlist and Visits pages would print it when empty.
// This scans every asset script for a DOM call whose top-level argument is a ternary ending in ": null" (or a bare null/undefined) and fails, so it cannot come back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('../assets/', import.meta.url);
const DOM_CALLS = ['replaceChildren(', '.append(', '.prepend('];
const BACKSLASH = String.fromCharCode(92);

function topLevelArgs(src, open) {
  let depth = 0, cur = '';
  const args = [];
  let q = null, esc = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (q) { cur += c; if (esc) esc = false; else if (c === BACKSLASH) esc = true; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') { depth++; if (depth === 1 && c === '(') continue; cur += c; continue; }
    if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) { args.push(cur.trim()); return args; } cur += c; continue; }
    if (c === ',' && depth === 1) { args.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  return args;
}
const withoutComments = text => text.split('\n').map(line => { const at = line.search(/(^|\s)\/\//); return at >= 0 ? line.slice(0, at) : line; }).join('\n');

test('NO NULL TEXT: no DOM replaceChildren/append/prepend gets a null (or a ternary that can be null) as an argument', () => {
  const found = [];
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'profile-core.js')) {
    const src = withoutComments(fs.readFileSync(new URL(f, dir), 'utf8').split(BACKSLASH + 'r').join(''));
    for (const call of DOM_CALLS) {
      let at = -1;
      while ((at = src.indexOf(call, at + 1)) >= 0) {
        for (const arg of topLevelArgs(src, at + call.length - 1)) {
          if (arg.startsWith('...')) continue;                                                                // a spread of a filtered list
          if (/^(null|undefined)$/.test(arg) || /\?[\s\S]*:\s*(null|undefined)$/.test(arg)) found.push(`${f}:${src.slice(0, at).split('\n').length}: ${arg.slice(0, 70).replace(/\s+/g, ' ')}`);
        }
      }
    }
  }
  assert.deepEqual(found, [], 'these would print the word "null" on the page: ' + found.join(' | '));
});

test('NO NULL TEXT, the scanner itself: it catches the form that shipped, and lets a filtered spread through', () => {
  const bad = "orderBox.replaceChildren(shown.length ? h('ul', {}, shown) : null);";
  const args = topLevelArgs(bad, bad.indexOf('(', 10));
  assert.equal(args.length, 1);
  assert.match(args[0], /\?[\s\S]*:\s*null$/);
  assert.deepEqual(topLevelArgs('x.append(a, ...(b ? [c] : []))', 8).map(a => a.startsWith('...')), [false, true]);
  assert.equal(withoutComments('a(); // replaceChildren(null)').includes('null'), false);
});
