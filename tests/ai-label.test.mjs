// Ryan 2026-10-18: the public /film/ page and the in-app delivery page carry the SAME label, "AI-assisted (Ryagram)". The Terms/AI-content shells carry no mail address until
// Ryan has confirmed that ryagram@ receives mail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const LABEL = 'AI-assisted (Ryagram)';

test('BOTH PAGES: the delivery page text and the public film page both say AI-assisted (Ryagram)', () => {
  const lib = read('assets/app-library.js'), film = read('assets/film.js');
  assert.ok(lib.includes(`const AI_LABEL = '${LABEL}';`) && film.includes(`const AI_LABEL = '${LABEL}';`), 'the same constant in both');
  assert.ok(lib.includes('`${AI_LABEL}. This film is kept for 30 days'), 'the delivery page uses it');
  assert.ok(film.includes("h('strong', { class: 'film-ai-label' }, AI_LABEL)"), 'the film page shows it beside the player');
  assert.doesNotMatch(lib, /got\.label \|\| 'AI-assisted'/, 'no second spelling on the delivery page');
});

test('NO NEW MAIL ADDRESS: the Terms and AI-content shells name no mail address (Ryan confirms ryagram@ first)', () => {
  for (const p of ['terms/index.html', 'ai-content/index.html']) assert.doesNotMatch(read(p), /ryagram@uselai|mailto:/, p);
});
