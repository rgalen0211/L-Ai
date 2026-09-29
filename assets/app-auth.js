// Ryagram app sign-in (2A-1). The page itself is public; the data is not.
// With no session every query returns nothing, because the database only
// shows people their own rows.
(() => {
  // GitHub Pages can't send frame-ancestors, and a <meta> CSP can't carry it,
  // so refuse to run inside someone else's frame (clickjacking).
  if (window.top && window.top !== window.self) {
    document.documentElement.hidden = true;
    return;
  }

  const $ = id => document.getElementById(id);
  const status = $('app-status');
  const signIn = $('sign-in');
  const library = $('library');
  const account = $('account');
  const form = $('sign-in-form');
  const error = $('sign-in-error');
  const button = form.querySelector('button[type="submit"]');
  const setPassword = $('set-password');

  // A password-reset link lands here as /app/?reset=<token hash> (the Supabase email template in
  // supabase/README.md). Take it out of the address bar at once, before anything else runs.
  const query = new URLSearchParams(location.search);
  const resetToken = /^[A-Za-z0-9_-]{10,200}$/.test(query.get('reset') || '') ? query.get('reset') : null;
  if (query.has('reset')) {
    query.delete('reset');
    history.replaceState(null, '', location.pathname + (query.toString() ? `?${query}` : '') + location.hash);
  }

  function say(message) {
    status.hidden = !message;
    status.textContent = message || '';
    if (message) status.focus();
  }

  // Mock mode (/app/?mock): fake data and a pretend worker, for testing the
  // screens without Supabase. Only on this computer, never on uselai.com.
  const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
  if (LOCAL_HOSTS.includes(location.hostname) && query.has('mock')) {
    const files = ['/tests/fake-supabase.js', '/tests/mock-worker.js', '/tests/mock-app.js'];
    (function next() {
      if (!files.length) { start(window.createMockApp()); return; }
      const script = document.createElement('script');
      script.src = files.shift();
      script.onload = next;
      script.onerror = () => say('Mock mode files are missing.');
      document.body.append(script);
    })();
    return;
  }

  const config = window.ryagramConfig || {};
  if (!config.supabaseUrl || !config.supabaseKey) {
    say('The app isn’t connected yet.');
    return;
  }
  if (!window.supabase?.createClient) {
    say('The sign-in library didn’t load. Check your connection and reload.');
    return;
  }

  start(window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  }));

  function start(client) {
    window.ryagramApp = { client };
    let unmount = null;
    let recovering = false;                        // signed in by a reset link: new password first

    function showLibrary(user) {
      signIn.hidden = true;
      setPassword.hidden = true;
      library.hidden = false;
      account.hidden = false;
      $('account-email').textContent = user.email || '';
      // Mount once per sign-in; token refreshes fire this again and must not reset the page.
      if (!unmount) unmount = window.ryagramLibrary.mount(library, window.ryagramData(client));
    }

    function showSignIn() {
      if (unmount) { unmount(); unmount = null; }
      library.hidden = true;
      account.hidden = true;
      setPassword.hidden = true;
      signIn.hidden = false;
    }

    function showSetPassword() {
      if (unmount) { unmount(); unmount = null; }
      library.hidden = true;
      signIn.hidden = true;
      account.hidden = false;
      setPassword.hidden = false;
      $('set-password-title').focus();
    }

    function render(session) {
      if (session?.user && recovering) showSetPassword();
      else if (session?.user) showLibrary(session.user);
      else showSignIn();
    }

    if (resetToken) {
      recovering = true;
      client.auth.verifyOtp({ token_hash: resetToken, type: 'recovery' }).then(async ({ error: otpError }) => {
        if (otpError) {
          recovering = false;
          const { data } = await client.auth.getSession();
          render(data.session);
          say('That reset link has expired or was already used. Ask for a new one from the sign-in page.');
        }
      });
    }

    // Fires once at start (INITIAL_SESSION) and on every sign-in, sign-out and refresh.
    client.auth.onAuthStateChange((event, session) => {
      // Supabase warns against awaiting its calls inside this callback.
      setTimeout(() => render(session), 0);
    });

    let sending = false;
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (sending || !form.reportValidity()) return;
      sending = true;
      button.disabled = true;
      button.textContent = 'Signing in…';
      error.hidden = true;
      try {
        const { error: authError } = await client.auth.signInWithPassword({
          email: form.elements.email.value.trim(),
          password: form.elements.password.value
        });
        if (authError) {
          error.textContent = authError.code === 'invalid_credentials' || authError.status === 400
            ? 'That email and password don’t match an account.'
            : authError.status === 0 || authError.name === 'AuthRetryableFetchError'
              ? 'Couldn’t reach the server. Check your connection and try again.'
              : 'Sign-in failed. Try again in a moment.';
          error.hidden = false;
        } else {
          form.elements.password.value = '';
        }
      } catch {
        error.textContent = 'Couldn’t reach the server. Check your connection and try again.';
        error.hidden = false;
      } finally {
        sending = false;
        button.disabled = false;
        button.textContent = 'Sign in';
      }
    });

    // Forgot your password: the same answer whether or not the email has an account.
    const forgot = $('forgot');
    const resetForm = $('reset-form');
    const resetNote = $('reset-note');
    forgot.addEventListener('click', () => {
      resetForm.hidden = !resetForm.hidden;
      forgot.setAttribute('aria-expanded', String(!resetForm.hidden));
      if (!resetForm.hidden) {
        resetForm.elements.email.value = form.elements.email.value;
        resetForm.elements.email.focus();
      }
    });
    resetForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!resetForm.reportValidity()) return;
      const send = resetForm.querySelector('button');
      send.disabled = true;
      try {
        const { error: resetError } = await client.auth.resetPasswordForEmail(resetForm.elements.email.value.trim(),
                                                                              { redirectTo: `${location.origin}/app/` });
        resetNote.textContent = resetError?.status === 429
          ? 'Too many reset requests. Wait a few minutes and try again.'
          : 'If that email has a Ryagram account, a reset link is on its way. It works once, for an hour. Check spam too.';
      } catch {
        resetNote.textContent = 'Couldn’t reach the server. Check your connection and try again.';
      } finally {
        send.disabled = false;
      }
    });

    const setForm = $('set-password-form');
    const setError = $('set-password-error');
    setForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!setForm.reportValidity()) return;
      setError.hidden = true;
      const { password, again } = setForm.elements;
      if (password.value !== again.value) {
        setError.textContent = 'The two passwords don’t match.';
        setError.hidden = false;
        return;
      }
      const save = setForm.querySelector('button');
      save.disabled = true;
      try {
        const { error: updateError } = await client.auth.updateUser({ password: password.value });
        if (updateError) {
          setError.textContent = updateError.message || 'Couldn’t save the new password. Try again.';
          setError.hidden = false;
          return;
        }
        password.value = again.value = '';
        recovering = false;
        const { data } = await client.auth.getSession();
        render(data.session);
        say('Your new password is saved.');
      } catch {
        setError.textContent = 'Couldn’t reach the server. Check your connection and try again.';
        setError.hidden = false;
      } finally {
        save.disabled = false;
      }
    });

    $('sign-out').addEventListener('click', async () => {
      await client.auth.signOut();
    });
  }
})();
