"""THE STRANGER'S LIMITS, WALKED (BUILDER 2026-11-27; Claude's 08:05 last-stretch order). Live main's code (f6312e3c) on a local Postgres with the 2B ledger and PIPE-1 orders. Nothing live.
For each limit: what the server answers (the exact message or order code; tests/stranger-limits-1127.test.mjs turns these into the words the page shows) and whether the credits end right (ledger rows).
Run from the repo root with TEMP/TMP on D:: <pgvenv>/Scripts/python -m unittest supabase/tests/test_stranger_limits.py -v
The table for Ryan is proposals/BUILDER-STRANGER-LIMITS-1127.md. Every message below is asserted EXACTLY, so a change on the server shows up here.
"""
import sys
import unittest
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as credits  # noqa: E402
import test_pipe1_orders as p1  # noqa: E402

RYAN, OTHER, WORKER = core.RYAN, core.OTHER, core.WORKER
MESSAGES = {}                       # what each walk saw, printed at the end for the paper
setUpModule = p1.setUpModule


def tearDownModule():
    for k in sorted(MESSAGES):
        print(f"LIMIT {k}: {MESSAGES[k]!r}")


class StrangerLimits(p1.Orders):
    version, submit, settle = credits.Ledger.version, credits.Ledger.submit, credits.Ledger.settle

    def setUp(self):
        super().setUp()
        self.make_ryan_admin()
        self.admin("update ops_settings set default_credits_per_day = 20 returning 1")        # the live default (the shared template lifts it)

    def balance(self, who=OTHER):
        return self.admin("select coalesce(sum(amount), 0) from credit_ledger where owner_id = %s", who)

    def held(self, who=OTHER):
        return self.admin("select coalesce(sum(-h.amount), 0) from credit_ledger h where h.owner_id = %s and h.entry = 'hold' "
                          "and not exists (select 1 from credit_ledger r where r.resolves_id = h.id and r.entry in ('capture', 'release'))", who)

    def refused(self, who, sql, *args):
        with self.assertRaises(psycopg.Error) as cm:
            self.db.as_(who).c.execute(sql, args or None)
        return cm.exception.sqlstate, cm.exception.diag.message_primary

    def paid_preview(self, vid, who=OTHER):
        return self.submit(vid, "preview", who=who)

    # ------------------------------------------------------------------ 1. the 35-a-day sign-up cap
    def test_1_the_sign_up_cap_answers_full_and_counts_people_not_tries(self):
        self.admin("update ops_settings set join_daily_max = 35, join_open = true returning 1")
        svc = self.db.as_("service")
        for i in range(35):
            self.assertEqual(svc.one("select join_reserve(%s, %s)", f"person{i}@example.com", f"ip{i}")["ok"], True, i)
        r = svc.one("select join_reserve(%s, %s)", "person35@example.com", "ip35")
        self.assertEqual(r, {"ok": False, "reason": "full"})
        MESSAGES["1 sign-up cap, server"] = r
        self.assertEqual(svc.one("select join_reserve(%s, %s)", "person3@example.com", "ip3")["ok"], True, "someone already counted today can still ask again")
        self.assertEqual(self.admin("select count(distinct email_hash) from join_attempts"), 35, "the 36th address was not counted")
        self.admin("update join_attempts set at = now() - interval '25 hours' returning 1")
        self.assertEqual(svc.one("select join_reserve(%s, %s)", "person35@example.com", "ip35")["ok"], True, "24 hours later the same person gets in")

    # ------------------------------------------------------------------ 2. 0 credits left
    def test_2_zero_credits_free_steps_still_work_and_a_full_film_is_refused_with_nothing_held(self):
        self.assertEqual(self.balance(), 0)
        oid = self.order("zero-0001")
        self.work_through_preview(oid)                                                     # the sheet and the free preview cost nothing
        self.assertEqual(self.order_row(oid), ("failed", "insufficient_credits"))
        MESSAGES["2 zero credits, full film by request: order code"] = self.order_row(oid)
        self.assertEqual((self.balance(), self.held()), (0, 0), "nothing charged, nothing held")
        self.assertEqual(self.admin("select count(*) from credit_ledger where owner_id = %s", OTHER), 0, "no ledger row at all")
        vid = self.version("map", who=OTHER)
        for _ in range(6):
            self.settle(self.paid_preview(vid), "complete")                               # the project's 6 free previews
        state, msg = self.refused(OTHER, "select id from submit_job(%s, 'preview', '{\"window_s\": [0, 10]}')", vid)
        self.assertEqual((state, msg), ("53400", "Not enough credits: this needs 1, and 0 are available."))
        MESSAGES["2 zero credits, 7th preview of a project: server"] = msg
        self.assertEqual(self.admin("select count(*) from credit_ledger where owner_id = %s", OTHER), 0)

    # ------------------------------------------------------------------ 3. the free previews: 6 a project, 15 in any 24 hours
    def test_3_free_previews_6_a_project_and_15_a_day_then_1_credit_each_from_what_is_there(self):
        self.grant(5, who=OTHER)
        projects = [self.version("map", who=OTHER) for _ in range(3)]
        free = 0
        for vid in projects:
            for _ in range(6):
                j = self.paid_preview(vid)
                self.settle(j, "complete")
                free += 1 if self.admin("select free_preview from jobs where id = %s", j) else 0
        self.assertEqual(free, 15, "6 + 6 + 3: the 24-hour limit of 15 stops the third project's free ones")
        self.assertEqual(self.balance(), 5 - 3, "the 3 previews past 15 each cost 1 credit")
        q = self.db.as_(OTHER).one("select row(price_code, credits, free_preview, available) from credit_quote(%s, 'preview')", projects[0])
        MESSAGES["3 free previews used, the quote the page asks with"] = q
        self.assertEqual(self.admin("select count(*) from jobs where owner_id = %s and price_code = 'preview_extra' and credits_quoted = 1", OTHER), 3)

    # ------------------------------------------------------------------ 4. the 20-credits-a-day cap
    def test_4a_the_daily_cap_on_a_full_film_request_ends_the_order_with_nothing_charged(self):
        self.grant(p1.GRANT, who=OTHER)
        self.admin("update ops_settings set default_credits_per_day = 10 returning 1")   # one 8-credit film fits, the second does not (the same rule as 20 with two films and a few previews)
        a = self.order("cap-0001"); self.work_through_preview(a)
        b = self.order("cap-0002", st=p1.story("t2")); self.work_through_preview(b)
        self.assertEqual(self.order_row(a), ("awaiting_approval", None))
        self.assertEqual(self.order_row(b), ("failed", "daily_cap"))
        MESSAGES["4a daily cap, second full film: order code"] = self.order_row(b)
        self.assertEqual(self.held(), 8, "only the first film's credits are held")
        self.assertEqual(self.balance(), p1.GRANT - 8)

    def test_4b_the_daily_cap_on_a_paid_preview_is_refused_with_nothing_charged_and_this_message(self):
        self.grant(p1.GRANT, who=OTHER)
        self.admin("update ops_settings set default_credits_per_day = 2 returning 1")
        vid = self.version("map", who=OTHER)
        for _ in range(6):
            self.settle(self.paid_preview(vid), "complete")
        self.settle(self.paid_preview(vid), "complete")                                   # 1 credit
        self.settle(self.paid_preview(vid), "complete")                                   # 2 credits: at the cap
        before = self.balance()
        state, msg = self.refused(OTHER, "select id from submit_job(%s, 'preview', '{\"window_s\": [0, 10]}')", vid)
        self.assertEqual((state, msg), ("PTCAP", "daily_cap: you have reached today's credit limit. Try again tomorrow."))
        MESSAGES["4b daily cap, a paid preview: server"] = msg
        self.assertEqual(self.balance(), before, "nothing charged: the refusal rolls the job and its hold back")
        self.assertEqual(self.admin("select count(*) from jobs where owner_id = %s and job_type = 'preview'", OTHER), 8)

    # ------------------------------------------------------------------ 5. a full film declined, and one never decided after 7 days
    def test_5a_a_declined_full_film_gives_every_credit_back(self):
        self.grant(p1.GRANT, who=OTHER)
        oid = self.order("decl-0001"); self.work_through_preview(oid)
        self.assertEqual((self.balance(), self.held()), (p1.GRANT - 8, 8))
        sid = self.admin("select id from render_stages where order_id = %s and stage = 'final_render'", oid)
        self.db.as_(RYAN).one("select state from admin_render_decide(%s, false, 'not this one')", sid)
        self.assertEqual(self.order_row(oid)[0], "declined")
        MESSAGES["5a declined: order state"] = self.order_row(oid)
        self.assertEqual((self.balance(), self.held()), (p1.GRANT, 0), "every credit back, nothing held")

    def test_5b_a_full_film_never_decided_expires_after_7_days_and_gives_every_credit_back(self):
        self.grant(p1.GRANT, who=OTHER)
        oid = self.order("exp-0001"); self.work_through_preview(oid)
        self.assertEqual(self.admin("select approval_days from ops_settings"), 7)
        self.db.as_("service").one("select render_orders_tick()")
        self.assertEqual(self.order_row(oid)[0], "awaiting_approval", "not before 7 days")
        self.admin("update render_stages set awaiting_since = now() - interval '7 days 1 minute' where order_id = %s and stage = 'final_render' returning 1", oid)
        self.db.as_("service").one("select render_orders_tick()")
        self.assertEqual(self.order_row(oid), ("expired", "approval_expired"))
        MESSAGES["5b never decided after 7 days: order state"] = self.order_row(oid)
        self.assertEqual((self.balance(), self.held()), (p1.GRANT, 0), "every credit back, nothing held")


for _name in [n for n in dir(p1.Orders) if n.startswith("test_")]:
    setattr(StrangerLimits, _name, None)

if __name__ == "__main__":
    unittest.main()
