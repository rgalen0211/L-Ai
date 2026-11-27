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
