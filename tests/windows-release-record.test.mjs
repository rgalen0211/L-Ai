// The website's release record (assets/windows-release.js; NEXT-CONNECT 133, CC1 2026-10-26 20:01): it is EMPTY until a built zip is published, and once it is filled it must agree with the zip it names.
// EMPTY record: the committed shape is all null and the card stays off (this is what main holds). FILLED record: an https GitHub release address whose last part is the file name, a safe .zip name, a
// 64-hex SHA-256, a whole-number size, AND the built zip itself must be named in RYAGRAM_RELEASE_ZIP so its exact size and SHA-256 are compared (a filled record with no zip named FAILS: it cannot be skipped).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import vm from 'node:vm';

const load = (src) => { const win = {}; vm.runInNewContext(src, { window: win }); return JSON.parse(JSON.stringify(win.ryagramWindowsApp)); };
const rec = load(fs.readFileSync(new URL('../assets/windows-release.js', import.meta.url), 'utf8'));
const filled = !!(rec.url || rec.fileName || rec.sha256);

// the rules, as a function, so the planted faults below can be run through the SAME code
function problems(r, zipPath) {
  const out = [];
  if (typeof r.url !== 'string' || !/^https:\/\/github\.com\/rgalen0211\/L-Ai\/releases\/download\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\.zip$/.test(r.url)) out.push('the address is not an https GitHub release asset of rgalen0211/L-Ai');
  if (typeof r.fileName !== 'string' || !/^[A-Za-z0-9._-]+\.zip$/.test(r.fileName)) out.push('the file name is not a plain .zip name');
  else if (typeof r.url === 'string' && r.url.split('/').pop() !== r.fileName) out.push('the file name is not the last part of the address');
  if (typeof r.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(r.sha256)) out.push('the SHA-256 is not 64 lowercase hex characters');
  if (!Number.isInteger(r.sizeMb) || r.sizeMb < 1) out.push('the size is not a whole number of MB');
  if (!zipPath) out.push('no built zip is named in RYAGRAM_RELEASE_ZIP, so the record cannot be compared with it');
  else if (!fs.existsSync(zipPath)) out.push('the named zip does not exist');
  else {
    const b = fs.readFileSync(zipPath);
    if (crypto.createHash('sha256').update(b).digest('hex') !== r.sha256) out.push('the record\'s SHA-256 is not the built zip\'s');
    if (Math.round(b.length / 1e6) !== r.sizeMb) out.push(`the record's size (${r.sizeMb} MB) is not the built zip's (${Math.round(b.length / 1e6)} MB)`);
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
  fs.writeFileSync(zip, Buffer.alloc(2_345_678, 7));
  const sha = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
  const good = { url: 'https://github.com/rgalen0211/L-Ai/releases/download/app-test/app-test.zip', fileName: 'app-test.zip', sha256: sha, sizeMb: 2 };
  assert.deepEqual(problems(good, zip), []);
  const bad = (patch, zp = zip) => problems({ ...good, ...patch }, zp);
  assert.ok(bad({ sha256: '0'.repeat(64) }).some((p) => /not the built zip/.test(p)), 'a wrong hash');
  assert.ok(bad({ sizeMb: 3 }).some((p) => /size/.test(p)), 'a wrong size');
  assert.ok(bad({ fileName: 'other.zip' }).some((p) => /last part|name/.test(p)), 'a wrong file name');
  assert.ok(bad({ url: 'http://github.com/rgalen0211/L-Ai/releases/download/app-test/app-test.zip' }).some((p) => /https/.test(p)), 'http');
  assert.ok(bad({ url: 'https://evil.example/rgalen0211/L-Ai/releases/download/app-test/app-test.zip' }).some((p) => /GitHub/.test(p)), 'another host');
  assert.ok(bad({ sha256: 'A'.repeat(64) }).some((p) => /64 lowercase/.test(p)), 'upper case hex');
  assert.ok(bad({}, null).some((p) => /no built zip is named/.test(p)), 'MUST-FAIL: a filled record with no zip named cannot pass');
  fs.rmSync(dir, { recursive: true, force: true });
});
