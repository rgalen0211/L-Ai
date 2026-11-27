// Wave 8 items a and b (Claude 04:18): the Credits page says plainly what the welcome credits buy (generated from the one source), where held credits show, what happens when they run out; Help answers the six first questions in the app and on /help/. Words FOR RYAN'S YES.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const lib = read('assets/app-library.js'), help = read('help/index.html');
test('CREDITS: a collapsed How credits work block with the generated welcome line, held credits and what happens when they run out', () => {
  assert.ok(lib.includes("h('details', { class: 'credit-guide' }, h('summary', {}, 'How credits work'),"));
  assert.ok(lib.includes('window.ryagramFreeAccountLine.line()'));
  assert.ok(lib.includes('its credits are held: set aside, not spent.'));
  assert.ok(lib.includes('When your credits run out, contact sheets and your free previews still work. More credits are coming soon.'));
  assert.doesNotMatch(lib.slice(lib.indexOf("'credit-guide'"), lib.indexOf("class: 'form-note credit-closed'")), /\$\d|price/i);
});
test('HELP: the same six first questions, in the same words, in the app (First questions tab) and on /help/', () => {
  const Q = ['What is Ryagram?', 'Is it free?', 'How long does a film take?', 'Why does a full film wait for approval?', 'Where is my film?', 'Which data can I use?'];
  for (const q of Q) { assert.ok(lib.includes(`qa('${q}'`), q); assert.ok(help.includes(`<summary>${q}</summary>`), q); }
  assert.ok(lib.includes("{ id: 'first', label: 'First questions', el: answers("));
  for (const w of ['A contact sheet or preview usually takes about 5 minutes and a full film up to about half an hour once it starts.', 'We do not send an email when a film is ready']) { assert.ok(lib.includes(w), w); assert.ok(help.includes(w), w); }
});
test('CONNECT WALK (11-27): the Claude / ChatGPT steps on the Account page show a plus (minus when open) so a closed heading reads as a button', () => {
  const css = read('assets/app.css');
  assert.match(css, /\.connect-app>summary::before\{content:"\+"/);
  assert.match(css, /\.connect-app\[open\]>summary::before\{content:"\\2212"\}/);
});
test('HELP ORDER (FACES 04:45 LOW 2): First questions is the first tab and the opening one; the form is the second tab and opens first when the person came from a film (job in the address)', () => {
  const i = lib.indexOf("id: 'first', label: 'First questions'"), w = lib.indexOf("id: 'write', label: 'Write to us'"), f = lib.indexOf("id: 'films', label: 'Films and credits'");
  assert.ok(i > 0 && i < w && w < f);
  assert.ok(lib.includes("label: 'Help', address: false, initial: job ? 'write' : 'first', sections: ["));
});
