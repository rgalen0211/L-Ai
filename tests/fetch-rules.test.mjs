// The pure rules of fetching a file (supabase/functions/_shared/fetch_rules.ts; find-data S2, NEXT-CONNECT 137). Each refusal has a case that FAILS if the rule is removed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTarget, robotsAllows, sniff, zipNames, nameFor, isApiPath, MAX_BYTES, MAX_REDIRECTS, TIMEOUT_MS, SENTENCES } from '../supabase/functions/_shared/fetch_rules.ts';

const enc = (s) => new TextEncoder().encode(s);

function makeZip(entries) {                                  // a stored zip with the given names (and bodies), built by hand
  const parts = [], cds = [];
  let off = 0;
  for (const [name, body] of entries) {
    const nm = Buffer.from(name), data = Buffer.from(body);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nm, data); cds.push(ch, nm); off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(cds), eo = Buffer.alloc(22);
  eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(entries.length, 8); eo.writeUInt16LE(entries.length, 10); eo.writeUInt32LE(cd.length, 12); eo.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, eo]));
}

test('the limits are the written ones', () => {
  assert.equal(MAX_BYTES, 10 * 1024 * 1024);
  assert.equal(MAX_REDIRECTS, 3);
  assert.equal(TIMEOUT_MS, 20000);
});

test('an address must be https on the standard port with no user name or password, and a plain ASCII host name', () => {
  const good = parseTarget('https://www2.census.gov/programs/state.csv?x=1#frag');
  assert.equal(good.ok, true);
  assert.equal(good.host, 'www2.census.gov');
  assert.equal(good.url.hash, '');                                                     // a fragment is dropped
  assert.equal(parseTarget('https://www2.census.gov:443/a.csv').ok, true);              // the standard port spelled out is the same port
  const bad = {
    'http': 'http://www2.census.gov/a.csv', 'ftp': 'ftp://www2.census.gov/a.csv', 'file': 'file:///etc/passwd', 'javascript': 'javascript:alert(1)', 'data': 'data:text/csv,a,b',
    'port 8443': 'https://www2.census.gov:8443/a.csv', 'port 80': 'https://www2.census.gov:80/a.csv', 'user': 'https://user@www2.census.gov/a.csv', 'user+password': 'https://u:p@www2.census.gov/a.csv',
    'ip v4': 'https://203.0.113.5/a.csv', 'ip v4 as a number': 'https://3405803781/a.csv', 'ip v4 hex': 'https://0xcb007105/a.csv', 'ip v6': 'https://[::1]/a.csv', 'localhost': 'https://localhost/a.csv',
    'no dot': 'https://intranet/a.csv', 'punycode': 'https://xn--census-9ua.gov/a.csv', 'unicode host': 'https://cënsus.gov/a.csv', 'backslash': 'https://evil.example\\@www2.census.gov/a.csv',
    'space': 'https://www2.census.gov/a b.csv', 'newline': 'https://www2.census.gov/a.csv\nHost: evil', 'empty': '', 'relative': '/a.csv', 'only scheme': 'https://',
  };
  for (const [what, u] of Object.entries(bad)) assert.equal(parseTarget(u).ok, false, what);
  for (const x of [null, undefined, 5, {}, [], true]) assert.equal(parseTarget(x).ok, false, String(x));
  assert.equal(parseTarget('https://www2.census.gov/' + 'a'.repeat(2000)).ok, false);   // over 2000 characters
  assert.equal(parseTarget('https://www2.census.gov%2eevil.com/a.csv').ok === true && parseTarget('https://www2.census.gov%2eevil.com/a.csv').host === 'www2.census.gov', false); // a %-escaped dot cannot hide a different host from the list check
  assert.equal(parseTarget('https://evil.example/@www2.census.gov/a.csv').host, 'evil.example');                         // the host is the one the parser sees
  assert.equal(parseTarget('https://WWW2.CENSUS.GOV/a.csv').host, 'www2.census.gov');                                      // lower-cased by the parser, so the list sees lower case
  assert.equal(parseTarget('https://www2.census.gov./a.csv').ok, false);                                                   // a trailing dot is not accepted (it would dodge a suffix check)
});

test('a redirect target is resolved against the page it came from and held to the same rules', () => {
  assert.equal(parseTarget('/other/a.csv', 'https://www2.census.gov/x/y.csv').url.href, 'https://www2.census.gov/other/a.csv');
  assert.equal(parseTarget('http://www2.census.gov/a.csv', 'https://www2.census.gov/x').ok, false);                         // downgrade to http
  assert.equal(parseTarget('//evil.example/a.csv', 'https://www2.census.gov/x').host, 'evil.example');                       // a scheme-relative one points elsewhere: the list will refuse it
  assert.equal(parseTarget('https://www2.census.gov:8080/a.csv', 'https://www2.census.gov/x').ok, false);
});

test('robots.txt: the group for us else *, longest rule wins, Allow wins a tie, * and $ work, an empty Disallow allows', () => {
  const t = 'User-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /*.tmp$\n\nUser-agent: badbot\nDisallow: /\n';
  assert.equal(robotsAllows(t, '/data/a.csv'), true);
  assert.equal(robotsAllows(t, '/private/a.csv'), false);
  assert.equal(robotsAllows(t, '/private/ok/a.csv'), true);                        // the longer Allow beats the shorter Disallow
  assert.equal(robotsAllows(t, '/files/x.tmp'), false);
  assert.equal(robotsAllows(t, '/files/x.tmp.csv'), true);                         // '$' means the end
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\n', '/anything'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /x\nAllow: /x\n', '/x/y'), true);                       // the same length: Allow wins
  assert.equal(robotsAllows('User-agent: *\nAllow: /x\nDisallow: /x\n', '/x/y'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow:\n', '/anything'), true);
  assert.equal(robotsAllows('', '/anything'), true);
  assert.equal(robotsAllows('User-agent: ryagram\nDisallow: /d\n\nUser-agent: *\nAllow: /\n', '/d/x'), false);   // our own group wins over *
  assert.equal(robotsAllows('User-agent: ryagram-datafetch\nAllow: /\n\nUser-agent: *\nDisallow: /\n', '/x'), true);
  assert.equal(robotsAllows('User-agent: a\nUser-agent: *\nDisallow: /x\n', '/x/y'), false);                       // two user-agent lines share one group
  assert.equal(robotsAllows('User-agent: *\nDisallow: /a#comment\n', '/a/b'), false);                              // comments are stripped
  assert.equal(robotsAllows('USER-AGENT: *\nDISALLOW: /a\n', '/a'), false);                                        // keys are case-insensitive
  assert.equal(robotsAllows('User-agent: *\nDisallow: /a.b\n', '/aXb'), true);                                      // a dot in a path is a dot, not "any character"
});

test('an api host or an /api/ path is not held to robots.txt', () => {
  assert.equal(isApiPath(new URL('https://api.census.gov/data/x')), true);
  assert.equal(isApiPath(new URL('https://www.census.gov/api/x')), true);
  assert.equal(isApiPath(new URL('https://www.census.gov/apix/x')), false);
  assert.equal(isApiPath(new URL('https://www.census.gov/programs/x.csv')), false);
});

test('the bytes decide what a file is: csv, tsv, xlsx, ods; everything else is refused with its own reason', () => {
  assert.deepEqual(sniff(enc('State,Year,Jobs\nAlabama,2020,5\n'), 'text/csv'), { ok: true, ext: 'csv' });
  assert.deepEqual(sniff(enc('State\tYear\tJobs\nAlabama\t2020\t5\n'), 'application/octet-stream'), { ok: true, ext: 'tsv' });
  assert.deepEqual(sniff(enc('\xEF\xBB\xBFState,Year\n'), ''), { ok: true, ext: 'csv' });
  assert.deepEqual(sniff(enc('value\n1\n2\n'), ''), { ok: true, ext: 'csv' });                        // one column is still a table
  assert.deepEqual(sniff(makeZip([['[Content_Types].xml', '<x/>'], ['xl/workbook.xml', '<w/>']]), ''), { ok: true, ext: 'xlsx' });
  assert.deepEqual(sniff(makeZip([['mimetype', 'application/vnd.oasis.opendocument.spreadsheet'], ['content.xml', '<c/>']]), ''), { ok: true, ext: 'ods' });
  const no = (b, ct = '') => sniff(typeof b === 'string' ? enc(b) : b, ct);
  assert.deepEqual(no('<!DOCTYPE html><html><body>Sign in</body></html>'), { ok: false, reason: 'is_html' });
  assert.deepEqual(no('  \n<html lang="en"><head>'), { ok: false, reason: 'is_html' });
  assert.deepEqual(no('a,b\n1,2\n', 'text/html; charset=utf-8'), { ok: false, reason: 'is_html' });          // the header alone refuses it too
  assert.deepEqual(no('a,b\n1,2\n', 'application/xhtml+xml'), { ok: false, reason: 'is_html' });
  assert.deepEqual(no('{"a":1}'), { ok: false, reason: 'not_a_table' });
  assert.deepEqual(no('[{"a":1}]'), { ok: false, reason: 'not_a_table' });
  assert.deepEqual(no('<?xml version="1.0"?><a/>'), { ok: false, reason: 'not_a_table' });
  // each magic number followed by plain printable text, so ONLY the magic number can refuse it (no NUL byte, no control characters)
  const magicThen = (...m) => new Uint8Array([...m, ...enc('A'.repeat(600))]);
  assert.deepEqual(no('%PDF-1.7 ' + 'A'.repeat(600)), { ok: false, reason: 'not_a_table' });
  assert.deepEqual(no(magicThen(0x4d, 0x5a)), { ok: false, reason: 'not_a_table' });                                    // an executable
  assert.deepEqual(no(magicThen(0x7f, 0x45, 0x4c, 0x46)), { ok: false, reason: 'not_a_table' });                         // a Linux program
  assert.deepEqual(no(magicThen(0x1f, 0x8b)), { ok: false, reason: 'not_a_table' });                                    // gzip
  assert.deepEqual(no(magicThen(0xd0, 0xcf, 0x11, 0xe0)), { ok: false, reason: 'not_a_table' });                         // an old .xls
  assert.deepEqual(no(magicThen(0x89, 0x50, 0x4e, 0x47)), { ok: false, reason: 'not_a_table' });                         // a picture
  assert.deepEqual(no(magicThen(0xff, 0xd8, 0xff)), { ok: false, reason: 'not_a_table' });
  assert.deepEqual(no(magicThen(0x47, 0x49, 0x46, 0x38)), { ok: false, reason: 'not_a_table' });
  assert.deepEqual(no(magicThen(0x42, 0x5a, 0x68)), { ok: false, reason: 'not_a_table' });                                // bzip2
  assert.deepEqual(no(magicThen(0x37, 0x7a, 0xbc, 0xaf)), { ok: false, reason: 'not_a_table' });                          // 7-zip
  assert.deepEqual(sniff(enc('A'.repeat(600) + ',b\n1,2\n'), ''), { ok: true, ext: 'csv' });                              // control: the same filler without a magic number is a table
  assert.deepEqual(no('a,b\n\u0000\u0000,2\n'), { ok: false, reason: 'not_a_table' });                      // NUL bytes
  assert.deepEqual(no('a,b\n' + '1,2\n'.repeat(500) + '\u0000'), { ok: false, reason: 'not_a_table' });      // ONE NUL byte in a long table (too few to trip the control-character count)
  assert.deepEqual(no(''), { ok: false, reason: 'not_a_table' });
  assert.deepEqual(no(makeZip([['hello.txt', 'hi']])), { ok: false, reason: 'not_a_table' });                // some other zip
  assert.deepEqual(no(makeZip([['content.xml', '<c/>'], ['mimetype', 'text/plain']])), { ok: false, reason: 'not_a_table' });   // an odt-like zip whose mimetype is not a spreadsheet
  assert.deepEqual(no(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])), { ok: false, reason: 'not_a_table' });             // a zip that cannot be read
  assert.equal(zipNames(new Uint8Array([1, 2, 3])), null);
  assert.deepEqual(zipNames(makeZip([['a', 'x'], ['b/c', 'y']])), ['a', 'b/c']);
  assert.equal(no('<script>alert(1)</script>').reason, 'is_html');
});

test('the dataset name comes from the last part of the address, safe characters only', () => {
  assert.equal(nameFor(new URL('https://www2.census.gov/programs/State%20Data.csv'), 'csv'), 'State Data.csv');
  assert.equal(nameFor(new URL('https://www2.census.gov/a/<script>x.csv'), 'csv'), 'script x.csv');
  assert.equal(nameFor(new URL('https://www2.census.gov/'), 'csv'), 'www2.census.gov data.csv');
  assert.equal(nameFor(new URL('https://www2.census.gov/%E0%A4%A.csv'), 'csv').length > 0, true);                // a broken escape still gives a name
  assert.ok(nameFor(new URL('https://www2.census.gov/' + 'a'.repeat(500) + '.csv'), 'csv').length <= 120);
});

test('every refusal reason has a plain sentence and none of them leaks an address or a code', () => {
  for (const [k, v] of Object.entries(SENTENCES)) {
    assert.ok(v.length > 20 && v.endsWith('.'), k);
    assert.doesNotMatch(v, /https?:|[A-Za-z0-9_]{25,}|PT\d{3}|SQL|stack/i, k);
  }
});
