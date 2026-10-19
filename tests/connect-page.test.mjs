// The "Connect your AI" guide page (/connect-ai/): a DRAFT with placeholder connector addresses, unlisted, linked from nowhere until Ryan fills in the real address.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const page = read('connect-ai/index.html');

test('DRAFT: marked as a draft with a placeholder address, noindex, no script, strict CSP; every connector address on the page is the placeholder', () => {
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(page, /<p class="shell-banner" role="note"><strong>DRAFT\. Not published\.<\/strong>/);
  assert.doesNotMatch(page, /<script/i);
  assert.match(page, /Content-Security-Policy" content="default-src 'self'; script-src 'self'/);
  const urls = [...page.matchAll(/https?:\/\/[^\s"<)]+/g)].map(m => m[0]).filter(u => !/fonts\.(googleapis|gstatic)\.com|uselai\.com|support\.claude\.com/.test(u));
  assert.ok(urls.length >= 3);
  for (const u of urls) assert.match(u, /CONNECTOR-ADDRESS-PENDING/, `a real address must not appear before launch: ${u}`);
  assert.ok(!/supabase\.co/.test(page));
});

test('CONTENT: ChatGPT only where the plan allows custom MCP connectors; it cannot spend credits; what the consent page shows; how to disconnect; the 30-minute sign-in', () => {
  assert.match(page, /works <strong>only on plans that allow custom MCP connectors<\/strong>/);
  assert.match(page, /<strong>It cannot spend your credits\.<\/strong>/);
  assert.match(page, /the name Ryagram knows the assistant by, the name it calls itself, and the web address it will send you back to/);
  assert.match(page, /remove the Ryagram connector in that assistant's own settings/);
  assert.doesNotMatch(page, /Connected AIs/, 'the Connected AIs list does not exist until connect-consent ships, so this page must not point at it');
  assert.match(page, /A sign-in request lasts 30 minutes/);
  assert.match(page, /not a Custom GPT/);
  assert.match(page, /ask it to start a project/);
  assert.match(page, /<strong>It cannot change your account<\/strong>/);
  assert.doesNotMatch(page, /Team and Enterprise|confirmed for Business|retiring custom GPTs|December 2026/, 'facts about other companies stay out until each has a source (asked CONNECT)');
  for (const h of ['Claude (claude.ai, Claude Desktop, phone)', 'Claude Code', 'ChatGPT', 'Other assistants', 'Disconnecting']) assert.ok(page.includes(`<h2>${h}</h2>`), h);
});

test('UNLISTED: no page and no script of the site links to it yet (every .html file and every assets/*.js, not a fixed list)', () => {
  const files = [];
  const walk = d => { for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
    if (['node_modules', '.git', 'supabase', 'tests', 'tools'].includes(e.name)) continue;
    const rel = path.posix.join(d, e.name);
    if (e.isDirectory()) walk(rel); else if (/\.(html|js)$/.test(e.name)) files.push(rel);
  } };
  walk('.');
  assert.ok(files.length > 30, files.length);
  for (const f of files) if (f !== 'connect-ai/index.html') assert.doesNotMatch(read(f), /connect-ai/, f);
});

test('LIMITS: free previews only (within a daily limit), no full renders, and the footer carries Terms and AI content like the other Ryagram pages', () => {
  assert.match(page, /use your free previews, within a daily limit\./);
  assert.doesNotMatch(page, /short previews, which are free/);
  assert.match(page, /<strong>It cannot start a full render\.<\/strong> Full renders are always started by you, in Ryagram\./);
  const foot = page.match(/<footer[\s\S]*?<\/footer>/)[0];
  assert.match(foot, /<a href="\/terms\/">Terms of Use<\/a><a href="\/privacy-policy\.html">Privacy Policy<\/a><a href="\/ai-content\/">AI content<\/a>/);
});

test('NO NEW MAIL ADDRESS: the guide names no mail address until Ryan has confirmed ryagram@ receives mail', () => {
  assert.doesNotMatch(page, /ryagram@uselai|mailto:/);
});

test('SOURCED FACTS (CONNECT 23:53): the Claude steps follow the Anthropic page and the Team/Enterprise rule carries its source link; no ChatGPT plan list and no custom-GPT retirement claim until the OpenAI pages can be read', () => {
  assert.match(page, /<li>Open Customize, then Connectors, then Add custom connector\.<\/li>/);
  assert.match(page, /choose Register automatically\./);
  const p = page.match(/<p>On a Claude Team plan[\s\S]*?<\/p>/)[0];
  assert.match(p, /only Owners and Primary Owners can add a custom connector/);
  assert.match(p, /Source: <a href="https:\/\/support\.claude\.com\/en\/articles\/11175166-get-started-with-custom-connectors-using-remote-mcp" rel="noopener noreferrer">/);
  assert.doesNotMatch(page, /Free, Pro|Plus|retir|December 2026|11 December/, 'nothing about OpenAI plans or retirement, which no one has been able to confirm from OpenAI');
  for (const [, href] of page.matchAll(/<a href="(https?:[^"]+)"/g)) assert.ok(/support\.claude\.com|fonts\./.test(href), `an outside link must be a source we checked: ${href}`);
});
