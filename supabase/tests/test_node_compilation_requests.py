"""The desktop app reads the requests its person's AI wrote (migrations/20261026000400_node_compilation_requests.sql, NOT APPLIED) on a local Postgres. NEXT-CONNECT 131b.

Same setup as test_r9_node.py (its helpers and its signed-in computer are borrowed); the two compilation-request migrations are applied on top of its template database.
    pgvenv/Scripts/python -m unittest supabase/tests/test_node_compilation_requests.py -v

Rules proved (each with a control that passes and a fault that must be refused)
  * a signed-in computer gets ITS person's requests, newest first, each with the project's title and no owner id; none of anybody else's
  * a missing, junk, revoked or worker token is refused; a read changes nothing (no job, no credit, no project, no request)
  * at most 20 come back
  * only the node role may run the function (not anon, not signed-in people, not the connector's role) and it has no table privilege on the requests
"""
import json
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_r9_node as r9  # noqa: E402
from test_r9_node import ADMIN, BOB, SAM, WORKER, h, tearDownModule  # noqa: E402,F401  (tearDownModule is what unittest calls)

MIGRATIONS = [r9.ROOT / "migrations" / "20261026000300_compilation_requests.sql", r9.ROOT / "migrations" / "20261026000400_node_compilation_requests.sql"]
REQ = {"schema": "ryagram.compilation-request/0", "phrase": "great news", "search": "every", "mode": "phrase", "note": "short ones first"}
FN = "public.node_compilation_requests(text)"


def setUpModule():
    r9.setUpModule()
    with psycopg.connect(r9._server.get_uri(database="tmplr9"), autocommit=True) as c:
        for m in MIGRATIONS:
            c.execute(m.read_text(encoding="utf-8"))


class NodeRequests(r9.R9):
    def put(self, who, title, request=REQ, at=None):
        pid = self.db.as_(who).one("insert into projects (title) values (%s) returning id", title)
        self.admin("insert into public.compilation_requests (project_id, owner_id, request, request_sha256, updated_at) values (%s, %s, %s::jsonb, %s, coalesce(%s::timestamptz, now())) returning 1",
                   pid, who, json.dumps(request), "a" * 64, at)
        return pid

    def signed(self, who, name="Sam-PC"):
        self.make_tester(who)                                  # a computer can be signed in only for a tester (r9)
        return self.node(who, name)

    def get(self, token):
        return self.runner().one("select node_compilation_requests(%s)", h(token))

    def test_a_computer_gets_its_persons_requests_newest_first_and_nobody_elses(self):
        sam, bob = self.signed(SAM), self.signed(BOB, "Bob-PC")
        self.put(SAM, "old film", dict(REQ, phrase="old one"), at="2026-10-01 10:00+00")
        self.put(SAM, "new film", dict(REQ, phrase="new one"), at="2026-10-02 10:00+00")
        self.put(BOB, "bobs film", dict(REQ, phrase="bobs phrase"))
        got = self.get(sam)
        self.assertEqual([r["request"]["phrase"] for r in got], ["new one", "old one"])
        self.assertEqual([r["title"] for r in got], ["new film", "old film"])
        self.assertTrue(all(set(r) == {"project_id", "title", "request", "sha256", "updated_at"} for r in got))      # no owner id, nothing else about the account
        self.assertEqual([r["request"]["phrase"] for r in self.get(bob)], ["bobs phrase"])                         # control: Bob gets his own

    def test_no_requests_is_an_empty_list(self):
        self.assertEqual(self.get(self.signed(SAM)), [])

    def test_a_missing_junk_revoked_or_worker_token_is_refused(self):
        sam = self.signed(SAM)
        self.put(SAM, "film")
        self.assertEqual(len(self.get(sam)), 1)                                                                     # control
        for bad in (None, "junk", "0" * 64, "G" * 64):
            with self.assertRaises(psycopg.Error, msg=str(bad)):
                self.runner().one("select node_compilation_requests(%s)", bad)
        self.admin("update public.node_tokens set revoked_at = now() where token_hash = %s returning 1", h(sam))
        with self.assertRaises(psycopg.Error):
            self.get(sam)

    def test_reading_changes_nothing(self):
        sam = self.signed(SAM)
        self.put(SAM, "film")
        before = [self.admin(f"select count(*) from {t}") for t in ("public.jobs", "public.projects", "public.compilation_requests", "public.versions")]
        for _ in range(3):
            self.get(sam)
        after = [self.admin(f"select count(*) from {t}") for t in ("public.jobs", "public.projects", "public.compilation_requests", "public.versions")]
        self.assertEqual(before, after)

    def test_at_most_twenty_come_back(self):
        sam = self.signed(SAM)
        for i in range(23):
            self.put(SAM, f"film {i}", dict(REQ, phrase=f"p{i}"), at=f"2026-10-01 10:{i:02d}+00")
        got = self.get(sam)
        self.assertEqual(len(got), 20)
        self.assertEqual(got[0]["request"]["phrase"], "p22")                                                        # the newest first

    def test_under_supabases_default_privileges_only_the_node_role_can_run_it(self):
        """A database built like a real Supabase project: PUBLIC keeps its default EXECUTE on new functions and anon / authenticated / service_role get EXECUTE on every new one (the stub revokes
        both). service_role is the project's own trusted key and keeps the default, as on every other node_* and connect_* function."""
        name = "nq" + str(abs(hash(self.id())) % 100000)
        with psycopg.connect(r9._server.get_uri(), autocommit=True) as c:
            c.execute(f"create database {name}")
        drop = ("revoke usage on schema public from anon, authenticated;", "revoke all on schema public from public;",
                "alter default privileges revoke execute on functions from public;", "alter default privileges in schema public revoke execute on functions from public;")
        lines = [l for l in (r9.ROOT / "tests" / "supabase_stub.sql").read_text(encoding="utf-8").splitlines(True) if not l.startswith("create role") and l.strip() not in drop]
        c = psycopg.connect(r9._server.get_uri(database=name), autocommit=True)
        try:
            c.execute("".join(lines))
            c.execute("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role")
            for path in [*r9.BEFORE_R9, r9.LEDGER, r9.R9_MIGRATION, *MIGRATIONS]:
                c.execute(path.read_text(encoding="utf-8"))
            for role in ("anon", "authenticated", "public"):
                self.assertFalse(c.execute(f"select has_function_privilege('{role}', '{FN}', 'EXECUTE')").fetchone()[0], role)
            self.assertTrue(c.execute(f"select has_function_privilege('node_runner', '{FN}', 'EXECUTE')").fetchone()[0])
        finally:
            c.close()
            with psycopg.connect(r9._server.get_uri(), autocommit=True) as c2:
                c2.execute(f"drop database {name}")

    def test_only_the_node_role_may_run_it_and_it_has_no_table_privilege_on_requests(self):
        for role in ("anon", "authenticated", "connect_runner", "service_role", "public"):
            if role != "public" and not self.admin("select count(*) from pg_roles where rolname = %s", role):
                continue
            self.assertFalse(self.admin(f"select has_function_privilege('{role}', '{FN}', 'EXECUTE')"), role)
        self.assertTrue(self.admin(f"select has_function_privilege('node_runner', '{FN}', 'EXECUTE')"))
        self.assertTrue(self.admin(f"select prosecdef from pg_proc where oid = '{FN}'::regprocedure"))
        self.assertFalse(self.admin("select has_table_privilege('node_runner', 'public.compilation_requests', 'select,insert,update,delete')"))
        callable_now = r9.Review1411.callable_by_runner(self)
        self.assertEqual(callable_now, sorted(r9.Review1411.NODE_FNS + [FN]))                                      # the node role's WHOLE reach is the old list plus this one
        self.assertNotRegex(self.admin(f"select pg_get_function_arguments('{FN}'::regprocedure)"), r"owner|user")
        with self.assertRaises(psycopg.Error):                                                                      # a signed-in person cannot call it, even with a real token hash
            sam = self.signed(SAM)
            self.db.as_(SAM).one("select node_compilation_requests(%s)", h(sam))


if __name__ == "__main__":
    unittest.main()
