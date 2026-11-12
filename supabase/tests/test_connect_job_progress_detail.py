"""The step words in the AI chat (migrations/20261112000100_connect_job_progress_detail.sql, NOT APPLIED) on a local Postgres. Launch slice IN 1, WORKER's walkthrough row A10 (GAMES, 2026-11-12).

Same setup as test_connect_rendering_state.py (test_connect's helpers, the OAuth dance included). Run from the repo root with the SQL venv and TEMP/TMP on D::
    pgvenv/Scripts/python -m unittest supabase/tests/test_connect_job_progress_detail.py -v

Rules proved (each with a control that passes and a fault that must be refused)
  * connect_job returns the job's own progress_detail, exactly as the worker stored it, and null when there is none
  * another account's job still answers null: its progress_detail is never read (the planted fault 'drop the owner check' must be caught here)
  * it still needs the 'read' scope and a live grant; it changes nothing
  * NOTHING else changed: the function body is today's body with the one key added; same signature, return type, security definer, empty search_path, owner and grants
  * the after-check (live-steps/24) answers every row true; the rollback restores today's function exactly; the migration applies again; it ends with the waiting-list gate line
"""
import json
import re
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_connect as tc  # noqa: E402
from test_connect import ALICE, BOB, STORY, h, setUpModule  # noqa: E402,F401  (setUpModule is what unittest calls)

MIG = core.ROOT / "migrations" / "20261112000100_connect_job_progress_detail.sql"
ROLLBACK = core.ROOT / "rollbacks" / "20261112000100_connect_job_progress_detail_rollback.sql"
AFTER = core.ROOT / "live-steps" / "24_connect_job_progress_detail_after_check.sql"
ORIGINAL = core.ROOT / "migrations" / "20261018000100_connect_ai.sql"
FN = "public.connect_job(text,uuid)"
# Invented heartbeat numbers, in the worker's shape (migrations/20261003000100_job_progress_detail.sql).
DETAIL = {"stage": "drawing", "done": 1234, "total": 5000, "unit": "frames", "eta_s": 372, "eta_is_a_guess": True, "total_is_provisional": False}


def body_of(sql_text):
    """The plpgsql body of the connect_job definition in a file (between the $$ marks)."""
    m = re.search(r"function public\.connect_job\(p_token_hash text, p_job uuid\) returns jsonb\s*\nlanguage plpgsql security definer set search_path = '' as \$\$(.*?)\$\$;", sql_text, re.S)
    assert m, "no connect_job definition found"
    return m.group(1)


class JobProgressDetail(core.Base):
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
    fails = tc.Connect.fails

    def admin(self, sql, *args):
        self.db.c.execute("reset role")
        row = self.db.c.execute(sql, args).fetchone()
        return row[0] if row and len(row) == 1 else row

    def job_for(self, who, title="Film"):
        """A contact sheet job of WHO's own, made through the connector, and that account's token."""
        _, tok, _ = self.connect(who)
        r = self.runner()
        p = r.one("select connect_create_project(%s, %s)", h(tok), title)["id"]
        v = r.one("select connect_current_version(%s, %s)", h(tok), p)
        r.one("select connect_save_story(%s, %s, %s::jsonb)", h(tok), v, STORY)
        return tok, r.one("select connect_submit_job(%s, %s, 'contact_sheet', '{}'::jsonb, null, null)", h(tok), v)["id"]

    def running(self, job, detail):
        self.admin("update public.jobs set state = 'running', progress = 0.25, progress_detail = %s::jsonb where id = %s returning 1", json.dumps(detail) if detail is not None else None, job)

    def job(self, tok, job):
        return self.runner().one("select connect_job(%s, %s)", h(tok), job)

    def test_it_returns_the_jobs_own_progress_detail_exactly_and_null_when_there_is_none(self):
        a, ja = self.job_for(ALICE)
        got = self.job(a, ja)
        self.assertIn("progress_detail", got)
        self.assertIsNone(got["progress_detail"])                                                       # queued, no heartbeat yet: null, said in words by the tool
        self.running(ja, DETAIL)
        got = self.job(a, ja)
        self.assertEqual(got["progress_detail"], DETAIL)
        self.assertEqual(got["state"], "running")
        self.assertEqual(set(got) - {"progress_detail"}, {"id", "version_id", "job_type", "state", "attempt", "created_at", "story_sha256", "engine_commit", "error_class",
                                                          "error_code", "error_detail", "progress", "note", "queue_position"})   # every other key exactly as before

    def test_another_accounts_job_still_answers_null_and_its_progress_is_never_read(self):
        a, ja = self.job_for(ALICE, "Alice film")
        b, jb = self.job_for(BOB, "Bob film")
        self.running(ja, DETAIL)
        self.running(jb, {"stage": "encoding"})
        self.assertEqual(self.job(a, ja)["progress_detail"], DETAIL)                                      # control: her own job
        self.assertEqual(self.job(b, jb)["progress_detail"], {"stage": "encoding"})                     # control: his own job
        self.assertIsNone(self.job(b, ja), "Bob's token must not read Alice's job or its progress")
        self.assertIsNone(self.job(a, jb), "Alice's token must not read Bob's job or its progress")

    def test_it_still_needs_the_read_scope_and_a_live_grant_and_changes_nothing(self):
        a, ja = self.job_for(ALICE)
        self.running(ja, DETAIL)
        before = self.admin("select row_to_json(j)::text from public.jobs j where id = %s", ja)
        self.assertEqual(self.job(a, ja)["progress_detail"], DETAIL)                                      # control
        self.assertEqual(before, self.admin("select row_to_json(j)::text from public.jobs j where id = %s", ja))
        _, w, _ = self.connect(ALICE, scopes=("write",))
        with self.assertRaises(psycopg.Error) as cm:
            self.job(w, ja)
        self.assertEqual(cm.exception.sqlstate, "PT403")
        self.db.c.execute("reset role")
        self.db.c.execute("update public.connect_grants set revoked_at = now() where owner_id = %s", (ALICE,))
        with self.assertRaises(psycopg.Error) as cm2:
            self.job(a, ja)
        self.assertEqual(cm2.exception.sqlstate, "PT403")

    def test_nothing_else_changed(self):
        live = self.admin("select prosrc from pg_proc where oid = to_regprocedure(%s)", FN)
        today = body_of(ORIGINAL.read_text(encoding="utf-8"))
        self.assertEqual(body_of(MIG.read_text(encoding="utf-8")), live)
        self.assertEqual(live.replace(", 'progress_detail', j.progress_detail", ""), today, "the body is today's body with the one key added, nothing else")
        self.assertEqual(self.admin("select pg_get_function_result(to_regprocedure(%s))", FN), "jsonb")
        self.assertEqual(self.admin("select pg_get_function_identity_arguments(to_regprocedure(%s))", FN), "p_token_hash text, p_job uuid")
        self.assertTrue(self.admin("select prosecdef from pg_proc where oid = to_regprocedure(%s)", FN))
        self.assertIn(self.admin("select proconfig::text from pg_proc where oid = to_regprocedure(%s)", FN), ('{"search_path=\\"\\""}', '{search_path=}', '{"search_path="}'))
        self.assertTrue(self.admin("select has_function_privilege('connect_runner', %s, 'execute')", FN))
        for role in ("anon", "authenticated", "node_runner", "service_role"):
            self.assertFalse(self.admin("select has_function_privilege(%s, %s, 'execute')", role, FN), role)

    def test_the_after_check_answers_every_row_true(self):
        c = self.db.as_(None).c
        with c.cursor() as cur:
            cur.execute(AFTER.read_text(encoding="utf-8"))
            cols = [d.name for d in cur.description]
            rows = cur.fetchall()
        self.assertEqual(cols, ["check_name", "ok"])
        self.assertGreaterEqual(len(rows), 6)
        self.assertEqual([r[0] for r in rows if r[1] is not True], [])
        self.assertEqual(len({r[0] for r in rows}), len(rows), "every row has its own name")

    def test_the_rollback_restores_todays_function_exactly_and_the_migration_applies_again(self):
        a, ja = self.job_for(ALICE)
        self.running(ja, DETAIL)
        grants = self.admin("select proacl::text from pg_proc where oid = to_regprocedure(%s)", FN)
        self.db.c.execute("reset role")
        self.db.c.execute(ROLLBACK.read_text(encoding="utf-8"))
        self.assertEqual(self.admin("select prosrc from pg_proc where oid = to_regprocedure(%s)", FN), body_of(ORIGINAL.read_text(encoding="utf-8")))
        self.assertEqual(grants, self.admin("select proacl::text from pg_proc where oid = to_regprocedure(%s)", FN))
        self.assertNotIn("progress_detail", self.job(a, ja))
        self.assertEqual(self.admin("select progress_detail from public.jobs where id = %s", ja), DETAIL)           # no data lost
        self.db.c.execute("reset role")
        self.db.c.execute(MIG.read_text(encoding="utf-8"))
        self.assertEqual(self.job(a, ja)["progress_detail"], DETAIL)
        self.assertEqual(grants, self.admin("select proacl::text from pg_proc where oid = to_regprocedure(%s)", FN))

    def test_the_migration_ends_with_the_waiting_list_gate_like_every_migration_after_it(self):
        lines = [ln.split("--")[0].strip() for ln in MIG.read_text(encoding="utf-8").splitlines() if ln.strip() and not ln.strip().startswith("--")]
        self.assertEqual(lines[-2:], ["select ryagram_private.gate_apply();", "commit;"])


if __name__ == "__main__":
    unittest.main()
