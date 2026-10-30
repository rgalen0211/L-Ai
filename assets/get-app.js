// The page behind the app link in an invite email (NEXT-CONNECT 162). OFF until the app-link function is deployed with APP_LINK_ON=1; before that every press answers "Not found" and nothing is downloaded.
// The email's link is https://uselai.com/get-app/#t=<token>: the token is in the FRAGMENT, which a browser never sends to any server or log. This script reads it, removes it from the address bar, asks the
// function whether the link is good (peek: changes nothing, so a mail program that merely opens this page cannot use the link up), and only when the person PRESSES THE BUTTON turns it into a 15-minute download.
(function () {
  'use strict';
  var FUNCTION_URL = 'https://jxtkfishqfxuptwjzczz.supabase.co/functions/v1/app-link';
  var TOKEN = /^#t=([0-9a-f]{64})$/;
  var R2_HOST = /^[a-z0-9]+\.r2\.cloudflarestorage\.com$/;

  function tokenFrom(hash) { var m = TOKEN.exec(String(hash || '')); return m ? m[1] : null; }
  function sizeWords(bytes) { var n = Number(bytes); return n > 0 ? (n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : Math.round(n / 1e6) + ' MB') : ''; }
  /** Only a signed address on the private bucket's host is ever followed. */
  function safeDownloadUrl(u) { try { var p = new URL(u); return p.protocol === 'https:' && R2_HOST.test(p.hostname) && !p.username && !p.port ? p.href : null; } catch (e) { return null; } }
  window.ryagramGetApp = Object.freeze({ tokenFrom: tokenFrom, sizeWords: sizeWords, safeDownloadUrl: safeDownloadUrl, functionUrl: FUNCTION_URL });

  if (typeof document === 'undefined' || !document.getElementById('ga-msg')) return;
  var msg = document.getElementById('ga-msg'), detail = document.getElementById('ga-detail'), go = document.getElementById('ga-go'), after = document.getElementById('ga-after');
  var token = tokenFrom(location.hash);
  try { history.replaceState(null, '', location.pathname); } catch (e) { /* the address bar keeps it: harmless, the fragment is never sent */ }

  function post(action) {
    return fetch(FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: token, action: action }), credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; }); });
  }
  function say(text) { msg.textContent = text; }

  if (!token) { say('This link is not complete. Open it again from your invite email, or sign in at uselai.com and use the Download card.'); return; }
  say('Checking your link…');
  post('peek').then(function (r) {
    if (r.status === 200 && r.body && r.body.ok) {
      say('Your link is good.');
      detail.textContent = 'This downloads ' + String(r.body.file_name || 'the Ryagram app') + (sizeWords(r.body.size_bytes) ? ' (' + sizeWords(r.body.size_bytes) + ')' : '') + ', the Ryagram app for Windows. The link works once.';
      detail.hidden = false; go.hidden = false;
    } else {
      say(String((r.body && r.body.error) || 'That link could not be used just now. Try again in a minute, or sign in at uselai.com and use the Download card.').slice(0, 300));
    }
  }, function () { say('Could not reach Ryagram just now. Check your internet connection and open the link again.'); });

  go.addEventListener('click', function () {
    go.disabled = true; say('Making your download link…');
    post('redeem').then(function (r) {
      var url = r.status === 200 && r.body ? safeDownloadUrl(r.body.url) : null;
      if (!url) { go.hidden = true; say(String((r.body && r.body.error) || 'That link could not be used just now. Sign in at uselai.com and use the Download card.').slice(0, 300)); return; }
      say('Your download is starting. If it does not start, press the button below.');
      go.hidden = true;
      var a = document.createElement('a'); a.href = url; a.textContent = 'Download ' + String(r.body.file_name || 'the app'); a.className = 'button'; a.rel = 'noopener noreferrer';
      after.replaceChildren(a);
      var p = document.createElement('p'); p.className = 'note';
      p.textContent = 'When it has finished, unzip it to a folder on your computer and open "Open Ryagram". The first line it prints should say that all files are as they were when the folder was built.' + (r.body.sha256 ? ' The file’s SHA-256 is ' + String(r.body.sha256) + '.' : '');
      after.appendChild(p); after.hidden = false;
      location.assign(url);
    }, function () { go.disabled = false; say('Could not reach Ryagram just now. Press the button again.'); });
  });
})();
