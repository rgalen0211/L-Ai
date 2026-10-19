// Every film card on the Ryagram landing page names its data, the same way the first two always did ("Data: ...").
// Found by WEB's read-only audit of the live film pages (2026-10-19): two of the four cards carried no source line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const html = fs.readFileSync(path.join(root, 'ryagram/index.html'), 'utf8');
const cards = [...html.matchAll(/<article class="rg-film">([\s\S]*?)<\/article>/g)].map(m => m[1]);

test('the landing page has its four film cards', () => assert.equal(cards.length, 4));

test('every film card has a "Data:" credit line that names a publisher', () => {
  const bad = cards.map((c, i) => [i + 1, c]).filter(([, c]) => !/<p class="rg-film-credit">Data: [^<]*(Census|CDC|Brooks)[^<]*<\/p>/.test(c)).map(([i]) => `card ${i}`);
  assert.deepEqual(bad, []);
});

test('every film card that links to a film also has a heading', () => {
  for (const c of cards) if (/Watch the full film/.test(c)) assert.match(c, /<h3>[^<]+<\/h3>/);
});
