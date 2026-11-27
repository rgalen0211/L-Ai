// Perfect City official counts (GEO 11-27): the page data files carry the U.S. Census Bureau's County Business Patterns (public domain)
// establishment counts for each kind that has a NAICS code, so a stranger can see how complete the map data is. The numbers are PINNED
// here, and, when the bulk CBP file is in the local cache, re-read from it (no network: the zip is read from disk only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import zlib from 'node:zlib';
import readline from 'node:readline';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const COUNTIES = { montgomery_oh: ['39', '113'], greene_oh: ['39', '057'] };
const NAICS = { fast_food: '722513', restaurant: '722511', grocery: '445110' };
const PINNED = { year: 2023, montgomery_oh: { fast_food: 515, restaurant: 302, grocery: 77 }, greene_oh: { fast_food: 154, restaurant: 118, grocery: 19 } };
const CBP = 'C:/Users/Ryan/Ryagram-cache/cbp_bulk/cbp23co.zip';

function pageDoc(county) {
  const win = {};
  vm.runInNewContext(read(`assets/perfect-city/${county}.census.js`), { window: win });
  return JSON.parse(JSON.stringify(win.ryagramPerfectCityData[county]));      // out of the vm realm, so deepEqual compares values only
}

test('the page data files carry the pinned County Business Patterns counts, labelled with year, source and NAICS code', () => {
  for (const county of Object.keys(COUNTIES)) {
    const o = pageDoc(county).official;
    assert.ok(o, `${county}: no official key`);
    assert.equal(o.year, PINNED.year);
    assert.match(o.source, /County Business Patterns 2023/);
    assert.match(o.source, /Public domain/);
    assert.deepEqual(o.not_counted, ['chicken', 'burger', 'pizza', 'sandwich', 'mexican', 'asian']);      // no NAICS code of their own
    assert.deepEqual(Object.keys(o.kinds), Object.keys(NAICS));
    for (const [kind, code] of Object.entries(NAICS)) {
      assert.equal(o.kinds[kind].naics, code, `${county} ${kind}`);
      assert.equal(o.kinds[kind].est, PINNED[county][kind], `${county} ${kind}`);
    }
  }
});

// Streams the one deflated entry out of the zip (central directory -> local header -> raw inflate), line by line.
async function cbpFromZip(path) {
  const buf = fs.readFileSync(path);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const cd = buf.readUInt32LE(eocd + 16);
  assert.equal(buf.readUInt32LE(cd), 0x02014b50);
  assert.equal(buf.readUInt16LE(cd + 10), 8, 'deflate');
  const csize = buf.readUInt32LE(cd + 20), lho = buf.readUInt32LE(cd + 42);
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const inflate = zlib.createInflateRaw();
  inflate.end(buf.subarray(start, start + csize));
  const want = new Map(Object.entries(COUNTIES).map(([k, [s, c]]) => [`"${s}","${c}",`, k]));
  const codes = new Set(Object.values(NAICS));
  const out = Object.fromEntries(Object.keys(COUNTIES).map((k) => [k, {}]));
  let head = null;
  for await (const line of readline.createInterface({ input: inflate, crlfDelay: Infinity })) {
    const cells = line.split(',').map((x) => x.replace(/^"|"$/g, ''));
    if (!head) { head = cells; continue; }
    const county = want.get(line.slice(0, 11));      // '"39","113",' is 11 characters
    if (!county || !codes.has(cells[head.indexOf('naics')])) continue;
    out[county][cells[head.indexOf('naics')]] = Number(cells[head.indexOf('est')]);
  }
  return out;
}

test('the counts equal the County Business Patterns 2023 county file in the local cache (skipped when the cache is absent)', async (t) => {
  if (!fs.existsSync(CBP)) { console.log(`SKIPPED (reason: ${CBP} is not on this machine; the pinned values above still hold)`); t.skip('no CBP cache'); return; }
  const got = await cbpFromZip(CBP);
  for (const county of Object.keys(COUNTIES)) {
    const o = pageDoc(county).official;
    for (const [kind, code] of Object.entries(NAICS)) {
      // a code with no row is unpublished (fewer than 3 or none): the file must then say null, never 0
      assert.equal(o.kinds[kind].est, code in got[county] ? got[county][code] : null, `${county} ${kind} (NAICS ${code})`);
    }
  }
});

test('the page says the official count beside the loaded count, and says the Census does not count chicken, burger, pizza, sandwich, Mexican or Asian places', () => {
  const src = read('assets/app-perfect-city.js');
  assert.match(src, /Census County Business Patterns \$\{o\.year\} counts \$\{n\}/);
  assert.match(src, /establishments in this county \(observed\); \$\{m\}/);
  assert.match(src, /the map data has \$\{fmt\(state\.loaded\)\} of this kind loaded/);
  assert.match(src, /'fewer than 3 or none \(not published\)'/);
  assert.match(src, /The Census does not count chicken, burger, pizza, sandwich, Mexican or Asian places separately\./);
});
