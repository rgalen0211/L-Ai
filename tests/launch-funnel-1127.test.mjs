// The launch funnel on #/admin/funnel (BUILDER 11-27; behind launchFunnel, off; SQL 20261127000200, live step 80; supabase/tests/test_launch_funnel.py holds the database half).
// The data layer names the one read-only function with a bounded day count, the mock mirrors its shape, and the page shows the table only behind its switch, writes text only, and says 'not kept' for a NULL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function loadAssets(file) { const window = {}; vm.runInNewContext(read(`assets/${file}`), { window }); return window; }
const ryagramData = loadAssets('app-data.js').ryagramData;
const plain = x => JSON.parse(JSON.stringify(x));

test('the data layer calls admin_launch_funnel with 1 to 60 days, and the mock answers in the function’s shape', async () => {
  const calls = [];
  const real = createFakeClient();
  const data = ryagramData({ ...real, rpc: (name, args) => { calls.push([name, args]); return real.rpc(name, args); } });
  const rows = plain(await data.adminLaunchFunnel(7));
  assert.deepEqual(plain(calls[0]), ['admin_launch_funnel', { p_days: 7 }]);
  assert.equal(rows.length, 7);
  assert.deepEqual(Object.keys(rows[0]), ['day', 'signups_asked', 'accounts_opened', 'first_sheet', 'first_preview', 'film_asked', 'film_approved', 'film_delivered']);
  assert.ok(rows.slice(2).every(r => r.signups_asked === null), 'sign-up asks are kept 2 days only');
  await data.adminLaunchFunnel(999); await data.adminLaunchFunnel(0);
  assert.deepEqual(plain(calls.slice(1).map(c => c[1].p_days)), [60, 14]);
  await assert.rejects(ryagramData(createFakeClient({ admin: false })).adminLaunchFunnel(7), /Only an admin/);
});

test('the page: behind launchFunnel (account, off), the old event funnel stays behind funnelTracking, text only, NULL reads not kept', () => {
  const src = read('assets/app-library.js');
  assert.match(src, /const launchFunnelOn = \(\) => !!\(window\.ryagramSwitches && window\.ryagramSwitches\.featureOn\('launchFunnel'\) === true\);/);
  assert.match(src, /const funnelPageOn = \(\) => funnelOn\(\) \|\| launchFunnelOn\(\);/);
  assert.match(src, /\['#\/admin\/funnel', 'Funnel by day', '[^']+', 'People', funnelPageOn\(\)\]/);
  assert.match(src, /else if \(funnelPageOn\(\) && hash === '#\/admin\/funnel' && await data\.isAppAdmin\(\)\) view = await funnelAdminView\(onStop\);/);
  const part = src.slice(src.indexOf('// The launch funnel (BUILDER 11-27'), src.indexOf('// --- #/admin/renders'));
  assert.ok(part.length > 1500);
  assert.deepEqual([...part.matchAll(/data\.(\w+)\(/g)].map(m => m[1]), ['adminLaunchFunnel']);
  assert.match(part, /const launchSection = launchFunnelOn\(\) \?/);
  assert.match(part, /if \(funnelOn\(\)\) await load\(\);/, 'the event funnel still loads only behind funnelTracking');
  assert.match(part, /v === null \|\| v === undefined\) \? 'not kept'/);
  assert.match(part, /rows\.slice\(0, 60\)/);
  assert.doesNotMatch(part, /innerHTML|insertAdjacentHTML|outerHTML/);
  const cfg = read('assets/ryagram-config.js');
  assert.match(cfg, /\n  launchFunnel: 'account',\n/);
  assert.match(cfg, /\n  funnelTracking: false,\n/, 'no tracking is turned on');
});

test('no tracking: the funnel page half adds no event, no cookie, no third-party call', () => {
  const src = read('assets/app-library.js');
  const part = src.slice(src.indexOf('// The launch funnel (BUILDER 11-27'), src.indexOf('// --- #/admin/renders'));
  assert.doesNotMatch(part, /document\.cookie|localStorage|sessionStorage|fetch\(|funnel_events|recordFunnel|track\(|gtag|analytics/i);
});
