const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'supabase', 'email-templates');
const read = f => fs.readFileSync(path.join(dir, f), 'utf8');

test('every Auth email template carries the operator line, the Ryagram name and no scripts', () => {
  for (const f of ['reset-password.html', 'invite-user.html', 'confirm-signup.html']) {
    const html = read(f);
    assert.match(html, /Ryagram is operated by L'Ai, LLC\. Questions: <a href="mailto:ryagram@uselai\.com"[^>]*>ryagram@uselai\.com<\/a>/, f);
    assert.match(html, />Ryagram</, f);
    assert.doesNotMatch(html, /<script|<img|<!--/i, f);                         // paste-ready: no comments, no scripts, no remote images
    assert.equal((html.match(/<table/g) || []).length, (html.match(/<\/table>/g) || []).length, f);
  }
});

test('the reset and invite links are exactly the ones the app checks, and the confirm email uses the standard link', () => {
  const reset = read('reset-password.html');
  const invite = read('invite-user.html');
  assert.equal((reset.match(/\{\{ \.SiteURL \}\}\/app\/\?reset=\{\{ \.TokenHash \}\}/g) || []).length, 2);    // the button and the plain fallback
  assert.equal((invite.match(/\{\{ \.SiteURL \}\}\/app\/\?invite=\{\{ \.TokenHash \}\}/g) || []).length, 2);
  assert.doesNotMatch(reset, /ConfirmationURL/);
  assert.doesNotMatch(invite, /ConfirmationURL/);
  assert.equal((read('confirm-signup.html').match(/\{\{ \.ConfirmationURL \}\}/g) || []).length, 2);
  // only variables Supabase defines
  for (const f of ['reset-password.html', 'invite-user.html', 'confirm-signup.html']) {
    for (const v of read(f).match(/\{\{[^}]*\}\}/g)) assert.match(v, /^\{\{ \.(SiteURL|TokenHash|Email|ConfirmationURL) \}\}$/, `${f}: ${v}`);
  }
});

test('the app\'s own link handling matches the templates', () => {
  const auth = fs.readFileSync(path.join(__dirname, '..', 'assets', 'app-auth.js'), 'utf8');
  assert.match(auth, /query\.has\('invite'\)/);
  assert.match(auth, /query\.has\('reset'\)/);
});
