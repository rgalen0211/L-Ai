// /preview-demo/: the theme swap (the engine's own two palettes, applied through the bundle's styles table) and the closing card.
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

function loaded() {
  const window = {};
  const ctx = { window, Blob, DecompressionStream, TextDecoder, Uint8Array, Uint32Array, DataView, URL, Error, Promise, Math, Number, Array, Object, String, JSON, Map, Set, Date, RegExp, parseInt, parseFloat, isNaN };
  vm.createContext(ctx);
  for (const f of ['assets/preview/preview-zip.js', 'assets/preview/preview-core.js', 'assets/preview/scene-draw.min.js', 'assets/preview/preview-edit.js']) vm.runInContext(read(f), ctx);
  return ctx;
}
async function realScene(ctx) {
  const Z = ctx.window.ryagramZip;
  return Z.sceneJson((await Z.read(new Uint8Array(fs.readFileSync(path.join(root, 'preview-demo/interstate.bundle.zip')))))['scene.json.gz']);
}
const rgbOf = hex => `rgb(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)})`;
const count = (hay, needle) => hay.split(needle).length - 1;
const plain = x => JSON.parse(JSON.stringify(x));

test('THEME: the light palette is the engine\'s own (style.yaml themes.light), and the keys are the bundle\'s theme-sourced styles', async () => {
  const ctx = loaded(); const E = ctx.window.ryagramPreviewEdit;
  const scene = await realScene(ctx);
  assert.deepEqual([...E.themeKeys(scene)].sort(), ['page.background', 'state.fill', 'state.outline', 'text.muted', 'text.primary', 'text.secondary']);
  assert.deepEqual(plain(E.LIGHT), { 'page.background': '#fcfcfb', 'state.fill': '#f6f5f1', 'state.outline': '#3d3c39', 'text.primary': '#0b0b0b', 'text.secondary': '#52514e', 'text.muted': '#898781' });
  const roots = [process.env.RYAGRAM_REPO, path.join(root, '..', 'Ryagram'), 'D:/Ryagram-scratch/WEB/Ryagram-main'].filter(Boolean);
  const file = roots.map(r => path.join(r, 'ryagram', 'maprace', 'style.yaml')).find(f => fs.existsSync(f));
  if (!file) return;
  const yaml = fs.readFileSync(file, 'utf8');
  const light = yaml.slice(yaml.indexOf('\n  light:'));
  const hex = re => light.match(re)[1].toLowerCase();
  assert.equal(hex(/background: "(#[0-9a-fA-F]{6})"/), E.LIGHT['page.background']);
  assert.equal(hex(/primary: "(#[0-9a-fA-F]{6})"/), E.LIGHT['text.primary']);
  assert.equal(hex(/secondary: "(#[0-9a-fA-F]{6})"/), E.LIGHT['text.secondary']);
  assert.equal(hex(/muted: "(#[0-9a-fA-F]{6})"/), E.LIGHT['text.muted']);
  assert.equal(hex(/fill: "(#[0-9a-fA-F]{6})"/), E.LIGHT['state.fill']);
  assert.equal(hex(/outline: "(#[0-9a-fA-F]{6})"/), E.LIGHT['state.outline']);
});

test('THEME: light changes exactly the theme colours in exactly their places, leaves the roads alone, and never touches the original scene', async () => {
  const ctx = loaded(); const E = ctx.window.ryagramPreviewEdit, D = ctx.RyagramScene;
  const base = await realScene(ctx);
  const frozen = JSON.stringify(base);
  const light = E.restyle(base, E.themeEdits(base, 'light'));
  assert.equal(JSON.stringify(base), frozen, 'the original scene is untouched');
  const svg = D.draw(light, 1500, { parts: 'all' });
  const old = JSON.stringify(base.parts) + JSON.stringify(base.defs);
  const now = JSON.stringify(light.parts) + JSON.stringify(light.defs);
  assert.ok(svg.includes(rgbOf('#fcfcfb')), 'the page is the light page colour');
  assert.ok(!D.body(light, 1500, { parts: 'graphics' }).includes('fill="rgb(20,20,26)"'), 'the dark page is gone');
  for (const key of E.themeKeys(base)) {
    const from = base.styles[key].value, to = rgbOf(E.LIGHT[key]);
    const at = (sc, pl) => pl.split('.').reduce((o, k) => o[k], sc);
    const places = base.styles[key].places.map(pl => at(base, pl));
    const placesNow = light.styles[key].places.map(pl => at(light, pl));
    assert.equal(count(JSON.stringify(placesNow), from), 0, `${key}: the old colour is gone from its places`);
    assert.ok(count(JSON.stringify(placesNow), to) >= count(JSON.stringify(places), from), `${key}: the new colour is there`);
    assert.equal(light.styles[key].value, to, `${key}: the styles table follows the scene`);
  }
  const roads = base.styles['network.color'].value;                                        // a story colour: the theme does not own it
  assert.equal(count(now, roads), count(old, roads));
  assert.equal(light.styles['network.color'].value, roads);
});

test('THEME: dark -> light -> dark restores the exported scene exactly, and the swap is one pass (a colour that becomes another one\'s old value is not changed twice)', async () => {
  const ctx = loaded(); const E = ctx.window.ryagramPreviewEdit;
  const base = await realScene(ctx);
  const light = E.restyle(base, E.themeEdits(base, 'light'));
  const back = E.restyle(light, E.themeEdits(light, 'dark', base));
  assert.equal(JSON.stringify(back.parts), JSON.stringify(base.parts));
  assert.equal(JSON.stringify(back.defs), JSON.stringify(base.defs));
  const toy = { styles: { a: { source: 'theme', value: 'rgb(1,1,1)', places: ['parts.x'] }, b: { source: 'theme', value: 'rgb(2,2,2)', places: ['parts.x'] } },
                parts: { x: ['fill="rgb(1,1,1)" stroke="rgb(2,2,2)"'] }, defs: {} };
  const swapped = E.restyle(toy, { a: '#020202', b: '#010101' });                          // each takes the other's old colour
  assert.equal(swapped.parts.x[0], 'fill="rgb(2,2,2)" stroke="rgb(1,1,1)"');
  assert.equal(E.restyle(toy, { a: 'red', zzz: '#000000' }), toy, 'a bad colour and an unknown key change nothing');
});

test('THEME: the two-layer frame still equals the engine\'s whole frame after a theme swap (bitmap + overlay, 12 frames)', async () => {
  const ctx = loaded(); const E = ctx.window.ryagramPreviewEdit, D = ctx.RyagramScene, C = ctx.window.ryagramPreviewCore;
  const base = await realScene(ctx);
  const light = E.restyle(base, E.themeEdits(base, 'light'));
  const marks = C.marksOf(light), plainScene = C.bitmapScene(light), over = C.overlayScene(light);
  let compared = 0;
  for (let i = 0; i < 12; i++) {
    const f = Math.round((i / 11) * (light.frames - 1));
    const p = light.clock.ticks[f][0];
    if (C.ctxAt(light, f) !== C.ctxAt(light, marks[p])) continue;
    assert.equal(D.body(plainScene, marks[p], { parts: 'graphics' }) + D.body(over, f, { parts: 'graphics' }), D.body(light, f, { parts: 'graphics' }), `frame ${f}`);
    compared++;
  }
  assert.ok(compared >= 10);
});

test('THE END CARD says "Made with Ryagram", offers Watch again and a way in with a campaign tag, and the page has the theme control', () => {
  const js = read('assets/preview/preview-demo.js');
  assert.match(js, /textContent: 'Made with Ryagram'/);
  assert.match(js, /textContent: 'Watch again'/);
  assert.match(js, /href: '\/ryagram\/\?utm_source=preview_demo&utm_medium=referral&utm_campaign=interstate'/);
  assert.match(js, /frame >= baseScene\.frames - 1 && !playing/);
  assert.match(html, /id="demo-theme"/);
  assert.match(read('assets/preview/preview-demo.css'), /\.pv-endcard\[hidden\]\{display:none\}/);
  assert.doesNotMatch(js, /\.style\.|setAttribute\('style'/);                             // the page's policy forbids inline styles: classes only
});
