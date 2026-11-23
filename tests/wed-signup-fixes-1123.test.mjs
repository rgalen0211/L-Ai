// Wednesday sign-up fixes (WEB 11-23): the email a stranger gets, the page's own sign-up words, and the old invite-era / beta words that must be gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const loadWaiting = () => { const win = { ryagramConfig: { waitingAccounts: true } }; vm.runInNewContext(read('assets/app-waiting.js'), { window: win, location: { origin: 'https://uselai.com' } }); return win.ryagramWaiting; };
const visibleText = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&');

test('H2 EMAIL: the Auth template that join and redeem-invite both use reads true for a stranger and for a code holder: no invite / invited / private beta / beta words in what is seen', () => {
  for (const f of ['invite-user.html', 'invite-user.txt', 'invite-user.subject.txt']) {
    let text = read(`supabase/email-templates/${f}`);
    if (f.endsWith('.html')) text = visibleText(text.split('{{ .SiteURL }}/app/#/auth?token_hash={{ .TokenHash }}&amp;type=invite').join(''));
    else text = text.replace(/\{\{ \.SiteURL \}\}\/app\/#\/auth\?token_hash=\{\{ \.TokenHash \}\}&type=invite/, '');
    assert.doesNotMatch(text, /invit|private beta|beta/i, f);
  }
  const html = read('supabase/email-templates/invite-user.html');
  assert.match(html, /<h1[^>]*>Finish making your Ryagram account<\/h1>/);
  assert.match(html, /Use the button to choose a password and open Ryagram\./);
  assert.match(read('supabase/email-templates/invite-user.txt'), /Use the link below to choose a password and open Ryagram\./);   // the plain-text copy has no button (GAMES LOW3)
  assert.doesNotMatch(read('supabase/email-templates/invite-user.txt'), /Use the button/);
  assert.match(html, />Open Ryagram<\/a>/);
  assert.equal(read('supabase/email-templates/invite-user.subject.txt').trim(), 'Finish making your Ryagram account');
  assert.doesNotMatch(read('supabase/email-templates/invite-user.txt') + html, /ConfirmationURL/);
});

test('H2 EMAIL: the link line is EXACTLY {{ .SiteURL }}/app/#/auth?token_hash={{ .TokenHash }}&type=invite (&amp; in the html, & in the text), and the README says to paste this template for both paths', () => {
  const LINK = '{{ .SiteURL }}/app/#/auth?token_hash={{ .TokenHash }}&type=invite';
  assert.ok(read('supabase/email-templates/invite-user.txt').split('\n').includes(LINK));
  const html = read('supabase/email-templates/invite-user.html');
  assert.equal(html.split(LINK.replace('&', '&amp;')).length, 3);              // the button and the printed address
  const readme = read('supabase/README.md');
  assert.match(readme, /Authentication → Emails → Invite user:\*\* paste `supabase\/email-templates\/invite-user\.html`/);
  assert.match(readme, /BOTH people who make an account/);
  assert.doesNotMatch(readme, /\?invite=\{\{ \.TokenHash \}\}">Join Ryagram/);
});

test('/ryagram/: no "yours to publish" promise and no "Ryagram waitlist" noscript line', () => {
  const h = read('ryagram/index.html');
  assert.match(h, /<h3>You get it, checked<\/h3><p>Each film is checked against its data before you get it\.<\/p>/);
  assert.doesNotMatch(h, /yours to publish|Ryagram%20waitlist|To join without JavaScript/);
  assert.match(h, /<noscript><p class="rg-note">To get news about Ryagram without JavaScript, email <a href="mailto:ryagram@uselai\.com\?subject=Ryagram%20updates">/);
});

test('M3: the page shows its own words for a 409 from join and ignores the server\'s waitlist wording (data layer, app-auth fallback)', () => {
  assert.match(read('assets/app-data.js'), /if \(status === 409\) text = 'Making an account is not open yet\. Please try again later\.';/);
  assert.match(read('assets/app-auth.js'), /r\.off\) \{ caError\.textContent = r\.message \|\| 'Making an account is not open yet\. Please try again later\.'/);
});

test('503 from join: a plain "We could not send the email just now" line is in the data layer and nothing else answers 503', () => {
  const src = read('assets/app-data.js');
  assert.match(src, /else if \(status === 503\) text = 'We could not send the email just now\. Please try again in a few minutes\.';/);
  assert.equal((src.match(/status === 503/g) || []).length, 1);
});

test('SENT line: the last sentence also says "or use Forgot your password"; the server\'s current text is rewritten, an unknown text gets the sentence added, and it is never doubled', () => {
  const W = loadWaiting();
  const SERVER = 'If that email can join, a link to finish making your account is on its way. It works once. If it has not come in a few minutes, try again later. Already have an account? Sign in instead.';
  assert.equal(W.sentWords(SERVER), SERVER.replace('Sign in instead.', 'Sign in instead, or use Forgot your password.'));
  assert.equal(W.sentWords(W.sentWords(SERVER)), W.sentWords(SERVER));
  assert.equal(W.sentWords('A link is on its way.'), 'A link is on its way. Already have an account? Sign in instead, or use Forgot your password.');
  assert.match(W.sentWords(undefined), /Sign in instead, or use Forgot your password\.$/);
  assert.match(read('assets/app-auth.js'), /caNote\.textContent = window\.ryagramWaiting\.sentWords\(r\.message\)/);
});

test('LOW: expired invite-type link, departments sign-up line and the Connect ChatGPT button carry no invite or beta words', () => {
  assert.match(read('assets/app-auth.js'), /if not, ask for a new email link\.'/);
  assert.doesNotMatch(read('assets/app-auth.js'), /ask for a new invite/);
  assert.match(read('assets/app-departments.js'), /invitedOnly: 'Sign-up for this is not open to your account yet\.'/);
  assert.doesNotMatch(read('assets/app-departments.js').match(/invitedOnly: '([^']*)'/)[1], /invit/);
  assert.match(read('assets/app-start.js'), /'Connect ChatGPT'\)/);
  assert.doesNotMatch(read('assets/app-start.js'), /Connect ChatGPT \(beta\)/);
});
