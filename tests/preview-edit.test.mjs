// Live recolouring of a scene (assets/preview/preview-edit.js) on the REAL engine export, with the engine's own drawer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ['assets/preview/preview-edit.js', 'assets/preview/scene-draw.min.js', 'assets/app-look.js']) vm.runInContext(fs.readFileSync(path.join(here, '..', f), 'utf8'), ctx);
const E = ctx.window.ryagramPreviewEdit, D = ctx.RyagramScene, L = ctx.window.ryagramLook;
const zipb = fs.readFileSync(path.join(here, 'fixtures', 'scene-real.zip'));
const scene = JSON.parse(zlib.gunzipSync(zipb.subarray(30 + zipb.readUInt16LE(26), 30 + zipb.readUInt16LE(26) + zipb.readUInt32LE(18))));
const plain = x => JSON.parse(JSON.stringify(x));
const frame = 120;

test('the layers a film has are found from its own drawing, in hex', () => {
  assert.deepEqual(plain(E.current(scene)), { lines: '#c8372d', land: '#1f1f27', page: '#14141a' });   // this export has no base or background roads
  assert.deepEqual(plain(E.LAYERS.map(l => l.field)), ['network_color', 'network_base_color', 'network_context_color', 'land_fill', 'page_background']);
  assert.equal(E.toRgb('#00ff88'), 'rgb(0,255,136)');
  assert.equal(E.toHex('rgb(200,55,45)'), '#c8372d');
  assert.equal(E.toHex('red'), null);
});
test('recolouring changes exactly the layer asked, in the engine\'s own drawing, and never the scene it was given', () => {
  const before = D.draw(scene, frame);
  const frozen = JSON.stringify(scene);
  const next = E.recolour(scene, { lines: '#00ff88' });
  const after = D.draw(next, frame);
  assert.equal(JSON.stringify(scene), frozen);
  assert.equal(D.draw(scene, frame), before);
  assert.ok(after.includes('stroke="rgb(0,255,136)"') && !after.includes('stroke="rgb(200,55,45)"'));
  assert.ok(after.includes('fill="rgb(20,20,26)"') && after.includes('rgb(31,31,39)'), 'page and land untouched');
  assert.deepEqual(plain(E.current(next)), { lines: '#00ff88', land: '#1f1f27', page: '#14141a' });
  const page = E.recolour(scene, { page: '#101030' });
  assert.ok(D.draw(page, frame).includes('fill="rgb(16,16,48)"') && !D.draw(page, frame).includes('fill="rgb(20,20,26)"'));
  const land = E.recolour(scene, { land: '#223344' });
  assert.ok(D.draw(land, frame).includes('rgb(34,51,68)') && !D.draw(land, frame).includes('fill="rgb(31,31,39)"'));
  assert.equal(D.draw(land, frame).match(/stroke="rgb\(123,122,133\)"/g).length >= 1, true, 'the outline keeps its colour');
});
test('the roads colour reaches every frame where roads are drawn, including a year mid-way through being built', () => {
  const next = E.recolour(scene, { lines: '#00ff88' });
  const frames = [60, 100, 150, 179];
  for (const f of frames) {
    const a = D.draw(next, f);
    assert.ok(!a.includes('rgb(200,55,45)'), `frame ${f}`);
  }
  assert.ok(D.draw(next, 100).includes('rgb(0,255,136)'));
});
test('a layer the film lacks, an unknown layer and a bad colour are ignored', () => {
  const same = JSON.stringify(E.recolour(scene, { base: '#ffffff', context: '#ffffff', sky: '#ffffff', lines: 'banana', page: '#12345', land: '' }));
  assert.equal(same, JSON.stringify(scene));
  assert.equal(JSON.stringify(E.recolour(scene, {})), JSON.stringify(scene));
});
test('the story side of an edit is the one shared function, so what is previewed is what would be saved', () => {
  const story = { schema: 1, name: 'x', engine: 'sequence', sequence: { canvas: [1920, 1080], fps: 30, theme: 'dark', clips: [{ kind: 'title', seconds: 3, headline: 'x' }] } };
  for (const l of E.LAYERS) {
    const out = L.apply(story, { look: { [l.field]: '#00ff88' } });
    assert.equal(out.ok, true, l.field);
  }
  const out = L.apply(story, { look: { network_color: '#00ff88', page_background: '#101030', land_fill: '#223344' } });
  assert.deepEqual(plain(out.story.sequence.style_overrides), { network: { color: '#00ff88' }, page: { background: '#101030' }, state: { fill: '#223344' } });
  assert.equal(L.apply(story, { look: { network_color: 'banana' } }).ok, false);
});
