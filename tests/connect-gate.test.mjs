// Connect-your-AI for INVITEES only (Ryan 13:49; WEB 2026-10-20, NEXT-WEB 109), behind connectAi (off). The site asks the server whether this account may use AI connections and shows the consent page and
// Account > Connected AIs only if the answer is yes. The server stays the real gate (CONNECT's connect_person_ok: invited, enabled, not an admin, not a worker, checked in connect_consent_check and decide).
// This page-side gate is a courtesy that hides what an account cannot use. It FAILS CLOSED, asks every time (never cached across accounts), and adds no SQL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const win = {};
vm.runInNewContext(read('assets/app-data.js'), { window: win, URL, setTimeout, clearTimeout });
const GOOD = '00000000-0000-4000-8000-0000000000aa';
const NIL = '00000000-0000-0000-0000-000000000000';

test('ACCESS: an invited account is allowed; a not-invited one is not; the question is the nil request, one rpc, no new SQL', async () => {
  const calls = [];
  const spy = c => ({ ...c, rpc: (name, args) => { calls.push([name, args]); return c.rpc(name, args); }, auth: c.auth });
  assert.equal(await win.ryagramData(spy(createFakeClient())).connectAccess(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['connect_consent_check', { p_request: NIL }]]);
  assert.equal(await win.ryagramData(createFakeClient({ connectInvited: false })).connectAccess(), false);
});

test('FAILS CLOSED: an error, a missing answer, a missing field or a string "true" all mean not invited', async () => {
  const fake = createFakeClient();
  const mk = rpc => win.ryagramData({ ...fake, rpc, auth: fake.auth });
  assert.equal(await mk(async () => { throw new Error('network'); }).connectAccess(), false);
  assert.equal(await mk(async () => ({ data: null, error: { message: 'boom' } })).connectAccess(), false);
  assert.equal(await mk(async () => ({ data: { allowed: false, reason: 'x' }, error: null })).connectAccess(), false);
  assert.equal(await mk(async () => ({ data: { invited: 'true' }, error: null })).connectAccess(), false);
  assert.equal(await mk(async () => ({ data: { invited: 1 }, error: null })).connectAccess(), false);
  assert.equal(await mk(async () => ({ data: { invited: true }, error: null })).connectAccess(), true);
});

test('MUST-FAIL: a not-invited account cannot use the consent page by URL: the server refuses a REAL request id with its own sentence, and the page is not served', async () => {
  const data = win.ryagramData(createFakeClient({ connectInvited: false }));
  const c = await data.connectConsentCheck(GOOD);                                      // what the server says if someone types the address by hand
  assert.equal(c.allowed, false);
  assert.match(c.reason, /not enabled for AI assistants yet \(invite-only for now\)/);
  assert.equal(c.invited, false);
  await assert.rejects(data.connectConsentDecide(GOOD, true, ['read']), /not enabled for AI assistants|invite/);   // and deciding is refused too
  const lib = read('assets/app-library.js');
  assert.match(lib, /else if \(connectOn\(\) && window\.ryagramConnect\.requestFromHash\(hash\)\) view = \(await connectAllowed\(data\)\) \? await connectUi\(\)\.consentView\(window\.ryagramConnect\.requestFromHash\(hash\)\) : connectUi\(\)\.inviteOnlyView\(\)/);
});

test('WIRING: the section and the route both go through connectAllowed, which needs the flag AND a yes; nothing is cached; the flag stays off', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /const connectAllowed = async data => connectOn\(\) && \(await data\.connectAccess\(\)\) === true;/);
  assert.match(lib, /if \(await connectAllowed\(data\)\) sections\.push\(await connectUi\(\)\.connectedSection\(\)\);/);
  assert.equal([...lib.matchAll(/connectUi\(\)\.connectedSection\(/g)].length, 1);
  assert.equal([...lib.matchAll(/connectUi\(\)\.consentView\(/g)].length, 1);
  assert.doesNotMatch(lib, /connectAccessAnswer|connectAccessCache/);                   // never cached across accounts
  assert.match(read('assets/ryagram-config.js'), /connectAi: false,/);
});

test('PLAIN LINE (CC1 LOW-2): a not-invited account that follows a consent link sees "Connecting an AI is by invitation for now." under a Connect an AI heading, not a blank page', () => {
  const src = read('assets/app-connect.js');
  assert.match(src, /const INVITE_ONLY = 'Connecting an AI is by invitation for now\.';/);
  const view = src.slice(src.indexOf('function inviteOnlyView'), src.indexOf('return { consentView, connectedSection, inviteOnlyView }'));
  assert.match(view, /h\('h1', \{ tabindex: '-1' \}, 'Connect an AI'\)/);
  assert.match(view, /role: 'status' \}, INVITE_ONLY\)/);
  assert.doesNotMatch(view, /data\./, 'it asks the server nothing and offers no button');
});
