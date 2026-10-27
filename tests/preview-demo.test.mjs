// /preview-demo/: a static, unlinked, noindex page on a REAL Interstate bundle. These tests hold the page itself: what it loads, what its policy allows,
// that nothing reaches a server, and the colour edits it offers (the viewer and the zip reader are tested in preview-core.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const html = read('preview-demo/index.html');

test('the page is unlinked and noindex, with a policy that allows no outside script, no outside connection and no inline script', () => {
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)[1];
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /connect-src 'self'(;|$)/);                                           // the bundle is fetched from our own origin, nothing else
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.doesNotMatch(html, /\sstyle=|\son[a-z]+=/i);
  // nothing links to it: no other page of the site mentions it
  for (const f of ['index.html', 'ryagram/index.html', 'app/index.html', 'film/index.html', 'privacy-policy.html', 'thank-you.html'])
    if (fs.existsSync(path.join(root, f))) assert.doesNotMatch(read(f), /preview-demo/, f);
});

test('every script and style the page loads exists, and the demo script makes exactly one network request: its own bundle', () => {
  for (const m of html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)/g)) assert.ok(fs.existsSync(path.join(root, m[1])), m[1]);
  const js = read('assets/preview/preview-demo.js');
  assert.deepEqual([...js.matchAll(/fetch\(([^)]*)\)/g)].map(m => m[1]), ["'interstate.bundle.zip'"]);
  assert.doesNotMatch(js, /XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB|eval\(|Function\(/);
  assert.ok(fs.existsSync(path.join(root, 'preview-demo/interstate.bundle.zip')));
  assert.match(read('preview-demo/PROVENANCE.txt'), /Ryagram main @ 98836d817e42/);
});

function loaded() {
  const window = {};
  const ctx = { window, Blob, DecompressionStream, TextDecoder, Uint8Array, Uint32Array, DataView, URL, Error, Promise, Math, Number, Array, Object, String, JSON, Map, Set, Date, RegExp, parseInt, parseFloat, isNaN };
  vm.createContext(ctx);
  for (const f of ['assets/preview/preview-zip.js', 'assets/preview/preview-core.js', 'assets/preview/scene-draw.min.js', 'assets/preview/preview-edit.js']) vm.runInContext(read(f), ctx);
  return ctx;
}

test('the real Interstate bundle opens with the page\'s own reader, the pinned drawer and the checks, and holds the film it says it holds', async () => {
  const ctx = loaded();
  const Z = ctx.window.ryagramZip;
  const files = await Z.read(new Uint8Array(fs.readFileSync(path.join(root, 'preview-demo/interstate.bundle.zip'))));
  assert.deepEqual(Object.keys(files).sort(), ['fonts/LiberationSans-Bold.woff2', 'fonts/LiberationSans-Regular.woff2', 'scene.json.gz']);
  const scene = await Z.sceneJson(files['scene.json.gz']);
  ctx.window.ryagramPreviewCore.parseScene(scene);
  assert.deepEqual([scene.format, scene.version, scene.view, scene.frames, scene.fps, scene.canvas.join('x')], ['ryagram-scene', 2, 'network', 2820, 30, '1920x1080']);
  assert.equal(scene.clock.periods[0], '1956');
  assert.equal(scene.clock.periods.at(-1), '1993');
  assert.equal(scene.engine_dirty, false);
  assert.match(scene.engine_commit, /^98836d817e42/);
  const D = ctx.RyagramScene;
  const svg = D.draw(scene, 1500, { parts: 'all' });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="1920" height="1080"/);
  assert.doesNotMatch(svg, /<script|<foreignObject|on[a-z]+=|href="https?:/i);          // a frame holds drawing and nothing else
  assert.equal(D.describe(scene, 1500).period.length, 4);
});

test('the colour edits the page offers change the drawing of exactly the layer chosen and never the original scene', async () => {
  const ctx = loaded();
  const Z = ctx.window.ryagramZip, E = ctx.window.ryagramPreviewEdit, D = ctx.RyagramScene;
  const scene = await Z.sceneJson((await Z.read(new Uint8Array(fs.readFileSync(path.join(root, 'preview-demo/interstate.bundle.zip')))))['scene.json.gz']);
  const now = E.current(scene);
  assert.ok(Object.keys(now).length >= 2, `layers: ${Object.keys(now)}`);
  const before = JSON.stringify(scene.parts).length;
  const roadsId = E.LAYERS.map(l => l.id).find(id => now[id]);
  const next = E.recolour(scene, { [roadsId]: '#12ab34' });
  assert.equal(E.current(next)[roadsId], '#12ab34');
  assert.notEqual(D.body(next, 1500, { parts: 'graphics' }), D.body(scene, 1500, { parts: 'graphics' }));
  assert.equal(E.current(scene)[roadsId], now[roadsId], 'the original scene is untouched');
  assert.equal(JSON.stringify(scene.parts).length, before);
  assert.equal(JSON.stringify(E.recolour(scene, { [roadsId]: 'red' }).parts), JSON.stringify(scene.parts), 'a bad colour is ignored');
});
