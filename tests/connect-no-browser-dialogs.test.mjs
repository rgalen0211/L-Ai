// No browser dialog in anything that runs INSIDE an AI chat (CONNECT, 2026-11-18; CLAUDE (for Ryan) 11-17 23:13, from WORKER's Q636 dry run: the website's "Render final film" used window.confirm, and the built-in browser pane
// answers such a box with No; a panel in a chat (an MCP App iframe) can block alert/confirm/prompt and popups too, so an order made there would silently do nothing).
// What this pins: the chat editor page (and every source it is built from), the home panel page, the card page and the probe page contain no alert, confirm or prompt call, no showModal, no window.open, no beforeunload
// handler; the one way a panel opens a link is the host's own ui/open-link. The detector is tested on its own against planted samples first, so a detector that matches nothing cannot pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JS, CSS } from '../tools/build-chat-editor.mjs';
import { EDITOR_HTML } from '../supabase/functions/connect-core/editor_page.ts';
import { homeHtml } from '../supabase/functions/connect-core/home_panel.ts';
import { cardHtml } from '../supabase/functions/connect-core/mcp_app.ts';
import { probePage, PROBE_URIS } from '../supabase/functions/connect-core/probe.ts';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
/** What a browser would show or block: a dialog call, a modal dialog, a popup window, a leave-the-page prompt. */
export function dialogs(text) {
  const out = [];
  for (const [name, re] of [
    ['alert/confirm/prompt call', /(?<![\w.$-])(?:window\s*\.\s*|globalThis\s*\.\s*|top\s*\.\s*|parent\s*\.\s*)?(?:alert|confirm|prompt)\s*\(/g],
    ['modal dialog', /\.\s*showModal\s*\(|<dialog\b/g],
    ['popup window', /(?<![\w$-])(?:window|globalThis|top|parent|self)\s*\.\s*open\s*\(|(?<![\w$.-])open\s*\(\s*['"`]https?:/g],   // a bare open(url) can be a person's own function (the draft's open(baseFor)), so only a window's open or a literal address counts
    ['leave-the-page prompt', /beforeunload/g],
  ]) { for (const m of text.matchAll(re)) out.push(name + ': ' + m[0]); }
  return out;
}

test('the detector finds each kind on planted samples and leaves ordinary words alone (so it cannot pass by matching nothing)', () => {
  for (const bad of ['if (confirm("Render?")) go();', 'window.confirm(msg)', 'alert(1)', 'window . alert ( "x" )', 'prompt("name")', 'parent.confirm(x)', 'top.alert(x)', 'dlg.showModal()', '<dialog id="d">', 'window.open(url)', 'top.open(u)', 'open("https://x")', 'window.onbeforeunload = f', "addEventListener('beforeunload', f)"])
    assert.ok(dialogs(bad).length > 0, bad);
  for (const ok of ['const confirmed = 1', 'a.confirm_button', '.confirm-card { color: red }', 'ask("ui/open-link", { url })', 'reopen(', 'isOpen(x)', 'x.openTo(1)', 'Confirm', 'the prompt text', 'prompting()', 'const promptly = 2', 'function open(baseFor) { return 1; }', 'ready = open(base)'])
    assert.deepEqual(dialogs(ok), [], ok);
});

test('every source the chat editor page is built from, and the built page, has no browser dialog', () => {
  assert.ok(JS.length >= 7 && CSS.length >= 3, 'the source lists are read');
  for (const f of [...JS, ...CSS]) assert.deepEqual(dialogs(read(f)), [], f);
  assert.deepEqual(dialogs(EDITOR_HTML), [], 'the built editor page (editor_page.ts)');
});

test('the home panel page, the card page and the probe page have no browser dialog either', () => {
  assert.deepEqual(dialogs(homeHtml('https://uselai.com/app/')), [], 'home panel');
  assert.deepEqual(dialogs(cardHtml('https://uselai.com/app/')), [], 'card');
  assert.ok(PROBE_URIS.length >= 1);
  for (const u of PROBE_URIS) { const page = probePage(u); assert.ok(page && page.length > 1000, u); assert.deepEqual(dialogs(page), [], u); }
});

test('the one link the chat editor opens goes through the host (ui/open-link), never by a window of its own', () => {
  const host = read('tools/chat-editor/live-host.js');
  assert.equal([...host.matchAll(/ui\/open-link/g)].length >= 1, true);
  assert.deepEqual(dialogs(host), []);
  assert.match(host, /request\('ui\/open-link', \{ url \}\)/);
});
