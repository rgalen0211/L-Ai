// get-delivery-url, the PRIVATE LINK for a film made on the person's own computer (NEXT-CONNECT 120): tried only when the data-film lookup finds nothing, only when the function is switched on,
// with the same owner / expiry / deletion rules, a one-hour link, and its own label. The data-film path is unchanged (tests/get-delivery-url.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../supabase/functions/get-delivery-url/deliver.ts';

const ME = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const DLV = '11111111-2222-4333-8444-555555555555';
const notFound = () => Object.assign(new Error('Delivery not found.'), { code: 'PT404' });

function world({ compilation = true, filmFound = false, compFor } = {}) {
  const calls = [];
  const deps = {
    allowedOrigins: ['https://uselai.com'],
    verifyUser: async jwt => (jwt === 'good' ? { id: ME, clientId: null } : jwt === 'ai' ? { id: ME, clientId: 'chatgpt' } : null),
    objectFor: async (owner, d) => { calls.push(['objectFor', owner, d]); if (filmFound) return `${owner}/p/v/j/final.mp4`; throw notFound(); },
    sign: async (path, seconds) => { calls.push(['sign', path, seconds]); return `https://signed.example/${path}?t=${seconds}`; },
  };
  if (compilation) deps.compilationFor = compFor ?? (async (owner, d) => { calls.push(['compilationFor', owner, d]); return `${owner}/compilations/${d}.mp4`; });
  return { calls, deps };
}
const call = (deps, body, { jwt = 'good' } = {}) =>
  handle(new Request('https://x.supabase.co/functions/v1/get-delivery-url', { method: 'POST', headers: { origin: 'https://uselai.com', authorization: `Bearer ${jwt}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }), deps);

test('a film made on the person\'s own computer: the data-film lookup finds nothing, the compilation lookup does, the link is one hour and labelled "Made on your computer"', async () => {
  const w = world();
  const res = await call(w.deps, { delivery_id: DLV });
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.equal(b.label, 'Made on your computer');
  assert.equal(b.expires_in, 3600);
  assert.deepEqual(w.calls, [['objectFor', ME, DLV], ['compilationFor', ME, DLV], ['sign', `${ME}/compilations/${DLV}.mp4`, 3600]]);
});

test('a data film is exactly as it was: found first, the compilation lookup never asked, label "AI-assisted"', async () => {
  const w = world({ filmFound: true });
  const b = await (await call(w.deps, { delivery_id: DLV })).json();
  assert.equal(b.label, 'AI-assisted');
  assert.deepEqual(w.calls.map(c => c[0]), ['objectFor', 'sign']);
});

test('MUST FAIL: OFF - with no compilation lookup given the function answers "not found" as before and signs nothing', async () => {
  const w = world({ compilation: false });
  const res = await call(w.deps, { delivery_id: DLV });
  assert.equal(res.status, 404);
  assert.deepEqual(w.calls.map(c => c[0]), ['objectFor']);
});

test('MUST FAIL: not yours / not there is the same 404; expired or deleted is 410 with the database\'s plain sentence; nothing is signed', async () => {
  let w = world({ compFor: async () => { throw notFound(); } });
  assert.equal((await call(w.deps, { delivery_id: DLV })).status, 404);
  assert.ok(!w.calls.some(c => c[0] === 'sign'));
  w = world({ compFor: async () => { throw Object.assign(new Error('This film was kept for its days and has been deleted.'), { code: '42501' }); } });
  const gone = await call(w.deps, { delivery_id: DLV });
  assert.equal(gone.status, 410);
  assert.match((await gone.json()).error, /kept for its days/);
  assert.ok(!w.calls.some(c => c[0] === 'sign'));
  w = world({ compFor: async () => { throw new Error('connection to server at 10.0.0.5 failed'); } });
  const odd = await call(w.deps, { delivery_id: DLV });
  assert.equal(odd.status, 404, 'any other failure is the same plain "not found", never the text');
  assert.doesNotMatch(JSON.stringify(await odd.json()), /10\.0\.0\.5|connection/);
});

test('MUST FAIL: belt and braces - a path outside the caller\'s own folder is never signed, even if the lookup returns one', async () => {
  const w = world({ compFor: async () => `${OTHER}/compilations/${DLV}.mp4` });
  const res = await call(w.deps, { delivery_id: DLV });
  assert.equal(res.status, 404);
  assert.ok(!w.calls.some(c => c[0] === 'sign'));
});

test('MUST FAIL: a connected AI or a signed-out caller is refused before either lookup', async () => {
  const w = world();
  assert.equal((await call(w.deps, { delivery_id: DLV }, { jwt: 'ai' })).status, 403);
  assert.equal((await call(w.deps, { delivery_id: DLV }, { jwt: 'nope' })).status, 401);
  assert.deepEqual(w.calls, []);
});

test('a signing failure is a plain 500 and the error text is not sent', async () => {
  const w = world();
  w.deps.sign = async () => { throw new Error('storage key sk-secret-123 rejected'); };
  const res = await call(w.deps, { delivery_id: DLV });
  assert.equal(res.status, 500);
  assert.doesNotMatch(JSON.stringify(await res.json()), /sk-secret|storage key/);
});
