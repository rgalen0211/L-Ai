import test from 'node:test';
import assert from 'node:assert/strict';
import { requestIdFromLocation } from '../tools/connect_e2e_parse.mjs';

const BASE = 'https://x.supabase.co/functions/v1/connect';
const ID = '2a74dc03-845f-4634-80ad-17a5943c1b2e';
const HASH = 'https://uselai.com/app/#/connect/consent?request=';

test('the id is read from the hash route the live function redirects to (the 10-25 Q22 failure)', () => {
  assert.equal(requestIdFromLocation(HASH + ID, BASE), ID);
});
test('a plain query address (a proof project) still works', () => {
  assert.equal(requestIdFromLocation('https://proof.example/consent?request=' + ID, BASE), ID);
});
test('MUST-FAIL: a query-only reader finds nothing in the hash address, so the old parse could not pass', () => {
  assert.equal(new URL(HASH + ID, BASE).searchParams.get('request'), null);
});
test('anything that is not a full UUID is null: cut short, extra, empty, missing, not a URL', () => {
  for (const bad of [HASH + ID.slice(0, 31), HASH + ID + '0', HASH + ID.toUpperCase(), HASH, 'https://uselai.com/app/#/connect/consent', '', 'https://uselai.com/app/#/x?request=' + ID.replace(/-/g, '')]) {
    assert.equal(requestIdFromLocation(bad, BASE), null, bad);
  }
  assert.equal(requestIdFromLocation(null, 'not a base'), null);
});
test('the pre-flight uses this reader and stops with a plain line when there is no id (no crash later in the SDK)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../tools/connect_e2e.mjs', import.meta.url), 'utf8');
  assert.match(src, /requestIdFromLocation\(loc, BASE\)/);
  assert.match(src, /if \(!requestId\)[^\n]*process\.exit\(1\)/);
  assert.doesNotMatch(src, /new URL\(loc, BASE\)\.searchParams/);
});
