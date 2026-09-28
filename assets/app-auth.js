// Ryagram app sign-in (2A-1). The page itself is public; the data is not.
// With no session every query returns nothing, because the database only
// shows people their own rows.
(() => {
  const $ = id => document.getElementById(id);
  const status = $('app-status');
  const signIn = $('sign-in');
  const library = $('library');
  const account = $('account');
  const form = $('sign-in-form');
  const error = $('sign-in-error');
  const button = form.querySelector('button[type="submit"]');

  function say(message) {
    status.hidden = !message;
    status.textContent = message || '';
    if (message) status.focus();
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

  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  window.ryagramApp = { client };

  let unmount = null;

  function showLibrary(user) {
    signIn.hidden = true;
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
    signIn.hidden = false;
  }

  function render(session) {
    if (session?.user) showLibrary(session.user);
    else showSignIn();
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

  $('sign-out').addEventListener('click', async () => {
    await client.auth.signOut();
  });

})();
