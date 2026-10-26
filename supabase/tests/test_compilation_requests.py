"""Compilation requests (migrations/20261026000300_compilation_requests.sql, NOT APPLIED) on a local Postgres. NEXT-CONNECT 131a.

Same setup as test_connect.py (its helpers are borrowed, the OAuth dance included). Run from the repo root with the SQL venv and TEMP/TMP on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_compilation_requests.py -v

Rules proved (each with a control that passes and a fault that must be refused)
  * the owner's connector token saves ONE request on their own project and gets its SHA-256 back; a second save replaces it (still one row)
  * another person's project (or one that does not exist) looks absent: the answer is null and NOTHING is written
  * a read-only token, a revoked token and a revoked grant are refused; an invalid, wrong-schema or oversize request is refused and nothing is written
  * only the connector's role may run the function (not anon, not signed-in people, not the service role); it takes no owner id
  * the person reads ONLY their own row; nobody can insert, update or delete the table directly; deleting the project deletes the request
"""
import hashlib
import json
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_connect as tc  # noqa: E402
from test_connect import ALICE, BOB, h, setUpModule  # noqa: E402,F401  (setUpModule is what unittest calls)

REQ = {"schema": "ryagram.compilation-request/0", "phrase": "great news", "search": "every", "mode": "phrase", "note": "short ones first"}


class CompilationRequests(core.Base):
    def setUp(self):                      # the same fixtures as test_connect.Connect.setUp (its zero-argument super() cannot be borrowed)
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
    fails = tc.Connect.fails

    def admin(self, sql, *args):
        self.db.c.execute("reset role")
        row = self.db.c.execute(sql, args).fetchone()
        return row[0] if row and len(row) == 1 else row

    def project_for(self, access):
        return self.runner().one("select connect_create_project(%s, 'Film')", h(access))["id"]

    def save(self, access, project, request=REQ):
        return self.runner().one("select connect_set_compilation_request(%s, %s, %s::jsonb)", h(access), project, json.dumps(request))

    def rows(self):
        return self.admin("select count(*) from public.compilation_requests")

    def test_the_owner_saves_a_request_and_gets_its_hash(self):
        _, a, _ = self.connect(ALICE)
        p = self.project_for(a)
        sha = self.save(a, p)
        self.assertEqual(self.admin("select request from public.compilation_requests where project_id = %s", p), REQ)
        self.assertEqual(self.admin("select owner_id::text from public.compilation_requests where project_id = %s", p), ALICE)
        self.assertEqual(self.admin("select request_sha256 from public.compilation_requests where project_id = %s", p), sha)
        self.assertRegex(sha, r"^[0-9a-f]{64}$")

    def test_a_second_save_replaces_the_first_and_there_is_still_one_row(self):
        _, a, _ = self.connect(ALICE)
        p = self.project_for(a)
        s1 = self.save(a, p)
        s2 = self.save(a, p, dict(REQ, phrase="good news"))
        self.assertNotEqual(s1, s2)
        self.assertEqual(self.rows(), 1)
        self.assertEqual(self.admin("select request ->> 'phrase' from public.compilation_requests where project_id = %s", p), "good news")

    def test_someone_elses_project_and_a_missing_one_look_absent_and_write_nothing(self):
        _, a, _ = self.connect(ALICE)
        _, b, _ = self.connect(BOB)
        pa = self.project_for(a)
        self.assertIsNone(self.save(b, pa))                                      # Bob, Alice's project
        self.assertIsNone(self.save(a, str(uuid.uuid4())))                       # Alice, a project that does not exist
        self.assertEqual(self.rows(), 0)
        self.assertIsNotNone(self.save(a, pa))                                   # control: the owner can
        self.assertEqual(self.rows(), 1)
        self.assertIsNone(self.save(b, pa, dict(REQ, phrase="bob was here")))    # Bob cannot overwrite it either
        self.assertEqual(self.admin("select request ->> 'phrase' from public.compilation_requests where project_id = %s", pa), "great news")

    def test_a_read_only_token_a_revoked_token_and_a_revoked_grant_are_refused(self):
        _, a, _ = self.connect(ALICE)
        p = self.project_for(a)
        _, ro, _ = self.connect(ALICE, scopes=("read",))
        self.fails("select connect_set_compilation_request(%s, %s, %s::jsonb)", h(ro), p, json.dumps(REQ), code="PT403")
        self.db.as_(None).c.execute("update public.connect_tokens set revoked_at = now() where access_hash = %s", (h(a),))
        self.fails("select connect_set_compilation_request(%s, %s, %s::jsonb)", h(a), p, json.dumps(REQ), code="PT401")
        _, a2, _ = self.connect(ALICE)
        self.db.as_(None).c.execute("update public.connect_grants set revoked_at = now() where owner_id = %s", (ALICE,))
        self.fails("select connect_set_compilation_request(%s, %s, %s::jsonb)", h(a2), p, json.dumps(REQ), code="PT403")
        self.assertEqual(self.rows(), 0)

    def test_an_invalid_wrong_schema_or_oversize_request_is_refused_and_writes_nothing(self):
        _, a, _ = self.connect(ALICE)
        p = self.project_for(a)
        for bad in ({"phrase": "no schema"}, dict(REQ, schema="something.else/0"), [1, 2], "text", dict(REQ, note="x" * 33000)):
            with self.assertRaises(psycopg.errors.InvalidParameterValue, msg=str(bad)[:40]) as cm:       # the FUNCTION's own refusal (22023), not just the table's check
                self.save(a, p, bad)
            self.assertIn("That request is not valid.", str(cm.exception))
        self.assertEqual(self.rows(), 0)
        self.assertIsNotNone(self.save(a, p))                                    # control: a valid one is saved

    def test_only_the_connector_role_may_run_it_and_it_takes_no_owner(self):
        args = self.admin("select pg_get_function_arguments('public.connect_set_compilation_request(text,uuid,jsonb)'::regprocedure)")
        self.assertNotRegex(args, r"owner|user")
        for role in ("anon", "authenticated", "public"):
            if role == "public":
                ok = self.admin("select has_function_privilege('public', 'public.connect_set_compilation_request(text,uuid,jsonb)', 'EXECUTE')")
            elif self.admin("select count(*) from pg_roles where rolname = %s", role):
                ok = self.admin("select has_function_privilege(%s, 'public.connect_set_compilation_request(text,uuid,jsonb)', 'EXECUTE')", role)
            else:
                continue
            self.assertFalse(ok, role)
        self.assertTrue(self.admin("select has_function_privilege('connect_runner', 'public.connect_set_compilation_request(text,uuid,jsonb)', 'EXECUTE')"))
        self.assertTrue(self.admin("select prosecdef from pg_proc where oid = 'public.connect_set_compilation_request(text,uuid,jsonb)'::regprocedure"))
        with self.assertRaises(psycopg.Error):                                    # a signed-in person cannot call it, even with a real token hash
            _, a, _ = self.connect(ALICE)
            p = self.project_for(a)
            self.app(ALICE).one("select connect_set_compilation_request(%s, %s, %s::jsonb)", h(a), p, json.dumps(REQ))

    def realistic(self, migrations):
        """A database built like a real Supabase project: PUBLIC keeps its default EXECUTE on new functions, and anon / authenticated / service_role get EXECUTE on every new function by default
        (the stub revokes both, test_connect.RealisticDefaults does the same). Returns a connection to it; the caller drops the database."""
        name = "rq" + str(abs(hash(self.id())) % 100000)
        with psycopg.connect(core._server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {name}")
        drop = ("revoke usage on schema public from anon, authenticated;", "revoke all on schema public from public;",
                "alter default privileges revoke execute on functions from public;", "alter default privileges in schema public revoke execute on functions from public;")
        lines = [l for l in (core.ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8").splitlines(True) if not l.startswith("create role") and l.strip() not in drop]
        c = psycopg.connect(core._server.get_uri(database=name), autocommit=True)
        c.execute("".join(lines))
        c.execute("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role")
        for path in migrations:
            c.execute(path.read_text(encoding="utf-8"))
        return c, name

    def test_under_supabases_default_privileges_nobody_but_the_connector_can_run_it(self):
        c, name = self.realistic(core.MIGRATIONS)
        try:
            sig = "public.connect_set_compilation_request(text,uuid,jsonb)"
            for role in ("anon", "authenticated", "public"):          # service_role is the project's own trusted key: like every other connect_* function, it keeps Supabase's default EXECUTE
                self.assertFalse(c.execute(f"select has_function_privilege('{role}', '{sig}', 'EXECUTE')").fetchone()[0], role)
            self.assertTrue(c.execute(f"select has_function_privilege('connect_runner', '{sig}', 'EXECUTE')").fetchone()[0])
        finally:
            c.close()
            with psycopg.connect(core._server.get_uri(), autocommit=True) as c2:
                c2.execute(f"drop database {name}")

    def test_the_person_reads_only_their_own_row_and_nobody_writes_the_table_directly(self):
        _, a, _ = self.connect(ALICE)
        _, b, _ = self.connect(BOB)
        pa, pb = self.project_for(a), self.project_for(b)
        self.save(a, pa)
        self.save(b, pb, dict(REQ, phrase="bobs phrase"))
        self.assertEqual([r[0]["phrase"] for r in self.app(ALICE).c.execute("select request from public.compilation_requests").fetchall()], ["great news"])
        self.assertEqual([r[0]["phrase"] for r in self.app(BOB).c.execute("select request from public.compilation_requests").fetchall()], ["bobs phrase"])
        for who in (ALICE, "anon"):
            for sql in ("insert into public.compilation_requests (project_id, owner_id, request, request_sha256) values (gen_random_uuid(), %s, '{}'::jsonb, %s)",
                        "update public.compilation_requests set request = '{}'::jsonb",
                        "delete from public.compilation_requests"):
                self.db.as_(who)
                with self.assertRaises(psycopg.Error, msg=f"{who}: {sql[:30]}"):
                    if "insert" in sql:
                        self.db.c.execute(sql, (ALICE, "0" * 64))
                    else:
                        self.db.c.execute(sql)
                self.db.c.execute("rollback") if self.db.c.info.transaction_status == psycopg.pq.TransactionStatus.INERROR else None
        self.assertEqual(self.rows(), 2)

    def test_deleting_the_project_deletes_its_request(self):
        _, a, _ = self.connect(ALICE)
        p = self.project_for(a)
        self.save(a, p)
        self.assertEqual(self.rows(), 1)
        self.admin("delete from public.projects where id = %s returning 1", p)
        self.assertEqual(self.rows(), 0)


if __name__ == "__main__":
    unittest.main()
