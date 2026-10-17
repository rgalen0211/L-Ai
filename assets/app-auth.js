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

  // Auth emails link through OUR domain (deliverability: the sender is uselai.com, so the link must be too):
  //   https://uselai.com/app/#/auth?token_hash=<hash>&type=<signup|invite|magiclink|recovery|email_change|email>      (#/auth/confirm?... is the same)
  // The token sits in the address FRAGMENT, which browsers never send to any server, and the page takes it out of the address bar at once. It is NOT
  // checked when the page opens: the person presses a button, and only then does verifyOtp run. An email scanner that opens the link (even one that runs
  // scripts) therefore cannot spend it. Links already sent as /app/?reset=<hash> and /app/?invite=<hash> work the same way.
  // Other ways to arrive: #/auth/expired (the root site forwards any #error=... there), a raw #error=/#error_code= (a link Supabase itself rejected), and
  // a raw #access_token=...&refresh_token=... (a link Supabase already verified). That one would SIGN THE PERSON IN from the address bar, so a crafted link
  // could put someone into another account: it waits behind the same button, which says 'Continue as <email>'. Templates: supabase/email-templates/.
  const query = new URLSearchParams(location.search);
  const TOKEN = /^[A-Za-z0-9_-]{10,200}$/;
  const JWT = /^[A-Za-z0-9_-]{10,2000}\.[A-Za-z0-9_-]{10,2000}\.[A-Za-z0-9_-]{0,2000}$/;       // an access token is a JWT: three dot-separated parts
  const AUTH_TYPES = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'];
  let linkType = query.has('invite') ? 'invite' : query.has('reset') ? 'recovery' : null;
  let linkToken = linkType && TOKEN.test(query.get(linkType === 'invite' ? 'invite' : 'reset') || '')
    ? query.get(linkType === 'invite' ? 'invite' : 'reset') : null;
  const authHash = /^#\/auth(?:\/(confirm|expired))?(?:\?(.*))?$/.exec(location.hash || '');
  const rawHash = authHash ? null : new URLSearchParams((location.hash || '').replace(/^#\/?/, ''));
  let expiredMode = false;
  let implicitSession = null;
  let implicitEmail = '';
  if (authHash && authHash[1] === 'expired') {
    expiredMode = true;
  } else if (authHash) {
    const p = new URLSearchParams(authHash[2] || '');
    const type = p.get('type');
    linkType = AUTH_TYPES.includes(type) ? type : null;
    linkToken = linkType && TOKEN.test(p.get('token_hash') || '') ? p.get('token_hash') : null;
    if (!linkToken) expiredMode = true;                                    // a link with a damaged token is as good as an expired one
  } else if (rawHash && (rawHash.has('error') || rawHash.has('error_code'))) {
    expiredMode = true;
  } else if (rawHash && rawHash.has('access_token')) {
    const okShape = JWT.test(rawHash.get('access_token') || '') && TOKEN.test(rawHash.get('refresh_token') || '');
    if (okShape) implicitSession = { access_token: rawHash.get('access_token'), refresh_token: rawHash.get('refresh_token') };
    linkType = AUTH_TYPES.includes(rawHash.get('type')) ? rawHash.get('type') : 'magiclink';
    // Whose account this would sign into, read from the token for DISPLAY only (Supabase checks the signature when the button is pressed).
    try {
      if (!okShape) throw new Error('not a token');
      const claims = JSON.parse(decodeURIComponent(escape(atob(rawHash.get('access_token').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))));
      implicitEmail = typeof claims.email === 'string' && claims.email.length <= 320 ? claims.email : '';
    } catch { implicitEmail = ''; }
    if (!implicitEmail) { implicitSession = null; expiredMode = true; }          // a token we cannot name is never taken
  }
  const hasAuthHash = !!(authHash || expiredMode || implicitSession);
  let pendingLink = !!linkToken || !!implicitSession;                                            // waiting for the person to press the button
  if (query.has('reset') || query.has('invite') || hasAuthHash) {
    query.delete('reset');
    query.delete('invite');
    history.replaceState(null, '', location.pathname + (query.toString() ? `?${query}` : '') + (hasAuthHash ? '#/' : location.hash));
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
      script.src = `${files.shift()}?t=${Date.now()}`;           // mock files change often: never serve a cached copy
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
    const authLink = $('auth-link');
    const authExpired = $('auth-expired');
    const LINK_WORDS = {
      recovery: ['Reset your password', 'Press the button to choose a new password for your Ryagram account.', 'Choose a new password'],
      invite: ['Welcome to Ryagram', 'Press the button to accept your invite and choose a password.', 'Accept the invite'],
      signup: ['Confirm your email', 'Press the button to confirm your email address.', 'Confirm my email'],
      magiclink: ['Sign in to Ryagram', 'Press the button to sign in.', 'Sign in'],
      email_change: ['Confirm your new email', 'Press the button to confirm your new email address.', 'Confirm the new address'],
      email: ['Continue to Ryagram', 'Press the button to continue.', 'Continue']
    };
    function hideLinkPanels() { if (authLink) authLink.hidden = true; if (authExpired) authExpired.hidden = true; }
    function showAuthLink() {
      if (unmount) { unmount(); unmount = null; }
      library.hidden = true; signIn.hidden = true; setPassword.hidden = true; account.hidden = true; authExpired.hidden = true;
      let [title, text, go] = LINK_WORDS[linkType] || LINK_WORDS.email;
      if (implicitSession) {                                                      // this link would sign the person in: say as whom, and let them refuse
        title = 'Sign in to Ryagram';
        text = `This link will sign you in as ${implicitEmail}. If that is not your account, close this page.`;
        go = `Continue as ${implicitEmail}`;
      }
      $('auth-link-title').textContent = title;
      $('auth-link-text').textContent = text;
      $('auth-link-go').textContent = go;
      authLink.hidden = false;
    }
    function showAuthExpired() {
      if (unmount) { unmount(); unmount = null; }
      library.hidden = true; signIn.hidden = true; setPassword.hidden = true; account.hidden = true; authLink.hidden = true;
      authExpired.hidden = false;
      $('auth-expired-title').focus();
    }

    function showLibrary(user) {
      signIn.hidden = true;
      setPassword.hidden = true;
      hideLinkPanels();
      library.hidden = false;
      account.hidden = false;
      $('account-email').textContent = user.email || '';
      // Mount once per sign-in; token refreshes fire this again and must not reset the page.
      if (!unmount) unmount = window.ryagramLibrary.mount(library, window.ryagramData(client));
    }

    function showSignIn() {
      if (unmount) { unmount(); unmount = null; }
      hideLinkPanels();
      library.hidden = true;
      account.hidden = true;
      setPassword.hidden = true;
      signIn.hidden = false;
    }

    function showSetPassword() {
      if (unmount) { unmount(); unmount = null; }
      hideLinkPanels();
      library.hidden = true;
      signIn.hidden = true;
      account.hidden = false;
      setPassword.hidden = false;
      $('set-password-title').focus();
    }

    function render(session) {
      if (pendingLink) showAuthLink();
      else if (expiredMode) showAuthExpired();
      else if (session?.user && recovering) showSetPassword();
      else if (session?.user) showLibrary(session.user);
      else showSignIn();
    }

    if (linkToken || implicitSession) {
      const FAILED = {
        invite: 'That invite link has expired or was already used. If you set a password, sign in; if not, ask for a new invite.',
        recovery: 'That reset link has expired or was already used. Ask for a new one below.',
        signup: 'That confirmation link has expired or was already used. Try signing in; if that fails, ask for a new one.',
        magiclink: 'That sign-in link has expired or was already used. Ask for a new one from the sign-in page.',
        email: 'That link has expired or was already used. Ask for a new one from the sign-in page.',
        email_change: 'That link has expired or was already used. Start the email change again from your Account page.'
      };
      const DONE = { signup: 'Your email is confirmed. Welcome to Ryagram.', email_change: 'Your email address is updated.' };
      const go = $('auth-link-go');
      let verifying = false;
      go.addEventListener('click', async () => {
        if (verifying) return;
        verifying = true;
        go.disabled = true;
        let otpError = null;
        try {
          ({ error: otpError } = implicitSession
            ? await client.auth.setSession(implicitSession)
            : await client.auth.verifyOtp({ token_hash: linkToken, type: linkType }));
        } catch { otpError = { message: 'network' }; }
        pendingLink = false;
        if (otpError) {
          recovering = false;
          expiredMode = true;
          const { data } = await client.auth.getSession();
          render(data.session);
          say(FAILED[linkType]);
        } else {
          recovering = linkType === 'invite' || linkType === 'recovery';       // these two choose a password before the library
          if (linkType === 'invite') $('set-password-title').textContent = 'Welcome to Ryagram. Choose your password';
          const { data } = await client.auth.getSession();
          render(data.session);
          if (DONE[linkType]) say(DONE[linkType]);
        }
        go.disabled = false;
        verifying = false;
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

    // Forgot your password: the same answer whether or not the email has an account. Shown once
    // the reset email is set up (passwordReset: true), or in mock mode.
    if ($('forgot-row')) $('forgot-row').hidden = !(window.ryagramConfig?.passwordReset === true || window.ryagramMock);
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

    // The expired-link screen: ask for a new link (the same answer whether or not the email has an account), or go back to sign in.
    const expiredForm = $('auth-expired-form');
    if (expiredForm) {
      const expiredNote = $('auth-expired-note');
      expiredForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (!expiredForm.reportValidity()) return;
        const send = expiredForm.querySelector('button');
        send.disabled = true;
        try {
          const { error: resendError } = await client.auth.resetPasswordForEmail(expiredForm.elements.email.value.trim(), { redirectTo: `${location.origin}/app/` });
          expiredNote.textContent = resendError?.status === 429
            ? 'Too many requests. Wait a few minutes and try again.'
            : 'If that email has a Ryagram account, a new link is on its way. It works once, for an hour. Check spam too.';
        } catch {
          expiredNote.textContent = 'Couldn’t reach the server. Check your connection and try again.';
        } finally {
          send.disabled = false;
        }
      });
      $('auth-expired-back').addEventListener('click', async () => {
        expiredMode = false;
        const { data } = await client.auth.getSession();
        render(data.session);
      });
    }

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
        say(linkType === 'invite' ? 'Welcome. Your password is saved.' : 'Your new password is saved.');
      } catch {
        setError.textContent = 'Couldn’t reach the server. Check your connection and try again.';
        setError.hidden = false;
      } finally {
        save.disabled = false;
      }
    });

    // Beta invite codes: shown once the invite email is set up (inviteSignup: true), or in mock mode.
    // The same answer whether or not the email already has an account.
    if ($('invite-row')) {
      $('invite-row').hidden = !(window.ryagramConfig?.inviteSignup === true || window.ryagramMock);
      const haveInvite = $('have-invite');
      const inviteForm = $('invite-form');
      const inviteNote = $('invite-note');
      haveInvite.addEventListener('click', () => {
        inviteForm.hidden = !inviteForm.hidden;
        haveInvite.setAttribute('aria-expanded', String(!inviteForm.hidden));
        if (!inviteForm.hidden) inviteForm.elements.code.focus();
      });
      inviteForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (!inviteForm.reportValidity()) return;
        const join = inviteForm.querySelector('button');
        join.disabled = true;
        inviteNote.textContent = '';
        try {
          const { data, error: fnError } = await client.functions.invoke('redeem-invite', {
            body: { code: inviteForm.elements.code.value, email: inviteForm.elements.email.value.trim() }
          });
          if (fnError) {
            let text = 'Couldn\u2019t check the code just now. Try again in a minute.';
            try { text = (await fnError.context.json()).error || text; } catch { /* keep the plain message */ }
            inviteNote.textContent = text;
          } else {
            inviteNote.textContent = data?.message || 'Check your email.';
            inviteForm.elements.code.value = '';
          }
        } catch {
          inviteNote.textContent = 'Couldn\u2019t reach the server. Check your connection and try again.';
        } finally {
          join.disabled = false;
        }
      });
    }

    $('sign-out').addEventListener('click', async () => {
      await client.auth.signOut();
    });
  }
})();
