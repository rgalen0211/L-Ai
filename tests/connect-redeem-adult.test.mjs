// The invite-code path and the 18+ confirmation (CONNECT 2026-11-21, CC1's 14:4x order; Ryan's 11:30 'Age 18+'): supabase/functions/redeem-invite/redeem.ts. Runs the real handler with fake dependencies; talks to nothing.
// Customer step: every new account's 18+ confirmation is recorded, however they joined. The invite form sends adult_confirmed: true; the function refuses in words without it, before the code is counted or used, and passes it to Supabase Auth with
// adult_source "invite"; the database trigger (migrations/20261121000800_join_open.sql, proved in supabase/tests/test_join_open.py) records it with source 'invite'. Must-fails: tests/connect_join_open_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handle as redeem, ADULT_WORDS, SENT } from '../supabase/functions/redeem-invite/redeem.ts';

const ORIGIN = 'https://uselai.com';
const world = (over = {}) => {
  const calls = [];
  const deps = {
    allowedOrigins: [ORIGIN], siteUrl: ORIGIN,
    reserve: async (...a) => { calls.push(['reserve', ...a]); return { ok: true, redemption: 7 }; },
    sent: async (...a) => { calls.push(['sent', ...a]); },
    release: async (...a) => { calls.push(['release', ...a]); },
    invite: async (...a) => { calls.push(['invite', ...a]); return { userId: 'u-1' }; },
    ...over,
  };
  return { deps, calls };
};
const post = (deps, body) => redeem(new Request('https://x.test/fn', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(body) }), deps);

test('without the box the function refuses in words, before the code is counted or used and before any email is sent', async () => {
  for (const extra of [{}, { adult_confirmed: false }, { adult_confirmed: 'true' }, { adult_confirmed: 1 }, { adult_confirmed: null }, { adult_confirmed: [true] }]) {
    const w = world();
    const r = await post(w.deps, { code: 'RYA-AAAA-BBBB', email: 'a@example.test', ...extra });
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.deepEqual(await r.json(), { error: ADULT_WORDS });
    assert.equal(w.calls.length, 0, 'the code is not reserved, no email: ' + JSON.stringify(extra));
  }
  assert.match(ADULT_WORDS, /18 or older/);
});

test('with the box the invite carries adult_confirmed: true and adult_source "invite", and the answer is the usual one', async () => {
  const w = world();
  const r = await post(w.deps, { code: 'RYA-AAAA-BBBB', email: 'a@example.test', adult_confirmed: true });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).message, SENT);
  assert.deepEqual(w.calls.map((c) => c[0]), ['reserve', 'invite', 'sent']);
  assert.deepEqual(w.calls[1].slice(1), ['a@example.test', 'https://uselai.com/app/', { adult_confirmed: true, adult_source: 'invite' }]);
});

test('the refusal says nothing about the code or the address: a bad code and a good code without the box get the same words; a missing code or email is still asked for first', async () => {
  const bad = await post(world({ reserve: async () => ({ ok: false, reason: 'invalid' }) }).deps, { code: 'nope', email: 'a@example.test' });
  const good = await post(world().deps, { code: 'RYA-AAAA-BBBB', email: 'a@example.test' });
  assert.deepEqual(await bad.json(), await good.json());
  assert.deepEqual(await (await post(world().deps, { email: 'a@example.test', adult_confirmed: true })).json(), { error: 'Enter your invite code and your email.' });
});

test('index.ts hands the data to Supabase Auth\'s invite (user metadata)', () => {
  const idx = fs.readFileSync(new URL('../supabase/functions/redeem-invite/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(idx, /async invite\(email, redirectTo, meta\) \{\n\s+const \{ data, error \} = await service\.auth\.admin\.inviteUserByEmail\(email, \{ redirectTo, data: meta \}\);/);
});
