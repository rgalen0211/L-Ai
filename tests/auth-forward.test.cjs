// The site root (and /ryagram/) forward a Supabase auth result in the address fragment to the app: assets/auth-forward.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '../assets/auth-forward.js'), 'utf8');

function run(hash, pathname = '/') {
  const replaced = [];
  vm.runInNewContext(code, { URLSearchParams, location: { hash, pathname, replace: u => replaced.push(u) } });
  return replaced;
}

test('FORWARD: an auth error on the root goes to the app\'s expired screen, with the error text left behind', () => {
  assert.deepEqual(run('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'), ['/app/#/auth/expired']);
  assert.deepEqual(run('#error_code=otp_expired'), ['/app/#/auth/expired']);
});

test('FORWARD: a session Supabase already verified goes to the app with its fragment (the app takes it)', () => {
  assert.deepEqual(run('#access_token=AAA&refresh_token=BBB&type=recovery'), ['/app/#access_token=AAA&refresh_token=BBB&type=recovery']);
});

test('FORWARD: everything else is left alone: no hash, an ordinary anchor, an app route, a page already inside /app/', () => {
  for (const [hash, p] of [['', '/'], ['#top', '/'], ['#creators', '/ryagram/'], ['#/auth/expired', '/'], ['#error=x', '/app/'], ['#access_token=A&refresh_token=B', '/app/']]) {
    assert.deepEqual(run(hash, p), [], hash + ' ' + p);
  }
});

test('FORWARD: the home page and /ryagram/ load it first, as an external script (no inline script, CSP-safe)', () => {
  for (const f of ['index.html', 'ryagram/index.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.match(html, /<script src="\/assets\/auth-forward\.js"><\/script>/, f);
    assert.ok(html.indexOf('auth-forward.js') < html.indexOf('analytics'), f + ': before the other scripts');
  }
  assert.doesNotMatch(code, /fetch|XMLHttpRequest|sendBeacon|document\.|localStorage/);                         // it only redirects
});
