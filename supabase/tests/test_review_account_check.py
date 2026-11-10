"""THE REVIEW-ACCOUNT CHECK (supabase/connect-live/07_review_account_check.sql; NEXT-CONNECT 208 (a), CC1 10:29 order C) on a local Postgres.

Run from the repo root with TEMP/TMP on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_review_account_check.py -v

What this proves: for the review account named in the file, every gate the connector or a reviewer meets is one line, PASS or FAIL, with what to do; a fully ready account says ALL REQUIRED GATES PASS; each missing thing
(an administrator, a worker, a waiting account, no invite, the master switch off, no film, no finished sheet, no finished preview, no shared track list, a job still running) turns exactly its own line to FAIL and the
result to FAIL; an account that does not exist stops with one clear line; a gate whose table is not on the database yet says NOT APPLICABLE and never FAIL; the output never holds the email; and the file READS ONLY:
it creates one function that lives in the editor session only (nothing is left behind), writes nothing, changes nothing.
"""
import re
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402

setUpModule = core.setUpModule
ROOT = Path(__file__).resolve().parent.parent
FILE = ROOT / "connect-live" / "07_review_account_check.sql"
REV = str(uuid.UUID(int=701))
EMAIL = "review.person@example.test"
REQUIRED = list(range(1, 13))


class ReviewCheck(core.Base):
    def owner(self, sql, *args):
        return self.db.as_(None).c.execute(sql, args or None)

    def make_ready(self, email=EMAIL):
        """A fully ready review account, as Ryan would make it."""
        self.owner("insert into auth.users (id, email) values (%s, %s)", REV, email)
        self.owner("insert into public.connect_access (user_id) values (%s)", REV)
        self.owner("update public.ops_settings set waiting_accounts = false")
        p = self.owner("insert into public.projects (owner_id, title) values (%s, 'Invented review film') returning id", REV).fetchone()[0]
        v = self.owner("insert into public.versions (project_id, owner_id, number, story_spec) values (%s, %s, 1, '{\"title\": \"invented\"}'::jsonb) returning id", p, REV).fetchone()[0]
        for kind in ("contact_sheet", "preview"):
            self.owner("insert into public.jobs (owner_id, project_id, version_id, job_type, story, story_sha256, params, state) values (%s, %s, %s, %s, '{}'::jsonb, %s, '{\"window_s\": [0, 5]}'::jsonb, 'complete')", REV, p, v, kind, "a" * 64)
        q = self.owner("insert into public.projects (owner_id, title) values (%s, 'Invented clip film') returning id", REV).fetchone()[0]
        self.owner("insert into public.edit_drafts (project_id, mode, owner_id, mirrored, ai_visible) values (%s, 'compilation', %s, true, true)", q, REV)
        return p, v, q

    def run_file(self, email=EMAIL):
        text = FILE.read_text(encoding="utf-8").replace("REVIEW-ACCOUNT-EMAIL-HERE", email)
        cur = self.db.as_(None).c.execute(text)
        while cur.nextset():
            pass
        return cur.fetchall()

    def lines(self, email=EMAIL):
        return {r[0]: (r[1], r[2], r[3]) for r in self.run_file(email)}

    def assertOnlyFail(self, got, failing):
        for n in REQUIRED:
            if n not in got:
                continue
            want_fail = n in failing
            self.assertEqual(got[n][1] == "FAIL", want_fail, f"line {n} ({got[n][0]}): {got[n][1]}")

    # ---------------------------------------------------------------------------------------------- the ready account
    def test_a_fully_ready_account_passes_every_required_gate_and_the_result_says_so(self):
        self.make_ready()
        got = self.lines()
        self.assertEqual({n: got[n][1] for n in REQUIRED}, {n: "PASS" for n in REQUIRED})
        self.assertEqual(got[13][1], "NOT APPLICABLE", "the look card's table is not on this database: not applicable, never a fail")
        self.assertEqual(got[99][1], "ALL REQUIRED GATES PASS")

    def test_an_account_that_does_not_exist_stops_with_one_clear_line(self):
        got = self.lines("nobody.here@example.test")
        self.assertEqual(sorted(got), [1, 99])
        self.assertEqual(got[1][1], "FAIL")
        self.assertIn("not found", got[99][1])

    # ---------------------------------------------------------------------------------------------- each missing thing turns its own line
    def test_an_administrator_is_a_fail_on_its_own_line_and_on_the_connectors_own_check(self):
        self.make_ready()
        self.owner("insert into public.app_admins (user_id, note) values (%s, 'test')", REV)
        got = self.lines()
        self.assertOnlyFail(got, {2, 6})
        self.assertEqual(got[99][1], "2 REQUIRED GATE(S) FAIL")

    def test_a_worker_is_a_fail(self):
        self.make_ready()
        self.owner("insert into public.workers (user_id, name) values (%s, 'invented')", REV)
        self.assertOnlyFail(self.lines(), {3, 6})

    def test_a_waiting_account_is_a_fail(self):
        self.make_ready()
        self.owner("update public.ops_settings set waiting_accounts = true")
        self.owner("insert into public.account_status (user_id, status, source) values (%s, 'waiting', 'signup') on conflict (user_id) do update set status = 'waiting'", REV)
        self.assertOnlyFail(self.lines(), {4, 6})                                                      # and the connector's own check, which asks the same question

    def test_no_invite_or_a_switched_off_invite_is_a_fail(self):
        self.make_ready()
        self.owner("update public.connect_access set enabled = false where user_id = %s", REV)
        self.assertOnlyFail(self.lines(), {5, 6})
        self.owner("delete from public.connect_access where user_id = %s", REV)
        self.assertOnlyFail(self.lines(), {5, 6})

    def test_the_master_switch_off_is_a_fail(self):
        self.make_ready()
        self.owner("update public.connect_flags set connections_enabled = false where id")
        self.assertOnlyFail(self.lines(), {7})

    def test_no_film_no_sheet_no_preview_no_shared_track_list_each_is_its_own_fail(self):
        p, v, q = self.make_ready()
        self.owner("update public.versions set story_spec = '{}'::jsonb where id = %s", v)
        self.assertOnlyFail(self.lines(), {8})
        self.owner("update public.versions set story_spec = '{\"title\": \"invented\"}'::jsonb where id = %s", v)
        self.owner("update public.jobs set state = 'failed' where job_type = 'contact_sheet' and owner_id = %s", REV)
        self.assertOnlyFail(self.lines(), {9})
        self.owner("update public.jobs set state = 'complete' where job_type = 'contact_sheet' and owner_id = %s", REV)
        self.owner("delete from public.jobs where job_type = 'preview' and owner_id = %s", REV)
        self.assertOnlyFail(self.lines(), {10})
        self.owner("update public.edit_drafts set ai_visible = false where owner_id = %s", REV)
        self.assertOnlyFail(self.lines(), {10, 11})
        self.owner("update public.projects set archived_at = now() where id = %s", p)
        self.assertOnlyFail(self.lines(), {8, 10, 11})

    def test_a_job_still_running_is_a_fail_and_an_optional_gate_never_changes_the_result(self):
        p, v, q = self.make_ready()
        self.owner("insert into public.jobs (owner_id, project_id, version_id, job_type, story, story_sha256, params, state) values (%s, %s, %s, 'preview', '{}'::jsonb, %s, '{\"window_s\": [0, 5]}'::jsonb, 'queued')", REV, p, v, "b" * 64)
        got = self.lines()
        self.assertOnlyFail(got, {12})
        for state in ("claimed", "running", "validating", "uploading"):                                  # every state that is still in flight counts, not only the first
            self.owner("update public.jobs set state = %s::public.job_state, worker_id = 'invented', worker_user_id = null where state in ('queued', 'claimed', 'running', 'validating', 'uploading') and owner_id = %s", state, REV)
            self.assertOnlyFail(self.lines(), {12})
        self.owner("delete from public.jobs where state in ('queued', 'claimed', 'running', 'validating', 'uploading') and owner_id = %s", REV)
        self.owner("create table public.film_card_requests (owner_id uuid, state text)")                     # the optional gate's table exists but holds nothing for this account
        got = self.lines()
        self.assertEqual(got[13][1], "FAIL (optional)")
        self.assertEqual(got[99][1], "ALL REQUIRED GATES PASS", "an optional gate does not change the result")
        self.owner("insert into public.film_card_requests values (%s, 'answered')", REV)
        self.assertEqual(self.lines()[13][1], "PASS")

    def test_a_part_of_the_window_that_is_not_applied_is_not_applicable_never_a_fail(self):
        self.make_ready()
        self.owner("drop table public.edit_drafts cascade")
        got = self.lines()
        self.assertEqual(got[11][1], "NOT APPLICABLE")
        self.assertEqual(got[99][1], "ALL REQUIRED GATES PASS")

    # ---------------------------------------------------------------------------------------------- private, read-only, leaves nothing
    def test_the_output_never_holds_the_email_or_anything_of_the_account(self):
        self.make_ready()
        out = " ".join(" ".join(map(str, r)) for r in self.run_file())
        self.assertNotIn("review.person", out)
        self.assertNotIn("example.test", out)
        self.assertNotIn(REV, out)
        out2 = " ".join(" ".join(map(str, r)) for r in self.run_file("nobody.here@example.test"))
        self.assertNotIn("nobody.here", out2)

    def test_it_reads_only_and_leaves_nothing_behind(self):
        self.make_ready()

        def snapshot():
            tables = self.owner("select relname, n_live_tup from pg_stat_user_tables where schemaname in ('public', 'ryagram_private') order by 1").fetchall()
            counts = [(t, self.owner(f'select count(*) from public."{t}"').fetchone()[0]) for t, _ in tables if self.owner("select to_regclass(%s)", f"public.{t}").fetchone()[0]]
            funcs = self.owner("select n.nspname || '.' || p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'ryagram_private') order by 1").fetchall()
            return counts, funcs
        before = snapshot()
        self.run_file()
        self.assertEqual(snapshot(), before, "no table gained or lost a row and no function was added: nothing was changed")
        dsn = self.db.c.info.dsn
        with psycopg.connect(dsn, autocommit=True) as other:                                          # while the editor session is open the function exists, in that session's temporary schema only
            schemas = [r[0] for r in other.execute("select n.nspname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'review_account_check'").fetchall()]
            self.assertEqual(len(schemas), 1)
            self.assertTrue(schemas[0].startswith("pg_temp_"), schemas)
        self.db.c.close()                                                                              # the editor session ends: the function is gone
        with psycopg.connect(dsn, autocommit=True) as later:
            self.assertEqual(later.execute("select count(*) from pg_proc where proname = 'review_account_check'").fetchone()[0], 0)

    def test_the_file_writes_nothing_by_its_own_words(self):
        text = FILE.read_text(encoding="utf-8")
        code = "\n".join(ln for ln in text.splitlines() if not ln.lstrip().startswith("--"))
        body = code[code.index("$$") + 2: code.rindex("$$")]
        for word in ("insert", "update", "delete", "truncate", "drop ", "alter ", "grant", "revoke", "create table", "perform "):
            self.assertNotRegex(re.sub(r"'[^']*'", "''", body).lower(), r"\b" + re.escape(word.strip()) + r"\b" if word.strip() not in ("drop", "alter", "create table", "perform") else re.escape(word), word)
        self.assertEqual(len(re.findall(r"create or replace function", code, re.I)), 1)
        self.assertIn("pg_temp.review_account_check", code)
        self.assertNotIn("create or replace function public", code)
        self.assertIn("REVIEW-ACCOUNT-EMAIL-HERE", text, "the file ships with the placeholder, never a real address")


if __name__ == "__main__":
    unittest.main()
