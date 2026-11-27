"""THE LAUNCH FUNNEL BY DAY (migrations/20261127000200_launch_funnel.sql, NOT APPLIED) on a local Postgres with the 2B ledger and PIPE-1 orders. BUILDER 2026-11-27 (Claude's wave 8).
Same setup as test_pipe1_orders.py. Run from the repo root with TEMP/TMP on D:: <pgvenv>/Scripts/python -m unittest supabase/tests/test_launch_funnel.py -v

  * a REAL order run (verify, ask, sheet, preview, Ryan approves, the worker delivers) moves one account through every column, each on the day it happened, once
  * a second film by the same account counts nothing again (first time only); a declined film is asked but never approved; a direct final (auto_render, no request) is approved when made
  * administrators and workers are left out of every column; another account counts on its own
  * the sign-up asks count different addresses per day and are NULL (not kept) before yesterday, as the Privacy page promises
  * only an admin in the app can read it (a person, anonymous, the service key and an admin through a connected AI are refused); it writes nothing
  * live step 80 says PASS after the migration and STOP before it (rollback applied) and when the function is opened to anonymous; the step is one statement
"""
import re
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as credits  # noqa: E402
import test_pipe1_orders as p1  # noqa: E402

RYAN, OTHER, WORKER = core.RYAN, core.OTHER, core.WORKER
RB = core.ROOT / "rollbacks" / "20261127000200_launch_funnel_rollback.sql"
STEP = core.ROOT / "live-steps" / "80_launch_funnel_check.sql"
THIRD = "44444444-4444-4444-4444-444444444444"
COLS = ["signups_asked", "accounts_opened", "first_sheet", "first_preview", "film_asked", "film_approved", "film_delivered"]
setUpModule = p1.setUpModule


class LaunchFunnel(p1.Orders):
    version, submit = credits.Ledger.version, credits.Ledger.submit

    def funnel(self, days=14, who=RYAN):
        rows = self.db.as_(who).all("select day, " + ", ".join(COLS) + " from admin_launch_funnel(%s)", days)
        return {str(r[0]): dict(zip(COLS, r[1:])) for r in rows}

    def today(self):
        return str(self.admin("select (now() at time zone 'EST5EDT')::date"))

    def ago(self, days):
        return str(self.admin("select ((now() at time zone 'EST5EDT')::date - %s)", days))

    def totals(self, f):
        return {c: sum((r[c] or 0) for r in f.values()) for c in COLS[1:]}

    def full_film(self, key, who=OTHER, approve=True):
        oid = self.order(key, who=who)
        self.work_through_preview(oid)
        sid = self.admin("select id from render_stages where order_id = %s and stage = 'final_render'", oid)
        self.db.as_(RYAN).one("select state from admin_render_decide(%s, %s, 'ok')", sid, approve)
        if approve:
            final = self.claim()
            self.work(final, ["final_video", "thumbnail", "receipt"])
        return oid

    def setUp(self):
        super().setUp()
        self.make_ryan_admin()
        self.admin("update auth.users set email_confirmed_at = now() where id in (%s, %s) returning 1", RYAN, WORKER)
        self.grant(p1.GRANT, who=OTHER)

    # ---------------------------------------------------------------- the real run
    def test_one_real_order_moves_one_account_through_every_column_once(self):
        self.admin("update auth.users set email_confirmed_at = now() where id = %s returning 1", OTHER)
        self.full_film("funnel-0001")
        f = self.funnel()
        t = f[self.today()]
        self.assertEqual({c: t[c] for c in COLS[1:]}, {c: 1 for c in COLS[1:]}, t)
        self.assertEqual(len(f), 14)
        self.full_film("funnel-0002")
        self.assertEqual(self.totals(self.funnel()), {c: 1 for c in COLS[1:]}, "a second film by the same account counts nothing again")

    def test_a_render_that_finishes_with_no_film_is_asked_and_approved_but_not_delivered(self):
        oid = self.order("funnel-0009")
        self.work_through_preview(oid)
        sid = self.admin("select id from render_stages where order_id = %s and stage = 'final_render'", oid)
        self.db.as_(RYAN).one("select state from admin_render_decide(%s, true, 'ok')", sid)
        final = self.claim()
        self.work(final, ["final_video", "thumbnail", "receipt"])
        # The delivery step can still fail after the job completes (pipe1 order_advance: the final_video gone, so a refund, the order failed with delivery_failed and NO
        # render_deliveries row; RENDERER 11-27). The worker cannot report a final without its film, so the end state is made here directly: the job complete, no delivery row.
        self.admin("delete from render_deliveries where order_id = %s returning 1", oid)
        self.assertEqual(self.admin("select state::text from jobs where id = %s", final), "complete")
        t = self.funnel()[self.today()]
        self.assertEqual((t["film_asked"], t["film_approved"], t["film_delivered"]), (1, 1, 0), "finished is not delivered")

    def test_a_declined_film_is_asked_but_never_approved_or_delivered(self):
        self.full_film("funnel-0003", approve=False)
        t = self.funnel()[self.today()]
        self.assertEqual((t["film_asked"], t["film_approved"], t["film_delivered"]), (1, 0, 0))

    def test_a_direct_final_counts_as_approved_when_made_and_each_step_on_its_own_day(self):
        self.admin("update auth.users set email_confirmed_at = now() - interval '3 days' where id = %s returning 1", OTHER)
        self.admin("update ops_settings set auto_render = true returning 1")
        vid = self.version("map", who=OTHER)
        sheet = self.submit(vid, "contact_sheet", who=OTHER)
        self.work(self.claim(), ["contact_sheet"])
        prev = self.submit(vid, "preview", who=OTHER)
        self.work(self.claim(), ["preview"])
        final = self.submit(vid, "final_render", sheet, prev, who=OTHER)
        self.assertIsNone(self.admin("select stage_id from jobs where id = %s", final), "a direct final has no request")
        self.admin("update jobs set created_at = now() - interval '2 days' where id = %s returning 1", sheet)
        f = self.funnel()
        self.assertEqual(f[self.ago(3)]["accounts_opened"], 1)
        self.assertEqual(f[self.ago(2)]["first_sheet"], 1)
        self.assertEqual(f[self.today()]["first_preview"], 1)
        self.assertEqual((f[self.today()]["film_asked"], f[self.today()]["film_approved"]), (1, 1))
        self.assertEqual(f[self.today()]["film_delivered"], 0, "a direct final is delivered only once its film exists")
        self.work(self.claim(), ["final_video", "thumbnail", "receipt"])
        self.assertEqual(self.funnel()[self.today()]["film_delivered"], 1, "a direct final with its film is delivered")
        self.admin("update jobs set state = 'failed' where id = %s returning 1", final)
        self.assertEqual(self.funnel()[self.today()]["film_delivered"], 0, "a film file on a job that did not complete is not a delivery")

    # ---------------------------------------------------------------- who counts
    def test_administrators_and_workers_are_left_out_and_another_account_counts_on_its_own(self):
        self.admin("update auth.users set email_confirmed_at = now() where id = %s returning 1", OTHER)
        self.admin("insert into auth.users (id, email, email_confirmed_at) values (%s, 'third@x', now()) returning 1", THIRD)
        t = self.funnel()[self.today()]
        self.assertEqual(t["accounts_opened"], 2, "OTHER and THIRD; not Ryan (administrator), not the worker")
        self.admin("delete from app_admins where user_id = %s returning 1", RYAN)
        self.assertRaises(psycopg.Error, self.funnel)

    def test_the_sign_up_asks_are_different_addresses_per_day_and_not_kept_before_yesterday(self):
        self.admin("insert into join_attempts (ip_hash, email_hash, at) values ('a', repeat('1', 64), now()), ('b', repeat('1', 64), now()), ('c', repeat('2', 64), now()) returning 1")
        self.admin("insert into join_attempts (ip_hash, email_hash, at) values ('a', repeat('3', 64), now() - interval '1 day') returning 1")
        self.admin("insert into join_attempts (ip_hash, email_hash, at) values ('a', repeat('4', 64), now() - interval '5 days') returning 1")
        f = self.funnel()
        self.assertEqual(f[self.today()]["signups_asked"], 2, "one address asking twice counts once")
        self.assertEqual(f[self.ago(1)]["signups_asked"], 1)
        for d in range(2, 14):
            self.assertIsNone(f[self.ago(d)]["signups_asked"], f"day -{d}: not kept, so NULL, never 0")
        self.assertEqual(f[self.ago(1)]["accounts_opened"], 0, "other columns are 0, not NULL")

    # ---------------------------------------------------------------- closed, reads only
    def test_only_an_admin_in_the_app_can_read_it_and_it_writes_nothing(self):
        for who in (OTHER, "anon", "service"):
            with self.assertRaises(psycopg.Error, msg=who):
                self.db.as_(who).c.execute("select * from admin_launch_funnel(14)")
        d = self.db.as_(RYAN)
        d.c.execute("select set_config('request.jwt.claims', %s, false)", ('{"sub": "%s", "role": "authenticated", "client_id": "x"}' % RYAN,))
        with self.assertRaises(psycopg.Error) as cm:
            d.c.execute("select * from admin_launch_funnel(14)")
        self.assertIn("connected AI", cm.exception.diag.message_primary)
        d.c.execute("select set_config('request.jwt.claims', '', false)")
        self.assertEqual(len(self.funnel(0)), 1, "at least one day")
        self.assertEqual(len(self.funnel(500)), 60, "at most 60 days")
        self.assertEqual(self.admin("select provolatile from pg_proc where oid = to_regprocedure('public.admin_launch_funnel(integer)')"), "s", "stable: it cannot write")
        self.assertEqual(self.admin("select count(*) from pg_proc where oid = to_regprocedure('public.admin_launch_funnel(integer)') and prosrc like '%%perform ryagram_private.require_active();%%'"), 1)

    # ---------------------------------------------------------------- live step 80
    def step(self):
        return self.db.as_(None).c.execute(STEP.read_text(encoding="utf-8")).fetchall()

    def test_step_80_pass_after_stop_before_and_stop_when_opened(self):
        rows = self.step()
        self.assertEqual([r[0] for r in rows], [1, 2, 3, 4, 5])
        self.assertTrue(rows[0][1].startswith("PASS") and all(r[2] for r in rows), rows)
        self.ddl("grant execute on function public.admin_launch_funnel(integer) to anon")
        rows = self.step()
        self.assertTrue(rows[0][1].startswith("STOP") and rows[1][2] is False, rows)
        self.ddl("revoke execute on function public.admin_launch_funnel(integer) from anon")
        self.ddl(RB.read_text(encoding="utf-8"))
        rows = self.step()
        self.assertEqual([r[2] for r in rows], [False, False, False, False, False], rows)
        self.assertIsNone(self.admin("select to_regprocedure('public.admin_launch_funnel(integer)')"), "the rollback removed it")

    def test_step_80_is_one_statement_with_no_semicolon_in_a_string_and_no_address(self):
        t = STEP.read_text(encoding="utf-8")
        code = "\n".join(l for l in t.splitlines() if not l.lstrip().startswith("--"))
        self.assertEqual(code.strip().count(";"), 1)
        self.assertTrue(code.strip().endswith(";"))
        self.assertIsNone(re.search(r"'[^'\n]*;[^'\n]*'", code))
        self.assertNotIn("@", t)

    def ddl(self, sql):
        self.db.as_(None).c.execute(sql)


for _name in [n for n in dir(p1.Orders) if n.startswith("test_")]:
    setattr(LaunchFunnel, _name, None)

if __name__ == "__main__":
    unittest.main()
