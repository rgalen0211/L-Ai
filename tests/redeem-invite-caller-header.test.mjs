// CLOUD-SITE 11-03 (final round): which header names the caller for redeem-invite's guess limit is a fact about the platform, checked once on the real project
// (docs/REDEEM-INVITE-HEADER-CHECK.md). The default (no setting) is unchanged; REDEEM_CALLER_HEADER picks another rule only if that check says so. OFF unless needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handle, callerIp, CALLER_MODES } from '../supabase/functions/redeem-invite/redeem.ts';

const H = (o) => new Headers(o);
const FORGED = '203.0.113.99', REAL = '198.51.100.7', PROXY = '10.0.0.1';

test('default (unset, empty, or an unknown value): cf-connecting-ip, else the LAST X-Forwarded-For hop; a forged first hop never counts', () => {
  for (const mode of [undefined, '', '  ', 'default', 'X-Forwarded-For', 'first']) {
    assert.equal(callerIp(H({ 'cf-connecting-ip': REAL, 'x-forwarded-for': `${FORGED}, ${PROXY}` }), mode), REAL, String(mode));
    assert.equal(callerIp(H({ 'x-forwarded-for': `${FORGED}, ${REAL}` }), mode), REAL, String(mode));
    assert.equal(callerIp(H({}), mode), 'unknown');
  }
});

test('cf-connecting-ip: only that header (for a gateway that does not append to X-Forwarded-For)', () => {
  assert.equal(callerIp(H({ 'cf-connecting-ip': REAL, 'x-forwarded-for': FORGED }), 'cf-connecting-ip'), REAL);
  assert.equal(callerIp(H({ 'x-forwarded-for': `${FORGED}, ${REAL}` }), 'cf-connecting-ip'), 'unknown', 'X-Forwarded-For is never used in this mode');
});

test('x-real-ip: only that header (first value)', () => {
  assert.equal(callerIp(H({ 'x-real-ip': REAL, 'cf-connecting-ip': FORGED, 'x-forwarded-for': FORGED }), 'x-real-ip'), REAL);
  assert.equal(callerIp(H({ 'cf-connecting-ip': FORGED }), 'X-Real-IP'), 'unknown', 'the mode is read without case');
});

test('xff-last: only the last X-Forwarded-For hop (for a platform that passes a client-sent cf-connecting-ip through)', () => {
  assert.equal(callerIp(H({ 'cf-connecting-ip': FORGED, 'x-forwarded-for': `${FORGED}, ${REAL}` }), 'xff-last'), REAL);
  assert.equal(callerIp(H({ 'cf-connecting-ip': FORGED }), 'xff-last'), 'unknown');
  assert.deepEqual([...CALLER_MODES], ['cf-connecting-ip', 'x-real-ip', 'xff-last']);
});

test('wired: the handler hashes the address the mode picks; rotating the forged header gives one caller in every mode', async () => {
  for (const mode of [undefined, ...CALLER_MODES]) {
    const hashes = new Set();
    for (const f of ['1.1.1.1', '2.2.2.2', '3.3.3.3']) {
      let got = null;
      const deps = { allowedOrigins: ['https://uselai.com'], siteUrl: 'https://uselai.com', callerHeader: mode,
        reserve: async (_c, _e, ipHash) => { got = ipHash; return { ok: false, reason: 'invalid' }; }, sent: async () => {}, release: async () => {}, invite: async () => ({ userId: null }) };
      // the forged value goes where a client can write it in each mode's world; the real address where the platform puts it
      const headers = mode === 'xff-last' ? { 'cf-connecting-ip': f, 'x-forwarded-for': `${f}, ${REAL}` } : mode === 'x-real-ip' ? { 'x-real-ip': REAL, 'x-forwarded-for': f, 'cf-connecting-ip': f }
        : mode === 'cf-connecting-ip' ? { 'cf-connecting-ip': REAL, 'x-forwarded-for': f } : { 'x-forwarded-for': `${f}, ${REAL}` };
      await handle(new Request('https://x.supabase.co/functions/v1/redeem-invite', { method: 'POST', headers: { origin: 'https://uselai.com', 'content-type': 'application/json', ...headers }, body: JSON.stringify({ code: 'RYA-AAAA-BBBB', email: 'a@b.example' }) }), deps);
      assert.match(got, /^[0-9a-f]{64}$/); hashes.add(got);
    }
    assert.equal(hashes.size, 1, String(mode));
  }
});

test('OFF unless needed: index.ts reads REDEEM_CALLER_HEADER and passes it, defaulting to empty (the default rule); nothing else reads it', () => {
  const idx = fs.readFileSync(new URL('../supabase/functions/redeem-invite/index.ts', import.meta.url), 'utf8');
  assert.match(idx, /callerHeader: Deno\.env\.get\("REDEEM_CALLER_HEADER"\) \?\? ""/);
  const doc = fs.readFileSync(new URL('../docs/REDEEM-INVITE-HEADER-CHECK.md', import.meta.url), 'utf8');
  for (const m of CALLER_MODES) assert.ok(doc.includes(m), `the check doc names ${m}`);
});
