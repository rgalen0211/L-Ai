// Customer step (WEB 11-21): the Files list shows what a customer uses, not the receipt or usage note the render machine keeps. Proved in real Chrome by tools/check-files-plain.py;
// these pin the rule and its words so neither is dropped unseen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const lib = fs.readFileSync(new URL('../assets/app-library.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('FILES: receipt, receipt text and metering are hidden from the list, and only those', () => {
  assert.match(lib, /const HIDDEN_KINDS = \['receipt', 'receipt_text', 'metering'\];/);
  assert.match(lib, /const artifacts = all\.filter\(a => !HIDDEN_KINDS\.includes\(a\.kind\)\);/);
});

test('FILES: what is shown has a plain name, and a kind with no name is never shown raw as "metering"', () => {
  for (const kind of ['final_video', 'preview', 'contact_sheet', 'thumbnail']) assert.match(lib, new RegExp(`${kind}: '[A-Z][a-z]+ ?[a-z]*'`), kind);
});

test('FILES: with nothing left to show the list says nothing is rendered yet', () => {
  assert.match(lib, /'Nothing rendered for this version yet\.'/);
});
