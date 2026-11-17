// The site's film look card functions and the connector's are TWINS (CONNECT, 2026-11-17; GEO's LOW finding on the site card): my_film_card_ask / my_film_card_get (migration 20261113000500, for the signed-in session)
// are the same two operations as connect_film_card_ask / connect_film_card_get (migration 20261109000100, for a connector token): the same request row, the same limits, the same lock key, the same answers.
// The database tests (supabase/tests/test_my_film_cards.py) prove it by running both, but they need a database and are skipped on a machine without one; this test holds the TEXT: it reads the migrations, takes the LAST
// definition of each function (a later create or replace counts), drops comments, and says the two bodies are word for word the same except the two things that must differ (who the person is, and the argument list).
// A rule changed in one twin and not the other (a limit, a lock, the ten minutes, a column of the answer) fails here. Must-fails: tests/film_card_twins_mutants.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const DIR = new URL('../supabase/migrations/', import.meta.url);
const FILES = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

// The last definition of public.<name>: from "create [or replace] function public.<name>(" to the first line that is "end $$;".
export function definition(name, files = FILES, read = (f) => fs.readFileSync(new URL(f, DIR), 'utf8')) {
  const re = new RegExp(`create (?:or replace )?function public\\.${name}\\(([^)]*)\\)[\\s\\S]*?\\nend \\$\\$;`, 'g');
  let last = null;
  for (const f of files) {
    const text = read(f).replace(/\r\n/g, '\n');
    for (const m of text.matchAll(re)) last = { file: f, text: m[0], args: m[1] };
  }
  return last;
}

// Comments out, spaces collapsed; the two allowed differences replaced by the same marker so the rest can be compared as it stands.
export function normal(def, who) {
  let s = def.text.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  s = s.replace(/\s+/g, ' ').trim();
  assert.equal(s.split(who).length - 1, 1, `${def.file}: the line that says who the person is must be there exactly once`);
  s = s.replace(who, '<WHO>');
  s = s.replace(/^create (?:or replace )?function public\.\w+\([^)]*\)/, 'create function <NAME>(<ARGS>)');
  return s;
}

const TWINS = [['ask', 'my_film_card_ask', 'connect_film_card_ask'], ['get', 'my_film_card_get', 'connect_film_card_get']];
const SITE_WHO = 'ryagram_private.require_signed_in()';
const CONNECTOR_WHO = "ryagram_private.connect_actor(p_token_hash, 'read')";

for (const [what, mine, theirs] of TWINS) {
  test(`${mine} is ${theirs} word for word, except who the person is and the argument list`, () => {
    const a = definition(mine), b = definition(theirs);
    assert.ok(a, `${mine} is defined in a migration`);
    assert.ok(b, `${theirs} is defined in a migration`);
    assert.match(a.args, /^p_project uuid$/, `${mine} takes the project and nothing else (the caller never types the story or the person)`);
    assert.match(b.args, /^p_token_hash text, p_project uuid$/, `${theirs} takes the token's hash and the project`);
    const x = normal(a, SITE_WHO), y = normal(b, CONNECTOR_WHO);
    assert.equal(x, y, `the ${what} twins differ in more than who the person is:\n  site:      ${x}\n  connector: ${y}`);
  });
}

test('the ask twins take the same advisory lock key, so a chat ask and a site ask at the same instant are counted one after the other', () => {
  for (const name of ['my_film_card_ask', 'connect_film_card_ask']) {
    const d = definition(name);
    assert.ok(d.text.includes("pg_advisory_xact_lock(hashtextextended('film_card:' || me::text, 0))"), `${name} takes the one lock key`);
  }
});

test('a later create or replace of one twin is the one compared: the last definition wins', () => {
  const files = { 'a.sql': "create function public.demo_x(p_project uuid) returns int language sql as $$\nselect 1\nend $$;\n", 'b.sql': "create or replace function public.demo_x(p_project uuid) returns int language sql as $$\nselect 2\nend $$;\n" };
  const d = definition('demo_x', ['a.sql', 'b.sql'], (f) => files[f]);
  assert.equal(d.file, 'b.sql');
  assert.match(d.text, /select 2/);
});
