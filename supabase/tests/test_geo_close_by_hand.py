"""Closing an account by hand (GEO 2026-11-23, migrations/20261123000700_account_close_by_hand.sql, live step 64; CC1 17:07: after Wednesday).

On the 2B ledger's database (a verified stranger's welcome grant makes the login un-deletable: credit_ledger.owner_id is ON DELETE RESTRICT).
The test stub's auth.users is minimal, so the test adds STAND-INS for the hosted Supabase parts the function looks for (phone, encrypted_password,
a sign-in token, deleted_at on auth.users; auth.identities, auth.sessions and auth.one_time_tokens), then proves:
  * only the database owner can call it (anon, a signed-in person and the service role are refused);
  * it REFUSES, changing nothing, for an owner without an open request, and a second time for the same owner;
  * on close: the email and phone are NULL, the password NULL, the token '', the person's metadata '{}', deleted_at set; the identity's data '{}'
    and its provider_id 'closed:<id>:<provider>'; the session and the one-time token are gone; the request has closed_at and no email;
    the ledger rows are untouched; another person's login, identity and session are untouched;
  * live step 64's three parts as Ryan pastes them (part 1 lists the open request; part 3 reads true, true, true after part 2);
  * live step 58's row 11 counts the open request, then 0 after the close;
  * the rollback drops the function and the column, never errors.
Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_geo_close_by_hand.py -v
"""
import re
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as credits  # noqa: E402

RYAN, OTHER = core.RYAN, core.OTHER
STEP64 = core.ROOT / "live-steps" / "64_account_close_by_hand.sql"
STEP58 = core.ROOT / "live-steps" / "58_wednesday_watch.sql"
MIG = core.ROOT / "migrations" / "20261123000700_account_close_by_hand.sql"
RB = core.ROOT / "rollbacks" / "20261123000700_account_close_by_hand_rollback.sql"
STANDINS = """
alter table auth.users add column if not exists phone text, add column if not exists encrypted_password text,
  add column if not exists recovery_token text, add column if not exists deleted_at timestamptz, add column if not exists banned_until timestamptz;
create table if not exists auth.identities (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id),
  provider_id text not null, provider text not null, identity_data jsonb not null, unique (provider_id, provider));
create table if not exists auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id));
create table if not exists auth.one_time_tokens (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users (id), token_hash text);
create schema if not exists cron;
create table if not exists cron.job (jobid serial primary key, jobname text unique, schedule text, command text, active boolean not null default true);
create table if not exists cron.job_run_details (jobid int, status text, start_time timestamptz not null default now());
create schema if not exists net;
create table if not exists net._http_response (id bigint primary key, status_code int, content text, created timestamptz not null default now());
"""


def setUpModule():
    credits.setUpModule()


def parts():
    chunks = re.split(r"^-- PART \d.*$", STEP64.read_text(encoding="utf-8"), flags=re.M)[1:]
    assert len(chunks) == 3, len(chunks)
    return [c.strip() for c in chunks]


class CloseByHand(unittest.TestCase):
    setUp = credits.Ledger.setUp
    tearDown = credits.Ledger.tearDown

    def d(self):
        return self.db.as_(None).c

    def one(self, sql, *args):
        return self.db.as_(None).one(sql, *args)

    def person(self, who, mail):
        self.d().execute("update auth.users set phone = '+15550100', encrypted_password = 'hash', recovery_token = 'tok', banned_until = now() + interval '876000 hours', "
                         "raw_user_meta_data = %s::jsonb where id = %s", ('{"adult_confirmed": true, "name": "x"}', who))
        self.d().execute("insert into auth.identities (user_id, provider_id, provider, identity_data) values (%s, %s, 'email', %s::jsonb)",
                         (who, who, '{"email": "%s", "sub": "%s"}' % (mail, who)))
        self.d().execute("insert into auth.sessions (user_id) values (%s)", (who,))
        self.d().execute("insert into auth.one_time_tokens (user_id, token_hash) values (%s, 'h')", (who,))

    def row11(self):
        rows = {r[0]: r[1] for r in self.d().execute(STEP58.read_text(encoding="utf-8")).fetchall()}
        return rows["account deletions waiting for YOU to close by hand"]

    def test_GEO_close_by_hand_ends_the_login_keeps_the_ledger_and_refuses_twice(self):
        self.d().execute(STANDINS)
        self.person(RYAN, "ryan@x")
        self.person(OTHER, "other@x")
        self.db.as_("service").one("select grant_credits(%s, 'grant', 8, 'Welcome credits', 'welcome:t', null, null, null)", RYAN)
        ledger = self.one("select count(*) from credit_ledger where owner_id = %s", RYAN)
        with self.assertRaises(psycopg.Error):
            self.one("delete from auth.users where id = %s returning 1", RYAN)                  # why a close is needed at all
        # nothing to close yet: refused, nothing changed
        with self.assertRaises(psycopg.Error) as cm:
            self.one("select account_close_by_hand(%s)", RYAN)
        self.assertIn("No open deletion request", str(cm.exception))
        self.assertEqual(self.one("select email from auth.users where id = %s", RYAN), "ryan@x")
        self.db.as_("service").one("select account_request_deletion(%s, 'ryan@x', 'credit history') is null", RYAN)
        for who in ("anon", RYAN, "service"):
            with self.subTest(who=who), self.assertRaises(psycopg.Error):
                self.db.as_(who).one("select account_close_by_hand(%s)", RYAN)
        self.assertTrue(self.row11().startswith("1 waiting"))
        p1, p2, p3 = parts()
        self.assertEqual([r[0] for r in self.d().execute(p1).fetchall()], [__import__("uuid").UUID(RYAN)], "part 1 lists the open request")
        out = self.d().execute(p2.replace("<owner_id>", RYAN)).fetchone()[0]
        self.assertTrue(out["closed"])
        self.assertEqual(self.d().execute(p3.replace("<owner_id>", RYAN)).fetchall(), [(True,) * 8], "part 3 after the close: every cell true")
        self.assertEqual(self.one("select email, phone, encrypted_password, recovery_token, raw_user_meta_data, deleted_at is not null from auth.users where id = %s", RYAN),
                         (None, None, None, "", {}, True))
        self.assertEqual(self.one("select identity_data, provider_id from auth.identities where user_id = %s", RYAN), ({}, f"closed:{RYAN}:email"))
        self.assertEqual(self.one("select (select count(*) from auth.sessions where user_id = %s) + (select count(*) from auth.one_time_tokens where user_id = %s)", RYAN, RYAN), 0)
        self.assertEqual(self.one("select closed_at is not null and email is null from account_deletion_requests where owner_id = %s", RYAN), True)
        self.assertEqual(self.one("select count(*) from credit_ledger where owner_id = %s", RYAN), ledger, "the ledger is untouched")
        self.assertEqual(self.one("select email, phone from auth.users where id = %s", OTHER), ("other@x", "+15550100"), "another person untouched")
        self.assertEqual(self.one("select count(*) from auth.sessions where user_id = %s", OTHER), 1)
        self.assertEqual(self.one("select identity_data ->> 'email' from auth.identities where user_id = %s", OTHER), "other@x")
        self.assertTrue(self.row11().startswith("0 waiting"), "row 11 counts only open requests")
        with self.assertRaises(psycopg.Error):                                                   # closing twice is refused
            self.one("select account_close_by_hand(%s)", RYAN)
        self.d().execute(RB.read_text(encoding="utf-8"))
        self.assertIsNone(self.one("select to_regprocedure('public.account_close_by_hand(uuid)')"))
        self.assertEqual(self.one("select count(*) from information_schema.columns where table_name = 'account_deletion_requests' and column_name = 'closed_at'"), 0)
        # hosted Supabase grants every new public function to anon, authenticated AND service_role by default (the stub does not);
        # re-applied under that default, the migration's own revoke must still leave the database owner as the only caller
        self.d().execute("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role")
        self.d().execute(MIG.read_text(encoding="utf-8"))
        for role in ("anon", "authenticated", "service_role"):
            with self.subTest(role=role):
                self.assertFalse(self.one("select has_function_privilege(%s, 'public.account_close_by_hand(uuid)', 'execute')", role))


if __name__ == "__main__":
    unittest.main()
