// NEXT-WEB 184: the plain sentence about Mac on the two places that offer the Windows app (the page behind an invite email, /get-app/, and the Download card on the Account page). One source (assets/mac-note.js),
// shown only when macNote is exactly true (off), and only true statements: Windows today, a Mac version planned, not built, no date (proposals/CONNECT-MAC-READY-PLAN.md: nothing for Mac exists, Ryan decides whether and when).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {}; vm.runInNewContext(read('assets/mac-note.js'), { window: win });
const N = win.ryagramMacNote;

test('the words say Windows today, a Mac version planned, not built, no date, and promise no more', () => {
  const text = N.LINES.join(' ');
  assert.match(text, /app is for Windows today/); assert.match(text, /Mac version is planned/); assert.match(text, /not built yet/); assert.match(text, /no date/);
  assert.match(text, /needs the Windows app/);
  assert.ok(!/\b(soon|coming soon|next month|this year|will be (ready|available)|guarantee)\b/i.test(text), 'no promise of a time');
  assert.ok(!/(apple silicon|intel|notariz|gatekeeper|\$\d)/i.test(text), 'none of the plan\'s technical detail');
  assert.ok(N.LINES.every(l => l.length < 160), 'short sentences');
  assert.ok(Object.isFrozen(N));
});

test('it shows only when the switch is exactly true', () => {
  assert.equal(N.on({ macNote: true }), true);
  for (const bad of [undefined, null, {}, { macNote: false }, { macNote: 'true' }, { macNote: 1 }]) assert.equal(N.on(bad), false, JSON.stringify(bad));
  assert.match(read('assets/ryagram-config.js'), /\n  macNote: false,/);
});

test('a Mac visitor is recognised, and an iPhone or iPad is not a Mac', () => {
  assert.equal(N.isMac({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (Macintosh)' }), true);
  assert.equal(N.isMac({ userAgentData: { platform: 'macOS' }, userAgent: '' }), true);
  assert.equal(N.isMac({ platform: 'Win32', userAgent: 'Windows' }), false);
  assert.equal(N.isMac({ platform: 'MacIntel', userAgent: 'Mozilla/5.0 (iPad; CPU OS)' }), false);
  assert.equal(N.isMac(undefined), false);
});

test('wiring: both places read the one source, behind the switch; the page behind the email loads the config and the note before its own script; nothing else about the download changes', () => {
  const ga = read('get-app/index.html'), gjs = read('assets/get-app.js'), dev = read('assets/app-device.js'), idx = read('app/index.html');
  assert.match(ga, /<p id="ga-mac" class="note" role="note" hidden><\/p>/);
  const at = f => ga.indexOf(`<script src="/assets/${f}`);
  assert.ok(at('ryagram-config.js') > 0 && at('ryagram-config.js') < at('mac-note.js') && at('mac-note.js') < at('get-app.js'));
  assert.match(gjs, /N\.on\(window\.ryagramConfig\)\) \{ mac\.textContent = N\.LINES\.join\(' '\); mac\.hidden = false; \}/);
  assert.match(dev, /window\.ryagramMacNote && window\.ryagramMacNote\.on\(window\.ryagramConfig\) \? \[h\('p', \{ class: 'form-note windows-mac-note', role: 'note' \}/);
  assert.ok(idx.indexOf('mac-note.js') > 0 && idx.indexOf('mac-note.js') < idx.indexOf('app-device.js?'));
  assert.match(ga, /Download Ryagram for Windows/); assert.match(dev, /Download Ryagram for Windows/);                      // the download itself is unchanged
  assert.ok(!/innerHTML|insertAdjacentHTML|eval\(|fetch\(/.test(read('assets/mac-note.js')));
});
