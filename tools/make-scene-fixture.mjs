// Builds the SYNTHETIC scene bundle the live preview is developed and tested against until BUILDER's exporter ships
// (proposals/SCENE-BUNDLE.md, spec v1). Deterministic: the same bytes every run (fixed seed, zip times and gzip mtime zero).
//   node tools/make-scene-fixture.mjs        writes tests/fixtures/scene-fixture.zip and scene-fixture.js
// It is NOT Interstate data: a made-up road network of random walks, labelled as such in the scene itself.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '..', 'tests', 'fixtures');

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const r = rng(20261007);
const f1 = x => Math.round(x * 4) / 4;

const W = 1920, H = 1080;
const periods = []; for (let y = 1956; y <= 1993; y++) periods.push(String(y));
const PER = 30;
const STILLS = [{ at: 0, len: 45 }, { at: 37, len: 60 }];          // held at the first and the last year

// A made-up land shape and a base network, and 8 routes' worth of dated miles per year.
const land = `M120 160 L1700 120 L1820 520 L1650 940 L420 980 L140 700 Z`;
const outline = land;
function walk(x, y, n, step) { let d = `M${f1(x)} ${f1(y)}`; for (let i = 0; i < n; i++) { x += (r() - 0.35) * step; y += (r() - 0.5) * step * 0.7; d += ` L${f1(x)} ${f1(y)}`; } return d; }
const base = Array.from({ length: 14 }, () => walk(180 + r() * 1400, 200 + r() * 700, 14, 90)).join(' ');
const context = Array.from({ length: 30 }, () => walk(150 + r() * 1500, 180 + r() * 750, 8, 60)).join(' ');
const groups = [];
for (const [yi, year] of periods.entries()) {
  for (let route = 0; route < 6; route++) {
    const n = 4 + Math.floor(r() * 6);
    const miles = [];
    let x = 160 + r() * 1500, y = 190 + r() * 760;
    for (let i = 0; i < n; i++) { const d = walk(x, y, 3, 70); const m = d.match(/L([\d.]+) ([\d.]+)$/); x = +m[1]; y = +m[2]; miles.push({ id: `${year}-${route}-${i}`, d, rank: [i, n] }); }
    groups.push({ year, route: `I-${10 + route * 5}`, miles });
  }
}
const frames = (() => { let f = 0; for (let i = 0; i < periods.length; i++) { const s = STILLS.find(x => x.at === i); f += PER + (s ? s.len : 0); } return f - PER; })();
const marks = (() => { const m = []; let f = 0; for (let i = 0; i < periods.length; i++) { m.push(f); const s = STILLS.find(x => x.at === i); f += PER + (s ? s.len : 0); } return m; })();
const readoutValues = periods.map((_, i) => Math.round(i * i * 27.3 + i * 40) / 10);

const scene = {
  format: 'ryagram-scene', version: 1,
  engine_commit: 'f1x7ure', story_sha256: 'fixture', view: 'network',
  note: 'SYNTHETIC FIXTURE: made-up roads, not Interstate data. Written by tools/make-scene-fixture.mjs.',
  canvas: [W, H], fps: 30, frames,
  theme: { name: 'dark', page: '#14141a' },
  clock: { periods, frames_per_period: PER, stills: STILLS.map(s => ({ first: marks[s.at], last: marks[s.at] + s.len - 1 })), reveal_fade: 0.6 },
  marks,
  styles: {
    land: { fill: '#1f1f27', stroke: 'none', width: 0, source: 'style_overrides.state.fill' },
    outline: { fill: 'none', stroke: '#7b7a85', width: 2, source: 'style_overrides.state.outline' },
    base: { fill: 'none', stroke: '#8a8a95', width: 3, opacity: 1, source: 'style_overrides.network.base_color' },
    context: { fill: 'none', stroke: '#c9ccd6', width: 1, opacity: 0.4, source: 'style_overrides.network.context_color' },
    dated: { fill: 'none', stroke: '#ff8a3d', width: 3, opacity: 1, source: 'style_overrides.network.color' },
    text: { fill: '#f2f2ef', source: 'style_overrides.text.primary' },
    muted: { fill: '#b6b5ae', source: 'style_overrides.text.muted' }
  },
  themes: {
    dark: { page: '#14141a', land: '#1f1f27', outline: '#7b7a85', base: '#8a8a95', context: '#c9ccd6', dated: '#ff8a3d', text: '#f2f2ef', muted: '#b6b5ae' },
    light: { page: '#fcfcfb', land: '#f6f5f1', outline: '#3d3c39', base: '#7a7a7a', context: '#c9ccd6', dated: '#1a4fa3', text: '#0b0b0b', muted: '#52514e' }
  },
  layers: [
    { id: 'land', role: 'land', style: 'land', d: land },
    { id: 'outline', role: 'outline', style: 'outline', d: outline },
    { id: 'context', role: 'context', style: 'context', d: context },
    { id: 'base', role: 'base', style: 'base', d: base },
    { id: 'dated', role: 'dated', style: 'dated', groups }
  ],
  texts: [
    { id: 'year', role: 'year', font: 'sans', size: 76, style: 'text', x: 140, y: 110, anchor: 'start', rule: 'period' },
    { id: 'region', role: 'region', font: 'sans', size: 26, style: 'muted', x: 140, y: 146, anchor: 'start', text: 'Made-up roads' },
    { id: 'readout', role: 'readout', font: 'sans', size: 40, style: 'text', x: 1780, y: 1010, anchor: 'end', rule: 'readout', values: readoutValues, label: 'miles built (made up)' }
  ],
  shields: [], callouts: []
};

const gz = zlib.gzipSync(Buffer.from(JSON.stringify(scene)), { level: 9, mtime: 0 });

// A stored (method 0) zip, as the worker writes it, with fixed times and names.
function crc32(buf) { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return ~c >>> 0; }
function zip(files, deflate = false) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name);
    const stored = deflate ? zlib.deflateRawSync(data, { level: 9 }) : data;
    const method = deflate ? 8 : 0;
    const crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(0, 10); lh.writeUInt16LE(0x21, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(stored.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, stored);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(0, 12); ch.writeUInt16LE(0x21, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(stored.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + stored.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

export { scene, zip, gz, crc32 };

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  fs.mkdirSync(out, { recursive: true });
  const bytes = zip([['scene.json.gz', gz]]);
  fs.writeFileSync(path.join(out, 'scene-fixture.zip'), bytes);
  fs.writeFileSync(path.join(out, 'scene-fixture.js'),
    `// GENERATED by tools/make-scene-fixture.mjs: a synthetic scene bundle (zip, base64) for /app/?mock. Not real data.\nwindow.ryagramSceneFixtureB64 = '${bytes.toString('base64')}';\n`);
  console.log('scene-fixture.zip', bytes.length, 'bytes;', frames, 'frames;', periods.length, 'periods;', groups.reduce((n, g) => n + g.miles.length, 0), 'miles');
}
