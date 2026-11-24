// The consumer-readiness audit's fixes (2026-10-17): a way forward on the sign-in page, Help and Account as words in the header, Help and Contact in the footer, a 404 page, a message
// after signing out, an empty library that explains itself, credits explained, and a version page that leads with what a new person came to do (the raw story and own-data upload folded).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('SIGN-IN: a person with no account is not left at a dead end: the Create an account row (shown by the switch) and help; no invite-only or waitlist words (open sign-up, 11-22)', () => {
  const html = read('app/index.html');
  const p = html.slice(html.indexOf('<p class="form-note sign-in-help">'), html.indexOf('</p>', html.indexOf('<p class="form-note sign-in-help">')));
  assert.doesNotMatch(html.slice(html.indexOf('id="sign-in"'), html.indexOf('id="create-account"')), /invite-only|waitlist|No invite yet|ask for an invite/i, 'the sign-in panel says nothing is invite-only and offers no waitlist');
  assert.match(html, /<p class="form-intro">Sign in to your Ryagram account\.<\/p>/);
  assert.match(html, /<p id="create-row" class="form-note" hidden>First time here\? <a href="#\/create-account" id="create-link">Create an account<\/a><\/p>/);
  assert.doesNotMatch(p, /mailto:/, 'no new mail address until Ryan has confirmed it receives mail');
  assert.match(p, /Trouble signing in\? <a href="\/help\/">Get help<\/a>/);
  assert.ok(read('ryagram/index.html').includes('id="waitlist"'), 'the #waitlist anchor the film pages point at still exists');
});

test('HEADER AND FOOTER: Help and Account are words in the header; Help and Contact are in the app footer', () => {
  const html = read('app/index.html');
  assert.match(html, /<a class="menu-link" role="menuitem" href="#\/account">Account<\/a><a class="menu-link" role="menuitem" href="\/help\/">Help<\/a>/);
  assert.match(html, /<footer class="app-foot">[\s\S]*<a href="\/help\/">Help<\/a><a href="mailto:ryagram@uselai\.com">Contact: ryagram@uselai\.com<\/a>/);
  assert.match(read('assets/app.css'), /\.app-nav-link\{[^}]*min-height:40px/);
});

test('SIGN-OUT: the person is told they have signed out, once', () => {
  const src = read('assets/app-auth.js');
  assert.match(src, /await client\.auth\.signOut\(\);\n\s+sayOnce\('You have signed out\.'\);/);
});

test('404: a branded not-found page with absolute paths (it is shown at any depth), noindex, no script, and the ways back', () => {
  const html = read('404.html');
  assert.match(html, /<title>Page not found \| L'Ai<\/title>/);
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(html, /<script/i);
  for (const href of html.match(/(?:href|src)="([^"]+)"/g).map(m => m.slice(m.indexOf('"') + 1, -1))) {
    assert.ok(/^(https?:|mailto:|\/)/.test(href), `a relative path would break at depth: ${href}`);
  }
  for (const link of ['/ryagram/', '/app/', '/help/', '/']) assert.ok(html.includes(`href="${link}"`), link);
  assert.doesNotMatch(html, /uselai\.com/, 'the 404 page adds no mail address until Ryan has confirmed it receives mail');
  assert.match(html, /<a href="\/help\/">help pages<\/a> have answers and a way to ask us/);
});

test('EMPTY LIBRARY AND CREDITS: the first screen says what a project is and what to do, and what credits are for', () => {
  const lib = read('assets/app-library.js');
  assert.ok(lib.includes("'No films yet. Name your first film above, then pick a ready-made film to start from.'"));
  assert.ok(lib.includes("'Pick a ready-made film, or name your own. Ryagram draws it from public data, with its sources shown. The first picture is free.'"));
  assert.ok(lib.includes("'Welcome back. Pick up a film below, or start a new one.'"));
  assert.ok(lib.includes("'Contact sheets are free. Each project gets some free previews, then 1 credit each. The rule is on ', h('a', { href: '#/credits' }, 'Credits'), '.'"));
  assert.doesNotMatch(lib, /it starts as r1/);
});

test('VERSION PAGE (flip sections, WEB 11-20): the first screen is the band, the key facts and the flip bar; the sections are Make it (the ready-made films, then Render), Jobs, The data, Files, Editor, Advanced; the raw story and the own-data upload are in Advanced (all controls kept)', () => {
  const lib = read('assets/app-library.js');
  const ret = lib.slice(lib.indexOf("      const makeIt = h('div', { class: 'make-it' }, picker, byodPointer, saved, jobs.el, lookApply,"));
  assert.match(ret, /\{ id: 'make', label: 'Make it', el: makeIt \},\n\s+\{ id: 'jobs', label: 'Jobs', el: jobs\.listPanel \},\n\s+\{ id: 'data', label: 'The data', el: sources\.el \},\n\s+\{ id: 'files', label: 'Files', el: h\('div', \{\}, h\('div', \{ class: 'scroll-panel' \}, files\.el\)\) \},\n\s+\{ id: 'editor', label: 'Editor', el: chat[^\n]*hidden: !chat \},\n\s+\{ id: 'advanced', label: 'Advanced', el: advancedEl \}/, 'order: Make it, Jobs, The data, Files, Editor, Advanced');
  assert.doesNotMatch(lib, /story, locked \? null : save, saved, error\)/, 'saved messages are not hidden inside the folded form');
  assert.match(lib, /const advancedEl = h\('div', \{ class: 'advanced-panel', id: 'advanced-panel' \}, h\('h2', \{\}, 'Advanced: your own data and the story file'\),/);
  assert.match(lib, /uploads\?\.el, storyForm\);/);
  for (const keep of ['sources.el', 'uploads?.el', 'picker', 'chat', 'storyForm', 'jobs.el', 'files.el', 'jobs.listPanel']) assert.ok(lib.includes(keep), keep);       // nothing was dropped, only moved
  assert.match(lib, /factCards,\n\s+flip\.el\n/, 'the page is the band, the facts, then the flip');
});

test('STORY SAVE: the "Saved" message also appears beside the Save story button (inside the folded form), not only above it', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /saved\.textContent = savedHere\.textContent = 'Saved\. Earlier sheets and previews were of the old story/);
  assert.match(lib, /story, locked \? null : save, savedHere, error\);/);
  assert.match(lib, /saved\.textContent = '';\n\s+savedHere\.textContent = '';/, 'both are cleared on the next save');
});

test('ROUND 2: back links are comfortable to tap, the first loading line has a spinner (still under reduced motion), and the Render panel says in words what a contact sheet, preview and final film are', () => {
  const css = read('assets/app.css');
  assert.match(css, /\.back\{display:inline-flex;align-items:center;min-height:40px/);
  assert.match(css, /\.spinner\{[^}]*animation:spin/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.spinner\{animation:none\}\}/);
  const lib = read('assets/app-library.js');
  assert.ok(lib.includes("h('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Loading…'"));
  assert.ok(lib.includes("'A contact sheet is a grid of still frames to check the look. It usually takes about 4 to 5 minutes. A preview is a short clip. The final film is the full render.'"));
});

test('FOOTER (Ryan Q26, 2026-10-18): the app footer says "Contact: ryagram@uselai.com" as one link, between Help and Terms of Use', () => {
  const foot = read('app/index.html').match(/<footer class="app-foot">[\s\S]*?<\/footer>/)[0];
  assert.ok(foot.includes('<a href="/help/">Help</a><a href="mailto:ryagram@uselai.com">Contact: ryagram@uselai.com</a><a href="/terms/">Terms of Use</a>'));
  assert.equal((foot.match(/ryagram@uselai\.com/g) || []).length, 2, 'the address is the link target and its label, nothing else');
});

test('DELIVERY LINK SURVIVES A FINISHED RENDER (found by tools/check-delivery-e2e.py): the order box sits outside the run controls, which are hidden once a version is complete', () => {
  const lib = read('assets/app-library.js');
  const controls = lib.slice(lib.indexOf("const controls = h('div', { class: 'run-controls' },"), lib.indexOf("'Jobs run if you leave. We send no email.'"));
  assert.ok(!controls.includes('orderBox'), 'orderBox inside the run controls would be hidden with them');
  assert.ok(lib.includes('controls, orderBox, balanceNote, lockedNote, error);'));
});
