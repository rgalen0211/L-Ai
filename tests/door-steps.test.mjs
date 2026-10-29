// King's Island W2 + W5 + W3 (NEXT-WEB 160): the door's two connect buttons open the Account page's steps for that assistant (and no longer the public guide), its two ways out are visible
// buttons, and the two download buttons have names that cannot be confused. Real-browser walks: tools/check-start.py and tools/check-download-data.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const start = read('assets/app-start.js'), lib = read('assets/app-library.js'), conn = read('assets/app-connect.js');

test('W2: the door links to the Account steps for each assistant, in the same tab, and not to the public guide', () => {
  assert.match(start, /href: '#\/account\?connect=claude', 'data-key': 'door-claude' \}, 'Connect Claude'/);
  assert.match(start, /href: '#\/account\?connect=chatgpt', 'data-key': 'door-chatgpt' \}, 'Connect ChatGPT \(beta\)'/);
  assert.doesNotMatch(start.replace(/\/\/.*$/gm, ''), /connect-ai/);
  assert.match(lib, /hash\.match\(\/\^#\\\/account\(\?:\\\?connect=\(claude\|chatgpt\)\)\?\$\/\)/);
  assert.match(lib, /accountView\(m\[1\] \|\| ''\)/);
  assert.match(conn, /const want = opts\.open === 'chatgpt' \? 'chatgpt' : 'claude'/);
  assert.match(conn, /open: k === want/);
});

test('W5: "No AI? Build it step by step" and "Not now" are visible buttons, with the same ids and behaviour as before', () => {
  assert.match(start, /const builderLink = \(\) => h\('a', \{ class: 'button secondary', href: '#\/build', 'data-key': 'door-builder' \}, 'No AI\? Build it step by step'\)/);
  assert.match(start, /h\('button', \{ class: 'button secondary', type: 'button', id: 'start-notnow', onclick: \(\) => \{ store\.set\(Date\.now\(\)\); location\.hash = '#\/'; \} \}, 'Not now'\)/);
});

test('W3: the account file and a dataset\'s files have different names', () => {
  assert.match(read('assets/app-account.js'), /'Download my account file'/);
  assert.match(read('assets/app-download-data.js'), /'data-key': 'download-my-data' \}, 'Download this dataset'/);
  assert.doesNotMatch(read('assets/app-account.js').replace(/\/\/.*$/gm, ''), /'Download my data'/);
  assert.doesNotMatch(read('assets/app-download-data.js').replace(/\/\/.*$/gm, ''), /\}, 'Download my data'/);
});
