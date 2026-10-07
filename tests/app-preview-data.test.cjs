// The live preview's data calls against the mock: ask for a bundle (building, then ready), download the zip, open it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createFakeClient } = require('./fake-supabase.js');

const root = path.join(__dirname, '..');
function load(...files) {
  const ctx = { window: {}, Blob, DecompressionStream, TextDecoder, Uint8Array, Uint32Array, DataView, URL, Promise, Math, JSON, Map, Set, Date };
  vm.createContext(ctx);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx);
  return ctx.window;
}
const w = load('assets/app-data.js', 'assets/preview/preview-zip.js', 'assets/preview/preview-core.js');
globalThis.window = globalThis.window || {};
globalThis.window.ryagramSceneFixtureB64 = fs.readFileSync(path.join(__dirname, 'fixtures', 'scene-fixture.zip')).toString('base64');

test('request_scene_bundle answers building, then ready with a path; the zip downloads and opens as a scene', async () => {
  const data = w.ryagramData(createFakeClient());
  const first = await data.requestSceneBundle('v-1');
  assert.equal(first.status, 'building');
  const ready = await data.requestSceneBundle('v-1');
  assert.equal(ready.status, 'ready');
  assert.match(ready.storage_path, /scene\.bundle\.zip$/);
  const bytes = await data.downloadSceneBundle(ready.storage_path);
  assert.ok(bytes instanceof Uint8Array && bytes.length > 1000);
  const files = await w.ryagramZip.read(bytes);
  const scene = await w.ryagramZip.sceneJson(files['scene.json.gz']);
  assert.doesNotThrow(() => w.ryagramPreviewCore.parseScene(scene));
  assert.equal((await data.requestSceneBundle('v-2')).status, 'building');           // each version has its own asks
});

test('a failed download, or a refused request, says so in plain words', async () => {
  const data = w.ryagramData(createFakeClient());
  await assert.rejects(data.downloadSceneBundle('x/not-a-bundle.txt'), /Couldn.t load the preview/);
  const refused = w.ryagramData({ rpc: async () => ({ data: null, error: { message: 'Scene previews are off.' } }) });
  await assert.rejects(refused.requestSceneBundle('v-1'), /Scene previews are off|prepare the preview/);
  const cfg = fs.readFileSync(path.join(root, 'assets', 'ryagram-config.js'), 'utf8');
  assert.match(cfg, /livePreview: false/);                                            // off on the live site
});
