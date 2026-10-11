const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');

const R = (() => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'assets/report.js'), 'utf8'), { window });
  return window.ryagramReport;
})();
const SLUG = 'AbCdEfGhIjKlMnOpQrStUv';

test('the film is found from a link, a bare code, or a ?s= fragment, and nothing else', () => {
  assert.equal(R.slugFrom(`https://uselai.com/film/?s=${SLUG}`), SLUG);
  assert.equal(R.slugFrom(`https://uselai.com/film/?utm=x&s=${SLUG}#sources`), SLUG);
  assert.equal(R.slugFrom(SLUG), SLUG);
  assert.equal(R.slugFrom(` ${SLUG} `), SLUG);
  for (const bad of ['', null, 'short', `${SLUG}x`, `https://uselai.com/film/?s=${SLUG}extra`, 'https://uselai.com/film/']) assert.equal(R.slugFrom(bad), null, String(bad));
});

test('the report is checked before it is sent, and the honeypot rides along', () => {
  const ok = { film: SLUG, reason: 'harassment', email: 'a@b.co', details: ' it is bad ', website: '' };
  assert.deepEqual(JSON.parse(JSON.stringify(R.build(ok).body)), { p_slug: SLUG, p_reason: 'harassment', p_email: 'a@b.co', p_details: 'it is bad', p_website: '' });
  assert.match(R.build({ ...ok, film: 'x' }).error, /link/);
  assert.match(R.build({ ...ok, reason: 'nope' }).error, /problem/);
  assert.match(R.build({ ...ok, email: 'no' }).error, /email/);
  assert.match(R.build({ ...ok, details: 'x'.repeat(4001) }).error, /too long/);
  assert.equal(R.build({ ...ok, website: 'spam' }).body.p_website, 'spam');
});

test('sending goes to the report RPC with only the public key, and failures say something kind', async () => {
  const calls = [];
  const cfg = { supabaseUrl: 'https://x.supabase.co', supabaseKey: 'sb_publishable_k' };
  const ok = async (url, init) => { calls.push([url, init.headers.apikey, init.method]); return { ok: true }; };
  assert.equal(await R.send({ p_slug: SLUG }, ok, cfg), true);
  assert.deepEqual(calls[0], ['https://x.supabase.co/rest/v1/rpc/report_film_page', 'sb_publishable_k', 'POST']);
  await assert.rejects(R.send({}, async () => ({ ok: false, json: async () => ({ message: 'Too many reports. Please try again later.' }) }), cfg), /Too many reports from this email/);
  await assert.rejects(R.send({}, async () => ({ ok: false, json: async () => { throw new Error('x'); } }), cfg), /ryagram@uselai.com/);
  await assert.rejects(R.send({}, ok, {}), /not available/);
});

test('the help and report pages are static, allow no inline script or style, and the film page links to the report page', () => {
  for (const f of ['help/index.html', 'report/index.html']) {
    const html = fs.readFileSync(path.join(root, f), 'utf8');
    assert.match(html, /script-src 'self'/, f);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/, f);
    assert.doesNotMatch(html, /\sstyle=/, f);
    assert.doesNotMatch(html, /\son[a-z]+=/i, f);
  }
  assert.match(fs.readFileSync(path.join(root, 'film/index.html'), 'utf8'), /id="report-link" href="\/report\/"/);
  assert.match(fs.readFileSync(path.join(root, 'assets/film.js'), 'utf8'), /\/report\/\?film=\$\{slug\}/);
});

test('the FAQ has its 7 answers and none is hidden (the uploaded-data answer is live: uploadreader is on main)', () => {
  const html = fs.readFileSync(path.join(root, 'help/index.html'), 'utf8');
  assert.match(html, /<details><summary>My own data/);
  assert.equal((html.match(/<details/g) || []).length, 7);
  assert.doesNotMatch(html, /<details[^>]*hidden/);
});
