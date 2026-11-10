// The games join card page (CONNECT, 2026-11-10; tools/games-host/join-card.mjs; the real-Chrome check is tools/check-games-join-card.py, its planted faults tools/check-games-join-card-mutants.py).
// Tested here, offline: the committed join-card.html is exactly what the builder makes (the games server reads the file); it is plain ASCII; it stays within its budget; it holds no address, no network call, no eval and no
// innerHTML; the resource it is listed under is the contract's own address and tells the host the page may reach nowhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { joinCardHtml, JOIN_CARD_URI, JOIN_CARD_RESOURCE } from '../tools/games-host/join-card.mjs';
import { CARD_URI, CARD_TOOLS } from '../tools/games-host-contract.mjs';

const FILE = new URL('../tools/games-host/join-card.html', import.meta.url);

test('the committed join-card.html is exactly what join-card.mjs builds, in plain ASCII, within 8 KB', () => {
  const committed = fs.readFileSync(FILE, 'utf8');
  assert.equal(committed.replace(/\r\n/g, '\n'), joinCardHtml());
  assert.ok(!/[^\x20-\x7e\r\n]/.test(committed), 'plain ASCII only (no invisible or direction character can hide in it)');
  assert.ok(Buffer.byteLength(joinCardHtml()) <= 8 * 1024);
});

test('the page makes no network call and holds no address, no eval and no innerHTML; its script parses', () => {
  const html = joinCardHtml();
  assert.ok(!/https?:|<link|<img|<iframe|@import|url\(|fetch\(|XMLHttpRequest|WebSocket|eval\(|new Function|innerHTML|document\.write|sendBeacon|<form/i.test(html));
  const script = html.split('<script>')[1].split('</script>')[0];
  assert.doesNotThrow(() => new Function(script));
  assert.equal((html.match(/<script>/g) || []).length, 1, 'one inline script and no other');
  assert.ok(/textContent/.test(script), 'text is set with textContent');
});

test('the resource the games server lists is the contract\'s own address, text/html MCP App, and the page may reach nowhere', () => {
  assert.equal(JOIN_CARD_URI, CARD_URI);
  assert.deepEqual(CARD_TOOLS, ['open_room', 'join_card']);
  assert.equal(JOIN_CARD_RESOURCE.mimeType, 'text/html;profile=mcp-app');
  assert.deepEqual(JOIN_CARD_RESOURCE._meta.ui.csp, { connectDomains: [], resourceDomains: [] });
  assert.equal(JOIN_CARD_RESOURCE._meta.ui.prefersBorder, false);
});

test('the page draws only a four capital letter code and { name } players: the rules are in the script as written', () => {
  const script = joinCardHtml();
  assert.ok(script.includes('/^[A-Z]{4}$/.test(sc.code)'));
  assert.ok(script.includes('names.length<20'));
  assert.ok(script.includes('.slice(0,n||24)'));
  assert.ok(!/\.(address|url|phone_url|link|ip|host)\b/.test(script), 'the page never reads an address-like field');
});
