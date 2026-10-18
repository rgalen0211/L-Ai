// #/admin/funnel (queue item 4): Ryan's read-only by-day view: signups -> first preview -> first order. It reads the raw funnel events through the table's own
// admin-only policy (no new database function), counts per step per Eastern day in the browser, and stays off with the funnelTracking flag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createFakeClient } = require('./fake-supabase.js');
const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const win = {};
for (const f of ['app-ops.js', 'app-data.js', 'app-jobs.js']) vm.runInNewContext(read(`assets/${f}`), { window: win, setTimeout, clearTimeout, Intl });
const O = win.ryagramOps;
const plain = x => JSON.parse(JSON.stringify(x));

test('DAYS: events are counted per step per EASTERN day (a late-evening UTC event belongs to the earlier Eastern day), newest day first, other events ignored, old events dropped', () => {
  const now = Date.parse('2026-10-17T15:00:00Z');
  const ev = (at, event) => ({ at, event });
  const d = O.funnelDaily([
    ev('2026-10-17T13:00:00Z', 'signup_done'), ev('2026-10-17T14:00:00Z', 'signup_done'), ev('2026-10-17T14:30:00Z', 'preview'),
    ev('2026-10-17T02:00:00Z', 'render_ordered'),                                    // 22:00 on the 16th in New York
    ev('2026-10-15T12:00:00Z', 'purchase'), ev('2026-10-15T12:00:00Z', 'landing_view'),
    ev('2026-10-01T12:00:00Z', 'signup_done'),                                       // outside the window
    ev('2026-10-17T12:00:00Z', 'return_7d')                                          // not a column here
  ], { days: 3, now });
  assert.deepEqual(plain(d.days.map(x => x.day)), ['2026-10-17', '2026-10-16', '2026-10-15']);
  assert.deepEqual(plain(d.days[0].counts), { landing_view: 0, signup_done: 2, first_project: 0, preview: 1, render_ordered: 0, render_approved: 0, purchase: 0 });
  assert.equal(d.days[1].counts.render_ordered, 1);
  assert.deepEqual(plain([d.days[2].counts.purchase, d.days[2].counts.landing_view]), [1, 1]);
  assert.deepEqual(plain(d.totals), { landing_view: 1, signup_done: 2, first_project: 0, preview: 1, render_ordered: 1, render_approved: 0, purchase: 1 });
  assert.match(O.funnelDailyLine(d), /2 signed up, 1 made a first preview \(50% of signups\), 1 ordered a full render \(50%\), 0 approved, 1 bought credits\./);
  assert.match(O.funnelDailyLine(O.funnelDaily([], { days: 2, now })), /0 signed up, 0 made a first preview \(— of signups\)/);
});

test('DATA: the events come from funnel_events through the table (no new function), newest first, paged by 1000, and it says so when it hit the cap', async () => {
  const client = createFakeClient({});
  const data = win.ryagramData(client);
  const got = await data.adminFunnelEvents(14);
  assert.equal(got.truncated, false);
  assert.ok(got.rows.length > 100 && got.rows.every(r => 'at' in r && 'event' in r));
  assert.ok(got.rows[0].at >= got.rows[got.rows.length - 1].at, 'newest first');
  assert.ok(client.log.some(l => l.table === 'funnel_events'), 'read from the table');
  const src = read('assets/app-data.js');
  assert.match(src, /from\('funnel_events'\)\.select\('at, event'\)\.gte\('at', since\)/);
  assert.doesNotMatch(src.slice(src.indexOf('async adminFunnelEvents'), src.indexOf('adminFunnel(weeks)')), /\.(insert|update|upsert|delete)\(|rpc\(/, 'read-only');
});

test('PAGE: admin only, behind the funnelTracking flag, linked from the admin links, read-only (no buttons that change anything)', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /const funnelOn = \(\) => window\.ryagramConfig\?\.funnelTracking === true \|\| !!window\.ryagramMock;/);
  assert.match(lib, /funnelOn\(\) && hash === '#\/admin\/funnel' && await data\.isAppAdmin\(\)\) view = await funnelAdminView\(onStop\)/);
  assert.match(lib, /\.\.\.\(funnelOn\(\) \? \[' \\u00b7 ', h\('a', \{ href: '#\/admin\/funnel' \}, 'Funnel by day'\)\] : \[\]\)/);
  const view = lib.slice(lib.indexOf('async function funnelAdminView'), lib.indexOf('// --- #/admin/renders'));
  assert.doesNotMatch(view, /data\.(?!adminFunnelEvents)[a-zA-Z]+\(/, 'it calls no other data function');
  assert.doesNotMatch(view, /replaceChildren\([^;]*: null\)/);
  assert.match(read('assets/ryagram-config.js'), /funnelTracking: false,/, 'ships off');
});
