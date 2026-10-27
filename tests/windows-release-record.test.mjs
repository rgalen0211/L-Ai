// The website's release record (assets/windows-release.js; NEXT-CONNECT 133, CC1 2026-10-26 20:01): it is EMPTY until a built zip is published, and once it is filled it must agree with the zip it names.
// EMPTY record: the committed shape is all null and the card stays off (this is what main holds). FILLED record: an https GitHub release address whose last part is the file name, a safe .zip name, a
// 64-hex SHA-256, a whole-number size, AND the built zip itself must be named in RYAGRAM_RELEASE_ZIP so its exact size and SHA-256 are compared (a filled record with no zip named FAILS: it cannot be skipped).
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

// the rules, as a function, so the planted faults below can be run through the SAME code
function problems(r, zipPath) {
  const out = [];
  if (typeof r.url !== 'string' || !/^https:\/\/[a-z0-9]{20}\.supabase\.co\/functions\/v1\/app-download$/.test(r.url)) out.push('the address is not the project\'s app-download function (https://<project>.supabase.co/functions/v1/app-download)');
  if (typeof r.fileName !== 'string' || !/^[A-Za-z0-9._-]+\.zip$/.test(r.fileName)) out.push('the file name is not a plain .zip name');
  if (typeof r.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(r.sha256)) out.push('the SHA-256 is not 64 lowercase hex characters');
  if (!Number.isInteger(r.sizeMb) || r.sizeMb < 1) out.push('the size is not a whole number of MB');
  if (!Number.isInteger(r.unpackedMb) || r.unpackedMb < 1 || r.unpackedMb > 20000) out.push('the unzipped size (unpackedMb) is not a whole number of MB between 1 and 20000 (the card works out the free space it asks for from it)');
  else if (Number.isInteger(r.sizeMb) && r.unpackedMb < r.sizeMb) out.push('the unzipped size is smaller than the zip');
  if (!zipPath) out.push('no built zip is named in RYAGRAM_RELEASE_ZIP, so the record cannot be compared with it');
  else if (!fs.existsSync(zipPath)) out.push('the named zip does not exist');
  else {
    const b = fs.readFileSync(zipPath);
    if (crypto.createHash('sha256').update(b).digest('hex') !== r.sha256) out.push('the record\'s SHA-256 is not the built zip\'s');
    if (Math.round(b.length / 1e6) !== r.sizeMb) out.push(`the record's size (${r.sizeMb} MB) is not the built zip's (${Math.round(b.length / 1e6)} MB)`);
    const un = unzippedBytes(b);
    if (un === null) out.push('the named file is not a readable zip');
    else if (Number.isInteger(r.unpackedMb) && Math.round(un / 1e6) !== r.unpackedMb) out.push(`the record's unzipped size (${r.unpackedMb} MB) is not the built zip's (${Math.round(un / 1e6)} MB)`);
    if (r.fileName && zipPath.replace(/\\/g, '/').split('/').pop() !== r.fileName) out.push('the file name is not the built zip\'s name');
  }
  return out;
}

test('the committed record is either empty (all null) or fully agrees with the built zip it names', () => {
  if (!filled) {
    assert.deepEqual(Object.values(rec).filter((v) => v !== null), [], 'an empty record has every field null');
    return;
  }
  assert.deepEqual(problems(rec, process.env.RYAGRAM_RELEASE_ZIP), []);
});

test('the rules themselves: a good record passes, each fault is named (the same code that guards a filled record)', () => {
  const dir = fs.mkdtempSync((process.env.TEMP || '.') + '/rel-');
  const zip = dir + '/app-test.zip';
  fs.writeFileSync(zip, makeZip('app/x.bin', Buffer.alloc(2_345_678, 7)));
  const sha = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
  const good = { url: 'https://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/app-download', fileName: 'app-test.zip', sha256: sha, sizeMb: 2, unpackedMb: 2 };
  assert.deepEqual(problems(good, zip), []);
  const bad = (patch, zp = zip) => problems({ ...good, ...patch }, zp);
  assert.ok(bad({ sha256: '0'.repeat(64) }).some((p) => /not the built zip/.test(p)), 'a wrong hash');
  assert.ok(bad({ sizeMb: 3 }).some((p) => /size/.test(p)), 'a wrong size');
  assert.ok(bad({ unpackedMb: 9 }).some((p) => /unzipped size/.test(p)), 'MUST-FAIL: an unzipped size that does not match the built zip');
  assert.ok(bad({ unpackedMb: null }).some((p) => /unpackedMb/.test(p)), 'MUST-FAIL: a record with no unzipped size cannot pass');
  assert.ok(bad({ unpackedMb: 1.5 }).some((p) => /unpackedMb/.test(p)), 'a fractional unzipped size');
  assert.ok(bad({ unpackedMb: 1 }).some((p) => /smaller than the zip/.test(p)), 'an unzipped size smaller than the zip');
  assert.ok(bad({ fileName: 'other.zip' }).some((p) => /name/.test(p)), 'a wrong file name');
  assert.ok(bad({ url: 'http://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/app-download' }).some((p) => /app-download function/.test(p)), 'http');
  assert.ok(bad({ url: 'https://evil.example/functions/v1/app-download' }).some((p) => /app-download function/.test(p)), 'another host');
  assert.ok(bad({ url: 'https://github.com/rgalen0211/L-Ai/releases/download/app-test/app-test.zip' }).some((p) => /app-download function/.test(p)), 'MUST-FAIL: a public GitHub release address is no longer accepted');
  assert.ok(bad({ url: 'https://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/other-function' }).some((p) => /app-download function/.test(p)), 'another function');
  assert.ok(bad({ sha256: 'A'.repeat(64) }).some((p) => /64 lowercase/.test(p)), 'upper case hex');
  assert.ok(bad({}, null).some((p) => /no built zip is named/.test(p)), 'MUST-FAIL: a filled record with no zip named cannot pass');
  fs.rmSync(dir, { recursive: true, force: true });
});
