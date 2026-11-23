// OPEN SIGN-UP words (WEB 11-22; Ryan 11-21 11:30; LAUNCH-WED-1125 row 1; proposals/WEB-SIGNUP-OPEN-1122.md). Every line that said invite-only, private beta, join the waitlist, "joins the list",
// "only puts you on the list", "we will tell you when it opens" or "ask Ryan" now says something true when sign-up is OPEN, 18+, and a new account is ACTIVE at once (server: join_open ON, waiting_accounts OFF).
// Each check below FAILS on the old wording. The brake pages (assets/app-waiting.js: "You are on the list") are deliberately unchanged: they show only when the server brake (waiting_accounts ON) is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const noComments = s => s.replace(/<!--[\s\S]*?-->/g, '');
const OLD = /invite-only|private beta|join the waitlist|only puts you on the list|joins the list|when your access opens|tell you when it opens|opening by invitation|ask Ryan|Ask for a new invite|accept your invite|Already invited|ask for an invite|the waitlist is open|hold your place/i;

test('pages: no old invite-only / waitlist / list / private-beta wording is left in the served pages', () => {
  for (const f of ['app/index.html', 'ryagram/index.html', 'help/index.html', 'index.html', 'terms/index.html', 'report/index.html', 'film/index.html']) {
    const s = noComments(read(f)).replace(/<script[\s\S]*?<\/script>/g, '');
    assert.doesNotMatch(s, OLD, f);
  }
});

test('sign-in page: says "Sign in to your Ryagram account." (not invite-only), has no waitlist line, and still offers Create an account (shown by the switch) and help', () => {
  const html = read('app/index.html');
  const panel = html.slice(html.indexOf('id="sign-in"'), html.indexOf('id="create-account"'));
  assert.match(panel, /<p class="form-intro">Sign in to your Ryagram account\.<\/p>/);
  assert.doesNotMatch(panel, /waitlist|invite-only|No invite yet/i);
  assert.match(panel, /<p id="create-row" class="form-note" hidden>First time here\? <a href="#\/create-account" id="create-link">Create an account<\/a><\/p>/);
  assert.match(panel, /Trouble signing in\? <a href="\/help\/">Get help<\/a>/);
  assert.doesNotMatch(read('assets/app-auth.js'), /if \(old && \/waitlist\/i/, 'the script no longer hides a waitlist line (there is none)');
});

test('create-an-account page: a free account, 18 and older, Terms and Privacy linked; the 18+ box still sent as adult_confirmed; no list, no wait', () => {
  const panel = read('app/index.html').match(/<section id="create-account"[\s\S]*?<\/section>/)[0];
  assert.match(panel, /<p class="form-intro">Make a free account to try Ryagram\.<\/p>/);
  assert.match(panel, /<p class="form-note" role="note">Ryagram is for people 18 and older\. Read the <a href="\/terms\/">Terms of Use<\/a> and the <a href="\/privacy-policy\.html">Privacy Policy<\/a>\.<\/p>/);
  assert.match(panel, /<input id="ca-age" name="over18" type="checkbox"[^>]*aria-required="true"><span>I am 18 or older\.<\/span>/);
  assert.doesNotMatch(panel, /waitlist|invite|in testing|drafts|joins the list|access opens|puts you on the list/i);
  assert.match(read('assets/app-data.js'), /functions\.invoke\('join', \{ body: \{ email: String\(email \|\| ''\)\.trim\(\), adult_confirmed: true \} \}\)/);
});

test('the Create an account switch: the config line is true and the sign-in page shows the row only through waitingOn', () => {
  assert.match(read('assets/ryagram-config.js'), /\n  waitingAccounts: true,\n/);
  assert.match(read('assets/app-auth.js'), /if \(\$\('create-row'\) && waitingOn\(\) && window\.ryagramWaiting\) \{\s*\n\s*\$\('create-row'\)\.hidden = false;/);
});

test('the emailed sign-up link page says confirm your email, not accept your invite; a server "not open yet" falls back to plain words with no waitlist', () => {
  const src = read('assets/app-auth.js');
  assert.match(src, /invite: \['Welcome to Ryagram', 'Press the button to confirm your email and choose a password\.', 'Continue'\],/);
  assert.match(src, /r\.message \|\| 'Making an account is not open yet\. Please try again later\.'/);
  assert.doesNotMatch(src, /accept your invite|Accept the invite|Join the waitlist instead/);
});

test('expired-link page: "Never set a password? Ask for a new link" (not "Invited ... ask for a new invite")', () => {
  assert.match(read('app/index.html'), /Never set a password\? <a href="mailto:ryagram@uselai\.com\?subject=Please%20send%20me%20a%20new%20link">Ask for a new link<\/a>\./);
});

test('/ryagram/: hero and header buttons go to Create an account; release line, creator-box line, sign-up section and create line are true when sign-up is open', () => {
  const h = noComments(read('ryagram/index.html'));
  assert.match(h, /<meta name="description" content="[^"]*Create a free account to try it\.">/);
  assert.match(h, /<a class="rg-btn rg-btn-small" href="\/app\/#\/create-account">Create an account<\/a>/);
  assert.match(h, /<div class="rg-hero-cta"><a class="rg-btn" href="\/app\/#\/create-account">Create an account<\/a> <a class="rg-hero-signin" href="\/app\/">Sign in<\/a><\/div>/);
  assert.match(h, /<p class="rg-release">Anyone 18 or older can <a href="\/app\/#\/create-account">create a free account<\/a>\. Already have one\? <a href="\/app\/">Sign in<\/a>\.<\/p>/);
  assert.match(h, /Not a creator\? <a href="\/app\/#\/create-account">Create an account<\/a> instead\./);
  assert.match(h, /<p class="rg-sub">Ryagram is open to anyone 18 or older: create a free account and try it\. Not ready yet\? Leave your email and we will keep you posted about Ryagram\.<\/p>/);
  assert.match(h, /<button class="rg-btn" type="submit">Keep me posted<\/button>/);
  assert.match(h, /Skip to the sign-up/);
  assert.match(h, /Or start now: <a href="\/app\/#\/create-account">Create an account<\/a>\. We email you a link to confirm your address and choose a password, and then you can start\./);
});

test('/ryagram/ script: the list-form answers say "keep you posted", never "on the list"', () => {
  const src = read('assets/ryagram.js');
  assert.match(src, /say\('Thanks\. We.ll keep you posted about Ryagram\.'\)/);
  assert.match(src, /Sign-up for updates isn.t connected yet/);
  assert.doesNotMatch(src, /You.re on the list|something to try|waitlist isn.t connected|'Join the waitlist'|'Joining…'/);
});

test('film pages: the line beside "Make your own data film" says anyone 18 or older can make a free account', () => {
  const src = read('assets/film.js');
  assert.match(src, /'Anyone 18 or older can make a free Ryagram account\. Already have one\? ', h\('a', \{ href: '\/app\/' \}, 'Sign in'\), '\.'/);
  assert.doesNotMatch(src, /opening by invitation|Join the waitlist and we will tell you/);
});

test('Home teaser, Terms placeholder, Help (connect an AI) and the request page: no invitation, list or "ask Ryan" claims', () => {
  assert.match(read('index.html'), /<p>Short animated films drawn straight from the numbers, with correctness checks built in\. Anyone 18 or older can make a free account and try it\.<\/p>/);
  assert.match(read('terms/index.html'), /Sign-up is open to anyone who is 18 or older\. We email you a link to finish signing up\./);
  const m = /<summary>How do I connect Claude or ChatGPT to Ryagram\?<\/summary>\s*<p>([^<]*)<\/p>/.exec(read('help/index.html'));
  assert.match(m[1], /^You can connect an AI assistant such as Claude or ChatGPT to your account\. If you do not see Connected AIs under Account, it is not available on your account; write to ryagram@uselai\.com\./);
  assert.match(read('assets/app-library.js'), /We make the film and send it back here\. Each one is made by hand, so it can take a day or more\./);
  assert.doesNotMatch(read('assets/app-library.js'), /This is a private beta, so each one is made by hand/);
  assert.match(read('assets/app-tester-wizard.js'), /If you were invited, write to ryagram@uselai\.com and we will turn it on for your account\./);
  assert.doesNotMatch(read('assets/app-tester-wizard.js'), /ask Ryan/i);
});

test('the Home page copy did not grow (the phone margin is 0.01): the teaser paragraph is not longer than before', () => {
  const now = read('index.html').match(/<div class="eyebrow">New from L'Ai<\/div>[\s\S]*?<p>([^<]*)<\/p>/)[1];
  assert.ok(now.length <= 'Short animated films drawn straight from the numbers, with correctness checks built in. The first films are on the way, and the waitlist is open.'.length, `${now.length} characters`);
});

test('the brake (waiting_accounts ON) pages are deliberately the same: "You are on the list" shows only to a WAITING account; an ACTIVE new account gets the normal pages', () => {
  const win = { ryagramConfig: { waitingAccounts: true } };
  vm.runInNewContext(read('assets/app-waiting.js'), { window: win, location: { origin: 'https://uselai.com' } });
  assert.equal(win.ryagramWaiting.WORDS.title, 'You are on the list');
  assert.equal(win.ryagramWaiting.pageFor('active', '#/'), 'normal');
  assert.equal(win.ryagramWaiting.pageFor('waiting', '#/'), 'waiting');
});
