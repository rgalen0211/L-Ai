// Wednesday's first strangers (BUILDER 11-23, from the first-user audit; WEB's 08:19 slice): no button that leads to a send that can only fail, no 'own data' or spreadsheet
// promise while uploads are off, no 'Welcome back' to an account that has never been here, and the builder's dataset tab not named like the upload panel.
// The request gate runs for real here (its own lines, a fake element and fake balances); the rest are checked in the source, one test per sentence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = p => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const lib = read('assets/app-library.js');
const builder = read('assets/app-builder.js');

// The gate's own lines, run against a config, a balance and an element.
function gate(source, { config = {}, mock = false, available = 0, search = '' } = {}) {
  const a = source.indexOf('  const creditsOn ='), b = source.indexOf('  const BUYING_CLOSED_SHORT');
  const helpers = source.slice(a, source.indexOf('\n', b));
  const g0 = source.indexOf('  const availableOf ='), g1 = source.indexOf('  const REQUEST_CLOSED');
  assert.ok(a > 0 && b > a && g0 > b && g1 > g0, 'the helpers and the gate are where this test expects them');
  const win = { ryagramConfig: { credits: true, payments: true, filmRequests: true, ...config } };
  if (mock) win.ryagramMock = {};
  const fn = vm.runInNewContext(`(function (window, location) { ${helpers}\n${source.slice(g0, g1)}\n return { requestGate, availableOf }; })`, {});
  const api = fn(win, { search });
  const data = { creditBalances: async () => [{ available, held: 0 }], filmRequestCost: async () => 10 };      // 10 = the request cost (creator_flow default; the mock's too)
  return { ...api, data };
}
const settle = () => new Promise(r => setTimeout(r, 5));

test('REQUEST GATE: buying closed and 0 credits: the request link is hidden (a new account cannot send a request that needs credits it cannot buy)', async () => {
  const g = gate(lib, { config: { buyingOpen: false }, available: 0 });
  const el = { hidden: false };
  assert.equal(g.requestGate(g.data, el), el);
  await settle();
  assert.equal(el.hidden, true);
});

test('REQUEST GATE: buying closed with a balance BELOW the cost (5 of 10): still hidden, so no link leads to a disabled Send', async () => {
  const g = gate(lib, { config: { buyingOpen: false }, available: 5 });
  const el = { hidden: false };
  g.requestGate(g.data, el);
  await settle();
  assert.equal(el.hidden, true);
});

test('REQUEST GATE: buying closed but the balance COVERS a request (10 of 10): shown once the balance and the cost load', async () => {
  const g = gate(lib, { config: { buyingOpen: false }, available: 10 });
  const el = { hidden: false };
  g.requestGate(g.data, el);
  await settle();
  assert.equal(el.hidden, false);
});

test('REQUEST GATE: buying open, or credits off, leaves the link exactly as it was (no balance read)', async () => {
  for (const config of [{ buyingOpen: true }, { credits: false }]) {
    const g = gate(lib, { config, available: 0 });
    g.data.creditBalances = async () => { throw new Error('must not be read'); };
    const el = { hidden: false };
    g.requestGate(g.data, el);
    await settle();
    assert.equal(el.hidden, false, JSON.stringify(config));
  }
  assert.equal(gate(lib).requestGate({}, null), null, 'a missing element (requests off) stays null');
});

test('REQUEST GATE: a balance that fails to load keeps it hidden while buying is closed (no dead end on an error)', async () => {
  const g = gate(lib, { config: { buyingOpen: false } });
  g.data.creditBalances = async () => { throw new Error('offline'); };
  const el = { hidden: false };
  g.requestGate(g.data, el);
  await settle();
  assert.equal(el.hidden, true);
  const g2 = gate(lib, { config: { buyingOpen: false }, available: 50 });
  g2.data.filmRequestCost = async () => { throw new Error('offline'); };
  const el2 = { hidden: false };
  g2.requestGate(g2.data, el2);
  await settle();
  assert.equal(el2.hidden, true, 'a cost that fails to load keeps it hidden too');
});

test('PLANTED FAULT: a gate that never hides is caught', async () => {
  const faulty = lib.replace('    el.hidden = true;\n    Promise.all(', '    Promise.all(');
  assert.notEqual(faulty, lib);
  const g = gate(faulty, { config: { buyingOpen: false }, available: 0 });
  const el = { hidden: false };
  g.requestGate(g.data, el);
  await settle();
  assert.equal(el.hidden, false, 'the faulty gate leaves the link showing at 0 credits, which the first test forbids');
  const anyCredit = lib.replace('availableOf(rows) >= Number(cost)', 'availableOf(rows) > 0');
  assert.notEqual(anyCredit, lib);
  const g2 = gate(anyCredit, { config: { buyingOpen: false }, available: 5 });
  const el2 = { hidden: false };
  g2.requestGate(g2.data, el2);
  await settle();
  assert.equal(el2.hidden, false, 'the old any-credit rule shows the link at 5 of 10, which the below-cost test forbids');
});

test('both ways in go through the gate: the home link row and the project page pointer', () => {
  assert.match(lib, /const quietItem = x => \(x === requestLink \? requestGate\(data, h\('li', \{\}, x\)\) : h\('li', \{\}, x\)\);/);
  assert.match(lib, /h\('ul', \{ class: 'home-links' \}, quiet\.map\(quietItem\)\)/);
  const made = lib.indexOf('      const helpNote = requestsOn() ?');
  const next = lib.indexOf('\n', made) + 1;
  assert.ok(lib.startsWith('      requestGate(data, helpNote);', next), 'the project page pointer goes through the gate right where it is made');
});

test('the request page itself: with buying closed and a balance below the cost, Send is disabled and the page says why', () => {
  assert.ok(lib.includes("const REQUEST_CLOSED = (cost, have) => `A film request costs ${window.ryagramCredits.plural(Number(cost))}; you have ${window.ryagramCredits.plural(have)}. Buying credits is not open yet.`;"));
  assert.ok(lib.includes('if (short) closedNote.textContent = REQUEST_CLOSED(c, availableOf(bal));'));
  assert.match(lib, /let short = false;/);
  assert.match(lib, /\n        short = !buyingOn\(\) && !!bal && c != null && availableOf\(bal\) < Number\(c\);/);
  assert.match(lib, /send\.disabled = short; closedNote\.hidden = !short;/);
  // busy() turns the button back on in its finally: a send that spends the last credits must leave it off, and a short click sends nothing
  const end = lib.indexOf("h('label', { for: 'rq-question' }");
  const sub = lib.slice(lib.lastIndexOf("if (problem) { showError(error, new Error(problem)); return; }", end), end);
  assert.ok(sub.indexOf('if (short) return;') > 0 && sub.indexOf('if (short) return;') < sub.indexOf('await busy(send'), 'a short click returns before any send');
  assert.ok(sub.indexOf('send.disabled = short;') > sub.indexOf('await busy(send'), 'the button state is put back AFTER busy() re-enables it');
  assert.match(lib, /balance, cost, closedNote, form, done, h\('h2', \{\}, 'Your requests'\), list\];/);
});

test('REQUEST GATE at the welcome balance (Q679 B): 8 credits of a 10-credit request stays hidden; 10 shows; the request page says what it costs and what you have', async () => {
  const at8 = gate(lib, { config: { buyingOpen: false }, available: 8 });
  const el8 = { hidden: false };
  at8.requestGate(at8.data, el8);
  await settle();
  assert.equal(el8.hidden, true, 'a request costs 10: 8 welcome credits do not cover it');
  const at10 = gate(lib, { config: { buyingOpen: false }, available: 10 });
  const el10 = { hidden: false };
  at10.requestGate(at10.data, el10);
  await settle();
  assert.equal(el10.hidden, false);
  const C = {}; vm.runInNewContext(read('assets/app-credits.js'), { window: C });
  const said = vm.runInNewContext(`(function (window) { ${lib.slice(lib.indexOf('  const REQUEST_CLOSED ='), lib.indexOf('\n', lib.indexOf('  const REQUEST_CLOSED =')))}\n return REQUEST_CLOSED; })`, {})({ ryagramCredits: C.ryagramCredits });
  assert.equal(said(10, 8), 'A film request costs 10 credits; you have 8 credits. Buying credits is not open yet.');
  assert.equal(said(10, 0), 'A film request costs 10 credits; you have 0 credits. Buying credits is not open yet.');
  assert.equal(said(10, 1), 'A film request costs 10 credits; you have 1 credit. Buying credits is not open yet.');
});

test('HOME: a brand-new account (no projects) is not greeted "Welcome back"; a returning one still is', () => {
  assert.ok(lib.includes("h('p', { class: 'eyebrow' }, projects.length ? 'Welcome back' : 'Welcome')"));
  assert.ok(lib.includes("projects.length ? 'Welcome back. Pick up a film below, or start a new one.' : 'Start your first film below. The first picture is free.'"));
  assert.doesNotMatch(lib, /h\('p', \{ class: 'eyebrow' \}, 'Welcome back'\)/, 'no unconditional Welcome back left');
});

test('ACCOUNT: the "Data you upload" choice only while uploads are on', () => {
  const at = lib.indexOf("h('h2', { id: 'acct-data' }, 'Data you upload')");
  const open = lib.lastIndexOf('      if (uploadsOn()) {\n', at);
  assert.ok(open > 0 && open > lib.lastIndexOf('async function accountView', at), 'the section is inside an uploadsOn() block in the account page');
  assert.ok(lib.indexOf("data.uploadRetention()", open) < at, 'the retention read is inside the block too (no read with uploads off)');
  const close = lib.indexOf('        choiceNote, choiceError));\n      }\n', at);
  assert.ok(close > at, 'the block closes right after the section');
});

test('VERSION PAGE: with uploads off the Advanced tab promises no own data or spreadsheet', () => {
  assert.match(lib, /if \(!uploads\) \{[^\n]*\n\s+advancedEl\.querySelector\('h2'\)\.textContent = 'Advanced: the story file';\n\s+advancedEl\.querySelector\('\.form-note'\)\.textContent = 'Most films start from a ready-made film\. Use this if you want to edit the story file directly\.';/);
  assert.ok(lib.indexOf('if (!uploads) {') > lib.indexOf('const advancedEl ='), 'the retitle runs after the panel is built');
});

test('BUILDER: the dataset tab is "Choose a dataset", not the upload panel\'s name "Your own data"', () => {
  assert.match(builder, /\{ id: 'own', label: 'Choose a dataset', el: dataEl \}/);
  assert.doesNotMatch(builder, /label: 'Your own data'/);
});
