// DRAFT: do not fold until Ryan answers Q679 (option A: open sign-ups get no welcome credits). The one plain line about what a free account can make, on the Create an account form and on /ryagram/.
// Option B (welcome credits chosen): change FREE/CLOSED/OPEN in assets/free-account-line.js, the closed sentence in app/index.html and ryagram/index.html, and the CLOSED/OPEN/6/15 expectations below.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const CLOSED = 'A free account can make free contact sheets, and up to 6 free previews for each project (15 in any 24 hours across all your projects). A full film needs credits, and buying credits is not open yet.';
const OPEN = 'A free account can make free contact sheets, and up to 6 free previews for each project (15 in any 24 hours across all your projects). Credits pay for full films.';
const load = (cfg, els = []) => {
  const win = { ryagramConfig: cfg };
  vm.runInNewContext(read('assets/free-account-line.js'), { window: win, document: { querySelectorAll: () => els } });
  return win.ryagramFreeAccountLine;
};
const app = read('app/index.html'), rg = read('ryagram/index.html');

test('the free-preview numbers in the line are the ones the database enforces', () => {
  const sql = read('supabase/phase-2b/credits_ledger.sql');
  assert.match(sql, /free_previews_per_project\s+int[^,\n]*default 6/i);
  assert.match(sql, /free_previews_per_24h\s+int[^,\n]*default 15/i);
  assert.ok(CLOSED.includes('up to 6 free previews for each project') && CLOSED.includes('15 in any 24 hours'));
});

test('sign-up form: the closed sentence sits above the 18+ tick, and the old "only puts you on the list" claim is gone', () => {
  const panel = app.match(/<section id="create-account"[\s\S]*?<\/section>/)[0];
  const at = panel.indexOf(`data-free-account-line>${CLOSED}</p>`);
  assert.ok(at > 0, 'the free-account sentence is missing from the Create an account form');
  assert.ok(at < panel.indexOf('id="ca-age"'), 'it should come before the 18+ tick');
  assert.ok(!/only puts you on the list/.test(app), 'the false-after-open-sign-up sentence is still on the page');
  assert.match(panel, /are drafts while Ryagram is in testing\.<\/p>/);
});

test('the invite-code form says nothing about free accounts (it is not misled by the new line)', () => {
  const inv = app.match(/<form id="invite-form"[\s\S]*?<\/form>/)[0];
  assert.ok(!/free-account-line|free account|free preview/i.test(inv));
});

test('/ryagram/: the same sentence, hidden until the create line shows (waitingAccounts), next to it', () => {
  assert.ok(rg.includes(`<p id="wl-free" class="rg-note" data-free-account-line hidden>${CLOSED}</p>`));
  assert.ok(rg.indexOf('id="wl-create"') < rg.indexOf('id="wl-free"') && rg.indexOf('id="wl-free"') < rg.indexOf('id="waitlist-status"'));
  assert.match(read('assets/ryagram.js'), /getElementById\('wl-free'\)[\s\S]{0,200}config\.waitingAccounts === true\) freeLine\.hidden = false/);
});

test('both pages load the line script after the config, with a ?v= stamp; the changed ryagram.js has a new stamp', () => {
  assert.ok(app.indexOf('free-account-line.js?v=') > app.indexOf('ryagram-config.js'));
  assert.ok(rg.indexOf('free-account-line.js?v=') > rg.indexOf('ryagram-config.js'));
  assert.match(rg, /ryagram\.js\?v=20261122a/);
});

test('the words follow the Credits page switch (credits + payments + buyingOpen): closed says buying is not open, open does not', () => {
  assert.equal(load({ credits: true, payments: true, buyingOpen: false }).line(), CLOSED);
  assert.equal(load({ credits: true, payments: true }).line(), CLOSED);
  assert.equal(load({ credits: true, payments: false, buyingOpen: true }).line(), CLOSED);
  assert.equal(load({ credits: false, payments: true, buyingOpen: true }).line(), CLOSED);
  assert.equal(load({}).line(), CLOSED);
  assert.equal(load({ credits: true, payments: true, buyingOpen: true }).line(), OPEN);
  assert.ok(!/not open yet/.test(OPEN) && /Credits pay for full films\.$/.test(OPEN));
});

test('the shipped config (buyingOpen false) gives the closed wording, and every marked element is filled', () => {
  const cfgWin = {}; vm.runInNewContext(read('assets/ryagram-config.js'), { window: cfgWin });
  const el = { textContent: 'stale' };
  const win = { ryagramConfig: cfgWin.ryagramConfig };
  vm.runInNewContext(read('assets/free-account-line.js'), { window: win, document: { querySelectorAll: () => [el] } });
  assert.equal(el.textContent, CLOSED);
  const open = { textContent: '' };
  vm.runInNewContext(read('assets/free-account-line.js'), { window: { ryagramConfig: { ...cfgWin.ryagramConfig, buyingOpen: true } }, document: { querySelectorAll: () => [open] } });
  assert.equal(open.textContent, OPEN);
});

test('the same switch as app-library.js buyingOn: the library still ties it to credits + payments + buyingOpen', () => {
  assert.match(read('assets/app-library.js'), /const buyingOn = \(\) => paymentsOn\(\) && \(window\.ryagramConfig\?\.buyingOpen === true/);
});
