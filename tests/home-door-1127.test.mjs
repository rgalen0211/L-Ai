// The new uselai.com front door (WEB 11-27, FACES' design notes): one line, one film, one button; the number on the button and in the welcome line comes from assets/free-account-line.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html');
test('DOOR: the Start free buttons carry the number from the one source, not a typed one', () => {
  assert.equal((html.match(/Start free, <span data-welcome-credits>16<\/span> credits/g) || []).length, 2);
  assert.equal((html.match(/<a class="rg-btn" href="\/app\/#\/create-account"><span>Start free, <span data-welcome-credits>16<\/span> credits<\/span><\/a>/g) || []).length, 2, 'the label sits in one span: inside a flex button the spaces around the number would be dropped');
  assert.match(read('assets/free-account-line.js'), /\[data-welcome-credits\]/);
  assert.match(html, /<p id="wl-free" class="rg-note" data-free-account-line>/);
});
test('DOOR: no consulting words, no creator beta, no email list, no L\'Ai in the title; the footer names the operator', () => {
  assert.doesNotMatch(html, /MindWise|workflow|consult|CRM Room|Creator beta|waitlist|Keep me posted/i);
  assert.match(html.match(/<title>([^<]*)<\/title>/)[1], /^Ryagram/);
  assert.ok(!/L'Ai/.test(html.match(/<title>([^<]*)<\/title>/)[1]));
  assert.match(html, /Ryagram is operated by L'Ai, LLC\./);
  assert.match(html, /<script src="\/assets\/auth-forward\.js"><\/script>/);
});
test('DOOR: the old consulting pages are stubs that go to / and keep nothing of the old page', () => {
  for (const f of ['workflow-audit/index.html', 'workflow-audit-thanks.html', 'thank-you.html']) {
    const s = read(f);
    assert.match(s, /http-equiv="refresh" content="0; url=\/"/); assert.match(s, /rel="canonical" href="\/"/); assert.match(s, /noindex/); assert.ok(s.length < 1200, f);
    assert.ok(fs.existsSync(new URL(`../_archive/consulting/${f}`, import.meta.url)), `${f} is kept in the archive`);
  }
  assert.ok(fs.existsSync(new URL('../_archive/consulting/index.html', import.meta.url)));
});
test('DOOR: relative links only, so a later move to a Ryagram domain needs no edit here: the only domain on the page is the contact address in the footer', () => {
  // GEO 11-27: the ONE other exception is the share preview's og:image, which link previews need as a full address
  // (listed in proposals/DOMAIN-MOVE-PLAN-1127.md, step 7); it is a head tag, never a link or a visible word.
  const shareImage = '<meta property="og:image" content="https://uselai.com/assets/ryagram-hero-still.jpg">';
  assert.equal(html.split(shareImage).length - 1, 1, 'exactly one og:image tag');
  assert.doesNotMatch(html.replace(/ryagram@uselai\.com/g, '').replace(shareImage, ''), /uselai\.com/);
  assert.match(html, /<link rel="canonical" href="\/">/);
});
test('DOOR: the Bring your own AI line is CONNECT\'s wording and stays hidden until Ryan confirms Connect an AI is ON for every new account (live step 35)', () => {
  assert.match(html, /<p class="rg-byoai" hidden>Bring your own AI: connect Claude or ChatGPT to your account \(Account, then Connected AIs\) and ask it to build a film\.<\/p>/);
});
test('DOOR: the hero is ONE swappable still (FACES pick: the shaded 2017 frame); the Interstate loop moved to the films row', () => {
  assert.match(html, /<img class="rg-hero-still" src="\/assets\/ryagram-hero-still\.jpg" width="1280" height="720" alt="A map of US states hatched by adult obesity, with dots for new restaurants\.">/);
  assert.ok(fs.statSync(new URL('../assets/ryagram-hero-still.jpg', import.meta.url)).size < 150 * 1024);
  assert.match(html, /Rise of the Interstate Highway/);
});
test('ARCHIVE: the consulting originals live under _archive/ (GitHub Pages\' default Jekyll build does not publish folders starting with an underscore); no archive/ folder, no .nojekyll, no _config.yml', () => {
  assert.ok(fs.existsSync(new URL('../_archive/consulting/index.html', import.meta.url)));
  assert.ok(!fs.existsSync(new URL('../archive', import.meta.url)), 'archive/ would be served');
  assert.ok(!fs.existsSync(new URL('../.nojekyll', import.meta.url)), 'a .nojekyll file would publish _archive: move _archive out of the repo first');
  assert.ok(!fs.existsSync(new URL('../_config.yml', import.meta.url)), 'a _config.yml could change what Pages skips');
});
