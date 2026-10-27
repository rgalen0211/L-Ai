// The node function's Storage call (NEXT-CONNECT 128): a legacy JWT key goes as Bearer AND apikey; a new sb_ key goes on apikey only, never as a Bearer token.
// The key values here are made up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storageHeaders, makeStorage } from '../supabase/functions/node/storage.ts';

test('a new sb_secret_ key is sent on apikey only', () => {
  const h = storageHeaders('sb_secret_madeup0123456789');
  assert.equal(h.apikey, 'sb_secret_madeup0123456789');
  assert.equal(h.Authorization, undefined);
});

test('a legacy JWT key is sent as both apikey and Bearer', () => {
  const h = storageHeaders('eyJmadeup.eyJmadeup.madeup');
  assert.equal(h.apikey, 'eyJmadeup.eyJmadeup.madeup');
  assert.equal(h.Authorization, 'Bearer eyJmadeup.eyJmadeup.madeup');
});

test('signUpload sends those headers to the sign endpoint and returns the full URL', async () => {
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => { seen.push({ url, init }); return new Response(JSON.stringify({ url: '/object/upload/sign/b/x?token=t' }), { status: 200 }); };
  try {
    const s = makeStorage('https://p.test', 'sb_secret_madeup0123456789', 'b');
    assert.equal(await s.signUpload('u/a b.mp4'), 'https://p.test/storage/v1/object/upload/sign/b/x?token=t');
    assert.equal(seen[0].url, 'https://p.test/storage/v1/object/upload/sign/b/u/a%20b.mp4');
    assert.equal(seen[0].init.headers.Authorization, undefined);
    assert.equal(seen[0].init.headers.apikey, 'sb_secret_madeup0123456789');
  } finally { globalThis.fetch = real; }
});
