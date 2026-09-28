const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../assets/app-auth.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../app/index.html'), 'utf8');

function el(extra = {}) {
  return { hidden: true, textContent: '', disabled: false, focus() { this.focused = true; }, ...extra };
}

function harness({ config = { supabaseUrl: 'https://p.supabase.co', supabaseKey: 'sb_publishable_x' }, signIn, count = 0, library = true } = {}) {
  const listeners = {};
  const button = el();
  const form = {
    elements: { email: { value: ' ryan@example.com ' }, password: { value: 'pw' } },
    reportValidity: () => true,
    querySelector: () => button,
    addEventListener(type, fn) { listeners.submit = fn; }
  };
  const signOut = el({ addEventListener(type, fn) { listeners.signOut = fn; } });
  const els = {
    'app-status': el(), 'sign-in': el(), library: el(), account: el(), 'sign-in-form': form,
    'sign-in-error': el(), 'account-email': el(), 'library-summary': el(), 'sign-out': signOut
  };
  const calls = { created: null, signIn: [], signOut: 0, queries: [] };
  let authListener;
  const client = {
    auth: {
      onAuthStateChange(fn) { authListener = fn; },
      signInWithPassword: async creds => { calls.signIn.push(creds); return signIn ? signIn(creds) : { error: null }; },
      signOut: async () => { calls.signOut++; }
    },
    from(table) {
      return { select: async (cols, opts) => { calls.queries.push({ table, cols, opts }); return { count, error: null }; } };
    }
  };
  const window = { ryagramConfig: config };
  if (library) window.supabase = { createClient: (url, key, opts) => { calls.created = { url, key, opts }; return client; } };
  vm.runInNewContext(code, { document: { getElementById: id => els[id] }, window, setTimeout: fn => fn() });
  const flush = () => new Promise(r => setImmediate(r));
  return { els, button, calls, window, emit: async s => { authListener('X', s); await flush(); },
           submit: () => listeners.submit({ preventDefault() {} }), signOut: () => listeners.signOut() };
}

test('the page only ever uses the public URL and publishable key', () => {
  const h = harness();
  assert.equal(h.calls.created.url, 'https://p.supabase.co');
  assert.equal(h.calls.created.key, 'sb_publishable_x');
  assert.equal(h.calls.created.opts.auth.detectSessionInUrl, false);
  assert.doesNotMatch(code + html, /service_role|sk-ant|anthropic/i);
  assert.match(html, /integrity="sha384-[A-Za-z0-9+/=]+" crossorigin="anonymous"/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /noindex/);
});

test('no session shows sign-in; a session shows the library and the account', async () => {
  const h = harness({ count: 1 });
  await h.emit(null);
  assert.equal(h.els['sign-in'].hidden, false);
  assert.equal(h.els.library.hidden, true);
  await h.emit({ user: { email: 'ryan@example.com' } });
  assert.equal(h.els['sign-in'].hidden, true);
  assert.equal(h.els.library.hidden, false);
  assert.equal(h.els['account-email'].textContent, 'ryan@example.com');
  assert.equal(h.calls.queries[0].table, 'projects');
  assert.match(h.els['library-summary'].textContent, /^1 project\./);
  await h.emit(null);
  assert.equal(h.els.library.hidden, true);
  assert.equal(h.els.account.hidden, true);
});

test('sign-in trims the email, clears the password on success, and explains failures', async () => {
  const ok = harness();
  await ok.submit();
  assert.equal(JSON.stringify(ok.calls.signIn[0]), JSON.stringify({ email: 'ryan@example.com', password: 'pw' }));
  assert.equal(ok.els['sign-in-form'].elements.password.value, '');

  const wrong = harness({ signIn: () => ({ error: { status: 400, code: 'invalid_credentials' } }) });
  await wrong.submit();
  assert.match(wrong.els['sign-in-error'].textContent, /don’t match/);
  assert.equal(wrong.button.disabled, false);

  const down = harness({ signIn: () => { throw new TypeError('Failed to fetch'); } });
  await down.submit();
  assert.match(down.els['sign-in-error'].textContent, /Couldn’t reach/);

  // supabase-js reports network failures as an error object, not a throw.
  const offline = harness({ signIn: () => ({ error: { status: 0, name: 'AuthRetryableFetchError' } }) });
  await offline.submit();
  assert.match(offline.els['sign-in-error'].textContent, /Couldn’t reach/);
});

test('missing config or library stops before creating a client', () => {
  const noConfig = harness({ config: {} });
  assert.equal(noConfig.calls.created, null);
  assert.match(noConfig.els['app-status'].textContent, /isn’t connected/);
  const noLib = harness({ library: false });
  assert.match(noLib.els['app-status'].textContent, /didn’t load/);
});

test('sign out calls Supabase', async () => {
  const h = harness();
  await h.signOut();
  assert.equal(h.calls.signOut, 1);
});
