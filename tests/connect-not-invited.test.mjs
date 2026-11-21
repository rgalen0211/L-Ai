// What the SERVER does for an account that is NOT invited to connect an AI (CONNECT, 2026-11-21; WEB's dead-end sweep, proposals/WEB-DEAD-END-SWEEP-1121.md, rows 1, 2, 3, 5, 8, 9).
// The site's buttons and help words about "Connect your AI", "Ask my AI" and "Tell me when it's ready" are only honest while these server facts hold, so they are pinned here from the SQL itself:
// if one of them changes, the words on the site must be rethought, and this test says so. Read-only: it reads the migrations, runs nothing and talks to nothing.
// Must-fails: tests/connect_not_invited_mutants.mjs. The plain-words summary for WEB and Ryan: proposals/CONNECT-SWEEP-ROWS-1121.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const DIR = new URL('../supabase/migrations/', import.meta.url);
const ALL = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort().map((f) => ({ f, t: fs.readFileSync(new URL(f, DIR), 'utf8').replace(/\r\n/g, '\n') }));
/** The LAST definition of a function (a later migration may replace an earlier one), from its create line to its closing "end $$;" (or the "$$;" of a one-line sql function). */
function fn(schema, name) {
  const re = new RegExp('create (?:or replace )?function ' + schema + '\\.' + name + '\\([^)]*\\)[\\s\\S]*?\\n(?:end )?\\$\\$;', 'g');
  let last = null;
  for (const { f, t } of ALL) for (const m of t.matchAll(re)) last = { file: f, body: m[0] };
  assert.ok(last, `no definition of ${schema}.${name} in the migrations`);
  return last;
}

test('the person\'s OWN editor works for any signed-in account: its five functions need a signed-in app session and never the AI-invite rule (so a person not invited to connect an AI can still edit their own film on the site)', () => {
  for (const n of ['editor_apply_ops', 'editor_undo', 'editor_undo_all_ai', 'my_edit_ops_since', 'editor_heartbeat']) {
    const { body, file } = fn('public', n);
    assert.ok(body.includes('ryagram_private.connect_app_session()'), `${n} (${file}) reads the person from their own app session`);
    assert.ok(!/connect_person_ok|department_person_ok|connect_access/.test(body), `${n} (${file}) is not gated on the invite list`);
  }
  const s = fn('ryagram_private', 'connect_app_session').body;
  assert.ok(/client_id/.test(s) && /require_signed_in\(\)/.test(s), 'the app session refuses a token that carries a client id, and needs a signed-in person');
  assert.ok(!/connect_person_ok|connect_access/.test(s), 'and nothing about the invite list');
});

test('"invited" is ONE rule: enabled in the connect_access list, not an admin, not a worker; the departments helper and the consent page both use it, and the consent page says "invite-only for now" in words', () => {
  const ok = fn('ryagram_private', 'connect_person_ok').body;
  assert.ok(/connect_access a where a\.user_id = p_owner and a\.enabled/.test(ok), 'enabled in the list');
  assert.ok(/app_admins/.test(ok) && /public\.workers/.test(ok), 'an admin and a worker are never "invited"');
  assert.ok(fn('ryagram_private', 'department_person_ok').body.includes('ryagram_private.connect_person_ok(p_owner)'), 'the departments helper IS the connect rule');
  const consent = ALL.find(({ f }) => f === '20261018000100_connect_ai.sql').t;
  assert.ok(consent.includes("not enabled for AI assistants yet (invite-only for now)."), 'a person who is not invited is told so on the consent page');
  assert.ok(consent.includes('Administrator accounts cannot be connected to an AI assistant.'), 'and an administrator is told that');
});

test('"Tell me when it\'s ready": for an account that is not invited the server answers [] for its departments and REFUSES to register interest with PT403 and the words "This is for invited accounts for now." (so a site button that offers it to such an account can never work)', () => {
  const d = fn('ryagram_private', 'departments_for').body;
  assert.ok(/where ryagram_private\.department_person_ok\(p_owner\)/.test(d), 'no rows for an account that is not invited');
  const r = fn('public', 'register_department_interest').body;
  assert.ok(r.includes("if not ryagram_private.department_person_ok(me) then raise exception 'This is for invited accounts for now.' using errcode = 'PT403'; end if;"), 'refused, with those words');
  assert.ok(/'That is not announced yet\.' using errcode = 'PT404'/.test(r) && r.includes("x.id = p_department and x.status = 'soon'"), 'and only a department announced as soon can be registered');
  assert.ok(/department_person_ok\(auth\.uid\(\)\)/.test(fn('public', 'my_department_interests').body), 'a list of interests is read only for an invited account');
});
