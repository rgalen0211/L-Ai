// source-fetch (supabase/functions/source-fetch/core.ts; find-data S2, NEXT-CONNECT 137) against stand-ins for the network, the database and the storage. Every refusal has a case that FAILS if the check is removed;
// the network stand-in records every address it is asked for, so "never contacted" is a thing the tests can say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../supabase/functions/source-fetch/core.ts';

const ALICE = '00000000-0000-4000-8000-00000000a11c';
const ATTEMPT = '11111111-1111-4111-8111-111111111111';
const DS = '22222222-2222-4222-8222-222222222222';
const CSV = 'State,Year,Jobs\nAlabama,2020,5\nAlaska,2020,6\n';
const FILE = 'https://www2.census.gov/programs/state.csv';
const ROBOTS = 'https://www2.census.gov/robots.txt';
const resp = (status, body = '', headers = {}) => new Response(body, { status, headers });
const csv = (body = CSV, extra = {}) => resp(200, body, { 'content-type': 'text/csv', ...extra });
const redirect = (to, status = 302) => resp(status, '', { location: to });

function listedFor(suffixes) { return (h) => suffixes.some((s) => h === s || h.endsWith('.' + s)); }

function setup({ routes = {}, listed = ['census.gov', 'bls.gov'], over = {} } = {}) {
  const calls = { reserve: [], fail: [], register: [], put: [], finish: [], abort: [], fetch: [], hostListed: [], logs: [] };
  const isListed = listedFor(listed);
  const table = { [ROBOTS]: () => resp(404), ...routes };
  const deps = {
    allowedOrigins: ['https://uselai.com'],
    verifyUser: async (jwt) => (jwt === 'good' ? { id: ALICE, clientId: null } : jwt === 'oauth' ? { id: ALICE, clientId: 'claude' } : null),
    hostListed: async (h) => { calls.hostListed.push(h); return isListed(h); },
    reserve: async (owner, host) => { calls.reserve.push([owner, host]); return ATTEMPT; },
    fail: async (a, r) => { calls.fail.push([a, r]); },
    register: async (a) => { calls.register.push(a); return { dataset_id: DS, storage_path: `${a.owner}/${DS}/source.${a.ext}`, trust_label: 'official', publisher: 'U.S. Census Bureau', licence_class: 'unknown' }; },
    storagePut: async (path, bytes, ct) => { calls.put.push([path, bytes.length, ct]); },
    finish: async (d) => { calls.finish.push(d); },
    abort: async (d) => { calls.abort.push(d); },
    fetch: async (url, init) => {
      calls.fetch.push({ url, init });
      const r = table[url];
      if (!r) throw new Error('unexpected address ' + url);
      return typeof r === 'function' ? r(init) : r;
    },
    now: () => new Date('2026-10-27T01:00:00Z'),
    ...over,
  };
  const call = async (body = { url: FILE }, { method = 'POST', bearer = 'good', origin = 'https://uselai.com', raw } = {}) => {
    const h = {}; if (bearer) h.authorization = `Bearer ${bearer}`; if (origin) h.origin = origin;
    const res = await handle(new Request('https://x.test/functions/v1/source-fetch', { method, headers: h, body: method === 'GET' ? undefined : (raw ?? JSON.stringify(body)) }), deps);
    let json = null; try { json = await res.clone().json(); } catch { /* none */ }
    return { status: res.status, json, text: await res.clone().text(), headers: res.headers };
  };
  return { calls, deps, call, table };
}
const asked = (calls) => calls.fetch.map((f) => f.url);

test('THE GOOD PATH: robots.txt, the file, its real type, the hash, a slot, the bytes, the queue; the reply says what and where it came from', async () => {
  const s = setup({ routes: { [FILE]: () => csv() } });
  const r = await s.call({ url: FILE, why: 'population by state' });
  assert.equal(r.status, 200);
  assert.deepEqual(asked(s.calls), [ROBOTS, FILE]);
  assert.deepEqual(s.calls.reserve, [[ALICE, 'www2.census.gov']]);
  const a = s.calls.register[0];
  assert.deepEqual(Object.keys(a).sort(), ['attempt', 'bytes', 'codeVersion', 'ext', 'finalUrl', 'name', 'owner', 'sha256', 'why']);        // there is no label, no licence, no trust in what the database is given
  assert.equal(a.attempt, ATTEMPT); assert.equal(a.owner, ALICE); assert.equal(a.finalUrl, FILE); assert.equal(a.ext, 'csv'); assert.equal(a.bytes, CSV.length); assert.equal(a.name, 'state.csv'); assert.equal(a.why, 'population by state');
  assert.equal(a.sha256, (await import('node:crypto')).createHash('sha256').update(CSV).digest('hex'));
  assert.deepEqual(s.calls.put, [[`${ALICE}/${DS}/source.csv`, CSV.length, 'text/csv']]);
  assert.deepEqual(s.calls.finish, [DS]);
  assert.deepEqual(s.calls.abort, []); assert.deepEqual(s.calls.fail, []);
  assert.deepEqual(Object.keys(r.json).sort(), ['bytes', 'dataset_id', 'file_type', 'final_url', 'licence_class', 'name', 'publisher', 'retrieved_at', 'sha256', 'state', 'trust_label', 'warning']);
  assert.equal(r.json.state, 'reading'); assert.equal(r.json.trust_label, 'official'); assert.equal(r.json.warning, ''); assert.equal(r.json.retrieved_at, '2026-10-27T01:00:00.000Z');
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('what the network is asked: GET only, manual redirects, no credentials, no cookie, no authorization, a User-Agent that names Ryagram and a contact', async () => {
  const s = setup({ routes: { [FILE]: () => csv() } });
  await s.call();
  for (const f of s.calls.fetch) {
    assert.equal(f.init.method, 'GET'); assert.equal(f.init.redirect, 'manual'); assert.equal(f.init.credentials, 'omit');
    const names = Object.keys(f.init.headers).map((k) => k.toLowerCase());
    assert.deepEqual(names.filter((n) => !['user-agent', 'accept'].includes(n)), [], 'only User-Agent and Accept are sent');
    assert.match(f.init.headers['User-Agent'], /^Ryagram-DataFetch\/\d.*@/);
    assert.ok(f.init.signal instanceof AbortSignal);
  }
});

test('a Set-Cookie from the site is never sent back on the next hop', async () => {
  const s = setup({ routes: { [FILE]: () => redirect('https://www2.census.gov/b.csv'), 'https://www2.census.gov/b.csv': () => csv(CSV, { 'set-cookie': 'sid=abc123; Path=/' }) } });
  assert.equal((await s.call()).status, 200);
  assert.ok(s.calls.fetch.every((f) => !JSON.stringify(f.init.headers).toLowerCase().includes('cookie') && !JSON.stringify(f.init.headers).includes('abc123')));
});

test('WHO: no sign-in 401, a wrong page 403, GET 405, OPTIONS 204, a connected AI 403; nothing is reserved or fetched for any of them', async () => {
  const s = setup({ routes: { [FILE]: () => csv() } });
  assert.equal((await s.call(undefined, { bearer: null })).status, 401);
  assert.equal((await s.call(undefined, { bearer: 'forged' })).status, 401);
  assert.equal((await s.call(undefined, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await s.call(undefined, { origin: null })).status, 403);
  assert.equal((await s.call(undefined, { method: 'GET' })).status, 405);
  assert.equal((await s.call(undefined, { method: 'OPTIONS' })).status, 204);
  const ai = await s.call(undefined, { bearer: 'oauth' });
  assert.equal(ai.status, 403); assert.match(ai.json.error, /not by a connected AI/);
  assert.deepEqual(s.calls.reserve, []); assert.deepEqual(asked(s.calls), []);
  assert.equal((await s.call()).status, 200);                                            // control
});

test('THE BODY: only url and why are read. A label, a licence, a dataset id or a host the caller adds is ignored', async () => {
  const s = setup({ routes: { [FILE]: () => csv() } });
  const r = await s.call({ url: FILE, why: 'x', trust_label: 'official', label: 'official', licence_class: 'open', publishable: true, dataset_id: DS, host: 'evil.example', publisher: 'Me' });
  assert.equal(r.status, 200);
  const a = s.calls.register[0];
  assert.ok(!JSON.stringify(a).match(/official|open|publishable|evil|"Me"/), 'none of it reaches the database');
  assert.equal(r.json.publisher, 'U.S. Census Bureau');                                  // what the database said, not what the caller said
  for (const bad of ['not json', '[]', '"x"', 'null', '5', '']) {
    const rr = await s.call(undefined, { raw: bad });
    assert.equal(rr.status, 400, bad);
  }
  assert.equal((await s.call({ why: 'no address' })).status, 400);
  assert.equal((await s.call({ url: 5 })).status, 400);
  assert.equal((await s.call({ url: FILE, why: 'w'.repeat(1000) })).status, 200);
  assert.equal(s.calls.register.at(-1).why.length, 300);                                 // why is cut to 300 characters
});

test('AN ADDRESS THE FUNCTION WILL NOT EVEN ASK THE DATABASE ABOUT: http, a port, a user name, an IP number, localhost, a unicode host; nothing reserved, nothing fetched', async () => {
  const s = setup();
  for (const u of ['http://www2.census.gov/a.csv', 'https://www2.census.gov:8443/a.csv', 'https://u@www2.census.gov/a.csv', 'https://203.0.113.5/a.csv', 'https://localhost/a.csv', 'https://cënsus.gov/a.csv', 'file:///etc/passwd', 'javascript:1']) {
    const r = await s.call({ url: u });
    assert.equal(r.status, 400, u); assert.equal(r.json.code, 'not_https', u);
  }
  assert.deepEqual(s.calls.reserve, []); assert.deepEqual(asked(s.calls), []); assert.deepEqual(s.calls.fail, []);
});

test('A HOST NOT ON THE LIST: the database refuses first (400, off_list) and nothing is fetched; if it ever let one through, the function still refuses before contacting it', async () => {
  const dbRefuses = setup({ over: { reserve: async () => { throw Object.assign(new Error('That address is not on the list of official sources Ryagram can fetch from yet.'), { code: '22023' }); } } });
  const r = await dbRefuses.call({ url: 'https://example.com/a.csv' });
  assert.equal(r.status, 400); assert.equal(r.json.code, 'off_list'); assert.match(r.json.error, /official sources/);
  assert.deepEqual(asked(dbRefuses.calls), []);
  const slip = setup({ listed: ['census.gov'] });                                           // the reserve stand-in accepts anything; the list check in the function does not
  const r2 = await slip.call({ url: 'https://example.com/a.csv' });
  assert.equal(r2.status, 400); assert.equal(r2.json.code, 'off_list');
  assert.deepEqual(asked(slip.calls), [], 'the off-list address is never contacted, not even for robots.txt');
  assert.deepEqual(slip.calls.fail, [[ATTEMPT, 'off_list']]);
  for (const u of ['https://census.gov.evil.com/a.csv', 'https://evilcensus.gov/a.csv', 'https://notcensus.gov/a.csv']) {
    const rr = await slip.call({ url: u });
    assert.equal(rr.json.code, 'off_list', u);
  }
  assert.deepEqual(asked(slip.calls), []);
});

test('THE DATABASE\'S OWN SENTENCES come back as they are (the hourly limit 429, sign-in 401); an unknown error is a generic 500 that leaks nothing', async () => {
  const mk = (code, message) => setup({ over: { reserve: async () => { throw Object.assign(new Error(message), { code }); } } });
  const a = await mk('PT429', 'That is 10 fetches in the last hour, the limit for now. Try again later.').call();
  assert.equal(a.status, 429); assert.match(a.json.error, /10 fetches in the last hour/);
  const b = await mk('22023', 'You have 20 uploaded datasets, the limit for now. Delete one to add another.').call();
  assert.equal(b.status, 400); assert.equal(b.json.code, 'quota');
  assert.equal((await mk('PT401', 'x').call()).status, 401);
  const c = await mk('XX000', 'relation "fetch_attempts" does not exist (SECRET-HINT)').call();
  assert.equal(c.status, 500); assert.ok(!c.text.includes('SECRET-HINT') && !c.text.includes('fetch_attempts'));
});

test('REDIRECTS: followed up to three times, each checked against the list BEFORE it is contacted; an off-list one, an http one and a fourth are refused', async () => {
  const B = 'https://www2.census.gov/b.csv', C = 'https://www2.census.gov/c.csv', D = 'https://www2.census.gov/d.csv', E = 'https://www2.census.gov/e.csv';
  const chain = setup({ routes: { [FILE]: () => redirect(B), [B]: () => redirect('/c.csv', 301), [C]: () => redirect(D, 307), [D]: () => csv() } });
  const ok = await chain.call();
  assert.equal(ok.status, 200);                                                               // three redirects: the original + three hops
  assert.equal(chain.calls.register[0].finalUrl, D);                                          // the label is looked up from where the bytes really came from
  const four = setup({ routes: { [FILE]: () => redirect(B), [B]: () => redirect(C), [C]: () => redirect(D), [D]: () => redirect(E), [E]: () => csv() } });
  const r4 = await four.call();
  assert.equal(r4.status, 422); assert.equal(r4.json.code, 'redirect');
  assert.ok(!asked(four.calls).includes(E), 'the fourth redirect is not followed');
  assert.deepEqual(four.calls.fail, [[ATTEMPT, 'redirect']]);
  const off = setup({ routes: { [FILE]: () => redirect('https://evil.example/data.csv') } });
  const ro = await off.call();
  assert.equal(ro.status, 422); assert.equal(ro.json.code, 'redirect');
  assert.ok(!asked(off.calls).some((u) => u.includes('evil.example')), 'the off-list address is never contacted');
  const look = setup({ routes: { [FILE]: () => redirect('https://census.gov.evil.example/a.csv') } });
  assert.equal((await look.call()).json.code, 'redirect');
  assert.ok(!asked(look.calls).some((u) => u.includes('evil')));
  const down = setup({ routes: { [FILE]: () => redirect('http://www2.census.gov/a.csv') } });
  assert.equal((await down.call()).json.code, 'redirect');
  assert.ok(!asked(down.calls).includes('http://www2.census.gov/a.csv'));
  const none = setup({ routes: { [FILE]: () => resp(302) } });
  assert.equal((await none.call()).json.code, 'redirect');                                     // a redirect with nowhere to go
  const port = setup({ routes: { [FILE]: () => redirect('https://www2.census.gov:8443/a.csv') } });
  assert.equal((await port.call()).json.code, 'redirect');
  const internal = setup({ routes: { [FILE]: () => redirect('https://127.0.0.1/admin') } });
  assert.equal((await internal.call()).json.code, 'redirect');
  assert.ok(!asked(internal.calls).some((u) => u.includes('127.0.0.1')));
  assert.equal((await ok.json && true), true);
});

test('SIZE: a declared size over 10 MiB is refused before the body is read; a stream with no size is cut off at the cap; exactly the cap is accepted', async () => {
  const big = 'x'.repeat(100) + '\n';
  const declared = setup({ routes: { [FILE]: () => { let read = false; const r = csv(big, { 'content-length': String(20 * 1024 * 1024) }); return r; } } });
  const rd = await declared.call();
  assert.equal(rd.status, 413); assert.equal(rd.json.code, 'too_big');
  assert.deepEqual(declared.calls.fail, [[ATTEMPT, 'too_big']]);
  let pulled = 0;
  const stream = setup({ routes: { [FILE]: () => resp(200, new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(1024 * 1024).fill(97)); } }), { 'content-type': 'text/csv' }) } });
  const rs = await stream.call();
  assert.equal(rs.status, 413);
  assert.ok(pulled <= 12, `stopped reading near the cap (pulled ${pulled} MiB)`);
  assert.deepEqual(stream.calls.register, []);
  const exact = new Uint8Array(10 * 1024 * 1024).fill(97); exact[10 * 1024 * 1024 - 1] = 10;
  const edge = setup({ routes: { [FILE]: () => resp(200, exact, { 'content-type': 'text/csv' }) } });
  assert.equal((await edge.call()).status, 200);
  const over = new Uint8Array(10 * 1024 * 1024 + 1).fill(97);
  const edge2 = setup({ routes: { [FILE]: () => resp(200, over, { 'content-type': 'text/csv' }) } });
  assert.equal((await edge2.call()).status, 413);
  const lying = setup({ routes: { [FILE]: () => resp(200, over, { 'content-type': 'text/csv', 'content-length': '10' }) } });
  assert.equal((await lying.call()).status, 413);                                              // a Content-Length that lies cannot get past the count
});

test('TIME: a site that never answers, and one that stalls the body, are cut off with a plain sentence (504) and the attempt is noted', async () => {
  const hang = (init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
  const never = setup({ routes: { [FILE]: hang }, over: { timeoutMs: 40 } });
  const r = await never.call();
  assert.equal(r.status, 504); assert.equal(r.json.code, 'too_slow');
  assert.deepEqual(never.calls.fail, [[ATTEMPT, 'too_slow']]);
  const stall = setup({ routes: { [FILE]: (init) => resp(200, new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('a,b\n')); }, pull() { return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))); } }), { 'content-type': 'text/csv' }) }, over: { timeoutMs: 40 } });
  assert.equal((await stall.call()).json.code, 'too_slow');
  const slowRobots = setup({ routes: { [ROBOTS]: hang }, over: { timeoutMs: 40 } });
  assert.equal((await slowRobots.call()).json.code, 'too_slow');
  assert.deepEqual(asked(slowRobots.calls), [ROBOTS]);
});

test('WHAT COMES BACK: a sign-in or paywall is refused and never retried, an error status is a plain sentence, HTML is not a data file', async () => {
  for (const st of [401, 402, 403]) {
    const s = setup({ routes: { [FILE]: () => resp(st, 'Login') } });
    const r = await s.call();
    assert.equal(r.status, 422, String(st)); assert.equal(r.json.code, 'login', String(st));
    assert.equal(asked(s.calls).filter((u) => u === FILE).length, 1, 'asked once, not retried');
  }
  for (const st of [404, 410, 429, 500, 503]) {
    const s = setup({ routes: { [FILE]: () => resp(st, 'nope') } });
    const r = await s.call();
    assert.equal(r.status, 502, String(st)); assert.equal(r.json.code, 'http_error', String(st));
  }
  const html = setup({ routes: { [FILE]: () => resp(200, '<!doctype html><html><body>Please sign in</body></html>', { 'content-type': 'text/html' }) } });
  assert.equal((await html.call()).json.code, 'is_html');
  const disguised = setup({ routes: { [FILE]: () => resp(200, '<html><head><title>Sign in</title></head>', { 'content-type': 'text/csv' }) } });
  assert.equal((await disguised.call()).json.code, 'is_html');                                 // the bytes decide, not the header
  const csvAsHtml = setup({ routes: { [FILE]: () => resp(200, CSV, { 'content-type': 'text/html' }) } });
  assert.equal((await csvAsHtml.call()).json.code, 'is_html');
  for (const [name, body, ct] of [['json', '{"a":1}', 'application/json'], ['pdf', '%PDF-1.7 x', 'application/pdf'], ['zip', new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0]), 'application/zip'], ['empty', '', 'text/csv']]) {
    const s = setup({ routes: { [FILE]: () => resp(200, body, { 'content-type': ct }) } });
    const r = await s.call();
    assert.equal(r.status, 415, name); assert.equal(r.json.code, 'not_a_table', name);
    assert.deepEqual(s.calls.register, [], name);
  }
});

test('robots.txt: a disallowed path is not fetched; an unreachable robots.txt means no; a missing one means yes; an API host is exempt', async () => {
  const dis = setup({ routes: { [ROBOTS]: () => resp(200, 'User-agent: *\nDisallow: /programs/\n'), [FILE]: () => csv() } });
  const r = await dis.call();
  assert.equal(r.status, 422); assert.equal(r.json.code, 'robots');
  assert.ok(!asked(dis.calls).includes(FILE), 'the file itself is not requested');
  const ours = setup({ routes: { [ROBOTS]: () => resp(200, 'User-agent: ryagram\nDisallow: /\n\nUser-agent: *\nAllow: /\n'), [FILE]: () => csv() } });
  assert.equal((await ours.call()).json.code, 'robots');                                       // our own group wins
  const allow = setup({ routes: { [ROBOTS]: () => resp(200, 'User-agent: *\nDisallow: /private/\n'), [FILE]: () => csv() } });
  assert.equal((await allow.call()).status, 200);
  const down = setup({ routes: { [ROBOTS]: () => resp(503), [FILE]: () => csv() } });
  assert.equal((await down.call()).json.code, 'robots');
  assert.ok(!asked(down.calls).includes(FILE));
  const gone = setup({ routes: { [ROBOTS]: () => resp(404), [FILE]: () => csv() } });
  assert.equal((await gone.call()).status, 200);
  const forbidden = setup({ routes: { [ROBOTS]: () => resp(403), [FILE]: () => csv() } });
  assert.equal((await forbidden.call()).status, 200);                                          // RFC 9309: a 4xx robots.txt means "no rules"
  const redirectingRobots = setup({ routes: { [ROBOTS]: () => redirect('https://evil.example/robots.txt'), [FILE]: () => csv() } });
  assert.equal((await redirectingRobots.call()).json.code, 'robots');
  assert.ok(!asked(redirectingRobots.calls).some((u) => u.includes('evil')));
  const apiUrl = 'https://api.census.gov/data/2020/pep.csv';
  const api = setup({ routes: { [apiUrl]: () => csv() } });
  assert.equal((await api.call({ url: apiUrl })).status, 200);
  assert.deepEqual(asked(api.calls), [apiUrl], 'no robots.txt is asked for on an API host');
  const apiPath = 'https://www2.census.gov/api/x.csv';
  const api2 = setup({ routes: { [ROBOTS]: () => resp(200, 'User-agent: *\nDisallow: /\n'), [apiPath]: () => csv() } });
  assert.equal((await api2.call({ url: apiPath })).status, 200);
  const huge = setup({ routes: { [ROBOTS]: () => resp(200, 'User-agent: *\n' + '#'.repeat(70 * 1024)), [FILE]: () => csv() } });
  assert.equal((await huge.call()).json.code, 'robots');                                       // a robots.txt over 64 KB is not parsed: no
});

test('the types: xlsx and ods are recognised from the file, tsv from its first line', async () => {
  const enc = new TextEncoder();
  const zip = (names) => { // a stored zip with these names
    const parts = [], cds = []; let off = 0;
    for (const [name, body] of names) {
      const nm = Buffer.from(name), data = Buffer.from(body);
      const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
      const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
      parts.push(lh, nm, data); cds.push(ch, nm); off += 30 + nm.length + data.length;
    }
    const cd = Buffer.concat(cds), eo = Buffer.alloc(22); eo.writeUInt32LE(0x06054b50, 0); eo.writeUInt16LE(names.length, 8); eo.writeUInt16LE(names.length, 10); eo.writeUInt32LE(cd.length, 12); eo.writeUInt32LE(off, 16);
    return new Uint8Array(Buffer.concat([...parts, cd, eo]));
  };
  const run = async (url, body) => { const s = setup({ routes: { [url]: () => resp(200, body, { 'content-type': 'application/octet-stream' }) } }); const r = await s.call({ url }); return { r, s }; };
  const x = await run('https://www2.census.gov/a.xlsx', zip([['[Content_Types].xml', '<x/>'], ['xl/workbook.xml', '<w/>']]));
  assert.equal(x.r.status, 200); assert.equal(x.s.calls.register[0].ext, 'xlsx'); assert.equal(x.s.calls.put[0][2], 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const o = await run('https://www2.census.gov/a.ods', zip([['mimetype', 'application/vnd.oasis.opendocument.spreadsheet'], ['content.xml', '<c/>']]));
  assert.equal(o.s.calls.register[0].ext, 'ods'); assert.equal(o.s.calls.put[0][2], 'application/vnd.oasis.opendocument.spreadsheet');
  const t = await run('https://www2.census.gov/a.txt', enc.encode('a\tb\n1\t2\n'));
  assert.equal(t.s.calls.register[0].ext, 'tsv'); assert.equal(t.s.calls.put[0][2], 'text/tab-separated-values');
  assert.equal(t.s.calls.register[0].name, 'a.txt');
});

test('the database or the storage failing: the quota sentence, a stored file that cannot be queued is removed again, and every failure is noted once', async () => {
  const quota = setup({ routes: { [FILE]: () => csv() }, over: { register: async () => { throw Object.assign(new Error('That would take you over 100 MB of uploaded data, the limit for now. Delete a file to make room.'), { code: '22023' }); } } });
  const q = await quota.call();
  assert.equal(q.status, 400); assert.equal(q.json.code, 'quota');
  assert.deepEqual(quota.calls.put, []); assert.deepEqual(quota.calls.fail, [[ATTEMPT, 'quota']]);
  const putFails = setup({ routes: { [FILE]: () => csv() }, over: { storagePut: async () => { throw new Error('bucket down: SECRET-HINT'); } } });
  const p = await putFails.call();
  assert.equal(p.status, 502); assert.equal(p.json.code, 'storage'); assert.ok(!p.text.includes('SECRET-HINT'));
  assert.deepEqual(putFails.calls.abort, [DS]); assert.deepEqual(putFails.calls.finish, []);   // the unfinished dataset is removed, finish is never called
  assert.deepEqual(putFails.calls.fail, [[ATTEMPT, 'storage']]);
  const finFails = setup({ routes: { [FILE]: () => csv() }, over: { finish: async () => { throw Object.assign(new Error('x'), { code: '22023' }); } } });
  const f = await finFails.call();
  assert.equal(f.status, 502); assert.deepEqual(finFails.calls.abort, [DS]); assert.deepEqual(finFails.calls.fail, [[ATTEMPT, 'storage']]);
  const abortFails = setup({ routes: { [FILE]: () => csv() }, over: { storagePut: async () => { throw new Error('x'); }, abort: async () => { throw new Error('y'); } } });
  assert.equal((await abortFails.call()).status, 502);                                         // even a failing clean-up answers plainly
  const failNote = setup({ routes: { [FILE]: () => resp(404) }, over: { fail: async () => { throw new Error('db gone'); } } });
  const n = await failNote.call();
  assert.equal(n.status, 502); assert.equal(n.json.code, 'http_error');                         // and a failing note does not turn a refusal into a crash
});

test('a label other than Official comes with a plain warning that names the publisher; Official has none', async () => {
  const others = setup({ routes: { [FILE]: () => csv() }, over: { register: async (a) => ({ dataset_id: DS, storage_path: `${a.owner}/${DS}/source.csv`, trust_label: 'published_by_others', publisher: 'A University', licence_class: 'open' }) } });
  const r = await others.call();
  assert.equal(r.json.trust_label, 'published_by_others');
  assert.match(r.json.warning, /Ryagram has not checked these figures\. They come from A University\./);
});

test('every refusal reaches the person as {error, code} with a sentence and notes the attempt exactly once; no refusal registers or stores anything', async () => {
  const cases = [
    [{ [FILE]: () => resp(404) }, 'http_error'], [{ [FILE]: () => resp(403) }, 'login'], [{ [FILE]: () => redirect('https://evil.example/x') }, 'redirect'], [{ [FILE]: () => resp(200, '<html>', { 'content-type': 'text/html' }) }, 'is_html'],
    [{ [FILE]: () => resp(200, '{"a":1}') }, 'not_a_table'], [{ [ROBOTS]: () => resp(200, 'User-agent: *\nDisallow: /\n') }, 'robots'],
  ];
  for (const [routes, code] of cases) {
    const s = setup({ routes });
    const r = await s.call();
    assert.equal(r.json.code, code); assert.ok(typeof r.json.error === 'string' && r.json.error.length > 20);
    assert.deepEqual(s.calls.fail, [[ATTEMPT, code]], code);
    assert.deepEqual(s.calls.register, [], code); assert.deepEqual(s.calls.put, [], code); assert.deepEqual(s.calls.finish, [], code);
  }
});
