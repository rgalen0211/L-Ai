// "Download my data" (assets/app-download-data.js, NEXT-WEB 153): a stored zip that reads back exactly, names that cannot climb out of the folder, and a receipt in words and as JSON that says
// what it knows (a fetched file's address and date, a fingerprint that does or does not match, a file that is no longer kept, a cleaned table that does not exist yet) and nothing it does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const window = { crypto: crypto.webcrypto };
vm.runInNewContext(fs.readFileSync(path.join(here, '..', 'assets/app-download-data.js'), 'utf8'),
  { window, Uint32Array, Uint8Array, DataView, ArrayBuffer, TextEncoder, String, Number, Date, JSON, Math, Set, Error, Array, Object, Promise, crypto: crypto.webcrypto, URL, Blob });
const Z = window.ryagramDownloadData;
const plain = x => JSON.parse(JSON.stringify(x));
const bytes = s => new TextEncoder().encode(s);

// a minimal reader, written independently of the writer: central directory first, then each local entry
function readZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = buf.length - 22;
  assert.equal(dv.getUint32(eocd, true), 0x06054b50);
  const count = dv.getUint16(eocd + 10, true), cdSize = dv.getUint32(eocd + 12, true), cdAt = dv.getUint32(eocd + 16, true);
  assert.equal(cdAt + cdSize, eocd);
  const out = {};
  let p = cdAt;
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50);
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), off = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl));
    assert.equal(dv.getUint32(off, true), 0x04034b50);
    const lnl = dv.getUint16(off + 26, true), lel = dv.getUint16(off + 28, true), start = off + 30 + lnl + lel;
    const data = buf.subarray(start, start + size);
    assert.equal(dv.getUint16(off + 8, true), 0, 'stored, not compressed');
    assert.equal(Z.crc32(data), crc, `crc of ${name}`);
    out[name] = data;
    p += 46 + nl;
  }
  return out;
}

test('CRC-32 matches the standard check value, and a stored zip reads back byte for byte', () => {
  assert.equal(Z.crc32(bytes('123456789')), 0xcbf43926);
  const files = [{ name: 'RECEIPT.txt', bytes: bytes('hello') }, { name: 'source/data.csv', bytes: bytes('a,b\n1,2\n') }, { name: 'empty.bin', bytes: new Uint8Array(0) }];
  const back = readZip(Z.storedZip(files, new Date(2026, 9, 27, 16, 30, 0)));
  assert.deepEqual(Object.keys(back), ['RECEIPT.txt', 'source/data.csv', 'empty.bin']);
  assert.equal(new TextDecoder().decode(back['source/data.csv']), 'a,b\n1,2\n');
  assert.equal(back['empty.bin'].length, 0);
  assert.throws(() => Z.storedZip([{ name: 'x', bytes: bytes('1') }, { name: 'x', bytes: bytes('2') }]), /same file name twice/);
});

test('names inside the zip can not climb out: no dots-and-slashes, no drive letters, at most one folder, never empty', () => {
  for (const [given, want] of [['../../etc/passwd', 'etc/passwd'], ['C:\\Users\\me\\secret.csv', 'C__Users_me_secret.csv'], ['a/b/c/d.csv', 'c/d.csv'], ['', 'file'], ['...', 'file'],
                               ['  spaced   name .csv', 'spaced name .csv'], ['<b>x</b>.csv', '_b_x_/b_.csv']]) {
    assert.equal(Z.entryName(given), want, given);
  }
  assert.equal(Z.safeName('x'.repeat(300)).length, 120);
  assert.equal(Z.safeName(null, 'data'), 'data');
  const back = readZip(Z.storedZip([{ name: '../../evil.sh', bytes: bytes('x') }]));
  assert.deepEqual(Object.keys(back), ['folder/evil.sh']);                          // the dots became a harmless folder name, inside the zip
});

const upload = { id: '11111111-1111-4111-8111-111111111111', name: 'Jobs by state', filename_label: 'jobs.csv', ext: 'csv', bytes: 1234, sha256: 'a'.repeat(64), status: 'approved', retention: 'keep',
  trust_label: 'unverified_user', trust_ack_at: '2026-10-20T10:00:00Z', uploaded_at: '2026-10-19T09:00:00Z', mapping: { place_index: 0, period_index: 1, value_indexes: [2] }, ingest_report: { rows: 150 }, origin: 'uploaded' };
const fetched = { ...upload, origin: 'fetched', licence_class: 'unknown' };
const fetchRow = { final_url: 'https://www.bls.gov/data/x.csv', host: 'www.bls.gov', publisher: 'U.S. Bureau of Labor Statistics', retrieved_at: '2026-10-25T08:00:00Z', licence_text: 'Public domain unless noted.', licence_class: 'unknown', licence_source: 'host_default', sha256: 'a'.repeat(64) };

test('the receipt of an upload says where it came from, the fingerprint, what the person acknowledged and that no cleaned table exists yet', () => {
  const r = Z.buildReceipt({ dataset: upload, fileKept: true, sourceName: 'jobs.csv', sha256Computed: 'a'.repeat(64), cleanKept: false, madeAt: new Date('2026-10-27T16:30:00Z'), trustWords: () => 'Unverified, user-supplied' });
  assert.equal(r.receipt.came_from.kind, 'uploaded_by_you');
  assert.equal(r.receipt.came_from.uploaded_on, '2026-10-19');
  assert.equal(r.receipt.dataset.fingerprint_matches, true);
  assert.equal(r.receipt.trust.label, 'Unverified, user-supplied');
  assert.equal(r.receipt.trust.you_acknowledged_on, '2026-10-20');
  assert.equal(r.receipt.in_this_zip.cleaned_table, null);
  assert.match(r.text, /you uploaded it on 2026-10-19/);
  assert.match(r.text, /\(the same\)/);
  assert.match(r.text, /NOTE: The cleaned table is not available for this dataset yet/);
  assert.ok(r.text.includes('\r\n'));
  assert.deepEqual(plain(r.receipt.how_ryagram_read_it.column_meanings_you_confirmed), upload.mapping);
});

test('the receipt of a fetched file carries its address, publisher, retrieval date and licence; a fingerprint that differs is named, not hidden', () => {
  const r = Z.buildReceipt({ dataset: fetched, fetchRow, fileKept: true, sourceName: 'jobs.csv', sha256Computed: 'b'.repeat(64), cleanKept: false });
  assert.equal(r.receipt.came_from.kind, 'fetched');
  assert.equal(r.receipt.came_from.address, 'https://www.bls.gov/data/x.csv');
  assert.equal(r.receipt.came_from.retrieved_on, '2026-10-25');
  assert.match(r.text, /U\.S\. Bureau of Labor Statistics, fetched on 2026-10-25 from https:\/\/www\.bls\.gov\/data\/x\.csv/);
  assert.match(r.text, /Licence: Public domain unless noted\./);
  assert.equal(r.receipt.dataset.fingerprint_matches, false);
  assert.match(r.text, /\(DIFFERENT\)/);
  assert.match(r.text, /does NOT match the fingerprint/);
});

test('a file that is no longer kept still gets a receipt, said plainly; hostile text in a person\'s own names never reaches the receipt as markup or control characters', () => {
  const evil = { ...upload, filename_label: '<img src=x onerror=1>\u202e\u0001jobs', ext: 'c<sv>' };
  const r = Z.buildReceipt({ dataset: evil, fileKept: false, sourceName: null, sha256Computed: null, cleanKept: false });
  assert.equal(r.receipt.in_this_zip.source_file, null);
  assert.match(r.text, /no source file: it is no longer kept/);
  assert.match(r.receipt.notes[0], /no longer kept/);
  assert.doesNotMatch(r.json + r.text, /[<>]/);
  assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(r.json + r.text));
  assert.equal(r.receipt.dataset.fingerprint_matches, null);
});

test('data that may not be handed back (a future broker licence class) has no button; today nothing is hidden', () => {
  assert.equal(Z.canDownload(upload), true);
  assert.equal(Z.canDownload(fetched), true);
  assert.equal(Z.canDownload({ ...upload, licence_class: 'broker' }), false);
  assert.equal(Z.canDownload({ ...upload, licence_class: 'no_redistribution' }), false);
  assert.equal(Z.canDownload(null), false);
});

test('makeZip end to end: the receipt (words and JSON) and the file exactly as received; the fingerprint is computed from the bytes in the zip; a cleaned table is included only when given', async () => {
  const csv = 'State,Year,Jobs\nAlabama,2019,100\n';
  const sha = crypto.createHash('sha256').update(csv).digest('hex');
  const made = await Z.makeZip({ dataset: { ...upload, sha256: sha }, fetchRow: null, file: new Blob([csv]), clean: null }, { now: new Date('2026-10-27T16:30:00Z') });
  const back = readZip(made.zip);
  assert.deepEqual(Object.keys(back).sort(), ['RECEIPT.txt', 'receipt.json', 'source/jobs.csv']);
  assert.equal(new TextDecoder().decode(back['source/jobs.csv']), csv);
  const rj = JSON.parse(new TextDecoder().decode(back['receipt.json']));
  assert.equal(rj.dataset.fingerprint_matches, true);
  assert.equal(rj.dataset.sha256_of_file_in_this_zip, sha);
  assert.match(made.zipName, /^jobs\.csv \(my data 2026-10-27\)\.zip$/);
  const withClean = await Z.makeZip({ dataset: { ...upload, sha256: sha }, fetchRow: null, file: new Blob([csv]), clean: new Blob(['place,period,value\n']) });
  assert.ok('clean.csv' in readZip(withClean.zip));
  const noFile = await Z.makeZip({ dataset: upload, fetchRow: null, file: null, clean: null });
  assert.deepEqual(Object.keys(readZip(noFile.zip)).sort(), ['RECEIPT.txt', 'receipt.json']);
  const tampered = await Z.makeZip({ dataset: { ...upload, sha256: 'f'.repeat(64) }, fetchRow: null, file: new Blob([csv]), clean: null });
  assert.equal(JSON.parse(new TextDecoder().decode(readZip(tampered.zip)['receipt.json'])).dataset.fingerprint_matches, false);
});
