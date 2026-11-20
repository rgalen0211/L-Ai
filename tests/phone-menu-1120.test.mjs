// The departments menu on a phone (GAMES 11-20 phone-375 walk of web-site-1120): the open menu is ONE column that scrolls, never a
// second column. With flex-wrap:wrap inside max-height:75vh, a list of ten items wrapped Credits, Help and Account into a column past
// the right edge of a 375 px screen, so a phone could not reach Help or Account at all. Source checks over assets/app.css, each proved
// able to fail on a copy with the fault put back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const CSS = fs.readFileSync(new URL('../assets/app.css', import.meta.url), 'utf8');
const openRules = css => [...css.matchAll(/([^{}]*\.dept-bar\.open \.dept-list)\{([^}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));
const scrollsNotWraps = r => /flex-wrap:\s*nowrap/.test(r.body) && /overflow-y:\s*auto/.test(r.body) && /max-height/.test(r.body);

test('every open departments menu (phone, and the tablet layout with the Admin link) scrolls in one column, it never wraps', () => {
  const rules = openRules(CSS);
  assert.ok(rules.length >= 2, `found ${rules.length} open-menu rules`);
  assert.deepEqual(rules.filter(r => !scrollsNotWraps(r)).map(r => r.sel), []);
});

test('MUST-FAIL: the same check notices the wrap put back', () => {
  const broken = CSS.replace('.dept-bar.open .dept-list{display:flex;flex-wrap:nowrap;', '.dept-bar.open .dept-list{display:flex;');
  assert.notEqual(broken, CSS, 'the fault was planted');
  assert.equal(openRules(broken).filter(r => !scrollsNotWraps(r)).length, 1);
});
