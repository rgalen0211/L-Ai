// Wave 8 (Claude 03:22): the delivery page says Download and offers Make another film; a brand-new account's empty Your films has ONE clear first step. Words FOR RYAN'S YES.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const lib = fs.readFileSync(new URL('../assets/app-library.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
test('DELIVERY: a Download button (primary) and a Make another film button (secondary, to the builder) sit with the player', () => {
  assert.ok(lib.includes("h('a', { class: 'button primary', href: got.url, rel: 'noopener noreferrer', target: '_blank', download: '' }, 'Download the film')"));
  assert.ok(lib.includes("h('a', { class: 'button secondary', href: '#/build', id: 'delivery-another' }, 'Make another film')"));
  assert.ok(!lib.includes("'Open or download'"));
});
test('EMPTY STATE: no films yet says the first picture is free and gives ONE button to the ready-made films', () => {
  assert.ok(lib.includes("'No films yet. Your first picture is free.'"));
  assert.ok(lib.includes("h('a', { class: 'button primary', href: '#/build', id: 'empty-first-film' }, 'Pick a ready-made film')"));
});
test('FACES PHONE WALK (11-27): Files has no inner scroll box; the delivery not-found says why and gives a button; the ghost hero picture is off on a phone; in-sentence links get a 44 px target', () => {
  assert.ok(lib.includes("{ id: 'files', label: 'Files', el: h('div', {}, files.el) },"));
  assert.ok(lib.includes("We can\u2019t find that film. It may have expired (films are kept 30 days) or belong to another account."));
  assert.ok(lib.includes("h('a', { class: 'button primary', href: '#/', id: 'delivery-home' }, 'Open your projects')"));
  const css = fs.readFileSync(new URL('../assets/app-pages-ds.css', import.meta.url), 'utf8');
  assert.match(css, /@media\(max-width:700px\)\{\.page-hero \.hero-frame\{display:none\}\}/);
  assert.match(css, /\.help-answers p a,\.home-more p a,\.credit-balance a\{display:inline-block;padding:11px 0;margin:-11px 0\}/);
});
