// The chat editor panel, 11-08 (Ryan 14:37): (4) in full screen nothing the person needs may sit in the bottom ~90 px, which Claude's reply box covers; (3) the Look swatches must not be black when the chat starts from an
// empty look. The real-browser half is tools/check-chat-editor.py (computed padding, swatch values). Must-fails: tests/connect_editor_look_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EDITOR_HTML } from '../supabase/functions/connect-core/editor_page.ts';

const HOST_SRC = fs.readFileSync(new URL('../tools/chat-editor/live-host.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const EDITOR_SRC = fs.readFileSync(new URL('../assets/app-editor.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function load(noStyle = false) {
  const sent = [], listeners = {};
  const parent = { postMessage: (m) => sent.push(JSON.parse(JSON.stringify(m))) };
  const win = { parent };
  const root = { classes: new Set(), vars: {} };
  const docEl = { getBoundingClientRect: () => ({ height: 400, width: 600 }), classList: { toggle: (n, on) => { if (on) root.classes.add(n); else root.classes.delete(n); } },
    ...(noStyle ? {} : { style: { setProperty: (k, v) => { root.vars[k] = v; } } }) };
  const ctx = { Date: { now: () => 1_000_000 }, window: win, addEventListener: (n, f) => { (listeners[n] ||= []).push(f); }, setTimeout, clearTimeout, Promise, Error, JSON, Number, Math, Map, String, Array, Object, RegExp,
    document: { getElementById: () => null, createElement: () => ({}), body: {}, documentElement: docEl } };
  vm.runInNewContext(HOST_SRC, ctx, { timeout: 2000 });
  const fire = (data) => (listeners.message || []).forEach((f) => f({ source: parent, data }));
  const init = sent.filter((s) => s.method === 'ui/initialize').at(-1);
  return { root, fire, init, reply: (hostContext) => fire({ jsonrpc: '2.0', id: init.id, result: { protocolVersion: '2026-01-26', hostContext } }) };
}
const tick = () => new Promise((r) => setTimeout(r, 20));

test('full screen: the page marks itself, and a safe area the host reports (clamped 0 to 200 px) is handed to the stylesheet', async () => {
  const p = load();
  p.reply({ displayMode: 'fullscreen', availableDisplayModes: ['inline', 'fullscreen'], safeAreaInsets: { top: 0, right: 0, bottom: 20, left: 0 } });
  await tick();
  assert.ok(p.root.classes.has('le-fullscreen'));
  assert.equal(p.root.vars['--le-safe-bottom'], '20px');
  p.fire({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { displayMode: 'inline' } });
  assert.ok(!p.root.classes.has('le-fullscreen'), 'back in the chat the room goes');
  for (const [bottom, want] of [[1e9, '200px'], [-5, '0px'], [NaN, '0px'], ['40', '0px'], [null, '0px'], [12.6, '13px']]) {
    p.fire({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { displayMode: 'fullscreen', safeAreaInsets: { bottom } } });
    assert.equal(p.root.vars['--le-safe-bottom'], want, String(bottom));
  }
  // a page whose document element has no style object (a stripped-down host window) still marks full screen and throws nothing
  const s = load(true);
  s.reply({ displayMode: 'fullscreen', safeAreaInsets: { bottom: 8 } });
  await tick();
  assert.ok(s.root.classes.has('le-fullscreen'), 'marked even with no style object');
  s.root.classes.clear();
  s.fire({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { displayMode: 'fullscreen' } });
  assert.ok(s.root.classes.has('le-fullscreen'), 'and again on a context change');
  // a host that says nothing about the display mode: no room, and nothing thrown
  const q = load();
  q.reply({});
  await tick();
  assert.ok(!q.root.classes.has('le-fullscreen'));
  assert.equal(q.root.vars['--le-safe-bottom'], '0px');
});

test('the page leaves 90 px or more at the bottom in full screen, and none inline', () => {
  const m = /\.le-fullscreen body\{padding-bottom:calc\((\d+)px \+ var\(--le-safe-bottom,0px\)\)\}/.exec(EDITOR_HTML);
  assert.ok(m, 'the rule is in the built page');
  assert.ok(Number(m[1]) >= 90 && Number(m[1]) <= 140, `${m[1]} px`);
  // only under the full-screen class
  assert.equal((EDITOR_HTML.match(/padding-bottom:calc\(/g) || []).length, 1);
});

test('a Look colour the film has not set is drawn in the editor\'s starting colour, not black, and the panel says so', () => {
  assert.ok(EDITOR_SRC.includes("value: ed.state.look[key] !== undefined ? ed.state.look[key] : DATA_BASE().look[key], id: `le-look-${key}`"));
  assert.ok(!EDITOR_SRC.includes("type: 'color', value: ed.state.look[key], id: `le-look-${key}`"), 'no swatch takes an unset value as it is');
  assert.ok(EDITOR_SRC.includes("LOOK_ROWS.some(([k]) => ed.state.look[k] === undefined)"));
  assert.ok(EDITOR_SRC.includes("A colour this film has not changed is shown in the editor's own starting colour. The film's own colours are not shown here yet."));
  assert.ok(EDITOR_HTML.includes("A colour this film has not changed is shown in the editor's own starting colour. The film's own colours are not shown here yet."), 'the built page carries it');
  // every row of the look panel has a starting colour to fall back on
  const rows = [...EDITOR_SRC.matchAll(/const LOOK_ROWS = \[([\s\S]*?)\];/g)][0][1];
  const keys = [...rows.matchAll(/\['([a-z_.]+)'/g)].map((m) => m[1]);
  const base = EDITOR_SRC.match(/const DATA_BASE = \(\) => \(\{ look: \{([^}]*)\}/)[1];
  for (const k of keys) assert.ok(base.includes(`'${k}':`), `${k} has a starting colour`);
  assert.ok(keys.length >= 5);
});
