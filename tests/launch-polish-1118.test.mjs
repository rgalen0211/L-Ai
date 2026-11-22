// Launch polish found by the live walk of the public pages (WEB 11-18, with GAMES' tap-size finding): the report form preselects nothing, the hero 'Watch the full film' link is a 44 px target,
// and the sign-in page puts "Have an invite code?" with the other two links UNDER the card, not above it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('the report form preselects no problem: a person who skims is asked to choose, and the page says so kindly', () => {
  const html = read('report/index.html');
  assert.equal((html.match(/<input type="radio" name="reason"/g) || []).length, 5);
  assert.doesNotMatch(html, /name="reason"[^>]*\bchecked\b/);
  assert.match(read('assets/report.js'), /Choose what the problem is\./);
});

test('the hero caption link on /ryagram/ is a 44 px tap target (padding, so the sentence keeps its line height)', () => {
  assert.match(read('assets/ryagram.css'), /\.rg-hero-film figcaption a\{font-weight:700;padding:13px 2px\}/);
  assert.match(read('ryagram/index.html'), /ryagram\.css\?v=20261118a/);
});

test('sign-in page order: the card, then Forgot your password, then Have an invite code (and its form), then the help lines', () => {
  const html = read('app/index.html');
  const at = id => { const i = html.indexOf(`id="${id}"`); assert.ok(i > 0, id); return i; };
  assert.ok(at('sign-in-form') < at('forgot-row') && at('forgot-row') < at('invite-row') && at('invite-row') < at('invite-form') && at('invite-form') < html.indexOf('class="form-note sign-in-help"'));
});

// Q649 (Ryan 11-18 21:2x: 1 yes, 2 yes, 3 coming soon, 4 keep both and say why, 5 yes): the words, found by GAMES' live /help/ and /ryagram/ walk.
test('Q649 1: the private-beta box says creators can ASK FOR AN INVITE (the application form is off, so "apply now" was not true)', () => {
  const html = read('ryagram/index.html');
  assert.match(html, /<p class="rg-release">Ryagram is in private beta\. Creators can <a href="#creators">ask for an invite<\/a>; everyone else can <a href="#waitlist">join the waitlist<\/a>\./);
  assert.doesNotMatch(html, /Creators can <a href="#creators">apply now/);
});

test('Q649 2: "I cannot sign in" ends at the address below, not a form that is not there', () => {
  const html = read('help/index.html');
  assert.match(html, /check your spam folder, then write to us at the address below\./);
  assert.doesNotMatch(html, /from the form below/);
});

test('Q649 3: the uploads question says "Coming soon" while the upload switch is off, and reads as a plain fact once it is on', () => {
  const help = read('help/index.html');
  const on = /uploads:\s*true/.test(read('assets/ryagram-config.js'));
  if (on) assert.match(help, /<summary>My own data \(spreadsheet\) won't read\.<\/summary>\s*<p>Ryagram reads spreadsheets \(CSV and similar files\)\. /);
  else assert.match(help, /<summary>My own data \(spreadsheet\) won't read\.<\/summary>\s*<p>Coming soon: when uploading your own data opens, /);
  assert.ok(on !== /My own data \(spreadsheet\) won't read\.<\/summary>\s*<p>Coming soon/.test(help), 'the Coming soon words are there exactly while uploads is off');
});

test('Q649 4: 2 working days for questions and 7 days for reports stay, and the report page says why a report takes longer', () => {
  assert.match(read('help/index.html'), /reply within 2 working days/);
  const rep = read('report/index.html');
  assert.match(rep, /We reply to the email you give within 7 days: a report needs a review before we can answer it, so it takes longer than a question\./);
  assert.match(rep, /We reply to your email within 7 days\./);
});

test('Q649 5: the first card under "Films made with Ryagram" is not the film the hero already shows', () => {
  const html = read('ryagram/index.html');
  const hero = html.match(/<figure class="rg-hero-film">[\s\S]*?<\/figure>/)[0];
  const cards = [...html.matchAll(/<article class="rg-film">([\s\S]*?)<\/article>/g)].map(m => m[1]);
  assert.equal(cards.length, 4);
  assert.match(hero, /UC4j77KYVQ8/);
  assert.doesNotMatch(cards[0], /UC4j77KYVQ8|Interstate/);
  assert.match(cards[3], /Interstate/, 'the Interstate card stays on the page, further down');
});

// GAMES 21:29 (MEDIUM + LOW): the report error line must read in the dark theme, and an empty send must take the keyboard to what needs fixing.
test('GAMES MEDIUM: the report error colour comes from the look\'s problem token (a light-theme red was 2.1:1 on the dark card)', () => {
  assert.match(read('assets/help.css'), /\.report-error\{color:var\(--problem,#8a2f25\);margin:0\}/);
  assert.match(read('assets/ryagram-look.css'), /--problem:#ffb4a8;/, 'the dark token is a light pink');
});

test('GAMES LOW: a send with no choice moves focus to the first reason, and the choices are tied to the error line', () => {
  const js = read('assets/report.js');
  assert.match(js, /querySelector\('input\[name="reason"\]'\)\.focus\(\)/);
  assert.match(read('report/index.html'), /<fieldset aria-describedby="r-error">/);
});

// Live walk 11-18 rough spot 4: the phone footer wrapped into uneven rows.
test('the phone footer is a tidy two-by-two under its source line', () => {
  assert.match(read('assets/help.css'), /@media\(max-width:560px\)\{body\.ryagram-look \.footer-row\{display:grid;grid-template-columns:1fr 1fr;/);
});

// Live walk 11-18 rough spot 5: on the desktop home page 10 text links (nav, footer, contact line) were 16-23 px tall, under the 24 px minimum.
test('home page desktop: nav and footer links are at least 24 px tall (a rule for 721 px and wider)', () => {
  assert.match(read('index.html'), /@media\(min-width:721px\)\{nav a,\.footer-row a\{display:inline-block;padding:3px 6px;min-height:28px;box-sizing:border-box\}\}/);
});
