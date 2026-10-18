// The consumer-readiness audit's fixes (2026-10-17): a way forward on the sign-in page, Help and Account as words in the header, Help and Contact in the footer, a 404 page, a message
// after signing out, an empty library that explains itself, credits explained, and a version page that leads with what a new person came to do (the raw story and own-data upload folded).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('SIGN-IN: a person with no invite is not left at a dead end: waitlist, email for an invite, and help', () => {
  const html = read('app/index.html');
  const p = html.slice(html.indexOf('<p class="form-note sign-in-help">'), html.indexOf('</p>', html.indexOf('<p class="form-note sign-in-help">')));
  assert.match(p, /No invite yet\? <a href="\/ryagram\/#waitlist">Join the waitlist<\/a>/);
  assert.doesNotMatch(p, /mailto:/, 'no new mail address until Ryan has confirmed it receives mail');
  assert.match(p, /<a href="\/ryagram\/#waitlist">Join the waitlist<\/a> to ask for an invite\./);
  assert.match(p, /Trouble signing in\? <a href="\/help\/">Get help<\/a>/);
  assert.ok(read('ryagram/index.html').includes('id="waitlist"'), 'the waitlist anchor it points at exists');
});

test('HEADER AND FOOTER: Help and Account are words in the header; Help and Contact are in the app footer', () => {
  const html = read('app/index.html');
  assert.match(html, /<a class="app-nav-link" href="\/help\/">Help<\/a><a class="app-nav-link" href="#\/account">Account<\/a><a id="account-email"/);
  assert.match(html, /<footer class="app-foot">[\s\S]*<a href="\/help\/">Help<\/a><a href="mailto:ryagram@uselai\.com">ryagram@uselai\.com<\/a>/);
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
  assert.ok(lib.includes("'No projects yet. A project is one film you are making. Name it above, then pick a ready-made film to start from.'"));
  assert.ok(lib.includes("'Each project is one film. Start one below and Ryagram draws it from public data, with its sources shown.'"));
  assert.ok(lib.includes("'Credits pay for full films and for previews beyond your free ones. Contact sheets are free.'"));
  assert.doesNotMatch(lib, /it starts as r1/);
});

test('VERSION PAGE: the ready-made films and the editor come first, then sources, then Render; the raw story and the own-data upload are folded under Advanced (all controls kept)', () => {
  const lib = read('assets/app-library.js');
  const ret = lib.slice(lib.indexOf("        picker,\n        byodPointer,\n        saved,"));
  assert.match(ret, /^ {8}picker,\n {8}byodPointer,\n {8}saved,[^\n]*\n {8}chat,\n {8}sources\.el,\n {8}jobs\.el,\n {8}files\.el,/, 'order: picker, its confirmation, chat, sources, render, files');
  assert.doesNotMatch(lib, /story, locked \? null : save, saved, error\)/, 'saved messages are not hidden inside the folded form');
  assert.match(ret, /advanced = h\('details', \{ class: 'advanced-panel', id: 'advanced-panel' \}, h\('summary', \{\}, 'Advanced: your own data and the story file'\),/);
  assert.match(ret, /uploads\?\.el, storyForm\)/);
  for (const keep of ['sources.el', 'uploads?.el', 'picker', 'chat', 'storyForm', 'jobs.el', 'files.el']) assert.ok(ret.includes(keep), keep);       // nothing was dropped, only moved or folded
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
  assert.ok(lib.includes("'A contact sheet is a quick grid of still frames to check the look. A preview is a short clip. The final film is the full render.'"));
});

test('FOOTER (Ryan Q26, 2026-10-18): the app footer says "Contact: ryagram@uselai.com" as one link, between Help and Terms of Use', () => {
  const foot = read('app/index.html').match(/<footer class="app-foot">[\s\S]*?<\/footer>/)[0];
  assert.ok(foot.includes('<a href="/help/">Help</a><a href="mailto:ryagram@uselai.com">Contact: ryagram@uselai.com</a><a href="/terms/">Terms of Use</a>'));
  assert.equal((foot.match(/ryagram@uselai\.com/g) || []).length, 2, 'the address is the link target and its label, nothing else');
});
