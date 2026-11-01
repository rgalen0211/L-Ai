// Worker health on #/admin/ops (NEXT-WORKER 72): the formatter over admin_worker_health() (supabase/migrations/20261031000400_admin_worker_health.sql),
// the section only behind the workerHealth switch (OFF), and the SQL function admin-only. No database here: the SQL half is
// supabase/tests/test_worker_health.py.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
function load(file) {
  const window = {};
  vm.runInNewContext(read(`assets/${file}`), { window });
  return window;
}
const O = load('app-ops.js').ryagramOps;
const NOW = Date.parse('2026-10-31T12:00:00Z');
const at = min => new Date(NOW - min * 60000).toISOString();
const healthy = { name: 'DESKTOP-RYAN-1', enabled: true, state: 'ok', last_seen_at: at(0.5), free_gb: 96.4,
  running: null, last_claim_at: at(180), last_engine_commit: { commit: '9d4f19ddf50fc760474dd64ac1c06e1c40898b0f', ended_at: at(170) } };

test('a healthy worker: running, its engine, its last film, its disk; no warning', () => {
  const r = O.workerHealthLines({ claims_enabled: true, disabled_job_types: [], workers: [healthy] }, NOW);
  assert.equal(r.summary, '1 of 1 worker running.');
  assert.equal(r.warn, false);
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0], 'DESKTOP-RYAN-1 is running (checked in just now). Engine 9d4f19ddf50f (its last film with a recorded commit ended 2 hours ago). '
    + 'Last film taken 3 hours ago. 96 GB free on its disk.');
});

test('what it is making now replaces the last-claim sentence', () => {
  const r = O.workerHealthLines({ claims_enabled: true, workers: [{ ...healthy, running: { job_type: 'preview', state: 'running', claimed_at: at(4) } }] }, NOW);
  assert.match(r.lines[0], /Making a preview now \(taken 4 minutes ago\)\./);
  assert.doesNotMatch(r.lines[0], /Last film taken/);
});

test('each pause reason is said, and marked as worked out from what it last reported', () => {
  const low = O.workerHealthLines({ claims_enabled: true, workers: [{ ...healthy, free_gb: 9.4 }] }, NOW);
  assert.match(low.lines[0], /Paused, worked out from what it last reported: it has less than the 10 GB floor free, as last reported\./);
  assert.equal(low.warn, true);
  assert.equal(O.WORKER_FLOOR_GB, 10);
  const at10 = O.workerHealthLines({ claims_enabled: true, workers: [{ ...healthy, free_gb: 10 }] }, NOW);
  assert.doesNotMatch(at10.lines[0], /Paused/, 'exactly at the floor is not under it');
  const off = O.workerHealthLines({ claims_enabled: false, disabled_job_types: ['final_render'], workers: [healthy] }, NOW);
  assert.equal(off.summary, '1 of 1 worker running. Claims are switched off for every worker (control). Not taking: final_render.');
  assert.match(off.lines[0], /claims are switched off for every worker/);
  assert.equal(off.warn, true);
  const cut = O.workerHealthLines({ claims_enabled: true, workers: [{ ...healthy, enabled: false, state: 'off' }] }, NOW);
  assert.match(cut.lines[0], /^DESKTOP-RYAN-1 is switched off \(enabled is false in workers\)\..*Paused, worked out from what it last reported: it is switched off\./);
});

test('not checking in, never checked in, no engine yet, no film yet, no worker at all', () => {
  const late = O.workerHealthLines({ claims_enabled: true, workers: [{ ...healthy, state: 'delayed', last_seen_at: at(30) }] }, NOW);
  assert.match(late.lines[0], /is NOT CHECKING IN \(last check-in 30 minutes ago\)/);
  assert.equal(late.summary, '0 of 1 worker running.');
  assert.equal(late.warn, true);
  const fresh = O.workerHealthLines({ workers: [{ name: 'NEW-PC', enabled: true, state: 'unknown', last_seen_at: null, free_gb: null, running: null, last_claim_at: null, last_engine_commit: null }] }, NOW);
  assert.equal(fresh.lines[0], 'NEW-PC has never checked in. Engine: no film has recorded one yet. It has not taken a film yet.');
  for (const none of [{ workers: [] }, {}, null]) {
    const r = O.workerHealthLines(none, NOW);
    assert.equal(r.summary, 'No render worker is set up.');
    assert.equal(r.warn, true);
  }
});

test('nothing but its own characters reaches the page (names, job types, commits), and at most ten workers', () => {
  const r = O.workerHealthLines({ claims_enabled: true, disabled_job_types: ['<img src=x>'], workers: [{ ...healthy, name: '<b>evil</b>',
    running: { job_type: 'pre<script>view', claimed_at: at(1) }, last_engine_commit: { commit: 'not a commit', ended_at: at(1) }, free_gb: 'lots' }] }, NOW);
  const text = r.summary + ' ' + r.lines.join(' ');
  assert.doesNotMatch(text, /[<>]/);
  assert.match(r.lines[0], /^bevilb is running/);
  assert.match(r.lines[0], /Engine: no film has recorded one yet\./, 'a malformed commit is not shown');
  assert.doesNotMatch(r.lines[0], /GB free/, 'a non-number disk reading is not shown');
  assert.equal(O.workerHealthLines({ workers: Array.from({ length: 25 }, () => healthy) }, NOW).lines.length, 10);
});

test('the section loads only with the switch on, and the switch is OFF', () => {
  const lib = read('assets/app-library.js');
  assert.match(lib, /if \(window\.ryagramConfig\?\.workerHealth === true\) \{ try \{ health = await data\.adminWorkerHealth\(\); \} catch \{ health = null; \} \}/);
  assert.match(lib, /\.\.\.\(health \? \(wh => \[section\('Worker health'/);
  const cfg = {};
  vm.runInNewContext(read('assets/ryagram-config.js'), { window: cfg, Object });
  assert.equal(cfg.ryagramConfig.workerHealth, false);
  assert.match(read('assets/app-data.js'), /adminWorkerHealth\(\) \{ return run\(client\.rpc\('admin_worker_health'\)/);
});

test('the SQL function is admin only, reads house jobs only, and has a rollback', () => {
  const sql = read('supabase/migrations/20261031000400_admin_worker_health.sql');
  assert.match(sql, /perform ryagram_private\.require_admin\(\);/);
  assert.match(sql, /revoke all on function public\.admin_worker_health\(\) from public, anon, node_runner;/);
  assert.match(read('supabase/tests/test_ops_readiness.py'), /"admin_worker_health\(\)",/, 'named in the signed-in list, the admin_* rule');
  assert.equal((sql.match(/j\.run_on = 'house'/g) || []).length, 3, 'every job read is a house job');
  const body = sql.slice(sql.indexOf('$$'), sql.lastIndexOf('$$'));
  assert.ok(body.length > 500, 'the function body is read');
  assert.doesNotMatch(body, /owner_id|story|email/, 'no owner, story or person data is read (the function body, not its comments)');
  assert.match(read('supabase/rollbacks/20261031000400_admin_worker_health_rollback.sql'), /drop function if exists public\.admin_worker_health\(\);/);
});
