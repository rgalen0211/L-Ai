// First-party funnel tracking: the browser half (assets/funnel.js), Ryan's numbers (app-ops.js) and the guards that keep it first-party and minimal. The database half
// (triggers, source attach, return visits, who reads what, retention) is supabase/tests/test_funnel.py.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = p => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const plain = x => JSON.parse(JSON.stringify(x));
const CFG = { supabaseUrl: 'https://p.supabase.co', supabaseKey: 'sb_publishable_x', funnelTracking: true };

// A page for funnel.js: storage, fetch and the client are stubs; the script is run for real.
function page({ config = CFG, search = '', referrer = '', path = '/ryagram/', nav = {}, store = {}, storeThrows = false } = {}) {
  const calls = { fetch: [], rpc: [] };
  const localStorage = storeThrows ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } }
    : { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
  const window = { ryagramConfig: config, localStorage };
  vm.runInNewContext(read('assets/funnel.js'), {
    window, URLSearchParams, URL, JSON, Promise,
    navigator: { userAgent: 'Mozilla/5.0 Chrome', ...nav },
    location: { search, pathname: path, hostname: 'uselai.com' },
    document: { referrer, readyState: 'complete', addEventListener() {} },
    fetch: (url, init) => { calls.fetch.push({ url, body: JSON.parse(init.body), headers: init.headers }); return Promise.resolve({}); }
  });
  const client = { rpc: async (name, args) => { calls.rpc.push([name, args]); return { error: null }; } };
  return { F: window.ryagramFunnel, calls, store, client };
}

test('LANDING: a /ryagram/ visit sends landing_view with this visit\'s cleaned source, and remembers the first touch once', () => {
  const t = page({ search: '?utm_source=YouTube&utm_medium=Video!&utm_campaign=oct-launch', referrer: 'https://www.youtube.com/watch?v=abc' });
  assert.equal(t.calls.fetch.length, 1);
  assert.equal(t.calls.fetch[0].url, 'https://p.supabase.co/rest/v1/rpc/funnel_anon');
  assert.deepEqual(t.calls.fetch[0].body, { p_event: 'landing_view', p_utm_source: 'youtube', p_utm_medium: 'video', p_utm_campaign: 'oct-launch', p_referrer: 'youtube.com' });
  assert.deepEqual(JSON.parse(t.store['ryagram-source']), { s: 'youtube', m: 'video', c: 'oct-launch', r: 'youtube.com' });
  assert.equal(t.calls.fetch[0].headers.apikey, 'sb_publishable_x');
  const again = page({ search: '?utm_source=google', store: { 'ryagram-source': t.store['ryagram-source'] } });
  assert.equal(JSON.parse(again.store['ryagram-source']).s, 'youtube');                                  // first touch wins; a later visit never replaces it
});

test('DIRECT AND OWN PAGES: a direct visit stores NOTHING; our own site as referrer is not a source; ?ref= counts as the source like the visit tally', () => {
  const t = page({});
  assert.equal(t.calls.fetch.length, 1);                                                                    // the visit still counts (as direct)
  assert.deepEqual(plain(Object.keys(t.store)), []);
  const own = page({ referrer: 'https://uselai.com/app/' });
  assert.deepEqual(own.calls.fetch[0].body, { p_event: 'landing_view', p_utm_source: '', p_utm_medium: '', p_utm_campaign: '', p_referrer: '' });
  assert.equal(page({ search: '?ref=Newsletter' }).calls.fetch[0].body.p_utm_source, 'newsletter');
});

test('PRIVACY GATES: off by default; skipped (nothing stored, nothing sent) for Do Not Track, Global Privacy Control, automated browsers and crawlers', () => {
  for (const [what, opts] of [['flag off', { config: { ...CFG, funnelTracking: false } }], ['no project', { config: { funnelTracking: true } }], ['DNT', { nav: { doNotTrack: '1' } }],
                              ['GPC', { nav: { globalPrivacyControl: true } }], ['webdriver', { nav: { webdriver: true } }], ['crawler', { nav: { userAgent: 'Googlebot/2.1 (+bot)' } }]]) {
    const t = page({ search: '?utm_source=youtube', ...opts });
    assert.equal(t.calls.fetch.length, 0, what);
    assert.deepEqual(plain(Object.keys(t.store)), [], what);
  }
  const t = page({ search: '?utm_source=youtube', nav: { doNotTrack: '1' } });
  t.F.signupStarted();
  assert.equal(t.calls.fetch.length, 0);
});

test('OTHER PAGES: only /ryagram/ counts as a landing view (the app and the home page do not)', () => {
  assert.equal(page({ path: '/app/' }).calls.fetch.length, 0);
  assert.equal(page({ path: '/' }).calls.fetch.length, 0);
  assert.equal(page({ path: '/ryagram/index.html' }).calls.fetch.length, 1);
});

test('SIGNUP STARTED: the invite form sends signup_started with the stored first-touch source (not the form\'s own page)', () => {
  const t = page({ path: '/app/', store: { 'ryagram-source': JSON.stringify({ s: 'youtube', m: '', c: '', r: 'youtube.com' }) } });
  t.F.signupStarted();
  assert.deepEqual(t.calls.fetch.at(-1).body, { p_event: 'signup_started', p_utm_source: 'youtube', p_utm_medium: '', p_utm_campaign: '', p_referrer: 'youtube.com' });
});

test('SIGNED IN: the source is attached once, the browser record is deleted, and the return-visit check follows; with nothing stored only the check runs', async () => {
  const t = page({ path: '/app/', store: { 'ryagram-source': JSON.stringify({ s: 'youtube', m: 'video', c: '', r: 'youtube.com' }) } });
  await t.F.signedIn(t.client);
  assert.deepEqual(plain(t.calls.rpc), [['funnel_attach_source', { p_utm_source: 'youtube', p_utm_medium: 'video', p_utm_campaign: '', p_referrer: 'youtube.com' }], ['funnel_return_visit', null]]);
  assert.deepEqual(plain(Object.keys(t.store)), []);                                                         // nothing is left in the browser
  const none = page({ path: '/app/' });
  await none.F.signedIn(none.client);
  assert.deepEqual(plain(none.calls.rpc), [['funnel_return_visit', null]]);                                        // no empty "direct" answer is ever attached
  const failing = page({ path: '/app/', store: { 'ryagram-source': JSON.stringify({ s: 'a', m: '', c: '', r: '' }) } });
  failing.client.rpc = async () => ({ error: { message: 'nope' } });
  await failing.F.signedIn(failing.client);
  assert.ok(failing.store['ryagram-source']);                                                                // a failed attach keeps the record for the next sign-in
  const off = page({ path: '/app/', config: { ...CFG, funnelTracking: false } });
  await off.F.signedIn(off.client);
  assert.equal(off.calls.rpc.length, 0);
});

test('NEVER IN THE WAY: blocked storage and a throwing client change nothing for the person', async () => {
  const t = page({ storeThrows: true, search: '?utm_source=youtube' });
  assert.equal(t.calls.fetch.length, 1);
  await t.F.signedIn({ rpc: () => { throw new Error('boom'); } });
});

// ---- Ryan's numbers
const STEPS = ['landing_view', 'signup_started', 'signup_done', 'first_project', 'contact_sheet', 'preview', 'render_ordered', 'render_approved', 'film_requested', 'film_delivered', 'purchase', 'subscription_start', 'subscription_cancel', 'return_7d', 'return_30d'];
const O = (() => { const window = {}; vm.runInNewContext(read('assets/app-ops.js'), { window }); return window.ryagramOps; })();
const funnel = (totals, extra = {}) => ({ weeks: ['2026-10-05', '2026-10-12'], steps: STEPS.map(e => ({ event: e, total: totals[e] || 0, by_week: (extra.week || {})[e] || {}, by_source: (extra.source || {})[e] || {} })) });

test('FUNNEL ROWS: people per step, conversion from the step before and from the first step; the side steps are judged against signups; nothing divides by zero', () => {
  const rows = O.funnelRows(funnel({ landing_view: 200, signup_started: 50, signup_done: 40, first_project: 30, contact_sheet: 20, preview: 10, render_ordered: 8, render_approved: 6, film_requested: 5, film_delivered: 4, purchase: 2, return_7d: 10 }));
  assert.equal(rows.length, 15);
  assert.deepEqual([rows[0].fromPrevious, rows[0].fromFirst], ['', '']);
  assert.deepEqual([rows[1].fromPrevious, rows[1].fromFirst], ['25%', '25%']);
  assert.deepEqual([rows[3].label, rows[3].total, rows[3].fromPrevious, rows[3].fromFirst], ['Made a first project', 30, '75%', '15%']);
  assert.equal(rows.find(r => r.event === 'return_7d').fromPrevious, '25%');                              // 10 of the 40 who signed up
  assert.ok(rows.find(r => r.event === 'return_7d').side);
  const empty = O.funnelRows(funnel({}));
  assert.ok(empty.every(r => r.total === 0 && !/NaN|Infinity/.test(r.fromPrevious + r.fromFirst)));
  assert.equal(empty[2].fromPrevious, '—');
  assert.deepEqual(plain(O.funnelRows(null)), []);
});

test('FUNNEL BY SOURCE AND WEEK: sources sorted by volume with the visit-to-signup rate; weeks newest first', () => {
  const f = funnel({}, { source: { landing_view: { youtube: 100, direct: 50 }, signup_done: { youtube: 10, 'reddit.com': 3 } }, week: { landing_view: { '2026-10-05': 40, '2026-10-12': 60 } } });
  const src = O.funnelBySource(f);
  assert.deepEqual(plain(src.map(r => r.source)), ['youtube', 'direct', 'reddit.com']);
  assert.equal(src[0].signupRate, '10%');
  assert.equal(src[2].signupRate, '—');                                                                // no visits recorded for it: no invented rate
  const wk = O.funnelByWeek(f);
  assert.deepEqual(plain(wk.map(r => r.week)), ['2026-10-12', '2026-10-05']);
  assert.equal(wk[0].counts.landing_view, 60);
  assert.match(O.funnelLine(null), /apply SQL 20261017000900/);
  assert.match(O.funnelLine(f), /Visits .* counted each time; every other step counts each account once/);
});

// ---- guards
test('FIRST-PARTY ONLY: no third-party pixel or tag, no cookie, nothing but the source and the public database call', () => {
  const src = read('assets/funnel.js');
  const code = src.replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /document\.cookie|sessionStorage|indexedDB|fbq|gtag|dataLayer|facebook|google|doubleclick|clarity|hotjar|sendBeacon|XMLHttpRequest|import\(|<script/i);
  assert.equal([...code.matchAll(/fetch\(/g)].length, 1);                                                    // one network call, to our own database
  assert.match(code, /rest\/v1\/rpc\/funnel_anon/);
  const stored = [...code.matchAll(/setItem\(([^,]+),/g)].map(m => m[1]);
  assert.deepEqual(stored, ['KEY']);
  assert.match(read('assets/ryagram-config.js'), /funnelTracking: false,/);                                  // ships OFF until the SQL and the Privacy line are live
});

test('WIRING: the pages load funnel.js, sign-in attaches the source once, the invite form says signup_started, the Funnel section is on #/admin/ops', () => {
  assert.match(read('app/index.html'), /<script src="\/assets\/funnel\.js\?v=[0-9a-z]+"><\/script>/);
  assert.match(read('ryagram/index.html'), /<script src="\/assets\/funnel\.js" defer><\/script>/);
  const auth = read('assets/app-auth.js');
  assert.match(auth, /window\.ryagramFunnel\?\.signedIn\?\.\(client\)/);
  assert.match(auth, /window\.ryagramFunnel\?\.signupStarted\?\.\(\)/);
  const lib = read('assets/app-library.js');
  assert.match(lib, /funnelSection\(funnel\),/);
  assert.match(lib, /data\.adminFunnel\(funnelWeeks\)/);
  assert.doesNotMatch(lib, /h\('select',\s*\{\s*id:\s*'fn-/);                                                  // buttons, not a new dropdown (the app-catalog guard)
});

test('SQL: the table, the policies and the retention are what the privacy line says', () => {
  const sql = read('supabase/migrations/20261017000900_funnel_events.sql');
  assert.match(sql, /create table public\.funnel_events/);
  assert.match(sql, /alter table public\.funnel_events enable row level security/);
  assert.match(sql, /for select to authenticated using \(public\.is_app_admin\(\)\)/);
  assert.match(sql, /delete from public\.funnel_events where at < now\(\) - interval '13 months'/);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\bip\b|user_agent|email text|cookie/i);                  // no address, browser details or email column
});

test('RENDER STEPS: render_ordered and render_approved are in the migration (constraint, triggers, install list, Ryan view), in the chain after the preview, and the by-source/by-week tables use render_ordered as the first order', () => {
  const sql = read('supabase/migrations/20261017000900_funnel_events.sql');
  assert.match(sql, /'preview', 'render_ordered', 'render_approved', 'film_requested'/);
  assert.match(sql, /tg_table_name = 'render_orders' then\s+if new\.want::text = 'final' then perform ryagram_private\.funnel_log\('render_ordered', new\.owner_id\)/);
  assert.match(sql, /tg_table_name = 'render_stages' then[\s\S]*old\.admin_decided_at is null and new\.admin_decided_at is not null and new\.state::text not in \('declined', 'expired'\)[\s\S]*funnel_log\('render_approved', new\.owner_id\)/);
  assert.match(sql, /\('public\.render_orders', 'after insert', ''\), \('public\.render_stages', 'after update', ''\)/);
  assert.match(sql, /\(7, 'render_ordered'\), \(8, 'render_approved'\)/);
  const chain = O.FUNNEL_CHAIN;
  assert.deepEqual(plain(chain.slice(chain.indexOf('preview'), chain.indexOf('preview') + 3)), ['preview', 'render_ordered', 'render_approved']);
  assert.ok(O.FUNNEL_KEY.includes('render_ordered') && !O.FUNNEL_KEY.includes('film_requested'));
  assert.equal(O.FUNNEL_LABELS.render_ordered, 'Ordered a full render');
});
