// The /ryagram/ page footer carries one plain Help link, in the same style as its other footer links (a bare <a> in the footer row).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'ryagram', 'index.html'), 'utf8');
const footer = /<footer class="rg-foot">[\s\S]*?<\/footer>/.exec(html)[0];

test('RYAGRAM FOOTER: has one link to /help/ in plain words, styled like its siblings', () => {
  const links = [...footer.matchAll(/<a ([^>]*)>([^<]*)<\/a>/g)];
  const help = links.filter(m => /href="\/help\/"/.test(m[1]));
  assert.equal(help.length, 1);
  assert.equal(help[0][2], 'Need help? Get help');
  assert.doesNotMatch(help[0][1], /class=|style=|target=/);                     // like Terms of Use and Privacy Policy: a bare link
  assert.match(footer, /<a href="\/terms\/">Terms of Use<\/a>/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'help', 'index.html')));  // the link goes somewhere
});
