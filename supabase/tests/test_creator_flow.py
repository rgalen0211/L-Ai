"""The creator beta flow (migrations/20261016000200_creator_flow.sql) on a local Postgres with the 2B credits ledger:
approve + invite code with welcome credits -> sign-up grant -> a film request that spends credits -> Ryan's manual queue -> delivered or declined (refund).

Same setup as test_2b_credits.py. Run from the repo root with TEMP/TMP/TMPDIR on D: (the storage rule):
    pgvenv/Scripts/python -m unittest supabase/tests/test_creator_flow.py -v
"""
import sys
import unittest
import uuid
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_2a_core as core  # noqa: E402
import test_2b_credits as credits  # noqa: E402

RYAN, OTHER = core.RYAN, core.OTHER
GOOD = ("Maya Ortiz", "maya@example.com", "youtuber", "Weekly explainers on housing", "https://www.youtube.com/@maya",
        "Did cities that legalized duplexes build more homes within five years?")
QUESTION = "Which states built the most apartments between 2015 and 2024?"


def setUpModule():
    credits.setUpModule()


class CreatorFlow(unittest.TestCase):
    setUp, tearDown = credits.Ledger.setUp, credits.Ledger.tearDown
    admin, denied, grant = credits.Ledger.admin, credits.Ledger.denied, credits.Ledger.grant

    def make_ryan_admin(self):
        self.admin("update auth.users set email = 'ryan.galen@uselai.com' where id = %s returning 1", RYAN)
        self.admin("insert into public.app_admins (user_id, note) select id, 'test' from auth.users where lower(email) = 'ryan.galen@uselai.com' returning 1")

    def ryan(self):
        return self.db.as_(RYAN)

    def svc(self):
        return self.db.as_("service")

    def apply(self, *fields):
        return self.svc().one("select creator_beta_apply(%s, %s, %s, %s, %s, %s, '', '')", *(fields or GOOD))

    def balance(self, who=RYAN, pool=None):
        sql = "select coalesce(sum(amount), 0) from public.credit_ledger where owner_id = %s" + (" and pool = %s::public.credit_pool" if pool else "")
        return int(self.admin(sql, *([who, pool] if pool else [who])))

    def request(self, who=RYAN, q=QUESTION, notes=""):
        return self.db.as_(who).one("select request_film(%s, %s)", q, notes)

    # ---- approve + invite
    def test_approving_makes_a_single_use_invite_code_that_carries_welcome_credits_and_shows_once(self):
        self.make_ryan_admin()
        a = self.apply()
        code = self.ryan().one("select admin_creator_invite(%s)", a)
        self.assertRegex(code, r"^RYA-[A-Z2-9]{4}-[A-Z2-9]{4}$")
        row = self.admin("select max_uses, grant_credits, expires_at > now() + interval '29 days' from public.invite_codes where label like %s", f"creator #{a} %")
        self.assertEqual(tuple(row), (1, 20, True))                                                 # single use, the default 20 welcome credits, valid 30 days
        self.assertEqual(self.admin("select count(*) from public.invite_codes where code_hash = %s", code), 0)   # only a hash is stored: the code itself is not
        app = self.admin("select status, invited_at is not null, invite_credits, decided_at is not null from public.creator_applications where id = %s", a)
        self.assertEqual(tuple(app), ("approved", True, 20, True))
        self.assertEqual(self.admin("select count(*) from public.ops_alerts where key = %s and resolved_at is null", f"creator:{a}"), 0)    # decided = alert cleared
        with self.assertRaisesRegex(psycopg.Error, "already made"):
            self.ryan().one("select admin_creator_invite(%s)", a)                                    # the code cannot be shown twice

    def test_the_invite_can_carry_other_credits_and_a_declined_or_unknown_application_gets_none(self):
        self.make_ryan_admin()
        a = self.apply()
        self.ryan().one("select admin_creator_invite(%s, 35)", a)
        self.assertEqual(self.admin("select grant_credits from public.invite_codes where label like %s", f"creator #{a} %"), 35)
        b = self.apply("Dr. Sam Lee", "sam@example.edu", "teacher", "Statistics lessons", "https://example.edu/~slee", "How did rent and wages move since 2000?")
        self.ryan().one("select admin_decide_creator(%s, 'declined')", b)
        for bad in ("select admin_creator_invite(%s)" % b, "select admin_creator_invite(99999)", "select admin_creator_invite(%s, -1)" % a, "select admin_creator_invite(%s, 1001)" % a):
            with self.assertRaises(psycopg.Error):
                self.ryan().one(bad)

    def test_only_ryan_can_make_invites_and_the_settings_change_the_defaults(self):
        self.make_ryan_admin()
        a = self.apply()
        for who in ("anon", OTHER, "service"):
            self.denied(who, "select admin_creator_invite(%s)", a)
            self.denied(who, "select admin_creator_flow_set(5, 7)")
        self.assertEqual(self.admin("select count(*) from public.invite_codes"), 0)
        self.ryan().one("select admin_creator_flow_set(5, 7)")
        self.ryan().one("select admin_creator_invite(%s)", a)
        self.assertEqual(self.admin("select grant_credits from public.invite_codes"), 7)             # the new default welcome credits
        for bad in ("select admin_creator_flow_set(-1, 5)", "select admin_creator_flow_set(5, 1001)", "select admin_creator_flow_set(null, 5)"):
            with self.assertRaises(psycopg.Error):
                self.ryan().one(bad)

    def test_sign_up_with_the_code_grants_the_welcome_credits_once_and_a_released_invite_grants_none(self):
        self.make_ryan_admin()
        a = self.apply()
        code = self.ryan().one("select admin_creator_invite(%s)", a)
        newbie = str(uuid.uuid4())
        self.admin("insert into auth.users (id, email) values (%s, 'maya@example.com') returning 1", newbie)
        r = self.svc().one("select invite_reserve(%s, 'maya@example.com', 'iphash')", code)
        self.assertTrue(r["ok"])
        self.svc().one("select invite_sent(%s, %s)", r["redemption"], newbie)
        self.assertEqual(self.balance(newbie), 20)
        self.assertEqual(tuple(self.admin("select entry::text, pool::text, amount, created_by from public.credit_ledger where owner_id = %s", newbie)),
                         ("grant", "granted", 20, f"invite:{r['redemption']}"))
        self.svc().one("select invite_sent(%s, %s)", r["redemption"], newbie)                          # a repeat changes nothing
        self.assertEqual(self.balance(newbie), 20)
        # a plain invite (no welcome credits) grants nothing, and a released one never granted
        plain = self.admin("select public.invite_issue('plain', 1, 14)")
        other = str(uuid.uuid4())
        self.admin("insert into auth.users (id, email) values (%s, 'p@example.com') returning 1", other)
        r2 = self.svc().one("select invite_reserve(%s, 'p@example.com', 'iphash2')", plain)
        self.svc().one("select invite_sent(%s, %s)", r2["redemption"], other)
        self.assertEqual(self.balance(other), 0)
        sam = self.apply("Sam Lee", "sam@example.edu", "teacher", "Lessons", "https://example.edu/s", "How did rent and wages move since 2000?")
        code2 = self.ryan().one("select admin_creator_invite(%s)", sam)
        r3 = self.svc().one("select invite_reserve(%s, 'sam@example.edu', 'iphash3')", code2)
        self.svc().one("select invite_release(%s)", r3["redemption"])
        self.assertEqual(self.admin("select count(*) from public.credit_ledger where created_by = %s", f"invite:{r3['redemption']}"), 0)

    # ---- the film request
    def test_a_request_spends_credits_in_the_ledgers_order_lands_in_the_queue_and_raises_one_alert(self):
        self.make_ryan_admin()
        self.grant(4, entry="subscription_grant", period="p1")
        self.grant(20)
        rid = self.request()
        self.assertEqual(self.balance(), 14)                                                           # 24 - 10
        self.assertEqual(self.balance(pool="subscription"), 0)
        self.assertEqual(self.balance(pool="granted"), 14)
        self.assertEqual(self.admin("select spent from public.film_requests where id = %s", rid), {"subscription": 4, "granted": 6})
        rows = self.db.as_(None).all("select entry::text, pool::text, amount, created_by from public.credit_ledger where reason = %s order by pool", f"Film request #{rid}")
        self.assertEqual(rows, [("adjustment", "granted", -6, "film_request"), ("adjustment", "subscription", -4, "film_request")])
        self.assertEqual(self.admin("select status, credits from public.film_requests where id = %s", rid), ("new", 10))
        self.assertEqual(self.admin("select count(*) from public.ops_alerts where key = %s and resolved_at is null", f"film_request:{rid}"), 1)
        q = self.ryan().one("select admin_film_requests()")
        self.assertEqual((q["waiting"], [i["id"] for i in q["items"]], q["items"][0]["email"], q["items"][0]["question"]), (1, [rid], "ryan.galen@uselai.com", QUESTION))

    def test_a_request_needs_credits_a_real_question_a_signed_in_person_and_at_most_three_open(self):
        self.grant(25)
        with self.assertRaisesRegex(psycopg.Error, "Not enough credits"):
            self.request(OTHER)                                                                        # no credits
        for bad in ("short", "x" * 1001):
            with self.assertRaisesRegex(psycopg.Error, "question"):
                self.request(q=bad)
        with self.assertRaisesRegex(psycopg.Error, "notes"):
            self.request(notes="n" * 1001)
        self.denied("anon", "select request_film(%s, '')", QUESTION)
        self.request(); self.request()
        self.assertEqual(self.balance(), 5)
        with self.assertRaisesRegex(psycopg.Error, "Not enough credits"):
            self.request()                                                                             # 5 left: the third needs 10
        self.assertEqual(self.balance(), 5)                                                            # a refused request spends nothing
        self.assertEqual(self.admin("select count(*) from public.film_requests"), 2)
        self.grant(100)
        self.request()
        with self.assertRaisesRegex(psycopg.Error, "already have 3"):
            self.request()
        self.assertEqual(self.admin("select count(*) from public.film_requests where owner_id = %s", RYAN), 3)

    def test_people_see_only_their_own_requests_and_cannot_write_the_table(self):
        self.grant(40)
        mine = self.request()
        self.assertEqual(self.ryan().one("select count(*) from public.film_requests"), 1)
        self.assertEqual(self.db.as_(OTHER).one("select count(*) from public.film_requests"), 0)
        self.assertEqual(self.ryan().one("select status from public.film_requests where id = %s", mine), "new")
        with self.assertRaises(psycopg.Error):
            self.ryan().one("select spent from public.film_requests where id = %s", mine)              # the refund bookkeeping is not theirs to read
        for who in ("anon", RYAN, OTHER, "service"):
            self.denied(who, "update public.film_requests set status = 'delivered' returning 1")
            self.denied(who, "delete from public.film_requests returning 1")
            self.denied(who, "insert into public.film_requests (owner_id, question, credits) values (%s, 'x' || repeat('y', 20), 0) returning 1", RYAN)
        self.denied("anon", "select * from public.film_requests")

    # ---- Ryan's queue
    def test_the_queue_moves_new_to_in_progress_to_delivered_with_a_link_and_the_credits_stay_spent(self):
        self.make_ryan_admin()
        self.grant(30)
        rid = self.request()
        self.ryan().one("select admin_film_request_set(%s, 'in_progress', 'Working on it', null)", rid)
        self.assertEqual(self.admin("select status, admin_note from public.film_requests where id = %s", rid), ("in_progress", "Working on it"))
        self.assertEqual(self.admin("select count(*) from public.ops_alerts where key = %s and resolved_at is null", f"film_request:{rid}"), 0)   # picked up: the alert clears
        for bad_url in (None, "", "http://insecure.example/f", "javascript:alert(1)", "https://has space.example/f"):
            with self.assertRaisesRegex(psycopg.Error, "https link"):
                self.ryan().one("select admin_film_request_set(%s, 'delivered', '', %s)", rid, bad_url)
        self.ryan().one("select admin_film_request_set(%s, 'delivered', 'Here it is', 'https://youtu.be/abc123')", rid)
        self.assertEqual(tuple(self.admin("select status, delivered_url, admin_note, refunded from public.film_requests where id = %s", rid)), ("delivered", "https://youtu.be/abc123", "Here it is", False))
        self.assertEqual(self.balance(), 20)                                                           # delivered: the 10 credits stay spent
        with self.assertRaisesRegex(psycopg.Error, "already delivered"):
            self.ryan().one("select admin_film_request_set(%s, 'declined')", rid)
        self.assertEqual(self.ryan().one("select count(*) from public.film_requests where status = 'delivered' and delivered_url is not null"), 1)
        q = self.ryan().one("select admin_film_requests()")
        self.assertEqual((q["waiting"], q["items"], [r["status"] for r in q["recent"]]), (0, [], ["delivered"]))

    def test_declining_gives_back_exactly_the_credits_from_exactly_the_pools_they_came_from_once(self):
        self.make_ryan_admin()
        self.grant(4, entry="subscription_grant", period="p1")
        self.grant(20)
        rid = self.request()
        self.assertEqual((self.balance(pool="subscription"), self.balance(pool="granted")), (0, 14))
        self.ryan().one("select admin_film_request_set(%s, 'declined', 'Not something we can draw from public data')", rid)
        self.assertEqual((self.balance(pool="subscription"), self.balance(pool="granted"), self.balance(pool="purchased")), (4, 20, 0))
        self.assertEqual(self.balance(), 24)
        self.assertEqual(self.admin("select refunded from public.film_requests where id = %s", rid), True)
        with self.assertRaisesRegex(psycopg.Error, "already declined"):
            self.ryan().one("select admin_film_request_set(%s, 'declined')", rid)
        self.assertEqual(self.balance(), 24)                                                           # never refunded twice
        self.assertEqual(self.admin("select count(*) from public.credit_ledger where reason = %s", f"Refund for declined film request #{rid}"), 2)
        self.assertEqual(self.admin("select count(*) from public.ops_alerts where key = %s and resolved_at is null", f"film_request:{rid}"), 0)

    def test_only_ryan_moves_requests_and_a_changed_price_applies_to_the_next_request_only(self):
        self.make_ryan_admin()
        self.grant(50)
        rid = self.request()
        for who in ("anon", OTHER, "service"):
            self.denied(who, "select admin_film_requests()")
            self.denied(who, "select admin_film_request_set(%s, 'declined')", rid)
        self.ryan().one("select admin_creator_flow_set(3, 20)")
        r2 = self.request()
        self.assertEqual(self.admin("select credits from public.film_requests where id = %s", r2), 3)
        self.assertEqual(self.admin("select credits from public.film_requests where id = %s", rid), 10)     # the first keeps what it cost
        for bad in ("select admin_film_request_set(%s, 'new')" % rid, "select admin_film_request_set(%s, 'done')" % rid, "select admin_film_request_set(99999, 'declined')"):
            with self.assertRaises(psycopg.Error):
                self.ryan().one(bad)
        self.ryan().one("select admin_film_request_set(%s, 'in_progress')", rid)
        self.ryan().one("select admin_film_request_set(%s, 'in_progress')", rid)                       # idempotent
        self.assertEqual(self.balance(), 50 - 10 - 3)

    def test_ledger_stays_consistent_a_request_never_makes_credits_out_of_nothing(self):
        self.make_ryan_admin()
        self.grant(10)
        rid = self.request()
        self.ryan().one("select admin_film_request_set(%s, 'declined')", rid)
        self.assertEqual(self.balance(), 10)
        rid2 = self.request()
        self.assertEqual(self.balance(), 0)
        with self.assertRaisesRegex(psycopg.Error, "Not enough credits"):
            self.request()
        self.ryan().one("select admin_film_request_set(%s, 'delivered', '', 'https://youtu.be/x1')", rid2)
        self.assertEqual(self.balance(), 0)
        self.assertEqual(self.admin("select coalesce(sum(amount), 0) from public.credit_ledger where entry = 'adjustment'"), -10)           # one delivered request = -10 net


if __name__ == "__main__":
    unittest.main()
