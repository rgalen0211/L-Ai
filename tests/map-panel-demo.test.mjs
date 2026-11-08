// WEB 11-08: the map panel demo page (/map-panel-demo/, behind mapPanelDemo, OFF) on MADE-UP data: hidden unless the switch is exactly true, no network or storage, the three no-number states kept apart in the words,
// and the real script run against a minimal page (off shows the plain line; on builds the panel; option A fills in by itself after 3 s, option B waits for the button).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const code = read('assets/map-panel-demo.js');

test('the page: noindex, content hidden in the HTML, no inline script or style, no outside script', () => {
  const html = read('map-panel-demo/index.html');
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(html, /<p id="not-available">This page is not available yet\.<\/p>/); assert.match(html, /<div id="map-panel-demo" hidden><h1>[^<]+<\/h1><\/div>/);
  assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(html) && !/<script[^>]*src="https?:/.test(html) && !/<style|style="/.test(html));
  assert.ok(html.indexOf('ryagram-config.js') < html.indexOf('map-panel-demo.js'));
  assert.match(read('assets/ryagram-config.js'), /\n  mapPanelDemo: false,/);
  assert.ok(!/(fetch\(|XMLHttpRequest|localStorage|sessionStorage|eval\(|import\(|https?:\/\/|\.style\.cssText|setAttribute\('style')/.test(code.replace(/http:\/\/www\.w3\.org\/2000\/svg/, '')), 'no network, storage or outside address, no style attribute');
  assert.ok(!/<a [^>]*style=/.test(code) && !/ style="/.test(code), 'no inline style in the markup the script builds (the page policy forbids it)');
  const all = fs.readdirSync(root).filter(f => f.endsWith('.html')).map(f => read(f)).join('\n') + read('help/index.html') + read('ryagram/index.html') + read('assets/app-library.js') + read('assets/app-departments.js');
  assert.ok(!/map-panel-demo/.test(all), 'linked from nowhere');
});

test('the words keep the three no-number states apart and name the options', () => {
  assert.match(code, /Not published at this level\./); assert.match(code, /Not fetched yet\./); assert.match(code, /Withheld, or no figure\./); assert.match(code, /It is not a zero/);
  assert.match(code, /held the view still for 3 seconds/); assert.match(code, /Load this area/);
  for (const w of ['This chat does not let the map load detail', 'Slowing down', 'This map is newer than this panel', 'reach the map service']) assert.ok(code.includes(w), w);
  assert.equal(new Set(['Not published at this level.', 'Not fetched yet.', 'Withheld, or no figure.']).size, 3);
});

// a minimal DOM that records what the script builds
function dom() {
  const timers = []; let now = 0;
  const el = () => ({ hidden: false, className: '', children: [], style: {}, classList: { add() {} }, append() {}, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, ownerDocument: null, innerHTML: '', textContent: '', getAttribute() { return null; }, hasAttribute() { return false; } });
  const els = { 'map-panel-demo': el(), 'not-available': el() }; els['map-panel-demo'].hidden = true;
  const doc = { getElementById: id => els[id], createElement: () => el(), activeElement: null };
  els['map-panel-demo'].ownerDocument = doc;
  const win = { setTimeout: (f, ms) => { timers.push({ f, at: now + ms }); return timers.length; }, clearTimeout: id => { if (timers[id - 1]) timers[id - 1].f = null; }, matchMedia: () => ({ matches: false, addEventListener() {} }) };
  return { els, doc, win, timers, advance(ms) { now += ms; for (const t of timers) if (t.f && t.at <= now) { const f = t.f; t.f = null; f(); } } };
}
function load(cfg) {
  const d = dom(); const win = { ...d.win, ryagramConfig: cfg };
  vm.runInNewContext(code, { window: win, document: d.doc, setTimeout: d.win.setTimeout, clearTimeout: d.win.clearTimeout, Math, Number, String, Object, Array });
  return { d, api: win.ryagramMapPanelDemo };
}

test('the switch: off shows only the plain line; "true", 1 and a missing switch never turn it on', () => {
  for (const cfg of [{}, { mapPanelDemo: 'true' }, { mapPanelDemo: 1 }, { mapPanelDemo: false }]) {
    const { d, api } = load(cfg);
    assert.equal(d.els['map-panel-demo'].hidden, true); assert.equal(d.els['not-available'].hidden, false); assert.equal(api.on(cfg), false);
  }
  const { d, api } = load({ mapPanelDemo: true });
  assert.equal(d.els['map-panel-demo'].hidden, false); assert.equal(d.els['not-available'].hidden, true); assert.equal(api.on({ mapPanelDemo: true }), true);
});

test('option A fills in by itself after 3 s still; option B waits for the button; an error state never self-fills', () => {
  const { d, api } = load({ mapPanelDemo: true }); void d;
  const mk = () => { const x = dom(); const host = { ...x.els['map-panel-demo'], ownerDocument: x.doc }; return { x, host }; };
  { const { x, host } = mk(); const p = api.create(host, x.win); assert.equal(p.S.st, 'loading'); x.advance(2999); assert.equal(p.S.st, 'loading'); x.advance(2); assert.equal(p.S.st, 'drawn'); }
  { const { x, host } = mk(); const p = api.create(host, x.win); p.setFetchMode('B'); x.advance(10000); assert.equal(p.S.st, 'loading', 'B never fills by itself'); }
  assert.equal(api.STILL_MS, 3000);
  assert.deepEqual(JSON.parse(JSON.stringify(api.STATES.map(s => s[0]))), ['loading', 'drawn', 'level', 'nofig', 'offline', 'blocked', 'slow', 'newer']);
  assert.deepEqual(JSON.parse(JSON.stringify([0, 3, 4, 6, 7, 12].map(api.level))), ['None', 'None', 'States', 'States', 'Counties', 'Counties']);
});
