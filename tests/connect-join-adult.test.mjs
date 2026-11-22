// The join function and the 18+ confirmation (CONNECT 2026-11-21, CC1's 13:5x order; Ryan's 11:30 'Age 18+'): supabase/functions/join/join.ts. Runs the real handler with fake dependencies; talks to nothing.
// Customer step: the 18+ confirmation is recorded with the account, so it can be shown later. The page sends adult_confirmed: true; the function refuses in words without it and passes it on to Supabase Auth as the new account's user metadata,
// which the database trigger (migrations/20261121000800_join_open.sql, proved in supabase/tests/test_join_open.py) copies into public.account_adult_confirmation. Must-fails: tests/connect_join_adult_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handle as join, ADULT_WORDS, SENT } from '../supabase/functions/join/join.ts';

const ORIGIN = 'https://uselai.com';
const deps = (over = {}) => ({ allowedOrigins: [ORIGIN], siteUrl: ORIGIN, reserve: async () => ({ ok: true }), invite: async () => {}, ...over });
const post = (body) => new Request('https://x.test/fn', { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('without the box the function refuses in words, before the limits are used and before any email is sent', async () => {
  for (const extra of [{}, { adult_confirmed: false }, { adult_confirmed: 'true' }, { adult_confirmed: 1 }, { adult_confirmed: null }, { adult_confirmed: [true] }]) {
    let reserved = 0, invited = 0;
    const r = await join(post({ email: 'a@example.test', ...extra }), deps({ reserve: async () => { reserved++; return { ok: true }; }, invite: async () => { invited++; } }));
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.deepEqual(await r.json(), { error: ADULT_WORDS });
    assert.equal(reserved + invited, 0, 'no limit used, no email: ' + JSON.stringify(extra));
  }
  assert.match(ADULT_WORDS, /18 or older/);
});

test('with the box (the boolean true) the invite carries adult_confirmed: true as the account\'s data, and the answer is the usual one', async () => {
  let seen;
  const r = await join(post({ email: 'a@example.test', adult_confirmed: true }), deps({ invite: async (e, redirect, data) => { seen = { e, redirect, data }; } }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).message, SENT);
  assert.deepEqual(seen, { e: 'a@example.test', redirect: 'https://uselai.com/app/', data: { adult_confirmed: true } });
});

test('the refusal says nothing about which addresses have accounts: a known address without the box gets the same words as an unknown one', async () => {
  const known = await join(post({ email: 'old@example.test' }), deps({ invite: async () => { throw Object.assign(new Error('registered'), { code: 'email_exists' }); } }));
  const fresh = await join(post({ email: 'new@example.test' }), deps());
  assert.equal(known.status, 400); assert.equal(fresh.status, 400);
  assert.deepEqual(await known.json(), await fresh.json());
});

test('a missing email is still asked for first, and a wrong origin is still refused before anything', async () => {
  assert.equal((await join(post({ adult_confirmed: true }), deps())).status, 400);
  assert.deepEqual(await (await join(post({ adult_confirmed: true }), deps())).json(), { error: 'Enter your email address.' });
  assert.equal((await join(new Request('https://x.test/fn', { method: 'POST', headers: { origin: 'https://evil.test' }, body: '{"email":"a@b.co","adult_confirmed":true}' }), deps())).status, 403);
});

test('index.ts hands the data to Supabase Auth\'s invite (user metadata), and nothing else changed in how it is called', () => {
  const idx = fs.readFileSync(new URL('../supabase/functions/join/index.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.match(idx, /async invite\(email, redirectTo, data\) \{\n\s+const \{ error \} = await service\.auth\.admin\.inviteUserByEmail\(email, \{ redirectTo, data \}\);/);
});
