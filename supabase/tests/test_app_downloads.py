"""The invite-only app download (migrations/20261026000500_app_downloads.sql, NOT APPLIED) on a local Postgres. NEXT-CONNECT 133, re-aimed at Cloudflare R2.

Same setup as test_2a_core.py. Run from the repo root with the SQL venv and TEMP/TMP on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_app_downloads.py -v

Rules proved (each with a control that passes and a fault that must be refused)
  * only an invited TESTER (or an admin) is handed a link; a plain account, a worker login and nobody are refused and NOTHING is written
  * at most 3 links in 24 hours (the 4th is refused, no row); a link older than a day no longer counts
  * the release must be active; at most one release can be active; a key with '..', a leading slash or a double slash, and a bad file name or hash, cannot be stored
  * the answer carries only: link id, file name, size, SHA-256, object key, 900 seconds; the row records who and when and NO address
  * the tables are readable by nobody (not signed-in people, not anon, not the service role); request_app_download is the service role's alone (also under Supabase's real default privileges);
    a person lists only their OWN links (time and file name, never the key)
"""
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
from test_2a_core import OTHER, RYAN, WORKER, setUpModule  # noqa: E402,F401  (setUpModule is what unittest calls)

TESTER, PLAIN, ADMIN = (str(uuid.UUID(int=i)) for i in (301, 302, 303))
SHA = "a" * 64
KEYS = {"link_id", "kind", "file_name", "size_bytes", "sha256", "object_key", "expires_seconds"}


class AppDownloads(core.Base):
    def setUp(self):
        super().setUp()
        c = self.db.as_(None).c
        c.execute("insert into auth.users (id, email) values (%s,'tester@x'),(%s,'plain@x'),(%s,'admin@x')", (TESTER, PLAIN, ADMIN))
        c.execute("insert into public.account_settings (owner_id, local_compute) values (%s, true) on conflict (owner_id) do update set local_compute = true", (TESTER,))
        c.execute("insert into public.account_settings (owner_id, local_compute) values (%s, false) on conflict (owner_id) do update set local_compute = false", (PLAIN,))
        c.execute("insert into public.app_admins (user_id) values (%s)", (ADMIN,))
        c.execute("insert into public.workers (user_id, name) values (%s, 'ryan-pc') on conflict do nothing", (WORKER,))
        c.execute("insert into public.account_settings (owner_id, local_compute) values (%s, true) on conflict (owner_id) do update set local_compute = true", (WORKER,))
        self.release = self.add_release()

    def admin(self, sql, *args):
        self.db.c.execute("reset role")
        row = self.db.c.execute(sql, args).fetchone()
        return row[0] if row and len(row) == 1 else row

    def add_release(self, active=True, key="releases/app-1.zip", name="app-1.zip", size=273939672, sha=SHA, kind="app"):
        return self.admin("insert into public.app_releases (kind, file_name, size_bytes, sha256, object_key, active) values (%s, %s, %s, %s, %s, %s) returning id", kind, name, size, sha, key, active)

    def ask(self, who, kind="app"):
        return self.db.as_("service").one("select request_app_download(%s::uuid, %s)", who, kind)

    def rows(self):
        return self.admin("select count(*) from public.app_downloads")

    def test_an_invited_tester_and_an_admin_get_a_link_and_it_is_recorded(self):
        got = self.ask(TESTER)
        self.assertEqual(set(got), KEYS)
        self.assertEqual((got["file_name"], got["size_bytes"], got["sha256"], got["object_key"], got["expires_seconds"]), ("app-1.zip", 273939672, SHA, "releases/app-1.zip", 900))
        self.assertEqual(self.admin("select owner_id::text from public.app_downloads where id = %s", got["link_id"]), TESTER)
        self.assertEqual(self.admin("select (expires_at - asked_at) = interval '15 minutes' from public.app_downloads where id = %s", got["link_id"]), True)
        self.assertEqual(set(self.ask(ADMIN)), KEYS)
        self.assertEqual(self.rows(), 2)

    def test_a_plain_account_a_worker_and_nobody_are_refused_and_nothing_is_written(self):
        for who, code in ((PLAIN, "PT403"), (WORKER, "PT403"), (OTHER, "PT403"), (None, "PT401")):
            with self.assertRaises(psycopg.Error, msg=str(who)) as cm:
                self.ask(who)
            self.assertEqual(cm.exception.sqlstate, code, str(who))
        self.assertEqual(self.rows(), 0)
        self.assertEqual(set(self.ask(TESTER)), KEYS)                                  # control

    def test_three_links_a_day_and_the_fourth_is_refused(self):
        for _ in range(3):
            self.ask(TESTER)
        with self.assertRaises(psycopg.Error) as cm:
            self.ask(TESTER)
        self.assertEqual(cm.exception.sqlstate, "PT429")
        self.assertIn("three times", str(cm.exception))
        self.assertEqual(self.rows(), 3)
        self.assertEqual(set(self.ask(ADMIN)), KEYS)                                    # another account is not held back
        self.admin("update public.app_downloads set asked_at = now() - interval '25 hours' where owner_id = %s returning 1", TESTER)
        self.assertEqual(set(self.ask(TESTER)), KEYS)                                   # older than a day no longer counts

    def test_each_kind_has_its_own_active_release_and_its_own_daily_limit(self):
        self.add_release(kind='addon', key='releases/forge-addon.zip', name='forge-addon.zip', size=4537)
        self.add_release(kind='notices', key='releases/notices.txt', name='notices.txt', size=295826)
        got = {k: self.ask(TESTER, k) for k in ('app', 'addon', 'notices')}
        self.assertEqual({k: v['file_name'] for k, v in got.items()}, {'app': 'app-1.zip', 'addon': 'forge-addon.zip', 'notices': 'notices.txt'})
        self.assertEqual({v['kind'] for v in got.values()}, {'app', 'addon', 'notices'})
        for _ in range(2):
            self.ask(TESTER, 'addon')
        with self.assertRaises(psycopg.Error) as cm:
            self.ask(TESTER, 'addon')                                                     # the fourth add-on link in a day
        self.assertEqual(cm.exception.sqlstate, 'PT429')
        self.assertEqual(self.ask(TESTER, 'app')['kind'], 'app')                            # the app's own count is separate
        for bad in ('zip', None, '', 'APP'):
            with self.assertRaises(psycopg.Error, msg=str(bad)) as cm:
                self.ask(TESTER, bad)
            self.assertEqual(cm.exception.sqlstate, 'PT404')
            self.assertIn('not a download this page offers', str(cm.exception), str(bad))                # the kind itself is refused, not merely 'no release'
        with self.assertRaises(psycopg.errors.UniqueViolation):
            self.add_release(kind='addon', key='releases/other-addon.zip', name='other-addon.zip')       # a second active add-on
        with self.assertRaises(psycopg.errors.CheckViolation):
            self.add_release(active=False, kind='program', key='releases/x.zip', name='x.zip')           # not a kind

    def test_the_release_must_be_active_and_only_one_can_be(self):
        self.admin("update public.app_releases set active = false returning 1")
        with self.assertRaises(psycopg.Error) as cm:
            self.ask(TESTER)
        self.assertEqual(cm.exception.sqlstate, "PT404")
        self.assertEqual(self.rows(), 0)
        self.add_release(active=True, key="releases/app-2.zip", name="app-2.zip")
        self.assertEqual(self.ask(TESTER)["file_name"], "app-2.zip")
        with self.assertRaises(psycopg.errors.UniqueViolation):
            self.add_release(active=True, key="releases/app-3.zip", name="app-3.zip")      # a second active release

    def test_a_bad_key_file_name_size_or_hash_cannot_be_stored(self):
        for kw in (dict(key="../secret.zip"), dict(key="/abs.zip"), dict(key="a//b.zip"), dict(key="releases/a b.zip"), dict(name="../x.zip"), dict(name="x.exe"), dict(sha="A" * 64),
                   dict(sha="a" * 63), dict(size=0)):
            with self.assertRaises(psycopg.errors.CheckViolation, msg=str(kw)):
                self.add_release(active=False, **kw)
        self.add_release(active=False, key="releases/ok-2.zip", name="ok-2.zip")           # control

    def test_the_tables_are_closed_and_the_function_is_the_service_roles_alone(self):
        for who in ("anon", TESTER, "service"):
            for t in ("app_releases", "app_downloads"):
                with self.assertRaises(psycopg.Error, msg=f"{who} {t}"):
                    self.db.as_(who).one(f"select count(*) from public.{t}")
        for role in ("anon", "authenticated", "public"):
            self.assertFalse(self.admin(f"select has_function_privilege('{role}', 'public.request_app_download(uuid,text)', 'EXECUTE')"), role)
        self.assertTrue(self.admin("select has_function_privilege('service_role', 'public.request_app_download(uuid,text)', 'EXECUTE')"))
        with self.assertRaises(psycopg.Error):
            self.db.as_(TESTER).one("select request_app_download(%s::uuid)", TESTER)       # a signed-in person cannot call it, not even for themselves
        self.assertEqual(self.rows(), 0)

    def test_under_supabases_default_privileges_only_the_service_role_can_run_it(self):
        name = "ad" + str(abs(hash(self.id())) % 100000)
        with psycopg.connect(core._server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {name}")
        drop = ("revoke usage on schema public from anon, authenticated;", "revoke all on schema public from public;",
                "alter default privileges revoke execute on functions from public;", "alter default privileges in schema public revoke execute on functions from public;")
        lines = [l for l in (core.ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8").splitlines(True) if not l.startswith("create role") and l.strip() not in drop]
        c = psycopg.connect(core._server.get_uri(database=name), autocommit=True)
        try:
            c.execute("".join(lines))
            c.execute("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role")
            for path in core.MIGRATIONS:
                c.execute(path.read_text(encoding="utf-8"))
            for role in ("anon", "authenticated", "public"):
                self.assertFalse(c.execute(f"select has_function_privilege('{role}', 'public.request_app_download(uuid,text)', 'EXECUTE')").fetchone()[0], role)
            self.assertTrue(c.execute("select has_function_privilege('service_role', 'public.request_app_download(uuid,text)', 'EXECUTE')").fetchone()[0])
            for role in ('anon', 'authenticated', 'service_role', 'public'):                    # the tables too: Supabase's default grants must not reach them
                for tbl in ('app_releases', 'app_downloads'):
                    self.assertFalse(c.execute(f"select has_table_privilege('{role}', 'public.{tbl}', 'select,insert,update,delete')").fetchone()[0], f'{role} {tbl}')
        finally:
            c.close()
            with psycopg.connect(core._server.get_uri(), autocommit=True) as c2:
                c2.execute(f"drop database {name}")

    def test_a_person_lists_only_their_own_links_without_the_key(self):
        self.ask(TESTER)
        self.ask(TESTER)
        self.ask(ADMIN)
        mine = self.db.as_(TESTER).one("select my_app_downloads()")
        self.assertEqual(len(mine), 2)
        self.assertTrue(all(set(r) == {"asked_at", "file_name"} for r in mine))
        self.assertEqual(len(self.db.as_(ADMIN).one("select my_app_downloads()")), 1)
        self.assertEqual(self.db.as_(PLAIN).one("select my_app_downloads()"), [])
        with self.assertRaises(psycopg.Error):
            self.db.as_("anon").one("select my_app_downloads()")

    def test_the_after_migration_check_for_ryan_is_all_true_and_goes_false_when_the_tables_are_opened(self):
        sql = (core.ROOT / "app-download-live" / "01_after_migration_check.sql").read_text(encoding="utf-8")
        rows = self.db.as_(None).c.execute(sql).fetchall()
        self.assertEqual(len(rows), 6)
        self.assertEqual([r[0] for r in rows if not r[1]], [])
        self.db.c.execute("grant select on public.app_downloads to authenticated")                       # a planted fault: the table opened to signed-in people
        rows = self.db.as_(None).c.execute(sql).fetchall()
        self.assertEqual([r[0] for r in rows if not r[1]], ["nobody but the database owner can read them (not signed-in people, not the public, not the service role)"])

    def test_deleting_an_account_deletes_its_link_records(self):
        self.ask(TESTER)
        self.assertEqual(self.rows(), 1)
        self.admin("delete from auth.users where id = %s returning 1", TESTER)
        self.assertEqual(self.rows(), 0)


if __name__ == "__main__":
    unittest.main()
