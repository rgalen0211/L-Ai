// The draw-and-return probe (connect-core/drawtest.ts): can a host's AI hand a picture back through a tool, and how big?
// Every refusal here has a case that FAILS if the refusal is removed. Hostile client assumed: its claims are recorded as claims.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { makeCompile } from '../supabase/functions/connect-core/ajv_adapter.ts';
import { callTool } from '../supabase/functions/connect-core/dispatch.ts';
import { TOOLS } from '../supabase/functions/connect-core/tools.ts';
import { FakeWorld } from '../supabase/functions/connect-core/fake.ts';
import { handleMcp } from '../supabase/functions/connect-core/mcp.ts';
import { LIMITS } from '../supabase/functions/connect-core/types.ts';
import { DRAW_LIMITS, ECHO_TIERS, enableDrawTest, noisePng, toBase64, fromBase64, sniffImage, checkSvg, sha256 } from '../supabase/functions/connect-core/drawtest.ts';

const compile = makeCompile(Ajv2020);
const A = { tokenHash: 'h-alice', userId: 'u-alice', clientId: 'client-chatgpt' };
const B = { tokenHash: 'h-bob', userId: 'u-bob', clientId: 'client-chatgpt' };
const before = TOOLS.length;
enableDrawTest(); enableDrawTest();                                  // twice: idempotent

function world({ readOnly = false } = {}) {
  const w = new FakeWorld();
  w.addUser(A.userId, 'alice@example.test'); w.addUser(B.userId, 'bob@example.test');
  w.invite(A.userId, A.clientId, readOnly ? ['read'] : undefined); w.invite(B.userId, B.clientId);
  const env = (p, strip = false) => ({ data: strip ? { ...w.data(p.userId), drawTest: undefined } : w.data(p.userId), policy: w.policy(), deps: { compile } });
  const call = (p, name, args, strip = false) => callTool(name, args, p, env(p, strip));
  return { w, call };
}
const base64Of = (text) => text.split('\n').pop();
const startEcho = async (call, tier = 'S', p = A) => { const r = await call(p, 'draw_test_start', { mode: 'echo', tier }); assert.equal(r.isError ?? false, false, r.text); return { nonce: r.data.nonce, b64: base64Of(r.text), bytes: r.data.bytes }; };
const startDraw = async (call, p = A) => { const r = await call(p, 'draw_test_start', { mode: 'draw' }); assert.equal(r.isError ?? false, false, r.text); return r.data.nonce; };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="g"/></defs><path d="M1 1L9 9" fill="url(#g)"/></svg>';

test('the registry gains exactly two tools, once, and they are write-scope and honest about it', () => {
  assert.equal(TOOLS.length, before + 2);
  for (const n of ['draw_test_start', 'draw_test_submit']) { const t = TOOLS.find((x) => x.name === n); assert.equal(t.scope, 'write'); assert.equal(t.readOnly, false); assert.equal(t.inputSchema.additionalProperties, false); }
});

test('echo: a faithful copy passes at every tier, and the sizes are what the tiers say', async () => {
  const { call, w } = world();
  for (const tier of ['S', 'M', 'L']) {
    const s = await startEcho(call, tier);
    const bytes = fromBase64(s.b64);
    assert.equal(bytes.length, s.bytes);
    assert.equal(sniffImage(bytes).width, ECHO_TIERS[tier]);
    const r = await call(A, 'draw_test_submit', { nonce: s.nonce, image_base64: s.b64, how_made: 'copied_from_tool', host_name: 'ChatGPT', model_name: 'test' });
    assert.match(r.text, /^PASS/); assert.equal(r.data.exact_match, true);
  }
  assert.deepEqual(w.drawResults.map((x) => x.tier), ['S', 'M', 'L']);
  assert.ok(w.drawResults.every((x) => x.clientId === A.clientId && x.outcome === 'pass' && x.image));
});

test('MUST-FAIL: one changed byte in an echo is caught, and the first differing byte is reported', async () => {
  const { call, w } = world();
  const s = await startEcho(call, 'M');
  const b = fromBase64(s.b64); const at = 5000; b[at] ^= 1;
  const r = await call(A, 'draw_test_submit', { nonce: s.nonce, image_base64: toBase64(b) });
  assert.match(r.text, /^FAIL/); assert.equal(r.data.exact_match, false); assert.equal(r.data.first_diff_byte, at);
  assert.equal(w.drawResults[0].outcome, 'fail'); assert.equal(w.drawResults[0].image, undefined, 'a failed picture is not kept');
});

test('MUST-FAIL: a truncated copy, a copy with words added, and a redrawn picture each fail an echo', async () => {
  const { call } = world();
  for (const mutate of [(b) => b.slice(0, b.length - 300), (b) => `Here is the image: ${b}`, (b) => toBase64(noisePng(16, 99))]) {
    const s = await startEcho(call, 'S');
    const r = await call(A, 'draw_test_submit', { nonce: s.nonce, image_base64: mutate(s.b64) });
    assert.match(r.text, /^FAIL/);
  }
});

test('a nonce works once, only for the person it was issued to, and not after it expires', async () => {
  const { call, w } = world();
  const s = await startEcho(call);
  const other = await call(B, 'draw_test_submit', { nonce: s.nonce, image_base64: s.b64 });
  assert.equal(other.code, 'bad_nonce'); assert.equal(w.drawResults.length, 0, "MUST-FAIL: another person's nonce records nothing");
  assert.match((await call(A, 'draw_test_submit', { nonce: s.nonce, image_base64: s.b64 })).text, /^PASS/);
  assert.equal((await call(A, 'draw_test_submit', { nonce: s.nonce, image_base64: s.b64 })).code, 'bad_nonce', 'MUST-FAIL: a second use is refused');
  const s2 = await startEcho(call); w.drawIssues.get(s2.nonce).issuedAt -= (DRAW_LIMITS.nonceMinutes + 1) * 60000;
  assert.equal((await call(A, 'draw_test_submit', { nonce: s2.nonce, image_base64: s2.b64 })).code, 'bad_nonce', 'MUST-FAIL: an expired nonce is refused');
  assert.equal((await call(A, 'draw_test_submit', { nonce: 'a'.repeat(24), image_base64: s.b64 })).code, 'bad_nonce');
  assert.equal((await call(A, 'draw_test_submit', { nonce: 'not-a-nonce', image_base64: s.b64 })).code, 'args');
});

test('draw: a real PNG passes with its true size; the picture is judged by its bytes, not by the AI\'s claims', async () => {
  const { call, w } = world();
  let n = await startDraw(call);
  const r = await call(A, 'draw_test_submit', { nonce: n, image_base64: toBase64(noisePng(40, 7)), how_made: 'image_generator', host_name: 'ChatGPT', model_name: 'gpt-image' });
  assert.match(r.text, /^PASS/); assert.equal(r.data.width, 40); assert.equal(r.data.kind, 'png');
  const row = w.drawResults[0]; assert.equal(row.claimedHost, 'ChatGPT'); assert.equal(row.howMade, 'image_generator'); assert.equal(row.sha256, await sha256(row.image));
  const bad = [['text claiming to be a picture', toBase64(new TextEncoder().encode('this is a lovely picture of Pip'))],
               ['random bytes', toBase64(Uint8Array.from({ length: 400 }, (_, i) => (i * 37) & 255))],
               ['a GIF', toBase64(new TextEncoder().encode('GIF89a' + 'x'.repeat(100)))]];
  for (const [why, b64] of bad) { n = await startDraw(call); assert.match((await call(A, 'draw_test_submit', { nonce: n, image_base64: b64 })).text, /^FAIL/, `MUST-FAIL: ${why}`); }
});

test('draw: a JPEG is recognised and sized; a picture that claims a huge size or is too large is refused', async () => {
  const { call } = world();
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0, 48, 0, 64, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
  assert.deepEqual([sniffImage(jpeg).kind, sniffImage(jpeg).width, sniffImage(jpeg).height], ['jpeg', 64, 48]);
  let n = await startDraw(call);
  assert.match((await call(A, 'draw_test_submit', { nonce: n, image_base64: toBase64(jpeg) })).text, /^PASS/);
  const huge = noisePng(8, 1); new DataView(huge.buffer).setUint32(16, 9000); new DataView(huge.buffer).setUint32(20, 9000);
  n = await startDraw(call);
  assert.match((await call(A, 'draw_test_submit', { nonce: n, image_base64: toBase64(huge) })).text, /FAIL.*limit is 4096/, 'MUST-FAIL: 9000 x 9000');
  n = await startDraw(call);
  const big = new Uint8Array(DRAW_LIMITS.maxImageBytes + 1000); big.set(noisePng(8, 2));
  const r = await call(A, 'draw_test_submit', { nonce: n, image_base64: toBase64(big) });
  assert.ok(r.isError || /^FAIL/.test(r.text), 'MUST-FAIL: over the size limit is refused (by the schema or by the check)');
});

test('SVG: plain vector text passes; anything that could run, load or be a trap fails', async () => {
  assert.equal(checkSvg(SVG), '');
  const traps = {
    script: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    handler: '<svg xmlns="http://www.w3.org/2000/svg"><rect onload="x()" width="1" height="1"/></svg>',
    external_image: '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.test/a.png"/></svg>',
    xlink: '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="https://evil.test/x.svg#a"/></svg>',
    css_url: '<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://evil.test/p)" width="1" height="1"/></svg>',
    css_import: '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "https://evil.test/a.css";</style></svg>',
    entity: '<!DOCTYPE svg [<!ENTITY a "boom">]><svg xmlns="http://www.w3.org/2000/svg"/>',
    foreign: '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div/></foreignObject></svg>',
    not_svg: '<html><body>hi</body></html>',
    huge: SVG + ' '.repeat(DRAW_LIMITS.maxSvgBytes),
  };
  for (const [k, t] of Object.entries(traps)) assert.notEqual(checkSvg(t), '', `MUST-FAIL: ${k}`);
  const { call, w } = world();
  let n = await startDraw(call);
  assert.match((await call(A, 'draw_test_submit', { nonce: n, svg_text: SVG, how_made: 'svg_by_hand' })).text, /^PASS/);
  n = await startDraw(call);
  assert.match((await call(A, 'draw_test_submit', { nonce: n, svg_text: traps.script })).text, /^FAIL/);
  const e = await startEcho(call);
  assert.match((await call(A, 'draw_test_submit', { nonce: e.nonce, svg_text: SVG })).text, /^FAIL.*cannot answer an echo/, 'SVG cannot pass an echo test');
  assert.equal(w.drawResults.filter((x) => x.outcome === 'pass').length, 1);
});

test('"I cannot send a picture" is a recorded answer, not an error; both a picture and SVG is refused', async () => {
  const { call, w } = world();
  let n = await startDraw(call);
  const r = await call(A, 'draw_test_submit', { nonce: n, note: 'I have no way to attach files from this chat' });
  assert.equal(r.isError ?? false, false); assert.match(r.text, /^FAIL.*cannot hand a picture back/);
  assert.equal(w.drawResults[0].kind, 'none');
  n = await startDraw(call);
  assert.match((await call(A, 'draw_test_submit', { nonce: n, svg_text: SVG, image_base64: toBase64(noisePng(8, 3)) })).text, /^FAIL.*Both/);
});

test('claims are cleaned and recorded as claims; the client id comes from the token; extra fields and keys are refused', async () => {
  const { call, w } = world();
  const n = await startDraw(call);
  await call(A, 'draw_test_submit', { nonce: n, image_base64: toBase64(noisePng(8, 4)), host_name: 'Chat\nGPT <script>', model_name: 'm'.repeat(60), how_made: 'other' });
  const row = w.drawResults[0];
  assert.doesNotMatch(row.claimedHost, /[<>\n]/);                                    // control characters and angle brackets are gone
  assert.equal(row.claimedHost, 'ChatGPT script');
  assert.equal(row.clientId, A.clientId);
  const n2 = await startDraw(call);
  const forged = await call(A, 'draw_test_submit', { nonce: n2, client_id: 'client-claude' });
  assert.equal(forged.code, 'args', 'MUST-FAIL: a client id cannot be supplied in the call');
  const key = await call(A, 'draw_test_submit', { nonce: n2, note: 'sk-abc', api_key: 'sk-abc' });
  assert.equal(key.code, 'args');
});

test('off by default and gated: no store means not_enabled; a read-only connection cannot use it; daily limits hold', async () => {
  const { call } = world();
  assert.equal((await call(A, 'draw_test_start', { mode: 'draw' }, true)).code, 'not_enabled', 'MUST-FAIL: without a store the tool does nothing');
  const ro = world({ readOnly: true });
  assert.equal((await ro.call(A, 'draw_test_start', { mode: 'draw' })).code, 'scope');
  const lim = world();
  for (let i = 0; i < DRAW_LIMITS.startsPerDay; i++) assert.equal((await lim.call(A, 'draw_test_start', { mode: 'draw' })).isError ?? false, false);
  assert.equal((await lim.call(A, 'draw_test_start', { mode: 'draw' })).code, 'rate', 'MUST-FAIL: the 21st start in a day is refused');
});

test('over MCP: the tools are listed, an echo round trip works, and the biggest allowed picture fits the body limit', async () => {
  const { w, call } = world();
  const deps = { ...{ data: w.data(A.userId), policy: w.policy(), deps: { compile } }, verifyToken: w.verifyToken, dataFor: (t, p) => w.data(p.userId), resourceMetadataUrl: 'https://x.test/m' };
  w.issue('tok-a', A);
  const post = (body) => handleMcp(new Request('https://x.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer tok-a' }, body: JSON.stringify(body) }), deps);
  const list = await (await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).json();
  assert.ok(list.result.tools.some((t) => t.name === 'draw_test_start') && list.result.tools.some((t) => t.name === 'draw_test_submit'));
  const st = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'draw_test_start', arguments: { mode: 'echo', tier: 'L' } } })).json();
  const nonce = st.result.structuredContent.nonce; const b64 = base64Of(st.result.content[0].text);
  const sub = await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'draw_test_submit', arguments: { nonce, image_base64: b64, host_name: 'sdk-test' } } })).json();
  assert.match(sub.result.content[0].text, /^PASS/);
  const bigBytes = DRAW_LIMITS.maxImageBytes; const buf = new Uint8Array(bigBytes); buf.set(noisePng(8, 5));
  const n2 = await startDraw(call);                                                    // (same world, other nonce store view)
  const body = JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'draw_test_submit', arguments: { nonce: n2, image_base64: toBase64(buf) } } });
  assert.ok(body.length < LIMITS.maxBodyBytes, `a maximum-size submit (${body.length} bytes) fits the ${LIMITS.maxBodyBytes} byte body limit`);
});
