// GAMES 11-19 (CC1's OK 08:24; GAMES' live look 11-18 20:29, LOWs a-c): while gameTv / gamePhone are OFF, the two game pages are no
// longer a dead end. The not-available line is the page's ONE heading. Under it is the 404 page's own 'These might help:' list (the same
// words and links, nothing new). The browser tab no longer names a draft game while the game is hidden. The footer is in the site's own
// order. The game's title comes back only when its switch is on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const PAGES = [['game-tv', 'assets/game-tv.js', "Guess the next line, TV screen (draft) | L'Ai"], ['game-phone', 'assets/game-phone.js', "Guess the next line, phone (draft) | L'Ai"]];
const helpList = html => ((html.match(/These might help:<\/p>\s*<ul class="not-found-links">([\s\S]*?)<\/ul>/) || [])[1] || '').replace(/\s+/g, ' ').trim() || null;

test('the off state: one heading, the 404 page\'s own help list, a tab title that names no game, the site\'s footer order', () => {
  const fourOhFour = helpList(read('404.html'));
  assert.ok(fourOhFour, 'the 404 page still has its help list');
  for (const [page] of PAGES) {
    const html = read(`${page}/index.html`);
    assert.match(html, /<title>Not available yet \| L'Ai<\/title>/, `${page}: the tab names no draft game while it is hidden`);
    assert.match(html, /<section id="not-available" aria-labelledby="not-available-title">\s*<h1 id="not-available-title">This page is not available yet\.<\/h1>/, `${page}: the line is the heading`);
    assert.equal((html.match(/<h1\b/g) || []).length, 1, `${page}: exactly one h1 in the HTML`);
    assert.equal(helpList(html), fourOhFour, `${page}: the same help list as the 404 page, word for word`);
    assert.match(html, new RegExp(`<div id="${page}" hidden></div>`), `${page}: the game stays hidden in the HTML`);
    const foot = (html.match(/<div class="container footer-row">([\s\S]*?)<\/div>/) || [])[1] || '';
    const order = [...foot.matchAll(/<a href="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(order, ['/help/', '/terms/', '/privacy-policy.html', '/ai-content/'], `${page}: footer order as on every other page`);
  }
});

test('the page script: OFF keeps the off state and its title; ON hides it and brings the game\'s own title back', () => {
  for (const [page, script, title] of PAGES) {
    for (const flag of [false, true]) {
      const els = { [page]: { hidden: true, textContent: '', replaceChildren() {}, append() {} }, 'not-available': { hidden: false } };
      const doc = { title: "Not available yet | L'Ai", getElementById: id => els[id] || null, createElement: () => ({ setAttribute() {}, addEventListener() {}, append() {}, replaceChildren() {}, focus() {}, querySelector: () => null, classList: { add() {}, remove() {}, toggle() {} }, style: {} }), createTextNode: t => ({ nodeType: 3, t }), addEventListener() {} };
      const cfgKey = page === 'game-tv' ? 'gameTv' : 'gamePhone';
      const w = { ryagramConfig: { [cfgKey]: flag }, ryagramGameTvSample: {}, setInterval() { return 0; }, clearInterval() {}, setTimeout() { return 0; }, clearTimeout() {} };
      vm.runInContext(read(script), vm.createContext({ window: w, document: doc, console }));
      assert.equal(els['not-available'].hidden, flag, `${page} ${flag ? 'ON' : 'OFF'}: the off state is ${flag ? 'hidden' : 'shown'}`);
      assert.equal(doc.title, flag ? title : "Not available yet | L'Ai", `${page} ${flag ? 'ON' : 'OFF'}: the tab title`);
    }
  }
});

test('the switched-page checks still see both pages (tests/switches-off.test.mjs finds the off state by its id, not by a <p>)', () => {
  const t = read('tests/switches-off.test.mjs');
  assert.match(t, /id="not-available"/);
  const finder = t.match(/if \(\/(.*?id="not-available".*?)\/\.test\(code\[f\]\)\)/);
  assert.ok(finder, 'switches-off has its off-state finder');
  const re = new RegExp(finder[1].replace(/\\\//g, '/'));
  for (const [page] of PAGES) assert.ok(re.test(read(`${page}/index.html`)), `${page}: switches-off still checks this page`);
});
