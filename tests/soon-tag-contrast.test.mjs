// 'Coming soon' tags (.soon-tag) must read at 4.5:1 or better in every case. A phone check (CC1, 11-23) saw them at 2.25:1: the text colour was a
// fallback wheat (#c9a66b) over whatever the scan found behind it (nothing: white). So every .soon-tag rule that sets a colour sets, in the same rule,
// a PLAIN HEX colour and a PLAIN HEX solid background (no var(), no color-mix, no rgba, no opacity), and the pair must pass 4.5:1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const lum = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const HEX = /^#[0-9a-fA-F]{6}$/;

// every `...soon-tag{...}` rule (not -big, not descendants) in the file's text
export function tagRules(css) {
  return [...css.matchAll(/(?:^|[},\s])([^{}]*\.soon-tag)\{([^}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));
}
export function check(css) {
  const problems = [];
  const rules = tagRules(css).filter(r => /(^|[;\s])color:/.test(r.body) || /background:/.test(r.body));
  if (!rules.length) problems.push('no .soon-tag rule with a colour');
  for (const r of rules) {
    const color = (r.body.match(/(?:^|[;\s])color:([^;]+)/) || [])[1]?.trim();
    const bg = (r.body.match(/(?:^|[;\s])background:([^;]+)/) || [])[1]?.trim();
    if (!color || !HEX.test(color)) { problems.push(`${r.sel}: colour is not a plain hex (${color})`); continue; }
    if (!bg || !HEX.test(bg)) { problems.push(`${r.sel}: background is not a plain solid hex (${bg})`); continue; }
    const n = ratio(color, bg);
    if (n < 4.5) problems.push(`${r.sel}: ${color} on ${bg} is ${n.toFixed(2)}:1`);
    if (/opacity:\s*(0?\.\d+)/.test(r.body)) problems.push(`${r.sel}: opacity under 1`);
  }
  return problems;
}

test('every .soon-tag rule in app.css and ryagram-ds.css is a plain hex pair at 4.5:1 or better', () => {
  for (const f of ['assets/app.css', 'assets/ryagram-ds.css']) {
    const css = read(f);
    assert.ok(tagRules(css).length >= 1, `${f} has a .soon-tag rule`);
    assert.deepEqual(check(css), [], f);
  }
});

test('the pair actually used reads at 10:1 or better', () => {
  assert.ok(ratio('#ffb27a', '#10121a') >= 10);
});

test('MUST-FAIL: a low-contrast pair, a var() colour, a missing background and a translucent background are caught', () => {
  const ok = '.soon-tag{color:#ffb27a;background:#10121a}';
  assert.deepEqual(check(ok), []);
  assert.match(check('.soon-tag{color:#555555;background:#10121a}')[0], /:1/);
  assert.match(check('.soon-tag{color:var(--wheat,#c9a66b);background:#10121a}')[0], /not a plain hex/);
  assert.match(check('.soon-tag{color:#ffb27a}')[0], /background is not/);
  assert.match(check('.soon-tag{color:#ffb27a;background:rgba(0,0,0,.1)}')[0], /background is not/);
  assert.match(check('.soon-tag{color:#c9a66b;background:#ffffff}')[0], /2\.\d\d:1/);
  assert.match(check('.soon-tag{color:#ffb27a;background:#10121a;opacity:.6}')[0], /opacity/);
});
