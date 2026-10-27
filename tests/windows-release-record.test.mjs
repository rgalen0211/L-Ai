// The website's release record (assets/windows-release.js; NEXT-CONNECT 133, CC1 2026-10-26 20:01): it is EMPTY until a built zip is published, and once it is filled it must agree with the zip it names.
// EMPTY record: the committed shape is all null and the card stays off (this is what main holds). FILLED record: an https GitHub release address whose last part is the file name, a safe .zip name, a
// 64-hex SHA-256, a whole-number size and unzipped size, AND it must EQUAL the committed pins (assets/windows-release.pins.json: the built zip's file name, size and unzipped size in bytes, and SHA-256, written from the real zip by
// tools/check-release-pins.py). The pins make this test need no file outside the repo, so it never turns main red on a PC without the 274 MB zip. When RYAGRAM_RELEASE_ZIP names the zip, the record and pins are ALSO compared with it;
// without it that comparison is printed as SKIPPED, never a failure (tools/check-release-pins.py --zip and tools/check-release-asset.py do that comparison at release time).
// THE DOWNLOAD IS INVITE-ONLY ON CLOUDFLARE R2 (Ryan's Q248, 2026-10-26): the record's url is NOT a file, it is the app-download FUNCTION's address on the project's own functions host
// (https://<project>.supabase.co/functions/v1/app-download), which hands a signed-in invitee a 15-minute link; the file itself is in a private bucket.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';

// the unzipped size of a zip, read from its central directory (nothing is extracted): the sum of every entry's uncompressed size
function unzippedBytes(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) return null;
  let n = buf.readUInt16LE(e + 10), p = buf.readUInt32LE(e + 16), sum = 0;
  while (n-- > 0) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    sum += buf.readUInt32LE(p + 24);
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return sum;
}
// a one-entry stored zip, built by hand, so the rules can be tried on a real zip of a known unzipped size
function makeZip(name, data) {
  const crcTable = Array.from({ length: 256 }, (_, i) => { let c = i; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  let crc = 0xffffffff; for (const b of data) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8); crc = (crc ^ 0xffffffff) >>> 0;
  const nm = Buffer.from(name), lh = Buffer.alloc(30), ch = Buffer.alloc(46), eo = Buffer.alloc(22);
  lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
  ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28);
  const cdOff = 30 + nm.length + data.length;
  eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(1, 8); eo.writeUInt16LE(1, 10); eo.writeUInt32LE(46 + nm.length, 12); eo.writeUInt32LE(cdOff, 16);
  return Buffer.concat([lh, nm, data, ch, nm, eo]);
}

const load = (src) => { const win = {}; vm.runInNewContext(src, { window: win }); return JSON.parse(JSON.stringify(win.ryagramWindowsApp)); };
const rec = load(fs.readFileSync(new URL('../assets/windows-release.js', import.meta.url), 'utf8'));
const filled = !!(rec.url || rec.fileName || rec.sha256);
const pinsUrl = new URL('../assets/windows-release.pins.json', import.meta.url);
const pins = fs.existsSync(pinsUrl) ? JSON.parse(fs.readFileSync(pinsUrl, 'utf8')) : null;

// the rules, as a function, so the planted faults below can be run through the SAME code
function problems(r, pins, zipPath) {
  const out = [];
  if (typeof r.url !== 'string' || !/^https:\/\/[a-z0-9]{20}\.supabase\.co\/functions\/v1\/app-download$/.test(r.url)) out.push('the address is not the project\'s app-download function (https://<project>.supabase.co/functions/v1/app-download)');
  if (typeof r.fileName !== 'string' || !/^[A-Za-z0-9._-]+\.zip$/.test(r.fileName)) out.push('the file name is not a plain .zip name');
  if (typeof r.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(r.sha256)) out.push('the SHA-256 is not 64 lowercase hex characters');
  if (!Number.isInteger(r.sizeMb) || r.sizeMb < 1) out.push('the size is not a whole number of MB');
  if (!Number.isInteger(r.unpackedMb) || r.unpackedMb < 1 || r.unpackedMb > 20000) out.push('the unzipped size (unpackedMb) is not a whole number of MB between 1 and 20000 (the card works out the free space it asks for from it)');
  else if (Number.isInteger(r.sizeMb) && r.unpackedMb < r.sizeMb) out.push('the unzipped size is smaller than the zip');
  // the committed pins: the facts of the built zip, written once from the real file
  if (!pins) out.push('assets/windows-release.pins.json is missing: a filled record must equal the pins of the zip it names (tools/check-release-pins.py --write --zip <zip>)');
  else {
    if (!(typeof pins.fileName === 'string' && Number.isInteger(pins.sizeBytes) && Number.isInteger(pins.unzippedBytes) && /^[0-9a-f]{64}$/.test(pins.sha256 || ''))) out.push('the pins file is malformed');
    else {
      if (r.fileName !== pins.fileName) out.push('the record\'s file name is not the pins\'');
      if (r.sha256 !== pins.sha256) out.push('the record\'s SHA-256 is not the pins\'');
      if (r.sizeMb !== Math.round(pins.sizeBytes / 1e6)) out.push(`the record's size (${r.sizeMb} MB) is not the pins' (${Math.round(pins.sizeBytes / 1e6)} MB)`);
      if (r.unpackedMb !== Math.round(pins.unzippedBytes / 1e6)) out.push(`the record's unzipped size (${r.unpackedMb} MB) is not the pins' (${Math.round(pins.unzippedBytes / 1e6)} MB)`);
    }
  }
  // the real zip, when it is on this PC and named: record AND pins must agree with the file itself
  if (zipPath && !fs.existsSync(zipPath)) out.push('the named zip does not exist');
  else if (zipPath) {
    const b = fs.readFileSync(zipPath);
    const un = unzippedBytes(b);
    if (crypto.createHash('sha256').update(b).digest('hex') !== r.sha256) out.push('the record\'s SHA-256 is not the built zip\'s');
    if (Math.round(b.length / 1e6) !== r.sizeMb) out.push(`the record's size (${r.sizeMb} MB) is not the built zip's (${Math.round(b.length / 1e6)} MB)`);
    if (un === null) out.push('the named file is not a readable zip');
    else if (Math.round(un / 1e6) !== r.unpackedMb) out.push(`the record's unzipped size (${r.unpackedMb} MB) is not the built zip's (${Math.round(un / 1e6)} MB)`);
    if (pins && (pins.sizeBytes !== b.length || pins.unzippedBytes !== un)) out.push('the pins\' byte sizes are not the built zip\'s');
    if (zipPath.replace(/\\/g, '/').split('/').pop() !== r.fileName) out.push('the file name is not the built zip\'s name');
  }
  return out;
}

test('the committed record is either empty (all null) or fully agrees with its committed pins (and with the built zip too when RYAGRAM_RELEASE_ZIP names it)', () => {
  if (!filled) {
    assert.deepEqual(Object.values(rec).filter((v) => v !== null), [], 'an empty record has every field null');
    return;
  }
  if (!process.env.RYAGRAM_RELEASE_ZIP) console.log('zip comparison SKIPPED (not passed): set RYAGRAM_RELEASE_ZIP to the built zip to compare the record and pins with it');
  assert.deepEqual(problems(rec, pins, process.env.RYAGRAM_RELEASE_ZIP), []);
});

test('the rules themselves: a good record passes WITHOUT the zip, each fault is named (the same code that guards a filled record)', () => {
  const dir = fs.mkdtempSync((process.env.TEMP || '.') + '/rel-');
  const zip = dir + '/app-test.zip';
  const zb = makeZip('app/x.bin', Buffer.alloc(2_345_678, 7));
  fs.writeFileSync(zip, zb);
  const sha = crypto.createHash('sha256').update(zb).digest('hex');
  const good = { url: 'https://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/app-download', fileName: 'app-test.zip', sha256: sha, sizeMb: 2, unpackedMb: 2 };
  const goodPins = { fileName: 'app-test.zip', sizeBytes: zb.length, unzippedBytes: 2_345_678, sha256: sha };
  assert.deepEqual(problems(good, goodPins, null), [], 'no zip on this PC: the record and pins alone are enough');
  assert.deepEqual(problems(good, goodPins, zip), [], 'and with the zip named, everything agrees');
  const bad = (patch, zp = null, pn = goodPins) => problems({ ...good, ...patch }, pn, zp);
  const badPins = (patch, zp = null) => problems(good, { ...goodPins, ...patch }, zp);
  // the record against the pins (no zip needed)
  assert.ok(bad({ sha256: '0'.repeat(64) }).some((p) => /not the pins/.test(p)), 'MUST-FAIL: a record hash that is not the pins\'');
  assert.ok(badPins({ sha256: '1'.repeat(64) }).some((p) => /SHA-256 is not the pins/.test(p)), 'MUST-FAIL: pins that differ from the record (hash)');
  assert.ok(badPins({ sizeBytes: 9_000_000 }).some((p) => /size .* is not the pins/.test(p)), 'MUST-FAIL: pins that differ from the record (size)');
  assert.ok(badPins({ unzippedBytes: 90_000_000 }).some((p) => /unzipped size .* is not the pins/.test(p)), 'MUST-FAIL: pins that differ from the record (unzipped size)');
  assert.ok(badPins({ fileName: 'other.zip' }).some((p) => /file name is not the pins/.test(p)), 'MUST-FAIL: pins that differ from the record (file name)');
  assert.ok(problems(good, null, null).some((p) => /pins.json is missing/.test(p)), 'MUST-FAIL: a filled record with no pins file cannot pass');
  assert.ok(badPins({ sha256: 'xyz' }).some((p) => /malformed/.test(p)), 'a malformed pins file');
  assert.ok(bad({ sizeMb: 3 }).some((p) => /size/.test(p)), 'a wrong size');
  assert.ok(bad({ unpackedMb: 9 }).some((p) => /unzipped size/.test(p)), 'MUST-FAIL: an unzipped size that does not match');
  assert.ok(bad({ unpackedMb: null }).some((p) => /unpackedMb/.test(p)), 'MUST-FAIL: a record with no unzipped size cannot pass');
  assert.ok(bad({ unpackedMb: 1.5 }).some((p) => /unpackedMb/.test(p)), 'a fractional unzipped size');
  assert.ok(bad({ unpackedMb: 1 }).some((p) => /smaller than the zip/.test(p)), 'an unzipped size smaller than the zip');
  assert.ok(bad({ fileName: 'other.zip' }).some((p) => /name/.test(p)), 'a wrong file name');
  assert.ok(bad({ url: 'http://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/app-download' }).some((p) => /app-download function/.test(p)), 'http');
  assert.ok(bad({ url: 'https://evil.example/functions/v1/app-download' }).some((p) => /app-download function/.test(p)), 'another host');
  assert.ok(bad({ url: 'https://github.com/rgalen0211/L-Ai/releases/download/app-test/app-test.zip' }).some((p) => /app-download function/.test(p)), 'MUST-FAIL: a public GitHub release address is not accepted');
  assert.ok(bad({ url: 'https://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/other-function' }).some((p) => /app-download function/.test(p)), 'another function');
  assert.ok(bad({ sha256: 'A'.repeat(64) }).some((p) => /64 lowercase/.test(p)), 'upper case hex');
  // when the zip IS named, the file itself is compared too
  assert.ok(problems({ ...good, sha256: 'f'.repeat(64) }, { ...goodPins, sha256: 'f'.repeat(64) }, zip).some((p) => /not the built zip/.test(p)), 'MUST-FAIL: record and pins that agree with each other but not with the real zip');
  assert.ok(problems(good, { ...goodPins, sizeBytes: zb.length + 1 }, zip).some((p) => /pins' byte sizes/.test(p)), 'pins whose byte size is not the zip\'s');
  assert.ok(bad({}, dir + '/missing.zip').some((p) => /does not exist/.test(p)), 'a named zip that is not there');
  fs.rmSync(dir, { recursive: true, force: true });
});
