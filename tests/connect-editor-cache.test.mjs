// The editor page in the AI chat must never be a STALE page (CONNECT, 2026-11-08; Ryan's 11:06 note: after the Q513 fix and a redeploy a new Claude chat still showed the old page's error).
// A host that keeps a connector's pages by address would keep serving the old page. So: the page's address carries the build (a hash of everything the page is made from), the page and its error words name
// the build, the old address is answered with the CURRENT page, and every string-method call in the scripts the page loads is a reviewed one. Must-fails: tests/connect_editor_cache_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { JS, buildId, early } from '../tools/build-chat-editor.mjs';
import { EDITOR_BUILD, EDITOR_HTML } from '../supabase/functions/connect-core/editor_page.ts';
import { CARD_URI, EDITOR_URI, EDITOR_URI_LEGACY, isEditorUri, readResource, resourceList } from '../supabase/functions/connect-core/mcp_app.ts';

const ON = { enabled: true, chatEditor: true };
const CARD_ONLY = { enabled: true };
const sha12 = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);

test('the page address carries the build, so a host that keeps pages by address can never show an old page under it', () => {
  assert.match(EDITOR_BUILD, /^[0-9a-f]{12}$/);
  assert.equal(EDITOR_URI, 'ui://ryagram/editor-' + EDITOR_BUILD);
  assert.notEqual(EDITOR_URI, EDITOR_URI_LEGACY, 'the address changed from the one hosts may hold from before');
  assert.equal(EDITOR_BUILD, buildId(), 'the committed id is the one the generator makes from the sources');
  assert.deepEqual(resourceList(ON).map((r) => r.uri), [CARD_URI, EDITOR_URI], 'only the current address is listed');
  assert.deepEqual(resourceList(CARD_ONLY).map((r) => r.uri), [CARD_URI]);
});

test('the build id is a hash of the WHOLE page (any source, the policy or the first script), worked out here from the committed page itself', () => {
  const blank = EDITOR_HTML.replace(`data-build="${EDITOR_BUILD}"`, 'data-build=""').replace(`Panel build ${EDITOR_BUILD}.`, 'Panel build .');
  assert.notEqual(blank, EDITOR_HTML);
  assert.equal(sha12(blank), EDITOR_BUILD);
  // it is in the page exactly where it should be and nowhere else
  assert.equal(EDITOR_HTML.split(EDITOR_BUILD).length - 1, 2);
});

test('the first script ends its error words with the build, so "old page or new page" is read straight off the panel', () => {
  const first = EDITOR_HTML.slice(EDITOR_HTML.indexOf('<script>') + 8, EDITOR_HTML.indexOf('</script>'));
  assert.equal(first, early(EDITOR_BUILD));
  let handler = null;
  const root = { querySelector: () => null, textContent: 'x', kids: [], appendChild(p) { this.kids.push(p); } };
  const logged = [];
  const ctx = { console: { error: (...a) => logged.push(a) }, addEventListener: (type, fn) => { if (type === 'error') handler = fn; }, document: { getElementById: (id) => (id === 'live-root' ? root : null), createElement: () => ({}) } };
  vm.runInNewContext(first, ctx);
  assert.equal(typeof handler, 'function');
  handler({ message: 'Uncaught TypeError: Cannot read properties of undefined (reading \'toLowerCase\')', filename: 'https://host.example/bridge.js', lineno: 12, colno: 7,
    error: { stack: 'TypeError: x\n    at lower (https://host.example/bridge.js:12:7)\n    at onMessage (https://host.example/bridge.js:40:2)\n    at third (nope)' } });
  const p = root.kids[0];
  assert.match(p.textContent, /could not draw\. Ask your AI to open the editor in the Ryagram app instead\. \(Uncaught TypeError: Cannot read properties of undefined \(reading 'toLowerCase'\)\) At https:\/\/host\.example\/bridge\.js line 12 column 7\. Stack: at lower \(https:\/\/host\.example\/bridge\.js:12:7\) \| at onMessage \(https:\/\/host\.example\/bridge\.js:40:2\)\. Panel build [0-9a-f]{12}\.$/);
  assert.ok(!p.textContent.includes('third'), 'only the first two stack lines');
  assert.ok(p.textContent.endsWith(`Panel build ${EDITOR_BUILD}.`));
  assert.equal(logged.length, 1, 'the whole error is also written to the console');
  assert.equal(logged[0][0], 'Ryagram panel error');
  assert.equal(logged[0][2], 'https://host.example/bridge.js');
  assert.equal(logged[0][3], 12);
  // no detail, and a message full of control and non-ASCII characters, still end with the build
  root.kids = [];
  handler({ message: '\u202e\u0000evil\u2028' });
  assert.ok(root.kids[0].textContent.endsWith(`Panel build ${EDITOR_BUILD}.`) && !/[^\x20-\x7e]/.test(root.kids[0].textContent));
  root.kids = [];
  handler(null);
  assert.match(root.kids[0].textContent, /\(no detail\) At unknown line \? column \?\. Panel build /);
  // a host script that reports no detail at all (a cross-origin script) still gives words, with the file when it has one
  root.kids = [];
  handler({ message: 'Script error.', filename: '', lineno: 0, colno: 0 });
  assert.match(root.kids[0].textContent, /\(Script error\.\) At unknown line \? column \?\. Panel build /);
});

test('every address of the editor answers with the CURRENT page, under the address that was asked for, and only when the editor switch is on', () => {
  const old = 'ui://ryagram/editor-0123456789ab';
  for (const uri of [EDITOR_URI, EDITOR_URI_LEGACY, old]) {
    const r = readResource(uri, ON);
    assert.ok(r, uri);
    assert.equal(r.contents[0].uri, uri);
    assert.equal(r.contents[0].text, EDITOR_HTML);
    assert.equal(readResource(uri, CARD_ONLY), null, `${uri}: nothing without the editor switch`);
  }
  for (const bad of ['ui://ryagram/editor-', 'ui://ryagram/editor-0123456789a', 'ui://ryagram/editor-0123456789abc', 'ui://ryagram/editor-0123456789AB', 'ui://ryagram/editor-0123456789ab/', 'ui://ryagram/editor-../card', 'ui://ryagram/editor0123456789ab', 'ui://other/editor-0123456789ab', 'https://x/editor-0123456789ab', '', null, 7, ['ui://ryagram/editor']]) {
    assert.equal(isEditorUri(bad), false, String(bad));
    assert.equal(readResource(bad, ON), null, String(bad));
  }
  assert.equal(readResource(CARD_URI, ON).contents[0].uri, CARD_URI);
});

// ---- every string-method call in the scripts the page loads is one somebody read (a call on an undefined value is what crashed the page: lk['network.color'].toLowerCase()).
// REVIEWED 2026-11-08, all 17 sites safe: each receiver is typeof-checked, wrapped in String(...), a template or concatenation, an object key, or the result of clean(); the one exception, app-editor.js
// `PACE.find(paceChoice).label.toLowerCase()`, is reachable only when window.ryagramClipPace exists, which the chat page does not load (paceOn is false there).
// A new call site fails this test until it is read for an undefined receiver and the number below is changed with a reason.
const CALLS = /\.(toLowerCase|toUpperCase|toLocaleLowerCase|toLocaleUpperCase|trim|trimStart|trimEnd|split|startsWith|endsWith|localeCompare|padStart|padEnd|charAt|normalize|replaceAll|match|matchAll|substring|substr|repeat)\(/g;
const REVIEWED = {
  'assets/app-editor-core.js': { trim: 2 },
  'assets/app-editor-progress.js': {},
  'assets/app-editor-draft.js': {},
  'assets/preview/text-layout.js': {},
  'assets/app-editor.js': { padStart: 2, split: 1, trim: 2, toLowerCase: 2 },
  'tools/chat-editor/live-host.js': { trimStart: 1, startsWith: 3, trim: 2 },
};
test('every string-method call in a script the chat page loads is a reviewed one', () => {
  assert.deepEqual(Object.keys(REVIEWED), JS, 'the list of scripts the page loads is the list that was reviewed');
  for (const f of JS) {
    const src = fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    const got = {};
    for (const m of src.matchAll(CALLS)) got[m[1]] = (got[m[1]] || 0) + 1;
    assert.deepEqual(got, REVIEWED[f], `${f}: a string-method call was added or removed; read it for an undefined receiver, then change REVIEWED`);
  }
});
