// The 2026-11-20 audit of the connect Edge Function entry (supabase/functions/connect) and the connector / live-editor SQL: what it found that no test pinned, pinned here.
// Plain node (no database): the SQL is checked as TEXT, and the SQL the audit wrote is UNRUN against a database (its own SQL suites need a pg server; see supabase/tests).
//   1. the database layer: every call it makes matches the argument types of the SQL function it names (the LATEST definition), and arrays and jsonb travel the one right way
//   2. the migrations: every connector / editor function keeps `security definer` and an empty search_path (a regression guard over all 97 of them)
//   3. 20261120000100: the daily connector purge also runs the live editor's purge (which nothing called before)
//   4. 20261120000200: the download and footage plan asks take a per-person lock before they count; a download host must be a real name (SQL and TypeScript twins)
//   5. every rate-limit bucket the tools name is one the SQL accepts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ConnectDb } from '../supabase/functions/connect/db.ts';
import { downloadUrlProblem } from '../supabase/functions/connect-core/tools.ts';

const read = (p) => fs.readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const MIG_DIR = new URL('../supabase/migrations/', import.meta.url);
const migrations = fs.readdirSync(MIG_DIR).filter((f) => f.endsWith('.sql')).sort();
const lf = (s) => s.replace(/\r/g, '');

// ---------------------------------------------------------------------------------------------- 1. the database layer against the SQL it names
/** public.<name> -> the argument types of its LATEST definition in the migrations (a later create or replace wins), normalised to the words db.ts uses. */
function latestSignatures() {
  const sigs = new Map();
  for (const f of migrations) {
    const t = lf(fs.readFileSync(new URL(f, MIG_DIR), 'utf8'));
    for (const m of t.matchAll(/create (?:or replace )?function public\.([a-z_0-9]+)\(([^)]*)\)/g)) {
      const types = m[2].split(',').map((s) => s.trim()).filter(Boolean).map((a) => {
        const noDefault = a.replace(/\s+default\s+.*$/i, '');
        const type = noDefault.replace(/^[a-z_0-9]+\s+/i, '');                  // drop the parameter name
        return type.replace(/^double precision$/i, 'float8').replace(/^integer$/i, 'int').replace(/\s+/g, ' ').toLowerCase();
      });
      sigs.set(m[1], { types, file: f });
    }
  }
  return sigs;
}

test('every database call db.ts makes names a function that exists with exactly the argument types db.ts sends (the latest definition in the migrations)', () => {
  const src = read('supabase/functions/connect/db.ts');
  const sigs = latestSignatures();
  const calls = [...src.matchAll(/\.fn(?:<[^>]*>)?\(\s*"([a-z_0-9]+)",\s*\[((?:\s*"[^"]*"\s*,?)*)\s*\]/g)].map((m) => ({ name: m[1], types: [...m[2].matchAll(/"([^"]*)"/g)].map((x) => x[1].toLowerCase()) }));
  assert.ok(calls.length >= 40, 'db.ts names about 45 functions; the pattern found ' + calls.length);
  for (const c of calls) {
    const s = sigs.get(c.name);
    assert.ok(s, `${c.name} is not defined in any migration`);
    assert.deepEqual(c.types, s.types, `${c.name}: db.ts sends ${JSON.stringify(c.types)} but ${s.file} defines ${JSON.stringify(s.types)}`);
  }
  // none of the functions db.ts names takes an owner or a user (the person is resolved in the database from the token's hash)
  for (const c of calls) assert.ok(!/owner|user/i.test(c.name), c.name);
});

test('the database layer escapes a text[] literal (quotes and backslashes), sends jsonb as JSON text exactly once whatever the value (array, object, null), and never sends undefined', async () => {
  const seen = [];
  const db = new ConnectDb(async (sql, params) => { seen.push({ sql, params }); return [{ r: 'rgc_x' }]; }, 'https://x.example/app/');
  await db.authStore().registerClient('Claude', ['https://a.example/b"c', 'https://a.example/d\\e']);
  assert.equal(seen[0].params[1], '{"https://a.example/b\\"c","https://a.example/d\\\\e"}');
  const data = db.data({ tokenHash: 'h'.repeat(64) });
  seen.length = 0;
  await data.saveStory('11111111-1111-4111-8111-111111111111', { schema: 1, notes: 'a "quoted" \\ word' });
  assert.deepEqual(JSON.parse(seen[0].params[2]), { schema: 1, notes: 'a "quoted" \\ word' });
  seen.length = 0;
  await data.askGeoShape({ shape: 'where_to_go', category: 'cafes' });
  assert.deepEqual(seen[0].params, ['h'.repeat(64), 'where_to_go', null, null, null, null, 'cafes', null]);
  for (const call of seen) assert.ok(call.params.every((x) => x !== undefined), 'postgres.js refuses an undefined parameter');
});

// ---------------------------------------------------------------------------------------------- 2. every connector / editor function keeps definer + an empty search path
test('every connector, editor, panel and film-card SQL function is created with an empty search_path, and every public connect_* / editor one is security definer', () => {
  const NAMES = /^(public\.(connect_|editor_|my_edit|node_edit|my_film_card|claim_next_film|finish_film|fail_film|film_card)|ryagram_private\.(edit_|chat_editor|connect_|apply_edit|undo_edit|film_card))/;
  let n = 0;
  const bad = [];
  for (const f of migrations) {
    const t = lf(fs.readFileSync(new URL(f, MIG_DIR), 'utf8'));
    for (const m of t.matchAll(/create (?:or replace )?function\s+((?:public|ryagram_private)\.[a-z_0-9]+)\s*\(([\s\S]*?)\$(\$|fn\$)/g)) {
      if (!NAMES.test(m[1])) continue;
      n++;
      if (!/set search_path\s*=\s*''/.test(m[0])) bad.push(`${f}: ${m[1]} has no empty search_path`);
      if (m[1].startsWith('public.') && !/security definer/.test(m[0])) bad.push(`${f}: ${m[1]} is not security definer`);
    }
  }
  assert.ok(n >= 90, 'about 97 functions are checked; found ' + n);
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------------------------------------- 3. the live editor's purge is scheduled by the daily connector purge
test('20261120000100: connect_purge also runs ryagram_private.edit_purge (nothing else in the repository ever called it), keeps its four counts, is safe without the live editor, and the rollback restores the old body', () => {
  const mig = lf(read('supabase/migrations/20261120000100_connect_purge_edit.sql'));
  const body = mig.slice(mig.indexOf('create or replace function public.connect_purge()'));
  assert.match(mig, /NOT APPLIED/); assert.match(mig, /UNRUN/);
  assert.match(body, /to_regprocedure\('ryagram_private\.edit_purge\(\)'\) is not null/);
  assert.match(body, /execute 'select ryagram_private\.edit_purge\(\)' into e/);
  assert.match(body, /jsonb_build_object\('requests', a, 'codes', b, 'tokens', c, 'calls', d, 'edit', e\)/);
  for (const t of ['connect_requests', 'connect_codes', 'connect_tokens', 'connect_calls', 'connect_buckets', 'connect_clients']) assert.match(body, new RegExp('delete from public\\.' + t));
  assert.match(body, /language plpgsql security definer set search_path = ''/);
  assert.match(mig.trimEnd(), /select ryagram_private\.gate_apply\(\);[^\n]*\n\ncommit;$/, 'a migration after the waiting list ends with the gate');
  assert.doesNotMatch(mig, /\bgrant\b/i, 'create or replace keeps the old owner and grants; nothing is granted here');
  // the same deletes as the original, so only the one call and the one key are new
  const orig = lf(read('supabase/migrations/20261018000100_connect_ai.sql'));
  for (const line of orig.slice(orig.indexOf('create function public.connect_purge()'), orig.indexOf('Realtime guard')).split('\n').filter((l) => /^\s+delete from|^\s+and not exists/.test(l))) {
    assert.ok(body.includes(line.trim()), 'lost a line of the original purge: ' + line.trim());
  }
  // and the thing it calls exists and is the one the live editor promises ("dropped 24 hours after the editor was last open", "the log keeps 7 days")
  const ed = lf(read('supabase/migrations/20261027000400_live_editor.sql'));
  assert.match(ed, /create function ryagram_private\.edit_purge\(\) returns jsonb/);
  assert.match(ed, /coalesce\(editor_seen_at, updated_at\) < now\(\) - interval '24 hours'/);
  assert.match(ed, /delete from public\.edit_ops where created_at < now\(\) - interval '7 days'/);
  // no other migration, Edge Function or step ever called it (this is what the audit found): after this file exactly one caller exists
  const callers = migrations.filter((f) => /ryagram_private\.edit_purge\(\)/.test(read('supabase/migrations/' + f)) && !/live_editor\.sql$/.test(f));
  // (and the prepared-data purge migration 20261120000600, which redefines connect_purge as this function plus ONE more guarded call, so it keeps the editor call: tests/connect-prepared-purge.test.mjs pins that it is this function exactly plus that call)
  assert.deepEqual(callers, ['20261120000100_connect_purge_edit.sql', '20261120000600_prepared_purge_daily.sql']);
  const rb = lf(read('supabase/rollbacks/20261120000100_connect_purge_edit_rollback.sql'));
  assert.doesNotMatch(rb.replace(/--[^\n]*/g, ''), /edit_purge/);
  assert.ok(!rb.replace(/--[^\n]*/g, '').includes("'edit'"));
  assert.match(rb, /jsonb_build_object\('requests', a, 'codes', b, 'tokens', c, 'calls', d\)/);
  const chk = read('supabase/live-steps/30_connect_purge_edit_after_check.sql');
  assert.match(chk, /AFTER 20261120000100_connect_purge_edit\.sql/); assert.match(chk, /edit_purge/);
  assert.match(chk, /NOT APPLIED/);
});

// ---------------------------------------------------------------------------------------------- 4. the plan asks: one lock per person, a real host
test('20261120000200: download and footage plan asks take the per-person advisory lock AFTER checking the arguments and BEFORE every count, like the place questions and the film cards', () => {
  const mig = lf(read('supabase/migrations/20261120000200_plan_asks_lock_and_host.sql'));
  const dl = mig.slice(mig.indexOf('create or replace function public.connect_request_download'), mig.indexOf('create or replace function public.connect_request_footage'));
  const fo = mig.slice(mig.indexOf('create or replace function public.connect_request_footage'));
  assert.match(mig, /NOT APPLIED/); assert.match(mig, /UNRUN/);
  const lockDl = "perform pg_advisory_xact_lock(hashtextextended('download:' || me::text, 0));";
  const lockFo = "perform pg_advisory_xact_lock(hashtextextended('footage:' || me::text, 0));";
  assert.equal(dl.split(lockDl).length - 1, 1); assert.equal(fo.split(lockFo).length - 1, 1);
  const at = (s, x) => { const i = s.indexOf(x); assert.ok(i >= 0, x); return i; };
  // downloads: arguments checked, then the lock, then both counts, then the insert
  assert.ok(at(dl, "p_folder is null or") < at(dl, lockDl));
  assert.ok(at(dl, lockDl) < at(dl, 'select count(*) into waiting'));
  assert.ok(at(dl, 'select count(*) into waiting') < at(dl, 'select count(*) into today'));
  assert.ok(at(dl, 'select count(*) into today') < at(dl, 'insert into public.download_plans'));
  // footage: switch and arguments checked, then the lock, then "the same item already waiting", then both counts, then the insert
  assert.ok(at(fo, 'footage_on()') < at(fo, lockFo) && at(fo, 'p_why is null or') < at(fo, lockFo));
  assert.ok(at(fo, lockFo) < at(fo, 'select * into same'));
  assert.ok(at(fo, 'select * into same') < at(fo, 'select count(*) into waiting'));
  assert.ok(at(fo, 'select count(*) into today') < at(fo, 'insert into public.footage_plans'));
  // nothing else about either function changed: the same scope, limits, sentences and owner check
  const dlOrig = lf(read('supabase/migrations/20261027000500_download_plans.sql'));
  const foOrig = lf(read('supabase/migrations/20261030000200_footage_plans.sql'));
  const one = (t, name) => { const i = t.indexOf('create function public.' + name + '('); return t.slice(i, t.indexOf('\ncreate function', i + 10)); };
  for (const [neu, orig, name] of [[dl, one(dlOrig, 'connect_request_download'), 'download'], [fo, one(foOrig, 'connect_request_footage'), 'footage']]) {
    const lines = (t) => new Set(t.split('\n').map((l) => l.trim()).filter((l) => /^(raise exception|select count|insert into|values|returning|return jsonb|select \* into same|if (waiting|today))/.test(l)));
    const o = lines(orig), n = lines(neu);
    for (const l of o) assert.ok(n.has(l), `${name}: the new function lost: ${l}`);
  }
  assert.match(dl, /connect_actor\(p_token_hash, 'fetch_data'\)/); assert.match(fo, /connect_actor\(p_token_hash, 'fetch_data'\)/);
  assert.match(dl, /language plpgsql security definer set search_path = ''/); assert.match(fo, /language plpgsql security definer set search_path = ''/);
  assert.doesNotMatch(mig, /^\s*(grant|revoke)\b/im, 'create or replace keeps the owner and grants');
  assert.match(mig.trimEnd(), /select ryagram_private\.gate_apply\(\);[^\n]*\n\ncommit;$/);
  // the rollback has the original bodies: no lock, no new host rule
  const rb = lf(read('supabase/rollbacks/20261120000200_plan_asks_lock_and_host_rollback.sql'));
  assert.ok(!/pg_advisory_xact_lock/.test(rb.replace(/--[^\n]*/g, '')) && !rb.includes('(localhost|local|internal|lan)'));
  assert.ok(rb.includes("if host ~ '^[0-9.]+$' then") && rb.includes("where owner_id = me and source = p_source and item_id = p_item_id and state in ('waiting', 'downloading')"));
  assert.match(read('supabase/live-steps/31_plan_asks_lock_and_host_after_check.sql'), /AFTER 20261120000200_plan_asks_lock_and_host\.sql/);
  // both functions were already granted to the connector login only; nothing here could widen that
  assert.match(dlOrig, /grant execute on function public\.connect_request_download\(text, text, text, text\), public\.connect_list_downloads\(text\) to connect_runner/);
});

test('20261120000200 and downloadUrlProblem carry the SAME host rule: the last label starts with a letter and is not localhost, local, internal or lan', () => {
  const mig = lf(read('supabase/migrations/20261120000200_plan_asks_lock_and_host.sql'));
  assert.ok(mig.includes("if host !~ '\\.[a-z][a-z0-9-]*$' or host ~ '\\.(localhost|local|internal|lan)$' then"));
  const ok = ['https://www.census.gov/data/counties.csv', 'https://example.org', 'https://a.b.c.example.co.uk/path%20x/file.parquet', 'https://data.example.org/x/y.zip?year=2020', 'https://xn--p1ai.xn--p1ai/x.csv', 'https://stats.my-agency.gov/a'];
  for (const u of ok) assert.equal(downloadUrlProblem(u), null, u);
  const bad = ['https://files.localhost/a.csv', 'https://printer.local/a.csv', 'https://db.internal/a.csv', 'https://nas.lan/a.csv', 'https://NAS.LAN/a.csv', 'https://x.example.localhost/a.csv',
    'https://0x7f.0.0.1/a.csv', 'https://0177.0.0.1/a.csv', 'https://1.0x7f/a.csv', 'https://127.1/a.csv', 'https://93.184.216.34/a.csv', 'https://localhost/a.csv', 'https://www.census.gov:8443/a.csv', 'https://u:p@www.census.gov/a.csv'];
  for (const u of bad) assert.ok(downloadUrlProblem(u), 'should be refused: ' + u);
  // the sentence says why, in plain words
  assert.match(downloadUrlProblem('https://nas.lan/a.csv'), /public website name/);
  // the same regexes, as the database will run them (JavaScript and the database's POSIX regex agree on these simple classes)
  const sqlTail = /\.[a-z][a-z0-9-]*$/, sqlReserved = /\.(localhost|local|internal|lan)$/;
  for (const u of ok) { const h = new URL(u).hostname.toLowerCase(); assert.ok(sqlTail.test(h) && !sqlReserved.test(h), h); }
  for (const u of ['https://files.localhost/a', 'https://printer.local/a', 'https://0x7f.0.0.1/a']) { const h = u.slice(8).split('/')[0].toLowerCase(); assert.ok(!sqlTail.test(h) || sqlReserved.test(h), h); }
});

// ---------------------------------------------------------------------------------------------- 5. rate-limit buckets
test('every rate-limit bucket the tools and the gate name is one connect_hit accepts, and every window is one it accepts', () => {
  const sql = lf(read('supabase/migrations/20261018000100_connect_ai.sql'));
  assert.ok(sql.includes("p_bucket !~ '^[a-z0-9_:]{1,40}$' or p_window_s not between 1 and 86400"));
  let n = 0;
  for (const f of ['tools.ts', 'dispatch.ts', 'editor_tools.ts']) {
    const src = read('supabase/functions/connect-core/' + f);
    for (const m of src.matchAll(/\.hit\(\s*[A-Za-z.]+\s*,\s*"([^"]+)"\s*,\s*([^,]+),\s*([0-9]+)\)/g)) {
      n++;
      assert.match(m[1], /^[a-z0-9_:]{1,40}$/, m[1]);
      assert.ok(Number(m[3]) >= 1 && Number(m[3]) <= 86400, m[1] + ' window ' + m[3]);
    }
  }
  assert.ok(n >= 10, 'found ' + n + ' limit calls');
});
