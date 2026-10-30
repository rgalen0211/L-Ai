// The trust label on EVERY bring-your-own-data upload (RULINGS 2026-10-26, Ryan 09:38, S0): the label 'Unverified, user-supplied', a plain warning, and the person's choice to use it anyway,
// on the confirm screen, on the dataset's card, and on the public film page of a film made from an upload. Fixed text, computed by the page; the words are Ryan's (Q234).
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
  assert.match(html, /app-data\.js\?v=20261030a/);                    // (data and library moved again with the sign-in landing fix, 2026-10-26 17:3x)
  assert.match(html, /app-library\.js\?v=20261030b/);
  assert.match(html, /app\.css\?v=20261029a/);
  assert.match(read('film/index.html'), /film\.js\?v=20261026b/);
  assert.match(read('assets/ryagram-config.js'), /uploads: false,/);
});

test('APPROVED WORDS (Ryan, Q234, 2026-10-26 13:16): the database id "unverified_user" becomes the words in ONE place; no placeholder note is left on the trust words, and the Q5 placeholders elsewhere are untouched', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(U.TRUST_LABELS)), { unverified_user: 'Unverified, user-supplied' });
  assert.equal(U.trustWords('unverified_user'), 'Unverified, user-supplied');
  assert.equal(U.trustWords('anything_else'), 'Unverified, user-supplied');                 // every upload is unverified_user: an unknown id never reads as better than that
  assert.equal(U.trustWords(undefined), 'Unverified, user-supplied');
  assert.equal(U.TRUST_LABEL, U.trustWords('unverified_user'));
  const up = read('assets/app-uploads.js');
  assert.doesNotMatch(up, /PLACEHOLDER wording: Ryan's and the attorney's final words come in the merge row/);
  assert.equal((up.match(/TRUST_LABELS = \{/g) || []).length, 1, 'the id-to-words map is in one place');
  const mapping = lib.slice(lib.indexOf('function mappingForm(ds)'), lib.indexOf('// What a good file looks like'));
  assert.doesNotMatch(mapping.slice(mapping.indexOf("const trustBox"), mapping.indexOf("trustBox,")), /PLACEHOLDER/);   // the trust box shows no placeholder line
  assert.equal(U.PLACEHOLDER, '[PLACEHOLDER WORDING, pending Ryan and the lawyer]');         // Q5 (source, licence, attestation) stays exactly as it was
  assert.match(U.AS_SUPPLIED, /not checked by Ryagram/);
  assert.match(U.ATTESTATION, /I may publish charts of this data\./);
  assert.match(lib, /h\('p', \{ class: 'form-note prov-placeholder' \}, `\$\{U\.PLACEHOLDER\}/);   // the S5 box still carries its own placeholder
});

test('SERVER CONTRACT (CC1 13:19): the page sends the tick as p_trust_ack; anything but a real true is sent as false; the mock database refuses without it, like the migration', async () => {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const { createFakeClient } = req('./fake-supabase.js');
  const dwin = {};
  for (const f of ['app-data.js', 'app-uploads.js']) vm.runInNewContext(read(`assets/${f}`), { window: dwin, setTimeout, clearTimeout });
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: null, error: null }; } };
  const data = dwin.ryagramData(client);
  await data.confirmMapping('d1', { place_index: 0 }, true);
  await data.confirmMapping('d1', { place_index: 0 }, false);
  await data.confirmMapping('d1', { place_index: 0 });
  await data.confirmMapping('d1', { place_index: 0 }, 'true');
  assert.deepEqual(calls.map(c => c.args.p_trust_ack), [true, false, false, false]);
  assert.ok(calls.every(c => c.name === 'confirm_dataset_mapping' && 'p_trust_ack' in c.args));
  assert.match(lib, /await data\.confirmMapping\(ds\.id, U\.clean\(mapping\), trust\.acked === true\);/);
  // the mock mirrors the migration: refused without a real true, accepted with it
  const fake = createFakeClient({}, {});
  const bad = await fake.rpc('confirm_dataset_mapping', { p_dataset: 'nope', p_mapping: {}, p_trust_ack: false });
  assert.match(bad.error.message, /Dataset not found/);                                 // (the dataset check comes first; the acknowledgement rule is exercised in tests/app-uploads-flow.test.cjs)
});
