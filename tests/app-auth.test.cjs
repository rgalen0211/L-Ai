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

function harness({ config = { supabaseUrl: 'https://p.supabase.co', supabaseKey: 'sb_publishable_x' }, signIn, library = true,
                  location = { hostname: 'uselai.com', search: '', pathname: '/app/', hash: '#/', origin: 'https://uselai.com' },
                  verifyOtp, updateUser, resetPassword } = {}) {
  const listeners = {};
  const button = el();
  const form = {
    elements: { email: { value: ' ryan@example.com ' }, password: { value: 'pw' } },
    reportValidity: () => true,
    querySelector: () => button,
    addEventListener(type, fn) { listeners.submit = fn; }
  };
  const signOut = el({ addEventListener(type, fn) { listeners.signOut = fn; } });
  // "Forgot your password?" and the reset-link forms.
  const miniForm = (name, fields) => {
    const b = el();
    return { hidden: true, elements: fields, reportValidity: () => true, querySelector: () => b, button: b,
             addEventListener(type, fn) { listeners[name] = fn; } };
  };
  const resetForm = miniForm('reset', { email: { value: '', focus() {} } });
  const setForm = miniForm('setPassword', { password: { value: '' }, again: { value: '' } });
  const forgot = el({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(type, fn) { listeners.forgot = fn; } });
  const appended = [];
  const els = {
    'app-status': el(), 'sign-in': el(), library: el(), account: el(), 'sign-in-form': form,
    'sign-in-error': el(), 'account-email': el(), 'sign-out': signOut,
    forgot, 'reset-form': resetForm, 'reset-note': el(), 'set-password': el(), 'set-password-form': setForm,
    'set-password-error': el(), 'set-password-title': el()
  };
  const calls = { created: null, signIn: [], signOut: 0, mounts: 0, unmounts: 0, verify: [], update: [], reset: [], replaced: [] };
  let authListener;
  const client = {
    auth: {
      onAuthStateChange(fn) { authListener = fn; },
      signInWithPassword: async creds => { calls.signIn.push(creds); return signIn ? signIn(creds) : { error: null }; },
      signOut: async () => { calls.signOut++; },
      verifyOtp: async args => { calls.verify.push(args); return verifyOtp ? verifyOtp(args) : { error: null }; },
      updateUser: async args => { calls.update.push(args); return updateUser ? updateUser(args) : { error: null }; },
      resetPasswordForEmail: async (email, opts) => { calls.reset.push({ email, opts }); return resetPassword ? resetPassword() : { error: null }; },
      getSession: async () => ({ data: { session: { user: { email: 'ryan@example.com' } } } })
    }
  };
  const history = { replaceState: (a, b, url) => { calls.replaced.push(url); } };
  const window = {
    ryagramConfig: config,
    ryagramData: c => ({ client: c }),
    ryagramLibrary: { mount(root, data) { calls.mounts++; calls.mountedWith = { root, data }; return () => { calls.unmounts++; }; } }
  };
  if (library) window.supabase = { createClient: (url, key, opts) => { calls.created = { url, key, opts }; return client; } };
  vm.runInNewContext(code, { document: { getElementById: id => els[id], createElement: () => ({}), body: { append: x => appended.push(x) } }, window,
                            location: { pathname: '/app/', hash: '', origin: 'https://uselai.com', ...location }, history, URLSearchParams, setTimeout: fn => fn() });
  const flush = () => new Promise(r => setImmediate(r));
  return { els, button, calls, window, appended, emit: async s => { authListener('X', s); await flush(); },
           submit: () => listeners.submit({ preventDefault() {} }), signOut: () => listeners.signOut(),
           forgot: () => listeners.forgot(), resetForm, setForm,
           requestReset: () => listeners.reset({ preventDefault() {} }), savePassword: () => listeners.setPassword({ preventDefault() {} }),
           flush };
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

test('no session shows sign-in; a session mounts the library once', async () => {
  const h = harness();
  await h.emit(null);
  assert.equal(h.els['sign-in'].hidden, false);
  assert.equal(h.els.library.hidden, true);
  assert.equal(h.calls.mounts, 0);
  await h.emit({ user: { email: 'ryan@example.com' } });
  assert.equal(h.els['sign-in'].hidden, true);
  assert.equal(h.els.library.hidden, false);
  assert.equal(h.els['account-email'].textContent, 'ryan@example.com');
  assert.equal(h.calls.mountedWith.root, h.els.library);
  await h.emit({ user: { email: 'ryan@example.com' } });   // token refresh
  assert.equal(h.calls.mounts, 1);
  await h.emit(null);
  assert.equal(h.calls.unmounts, 1);
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

test('mock mode loads only on this computer, never on the public site', () => {
  const live = harness({ location: { hostname: 'uselai.com', search: '?mock' } });
  assert.equal(live.appended.length, 0);
  assert.equal(live.calls.created.url, 'https://p.supabase.co');      // the real client, as normal
  const local = harness({ location: { hostname: '127.0.0.1', search: '?mock' } });
  assert.equal(local.appended[0].src, '/tests/fake-supabase.js');
  assert.equal(local.calls.created, null);
});

test('forgot password: one answer whether or not the account exists, back to /app/', async () => {
  const h = harness();
  h.forgot();
  assert.equal(h.resetForm.hidden, false);
  h.resetForm.elements.email.value = ' someone@example.com ';
  await h.requestReset();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.reset)), [{ email: 'someone@example.com', opts: { redirectTo: 'https://uselai.com/app/' } }]);
  assert.match(h.els['reset-note'].textContent, /If that email has a Ryagram account/);
  const limited = harness({ resetPassword: () => ({ error: { status: 429 } }) });
  await limited.requestReset();
  assert.match(limited.els['reset-note'].textContent, /Too many/);
});

test('a reset link: token leaves the address bar, is checked once, and a new password comes before the library', async () => {
  const h = harness({ location: { hostname: 'uselai.com', search: '?reset=abcDEF123_-xyz', hash: '#/' } });
  assert.deepEqual(h.calls.replaced, ['/app/#/']);                                  // token gone from the URL at once
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.verify)), [{ token_hash: 'abcDEF123_-xyz', type: 'recovery' }]);
  await h.emit({ user: { email: 'ryan@example.com' } });                            // signed in by the link
  assert.equal(h.els['set-password'].hidden, false);
  assert.equal(h.els.library.hidden, true);
  assert.equal(h.calls.mounts, 0);
  h.setForm.elements.password.value = 'a-long-new-password';
  h.setForm.elements.again.value = 'something-else';
  await h.savePassword();
  assert.match(h.els['set-password-error'].textContent, /don’t match/);
  assert.equal(h.calls.update.length, 0);
  h.setForm.elements.again.value = 'a-long-new-password';
  await h.savePassword();
  await h.flush();
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls.update)), [{ password: 'a-long-new-password' }]);
  assert.equal(h.els['set-password'].hidden, true);
  assert.equal(h.els.library.hidden, false);
  assert.match(h.els['app-status'].textContent, /new password is saved/);
  assert.equal(h.setForm.elements.password.value, '');

  const stale = harness({ location: { hostname: 'uselai.com', search: '?reset=expiredtoken123' }, verifyOtp: () => ({ error: { message: 'expired' } }) });
  await stale.flush();
  assert.match(stale.els['app-status'].textContent, /expired or was already used/);
  const junk = harness({ location: { hostname: 'uselai.com', search: '?reset=<script>' } });
  assert.equal(junk.calls.verify.length, 0);                                         // not a token: ignored, still removed
  assert.equal(junk.calls.replaced.length, 1);
});
