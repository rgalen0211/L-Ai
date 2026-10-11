const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createFakeClient } = require('./fake-supabase.js');

function load(file) {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'assets', file), 'utf8'), { window });
  return window;
}
const O = load('app-ops.js').ryagramOps;
const ryagramData = load('app-data.js').ryagramData;

test('the delayed notice shows only when rendering is delayed, says when it last checked in, and promises the refund', () => {
  assert.equal(O.bannerText(null), null);
  assert.equal(O.bannerText({ rendering: 'ok' }), null);
  assert.equal(O.bannerText({ rendering: 'unknown' }), null);
  const t = O.bannerText({ rendering: 'delayed', last_check_in: '2026-10-10T18:02:00Z' }, 'UTC');
  assert.match(t, /^Rendering is delayed\./);
  assert.match(t, /last checked in at 6:02 PM/);
  assert.match(t, /more than an hour we cancel it and give your credits back/);
  assert.match(O.bannerText({ rendering: 'delayed', last_check_in: null }), /^Rendering is delayed\. Your film will start/);
});

test('only a real job id in #/help?job= is passed on', () => {
  const id = 'abcdef12-1111-4111-8111-11111111111a';
  assert.equal(O.jobFromHash(`#/help?job=${id}`), id);
  for (const bad of ['#/help', '#/help?job=', '#/help?job=1', `#/help?job=${id}&x=1`, `#/help?job=${id.toUpperCase()}`, '#/help?job=<script>']) assert.equal(O.jobFromHash(bad), null, bad);
});

test('the help form checks its fields', () => {
  const ok = { email: 'a@b.co', topic: 'render', message: 'My film is stuck' };
  assert.equal(O.checkSupport(ok), null);
  assert.match(O.checkSupport({ ...ok, email: 'nope' }), /email/);
  assert.match(O.checkSupport({ ...ok, topic: 'x' }), /Choose/);
  assert.match(O.checkSupport({ ...ok, message: 'hi' }), /more/);
  assert.match(O.checkSupport({ ...ok, message: 'x'.repeat(4001) }), /too long/);
});

test('service status never throws (no SQL yet = no notice); the help form sends the job and the honeypot to the RPC', async () => {
  const missing = ryagramData({ rpc: async () => ({ data: null, error: { message: 'function public.service_status() does not exist' } }) });
  assert.equal(await missing.serviceStatus(), null);
  const broken = ryagramData({ rpc: async () => { throw new Error('network'); } });
  assert.equal(await broken.serviceStatus(), null);
  const calls = [];
  const data = ryagramData({ rpc: async (name, args) => { calls.push([name, args]); return { data: 7, error: null }; } });
  assert.equal(await data.submitSupport({ email: 'a@b.co', topic: 'render', message: 'stuck', job: 'J' }), 7);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['submit_support', { p_email: 'a@b.co', p_topic: 'render', p_message: 'stuck', p_job: 'J', p_website: '' }]);
  const mock = ryagramData(createFakeClient());
  assert.equal((await mock.serviceStatus()).rendering, 'ok');
  assert.equal(await mock.submitSupport({ email: 'a@b.co', topic: 'other', message: 'hello there' }), 1);
  assert.equal(await mock.submitSupport({ email: 'a@b.co', topic: 'other', message: 'hello there', website: 'spam' }), 0);
});

test('the notice and help form are OFF in the shipped config until the SQL is applied', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'assets', 'ryagram-config.js'), 'utf8');
  assert.match(src, /opsTools: false/);
});
