// The SigV4 presigner (supabase/functions/_shared/r2_presign.ts; NEXT-CONNECT 133, Cloudflare R2). The decisive check is AWS's OWN published presigned-URL example: the same inputs must give the same
// signature, character for character (so the algorithm is right, not merely self-consistent). Then the R2 shape, the encodings, the limits, and the planted faults.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presignGet, uriEncode } from '../supabase/functions/_shared/r2_presign.ts';

const AWS = { host: 'examplebucket.s3.amazonaws.com', path: '/test.txt', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
              region: 'us-east-1', service: 's3', expiresSeconds: 86400, now: new Date('2013-05-24T00:00:00Z') };
const AWS_SIGNATURE = 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404';       // Amazon S3 docs, "Authenticating Requests: Using Query Parameters (AWS Signature Version 4)"

test('AWS\'s published example gives AWS\'s published signature, and the whole URL they show', async () => {
  const url = await presignGet(AWS);
  assert.equal(url, 'https://examplebucket.s3.amazonaws.com/test.txt?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request'
    + '&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host&X-Amz-Signature=' + AWS_SIGNATURE);
});

test('the R2 shape: path-style on the account endpoint, region auto, service s3, a 15-minute link, the secret nowhere in the URL', async () => {
  const url = new URL(await presignGet({ host: 'abc123.r2.cloudflarestorage.com', path: '/ryagram-app/releases/app-1.zip', accessKeyId: 'AKID', secretAccessKey: 'SECRET/VALUE+xyz', expiresSeconds: 900,
    now: new Date('2026-10-26T20:30:00Z'), query: { 'response-content-disposition': 'attachment; filename="app-1.zip"' } }));
  assert.equal(url.origin, 'https://abc123.r2.cloudflarestorage.com');
  assert.equal(url.pathname, '/ryagram-app/releases/app-1.zip');
  assert.equal(url.searchParams.get('X-Amz-Credential'), 'AKID/20261026/auto/s3/aws4_request');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '900');
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host');
  assert.equal(url.searchParams.get('response-content-disposition'), 'attachment; filename="app-1.zip"');
  assert.match(url.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/);
  assert.ok(!url.href.includes('SECRET') && !url.href.includes('xyz'), 'the secret access key is never in the URL');
});

test('the signature depends on every input (change one thing, the signature changes)', async () => {
  const sig = async (patch) => new URL(await presignGet({ ...AWS, ...patch })).searchParams.get('X-Amz-Signature');
  const base = await sig({});
  for (const patch of [{ secretAccessKey: AWS.secretAccessKey + 'x' }, { path: '/test2.txt' }, { host: 'other.s3.amazonaws.com' }, { expiresSeconds: 900 }, { now: new Date('2013-05-24T00:00:01Z') },
                       { accessKeyId: 'AKIAIOSFODNN7EXAMPLF' }, { region: 'auto' }, { query: { 'response-content-disposition': 'attachment' } }]) assert.notEqual(await sig(patch), base, JSON.stringify(patch).slice(0, 60));
  assert.equal(await sig({}), base, 'control: the same inputs give the same signature');
});

test('encoding: spaces, slashes, unicode and reserved characters are encoded as SigV4 wants', () => {
  assert.equal(uriEncode('a b/c~d.e-f_g'), 'a%20b%2Fc~d.e-f_g');
  assert.equal(uriEncode('a b/c', true), 'a%20b/c');
  assert.equal(uriEncode('é+=&'), '%C3%A9%2B%3D%26');
});

test('limits and refusals: an expiry outside 1 to 604800, a path with .., a bad host', async () => {
  for (const bad of [{ expiresSeconds: 0 }, { expiresSeconds: 604801 }, { expiresSeconds: 1.5 }, { path: '/a/../b' }, { path: 'nope' }, { host: 'evil.com/x' }, { host: 'a b' }]) {
    await assert.rejects(presignGet({ ...AWS, ...bad }), undefined, JSON.stringify(bad));
  }
});

// An independent, deliberately plain re-implementation (node:crypto, written from the SigV4 documentation, sharing no code with the module) must agree on inputs AWS's one example does not cover:
// another day, R2's region, a path that needs encoding, an extra query parameter.
import crypto from 'node:crypto';
function reference({ host, path, accessKeyId, secretAccessKey, region, service, expiresSeconds, now, query = {} }) {
  const enc = (s, slash) => [...Buffer.from(s, 'utf8')].map((b) => { const c = String.fromCharCode(b); return /[A-Za-z0-9\-_.~]/.test(c) || (slash && c === '/') ? c : '%' + b.toString(16).toUpperCase().padStart(2, '0'); }).join('');
  const d = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z', day = d.slice(0, 8), scope = `${day}/${region}/${service}/aws4_request`;
  const q = { 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${accessKeyId}/${scope}`, 'X-Amz-Date': d, 'X-Amz-Expires': String(expiresSeconds), 'X-Amz-SignedHeaders': 'host', ...query };
  const cq = Object.keys(q).sort().map((k) => `${enc(k)}=${enc(q[k])}`).join('&');
  const creq = `GET\n${enc(path, true)}\n${cq}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const sts = `AWS4-HMAC-SHA256\n${d}\n${scope}\n${crypto.createHash('sha256').update(creq).digest('hex')}`;
  const h = (k, m) => crypto.createHmac('sha256', k).update(m).digest();
  const key = h(h(h(h('AWS4' + secretAccessKey, day), region), service), 'aws4_request');
  return `https://${host}${enc(path, true)}?${cq}&X-Amz-Signature=${crypto.createHmac('sha256', key).update(sts).digest('hex')}`;
}

test('it agrees with an independent re-implementation on other days, R2\'s region, an encoded path and an extra parameter', async () => {
  const base = { host: 'abc.r2.cloudflarestorage.com', accessKeyId: 'AKID1', secretAccessKey: 'sEcReT/+key', region: 'auto', service: 's3', expiresSeconds: 900 };
  for (const extra of [
    { path: '/ryagram-app/releases/app-1.zip', now: new Date('2026-10-26T20:30:00Z') },
    { path: '/ryagram-app/releases/my app é+1.zip', now: new Date('2027-01-02T03:04:05Z') },
    { path: '/b/k.zip', now: new Date('2026-12-31T23:59:59Z'), query: { 'response-content-disposition': 'attachment; filename="k é.zip"' } },
  ]) assert.equal(await presignGet({ ...base, ...extra }), reference({ ...base, ...extra }), JSON.stringify(extra).slice(0, 70));
});
