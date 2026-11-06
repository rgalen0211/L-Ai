"""The signed read link's database question (migrations/20261105000200_editor_link_check.sql, NOT APPLIED) on a local Postgres. CONNECT 2026-11-05.

    pgvenv/Scripts/python -m unittest supabase/tests/test_editor_link.py -v

editor_link_check(project, owner_hash) answers, on EVERY read of the bundle: may the owner this link names read this project now?
  * yes only while all hold: the connector switch is on, the project exists, its owner hashes to the hash in the link, the owner may use AI connections, and a live grant allows the edit scope
  * a deleted project, a revoked grant, a grant without the edit scope, the switch off, another person's hash, or input that is not a project and a hash: false (never an error)
  * the hash is the first 32 hex characters of SHA-256('ryagram-editor-link:' || owner id), the same value editor-bundle/core.ts computes (a known answer is pinned in both tests)
  * only the service role may call it
"""
import hashlib
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_connect as tc  # noqa: E402
from test_connect import ALICE, BOB, h, setUpModule  # noqa: E402,F401

SCOPES = ("read", "write", "render_free", "edit")
NO_EDIT = ("read", "write", "render_free")
KNOWN_OWNER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
KNOWN_HASH = "ec4e044c5e368c000219d38c19c11c1b"      # also pinned in tests/connect-read-link.test.mjs


def owner_hash(owner):
    return hashlib.sha256(("ryagram-editor-link:" + str(owner)).encode()).hexdigest()[:32]


class EditorLink(core.Base):
    def setUp(self):
        core.Base.setUp(self)
        c = self.db.as_(None).c
        c.execute("insert into auth.users (id, email) values (%s,'alice@x'),(%s,'bob@x'),(%s,'admin@x'),(%s,'nobody@x')", (ALICE, BOB, tc.ADMIN, tc.NOBODY))
        c.execute("insert into public.app_admins (user_id) values (%s)", (tc.ADMIN,))
        c.execute("insert into public.connect_access (user_id) values (%s), (%s)", (ALICE, BOB))
        c.execute("insert into public.connect_redirect_allowlist (redirect_uri, kind, label) values (%s, 'exact', 'claude'), ('loopback', 'loopback', 'loopback')", (tc.URI,))
        self.counter = 0

    runner = tc.Connect.runner
    app = tc.Connect.app
    register = tc.Connect.register
    connect = tc.Connect.connect

    def admin(self, sql, *args):
        self.db.c.execute("reset role")
        row = self.db.c.execute(sql, args).fetchone()
        return row[0] if row and len(row) == 1 else row

    def run_sql(self, sql, *args):
        self.db.c.execute("reset role")
        self.db.c.execute(sql, args)

    def film(self, who, scopes=SCOPES):
        _, access, _ = self.connect(who, scopes=scopes)
        return self.runner().one("select connect_create_project(%s, %s)", h(access), "Film")["id"]

    def check(self, project, hash_):
        return self.db.as_("service").one("select public.editor_link_check(%s, %s)", project, hash_)

    def test_the_hash_is_the_documented_one_and_matches_the_known_answer(self):
        self.assertEqual(owner_hash(KNOWN_OWNER), KNOWN_HASH)
        self.assertEqual(self.admin("select ryagram_private.editor_link_owner_hash(%s)", KNOWN_OWNER), KNOWN_HASH)
        self.assertEqual(self.admin("select ryagram_private.editor_link_owner_hash(%s)", ALICE), owner_hash(ALICE))

    def test_the_owner_of_a_project_with_a_live_edit_grant_may_read_while_the_switch_is_on(self):
        p = self.film(ALICE)
        self.assertIs(self.check(p, owner_hash(ALICE)), True)
        self.assertIs(self.check(p, owner_hash(ALICE)), True, "asking again changes nothing")

    def test_another_persons_hash_a_wrong_hash_and_a_hash_of_the_wrong_form_are_false(self):
        p = self.film(ALICE)
        for bad in (owner_hash(BOB), "0" * 32, owner_hash(ALICE).upper(), owner_hash(ALICE)[:31], owner_hash(ALICE) + "0", "", "not a hash"):
            self.assertIs(self.check(p, bad), False, bad)

    def test_a_project_that_is_not_there_or_belongs_to_someone_else_is_false(self):
        pa = self.film(ALICE)
        pb = self.film(BOB)
        self.assertIs(self.check(pb, owner_hash(ALICE)), False, "Alice's hash on Bob's project")
        self.assertIs(self.check(pa, owner_hash(BOB)), False)
        self.assertIs(self.check("00000000-0000-4000-8000-000000000000", owner_hash(ALICE)), False)
        self.run_sql("delete from public.projects where id = %s", pa)
        self.assertIs(self.check(pa, owner_hash(ALICE)), False, "a deleted project ends the link at once")
        self.assertIs(self.check(pb, owner_hash(BOB)), True, "and the other project is not affected")

    def test_a_revoked_grant_ends_the_link_and_a_restored_one_brings_it_back(self):
        p = self.film(ALICE)
        self.run_sql("update public.connect_grants set revoked_at = now() where owner_id = %s", ALICE)
        self.assertIs(self.check(p, owner_hash(ALICE)), False)
        self.run_sql("update public.connect_grants set revoked_at = null where owner_id = %s", ALICE)
        self.assertIs(self.check(p, owner_hash(ALICE)), True)

    def test_a_grant_without_the_edit_scope_does_not_count(self):
        p = self.film(ALICE, scopes=NO_EDIT)
        self.assertIs(self.check(p, owner_hash(ALICE)), False)

    def test_the_connector_switch_off_and_a_person_who_may_no_longer_connect_are_false(self):
        p = self.film(ALICE)
        self.run_sql("update public.connect_flags set connections_enabled = false where id")
        self.assertIs(self.check(p, owner_hash(ALICE)), False)
        self.run_sql("update public.connect_flags set connections_enabled = true where id")
        self.assertIs(self.check(p, owner_hash(ALICE)), True)
        self.run_sql("delete from public.connect_access where user_id = %s", ALICE)
        self.assertIs(self.check(p, owner_hash(ALICE)), False, "an account taken off the access list")

    def test_nothing_in_gives_an_error_only_false(self):
        p = self.film(ALICE)
        self.assertIs(self.check(None, owner_hash(ALICE)), False)
        self.assertIs(self.check(p, None), False)
        self.assertIs(self.check(None, None), False)

    def test_only_the_service_role_may_call_it_and_the_helper_is_private(self):
        own = "public.connect_editor_link_owner(text, uuid)"
        self.assertTrue(self.admin("select has_function_privilege('connect_runner', %s, 'execute')", own))
        for role in ("anon", "authenticated", "service_role"):
            self.assertFalse(self.admin("select has_function_privilege(%s, %s, 'execute')", role, own), role)
        sig = "public.editor_link_check(uuid, text)"
        self.assertTrue(self.admin("select has_function_privilege('service_role', %s, 'execute')", sig))
        for role in ("anon", "authenticated", "connect_runner"):
            self.assertFalse(self.admin("select has_function_privilege(%s, %s, 'execute')", role, sig), role)
        self.assertEqual(self.admin("select count(*) from pg_proc p, aclexplode(p.proacl) x where p.oid = %s::regprocedure and x.grantee = 0", sig), 0, "not PUBLIC")
        for role in ("anon", "authenticated", "service_role", "connect_runner"):
            self.assertFalse(self.admin("select has_function_privilege(%s, 'ryagram_private.editor_link_owner_hash(uuid)', 'execute')", role), role)

    def owner(self, access, project):
        return self.runner().one("select connect_editor_link_owner(%s, %s)", h(access), project)

    def test_the_connector_gets_the_hash_for_its_own_project_only(self):
        _, a, _ = self.connect(ALICE, scopes=SCOPES)
        _, b, _ = self.connect(BOB, scopes=SCOPES)
        pa = self.runner().one("select connect_create_project(%s, 'Film')", h(a))["id"]
        pb = self.runner().one("select connect_create_project(%s, 'Film')", h(b))["id"]
        self.assertEqual(self.owner(a, pa), owner_hash(ALICE))
        self.assertEqual(self.owner(b, pb), owner_hash(BOB))
        self.assertIsNone(self.owner(a, pb), "another person's film: null, like every not-found")
        self.assertIsNone(self.owner(a, "00000000-0000-4000-8000-000000000000"))
        self.assertIsNone(self.owner(a, None))
        self.assertIs(self.check(pa, self.owner(a, pa)), True, "and what it returns is exactly what the check accepts")

    def test_the_owner_call_needs_the_edit_scope_a_live_grant_and_the_switch(self):
        _, ro, _ = self.connect(ALICE, scopes=NO_EDIT)
        pr = self.runner().one("select connect_create_project(%s, 'Film')", h(ro))["id"]
        with self.assertRaises(Exception) as cm:
            self.owner(ro, pr)
        self.assertEqual(getattr(cm.exception, "sqlstate", None), "PT403", "a connection that may not edit gets no link")
        _, a, _ = self.connect(BOB, scopes=SCOPES)
        pb = self.runner().one("select connect_create_project(%s, 'Film')", h(a))["id"]
        self.run_sql("update public.connect_grants set revoked_at = now() where owner_id = %s", BOB)
        with self.assertRaises(Exception) as cm:
            self.owner(a, pb)
        self.assertEqual(getattr(cm.exception, "sqlstate", None), "PT403")
        self.run_sql("update public.connect_grants set revoked_at = null where owner_id = %s", BOB)
        with self.assertRaises(Exception) as cm:
            self.runner().one("select connect_editor_link_owner(%s, %s)", "0" * 64, pb)
        self.assertEqual(getattr(cm.exception, "sqlstate", None), "PT401", "an unknown token")
        self.run_sql("update public.connect_flags set connections_enabled = false where id")
        with self.assertRaises(Exception) as cm:
            self.owner(a, pb)
        self.assertEqual(getattr(cm.exception, "sqlstate", None), "PT403", "the connector switch off")

    def test_it_changes_nothing(self):
        p = self.film(ALICE)
        before = [self.admin(f"select count(*) from public.{t}") for t in ("projects", "connect_grants", "connect_tokens", "edit_drafts", "edit_ops")]
        self.check(p, owner_hash(ALICE))
        self.assertEqual(before, [self.admin(f"select count(*) from public.{t}") for t in ("projects", "connect_grants", "connect_tokens", "edit_drafts", "edit_ops")])

    def test_the_migration_ends_with_the_waiting_list_gate_and_the_rollback_removes_exactly_its_two_functions(self):
        sql = (core.ROOT / "migrations" / "20261105000200_editor_link_check.sql").read_text(encoding="utf-8")
        lines = [ln.split("--")[0].strip() for ln in sql.splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertEqual(lines[-2:], ["select ryagram_private.gate_apply();", "commit;"])
        names = ("editor_link_check", "editor_link_owner_hash", "connect_editor_link_owner")
        self.assertEqual(self.admin("select count(*) from pg_proc where proname = any (%s)", list(names)), 3)
        self.run_sql((core.ROOT / "rollbacks" / "20261105000200_editor_link_check_rollback.sql").read_text(encoding="utf-8"))
        self.assertEqual(self.admin("select count(*) from pg_proc where proname = any (%s)", list(names)), 0)
        self.assertEqual(self.admin("select count(*) from pg_proc where proname = 'connect_person_ok'"), 1)


if __name__ == "__main__":
    unittest.main()
