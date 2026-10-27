// BUILDER's text layout (assets/preview/text-layout.js, NEXT-BUILDER 24) is vendored, pinned and drawing-only, and on the rules the maker serves it places the three styles inside the
// safe box and clear of every keep-out rectangle, or refuses in words. (The pixel parity with the engine is BUILDER's test; here the page's use of it is proved.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = p => fs.readFileSync(path.join(here, '..', p));
const bytes = read('assets/preview/text-layout.js');
const pin = read('assets/preview/text-layout.PIN').toString('utf8');
const rules = JSON.parse(read('tests/fixtures/text-rules-1280x720.json').toString('utf8'));

function lib() {
  const ctx = { Math, Number, String, Object, Array, JSON, Error, isFinite };
  ctx.globalThis = ctx;
  vm.runInNewContext(bytes.toString('utf8'), ctx);
  return ctx.RyagramText;
}
const canvas = () => ({ font: '', measureText(t) { const px = Number(this.font.match(/(\d+)px/)[1]); return { width: t.length * px * 0.5 }; } });

test('the pin names the engine commit and the hash of the file as vendored; LF only; drawing only', () => {
  assert.match(pin, /Ryagram branch textstyles @ [0-9a-f]{7,}/);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), pin.match(/sha256 ([0-9a-f]{64})/)[1]);
  assert.equal(String(bytes.length), pin.match(/\n(\d+) bytes, LF/)[1]);
  assert.ok(!bytes.includes(13));
  const text = bytes.toString('utf8');
  for (const word of ['fetch(', 'XMLHttpRequest', 'WebSocket', 'localStorage', 'document.', 'eval(', 'new Function', 'import(', 'navigator.']) assert.ok(!text.includes(word), `contains ${word}`);
});

test('the three styles land inside the safe box and clear of every keep-out; a too-long text is refused in the maker\'s words', () => {
  const L = lib();
  for (const [style, text] of [['title', 'Housing, 2019 to 2024'], ['caption', 'nobody saw that coming'], ['lower_third', 'Obesity rate by state']]) {
    const r = L.layout(rules, text, style, canvas());
    const [x0, y0, x1, y1] = r.box, safe = rules.safe;
    assert.ok(x0 >= safe[0] && y0 >= safe[1] && x1 <= safe[2] && y1 <= safe[3], `${style} inside the safe box`);
    for (const k of rules.keep_out) {
      const [a, b, c, d] = k.rect;
      assert.ok(x1 <= a || x0 >= c || y1 <= b || y0 >= d, `${style} clear of ${k.name}`);
    }
  }
  assert.ok(L.layout(rules, 'Top', 'title', canvas()).box[1] < L.layout(rules, 'Bottom', 'caption', canvas()).box[1], 'a title sits above a caption');
  assert.throws(() => L.layout(rules, 'x'.repeat(400), 'title', canvas()), /too long for a title here/);
  assert.throws(() => L.layout(rules, 'x', 'banner', canvas()), /title, a caption or a lower third/);
});
