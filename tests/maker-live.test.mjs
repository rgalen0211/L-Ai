// The maker's standalone live editor (tools/maker-live/): the generated bundle is exactly what the generator writes from the website's own editor files, the page keeps the maker's strict
// policy (no inline script or style, nothing but its own address), and the only thing the bundle ever calls is the host's rpc.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../tools/build-maker-live.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = p => fs.readFileSync(path.join(here, '..', p), 'utf8').replace(/\r\n/g, '\n');

test('live.js and live.css are what the generator writes from the website\'s own files (run: node tools/build-maker-live.mjs)', () => {
  const out = build();
  for (const [f, text] of Object.entries(out)) assert.equal(read(f), text, `${f} is stale`);
});

test('the page keeps the maker\'s policy: default-src none, own scripts and styles only, no inline script, style or handler, one stylesheet, one script', () => {
  const html = read('tools/maker-live/live.html');
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /style-src 'self'/);
  assert.match(csp, /connect-src 'self'/);
  assert.match(csp, /base-uri 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:/);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)/, 'no inline script');
  assert.doesNotMatch(html, /\sstyle=|\son[a-z]+=|<style/i, 'no inline style or handler');
  assert.equal((html.match(/<script /g) || []).length, 1);
  assert.equal((html.match(/<link /g) || []).length, 1);
  assert.match(html, /src="live\.js"/);
  assert.match(html, /href="live\.css"/);
});

test('the bundle calls nothing but the host\'s own rpc: two fetches (the rpc and the render of the film built on the PC), only the five editor names on the rpc, and no storage, eval, site data layer or outside address', () => {
  const js = read('tools/maker-live/live.js');
  assert.equal((js.match(/\bfetch\(/g) || []).length, 2);
  assert.match(js, /fetch\('\/api\/live\/rpc'/);
  assert.match(js, /fetch\('\/api\/live\/render'/);
  for (const bad of ['eval(', 'new Function', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'indexedDB', 'supabase', 'document.cookie', 'innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'importScripts']) {
    assert.ok(!js.includes(bad), `the bundle contains ${bad}`);
  }
  assert.doesNotMatch(js, /https?:\/\/(?!www\.w3\.org\/2000\/svg)/, 'no outside address (the SVG namespace aside)');
  const names = js.match(/const NAMES = \[([^\]]+)\]/)[1].match(/'([a-z_]+)'/g).map(s => s.slice(1, -1));
  assert.deepEqual(names, ['editor_apply_ops', 'editor_undo', 'editor_undo_all_ai', 'my_edit_ops_since', 'editor_heartbeat']);
  assert.match(js, /window\.ryagramLiveHost = \{ rpc, render, mode, project, media: null, title: '' \}/);
});

test('the bundle carries the site\'s editor files in order and nothing else from the site', () => {
  const js = read('tools/maker-live/live.js');
  const marks = [...js.matchAll(/\/\* ---- ([^ ]+) ---- \*\//g)].map(m => m[1]);
  assert.deepEqual(marks, ['assets/app-editor-core.js', 'assets/app-editor-progress.js', 'assets/app-editor-draft.js', 'assets/app-editor.js', 'tools/maker-live/live-host.js']);
  assert.ok(!js.includes('ryagramData') && !js.includes('ryagramLibrary') && !js.includes('ryagramConfig'));
  const css = read('tools/maker-live/live.css');
  assert.doesNotMatch(css, /@import|url\(/i, 'the stylesheet loads nothing');
});
