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
  const urls = [...page.matchAll(/https?:\/\/[^\s"<)]+/g)].map(m => m[0]).filter(u => !/fonts\.(googleapis|gstatic)\.com|uselai\.com/.test(u));
  assert.ok(urls.length >= 3);
  for (const u of urls) assert.match(u, /CONNECTOR-ADDRESS-PENDING/, `a real address must not appear before launch: ${u}`);
  assert.ok(!/supabase\.co/.test(page));
});

test('CONTENT: ChatGPT only where the plan allows custom MCP connectors; it cannot spend credits; what the consent page shows; how to disconnect; the 30-minute sign-in', () => {
  assert.match(page, /works <strong>only on plans that allow custom MCP connectors<\/strong>/);
  assert.match(page, /<strong>It cannot spend your credits\.<\/strong>/);
  assert.match(page, /the name Ryagram knows the assistant by, the name it calls itself, and the web address it will send you back to/);
  assert.match(page, /Account, then Connected AIs, and press Disconnect/);
  assert.match(page, /A sign-in request lasts 30 minutes/);
  assert.match(page, /Custom GPT with Actions/);
  for (const h of ['Claude (claude.ai, Claude Desktop, phone)', 'Claude Code', 'ChatGPT', 'Other assistants', 'Disconnecting']) assert.ok(page.includes(`<h2>${h}</h2>`), h);
});

test('UNLISTED: no page of the site links to it yet', () => {
  for (const p of ['index.html', 'ryagram/index.html', 'app/index.html', 'help/index.html', 'film/index.html', 'report/index.html', 'privacy-policy.html']) {
    if (fs.existsSync(path.join(root, p))) assert.doesNotMatch(read(p), /connect-ai/, p);
  }
  assert.doesNotMatch(read('assets/app-library.js'), /connect-ai/);
});
