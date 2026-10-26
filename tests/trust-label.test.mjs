// The trust label on EVERY bring-your-own-data upload (RULINGS 2026-10-26, Ryan 09:38, S0): the label 'Unverified, user-supplied', a plain warning, and the person's choice to use it anyway,
// on the confirm screen, on the dataset's card, and on the public film page of a film made from an upload. Fixed text, computed by the page; wording is PLACEHOLDER until Ryan's merge-row OK.
// The page in real Chrome is tools/check-trust.py (needs Chrome). The worker/engine side (receipt line, method note) is ENGINE's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const win = {};
vm.runInNewContext(read('assets/app-uploads.js'), { window: win });
const U = win.ryagramUploads;

test('WORDS: the label is exactly "Unverified, user-supplied"; the warning says Ryagram has not checked the data and that errors in it will be in the film; the box says use it anyway', () => {
  assert.equal(U.TRUST_LABEL, 'Unverified, user-supplied');
  assert.match(U.TRUST_WARNING, /^Ryagram has not checked this data\./);
  assert.match(U.TRUST_WARNING, /wrong in the film/);
  assert.equal(U.TRUST_ACK, 'I understand, use it anyway.');
});

test('CHOICE: using the data needs the box ticked; anything but a real true is a refusal in words', () => {
  assert.equal(U.trustProblem(true), '');
  for (const v of [false, undefined, null, 'true', 1, 'on']) assert.equal(U.trustProblem(v), 'Tick the box to use this data anyway.', String(v));
});

// The guards below read the page source so a later edit that hides or skips the label fails here. `confirmView` is the confirm screen's source; they are applied to a mutant too.
const lib = read('assets/app-library.js').replace(/\r\n/g, '\n');
const guards = src => {
  const mapping = src.slice(src.indexOf('function mappingForm(ds)'), src.indexOf('// What a good file looks like'));
  const problems = [];
  if (!/const trustBox = h\('fieldset', \{ class: 'trust-box' \}/.test(mapping)) problems.push('no trust box is built');
  if (!/values, provBox, trustBox,/.test(mapping)) problems.push('the trust box is not on the confirm screen (or only sits behind another switch)');
  if (/byodGuideOn\(\) \? .*trustBox|trustBox = byodGuideOn/.test(mapping)) problems.push('the trust box depends on byodGuide');
  const ask = mapping.indexOf('U.trustProblem(trust.acked)'), save = mapping.indexOf('data.confirmMapping');
  if (ask < 0 || save < 0 || ask > save) problems.push('the choice is not asked BEFORE the mapping is confirmed');
  if (!/h\('span', \{ class: 'trust-chip' \}, U\.TRUST_LABEL\)/.test(src)) problems.push('the dataset card has no label chip');
  if (!/U\.TRUST_LABEL\)\), h\('p', \{ class: 'trust-warning' \}, U\.TRUST_WARNING\)/.test(mapping)) problems.push('the label and warning are not both shown together');
  return problems;
};

test('GUARD: the confirm screen always has the box, asks before saving, and every uploaded dataset card carries the label', () => {
  assert.deepEqual(guards(lib), []);
});

test('MUST-FAIL: a page with the label hidden, skipped, tied to another switch or asked after saving is caught', () => {
  const noBox = lib.replace('values, provBox, trustBox,', 'values, provBox,');
  assert.ok(guards(noBox).length > 0, 'box removed from the screen');
  const noChip = lib.replace("h('span', { class: 'trust-chip' }, U.TRUST_LABEL), ' ', ", '');
  assert.ok(guards(noChip).length > 0, 'chip removed from the card');
  const noAsk = lib.replace("          const tp = U.trustProblem(trust.acked);\n          if (tp) return showError(note, new Error(tp));\n", '');
  assert.ok(guards(noAsk).length > 0, 'the choice is never asked');
  const switched = lib.replace('values, provBox, trustBox,', 'values, provBox, byodGuideOn() ? trustBox : null,');
  assert.ok(guards(switched).length > 0, 'the box tied to the byodGuide switch');
  const hiddenLabel = lib.replace("h('strong', { id: 'trust-label' }, U.TRUST_LABEL)", "h('strong', { id: 'trust-label', hidden: true }, U.TRUST_LABEL)");
  assert.match(hiddenLabel, /hidden: true/);           // (a hidden attribute is not in the guard's reach; the real-Chrome check reads the visible text instead: tools/check-trust.py)
});

test('FILM PAGE: a film made from an upload says "Unverified, user-supplied" in its sources, with the same words as the app, and a film not made from an upload does not', () => {
  const film = read('assets/film.js');
  assert.match(film, /const TRUST_LABEL = 'Unverified, user-supplied';/);
  assert.equal(film.match(/const TRUST_LABEL = '([^']+)'/)[1], U.TRUST_LABEL);            // the page and the app say the same words
  assert.match(film, /s\.uploaded_data \? h\('p', \{ class: 'film-meta film-trust' \}, h\('strong', \{\}, TRUST_LABEL\), '\. Ryagram has not checked these figures; they are as the film’s maker supplied them\.'\) : null,/);
  assert.equal((film.match(/TRUST_LABEL/g) || []).length, 2);                            // defined once, used once, only under uploaded_data
});

test('WIRING: the stamps moved so a returning visitor gets the new scripts; nothing is shown unless uploads is on (the panel itself is behind it)', () => {
  const html = read('app/index.html');
  assert.match(html, /app-uploads\.js\?v=20261026b/);
  assert.match(html, /app-library\.js\?v=20261026b/);
  assert.match(html, /app\.css\?v=20261026b/);
  assert.match(read('film/index.html'), /film\.js\?v=20261026b/);
  assert.match(read('assets/ryagram-config.js'), /uploads: false,/);
});
