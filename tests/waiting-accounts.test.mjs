// CLOUD-SITE 11-04: Ryan's WAITING accounts (real accounts locked in a 'waiting' state; the server side is CONNECT's and does not exist yet). The SQL half is
// supabase/tests/test_waiting_gate.py (every app function, uploads, credits, connector sign-in; skipped until the gate exists). This file is the edge-function half:
// checkout (stripe-checkout), the desktop download (app-download) and film links (get-delivery-url) each call a database function as the service role for the person, and
// the gate refuses a waiting owner THERE. Two kinds of case:
//   - RUN NOW: whatever the refusal looks like, nothing is handed out: no Stripe session, no download link, no film link (true today; keeps it true);
//   - SKIPPED UNTIL THE GATE EXISTS: the person is told in the database's own words with a 403, never "Stripe didn't answer" or "try again in a minute" (today a 42501 becomes
//     a 502 in stripe-checkout and a 500 in app-download). The gate's error code is CONNECT's choice: PT403 already reaches the person in app-download; stripe-checkout passes
//     no database sentence through at all yet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle as checkout } from '../supabase/functions/stripe-checkout/checkout.ts';
import { handle as download } from '../supabase/functions/app-download/core.ts';
import { handle as deliver } from '../supabase/functions/get-delivery-url/deliver.ts';

const SKIP = 'skipped until the waiting-account gate exists (CONNECT, Ryan 11-04): its error code and sentence are not decided yet; these say what a waiting person must be told';
const WAITING = Object.assign(new Error('Your account is on the waiting list. We will email you when it opens.'), { code: process.env.WAITING_GATE_CODE || 'PT403' });
const ORIGIN = 'https://uselai.com', USER = { id: '00000000-0000-4000-8000-000000000401', clientId: null };
const post = (fn, deps, body) => fn(new Request('https://x.supabase.co/functions/v1/f', { method: 'POST', headers: { origin: ORIGIN, authorization: 'Bearer user-jwt', 'content-type': 'application/json' }, body: JSON.stringify(body) }), deps);

function checkoutDeps(calls) {
  return { allowedOrigins: [ORIGIN], siteUrl: ORIGIN, keyIsTest: true, verifyUser: async () => USER,
    context: async () => { calls.push('context'); throw WAITING; }, setCustomer: async () => { calls.push('setCustomer'); },
    stripe: async (p) => { calls.push(`stripe:${p}`); return { url: 'https://checkout.stripe.com/x', id: 'cs_1' }; } };
}
function downloadDeps(calls) {
  return { allowedOrigins: [ORIGIN], configured: () => true, verifyUser: async () => USER,
    request: async () => { calls.push('request'); throw WAITING; }, presign: async () => { calls.push('presign'); return 'https://r2.example/signed'; } };
}
function deliverDeps(calls) {
  return { allowedOrigins: [ORIGIN], verifyUser: async () => USER, objectFor: async () => { calls.push('objectFor'); throw WAITING; },
    compilationFor: async () => { calls.push('compilationFor'); throw WAITING; }, sign: async () => { calls.push('sign'); return 'https://x.supabase.co/signed'; } };
}

// ------------------------------------------------------------------------------------------------ RUN NOW: nothing is handed out
test('WAITING (runs now): when the gate refuses, checkout opens no Stripe session and saves no customer, whatever the code', async () => {
  for (const code of ['PT403', '42501', 'P0001']) {
    const calls = []; WAITING.code = code;
    const r = await post(checkout, checkoutDeps(calls), { action: 'checkout', price_code: 'pack_small' });
    assert.ok(r.status >= 400, code); assert.deepEqual(calls, ['context'], code);
    const t = await r.text(); assert.ok(!/checkout\.stripe\.com|cs_/.test(t), code);
  }
  WAITING.code = process.env.WAITING_GATE_CODE || 'PT403';
});

test('WAITING (runs now): when the gate refuses, the desktop download signs no link, and film delivery signs no link', async () => {
  for (const code of ['PT403', '42501']) {
    WAITING.code = code;
    const c1 = []; const r1 = await post(download, downloadDeps(c1), { kind: 'app' });
    assert.ok(r1.status >= 400, code); assert.ok(!c1.includes('presign'), code); assert.ok(!(await r1.text()).includes('r2.example'), code);
    const c2 = []; const r2 = await post(deliver, deliverDeps(c2), { id: '00000000-0000-4000-8000-000000000999' });
    assert.ok(r2.status >= 400, code); assert.ok(!c2.includes('sign'), code); assert.ok(!(await r2.text()).includes('signed'), code);
  }
  WAITING.code = process.env.WAITING_GATE_CODE || 'PT403';
});

// ------------------------------------------------------------------------------------------------ SKIPPED UNTIL THE GATE: the person is told why
test('WAITING (skipped until the gate): checkout tells a waiting person why, with a 403 and the database\'s sentence, never "Stripe didn\'t answer"', { skip: SKIP }, async () => {
  const r = await post(checkout, checkoutDeps([]), { action: 'checkout', price_code: 'pack_small' });
  assert.equal(r.status, 403); const j = await r.json();
  assert.equal(j.error, WAITING.message); assert.doesNotMatch(j.error, /Stripe/);
});

test('WAITING (skipped until the gate): the desktop download tells a waiting person why, with a 403 and the database\'s sentence', { skip: SKIP }, async () => {
  const r = await post(download, downloadDeps([]), { kind: 'app' });
  assert.equal(r.status, 403); assert.equal((await r.json()).error, WAITING.message);
});

test('WAITING (skipped until the gate): film delivery tells a waiting person why (403), not "Film not found"', { skip: SKIP }, async () => {
  const r = await post(deliver, deliverDeps([]), { id: '00000000-0000-4000-8000-000000000999' });
  assert.equal(r.status, 403); assert.equal((await r.json()).error, WAITING.message);
});
