// WEB 2026-11-13 (Ryan: polish My films and #/new): My films' meta line never starts with a stray dot, and the intake's choice cards are left-aligned choices with a Coming soon tag. Offline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('My films: the version and date line joins what it has, so a film with no version shows no orphan dot', () => {
  const src = read('assets/app-films.js');
  assert.match(src, /\[r\.version \? `Version \$\{r\.version\}` : '', r\.updated \? `updated \$\{date\(r\.updated\)\}` : ''\]\.filter\(Boolean\)\.join\(' · '\)/);
  assert.ok(!/` · Version/.test(src) && !/` · updated/.test(src), 'no template starts with a dot');
});

test('#/new: the choice cards are left-aligned, large enough to read, show a focus and hover state, and the Coming soon mark is a tag', () => {
  const css = read('assets/app.css');
  assert.match(css, /\.intake \.builder-card\.intake-choice\{text-align:left;/);
  assert.match(css, /\.intake \.intake-choice:hover,\.intake \.intake-choice:focus-visible\{/);
  assert.match(css, /\.intake \.intake-choice \.intake-soon\{[^}]*border-radius:999px/);
  assert.match(read('app/index.html'), /app\.css\?v=20261113a/);
});
